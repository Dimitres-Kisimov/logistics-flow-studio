/* =====================================================================
 * verify_detail.js - progressive-LOD "rich" high-detail tier checks (v1.11).
 *
 * Runs the REAL shape module (shapes.js) in Node with the same window shim
 * the other harnesses use. v1.11 adds a THIRD level-of-detail tier on top
 * of the existing icon (far) + glyph (mid) tiers: a "rich" tier that only
 * renders when an element reads large on screen (zoomed in), layering
 * high-detail overlays - pallet load-units in the bays, extra shelf
 * levels, crane carriages, decked platforms, vehicle loads - on top of the
 * base glyph / form. Zoomed out the app never reaches this tier, so big
 * layouts stay fast (icon / glyph exactly as before).
 *
 * shapes.js is a PURE drawing module (canvas ctx + plain geometry/colour),
 * so the actual pixels are only verifiable LIVE in the browser; every draw
 * PATH is finite math, exercised here headlessly against a recording mock
 * 2D context that flags any non-finite value or throw.
 *
 * Checks (all deterministic):
 *   1. detailLevel(px) returns the THREE tiers at the right px/cell
 *      thresholds (icon small -> glyph mid -> rich large), on both sides of
 *      each boundary
 *   2. detailLevel is deterministic + garbage-safe (NaN / -1 / Infinity /
 *      undefined -> the cheapest "icon" tier)
 *   3. the thresholds are exported and ordered (GLYPH_MIN < RICH_MIN)
 *   4. 2D RICH smoke: EVERY domain type at the rich tier x light/dark -
 *      no throw, all-finite coords, returns true
 *   5. 3D RICH smoke: EVERY domain type at the rich tier x light/dark -
 *      no throw, all-finite coords, returns true
 *   6. the rich tier ADDS detail: for racking types the rich 2D glyph
 *      draws strictly MORE than the mid glyph, and the rich 3D form draws
 *      strictly MORE than the base form
 *   7. rich is LOD-GATED: draw2D only reaches the rich overlay ABOVE the
 *      px threshold (icon < glyph < rich draw counts; below RICH_MIN the
 *      output equals the plain glyph)
 *   8. the load-unit fill is DETERMINISTIC (same element+seed -> identical
 *      draw calls twice) and seed-SENSITIVE (a different element seed moves
 *      which positions are loaded, so identical racks don't look cloned)
 *   9. neither rich draw mutates its geometry/colour input (2D + 3D)
 *  10. rich still respects the anim phase: an animatable type MOVES its
 *      part at the rich tier (distinct output at distinct phases)
 *  11. honesty: the load-units are labelled ILLUSTRATIVE / NOT an inventory
 *      count / NOT CAD-BIM in the module source
 *
 * Usage:  node verify_detail.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // domain.js + shapes.js attach to window.WT
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
// Racking types that carry a rich pallet-fill overlay (w >= 4, d >= 1 so
// they clear the footprint legibility guard at the mid AND rich zoom).
const RACKS = ["selective-racking", "double-deep", "drive-in", "push-back", "pallet-flow"];

/* ---- Recording mock 2D context (counts calls + flags non-finite) --- */
function makeCtx() {
  const ctx = { _bad: [], _calls: 0, _log: [] };
  const num = (name, args) => {
    ctx._calls++;
    for (const n of args) if (typeof n === "number" && !isFinite(n)) ctx._bad.push(name + "=" + n);
  };
  const rec = (x, y) => { if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) ctx._log.push(Math.round(x * 100) + "," + Math.round(y * 100)); };
  ctx.save = () => {}; ctx.restore = () => {};
  ctx.beginPath = () => {}; ctx.closePath = () => {};
  ctx.moveTo = (x, y) => { num("moveTo", [x, y]); rec(x, y); };
  ctx.lineTo = (x, y) => { num("lineTo", [x, y]); rec(x, y); };
  ctx.arc = (x, y, r, a, b) => { num("arc", [x, y, r, a, b]); rec(x, y); };
  ctx.arcTo = (x1, y1, x2, y2, r) => { num("arcTo", [x1, y1, x2, y2, r]); };
  ctx.rect = (x, y, w, h) => { num("rect", [x, y, w, h]); rec(x, y); };
  ctx.fillRect = (x, y, w, h) => { num("fillRect", [x, y, w, h]); rec(x, y); rec(x + w, y + h); };
  ctx.strokeRect = (x, y, w, h) => { num("strokeRect", [x, y, w, h]); rec(x, y); rec(x + w, y + h); };
  ctx.fill = () => {}; ctx.stroke = () => {};
  ctx.setLineDash = (a) => { if (Array.isArray(a)) for (const n of a) { if (typeof n === "number" && !isFinite(n)) ctx._bad.push("dash=" + n); } };
  ctx.measureText = (t) => ({ width: String(t).length * 6 });
  ctx.fillText = () => {}; ctx.strokeText = () => {};
  ctx.fillStyle = ""; ctx.strokeStyle = ""; ctx.lineWidth = 1; ctx.lineJoin = "";
  ctx.font = ""; ctx.textAlign = ""; ctx.textBaseline = ""; ctx.globalAlpha = 1;
  return ctx;
}
// A deterministic 2:1-dimetric-style projection: finite for finite input.
function makeP() { return (cx, cy, cz) => ({ x: 400 + (cx - cy) * 18, y: 260 + (cx + cy) * 9 - (cz || 0) * 6 }); }

const CELL = 20;
function g2(type, lod, extra) {
  const def = D.ELEMENTS[type];
  const g = { x: 100, y: 80, w: def.w * CELL, d: def.d * CELL, cellPx: CELL, color: def.color, theme: "light", lod: lod };
  if (extra) for (const k in extra) g[k] = extra[k];
  return g;
}
function o3(type, lod, extra) {
  const def = D.ELEMENTS[type];
  const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM || 6, color: def.color, theme: "light" };
  if (lod !== undefined) o.lod = lod;
  if (extra) for (const k in extra) o[k] = extra[k];
  return o;
}
function draw2(type, lod, extra, theme) { const c = makeCtx(); const g = g2(type, lod, extra); if (theme) g.theme = theme; const ok = S.draw2D(c, type, g); return { c, ok }; }
function draw3(type, lod, extra, theme) { const c = makeCtx(); const o = o3(type, lod, extra); if (theme) o.theme = theme; const ok = S.draw3D(c, type, makeP(), o); return { c, ok }; }

const ICON_LOD = 6, GLYPH_LOD = 24, RICH_LOD = 60; // px/cell tiers (thresholds 10 / 40)

console.log("Progressive-LOD rich high-detail tier verification (v1.11)");
console.log("");

/* ---- 1. detailLevel: three tiers at the right thresholds ---------- */
(() => {
  if (typeof S.detailLevel !== "function") { check("detailLevel(px) returns three tiers at the right thresholds", false, "WT.shapes.detailLevel MISSING"); return; }
  const gmin = S.DETAIL_GLYPH_MIN, rmin = S.DETAIL_RICH_MIN;
  const cases = [
    [0, "icon"], [gmin - 1, "icon"], [gmin - 0.01, "icon"],
    [gmin, "glyph"], [gmin + 1, "glyph"], [(gmin + rmin) / 2, "glyph"], [rmin - 0.01, "glyph"],
    [rmin, "rich"], [rmin + 1, "rich"], [200, "rich"],
  ];
  let fail = null;
  for (const [px, want] of cases) { const got = S.detailLevel(px); if (got !== want) { fail = "detailLevel(" + px + ")=" + got + " want " + want; break; } }
  check("detailLevel(px) returns the three tiers at the right px/cell thresholds (icon<glyph<rich)",
    fail === null, fail || "10 boundary cases correct (glyphMin=" + gmin + " richMin=" + rmin + ")");
})();

/* ---- 2. detailLevel deterministic + garbage-safe ------------------ */
(() => {
  let determ = true;
  for (const px of [3, 10, 25, 40, 99]) if (S.detailLevel(px) !== S.detailLevel(px)) determ = false;
  const garbage = [NaN, Infinity, -Infinity, -1, -40, undefined, null, "x", {}];
  const allIcon = garbage.every((v) => S.detailLevel(v) === "icon");
  check("detailLevel is deterministic + garbage-safe (NaN / negative / Infinity / non-number -> icon)",
    determ && allIcon, "determ=" + determ + " garbageAllIcon=" + allIcon);
})();

/* ---- 3. thresholds exported + ordered ----------------------------- */
(() => {
  const gmin = S.DETAIL_GLYPH_MIN, rmin = S.DETAIL_RICH_MIN;
  const ok = isFinite(gmin) && isFinite(rmin) && gmin > 0 && rmin > gmin;
  check("the px/cell thresholds are exported and ordered (0 < DETAIL_GLYPH_MIN < DETAIL_RICH_MIN)",
    ok, "GLYPH_MIN=" + gmin + " RICH_MIN=" + rmin);
})();

/* ---- 4. 2D RICH smoke: every type, both themes -------------------- */
(() => {
  let bad = null, notFinite = null, retFail = null;
  for (const t of TYPES) {
    for (const theme of THEMES) {
      let r;
      try { r = draw2(t, RICH_LOD, null, theme); }
      catch (e) { bad = bad || t + "/" + theme + ": " + e.message; continue; }
      if (r.ok !== true) retFail = retFail || t + "/" + theme + " ret=" + r.ok;
      if (r.c._bad.length) notFinite = notFinite || t + "/" + theme + " " + r.c._bad[0];
    }
  }
  check("2D rich smoke: EVERY type at the rich tier x light/dark - no throw, all finite, returns true",
    bad === null && notFinite === null && retFail === null,
    bad || notFinite || retFail || (TYPES.length * 2) + " rich 2D draws clean");
})();

/* ---- 5. 3D RICH smoke: every type, both themes -------------------- */
(() => {
  let bad = null, notFinite = null, retFail = null;
  for (const t of TYPES) {
    for (const theme of THEMES) {
      let r;
      try { r = draw3(t, RICH_LOD, { selected: true, selColor: "#38bdf8" }, theme); }
      catch (e) { bad = bad || t + "/" + theme + ": " + e.message; continue; }
      if (r.ok !== true) retFail = retFail || t + "/" + theme + " ret=" + r.ok;
      if (r.c._bad.length) notFinite = notFinite || t + "/" + theme + " " + r.c._bad[0];
    }
  }
  check("3D rich smoke: EVERY type at the rich tier x light/dark (incl. selection) - no throw, all finite, returns true",
    bad === null && notFinite === null && retFail === null,
    bad || notFinite || retFail || (TYPES.length * 2) + " rich 3D forms clean");
})();

/* ---- 6. rich ADDS detail vs the mid glyph / base form ------------- */
(() => {
  let fail2d = null, fail3d = null;
  for (const t of RACKS) {
    const glyph = draw2(t, GLYPH_LOD).c._calls;
    const rich = draw2(t, RICH_LOD).c._calls;
    if (!(rich > glyph)) fail2d = fail2d || t + " (2D rich=" + rich + " !> glyph=" + glyph + ")";
    const base = draw3(t, undefined).c._calls; // no lod -> base form only
    const rich3 = draw3(t, RICH_LOD).c._calls;
    if (!(rich3 > base)) fail3d = fail3d || t + " (3D rich=" + rich3 + " !> base=" + base + ")";
  }
  check("the rich tier ADDS detail: rich 2D glyph draws more than the mid glyph, rich 3D form draws more than the base form",
    fail2d === null && fail3d === null, fail2d || fail3d || RACKS.length + " rack types add pallets in 2D + 3D");
})();

/* ---- 7. rich is LOD-GATED (only above the px threshold) ----------- */
(() => {
  let fail = null, glyphEq = null;
  for (const t of RACKS) {
    const icon = draw2(t, ICON_LOD).c._calls;
    const glyph = draw2(t, GLYPH_LOD).c._calls;
    const rich = draw2(t, RICH_LOD).c._calls;
    if (!(icon < glyph && glyph < rich)) fail = fail || t + " (icon=" + icon + " glyph=" + glyph + " rich=" + rich + ")";
    // Below RICH_MIN the output must equal the plain glyph (no rich overlay):
    // a lod just under the threshold draws exactly the mid-glyph coordinates.
    const justBelow = draw2(t, S.DETAIL_RICH_MIN - 0.5).c._log.join("|");
    const midGlyph = draw2(t, GLYPH_LOD).c._log.join("|");
    if (justBelow !== midGlyph) glyphEq = glyphEq || t + " (just-below-threshold differs from the mid glyph)";
  }
  check("rich is LOD-gated: icon < glyph < rich draw counts, and below DETAIL_RICH_MIN the output is exactly the mid glyph",
    fail === null && glyphEq === null, fail || glyphEq || "tier gating correct for " + RACKS.length + " rack types");
})();

/* ---- 8. load-unit fill deterministic + seed-sensitive ------------- */
(() => {
  // Same element + same seed -> byte-identical recorded draw calls twice.
  let determ = true, determType = null;
  for (const t of TYPES) {
    const a = draw2(t, RICH_LOD, { seed: 12345 }).c._log.join("|");
    const b = draw2(t, RICH_LOD, { seed: 12345 }).c._log.join("|");
    if (a !== b) { determ = false; determType = t; }
  }
  // A DIFFERENT element seed moves which positions are loaded (racks don't
  // all look cloned). Compared across the whole rack set so it can never
  // hinge on one lucky slot.
  const seedA = RACKS.map((t) => draw2(t, RICH_LOD, { seed: 1 }).c._log.join("|")).join("#");
  const seedB = RACKS.map((t) => draw2(t, RICH_LOD, { seed: 999 }).c._log.join("|")).join("#");
  const sensitive = seedA !== seedB;
  check("the rich load-unit fill is DETERMINISTIC (same element+seed -> identical draw calls) and seed-sensitive",
    determ && sensitive, determ ? "deterministic; seedSensitive=" + sensitive : "non-deterministic for " + determType);
})();

/* ---- 9. rich draws do not mutate their inputs -------------------- */
(() => {
  let mut2d = null, mut3d = null;
  for (const t of TYPES) {
    const g = g2(t, RICH_LOD, { seed: 42, anim: 0.4 });
    const beforeG = JSON.stringify(g);
    S.draw2D(makeCtx(), t, g);
    if (JSON.stringify(g) !== beforeG) mut2d = mut2d || t;
    const o = o3(t, RICH_LOD, { seed: 42, anim: 0.4, selected: true, selColor: "#38bdf8" });
    const beforeO = JSON.stringify(o);
    S.draw3D(makeCtx(), t, makeP(), o);
    if (JSON.stringify(o) !== beforeO) mut3d = mut3d || t;
  }
  check("neither rich draw mutates its geometry/colour input (2D + 3D)",
    mut2d === null && mut3d === null, mut2d ? "2D mutated " + mut2d : (mut3d ? "3D mutated " + mut3d : "inputs unchanged for all types"));
})();

/* ---- 10. rich respects the anim phase (moving parts still move) --- */
(() => {
  const ANIM = ["conveyor", "rgv", "agv", "asrs", "shuttle", "sorter", "stretch-wrap"];
  let fail = null;
  for (const t of ANIM) {
    const a = draw2(t, RICH_LOD, { anim: 0.12 }).c._log.join("|");
    const b = draw2(t, RICH_LOD, { anim: 0.63 }).c._log.join("|");
    if (a === b) fail = fail || t + " (identical at 0.12 vs 0.63 at the rich tier)";
  }
  check("rich still respects the anim phase: an animatable type MOVES its part at the rich tier",
    fail === null, fail || "all " + ANIM.length + " animatable types move at the rich tier");
})();

/* ---- 11. honesty labels for the load-units ----------------------- */
(() => {
  const illustrative = /ILLUSTRATIVE/i.test(SRC);
  const notInventory = /NOT the actual computed inventory/i.test(SRC);
  const notCadBim = /NOT CAD\/BIM\/survey/i.test(SRC);
  check("honesty: the load-units are labelled ILLUSTRATIVE / NOT an inventory count / NOT CAD-BIM-survey",
    illustrative && notInventory && notCadBim,
    "illustrative=" + illustrative + " notInventory=" + notInventory + " notCadBim=" + notCadBim);
})();

console.log("");
console.log(failures === 0
  ? "ALL DETAIL CHECKS PASSED (11 checks)"
  : failures + " DETAIL CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
