"""tools/make_sample_data.py - the synthetic sample SKU master and order file (v3.44).

The committed docs/examples files are what the script writes (byte for byte), their headers are
exactly the two wmsdata.js imports, and the counts and ranges are as documented.
"""
import csv
import io
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import make_sample_data as MS  # noqa: E402

OUT = ROOT / "docs" / "examples"


class SampleData(unittest.TestCase):
    def setUp(self):
        self.files = MS.render()

    def test_committed_files_are_fresh(self):
        for name, text in self.files.items():
            self.assertEqual((OUT / name).read_text(encoding="utf-8").replace("\r\n", "\n"), text, name)
        self.assertEqual(MS.main(["--check"]), 0)

    def test_headers_are_exactly_the_importer_headers(self):
        js = (ROOT / "wmsdata.js").read_text(encoding="utf-8")
        skus = re.search(r'skus: "([^"]+)"', js).group(1)
        orders = re.search(r'orders: "([^"]+)"', js).group(1)
        self.assertEqual(self.files["skus.csv"].splitlines()[0], skus)
        self.assertEqual(self.files["orders.csv"].splitlines()[0], orders)

    def test_counts_and_ranges(self):
        skus = list(csv.DictReader(io.StringIO(self.files["skus.csv"])))
        orders = list(csv.DictReader(io.StringIO(self.files["orders.csv"])))
        self.assertEqual(len(skus), MS.N_SKUS)
        self.assertEqual(len({s["sku"] for s in skus}), MS.N_SKUS)
        self.assertTrue(all(int(s["velocity"]) >= 1 and s["abc_class"] in "ABC" and 0.1 <= float(s["weight_kg"]) <= 12.0 for s in skus))
        self.assertEqual([s["abc_class"] for s in skus].count("A"), int(MS.N_SKUS * 0.2))
        by_order = {}
        for r in orders:
            by_order.setdefault(r["order_id"], []).append(r)
        self.assertEqual(len(by_order), MS.N_ORDERS)
        self.assertTrue(all(MS.LINES[0] <= len(v) <= MS.LINES[1] and len({r["sku"] for r in v}) == len(v) for v in by_order.values()))
        self.assertTrue(all(MS.QTY[0] <= int(r["qty"]) <= MS.QTY[1] for r in orders))
        known = {s["sku"] for s in skus}
        self.assertTrue(all(r["sku"] in known for r in orders))
        self.assertIn("synthetic", self.files["README.md"].lower())


if __name__ == "__main__":
    unittest.main()
