/* =====================================================================
 * verify_story.js - Story Mode: cinematic guided tour verification (v1.13)
 *
 * Runs the REAL app modules (domain, compliance, simulation, generate,
 * nlcommands, examples, wms, flowsim, view, story) in Node under the same
 * window shim the other harnesses use and asserts the WT.story contract -
 * the PURE, DETERMINISTIC cinematic plan and the camera MATH behind it - so
 * the one-click Story Mode can never reference a missing example/capability,
 * the camera framing can never drift from the WT.view transform, and the
 * copy can never slip into hype or a wall-clock/RNG dependency:
 *
 *   1.  API surface: WT.story exposes PARAMS, STAGES, ACTIONS, STEPS,
 *       script, run, ease, frameZone, lerpCamera.
 *   2.  script() returns an ordered, NON-EMPTY step list matching the canon,
 *       is byte-stable across calls (determinism) and returns a FRESH copy.
 *   3.  Every step has id + stage + title + caption + action; every stage is
 *       a known flow stage OR "all" (the whole-floor frame).
 *   4.  ACTIONS is a non-empty known set and EVERY step.action is in it.
 *   5.  Every loadScenario step references an example id that EXISTS in
 *       WT.examples.library.
 *   6.  The tour WALKS all five functional zones: there is a frameZone step
 *       for each of receiving/storage/picking/packing/shipping, in flow order.
 *   7.  ease() is easeInOutCubic on a CLAMPED [0,1] progress: 0->0, 1->1,
 *       0.5->0.5, out-of-range clamps, symmetric (ease(t)+ease(1-t)==1),
 *       monotonic and deterministic.
 *   8.  frameZone() is PURE camera math that CENTRES a zone: pushing its
 *       result through WT.view.worldToScreen lands the zone centroid on the
 *       viewport centre; the scale is clamped within the WT.view zoom bounds
 *       and never tighter than zoneMaxScale; different centroids move the
 *       camera (different pan); garbage inputs stay finite; deterministic.
 *   9.  lerpCamera() endpoints are exact (t=0 -> from, t=1 -> to), the eased
 *       midpoint sits between them, it is deterministic and garbage-safe.
 *  10.  run() drives the actions in the declared order (a fake controller
 *       records the order) and is INTERRUPTIBLE (stops after the requested
 *       step and fires onStop).
 *  11.  CROSS-CONSISTENCY with the flow: for the tour's scenario,
 *       WT.flowsim.buildWaypoints yields a centroid for EACH of the five
 *       zones, and framing two different zones produces different camera
 *       pans - so the camera frames exactly where the boxes will move.
 *  12.  Honesty: the captions state the SYNTHETIC / teaching-animation /
 *       NOT-a-real-DES facts, name no real brand and carry no hype word.
 *  13.  Determinism guard (source scan): story.js references NO Date and NO
 *       Math.random and carries the "NO Date, NO RNG" note.
 *  14.  Shipped-source wiring: index.html loads story.js before app.js, sw.js
 *       precaches ./story.js at the bumped wt-v70 cache (previously wt-v69), and app.js wires the
 *       storyBtn control + exposes the Story self-test hook.
 *
 * Everything is deterministic (no wall-clock, no Math.random). Usage:
 *   node verify_story.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // app modules attach themselves to window.WT
for (const f of [
  "domain.js", "compliance.js", "simulation.js", "generate.js",
  "nlcommands.js", "examples.js", "wms.js", "flowsim.js", "view.js", "story.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const EX = WT.examples;
const S = WT.story;
const V = WT.view;
const F = WT.flowsim;

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function isNonEmptyStr(s) { return typeof s === "string" && s.trim().length > 0; }
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

console.log("Story Mode: cinematic guided tour verification (deterministic)");
console.log("");

// ---- 1. API surface -------------------------------------------------
check(
  "API surface: PARAMS/STAGES/ACTIONS/STEPS/script/run/ease/frameZone/lerpCamera present",
  S &&
    S.PARAMS && typeof S.PARAMS === "object" &&
    Array.isArray(S.STAGES) && Array.isArray(S.ACTIONS) && Array.isArray(S.STEPS) &&
    typeof S.script === "function" && typeof S.run === "function" &&
    typeof S.ease === "function" && typeof S.frameZone === "function" &&
    typeof S.lerpCamera === "function"
);

// ---- 2. script() ordered non-empty, matches canon, fresh + stable ---
const steps = S.script();
check(
  "script() returns an ordered, non-empty step list matching the canon",
  Array.isArray(steps) && steps.length > 0 &&
    steps.length === S.STEPS.length &&
    steps.every((s, i) => s.id === S.STEPS[i].id && s.action === S.STEPS[i].action),
  steps.map((s) => s.id).join(" -> ")
);
check("script() is deterministic (byte-identical across calls)",
  JSON.stringify(S.script()) === JSON.stringify(S.script()));
const m1 = S.script(); const m2 = S.script();
m1[0].title = "MUTATED";
check("script() returns a FRESH copy (mutating one never leaks)",
  m2[0].title !== "MUTATED" && S.STEPS[0].title !== "MUTATED");

// ---- 3. every step id/stage/title/caption/action; stage valid -------
const STAGE_OK = new Set(S.STAGES.concat(["all"]));
check(
  "every step has id + stage + title + caption + action, stage is a known zone or 'all'",
  steps.every((s) => isNonEmptyStr(s.id) && isNonEmptyStr(s.title) &&
    isNonEmptyStr(s.caption) && isNonEmptyStr(s.action) && STAGE_OK.has(s.stage))
);

// ---- 4. ACTIONS known set; every step.action in it ------------------
const known = new Set(S.ACTIONS);
check("ACTIONS is a non-empty known capability set",
  S.ACTIONS.length > 0 && S.ACTIONS.every(isNonEmptyStr), S.ACTIONS.join(", "));
const unknownActions = steps.filter((s) => !known.has(s.action)).map((s) => s.action);
check("every step.action maps to a known capability",
  unknownActions.length === 0,
  unknownActions.length ? "unknown: " + unknownActions.join(", ") : "all known");

// ---- 5. loadScenario references an existing example id --------------
const libIds = new Set((EX.library || []).map((e) => e.id));
const scenSteps = steps.filter((s) => s.action === "loadScenario");
const missingEx = scenSteps.filter((s) => !isNonEmptyStr(s.exampleId) || !libIds.has(s.exampleId)).map((s) => s.exampleId);
check(
  "every loadScenario step references an existing example id",
  scenSteps.length > 0 && missingEx.length === 0,
  scenSteps.map((s) => s.exampleId).join(", ") + (missingEx.length ? " | missing: " + missingEx.join(", ") : "")
);

// ---- 6. the tour walks all five zones in flow order -----------------
const zoneOrder = steps.filter((s) => s.action === "frameZone").map((s) => s.stage);
check(
  "a frameZone step for each of the five zones, in flow order",
  JSON.stringify(zoneOrder) === JSON.stringify(S.STAGES),
  zoneOrder.join(" -> ")
);

// ---- 7. ease() easeInOutCubic on a clamped [0,1] --------------------
(function () {
  const e0 = S.ease(0), e1 = S.ease(1), eh = S.ease(0.5);
  const clampLo = S.ease(-3), clampHi = S.ease(4);
  const symmetric = near(S.ease(0.3) + S.ease(0.7), 1) && near(S.ease(0.1) + S.ease(0.9), 1);
  let monotonic = true, prev = -1;
  for (let i = 0; i <= 20; i++) { const y = S.ease(i / 20); if (y < prev - 1e-9) monotonic = false; prev = y; }
  const determ = S.ease(0.37) === S.ease(0.37);
  check(
    "ease() is easeInOutCubic on clamped [0,1] (0->0,1->1,0.5->0.5,clamped,symmetric,monotonic,deterministic)",
    near(e0, 0) && near(e1, 1) && near(eh, 0.5) && clampLo === 0 && clampHi === 1 &&
      symmetric && monotonic && determ,
    "e0=" + e0 + " e1=" + e1 + " e0.5=" + eh + " clampLo=" + clampLo + " clampHi=" + clampHi
  );
})();

// ---- 8. frameZone() centres a zone through the SAME WT.view transform
(function () {
  const cellPx = 20, vw = 800, vh = 480;
  const cx = 30, cy = 12;
  const target = S.frameZone({ cx: cx, cy: cy, cellPx: cellPx, vw: vw, vh: vh });
  const view = { scale: target.scale, panX: target.panX, panY: target.panY, cellPx: cellPx };
  const scr = V.worldToScreen(view, cx, cy); // must land on the viewport centre
  const centred = near(scr.x, vw / 2, 1e-4) && near(scr.y, vh / 2, 1e-4);
  const scaleOk = target.scale >= V.SCALE_MIN - 1e-9 && target.scale <= V.SCALE_MAX + 1e-9 &&
    target.scale <= S.PARAMS.zoneMaxScale + 1e-9;
  // A different centroid must move the camera (different pan).
  const other = S.frameZone({ cx: 4, cy: 4, cellPx: cellPx, vw: vw, vh: vh });
  const moved = !near(other.panX, target.panX, 1e-6) || !near(other.panY, target.panY, 1e-6);
  // Garbage inputs -> finite transform (never NaN).
  const junk = S.frameZone({ cx: NaN, cy: "x", cellPx: 0, vw: -1, vh: 0 });
  const finite = isFinite(junk.scale) && isFinite(junk.panX) && isFinite(junk.panY);
  // Determinism.
  const determ = JSON.stringify(S.frameZone({ cx: cx, cy: cy, cellPx: cellPx, vw: vw, vh: vh })) === JSON.stringify(target);
  check(
    "frameZone() centres the zone via WT.view.worldToScreen, clamps scale, moves the camera, finite + deterministic",
    centred && scaleOk && moved && finite && determ,
    "screen=(" + scr.x.toFixed(1) + "," + scr.y.toFixed(1) + ") scale=" + target.scale.toFixed(3) +
      " moved=" + moved + " finite=" + finite
  );
})();

// ---- 9. lerpCamera() endpoints + eased midpoint --------------------
(function () {
  const from = { scale: 0.5, panX: 100, panY: 50 };
  const to = { scale: 2.0, panX: -40, panY: 300 };
  const a = S.lerpCamera(from, to, 0);
  const b = S.lerpCamera(from, to, 1);
  const mid = S.lerpCamera(from, to, 0.5); // ease(0.5)=0.5 -> exact midpoint
  const endpoints = near(a.scale, from.scale) && near(a.panX, from.panX) && near(a.panY, from.panY) &&
    near(b.scale, to.scale) && near(b.panX, to.panX) && near(b.panY, to.panY);
  const midpoint = near(mid.scale, (from.scale + to.scale) / 2) &&
    near(mid.panX, (from.panX + to.panX) / 2) && near(mid.panY, (from.panY + to.panY) / 2);
  const determ = JSON.stringify(S.lerpCamera(from, to, 0.37)) === JSON.stringify(S.lerpCamera(from, to, 0.37));
  const junk = S.lerpCamera(null, undefined, 0.5);
  const safe = isFinite(junk.scale) && isFinite(junk.panX) && isFinite(junk.panY);
  check(
    "lerpCamera() exact endpoints + eased midpoint, deterministic + garbage-safe",
    endpoints && midpoint && determ && safe,
    "endpoints=" + endpoints + " midpoint=" + midpoint + " safe=" + safe
  );
})();

// ---- 10. run() drives in order + interruptible ----------------------
(async function runTests() {
  const called = [];
  const actions = {};
  for (const name of S.ACTIONS) actions[name] = () => called.push(name);
  const res = await S.run({ actions: actions, pause: () => Promise.resolve(), stopped: () => false });
  const expected = S.script().map((s) => s.action);
  check(
    "run() drives every action in the declared order",
    !res.stopped && JSON.stringify(res.ran) === JSON.stringify(expected) &&
      JSON.stringify(called) === JSON.stringify(expected),
    called.join(" -> ")
  );

  const called2 = [];
  const actions2 = {};
  for (const name of S.ACTIONS) actions2[name] = () => called2.push(name);
  let stopIndex = -1;
  const res2 = await S.run({
    actions: actions2, pause: () => Promise.resolve(),
    stopped: () => called2.length >= 2,
    onStop: (i) => { stopIndex = i; },
  });
  check(
    "run() is interruptible (stops after the requested step, fires onStop)",
    res2.stopped === true && called2.length === 2 && stopIndex === 2,
    "ran " + called2.length + " actions, onStop at index " + stopIndex
  );

  // ---- 11. cross-consistency with the flow waypoints ----------------
  (function () {
    const ex = scenSteps[0] && scenSteps[0].exampleId;
    let ok = false, detail = "no scenario";
    try {
      const layout = EX.build(ex);
      const wps = F.buildWaypoints({ elements: layout.elements, gridW: layout.gridW, gridH: layout.gridH });
      const haveAll = S.STAGES.every((st) => wps.some((w) => w.stage === st));
      const recv = wps.find((w) => w.stage === "receiving");
      const ship = wps.find((w) => w.stage === "shipping");
      const cellPx = 20, vw = 800, vh = 480;
      const tRecv = S.frameZone({ cx: recv.x, cy: recv.y, cellPx: cellPx, vw: vw, vh: vh });
      const tShip = S.frameZone({ cx: ship.x, cy: ship.y, cellPx: cellPx, vw: vw, vh: vh });
      const distinct = !near(tRecv.panX, tShip.panX, 1e-6) || !near(tRecv.panY, tShip.panY, 1e-6);
      ok = haveAll && distinct;
      detail = ex + ": all-zones=" + haveAll + " recv!=ship=" + distinct;
    } catch (e) { detail = e && e.message ? e.message : String(e); }
    check("frameZone frames the SAME flow-sim zone centroids the boxes move across (all 5 zones, distinct)", ok, detail);
  })();

  // ---- 12. honesty: captions synthetic/teaching, no brand, no hype --
  const blob = steps.map((s) => s.title + " " + s.caption).join(" ").toLowerCase();
  check(
    "captions state the synthetic / teaching-animation / not-a-real-DES facts",
    blob.indexOf("synthetic") !== -1 && blob.indexOf("no real company") !== -1 &&
      blob.indexOf("not a real des engine") !== -1,
    "ok"
  );
  const banned = ["certified", "guaranteed", "best-in-class", "world-class", "revolutionary"];
  const hypeHits = banned.filter((w) => blob.indexOf(w) !== -1);
  check("captions are hype-free (no banned superlatives)", hypeHits.length === 0,
    hypeHits.length ? "found: " + hypeHits.join(", ") : "clean");
  const brands = ["amazon", "wurth", "sap", "siemens", "dematic", "swisslog", "kardex", "jungheinrich"];
  const brandHits = brands.filter((w) => blob.indexOf(w) !== -1);
  check("captions name no obvious real brand", brandHits.length === 0,
    brandHits.length ? "found: " + brandHits.join(", ") : "clean");

  // ---- 13. determinism guard: story.js has NO Date / NO Math.random -
  const storySrc = fs.readFileSync(path.join(__dirname, "story.js"), "utf8");
  const noClock = !/\bDate\.now\b/.test(storySrc) && !/\bnew\s+Date\b/.test(storySrc) &&
    !/\bMath\.random\b/.test(storySrc);
  check(
    "story.js is clock-free + RNG-free and carries the 'NO Date, NO RNG' note",
    noClock && /NO Date, NO RNG/.test(storySrc),
    noClock ? "clean" : "found a Date/RNG reference"
  );

  // ---- 14. shipped-source wiring ------------------------------------
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const storyBeforeApp = html.indexOf('src="story.js"') !== -1 &&
    html.indexOf('src="story.js"') < html.indexOf('src="app.js"');
  const btnPresent = /id="storyBtn"/.test(html);
  const swCaches = /["']\.\/story\.js["']/.test(sw) && /wt-v70/.test(sw);
  const appWires = /storyBtn/.test(appSrc) && /WT\.story\.run\(/.test(appSrc) &&
    /startStory/.test(appSrc) && /finishStory/.test(appSrc);
  check(
    "index.html loads story.js before app.js + ships the storyBtn control",
    storyBeforeApp && btnPresent, "beforeApp=" + storyBeforeApp + " btn=" + btnPresent
  );
  check(
    "sw.js precaches ./story.js at the bumped wt-v70 cache; app.js wires + sequences it",
    swCaches && appWires, "sw=" + swCaches + " app=" + appWires
  );

  console.log("");
  console.log("-".repeat(60));
  console.log(
    failures === 0
      ? "ALL " + checks + " CHECKS PASSED"
      : failures + " OF " + checks + " CHECKS FAILED"
  );
  process.exit(failures === 0 ? 0 : 1);
})();
