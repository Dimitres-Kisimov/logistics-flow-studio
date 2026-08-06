/* =====================================================================
 * verify_shapes.js - per-type SHAPE REGISTRY (2D glyph + 3D form) checks.
 *
 * Runs the REAL shape module (shapes.js) in Node with the same window shim
 * the other harnesses use. shapes.js is a PURE drawing module: it takes a
 * canvas ctx plus plain geometry/colour and draws. The actual pixels are
 * only verifiable LIVE in the browser, but everything the draw calls route
 * through is finite math, so we exercise EVERY draw path against a mock 2D
 * context that records every coordinate and flags any non-finite value or
 * throw. domain.js is loaded too so we prove the registry covers EXACTLY
 * the domain element types and that the 3D forms use the domain heightM.
 *
 * The key quality gate (a pure-draw feature that can't be pixel-tested
 * headlessly): a mock-context SMOKE TEST that draws EVERY type in BOTH 2D
 * and 3D, in light + dark, at small AND large scale (so the Level-Of-Detail
 * path is exercised), asserting NO throw and NO non-finite coordinate.
 *
 * Checks (all deterministic):
 *   - has(type) is true for EVERY domain element type (2D AND 3D defined)
 *   - the registry covers EXACTLY the domain types (no orphans, none missing)
 *   - meta + ICONS cover exactly those types (non-empty descriptions/fns)
 *   - draw2D smoke: every type x {light,dark} x {small,large} - no throw,
 *     all-finite coords, and the LOD path is distinct (full glyph draws
 *     more than the zoomed-out icon)
 *   - draw3D smoke: every type x {light,dark} - no throw, all-finite coords
 *   - draw3D uses the height: a taller heightM raises the form on screen
 *     (top y decreases) for every type
 *   - neither draw2D nor draw3D mutates its inputs
 *   - unknown types: has() false, draw2D/draw3D return false without throwing
 *   - known types: draw2D/draw3D return true
 *   - honesty labels present (illustrative / NOT CAD / NOT BIM / no brands)
 *   - offline: no external asset reference in the module
 *
 * Usage:  node verify_shapes.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // domain.js + shapes.js attach themselves to window.WT
// A matchMedia shim is not needed here (shapes.js reads no app state), but
// define a harmless one in case future edits reference it.
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "domain.js"), "utf8"));
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "shapes.js"), "utf8"));
const S = global.WT.shapes;
const D = global.WT.domain;
const SRC = fs.readFileSync(path.join(__dirname, "shapes.js"), "utf8");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

const TYPES = Object.keys(D.ELEMENTS);
const THEMES = ["light", "dark"];

/* ---- Recording mock 2D context ----------------------------------- */
function makeCtx() {
  const ctx = { _bad: [], _calls: 0, _minY: Infinity, _maxY: -Infinity };
  const num = (name, args) => {
    ctx._calls++;
    for (const n of args) if (typeof n === "number" && !isFinite(n)) ctx._bad.push(name + "=" + n);
  };
  const trackY = (y) => { if (typeof y === "number" && isFinite(y)) { if (y < ctx._minY) ctx._minY = y; if (y > ctx._maxY) ctx._maxY = y; } };
  ctx.save = () => {}; ctx.restore = () => {};
  ctx.beginPath = () => {}; ctx.closePath = () => {};
  ctx.moveTo = (x, y) => { num("moveTo", [x, y]); trackY(y); };
  ctx.lineTo = (x, y) => { num("lineTo", [x, y]); trackY(y); };
  ctx.arc = (x, y, r, a, b) => { num("arc", [x, y, r, a, b]); trackY(y); };
  ctx.arcTo = (x1, y1, x2, y2, r) => { num("arcTo", [x1, y1, x2, y2, r]); };
  ctx.rect = (x, y, w, h) => { num("rect", [x, y, w, h]); trackY(y); trackY(y + h); };
  ctx.fillRect = (x, y, w, h) => { num("fillRect", [x, y, w, h]); trackY(y); trackY(y + h); };
  ctx.strokeRect = (x, y, w, h) => { num("strokeRect", [x, y, w, h]); trackY(y); trackY(y + h); };
  ctx.fill = () => {}; ctx.stroke = () => {};
  ctx.setLineDash = (a) => { if (Array.isArray(a)) for (const n of a) { if (typeof n === "number" && !isFinite(n)) ctx._bad.push("dash=" + n); } };
  ctx.measureText = (t) => ({ width: String(t).length * 6 });
  ctx.fillText = () => {}; ctx.strokeText = () => {};
  // settable style props (plain fields; assignment must never throw)
  ctx.fillStyle = ""; ctx.strokeStyle = ""; ctx.lineWidth = 1; ctx.lineJoin = "";
  ctx.font = ""; ctx.textAlign = ""; ctx.textBaseline = ""; ctx.globalAlpha = 1;
  return ctx;
}
// A deterministic 2:1-dimetric-style projection: finite for finite input.
function makeP() {
  return (cx, cy, cz) => ({ x: 400 + (cx - cy) * 18, y: 260 + (cx + cy) * 9 - (cz || 0) * 6 });
}

console.log("Per-type shape registry (2D glyph + 3D form) verification");
console.log("");

/* ---- 1. has(type) true for EVERY domain type (2D AND 3D) --------- */
(() => {
  const missing = TYPES.filter((t) => S.has(t) !== true);
  check("has(type) is true for every domain element type (2D + 3D both defined)",
    missing.length === 0,
    missing.length ? "missing " + missing.join(",") : TYPES.length + " types covered");
})();

/* ---- 2. Registry covers EXACTLY the domain types (no orphans) ---- */
(() => {
  const dom = TYPES.slice().sort();
  const reg = S.types().slice().sort();
  const extra = reg.filter((t) => dom.indexOf(t) < 0);
  const gone = dom.filter((t) => reg.indexOf(t) < 0);
  check("the registry covers exactly the domain types (no orphans, none missing)",
    extra.length === 0 && gone.length === 0 && reg.length === dom.length,
    "reg=" + reg.length + " dom=" + dom.length + (extra.length ? " extra=" + extra.join(",") : "") + (gone.length ? " missing=" + gone.join(",") : ""));
})();

/* ---- 3. meta + ICONS cover exactly the types -------------------- */
(() => {
  const metaKeys = Object.keys(S.meta).sort();
  const iconKeys = Object.keys(S.ICONS).sort();
  const dom = TYPES.slice().sort();
  const metaOk = metaKeys.length === dom.length && metaKeys.every((k, i) => k === dom[i]);
  const iconOk = iconKeys.length === dom.length && iconKeys.every((k, i) => k === dom[i]);
  const descOk = TYPES.every((t) => S.meta[t] && String(S.meta[t].glyph2d).length > 3 && String(S.meta[t].form3d).length > 3);
  const fnOk = TYPES.every((t) => typeof S.ICONS[t] === "function");
  check("meta + ICONS cover exactly the types (non-empty 2D/3D descriptions + icon fns)",
    metaOk && iconOk && descOk && fnOk,
    "meta=" + metaKeys.length + " icons=" + iconKeys.length + " descOk=" + descOk + " fnOk=" + fnOk);
})();

/* ---- 4. draw2D SMOKE: every type, both themes, small+large scale  */
(() => {
  let bad = 0, badType = null, notFinite = null, lodFail = null, retFail = null;
  const cell = 20;
  for (const t of TYPES) {
    const def = D.ELEMENTS[t];
    const pw = def.w * cell, ph = def.d * cell;
    for (const theme of THEMES) {
      // small scale (on-screen ~3 px/cell -> LOD icon path)
      const cs = makeCtx();
      let okS = true;
      try { okS = S.draw2D(cs, t, { x: 100, y: 80, w: pw, d: ph, cellPx: cell, color: def.color, theme, lod: 3 }); }
      catch (e) { bad++; badType = t + " small/" + theme + ": " + e.message; okS = false; }
      // large scale (on-screen ~44 px/cell -> full glyph path)
      const cl = makeCtx();
      let okL = true;
      try { okL = S.draw2D(cl, t, { x: 100, y: 80, w: pw, d: ph, cellPx: cell, color: def.color, theme, lod: 44 }); }
      catch (e) { bad++; badType = t + " large/" + theme + ": " + e.message; okL = false; }
      if (okS !== true || okL !== true) retFail = t + "/" + theme + " ret=" + okS + "," + okL;
      if (cs._bad.length || cl._bad.length) notFinite = t + "/" + theme + " " + (cs._bad[0] || cl._bad[0]);
      // LOD distinct: the full glyph must draw more than the zoomed-out icon
      if (!(cl._calls > cs._calls)) lodFail = t + "/" + theme + " small=" + cs._calls + " large=" + cl._calls;
    }
  }
  check("draw2D smoke: every type x light/dark x small/large draws with no throw + all finite",
    bad === 0 && notFinite === null && retFail === null,
    bad ? "throw " + badType : (notFinite ? "non-finite " + notFinite : (retFail ? "ret " + retFail : (TYPES.length * 2 * 2) + " draws clean")));
  check("draw2D LOD path is exercised (full glyph draws more than the zoomed-out icon)",
    lodFail === null, lodFail || "full > icon for all types/themes");
})();

/* ---- 5. draw3D SMOKE: every type, both themes ------------------- */
(() => {
  let bad = 0, badType = null, notFinite = null, retFail = null;
  const P = makeP();
  for (const t of TYPES) {
    const def = D.ELEMENTS[t];
    for (const theme of THEMES) {
      const c = makeCtx();
      let ok = true;
      try {
        ok = S.draw3D(c, t, P, { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM || 6, color: def.color, theme, selected: true, selColor: "#38bdf8" });
      } catch (e) { bad++; badType = t + "/" + theme + ": " + e.message; ok = false; }
      if (ok !== true) retFail = t + "/" + theme + " ret=" + ok;
      if (c._bad.length) notFinite = t + "/" + theme + " " + c._bad[0];
    }
  }
  check("draw3D smoke: every type x light/dark draws (incl. selection) with no throw + all finite",
    bad === 0 && notFinite === null && retFail === null,
    bad ? "throw " + badType : (notFinite ? "non-finite " + notFinite : (retFail ? "ret " + retFail : (TYPES.length * 2) + " forms clean")));
})();

/* ---- 6. draw3D uses the height (taller -> higher on screen) ------ */
(() => {
  const P = makeP();
  let fail = null;
  for (const t of TYPES) {
    const def = D.ELEMENTS[t];
    const cLow = makeCtx(); S.draw3D(cLow, t, P, { cx: 4, cy: 3, w: def.w, d: def.d, heightM: 2, color: def.color, theme: "light" });
    const cHigh = makeCtx(); S.draw3D(cHigh, t, P, { cx: 4, cy: 3, w: def.w, d: def.d, heightM: 25, color: def.color, theme: "light" });
    // In this projection +z decreases screen-y, so a taller form must reach
    // a SMALLER minimum y. Proves the form is extruded by heightM, not flat.
    if (!(cHigh._minY < cLow._minY - 1e-6)) fail = t + " low.minY=" + cLow._minY.toFixed(1) + " high.minY=" + cHigh._minY.toFixed(1);
  }
  check("draw3D forms use the domain heightM (a taller element rises on screen) for every type",
    fail === null, fail || "monotonic in height for all " + TYPES.length + " types");
})();

/* ---- 7. draw2D does not mutate its inputs ----------------------- */
(() => {
  const P = makeP();
  let fail = null;
  for (const t of TYPES) {
    const def = D.ELEMENTS[t];
    const g = { x: 100, y: 80, w: def.w * 20, d: def.d * 20, cellPx: 20, color: def.color, theme: "dark", lod: 44 };
    const before = JSON.stringify(g);
    S.draw2D(makeCtx(), t, g);
    if (JSON.stringify(g) !== before) fail = t;
  }
  check("draw2D does not mutate its geometry/colour input", fail === null, fail ? "mutated for " + fail : "inputs unchanged for all types");
})();

/* ---- 8. draw3D does not mutate its inputs ----------------------- */
(() => {
  const P = makeP();
  let fail = null;
  for (const t of TYPES) {
    const def = D.ELEMENTS[t];
    const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM || 6, color: def.color, theme: "dark", selected: true, selColor: "#38bdf8" };
    const before = JSON.stringify(o);
    S.draw3D(makeCtx(), t, P, o);
    if (JSON.stringify(o) !== before) fail = t;
  }
  check("draw3D does not mutate its geometry/colour input", fail === null, fail ? "mutated for " + fail : "inputs unchanged for all types");
})();

/* ---- 9. Unknown types are safe (false, no throw) ---------------- */
(() => {
  const P = makeP();
  let threw = null, r2 = null, r3 = null;
  try {
    const hasBogus = S.has("no-such-type");
    r2 = S.draw2D(makeCtx(), "no-such-type", { x: 0, y: 0, w: 40, d: 40, cellPx: 20, color: "#123456", theme: "light", lod: 44 });
    r3 = S.draw3D(makeCtx(), "no-such-type", P, { cx: 0, cy: 0, w: 2, d: 2, heightM: 5, color: "#123456", theme: "light" });
    check("an unknown type is safe: has() false and draw2D/draw3D return false without throwing",
      hasBogus === false && r2 === false && r3 === false,
      "has=" + hasBogus + " draw2D=" + r2 + " draw3D=" + r3);
  } catch (e) { threw = e.message; check("an unknown type is safe (no throw)", false, "threw " + threw); }
})();

/* ---- 10. Known types return true -------------------------------- */
(() => {
  const P = makeP();
  const def = D.ELEMENTS["selective-racking"];
  const r2 = S.draw2D(makeCtx(), "selective-racking", { x: 0, y: 0, w: def.w * 20, d: def.d * 20, cellPx: 20, color: def.color, theme: "light", lod: 44 });
  const r3 = S.draw3D(makeCtx(), "selective-racking", P, { cx: 0, cy: 0, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme: "light" });
  check("draw2D and draw3D return true for a known type", r2 === true && r3 === true, "draw2D=" + r2 + " draw3D=" + r3);
})();

/* ---- 11. Honesty labels present in the module ------------------- */
(() => {
  const illustrative = /ILLUSTRATIVE/i.test(SRC);
  const notCad = /NOT CAD/i.test(SRC);
  const notBim = /NOT BIM/i.test(SRC);
  const noBrands = /No real brands/i.test(SRC);
  check("honesty labels present (illustrative / NOT CAD / NOT BIM / no real brands)",
    illustrative && notCad && notBim && noBrands,
    "illustrative=" + illustrative + " notCAD=" + notCad + " notBIM=" + notBim + " noBrands=" + noBrands);
})();

/* ---- 12. Offline: no external asset reference ------------------- */
(() => {
  const ext = /(?:src|href)\s*=\s*["']https?:\/\//i.test(SRC) || /url\(\s*["']?https?:\/\//i.test(SRC) || /fetch\(\s*["'`]https?:\/\//i.test(SRC) || /https?:\/\//i.test(SRC);
  check("offline: shapes.js references no external asset (no http(s) URL)", !ext, ext ? "external ref found" : "clean");
})();

/* =====================================================================
 * v1.9 "more equipment types" - focused checks for the eight NEW types.
 * The smoke tests above already cover them (they iterate every domain
 * type); these assert the NEW set specifically: registered + palette-
 * listed, honest capacity (0 for the handling/support types, > 0 for the
 * storage ones), a focused non-mutating draw smoke, and that the two new
 * ANIMATABLE forms actually move their part across phases.
 * ===================================================================== */
const NEW_TYPES = ["pick-to-light", "vna", "forklift", "charging-station", "sorter", "stretch-wrap", "returns-station", "gate"];
const STORAGE_NEW = ["pick-to-light", "vna"];
const FLOW_NEW = ["forklift", "charging-station", "sorter", "stretch-wrap", "returns-station", "gate"];

/* ---- 13. new types are in the domain, the shape registry + palette -- */
(() => {
  const inDomain = NEW_TYPES.filter((t) => !D.ELEMENTS[t]);
  const noShape = NEW_TYPES.filter((t) => S.has(t) !== true);
  const notInPalette = NEW_TYPES.filter((t) => (D.paletteOrder || []).indexOf(t) < 0);
  check("v1.9 new equipment types are in the domain, the shape registry (2D+3D) and the palette",
    inDomain.length === 0 && noShape.length === 0 && notInPalette.length === 0,
    (inDomain.length ? "not in domain: " + inDomain.join(",") : "") +
    (noShape.length ? " no shape: " + noShape.join(",") : "") +
    (notInPalette.length ? " not in palette: " + notInPalette.join(",") : "") ||
    NEW_TYPES.length + " new types covered");
})();

/* ---- 14. honest capacity (0 handling/support, > 0 storage) --------- */
(() => {
  let fail = null;
  for (const t of FLOW_NEW) {
    const def = D.ELEMENTS[t];
    const cap = D.elementCapacity({ type: t, w: def.w, d: def.d });
    if (cap !== 0) { fail = t + " (flow) capacity=" + cap + " (must be 0)"; break; }
  }
  if (!fail) for (const t of STORAGE_NEW) {
    const def = D.ELEMENTS[t];
    const cap = D.elementCapacity({ type: t, w: def.w, d: def.d });
    if (!(cap > 0)) { fail = t + " (storage) capacity=" + cap + " (must be > 0)"; break; }
  }
  check("v1.9 new types: elementCapacity is 0 for the six handling/support types and > 0 for the two storage types",
    fail === null, fail || "6 flow @ 0 positions, 2 storage > 0");
})();

/* ---- 15. focused new-type draw smoke + no mutation ---------------- */
(() => {
  const P = makeP();
  const cell = 20;
  let bad = null, notFinite = null, mutated = null;
  for (const t of NEW_TYPES) {
    const def = D.ELEMENTS[t];
    for (const theme of THEMES) {
      for (const lod of [3, 44]) {
        const g = { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme, lod };
        const before = JSON.stringify(g);
        const c = makeCtx();
        try { if (S.draw2D(c, t, g) !== true) bad = bad || t + " draw2D returned non-true"; }
        catch (e) { bad = bad || t + " 2D/" + theme + "/" + lod + ": " + e.message; }
        if (c._bad.length) notFinite = notFinite || t + " 2D " + c._bad[0];
        if (JSON.stringify(g) !== before) mutated = mutated || t + " (2D)";
      }
      const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme, selected: true, selColor: "#38bdf8" };
      const beforeO = JSON.stringify(o);
      const c3 = makeCtx();
      try { if (S.draw3D(c3, t, P, o) !== true) bad = bad || t + " draw3D returned non-true"; }
      catch (e) { bad = bad || t + " 3D/" + theme + ": " + e.message; }
      if (c3._bad.length) notFinite = notFinite || t + " 3D " + c3._bad[0];
      if (JSON.stringify(o) !== beforeO) mutated = mutated || t + " (3D)";
    }
  }
  check("v1.9 new types: every new type draws 2D+3D x light/dark x small/large - no throw, all finite, no mutation",
    bad === null && notFinite === null && mutated === null,
    bad || notFinite || (mutated ? "mutated " + mutated : NEW_TYPES.length + " new types x themes x scales clean"));
})();

/* ---- 16. new ANIMATABLE forms move their part across phases -------- */
(() => {
  // A minimal recording context: captures every drawn coordinate so two
  // phases can be compared. If a moving part exists, the coords differ.
  function recCtx() {
    const pts = [];
    const rec = (x, y) => { if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) pts.push(Math.round(x * 100) + "," + Math.round(y * 100)); };
    return {
      _pts: pts,
      save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
      moveTo(x, y) { rec(x, y); }, lineTo(x, y) { rec(x, y); }, arc(x, y) { rec(x, y); }, arcTo() {},
      rect(x, y) { rec(x, y); }, fillRect(x, y) { rec(x, y); }, strokeRect(x, y) { rec(x, y); },
      setLineDash() {}, measureText(t) { return { width: String(t).length * 6 }; }, fillText() {}, strokeText() {},
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
    };
  }
  const cell = 20;
  let fail = null;
  for (const t of ["sorter", "stretch-wrap"]) {
    const def = D.ELEMENTS[t];
    const draw = (anim) => {
      const c = recCtx();
      S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, anim });
      return c._pts.join("|");
    };
    if (draw(0.05) === draw(0.55)) fail = t + " did not move between phases";
  }
  check("v1.9 new animatable types (sorter loop, stretch-wrap arm) move their part across anim phases",
    fail === null, fail || "sorter + stretch-wrap animate");
})();

/* =====================================================================
 * v2.1 CURVED CONVEYOR + WORKER FIGURES - focused checks.
 * The all-types smoke above already exercises conveyor-curve and the manned
 * stations; these assert the NEW behaviour specifically: the curved segment is
 * registered/palette-listed with 0 capacity, draws in all 4 corner
 * orientations (2D+3D, light/dark, small/large) without throwing or mutating,
 * its belt animates + is a DISTINCT glyph from the straight belt, each corner
 * orientation is geometrically distinct, and a WORKER FIGURE renders at manned
 * stations (rich tier only, animated, LOD-gated).
 * ===================================================================== */
const CURVE = "conveyor-curve";
const ARCS = ["tr", "br", "bl", "tl"];
const MANNED = ["pack-station", "returns-station", "push-station", "pull-station"];

// A recording context that logs every drawn coordinate (for movement diffs)
// and flags non-finite values.
function recCtx() {
  const pts = [], bad = [];
  const rec = (x, y) => { if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) pts.push(Math.round(x * 100) + "," + Math.round(y * 100)); };
  const num = (n, a) => { for (const v of a) if (typeof v === "number" && !isFinite(v)) bad.push(n + "=" + v); };
  return {
    _pts: pts, _bad: bad,
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo(x, y) { num("moveTo", [x, y]); rec(x, y); }, lineTo(x, y) { num("lineTo", [x, y]); rec(x, y); },
    arc(x, y, r, a, b) { num("arc", [x, y, r, a, b]); rec(x, y); }, arcTo() {},
    rect(x, y, w, h) { num("rect", [x, y, w, h]); rec(x, y); }, fillRect(x, y, w, h) { num("fillRect", [x, y, w, h]); rec(x, y); }, strokeRect(x, y, w, h) { num("strokeRect", [x, y, w, h]); rec(x, y); },
    setLineDash() {}, measureText(t) { return { width: String(t).length * 6 }; }, fillText() {}, strokeText() {},
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  };
}

/* ---- 18. curved conveyor: domain + registry + palette + 0 capacity --- */
(() => {
  const inDomain = !!D.ELEMENTS[CURVE];
  const inReg = S.has(CURVE) === true;
  const inPalette = (D.paletteOrder || []).indexOf(CURVE) >= 0;
  const def = D.ELEMENTS[CURVE] || {};
  const cap = D.elementCapacity({ type: CURVE, w: def.w || 3, d: def.d || 3 });
  check("curved conveyor is in the domain, the shape registry (2D+3D) and the palette, with a 0-capacity (flow) schema",
    inDomain && inReg && inPalette && cap === 0,
    "domain=" + inDomain + " reg=" + inReg + " palette=" + inPalette + " capacity=" + cap);
})();

/* ---- 19. curved conveyor 2D+3D smoke: 4 orientations x themes x scales  */
(() => {
  const cell = 20, def = D.ELEMENTS[CURVE], P = makeP();
  let bad = null, notFinite = null, ret = null, mutated = null;
  for (const arc of ARCS) {
    for (const theme of THEMES) {
      for (const lod of [3, 44]) {
        const g = { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme, lod, arc, anim: 0.3 };
        const before = JSON.stringify(g);
        const c = makeCtx();
        try { if (S.draw2D(c, CURVE, g) !== true) ret = ret || "2D " + arc + "/" + theme + "/" + lod; }
        catch (e) { bad = bad || "2D " + arc + ": " + e.message; }
        if (c._bad.length) notFinite = notFinite || "2D " + arc + " " + c._bad[0];
        if (JSON.stringify(g) !== before) mutated = mutated || "2D " + arc;
      }
      const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme, arc, lod: 60, anim: 0.3, selected: true, selColor: "#38bdf8" };
      const beforeO = JSON.stringify(o);
      const c3 = makeCtx();
      try { if (S.draw3D(c3, CURVE, P, o) !== true) ret = ret || "3D " + arc + "/" + theme; }
      catch (e) { bad = bad || "3D " + arc + ": " + e.message; }
      if (c3._bad.length) notFinite = notFinite || "3D " + arc + " " + c3._bad[0];
      if (JSON.stringify(o) !== beforeO) mutated = mutated || "3D " + arc;
    }
  }
  check("curved conveyor draws 2D+3D across all 4 corner orientations x light/dark x small/large - no throw, all finite, no mutation",
    !bad && !notFinite && !ret && !mutated,
    bad || notFinite || (ret ? "ret " + ret : (mutated ? "mutated " + mutated : (ARCS.length * 2 * 2) + " 2D + " + (ARCS.length * 2) + " 3D draws clean")));
})();

/* ---- 20. curved belt animates + is a DISTINCT glyph from the straight - */
(() => {
  const cell = 20, def = D.ELEMENTS[CURVE], sDef = D.ELEMENTS["conveyor"];
  const drawC = (anim) => { const c = recCtx(); S.draw2D(c, CURVE, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, arc: "tr", anim }); return c._pts.join("|"); };
  const moves = drawC(0.05) !== drawC(0.55);
  const cCurve = recCtx(); S.draw2D(cCurve, CURVE, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, arc: "tr" });
  const cStr = recCtx(); S.draw2D(cStr, "conveyor", { x: 100, y: 80, w: sDef.w * cell, d: sDef.d * cell, cellPx: cell, color: sDef.color, theme: "light", lod: 44 });
  const distinct = cCurve._pts.join("|") !== cStr._pts.join("|");
  check("curved belt animates (unit-loads scroll along the arc across phases) and is a DISTINCT glyph from the straight belt bed",
    moves && distinct, "moves=" + moves + " distinct=" + distinct);
})();

/* ---- 21. each of the 4 corner orientations renders a distinct arc ---- */
(() => {
  const cell = 20, def = D.ELEMENTS[CURVE];
  const draw = (arc) => { const c = recCtx(); S.draw2D(c, CURVE, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, arc }); return c._pts.join("|"); };
  const uniq = new Set(ARCS.map(draw));
  check("the 4 curved-conveyor corner orientations each render a distinct arc geometry",
    uniq.size === ARCS.length, uniq.size + "/" + ARCS.length + " distinct");
})();

/* ---- 22. WORKER FIGURE at manned stations: rich adds it + animates + LOD-gated */
(() => {
  const cell = 20;
  let addFail = null, moveFail = null, gateFail = null;
  const draw = (t, lod, anim) => { const def = D.ELEMENTS[t]; const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod, anim, seed: 5 }); return c; };
  for (const t of MANNED) {
    const glyphN = draw(t, 24)._pts.length;
    const richN = draw(t, 60)._pts.length;
    if (!(richN > glyphN)) addFail = addFail || t + " (rich " + richN + " !> glyph " + glyphN + ")";
    const a = draw(t, 60, 0.12)._pts.join("|");
    const b = draw(t, 60, 0.63)._pts.join("|");
    if (a === b) moveFail = moveFail || t + " (worker static across phases at rich)";
    const justBelow = draw(t, S.DETAIL_RICH_MIN - 0.5)._pts.join("|");
    const midGlyph = draw(t, 24)._pts.join("|");
    if (justBelow !== midGlyph) gateFail = gateFail || t + " (below-threshold != mid glyph)";
  }
  check("worker figures render at manned stations (rich tier ADDS the figure), animate across phases, and are LOD-gated to the zoomed-in tier",
    !addFail && !moveFail && !gateFail, addFail || moveFail || gateFail || MANNED.length + " manned stations OK");
})();

/* =====================================================================
 * v2.5 FACTORY-A "manufacturing components" - focused checks for the six
 * NEW Production / Assembly types. The all-types smoke above already
 * exercises them; these assert the NEW set specifically: registered +
 * palette-listed + a DECLARED base behaviour (dock/station) so they ride
 * the flow machinery, 0 capacity (all flow), a focused non-mutating 2D+3D
 * draw smoke, that the six glyphs are all DISTINCT, and that the process
 * station animates its through-part.
 * ===================================================================== */
const MFG_TYPES = ["mfg-source", "mfg-drain", "mfg-station", "mfg-parallel-station", "mfg-assembly", "mfg-dismantle"];
const MFG_BASE = { "mfg-source": "dock", "mfg-drain": "dock", "mfg-station": "station", "mfg-parallel-station": "station", "mfg-assembly": "station", "mfg-dismantle": "station" };

/* ---- 23. mfg types: domain + registry + palette + base + 0 capacity - */
(() => {
  const inDomain = MFG_TYPES.filter((t) => !D.ELEMENTS[t]);
  const noShape = MFG_TYPES.filter((t) => S.has(t) !== true);
  const notInPalette = MFG_TYPES.filter((t) => (D.paletteOrder || []).indexOf(t) < 0);
  const badBase = MFG_TYPES.filter((t) => D.elementBase(t) !== MFG_BASE[t]);
  const badCap = MFG_TYPES.filter((t) => { const def = D.ELEMENTS[t] || {}; return D.elementCapacity({ type: t, w: def.w, d: def.d }) !== 0; });
  check("v2.5 FACTORY-A components are in the domain, the shape registry (2D+3D), the palette, declare a base (dock/station) and are 0-capacity (flow)",
    inDomain.length === 0 && noShape.length === 0 && notInPalette.length === 0 && badBase.length === 0 && badCap.length === 0,
    (inDomain.length ? "not in domain: " + inDomain.join(",") : "") +
    (noShape.length ? " no shape: " + noShape.join(",") : "") +
    (notInPalette.length ? " not in palette: " + notInPalette.join(",") : "") +
    (badBase.length ? " wrong base: " + badBase.join(",") : "") +
    (badCap.length ? " nonzero capacity: " + badCap.join(",") : "") ||
    MFG_TYPES.length + " manufacturing components covered");
})();

/* ---- 24. focused mfg draw smoke (2D+3D x themes x scales), no mutation */
(() => {
  const P = makeP();
  const cell = 20;
  let bad = null, notFinite = null, mutated = null;
  for (const t of MFG_TYPES) {
    const def = D.ELEMENTS[t];
    for (const theme of THEMES) {
      for (const lod of [3, 44]) {
        const g = { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme, lod, anim: 0.3 };
        const before = JSON.stringify(g);
        const c = makeCtx();
        try { if (S.draw2D(c, t, g) !== true) bad = bad || t + " draw2D returned non-true"; }
        catch (e) { bad = bad || t + " 2D/" + theme + "/" + lod + ": " + e.message; }
        if (c._bad.length) notFinite = notFinite || t + " 2D " + c._bad[0];
        if (JSON.stringify(g) !== before) mutated = mutated || t + " (2D)";
      }
      const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme, anim: 0.3, selected: true, selColor: "#38bdf8" };
      const beforeO = JSON.stringify(o);
      const c3 = makeCtx();
      try { if (S.draw3D(c3, t, P, o) !== true) bad = bad || t + " draw3D returned non-true"; }
      catch (e) { bad = bad || t + " 3D/" + theme + ": " + e.message; }
      if (c3._bad.length) notFinite = notFinite || t + " 3D " + c3._bad[0];
      if (JSON.stringify(o) !== beforeO) mutated = mutated || t + " (3D)";
    }
  }
  check("v2.5 FACTORY-A: every manufacturing component draws 2D+3D x light/dark x small/large - no throw, all finite, no mutation",
    bad === null && notFinite === null && mutated === null,
    bad || notFinite || (mutated ? "mutated " + mutated : MFG_TYPES.length + " components x themes x scales clean"));
})();

/* ---- 25. the six glyphs are DISTINCT + the process station animates --- */
(() => {
  const cell = 20;
  const glyphOf = (t) => { const def = D.ELEMENTS[t]; const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44 }); return c._pts.join("|"); };
  const uniq = new Set(MFG_TYPES.map(glyphOf));
  const distinct = uniq.size === MFG_TYPES.length;
  const def = D.ELEMENTS["mfg-station"];
  const anim = (a) => { const c = recCtx(); S.draw2D(c, "mfg-station", { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, anim: a }); return c._pts.join("|"); };
  const moves = anim(0.05) !== anim(0.55);
  check("v2.5 FACTORY-A: the six components render DISTINCT glyphs and the process station animates its through-part",
    distinct && moves, "distinct=" + uniq.size + "/" + MFG_TYPES.length + " stationMoves=" + moves);
})();

/* =====================================================================
 * v3.4 FACTORY-A2 "flow-geometry components" - focused checks for the eight
 * NEW Conveying & Sortation + Transport types. The all-types smoke above
 * already exercises them; these assert the NEW set specifically: registered +
 * palette-listed + a DECLARED base behaviour (conveyor/transporter) so they
 * ride the flow machinery, 0 capacity (all flow), a focused non-mutating 2D+3D
 * draw smoke, that the eight glyphs are all DISTINCT, and that the rotating /
 * looping forms (turntable, turnplate, cycle) actually MOVE across anim phases.
 * ===================================================================== */
const A2_TYPES = ["converter", "angular-converter", "turntable", "turnplate", "flow-control", "cycle", "track", "two-lane-track"];
const A2_BASE = {
  "converter": "conveyor", "angular-converter": "conveyor", "turntable": "conveyor",
  "turnplate": "conveyor", "flow-control": "conveyor", "cycle": "conveyor",
  "track": "transporter", "two-lane-track": "transporter",
};

/* ---- 26. A2 types: domain + registry + palette + base + 0 capacity -- */
(() => {
  const inDomain = A2_TYPES.filter((t) => !D.ELEMENTS[t]);
  const noShape = A2_TYPES.filter((t) => S.has(t) !== true);
  const notInPalette = A2_TYPES.filter((t) => (D.paletteOrder || []).indexOf(t) < 0);
  const badBase = A2_TYPES.filter((t) => D.elementBase(t) !== A2_BASE[t]);
  const badCap = A2_TYPES.filter((t) => { const def = D.ELEMENTS[t] || {}; return D.elementCapacity({ type: t, w: def.w, d: def.d }) !== 0; });
  check("v3.4 FACTORY-A2 components are in the domain, the shape registry (2D+3D), the palette, declare a base (conveyor/transporter) and are 0-capacity (flow)",
    inDomain.length === 0 && noShape.length === 0 && notInPalette.length === 0 && badBase.length === 0 && badCap.length === 0,
    (inDomain.length ? "not in domain: " + inDomain.join(",") : "") +
    (noShape.length ? " no shape: " + noShape.join(",") : "") +
    (notInPalette.length ? " not in palette: " + notInPalette.join(",") : "") +
    (badBase.length ? " wrong base: " + badBase.join(",") : "") +
    (badCap.length ? " nonzero capacity: " + badCap.join(",") : "") ||
    A2_TYPES.length + " flow-geometry components covered");
})();

/* ---- 27. focused A2 draw smoke (2D+3D x themes x scales), no mutation */
(() => {
  const P = makeP();
  const cell = 20;
  let bad = null, notFinite = null, mutated = null;
  for (const t of A2_TYPES) {
    const def = D.ELEMENTS[t];
    for (const theme of THEMES) {
      for (const lod of [3, 44]) {
        const g = { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme, lod, anim: 0.3 };
        const before = JSON.stringify(g);
        const c = makeCtx();
        try { if (S.draw2D(c, t, g) !== true) bad = bad || t + " draw2D returned non-true"; }
        catch (e) { bad = bad || t + " 2D/" + theme + "/" + lod + ": " + e.message; }
        if (c._bad.length) notFinite = notFinite || t + " 2D " + c._bad[0];
        if (JSON.stringify(g) !== before) mutated = mutated || t + " (2D)";
      }
      const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme, anim: 0.3, selected: true, selColor: "#38bdf8" };
      const beforeO = JSON.stringify(o);
      const c3 = makeCtx();
      try { if (S.draw3D(c3, t, P, o) !== true) bad = bad || t + " draw3D returned non-true"; }
      catch (e) { bad = bad || t + " 3D/" + theme + ": " + e.message; }
      if (c3._bad.length) notFinite = notFinite || t + " 3D " + c3._bad[0];
      if (JSON.stringify(o) !== beforeO) mutated = mutated || t + " (3D)";
    }
  }
  check("v3.4 FACTORY-A2: every flow-geometry component draws 2D+3D x light/dark x small/large - no throw, all finite, no mutation",
    bad === null && notFinite === null && mutated === null,
    bad || notFinite || (mutated ? "mutated " + mutated : A2_TYPES.length + " components x themes x scales clean"));
})();

/* ---- 28. the eight A2 glyphs are DISTINCT + rotating/looping forms move */
(() => {
  const cell = 20;
  const glyphOf = (t) => { const def = D.ELEMENTS[t]; const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44 }); return c._pts.join("|"); };
  const uniq = new Set(A2_TYPES.map(glyphOf));
  const distinct = uniq.size === A2_TYPES.length;
  // turntable + turnplate ROTATE, cycle LOOPS - each must move its part across phases.
  const movesOf = (t) => { const def = D.ELEMENTS[t]; const draw = (a) => { const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, anim: a }); return c._pts.join("|"); }; return draw(0.05) !== draw(0.55); };
  const animated = ["turntable", "turnplate", "cycle"];
  const stillStuck = animated.filter((t) => !movesOf(t));
  check("v3.4 FACTORY-A2: the eight components render DISTINCT glyphs and the rotating/looping forms (turntable, turnplate, cycle) move across anim phases",
    distinct && stillStuck.length === 0,
    "distinct=" + uniq.size + "/" + A2_TYPES.length + (stillStuck.length ? " static: " + stillStuck.join(",") : " animate OK"));
})();

/* =====================================================================
 * v3.7 FLUIDS "process-industry components" - focused checks for the seven
 * NEW Fluids / Process types. The all-types smoke above already exercises
 * them; these assert the NEW set specifically: registered + palette-listed +
 * a DECLARED base (conveyor/dock/storage/station) so they ride the flow
 * machinery, 0 capacity (all category "flow" - INCLUDING the Tank, which
 * holds FLUID not pallets), a focused non-mutating 2D+3D draw smoke, that the
 * seven glyphs are all DISTINCT, that the fluid MOTIONS (pipe scroll, tank
 * fill bob, mixer agitator) move across anim phases, that the Tank carries a
 * capacityM3/fillPct fluid schema, and that the Ctrl-K command palette + the
 * IFC export both handle every new type (they iterate the registries).
 * ===================================================================== */
const FL_TYPES = ["pipe", "fluid-source", "fluid-drain", "tank", "mixer", "portioner", "deportioner"];
const FL_BASE = { "pipe": "conveyor", "fluid-source": "dock", "fluid-drain": "dock", "tank": "storage", "mixer": "station", "portioner": "station", "deportioner": "station" };

/* ---- 29. Fluids types: domain + registry + palette + base + 0 capacity - */
(() => {
  const inDomain = FL_TYPES.filter((t) => !D.ELEMENTS[t]);
  const noShape = FL_TYPES.filter((t) => S.has(t) !== true);
  const notInPalette = FL_TYPES.filter((t) => (D.paletteOrder || []).indexOf(t) < 0);
  const badBase = FL_TYPES.filter((t) => D.elementBase(t) !== FL_BASE[t]);
  const badCap = FL_TYPES.filter((t) => { const def = D.ELEMENTS[t] || {}; return D.elementCapacity({ type: t, w: def.w, d: def.d }) !== 0; });
  check("v3.7 FLUIDS components are in the domain, the shape registry (2D+3D), the palette, declare a base (conveyor/dock/storage/station) and are 0-capacity (category flow)",
    inDomain.length === 0 && noShape.length === 0 && notInPalette.length === 0 && badBase.length === 0 && badCap.length === 0,
    (inDomain.length ? "not in domain: " + inDomain.join(",") : "") +
    (noShape.length ? " no shape: " + noShape.join(",") : "") +
    (notInPalette.length ? " not in palette: " + notInPalette.join(",") : "") +
    (badBase.length ? " wrong base: " + badBase.join(",") : "") +
    (badCap.length ? " nonzero capacity: " + badCap.join(",") : "") ||
    FL_TYPES.length + " fluid components covered");
})();

/* ---- 30. focused Fluids draw smoke (2D+3D x themes x scales), no mutation */
(() => {
  const P = makeP();
  const cell = 20;
  let bad = null, notFinite = null, mutated = null;
  for (const t of FL_TYPES) {
    const def = D.ELEMENTS[t];
    for (const theme of THEMES) {
      for (const lod of [3, 44]) {
        const g = { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme, lod, anim: 0.3 };
        const before = JSON.stringify(g);
        const c = makeCtx();
        try { if (S.draw2D(c, t, g) !== true) bad = bad || t + " draw2D returned non-true"; }
        catch (e) { bad = bad || t + " 2D/" + theme + "/" + lod + ": " + e.message; }
        if (c._bad.length) notFinite = notFinite || t + " 2D " + c._bad[0];
        if (JSON.stringify(g) !== before) mutated = mutated || t + " (2D)";
      }
      const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM, color: def.color, theme, anim: 0.3, selected: true, selColor: "#38bdf8" };
      const beforeO = JSON.stringify(o);
      const c3 = makeCtx();
      try { if (S.draw3D(c3, t, P, o) !== true) bad = bad || t + " draw3D returned non-true"; }
      catch (e) { bad = bad || t + " 3D/" + theme + ": " + e.message; }
      if (c3._bad.length) notFinite = notFinite || t + " 3D " + c3._bad[0];
      if (JSON.stringify(o) !== beforeO) mutated = mutated || t + " (3D)";
    }
  }
  check("v3.7 FLUIDS: every fluid component draws 2D+3D x light/dark x small/large - no throw, all finite, no mutation",
    bad === null && notFinite === null && mutated === null,
    bad || notFinite || (mutated ? "mutated " + mutated : FL_TYPES.length + " components x themes x scales clean"));
})();

/* ---- 31. the seven glyphs are DISTINCT + the fluid motions animate ---- */
(() => {
  const cell = 20;
  const glyphOf = (t) => { const def = D.ELEMENTS[t]; const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44 }); return c._pts.join("|"); };
  const uniq = new Set(FL_TYPES.map(glyphOf));
  const distinct = uniq.size === FL_TYPES.length;
  // pipe SCROLLS its fluid, the tank fill LEVEL bobs, the mixer AGITATOR spins -
  // each must move its part across phases (0.05 vs 0.55 read distinct here).
  const movesOf = (t) => { const def = D.ELEMENTS[t]; const draw = (a) => { const c = recCtx(); S.draw2D(c, t, { x: 100, y: 80, w: def.w * cell, d: def.d * cell, cellPx: cell, color: def.color, theme: "light", lod: 44, anim: a }); return c._pts.join("|"); }; return draw(0.05) !== draw(0.55); };
  const animated = ["pipe", "tank", "mixer"];
  const stillStuck = animated.filter((t) => !movesOf(t));
  check("v3.7 FLUIDS: the seven components render DISTINCT glyphs and the fluid motions (pipe scroll, tank fill bob, mixer agitator) move across anim phases",
    distinct && stillStuck.length === 0,
    "distinct=" + uniq.size + "/" + FL_TYPES.length + (stillStuck.length ? " static: " + stillStuck.join(",") : " animate OK"));
})();

/* ---- 32. Tank fluid schema (base storage yet 0 pallet positions) + the
 *         Ctrl-K palette command list and IFC export handle every new type -- */
(() => {
  const tank = D.ELEMENTS["tank"] || {};
  // A tank DECLARES base "storage" (reads as a storage vessel) yet contributes
  // 0 PALLET positions - it holds FLUID (capacityM3), not pallets (honest).
  const tankFluidSchema = tank.base === "storage" &&
    D.elementCapacity({ type: "tank", w: tank.w, d: tank.d }) === 0 &&
    typeof tank.capacityM3 === "number" && tank.capacityM3 > 0 &&
    typeof tank.fillPct === "number" && tank.fluid === true;
  // Load library.js (paletteTree) + palette.js (Ctrl-K) + ifc.js (export) with a
  // minimal localStorage shim, and confirm every new type is reachable through
  // the SAME registry-iterating paths the app uses.
  global.localStorage = global.localStorage || (function () {
    const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } };
  })();
  let ctrlkOk = false, ifcOk = false, err = null;
  try {
    if (!global.WT.library) (0, eval)(fs.readFileSync(path.join(__dirname, "library.js"), "utf8"));
    if (!global.WT.palette) (0, eval)(fs.readFileSync(path.join(__dirname, "palette.js"), "utf8"));
    if (!global.WT.ifc) (0, eval)(fs.readFileSync(path.join(__dirname, "ifc.js"), "utf8"));
    // Ctrl-K: the command list is built from an UNFILTERED palette tree (every
    // group), so every fluid type gets an "Add ..." place command.
    const tree = global.WT.library.paletteTree({});
    const cmds = global.WT.palette.buildCommands({ tree: tree, elements: D.ELEMENTS, generate: global.WT.generate });
    const addTypes = {}; cmds.forEach((c) => { if (c && c.type) addTypes[c.type] = 1; });
    ctrlkOk = FL_TYPES.every((t) => addTypes[t]);
    // IFC: a layout with all seven fluid types exports without throwing and
    // labels each one (generic proxy solid per element - no per-type switch).
    const lay = { version: "wt-1", gridW: 40, gridH: 24, cell: D.METRES_PER_CELL,
      elements: FL_TYPES.map((t, i) => { const def = D.ELEMENTS[t]; return { id: "f" + i, type: t, x: (i * 5) % 30, y: (i % 3) * 6, w: def.w, d: def.d }; }) };
    const step = global.WT.ifc.generate(lay);
    ifcOk = typeof step === "string" && step.length > 0 &&
      FL_TYPES.every((t) => step.indexOf("'" + global.WT.ifc.stepString(D.ELEMENTS[t].label) + "'") !== -1);
  } catch (e) { err = e.message; }
  check("v3.7 FLUIDS: Tank has a fluid capacityM3/fillPct schema (base storage yet 0 pallet positions) + the Ctrl-K palette command list and IFC export handle every new type",
    tankFluidSchema && ctrlkOk && ifcOk,
    err ? "threw " + err : "tankSchema=" + tankFluidSchema + " ctrlK=" + ctrlkOk + " ifc=" + ifcOk);
})();

console.log("");
console.log(failures === 0
  ? "ALL SHAPES CHECKS PASSED (32 checks)"
  : failures + " SHAPES CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
