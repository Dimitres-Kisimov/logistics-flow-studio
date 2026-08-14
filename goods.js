/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * goods.js - THE GOODS ARE PHYSICAL (v3.23 "3D material movement").
 * ---------------------------------------------------------------------
 * Until v3.22 the material flow was drawn as abstract stage-coloured
 * boxes: a warehouse full of little squares. A warehouse does not move
 * squares. It moves EUR PALLETS carrying KRAFT CARTONS, it breaks those
 * pallets down into cartons, it picks cartons into PLASTIC TOTES and it
 * packs totes into PARCELS that go out on a trailer. This module turns
 * each handling unit (MU) of the flow sim into the physical object it
 * actually is at that point in the chain, puts it ON the surface that is
 * carrying it (belt top, vehicle deck, bench top, slab), points it in
 * the direction it is travelling, and queues it NOSE-TO-TAIL back along
 * its own route when the station in front is busy.
 *
 * WHAT THIS IS (honesty, load-bearing and mirrored in the UI/README):
 *   - An ILLUSTRATIVE, SCHEMATIC rendering of the EXISTING flow sim. It
 *     adds NO model, NO number and NO claim: every unit drawn here is one
 *     MU that flowsim.js already spawned, moved and retired. It is NOT
 *     CAD/BIM geometry, NOT a survey and NOT a measurement.
 *   - The handling-unit sizes are NOMINAL generic dimensions (an EUR
 *     pallet is 1200 x 800 mm, a Euro container 600 x 400 mm) used as
 *     DRAWING constants. Nothing here is a specification, a load
 *     capacity or a claim about anybody's real unit loads.
 *   - UNITS ARE CONSERVED. The form transformation is a change of
 *     APPEARANCE ONLY: one MU stays one MU across the whole chain. A
 *     pallet-load that becomes cartons does NOT become N MUs - the sim's
 *     count model is untouched, and this module never writes to it.
 *   - The carton tiers drawn on a pallet-load and the rack stock level
 *     are the app's EXISTING deterministic fill pattern (shapes.js), not
 *     a computed inventory.
 *
 * THE CHAIN (mapped onto the sim's REAL stage machine, nothing invented).
 * flowsim.js moves every MU along receiving -> storage -> picking ->
 * packing -> shipping and makes put-away / pick / pack stations FIFO
 * servers. A unit therefore has an honest before-and-after at each
 * server, and that is exactly where its form changes:
 *
 *   stage       | form drawn        | the real-world event
 *   ------------+-------------------+---------------------------------
 *   receiving   | wrapped PALLET-   | a loaded pallet comes off the
 *               | LOAD (pallet +    | inbound trailer
 *               | kraft cartons)    |
 *   storage     | CARTON            | DEPALLETISED at put-away
 *   picking     | TOTE              | cartons PICKED into a tote
 *   packing     | PARCEL            | the tote is PACKED into a parcel
 *   shipping    | PARCEL            | parcels are LOADED on the trailer
 *
 * A unit WAITING in a station queue still shows the INCOMING form (the
 * form of the stage before it): the transformation happens at the instant
 * the station SERVES it, which is the honest visual of a station doing
 * work rather than a box changing colour in mid-air.
 *
 * RIDING THE ACTIVE COMPONENTS. `supportIndex()` reads the layout once
 * and records, per floor cell, the height of the surface that is carrying
 * goods there: a conveyor / curve / track / sorter belt top, an RGV or
 * AGV deck, a pack-bench top, or the slab. A unit is drawn sitting ON
 * that surface, so a carton on a belt is at belt height and a parcel on a
 * bench is on the bench - in BOTH views, because every point goes through
 * the caller's project(worldX, worldY, heightM). Because the sim already
 * routes the storage->picking leg ALONG the conveyor cell centres (and
 * along a curved conveyor's quarter-arc), a unit riding a belt follows
 * the belt - including round the bend - by construction, and its heading
 * is the route's own direction.
 *
 * DETERMINISM (structural, not incidental): every position, height,
 * heading and form below is a PURE function of (sim state, element
 * identity, animation phase). There is NO Date and NO Math.random in
 * this file. The animation clock is the flow sim's own tick - the same
 * clock WT.shapes.equipmentPhase and WT.workers use - so the goods
 * freeze exactly when the plant pauses and, with no clock at all (which
 * is what `prefers-reduced-motion` passes), everything resolves to a
 * legible STATIC frame.
 *
 * REUSE, NOT DUPLICATION: the oriented-box painter and the kraft-carton
 * material are WT.workers' own (boxFaces + PPE), so the carton on the
 * belt is drawn by the same code and in the same kraft as the carton in
 * a worker's hands; the timber, tote plastic and steel come from
 * WT.shapes.MATERIALS; the LOD tiers come from WT.shapes.detailLevel.
 *
 * PURE + SELF-CONTAINED: no DOM outside the passed canvas ctx, no module
 * state between calls, no mutation of any input, no external asset.
 * Headlessly verified by verify_goods.js; drawn live in the browser.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Depends on shapes.js + workers.js for materials and the
 * box painter, iso.js for the per-type heights, flowsim.js for the stage
 * list; every dependency is read defensively.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const TAU = Math.PI * 2;

  /* ==================================================================
   * NOMINAL HANDLING-UNIT DIMENSIONS (metres). One grid cell = one metre
   * (domain METRES_PER_CELL = 1) so these are world units directly.
   *   f = length along the direction of travel
   *   l = width across it
   *   z = overall height
   * Generic industry-standard footprints used as DRAWING constants: an
   * EUR/EPAL pallet is 1200 x 800 x 144 mm, a Euro container 600 x 400
   * mm. NOT a specification and NOT a capacity claim.
   * ================================================================== */
  const NOMINAL = {
    "pallet":      { f: 1.20, l: 0.80, z: 0.144 }, // bare EUR pallet
    "pallet-load": { f: 1.20, l: 0.80, z: 1.45 },  // pallet + wrapped carton stack
    "carton":      { f: 0.40, l: 0.30, z: 0.30 },  // corrugated shipping carton
    "tote":        { f: 0.60, l: 0.40, z: 0.32 },  // Euro container tote
    "parcel":      { f: 0.35, l: 0.25, z: 0.22 },  // packed outbound parcel
  };
  const FORMS = ["pallet-load", "carton", "tote", "parcel", "pallet"];

  // Pallet construction (metres): the bottom blocks/runners and the top
  // deck of the EUR pallet, drawn at the rich tier.
  const PALLET = {
    blockZ: 0.100,   // bottom block / runner height
    deckZ: 0.044,    // top deck board thickness
    runners: 3,      // bottom runners across the load
    runnerF: 0.145,  // each runner's length along travel
  };

  /* ------------------------------------------------------------------
   * THE FORM CHAIN. Keyed by the flow sim's OWN stage names - this table
   * invents no stage, it only says what a unit LOOKS like in each of the
   * five stages flowsim.js already moves it through.
   * ------------------------------------------------------------------ */
  const STAGE_FORM = {
    receiving: "pallet-load", // off the inbound trailer, wrapped
    storage: "carton",        // depalletised at put-away
    picking: "tote",          // picked into a tote
    packing: "parcel",        // packed into a parcel
    shipping: "parcel",       // loaded onto the outbound trailer
  };
  const STAGE_ORDER = ["receiving", "storage", "picking", "packing", "shipping"];

  // Where each transformation HAPPENS, in the sim's own vocabulary. Used
  // by the UI/legend and asserted by the harness so the story drawn on
  // the canvas and the story told in words cannot drift apart.
  const TRANSFORMS = [
    { at: "receiving dock", station: null, from: null, to: "pallet-load",
      what: "a wrapped pallet-load arrives at receiving" },
    { at: "put-away", station: "put", from: "pallet-load", to: "carton",
      what: "the pallet is depalletised into cartons when the put-away station serves it" },
    { at: "pick face", station: "pick", from: "carton", to: "tote",
      what: "cartons are picked into a tote when the pick station serves it" },
    { at: "pack bench", station: "pack", from: "tote", to: "parcel",
      what: "the tote is packed into a parcel when the pack station serves it" },
    { at: "shipping dock", station: null, from: "parcel", to: "parcel",
      what: "parcels are loaded onto the outbound trailer" },
  ];

  /* ------------------------------------------------------------------
   * DRAWING CONSTANTS (not model values).
   * ------------------------------------------------------------------ */
  // Bumper gap between two units standing nose-to-tail in a queue, metres.
  const NOSE_GAP = 0.08;
  // The bench-top height of a manned station as a share of its element
  // height - the SAME 0.72 the rich station form (shapes.js f3StationWork)
  // puts its work-in-progress carton on, so goods and furniture agree.
  const BENCH_TOP = 0.72;
  // The deck top of an RGV / AGV carriage as a share of its element
  // height - the SAME h * 1.1 shapes.js draws the carriage box to.
  const DECK_TOP = 1.1;
  // Above this many live units the whole flow degrades to the cheap mark
  // (uniformly, so no individual unit flickers between fidelities): the
  // biggest hall stays smooth. A drawing budget, not a model cap.
  const MAX_FORM_UNITS = 400;

  /* ==================================================================
   * SMALL PURE HELPERS. Finite for any finite input.
   * ================================================================== */
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }
  // Deterministic integer hash -> [0,1). The SAME shape as the app's own
  // per-element animation seed (app.js elemAnimSeed / workers.js hash01),
  // so identical equipment at different spots stays out of phase with no
  // clock and no RNG anywhere in the decision.
  function seedOf(el) {
    return ((num(el && el.x, 0) | 0) * 73856093) ^ ((num(el && el.y, 0) | 0) * 19349663);
  }
  function hash01(a, b) {
    let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663);
    h = h & 0x7fffffff;
    return (h % 100003) / 100003;
  }
  function frac(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    const x = n % 1;
    return x < 0 ? x + 1 : x;
  }
  // Triangle wave 0 -> 1 -> 0: a body that travels a lane and returns.
  function tri(p) { const x = frac(p); return 1 - Math.abs(2 * x - 1); }

  // A named material, from the app's ONE industrial palette. The kraft
  // board is WT.workers' own so a carton on the belt is the same kraft as
  // a carton in a worker's hands; the rest come from WT.shapes.MATERIALS.
  function mat(name, theme) {
    const th = theme === "dark" ? "dark" : "light";
    const W = WT.workers;
    if (W && W.PPE && W.PPE[name]) return W.PPE[name][th];
    const S = WT.shapes;
    if (S && typeof S.mat === "function" && S.MATERIALS && S.MATERIALS[name]) return S.mat(name, th);
    return "#8a9096";
  }

  // The height (metres) of an element type, from the SINGLE source of
  // truth the 2.5D view and the IFC export already share.
  function heightOf(type) {
    if (WT.iso && typeof WT.iso.elementHeight === "function") return WT.iso.elementHeight(type);
    const dom = WT.domain && WT.domain.ELEMENTS && WT.domain.ELEMENTS[type];
    return dom && isFinite(dom.heightM) && dom.heightM > 0 ? dom.heightM : 1;
  }
  function baseOf(type) {
    const els = WT.domain && WT.domain.ELEMENTS;
    const def = els && els[type];
    return def && typeof def.base === "string" ? def.base : null;
  }

  /* ==================================================================
   * WHAT IS CARRYING THE GOODS. A pure index over the layout: for each
   * floor cell, the surface height goods ride at there and what that
   * surface IS. Everything not listed is the slab (z = 0).
   * ================================================================== */
  // Belt-family carriers: a load rides ON TOP of the bed.
  const BELT_TYPES = { conveyor: 1, "conveyor-curve": 1, track: 1, "two-lane-track": 1, sorter: 1 };
  // Vehicle carriers: a load rides on the deck of the carriage.
  const DECK_TYPES = { rgv: 1, agv: 1 };
  // Manned benches: work in progress sits on the bench top.
  const BENCH_TYPES = {
    "pack-station": 1, "push-station": 1, "pull-station": 1, "returns-station": 1,
    "mfg-station": 1, "mfg-parallel-station": 1, "mfg-assembly": 1, "mfg-dismantle": 1,
  };

  function carrierOf(el) {
    if (!el || !el.type) return null;
    const t = el.type;
    if (BELT_TYPES[t]) return { kind: "belt", z: heightOf(t) };
    if (DECK_TYPES[t]) return { kind: "deck", z: heightOf(t) * DECK_TOP };
    if (BENCH_TYPES[t]) return { kind: "bench", z: heightOf(t) * BENCH_TOP };
    const b = baseOf(t);
    if (b === "conveyor" || b === "transporter") return { kind: "belt", z: heightOf(t) };
    if (b === "station") return { kind: "bench", z: heightOf(t) * BENCH_TOP };
    return null; // staging pads, racking, docks: goods stand on the slab
  }

  /**
   * supportIndex(layout) -> a pure, reusable index of the carrying
   * surfaces on this floor. Deterministic, allocation-bounded (one entry
   * per covered cell), and it mutates nothing.
   */
  function supportIndex(layout) {
    const els = (layout && layout.elements) || [];
    const cells = new Map();
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const c = carrierOf(e);
      if (!c) continue;
      const x0 = Math.round(num(e.x, 0)), y0 = Math.round(num(e.y, 0));
      const w = Math.max(1, Math.round(num(e.w, 1))), d = Math.max(1, Math.round(num(e.d, 1)));
      for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < d; iy++) {
          const key = (x0 + ix) + "," + (y0 + iy);
          const prev = cells.get(key);
          // A taller carrier wins (a belt crossing a pad carries the load).
          if (!prev || c.z > prev.z) cells.set(key, { kind: c.kind, z: c.z, type: e.type });
        }
      }
    }
    return { kind: "wt-goods-support", cells: cells, count: cells.size };
  }

  /** supportAt(index, worldX, worldY) -> { kind, z } (the slab when free). */
  function supportAt(index, x, y) {
    const cells = index && index.cells;
    if (!cells) return { kind: "floor", z: 0 };
    const key = Math.floor(num(x, 0)) + "," + Math.floor(num(y, 0));
    const hit = cells.get(key);
    return hit ? { kind: hit.kind, z: hit.z, type: hit.type } : { kind: "floor", z: 0 };
  }

  /* ==================================================================
   * THE FORM A UNIT HAS. A pure function of the MU the sim already
   * carries: its stage, and whether it is WAITING at a station (in which
   * case it still has the form it arrived in - the station transforms it
   * when it SERVES it) or moving on.
   * ================================================================== */
  function formFor(mu) {
    if (!mu) return "carton";
    let i = STAGE_ORDER.indexOf(mu.stage);
    if (i < 0) i = 0;
    if (mu.status === "queued") i = Math.max(0, i - 1); // still the incoming form
    return STAGE_FORM[STAGE_ORDER[i]] || "carton";
  }
  function sizeOf(form) {
    return NOMINAL[form] || NOMINAL.carton;
  }

  /* ==================================================================
   * WHERE A UNIT IS, IN THREE DIMENSIONS.
   * ================================================================== */
  function segHeading(wp, i) {
    const a = wp[i], b = wp[i + 1];
    if (!a || !b) return 0;
    const dx = b.x - a.x, dy = b.y - a.y;
    return (dx * dx + dy * dy) > 1e-12 ? Math.atan2(dy, dx) : 0;
  }

  /**
   * The drawn position of the q-th unit waiting at a station: walk BACK
   * along the sim's OWN route from the station's waypoint, one unit
   * length plus a bumper gap per place in the queue. The queue therefore
   * backs up along the conveyor / aisle the goods actually came in on,
   * nose to tail, instead of stacking in a pile.
   *
   * The QUEUE ITSELF is entirely the sim's (its order, its length, its
   * service rate); only the drawn spacing is refined here. No sim value
   * is read back or written.
   */
  function queueTrail(plan, wpIndex, qIndex, pitch) {
    const wp = (plan && plan.waypoints) || [];
    const i = clampN(wpIndex | 0, 0, Math.max(0, wp.length - 1));
    const head = wp[i];
    if (!head) return { x: 0, y: 0, heading: 0 };
    let need = (num(qIndex, 0) + 0.5) * Math.max(0.05, pitch);
    let cur = i;
    let px = head.x, py = head.y;
    let heading = segHeading(wp, Math.max(0, i - 1));
    while (need > 0 && cur > 0) {
      const a = wp[cur - 1], b = wp[cur];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.sqrt(dx * dx + dy * dy);
      if (!(L > 1e-9)) { cur--; continue; }
      heading = Math.atan2(dy, dx);
      if (need <= L) {
        const t = need / L;
        px = b.x - dx * t;
        py = b.y - dy * t;
        need = 0;
        break;
      }
      need -= L;
      px = a.x; py = a.y;
      cur--;
    }
    return { x: px, y: py, heading: heading };
  }

  /**
   * sample(state, mu, support, opts) -> everything needed to DRAW one unit.
   * PURE: reads the sim state, writes nothing.
   *
   * v3.24: `opts.queueMax` raises how many WAITING units are spread
   * nose-to-tail before the rest pile onto the last place, so a station
   * that is genuinely backed up shows a genuinely long line. Omitted ->
   * the sim's own drawing cap, i.e. byte-identical to v3.23. It changes
   * NO model value - the queue's order, length and service stay the sim's.
   *
   * Returns { id, form, size, x, y, z, heading, ride, status, stage,
   *           queueIndex, hot }
   * where z is the height of the unit's UNDERSIDE (the carrying surface).
   */
  function sample(state, mu, support, opts) {
    const so = opts || {};
    const plan = (state && state.plan) || {};
    const wp = plan.waypoints || [];
    const form = formFor(mu);
    const size = sizeOf(form);
    const queued = !!(mu && mu.status === "queued" && mu.station);
    let x, y, heading, qIndex = -1;
    if (queued) {
      const st = mu.station;
      const q = st.queue ? st.queue.indexOf(mu) : 0;
      qIndex = q < 0 ? 0 : q;
      // Cap the DRAWN trail so a huge queue can never run off the far end
      // of the floor: the sim's own queue-stack cap, or the caller's
      // (v3.24 hands in a deeper one so real congestion reads as a line).
      const dflt = (WT.flowsim && WT.flowsim.PARAMS && WT.flowsim.PARAMS.queueStackMax) || 8;
      const cap = isFinite(so.queueMax) && so.queueMax > 0 ? (so.queueMax | 0) : dflt;
      const shown = Math.min(qIndex, cap);
      const t = queueTrail(plan, st.wpIndex, shown, size.f + NOSE_GAP);
      x = t.x; y = t.y; heading = t.heading;
    } else {
      x = num(mu && mu.cx, 0);
      y = num(mu && mu.cy, 0);
      const seg = mu && mu.arrivedShip ? Math.max(0, wp.length - 2) : clampN(num(mu && mu.seg, 0) | 0, 0, Math.max(0, wp.length - 2));
      heading = segHeading(wp, seg);
    }
    // Keep every drawn unit on the floor (the sim's own bound margin).
    const m = (WT.flowsim && WT.flowsim.PARAMS && WT.flowsim.PARAMS.boundMargin) || 0.15;
    const gw = num(plan.gridW, num(state && state.gridW, 40));
    const gh = num(plan.gridH, num(state && state.gridH, 24));
    x = clampN(x, m, Math.max(m, gw - m));
    y = clampN(y, m, Math.max(m, gh - m));
    const sup = supportAt(support, x, y);
    const thr = (WT.flowsim && WT.flowsim.PARAMS && WT.flowsim.PARAMS.congestQueueThreshold) || 6;
    return {
      id: num(mu && mu.id, 0),
      form: form,
      size: size,
      x: x, y: y, z: sup.z,
      heading: isFinite(heading) ? heading : 0,
      ride: sup.kind,
      stage: (mu && mu.stage) || "receiving",
      status: queued ? "queued" : "active",
      queueIndex: qIndex,
      hot: !!(queued && mu.station.queue && mu.station.queue.length >= thr),
    };
  }

  /**
   * units(state, support) -> every live MU as a drawable unit, sorted
   * BACK-TO-FRONT (the same painter's order the 2.5D scene uses), so a
   * nearer unit paints over a further one. PURE + non-mutating.
   */
  function units(state, support, opts) {
    const o = opts || {};
    const out = [];
    const mus = (state && state.mus) || [];
    for (let i = 0; i < mus.length; i++) out.push(sample(state, mus[i], support, o));
    out.sort(function (a, b) {
      const ka = a.x + a.y, kb = b.x + b.y;
      if (ka !== kb) return ka - kb;
      return a.id - b.id; // stable, deterministic
    });
    if (o.max > 0 && out.length > o.max) return out.slice(0, o.max);
    return out;
  }

  /* ==================================================================
   * CARRIED BY THE TRUCKS. A forklift, RGV or AGV that is drawn moving
   * should be drawn moving SOMETHING. These specs put a pallet on the
   * deck / on the forks and move it with the vehicle, using the SAME
   * lane parameterisation and the SAME animation phase the vehicle's own
   * form uses (WT.shapes.equipmentPhase + tri), so the load can never
   * drift off its truck.
   * ================================================================== */
  const VEHICLE_TYPES = { forklift: "lift", rgv: "rail", agv: "free" };
  const MAX_VEHICLES = 48; // drawing cap on a huge hall (not a fleet claim)

  function vehicles(layout, opts) {
    const o = opts || {};
    const els = (layout && layout.elements) || [];
    const cap = Math.max(0, o.max != null ? (o.max | 0) : MAX_VEHICLES);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const mode = e && VEHICLE_TYPES[e.type];
      if (!mode) continue;
      const x = num(e.x, 0), y = num(e.y, 0);
      const w = Math.max(1, num(e.w, 1)), d = Math.max(1, num(e.d, 1));
      const h = heightOf(e.type);
      const horiz = w >= d;
      out.push({
        id: "v-" + e.type + "-" + (x | 0) + "-" + (y | 0) + "-" + i,
        type: e.type,
        mode: mode,
        x: x, y: y, w: w, d: d, h: h,
        horiz: horiz,
        seed: seedOf(e),
        // A truck carries a LOADED pallet; a reach truck comes back down
        // with the empty one after setting the load into the rack.
        form: "pallet-load",
      });
    }
    out.sort(function (a, b) {
      const ka = a.x + a.y, kb = b.x + b.y;
      if (ka !== kb) return ka - kb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return cap && out.length > cap ? out.slice(0, cap) : out;
  }

  /**
   * sampleVehicle(spec, t, haul) -> the load this vehicle is carrying
   * right now. `t` is the sim's own continuous tick; `null` (a stopped
   * plant or prefers-reduced-motion) gives the STATIC frame - the truck
   * parked mid-lane with its forks down, never a load frozen in mid-air.
   *
   * v3.24: a MANNED truck no longer works its forks on the spot - it
   * hauls. When the caller hands in that truck's haul pose (WT.shift's
   * `truckPose`, the SAME pose its body is drawn at), the load rides on
   * the travelling tines instead: one pose, so the pallet can no more
   * drift off a moving truck than it could off a parked one. Omitted ->
   * exactly the v3.23 behaviour, so nothing that does not haul changes.
   */
  function sampleVehicle(spec, t, haul) {
    const live = typeof t === "number" && isFinite(t);
    if (haul && isFinite(haul.x) && isFinite(haul.y) && isFinite(haul.heading)) {
      // The tines project HAUL-forward of the truck's own centre; the
      // pallet's centre sits half a pallet further out again.
      const fwd = num(haul.forkF, 1.05);
      const cosH = Math.cos(haul.heading), sinH = Math.sin(haul.heading);
      const hform = haul.form === "pallet" ? "pallet" : "pallet-load";
      return {
        id: spec.id, form: hform, size: sizeOf(hform),
        x: haul.x + cosH * fwd, y: haul.y + sinH * fwd,
        z: num(haul.deckZ, 0.13) + Math.max(0, num(haul.lift, 0)),
        heading: haul.heading,
        ride: "fork",
        stage: "storage", status: "carried", queueIndex: -1, hot: false,
        lift: Math.max(0, num(haul.lift, 0)), resting: !live, hauling: true,
      };
    }
    const S = WT.shapes;
    const phase = live && S && typeof S.equipmentPhase === "function"
      ? S.equipmentPhase(t, spec.seed)
      : (live ? frac(t / 2.4 + hash01(spec.seed, 5)) : 0);
    const w = spec.w, d = spec.d, h = spec.h;
    let x, y, z, heading, form = spec.form, lift = 0;
    if (spec.mode === "lift") {
      // A reach truck at a rack face: the forks RAISE with the loaded
      // pallet, set it into a level, and come back down empty.
      const up = tri(phase);
      // The pallet sits on the tines, which project past the mast: the
      // SAME x + w * 0.62 the rich 3D forklift form loads.
      x = spec.x + w * 0.72;
      y = spec.y + d / 2;
      heading = 0; // the forks project along +x, as the forklift form draws them
      lift = live ? up * Math.max(0, h - 0.7) : 0;
      z = 0.05 + lift;
      // Loaded going up, empty coming down - which is what a put-away
      // cycle looks like from the aisle.
      form = live && frac(phase) >= 0.5 ? "pallet" : "pallet-load";
    } else {
      // RGV runs the rail back and forth (triangle wave); an AGV loops
      // its guide path one way. Both are the SAME travel parameter the
      // vehicle's own carriage is drawn at, so the load rides WITH it.
      const along = live ? (spec.mode === "rail" ? tri(phase) : frac(phase)) : 0.5;
      const rw = spec.horiz ? clampN(w * 0.28, 0.5, 3) : clampN(w * 0.5, 0.5, 3);
      const rd = spec.horiz ? clampN(d * 0.5, 0.5, 3) : clampN(d * 0.28, 0.5, 3);
      x = spec.horiz ? spec.x + rw / 2 + along * (w - rw) : spec.x + w / 2;
      y = spec.horiz ? spec.y + d / 2 : spec.y + rd / 2 + along * (d - rd);
      z = h * DECK_TOP;
      heading = spec.horiz ? 0 : Math.PI / 2;
      if (spec.mode === "rail" && live && frac(phase) >= 0.5) heading += Math.PI; // returning
    }
    return {
      id: spec.id, form: form, size: sizeOf(form),
      x: x, y: y, z: z, heading: heading,
      ride: spec.mode === "lift" ? "fork" : "deck",
      stage: "storage", status: "carried", queueIndex: -1, hot: false,
      lift: lift, resting: !live,
    };
  }

  /* ==================================================================
   * RACKS SHOW STOCK. The racking already draws load-units from a
   * DETERMINISTIC fill pattern (shapes.js: a per-slot hash compared
   * against a fill fraction). This returns a SCALE for that fraction so
   * the rack faces gain and lose pallets as the sim moves goods -
   * strictly BOUNDED BY THE EXISTING MODEL:
   *
   *   - no plant running -> 1, i.e. EXACTLY the picture as before;
   *   - the scale rides the storage stage's share of the live flow
   *     against the model's OWN even share (1 / STAGES.length);
   *   - it is clamped into [1 - RICH_FILL, 1] using the shape registry's
   *     own fill constant, so a rack never empties and never shows more
   *     stock than the existing pattern already drew.
   *
   * No new inventory number, no new claim: the loaded SLOTS are the same
   * deterministic pattern, and they empty and refill in its own order.
   * ================================================================== */
  function rackStock(state) {
    if (!state || !state.perStage) return 1;
    const inflight = num(state.inflight, 0);
    if (!(inflight > 0)) return 1;
    const stages = (WT.flowsim && WT.flowsim.STAGES) || STAGE_ORDER;
    const n = Math.max(1, stages.length);
    const stored = num(state.perStage.storage, 0);
    const rel = (stored / inflight) * n; // 1 == the model's own even share
    const richFill = (WT.shapes && isFinite(WT.shapes.RICH_FILL)) ? WT.shapes.RICH_FILL : 0.62;
    const lo = clampN(1 - richFill, 0.05, 1);
    return clampN(lo + (1 - lo) * clampN(rel, 0, 1), lo, 1);
  }

  /* ==================================================================
   * DRAWING. ONE path for BOTH views: every point goes through the
   * caller's project(worldX, worldY, heightM), which is the plain
   * world->px map top-down and the iso projection in 2.5D. The solid
   * parts are ORIENTED BOXES painted by WT.workers.boxFaces - the very
   * same painter that puts a carton in a worker's hands - so a carton on
   * a belt and a carton being carried can never disagree.
   * ================================================================== */

  // Paint one oriented box. `c` is the body-frame CENTRE {f,l,z} with an
  // ABSOLUTE z (metres above the slab); `size` is {f,l,z} in metres.
  function box(ctx, o, c, size, cosH, sinH, x, y, top, side, ink) {
    const W = WT.workers;
    if (!W || typeof W.boxFaces !== "function") return false;
    W.boxFaces(ctx, o, c, size, cosH, sinH, x, y, 1, top, side, ink);
    return true;
  }

  // Project a body-frame point through the caller's projector.
  function pt(o, f, l, z, cosH, sinH, x, y) {
    return o.project(x + (f * cosH - l * sinH), y + (f * sinH + l * cosH), z);
  }

  // A straight body-frame line (a tape seam, a wrap band, a tote lip).
  function line(ctx, o, a, b, cosH, sinH, x, y) {
    const p0 = pt(o, a[0], a[1], a[2], cosH, sinH, x, y);
    const p1 = pt(o, b[0], b[1], b[2], cosH, sinH, x, y);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // The contact shadow: the unit is standing ON something. Drawn at the
  // carrying surface's own height, so a carton on a belt casts its shadow
  // on the BELT and a pallet on the slab casts it on the slab. Tinted
  // with the unit's flow-stage colour, which is how the stage read
  // survives when the goods stop being stage-coloured blocks.
  function shadow(ctx, o, u, cosH, sinH, tint) {
    // A touch wider than the footprint, so a sliver of the stage colour
    // shows all round the unit: from directly above (where the box's own
    // height is invisible) that halo is what keeps the flow legend
    // readable now that the goods are material-coloured, not stage-coloured.
    const hf = u.size.f * 0.66, hl = u.size.l * 0.74;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const q = pt(o, Math.cos(a) * hf, Math.sin(a) * hl, u.z + 0.004, cosH, sinH, u.x, u.y);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fillStyle = tint;
    ctx.fill();
  }

  // --- the EUR pallet: bottom runners + a deck ------------------------
  function drawPallet(ctx, o, u, cosH, sinH, theme, rich, z0) {
    const wood = mat("wood", theme);
    const woodTop = shadeUp(wood, theme);
    const S = NOMINAL.pallet;
    if (!rich) {
      box(ctx, o, { f: 0, l: 0, z: z0 + S.z / 2 }, { f: S.f, l: S.l, z: S.z }, cosH, sinH, u.x, u.y, woodTop, wood, true);
      return z0 + S.z;
    }
    // The bottom runners the forks go under.
    const n = PALLET.runners;
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1) - 0.5) * (S.f - PALLET.runnerF);
      box(ctx, o, { f: f, l: 0, z: z0 + PALLET.blockZ / 2 },
        { f: PALLET.runnerF, l: S.l, z: PALLET.blockZ }, cosH, sinH, u.x, u.y, wood, wood, true);
    }
    // The top deck.
    box(ctx, o, { f: 0, l: 0, z: z0 + PALLET.blockZ + PALLET.deckZ / 2 },
      { f: S.f, l: S.l, z: PALLET.deckZ }, cosH, sinH, u.x, u.y, woodTop, wood, true);
    // Deck-board seams, so the deck reads as boards and not a plank.
    for (let i = 1; i <= 3; i++) {
      const f = (i / 4 - 0.5) * S.f;
      line(ctx, o, [f, -S.l / 2, z0 + PALLET.blockZ + PALLET.deckZ],
        [f, S.l / 2, z0 + PALLET.blockZ + PALLET.deckZ], cosH, sinH, u.x, u.y);
    }
    return z0 + PALLET.blockZ + PALLET.deckZ;
  }

  // Lighten a hex a touch for the lit top face (falls back to the input
  // when the shape registry is unavailable).
  function shadeUp(hex, theme) {
    const S = WT.shapes;
    if (S && S.colors && typeof S.colors.lighten === "function") {
      return S.colors.lighten(hex, theme === "dark" ? 0.18 : 0.14);
    }
    return hex;
  }

  // --- a carton stack on a pallet, plus the stretch wrap --------------
  function drawCartonStack(ctx, o, u, cosH, sinH, theme, rich, z0, topZ) {
    const kraft = mat("carton", theme), lid = mat("cartonTop", theme);
    const hz = Math.max(0.1, topZ - z0);
    const lf = NOMINAL["pallet-load"].f * 0.94, ll = NOMINAL["pallet-load"].l * 0.94;
    if (!rich) {
      box(ctx, o, { f: 0, l: 0, z: z0 + hz / 2 }, { f: lf, l: ll, z: hz }, cosH, sinH, u.x, u.y, lid, kraft, true);
      return;
    }
    // Three tiers of two cartons: the honest look of a hand-stacked
    // pallet, and enough height that the load reads as a LOAD under the
    // 2.5D view's vertical compression, not as a bare deck.
    const tiers = 3;
    const tierZ = hz / tiers;
    for (let t = 0; t < tiers; t++) {
      for (let c = 0; c < 2; c++) {
        const f = (c - 0.5) * (lf / 2);
        box(ctx, o, { f: f, l: 0, z: z0 + tierZ * t + tierZ / 2 },
          { f: lf / 2 - 0.02, l: ll, z: tierZ - 0.015 }, cosH, sinH, u.x, u.y, lid, kraft, true);
      }
    }
    // Stretch wrap: film bands round the load. Drawn as bands, not a
    // tinted overlay, so the kraft under them still reads.
    ctx.save();
    ctx.strokeStyle = mat("band", theme);
    ctx.globalAlpha = 0.7;
    for (let b = 1; b <= 3; b++) {
      const z = z0 + (hz * b) / 4;
      const hf = lf / 2, hl = ll / 2;
      const corners = [[-hf, -hl], [hf, -hl], [hf, hl], [-hf, hl]];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const q = pt(o, corners[i][0], corners[i][1], z, cosH, sinH, u.x, u.y);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw ONE unit.
   * opts = {
   *   project(wx, wy, wz) -> {x, y}   REQUIRED (top-down or iso)
   *   cellPx    base px per world cell (line widths, scaled by the
   *             caller's own zoom transform like every other overlay)
   *   tier      "rich" | "glyph" | "icon" (WT.shapes.detailLevel)
   *   theme     "light" | "dark"
   *   stageColor  the flow-stage colour (the contact-shadow tint + the
   *               icon-tier mark, so the legend still reads)
   *   congest     the congestion colour for a unit in a hot queue
   * }
   * Returns true when something was drawn.
   */
  function draw(ctx, u, opts) {
    const o = opts || {};
    if (!ctx || typeof o.project !== "function" || !u) return false;
    if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.z) || !isFinite(u.heading)) return false;
    const tier = o.tier === "rich" ? "rich" : o.tier === "icon" ? "icon" : "glyph";
    const cell = isFinite(o.cellPx) && o.cellPx > 0 ? o.cellPx : 20;
    const theme = o.theme === "dark" ? "dark" : "light";
    const stageCol = o.stageColor || "#8a9096";

    // Icon tier: a single cheap mark. Zoomed this far out a pallet is
    // less than a pixel across - the honest read is "a unit is here".
    if (tier === "icon") {
      const c = o.project(u.x, u.y, u.z + u.size.z * 0.5);
      const s = Math.max(2.4, cell * 0.34), h = s / 2;
      ctx.fillStyle = stageCol;
      ctx.fillRect(c.x - h, c.y - h, s, s);
      return true;
    }

    const rich = tier === "rich";
    const cosH = Math.cos(u.heading), sinH = Math.sin(u.heading);
    const ink = mat("ink", theme);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.6, cell * 0.022);

    // The unit is standing on something: say so.
    shadow(ctx, o, u, cosH, sinH, rgbaOf(stageCol, theme === "dark" ? 0.34 : 0.26));

    const z0 = u.z;
    if (u.form === "pallet") {
      drawPallet(ctx, o, u, cosH, sinH, theme, rich, z0);
    } else if (u.form === "pallet-load") {
      const deck = drawPallet(ctx, o, u, cosH, sinH, theme, rich, z0);
      drawCartonStack(ctx, o, u, cosH, sinH, theme, rich, deck, z0 + u.size.z);
    } else if (u.form === "tote") {
      const S = u.size;
      const plastic = mat(((u.id | 0) % 5) === 0 ? "toteRed" : "toteBlue", theme);
      box(ctx, o, { f: 0, l: 0, z: z0 + S.z / 2 }, S, cosH, sinH, u.x, u.y,
        shadeUp(plastic, theme), plastic, true);
      if (rich) {
        // The moulded lip round the rim + the two hand grips.
        const zt = z0 + S.z;
        const hf = S.f / 2 * 0.86, hl = S.l / 2 * 0.86;
        ctx.beginPath();
        const cs = [[-hf, -hl], [hf, -hl], [hf, hl], [-hf, hl]];
        for (let i = 0; i < 4; i++) {
          const q = pt(o, cs[i][0], cs[i][1], zt - 0.012, cosH, sinH, u.x, u.y);
          if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.stroke();
        line(ctx, o, [-S.f / 2, -S.l * 0.18, zt - 0.06], [-S.f / 2, S.l * 0.18, zt - 0.06], cosH, sinH, u.x, u.y);
        line(ctx, o, [S.f / 2, -S.l * 0.18, zt - 0.06], [S.f / 2, S.l * 0.18, zt - 0.06], cosH, sinH, u.x, u.y);
      }
    } else {
      // carton / parcel: kraft board with a taped seam (and a label on
      // the parcel, which is what makes an outbound parcel a parcel).
      const S = u.size;
      const kraft = mat("carton", theme), lid = mat("cartonTop", theme);
      box(ctx, o, { f: 0, l: 0, z: z0 + S.z / 2 }, S, cosH, sinH, u.x, u.y, lid, kraft, true);
      if (rich) {
        const zt = z0 + S.z;
        line(ctx, o, [-S.f / 2, 0, zt], [S.f / 2, 0, zt], cosH, sinH, u.x, u.y);
        if (u.form === "parcel") {
          const lw = S.f * 0.34, lh = S.l * 0.44;
          const cs = [[-lw / 2, -lh / 2], [lw / 2, -lh / 2], [lw / 2, lh / 2], [-lw / 2, lh / 2]];
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const q = pt(o, S.f * 0.2 + cs[i][0], cs[i][1], zt + 0.002, cosH, sinH, u.x, u.y);
            if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
          }
          ctx.closePath();
          ctx.fillStyle = mat("band", theme);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // A unit stuck in a CONGESTED queue is outlined in the plant's
    // congestion colour - the same signal the station badge carries.
    if (u.hot && o.congest) {
      ctx.strokeStyle = o.congest;
      ctx.lineWidth = Math.max(1.2, cell * 0.04);
      const S = u.size, hf = S.f / 2, hl = S.l / 2, zt = z0 + S.z;
      const cs = [[-hf, -hl], [hf, -hl], [hf, hl], [-hf, hl]];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const q = pt(o, cs[i][0], cs[i][1], zt, cosH, sinH, u.x, u.y);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
    return true;
  }

  // #rrggbb (or any css colour) -> rgba at alpha `a`. Falls back to the
  // input when the colour is not a plain hex.
  function rgbaOf(hex, a) {
    const S = WT.shapes;
    if (S && S.colors && typeof S.colors.rgba === "function" && /^#[0-9a-fA-F]{6}$/.test(String(hex))) {
      return S.colors.rgba(hex, a);
    }
    return hex;
  }

  /* ------------------------------------------------------------------
   * Convenience for the renderer: draw a whole list in painter's order.
   * Returns how many were drawn.
   * ------------------------------------------------------------------ */
  function drawAll(ctx, list, opts) {
    let n = 0;
    for (let i = 0; i < (list || []).length; i++) if (draw(ctx, list[i], opts)) n++;
    return n;
  }

  /* ------------------------------------------------------------------
   * The honest one-line description of what a unit IS at a stage - used
   * by the UI legend so the words on screen and the forms on the canvas
   * come from the SAME table.
   * ------------------------------------------------------------------ */
  function stageLabel(stage) {
    const f = STAGE_FORM[stage];
    return f === "pallet-load" ? "pallet-load"
      : f === "carton" ? "carton"
        : f === "tote" ? "tote"
          : f === "parcel" ? "parcel" : "unit";
  }

  const HONESTY =
    "SYNTHETIC illustrative rendering of the EXISTING material-flow animation: " +
    "the goods are drawn as the physical handling units they represent (EUR " +
    "pallet-load, kraft carton, plastic tote, packed parcel) riding the surface " +
    "that carries them. It adds NO model and NO number - every unit drawn is one " +
    "MU the flow sim already spawned. UNITS ARE CONSERVED: a pallet-load becoming " +
    "cartons is a change of FORM ONLY, one MU stays one MU. Handling-unit sizes " +
    "are NOMINAL generic dimensions used as drawing constants, NOT a specification " +
    "and NOT a capacity claim. NOT CAD/BIM geometry, NOT a survey, NOT a " +
    "measurement and NOT a certification.";

  WT.goods = {
    NOMINAL, FORMS, STAGE_FORM, STAGE_ORDER, TRANSFORMS, PALLET,
    NOSE_GAP, BENCH_TOP, DECK_TOP, MAX_FORM_UNITS, MAX_VEHICLES,
    VEHICLE_TYPES, BELT_TYPES, DECK_TYPES, BENCH_TYPES,
    HONESTY,
    // model (pure)
    formFor, sizeOf, supportIndex, supportAt, carrierOf,
    queueTrail, sample, units,
    vehicles, sampleVehicle,
    rackStock,
    stageLabel,
    // drawing
    draw, drawAll,
    // exposed for tests / reuse (pure)
    tri, frac, hash01, seedOf, heightOf,
  };
})();
