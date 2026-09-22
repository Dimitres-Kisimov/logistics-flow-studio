/* =====================================================================
 * Logistics Flow Studio - verify_pool.js
 * v3.44 YOUR OWN ORDERS, THROUGH THE LEDGER - headless verification
 * ---------------------------------------------------------------------
 * Until v3.44 the imported order pool reached the flow only as two scalars
 * (a count and a line shape), a unit knew no order, the ledger derived the
 * order id from the unit's counter and drew every quantity from a hash of
 * the unit id. Now flowsim takes the pool itself (opts.pool): ONE UNIT PER
 * ORDER LINE, released in pool order; the ledger names the order (n) and
 * the line (k) - HU-ORD-<run>-<n>-<k> - keeps the line's sku and quantity
 * on the unit, lets the line's quantity drive the entering quantity of a
 * returns / vas / export line and the pick of a case- or piece-pick line
 * (a pallet archetype moves a whole pallet whatever the line says), and
 * records the pool's provenance in run.dataset; the pool digest joins the
 * run id. Consolidation is modelled AT DISPATCH (v_dispatch_by_order): the
 * pallets an order needs from its delivered cases. This harness proves:
 *   1. A HAND pool (3 orders, 6 lines) on the hand floor: exactly six units,
 *      the ids in pool order, seq = the unit counter, order_ref / sku /
 *      line_qty as the pool gave them, the run id changed by the pool while
 *      the pool-less hash is untouched, the quantities by the rule.
 *   2. loop: the pool re-releases from its first line; a re-released order
 *      counts on (cycle x orders + n).
 *   3. No pool -> the export is byte for byte fixture A (nothing changed
 *      for the synthetic stream); the pool-less ids keep k = 1.
 *   4. The viewer's dispatchByOrder on the hand run and a two-line
 *      consolidation case, identical in shape to v_dispatch_by_order.
 *   5. Fixture D rebuilt through the REAL importer (docs/examples CSVs via
 *      wmsdata.importSkusCsv / importOrdersCsv) equals the committed files.
 *   6. Shipped wiring: the page and ?example=d, the fixture usage string,
 *      the SQL view and reconcile key, CI, the app's opts.pool, the README
 *      section, the sample files with the exact headers, the runner.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
const load = (files) => { for (const f of files) (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8")); };
load(["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js"]);
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, A = global.WT.analytics, P = global.WT.pack, I = global.WT.ids, RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

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
const POOL = [
  { orderId: "A", lines: [{ sku: "S1", qty: 2 }, { sku: "S2", qty: 12 }] },
  { orderId: "B", lines: [{ sku: "S1", qty: 5 }] },
  { orderId: "C", lines: [{ sku: "S3", qty: 1 }, { sku: "S2", qty: 7 }, { sku: "S1", qty: 3 }] },
];
const MIX = R.defaultMix();

function record(layout, opts, meta, ticks) {
  const plan = F.spawnPlan(layout, opts);
  const st = F.state(plan);
  const rec = L.create(plan, Object.assign({ layout: layout, rates: A.defaultRates() }, meta));
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, ticks);
  return { plan: plan, st: st, rec: rec, exp: L.exportJson(rec) };
}

/* ---- 1. the hand pool ---------------------------------------------------- */
const H = record(FLOOR, { seed: 31, mix: MIX, pool: POOL, loop: false }, { scenarioId: "hand-built", seed: 31, mix: MIX, profile: P.PROFILES.ecommerce, dataset: { source: "hand", skus: 3 } }, 300);
(function () {
  const hus = H.exp.hus;
  check("1a. the plan carries the pool: 6 lines, totalUnits 6, and exactly six units spawned then the pool drained",
    H.plan.poolLines === 6 && H.plan.totalUnits === 6 && H.st.spawned === 6 && hus.length === 6, H.st.spawned + " spawned");
  const tail = hus.map((h) => h.id.slice(-9)).join(",");
  check("1b. the ids name order and line in pool order: 000001-1, 000001-2, 000002-1, 000003-1, 000003-2, 000003-3",
    tail === "-000001-1,-000001-2,-000002-1,-000003-1,-000003-2,-000003-3" && hus.every((h) => h.order_id === h.id.replace(/-\d+$/, "").slice(3)), tail);
  check("1c. seq is still the unit counter; order_ref, sku and line_qty are the pool's own",
    hus.map((h) => h.seq).join(",") === "1,2,3,4,5,6" && hus.map((h) => h.order_ref).join("") === "AABCCC" &&
    hus.map((h) => h.sku).join(",") === "S1,S2,S1,S3,S2,S1" && hus.map((h) => h.line_qty).join(",") === "2,12,5,1,7,3");
  check("1d. run.dataset records the provenance; the run id differs from the pool-less run; the pool-less hash is untouched (c28a7688)",
    JSON.stringify(H.exp.run.dataset) === JSON.stringify({ source: "hand", orders: 3, lines: 6, skus: 3 }) &&
    I.inputHash(FLOOR, 31, MIX) === "c28a7688" && I.inputHash(FLOOR, 31, MIX, POOL) !== "c28a7688" && H.exp.run.id === "RUN-hand-built-s31-h" + I.inputHash(FLOOR, 31, MIX, POOL), H.exp.run.id);
  const byId = {}; for (const h of hus) byId[h.id.slice(-9)] = h;
  const served = (h, op) => H.exp.events.find((e) => e.hu_id === h.id && e.kind === "served" && e.op === op);
  const okQty = hus.every((h) => {
    const q = h.line_qty, epc = h.eaches_per_case, cpp = h.cases_per_pallet;
    if (h.archetype === "returns" || h.archetype === "vas") return h.received_eaches === q;
    if (h.archetype === "export-fragile") return h.received_eaches === Math.max(1, Math.ceil(q / epc)) * epc;
    if (h.archetype === "piece-pick") { const s = served(h, "piece-pick"); return h.received_eaches === cpp * epc && (!s || s.eaches === Math.min(cpp * epc, q)); }
    if (h.archetype === "case-pick") { const s = served(h, "case-pick"); return h.received_eaches === cpp * epc && (!s || s.cases === Math.min(cpp, Math.ceil(q / epc))); }
    return h.received_eaches === cpp * epc; // a pallet archetype moves a whole pallet whatever the line says
  });
  check("1e. quantities by the rule: a returns / vas line enters its qty, a pick takes its qty (cases rounded up), a pallet archetype moves a whole pallet",
    okQty, hus.map((h) => h.archetype + ":" + h.received_eaches).join(" "));
  const p1 = served(byId["-000001-1"], "piece-pick"), c2 = served(byId["-000001-2"], "case-pick");
  check("1f. the hand run's first two lines: piece-pick of qty 2 takes 2 eaches; case-pick of qty 12 takes one case of 12",
    byId["-000001-1"].archetype === "piece-pick" && p1 && p1.eaches === 2 && byId["-000001-2"].archetype === "case-pick" && c2 && c2.cases === 1 && c2.eaches === 12);
  check("1g. the conservation invariant holds on every pooled unit", Object.keys(RL.views(H.exp).invariants).every((k) => RL.views(H.exp).invariants[k] === 0));
  check("1h. determinism: the same pool records the same bytes", JSON.stringify(record(FLOOR, { seed: 31, mix: MIX, pool: POOL, loop: false }, { scenarioId: "hand-built", seed: 31, mix: MIX, profile: P.PROFILES.ecommerce, dataset: { source: "hand", skus: 3 } }, 300).exp) === JSON.stringify(H.exp));
})();

/* ---- 2. loop: the pool re-releases ------------------------------------- */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, pool: POOL, loop: true });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: MIX, layout: FLOOR, profile: P.PROFILES.ecommerce });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  let n = 0;
  while (st.spawned < 10 && n < 2000) { F.step(st, 1); n++; }
  const exp = L.exportJson(rec);
  const tails = exp.hus.slice(0, 10).map((h) => h.id.slice(-9)).join(",");
  check("2a. with loop the seventh unit restarts the pool: orders 4,4,5,6 (3 + n) with the lines 1,2,1,1",
    st.spawned >= 10 && tails === "-000001-1,-000001-2,-000002-1,-000003-1,-000003-2,-000003-3,-000004-1,-000004-2,-000005-1,-000006-1", tails);
  check("2b. the re-released units carry the same order_ref / sku / line_qty as the first pass", exp.hus[6].order_ref === "A" && exp.hus[6].line_qty === 2 && exp.hus[9].order_ref === "C" && exp.hus[9].sku === "S3");
  check("2c. run.dataset counts the pool once (3 orders, 6 lines)", exp.run.dataset.orders === 3 && exp.run.dataset.lines === 6);
})();

/* ---- 3. no pool: nothing changed --------------------------------------- */
(function () {
  const a = record(FLOOR, { seed: 31, mix: MIX }, { scenarioId: "hand-built", seed: 31, mix: MIX, profile: P.PROFILES.ecommerce }, 300);
  check("3a. without a pool the export is byte for byte fixture A", JSON.stringify(a.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))), a.exp.run.id);
  check("3b. without a pool no unit carries order_ref / sku / line_qty, every id ends in -1, and run.dataset is absent",
    a.exp.hus.every((h) => !("order_ref" in h) && !("sku" in h) && !("line_qty" in h) && /-1$/.test(h.id)) && !("dataset" in a.exp.run) && !("pool" in a.plan));
  check("3c. an empty pool is no pool", !("pool" in F.spawnPlan(FLOOR, { seed: 31, mix: MIX, pool: [] })) && !("pool" in F.spawnPlan(FLOOR, { seed: 31, mix: MIX, pool: [{ orderId: "X", lines: [] }] })));
})();

/* ---- 4. dispatch by order (the viewer's twin of v_dispatch_by_order) ---- */
(function () {
  const rows = RL.views(H.exp).dispatchByOrder;
  const by = {}; for (const r of rows) by[r.order_id.slice(-6)] = r;
  const one = by["000001"], two = by["000002"], three = by["000003"];
  check("4a. three orders; order 1 has two lines both delivered (2 + 12 eaches, 2 cases -> 1 pallet needed)",
    rows.length === 3 && one && one.lines === 2 && one.delivered_lines === 2 && one.eaches_out === 14 && one.cases === 2 && one.pallets_needed === 1 && one.order_ref === "A", JSON.stringify(one));
  check("4b. order 2 (full pallet out) delivers 576 eaches / 48 cases -> 1 pallet; order 3 has three lines, one delivered (cross-dock 48 cases -> 1), a live pick and a restocked return",
    two && two.lines === 1 && two.cases === 48 && two.pallets_needed === 1 && three && three.lines === 3 && three.delivered_lines === 1 && three.cases === 48 && three.pallets_needed === 1 && three.eaches_in === 576 + 576 + 3, JSON.stringify(three));
  check("4c. the columns are exactly the SQL view's", rows.every((r) => Object.keys(r).join(",") === "order_id,order_ref,lines,delivered_lines,eaches_in,eaches_out,cases,parcels,cases_per_pallet,pallets_needed"));
  const nothing = RL.views(record(FLOOR, { seed: 31, mix: MIX, pool: POOL, loop: false }, { scenarioId: "hand-built", seed: 31, mix: MIX, profile: P.PROFILES.ecommerce }, 60).exp).dispatchByOrder;
  check("4d. before anything is delivered every order shows 0 delivered lines, 0 cases and 0 pallets needed", nothing.length > 0 && nothing.every((r) => r.delivered_lines === 0 && r.cases === 0 && r.pallets_needed === 0));
})();

/* ---- 5. fixture D through the real importer ---------------------------- */
load(["compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js", "wmsdata.js"]);
(function () {
  const WD = global.WT.wmsdata, E = global.WT.examples;
  const skus = WD.importSkusCsv(read(path.join("docs", "examples", "skus.csv")));
  const orders = WD.importOrdersCsv(read(path.join("docs", "examples", "orders.csv")), skus.skus);
  check("5a. docs/examples/skus.csv imports (120 articles, no errors) and orders.csv imports against it (300 orders)",
    skus.ok && skus.skus.length === 120 && orders.ok && orders.orders.length === 300 && orders.orders.every((o) => o.lines.length >= 1 && o.lines.length <= 6), (skus.errors || []).concat(orders.errors || []).map((e) => e.msg).join("; "));
  const id = "ecommerce-multichannel-fc";
  const b = E.build(id);
  const lay = { gridW: b.gridW, gridH: b.gridH, cell: 1, elements: b.elements, config: b.config };
  const d = record(lay, { seed: 6, mix: lay.config.orderMix, pool: orders.orders }, { scenarioId: id, seed: 6, mix: lay.config.orderMix, profile: P.profileFor(id), pool: orders.orders, dataset: { source: "docs/examples sample (synthetic)", skus: skus.skus.length } }, 180);
  const cost = L.costs(d.exp);
  const files = { json: JSON.stringify(d.exp, null, 1) + "\n", stats: JSON.stringify(L.stats(d.rec), null, 1) + "\n", views: JSON.stringify({ costByType: cost.byType, costByLocation: cost.byLocation, costTotal: cost.total, flowLinks: L.flowLinks(d.exp) }, null, 1) + "\n" };
  const fx = (n) => lf(read(path.join("test", "fixtures", "run-ledger-d" + n)));
  check("5b. fixture D rebuilt from the CSVs equals its committed files byte for byte", files.json === fx(".json") && files.stats === fx(".stats.json") && files.views === fx(".views.json"), d.exp.run.id);
  const lines = orders.orders.reduce((a, o) => a + o.lines.length, 0);
  check("5c. D names its provenance (300 orders, every line, 120 articles), every unit carries an order_ref, and some orders have a second line in flight",
    d.exp.run.dataset.orders === 300 && d.exp.run.dataset.lines === lines && d.exp.run.dataset.skus === 120 && d.exp.hus.every((h) => /^ORD-\d{4}$/.test(h.order_ref) && h.line_qty >= 1 && h.line_qty <= 12) && d.exp.hus.some((h) => /-2$/.test(h.id)), lines + " lines");
  check("5d. D's id differs from C's (the pool digest is in the hash) while the scenario and seed are the same", d.exp.run.id !== "RUN-ecommerce-multichannel-fc-s6-h5bc1a783" && /^RUN-ecommerce-multichannel-fc-s6-h[0-9a-f]{8}$/.test(d.exp.run.id));
  const g = RL.glance(d.exp);
  check("5e. the glance says own data with the counts; no floor-rate flag on this floor", /^own data: 300 orders \/ \d+ lines$/.test(g.dataset.text) && !g.flags.some((f) => f.kind === "floor-rate"), g.dataset.text);
})();

/* ---- 6. shipped wiring -------------------------------------------------- */
(function () {
  const html = read("run-ledger.html"), js = read("run-ledger.js"), mk = read(path.join("tools", "make_run_ledger_fixture.mjs")), py = read(path.join("tools", "run_ledger.py"));
  const ci = read(path.join(".github", "workflows", "ci.yml")), runall = read(path.join("test", "run-all.mjs")), app = read("app.js"), readme = read("README.md"), st = read("run-ledger-selftest.js");
  check("6a. the page offers example D and the handler fetches it", /id="rlDemoD"/.test(html) && /run-ledger-d\.json/.test(js) && /d: "rlDemoD"/.test(js));
  check("6b. the fixture script documents [a|b|c|d|all] and feeds the CSVs through the importer", /\[a\|b\|c\|d\|all\]/.test(mk) && /importOrdersCsv/.test(mk) && /docs\/examples/.test(mk) && /wmsdata\.js/.test(mk));
  check("6c. tools/run_ledger.py has v_dispatch_by_order in DETAIL_VIEWS and the reconcile keys, the dataset and line columns with guarded ALTERs and named inserts",
    /CREATE VIEW IF NOT EXISTS v_dispatch_by_order AS/.test(py) && /"v_dispatch_by_order": \("order_id",\)/.test(py) && /DETAIL_VIEWS = \([^)]*"v_dispatch_by_order"\)/.test(py) &&
    /ALTER TABLE \{table\} ADD COLUMN \{column\} \{typ\}/.test(py) && /INSERT INTO hu\(id, run_id/.test(py) && /INSERT INTO run\(id, scenario/.test(py) && typeof RL.SQL.v_dispatch_by_order === "string");
  check("6d. CI imports D, reconciles it and checks the sample data", /run-ledger-d\.json/.test(ci) && /run-ledger run-ledger-b run-ledger-c run-ledger-d/.test(ci) && /make_sample_data\.py --check/.test(ci));
  check("6e. the app hands the loaded pool to the flow and the ledger", /opts\.pool = /.test(app) && /function activeOrderPool\(/.test(app) && /pool: opts\.pool \|\| null/.test(app));
  check("6f. README has the section 'Run it on your own data' naming both headers and the sample files", /## Run it on your own data/.test(readme) && /sku,description,abc_class,velocity,weight_kg,storage_type/.test(readme) && /order_id,sku,qty/.test(readme) && /docs\/examples\/orders\.csv/.test(readme));
  check("6g. the viewer self-test drives example D and the runner lists this harness", /clickAndWait\("rlDemoD", "a"\)/.test(st) && /verify_pool\.js/.test(runall));
})();

console.log("");
console.log(fail === 0 ? "ALL POOL CHECKS PASSED (" + pass + ")" : fail + " POOL CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
