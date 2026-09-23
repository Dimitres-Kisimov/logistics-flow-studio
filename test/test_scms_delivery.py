"""tools/scms_delivery.py - the reduction of the USAID SCMS delivery history (v3.55).

The pure parts on a hand-written CSV (the stated rule, step by step: date parsing, the nearest-rank
quantiles, the shares, the unusable counts), the committed reduction (schema, ordered quantiles,
shares summing to one, the JS twin and the Markdown as the renders of the JSON, the attribution and
the licence status), and the offline check the CI runs. The online check needs the network and runs
only when WT_SCMS_NETWORK is set.
"""
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import scms_delivery as S  # noqa: E402

HAND_CSV = "\n".join([
    "ID,Shipment Mode,PO Sent to Vendor Date,Scheduled Delivery Date,Delivered to Client Date,Other",
    "1,Air,1-Jan-10,10-Jan-10,8-Jan-10,x",         # -2 (early); po 7
    "2,Air,Date Not Captured,10-Jan-10,10-Jan-10,x",  # 0
    "3,Air,2-Jan-10,10-Jan-10,10-Jan-10,x",        # 0; po 8
    "4,Air,N/A - From RDC,10-Jan-10,13-Jan-10,x",  # +3
    "5,Air,1-Jan-10,10-Jan-10,22-Jan-10,x",        # +12; po 21
    "6,Air,1-Jan-10,Date Not Captured,22-Jan-10,x",  # unusable (scheduled); po 21
    "7,Truck,1-Feb-10,10-Feb-10,11-Feb-10,x",      # +1; po 10
    "8,Truck,1-Feb-10,10-Feb-10,11-Feb-10,x",      # +1; po 10
    "9,Truck,1-Feb-10,10-Feb-10,9-Feb-10,x",       # -1; po 8
    "10,Truck,1-Feb-10,10-Feb-10,,x",              # unusable (delivered blank)
    "11,N/A,1-Mar-10,10-Mar-10,10-Mar-10,x",       # (not captured) 0; po 9
    "12,,3/1/10,10-Mar-10,15-Mar-10,x",            # (not captured) +5; po 14 (an m/d/yy PO date)
    "",
])


class Rule(unittest.TestCase):
    def test_parse_date(self):
        self.assertEqual(str(S.parse_date("2-Jun-06")), "2006-06-02")
        self.assertEqual(str(S.parse_date(" 22-Jan-10 ")), "2010-01-22")
        self.assertEqual(str(S.parse_date("8/27/14")), "2014-08-27")
        for bad in ("Date Not Captured", "N/A - From RDC", "", None, "2006-06-02"):
            self.assertIsNone(S.parse_date(bad), bad)

    def test_nearest_rank_by_hand(self):
        v = list(range(1, 11))  # 1..10
        self.assertEqual([S.nearest_rank(v, p) for p in (0.0, 0.1, 0.5, 0.9, 1.0)], [1, 1, 5, 9, 10])
        self.assertEqual([S.nearest_rank([7], p) for p in (0.0, 0.5, 1.0)], [7, 7, 7])
        self.assertEqual(S.nearest_rank([3, 1, 2][:0], 0.5), None)
        self.assertEqual(S.summarise([12, -2, 0, 3, 0]), {"min": -2, "p10": -2, "median": 0, "p90": 12, "max": 12})
        self.assertEqual(S.shares([12, -2, 0, 3, 0]), {"late": 0.4, "early": 0.2, "on_time": 0.4})

    def test_reduce_rows_by_hand(self):
        red = S.reduce_rows(S.read_csv_text(HAND_CSV))
        self.assertEqual(red["modes"], ["Air", "Truck", "(not captured)"])
        self.assertEqual(red["rows"], 12)
        air, truck, nc, allm = red["by_mode"]["Air"], red["by_mode"]["Truck"], red["by_mode"]["(not captured)"], red["overall"]
        self.assertEqual((air["n"], air["usable"]), (6, 5))
        self.assertEqual(air["lateness_days"], {"min": -2, "p10": -2, "median": 0, "p90": 12, "max": 12})
        self.assertEqual(air["share"], {"late": 0.4, "early": 0.2, "on_time": 0.4})
        self.assertEqual(air["po_to_delivery_days"], {"min": 7, "p10": 7, "median": 8, "p90": 21, "max": 21, "usable": 4})
        self.assertEqual((truck["n"], truck["usable"]), (4, 3))
        self.assertEqual(truck["lateness_days"], {"min": -1, "p10": -1, "median": 1, "p90": 1, "max": 1})
        self.assertEqual(truck["share"], {"late": 0.6667, "early": 0.3333, "on_time": 0.0})
        self.assertEqual((nc["n"], nc["usable"], nc["lateness_days"]["median"], nc["lateness_days"]["p90"]), (2, 2, 0, 5))
        self.assertEqual(nc["po_to_delivery_days"], {"min": 9, "p10": 9, "median": 9, "p90": 14, "max": 14, "usable": 2})
        self.assertEqual((allm["n"], allm["usable"]), (12, 10))
        self.assertEqual(allm["lateness_days"], {"min": -2, "p10": -2, "median": 0, "p90": 5, "max": 12})
        self.assertEqual(allm["share"], {"late": 0.5, "early": 0.2, "on_time": 0.3})
        u = red["unusable"]
        self.assertEqual((u["scheduled_delivery_date"], u["delivered_to_client_date"], u["po_sent_to_vendor_date"]), (1, 1, 2))
        self.assertEqual(u["values_seen"], {"Date Not Captured": 2, "N/A - From RDC": 1, "(blank)": 1})


class Committed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(S.DATA_JSON.read_text(encoding="utf-8"))

    def test_schema_statistics_attribution_and_licence(self):
        d = self.data
        self.assertEqual(S.schema_problems(d), [])
        self.assertEqual(d["schema"], S.SCHEMA)
        self.assertEqual(d["source"]["attribution"], "USAID Development Data Library")
        self.assertEqual(d["source"]["licence"]["status"], "unresolved")
        self.assertIn("CC BY-ND 4.0", d["source"]["licence"]["note"])
        self.assertEqual(d["source"]["rows"], 10324)
        self.assertEqual(d["source"]["columns"], 33)
        self.assertTrue({"Air", "Air Charter", "Ocean", "Truck"} <= set(d["modes"]))
        self.assertEqual(sum(d["by_mode"][m]["n"] for m in d["modes"]), d["overall"]["n"])
        self.assertEqual(sum(d["by_mode"][m]["usable"] for m in d["modes"]), d["overall"]["usable"])
        for m in d["modes"]:
            q = d["by_mode"][m]["lateness_days"]
            self.assertTrue(q["min"] <= q["p10"] <= q["median"] <= q["p90"] <= q["max"], m)
        self.assertNotIn("retrieved", json.dumps(d))  # no date anywhere: the reduction reproduces byte for byte

    def test_js_twin_and_markdown_are_the_renders(self):
        self.assertEqual(S.DATA_JS.read_text(encoding="utf-8").replace("\r\n", "\n"), S.render_js(self.data))
        md = S.DOC_MD.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.assertEqual(md, S.render_md(self.data))
        self.assertIn("USAID Development Data Library", md)
        self.assertIn("**unresolved**", md)
        self.assertIn("Weyl sequence", md)

    def test_offline_check_passes(self):
        logs = []
        self.assertEqual(S.offline_check(log=logs.append), 0, logs)

    @unittest.skipUnless(os.environ.get("WT_SCMS_NETWORK"), "network check only with WT_SCMS_NETWORK=1")
    def test_online_check(self):
        self.assertEqual(S.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
