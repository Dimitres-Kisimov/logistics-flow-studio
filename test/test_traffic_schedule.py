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


if __name__ == "__main__":
    unittest.main()
