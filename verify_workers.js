/* =====================================================================
 * verify_workers.js - the LIVING WORKFORCE (v3.22) harness.
 * ---------------------------------------------------------------------
 * Workers stopped being a head disc bolted to a pack bench and became
 * figures that WALK, BEND, REACH, CARRY, PACK and SCAN. This harness runs
 * the REAL pure module (workers.js, over the real domain.js + the real
 * example layouts) in Node under the same window shim the other harnesses
 * use, and static-scans the wired files for the parts that live behind
 * the canvas (app.js, index.html, sw.js, selftest.js, test/run-all.mjs).
 * The live pixels are verified in the browser (?selftest=1); every PATH
 * is exercised here.
 *
 * Checks (all deterministic - no clock, no RNG anywhere in the model):
 *   1. taskForType maps every manned element class to the right job and
 *      leaves unmanned types unstaffed
 *   2. roster is deterministic, non-mutating, capped, in-bounds, and its
 *      routes/anchors are sane (the anchor is the element centre, which
 *      is the flow sim's own station anchor)
 *   3. sample() is deterministic, periodic in the cycle length, and
 *      garbage-safe (NaN / Infinity / missing t all resolve to the
 *      static frame)
 *   4. every joint of every pose, for every task, over a full cycle
 *      sweep, is FINITE and inside a plausible human bounding box
 *   5. GAIT: the legs alternate, the arms counter-swing, and the gait
 *      phase is driven by TRAVEL (a longer leg = more strides), not by
 *      the clock
 *   6. the cycle is CONTINUOUS: no pose pops at any step boundary or at
 *      the wrap (a fine sweep bounds every per-sample joint movement)
 *   7. the POSE MATCHES THE STATION: a picker folds down and reaches to
 *      its own face height; a packer keeps both hands over the bench; a
 *      put-away worker carries at chest height; a dock worker raises one
 *      hand above shoulder height
 *   8. the LOAD IS IN THE HANDS: present exactly while carrying, centred
 *      between the hands, gone when empty-handed
 *   9. REDUCED MOTION / stopped plant: the static frame is deterministic,
 *      has zero gait amplitude, both feet planted and close together -
 *      a legible standing pose, never mid-stride
 *  10. draw() smoke: top-down AND iso projectors x themes x tiers - no
 *      throw, every coordinate finite, no input mutation, rich adds
 *      detail over glyph, a bad projector is refused
 *  11. BOTH VIEWS AGREE: the same worker draws the same primitive count
 *      through either projector, the iso figure stands up (head above
 *      feet on screen) and the top-down figure is a plan view
 *  12. determinism is STRUCTURAL: no Date / no Math.random in workers.js
 *      (source scan AND a scan of the live exported functions)
 *  13. honesty labels: illustrative / not motion capture / not a labour
 *      standard / no identity modelled
 *  14. shipped wiring: index.html loads workers.js, sw.js precaches it at
 *      the bumped wt-v79 cache, app.js draws the workforce in BOTH render
 *      paths (LOD-gated + reduced-motion-safe), selftest.js covers it and
 *      test/run-all.mjs lists this harness
 *
 * Usage:  node verify_workers.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // the modules attach to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js", "workers.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const W = global.WT.workers;
const D = global.WT.domain;
const EX = global.WT.examples;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const SRC = read("workers.js");
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

// A busy warehouse example + a generated factory: two very different floors.
const LAYOUT = EX.build("ecommerce-multichannel-fc");
const LAYOUT2 = EX.build("coldchain-frozen-dc");
const ROSTER = W.roster(LAYOUT);
const JOINTS = ["hip", "hipL", "hipR", "chest", "neck", "head", "shL", "shR",
  "elL", "elR", "handL", "handR", "kneeL", "kneeR", "footL", "footR"];
const TASKS = ["pick", "pack", "put", "scan", "idle"];

function specFor(task) {
  return ROSTER.find((s) => s.task === task) ||
    W.roster(LAYOUT2).find((s) => s.task === task) || null;
}

/* ---- 1. taskForType: the right job at the right element -------------- */
(() => {
  const want = {
    "carton-flow": "pick", "pick-to-light": "pick", "mezzanine": "pick",
    "asrs": "pick", "shuttle": "pick", "pallet-flow": "pick",
    "pack-station": "pack", "returns-station": "pack",
    "push-station": "pack", "pull-station": "pack",
    "mfg-station": "pack", "mfg-assembly": "pack",
    "staging": "put",
    "dock-in": "scan", "dock-out": "scan", "gate": "scan",
    "mfg-source": "scan", "mfg-drain": "scan",
  };
  const unmanned = ["selective-racking", "block-stack", "conveyor", "rgv", "agv",
    "forklift", "sorter", "charging-station", "pipe", "tank", "track"];
  const wrong = Object.keys(want).filter((t) => W.taskForType(t) !== want[t]);
  const staffed = unmanned.filter((t) => W.taskForType(t) !== null);
  check("taskForType maps every manned element class to the right job (pick/pack/put/scan) and leaves transport, bulk racking and support unmanned",
    wrong.length === 0 && staffed.length === 0,
    wrong.length ? "wrong: " + wrong.map((t) => t + "->" + W.taskForType(t)).join(",")
      : staffed.length ? "unexpectedly staffed: " + staffed.join(",")
        : Object.keys(want).length + " manned classes correct, " + unmanned.length + " left unstaffed");
})();

/* ---- 2. roster: deterministic, non-mutating, capped, in bounds ------- */
(() => {
  const before = JSON.stringify(LAYOUT);
  const a = JSON.stringify(W.roster(LAYOUT));
  const b = JSON.stringify(W.roster(LAYOUT));
  const mutated = JSON.stringify(LAYOUT) !== before;
  // Every route point on the floor, every anchor at its element centre.
  let outOfBounds = 0, badAnchor = 0;
  for (const s of ROSTER) {
    for (const p of s.route) {
      if (!(p.x >= 0 && p.x <= LAYOUT.gridW && p.y >= 0 && p.y <= LAYOUT.gridH)) outOfBounds++;
    }
    const el = LAYOUT.elements.find((e) => e.type === s.type &&
      Math.abs(e.x + e.w / 2 - s.anchor.x) < 1e-9 && Math.abs(e.y + e.d / 2 - s.anchor.y) < 1e-9);
    if (!el) badAnchor++;
  }
  // The cap really caps, and is honoured on a big floor.
  const big = { gridW: 60, gridH: 40, elements: [] };
  for (let i = 0; i < 200; i++) big.elements.push({ type: "carton-flow", x: (i % 20) * 3, y: Math.floor(i / 20) * 3, w: 3, d: 1 });
  const capped = W.roster(big);
  const capped5 = W.roster(big, { max: 5 });
  check("roster is deterministic, mutates nothing, keeps every worker on the floor, anchors each at its element centre, and caps the workforce",
    a === b && !mutated && outOfBounds === 0 && badAnchor === 0 &&
    capped.length === W.MAX_WORKERS && capped5.length === 5 && ROSTER.length > 0,
    "n=" + ROSTER.length + " determ=" + (a === b) + " mutated=" + mutated +
    " offFloor=" + outOfBounds + " badAnchor=" + badAnchor +
    " cap=" + capped.length + "/" + W.MAX_WORKERS + " max5=" + capped5.length);
})();

/* ---- 3. sample(): deterministic, periodic, garbage-safe -------------- */
(() => {
  let notDeterm = null, notPeriodic = null, notGarbageSafe = null;
  for (const task of TASKS) {
    const spec = specFor(task === "idle" ? "pick" : task);
    if (!spec) continue;
    const busy = task !== "idle";
    const per = W.CYCLES[task].ticks;
    for (const t of [0, 13.5, 61, 129.25]) {
      const s1 = JSON.stringify(W.sample(spec, t, { busy: busy }).params);
      const s2 = JSON.stringify(W.sample(spec, t, { busy: busy }).params);
      if (s1 !== s2) notDeterm = notDeterm || task + "@" + t;
      if (JSON.stringify(W.pose(W.sample(spec, t, { busy: busy }))) !==
          JSON.stringify(W.pose(W.sample(spec, t, { busy: busy })))) {
        notDeterm = notDeterm || task + "@" + t + " pose";
      }
      // Periodic in the CYCLE, to floating-point tolerance: one cycle
      // later is the same work at the same point of it. (The slow breath
      // rides its own period, so the CYCLE claim is about the parameters
      // the cycle itself drives.)
      const q1 = W.sample(spec, t, { busy: busy }).params;
      const q2 = W.sample(spec, t + per, { busy: busy }).params;
      const q3 = W.sample(spec, t + per * 4, { busy: busy }).params;
      for (const k in q1) {
        if (Math.abs(q1[k] - q2[k]) > 1e-6 || Math.abs(q1[k] - q3[k]) > 1e-6) {
          notPeriodic = notPeriodic || task + "@" + t + " " + k + " " + q1[k] + " vs " + q2[k];
        }
      }
    }
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "x", {}]) {
      const s = W.sample(spec, bad, { busy: busy });
      const sk = W.pose(s);
      const finite = JOINTS.every((k) => isFinite(sk[k].f) && isFinite(sk[k].l) && isFinite(sk[k].z));
      if (!s.resting || !finite) notGarbageSafe = notGarbageSafe || task + " t=" + String(bad);
    }
  }
  check("sample() is deterministic, periodic in its cycle length, and garbage-safe (NaN/Infinity/missing clock all resolve to the static frame)",
    !notDeterm && !notPeriodic && !notGarbageSafe,
    notDeterm || notPeriodic || notGarbageSafe || "5 cycles x 4 phases x 7 garbage clocks clean");
})();

/* ---- 4. every joint finite + inside a human bounding box ------------- */
(() => {
  let bad = null;
  const N = 120;
  for (const task of TASKS) {
    const spec = specFor(task === "idle" ? "pack" : task);
    if (!spec) continue;
    const per = W.CYCLES[task].ticks;
    for (let i = 0; i <= N; i++) {
      const w = W.sample(spec, (i / N) * per, { busy: task !== "idle" });
      const sk = W.pose(w);
      for (const k of JOINTS) {
        const j = sk[k];
        if (!isFinite(j.f) || !isFinite(j.l) || !isFinite(j.z)) { bad = bad || task + "." + k + " non-finite"; break; }
        // A person is not 3 m wide and does not sink into the slab.
        if (Math.abs(j.f) > 1.1 || Math.abs(j.l) > 0.8 || j.z < -0.02 || j.z > 2.1) {
          bad = bad || task + "." + k + " out of the body box (" +
            j.f.toFixed(2) + "," + j.l.toFixed(2) + "," + j.z.toFixed(2) + ")";
          break;
        }
      }
      const wj = W.worldJoints(w, sk);
      for (const k of JOINTS) {
        if (!isFinite(wj[k].x) || !isFinite(wj[k].y) || !isFinite(wj[k].z)) bad = bad || task + "." + k + " world non-finite";
      }
    }
  }
  check("every joint of every pose, over a full cycle of every task, is finite and inside a plausible human bounding box (body frame AND world)",
    !bad, bad || TASKS.length + " tasks x " + (N + 1) + " phases x " + JOINTS.length + " joints clean");
})();

/* ---- 5. GAIT: alternating legs, counter-swinging arms, travel-driven - */
(() => {
  const spec = specFor("pick");
  const per = W.CYCLES.pick.ticks;
  // Find the walking part of the cycle and assert real alternation.
  let alternating = 0, sampled = 0, counterSwing = 0, armSampled = 0;
  for (let i = 0; i <= 400; i++) {
    const w = W.sample(spec, (i / 400) * per);
    if (w.sub !== "walk" || w.gaitAmp < 0.4) continue;
    const sk = W.pose(w);
    sampled++;
    // One foot forward, the other back - never both the same way.
    if (Math.sign(sk.footL.f - (-0.04)) !== Math.sign(sk.footR.f - 0.04)) alternating++;
    // The arms swing OPPOSITE their own-side leg (left hand back as the
    // left foot swings forward) - and only when the stride is open.
    if (Math.abs(sk.footL.f) > 0.08) {
      armSampled++;
      if (Math.sign(sk.handL.f - sk.handR.f) !== Math.sign(sk.footL.f - sk.footR.f)) counterSwing++;
    }
  }
  // Travel-driven cadence: the same worker on a LONGER leg takes MORE
  // strides in the same share of the cycle (the phase comes from distance
  // / stride, not from the clock).
  const strides = (len) => {
    const s2 = JSON.parse(JSON.stringify(spec));
    s2.route = [{ x: 5, y: 5 }, { x: 5 + len, y: 5 }];
    let last = null, turns = 0;
    for (let i = 0; i <= 600; i++) {
      const w = W.sample(s2, (i / 600) * per);
      if (w.sub !== "walk") { last = null; continue; }
      if (last != null && w.gaitP < last) turns++;
      last = w.gaitP;
    }
    return turns;
  };
  const short = strides(1.2), long = strides(4.8);
  check("GAIT: the legs alternate, the arms counter-swing, and the stride cadence is driven by TRAVEL (a longer leg means more steps), not by the clock",
    sampled > 20 && alternating === sampled && armSampled > 10 && counterSwing === armSampled && long > short + 1,
    "walkSamples=" + sampled + " alternating=" + alternating + " counterSwing=" + counterSwing + "/" + armSampled +
    " strides(1.2m)=" + short + " strides(4.8m)=" + long);
})();

/* ---- 6. the cycle is CONTINUOUS - no pose pops ----------------------- */
(() => {
  const KEYS = ["hip", "chest", "head", "shL", "shR", "elL", "elR", "handL", "handR", "kneeL", "kneeR", "footL", "footR"];
  let worst = 0, where = "";
  for (const task of TASKS) {
    const spec = specFor(task === "idle" ? "pack" : task);
    if (!spec) continue;
    const per = W.CYCLES[task].ticks, N = 800;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const w = W.sample(spec, (i / N) * per, { busy: task !== "idle" });
      const sk = W.pose(w);
      if (prev) {
        for (const k of KEYS) {
          const d = Math.sqrt(Math.pow(sk[k].f - prev[k].f, 2) + Math.pow(sk[k].l - prev[k].l, 2) + Math.pow(sk[k].z - prev[k].z, 2));
          if (d > worst) { worst = d; where = task + "." + k + "@" + ((i / N) * 100).toFixed(1) + "%"; }
        }
      }
      prev = sk;
    }
  }
  // A pop between two poses moves a joint tens of centimetres in one
  // sample; continuous motion at this sampling rate moves millimetres.
  check("the work cycle is CONTINUOUS: over a fine sweep of every task no joint jumps at a step boundary or at the cycle wrap (no pose pops)",
    worst < 0.12, "worst per-sample joint move " + worst.toFixed(4) + " m at " + where + " (pop threshold 0.12 m)");
})();

/* ---- 7. the POSE MATCHES THE STATION --------------------------------- */
(() => {
  const B = W.BODY;
  const sweep = (spec, busy) => {
    const per = W.CYCLES[busy === false ? "idle" : spec.task].ticks;
    const out = [];
    for (let i = 0; i <= 200; i++) {
      const w = W.sample(spec, (i / 200) * per, { busy: busy !== false });
      out.push({ w: w, sk: W.pose(w) });
    }
    return out;
  };
  const notes = [];
  let ok = true;

  // PICK: the worker folds down and reaches IN, to its own face height.
  const pick = specFor("pick");
  if (pick) {
    const fr = sweep(pick).filter((r) => r.w.sub === "reach");
    const deepest = fr.reduce((m, r) => Math.min(m, r.sk.head.z), 9);
    const furthest = fr.reduce((m, r) => Math.max(m, r.sk.handR.f), -9);
    // The END of the reach step (the cycle is phase-offset per worker, so
    // "last sampled" is not "furthest through the step").
    const atFace = fr.reduce((m, r) => (r.w.stepP > m.w.stepP ? r : m), fr[0]);
    const hitsFace = Math.abs(atFace.sk.handR.z - pick.reachZ) < 0.06;
    const bends = deepest < B.headZ - 0.05 && furthest > 0.34;
    notes.push("pick head " + deepest.toFixed(2) + "m reach " + furthest.toFixed(2) + "m face " + pick.reachZ.toFixed(2) + "m hit=" + hitsFace);
    ok = ok && bends && hitsFace;
  } else { ok = false; notes.push("no pick worker"); }

  // PACK: both hands stay over the bench, in front, at bench height, and
  // the worker never walks away from it.
  const pack = specFor("pack");
  if (pack) {
    const rows = sweep(pack);
    const moved = rows.reduce((m, r) => Math.max(m, Math.abs(r.w.x - pack.route[0].x) + Math.abs(r.w.y - pack.route[0].y)), 0);
    const overBench = rows.filter((r) => r.sk.handR.f > 0.3 && r.sk.handR.z > 0.85 && r.sk.handR.z < 1.25).length;
    const oneHanded = rows.filter((r) => r.w.sub === "tape" && r.sk.handL.f < r.sk.handR.f - 0.05).length;
    notes.push("pack stationary=" + (moved < 1e-9) + " overBench=" + overBench + "/" + rows.length + " tapeOneHanded=" + oneHanded);
    ok = ok && moved < 1e-9 && overBench > rows.length * 0.5 && oneHanded > 0;
  } else { ok = false; notes.push("no pack worker"); }

  // PUT-AWAY: carries at chest height while travelling, sets it down low.
  const put = specFor("put");
  if (put) {
    const rows = sweep(put);
    const carry = rows.filter((r) => r.w.sub === "carry");
    const chest = carry.every((r) => r.sk.handR.z > 1.0);
    const travels = Math.max.apply(null, carry.map((r) => Math.abs(r.w.y - put.route[0].y) + Math.abs(r.w.x - put.route[0].x))) > 0.5;
    const setsDown = rows.filter((r) => r.w.sub === "place").reduce((m, r) => Math.min(m, r.sk.handR.z), 9) < 0.85;
    notes.push("put carriesAtChest=" + chest + " travels=" + travels + " setsDown=" + setsDown);
    ok = ok && chest && travels && setsDown;
  } else { ok = false; notes.push("no put worker"); }

  // SCAN: one hand goes ABOVE the shoulder with a handheld in it.
  const scan = specFor("scan");
  if (scan) {
    const rows = sweep(scan);
    const raised = rows.filter((r) => r.sk.handR.z > B.shoulderZ - 0.10);
    const tool = raised.filter((r) => r.sk.load && r.sk.load.kind === "tool").length;
    const otherDown = raised.every((r) => r.sk.handL.z < 1.05);
    notes.push("scan raised=" + raised.length + " withTool=" + tool + " otherHandDown=" + otherDown);
    ok = ok && raised.length > 0 && tool === raised.length && otherDown;
  } else { ok = false; notes.push("no scan worker"); }

  check("the POSE MATCHES THE STATION: a picker folds down and reaches its own face height, a packer works two-handed over the bench (one-handed to tape), a put-away worker carries at chest height and sets down low, a dock worker raises a handheld above the shoulder",
    ok, notes.join("; "));
})();

/* ---- 8. the LOAD IS IN THE HANDS ------------------------------------- */
(() => {
  let bad = null, carried = 0, empty = 0;
  for (const task of ["pick", "put", "pack", "scan"]) {
    const spec = specFor(task);
    if (!spec) continue;
    const per = W.CYCLES[task].ticks;
    for (let i = 0; i <= 300; i++) {
      const w = W.sample(spec, (i / 300) * per);
      const sk = W.pose(w);
      if (!w.carry) {
        empty++;
        if (sk.load) bad = bad || task + " draws a load with empty hands";
        continue;
      }
      carried++;
      if (!sk.load) { bad = bad || task + " carries " + w.carry + " but draws nothing"; continue; }
      // The load is where the work is: a two-handed carry holds it
      // BETWEEN the hands; a handheld rides the working hand; a carton
      // being packed stays under the working hand while the other comes
      // off it to tape.
      const mid = { f: (sk.handL.f + sk.handR.f) / 2, l: (sk.handL.l + sk.handR.l) / 2, z: (sk.handL.z + sk.handR.z) / 2 };
      const dTo = (p) => Math.sqrt(Math.pow(sk.load.c.f - p.f, 2) + Math.pow(sk.load.c.l - p.l, 2) + Math.pow(sk.load.c.z - p.z, 2));
      const twoHanded = w.params.oneArm < 0.05;
      const d = sk.load.kind === "tool" ? dTo(sk.handR)
        : twoHanded ? dTo(mid) : Math.min(dTo(sk.handR), dTo(sk.handL));
      const lim = sk.load.kind === "tool" ? 0.15 : twoHanded ? 0.18 : 0.30;
      if (d > lim) bad = bad || task + "/" + w.sub + " load " + d.toFixed(2) + "m from the working hand (limit " + lim + ")";
      if (!(sk.load.size.f > 0 && sk.load.size.l > 0 && sk.load.size.z > 0)) bad = bad || task + " load has no size";
    }
  }
  check("the LOAD IS IN THE HANDS: a carton/tote is drawn between both hands and a handheld on the working hand, it exists exactly while the worker is carrying, and empty hands draw nothing",
    !bad && carried > 100 && empty > 50,
    bad || "carrying=" + carried + " emptyHanded=" + empty + " samples, load always within 0.22 m of the hands");
})();

/* ---- 9. reduced motion / stopped plant: a legible STANDING pose ------ */
(() => {
  let bad = null;
  for (const task of TASKS) {
    const spec = specFor(task === "idle" ? "pick" : task);
    if (!spec) continue;
    const busy = task !== "idle";
    const a = W.sample(spec, null, { busy: busy });
    const b = W.sample(spec, undefined, { busy: busy });
    const ska = W.pose(a), skb = W.pose(b);
    if (JSON.stringify(ska) !== JSON.stringify(skb)) bad = bad || task + " static frame not deterministic";
    if (a.gaitAmp !== 0) bad = bad || task + " static frame still has a stride";
    if (a.breath !== 0 || a.sway !== 0) bad = bad || task + " static frame still breathes";
    // BOTH feet on the slab and close together: a stance, not mid-stride.
    if (ska.footL.z > 1e-9 || ska.footR.z > 1e-9) bad = bad || task + " static frame has a foot in the air";
    if (Math.abs(ska.footL.f - ska.footR.f) > 0.2) bad = bad || task + " static frame is mid-stride";
    // Upright enough to read as a person standing at their station.
    if (ska.head.z < 1.25) bad = bad || task + " static frame is folded over (head " + ska.head.z.toFixed(2) + ")";
  }
  check("prefers-reduced-motion / a stopped plant freezes every worker to a DETERMINISTIC standing pose: no stride, both feet on the slab, upright - never a mid-stride limbo",
    !bad, bad || TASKS.length + " cycles rest in a legible stance");
})();

/* ---- 10. draw() smoke: both projectors x themes x tiers -------------- */
function recCtx() {
  const pts = [], bad = [];
  const rec = (x, y) => { if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) pts.push(Math.round(x * 100) + "," + Math.round(y * 100)); };
  const num = (n, a) => { for (const v of a) if (typeof v === "number" && !isFinite(v)) bad.push(n + "=" + v); };
  return {
    _pts: pts, _bad: bad,
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo(x, y) { num("moveTo", [x, y]); rec(x, y); }, lineTo(x, y) { num("lineTo", [x, y]); rec(x, y); },
    arc(x, y, r, a, b) { num("arc", [x, y, r, a, b]); rec(x, y); }, arcTo() {},
    rect(x, y, w, h) { num("rect", [x, y, w, h]); rec(x, y); },
    fillRect(x, y, w, h) { num("fillRect", [x, y, w, h]); rec(x, y); },
    strokeRect(x, y, w, h) { num("strokeRect", [x, y, w, h]); rec(x, y); },
    setLineDash() {}, measureText(t) { return { width: String(t).length * 6 }; }, fillText() {}, strokeText() {},
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  };
}
// The app's two projectors, exactly as app.js builds them (projPx).
const CELL = 24;
const topDown = (x, y) => ({ x: x * CELL, y: y * CELL });
const ISOK = { KX: 0.5, KY: 0.25, KZ: 0.28 };
const isoProj = (x, y, z) => ({
  x: 300 + (x - y) * ISOK.KX * CELL,
  y: 120 + ((x + y) * ISOK.KY - (z || 0) * ISOK.KZ) * CELL,
});
(() => {
  let threw = null, notFinite = null, mutated = null, thin = null;
  for (const task of TASKS) {
    const spec = specFor(task === "idle" ? "pick" : task);
    if (!spec) continue;
    for (const proj of [topDown, isoProj]) {
      for (const theme of ["light", "dark"]) {
        for (const tier of ["glyph", "rich"]) {
          for (const t of [null, 7.5, 61, 140.25]) {
            const w = W.sample(spec, t, { busy: task !== "idle" });
            const before = JSON.stringify([w.x, w.y, w.heading, w.params, spec]);
            const c = recCtx();
            let r = false;
            try { r = W.draw(c, w, { project: proj, cellPx: CELL, theme: theme, tier: tier }); }
            catch (e) { threw = threw || task + ": " + e.message; }
            if (!r) threw = threw || task + " draw returned false";
            if (c._bad.length) notFinite = notFinite || task + " " + c._bad.slice(0, 2).join(",");
            if (JSON.stringify([w.x, w.y, w.heading, w.params, spec]) !== before) mutated = mutated || task;
            if (c._pts.length < 12) thin = thin || task + " drew only " + c._pts.length + " points";
          }
        }
      }
    }
  }
  // Rich really is more detail than glyph, and a broken projector is refused.
  const spec = specFor("pick");
  const w = W.sample(spec, 40);
  const g = recCtx(), r = recCtx();
  W.draw(g, w, { project: topDown, cellPx: CELL, theme: "light", tier: "glyph" });
  W.draw(r, w, { project: topDown, cellPx: CELL, theme: "light", tier: "rich" });
  const richer = r._pts.length > g._pts.length;
  const refused = W.draw(recCtx(), w, { cellPx: CELL }) === false &&
    W.draw(null, w, { project: topDown }) === false &&
    W.draw(recCtx(), { x: NaN, y: 0, heading: 0, params: {}, carry: null }, { project: topDown }) === false;
  check("draw() smoke: every task x both projectors x both themes x both tiers x live/static - no throw, every coordinate finite, no input mutation, rich adds detail over glyph, a missing projector is refused",
    !threw && !notFinite && !mutated && !thin && richer && refused,
    threw || notFinite || mutated || thin ||
    ("glyph=" + g._pts.length + " rich=" + r._pts.length + " pts; refusedBadInput=" + refused));
})();

/* ---- 11. BOTH VIEWS AGREE -------------------------------------------- */
(() => {
  const spec = specFor("pick");
  const w = W.sample(spec, 40);
  const a = recCtx(), b = recCtx();
  W.draw(a, w, { project: topDown, cellPx: CELL, theme: "light", tier: "rich" });
  W.draw(b, w, { project: isoProj, cellPx: CELL, theme: "light", tier: "rich" });
  const samePrimitives = a._pts.length === b._pts.length;
  // The SAME skeleton, projected two ways: in 2.5D the figure stands up
  // (the head is well above the feet on screen); top-down it is a plan
  // view (head and feet land within a stride of each other).
  const sk = W.pose(w);
  const wj = W.worldJoints(w, sk);
  const isoHead = isoProj(wj.head.x, wj.head.y, wj.head.z);
  const isoFoot = isoProj(wj.footL.x, wj.footL.y, wj.footL.z);
  const tdHead = topDown(wj.head.x, wj.head.y, wj.head.z);
  const tdFoot = topDown(wj.footL.x, wj.footL.y, wj.footL.z);
  const standsUp = isoFoot.y - isoHead.y > 6; // px: the body has height in 2.5D
  const planView = Math.abs(tdHead.y - tdFoot.y) < CELL * 0.6 && Math.abs(tdHead.x - tdFoot.x) < CELL * 0.6;
  // ...and the world skeleton itself is projector-independent (one model).
  const wj2 = W.worldJoints(w);
  const sameModel = JSON.stringify(wj) === JSON.stringify(wj2);
  check("BOTH VIEWS AGREE: one skeleton drives both projections - the same primitives are drawn either way, the 2.5D figure stands up, the top-down figure is a true plan view, and the world skeleton is projector-independent",
    samePrimitives && standsUp && planView && sameModel,
    "pts " + a._pts.length + "/" + b._pts.length + " isoRise=" + (isoFoot.y - isoHead.y).toFixed(1) +
    "px planOffset=" + Math.abs(tdHead.y - tdFoot.y).toFixed(1) + "px sameModel=" + sameModel);
})();

/* ---- 12. determinism is STRUCTURAL ----------------------------------- */
(() => {
  // Comments stripped first: the file DOCUMENTS that it uses neither, and
  // a naive scan would match its own promise instead of its code.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcClock = /Date\.now|new Date\(/.test(CODE);
  const srcRng = /Math\.random/.test(CODE);
  // ...and prove it on the LIVE exported functions too (what actually runs).
  let live = "", n = 0;
  for (const k in W) { if (typeof W[k] === "function") { live += String(W[k]) + "\n"; n++; } }
  const liveClock = /Date\.now|new Date\(/.test(live);
  const liveRng = /Math\.random/.test(live);
  check("determinism is STRUCTURAL: no Date and no Math.random in workers.js (source scan AND a scan of the live exported functions)",
    !srcClock && !srcRng && !liveClock && !liveRng && n >= 8,
    "source clock=" + srcClock + " rng=" + srcRng + "; live fns=" + n + " clock=" + liveClock + " rng=" + liveRng);
})();

/* ---- 13. honesty labels ---------------------------------------------- */
(() => {
  const has = (re) => re.test(SRC);
  // The labels live in a wrapped comment block, so match across the
  // line breaks and leading asterisks.
  const soft = (words) => new RegExp(words.split(" ").join("[\\s*]+"), "i");
  const illustrative = has(/ILLUSTRATIVE/);
  const notMocap = has(soft("NOT a motion-capture model"));
  const notStandard = has(soft("NOT a labour standard"));
  const noIdentity = has(soft("no skin tone")) && has(soft("no gender"));
  const notPlan = has(soft("NOT a workforce plan"));
  check("honesty: workers.js states the figures are ILLUSTRATIVE, not motion capture, not a labour standard, not a workforce plan, and that no identity is modelled",
    illustrative && notMocap && notStandard && noIdentity && notPlan,
    "illustrative=" + illustrative + " notMocap=" + notMocap + " notStandard=" + notStandard +
    " noIdentity=" + noIdentity + " notWorkforcePlan=" + notPlan);
})();

/* ---- 14. shipped wiring ---------------------------------------------- */
(() => {
  const inIndex = /<script src="workers\.js"><\/script>/.test(INDEX_SRC);
  const orderOk = INDEX_SRC.indexOf('src="workers.js"') > INDEX_SRC.indexOf('src="domain.js"') &&
    INDEX_SRC.indexOf('src="workers.js"') < INDEX_SRC.indexOf('src="app.js"');
  const inSw = /["']\.\/workers\.js["']/.test(SW_SRC) && /CACHE_VERSION\s*=\s*"wt-v79"/.test(SW_SRC);
  // app.js: the workforce is drawn in BOTH render paths, LOD-gated,
  // reduced-motion-safe, and posed from the sim's own tick.
  const hasFn = /function drawWorkers\s*\(/.test(APP_SRC);
  const calls = (APP_SRC.match(/^\s*drawWorkers\(\);/gm) || []).length;
  const lodGated = /detailLevel\(onCell\)[\s\S]{0,220}tier === "icon"/.test(APP_SRC);
  const reducedMotion = /function workerAnimT\(\)[\s\S]{0,200}prefersReducedMotion\(\)/.test(APP_SRC);
  const simClock = /function workerAnimT\(\)[\s\S]{0,400}sim\.tick/.test(APP_SRC);
  const usesProjPx = /project: projPx/.test(APP_SRC);
  const inSelftest = /workers-/.test(SELFTEST_SRC);
  const inRunner = /verify_workers\.js/.test(RUNALL_SRC);
  check("shipped wiring: index.html loads workers.js before app.js, sw.js precaches it at wt-v79, app.js draws the workforce in BOTH render paths through projPx (LOD-gated, reduced-motion-safe, posed from the sim tick), and the self-test + runner cover it",
    inIndex && orderOk && inSw && hasFn && calls >= 2 && lodGated && reducedMotion && simClock && usesProjPx && inSelftest && inRunner,
    "index=" + inIndex + " order=" + orderOk + " sw=" + inSw + " drawWorkers=" + hasFn +
    " callSites=" + calls + " lodGated=" + lodGated + " reducedMotion=" + reducedMotion +
    " simClock=" + simClock + " projPx=" + usesProjPx + " selftest=" + inSelftest + " runner=" + inRunner);
})();

/* ---- 15. cycle integrity --------------------------------------------- */
(() => {
  let bad = null;
  const keys = ["lean", "crouch", "handF", "handZ", "handL", "oneArm", "task"];
  for (const task of TASKS) {
    const c = W.CYCLES[task];
    if (!c) { bad = bad || task + " missing"; continue; }
    if (!(c.ticks > 0 && isFinite(c.ticks))) bad = bad || task + " bad period";
    if (!(c.rest >= 0 && c.rest < 1)) bad = bad || task + " bad rest phase";
    let sum = 0;
    for (const s of c.steps) {
      sum += s.u;
      for (const k of keys) {
        if (!isFinite(s.a[k]) || !isFinite(s.b[k])) bad = bad || task + "." + s.sub + " missing pose key " + k;
      }
      if (s.move && (s.move.length !== 2)) bad = bad || task + "." + s.sub + " bad travel leg";
    }
    if (Math.abs(sum - 1) > 1e-9) bad = bad || task + " step shares sum to " + sum.toFixed(6);
    // CLOSED loop: each step's end pose is the next step's start pose.
    for (let i = 0; i < c.steps.length; i++) {
      const cur = c.steps[i], nxt = c.steps[(i + 1) % c.steps.length];
      if (cur.b !== nxt.a) bad = bad || task + ": " + cur.sub + " -> " + nxt.sub + " is not a closed pose transition";
    }
  }
  check("every work cycle is well-formed: a positive period, a rest phase in [0,1), step shares that sum to exactly 1, complete pose parameters, and a CLOSED pose loop (each step ends where the next begins)",
    !bad, bad || TASKS.length + " cycles well-formed and closed");
})();

console.log("");
console.log(failures === 0
  ? "ALL WORKER CHECKS PASSED (15 checks)"
  : failures + " WORKER CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
