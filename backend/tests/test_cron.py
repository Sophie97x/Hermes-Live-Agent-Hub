import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


class CronJobsTests(unittest.TestCase):
    def test_current_hermes_schedule_shape_is_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs_file = Path(directory) / "jobs.json"
            jobs_file.write_text(json.dumps({"jobs": [{
                "id": "watchdog",
                "name": "Health watchdog",
                "enabled": True,
                "state": "scheduled",
                "schedule": {"kind": "interval", "minutes": 5, "display": "every 5m"},
                "last_run_at": "2026-07-16T09:00:00Z",
                "next_run_at": "2026-07-16T09:05:00Z",
                "last_status": "ok",
                "repeat": {"completed": 3},
            }]}))

            with patch.object(main, "CRON_JOBS", jobs_file):
                job = main.read_cron()[0]

        self.assertEqual(job["schedule"], "every 5m")
        self.assertEqual(job["status"], "scheduled")
        self.assertEqual(job["last_run"], "2026-07-16T09:00:00Z")
        self.assertEqual(job["next_run"], "2026-07-16T09:05:00Z")
        self.assertEqual(job["runs_completed"], 3)


if __name__ == "__main__":
    unittest.main()
