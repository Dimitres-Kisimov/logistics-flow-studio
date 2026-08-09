/* =====================================================================
 * verify_fluids.js - FLUIDS STEADY-STATE CONTINUOUS-FLOW harness
 * (v3.19 FLUIDS-FLOW). Proves the deterministic analytical flow model
 * for the Fluids component family (WT.fluids). Checks:
 *
 *   HAND-COMPUTED DEMO (WT.fluids.demoLayout: two 40 m3/h supplies ->
 *     mixer -> 200 m3 tank at 60% -> pipe capped 30 m3/h -> drain):
 *     supply 80, delivered 30, buffered 50, curtailed 0; the pipe is the
 *     BOTTLENECK (saturated, 100%); the tank fills at +50 m3/h and is
 *     FULL in 96 min (80 m3 free / 50 m3/h - pure arithmetic, no time
 *     stepping); the mixer conserves ratio (in 40+40 -> out 80, shares
 *     0.5/0.5); conservation residual 0 at every node.
 *   MIXER RATIO CONSERVATION - asymmetric supplies (60/20) blend to 80
 *     with shares 0.75/0.25 (out == sum of ins exactly).
 *   CAPACITY BOTTLENECK + CURTAILMENT - source 40 -> pipe capped 30 ->
 *     drain (no buffer): delivered 30, curtailed 10, the pipe flagged
 *     as the bottleneck and the overflow-risk warning naming the 10
 *     m3/h backing up at the source.
 *   TANK FILL-TIME ARITHMETIC - source 40 -> terminal tank (200 m3,
 *     60%): buffered 40, FULL in 80/40*60 = 120 min; delivered 0.
 *   EQUAL-SPLIT WATER-FILLING - source 80 -> two parallel pipes (caps
 *     30 / 100) -> two drains: equal split 40/40, the excess 10 over
 *     the 30-cap re-fills the open branch -> 30/50 delivered.
 *   STARVE DETECTION - a mixer declaring 2 inputs fed by 1 live stream
 *     is flagged STARVED with the friendly message; a drain-only
 *     network (no supply) is inactive with a plain-language "no
 *     supply" warning and zero metrics.
 *   COLLAPSE TO BASE CASE - fluid elements that touch nothing produce
 *     NO network and ZERO metrics (the pre-v3.19 static behaviour); a
 *     warehouse layout has no fluid elements at all; EVERY example
 *     scenario stays fluids-inactive AND byte-identical (analyze() is
 *     READ-ONLY - never mutates the layout).
 *   DETERMINISM - byte-identical results across repeated calls; the
 *     demo layout byte-identical per call; NO Date / NO Math.random in
 *     fluids.js source.
 *   HONESTY + WIRING - the steady-state / modelled-not-measured / NOT a
 *     validated process simulation / NOT CFD labels; index.html loads
 *     fluids.js before app.js and ships the #fluidsReadout container in
 *     the EXISTING Factory line card; app.js renders + refreshes it;
 *     sw.js precaches ./fluids.js at the bumped wt-v73 cache; the
 *     runner lists this harness; the self-test carries the live checks.
 *
 * Runs the REAL app modules under the same window shim as the other
 * harnesses. Usage:  node verify_fluids.js   (ASCII-only output)
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js", "fluids.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const F = WT.fluids;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }
function el(id, type, x, y, w, d, extra) {
  return Object.assign({ id: id, type: type, x: x, y: y, w: w, d: d }, extra || {});
}

console.log("Fluids steady-state continuous-flow verification (deterministic)");
console.log("");

/* ---- 1. Module surface -------------------------------------------------- */
check("WT.fluids exposes NOTE/isFluidEl/roleOf/touches/analyze/demoLayout",
  F && typeof F.NOTE === "string" &&
  ["isFluidEl", "roleOf", "touches", "analyze", "demoLayout"].every((k) => typeof F[k] === "function"));
check("the 7 fluid component types are recognised; a rack / conveyor is NOT",
  ["pipe", "fluid-source", "fluid-drain", "tank", "mixer", "portioner", "deportioner"]
    .every((t) => F.isFluidEl({ type: t })) &&
  !F.isFluidEl({ type: "rack-single" }) && !F.isFluidEl({ type: "conveyor" }));

/* ---- 2. The hand-computed demo network ---------------------------------- */
const demo = F.demoLayout();
const R = F.analyze(demo);
check("demo analyzes to ONE active network over all 6 elements",
  R.active === true && R.networks.length === 1 && R.networks[0].active === true &&
  R.networks[0].elementIds.length === 6 && R.fluidCount === 6 && R.unconnected === 0);
const N = R.networks[0];
check("totals: supply 80 -> delivered 30 + buffered 50 + curtailed 0 (m3/h)",
  approx(N.supplyM3h, 80) && approx(N.deliveredM3h, 30) && approx(N.bufferedM3h, 50) && approx(N.curtailedM3h, 0),
  "supply=" + N.supplyM3h + " delivered=" + N.deliveredM3h + " buffered=" + N.bufferedM3h);
check("BOTTLENECK: the 30 m3/h pipe, saturated (utilisation 1)",
  !!N.bottleneck && N.bottleneck.id === "fl-pipe" && approx(N.bottleneck.capM3h, 30) && approx(N.bottleneck.utilisation, 1),
  N.bottleneck ? N.bottleneck.id + " cap=" + N.bottleneck.capM3h : "none");
{
  const t = N.nodes["fl-tank"];
  check("TANK fill arithmetic: in 80, out 30, net +50 m3/h; 80 m3 free -> FULL in 96 min",
    !!t && approx(t.inM3h, 80) && approx(t.outM3h, 30) && approx(t.netFillM3h, 50) &&
    approx(t.freeM3, 80) && approx(t.timeToFullMin, 96),
    t ? "net=" + t.netFillM3h + " free=" + t.freeM3 + " full=" + t.timeToFullMin + "min" : "missing");
  const m = N.nodes["fl-mix"];
  check("MIXER ratio conservation: in 40+40 -> out 80, shares 0.5/0.5, 2/2 live inputs",
    !!m && approx(m.inM3h, 80) && approx(m.outM3h, 80) && m.liveInputs === 2 && m.expectedInputs === 2 &&
    m.mixShares.length === 2 && m.mixShares.every((s) => approx(s.share, 0.5)) &&
    approx(m.mixShares.reduce((s, x) => s + x.m3h, 0), m.inM3h),
    m ? "shares=" + JSON.stringify(m.mixShares.map((s) => s.share)) : "missing");
  check("drain consumes exactly what the bottleneck lets through (30 m3/h)",
    approx(N.nodes["fl-drain"].consumedM3h, 30));
}
check("VERIFIED conservation: residual 0 at every node (checked, not assumed)",
  N.conservation.ok === true && approx(N.conservation.maxAbsResidualM3h, 0),
  "residual=" + N.conservation.maxAbsResidualM3h);
check("the overflow-risk warning names the tank and the 96-min horizon",
  N.warnings.some((w) => /Overflow risk/.test(w) && /Tank/.test(w) && /96 min/.test(w)),
  JSON.stringify(N.warnings));

/* ---- 3. Mixer ratio conservation on asymmetric supplies ----------------- */
{
  const lay = F.demoLayout();
  lay.elements[0].rateM3h = 60; // fl-srcA
  lay.elements[1].rateM3h = 20; // fl-srcB
  const r = F.analyze(lay).networks[0];
  const m = r.nodes["fl-mix"];
  const a = m.mixShares.find((s) => s.from === "fl-srcA");
  const b = m.mixShares.find((s) => s.from === "fl-srcB");
  check("asymmetric blend 60/20: mixer out 80 with shares 0.75/0.25 (out == sum of ins)",
    approx(m.inM3h, 80) && approx(m.outM3h, 80) && a && b && approx(a.share, 0.75) && approx(b.share, 0.25),
    "shares=" + (a && a.share) + "/" + (b && b.share));
}

/* ---- 4. Capacity bottleneck + curtailment (no buffer in the path) ------- */
{
  const lay = { elements: [
    el("c-src", "fluid-source", 0, 0, 2, 2),
    el("c-pipe", "pipe", 2, 0, 6, 1, { flowRateM3h: 30 }),
    el("c-drain", "fluid-drain", 8, 0, 2, 2),
  ] };
  const r = F.analyze(lay).networks[0];
  check("source 40 -> pipe cap 30 -> drain: delivered 30, curtailed 10, pipe = bottleneck",
    approx(r.deliveredM3h, 30) && approx(r.curtailedM3h, 10) && approx(r.bufferedM3h, 0) &&
    !!r.bottleneck && r.bottleneck.id === "c-pipe" && r.conservation.ok,
    "delivered=" + r.deliveredM3h + " curtailed=" + r.curtailedM3h);
  check("the friendly warning names the 10 m3/h backing up at the source",
    r.warnings.some((w) => /Overflow risk/.test(w) && /10 m3\/h backs up at the source/.test(w)),
    JSON.stringify(r.warnings));
}

/* ---- 5. Tank fill-time arithmetic on a terminal tank -------------------- */
{
  const lay = { elements: [
    el("t-src", "fluid-source", 0, 0, 2, 2),
    el("t-tank", "tank", 2, 0, 3, 3),
  ] };
  const r = F.analyze(lay).networks[0];
  const t = r.nodes["t-tank"];
  check("source 40 -> terminal tank: buffered 40, delivered 0, FULL in 80/40*60 = 120 min",
    approx(r.bufferedM3h, 40) && approx(r.deliveredM3h, 0) && approx(t.netFillM3h, 40) &&
    approx(t.timeToFullMin, 120) && r.conservation.ok,
    "net=" + t.netFillM3h + " full=" + t.timeToFullMin + "min");
}

/* ---- 6. Equal-split water-filling at a branch --------------------------- */
{
  const lay = { elements: [
    el("s-src", "fluid-source", 0, 0, 2, 3, { rateM3h: 80 }),
    el("s-pipeA", "pipe", 2, 0, 6, 1, { flowRateM3h: 30 }),
    el("s-pipeB", "pipe", 2, 2, 6, 1, { flowRateM3h: 100 }),
    el("s-drainA", "fluid-drain", 8, 0, 2, 1),
    el("s-drainB", "fluid-drain", 8, 2, 2, 1),
  ] };
  const r = F.analyze(lay).networks[0];
  check("branch: 80 splits equally (40/40), the 10 over the 30-cap re-fills the open branch -> 30/50",
    approx(r.nodes["s-drainA"].consumedM3h, 30) && approx(r.nodes["s-drainB"].consumedM3h, 50) &&
    approx(r.deliveredM3h, 80) && approx(r.curtailedM3h, 0) && r.conservation.ok,
    "A=" + r.nodes["s-drainA"].consumedM3h + " B=" + r.nodes["s-drainB"].consumedM3h);
  check("the saturated 30-cap branch is the named bottleneck",
    !!r.bottleneck && r.bottleneck.id === "s-pipeA");
}

/* ---- 7. Starve detection ------------------------------------------------ */
{
  const lay = { elements: [
    el("m-src", "fluid-source", 0, 0, 2, 2),
    el("m-mix", "mixer", 2, 0, 3, 3),
    el("m-drain", "fluid-drain", 5, 0, 2, 2),
  ] };
  const r = F.analyze(lay).networks[0];
  const m = r.nodes["m-mix"];
  check("a mixer declaring 2 inputs fed by 1 live stream is flagged STARVED",
    m.starved === true && m.expectedInputs === 2 && m.liveInputs === 1 &&
    r.warnings.some((w) => /Starved mixer/.test(w) && /expects 2 input stream/.test(w)),
    JSON.stringify(r.warnings));
}
{
  const lay = { elements: [
    el("n-pipe", "pipe", 0, 0, 4, 1),
    el("n-drain", "fluid-drain", 4, 0, 2, 2),
  ] };
  const r = F.analyze(lay);
  check("a connected network with NO supply is inactive with the friendly 'no supply' note",
    r.active === false && r.networks.length === 1 && r.networks[0].active === false &&
    r.networks[0].warnings.some((w) => /no supply/.test(w)) &&
    approx(r.networks[0].supplyM3h, 0) && approx(r.networks[0].deliveredM3h, 0),
    JSON.stringify(r.networks[0].warnings));
}

/* ---- 8. Collapse to base case ------------------------------------------- */
{
  const lay = { elements: [
    el("u-src", "fluid-source", 0, 0, 2, 2),
    el("u-drain", "fluid-drain", 10, 10, 2, 2), // apart: no junction
  ] };
  const r = F.analyze(lay);
  check("fluid elements that touch NOTHING form no network - zero metrics (static base case)",
    r.active === false && r.networks.length === 0 && r.unconnected === 2 && r.fluidCount === 2);
  const r2 = F.analyze({ elements: [el("w-rack", "rack-single", 0, 0, 4, 1)] });
  check("a warehouse layout has no fluid elements at all (inactive, empty)",
    r2.active === false && r2.networks.length === 0 && r2.fluidCount === 0);
}
{
  // Every shipped example scenario: fluids-INACTIVE (no example carries a
  // connected fluid network today) and BYTE-IDENTICAL through analyze()
  // (read-only - the serialize gains nothing).
  let allInactive = true, allUntouched = true, n = 0;
  for (const ex of WT.examples.library) {
    const built = WT.examples.build(ex.id);
    const before = JSON.stringify(built.elements);
    const r = F.analyze({ elements: built.elements });
    if (r.active) allInactive = false;
    if (JSON.stringify(built.elements) !== before) allUntouched = false;
    n++;
  }
  check("EVERY example scenario (" + n + ") stays fluids-inactive AND byte-identical through analyze()",
    n >= 20 && allInactive && allUntouched, "inactive=" + allInactive + " untouched=" + allUntouched);
}
check("analyze() never mutates the demo layout (read-only)",
  (function () {
    const lay = F.demoLayout();
    const before = JSON.stringify(lay);
    F.analyze(lay);
    return JSON.stringify(lay) === before;
  })());

/* ---- 9. Determinism ----------------------------------------------------- */
check("analyze() is byte-identical across repeated calls (deterministic)",
  JSON.stringify(F.analyze(F.demoLayout())) === JSON.stringify(F.analyze(F.demoLayout())));
check("demoLayout() is byte-identical per call",
  JSON.stringify(F.demoLayout()) === JSON.stringify(F.demoLayout()));
{
  const src = fs.readFileSync(path.join(__dirname, "fluids.js"), "utf8");
  check("fluids.js contains NO Date.now / new Date / Math.random (deterministic by construction)",
    !/Date\.now|new Date|Math\.random/.test(src));
  check("fluids.js references no external hosts and uses no eval (offline + CSP-safe)",
    !/https?:\/\//.test(src) && !/\beval\s*\(|new Function\s*\(/.test(src));
}

/* ---- 10. Honesty labels ------------------------------------------------- */
check("the honesty NOTE: steady-state analytical, modelled not measured, NOT a validated process simulation, NOT CFD, NOT hydraulics",
  /STEADY-STATE ANALYTICAL/i.test(F.NOTE) && /modelled, not measured/i.test(F.NOTE) &&
  /NOT a validated process simulation/i.test(F.NOTE) && /NOT CFD/.test(F.NOTE) && /NOT\s+hydraulics/i.test(F.NOTE));

/* ---- 11. Shipped wiring ------------------------------------------------- */
{
  const idx = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const runall = fs.readFileSync(path.join(__dirname, "test", "run-all.mjs"), "utf8");
  const st = fs.readFileSync(path.join(__dirname, "selftest.js"), "utf8");
  check("index.html loads fluids.js before app.js and ships the #fluidsReadout container in the Factory line card",
    idx.indexOf('<script src="fluids.js"></script>') !== -1 &&
    idx.indexOf('<script src="fluids.js"></script>') < idx.indexOf('<script src="app.js"></script>') &&
    /id="fluidsReadout"/.test(idx));
  check("sw.js precaches ./fluids.js at the bumped wt-v73 cache",
    /["']\.\/fluids\.js["']/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v73"/.test(sw));
  check("app.js renders the read-out (renderFluidsReadout) and refreshes it on every layout mutation",
    /function renderFluidsReadout\(\)/.test(app) && /renderFluidsReadout\(\);/.test(app) &&
    /WT\.fluids\.analyze/.test(app));
  check("test/run-all.mjs lists verify_fluids.js; selftest.js carries the live fluids checks",
    /verify_fluids\.js/.test(runall) && /fluids-steady-state/.test(st) && /fluids-inert/.test(st));
}

console.log("");
if (failures) {
  console.log("FAILURES: " + failures);
  process.exit(1);
}
console.log("ALL CHECKS PASSED (fluids steady-state continuous-flow model)");
