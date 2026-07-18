import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import external_agents


def _write_claude_session(home: Path, project_dir: str, cwd: str, text: str) -> Path:
    sessions = home / "projects" / project_dir
    sessions.mkdir(parents=True)
    session = sessions / "abc123.jsonl"
    session.write_text("\n".join([
        json.dumps({"type": "mode", "mode": "normal"}),
        json.dumps({"type": "user", "cwd": cwd, "message": {"role": "user", "content": text}}),
        json.dumps({"type": "assistant", "cwd": cwd, "message": {"role": "assistant", "content": "ok"}}),
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

    def test_disabled_source_is_skipped(self):
        _write_claude_session(self.root / "claude", "-Users-x-Demo", "/Users/x/Demo", "hello")
        settings = self.settings()
        settings["sources"]["claude"]["enabled"] = False
        self.assertEqual(external_agents.read_external_agents(settings), [])

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
