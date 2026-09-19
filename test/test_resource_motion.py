import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import resource_motion as motion
import route_plan


class ResourceMotionTests(unittest.TestCase):
    def setUp(self):
        self.floor = dict(version="wt-1", gridW=20, gridH=20, cell=1, elements=[])
        self.graph = dict(schema="factory-route-graph/v1",
                          floor_digest=route_plan.floor_digest(route_plan.floor_model(self.floor)),
                          nodes=[dict(id="a", x=2, y=2), dict(id="b", x=8, y=2)],
                          edges=[{"from": a, "to": b, "modes": ["worker"]} for a, b in [("a", "b"), ("b", "a")]])
        self.raw = dict(schema="factory-resource-motion-input/v1", horizon_s=30,
                        mode="worker", speed_mps=2, clearance_m=.5, location_access={"A": "a", "B": "b"},
                        resources=[dict(id="R", skills=["pick"], start_location="A", availability_s=[[0, 30]])],
                        reposition=[dict(resource_id="R", **{"from": "B", "to": "A"})],
                        jobs=[dict(id=key, release_s=0, source="A", destination="B", required_skills=["pick"],
                                   loading_s=1, unloading_s=1) for key in ["J1", "J2"]])

    def test_geometry_drives_time_and_return_motion(self):
        before = copy.deepcopy(self.raw)
        bundle = motion.build(self.raw, self.floor, self.graph)
        a, b = bundle["plan"]["jobs"]
        self.assertEqual((a["end_s"], b["task_start_s"], b["end_s"]), (5, 8, 13))
        outbound = motion.sample(bundle, 2)
        self.assertEqual(outbound["resources"][0]["position"], dict(x=4, y=2))
        self.assertEqual(outbound["resources"][0]["position"], outbound["loads"][0]["position"])
        returning = motion.sample(bundle, 6)
        self.assertEqual(returning["resources"][0]["state"], "repositioning")
        self.assertEqual(returning["resources"][0]["position"], dict(x=6, y=2))
        self.assertEqual(returning["loads"][1]["position"], dict(x=2, y=2))
        self.assertEqual(returning["loads"][1]["state"], "waiting")
        self.assertEqual(motion.sample(bundle, 8)["resources"][0]["state"], "loading")
        self.assertEqual(motion.sample(bundle, 13)["resources"][0]["state"], "idle")
        self.assertEqual(motion.sample(bundle, 31)["elapsed_s"], 30)
        self.assertEqual(self.raw, before)
        self.assertEqual(bundle, motion.build(self.raw, self.floor, self.graph))

    def test_no_teleport_when_return_not_declared(self):
        self.raw["reposition"] = []
        bundle = motion.build(self.raw, self.floor, self.graph)
        state = motion.sample(bundle, 20)
        self.assertEqual(state["loads"][1]["state"], "unscheduled")
        self.assertEqual(state["resources"][0]["position"], dict(x=8, y=2))

    def test_calendar_wait_stays_at_previous_destination(self):
        self.raw["resources"][0]["availability_s"] = [[0, 6], [20, 30]]
        bundle = motion.build(self.raw, self.floor, self.graph)
        self.assertEqual(bundle["plan"]["jobs"][1]["assignment_start_s"], 20)
        self.assertEqual(motion.sample(bundle, 10)["resources"][0]["state"], "off-shift")
        self.assertEqual(motion.sample(bundle, 10)["resources"][0]["position"], dict(x=8, y=2))

    def test_unreachable_or_stale_geometry_rejected(self):
        self.graph["edges"].pop()
        with self.assertRaisesRegex(ValueError, "No screened directed route"):
            motion.build(self.raw, self.floor, self.graph)
        self.floor["gridW"] = 21
        with self.assertRaises(ValueError):
            motion.build(self.raw, self.floor, self.graph)

    def test_shared_area_wait_holds_worker_and_load_at_source(self):
        self.raw["resources"].append(dict(id="R2", skills=["pick"], start_location="A", availability_s=[[0, 30]]))
        self.raw["areas"] = [dict(id="AISLE", capacity=1)]
        for job in self.raw["jobs"]:
            job["areas"] = ["AISLE"]
        bundle = motion.build(self.raw, self.floor, self.graph)
        second = bundle["plan"]["jobs"][1]
        self.assertEqual((second["resource_id"], second["assignment_start_s"]), ("R2", 5))
        pose = motion.sample(bundle, 4)
        self.assertEqual(pose["resources"][1]["state"], "idle")
        self.assertEqual(pose["resources"][1]["position"], pose["loads"][1]["position"])

    def test_duration_override_and_aliased_locations_rejected(self):
        self.raw["jobs"][0]["duration_s"] = 1
        with self.assertRaisesRegex(ValueError, "derived"):
            motion.build(self.raw, self.floor, self.graph)
        del self.raw["jobs"][0]["duration_s"]
        self.raw["location_access"]["B"] = "a"
        with self.assertRaisesRegex(ValueError, "Distinct locations"):
            motion.build(self.raw, self.floor, self.graph)


if __name__ == "__main__":
    unittest.main()
