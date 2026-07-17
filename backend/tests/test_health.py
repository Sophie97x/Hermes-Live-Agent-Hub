import os
import time
import unittest
from unittest.mock import patch

from backend import main


class HealthTests(unittest.TestCase):
    def test_health_reports_stuck_agents_and_failed_schedules(self):
        now = time.time()
        agents = [{
            "id": "devin", "name": "Devin", "status": "waiting",
            "status_reason": "stale_heartbeat", "task_id": "task-1",
        }]
        jobs = [{
            "id": "job-1", "name": "Nightly", "enabled": True,
            "next_run": now - 600, "last_status": "failed",
            "last_error": "worker stopped",
        }]
        gateway = {"gateway_state": "running", "pid": os.getpid()}

        with patch.object(main, "read_agents", return_value=agents), \
             patch.object(main, "read_cron", return_value=jobs), \
             patch.object(main, "read_gateway", return_value=gateway):
            health = main.read_health()

        self.assertEqual(health["status"], "degraded")
        self.assertEqual(len(health["stuck_jobs"]), 2)
        self.assertEqual({item["level"] for item in health["alerts"]}, {"warning", "error"})

    def test_idle_system_is_healthy(self):
        gateway = {"gateway_state": "running", "pid": os.getpid()}
        with patch.object(main, "read_agents", return_value=[]), \
             patch.object(main, "read_cron", return_value=[]), \
             patch.object(main, "read_gateway", return_value=gateway):
            health = main.read_health()

        self.assertEqual(health["status"], "healthy")
        self.assertEqual(health["alerts"], [])


if __name__ == "__main__":
    unittest.main()
