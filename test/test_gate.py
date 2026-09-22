"""tools/gate.py - the one gate: its pure parts.

The README line-9 sentence (parse and render are inverses; the counts it states equal
what the repo carries), the self-test scrape (the LAST real `PASS n/n` line, never the
prose that quotes the format), the drift check, and a browser lookup that never raises.
The browser itself is not launched here: CI's verify-browser job does that.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import gate as G  # noqa: E402


class Gate(unittest.TestCase):
    def test_readme_line9_states_what_the_repo_carries(self):
        v = G.parse_line9(G.read_line9())
        self.assertIsNotNone(v, "README line 9 must be the gate's sentence")
        for k in ("harnesses", "python", "app_pass", "app_total", "viewer_pass", "viewer_total"):
            self.assertGreater(v[k], 0, k)
        self.assertEqual(v["app_pass"], v["app_total"])
        self.assertEqual(v["viewer_pass"], v["viewer_total"])
        self.assertEqual(v["cache"], G.cache_version())
        self.assertEqual(v["harnesses"], G.harness_entries())

    def test_render_and_parse_are_inverses(self):
        line = G.read_line9()
        self.assertEqual(G.render_line9(G.parse_line9(line)), line)
        v = dict(G.parse_line9(line))
        v["harnesses"] = 999
        v["cache"] = "wt-v1"
        back = G.parse_line9(G.render_line9(v))
        self.assertEqual((back["harnesses"], back["cache"], back["tail"]), (999, "wt-v1", v["tail"]))

    def test_parse_selftest_takes_the_last_real_line(self):
        dom = '<p>expect `WT-SELFTEST: PASS n/n`</p><div id="wt-selftest">WT-SELFTEST: PASS 3/3</div>'
        self.assertEqual(G.parse_selftest(dom), ("PASS", 3, 3))
        self.assertEqual(G.parse_selftest("WT-SELFTEST: FAIL 2/5 :: a, b"), ("FAIL", 2, 5))
        self.assertIsNone(G.parse_selftest("<p>WT-SELFTEST: PASS n/n</p>"))
        self.assertIsNone(G.parse_selftest(""))
        self.assertIsNone(G.parse_selftest(None))

    def test_check_readme_reports_drift_and_compares_only_what_was_measured(self):
        v = G.parse_line9(G.read_line9())
        ok = G.check_readme({"harnesses": v["harnesses"], "cache": v["cache"]})
        self.assertTrue(ok["ok"], ok)
        self.assertIn("harnesses", ok["detail"])
        bad = G.check_readme({"harnesses": v["harnesses"] + 1, "viewer_total": v["viewer_total"]})
        self.assertFalse(bad["ok"])
        self.assertIn("harnesses: README", bad["detail"])
        self.assertNotIn("viewer_total", bad["detail"])
        self.assertTrue(G.check_readme({})["ok"])

    def test_find_browser_missing_is_none(self):
        self.assertIsNone(G.find_browser("no-such-browser-xyz"))
        self.assertIsNone(G.find_browser("C:/no/such/dir/chrome.exe"))


if __name__ == "__main__":
    unittest.main()
