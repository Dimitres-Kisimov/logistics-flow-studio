/* =====================================================================
 * verify_view.js - viewport transform (zoom / pan / fit) + configurable
 * floor size verification harness.
 *
 * Runs the REAL view module (view.js) in Node with the same window shim
 * the other harnesses use and asserts the transform math directly. This
 * is the headless stand-in for the live canvas: the browser DOM cannot be
 * exercised in the sandbox, but the ONE pair of helpers that every canvas
 * draw call and every pointer hit-test routes through (screenToWorld /
 * worldToScreen) is pure and fully testable here.
 *
 * Checks (all deterministic):
 *   - clampScale keeps zoom inside [SCALE_MIN, SCALE_MAX], garbage -> 1
 *   - worldToScreen matches screen = pan + world*cellPx*scale
 *   - screenToWorld o worldToScreen ~= identity at several scales/pans
 *   - fitView computes the right scale+pan for a known warehouse+viewport
 *   - fitView clamps a too-big floor to SCALE_MIN; padding never enlarges
 *   - snap floors to the containing cell (grid-snap lives in WORLD coords)
 *   - grid-snap is invariant to zoom (same world fraction -> same cell)
 *   - normalizeFloor accepts a non-40x24 floor, clamps the range, and
 *     falls back to the default on garbage; floorBounds are correct
 *   - elementAt resolves the RIGHT element after a pan+zoom, returns the
 *     topmost on overlap, and null on empty floor
 *   - clampPan keeps the content in view; centerPan centres it
 *   - v2.2 larger maps + wider zoom: normalizeFloor accepts the LARGE max
 *     (1200x800) and clamps beyond it; the widened clampScale (0.012x-24x)
 *     lets fitView FRAME the whole max floor (scale inside the clamp, not
 *     floored) at any reference viewport; a large-floor cullToView still
 *     keeps only the on-screen elements; and a set-max-floor-then-Fit
 *     round-trip yields a view whose bounds cover the whole floor
 *
 * Usage:  node verify_view.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // view.js attaches itself to window.WT
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "view.js"), "utf8"));
const V = global.WT.view;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

console.log("Viewport transform (zoom/pan/fit) + floor size verification");
console.log("");

/* ---- 1. Zoom clamp ------------------------------------------------ */
check("clampScale holds the zoom bounds and rejects garbage",
  V.clampScale(0.01) === V.SCALE_MIN &&
  V.clampScale(999) === V.SCALE_MAX &&
  V.clampScale(1) === 1 &&
  V.clampScale(0) === 1 &&
  V.clampScale(-3) === 1 &&
  V.clampScale(NaN) === 1 &&
  V.clampScale("x") === 1,
  "min=" + V.SCALE_MIN + " max=" + V.SCALE_MAX);

/* ---- 2. worldToScreen is the affine transform ------------------- */
(() => {
  const view = { cellPx: 20, scale: 2, panX: 30, panY: -12 };
  const s = V.worldToScreen(view, 5, 3); // 30 + 5*40 = 230 ; -12 + 3*40 = 108
  check("worldToScreen = pan + world*cellPx*scale",
    approx(s.x, 230) && approx(s.y, 108), "got (" + s.x + ", " + s.y + ")");
})();

/* ---- 3. round-trip identity across scales / pans ---------------- */
(() => {
  const scales = [V.SCALE_MIN, 0.5, 1, 2.5, V.SCALE_MAX];
  const pans = [[0, 0], [37, -13], [-220, 480]];
  const pts = [[0, 0], [7.3, 3.8], [40, 24], [113.5, 77.25]];
  let worst = 0;
  for (const sc of scales) {
    for (const [px, py] of pans) {
      const view = { cellPx: 20, scale: sc, panX: px, panY: py };
      for (const [wx, wy] of pts) {
        const scr = V.worldToScreen(view, wx, wy);
        const back = V.screenToWorld(view, scr.x, scr.y);
        worst = Math.max(worst, Math.abs(back.cx - wx), Math.abs(back.cy - wy));
      }
    }
  }
  check("screenToWorld o worldToScreen is identity (all scales/pans)",
    worst < 1e-9, "max round-trip error = " + worst.toExponential(2));
})();

/* ---- 4. Fit for a known warehouse + viewport -------------------- */
(() => {
  // Classic 40x24 floor, base 20 px/cell, 800x480 viewport, no padding:
  // world is 800x480 px -> scale exactly 1, centred at pan (0,0).
  const f = V.fitView(20, 40, 24, 800, 480, 0);
  check("Fit: 40x24 floor in 800x480 -> scale 1, centred",
    approx(f.scale, 1) && approx(f.panX, 0) && approx(f.panY, 0),
    "scale=" + f.scale + " pan=(" + f.panX + ", " + f.panY + ")");
})();

/* ---- 5. Fit for a BIGGER-than-viewport warehouse ---------------- */
(() => {
  // 120x80 floor: world 2400x1600 px in 800x480 -> min(0.333,0.3)=0.3,
  // centred with a horizontal margin only.
  const f = V.fitView(20, 120, 80, 800, 480, 0);
  check("Fit: 120x80 floor in 800x480 -> scale 0.3, centred",
    approx(f.scale, 0.3) && approx(f.panX, 40) && approx(f.panY, 0),
    "scale=" + f.scale + " pan=(" + f.panX + ", " + f.panY + ")");
})();

/* ---- 6. Fit clamps a huge floor to SCALE_MIN; pad never enlarges  */
(() => {
  const tiny = V.fitView(20, 1200, 800, 100, 100, 0); // max floor in a tiny box -> wants < SCALE_MIN
  const padded = V.fitView(20, 40, 24, 800, 480, 0.1);
  const unpadded = V.fitView(20, 40, 24, 800, 480, 0);
  check("Fit clamps to SCALE_MIN and padding only shrinks the scale",
    approx(tiny.scale, V.SCALE_MIN) && padded.scale <= unpadded.scale + 1e-12,
    "clamped=" + tiny.scale + " padded=" + padded.scale.toFixed(4) + " unpadded=" + unpadded.scale.toFixed(4));
})();

/* ---- 7. Grid snap floors to the containing cell (world coords) --- */
check("snap() floors a fractional world coord to its cell",
  V.snap(7.999) === 7 && V.snap(0) === 0 && V.snap(-0.2) === -1 && V.snap(23.5) === 23,
  "world-space floor");

/* ---- 8. Grid snap is invariant to zoom/pan ---------------------- */
(() => {
  // The SAME world fraction must snap to the SAME cell at every zoom -
  // proving snapping happens in world space, never in screen pixels.
  const cells = [7, 3];
  const frac = [0.3, 0.8];
  let ok = true;
  for (const sc of [V.SCALE_MIN, 1, 3.7, V.SCALE_MAX]) {
    const view = { cellPx: 20, scale: sc, panX: 55, panY: -110 };
    const scr = V.worldToScreen(view, cells[0] + frac[0], cells[1] + frac[1]);
    const w = V.screenToWorld(view, scr.x, scr.y);
    if (V.snap(w.cx) !== cells[0] || V.snap(w.cy) !== cells[1]) ok = false;
  }
  check("grid-snap is invariant to zoom (stays in world coords)", ok, "cell (7,3) across 4 scales");
})();

/* ---- 9. Configurable floor: non-40x24 accepted + clamped -------- */
(() => {
  const a = V.normalizeFloor(60, 40);
  const b = V.normalizeFloor(V.FLOOR_MAX_W, V.FLOOR_MAX_H);
  const over = V.normalizeFloor(9999, 9999);
  const under = V.normalizeFloor(2, 3);
  const junk = V.normalizeFloor("x", undefined);
  const rounded = V.normalizeFloor(72.4, 47.6);
  check("normalizeFloor accepts a non-40x24 floor, clamps + rounds",
    a.gridW === 60 && a.gridH === 40 &&
    b.gridW === V.FLOOR_MAX_W && b.gridH === V.FLOOR_MAX_H &&
    over.gridW === V.FLOOR_MAX_W && over.gridH === V.FLOOR_MAX_H &&
    under.gridW === V.FLOOR_MIN && under.gridH === V.FLOOR_MIN &&
    junk.gridW === V.FLOOR_DEFAULT_W && junk.gridH === V.FLOOR_DEFAULT_H &&
    rounded.gridW === 72 && rounded.gridH === 48,
    "60x40, max=" + b.gridW + "x" + b.gridH + ", junk->" + junk.gridW + "x" + junk.gridH);
})();

/* ---- 10. floorBounds for a resized warehouse -------------------- */
(() => {
  const bnd = V.floorBounds(72, 48);
  check("floorBounds computes the resized floor extent",
    bnd.minX === 0 && bnd.minY === 0 && bnd.maxX === 72 && bnd.maxY === 48 &&
    bnd.wCells === 72 && bnd.hCells === 48,
    "0,0 -> 72,48");
})();

/* ---- 11. Hit-test resolves the right element after pan+zoom ----- */
(() => {
  const els = [
    { id: "a", x: 2, y: 1, w: 4, d: 2 },
    { id: "b", x: 10, y: 5, w: 4, d: 2 },
  ];
  const view = { cellPx: 20, scale: 2.5, panX: 37, panY: -13 };
  // Screen point over the centre of element b, then map back and snap.
  const scrB = V.worldToScreen(view, 12, 6);
  const wB = V.screenToWorld(view, scrB.x, scrB.y);
  const hitB = V.elementAt(els, V.snap(wB.cx), V.snap(wB.cy));
  // Screen point over element a.
  const scrA = V.worldToScreen(view, 3, 2);
  const wA = V.screenToWorld(view, scrA.x, scrA.y);
  const hitA = V.elementAt(els, V.snap(wA.cx), V.snap(wA.cy));
  // Empty floor cell.
  const scrE = V.worldToScreen(view, 30, 20);
  const wE = V.screenToWorld(view, scrE.x, scrE.y);
  const hitE = V.elementAt(els, V.snap(wE.cx), V.snap(wE.cy));
  check("elementAt resolves the correct element after pan+zoom",
    hitB && hitB.id === "b" && hitA && hitA.id === "a" && hitE === null,
    "b=" + (hitB && hitB.id) + " a=" + (hitA && hitA.id) + " empty=" + hitE);
})();

/* ---- 12. Hit-test returns the topmost (last-drawn) on overlap ---- */
(() => {
  const els = [
    { id: "lo", x: 0, y: 0, w: 5, d: 5 },
    { id: "hi", x: 0, y: 0, w: 5, d: 5 },
  ];
  const top = V.elementAt(els, 2, 2);
  check("elementAt returns the topmost element on overlap",
    top && top.id === "hi", "got " + (top && top.id));
})();

/* ---- 13. Pan clamp keeps content within reasonable bounds ------- */
(() => {
  // Floor exactly fills the viewport (scale 1): pan must snap back to 0.
  const fit = { cellPx: 20, scale: 1, panX: 9999, panY: -9999 };
  const c1 = V.clampPan(fit, 40, 24, 800, 480, 0);
  // Zoomed in (world bigger than viewport): the viewport stays covered.
  const zoom = { cellPx: 20, scale: 2, panX: 9999, panY: 0 };
  const c2 = V.clampPan(zoom, 40, 24, 800, 480, 0); // worldPxW=1600 -> [-800,0]
  const zoomNeg = { cellPx: 20, scale: 2, panX: -9999, panY: 0 };
  const c3 = V.clampPan(zoomNeg, 40, 24, 800, 480, 0);
  check("clampPan keeps the floor within reasonable bounds",
    approx(c1.panX, 0) && approx(c1.panY, 0) &&
    approx(c2.panX, 0) && approx(c3.panX, -800),
    "fit->" + c1.panX + " zoom->" + c2.panX + "/" + c3.panX);
})();

/* ---- 14. centerPan centres the floor in the viewport ------------ */
(() => {
  const view = { cellPx: 20, scale: 1, panX: 0, panY: 0 };
  const c = V.centerPan(view, 40, 24, 800, 480); // exact fit -> (0,0)
  const cWide = V.centerPan(view, 60, 24, 800, 480); // worldPxW=1200 -> -200
  check("centerPan centres the floor at the current scale",
    approx(c.panX, 0) && approx(c.panY, 0) && approx(cWide.panX, -200),
    "40w->" + c.panX + " 60w->" + cWide.panX);
})();

/* ---- 15. worldToScreen/screenToWorld agree on the floor corners - */
(() => {
  // The two mapped floor corners must bracket the mapped centre - a
  // sanity check that the transform is monotonic and orientation-keeping.
  const view = { cellPx: 20, scale: 1.4, panX: 60, panY: 25 };
  const tl = V.worldToScreen(view, 0, 0);
  const br = V.worldToScreen(view, 40, 24);
  const mid = V.worldToScreen(view, 20, 12);
  check("transform is monotonic (corner ordering preserved)",
    tl.x < mid.x && mid.x < br.x && tl.y < mid.y && mid.y < br.y,
    "tl=(" + tl.x.toFixed(0) + "," + tl.y.toFixed(0) + ") br=(" + br.x.toFixed(0) + "," + br.y.toFixed(0) + ")");
})();

/* =====================================================================
 * v2.2 - Larger maps + wider zoom range. The floor now scales up to a
 * 1200 x 800 m campus and the interactive zoom clamp widens to 0.012x-24x
 * so that Fit can FRAME the whole largest floor (fitView is no longer
 * floored by the clamp) while still allowing detailed zoom-in. These
 * checks pin that the big max is accepted, the max floor is framable
 * within the new clamp at any reference viewport, and large-floor culling
 * + a set-then-Fit round-trip still behave. 1 cell = 1 m throughout, so a
 * bigger floor is literally more real metres - distances stay accurate.
 * ===================================================================== */

/* ---- 16. Large max floor is ACCEPTED exactly -------------------- */
(() => {
  const max = V.normalizeFloor(V.FLOOR_MAX_W, V.FLOOR_MAX_H);
  check("v2.2 normalizeFloor accepts the LARGE max (1200 x 800) exactly",
    V.FLOOR_MAX_W === 1200 && V.FLOOR_MAX_H === 800 &&
    max.gridW === 1200 && max.gridH === 800,
    "FLOOR_MAX=" + V.FLOOR_MAX_W + "x" + V.FLOOR_MAX_H + " -> " + max.gridW + "x" + max.gridH);
})();

/* ---- 17. Beyond the new max clamps down to it; min unchanged ----- */
(() => {
  const beyond = V.normalizeFloor(2000, 1200);
  const under = V.normalizeFloor(2, 3);
  check("v2.2 normalizeFloor clamps BEYOND the large max down to it (min still 8)",
    beyond.gridW === 1200 && beyond.gridH === 800 &&
    under.gridW === V.FLOOR_MIN && under.gridH === V.FLOOR_MIN,
    "2000x1200 -> " + beyond.gridW + "x" + beyond.gridH + ", 2x3 -> " + under.gridW + "x" + under.gridH);
})();

/* ---- 18. Wider zoom clamp: low enough MIN, unchanged-or-higher MAX */
(() => {
  // MIN must be low enough to fit the max floor (needs ~0.0288); MAX must
  // not have regressed below 5x; the max-floor Fit scale passes un-floored.
  check("v2.2 clampScale is wider: MIN <= 0.02 (was 0.04), MAX >= 5, max-floor fit un-floored",
    V.SCALE_MIN <= 0.02 && V.SCALE_MAX >= 5 &&
    approx(V.clampScale(0.0288), 0.0288) && V.clampScale(0.0288) > V.SCALE_MIN,
    "min=" + V.SCALE_MIN + " max=" + V.SCALE_MAX);
})();

/* ---- 19. The MAX floor is FRAMABLE - Fit is not floored by clamp - */
(() => {
  // Reference viewport (800x480 at cellPx=20). fitView computes the scale
  // that shows the whole 1200x800 floor; it must be > 0 and STRICTLY inside
  // the new clamp (i.e. > SCALE_MIN) so clampScale does not floor it. It is
  // also below the OLD 0.04 floor - which is exactly why the clamp widened.
  const f = V.fitView(20, V.FLOOR_MAX_W, V.FLOOR_MAX_H, 800, 480, 0.04);
  check("v2.2 Fit frames the MAX floor: scale > 0, inside clamp (> MIN), below old 0.04 floor",
    f.scale > 0 &&
    f.scale >= V.SCALE_MIN && f.scale <= V.SCALE_MAX &&
    f.scale > V.SCALE_MIN &&
    f.scale < 0.04 &&
    approx(f.scale, 0.0288, 1e-6),
    "fitScale=" + f.scale.toFixed(5) + " clamp=[" + V.SCALE_MIN + "," + V.SCALE_MAX + "]");
})();

/* ---- 20. Framability is viewport-independent (wider canvas) ------ */
(() => {
  // The viewport keeps the reference aspect, so the Fit scale is the same
  // at a wider reference canvas (1100x660 at cellPx=27.5) - still above the
  // clamp floor, so the whole max floor frames at any canvas size.
  const f = V.fitView(27.5, V.FLOOR_MAX_W, V.FLOOR_MAX_H, 1100, 660, 0.04);
  check("v2.2 Fit scale for the MAX floor is viewport-independent and stays above the clamp MIN",
    approx(f.scale, 0.0288, 1e-6) && f.scale > V.SCALE_MIN,
    "fitScale@1100=" + f.scale.toFixed(5));
})();

/* ---- 21. Large-floor culling keeps only on-screen elements ------ */
(() => {
  // Elements spread across the full 1200x800 floor. At 100% zoom the visible
  // world window is only the top-left 40x24 (viewBounds), so cullToView must
  // return ONLY the element in that corner - a big floor draws just what's on
  // screen (the v1.6 perf path, unchanged).
  const big = [
    { id: "nw", x: 2, y: 2, w: 6, d: 4 },
    { id: "ne", x: 1190, y: 3, w: 6, d: 4 },
    { id: "sw", x: 3, y: 794, w: 6, d: 4 },
    { id: "se", x: 1192, y: 794, w: 6, d: 4 },
    { id: "mid", x: 600, y: 400, w: 6, d: 4 },
  ];
  const bigView = { cellPx: 20, scale: 1, panX: 0, panY: 0 };
  const vb = V.viewBounds(bigView, 800, 480); // -> {0,0,40,24}
  const kept = V.cullToView(big, vb, 0);
  const keptIds = kept.map((e) => e.id).join(",");
  check("v2.2 cullToView on a LARGE (1200x800) floor keeps ONLY the on-screen elements",
    keptIds === "nw" && kept.length < big.length,
    "visible=[" + keptIds + "] of " + big.length + " total; window=" +
    vb.minX + "," + vb.minY + "->" + vb.maxX + "," + vb.maxY);
})();

/* ---- 22. Round-trip: set the MAX floor, Fit, bounds cover it ----- */
(() => {
  // Set the max floor, compute Fit, build the resulting view, and confirm
  // its visible world rectangle COVERS the entire floor [0,400]x[0,250] -
  // i.e. the whole hall is on screen after Fit.
  const GW = V.FLOOR_MAX_W, GH = V.FLOOR_MAX_H, cpx = 20, VW = 800, VH = 480;
  const f = V.fitView(cpx, GW, GH, VW, VH, 0.04);
  const fitted = { cellPx: cpx, scale: f.scale, panX: f.panX, panY: f.panY };
  const vb = V.viewBounds(fitted, VW, VH);
  const covers = vb.minX <= 0 && vb.minY <= 0 && vb.maxX >= GW && vb.maxY >= GH;
  check("v2.2 round-trip: set the MAX floor then Fit -> view bounds COVER the whole floor",
    covers && f.scale > V.SCALE_MIN,
    "bounds " + vb.minX.toFixed(1) + "," + vb.minY.toFixed(1) + " -> " +
    vb.maxX.toFixed(1) + "," + vb.maxY.toFixed(1) + " covers 0,0->" + GW + "," + GH + " = " + covers);
})();

/* =====================================================================
 * v3.8 REDESIGN-1 - Deeper detail zoom. The interactive zoom clamp MAX
 * rises to 24x (was 8x) so a single component reads large on screen in a
 * big empty hall, while Fit still frames the whole largest floor (the MIN
 * side is unchanged, so the max-floor Fit is still un-floored). 1 cell =
 * 1 m throughout; the transform math is otherwise untouched.
 * ===================================================================== */

/* ---- 23. Deeper detail zoom: MAX is 24x, still clamps, Fit unaffected  */
(() => {
  // The deep-zoom MAX must be exactly 24 (the new detail ceiling) and the
  // clamp must still saturate there; a mid value passes through; the MIN is
  // unchanged so Fit still frames the max floor un-floored (regression).
  const f = V.fitView(20, V.FLOOR_MAX_W, V.FLOOR_MAX_H, 800, 480, 0.04);
  check("v3.8 deeper zoom: SCALE_MAX === 24, clamp saturates, Fit still frames the MAX floor",
    V.SCALE_MAX === 24 &&
    V.clampScale(1000) === 24 &&
    V.clampScale(24) === 24 &&
    approx(V.clampScale(12), 12) &&
    V.clampScale(30) === V.SCALE_MAX &&
    f.scale > V.SCALE_MIN && f.scale < 0.04 && approx(f.scale, 0.0288, 1e-6),
    "max=" + V.SCALE_MAX + " fitMaxFloor=" + f.scale.toFixed(5));
})();

/* ---- 24. A single component fills a large fraction of the viewport at MAX  */
(() => {
  // At the deep-zoom MAX, one metre of world reads as cellPx*SCALE_MAX px on
  // screen (20 * 24 = 480). A single 2 x 2 m component therefore spans ~960 px
  // - i.e. it fills a normal viewport, which is the whole point of the deeper
  // ceiling: you can study one component in a big hall.
  const view = { cellPx: 20, scale: V.SCALE_MAX, panX: 0, panY: 0 };
  const a = V.worldToScreen(view, 10, 10);
  const b = V.worldToScreen(view, 12, 12); // a 2 x 2 m footprint
  const spanPx = b.x - a.x;
  check("v3.8 deeper zoom: a 2x2 m component spans a large pixel footprint at MAX zoom",
    approx(spanPx, 2 * 20 * V.SCALE_MAX) && spanPx >= 900,
    "2m spans " + spanPx.toFixed(0) + "px at " + V.SCALE_MAX + "x");
})();

console.log("");
console.log(failures === 0
  ? "ALL VIEW CHECKS PASSED"
  : failures + " VIEW CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
