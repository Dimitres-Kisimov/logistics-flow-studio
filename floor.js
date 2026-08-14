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
   * v3.8 REDESIGN-1 - building-shell PERIMETER WALL. A readable wall BAND
   * (not a hairline outline) hugging the inside of the floor edge, so the
   * floor reads as "an entire place" - especially the big empty hall you
   * start from. It is a RENDER-ONLY facility layer: derived purely from the
   * floor size, never stored as an element, so serialize() is byte-identical.
   *
   * wallThickness(floorW, floorH) -> an illustrative, teaching-scale wall
   * thickness in metres: ~2% of the SHORT side so it stays proportional as
   * the hall grows, clamped [0.6, 4] m so it is visible on a small floor and
   * never absurd on a huge one. Deterministic; garbage -> 0.
   * ------------------------------------------------------------------ */
  function wallThickness(floorW, floorH) {
    const W = num(floorW), H = num(floorH);
    if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return 0;
    const t = Math.min(W, H) * 0.02;
    return Math.max(0.6, Math.min(4, t));
  }

  /* ------------------------------------------------------------------
   * wallBand(floorW, floorH, thicknessM?) -> the perimeter wall geometry:
   *   { thickness, outer:{x,y,w,h}, inner:{x,y,w,h}, segments:[4 rects] }
   * The band is the region between the floor rect (`outer`) and the clear
   * interior (`inner`), of `thickness` metres (defaulting to wallThickness).
   * `segments` are the FOUR disjoint wall rectangles (top, bottom, left,
   * right) that TILE the band exactly (no overlap, no gap) - so a renderer
   * can fill/extrude each one, and a test can assert their areas sum to the
   * band area. Thickness is capped at half the short side so the band can
   * never cross itself on a tiny floor. Pure + deterministic; garbage -> null.
   * ------------------------------------------------------------------ */
  function wallBand(floorW, floorH, thicknessM) {
    const W = num(floorW), H = num(floorH);
    if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return null;
    let t = num(thicknessM);
    if (!isFinite(t) || t <= 0) t = wallThickness(W, H);
    t = Math.min(t, Math.min(W, H) / 2);
    const midH = Math.max(0, H - 2 * t);
    const inner = { x: t, y: t, w: Math.max(0, W - 2 * t), h: midH };
    const segments = [
      { x: 0, y: 0, w: W, h: t, side: "top" },        // north edge
      { x: 0, y: H - t, w: W, h: t, side: "bottom" },  // south edge
      { x: 0, y: t, w: t, h: midH, side: "left" },     // west edge
      { x: W - t, y: t, w: t, h: midH, side: "right" }, // east edge
    ];
    return { thickness: t, outer: { x: 0, y: 0, w: W, h: H }, inner: inner, segments: segments };
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

  /* ==================================================================
   * v3.21 INDUSTRIAL MATERIAL IDENTITY - the floor is POURED CONCRETE
   * with PAINTED markings, not a blueprint. Everything below is a PURE,
   * DETERMINISTIC function of position + an integer seed: no Date, no
   * Math.random, no DOM. Same seed -> byte-identical geometry, every
   * run, every machine (verify_floor.js asserts exactly that).
   * ================================================================== */

  /* ------------------------------------------------------------------
   * hash2(x, y, seed) -> a stable 32-bit-ish integer for an integer
   * lattice point. A plain integer mix (xorshift-flavoured, all ops on
   * |0 values) so it is identical in every JS engine. Used to place the
   * concrete's aggregate speckle, which must never move between frames
   * or between runs.
   * ------------------------------------------------------------------ */
  function hash2(x, y, seed) {
    let h = (Math.round(x) | 0) * 374761393;
    h = (h + (Math.round(y) | 0) * 668265263) | 0;
    h = (h + ((seed | 0) * 1274126177)) | 0;
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  }
  // hash2 mapped into [0,1). Deterministic, uniform enough for speckle.
  function hash01(x, y, seed) { return hash2(x, y, seed) / 4294967296; }

  /* ------------------------------------------------------------------
   * CONCRETE_TILE_M - the world size (metres) of one aggregate texture
   * tile. The renderer bakes ONE tile and repeats it across the slab, so
   * the whole floor costs a single fill no matter how large the hall is.
   *
   * concreteSpecks(cells, seed, density) -> the aggregate exposed in a
   * poured, power-floated slab: a deterministic list of
   *   { x, y, r, tone }
   * in TILE-NORMALISED coordinates (0..1 on both axes, so the renderer
   * can bake them into a tile of any pixel size). `tone` is -1 (a darker
   * stone) or +1 (a lighter stone) so the speckle reads as aggregate
   * rather than noise. `cells` is the lattice resolution (how many
   * candidate stones per axis); `density` (0..1) is the fraction of
   * lattice points that actually carry a stone. Every stone is fully
   * inside [0,1) by construction. Pure; garbage -> [].
   * ------------------------------------------------------------------ */
  // 8 m of floor per tile: large enough that the repeat does not read as a
  // pattern at normal zooms (a 4 m tile visibly checkerboarded an empty hall).
  const CONCRETE_TILE_M = 8;
  function concreteSpecks(cells, seed, density) {
    const n = Math.max(1, Math.min(96, Math.round(num(cells)) || 24));
    const s = (Math.round(num(seed)) | 0) || 0;
    let dRaw = num(density);
    const d = isFinite(dRaw) ? Math.max(0, Math.min(1, dRaw)) : 0.55;
    const out = [];
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        if (hash01(gx, gy, s) >= d) continue;
        // Jitter inside the lattice cell, never across its border, so a
        // stone can never escape [0,1).
        const jx = hash01(gx + 101, gy + 7, s);
        const jy = hash01(gx + 13, gy + 211, s);
        const rr = hash01(gx + 977, gy + 977, s);
        const tn = hash01(gx + 31, gy + 57, s);
        out.push({
          x: (gx + 0.15 + jx * 0.7) / n,
          y: (gy + 0.15 + jy * 0.7) / n,
          r: (0.12 + rr * 0.26) / n, // radius in tile units, < half a cell
          tone: tn < 0.5 ? -1 : 1,
        });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * PAINTED FLOOR MARKINGS. Real plant paint is a BAND of a real width,
   * applied with a roller and worn by traffic - not a CAD hairline.
   *
   * PAINT_W - the standard painted line widths (metres), the widths a
   * facility actually uses: a 100 mm aisle line, a 75 mm zone border,
   * a 150 mm hazard band.
   * ------------------------------------------------------------------ */
  const PAINT_W = { aisle: 0.10, zone: 0.075, hazard: 0.15 };

  /* ------------------------------------------------------------------
   * aislePaint(facingPairs) -> the painted aisle lines: exactly the
   * WT.floor.aisleGuides centreline geometry, promoted to a painted BAND
   * with a real width and a travel direction:
   *   { x0, y0, x1, y1, width, axis, lengthM }
   * Reusing aisleGuides means the paint can never disagree with the
   * compliance aisle model. Pure; degenerate pairs are skipped.
   * ------------------------------------------------------------------ */
  function aislePaint(facingPairs) {
    const guides = aisleGuides(facingPairs);
    const out = [];
    for (let i = 0; i < guides.length; i++) {
      const g = guides[i];
      const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 1e-6)) continue;
      out.push({
        x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1,
        width: PAINT_W.aisle, axis: Math.abs(dx) >= Math.abs(dy) ? "x" : "y",
        lengthM: len,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * aisleArrows(paintLines, spacingM) -> painted DIRECTION ARROWS along
   * each aisle line, one every spacingM metres, each
   *   { x, y, dx, dy, size }
   * where (dx,dy) is the unit travel direction. Arrows are inset half a
   * spacing from both ends so paint never runs off the end of the aisle;
   * an aisle shorter than one spacing gets a single centred arrow. Pure +
   * deterministic (position is a pure function of the line geometry).
   * ------------------------------------------------------------------ */
  function aisleArrows(paintLines, spacingM) {
    const lines = paintLines || [];
    let step = num(spacingM);
    if (!isFinite(step) || step <= 0) step = 6;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const g = lines[i]; if (!g) continue;
      const dx = num(g.x1) - num(g.x0), dy = num(g.y1) - num(g.y0);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 1e-6)) continue;
      const ux = dx / len, uy = dy / len;
      // A stencilled floor arrow is a SMALL mark (~0.3-0.5 m across), not a
      // billboard: it tells a driver the direction of travel at a glance and
      // then gets out of the way.
      const size = Math.max(0.22, Math.min(0.45, step * 0.06));
      if (len < step) {
        out.push({ x: g.x0 + ux * len / 2, y: g.y0 + uy * len / 2, dx: ux, dy: uy, size: size });
        continue;
      }
      const n = Math.floor(len / step);
      const pad = (len - (n - 1) * step) / 2;
      for (let k = 0; k < n; k++) {
        const t = pad + k * step;
        out.push({ x: g.x0 + ux * t, y: g.y0 + uy * t, dx: ux, dy: uy, size: size });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * hazardBands(rect, bandM) -> the black/yellow diagonal HAZARD HATCH
   * that gets painted in front of a dock door or across a danger apron.
   * Returns a list of 45-degree bands, each a QUAD (4 corner points)
   * fully inside `rect`, alternating `dark:true|false` so the renderer
   * paints the real two-tone hazard stripe. Pure; garbage -> [].
   * ------------------------------------------------------------------ */
  function hazardBands(rect, bandM) {
    const r = rect || {};
    const rx = num(r.x), ry = num(r.y), rw = num(r.w), rh = num(r.h);
    if (![rx, ry, rw, rh].every(isFinite) || rw <= 1e-6 || rh <= 1e-6) return [];
    let b = num(bandM);
    if (!isFinite(b) || b <= 0) b = 0.5;
    const span = rw + rh;
    const out = [];
    let idx = 0;
    for (let o = 0; o < span - 1e-9; o += b, idx++) {
      const o2 = Math.min(o + b, span);
      // The band between diagonal offsets o and o2, clipped to the rect
      // by construction (both endpoints of each diagonal are clamped).
      const p = (t) => {
        const ax = rx + Math.max(0, t - rh), ay = ry + Math.min(t, rh);
        const bx = rx + Math.min(t, rw), by = ry + Math.max(0, t - rw);
        return [[ax, ay], [bx, by]];
      };
      const a = p(o), c = p(o2);
      out.push({ points: [a[0], a[1], c[1], c[0]], dark: idx % 2 === 0 });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * WEAR - painted lines in a working plant are SCUFFED. wearAt(x, y,
   * seed) -> a deterministic 0..1 opacity multiplier for the paint at a
   * world point: mostly near-solid with occasional worn patches, so a
   * long aisle line reads as painted-and-driven-over instead of vector-
   * perfect. Pure function of the quantised position + seed (quantised to
   * 0.5 m so the wear pattern is stable under zoom).
   * ------------------------------------------------------------------ */
  function wearAt(x, y, seed) {
    const qx = Math.round(num(x) * 2), qy = Math.round(num(y) * 2);
    if (!isFinite(qx) || !isFinite(qy)) return 1;
    const h = hash01(qx, qy, (seed | 0) || 0);
    // 0.62 .. 1.0 - never invisible, never uniform.
    return 0.62 + h * 0.38;
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
    wallThickness,
    wallBand,
    dockApproach,
    aisleGuides,
    stageOfType,
    zoneTints,
    // v3.21 INDUSTRIAL MATERIAL IDENTITY (concrete + paint), all pure.
    CONCRETE_TILE_M,
    PAINT_W,
    hash2,
    hash01,
    concreteSpecks,
    aislePaint,
    aisleArrows,
    hazardBands,
    wearAt,
    DISCLAIMER,
  };
})();
