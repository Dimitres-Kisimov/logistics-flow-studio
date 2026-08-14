/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * workers.js - the LIVING WORKFORCE layer (v3.22 "workers do their job").
 * ---------------------------------------------------------------------
 * Until v3.21 a "worker" was a head disc and a shoulder bar bolted onto
 * the furniture of a pack bench: it could bob, but it could not WORK. A
 * warehouse is people moving goods, so this module gives the plant an
 * actual workforce - figures that WALK with a real gait, BEND and REACH
 * into a pick face, straighten with a carton IN THEIR HANDS, carry it,
 * PLACE it, work a pack bench, and scan at a dock door.
 *
 * WHAT THIS IS (honesty, load-bearing and mirrored in the UI/README):
 *   - An ILLUSTRATIVE, SCHEMATIC animation of warehouse work. NOT a
 *     motion-capture model, NOT ergonomics/biomechanics, NOT a labour
 *     standard, NOT a measurement of anyone's real workload, and NOT a
 *     claim about staffing levels. The figures are anonymous schematic
 *     forms - no skin tone, no gender, no identity is modelled (the head
 *     is a neutral tone under a helmet).
 *   - The roster is a HEURISTIC: one worker per manned element (pick
 *     face, pack/processing bench, staging pad, dock door), capped for
 *     performance. It is NOT a workforce plan and the count is not a
 *     recommendation.
 *   - Cycle timings are ANIMATION values tuned for the eye, NOT time
 *     studies. Nothing here feeds a KPI, a cost or a report.
 *
 * DETERMINISM (structural, not incidental):
 *   Every value below is a PURE function of (element identity, animation
 *   phase). There is NO Date, NO Math.random anywhere in this file - the
 *   phase comes from the caller (the flow sim's own tick, the same clock
 *   WT.shapes.equipmentPhase uses), so the workforce is reproducible,
 *   pauses exactly when the sim pauses, and freezes to a legible STANDING
 *   pose (never a mid-stride limbo) when the caller passes no phase at
 *   all - which is what `prefers-reduced-motion` does.
 *
 * ONE SKELETON, BOTH VIEWS. `pose()` returns joints in a BODY frame
 * (forward / lateral / up, in metres); `worldJoints()` places them on the
 * floor; `draw()` renders them through a caller-supplied
 * `project(worldX, worldY, heightM)`. The top-down editor hands in its
 * plain world->px mapping and the 2.5D view hands in the iso projection,
 * so a worker doing a pick is THE SAME skeleton in both - they cannot
 * disagree by construction.
 *
 * PURE + SELF-CONTAINED: no DOM outside the passed canvas ctx, no module
 * state between calls, no mutation of any input, no external asset.
 * Headlessly verified by verify_workers.js; drawn live in the browser.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Optional dependency on domain.js (WT.domain) purely to
 * read element defs; falls back to a local type table when absent.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const TAU = Math.PI * 2;

  /* ==================================================================
   * PPE / MATERIAL VOCABULARY. Real site colours, mirroring the shapes.js
   * MATERIALS names so a carton in a worker's hands is the same kraft as
   * a carton on a rack. Hi-vis is a genuine yellow-green; it is always
   * drawn with a near-black outline, which is what actually makes a small
   * figure legible against both the daylit slab and the night shift.
   * ================================================================== */
  const PPE = {
    vest:     { light: "#c6d62b", dark: "#d8e83c" }, // hi-vis yellow-green (EN ISO 20471 family)
    vestSide: { light: "#9aa61f", dark: "#a9b82c" }, // the vest's shaded faces
    sleeve:   { light: "#4a5560", dark: "#5a6672" }, // work shirt: the arms must read AGAINST the vest
    band:     { light: "#eceadf", dark: "#f4f1e6" }, // retroreflective band
    trouser:  { light: "#3b4048", dark: "#474d57" }, // work trousers
    boot:     { light: "#24221d", dark: "#2c2924" }, // safety boots
    head:     { light: "#9a8f80", dark: "#a89c8c" }, // NEUTRAL - no skin tone is modelled
    helmet:   { light: "#e6e1d4", dark: "#efeade" }, // hard hat
    ink:      { light: "#211f1a", dark: "#141210" }, // outline that makes the figure read
    carton:   { light: "#a8763f", dark: "#96683a" }, // kraft board (= shapes MATERIALS.kraft)
    cartonTop:{ light: "#c08a4d", dark: "#a87848" }, // the lid catching the light
    tote:     { light: "#1f6fb2", dark: "#3d8fd1" }, // moulded plastic tote
    tool:     { light: "#2b2f36", dark: "#3a3f47" }, // handheld scanner
    shadow:   { light: "rgba(28,24,19,0.20)", dark: "rgba(0,0,0,0.28)" },
  };
  function ppe(name, theme) {
    const m = PPE[name];
    if (!m) return "#888888";
    return theme === "dark" ? m.dark : m.light;
  }

  /* ==================================================================
   * BODY MODEL (metres). One grid cell = one metre (domain
   * METRES_PER_CELL = 1), so these numbers are world units directly.
   * A 1.75 m figure: the proportions are ordinary adult averages used as
   * DRAWING constants - illustrative, not anthropometric data.
   * ================================================================== */
  const BODY = {
    hipZ: 0.95,          // hip joint height
    shoulderZ: 1.44,     // shoulder height
    headZ: 1.62,         // head centre
    headR: 0.115,        // head radius
    helmetR: 0.135,      // hard hat radius
    shoulderHalf: 0.20,  // half the shoulder width
    hipHalf: 0.145,
    torsoDepth: 0.26,    // chest depth (what you see from directly above)
    upperArm: 0.30,
    foreArm: 0.29,
    thigh: 0.46,
    shin: 0.47,
    stride: 0.72,        // metres of travel per full gait cycle
    strideHalf: 0.33,    // fore/aft foot excursion at full amplitude
    footLift: 0.10,      // how high the swinging foot clears the slab
    footHalf: 0.09,      // half the stance width
    armSwing: 0.26,      // hand fore/aft excursion at full amplitude
    height: 1.75,
  };

  /* ------------------------------------------------------------------
   * POSE PARAMETERS. Every pose in the app is one of these seven
   * parameter sets (or an interpolation between two of them), so a pose
   * is data, not a special-cased drawing routine:
   *   lean    - forward torso lean, radians
   *   crouch  - how far the hips drop (a squat), metres
   *   handF   - how far the hands are in FRONT of the body, metres
   *   handZ   - hand height, metres
   *   handL   - half the distance between the hands, metres
   *   oneArm  - 0 = both hands on the task, 1 = only the right hand
   *   task    - 0 = hands hang and swing with the walk, 1 = hands are on
   *             the task at (handF, handZ). Interpolated like every other
   *             parameter, so an arm NEVER pops between the two.
   * ------------------------------------------------------------------ */
  const P = {
    // Standing/walking, hands empty and swinging at the sides.
    stand: { lean: 0.10, crouch: 0.00, handF: 0.02, handZ: 0.86, handL: 0.24, oneArm: 0, task: 0 },
    // Deep bend into a low pick face: hips drop, torso folds, arms reach in.
    bend:  { lean: 0.92, crouch: 0.24, handF: 0.52, handZ: 0.62, handL: 0.15, oneArm: 0, task: 1 },
    // Carrying a carton at chest height, both hands under it.
    hold:  { lean: 0.08, crouch: 0.00, handF: 0.30, handZ: 1.08, handL: 0.16, oneArm: 0, task: 1 },
    // Setting the carton down / into a rack level.
    place: { lean: 0.62, crouch: 0.14, handF: 0.50, handZ: 0.78, handL: 0.16, oneArm: 0, task: 1 },
    // Hands working over a bench (folding flaps, filling a carton).
    bench: { lean: 0.34, crouch: 0.02, handF: 0.42, handZ: 1.00, handL: 0.18, oneArm: 0, task: 1 },
    // One arm sweeping a tape gun across the carton.
    tape:  { lean: 0.30, crouch: 0.01, handF: 0.50, handZ: 1.04, handL: 0.20, oneArm: 1, task: 1 },
    // Pushing the finished parcel away down the takeaway side.
    push:  { lean: 0.26, crouch: 0.00, handF: 0.56, handZ: 0.98, handL: 0.18, oneArm: 0, task: 1 },
    // Handheld scanner raised to a label.
    scan:  { lean: 0.04, crouch: 0.00, handF: 0.34, handZ: 1.40, handL: 0.20, oneArm: 1, task: 1 },
    // At rest: upright, hands down. The subtle weight shift is added by
    // the sway/breath terms, so this is never a frozen mannequin.
    idle:  { lean: 0.05, crouch: 0.00, handF: -0.02, handZ: 0.88, handL: 0.25, oneArm: 0, task: 0 },
  };
  const POSE_KEYS = ["lean", "crouch", "handF", "handZ", "handL", "oneArm", "task"];

  /* ------------------------------------------------------------------
   * WORK CYCLES. A cycle is a loop of steps; each step owns a share `u`
   * of the cycle (the shares sum to 1), a pose to interpolate FROM and
   * TO, and either a travel leg (`move: [fromRoutePoint, toRoutePoint]`)
   * or a fixed stand point (`at`). `load` says what is in the hands:
   * "none", "hands", or a threshold ("from"/"to" within the step) so the
   * carton is picked up and put down at the right instant.
   *
   * `ticks` is the cycle length in SIM TICKS (the flow sim's own clock);
   * `rest` is the phase the cycle freezes at for a static frame - chosen
   * per task so a stopped plant shows a person STANDING at their station,
   * never a leg-in-the-air freeze.
   *
   * Every cycle is CLOSED: each step's `b` pose is the next step's `a`,
   * and the last wraps back to the first, so a worker never pops between
   * two poses - verified over a fine sweep in verify_workers.js.
   * ------------------------------------------------------------------ */
  const CYCLES = {
    // Order picking: walk to the face, bend in, lift the carton out,
    // carry it back to the cart, set it down, straighten up. The job.
    pick: {
      ticks: 168, rest: 0.60,
      steps: [
        { sub: "walk",  u: 0.26, move: [0, 1], a: P.stand, b: P.stand, load: "none" },
        { sub: "reach", u: 0.17, at: 1, a: P.stand, b: P.bend, load: "none", bZ: "reach" },
        { sub: "lift",  u: 0.11, at: 1, a: P.bend, b: P.hold, load: "from", loadAt: 0.25, aZ: "reach" },
        { sub: "carry", u: 0.26, move: [1, 0], a: P.hold, b: P.hold, load: "hands" },
        { sub: "place", u: 0.12, at: 0, a: P.hold, b: P.place, load: "to", loadAt: 0.75 },
        { sub: "up",    u: 0.08, at: 0, a: P.place, b: P.stand, load: "none" },
      ],
    },
    // Packing: draw the goods in, work over the bench, tape the carton,
    // push the finished parcel away - then reach out for the next one.
    pack: {
      ticks: 126, rest: 0.42,
      steps: [
        { sub: "draw", u: 0.22, at: 0, a: P.push, b: P.bench, load: "none" },
        { sub: "fold", u: 0.34, at: 0, a: P.bench, b: P.bench, load: "bench", work: 1 },
        { sub: "tape", u: 0.24, at: 0, a: P.bench, b: P.tape, load: "bench" },
        { sub: "push", u: 0.20, at: 0, a: P.tape, b: P.push, load: "bench" },
      ],
    },
    // Put-away / staging: carry a carton in, set it down, straighten,
    // walk back empty, take up the next one.
    put: {
      ticks: 186, rest: 0.30,
      steps: [
        { sub: "carry", u: 0.28, move: [0, 1], a: P.hold, b: P.hold, load: "hands" },
        { sub: "place", u: 0.18, at: 1, a: P.hold, b: P.place, load: "to", loadAt: 0.70 },
        { sub: "up",    u: 0.08, at: 1, a: P.place, b: P.stand, load: "none" },
        { sub: "walk",  u: 0.28, move: [1, 0], a: P.stand, b: P.stand, load: "none" },
        { sub: "take",  u: 0.18, at: 0, a: P.stand, b: P.hold, load: "from", loadAt: 0.55 },
      ],
    },
    // Dock check: step up to the door, raise the handheld, scan, step back.
    scan: {
      ticks: 144, rest: 0.46,
      steps: [
        { sub: "walk", u: 0.24, move: [0, 1], a: P.stand, b: P.stand, load: "none" },
        { sub: "scan", u: 0.20, at: 1, a: P.stand, b: P.scan, load: "tool" },
        { sub: "read", u: 0.22, at: 1, a: P.scan, b: P.scan, load: "tool", work: 1 },
        { sub: "drop", u: 0.12, at: 1, a: P.scan, b: P.stand, load: "tool" },
        { sub: "back", u: 0.22, move: [1, 0], a: P.stand, b: P.stand, load: "none" },
      ],
    },
    // Nothing to do (a starved station): stand, shift weight, look around.
    idle: {
      ticks: 210, rest: 0.5,
      steps: [
        { sub: "idle", u: 1, at: 0, a: P.idle, b: P.idle, load: "none", sway: 1 },
      ],
    },
  };
  const TASKS = ["pick", "pack", "put", "scan", "idle"];

  // A worker's small, slow "alive" signal: breathing / weight shift. In
  // ticks, deliberately not a divisor of any cycle so the plant never
  // pulses in unison.
  const BREATH_TICKS = 97;
  // Never staff more than this many elements (performance guard on a huge
  // hall). Not a staffing recommendation - a drawing cap.
  const MAX_WORKERS = 64;
  // How far off the element face a worker stands, and how far back the
  // cart / staging point sits (metres).
  const STANDOFF = 0.55;
  const CART_BACK = 1.65;

  /* ==================================================================
   * PURE MATH HELPERS. All finite for any finite input.
   * ================================================================== */
  function frac(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    const x = n % 1;
    return x < 0 ? x + 1 : x;
  }
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Smoothstep: eases a travel leg in and out, so a worker accelerates
  // away and slows as they arrive instead of teleport-starting.
  function ease(t) { const x = clampN(t, 0, 1); return x * x * (3 - 2 * x); }
  // The DERIVATIVE of that ease, normalised to peak 1: the leg's speed
  // profile. Drives the gait amplitude, so the feet come together as the
  // worker stops - which is what removes every mid-stride discontinuity.
  function easeSpeed(t) { const x = clampN(t, 0, 1); return 4 * x * (1 - x); }

  // Deterministic hash of two integers -> [0,1). Same shape as the app's
  // per-element animation seed. No Date, no RNG.
  function hash01(a, b) {
    let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663);
    h = h & 0x7fffffff;
    return (h % 100003) / 100003;
  }
  function strCode(s) {
    let h = 0;
    const str = String(s == null ? "" : s);
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
  }

  /* ------------------------------------------------------------------
   * TWO-LINK IK. Places an elbow (or knee) between a shoulder (hip) and
   * a hand (foot) so limbs BEND instead of being straight sticks. When
   * the target is out of reach the limb is clamped to almost-straight
   * rather than producing a NaN - so every joint is finite for every
   * input, which is exactly what the harness asserts.
   * `bulge` is the direction the joint should bow toward (elbows back,
   * knees forward); its component along the limb is removed.
   * ------------------------------------------------------------------ */
  function ik(a, b, l1, l2, bulge) {
    let dx = b.f - a.f, dy = b.l - a.l, dz = b.z - a.z;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxD = (l1 + l2) * 0.995;
    if (d > maxD) { const k = maxD / d; dx *= k; dy *= k; dz *= k; d = maxD; }
    if (!(d > 1e-6)) { d = 1e-6; dz = -1e-6; }
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const m = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - m * m));
    let px = bulge.f, py = bulge.l, pz = bulge.z;
    const dot = px * ux + py * uy + pz * uz;
    px -= dot * ux; py -= dot * uy; pz -= dot * uz;
    let pl = Math.sqrt(px * px + py * py + pz * pz);
    if (!(pl > 1e-6)) { px = -uz; py = 0; pz = ux; pl = Math.sqrt(px * px + pz * pz) || 1; }
    px /= pl; py /= pl; pz /= pl;
    return { f: a.f + ux * m + px * h, l: a.l + uy * m + py * h, z: a.z + uz * m + pz * h };
  }

  /* ==================================================================
   * ROSTER: which elements are MANNED, and where the worker stands.
   * A pure function of the layout - same floor, same workforce, every
   * run and every machine.
   * ================================================================== */
  function defOf(type) {
    const els = WT.domain && WT.domain.ELEMENTS;
    return (els && els[type]) || null;
  }
  function baseOf(type) {
    const def = defOf(type);
    return def && typeof def.base === "string" ? def.base : null;
  }

  // Which job an element type is worked as - null = nobody is stationed
  // there. Mirrors the flow sim's own station classes (flowsim.js: pick
  // faces, staging = put-away, pack/processing benches) so the people and
  // the material flow are talking about the same stations.
  function taskForType(type) {
    const def = defOf(type);
    if (type === "staging") return "put";
    if (type === "pack-station" || type === "returns-station" ||
        type === "push-station" || type === "pull-station") return "pack";
    if (type === "dock-in" || type === "dock-out" || type === "gate") return "scan";
    if (def && (def.pickFace || def.goodsToPerson)) return "pick";
    if (type === "pallet-flow" || type === "carton-flow" || type === "pick-to-light") return "pick";
    const b = baseOf(type);
    if (b === "station") return "pack";     // custom + manufacturing benches
    if (b === "dock") return "scan";        // custom + manufacturing source/drain
    return null;
  }

  // The side of an element its worker stands on: the face that looks
  // toward the middle of the hall (that is where the aisle is on a normal
  // layout). Returns a unit vector along one axis - deterministic.
  function frontDir(el, gridW, gridH) {
    const cx = el.x + el.w / 2, cy = el.y + el.d / 2;
    if ((el.w || 1) >= (el.d || 1)) return { x: 0, y: cy < gridH / 2 ? 1 : -1 };
    return { x: cx < gridW / 2 ? 1 : -1, y: 0 };
  }

  // Does a world point fall inside some OTHER element's footprint? Used to
  // keep a worker off the conveyor (or inside a rack) - they belong in the
  // aisle. Deterministic, and a strict no-op when nothing is in the way.
  function blocked(els, px, py, skip) {
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (!e || e === skip) continue;
      const w = Math.max(1, e.w || 1), d = Math.max(1, e.d || 1);
      if (px > e.x - 0.02 && px < e.x + w + 0.02 && py > e.y - 0.02 && py < e.y + d + 0.02) return true;
    }
    return false;
  }

  function roster(layout, opts) {
    const o = opts || {};
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, (layout && layout.gridW) || 40);
    const gridH = Math.max(1, (layout && layout.gridH) || 24);
    const cap = Math.max(0, o.max != null ? (o.max | 0) : MAX_WORKERS);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (!e || !e.type) continue;
      const task = taskForType(e.type);
      if (!task) continue;
      const w = Math.max(1, e.w || 1), d = Math.max(1, e.d || 1);
      const cx = e.x + w / 2, cy = e.y + d / 2;
      let fd = frontDir({ x: e.x, y: e.y, w: w, d: d }, gridW, gridH);
      // Half the footprint measured along the facing axis.
      const half = fd.y !== 0 ? d / 2 : w / 2;
      // Stand somewhere along the element's long side (deterministic, so
      // a row of pick faces is not a chorus line of identical stances).
      const along = fd.y !== 0 ? w : d;
      const seed = ((e.x | 0) * 73856093) ^ ((e.y | 0) * 19349663) ^ strCode(e.type);
      const lat = (hash01(seed, 17) - 0.5) * Math.max(0, along - 0.9);
      const standPt = (dir) => ({
        x: dir.y !== 0 ? cx + lat : cx + dir.x * (half + STANDOFF),
        y: dir.y !== 0 ? cy + dir.y * (half + STANDOFF) : cy + lat,
      });
      // A worker stands in the AISLE, not on the conveyor: if the hall-side
      // face is blocked by another element, work the opposite face instead.
      let sp = standPt(fd);
      if (blocked(els, sp.x, sp.y, e)) {
        const flip = { x: -fd.x, y: -fd.y };
        const alt = standPt(flip);
        if (!blocked(els, alt.x, alt.y, e)) { fd = flip; sp = alt; }
      }
      const ax = sp.x, ay = sp.y;
      // Route point 0 = the cart / aisle position; point 1 = the working
      // position hard against the element face. A walking worker needs room
      // behind them - shorten the leg rather than walk through a rack.
      const p1 = { x: clampN(ax, 0.4, gridW - 0.4), y: clampN(ay, 0.4, gridH - 0.4) };
      let back = task === "pack" ? 0 : CART_BACK;
      if (back > 0) {
        const backs = [CART_BACK, 1.15, 0.8];
        for (let b = 0; b < backs.length; b++) {
          back = backs[b];
          if (!blocked(els, ax + fd.x * back, ay + fd.y * back, e)) break;
        }
      }
      const p0 = {
        x: clampN(ax + fd.x * back, 0.4, gridW - 0.4),
        y: clampN(ay + fd.y * back, 0.4, gridH - 0.4),
      };
      // The direction the worker looks while working: into the element.
      const facing = Math.atan2(-fd.y, -fd.x);
      out.push({
        id: "w-" + e.type + "-" + (e.x | 0) + "-" + (e.y | 0) + "-" + i,
        task: task,
        type: e.type,
        seed: seed,
        phase: hash01(seed, 3),          // stable per-worker cycle offset
        // The height this worker's pick face is at (metres): a row of
        // faces is not all one shelf level, so the reach varies - stable
        // per element, so the same face is always picked at the same level.
        reachZ: 0.52 + hash01(seed, 29) * 0.66,
        route: [p0, p1],
        facing: facing,
        anchor: { x: cx, y: cy },        // the element centre (= the flow sim's station anchor)
        load: task === "pick" || task === "put" ? "carton"
          : task === "pack" ? "parcel" : "none",
        scale: 1,
      });
    }
    // Deterministic order + a hard cap so a huge hall cannot melt the
    // frame budget. Front-to-back so the staffed elements are spread.
    out.sort(function (a, b) {
      const ka = a.route[1].x + a.route[1].y, kb = b.route[1].x + b.route[1].y;
      if (ka !== kb) return ka - kb;
      if (a.route[1].x !== b.route[1].x) return a.route[1].x - b.route[1].x;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return cap && out.length > cap ? out.slice(0, cap) : out;
  }

  /* ==================================================================
   * SAMPLE: where a worker is and what they are doing at animation time
   * `t` (sim ticks). `t == null` (or non-finite) is the STATIC FRAME -
   * what `prefers-reduced-motion` and a stopped plant get: the cycle's
   * `rest` phase, which is a person standing at their station.
   * ================================================================== */
  function sample(spec, t, opts) {
    const o = opts || {};
    const busy = o.busy == null ? true : !!o.busy;
    const live = typeof t === "number" && isFinite(t);
    const task = busy ? (CYCLES[spec.task] ? spec.task : "idle") : "idle";
    const cyc = CYCLES[task];
    const speed = isFinite(o.speed) && o.speed > 0 ? o.speed : 1;
    const p = live ? frac(t / (cyc.ticks / speed) + spec.phase) : cyc.rest;

    // Locate the step this phase falls in (steps are ordered, shares sum
    // to 1; the last step absorbs any floating-point remainder).
    let acc = 0, step = cyc.steps[cyc.steps.length - 1], sp = 1;
    for (let i = 0; i < cyc.steps.length; i++) {
      const s = cyc.steps[i];
      if (p < acc + s.u || i === cyc.steps.length - 1) {
        step = s;
        sp = s.u > 0 ? clampN((p - acc) / s.u, 0, 1) : 0;
        break;
      }
      acc += s.u;
    }

    // ---- position + heading -----------------------------------------
    const r0 = spec.route[0], r1 = spec.route[1];
    let x, y, heading, legLen = 0, travelled = 0, gaitAmp = 0;
    if (step.move) {
      const a = spec.route[step.move[0]] || r0, b = spec.route[step.move[1]] || r1;
      const dx = b.x - a.x, dy = b.y - a.y;
      legLen = Math.sqrt(dx * dx + dy * dy);
      const u = live ? ease(sp) : 0;
      travelled = legLen * u;
      x = a.x + dx * u;
      y = a.y + dy * u;
      heading = legLen > 1e-6 ? Math.atan2(dy, dx) : spec.facing;
      // Gait amplitude follows the leg's SPEED, so the stride grows out of
      // a standing start and shrinks back to a stance on arrival.
      gaitAmp = live ? easeSpeed(sp) * clampN(legLen / 1.2, 0, 1) : 0;
    } else {
      const at = spec.route[step.at != null ? step.at : 0] || r0;
      x = at.x; y = at.y;
      heading = spec.facing;
    }

    // Gait phase from TRAVEL, not from the clock: a worker crossing a
    // longer leg in the same time takes more steps, exactly as a person
    // does. (BODY.stride metres per full cycle.)
    const gaitP = frac(travelled / BODY.stride + spec.phase);

    // ---- pose parameters --------------------------------------------
    const e = ease(clampN(sp, 0, 1));
    const params = {};
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const k = POSE_KEYS[i];
      params[k] = lerp(step.a[k], step.b[k], e);
    }
    // A step endpoint flagged "reach" takes the worker's OWN pick-face
    // height instead of the table's generic one, so a rack row is picked
    // at several levels rather than all at one shelf.
    const rz = isFinite(spec.reachZ) ? spec.reachZ : null;
    if (rz != null && (step.aZ === "reach" || step.bZ === "reach")) {
      params.handZ = lerp(step.aZ === "reach" ? rz : step.a.handZ,
        step.bZ === "reach" ? rz : step.b.handZ, e);
      // ...and the BODY follows the hands: a floor-level face is a deep
      // bend with the knees in it, a chest-level face is barely a lean.
      // (Drawing a full fold at a chest-height face is the single thing
      // that makes a schematic picker look wrong.)
      const k = 0.32 + 0.68 * clampN((0.98 - rz) / 0.5, 0, 1);
      params.lean = lerp(step.aZ === "reach" ? step.a.lean * k : step.a.lean,
        step.bZ === "reach" ? step.b.lean * k : step.b.lean, e);
      params.crouch = lerp(step.aZ === "reach" ? step.a.crouch * k : step.a.crouch,
        step.bZ === "reach" ? step.b.crouch * k : step.b.crouch, e);
    }
    params.gait = gaitAmp;

    // A small always-on "alive" signal for a stationary worker: weight
    // shift + breath. Zero on the static frame (reduced motion).
    const breathP = live ? frac(t / BREATH_TICKS + spec.phase) : 0;
    const breath = live ? Math.sin(breathP * TAU) : 0;
    const sway = live ? (step.sway ? 1 : 0.35) * breath : 0;
    // The bench/scan "working" steps get a faster hand oscillation - the
    // small repeated motion of folding a flap or reading a label. It fades
    // in and out INSIDE the step (sin(pi*sp)), so it can never pop at a
    // step boundary.
    const workP = live ? frac(t / (cyc.ticks * 0.16) + spec.phase) : 0;
    const work = live && step.work ? Math.sin(workP * TAU) * Math.sin(Math.PI * sp) : 0;

    // ---- what is in the hands ---------------------------------------
    let carry = null;
    if (step.load === "hands") carry = spec.load === "none" ? "carton" : spec.load;
    else if (step.load === "from") carry = sp >= (step.loadAt || 0.5) ? (spec.load === "none" ? "carton" : spec.load) : null;
    else if (step.load === "to") carry = sp < (step.loadAt || 0.5) ? (spec.load === "none" ? "carton" : spec.load) : null;
    else if (step.load === "tool") carry = "tool";
    // "bench" = the work sits ON the bench in front of them, in their
    // hands' reach but not lifted: drawn at the hands, resting.
    else if (step.load === "bench") carry = "parcel";

    return {
      id: spec.id,
      spec: spec,
      task: task,
      sub: step.sub,
      x: x, y: y, heading: heading,
      cycleP: p, stepP: sp,
      gaitP: gaitP, gaitAmp: gaitAmp,
      travelled: travelled, legLen: legLen,
      params: params,
      breath: breath, sway: sway, work: work,
      carry: carry,
      resting: !live,
      scale: isFinite(spec.scale) && spec.scale > 0 ? spec.scale : 1,
    };
  }

  /* ==================================================================
   * POSE: the SKELETON, in the worker's own body frame.
   *   f = metres in FRONT of the worker, l = metres to their LEFT(-)/
   *   RIGHT(+), z = metres above the slab.
   * A pure function of the sample - no clock, no RNG, no state.
   * ================================================================== */
  function pose(w) {
    const pr = w.params;
    const th = w.gaitP * TAU;
    const amp = clampN(pr.gait, 0, 1);
    const sway = w.sway || 0;

    // ---- legs --------------------------------------------------------
    // The weight shift + breath: small, always on, and exactly zero on a
    // static frame - a standing worker is alive, never a mannequin.
    const hipZ = BODY.hipZ - pr.crouch + (w.breath || 0) * 0.012;
    const hip = { f: 0, l: sway * 0.035, z: hipZ };
    const stanceF = 0.04, stanceL = BODY.footHalf;
    const footL = {
      f: -stanceF + amp * BODY.strideHalf * Math.sin(th),
      l: -stanceL,
      z: amp * BODY.footLift * Math.max(0, Math.cos(th)),
    };
    const footR = {
      f: stanceF + amp * BODY.strideHalf * Math.sin(th + Math.PI),
      l: stanceL,
      z: amp * BODY.footLift * Math.max(0, Math.cos(th + Math.PI)),
    };
    const hipL = { f: hip.f, l: hip.l - BODY.hipHalf, z: hip.z };
    const hipR = { f: hip.f, l: hip.l + BODY.hipHalf, z: hip.z };
    const kneeBulge = { f: 1, l: 0, z: 0.15 };
    const kneeL = ik(hipL, footL, BODY.thigh, BODY.shin, kneeBulge);
    const kneeR = ik(hipR, footR, BODY.thigh, BODY.shin, kneeBulge);

    // ---- torso / head ------------------------------------------------
    const torsoLen = BODY.shoulderZ - BODY.hipZ;
    const leanA = pr.lean + sway * 0.03;
    const sinL = Math.sin(leanA), cosL = Math.cos(leanA);
    const neck = { f: hip.f + sinL * torsoLen, l: hip.l, z: hip.z + cosL * torsoLen };
    const chest = { f: hip.f + sinL * torsoLen * 0.6, l: hip.l, z: hip.z + cosL * torsoLen * 0.6 };
    // The head stays more upright than the torso (you look where you work).
    const headLean = leanA * 0.45;
    const head = {
      f: neck.f + Math.sin(headLean) * 0.17,
      l: neck.l,
      z: neck.z + Math.cos(headLean) * 0.17,
    };
    const shL = { f: neck.f, l: neck.l - BODY.shoulderHalf, z: neck.z };
    const shR = { f: neck.f, l: neck.l + BODY.shoulderHalf, z: neck.z };

    // ---- arms --------------------------------------------------------
    // Two hand positions per side - hanging at the side (swinging COUNTER
    // to the legs: left hand forward when the RIGHT foot is forward) and
    // on the task - blended by the pose's own `task` weight. Because the
    // weight is interpolated with everything else, an arm travels between
    // the two; it never pops. `oneArm` blends the left hand back to the
    // side for the single-handed jobs (taping, scanning).
    const swing = amp * BODY.armSwing;
    const workOff = (w.work || 0) * 0.045;
    const tw = clampN(pr.task, 0, 1);
    const restZ = BODY.hipZ - 0.06 + (w.breath || 0) * 0.010;
    const restL = { f: 0.02 - swing * Math.sin(th), l: -0.245, z: restZ };
    const restR = { f: 0.02 + swing * Math.sin(th), l: 0.245, z: restZ };
    const taskL = { f: pr.handF + workOff, l: -pr.handL, z: pr.handZ + workOff * 0.5 };
    const taskR = { f: pr.handF + workOff, l: pr.handL, z: pr.handZ + workOff * 0.5 };
    const mixL = {
      f: lerp(taskL.f, restL.f, clampN(pr.oneArm, 0, 1)),
      l: lerp(taskL.l, restL.l, clampN(pr.oneArm, 0, 1)),
      z: lerp(taskL.z, restL.z, clampN(pr.oneArm, 0, 1)),
    };
    const handL = { f: lerp(restL.f, mixL.f, tw), l: lerp(restL.l, mixL.l, tw), z: lerp(restL.z, mixL.z, tw) };
    const handR = { f: lerp(restR.f, taskR.f, tw), l: lerp(restR.l, taskR.l, tw), z: lerp(restR.z, taskR.z, tw) };
    const elbowBulge = { f: -1, l: 0, z: -0.4 };
    const elL = ik(shL, handL, BODY.upperArm, BODY.foreArm, elbowBulge);
    const elR = ik(shR, handR, BODY.upperArm, BODY.foreArm, elbowBulge);

    // ---- the load, IN THE HANDS -------------------------------------
    let load = null;
    if (w.carry) {
      const mid = { f: (handL.f + handR.f) / 2, l: (handL.l + handR.l) / 2, z: (handL.z + handR.z) / 2 };
      if (w.carry === "tool") {
        load = { kind: "tool", c: { f: handR.f + 0.05, l: handR.l, z: handR.z + 0.02 },
          size: { f: 0.10, l: 0.07, z: 0.16 } };
      } else if (w.carry === "parcel") {
        // Worked ON the bench: it sits where the WORK is, not where the
        // hands are, so a taping hand can sweep across a carton that
        // stays put.
        load = { kind: "carton", c: { f: pr.handF + 0.06, l: 0, z: pr.handZ - 0.04 },
          size: { f: 0.32, l: 0.34, z: 0.24 } };
      } else if (w.carry === "tote") {
        load = { kind: "tote", c: { f: mid.f + 0.05, l: mid.l, z: mid.z + 0.03 },
          size: { f: 0.30, l: 0.40, z: 0.22 } };
      } else {
        load = { kind: "carton", c: { f: mid.f + 0.06, l: mid.l, z: mid.z + 0.06 },
          size: { f: 0.30, l: 0.34, z: 0.28 } };
      }
    }

    return {
      hip: hip, hipL: hipL, hipR: hipR, chest: chest, neck: neck, head: head,
      shL: shL, shR: shR, elL: elL, elR: elR, handL: handL, handR: handR,
      kneeL: kneeL, kneeR: kneeR, footL: footL, footR: footR,
      load: load,
      // Torso box (what you actually SEE - from above it is the
      // shoulders, from the side it is the vest).
      torso: {
        c: { f: (hip.f + neck.f) / 2, l: (hip.l + neck.l) / 2, z: (hip.z + neck.z) / 2 },
        size: { f: BODY.torsoDepth, l: BODY.shoulderHalf * 2, z: Math.max(0.12, neck.z - hip.z) },
        lean: pr.lean,
      },
    };
  }

  /* ------------------------------------------------------------------
   * Body frame -> WORLD (grid cells / metres). The heading rotates the
   * body's forward axis onto the floor; z is untouched (it is already a
   * height in metres, which is what the iso projection wants).
   * ------------------------------------------------------------------ */
  function toWorld(j, x, y, cosH, sinH, s) {
    return {
      x: x + (j.f * cosH - j.l * sinH) * s,
      y: y + (j.f * sinH + j.l * cosH) * s,
      z: j.z * s,
    };
  }
  function worldJoints(w, sk) {
    const s = sk || pose(w);
    const cosH = Math.cos(w.heading), sinH = Math.sin(w.heading);
    const sc = w.scale || 1;
    const out = {};
    const keys = ["hip", "hipL", "hipR", "chest", "neck", "head", "shL", "shR",
      "elL", "elR", "handL", "handR", "kneeL", "kneeR", "footL", "footR"];
    for (let i = 0; i < keys.length; i++) out[keys[i]] = toWorld(s[keys[i]], w.x, w.y, cosH, sinH, sc);
    if (s.load) out.load = toWorld(s.load.c, w.x, w.y, cosH, sinH, sc);
    return out;
  }

  /* ==================================================================
   * DRAWING. ONE path for BOTH views: every point goes through the
   * caller's `project(worldX, worldY, heightM)`. Top-down hands in a
   * mapping that ignores height (so you look down on the shoulders and
   * see the feet swing fore and aft); the 2.5D view hands in the iso
   * projection (so the same skeleton stands up). Solid parts are drawn as
   * ORIENTED BOXES through the same projector, which is why the torso
   * reads as shoulders from above and as a vest from the side without a
   * single per-view special case.
   * ================================================================== */

  // Project the 8 corners of a body-frame box and paint it: the four
  // sides (degenerate, and so invisible, in a top-down projection) then
  // the top face. Same painter order as the iso element blocks.
  function boxFaces(ctx, o, c, size, cosH, sinH, x, y, sc, fill, side, ink) {
    const hf = size.f / 2, hl = size.l / 2, hz = size.z / 2;
    const corners = [[-hf, -hl], [hf, -hl], [hf, hl], [-hf, hl]];
    const bot = [], top = [];
    for (let i = 0; i < 4; i++) {
      const j = { f: c.f + corners[i][0], l: c.l + corners[i][1], z: c.z - hz };
      const wpt = toWorld(j, x, y, cosH, sinH, sc);
      bot.push(o.project(wpt.x, wpt.y, wpt.z));
      top.push(o.project(wpt.x, wpt.y, wpt.z + size.z * sc));
    }
    ctx.fillStyle = side;
    for (let i = 0; i < 4; i++) {
      const k = (i + 1) % 4;
      ctx.beginPath();
      ctx.moveTo(bot[i].x, bot[i].y);
      ctx.lineTo(bot[k].x, bot[k].y);
      ctx.lineTo(top[k].x, top[k].y);
      ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.fill();
      if (ink) ctx.stroke();
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath();
    ctx.fill();
    if (ink) ctx.stroke();
  }

  /**
   * Draw one worker.
   * opts = {
   *   project(wx, wy, wz) -> {x, y}   REQUIRED (top-down or iso)
   *   cellPx      base px per world cell (line widths; the caller's
   *               zoom transform scales them like every other overlay)
   *   tier        "rich" | "glyph"  (from WT.shapes.detailLevel)
   *   theme       "light" | "dark"
   * }
   * Returns true when something was drawn.
   */
  function draw(ctx, w, opts) {
    const o = opts || {};
    if (!ctx || typeof o.project !== "function" || !w) return false;
    const tier = o.tier === "rich" ? "rich" : "glyph";
    const cell = isFinite(o.cellPx) && o.cellPx > 0 ? o.cellPx : 20;
    const theme = o.theme === "dark" ? "dark" : "light";
    if (!isFinite(w.x) || !isFinite(w.y) || !isFinite(w.heading)) return false;

    const sk = pose(w);
    const cosH = Math.cos(w.heading), sinH = Math.sin(w.heading);
    const sc = w.scale || 1;
    const p = (j) => {
      const q = toWorld(j, w.x, w.y, cosH, sinH, sc);
      return o.project(q.x, q.y, q.z);
    };

    const ink = ppe("ink", theme);
    const vest = ppe("vest", theme);
    const vestSide = ppe("vestSide", theme);
    const trouser = ppe("trouser", theme);
    const rich = tier === "rich";

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = ink;

    // ---- contact shadow: the worker stands ON the slab ---------------
    if (rich) {
      const g = p({ f: 0, l: 0, z: 0 });
      const rx = 0.26 * cell;
      ctx.fillStyle = theme === "dark" ? PPE.shadow.dark : PPE.shadow.light;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const q = p({ f: Math.cos(a) * 0.24, l: Math.sin(a) * 0.20, z: 0 });
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
      ctx.fill();
      if (!isFinite(g.x) || !isFinite(rx)) { /* projector garbage: still safe */ }
    }

    // ---- legs ---------------------------------------------------------
    ctx.lineWidth = Math.max(1, cell * 0.075);
    ctx.strokeStyle = trouser;
    const hL = p(sk.hipL), hR = p(sk.hipR);
    const fL = p(sk.footL), fR = p(sk.footR);
    if (rich) {
      const kL = p(sk.kneeL), kR = p(sk.kneeR);
      ctx.beginPath();
      ctx.moveTo(hL.x, hL.y); ctx.lineTo(kL.x, kL.y); ctx.lineTo(fL.x, fL.y);
      ctx.moveTo(hR.x, hR.y); ctx.lineTo(kR.x, kR.y); ctx.lineTo(fR.x, fR.y);
      ctx.stroke();
      // safety boots
      ctx.strokeStyle = ppe("boot", theme);
      ctx.lineWidth = Math.max(1.2, cell * 0.085);
      const tL = p({ f: sk.footL.f + 0.09, l: sk.footL.l, z: sk.footL.z });
      const tR = p({ f: sk.footR.f + 0.09, l: sk.footR.l, z: sk.footR.z });
      ctx.beginPath();
      ctx.moveTo(fL.x, fL.y); ctx.lineTo(tL.x, tL.y);
      ctx.moveTo(fR.x, fR.y); ctx.lineTo(tR.x, tR.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(hL.x, hL.y); ctx.lineTo(fL.x, fL.y);
      ctx.moveTo(hR.x, hR.y); ctx.lineTo(fR.x, fR.y);
      ctx.stroke();
    }

    // ---- torso in the hi-vis vest ------------------------------------
    ctx.lineWidth = Math.max(0.8, cell * 0.03);
    ctx.strokeStyle = ink;
    boxFaces(ctx, o, sk.torso.c, sk.torso.size, cosH, sinH, w.x, w.y, sc, vest, vestSide, true);
    if (rich) {
      // retroreflective band across the chest
      const bandZ = sk.torso.c.z + sk.torso.size.z * 0.08;
      ctx.strokeStyle = ppe("band", theme);
      ctx.lineWidth = Math.max(1, cell * 0.035);
      const b0 = p({ f: sk.torso.c.f + BODY.torsoDepth * 0.5, l: -BODY.shoulderHalf, z: bandZ });
      const b1 = p({ f: sk.torso.c.f + BODY.torsoDepth * 0.5, l: BODY.shoulderHalf, z: bandZ });
      ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
    }

    // ---- arms (work-shirt sleeves: they have to read AGAINST the vest,
    // which is exactly what a hi-vis waistcoat does on a real floor) ----
    ctx.strokeStyle = ppe("sleeve", theme);
    ctx.lineWidth = Math.max(1, cell * 0.06);
    const sL = p(sk.shL), sR = p(sk.shR);
    const aL = p(sk.handL), aR = p(sk.handR);
    ctx.beginPath();
    if (rich) {
      const eL = p(sk.elL), eR = p(sk.elR);
      ctx.moveTo(sL.x, sL.y); ctx.lineTo(eL.x, eL.y); ctx.lineTo(aL.x, aL.y);
      ctx.moveTo(sR.x, sR.y); ctx.lineTo(eR.x, eR.y); ctx.lineTo(aR.x, aR.y);
    } else {
      ctx.moveTo(sL.x, sL.y); ctx.lineTo(aL.x, aL.y);
      ctx.moveTo(sR.x, sR.y); ctx.lineTo(aR.x, aR.y);
    }
    ctx.stroke();

    // ---- head + hard hat ---------------------------------------------
    // A head is ~23 cm across. Its on-screen radius is MEASURED through the
    // caller's projector (the largest of the projected lateral and vertical
    // extents of that real size), so it is right from above AND correct
    // under the 2.5D projection's vertical compression - a raw px radius
    // would give the iso figure a balloon for a head.
    const hd = p(sk.head);
    const projR = (r) => {
      const a = p({ f: sk.head.f, l: sk.head.l + r, z: sk.head.z });
      const b = p({ f: sk.head.f, l: sk.head.l, z: sk.head.z + r });
      return Math.max(Math.sqrt(Math.pow(a.x - hd.x, 2) + Math.pow(a.y - hd.y, 2)),
        Math.sqrt(Math.pow(b.x - hd.x, 2) + Math.pow(b.y - hd.y, 2)));
    };
    const hr = Math.max(1.2, projR(BODY.headR * sc));
    ctx.fillStyle = ppe("head", theme);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.7, cell * 0.024);
    ctx.beginPath();
    ctx.arc(hd.x, hd.y, hr, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (rich) {
      const hat = p({ f: sk.head.f + 0.02, l: sk.head.l, z: sk.head.z + 0.04 });
      ctx.fillStyle = ppe("helmet", theme);
      ctx.beginPath();
      ctx.arc(hat.x, hat.y, Math.max(1.4, projR(BODY.helmetR * sc)), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    // ---- the load, in their hands ------------------------------------
    if (sk.load) {
      const kind = sk.load.kind;
      const top = kind === "tote" ? ppe("tote", theme)
        : kind === "tool" ? ppe("tool", theme) : ppe("cartonTop", theme);
      const side = kind === "tote" ? ppe("tote", theme)
        : kind === "tool" ? ppe("tool", theme) : ppe("carton", theme);
      ctx.lineWidth = Math.max(0.8, cell * 0.028);
      ctx.strokeStyle = ink;
      boxFaces(ctx, o, sk.load.c, sk.load.size, cosH, sinH, w.x, w.y, sc, top, side, true);
      if (rich && kind === "carton") {
        // the tape line down the middle of the lid
        const z = sk.load.c.z + sk.load.size.z / 2;
        const t0 = p({ f: sk.load.c.f - sk.load.size.f / 2, l: sk.load.c.l, z: z });
        const t1 = p({ f: sk.load.c.f + sk.load.size.f / 2, l: sk.load.c.l, z: z });
        ctx.lineWidth = Math.max(0.8, cell * 0.022);
        ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
      }
    }

    ctx.restore();
    return true;
  }

  /* ------------------------------------------------------------------
   * Convenience for the renderer: sample + draw in one call.
   * ------------------------------------------------------------------ */
  function drawSpec(ctx, spec, t, opts) {
    return draw(ctx, sample(spec, t, opts), opts);
  }

  WT.workers = {
    PPE, ppe, BODY, POSES: P, CYCLES, TASKS, MAX_WORKERS, BREATH_TICKS,
    STANDOFF, CART_BACK,
    taskForType,
    frontDir,
    roster,
    sample,
    pose,
    worldJoints,
    draw,
    drawSpec,
    // exposed for tests / reuse (pure)
    ik, ease, easeSpeed, frac, hash01,
  };
})();
