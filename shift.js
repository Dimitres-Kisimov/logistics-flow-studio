/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * shift.js  (WT.shift)  -  v3.24  "THE PLANT READS LIKE A WORKING SHIFT"
 * ---------------------------------------------------------------------
 * v3.21 gave the hall its materials, v3.22 put people in it and v3.23
 * made the goods physical. What was still missing is the thing that makes
 * a plant look like a plant rather than a diorama: the FLOW READ. A shift
 * has trucks hauling loads down the aisles, queues that back up and then
 * clear, doors with trailers on them, and a status you can see from the
 * far end of the hall.
 *
 * This module is that layer, and like its two predecessors it is a
 * STRICTLY READ-ONLY drawing model over the flow sim:
 *
 *   - it adds NO model, NO number and NO export;
 *   - it never writes a byte of sim state (no MU, no station, no queue,
 *     no layout element is touched - asserted by verify_shift.js);
 *   - every position is a pure function of (layout, plan, sim state,
 *     element identity, the sim's own tick). No Date. No Math.random.
 *
 * FOUR THINGS IT DOES
 *
 * 1. MANNED TRUCKS TRAVEL (v3.23's own honest limitation). Until now a
 *    forklift / reach truck was a static glyph whose forks cycled on the
 *    spot - the one piece of the plant that was drawn moving without ever
 *    going anywhere. Now the truck HAULS: it takes a load at its bay,
 *    drives out along the aisle IN THE DIRECTION THE SIM'S OWN ROUTE
 *    FLOWS, raises the forks, sets the pallet into the rack, turns, and
 *    comes back with the empty. The haul lane is clipped against the real
 *    layout (a truck drives an aisle, never through a rack) and the whole
 *    cycle is a closed loop with continuous position, heading and fork
 *    height - so there is no pop at any step boundary or at the wrap.
 *    RGV and AGV keep their existing in-footprint lane travel; all three
 *    now resolve through ONE pose model.
 *
 * 2. CONGESTION YOU CAN SEE, WITHOUT STROBING (v3.22's deferred item).
 *    A raw per-station queue depth flickers across its threshold many
 *    times a second, which is exactly why v3.22 latched a stage-level
 *    busy/idle instead. The fix is a proper filter, not a latch: an
 *    exponential smoother on the normalised queue signal, a SCHMITT
 *    TRIGGER (separate rise / fall thresholds) on top of it, and a
 *    MINIMUM DWELL so a band that has just changed cannot change again
 *    for a fixed number of sim ticks. Everything the eye tracks (the
 *    worker's pace, the station's colour band) is driven from the smooth
 *    level or the latched band - never from the raw count. The raw count
 *    is still printed on the badge, because the NUMBER must stay honest
 *    even when the COLOUR is deliberately slow.
 *
 * 3. DOCK REALISM. A door that is working has a trailer backed onto it,
 *    its shutter up, a leveller plate bridging the gap and empty pallets
 *    stacked on the apron. A door that is not stays shut. Which one you
 *    see is the sim's own stage occupancy, put through the same
 *    smoother + dwell so a trailer never blinks.
 *
 * 4. THE PAINT AGREES WITH THE FLOW. v3.21 stencilled travel arrows down
 *    every painted aisle, but their direction came from the geometry of
 *    the facing pair, which is arbitrary. `orientArrows` flips each arrow
 *    to agree with the direction the sim actually routes material past
 *    that point - the paint and the flow can no longer disagree. And
 *    `andon` reduces the run to the three states a real andon shows.
 *
 * HONEST SCOPE: an ILLUSTRATIVE schematic animation of warehouse work.
 * The trucks are not a fleet model, the haul cycle is not a duty cycle,
 * the trailer is not a vehicle spec, and the congestion bands are a
 * DRAWING filter over the existing synthetic queue heuristic - they are
 * not a measurement, not a queueing-theory result and not a KPI.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const TAU = Math.PI * 2;

  /* ==================================================================
   * 0. PURE HELPERS (no Date, no Math.random - anywhere in this file).
   * ================================================================== */
  function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function frac(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    const x = n % 1;
    return x < 0 ? x + 1 : x;
  }
  function tri(p) { const x = frac(p); return 1 - Math.abs(2 * x - 1); }
  // Smoothstep: a body that starts from rest and arrives at rest. The same
  // easing the workforce walks on, so a truck and a person accelerate alike.
  function ease(u) { const t = clampN(num(u, 0), 0, 1); return t * t * (3 - 2 * t); }
  // Deterministic hash of two integers -> [0,1). Identical in shape to the
  // one shapes/workers/goods use, so identity-seeded choices agree.
  function hash01(a, b) {
    let h = (a | 0) * 374761393 + (b | 0) * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function seedOf(el) {
    if (!el) return 0;
    return ((num(el.x, 0) | 0) * 73856093) ^ ((num(el.y, 0) | 0) * 19349663);
  }
  // Shortest signed angular difference, in (-PI, PI].
  function angDiff(a, b) {
    let d = (num(a, 0) - num(b, 0)) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d <= -Math.PI) d += TAU;
    return d;
  }
  // A named material from the app's ONE industrial palette (v3.21), with
  // the workforce's PPE board taking precedence exactly as goods.js does -
  // so a driver's vest is the same yellow-green as a picker's.
  function mat(name, theme) {
    const th = theme === "dark" ? "dark" : "light";
    const W = WT.workers;
    if (W && W.PPE && W.PPE[name]) return W.PPE[name][th];
    const S = WT.shapes;
    if (S && typeof S.mat === "function" && S.MATERIALS && S.MATERIALS[name]) return S.mat(name, th);
    return "#8a9096";
  }
  function shadeUp(hex, theme) {
    const S = WT.shapes;
    if (S && S.colors && typeof S.colors.lighten === "function") {
      return S.colors.lighten(hex, theme === "dark" ? 0.18 : 0.14);
    }
    return hex;
  }
  function shadeDown(hex, theme) {
    const S = WT.shapes;
    if (S && S.colors && typeof S.colors.shade === "function") {
      return S.colors.shade(hex, theme === "dark" ? 0.78 : 0.72);
    }
    return hex;
  }
  function heightOf(type) {
    if (WT.iso && typeof WT.iso.elementHeight === "function") return WT.iso.elementHeight(type);
    const dom = WT.domain && WT.domain.ELEMENTS && WT.domain.ELEMENTS[type];
    return dom && isFinite(dom.heightM) && dom.heightM > 0 ? dom.heightM : 1;
  }

  /* ==================================================================
   * 1. THE FLOW DIRECTION FIELD.
   *
   * The flow sim's plan is a polyline through the plant - receiving ->
   * storage (-> along the conveyor route) -> picking -> packing ->
   * shipping. That polyline IS the direction material travels, so it is
   * the only honest source for "which way does this aisle run".
   *
   * legsOf(plan)      -> the polyline as directed segments.
   * dirAt(legs, x, y) -> the unit flow direction at a floor point (the
   *                      nearest leg's direction) + how far away it is.
   * orientArrows()    -> the painted travel arrows, flipped where they
   *                      disagreed with the flow. Geometry is untouched:
   *                      only the sign of (dx,dy) can change.
   * All pure; no plan (plant never run) -> [] / null / the input list.
   * ================================================================== */
  function legsOf(plan) {
    const wp = (plan && plan.waypoints) || [];
    const out = [];
    for (let i = 0; i < wp.length - 1; i++) {
      const a = wp[i], b = wp[i + 1];
      if (!a || !b) continue;
      const ax = num(a.x, NaN), ay = num(a.y, NaN), bx = num(b.x, NaN), by = num(b.y, NaN);
      if (!(isFinite(ax) && isFinite(ay) && isFinite(bx) && isFinite(by))) continue;
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 1e-6)) continue;
      out.push({
        x0: ax, y0: ay, x1: bx, y1: by,
        ux: dx / len, uy: dy / len, len: len,
        stage: (b.stage || a.stage || ""),
      });
    }
    return out;
  }

  function dirAt(legs, x, y) {
    const ls = legs || [];
    const px = num(x, 0), py = num(y, 0);
    let best = null, bd = Infinity;
    for (let i = 0; i < ls.length; i++) {
      const g = ls[i];
      const t = clampN((px - g.x0) * g.ux + (py - g.y0) * g.uy, 0, g.len);
      const qx = g.x0 + g.ux * t, qy = g.y0 + g.uy * t;
      const dx = px - qx, dy = py - qy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best) return null;
    return { dx: best.ux, dy: best.uy, dist: bd, stage: best.stage };
  }

  function orientArrows(arrows, legs) {
    const list = arrows || [];
    const ls = legs || [];
    if (!ls.length) return list;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a) continue;
      const f = dirAt(ls, a.x, a.y);
      const dot = f ? a.dx * f.dx + a.dy * f.dy : 1;
      if (!f || dot >= 0) { out.push(a); continue; }
      // Same mark, same place, same size - it just points the way the
      // material actually goes.
      out.push({ x: a.x, y: a.y, dx: -a.dx, dy: -a.dy, size: a.size, flipped: true });
    }
    return out;
  }

  /* ==================================================================
   * 2. MANNED TRUCKS THAT ACTUALLY HAUL.
   *
   * A haul spec is a pure function of (element, layout, plan):
   *
   *   home  the truck's own bay - the element footprint centre. The
   *         cycle STARTS and ENDS here, so a stopped plant (and
   *         prefers-reduced-motion) parks the truck exactly where the
   *         static glyph has always drawn it.
   *   dir   the haul axis: the dominant axis of the sim's own flow
   *         direction at the bay (so the truck hauls WITH the material,
   *         not across it). No plan -> the footprint's long axis.
   *   len   how far it can actually go: marched cell by cell against the
   *         real layout and the floor edge, stopping short of the first
   *         obstruction. A truck drives an AISLE - never through a rack.
   *         Nowhere to go (len < HAUL.minLen either way) -> len 0, and
   *         the truck works its forks on the spot, exactly as in v3.23.
   * ================================================================== */
  const TRUCK_TYPES = { forklift: 1 };
  const MAX_TRUCKS = 24;          // drawing cap on a huge hall (NOT a fleet claim)

  const HAUL = {
    ticks: 240,      // sim ticks for one complete out-and-back haul
    minLen: 2.4,     // shorter than this is not a haul - stay parked (cells)
    maxLen: 14,      // and no truck hauls further than this in one leg (cells)
    probe: 0.5,      // obstruction march step (cells)
    // Stop the truck BODY short of whatever blocks the lane - about half a
    // truck - so only the tines and the pallet reach into the rack face,
    // which is exactly what putting a load away looks like.
    clear: 0.95,
    edge: 0.9,       // keep this far inside the floor edge (cells)
    liftMax: 3.4,    // fork rise at the rack face (metres)
    // The truck itself, in metres. Nominal generic handling-equipment
    // dimensions used as DRAWING CONSTANTS - not a vendor spec.
    bodyF: 1.70, bodyL: 1.12, bodyZ: 1.05, bodyZ0: 0.24,
    mastF: 0.42, mastZ: 2.45, mastT: 0.11,
    forkF: 1.05, forkL: 0.16, forkGap: 0.52, forkZ: 0.07,
    wheelR: 0.24,
  };

  // The haul cycle. Shares sum to 1; every boundary is CONTINUOUS in
  // position, heading and fork height (verified over a fine sweep in
  // verify_shift.js), so the truck never pops.
  const HAUL_STEPS = [
    { sub: "take",  u: 0.06 }, // at the bay, taking the load onto the forks
    { sub: "out",   u: 0.30 }, // hauling out along the aisle, loaded
    { sub: "lift",  u: 0.12 }, // forks rise at the rack face
    { sub: "set",   u: 0.06 }, // the pallet goes into the level
    { sub: "lower", u: 0.10 }, // forks come down; the truck turns around
    { sub: "back",  u: 0.30 }, // back to the bay with the empty pallet
    { sub: "park",  u: 0.06 }, // squares up at the bay for the next one
  ];

  // A cell -> element-index occupancy map for the whole layout. Pure.
  function occupancy(els) {
    const m = new Map();
    const list = els || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e) continue;
      const x0 = Math.round(num(e.x, 0)), y0 = Math.round(num(e.y, 0));
      const w = Math.max(1, Math.round(num(e.w, 1))), d = Math.max(1, Math.round(num(e.d, 1)));
      for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < d; iy++) m.set((x0 + ix) + "," + (y0 + iy), i);
      }
    }
    return m;
  }

  // March out from `home` along `dir` and report how far the truck can go
  // before it would hit something (or run off the slab). Pure.
  function clearRun(occ, home, dir, gridW, gridH, selfIndex) {
    let t = 0;
    for (t = HAUL.probe; t <= HAUL.maxLen; t += HAUL.probe) {
      const cx = home.x + dir.x * t, cy = home.y + dir.y * t;
      if (cx < HAUL.edge || cy < HAUL.edge || cx > gridW - HAUL.edge || cy > gridH - HAUL.edge) break;
      const hit = occ.get(Math.floor(cx) + "," + Math.floor(cy));
      if (hit != null && hit !== selfIndex) break;
    }
    return clampN(t - HAUL.probe - HAUL.clear, 0, HAUL.maxLen);
  }

  function hauls(layout, plan, opts) {
    const o = opts || {};
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, num(layout && layout.gridW, 40));
    const gridH = Math.max(1, num(layout && layout.gridH, 24));
    const cap = Math.max(0, o.max != null ? (o.max | 0) : MAX_TRUCKS);
    const legs = legsOf(plan);
    const occ = occupancy(els);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (!e || !TRUCK_TYPES[e.type]) continue;
      const x = num(e.x, 0), y = num(e.y, 0);
      const w = Math.max(1, num(e.w, 1)), d = Math.max(1, num(e.d, 1));
      const home = { x: x + w / 2, y: y + d / 2 };
      // Which way does the material go past this bay? Snap that to the
      // dominant axis: a truck runs an aisle, and aisles are axial.
      const f = dirAt(legs, home.x, home.y);
      let dir;
      if (f && (Math.abs(f.dx) > 1e-9 || Math.abs(f.dy) > 1e-9)) {
        dir = Math.abs(f.dx) >= Math.abs(f.dy)
          ? { x: f.dx >= 0 ? 1 : -1, y: 0 }
          : { x: 0, y: f.dy >= 0 ? 1 : -1 };
      } else {
        dir = w >= d ? { x: 1, y: 0 } : { x: 0, y: 1 };
      }
      let len = clearRun(occ, home, dir, gridW, gridH, i);
      if (len < HAUL.minLen) {
        // Blocked downstream: try the other way down the same aisle
        // before giving up (a bay against a wall still works its lane).
        const back = { x: -dir.x, y: -dir.y };
        const lb = clearRun(occ, home, back, gridW, gridH, i);
        if (lb > len) { dir = back; len = lb; }
      }
      if (len < HAUL.minLen) len = 0; // nowhere to go: work the forks on the spot
      out.push({
        id: "t-" + e.type + "-" + (x | 0) + "-" + (y | 0) + "-" + i,
        type: e.type,
        x: x, y: y, w: w, d: d, h: heightOf(e.type),
        home: home,
        dir: dir,
        len: len,
        base: Math.atan2(dir.y, dir.x),
        seed: seedOf(e),
        phase: hash01(seedOf(e), 11), // stable per-truck cycle offset
        stage: f ? f.stage : "",
      });
    }
    out.sort(function (a, b) {
      const ka = a.home.x + a.home.y, kb = b.home.x + b.home.y;
      if (ka !== kb) return ka - kb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return cap && out.length > cap ? out.slice(0, cap) : out;
  }

  /**
   * truckPose(spec, t) -> where this truck is and what it is carrying at
   * animation time `t` (the flow sim's own continuous tick).
   *
   * `t == null` / non-finite (a stopped plant, or prefers-reduced-motion)
   * is the STATIC FRAME: parked at its bay, squared up, forks down, a
   * loaded pallet on the tines - which is exactly the picture v3.23 drew,
   * so nothing about a stopped plant changes.
   */
  function truckPose(spec, t) {
    const live = typeof t === "number" && isFinite(t);
    const len = Math.max(0, num(spec && spec.len, 0));
    const base = num(spec && spec.base, 0);
    const home = (spec && spec.home) || { x: 0, y: 0 };
    const dir = (spec && spec.dir) || { x: 1, y: 0 };
    const p = live ? frac(t / HAUL.ticks + num(spec && spec.phase, 0)) : 0;

    // Locate the step (ordered, shares sum to 1; the last absorbs any
    // floating-point remainder) - the same walk the workforce cycles use.
    let acc = 0, step = HAUL_STEPS[HAUL_STEPS.length - 1], sp = 1;
    for (let i = 0; i < HAUL_STEPS.length; i++) {
      const s = HAUL_STEPS[i];
      if (p < acc + s.u || i === HAUL_STEPS.length - 1) {
        step = s;
        sp = s.u > 0 ? clampN((p - acc) / s.u, 0, 1) : 0;
        break;
      }
      acc += s.u;
    }

    let along = 0, lift = 0, turn = 0, loaded = true;
    switch (step.sub) {
      case "take":  along = 0;                 lift = 0;                        turn = 0;       loaded = true;  break;
      case "out":   along = len * ease(sp);    lift = 0;                        turn = 0;       loaded = true;  break;
      case "lift":  along = len;               lift = HAUL.liftMax * ease(sp);  turn = 0;       loaded = true;  break;
      case "set":   along = len;               lift = HAUL.liftMax;             turn = 0;       loaded = true;  break;
      case "lower": along = len;               lift = HAUL.liftMax * (1 - ease(sp)); turn = ease(sp); loaded = false; break;
      case "back":  along = len * (1 - ease(sp)); lift = 0;                     turn = 1;       loaded = false; break;
      default:      along = 0;                 lift = 0;                        turn = 1 - ease(sp); loaded = false; break; // "park"
    }
    // A parked truck (nowhere to haul) still works its forks on the spot -
    // the v3.23 behaviour - rather than standing dead still.
    if (!(len > 0) && live) { turn = 0; lift = HAUL.liftMax * 0.6 * tri(p); }

    return {
      id: spec && spec.id,
      x: home.x + dir.x * along,
      y: home.y + dir.y * along,
      z: 0,
      heading: base + Math.PI * turn,
      along: along,
      lift: lift,
      loaded: loaded,
      // The load on the tines is the goods layer's own vocabulary: a
      // wrapped pallet-load going out, the empty pallet coming back.
      form: loaded ? "pallet-load" : "pallet",
      sub: step.sub,
      phase: p,
      moving: step.sub === "out" || step.sub === "back",
      resting: !live,
      home: home,
      // Where the goods layer must put the load so it rides the TINES of
      // this exact pose: the forward offset of the fork centre from the
      // truck's own centre, and the height of the tine top.
      forkF: HAUL.mastF + 0.10 + HAUL.forkF / 2,
      deckZ: 0.06 + HAUL.forkZ,
    };
  }

  /**
   * drawTruck(ctx, pose, opts) - the truck itself, as oriented boxes
   * through the caller's project(worldX, worldY, heightM). ONE model for
   * both views by construction (the plain world->px map top-down, the iso
   * projection in 2.5D), painted with WT.workers' own box painter, so the
   * truck, the goods and the people are literally the same geometry code.
   *
   * opts = { project, cellPx, tier ("rich"|"glyph"), theme, color }
   */
  function drawTruck(ctx, pose, opts) {
    const o = opts || {};
    const W = WT.workers;
    if (!ctx || typeof o.project !== "function" || !pose) return false;
    if (!W || typeof W.boxFaces !== "function") return false;
    if (!isFinite(pose.x) || !isFinite(pose.y) || !isFinite(pose.heading)) return false;
    const tier = o.tier === "rich" ? "rich" : "glyph";
    const rich = tier === "rich";
    const theme = o.theme === "dark" ? "dark" : "light";
    const cell = isFinite(o.cellPx) && o.cellPx > 0 ? o.cellPx : 20;
    const cosH = Math.cos(pose.heading), sinH = Math.sin(pose.heading);
    const x = pose.x, y = pose.y;

    const paint = o.color || mat("guard", theme);   // safety-orange machine body
    const paintTop = shadeUp(paint, theme);
    const steel = mat("beam", theme);               // mast + tines are steel
    const steelTop = shadeUp(steel, theme);
    const dark = mat("boot", theme);                // tyres
    const ink = mat("ink", theme);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.6, cell * 0.035);

    const box = function (c, size, top, side, outline) {
      W.boxFaces(ctx, o, c, size, cosH, sinH, x, y, 1, top, side, outline);
    };

    // Contact shadow: the truck stands ON the slab.
    ctx.save();
    ctx.fillStyle = mat("shadow", theme);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const f = Math.cos(a) * (HAUL.bodyF * 0.72), l = Math.sin(a) * (HAUL.bodyL * 0.72);
      const q = o.project(x + (f * cosH - l * sinH), y + (f * sinH + l * cosH), 0.004);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Tyres (rich only - at glyph tier they are a couple of pixels).
    if (rich) {
      const wf = [HAUL.bodyF * 0.30, -HAUL.bodyF * 0.34];
      for (let i = 0; i < wf.length; i++) {
        for (let s = -1; s <= 1; s += 2) {
          box({ f: wf[i], l: s * (HAUL.bodyL / 2 - 0.04), z: HAUL.wheelR },
            { f: HAUL.wheelR * 2, l: 0.16, z: HAUL.wheelR * 2 }, dark, dark, false);
        }
      }
    }

    // Body (counterbalance chassis) + the operator compartment.
    box({ f: -0.12, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ / 2 },
      { f: HAUL.bodyF, l: HAUL.bodyL, z: HAUL.bodyZ }, paintTop, paint, true);
    if (rich) {
      // Counterweight at the back - what makes a counterbalance truck one.
      box({ f: -HAUL.bodyF * 0.52, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ * 0.42 },
        { f: 0.30, l: HAUL.bodyL * 0.94, z: HAUL.bodyZ * 0.80 }, shadeDown(paint, theme), shadeDown(paint, theme), true);
    }

    // The mast: two steel channels rising at the front of the body.
    for (let s = -1; s <= 1; s += 2) {
      box({ f: HAUL.mastF, l: s * (HAUL.bodyL * 0.30), z: HAUL.mastZ / 2 },
        { f: HAUL.mastT, l: HAUL.mastT, z: HAUL.mastZ }, steelTop, steel, rich);
    }
    // The carriage rides the mast at the current fork height.
    const cz = 0.06 + Math.max(0, num(pose.lift, 0));
    box({ f: HAUL.mastF + 0.06, l: 0, z: cz + 0.16 },
      { f: 0.09, l: HAUL.bodyL * 0.78, z: 0.32 }, steelTop, steel, rich);
    // The tines, projecting forward from the carriage at the load height.
    for (let s = -1; s <= 1; s += 2) {
      box({ f: HAUL.mastF + 0.10 + HAUL.forkF / 2, l: s * (HAUL.forkGap / 2), z: cz + HAUL.forkZ / 2 },
        { f: HAUL.forkF, l: HAUL.forkL, z: HAUL.forkZ }, steelTop, steel, rich);
    }

    // The overhead guard and the driver under it. A truck with nobody on
    // it is a parked truck; this one is MANNED, which is the whole point
    // of separating it from the RGV/AGV treatment.
    if (rich) {
      const vest = mat("vest", theme), vestSide = mat("vestSide", theme);
      const head = mat("head", theme), helmet = mat("helmet", theme);
      box({ f: -0.22, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ + 0.30 },
        { f: 0.44, l: HAUL.bodyL * 0.62, z: 0.60 }, vest, vestSide, true);       // torso
      box({ f: -0.22, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ + 0.70 },
        { f: 0.24, l: 0.24, z: 0.22 }, head, head, true);                        // head (NEUTRAL)
      box({ f: -0.22, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ + 0.84 },
        { f: 0.28, l: 0.28, z: 0.07 }, helmet, helmet, true);                    // hard hat
      // The overhead guard is a SLOTTED bar guard, not a solid roof - which
      // is both what the real thing is and what keeps the hi-vis driver
      // legible from directly above, where a solid plate would hide them.
      for (let i = -1; i <= 1; i++) {
        box({ f: -0.16 + i * 0.34, l: 0, z: HAUL.bodyZ0 + HAUL.bodyZ + 1.02 },
          { f: 0.13, l: HAUL.bodyL * 0.92, z: 0.05 }, steelTop, steel, true);
      }
      for (let s = -1; s <= 1; s += 2) {
        box({ f: 0.24, l: s * (HAUL.bodyL * 0.42), z: HAUL.bodyZ0 + HAUL.bodyZ + 0.52 },
          { f: 0.06, l: 0.06, z: 1.00 }, steel, steel, false);                   // guard posts
      }
    }
    ctx.restore();
    return true;
  }

  /* ==================================================================
   * 3. CONGESTION YOU CAN SEE, WITHOUT STROBING.
   *
   * THE PROBLEM. A station's queue length is an integer that crosses its
   * congestion threshold many times a second while the plant runs. Bind
   * anything the eye tracks straight to `queue >= threshold` and it
   * FLICKERS - which is precisely why v3.22 shipped a coarse stage-level
   * latch instead of the per-station signal it wanted.
   *
   * THE FIX, in three layers, none of which is a latch:
   *
   *  (a) SMOOTH. `level` is an exponential moving average of the
   *      normalised queue depth (queue / congestThreshold), integrated in
   *      SIM TIME with the analytic form
   *          level += (raw - level) * (1 - exp(-dt / tau))
   *      which is EXACTLY invariant to how that sim time is chopped into
   *      frames: advancing 1 tick once and 0.5 ticks twice against the
   *      same observation give bit-identical results. So the filter does
   *      not depend on frame rate - it depends on the sim's own clock.
   *      Everything continuous (worker pace, queue emphasis) reads from
   *      `level`, and a continuous signal cannot strobe by construction.
   *
   *  (b) SCHMITT TRIGGER. The three-state band (0 clear / 1 building /
   *      2 backed up) rises at one threshold and falls at a LOWER one, so
   *      a level sitting on a boundary cannot chatter across it: it must
   *      travel the whole dead band to come back.
   *
   *  (c) MINIMUM DWELL. A band that has just changed is frozen for
   *      CONG.dwell sim ticks. This puts a hard ceiling on how often ANY
   *      station can change its read - the property verify_shift.js
   *      asserts over a sampled run, and the one that makes the guarantee
   *      a guarantee rather than a hope.
   *
   * A separate, slower signal answers the other half of the question -
   * whether a station is STARVED (nothing in its queue at all). That is
   * what puts a worker into the idle cycle, and it gets its own, longer
   * dwell because a pose change is far more expensive to the eye than a
   * colour change.
   *
   * THE NUMBER STAYS RAW. Only the drawing is filtered. The queue count
   * on the badge and every KPI remain the sim's own instantaneous value.
   * ================================================================== */
  const CONG = {
    tau: 18,          // level smoothing time constant (SIM TICKS)
    riseHi: 0.95,     // -> band 2 "backed up"   (level, normalised by the threshold)
    fallHi: 0.70,     // <- band 2
    riseLo: 0.45,     // -> band 1 "building"
    fallLo: 0.24,     // <- band 1
    dwell: 48,        // a band holds at least this many sim ticks
    levelMax: 1.6,    // clamp on the normalised observation
    starveTau: 24,    // "nothing to serve" smoothing (SIM TICKS)
    starveHi: 0.78,   // -> starved
    starveLo: 0.34,   // <- starved
    starveDwell: 90,  // a pose change costs more than a colour change
    paceLo: 0.84,     // a starved worker's pace multiplier...
    paceHi: 1.24,     // ...and a saturated one's
    dockTau: 30,      // a door's activity smoothing (SIM TICKS)
    dockHi: 0.60, dockLo: 0.25,
    dockDwell: 120,   // a trailer does not blink
    maxDt: 600,       // hang guard on one update (SIM TICKS)
  };
  const BANDS = ["clear", "building", "backed-up"];
  // A genuinely backed-up station should show a genuinely long line. The
  // sim's own drawing cap (flowsim PARAMS.queueStackMax) spreads 8; this
  // is the cap the app hands the goods layer instead, so a queue that is
  // really deep reads nose-to-tail instead of piling on the 8th place.
  // It changes NO model value - only how many waiting units are spread.
  const QUEUE_SHOW_MAX = 14;

  // The EMA step. Pure, and exactly chunk-invariant for a constant
  // observation: applying it for dt, then again for dt', equals applying
  // it once for dt+dt'.
  function emaStep(prev, obs, dt, tau) {
    const p = num(prev, 0), r = num(obs, 0);
    const d = Math.max(0, num(dt, 0));
    const T = Math.max(1e-6, num(tau, 1));
    if (!(d > 0)) return p;
    return p + (r - p) * (1 - Math.exp(-d / T));
  }

  // The Schmitt trigger + minimum dwell. `prev` = {band, since}; `t` is
  // the sim time. Pure - returns `prev` unchanged when nothing may move.
  function bandStep(prev, level, t, cfg) {
    const c = cfg || CONG;
    const band = prev && isFinite(prev.band) ? prev.band | 0 : 0;
    const since = prev && isFinite(prev.since) ? prev.since : t;
    let want = band;
    if (band < 2 && level >= c.riseHi) want = 2;
    else if (band === 2 && level <= c.fallHi) want = 1;
    else if (band === 0 && level >= c.riseLo) want = 1;
    else if (band === 1 && level <= c.fallLo) want = 0;
    if (want === band) return { band: band, since: since };
    if (t - since < c.dwell) return { band: band, since: since }; // dwell holds it
    return { band: want, since: t };
  }

  // Two-state version of the same guard (starved / door active).
  function flagStep(prev, level, t, hi, lo, dwell) {
    const on = !!(prev && prev.on);
    const since = prev && isFinite(prev.since) ? prev.since : t;
    const want = on ? !(level <= lo) : level >= hi;
    if (want === on) return { on: on, since: since };
    if (t - since < dwell) return { on: on, since: since };
    return { on: want, since: t };
  }

  // The band a level would settle at from cold - used ONLY to seed a
  // fresh store, so opening a running plant does not show a transient.
  function steadyBand(level) {
    if (level >= CONG.riseHi) return 2;
    if (level >= CONG.riseLo) return 1;
    return 0;
  }

  function paceOf(level) {
    return CONG.paceLo + (CONG.paceHi - CONG.paceLo) * clampN(num(level, 0), 0, 1);
  }

  /**
   * observe(sim) -> the RAW per-station observation this frame. Read-only:
   * it copies out of the sim and never writes to it.
   */
  function observe(sim) {
    const out = [];
    const sts = (sim && sim.stations) || [];
    const thr = (WT.flowsim && WT.flowsim.PARAMS && WT.flowsim.PARAMS.congestQueueThreshold) || 6;
    for (let i = 0; i < sts.length; i++) {
      const st = sts[i];
      if (!st) continue;
      const q = (st.queue && st.queue.length) || 0;
      out.push({
        id: st.id, kind: st.kind, stage: st.stage, x: num(st.x, 0), y: num(st.y, 0),
        queue: q,
        raw: clampN(q / Math.max(1, thr), 0, CONG.levelMax),
        empty: q === 0 ? 1 : 0,
      });
    }
    return out;
  }

  /**
   * The smoothing STORE. It is render-layer memory - a filter's state,
   * not sim state, and nothing in it ever flows back into the model. It
   * is keyed by station identity, reset whenever the run restarts, and
   * advanced only by the SIM's own clock, so a replay of the same run
   * reproduces it exactly.
   */
  function createStore() {
    return { kind: "wt-shift-store", t: null, st: new Map(), dk: new Map(), plant: null, updates: 0 };
  }

  function updateStore(store, sim, opts) {
    const s = store && store.kind === "wt-shift-store" ? store : createStore();
    if (!sim) { s.t = null; s.st.clear(); s.dk.clear(); s.plant = null; return s; }
    const o = opts || {};
    const t = num(sim.tick, 0) + num(sim.tickAccum, 0);
    if (!isFinite(t)) return s;
    // A restart (or a rebuild) runs the clock backwards: start clean
    // rather than carrying a filter over a run boundary.
    if (s.t == null || t < s.t) { s.st.clear(); s.dk.clear(); s.plant = null; s.t = t; }
    const dt = clampN(t - s.t, 0, CONG.maxDt);
    s.t = t;
    s.updates++;

    const obs = observe(sim);
    const seen = new Set();
    for (let i = 0; i < obs.length; i++) {
      const ob = obs[i];
      seen.add(ob.id);
      let rec = s.st.get(ob.id);
      if (!rec) {
        // Seed a NEW station at its own steady state, so adding a station
        // (or opening a running plant) never shows a phantom transient.
        rec = {
          id: ob.id, level: ob.raw, band: steadyBand(ob.raw), since: t,
          starve: ob.empty, sOn: ob.empty >= CONG.starveHi, sSince: t,
          eff: 0, queue: ob.queue, x: ob.x, y: ob.y, stage: ob.stage, kind: ob.kind,
        };
        s.st.set(ob.id, rec);
        continue;
      }
      const before = rec.level;
      rec.level = emaStep(rec.level, ob.raw, dt, CONG.tau);
      const b = bandStep({ band: rec.band, since: rec.since }, rec.level, t, CONG);
      rec.band = b.band; rec.since = b.since;
      rec.starve = emaStep(rec.starve, ob.empty, dt, CONG.starveTau);
      const f = flagStep({ on: rec.sOn, since: rec.sSince }, rec.starve, t,
        CONG.starveHi, CONG.starveLo, CONG.starveDwell);
      rec.sOn = f.on; rec.sSince = f.since;
      // The station's EFFECTIVE work clock: sim time integrated at the
      // station's own pace. Workers read their cycle phase from THIS, not
      // from the raw tick - which is what lets the pace change without the
      // pose jumping (scaling t directly would teleport the phase).
      // Monotone and Lipschitz by construction: 0 < paceLo <= pace <= paceHi.
      rec.eff += dt * paceOf(before);
      rec.queue = ob.queue; rec.x = ob.x; rec.y = ob.y; rec.stage = ob.stage; rec.kind = ob.kind;
    }
    // Drop stations that no longer exist (the floor was edited).
    if (seen.size !== s.st.size) {
      const gone = [];
      s.st.forEach(function (_v, k) { if (!seen.has(k)) gone.push(k); });
      for (let i = 0; i < gone.length; i++) s.st.delete(gone[i]);
    }

    // Dock doors: the same filter on "does this door's stage have goods
    // in it", with a much longer dwell - a trailer is not a blinking LED.
    const docksList = o.docks || [];
    const ps = sim.perStage || {};
    const dseen = new Set();
    for (let i = 0; i < docksList.length; i++) {
      const dk = docksList[i];
      if (!dk) continue;
      dseen.add(dk.id);
      const activeRaw = dockRaw(dk, sim, ps);
      let rec = s.dk.get(dk.id);
      if (!rec) {
        rec = { id: dk.id, level: activeRaw, on: activeRaw >= CONG.dockHi, since: t };
        s.dk.set(dk.id, rec);
        continue;
      }
      rec.level = emaStep(rec.level, activeRaw, dt, CONG.dockTau);
      const f = flagStep({ on: rec.on, since: rec.since }, rec.level, t,
        CONG.dockHi, CONG.dockLo, CONG.dockDwell);
      rec.on = f.on; rec.since = f.since;
    }
    if (dseen.size !== s.dk.size) {
      const gone = [];
      s.dk.forEach(function (_v, k) { if (!dseen.has(k)) gone.push(k); });
      for (let i = 0; i < gone.length; i++) s.dk.delete(gone[i]);
    }
    return s;
  }

  // Read one station's smoothed record (never the raw count).
  function readStation(store, id) {
    const rec = store && store.st ? store.st.get(id) : null;
    if (!rec) return null;
    return {
      id: rec.id, level: rec.level, band: rec.band, bandName: BANDS[rec.band] || "clear",
      starved: !!rec.sOn, pace: paceOf(rec.level), eff: rec.eff,
      queue: rec.queue, stage: rec.stage, kind: rec.kind, x: rec.x, y: rec.y,
    };
  }

  // Find the station a worker (or any floor point) belongs to. Stations
  // are anchored at their element footprint centres and so is the
  // workforce roster, so the match is an exact-position lookup with a
  // small tolerance - no new identity model.
  function stationAt(store, x, y, tol) {
    if (!store || !store.st || !store.st.size) return null;
    const px = num(x, 0), py = num(y, 0);
    const r = isFinite(tol) && tol > 0 ? tol : 0.75;
    let best = null, bd = r * r;
    store.st.forEach(function (rec) {
      const dx = rec.x - px, dy = rec.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = rec; }
    });
    return best ? readStation(store, best.id) : null;
  }

  // How many stations read backed-up RIGHT NOW, off the smoothed bands.
  function congestedCount(store) {
    let n = 0;
    if (store && store.st) store.st.forEach(function (r) { if (r.band >= 2) n++; });
    return n;
  }

  /* ==================================================================
   * 4. DOCK REALISM.
   *
   * A dock door is either working or it is shut, and you can tell from
   * across the hall: shutter up, a trailer backed onto the bumpers, a
   * leveller plate bridging the gap, empty pallets stacked on the apron.
   *
   * Which one is drawn comes from the SIM's own stage occupancy (an
   * inbound door works while there are units in receiving; an outbound
   * one while there are units in shipping or anything has been shipped),
   * put through the same smoother + a two-second dwell.
   *
   * HONEST SCOPE: the trailer is the REAR SECTION at the door - the rest
   * of a real 13.6 m trailer is outside the drawn frame - and it is a
   * generic schematic box, not a vehicle model and not a brand.
   * ================================================================== */
  const DOCK_TYPES = { "dock-in": "receiving", "dock-out": "shipping" };
  const MAX_DOCKS = 24;
  const DOCK = {
    trailerF: 3.4,   // the rear section of the trailer we can actually show (m)
    trailerL: 2.55,  // a road trailer's width (m)
    trailerZ: 2.90,  // box height (m)
    deckZ: 1.15,     // trailer deck / dock height (m)
    gap: 0.10,       // the bumper gap between the trailer and the wall (m)
    doorZ: 4.10,     // the shutter opening height (m)
    palletF: 1.20, palletL: 0.80, palletZ: 0.144, // an empty EUR pallet (m)
  };

  // Which way is OUT of the building at this door: the nearest floor edge.
  function outwardOf(e, gridW, gridH) {
    const x = num(e.x, 0), y = num(e.y, 0);
    const w = Math.max(1, num(e.w, 1)), d = Math.max(1, num(e.d, 1));
    const dN = y, dS = gridH - (y + d), dW = x, dE = gridW - (x + w);
    const m = Math.min(dN, dS, dW, dE);
    if (m === dN) return { x: 0, y: -1 };
    if (m === dS) return { x: 0, y: 1 };
    if (m === dW) return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  }

  function docks(layout, opts) {
    const o = opts || {};
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, num(layout && layout.gridW, 40));
    const gridH = Math.max(1, num(layout && layout.gridH, 24));
    const cap = Math.max(0, o.max != null ? (o.max | 0) : MAX_DOCKS);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (!e || !DOCK_TYPES[e.type]) continue;
      const x = num(e.x, 0), y = num(e.y, 0);
      const w = Math.max(1, num(e.w, 1)), d = Math.max(1, num(e.d, 1));
      const dir = outwardOf({ x: x, y: y, w: w, d: d }, gridW, gridH);
      out.push({
        id: "d-" + e.type + "-" + (x | 0) + "-" + (y | 0) + "-" + i,
        type: e.type,
        stage: DOCK_TYPES[e.type],
        x: x, y: y, w: w, d: d, h: heightOf(e.type),
        // The centre of the door FACE (on the building line) and the
        // outward normal, so the trailer parks square onto the door.
        face: {
          x: x + w / 2 + (dir.x !== 0 ? dir.x * (w / 2) : 0),
          y: y + d / 2 + (dir.y !== 0 ? dir.y * (d / 2) : 0),
        },
        dir: dir,
        heading: Math.atan2(dir.y, dir.x),
        seed: seedOf(e),
      });
    }
    out.sort(function (a, b) {
      const ka = a.x + a.y, kb = b.x + b.y;
      if (ka !== kb) return ka - kb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return cap && out.length > cap ? out.slice(0, cap) : out;
  }

  // The RAW "is this door working" observation (0 or 1), read-only.
  function dockRaw(spec, sim, perStage) {
    if (!sim) return 0;
    const ps = perStage || sim.perStage || {};
    if (spec.stage === "shipping") {
      return (num(ps.shipping, 0) > 0 || num(sim.completed, 0) > 0) ? 1 : 0;
    }
    return (num(ps.receiving, 0) > 0 || num(sim.inflight, 0) > 0) ? 1 : 0;
  }

  /**
   * dockRead(store, spec, sim) -> the drawable door state. No sim (a
   * stopped plant) -> everything false, i.e. the picture v3.23 drew.
   */
  function dockRead(store, spec, sim) {
    const rec = store && store.dk ? store.dk.get(spec && spec.id) : null;
    const on = !!(rec && rec.on);
    return {
      id: spec && spec.id,
      open: on,
      trailer: on,
      level: rec ? rec.level : 0,
      stage: spec && spec.stage,
    };
  }

  /**
   * drawDock(ctx, spec, st, opts) - the trailer, the shutter and the
   * apron, through the caller's projector (both views, one model).
   */
  function drawDock(ctx, spec, st, opts) {
    const o = opts || {};
    const W = WT.workers;
    if (!ctx || typeof o.project !== "function" || !spec || !st) return false;
    if (!W || typeof W.boxFaces !== "function") return false;
    const tier = o.tier === "rich" ? "rich" : o.tier === "icon" ? "icon" : "glyph";
    if (tier === "icon") return false;
    const rich = tier === "rich";
    const theme = o.theme === "dark" ? "dark" : "light";
    const cell = isFinite(o.cellPx) && o.cellPx > 0 ? o.cellPx : 20;
    const cosH = Math.cos(spec.heading), sinH = Math.sin(spec.heading);
    const ink = mat("ink", theme);
    const steel = mat("beam", theme);
    const steelTop = shadeUp(steel, theme);
    const wood = mat("wood", theme);
    const woodTop = shadeUp(wood, theme);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.6, cell * 0.03);

    // Everything below is in the DOOR's body frame: +f points OUT of the
    // building through the door, +l runs along the door face.
    const bx = spec.face.x, by = spec.face.y;
    const box = function (c, size, top, side, outline) {
      W.boxFaces(ctx, o, c, size, cosH, sinH, bx, by, 1, top, side, outline);
    };

    if (st.open) {
      // The shutter is UP: a dark opening in the wall where the door is.
      box({ f: -0.06, l: 0, z: DOCK.deckZ + (DOCK.doorZ - DOCK.deckZ) / 2 },
        { f: 0.10, l: Math.max(1.6, spec.w * 0.86), z: DOCK.doorZ - DOCK.deckZ },
        mat("shadow", theme), mat("shadow", theme), true);
    } else if (rich) {
      // Shut: the sectional panels of a closed door.
      const panels = 4;
      const hz = DOCK.doorZ - 0.1;
      for (let i = 0; i < panels; i++) {
        box({ f: -0.06, l: 0, z: 0.1 + hz * (i + 0.5) / panels },
          { f: 0.08, l: Math.max(1.6, spec.w * 0.86), z: hz / panels - 0.05 },
          steelTop, steel, true);
      }
    }

    if (st.trailer) {
      // The rear section of a trailer backed onto the bumpers. Generic
      // schematic box - no brand, no model, not a vehicle spec. Painted
      // steel: a shade off the wall it stands against, not a white slab -
      // it has to read as a vehicle in the yard, not as a light source.
      const body = steel;
      const f0 = DOCK.gap;
      box({ f: f0 + DOCK.trailerF / 2, l: 0, z: DOCK.deckZ + DOCK.trailerZ / 2 },
        { f: DOCK.trailerF, l: DOCK.trailerL, z: DOCK.trailerZ }, shadeUp(body, theme), body, true);
      // The chassis + bogie under it, and the landing legs.
      if (rich) {
        box({ f: f0 + DOCK.trailerF / 2, l: 0, z: DOCK.deckZ * 0.72 },
          { f: DOCK.trailerF * 0.94, l: DOCK.trailerL * 0.72, z: 0.22 }, shadeDown(steel, theme), shadeDown(steel, theme), false);
        for (let s = -1; s <= 1; s += 2) {
          box({ f: f0 + DOCK.trailerF * 0.86, l: s * (DOCK.trailerL * 0.36), z: 0.34 },
            { f: 0.62, l: 0.26, z: 0.68 }, mat("boot", theme), mat("boot", theme), false);
        }
        // The rear doors, swung back flat against the trailer sides.
        for (let s = -1; s <= 1; s += 2) {
          box({ f: f0 + 0.30, l: s * (DOCK.trailerL / 2 + 0.09), z: DOCK.deckZ + DOCK.trailerZ / 2 },
            { f: 0.60, l: 0.08, z: DOCK.trailerZ * 0.94 }, body, shadeDown(body, theme), true);
        }
      }
      // The dock leveller bridging the gap into the trailer.
      box({ f: -0.30, l: 0, z: DOCK.deckZ },
        { f: 0.95, l: Math.max(1.4, spec.w * 0.78), z: 0.07 }, steelTop, steel, true);
    }

    // Apron activity: a stack of EMPTY pallets by the door. Empty pallets
    // are not handling units - they are the dunnage a real dock always
    // has standing by, so nothing here can be mistaken for a flow unit.
    if (rich && st.open) {
      const n = 2 + Math.floor(hash01(spec.seed, 7) * 3); // 2..4, stable per door
      const side = hash01(spec.seed, 13) < 0.5 ? -1 : 1;
      const lx = side * (Math.max(1.1, spec.w * 0.5) + 0.55);
      for (let i = 0; i < n; i++) {
        box({ f: -1.45, l: lx, z: DOCK.palletZ * (i + 0.5) },
          { f: DOCK.palletF, l: DOCK.palletL, z: DOCK.palletZ }, woodTop, wood, true);
      }
    }
    ctx.restore();
    return true;
  }

  /* ==================================================================
   * 5. THE ANDON READ.
   *
   * A plant floor tells you its state with three lamps, and it tells you
   * with SHAPE as well as colour so it survives a colourblind reader and
   * a dirty lens. This reduces the run to those three states off numbers
   * the app already computes - the smoothed congestion bands (so the lamp
   * cannot flicker either) and the sim's own counters. It introduces NO
   * new metric and it is not a certification.
   * ================================================================== */
  function andon(sim, store, opts) {
    const o = opts || {};
    if (!sim || o.on === false) {
      return { state: "stopped", label: "Stopped", shape: "square", mark: "■",
        detail: "the plant is not running", congested: 0, stations: 0 };
    }
    const stations = (sim.stations && sim.stations.length) || 0;
    const congested = congestedCount(store);
    if (congested > 0) {
      return { state: "attention", label: "Attention", shape: "triangle", mark: "▲",
        detail: congested + " of " + stations + " stations backed up",
        congested: congested, stations: stations };
    }
    return { state: "running", label: "Running", shape: "disc", mark: "●",
      detail: "all stations flowing", congested: 0, stations: stations };
  }

  /* ==================================================================
   * 6. HONESTY.
   * ================================================================== */
  const HONESTY =
    "SYNTHETIC illustrative rendering of the EXISTING material flow. It adds NO " +
    "model and NO number: every truck position, congestion band, door state and " +
    "andon lamp is a pure function of the layout, the flow sim's own plan and " +
    "state, and element identity. STRICTLY READ-ONLY over the sim - no MU, no " +
    "station, no queue and no layout element is written, so conservation and " +
    "every KPI are untouched. The congestion BANDS are a DRAWING FILTER " +
    "(exponential smoothing + a Schmitt trigger + a minimum dwell) over the " +
    "existing synthetic queue heuristic, deliberately SLOWER than the raw " +
    "count - the raw count itself is still shown and is never filtered. Truck, " +
    "trailer and pallet dimensions are NOMINAL generic drawing constants, NOT a " +
    "vendor spec, NOT a fleet or duty-cycle model, NOT CAD/BIM geometry, NOT a " +
    "survey, NOT a measurement and NOT a certification.";

  WT.shift = {
    // constants
    HAUL, HAUL_STEPS, CONG, BANDS, DOCK, DOCK_TYPES, TRUCK_TYPES,
    MAX_TRUCKS, MAX_DOCKS, QUEUE_SHOW_MAX, HONESTY,
    // 1. flow direction field (pure)
    legsOf, dirAt, orientArrows,
    // 2. manned trucks (pure model + drawing)
    hauls, truckPose, drawTruck, occupancy, clearRun,
    // 3. congestion with hysteresis (pure steps + the render-layer store)
    observe, emaStep, bandStep, flagStep, steadyBand, paceOf,
    createStore, updateStore, readStation, stationAt, congestedCount,
    // 4. docks
    docks, dockRaw, dockRead, drawDock, outwardOf,
    // 5. andon
    andon,
    // exposed for tests / reuse (pure)
    frac, tri, ease, clampN, hash01, seedOf, angDiff, heightOf,
  };
})();
