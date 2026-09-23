/* =====================================================================
 * Logistics Flow Studio - verify_cost_ledger.js
 * v3.35 WHAT A HANDLING UNIT COSTS - headless verification
 * ---------------------------------------------------------------------
 * ledger.js turns a run export into SPANS (the time between two consecutive
 * events of a unit: waiting when the first is `queued`, moving otherwise) and
 * charges them at the rates the run was recorded under: a waiting span costs
 * the station's service time (1 / its service rate), whatever it waited; a
 * moving span costs its full duration at the class of mover the floor
 * contains. This harness proves:
 *   1. A HAND-BUILT ledger (the three units / eleven events of the Python
 *      test, with service ticks and the default catalogue rates, transport by
 *      a manned forklift): the spans, the money per unit / type / location
 *      written out by hand (A 17.2032, B 9.2484, C 2.4663; face 1.1726 +
 *      transport 27.7453 = 28.9179 = the sum over types), rates linear,
 *      zero-duration spans cost nothing, no rates -> no cost and no key.
 *   2. The RECORDED run (the fixture floor, seed 31, 300 ticks): waiting
 *      spans only at the three stations, each charged its 50 service ticks
 *      (the floor declares no capacities, so every station serves at the
 *      floor rate - disclosed, not tuned); the spans of every retired unit add
 *      up to its cycle; the viewer's tables equal WT.ledger.costs and the
 *      committed run-ledger.views.json; the sim and the events are
 *      byte-identical with and without rates; stats are untouched.
 *   3. Every route's final operation has a terminal kind (the latent
 *      "retired" fallback is unreachable).
 *   4. Shipped wiring: the app passes the Analyze rates at create; the viewer
 *      page loads ledger.js and shows the cost section; RunLedger.SQL carries
 *      every view the SQLite tool defines; sw.js at wt-v135; the runner.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, A = global.WT.analytics, P = global.WT.pack, RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-4 : tol); // v3.43: one step in the fourth decimal (was 5e-4 before the compensated sums)

/* ---- the hand ledger ---------------------------------------------------- */
function handRates() {
  const eq = { racking: [8000, 15, 0.15, 1], asrs: [250000, 12, 15, 0], shuttle: [180000, 10, 8, 0], conveyor: [12000, 10, 1.5, 0], amr: [45000, 8, 2, 0],
    forklift: [35000, 8, 3, 1], dock: [15000, 20, 0.5, 0], workstation: [6000, 10, 0.6, 1], wrapper: [20000, 12, 2, 0], depalletiser: [60000, 12, 4, 0], charging: [8000, 10, 0.2, 0] };
  const cls = { "dock-in": ["dock", 0], depalletiser: ["depalletiser", 0], "carton-flow": ["racking", 1], "stretch-wrap": ["wrapper", 0], staging: [null, 1], "dock-out": ["dock", 0], "returns-station": ["workstation", 1] };
  const equipment = {}, classes = {};
  for (const k of Object.keys(eq)) equipment[k] = { capex: eq[k][0], amort_years: eq[k][1], power_kw: eq[k][2], labour: eq[k][3] };
  for (const k of Object.keys(cls)) classes[k] = { class: cls[k][0], labour: cls[k][1] };
  return { source: "hand", currency: "EUR", labour_per_hour: 35, energy_price_per_kwh: 0.3, hours_per_year: 4000, co2_per_kwh: 0.3,
    transport: { class: "forklift", labour: 1 }, equipment, classes, honesty: "hand-built test rates" };
}
function handLedger() {
  const run = "RUN-hand-s1-h00000000";
  const o = (n) => "ORD-" + run + "-" + String(n).padStart(6, "0");
  const hu = (n) => "HU-" + o(n) + "-1";
  const ev = (h, v, kind, op, loc, tick, p, c, e, pa, ret, scr) => ({ id: "EVT-" + h + "-" + v, hu_id: h, version: v, kind, op, anchor: null, location: loc,
    tick, minute: tick, stage: null, form: null, pallets: p, cases: c, eaches: e, parcels: pa, retained: ret || 0, scrapped: scr || 0 });
  const A1 = hu(1), B1 = hu(2), C1 = hu(3);
  return {
    schema: "factory-run-ledger/v1",
    run: { id: run, scenario: "hand", seed: 1, hash: "00000000", mix: { "case-pick": 0.5, "cross-dock": 0.3, returns: 0.2 }, profile: "ecommerce", ticks_per_hour: 60, minutes_per_tick: 1, ticks: 40, honesty: "hand" },
    profile: { id: "ecommerce", label: "E-commerce", box: "case-400x300x250", pallet: "eur", eaches_per_case: 12, case_kg: 6, max_stack_mm: 1800, eaches_per_parcel: 6 },
    locations: [{ id: "in", type: "dock-in", category: "flow", service_ticks: null }, { id: "dep", type: "depalletiser", category: "flow", service_ticks: null },
      { id: "face", type: "carton-flow", category: "storage", service_ticks: 2 }, { id: "wrap", type: "stretch-wrap", category: "flow", service_ticks: null },
      { id: "stg", type: "staging", category: "flow", service_ticks: 1 }, { id: "out", type: "dock-out", category: "flow", service_ticks: null },
      { id: "ret", type: "returns-station", category: "flow", service_ticks: 4 }],
    rates: handRates(),
    hus: [
      { id: A1, order_id: o(1), seq: 1, archetype: "case-pick", outcome: null, route_id: "case-pick", sscc: "340123450000000017", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 0, retired_tick: 30, final_kind: "delivered", final: { pallets: 1, cases: 4, eaches: 48, parcels: 0, form: "wrapped-pallet", retained: 528, scrapped: 0 } },
      { id: B1, order_id: o(2), seq: 2, archetype: "cross-dock", outcome: null, route_id: "cross-dock", sscc: "340123450000000024", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 5, retired_tick: 20, final_kind: "delivered", final: { pallets: 1, cases: 48, eaches: 576, parcels: 0, form: "pallet-load", retained: 0, scrapped: 0 } },
      { id: C1, order_id: o(3), seq: 3, archetype: "returns", outcome: "scrap", route_id: "returns:scrap", sscc: "040123450000000031", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 3, spawned_tick: 10, retired_tick: null, final_kind: null, final: null },
    ],
    events: [
      ev(A1, 0, "created", "receive", "in", 0, 1, 48, 576, 0), ev(A1, 1, "passed", "depalletise", "dep", 4, 0, 48, 576, 0), ev(A1, 2, "queued", "case-pick", "face", 8, 0, 48, 576, 0),
      ev(A1, 3, "served", "case-pick", "face", 12, 0, 4, 48, 0, 528), ev(A1, 4, "passed", "palletise", "wrap", 20, 1, 4, 48, 0, 528), ev(A1, 5, "delivered", "load", "out", 30, 1, 4, 48, 0, 528),
      ev(B1, 0, "created", "receive", "in", 5, 1, 48, 576, 0), ev(B1, 1, "passed", "stage-out", "stg", 12, 1, 48, 576, 0), ev(B1, 2, "delivered", "load", "out", 20, 1, 48, 576, 0),
      ev(C1, 0, "created", "receive", "in", 10, 0, 0, 3, 1), ev(C1, 1, "queued", "inspect", "ret", 14, 0, 0, 3, 1),
    ],
  };
}

/* ---- the recorded run --------------------------------------------------- */
const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
    { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 },
    { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 },
    { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
    { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 },
    { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
function run(withRates) {
  const mix = R.defaultMix();
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: withRates ? A.defaultRates() : null });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  return { plan, st, rec, exp: L.exportJson(rec) };
}
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });

console.log("v3.35 - what a handling unit costs");
console.log("=".repeat(72));

/* ---- 1. the hand ledger ------------------------------------------------- */
(function () {
  const exp = handLedger();
  const sp = L.spans(exp);
  const of = (tail) => sp.filter((s) => s.hu_id.slice(-8) === tail);
  check("1a. A has five spans: moving 4, moving 4, waiting 4 at the pick face, moving 8, moving 10",
    JSON.stringify(of("000001-1").map((s) => [s.state, s.ticks, s.location])) === JSON.stringify([["moving", 4, "in"], ["moving", 4, "dep"], ["waiting", 4, "face"], ["moving", 8, "face"], ["moving", 10, "wrap"]]));
  check("1b. B has two moving spans (7, 8); C has one open span into its wait (moving 4) and no span after the wait",
    JSON.stringify(of("000002-1").map((s) => [s.state, s.ticks])) === JSON.stringify([["moving", 7], ["moving", 8]]) &&
    JSON.stringify(of("000003-1").map((s) => [s.state, s.ticks, s.to_kind])) === JSON.stringify([["moving", 4, "queued"]]));
  const cyc = exp.hus.filter((h) => h.retired_tick != null).every((h) => of(h.id.slice(-8)).reduce((a, s) => a + s.ticks, 0) === h.retired_tick - h.spawned_tick);
  check("1c. the spans of a retired unit add up to its cycle (A 30, B 15)", cyc);
  const c = L.costs(exp);
  const hu = {};
  for (const h of c.byHu) hu[h.hu_id.slice(-8)] = h;
  const a = hu["000001-1"], b = hu["000002-1"], cc = hu["000003-1"];
  check("1d. A by hand: 26 moving ticks on a manned forklift + 2 charged ticks on manned racking = labour 16.3333, equipment 0.4784, energy 0.3915, total 17.2032",
    a && a.ticks === 30 && a.waiting_ticks === 4 && a.moving_ticks === 26 && a.charged_ticks === 28 && near(a.labour_eur, 16.3333) && near(a.equipment_eur, 0.4784) && near(a.energy_eur, 0.3915) && near(a.total_eur, 17.2032),
    a && [a.labour_eur, a.equipment_eur, a.energy_eur, a.total_eur].join(" / "));
  check("1e. B by hand: 15 moving ticks = 8.75 + 0.2734 + 0.225 = 9.2484; C (still waiting): 4 moving ticks = 2.4663, the open wait costs nothing yet",
    b && near(b.total_eur, 9.2484) && near(b.labour_eur, 8.75) && cc && near(cc.total_eur, 2.4663) && cc.charged_ticks === 4, b && b.total_eur + " / " + (cc && cc.total_eur));
  const ty = {};
  for (const t of c.byType) ty[t.archetype] = t;
  check("1f. by type: case-pick 17.2032 over 48 delivered eaches = 0.3584 per each; cross-dock 0.0161 per each; returns delivered nothing -> per each is null",
    near(ty["case-pick"].total_eur, 17.2032) && ty["case-pick"].eaches_out === 48 && near(ty["case-pick"].eur_per_each, 0.3584) && near(ty["cross-dock"].eur_per_each, 0.0161) && ty.returns.eur_per_each === null && ty.returns.units === 1);
  const lo = {};
  for (const l of c.byLocation) lo[l.location] = l;
  check("1g. by location: the pick face (racking, 1 span, 4 ticks, 2 charged) 1.1726; transport (forklift, 7 spans, 45 ticks) 27.7453; nothing else",
    Object.keys(lo).sort().join(",") === "face,transport" && lo.face.class === "racking" && lo.face.spans === 1 && lo.face.ticks === 4 && lo.face.charged_ticks === 2 && near(lo.face.total_eur, 1.1726) &&
    lo.transport.class === "forklift" && lo.transport.spans === 7 && lo.transport.ticks === 45 && near(lo.transport.total_eur, 27.7453));
  const sumType = c.byType.reduce((s, t) => s + t.total_eur, 0), sumLoc = c.byLocation.reduce((s, l) => s + l.total_eur, 0);
  check("1h. the three totals reconcile: by type = by location = the run total = 28.9179", near(sumType, 28.9179, 2e-3) && near(sumLoc, sumType, 2e-3) && near(c.total.total_eur, 28.9179, 2e-3), sumType + " / " + sumLoc + " / " + c.total.total_eur);
  const r2x = JSON.parse(JSON.stringify(exp.rates)); r2x.labour_per_hour = 70;
  const c2 = L.costs(exp, r2x);
  const rE = JSON.parse(JSON.stringify(exp.rates)); rE.energy_price_per_kwh = 0.6;
  const cE = L.costs(exp, rE);
  const rH = JSON.parse(JSON.stringify(exp.rates)); rH.hours_per_year = 8000;
  const cH = L.costs(exp, rH);
  check("1i. rates are linear: x2 labour rate doubles labour only; x2 energy price doubles energy only; x2 hours per year halves equipment only",
    near(c2.total.labour_eur, 2 * c.total.labour_eur, 1e-3) && near(c2.total.equipment_eur, c.total.equipment_eur) && near(c2.total.energy_eur, c.total.energy_eur) &&
    near(cE.total.energy_eur, 2 * c.total.energy_eur, 1e-3) && near(cE.total.labour_eur, c.total.labour_eur) &&
    near(cH.total.equipment_eur, c.total.equipment_eur / 2, 1e-3) && near(cH.total.labour_eur, c.total.labour_eur));
  const z = handLedger();
  z.events[7].tick = 20; // B passes staging at the tick it is delivered: a zero-duration moving span
  const cz = L.costs(z);
  const zs = L.spans(z).filter((s) => s.ticks === 0);
  check("1j. a zero-duration span is a moving span and costs nothing", zs.length === 1 && zs[0].state === "moving" && cz.spans.find((s) => s.ticks === 0).labour_eur === 0 && near(cz.byHu[1].total_eur, 15 / 60 * (35 + 1.09375 + 0.9), 1e-3));
  const n = handLedger(); delete n.rates;
  check("1k. without rates there is no cost (null), and the viewer's views carry null cost fields", L.costs(n) === null && RL.views(n).costByType === null && RL.views(n).rates === null);
  const v = RL.views(exp);
  check("1l. the viewer's views(exp) cost tables ARE WT.ledger.costs (same definition, same numbers)",
    JSON.stringify(v.costByType) === JSON.stringify(c.byType) && JSON.stringify(v.costByLocation) === JSON.stringify(c.byLocation) && JSON.stringify(v.costTotal) === JSON.stringify(c.total) && v.rates === exp.rates);
  // v3.40 holding cost, hours, cost per received each
  const rG = JSON.parse(JSON.stringify(exp.rates)); rG.holding_per_unit_hour = 1;
  const cG = L.costs(exp, rG);
  const hG = {}; for (const h of cG.byHu) hG[h.hu_id.slice(-8)] = h;
  check("1m. holding 1 EUR per unit-hour waiting: A +0.0667 (its 4 waiting ticks) -> 17.2699, B 0 (never waited), C 0 (its open wait opens no span); the face books 0.0667, transport 0; x2 doubles holding only",
    near(hG["000001-1"].holding_eur, 0.0667) && near(hG["000001-1"].total_eur, 17.2699) && hG["000002-1"].holding_eur === 0 && hG["000003-1"].holding_eur === 0 &&
    near(cG.byLocation.find((l) => l.location === "face").holding_eur, 0.0667) && cG.byLocation.find((l) => l.location === "transport").holding_eur === 0 && near(cG.total.holding_eur, 0.0667) &&
    near(L.costs(exp, Object.assign({}, rG, { holding_per_unit_hour: 2 })).total.holding_eur, 0.1333) && near(L.costs(exp, Object.assign({}, rG, { holding_per_unit_hour: 2 })).total.labour_eur, c.total.labour_eur) && c.total.holding_eur === 0);
  const tG = {}; for (const t of cG.byType) tG[t.archetype] = t;
  check("1n. hours are the CHARGED hours (A 28 ticks = 0.4667 h, B 0.25, C 0.0667); eaches received per type 576 / 576 / 3; cost per received each case-pick 17.2699 / 576 = 0.03, returns 2.4663 / 3 = 0.8221 while per delivered each stays null",
    near(hG["000001-1"].hours, 0.4667) && near(hG["000002-1"].hours, 0.25) && near(hG["000003-1"].hours, 0.0667) && tG["case-pick"].eaches_in === 576 && tG["cross-dock"].eaches_in === 576 && tG.returns.eaches_in === 3 &&
    near(tG["case-pick"].eur_per_received_each, 0.03) && near(tG.returns.eur_per_received_each, 0.8221) && tG.returns.eur_per_each === null && near(tG["case-pick"].hours, 0.4667));
})();

/* ---- 2. the recorded run ------------------------------------------------ */
(function () {
  const withR = run(true), without = run(false);
  const exp = withR.exp;
  check("2a. the export carries the rates block: transport is the conveyor on this floor (unmanned), every location type is classified, the honesty line is present",
    exp.rates && exp.rates.transport.class === "conveyor" && exp.rates.transport.labour === 0 && Object.keys(exp.rates.classes).length === 12 && exp.rates.classes.staging.class === null && exp.rates.classes.staging.labour === 1 &&
    exp.rates.classes["carton-flow"].class === "racking" && exp.rates.classes["pack-station"].class === "workstation" && /queue time costs no labour/.test(exp.rates.honesty));
  const st = exp.locations.filter((l) => l.service_ticks != null).map((l) => l.id + "=" + l.service_ticks).join(",");
  check("2b. the three stations carry their service time (1 / rate = 50 ticks: this floor declares no capacities, so every station serves at the floor rate)", st === "stg=50,face=50,pack=50", st);
  const c = L.costs(exp);
  const waiting = c.spans.filter((s) => s.state === "waiting");
  check("2c. waiting spans happen only at stg / face / pack and each is charged exactly its 50 service ticks; moving spans are charged in full at the conveyor",
    waiting.length > 0 && waiting.every((s) => ["stg", "face", "pack"].indexOf(s.location) >= 0 && s.charged_ticks === 50) && c.spans.filter((s) => s.state === "moving").every((s) => s.charged_ticks === s.ticks && s.class === "conveyor" && s.labour === 0));
  const byHu = {};
  for (const s of c.spans) byHu[s.hu_id] = (byHu[s.hu_id] || 0) + s.ticks;
  const retired = exp.hus.filter((h) => h.retired_tick != null);
  check("2d. the spans of every retired unit (" + retired.length + ") add up to its cycle", retired.length > 0 && retired.every((h) => byHu[h.id] === h.retired_tick - h.spawned_tick));
  const zero = c.spans.filter((s) => s.ticks === 0);
  check("2e. every zero-duration span is a moving span costing nothing (" + zero.length + " of " + c.spans.length + ")", zero.every((s) => s.state === "moving" && s.labour_eur + s.equipment_eur + s.energy_eur === 0));
  const views = JSON.parse(read("test/fixtures/run-ledger.views.json"));
  check("2f. the committed run-ledger.views.json equals this run's cost tables (the Python test equates them with SQL)",
    JSON.stringify(views.costByType) === JSON.stringify(c.byType) && JSON.stringify(views.costByLocation) === JSON.stringify(c.byLocation) && JSON.stringify(views.costTotal) === JSON.stringify(c.total));
  const strip = (e) => JSON.stringify({ hus: e.hus, events: e.events, locations: e.locations, run: e.run });
  check("2g. rates never touch the recording: the sim state and the events are byte-identical with and without rates", snap(withR.st) === snap(without.st) && strip(withR.exp) === strip(without.exp) && !("rates" in without.exp));
  check("2h. stats() ignores rates and equals the committed run-ledger.stats.json", JSON.stringify(L.stats(withR.rec)) === JSON.stringify(JSON.parse(read("test/fixtures/run-ledger.stats.json"))));
  const fix = JSON.parse(read("test/fixtures/run-ledger.json"));
  check("2i. the committed fixture is this run, rates included", JSON.stringify(fix) === JSON.stringify(exp));
  const v = RL.views(exp);
  check("2j. the viewer computes the same cost tables from the fixture", JSON.stringify(v.costByType) === JSON.stringify(c.byType) && JSON.stringify(v.costByLocation) === JSON.stringify(c.byLocation));
  const total = c.total.total_eur;
  check("2k. the run costs something, and labour dominates on a floor served at the floor rate (disclosed, not tuned)", total > 0 && c.total.labour_eur > c.total.equipment_eur + c.total.energy_eur, total + " EUR, labour " + c.total.labour_eur);
  const terminal = withR.plan.routes.every((r) => !!L.TERMINAL[r.ops[r.ops.length - 1]]);
  check("3. every route's final operation maps to a terminal kind (the 'retired' fallback is unreachable): " + withR.plan.routes.map((r) => r.ops[r.ops.length - 1]).filter((x, i, a) => a.indexOf(x) === i).join(","), terminal);
})();

/* ---- 4. shipped wiring ------------------------------------------------ */
(function () {
  const app = read("app.js"), html = read("run-ledger.html"), sw = read("sw.js"), runall = read("test/run-all.mjs"), py = read("tools/run_ledger.py"), an = read("analytics.js");
  check("4a. the app passes the Analyze panel's rates when it creates the ledger", /rates:\s*WT\.analytics\s*\?\s*ensureRates\(\)\s*:\s*null/.test(app));
  check("4b. the viewer page loads ledger.js before run-ledger.js and has the cost section", /<script src="ledger\.js"><\/script>(<script src="tracking\.js"><\/script>)?(<script src="control\.js"><\/script>)?(<script src="analytics\.js"><\/script>)?<script src="run-ledger\.js">/.test(html) && /id="rlCost"/.test(html));
  const want = ["v_run_summary", "v_cycle_time_by_type", "v_touches_by_type", "v_station_wait", "v_wip_by_tick", "v_quantities_by_op", "v_dispatch", "v_spans", "v_span_cost", "v_cost_by_hu", "v_cost_by_type", "v_cost_by_location",
    "v_conservation_violations", "v_cross_dock_violations", "v_version_gaps", "v_terminal_violations"];
  check("4c. RunLedger.SQL carries every view the SQLite tool defines (" + want.length + ")", want.every((k) => typeof RL.SQL[k] === "string" && RL.SQL[k].length > 20) && want.every((k) => py.indexOf("CREATE VIEW IF NOT EXISTS " + k + " AS") >= 0), Object.keys(RL.SQL).length + " keys");
  check("4d. analytics.js exports TYPE_TO_CLASS and the python tool has the rate tables", !!A.TYPE_TO_CLASS && A.TYPE_TO_CLASS["carton-flow"] === "racking" && /CREATE TABLE IF NOT EXISTS rate\(/.test(py) && /CREATE TABLE IF NOT EXISTS equipment_rate\(/.test(py) && /CREATE TABLE IF NOT EXISTS location_class\(/.test(py));
  check("4e. sw.js at wt-v135 (previously wt-v134) still precaches ledger.js and the viewer", /CACHE_VERSION\s*=\s*"wt-v135"/.test(sw) && /Previously wt-v134/.test(sw) && /"\.\/ledger\.js"/.test(sw) && /"\.\/run-ledger\.js"/.test(sw));
  check("4f. test/run-all.mjs lists this harness", /verify_cost_ledger\.js/.test(runall));
  check("4g. no Date / Math.random CALL in ledger.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(read("ledger.js")));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL COST-LEDGER CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
