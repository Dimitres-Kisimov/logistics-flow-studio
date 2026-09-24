/* =====================================================================
 * Logistics Flow Studio - verify_run_ledger_view.js
 * v3.33 THE RUN-LEDGER VIEWER - headless verification of its pure model
 * ---------------------------------------------------------------------
 * run-ledger.js computes every table on the page from the export alone.
 * This harness proves those computations against:
 *   1. A HAND-BUILT ledger (the same three units / eleven events the Python
 *      test uses) with answers written out by hand: cycle time, touches,
 *      station wait, WIP at chosen ticks, quantities per operation, the
 *      dispatch manifest (2 pallets -> 1 trailer of 33), all invariants zero.
 *   2. The RECORDED fixture: the viewer's summary equals the JavaScript stats
 *      the app shows (which the Python test already equates with SQL), every
 *      invariant is zero, the ribbon has one lane per route with the units
 *      at the first operation equal to the route's unit count, and a trace
 *      has consecutive versions and non-negative spans.
 *   3. Corruption surfaces: one each off by one -> conservation violation;
 *      a cross-dock unit at a storage element -> cross-dock violation.
 *   5. (v3.39) ONE REPORT: the SQL under every table is generated from
 *      tools/run_ledger.py (23 views, verbatim, runnable, no placeholder);
 *      views()/model() are memoised per export; the glance model (mix text,
 *      totals, invariants, the data-quality flags incl. the floor-rate
 *      detection against flowsim's constant); csv (RFC 4180) and fmtCell;
 *      the page's ten sections, nav, skip link, print, self-test wiring;
 *      Your case bound once and debounced; the pinwheel search capped.
 *   4. Shipped wiring: page, stylesheet and script exist and are precached
 *      at wt-v146; the planner has the hand-over button; the offline guard
 *      rules hold (no external references).
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["run-ledger-sql.js", "run-ledger.js"]) (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
const RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
function handLedger() {
  const run = "RUN-hand-s1-h00000000";
  const o = (n) => "ORD-" + run + "-" + String(n).padStart(6, "0");
  const hu = (n) => "HU-" + o(n) + "-1";
  const ev = (h, v, kind, op, loc, tick, p, c, e, pa, ret, scr) => ({ id: "EVT-" + h + "-" + v, hu_id: h, version: v, kind, op, anchor: null, location: loc,
    tick, minute: tick, stage: null, form: null, pallets: p, cases: c, eaches: e, parcels: pa, retained: ret || 0, scrapped: scr || 0 });
  const A = hu(1), B = hu(2), C = hu(3);
  return {
    schema: "factory-run-ledger/v1",
    run: { id: run, scenario: "hand", seed: 1, hash: "00000000", mix: { "case-pick": 0.5, "cross-dock": 0.3, returns: 0.2 }, profile: "ecommerce", ticks_per_hour: 60, minutes_per_tick: 1, ticks: 40, honesty: "hand" },
    profile: { id: "ecommerce", label: "E-commerce", box: "case-400x300x250", pallet: "eur", eaches_per_case: 12, case_kg: 6, max_stack_mm: 1800, eaches_per_parcel: 6 },
    locations: [{ id: "in", type: "dock-in", category: "flow" }, { id: "dep", type: "depalletiser", category: "flow" }, { id: "face", type: "carton-flow", category: "storage" },
      { id: "wrap", type: "stretch-wrap", category: "flow" }, { id: "stg", type: "staging", category: "flow" }, { id: "out", type: "dock-out", category: "flow" }, { id: "ret", type: "returns-station", category: "flow" }],
    hus: [
      { id: A, order_id: o(1), seq: 1, archetype: "case-pick", outcome: null, route_id: "case-pick", sscc: "340123450000000017", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 0, retired_tick: 30, final_kind: "delivered", final: { pallets: 1, cases: 4, eaches: 48, parcels: 0, form: "wrapped-pallet", retained: 528, scrapped: 0 } },
      { id: B, order_id: o(2), seq: 2, archetype: "cross-dock", outcome: null, route_id: "cross-dock", sscc: "340123450000000024", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 576, spawned_tick: 5, retired_tick: 20, final_kind: "delivered", final: { pallets: 1, cases: 48, eaches: 576, parcels: 0, form: "pallet-load", retained: 0, scrapped: 0 } },
      { id: C, order_id: o(3), seq: 3, archetype: "returns", outcome: "scrap", route_id: "returns:scrap", sscc: "040123450000000031", gtin13: "4012345678901", gtin14: "14012345678908", pallet: "eur", box: "case-400x300x250", eaches_per_case: 12, cases_per_pallet: 48, received_eaches: 3, spawned_tick: 10, retired_tick: null, final_kind: null, final: null },
    ],
    events: [
      ev(A, 0, "created", "receive", "in", 0, 1, 48, 576, 0), ev(A, 1, "passed", "depalletise", "dep", 4, 0, 48, 576, 0), ev(A, 2, "queued", "case-pick", "face", 8, 0, 48, 576, 0),
      ev(A, 3, "served", "case-pick", "face", 12, 0, 4, 48, 0, 528), ev(A, 4, "passed", "palletise", "wrap", 20, 1, 4, 48, 0, 528), ev(A, 5, "delivered", "load", "out", 30, 1, 4, 48, 0, 528),
      ev(B, 0, "created", "receive", "in", 5, 1, 48, 576, 0), ev(B, 1, "passed", "stage-out", "stg", 12, 1, 48, 576, 0), ev(B, 2, "delivered", "load", "out", 20, 1, 48, 576, 0),
      ev(C, 0, "created", "receive", "in", 10, 0, 0, 3, 1), ev(C, 1, "queued", "inspect", "ret", 14, 0, 0, 3, 1),
    ],
  };
}

console.log("v3.33 - the run-ledger viewer: pure model");
console.log("=".repeat(72));

/* ---- 1. hand ledger --------------------------------------------------- */
(function () {
  const v = RL.views(handLedger());
  const cyc = {}; for (const r of v.cycle) cyc[r.archetype] = r;
  check("1a. cycle time: case-pick 30 ticks / 30 min, cross-dock 15 (min = max = 15), returns none retired",
    cyc["case-pick"].avg_cycle_ticks === 30 && cyc["case-pick"].avg_cycle_minutes === 30 && cyc["cross-dock"].avg_cycle_ticks === 15 &&
    cyc["cross-dock"].min_cycle_ticks === 15 && cyc["cross-dock"].max_cycle_ticks === 15 && cyc.returns.retired === 0 && cyc.returns.avg_cycle_ticks === null);
  const t = {}; for (const r of v.touches) t[r.archetype] = r;
  check("1b. touches: case-pick 6 events / 1 unit = 6.0 with 1 served; cross-dock 3.0; returns 2 events, 0 served",
    t["case-pick"].touches === 6 && t["case-pick"].served_per_unit === 1 && t["cross-dock"].touches === 3 && t.returns.events === 2 && t.returns.served_per_unit === 0);
  const w = {}; for (const r of v.wait) w[r.location + "|" + r.op] = r;
  check("1c. station wait: face/case-pick 1 wait of 4 ticks; ret/inspect 1 wait still waiting",
    w["face|case-pick"].waits === 1 && w["face|case-pick"].avg_wait_ticks === 4 && w["face|case-pick"].max_wait_ticks === 4 && w["ret|inspect"].still_waiting === 1 && w["ret|inspect"].avg_wait_ticks === null);
  const wip = {}; for (const r of v.wip) wip[r.tick] = r;
  check("1d. WIP by tick: 41 rows; in flight 1 @0, 2 @5, 3 @12, 2 @20 (1 retired), 1 @30 (2 retired), 1 @40",
    v.wip.length === 41 && wip[0].in_flight === 1 && wip[5].in_flight === 2 && wip[12].in_flight === 3 && wip[20].in_flight === 2 && wip[20].retired === 1 &&
    wip[30].in_flight === 1 && wip[30].retired === 2 && wip[40].in_flight === 1);
  const q = {}; for (const r of v.byOp) q[r.op + "|" + r.kind] = r;
  check("1e. quantities per op: 3 created carrying 2 pallets / 1155 eaches; served case-pick 4 cases with 528 retained; 2 delivered pallets / 624 eaches",
    q["receive|created"].events === 3 && q["receive|created"].pallets === 2 && q["receive|created"].eaches === 1155 &&
    q["case-pick|served"].cases === 4 && q["case-pick|served"].retained === 528 && q["load|delivered"].pallets === 2 && q["load|delivered"].eaches === 624);
  const d = v.dispatch;
  check("1f. dispatch: 2 units, 2 pallets, 52 cases, 624 eaches, 0 parcels, 33 slots -> 1 trailer at 6.06 %",
    d.delivered_units === 2 && d.pallets === 2 && d.cases === 52 && d.eaches === 624 && d.parcels === 0 && d.trailer_slots === 33 && d.trailers === 1 && Math.abs(d.fill - 0.0606) < 1e-4);
  check("1g. summary: 3 units, 11 events, 2 delivered, 624 eaches, 2 pallets", v.summary.units === 3 && v.summary.events === 11 && v.summary.delivered === 2 && v.summary.delivered_eaches === 624 && v.summary.delivered_pallets === 2);
  check("1h. every invariant is zero on the hand ledger", Object.keys(v.invariants).every((k) => v.invariants[k] === 0), JSON.stringify(v.invariants));
  const rib = RL.ribbon(handLedger());
  const cp = rib.find((l) => l.route === "case-pick");
  check("1i. the ribbon lane for case-pick walks receive > depalletise > case-pick > palletise > load with 1 unit and the right eaches after each",
    cp && cp.units === 1 && cp.steps.map((s) => s.op).join(">") === "receive>depalletise>case-pick>palletise>load" &&
    cp.steps.map((s) => s.eaches).join(",") === "576,576,48,48,48" && cp.steps[3].pallets === 1, cp && cp.steps.map((s) => s.op + ":" + s.eaches).join(" "));
  // the pallet-pattern what-if on the hand ledger: 576 + 576 pallet-borne eaches; EUR 48 x 12 = 576 per pallet
  // -> 2 pallets / 1 trailer now; industrial 60 x 12 = 720 -> still 2 pallets / 1 trailer
  const wi = RL.whatIf(handLedger(), { current: { pallet: "eur", cases: 48 }, best: { pallet: "ind", cases: 60 } });
  check("1k. the pallet-pattern what-if: 1152 pallet-borne eaches over 2 units -> 2 EUR pallets / 1 trailer now, 2 industrial pallets / 1 trailer with the best pattern",
    wi && wi.units === 2 && wi.eaches === 1152 && wi.now.pallets === 2 && wi.now.trailers === 1 && wi.best.pallets === 2 && wi.best.trailers === 1 && wi.best.slots === 26 && !wi.same);
  const tr = RL.trace(handLedger(), "HU-ORD-RUN-hand-s1-h00000000-000001-1");
  check("1j. a trace has 6 events, 5 spans, the case-pick wait span 8-12 marked waiting, start 0 end 30",
    tr && tr.events.length === 6 && tr.spans.length === 5 && tr.spans[2].state === "waiting" && tr.spans[2].from === 8 && tr.spans[2].to === 12 && tr.start === 0 && tr.end === 30);
})();

/* ---- 2. the recorded fixture ---------------------------------------- */
(function () {
  const exp = JSON.parse(read("test/fixtures/run-ledger.json"));
  const js = JSON.parse(read("test/fixtures/run-ledger.stats.json"));
  const v = RL.views(exp);
  check("2a. viewer summary == the app's JavaScript stats on the recorded fixture (units, events, delivered, eaches, pallets, parcels)",
    v.summary.units === js.units && v.summary.events === js.events && v.summary.delivered === js.delivered && v.summary.delivered_eaches === js.delivered_eaches &&
    v.summary.delivered_pallets === js.delivered_pallets && v.summary.delivered_parcels === js.delivered_parcels, JSON.stringify(v.summary));
  const cyc = {}; for (const r of v.cycle) cyc[r.archetype] = r;
  const tch = {}; for (const r of v.touches) tch[r.archetype] = r;
  check("2b. per-type units, retired, average cycle and touches equal the app's stats for every order type",
    js.types.every((t) => cyc[t.archetype] && cyc[t.archetype].units === t.units && cyc[t.archetype].retired === t.retired && cyc[t.archetype].avg_cycle_ticks === t.avg_cycle_ticks && tch[t.archetype].touches === t.touches));
  check("2c. every invariant is zero on the recorded run", Object.keys(v.invariants).every((k) => v.invariants[k] === 0), JSON.stringify(v.invariants));
  const rib = RL.ribbon(exp);
  const routes = new Set(exp.hus.map((h) => h.route_id));
  check("2d. one ribbon lane per route seen, and every lane's first operation was reached by all its units",
    rib.length === routes.size && rib.every((l) => l.steps.length > 0 && l.steps[0].units === l.units), rib.map((l) => l.route + ":" + l.steps.length).join(" "));
  const xd = rib.find((l) => l.route === "cross-dock");
  // units still in flight have not reached the later operations, so compare PER UNIT
  check("2e. the cross-dock lane carries the same eaches per unit and one pallet per unit at every operation (nothing split, nothing stored)",
    !!xd && xd.steps.every((s) => s.units > 0 && s.eaches / s.units === xd.steps[0].eaches / xd.steps[0].units && s.pallets === s.units));
  const tr = RL.trace(exp, exp.hus[0].id);
  check("2f. a trace has consecutive versions and non-negative spans", tr.events.every((e, i) => e.version === i) && tr.spans.every((s) => s.to >= s.from));
  check("2g. the station-wait table surfaces the put-away bottleneck the SQL views showed (staging pad, still waiting > 0)",
    v.wait.some((w) => w.location === "stg" && w.op === "putaway" && w.still_waiting > 0), v.wait.map((w) => w.location + "/" + w.op + ":" + w.waits).join(" "));
})();

/* ---- 3. corruption surfaces ------------------------------------------ */
(function () {
  const a = handLedger(); a.events[3].eaches += 1;
  check("3a. one each off by one -> exactly one conservation violation", RL.views(a).invariants.v_conservation_violations === 1);
  const b = handLedger(); b.events[7].location = "face";
  check("3b. a cross-dock pallet recorded at a storage element -> a cross-dock violation", RL.views(b).invariants.v_cross_dock_violations === 1);
  const c = handLedger(); c.events.splice(1, 1);
  check("3c. a missing version -> a version gap", RL.views(c).invariants.v_version_gaps === 1);
})();

/* ---- 4. shipped wiring ------------------------------------------------ */
(function () {
  const html = read("run-ledger.html"), sw = read("sw.js"), app = read("app.js"), idx = read("index.html"), runall = read("test/run-all.mjs");
  check("4a. the page loads ids.js, pack.js and run-ledger.js and links both stylesheets",
    /<script src="ids\.js">/.test(html) && /<script src="pack\.js">/.test(html) && /<script src="run-ledger\.js">/.test(html) && /run-ledger\.css/.test(html) && /transfer-ledger\.css/.test(html));
  check("4b. sw.js precaches the page, its script, stylesheet and the recorded example at wt-v146 (previously wt-v145)",
    /"\.\/run-ledger\.html"/.test(sw) && /"\.\/run-ledger\.js"/.test(sw) && /"\.\/run-ledger\.css"/.test(sw) && /"\.\/test\/fixtures\/run-ledger\.json"/.test(sw) &&
    /CACHE_VERSION\s*=\s*"wt-v146"/.test(sw) && /Previously wt-v145/.test(sw));
  check("4c. the planner hands a run over to the viewer (button + localStorage hand-over)", /flowLedgerOpen/.test(idx) && /wt-run-ledger/.test(app) && /run-ledger\.html/.test(app));
  check("4d. test/run-all.mjs lists this harness", /verify_run_ledger_view\.js/.test(runall));
  check("4g. the page has the optimisation section", /id="rlOptimise"/.test(html) && /renderOptimise\(exp\)/.test(read("run-ledger.js")));
  check("4e. no external references in the page or its script (offline guard rule)", !/(src|href)\s*=\s*["']https?:/i.test(html) && !/https?:\/\//.test(read("run-ledger.js")));
  check("4f. no Date / Math.random CALL in run-ledger.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(read("run-ledger.js")));
})();

/* ---- 5. v3.39 one report ------------------------------------------------ */
(function () {
  const SQL_NAMES = ["v_cycle_time_by_type", "v_touches_by_type", "v_station_wait", "v_wip_by_tick", "v_quantities_by_op", "v_dispatch", "v_run_summary", "v_flow_links",
    "v_spans", "v_span_cost", "v_cost_by_hu", "v_cost_by_type", "v_cost_by_location", "v_conservation_violations", "v_cross_dock_violations", "v_version_gaps", "v_terminal_violations",
    "v_compare_summary", "v_compare_cycle", "v_compare_touches", "v_compare_wait", "v_compare_dispatch", "v_compare_cost", "v_dispatch_by_order", "v_staffing", "v_replication_groups", "v_replication_cycle_by_type", "v_replication_cost_by_type", "v_replication_summary",
    "v_epcis_events", "v_unit_history", "v_bizstep_dwell", "v_tracking_gaps", "v_otif", "v_inbound", "v_control", "v_quality_by_step"]; // v3.53, v3.55, v3.56, v3.54 - the tool's order
  const G = global.RunLedgerSQL, py = read("tools/run_ledger.py").replace(/\r\n/g, "\n"), js = read("run-ledger.js"), html = read("run-ledger.html"), css = read("run-ledger.css"), sw = read("sw.js"), st = read("run-ledger-selftest.js");
  check("5a. run-ledger-sql.js carries exactly the 33 views in the tool's order (29 + the four tracking views of v3.53)", !!G && JSON.stringify(Object.keys(G)) === JSON.stringify(SQL_NAMES), G ? Object.keys(G).length + " keys" : "missing");
  check("5b. every text starts with SELECT/WITH, ends with ';' and carries no '...' placeholder", SQL_NAMES.every((k) => /^(SELECT|WITH)\b/.test(G[k]) && /;\s*$/.test(G[k]) && G[k].indexOf("...") < 0));
  check("5c. every text is verbatim the body of its CREATE VIEW in tools/run_ledger.py", SQL_NAMES.every((k) => py.indexOf("CREATE VIEW IF NOT EXISTS " + k + " AS\n" + G[k]) >= 0));
  check("5d. RunLedger.SQL IS the generated object and run-ledger.js types no SQL by hand", RL.SQL === G && !/CREATE VIEW|FROM hu h JOIN run r/.test(js));
  check("5e. the page loads run-ledger-sql.js first and errors.js in the head; sw.js precaches both new files",
    /<script src="run-ledger-sql\.js"><\/script><script src="ids\.js">/.test(html) && html.indexOf('<script src="errors.js">') > 0 && html.indexOf('<script src="errors.js">') < html.indexOf("<body") &&
    /"\.\/run-ledger-sql\.js"/.test(sw) && /"\.\/run-ledger-selftest\.js"/.test(sw));
  const e1 = handLedger();
  check("5f. views(exp) and model(exp) are memoised per export object; a fresh object computes afresh", RL.views(e1) === RL.views(e1) && RL.model(e1).views === RL.views(e1) && RL.views(handLedger()) !== RL.views(e1));
  const g = RL.glance(handLedger());
  check("5g. glance on the hand ledger: mix text from an object mix, 40 min, 3 units / 2 retired / 1 in flight, invariants hold, no cost, flags no-rates + in-flight, no station carries a service time",
    g.mix === "case-pick 50% · cross-dock 30% · returns 20%" && g.minutes === 40 && g.units === 3 && g.retired === 2 && g.inFlight === 1 && g.invariantsOk && g.cost === null &&
    g.flags.map((f) => f.kind).join(",") === "no-rates,in-flight" && g.stations === 0, g.flags.map((f) => f.kind).join(","));
  const withSt = handLedger(); withSt.locations.forEach((l) => { if (l.id === "face" || l.id === "stg") l.service_ticks = 50; });
  const g2 = RL.glance(withSt);
  check("5h. glance flags the floor rate when every station carries 50 service ticks (= 1 / flowsim's minStationServicePerTick 0.02)",
    g2.flags.some((f) => f.kind === "floor-rate" && /Every station/.test(f.text)) && g2.atFloor === 2 && g2.stations === 2 && RL.FLOOR_SERVICE_TICKS === 50 && /minStationServicePerTick:\s*0\.02\b/.test(read("flowsim.js")));
  check("5i. mixOf: an array mix, an object mix, none", RL.mixOf({ mix: [{ id: "cross-dock", share: 0.5 }, { id: "returns", share: 0.05 }] }) === "cross-dock 50% · returns 5%" && RL.mixOf({ mix: { "case-pick": 0.25 } }) === "case-pick 25%" && RL.mixOf({}) === "standard spine (no mix)");
  check("5j. csv is RFC 4180 with raw values", RL.csv([{ a: 1, b: 'x,"y"' }, { a: null, b: "z" }], ["a", "b"]) === 'a,b\n1,"x,""y"""\n,z\n' && RL.csv([], ["a"]) === "a\n");
  check("5k. fmtCell: money 2 dp for *_eur (deltas too), 4 dp for eur_per_*, capex as money, hours 2 dp, ticks 2 dp, integers plain, null a dash",
    RL.fmtCell("total_eur", 17.20324) === "€ 17.20" && RL.fmtCell("delta_total_eur", -6.1656) === "€ -6.17" && RL.fmtCell("eur_per_each", 0.0161) === "€ 0.0161" && RL.fmtCell("delta_eur_per_unit", 8.62) === "€ 8.6200" &&
    RL.fmtCell("capex", 8000) === "€ 8000.00" && RL.fmtCell("hours", 0.43333) === "0.43" && RL.fmtCell("avg_wait_ticks", 122.444) === "122.44" && RL.fmtCell("units", 8) === "8" && RL.fmtCell("x", null) === "—");
  const secs = ["secGlance", "secStart", "secPlanner", "secCost", "secDispatch", "secPack", "secTrace", "secCompare", "secInvariants", "secAppendix"];
  check("5l. the page has the ten sections in order, a nav anchor for each, the skip link, the print button and a focusable glance",
    secs.every((s, i) => html.indexOf('id="' + s + '"') > 0 && (i === 0 || html.indexOf('id="' + s + '"') > html.indexOf('id="' + secs[i - 1] + '"'))) && secs.every((s) => html.indexOf('href="#' + s + '"') > 0) &&
    /id="rlNav"/.test(html) && /id="rlPrint"/.test(html) && /class="skip"/.test(html) && /id="rlGlance" tabindex="-1"/.test(html));
  check("5m. run-ledger.js renders glance / planner / dispatch / invariants / appendix as their own functions, emits th scope=col and data-view; renderViews and renderRun are gone",
    /function renderGlance/.test(js) && /function renderPlanner/.test(js) && /function renderDispatch/.test(js) && /function renderInvariants/.test(js) && /function renderAppendix/.test(js) && !/function renderViews/.test(js) && !/function renderRun\b/.test(js) && /<th scope="col">/.test(js) && /data-view=/.test(js));
  check("5n. run-ledger.css has the print block, the auto-fit card grid, the sticky nav and the derived-column style", /@media print/.test(css) && /repeat\(auto-fit,minmax\(220px,1fr\)\)/.test(css) && /#rlNav\{position:sticky/.test(css) && /th\.derived/.test(css));
  check("5o. the viewer self-test is inert without ?selftest=1, reports with the WT-SELFTEST contract and data-page, loads last, no eval / inline handler / external reference",
    /selftest=1/.test(st) && /WT-SELFTEST: PASS/.test(st) && /data-page/.test(st) && !/\beval\(/.test(st) && !/https?:\/\//.test(st) && /<script src="run-ledger\.js"><\/script><script src="run-ledger-selftest\.js"><\/script><\/body>/.test(html) && !/\son[a-z]+=/i.test(html));
  check("5p. Your case binds its listeners once and debounces; the pinwheel search is capped at six block thicknesses", /ycBound/.test(js) && /setTimeout\(\(\) => \{ if \(ycDraw\) ycDraw\(\); \}, 150\)/.test(js) && /Math\.min\(6, Math\.floor\(Math\.min\(L, W\) \/ b\)\)/.test(read("pack.js")));
  check("5q. ?example=a|b|c loads an example; load() announces rl:loaded and whenLoaded() resolves; the derived minutes columns are display-only", /example=\(a\|b\|c\|d\)/.test(js) && /rlDemoC/.test(js) && /rl:loaded/.test(js) && /RunLedger\.whenLoaded/.test(js) && /computed for display, not a column of the view/.test(js));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL RUN-LEDGER VIEWER CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
