"""tools/run_ledger.py - the run ledger in SQL.

Two layers of proof:
  1. A HAND-BUILT ledger (three units, eleven events) with answers written out by
     hand: cycle time, touches, station wait, WIP at a tick, quantities per op,
     dispatch pallets / trailers - and every invariant view empty. Then a
     deliberate corruption (one each off by one) MUST surface in the violations.
  2. The committed fixture recorded by the browser ledger (tools/make_run_ledger_fixture.mjs):
     every invariant empty, and the SQL summary equal to the JavaScript stats the
     app shows - the readout and the database cannot disagree.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import run_ledger as RL  # noqa: E402

FIX = ROOT / "test" / "fixtures"


def hand_ledger():
    run = "RUN-hand-s1-h00000000"
    o = lambda n: f"ORD-{run}-{n:06d}"  # noqa: E731
    hu = lambda n: f"HU-{o(n)}-1"  # noqa: E731
    ev = lambda h, v, kind, op, loc, tick, p, c, e, pa, ret=0, scr=0: dict(  # noqa: E731
        id=f"EVT-{h}-{v}", hu_id=h, version=v, kind=kind, op=op, anchor=None, location=loc, tick=tick, minute=tick * 1.0,
        stage=None, form=None, pallets=p, cases=c, eaches=e, parcels=pa, retained=ret, scrapped=scr)
    A, B, C = hu(1), hu(2), hu(3)
    hus = [
        # A: case-pick, 48 cases x 12 = 576 in; picks 4 cases (48 eaches), retains 528; delivered on 1 pallet at tick 30
        dict(id=A, order_id=o(1), seq=1, archetype="case-pick", outcome=None, route_id="case-pick", sscc="340123450000000017",
             gtin13="4012345678901", gtin14="14012345678908", pallet="eur", box="case-400x300x250", eaches_per_case=12, cases_per_pallet=48,
             received_eaches=576, spawned_tick=0, retired_tick=30, final_kind="delivered",
             final=dict(pallets=1, cases=4, eaches=48, parcels=0, form="wrapped-pallet", retained=528, scrapped=0)),
        # B: cross-dock pallet, untouched, delivered at tick 20
        dict(id=B, order_id=o(2), seq=2, archetype="cross-dock", outcome=None, route_id="cross-dock", sscc="340123450000000024",
             gtin13="4012345678901", gtin14="14012345678908", pallet="eur", box="case-400x300x250", eaches_per_case=12, cases_per_pallet=48,
             received_eaches=576, spawned_tick=5, retired_tick=20, final_kind="delivered",
             final=dict(pallets=1, cases=48, eaches=576, parcels=0, form="pallet-load", retained=0, scrapped=0)),
        # C: a return of 3 eaches, still in flight
        dict(id=C, order_id=o(3), seq=3, archetype="returns", outcome="scrap", route_id="returns:scrap", sscc="040123450000000031",
             gtin13="4012345678901", gtin14="14012345678908", pallet="eur", box="case-400x300x250", eaches_per_case=12, cases_per_pallet=48,
             received_eaches=3, spawned_tick=10, retired_tick=None, final_kind=None, final=None),
    ]
    events = [
        ev(A, 0, "created", "receive", "in", 0, 1, 48, 576, 0),
        ev(A, 1, "passed", "depalletise", "dep", 4, 0, 48, 576, 0),
        ev(A, 2, "queued", "case-pick", "face", 8, 0, 48, 576, 0),
        ev(A, 3, "served", "case-pick", "face", 12, 0, 4, 48, 0, ret=528),
        ev(A, 4, "passed", "palletise", "wrap", 20, 1, 4, 48, 0, ret=528),
        ev(A, 5, "delivered", "load", "out", 30, 1, 4, 48, 0, ret=528),
        ev(B, 0, "created", "receive", "in", 5, 1, 48, 576, 0),
        ev(B, 1, "passed", "stage-out", "stg", 12, 1, 48, 576, 0),
        ev(B, 2, "delivered", "load", "out", 20, 1, 48, 576, 0),
        ev(C, 0, "created", "receive", "in", 10, 0, 0, 3, 1),
        ev(C, 1, "queued", "inspect", "ret", 14, 0, 0, 3, 1),
    ]
    return dict(schema=RL.SCHEMA_ID,
                run=dict(id=run, scenario="hand", seed=1, hash="00000000", mix={"case-pick": 0.5, "cross-dock": 0.3, "returns": 0.2},
                         profile="ecommerce", ticks_per_hour=60, minutes_per_tick=1.0, ticks=40, honesty="hand-built test ledger"),
                profile=dict(id="ecommerce", label="E-commerce", box="case-400x300x250", pallet="eur", eaches_per_case=12, case_kg=6,
                             max_stack_mm=1800, eaches_per_parcel=6),
                locations=[dict(id="in", type="dock-in", category="flow"), dict(id="dep", type="depalletiser", category="flow"),
                           dict(id="face", type="carton-flow", category="storage"), dict(id="wrap", type="stretch-wrap", category="flow"),
                           dict(id="stg", type="staging", category="flow"), dict(id="out", type="dock-out", category="flow"),
                           dict(id="ret", type="returns-station", category="flow")],
                hus=hus, events=events)


def fresh():
    db = RL.connect(":memory:")
    RL.initialize(db)
    return db


class HandLedger(unittest.TestCase):
    def setUp(self):
        self.db = fresh()
        self.run = RL.import_ledger(self.db, hand_ledger())

    def view(self, name, **where):
        sql = f"SELECT * FROM {name} WHERE run_id = ?"
        params = [self.run]
        for k, v in where.items():
            sql += f" AND {k} = ?"
            params.append(v)
        return RL.rows(self.db, sql + " ORDER BY 2, 3", params)

    def test_cycle_time_by_hand(self):
        cp = self.view("v_cycle_time_by_type", archetype="case-pick")[0]
        self.assertEqual((cp["units"], cp["retired"], cp["avg_cycle_ticks"], cp["avg_cycle_minutes"]), (1, 1, 30.0, 30.0))
        xd = self.view("v_cycle_time_by_type", archetype="cross-dock")[0]
        self.assertEqual((xd["avg_cycle_ticks"], xd["min_cycle_ticks"], xd["max_cycle_ticks"]), (15.0, 15, 15))
        rt = self.view("v_cycle_time_by_type", archetype="returns")[0]
        self.assertEqual((rt["units"], rt["retired"], rt["avg_cycle_ticks"]), (1, 0, None))

    def test_touches_by_hand(self):
        t = {r["archetype"]: r for r in self.view("v_touches_by_type")}
        self.assertEqual((t["case-pick"]["events"], t["case-pick"]["touches"], t["case-pick"]["served_per_unit"]), (6, 6.0, 1.0))
        self.assertEqual((t["cross-dock"]["events"], t["cross-dock"]["touches"]), (3, 3.0))
        self.assertEqual((t["returns"]["events"], t["returns"]["served_per_unit"]), (2, 0.0))

    def test_station_wait_by_hand(self):
        w = {(r["location"], r["op"]): r for r in self.view("v_station_wait")}
        self.assertEqual((w[("face", "case-pick")]["waits"], w[("face", "case-pick")]["avg_wait_ticks"], w[("face", "case-pick")]["max_wait_ticks"]), (1, 4.0, 4))
        self.assertEqual((w[("ret", "inspect")]["waits"], w[("ret", "inspect")]["avg_wait_ticks"], w[("ret", "inspect")]["still_waiting"]), (1, None, 1))

    def test_wip_by_tick_by_hand(self):
        wip = {r["tick"]: r for r in self.view("v_wip_by_tick")}
        self.assertEqual(len(wip), 41)  # ticks 0..40
        self.assertEqual((wip[0]["in_flight"], wip[4]["in_flight"], wip[5]["in_flight"], wip[12]["in_flight"]), (1, 1, 2, 3))
        self.assertEqual((wip[20]["in_flight"], wip[20]["retired"], wip[30]["in_flight"], wip[30]["retired"], wip[40]["in_flight"]), (2, 1, 1, 2, 1))

    def test_quantities_by_op_by_hand(self):
        q = {(r["op"], r["kind"]): r for r in self.view("v_quantities_by_op")}
        self.assertEqual((q[("receive", "created")]["events"], q[("receive", "created")]["pallets"], q[("receive", "created")]["eaches"]), (3, 2, 1155))
        self.assertEqual((q[("case-pick", "served")]["cases"], q[("case-pick", "served")]["retained"]), (4, 528))
        self.assertEqual((q[("load", "delivered")]["pallets"], q[("load", "delivered")]["eaches"]), (2, 624))

    def test_dispatch_by_hand(self):
        d = self.view("v_dispatch")[0]
        self.assertEqual((d["delivered_units"], d["pallets"], d["cases"], d["eaches"], d["parcels"], d["trailer_slots"], d["trailers"]), (2, 2, 52, 624, 0, 33, 1))

    def test_summary_by_hand(self):
        s = RL.summary(self.db, self.run)
        top = s["v_run_summary"][0]
        self.assertEqual((top["units"], top["events"], top["delivered"], top["delivered_eaches"], top["delivered_pallets"]), (3, 11, 2, 624, 2))
        self.assertEqual(s["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_invariants_empty_then_corruption_surfaces(self):
        for name in RL.INVARIANT_VIEWS:
            self.assertEqual(self.view(name), [], name)
        # corrupt ONE each on ONE event: conservation must fail on exactly that event
        self.db.execute("UPDATE handling_event SET eaches = eaches + 1 WHERE id = ?", (f"EVT-HU-ORD-{self.run}-000001-1-3",))
        bad = self.view("v_conservation_violations")
        self.assertEqual([(b["hu_id"], b["version"], b["accounted"], b["received_eaches"]) for b in bad],
                         [(f"HU-ORD-{self.run}-000001-1", 3, 577, 576)])
        # a cross-dock pallet recorded at a storage element must surface too
        self.db.execute("UPDATE handling_event SET location = 'face' WHERE id = ?", (f"EVT-HU-ORD-{self.run}-000002-1-1",))
        self.assertEqual(len(self.view("v_cross_dock_violations")), 1)
        # a version gap must surface
        self.db.execute("DELETE FROM handling_event WHERE id = ?", (f"EVT-HU-ORD-{self.run}-000001-1-1",))
        self.assertEqual(len(self.view("v_version_gaps")), 1)

    def test_reimport_is_idempotent(self):
        RL.import_ledger(self.db, hand_ledger())
        top = RL.summary(self.db, self.run)["v_run_summary"][0]
        self.assertEqual((top["units"], top["events"]), (3, 11))

    def test_query_is_bounded_and_read_only(self):
        self.assertEqual(RL.query(self.db, "SELECT COUNT(*) AS n FROM hu")[0]["n"], 3)
        with self.assertRaises(ValueError):
            RL.query(self.db, "DELETE FROM hu")
        with self.assertRaises(ValueError):
            RL.query(self.db, "SELECT 1; SELECT 2")
        with self.assertRaises(ValueError):
            RL.query(self.db, "SELECT * FROM handling_event", limit=5)

    def test_rejects_bad_schema_and_dangling_events(self):
        bad = hand_ledger()
        bad["schema"] = "something-else"
        with self.assertRaises(ValueError):
            RL.import_ledger(fresh(), bad)
        bad = hand_ledger()
        bad["events"][0]["hu_id"] = "HU-nope"
        with self.assertRaises(ValueError):
            RL.import_ledger(fresh(), bad)


@unittest.skipUnless((FIX / "run-ledger.json").exists(), "fixture not generated")
class RecordedFixture(unittest.TestCase):
    """The browser-recorded fixture: invariants hold and SQL == JavaScript stats."""

    def setUp(self):
        self.data = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        self.js = json.loads((FIX / "run-ledger.stats.json").read_text(encoding="utf-8"))
        self.db = fresh()
        self.run = RL.import_ledger(self.db, self.data)

    def test_invariants_hold_on_the_recorded_run(self):
        s = RL.summary(self.db, self.run)
        self.assertEqual(s["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})
        self.assertGreater(s["v_run_summary"][0]["units"], 20)

    def test_sql_equals_javascript_stats(self):
        s = RL.summary(self.db, self.run)
        top = s["v_run_summary"][0]
        self.assertEqual((top["units"], top["events"], top["delivered"], top["delivered_eaches"], top["delivered_pallets"], top["delivered_parcels"]),
                         (self.js["units"], self.js["events"], self.js["delivered"], self.js["delivered_eaches"], self.js["delivered_pallets"], self.js["delivered_parcels"]))
        cycle = {r["archetype"]: r for r in s["v_cycle_time_by_type"]}
        touches = {r["archetype"]: r for r in s["v_touches_by_type"]}
        for t in self.js["types"]:
            a = t["archetype"]
            self.assertEqual((cycle[a]["units"], cycle[a]["retired"]), (t["units"], t["retired"]), a)
            self.assertEqual(cycle[a]["avg_cycle_ticks"], t["avg_cycle_ticks"], a)
            self.assertEqual(touches[a]["touches"], t["touches"], a)

    def test_every_gs1_number_is_unique_and_18_or_14_digits(self):
        ssccs = RL.rows(self.db, "SELECT sscc, gtin14 FROM hu WHERE run_id = ?", (self.run,))
        self.assertEqual(len({r["sscc"] for r in ssccs}), len(ssccs))
        self.assertTrue(all(len(r["sscc"]) == 18 and len(r["gtin14"]) == 14 for r in ssccs))


if __name__ == "__main__":
    unittest.main()
