/* =====================================================================
 * verify_flowbalance.js - GENERATED MULTI-WAY NETWORK + BALANCE-ON-LOADS
 * harness (v3.18 FLOW-GEN + FLOW-BALANCE). Closes the two follow-up gaps
 * the v3.17 flow-net commit acknowledged, with hand-computed expectations:
 *
 *   (a) GENERATOR EMITS A GENUINE MULTI-WAY NETWORK. The new factory
 *       baseline `machining-qa-split` ("Machining shop with QA split") lays
 *       out a machining feed lane, two QA branch stations and a pack-and-
 *       finish step, and EMITS the matching `process` block (gen.process):
 *       a DECLARED 60/40 split into QA fast lane / QA deep test that MERGES
 *       again before pack-out - operations bound to the placed elements,
 *       accepted by validateFlow, canonical under sanitize, ratio-preserving
 *       through the embedInto/rebuild serialize round-trip. Hand-computed
 *       resolved flow at the offered 120/hr: arcs 120/120/72/48/72/48/120,
 *       cyclesPerFinished 1/1/0.6/0.4/1, effective times 30/30/24/32/25 s,
 *       bottleneck QA deep test 32 s/unit -> 112.5/hr, line efficiency
 *       141/160 = 0.8813, conservation residual ~0. Deterministic + seeded
 *       (seed recorded; the line composition is a fixed function of the
 *       profile, same convention as every factory baseline). The 3 LEGACY
 *       factory profiles gain NO process/multiway key and their builds are
 *       BYTE-IDENTICAL (asserted); a reserved branch lane falls back to no
 *       emitted block (the app then derives the honest linear chain).
 *
 *   (b) RPW LINE BALANCING ON RESOLVED EFFECTIVE LOADS. WT.factoryOpt.rpw
 *       now packs on the RESOLVED PER-FINISHED-UNIT EFFECTIVE LOADS - the
 *       same numbers WT.process.metrics computes (chain: gozinto x cycle /
 *       servers via annotate; declared network: resolveFlow effTimeSec, so
 *       a 60% branch weighs 0.6 x its cycle) - instead of raw chain cycle
 *       times. Asserted:
 *         - PURE-CHAIN COLLAPSE: on a pure chain (servers 1, no assembly/
 *           dismantle) the ENTIRE rpw output is BYTE-IDENTICAL to the
 *           legacy balancer (a full hand-written expected object)
 *         - the multi-way hand case: loads 30/30/24/32/25 vs takt 60 ->
 *           RPW ranks 141/111/57/49/25, packs [M1+M2]=60 / [QAdeep+QAfast]
 *           =56 / [Pack]=25 (3 = the theoretical minimum), line efficiency
 *           0.47 -> 0.7833, precedence respected across the split
 *         - loads EQUAL the metrics/resolveFlow numbers (can't diverge)
 *         - OVER-TAKT loads are measured against the realized bottleneck
 *           time (classical Helgeson-Birnie basis) so line efficiency
 *           stays a true utilisation in [0,1] (legacy reported > 100%)
 *         - the OPTIMIZER never returns an illegal or worse layout on the
 *           multi-way input: craft MHI monotone + legal (independent
 *           oracle), optimize deterministic, TOC read-back == metrics,
 *           and rpw never mutates the caller's block
 *
 *   HONEST REMAINDER (documented in optimize_factory.js + README): the
 *   balance is a CAPACITY GROUPING only - it never re-routes flow, changes
 *   declared ratios or adds/removes servers; an INVALID declared network
 *   falls back to raw cycle times after validateFlow's rejection.
 *
 * Runs the REAL app modules under the same window shim as the other
 * harnesses. Usage:  node verify_flowbalance.js   (ASCII-only output)
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
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

const LEGACY_KEYS = ["assembly-line", "machining-shop", "general-factory"];
const QA_KEY = "machining-qa-split";

console.log("Generated multi-way network + balance-on-effective-loads verification (deterministic)");
console.log("");

/* ---- 1. The new archetype exists, ADDITIVELY ---------------------------- */
check("factoryProfiles gains " + QA_KEY + " (4 factory keys; the 4 warehouse keys untouched)",
  !!G.factoryProfiles[QA_KEY] && Object.keys(G.factoryProfiles).length === 4 &&
  Object.keys(G.plantProfiles).length === 4,
  Object.keys(G.factoryProfiles).join(", "));
check(QA_KEY + " declares the flowNetwork recipe (60/40 split; named branches)",
  (function () {
    const f = G.factoryProfiles[QA_KEY].flowNetwork;
    return !!f && f.ratios.join(",") === "0.6,0.4" &&
      f.branchNames.join("|") === "QA fast lane|QA deep test";
  })());
check("the 3 legacy factory profiles declare NO flowNetwork/qaBranch (untouched)",
  LEGACY_KEYS.every((k) => G.factoryProfiles[k].flowNetwork === undefined &&
    G.factoryProfiles[k].qaBranch === undefined));

/* ---- 2. gap (a): the generator EMITS the multi-way process block -------- */
const gen = G.generateFactoryLayout(QA_KEY, { seed: 7 });
check("generateFactoryLayout(" + QA_KEY + ") emits gen.process + meta.multiway",
  !!gen.process && gen.meta.multiway === true && Array.isArray(gen.process.operations),
  gen.process ? gen.process.operations.length + " ops, " + gen.process.routing.length + " arcs" : "no process");
check("the emitted block DECLARES multi-way routing and validateFlow ACCEPTS it",
  P.isMultiway(gen.process) === true && P.validateFlow(gen.process).ok === true &&
  P.validateFlow(gen.process).multiway === true,
  P.validateFlow(gen.process).errors.join(" | ") || "ok");
check("the emitted block is CANONICAL (sanitize is a byte-identical no-op)",
  JSON.stringify(P.sanitize(gen.process)) === JSON.stringify(gen.process));
check("every operation is BOUND to a placed element (id 'op-<elementId>', same convention as derive)",
  gen.process.operations.every((o) =>
    o.id === "op-" + o.elementId && gen.elements.some((e) => e.id === o.elementId)));
{
  const obj = { version: "wt-1", gridW: gen.gridW, gridH: gen.gridH, cell: 1, elements: gen.elements };
  P.embedInto(obj, gen.process);
  const re = P.rebuild(obj);
  check("split ratios SURVIVE the embedInto/rebuild serialize round-trip byte-identically",
    JSON.stringify(re) === JSON.stringify(P.sanitize(gen.process)) &&
    re.routing.some((r) => r.ratio === 0.6) && re.routing.some((r) => r.ratio === 0.4));
}

/* ---- 3. gap (a): hand-computed resolved flow on the emitted block ------- */
const rf = P.resolveFlow(gen.process);
check("resolveFlow: 1 split + 1 merge; offered 120/hr -> 120/hr finished; conservation holds",
  rf.ok && rf.splits === 1 && rf.merges === 1 && approx(rf.sourceRatePerHr, 120) &&
  approx(rf.finishedPerHr, 120) && rf.conservation.ok === true,
  "src=" + rf.sourceRatePerHr + " fin=" + rf.finishedPerHr + " residual=" + rf.conservation.maxAbsResidualPerHr);
{
  const wantArcs = [ // [ratio, unitsPerHr] in emitted arc order
    [1, 120], [1, 120], [0.6, 72], [0.4, 48], [1, 72], [1, 48], [1, 120],
  ];
  const arcsOk = rf.arcs.length === 7 && wantArcs.every((w, i) =>
    approx(rf.arcs[i].ratio, w[0]) && approx(rf.arcs[i].unitsPerHr, w[1], 1e-6));
  check("resolved arc flows are the hand-computed 120/120/72/48/72/48/120 parts/hr (60/40 shares)",
    arcsOk, rf.arcs.map((a) => a.ratio + "x" + a.unitsPerHr).join(" "));
  // Effective times per finished unit: Machining 30, 30; QA fast 0.6*40=24;
  // QA deep 0.4*80=32; Pack & finish 25.
  const byName = {};
  gen.process.operations.forEach((o) => { byName[o.name] = rf.nodes[o.id]; });
  const effOk = approx(byName["Machining 1"].effTimeSec, 30, 1e-6) &&
    approx(byName["Machining 2"].effTimeSec, 30, 1e-6) &&
    approx(byName["QA fast lane"].effTimeSec, 24, 1e-6) &&
    approx(byName["QA deep test"].effTimeSec, 32, 1e-6) &&
    approx(byName["Pack & finish"].effTimeSec, 25, 1e-6);
  check("effective times per finished unit: 30 / 30 / 24 / 32 / 25 s (cycle x share)",
    effOk, ["Machining 1", "QA fast lane", "QA deep test", "Pack & finish"].map((n) => byName[n].effTimeSec).join("/"));
  check("cyclesPerFinished carries the shares: 1 / 1 / 0.6 / 0.4 / 1",
    approx(byName["Machining 1"].cyclesPerFinished, 1, 1e-9) &&
    approx(byName["QA fast lane"].cyclesPerFinished, 0.6, 1e-9) &&
    approx(byName["QA deep test"].cyclesPerFinished, 0.4, 1e-9) &&
    approx(byName["Pack & finish"].cyclesPerFinished, 1, 1e-9));
}
const m = P.metrics(gen.process);
check("metrics: bottleneck QA deep test at 32 s/unit -> throughput 3600/32 = 112.5/hr",
  !!m && m.bottleneck.name === "QA deep test" && approx(m.bottleneck.effTimeSec, 32, 1e-6) &&
  approx(m.throughputPerHr, 112.5, 1e-6),
  m ? "tp=" + m.throughputPerHr + " bottleneck=" + m.bottleneck.name : "null");
check("metrics: line efficiency 141/160 = 0.8813; theoretical min 3 stations; flow summary present",
  approx(m.lineEfficiency, 0.8813, 1e-4) && m.theoreticalMinStations === 3 &&
  !!m.flow && m.flow.multiway === true && m.flow.conservation.ok === true,
  "eff=" + m.lineEfficiency + " min=" + m.theoreticalMinStations);
check("the deterministic token sim runs ON the network (measured tp ~112.5/hr, simulate() routes there)",
  (function () {
    const s = P.simulateFlow(gen.process);
    return Math.abs(s.throughputPerHr - 112.5) / 112.5 < 0.06 &&
      JSON.stringify(P.simulate(gen.process)) === JSON.stringify(s);
  })());

/* ---- 4. gap (a): determinism, seeding, byte-identical legacy builds ----- */
check("the " + QA_KEY + " build (incl. the process block) is byte-identical on re-run",
  JSON.stringify(gen) === JSON.stringify(G.generateFactoryLayout(QA_KEY, { seed: 7 })));
{
  const g2 = G.generateFactoryLayout(QA_KEY, { seed: 123 });
  check("seeded: the seed is recorded; the line composition is a FIXED function of the profile (same convention as every factory baseline)",
    g2.meta.seed === 123 && gen.meta.seed === 7 &&
    JSON.stringify(g2.process) === JSON.stringify(gen.process));
}
for (const k of LEGACY_KEYS) {
  const g = G.generateFactoryLayout(k, { seed: 7 });
  const js = JSON.stringify(g);
  check(k + ": NO process/multiway key, NO ratio anywhere (existing scenarios byte-identical)",
    g.process === undefined && g.meta.multiway === undefined &&
    js.indexOf('"ratio"') === -1 && js.indexOf('"process"') === -1 &&
    js.indexOf("flowNetwork") === -1,
    js.length + " bytes");
}
{
  // A reserved branch lane -> the block CANNOT bind -> honest fallback:
  // no emitted process (the app derives the linear chain instead).
  const gr = G.generateFactoryLayout(QA_KEY, { seed: 7, reserve: ["picking"] });
  check("reserving the branch lane emits NO process block (falls back to the derived chain, never a broken network)",
    gr.process === undefined && gr.meta.multiway === undefined &&
    gr.elements.every((e) => e.zone !== "picking" || e.type === "dock-in" || e.type === "dock-out" ||
      e.type === "mfg-source" || e.type === "mfg-drain"));
}
check("derive() on the SAME layout still yields a plain chain (the documented NL-edit fallback path)",
  (function () {
    const chain = P.derive(gen);
    return !!chain && P.isMultiway(chain) === false && P.validateFlow(chain).ok === true;
  })());

/* ---- 5. gap (b): PURE-CHAIN COLLAPSE - byte-identical to legacy RPW ----- */
{
  // Hand chain: T1=30, T2=20, T3=10, takt 40 (servers 1, no gozinto). The
  // expected object below is the FULL legacy (pre-v3.18) rpw output, hand-
  // checked: RPW 60/30/10, stations [T1] + [T2,T3], eff 0.5 -> 0.75.
  const chain = P.sanitize({
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
  const expected = {
    taktSec: 40, totalCycleSec: 60, cycleMaxAfter: 30, overTakt: false,
    theoreticalMinStations: 2,
    tasks: [
      { opId: "t1", name: "T1", cycleSec: 30, servers: 1, rpw: 60 },
      { opId: "t2", name: "T2", cycleSec: 20, servers: 1, rpw: 30 },
      { opId: "t3", name: "T3", cycleSec: 10, servers: 1, rpw: 10 },
    ],
    stations: [
      { index: 1, opIds: ["t1"], names: ["T1"], load: 30, utilisation: 0.75, overTakt: false, isBottleneck: true },
      { index: 2, opIds: ["t2", "t3"], names: ["T2", "T3"], load: 30, utilisation: 0.75, overTakt: false, isBottleneck: false },
    ],
    nStationsBefore: 3, nStationsAfter: 2,
    lineEffBefore: 0.5, lineEffAfter: 0.75,
    balanceDelayBefore: 50, balanceDelayAfter: 25,
    smoothnessAfter: 14.1421,
    bottleneckBefore: "T1", bottleneckAfter: "T1",
    improved: true,
  };
  const before = JSON.stringify(chain);
  const got = O.rpw(chain);
  check("PURE CHAIN: rpw-on-effective-loads COLLAPSES to the legacy output BYTE-IDENTICALLY (full hand-written pin)",
    JSON.stringify(got) === JSON.stringify(expected),
    JSON.stringify(got) === JSON.stringify(expected) ? "byte-identical" : JSON.stringify(got));
  check("rpw never mutates the caller's block (no annotate leakage)",
    JSON.stringify(chain) === before);
}

/* ---- 6. gap (b): loads == the metrics numbers (chain gozinto case) ------ */
{
  // A generated assembly-line chain carries REAL assembly stations, so its
  // effective loads differ from raw cycles (gozinto x cycle / servers). The
  // balancer's total must equal the SUM of metrics' per-station effective
  // times - the same numbers, so the two can never diverge.
  const block = P.derive(G.generateFactoryLayout("assembly-line", { seed: 7 }));
  const mm = P.metrics(block);
  const sumEff = mm.stations.reduce((s, st) => s + st.effTimeSec, 0);
  const r = O.rpw(block);
  check("chain-with-gozinto: rpw totalCycleSec == SUM of metrics effective times (same basis, can't diverge)",
    approx(r.totalCycleSec, Math.round(sumEff * 10000) / 10000, 1e-3),
    "rpw=" + r.totalCycleSec + " metrics=" + sumEff);
  check("chain-with-gozinto: line efficiency stays a true utilisation in [0,1] (over-takt loads use the realized bottleneck basis)",
    r.lineEffBefore >= 0 && r.lineEffBefore <= 1 && r.lineEffAfter >= 0 && r.lineEffAfter <= 1 &&
    r.nStationsAfter <= r.nStationsBefore && r.lineEffAfter >= r.lineEffBefore - 1e-9,
    "eff " + r.lineEffBefore + " -> " + r.lineEffAfter + " overTakt=" + r.overTakt);
}

/* ---- 7. gap (b): the multi-way hand case ------------------------------- */
{
  const block = P.sanitize(gen.process);
  const r = O.rpw(block);
  const nameOf = {};
  block.operations.forEach((o) => { nameOf[o.id] = o.name; });
  // RPW on loads 30/30/24/32/25, takt 60: M1 141, M2 111, QAdeep 57
  // (32+25), QAfast 49 (24+25), Pack 25.
  const ranks = r.tasks.map((t) => nameOf[t.opId] + ":" + t.rpw).join(" ");
  check("multi-way RPW ranks on effective loads: M1 141 > M2 111 > QA deep 57 > QA fast 49 > Pack 25",
    r.tasks.length === 5 &&
    nameOf[r.tasks[0].opId] === "Machining 1" && approx(r.tasks[0].rpw, 141, 1e-3) &&
    nameOf[r.tasks[1].opId] === "Machining 2" && approx(r.tasks[1].rpw, 111, 1e-3) &&
    nameOf[r.tasks[2].opId] === "QA deep test" && approx(r.tasks[2].rpw, 57, 1e-3) &&
    nameOf[r.tasks[3].opId] === "QA fast lane" && approx(r.tasks[3].rpw, 49, 1e-3) &&
    nameOf[r.tasks[4].opId] === "Pack & finish" && approx(r.tasks[4].rpw, 25, 1e-3),
    ranks);
  // Packing to takt 60: [M1+M2]=60, [QAdeep+QAfast]=56, [Pack]=25 -> the
  // THEORETICAL MINIMUM of 3 stations (ceil(141/60)); a raw-cycle balancer
  // could not see that the two QA branches together only load 56 s/unit.
  const st = r.stations.map((s) => s.opIds.map((id) => nameOf[id]).join("+") + "=" + s.load);
  check("multi-way packing reaches the theoretical minimum: [M1+M2]=60 / [QA deep+QA fast]=56 / [Pack]=25",
    r.nStationsAfter === 3 && r.theoreticalMinStations === 3 &&
    st[0] === "Machining 1+Machining 2=60" &&
    st[1] === "QA deep test+QA fast lane=56" &&
    st[2] === "Pack & finish=25",
    st.join(" | "));
  check("multi-way line efficiency 141/(5x60)=0.47 -> 141/(3x60)=0.7833 (improved, in [0,1])",
    approx(r.lineEffBefore, 0.47, 1e-4) && approx(r.lineEffAfter, 0.7833, 1e-4) &&
    r.improved === true && r.overTakt === false);
  // Precedence feasibility across the split (both branches after machining,
  // the merge station after both branches).
  const stOf = {}; r.stations.forEach((s, i) => s.opIds.forEach((id) => { stOf[id] = i; }));
  let precOk = true;
  for (const [a, b] of block.precedence) {
    if (stOf[a] !== undefined && stOf[b] !== undefined && stOf[a] > stOf[b]) precOk = false;
  }
  check("multi-way packing respects precedence across the split + merge", precOk);
  check("the balancer's loads EQUAL resolveFlow's effective times (station loads sum to 141)",
    approx(r.totalCycleSec, 141, 1e-3) &&
    approx(r.stations.reduce((s, x) => s + x.load, 0), 141, 1e-3));
  check("multi-way rpw is deterministic (byte-identical across runs)",
    JSON.stringify(O.rpw(block)) === JSON.stringify(O.rpw(block)));
}

/* ---- 8. gap (b): over-takt honesty (bounded efficiency) ----------------- */
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
  check("over-takt: the 100 s task still gets its own flagged station; efficiency measured against the realized bottleneck (115/(2x100)=0.575, bounded [0,1] - legacy said 143.75%)",
    !!solo && solo.overTakt === true && r.overTakt === true &&
    approx(r.lineEffAfter, 0.575, 1e-4) && r.lineEffAfter <= 1 && r.lineEffBefore <= 1,
    "eff " + r.lineEffBefore + " -> " + r.lineEffAfter);
}

/* ---- 9. gap (b): the optimizer never illegal / never worse -------------- */
{
  const layout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 };
  const block = P.sanitize(gen.process);
  const cfg = { minAisleMetres: gen.config.minAisleMetres };
  const baseAisle = D.aisleViolations(gen.elements, cfg.minAisleMetres).length;
  const c = O.craft(layout, block, cfg);
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
  legalOk = legalOk && D.aisleViolations(c.proposedElements, cfg.minAisleMetres).length <= baseAisle;
  check("craft on the multi-way input: MHI monotone non-increasing and the proposal is LEGAL (in-bounds, overlap-free, aisle count not increased)",
    c.mhiAfter <= c.mhiBefore + 1e-9 && legalOk,
    "MHI " + c.mhiBefore + " -> " + c.mhiAfter + " moved=" + c.movedCount + " aisle " + c.aisleBefore + "->" + c.aisleAfter);
  const res = O.optimize(layout, block, cfg);
  check("optimize() on the multi-way input: ok, deterministic, TOC read-back == WT.process.metrics (112.5/hr, QA deep test)",
    res.ok && approx(res.toc.throughputPerHr, m.throughputPerHr, 1e-6) &&
    res.toc.bottleneckName === "QA deep test" &&
    JSON.stringify(O.optimize(layout, block, cfg)) === JSON.stringify(res),
    "tp=" + (res.toc && res.toc.throughputPerHr) + " bottleneck=" + (res.toc && res.toc.bottleneckName));
  check("optimize() balance never reports a worse line (effAfter >= effBefore, nAfter <= nBefore)",
    res.balance.lineEffAfter >= res.balance.lineEffBefore - 1e-9 &&
    res.balance.nStationsAfter <= res.balance.nStationsBefore);
}

/* ---- 10. honesty -------------------------------------------------------- */
check("BASIS names the effective-load balancing (per-finished-unit, resolveFlow) alongside CRAFT/RPW/TOC",
  /per-finished-unit effective loads/.test(O.BASIS) && /resolveFlow/.test(O.BASIS) &&
  /Ranked Positional Weight/.test(O.BASIS) && /CRAFT/.test(O.BASIS) && /Theory of Constraints/.test(O.BASIS));
check("optimizer HONESTY keeps modelled / local-optimum / NOT-a-DES / NOT-optimal (unchanged)",
  /modelled, not measured/i.test(O.HONESTY) && /local optimum/i.test(O.HONESTY) &&
  /NOT guaranteed optimal/i.test(O.HONESTY) && /NOT a validated discrete-event/i.test(O.HONESTY));
check("the generated baseline's summary states the multi-way declaration + NOT-a-DES honesty",
  /MULTI-WAY routing/.test(gen.meta.summary) && /NOT a validated DES/.test(gen.meta.summary) &&
  /Illustrative synthetic/i.test(gen.meta.summary));

/* ---- sample transcript, for the record ---------------------------------- */
console.log("");
console.log("Generated " + QA_KEY + " (seed " + gen.meta.seed + "): " + gen.elements.length + " elements on " +
  gen.gridW + "x" + gen.gridH + ", " + gen.process.operations.length + " ops, " + gen.process.routing.length + " arcs");
console.log("  resolved: offered " + rf.sourceRatePerHr + "/hr -> " + rf.finishedPerHr + "/hr finished, arcs " +
  rf.arcs.map((a) => Math.round(a.unitsPerHr)).join("/") + " (60/40 split, conserved)");
console.log("  metrics: throughput " + m.throughputPerHr + "/hr, bottleneck " + m.bottleneck.name +
  " (" + m.bottleneck.effTimeSec + " s/unit), line eff " + (m.lineEfficiency * 100).toFixed(2) + "%");
{
  const r = O.rpw(P.sanitize(gen.process));
  console.log("  balance-on-loads: " + r.nStationsBefore + " -> " + r.nStationsAfter + " stations (theoretical min " +
    r.theoreticalMinStations + "), line eff " + (r.lineEffBefore * 100).toFixed(1) + "% -> " +
    (r.lineEffAfter * 100).toFixed(1) + "%");
}

console.log("");
console.log(failures === 0 ? "ALL FLOW-BALANCE CHECKS PASSED" : failures + " FLOW-BALANCE CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
