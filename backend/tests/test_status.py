import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


class LiveAgentStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.state_db = root / "state.db"
        self.kanban_db = root / "kanban.db"
        self.gateway_state = root / "gateway_state.json"
        self.profiles = root / "profiles"
        self.profiles.mkdir()

        with sqlite3.connect(self.state_db) as connection:
            connection.executescript("""
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL,
                    ended_at REAL, title TEXT
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
                    timestamp REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1
                );
            """)

        with sqlite3.connect(self.kanban_db) as connection:
            connection.executescript("""
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY, assignee TEXT, title TEXT, status TEXT,
                    created_at INTEGER, started_at INTEGER, worker_pid INTEGER,
                    last_heartbeat_at INTEGER, current_run_id INTEGER,
                    last_failure_error TEXT
                );
                CREATE TABLE task_runs (
                    id INTEGER PRIMARY KEY, task_id TEXT, status TEXT,
                    worker_pid INTEGER, last_heartbeat_at INTEGER,
                    started_at INTEGER, ended_at INTEGER, outcome TEXT, error TEXT
                );
            """)

        self.gateway_state.write_text(json.dumps({
            "pid": os.getpid(),
            "gateway_state": "running",
        }))
        for profile in ("atlas", "orion", "devin", "quinn", "scribe"):
            folder = self.profiles / profile
            folder.mkdir()
            (folder / "profile.yaml").write_text(f"description: {profile} specialist\n")

        self.patchers = [
            patch.object(main, "STATE_DB", self.state_db),
            patch.object(main, "KANBAN_DB", self.kanban_db),
            patch.object(main, "GATEWAY_STATE", self.gateway_state),
            patch.object(main, "PROFILES_DIR", self.profiles),
        ]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp_dir.cleanup()

    def add_task(self, task_id, assignee, status, *, run=None):
        now = int(time.time())
        with sqlite3.connect(self.kanban_db) as connection:
            connection.execute(
                "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (task_id, assignee, f"{assignee} assignment", status, now, None,
                 run and run.get("worker_pid"), run and run.get("heartbeat"),
                 run and run.get("id"), None),
            )
            if run:
                connection.execute(
                    "INSERT INTO task_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (run["id"], task_id, run["status"], run.get("worker_pid"),
                     run.get("heartbeat"), run.get("started_at", now - 10),
                     run.get("ended_at"), run.get("outcome"), run.get("error")),
                )

    def agents_by_name(self):
        return {agent["name"]: agent for agent in main.read_agents()}

    def test_runtime_states_use_runs_heartbeats_and_tasks(self):
        now = int(time.time())
        self.add_task("queued", "atlas", "todo")
        self.add_task("blocked", "quinn", "blocked", run={
            "id": 1, "status": "blocked", "heartbeat": now - 20,
            "ended_at": now - 10, "outcome": "blocked",
        })
        self.add_task("live", "devin", "active", run={
            "id": 2, "status": "running", "worker_pid": os.getpid(),
            "heartbeat": now, "started_at": now - 30,
        })
        self.add_task("stale", "orion", "active", run={
            "id": 3, "status": "running", "worker_pid": os.getpid(),
            "heartbeat": now - 121,
        })
        self.add_task("failed", "scribe", "todo", run={
            "id": 4, "status": "failed", "heartbeat": now - 20,
            "ended_at": now - 10, "outcome": "failed", "error": "boom",
        })

        agents = self.agents_by_name()
        self.assertEqual((agents["Atlas"]["status"], agents["Atlas"]["status_reason"]), ("queued", "assigned"))
        self.assertEqual(agents["Quinn"]["status"], "waiting")
        self.assertEqual(agents["Devin"]["status"], "working")
        self.assertEqual(agents["Orion"]["status_reason"], "stale_heartbeat")
        self.assertEqual(agents["Scribe"]["status"], "error")

    def test_friday_uses_recent_message_activity_and_gateway_health(self):
        now = time.time()
        with sqlite3.connect(self.state_db) as connection:
            connection.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", ("session", "desktop", now - 60, None, "Live work"))
            connection.execute("INSERT INTO messages VALUES (?, ?, ?, ?)", (1, "session", now - 30, 1))

        friday = self.agents_by_name()["Friday"]
        self.assertEqual((friday["status"], friday["status_reason"]), ("working", "session_active"))

        with sqlite3.connect(self.state_db) as connection:
            connection.execute("UPDATE messages SET timestamp = ?", (now - 301,))
        self.assertEqual(self.agents_by_name()["Friday"]["status"], "idle")

        self.gateway_state.write_text(json.dumps({"gateway_state": "stopped"}))
        friday = self.agents_by_name()["Friday"]
        self.assertEqual((friday["status"], friday["status_reason"]), ("error", "gateway_offline"))

    def test_idle_payload_is_stable_and_new_profiles_are_discovered(self):
        first = main.read_agents()
        second = main.read_agents()
        self.assertEqual(first, second)
        self.assertIsNone(self.agents_by_name()["Atlas"]["started_at"])

        folder = self.profiles / "nova"
        folder.mkdir()
        (folder / "profile.yaml").write_text("description: research and investigation\n")
        self.assertIn("Nova", self.agents_by_name())


if __name__ == "__main__":
    unittest.main()
