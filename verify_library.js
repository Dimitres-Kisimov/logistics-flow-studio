/* =====================================================================
 * verify_library.js - USER-DEFINABLE OBJECT LIBRARY (WT.library) checks.
 *
 * Runs the REAL modules (domain.js, library.js, shapes.js + the sim stack:
 * compliance/simulation/generate/nlcommands/examples/wms/flowsim) in Node
 * under the same window shim the other harnesses use. WT.library lets the
 * user DEFINE THEIR OWN object TYPES (like Siemens Plant Simulation
 * UserObjects) from a base MaterialFlow behaviour class and organise them in
 * a categorised tree; a custom def injects into WT.domain.ELEMENTS so every
 * existing engine resolves it. Built-ins carry NO `base`, so every base-aware
 * branch is a NO-OP for a built-in-only layout (byte-identical).
 *
 * Checks (all deterministic):
 *   - a custom type of EACH base (storage/conveyor/station/transporter/dock/
 *     zone) REGISTERS into ELEMENTS with the right category + behaviour fields
 *   - storage contributes positions (elementCapacity > 0); the flow bases hold
 *     0 storage positions (like the built-in flow types)
 *   - the categorised palette tree lists the seven groups + puts each custom
 *     type under My Objects (or its chosen category)
 *   - PLACEMENT-ready: integer footprint w/d >= 1, finite heightM
 *   - RENDER: draw2D (glyph tier + LOD-icon tier) + draw3D draw EVERY custom
 *     type into a mock 2D/3D context with NO throw + all-finite coords, and
 *     do NOT mutate their inputs
 *   - SIM per base: isConnector true for custom conveyor/station, false for the
 *     rest; a custom shipping-dock touching a custom rack makes it
 *     outbound-covered (a real endpoint); the live flow sim RUNS on a mixed
 *     built-in+custom layout, deterministically + unit-conserving
 *   - wt-1 ROUND-TRIP: embedInto adds the custom defs a layout uses; rebuildFrom
 *     re-registers them (def preserved); a layout WITHOUT custom objects
 *     serializes BYTE-IDENTICALLY (no `library` key added)
 *   - import/export JSON round-trips the library
 *   - determinism: buildDef is a pure function of its input
 *   - offline (no external asset ref) + NO Date / NO RNG in library.js
 *   - honesty labels present (illustrative / NOT a vendor spec)
 *
 * Usage:  node verify_library.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // modules attach themselves to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
// A tiny in-memory localStorage so the (guarded) persistence path is exercised.
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
for (const f of ["domain.js", "library.js", "shapes.js", "compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js", "flowsim.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const L = WT.library;
const S = WT.shapes;
const F = WT.flowsim;
const E = WT.examples;
const LIB_SRC = fs.readFileSync(path.join(__dirname, "library.js"), "utf8");

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
const finite = (v) => typeof v === "number" && isFinite(v);

/* ---- recording mock 2D/3D context (mirrors verify_shapes.js) ------- */
function makeCtx() {
  const ctx = { _bad: [], _calls: 0 };
  const num = (name, args) => {
    ctx._calls++;
    for (const n of args) if (typeof n === "number" && !isFinite(n)) ctx._bad.push(name + "=" + n);
  };
  ctx.save = () => {}; ctx.restore = () => {};
  ctx.beginPath = () => {}; ctx.closePath = () => {};
  ctx.moveTo = (x, y) => num("moveTo", [x, y]);
  ctx.lineTo = (x, y) => num("lineTo", [x, y]);
  ctx.arc = (x, y, r, a, b) => num("arc", [x, y, r, a, b]);
  ctx.arcTo = (x1, y1, x2, y2, r) => num("arcTo", [x1, y1, x2, y2, r]);
  ctx.rect = (x, y, w, h) => num("rect", [x, y, w, h]);
  ctx.fillRect = (x, y, w, h) => num("fillRect", [x, y, w, h]);
  ctx.strokeRect = (x, y, w, h) => num("strokeRect", [x, y, w, h]);
  ctx.quadraticCurveTo = (a, b, c, d) => num("quad", [a, b, c, d]);
  ctx.setLineDash = () => {};
  ctx.fill = () => {}; ctx.stroke = () => {};
  ctx.fillText = (t, x, y) => num("fillText", [x, y]);
  ctx.measureText = () => ({ width: 10 });
  ctx.translate = () => {}; ctx.rotate = () => {}; ctx.scale = () => {};
  Object.defineProperty(ctx, "fillStyle", { set() {}, get() { return "#000"; } });
  Object.defineProperty(ctx, "strokeStyle", { set() {}, get() { return "#000"; } });
  Object.defineProperty(ctx, "lineWidth", { set() {}, get() { return 1; } });
  Object.defineProperty(ctx, "lineJoin", { set() {}, get() { return "round"; } });
  Object.defineProperty(ctx, "globalAlpha", { set() {}, get() { return 1; } });
  Object.defineProperty(ctx, "font", { set() {}, get() { return "10px sans"; } });
  Object.defineProperty(ctx, "textAlign", { set() {}, get() { return "left"; } });
  Object.defineProperty(ctx, "textBaseline", { set() {}, get() { return "top"; } });
  return ctx;
}
// A 2:1 dimetric-ish projection for draw3D (any linear P works for the test).
function makeP() { return (cx, cy, cz) => ({ x: (cx - cy) * 12 + 200, y: (cx + cy) * 6 - (cz || 0) * 8 + 120 }); }

console.log("User-definable object library (WT.library) verification (deterministic)");
console.log("");

/* ---------------------------------------------------------------------
 * 0. API surface.
 * ------------------------------------------------------------------- */
check("WT.library exposes the expected API",
  L && typeof L.define === "function" && typeof L.update === "function" &&
  typeof L.clone === "function" && typeof L.remove === "function" &&
  typeof L.paletteTree === "function" && typeof L.embedInto === "function" &&
  typeof L.rebuildFrom === "function" && Array.isArray(L.BASES) && Array.isArray(L.GLYPHS));

/* ---------------------------------------------------------------------
 * 1. Define a custom type of EACH base -> registers + right shape.
 * ------------------------------------------------------------------- */
const BASE_INPUT = {
  storage: { name: "PartA rack", base: "storage", w: 6, d: 2, height: 6, glyph: "rack", color: "#22c55e", params: { density: 3, levels: 4, selectivity: 0.9 } },
  conveyor: { name: "MyBelt", base: "conveyor", w: 8, d: 1, height: 1, glyph: "arrow", color: "#64748b", params: { unitsPerHr: 240 } },
  station: { name: "MyStation", base: "station", w: 3, d: 2, height: 1.2, glyph: "box", color: "#eab308", params: { cycleSec: 20 } },
  transporter: { name: "LKBox AGV", base: "transporter", w: 4, d: 1, height: 0.9, glyph: "vehicle", color: "#9333ea", params: { speedMps: 1.5, movesPerHr: 40, aisleWidthM: 1.7 } },
  dock: { name: "MyDock", base: "dock", w: 2, d: 1, height: 4.5, glyph: "box", color: "#22c55e", params: { io: "shipping" } },
  zone: { name: "MyZone", base: "zone", w: 5, d: 4, height: 0.5, glyph: "zone", color: "#f59e0b", params: {} },
};
const defs = {};
for (const base of L.BASES) defs[base] = L.define(BASE_INPUT[base]);

check("a custom type of every base registers into WT.domain.ELEMENTS",
  L.BASES.every((b) => defs[b] && D.ELEMENTS[defs[b].id] === defs[b] && L.isCustom(defs[b].id)),
  L.BASES.map((b) => b + "=" + (defs[b] && defs[b].id)).join(" "));

check("base -> domain category: storage is a storage class; every other base is a flow class",
  defs.storage.category === "storage" &&
  ["conveyor", "station", "transporter", "dock", "zone"].every((b) => defs[b].category === "flow"),
  L.BASES.map((b) => b + ":" + defs[b].category).join(" "));

check("behaviour fields present per base (density/cycleSec/unitsPerHr/speedMps/io)",
  finite(defs.storage.density) && defs.storage.levels >= 1 &&
  finite(defs.conveyor.unitsPerHr) && finite(defs.station.cycleSec) && defs.station.stationServer === true &&
  finite(defs.transporter.speedMps) && defs.transporter.transport === true &&
  (defs.dock.io === "shipping") && defs.zone.zoneMark === true);

/* ---------------------------------------------------------------------
 * 2. Storage contributes positions; flow bases hold 0.
 * ------------------------------------------------------------------- */
function cap(base) { return D.elementCapacity({ type: defs[base].id, w: defs[base].w, d: defs[base].d }); }
check("custom STORAGE contributes pallet positions (elementCapacity > 0)", cap("storage") > 0, "positions=" + cap("storage"));
check("custom flow bases hold 0 storage positions",
  ["conveyor", "station", "transporter", "dock", "zone"].every((b) => cap(b) === 0),
  ["conveyor", "station", "transporter", "dock", "zone"].map((b) => b + "=" + cap(b)).join(" "));

/* ---------------------------------------------------------------------
 * 3. Categorised palette tree.
 * ------------------------------------------------------------------- */
const tree = L.paletteTree();
const groupLabels = tree.map((g) => g.label);
check("palette tree carries the seven canonical groups (incl. My Objects)",
  ["Storage & Racking", "Conveying & Sortation", "Stations", "Transport", "Docks & Endpoints", "Zones", "My Objects"]
    .every((g) => groupLabels.indexOf(g) !== -1), groupLabels.join(" | "));
const myObjects = tree.find((g) => g.label === "My Objects");
check("every custom type lands under My Objects (its default category)",
  myObjects && L.BASES.every((b) => myObjects.types.indexOf(defs[b].id) !== -1),
  myObjects ? myObjects.types.join(",") : "none");
check("built-ins still appear under their group (selective-racking under Storage & Racking)",
  (tree.find((g) => g.label === "Storage & Racking") || { types: [] }).types.indexOf("selective-racking") !== -1);
// A custom CATEGORY of its own shows as its own group.
const catDef = L.define({ name: "Special widget", base: "station", category: "Special Kit", w: 2, d: 2, height: 1 });
check("a custom category becomes its own palette group",
  (L.paletteTree().find((g) => g.label === "Special Kit") || { types: [] }).types.indexOf(catDef.id) !== -1);

/* ---------------------------------------------------------------------
 * 4. Placement-ready footprint.
 * ------------------------------------------------------------------- */
check("every custom type has an integer footprint (w,d >= 1) + finite height (placement-ready)",
  L.BASES.every((b) => Number.isInteger(defs[b].w) && defs[b].w >= 1 && Number.isInteger(defs[b].d) && defs[b].d >= 1 && finite(defs[b].heightM) && defs[b].heightM > 0));

/* ---------------------------------------------------------------------
 * 5. Render: draw2D (glyph + icon) + draw3D, no throw, all finite, no mutate.
 * ------------------------------------------------------------------- */
function g2(def, lod) {
  return { x: 20, y: 20, w: def.w * 24, d: def.d * 24, cellPx: 24, color: def.color, theme: "light", lod: lod, glyph: def.glyph, base: def.base, seed: 3 };
}
function o3(def) {
  return { cx: 2, cy: 2, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme: "light", base: def.base, glyph: def.glyph };
}
let d2ok = true, d2fin = true, d3ok = true, d3fin = true, noMutate = true;
for (const b of L.BASES) {
  const def = defs[b];
  // glyph tier (large on-screen) + icon tier (tiny) + dark theme
  for (const lod of [30, 5]) {
    const g = g2(def, lod); const before = JSON.stringify(g);
    const c = makeCtx();
    let r; try { r = S.draw2D(c, def.id, g); } catch (e) { r = false; c._bad.push("throw:" + e.message); }
    if (!r) d2ok = false;
    if (c._bad.length) d2fin = false;
    if (JSON.stringify(g) !== before) noMutate = false;
  }
  const o = o3(def); const ob = JSON.stringify(o);
  const c3 = makeCtx();
  let r3; try { r3 = S.draw3D(c3, def.id, makeP(), o); } catch (e) { r3 = false; c3._bad.push("throw:" + e.message); }
  if (!r3) d3ok = false;
  if (c3._bad.length) d3fin = false;
  if (JSON.stringify(o) !== ob) noMutate = false;
}
check("draw2D renders every custom type (glyph + LOD-icon tier) - returns true", d2ok);
check("draw2D produces only finite coordinates for every custom type", d2fin);
check("draw3D renders every custom type (generic form by base) - returns true", d3ok);
check("draw3D produces only finite coordinates for every custom type", d3fin);
check("neither draw2D nor draw3D mutates its inputs for custom types", noMutate);
// A type with a glyph but no REG entry still draws; an unknown with no glyph is refused.
check("draw2D refuses an unknown type with no glyph (fallback-safe)", S.draw2D(makeCtx(), "no-such-type", { x: 0, y: 0, w: 40, d: 40, cellPx: 20 }) === false);

/* ---------------------------------------------------------------------
 * 6. Sim per base.
 * ------------------------------------------------------------------- */
check("isConnector: custom conveyor + station pass material through the chain",
  D.isConnector({ type: defs.conveyor.id }) === true && D.isConnector({ type: defs.station.id }) === true);
check("isConnector: custom transporter / dock / zone / storage are NOT connectors",
  D.isConnector({ type: defs.transporter.id }) === false && D.isConnector({ type: defs.dock.id }) === false &&
  D.isConnector({ type: defs.zone.id }) === false && D.isConnector({ type: defs.storage.id }) === false);

// A custom shipping-dock touching a custom rack -> the rack is outbound-covered
// (a real flow endpoint), and the built-in helper stays byte-identical for a
// built-in-only layout.
const rack = { id: "r1", type: defs.storage.id, x: 0, y: 0, w: 6, d: 2 };
const cDock = { id: "d1", type: defs.dock.id, x: 0, y: 2, w: 2, d: 1 };
const chains = D.analyzeChains([rack, cDock]);
check("a custom shipping-dock makes a touching custom rack outbound-covered (dock endpoint works)",
  chains.outboundCovered.has("r1"), "covered=" + Array.from(chains.outboundCovered).join(","));

// The live flow sim runs on a MIXED built-in + custom layout, deterministically
// and conserving units - reusing the existing sim path keyed on base.
function mixedLayout() {
  const els = [
    { id: "din", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "cv", type: defs.conveyor.id, x: 2, y: 2, w: 8, d: 1 },
    { id: "rk", type: defs.storage.id, x: 2, y: 4, w: 6, d: 2 },
    { id: "stn", type: defs.station.id, x: 2, y: 8, w: 3, d: 2 },
    { id: "tr", type: defs.transporter.id, x: 8, y: 8, w: 4, d: 1 },
    { id: "dout", type: defs.dock.id, x: 2, y: 12, w: 2, d: 1 },
  ];
  return { elements: els, gridW: 24, gridH: 16, cell: 1, config: {} };
}
function runTicks(layout, opts, n) { const s = F.state(layout, opts); for (let i = 0; i < n; i++) F.step(s, 1); return s; }
function snap(s) {
  return JSON.stringify({ tick: s.tick, spawned: s.spawned, completed: s.completed, inflight: s.inflight,
    mus: s.mus.map((m) => [m.id, m.seg, +m.cx.toFixed(6), +m.cy.toFixed(6), m.stage]) });
}
let simThrew = false, sA, sB;
try { sA = runTicks(mixedLayout(), { seed: 5, loop: true }, 150); sB = runTicks(mixedLayout(), { seed: 5, loop: true }, 150); }
catch (e) { simThrew = true; console.log("   sim threw: " + e.message); }
check("the live flow sim RUNS on a mixed built-in + custom layout (no throw)", !simThrew && !!sA);
check("the flow sim is deterministic on the mixed custom layout", !simThrew && snap(sA) === snap(sB));
{
  let conserved = true;
  if (!simThrew) {
    const s = F.state(mixedLayout(), { seed: 2, loop: true });
    for (let i = 0; i < 200; i++) { F.step(s, 1); if (s.spawned !== s.inflight + s.completed) { conserved = false; break; } }
  }
  check("unit conservation holds on the mixed custom layout (spawned == inflight + completed)", !simThrew && conserved);
}

/* ---------------------------------------------------------------------
 * 7. wt-1 round-trip + BYTE-IDENTICAL no-custom serialization.
 * ------------------------------------------------------------------- */
// A layout WITHOUT custom objects: embedInto adds NOTHING (no `library` key),
// so the serialized bytes are identical to before this feature existed.
const plainLayout = { version: "wt-1", gridW: 40, gridH: 24, cell: 1, elements: [{ id: "el-1", type: "selective-racking", x: 3, y: 3, w: 6, d: 1 }, { id: "el-2", type: "dock-out", x: 10, y: 20, w: 2, d: 1 }], config: { seed: 1 } };
const plainBefore = JSON.stringify(plainLayout);
const plainAfter = JSON.stringify(L.embedInto(JSON.parse(plainBefore), plainLayout.elements));
check("a layout WITHOUT custom objects serializes BYTE-IDENTICALLY (no `library` key added)",
  plainAfter === plainBefore && plainAfter.indexOf("library") === -1);

// A layout WITH custom objects: embedInto adds the used defs; rebuildFrom
// re-registers them; the def is preserved across the round-trip.
const custLayout = {
  version: "wt-1", gridW: 24, gridH: 16, cell: 1,
  elements: [{ id: "el-1", type: defs.storage.id, x: 0, y: 0, w: 6, d: 2 }, { id: "el-2", type: defs.station.id, x: 0, y: 4, w: 3, d: 2 }],
  config: {},
};
const embedded = L.embedInto(JSON.parse(JSON.stringify(custLayout)), custLayout.elements);
check("embedInto embeds ONLY the custom defs the layout uses",
  Array.isArray(embedded.library) && embedded.library.length === 2 &&
  embedded.library.some((t) => t.id === defs.storage.id) && embedded.library.some((t) => t.id === defs.station.id));

// Simulate opening the layout in a FRESH registry: remove the customs, then
// rebuild from the embedded defs. The types must resolve again + match.
const beforeStorageDef = JSON.stringify(D.ELEMENTS[defs.storage.id]);
L.remove(defs.storage.id);
L.remove(defs.station.id);
const goneBefore = !D.ELEMENTS[defs.storage.id] && !D.ELEMENTS[defs.station.id];
const rebuilt = L.rebuildFrom(embedded);
check("rebuildFrom re-registers the layout's embedded custom defs on deserialize",
  goneBefore && rebuilt === 2 && !!D.ELEMENTS[defs.storage.id] && !!D.ELEMENTS[defs.station.id],
  "gone=" + goneBefore + " rebuilt=" + rebuilt);
check("the rebuilt custom def is preserved (byte-identical to the original)",
  JSON.stringify(D.ELEMENTS[defs.storage.id]) === beforeStorageDef);

/* ---------------------------------------------------------------------
 * 8. Import / export round-trip.
 * ------------------------------------------------------------------- */
const exported = L.exportJson();
check("exportJson emits a versioned `types` array covering the current library",
  (() => { try { const o = JSON.parse(exported); return o && Array.isArray(o.types) && o.types.length >= 6; } catch (_) { return false; } })());
// Import a brand-new object from JSON.
const impRes = L.importJson(JSON.stringify({ version: "wt-lib-1", types: [{ label: "Imported box", base: "station", w: 2, d: 2, heightM: 1, color: "#123456", glyph: "box", paletteCategory: "My Objects", params: { cycleSec: 15 } }] }));
check("importJson registers a new object from JSON", impRes.added >= 1 && (L.paletteTree().find((g) => g.label === "My Objects") || { types: [] }).types.some((t) => D.ELEMENTS[t] && D.ELEMENTS[t].label === "Imported box"), "added=" + impRes.added);
check("importJson rejects invalid JSON gracefully", L.importJson("{not json").ok === false);

/* ---------------------------------------------------------------------
 * 9. Determinism of buildDef (pure function of input).
 * ------------------------------------------------------------------- */
const inp = { id: "u-fixed", name: "Fixed", base: "storage", w: 4, d: 2, height: 5, color: "#abcdef", glyph: "rack", params: { density: 2.5, levels: 3, selectivity: 1 } };
check("buildDef is a pure, deterministic function of its input",
  JSON.stringify(L.buildDef(inp)) === JSON.stringify(L.buildDef(inp)));
check("buildDef clamps a bad footprint to a safe integer range",
  (() => { const d = L.buildDef({ name: "x", base: "storage", w: 0, d: -3, height: 999 }); return d.w >= 1 && d.d >= 1 && d.heightM <= 60; })());

/* ---------------------------------------------------------------------
 * 10. Clone a built-in SEED into a custom (built-in not removed).
 * ------------------------------------------------------------------- */
const cloned = L.clone("asrs", "My AS/RS");
check("cloning a built-in SEED creates a custom + leaves the built-in intact",
  cloned && cloned.custom === true && cloned.base === "storage" && D.ELEMENTS["asrs"] && !D.ELEMENTS["asrs"].custom,
  cloned ? cloned.id : "none");

/* ---------------------------------------------------------------------
 * 11. Offline + determinism source scan + honesty labels.
 * ------------------------------------------------------------------- */
check("library.js references no external asset / URL (offline)",
  !/https?:\/\//i.test(LIB_SRC));
check("library.js is deterministic: NO Date, NO Math.random in the logic",
  !/\bnew\s+Date\b/.test(LIB_SRC) && !/\bDate\.now\b/.test(LIB_SRC) && !/Math\.random\b/.test(LIB_SRC));
check("honesty labels present (illustrative / NOT a vendor spec)",
  /[Ii]llustrative/.test(LIB_SRC) && /NOT a vendor spec/.test(LIB_SRC));

/* ---------------------------------------------------------------------
 * 12. v2.5 FACTORY-A: Warehouse / Factory MODE switch filters the palette.
 * The six manufacturing built-ins land in the "Production / Assembly"
 * group; Warehouse mode HIDES that group; Factory (and the default) SHOWS
 * it; nothing else changes and nothing is deleted (both modes reachable).
 * ------------------------------------------------------------------- */
const MFG = ["mfg-source", "mfg-drain", "mfg-station", "mfg-parallel-station", "mfg-assembly", "mfg-dismantle"];
const PROD = L.PRODUCTION || "Production / Assembly";
const groupOf = (treeArr, label) => treeArr.find((g) => g.label === label) || null;

const facTree = L.paletteTree({ mode: "factory" });
const whTree = L.paletteTree({ mode: "warehouse" });
const defTree = L.paletteTree(); // no mode = show everything (byte-compatible default)

const prodFactory = groupOf(facTree, PROD);
check("FACTORY-A: the six manufacturing components land in the Production / Assembly group (Factory mode)",
  !!prodFactory && MFG.every((t) => prodFactory.types.indexOf(t) !== -1),
  prodFactory ? prodFactory.types.join(",") : "no Production group");

check("FACTORY-A: Warehouse mode HIDES the Production / Assembly group; Factory + default SHOW it",
  groupOf(whTree, PROD) === null && !!groupOf(facTree, PROD) && !!groupOf(defTree, PROD),
  "warehouse=" + (groupOf(whTree, PROD) ? "present" : "hidden") +
  " factory=" + (groupOf(facTree, PROD) ? "shown" : "MISSING") +
  " default=" + (groupOf(defTree, PROD) ? "shown" : "MISSING"));

check("FACTORY-A: the mode switch removes NOTHING else - the warehouse groups are identical across modes",
  ["Storage & Racking", "Conveying & Sortation", "Stations", "Transport", "Docks & Endpoints", "Zones"].every((lbl) => {
    const a = groupOf(whTree, lbl), b = groupOf(facTree, lbl);
    return a && b && a.types.join(",") === b.types.join(",");
  }), "warehouse groups unchanged between modes");

check("FACTORY-A: cloning a manufacturing built-in SEED keeps its base (mfg-station -> station) and leaves the built-in intact",
  (() => { const c = L.clone("mfg-station", "My machine"); return c && c.custom === true && c.base === "station" && D.ELEMENTS["mfg-station"] && !D.ELEMENTS["mfg-station"].custom; })());

/* ---------------------------------------------------------------------
 * Summary.
 * ------------------------------------------------------------------- */
console.log("");
console.log(failures === 0 ? ("ALL " + checks + " CHECKS PASSED") : (failures + " OF " + checks + " CHECKS FAILED"));
process.exit(failures === 0 ? 0 : 1);
