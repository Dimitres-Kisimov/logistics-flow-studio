/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * floor.js - realistic floor/facility rendering geometry (v1.12).
 * ---------------------------------------------------------------------
 * A tiny, DOM-FREE math module - the SINGLE source of truth for the
 * "reads like a real facility" layer that app.js paints under and around
 * the elements: the two-tier grid LOD, the edge SCALE RULER, per-element
 * DIMENSION labels, and the faint FLOOR MARKINGS (facility perimeter,
 * aisle centre guides, dock-approach hatching, functional zone tints).
 *
 * Everything here is a PURE, DETERMINISTIC function of the floor size +
 * the element list (integer-metre cells; METRES_PER_CELL = 1). NO Date,
 * NO Math.random, NO DOM. That keeps the visuals reproducible and lets
 * verify_floor.js exercise every geometry path headlessly - exactly as
 * view.js is covered by verify_view.js. app.js consumes these results and
 * does the actual canvas strokes.
 *
 * HONESTY: this is an ILLUSTRATIVE facility rendering of a SYNTHETIC
 * model. The "measurements" are the model's own metre grid (1 cell = 1 m)
 * - NOT a site survey, NOT CAD/BIM. The real geometry path is the IFC
 * export. No real brands.
 *
 * Attaches to the global `WT` namespace so it works from file:// as a
 * classic script (not an ES module).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  /* ------------------------------------------------------------------
   * Grid tiers + level-of-detail thresholds.
   *   - MAJOR_STEP_M : major (strong) grid lines + ruler ticks, every 5 m.
   *   - MINOR_STEP_M : minor (faint) grid lines, every 1 m.
   * The minor 1 m lines only render when a cell reads at least
   * MINOR_GRID_MIN_PX pixels on screen (base cellPx x the view zoom): a
   * huge floor zoomed out would otherwise be an unreadable smear, and the
   * per-line cost is wasted. At normal zooms on any ordinary floor the
   * cells read well above the threshold, so the base look is unchanged.
   * Rich MARKINGS (aisle guides, dock hatching) are gated a little lower,
   * MARKINGS_MIN_PX, so they appear as you zoom in but never on the tiny
   * far-out view. The perimeter outline + zone tints are cheap and draw
   * whenever the Measurements layer is on.
   * ------------------------------------------------------------------ */
  const MAJOR_STEP_M = 5;
  const MINOR_STEP_M = 1;
  const MINOR_GRID_MIN_PX = 14; // px/cell on screen to show the 1 m minor grid
  const MARKINGS_MIN_PX = 8;    // px/cell on screen to show aisle/dock markings
  const RULER_LABEL_MIN_PX = 40; // min on-screen px between labelled ruler ticks

  function num(v) { const n = Number(v); return isFinite(n) ? n : NaN; }

  // Minor 1 m grid is a level-of-detail decision: only above the px/cell
  // threshold. `pxPerCell` is the ON-SCREEN pixels per 1 m cell.
  function minorGridVisible(pxPerCell) {
    const p = num(pxPerCell);
    return isFinite(p) && p >= MINOR_GRID_MIN_PX;
  }

  // Rich floor markings (aisle centre guides, dock-approach hatching)
  // appear once cells read at least MARKINGS_MIN_PX on screen.
  function markingsVisible(pxPerCell) {
    const p = num(pxPerCell);
    return isFinite(p) && p >= MARKINGS_MIN_PX;
  }

  // Metre label text: an integer when whole, else one decimal. Deterministic.
  function metreLabel(m) {
    const n = num(m);
    if (!isFinite(n)) return "";
    return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1);
  }

  /* ------------------------------------------------------------------
   * rulerTicks(floorMetres, stepM) -> deterministic tick list along one
   * axis of a floorMetres-long edge, one entry every stepM metres:
   *   { m, label, major, edge? }
   * `major` alternates (every other tick) so the renderer can emphasise
   * the coarser marks. The far EDGE of the floor is always appended (with
   * edge:true) so the ruler reads the true extent even when the floor
   * length is not a whole multiple of the step. Positions are exact and
   * ordered 0 .. floorMetres; garbage input returns []. Pure - allocates a
   * fresh array and mutates nothing.
   * ------------------------------------------------------------------ */
  function rulerTicks(floorMetres, stepM) {
    const F = num(floorMetres), S = num(stepM);
    if (!isFinite(F) || !isFinite(S) || F <= 0 || S <= 0) return [];
    const out = [];
    const n = Math.floor(F / S + 1e-9);
    for (let i = 0; i <= n; i++) {
      const m = i * S;
      out.push({ m: m, label: metreLabel(m), major: i % 2 === 0 });
    }
    const last = out.length ? out[out.length - 1] : null;
    if (!last || Math.abs(last.m - F) > 1e-9) {
      out.push({ m: F, label: metreLabel(F), major: false, edge: true });
    }
    return out;
  }

  // A ruler LABEL step (metres) whose on-screen spacing clears
  // RULER_LABEL_MIN_PX, so labels never collide when zoomed out. Always a
  // whole multiple of MAJOR_STEP_M. Pure function of the on-screen px/cell.
  function rulerLabelStepM(pxPerCell) {
    const p = num(pxPerCell);
    let step = MAJOR_STEP_M;
    if (!isFinite(p) || p <= 0) return step;
    let guard = 0;
    while (step * p < RULER_LABEL_MIN_PX && guard++ < 24) step *= 2;
    return step;
  }

  /* ------------------------------------------------------------------
   * dimensionLabel(el, metresPerCell) -> "w x d m" for a selected element
   * (using the U+00D7 multiplication sign, matching the properties panel).
   * metresPerCell defaults to 1 (the domain's METRES_PER_CELL). Whole
   * values print without a decimal. Missing/garbage -> "". Reads el, never
   * mutates it.
   * ------------------------------------------------------------------ */
  function dimensionLabel(el, metresPerCell) {
    if (!el) return "";
    const m = num(metresPerCell == null ? 1 : metresPerCell) || 1;
    const w = num(el.w), d = num(el.d);
    if (!isFinite(w) || !isFinite(d)) return "";
    return metreLabel(w * m) + " × " + metreLabel(d * m) + " m";
  }

  /* ------------------------------------------------------------------
   * perimeter(floorW, floorH) -> the facility outline rectangle (metres),
   * anchored at the origin, plus its four corner points. In-bounds by
   * construction; garbage -> null.
   * ------------------------------------------------------------------ */
  function perimeter(floorW, floorH) {
    const W = num(floorW), H = num(floorH);
    if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return null;
    return {
      x: 0, y: 0, w: W, h: H,
      points: [[0, 0], [W, 0], [W, H], [0, H]],
    };
  }

  /* ------------------------------------------------------------------
   * dockApproach(el, floorW, floorH, depthM) -> the apron in FRONT of a
   * dock/gate element: a rectangle extending depthM metres from the
   * element's interior-facing side (the side nearest the closest floor
   * edge is the "outside"; the apron reaches inward), CLAMPED to the floor
   * so every coordinate stays in bounds, plus a set of 45-degree hatch
   * segments fully inside that rectangle. Pure: reads el, never mutates
   * it; returns null for a missing element or degenerate floor.
   * ------------------------------------------------------------------ */
  function dockApproach(el, floorW, floorH, depthM) {
    if (!el) return null;
    const W = num(floorW), H = num(floorH);
    if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return null;
    const ex = num(el.x), ey = num(el.y), ew = num(el.w) || 0, ed = num(el.d) || 0;
    if (!isFinite(ex) || !isFinite(ey)) return null;
    const depth = num(depthM) > 0 ? num(depthM) : 3;

    // Distance from the element to each floor edge; the smallest is the
    // edge the dock backs onto, so the apron reaches the OTHER way (inward).
    const dl = ex, dr = W - (ex + ew), dt = ey, db = H - (ey + ed);
    const nearest = Math.min(dl, dr, dt, db);
    let x, y, w, h, dir;
    if (nearest === dt) { dir = "down"; x = ex; w = ew; y = ey + ed; h = depth; }
    else if (nearest === db) { dir = "up"; x = ex; w = ew; y = ey - depth; h = depth; }
    else if (nearest === dl) { dir = "right"; y = ey; h = ed; x = ex + ew; w = depth; }
    else { dir = "left"; y = ey; h = ed; x = ex - depth; w = depth; }

    // Clamp the apron rectangle into the floor so coords stay in bounds.
    const x0 = Math.max(0, Math.min(W, x)), x1 = Math.max(0, Math.min(W, x + w));
    const y0 = Math.max(0, Math.min(H, y)), y1 = Math.max(0, Math.min(H, y + h));
    const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);

    // Diagonal hatch fully inside [rx,ry,rw,rh] (endpoints provably in the
    // rect for every offset), stepped deterministically.
    const lines = [];
    if (rw > 1e-6 && rh > 1e-6) {
      const step = Math.max(0.6, depth / 3);
      const span = rw + rh;
      for (let o = step; o < span - 1e-9; o += step) {
        const ax = rx + Math.max(0, o - rh), ay = ry + Math.min(o, rh);
        const bx = rx + Math.min(o, rw), by = ry + Math.max(0, o - rw);
        lines.push({ x0: ax, y0: ay, x1: bx, y1: by });
      }
    }
    return { x: rx, y: ry, w: rw, h: rh, dir: dir, lines: lines };
  }

  /* ------------------------------------------------------------------
   * aisleGuides(facingPairs) -> a faint centre line down each working
   * aisle between a facing pair of racks. `facingPairs` is exactly the
   * shape WT.domain.facingAislePairs returns ({a, b, axis}) so the guides
   * can never disagree with the compliance aisle model. Each guide is a
   * segment {x0,y0,x1,y1} in metres, running along the middle of the gap
   * across the racks' overlap span. Pure: never mutates the pairs or the
   * elements; skips degenerate pairs.
   * ------------------------------------------------------------------ */
  function aisleGuides(facingPairs) {
    const out = [];
    const pairs = facingPairs || [];
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i]; if (!p) continue;
      const a = p.a, b = p.b; if (!a || !b) continue;
      const ax = num(a.x), ay = num(a.y), aw = num(a.w) || 0, ad = num(a.d) || 0;
      const bx = num(b.x), by = num(b.y), bw = num(b.w) || 0, bd = num(b.d) || 0;
      if (![ax, ay, bx, by].every(isFinite)) continue;
      if (p.axis === "y") {
        // Rows stacked vertically; the aisle runs horizontally between them.
        const cy = (Math.min(ay + ad, by + bd) + Math.max(ay, by)) / 2;
        const x0 = Math.max(ax, bx), x1 = Math.min(ax + aw, bx + bw);
        if (x1 > x0) out.push({ x0: x0, y0: cy, x1: x1, y1: cy });
      } else if (p.axis === "x") {
        // Rows side by side; the aisle runs vertically between them.
        const cx = (Math.min(ax + aw, bx + bw) + Math.max(ax, bx)) / 2;
        const y0 = Math.max(ay, by), y1 = Math.min(ay + ad, by + bd);
        if (y1 > y0) out.push({ x0: cx, y0: y0, x1: cx, y1: y1 });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * Functional-zone inference. A "zone" is the floor role an element
   * plays in the receiving -> storage -> picking -> packing -> shipping
   * spine. The keys match the theme's flowStages palette so the renderer
   * can colour each tint straight from COLORS.flowStages. Transport /
   * support elements (conveyor, rgv, agv, forklift, charging, sorter,
   * gate) have NO functional zone and are skipped.
   * ------------------------------------------------------------------ */
  const STAGE_BY_TYPE = {
    "dock-in": "receiving", "staging": "receiving",
    "selective-racking": "storage", "block-stack": "storage", "drive-in": "storage",
    "double-deep": "storage", "push-back": "storage", "pallet-flow": "storage",
    "carton-flow": "storage", "mobile-racking": "storage", "cantilever": "storage",
    "asrs": "storage", "shuttle": "storage", "mezzanine": "storage",
    "pick-to-light": "picking", "vna": "picking",
    "push-station": "picking", "pull-station": "picking",
    "pack-station": "packing", "stretch-wrap": "packing", "returns-station": "packing",
    "dock-out": "shipping",
  };
  function stageOfType(type) {
    return Object.prototype.hasOwnProperty.call(STAGE_BY_TYPE, type) ? STAGE_BY_TYPE[type] : null;
  }

  /* ------------------------------------------------------------------
   * zoneTints(elements) -> one faint tint rectangle per element that maps
   * to a functional zone (its own footprint + a `stage` key). Elements
   * with no functional role produce nothing, so a floor with no
   * zone-bearing elements yields an EMPTY list ("zone tint only applies
   * when zones exist"). Pure: reads the elements, never mutates them.
   * An optional stageOf override lets the caller supply its own mapping;
   * the built-in STAGE_BY_TYPE is used otherwise.
   * ------------------------------------------------------------------ */
  function zoneTints(elements, stageOf) {
    const out = [];
    const list = elements || [];
    const map = typeof stageOf === "function" ? stageOf : stageOfType;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (!e) continue;
      const stage = map(e.type);
      if (!stage) continue;
      const x = num(e.x), y = num(e.y), w = num(e.w) || 0, d = num(e.d) || 0;
      if (!isFinite(x) || !isFinite(y) || w <= 0 || d <= 0) continue;
      out.push({ x: x, y: y, w: w, h: d, stage: stage });
    }
    return out;
  }

  // Honest scope, asserted by verify_floor.js and shown in the app.
  const DISCLAIMER =
    "Illustrative facility rendering of a synthetic model - the measurements " +
    "are the model's own metre grid (1 cell = 1 m), NOT a site survey and NOT " +
    "CAD/BIM. The real geometry path is the IFC export.";

  WT.floor = {
    MAJOR_STEP_M,
    MINOR_STEP_M,
    MINOR_GRID_MIN_PX,
    MARKINGS_MIN_PX,
    RULER_LABEL_MIN_PX,
    minorGridVisible,
    markingsVisible,
    metreLabel,
    rulerTicks,
    rulerLabelStepM,
    dimensionLabel,
    perimeter,
    dockApproach,
    aisleGuides,
    stageOfType,
    zoneTints,
    DISCLAIMER,
  };
})();
