/* =====================================================================
 * Logistics Flow Studio - verify_run_compare.js
 * v3.37 COMPARE TWO RUNS - headless verification
 * ---------------------------------------------------------------------
 * RunLedger.compare(A, B) pairs the viewer's tables of two recorded runs
 * key by key (order type; bench + operation) and states B - A: summary,
 * cycle time, touches, station wait, dispatch, cost. A key seen in only one
 * run still appears, with the other side and the delta null. The same six
 * comparisons are SQL views (v_compare_*) the Python test equates with these
 * on the same hand pair. This harness proves:
 *   1. A HAND pair: B is the hand ledger with every terminal event and
 *      retirement 10 ticks later -> cycle +10 for both delivered types, the
 *      live return null on both sides; touches and dispatch unchanged; cost
 *      +6.1656 per delivered unit (10 more forklift ticks = 1/6 h x
 *      (35 + 1.09375 + 0.9)), 0 for the return; the reverse pair negates
 *      every delta; a key present in one run only survives with nulls.
 *   2. The RECORDED pair: fixture B (the same floor and seed, a cross-dock-
 *      heavy mix) is byte-identical to a fresh run, has a different run id
 *      (the hash covers the mix) and the same scenario / profile; its
 *      invariants hold; cross-dock is its largest type; every compare row
 *      is exactly the pairing of views(A) and views(B); every archetype of
 *      either run appears once.
 *   3. Shipped wiring: the viewer's second input and demo-B button, the
 *      section, sw.js precaching run-ledger-b.json at wt-v144, the SQL views
 *      and the `compare` command in tools/run_ledger.py, the runner.
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
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol == null ? 5e-4 : tol);

/* ---- the hand ledger (as in verify_cost_ledger.js) ---------------------- */
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
function handLedger(run, shift) {
  run = run || "RUN-hand-s1-h00000000"; shift = shift || 0;
  const o = (n) => "ORD-" + run + "-" + String(n).padStart(6, "0");
  const hu = (n) => "HU-" + o(n) + "-1";
  const ev = (h, v, kind, op, loc, tick, p, c, e, pa, ret, scr) => ({ id: "EVT-" + h + "-" + v, hu_id: h, version: v, kind, op, anchor: null, location: loc,
    tick, minute: tick, stage: null, form: null, pallets: p, cases: c, eaches: e, parcels: pa, retained: ret || 0, scrapped: scr || 0 });
  const A1 = hu(1), B1 = hu(2), C1 = hu(3);
  const exp = {
    schema: "factory-run-ledger/v1",
    run: { id: run, scenario: "hand", seed: 1, hash: "00000000", mix: { "case-pick": 0.5, "cross-dock": 0.3, returns: 0.2 }, profile: "ecommerce", ticks_per_hour: 60, minutes_per_tick: 1, ticks: 40 + shift, honesty: "hand" },
    profile: { id: "ecommerce", label: "E-commerce", box: "case-400x300x250", pallet: "eur", eaches_per_case: 12, case_kg: 6, max_stack_mm: 1800, eaches_per_parcel: 6 },
    locations: [{ id: "in", type: "dock-in", category: "flow", service_ticks: null }, { id: "dep", type: "depalletiser", category: "flow", service_ticks: null },
      { id: "face", type: "carton-flow", category: "storage", service_ticks: 2 }, { id: "wrap", type: "stretch-wrap", category: "flow", service_ticks: null },
      { id: "stg", type: "staging", category: "flow", service_ticks: 1 }, { id: "out", type: "dock-out", category: "flow", service_ticks: null },
      { id: "ret", type: "returns-station", category: "flow", service_ticks: 4 }],
    rates: handRates(),
    hus: [
      { id: A1, order_id: o(1), seq: 1, archetype: "case-pick", outcome: null, route_id: "case-pick", sscc: "340123450000000017", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 0, retired_tick: 30 + shift, final_kind: "delivered", final: { pallets: 1, cases: 4, eaches: 48, parcels: 0, form: "wrapped-pallet", retained: 528, scrapped: 0 } },
      { id: B1, order_id: o(2), seq: 2, archetype: "cross-dock", outcome: null, route_id: "cross-dock", sscc: "340123450000000024", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 5, retired_tick: 20 + shift, final_kind: "delivered", final: { pallets: 1, cases: 48, eaches: 576, parcels: 0, form: "pallet-load", retained: 0, scrapped: 0 } },
      { id: C1, order_id: o(3), seq: 3, archetype: "returns", outcome: "scrap", route_id: "returns:scrap", sscc: "040123450000000031", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 3, spawned_tick: 10, retired_tick: null, final_kind: null, final: null },
    ],
    events: [
      ev(A1, 0, "created", "receive", "in", 0, 1, 48, 576, 0), ev(A1, 1, "passed", "depalletise", "dep", 4, 0, 48, 576, 0), ev(A1, 2, "queued", "case-pick", "face", 8, 0, 48, 576, 0),
      ev(A1, 3, "served", "case-pick", "face", 12, 0, 4, 48, 0, 528), ev(A1, 4, "passed", "palletise", "wrap", 20, 1, 4, 48, 0, 528), ev(A1, 5, "delivered", "load", "out", 30 + shift, 1, 4, 48, 0, 528),
      ev(B1, 0, "created", "receive", "in", 5, 1, 48, 576, 0), ev(B1, 1, "passed", "stage-out", "stg", 12, 1, 48, 576, 0), ev(B1, 2, "delivered", "load", "out", 20 + shift, 1, 48, 576, 0),
      ev(C1, 0, "created", "receive", "in", 10, 0, 0, 3, 1), ev(C1, 1, "queued", "inspect", "ret", 14, 0, 0, 3, 1),
    ],
  };
  return exp;
}

/* ---- the recorded pair -------------------------------------------------- */
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
const MIX_B = [{ id: "cross-dock", share: 0.5 }, { id: "full-pallet-out", share: 0.2 }, { id: "case-pick", share: 0.15 }, { id: "piece-pick", share: 0.1 }, { id: "returns", share: 0.05 }];
function record(mix) {
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  return { rec, exp: L.exportJson(rec) };
}

console.log("v3.37 - compare two runs");
console.log("=".repeat(72));

/* ---- 1. the hand pair --------------------------------------------------- */
(function () {
  const a = handLedger(), b = handLedger("RUN-hand-s2-h00000001", 10);
  const c = RL.compare(a, b);
  const cyc = {};
  for (const r of c.cycle) cyc[r.archetype] = r;
  check("1a. cycle time: case-pick 30 -> 40 (+10), cross-dock 15 -> 25 (+10), the live return null on both sides and in the delta",
    cyc["case-pick"].avg_cycle_ticks_a === 30 && cyc["case-pick"].avg_cycle_ticks_b === 40 && cyc["case-pick"].delta_avg_cycle_ticks === 10 && cyc["cross-dock"].delta_avg_cycle_ticks === 10 &&
    cyc.returns.avg_cycle_ticks_a === null && cyc.returns.avg_cycle_ticks_b === null && cyc.returns.delta_avg_cycle_ticks === null && cyc.returns.units_a === 1 && cyc.returns.delta_units === 0);
  check("1b. touches and dispatch unchanged; summary deltas 0 (same units, events, delivered)",
    c.touches.every((r) => r.delta_touches === 0 && r.delta_served_per_unit === 0) && c.dispatch.length === 1 && c.dispatch[0].delta_pallets === 0 && c.dispatch[0].delta_trailers === 0 && c.dispatch[0].pallets_a === 2 &&
    c.summary.length === 1 && c.summary[0].delta_units === 0 && c.summary[0].delta_events === 0 && c.summary[0].delta_delivered === 0);
  const cost = {};
  for (const r of c.cost) cost[r.archetype] = r;
  check("1c. cost: +6.1656 per delivered type (10 more forklift ticks = 1/6 h x (35 + 1.09375 + 0.9)); the return 0",
    near(cost["case-pick"].delta_total_eur, 6.1656) && near(cost["cross-dock"].delta_total_eur, 6.1656) && near(cost.returns.delta_total_eur, 0) && near(cost["case-pick"].total_eur_a, 17.2032) && near(cost["case-pick"].total_eur_b, 23.3688),
    [cost["case-pick"].delta_total_eur, cost["cross-dock"].delta_total_eur, cost.returns.delta_total_eur].join(" / "));
  const w = {};
  for (const r of c.wait) w[r.location + "|" + r.op] = r;
  check("1d. station wait keyed by bench + operation: face/case-pick waits 1 both sides, delta 0; ret/inspect still waiting 1 both sides",
    w["face|case-pick"] && w["face|case-pick"].delta_waits === 0 && w["face|case-pick"].avg_wait_ticks_a === 4 && w["ret|inspect"] && w["ret|inspect"].still_waiting_a === 1 && w["ret|inspect"].delta_still_waiting === 0 && w["ret|inspect"].delta_avg_wait_ticks === null);
  const r2 = RL.compare(b, a);
  check("1e. the reverse pair negates every delta; the pair names both runs and knows they share scenario and profile",
    r2.cycle.find((x) => x.archetype === "case-pick").delta_avg_cycle_ticks === -10 && near(r2.cost.find((x) => x.archetype === "case-pick").delta_total_eur, -6.1656) &&
    c.run_a === a.run.id && c.run_b === b.run.id && c.run_a !== c.run_b && c.same_scenario === true);
  const b2 = handLedger("RUN-hand-s3-h00000002", 0);
  b2.hus = b2.hus.filter((h) => h.archetype !== "cross-dock"); b2.events = b2.events.filter((e) => e.hu_id.indexOf("000002") < 0);
  const c2 = RL.compare(a, b2);
  const xd = c2.cycle.find((x) => x.archetype === "cross-dock");
  check("1f. a key present in one run only survives: cross-dock appears with B's side and the delta null; the summary delta counts the missing unit",
    xd && xd.units_a === 1 && xd.units_b === null && xd.delta_units === null && c2.summary[0].delta_units === -1 && c2.cost.find((x) => x.archetype === "cross-dock").total_eur_b === null);
  const noRates = handLedger("RUN-hand-s4-h00000003", 0); delete noRates.rates;
  const c3 = RL.compare(a, noRates);
  check("1g. a run without rates compares with null cost on its side, every archetype still listed", c3.cost.length === 3 && c3.cost.every((x) => x.total_eur_b === null && x.delta_total_eur === null) && near(c3.cost.find((x) => x.archetype === "case-pick").total_eur_a, 17.2032));
  const p2 = handLedger("RUN-hand-s5-h00000004", 0); p2.run.profile = "beverage";
  check("1h. a different profile is flagged (same_scenario false) rather than silently compared", RL.compare(a, p2).same_scenario === false);
})();

/* ---- 2. the recorded pair ----------------------------------------------- */
(function () {
  const A1 = record(R.defaultMix()), B1 = record(MIX_B);
  const fixB = JSON.parse(read("test/fixtures/run-ledger-b.json"));
  check("2a. fixture B is byte-identical to a fresh run of the same floor, seed and mix (" + B1.exp.hus.length + " units, " + B1.exp.events.length + " events)", JSON.stringify(fixB) === JSON.stringify(B1.exp));
  check("2b. its stats and views files match", JSON.stringify(JSON.parse(read("test/fixtures/run-ledger-b.stats.json"))) === JSON.stringify(L.stats(B1.rec)) &&
    JSON.stringify(JSON.parse(read("test/fixtures/run-ledger-b.views.json")).flowLinks) === JSON.stringify(L.flowLinks(B1.exp)));
  check("2c. B has a different run id (the hash covers the mix), the same scenario and profile, and the declared mix", B1.exp.run.id !== A1.exp.run.id && B1.exp.run.scenario === A1.exp.run.scenario && B1.exp.run.profile === A1.exp.run.profile && JSON.stringify(B1.exp.run.mix) === JSON.stringify(MIX_B), B1.exp.run.id);
  const vb = RL.views(B1.exp), va = RL.views(A1.exp);
  const inv = vb.invariants;
  check("2d. B's invariants hold (conservation, no cross-dock in storage, versions, terminals)", Object.keys(inv).every((k) => inv[k] === 0));
  const largest = vb.cycle.reduce((m, r) => (r.units > m.units ? r : m), vb.cycle[0]);
  check("2e. cross-dock is B's largest order type (" + largest.units + " of " + vb.summary.units + " units) and it never entered storage", largest.archetype === "cross-dock" && vb.invariants.v_cross_dock_violations === 0);
  const c = RL.compare(A1.exp, B1.exp);
  const byA = {}, byB = {};
  for (const r of va.cycle) byA[r.archetype] = r;
  for (const r of vb.cycle) byB[r.archetype] = r;
  const paired = c.cycle.every((r) => (r.units_a === (byA[r.archetype] ? byA[r.archetype].units : null)) && (r.units_b === (byB[r.archetype] ? byB[r.archetype].units : null)) &&
    (r.delta_units === (byA[r.archetype] && byB[r.archetype] ? byB[r.archetype].units - byA[r.archetype].units : null)));
  const keys = new Set([...Object.keys(byA), ...Object.keys(byB)]);
  check("2f. every compare row is exactly the pairing of views(A) and views(B); every archetype of either run appears once (" + keys.size + ")", paired && c.cycle.length === keys.size && new Set(c.cycle.map((r) => r.archetype)).size === keys.size);
  check("2g. summary deltas are B - A of the two summaries; dispatch delta of delivered units likewise",
    c.summary[0].delta_units === vb.summary.units - va.summary.units && c.summary[0].delta_delivered === vb.summary.delivered - va.summary.delivered &&
    c.dispatch[0].delta_delivered_units === ((vb.dispatch ? vb.dispatch.delivered_units : null) - (va.dispatch ? va.dispatch.delivered_units : null)));
  const cw = c.wait;
  check("2h. wait rows are keyed by bench + operation and never duplicate", new Set(cw.map((r) => r.location + "|" + r.op)).size === cw.length && cw.length >= 3);
  const cc = c.cost.find((r) => r.archetype === "cross-dock");
  check("2i. cost per type is compared too: cross-dock exists on both sides with a numeric delta", cc && cc.total_eur_a != null && cc.total_eur_b != null && typeof cc.delta_total_eur === "number");
  check("2j. compare() never mutates either export", JSON.stringify(A1.exp) === JSON.stringify(L.exportJson(A1.rec)) && JSON.stringify(B1.exp) === JSON.stringify(L.exportJson(B1.rec)));
})();

/* ---- 3. shipped wiring ------------------------------------------------ */
(function () {
  const html = read("run-ledger.html"), js = read("run-ledger.js"), sw = read("sw.js"), runall = read("test/run-all.mjs"), py = read("tools/run_ledger.py"), mk = read("tools/make_run_ledger_fixture.mjs");
  check("3a. the viewer has the second input, the demo-B button and the section", /id="rlFileB"/.test(html) && /id="rlDemoB"/.test(html) && /id="rlCompare"/.test(html) && /run-ledger-b\.json/.test(js));
  check("3b. sw.js precaches fixture B at wt-v144 (previously wt-v143)", /"\.\/test\/fixtures\/run-ledger-b\.json"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v144"/.test(sw) && /Previously wt-v143/.test(sw));
  const views = ["v_compare_summary", "v_compare_cycle", "v_compare_touches", "v_compare_wait", "v_compare_dispatch", "v_compare_cost"];
  check("3c. the six compare views exist in SQL and in RunLedger.SQL; the tool has a `compare` command", views.every((v) => py.indexOf("CREATE VIEW IF NOT EXISTS " + v + " AS") >= 0 && typeof RL.SQL[v] === "string") && /def compare\(/.test(py) && /"compare"/.test(py) && /--runs/.test(py));
  check("3d. the fixture script builds the variants and documents them", /run-ledger-b/.test(mk) && /MIX_B/.test(mk) && /\[a\|b\|c\|d\|all\]/.test(mk));
  check("3e. test/run-all.mjs lists this harness", /verify_run_compare\.js/.test(runall));
  check("3f. no Date / Math.random CALL in run-ledger.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(js));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL RUN-COMPARE CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
