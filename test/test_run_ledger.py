"""tools/run_ledger.py - the run ledger in SQL.

Two layers of proof:
  1. A HAND-BUILT ledger (three units, eleven events) with answers written out by
     hand: cycle time, touches, station wait, WIP at a tick, quantities per op,
     dispatch pallets / trailers - and every invariant view empty. Then a
     deliberate corruption (one each off by one) MUST surface in the violations.
  2. The committed fixture recorded by the browser ledger (tools/make_run_ledger_fixture.mjs):
     every invariant empty, and the SQL summary equal to the JavaScript stats the
     app shows - the readout and the database cannot disagree.
  3. (v3.35) WHAT A HANDLING UNIT COSTS: the spans between a unit's events, charged
     at the rates the run was recorded under - hand-computed money for the three
     units, rates linear, empty without rates, and SQL == JavaScript on the fixture.
"""
import json
import math
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import export_viewer_sql as XV  # noqa: E402
import run_ledger as RL  # noqa: E402

FIX = ROOT / "test" / "fixtures"
# v3.43: SQLite sums with Kahan-Babuska-Neumaier since 3.43.0 (a corner case fixed in the
# releases after it) and ledger.js sums compensated too, so two totals rounded to 4 dp
# differ by at most one step; an older SQLite keeps the old order-dependent tolerance.
TOL = 1e-4 + 1e-12 if sqlite3.sqlite_version_info >= (3, 44) else 5e-4


def hand_ledger(run="RUN-hand-s1-h00000000", shift=0):
    """The hand ledger; `shift` moves every terminal event and retirement later (v3.37 compare)."""
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
    if shift:
        for h in hus:
            if h["retired_tick"] is not None:
                h["retired_tick"] += shift
        for e in events:
            if e["kind"] in ("delivered", "restocked", "scrapped"):
                e["tick"] += shift
                e["minute"] = e["tick"] * 1.0
    return dict(schema=RL.SCHEMA_ID,
                run=dict(id=run, scenario="hand", seed=1, hash="00000000", mix={"case-pick": 0.5, "cross-dock": 0.3, "returns": 0.2},
                         profile="ecommerce", ticks_per_hour=60, minutes_per_tick=1.0, ticks=40 + shift, honesty="hand-built test ledger"),
                profile=dict(id="ecommerce", label="E-commerce", box="case-400x300x250", pallet="eur", eaches_per_case=12, case_kg=6,
                             max_stack_mm=1800, eaches_per_parcel=6),
                locations=[dict(id="in", type="dock-in", category="flow", service_ticks=None), dict(id="dep", type="depalletiser", category="flow", service_ticks=None),
                           dict(id="face", type="carton-flow", category="storage", service_ticks=2), dict(id="wrap", type="stretch-wrap", category="flow", service_ticks=None),
                           dict(id="stg", type="staging", category="flow", service_ticks=1), dict(id="out", type="dock-out", category="flow", service_ticks=None),
                           dict(id="ret", type="returns-station", category="flow", service_ticks=4)],
                rates=hand_rates(), hus=hus, events=events)


def hand_rates():
    """The default analytics catalogue (illustrative teaching rates), transport by a manned forklift."""
    eq = {"racking": (8000, 15, 0.15, 1), "asrs": (250000, 12, 15, 0), "shuttle": (180000, 10, 8, 0), "conveyor": (12000, 10, 1.5, 0),
          "amr": (45000, 8, 2, 0), "forklift": (35000, 8, 3, 1), "dock": (15000, 20, 0.5, 0), "workstation": (6000, 10, 0.6, 1),
          "wrapper": (20000, 12, 2, 0), "depalletiser": (60000, 12, 4, 0), "charging": (8000, 10, 0.2, 0)}
    cls = {"dock-in": ("dock", 0), "depalletiser": ("depalletiser", 0), "carton-flow": ("racking", 1), "stretch-wrap": ("wrapper", 0),
           "staging": (None, 1), "dock-out": ("dock", 0), "returns-station": ("workstation", 1)}
    return dict(source="hand", currency="EUR", labour_per_hour=35, energy_price_per_kwh=0.3, hours_per_year=4000, co2_per_kwh=0.3,
                holding_per_unit_hour=0, transport={"class": "forklift", "labour": 1},
                equipment={k: dict(capex=c, amort_years=a, power_kw=w, labour=lab) for k, (c, a, w, lab) in eq.items()},
                classes={k: {"class": c, "labour": lab} for k, (c, lab) in cls.items()}, honesty="hand-built test rates")


def fresh():
    db = RL.connect(":memory:")
    RL.initialize(db)
    return db


def fresh_with(data):
    db = fresh()
    RL.import_ledger(db, data)
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

    # ---- v3.35 what a handling unit costs -------------------------------------
    # A: moving 0-4, 4-8, waiting at the pick face 8-12 (charged its 2 service
    # ticks), moving 12-20, 20-30 -> 26 moving ticks on a manned forklift
    # (35000 / 8 / 4000 = 1.09375 EUR/h capex, 3 kW) + 2 charged ticks on manned
    # racking (8000 / 15 / 4000 = 0.13333 EUR/h, 0.15 kW), 35 EUR/h labour, 0.30 EUR/kWh.
    def test_spans_by_hand(self):
        sp = self.view("v_spans")
        tail = lambda s: s["hu_id"][-8:]  # noqa: E731
        self.assertEqual([(s["state"], s["ticks"]) for s in sp if tail(s) == "000001-1"],
                         [("moving", 4), ("moving", 4), ("waiting", 4), ("moving", 8), ("moving", 10)])
        self.assertEqual([(s["state"], s["ticks"]) for s in sp if tail(s) == "000002-1"], [("moving", 7), ("moving", 8)])
        self.assertEqual([(s["state"], s["ticks"], s["to_kind"]) for s in sp if tail(s) == "000003-1"], [("moving", 4, "queued")])
        for h in RL.rows(self.db, "SELECT id, retired_tick - spawned_tick AS cyc FROM hu WHERE run_id = ? AND retired_tick IS NOT NULL", (self.run,)):
            self.assertEqual(sum(s["ticks"] for s in sp if s["hu_id"] == h["id"]), h["cyc"], h["id"])

    def test_cost_by_hand(self):
        hu = {r["hu_id"][-8:]: r for r in self.view("v_cost_by_hu")}
        a, b, c = hu["000001-1"], hu["000002-1"], hu["000003-1"]
        self.assertEqual((a["ticks"], a["waiting_ticks"], a["moving_ticks"], a["charged_ticks"]), (30, 4, 26, 28))
        for row, want in ((a, (16.3333, 0.4784, 0.3915, 17.2032)), (b, (8.75, 0.2734, 0.225, 9.2484)), (c, (2.3333, 0.0729, 0.06, 2.4663))):
            for key, val in zip(("labour_eur", "equipment_eur", "energy_eur", "total_eur"), want):
                self.assertAlmostEqual(row[key], val, delta=TOL, msg=f"{row['hu_id']} {key}")
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertEqual((ty["case-pick"]["units"], ty["case-pick"]["eaches_out"]), (1, 48))
        self.assertAlmostEqual(ty["case-pick"]["eur_per_each"], 0.3584, delta=TOL)
        self.assertAlmostEqual(ty["cross-dock"]["eur_per_each"], 0.0161, delta=TOL)
        self.assertIsNone(ty["returns"]["eur_per_each"])
        self.assertAlmostEqual(ty["returns"]["total_eur"], 2.4663, delta=TOL)
        loc = {r["location"]: r for r in self.view("v_cost_by_location")}
        self.assertEqual(set(loc), {"face", "transport"})
        self.assertEqual((loc["face"]["class"], loc["face"]["spans"], loc["face"]["ticks"], loc["face"]["charged_ticks"]), ("racking", 1, 4, 2))
        self.assertAlmostEqual(loc["face"]["total_eur"], 1.1726, delta=TOL)
        self.assertEqual((loc["transport"]["class"], loc["transport"]["spans"], loc["transport"]["ticks"]), ("forklift", 7, 45))
        self.assertAlmostEqual(loc["transport"]["total_eur"], 27.7453, delta=TOL)
        by_type = sum(r["total_eur"] for r in ty.values())
        by_loc = sum(r["total_eur"] for r in loc.values())
        self.assertAlmostEqual(by_type, 28.9179, delta=2e-3)
        self.assertAlmostEqual(by_loc, by_type, delta=2e-3)

    def test_cost_rates_are_linear(self):
        self.db.execute("UPDATE rate SET labour_per_hour = 70 WHERE run_id = ?", (self.run,))
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertAlmostEqual(ty["case-pick"]["labour_eur"], 32.6667, delta=TOL)
        self.assertAlmostEqual(ty["case-pick"]["equipment_eur"], 0.4784, delta=TOL)
        self.assertAlmostEqual(ty["cross-dock"]["labour_eur"], 17.5, delta=TOL)
        self.db.execute("UPDATE rate SET labour_per_hour = 35, hours_per_year = 8000 WHERE run_id = ?", (self.run,))
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertAlmostEqual(ty["case-pick"]["equipment_eur"], 0.4784 / 2, delta=TOL)
        self.assertAlmostEqual(ty["case-pick"]["labour_eur"], 16.3333, delta=TOL)

    # ---- v3.40 holding cost, cost per received each, hours -----------------------
    # With 1 EUR per unit-hour waiting, A's 4 waiting ticks cost 4/60 = 0.0667 more;
    # B never waited; C's open wait opens no span. Hours are the CHARGED hours.
    def test_holding_cost_by_hand(self):
        self.db.execute("UPDATE rate SET holding_per_unit_hour = 1 WHERE run_id = ?", (self.run,))
        hu = {r["hu_id"][-8:]: r for r in self.view("v_cost_by_hu")}
        self.assertAlmostEqual(hu["000001-1"]["holding_eur"], 0.0667, delta=TOL)
        self.assertAlmostEqual(hu["000001-1"]["total_eur"], 17.2699, delta=TOL)
        self.assertAlmostEqual(hu["000001-1"]["hours"], 0.4667, delta=TOL)
        self.assertEqual((hu["000002-1"]["holding_eur"], hu["000003-1"]["holding_eur"]), (0, 0))
        self.assertAlmostEqual(hu["000002-1"]["hours"], 0.25, delta=TOL)
        loc = {r["location"]: r for r in self.view("v_cost_by_location")}
        self.assertAlmostEqual(loc["face"]["holding_eur"], 0.0667, delta=TOL)
        self.assertAlmostEqual(loc["face"]["total_eur"], 1.2393, delta=TOL)
        self.assertEqual(loc["transport"]["holding_eur"], 0)
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertEqual((ty["case-pick"]["eaches_in"], ty["cross-dock"]["eaches_in"], ty["returns"]["eaches_in"]), (576, 576, 3))
        self.assertAlmostEqual(ty["case-pick"]["holding_eur"], 0.0667, delta=TOL)
        self.assertAlmostEqual(ty["case-pick"]["eur_per_received_each"], 0.03, delta=TOL)  # 17.2699 / 576
        self.assertAlmostEqual(ty["returns"]["eur_per_received_each"], 0.8221, delta=TOL)  # 2.4663 / 3
        self.assertIsNone(ty["returns"]["eur_per_each"])
        self.db.execute("UPDATE rate SET holding_per_unit_hour = 2 WHERE run_id = ?", (self.run,))
        ty2 = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertAlmostEqual(ty2["case-pick"]["holding_eur"], 0.1333, delta=TOL)
        self.assertAlmostEqual(ty2["case-pick"]["labour_eur"], ty["case-pick"]["labour_eur"], delta=1e-9)

    def test_old_database_gains_the_holding_column_and_the_current_views(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.executescript("""
CREATE TABLE run(id TEXT PRIMARY KEY NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL, hash TEXT, mix TEXT,
  profile TEXT, ticks_per_hour INTEGER NOT NULL, minutes_per_tick REAL NOT NULL, ticks INTEGER NOT NULL, honesty TEXT);
CREATE TABLE rate(
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES run(id) ON DELETE CASCADE, currency TEXT NOT NULL DEFAULT 'EUR',
  labour_per_hour REAL NOT NULL CHECK(labour_per_hour >= 0), energy_price_per_kwh REAL NOT NULL CHECK(energy_price_per_kwh >= 0),
  hours_per_year REAL NOT NULL CHECK(hours_per_year > 0), co2_per_kwh REAL,
  transport_class TEXT, transport_labour INTEGER NOT NULL DEFAULT 0 CHECK(transport_labour IN (0, 1)), source TEXT, honesty TEXT);
CREATE VIEW v_span_cost AS SELECT 1 AS stale;
""")
        RL.initialize(db)
        RL.initialize(db)  # idempotent
        cols = [r["name"] for r in db.execute("PRAGMA table_info(rate)").fetchall()]
        self.assertIn("holding_per_unit_hour", cols)
        sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'v_span_cost'").fetchone()["sql"]
        self.assertIn("holding_eur", sql)
        self.assertNotIn("stale", sql)
        RL.import_ledger(db, hand_ledger())
        self.assertEqual(len(RL.rows(db, "SELECT * FROM v_cost_by_type")), 3)

    def test_cost_views_are_empty_without_rates(self):
        d = hand_ledger()
        del d["rates"]
        db = fresh()
        run = RL.import_ledger(db, d)
        self.assertEqual(RL.rows(db, "SELECT * FROM v_cost_by_type WHERE run_id = ?", (run,)), [])
        self.assertEqual(RL.rows(db, "SELECT * FROM v_cost_by_location WHERE run_id = ?", (run,)), [])
        self.assertEqual(len(RL.rows(db, "SELECT * FROM v_spans WHERE run_id = ?", (run,))), 8)

    # ---- v3.36 the flow as recorded ------------------------------------------
    def test_flow_links_by_hand(self):
        links = [(r["from_op"], r["to_op"], r["units"], r["retired_units"], r["eaches"]) for r in self.view("v_flow_links")]
        self.assertEqual(links, [("case-pick", "palletise", 1, 1, 48), ("depalletise", "case-pick", 1, 1, 576), ("palletise", "load", 1, 1, 48),
                                 ("receive", "depalletise", 1, 1, 576), ("receive", "stage-out", 1, 1, 576), ("stage-out", "load", 1, 1, 576)])
        # C has a single non-queued event -> no link; queued events never link

    def test_flow_links_conserve_units_at_every_operation(self):
        self.assert_flow_identity()

    def assert_flow_identity(self):
        """For every operation X: units entering X = units with a non-queued event at X minus those that started there."""
        entering = {r["to_op"]: r["n"] for r in RL.rows(self.db, "SELECT to_op, SUM(units) AS n FROM v_flow_links WHERE run_id = ? GROUP BY to_op", (self.run,))}
        at = {r["op"]: r["n"] for r in RL.rows(self.db,
            "SELECT e.op, COUNT(DISTINCT e.hu_id) AS n FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE h.run_id = ? AND e.kind <> 'queued' GROUP BY e.op", (self.run,))}
        first = {r["op"]: r["n"] for r in RL.rows(self.db,
            "SELECT op, COUNT(*) AS n FROM (SELECT e.hu_id, e.op FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE h.run_id = ? AND e.kind <> 'queued' "
            "AND e.version = (SELECT MIN(x.version) FROM handling_event x WHERE x.hu_id = e.hu_id AND x.kind <> 'queued')) GROUP BY op", (self.run,))}
        for op, n in at.items():
            self.assertEqual(entering.get(op, 0), n - first.get(op, 0), op)

    # ---- v3.37 compare two runs ----------------------------------------------
    # B is the same ledger with every terminal event and retirement 10 ticks later.
    def test_compare_two_runs_by_hand(self):
        b = hand_ledger("RUN-hand-s2-h00000001", shift=10)
        run_b = RL.import_ledger(self.db, b)
        c = RL.compare(self.db, self.run, run_b)
        cyc = {r["archetype"]: r for r in c["v_compare_cycle"]}
        self.assertEqual((cyc["case-pick"]["avg_cycle_ticks_a"], cyc["case-pick"]["avg_cycle_ticks_b"], cyc["case-pick"]["delta_avg_cycle_ticks"]), (30.0, 40.0, 10.0))
        self.assertEqual(cyc["cross-dock"]["delta_avg_cycle_ticks"], 10.0)
        self.assertEqual((cyc["returns"]["units_a"], cyc["returns"]["units_b"], cyc["returns"]["delta_units"], cyc["returns"]["delta_avg_cycle_ticks"]), (1, 1, 0, None))
        self.assertEqual({r["archetype"]: r["delta_touches"] for r in c["v_compare_touches"]}, {"case-pick": 0.0, "cross-dock": 0.0, "returns": 0.0})
        d = c["v_compare_dispatch"][0]
        self.assertEqual((d["pallets_a"], d["pallets_b"], d["delta_pallets"], d["delta_trailers"]), (2, 2, 0, 0))
        cost = {r["archetype"]: r for r in c["v_compare_cost"]}
        self.assertAlmostEqual(cost["case-pick"]["delta_total_eur"], 6.1656, delta=TOL)  # 10 more forklift ticks = 1/6 h x (35 + 1.09375 + 0.9)
        self.assertAlmostEqual(cost["cross-dock"]["delta_total_eur"], 6.1656, delta=TOL)
        self.assertAlmostEqual(cost["returns"]["delta_total_eur"], 0.0, delta=TOL)
        s = c["v_compare_summary"][0]
        self.assertEqual((s["delta_units"], s["delta_events"], s["delta_delivered"], s["delta_delivered_eaches"]), (0, 0, 0, 0))
        w = {(r["location"], r["op"]): r for r in c["v_compare_wait"]}
        self.assertEqual((w[("face", "case-pick")]["delta_waits"], w[("ret", "inspect")]["delta_still_waiting"], w[("ret", "inspect")]["delta_avg_wait_ticks"]), (0, 0, None))
        # the reverse pair negates every delta
        r = RL.compare(self.db, run_b, self.run)
        self.assertEqual({x["archetype"]: x["delta_avg_cycle_ticks"] for x in r["v_compare_cycle"]}["case-pick"], -10.0)
        self.assertAlmostEqual({x["archetype"]: x["delta_total_eur"] for x in r["v_compare_cost"]}["case-pick"], -6.1656, delta=TOL)

    def test_compare_keeps_a_key_seen_in_one_run_only(self):
        b = hand_ledger("RUN-hand-s3-h00000002")
        b["hus"] = [h for h in b["hus"] if h["archetype"] != "cross-dock"]
        b["events"] = [e for e in b["events"] if "000002" not in e["hu_id"]]
        run_b = RL.import_ledger(self.db, b)
        cyc = {r["archetype"]: r for r in RL.compare(self.db, self.run, run_b)["v_compare_cycle"]}
        self.assertEqual((cyc["cross-dock"]["units_a"], cyc["cross-dock"]["units_b"], cyc["cross-dock"]["delta_units"]), (1, None, None))
        self.assertEqual(RL.compare(self.db, self.run, run_b)["v_compare_summary"][0]["delta_units"], -1)

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


class Report(unittest.TestCase):
    """tools/run_ledger.py report (v3.41): one deterministic Markdown report from the views."""

    def setUp(self):
        self.db = fresh()
        self.run = RL.import_ledger(self.db, hand_ledger())

    def test_report_names_every_planner_view_and_the_run(self):
        md = RL.report(self.db, self.run)
        self.assertIn(f"# Run report: {self.run}", md)
        for name in RL.PLANNER_VIEWS:
            self.assertIn(f"### {name}", md)
        self.assertIn("Invariant violations: 0", md)
        self.assertIn("| case-pick | 1 | 1 | 30.0 | 30.0 | 30 | 30 |", md)
        self.assertIn("order mix: case-pick 50% · cross-dock 30% · returns 20%", md)
        self.assertIn("1 of 3 units were still in flight", md)
        self.assertNotIn("run_id", md.split("## Planner views")[1].split("## Cost detail")[0])
        self.assertEqual(md, RL.report(self.db, self.run))  # deterministic

    def test_report_compare_section(self):
        b = hand_ledger("RUN-hand-s2-h00000001", shift=10)
        run_b = RL.import_ledger(self.db, b)
        md = RL.report(self.db, self.run, (self.run, run_b))
        self.assertIn("### v_compare_cycle", md)
        cycle = md.split("### v_compare_cycle")[1].split("###")[0]
        self.assertIn("| case-pick | 1 | 1 | 0 | 1 | 1 | 0 | 30.0 | 40.0 | 10.0 |", cycle)
        self.assertNotIn("### v_compare_cycle", RL.report(self.db, self.run))

    def test_md_table_escapes_pipes_and_nulls(self):
        self.assertEqual(RL.md_table([{"a": "x|y", "b": None}], ["a", "b"]), "| a | b |\n|---|---|\n| x\\|y | \u2014 |\n")
        self.assertEqual(RL.md_table([], ["a"]), "(no rows)\n")
        self.assertEqual(RL.md_table([{"run_id": "r", "k": 1}]), "| k |\n|---|\n| 1 |\n")

    def test_views_all_lists_detail_views(self):
        self.assertTrue(set(RL.DETAIL_VIEWS) <= set(RL.VIEWS))
        for group in (RL.PLANNER_VIEWS, RL.INVARIANT_VIEWS, RL.COMPARE_VIEWS):
            self.assertFalse(set(RL.DETAIL_VIEWS) & set(group))


class ViewerSql(unittest.TestCase):
    """run-ledger-sql.js (v3.39): the SQL the viewer shows IS the SQL the tool runs."""

    @staticmethod
    def parts():
        text = XV.render()
        end = text.index("};")  # the object literal ends at the first "};" (no SQL body contains a brace)
        obj = json.loads(text[text.index("{"):end + 1])
        marker = "window.RunLedgerSQLMeta = "
        meta = json.loads(text[text.index(marker) + len(marker):].rstrip().rstrip(";"))
        return text, obj, meta

    def test_committed_viewer_sql_is_fresh(self):
        committed = (ROOT / "run-ledger-sql.js").read_text(encoding="utf-8")
        self.assertEqual(committed, XV.render(), "stale: python tools/export_viewer_sql.py")

    def test_viewer_sql_is_every_view_minus_the_prefix(self):
        _text, obj, meta = self.parts()
        self.assertEqual(list(obj), list(RL.VIEWS))
        for name, body in obj.items():
            self.assertTrue(RL.VIEWS[name].lstrip().startswith(f"CREATE VIEW IF NOT EXISTS {name} AS"), name)
            self.assertTrue(RL.VIEWS[name].endswith(body), name)
            self.assertIn(body.split(None, 1)[0].upper(), ("SELECT", "WITH"), name)
            self.assertNotIn("...", body, name)
        for group in ("planner", "invariant", "detail", "compare"):
            self.assertTrue(set(meta[group]) <= set(obj), group)
        self.assertEqual(meta["views"], len(RL.VIEWS))

    def test_viewer_sql_text_runs_in_sqlite_as_shown(self):
        db = fresh()
        RL.import_ledger(db, hand_ledger())
        _text, obj, _meta = self.parts()
        for _name, body in obj.items():
            db.execute("SELECT * FROM (" + body.rstrip().rstrip(";") + ") LIMIT 1").fetchall()


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

    def test_sql_cost_equals_javascript_views(self):
        js = json.loads((FIX / "run-ledger.views.json").read_text(encoding="utf-8"))
        s = RL.summary(self.db, self.run)
        by_type = {r["archetype"]: r for r in s["v_cost_by_type"]}
        self.assertEqual(set(by_type), {t["archetype"] for t in js["costByType"]})
        for want in js["costByType"]:
            got = by_type[want["archetype"]]
            self.assertEqual((got["units"], got["retired"], got["eaches_in"], got["eaches_out"]), (want["units"], want["retired"], want["eaches_in"], want["eaches_out"]), want["archetype"])
            for key in ("hours", "labour_eur", "equipment_eur", "energy_eur", "holding_eur", "total_eur", "eur_per_unit", "eur_per_received_each"):
                self.assertAlmostEqual(got[key], want[key], delta=TOL, msg=f"{want['archetype']} {key}")
            if want["eur_per_each"] is None:
                self.assertIsNone(got["eur_per_each"], want["archetype"])
            else:
                self.assertAlmostEqual(got["eur_per_each"], want["eur_per_each"], delta=TOL, msg=want["archetype"])
        by_loc = {r["location"]: r for r in s["v_cost_by_location"]}
        self.assertEqual(set(by_loc), {r["location"] for r in js["costByLocation"]})
        for want in js["costByLocation"]:
            got = by_loc[want["location"]]
            self.assertEqual((got["class"], got["spans"], got["ticks"]), (want["class"], want["spans"], want["ticks"]), want["location"])
            self.assertAlmostEqual(got["charged_ticks"], want["charged_ticks"], delta=1e-6)
            for key in ("hours", "labour_eur", "equipment_eur", "energy_eur", "holding_eur", "total_eur"):
                self.assertAlmostEqual(got[key], want[key], delta=TOL, msg=f"{want['location']} {key}")
        # seven per-type totals rounded to 4 dp against one rounded grand total: at most 8 x 5e-5
        self.assertAlmostEqual(sum(r["total_eur"] for r in s["v_cost_by_type"]), js["costTotal"]["total_eur"], delta=5e-4)
        self.assertGreater(js["costTotal"]["total_eur"], 0)

    def test_dataset_and_order_line_columns_round_trip(self):
        """v3.44: run.dataset and the unit's order_ref / sku / line_qty land in SQL and in v_run_summary."""
        data = hand_ledger("RUN-hand-s1-h0000000d")
        data["run"]["dataset"] = {"source": "hand pool", "orders": 2, "lines": 3, "skus": 3}
        data["hus"][0].update(order_ref="A", sku="S1", line_qty=2)
        data["hus"][1].update(order_ref="B", sku="S2", line_qty=48)
        db = fresh()
        rid = RL.import_ledger(db, data)
        top = RL.rows(db, "SELECT dataset_source, dataset_orders, dataset_lines FROM v_run_summary WHERE run_id = ?", (rid,))[0]
        self.assertEqual(dict(top), {"dataset_source": "hand pool", "dataset_orders": 2, "dataset_lines": 3})
        hus = {r["id"][-8:]: r for r in RL.rows(db, "SELECT id, order_ref, sku, line_qty FROM hu WHERE run_id = ? ORDER BY seq", (rid,))}
        self.assertEqual((hus["000001-1"]["order_ref"], hus["000001-1"]["sku"], hus["000001-1"]["line_qty"]), ("A", "S1", 2))
        self.assertEqual((hus["000002-1"]["order_ref"], hus["000002-1"]["line_qty"]), ("B", 48))
        self.assertIsNone(hus["000003-1"]["order_ref"])
        plain = RL.rows(fresh_with(hand_ledger()), "SELECT dataset_source, dataset_orders FROM v_run_summary")[0]
        self.assertEqual((plain["dataset_source"], plain["dataset_orders"]), (None, None))

    def test_old_database_gains_the_dataset_and_order_line_columns(self):
        """v3.44: a database from before v3.44 gains the seven columns on open and imports a pooled run."""
        db = fresh()
        for table, column in (("run", "dataset_source"), ("run", "dataset_orders"), ("run", "dataset_lines"), ("run", "dataset_skus"),
                              ("hu", "order_ref"), ("hu", "sku"), ("hu", "line_qty")):
            for name in RL.VIEWS:
                db.execute(f"DROP VIEW IF EXISTS {name}")
            db.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        cols = {r["name"] for r in RL.rows(db, "PRAGMA table_info(hu)")}
        self.assertNotIn("order_ref", cols)
        RL.initialize(db)
        cols = {r["name"] for r in RL.rows(db, "PRAGMA table_info(hu)")} | {r["name"] for r in RL.rows(db, "PRAGMA table_info(run)")}
        self.assertTrue({"order_ref", "sku", "line_qty", "dataset_source", "dataset_orders", "dataset_lines", "dataset_skus"} <= cols)
        data = hand_ledger()
        data["run"]["dataset"] = {"source": "x", "orders": 1, "lines": 1, "skus": 1}
        data["hus"][0].update(order_ref="A", sku="S1", line_qty=2)
        self.assertEqual(RL.import_ledger(db, data), data["run"]["id"])
        self.assertEqual(RL.rows(db, "SELECT line_qty FROM hu WHERE order_ref = 'A'")[0]["line_qty"], 2)

    def test_dispatch_by_order_by_hand(self):
        """v3.44: the hand ledger's three one-line orders: 4 cases -> 1 pallet, 48 -> 1, the live return -> 0."""
        db = fresh_with(hand_ledger())
        rows = {r["order_id"][-6:]: r for r in RL.rows(db, "SELECT * FROM v_dispatch_by_order")}
        self.assertEqual(sorted(rows), ["000001", "000002", "000003"])
        a, b, c = rows["000001"], rows["000002"], rows["000003"]
        self.assertEqual((a["lines"], a["delivered_lines"], a["eaches_in"], a["eaches_out"], a["cases"], a["cases_per_pallet"], a["pallets_needed"]), (1, 1, 576, 48, 4, 48, 1))
        self.assertEqual((b["lines"], b["delivered_lines"], b["eaches_out"], b["cases"], b["pallets_needed"]), (1, 1, 576, 48, 1))
        self.assertEqual((c["lines"], c["delivered_lines"], c["eaches_in"], c["eaches_out"], c["cases"], c["pallets_needed"]), (1, 0, 3, 0, 0, 0))
        self.assertIsNone(a["order_ref"])

    def test_consolidation_at_dispatch_two_lines_one_order(self):
        """v3.44: a second delivered case-pick line of order 1 - 4 + 4 cases need ONE customer pallet although the flow moved two units."""
        data = hand_ledger()
        a = data["hus"][0]
        a2 = dict(a, id=a["id"][:-2] + "-2", seq=4, sscc="340123459999999999", order_ref="A", sku="S9", line_qty=48)
        data["hus"].append(a2)
        evs = [dict(e, id=f"EVT-{a2['id']}-{e['version']}", hu_id=a2["id"]) for e in data["events"] if e["hu_id"] == a["id"]]
        data["events"].extend(evs)
        db = fresh_with(data)
        row = RL.rows(db, "SELECT * FROM v_dispatch_by_order WHERE order_id LIKE '%000001'")[0]
        self.assertEqual((row["lines"], row["delivered_lines"], row["eaches_out"], row["cases"], row["pallets_needed"], row["order_ref"]), (2, 2, 96, 8, 1, "A"))
        self.assertEqual(RL.rows(db, "SELECT SUM(final_pallets) AS p FROM hu WHERE order_id LIKE '%000001'")[0]["p"], 2)
        self.assertEqual(RL.summary(db, data["run"]["id"])["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_staffing_view_by_hand(self):
        """v3.45: a bench gains a worker at tick 5 and loses it at tick 20 in a 40-tick run -> 2 changes, max 2, first 5, 15 ticks with the extra worker."""
        data = hand_ledger("RUN-hand-s1-h0000000e")
        data["run"]["policy"] = {"kind": "queue-staffing", "threshold": 6, "maxServers": 2, "cooldownTicks": 30}
        data["run"]["ticks"] = 40
        data["staffing"] = [{"tick": 5, "location_id": "face", "servers": 2}, {"tick": 20, "location_id": "face", "servers": 1},
                            {"tick": 30, "location_id": "pack", "servers": 2}]
        db = fresh_with(data)
        rows = {r["location_id"]: r for r in RL.rows(db, "SELECT * FROM v_staffing WHERE run_id = ?", (data["run"]["id"],))}
        self.assertEqual(sorted(rows), ["face", "pack"])
        f = rows["face"]
        self.assertEqual((f["changes"], f["max_servers"], f["first_change_tick"], f["ticks_with_extra_server"]), (2, 2, 5, 15))
        p = rows["pack"]
        self.assertEqual((p["changes"], p["max_servers"], p["first_change_tick"], p["ticks_with_extra_server"]), (1, 2, 30, 10))
        top = RL.rows(db, "SELECT policy FROM v_run_summary WHERE run_id = ?", (data["run"]["id"],))[0]
        self.assertEqual(json.loads(top["policy"]), data["run"]["policy"])
        self.assertEqual(RL.summary(db, data["run"]["id"])["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_staffing_view_is_empty_without_a_policy(self):
        db = fresh_with(hand_ledger())
        self.assertEqual(RL.rows(db, "SELECT * FROM v_staffing"), [])
        self.assertIsNone(RL.rows(db, "SELECT policy FROM v_run_summary")[0]["policy"])
        self.assertIn("v_staffing", RL.PLANNER_VIEWS)

    def test_old_database_gains_the_policy_column_and_the_staffing_table(self):
        """v3.45: a database from before v3.45 gains run.policy and staffing_event on open."""
        db = fresh()
        for name in RL.VIEWS:
            db.execute(f"DROP VIEW IF EXISTS {name}")
        db.execute("DROP TABLE staffing_event")
        db.execute("ALTER TABLE run DROP COLUMN policy")
        RL.initialize(db)
        self.assertIn("policy", {r["name"] for r in RL.rows(db, "PRAGMA table_info(run)")})
        self.assertEqual(RL.rows(db, "SELECT name FROM sqlite_master WHERE name = 'staffing_event'")[0]["name"], "staffing_event")
        data = hand_ledger()
        data["staffing"] = [{"tick": 1, "location_id": "face", "servers": 2}]
        RL.import_ledger(db, data)
        self.assertEqual(RL.rows(db, "SELECT changes FROM v_staffing")[0]["changes"], 1)

    def _replicated_hand(self, shifts=(0, 2, 4)):
        """Three hand ledgers that differ only in seed (and the shift that moves the terminal events)."""
        db = fresh()
        for k, shift in enumerate(shifts, start=1):
            data = hand_ledger(f"RUN-hand-s{k}-h0000000{k}", shift=shift)
            data["run"]["seed"] = k
            data["run"]["ticks"] = 40  # one group: the same scenario, mix, ticks and (no) policy
            RL.import_ledger(db, data)
        return db

    def test_replications_by_hand(self):
        """v3.46: case-pick cycles 30 / 32 / 34 -> n 3, mean 32, s 2, t(2) = 4.303 -> half-width 4.9687; cross-dock 15 / 17 / 19 likewise."""
        db = self._replicated_hand()
        groups = RL.rows(db, "SELECT * FROM v_replication_groups")
        self.assertEqual(len(groups), 1)
        self.assertEqual((groups[0]["scenario"], groups[0]["ticks"], groups[0]["n"]), ("hand", 40, 3))
        self.assertEqual(sorted(groups[0]["seeds"].split(",")), ["1", "2", "3"])
        cyc = {r["archetype"]: r for r in RL.rows(db, "SELECT * FROM v_replication_cycle_by_type")}
        self.assertEqual(sorted(cyc), ["case-pick", "cross-dock"])  # the live return has no cycle
        c = cyc["case-pick"]
        self.assertEqual((c["n"], c["mean"], c["stdev"], c["min"], c["max"]), (3, 32.0, 2.0, 30.0, 34.0))
        self.assertAlmostEqual(c["ci95_half"], 4.303 * 2 / math.sqrt(3), places=4)
        self.assertEqual(c["ci95_half"], 4.9687)
        x = cyc["cross-dock"]
        self.assertEqual((x["mean"], x["stdev"], x["ci95_half"]), (17.0, 2.0, 4.9687))
        cost = {r["archetype"]: r for r in RL.rows(db, "SELECT * FROM v_replication_cost_by_type")}
        self.assertEqual(cost["returns"]["stdev"], 0.0)  # the return never moves later
        self.assertAlmostEqual(cost["case-pick"]["stdev"], 1.2331, delta=1e-3)  # +6.1656 per 10 ticks -> 1.2331 per 2
        summ = {r["metric"]: r for r in RL.rows(db, "SELECT * FROM v_replication_summary")}
        self.assertEqual((summ["units"]["n"], summ["units"]["mean"], summ["units"]["stdev"]), (3, 3.0, 0.0))
        self.assertEqual(summ["delivered"]["mean"], 2.0)
        self.assertGreater(summ["total_eur"]["stdev"], 0)

    def test_replication_of_one_run_has_no_interval(self):
        db = fresh_with(hand_ledger())
        rows = RL.rows(db, "SELECT * FROM v_replication_cycle_by_type")
        self.assertTrue(rows and all(r["n"] == 1 and r["stdev"] is None and r["ci95_half"] is None for r in rows))
        self.assertEqual(RL.rows(db, "SELECT n FROM v_replication_groups")[0]["n"], 1)

    def test_t_table_and_sqrt(self):
        db = fresh()
        self.assertEqual(RL.rows(db, "SELECT t975 FROM t_critical WHERE df = 2")[0]["t975"], 4.303)
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM t_critical")[0]["n"], 30)
        self.assertEqual(RL.rows(db, "SELECT sqrt(4) AS s")[0]["s"], 2.0)
        self.assertEqual(RL.T975[1], 12.706)
        self.assertTrue(all(RL.T975[d] > RL.T975[d + 1] for d in range(1, 30)))
        self.assertIn("REPLICATION_VIEWS", XV.GROUPS)
        self.assertEqual(RL.REPLICATION_VIEWS, ("v_replication_groups", "v_replication_cycle_by_type", "v_replication_cost_by_type", "v_replication_summary"))

    def test_service_ticks_round_trip_unrounded(self):
        """v3.43: a declared-capacity station's service time is stored as recorded, not rounded."""
        data = hand_ledger("RUN-hand-s1-h0000000c")
        data["locations"] = [dict(id="face", type="carton-flow", category="storage", service_ticks=1.8237082066869301)]
        db = fresh()
        rid = RL.import_ledger(db, data)
        got = RL.rows(db, "SELECT service_ticks FROM location WHERE run_id = ? AND id = 'face'", (rid,))[0]["service_ticks"]
        self.assertEqual(got, 1.8237082066869301)
        charged = RL.rows(db, "SELECT charged_ticks FROM v_span_cost WHERE run_id = ? AND state = 'waiting' AND location = 'face'", (rid,))
        self.assertTrue(charged and all(r["charged_ticks"] == 1.8237082066869301 for r in charged))

    def test_reconcile_measures_sql_against_javascript_rows(self):
        """v3.43: the reconcile tool passes on identical rows and fails on a 2e-4 nudge or a missing key."""
        db = fresh()
        rid = RL.import_ledger(db, hand_ledger())
        views = {v: RL.rows(db, f"SELECT * FROM {v} WHERE run_id = ?", (rid,)) for v in RL.RECONCILE_KEYS}
        for v in views.values():
            for r in v:
                r.pop("run_id", None)
        ok, table = RL.reconcile(db, rid, {"run": rid, "views": views})
        self.assertTrue(ok, [r for r in table if not r["ok"]])
        self.assertEqual({r["view"] for r in table}, set(RL.RECONCILE_KEYS))
        self.assertTrue(all(r["max_abs_delta"] == 0.0 for r in table if r["max_abs_delta"] is not None))
        nudged = json.loads(json.dumps(views))
        nudged["v_cost_by_type"][0]["eur_per_each"] = (nudged["v_cost_by_type"][0]["eur_per_each"] or 0) + 2e-4
        ok, table = RL.reconcile(db, rid, {"views": nudged})
        self.assertFalse(ok)
        bad = [r for r in table if not r["ok"]]
        self.assertEqual([(r["view"], r["column"]) for r in bad], [("v_cost_by_type", "eur_per_each")])
        self.assertAlmostEqual(bad[0]["max_abs_delta"], 2e-4, delta=1e-9)
        short = json.loads(json.dumps(views))
        short["v_cost_by_hu"].pop()
        ok, table = RL.reconcile(db, rid, {"views": short})
        self.assertFalse(ok)
        self.assertIn(("v_cost_by_hu", "<rows>"), [(r["view"], r["column"]) for r in table if not r["ok"]])

    def test_sql_flow_links_equal_javascript(self):
        js = json.loads((FIX / "run-ledger.views.json").read_text(encoding="utf-8"))["flowLinks"]
        sql = [{k: r[k] for k in ("from_op", "to_op", "units", "retired_units", "eaches")} for r in
               RL.rows(self.db, "SELECT * FROM v_flow_links WHERE run_id = ? ORDER BY from_op, to_op", (self.run,))]
        self.assertEqual(sql, js)
        self.assertGreater(len(sql), 10)
        HandLedger.assert_flow_identity(self)

    @unittest.skipUnless(shutil.which("node") and (FIX / "run-ledger-c.json").exists(), "node or fixture C missing")
    def test_reconcile_every_recorded_fixture_against_javascript(self):
        """v3.43: the JavaScript rows of every view (node) against SQLite's, for A, B and C."""
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([shutil.which("node"), str(ROOT / "tools" / "make_run_ledger_fixture.mjs"), "reconcile", tmp], cwd=str(ROOT), check=True, capture_output=True)
            for base in ("run-ledger", "run-ledger-b", "run-ledger-c"):
                db = fresh()
                rid = RL.import_ledger(db, json.loads((FIX / f"{base}.json").read_text(encoding="utf-8")))
                js = json.loads((Path(tmp) / f"{base}.reconcile.json").read_text(encoding="utf-8"))
                self.assertEqual(js["run"], rid)
                ok, table = RL.reconcile(db, rid, js, tolerance=TOL, tolerance_raw=1e-9)
                self.assertTrue(ok, (base, [r for r in table if not r["ok"]]))
                self.assertGreaterEqual(sum(1 for r in table if not r["column"].startswith("<")), 60, base)

    @unittest.skipUnless((FIX / "run-ledger-d.json").exists(), "fixture D not generated")
    def test_fixture_d_records_the_sample_order_file(self):
        """v3.44: fixture D = fixture C's floor fed docs/examples/orders.csv through the real importer."""
        data = json.loads((FIX / "run-ledger-d.json").read_text(encoding="utf-8"))
        db = fresh()
        rid = RL.import_ledger(db, data)
        top = RL.rows(db, "SELECT * FROM v_run_summary WHERE run_id = ?", (rid,))[0]
        self.assertEqual((top["dataset_orders"], top["dataset_lines"]), (300, data["run"]["dataset"]["lines"]))
        self.assertIn("synthetic", top["dataset_source"])
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM hu WHERE run_id = ? AND order_ref IS NULL", (rid,))[0]["n"], 0)
        self.assertGreater(RL.rows(db, "SELECT COUNT(*) AS n FROM hu WHERE run_id = ? AND id NOT LIKE '%-1'", (rid,))[0]["n"], 0)
        by_order = RL.rows(db, "SELECT * FROM v_dispatch_by_order WHERE run_id = ?", (rid,))
        self.assertTrue(by_order and all(r["order_ref"].startswith("ORD-") for r in by_order))
        self.assertEqual(RL.summary(db, rid)["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})
        self.assertNotEqual(rid, RL.import_ledger(fresh(), json.loads((FIX / "run-ledger-c.json").read_text(encoding="utf-8"))))

    @unittest.skipUnless((FIX / "run-ledger-c.json").exists(), "fixture C not generated")
    def test_fixture_c_serves_at_declared_capacities(self):
        """v3.43: the library floor's eight stations carry service times from wms capacities, none at the floor rate."""
        data = json.loads((FIX / "run-ledger-c.json").read_text(encoding="utf-8"))
        db = fresh()
        rid = RL.import_ledger(db, data)
        self.assertTrue(rid.startswith("RUN-ecommerce-multichannel-fc-s6-h"))
        st = RL.rows(db, "SELECT id, service_ticks FROM location WHERE run_id = ? AND service_ticks IS NOT NULL ORDER BY id", (rid,))
        self.assertEqual(len(st), 8)
        self.assertTrue(all(0.5 < r["service_ticks"] < 3 for r in st), st)
        self.assertEqual(RL.summary(db, rid)["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})
        self.assertEqual(data["rates"]["transport"]["class"], "amr")
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM hu WHERE run_id = ?", (rid,))[0]["n"], len(data["hus"]))

    @unittest.skipUnless((FIX / "run-ledger-b.json").exists(), "fixture B not generated")
    def test_compare_the_two_recorded_runs(self):
        b = json.loads((FIX / "run-ledger-b.json").read_text(encoding="utf-8"))
        run_b = RL.import_ledger(self.db, b)
        self.assertNotEqual(run_b, self.run)
        sa, sb = RL.summary(self.db, self.run), RL.summary(self.db, run_b)
        self.assertEqual(sb["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})
        ca = {r["archetype"]: r for r in sa["v_cycle_time_by_type"]}
        cb = {r["archetype"]: r for r in sb["v_cycle_time_by_type"]}
        c = RL.compare(self.db, self.run, run_b)
        self.assertEqual({r["archetype"] for r in c["v_compare_cycle"]}, set(ca) | set(cb))
        for r in c["v_compare_cycle"]:
            self.assertEqual(r["units_a"], ca[r["archetype"]]["units"] if r["archetype"] in ca else None, r["archetype"])
            self.assertEqual(r["units_b"], cb[r["archetype"]]["units"] if r["archetype"] in cb else None, r["archetype"])
        self.assertEqual(c["v_compare_summary"][0]["delta_units"], sb["v_run_summary"][0]["units"] - sa["v_run_summary"][0]["units"])
        self.assertEqual(max(cb, key=lambda k: cb[k]["units"]), "cross-dock")
        # B's own views equal its committed JavaScript tables
        jb = json.loads((FIX / "run-ledger-b.views.json").read_text(encoding="utf-8"))
        cost_b = {r["archetype"]: r for r in sb["v_cost_by_type"]}
        for t in jb["costByType"]:
            self.assertAlmostEqual(cost_b[t["archetype"]]["total_eur"], t["total_eur"], delta=TOL, msg=t["archetype"])
        links_b = [{k: r[k] for k in ("from_op", "to_op", "units", "retired_units", "eaches")} for r in
                   RL.rows(self.db, "SELECT * FROM v_flow_links WHERE run_id = ? ORDER BY from_op, to_op", (run_b,))]
        self.assertEqual(links_b, jb["flowLinks"])

    @unittest.skipUnless((FIX / "run-ledger-b.json").exists() and (ROOT / "docs" / "examples" / "run-report.md").exists(), "example report not generated")
    def test_committed_example_report_is_fresh(self):
        b = json.loads((FIX / "run-ledger-b.json").read_text(encoding="utf-8"))
        run_b = RL.import_ledger(self.db, b)
        md = RL.report(self.db, self.run, (self.run, run_b))
        committed = (ROOT / "docs" / "examples" / "run-report.md").read_text(encoding="utf-8")
        self.assertEqual(committed, md, "stale: regenerate docs/examples/run-report.md (see docs/RUN_LEDGER_SCHEMA.md section 6)")
        self.assertIn("Invariant violations: 0", md)
        self.assertIn("### v_compare_cost", md)

    def test_every_gs1_number_is_unique_and_18_or_14_digits(self):
        ssccs = RL.rows(self.db, "SELECT sscc, gtin14 FROM hu WHERE run_id = ?", (self.run,))
        self.assertEqual(len({r["sscc"] for r in ssccs}), len(ssccs))
        self.assertTrue(all(len(r["sscc"]) == 18 and len(r["gtin14"]) == 14 for r in ssccs))


class Tracking(unittest.TestCase):
    """v3.53 the tracking database: the Python twin of tracking.js, the derived rows, the four views."""

    def test_epc_uris_and_gln_by_hand(self):
        self.assertEqual(RL.sscc_urn("340123450000000017"), "urn:epc:id:sscc:4012345.3000000001")
        self.assertEqual(RL.sscc_urn("040123450000000031"), "urn:epc:id:sscc:4012345.0000000003")
        self.assertEqual(RL.sgtin_pattern("4012345019179"), "urn:epc:idpat:sgtin:4012345.001917.*")
        self.assertEqual(RL.sgtin_pattern("14012345019176"), "urn:epc:idpat:sgtin:4012345.101917.*")
        self.assertEqual(RL.gln_for("in"), "4012345313895")  # 1 + fnv1a("in") % 99999 = 31389, mod-10 check 5 (ids.js)
        self.assertEqual(RL.sgln_urn(RL.gln_for("in")), "urn:epc:id:sgln:4012345.31389.0")
        self.assertEqual(RL.sscc(3, 1), "340123450000000017")
        self.assertEqual(RL.sscc(0, 3), "040123450000000030")  # the same digits ids.js produces (the hand ledger types its own SSCCs)

    def test_python_twin_equals_the_committed_javascript_fixture_event_by_event(self):
        data = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        fixture = json.loads((FIX / "run-ledger.tracking.json").read_text(encoding="utf-8"))
        self.assertEqual(fixture["schema"], RL.TRACKING_SCHEMA_ID)
        py = RL.track_events(data)
        self.assertEqual(len(py), len(data["events"]))
        for a, b in zip(py, fixture["events"]):
            self.assertEqual(a, b, a["eventID"])
        self.assertEqual(py, fixture["events"])
        db = fresh_with(data)
        run = data["run"]["id"]
        sql = [tuple(r.values()) for r in RL.rows(db, "SELECT * FROM tracking_event WHERE run_id = ? ORDER BY rowid", (run,))]
        self.assertEqual(sql, [RL.tracking_row(run, ev) for ev in fixture["events"]])
        RL.import_ledger(db, data)  # idempotent: the twins are replaced, never duplicated
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event")[0]["n"], len(fixture["events"]))
        self.assertEqual(sorted(set(RL.BIZ_STEPS)), sorted(set(fixture["vocabulary"]["bizSteps"])))
        self.assertEqual(sorted(set(RL.DISPOSITIONS)), sorted(set(fixture["vocabulary"]["dispositions"])))

    def test_tracking_gaps_empty_on_every_fixture_and_fire_after_a_corruption(self):
        db = fresh()
        for name in ("run-ledger", "run-ledger-b", "run-ledger-c", "run-ledger-d"):
            data = json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))
            run = RL.import_ledger(db, data)
            self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM tracking_event WHERE run_id = ?", (run,))[0]["n"], len(data["events"]), name)
            self.assertEqual(RL.rows(db, "SELECT * FROM v_tracking_gaps WHERE run_id = ?", (run,)), [], name)
            self.assertEqual(RL.summary(db, run)["invariants"]["v_tracking_gaps"], 0, name)
        one = RL.rows(db, "SELECT id, handling_event_id FROM tracking_event WHERE run_id = ? ORDER BY rowid LIMIT 3", (run,))
        with db:
            db.execute("DELETE FROM tracking_event WHERE id = ?", (one[0]["id"],))
            db.execute("UPDATE tracking_event SET biz_step = 'waiting' WHERE id = ?", (one[1]["id"],))
            db.execute("UPDATE tracking_event SET disposition = 'lost' WHERE id = ?", (one[2]["id"],))
        gaps = RL.rows(db, "SELECT handling_event_id, gap FROM v_tracking_gaps WHERE run_id = ? ORDER BY gap", (run,))
        self.assertEqual(gaps, [{"handling_event_id": one[1]["handling_event_id"], "gap": "business step waiting"},
                                {"handling_event_id": one[2]["handling_event_id"], "gap": "disposition lost"},
                                {"handling_event_id": one[0]["handling_event_id"], "gap": "no twin"}])

    def test_bizstep_dwell_by_hand(self):
        # A: receiving@0 > unpacking@4 > picking (queued)@8 > picking@12 > packing@20 > shipping@30;
        # B: receiving@5 > staging_outbound@12 > shipping@20; C: receiving@10 (returned) > inspecting (queued)@14
        db = fresh_with(hand_ledger())
        rows_ = {r["biz_step"]: r for r in RL.rows(db, "SELECT * FROM v_bizstep_dwell WHERE run_id = ?", ("RUN-hand-s1-h00000000",))}
        want = {
            "receiving": (3, 3, 3, 5.0, 7, 0, 15, 0.0), "unpacking": (1, 1, 1, 4.0, 4, 0, 4, 0.0), "picking": (2, 1, 2, 6.0, 8, 4, 12, 0.3333),
            "packing": (1, 1, 1, 10.0, 10, 0, 10, 0.0), "staging_outbound": (1, 1, 1, 8.0, 8, 0, 8, 0.0),
            "shipping": (2, 2, 0, None, None, 0, 0, None), "inspecting": (1, 1, 0, None, None, 0, 0, None),
        }
        self.assertEqual(set(rows_), set(want))
        for step, (events, units, spans, avg, mx, waiting, total, share) in want.items():
            r = rows_[step]
            self.assertEqual((r["events"], r["units"], r["spans"], r["avg_ticks_to_next"], r["max_ticks_to_next"], r["waiting_ticks"], r["total_ticks"], r["waiting_share"]),
                             (events, units, spans, avg, mx, waiting, total, share), step)

    def test_unit_history_ordering_ticks_to_next_and_dispositions(self):
        db = fresh_with(hand_ledger())
        run = "RUN-hand-s1-h00000000"
        a = RL.rows(db, "SELECT * FROM v_unit_history WHERE run_id = ? AND hu_id = ? ORDER BY version", (run, f"HU-ORD-{run}-000001-1"))
        self.assertEqual([r["version"] for r in a], [0, 1, 2, 3, 4, 5])
        self.assertEqual([r["ticks_to_next"] for r in a], [4, 4, 4, 8, 10, None])
        self.assertEqual([r["biz_step"] for r in a], ["receiving", "unpacking", "picking", "picking", "packing", "shipping"])
        self.assertEqual([r["disposition"] for r in a], ["in_progress"] * 5 + ["in_transit"])
        self.assertEqual([r["event_type"] for r in a], ["ObjectEvent", "AggregationEvent", "ObjectEvent", "ObjectEvent", "AggregationEvent", "ObjectEvent"])
        self.assertEqual([r["action"] for r in a], ["ADD", "DELETE", "OBSERVE", "OBSERVE", "ADD", "OBSERVE"])
        c = RL.rows(db, "SELECT * FROM v_unit_history WHERE run_id = ? AND hu_id = ? ORDER BY version", (run, f"HU-ORD-{run}-000003-1"))
        self.assertEqual([(r["biz_step"], r["disposition"], r["kind"]) for r in c], [("receiving", "returned", "created"), ("inspecting", "returned", "queued")])
        ep = RL.rows(db, "SELECT * FROM v_epcis_events WHERE run_id = ? AND hu_id = ? ORDER BY version", (run, f"HU-ORD-{run}-000001-1"))
        self.assertEqual(ep[1]["parent_id"], "urn:epc:id:sscc:4012345.3000000001")
        self.assertEqual((ep[1]["epc_class"], ep[1]["quantity"]), ("urn:epc:idpat:sgtin:4012345.167890.*", 48))  # GTIN-14 14012345678908: indicator 1, item reference 67890
        self.assertEqual((ep[0]["epc"], ep[0]["quantity"], ep[0]["biz_transaction_type"], ep[0]["read_element"]), ("urn:epc:id:sscc:4012345.3000000001", 576, "po", "in"))
        self.assertIsNone(ep[5]["biz_location"])  # in transit: no business location
        self.assertEqual(RL.rows(db, "SELECT biz_transaction_type AS t FROM tracking_event WHERE hu_id = ?", (f"HU-ORD-{run}-000003-1",))[0]["t"], "rma")

    def test_tracking_views_are_grouped_reconciled_and_the_sql_equals_javascript_on_the_fixture(self):
        self.assertIn("v_bizstep_dwell", RL.PLANNER_VIEWS)
        self.assertIn("v_tracking_gaps", RL.INVARIANT_VIEWS)
        self.assertTrue({"v_epcis_events", "v_unit_history"} <= set(RL.DETAIL_VIEWS))
        self.assertTrue(set(RL.TRACKING_VIEWS) <= set(RL.VIEWS))
        self.assertEqual(len(RL.VIEWS), 37)
        self.assertEqual(RL.RECONCILE_KEYS["v_bizstep_dwell"], ("biz_step",))
        data = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        js = json.loads((FIX / "run-ledger.tracking.views.json").read_text(encoding="utf-8"))
        db = fresh_with(data)
        run = data["run"]["id"]
        sql = {r["biz_step"]: r for r in RL.rows(db, "SELECT * FROM v_bizstep_dwell WHERE run_id = ?", (run,))}
        self.assertEqual(set(sql), {r["biz_step"] for r in js["bizstepDwell"]})
        for want in js["bizstepDwell"]:
            got = sql[want["biz_step"]]
            for key in ("events", "units", "spans", "max_ticks_to_next", "waiting_ticks", "total_ticks"):
                self.assertEqual(got[key], want[key], f"{want['biz_step']} {key}")
            for key in ("avg_ticks_to_next", "waiting_share"):
                if want[key] is None:
                    self.assertIsNone(got[key], f"{want['biz_step']} {key}")
                else:
                    self.assertAlmostEqual(got[key], want[key], delta=TOL, msg=f"{want['biz_step']} {key}")
        disp = RL.rows(db, "SELECT biz_step, disposition, COUNT(*) AS events, COUNT(DISTINCT hu_id) AS units FROM tracking_event WHERE run_id = ? GROUP BY 1, 2 ORDER BY 1, 2", (run,))
        self.assertEqual(disp, js["dispositionCounts"])
        ok, table = RL.reconcile(db, run, {"run": run, "views": {"v_bizstep_dwell": js["bizstepDwell"]}})
        self.assertTrue(ok, [r for r in table if not r["ok"]])


def hand_ledger_with_a_rework():
    """The hand ledger with unit A on a mis-pick branch: case-pick, verify-pick, case-pick again (v3.54)."""
    data = hand_ledger()
    run = data["run"]["id"]
    a = data["hus"][0]
    a.update(route_id="case-pick:mis-pick@case-pick", error_kind="mis-pick", error_op="case-pick", error_outcome="rework", error_latent=["timePressure"])
    ev = lambda v, kind, op, loc, tick, p, c, e, pa, ret=0, scr=0: dict(  # noqa: E731
        id=f"EVT-{a['id']}-{v}", hu_id=a["id"], version=v, kind=kind, op=op, anchor=None, location=loc, tick=tick, minute=tick * 1.0,
        stage=None, form=None, pallets=p, cases=c, eaches=e, parcels=pa, retained=ret, scrapped=scr)
    others = [e for e in data["events"] if e["hu_id"] != a["id"]]
    data["events"] = [
        ev(0, "created", "receive", "in", 0, 1, 48, 576, 0),
        ev(1, "passed", "depalletise", "dep", 4, 0, 48, 576, 0),
        ev(2, "queued", "case-pick", "face", 8, 0, 48, 576, 0),
        ev(3, "served", "case-pick", "face", 12, 0, 4, 48, 0, ret=528),
        ev(4, "passed", "verify-pick", "face", 13, 0, 4, 48, 0, ret=528),
        ev(5, "queued", "case-pick", "face", 14, 0, 4, 48, 0, ret=528),
        ev(6, "served", "case-pick", "face", 16, 0, 4, 48, 0, ret=528),
        ev(7, "passed", "palletise", "wrap", 20, 1, 4, 48, 0, ret=528),
        ev(8, "delivered", "load", "out", 30, 1, 4, 48, 0, ret=528),
    ] + others
    data["run"]["errors"] = {"kind": "human-error", "kinds": [{"kind": "mis-pick", "ops": ["pick", "case-pick", "piece-pick", "pallet-pick"], "share": 0.02, "effective": 0.04,
                                                              "disposition": "mismatch_class", "rework": True, "source": "hand"}],
                             "psf": {"timePressure": 2, "signalToNoise": 1, "familiarity": 1}, "multiplier": 2, "latent": ["timePressure"], "cap": 0.5, "honesty": "hand"}
    assert run in a["id"]
    return data


class Quality(unittest.TestCase):
    """v3.54 human error: the quality view by hand, the columns, the tracking twin's error and its detection."""

    def test_quality_by_step_by_hand(self):
        db = fresh_with(hand_ledger_with_a_rework())
        rows_ = {r["op"]: r for r in RL.rows(db, "SELECT * FROM v_quality_by_step WHERE run_id = ?", ("RUN-hand-s1-h00000000",))}
        # A (rework at case-pick), B (cross-dock), C (a return, queued only at inspect - not through)
        self.assertEqual(set(rows_), {"receive", "depalletise", "case-pick", "verify-pick", "palletise", "stage-out", "load"})
        cp = rows_["case-pick"]
        self.assertEqual((cp["units_through"], cp["errors"], cp["reworked"], cp["scrapped_for_damage"], cp["first_pass_yield"], cp["rework_ratio"], cp["scrap_ratio"]), (1, 1, 1, 0, 0.0, 1.0, 0.0))
        self.assertEqual((rows_["receive"]["units_through"], rows_["receive"]["errors"], rows_["receive"]["first_pass_yield"]), (3, 0, 1.0))
        self.assertEqual((rows_["verify-pick"]["units_through"], rows_["verify-pick"]["errors"]), (1, 0))
        self.assertEqual((rows_["load"]["units_through"], rows_["load"]["errors"], rows_["load"]["first_pass_yield"]), (2, 0, 1.0))
        hu = RL.rows(db, "SELECT error_kind, error_op, error_outcome, error_latent FROM hu WHERE id = ?", ("HU-ORD-RUN-hand-s1-h00000000-000001-1",))[0]
        self.assertEqual(hu, {"error_kind": "mis-pick", "error_op": "case-pick", "error_outcome": "rework", "error_latent": '["timePressure"]'})
        self.assertIn('"kind": "human-error"', RL.rows(db, "SELECT errors FROM run")[0]["errors"])
        self.assertEqual(RL.summary(db, "RUN-hand-s1-h00000000")["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_quality_on_the_recorded_fixture_is_perfect_and_grouped(self):
        data = json.loads((FIX / "run-ledger.json").read_text(encoding="utf-8"))
        db = fresh_with(data)
        rows_ = RL.rows(db, "SELECT * FROM v_quality_by_step WHERE run_id = ?", (data["run"]["id"],))
        self.assertGreaterEqual(len(rows_), 10)
        self.assertTrue(all(r["errors"] == 0 and r["first_pass_yield"] == 1.0 and r["rework_ratio"] == 0.0 and r["scrap_ratio"] == 0.0 for r in rows_))
        self.assertIsNone(RL.rows(db, "SELECT errors FROM run")[0]["errors"])
        self.assertIn("v_quality_by_step", RL.PLANNER_VIEWS)
        self.assertEqual(RL.RECONCILE_KEYS["v_quality_by_step"], ("op",))

    def test_old_database_gains_the_error_columns(self):
        db = fresh()
        for name in RL.VIEWS:
            db.execute(f"DROP VIEW IF EXISTS {name}")
        for table, col in (("run", "errors"), ("hu", "error_kind"), ("hu", "error_op"), ("hu", "error_outcome"), ("hu", "error_latent"), ("tracking_event", "error_detected")):
            db.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
        RL.initialize(db)
        RL.initialize(db)  # idempotent
        self.assertIn("errors", {r["name"] for r in RL.rows(db, "PRAGMA table_info(run)")})
        self.assertTrue({"error_kind", "error_op", "error_outcome", "error_latent"} <= {r["name"] for r in RL.rows(db, "PRAGMA table_info(hu)")})
        self.assertIn("error_detected", {r["name"] for r in RL.rows(db, "PRAGMA table_info(tracking_event)")})
        RL.import_ledger(db, hand_ledger_with_a_rework())
        self.assertEqual(RL.rows(db, "SELECT errors FROM v_quality_by_step WHERE op = 'case-pick'")[0]["errors"], 1)

    def test_tracking_twin_marks_the_error_at_the_step_and_its_detection(self):
        data = hand_ledger_with_a_rework()
        db = fresh_with(data)
        a = [e for e in RL.track_events(data) if e["wt:hu_id"].endswith("000001-1")]
        self.assertEqual([e["bizStep"] for e in a], ["receiving", "unpacking", "picking", "picking", "inspecting", "picking", "picking", "packing", "shipping"])
        self.assertEqual([e["disposition"] for e in a], ["in_progress", "in_progress", "in_progress", "mismatch_class", "in_progress", "in_progress", "in_progress", "in_progress", "in_transit"])
        self.assertEqual(a[3]["wt:error"], {"kind": "mis-pick", "step": "case-pick", "detected": False, "latent": ["timePressure"]})
        self.assertEqual(a[4]["wt:error"], {"kind": "mis-pick", "step": "case-pick", "detected": True, "latent": ["timePressure"]})
        self.assertTrue(all(e["wt:error"] is None for i, e in enumerate(a) if i not in (3, 4)))
        sql = RL.rows(db, "SELECT version, disposition, error_kind, error_step, error_detected FROM tracking_event WHERE hu_id LIKE '%000001-1' ORDER BY version")
        self.assertEqual([(r["version"], r["disposition"], r["error_kind"], r["error_detected"]) for r in sql if r["error_kind"]], [(3, "mismatch_class", "mis-pick", 0), (4, "in_progress", "mis-pick", 1)])
        self.assertEqual(RL.rows(db, "SELECT * FROM v_tracking_gaps"), [])


def hand_ledger_with_windows():
    """The hand ledger with dock and carrier windows (v3.55): two trailers, promised leads, transits, outcomes by hand."""
    data = hand_ledger()
    data["run"]["inbound"] = {"kind": "dock-windows", "periodTicks": 100, "openTicks": 20, "lateness": [0, 53], "mode": "Truck", "scaleTicksPerDay": 60, "source": "hand", "honesty": "hand"}
    data["run"]["outbound"] = {"kind": "carrier-windows", "periodTicks": 100, "promisedLeadTicks": 25, "transit": [10, 200], "mode": "Truck", "scaleTicksPerDay": 60, "source": "hand", "honesty": "hand"}
    data["inbound"] = [{"trailer": 0, "scheduled_tick": 0, "arrival_tick": 0, "late_ticks": 0}, {"trailer": 1, "scheduled_tick": 100, "arrival_tick": 153, "late_ticks": 53}]
    a, b, c = data["hus"]
    # A: spawned 0, due 25, delivered 30 (shipped late), transit 10 -> customer 40: not on time
    a.update(trailer=0, due_tick=25, transit_ticks=10, customer_tick=40, on_time_shipped=False, on_time=False)
    # B: spawned 5, due 30, delivered 20 (shipped on time), transit 10 -> customer 30: on time in full
    b.update(trailer=0, due_tick=30, transit_ticks=10, customer_tick=30, on_time_shipped=True, on_time=True)
    # C: still in flight, promised 35, transit 200
    c.update(trailer=1, due_tick=35, transit_ticks=200, customer_tick=None, on_time_shipped=None, on_time=None)
    return data


class Delivery(unittest.TestCase):
    """v3.55 delivery windows: v_otif and v_inbound by hand, the columns, replication groups keyed on the levers."""

    def test_otif_and_inbound_by_hand(self):
        db = fresh_with(hand_ledger_with_windows())
        run = "RUN-hand-s1-h00000000"
        o = RL.rows(db, "SELECT * FROM v_otif WHERE run_id = ?", (run,))
        self.assertEqual(len(o), 1)
        self.assertEqual((o[0]["orders"], o[0]["delivered_orders"], o[0]["otif_orders"], o[0]["otif"], o[0]["shipped_on_time_share"], o[0]["avg_transit_ticks"]), (3, 2, 1, 0.5, 0.5, 10.0))
        i = RL.rows(db, "SELECT * FROM v_inbound WHERE run_id = ? ORDER BY trailer", (run,))
        self.assertEqual([(r["trailer"], r["scheduled_tick"], r["arrival_tick"], r["late_ticks"], r["units"]) for r in i], [(0, 0, 0, 0, 2), (1, 100, 153, 53, 1)])
        hu = RL.rows(db, "SELECT due_tick, trailer, transit_ticks, customer_tick, on_time_shipped, on_time FROM hu WHERE id LIKE '%000002-1'")[0]
        self.assertEqual(hu, {"due_tick": 30, "trailer": 0, "transit_ticks": 10, "customer_tick": 30, "on_time_shipped": 1, "on_time": 1})
        self.assertIn('"kind": "dock-windows"', RL.rows(db, "SELECT inbound FROM run")[0]["inbound"])
        self.assertEqual(RL.summary(db, run)["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_no_windows_no_rows(self):
        db = fresh_with(hand_ledger())
        self.assertEqual(RL.rows(db, "SELECT * FROM v_otif"), [])
        self.assertEqual(RL.rows(db, "SELECT * FROM v_inbound"), [])
        self.assertIsNone(RL.rows(db, "SELECT outbound FROM run")[0]["outbound"])
        self.assertIn("v_otif", RL.PLANNER_VIEWS)
        self.assertIn("v_inbound", RL.PLANNER_VIEWS)
        self.assertEqual((RL.RECONCILE_KEYS["v_otif"], RL.RECONCILE_KEYS["v_inbound"]), ((), ("trailer",)))

    def test_old_database_gains_the_delivery_columns_and_table(self):
        db = fresh()
        for name in RL.VIEWS:
            db.execute(f"DROP VIEW IF EXISTS {name}")
        db.execute("DROP TABLE inbound_event")
        for table, col in (("run", "inbound"), ("run", "outbound"), ("hu", "due_tick"), ("hu", "trailer"), ("hu", "transit_ticks"), ("hu", "customer_tick"), ("hu", "on_time_shipped"), ("hu", "on_time")):
            db.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
        RL.initialize(db)
        RL.initialize(db)
        self.assertTrue({"inbound", "outbound"} <= {r["name"] for r in RL.rows(db, "PRAGMA table_info(run)")})
        self.assertTrue({"due_tick", "trailer", "transit_ticks", "customer_tick", "on_time_shipped", "on_time"} <= {r["name"] for r in RL.rows(db, "PRAGMA table_info(hu)")})
        RL.import_ledger(db, hand_ledger_with_windows())
        self.assertEqual(RL.rows(db, "SELECT otif FROM v_otif")[0]["otif"], 0.5)

    def test_replication_groups_key_on_the_levers(self):
        db = fresh()
        base = hand_ledger("RUN-hand-s1-h00000001")
        base["run"]["seed"], base["run"]["ticks"] = 1, 40
        RL.import_ledger(db, base)
        same = hand_ledger("RUN-hand-s2-h00000002")
        same["run"]["seed"], same["run"]["ticks"] = 2, 40
        RL.import_ledger(db, same)
        err = hand_ledger("RUN-hand-s3-h00000003")
        err["run"]["seed"], err["run"]["ticks"] = 3, 40
        err["run"]["errors"] = {"kind": "human-error", "kinds": [{"kind": "mis-pick", "share": 0.02, "effective": 0.02}], "psf": {}, "multiplier": 1, "latent": [], "cap": 0.5, "honesty": "hand"}
        RL.import_ledger(db, err)
        win = hand_ledger_with_windows()
        win["run"]["id"] = "RUN-hand-s4-h00000004"
        for h in win["hus"]:
            h["id"] = h["id"].replace("RUN-hand-s1-h00000000", "RUN-hand-s4-h00000004")
            h["order_id"] = h["order_id"].replace("RUN-hand-s1-h00000000", "RUN-hand-s4-h00000004")
        for e in win["events"]:
            e["id"] = e["id"].replace("RUN-hand-s1-h00000000", "RUN-hand-s4-h00000004")
            e["hu_id"] = e["hu_id"].replace("RUN-hand-s1-h00000000", "RUN-hand-s4-h00000004")
        win["run"]["seed"], win["run"]["ticks"] = 4, 40
        RL.import_ledger(db, win)
        groups = RL.rows(db, "SELECT n, seeds, errors, inbound, outbound FROM v_replication_groups ORDER BY seeds")
        self.assertEqual(len(groups), 3)
        self.assertEqual([(g["n"], g["seeds"]) for g in groups], [(2, "1,2"), (1, "3"), (1, "4")])
        self.assertEqual((groups[0]["errors"], groups[0]["inbound"], groups[0]["outbound"]), ("", "", ""))
        self.assertIn("mis-pick", groups[1]["errors"])
        self.assertIn("dock-windows", groups[2]["inbound"])
        cyc = RL.rows(db, "SELECT n, seeds FROM v_replication_groups WHERE errors = '' AND inbound = '' ORDER BY seeds")
        self.assertEqual([(r["n"], r["seeds"]) for r in cyc], [(2, "1,2")])
        for view in ("v_replication_cycle_by_type", "v_replication_cost_by_type", "v_replication_summary"):
            rows_ = RL.rows(db, f"SELECT DISTINCT n FROM {view} WHERE errors = '' AND inbound = '' AND outbound = ''")
            self.assertEqual([r["n"] for r in rows_], [2], view)


class ControlTower(unittest.TestCase):
    """v3.56 the control tower's audit: v_control by hand, idempotent import, empty without decisions, an old database gains the table."""

    def audit(self):
        return [
            {"seq": 1, "tick": 130, "rule": "queue-congestion", "proposal_id": "P-queue-congestion-130", "status": "declined", "lever": {"kind": "picker", "key": "staffing", "value": "adaptive"}, "evidence": {"stations": [{"id": "put-0", "element": "stg", "queue": 6}]}, "from_run": "RUN-hand-s1-h00000000"},
            {"seq": 2, "tick": 250, "rule": "queue-congestion", "proposal_id": "P-queue-congestion-250", "status": "snoozed", "lever": {"kind": "picker", "key": "staffing", "value": "adaptive"}, "evidence": {}, "from_run": "RUN-hand-s1-h00000000"},
            {"seq": 3, "tick": 460, "rule": "inbound-late", "proposal_id": "P-inbound-late-460", "status": "accepted", "lever": {"kind": "kb", "key": "delivery.inbound.periodTicks", "value": 50}, "evidence": {"worst": {"trailer": 3, "late_ticks": 159}}, "from_run": "RUN-hand-s0-h00000009"},
        ]

    def test_control_by_hand(self):
        data = hand_ledger()
        data["control"] = self.audit()
        db = fresh_with(data)
        rows_ = RL.rows(db, "SELECT * FROM v_control WHERE run_id = ? ORDER BY rule", ("RUN-hand-s1-h00000000",))
        self.assertEqual([(r["rule"], r["proposals"], r["accepted"], r["declined"], r["snoozed"], r["first_tick"]) for r in rows_],
                         [("inbound-late", 1, 1, 0, 0, 460), ("queue-congestion", 2, 0, 1, 1, 130)])
        ev = RL.rows(db, "SELECT seq, tick, status, lever, from_run FROM control_event ORDER BY seq")
        self.assertEqual([(r["seq"], r["tick"], r["status"]) for r in ev], [(1, 130, "declined"), (2, 250, "snoozed"), (3, 460, "accepted")])
        self.assertEqual(json.loads(ev[2]["lever"]), {"key": "delivery.inbound.periodTicks", "kind": "kb", "value": 50})
        self.assertEqual(ev[2]["from_run"], "RUN-hand-s0-h00000009")
        RL.import_ledger(db, data)  # idempotent
        self.assertEqual(RL.rows(db, "SELECT COUNT(*) AS n FROM control_event")[0]["n"], 3)
        self.assertEqual(RL.summary(db, "RUN-hand-s1-h00000000")["invariants"], {n: 0 for n in RL.INVARIANT_VIEWS})

    def test_no_decisions_no_rows_and_the_groups(self):
        db = fresh_with(hand_ledger())
        self.assertEqual(RL.rows(db, "SELECT * FROM v_control"), [])
        self.assertIn("v_control", RL.PLANNER_VIEWS)
        self.assertEqual(RL.RECONCILE_KEYS["v_control"], ("rule",))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO control_event(run_id, seq, tick, rule, proposal_id, status) VALUES(?, 1, 1, 'x', 'p', 'maybe')", ("RUN-hand-s1-h00000000",))

    def test_old_database_gains_the_control_table(self):
        db = fresh()
        for name in RL.VIEWS:
            db.execute(f"DROP VIEW IF EXISTS {name}")
        db.execute("DROP TABLE control_event")
        RL.initialize(db)
        RL.initialize(db)
        data = hand_ledger()
        data["control"] = self.audit()[:1]
        RL.import_ledger(db, data)
        self.assertEqual(RL.rows(db, "SELECT declined FROM v_control")[0]["declined"], 1)


if __name__ == "__main__":
    unittest.main()
