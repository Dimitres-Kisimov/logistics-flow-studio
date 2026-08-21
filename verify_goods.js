/* =====================================================================
 * Logistics Flow Studio - verify_goods.js
 * THE GOODS ARE PHYSICAL (v3.23) - headless verification of goods.js.
 * ---------------------------------------------------------------------
 * goods.js turns each handling unit the flow sim already carries into
 * the physical object it is at that point in the chain, puts it on the
 * surface that carries it, points it the way it is travelling, and
 * queues it nose-to-tail back along its own route. This harness proves
 * the model, NOT the pixels:
 *
 *   1. THE FORM CHAIN maps onto the sim's REAL stage machine: receiving
 *      -> pallet-load, storage -> carton, picking -> tote, packing /
 *      shipping -> parcel; a unit WAITING in a station queue still shows
 *      the INCOMING form (the station transforms it when it SERVES it),
 *      and the documented TRANSFORMS table agrees with the live mapping.
 *   2. CONSERVATION IS PRESERVED. The renderer is READ-ONLY: sampling
 *      and drawing every unit leaves the sim state byte-identical, the
 *      MU count is unchanged, and flowsim's invariant (spawned ==
 *      in-flight + completed) still holds after the goods layer has run
 *      over hundreds of ticks. A pallet-load that becomes cartons stays
 *      ONE MU.
 *   3. DETERMINISM: identical (state, layout) -> byte-identical unit
 *      lists, vehicle loads and rack stock; no Date and no Math.random
 *      in the source OR in the live exported functions.
 *   4. FINITE + BOUNDED: every drawn coordinate is finite and inside the
 *      floor, at every tick, on two very different layouts, and garbage
 *      input (NaN / missing / junk) still resolves finitely.
 *   5. BELT-SURFACE PLACEMENT: a unit standing on a conveyor cell is
 *      drawn at the BELT TOP (the domain heightM the 2.5D view and the
 *      IFC export share), on an RGV/AGV cell at the DECK, on a bench at
 *      the bench top, and on open floor at 0.
 *   6. NOSE-TO-TAIL QUEUES: consecutive units in a station queue are
 *      spaced by one unit length plus the bumper gap, along the sim's
 *      OWN route back from the station - not stacked in a pile.
 *   7. REDUCED MOTION: with no clock the vehicle loads resolve to a
 *      legible static frame (forks down, truck mid-lane, load ON the
 *      truck), and nothing moves.
 *   8. NO INPUT MUTATION anywhere (layout, sim state, MU objects).
 *   9. RACK STOCK is bounded by the EXISTING fill model: the scale is 1
 *      with no plant running (byte-identical picture), never leaves
 *      [1 - RICH_FILL, 1], moves with the sim's storage-stage occupancy,
 *      and the shape registry's loaded() is monotone in it (slots empty
 *      and refill in the pattern's own order - no second model).
 *  10. A draw() SMOKE through BOTH projectors x both themes x all three
 *      LOD tiers on a recording context: finite coordinates only, the
 *      rich tier really adds detail, the 2.5D unit stands up while the
 *      top-down unit is a true plan shape, and the painter is WT.workers'
 *      own (reuse, not duplication).
 *  11. HONESTY labels, and the shipped wiring (goods.js loaded after
 *      workers.js + precached at wt-v80, app.js draws it in BOTH render
 *      paths through projPx, the self-test + this runner entry).
 *
 * Usage:  node verify_goods.js      ASCII-only. Exit 0 = all pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // the modules attach to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js",
  "wms.js", "storage.js", "iso.js", "shapes.js", "workers.js", "flowsim.js", "goods.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const G = global.WT.goods;
const S = global.WT.shapes;
const W = global.WT.workers;
const FS = global.WT.flowsim;
const EX = global.WT.examples;
const ISO = global.WT.iso;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SRC = read("goods.js");
const APP_SRC = read("app.js");
const INDEX_SRC = read("index.html");
const SW_SRC = read("sw.js");
const SELFTEST_SRC = read("selftest.js");
const RUNALL_SRC = read(path.join("test", "run-all.mjs"));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

/* ---- fixtures: two very different floors ----------------------------- */
const LAYOUT = EX.build("ecommerce-multichannel-fc"); // a busy conveyor-routed FC
const LAYOUT2 = EX.build("automotive-jit-sequencing");    // a different plant shape
function runTo(layout, ticks, opts) {
  const st = FS.state(layout, opts || {});
  FS.step(st, ticks);
  return st;
}
const SIM = runTo(LAYOUT, 220);
const SIM2 = runTo(LAYOUT2, 220);
const SUP = G.supportIndex(LAYOUT);
const SUP2 = G.supportIndex(LAYOUT2);

// A tiny recording 2D context: captures every point the drawer emits.
function recCtx() {
  const c = {
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
  return c;
}
const CELL = 24;
const projTop = (x, y) => ({ x: x * CELL, y: y * CELL });
const projIso = (x, y, z) => {
  const p = ISO.project(x, y, z || 0);
  return { x: p.x * CELL, y: p.y * CELL };
};

/* ---- 1. the form chain maps onto the sim's real stages --------------- */
(() => {
  const want = {
    receiving: "pallet-load", storage: "carton", picking: "tote",
    packing: "parcel", shipping: "parcel",
  };
  const bad = [];
  for (const st of FS.STAGES) {
    const got = G.formFor({ stage: st, status: "active" });
    if (got !== want[st]) bad.push(st + "->" + got);
  }
  // A queued unit still carries the INCOMING form: the station transforms
  // it at the instant it SERVES it, not while it waits.
  const queuedWant = { storage: "pallet-load", picking: "carton", packing: "tote" };
  for (const st in queuedWant) {
    const got = G.formFor({ stage: st, status: "queued" });
    if (got !== queuedWant[st]) bad.push("queued " + st + "->" + got);
  }
  // The documented transform table names the SAME chain the code walks,
  // and every station kind it names is a real flowsim station kind.
  const kinds = FS.buildStationSpecs(LAYOUT, FS.buildWaypoints(LAYOUT), FS.throughputOf(LAYOUT, 42))
    .map((s) => s.kind);
  const tableOk = G.TRANSFORMS.length === 5 &&
    G.TRANSFORMS.every((t) => !t.station || ["put", "pick", "pack"].indexOf(t.station) >= 0) &&
    G.TRANSFORMS.filter((t) => t.station).every((t) => G.formFor({ stage: stageOfStation(t.station), status: "queued" }) === t.from &&
      G.formFor({ stage: stageOfStation(t.station), status: "active" }) === t.to);
  function stageOfStation(k) { return k === "put" ? "storage" : k === "pick" ? "picking" : "packing"; }
  // Every form the chain names is a real, sized form.
  const sized = Object.keys(G.STAGE_FORM).every((s) => G.sizeOf(G.STAGE_FORM[s]).f > 0);
  check("the FORM CHAIN maps onto the flow sim's own stage machine (receiving pallet-load -> put-away carton -> pick tote -> pack parcel -> ship parcel), a QUEUED unit still shows the incoming form, and the documented transform table agrees with the live mapping",
    bad.length === 0 && tableOk && sized && kinds.length > 0,
    bad.length ? bad.join(",") : "5 stages + 3 queue cases correct; transforms=" + G.TRANSFORMS.length +
      "; live station kinds=" + Array.from(new Set(kinds)).sort().join("/"));
})();

/* ---- 2. conservation preserved: the layer is READ-ONLY --------------- */
(() => {
  const st = FS.state(LAYOUT, {});
  let broke = null, mutated = null, muCount = null;
  for (let k = 0; k < 60; k++) {
    FS.step(st, 4);
    const before = snap(st);
    const nBefore = st.mus.length;
    const list = G.units(st, SUP);
    const ctx = recCtx();
    for (const u of list) G.draw(ctx, u, { project: projIso, cellPx: CELL, tier: "rich", theme: "light" });
    G.rackStock(st);
    for (const v of G.vehicles(LAYOUT)) G.sampleVehicle(v, st.tick);
    if (snap(st) !== before) mutated = mutated || "tick " + st.tick;
    if (st.mus.length !== nBefore) muCount = muCount || "tick " + st.tick;
    // flowsim's own invariant, still true with the renderer in the loop.
    if (st.spawned !== st.inflight + st.completed) broke = broke || "tick " + st.tick +
      " spawned=" + st.spawned + " inflight=" + st.inflight + " completed=" + st.completed;
    // one MU in, one unit out - a form change is NOT a unit split.
    if (list.length !== st.mus.length) broke = broke || "tick " + st.tick + " drew " + list.length + " for " + st.mus.length + " MUs";
  }
  function snap(s) {
    return JSON.stringify({
      t: s.tick, sp: s.spawned, c: s.completed, i: s.inflight, q: s.queued,
      mus: s.mus.map((m) => [m.id, m.seg, m.t, m.cx, m.cy, m.stage, m.status, m.stationId]),
      st: s.stations.map((x) => [x.id, x.queue.length, x.serviceAccum]),
    });
  }
  check("UNITS ARE CONSERVED: the goods layer is strictly READ-ONLY - 60 sampled+drawn steps leave the sim state byte-identical, the MU count never changes, exactly one drawable unit exists per MU (a pallet-load becoming cartons is a FORM change, not a split), and spawned == in-flight + completed holds at every step",
    !broke && !mutated && !muCount,
    broke || mutated || muCount || "60 steps, " + st.spawned + " spawned / " + st.completed +
      " completed / " + st.inflight + " in flight; state byte-identical every step");
})();

/* ---- 3. determinism ------------------------------------------------- */
(() => {
  const a = JSON.stringify(G.units(SIM, SUP));
  const b = JSON.stringify(G.units(SIM, SUP));
  const c = JSON.stringify(G.units(SIM, G.supportIndex(LAYOUT)));
  const va = JSON.stringify(G.vehicles(LAYOUT).map((v) => G.sampleVehicle(v, 77.25)));
  const vb = JSON.stringify(G.vehicles(LAYOUT).map((v) => G.sampleVehicle(v, 77.25)));
  // Two independent runs of the same sim give the same picture.
  const s1 = JSON.stringify(G.units(runTo(LAYOUT, 137), G.supportIndex(LAYOUT)));
  const s2 = JSON.stringify(G.units(runTo(LAYOUT, 137), G.supportIndex(LAYOUT)));
  const st1 = G.rackStock(runTo(LAYOUT, 137)), st2 = G.rackStock(runTo(LAYOUT, 137));
  // Structural: no clock, no RNG - in the source AND on the live exports.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcBad = /Date\.now|new Date\(/.test(CODE) || /Math\.random/.test(CODE);
  let live = "", n = 0;
  for (const k in G) { if (typeof G[k] === "function") { live += String(G[k]) + "\n"; n++; } }
  const liveBad = /Date\.now|new Date\(/.test(live) || /Math\.random/.test(live);
  check("DETERMINISTIC: identical (sim, layout) give byte-identical unit lists, vehicle loads and rack stock across independent runs; and there is NO Date and NO Math.random in goods.js (source scan AND a scan of the live exported functions)",
    a === b && a === c && va === vb && s1 === s2 && st1 === st2 && !srcBad && !liveBad && n >= 12,
    "units=" + (a === b && a === c) + " vehicles=" + (va === vb) + " reruns=" + (s1 === s2) +
      " stock=" + (st1 === st2) + " liveFns=" + n + " clock/rng=" + (srcBad || liveBad));
})();

/* ---- 4. finite + bounded, every tick, both layouts ------------------- */
(() => {
  let bad = null, n = 0;
  const cases = [[LAYOUT, SUP], [LAYOUT2, SUP2]];
  for (const [lay, sup] of cases) {
    const st = FS.state(lay, {});
    for (let k = 0; k < 40; k++) {
      FS.step(st, 6);
      for (const u of G.units(st, sup)) {
        n++;
        if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.z) || !isFinite(u.heading)) bad = bad || "non-finite " + u.id;
        if (u.x < 0 || u.x > lay.gridW || u.y < 0 || u.y > lay.gridH) bad = bad || "off floor " + u.id + " @" + u.x.toFixed(2) + "," + u.y.toFixed(2);
        if (u.z < 0 || u.z > 25) bad = bad || "absurd height " + u.z;
        if (!G.FORMS.length || G.FORMS.indexOf(u.form) < 0) bad = bad || "unknown form " + u.form;
        if (!(u.size.f > 0 && u.size.l > 0 && u.size.z > 0)) bad = bad || "bad size " + u.form;
      }
    }
  }
  // Garbage in -> finite out (never a NaN on the canvas).
  const junk = [null, undefined, NaN, {}, { stage: "nope", cx: NaN, cy: "x", seg: 99 }];
  for (const j of junk) {
    const u = G.sample(SIM, j, SUP);
    if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.z) || !isFinite(u.heading)) bad = bad || "garbage " + String(j);
  }
  const u0 = G.sample(SIM, null, null);
  check("every drawn coordinate is FINITE and inside the floor on two different plants across 80 sim steps, every form is a known, positively sized handling unit, and garbage input still resolves finitely",
    !bad && n > 100 && isFinite(u0.x),
    bad || n + " unit samples clean over 2 layouts x 40 steps; " + junk.length + " garbage inputs safe");
})();

/* ---- 5. belt-surface placement --------------------------------------- */
(() => {
  // A hand-built floor: a belt, a rail vehicle, a bench and open slab.
  const lay = {
    gridW: 24, gridH: 12,
    elements: [
      { id: "c1", type: "conveyor", x: 4, y: 4, w: 8, d: 1 },
      { id: "r1", type: "rgv", x: 14, y: 4, w: 6, d: 1 },
      { id: "p1", type: "pack-station", x: 4, y: 8, w: 3, d: 2 },
      { id: "g1", type: "gate", x: 20, y: 8, w: 2, d: 1 },
    ],
  };
  const idx = G.supportIndex(lay);
  const beltH = ISO.elementHeight("conveyor");
  const rgvH = ISO.elementHeight("rgv");
  const packH = ISO.elementHeight("pack-station");
  const onBelt = G.supportAt(idx, 6.5, 4.5);
  const onDeck = G.supportAt(idx, 16.5, 4.5);
  const onBench = G.supportAt(idx, 5.5, 9.2);
  const onFloor = G.supportAt(idx, 1.5, 1.5);
  const atGate = G.supportAt(idx, 20.5, 8.5); // a door is not a carrier
  const ok =
    onBelt.kind === "belt" && Math.abs(onBelt.z - beltH) < 1e-9 &&
    onDeck.kind === "deck" && Math.abs(onDeck.z - rgvH * G.DECK_TOP) < 1e-9 &&
    onBench.kind === "bench" && Math.abs(onBench.z - packH * G.BENCH_TOP) < 1e-9 &&
    onFloor.kind === "floor" && onFloor.z === 0 &&
    atGate.kind === "floor" && atGate.z === 0 &&
    beltH > 0 && idx.count === 8 + 6 + 6;
  // ...and a LIVE unit on the conveyor really rides it, on a real plant.
  let ridden = 0, floated = null;
  const st = FS.state(LAYOUT, {});
  for (let k = 0; k < 40; k++) {
    FS.step(st, 6);
    for (const u of G.units(st, SUP)) {
      const sup = G.supportAt(SUP, u.x, u.y);
      if (Math.abs(u.z - sup.z) > 1e-9) floated = floated || "unit " + u.id + " z=" + u.z + " surface=" + sup.z;
      if (u.ride === "belt") ridden++;
    }
  }
  check("goods RIDE THE ACTIVE COMPONENTS: a unit over a conveyor cell sits at the BELT TOP (the shared domain heightM), over an RGV at the carriage DECK, over a pack bench on the BENCH TOP and on open slab at 0 - and every live unit on a real plant is drawn exactly on the surface under it, never floating",
    ok && !floated,
    floated || "belt=" + beltH + "m deck=" + (rgvH * G.DECK_TOP).toFixed(2) + "m bench=" +
      (packH * G.BENCH_TOP).toFixed(2) + "m cells=" + idx.count + "; live belt-borne samples=" + ridden);
})();

/* ---- 6. nose-to-tail queue spacing ----------------------------------- */
(() => {
  // Force congestion: arrivals far above the stations' service rate.
  const st = FS.state(LAYOUT, { arrivalUnitsPerHr: 4000 });
  FS.step(st, 260);
  let hot = null;
  for (const s of st.stations) if (s.queue.length >= 3 && (!hot || s.queue.length > hot.queue.length)) hot = s;
  let bad = null, pairs = 0, maxGap = 0, minGap = Infinity;
  if (hot) {
    const units = G.units(st, SUP);
    const byId = {};
    for (const u of units) byId[u.id] = u;
    const cap = FS.PARAMS.queueStackMax;
    for (let i = 0; i + 1 < Math.min(hot.queue.length, cap + 1); i++) {
      const a = byId[hot.queue[i].id], b = byId[hot.queue[i + 1].id];
      if (!a || !b) { bad = bad || "queue member not drawn"; break; }
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const pitch = a.size.f + G.NOSE_GAP;
      pairs++;
      maxGap = Math.max(maxGap, d); minGap = Math.min(minGap, d);
      // Nose to tail: one unit length + the bumper gap, with slack only
      // where the route turns a corner between the two places.
      if (d < pitch * 0.5 || d > pitch * 1.6) bad = bad || "pair " + i + " gap=" + d.toFixed(3) + " pitch=" + pitch.toFixed(3);
      // ...and the queue really extends BACK from the station, never through it.
      const head = st.plan.waypoints[hot.wpIndex];
      const da = Math.hypot(a.x - head.x, a.y - head.y), db = Math.hypot(b.x - head.x, b.y - head.y);
      if (db < da - 1e-6) bad = bad || "queue runs forwards at " + i;
    }
  }
  check("a QUEUE BACKS UP NOSE-TO-TAIL along the sim's own route: consecutive waiting units are one unit length plus the bumper gap apart and each stands further back from the station than the one in front - the queue order, length and service are entirely the sim's",
    !!hot && !bad && pairs >= 2,
    bad || (hot ? "longest queue=" + hot.queue.length + " at " + hot.id + "; " + pairs +
      " pairs, gap " + minGap.toFixed(3) + ".." + maxGap.toFixed(3) + " cells (pitch " +
      (G.sizeOf("pallet-load").f + G.NOSE_GAP).toFixed(2) + ")" : "no queue formed"));
})();

/* ---- 7. carried by the trucks + the reduced-motion static frame ------ */
(() => {
  const lay = {
    gridW: 30, gridH: 14,
    elements: [
      { id: "f1", type: "forklift", x: 2, y: 2, w: 3, d: 2 },
      { id: "r1", type: "rgv", x: 10, y: 2, w: 10, d: 1 },
      { id: "a1", type: "agv", x: 10, y: 8, w: 10, d: 1 },
    ],
  };
  const fleet = G.vehicles(lay);
  const byType = {};
  for (const v of fleet) byType[v.type] = v;
  let bad = null;
  // Static frame (no clock): everything legible and ON its truck.
  for (const v of fleet) {
    const u = G.sampleVehicle(v, null);
    if (!u.resting) bad = bad || v.type + " not resting";
    if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.z)) bad = bad || v.type + " non-finite at rest";
    if (u.x < v.x - 0.6 || u.x > v.x + v.w + 0.6 || u.y < v.y - 0.6 || u.y > v.y + v.d + 0.6) {
      bad = bad || v.type + " load off its truck at rest";
    }
    if (v.mode === "lift" && u.lift !== 0) bad = bad || "forks not down at rest";
  }
  // Live: the load MOVES WITH the truck (same lane parameter), and the
  // reach truck's forks really rise and fall.
  let travel = 0, lifts = [];
  const rgv = byType.rgv, lift = byType.forklift;
  let prev = null;
  for (let i = 0; i <= 48; i++) {
    const t = i * 0.1;
    const u = G.sampleVehicle(rgv, t);
    if (prev != null) travel = Math.max(travel, Math.abs(u.x - prev));
    prev = u.x;
    if (u.y < rgv.y || u.y > rgv.y + rgv.d) bad = bad || "rgv load left its rail";
    const l = G.sampleVehicle(lift, t);
    lifts.push(l.z);
  }
  const rose = Math.max.apply(null, lifts) - Math.min.apply(null, lifts);
  // Loaded going up, empty coming down: a put-away cycle.
  const forms = new Set();
  for (let i = 0; i <= 48; i++) forms.add(G.sampleVehicle(lift, i * 0.1).form);
  check("the TRUCKS CARRY THE GOODS: a forklift / RGV / AGV load rides on the forks or deck and travels with its own vehicle's lane parameter, the reach truck's forks RAISE with the load and come back down empty, and with NO clock (prefers-reduced-motion / a stopped plant) every load resolves to a legible static frame ON its truck with the forks down",
    !bad && fleet.length === 3 && travel > 0 && rose > 0.3 && forms.has("pallet-load") && forms.has("pallet"),
    bad || "fleet=" + fleet.length + " railTravel=" + travel.toFixed(3) + " forkRise=" + rose.toFixed(2) +
      "m forms=" + Array.from(forms).sort().join("/"));
})();

/* ---- 8. no input mutation ------------------------------------------- */
(() => {
  const layBefore = JSON.stringify(LAYOUT);
  const simBefore = JSON.stringify(SIM.mus.map((m) => [m.id, m.cx, m.cy, m.stage, m.status]));
  G.supportIndex(LAYOUT);
  G.vehicles(LAYOUT);
  const list = G.units(SIM, SUP);
  const ctx = recCtx();
  for (const u of list) G.draw(ctx, u, { project: projTop, cellPx: CELL, tier: "glyph", theme: "dark" });
  G.rackStock(SIM);
  const layAfter = JSON.stringify(LAYOUT);
  const simAfter = JSON.stringify(SIM.mus.map((m) => [m.id, m.cx, m.cy, m.stage, m.status]));
  // ...and the returned units are plain data, not live references.
  const aliased = list.some((u) => SIM.mus.indexOf(u) >= 0);
  check("NO INPUT MUTATION: building the support index, the fleet, the unit list, the rack stock and a full draw pass leave the layout and every MU byte-identical, and the returned units are copies, not live sim objects",
    layBefore === layAfter && simBefore === simAfter && !aliased,
    "layout=" + (layBefore === layAfter) + " mus=" + (simBefore === simAfter) + " aliased=" + aliased);
})();

/* ---- 9. rack stock bounded by the EXISTING fill model ---------------- */
(() => {
  const RICH = S.RICH_FILL;
  const lo = 1 - RICH;
  let bad = null;
  // No plant -> exactly the historic picture.
  if (G.rackStock(null) !== 1 || G.rackStock({}) !== 1) bad = "stopped plant is not 1";
  const st = FS.state(LAYOUT, {});
  const seen = [];
  for (let k = 0; k < 60; k++) {
    FS.step(st, 5);
    const v = G.rackStock(st);
    seen.push(v);
    if (!(v >= lo - 1e-9 && v <= 1 + 1e-9)) bad = bad || "out of band " + v;
  }
  const spread = Math.max.apply(null, seen) - Math.min.apply(null, seen);
  // The SAME deterministic pattern, emptying and refilling in its own
  // order: a slot loaded at a lower stock is loaded at a higher one too.
  let monotone = true;
  for (let seed = 0; seed < 40; seed++) {
    for (let i = 0; i < 40; i++) {
      if (S.loaded(i, seed, undefined, 0.4) && !S.loaded(i, seed, undefined, 0.9)) monotone = false;
      if (S.loaded(i, seed, undefined, 0.9) && !S.loaded(i, seed, undefined, 1)) monotone = false;
    }
  }
  // Omitted / junk stock -> byte-identical to the pre-v3.23 pattern.
  let identical = true;
  for (let seed = 0; seed < 40; seed++) {
    for (let i = 0; i < 40; i++) {
      const base = S.loaded(i, seed);
      if (S.loaded(i, seed, undefined, undefined) !== base) identical = false;
      if (S.loaded(i, seed, undefined, NaN) !== base) identical = false;
      if (S.loaded(i, seed, undefined, 1) !== base) identical = false;
    }
  }
  check("RACKS SHOW STOCK, bounded by the EXISTING deterministic fill model: the scale is exactly 1 with no plant running (byte-identical picture), never leaves [1 - RICH_FILL, 1], really moves as the sim's storage stage fills and drains, and the shape registry's own pattern is MONOTONE in it - the same slots empty and refill in the pattern's own order, no second inventory model",
    !bad && spread > 0 && monotone && identical,
    bad || "band [" + lo.toFixed(2) + ",1] observed [" + Math.min.apply(null, seen).toFixed(3) + "," +
      Math.max.apply(null, seen).toFixed(3) + "] spread=" + spread.toFixed(3) +
      " monotone=" + monotone + " unchangedWithoutStock=" + identical);
})();

/* ---- 10. draw() smoke: both projectors x themes x tiers -------------- */
(() => {
  let bad = null;
  const list = G.units(SIM, SUP).slice(0, 24);
  const counts = {};
  for (const proj of [["top", projTop], ["iso", projIso]]) {
    for (const theme of ["light", "dark"]) {
      for (const tier of ["icon", "glyph", "rich"]) {
        const ctx = recCtx();
        let drawn = 0;
        for (const u of list) if (G.draw(ctx, u, { project: proj[1], cellPx: CELL, tier: tier, theme: theme, stageColor: "#2f6e8f", congest: "#c0392b" })) drawn++;
        for (const p of ctx._pts) {
          if (!isFinite(p[0]) || !isFinite(p[1])) bad = bad || "non-finite px " + proj[0] + "/" + theme + "/" + tier;
        }
        if (drawn !== list.length) bad = bad || "not all drawn " + proj[0] + "/" + tier;
        counts[proj[0] + "/" + theme + "/" + tier] = ctx._pts.length;
      }
    }
  }
  // The rich tier really adds detail over the glyph tier, which really
  // adds form over the icon mark.
  const richer = counts["iso/light/rich"] > counts["iso/light/glyph"] &&
    counts["iso/light/glyph"] > counts["iso/light/icon"];
  // ONE model, TWO views: the 2.5D unit stands up (its top projects
  // ABOVE its base), the top-down unit is a true plan shape (it does not).
  const u = { id: 1, form: "pallet-load", size: G.sizeOf("pallet-load"), x: 6, y: 5, z: 0, heading: 0, ride: "floor", stage: "receiving", status: "active", queueIndex: -1, hot: false };
  const isoBase = projIso(u.x, u.y, 0), isoTop = projIso(u.x, u.y, u.size.z);
  const tdBase = projTop(u.x, u.y, 0), tdTop = projTop(u.x, u.y, u.size.z);
  const standsUp = isoBase.y - isoTop.y > 4;
  const planView = Math.abs(tdBase.y - tdTop.y) < 1e-9;
  // REUSE, not duplication: the painter really is the workforce's own.
  const reuses = /WT\.workers/.test(SRC) && /boxFaces/.test(SRC) && typeof W.boxFaces === "function";
  const noOwnPainter = !/function\s+boxFaces\s*\(/.test(SRC);
  check("draw() is clean through BOTH projectors x both themes x all three LOD tiers (finite coordinates only, every unit drawn), the rich tier adds detail over the glyph which adds form over the icon mark, the 2.5D unit stands up while the top-down unit is a true plan shape, and the oriented-box painter is WT.workers' own (reuse, not duplication)",
    !bad && richer && standsUp && planView && reuses && noOwnPainter,
    bad || "pts icon/glyph/rich = " + counts["iso/light/icon"] + "/" + counts["iso/light/glyph"] +
      "/" + counts["iso/light/rich"] + "; isoRise=" + (isoBase.y - isoTop.y).toFixed(1) +
      "px planOffset=0px; painter=WT.workers.boxFaces");
})();

/* ---- 11. honesty labels ---------------------------------------------- */
(() => {
  const has = (re) => re.test(SRC);
  const need = [
    [/ILLUSTRATIVE/i, "illustrative"],
    [/NOT a measurement/i, "not a measurement"],
    [/NOT CAD\/BIM/i, "not CAD/BIM"],
    [/NOT a survey/i, "not a survey"],
    [/UNITS ARE CONSERVED/i, "units are conserved"],
    [/NOMINAL/i, "nominal dimensions"],
    [/NOT a specification/i, "not a specification"],
    [/adds NO model/i, "adds no model"],
  ];
  const missing = need.filter((n) => !has(n[0])).map((n) => n[1]);
  const label = typeof G.HONESTY === "string" && G.HONESTY.length > 200 &&
    /conserved/i.test(G.HONESTY) && /SYNTHETIC/i.test(G.HONESTY);
  check("HONESTY: goods.js states it is an illustrative rendering that adds no model and no number, that units are conserved, that the handling-unit sizes are nominal drawing constants and not a specification, and that it is not CAD/BIM, not a survey and not a measurement - and exports that label",
    missing.length === 0 && label,
    missing.length ? "missing: " + missing.join(", ") : need.length + " labels present; HONESTY " + G.HONESTY.length + " chars");
})();

/* ---- 12. shipped wiring ---------------------------------------------- */
(() => {
  const iWorkers = INDEX_SRC.indexOf('src="workers.js"');
  const iGoods = INDEX_SRC.indexOf('src="goods.js"');
  const iApp = INDEX_SRC.indexOf('src="app.js"');
  const inIndex = iWorkers >= 0 && iGoods > iWorkers && iApp > iGoods;
  const inSw = /["']\.\/goods\.js["']/.test(SW_SRC) && /CACHE_VERSION\s*=\s*"wt-v80"/.test(SW_SRC);
  // Drawn from BOTH render paths, through projPx, LOD-gated, and the
  // vehicle loads ride with the workforce in both views.
  const muDraws = (APP_SRC.match(/drawFlowMUs\(\);/g) || []).length;
  const vehDraws = (APP_SRC.match(/drawGoodsVehicles\(\);/g) || []).length;
  const viaProj = /project:\s*projPx/.test(APP_SRC);
  const lodGated = /WT\.shapes\.detailLevel\(cellPx \* view\.scale\)/.test(APP_SRC) &&
    /MAX_FORM_UNITS/.test(APP_SRC);
  const stockWired = /stock:\s*rackStockScale\(\)/.test(APP_SRC) &&
    (APP_SRC.match(/stock:\s*rackStockScale\(\)/g) || []).length >= 2;
  const reducedSafe = /workerAnimT\(\)/.test(APP_SRC) && /prefersReducedMotion\(\)/.test(APP_SRC);
  const inSelftest = /goods-/.test(SELFTEST_SRC);
  const inRunner = /verify_goods\.js/.test(RUNALL_SRC);
  check("shipped wiring: index.html loads goods.js AFTER workers.js and before app.js, sw.js precaches it at wt-v80, app.js draws the goods + the truck loads in BOTH render paths through projPx (LOD-gated with a drawing budget, reduced-motion-safe, rack stock handed to both the glyph and the 2.5D forms), and the self-test + runner cover it",
    inIndex && inSw && muDraws >= 2 && vehDraws >= 2 && viaProj && lodGated && stockWired && reducedSafe && inSelftest && inRunner,
    "index=" + inIndex + " sw=" + inSw + " muDraws=" + muDraws + " vehDraws=" + vehDraws +
    " projPx=" + viaProj + " lod=" + lodGated + " stock=" + stockWired +
    " reduced=" + reducedSafe + " selftest=" + inSelftest + " runner=" + inRunner);
})();

console.log("");
console.log(failures === 0
  ? "ALL GOODS CHECKS PASSED"
  : failures + " GOODS CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
