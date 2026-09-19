import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import resource_dispatch


class DispatchTests(unittest.TestCase):
    def fixture(self):
        return dict(schema="factory-resource-jobs/v1", horizon_s=30,
                    resources=[dict(id="R", skills=["pick"], start_location="A", availability_s=[[0, 10], [20, 30]])],
                    reposition=[dict(resource_id="R", **{"from": "B", "to": "A"}, seconds=2)],
                    jobs=[dict(id="J1", release_s=0, duration_s=4, source="A", destination="B", required_skills=["pick"]),
                          dict(id="J2", release_s=1, duration_s=6, source="A", destination="B", required_skills=["pick"])])

    def test_exclusive_resource_reposition_and_shift_fit(self):
        result = resource_dispatch.dispatch(self.fixture())
        a, b = result["jobs"]
        self.assertEqual(a["end_s"], 4)
        self.assertEqual((b["assignment_start_s"], b["task_start_s"], b["end_s"]), (20, 22, 28))
        self.assertEqual(b["reposition_from"], "B")
        self.assertEqual(result["completed"], 2)

    def test_missing_skill_and_travel_are_not_assumed(self):
        raw = self.fixture()
        raw["reposition"] = []
        raw["jobs"].append(dict(id="J3", release_s=2, duration_s=1, source="A", destination="A", required_skills=["weld"]))
        result = resource_dispatch.dispatch(raw)
        self.assertEqual(result["unfinished"], 2)
        self.assertEqual(result["jobs"][1]["rejected_resources"][0]["reason"], "missing-reposition-time")
        self.assertEqual(result["jobs"][2]["rejected_resources"][0]["skills"], ["weld"])

    def test_earliest_finish_choice_and_nonmutation(self):
        raw = self.fixture()
        raw["resources"].append(dict(id="R2", skills=["pick"], start_location="A", availability_s=[[0, 30]]))
        before = copy.deepcopy(raw)
        result = resource_dispatch.dispatch(raw)
        self.assertEqual([job["resource_id"] for job in result["jobs"]], ["R", "R2"])
        self.assertEqual(result["jobs"][1]["end_s"], 7)
        self.assertEqual(raw, before)
        self.assertEqual(result, resource_dispatch.dispatch(raw))

    def test_horizon_and_bad_calendars(self):
        raw = self.fixture()
        raw["horizon_s"] = 21
        self.assertEqual(resource_dispatch.dispatch(raw)["jobs"][1]["state_at_horizon"], "repositioning")
        raw["resources"][0]["availability_s"] = [[0, 10], [9, 30]]
        with self.assertRaises(ValueError):
            resource_dispatch.dispatch(raw)

    def test_shared_area_delays_otherwise_available_resource(self):
        raw = self.fixture()
        raw["resources"].append(dict(id="R2", skills=["pick"], start_location="A", availability_s=[[0, 30]]))
        raw["areas"] = [dict(id="CROSSING", capacity=1)]
        for job in raw["jobs"]:
            job["areas"] = ["CROSSING"]
        result = resource_dispatch.dispatch(raw)
        b = result["jobs"][1]
        self.assertEqual((b["resource_id"], b["assignment_start_s"], b["end_s"]), ("R2", 4, 10))
        self.assertEqual(b["area_waits"][0]["conflicts"][0]["holders"], ["J1"])
        self.assertEqual(len(result["areas"][0]["reservations"]), 2)

    def test_area_delay_rechecks_resource_calendar_and_capacity_two(self):
        raw = self.fixture()
        raw["resources"].append(dict(id="R2", skills=["pick"], start_location="A", availability_s=[[0, 8], [20, 30]]))
        raw["areas"] = [dict(id="Z", capacity=1)]
        for job in raw["jobs"]:
            job["areas"] = ["Z"]
        result = resource_dispatch.dispatch(raw)
        self.assertEqual((result["jobs"][1]["resource_id"], result["jobs"][1]["assignment_start_s"]), ("R2", 20))
        raw["areas"][0]["capacity"] = 2
        self.assertEqual(resource_dispatch.dispatch(raw)["jobs"][1]["assignment_start_s"], 1)

    def test_reject_unknown_area(self):
        raw = self.fixture()
        raw["jobs"][0]["areas"] = ["missing"]
        with self.assertRaises(ValueError):
            resource_dispatch.dispatch(raw)

    def test_resource_use_denominator_and_conservation(self):
        result = resource_dispatch.dispatch(self.fixture())
        metric = result["resource_metrics"][0]
        self.assertEqual((metric["available_s"], metric["working_s"], metric["reposition_s"], metric["idle_available_s"]), (20, 10, 2, 8))
        self.assertEqual(metric["utilization"], .6)
        self.assertEqual(result["completed_jobs_per_simulated_hour"], 240)
        self.assertEqual(metric["available_s"], metric["assigned_s"] + metric["idle_available_s"])

    def test_resource_use_clips_horizon_and_zero_availability(self):
        raw = self.fixture()
        raw["horizon_s"] = 21
        result = resource_dispatch.dispatch(raw)
        metric = result["resource_metrics"][0]
        self.assertEqual((metric["available_s"], metric["working_s"], metric["reposition_s"]), (11, 4, 1))
        self.assertEqual(metric["completed_jobs"], 1)
        raw["resources"][0]["availability_s"] = []
        self.assertIsNone(resource_dispatch.dispatch(raw)["resource_metrics"][0]["utilization"])


if __name__ == "__main__":
    unittest.main()
