"""tools/epcis_import.py - the return path (v3.58).

The Python twin of tracking.js fromEpcis(): the synthetic EPCIS 2.0 document of test/fixtures maps to the
committed JavaScript twin event by event; the hand values (ticks, versions, ids, the CBV forms); the
ISO 8601 arithmetic without datetime; the refusals that say which; the database - recorded rows beside
the derived twins with source 'imported', the dwell view equal to the JavaScript rows and to hand
values, the gaps invariant empty, an older database rebuilt once; the command line.
"""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import epcis_import as EI  # noqa: E402
import run_ledger as RL  # noqa: E402

FIX = ROOT / "test" / "fixtures"
DOC = json.loads((FIX / "epcis-document.json").read_text(encoding="utf-8"))
TWIN = json.loads((FIX / "epcis-document.tracking.json").read_text(encoding="utf-8"))
VIEWS = json.loads((FIX / "epcis-document.tracking.views.json").read_text(encoding="utf-8"))
P = "urn:epc:id:sscc:4012345.3000000001"
K = "urn:epc:id:sscc:4012345.0000000003"
C1 = "urn:epc:id:sgtin:4012345.001917.1001"
C2 = "urn:epc:id:sgtin:4012345.001917.1002"
OLD_TRACKING_DDL = """
CREATE TABLE tracking_event(
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  handling_event_id TEXT NOT NULL UNIQUE REFERENCES handling_event(id) ON DELETE CASCADE,
  hu_id TEXT NOT NULL REFERENCES hu(id) ON DELETE CASCADE, version INTEGER NOT NULL, tick INTEGER NOT NULL, minute REAL NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('ObjectEvent','AggregationEvent')), action TEXT NOT NULL CHECK(action IN ('ADD','OBSERVE','DELETE')),
  biz_step TEXT NOT NULL, disposition TEXT NOT NULL, read_point TEXT, read_element TEXT NOT NULL, biz_location TEXT,
  biz_transaction_type TEXT NOT NULL, biz_transaction TEXT NOT NULL, epc TEXT, parent_id TEXT, epc_class TEXT NOT NULL,
  quantity INTEGER NOT NULL, uom TEXT NOT NULL DEFAULT 'EA', wt_kind TEXT NOT NULL, wt_op TEXT NOT NULL,
  error_kind TEXT, error_step TEXT, error_latent TEXT, error_detected INTEGER);
CREATE INDEX IF NOT EXISTS ix_tracking_hu ON tracking_event(hu_id, version);
CREATE INDEX IF NOT EXISTS ix_tracking_step ON tracking_event(run_id, biz_step);
"""
OLD_COLS = ("id, run_id, handling_event_id, hu_id, version, tick, minute, event_type, action, biz_step, disposition, read_point, read_element, "
            "biz_location, biz_transaction_type, biz_transaction, epc, parent_id, epc_class, quantity, uom, wt_kind, wt_op, error_kind, error_step, "
            "error_latent, error_detected")


def fresh() -> sqlite3.Connection:
    db = RL.connect(":memory:")
    RL.initialize(db)
    return db


def mutated(fn):
    d = json.loads(json.dumps(DOC))
    fn(d)
    return EI.from_epcis(d)


class Mapping(unittest.TestCase):
    def test_python_twin_equals_the_committed_javascript_fixture_event_by_event(self):
        py, errors, summary = EI.from_epcis(DOC)
        self.assertEqual(errors, [])
        self.assertEqual(py["schema"], TWIN["schema"])
        self.assertEqual(py["honesty"], TWIN["honesty"])
        self.assertEqual(py["run"], TWIN["run"])
        self.assertEqual(len(py["events"]), len(TWIN["events"]))
        for a, b in zip(py["events"], TWIN["events"]):
            self.assertEqual(a, b, a["eventID"])
        self.assertEqual(py["vocabulary"]["bizSteps"], TWIN["vocabulary"]["bizSteps"])
        self.assertEqual(py["vocabulary"]["dispositions"], TWIN["vocabulary"]["dispositions"])
        self.assertEqual(summary["run_id"], "EPCIS-8fd695d0")
        self.assertEqual((summary["document_events"], summary["mapped_events"], summary["units"], summary["ticks"]), (10, 11, 4, 180))

    def test_hand_values(self):
        py, _errors, _summary = EI.from_epcis(DOC)
        ev = py["events"]
        self.assertEqual([e["wt:tick"] for e in ev], [0, 12, 40, 40, 41, 50, 90, 105, 125, 140, 180])
        self.assertEqual([e["wt:version"] for e in ev], [0, 1, 0, 0, 1, 2, 1, 0, 1, 2, 3])
        self.assertEqual([e["wt:hu_id"] for e in ev], [P, P, C1, C2, C2, C2, C1, K, K, K, K])
        self.assertEqual(ev[0]["eventID"], "urn:wt:evt:import-1")
        self.assertEqual(ev[3]["eventID"], "urn:uuid:8e1a0f2c-4b8d-4c22-9a3f-000000000003#2")
        self.assertEqual(ev[4]["wt:minute"], 2480500 / 60000)
        self.assertEqual(ev[2]["wt:minute"], 40)
        self.assertIsInstance(ev[2]["wt:minute"], int)  # an integral minute is written as an integer, as JavaScript writes it
        self.assertEqual((ev[2]["bizStep"], ev[2]["wt:vocabulary"]["bizStep"]), ("storing", "urn"))
        self.assertEqual((ev[6]["bizStep"], ev[6]["wt:vocabulary"]["disposition"]), ("picking", "web"))
        self.assertEqual(ev[7]["bizTransactionList"], [{"type": "po", "bizTransaction": "urn:epcglobal:cbv:bt:4012345000009:PO-1001"}])
        self.assertEqual((ev[1]["type"], ev[1]["action"], ev[1]["parentID"], len(ev[1]["childEPCs"]), ev[1]["childQuantityList"][0]["quantity"]), ("AggregationEvent", "DELETE", P, 2, 46))
        self.assertIsNone(ev[10]["bizLocation"])
        self.assertEqual(py["run"]["source"]["ignored_fields"], ["destinationList", "example:myField", "sourceList"])
        self.assertTrue(all(e["wt:kind"] == "recorded" and e["wt:source"] == "imported" and e["wt:op"] is None for e in ev))

    def test_iso_8601_by_hand_without_datetime(self):
        self.assertEqual(EI.parse_iso_ms("1970-01-01T00:00:00Z"), 0)
        self.assertEqual(EI.days_from_civil(2024, 2, 29), 19782)
        self.assertEqual(EI.parse_iso_ms("2024-02-29T12:00:00+01:00"), 1709204400000)
        self.assertEqual(EI.parse_iso_ms("2005-04-03T20:33:31.116000-06:00"), 1112582011116)
        self.assertEqual(EI.parse_iso_ms("2026-09-21T08:41:20.5005+02:00") - EI.parse_iso_ms("2026-09-21T08:41:20+02:00"), 500)
        for bad in ("2026-13-01T00:00:00Z", "2026-09-21T08:00:00", "2026-09-21", "2026-09-21 08:00:00Z", None, 5):
            self.assertIsNone(EI.parse_iso_ms(bad), bad)

    def test_cbv_forms(self):
        self.assertEqual(EI.cbv_id("receiving", "bizStep"), {"id": "receiving", "form": "bare", "cbv": True})
        self.assertEqual(EI.cbv_id("urn:epcglobal:cbv:bizstep:receiving", "bizStep")["form"], "urn")
        self.assertEqual(EI.cbv_id("https://ref.gs1.org/cbv/BizStep-receiving", "bizStep")["form"], "web")
        self.assertTrue(EI.cbv_id("commissioning", "bizStep")["cbv"])
        self.assertFalse(EI.cbv_id("waiting", "bizStep")["cbv"])
        self.assertEqual(EI.cbv_id("https://example.com/steps/x", "bizStep")["form"], "other")
        self.assertIsNone(EI.cbv_id(None, "bizStep"))
        self.assertEqual((len(EI.CBV_BIZ_STEPS), len(EI.CBV_DISPOSITIONS), len(EI.CBV_BTT)), (41, 33, 13))
        self.assertTrue(set(EI.BIZ_STEPS) <= set(EI.CBV_BIZ_STEPS))
        self.assertTrue(set(EI.DISPOSITIONS) <= set(EI.CBV_DISPOSITIONS))


class Refusals(unittest.TestCase):
    def test_refusals_say_which(self):
        cases = [
            (lambda d: d["epcisBody"]["eventList"][1].__setitem__("bizStep", "commissioning"), 'event 2: business step "commissioning" is CBV 2.0 but not one this app maps (known: receiving, '),
            (lambda d: d["epcisBody"]["eventList"][2].__setitem__("bizStep", "waiting"), 'event 3: business step "waiting" is not a CBV 2.0 business step'),
            (lambda d: d["epcisBody"]["eventList"][8].__setitem__("disposition", "recalled"), 'event 9: disposition "recalled" is CBV 2.0 but not one this app maps'),
            (lambda d: d["epcisBody"]["eventList"][3].__setitem__("type", "TransformationEvent"), "event 4: TransformationEvent is not mapped (only ObjectEvent and AggregationEvent are)"),
            (lambda d: d["epcisBody"]["eventList"][4].pop("eventTime"), "event 5: eventTime null is not an ISO 8601 date-time with a zone"),
            (lambda d: d["epcisBody"].__setitem__("eventList", []), "epcisBody.eventList is empty"),
            (lambda d: d["epcisBody"]["eventList"][0].pop("epcList"), "event 1: names no object (no epcList or quantityList)"),
            (lambda d: d["epcisBody"]["eventList"][6].__setitem__("eventID", d["epcisBody"]["eventList"][5]["eventID"]), "event 7: duplicate eventID"),
            (lambda d: d.__setitem__("schemaVersion", "1.2"), 'schemaVersion "1.2": only EPCIS 2.0 JSON is read'),
            (lambda d: d.__setitem__("type", "EPCISQueryDocument"), 'not an EPCIS 2.0 capture document (type "EPCISQueryDocument", expected EPCISDocument)'),
        ]
        for fn, expected in cases:
            mapped, errors, summary = mutated(fn)
            self.assertIsNone(mapped, expected)
            self.assertIsNone(summary)
            self.assertTrue(errors[0].startswith(expected), (errors[0], expected))
        mapped, errors, _ = mutated(lambda d: [e.__setitem__("bizStep", "waiting") for e in d["epcisBody"]["eventList"]])
        self.assertIsNone(mapped)
        self.assertEqual(len(errors), 8)
        with self.assertRaises(ValueError):
            EI.import_document(fresh(), {"type": "EPCISDocument", "epcisBody": {"eventList": []}})


class Database(unittest.TestCase):
    def test_recorded_rows_beside_the_derived_twins(self):
        db = fresh()
        a = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        RL.import_ledger(db, a)
        rid = EI.import_document(db, DOC, "epcis-document.json")
        self.assertEqual(rid, "EPCIS-8fd695d0")
        by_source = {r["source"]: r["n"] for r in RL.rows(db, "SELECT source, COUNT(*) AS n FROM tracking_event GROUP BY source")}
        self.assertEqual(by_source, {"derived": len(a["events"]), "imported": 11})
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM v_tracking_gaps")[0]["n"], 0)
        run = RL.rows(db, "SELECT * FROM run WHERE id = ?", (rid,))[0]
        self.assertEqual((run["scenario"], run["seed"], run["ticks"], run["minutes_per_tick"], run["honesty"]), ("epcis-import", 0, 180, 1.0, EI.IMPORT_HONESTY))
        self.assertIn("epcis-document.json", run["dataset_source"])
        # the dwell view equals the JavaScript rows (the committed views fixture) and the hand values
        sql = RL.rows(db, "SELECT * FROM v_bizstep_dwell WHERE run_id = ? ORDER BY biz_step", (rid,))
        self.assertEqual(len(sql), len(VIEWS["bizstepDwell"]))
        for s, j in zip(sql, VIEWS["bizstepDwell"]):
            for col in ("biz_step", "events", "units", "spans", "avg_ticks_to_next", "max_ticks_to_next", "waiting_ticks", "total_ticks", "waiting_share"):
                self.assertEqual(s[col], j[col], (s["biz_step"], col))
        row = {r["biz_step"]: r for r in sql}
        self.assertEqual((row["receiving"]["avg_ticks_to_next"], row["storing"]["avg_ticks_to_next"], row["storing"]["max_ticks_to_next"], row["loading"]["avg_ticks_to_next"]), (12, 25.5, 50, 40))
        self.assertEqual(EI.dwell(db)[0]["biz_step"], "destroying")
        hist = RL.rows(db, "SELECT biz_step, tick, ticks_to_next FROM v_unit_history WHERE hu_id = ? ORDER BY version", (C2,))
        self.assertEqual([(h["biz_step"], h["tick"], h["ticks_to_next"]) for h in hist], [("storing", 40, 1), ("inspecting", 41, 9), ("destroying", 50, None)])
        ep = RL.rows(db, "SELECT archetype, source, epc, parent_id, wt_kind, wt_op FROM v_epcis_events WHERE run_id = ? ORDER BY tick, version", (rid,))
        self.assertEqual(len(ep), 11)
        self.assertTrue(all(r["archetype"] is None and r["source"] == "imported" and r["wt_kind"] == "recorded" and r["wt_op"] is None for r in ep))
        self.assertTrue(all(r["handling_event_id"] is None and r["read_element"] is None for r in RL.rows(db, "SELECT handling_event_id, read_element FROM tracking_event WHERE run_id = ?", (rid,))))
        self.assertEqual((ep[0]["epc"], ep[1]["parent_id"]), (P, P))
        self.assertTrue(all(r["source"] == "derived" for r in RL.rows(db, "SELECT source FROM v_epcis_events WHERE run_id = ?", (a["run"]["id"],))))
        EI.import_document(db, DOC)  # idempotent: the run is replaced, never duplicated
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE run_id = ?", (rid,))[0]["n"], 11)
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM run")[0]["n"], 2)
        db.execute("DELETE FROM run WHERE id = ?", (rid,))
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE source = 'imported'")[0]["n"], 0)  # cascade through run_id

    def test_older_database_is_rebuilt_once(self):
        db = fresh()
        a = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        RL.import_ledger(db, a)
        n = RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event")[0]["n"]
        for name in RL.VIEWS:
            db.execute(f"DROP VIEW IF EXISTS {name}")
        db.execute("CREATE TABLE tracking_event_new_shape AS SELECT * FROM tracking_event")
        db.execute("DROP TABLE tracking_event")
        db.executescript(OLD_TRACKING_DDL)
        db.execute(f"INSERT INTO tracking_event({OLD_COLS}) SELECT {OLD_COLS} FROM tracking_event_new_shape")
        db.execute("DROP TABLE tracking_event_new_shape")
        self.assertNotIn("source", RL.rows(db, "SELECT sql FROM sqlite_master WHERE name = 'tracking_event'")[0]["sql"])
        RL.initialize(db)
        RL.initialize(db)  # idempotent once rebuilt
        ddl = RL.rows(db, "SELECT sql FROM sqlite_master WHERE name = 'tracking_event'")[0]["sql"]
        self.assertIn("source TEXT NOT NULL DEFAULT 'derived'", ddl)
        self.assertNotIn("REFERENCES hu(id)", ddl)
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE source = 'derived'")[0]["n"], n)
        self.assertEqual(sorted(r["name"] for r in RL.rows(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tracking_event' AND name LIKE 'ix_%'")), ["ix_tracking_hu", "ix_tracking_step"])
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'tracking_event_old'")[0]["n"], 0)
        EI.import_document(db, DOC)
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM v_tracking_gaps")[0]["n"], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO tracking_event(id, run_id, hu_id, version, tick, minute, event_type, action, biz_step, disposition, wt_kind, source) VALUES('x', 'EPCIS-8fd695d0', 'u', 0, 0, 0, 'ObjectEvent', 'ADD', 'receiving', 'in_progress', 'recorded', 'guessed')")

    def test_command_line(self):
        tool = ROOT / "tools" / "epcis_import.py"
        r = subprocess.run([sys.executable, str(tool), "check", str(FIX / "epcis-document.json")], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["mapped_events"], 11)
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.json"
            d = json.loads(json.dumps(DOC))
            d["epcisBody"]["eventList"][1]["bizStep"] = "commissioning"
            bad.write_text(json.dumps(d), encoding="utf-8")
            r = subprocess.run([sys.executable, str(tool), "check", str(bad)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 1)
            self.assertIn('refused: event 2: business step "commissioning" is CBV 2.0 but not one this app maps', r.stdout)
            out = Path(tmp) / "twin.json"
            r = subprocess.run([sys.executable, str(tool), "twin", str(FIX / "epcis-document.json"), "--out", str(out)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["events"], TWIN["events"])
            dbf = Path(tmp) / "run.sqlite"
            r = subprocess.run([sys.executable, str(tool), "import", str(FIX / "epcis-document.json"), "--database", str(dbf)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("imported EPCIS-8fd695d0: 11 recorded events (source imported)", r.stdout)
            r = subprocess.run([sys.executable, str(tool), "dwell", "--database", str(dbf)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("storing", r.stdout)
            self.assertIn("25.5", r.stdout)


if __name__ == "__main__":
    unittest.main()
