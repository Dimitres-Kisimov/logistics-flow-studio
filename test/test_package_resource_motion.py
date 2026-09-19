import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import order_store
import package_resource_motion as motion
import transport_store

ROOT = Path(__file__).resolve().parents[1]


class PackageResourceMotionTests(unittest.TestCase):
    def setUp(self):
        self.db = order_store.connect(":memory:")
        transport_store.demo(self.db)
        self.floor = json.loads((ROOT / "examples/routes/floor.json").read_text())
        self.graph = json.loads((ROOT / "examples/routes/graph.json").read_text())
        self.raw = dict(schema="factory-package-resource-input/v1", horizon_s=60, mode="worker", speed_mps=1,
                        clearance_m=.3, location_access={"PICK-FACE": "PICK-ACCESS", "PACK-BENCH": "PACK-ACCESS"},
                        resources=[dict(id="PLANNED-WORKER", skills=["pick"], start_location="PICK-FACE", availability_s=[[0,60]])],
                        reposition=[], jobs=[dict(id="JOB-1", package_id="PACKAGE-1", expected_version=7, release_s=5,
                                                  required_skills=["pick"], loading_s=5, unloading_s=3)])

    def tearDown(self):
        self.db.close()

    def test_snapshot_derived_endpoints_and_no_writes(self):
        before = "\n".join(self.db.iterdump())
        request = copy.deepcopy(self.raw)
        result = motion.build(self.db, self.raw, self.floor, self.graph)
        self.assertEqual(result["plan"]["jobs"][0]["source"], "PICK-FACE")
        self.assertEqual(result["package_bindings"][0]["package_snapshot"]["quantity"], 4)
        self.assertEqual(result["source_ledger"]["packages"][0]["state"], "delivered")
        self.assertEqual(result["plan"]["jobs"][0]["resource_id"], "PLANNED-WORKER")
        self.assertEqual(result, motion.build(self.db, self.raw, self.floor, self.graph))
        self.assertEqual(request, self.raw)
        self.assertEqual(before, "\n".join(self.db.iterdump()))

    def test_stale_unknown_duplicate_and_endpoint_override(self):
        for change in [lambda r: r["jobs"][0].update(expected_version=6),
                       lambda r: r["jobs"][0].update(package_id="missing"),
                       lambda r: r["jobs"].append(dict(r["jobs"][0], id="JOB-2")),
                       lambda r: r["jobs"][0].update(source="other")]:
            raw = copy.deepcopy(self.raw)
            change(raw)
            with self.assertRaises(ValueError):
                motion.build(self.db, raw, self.floor, self.graph)
        self.assertFalse(self.db.in_transaction)

    def test_selected_package_history_only_and_multi_package_plan(self):
        order_store.reserve(self.db, "PICK-2", "LINE-A", 1)
        order_store.complete(self.db, "PICK-2", "PICK-EVENT-2", "2026-09-19T11:00:00Z")
        transport_store.create_package(self.db, "PACKAGE-2", "PICK-2", "PICK-FACE", "PACK-BENCH", "NEW-2", "2026-09-19T11:00:00Z")
        one = motion.build(self.db, self.raw, self.floor, self.graph)
        self.assertEqual([p["id"] for p in one["source_ledger"]["packages"]], ["PACKAGE-1"])
        self.assertTrue(all(e["package_id"] == "PACKAGE-1" for e in one["source_ledger"]["events"]))
        self.raw["jobs"].append(dict(self.raw["jobs"][0], id="JOB-2", package_id="PACKAGE-2", expected_version=0))
        two = motion.build(self.db, self.raw, self.floor, self.graph)
        self.assertEqual(len(two["package_bindings"]), 2)
        self.assertEqual(two["plan"]["jobs"][1]["state_at_horizon"], "unscheduled")


if __name__ == "__main__":
    unittest.main()
