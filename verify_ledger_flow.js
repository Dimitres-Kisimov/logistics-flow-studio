/* =====================================================================
 * Logistics Flow Studio - verify_ledger_flow.js
 * v3.36 THE FLOW AS RECORDED - headless verification
 * ---------------------------------------------------------------------
 * ledger.js turns a run export into LINKS between operations (one per unit
 * whose consecutive non-queued events moved from one operation to the next;
 * a unit's two events at its terminal operation collapse) and into a Sankey
 * model; analytics.js lays that model out as a LAYERED, branching network
 * (columns by longest path from goods-in, nodes stacked per column, every
 * ribbon in its own slice of the bar). This harness proves:
 *   1. The HAND ledger (the Python test's three units): exactly six links,
 *      all of one unit, with the eaches that left each operation; columns
 *      receive 0 / depalletise + stage-out 1 / case-pick 2 / palletise 3 /
 *      load 4; no overlap, every slice inside its bar.
 *   2. The RECORDED run (fixture floor, seed 31, 300 ticks): the links equal
 *      the committed run-ledger.views.json (which the Python test equates
 *      with v_flow_links); over the RETIRED units every interior operation
 *      conserves (in = out); over all units in >= out; for every operation
 *      the units entering it = units with a non-queued event there minus
 *      those that started there; the geometry: no overlap within a column,
 *      every slice inside its bar, ribbon width proportional to value, one
 *      dominant, no back-links (the routes are acyclic - asserted on every
 *      route of the plan); the SVG is deterministic, well-formed, themed,
 *      one <path> per non-zero link; eaches mode re-values the same links.
 *   3. The LINEAR Sankey is untouched: its golden hashes live in
 *      verify_analytics.js.
 *   4. Shipped wiring: the viewer loads analytics.js and has the section;
 *      the planner's Analyze card draws the recorded flow beside the stage
 *      model; RunLedger.SQL and tools/run_ledger.py carry v_flow_links;
 *      sw.js at wt-v123; the runner.
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
function wellFormed(svg) {
  if (/NaN|undefined/.test(svg)) return false;
  const open = (svg.match(/<(svg|path|rect|text|title|desc)\b/g) || []).length;
  const close = (svg.match(/<\/(svg|path|rect|text|title|desc)>/g) || []).length;
  return open === close && svg.indexOf("<svg") === 0 && svg.lastIndexOf("</svg>") === svg.length - 6;
}
function geometryChecks(tag, model) {
  const geo = A.sankeyLayoutLayered(model);
  let overlap = false, outside = false;
  for (const c of geo.columns) for (let j = 1; j < c.length; j++) { const a = geo.nodes[c[j - 1]], b = geo.nodes[c[j]]; if (a.y + a.h > b.y + 1e-9) overlap = true; }
  for (const l of geo.links) {
    const f = geo.nodes[l.fromIdx], t = geo.nodes[l.toIdx];
    if (l.w <= 0) continue;
    if (l.y0Top < f.y - 1e-9 || l.y0Bot > f.y + f.h + 1e-9 || l.y1Top < t.y - 1e-9 || l.y1Bot > t.y + t.h + 1e-9) outside = true;
    if (Math.abs(l.x0 - (f.x + f.w)) > 1e-9 || Math.abs(l.x1 - t.x) > 1e-9) outside = true;
  }
  check(tag + ": no two nodes overlap within a column and every ribbon slice lies inside its bar", !overlap && !outside, geo.columns.length + " columns");
  const widest = geo.links.reduce((a, l) => (l.value > a.value ? l : a), geo.links[0]);
  const prop = geo.links.every((l) => l.value <= 0 ? l.w === 0 : (Math.abs(l.w / widest.w - l.value / widest.value) <= 0.02 || l.w <= 1.001));
  check(tag + ": ribbon width is proportional to value (floored at 1 px) and exactly one dominant link is flagged", prop && geo.links.filter((l) => l.isDominant).length === 1 && geo.links.find((l) => l.isDominant).value === model.maxVolume);
  const svg1 = A.sankeySvgLayered(model, "light");
  check(tag + ": the SVG is deterministic, well-formed, themed (light != dark), one <path> per non-zero link",
    svg1 === A.sankeySvgLayered(model, "light") && wellFormed(svg1) && svg1 !== A.sankeySvgLayered(model, "dark") && (svg1.match(/<path /g) || []).length === model.links.filter((l) => l.value > 0).length && /role="img"/.test(svg1) && /<title>/.test(svg1));
  return geo;
}

/* ---- the hand ledger ---------------------------------------------------- */
function handLedger() {
  const run = "RUN-hand-s1-h00000000";
  const o = (n) => "ORD-" + run + "-" + String(n).padStart(6, "0");
  const hu = (n) => "HU-" + o(n) + "-1";
  const ev = (h, v, kind, op, loc, tick, p, c, e, pa, ret, scr) => ({ id: "EVT-" + h + "-" + v, hu_id: h, version: v, kind, op, anchor: null, location: loc,
    tick, minute: tick, stage: null, form: null, pallets: p, cases: c, eaches: e, parcels: pa, retained: ret || 0, scrapped: scr || 0 });
  const A1 = hu(1), B1 = hu(2), C1 = hu(3);
  return {
    schema: "factory-run-ledger/v1",
    run: { id: run, scenario: "hand", seed: 1, hash: "00000000", mix: null, profile: "ecommerce", ticks_per_hour: 60, minutes_per_tick: 1, ticks: 40, honesty: "hand" },
    profile: null, locations: [],
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

console.log("v3.36 - the flow as recorded");
console.log("=".repeat(72));

/* ---- 1. the hand ledger ------------------------------------------------- */
(function () {
  const exp = handLedger();
  const links = L.flowLinks(exp);
  const want = [["case-pick", "palletise", 1, 1, 48], ["depalletise", "case-pick", 1, 1, 576], ["palletise", "load", 1, 1, 48], ["receive", "depalletise", 1, 1, 576], ["receive", "stage-out", 1, 1, 576], ["stage-out", "load", 1, 1, 576]];
  check("1a. exactly six links, one unit each, carrying the eaches that left the from-operation (sorted like SQL)",
    JSON.stringify(links.map((l) => [l.from_op, l.to_op, l.units, l.retired_units, l.eaches])) === JSON.stringify(want), JSON.stringify(links.map((l) => l.from_op + ">" + l.to_op)));
  const m = L.sankeyFromLedger(exp);
  check("1b. the model names the operations in the catalogue's order and values links in units",
    m.nodes.map((n) => n.id).join(",") === "receive,depalletise,case-pick,palletise,stage-out,load" && m.mode === "ledger" && m.unit === "units" && m.maxVolume === 1 && m.links.length === 6 && m.nodes[1].label === R.OPERATIONS.depalletise.label);
  const geo = A.sankeyLayoutLayered(m);
  const cols = {};
  for (const nd of geo.nodes) cols[nd.id] = nd.column;
  check("1c. columns by longest path: receive 0, depalletise + stage-out 1, case-pick 2, palletise 3, load 4; not cyclic",
    JSON.stringify(cols) === JSON.stringify({ receive: 0, depalletise: 1, "case-pick": 2, palletise: 3, "stage-out": 1, load: 4 }) && !geo.cyclic && geo.columns.length === 5, JSON.stringify(cols));
  check("1d. load's bar takes both units in; receive's bar sends both out; the queued inspect never became a link", geo.nodes.find((n) => n.id === "load").inSum === 2 && geo.nodes.find((n) => n.id === "receive").outSum === 2 && !m.nodes.some((n) => n.id === "inspect"));
  geometryChecks("1e. hand geometry", m);
  const me = L.sankeyFromLedger(exp, { unit: "eaches" });
  check("1f. in eaches the same links carry what left each operation (max 576) and the pick does not conserve", me.maxVolume === 576 && me.links.length === 6 && A.sankeyLayoutLayered(me).nodes.find((n) => n.id === "case-pick").inSum === 576 && A.sankeyLayoutLayered(me).nodes.find((n) => n.id === "case-pick").outSum === 48);
  const cyc = { mode: "ledger", unit: "units", nodes: [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }], links: [{ from: "a", to: "b", fromIdx: 0, toIdx: 1, value: 2 }, { from: "b", to: "c", fromIdx: 1, toIdx: 2, value: 2 }, { from: "c", to: "b", fromIdx: 2, toIdx: 1, value: 1 }], maxVolume: 2, honesty: "" };
  const gc = A.sankeyLayoutLayered(cyc);
  check("1g. a cycle is flagged, its nodes still placed, the back-link marked and outlined in the SVG", gc.cyclic && gc.nodes.every((n) => n.column >= 0) && gc.links.filter((l) => l.back).length >= 1 && /stroke=/.test(A.sankeySvgLayered(cyc, "light")) && wellFormed(A.sankeySvgLayered(cyc, "light")));
  check("1h. fewer than two operations -> no geometry, a plain 'nothing to draw' SVG", A.sankeyLayoutLayered({ nodes: [{ id: "x", name: "x" }], links: [] }) === null && /No recorded flow/.test(A.sankeySvgLayered({ nodes: [{ id: "x", name: "x" }], links: [] }, "light")));
})();

/* ---- 2. the recorded run ------------------------------------------------ */
(function () {
  const mix = R.defaultMix();
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  const exp = L.exportJson(rec);
  const links = L.flowLinks(exp);
  const views = JSON.parse(read("test/fixtures/run-ledger.views.json"));
  check("2a. the links equal the committed run-ledger.views.json (" + links.length + " links; the Python test equates them with v_flow_links)", JSON.stringify(links) === JSON.stringify(views.flowLinks) && links.length > 10);
  const same = links.filter((l) => l.from_op === l.to_op).length;
  check("2b. no link joins an operation to itself (the terminal double event collapsed)", same === 0);
  const mr = L.sankeyFromLedger(exp, { retiredOnly: true });
  const gr = A.sankeyLayoutLayered(mr);
  const interior = gr.nodes.filter((n) => n.inSum > 0 && n.outSum > 0);
  check("2c. over the RETIRED units every interior operation conserves: in = out at " + interior.length + " operations", interior.length >= 3 && interior.every((n) => n.inSum === n.outSum), interior.map((n) => n.id + " " + n.inSum + "/" + n.outSum).join(", "));
  const ma = L.sankeyFromLedger(exp);
  const ga = A.sankeyLayoutLayered(ma);
  check("2d. over ALL units in >= out at every operation (units in flight have entered but not left)", ga.nodes.every((n) => n.inSum >= n.outSum || n.column === 0));
  // the identity the Python test runs in SQL: units entering X = units with a non-queued event at X - units whose first non-queued event is at X
  const byHu = {};
  for (const e of exp.events) if (e.kind !== "queued") (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
  const at = {}, first = {};
  for (const id of Object.keys(byHu)) {
    const evs = byHu[id].sort((a, b) => a.version - b.version);
    const seen = {};
    for (const e of evs) if (!seen[e.op]) { seen[e.op] = 1; at[e.op] = (at[e.op] || 0) + 1; }
    first[evs[0].op] = (first[evs[0].op] || 0) + 1;
  }
  const entering = {};
  for (const l of links) entering[l.to_op] = (entering[l.to_op] || 0) + l.units;
  check("2e. for every operation, units entering it = units recorded there - units that started there (" + Object.keys(at).length + " operations)", Object.keys(at).every((op) => (entering[op] || 0) === at[op] - (first[op] || 0)));
  const sinks = gr.nodes.filter((n) => n.outSum === 0 && n.inSum > 0).map((n) => n.id).sort().join(",");
  check("2f. the recorded network branches: it ends in more than one terminal operation (" + sinks + ") and returns / cross-dock lanes are visible", sinks.split(",").length >= 2 && links.some((l) => l.to_op === "stage-out" && l.from_op !== "wrap"));
  geometryChecks("2g. recorded geometry (all units)", ma);
  geometryChecks("2h. recorded geometry (retired units)", mr);
  check("2i. no back-links: every route of the plan is acyclic (no operation twice) and the layout confirms it", plan.routes.every((r) => new Set(r.ops).size === r.ops.length) && !ga.cyclic && ga.links.every((l) => !l.back));
  const order = R.OPERATION_ORDER;
  check("2j. nodes follow the operation catalogue's order; every node is a real operation", ma.nodes.every((n, i) => i === 0 || order.indexOf(n.id) >= order.indexOf(ma.nodes[i - 1].id)) && ma.nodes.every((n) => !!R.OPERATIONS[n.id]));
  const me = L.sankeyFromLedger(exp, { unit: "eaches" });
  check("2k. eaches mode re-values the same links (max = the largest eaches leaving an operation)", me.links.length === ma.links.length && me.maxVolume === Math.max.apply(null, links.map((l) => l.eaches)) && me.unit === "eaches");
  const v = RL.views(exp);
  check("2l. the viewer's views(exp).flowLinks is the same list", JSON.stringify(v.flowLinks) === JSON.stringify(links));
  const svg = A.sankeySvgLayered(ma, "dark");
  check("2m. labels: every operation is named once in the SVG, short ids so they fit between columns", ma.nodes.every((n) => (svg.match(new RegExp(">" + n.id.replace(/[-]/g, "\\-") + "<", "g")) || []).length === 1));
})();

/* ---- 4. shipped wiring ------------------------------------------------ */
(function () {
  const app = read("app.js"), html = read("run-ledger.html"), sw = read("sw.js"), runall = read("test/run-all.mjs"), py = read("tools/run_ledger.py"), va = read("verify_analytics.js");
  check("4a. the viewer page loads analytics.js after ledger.js and has the section", /<script src="ledger\.js"><\/script><script src="analytics\.js"><\/script><script src="run-ledger\.js">/.test(html) && /id="rlFlow"/.test(html));
  check("4b. the planner's Analyze card draws the recorded flow beside the stage model, gated on a live ledger", /state\.flow\.ledger && WT\.ledger && typeof WT\.ledger\.sankeyFromLedger === "function"/.test(app) && /WT\.analytics\.sankeySvgLayered\(lm, theme\)/.test(app));
  check("4c. RunLedger.SQL and tools/run_ledger.py carry v_flow_links, and summary() includes it", typeof RL.SQL.v_flow_links === "string" && /CREATE VIEW IF NOT EXISTS v_flow_links AS/.test(py) && /"v_flow_links"\)/.test(py));
  check("4d. the linear sankey is frozen by golden hashes in verify_analytics.js", /25c555a5434113107cdb0faa99d71bc5a1bdc229/.test(va) && /a1bbbf8c6820cb119abf3c6557450997a2f59e2c/.test(va) && /f12ec1728898f9021ba1c9cab0a82ce1e507c91e/.test(va));
  check("4e. sw.js at wt-v123 (previously wt-v122) precaches analytics.js and the viewer", /CACHE_VERSION\s*=\s*"wt-v123"/.test(sw) && /Previously wt-v122/.test(sw) && /"\.\/analytics\.js"/.test(sw) && /"\.\/run-ledger\.js"/.test(sw));
  check("4f. test/run-all.mjs lists this harness", /verify_ledger_flow\.js/.test(runall));
  check("4g. no Date / Math.random CALL in the layered layout or ledger.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(read("ledger.js")) && !/Math\.random\(/.test(read("analytics.js")));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL LEDGER-FLOW CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
