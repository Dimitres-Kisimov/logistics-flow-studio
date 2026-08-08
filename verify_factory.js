/* =====================================================================
 * verify_factory.js - Factory layout GENERATOR verification harness
 * (v2.6 FACTORY-B). The warehouse generator builds a distribution centre;
 * this proves the NEW factory code path builds a whole PRODUCTION LINE
 * from the FACTORY-A1 manufacturing components, that plain-language edits
 * cover the production components, and that a Part flows Source -> Drain.
 *
 * Runs the REAL app modules (domain.js, compliance.js, generate.js,
 * nlcommands.js, flowsim.js + the WMS/automation/KB deps the flow sim
 * reads) in Node under the same window shim the other harnesses use and
 * asserts EXACT outcomes:
 *
 *   Factory generator (additive; warehouse generateLayout UNTOUCHED)
 *     - factoryProfiles has the 4 pinned keys (assembly-line /
 *       machining-shop / general-factory + the v3.18 machining-qa-split
 *       multi-way baseline) and is SEPARATE from the 4 warehouse
 *       plantProfiles (which stay exactly 4)
 *     - each factory build has a Source + a Drain + >=1 Station + straight
 *       AND curved conveyors + real dock doors
 *     - every build is overlap-free AND in-bounds on its own floor
 *     - determinism: a factory build is BYTE-IDENTICAL on re-run
 *     - every build PASSES or honestly WARNS compliance (never a FAIL)
 *     - a Part traverses the line Source -> ... -> Drain (flowsim: a finite
 *       pool spawns at the Source-anchored receiving waypoint and drains
 *       to completion at the Drain-anchored shipping waypoint)
 *   Plain-language edits on a factory line (reuse nlcommands.js)
 *     - "add 2 more assembly stations" -> EXACTLY +2 mfg-assembly (assembly)
 *     - "add a parallel machining station" -> +1 mfg-parallel-station
 *     - "add a machining station" -> +1 mfg-station
 *     - "leave zone packing for manual expansion" reserves + empties it
 *     - "use the machining-shop baseline" regenerates that factory line
 *     - "add 3 RGVs" (a WAREHOUSE type, no zone) is STILL not guessed
 *   Ready-made factory scenario (examples.js, additive)
 *     - the "assembly-line-factory" example builds, is overlap-free, non-
 *       failing, carries zone tags + the FACTORY-A1 components, and exports
 *
 * Everything is deterministic. Usage:  node verify_factory.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // app modules attach themselves to window.WT
for (const f of [
  "domain.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "generate.js", "nlcommands.js", "flowsim.js", "examples.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const C = WT.compliance;
const G = WT.generate;
const NL = WT.nl;
const F = WT.flowsim;
const E = WT.examples;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

// v3.18 FLOW-GEN: machining-qa-split (the multi-way baseline) joins the
// pinned set and runs the SAME battery below (components/geometry/compliance/
// determinism/part-flow); its emitted process block is covered in depth by
// verify_flowbalance.js.
const FACTORY_KEYS = ["assembly-line", "machining-shop", "general-factory", "machining-qa-split"];
const ZONES = ["receiving", "storage", "picking", "packing", "shipping"];

function overlapFree(els) {
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++)
      if (G.rectsOverlap(els[i], els[j])) return false;
  return true;
}
function inBounds(gen) {
  return gen.elements.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= gen.gridW && e.y + e.d <= gen.gridH);
}
function complianceOf(gen) {
  return C.check(
    { version: "wt-1", gridW: gen.gridW, gridH: gen.gridH, cell: 1, elements: gen.elements },
    { minAisleMetres: gen.config.minAisleMetres }
  );
}
function count(els, type, zone) {
  return els.filter((e) => e.type === type && (!zone || e.zone === zone)).length;
}
// Drive a finite pool to completion; returns the final sim state.
function runToCompletion(gen, units, seed) {
  const layout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, config: gen.config };
  const s = F.state(layout, { seed: seed, loop: false, units: units });
  let guard = 0;
  while (!(s.completed === units && s.inflight === 0) && guard < 8000) { F.step(s, 1); guard++; }
  return { s: s, ticks: guard };
}

console.log("Factory layout generator verification (deterministic)");
console.log("");

/* ---- 1. factoryProfiles has the 4 keys, SEPARATE from the 4 warehouse ---- */
const fkeys = Object.keys(G.factoryProfiles || {});
check("factoryProfiles has exactly the 4 pinned factory keys",
  FACTORY_KEYS.every((k) => fkeys.indexOf(k) !== -1) && fkeys.length === 4, fkeys.join(", "));
check("warehouse plantProfiles stays exactly the 4 keys (factory is a SEPARATE path)",
  Object.keys(G.plantProfiles).length === 4);
check("generateFactoryLayout is exposed", typeof G.generateFactoryLayout === "function");

/* ---- 2. Each factory build: components + geometry + compliance ---------- */
const builds = {};
for (const k of FACTORY_KEYS) {
  const gen = G.generateFactoryLayout(k, { seed: 7 });
  builds[k] = gen;
  const els = gen.elements;
  const hasSource = count(els, "mfg-source") >= 1;
  const hasDrain = count(els, "mfg-drain") >= 1;
  const stations = els.filter((e) => (D.ELEMENTS[e.type] || {}).base === "station").length;
  const straight = count(els, "conveyor") >= 1;
  const curved = count(els, "conveyor-curve") >= 1;
  const docks = count(els, "dock-in") + count(els, "dock-out");
  check(k + ": has a Source + a Drain + >=1 process/assembly station",
    hasSource && hasDrain && stations >= 1, "source=" + hasSource + " drain=" + hasDrain + " stations=" + stations);
  check(k + ": connected by straight AND curved conveyors",
    straight && curved, "conveyor=" + count(els, "conveyor") + " curve=" + count(els, "conveyor-curve"));
  check(k + ": carries real dock doors (compliance exits)", docks >= 2, "docks=" + docks);
  check(k + ": overlap-free + in-bounds on its own " + gen.gridW + "x" + gen.gridH + " floor",
    overlapFree(els) && inBounds(gen), els.length + " elements");
  check(k + ": every element carries a zone tag",
    els.every((e) => typeof e.zone === "string" && ZONES.indexOf(e.zone) !== -1));
  const rep = complianceOf(gen);
  check(k + ": compliance passes or honestly warns (never fails)",
    rep.summary.worst !== "fail",
    "worst=" + rep.summary.worst + " (pass " + rep.summary.pass + " warn " + rep.summary.warn + " fail " + rep.summary.fail + ")");
  check(k + ": serialization token is wt-1 + meta.kind is factory",
    gen.meta.version === "wt-1" && gen.meta.kind === "factory");
}

/* ---- 3. Determinism: byte-identical build per profile ------------------- */
for (const k of FACTORY_KEYS) {
  const a = JSON.stringify(G.generateFactoryLayout(k, { seed: 7 }));
  const b = JSON.stringify(G.generateFactoryLayout(k, { seed: 7 }));
  check("determinism: " + k + " is byte-identical on re-run", a === b, a.length + " bytes");
}

/* ---- 4. A Part traverses the line Source -> ... -> Drain ---------------- */
for (const k of FACTORY_KEYS) {
  const gen = builds[k];
  // The flow spine anchors receiving at the Source (left) and shipping at
  // the Drain (right), so a Part flows Source -> ... -> Drain.
  const wp = F.buildWaypoints({ elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH });
  let recv = null, ship = null;
  for (const w of wp) { if (w.stage === "receiving") recv = w; if (w.stage === "shipping") ship = w; }
  const spineOk = !!recv && !!ship && recv.x < ship.x && wp.length >= 5;
  const units = 12;
  const r = runToCompletion(gen, units, 9);
  check(k + ": a Part flows Source -> Drain (finite pool drains to completion)",
    spineOk && r.s.spawned === units && r.s.completed === units && r.s.inflight === 0,
    "spawned=" + r.s.spawned + " completed=" + r.s.completed + " inflight=" + r.s.inflight +
    " recv.x=" + (recv && recv.x.toFixed(1)) + " ship.x=" + (ship && ship.x.toFixed(1)) + " ticks=" + r.ticks);
}

/* ---- 5. Plain-language edits cover the production components ------------- */
const ctx = { zones: ZONES };
const base = G.generateFactoryLayout("assembly-line", { seed: 7 });
const baseAssembly = count(base.elements, "mfg-assembly", "picking");
const baseParallel = count(base.elements, "mfg-parallel-station", "storage");
const baseStation = count(base.elements, "mfg-station", "storage");

const pAdd = NL.parse("add 2 more assembly stations", ctx);
check("NL parse: 'add 2 more assembly stations' -> add/mfg-assembly/2/picking",
  pAdd.ok && pAdd.op.kind === "add" && pAdd.op.type === "mfg-assembly" && pAdd.op.count === 2 && pAdd.op.zone === "picking",
  pAdd.ok ? JSON.stringify(pAdd.op) : pAdd.message);
const rAdd = NL.apply(base, "add 2 more assembly stations", ctx);
check("NL apply: adds EXACTLY +2 mfg-assembly in the assembly lane, overlap-free",
  rAdd.ok && count(rAdd.layout.elements, "mfg-assembly", "picking") - baseAssembly === 2 && overlapFree(rAdd.layout.elements),
  "before " + baseAssembly + " -> after " + (rAdd.ok ? count(rAdd.layout.elements, "mfg-assembly", "picking") : "n/a"));

const rPar = NL.apply(base, "add a parallel machining station", ctx);
check("NL apply: 'add a parallel machining station' -> +1 mfg-parallel-station",
  rPar.ok && count(rPar.layout.elements, "mfg-parallel-station", "storage") - baseParallel === 1);
const rSt = NL.apply(base, "add a machining station", ctx);
check("NL apply: 'add a machining station' -> +1 mfg-station",
  rSt.ok && count(rSt.layout.elements, "mfg-station", "storage") - baseStation === 1);

const pRes = NL.parse("leave zone packing for manual expansion", ctx);
check("NL parse: 'leave zone packing for manual expansion' -> reserve/packing",
  pRes.ok && pRes.op.kind === "reserve" && pRes.op.zone === "packing");
const rRes = NL.apply(base, "leave zone packing for manual expansion", ctx);
check("NL apply: reserving packing empties the finishing lane + marks it reserved",
  rRes.ok &&
  rRes.layout.elements.filter((e) => e.zone === "packing").length === 0 &&
  rRes.layout.meta.reserved.indexOf("packing") !== -1);

const pReg = NL.parse("use the machining-shop baseline", ctx);
check("NL parse: 'use the machining-shop baseline' -> regenerate/machining-shop",
  pReg.ok && pReg.op.kind === "regenerate" && pReg.op.profileKey === "machining-shop");
const rReg = NL.apply(base, "use the machining-shop baseline", ctx);
check("NL apply: regenerate switches the line to the machining-shop factory profile",
  rReg.ok && rReg.layout.meta.profileKey === "machining-shop" && rReg.layout.meta.kind === "factory" &&
  overlapFree(rReg.layout.elements));

const rgv = NL.parse("add 3 RGVs", ctx);
check("NL parse: a WAREHOUSE type with no zone ('add 3 RGVs') is STILL not silently guessed",
  rgv.ok === false && /which zone/i.test(rgv.message));

/* ---- 6. The ready-made factory scenario (examples.js) ------------------- */
const FAC_ID = "assembly-line-factory";
const facEx = E.library.find((e) => e.id === FAC_ID);
check("ready-made factory scenario is present in the example library", !!facEx, FAC_ID);
check("factory scenario is flagged config.factory (its own dedicated builder)",
  !!(facEx && facEx.config && facEx.config.factory));
if (facEx) {
  const fb = E.build(FAC_ID);
  const els = fb.elements;
  check("factory scenario builds a non-empty {elements, config, meta}",
    Array.isArray(els) && els.length > 0 && !!fb.config && !!fb.meta, els.length + " elements");
  check("factory scenario carries its own factory floor (not the 40x24 studio floor)",
    fb.gridW > 40 && fb.gridH >= 24, fb.gridW + " x " + fb.gridH + " m");
  check("factory scenario contains the FACTORY-A1 components (Source + Drain + Station)",
    count(els, "mfg-source") >= 1 && count(els, "mfg-drain") >= 1 &&
    els.some((e) => (D.ELEMENTS[e.type] || {}).base === "station"));
  check("factory scenario is overlap-free + every element zone-tagged",
    overlapFree(els) && els.every((e) => typeof e.zone === "string" && e.zone.length));
  const rep = complianceOf(fb);
  check("factory scenario passes/warns compliance (never fails)", rep.summary.worst !== "fail",
    "worst=" + rep.summary.worst);
  const dat = E.exportData(FAC_ID);
  check("factory scenario exports a valid wt-1 layout, byte-identical on re-run",
    dat.version === "wt-1" && JSON.stringify(dat) === JSON.stringify(E.exportData(FAC_ID)));
  check("determinism: factory scenario build is byte-identical on re-run",
    JSON.stringify(E.build(FAC_ID)) === JSON.stringify(E.build(FAC_ID)));
}

/* ---- 7. Honesty labels ------------------------------------------------- */
const summ = builds["assembly-line"].meta.summary;
check("factory summary states the honest limitations (illustrative synthetic, NOT a validated plan / NOT CAD-BIM)",
  /illustrative/i.test(summ) && /synthetic/i.test(summ) && /NOT a validated process plan/i.test(summ) && /NOT CAD\/BIM/i.test(summ));

/* ---- sample transcript, for the record --------------------------------- */
console.log("");
console.log("Factory profiles (" + FACTORY_KEYS.length + "):");
for (const k of FACTORY_KEYS) {
  const g = builds[k];
  const t = {}; g.elements.forEach((e) => { t[e.type] = (t[e.type] || 0) + 1; });
  console.log("  - " + G.factoryProfiles[k].label + " : " + g.elements.length + " els on " +
    g.gridW + "x" + g.gridH + ", stations=" + g.meta.stationCount + ", compliance " + complianceOf(g).summary.worst);
}

console.log("");
console.log(failures === 0 ? "ALL FACTORY CHECKS PASSED" : failures + " FACTORY CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
