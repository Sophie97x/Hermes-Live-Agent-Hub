"""
Hermes Agent Hub Backend — reads real local Hermes state.
Direct SQLite + JSON readers against ~/.hermes/.
No demo data, no simulated agents.
"""
import asyncio
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

app = FastAPI(title="Hermes Agent Hub")
HUB_STARTED_AT = time.time()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
STATE_DB = HERMES_HOME / "state.db"
KANBAN_DB = HERMES_HOME / "kanban.db"
CRON_JOBS = HERMES_HOME / "cron" / "jobs.json"
GATEWAY_STATE = HERMES_HOME / "gateway_state.json"
PROFILES_DIR = HERMES_HOME / "profiles"
OBSIDIAN_PROJECTS = Path(
    os.environ.get(
        "OBSIDIAN_PROJECTS",
        Path.home() / "Documents" / "Obsidian Vault" / "Projects",
    )
).expanduser()


# ── helpers ──────────────────────────────────────────────────────────

def _query(db_path: Path, sql: str, params: tuple = ()) -> list[dict]:
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        return {}


def _iso(ts: Optional[float]) -> Optional[str]:
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return None


def _pid_is_alive(pid: Optional[int]) -> bool:
    """Return whether a local worker process still exists without spawning tools."""
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except PermissionError:
        return True
    except (OSError, TypeError, ValueError):
        return False


HEARTBEAT_STALE_SECONDS = 120
FRIDAY_ACTIVITY_WINDOW_SECONDS = 300


# ── state readers ─────────────────────────────────────────────────────

_SESSION_SOURCE_AGENT_NAMES = {"default", "desktop", "cli", "tui", "subagent", "gateway"}

_KANBAN_COLUMN = {
    "todo": "backlog",
    "ready": "backlog",
    "queued": "backlog",
    "active": "in_progress",
    "blocked": "in_progress",
    "in_review": "review",
    "review": "review",
    "done": "completed",
    "archived": "archive",
    "cancelled": "archive",
}


_KNOWN_AGENT_METADATA = {
    "atlas": {"role": "Project Manager", "specialty": "Planning & delegation", "home": "meeting"},
    "orion": {"role": "Workspace Scout", "specialty": "Discovery & setup", "home": "research"},
    "devin": {"role": "Developer", "specialty": "Production coding", "home": "coding"},
    "quinn": {"role": "Quality Engineer", "specialty": "Testing & review", "home": "coding"},
    "scribe": {"role": "Documentarian", "specialty": "Obsidian & handoff", "home": "research"},
}

_KNOWN_AGENT_ORDER = {name: index for index, name in enumerate(_KNOWN_AGENT_METADATA)}


def _profile_description(path: Path) -> str:
    """Read the folded description field without adding a YAML dependency."""
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return ""

    parts: list[str] = []
    collecting = False
    for line in lines:
        if line.startswith("description:"):
            collecting = True
            value = line.split(":", 1)[1].strip().strip('"\'')
            if value not in {"", ">", "|", ">-", "|-"}:
                parts.append(value)
            continue
        if collecting:
            if line.startswith((" ", "\t")):
                parts.append(line.strip())
            else:
                break
    return " ".join(parts).strip()


def _generic_agent_metadata(description: str) -> dict:
    text = description.lower()
    if any(word in text for word in ("product", "ux", "user journey", "wireframe", "accessibility")):
        return {"role": "Product & UX Specialist", "home": "meeting"}
    if any(word in text for word in ("media", "visual", "image", "video", "creative")):
        return {"role": "Creative Specialist", "home": "coding"}
    if any(word in text for word in ("writer", "document", "knowledge", "obsidian")):
        return {"role": "Knowledge Specialist", "home": "research"}
    if any(word in text for word in ("research", "analyst", "discovery", "investigat")):
        return {"role": "Research Specialist", "home": "research"}
    if any(word in text for word in ("manager", "coordinat", "planner", "acceptance")):
        return {"role": "Team Coordinator", "home": "meeting"}
    if any(word in text for word in ("qa", "quality", "review", "test", "security")):
        return {"role": "Quality Specialist", "home": "coding"}
    if any(word in text for word in ("operations", "platform", "deploy", "system", "monitor")):
        return {"role": "Operations Specialist", "home": "operations"}
    if any(word in text for word in ("code", "developer", "engineer", "implementation")):
        return {"role": "Engineering Specialist", "home": "coding"}
    return {"role": "Hermes Specialist", "home": "coding"}


def discover_team() -> list[dict]:
    """Discover the current Hermes profile roster directly from disk."""
    friday = {"name": "Friday", "role": "Chief of Staff", "specialty": "Orchestration", "home": "operations"}
    members: list[dict] = []
    if not PROFILES_DIR.exists():
        return [friday]

    for profile_path in PROFILES_DIR.glob("*/profile.yaml"):
        key = profile_path.parent.name.strip().lower()
        if not key or key in _SESSION_SOURCE_AGENT_NAMES or key.startswith("."):
            continue
        description = _profile_description(profile_path)
        metadata = _KNOWN_AGENT_METADATA.get(key, _generic_agent_metadata(description))
        members.append({
            "name": key.replace("_", " ").replace("-", " ").title(),
            "role": metadata["role"],
            "specialty": metadata.get("specialty") or description or "General Hermes work",
            "home": metadata["home"],
            "profile": key,
        })

    members.sort(key=lambda member: (
        _KNOWN_AGENT_ORDER.get(member["profile"], len(_KNOWN_AGENT_ORDER)),
        member["name"].lower(),
    ))
    return [friday, *members]


def read_agents() -> list[dict]:
    """Return Friday plus every real Hermes profile, never raw transport sessions."""
    task_rows = _query(KANBAN_DB, """
        SELECT t.id, t.assignee, t.title, t.status, t.created_at,
               t.started_at, t.worker_pid, t.last_heartbeat_at,
               t.current_run_id, t.last_failure_error,
               r.id AS run_id, r.status AS run_status,
               r.worker_pid AS run_worker_pid,
               r.last_heartbeat_at AS run_last_heartbeat_at,
               r.started_at AS run_started_at, r.ended_at AS run_ended_at,
               r.outcome AS run_outcome, r.error AS run_error
        FROM tasks t
        LEFT JOIN task_runs r ON r.id = (
            SELECT latest.id FROM task_runs latest
            WHERE latest.task_id = t.id
            ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
        )
        WHERE t.assignee IS NOT NULL AND t.assignee != ''
          AND t.status NOT IN ('archived', 'done', 'cancelled')
        ORDER BY
          CASE t.status WHEN 'active' THEN 0 WHEN 'running' THEN 0
                        WHEN 'blocked' THEN 1 ELSE 2 END,
          t.created_at DESC
    """)
    latest_task: dict[str, dict] = {}
    for row in task_rows:
        latest_task.setdefault(str(row["assignee"]).lower(), row)

    recent_sessions = _query(STATE_DB, """
        SELECT s.id, s.title, s.source, s.started_at, s.ended_at,
               MAX(m.timestamp) AS last_activity_at
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id AND m.active = 1
        GROUP BY s.id
        ORDER BY COALESCE(MAX(m.timestamp), s.started_at) DESC LIMIT 1
    """)
    main_session = recent_sessions[0] if recent_sessions else None
    gateway = read_gateway()
    gateway_available = (
        gateway.get("gateway_state") == "running"
        and _pid_is_alive(gateway.get("pid"))
    )
    now = time.time()

    agents: list[dict] = []
    for index, member in enumerate(discover_team()):
        key = member["name"].lower()
        task = latest_task.get(key)

        if key == "friday":
            activity_at = (main_session or {}).get("last_activity_at") or (main_session or {}).get("started_at")
            is_recent = bool(activity_at and now - float(activity_at) <= FRIDAY_ACTIVITY_WINDOW_SECONDS)
            if not gateway_available:
                status, status_reason = "error", "gateway_offline"
                current_task = "Hermes gateway is unavailable"
            elif is_recent:
                status, status_reason = "working", "session_active"
                current_task = (main_session or {}).get("title") or "Handling a live Hermes session"
            else:
                status, status_reason = "idle", "available"
                current_task = "Available for the next request"
            started_at = _iso((main_session or {}).get("started_at")) if is_recent else None
            last_activity_at = _iso(activity_at)
            task_id = None
            run_id = None
        elif task:
            status, status_reason = _task_runtime_status(task, now)
            current_task = task["title"]
            started_at = _iso(task.get("run_started_at") or task.get("started_at")) if status == "working" else None
            last_activity_at = _iso(task.get("run_last_heartbeat_at") or task.get("last_heartbeat_at"))
            task_id = task.get("id")
            run_id = task.get("run_id")
        else:
            status, status_reason = "idle", "available"
            current_task = "Available for the next assignment"
            started_at = None
            last_activity_at = None
            task_id = None
            run_id = None

        agents.append({
            "id": f"agent-{key}",
            "name": member["name"],
            "role": member["role"],
            "specialty": member["specialty"],
            "home": member["home"],
            "status": status,
            "status_reason": status_reason,
            "current_task": current_task,
            "started_at": started_at,
            "last_activity_at": last_activity_at,
            "task_id": task_id,
            "run_id": run_id,
            "position": {"top": 10 + index * 12, "left": 10 + (index % 3) * 20},
        })

    return agents


def _task_runtime_status(task: dict, now: float) -> tuple[str, str]:
    """Classify an assignment from its task, latest run, heartbeat and PID."""
    task_status = str(task.get("status") or "").lower()
    run_status = str(task.get("run_status") or "").lower()
    outcome = str(task.get("run_outcome") or "").lower()

    if task_status == "blocked" or run_status == "blocked" or outcome == "blocked":
        return "waiting", "blocked"

    failed_states = {"failed", "crashed", "timed_out", "spawn_failed", "gave_up"}
    if run_status in failed_states or outcome in failed_states:
        return "error", "run_failed"

    expects_worker = task_status in {"active", "running", "in_progress"} or run_status == "running"
    if expects_worker:
        pid = task.get("run_worker_pid") or task.get("worker_pid")
        heartbeat = task.get("run_last_heartbeat_at") or task.get("last_heartbeat_at")
        if not pid:
            return "waiting", "worker_missing"
        if not _pid_is_alive(pid):
            return "error", "worker_stopped"
        if not heartbeat:
            return "waiting", "heartbeat_missing"
        if now - float(heartbeat) > HEARTBEAT_STALE_SECONDS:
            return "waiting", "stale_heartbeat"
        return "working", "active_run"

    return "queued", "assigned"


def read_activity() -> list[dict]:
    rows = _query(STATE_DB, """
        SELECT id, title, source, started_at, ended_at, end_reason,
               message_count, tool_call_count
        FROM sessions ORDER BY started_at DESC LIMIT 15
    """)
    items: list[dict] = []
    for r in rows:
        items.append({
            "id": str(uuid.uuid4()),
            "timestamp": _iso(r["started_at"]),
            "agent": r["source"] or "system",
            "type": "session_start",
            "detail": r["title"] or f"Session ({r['source']})",
        })
        if r["ended_at"]:
            items.append({
                "id": str(uuid.uuid4()),
                "timestamp": _iso(r["ended_at"]),
                "agent": r["source"] or "system",
                "type": "session_end",
                "detail": r.get("end_reason") or "completed",
            })
    return items[:20]


def read_sessions() -> list[dict]:
    rows = _query(STATE_DB, """
        SELECT id, title, source, started_at, ended_at, end_reason,
               message_count, tool_call_count
        FROM sessions ORDER BY started_at DESC LIMIT 50
    """)
    return [
        {
            "id": r["id"],
            "title": r["title"] or f"Session ({r['source']})",
            "source": r["source"],
            "status": "active" if r["ended_at"] is None else "completed",
            "started_at": _iso(r["started_at"]),
            "updated": _iso(r["ended_at"] or r["started_at"]),
            "messages": r["message_count"],
            "tool_calls": r["tool_call_count"],
        }
        for r in rows
    ]


def read_cron() -> list[dict]:
    data = _read_json(CRON_JOBS)
    jobs = data.get("jobs", [])

    def schedule_label(job: dict) -> str:
        schedule = job.get("schedule")
        if job.get("schedule_display"):
            return str(job["schedule_display"])
        if isinstance(schedule, str):
            return schedule
        if isinstance(schedule, dict):
            if schedule.get("display"):
                return str(schedule["display"])
            if schedule.get("expr"):
                return str(schedule["expr"])
            if schedule.get("kind") == "interval" and schedule.get("minutes"):
                return f'every {schedule["minutes"]}m'
        return "Not scheduled"

    return [
        {
            "id": j.get("id", f"cron-{i}"),
            "name": j.get("name", f"Job {i}"),
            "schedule": schedule_label(j),
            "status": "paused" if not j.get("enabled", True) else j.get("state") or j.get("status") or "scheduled",
            "enabled": bool(j.get("enabled", True)),
            "last_run": j.get("last_run_at") or j.get("last_run"),
            "next_run": j.get("next_run_at") or j.get("next_run"),
            "last_status": j.get("last_status"),
            "last_error": j.get("last_error") or j.get("last_delivery_error"),
            "runs_completed": (j.get("repeat") or {}).get("completed", 0),
        }
        for i, j in enumerate(jobs)
    ]


def read_kanban() -> dict:
    rows = _query(KANBAN_DB, """
        SELECT id, title, body, assignee, status, priority, created_at,
               started_at, completed_at, workspace_path, project_id, result,
               last_failure_error,
               (SELECT MAX(created_at) FROM task_events e
                WHERE e.task_id = tasks.id AND e.kind = 'archived') AS archived_at
        FROM tasks
        ORDER BY COALESCE(completed_at, archived_at, created_at) DESC
    """)
    board: dict[str, list] = {
        "backlog": [], "in_progress": [], "review": [], "completed": [], "archive": [],
    }
    for r in rows:
        col = _KANBAN_COLUMN.get(r["status"], "backlog")
        if col not in board:
            board[col] = []
        board[col].append({
            "id": r["id"],
            "title": r["title"],
            "assignee": r["assignee"] or "",
            "priority": str(r["priority"] or "0"),
            "status": r["status"],
            "detail": r["body"] or "",
            "project": r["project_id"] or "",
            "workspace": r["workspace_path"] or "",
            "result": r["result"] or "",
            "failure": r["last_failure_error"] or "",
            "created_at": _iso(r["created_at"]),
            "finished_at": _iso(r["completed_at"] or r["archived_at"]) if (r["completed_at"] or r["archived_at"]) else None,
        })
    return board


def read_projects() -> list[dict]:
    """Read the durable project history already maintained in Obsidian."""
    if not OBSIDIAN_PROJECTS.exists():
        return []
    projects: list[dict] = []
    for note in sorted(OBSIDIAN_PROJECTS.glob("*.md")):
        try:
            content = note.read_text(errors="replace")
        except OSError:
            continue
        lines = [line.strip() for line in content.splitlines()]
        title = next((line[2:].strip() for line in lines if line.startswith("# ")), note.stem)
        summary = next((line for line in lines if line and not line.startswith(("#", "-", "```"))), "Recorded Hermes project")
        lower = content.lower()
        status = "active" if any(term in lower for term in ("✅ running", "active repo", "current status", "current app")) else "recorded"
        projects.append({
            "id": f"project-{note.stem.lower().replace(' ', '-')}",
            "name": title,
            "summary": summary[:240],
            "status": status,
            "updated_at": _iso(note.stat().st_mtime),
            "note_path": str(note),
        })
    return sorted(projects, key=lambda project: project["updated_at"], reverse=True)


def read_gateway() -> dict:
    return _read_json(GATEWAY_STATE)


def _timestamp(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def read_health() -> dict:
    now = time.time()
    gateway = read_gateway()
    gateway_state = gateway.get("gateway_state") or gateway.get("state") or gateway.get("status")
    gateway_online = gateway_state == "running" and _pid_is_alive(gateway.get("pid"))
    alerts: list[dict] = []
    stuck_jobs: list[dict] = []

    if not gateway_online:
        alerts.append({"id": "gateway-offline", "level": "error", "title": "Hermes gateway offline", "detail": "Agent activity cannot be verified."})

    for agent in read_agents():
        if agent["status"] not in {"waiting", "error"}:
            continue
        item = {
            "id": f'agent-{agent["id"]}',
            "level": "error" if agent["status"] == "error" else "warning",
            "title": f'{agent["name"]} needs attention',
            "detail": agent.get("status_reason") or "Task is not progressing",
            "agent_id": agent["id"],
            "task_id": agent.get("task_id"),
        }
        alerts.append(item)
        if agent.get("task_id"):
            stuck_jobs.append(item)

    for job in read_cron():
        next_run = _timestamp(job.get("next_run"))
        overdue = job.get("enabled") and next_run is not None and next_run < now - 300
        failed = str(job.get("last_status") or "").lower() in {"error", "failed"} or bool(job.get("last_error"))
        if not (overdue or failed):
            continue
        item = {
            "id": f'cron-{job["id"]}',
            "level": "error" if failed else "warning",
            "title": f'{job["name"]} {"failed" if failed else "is overdue"}',
            "detail": job.get("last_error") or "The scheduled run has not started.",
            "cron_id": job["id"],
        }
        alerts.append(item)
        stuck_jobs.append(item)

    return {
        "status": "healthy" if not alerts else "degraded",
        "started_at": _iso(HUB_STARTED_AT),
        "uptime_seconds": max(0, int(now - HUB_STARTED_AT)),
        "gateway_online": gateway_online,
        "alerts": alerts,
        "stuck_jobs": stuck_jobs,
    }


# ── REST endpoints ────────────────────────────────────────────────────

@app.get("/api/agents")
async def get_agents():
    return read_agents()


@app.get("/api/activity")
async def get_activity(limit: int = 20):
    return read_activity()[:limit]


@app.get("/api/sessions")
async def get_sessions():
    return read_sessions()


@app.get("/api/cron")
async def get_cron_jobs():
    return read_cron()


@app.get("/api/kanban")
async def get_kanban():
    return read_kanban()


@app.get("/api/projects")
async def get_projects():
    return read_projects()


@app.get("/api/gateway")
async def get_gateway():
    return read_gateway()


@app.get("/api/health")
async def get_health():
    return read_health()


async def _restart_hub() -> None:
    await asyncio.sleep(0.25)
    os._exit(0)


@app.post("/api/restart")
async def restart_hub():
    asyncio.create_task(_restart_hub())
    return {"status": "restarting"}


# ── SSE ───────────────────────────────────────────────────────────────

async def event_generator() -> AsyncGenerator[str, None]:
    _last_agents_key: str = ""
    while True:
        agents = read_agents()
        now = datetime.now(timezone.utc).isoformat()
        key = json.dumps(agents, sort_keys=True, default=str)

        payload = {"type": "heartbeat", "timestamp": now, "health": read_health()}
        if key != _last_agents_key:
            payload.update({
                "agents": agents,
                "sessions_count": len(read_sessions()),
                "gateway": read_gateway(),
            })
            _last_agents_key = key
        yield json.dumps(payload)

        await asyncio.sleep(5)


@app.get("/api/events")
async def sse_events(request: Request):
    return EventSourceResponse(event_generator())


# Serve the compiled dashboard from this same lightweight process. API routes
# are registered first, so the SPA mount cannot shadow them.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
