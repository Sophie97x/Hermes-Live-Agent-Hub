"""Read-only adapter to local Hermes state (state.db, kanban.db, cron)."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
STATE_DB = HERMES_HOME / "state.db"
KANBAN_DB = HERMES_HOME / "kanban.db"
CRON_FILE = HERMES_HOME / "cron" / "jobs.json"


def _query(db: Path, sql: str, params=()) -> list[dict]:
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(str(db))
        con.row_factory = sqlite3.Row
        cur = con.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        con.close()
        return rows
    except sqlite3.Error:
        return []


def get_sessions() -> list[dict]:
    """Return active & recent sessions from state.db."""
    return _query(
        STATE_DB,
        """SELECT id, title, started_at, ended_at, message_count,
                  tool_call_count, source, user_id
           FROM sessions
           ORDER BY started_at DESC
           LIMIT 50""",
    )


def get_kanban() -> dict[str, list[dict]]:
    """Return kanban board grouped by status column."""
    if not KANBAN_DB.exists():
        return {}
    try:
        con = sqlite3.connect(str(KANBAN_DB))
        cur = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        tables = [r[0] for r in cur.fetchall()]

        board: dict[str, list[dict]] = {}
        for t in tables:
            if t.startswith("task_column_"):
                col_name = t.replace("task_column_", "")
                cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})")]
                rows = cur.execute(f"SELECT * FROM {t}").fetchall()
                board[col_name] = [dict(zip(cols, r)) for r in rows]
        con.close()
        return board
    except sqlite3.Error:
        return {}


def get_cron_jobs() -> list[dict]:
    """Read cron jobs from jobs.json."""
    if not CRON_FILE.exists():
        return []
    try:
        with open(CRON_FILE) as f:
            data = json.load(f)
        return data.get("jobs", [])
    except (json.JSONDecodeError, OSError):
        return []


def build_agents() -> list[dict]:
    """Derive 'agents' view from active sessions for the dashboard."""
    sessions = get_sessions()
    positions = [
        {"top": 10, "left": 10},
        {"top": 10, "left": 30},
        {"top": 10, "left": 50},
        {"top": 10, "left": 70},
        {"top": 40, "left": 10},
        {"top": 40, "left": 30},
    ]
    agents = []
    for i, s in enumerate(sessions[:6]):
        status = "idle"
        if s.get("ended_at") is None:
            status = "working"
        agents.append({
            "id": s["id"],
            "name": s.get("title", s["id"][:12]) or s["id"][:12],
            "status": status,
            "current_task": s.get("title"),
            "started_at": s.get("started_at", ""),
            "position": positions[i] if i < len(positions) else positions[-1],
        })
    return agents or [
        {"id": "hub-1", "name": "No active sessions", "status": "idle",
         "current_task": None, "started_at": "",
         "position": {"top": 10, "left": 10}},
    ]
