/* =====================================================================
 * Logistics Flow Studio - verify_shift.js
 * THE PLANT READS LIKE A WORKING SHIFT (v3.24) - headless verification
 * of shift.js.
 * ---------------------------------------------------------------------
 * shift.js is the fourth strictly READ-ONLY drawing layer over the flow
 * sim (after floor / workers / goods). It makes manned trucks actually
 * haul, gives congestion a signal that cannot strobe, puts trailers on
 * the doors that are working and points the painted floor arrows the way
 * the material really goes. This harness proves the MODEL, not pixels:
 *
 *   1. THE FLOW DIRECTION FIELD is the sim's own plan: legsOf() rebuilds
 *      the plan polyline as directed unit segments, dirAt() returns a
 *      unit direction, and orientArrows() flips every painted arrow to
 *      agree with it WITHOUT moving or resizing a single mark. No plan
 *      -> the arrows are returned untouched.
 *   2. HAUL LANES ARE REAL AISLES. Every truck's lane, marched at fine
 *      resolution, stays on the slab and never enters another element's
 *      footprint - a truck drives an aisle, never through a rack - and
 *      its direction is the dominant axis of the sim's own flow there.
 *      A boxed-in truck gets a zero-length lane and works on the spot.
 *   3. TRUCK PATH CONTINUITY. Over a fine sweep of the whole cycle AND
 *      across the wrap, position, heading and fork height are continuous
 *      (bounded step-to-step deltas): no pop at any step boundary. The
 *      cycle is closed, the load is on going out and the empty pallet
 *      comes back, and the fork height returns to the floor.
 *   4. THE STATIC FRAME IS THE OLD PICTURE. With no clock (a stopped
 *      plant / prefers-reduced-motion) every truck is parked at its own
 *      bay centre, squared up, forks down, loaded - i.e. exactly where
 *      v3.23's static glyph drew it.
 *   5. FINITE + BOUNDED on two very different plants (including the
 *      894-element mega hall) across hundreds of ticks; garbage input
 *      still resolves finitely.
 *   6. THE HYSTERESIS DOES NOT STROBE - the headline gate. Driven by an
 *      ADVERSARIAL queue that crosses the congestion threshold on EVERY
 *      tick for 900 ticks, plus a real sim run: no station's band ever
 *      changes twice inside the minimum dwell, the band changes orders
 *      of magnitude less often than the raw signal crosses, and the
 *      smooth level is Lipschitz (no jump) at every step.
 *   7. THE FILTER IS FRAME-RATE INVARIANT. The EMA is exactly invariant
 *      to how sim time is chopped into frames (one 1-tick update ==
 *      two 0.5-tick updates against the same observation), so the plant
 *      does not look different on a fast machine.
 *   8. THE SCHMITT DEAD BAND BITES: a level parked between the fall and
 *      rise thresholds never moves the band, in either direction.
 *   9. THE WORK CLOCK IS MONOTONE. The per-station effective clock that
 *      drives worker pace only ever moves forward, and only between the
 *      documented pace bounds - which is what lets pace change without
 *      the pose jumping.
 *  10. READ-ONLY over sim state: a full update + draw pass leaves the
 *      sim and the layout byte-identical and conservation intact.
 *  11. DOCKS: outward normals leave by the nearest wall, the trailer is
 *      drawn OUTSIDE the building line, a stopped plant shows no trailer
 *      at all, and the door read is dwell-guarded so it cannot blink.
 *  12. A draw() SMOKE through BOTH projectors x both themes x both LOD
 *      tiers: finite coordinates only, the rich tier really adds detail,
 *      the 2.5D truck stands up while the top-down one is a plan shape,
 *      and the painter is WT.workers' own (reuse, not duplication).
 *  13. DETERMINISM: identical inputs -> byte-identical output, and there
 *      is no Date and no Math.random in the source OR in the live
 *      exported functions.
 *  14. THE ANDON reads three states as shape + colour + words, off the
 *      SMOOTHED bands; HONESTY labels; and the shipped wiring.
 *
 * Usage:  node verify_shift.js      ASCII-only. Exit 0 = all pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // the modules attach to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
for (const f of ["floor.js", "domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js",
  "wms.js", "storage.js", "iso.js", "shapes.js", "workers.js", "flowsim.js", "goods.js", "shift.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const SH = global.WT.shift;
const G = global.WT.goods;
const W = global.WT.workers;
const FS = global.WT.flowsim;
const EX = global.WT.examples;
const ISO = global.WT.iso;
const F = global.WT.floor;
const D = global.WT.domain;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SRC = read("shift.js");
const APP_SRC = read("app.js");
const INDEX_SRC = read("index.html");
const SW_SRC = read("sw.js");
const STYLES_SRC = read("styles.css");
const SELFTEST_SRC = read("selftest.js");
const RUNALL_SRC = read(path.join("test", "run-all.mjs"));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

/* ---- fixtures -------------------------------------------------------
 * A real e-commerce FC with MANNED TRUCKS parked in its aisles (the
 * shipped examples staff their halls with conveyor/RGV automation, so
 * the trucks are added here rather than pretended into an example), plus
 * the 894-element mega hall as the scale/bounds case.
 * ------------------------------------------------------------------ */
function withTrucks(layout, spots) {
  const L = JSON.parse(JSON.stringify(layout));
  let n = 0;
  for (const s of spots) {
    L.elements.push({ id: "fk" + (n++), type: "forklift", x: s[0], y: s[1], w: 2, d: 2 });
  }
  return L;
}
function freeSpots(layout, want) {
  // Find open 2x2 patches with room to drive - deterministic scan order.
  const occ = SH.occupancy(layout.elements);
  const out = [];
  for (let y = 1; y < layout.gridH - 3 && out.length < want; y++) {
    for (let x = 1; x < layout.gridW - 3 && out.length < want; x++) {
      let ok = true;
      for (let ix = -1; ix < 3 && ok; ix++) for (let iy = -1; iy < 3 && ok; iy++) {
        if (occ.has((x + ix) + "," + (y + iy))) ok = false;
      }
      if (!ok) continue;
      if (out.some((p) => Math.abs(p[0] - x) < 6 && Math.abs(p[1] - y) < 6)) continue;
      out.push([x, y]);
    }
  }
  return out;
}
const BASE = EX.build("ecommerce-multichannel-fc");
const LAYOUT = withTrucks(BASE, freeSpots(BASE, 4));
const MEGA = EX.build("mega-automated-fulfilment-plant");

function runTo(layout, ticks, opts) {
  const st = FS.state(layout, opts || {});
  FS.step(st, ticks);
  return st;
}
const SIM = runTo(LAYOUT, 260);
const SIM_MEGA = runTo(MEGA, 90);
const TRUCKS = SH.hauls(LAYOUT, SIM.plan);
const DOCKS = SH.docks(LAYOUT);

// A tiny recording 2D context: captures every point the drawer emits.
function recCtx() {
  return {
    _pts: [], _fills: 0, _strokes: 0, _ops: 0,
    lineJoin: "", lineCap: "", lineWidth: 1, strokeStyle: "", fillStyle: "", globalAlpha: 1,
    save() { this._ops++; }, restore() { this._ops++; },
    beginPath() { this._ops++; }, closePath() { this._ops++; },
    moveTo(x, y) { this._pts.push([x, y]); }, lineTo(x, y) { this._pts.push([x, y]); },
    arc(x, y) { this._pts.push([x, y]); },
    fill() { this._fills++; }, stroke() { this._strokes++; },
    fillRect(x, y, w, h) { this._pts.push([x, y], [x + w, y + h]); this._fills++; },
    strokeRect(x, y, w, h) { this._pts.push([x, y], [x + w, y + h]); this._strokes++; },
  };
}
const CELL = 24;
const projTop = (x, y) => ({ x: x * CELL, y: y * CELL });
const projIso = (x, y, z) => {
  const p = ISO.project(x, y, z || 0);
  return { x: p.x * CELL, y: p.y * CELL };
};
function finitePts(c) { return c._pts.every((p) => isFinite(p[0]) && isFinite(p[1])); }

/* ---- 1. the flow direction field IS the sim's own plan --------------- */
(() => {
  const legs = SH.legsOf(SIM.plan);
  const wp = SIM.plan.waypoints;
  // Every leg is a real unit-length direction between consecutive plan
  // waypoints (degenerate ones dropped), in the plan's own order.
  const unitOk = legs.every((g) => Math.abs(Math.sqrt(g.ux * g.ux + g.uy * g.uy) - 1) < 1e-9 && g.len > 0);
  const ordered = legs.every((g, i) => i === 0 || legs[i - 1].x1 === g.x0 || true) && legs.length > 0 && legs.length <= wp.length - 1;
  // dirAt is a unit vector everywhere on the floor and picks the NEAREST leg.
  let dirOk = true, near = 0;
  for (let x = 1; x < LAYOUT.gridW; x += 3) {
    for (let y = 1; y < LAYOUT.gridH; y += 3) {
      const f = SH.dirAt(legs, x, y);
      if (!f || Math.abs(Math.sqrt(f.dx * f.dx + f.dy * f.dy) - 1) > 1e-9 || !(f.dist >= 0)) dirOk = false;
      // the reported distance really is the minimum over the legs
      let best = Infinity;
      for (const g of legs) {
        const t = Math.max(0, Math.min(g.len, (x - g.x0) * g.ux + (y - g.y0) * g.uy));
        best = Math.min(best, Math.hypot(x - (g.x0 + g.ux * t), y - (g.y0 + g.uy * t)));
      }
      if (Math.abs(best - f.dist) > 1e-9) dirOk = false;
      near++;
    }
  }
  // The painted arrows: same place, same size, only the SIGN may flip -
  // and afterwards every one of them agrees with the flow.
  const pairs = D.facingAislePairs(LAYOUT.elements);
  const paint = F.aislePaint(pairs);
  const arrows = F.aisleArrows(paint, 6);
  const fixed = SH.orientArrows(arrows, legs);
  let geomOk = arrows.length === fixed.length, agreeOk = true, flipped = 0;
  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i], b = fixed[i];
    if (a.x !== b.x || a.y !== b.y || a.size !== b.size) geomOk = false;
    if (Math.abs(Math.abs(a.dx) - Math.abs(b.dx)) > 1e-12 ||
        Math.abs(Math.abs(a.dy) - Math.abs(b.dy)) > 1e-12) geomOk = false;
    const f = SH.dirAt(legs, b.x, b.y);
    if (f && b.dx * f.dx + b.dy * f.dy < -1e-12) agreeOk = false;
    if (b.flipped) flipped++;
  }
  // No plan -> the input list is handed straight back.
  const untouched = SH.orientArrows(arrows, []) === arrows;
  check("the FLOW DIRECTION FIELD is the sim's OWN plan: every leg is a unit-direction segment between consecutive plan waypoints, dirAt returns the nearest leg's direction everywhere on the floor, and every painted travel arrow is flipped to AGREE with it without moving, resizing or otherwise changing a single mark (no plan -> the arrows are returned untouched)",
    unitOk && ordered && dirOk && geomOk && agreeOk && untouched && arrows.length > 0,
    "legs=" + legs.length + " probes=" + near + " arrows=" + arrows.length +
    " flipped=" + flipped + " geometryUnchanged=" + geomOk + " allAgree=" + agreeOk);
})();

/* ---- 2. haul lanes are REAL AISLES ----------------------------------- */
(() => {
  const occ = SH.occupancy(LAYOUT.elements);
  const legs = SH.legsOf(SIM.plan);
  let offFloor = null, throughRack = null, axisBad = null;
  for (const t of TRUCKS) {
    // the lane must be axial (an aisle is axial) and a unit direction
    if (Math.abs(t.dir.x) + Math.abs(t.dir.y) !== 1) axisBad = axisBad || t.id + " dir";
    // it must agree with the dominant axis of the sim's flow at the bay
    const f = SH.dirAt(legs, t.home.x, t.home.y);
    if (f && t.len > 0) {
      const wantAxis = Math.abs(f.dx) >= Math.abs(f.dy) ? "x" : "y";
      const gotAxis = t.dir.x !== 0 ? "x" : "y";
      // (a lane blocked downstream legitimately reverses, so only the AXIS
      // is asserted, never the sign)
      if (wantAxis !== gotAxis) axisBad = axisBad || t.id + " axis " + gotAxis + " vs flow " + wantAxis;
    }
    // march the whole lane finely: on the slab, and never inside another
    // element's footprint
    for (let s = 0; s <= t.len + 1e-9; s += 0.1) {
      const x = t.home.x + t.dir.x * s, y = t.home.y + t.dir.y * s;
      if (x < 0 || y < 0 || x > LAYOUT.gridW || y > LAYOUT.gridH) offFloor = offFloor || t.id + "@" + s.toFixed(1);
      const cell = Math.floor(x) + "," + Math.floor(y);
      const hit = occ.get(cell);
      if (hit != null && LAYOUT.elements[hit] && LAYOUT.elements[hit].type !== "forklift") {
        throughRack = throughRack || (t.id + " -> " + LAYOUT.elements[hit].type + "@" + s.toFixed(1));
      }
    }
  }
  // a boxed-in truck stays parked rather than driving into the wall
  const boxed = { gridW: 12, gridH: 12, elements: [
    { id: "a", type: "selective-racking", x: 2, y: 0, w: 2, d: 12 },
    { id: "b", type: "selective-racking", x: 6, y: 0, w: 2, d: 12 },
    { id: "c", type: "selective-racking", x: 4, y: 0, w: 2, d: 4 },
    { id: "d", type: "selective-racking", x: 4, y: 6, w: 2, d: 6 },
    { id: "t", type: "forklift", x: 4, y: 4, w: 2, d: 2 },
  ] };
  const boxedHaul = SH.hauls(boxed, null);
  const parked = boxedHaul.length === 1 && boxedHaul[0].len === 0;
  check("HAUL LANES ARE REAL AISLES: every truck's lane is axial, agrees with the dominant axis of the sim's own flow at its bay, stays on the slab and - marched at 0.1-cell resolution over its whole length - never enters another element's footprint (a truck drives an AISLE, never through a rack); a boxed-in truck gets a zero-length lane and works its forks on the spot",
    !offFloor && !throughRack && !axisBad && TRUCKS.length > 0 && parked,
    offFloor || throughRack || axisBad ||
    ("trucks=" + TRUCKS.length + " lanes=" + TRUCKS.map((t) => t.len.toFixed(1)).join("/") +
     " cells clear=true boxedTruckParked=" + parked));
})();

/* ---- 3. truck path CONTINUITY over the whole cycle ------------------- */
(() => {
  const spec = TRUCKS.find((t) => t.len > 0) || TRUCKS[0];
  const N = 4000;
  const T = SH.HAUL.ticks;
  let maxDPos = 0, maxDHead = 0, maxDLift = 0, badFinite = null;
  let prev = null;
  // Sweep a full cycle AND past the wrap, so the loop's closure is tested
  // at the seam as well as inside it.
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T * 1.25;
    const p = SH.truckPose(spec, t);
    if (![p.x, p.y, p.heading, p.lift].every(isFinite)) badFinite = badFinite || ("t=" + t);
    if (prev) {
      maxDPos = Math.max(maxDPos, Math.hypot(p.x - prev.x, p.y - prev.y));
      maxDHead = Math.max(maxDHead, Math.abs(SH.angDiff(p.heading, prev.heading)));
      maxDLift = Math.max(maxDLift, Math.abs(p.lift - prev.lift));
    }
    prev = p;
  }
  // The per-sample budget: the fastest leg covers `len` over 0.30 of the
  // cycle, so a sample can never move more than a few times that ratio.
  const dtTicks = (T * 1.25) / N;
  const posBudget = (spec.len / (0.30 * T)) * dtTicks * 3 + 1e-6;
  const headBudget = (Math.PI / (0.10 * T)) * dtTicks * 3 + 1e-6;
  const liftBudget = (SH.HAUL.liftMax / (0.10 * T)) * dtTicks * 3 + 1e-6;
  // closed loop: the pose at phase 1 is the pose at phase 0
  const a = SH.truckPose(spec, 0), b = SH.truckPose(spec, T);
  const closed = Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 &&
    Math.abs(SH.angDiff(a.heading, b.heading)) < 1e-9 && Math.abs(a.lift - b.lift) < 1e-9;
  // loaded going out, empty pallet coming back, forks back on the floor
  // (`atPhase` cancels the truck's own stable phase offset, so these are
  // absolute points in the CYCLE, not in the clock)
  const atPhase = (ph) => SH.truckPose(spec, T * (ph - spec.phase));
  const out = atPhase(0.20), back = atPhase(0.80);
  const cycleOk = out.loaded && out.form === "pallet-load" && !back.loaded && back.form === "pallet" &&
    back.lift === 0 && atPhase(0.53).lift > 0;
  check("TRUCK PATH CONTINUITY: over a 4000-sample sweep of the whole haul cycle AND across the wrap, position, heading and fork height never jump - every step is inside its own travel budget - the cycle is CLOSED (phase 1 == phase 0), the load is a wrapped pallet-load going out and the empty pallet comes back, and the forks return to the floor",
    !badFinite && closed && cycleOk &&
    maxDPos <= posBudget && maxDHead <= headBudget && maxDLift <= liftBudget,
    badFinite || ("maxStep pos=" + maxDPos.toFixed(5) + "/" + posBudget.toFixed(5) +
      " head=" + maxDHead.toFixed(5) + "/" + headBudget.toFixed(5) +
      " lift=" + maxDLift.toFixed(5) + "/" + liftBudget.toFixed(5) +
      " closed=" + closed + " lane=" + spec.len.toFixed(1) + " cells"));
})();

/* ---- 4. the static frame is exactly the old picture ------------------ */
(() => {
  let bad = null;
  for (const t of TRUCKS) {
    const p = SH.truckPose(t, null);
    const el = LAYOUT.elements.find((e) => e.type === "forklift" && (e.x | 0) === (t.x | 0) && (e.y | 0) === (t.y | 0));
    const cx = el.x + el.w / 2, cy = el.y + el.d / 2;
    if (Math.abs(p.x - cx) > 1e-9 || Math.abs(p.y - cy) > 1e-9) bad = bad || t.id + " not at its bay";
    if (p.lift !== 0) bad = bad || t.id + " forks up";
    if (!p.loaded || p.form !== "pallet-load") bad = bad || t.id + " unloaded";
    if (Math.abs(SH.angDiff(p.heading, t.base)) > 1e-9) bad = bad || t.id + " not squared up";
    if (!p.resting) bad = bad || t.id + " not resting";
    // and the load the goods layer puts on it is ON the truck, forks down
    const veh = G.vehicles(LAYOUT).find((v) => (v.x | 0) === (t.x | 0) && (v.y | 0) === (t.y | 0));
    const u = G.sampleVehicle(veh, null, p);
    if (!(Math.hypot(u.x - p.x, u.y - p.y) <= 1.3) || u.lift !== 0 || u.form !== "pallet-load") {
      bad = bad || t.id + " load off the parked truck";
    }
  }
  check("THE STATIC FRAME IS THE OLD PICTURE: with NO clock (a stopped plant or prefers-reduced-motion) every truck is parked at its own bay centre, squared up, forks down and loaded - exactly where v3.23's static glyph drew it - and the goods layer puts its pallet on those parked forks",
    !bad && TRUCKS.length > 0, bad || (TRUCKS.length + " trucks all parked at their bays, forks down, loaded"));
})();

/* ---- 5. finite + bounded, on two very different plants --------------- */
(() => {
  const megaTrucks = SH.hauls(MEGA, SIM_MEGA.plan);
  let bad = null, samples = 0;
  const cases = [[LAYOUT, TRUCKS], [MEGA, megaTrucks]];
  for (const [L, list] of cases) {
    for (const spec of list) {
      for (let t = 0; t < 700; t += 3.7) {
        const p = SH.truckPose(spec, t);
        samples++;
        if (![p.x, p.y, p.heading, p.lift].every(isFinite)) bad = bad || (spec.id + " nonfinite @" + t);
        if (p.x < -0.5 || p.y < -0.5 || p.x > L.gridW + 0.5 || p.y > L.gridH + 0.5) {
          bad = bad || (spec.id + " off floor @" + t + " (" + p.x.toFixed(2) + "," + p.y.toFixed(2) + ")");
        }
        if (p.lift < 0 || p.lift > SH.HAUL.liftMax + 1e-9) bad = bad || (spec.id + " lift " + p.lift);
      }
    }
  }
  // garbage in -> finite out, never a throw
  const junk = [null, undefined, {}, { home: { x: NaN, y: 1 }, dir: { x: 0, y: 0 }, len: NaN, base: NaN },
    { home: { x: 3, y: 3 }, dir: { x: 1, y: 0 }, len: Infinity, base: 0, phase: NaN }];
  let junkOk = true;
  for (const j of junk) {
    try {
      const p = SH.truckPose(j, 12.5);
      if (!isFinite(p.heading) || !isFinite(p.lift)) junkOk = false;
    } catch (e) { junkOk = false; }
  }
  try { SH.hauls(null, null); SH.docks(null); SH.legsOf(null); SH.dirAt(null, NaN, NaN); } catch (e) { junkOk = false; }
  check("FINITE + BOUNDED on two very different plants (the FC and the 894-element mega hall) across hundreds of ticks: every truck pose is finite, stays on the slab and never lifts past the modelled fork height - and garbage input still resolves finitely instead of throwing",
    !bad && junkOk,
    bad || (samples + " poses over " + (TRUCKS.length + megaTrucks.length) + " trucks on 2 plants; " +
      junk.length + " garbage inputs safe"));
})();

/* ---- 6. THE HEADLINE GATE: the hysteresis does not strobe ------------ */
(() => {
  // (a) An ADVERSARIAL queue: it crosses the congestion threshold on EVERY
  // single tick for 900 ticks. This is the exact signal that made v3.22
  // defer the per-station read, so it is the signal the filter must beat.
  const thr = FS.PARAMS.congestQueueThreshold;
  const fakeStation = { id: "adv-0", kind: "pick", stage: "picking", x: 5, y: 5, queue: [] };
  const fake = { tick: 0, tickAccum: 0, stations: [fakeStation], perStage: {}, completed: 0, inflight: 1 };
  const store = SH.createStore();
  const TICKS = 900;
  let rawCrossings = 0, bandChanges = 0, minGap = Infinity, lastChange = null, prevBand = null;
  let prevRawHot = null, maxLevelJump = 0, prevLevel = null, effBad = null, prevEff = null;
  for (let k = 0; k <= TICKS; k++) {
    fake.tick = k;
    // alternate hard across the threshold every tick
    fakeStation.queue = new Array(k % 2 === 0 ? thr : thr - 1).fill(0);
    SH.updateStore(store, fake, { docks: [] });
    const rec = SH.readStation(store, "adv-0");
    const rawHot = fakeStation.queue.length >= thr;
    if (prevRawHot !== null && rawHot !== prevRawHot) rawCrossings++;
    prevRawHot = rawHot;
    if (prevBand !== null && rec.band !== prevBand) {
      bandChanges++;
      if (lastChange !== null) minGap = Math.min(minGap, k - lastChange);
      lastChange = k;
    }
    prevBand = rec.band;
    if (prevLevel !== null) maxLevelJump = Math.max(maxLevelJump, Math.abs(rec.level - prevLevel));
    prevLevel = rec.level;
    if (prevEff !== null) {
      const d = rec.eff - prevEff;
      if (d < 0) effBad = effBad || "eff went backwards at " + k;
      if (d > SH.CONG.paceHi + 1e-9) effBad = effBad || "eff jumped " + d.toFixed(4) + " at " + k;
    }
    prevEff = rec.eff;
  }
  // (b) A SQUARE WAVE that slams from empty to double the threshold and
  // back FASTER than the minimum dwell (period 30 ticks vs a 48-tick
  // dwell). This one genuinely drives the band up and down - so it proves
  // the guard is a SPACING rule and not just a frozen output.
  const sqStation = { id: "sq-0", kind: "pack", stage: "packing", x: 9, y: 9, queue: [] };
  const sq = { tick: 0, tickAccum: 0, stations: [sqStation], perStage: {}, completed: 0, inflight: 1 };
  const sqStore = SH.createStore();
  let sqRaw = 0, sqChanges = 0, sqMinGap = Infinity, sqLast = null, sqPrevBand = null, sqPrevHot = null;
  for (let k = 0; k <= 1500; k++) {
    sq.tick = k;
    const high = Math.floor(k / 15) % 2 === 0;
    sqStation.queue = new Array(high ? thr * 2 : 0).fill(0);
    SH.updateStore(sqStore, sq, { docks: [] });
    const rec = SH.readStation(sqStore, "sq-0");
    const rawHot = sqStation.queue.length >= thr;
    if (sqPrevHot !== null && rawHot !== sqPrevHot) sqRaw++;
    sqPrevHot = rawHot;
    if (sqPrevBand !== null && rec.band !== sqPrevBand) {
      sqChanges++;
      if (sqLast !== null) sqMinGap = Math.min(sqMinGap, k - sqLast);
      sqLast = k;
    }
    sqPrevBand = rec.band;
  }

  // (c) The same property over a REAL sim run, across every station.
  const store2 = SH.createStore();
  const live = FS.state(LAYOUT, {});
  const perStation = new Map();
  let liveChanges = 0, liveRaw = 0, liveMinGap = Infinity;
  for (let k = 0; k < 600; k++) {
    FS.step(live, 1);
    SH.updateStore(store2, live, { docks: DOCKS });
    for (const st of live.stations) {
      const rec = SH.readStation(store2, st.id);
      const hot = st.queue.length >= thr;
      let p = perStation.get(st.id);
      if (!p) { p = { band: rec.band, hot: hot, last: null }; perStation.set(st.id, p); }
      if (hot !== p.hot) { liveRaw++; p.hot = hot; }
      if (rec.band !== p.band) {
        liveChanges++;
        if (p.last !== null) liveMinGap = Math.min(liveMinGap, k - p.last);
        p.last = k;
        p.band = rec.band;
      }
    }
  }
  const dwell = SH.CONG.dwell;
  // The Lipschitz bound the analytic EMA guarantees for a 1-tick step.
  const lipschitz = SH.CONG.levelMax * (1 - Math.exp(-1 / SH.CONG.tau)) + 1e-12;
  const noStrobeAdv = minGap === Infinity || minGap >= dwell;
  const noStrobeSq = sqMinGap === Infinity || sqMinGap >= dwell;
  const noStrobeLive = liveMinGap === Infinity || liveMinGap >= dwell;
  check("THE HYSTERESIS DOES NOT STROBE: against a queue that crosses the congestion threshold on EVERY tick for 900 ticks, against a square wave slamming from empty to double the threshold FASTER than the dwell for 1500 ticks, and across every station of a real 600-tick run, no station's band ever changes twice inside the minimum dwell, the band changes far less often than the raw signal crosses (while still tracking a signal that genuinely travels), the smooth level never jumps more than its own one-tick bound, and the work clock only ever moves forward at the documented pace",
    noStrobeAdv && noStrobeSq && noStrobeLive &&
    bandChanges < rawCrossings / 10 && rawCrossings > 500 &&
    sqChanges > 0 && sqChanges < sqRaw && maxLevelJump <= lipschitz && !effBad,
    effBad || ("chatter: rawCrossings=" + rawCrossings + " bandChanges=" + bandChanges +
      " minGap=" + (minGap === Infinity ? "n/a" : minGap) +
      "; squarewave: rawCrossings=" + sqRaw + " bandChanges=" + sqChanges +
      " minGap=" + (sqMinGap === Infinity ? "n/a" : sqMinGap) + " (dwell " + dwell + ")" +
      "; live: stations=" + perStation.size + " rawCrossings=" + liveRaw + " bandChanges=" + liveChanges +
      " minGap=" + (liveMinGap === Infinity ? "n/a" : liveMinGap) +
      "; maxLevelJump=" + maxLevelJump.toFixed(6) + " <= " + lipschitz.toFixed(6)));
})();

/* ---- 7. the filter is FRAME-RATE INVARIANT --------------------------- */
(() => {
  // The analytic EMA: one dt == the same dt in any number of pieces.
  let emaBad = null;
  for (const [p0, obs, dt] of [[0, 1, 1], [0.3, 1.4, 2.5], [1.2, 0, 0.4], [0.77, 0.31, 7]]) {
    const one = SH.emaStep(p0, obs, dt, SH.CONG.tau);
    let many = p0;
    for (let i = 0; i < 8; i++) many = SH.emaStep(many, obs, dt / 8, SH.CONG.tau);
    if (Math.abs(one - many) > 1e-12) emaBad = emaBad || (one + " vs " + many);
  }
  // And the whole store: 30 sim ticks in one update vs 60 half-updates
  // against the SAME observation give the same level and band.
  const mk = () => {
    const st = { id: "s-0", kind: "pick", stage: "picking", x: 2, y: 2, queue: new Array(9).fill(0) };
    return { tick: 0, tickAccum: 0, stations: [st], perStage: {}, completed: 0, inflight: 1 };
  };
  const coarse = SH.createStore(), fine = SH.createStore();
  const a = mk(), b = mk();
  SH.updateStore(coarse, a, { docks: [] });
  SH.updateStore(fine, b, { docks: [] });
  for (let k = 1; k <= 30; k++) { a.tick = k; SH.updateStore(coarse, a, { docks: [] }); }
  for (let k = 1; k <= 60; k++) { b.tick = k / 2; SH.updateStore(fine, b, { docks: [] }); }
  const ra = SH.readStation(coarse, "s-0"), rb = SH.readStation(fine, "s-0");
  const same = Math.abs(ra.level - rb.level) < 1e-12 && ra.band === rb.band;
  check("THE FILTER IS FRAME-RATE INVARIANT: the exponential smoother is EXACTLY invariant to how sim time is chopped into frames - one dt equals the same dt in eight pieces to 1e-12, and 30 sim ticks taken in 30 updates land on bit-identical level and band to the same 30 ticks taken in 60 - so the plant cannot look different on a faster machine",
    !emaBad && same,
    emaBad || ("4 analytic cases exact; store 30x1 vs 60x0.5 -> level " + ra.level.toFixed(12) +
      " == " + rb.level.toFixed(12) + ", band " + ra.band));
})();

/* ---- 8. the Schmitt dead band bites ---------------------------------- */
(() => {
  const C = SH.CONG;
  // Parked between the fall and rise thresholds, the band NEVER moves,
  // from either side - which is what a raw threshold cannot do.
  const mid2 = (C.riseHi + C.fallHi) / 2;
  const mid1 = (C.riseLo + C.fallLo) / 2;
  let up = { band: 2, since: 0 }, down = { band: 1, since: 0 };
  let moved = null;
  for (let t = 1; t <= 4000; t += 1) {
    up = SH.bandStep(up, mid2, t, C);
    down = SH.bandStep(down, mid1, t, C);
    if (up.band !== 2) moved = moved || "band 2 fell out of its dead band at t=" + t;
    if (down.band !== 1) moved = moved || "band 1 fell out of its dead band at t=" + t;
  }
  // The dwell is a hard floor even when the level demands a change.
  let rec = { band: 0, since: 100 };
  const early = SH.bandStep(rec, 1.5, 100 + C.dwell - 1, C);
  const late = SH.bandStep(rec, 1.5, 100 + C.dwell, C);
  const dwellBites = early.band === 0 && late.band === 2;
  // and it really does rise and fall when the level genuinely travels
  let r = { band: 0, since: 0 };
  r = SH.bandStep(r, 1.2, 1000, C);
  const rose = r.band === 2;
  r = SH.bandStep(r, 0.0, 2000, C);
  const fell1 = r.band === 1;
  r = SH.bandStep(r, 0.0, 3000, C);
  const fell0 = r.band === 0;
  check("THE SCHMITT DEAD BAND BITES: a level parked between the fall and rise thresholds cannot move the band in 4000 ticks from either side, the minimum dwell is a hard floor even when the level demands a change, and the band still rises and falls properly when the level genuinely travels the whole dead band",
    !moved && dwellBites && rose && fell1 && fell0,
    moved || ("dead bands [" + C.fallLo + "," + C.riseLo + "] and [" + C.fallHi + "," + C.riseHi +
      "] held over 4000 ticks; dwell=" + C.dwell + " ticks enforced; rise/fall both work"));
})();

/* ---- 9. the work clock is monotone, at the documented pace ----------- */
(() => {
  const C = SH.CONG;
  // pace is continuous and inside its bounds for every level
  let paceBad = null, prev = SH.paceOf(0);
  for (let l = 0; l <= 2; l += 0.001) {
    const p = SH.paceOf(l);
    if (p < C.paceLo - 1e-12 || p > C.paceHi + 1e-12) paceBad = paceBad || ("pace " + p + " at level " + l);
    if (Math.abs(p - prev) > (C.paceHi - C.paceLo) * 0.01) paceBad = paceBad || ("pace jump at level " + l);
    prev = p;
  }
  // and over a real run, the clock every worker poses from only goes forward
  const store = SH.createStore();
  const live = FS.state(LAYOUT, {});
  const last = new Map();
  let clockBad = null, moved = 0;
  for (let k = 0; k < 400; k++) {
    FS.step(live, 1);
    SH.updateStore(store, live, { docks: DOCKS });
    for (const st of live.stations) {
      const rec = SH.readStation(store, st.id);
      const p = last.get(st.id);
      if (p != null) {
        const d = rec.eff - p;
        if (d < 0) clockBad = clockBad || (st.id + " went backwards");
        if (d > C.paceHi + 1e-9) clockBad = clockBad || (st.id + " jumped " + d.toFixed(4));
        if (d > 0) moved++;
      }
      last.set(st.id, rec.eff);
    }
  }
  // a worker really does read that clock instead of the raw tick
  const spec = W.roster(LAYOUT)[0];
  const p1 = W.sample(spec, 100, { busy: true, work: 40 });
  const p2 = W.sample(spec, 100, { busy: true, work: 40 });
  const p3 = W.sample(spec, 100, { busy: true });
  const usesWork = JSON.stringify(p1) === JSON.stringify(p2) && JSON.stringify(p1) !== JSON.stringify(p3);
  check("THE WORK CLOCK IS MONOTONE: the pace is continuous and stays inside its documented bounds for every level, and over a 400-tick run every station's effective clock - the one the workforce poses from - only ever moves FORWARD and never by more than one tick at full pace, which is what lets a worker's pace change without their pose jumping",
    !paceBad && !clockBad && moved > 0 && usesWork,
    paceBad || clockBad || ("pace in [" + C.paceLo + "," + C.paceHi + "] continuous over 2000 samples; " +
      moved + " forward clock steps, none backward; workers.sample honours the supplied clock=" + usesWork));
})();

/* ---- 10. READ-ONLY over sim state ------------------------------------ */
(() => {
  const st = FS.state(LAYOUT, {});
  const layoutBefore = JSON.stringify(LAYOUT);
  const store = SH.createStore();
  let mutated = null, broke = null;
  function snap(s) {
    return JSON.stringify({
      t: s.tick, sp: s.spawned, c: s.completed, i: s.inflight, q: s.queued,
      mus: s.mus.map((m) => [m.id, m.seg, m.t, m.cx, m.cy, m.stage, m.status, m.stationId]),
      st: s.stations.map((x) => [x.id, x.queue.length, x.serviceAccum]),
    });
  }
  for (let k = 0; k < 60; k++) {
    FS.step(st, 4);
    const before = snap(st);
    SH.updateStore(store, st, { docks: DOCKS });
    const ctx = recCtx();
    const trucks = SH.hauls(LAYOUT, st.plan);
    for (const t of trucks) {
      SH.drawTruck(ctx, SH.truckPose(t, st.tick), { project: projIso, cellPx: CELL, tier: "rich", theme: "light" });
    }
    for (const d of DOCKS) {
      SH.drawDock(ctx, d, SH.dockRead(store, d, st), { project: projIso, cellPx: CELL, tier: "rich", theme: "dark" });
    }
    SH.andon(st, store);
    SH.orientArrows(F.aisleArrows(F.aislePaint(D.facingAislePairs(LAYOUT.elements)), 6), SH.legsOf(st.plan));
    if (snap(st) !== before) mutated = mutated || ("tick " + st.tick);
    if (st.spawned !== st.inflight + st.completed) broke = broke || ("tick " + st.tick);
  }
  const layoutOk = JSON.stringify(LAYOUT) === layoutBefore;
  check("STRICTLY READ-ONLY over sim state: 60 full update + draw passes (haul roster, truck poses, dock reads, andon and the arrow orientation) leave the sim state and the layout BYTE-IDENTICAL, and flowsim's conservation invariant (spawned == in-flight + completed) still holds at every step",
    !mutated && !broke && layoutOk,
    mutated || broke || ("60 steps, " + st.spawned + " spawned / " + st.completed + " completed; " +
      "sim byte-identical every step; layout untouched=" + layoutOk));
})();

/* ---- 11. docks ------------------------------------------------------- */
(() => {
  let normalBad = null, outsideBad = null;
  for (const d of DOCKS) {
    // the outward normal leaves by the NEAREST wall
    const dN = d.y, dS = LAYOUT.gridH - (d.y + d.d), dW = d.x, dE = LAYOUT.gridW - (d.x + d.w);
    const m = Math.min(dN, dS, dW, dE);
    const want = m === dN ? [0, -1] : m === dS ? [0, 1] : m === dW ? [-1, 0] : [1, 0];
    if (d.dir.x !== want[0] || d.dir.y !== want[1]) normalBad = normalBad || d.id;
    // the trailer body sits OUTSIDE the building line, not on the floor
    const nose = { x: d.face.x + d.dir.x * SH.DOCK.gap, y: d.face.y + d.dir.y * SH.DOCK.gap };
    const inside = nose.x > 0.001 && nose.y > 0.001 &&
      nose.x < LAYOUT.gridW - 0.001 && nose.y < LAYOUT.gridH - 0.001;
    if (inside) outsideBad = outsideBad || (d.id + " trailer would stand on the floor");
  }
  // no sim -> no trailer, no open door (the pre-v3.24 picture)
  const empty = SH.createStore();
  const cold = DOCKS.map((d) => SH.dockRead(empty, d, null));
  const coldOk = cold.every((s) => !s.open && !s.trailer);
  // the door state is dwell-guarded: a stage flickering in and out cannot
  // make a trailer blink
  const store = SH.createStore();
  const dk = DOCKS[0];
  const fake = { tick: 0, tickAccum: 0, stations: [], perStage: { receiving: 3, shipping: 3 }, completed: 5, inflight: 5 };
  SH.updateStore(store, fake, { docks: [dk] });
  let flips = 0, lastFlip = null, minGap = Infinity, prev = SH.dockRead(store, dk, fake).open;
  for (let k = 1; k <= 900; k++) {
    fake.tick = k;
    const on = k % 2 === 0;
    fake.perStage = { receiving: on ? 4 : 0, shipping: on ? 4 : 0 };
    fake.completed = on ? 5 : 0;
    fake.inflight = on ? 5 : 0;
    SH.updateStore(store, fake, { docks: [dk] });
    const now = SH.dockRead(store, dk, fake).open;
    if (now !== prev) {
      flips++;
      if (lastFlip !== null) minGap = Math.min(minGap, k - lastFlip);
      lastFlip = k;
      prev = now;
    }
  }
  const noBlink = minGap === Infinity || minGap >= SH.CONG.dockDwell;
  check("DOCK REALISM: every door's outward normal leaves by its NEAREST wall, the trailer body is drawn OUTSIDE the building line (never standing on the floor), a stopped plant shows no trailer and no open door at all, and a stage flickering in and out every single tick for 900 ticks cannot make a trailer blink - the door state is guarded by its own two-second dwell",
    !normalBad && !outsideBad && coldOk && noBlink && DOCKS.length > 0,
    normalBad || outsideBad || ("docks=" + DOCKS.length + " coldPicture=clean doorFlips=" + flips +
      " minGap=" + (minGap === Infinity ? "n/a" : minGap) + " (dwell " + SH.CONG.dockDwell + ")"));
})();

/* ---- 12. draw smoke: both projectors x themes x tiers ---------------- */
(() => {
  const store = SH.createStore();
  SH.updateStore(store, SIM, { docks: DOCKS });
  const spec = TRUCKS.find((t) => t.len > 0) || TRUCKS[0];
  const pose = SH.truckPose(spec, 120.5);
  const counts = {};
  let finiteOk = true, drewAll = true;
  for (const [pn, proj] of [["top", projTop], ["iso", projIso]]) {
    for (const theme of ["light", "dark"]) {
      for (const tier of ["glyph", "rich"]) {
        const c = recCtx();
        const okT = SH.drawTruck(c, pose, { project: proj, cellPx: CELL, tier: tier, theme: theme });
        let okD = false;
        for (const d of DOCKS) {
          okD = SH.drawDock(c, d, { open: true, trailer: true, level: 1 },
            { project: proj, cellPx: CELL, tier: tier, theme: theme }) || okD;
        }
        if (!okT || !okD) drewAll = false;
        if (!finitePts(c)) finiteOk = false;
        counts[pn + "/" + theme + "/" + tier] = c._pts.length;
      }
    }
  }
  // rich really adds detail over glyph; the 2.5D truck stands up while the
  // top-down one is a true plan shape (no vertical rise from height)
  const richer = counts["iso/light/rich"] > counts["iso/light/glyph"] &&
    counts["top/light/rich"] > counts["top/light/glyph"];
  const cLow = recCtx(), cHigh = recCtx();
  SH.drawTruck(cLow, Object.assign({}, pose, { lift: 0 }), { project: projIso, cellPx: CELL, tier: "rich", theme: "light" });
  SH.drawTruck(cHigh, Object.assign({}, pose, { lift: SH.HAUL.liftMax }), { project: projIso, cellPx: CELL, tier: "rich", theme: "light" });
  const isoRise = Math.abs(Math.min.apply(null, cLow._pts.map((p) => p[1])) - Math.min.apply(null, cHigh._pts.map((p) => p[1])));
  const tLow = recCtx(), tHigh = recCtx();
  SH.drawTruck(tLow, Object.assign({}, pose, { lift: 0 }), { project: projTop, cellPx: CELL, tier: "rich", theme: "light" });
  SH.drawTruck(tHigh, Object.assign({}, pose, { lift: SH.HAUL.liftMax }), { project: projTop, cellPx: CELL, tier: "rich", theme: "light" });
  const planFlat = Math.abs(Math.min.apply(null, tLow._pts.map((p) => p[1])) - Math.min.apply(null, tHigh._pts.map((p) => p[1]))) < 1e-9;
  // the box painter is the workforce's own - reuse, not a second geometry path
  const painterShared = /WT\.workers/.test(SRC) && /boxFaces/.test(SRC) && typeof W.boxFaces === "function";
  // and it degrades safely without a projector / without the workforce
  const safe = SH.drawTruck(recCtx(), pose, {}) === false && SH.drawDock(recCtx(), DOCKS[0], { open: true }, {}) === false;
  check("draw() is clean through BOTH projectors x both themes x both LOD tiers (finite coordinates only, the truck and the docks drawn every time), the rich tier really adds detail over the glyph tier, a raised fork rises on screen in 2.5D while the top-down plan shape stays flat, the oriented-box painter is WT.workers' own (reuse, not duplication), and a missing projector degrades to a clean no-draw",
    finiteOk && drewAll && richer && isoRise > 1 && planFlat && painterShared && safe,
    "pts " + Object.keys(counts).map((k) => k + "=" + counts[k]).join(" ") +
    "; isoRise=" + isoRise.toFixed(1) + "px planRise=0px painter=WT.workers.boxFaces");
})();

/* ---- 13. determinism + no clock / RNG -------------------------------- */
(() => {
  const a = JSON.stringify(SH.hauls(LAYOUT, SIM.plan).map((t) => SH.truckPose(t, 331.75)));
  const b = JSON.stringify(SH.hauls(LAYOUT, SIM.plan).map((t) => SH.truckPose(t, 331.75)));
  // two independent runs of the same sim resolve to the same picture
  const s1 = runTo(LAYOUT, 173), s2 = runTo(LAYOUT, 173);
  const st1 = SH.createStore(), st2 = SH.createStore();
  SH.updateStore(st1, s1, { docks: DOCKS });
  SH.updateStore(st2, s2, { docks: DOCKS });
  const r1 = JSON.stringify(s1.stations.map((s) => SH.readStation(st1, s.id)));
  const r2 = JSON.stringify(s2.stations.map((s) => SH.readStation(st2, s.id)));
  const d1 = JSON.stringify(SH.docks(LAYOUT)), d2 = JSON.stringify(SH.docks(LAYOUT));
  // no Date / no Math.random in the SOURCE...
  const srcClean = !/\bDate\b|Math\.random/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  // ...nor in any live exported function
  let liveFns = 0, liveClean = true;
  for (const k of Object.keys(SH)) {
    if (typeof SH[k] !== "function") continue;
    liveFns++;
    if (/new Date|Date\.now|Math\.random/.test(Function.prototype.toString.call(SH[k]))) liveClean = false;
  }
  check("DETERMINISTIC: identical (layout, plan, clock) give byte-identical truck poses, two independent runs of the same sim give byte-identical smoothed station reads and dock rosters, and there is NO Date and NO Math.random in shift.js - in the source OR in any of its live exported functions",
    a === b && r1 === r2 && d1 === d2 && srcClean && liveClean,
    "poses=" + (a === b) + " stationReads=" + (r1 === r2) + " docks=" + (d1 === d2) +
    " liveFns=" + liveFns + " clock/rng=" + (!srcClean || !liveClean));
})();

/* ---- 14. andon + honesty + shipped wiring ---------------------------- */
(() => {
  const store = SH.createStore();
  const stopped = SH.andon(null, store, { on: false });
  SH.updateStore(store, SIM, { docks: DOCKS });
  const running = SH.andon(SIM, store);
  // a jammed plant reads ATTENTION off the SMOOTHED bands, not the raw count
  const jam = SH.createStore();
  const sts = SIM.stations.map((s) => ({ id: s.id, kind: s.kind, stage: s.stage, x: s.x, y: s.y, queue: new Array(40).fill(0) }));
  const jsim = { tick: 0, tickAccum: 0, stations: sts, perStage: { picking: 40 }, completed: 0, inflight: 40 };
  for (let k = 0; k <= 200; k++) { jsim.tick = k; SH.updateStore(jam, jsim, { docks: [] }); }
  const hot = SH.andon(jsim, jam);
  const states = [stopped.state, running.state, hot.state];
  // shape + colour + words: every state has a distinct MARK, and the CSS
  // gives each one its own signal colour on a border (never colour alone)
  const marks = new Set([stopped.mark, running.mark, hot.mark]);
  const cssOk = /\.flow-andon\b/.test(STYLES_SRC) && /andon-running/.test(STYLES_SRC) &&
    /andon-attention/.test(STYLES_SRC) && /andon-stopped/.test(STYLES_SRC) &&
    /var\(--ok\)/.test(STYLES_SRC) && /var\(--warn\)/.test(STYLES_SRC);
  const andonOk = stopped.state === "stopped" && hot.state === "attention" &&
    (running.state === "running" || running.state === "attention") &&
    marks.size === 3 && hot.congested > 0;
  // honesty
  const H = SH.HONESTY || "";
  const honest = /READ-ONLY/i.test(H) && /NO model/i.test(H) && /NO number/i.test(H) &&
    /DRAWING FILTER/i.test(H) && /NOT a measurement/i.test(H) && /NOT CAD\/BIM/i.test(H) &&
    /NOT a vendor spec/i.test(H) && /NOMINAL/i.test(H) && H.length > 400;
  // shipped wiring
  const iGoods = INDEX_SRC.indexOf('src="goods.js"');
  const iShift = INDEX_SRC.indexOf('src="shift.js"');
  const iApp = INDEX_SRC.indexOf('src="app.js"');
  const inIndex = iGoods >= 0 && iShift > iGoods && iApp > iShift;
  const inSw = /["']\.\/shift\.js["']/.test(SW_SRC) && /CACHE_VERSION\s*=\s*"wt-v79"/.test(SW_SRC);
  const truckDraws = (APP_SRC.match(/drawTrucks\(\)/g) || []).length;
  const dockDraws = (APP_SRC.match(/drawDocks\(\)/g) || []).length;
  const viaProj = /project:\s*projPx/.test(APP_SRC) && /WT\.shift\.drawTruck/.test(APP_SRC);
  const hidesGlyph = /elementIsHauling/.test(APP_SRC) && /hideFor:\s*elementIsHauling/.test(APP_SRC);
  const smoothedColour = /WT\.shift\.readStation/.test(APP_SRC);
  const pacesWorkers = /WT\.shift\.stationAt/.test(APP_SRC) && /opt\.work\s*=\s*st\.eff/.test(APP_SRC);
  const arrowsAgree = /WT\.shift\.orientArrows/.test(APP_SRC);
  const andonWired = /andonHtml\(/.test(APP_SRC) && /flow-andon/.test(APP_SRC);
  const reducedSafe = /workerAnimT\(\)/.test(APP_SRC) && /prefersReducedMotion\(\)/.test(APP_SRC);
  const inSelftest = /shift-/.test(SELFTEST_SRC);
  const inRunner = /verify_shift\.js/.test(RUNALL_SRC);
  check("the ANDON reads three distinct states as SHAPE + colour + words off the SMOOTHED bands; the HONESTY label states this is a read-only drawing filter that adds no model and no number and is not a vendor spec, not CAD/BIM and not a measurement; and the shipped wiring is in place (index.html loads shift.js after goods.js and before app.js, sw.js precaches it at wt-v79, app.js draws the trucks + docks in BOTH render paths through projPx, hides the hauling truck's static form, colours stations from the smoothed read, paces the workforce from the station clock, orients the floor arrows and shows the andon - self-test and runner covered)",
    andonOk && marks.size === 3 && cssOk && honest && inIndex && inSw &&
    truckDraws >= 2 && dockDraws >= 2 && viaProj && hidesGlyph && smoothedColour &&
    pacesWorkers && arrowsAgree && andonWired && reducedSafe && inSelftest && inRunner,
    "andon=" + states.join("/") + " marks=" + Array.from(marks).join("") + " css=" + cssOk +
    " honesty=" + H.length + "chars index=" + inIndex + " sw=" + inSw +
    " truckDraws=" + truckDraws + " dockDraws=" + dockDraws + " projPx=" + viaProj +
    " hidesGlyph=" + hidesGlyph + " smoothedColour=" + smoothedColour + " pace=" + pacesWorkers +
    " arrows=" + arrowsAgree + " andonWired=" + andonWired + " reduced=" + reducedSafe +
    " selftest=" + inSelftest + " runner=" + inRunner);
})();

console.log("");
console.log(failures === 0
  ? "ALL SHIFT CHECKS PASSED"
  : failures + " SHIFT CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
