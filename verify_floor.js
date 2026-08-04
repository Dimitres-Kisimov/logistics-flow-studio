/* =====================================================================
 * verify_floor.js - realistic-floor rendering geometry (v1.12).
 *
 * Runs the REAL floor module (floor.js) in Node with the same window shim
 * the other harnesses use and asserts its PURE geometry directly. This is
 * the headless stand-in for the live canvas: the browser DOM cannot be
 * exercised in the sandbox, but every helper app.js paints the realistic
 * floor from (the two-tier grid LOD, the edge scale ruler, per-element
 * dimension labels and the faint floor markings - perimeter, aisle guides,
 * dock-approach hatching, functional zone tints) is a pure function and is
 * fully testable here. The live pixels are verified in the browser.
 *
 * Checks (all deterministic):
 *   - rulerTicks returns correct, ordered, labelled tick positions and
 *     always closes on the true floor edge; garbage -> []; pure (no mutate)
 *   - the grid tiers + LOD: MAJOR/MINOR step constants, and the minor 1 m
 *     grid only shows at or above the px/cell threshold (garbage -> false)
 *   - the ruler LABEL step widens when zoomed out and is a whole multiple
 *     of the major step
 *   - dimensionLabel returns the correct "w x d m" text (metre grid), whole
 *     values un-decimalled, garbage -> ""
 *   - perimeter is the origin-anchored floor rect with in-bounds corners
 *   - dockApproach returns an in-bounds apron + hatch lines fully inside it
 *     for a dock on every edge, and does NOT mutate the element
 *   - aisleGuides returns a centre line between a facing pair, in bounds,
 *     without mutating the pairs; empty pairs -> []
 *   - zoneTints only yields tints when zone-bearing elements exist (empty
 *     otherwise), maps types to the right stage, and does not mutate inputs
 *   - the illustrative / not-a-survey / not-CAD-BIM honesty label is present
 *   - shipped wiring: floor.js loaded + precached (wt-v41), the Measurements
 *     toggle control (measureBtn) exists and is wired, the runner lists it
 *
 * Usage:  node verify_floor.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // floor.js attaches itself to window.WT
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "floor.js"), "utf8"));
const F = global.WT.floor;

const TIMES = String.fromCharCode(0x00d7); // the U+00D7 multiplication sign

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
function inRange(v, lo, hi) { return isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9; }

console.log("Realistic-floor rendering geometry verification (v1.12)");
console.log("");

/* ---- 1. rulerTicks: whole-multiple floor ------------------------- */
(() => {
  const t = F.rulerTicks(40, 5);
  const ms = t.map((x) => x.m);
  const ordered = ms.every((m, i) => i === 0 || m > ms[i - 1]);
  const spaced = t.slice(0, 9).every((x, i) => approx(x.m, i * 5));
  check("rulerTicks(40,5) -> 0..40 every 5 m, ordered, labelled, closes on the edge",
    t.length === 9 && t[0].m === 0 && t[0].label === "0" &&
    t[t.length - 1].m === 40 && t[t.length - 1].label === "40" &&
    ordered && spaced,
    "n=" + t.length + " last=" + ms[ms.length - 1]);
})();

/* ---- 2. rulerTicks: non-multiple floor appends the true edge ----- */
(() => {
  const t = F.rulerTicks(24, 5);
  const last = t[t.length - 1];
  const interior = t.slice(0, t.length - 1).map((x) => x.m);
  check("rulerTicks(24,5) keeps the 5 m marks and appends the 24 m edge",
    interior.join(",") === "0,5,10,15,20" &&
    last.m === 24 && last.label === "24" && last.edge === true,
    "last=" + last.m + " edge=" + last.edge);
})();

/* ---- 3. rulerTicks: garbage + purity ----------------------------- */
(() => {
  const bad = F.rulerTicks(0, 5).length === 0 &&
    F.rulerTicks(-4, 5).length === 0 &&
    F.rulerTicks(40, 0).length === 0 &&
    F.rulerTicks(NaN, 5).length === 0 &&
    F.rulerTicks(40, "x").length === 0;
  const a = JSON.stringify(F.rulerTicks(40, 5));
  const b = JSON.stringify(F.rulerTicks(40, 5));
  check("rulerTicks rejects garbage -> [] and is deterministic (byte-identical re-run)",
    bad && a === b);
})();

/* ---- 4. grid tiers + minor-grid LOD threshold -------------------- */
(() => {
  const P = F.MINOR_GRID_MIN_PX;
  const okConst = F.MAJOR_STEP_M === 5 && F.MINOR_STEP_M === 1 &&
    isFinite(P) && P > 0;
  const gate = F.minorGridVisible(P) === true &&
    F.minorGridVisible(P + 5) === true &&
    F.minorGridVisible(P - 0.01) === false &&
    F.minorGridVisible(0) === false &&
    F.minorGridVisible(NaN) === false &&
    F.minorGridVisible("x") === false;
  check("grid tiers: major 5 m / minor 1 m; minor grid shows ONLY at/above the px/cell threshold",
    okConst && gate, "minorMinPx=" + P);
})();

/* ---- 5. markings LOD + ruler label step -------------------------- */
(() => {
  const mk = F.markingsVisible(F.MARKINGS_MIN_PX) === true &&
    F.markingsVisible(F.MARKINGS_MIN_PX - 0.01) === false &&
    F.markingsVisible(NaN) === false;
  // Zoomed in (big px/cell): step stays at the major 5 m.
  const inStep = F.rulerLabelStepM(30);
  // Zoomed way out (tiny px/cell): step grows but stays a multiple of 5.
  const outStep = F.rulerLabelStepM(1.5);
  check("markings are LOD-gated + the ruler label step widens (whole multiple of 5) when zoomed out",
    mk && inStep === 5 && outStep > 5 && outStep % F.MAJOR_STEP_M === 0 &&
    outStep * 1.5 >= F.RULER_LABEL_MIN_PX,
    "in=" + inStep + " out=" + outStep);
})();

/* ---- 6. dimensionLabel ------------------------------------------- */
(() => {
  const whole = F.dimensionLabel({ w: 12, d: 6 }, 1);
  const dec = F.dimensionLabel({ w: 2.5, d: 1, x: 0, y: 0 }, 1);
  const scaled = F.dimensionLabel({ w: 3, d: 2 }, 2); // metresPerCell = 2
  const bad = F.dimensionLabel(null, 1) === "" &&
    F.dimensionLabel({ w: NaN, d: 2 }, 1) === "";
  const el = { w: 12, d: 6 };
  const before = JSON.stringify(el);
  F.dimensionLabel(el, 1);
  check("dimensionLabel -> 'w x d m' (metre grid), whole values un-decimalled, garbage -> '', no mutation",
    whole === "12 " + TIMES + " 6 m" &&
    dec === "2.5 " + TIMES + " 1 m" &&
    scaled === "6 " + TIMES + " 4 m" &&
    bad && JSON.stringify(el) === before,
    "whole-label-len=" + whole.length);
})();

/* ---- 7. perimeter ------------------------------------------------ */
(() => {
  const p = F.perimeter(40, 24);
  const cornersIn = p && p.points.every(([x, y]) => inRange(x, 0, 40) && inRange(y, 0, 24));
  check("perimeter is the origin-anchored floor rect with 4 in-bounds corners; garbage -> null",
    p && p.x === 0 && p.y === 0 && p.w === 40 && p.h === 24 &&
    p.points.length === 4 && cornersIn &&
    F.perimeter(0, 24) === null && F.perimeter(40, -1) === null,
    "rect=" + [p.x, p.y, p.w, p.h].join(","));
})();

/* ---- 8. dockApproach on every edge: in-bounds + hatch inside + pure */
(() => {
  const W = 40, H = 24;
  const cases = [
    { name: "top", el: { type: "dock-in", x: 4, y: 0, w: 3, d: 1 }, dir: "down" },
    { name: "bottom", el: { type: "dock-out", x: 4, y: 23, w: 3, d: 1 }, dir: "up" },
    { name: "left", el: { type: "dock-in", x: 0, y: 8, w: 1, d: 3 }, dir: "right" },
    { name: "right", el: { type: "dock-out", x: 39, y: 8, w: 1, d: 3 }, dir: "left" },
  ];
  let ok = true, why = "";
  for (const c of cases) {
    const before = JSON.stringify(c.el);
    const ap = F.dockApproach(c.el, W, H, 3);
    if (!ap) { ok = false; why = c.name + ":null"; break; }
    // apron rect in bounds
    if (!(inRange(ap.x, 0, W) && inRange(ap.y, 0, H) &&
          inRange(ap.x + ap.w, 0, W) && inRange(ap.y + ap.h, 0, H))) {
      ok = false; why = c.name + ":apron-oob"; break;
    }
    if (ap.dir !== c.dir) { ok = false; why = c.name + ":dir=" + ap.dir; break; }
    if (!ap.lines.length) { ok = false; why = c.name + ":no-lines"; break; }
    // every hatch endpoint finite AND inside the apron rect (so in bounds)
    for (const ln of ap.lines) {
      const finite = [ln.x0, ln.y0, ln.x1, ln.y1].every(isFinite);
      const inside = inRange(ln.x0, ap.x, ap.x + ap.w) && inRange(ln.x1, ap.x, ap.x + ap.w) &&
        inRange(ln.y0, ap.y, ap.y + ap.h) && inRange(ln.y1, ap.y, ap.y + ap.h);
      if (!finite || !inside) { ok = false; why = c.name + ":line-oob"; break; }
    }
    if (!ok) break;
    if (JSON.stringify(c.el) !== before) { ok = false; why = c.name + ":mutated"; break; }
  }
  check("dockApproach: in-bounds apron + hatch lines fully inside it on every edge, no element mutation",
    ok, why);
  check("dockApproach guards: no element / degenerate floor -> null",
    F.dockApproach(null, W, H, 3) === null && F.dockApproach({ x: 0, y: 0, w: 1, d: 1 }, 0, H, 3) === null);
})();

/* ---- 9. aisleGuides ---------------------------------------------- */
(() => {
  // Two racks facing across a horizontal aisle (rows stacked vertically).
  const a = { x: 5, y: 4, w: 10, d: 2 };
  const b = { x: 5, y: 8, w: 10, d: 2 }; // gap y in [6,8], centre 7
  const pairs = [{ a, b, axis: "y" }];
  const before = JSON.stringify(pairs);
  const guides = F.aisleGuides(pairs);
  const g = guides[0];
  const centred = g && approx(g.y0, 7) && approx(g.y1, 7) &&
    approx(g.x0, 5) && approx(g.x1, 15);
  // Side-by-side pair (aisle runs vertically).
  const c = { x: 4, y: 6, w: 2, d: 8 };
  const d = { x: 8, y: 6, w: 2, d: 8 }; // gap x in [6,8], centre 7
  const g2 = F.aisleGuides([{ a: c, b: d, axis: "x" }])[0];
  const centred2 = g2 && approx(g2.x0, 7) && approx(g2.x1, 7) &&
    approx(g2.y0, 6) && approx(g2.y1, 14);
  check("aisleGuides: centre line down the aisle for a facing pair (both axes), no mutation, [] on empty",
    guides.length === 1 && centred && centred2 &&
    F.aisleGuides([]).length === 0 && F.aisleGuides(null).length === 0 &&
    JSON.stringify(pairs) === before,
    g ? "cy=" + g.y0 : "no-guide");
})();

/* ---- 10. zoneTints: only when zones exist ------------------------ */
(() => {
  const none = F.zoneTints([]);
  const noneFlow = F.zoneTints([{ type: "conveyor", x: 1, y: 1, w: 4, d: 1 }]); // transport = no zone
  const rack = { type: "selective-racking", x: 2, y: 3, w: 6, d: 2 };
  const before = JSON.stringify([rack]);
  const one = F.zoneTints([rack]);
  const mixed = F.zoneTints([
    { type: "dock-in", x: 0, y: 0, w: 3, d: 1 },
    { type: "pack-station", x: 10, y: 10, w: 3, d: 2 },
    { type: "gate", x: 20, y: 0, w: 1, d: 2 }, // boundary = no zone
  ]);
  check("zoneTints yields nothing without zone-bearing elements ('only when zones exist')",
    none.length === 0 && noneFlow.length === 0);
  check("zoneTints maps a rack -> storage footprint, docks/pack -> receiving/packing, skips boundary; no mutation",
    one.length === 1 && one[0].stage === "storage" &&
    one[0].x === 2 && one[0].y === 3 && one[0].w === 6 && one[0].h === 2 &&
    mixed.length === 2 &&
    mixed.some((t) => t.stage === "receiving") && mixed.some((t) => t.stage === "packing") &&
    F.stageOfType("dock-out") === "shipping" && F.stageOfType("gate") === null &&
    JSON.stringify([rack]) === before,
    "stage=" + one[0].stage);
})();

/* ---- 11. honesty label ------------------------------------------- */
(() => {
  const d = String(F.DISCLAIMER || "").toLowerCase();
  check("honesty label: illustrative synthetic model, NOT a survey, NOT CAD/BIM",
    d.indexOf("illustrative") >= 0 && d.indexOf("synthetic") >= 0 &&
    d.indexOf("survey") >= 0 && d.indexOf("cad/bim") >= 0);
})();

/* ---- 12. shipped wiring (static source guards) ------------------- */
(() => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
  const html = read("index.html");
  const app = read("app.js");
  const sw = read("sw.js");
  const runner = read(path.join("test", "run-all.mjs"));
  const htmlOk = /<script[^>]+src="floor\.js"/.test(html) && /id="measureBtn"/.test(html);
  const appOk = /showMeasure/.test(app) && /toggleMeasure/.test(app) &&
    /getElementById|measureBtn/.test(app) && /WT\.floor/.test(app);
  const swOk = /"\.\/floor\.js"/.test(sw) && /wt-v41/.test(sw);
  const runOk = /verify_floor\.js/.test(runner);
  check("shipped wiring: index.html loads floor.js + has the measureBtn control",
    htmlOk);
  check("shipped wiring: app.js wires the Measurements toggle (showMeasure/toggleMeasure) through WT.floor",
    appOk);
  check("shipped wiring: sw.js precaches floor.js at the bumped wt-v41 cache; the runner lists verify_floor.js",
    swOk && runOk);
})();

console.log("");
console.log(failures === 0
  ? "ALL FLOOR CHECKS PASSED"
  : failures + " FLOOR CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
