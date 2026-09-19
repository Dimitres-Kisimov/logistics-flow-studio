import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import resource_dispatch
import resource_report


class ResourceReportTests(unittest.TestCase):
    def test_exports_preserve_plan_escape_markup_and_neutralize_formulas(self):
        raw = json.loads((Path(__file__).resolve().parents[1] / "examples/routes/joint-resource-jobs.json").read_text())
        raw["jobs"][0]["id"] = '=1+1<script>alert("x")</script>'
        plan = resource_dispatch.dispatch(raw)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            resource_report.write_report(plan, path)
            self.assertEqual(json.loads((path / "plan.json").read_text()), plan)
            html = (path / "index.html").read_text()
            self.assertNotIn("<script>", html)
            self.assertIn("&lt;script&gt;", html)
            with (path / "assignments.csv").open(newline="") as file:
                rows = list(csv.DictReader(file))
            self.assertTrue(rows[0]["id"].startswith("'=1+1"))
            self.assertEqual(rows[1]["assignment_start_s"], "4.0")
            before = {p.name: p.read_bytes() for p in path.iterdir()}
            resource_report.write_report(plan, path)
            self.assertEqual(before, {p.name: p.read_bytes() for p in path.iterdir()})


if __name__ == "__main__":
    unittest.main()
