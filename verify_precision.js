/* =====================================================================
 * Logistics Flow Studio - verify_precision.js
 * v3.43 A REALISTIC RECORDING, AT FULL PRECISION - headless verification
 * ---------------------------------------------------------------------
 * Two limits fell in v3.43. (1) The recorded fixtures served at the
 * simulator's floor rate because the fixture script never loaded wms.js;
 * fixture C is the library floor ecommerce-multichannel-fc recorded WITH
 * wms.js, so its eight stations carry the floor's declared capacities.
 * (2) Precision: ledger.js recorded service_ticks rounded to 4 dp and
 * minutes to 3 dp and summed money naively; it now records both unrounded
 * and sums with compensated (Neumaier) arithmetic, and tools/run_ledger.py
 * reconcile measures SQLite against the JavaScript rows column by column.
 * This harness proves:
 *   1. Neumaier hand values; the cost totals are the compensated sums of
 *      the spans; 1 / 0.02 is exactly 50, so the floor rate still records 50.
 *   2. Fixtures A and B rebuilt in memory equal the committed files byte
 *      for byte (the precision change moved nothing); every minute is an
 *      integer; every station carries exactly 50.
 *   3. Fixture C rebuilt (the scenario modules are loaded only AFTER 2,
 *      because wms.js changes how the hand floor serves) equals its three
 *      committed files; its id, its eight stations at unrounded 1 / rate,
 *      the stage sums equal to the wms capacities (the verify_flowB.js
 *      invariant restated), the glance flags exactly no-holding,in-flight,
 *      transport class amr.
 *   4. Shipped wiring: example C on the page and in ?example=, the usage
 *      string, sw.js precaching C at wt-v147, the reconcile command and
 *      its 13 views, CI importing and reconciling C, the runner.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
const load = (files) => { for (const f of files) (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8")); };
load(["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js"]);
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, A = global.WT.analytics, P = global.WT.pack, RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

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

function record(layout, seed, ticks, mix, scenarioId, profile) {
  const plan = F.spawnPlan(layout, { seed: seed, mix: mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: scenarioId, seed: seed, mix: mix, layout: layout, profile: profile, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, ticks);
  const exp = L.exportJson(rec);
  const cost = L.costs(exp);
  return { plan: plan, rec: rec, exp: exp,
    files: {
      json: JSON.stringify(exp, null, 1) + "\n",
      stats: JSON.stringify(L.stats(rec), null, 1) + "\n",
      views: JSON.stringify({ costByType: cost.byType, costByLocation: cost.byLocation, costTotal: cost.total, flowLinks: L.flowLinks(exp) }, null, 1) + "\n",
    } };
}
const fixture = (base) => ({ json: lf(read(path.join("test", "fixtures", base + ".json"))), stats: lf(read(path.join("test", "fixtures", base + ".stats.json"))), views: lf(read(path.join("test", "fixtures", base + ".views.json"))) });
const sameFiles = (got, want) => got.json === want.json && got.stats === want.stats && got.views === want.views;

/* ---- 1. compensated sums ------------------------------------------------ */
(function () {
  check("1a. nsum([1, 1e100, 1, -1e100]) is exactly 2 (a naive sum gives 0)", L.nsum([1, 1e100, 1, -1e100]) === 2 && [1, 1e100, 1, -1e100].reduce((a, b) => a + b, 0) === 0);
  check("1b. nsum([0.1, 0.2, 0.3]) is exactly 0.6 (a naive sum gives 0.6000000000000001)", L.nsum([0.1, 0.2, 0.3]) === 0.6 && 0.1 + 0.2 + 0.3 !== 0.6);
  check("1c. 1 / 0.02 is exactly 50 in this engine, so an unrounded floor rate still records 50", 1 / 0.02 === 50 && F.PARAMS.minStationServicePerTick === 0.02);
  const a = record(FLOOR, 31, 300, R.defaultMix(), "hand-built", P.PROFILES.ecommerce);
  const c = L.costs(a.exp);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  check("1d. every cost total is the rounded compensated sum of its spans",
    c.total.labour_eur === r4(L.nsum(c.spans.map((s) => s.labour_eur))) && c.total.equipment_eur === r4(L.nsum(c.spans.map((s) => s.equipment_eur))) &&
    c.total.energy_eur === r4(L.nsum(c.spans.map((s) => s.energy_eur))) && c.total.holding_eur === r4(L.nsum(c.spans.map((s) => s.holding_eur))),
    c.total.total_eur + " EUR");
  global.__A = a;
})();

/* ---- 2. A and B byte-identical, floor rate exactly 50 ----------------- */
(function () {
  const a = global.__A, b = record(FLOOR, 31, 300, MIX_B, "hand-built", P.PROFILES.ecommerce);
  check("2a. fixture A rebuilt equals the committed export, stats and views byte for byte", sameFiles(a.files, fixture("run-ledger")), a.exp.run.id);
  check("2b. fixture B rebuilt equals its committed files byte for byte", sameFiles(b.files, fixture("run-ledger-b")), b.exp.run.id);
  const st = a.exp.locations.filter((l) => l.service_ticks != null);
  check("2c. A's three stations carry exactly 50 ticks per unit and minutes_per_tick is exactly 1", st.length === 3 && st.every((l) => l.service_ticks === 50) && a.exp.run.minutes_per_tick === 1);
  check("2d. every recorded minute of A and B is an integer (unrounded at 60 ticks per hour)", a.exp.events.concat(b.exp.events).every((e) => Number.isInteger(e.minute) && e.minute === e.tick));
  check("2e. wms.js is not loaded yet: the hand floor recorded at the floor rate", !global.WT.wms);
})();

/* ---- 3. fixture C: the library floor at declared capacities ------------ */
load(["compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js"]);
(function () {
  const E = global.WT.examples, W = global.WT.wms;
  const id = "ecommerce-multichannel-fc";
  const bld = E.build(id);
  const lay = { gridW: bld.gridW, gridH: bld.gridH, cell: 1, elements: bld.elements, config: bld.config };
  const c = record(lay, 6, 180, lay.config.orderMix, id, P.profileFor(id));
  check("3a. fixture C rebuilt (seed 6, 180 ticks, the scenario's declared mix) equals its committed files byte for byte", sameFiles(c.files, fixture("run-ledger-c")), c.exp.run.id);
  check("3b. its id names the scenario and the seed; its mix is the scenario's object; the profile is the e-commerce one",
    /^RUN-ecommerce-multichannel-fc-s6-h[0-9a-f]{8}$/.test(c.exp.run.id) && !Array.isArray(c.exp.run.mix) && c.exp.run.mix["piece-pick"] === 0.6 && c.exp.run.profile === "ecommerce");
  const st = c.exp.locations.filter((l) => l.service_ticks != null);
  const byId = {}; for (const s of c.plan.stations) byId[String(s.elementId)] = s;
  check("3c. eight stations, none at the floor rate, each carrying exactly 1 / its planned service rate, unrounded",
    st.length === 8 && st.every((l) => l.service_ticks !== 50 && byId[l.id] && l.service_ticks === 1 / byId[l.id].serviceRatePerTick && l.service_ticks !== Math.round(l.service_ticks * 1e4) / 1e4),
    st.map((l) => l.type + " " + l.service_ticks.toFixed(4)).join(", "));
  const capOf = {}; for (const cap of W.capacities(lay, { seed: 6 })) capOf[cap.id] = Number(cap.capacityUnitsPerHr) || 0; // an array of stages
  const caps = { "put-away": capOf["put-away"], "order-picking": capOf["order-picking"], packing: capOf.packing };
  const sum = {}; for (const s of c.plan.stations) sum[s.kind] = (sum[s.kind] || 0) + s.serviceRatePerTick * F.PARAMS.ticksPerHour;
  check("3d. the stage sums of the station rates equal the wms capacities (put-away, order-picking, packing)",
    near(sum.put, caps["put-away"]) && near(sum.pick, caps["order-picking"]) && near(sum.pack, caps.packing),
    JSON.stringify({ put: +sum.put.toFixed(4), pick: +sum.pick.toFixed(4), pack: +sum.pack.toFixed(4) }));
  const g = RL.glance(c.exp);
  check("3e. the glance flags are exactly no-holding,in-flight (no floor-rate flag), stations 8 / atFloor 0",
    g.flags.map((f) => f.kind).join(",") === "no-holding,in-flight" && g.stations === 8 && g.atFloor === 0, g.flags.map((f) => f.kind).join(","));
  check("3f. transport on the AGV floor is the amr class; the invariants hold; 193 units / 1175 events / 35 delivered",
    c.exp.rates.transport.class === "amr" && Object.keys(RL.views(c.exp).invariants).every((k) => RL.views(c.exp).invariants[k] === 0) &&
    c.exp.hus.length === 193 && c.exp.events.length === 1175 && g.delivered === 35, c.exp.hus.length + " / " + c.exp.events.length + " / " + g.delivered);
  check("3g. the compare of C against A says different scenario", RL.compare(c.exp, global.__A.exp).same_scenario === false);
})();

/* ---- 4. shipped wiring -------------------------------------------------- */
(function () {
  const html = read("run-ledger.html"), js = read("run-ledger.js"), sw = read("sw.js"), mk = read(path.join("tools", "make_run_ledger_fixture.mjs")), env = read(path.join("tools", "ledger_env.mjs"));
  const py = read(path.join("tools", "run_ledger.py")), ci = read(path.join(".github", "workflows", "ci.yml")), runall = read(path.join("test", "run-all.mjs")), st = read("run-ledger-selftest.js"), lg = read("ledger.js");
  check("4a. the page offers example C and ?example=a|b|c(|d) loads it", /id="rlDemoC"/.test(html) && /run-ledger-c\.json/.test(js) && /example=\(a\|b\|c\|d\)/.test(js) && /rlDemoC/.test(js));
  check("4b. the fixture script documents [a|b|c|all] and the reconcile sub-command, and builds a and b before loading wms.js",
    /\[a\|b\|c\|d\|all\]/.test(mk) && /reconcile <dir>/.test(mk) && /build a and b before c/.test(mk) && /MODULES_SCENARIO/.test(env) && /wms\.js/.test(env));
  check("4c. sw.js precaches fixture C at wt-v147 (previously wt-v146)", /"\.\/test\/fixtures\/run-ledger-c\.json"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v147"/.test(sw) && /Previously wt-v146/.test(sw));
  check("4d. tools/run_ledger.py has the reconcile command over 20 views with the two tolerances (v_bizstep_dwell since v3.53, v_quality_by_step since v3.54, v_otif + v_inbound since v3.55, v_control since v3.56)", /def reconcile\(/.test(py) && /"reconcile"/.test(py) && (py.match(/"v_[a-z_]+": \(/g) || []).length === 20 && /--tolerance-raw/.test(py));
  check("4e. CI imports fixture C and reconciles every fixture", /run-ledger-c\.json/.test(ci) && /make_run_ledger_fixture\.mjs reconcile/.test(ci) && /run_ledger\.py reconcile/.test(ci));
  check("4f. ledger.js records 1 / rate and the minute unrounded and exports nsum", /= 1 \/ s\.serviceRatePerTick;/.test(lg) && /minute: state\.tick \* rec\.run\.minutes_per_tick,/.test(lg) && typeof L.nsum === "function" && !/Math\.round\(\(1 \/ s\.serviceRatePerTick\)/.test(lg));
  check("4g. the viewer self-test drives example C after the compare", /clickAndWait\("rlDemoC", "a"\)/.test(st) && /example-c-declared-capacities-no-floor-flag/.test(st));
  check("4h. test/run-all.mjs lists this harness", /verify_precision\.js/.test(runall));
})();

console.log("");
console.log(fail === 0 ? "ALL PRECISION CHECKS PASSED (" + pass + ")" : fail + " PRECISION CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
