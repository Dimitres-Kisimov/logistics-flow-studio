/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * flowsim.js - Live material-flow animation model (P3 / P3.2)
 * ---------------------------------------------------------------------
 * A DETERMINISTIC, seeded animated material-flow model over the CURRENT
 * layout. Boxes / handling units ("MUs") spawn at receiving, travel
 * through the warehouse and retire at shipping, so the app can render a
 * lightweight "live plant" view of goods moving over time.
 *
 * The visible path is the standard flow spine:
 *
 *   receiving -> storage -> picking -> packing -> shipping
 *
 * Each stage's waypoint is a WORLD-CELL centroid derived from the layout
 * (dock-in doors, storage racking, pick faces, pack stations, dock-out
 * doors).
 *
 * P3.2 - MATERIAL-FLOW REALISM (built ON TOP of the P3 model, same API):
 *   1. STATIONS as active objects. Pick faces, staging (put-away) and
 *      pack stations become active servers: each has a SERVICE RATE
 *      (units/tick, taken from the documented wms.js stage capacity,
 *      divided across the stations of that stage) and a FIFO QUEUE. An MU
 *      arriving at a station joins its shortest queue and is served at the
 *      service rate; when arrivals exceed service the queue GROWS
 *      (congestion emerges). Units are conserved: spawned == in-flight
 *      (active + queued) + completed at EVERY step.
 *   2. CONVEYOR-FOLLOWING routing. Where conveyor / track cells form a
 *      connected path between the storage and picking waypoints, the MU
 *      travels ALONG the centres of those cells (a polyline discovered by
 *      a deterministic BFS over adjacent conveyor cells) so boxes ride the
 *      automation instead of cutting a straight line. If no connected
 *      conveyor path exists it FALLS BACK to the original straight-segment
 *      routing (optionally via a single conveyor/RGV/AGV centroid) -
 *      behaviour unchanged.
 *   3. CONGESTION. Each station reports its queue length; the state
 *      exposes queued / maxQueue / congestedStations for the UI to draw
 *      badges and colour congestion (a queue >= congestQueueThreshold is
 *      "congested"). All heuristic, all transparent.
 *
 * HONESTY (load-bearing, mirrored in the UI + README):
 *   - EVERYTHING here is SYNTHETIC. This is a transparent teaching
 *     ANIMATION, NOT a real discrete-event-simulation (DES) engine, NOT a
 *     measurement of any real operation and NOT a certification.
 *   - The stations are a HEURISTIC: FIFO servers whose service rates are
 *     the documented wms.js stage capacities (order-of-magnitude teaching
 *     assumptions, not vendor specs) split across the stations of a stage.
 *     This is NOT queueing theory and NOT a DES engine.
 *   - Conveyor-following routing is a greedy/BFS walk over adjacent
 *     conveyor cells, NOT real pathfinding and NOT collision-aware. The
 *     honest FALLBACK is the original straight-segment waypoint routing.
 *   - Throughput / speed come from the documented wms.js heuristic
 *     (PARAMS there are order-of-magnitude assumptions), not vendor specs.
 *
 * v3.25 - ORDER-DRIVEN ROUTING (R1, the engine). The spine above is no
 * longer the only path. Every MU now carries an ORDER ARCHETYPE, and each
 * archetype declares the OPERATION SEQUENCE it requires (routing.js /
 * WT.routing) rather than a fixed stage list:
 *
 *   full pallet out  receive -> QC sample -> put-away -> pallet pick ->
 *                    stretch-wrap -> load          (never packed)
 *   case pick        + depalletise + pack
 *   each/piece pick  + replenish + tote consolidation   (eight touches)
 *   cross-dock       receive -> QC -> staging -> load   (NEVER stored)
 *   returns          receive -> inspect -> restock OR scrap  (a real split)
 *   value-add        pick -> kitting/labelling -> pack -> load
 *   export/fragile   pick -> extra QC -> palletise -> wrap -> load
 *
 *   anchorIndex(layout)        resolve every operation's place on the floor.
 *                              The FIVE legacy anchors keep their exact v3.24
 *                              fallback chains; every anchor added here is
 *                              STRICT - no element, no fallback, no route.
 *   buildRouteWaypoints(...)   one route's polyline from its resolved steps.
 *                              Fed the LEGACY operation list it reproduces
 *                              buildWaypoints EXACTLY - that identity is what
 *                              makes the collapse byte-identical, and it is
 *                              asserted in verify_routing.js, not assumed.
 *   buildRoutes(...)           the plan's route set, the SPAWN vector and the
 *                              honest list of what this floor cannot do.
 *   routingReport(layout)      per-archetype fulfillability for a layout.
 *
 * An operation with NO station on the floor makes that order type
 * UNFULFILLABLE: it is reported with a friendly message naming the element
 * to place, and NO unit of that type is ever spawned. It is never skipped
 * and never re-routed (the process.js validateFlow / fluids.js discipline).
 *
 * Stations stay GLOBAL: two order types that both cross the pick face
 * contend for ONE physical FIFO queue, so congestion stays real. Which
 * archetype a unit is, is a deterministic largest-remaining-QUOTA dispatch
 * over the declared mix - the same rule process.js uses at a multi-way
 * split - so a route is a pure function of order identity and layout.
 *
 * BACKWARD COMPATIBILITY IS A HARD GATE: with NO mix declared the plan
 * carries exactly ONE route, the legacy spine, whose waypoint array IS the
 * plan's own `waypoints`. Behaviour is byte-identical to v3.24.
 * * Determinism: same (layout, seed, ticks) -> byte-identical MU positions,
 * queue contents and counters. All randomness flows through a seeded
 * mulberry32-style PRNG carried inside the state; no Date, no Math.random.
 * Verified in verify_flowsim.js + verify_flowB.js.
 *
 * Conserves units: at every step spawned == in-flight + completed, where
 * in-flight counts both moving AND queued MUs.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Depends on domain.js (WT.domain) and wms.js (WT.wms).
 * No frameworks, no build step, fully offline.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const D = WT.domain;

  /* ------------------------------------------------------------------
   * The 5 visible flow stages, in order. These are the zone keys the
   * generator/examples already use, so the animation lines up with the
   * layout's functional zones. MU colours (in the app) key off these.
   * ------------------------------------------------------------------ */
  const STAGES = ["receiving", "storage", "picking", "packing", "shipping"];

  const SYNTHETIC_LABEL =
    "SYNTHETIC live material-flow ANIMATION - a transparent teaching model, " +
    "NOT a real discrete-event-simulation engine, NOT a measurement and NOT a " +
    "certification. Pick/put/pack stations are heuristic FIFO servers whose " +
    "service rates come from the documented wms.js stage capacities (order-of-" +
    "magnitude assumptions, not vendor specs) split across the stations of a " +
    "stage; queues are simple FIFO congestion, NOT a queueing-theory / DES " +
    "model. Routing follows connected conveyor cells where a path exists and " +
    "falls back to straight-segment waypoint routing between zone centroids; " +
    "spawn/completion rate and travel speed follow the documented wms.js " +
    "throughput heuristic (order-of-magnitude assumptions, not vendor specs).";

  /* ------------------------------------------------------------------
   * SYNTHETIC animation parameters. All transparent teaching values.
   * ------------------------------------------------------------------ */
  const PARAMS = {
    ticksPerHour: 60, // sim ticks that stand for one hour (maps wms units/hr -> units/tick)
    cellsPerTick: 0.35, // base MU travel speed (world cells per tick) before automation lift
    autoBoostPerLane: 0.12, // each automation lane speeds internal flow (mirrors the wms idea)
    autoFactorMax: 2.2, // cap the automation speed multiplier so it stays sane
    jitterCells: 0.55, // lateral spread so many boxes don't stack on one centreline
    spawnNoiseLo: 0.7, // seeded per-tick arrival ripple (same band as wms arrivals)...
    spawnNoiseHi: 1.3, // ...upper bound
    shipDwellTicks: 8, // a unit lingers at the outbound dock (being loaded) before retiring
    defaultOrders: 300, // order pool when the caller gives none
    linesPerOrderMax: 6, // avg lines/order = 3.5 -> units/order (matches sim/wms defaults)
    minLineThroughput: 8, // floor so a sparse layout still animates (units/hr)
    maxInFlight: 600, // soft cap on live MUs (perf guard; never breaks conservation)
    maxTicksPerStep: 600, // clamp one step() so a huge dt can't hang the loop
    boundMargin: 0.15, // keep drawn MUs this far inside the floor edge (cells)
    // P3.2 station / queue parameters (synthetic teaching values).
    minStationServicePerTick: 0.02, // floor so a station always eventually drains its queue
    congestQueueThreshold: 6, // a station queue >= this is drawn/counted as "congested"
    queueStackOffset: 0.16, // world-cell spacing between stacked queued MUs (drawing)
    queueStackMax: 8, // cap the drawn stack length so a huge queue can't run off-station
  };

  /* ------------------------------------------------------------------
   * Seeded PRNG (mulberry32), functional form: takes and returns the
   * integer state so the whole sim stays pure/deterministic given state.
   * ------------------------------------------------------------------ */
  function nextRand(s) {
    let a = s.rngState | 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    s.rngState = a >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ------------------------------------------------------------------
   * Layout geometry helpers (pure). All in WORLD CELLS.
   * ------------------------------------------------------------------ */
  function centroidOf(els, pred) {
    let sx = 0, sy = 0, n = 0;
    for (const e of els) {
      if (!pred(e)) continue;
      sx += e.x + e.w / 2;
      sy += e.y + e.d / 2;
      n++;
    }
    return n ? { x: sx / n, y: sy / n } : null;
  }

  function isStorage(e) {
    const def = (D && D.ELEMENTS[e.type]) || {};
    return def.category === "storage";
  }
  function isPickFace(e) {
    const def = (D && D.ELEMENTS[e.type]) || {};
    return !!def.pickFace || !!def.goodsToPerson || e.type === "pallet-flow";
  }
  // The BASE behaviour class DECLARED by a type's def - user-defined
  // (library.js) custom objects AND the v2.5 FACTORY-A manufacturing
  // built-ins (Source/Drain -> "dock", the Station family -> "station").
  // Warehouse built-ins declare NO `base`, so every base-aware branch below
  // is a strict NO-OP for a warehouse-only layout - the flow sim stays
  // byte-identical (the new types are additive). Defensive: any missing
  // domain / def yields null.
  function baseOf(e) {
    const els = WT.domain && WT.domain.ELEMENTS;
    const def = els && e && els[e.type];
    return def && typeof def.base === "string" ? def.base : null;
  }
  // A user-defined DOCK's flow direction ("receiving" | "shipping" | null).
  function dockDir(e) {
    return baseOf(e) === "dock" ? (WT.domain.ELEMENTS[e.type].io === "receiving" ? "receiving" : "shipping") : null;
  }

  function isTransport(e) {
    if (e.type === "conveyor" || e.type === "conveyor-curve" || e.type === "rgv" || e.type === "agv" || e.type === "track") return true;
    const b = baseOf(e); // custom conveying / transporter objects CARRY loads
    return b === "conveyor" || b === "transporter";
  }

  // Cell types that form a conveyor-following PATH (a box can ride ALONG
  // these). Same movement family as isTransport; documented as synthetic.
  // The curved conveyor rides here too, so a box turns the corner ALONG the arc.
  const CONVEYOR_CELL_TYPES = { conveyor: 1, "conveyor-curve": 1, track: 1, rgv: 1, agv: 1 };
  function isConveyorCellEl(e) {
    if (CONVEYOR_CELL_TYPES[e.type]) return true;
    const b = baseOf(e);
    return b === "conveyor" || b === "transporter";
  }

  // Zone-rect centre from layout.meta.zones (generator/examples metadata),
  // used only as a secondary fallback when a stage has no elements.
  function zoneCentre(layout, key) {
    const zs = layout && layout.meta && layout.meta.zones;
    if (!Array.isArray(zs)) return null;
    const z = zs.find((q) => q.key === key);
    return z ? { x: z.x + z.w / 2, y: z.y + z.d / 2 } : null;
  }

  function clampPt(p, gridW, gridH) {
    const m = PARAMS.boundMargin;
    return {
      x: Math.max(m, Math.min(gridW - m, p.x)),
      y: Math.max(m, Math.min(gridH - m, p.y)),
    };
  }

  /* ==================================================================
   * CONVEYOR-FOLLOWING ROUTING (P3.2). Deterministic walk over adjacent
   * conveyor / track cells - NOT pathfinding, NOT collision-aware.
   * ================================================================== */

  // Expand every conveyor/track/rgv/agv element into its unit CELLS. Each
  // cell is one grid square; its centre is (cx+0.5, cy+0.5) in world cells.
  // Returns a Map keyed "cx,cy" -> { cx, cy, x, y }.
  function conveyorCellSet(els) {
    const cells = new Map();
    for (const e of els || []) {
      if (!isConveyorCellEl(e)) continue;
      const x0 = Math.round(e.x), y0 = Math.round(e.y);
      const w = Math.max(1, Math.round(e.w || 1)), d = Math.max(1, Math.round(e.d || 1));
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < d; j++) {
          const cx = x0 + i, cy = y0 + j;
          const key = cx + "," + cy;
          if (!cells.has(key)) cells.set(key, { cx: cx, cy: cy, x: cx + 0.5, y: cy + 0.5 });
        }
      }
    }
    return cells;
  }

  // The conveyor cell whose centre is nearest a world point. Deterministic:
  // iterate keys in sorted order and keep the first strict minimum.
  function nearestCellKey(cells, pt) {
    let best = null, bestD = Infinity;
    const keys = Array.from(cells.keys()).sort();
    for (const k of keys) {
      const c = cells.get(k);
      const dx = c.x - pt.x, dy = c.y - pt.y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD - 1e-12) { bestD = dd; best = k; }
    }
    return best;
  }

  // Shortest path (in cells) between two conveyor cells over 4-neighbour
  // adjacency. Deterministic BFS (fixed neighbour order). Returns the list
  // of cell keys from start to goal, or null if disconnected.
  function bfsCellPath(cells, startKey, goalKey) {
    if (startKey == null || goalKey == null) return null;
    if (startKey === goalKey) return [startKey];
    const prev = new Map();
    prev.set(startKey, null);
    const q = [startKey];
    let head = 0;
    const NB = [[0, -1], [-1, 0], [1, 0], [0, 1]]; // up, left, right, down (fixed)
    while (head < q.length) {
      const k = q[head++];
      if (k === goalKey) break;
      const c = cells.get(k);
      for (let n = 0; n < NB.length; n++) {
        const nk = (c.cx + NB[n][0]) + "," + (c.cy + NB[n][1]);
        if (cells.has(nk) && !prev.has(nk)) { prev.set(nk, k); q.push(nk); }
      }
    }
    if (!prev.has(goalKey)) return null;
    const path = [];
    let cur = goalKey;
    while (cur != null) { path.push(cur); cur = prev.get(cur); }
    path.reverse();
    return path;
  }

  // Drop collinear intermediate points, keeping endpoints and turns. Every
  // kept point is still a conveyor-cell centre (a subset of the input).
  function simplifyPath(points) {
    if (points.length <= 2) return points.slice();
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = points[i + 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 1e-9) out.push(b);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // Route ALONG conveyor cells from `from` (near storage) to `to` (near
  // picking). Returns { points:[{x,y}], cells } or null when no conveyor
  // cells connect the two ends (caller falls back to straight routing).
  function conveyorRoute(els, from, to) {
    const cells = conveyorCellSet(els);
    if (!cells.size) return null;
    const startKey = nearestCellKey(cells, from);
    const goalKey = nearestCellKey(cells, to);
    const path = bfsCellPath(cells, startKey, goalKey);
    if (!path || !path.length) return null;
    const pts = path.map((k) => { const c = cells.get(k); return { x: c.x, y: c.y }; });
    return { cells: cells, points: simplifyPath(pts) };
  }

  // Public helper: the set of conveyor-cell centres for a layout (array).
  function conveyorCells(layout) {
    const cells = conveyorCellSet((layout && layout.elements) || []);
    return Array.from(cells.values());
  }

  /* ==================================================================
   * CURVED-CONVEYOR ARC SAMPLING (v2.1). A curved conveyor turns a belt run
   * 90 degrees around one corner of its footprint (the element's `arc`
   * orientation). The belt CENTRELINE is the quarter-arc through the midpoints
   * of the two edges adjacent to that corner - the same geometry shapes.js
   * draws. A box crossing a curved conveyor rides THIS arc (sampled points),
   * not the straight chord, so it follows the turn smoothly. PURE geometry -
   * NO Date, NO RNG. Deterministic and testable in isolation.
   * ================================================================== */
  const ARC_SAMPLES = 8; // segments the quarter-arc is split into for routing
  function arcCornerOf(el) {
    const a = el && el.arc;
    return (a === "br" || a === "bl" || a === "tl") ? a : "tr"; // default top-right
  }
  function curveGeomWorld(el) {
    const x = el.x, y = el.y;
    const w = Math.max(1, Math.round(el.w || 1)), d = Math.max(1, Math.round(el.d || 1));
    const c = arcCornerOf(el);
    const rx = w / 2, ry = d / 2;
    let cx, cy, a0, a1;
    if (c === "tr") { cx = x + w; cy = y; a0 = Math.PI; a1 = Math.PI / 2; }
    else if (c === "br") { cx = x + w; cy = y + d; a0 = -Math.PI / 2; a1 = -Math.PI; }
    else if (c === "bl") { cx = x; cy = y + d; a0 = 0; a1 = -Math.PI / 2; }
    else { cx = x; cy = y; a0 = 0; a1 = Math.PI / 2; }
    return { cx: cx, cy: cy, rx: rx, ry: ry, a0: a0, a1: a1 };
  }
  // Public: n+1 points sampled along the belt centreline arc of a curved
  // conveyor element (world cells), from one edge-midpoint port to the other.
  function curveArcPoints(el, n) {
    const steps = Math.max(2, (n | 0) || ARC_SAMPLES);
    const g = curveGeomWorld(el);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const ang = g.a0 + (g.a1 - g.a0) * (i / steps);
      pts.push({ x: g.cx + g.rx * Math.cos(ang), y: g.cy + g.ry * Math.sin(ang) });
    }
    return pts;
  }
  function curveElements(els) {
    const out = [];
    for (const e of els || []) if (e && e.type === "conveyor-curve") out.push(e);
    return out;
  }
  function pointInFootprint(p, e) {
    const x0 = Math.round(e.x), y0 = Math.round(e.y);
    const w = Math.max(1, Math.round(e.w || 1)), d = Math.max(1, Math.round(e.d || 1));
    return p.x >= x0 - 1e-6 && p.x <= x0 + w + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y0 + d + 1e-6;
  }
  function d2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  // Replace any routed cell-centre that falls inside a curved conveyor with the
  // element's quarter-arc centreline (oriented to the travel direction), so the
  // box follows the ARC instead of cutting a right-angle corner. Each arc point
  // is flagged onCurve. Only elements the polyline actually TURNS inside are
  // splied; a belt passing straight through is left untouched.
  function spliceCurveArcs(points, curves, prevPt) {
    const out = [];
    let prev = prevPt || (points.length ? points[0] : null);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let ce = null;
      for (const e of curves) { if (pointInFootprint(p, e)) { ce = e; break; } }
      if (ce) {
        let arc = curveArcPoints(ce, ARC_SAMPLES);
        if (prev && arc.length > 1 && d2(arc[arc.length - 1], prev) < d2(arc[0], prev)) arc = arc.slice().reverse();
        for (const a of arc) out.push({ x: a.x, y: a.y, onCurve: true });
        prev = arc[arc.length - 1];
      } else {
        out.push(p);
        prev = p;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * Build the ordered waypoint list (world cells) for a layout. Each
   * waypoint carries the flow STAGE a unit is performing while it travels
   * away from that waypoint. Straight segments connect them - EXCEPT the
   * storage->picking leg, which follows the conveyor cells when a
   * connected path exists (each inserted waypoint is a conveyor-cell
   * centre, flagged onConveyor).
   * ------------------------------------------------------------------ */
  function anchorIndex(layout) {
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, (layout && layout.gridW) || 40);
    const gridH = Math.max(1, (layout && layout.gridH) || 24);

    const receiving =
      centroidOf(els, (e) => e.type === "dock-in" || dockDir(e) === "receiving") ||
      zoneCentre(layout, "receiving") ||
      { x: gridW / 2, y: 1 };
    let storage =
      centroidOf(els, isStorage) ||
      zoneCentre(layout, "storage") ||
      { x: gridW / 2, y: gridH * 0.4 };
    // P4 retrieval: when a physical storage ASSIGNMENT rides on the layout
    // (WT.storage), the storage waypoint moves from the geometric centroid
    // of all racking to the velocity-weighted centroid of the ACTUAL slot
    // placements (fast movers pull it toward the golden zone), so the
    // storage->picking retrieval leg reflects real slotting. With no
    // assignment this whole block is skipped and behaviour is byte-
    // identical to before (guarded by verify_storage.js + verify_flowsim.js).
    let retrievalAnchored = false;
    const asg = layout && layout.storageAssignment;
    if (asg && WT.storage && typeof WT.storage.retrievalAnchor === "function") {
      try {
        const anchor = WT.storage.retrievalAnchor(asg);
        if (anchor && isFinite(anchor.x) && isFinite(anchor.y)) {
          storage = { x: anchor.x, y: anchor.y };
          retrievalAnchored = true;
        }
      } catch (_) { /* defensive: keep the plain centroid */ }
    }
    const packing =
      centroidOf(els, (e) => e.type === "pack-station" || baseOf(e) === "station") ||
      zoneCentre(layout, "packing") ||
      { x: gridW / 2, y: gridH - 4 };
    const shipping =
      centroidOf(els, (e) => e.type === "dock-out" || dockDir(e) === "shipping") ||
      zoneCentre(layout, "shipping") ||
      centroidOf(els, (e) => e.type === "dock-in" || dockDir(e) === "receiving") ||
      { x: gridW / 2, y: gridH - 1 };
    // Picking: pick faces if any, else the picking zone, else the mid
    // point between storage and packing (keeps the flow monotonic-ish).
    const picking =
      centroidOf(els, isPickFace) ||
      zoneCentre(layout, "picking") ||
      { x: (storage.x + packing.x) / 2, y: (storage.y + packing.y) / 2 };

    // ---- The five LEGACY anchors, with their v3.24 fallback chains intact.
    // The order above matters and is unchanged: storage is resolved (and
    // slotting-anchored) before packing, and picking falls back to the
    // midpoint of those two.
    const A = {};
    A["dock-in"] = { x: receiving.x, y: receiving.y, present: true, source: "element-or-zone", count: countOf(els, (e) => e.type === "dock-in" || dockDir(e) === "receiving") };
    A.storage = { x: storage.x, y: storage.y, present: true, source: retrievalAnchored ? "slotting" : "element-or-zone", count: countOf(els, isStorage) };
    A.pack = { x: packing.x, y: packing.y, present: true, source: "element-or-zone", count: countOf(els, (e) => e.type === "pack-station" || baseOf(e) === "station") };
    A["dock-out"] = { x: shipping.x, y: shipping.y, present: true, source: "element-or-zone", count: countOf(els, (e) => e.type === "dock-out" || dockDir(e) === "shipping") };
    A.pickface = { x: picking.x, y: picking.y, present: true, source: "element-or-zone", count: countOf(els, isPickFace) };

    // ---- The STRICT anchors added by the order-routing engine (v3.25). No
    // element, no route: there is NO zone fallback and NO geometric guess, so
    // an order type that needs one is honestly reported UNFULFILLABLE instead
    // of being quietly re-routed onto some other station.
    strictAnchor(A, "staging", els, (e) => e.type === "staging");
    strictAnchor(A, "qc", els, (e) => e.type === "returns-station");
    strictAnchor(A, "returns", els, (e) => e.type === "returns-station");
    strictAnchor(A, "wrap", els, (e) => e.type === "stretch-wrap");
    strictAnchor(A, "palletise", els, (e) => e.type === "stretch-wrap");
    // R2 pending: the app has NO element type for these yet, so they are
    // ALWAYS absent and every archetype needing one says so in plain words.
    A.depalletise = { x: NaN, y: NaN, present: false, source: "none", count: 0, pending: "R2" };
    A.vas = { x: NaN, y: NaN, present: false, source: "none", count: 0, pending: "R2" };

    A.gridW = gridW;
    A.gridH = gridH;
    A.retrievalAnchored = retrievalAnchored;
    return A;
  }

  function countOf(els, pred) {
    let k = 0;
    for (const e of els) if (pred(e)) k++;
    return k;
  }
  // A STRICT anchor: present ONLY when a real element carries it. No zone
  // metadata fallback, no geometric guess - the honest 'this floor cannot do
  // that operation' signal the router turns into a friendly message.
  function strictAnchor(A, id, els, pred) {
    const c = centroidOf(els, pred);
    A[id] = c
      ? { x: c.x, y: c.y, present: true, source: "element", count: countOf(els, pred) }
      : { x: NaN, y: NaN, present: false, source: "none", count: 0 };
    return A[id];
  }

  /* ------------------------------------------------------------------
   * Build the waypoint polyline for ONE resolved route (an ordered list of
   * router STEPS, each carrying its anchor point, stage, operation id and
   * serving station kind). Straight segments connect the steps, EXCEPT a
   * storage -> pick-face leg, which follows connected conveyor cells (and
   * rides a curved conveyor's arc) exactly as the v3.24 spine does.
   *
   * With the LEGACY operation list this reproduces the v3.24 waypoint spine
   * EXACTLY - that identity is what makes the legacy collapse byte-identical,
   * and it is asserted, not assumed, in verify_routing.js.
   * ------------------------------------------------------------------ */
  function buildRouteWaypoints(layout, steps) {
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, (layout && layout.gridW) || 40);
    const gridH = Math.max(1, (layout && layout.gridH) || 24);
    const wp = [];
    let routed = false;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      wp.push({ x: s.x, y: s.y, stage: s.stage, op: s.op, station: s.station || null });
      const nx = steps[i + 1];
      if (!nx) continue;
      // The one automated leg: reserve / storage -> pick face.
      if (!(s.anchor === "storage" && nx.anchor === "pickface")) continue;
      const route = conveyorRoute(els, s, nx);
      if (route && route.points.length) {
        // Where the route turns INSIDE a curved conveyor, ride the ARC (sampled
        // centreline) instead of the right-angle cell corner. Gated on a curved
        // conveyor being present, so a layout without one is BYTE-IDENTICAL.
        const curves = curveElements(els);
        const pts = curves.length ? spliceCurveArcs(route.points, curves, s) : route.points;
        // Intermediate conveyor points carry the FROM step's stage + operation
        // but NEVER a station: they are travel, not a server.
        for (const p of pts) wp.push({ x: p.x, y: p.y, stage: s.stage, op: s.op, station: null, onConveyor: true, onCurve: !!p.onCurve });
        routed = true;
      } else {
        const transport = centroidOf(els, isTransport);
        if (transport) wp.push({ x: transport.x, y: transport.y, stage: s.stage, op: s.op, station: null });
      }
    }

    // Clamp every waypoint inside the floor so MUs can never render off it.
    const out = wp.map((p) => {
      const c = clampPt(p, gridW, gridH);
      const o = { x: c.x, y: c.y, stage: p.stage, onConveyor: !!p.onConveyor };
      // Add onCurve ONLY when the waypoint rides a curved conveyor's arc, so a
      // layout without one keeps the exact prior waypoint shape (byte-identical).
      if (p.onCurve) o.onCurve = true;
      // v3.25 additive: which OPERATION the unit performs travelling away from
      // this point, and whether a station SERVES it here. Purely additive - no
      // existing reader looks at them.
      o.op = p.op || null;
      o.station = p.station || null;
      return o;
    });
    out.conveyorRouted = routed; // non-enumerable-ish flag (array property)
    return out;
  }

  // The LEGACY operation sequence, in flowsim's own terms. Mirrors
  // WT.routing.ARCHETYPE_BY_ID["legacy-spine"].ops and is duplicated here ONLY
  // so the animation never depends on routing.js being loaded (verify_routing.js
  // asserts the two lists are the same sequence).
  const LEGACY_STEPS = [
    { op: "receive", stage: "receiving", anchor: "dock-in", station: null },
    { op: "putaway", stage: "storage", anchor: "storage", station: "put" },
    { op: "pick", stage: "picking", anchor: "pickface", station: "pick" },
    { op: "pack", stage: "packing", anchor: "pack", station: "pack" },
    { op: "load", stage: "shipping", anchor: "dock-out", station: null },
  ];

  // Bind a proto step list to a resolved anchor index. Returns null when ANY
  // anchor is missing - the caller reports it, it never routes around it.
  function stepsFromAnchors(A, protoSteps) {
    const out = [];
    for (const p of protoSteps) {
      const a = A[p.anchor];
      if (!a || a.present === false || !isFinite(a.x) || !isFinite(a.y)) return null;
      out.push({ op: p.op, stage: p.stage, anchor: p.anchor, station: p.station || null, x: a.x, y: a.y });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * The v3.24 PUBLIC waypoint spine - unchanged in behaviour. It is now
   * expressed as "the legacy archetype's route", which is exactly what makes
   * the collapse provable: ONE code path with two callers.
   * ------------------------------------------------------------------ */
  function buildWaypoints(layout, anchorsIn) {
    const A = anchorsIn || anchorIndex(layout);
    const steps = stepsFromAnchors(A, LEGACY_STEPS);
    const out = buildRouteWaypoints(layout, steps);
    out.retrievalAnchored = !!A.retrievalAnchored; // P4: storage waypoint = real slotting anchor
    return out;
  }

  /* ==================================================================
   * ORDER-DRIVEN ROUTING (v3.25 R1). Until v3.24 EVERY handling unit was
   * pushed onto the one waypoint spine above. Now each unit carries the
   * ORDER ARCHETYPE it belongs to, and each archetype declares the
   * OPERATION SEQUENCE it needs (routing.js). This block resolves those
   * operations against the anchors the CURRENT layout actually has and
   * turns each one into its own waypoint polyline.
   *
   * THE HARD GATE: with NO mix declared the plan carries exactly ONE route
   * - the legacy spine - and its waypoint array IS the plan's own
   * `waypoints` array (the same object, not a copy). Every spawn then
   * resolves to route 0 and the sim is byte-identical to v3.24.
   *
   * A required operation with NO station on the floor makes that order type
   * UNFULFILLABLE: it is reported with a friendly message and NO unit of
   * that type is ever spawned. It is never skipped and never re-routed.
   * ================================================================== */

  // Group the station SPECS by kind so a route waypoint that declares a
  // serving station kind can bind to the real servers.
  function stationIndexByKind(specs) {
    const by = {};
    for (let i = 0; i < specs.length; i++) {
      const k = specs[i].kind;
      (by[k] = by[k] || []).push(i);
    }
    return by;
  }

  // segment index -> the station SPEC indices that serve the unit there.
  // Only set where servers actually exist, so the lookup stays falsy
  // elsewhere exactly as state.stationsByWp does today.
  function stationSegsOf(waypoints, byKind) {
    const map = {};
    for (let i = 0; i < waypoints.length; i++) {
      const k = waypoints[i] && waypoints[i].station;
      if (!k) continue;
      const idx = byKind[k];
      if (idx && idx.length) map[i] = idx.slice();
    }
    return map;
  }

  function makeRoute(index, res, waypoints, byKind) {
    return {
      index: index,
      routeId: res.routeId,
      archetype: res.id,
      outcome: res.outcome || null,
      outcomeLabel: res.outcomeLabel || null,
      label: res.label,
      short: res.short || res.label,
      legacy: !!res.legacy,
      ok: !!res.ok && !!waypoints && waypoints.length >= 2,
      ops: res.ops ? res.ops.slice() : [],
      steps: res.steps || [],
      missing: res.missing || [],
      shared: res.shared || [],
      message: res.message || '',
      neverStorage: !!res.neverStorage,
      touchesStorage: !!res.touchesStorage,
      waypoints: waypoints || [],
      conveyorRouted: !!(waypoints && waypoints.conveyorRouted),
      stationSegs: waypoints ? stationSegsOf(waypoints, byKind) : {},
    };
  }

  // The legacy route described WITHOUT routing.js, so the animation never
  // depends on the new layer being loaded (file:// robustness).
  function legacyRouteRes() {
    return {
      ok: true, id: LEGACY_ROUTE_ID, routeId: LEGACY_ROUTE_ID, outcome: null,
      label: 'Standard flow spine (legacy default)', short: 'Standard spine', legacy: true,
      ops: LEGACY_STEPS.map((p) => p.op), steps: null, missing: [], shared: [],
      message: '', neverStorage: false, touchesStorage: true,
    };
  }
  const LEGACY_ROUTE_ID = 'legacy-spine';

  /* Build every route the plan needs.
   *   routes[0] is ALWAYS the legacy spine and ALWAYS reuses `waypoints`.
   *   With a mix declared, each declared archetype (and each OUTCOME branch
   *   of a branching archetype) becomes its own route with its own polyline.
   * Returns the routes plus the SPAWN vector (fulfillable routes + shares)
   * and the honest report of what this floor cannot do. */
  function buildRoutes(layout, A, waypoints, specs, mixSpec) {
    const byKind = stationIndexByKind(specs || []);
    const routes = [makeRoute(0, legacyRouteRes(), waypoints, byKind)];
    const R = WT.routing;
    const norm = mixSpec != null && R && typeof R.normalizeMix === 'function' ? R.normalizeMix(mixSpec) : null;

    if (!norm || !norm.ok) {
      // No mix (or nothing recognisable in it): the v3.24 single spine.
      return {
        routes: routes, mix: null, spawnRoutes: [0], spawnShares: [1], spawnable: true,
        unfulfillable: [], messages: norm && norm.message ? [norm.message] : [],
        unknownTypes: (norm && norm.unknown) || [],
      };
    }

    const mix = [], spawnRoutes = [], spawnShares = [], unfulfillable = [], messages = [];
    const msgSeen = {}; // one friendly message per ORDER TYPE, not per outcome branch
    for (const ent of norm.entries) {
      // One route per OUTCOME branch: a return that is restocked and a return
      // that is scrapped are two different paths through the building.
      const arch = R.ARCHETYPE_BY_ID[ent.id];
      const branches = arch && arch.outcomes && arch.outcomes.length
        ? arch.outcomes.map((o) => ({ outcome: o.id, share: o.share }))
        : [{ outcome: null, share: 1 }];
      let bTotal = 0;
      for (const b of branches) bTotal += b.share > 0 ? b.share : 0;
      if (!(bTotal > 0)) bTotal = branches.length;
      for (const b of branches) {
        const res = R.resolveRoute(ent.id, A, { outcome: b.outcome });
        let idx = -1;
        if (ent.id === LEGACY_ROUTE_ID) {
          idx = 0; // reuse the spine object; never build it twice
        } else {
          const wps = res.ok ? buildRouteWaypoints(layout, res.steps) : null;
          idx = routes.length;
          routes.push(makeRoute(idx, res, wps, byKind));
        }
        const share = ent.share * ((b.share > 0 ? b.share : 0) / bTotal);
        const ok = routes[idx].ok;
        mix.push({ id: ent.id, outcome: b.outcome, routeId: routes[idx].routeId, routeIndex: idx, share: share, ok: ok });
        if (ok) { spawnRoutes.push(idx); spawnShares.push(share); }
        else {
          unfulfillable.push({ routeId: routes[idx].routeId, label: routes[idx].label, share: share, missing: routes[idx].missing, message: routes[idx].message });
          if (routes[idx].message && !msgSeen[ent.id]) { msgSeen[ent.id] = 1; messages.push(routes[idx].message); }
        }
      }
    }
    // Renormalise the shares over the routes this floor CAN actually run, so
    // the arrival rate is still fully used - the unfulfillable demand is
    // reported separately, never quietly absorbed into a wrong path.
    let tot = 0;
    for (const v of spawnShares) tot += v;
    if (tot > 0) for (let i = 0; i < spawnShares.length; i++) spawnShares[i] = spawnShares[i] / tot;
    return {
      routes: routes, mix: mix,
      spawnRoutes: spawnRoutes, spawnShares: spawnShares,
      spawnable: spawnRoutes.length > 0,
      unfulfillable: unfulfillable, messages: messages,
      unknownTypes: norm.unknown || [],
    };
  }

  // Largest-remaining-QUOTA branch pick - the SAME rule process.js uses at a
  // multi-way split. Deterministic, ties -> the earliest declared branch, NO
  // RNG: the k-th unit's order type is an exact function of k and the mix.
  function quotaPick(shares, sent, dispatched) {
    if (WT.routing && typeof WT.routing.pickBranch === 'function') return WT.routing.pickBranch(shares, sent, dispatched);
    let best = 0, bestDef = -Infinity;
    for (let i = 0; i < shares.length; i++) {
      const def = shares[i] * (dispatched + 1) - sent[i];
      if (def > bestDef + 1e-12) { bestDef = def; best = i; }
    }
    return best;
  }

  // Which ROUTE the next spawned unit walks. With one spawnable route this is
  // a constant 0 and the legacy behaviour is untouched.
  function pickSpawnRoute(state) {
    const plan = state.plan;
    const i = quotaPick(plan.spawnShares, state.mixSent, state.mixTotal);
    state.mixSent[i]++;
    state.mixTotal++;
    return plan.spawnRoutes[i];
  }

  // PUBLIC: the per-archetype FULFILLABILITY report for a layout - which order
  // types this floor can serve, which it cannot, and exactly why.
  function routingReport(layout) {
    if (!WT.routing || typeof WT.routing.resolveAll !== 'function') return null;
    return WT.routing.resolveAll(layout, { anchors: anchorIndex(layout) });
  }

  /* ------------------------------------------------------------------
   * Layout throughput / automation, taken from the WMS heuristic so the
   * animation stays consistent with the operations layer.
   * ------------------------------------------------------------------ */
  function throughputOf(layout, seed) {
    let caps = null;
    if (WT.wms && typeof WT.wms.capacities === "function") {
      try { caps = WT.wms.capacities(layout, { seed: seed }); } catch (_) { caps = null; }
    }
    const capByStage = {};
    let minCap = Infinity;
    if (caps && caps.length) {
      for (const c of caps) {
        const v = Number(c.capacityUnitsPerHr) || 0;
        capByStage[c.id] = v;
        if (v > 0 && v < minCap) minCap = v;
      }
    }
    if (!isFinite(minCap) || minCap <= 0) minCap = PARAMS.minLineThroughput;
    const lineThroughput = Math.max(PARAMS.minLineThroughput, minCap);

    const els = (layout && layout.elements) || [];
    let automationIndex = 0;
    for (const e of els) {
      if (e.type === "conveyor" || e.type === "conveyor-curve" || e.type === "rgv" || e.type === "agv" || e.type === "asrs" || e.type === "shuttle") automationIndex++;
    }
    const autoFactor = Math.min(PARAMS.autoFactorMax, 1 + PARAMS.autoBoostPerLane * automationIndex);
    return { caps: caps, capByStage: capByStage, lineThroughput: lineThroughput, automationIndex: automationIndex, autoFactor: autoFactor };
  }

  /* ------------------------------------------------------------------
   * Build the STATION specs (pure, deterministic). Pick faces, staging
   * (put-away) and pack stations become active servers. Each station's
   * service rate is its stage's wms capacity (units/hr) / ticksPerHour /
   * the count of stations of that stage - so the aggregate service rate of
   * a stage equals its wms capacity (throughput stays tied to WT.wms).
   *
   * A station GROUP is bound to the flow WAYPOINT its stage passes through
   * (put -> the storage waypoint, pick -> picking, pack -> packing); the
   * individual stations are anchored at their element footprints so their
   * queues can be drawn at the real elements.
   * ------------------------------------------------------------------ */
  function stationKind(kind, stage, wpIndex, elsList, capUnitsPerHr, gridW, gridH) {
    if (wpIndex < 0 || !elsList.length) return [];
    const n = elsList.length;
    const per = Math.max(
      PARAMS.minStationServicePerTick,
      (Math.max(0, capUnitsPerHr) / PARAMS.ticksPerHour) / n
    );
    return elsList.map((e, i) => {
      const c = clampPt({ x: e.x + (e.w || 1) / 2, y: e.y + (e.d || 1) / 2 }, gridW, gridH);
      return {
        id: kind + "-" + i,
        kind: kind, // "put" | "pick" | "pack"
        stage: stage, // the flow stage a unit is in while queued here
        wpIndex: wpIndex,
        x: c.x, y: c.y,
        serviceRatePerTick: per,
      };
    });
  }

  function buildStationSpecs(layout, waypoints, tp) {
    const els = (layout && layout.elements) || [];
    const gridW = Math.max(1, (layout && layout.gridW) || 40);
    const gridH = Math.max(1, (layout && layout.gridH) || 24);
    const cap = (tp && tp.capByStage) || {};

    const firstStage = (stage) => waypoints.findIndex((w) => w.stage === stage);
    const putWp = firstStage("storage"); // storage centroid waypoint (put-away)
    const pickWp = firstStage("picking");
    const packWp = firstStage("packing");

    const putEls = els.filter((e) => e.type === "staging");
    const pickEls = els.filter(isPickFace);
    // Custom STATION objects act as FIFO servers too - grouped with the pack
    // stage (the generic processing stage). No-op for built-in-only layouts.
    const packEls = els.filter((e) => e.type === "pack-station" || baseOf(e) === "station");

    const specs = [];
    Array.prototype.push.apply(specs, stationKind("put", "storage", putWp, putEls, cap["put-away"] || 0, gridW, gridH));
    Array.prototype.push.apply(specs, stationKind("pick", "picking", pickWp, pickEls, cap["order-picking"] || 0, gridW, gridH));
    Array.prototype.push.apply(specs, stationKind("pack", "packing", packWp, packEls, cap["packing"] || 0, gridW, gridH));
    return specs;
  }

  /* ------------------------------------------------------------------
   * spawnPlan(layout, opts) -> a PURE plan (waypoints + rates + pool +
   * stations). Deterministic function of (layout, seed). No live MUs.
   * ------------------------------------------------------------------ */
  function spawnPlan(layout, opts) {
    const o = opts || {};
    const cfg = (layout && layout.config) || {};
    const seed = (o.seed != null ? o.seed : (cfg.seed != null ? cfg.seed : 42)) >>> 0;
    const gridW = Math.max(1, (layout && layout.gridW) || 40);
    const gridH = Math.max(1, (layout && layout.gridH) || 24);

    const anchors = anchorIndex(layout);
    const waypoints = buildWaypoints(layout, anchors);
    const tp = throughputOf(layout, seed);
    const stations = buildStationSpecs(layout, waypoints, tp);
    // v3.25: per-order-type routes. `o.mix` absent -> the single legacy spine.
    const rb = buildRoutes(layout, anchors, waypoints, stations, o.mix != null ? o.mix : null);

    const orders = Math.max(1, Math.round(o.orders != null ? o.orders : PARAMS.defaultOrders));
    const avgUnits = (1 + (o.linesPerOrderMax || cfg.linesPerOrderMax || PARAMS.linesPerOrderMax)) / 2;
    const totalUnits = Math.max(1, Math.round(o.units != null ? o.units : orders * avgUnits));
    const loop = o.loop != null ? !!o.loop : true;

    // Optional what-if arrival override (units/hr). Default = the balanced
    // line rate (bottleneck, tied to WT.wms). Setting it ABOVE a station's
    // service rate lets congestion emerge - documented, honest what-if.
    const arrivalUnitsPerHr = o.arrivalUnitsPerHr != null && o.arrivalUnitsPerHr > 0
      ? Number(o.arrivalUnitsPerHr) : null;

    return {
      kind: "wt-flowsim-plan",
      seed: seed,
      gridW: gridW,
      gridH: gridH,
      waypoints: waypoints,
      conveyorRouted: !!waypoints.conveyorRouted,
      anchors: anchors, // resolved layout anchors (what each operation binds to)
      // v3.25 ORDER-DRIVEN ROUTING. routes[0] is always the legacy spine and
      // its waypoints ARE `waypoints` above, so an undeclared mix is a no-op.
      routes: rb.routes,
      mix: rb.mix, // null unless an order mix was declared
      spawnRoutes: rb.spawnRoutes, // route indices units are actually spawned onto
      spawnShares: rb.spawnShares, // matching shares, renormalised over the fulfillable
      spawnable: rb.spawnable, // false when NOTHING the caller asked for can be routed
      unfulfillable: rb.unfulfillable, // order types this floor cannot serve, with reasons
      routingMessages: rb.messages, // friendly, specific, user-facing
      unknownOrderTypes: rb.unknownTypes,
      stations: stations, // static specs; live queues live on the state
      caps: tp.caps,
      capByStage: tp.capByStage,
      lineThroughput: tp.lineThroughput, // units/hr (the bottleneck; drives spawn + completion)
      arrivalUnitsPerHr: arrivalUnitsPerHr, // null unless a what-if override is given
      automationIndex: tp.automationIndex,
      autoFactor: tp.autoFactor, // travel-speed multiplier
      ticksPerHour: PARAMS.ticksPerHour,
      cellsPerTick: PARAMS.cellsPerTick,
      totalUnits: totalUnits, // order pool size (drained unless loop)
      loop: loop,
      routingModel:
        "ORDER-DRIVEN per-unit routing (v3.25): every unit carries an order ARCHETYPE whose OPERATION SEQUENCE is resolved against the anchors this layout actually has, so a cross-dock unit never enters storage, a return runs counter-flow to restock or scrap, and a full pallet is never packed. An operation with no station on the floor makes that order type UNFULFILLABLE and is reported, never skipped and never re-routed. Route selection is a deterministic largest-remaining-quota dispatch over the declared mix (no RNG). With NO mix declared there is exactly one route - the v3.24 spine - and behaviour is unchanged. SYNTHETIC teaching recipes, NOT a WMS."
        ,
      routing:
        "conveyor-following polyline routing along connected conveyor/track cells " +
        "where a path exists between storage and picking; otherwise straight-segment " +
        "waypoint routing between zone centroids (optional conveyor/RGV/AGV centroid). " +
        "Pick/put/pack stations are FIFO servers (service rate from wms.js capacity); " +
        "NOT pathfinding and NOT a DES queueing model.",
      dataLabel: SYNTHETIC_LABEL,
    };
  }

  /* ------------------------------------------------------------------
   * state(planOrLayout, opts) -> a fresh LIVE simulation state at tick 0.
   * Accepts a plan (from spawnPlan) or a layout (plan is built for you).
   * ------------------------------------------------------------------ */
  function makeState(planOrLayout, opts) {
    const plan = planOrLayout && planOrLayout.kind === "wt-flowsim-plan"
      ? planOrLayout
      : spawnPlan(planOrLayout, opts);

    // Live stations: copy the specs and attach a mutable FIFO queue +
    // service accumulator. Index them by waypoint for O(1) enqueue.
    const stations = (plan.stations || []).map((s) => ({
      id: s.id, kind: s.kind, stage: s.stage, wpIndex: s.wpIndex,
      x: s.x, y: s.y, serviceRatePerTick: s.serviceRatePerTick,
      serviceAccum: 0, queue: [],
    }));
    const stationsByWp = {};
    for (const st of stations) {
      (stationsByWp[st.wpIndex] = stationsByWp[st.wpIndex] || []).push(st);
    }

    // v3.25: per-ROUTE lookups. routeWp[i] is route i's own waypoint list and
    // routeStations[i][seg] the LIVE servers waiting at that segment. The
    // stations themselves stay GLOBAL - two order types that both use the pick
    // face share ONE physical queue, which is what makes congestion real.
    const planRoutes = plan.routes || [];
    const routeWp = [], routeStations = [], perArchetype = {};
    for (let ri = 0; ri < planRoutes.length; ri++) {
      const r = planRoutes[ri];
      routeWp.push(r.waypoints);
      const segs = {};
      const src = r.stationSegs || {};
      for (const k in src) {
        const arr = [];
        for (const si of src[k]) if (stations[si]) arr.push(stations[si]);
        if (arr.length) segs[k] = arr;
      }
      routeStations.push(segs);
      perArchetype[r.routeId] = { routeId: r.routeId, archetype: r.archetype, outcome: r.outcome, label: r.label, spawned: 0, completed: 0, inflight: 0 };
    }
    const spawnShares = plan.spawnShares || [1];

    return {
      kind: "wt-flowsim-state",
      plan: plan,
      seed: plan.seed,
      gridW: plan.gridW,
      gridH: plan.gridH,
      tick: 0,
      tickAccum: 0, // fractional ticks carried between step() calls
      rngState: (plan.seed ^ 0x9e3779b9) >>> 0,
      mus: [], // live units (moving OR queued): {id, seg, t, cx, cy, stage, stageIndex, jitter, arrivedShip, dwell, status, station, stationId}
      nextId: 1,
      spawnAccum: 0, // fractional units carried between ticks
      spawned: 0, // total units ever spawned
      completed: 0, // total units retired at shipping
      poolRemaining: plan.totalUnits, // units left to spawn (ignored when loop)
      perStage: emptyStageCounts(),
      inflight: 0,
      stations: stations,
      stationsByWp: stationsByWp,
      queued: 0, // total MUs currently in any station queue
      maxQueue: 0, // longest single-station queue
      congestedStations: 0, // stations with queue >= congestQueueThreshold
      // v3.25 order-driven routing (all additive; inert with no mix declared).
      routeWp: routeWp,
      routeStations: routeStations,
      mixSent: spawnShares.map(() => 0), // quota dispatcher counters (deterministic)
      mixTotal: 0,
      perArchetype: perArchetype, // per-order-type spawned / completed / in-flight
      blocked: !plan.spawnable, // nothing the caller asked for can be routed here
      blockedReason: (plan.routingMessages || []).slice(),
      done: false,
      dataLabel: plan.dataLabel,
    };
  }

  function emptyStageCounts() {
    const c = {};
    for (const s of STAGES) c[s] = 0;
    return c;
  }

  function segLen(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
  }

  // World position of a MOVING MU on its current segment, with a small
  // fixed perpendicular offset (its jitter) so many units fan out visually.
  function positionOf(state, mu) {
    const wp = (state.routeWp && state.routeWp[mu.route]) || state.plan.waypoints;
    if (mu.arrivedShip) {
      const last = wp[wp.length - 1];
      return clampPt({ x: last.x, y: last.y }, state.gridW, state.gridH);
    }
    const a = wp[mu.seg], b = wp[mu.seg + 1];
    const L = segLen(a, b);
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L; // unit perpendicular
    const px = a.x + (b.x - a.x) * mu.t + nx * mu.jitter;
    const py = a.y + (b.y - a.y) * mu.t + ny * mu.jitter;
    return clampPt({ x: px, y: py }, state.gridW, state.gridH);
  }

  // World position of a QUEUED MU: stacked just "behind" (above) the
  // station anchor by its place in the queue, capped so a long queue never
  // runs off the station. Deterministic given the queue order.
  function queuedPosition(state, st, qIndex) {
    const k = Math.min(qIndex, PARAMS.queueStackMax);
    return clampPt({ x: st.x, y: st.y - PARAMS.queueStackOffset * k }, state.gridW, state.gridH);
  }

  // Join the SHORTEST queue of a station group (ties -> lowest station
  // index, which is the group's iteration order). Deterministic.
  function enqueueAt(state, mu, group) {
    let best = group[0];
    for (let i = 1; i < group.length; i++) {
      if (group[i].queue.length < best.queue.length) best = group[i];
    }
    best.queue.push(mu);
    mu.status = "queued";
    mu.station = best;
    mu.stationId = best.id;
    const p = queuedPosition(state, best, best.queue.length - 1);
    mu.cx = p.x; mu.cy = p.y;
  }

  /* ------------------------------------------------------------------
   * Advance exactly ONE tick (deterministic). Spawns from the pool at the
   * layout's arrival rate, SERVES station queues, moves every active MU
   * along its segments (queuing at pick/put/pack stations), dwells at the
   * outbound dock, then retires shipped units.
   * ------------------------------------------------------------------ */
  function advanceOneTick(state) {
    const plan = state.plan;
    const wp = plan.waypoints;

    // --- 1) Spawn ------------------------------------------------------
    const arrivalPerHr = plan.arrivalUnitsPerHr != null ? plan.arrivalUnitsPerHr : plan.lineThroughput;
    const ratePerTick = arrivalPerHr / plan.ticksPerHour; // units/tick
    const noise = PARAMS.spawnNoiseLo + (PARAMS.spawnNoiseHi - PARAMS.spawnNoiseLo) * nextRand(state);
    state.spawnAccum += ratePerTick * noise;
    while (state.spawnAccum >= 1) {
      // Nothing the caller asked for can be routed on this floor: spawn NOTHING
      // and let plan.routingMessages say why (never a silent wrong path).
      if (!plan.spawnable) { state.spawnAccum = 0; break; }
      if (!plan.loop && state.poolRemaining <= 0) { state.spawnAccum = 0; break; }
      if (state.mus.length >= PARAMS.maxInFlight) { break; } // perf soft cap (keeps conservation)
      state.spawnAccum -= 1;
      // WHICH ORDER TYPE this unit is - deterministic quota dispatch, no RNG,
      // resolved BEFORE the jitter draw so the PRNG sequence is untouched.
      const rIdx = pickSpawnRoute(state);
      const rwp = state.routeWp[rIdx] || wp;
      const jitter = (nextRand(state) - 0.5) * 2 * PARAMS.jitterCells;
      const mu = {
        id: state.nextId++,
        seg: 0, t: 0,
        stage: rwp[0].stage, stageIndex: STAGES.indexOf(rwp[0].stage),
        jitter: jitter,
        arrivedShip: false, dwell: 0,
        status: "active",
        station: null, stationId: null,
        cx: 0, cy: 0,
        // v3.25: the unit's OWN route through the building.
        route: rIdx,
        archetype: (plan.routes[rIdx] && plan.routes[rIdx].routeId) || LEGACY_ROUTE_ID,
        op: rwp[0].op || null,
      };
      const p = positionOf(state, mu);
      mu.cx = p.x; mu.cy = p.y;
      state.mus.push(mu);
      state.spawned++;
      const pa0 = state.perArchetype[mu.archetype];
      if (pa0) pa0.spawned++;
      if (!plan.loop) state.poolRemaining--;
    }

    // --- 2) Serve station queues (before movement, so a served MU can
    // move on the same tick). Each station releases floor(serviceAccum)
    // head-of-line MUs; an idle station banks at most ~1 unit of service.
    for (const st of state.stations) {
      st.serviceAccum += st.serviceRatePerTick;
      while (st.serviceAccum >= 1 && st.queue.length) {
        const mu = st.queue.shift();
        mu.status = "active";
        mu.station = null;
        mu.stationId = null;
        st.serviceAccum -= 1;
      }
      if (st.queue.length === 0 && st.serviceAccum > 1) st.serviceAccum = 1;
    }

    // --- 3) Move / queue / dwell / retire -----------------------------
    const speed = plan.cellsPerTick * plan.autoFactor; // world cells this tick
    const survivors = [];
    for (const mu of state.mus) {
      const rwp = state.routeWp[mu.route] || wp;
      const lastSeg = rwp.length - 2; // index of this ROUTE's final segment
      if (mu.arrivedShip) {
        mu.dwell--;
        if (mu.dwell <= 0) {
          state.completed++;
          const paC = state.perArchetype[mu.archetype];
          if (paC) paC.completed++;
          continue; // retire
        }
        const p = positionOf(state, mu);
        mu.cx = p.x; mu.cy = p.y;
        survivors.push(mu);
        continue;
      }
      if (mu.status === "queued") {
        // Hold at the station, restacked to its live queue position.
        const st = mu.station;
        const idx = st ? st.queue.indexOf(mu) : 0;
        const p = queuedPosition(state, st, idx < 0 ? 0 : idx);
        mu.cx = p.x; mu.cy = p.y;
        survivors.push(mu);
        continue;
      }

      let remaining = speed;
      let guard = 0;
      let queuedNow = false;
      while (remaining > 0 && !mu.arrivedShip && guard++ < rwp.length + 2) {
        const a = rwp[mu.seg], b = rwp[mu.seg + 1];
        const L = segLen(a, b);
        const need = (1 - mu.t) * L; // distance left on this segment
        if (remaining >= need) {
          remaining -= need;
          mu.seg++;
          mu.t = 0;
          if (mu.seg >= lastSeg + 1) {
            // reached this route's FINAL waypoint (the trailer for an outbound
            // order, the returns bench for a write-off, the racking for a restock)
            const term = rwp[rwp.length - 1];
            mu.arrivedShip = true;
            mu.stage = term.stage;
            mu.stageIndex = STAGES.indexOf(term.stage);
            mu.op = term.op || mu.op;
            mu.dwell = PARAMS.shipDwellTicks;
          } else {
            mu.stage = rwp[mu.seg].stage;
            mu.stageIndex = STAGES.indexOf(mu.stage);
            mu.op = rwp[mu.seg].op || mu.op;
            // Station at this waypoint? Join its queue and stop advancing.
            const group = (state.routeStations[mu.route] || state.stationsByWp)[mu.seg];
            if (group && group.length) {
              enqueueAt(state, mu, group);
              queuedNow = true;
              remaining = 0;
              break;
            }
          }
        } else {
          mu.t += remaining / L;
          remaining = 0;
        }
      }
      if (queuedNow) { survivors.push(mu); continue; } // position set by enqueueAt
      const p = positionOf(state, mu);
      mu.cx = p.x; mu.cy = p.y;
      survivors.push(mu);
    }
    state.mus = survivors;

    // --- 4) Live counters (stage mix + queue/congestion) --------------
    const counts = emptyStageCounts();
    const pa = state.perArchetype;
    for (const k in pa) pa[k].inflight = 0;
    for (const mu of state.mus) {
      counts[mu.stage] = (counts[mu.stage] || 0) + 1;
      const r = pa[mu.archetype];
      if (r) r.inflight++;
    }
    state.perStage = counts;
    state.inflight = state.mus.length; // includes queued MUs
    refreshQueueStats(state);
    state.tick++;
    if (!plan.loop && (state.poolRemaining <= 0 || !plan.spawnable) && state.mus.length === 0) state.done = true;
  }

  // Roll up per-station queue lengths into the state's congestion scalars.
  function refreshQueueStats(state) {
    let queued = 0, maxQ = 0, congested = 0;
    const thr = PARAMS.congestQueueThreshold;
    for (const st of state.stations) {
      const q = st.queue.length;
      queued += q;
      if (q > maxQ) maxQ = q;
      if (q >= thr) congested++;
    }
    state.queued = queued;
    state.maxQueue = maxQ;
    state.congestedStations = congested;
  }

  /* ------------------------------------------------------------------
   * step(state, dtTicks) -> advances the sim by dtTicks (may be
   * fractional; whole ticks are applied, the remainder carries). Returns
   * the SAME (mutated) state for chaining. Deterministic.
   * ------------------------------------------------------------------ */
  function step(state, dtTicks) {
    if (!state || state.kind !== "wt-flowsim-state") return state;
    let dt = Number(dtTicks);
    if (!(dt > 0)) dt = 0;
    state.tickAccum += dt;
    let budget = PARAMS.maxTicksPerStep;
    while (state.tickAccum >= 1 && budget-- > 0) {
      advanceOneTick(state);
      state.tickAccum -= 1;
    }
    // Refresh positions/counters even on a sub-tick call so a fresh state
    // reports a consistent snapshot without having advanced a whole tick.
    if (state.tick === 0) {
      state.inflight = state.mus.length;
      state.perStage = emptyStageCounts();
      for (const mu of state.mus) state.perStage[mu.stage] = (state.perStage[mu.stage] || 0) + 1;
      refreshQueueStats(state);
    }
    return state;
  }

  WT.flowsim = {
    STAGES: STAGES,
    PARAMS: PARAMS,
    SYNTHETIC_LABEL: SYNTHETIC_LABEL,
    spawnPlan: spawnPlan,
    state: makeState,
    step: step,
    // exposed for the UI legend / tests (pure helpers)
    buildWaypoints: buildWaypoints,
    throughputOf: throughputOf,
    buildStationSpecs: buildStationSpecs,
    // v3.25 ORDER-DRIVEN ROUTING (R1). All pure + deterministic.
    anchors: anchorIndex, // the layout anchors every operation binds to
    buildRouteWaypoints: buildRouteWaypoints, // one route's polyline from its steps
    buildRoutes: buildRoutes, // the plan's route set + spawn vector + honest gaps
    routingReport: routingReport, // per-archetype fulfillability for a layout
    quotaPick: quotaPick, // the deterministic split rule (shared with process.js)
    LEGACY_STEPS: LEGACY_STEPS,
    LEGACY_ROUTE_ID: LEGACY_ROUTE_ID,
    conveyorCells: conveyorCells,
    conveyorRoute: conveyorRoute,
    // v2.1: quarter-arc centreline samples for a curved conveyor element (world
    // cells) - the path a box rides through the turn. Pure + deterministic.
    curveArcPoints: curveArcPoints,
  };
})();
