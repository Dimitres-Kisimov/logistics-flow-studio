/* =====================================================================
 * verify_process.js - FACTORY PROCESS model + LINE SIMULATION harness
 * (v2.7 FACTORY-C). Proves the NEW process.js code path:
 *
 *   The `process` DATA MODEL (backward-compatible wt-1 extension)
 *     - a generated FACTORY has a VALID process block: version wt-proc-1,
 *       operations each BOUND to a placed mfg-* element by id, a linear
 *       precedence chain, a from-to routing list, shiftSec + demandPerShift
 *     - derive() is DETERMINISTIC (byte-identical on re-run)
 *     - a WAREHOUSE layout has NO process block (derive -> null) and
 *       embedInto() is a strict no-op (serialize stays BYTE-IDENTICAL)
 *     - a process ROUND-TRIPS through the embedInto()/rebuild() serialize
 *       path (the SAME path app.js serialize()/deserialize() use)
 *
 *   The deterministic LINE SIMULATION + honest METRICS
 *     - metrics() + simulate() are DETERMINISTIC (byte-identical metrics)
 *     - THROUGHPUT = 3600 / bottleneck effective cycle (Theory of Constraints)
 *     - per-station UTILISATION in [0,1] (analytical AND sim-measured)
 *     - WIP obeys LITTLE'S LAW within tolerance (L = lambda * W)
 *     - line efficiency in [0,1]; theoretical-min-stations sane
 *     - REAL assembly (combine `inputs` -> 1) and dismantle (1 -> `outputs`)
 *       behaviour changes the gozinto multiplier (cyclesPerFinished) AND the
 *       sim flows/conserves tokens; the sim measured throughput agrees with
 *       the analytical bottleneck rate
 *     - editing a cycle time MOVES the bottleneck / changes throughput
 *     - honesty labels present (modelled / deterministic / teaching-scale /
 *       Little's Law / TOC / NOT a validated DES / NOT CAD-BIM / NOT a cert)
 *
 * Runs the REAL app modules under the same window shim the other harnesses
 * use. Everything is deterministic. Usage:  node verify_process.js
 * ASCII-only output. Exit 0 = all checks pass.
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
function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.max(1e-9, Math.abs(b)); }

const FACTORY_KEYS = ["assembly-line", "machining-shop", "general-factory"];

console.log("Factory process model + line simulation verification (deterministic)");
console.log("");

/* ---- 1. Module surface -------------------------------------------------- */
check("WT.process exposes derive/metrics/simulate/embedInto/rebuild/sanitize/annotate",
  P && ["derive", "metrics", "simulate", "embedInto", "rebuild", "sanitize", "annotate"].every((k) => typeof P[k] === "function"));
check("WT.process.VERSION is wt-proc-1", P.VERSION === "wt-proc-1", P.VERSION);

/* ---- 2. A generated factory has a VALID process block ------------------- */
const builds = {};
for (const k of FACTORY_KEYS) {
  const gen = G.generateFactoryLayout(k, { seed: 7 });
  builds[k] = gen;
  const block = P.derive(gen);
  const elemIds = {};
  gen.elements.forEach((e) => { elemIds[e.id] = 1; });
  const boundOk = !!block && block.operations.every((o) => elemIds[o.elementId]);
  const hasSrc = !!block && block.operations.some((o) => o.kind === "source");
  const hasSink = !!block && block.operations.some((o) => o.kind === "sink");
  const stations = block ? block.operations.filter((o) => ["station", "parallel", "assembly", "dismantle"].indexOf(o.kind) !== -1) : [];
  check(k + ": derive() builds a wt-proc-1 block bound to placed mfg-* elements",
    !!block && block.version === "wt-proc-1" && boundOk && hasSrc && hasSink && stations.length >= 1,
    block ? "ops=" + block.operations.length + " stations=" + stations.length + " bound=" + boundOk : "null");
  // linear precedence chain: n-1 arcs, connected source..sink
  const chainOk = !!block && block.precedence.length === block.operations.length - 1;
  check(k + ": precedence is a connected linear chain (n-1 arcs) + routing from-to present",
    chainOk && block.routing.length === block.precedence.length,
    block ? "prec=" + block.precedence.length + " routing=" + block.routing.length : "null");
  check(k + ": carries shiftSec + demandPerShift (takt basis)",
    !!block && block.shiftSec > 0 && block.demandPerShift > 0,
    block ? "shift=" + block.shiftSec + " demand=" + block.demandPerShift : "null");
  // distances are NOT stored anywhere in the block (derived from positions)
  check(k + ": stores NO distances (derived from integer-metre positions)",
    !!block && !/distance|"x"|"y"|"cx"|"cy"/.test(JSON.stringify(block)));
  // determinism of derive
  check(k + ": derive() is byte-identical on re-run (deterministic)",
    JSON.stringify(P.derive(gen)) === JSON.stringify(P.derive(gen)));
}

/* ---- 3. Warehouse layout: NO process + byte-identical serialize --------- */
const wkey = Object.keys(G.plantProfiles)[0];
const wh = G.generateLayout(wkey, { seed: 3 });
check("a WAREHOUSE layout has NO process block (derive -> null)", P.derive(wh) === null, wkey);
// serialize byte-identical: a plain serialize-shaped object with a null
// process block is left untouched by embedInto (exactly app.js serialize()).
const whObj = { version: "wt-1", gridW: wh.gridW, gridH: wh.gridH, cell: 1, elements: wh.elements, config: wh.config };
const whBefore = JSON.stringify(whObj);
P.embedInto(whObj, P.derive(wh)); // derive is null -> no-op
check("embedInto(obj, null) leaves a warehouse serialize BYTE-IDENTICAL (no `process` key)",
  JSON.stringify(whObj) === whBefore && whObj.process === undefined);

/* ---- 4. Metrics: throughput, utilisation, line efficiency, determinism -- */
for (const k of FACTORY_KEYS) {
  const block = P.derive(builds[k]);
  const m1 = P.metrics(block);
  const m2 = P.metrics(block);
  check(k + ": metrics() is DETERMINISTIC (byte-identical across runs)",
    JSON.stringify(m1) === JSON.stringify(m2));
  // throughput = 3600 / bottleneck effective cycle (TOC)
  const expected = 3600 / m1.bottleneck.effTimeSec;
  check(k + ": throughput = 3600 / bottleneck effective cycle (Theory of Constraints)",
    approx(m1.throughputPerHr, expected, 1e-4),
    "throughput=" + m1.throughputPerHr + " 3600/" + m1.bottleneck.effTimeSec + "=" + expected.toFixed(4) + " bottleneck=" + m1.bottleneck.name);
  // utilisation in [0,1] for every station (analytical) with the bottleneck at 1
  const utilOk = m1.stations.every((s) => s.utilisation >= 0 && s.utilisation <= 1);
  const bottleneckAtOne = m1.stations.some((s) => s.isBottleneck && approx(s.utilisation, 1, 1e-6));
  check(k + ": every station utilisation in [0,1]; the bottleneck runs at 100%",
    utilOk && bottleneckAtOne,
    "range " + Math.min.apply(null, m1.stations.map((s) => s.utilisation)) + ".." + Math.max.apply(null, m1.stations.map((s) => s.utilisation)));
  // sim-measured utilisation in [0,1] too
  const simUtil = Object.keys(m1.sim.utilisation).map((id) => m1.sim.utilisation[id]);
  check(k + ": sim-measured utilisation (busy/available) in [0,1]",
    simUtil.every((u) => u >= 0 && u <= 1), "range " + Math.min.apply(null, simUtil) + ".." + Math.max.apply(null, simUtil));
  // line efficiency in [0,1]; theoretical min <= used or explained
  check(k + ": line efficiency in [0,1]; balance delay = (1-eff); theoretical-min-stations >= 1",
    m1.lineEfficiency >= 0 && m1.lineEfficiency <= 1 && m1.theoreticalMinStations >= 1 &&
    approx(m1.balanceDelayPct, (1 - m1.lineEfficiency) * 100, 1e-3),
    "eff=" + m1.lineEfficiency + " minStations=" + m1.theoreticalMinStations + " used=" + m1.stationsUsed);
}

/* ---- 5. Little's Law + sim determinism + sim vs analytical throughput --- */
for (const k of FACTORY_KEYS) {
  const block = P.derive(builds[k]);
  const s1 = P.simulate(block);
  const s2 = P.simulate(block);
  check(k + ": line simulation is DETERMINISTIC (byte-identical metrics across runs)",
    JSON.stringify(s1) === JSON.stringify(s2), "finished=" + s1.finished);
  // Little's Law: L = lambda * W within tolerance (rigorous token-population)
  check(k + ": WIP obeys Little's Law (L = lambda*W) within tolerance",
    s1.little.residualRel < 0.1,
    "L=" + s1.little.L + " lambda=" + s1.little.lambda + " W=" + s1.little.W + " predictedL=" + s1.little.predictedL + " residualRel=" + s1.little.residualRel);
  // sim measured throughput agrees with the analytical bottleneck rate
  const m = P.metrics(block);
  check(k + ": sim measured throughput agrees with the analytical bottleneck rate",
    approx(s1.throughputPerHr, m.throughputPerHr, 0.06),
    "sim=" + s1.throughputPerHr.toFixed(2) + " analytical=" + m.throughputPerHr.toFixed(2));
}

/* ---- 6. Process round-trips through the serialize path ------------------ */
{
  const block = P.derive(builds["machining-shop"]);
  const obj = { version: "wt-1", elements: builds["machining-shop"].elements };
  P.embedInto(obj, block);
  const rebuilt = P.rebuild(obj);
  check("a process round-trips through embedInto()/rebuild() (the app serialize path)",
    !!rebuilt && JSON.stringify(P.sanitize(block)) === JSON.stringify(rebuilt));
  // idempotent: re-embed of the rebuilt is byte-identical
  const obj2 = {}; P.embedInto(obj2, rebuilt);
  check("serialize round-trip is idempotent (embed(rebuild(x)) == embed(x))",
    JSON.stringify(obj2.process) === JSON.stringify(obj.process));
  // sanitize drops unknown keys -> forward-compatible
  const dirty = JSON.parse(JSON.stringify(obj.process));
  dirty.futureKey = { anything: 1 };
  dirty.operations[0].unknown = "x";
  const clean = P.sanitize(dirty);
  check("sanitize() drops unknown keys (forward-compatible)",
    clean.futureKey === undefined && clean.operations[0].unknown === undefined &&
    JSON.stringify(clean) === JSON.stringify(P.sanitize(obj.process)));
}

/* ---- 7. REAL assembly (N->1) + dismantle (1->N) in the flow ------------- */
{
  // Assembly gozinto: a station UPSTREAM of an assembly(inputs=2) must run 2
  // cycles per finished unit (it feeds two parts into each join).
  const layA = { elements: [
    { id: "s", type: "mfg-source", x: 0, y: 0, w: 2, d: 2, zone: "receiving" },
    { id: "a", type: "mfg-station", x: 4, y: 0, w: 3, d: 2, zone: "storage" },
    { id: "j", type: "mfg-assembly", x: 9, y: 0, w: 4, d: 3, zone: "picking" },
    { id: "d", type: "mfg-drain", x: 15, y: 0, w: 2, d: 2, zone: "shipping" },
  ] };
  const bA = P.derive(layA);
  const annA = P.annotate(bA);
  const upA = annA.stations.find((o) => o.kind === "station");
  check("assembly (combine inputs->1): the upstream station runs `inputs` cycles per finished unit (gozinto)",
    upA && approx(upA._cyclesPerFinished, 2, 1e-9), upA ? "cyclesPerFinished=" + upA._cyclesPerFinished : "n/a");

  // Dismantle gozinto: a station DOWNSTREAM of a dismantle(outputs=2) runs
  // 0.5 cycles per finished unit (one input split yields two downstream).
  const layD = { elements: [
    { id: "s", type: "mfg-source", x: 0, y: 0, w: 2, d: 2, zone: "receiving" },
    { id: "x", type: "mfg-dismantle", x: 4, y: 0, w: 4, d: 3, zone: "storage" },
    { id: "b", type: "mfg-station", x: 10, y: 0, w: 3, d: 2, zone: "picking" },
    { id: "d", type: "mfg-drain", x: 16, y: 0, w: 2, d: 2, zone: "shipping" },
  ] };
  const bD = P.derive(layD);
  const annD = P.annotate(bD);
  const dis = annD.stations.find((o) => o.kind === "dismantle");
  const downD = annD.stations.find((o) => o.kind === "station");
  // A dismantle 1->outputs makes each input part split into `outputs`
  // independent finished units, so the dismantle op runs only 1/outputs
  // cycles per finished unit while its downstream station runs 1 (per part).
  check("dismantle (split 1->outputs): the dismantle op runs 1/outputs cycles per finished unit (gozinto)",
    dis && approx(dis._cyclesPerFinished, 0.5, 1e-9) && downD && approx(downD._cyclesPerFinished, 1, 1e-9),
    dis ? "dismantle=" + dis._cyclesPerFinished + " downstream=" + (downD && downD._cyclesPerFinished) : "n/a");

  // The token sim actually flows/conserves through assembly + dismantle
  // without throwing and produces finished units (real combine/split flow).
  const simA = P.simulate(bA);
  const simD = P.simulate(bD);
  check("the line sim flows tokens through REAL assembly + dismantle (finished > 0, Little holds)",
    simA.finished > 0 && simD.finished > 0 && simA.little.residualRel < 0.1 && simD.little.residualRel < 0.1,
    "assembly finished=" + simA.finished + " dismantle finished=" + simD.finished);

  // routing (from-to flow) reflects the gozinto: after a dismantle(out2) the
  // offered flow doubles; after an assembly(in2) it halves.
  const rD = bD.routing[bD.routing.length - 1]; // arc feeding the drain
  const r0 = bD.routing[0]; // source -> dismantle
  check("routing (from-to flow) doubles after a dismantle (out2)",
    rD.unitsPerHr === r0.unitsPerHr * 2, "src=" + r0.unitsPerHr + " ->drain=" + rD.unitsPerHr);
}

/* ---- 8. Editable cycle time moves the bottleneck / throughput ----------- */
{
  const block = P.derive(builds["general-factory"]);
  const before = P.metrics(block);
  // Make the QA/finishing station (last process op) hugely slow -> it becomes
  // the bottleneck and throughput drops.
  const stations = block.operations.filter((o) => ["station", "parallel", "assembly", "dismantle"].indexOf(o.kind) !== -1);
  const last = stations[stations.length - 1];
  last.cycleSec = 600;
  const after = P.metrics(block);
  check("editing a cycle time MOVES the bottleneck + lowers throughput (metrics respond)",
    after.bottleneck.opId === last.id && after.throughputPerHr < before.throughputPerHr,
    "before=" + before.bottleneck.name + "@" + before.throughputPerHr + " after=" + after.bottleneck.name + "@" + after.throughputPerHr);
}

/* ---- 9. Honesty labels -------------------------------------------------- */
{
  const h = P.HONESTY;
  const m = P.metrics(P.derive(builds["assembly-line"]));
  const okH = /modelled, not measured/i.test(h) && /deterministic/i.test(h) && /teaching-scale/i.test(h) &&
    /Little's Law/i.test(h) && /Theory of Constraints/i.test(h) &&
    /NOT a validated discrete-event/i.test(h) && /NOT CAD\/BIM/i.test(h) && /NOT a certification/i.test(h);
  check("HONESTY label states modelled/deterministic/teaching-scale + TOC/Little's Law + NOT a DES/CAD-BIM/cert", okH);
  check("metrics carry the honesty label + the standards basis",
    m.honesty === h && /Theory of Constraints/i.test(m.basis) && /Little's Law/i.test(m.basis));
}

/* ---- sample transcript, for the record --------------------------------- */
console.log("");
console.log("Line metrics per factory profile:");
for (const k of FACTORY_KEYS) {
  const m = P.metrics(P.derive(builds[k]));
  console.log("  - " + k + ": throughput " + m.throughputPerHr + "/hr, bottleneck " + m.bottleneck.name +
    " (" + m.bottleneck.effTimeSec + " s/unit), line eff " + (m.lineEfficiency * 100).toFixed(1) + "%, WIP " +
    m.wip.toFixed(1) + " parts, lead " + m.leadTimeSec.toFixed(0) + " s, Little residual " + (m.little.residualRel * 100).toFixed(2) + "%");
}

console.log("");
console.log(failures === 0 ? "ALL PROCESS CHECKS PASSED" : failures + " PROCESS CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
