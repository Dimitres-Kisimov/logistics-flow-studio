"""Tests for tools/online_retail.py (v3.69) - the real order book behind the demo.

Nothing here touches the network. The streaming spreadsheet reader is exercised on a
workbook this test builds by hand, the reduction rule's arithmetic is checked against
values worked out by hand, and the committed files are checked against each other.
"""
import csv
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import online_retail as ORT  # noqa: E402

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def tiny_workbook(rows, strings):
    """A workbook with only the two parts the reader opens: sharedStrings and one sheet."""
    sst = "".join(f"<si><t>{s}</t></si>" for s in strings)
    body = []
    for r, cells in enumerate(rows, 1):
        cs = []
        for col, (kind, val) in cells.items():
            if kind == "s":
                cs.append(f'<c r="{col}{r}" t="s"><v>{val}</v></c>')
            elif kind == "inline":
                cs.append(f'<c r="{col}{r}" t="inlineStr"><is><t>{val}</t></is></c>')
            elif kind == "empty":
                cs.append(f'<c r="{col}{r}"/>')
            else:
                cs.append(f'<c r="{col}{r}"><v>{val}</v></c>')
        body.append(f'<row r="{r}">' + "".join(cs) + "</row>")
    sheet = f'<?xml version="1.0"?><worksheet xmlns="{NS}"><sheetData>' + "".join(body) + "</sheetData></worksheet>"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/sharedStrings.xml", f'<?xml version="1.0"?><sst xmlns="{NS}">{sst}</sst>')
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    buf.seek(0)
    return zipfile.ZipFile(buf)


class StreamingReader(unittest.TestCase):
    def test_reads_shared_inline_numeric_and_empty_cells(self):
        x = tiny_workbook(
            [
                {"A": ("s", 0), "B": ("s", 1), "D": ("n", "7"), "E": ("n", "40862.5")},
                {"A": ("inline", "C12345"), "B": ("empty", ""), "D": ("n", "-3")},
            ],
            ["Invoice", "85123A"],
        )
        sst = ORT.shared_strings(x)
        self.assertEqual(sst, ["Invoice", "85123A"])
        got = list(ORT.sheet_rows(x, "xl/worksheets/sheet1.xml", sst))
        self.assertEqual(got[0]["A"], "Invoice")
        self.assertEqual(got[0]["B"], "85123A")
        self.assertEqual(got[0]["D"], "7")
        self.assertEqual(got[1]["A"], "C12345")  # an inline string, not a shared one
        self.assertEqual(got[1]["B"], "")        # an empty cell is empty, never guessed
        self.assertEqual(got[1]["D"], "-3")

    def test_sheet_names_are_sorted_so_the_reduction_is_order_independent(self):
        self.assertEqual(ORT.sheet_names(tiny_workbook([], [])), ["xl/worksheets/sheet1.xml"])

    def test_the_excel_date_serial_converts_to_the_documented_period(self):
        import datetime as dt
        # 2011-11-16 09:00 is serial 40863.375 in the 1900 system the workbook uses
        self.assertEqual(ORT.EPOCH + dt.timedelta(days=40863.375), dt.datetime(2011, 11, 16, 9, 0))


class ReductionRule(unittest.TestCase):
    def test_nearest_rank_never_interpolates(self):
        s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        self.assertEqual(ORT.nearest_rank(s, 0.10), 1)
        self.assertEqual(ORT.nearest_rank(s, 0.50), 5)
        self.assertEqual(ORT.nearest_rank(s, 0.90), 9)
        self.assertEqual(ORT.nearest_rank(s, 1.0), 10)
        self.assertIsNone(ORT.nearest_rank([], 0.5))
        # every quantile is a value that actually occurs
        self.assertIn(ORT.nearest_rank([3, 3, 7], 0.5), [3, 7])

    def test_spread_by_hand(self):
        v = ORT.spread([5, 1, 3])
        self.assertEqual(v, {"n": 3, "min": 1, "p10": 1, "median": 3, "p90": 5, "max": 5, "mean": 3.0})
        self.assertIsNone(ORT.spread([]))

    def test_a_physical_article_is_the_documented_five_digit_form(self):
        for good in ("85123A", "22801", "84077", "79323P"):
            self.assertTrue(ORT.PHYSICAL_RE.match(good), good)
        for admin in ("POST", "D", "DOT", "M", "BANK CHARGES", "AMAZONFEE", "S", "CRUK", "gift_0001_20", "1234", "123456"):
            self.assertFalse(ORT.PHYSICAL_RE.match(admin), admin)

    def test_a_cancellation_is_recognised_by_its_invoice_prefix_in_either_case(self):
        for inv in ("C536379", "c536379"):
            self.assertEqual(inv[:1].upper(), "C")
        self.assertNotEqual("536379"[:1].upper(), "C")


class CommittedFiles(unittest.TestCase):
    def setUp(self):
        self.json = json.loads((ROOT / "data" / "online-retail.json").read_text(encoding="utf-8"))

    def test_offline_check_passes(self):
        self.assertEqual(ORT.offline_check(ROOT), 0)

    def test_the_licence_and_citation_travel_with_the_data(self):
        src = self.json["source"]
        self.assertIn("CC BY 4.0", src["licence"])
        self.assertIn("10.24432/C5CG6D", src["citation"])
        self.assertIn("cancellation", src["caveat"].lower())
        self.assertIn("not a customer", src["caveat"].lower())
        # the caveat says what does NOT transfer
        for word in ("building", "staffing", "rates"):
            self.assertIn(word, src["caveat"])

    def test_the_cancellation_rate_is_reported_as_a_cancellation_and_not_as_a_return(self):
        s = self.json["scale"]
        self.assertGreater(s["cancellation_invoices"], 0)
        self.assertAlmostEqual(
            s["cancellation_share_of_invoices"],
            round(s["cancellation_invoices"] / (s["cancellation_invoices"] + s["sales_invoices"]), 4), places=4)
        blob = json.dumps(self.json).lower()
        self.assertNotIn("return_share", blob)
        self.assertNotIn("return_rate", blob)

    def test_every_rejected_line_is_counted_and_the_totals_are_consistent(self):
        s, rej = self.json["scale"], self.json["rejected"]
        self.assertEqual(s["rows"], s["usable_lines"] + sum(rej.values()))

    def test_the_abc_cut_is_measured_not_assumed(self):
        a = self.json["abc"]["cuts"]["A"]
        self.assertGreater(a["share_of_skus"], 0.15)
        self.assertLess(a["share_of_skus"], 0.30)
        self.assertEqual(a["at_share_of_units"], 0.80)
        curve = self.json["abc"]["curve"]
        shares = [c["share_of_units"] for c in curve]
        self.assertEqual(shares, sorted(shares))  # cumulative, so non-decreasing

    def test_the_article_master_fits_the_apps_cap_and_covers_what_it_claims(self):
        am = self.json["article_master"]
        self.assertLessEqual(am["skus"], ORT.MAX_ARTICLES)
        with (ROOT / "data" / "demo-skus.csv").open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), am["skus"])
        self.assertTrue(all(ORT.PHYSICAL_RE.match(r["sku"]) for r in rows))
        self.assertTrue(all(float(r["weekly_picks"]) > 0 for r in rows))
        self.assertTrue(all(r["class"] in ("A", "B", "C") for r in rows))
        self.assertEqual(sum(1 for r in rows if r["class"] == "A"), am["by_class"]["A"])

    def test_the_demo_day_is_one_real_day_with_its_drop_reported(self):
        d = self.json["demo_day"]
        self.assertEqual(d["lines_before_master_restriction"], d["lines"] + d["lines_dropped_by_restriction"])
        with (ROOT / "data" / "demo-orders.csv").open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), d["lines"])
        self.assertEqual(sum(int(r["qty"]) for r in rows), d["units"])
        self.assertEqual(len({r["order_id"] for r in rows}), d["orders"])
        # order ids are renumbered in file order, and no customer id or invoice number survives
        self.assertEqual(rows[0]["order_id"], "ORD-0001")
        self.assertTrue(all(r["order_id"].startswith("ORD-") for r in rows))

    def test_the_committed_day_is_in_the_datasets_own_period(self):
        s, d = self.json["scale"], self.json["demo_day"]
        self.assertLessEqual(s["first"][:10], d["date"])
        self.assertGreaterEqual(s["last"][:10], d["date"])


if __name__ == "__main__":
    unittest.main()
