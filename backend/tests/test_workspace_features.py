import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import external_agents, main


class WorkspaceFeaturesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.kanban = root / "kanban.db"
        self.state = root / "state.db"
        with sqlite3.connect(self.kanban) as connection:
            connection.executescript("""
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY, title TEXT, assignee TEXT, status TEXT,
                    project_id TEXT, session_id TEXT, workspace_path TEXT,
                    created_at INTEGER, started_at INTEGER, completed_at INTEGER,
                    result TEXT, last_failure_error TEXT
                );
                CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
                CREATE TABLE task_events (
                    id INTEGER PRIMARY KEY, task_id TEXT, run_id INTEGER,
                    kind TEXT, payload TEXT, created_at INTEGER
                );
                CREATE TABLE task_runs (
                    id INTEGER PRIMARY KEY, task_id TEXT, metadata TEXT, started_at INTEGER
                );
            """)
            connection.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ("parent", "Build project", "atlas", "done", "p1", "main-session", "/tmp/project", 100, 110, 200, "planned", None))
            connection.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ("child", "Implement feature", "devin", "active", None, None, "/tmp/project", 120, 130, None, None, None))
            connection.execute("INSERT INTO task_links VALUES (?,?)", ("parent", "child"))
            connection.execute("INSERT INTO task_events VALUES (?,?,?,?,?,?)", (1, "child", 9, "claimed", json.dumps({"summary": "Worker claimed task"}), 140))
            connection.execute("INSERT INTO task_events VALUES (?,?,?,?,?,?)", (2, "child", 9, "heartbeat", None, 150))
            connection.execute("INSERT INTO task_runs VALUES (?,?,?,?)", (9, "child", json.dumps({"worker_session_id": "worker-session"}), 130))

        with sqlite3.connect(self.state) as connection:
            connection.executescript("""
                CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT, started_at REAL);
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
                    tool_name TEXT, timestamp REAL, active INTEGER
                );
            """)
            connection.execute("INSERT INTO sessions VALUES (?,?,?,?)", ("main-session", "My Project", "desktop", 100))
            connection.execute("INSERT INTO sessions VALUES (?,?,?,?)", ("worker-session", "Implement feature", "subagent", 130))
            connection.execute("INSERT INTO messages VALUES (?,?,?,?,?,?,?)", (1, "worker-session", "assistant", "Working on it", None, 140, 1))

        # Point the external tools at an empty temp root so these tests read
        # only their own fixtures, never the developer's real ~/.claude state.
        # Hermes keeps its default home so the patched DB paths still resolve.
        isolated = json.loads(json.dumps(external_agents.DEFAULT_SETTINGS))
        for name, source in isolated["sources"].items():
            if name != "hermes":
                source["home"] = str(root / "external")
        self.patchers = [
            patch.object(main, "KANBAN_DB", self.kanban),
            patch.object(main, "STATE_DB", self.state),
            patch.object(external_agents, "load_settings", return_value=isolated),
        ]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp_dir.cleanup()

    def test_project_rooms_follow_parent_project_links(self):
        rooms = main.read_project_rooms()
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["project_id"], "p1")
        self.assertEqual(rooms[0]["status"], "active")
        self.assertEqual(rooms[0]["progress"], 50)
        self.assertEqual(set(rooms[0]["agents"]), {"Atlas", "Devin"})

    def test_timeline_excludes_heartbeats_and_parses_detail(self):
        timeline = main.read_task_timeline()
        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["kind"], "claimed")
        self.assertEqual(timeline[0]["detail"], "Worker claimed task")

    def test_agent_conversations_use_worker_session_metadata(self):
        conversations = main.read_agent_conversations()
        self.assertEqual(conversations["devin"][0]["content"], "Working on it")
        self.assertEqual(conversations["devin"][0]["speaker"], "Devin")


if __name__ == "__main__":
    unittest.main()
