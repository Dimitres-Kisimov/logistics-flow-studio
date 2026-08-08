/* =====================================================================
 * verify_flownet.js - MULTI-WAY PROPORTIONAL-FLOW ROUTING harness (v3.17).
 * Proves the process line sim's routing depth: from-to arcs are no longer
 * only STRUCTURAL - a block that DECLARES a split (>= 2 outgoing arcs with
 * ratios summing to ~1) or a merge (>= 2 incoming arcs) is RESOLVED into a
 * proportional flow network and simulated on it. Checks:
 *
 *   HAND-COMPUTED SPLIT/MERGE FLOW (the demoNetwork line: source ->
 *     Machining -> 60% QA fast / 40% QA deep -> merge -> Pack -> drain,
 *     offered 100/hr): cyclesPerFinished 1/0.6/0.4/1, effective times
 *     30/24/32/25 s, bottleneck QA deep test at 32 s -> throughput
 *     112.5/hr, utilisation 0.9375/0.75/1/0.78125, line efficiency
 *     111/128 = 0.8672, resolved arc flows 100/60/40/60/40/100 parts/hr
 *   CONSERVATION - flow in == transformed flow out at EVERY node (checked
 *     independently from the resolved arcs, residual ~0), merges
 *     accumulate (Pack inflow == 60 + 40), and the gozinto still holds
 *     through a dismantle-then-split hand case
 *   COLLAPSE TO BASE CASE - every generated factory profile is a plain
 *     chain: isMultiway false, simulateFlow() reproduces the legacy
 *     simulate() BYTE-IDENTICALLY, metrics carries NO `flow` key and the
 *     serialize carries NO `ratio` key (existing scenarios byte-identical)
 *   DETERMINISM - demoNetwork/resolveFlow/metrics/simulateFlow all
 *     byte-identical across runs; the deterministic largest-deficit
 *     dispatcher gives two identical 50/50 branches identical measured
 *     utilisation (NO RNG anywhere)
 *   VALIDATION - ratio sets that don't sum to ~1, missing ratios on a
 *     split, routing cycles, duplicate arcs and multi-source networks are
 *     all REJECTED with a friendly plain-language message (metrics -> null,
 *     simulateFlow throws the same message; never a silent guess)
 *   HONESTY - modelled / deterministic / NOT-a-DES labels intact and the
 *     basis names the proportional-flow network
 *
 * Runs the REAL app modules under the same window shim as the other
 * harnesses. Usage:  node verify_flownet.js   (ASCII-only output)
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of [
  "domain.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "generate.js", "process.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const G = WT.generate;
const P = WT.process;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

console.log("Multi-way proportional-flow routing verification (deterministic)");
console.log("");

/* ---- 1. Module surface -------------------------------------------------- */
check("WT.process exposes isMultiway/validateFlow/resolveFlow/simulateFlow/demoNetwork",
  P && ["isMultiway", "validateFlow", "resolveFlow", "simulateFlow", "demoNetwork"].every((k) => typeof P[k] === "function"));

/* ---- 2. The demo network: importable, multiway, ratio round-trips ------- */
const demo = P.demoNetwork();
const block = P.rebuild(demo);
check("demoNetwork() is a wt-1 layout with an embedded process that rebuild() accepts",
  !!demo && demo.version === "wt-1" && Array.isArray(demo.elements) && !!block && block.version === P.VERSION,
  block ? "ops=" + block.operations.length + " arcs=" + block.routing.length : "null");
check("demoNetwork() is byte-identical on re-call (deterministic)",
  JSON.stringify(demo) === JSON.stringify(P.demoNetwork()));
check("the demo DECLARES multi-way routing (isMultiway true; a split and a merge)",
  P.isMultiway(block) === true && P.validateFlow(block).ok === true);
{
  const obj = {};
  P.embedInto(obj, block);
  const re = P.rebuild(obj);
  check("split ratios SURVIVE the embedInto()/rebuild() serialize round-trip byte-identically",
    JSON.stringify(re) === JSON.stringify(block) &&
    re.routing.some((r) => r.ratio === 0.6) && re.routing.some((r) => r.ratio === 0.4));
}

/* ---- 3. Hand-computed resolved flow (split + merge) --------------------- */
const rf = P.resolveFlow(block);
check("resolveFlow ok on the demo; 1 split + 1 merge; offered 100/hr -> 100/hr finished",
  rf.ok && rf.splits === 1 && rf.merges === 1 && approx(rf.sourceRatePerHr, 100) && approx(rf.finishedPerHr, 100),
  "src=" + rf.sourceRatePerHr + " finished=" + rf.finishedPerHr + " splits=" + rf.splits + " merges=" + rf.merges);
{
  const n = rf.nodes;
  check("SPLIT carries the declared 60/40 shares (QA fast 60/hr, QA deep 40/hr)",
    approx(n["op-qaf"].inPerHr, 60) && approx(n["op-qad"].inPerHr, 40),
    "qaf=" + n["op-qaf"].inPerHr + " qad=" + n["op-qad"].inPerHr);
  check("MERGE accumulates (Pack inflow = 60 + 40 = 100/hr)",
    approx(n["op-pack"].inPerHr, 100), "pack=" + n["op-pack"].inPerHr);
  check("cyclesPerFinished on the network: Machining 1, QA fast 0.6, QA deep 0.4, Pack 1",
    approx(n["op-mach"].cyclesPerFinished, 1) && approx(n["op-qaf"].cyclesPerFinished, 0.6) &&
    approx(n["op-qad"].cyclesPerFinished, 0.4) && approx(n["op-pack"].cyclesPerFinished, 1));
  check("effective times per finished unit: 30 / 24 / 32 / 25 s (cycle x share / servers)",
    approx(n["op-mach"].effTimeSec, 30) && approx(n["op-qaf"].effTimeSec, 24) &&
    approx(n["op-qad"].effTimeSec, 32) && approx(n["op-pack"].effTimeSec, 25));
  const wantArcs = [
    ["op-src", "op-mach", 1, 100],
    ["op-mach", "op-qaf", 0.6, 60],
    ["op-mach", "op-qad", 0.4, 40],
    ["op-qaf", "op-pack", 1, 60],
    ["op-qad", "op-pack", 1, 40],
    ["op-pack", "op-drain", 1, 100],
  ];
  const arcsOk = rf.arcs.length === wantArcs.length && wantArcs.every((w, i) =>
    rf.arcs[i].from === w[0] && rf.arcs[i].to === w[1] &&
    approx(rf.arcs[i].ratio, w[2]) && approx(rf.arcs[i].unitsPerHr, w[3]));
  check("resolved arc flows are the hand-computed 100/60/40/60/40/100 parts/hr", arcsOk,
    rf.arcs.map((a) => a.from + ">" + a.to + "=" + a.unitsPerHr).join(" "));
}

/* ---- 4. Conservation at every node (independent recompute) -------------- */
{
  // flow out of each node (sum of its arcs) must equal its transformed
  // inflow: recomputed here from the resolved arcs, not trusted from the flag.
  const inflow = {}, outflow = {};
  block.operations.forEach((o) => { inflow[o.id] = 0; outflow[o.id] = 0; });
  rf.arcs.forEach((a) => { outflow[a.from] += a.unitsPerHr; inflow[a.to] += a.unitsPerHr; });
  let maxRes = 0;
  for (const o of block.operations) {
    let expectedOut;
    if (o.kind === "source") expectedOut = rf.sourceRatePerHr;
    else if (o.kind === "sink") expectedOut = 0;
    else if (o.kind === "assembly") expectedOut = inflow[o.id] / o.inputs;
    else if (o.kind === "dismantle") expectedOut = inflow[o.id] * o.outputs;
    else expectedOut = inflow[o.id];
    maxRes = Math.max(maxRes, Math.abs(outflow[o.id] - expectedOut));
  }
  check("CONSERVATION: flow out == transformed flow in at EVERY node (residual ~0)",
    maxRes <= 1e-9 && rf.conservation.ok === true, "maxResidual=" + maxRes);
}

/* ---- 5. Hand-computed metrics on the resolved network ------------------- */
const m = P.metrics(block);
check("bottleneck = QA deep test at 32 s/unit -> throughput 3600/32 = 112.5/hr (TOC on the network)",
  !!m && m.bottleneck.opId === "op-qad" && approx(m.bottleneck.effTimeSec, 32) && approx(m.throughputPerHr, 112.5),
  m ? "tp=" + m.throughputPerHr + " bottleneck=" + m.bottleneck.name + "@" + m.bottleneck.effTimeSec : "null");
{
  const u = {};
  m.stations.forEach((s) => { u[s.opId] = s; });
  check("utilisation vs the bottleneck: 0.9375 / 0.75 / 1 / 0.78125 (bottleneck at 100%)",
    approx(u["op-mach"].utilisation, 0.9375) && approx(u["op-qaf"].utilisation, 0.75) &&
    approx(u["op-qad"].utilisation, 1) && approx(u["op-pack"].utilisation, 0.7813, 1e-4) &&
    u["op-qad"].isBottleneck === true);
  check("line efficiency = (30+24+32+25)/(4*32) = 111/128 = 0.8672; balance delay 13.2813%; theoretical min stations 2",
    approx(m.lineEfficiency, 0.8672, 1e-4) && m.theoreticalMinStations === 2 &&
    approx(m.balanceDelayPct, 13.2813, 1e-4), // round4((1 - 111/128) * 100)
    "eff=" + m.lineEfficiency + " delay=" + m.balanceDelayPct + " min=" + m.theoreticalMinStations);
  check("stations carry the resolved flow (flowPerHr 100/60/40/100) - the panel's arc data",
    approx(u["op-mach"].flowPerHr, 100) && approx(u["op-qaf"].flowPerHr, 60) &&
    approx(u["op-qad"].flowPerHr, 40) && approx(u["op-pack"].flowPerHr, 100));
  check("metrics carries the flow summary (multiway, 1 split, 1 merge, conservation ok)",
    m.flow && m.flow.multiway === true && m.flow.splits === 1 && m.flow.merges === 1 &&
    m.flow.conservation.ok === true && m.flow.arcs.length === 6);
}
check("metrics() on the demo is byte-identical across runs (deterministic)",
  JSON.stringify(m) === JSON.stringify(P.metrics(block)));

/* ---- 6. Dismantle-then-split hand case (gozinto through the network) ---- */
{
  const b2 = P.sanitize({
    version: P.VERSION, shiftSec: 28800, demandPerShift: 480,
    operations: [
      { id: "s", name: "Src", elementId: "e-s", kind: "source" },
      { id: "x", name: "Cut", elementId: "e-x", kind: "dismantle", cycleSec: 20, servers: 1, outputs: 2 },
      { id: "a", name: "Lane A", elementId: "e-a", kind: "station", cycleSec: 30, servers: 1 },
      { id: "b", name: "Lane B", elementId: "e-b", kind: "station", cycleSec: 30, servers: 1 },
      { id: "d", name: "Drain", elementId: "e-d", kind: "sink" },
    ],
    precedence: [["s", "x"], ["x", "a"], ["x", "b"], ["a", "d"], ["b", "d"]],
    routing: [
      { from: "s", to: "x", unitsPerHr: 100 },
      { from: "x", to: "a", unitsPerHr: 100, ratio: 0.5 },
      { from: "x", to: "b", unitsPerHr: 100, ratio: 0.5 },
      { from: "a", to: "d", unitsPerHr: 100 },
      { from: "b", to: "d", unitsPerHr: 100 },
    ],
  });
  const r2 = P.resolveFlow(b2);
  // 100/hr in -> dismantle (1->2) emits 200/hr -> 100/hr per lane -> 200/hr
  // finished. cyclesPerFinished: Cut 100/200 = 0.5, each lane 0.5. Effective
  // times: 0.5*20 = 10 s, 0.5*30 = 15 s -> bottleneck Lane A (earliest tie).
  const m2 = P.metrics(b2);
  check("dismantle-then-split: 100/hr -> 200/hr finished; lanes carry 100/hr each",
    r2.ok && approx(r2.finishedPerHr, 200) && approx(r2.nodes["a"].inPerHr, 100) && approx(r2.nodes["b"].inPerHr, 100),
    "finished=" + r2.finishedPerHr);
  check("dismantle-then-split gozinto: cyclesPerFinished 0.5/0.5/0.5, bottleneck Lane A at 15 s -> 240/hr",
    approx(r2.nodes["x"].cyclesPerFinished, 0.5) && approx(r2.nodes["a"].cyclesPerFinished, 0.5) &&
    !!m2 && m2.bottleneck.opId === "a" && approx(m2.throughputPerHr, 240),
    m2 ? "tp=" + m2.throughputPerHr + " bottleneck=" + m2.bottleneck.name : "null");
  // The deterministic 50/50 dispatcher: two IDENTICAL lanes end up with
  // IDENTICAL measured utilisation (no RNG, exact alternation).
  const sim2 = P.simulateFlow(b2);
  check("identical 50/50 branches measure IDENTICAL utilisation (deterministic dispatcher, no RNG)",
    sim2.utilisation["a"] === sim2.utilisation["b"] && sim2.finished > 0,
    "a=" + sim2.utilisation["a"] + " b=" + sim2.utilisation["b"] + " finished=" + sim2.finished);
}

/* ---- 7. The token sim on the demo network ------------------------------- */
{
  const s1 = P.simulateFlow(block);
  const s2 = P.simulateFlow(block);
  check("network sim is DETERMINISTIC (byte-identical across runs)",
    JSON.stringify(s1) === JSON.stringify(s2), "finished=" + s1.finished);
  check("measured throughput agrees with the analytical bottleneck rate (112.5/hr)",
    Math.abs(s1.throughputPerHr - 112.5) / 112.5 < 0.06, "sim=" + s1.throughputPerHr.toFixed(2));
  check("WIP obeys Little's Law on the network (L = lambda*W within tolerance)",
    s1.little.residualRel < 0.1,
    "L=" + s1.little.L + " lambda=" + s1.little.lambda + " W=" + s1.little.W + " residualRel=" + s1.little.residualRel);
  check("measured utilisation shows the split: bottleneck QA deep ~1, QA fast clearly partial",
    s1.utilisation["op-qad"] >= 0.95 && s1.utilisation["op-qaf"] >= 0.55 && s1.utilisation["op-qaf"] <= 0.9,
    "qad=" + s1.utilisation["op-qad"] + " qaf=" + s1.utilisation["op-qaf"]);
  check("simulate() routes a multi-way block to the network sim (same bytes)",
    JSON.stringify(P.simulate(block)) === JSON.stringify(s1));
}

/* ---- 8. COLLAPSE TO BASE CASE: existing scenarios byte-identical -------- */
for (const k of ["assembly-line", "machining-shop", "general-factory"]) {
  const gen = G.generateFactoryLayout(k, { seed: 7 });
  const lb = P.derive(gen);
  const legacy = P.simulate(lb);
  const viaNet = P.simulateFlow(lb);
  const lm = P.metrics(lb);
  check(k + ": derived chain is NOT multiway; network sim == legacy sim BYTE-IDENTICALLY",
    P.isMultiway(lb) === false && JSON.stringify(legacy) === JSON.stringify(viaNet),
    "finished=" + legacy.finished);
  check(k + ": chain metrics carry NO `flow` key and the serialize carries NO `ratio` (bytes unchanged)",
    lm.flow === undefined && JSON.stringify(P.sanitize(lb)).indexOf('"ratio"') === -1 &&
    JSON.stringify(lm) === JSON.stringify(P.metrics(lb)));
}

/* ---- 9. VALIDATION: friendly rejection, never a guess ------------------- */
{
  const badSum = JSON.parse(JSON.stringify(block));
  badSum.routing[1].ratio = 0.5; badSum.routing[2].ratio = 0.6; // 1.1
  const v1 = P.validateFlow(badSum);
  check("ratios that sum to 1.1 are REJECTED with a friendly message naming the split",
    !v1.ok && v1.errors.length === 1 && /sum to 1\.1, not 1/.test(v1.errors[0]) && /Machining/.test(v1.errors[0]),
    v1.errors[0]);
  check("invalid ratios: metrics() -> null and simulateFlow() throws the SAME friendly message",
    P.metrics(badSum) === null && (function () {
      try { P.simulateFlow(badSum); return false; } catch (e) { return /sum to 1\.1/.test(e.message); }
    })());

  const noRatio = JSON.parse(JSON.stringify(block));
  delete noRatio.routing[1].ratio;
  const v2 = P.validateFlow(noRatio);
  check("a split arc WITHOUT a ratio is rejected ('needs a ratio', naming the arc)",
    !v2.ok && v2.errors.some((e) => /needs a ratio/.test(e) && /QA fast lane/.test(e)),
    v2.errors.join(" | "));

  const loop = JSON.parse(JSON.stringify(block));
  loop.routing.push({ from: "op-pack", to: "op-mach", unitsPerHr: 10, ratio: 0.5 });
  const v3 = P.validateFlow(loop);
  check("a routing cycle is rejected ('loops back')",
    !v3.ok && v3.errors.some((e) => /loops back/.test(e)), v3.errors.join(" | "));

  const dup = JSON.parse(JSON.stringify(block));
  dup.routing.push({ from: "op-src", to: "op-mach", unitsPerHr: 5 });
  const v4 = P.validateFlow(dup);
  check("a duplicated from-to arc is rejected ('two routing arcs')",
    !v4.ok && v4.errors.some((e) => /two routing arcs/.test(e)), v4.errors.join(" | "));

  const linear = P.derive(G.generateFactoryLayout("assembly-line", { seed: 7 }));
  const v5 = P.validateFlow(linear);
  check("a plain chain always validates ok (multiway false, no errors - legacy path untouched)",
    v5.ok === true && v5.multiway === false && v5.errors.length === 0);
}

/* ---- 10. Honesty -------------------------------------------------------- */
check("flow metrics keep the modelled/deterministic/NOT-a-DES honesty and name the proportional-flow network",
  m.honesty === P.HONESTY && /proportional-flow network/.test(m.basis) &&
  /Theory of Constraints/.test(m.basis) && /Little's Law/.test(m.basis) &&
  /NOT a validated discrete-event/i.test(P.HONESTY));

/* ---- sample transcript, for the record --------------------------------- */
console.log("");
console.log("Demo network (source -> Machining -> 60/40 QA split -> merge -> Pack -> drain, offered 100/hr):");
console.log("  throughput " + m.throughputPerHr + "/hr, bottleneck " + m.bottleneck.name +
  " (" + m.bottleneck.effTimeSec + " s/unit), line eff " + (m.lineEfficiency * 100).toFixed(1) + "%");
console.log("  measured " + m.sim.measuredThroughputPerHr + "/hr over " + m.sim.windowSec + " s, WIP " +
  m.wip.toFixed(1) + ", lead " + m.leadTimeSec.toFixed(0) + " s, Little residual " + (m.little.residualRel * 100).toFixed(2) + "%");
console.log("  arcs: " + m.flow.arcs.map((a) => a.from + ">" + a.to + " " + Math.round(a.ratio * 100) + "% " + a.unitsPerHr + "/hr").join(", "));

console.log("");
console.log(failures === 0 ? "ALL FLOW-NETWORK CHECKS PASSED" : failures + " FLOW-NETWORK CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
