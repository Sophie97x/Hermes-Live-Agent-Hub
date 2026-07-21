import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import external_agents


def _write_claude_session(home: Path, project_dir: str, cwd: str, text: str, finished: bool = False, session_name: str = "abc123") -> Path:
    sessions = home / "projects" / project_dir
    sessions.mkdir(parents=True, exist_ok=True)
    session = sessions / f"{session_name}.jsonl"
    last = (
        {"role": "assistant", "content": [{"type": "text", "text": "All done."}]}
        if finished else
        {"role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {}}]}
    )
    session.write_text("\n".join([
        json.dumps({"type": "mode", "mode": "normal"}),
        json.dumps({"type": "user", "cwd": cwd, "message": {"role": "user", "content": text}}),
        json.dumps({"type": "assistant", "cwd": cwd, "message": last}),
    ]))
    return session


class ExternalAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.addCleanup(self.temp_dir.cleanup)

    def settings(self, **overrides):
        settings = json.loads(json.dumps(external_agents.DEFAULT_SETTINGS))
        for name, source in settings["sources"].items():
            source["home"] = str(self.root / name)
        settings.update(overrides)
        return settings

    def test_recent_claude_session_appears_as_working_agent(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Fix the login bug")
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 1)
        agent = agents[0]
        self.assertEqual(agent["source"], "claude")
        self.assertEqual(agent["name"], "Claude Code · Demo")
        self.assertEqual(agent["status"], "working")
        self.assertEqual(agent["current_task"], "Fix the login bug")

    def test_old_sessions_go_idle_then_disappear(self):
        session = _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "hello")
        hour_ago = time.time() - 3600
        import os
        os.utime(session, (hour_ago, hour_ago))
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(agents[0]["status"], "idle")

        week_ago = time.time() - 7 * 24 * 3600
        os.utime(session, (week_ago, week_ago))
        self.assertEqual(external_agents.read_external_agents(self.settings()), [])

    def test_codex_rollout_uses_session_meta_cwd(self):
        day_dir = self.root / "codex" / "sessions" / "2026" / "07" / "18"
        day_dir.mkdir(parents=True)
        rollout = day_dir / "rollout-2026-07-18T10-00-00-abc.jsonl"
        rollout.write_text(json.dumps({
            "timestamp": "2026-07-18T10:00:00Z", "type": "session_meta",
            "payload": {"id": "abc", "cwd": "/Users/x/Red-Quail", "originator": "codex_cli"},
        }))
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["source"], "codex")
        self.assertEqual(agents[0]["name"], "Codex · Red-Quail")

    def test_hermes_source_never_duplicates_roster(self):
        settings = self.settings()
        self.assertIn("hermes", settings["sources"])
        (self.root / "hermes" / "profiles" / "devin").mkdir(parents=True)
        (self.root / "hermes" / "profiles" / "devin" / "profile.yaml").write_text("description: dev")
        self.assertEqual(external_agents.read_external_agents(settings), [])
        self.assertEqual(external_agents.source_counts(settings)["hermes"], 1)

    def test_disabled_hermes_hides_the_roster(self):
        from backend import main
        settings = self.settings()
        settings["sources"]["hermes"]["enabled"] = False
        with patch.object(external_agents, "load_settings", return_value=settings):
            agents = main.read_agents()
        self.assertEqual([a for a in agents if a.get("source") == "hermes"], [])

    def _write_codex_subagent(self, finished: bool = False) -> Path:
        day_dir = self.root / "codex" / "sessions" / "2026" / "07" / "20"
        day_dir.mkdir(parents=True, exist_ok=True)
        rollout = day_dir / "rollout-2026-07-20T10-00-00-sub.jsonl"
        lines = [json.dumps({
            "type": "session_meta",
            "payload": {"id": "sub", "cwd": "/Users/x/Demo",
                        "thread_source": "subagent", "source": {"subagent": {"other": "guardian"}}},
        })]
        if finished:
            lines.append(json.dumps({"type": "event_msg", "payload": {"type": "task_complete"}}))
        rollout.write_text("\n".join(lines))
        return rollout

    def test_live_codex_subagent_becomes_temp_agent_with_own_card(self):
        self._write_codex_subagent()
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 1)
        agent = agents[0]
        self.assertEqual(agent["name"], "Codex temp agent")
        self.assertEqual(agent["status"], "working")
        self.assertTrue(agent["subagent"])
        self.assertEqual(agent["role"], "Codex subagent")
        cards = external_agents.read_external_tasks(self.settings())
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["assignee"], "Codex temp agent")
        self.assertEqual(cards[0]["column"], "in_progress")
        self.assertEqual(cards[0]["status"], "running")

    def test_finished_subagent_thread_disappears(self):
        self._write_codex_subagent(finished=True)
        self.assertEqual(external_agents.read_external_agents(self.settings()), [])
        self.assertEqual(external_agents.read_external_tasks(self.settings()), [])

    def test_claude_sidechain_becomes_temp_agent_next_to_main_session(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Fix the login bug")
        sessions = self.root / "claude" / "projects" / "-Users-x-Demo"
        sidechain = sessions / "side1.jsonl"
        sidechain.write_text("\n".join([
            json.dumps({"type": "user", "isSidechain": True, "cwd": "/Users/x/Demo",
                        "message": {"role": "user", "content": "Explore the repo structure"}}),
            json.dumps({"type": "assistant", "isSidechain": True, "cwd": "/Users/x/Demo",
                        "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {}}]}}),
        ]))
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 2)
        by_name = {agent["name"]: agent for agent in agents}
        self.assertIn("Claude Code temp agent", by_name)
        temp = by_name["Claude Code temp agent"]
        self.assertEqual(temp["status"], "working")
        self.assertTrue(temp["subagent"])
        self.assertEqual(temp["current_task"], "Explore the repo structure")
        main_agent = by_name["Claude Code · Demo"]
        self.assertNotIn("subagent", main_agent)

    def test_disabled_source_is_skipped(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "hello")
        settings = self.settings()
        settings["sources"]["claude"]["enabled"] = False
        self.assertEqual(external_agents.read_external_agents(settings), [])

    def test_sessions_become_task_board_cards(self):
        session = _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Fix the login bug")
        cards = external_agents.read_external_tasks(self.settings())
        self.assertEqual(len(cards), 1)
        card = cards[0]
        self.assertEqual(card["column"], "in_progress")
        self.assertEqual(card["status"], "running")
        self.assertEqual(card["title"], "Fix the login bug")
        self.assertEqual(card["assignee"], "Claude Code")
        self.assertEqual(card["progress_mode"], "active")
        self.assertGreaterEqual(card["progress_value"], 12)

        import os
        hour_ago = time.time() - 3600
        os.utime(session, (hour_ago, hour_ago))
        card = external_agents.read_external_tasks(self.settings())[0]
        self.assertEqual(card["column"], "completed")
        self.assertEqual(card["status"], "done")
        self.assertTrue(card["finished_at"])

    def test_two_active_sessions_become_two_working_agents(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Fix the login bug", session_name="s1")
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Write the docs", session_name="s2")
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 2)
        self.assertEqual({agent["status"] for agent in agents}, {"working"})
        self.assertEqual({agent["current_task"] for agent in agents}, {"Fix the login bug", "Write the docs"})
        self.assertEqual(len({agent["id"] for agent in agents}), 2)
        self.assertEqual(
            sorted(agent["name"] for agent in agents),
            ["Claude Code · Demo (1)", "Claude Code · Demo (2)"],
        )

    def test_finished_turn_moves_to_done_even_while_file_is_fresh(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Ship it", finished=True)
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(agents[0]["status"], "idle")
        card = external_agents.read_external_tasks(self.settings())[0]
        self.assertEqual(card["column"], "completed")
        self.assertEqual(card["status"], "done")
        self.assertEqual(card["progress_value"], 100)
        self.assertTrue(card["finished_at"])

    def test_live_progress_advances_with_elapsed_time(self):
        from datetime import datetime, timezone
        from backend import main

        def iso(seconds_ago):
            return datetime.fromtimestamp(time.time() - seconds_ago, tz=timezone.utc).isoformat()

        fresh = main._task_progress("running", iso(30))["progress_value"]
        older = main._task_progress("running", iso(1800))["progress_value"]
        oldest = main._task_progress("running", iso(24 * 3600))["progress_value"]
        self.assertGreaterEqual(fresh, 46)
        self.assertGreater(older, fresh)
        self.assertGreaterEqual(oldest, older)
        self.assertLess(oldest, 82)

        session_fresh = external_agents._live_session_value(time.time() - 60, time.time())
        session_old = external_agents._live_session_value(time.time() - 3600, time.time())
        self.assertGreater(session_old, session_fresh)
        self.assertLessEqual(session_old, 92)

    def test_settings_round_trip_keeps_only_known_keys(self):
        settings_file = self.root / "settings.json"
        with patch.object(external_agents, "SETTINGS_PATH", settings_file):
            saved = external_agents.save_settings({
                "external_idle_hours": 12,
                "sources": {"codex": {"enabled": False}, "bogus": {"enabled": True}},
                "unknown_key": "ignored",
            })
            self.assertEqual(saved["external_idle_hours"], 12)
            self.assertFalse(saved["sources"]["codex"]["enabled"])
            self.assertNotIn("bogus", saved["sources"])
            self.assertNotIn("unknown_key", saved)

            loaded = external_agents.load_settings()
            self.assertEqual(loaded["external_idle_hours"], 12)
            self.assertFalse(loaded["sources"]["codex"]["enabled"])

    def test_missing_settings_file_returns_defaults(self):
        with patch.object(external_agents, "SETTINGS_PATH", self.root / "nope.json"):
            self.assertEqual(external_agents.load_settings(), external_agents.DEFAULT_SETTINGS)


if __name__ == "__main__":
    unittest.main()


class ClaudeSubagentLayoutTests(unittest.TestCase):
    """Claude Code stores spawned subagents in a per-session `subagents/`
    folder with an `agent-<id>.meta.json` naming the agent type — not as
    sidechain records in the project folder."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.addCleanup(self.temp_dir.cleanup)

    def settings(self):
        settings = json.loads(json.dumps(external_agents.DEFAULT_SETTINGS))
        for name, source in settings["sources"].items():
            source["home"] = str(self.root / name)
        return settings

    def _write_subagent(self, agent_id="agent-abc", meta=None, finished=False):
        folder = self.root / "claude" / "projects" / "-Users-x-Demo" / "sess1" / "subagents"
        folder.mkdir(parents=True, exist_ok=True)
        last = (
            {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}
            if finished else
            {"role": "assistant", "content": [{"type": "tool_use", "name": "Grep", "input": {}}]}
        )
        (folder / f"{agent_id}.jsonl").write_text("\n".join([
            json.dumps({"type": "user", "isSidechain": True, "cwd": "/Users/x/Demo",
                        "message": {"role": "user", "content": "Audit the parser"}}),
            json.dumps({"type": "assistant", "isSidechain": True, "cwd": "/Users/x/Demo",
                        "message": last}),
        ]))
        if meta is not None:
            (folder / f"{agent_id}.meta.json").write_text(json.dumps(meta))
        return folder / f"{agent_id}.jsonl"

    def test_subagent_folder_is_discovered_and_named_from_its_meta(self):
        self._write_subagent(meta={"agentType": "caveman:cavecrew-reviewer",
                                   "description": "Review backend diff"})
        agents = external_agents.read_external_agents(self.settings())
        self.assertEqual(len(agents), 1)
        agent = agents[0]
        self.assertTrue(agent["subagent"])
        self.assertEqual(agent["status"], "working")
        self.assertEqual(agent["name"], "Claude Code · cavecrew reviewer")
        self.assertEqual(agent["current_task"], "Review backend diff")

        card = external_agents.read_external_tasks(self.settings())[0]
        self.assertEqual(card["assignee"], "Claude Code · cavecrew reviewer")
        self.assertEqual(card["title"], "Review backend diff")
        self.assertEqual(card["column"], "in_progress")

    def test_subagent_without_meta_falls_back_to_the_generic_temp_name(self):
        self._write_subagent(meta=None)
        agent = external_agents.read_external_agents(self.settings())[0]
        self.assertEqual(agent["name"], "Claude Code temp agent")
        self.assertEqual(agent["current_task"], "Audit the parser")

    def test_finished_subagent_disappears(self):
        self._write_subagent(meta={"agentType": "explore"}, finished=True)
        self.assertEqual(external_agents.read_external_agents(self.settings()), [])
        self.assertEqual(external_agents.read_external_tasks(self.settings()), [])


class ExternalProjectRoomTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.addCleanup(self.temp_dir.cleanup)

    def settings(self):
        settings = json.loads(json.dumps(external_agents.DEFAULT_SETTINGS))
        for name, source in settings["sources"].items():
            source["home"] = str(self.root / name)
        return settings

    def test_live_session_becomes_an_active_project_room(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Fix the login bug")
        rooms = external_agents.read_external_project_rooms(self.settings())
        self.assertEqual(len(rooms), 1)
        room = rooms[0]
        self.assertEqual(room["name"], "Demo")
        self.assertEqual(room["project_id"], "Demo")
        self.assertEqual(room["status"], "active")
        self.assertEqual(room["agents"], ["Claude Code"])
        self.assertEqual(room["tasks"][0]["title"], "Fix the login bug")

    def test_finished_session_room_is_completed(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Ship it", finished=True)
        room = external_agents.read_external_project_rooms(self.settings())[0]
        self.assertEqual(room["status"], "completed")
        self.assertEqual(room["progress"], 100)

    def test_sessions_group_by_project_directory(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "Task A", session_name="a")
        _write_claude_session(self.root / "claude", "-Users-x-Other", "/Users/x/Other", "Task B", session_name="b")
        rooms = external_agents.read_external_project_rooms(self.settings())
        self.assertEqual({room["name"] for room in rooms}, {"Demo", "Other"})

    def test_no_external_sessions_means_no_rooms(self):
        self.assertEqual(external_agents.read_external_project_rooms(self.settings()), [])
