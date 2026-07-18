import tempfile
import unittest
from pathlib import Path

from backend import main


class ReadOnlyQueryTests(unittest.TestCase):
    def test_query_never_creates_a_missing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "state.db"
            rows = main._query(missing, "SELECT 1")
            self.assertEqual(rows, [])
            self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
