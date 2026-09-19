"""Independent arithmetic and adverse-input checks for resource screening."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("resource_plan", ROOT / "tools/resource_plan.py")
planner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planner)


class ResourcePlanTests(unittest.TestCase):
    def fixture(self, name="assembly-warehouse"):
        return json.loads((ROOT / "examples" / f"resource-{name}.json").read_text())

    def test_hand_calculated_assembly(self):
        data = self.fixture()
        before = copy.deepcopy(data)
        result = planner.evaluate(data)
        self.assertEqual(result["staffing"][0]["labourMinutes"], 960)
        self.assertEqual(result["staffing"][0]["workerLowerBound"], 3)
        self.assertEqual(result["staffing"][1]["workerLowerBound"], 1)
        self.assertEqual(result["inventory"][0]["closing"], -10)
        self.assertEqual(result["inventory"][0]["status"], "shortage")
        self.assertEqual(result["electricity"][0]["residualKWh"], 0)
        self.assertEqual(result["electricityTotals"]["netImportKWh"], 80)
        self.assertEqual(result["picking"]["picksPerProductiveLabourHour"], 50)
        self.assertEqual(result["picking"]["picksPerPaidLabourHour"], 40)
        self.assertEqual(data, before)

    def test_process_residual_is_not_hidden(self):
        result = planner.evaluate(self.fixture("process-manufacturing"))
        self.assertEqual(result["inventory"][0]["closing"], 470)
        self.assertEqual(result["inventory"][0]["availableAtClose"], 370)
        self.assertEqual(result["electricity"][1]["residualKWh"], 3)
        self.assertEqual(result["electricity"][1]["status"], "unreconciled")
        self.assertEqual(result["electricityTotals"]["netImportKWh"], 355)
        self.assertIsNone(result["picking"])

    def test_missing_is_not_zero(self):
        data = self.fixture()
        del data["electricity"][0]["loadKWh"]
        with self.assertRaises(KeyError):
            planner.evaluate(data)

    def test_invalid_numbers_and_empty_shift(self):
        for value in (-1, float("nan"), float("inf"), True, "300"):
            data = self.fixture()
            data["orders"][0]["quantity"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                planner.evaluate(data)
        data = self.fixture()
        data["shift"]["breakMinutes"] = 480
        with self.assertRaises(ValueError):
            planner.evaluate(data)

    def test_duplicate_inventory_and_overlapping_intervals(self):
        data = self.fixture()
        data["inventory"].append(copy.deepcopy(data["inventory"][0]))
        with self.assertRaises(ValueError):
            planner.evaluate(data)
        data = self.fixture("process-manufacturing")
        data["electricity"][1]["startMinute"] = 200
        with self.assertRaises(ValueError):
            planner.evaluate(data)

    def test_deterministic_exports_and_escaping(self):
        data = self.fixture()
        data["orders"][0]["id"] = '=HYPERLINK("bad")<script>'
        report = planner.evaluate(data)
        with tempfile.TemporaryDirectory(dir=ROOT.parent) as directory:
            target = Path(directory)
            planner.export(report, target / "a")
            planner.export(report, target / "b")
            for path in (target / "a").iterdir():
                self.assertEqual(path.read_bytes(), (target / "b" / path.name).read_bytes())
            self.assertIn("'=HYPERLINK", (target / "a/orders.csv").read_text(encoding="utf-8-sig"))
            page = (target / "a/resource-plan.html").read_text(encoding="utf-8")
            self.assertNotIn("<script>", page)
            self.assertIn("&lt;script&gt;", page)

    def test_empty_data_does_not_leave_stale_csv(self):
        data = self.fixture()
        with tempfile.TemporaryDirectory(dir=ROOT.parent) as directory:
            target = Path(directory)
            planner.export(planner.evaluate(data), target)
            data["electricity"] = []
            report = planner.evaluate(data)
            planner.export(report, target)
            self.assertEqual(report["electricityTotals"]["status"], "not-assessed")
            self.assertEqual(len((target / "electricity.csv").read_text().splitlines()), 1)
            self.assertIn("no intervals supplied", (target / "resource-plan.html").read_text())


if __name__ == "__main__":
    unittest.main()
