"""
Discovery of non-Hermes coding agents (Claude Code, Codex, OpenClaw).

Each tool keeps local session transcripts; the hub reads them the same way
it reads Hermes state — best-effort and strictly read-only. An agent is
"working" when its newest session file changed inside the activity window,
"idle" while it stays inside the idle window, and hidden after that.

The hub's own configuration is the one file this module writes, and it
lives outside every tool's state directory.
"""
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SETTINGS_PATH = Path(
    os.environ.get(
        "HUB_SETTINGS",
        Path.home() / ".config" / "hermes-agent-hub" / "settings.json",
    )
).expanduser()

_HERMES_HOME_DEFAULT = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()

DEFAULT_SETTINGS: dict = {
    "external_activity_seconds": 120,
    "external_idle_hours": 6,
    "external_max_per_source": 3,
    "sources": {
        "hermes": {"enabled": True, "home": str(_HERMES_HOME_DEFAULT), "label": "Hermes"},
        "claude": {"enabled": True, "home": str(Path.home() / ".claude"), "label": "Claude Code"},
        "codex": {"enabled": True, "home": str(Path.home() / ".codex"), "label": "Codex"},
        "openclaw": {"enabled": True, "home": str(Path.home() / ".openclaw"), "label": "OpenClaw"},
    },
}

_SOURCE_META = {
    "claude": {"role": "Claude Code", "specialty": "Interactive coding sessions", "hue": 0},
    "codex": {"role": "Codex", "specialty": "OpenAI coding sessions", "hue": 1},
    "openclaw": {"role": "OpenClaw", "specialty": "Personal agent sessions", "hue": 2},
}


def load_settings() -> dict:
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        saved = json.loads(SETTINGS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return settings
    return _merge_settings(settings, saved)


def _merge_settings(settings: dict, patch: dict) -> dict:
    """Fold a saved/submitted patch into settings, keeping only known keys."""
    for key in ("external_activity_seconds", "external_idle_hours", "external_max_per_source"):
        value = patch.get(key)
        if isinstance(value, (int, float)) and value > 0:
            settings[key] = int(value)
    sources = patch.get("sources")
    if isinstance(sources, dict):
        for name, source in settings["sources"].items():
            update = sources.get(name)
            if not isinstance(update, dict):
                continue
            if isinstance(update.get("enabled"), bool):
                source["enabled"] = update["enabled"]
            if isinstance(update.get("home"), str) and update["home"].strip():
                source["home"] = str(Path(update["home"].strip()).expanduser())
    return settings


def save_settings(patch: dict) -> dict:
    settings = _merge_settings(load_settings(), patch or {})
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2))
    return settings


def _iso(ts: Optional[float]) -> Optional[str]:
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return None


# Prompt/project extraction rereads multi-MB transcripts on every poll;
# cache per file and invalidate on mtime change.
_file_cache: dict[tuple[str, str], tuple[float, str]] = {}


def _cached(kind: str, path: Path, mtime: float, compute) -> str:
    key = (kind, str(path))
    hit = _file_cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    value = compute(path)
    _file_cache[key] = (mtime, value)
    return value


def _tail_text(path: Path, size: int = 65536) -> str:
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            length = handle.tell()
            handle.seek(max(0, length - size))
            return handle.read().decode(errors="replace")
    except OSError:
        return ""


_COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)
_COMMAND_NAME = re.compile(r"<command-name>(.*?)</command-name>", re.DOTALL)


def _human_prompt(text: str) -> str:
    """The human-readable part of a prompt, unwrapping slash-command records."""
    if text.startswith("<command-name>"):
        args = _COMMAND_ARGS.search(text)
        if args and args.group(1).strip():
            return args.group(1).strip()
        name = _COMMAND_NAME.search(text)
        return name.group(1).strip() if name else ""
    return "" if text.startswith("<") else text


def _last_user_text(path: Path) -> str:
    """Best-effort: the newest human message in a JSONL transcript."""
    for line in reversed(_tail_text(path, 4 * 1024 * 1024).splitlines()):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("isMeta"):  # hook output and other injected system records
            continue
        message = record.get("message") if isinstance(record.get("message"), dict) else record
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        candidate = message if message.get("role") == "user" else payload if payload.get("role") == "user" else None
        if not candidate:
            continue
        content = candidate.get("content")
        texts = [content] if isinstance(content, str) else [
            part.get("text") or part.get("input_text") or ""
            for part in content if isinstance(part, dict)
        ] if isinstance(content, list) else []
        for text in texts:
            # Skip tool results and harness wrappers; keep real human prompts.
            prompt = _human_prompt(text.strip()) if isinstance(text, str) else ""
            if prompt:
                return prompt
    return ""


def _head_text(path: Path, size: int = 16384) -> str:
    try:
        with path.open("rb") as handle:
            return handle.read(size).decode(errors="replace")
    except OSError:
        return ""


def _session_finished(path: Path) -> str:
    """"1" when the transcript's last turn has completed, "" while in flight.

    Claude Code ends a turn with a plain assistant text message; Codex writes
    an explicit task_complete event. Tool calls, tool results, thinking and a
    fresh user prompt all mean the turn is still running.
    """
    for line in reversed(_tail_text(path, 32768).splitlines()):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("type") == "event_msg":  # codex event stream
            payload_type = (record.get("payload") or {}).get("type")
            if payload_type == "task_complete":
                return "1"
            if payload_type in {"task_started", "user_message"}:
                return ""
            continue  # token_count and other bookkeeping
        if record.get("type") == "response_item":
            return ""  # codex mid-turn item
        message = record.get("message")
        if not isinstance(message, dict):
            continue  # summaries, mode changes and other bookkeeping
        if message.get("role") == "assistant":
            content = message.get("content")
            if isinstance(content, str):
                return "1"
            if isinstance(content, list):
                types = {part.get("type") for part in content if isinstance(part, dict)}
                if types & {"tool_use", "thinking"}:
                    return ""
                if "text" in types:
                    return "1"
            continue
        if message.get("role") == "user":
            return ""  # a prompt or tool result means work is in flight
    return ""


def _is_working(path: Path, mtime: float, now: float, activity_window: float) -> bool:
    """Recently changed and the last recorded turn has not completed."""
    if now - mtime > activity_window:
        return False
    return not _cached("finished", path, mtime, _session_finished)


def _session_meta_json(path: Path) -> str:
    """Launch cwd and whether this transcript is an internal subagent thread.

    Codex spawns helper threads (judges, watchers) that write their own
    rollout files; like Hermes transport sessions, they are not people and
    should not appear in the office.
    """
    info = {"cwd": "", "subagent": False}
    for line in _head_text(path).splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        if record.get("type") == "session_meta":
            info["cwd"] = payload.get("cwd") or ""
            source = payload.get("source")
            if payload.get("thread_source") == "subagent" or (isinstance(source, dict) and source.get("subagent")):
                info["subagent"] = True
            break
        cwd = record.get("cwd") or payload.get("cwd")
        if isinstance(cwd, str) and cwd:
            info["cwd"] = cwd
            break
    return json.dumps(info)


def _session_meta(path: Path, mtime: float) -> dict:
    return json.loads(_cached("meta", path, mtime, _session_meta_json))


def _session_created(path: Path, mtime: float) -> float:
    try:
        stat = path.stat()
        return getattr(stat, "st_birthtime", None) or stat.st_mtime
    except OSError:
        return mtime


def _live_session_value(created: float, now: float) -> int:
    """A moving bar for a live session: fills asymptotically with elapsed
    time (20-minute scale) without ever claiming completion."""
    elapsed = max(0.0, now - created)
    return 12 + min(79, round(79 * (1 - math.exp(-elapsed / 1200))))


def _session_files(source: str, home: Path) -> list[Path]:
    if source == "hermes":
        # For Hermes the meaningful count is the agent roster, not transcripts.
        return list(home.glob("profiles/*/profile.yaml"))
    if source == "claude":
        return list(home.glob("projects/*/*.jsonl"))
    if source == "codex":
        return list(home.glob("sessions/*/*/*/rollout-*.jsonl"))
    # OpenClaw keeps per-agent transcripts; accept both known layouts.
    return list(home.glob("agents/*/sessions/*.jsonl")) + list(home.glob("sessions/*.jsonl"))


def source_counts(settings: Optional[dict] = None) -> dict[str, int]:
    """How many session transcripts each source directory currently holds."""
    settings = settings or load_settings()
    counts: dict[str, int] = {}
    for name, source in settings["sources"].items():
        home = Path(source["home"]).expanduser()
        counts[name] = len(_session_files(name, home)) if home.exists() else 0
    return counts


def read_external_tasks(settings: Optional[dict] = None) -> list[dict]:
    """Task-board cards for external sessions: one card per transcript.

    A session whose file is still changing is an in-progress card with the
    live-activity bar; a session that has gone quiet moves to Completed.
    """
    settings = settings or load_settings()
    now = time.time()
    activity_window = settings["external_activity_seconds"]
    idle_cutoff = now - settings["external_idle_hours"] * 3600

    cards: list[dict] = []
    for name, source in settings["sources"].items():
        if name == "hermes" or not source.get("enabled"):
            continue
        home = Path(source["home"]).expanduser()
        if not home.exists():
            continue
        label = source.get("label") or _SOURCE_META[name]["role"]
        files = []
        for path in _session_files(name, home):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if mtime >= idle_cutoff:
                files.append((mtime, path))
        files.sort(reverse=True)
        # Resuming a conversation writes a fresh transcript with the same
        # history, so collapse files sharing a project and latest prompt.
        seen: set[tuple[str, str]] = set()
        for mtime, path in files[:12]:
            meta = _session_meta(path, mtime)
            if meta["subagent"]:
                continue
            working = _is_working(path, mtime, now, activity_window)
            project = Path(meta["cwd"]).name if meta["cwd"] else (path.parent.name if name == "claude" else "")
            prompt = _cached("prompt", path, mtime, _last_user_text)
            if (project, prompt) in seen:
                continue
            seen.add((project, prompt))
            created = _session_created(path, mtime)
            cards.append({
                "id": f"external-{name}-{path.stem}",
                "title": prompt[:160] or (f"{label} session in {project}" if project else f"{label} session"),
                "assignee": label,
                "priority": "0",
                "status": "running" if working else "done",
                "column": "in_progress" if working else "completed",
                "detail": f"{label} session · {project}" if project else f"{label} session",
                "project": project,
                "workspace": "",
                "result": "",
                "failure": "",
                "created_at": _iso(created),
                "finished_at": None if working else _iso(mtime),
                "progress_value": _live_session_value(created, now) if working else 100,
                "progress_label": "Live session" if working else "Session ended",
                "progress_mode": "active" if working else "workflow",
            })
    return cards


def read_external_agents(settings: Optional[dict] = None) -> list[dict]:
    settings = settings or load_settings()
    now = time.time()
    activity_window = settings["external_activity_seconds"]
    idle_cutoff = now - settings["external_idle_hours"] * 3600
    max_per_source = settings["external_max_per_source"]

    agents: list[dict] = []
    for name, source in settings["sources"].items():
        if name == "hermes" or not source.get("enabled"):
            continue  # the Hermes roster is built by main.read_agents
        home = Path(source["home"]).expanduser()
        if not home.exists():
            continue
        files = []
        for path in _session_files(name, home):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if mtime >= idle_cutoff:
                files.append((mtime, path))
        files.sort(reverse=True)

        # Every working session is its own agent (a resumed copy of the same
        # conversation is folded away); idle history collapses to one agent
        # per project so the Break Room does not fill with old sessions.
        seen_projects: set[str] = set()
        seen_conversations: set[tuple[str, str]] = set()
        added = 0
        label = source.get("label") or _SOURCE_META[name]["role"]
        for mtime, path in files:
            if added >= max_per_source:
                break
            meta = _session_meta(path, mtime)
            if meta["subagent"]:
                continue
            project = Path(meta["cwd"]).name if meta["cwd"] else (path.parent.name if name == "claude" else "")
            project_key = path.parent.name if name == "claude" else project
            working = _is_working(path, mtime, now, activity_window)
            task = _cached("prompt", path, mtime, _last_user_text)
            if working:
                if (project_key, task) in seen_conversations:
                    continue
                seen_conversations.add((project_key, task))
            else:
                if project_key in seen_projects:
                    continue
            seen_projects.add(project_key)
            added += 1
            agents.append({
                "id": f"{name}-{path.stem.lower()}",
                "name": f"{label} · {project}" if project else label,
                "role": _SOURCE_META[name]["role"],
                "specialty": _SOURCE_META[name]["specialty"],
                "home": "coding",
                "source": name,
                "status": "working" if working else "idle",
                "status_reason": "session_active" if working else "available",
                "current_task": task[:160] or (f"Session in {project}" if project else "Local session"),
                "started_at": None,
                "last_activity_at": _iso(mtime),
                "task_id": None,
                "run_id": None,
                "progress_value": _live_session_value(_session_created(path, mtime), now) if working else None,
                "progress_label": "Live session" if working else None,
                "progress_mode": "active" if working else None,
                "position": {"top": 10, "left": 10},
            })

    # Two live sessions in one project share a name; number them so both
    # characters stay tellable apart in the office and roster.
    name_totals: dict[str, int] = {}
    for agent in agents:
        name_totals[agent["name"]] = name_totals.get(agent["name"], 0) + 1
    name_seen: dict[str, int] = {}
    for agent in agents:
        if name_totals[agent["name"]] > 1:
            name_seen[agent["name"]] = name_seen.get(agent["name"], 0) + 1
            agent["name"] = f'{agent["name"]} ({name_seen[agent["name"]]})'
    return agents
