import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import route_plan as route


class RoutePlanTests(unittest.TestCase):
    def setUp(self):
        self.floor = dict(version="wt-1", gridW=20, gridH=20, cell=.5,
                          elements=[dict(id="machine", x=8, y=6, w=4, d=8)])
        self.graph = dict(schema="factory-route-graph/v1", floor_digest=route.floor_digest(route.floor_model(self.floor)),
                          nodes=[dict(id="a", x=2, y=5), dict(id="b", x=2, y=2),
                                 dict(id="c", x=8, y=2), dict(id="d", x=8, y=5)],
                          edges=[])
        self.graph["edges"] = [{"from": a, "to": b, "modes": ["worker"]}
                               for a, b in [("a", "d"), ("a", "b"), ("b", "c"), ("c", "d")]]

    def run_plan(self, **kwargs):
        return route.plan(self.floor, self.graph, kwargs.get("start", "a"), kwargs.get("destination", "d"),
                          kwargs.get("mode", "worker"), kwargs.get("clearance", .5))

    def test_shortest_declared_detour_and_nonmutation(self):
        before = copy.deepcopy((self.floor, self.graph))
        result = self.run_plan()
        self.assertTrue(result["found"])
        self.assertEqual(result["distance_m"], 12)
        self.assertEqual([p["id"] for p in result["points"]], ["a", "b", "c", "d"])
        self.assertEqual(result["rejected_edges"][0]["reason"], "equipment:machine")
        self.assertEqual(result, self.run_plan())
        self.assertEqual((self.floor, self.graph), before)

    def test_one_way_mode_clearance_and_contact(self):
        self.assertFalse(self.run_plan(start="d", destination="a")["found"])
        self.assertFalse(self.run_plan(mode="forklift")["found"])
        self.assertFalse(self.run_plan(clearance=1)["found"])
        self.assertTrue(self.run_plan(clearance=.999)["found"])

    def test_bad_graph_and_stale_floor(self):
        self.floor["elements"][0]["x"] += 1
        with self.assertRaises(ValueError):
            self.run_plan()
        self.setUp()
        self.graph["edges"].append(copy.deepcopy(self.graph["edges"][0]))
        with self.assertRaises(ValueError):
            self.run_plan()

    def test_access_point_inside_equipment_is_not_teleported(self):
        self.graph["nodes"][0].update(x=5, y=5)
        result = self.run_plan()
        self.assertFalse(result["found"])
        self.assertEqual(result["reason"], "equipment:machine")
        self.assertEqual(result["points"], [])

    def test_segment_rectangle_geometry(self):
        box = dict(x=2, y=2, w=2, d=2)
        self.assertTrue(route.intersects(dict(x=0, y=0), dict(x=6, y=6), box, 0))
        self.assertTrue(route.intersects(dict(x=0, y=2), dict(x=6, y=2), box, 0))
        self.assertFalse(route.intersects(dict(x=0, y=1), dict(x=6, y=1), box, 0))
        self.assertTrue(route.intersects(dict(x=0, y=1), dict(x=6, y=1), box, 1))
        self.assertFalse(route.intersects(dict(x=0, y=0), dict(x=0, y=6), box, 0))

    def test_reserved_area_invalidates_graph_and_blocks_detour_in_metres(self):
        self.floor["placementConstraintDraft"] = json.dumps(dict(zones=[dict(x=4, y=1, w=1, d=1)]))
        with self.assertRaises(ValueError):
            self.run_plan()
        self.graph["floor_digest"] = route.floor_digest(route.floor_model(self.floor))
        result = self.run_plan()
        self.assertFalse(result["found"])
        self.assertIn("reserved-area:1", [edge["reason"] for edge in result["rejected_edges"]])
        self.assertEqual(result["points"], [])

    def test_invalid_reserved_draft_never_silently_ignored(self):
        for draft in [None, "broken", "[]", '{"zones":null}', '{"unknown":[]}',
                      '{"zones":[{"x":9,"y":1,"w":2,"d":1}]}',
                      '{"zones":[{"x":true,"y":1,"w":2,"d":1}]}',
                      '{"fixedIds":["missing"]}']:
            with self.subTest(draft=draft):
                self.floor["placementConstraintDraft"] = draft
                with self.assertRaises(ValueError):
                    self.run_plan()

    def test_empty_draft_compatibility_and_area_order_independence(self):
        original = route.floor_digest(route.floor_model(self.floor))
        self.floor["placementConstraintDraft"] = '{"fixedIds":["machine"],"zones":[]}'
        self.assertEqual(original, route.floor_digest(route.floor_model(self.floor)))
        zones = [dict(x=1, y=1, w=1, d=1), dict(x=8, y=8, w=1, d=1)]
        self.floor["placementConstraintDraft"] = json.dumps(dict(zones=zones))
        digest = route.floor_digest(route.floor_model(self.floor))
        self.floor["placementConstraintDraft"] = json.dumps(dict(zones=zones[::-1]))
        self.assertEqual(digest, route.floor_digest(route.floor_model(self.floor)))


if __name__ == "__main__":
    unittest.main()
