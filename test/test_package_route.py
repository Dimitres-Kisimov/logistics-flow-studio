import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import order_store
import package_route
import transport_store

ROOT = Path(__file__).resolve().parents[1]

class PackageRouteTests(unittest.TestCase):
    def setUp(self):
        self.db = order_store.connect(":memory:")
        transport_store.demo(self.db)
        self.floor = json.loads((ROOT / "examples/routes/floor.json").read_text())
        self.graph = json.loads((ROOT / "examples/routes/graph.json").read_text())
        self.access = {"PICK-FACE": "PICK-ACCESS", "PACK-BENCH": "PACK-ACCESS"}

    def tearDown(self):
        self.db.close()

    def run_scenario(self, package="PACKAGE-1"):
        return package_route.scenario(self.db, package, self.floor, self.graph, self.access, "worker", .3, 1, 5, 3)

    def test_snapshot_identity_and_no_execution_writes(self):
        before = "\n".join(self.db.iterdump())
        result = self.run_scenario()
        self.assertEqual(result["package_snapshot"]["order_id"], "ORDER-A")
        self.assertEqual(result["package_snapshot"]["version"], 7)
        self.assertEqual(result["duration_s"], 20.7)
        self.assertEqual(result["location_access"], self.access)
        self.assertEqual(before, "\n".join(self.db.iterdump()))
        self.assertEqual(result, self.run_scenario())

    def test_unknown_package_and_incomplete_or_ambiguous_access(self):
        with self.assertRaises(ValueError):
            self.run_scenario("missing")
        for access in [{}, {"PICK-FACE": "PICK-ACCESS"},
                       {"PICK-FACE": "PICK-ACCESS", "PACK-BENCH": "PICK-ACCESS"},
                       {"PICK-FACE": "PICK-ACCESS", "PACK-BENCH": "unknown"}]:
            self.access = access
            with self.subTest(access=access), self.assertRaises(ValueError):
                self.run_scenario()


if __name__ == "__main__":
    unittest.main()
