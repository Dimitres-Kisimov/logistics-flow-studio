"""tools/nist_box_assembly.py - the reduction of the NIST Box Assembly logs (v3.50).

The pure parts on inline samples (the stated rule, step by step), the committed reduction
(schema, ordered finite statistics, the derived sums, the JS twin and the Markdown as the
renders of the JSON), and the offline check the CI runs. The online check needs the network
and runs only when WT_NIST_NETWORK is set.
"""
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import nist_box_assembly as N  # noqa: E402

LOG_OK = "\n".join([
    "2017-02-02T18:06:38.9531250Z|Program_Status|ACTIVE",
    "2017-02-02T18:06:38.9531250Z|Program_Runtime_Seconds|1500",
    "2017-02-02T18:06:38.9843750Z|Program_Runtime_Seconds|0",
    "2017-02-02T18:06:40.0000000Z|Program_Runtime_Seconds|1",
    "2017-02-02T18:07:37.0000000Z|Program_Runtime_Seconds|59",
    "2017-02-02T18:07:38.0000000Z|Program_Runtime_Seconds|0",
    "2017-02-02T18:07:38.1000000Z|Program_Runtime_Seconds|60",
    "2017-02-02T18:12:51.0000000Z|Program_Runtime_Seconds|373",
    "2017-02-02T18:12:52.0000000Z|Program_Status|PROGRAM_COMPLETED",
    "malformed line without pipes",
])


class Rule(unittest.TestCase):
    def test_parse_name_on_the_three_name_shapes(self):
        self.assertEqual(N.parse_name("Box-OP1-Hurco02-01of20.txt"), {"part": "Box", "op": "OP1", "machine": "Hurco02", "i": 1, "n": 20})
        self.assertEqual(N.parse_name("Cover-Op3-Hurco04-20of20.txt")["op"], "Op3")
        self.assertEqual(N.parse_name("Plate-Hurco04-07of20.txt"), {"part": "Plate", "op": None, "machine": "Hurco04", "i": 7, "n": 20})
        self.assertIsNone(N.parse_name("HurcoDataSplit.py"))
        self.assertIsNone(N.parse_name("Box-OP1-Hurco02-01of20.csv"))

    def test_stale_prefix_then_the_maximum(self):
        self.assertEqual(N.instance_runtime([1500, 0, 1, 2, 59, 0, 60, 373]), {"runtime_s": 373, "stale_dropped": 1, "glitch_zeros": 1, "samples": 7})
        self.assertEqual(N.instance_runtime([1081, 1, 2, 3])["runtime_s"], 3)
        self.assertEqual(N.instance_runtime([1081, 1, 2, 3])["stale_dropped"], 1)
        self.assertEqual(N.instance_runtime([1, 2, 3]), {"runtime_s": 3, "stale_dropped": 0, "glitch_zeros": 0, "samples": 3})
        self.assertEqual(N.instance_runtime([7])["runtime_s"], 7)
        self.assertIsNone(N.instance_runtime([]))

    def test_reduce_log_uses_the_span_only_as_a_cross_check(self):
        r = N.reduce_log(LOG_OK)
        self.assertTrue(r["usable"], r)
        self.assertEqual((r["runtime_s"], r["stale_dropped"], r["glitch_zeros"], r["holds"]), (373, 1, 1, 0))
        self.assertAlmostEqual(r["span_s"], 373.047, places=2)
        # a counter that outruns the wall clock by more than the slack is not the same run
        bad = LOG_OK.replace("|373", "|900")
        self.assertFalse(N.reduce_log(bad)["usable"])
        self.assertIn("wall-clock", N.reduce_log(bad)["reason"])
        # no PROGRAM_COMPLETED -> unusable, and the run time is still reported
        r2 = N.reduce_log(LOG_OK.replace("PROGRAM_COMPLETED", "STOPPED"))
        self.assertFalse(r2["usable"])
        self.assertEqual(r2["runtime_s"], 373)
        # no runtime sample at all -> nothing survives (the reason names it); the stale rule keeps at least the last sample
        self.assertEqual(N.reduce_log("t|Program_Status|ACTIVE\nt|Program_Status|PROGRAM_COMPLETED")["reason"], "no Program_Runtime_Seconds sample")
        self.assertEqual(N.instance_runtime([1500, 1400])["runtime_s"], 1400)

    def test_reduce_group_by_hand(self):
        self.assertEqual(N.reduce_group([10, 20, 30, 40]), {"min": 10, "median": 25.0, "max": 40, "mean": 25.0})
        self.assertEqual(N.reduce_group([5]), {"min": 5, "median": 5, "max": 5, "mean": 5.0})
        self.assertIsNone(N.reduce_group([]))


class Committed(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / "data" / "nist-box-assembly.json").read_text(encoding="utf-8"))

    def test_schema_and_statistics(self):
        d = self.data
        self.assertEqual((d["schema"], d["id"]), ("wt-dataset-1", "nist-box-assembly"))
        self.assertIn(N.NOTICE, d["source"]["notice"])
        self.assertEqual(d["rule"], N.RULE)
        self.assertEqual(sorted(d["parts"]), ["Box", "Cover", "Plate"])
        n_ops = 0
        for part, rec in d["parts"].items():
            for o in rec["ops"]:
                n_ops += 1
                self.assertLessEqual(o["usable"], o["files"], (part, o["op"]))
                self.assertIn(o["machine"], d["machines"])
                r = o["runtime_s"]
                if o["usable"]:
                    self.assertTrue(0 < r["min"] <= r["median"] <= r["max"], (part, o["op"], r))
                    self.assertTrue(r["min"] <= r["mean"] <= r["max"])
                else:
                    self.assertIsNone(r)
        self.assertEqual(n_ops, 10)
        self.assertEqual(N.schema_problems(d), [])

    def test_derived_sums_are_the_sums_of_the_medians(self):
        d = self.data
        box = sum(o["runtime_s"]["median"] for o in d["parts"]["Box"]["ops"] if o["machine"] == "Hurco02")
        cp = sum(o["runtime_s"]["median"] for p in ("Cover", "Plate") for o in d["parts"][p]["ops"] if o["machine"] == "Hurco04")
        self.assertAlmostEqual(d["derived"]["hurco02_box_sum_of_medians_s"], box)
        self.assertAlmostEqual(d["derived"]["hurco04_cover_plus_plate_sum_of_medians_s"], cp)

    def test_js_twin_and_markdown_are_the_renders(self):
        self.assertEqual((ROOT / "data" / "nist-box-assembly.js").read_text(encoding="utf-8").replace("\r\n", "\n"), N.render_js(self.data))
        self.assertEqual((ROOT / "docs" / "NIST_BOX_ASSEMBLY.md").read_text(encoding="utf-8").replace("\r\n", "\n"), N.render_md(self.data))
        self.assertEqual((ROOT / "data" / "nist-box-assembly.json").read_text(encoding="utf-8").replace("\r\n", "\n"), N.render_json(self.data))

    def test_offline_check_passes(self):
        self.assertEqual(N.main(["--offline-check"]), 0)

    @unittest.skipUnless(os.environ.get("WT_NIST_NETWORK"), "set WT_NIST_NETWORK=1 to fetch the dataset and compare")
    def test_online_check(self):
        self.assertEqual(N.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
