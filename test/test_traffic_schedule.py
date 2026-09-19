import copy
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import traffic_schedule


class TrafficScheduleTests(unittest.TestCase):
    def fixture(self, capacity=1, horizon=20):
        return dict(schema="factory-area-requests/v1", horizon_s=horizon,
                    areas=[dict(id="Z", capacity=capacity)],
                    requests=[dict(id="A", release_s=0, duration_s=4, areas=["Z"]),
                              dict(id="B", release_s=1, duration_s=3, areas=["Z"])])

    def test_exclusive_crossing_and_exact_boundary(self):
        result = traffic_schedule.schedule(self.fixture())
        a, b = result["requests"]
        self.assertEqual((a["planned_start_s"], a["planned_end_s"]), (0, 4))
        self.assertEqual((b["planned_start_s"], b["planned_end_s"], b["planned_wait_s"]), (4, 7, 3))
        self.assertEqual(b["explanations"][0]["conflicts"][0]["holders"], ["A"])
        at_four = [e["kind"] for e in result["events"] if e["at_s"] == 4]
        self.assertEqual(at_four, ["released", "granted"])

    def test_capacity_two_and_horizon_conservation(self):
        raw = self.fixture(capacity=2)
        raw["requests"].append(dict(id="C", release_s=2, duration_s=2, areas=["Z"]))
        result = traffic_schedule.schedule(raw)
        self.assertEqual([r["planned_start_s"] for r in result["requests"]], [0, 1, 4])
        result = traffic_schedule.schedule(self.fixture(horizon=3))
        self.assertEqual((result["completed"], result["unfinished"]), (0, 2))
        self.assertEqual(result["requests"][1]["state_at_horizon"], "queued")
        self.assertEqual(result["requests"][1]["observed_wait_s"], 2)
        self.assertTrue(all(e["at_s"] <= 3 for e in result["events"]))

    def test_atomic_multiple_areas_and_determinism(self):
        raw = self.fixture()
        raw["areas"].append(dict(id="Q", capacity=1))
        raw["requests"][0]["areas"] = ["Z", "Q"]
        raw["requests"][1]["areas"] = ["Q", "Z"]
        before = copy.deepcopy(raw)
        result = traffic_schedule.schedule(raw)
        self.assertEqual(result["requests"][1]["planned_start_s"], 4)
        self.assertEqual(len(result["requests"][1]["explanations"][0]["conflicts"]), 2)
        self.assertEqual(raw, before)
        raw["requests"].reverse()
        self.assertEqual(result, traffic_schedule.schedule(raw))

    def test_future_reservation_conflict_and_priority_ties(self):
        raw = self.fixture()
        raw["areas"].append(dict(id="Q", capacity=1))
        raw["requests"] = [dict(id="A", release_s=0, duration_s=10, areas=["Q"]),
                           dict(id="B", release_s=0, duration_s=5, areas=["Q", "Z"]),
                           dict(id="C", release_s=1, duration_s=12, areas=["Z"])]
        result = traffic_schedule.schedule(raw)
        self.assertEqual([r["planned_start_s"] for r in result["requests"]], [0, 10, 15])
        raw = self.fixture()
        raw["requests"][1].update(release_s=0, priority=1)
        self.assertEqual(traffic_schedule.schedule(raw)["requests"][0]["id"], "B")

    def test_reject_invalid_requests(self):
        for field, value in [("duration_s", 0), ("release_s", -1), ("priority", True), ("areas", ["missing"]), ("areas", ["Z", "Z"])]:
            raw = self.fixture()
            raw["requests"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                traffic_schedule.schedule(raw)

    def test_capacity_invariant_across_seeded_overlaps(self):
        rng = random.Random(7)
        raw = self.fixture(capacity=2, horizon=1000)
        raw["areas"].append(dict(id="Q", capacity=3))
        raw["requests"] = [dict(id=f"R{i}", release_s=rng.randrange(20), duration_s=rng.randrange(1, 10),
                                areas=rng.choice([["Z"], ["Q"], ["Q", "Z"]])) for i in range(80)]
        result = traffic_schedule.schedule(raw)
        for area in raw["areas"]:
            rows = [r for r in result["requests"] if area["id"] in r["areas"]]
            for at in {r["planned_start_s"] for r in rows} | {r["planned_end_s"] for r in rows}:
                self.assertLessEqual(sum(r["planned_start_s"] <= at < r["planned_end_s"] for r in rows), area["capacity"])
        self.assertEqual(result["completed"], 80)
        self.assertEqual(result["unfinished"], 0)

    def test_timeline_binding_requires_matching_duration_and_unbound_route(self):
        result = traffic_schedule.schedule(self.fixture())
        timeline = dict(schema="factory-route-timeline/v1", route=dict(found=True), duration_s=3)
        bound = traffic_schedule.bind_timeline(timeline, result, "B")
        self.assertEqual(bound["reservation"]["request_id"], "B")
        self.assertNotIn("reservation", timeline)
        for source, key in [(timeline, "A"), (timeline, "missing"), (bound, "B")]:
            with self.assertRaises(ValueError):
                traffic_schedule.bind_timeline(source, result, key)

    def test_nonpreemptive_availability_and_infeasible_request(self):
        raw = self.fixture(horizon=30)
        raw["requests"] = [dict(id="A", release_s=8, duration_s=6, areas=["Z"], availability_s=[[0, 10], [20, 30]]),
                           dict(id="B", release_s=9, duration_s=11, areas=["Z"], availability_s=[[0, 10], [20, 30]])]
        a, b = traffic_schedule.schedule(raw)["requests"]
        self.assertEqual((a["planned_start_s"], a["planned_end_s"]), (20, 26))
        self.assertEqual(b["state_at_horizon"], "unscheduled")
        self.assertIsNone(b["planned_start_s"])

    def test_area_delay_rechecks_window_and_exact_shift_end(self):
        raw = self.fixture(horizon=30)
        raw["requests"][0]["duration_s"] = 8
        raw["requests"][1].update(duration_s=4, availability_s=[[0, 10], [20, 24]])
        result = traffic_schedule.schedule(raw)
        self.assertEqual((result["requests"][1]["planned_start_s"], result["requests"][1]["planned_end_s"]), (20, 24))
        self.assertEqual(result["completed"], 2)
        raw["requests"][1]["availability_s"] = []
        result = traffic_schedule.schedule(raw)
        self.assertEqual((result["completed"], result["unfinished"]), (1, 1))
        self.assertFalse(any(e["kind"] == "granted" and e["request_id"] == "B" for e in result["events"]))

    def test_reject_malformed_availability(self):
        for windows in [None, [[4, 3]], [[0, 4], [3, 8]], [[True, 4]], [[0, float("inf")]], "always"]:
            raw = self.fixture()
            raw["requests"][0]["availability_s"] = windows
            with self.subTest(windows=windows), self.assertRaises(ValueError):
                traffic_schedule.schedule(raw)


if __name__ == "__main__":
    unittest.main()
