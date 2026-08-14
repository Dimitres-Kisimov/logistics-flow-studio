/* =====================================================================
 * verify_craftflow.js - CRAFT-ON-RESOLVED-FLOWS + FLUID-OVERRIDE
 * PERSISTENCE harness (v3.20 CRAFT-FLOW + FLUIDS-PERSIST). Closes the two
 * documented v3.17-v3.19 follow-up gaps, with hand-computed expectations:
 *
 *   (a) CRAFT PLACEMENT ON THE RESOLVED FLOW NETWORK. Until v3.19 the
 *       CRAFT optimizer's from-to FLOW matrix F always read the STORED
 *       process.routing rates - on a multi-way network those go stale the
 *       moment a ratio or the offered rate is edited, skewing the
 *       placement objective MHI = SUM F*D. From v3.20 buildFD() reads the
 *       RESOLVED arc flows (WT.process.resolveFlow - the SAME numbers
 *       metrics() reports) whenever the block declares a VALID multi-way
 *       network, and keeps the stored rates otherwise. Asserted:
 *         - COLLAPSE TO BASE CASE: on a plain chain the ENTIRE craft
 *           report is BYTE-IDENTICAL to the pre-v3.20 optimizer (a full
 *           hand-written expected object in the exact v3.19 shape - no
 *           flowBasis key, same values: MHI 3400 -> 2200, one B<->C swap,
 *           deltaPct 35.2941, passes 2, evaluated 6)
 *         - on the machining-qa-split archetype F carries the resolved
 *           60/40 split flows (72/48 parts/hr at the offered 120/hr) and
 *           flowBasis is "resolved"
 *         - STALE STORED RATES CANNOT SKEW THE PLACEMENT: tampering every
 *           non-source arc's stored unitsPerHr to 1 leaves F AND the whole
 *           craft report byte-identical (the resolved flows win); the
 *           stored-rate F would have been all-1s (asserted differing)
 *         - F CANNOT DIVERGE from the flow model: every F entry equals
 *           the corresponding resolveFlow arc flow, and mhiBefore equals
 *           an INDEPENDENT recomputation of SUM F*D from the resolved
 *           arcs + element centroids
 *         - never-illegal / never-worse still holds on the resolved
 *           basis: the proposal passes an independent legality oracle
 *           (in-bounds, overlap-free, aisle count not increased), MHI is
 *           monotone non-increasing, optimize() is deterministic and its
 *           balance never reports a worse line
 *         - an INVALID declared network (ratios summing to 1.1) falls
 *           back to the STORED rates (flowBasis "stored", no flowBasis
 *           key in the craft report - never a guessed resolution)
 *         - the 3 legacy factory profiles all stay on the stored basis
 *
 *   (b) PER-ELEMENT FLUID RATE OVERRIDES PERSIST. The v3.19 steady-state
 *       fluids solver honoured per-element overrides of rateM3h /
 *       flowRateM3h / capacityM3 / fillPct / inputs in-memory, but the
 *       app serializer DROPPED them (a documented v3.19 limitation): a
 *       saved / shared layout silently reverted every element to its
 *       registry default. From v3.20 WT.fluids.overridesOf/applyOverrides
 *       are the single sanitizing source of truth and app.js serialize()/
 *       deserialize() persist + restore them. Asserted:
 *         - overridesOf picks up ONLY finite numeric overrides on FLUID
 *           elements (a plain element -> null; a non-fluid element with a
 *           stray key -> null; a string value -> ignored)
 *         - applyOverrides clamps on load: rates/capacity >= 0, fillPct
 *           0..100, mixer inputs a whole number >= 1; junk ignored
 *         - THE HAND-COMPUTED ROUND-TRIP: the demo layout's 30 m3/h pipe
 *           override survives serialize-shape -> JSON -> rebuild, and the
 *           re-analyzed network still delivers 30 m3/h with the tank FULL
 *           in 96 min; the CONTROL (the v3.19 serializer, override
 *           dropped) reverts the pipe to its 40 m3/h default -> delivered
 *           40, tank FULL in 120 min - proving the persisted override is
 *           exactly what changes the physics
 *         - BYTE-IDENTITY: every example scenario (>= 20) serializes
 *           byte-identically with the override merge in place (none
 *           carries an override), and stripping the demo pipe's override
 *           makes its serialize byte-identical to the plain shape
 *         - the shipped wiring: app.js serialize() calls overridesOf and
 *           deserialize() calls applyOverrides, the Inspector carries the
 *           role-aware rate fields (data-flkey / applyFluidOverride),
 *           sw.js is at the bumped wt-v77 cache, the runner lists this
 *           harness and the self-test carries the two new live checks
 *
 * Runs the REAL app modules under the same window shim as the other
 * harnesses. Usage:  node verify_craftflow.js   (ASCII-only output)
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of [
  "domain.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "generate.js", "nlcommands.js", "examples.js",
  "process.js", "optimize_factory.js", "fluids.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const G = WT.generate;
const P = WT.process;
const O = WT.factoryOpt;
const FL = WT.fluids;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

const LEGACY_KEYS = ["assembly-line", "machining-shop", "general-factory"];
const QA_KEY = "machining-qa-split";

console.log("CRAFT-on-resolved-flows + fluid-override persistence verification (deterministic)");
console.log("");

/* ===================================================================
 * (a) CRAFT PLACEMENT ON THE RESOLVED FLOW NETWORK
 * =================================================================== */

/* ---- 1. Module surface -------------------------------------------------- */
check("buildFD() reports its flow basis (flowBasis 'resolved' | 'stored')",
  typeof O.buildFD === "function" &&
  ["resolved", "stored"].indexOf(O.buildFD({ elements: [], cell: 1 }, { operations: [], routing: [] }).flowBasis) !== -1);

/* ---- 2. COLLAPSE TO BASE CASE: full hand-written v3.19 craft pin -------- *
 * The known chain from verify_optimize (stations B and C spatially out of
 * flow order). Hand-computed: centroid x = 1 / 5.5 / 17.5 / 11.5 / 23 (all
 * y = 1), F = 100 on each chain arc, MHI 100 x (4.5+12+6+11.5) = 3400;
 * the single improving equal-footprint swap is B<->C -> MHI 2200; pass 2
 * finds no better swap (3 candidates evaluated per pass). The expected
 * object below is the FULL pre-v3.20 craft report, hand-checked - the
 * chain path must reproduce it BYTE-IDENTICALLY (and carry NO flowBasis
 * key: the report shape is unchanged on the fallback). */
const KNOWN_LAYOUT = {
  gridW: 30, gridH: 6, cell: 1, elements: [
    { id: "s", type: "mfg-source", x: 0, y: 0, w: 2, d: 2 },
    { id: "A", type: "mfg-station", x: 4, y: 0, w: 3, d: 2 },
    { id: "B", type: "mfg-station", x: 16, y: 0, w: 3, d: 2 },
    { id: "C", type: "mfg-station", x: 10, y: 0, w: 3, d: 2 },
    { id: "d", type: "mfg-drain", x: 22, y: 0, w: 2, d: 2 },
  ],
};
const KNOWN_BLOCK = P.sanitize({
  version: "wt-proc-1", shiftSec: 28800, demandPerShift: 480,
  operations: [
    { id: "op-s", name: "Parts source", elementId: "s", kind: "source" },
    { id: "op-a", name: "Machining A", elementId: "A", kind: "station", cycleSec: 40, servers: 1 },
    { id: "op-b", name: "Machining B", elementId: "B", kind: "station", cycleSec: 40, servers: 1 },
    { id: "op-c", name: "Machining C", elementId: "C", kind: "station", cycleSec: 40, servers: 1 },
    { id: "op-d", name: "Finished drain", elementId: "d", kind: "sink" },
  ],
  precedence: [["op-s", "op-a"], ["op-a", "op-b"], ["op-b", "op-c"], ["op-c", "op-d"]],
  routing: [
    { from: "op-s", to: "op-a", unitsPerHr: 100 }, { from: "op-a", to: "op-b", unitsPerHr: 100 },
    { from: "op-b", to: "op-c", unitsPerHr: 100 }, { from: "op-c", to: "op-d", unitsPerHr: 100 },
  ],
});
{
  const EXPECTED = {
    ids: ["op-s", "op-a", "op-b", "op-c", "op-d"],
    elementIds: ["s", "A", "B", "C", "d"],
    names: ["Parts source", "Machining A", "Machining B", "Machining C", "Finished drain"],
    F: [
      [0, 100, 0, 0, 0],
      [0, 0, 100, 0, 0],
      [0, 0, 0, 100, 0],
      [0, 0, 0, 0, 100],
      [0, 0, 0, 0, 0],
    ],
    D: [
      [0, 4.5, 16.5, 10.5, 22],
      [4.5, 0, 12, 6, 17.5],
      [16.5, 12, 0, 6, 5.5],
      [10.5, 6, 6, 0, 11.5],
      [22, 17.5, 5.5, 11.5, 0],
    ],
    mhiBefore: 3400,
    mhiAfter: 2200,
    deltaPct: 35.2941,
    moves: [
      { id: "B", from: { x: 16, y: 0 }, to: { x: 10, y: 0 } },
      { id: "C", from: { x: 10, y: 0 }, to: { x: 16, y: 0 } },
    ],
    movedCount: 2,
    swaps: 1,
    passes: 2,
    evaluated: 6,
    proposedElements: [
      { id: "s", type: "mfg-source", x: 0, y: 0, w: 2, d: 2 },
      { id: "A", type: "mfg-station", x: 4, y: 0, w: 3, d: 2 },
      { id: "B", type: "mfg-station", x: 10, y: 0, w: 3, d: 2 },
      { id: "C", type: "mfg-station", x: 16, y: 0, w: 3, d: 2 },
      { id: "d", type: "mfg-drain", x: 22, y: 0, w: 2, d: 2 },
    ],
    aisleBefore: 0,
    aisleAfter: 0,
    improved: true,
  };
  const fd = O.buildFD(KNOWN_LAYOUT, KNOWN_BLOCK);
  check("a plain chain keeps the STORED flow basis (flowBasis 'stored')",
    fd.flowBasis === "stored", fd.flowBasis);
  const got = O.craft(KNOWN_LAYOUT, KNOWN_BLOCK, { minAisleMetres: 0 });
  check("COLLAPSE TO BASE CASE: the chain craft report is BYTE-IDENTICAL to the pre-v3.20 optimizer (full hand-written pin, NO flowBasis key)",
    JSON.stringify(got) === JSON.stringify(EXPECTED) && !("flowBasis" in got),
    JSON.stringify(got) === JSON.stringify(EXPECTED) ? "byte-identical" : JSON.stringify(got));
}

/* ---- 3. machining-qa-split: F carries the RESOLVED 60/40 flows ---------- */
const gen = G.generateFactoryLayout(QA_KEY, { seed: 7 });
const qaLayout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 };
const qaBlock = P.sanitize(gen.process);
const qaCfg = { minAisleMetres: gen.config.minAisleMetres };
// The split arcs, located by their declared ratios (0.6 / 0.4).
const arc06 = qaBlock.routing.find((r) => r.ratio === 0.6);
const arc04 = qaBlock.routing.find((r) => r.ratio === 0.4);
{
  const fd = O.buildFD(qaLayout, qaBlock);
  const ix = {}; fd.ids.forEach((id, i) => { ix[id] = i; });
  check("qa-split: flowBasis is 'resolved' and F carries the hand-computed 60/40 split flows (72 / 48 parts/hr at the offered 120/hr)",
    fd.flowBasis === "resolved" && !!arc06 && !!arc04 &&
    approx(fd.F[ix[arc06.from]][ix[arc06.to]], 72, 1e-6) &&
    approx(fd.F[ix[arc04.from]][ix[arc04.to]], 48, 1e-6),
    "F06=" + (arc06 ? fd.F[ix[arc06.from]][ix[arc06.to]] : "?") +
    " F04=" + (arc04 ? fd.F[ix[arc04.from]][ix[arc04.to]] : "?"));
  // F cannot diverge from the flow model: every entry equals resolveFlow's
  // arc flow (merge arcs 72/48, chain arcs 120).
  const rf = P.resolveFlow(qaBlock);
  let allMatch = rf.ok && rf.arcs.length === qaBlock.routing.length;
  for (const a of rf.arcs) {
    if (ix[a.from] === undefined || ix[a.to] === undefined) { allMatch = false; break; }
    if (!approx(fd.F[ix[a.from]][ix[a.to]], a.unitsPerHr, 1e-6)) { allMatch = false; break; }
  }
  check("qa-split: EVERY F entry equals the corresponding resolveFlow arc flow (120/120/72/48/72/48/120 - the same numbers metrics() reports)",
    allMatch, rf.arcs.map((a) => a.unitsPerHr).join("/"));
  // mhiBefore equals an INDEPENDENT recomputation of SUM F*D from the
  // resolved arcs and the element centroids (rectilinear metres).
  const elById = {}; for (const e of gen.elements) elById[e.id] = e;
  const opEl = {}; qaBlock.operations.forEach((o) => { opEl[o.id] = elById[o.elementId]; });
  let mhiHand = 0;
  for (const a of rf.arcs) {
    const ea = opEl[a.from], eb = opEl[a.to];
    const ax = ea.x + ea.w / 2, ay = ea.y + ea.d / 2;
    const bx = eb.x + eb.w / 2, by = eb.y + eb.d / 2;
    mhiHand += a.unitsPerHr * (Math.abs(ax - bx) + Math.abs(ay - by));
  }
  const c = O.craft(qaLayout, qaBlock, qaCfg);
  check("qa-split: craft mhiBefore equals the independently recomputed SUM(resolved flow x rectilinear distance)",
    approx(c.mhiBefore, Math.round(mhiHand * 10000) / 10000, 1e-6),
    "craft=" + c.mhiBefore + " hand=" + mhiHand);
  check("qa-split: the craft report names the resolved basis (flowBasis 'resolved') and MHI is monotone non-increasing",
    c.flowBasis === "resolved" && c.mhiAfter <= c.mhiBefore + 1e-9,
    "MHI " + c.mhiBefore + " -> " + c.mhiAfter + " (" + c.deltaPct + "%), moved " + c.movedCount);
}

/* ---- 4. STALE stored rates cannot skew the placement -------------------- */
{
  const stale = P.sanitize(gen.process);
  // Tamper every NON-source arc's stored rate to 1 (the source arc keeps
  // the offered 120/hr - resolveFlow reads the offered rate from it).
  for (let i = 1; i < stale.routing.length; i++) stale.routing[i].unitsPerHr = 1;
  const fd = O.buildFD(qaLayout, stale);
  const ix = {}; fd.ids.forEach((id, i) => { ix[id] = i; });
  check("stale stored rates (all non-source arcs = 1/hr): F STILL carries the resolved 72/48 flows, not the stale 1s",
    fd.flowBasis === "resolved" &&
    approx(fd.F[ix[arc06.from]][ix[arc06.to]], 72, 1e-6) &&
    approx(fd.F[ix[arc04.from]][ix[arc04.to]], 48, 1e-6),
    "F06=" + fd.F[ix[arc06.from]][ix[arc06.to]] + " F04=" + fd.F[ix[arc04.from]][ix[arc04.to]]);
  check("the whole craft report is BYTE-IDENTICAL on the stale block (the placement is invariant to stale stored rates)",
    JSON.stringify(O.craft(qaLayout, stale, qaCfg)) === JSON.stringify(O.craft(qaLayout, qaBlock, qaCfg)));
  // Honesty about the delta: the STORED basis on the stale block would have
  // weighed the split arcs at 1/hr - materially different from 72/48.
  let storedF06 = 0;
  for (const r of stale.routing) if (r.from === arc06.from && r.to === arc06.to) storedF06 += r.unitsPerHr;
  check("(control) the stored-rate F on the stale block would have been 1/hr on the 60% branch - the resolved basis is load-bearing",
    storedF06 === 1, "stored=" + storedF06 + " resolved=72");
}

/* ---- 5. never-illegal / never-worse on the resolved basis --------------- */
{
  const baseAisle = D.aisleViolations(gen.elements, qaCfg.minAisleMetres).length;
  const c = O.craft(qaLayout, qaBlock, qaCfg);
  // Independent legality oracle (mirrors the app guards).
  let legalOk = true;
  for (const e of c.proposedElements) {
    if (!(e.x >= 0 && e.y >= 0 && e.x + e.w <= gen.gridW && e.y + e.d <= gen.gridH)) legalOk = false;
  }
  for (let i = 0; i < c.proposedElements.length && legalOk; i++) {
    for (let j = i + 1; j < c.proposedElements.length; j++) {
      const a = c.proposedElements[i], b = c.proposedElements[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d) { legalOk = false; break; }
    }
  }
  legalOk = legalOk && D.aisleViolations(c.proposedElements, qaCfg.minAisleMetres).length <= baseAisle;
  check("resolved-basis craft: the proposal is LEGAL (in-bounds, overlap-free, aisle count not increased) and MHI monotone",
    legalOk && c.mhiAfter <= c.mhiBefore + 1e-9,
    "MHI " + c.mhiBefore + " -> " + c.mhiAfter + " aisle " + c.aisleBefore + "->" + c.aisleAfter);
  const res = O.optimize(qaLayout, qaBlock, qaCfg);
  check("optimize() on the resolved basis: ok, deterministic (byte-identical re-run), TOC read-back == WT.process.metrics",
    res.ok && JSON.stringify(O.optimize(qaLayout, qaBlock, qaCfg)) === JSON.stringify(res) &&
    approx(res.toc.throughputPerHr, P.metrics(qaBlock).throughputPerHr, 1e-6),
    "tp=" + (res.toc && res.toc.throughputPerHr));
  check("optimize() balance never reports a worse line (effAfter >= effBefore, nAfter <= nBefore)",
    res.balance.lineEffAfter >= res.balance.lineEffBefore - 1e-9 &&
    res.balance.nStationsAfter <= res.balance.nStationsBefore);
}

/* ---- 6. Invalid declared network -> STORED fallback, never a guess ------ */
{
  const bad = P.sanitize(gen.process);
  bad.routing.forEach((r) => {
    if (r.ratio === 0.6) r.ratio = 0.5;
    if (r.ratio === 0.4) r.ratio = 0.6; // sums to 1.1 -> validateFlow rejects
  });
  const fd = O.buildFD(qaLayout, bad);
  const ix = {}; fd.ids.forEach((id, i) => { ix[id] = i; });
  const c = O.craft(qaLayout, bad, qaCfg);
  check("an INVALID declared network (ratios sum 1.1) falls back to the STORED rates (flowBasis 'stored', stored 72 on the branch arc, no flowBasis key in the report)",
    P.validateFlow(bad).ok === false && fd.flowBasis === "stored" &&
    approx(fd.F[ix[arc06.from]][ix[arc06.to]], 72, 1e-6) && !("flowBasis" in c),
    "basis=" + fd.flowBasis);
}

/* ---- 7. The 3 legacy factory profiles stay on the stored basis ---------- */
for (const k of LEGACY_KEYS) {
  const g = G.generateFactoryLayout(k, { seed: 7 });
  const layout = { elements: g.elements, gridW: g.gridW, gridH: g.gridH, cell: 1 };
  const block = P.derive(g);
  const fd = O.buildFD(layout, block);
  const c = O.craft(layout, block, { minAisleMetres: g.config.minAisleMetres });
  check(k + ": chain -> flowBasis 'stored', NO flowBasis key in the craft report (byte-identical fallback shape)",
    fd.flowBasis === "stored" && !("flowBasis" in c),
    "basis=" + fd.flowBasis);
}

/* ---- 8. Determinism + honesty ------------------------------------------ */
check("qa-split craft is deterministic (byte-identical across runs)",
  JSON.stringify(O.craft(qaLayout, qaBlock, qaCfg)) === JSON.stringify(O.craft(qaLayout, qaBlock, qaCfg)));
check("BASIS names the resolved-arc-flows F alongside CRAFT/RPW/TOC; HONESTY keeps modelled / local-optimum / NOT-optimal / NOT-a-DES",
  /RESOLVED arc flows/.test(O.BASIS) && /resolveFlow/.test(O.BASIS) && /CRAFT/.test(O.BASIS) &&
  /modelled, not measured/i.test(O.HONESTY) && /local optimum/i.test(O.HONESTY) &&
  /NOT guaranteed optimal/i.test(O.HONESTY) && /NOT a validated discrete-event/i.test(O.HONESTY));

/* ===================================================================
 * (b) PER-ELEMENT FLUID RATE OVERRIDES PERSIST
 * =================================================================== */

/* ---- 9. Module surface + overridesOf ------------------------------------ */
check("WT.fluids exposes OVERRIDE_KEYS (the 5 solver keys) + overridesOf + applyOverrides",
  Array.isArray(FL.OVERRIDE_KEYS) &&
  FL.OVERRIDE_KEYS.join(",") === "rateM3h,flowRateM3h,capacityM3,fillPct,inputs" &&
  typeof FL.overridesOf === "function" && typeof FL.applyOverrides === "function");
{
  const ov = FL.overridesOf({ id: "p", type: "pipe", x: 0, y: 0, w: 6, d: 1, flowRateM3h: 30 });
  check("overridesOf: a pipe with flowRateM3h 30 -> { flowRateM3h: 30 } (deterministic key order)",
    !!ov && JSON.stringify(ov) === '{"flowRateM3h":30}', JSON.stringify(ov));
  check("overridesOf: a fluid element with NO override -> null (a layout with no overrides serializes byte-identically)",
    FL.overridesOf({ id: "p", type: "pipe", x: 0, y: 0, w: 6, d: 1 }) === null);
  check("overridesOf: a NON-fluid element never persists a stray key (rack-single with flowRateM3h -> null)",
    FL.overridesOf({ id: "r", type: "rack-single", x: 0, y: 0, w: 4, d: 1, flowRateM3h: 30 }) === null);
  check("overridesOf: a string value is junk, ignored (never a guessed number)",
    FL.overridesOf({ id: "p", type: "pipe", x: 0, y: 0, w: 6, d: 1, flowRateM3h: "30" }) === null);
}

/* ---- 10. applyOverrides sanitizes on load ------------------------------- */
{
  const tank = FL.applyOverrides({ id: "t", type: "tank", x: 0, y: 0, w: 3, d: 3 },
    { capacityM3: -50, fillPct: 150 });
  check("applyOverrides clamps: capacityM3 -50 -> 0, fillPct 150 -> 100",
    tank.capacityM3 === 0 && tank.fillPct === 100,
    "cap=" + tank.capacityM3 + " fill=" + tank.fillPct);
  const mix = FL.applyOverrides({ id: "m", type: "mixer", x: 0, y: 0, w: 3, d: 3 },
    { inputs: 0.4 });
  check("applyOverrides clamps: mixer inputs 0.4 -> a whole number >= 1",
    mix.inputs === 1, "inputs=" + mix.inputs);
  const junk = FL.applyOverrides({ id: "p", type: "pipe", x: 0, y: 0, w: 6, d: 1 },
    { flowRateM3h: "abc", rateM3h: null });
  check("applyOverrides ignores junk (string / null) - the element keeps its declared default",
    !("flowRateM3h" in junk) && !("rateM3h" in junk));
  const rack = FL.applyOverrides({ id: "r", type: "rack-single", x: 0, y: 0, w: 4, d: 1 },
    { flowRateM3h: 30 });
  check("applyOverrides never touches a NON-fluid element",
    !("flowRateM3h" in rack));
}

/* ---- 11. The hand-computed serialize round-trip ------------------------- *
 * Demo network: 40+40 m3/h supplies -> mixer -> 200 m3 tank @60% -> pipe
 * OVERRIDDEN to 30 m3/h -> drain. Persisted (v3.20): delivered 30, tank
 * fills at +50 -> FULL in 96 min. Dropped (the v3.19 serializer): the pipe
 * reverts to its 40 m3/h registry default -> delivered 40, tank +40 ->
 * FULL in 80/40*60 = 120 min. Same layout, one persisted key - the
 * override is exactly what changes the physics. */
function serializeShape(els, withOverrides) {
  // EXACTLY what app.js serialize() emits per element (id/type/x/y/w/d,
  // arc when set, + the fluid overrides when withOverrides).
  return els.map((e) => {
    const rec = { id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, d: e.d, arc: e.arc };
    if (withOverrides) {
      const ov = FL.overridesOf(e);
      if (ov) Object.assign(rec, ov);
    }
    return rec;
  });
}
function rebuildShape(rawEls, withOverrides) {
  // EXACTLY what app.js deserialize() rebuilds per element (the fluid
  // overrides restored via applyOverrides when withOverrides).
  return rawEls.map((r) => {
    const el = { id: r.id, type: r.type, x: r.x, y: r.y, w: r.w, d: r.d };
    if (typeof r.arc === "string") el.arc = r.arc;
    if (withOverrides) FL.applyOverrides(el, r);
    return el;
  });
}
{
  const demo = FL.demoLayout();
  const wire = JSON.parse(JSON.stringify(serializeShape(demo.elements, true)));
  check("the serialized demo carries the pipe's 30 m3/h override (and ONLY elements that set one carry a key)",
    wire.find((e) => e.id === "fl-pipe").flowRateM3h === 30 &&
    wire.filter((e) => "flowRateM3h" in e || "rateM3h" in e || "capacityM3" in e ||
      "fillPct" in e || "inputs" in e).length === 1);
  const back = rebuildShape(wire, true);
  const r1 = FL.analyze({ elements: back });
  const n1 = r1.networks[0];
  const t1 = n1.nodes["fl-tank"];
  check("PERSISTED round-trip: the re-analyzed network still delivers 30 m3/h, tank +50 m3/h -> FULL in 96 min, bottleneck = the overridden pipe",
    approx(n1.deliveredM3h, 30) && approx(t1.netFillM3h, 50) && approx(t1.timeToFullMin, 96) &&
    !!n1.bottleneck && n1.bottleneck.id === "fl-pipe" && approx(n1.bottleneck.capM3h, 30),
    "delivered=" + n1.deliveredM3h + " fullIn=" + (t1 && t1.timeToFullMin) + "min");
  // CONTROL: the v3.19 serializer dropped the override -> registry default.
  const dropped = rebuildShape(wire, false);
  const r0 = FL.analyze({ elements: dropped });
  const n0 = r0.networks[0];
  const t0 = n0.nodes["fl-tank"];
  check("(control) the v3.19 serializer dropped the override: the pipe reverts to 40 m3/h -> delivered 40, tank FULL in 120 min (the persisted key IS the difference)",
    approx(n0.deliveredM3h, 40) && approx(t0.netFillM3h, 40) && approx(t0.timeToFullMin, 120),
    "delivered=" + n0.deliveredM3h + " fullIn=" + (t0 && t0.timeToFullMin) + "min");
  check("round-trip is idempotent (serialize(rebuild(serialize)) is byte-identical)",
    JSON.stringify(serializeShape(back, true)) === JSON.stringify(wire));
}

/* ---- 12. Byte-identity for every layout WITHOUT overrides --------------- */
{
  let allIdentical = true, n = 0;
  for (const ex of WT.examples.library) {
    const built = WT.examples.build(ex.id);
    const withOv = JSON.stringify(serializeShape(built.elements, true));
    const without = JSON.stringify(serializeShape(built.elements, false));
    if (withOv !== without) allIdentical = false;
    n++;
  }
  check("EVERY example scenario (" + n + ") serializes BYTE-IDENTICALLY with the override merge in place (none carries an override)",
    n >= 20 && allIdentical);
  const demo = FL.demoLayout();
  delete demo.elements.find((e) => e.id === "fl-pipe").flowRateM3h;
  check("stripping the demo pipe's override makes its serialize byte-identical to the plain shape (no override -> no key)",
    JSON.stringify(serializeShape(demo.elements, true)) === JSON.stringify(serializeShape(demo.elements, false)));
}

/* ---- 13. Shipped wiring ------------------------------------------------- */
{
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
  const st = fs.readFileSync(path.join(__dirname, "selftest.js"), "utf8");
  const runall = fs.readFileSync(path.join(__dirname, "test", "run-all.mjs"), "utf8");
  check("app.js serialize() persists via WT.fluids.overridesOf and deserialize() restores via WT.fluids.applyOverrides",
    /WT\.fluids\.overridesOf/.test(app) && /WT\.fluids\.applyOverrides/.test(app));
  check("the grouped Inspector carries the role-aware fluid rate fields (data-flkey inputs -> applyFluidOverride)",
    /data-flkey/.test(app) && /function applyFluidOverride\(/.test(app) &&
    /function fluidOverrideFields\(/.test(app));
  check("sw.js cache is at the bumped wt-v77 (trail preserved: previously wt-v73)",
    /CACHE_VERSION\s*=\s*"wt-v77"/.test(sw) && /Previously wt-v73/.test(sw));
  check("the self-test carries the two new live checks; test/run-all.mjs lists this harness",
    /fluids-override-persists-through-serialize/.test(st) &&
    /optimize-craft-F-from-resolved-flows/.test(st) &&
    /verify_craftflow\.js/.test(runall));
}

/* ---- sample transcript, for the record ---------------------------------- */
console.log("");
{
  const c = O.craft(qaLayout, qaBlock, qaCfg);
  console.log("qa-split CRAFT on the RESOLVED basis: MHI " + c.mhiBefore + " -> " + c.mhiAfter +
    " (" + c.deltaPct + "%), moved " + c.movedCount + " station(s), basis=" + c.flowBasis);
  const demo = FL.demoLayout();
  const rt = FL.analyze({ elements: rebuildShape(JSON.parse(JSON.stringify(serializeShape(demo.elements, true))), true) });
  console.log("fluids round-trip: pipe override 30 m3/h persisted -> delivered " +
    rt.networks[0].deliveredM3h + " m3/h, tank FULL in " +
    rt.networks[0].nodes["fl-tank"].timeToFullMin + " min (v3.19 would have reverted to 40/120)");
}

console.log("");
console.log(failures === 0 ? "ALL CRAFT-FLOW + FLUIDS-PERSIST CHECKS PASSED" : failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
