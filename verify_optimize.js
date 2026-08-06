/* =====================================================================
 * verify_optimize.js - FACTORY EFFICIENCY OPTIMIZER harness (v2.8 FACTORY-D).
 * Proves the NEW optimize_factory.js code path (WT.factoryOpt):
 *
 *   Material-flow placement (CRAFT pairwise exchange)
 *     - buildFD() builds F (from process.routing) and D (rectilinear
 *       distance between element centroids) CORRECTLY from a KNOWN process
 *     - craft() on a deliberately scrambled equal-footprint line finds the
 *       MHI-minimising swap: MHI monotone NON-INCREASING, the result is
 *       LEGAL (in-bounds, overlap-free, aisle count not increased) and it
 *       NEVER increases MHI; byte-identical across runs (deterministic)
 *     - on every generated factory: legal + monotone + deterministic
 *
 *   Line balancing (Ranked Positional Weight)
 *     - rpw() respects PRECEDENCE (a task never sits in a station before a
 *       predecessor's), packs to takt, and its line-efficiency formula
 *       (SUM cycle / (n * cycle_max)) is correct on a HAND-COMPUTED example;
 *       a task longer than takt gets its own (flagged) station
 *
 *   TOC + safety + honesty
 *     - optimize() reads throughput/bottleneck back through WT.process.metrics
 *     - a WAREHOUSE layout is a strict NO-OP (ok:false) and stays byte-
 *       identical; nothing is mutated on the caller's layout
 *     - the modelled / deterministic / local-optimum / NOT-optimal / NOT-a-
 *       DES / NOT-CAD-BIM / NOT-a-cert honesty labels present
 *
 * Runs the REAL app modules under the same window shim the other harnesses
 * use. Everything is deterministic. Usage:  node verify_optimize.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of [
  "domain.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "generate.js", "process.js", "optimize_factory.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const G = WT.generate;
const P = WT.process;
const O = WT.factoryOpt;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// Local, independent legality oracle (mirrors the app guards).
function isLegal(els, gridW, gridH, minAisle, baseAisle) {
  for (const e of els) if (!(e.x >= 0 && e.y >= 0 && e.x + e.w <= gridW && e.y + e.d <= gridH)) return false;
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d) return false;
    }
  const v = D.aisleViolations(els, minAisle).length;
  return v <= baseAisle;
}

const FACTORY_KEYS = ["assembly-line", "machining-shop", "general-factory"];

console.log("Factory efficiency optimizer verification (deterministic)");
console.log("");

/* ---- 1. Module surface -------------------------------------------------- */
check("WT.factoryOpt exposes buildFD/mhi/craft/rpw/optimize",
  O && ["buildFD", "mhi", "craft", "rpw", "optimize"].every((k) => typeof O[k] === "function"));
check("WT.factoryOpt.VERSION is wt-opt-1", O.VERSION === "wt-opt-1", O.VERSION);

/* ---- 2. F + D built correctly from a KNOWN process ---------------------- *
 * A 5-node line s -> A -> B -> C -> d, all on y=0, stations 3x2, source/
 * drain 2x2. Centroids x: s=1, A=5.5, B=17.5, C=11.5, d=23 (B and C are
 * spatially out of flow order on purpose). Flow = 100 units/hr on each arc. */
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
const fd = O.buildFD(KNOWN_LAYOUT, KNOWN_BLOCK);
const ix = {}; fd.ids.forEach((id, i) => { ix[id] = i; });
check("buildFD ids follow the block operation order (s,A,B,C,d)",
  fd.ids.join(",") === "op-s,op-a,op-b,op-c,op-d", fd.ids.join(","));
check("F matrix reads the from-to routing (F[A][B]=100 directed; F[B][A]=0)",
  fd.F[ix["op-a"]][ix["op-b"]] === 100 && fd.F[ix["op-b"]][ix["op-a"]] === 0);
check("D matrix is rectilinear distance between centroids in metres (D[s][A]=4.5, symmetric)",
  approx(fd.D[ix["op-s"]][ix["op-a"]], 4.5) && approx(fd.D[ix["op-a"]][ix["op-s"]], 4.5) &&
  approx(fd.D[ix["op-b"]][ix["op-c"]], 6), "D[s][A]=" + fd.D[ix["op-s"]][ix["op-a"]] + " D[B][C]=" + fd.D[ix["op-b"]][ix["op-c"]]);
check("mhi(F,D) equals the hand-computed baseline (100 x (4.5+12+6+11.5) = 3400)",
  approx(O.mhi(fd.F, fd.D), 3400), "MHI=" + O.mhi(fd.F, fd.D));

/* ---- 3. CRAFT: finds the swap, monotone, legal, deterministic ---------- */
{
  const cfg = { minAisleMetres: 0 };
  const c = O.craft(KNOWN_LAYOUT, KNOWN_BLOCK, cfg);
  // Optimum is swapping B and C: MHI 3400 -> 2200 in one swap.
  check("craft: MHI is monotone non-increasing (before >= after) and strictly improves here",
    c.mhiAfter <= c.mhiBefore + 1e-9 && c.mhiAfter < c.mhiBefore - 1e-6,
    "MHI " + c.mhiBefore + " -> " + c.mhiAfter + " (" + c.deltaPct + "% ) swaps=" + c.swaps);
  check("craft: reaches the known optimum (MHI 3400 -> 2200, one swap of B<->C)",
    approx(c.mhiBefore, 3400) && approx(c.mhiAfter, 2200) && c.swaps === 1 &&
    c.moves.length === 2 && c.moves.map((m) => m.id).sort().join(",") === "B,C",
    "moved=" + c.moves.map((m) => m.id).join(","));
  // Legality of the proposed layout (independent oracle).
  const baseAisle = D.aisleViolations(KNOWN_LAYOUT.elements, 0).length;
  check("craft: the proposed layout is LEGAL (in-bounds, overlap-free, aisle count not increased)",
    isLegal(c.proposedElements, KNOWN_LAYOUT.gridW, KNOWN_LAYOUT.gridH, 0, baseAisle) &&
    c.aisleAfter <= c.aisleBefore, "aisle " + c.aisleBefore + " -> " + c.aisleAfter);
  // Determinism: byte-identical across runs.
  const a = JSON.stringify(O.craft(KNOWN_LAYOUT, KNOWN_BLOCK, cfg));
  const b = JSON.stringify(O.craft(KNOWN_LAYOUT, KNOWN_BLOCK, cfg));
  check("craft: deterministic (byte-identical result across runs)", a === b);
  // Does not mutate the caller's layout.
  check("craft: never mutates the caller's layout (B still at x=16, C at x=10)",
    KNOWN_LAYOUT.elements.find((e) => e.id === "B").x === 16 &&
    KNOWN_LAYOUT.elements.find((e) => e.id === "C").x === 10);
}

/* ---- 4. CRAFT on every generated factory: legal + monotone + det ------- */
const builds = {};
for (const k of FACTORY_KEYS) {
  const gen = G.generateFactoryLayout(k, { seed: 7 });
  builds[k] = gen;
  const layout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 };
  const block = P.derive(gen);
  const cfg = { minAisleMetres: gen.config.minAisleMetres };
  const c = O.craft(layout, block, cfg);
  const baseAisle = D.aisleViolations(gen.elements, cfg.minAisleMetres).length;
  check(k + ": craft is monotone (MHI after <= before) and never illegal",
    c.mhiAfter <= c.mhiBefore + 1e-6 &&
    isLegal(c.proposedElements, gen.gridW, gen.gridH, cfg.minAisleMetres, baseAisle) &&
    c.aisleAfter <= c.aisleBefore,
    "MHI " + c.mhiBefore + " -> " + c.mhiAfter + " (" + c.deltaPct + "%), moved " + c.movedCount + ", aisle " + c.aisleBefore + "->" + c.aisleAfter);
  check(k + ": craft is deterministic (byte-identical across runs)",
    JSON.stringify(O.craft(layout, block, cfg)) === JSON.stringify(O.craft(layout, block, cfg)));
}

/* ---- 5. RPW: precedence, packing + line-efficiency formula ------------- *
 * Hand example: T1=30, T2=20, T3=10, takt=40. RPW = 60,30,10 -> pack to
 * [T1] and [T2,T3]. Line efficiency at takt = SUM cycle / (n x takt):
 * after = 60/(2x40)=0.75, before = 60/(3x40)=0.50, balance delay after =
 * 25%, theoretical min = ceil(60/40) = 2. */
{
  const rblock = P.sanitize({
    version: "wt-proc-1", shiftSec: 40, demandPerShift: 1,
    operations: [
      { id: "t0", name: "src", elementId: "e0", kind: "source" },
      { id: "t1", name: "T1", elementId: "e1", kind: "station", cycleSec: 30, servers: 1 },
      { id: "t2", name: "T2", elementId: "e2", kind: "station", cycleSec: 20, servers: 1 },
      { id: "t3", name: "T3", elementId: "e3", kind: "station", cycleSec: 10, servers: 1 },
      { id: "t4", name: "snk", elementId: "e4", kind: "sink" },
    ],
    precedence: [["t0", "t1"], ["t1", "t2"], ["t2", "t3"], ["t3", "t4"]],
    routing: [{ from: "t0", to: "t1", unitsPerHr: 90 }, { from: "t1", to: "t2", unitsPerHr: 90 },
      { from: "t2", to: "t3", unitsPerHr: 90 }, { from: "t3", to: "t4", unitsPerHr: 90 }],
  });
  const r = O.rpw(rblock);
  check("rpw: takt = shiftSec/demand = 40 s; RPW ranks T1>T2>T3 (60,30,10)",
    approx(r.taktSec, 40) && r.tasks[0].opId === "t1" && r.tasks[0].rpw === 60 &&
    r.tasks[1].rpw === 30 && r.tasks[2].rpw === 10,
    "rpw=" + r.tasks.map((t) => t.rpw).join(","));
  check("rpw: packs to 2 stations [T1] then [T2,T3] (theoretical min 2)",
    r.nStationsAfter === 2 && r.stations[0].opIds.join(",") === "t1" &&
    r.stations[1].opIds.join(",") === "t2,t3" && r.theoreticalMinStations === 2,
    "stations=" + JSON.stringify(r.stations.map((s) => s.opIds)));
  check("rpw: line efficiency at takt correct (after=0.75, before=0.50, balance delay after=25%)",
    approx(r.lineEffAfter, 0.75, 1e-4) && approx(r.lineEffBefore, 0.5, 1e-4) &&
    approx(r.balanceDelayAfter, 25, 1e-2) && r.improved,
    "eff " + r.lineEffBefore + " -> " + r.lineEffAfter + " delayAfter=" + r.balanceDelayAfter);
  // Precedence feasibility: for each arc a->b (both tasks), station(a) <= station(b).
  const stOf = {}; r.stations.forEach((s, i) => s.opIds.forEach((id) => { stOf[id] = i; }));
  let precOk = true;
  for (const [a, b] of rblock.precedence) if (stOf[a] !== undefined && stOf[b] !== undefined && stOf[a] > stOf[b]) precOk = false;
  check("rpw: assignment respects precedence (no task before a predecessor's station)", precOk);
}
// Over-takt task gets its own flagged station.
{
  const big = P.sanitize({
    version: "wt-proc-1", shiftSec: 40, demandPerShift: 1,
    operations: [
      { id: "t0", name: "src", elementId: "e0", kind: "source" },
      { id: "t1", name: "Huge", elementId: "e1", kind: "station", cycleSec: 100, servers: 1 },
      { id: "t2", name: "Small", elementId: "e2", kind: "station", cycleSec: 15, servers: 1 },
      { id: "t3", name: "snk", elementId: "e3", kind: "sink" },
    ],
    precedence: [["t0", "t1"], ["t1", "t2"], ["t2", "t3"]],
    routing: [{ from: "t0", to: "t1", unitsPerHr: 90 }, { from: "t1", to: "t2", unitsPerHr: 90 }, { from: "t2", to: "t3", unitsPerHr: 90 }],
  });
  const r = O.rpw(big);
  const solo = r.stations.find((s) => s.opIds.join(",") === "t1");
  check("rpw: a task longer than takt gets its own (over-takt flagged) station",
    !!solo && solo.overTakt === true && solo.opIds.length === 1, JSON.stringify(r.stations.map((s) => [s.opIds, s.overTakt])));
}
// RPW on generated factories: precedence respected, efficiency bounded.
for (const k of FACTORY_KEYS) {
  const block = P.derive(builds[k]);
  const r = O.rpw(block);
  const stOf = {}; r.stations.forEach((s, i) => s.opIds.forEach((id) => { stOf[id] = i; }));
  let precOk = true;
  for (const [a, b] of block.precedence) if (stOf[a] !== undefined && stOf[b] !== undefined && stOf[a] > stOf[b]) precOk = false;
  check(k + ": rpw respects precedence; line eff in [0,1]; consolidates (nAfter<=nBefore, eff improves)",
    precOk && r.lineEffAfter >= 0 && r.lineEffAfter <= 1 && r.nStationsAfter <= r.nStationsBefore &&
    r.lineEffAfter >= r.lineEffBefore - 1e-9,
    "eff " + r.lineEffBefore + "->" + r.lineEffAfter + " stations " + r.nStationsBefore + "->" + r.nStationsAfter);
}

/* ---- 6. optimize(): full report + TOC read-back ------------------------ */
for (const k of FACTORY_KEYS) {
  const gen = builds[k];
  const layout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 };
  const block = P.derive(gen);
  const cfg = { minAisleMetres: gen.config.minAisleMetres };
  const res = O.optimize(layout, block, cfg);
  const tocOk = res.toc && res.toc.throughputPerHr > 0 && res.toc.bottleneckName &&
    approx(res.toc.throughputPerHr, WT.process.metrics(block).throughputPerHr, 1e-6);
  check(k + ": optimize() returns placement + balance + TOC read-back (throughput matches WT.process.metrics)",
    res.ok && res.placement && res.balance && tocOk &&
    res.headline && typeof res.headline.mhiDeltaPct === "number",
    res.toc ? "tp=" + res.toc.throughputPerHr + "/hr bottleneck=" + res.toc.bottleneckName : "no toc");
  check(k + ": optimize() is deterministic (byte-identical across runs)",
    JSON.stringify(O.optimize(layout, block, cfg)) === JSON.stringify(O.optimize(layout, block, cfg)));
}

/* ---- 7. Warehouse layout: strict NO-OP + byte-identical ---------------- */
{
  const wkey = Object.keys(G.plantProfiles)[0];
  const wh = G.generateLayout(wkey, { seed: 3 });
  const whLayout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, cell: 1 };
  const block = P.derive(wh); // null for a warehouse
  const before = JSON.stringify(whLayout);
  const res = O.optimize(whLayout, block, { minAisleMetres: wh.config.minAisleMetres });
  check("a WAREHOUSE layout is a strict NO-OP (optimize -> ok:false, no process block)",
    res.ok === false && block === null, res.reason || "");
  check("optimize() leaves a warehouse layout BYTE-IDENTICAL (nothing mutated)",
    JSON.stringify(whLayout) === before);
}

/* ---- 8. Honesty labels -------------------------------------------------- */
{
  const h = O.HONESTY;
  const okH = /modelled, not measured/i.test(h) && /deterministic/i.test(h) && /teaching-scale/i.test(h) &&
    /local optimum/i.test(h) && /NOT guaranteed optimal/i.test(h) && /NOT a validated discrete-event/i.test(h) &&
    /NOT CAD\/BIM/i.test(h) && /NOT a certification/i.test(h) && /does NOT beat/i.test(h) &&
    /CRAFT/i.test(h) && /RPW/i.test(h) && /TOC/i.test(h);
  check("HONESTY states modelled/deterministic/local-optimum + NOT optimal/DES/CAD-BIM/cert + does NOT beat suites; cites CRAFT/RPW/TOC", okH);
  const res = O.optimize({ elements: builds["assembly-line"].elements, gridW: builds["assembly-line"].gridW, gridH: builds["assembly-line"].gridH, cell: 1 },
    P.derive(builds["assembly-line"]), { minAisleMetres: builds["assembly-line"].config.minAisleMetres });
  check("optimize() carries the honesty label + the methods basis (CRAFT/RPW/TOC/Little's Law)",
    res.honesty === h && /CRAFT/i.test(res.basis) && /Ranked Positional Weight/i.test(res.basis) && /Theory of Constraints/i.test(res.basis));
}

/* ---- sample transcript, for the record --------------------------------- */
console.log("");
console.log("Optimizer before/after per factory profile:");
for (const k of FACTORY_KEYS) {
  const gen = builds[k];
  const res = O.optimize({ elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 },
    P.derive(gen), { minAisleMetres: gen.config.minAisleMetres });
  const h = res.headline;
  console.log("  - " + k + ": MHI " + res.placement.mhiBefore + " -> " + res.placement.mhiAfter +
    " (" + h.mhiDeltaPct + "%), moved " + h.moved + " station(s); line eff " +
    (h.lineEffBefore * 100).toFixed(1) + "% -> " + (h.lineEffAfter * 100).toFixed(1) + "%; bottleneck " +
    h.bottleneckBefore + " -> " + h.bottleneckAfter + "; throughput " + (h.throughputPerHr || 0).toFixed(1) + "/hr");
}

console.log("");
console.log(failures === 0 ? "ALL OPTIMIZER CHECKS PASSED" : failures + " OPTIMIZER CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
