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
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import export_viewer_sql as XV  # noqa: E402
import run_ledger as RL  # noqa: E402

FIX = ROOT / "test" / "fixtures"


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
                transport={"class": "forklift", "labour": 1},
                equipment={k: dict(capex=c, amort_years=a, power_kw=w, labour=lab) for k, (c, a, w, lab) in eq.items()},
                classes={k: {"class": c, "labour": lab} for k, (c, lab) in cls.items()}, honesty="hand-built test rates")


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
                self.assertAlmostEqual(row[key], val, delta=5e-4, msg=f"{row['hu_id']} {key}")
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertEqual((ty["case-pick"]["units"], ty["case-pick"]["eaches_out"]), (1, 48))
        self.assertAlmostEqual(ty["case-pick"]["eur_per_each"], 0.3584, delta=5e-4)
        self.assertAlmostEqual(ty["cross-dock"]["eur_per_each"], 0.0161, delta=5e-4)
        self.assertIsNone(ty["returns"]["eur_per_each"])
        self.assertAlmostEqual(ty["returns"]["total_eur"], 2.4663, delta=5e-4)
        loc = {r["location"]: r for r in self.view("v_cost_by_location")}
        self.assertEqual(set(loc), {"face", "transport"})
        self.assertEqual((loc["face"]["class"], loc["face"]["spans"], loc["face"]["ticks"], loc["face"]["charged_ticks"]), ("racking", 1, 4, 2))
        self.assertAlmostEqual(loc["face"]["total_eur"], 1.1726, delta=5e-4)
        self.assertEqual((loc["transport"]["class"], loc["transport"]["spans"], loc["transport"]["ticks"]), ("forklift", 7, 45))
        self.assertAlmostEqual(loc["transport"]["total_eur"], 27.7453, delta=5e-4)
        by_type = sum(r["total_eur"] for r in ty.values())
        by_loc = sum(r["total_eur"] for r in loc.values())
        self.assertAlmostEqual(by_type, 28.9179, delta=2e-3)
        self.assertAlmostEqual(by_loc, by_type, delta=2e-3)

    def test_cost_rates_are_linear(self):
        self.db.execute("UPDATE rate SET labour_per_hour = 70 WHERE run_id = ?", (self.run,))
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertAlmostEqual(ty["case-pick"]["labour_eur"], 32.6667, delta=5e-4)
        self.assertAlmostEqual(ty["case-pick"]["equipment_eur"], 0.4784, delta=5e-4)
        self.assertAlmostEqual(ty["cross-dock"]["labour_eur"], 17.5, delta=5e-4)
        self.db.execute("UPDATE rate SET labour_per_hour = 35, hours_per_year = 8000 WHERE run_id = ?", (self.run,))
        ty = {r["archetype"]: r for r in self.view("v_cost_by_type")}
        self.assertAlmostEqual(ty["case-pick"]["equipment_eur"], 0.4784 / 2, delta=5e-4)
        self.assertAlmostEqual(ty["case-pick"]["labour_eur"], 16.3333, delta=5e-4)

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
        self.assertAlmostEqual(cost["case-pick"]["delta_total_eur"], 6.1656, delta=5e-4)  # 10 more forklift ticks = 1/6 h x (35 + 1.09375 + 0.9)
        self.assertAlmostEqual(cost["cross-dock"]["delta_total_eur"], 6.1656, delta=5e-4)
        self.assertAlmostEqual(cost["returns"]["delta_total_eur"], 0.0, delta=5e-4)
        s = c["v_compare_summary"][0]
        self.assertEqual((s["delta_units"], s["delta_events"], s["delta_delivered"], s["delta_delivered_eaches"]), (0, 0, 0, 0))
        w = {(r["location"], r["op"]): r for r in c["v_compare_wait"]}
        self.assertEqual((w[("face", "case-pick")]["delta_waits"], w[("ret", "inspect")]["delta_still_waiting"], w[("ret", "inspect")]["delta_avg_wait_ticks"]), (0, 0, None))
        # the reverse pair negates every delta
        r = RL.compare(self.db, run_b, self.run)
        self.assertEqual({x["archetype"]: x["delta_avg_cycle_ticks"] for x in r["v_compare_cycle"]}["case-pick"], -10.0)
        self.assertAlmostEqual({x["archetype"]: x["delta_total_eur"] for x in r["v_compare_cost"]}["case-pick"], -6.1656, delta=5e-4)

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
            self.assertEqual((got["units"], got["retired"], got["eaches_out"]), (want["units"], want["retired"], want["eaches_out"]), want["archetype"])
            for key in ("labour_eur", "equipment_eur", "energy_eur", "total_eur", "eur_per_unit"):
                self.assertAlmostEqual(got[key], want[key], delta=5e-4, msg=f"{want['archetype']} {key}")
            if want["eur_per_each"] is None:
                self.assertIsNone(got["eur_per_each"], want["archetype"])
            else:
                self.assertAlmostEqual(got["eur_per_each"], want["eur_per_each"], delta=5e-4, msg=want["archetype"])
        by_loc = {r["location"]: r for r in s["v_cost_by_location"]}
        self.assertEqual(set(by_loc), {r["location"] for r in js["costByLocation"]})
        for want in js["costByLocation"]:
            got = by_loc[want["location"]]
            self.assertEqual((got["class"], got["spans"], got["ticks"]), (want["class"], want["spans"], want["ticks"]), want["location"])
            self.assertAlmostEqual(got["charged_ticks"], want["charged_ticks"], delta=1e-6)
            for key in ("labour_eur", "equipment_eur", "energy_eur", "total_eur"):
                self.assertAlmostEqual(got[key], want[key], delta=5e-4, msg=f"{want['location']} {key}")
        self.assertAlmostEqual(sum(r["total_eur"] for r in s["v_cost_by_type"]), js["costTotal"]["total_eur"], delta=1e-2)
        self.assertGreater(js["costTotal"]["total_eur"], 0)

    def test_sql_flow_links_equal_javascript(self):
        js = json.loads((FIX / "run-ledger.views.json").read_text(encoding="utf-8"))["flowLinks"]
        sql = [{k: r[k] for k in ("from_op", "to_op", "units", "retired_units", "eaches")} for r in
               RL.rows(self.db, "SELECT * FROM v_flow_links WHERE run_id = ? ORDER BY from_op, to_op", (self.run,))]
        self.assertEqual(sql, js)
        self.assertGreater(len(sql), 10)
        HandLedger.assert_flow_identity(self)

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
            self.assertAlmostEqual(cost_b[t["archetype"]]["total_eur"], t["total_eur"], delta=5e-4, msg=t["archetype"])
        links_b = [{k: r[k] for k in ("from_op", "to_op", "units", "retired_units", "eaches")} for r in
                   RL.rows(self.db, "SELECT * FROM v_flow_links WHERE run_id = ? ORDER BY from_op, to_op", (run_b,))]
        self.assertEqual(links_b, jb["flowLinks"])

    def test_every_gs1_number_is_unique_and_18_or_14_digits(self):
        ssccs = RL.rows(self.db, "SELECT sscc, gtin14 FROM hu WHERE run_id = ?", (self.run,))
        self.assertEqual(len({r["sscc"] for r in ssccs}), len(ssccs))
        self.assertTrue(all(len(r["sscc"]) == 18 and len(r["gtin14"]) == 14 for r in ssccs))


if __name__ == "__main__":
    unittest.main()
