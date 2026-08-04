/* =====================================================================
 * verify_animation.js - "living plant" animation checks (v1.8):
 *   (1) "P" switches the whole view 2D <-> 2.5D (the SAME toggle the
 *       toolbar button fires), input- + modifier-guarded;
 *   (2) the animated material flow renders in the 2.5D (3D) view too; and
 *   (3) the EQUIPMENT is animated in BOTH views by a DETERMINISTIC phase
 *       seeded from the flow sim's tick (NO Date/Math.random), passed as
 *       one source of truth into WT.shapes.draw2D/draw3D, pausing with the
 *       sim and LOD-aware.
 *
 * Runs the REAL pure modules (domain.js, iso.js, shapes.js) in Node under
 * the same window shim the other harnesses use, and static-scans the wired
 * files (app.js, iso.js, index.html, selftest.js, sw.js, test/run-all.mjs)
 * for the parts that live behind the canvas/DOM (not headless-testable).
 * The live pixels + the live keypress are verified in the browser
 * (?selftest=1); every PATH is exercised here.
 *
 * Checks (all deterministic):
 *   1. WT.shapes.equipmentPhase is bounded in [0,1), deterministic, varies
 *   2. equipmentPhase is periodic (period ANIM_PERIOD, a positive number)
 *   3. shapes.js animation is deterministic at the SOURCE (no Date/random)
 *   4. draw2D anim smoke: every animatable type x phases x themes - no
 *      throw, all-finite coords, returns true
 *   5. draw2D anim MOVES the part (distinct output at distinct phases) for
 *      animatable types; a non-animatable type ignores anim (identical)
 *   6. draw2D is LOD-aware: at a tiny on-screen scale the animation is
 *      skipped (icon path identical across phases)
 *   7. draw2D with anim does not mutate its input; no-anim path deterministic
 *   8. draw3D anim smoke: every animatable type x phases x themes - clean
 *   9. draw3D anim MOVES the part for animatable; non-animatable ignores it
 *  10. draw3D with anim does not mutate its input
 *  11. iso projection: WT.iso.project returns finite coords for MU-like world
 *      positions, AND iso.js drawScene threads animFor -> draw3D anim
 *  12. app.js: the "p"/"P" keydown maps to the view-mode toggle and is
 *      input- + modifier-guarded (assert the handler logic)
 *  13. app.js: the material flow renders in 3D (renderIsoWorld draws the
 *      flow MUs/stations via projPx -> WT.iso.project) AND the equipment
 *      anim is seeded from the sim tick, gated on playing, threaded into
 *      draw2D + drawScene(animFor)
 *  14. shipped wiring: index.html isoBtn mentions "P", sw.js is wt-v39,
 *      selftest.js has the P-toggle check, run-all.mjs lists this harness
 *
 * Usage:  node verify_animation.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // domain.js / iso.js / shapes.js attach to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "domain.js"), "utf8"));
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "iso.js"), "utf8"));
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(__dirname, "shapes.js"), "utf8"));
const S = global.WT.shapes;
const ISO = global.WT.iso;
const D = global.WT.domain;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SHAPES_SRC = read("shapes.js");
const ISO_SRC = read("iso.js");
const APP_SRC = read("app.js");
const INDEX_SRC = read("index.html");
const SELFTEST_SRC = read("selftest.js");
const SW_SRC = read("sw.js");
const RUNALL_SRC = read(path.join("test", "run-all.mjs"));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

const ANIMATABLE = ["conveyor", "rgv", "agv", "asrs", "shuttle"];
const NON_ANIM = "selective-racking"; // a type with no moving part
const THEMES = ["light", "dark"];
const PHASES = [0, 0.1, 0.37, 0.5, 0.63, 0.99];

/* ---- Recording mock 2D context (logs every coord for diffing) ------ */
function makeCtx() {
  const ctx = { _bad: [], _calls: 0, _log: [], _minY: Infinity, _maxY: -Infinity };
  const num = (name, args) => {
    ctx._calls++;
    ctx._log.push(name + ":" + args.map((n) => (typeof n === "number" ? n.toFixed(3) : String(n))).join(","));
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
  ctx.fillStyle = ""; ctx.strokeStyle = ""; ctx.lineWidth = 1; ctx.lineJoin = "";
  ctx.font = ""; ctx.textAlign = ""; ctx.textBaseline = ""; ctx.globalAlpha = 1;
  return ctx;
}
// A deterministic 2:1-dimetric-style projection: finite for finite input.
function makeP() {
  return (cx, cy, cz) => ({ x: 400 + (cx - cy) * 18, y: 260 + (cx + cy) * 9 - (cz || 0) * 6 });
}
function g2(type, anim, lod) {
  const def = D.ELEMENTS[type];
  const g = { x: 100, y: 80, w: def.w * 20, d: def.d * 20, cellPx: 20, color: def.color, theme: "light", lod: lod == null ? 44 : lod };
  if (anim !== undefined) g.anim = anim;
  return g;
}
function o3(type, anim) {
  const def = D.ELEMENTS[type];
  const o = { cx: 4, cy: 3, w: def.w, d: def.d, heightM: def.heightM || 6, color: def.color, theme: "light" };
  if (anim !== undefined) o.anim = anim;
  return o;
}
function rec2D(type, anim, lod) { const c = makeCtx(); S.draw2D(c, type, g2(type, anim, lod)); return c; }
function rec3D(type, anim) { const c = makeCtx(); S.draw3D(c, type, makeP(), o3(type, anim)); return c; }

console.log("Living-plant animation (P toggle + flow-in-3D + animated equipment) verification");
console.log("");

/* ---- 1. equipmentPhase bounded [0,1), deterministic, varies -------- */
(() => {
  const fn = S.equipmentPhase;
  if (typeof fn !== "function") { check("equipmentPhase exists + bounded [0,1) + deterministic + varies", false, "WT.shapes.equipmentPhase MISSING"); return; }
  let bounded = true, deterministic = true, badVal = null;
  const seen = {};
  for (let seed = 0; seed < 5; seed++) {
    for (let i = 0; i < 400; i++) {
      const t = i * 0.137;
      const p = fn(t, seed);
      if (!(typeof p === "number" && isFinite(p) && p >= 0 && p < 1)) { bounded = false; badVal = "t=" + t + " seed=" + seed + " -> " + p; }
      if (fn(t, seed) !== p) deterministic = false;
      seen[Math.floor(p * 20)] = 1;
    }
  }
  // NaN/garbage inputs are clamped to a finite in-range value (never throws).
  const safe = fn(NaN, undefined) >= 0 && fn(NaN, undefined) < 1 && fn(Infinity, "x") >= 0;
  const varies = Object.keys(seen).length >= 5; // not a constant
  check("equipmentPhase exists + bounded in [0,1) + deterministic + varies + garbage-safe",
    bounded && deterministic && varies && safe,
    badVal ? "out-of-range " + badVal : ("bounded=" + bounded + " determ=" + deterministic + " buckets=" + Object.keys(seen).length + " safe=" + safe));
})();

/* ---- 2. equipmentPhase periodic (period ANIM_PERIOD) --------------- */
(() => {
  const fn = S.equipmentPhase;
  const period = S.ANIM_PERIOD;
  if (typeof fn !== "function" || !(typeof period === "number" && period > 0)) {
    check("equipmentPhase is periodic (period ANIM_PERIOD > 0)", false, "ANIM_PERIOD=" + period); return;
  }
  let maxErr = 0;
  for (let seed = 0; seed < 4; seed++) {
    for (let i = 0; i < 50; i++) {
      const t = i * 0.211;
      for (const k of [1, 2, 5]) {
        const err = Math.abs(fn(t, seed) - fn(t + period * k, seed));
        // modulo periodicity: identical up to float rounding
        const wrapped = Math.min(err, 1 - err);
        if (wrapped > maxErr) maxErr = wrapped;
      }
    }
  }
  check("equipmentPhase is periodic with period ANIM_PERIOD (a positive number)",
    maxErr < 1e-9, "ANIM_PERIOD=" + period + " maxErr=" + maxErr.toExponential(2));
})();

/* ---- 3. shapes.js animation is deterministic at the SOURCE --------- */
(() => {
  const hasRandom = /Math\.random\s*\(/.test(SHAPES_SRC);
  const hasDate = /Date\.now\s*\(|new\s+Date\s*\(/.test(SHAPES_SRC);
  check("shapes.js is deterministic (NO Math.random, NO Date in the animation module)",
    !hasRandom && !hasDate, "Math.random=" + hasRandom + " Date=" + hasDate);
})();

/* ---- 4. draw2D anim smoke: animatable x phases x themes ------------ */
(() => {
  let bad = null, notFinite = null, retFail = null;
  for (const t of ANIMATABLE) {
    for (const theme of THEMES) {
      for (const ph of PHASES) {
        const c = makeCtx();
        let ok;
        try {
          const g = g2(t, ph); g.theme = theme;
          ok = S.draw2D(c, t, g);
        } catch (e) { bad = t + "/" + theme + "@" + ph + ": " + e.message; ok = false; }
        if (ok !== true) retFail = t + "/" + theme + "@" + ph + " ret=" + ok;
        if (c._bad.length) notFinite = t + "/" + theme + "@" + ph + " " + c._bad[0];
      }
    }
  }
  check("draw2D anim smoke: every animatable type x phases x themes - no throw, all finite, returns true",
    bad === null && notFinite === null && retFail === null,
    bad ? "throw " + bad : (notFinite ? "non-finite " + notFinite : (retFail ? "ret " + retFail : (ANIMATABLE.length * THEMES.length * PHASES.length) + " draws clean")));
})();

/* ---- 5. draw2D anim MOVES the part (animatable) / ignored (other) -- */
(() => {
  let moveFail = null;
  for (const t of ANIMATABLE) {
    const a = rec2D(t, 0.12)._log.join("|");
    const b = rec2D(t, 0.63)._log.join("|");
    if (a === b) moveFail = t + " (identical output at 0.12 vs 0.63 - no motion)";
  }
  // a non-animatable type must ignore anim entirely (identical at any phase)
  const na = rec2D(NON_ANIM, 0.12)._log.join("|");
  const nb = rec2D(NON_ANIM, 0.63)._log.join("|");
  const ignored = na === nb;
  check("draw2D: a distinct phase MOVES the animatable part; a non-animatable type ignores anim",
    moveFail === null && ignored, moveFail || ("moved all " + ANIMATABLE.length + " animatable; " + NON_ANIM + " ignored=" + ignored));
})();

/* ---- 6. draw2D is LOD-aware: tiny scale skips the animation -------- */
(() => {
  let fail = null;
  for (const t of ANIMATABLE) {
    // lod=3 px/cell -> the icon path; anim must be skipped (identical output)
    const a = rec2D(t, 0.12, 3)._log.join("|");
    const b = rec2D(t, 0.63, 3)._log.join("|");
    if (a !== b) fail = t + " (animated on the tiny LOD icon path)";
  }
  check("draw2D is LOD-aware: at a tiny on-screen scale the animation is skipped (icon identical across phases)",
    fail === null, fail || "all " + ANIMATABLE.length + " animatable static at LOD scale");
})();

/* ---- 7. draw2D anim no-mutate + no-anim deterministic ------------- */
(() => {
  let mut = null;
  for (const t of ANIMATABLE) {
    const g = g2(t, 0.42);
    const before = JSON.stringify(g);
    S.draw2D(makeCtx(), t, g);
    if (JSON.stringify(g) !== before) mut = t;
  }
  // the STATIC (no-anim) path is deterministic (byte-identical on re-run)
  let determ = true;
  for (const t of ANIMATABLE) {
    if (rec2D(t, undefined)._log.join("|") !== rec2D(t, undefined)._log.join("|")) determ = false;
  }
  check("draw2D with anim does not mutate its input; the static (no-anim) path is deterministic",
    mut === null && determ, mut ? "mutated " + mut : "no-mutate + determ ok");
})();

/* ---- 8. draw3D anim smoke: animatable x phases x themes ------------ */
(() => {
  let bad = null, notFinite = null, retFail = null;
  const P = makeP();
  for (const t of ANIMATABLE) {
    for (const theme of THEMES) {
      for (const ph of PHASES) {
        const c = makeCtx();
        let ok;
        try { const o = o3(t, ph); o.theme = theme; ok = S.draw3D(c, t, P, o); }
        catch (e) { bad = t + "/" + theme + "@" + ph + ": " + e.message; ok = false; }
        if (ok !== true) retFail = t + "/" + theme + "@" + ph + " ret=" + ok;
        if (c._bad.length) notFinite = t + "/" + theme + "@" + ph + " " + c._bad[0];
      }
    }
  }
  check("draw3D anim smoke: every animatable type x phases x themes - no throw, all finite, returns true",
    bad === null && notFinite === null && retFail === null,
    bad ? "throw " + bad : (notFinite ? "non-finite " + notFinite : (retFail ? "ret " + retFail : (ANIMATABLE.length * THEMES.length * PHASES.length) + " forms clean")));
})();

/* ---- 9. draw3D anim MOVES the part (animatable) / ignored (other) -- */
(() => {
  let moveFail = null;
  for (const t of ANIMATABLE) {
    const a = rec3D(t, 0.12)._log.join("|");
    const b = rec3D(t, 0.63)._log.join("|");
    if (a === b) moveFail = t + " (identical 3D output at 0.12 vs 0.63 - no motion)";
  }
  const na = rec3D(NON_ANIM, 0.12)._log.join("|");
  const nb = rec3D(NON_ANIM, 0.63)._log.join("|");
  const ignored = na === nb;
  check("draw3D: a distinct phase MOVES the animatable form; a non-animatable type ignores anim",
    moveFail === null && ignored, moveFail || ("moved all " + ANIMATABLE.length + " animatable; " + NON_ANIM + " ignored=" + ignored));
})();

/* ---- 10. draw3D anim no-mutate ----------------------------------- */
(() => {
  let mut = null;
  const P = makeP();
  for (const t of ANIMATABLE) {
    const o = o3(t, 0.42);
    const before = JSON.stringify(o);
    S.draw3D(makeCtx(), t, P, o);
    if (JSON.stringify(o) !== before) mut = t;
  }
  check("draw3D with anim does not mutate its input", mut === null, mut ? "mutated " + mut : "inputs unchanged");
})();

/* ---- 11. iso projection of an MU position + drawScene threads anim - */
(() => {
  if (typeof ISO.project !== "function") { check("iso.project projects an MU world position to finite coords + drawScene threads animFor", false, "WT.iso.project MISSING"); return; }
  // MU-like positions: fractional world cells (as flowsim reports) at a small
  // height off the floor (projPx uses cz~0.3 for MUs, ~0.1 for stations).
  const samples = [[0, 0, 0.3], [3.5, 2.25, 0.3], [39.9, 23.9, 0.1], [12.34, 7.89, 0.3], [-1.5, 40.2, 0.3]];
  let finiteOk = true, badS = null;
  for (const [cx, cy, cz] of samples) {
    const p = ISO.project(cx, cy, cz);
    if (!(p && isFinite(p.x) && isFinite(p.y))) { finiteOk = false; badS = cx + "," + cy + "," + cz; }
  }
  // iso.js drawScene passes an optional animFor(el) through to draw3D's anim,
  // so the animated equipment appears in the 2.5D view (source proof - the
  // canvas draw is verified live).
  const threads = /animFor/.test(ISO_SRC) && /anim:\s*animFor\s*\?\s*animFor\(e\)\s*:/.test(ISO_SRC);
  check("iso.project projects an MU world position to finite coords + drawScene threads animFor -> draw3D",
    finiteOk && threads, badS ? "non-finite at " + badS : "5 MU samples finite; drawScene threads animFor=" + threads);
})();

/* ---- 12. app.js: "P"/"p" keydown -> view toggle, guarded ---------- */
(() => {
  // input guard on the keydown listener (ignore typing in fields)
  const inputGuard = /addEventListener\(\s*["']keydown["'][\s\S]{0,220}?input\|select\|textarea/.test(APP_SRC);
  // the P branch: matches "p" OR "P", excludes modifier combos, calls the toggle
  const m = APP_SRC.match(/e\.key\s*===\s*"p"[\s\S]{0,260}?toggleViewMode\(\)/);
  const pBranch = !!m;
  const modGuard = pBranch && /!e\.ctrlKey/.test(m[0]) && /!e\.metaKey/.test(m[0]) && /!e\.altKey/.test(m[0]) && /e\.key\s*===\s*"P"/.test(m[0]);
  // toggleViewMode fires the SAME setViewMode the "2.5D view" button uses
  const sameToggle = /function\s+toggleViewMode\s*\(\s*\)\s*\{[\s\S]{0,120}?setViewMode\(/.test(APP_SRC);
  check("app.js: the p/P keydown maps to the view-mode toggle and is input- + modifier-guarded",
    inputGuard && pBranch && modGuard && sameToggle,
    "inputGuard=" + inputGuard + " pBranch=" + pBranch + " modGuard=" + modGuard + " sameToggle=" + sameToggle);
})();

/* ---- 13. app.js: flow-in-3D + deterministic tick-seeded equipment -- */
(() => {
  // The material flow renders in the iso view: renderIsoWorld draws the flow
  // stations + MUs, and those are projected through the iso projection (projPx
  // -> WT.iso.project), so the moving boxes appear in 3D too.
  const isoFn = APP_SRC.match(/function\s+renderIsoWorld\s*\(\s*\)\s*\{[\s\S]*?\n  \}/);
  const flowInIso = !!isoFn && /drawFlowStations\(\)/.test(isoFn[0]) && /drawFlowMUs\(\)/.test(isoFn[0]);
  const projUsesIso = /function\s+projPx[\s\S]{0,220}?WT\.iso\.project\(/.test(APP_SRC);
  const muUsesProj = /function\s+drawFlowMUs/.test(APP_SRC) && /projPx\(\s*mu\.cx/.test(APP_SRC);
  // Equipment anim: seeded from the sim tick, gated on the flow PLAYING, and
  // threaded into BOTH draw2D (anim:) and drawScene (animFor:).
  const seededByTick = /state\.flow\.sim\.tick/.test(APP_SRC) && /equipmentPhase\(/.test(APP_SRC);
  const gatedOnPlaying = /flowAnimContext[\s\S]{0,260}?state\.flow\.playing/.test(APP_SRC);
  const into2D = /anim:\s*\(fa\.on\s*&&\s*ANIMATABLE_TYPES\[e\.type\]\)/.test(APP_SRC);
  const intoIso = /animFor:\s*animFor/.test(APP_SRC);
  const ok = flowInIso && projUsesIso && muUsesProj && seededByTick && gatedOnPlaying && into2D && intoIso;
  check("app.js: material flow renders in 3D (projPx->iso.project) + equipment anim is tick-seeded, playing-gated, into draw2D + drawScene",
    ok, "flowInIso=" + flowInIso + " projIso=" + projUsesIso + " muProj=" + muUsesProj + " tickSeed=" + seededByTick + " playGate=" + gatedOnPlaying + " into2D=" + into2D + " intoIso=" + intoIso);
})();

/* ---- 14. shipped wiring: button hint, sw bump, selftest, runner --- */
(() => {
  const btnHint = /id="isoBtn"[^>]*aria-label="[^"]*\bP\b[^"]*"/.test(INDEX_SRC) && /Press P to switch/.test(INDEX_SRC);
  const swBump = /CACHE_VERSION\s*=\s*"wt-v39"/.test(SW_SRC);
  const selftestP = /key-p-toggles-view-mode/.test(SELFTEST_SRC) && /dispatchEvent/.test(SELFTEST_SRC) && /KeyboardEvent/.test(SELFTEST_SRC);
  const inRunner = /verify_animation\.js/.test(RUNALL_SRC);
  check("shipped wiring: isoBtn advertises P, sw.js is wt-v39, selftest has the P-toggle check, run-all lists verify_animation",
    btnHint && swBump && selftestP && inRunner,
    "btnHint=" + btnHint + " sw=" + swBump + " selftest=" + selftestP + " runner=" + inRunner);
})();

console.log("");
console.log(failures === 0
  ? "ALL ANIMATION CHECKS PASSED (14 checks)"
  : failures + " ANIMATION CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
