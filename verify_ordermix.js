/* =====================================================================
 * Logistics Flow Studio - verify_ordermix.js
 * v3.29 R4 "THE ORDER MIX" - headless verification
 * ---------------------------------------------------------------------
 * Until now the routing engine (v3.25) was a DARK capability: nothing in the
 * app ever declared an order mix, so every live run still walked the single
 * legacy spine. R4 makes the mix real:
 *   - every warehouse scenario in the library DECLARES a realistic mix of
 *     order types (synthetic teaching shares, labelled as such);
 *   - the scenario carries the stations its mix needs (R2), so the declared
 *     mix is 100% routable on that floor - asserted here for all of them;
 *   - the app passes the mix into the live sim (auto / day / legacy picker),
 *     shows per-type counts and lists what the floor cannot serve.
 *
 * Checks:
 *   1. Every non-mega, non-factory scenario declares a mix: known ids only,
 *      shares summing to 1, at least two order types.
 *   2. For EVERY declaring scenario the built floor carries the stations its
 *      mix needs, the plan has nothing unfulfillable, and the route count is
 *      exactly 1 (legacy) + one per archetype (+1 for the returns split).
 *   3. Every declaring scenario still PASSES or WARNS compliance, never fails.
 *   4. The signature plant declares the full seven-type mix; a 300-tick run is
 *      conserved at every tick and spawns every order type.
 *   5. A cross-dock unit on the cross-dock hub never enters storage.
 *   6. Determinism with a mix; the exported wt-1 layout round-trips the mix;
 *      a scenario without a mix exports no orderMix key (byte-identical).
 *   7. Shipped wiring: the picker in index.html, app.js passing opts.mix and
 *      rendering the readout block, the self-test covering it, sw.js bumped.
 *
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js", "routing.js", "flowsim.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const E = global.WT.examples;
const R = global.WT.routing;
const F = global.WT.flowsim;
const C = global.WT.compliance;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const NEEDS = {
  "full-pallet-out": ["qc", "wrap"], "case-pick": ["qc", "depalletise", "palletise", "wrap"],
  "piece-pick": ["depalletise"], "cross-dock": ["qc", "staging"], "returns": ["returns"],
  "vas": ["vas"], "export-fragile": ["qc", "palletise", "wrap"],
};
const layoutOf = (b) => ({ gridW: b.gridW, gridH: b.gridH, cell: 1, elements: b.elements, config: b.config });

console.log("v3.29 R4 - the order mix: every scenario declares a mix its floor can serve");
console.log("=".repeat(72));

const declaring = E.library.filter((ex) => !(ex.config && (ex.config.mega || ex.config.factory)));
const megaEx = E.library.find((ex) => ex.config && ex.config.mega);

/* ---- 1. Declarations --------------------------------------------- */
(function () {
  const bad = [];
  for (const ex of declaring) {
    const m = ex.config.orderMix;
    if (!m || typeof m !== "object") { bad.push(ex.id + ": no mix"); continue; }
    const ids = Object.keys(m);
    const sum = ids.reduce((s, k) => s + m[k], 0);
    if (ids.length < 2) bad.push(ex.id + ": <2 types");
    if (Math.abs(sum - 1) > 1e-9) bad.push(ex.id + ": shares sum " + sum);
    if (ids.some((k) => !R.ARCHETYPE_BY_ID[k] || k === "legacy-spine")) bad.push(ex.id + ": unknown/legacy id");
  }
  check("1a. all " + declaring.length + " warehouse scenarios declare a mix of >= 2 KNOWN order types whose shares sum to 1", bad.length === 0, bad.join("; ") || declaring.length + " scenarios");
  const kinds = {};
  for (const ex of declaring) for (const k of Object.keys(ex.config.orderMix)) kinds[k] = 1;
  check("1b. across the library every one of the 7 non-legacy archetypes is used by at least one scenario",
    Object.keys(kinds).length === 7, Object.keys(kinds).sort().join(","));
})();

/* ---- 2 + 3. Every declaring scenario is fully routable + compliant */
(function () {
  const unf = [], counts = [], noStation = [], failed = [];
  for (const ex of declaring) {
    const b = E.build(ex.id);
    const lay = layoutOf(b);
    const mix = lay.config.orderMix;
    if (!mix) { unf.push(ex.id + ": built config lost the mix"); continue; }
    const A = F.anchors(lay);
    for (const k of Object.keys(mix)) for (const a of NEEDS[k]) if (!A[a] || !A[a].present) noStation.push(ex.id + ":" + k + " needs " + a);
    const plan = F.spawnPlan(lay, { seed: 1, mix: mix });
    if (!plan.spawnable || plan.unfulfillable.length) unf.push(ex.id + ": " + plan.unfulfillable.map((u) => u.routeId).join("/") + " " + (plan.routingMessages[0] || "").slice(0, 80));
    const expected = 1 + Object.keys(mix).reduce((s, k) => s + (k === "returns" ? 2 : 1), 0);
    if (plan.routes.length !== expected) counts.push(ex.id + ": " + plan.routes.length + " != " + expected);
    const rep = C.check({ version: "wt-1", gridW: b.gridW, gridH: b.gridH, cell: 1, elements: b.elements }, { minAisleMetres: ex.config.minAisle });
    if (rep.findings.some((f) => f.status === "fail" || f.severity === "fail" || f.level === "fail" || f.result === "fail")) failed.push(ex.id);
  }
  check("2a. the built floor of every declaring scenario carries every station its mix needs (R2 adds landed)", noStation.length === 0, noStation.slice(0, 6).join("; ") || "all present");
  check("2b. the declared mix is 100% routable on every scenario - nothing unfulfillable, every route spawnable", unf.length === 0, unf.slice(0, 4).join(" | ") || declaring.length + " scenarios routable");
  check("2c. route count = 1 legacy + one per archetype (+1 for the returns split) on every scenario", counts.length === 0, counts.slice(0, 4).join("; ") || "all exact");
  check("3.  every declaring scenario still passes or honestly warns compliance - never a FAIL - with the stations added", failed.length === 0, failed.join(",") || "no FAIL");
})();

/* ---- 4. The signature plant runs the full mix ----------------------- */
(function () {
  const mix = megaEx && megaEx.config.orderMix;
  check("4a. the signature plant declares the full seven-type mix", !!mix && Object.keys(mix).length === 7, mix ? Object.keys(mix).join(",") : "none");
  const b = E.build(megaEx.id);
  const lay = layoutOf(b);
  const has = (t) => b.elements.some((e) => e.type === t);
  check("4b. the plant carries the three R2 stations", has("qc-bench") && has("depalletiser") && has("vas-station"),
    b.elements.length + " elements");
  const plan = F.spawnPlan(lay, { seed: 5, mix: mix });
  check("4c. nothing in the full mix is unfulfillable on the plant (9 routes, all spawnable)",
    plan.spawnable && plan.unfulfillable.length === 0 && plan.routes.length === 9, "unfulfillable=" + plan.unfulfillable.map((u) => u.routeId).join(","));
  const st = F.state(plan);
  let conserved = true;
  for (let i = 0; i < 300; i++) { F.step(st, 1); if (st.spawned !== st.inflight + st.completed) conserved = false; }
  const pa = st.perArchetype;
  const spawned = Object.keys(pa).filter((k) => pa[k].spawned > 0);
  check("4d. a 300-tick run is conserved at every tick and spawns EVERY order type (both returns outcomes included)",
    conserved && spawned.length === 8, spawned.length + " of 8 spawned, conserved=" + conserved);
})();

/* ---- 5. Cross-dock invariant on the cross-dock hub ------------------ */
(function () {
  const b = E.build("3pl-crossdock-hub");
  const lay = layoutOf(b);
  const st = F.state(F.spawnPlan(lay, { seed: 2, mix: lay.config.orderMix }));
  let bad = false, xd = 0;
  for (let i = 0; i < 300; i++) {
    F.step(st, 1);
    for (const mu of st.mus) if (mu.archetype === "cross-dock") { xd++; if (mu.stage === "storage" || mu.stage === "picking") bad = true; }
  }
  check("5.  on the 3PL cross-dock hub (65% cross-dock) no cross-dock unit ever entered storage or picking", !bad && xd > 0, xd + " cross-dock unit-ticks observed");
})();

/* ---- 6. Determinism + export round-trip ------------------------------ */
(function () {
  const b = E.build("ecommerce-multichannel-fc");
  const lay = layoutOf(b);
  const run = () => { const st = F.state(F.spawnPlan(lay, { seed: 9, mix: lay.config.orderMix })); F.step(st, 200);
    return JSON.stringify({ s: st.spawned, c: st.completed, mus: st.mus.map((m) => [m.id, m.archetype, m.seg, +m.t.toFixed(9), m.stage, m.op]) }); };
  check("6a. the same scenario, seed and mix reproduce byte-identical unit state after 200 ticks", run() === run());
  const exp = E.exportData("ecommerce-multichannel-fc");
  check("6b. the exported wt-1 layout carries the declared mix on its config (so a saved / shared scenario keeps it)",
    JSON.stringify(exp.config.orderMix) === JSON.stringify(b.config.orderMix));
  const fac = E.exportData("assembly-line-factory");
  check("6c. a scenario that declares no mix exports NO orderMix key (byte-identical to before)", !("orderMix" in fac.config));
  const before = JSON.stringify(lay);
  F.spawnPlan(lay, { seed: 9, mix: lay.config.orderMix });
  check("6d. planning never mutates the layout or its mix", JSON.stringify(lay) === before);
})();

/* ---- 7. Shipped wiring ------------------------------------------------ */
(function () {
  const html = read("index.html"), app = read("app.js"), sw = read("sw.js"), self = read("selftest.js");
  check("7a. index.html ships the order-mix picker with the three modes (auto / day / legacy)",
    /id="flowMixSelect"/.test(html) && /value="auto"/.test(html) && /value="day"/.test(html) && /value="legacy"/.test(html));
  check("7b. app.js passes the active mix into the sim and renders the per-type readout block",
    /opts\.mix = mix/.test(app) && /function activeOrderMix/.test(app) && /orderMixHtml\(s\)/.test(app) && /sanitizeOrderMix\(obj\.config\.orderMix\)/.test(app));
  check("7c. the in-browser self-test covers the picker and a declared scenario mix",
    /order-mix-select-and-declared-example-mix/.test(self) && /r2-stations-registered-everywhere/.test(self));
  check("7d. sw.js cache bumped to wt-v112 (trail preserved: previously wt-v111)",
    /CACHE_VERSION\s*=\s*"wt-v112"/.test(sw) && /Previously wt-v111/.test(sw));
  const hint = /Playback follows the <strong>order mix<\/strong> chosen here/.test(html);
  check("7e. the flow card no longer claims playback always follows the default route", hint && !/Playback below still uses the default teaching route/.test(html));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL ORDER-MIX CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
