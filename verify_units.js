/* =====================================================================
 * verify_units.js - v3.70 ONE PLACE WHERE A SPEED IS DECLARED.
 * Run: node verify_units.js
 * ---------------------------------------------------------------------
 * v3.70 adds a registry of every rate and speed in the app and an exact
 * arithmetic for converting between them, and it changes NO behaviour at
 * all. So this harness has two jobs: prove nothing moved, and prove the
 * arithmetic and the registry by hand.
 *
 *   1. NOTHING CHANGED. The hand floor's 300-tick export is byte for byte
 *      fixture A and no model file so much as mentions the registry. This
 *      runs FIRST and before wms.js is loaded, because with the stage
 *      model present the flow sim uses declared capacities instead of the
 *      floor rate - the load order tools/make_run_ledger_fixture.mjs
 *      documents.
 *   2. THE CONVERSIONS BY HAND, including the two that surface the
 *      disagreements: 0.35 cells/tick is 0.35 m/min and 1.2 m/s is
 *      72 m/min, so the app's two travel speeds differ by 205.71x; and
 *      one tick is a minute in the flow model and a quarter hour in the
 *      stage model.
 *   3. THE BAND'S COEFFICIENT OF VARIATION HAS TWO VALUES. 1.3 - 0.7 is
 *      0.6000000000000001, so the endpoint form gives ...776 and the
 *      exact-variance form ...773, and only the second squares back to
 *      exactly 0.03. Both are registered, labelled.
 *   4. ALGEBRAIC EQUALITY IS NOT BIT EQUALITY: re-expressing the arrival
 *      ripple differs for 60 % of the generator's outputs, first at the
 *      very first draw. This is why the literals stay where they are.
 *   5. THE REGISTRY AGREES WITH THE CODE, entry by entry, against the
 *      live modules - the whole point of a declaration with no compiler.
 *   6. THE SOURCE SCAN finds no unexplained rate literal, and the two it
 *      does report are pinned with the reason each is not an entry.
 *   7. HONESTY AND WIRING.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
const load = (f) => (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
// The ledger chain ONLY - the stage model is loaded after section 1 on purpose.
for (const f of ["domain.js", "iso.js", "shapes.js", "units.js", "routing.js", "ids.js", "pack.js", "people.js",
  "flowsim.js", "goods.js", "analytics.js", "ledger.js"]) load(f);
const U = global.WT.units, F = global.WT.flowsim, L = global.WT.ledger, P = global.WT.pack, A = global.WT.analytics, D = global.WT.domain;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const q = (v, u) => U.quantity(v, u);

/* ---- 1. nothing changed ------------------------------------------------------------------ */
(function () {
  const FLOOR = {
    gridW: 40, gridH: 24, cell: 1,
    elements: [
      { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 }, { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
      { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 }, { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
      { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 }, { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
      { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 }, { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
      { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 }, { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
      { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 }, { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
    ],
  };
  const MIX = global.WT.routing.defaultMix();
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: MIX });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: MIX, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  const exp = L.exportJson(rec);
  check("1a. declaring a rate changes no run: the 300-tick export is byte for byte fixture A and the hand floor still records its own id",
    JSON.stringify(exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) &&
    exp.run.id === "RUN-hand-built-s31-hc28a7688");
  check("1b. and nothing reads the registry yet - no model file mentions WT.units, which is what makes this release's byte risk exactly zero",
    !/WT\.units/.test(read("flowsim.js")) && !/WT\.units/.test(read("wms.js")) && !/WT\.units/.test(read("ledger.js")) &&
    !/WT\.units/.test(read("process.js")) && !/WT\.units/.test(read("simulation.js")));
})();

// Now the rest of the app, for the registry comparison.
for (const f of ["simulation.js", "compliance.js", "library.js", "process.js", "wms.js"]) load(f);

/* ---- 2. the conversions by hand --------------------------------------------------------- */
(function () {
  check("2a. the rate conversions are the expressions they stand for, in the same order: 65.8 units/hr at 60 ticks/hr is 1.0966666666666667 units/tick, and 0.02 units/tick is 50 ticks per unit",
    Object.is(U.perTick(65.8, 60), 1.0966666666666667) && Object.is(U.perTick(65.8, 60), 65.8 / 60) &&
    U.ticksPerUnit(0.02) === 50 && U.perHour(0.02, 60) === 1.2 && U.perHour(U.perTick(65.8, 60), 60) === 65.8 &&
    U.secondsPerUnit(45) === 80 && U.unitsPerHrFromSeconds(80) === 45 && U.unitsPerHrFromSeconds(30) === 120,
    "measured, not assumed: the round trip through a rate is EXACT for the values in play here - 65.8 to units per tick and back is 65.8, and 0.02 back to units per hour is 1.2. A first draft of this check asserted it was inexact; it is not, and the pin says what was measured");
  check("2b. one tick is a minute in the flow model and a quarter of an hour in the stage model, and the registry carries both so the two cannot be silently confused",
    U.minutesPerTick(60) === 1 && U.minutesPerTick(4) === 15 &&
    U.get("flowsim.ticksPerHour").value === 60 && U.get("wms.ticksPerHour").value === 4 &&
    /flowsim\.js declares 60 for the same word/.test(U.get("wms.ticksPerHour").note));
  check("2c. takt is the shift over the demand, and the shipped defaults give exactly 60 seconds",
    U.takt(28800, 480) === 60 && U.takt(28800, 0) === 28800 && U.takt(28800, 1) === 28800,
    "a demand of zero is floored at one rather than dividing by zero");
  check("2d. THE 206x FINDING, by conversion: the animation moves a unit at 0.35 cells/tick = 0.35 m/min = 0.005833333333333333 m/s, while the pick-travel model walks at 1.2 m/s = 72 m/min. 72 / 0.35 is 205.71428571428572",
    U.to(q(0.35, "cells/tick"), "m/min") === 0.35 && U.to(q(0.35, "cells/tick"), "m/s") === 0.005833333333333333 &&
    U.to(q(1.2, "m/s"), "m/min") === 72 && U.to(q(1.2, "m/s"), "m/min") / U.to(q(0.35, "cells/tick"), "m/min") === 205.71428571428572 &&
    U.to(q(72, "m/min"), "m/s") === 1.2);
  check("2e. every conversion round-trips within its own dimension, and one across dimensions is REFUSED by name rather than silently scaled",
    U.to(q(U.to(q(1.2, "m/s"), "m/min"), "m/min"), "m/s") === 1.2 &&
    U.to(q(U.to(q(50, "ticks"), "s"), "s"), "ticks") === 50 &&
    U.to(q(80, "s/unit"), "ticks/unit") === 1.3333333333333333 && U.to(q(50, "ticks"), "s") === 3000 &&
    (function () { try { U.to(q(65.8, "units/hr"), "m/s"); return false; } catch (e) { return /refusing to convert units\/hr \(rate\) to m\/s \(speed\)/.test(e.message); } })());
  check("2f. a quantity refuses an unknown unit and a value that is not a finite number, so a rate cannot enter the system unlabelled",
    (function () { try { q(1, "furlongs/fortnight"); return false; } catch (e) { return /unknown unit/.test(e.message); } })() &&
    (function () { try { q(NaN, "m/s"); return false; } catch (e) { return /finite number/.test(e.message); } })() &&
    q(1.2, "m/s").dimension === "speed" && Object.isFrozen(q(1.2, "m/s")));
})();

/* ---- 3. the band's coefficient of variation, both of it ---------------------------------- */
(function () {
  const ep = U.get("flowsim.arrivalCv.fromEndpoints").value;
  const ex = U.get("flowsim.arrivalCv.fromVariance").value;
  check("3a. 1.3 - 0.7 is 0.6000000000000001 in IEEE-754, not 0.6 - which is why the band's coefficient of variation has two values",
    (1.3 - 0.7) === 0.6000000000000001 && (1.3 - 0.7) !== 0.6 && ((1.3 + 0.7) / 2) === 1);
  check("3b. the endpoint form gives 0.17320508075688776 and its square is 0.03000000000000001, NOT 0.03",
    ep === 0.17320508075688776 && Object.is(ep, U.cvOfUniform(0.7, 1.3)) && ep * ep === 0.03000000000000001 && ep * ep !== 0.03,
    "the honest general definition, and it does not round-trip");
  check("3c. the exact-variance form gives 0.17320508075688773, squares back to exactly 0.03, and satisfies sqrt(3) x cv === 0.3 exactly - the endpoint form does neither",
    ex === 0.17320508075688773 && Object.is(ex, Math.sqrt(0.03)) && ex * ex === 0.03 && Math.sqrt(3) * ex === 0.3 &&
    ep * ep !== 0.03 && Math.sqrt(3) * ep !== 0.3 && ex !== ep,
    "they differ in the last representable digit, and which one a caller uses decides whether its arithmetic round-trips");
  check("3d. both are registered with the note that says which is which, so the choice is a decision on the record rather than an accident",
    /0\.6000000000000001/.test(U.get("flowsim.arrivalCv.fromEndpoints").note) &&
    /squares back to exactly 0\.03/.test(U.get("flowsim.arrivalCv.fromVariance").note) &&
    U.varOfUniform(0.7, 1.3) === 0.03000000000000001);
})();

/* ---- 4. algebraic equality is not bit equality ------------------------------------------- */
(function () {
  const N = 1 << 20;
  let diff = 0, first = null;
  for (let k = 0; k < N; k++) {
    const u = k / 4294967296;
    if (!Object.is(0.7 + 0.6 * u, 1 + (2 * u - 1) * 0.3)) { diff++; if (first === null) first = k; }
  }
  check("4a. re-expressing the arrival ripple is equal by algebra and unequal in floating point for 60 % of the generator's outputs, first at the very FIRST draw",
    first === 1 && diff === 629145 &&
    !Object.is(0.7 + 0.6 * (1 / 4294967296), 1 + (2 * (1 / 4294967296) - 1) * 0.3),
    diff.toLocaleString("en") + " of " + N.toLocaleString("en") + " grid values differ (" + (100 * diff / N).toFixed(1) + " %); at k = 1 the literal gives 0.7000000001396983 and the general form 0.7000000001396984");
  check("4b. the module names this as the reason the literals stay where they are, and names the one site whose conversion can never be adopted",
    U.NOT_ADOPTED.length === 2 && U.NOT_ADOPTED.some((n) => /arrival ripple/.test(n.site) && /different run with a different id/.test(n.reason)) &&
    U.NOT_ADOPTED.some((n) => /capTick/.test(n.site) && /cap x \(1\/tph\) is not cap \/ tph/.test(n.reason)));
  check("4c. and the reason is real in the general case: a quarter is exact in binary so 45 x (1/4) does equal 45/4, but 28 x (1/3) does not equal 28/3",
    Object.is(45 * (1 / 4), 45 / 4) && !Object.is(28 * (1 / 3), 28 / 3),
    "which is why adoption is proven per site on real values instead of argued from algebra");
})();

/* ---- 5. the registry agrees with the live code ------------------------------------------- */
(function () {
  const PA = F.PARAMS, WP = global.WT.wms.PARAMS, SP = global.WT.sim.PARAMS, E = D.ELEMENTS;
  const live = {
    "flowsim.ticksPerHour": PA.ticksPerHour, "flowsim.cellsPerTick": PA.cellsPerTick,
    "flowsim.minStationServicePerTick": PA.minStationServicePerTick, "flowsim.minLineThroughput": PA.minLineThroughput,
    "flowsim.shipDwellTicks": PA.shipDwellTicks, "flowsim.autoBoostPerLane": PA.autoBoostPerLane,
    "flowsim.autoFactorMax": PA.autoFactorMax, "flowsim.spawnNoiseLo": PA.spawnNoiseLo,
    "flowsim.spawnNoiseHi": PA.spawnNoiseHi, "flowsim.congestQueueThreshold": PA.congestQueueThreshold,
    "domain.metresPerCell": D.METRES_PER_CELL,
    "wms.ticksPerHour": WP.ticksPerHour, "wms.receiveUnitsPerDockHr": WP.receiveUnitsPerDockHr,
    "wms.shipUnitsPerDockHr": WP.shipUnitsPerDockHr, "wms.putawayTeamUnitsHr": WP.putawayTeamUnitsHr,
    "wms.replenTeamUnitsHr": WP.replenTeamUnitsHr, "wms.packUnitsPerStationHr": WP.packUnitsPerStationHr,
    "wms.storageBaseUnitsHr": WP.storageBaseUnitsHr, "wms.storageRatePerPosition": WP.storageRatePerPosition,
    "wms.autoRefUnitsPerHr": WP.autoRefUnitsPerHr, "wms.stageHandleMin": WP.stageHandleMin,
    "simulation.pickerSpeedMps": SP.pickerSpeedMps, "simulation.handlingSecPerLine": SP.handlingSecPerLine,
    "domain.conveyor.unitsPerHr": E.conveyor.unitsPerHr, "domain.rgv.movesPerHr": E.rgv.movesPerHr,
    "domain.agv.movesPerHr": E.agv.movesPerHr, "domain.asrs.cycleSec": E.asrs.cycleSec,
    "domain.shuttle.cycleSec": E.shuttle.cycleSec, "domain.mfgSource.emitRatePerHr": E["mfg-source"].emitRatePerHr,
  };
  const bad = Object.keys(live).filter((id) => !U.agrees(id, live[id]));
  check("5a. every registry entry that names a live literal still equals it - the whole guarantee a declaration without a compiler can offer, and it is asserted here rather than assumed",
    bad.length === 0 && Object.keys(live).length === 29,
    bad.length ? "DRIFTED: " + bad.map((id) => id + " registry " + U.get(id).value + " vs live " + live[id]).join(", ") : Object.keys(live).length + " entries compared against the running modules");
  const src = read("process.js") + read("library.js");
  check("5b. the entries whose module exports no parameter block are pinned against its source instead, and the harness says which kind of check each one got",
    /DEFAULT_SHIFT_SEC = 28800/.test(src) && /DEFAULT_DEMAND = 480/.test(src) && /DEFAULT_SOURCE_RATE = 120/.test(src) &&
    /DEFAULT_STATION_CYCLE = 30/.test(src) && U.get("process.shiftSec").value === 28800 && U.get("process.demandPerShift").value === 480 &&
    U.get("process.sourceRatePerHr").value === 120 && U.get("process.stationCycleSec").value === 30 &&
    U.get("library.station.cycleSec").value === 30 && U.get("library.transporter.speedMps").value === 1.2);
  check("5c. every entry carries a unit this module knows, one of the three source kinds, an owner and a source sentence - nothing is unlabelled",
    U.ids().length === 38 && U.ids().every((id) => { const e = U.get(id); return !!U.UNITS[e.unit] && U.SOURCE_KINDS.indexOf(e.kind) >= 0 && !!e.owner && !!e.source && e.source.length > 10; }) &&
    U.SOURCE_KINDS.join(",") === "cited,teaching,measured",
    U.ids().length + " entries across " + U.owners().length + " owners");
  check("5d. a duplicate id and an entry with an unknown unit, a bad kind or no source are all refused, so the registry cannot be corrupted by a careless addition",
    (function () { try { U.register({ id: "flowsim.cellsPerTick", value: 1, unit: "m/s", kind: "teaching", owner: "x", source: "y" }); return false; } catch (e) { return /duplicate/.test(e.message); } })() &&
    (function () { try { U.register({ id: "new.a", value: 1, unit: "parsecs", kind: "teaching", owner: "x", source: "y" }); return false; } catch (e) { return /unknown unit/.test(e.message); } })() &&
    (function () { try { U.register({ id: "new.b", value: 1, unit: "m/s", kind: "guessed", owner: "x", source: "y" }); return false; } catch (e) { return /needs a kind of/.test(e.message); } })() &&
    (function () { try { U.register({ id: "new.c", value: 1, unit: "m/s", kind: "teaching" }); return false; } catch (e) { return /owner and a source/.test(e.message); } })());
})();

/* ---- 6. the source scan --------------------------------------------------------------------- */
(function () {
  const files = ["flowsim.js", "wms.js", "process.js", "simulation.js", "library.js", "domain.js", "analytics.js"];
  const known = {};
  for (const e of U.SCAN_EXPLAINED) known[e.name] = 1;
  const unexplained = [];
  for (const f of files) for (const u of U.unregistered(read(f), f)) if (!known[u.name]) unexplained.push(f + ":" + u.name + "=" + u.value);
  check("6a. the source scan finds no unexplained rate literal in the model files, so a rate added later without a registry entry trips this harness",
    unexplained.length === 0, unexplained.length ? "UNREGISTERED: " + unexplained.join(", ") : files.length + " files scanned clean");
  check("6b. the two literals the scan does report are pinned with the reason neither is an entry - an accumulator initialised to zero, and a cost in euros rather than a speed",
    U.SCAN_EXPLAINED.length === 2 &&
    U.SCAN_EXPLAINED.some((e) => e.name === "throughputOrdersPerHour" && /not a declared rate/.test(e.reason) && /the scan reads names/i.test(e.reason)) &&
    U.SCAN_EXPLAINED.some((e) => e.name === "labourPerHour" && /cost in euros/.test(e.reason) && /outside this registry/.test(e.reason)));
  check("6c. the scan found a real omission on its first run and the entry says so: the manufacturing source's emit rate was missed by hand",
    U.get("domain.mfgSource.emitRatePerHr") !== null && /found by the source scan/i.test(U.get("domain.mfgSource.emitRatePerHr").note) &&
    U.agrees("domain.mfgSource.emitRatePerHr", D.ELEMENTS["mfg-source"].emitRatePerHr));
})();

/* ---- 7. honesty and wiring -------------------------------------------------------------------- */
(function () {
  const src = read("units.js"), html = read("index.html"), sw = read("sw.js");
  check("7a. the module reads no clock, draws no random number, touches no roster, and its honesty names the two laws and the limit of a declaration without a compiler",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/WT\.workers|\broster\b|workerRoster/i.test(src) &&
    /never to a person/.test(U.HONESTY) && /BetrVG 87\(1\)6/.test(U.HONESTY) && /GDPR Art\. 88/.test(U.HONESTY) &&
    /ASSERTED BY A HARNESS, not enforced by a compiler/.test(U.HONESTY) && /may not be read as an/.test(U.HONESTY));
  check("7b. the six findings this registry exists to surface are carried as data, each naming the entries it is about, so the page and this harness read the same words",
    U.FINDINGS.length === 6 && U.FINDINGS.every((f) => f.id && f.what && f.detail && Array.isArray(f.ids) && f.ids.length > 0 && f.ids.every((id) => U.get(id) !== null)) &&
    U.FINDINGS.some((f) => f.id === "travel-speed-disagreement" && /205\.7/.test(f.detail)) &&
    U.FINDINGS.some((f) => f.id === "tick-disagreement") && U.FINDINGS.some((f) => f.id === "no-conveyor-speed") &&
    U.FINDINGS.some((f) => f.id === "declared-speed-never-read") && U.FINDINGS.some((f) => f.id === "cv-two-values") &&
    U.FINDINGS.some((f) => f.id === "service-has-no-variability"));
  check("7c. the module states plainly that it changes nothing in this release, and that adoption at the call sites is a later separately gated step",
    /changes NO behaviour and replaces NO call site/.test(src) && /separately gated step, one site at a time/.test(src));
  const doc = read(path.join("docs", "UNITS_AND_RATES.md"));
  check("7d. docs/UNITS_AND_RATES.md is generated from the registry and carries every finding, the full table and the not-adopted list",
    /Generated by/.test(doc) && U.FINDINGS.every((f) => doc.indexOf(f.what) >= 0) && /205\.71/.test(doc) &&
    /0\.17320508075688776/.test(doc) && /0\.17320508075688773/.test(doc) && /not adopted/i.test(doc) &&
    U.ids().every((id) => doc.indexOf(id) >= 0));
  check("7e. shipped: units.js loads before the models that own its numbers, the service worker precaches it at wt-v148 (previously wt-v147), the runner lists this harness, README and CHANGELOG carry v3.70",
    html.indexOf('<script src="units.js"></script>') >= 0 &&
    html.indexOf('<script src="units.js"></script>') < html.indexOf('<script src="flowsim.js"></script>') &&
    /"\.\/units\.js"/.test(sw) && /wt-v148/.test(sw) && /Previously wt-v147/.test(sw) &&
    /verify_units\.js/.test(read(path.join("test", "run-all.mjs"))) &&
    /v3\.70/.test(read("README.md")) && /## v3\.70/.test(read("CHANGELOG.md")));
})();

console.log("=".repeat(72));
if (fail) { console.log("FAILED " + fail + " of " + (pass + fail)); process.exit(1); }
console.log("ALL UNITS-AND-RATES CHECKS PASSED (" + pass + ")");
