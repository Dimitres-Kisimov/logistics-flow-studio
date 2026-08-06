/* =====================================================================
 * verify_flowlinks.js - Material-flow CONNECTION overlay verification (v3.12)
 *
 * Runs the REAL app modules (domain.js, compliance.js, simulation.js,
 * generate.js, nlcommands.js, examples.js, wms.js, flowsim.js, flowlinks.js)
 * in Node under the SAME window shim the other harnesses use and asserts the
 * "Flow links" connection overlay MODEL (WT.flowlinks) is:
 *
 *   - DERIVED from the app's OWN routing (WT.flowsim.buildWaypoints) - it
 *     invents no new graph;
 *   - DIRECTED + ordered along the routed spine (source/receiving -> storage
 *     -> pick -> pack -> ship/drain), links only between CONSECUTIVE PRESENT
 *     stages, riding conveyor cells on the storage->pick leg where the boxes
 *     do;
 *   - HONEST: a stage the layout does NOT contain gets NO node/link (no
 *     phantom); a factory (Source -> stations -> Drain) shows no storage/
 *     picking node; an empty / single-stage (no-flow) layout is EMPTY;
 *   - DETERMINISTIC: the link SET is byte-identical across runs (pure fn of
 *     buildWaypoints; NO Date/RNG);
 *   - DRAWABLE: draw() renders into a mock 2D context WITHOUT throwing in
 *     BOTH a light and a dark palette, is LOD-aware, and is a no-op for an
 *     empty model.
 *
 * Everything is deterministic (seeded, never wall-clock). Usage:
 *   node verify_flowlinks.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // app modules attach themselves to window.WT
for (const f of ["domain.js", "compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js", "flowsim.js", "flowlinks.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const FS = WT.flowsim;
const FL = WT.flowlinks;
const G = WT.generate;
const E = WT.examples;

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

// ---- fixture helpers ------------------------------------------------
function mk(list) {
  let i = 0;
  return list.map((e) => {
    const def = D.ELEMENTS[e.type] || {};
    return { id: "el-" + ++i, type: e.type, x: e.x, y: e.y, w: e.w || def.w || 1, d: e.d || def.d || 1 };
  });
}
function layout(els, gw, gh) {
  return { elements: els, gridW: gw || 40, gridH: gh || 24, cell: 1, config: { seed: 42 } };
}
function examplesLayout(id) {
  const b = E.build(id);
  return { elements: b.elements, gridW: b.gridW, gridH: b.gridH, cell: 1, config: b.config, meta: b.meta };
}

// A full 5-stage warehouse spine: receiving -> storage -> pick -> pack -> ship.
const WAREHOUSE = layout(mk([
  { type: "dock-in", x: 2, y: 0 },
  { type: "selective-racking", x: 2, y: 4, w: 12, d: 1 },
  { type: "conveyor", x: 6, y: 6, w: 1, d: 7 },
  { type: "carton-flow", x: 2, y: 14, w: 4, d: 1 },
  { type: "pack-station", x: 10, y: 18 },
  { type: "dock-out", x: 2, y: 22 },
]));

// A production line: Source -> Station -> Drain (no storage / no picking).
const FACTORY = layout(mk([
  { type: "mfg-source", x: 2, y: 3 },
  { type: "conveyor", x: 5, y: 4, w: 6, d: 1 },
  { type: "mfg-station", x: 12, y: 3 },
  { type: "conveyor", x: 16, y: 4, w: 6, d: 1 },
  { type: "mfg-drain", x: 23, y: 3 },
]));

// ---- a minimal, permissive mock 2D context (records the call log) ----
function MockCtx() {
  this.log = [];
  const rec = (n) => (...a) => { this.log.push(n + "(" + a.map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : String(v))).join(",") + ")"); };
  ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo",
    "arc", "stroke", "fill", "fillRect", "strokeRect", "fillText", "setLineDash",
    "translate", "rotate", "scale", "clip", "rect"].forEach((m) => { this[m] = rec(m); });
  this.measureText = (t) => { this.log.push("measureText(" + t + ")"); return { width: String(t).length * 6 }; };
  // property setters are plain assignments; nothing to trap
  this.strokeStyle = ""; this.fillStyle = ""; this.lineWidth = 1; this.globalAlpha = 1;
  this.font = ""; this.lineCap = ""; this.lineJoin = ""; this.textAlign = ""; this.textBaseline = "";
}
const LIGHT = {
  cellPx: 20, onCell: 20,
  project: (x, y) => ({ x: x * 20, y: y * 20 }),
  colors: { stages: { receiving: "#2563eb", storage: "#9333ea", picking: "#d97706", packing: "#0d9488", shipping: "#16a34a" }, link: "#64748b", nodeBg: "#ffffff", nodeText: "#0f172a" },
};
const DARK = {
  cellPx: 20, onCell: 20,
  project: (x, y) => ({ x: x * 20, y: y * 20 }),
  colors: { stages: { receiving: "#60a5fa", storage: "#c084fc", picking: "#fbbf24", packing: "#2dd4bf", shipping: "#4ade80" }, link: "#94a3b8", nodeBg: "#0e1626", nodeText: "#e2e8f0" },
};

const ORDER = FL.STAGE_ORDER;
const idx = (s) => ORDER.indexOf(s);

// ---------------------------------------------------------------------
// 1. API surface.
// ---------------------------------------------------------------------
check("1. WT.flowlinks API present (buildLinks, draw, STAGE_ORDER, NOTE)",
  FL && typeof FL.buildLinks === "function" && typeof FL.draw === "function" &&
  Array.isArray(FL.STAGE_ORDER) && FL.STAGE_ORDER.length === 5 && typeof FL.NOTE === "string",
  FL ? "order=" + FL.STAGE_ORDER.join(">") : "MISSING");

// ---------------------------------------------------------------------
// 2. The link set is DERIVED from buildWaypoints (no new graph): every node
//    coincides with a NON-conveyor waypoint of the same stage.
// ---------------------------------------------------------------------
(() => {
  const wps = FS.buildWaypoints(WAREHOUSE);
  const anchors = {};
  wps.forEach((w) => { if (!w.onConveyor && !(w.stage in anchors)) anchors[w.stage] = w; });
  const m = FL.buildLinks(WAREHOUSE);
  const allMatch = m.nodes.every((n) => {
    const a = anchors[n.stage];
    return a && Math.abs(a.x - n.x) < 1e-9 && Math.abs(a.y - n.y) < 1e-9;
  });
  check("2. nodes are the buildWaypoints stage anchors (reuses the app's OWN routing)",
    !m.empty && m.nodes.length > 0 && allMatch, m.nodes.length + " nodes, all match=" + allMatch);
})();

// ---------------------------------------------------------------------
// 3. Full warehouse spine: all 5 stages, links only between CONSECUTIVE
//    present stages, every link DIRECTED downstream.
// ---------------------------------------------------------------------
(() => {
  const m = FL.buildLinks(WAREHOUSE);
  const stages = m.nodes.map((n) => n.stage);
  const orderedAll = stages.join(">") === "receiving>storage>picking>packing>shipping";
  // Consecutive present-stage pairs the links must cover (conveyor leg may
  // split storage->picking into several segments, all with that from/to).
  const wantPairs = [];
  for (let i = 0; i < stages.length - 1; i++) wantPairs.push(stages[i] + ">" + stages[i + 1]);
  const gotPairs = Array.from(new Set(m.links.map((l) => l.fromStage + ">" + l.toStage)));
  const pairsOk = wantPairs.length === gotPairs.length && wantPairs.every((p) => gotPairs.indexOf(p) !== -1);
  const directed = m.links.every((l) => idx(l.fromStage) < idx(l.toStage) && (l.x1 !== l.x2 || l.y1 !== l.y2));
  check("3. warehouse: 5 ordered stages + consecutive directed links (no skips)",
    orderedAll && pairsOk && directed && m.links.length >= 4,
    "stages=" + stages.join(">") + " pairs=" + gotPairs.join("|") + " directed=" + directed);
})();

// ---------------------------------------------------------------------
// 4. Conveyor-following leg: on a real routed example, the storage->picking
//    link rides conveyor cells (model.routed) and every onConveyor segment
//    lies BETWEEN the storage and picking anchors.
// ---------------------------------------------------------------------
(() => {
  let routedId = null, model = null;
  for (const ex of E.library) {
    let lay; try { lay = examplesLayout(ex.id); } catch (_) { continue; }
    const m = FL.buildLinks(lay);
    if (m.routed && m.links.some((l) => l.onConveyor)) { routedId = ex.id; model = m; break; }
  }
  let ok = false, detail = "no routed example found";
  if (model) {
    const st = model.nodes.find((n) => n.stage === "storage");
    const pk = model.nodes.find((n) => n.stage === "picking");
    const conv = model.links.filter((l) => l.onConveyor);
    // every conveyor segment must be part of the storage->picking leg
    const allStoragePick = conv.every((l) => l.fromStage === "storage" && l.toStage === "picking");
    ok = !!st && !!pk && conv.length > 0 && allStoragePick;
    detail = routedId + ": " + conv.length + " conveyor segments, all storage->picking=" + allStoragePick;
  }
  check("4. conveyor-following storage->pick leg on a routed example (rides the cells)", ok, detail);
})();

// ---------------------------------------------------------------------
// 5. Factory Source -> stations -> Drain: NO phantom storage/picking node.
// ---------------------------------------------------------------------
(() => {
  const m = FL.buildLinks(FACTORY);
  const stages = m.nodes.map((n) => n.stage);
  const noPhantom = stages.indexOf("storage") === -1 && stages.indexOf("picking") === -1;
  const hasEnds = stages.indexOf("receiving") !== -1 && stages.indexOf("shipping") !== -1;
  const directed = m.links.length >= 1 && m.links.every((l) => idx(l.fromStage) < idx(l.toStage));
  check("5. factory Source->stations->Drain: no phantom storage/picking node",
    !m.empty && noPhantom && hasEnds && directed,
    "stages=" + stages.join(">") + " links=" + m.links.length);
})();

// ---------------------------------------------------------------------
// 6. Empty layout -> EMPTY overlay (nothing routed => nothing drawn).
// ---------------------------------------------------------------------
(() => {
  const m = FL.buildLinks(layout([]));
  check("6. empty layout -> empty model (no nodes, no links)",
    m.empty && m.nodes.length === 0 && m.links.length === 0, "empty=" + m.empty);
})();

// ---------------------------------------------------------------------
// 7. No-flow layout (a single grounded stage) -> EMPTY (no phantom link).
// ---------------------------------------------------------------------
(() => {
  const m = FL.buildLinks(layout(mk([{ type: "selective-racking", x: 4, y: 6, w: 8, d: 1 }])));
  check("7. no-flow layout (one lone stage) -> empty (no phantom link/node)",
    m.empty && m.links.length === 0 && m.nodes.length === 0, "empty=" + m.empty + " links=" + m.links.length);
})();

// ---------------------------------------------------------------------
// 8. Determinism: the link SET is byte-identical across runs.
// ---------------------------------------------------------------------
(() => {
  const a = JSON.stringify(FL.buildLinks(WAREHOUSE));
  const b = JSON.stringify(FL.buildLinks(WAREHOUSE));
  const fa = JSON.stringify(FL.buildLinks(FACTORY));
  const fb = JSON.stringify(FL.buildLinks(FACTORY));
  const ex = E.library[0] ? examplesLayout(E.library[0].id) : WAREHOUSE;
  const ea = JSON.stringify(FL.buildLinks(ex));
  const eb = JSON.stringify(FL.buildLinks(ex));
  check("8. deterministic link set: byte-identical across runs (warehouse+factory+example)",
    a === b && fa === fb && ea === eb, "wh=" + (a === b) + " fac=" + (fa === fb) + " ex=" + (ea === eb));
})();

// ---------------------------------------------------------------------
// 9. draw() renders into a mock 2D context WITHOUT throwing - light + dark.
// ---------------------------------------------------------------------
(() => {
  const model = FL.buildLinks(WAREHOUSE);
  let ok = true, detail = "";
  const cL = new MockCtx(), cD = new MockCtx();
  try { FL.draw(cL, model, LIGHT); } catch (e) { ok = false; detail = "light threw: " + e.message; }
  try { FL.draw(cD, model, DARK); } catch (e) { ok = false; detail = "dark threw: " + e.message; }
  const drew = cL.log.some((s) => s.indexOf("stroke(") === 0) && cD.log.some((s) => s.indexOf("stroke(") === 0);
  check("9. draw() renders links in a mock 2D ctx without throwing (light + dark)",
    ok && drew, detail || ("light=" + cL.log.length + " calls, dark=" + cD.log.length + " calls"));
})();

// ---------------------------------------------------------------------
// 10. draw() is a no-op for an empty model (nothing to overlay).
// ---------------------------------------------------------------------
(() => {
  const c = new MockCtx();
  let ok = true, detail = "";
  try { FL.draw(c, FL.buildLinks(layout([])), LIGHT); } catch (e) { ok = false; detail = e.message; }
  check("10. draw() is a safe no-op on an empty model", ok && c.log.length === 0, detail || (c.log.length + " calls"));
})();

// ---------------------------------------------------------------------
// 11. LOD-aware: zoomed FAR out (tiny onCell) draws fewer marks than zoomed
//     in (arrowheads + node dots + labels drop out), and never throws.
// ---------------------------------------------------------------------
(() => {
  const model = FL.buildLinks(WAREHOUSE);
  const near = new MockCtx(), far = new MockCtx();
  let ok = true, detail = "";
  try {
    FL.draw(near, model, Object.assign({}, LIGHT, { onCell: 24 }));
    FL.draw(far, model, Object.assign({}, LIGHT, { onCell: 2 }));
  } catch (e) { ok = false; detail = e.message; }
  const nearArcs = near.log.filter((s) => s.indexOf("arc(") === 0).length;
  const farArcs = far.log.filter((s) => s.indexOf("arc(") === 0).length;
  check("11. LOD-aware: zoomed-out draws fewer marks than zoomed-in (nodes/arrows drop out)",
    ok && near.log.length > far.log.length && nearArcs > 0 && farArcs === 0,
    detail || ("near=" + near.log.length + "(" + nearArcs + " nodes), far=" + far.log.length + "(" + farArcs + " nodes)"));
})();

// ---------------------------------------------------------------------
// 12. draw() is deterministic: identical inputs -> identical call log.
// ---------------------------------------------------------------------
(() => {
  const model = FL.buildLinks(WAREHOUSE);
  const a = new MockCtx(), b = new MockCtx();
  FL.draw(a, model, LIGHT); FL.draw(b, model, LIGHT);
  check("12. draw() is deterministic (identical call log across runs)",
    a.log.join("\n") === b.log.join("\n"), a.log.length + " vs " + b.log.length + " calls");
})();

// ---------------------------------------------------------------------
// 13. Honesty + safety of the module source: illustrative framing, no
//     Date/RNG, no eval, no external hosts (fully offline + CSP-safe).
// ---------------------------------------------------------------------
(() => {
  const src = fs.readFileSync(path.join(__dirname, "flowlinks.js"), "utf8");
  const honestSrc = /illustrative/i.test(src) && /validated process graph/i.test(src) && /CAD\/BIM/i.test(src);
  const honestNote = /illustrative/i.test(FL.NOTE) && /validated process graph/i.test(FL.NOTE);
  // Match actual CALL usage (not the honesty prose that names them).
  const noClock = !/new\s+Date\b|Date\.now\s*\(|Math\.random\s*\(/.test(src);
  const noEval = !/\beval\s*\(|new\s+Function\s*\(/.test(src);
  const noHosts = !/https?:\/\//.test(src);
  check("13. honest illustrative framing in the module + NOTE (not a validated process graph / CAD/BIM)",
    honestSrc && honestNote, "note=\"" + FL.NOTE.slice(0, 48) + "...\"");
  check("14. deterministic + CSP-safe + offline: no Date/RNG, no eval, no external hosts",
    noClock && noEval && noHosts, "clock=" + !noClock + " eval=" + !noEval + " hosts=" + !noHosts);
})();

// ---------------------------------------------------------------------
// 15. Additive proof: buildLinks does NOT mutate the layout it reads.
// ---------------------------------------------------------------------
(() => {
  const before = JSON.stringify(WAREHOUSE);
  FL.buildLinks(WAREHOUSE);
  FL.draw(new MockCtx(), FL.buildLinks(WAREHOUSE), LIGHT);
  check("15. render-only: buildLinks + draw never mutate the layout",
    JSON.stringify(WAREHOUSE) === before, "unchanged=" + (JSON.stringify(WAREHOUSE) === before));
})();

console.log("");
console.log("-".repeat(60));
if (failures === 0) console.log("ALL " + checks + " CHECKS PASSED");
else console.log(failures + " OF " + checks + " CHECKS FAILED");
process.exit(failures === 0 ? 0 : 1);
