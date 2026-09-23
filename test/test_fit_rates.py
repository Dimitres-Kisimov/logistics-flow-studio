"""tools/fit_rates.py - the plant's own rates (v3.59).

The fit on the hand-designed record by hand (the three error shares with their n and labels, the step
table, the trailer log's nearest-rank quantiles by the SCMS rule); the refusals (derived twins, a bad
trailer log); a fit from a database of imported events; the profile check; the command line; the
committed profile fresh.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import epcis_import as EI  # noqa: E402
import fit_rates as FR  # noqa: E402
import run_ledger as RL  # noqa: E402

FIX = ROOT / "test" / "fixtures"
DOC = json.loads((FIX / "fit-rates.events.json").read_text(encoding="utf-8"))
CSV = (FIX / "fit-rates.deliveries.csv").read_text(encoding="utf-8")
PROFILE = json.loads((FIX / "site-profile.json").read_text(encoding="utf-8"))


def mapped_events():
    mapped, errors, _ = EI.from_epcis(DOC)
    assert not errors, errors
    return mapped["events"]


class Fit(unittest.TestCase):
    def test_error_shares_by_hand(self):
        values, not_fitted = FR.fit_errors(mapped_events(), "urn:wt:doc:fit-rates-example-1")
        self.assertEqual(not_fitted, {})
        self.assertEqual((values["hf.error.mis-pick"]["value"], values["hf.error.mis-pick"]["n"], values["hf.error.mis-pick"]["numerator"]), (0.04, 50, 2))
        self.assertEqual((values["hf.error.wrong-putaway"]["value"], values["hf.error.wrong-putaway"]["n"], values["hf.error.wrong-putaway"]["numerator"]), (0.05, 20, 1))
        self.assertEqual((values["hf.error.damage"]["value"], values["hf.error.damage"]["n"], values["hf.error.damage"]["numerator"]), (0.05, 20, 1))
        self.assertEqual(values["hf.error.mis-pick"]["label"], "measured on urn:wt:doc:fit-rates-example-1, n = 50 picking events (2 mismatch_class); tools/fit_rates.py (v3.59)")
        self.assertTrue(all(v["label"].startswith("measured on ") for v in values.values()))
        steps = {s["biz_step"]: s for s in FR.steps_of(mapped_events())}
        self.assertEqual(sorted(steps), ["packing", "picking", "receiving", "storing", "unpacking"])
        self.assertEqual((steps["picking"]["events"], steps["picking"]["objects"], steps["picking"]["errors"], steps["picking"]["error_share"]), (50, 20, 2, 0.04))
        self.assertEqual((steps["storing"]["non_in_progress"], steps["storing"]["non_in_progress_share"], steps["storing"]["errors"], steps["storing"]["error_share"]), (20, 1.0, 1, 0.05))
        self.assertEqual(steps["storing"]["dispositions"], {"sellable_accessible": 19, "sellable_not_accessible": 1})
        self.assertEqual((steps["unpacking"]["errors"], steps["packing"]["errors"], steps["receiving"]["non_in_progress"]), (1, 0, 0))

    def test_not_fitted_when_a_step_recorded_nothing(self):
        events = [e for e in mapped_events() if e["bizStep"] != "picking"]
        values, not_fitted = FR.fit_errors(events, "x")
        self.assertNotIn("hf.error.mis-pick", values)
        self.assertEqual(not_fitted, {"hf.error.mis-pick": "no picking events in the record - the teaching value stays"})
        self.assertEqual(values["hf.error.damage"]["value"], 0.05)
        profile = FR.fit([], "nothing")
        self.assertEqual(profile["values"], {})
        self.assertEqual(set(profile["not_fitted"]), set(FR.ERROR_FITS))
        self.assertIsNone(profile["deliveries"])

    def test_trailer_log_by_hand_with_the_scms_rule(self):
        rows, problems = FR.read_deliveries(CSV)
        self.assertEqual(problems, [])
        self.assertEqual([r["late_minutes"] for r in rows], [-30, -10, -5, 0, 0, 5, 10, 20, 45, 90])
        self.assertEqual([r["trailer"] for r in rows][:2], ["T-1", "T-2"])
        d = FR.fit_deliveries(rows, "log.csv")
        self.assertEqual(d["summary"]["lateness_minutes"], {"latenessMin": -30, "latenessP10": -30, "latenessMedian": 0, "latenessP90": 45, "latenessMax": 90})
        self.assertEqual((d["summary"]["n"], d["summary"]["share_late"], d["summary"]["share_early"], d["summary"]["share_on_time"]), (10, 0.5, 0.3, 0.2))
        self.assertEqual(d["values"]["delivery.site.n"]["value"], 10)
        self.assertEqual(d["values"]["delivery.site.latenessP90"]["label"], "measured on log.csv, n = 10 trailers (lateness in minutes, nearest rank); tools/fit_rates.py (v3.59)")
        # the same nearest-rank helper as the SCMS tool: rank = ceil(p x n), 1-based
        from scms_delivery import nearest_rank
        self.assertEqual((nearest_rank([1, 2, 3, 4], 0.5), nearest_rank([1, 2, 3, 4], 0.9), nearest_rank([1, 2, 3, 4], 0.0)), (2, 4, 1))
        bad_rows, bad_problems = FR.read_deliveries("trailer,scheduled,arrived\nT-1,2026-09-22 07:00,2026-09-22T07:10:00+02:00\nT-2,2026-09-22T07:00:00+02:00,2026-09-22T07:10:00+02:00\n")
        self.assertEqual(len(bad_rows), 1)
        self.assertEqual(bad_problems, ["line 2: scheduled / arrived must be ISO 8601 with a zone"])
        self.assertEqual(FR.read_deliveries("a,b\n1,2\n")[1][0][:52], "the trailer log needs the columns trailer, scheduled")

    def test_fit_from_a_database_of_imported_events_and_refuse_derived(self):
        db = RL.connect(":memory:")
        RL.initialize(db)
        RL.import_ledger(db, json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8")))
        with self.assertRaises(ValueError) as cm:
            FR.events_from_database(db, None)
        self.assertIn("no imported events in the database (157 derived twins present", str(cm.exception))
        rid = EI.import_document(db, DOC, "fit-rates.events.json")
        events, fitted_from, source = FR.events_from_database(db, rid)
        self.assertEqual((len(events), fitted_from["documents"], source), (100, [rid], rid))
        profile = FR.fit(events, source, "db plant", fitted_from)
        self.assertEqual(profile["values"]["hf.error.mis-pick"]["value"], 0.04)
        self.assertEqual(profile["values"]["hf.error.mis-pick"]["label"], f"measured on {rid}, n = 50 picking events (2 mismatch_class); tools/fit_rates.py (v3.59)")
        self.assertEqual((profile["site"], profile["fitted_from"]["events"], profile["fitted_from"]["objects"]), ("db plant", 100, 40))
        with self.assertRaises(ValueError):
            FR.events_from_database(db, "EPCIS-nope")

    def test_check_and_the_committed_profile(self):
        self.assertEqual(FR.check(PROFILE), [])
        bad = json.loads(json.dumps(PROFILE))
        bad["values"]["hf.error.mis-pick"]["label"] = "teaching value"
        bad["values"]["hf.psf.timePressure"] = {"value": 2, "n": 5, "label": "measured on x, n = 5"}
        bad["values"]["delivery.site.n"]["n"] = 0
        self.assertEqual(FR.check(bad), ["hf.error.mis-pick: the label must start with 'measured on '", "delivery.site.n: needs a numeric value and n >= 1",
                                         "hf.psf.timePressure: not a human-factors or delivery.site entry"])
        self.assertEqual(FR.check({"schema": "x"}), ["schema is 'x', expected wt-site-profile/v1", "values missing"])
        rows, _ = FR.read_deliveries(CSV)
        events, fitted_from, source = FR.events_from_documents([FIX / "fit-rates.events.json"])
        fitted_from["deliveries"] = "fit-rates.deliveries.csv"
        again = FR.fit(events, source, "example plant", fitted_from, rows, "fit-rates.deliveries.csv")
        self.assertEqual(again, PROFILE)
        self.assertEqual(PROFILE["honesty"], FR.HONESTY)

    def test_command_line(self):
        tool = ROOT / "tools" / "fit_rates.py"
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "profile.json"
            r = subprocess.run([sys.executable, str(tool), "fit", "--document", str(FIX / "fit-rates.events.json"), "--deliveries", str(FIX / "fit-rates.deliveries.csv"), "--site", "example plant", "--out", str(out)],
                               capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("site profile: 9 values fitted, 0 not fitted, 100 events", r.stdout)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")), PROFILE)
            r = subprocess.run([sys.executable, str(tool), "check", str(out)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("hf.error.damage = 0.05  (measured on", r.stdout)
            dbf = Path(tmp) / "run.sqlite"
            subprocess.run([sys.executable, str(ROOT / "tools" / "run_ledger.py"), "import", str(FIX / "run-ledger.json"), "--database", str(dbf)], capture_output=True, text=True, encoding="utf-8", check=True)
            r = subprocess.run([sys.executable, str(tool), "fit", "--database", str(dbf), "--out", str(Path(tmp) / "x.json")], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 2)
            self.assertIn("refused: no imported events in the database", r.stdout)
            r = subprocess.run([sys.executable, str(tool), "fit", "--out", str(Path(tmp) / "y.json")], capture_output=True, text=True, encoding="utf-8")
            self.assertNotEqual(r.returncode, 0)

    def test_human_and_deterministic(self):
        src = (ROOT / "tools" / "fit_rates.py").read_text(encoding="utf-8")
        self.assertNotIn("import datetime", src)
        self.assertIn("BetrVG 87(1)6, GDPR Art. 88", FR.HONESTY)
        self.assertIn("never per person", FR.HONESTY)
        self.assertIn("SYNTHETIC", DOC["wt:note"])
        self.assertEqual(FR.fit(mapped_events(), "s"), FR.fit(mapped_events(), "s"))


if __name__ == "__main__":
    unittest.main()
