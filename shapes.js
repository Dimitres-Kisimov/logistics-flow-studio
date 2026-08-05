/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * shapes.js - the SINGLE per-type shape registry (2D glyph + 3D form).
 * ---------------------------------------------------------------------
 * One source of truth for how every warehouse object type LOOKS, reused
 * by BOTH renderers:
 *   - the TOP-DOWN editor (app.js) calls draw2D() for each element's
 *     distinct schematic glyph inside its footprint;
 *   - the 2.5D ISOMETRIC view (iso.js) calls draw3D() for each element's
 *     distinct extruded form, using the SAME per-type height the IFC
 *     export and the iso projection already agree on (domain.heightM via
 *     iso.elementHeight - never invented a third time here).
 *
 * HONESTY (read this):
 *   - These are ILLUSTRATIVE, recognizable SCHEMATIC glyphs and forms -
 *     NOT CAD, NOT BIM, NOT a survey and NOT measured geometry. Heights
 *     are the domain model's ASSUMED, order-of-magnitude teaching values.
 *     The real BIM/geometry path is the separate IFC export (ifc.js).
 *   - No real brands, logos or trademarked shapes; every motif is a
 *     generic material-handling schematic.
 *
 * PURE + SELF-CONTAINED: every function here takes a canvas ctx plus
 * plain geometry/colour arguments and draws - it reads NO app state, keeps
 * NO module state between calls, MUTATES none of its inputs, and pulls in
 * no external asset (offline by construction). The math is finite for any
 * finite input, so the draw paths are exercised headlessly against a mock
 * 2D context (verify_shapes.js) even though the pixels themselves are only
 * verifiable live in the browser.
 *
 * No frameworks, no build step. Attaches to the global `WT` namespace so
 * it works from file:// as a classic script (not an ES module).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const TAU = Math.PI * 2;

  /* ==================================================================
   * COLOUR HELPERS (self-contained; no dependency on app.js/iso.js).
   * ================================================================== */
  function hx(hex) {
    let h = String(hex == null ? "#888888" : hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    let r = parseInt(h.slice(0, 2), 16);
    let g = parseInt(h.slice(2, 4), 16);
    let b = parseInt(h.slice(4, 6), 16);
    if (!isFinite(r)) r = 136;
    if (!isFinite(g)) g = 136;
    if (!isFinite(b)) b = 136;
    return [r, g, b];
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  function rgba(hex, a) {
    const c = hx(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  // Multiply toward black (f<1 darkens, f>1 brightens then clamps).
  function shade(hex, f) {
    const c = hx(hex);
    return "rgb(" + clamp255(c[0] * f) + "," + clamp255(c[1] * f) + "," + clamp255(c[2] * f) + ")";
  }
  // Blend toward white by fraction f (0..1).
  function lighten(hex, f) {
    const c = hx(hex);
    const m = (v) => clamp255(v + (255 - v) * f);
    return "rgb(" + m(c[0]) + "," + m(c[1]) + "," + m(c[2]) + ")";
  }

  // Theme-aware pen/brush for the 2D glyph strokes so they read on both
  // the light and dark tinted footprint the editor already fills.
  function glyphColors(color, theme) {
    if (theme === "dark") {
      return { stroke: rgba(lighten(color, 0.32), 0.92), fill: rgba(lighten(color, 0.26), 0.5) };
    }
    return { stroke: rgba(color, 0.78), fill: rgba(color, 0.46) };
  }

  // Face-shade multipliers for the 3D forms (top brightest, then right,
  // then left) - a consistent single light direction, no lighting model.
  const FACE = { top: 1.14, right: 0.82, left: 0.6 };
  function beamColor(color, theme) {
    return theme === "dark" ? lighten(color, 0.28) : shade(color, 0.72);
  }

  /* ==================================================================
   * 2D PRIMITIVES (footprint px space). Module-level (no per-call
   * closure allocation in the hot path).
   * ================================================================== */
  function seg(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function ring(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.stroke();
  }
  function disc(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fill();
  }
  // A chevron (open "V") of half-size s pointing dir ("up"|"down"|"left"|"right").
  function chev(ctx, cx, cy, s, dir) {
    ctx.beginPath();
    if (dir === "down") { ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx, cy); ctx.lineTo(cx + s, cy - s); }
    else if (dir === "up") { ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx, cy); ctx.lineTo(cx + s, cy + s); }
    else if (dir === "right") { ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx, cy); ctx.lineTo(cx - s, cy + s); }
    else { ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx, cy); ctx.lineTo(cx + s, cy + s); }
    ctx.stroke();
  }
  // A line with an arrowhead at (x2,y2).
  function arr(ctx, x1, y1, x2, y2, hs) {
    seg(ctx, x1, y1, x2, y2);
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(a - 0.42), y2 - hs * Math.sin(a - 0.42));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hs * Math.cos(a + 0.42), y2 - hs * Math.sin(a + 0.42));
    ctx.stroke();
  }
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ==================================================================
   * DETERMINISTIC EQUIPMENT-ANIMATION PHASE (one source of truth for the
   * moving parts drawn by BOTH the 2D glyph and the 3D form). It is a
   * PURE function of a continuous sim TIME `t` (the caller passes the
   * flow sim's tick + fractional accumulator) and a per-element `seed`.
   * NO Date, NO Math.random - so the animation is reproducible and
   * PAUSES exactly when the sim is paused (the caller stops advancing t,
   * so the phase - and every moving part - freezes into a static frame).
   * Returns a value in [0,1); periodic in t with period ANIM_PERIOD ticks;
   * the seed gives each element a stable phase offset so the plant does
   * not move in lockstep. ILLUSTRATIVE motion only - labels/data unaffected.
   * ================================================================== */
  const ANIM_PERIOD = 2.4; // sim ticks per full animation cycle
  function equipmentPhase(t, seed) {
    let tt = Number(t);
    if (!isFinite(tt)) tt = 0;
    let s = Number(seed);
    if (!isFinite(s)) s = 0;
    const off = (Math.abs(Math.floor(s)) % 1000) / 1000; // stable seed offset in [0,1)
    let p = (tt / ANIM_PERIOD + off) % 1;
    if (p < 0) p += 1;
    return p;
  }
  // Triangle wave 0 -> 1 -> 0 over p in [0,1): a body that travels a lane
  // and returns (rail-guided back-and-forth, crane carriage, lift).
  function tri(p) { const x = ((p % 1) + 1) % 1; return 1 - Math.abs(2 * x - 1); }
  // A point on the perimeter of rect (lx,ly,lw,lh) at fraction t in [0,1),
  // walking clockwise from the top-left corner. Used to circulate a load
  // around a CLOSED LOOP (the sorter tray). Finite for any finite input;
  // degenerate (zero-perimeter) rects return the corner rather than divide.
  function rectPerim(lx, ly, lw, lh, t) {
    const W = Math.max(0, lw), H = Math.max(0, lh);
    const per = 2 * (W + H);
    if (!(per > 0)) return { x: lx, y: ly };
    let dd = ((((Number(t) || 0) % 1) + 1) % 1) * per;
    if (dd < W) return { x: lx + dd, y: ly };
    dd -= W;
    if (dd < H) return { x: lx + W, y: ly + dd };
    dd -= H;
    if (dd < W) return { x: lx + W - dd, y: ly + H };
    dd -= W;
    return { x: lx, y: ly + H - dd };
  }

  /* ==================================================================
   * PER-TYPE 2D GLYPHS. Signature: (ctx, x, y, w, d, cell, gc, color).
   * `cell` = px per grid cell (feature density); `gc` = {stroke,fill}.
   * Each keeps the type's colour and draws only inside [x,y,w,d].
   * ================================================================== */
  function pen(ctx, gc, cell) {
    ctx.strokeStyle = gc.stroke;
    ctx.fillStyle = gc.fill;
    ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
  }

  // Open shelf-bay grid: uprights + horizontal beams (single-deep).
  function d2Selective(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 7);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bays = clampN(Math.round(iw / cell), 2, 14);
    for (let i = 0; i <= bays; i++) { const gx = ix + (iw * i) / bays; seg(ctx, gx, iy, gx, iy + ih); }
    const lv = clampN(Math.round(ih / (cell * 0.55)), 1, 3);
    for (let j = 0; j <= lv; j++) { const gy = iy + (ih * j) / lv; seg(ctx, ix, gy, ix + iw, gy); }
  }

  // Stacked-square pattern (floor block stacking, honeycomb read).
  function d2Block(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const cols = clampN(Math.round(w / cell), 2, 8);
    const rows = clampN(Math.round(d / cell), 2, 8);
    const gap = clampN(cell * 0.12, 1.5, 5);
    const cw = (w - gap) / cols, ch = (d - gap) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = x + gap + c * cw, by = y + gap + r * ch;
        ctx.fillRect(bx, by, cw - gap, ch - gap);
        ctx.strokeRect(bx, by, cw - gap, ch - gap);
        // stacked-offset ghost square (upper-right) for the "stacked" read.
        const o = Math.min(cw, ch) * 0.16;
        ctx.strokeRect(bx + o, by - o * 0.5, cw - gap, ch - gap);
      }
    }
  }

  // Deep lanes with an entry arrow into the depth (truck drives in).
  function d2DriveIn(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const lanes = clampN(Math.round(iw / cell), 2, 8);
    for (let i = 0; i <= lanes; i++) { const gx = ix + (iw * i) / lanes; seg(ctx, gx, iy, gx, iy + ih); }
    // nested depth arrows down each lane (entry direction).
    for (let i = 0; i < lanes; i++) {
      const gx = ix + iw * (i + 0.5) / lanes;
      arr(ctx, gx, iy + ih * 0.15, gx, iy + ih * 0.85, clampN(cell * 0.3, 3, 7));
    }
  }

  // Two pallets deep: a front and back bay pair with a depth divider.
  function d2DoubleDeep(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const midY = iy + ih / 2;
    const bays = clampN(Math.round(iw / cell), 2, 12);
    for (let i = 0; i <= bays; i++) { const gx = ix + (iw * i) / bays; seg(ctx, gx, iy, gx, iy + ih); }
    seg(ctx, ix, iy, ix + iw, iy);
    seg(ctx, ix, iy + ih, ix + iw, iy + ih);
    // bold central depth divider (the two-deep split).
    ctx.lineWidth = clampN(cell * 0.09, 1.5, 3);
    seg(ctx, ix, midY, ix + iw, midY);
  }

  // Nested chevrons toward the aisle face (nested carts on inclined rails).
  function d2PushBack(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const n = 3, s = clampN(Math.min(iw, ih) * 0.16, 3, 9);
    for (let i = 0; i < n; i++) {
      const cy = iy + ih * (0.72 - 0.22 * i);
      chev(ctx, ix + iw / 2, cy, s, "down");
    }
  }

  // Gravity flow lanes: roller dots + flow-direction chevrons (FIFO).
  function d2PalletFlow(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const lanes = clampN(Math.round(iw / cell), 2, 8);
    for (let i = 0; i < lanes; i++) {
      const gx = ix + iw * (i + 0.5) / lanes;
      // roller dots down the lane
      const dots = clampN(Math.round(ih / (cell * 0.5)), 2, 6);
      for (let j = 0; j < dots; j++) disc(ctx, gx, iy + ih * (j + 0.5) / dots, clampN(cell * 0.06, 1.2, 2.4));
      // flow chevrons (load back -> pick front = downward)
      chev(ctx, gx, iy + ih * 0.85, clampN(cell * 0.16, 2.5, 6), "down");
    }
  }

  // Fine inclined carton pick-face shelves with small chevrons.
  function d2CartonFlow(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const shelves = clampN(Math.round(ih / (cell * 0.34)), 2, 5);
    const s = clampN(iw * 0.04, 2, 5);
    for (let j = 0; j < shelves; j++) {
      const gy = iy + ih * (j + 0.5) / shelves;
      seg(ctx, ix, gy + s * 0.5, ix + iw, gy - s * 0.5); // slight incline
      chev(ctx, ix + iw * 0.85, gy - s * 0.5, s, "right");
    }
  }

  // Mobile bases on one shared aisle: base rail + wheels + bay uprights.
  function d2Mobile(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bays = clampN(Math.round(iw / cell), 2, 12);
    for (let i = 0; i <= bays; i++) { const gx = ix + (iw * i) / bays; seg(ctx, gx, iy, gx, iy + ih * 0.82); }
    const railY = iy + ih * 0.9;
    seg(ctx, ix, railY, ix + iw, railY);
    const wheels = clampN(Math.round(iw / cell), 2, 8);
    for (let i = 0; i < wheels; i++) ring(ctx, ix + iw * (i + 0.5) / wheels, railY, clampN(cell * 0.09, 1.5, 3));
  }

  // Arms on a column, no front uprights (long goods).
  function d2Cantilever(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const colX = ix + iw * 0.12;
    ctx.lineWidth = clampN(cell * 0.08, 1.5, 3);
    seg(ctx, colX, iy, colX, iy + ih); // the column
    ctx.lineWidth = clampN(cell * 0.05, 1, 2);
    const arms = clampN(Math.round(ih / (cell * 0.5)), 2, 4);
    for (let j = 0; j <= arms; j++) {
      const gy = iy + (ih * j) / arms;
      seg(ctx, colX, gy, ix + iw, gy); // arm reaching out
    }
  }

  // Tall double-sided high bay: rack hatch each side + a crane aisle. When
  // `anim` is supplied the stacker trolley TRAVELS the crane aisle (back-and-
  // forth); omit it for the static form.
  function d2Asrs(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.12, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const aisle = clampN(ih * 0.3, 4, 14);
    const topH = (ih - aisle) / 2, botY = iy + topH + aisle;
    // hatched rack band top and bottom
    const hs = clampN(cell * 0.5, 5, 12);
    for (let hx2 = ix; hx2 < ix + iw; hx2 += hs) {
      seg(ctx, hx2, iy, Math.min(ix + iw, hx2 + hs * 0.6), iy + topH);
      seg(ctx, hx2, botY, Math.min(ix + iw, hx2 + hs * 0.6), botY + topH);
    }
    ctx.strokeRect(ix, iy, iw, topH);
    ctx.strokeRect(ix, botY, iw, topH);
    // crane aisle centre line + trolley
    const midY = iy + topH + aisle / 2;
    seg(ctx, ix, midY, ix + iw, midY);
    const tw = clampN(iw * 0.12, 6, 20), th = clampN(aisle * 0.36, 4, 10);
    const tx = (typeof anim === "number" && isFinite(anim)) ? ix + tri(anim) * (iw - tw) : ix + iw * 0.44;
    ctx.fillRect(tx, midY - th / 2, tw, th);
  }

  // Deep channels served by shuttle carts + a lift at the head. When `anim`
  // is supplied a shuttle cart RUNS a channel (back-and-forth); omit it for
  // the static form.
  function d2Shuttle(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const chans = clampN(Math.round(ih / (cell * 0.5)), 2, 6);
    for (let j = 0; j <= chans; j++) { const gy = iy + (ih * j) / chans; seg(ctx, ix, gy, ix + iw, gy); }
    // a couple of shuttle carts on the channels
    const cw = clampN(cell * 0.5, 6, 14), chh = clampN(ih / chans * 0.5, 3, 8);
    ctx.fillRect(ix + iw * 0.55, iy + ih * 0.18, cw, chh);
    ctx.fillRect(ix + iw * 0.28, iy + ih * 0.6, cw, chh);
    // lift shaft at the head
    const lift = clampN(cell * 0.4, 4, 10);
    ctx.strokeRect(ix, iy, lift, ih);
    if (typeof anim === "number" && isFinite(anim)) {
      const sx = ix + lift + tri(anim) * (iw - lift - cw);
      ctx.fillStyle = gc.stroke;
      ctx.fillRect(sx, iy + ih * 0.4 - chh / 2, cw, chh);
    }
  }

  // Raised platform outline + corner posts (a second pick level).
  function d2Mezzanine(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 3, 8);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    ctx.save();
    ctx.setLineDash([clampN(cell * 0.22, 3, 6), clampN(cell * 0.16, 2, 4)]);
    ctx.strokeRect(ix, iy, iw, ih);
    ctx.restore();
    const pr = clampN(cell * 0.1, 1.6, 3.4);
    disc(ctx, ix, iy, pr); disc(ctx, ix + iw, iy, pr);
    disc(ctx, ix, iy + ih, pr); disc(ctx, ix + iw, iy + ih, pr);
    // stair ticks along one edge
    const steps = clampN(Math.round(iw / cell), 2, 6);
    for (let i = 1; i < steps; i++) seg(ctx, ix + iw * i / steps, iy + ih, ix + iw * i / steps, iy + ih - clampN(cell * 0.2, 2, 5));
  }

  // Dock door: a door notch in the wall edge + an in/out arrow.
  function d2Dock(ctx, x, y, w, d, cell, gc, dir) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    // wall with a centred door opening (a notch)
    const dw = clampN(iw * 0.5, 6, 40);
    const dx = ix + (iw - dw) / 2;
    seg(ctx, ix, iy, dx, iy);
    seg(ctx, dx + dw, iy, ix + iw, iy);
    ctx.strokeRect(dx, iy, dw, clampN(ih * 0.28, 3, 10)); // door leaf
    // in/out arrow (in = into the floor/down; out = away/up)
    const cx = ix + iw / 2;
    if (dir === "in") arr(ctx, cx, iy + ih * 0.35, cx, iy + ih * 0.9, clampN(cell * 0.32, 3, 8));
    else arr(ctx, cx, iy + ih * 0.9, cx, iy + ih * 0.35, clampN(cell * 0.32, 3, 8));
  }
  function d2DockIn(ctx, x, y, w, d, cell, gc) { d2Dock(ctx, x, y, w, d, cell, gc, "in"); }
  function d2DockOut(ctx, x, y, w, d, cell, gc) { d2Dock(ctx, x, y, w, d, cell, gc, "out"); }

  // Marshalling / staging buffer: a dashed holding area with corner ticks.
  function d2Staging(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 3, 8);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    ctx.save();
    ctx.setLineDash([clampN(cell * 0.28, 4, 8), clampN(cell * 0.2, 3, 6)]);
    ctx.strokeRect(ix, iy, iw, ih);
    // an inner divided holding lane
    seg(ctx, ix, iy + ih / 2, ix + iw, iy + ih / 2);
    ctx.restore();
  }

  // Powered conveyor: belt side lines + rollers + a direction arrow. When
  // `anim` (a phase in [0,1)) is supplied, a few unit-loads SCROLL along the
  // belt in the flow direction (the belt visibly runs); omit it for the
  // static form.
  function d2Conveyor(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.18, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const horiz = w >= d;
    if (horiz) {
      seg(ctx, ix, iy, ix + iw, iy);
      seg(ctx, ix, iy + ih, ix + iw, iy + ih);
      const n = clampN(Math.round(iw / (cell * 0.5)), 2, 24);
      for (let i = 1; i < n; i++) { const gx = ix + iw * i / n; seg(ctx, gx, iy, gx, iy + ih); }
      arr(ctx, ix + iw * 0.28, iy + ih / 2, ix + iw * 0.72, iy + ih / 2, clampN(cell * 0.3, 3, 7));
    } else {
      seg(ctx, ix, iy, ix, iy + ih);
      seg(ctx, ix + iw, iy, ix + iw, iy + ih);
      const n = clampN(Math.round(ih / (cell * 0.5)), 2, 24);
      for (let i = 1; i < n; i++) { const gy = iy + ih * i / n; seg(ctx, ix, gy, ix + iw, gy); }
      arr(ctx, ix + iw / 2, iy + ih * 0.28, ix + iw / 2, iy + ih * 0.72, clampN(cell * 0.3, 3, 7));
    }
    if (typeof anim === "number" && isFinite(anim)) {
      const items = 3, isz = clampN(Math.min(iw, ih) * 0.5, 3, 10);
      ctx.fillStyle = gc.stroke;
      for (let i = 0; i < items; i++) {
        const frac = ((i / items) + anim) % 1;
        if (horiz) ctx.fillRect(ix + frac * (iw - isz), iy + ih / 2 - isz / 2, isz, isz);
        else ctx.fillRect(ix + iw / 2 - isz / 2, iy + frac * (ih - isz), isz, isz);
      }
    }
  }

  // A control-station workbench with a flow arrow (dir "push"/"pull").
  function d2Station(ctx, x, y, w, d, cell, gc, kind) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.2, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    // bench top
    const bh = clampN(ih * 0.42, 4, 16);
    ctx.fillRect(ix, iy + (ih - bh) / 2, iw, bh);
    ctx.strokeRect(ix, iy + (ih - bh) / 2, iw, bh);
    const cy = iy + ih / 2;
    const hs = clampN(cell * 0.3, 3, 8);
    if (kind === "push") arr(ctx, ix + iw * 0.2, cy, ix + iw * 0.9, cy, hs);       // release outward
    else if (kind === "pull") arr(ctx, ix + iw * 0.8, cy, ix + iw * 0.1, cy, hs);  // demand inward
    else { // pack: a box on the bench with a tape line
      const s = clampN(Math.min(iw, ih) * 0.3, 5, 16);
      ctx.strokeRect(ix + iw / 2 - s / 2, cy - s / 2, s, s);
      seg(ctx, ix + iw / 2, cy - s / 2, ix + iw / 2, cy + s / 2);
    }
  }
  function d2Push(ctx, x, y, w, d, cell, gc) { d2Station(ctx, x, y, w, d, cell, gc, "push"); }
  function d2Pull(ctx, x, y, w, d, cell, gc) { d2Station(ctx, x, y, w, d, cell, gc, "pull"); }
  function d2Pack(ctx, x, y, w, d, cell, gc) { d2Station(ctx, x, y, w, d, cell, gc, "pack"); }

  // A small filled vehicle marker running along a lane at `travel` (0..1),
  // used for the animated RGV/AGV motion (one shared drawer for both).
  function laneRunner2D(ctx, gc, ix, iy, iw, ih, horiz, travel) {
    const mr = clampN(Math.min(iw, ih) * 0.18, 2.5, 8);
    const mx = horiz ? ix + mr + travel * (iw - 2 * mr) : ix + iw / 2;
    const my = horiz ? iy + ih / 2 : iy + mr + travel * (ih - 2 * mr);
    ctx.save();
    ctx.fillStyle = gc.stroke;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Rail-guided vehicle: twin rails + a cart body + direction. When `anim`
  // is supplied a vehicle marker travels the rail BACK-AND-FORTH (triangle
  // wave); omit it for the static form.
  function d2Rgv(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.2, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const horiz = w >= d;
    if (horiz) {
      seg(ctx, ix, iy + ih * 0.3, ix + iw, iy + ih * 0.3);
      seg(ctx, ix, iy + ih * 0.7, ix + iw, iy + ih * 0.7);
      const cw = clampN(iw * 0.24, 8, 30);
      ctx.fillRect(ix + iw * 0.12, iy + ih * 0.24, cw, ih * 0.52);
      ctx.strokeRect(ix + iw * 0.12, iy + ih * 0.24, cw, ih * 0.52);
      arr(ctx, ix + iw * 0.55, iy + ih / 2, ix + iw * 0.9, iy + ih / 2, clampN(cell * 0.28, 3, 7));
    } else {
      seg(ctx, ix + iw * 0.3, iy, ix + iw * 0.3, iy + ih);
      seg(ctx, ix + iw * 0.7, iy, ix + iw * 0.7, iy + ih);
      const chh = clampN(ih * 0.24, 8, 30);
      ctx.fillRect(ix + iw * 0.24, iy + ih * 0.12, iw * 0.52, chh);
      ctx.strokeRect(ix + iw * 0.24, iy + ih * 0.12, iw * 0.52, chh);
      arr(ctx, ix + iw / 2, iy + ih * 0.55, ix + iw / 2, iy + ih * 0.9, clampN(cell * 0.28, 3, 7));
    }
    if (typeof anim === "number" && isFinite(anim)) laneRunner2D(ctx, gc, ix, iy, iw, ih, horiz, tri(anim));
  }

  // Free-roaming AGV/AMR: a dashed guide path + a rounded robot body. When
  // `anim` is supplied a vehicle marker LOOPS along the guide path (one
  // direction); omit it for the static form.
  function d2Agv(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.2, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const horiz = w >= d;
    ctx.save();
    ctx.setLineDash([clampN(cell * 0.22, 3, 6), clampN(cell * 0.18, 2, 5)]);
    if (horiz) seg(ctx, ix, iy + ih / 2, ix + iw, iy + ih / 2);
    else seg(ctx, ix + iw / 2, iy, ix + iw / 2, iy + ih);
    ctx.restore();
    // robot body (rounded footprint) with a heading dot
    const bx = horiz ? ix + iw * 0.34 : ix + iw / 2;
    const by = horiz ? iy + ih / 2 : iy + ih * 0.34;
    const br = clampN(Math.min(iw, ih) * 0.26, 4, 12);
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill(); ctx.stroke();
    disc(ctx, horiz ? bx + br * 0.55 : bx, horiz ? by : by + br * 0.55, clampN(br * 0.25, 1.2, 3));
    if (typeof anim === "number" && isFinite(anim)) laneRunner2D(ctx, gc, ix, iy, iw, ih, horiz, ((anim % 1) + 1) % 1);
  }

  /* ------------------------------------------------------------------
   * NEW EQUIPMENT GLYPHS (v1.9 "more equipment types"). Same drawing
   * conventions as above; each keeps the type colour and stays inside
   * its [x,y,w,d] footprint.
   * ------------------------------------------------------------------ */

  // Pick-to-light rack: a fine shelf grid with a lit light-module dot per bay.
  function d2PickToLight(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bays = clampN(Math.round(iw / cell), 2, 12);
    const shelves = clampN(Math.round(ih / (cell * 0.5)), 1, 3);
    for (let i = 0; i <= bays; i++) { const gx = ix + iw * i / bays; seg(ctx, gx, iy, gx, iy + ih); }
    for (let j = 0; j <= shelves; j++) { const gy = iy + ih * j / shelves; seg(ctx, ix, gy, ix + iw, gy); }
    // a lit pick-to-light module dot centred in each bay
    for (let i = 0; i < bays; i++) disc(ctx, ix + iw * (i + 0.5) / bays, iy + ih * 0.5, clampN(cell * 0.08, 1.5, 3));
  }

  // VNA narrow-aisle racking: dense narrow bays + a dashed centre guide rail.
  function d2Vna(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bays = clampN(Math.round(iw / (cell * 0.5)), 3, 18);
    for (let i = 0; i <= bays; i++) { const gx = ix + iw * i / bays; seg(ctx, gx, iy, gx, iy + ih); }
    seg(ctx, ix, iy, ix + iw, iy);
    seg(ctx, ix, iy + ih, ix + iw, iy + ih);
    // the wire/rail guidance line down the aisle (dashed, bolder)
    ctx.save();
    ctx.setLineDash([clampN(cell * 0.24, 3, 7), clampN(cell * 0.16, 2, 4)]);
    ctx.lineWidth = clampN(cell * 0.08, 1.5, 3);
    seg(ctx, ix, iy + ih / 2, ix + iw, iy + ih / 2);
    ctx.restore();
  }

  // Forklift / reach truck: a truck body + a mast bar + two projecting forks.
  function d2Forklift(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bw = iw * 0.5, bh = ih * 0.62;
    const bx = ix, by = iy + (ih - bh) / 2;
    ctx.fillRect(bx, by, bw, bh);      // truck body
    ctx.strokeRect(bx, by, bw, bh);
    const mx = bx + bw;                 // the mast at the body front
    ctx.lineWidth = clampN(cell * 0.09, 1.5, 3);
    seg(ctx, mx, by, mx, by + bh);
    ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
    seg(ctx, mx, iy + ih * 0.34, ix + iw, iy + ih * 0.34); // fork tines
    seg(ctx, mx, iy + ih * 0.66, ix + iw, iy + ih * 0.66);
  }

  // Charging station: a dashed charge pad + a post + a lightning bolt.
  function d2Charging(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const pad = clampN(Math.min(iw, ih) * 0.7, 4, 30);
    ctx.save();
    ctx.setLineDash([clampN(cell * 0.2, 2, 5), clampN(cell * 0.16, 2, 4)]);
    ctx.strokeRect(ix, iy + (ih - pad) / 2, pad, pad); // the charge pad on the floor
    ctx.restore();
    const px = ix + iw * 0.72;                          // the charge post
    ctx.lineWidth = clampN(cell * 0.08, 1.5, 3);
    seg(ctx, px, iy, px, iy + ih);
    ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
    const by = iy + ih * 0.5, s = clampN(Math.min(iw, ih) * 0.28, 3, 9); // lightning bolt
    ctx.beginPath();
    ctx.moveTo(px - s * 0.2, by - s);
    ctx.lineTo(px + s * 0.4, by - s * 0.1);
    ctx.lineTo(px - s * 0.1, by + s * 0.1);
    ctx.lineTo(px + s * 0.4, by + s);
    ctx.stroke();
  }

  // Sorter loop: a closed racetrack track + tray ticks + divert chutes +
  // a circulation arrow. Animatable: a tray circulates the loop.
  function d2Sorter(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 3, 10);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const tk = clampN(Math.min(iw, ih) * 0.22, 4, 16);
    ctx.strokeRect(ix, iy, iw, ih);                                   // outer track
    ctx.strokeRect(ix + tk, iy + tk, Math.max(1, iw - 2 * tk), Math.max(1, ih - 2 * tk)); // inner edge
    const cols = clampN(Math.round(iw / cell), 2, 12);
    for (let i = 1; i < cols; i++) {                                  // tray ticks
      const gx = ix + iw * i / cols;
      seg(ctx, gx, iy, gx, iy + tk);
      seg(ctx, gx, iy + ih - tk, gx, iy + ih);
    }
    const diverts = clampN(Math.round(iw / (cell * 1.5)), 1, 5);
    for (let i = 0; i < diverts; i++) {                              // divert chutes
      const gx = ix + iw * (i + 0.5) / diverts;
      seg(ctx, gx, iy + ih - tk, gx - clampN(cell * 0.2, 2, 5), iy + ih);
    }
    arr(ctx, ix + iw * 0.3, iy + tk / 2, ix + iw * 0.7, iy + tk / 2, clampN(cell * 0.24, 3, 6));
    if (typeof anim === "number" && isFinite(anim)) {
      const p = rectPerim(ix + tk / 2, iy + tk / 2, Math.max(1, iw - tk), Math.max(1, ih - tk), anim);
      const ts = clampN(tk * 0.5, 2, 8);
      ctx.fillStyle = gc.stroke;
      ctx.fillRect(p.x - ts / 2, p.y - ts / 2, ts, ts);
    }
  }

  // Stretch-wrap / palletiser: a turntable ring + a pallet + a wrap arm.
  // Animatable: the wrap arm rotates around the load.
  function d2StretchWrap(ctx, x, y, w, d, cell, gc, color, theme, anim) {
    pen(ctx, gc, cell);
    const cx = x + w / 2, cy = y + d / 2;
    const R = clampN(Math.min(w, d) * 0.4, 6, 4000);
    ring(ctx, cx, cy, R);                              // the turntable
    const s = clampN(R * 0.7, 4, 4000);                // the pallet load
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    seg(ctx, cx, cy - s / 2, cx, cy + s / 2);
    const ang = (typeof anim === "number" && isFinite(anim)) ? anim * TAU : -Math.PI / 2;
    const ax = cx + Math.cos(ang) * R, ay = cy + Math.sin(ang) * R;
    seg(ctx, cx + Math.cos(ang) * s * 0.5, cy + Math.sin(ang) * s * 0.5, ax, ay); // the film mast/arm
    ctx.fillStyle = gc.stroke;
    disc(ctx, ax, ay, clampN(R * 0.16, 2, 4000));      // the film-roll head
  }

  // Returns / QA station: a bench + a "return" arrow + a QA inspection lens.
  function d2Returns(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.18, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const bh = clampN(ih * 0.4, 4, 16);
    ctx.fillRect(ix, iy + (ih - bh) / 2, iw, bh);      // bench top
    ctx.strokeRect(ix, iy + (ih - bh) / 2, iw, bh);
    const cy = iy + ih / 2;
    arr(ctx, ix + iw * 0.72, cy, ix + iw * 0.3, cy, clampN(cell * 0.26, 3, 7)); // return arrow
    const lr = clampN(Math.min(iw, ih) * 0.14, 3, 8);  // QA lens
    const lx = ix + iw * 0.82;
    ring(ctx, lx, cy, lr);
    seg(ctx, lx + lr * 0.7, cy + lr * 0.7, lx + lr * 1.4, cy + lr * 1.4);
  }

  // Gate / sectional door: side posts + horizontal roller-door slats + a latch.
  function d2Gate(ctx, x, y, w, d, cell, gc) {
    pen(ctx, gc, cell);
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    ctx.lineWidth = clampN(cell * 0.08, 1.5, 3);
    seg(ctx, ix, iy, ix, iy + ih);                     // side posts
    seg(ctx, ix + iw, iy, ix + iw, iy + ih);
    ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
    const slats = clampN(Math.round(ih / (cell * 0.28)), 2, 6);
    for (let j = 1; j < slats; j++) { const gy = iy + ih * j / slats; seg(ctx, ix, gy, ix + iw, gy); } // slats
    seg(ctx, ix, iy, ix + iw, iy);
    seg(ctx, ix, iy + ih, ix + iw, iy + ih);
    disc(ctx, ix + iw / 2, iy + ih / 2, clampN(cell * 0.06, 1.2, 2.6)); // latch
  }

  /* ==================================================================
   * TINY LOD ICONS. Drawn centred at (cx,cy) with radius r when a
   * footprint is too small on-screen for the full glyph. Cheap (a few
   * strokes) and legible at any zoom.
   * ================================================================== */
  function icGrid(ctx, cx, cy, r) {
    ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    seg(ctx, cx, cy - r, cx, cy + r);
    seg(ctx, cx - r, cy, cx + r, cy);
  }
  function icChevron(ctx, cx, cy, r) { chev(ctx, cx, cy + r * 0.4, r * 0.8, "down"); chev(ctx, cx, cy - r * 0.2, r * 0.8, "down"); }
  function icTower(ctx, cx, cy, r) { ctx.strokeRect(cx - r * 0.6, cy - r, r * 1.2, r * 2); seg(ctx, cx, cy - r, cx, cy + r); }
  function icPlatform(ctx, cx, cy, r) { seg(ctx, cx - r, cy - r * 0.3, cx + r, cy - r * 0.3); seg(ctx, cx - r * 0.7, cy - r * 0.3, cx - r * 0.7, cy + r); seg(ctx, cx + r * 0.7, cy - r * 0.3, cx + r * 0.7, cy + r); }
  function icBelt(ctx, cx, cy, r) { arr(ctx, cx - r, cy, cx + r, cy, r * 0.6); }
  function icBench(ctx, cx, cy, r) { ctx.strokeRect(cx - r, cy - r * 0.4, r * 2, r * 0.8); }
  function icCart(ctx, cx, cy, r) { ctx.fillRect(cx - r * 0.7, cy - r * 0.5, r * 1.4, r); seg(ctx, cx - r, cy + r * 0.7, cx + r, cy + r * 0.7); }
  function icRobot(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.stroke(); }
  function icStack(ctx, cx, cy, r) { ctx.strokeRect(cx - r, cy - r, r, r); ctx.strokeRect(cx, cy, r, r); ctx.strokeRect(cx - r * 0.5, cy - r * 0.5, r, r); }
  function icDoor(ctx, cx, cy, r) { ctx.strokeRect(cx - r * 0.6, cy - r, r * 1.2, r * 2); arr(ctx, cx, cy + r * 0.6, cx, cy - r * 0.6, r * 0.5); }
  function icDash(ctx, cx, cy, r) { ctx.save(); ctx.setLineDash([r * 0.5, r * 0.4]); ctx.strokeRect(cx - r, cy - r * 0.7, r * 2, r * 1.4); ctx.restore(); }
  function icArm(ctx, cx, cy, r) { seg(ctx, cx - r * 0.7, cy - r, cx - r * 0.7, cy + r); seg(ctx, cx - r * 0.7, cy - r * 0.5, cx + r, cy - r * 0.5); seg(ctx, cx - r * 0.7, cy + r * 0.3, cx + r, cy + r * 0.3); }
  // v1.9 equipment icons.
  function icForklift(ctx, cx, cy, r) { ctx.fillRect(cx - r, cy - r * 0.5, r, r); seg(ctx, cx, cy - r * 0.5, cx + r, cy - r * 0.5); seg(ctx, cx, cy + r * 0.5, cx + r, cy + r * 0.5); }
  function icBolt(ctx, cx, cy, r) { ctx.beginPath(); ctx.moveTo(cx + r * 0.2, cy - r); ctx.lineTo(cx - r * 0.4, cy); ctx.lineTo(cx + r * 0.1, cy); ctx.lineTo(cx - r * 0.2, cy + r); ctx.stroke(); }
  function icLoop(ctx, cx, cy, r) { ctx.strokeRect(cx - r, cy - r * 0.7, r * 2, r * 1.4); ctx.strokeRect(cx - r * 0.5, cy - r * 0.3, r, r * 0.6); }
  function icWrap(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, TAU); ctx.stroke(); ctx.strokeRect(cx - r * 0.4, cy - r * 0.4, r * 0.8, r * 0.8); }
  function icReturn(ctx, cx, cy, r) { arr(ctx, cx + r, cy, cx - r, cy, r * 0.6); }
  function icGate(ctx, cx, cy, r) { ctx.strokeRect(cx - r * 0.8, cy - r, r * 1.6, r * 2); seg(ctx, cx - r * 0.8, cy - r * 0.4, cx + r * 0.8, cy - r * 0.4); seg(ctx, cx - r * 0.8, cy + r * 0.3, cx + r * 0.8, cy + r * 0.3); }
  function icLight(ctx, cx, cy, r) { ctx.strokeRect(cx - r, cy - r, r * 2, r * 2); disc(ctx, cx, cy, r * 0.35); }

  /* ==================================================================
   * 3D PRIMITIVES (world cells -> px via the caller-supplied P). All
   * heights are the domain heightM in metres; z rises the point.
   * ================================================================== */
  function quad(ctx, A, B, C, D, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function edge(ctx, P, x1, y1, z1, x2, y2, z2, stroke, lw) {
    const A = P(x1, y1, z1), B = P(x2, y2, z2);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke();
  }
  // A solid extruded box (left, right, top faces). Consistent light dir.
  function box3d(ctx, P, x, y, w, d, h, color) {
    const B = P(x + w, y, 0), C = P(x + w, y + d, 0), Dp = P(x, y + d, 0);
    const At = P(x, y, h), Bt = P(x + w, y, h), Ct = P(x + w, y + d, h), Dt = P(x, y + d, h);
    ctx.lineJoin = "round";
    quad(ctx, Dp, C, Ct, Dt, shade(color, FACE.left), shade(color, FACE.left * 0.7));
    quad(ctx, B, C, Ct, Bt, shade(color, FACE.right), shade(color, FACE.right * 0.7));
    quad(ctx, At, Bt, Ct, Dt, shade(color, FACE.top), shade(color, 0.85));
  }
  // A thin solid column (post/leg) centred on (cx,cy), footprint t x t.
  function colBox(ctx, P, cx, cy, t, h, color) { box3d(ctx, P, cx - t / 2, cy - t / 2, t, t, h, color); }
  // A FLOATING slab between heights z0..z1 (raised deck): two side faces +
  // the top face, leaving the space beneath it open.
  function slab3d(ctx, P, x, y, w, d, z0, z1, color) {
    quad(ctx, P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x, y + d, z1), shade(color, FACE.left), shade(color, FACE.left * 0.7));
    quad(ctx, P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x + w, y, z1), shade(color, FACE.right), shade(color, FACE.right * 0.7));
    quad(ctx, P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1), shade(color, FACE.top), shade(color, 0.85));
  }
  // A small solid load/carriage of footprint rw x rd + height h that travels
  // a footprint lane at `along01` (0..1) along the long axis (`horiz` picks
  // x vs y), centred on the short axis. One drawer for the animated conveyor
  // loads and the RGV/AGV/crane/shuttle carriages (only drawn when animating).
  function runner3D(ctx, P, x, y, w, d, along01, horiz, rw, rd, h, color) {
    const bx = horiz ? x + along01 * (w - rw) : x + (w - rw) / 2;
    const by = horiz ? y + (d - rd) / 2 : y + along01 * (d - rd);
    box3d(ctx, P, bx, by, rw, rd, h, color);
  }

  // An open rack FRAME (see-through shelving): solid corner posts + beam
  // outlines per level + intermediate bay uprights. `opt`: {levels, bays,
  // front (draw the front face), sides}.
  function frame3d(ctx, P, x, y, w, d, h, color, theme, opt) {
    opt = opt || {};
    const t = clampN(Math.min(w, d) * 0.22, 0.08, 0.22);
    const bm = beamColor(color, theme);
    const front = opt.front !== false;
    // solid corner posts for weight
    colBox(ctx, P, x + t / 2, y + t / 2, t, h, color);
    colBox(ctx, P, x + w - t / 2, y + t / 2, t, h, color);
    if (front) { colBox(ctx, P, x + t / 2, y + d - t / 2, t, h, color); colBox(ctx, P, x + w - t / 2, y + d - t / 2, t, h, color); }
    const levels = clampN(opt.levels || 3, 2, 8);
    for (let i = 0; i <= levels; i++) {
      const z = (h * i) / levels;
      edge(ctx, P, x, y, z, x + w, y, z, bm);                 // back beam
      edge(ctx, P, x, y, z, x, y + d, z, bm);                 // left rail
      edge(ctx, P, x + w, y, z, x + w, y + d, z, bm);         // right rail
      if (front) edge(ctx, P, x, y + d, z, x + w, y + d, z, bm); // front beam
    }
    const bays = clampN(opt.bays || Math.round(w / 1.5), 1, 8);
    for (let b = 1; b < bays; b++) {
      const gx = x + (w * b) / bays;
      edge(ctx, P, gx, y, 0, gx, y, h, bm);
      if (front) edge(ctx, P, gx, y + d, 0, gx, y + d, h, bm);
    }
  }
  function selOutline(ctx, P, x, y, w, d, h, col) {
    edge(ctx, P, x, y, h, x + w, y, h, col, 2.4);
    edge(ctx, P, x + w, y, h, x + w, y + d, h, col, 2.4);
    edge(ctx, P, x + w, y + d, h, x, y + d, h, col, 2.4);
    edge(ctx, P, x, y + d, h, x, y, h, col, 2.4);
  }

  /* ==================================================================
   * PER-TYPE 3D FORMS. Signature: (ctx, P, x, y, w, d, h, color, theme).
   * ================================================================== */
  function d3Selective(ctx, P, x, y, w, d, h, color, theme) { frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 3, bays: Math.round(w / 1.5) }); }

  function d3Block(ctx, P, x, y, w, d, h, color) {
    const cols = clampN(Math.round(w / 1.4), 2, 4), rows = clampN(Math.round(d / 1.4), 2, 4);
    const g = 0.12;
    const cw = (w - g) / cols, ch = (d - g) / rows;
    // back-to-front so nearer stacks overdraw farther ones
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = x + g + c * cw, by = y + g + r * ch;
        box3d(ctx, P, bx, by, cw - g, ch - g, h, color);
        // layer ticks on the visible right face for the "stacked" read
        const bm = shade(color, 0.55);
        for (let k = 1; k < 3; k++) edge(ctx, P, bx + cw - g, by, (h * k) / 3, bx + cw - g, by + ch - g, (h * k) / 3, bm);
      }
    }
  }

  function d3DriveIn(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 3, bays: Math.round(w / 1.5), front: false });
    // floor lane rails into the depth (the truck drives in)
    const bm = beamColor(color, theme);
    const lanes = clampN(Math.round(w / 1.2), 2, 6);
    for (let i = 0; i <= lanes; i++) { const gx = x + (w * i) / lanes; edge(ctx, P, gx, y, 0, gx, y + d, 0, bm); }
  }

  function d3DoubleDeep(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 3, bays: Math.round(w / 1.5) });
    // the two-deep divider row at mid depth
    const bm = beamColor(color, theme);
    for (let i = 0; i <= 3; i++) { const z = (h * i) / 3; edge(ctx, P, x, y + d / 2, z, x + w, y + d / 2, z, bm); }
  }

  function d3PushBack(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 3, bays: Math.round(w / 1.5) });
    // inclined rails on the left face (nested carts run back-and-up)
    const bm = beamColor(color, theme);
    for (let i = 0; i < 3; i++) { const z = (h * (i + 0.4)) / 3; edge(ctx, P, x, y + d, z - h * 0.12, x, y, z, bm); }
  }

  function d3PalletFlow(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 3, bays: Math.round(w / 1.5) });
    // a clearly inclined gravity lane on top: front-low -> back-high
    const bm = beamColor(color, theme);
    const lanes = clampN(Math.round(w / 1.5), 2, 5);
    for (let i = 0; i < lanes; i++) {
      const gx = x + w * (i + 0.5) / lanes;
      edge(ctx, P, gx, y + d, h * 0.7, gx, y, h, bm);
    }
  }

  function d3CartonFlow(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 4, bays: Math.max(1, Math.round(w / 1.5)) });
  }

  function d3Mobile(ctx, P, x, y, w, d, h, color, theme) {
    const base = clampN(h * 0.08, 0.25, 0.6);
    box3d(ctx, P, x, y, w, d, base, shade(color, 0.7)); // the powered mobile base
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 4, bays: Math.round(w / 1.5) });
  }

  function d3Cantilever(ctx, P, x, y, w, d, h, color, theme) {
    const bm = beamColor(color, theme);
    const t = clampN(Math.min(w, d) * 0.14, 0.1, 0.25);
    const cols = clampN(Math.round(w / 2), 2, 5);
    for (let i = 0; i <= cols; i++) {
      const cx = x + t / 2 + (w - t) * i / cols;
      colBox(ctx, P, cx, y + t / 2, t, h, color); // back column
      // horizontal arms reaching to the front at each level
      for (let k = 1; k <= 3; k++) {
        const z = (h * k) / 3.2;
        edge(ctx, P, cx, y, z, cx, y + d, z, bm, 1.4);
      }
    }
  }

  function d3Asrs(ctx, P, x, y, w, d, h, color, theme, anim) {
    // double-sided high bay: a rack block each side of a central crane aisle
    const side = w * 0.4, aisle = w - 2 * side;
    frame3d(ctx, P, x, y, side, d, h, color, theme, { levels: 6, bays: Math.max(2, Math.round(side / 1.2)) });
    frame3d(ctx, P, x + side + aisle, y, side, d, h, color, theme, { levels: 6, bays: Math.max(2, Math.round(side / 1.2)) });
    // the stacker-crane mast in the aisle + a trolley box
    const mcx = x + w / 2;
    colBox(ctx, P, mcx, y + d / 2, clampN(aisle * 0.4, 0.2, 0.6), h * 1.02, shade(color, 0.85));
    box3d(ctx, P, mcx - aisle * 0.25, y + d * 0.3, aisle * 0.5, d * 0.4, h * 0.5 + 0.6, color);
    // Animated: the crane carriage runs the aisle (down its depth) and lifts.
    if (typeof anim === "number" && isFinite(anim)) {
      const cw = clampN(aisle * 0.6, 0.2, 1.0), cd = clampN(d * 0.3, 0.3, 2);
      const lift = tri((anim * 2) % 1);
      box3d(ctx, P, mcx - cw / 2, y + tri(anim) * (d - cd), cw, cd, h * (0.3 + 0.6 * lift), lighten(color, 0.24));
    }
  }

  function d3Shuttle(ctx, P, x, y, w, d, h, color, theme, anim) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 6, bays: Math.round(w / 1.4) });
    // the lift shaft at the head (a tall thin solid tower)
    const lw = clampN(w * 0.14, 0.4, 1.2);
    box3d(ctx, P, x, y, lw, d, h, shade(color, 0.82));
    // Animated: a shuttle carriage runs a channel (past the lift) + a lift.
    if (typeof anim === "number" && isFinite(anim)) {
      const cw = clampN(w * 0.16, 0.3, 1.4), cd = clampN(d * 0.5, 0.3, 2);
      const lift = tri((anim * 2) % 1);
      box3d(ctx, P, x + lw + tri(anim) * (w - lw - cw), y + (d - cd) / 2, cw, cd, h * (0.35 + 0.5 * lift), lighten(color, 0.24));
    }
  }

  function d3Mezzanine(ctx, P, x, y, w, d, h, color, theme) {
    const deckZ = h * 0.5, deckT = clampN(h * 0.06, 0.15, 0.4);
    const t = clampN(Math.min(w, d) * 0.1, 0.1, 0.3);
    // corner legs up to the deck - the space beneath stays OPEN
    colBox(ctx, P, x + t, y + t, t, deckZ, color);
    colBox(ctx, P, x + w - t, y + t, t, deckZ, color);
    colBox(ctx, P, x + t, y + d - t, t, deckZ, color);
    colBox(ctx, P, x + w - t, y + d - t, t, deckZ, color);
    // the raised platform slab, floating at the deck height
    slab3d(ctx, P, x, y, w, d, deckZ, deckZ + deckT, color);
    // guard-rail top edges above the deck
    const bm = beamColor(color, theme);
    const railZ = deckZ + deckT + h * 0.14;
    edge(ctx, P, x, y, railZ, x + w, y, railZ, bm);
    edge(ctx, P, x, y + d, railZ, x + w, y + d, railZ, bm);
    edge(ctx, P, x, y, deckZ + deckT, x, y, railZ, bm);
    edge(ctx, P, x + w, y, deckZ + deckT, x + w, y, railZ, bm);
  }

  function d3Conveyor(ctx, P, x, y, w, d, h, color, theme, anim) {
    box3d(ctx, P, x, y, w, d, h, color); // the low belt bed
    const bm = beamColor(color, theme);
    const horiz = w >= d;
    const n = clampN(Math.round((horiz ? w : d) / 0.6), 2, 30);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (horiz) edge(ctx, P, x + w * t, y, h, x + w * t, y + d, h, bm); // rollers across the belt
      else edge(ctx, P, x, y + d * t, h, x + w, y + d * t, h, bm);
    }
    // Animated: unit-loads riding the belt, scrolling in the flow direction.
    if (typeof anim === "number" && isFinite(anim)) {
      const items = 3;
      const rw = horiz ? clampN(w * 0.16, 0.3, 1.4) : clampN(w * 0.5, 0.3, 2);
      const rd = horiz ? clampN(d * 0.5, 0.3, 2) : clampN(d * 0.16, 0.3, 1.4);
      const litc = lighten(color, 0.26);
      const top = h + clampN(h * 0.9, 0.4, 1.3);
      for (let i = 0; i < items; i++) {
        runner3D(ctx, P, x, y, w, d, ((i / items) + anim) % 1, horiz, rw, rd, top, litc);
      }
    }
  }

  function d3Station(ctx, P, x, y, w, d, h, color, theme, kind) {
    const topZ = h * 0.72, topT = clampN(h * 0.16, 0.08, 0.3);
    const t = clampN(Math.min(w, d) * 0.12, 0.08, 0.25);
    // legs
    colBox(ctx, P, x + t, y + t, t, topZ, color);
    colBox(ctx, P, x + w - t, y + t, t, topZ, color);
    colBox(ctx, P, x + t, y + d - t, t, topZ, color);
    colBox(ctx, P, x + w - t, y + d - t, t, topZ, color);
    // bench top slab
    box3d(ctx, P, x, y, w, d, topZ + topT, color);
    const bm = beamColor(color, theme);
    const z = topZ + topT;
    if (kind === "pack") { // a parcel on the bench
      box3d(ctx, P, x + w * 0.32, y + d * 0.28, w * 0.36, d * 0.44, z + h * 0.4, lighten(color, 0.12));
    } else { // a flow arrow etched on the bench top
      const cy = y + d / 2;
      if (kind === "push") edge(ctx, P, x + w * 0.2, cy, z, x + w * 0.85, cy, z, bm, 1.6);
      else edge(ctx, P, x + w * 0.8, cy, z, x + w * 0.15, cy, z, bm, 1.6);
    }
  }
  function d3Push(ctx, P, x, y, w, d, h, color, theme) { d3Station(ctx, P, x, y, w, d, h, color, theme, "push"); }
  function d3Pull(ctx, P, x, y, w, d, h, color, theme) { d3Station(ctx, P, x, y, w, d, h, color, theme, "pull"); }
  function d3Pack(ctx, P, x, y, w, d, h, color, theme) { d3Station(ctx, P, x, y, w, d, h, color, theme, "pack"); }

  function d3Dock(ctx, P, x, y, w, d, h, color, theme) {
    box3d(ctx, P, x, y, w, d, h, color); // the dock wall
    // a recessed door opening on the front (y+d) face
    const dw = w * 0.5, dx = x + (w - dw) / 2, dh = h * 0.72;
    quad(ctx, P(dx, y + d, 0), P(dx + dw, y + d, 0), P(dx + dw, y + d, dh), P(dx, y + d, dh), shade(color, 0.45), shade(color, 0.35), 1);
  }

  function d3Staging(ctx, P, x, y, w, d, h, color, theme) {
    box3d(ctx, P, x, y, w, d, h, color); // a low outlined holding pad
    const bm = beamColor(color, theme);
    // a dashed-look divider across the pad top
    edge(ctx, P, x, y + d / 2, h, x + w, y + d / 2, h, bm);
  }

  function d3Rgv(ctx, P, x, y, w, d, h, color, theme, anim) {
    const bm = beamColor(color, theme);
    const horiz = w >= d;
    if (horiz) {
      edge(ctx, P, x, y + d * 0.3, 0, x + w, y + d * 0.3, 0, bm, 1.4); // twin floor rails
      edge(ctx, P, x, y + d * 0.7, 0, x + w, y + d * 0.7, 0, bm, 1.4);
    } else {
      edge(ctx, P, x + w * 0.3, y, 0, x + w * 0.3, y + d, 0, bm, 1.4);
      edge(ctx, P, x + w * 0.7, y, 0, x + w * 0.7, y + d, 0, bm, 1.4);
    }
    // the cart body riding the rail
    const cw = horiz ? w * 0.3 : w * 0.6, cd = horiz ? d * 0.6 : d * 0.3;
    box3d(ctx, P, x + (w - cw) / 2, y + (d - cd) / 2, cw, cd, h, color);
    // Animated: a carriage travelling the rail back-and-forth.
    if (typeof anim === "number" && isFinite(anim)) {
      const rw = horiz ? clampN(w * 0.2, 0.4, 2) : clampN(w * 0.55, 0.4, 3);
      const rd = horiz ? clampN(d * 0.55, 0.4, 3) : clampN(d * 0.2, 0.4, 2);
      runner3D(ctx, P, x, y, w, d, tri(anim), horiz, rw, rd, h * 1.1, lighten(color, 0.24));
    }
  }

  function d3Agv(ctx, P, x, y, w, d, h, color, theme, anim) {
    const bm = beamColor(color, theme);
    const horiz = w >= d;
    // a dashed guide path on the floor
    const segs = 5;
    for (let i = 0; i < segs; i += 1) {
      if (i % 2) continue;
      if (horiz) edge(ctx, P, x + w * i / segs, y + d / 2, 0, x + w * (i + 1) / segs, y + d / 2, 0, bm, 1.2);
      else edge(ctx, P, x + w / 2, y + d * i / segs, 0, x + w / 2, y + d * (i + 1) / segs, 0, bm, 1.2);
    }
    // a small robot body
    const cw = clampN(w * 0.4, 0.6, 3), cd = clampN(d * 0.4, 0.6, 3);
    box3d(ctx, P, x + (w - cw) / 2, y + (d - cd) / 2, cw, cd, h, color);
    // Animated: the robot body loops along the guide path (one direction).
    if (typeof anim === "number" && isFinite(anim)) {
      const rw = horiz ? clampN(w * 0.28, 0.5, 3) : clampN(w * 0.5, 0.5, 3);
      const rd = horiz ? clampN(d * 0.5, 0.5, 3) : clampN(d * 0.28, 0.5, 3);
      runner3D(ctx, P, x, y, w, d, ((anim % 1) + 1) % 1, horiz, rw, rd, h * 1.1, lighten(color, 0.24));
    }
  }

  /* ------------------------------------------------------------------
   * NEW EQUIPMENT FORMS (v1.9 "more equipment types"). Reuse the same
   * primitives (box3d/colBox/frame3d/edge/quad); every form is extruded
   * by the domain heightM so a taller element rises on screen.
   * ------------------------------------------------------------------ */

  // Pick-to-light rack: a low see-through shelf frame + lit pick-face displays.
  function d3PickToLight(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 4, bays: Math.max(1, Math.round(w / 1.2)) });
    const lit = lighten(color, 0.34);
    const bays = clampN(Math.round(w / 1.2), 2, 8);
    for (let b = 0; b < bays; b++) {
      const bx0 = x + w * (b + 0.3) / bays, bx1 = x + w * (b + 0.7) / bays;
      const z0 = h * 0.45, z1 = h * 0.62;
      quad(ctx, P(bx0, y + d, z0), P(bx1, y + d, z0), P(bx1, y + d, z1), P(bx0, y + d, z1), lit, shade(color, 0.5), 1);
    }
  }

  // VNA narrow-aisle racking: a tall, many-level narrow rack frame + a floor
  // guide rail along the front (the guided VNA aisle).
  function d3Vna(ctx, P, x, y, w, d, h, color, theme) {
    frame3d(ctx, P, x, y, w, d, h, color, theme, { levels: 5, bays: Math.max(2, Math.round(w / 0.9)) });
    const bm = beamColor(color, theme);
    edge(ctx, P, x, y + d, 0, x + w, y + d, 0, bm, 2.2);
  }

  // Forklift / reach truck: a vehicle body, a vertical mast to full height,
  // and two fork tines projecting forward at the floor.
  function d3Forklift(ctx, P, x, y, w, d, h, color, theme) {
    const bw = w * 0.5, bd = d * 0.6;
    const bx = x + w * 0.05, by = y + (d - bd) / 2;
    box3d(ctx, P, bx, by, bw, bd, h * 0.5, color);       // truck body
    const mx = bx + bw;
    const bm = beamColor(color, theme);
    const t = clampN(Math.min(w, d) * 0.12, 0.08, 0.3);
    colBox(ctx, P, mx, y + d / 2, t, h, shade(color, 0.85)); // the mast (full height)
    edge(ctx, P, mx, y + d * 0.34, 0.05, x + w, y + d * 0.34, 0.05, bm, 1.8); // fork tines
    edge(ctx, P, mx, y + d * 0.66, 0.05, x + w, y + d * 0.66, 0.05, bm, 1.8);
  }

  // Charging station: a low floor pad + a charge post + a cable to the pad.
  function d3Charging(ctx, P, x, y, w, d, h, color, theme) {
    box3d(ctx, P, x, y, w, d, h * 0.14, shade(color, 0.7)); // the floor pad
    const t = clampN(Math.min(w, d) * 0.34, 0.15, 0.7);
    colBox(ctx, P, x + w * 0.74, y + d / 2, t, h, color);   // the charge post (full height)
    const bm = beamColor(color, theme);
    edge(ctx, P, x + w * 0.74, y + d / 2, h * 0.85, x + w * 0.2, y + d / 2, h * 0.4, bm, 1.6); // the cable
  }

  // Sorter loop: a low sortation deck + a loop channel + tray ticks. Animatable:
  // a tray circulates the loop.
  function d3Sorter(ctx, P, x, y, w, d, h, color, theme, anim) {
    box3d(ctx, P, x, y, w, d, h, color); // the low deck
    const bm = beamColor(color, theme);
    const inx = clampN(Math.min(w, d) * 0.22, 0.3, 2);
    edge(ctx, P, x + inx, y + inx, h, x + w - inx, y + inx, h, bm);
    edge(ctx, P, x + w - inx, y + inx, h, x + w - inx, y + d - inx, h, bm);
    edge(ctx, P, x + w - inx, y + d - inx, h, x + inx, y + d - inx, h, bm);
    edge(ctx, P, x + inx, y + d - inx, h, x + inx, y + inx, h, bm);
    const cols = clampN(Math.round(w / 1.0), 2, 12);
    for (let i = 1; i < cols; i++) {
      const gx = x + w * i / cols;
      edge(ctx, P, gx, y, h, gx, y + inx, h, bm);
      edge(ctx, P, gx, y + d - inx, h, gx, y + d, h, bm);
    }
    if (typeof anim === "number" && isFinite(anim)) {
      const p = rectPerim(x + inx, y + inx, Math.max(0.2, w - 2 * inx), Math.max(0.2, d - 2 * inx), anim);
      const ts = clampN(inx * 0.8, 0.2, 1.2);
      box3d(ctx, P, p.x - ts / 2, p.y - ts / 2, ts, ts, h + clampN(h * 0.6, 0.3, 1), lighten(color, 0.26));
    }
  }

  // Stretch-wrap / palletiser: a turntable base + a pallet + a wrap mast that
  // orbits the load. Animatable: the mast rotates around.
  function d3StretchWrap(ctx, P, x, y, w, d, h, color, theme, anim) {
    box3d(ctx, P, x, y, w, d, h * 0.12, shade(color, 0.72)); // the turntable base
    const pw = w * 0.5, pd = d * 0.5;
    box3d(ctx, P, x + (w - pw) / 2, y + (d - pd) / 2, pw, pd, h * 0.55, lighten(color, 0.1)); // the pallet load
    const cxw = x + w / 2, cyw = y + d / 2, R = Math.min(w, d) * 0.42;
    const ang = (typeof anim === "number" && isFinite(anim)) ? anim * TAU : -Math.PI / 2;
    const t = clampN(Math.min(w, d) * 0.12, 0.08, 0.3);
    colBox(ctx, P, cxw + Math.cos(ang) * R, cyw + Math.sin(ang) * R, t, h, color); // the wrap mast (full height)
  }

  // Returns / QA station: a bench on legs + an upright inspection screen.
  function d3Returns(ctx, P, x, y, w, d, h, color, theme) {
    const topZ = h * 0.66, topT = clampN(h * 0.16, 0.08, 0.3);
    const t = clampN(Math.min(w, d) * 0.12, 0.08, 0.25);
    colBox(ctx, P, x + t, y + t, t, topZ, color);
    colBox(ctx, P, x + w - t, y + t, t, topZ, color);
    colBox(ctx, P, x + t, y + d - t, t, topZ, color);
    colBox(ctx, P, x + w - t, y + d - t, t, topZ, color);
    box3d(ctx, P, x, y, w, d, topZ + topT, color); // the bench top
    const pw = w * 0.3, pd = clampN(d * 0.1, 0.08, 0.3);
    box3d(ctx, P, x + w * 0.2, y + d * 0.3, pw, pd, topZ + topT + h * 0.35, lighten(color, 0.12)); // inspection screen
  }

  // Gate / sectional door: a tall wall / door frame + horizontal roller slats.
  function d3Gate(ctx, P, x, y, w, d, h, color, theme) {
    box3d(ctx, P, x, y, w, d, h, color); // the door frame / wall
    const bm = beamColor(color, theme);
    const slats = 4;
    for (let j = 1; j < slats; j++) {
      const z = h * j / slats;
      edge(ctx, P, x, y + d, z, x + w, y + d, z, bm, 1.4); // the slats on the front face
    }
  }

  /* ==================================================================
   * RICH DETAIL TIER (v1.11 "realistic high-detail rendering"). A THIRD
   * LOD tier drawn ONLY when an element reads large on screen (zoomed in):
   * the base glyph / form still draws first (so animated parts keep
   * moving), then these overlays add the fine, recognisable detail -
   * pallet load-units in the bays, extra shelf levels, crane carriages,
   * decked platforms, vehicle loads. Zoomed OUT the app never reaches this
   * tier (icon / glyph exactly as before), so big layouts stay fast.
   *
   * HONESTY: the load-units are a DETERMINISTIC fill pattern (a fixed rule
   * seeded from the element - NO Date, NO RNG) - a schematic "this bay holds
   * pallets" read, ILLUSTRATIVE only: NOT the actual computed inventory
   * count, and NOT CAD/BIM/survey geometry.
   * ================================================================== */

  // On-screen px-per-cell tier thresholds. Below GLYPH_MIN -> a single LOD
  // icon; between the two -> the schematic glyph/form (today's default);
  // at or above RICH_MIN -> the high-detail overlays kick in.
  const DETAIL_GLYPH_MIN = 10; // px/cell: below this -> "icon"
  const DETAIL_RICH_MIN = 40;  // px/cell: at/above this -> "rich"
  // PURE: the detail tier for a given ON-SCREEN px-per-cell. Deterministic,
  // garbage-safe (non-finite / non-positive -> the cheapest "icon" tier).
  function detailLevel(pxPerCell) {
    const p = Number(pxPerCell);
    if (!isFinite(p) || p < DETAIL_GLYPH_MIN) return "icon";
    if (p < DETAIL_RICH_MIN) return "glyph";
    return "rich";
  }

  // Deterministic hash of two integers -> [0,1). Pure, allocation-free, no
  // Date and no RNG (same shape as the app's per-element anim seed), so the
  // load-unit fill is stable frame-to-frame and testable.
  function hash01(a, b) {
    let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663);
    h = h & 0x7fffffff;
    return (h % 100000) / 100000;
  }
  const RICH_FILL = 0.62; // illustrative share of positions shown loaded
  // "Is slot i (of a rack seeded by `seed`) carrying a load-unit?"
  function loaded(i, seed, frac) { return hash01(i + 1, (seed | 0) + 1) < (frac > 0 ? frac : RICH_FILL); }

  /* ---- rich 2D primitives ------------------------------------------ */
  // Small pallet load-units in a deterministic share of an inner bay grid.
  function richPallets2D(ctx, x, y, w, d, cell, gc, color, theme, seed, opt) {
    opt = opt || {};
    const m = clampN(Math.min(w, d) * (opt.margin || 0.16), 2, 8);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    if (!(iw > 2 && ih > 2)) return;
    const cols = clampN(Math.round(iw / cell), 2, 16);
    const rows = clampN(opt.rows || Math.round(ih / (cell * 0.6)), 1, 6);
    const cw = iw / cols, ch = ih / rows;
    const pad = clampN(Math.min(cw, ch) * 0.22, 1, 4);
    ctx.save();
    ctx.fillStyle = rgba(theme === "dark" ? lighten(color, 0.2) : shade(color, 0.82), theme === "dark" ? 0.6 : 0.5);
    ctx.strokeStyle = gc.stroke;
    ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!loaded(r * cols + c, seed, opt.frac)) continue;
        const bx = ix + c * cw + pad, by = iy + r * ch + pad;
        const bw = cw - 2 * pad, bh = ch - 2 * pad;
        if (bw <= 0 || bh <= 0) continue;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
        seg(ctx, bx + bw / 2, by, bx + bw / 2, by + bh); // unit-load centre seam
      }
    }
    ctx.restore();
  }
  function r2Rack(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    richPallets2D(ctx, x, y, w, d, cell, gc, color, theme, seed, {});
  }
  function r2Asrs(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.12, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const aisle = clampN(ih * 0.3, 4, 14);
    const topH = (ih - aisle) / 2, botY = iy + topH + aisle;
    richPallets2D(ctx, ix, iy, iw, topH, cell, gc, color, theme, seed, { margin: 0.06, rows: 1, frac: 0.75 });
    richPallets2D(ctx, ix, botY, iw, topH, cell, gc, color, theme, seed + 7, { margin: 0.06, rows: 1, frac: 0.75 });
  }
  function r2Shuttle(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.14, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const lift = clampN(cell * 0.4, 4, 10);
    richPallets2D(ctx, ix + lift, iy, iw - lift, ih, cell, gc, color, theme, seed,
      { rows: clampN(Math.round(ih / (cell * 0.5)), 2, 6), frac: 0.66 });
  }
  function r2Conveyor(ctx, x, y, w, d, cell, gc, color, theme, seed, anim) {
    if (typeof anim === "number" && isFinite(anim)) return; // base already scrolls loads
    const m = clampN(Math.min(w, d) * 0.18, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const horiz = w >= d;
    const isz = clampN(Math.min(iw, ih) * 0.5, 3, 12);
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    for (let i = 0; i < 2; i++) {
      const frac = 0.3 + 0.4 * i;
      const bx = horiz ? ix + frac * (iw - isz) : ix + iw / 2 - isz / 2;
      const by = horiz ? iy + ih / 2 - isz / 2 : iy + frac * (ih - isz);
      ctx.fillRect(bx, by, isz, isz); ctx.strokeRect(bx, by, isz, isz);
    }
    ctx.restore();
  }
  function r2Bench(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.2, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const s = clampN(Math.min(iw, ih) * 0.26, 4, 14);
    const bx = ix + iw * 0.14, by = iy + ih / 2 - s / 2;
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    ctx.fillRect(bx, by, s, s); ctx.strokeRect(bx, by, s, s);
    seg(ctx, bx, by + s * 0.4, bx + s, by + s * 0.4); // tote lip
    ctx.restore();
  }
  function r2Dock(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const dw = clampN(iw * 0.5, 6, 40), dx = ix + (iw - dw) / 2;
    const dh = clampN(ih * 0.28, 3, 10);
    ctx.save();
    ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    for (let j = 1; j < 3; j++) seg(ctx, dx, iy + dh * j / 3, dx + dw, iy + dh * j / 3); // door panel slats
    seg(ctx, dx, iy, dx, iy + dh); seg(ctx, dx + dw, iy, dx + dw, iy + dh);              // door guide rails
    ctx.restore();
  }
  function r2Mezz(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 3, 8);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const cols = clampN(Math.round(iw / cell), 2, 6), rows = clampN(Math.round(ih / cell), 1, 4);
    const pr = clampN(cell * 0.07, 1.2, 2.6);
    ctx.save();
    ctx.fillStyle = gc.stroke;
    for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) disc(ctx, ix + iw * c / cols, iy + ih * r / rows, pr);
    ctx.restore();
  }
  function r2Forklift(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const s = clampN(Math.min(iw, ih) * 0.3, 3, 12);
    const bx = ix + iw - s, by = iy + ih / 2 - s / 2;
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    ctx.fillRect(bx, by, s, s); ctx.strokeRect(bx, by, s, s); // pallet on the forks
    ctx.restore();
  }
  function r2CartLoad(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const cx = x + w / 2, cy = y + d / 2;
    const s = clampN(Math.min(w, d) * 0.24, 3, 12);
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s); ctx.strokeRect(cx - s / 2, cy - s / 2, s, s); // load on the vehicle
    ctx.restore();
  }
  function r2Staging(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    richPallets2D(ctx, x, y, w, d, cell, gc, color, theme, seed, { frac: 0.5, rows: 2 });
  }
  function r2Sorter(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 3, 10);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const tk = clampN(Math.min(iw, ih) * 0.22, 4, 16);
    const s = clampN(tk * 0.5, 2, 8);
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    const spots = [[0.3, 0], [0.7, 0], [0.5, 1]];
    for (let i = 0; i < spots.length; i++) {
      const px = ix + tk / 2 + spots[i][0] * (iw - tk) - s / 2;
      const py = iy + (spots[i][1] > 0.5 ? ih - tk : 0) + tk / 2 - s / 2;
      ctx.fillRect(px, py, s, s); ctx.strokeRect(px, py, s, s); // trays on the loop
    }
    ctx.restore();
  }
  function r2StretchWrap(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const cx = x + w / 2, cy = y + d / 2;
    const R = clampN(Math.min(w, d) * 0.4, 6, 4000);
    const s = clampN(R * 0.7, 4, 4000);
    ctx.save();
    ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.03, 0.7, 1.4);
    for (let k = 1; k <= 3; k++) { const yy = cy - s / 2 + s * k / 4; seg(ctx, cx - s / 2, yy, cx + s / 2, yy); } // wrap-film bands
    ctx.restore();
  }
  function r2Charging(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const px = ix + iw * 0.72, tw = clampN(cell * 0.1, 2, 4);
    ctx.save();
    ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    for (let k = 1; k <= 3; k++) seg(ctx, px - tw, iy + ih * k / 4, px + tw, iy + ih * k / 4); // charge-level ticks
    ctx.restore();
  }
  function r2Gate(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 2, 5);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const th = iy + ih, n = clampN(Math.round(iw / (cell * 0.5)), 3, 16);
    ctx.save();
    ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
    for (let i = 0; i < n; i++) seg(ctx, ix + iw * i / n, th, ix + iw * (i + 0.5) / n, th - clampN(cell * 0.15, 2, 5)); // threshold hazard
    ctx.restore();
  }
  function r2Cantilever(ctx, x, y, w, d, cell, gc, color, theme, seed) {
    const m = clampN(Math.min(w, d) * 0.16, 2, 6);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = d - 2 * m;
    const colX = ix + iw * 0.12, arms = clampN(Math.round(ih / (cell * 0.5)), 2, 4);
    const bh = clampN(cell * 0.12, 2, 5);
    ctx.save();
    ctx.fillStyle = gc.fill; ctx.strokeStyle = gc.stroke; ctx.lineWidth = clampN(cell * 0.04, 0.8, 1.6);
    for (let j = 0; j <= arms; j++) {
      if (!loaded(j, seed, 0.6)) continue;
      const gy = iy + (ih * j) / arms;
      ctx.fillRect(colX + iw * 0.1, gy - bh / 2, iw * 0.7, bh); // long-goods load bar
      ctx.strokeRect(colX + iw * 0.1, gy - bh / 2, iw * 0.7, bh);
    }
    ctx.restore();
  }
  const RICH2D = {
    "selective-racking": r2Rack, "double-deep": r2Rack, "drive-in": r2Rack,
    "push-back": r2Rack, "pallet-flow": r2Rack, "carton-flow": r2Rack,
    "mobile-racking": r2Rack, "vna": r2Rack, "pick-to-light": r2Rack,
    "cantilever": r2Cantilever, "asrs": r2Asrs, "shuttle": r2Shuttle,
    "conveyor": r2Conveyor,
    "push-station": r2Bench, "pull-station": r2Bench, "pack-station": r2Bench, "returns-station": r2Bench,
    "dock-in": r2Dock, "dock-out": r2Dock, "mezzanine": r2Mezz,
    "forklift": r2Forklift, "rgv": r2CartLoad, "agv": r2CartLoad,
    "staging": r2Staging, "sorter": r2Sorter, "stretch-wrap": r2StretchWrap,
    "charging-station": r2Charging, "gate": r2Gate,
  };
  function richDraw2D(ctx, type, x, y, w, d, cell, gc, color, theme, seed, anim) {
    const fn = RICH2D[type];
    if (fn) fn(ctx, x, y, w, d, cell, gc, color, theme, seed, anim);
  }

  /* ---- rich 3D primitives ------------------------------------------ */
  // A solid extruded box occupying z0..z1 (a floating load-unit on a shelf).
  // Same face order + light direction as box3d.
  function box3dZ(ctx, P, x, y, w, d, z0, z1, color) {
    const B = P(x + w, y, z0), C = P(x + w, y + d, z0), Dp = P(x, y + d, z0);
    const At = P(x, y, z1), Bt = P(x + w, y, z1), Ct = P(x + w, y + d, z1), Dt = P(x, y + d, z1);
    ctx.lineJoin = "round";
    quad(ctx, Dp, C, Ct, Dt, shade(color, FACE.left), shade(color, FACE.left * 0.7));
    quad(ctx, B, C, Ct, Bt, shade(color, FACE.right), shade(color, FACE.right * 0.7));
    quad(ctx, At, Bt, Ct, Dt, shade(color, FACE.top), shade(color, 0.85));
  }
  // Pallet load-units on a deterministic share of (bay, level) shelf slots.
  function richRack3D(ctx, P, x, y, w, d, h, color, theme, seed, opt) {
    opt = opt || {};
    const levels = clampN(opt.levels || 3, 1, 8);
    const bays = clampN(opt.bays || Math.round(w / 1.5), 1, 10);
    const frac = opt.frac || RICH_FILL;
    const litc = lighten(color, theme === "dark" ? 0.22 : 0.14);
    const bw = (w / bays) * 0.62;
    const pd = d * 0.6, py = y + (d - pd) / 2;
    const ph = clampN((h / levels) * 0.5, 0.2, h);
    for (let lvl = 0; lvl < levels; lvl++) {
      const z0 = (h * lvl) / levels + (h / levels) * 0.08;
      for (let b = 0; b < bays; b++) {
        if (!loaded(lvl * bays + b, seed, frac)) continue;
        const bx = x + (w * b) / bays + ((w / bays) - bw) / 2;
        box3dZ(ctx, P, bx, py, bw, pd, z0, z0 + ph, litc);
      }
    }
  }
  function f3Rack(levels) {
    return function (ctx, P, x, y, w, d, h, color, theme, seed) {
      richRack3D(ctx, P, x, y, w, d, h, color, theme, seed, { levels: levels, bays: Math.max(1, Math.round(w / 1.5)), frac: RICH_FILL });
    };
  }
  function f3Asrs(ctx, P, x, y, w, d, h, color, theme, seed) {
    const side = w * 0.4, aisle = w - 2 * side;
    richRack3D(ctx, P, x, y, side, d, h, color, theme, seed, { levels: 6, bays: Math.max(2, Math.round(side / 1.2)), frac: 0.7 });
    richRack3D(ctx, P, x + side + aisle, y, side, d, h, color, theme, seed + 11, { levels: 6, bays: Math.max(2, Math.round(side / 1.2)), frac: 0.7 });
  }
  function f3Shuttle(ctx, P, x, y, w, d, h, color, theme, seed) {
    const lw = clampN(w * 0.14, 0.4, 1.2);
    richRack3D(ctx, P, x + lw, y, w - lw, d, h, color, theme, seed, { levels: 6, bays: Math.max(1, Math.round((w - lw) / 1.4)), frac: 0.6 });
  }
  function f3Mezz(ctx, P, x, y, w, d, h, color, theme, seed) {
    const deckZ = h * 0.5, deckT = clampN(h * 0.06, 0.15, 0.4);
    const t = clampN(Math.min(w, d) * 0.06, 0.08, 0.2);
    const cols = clampN(Math.round(w / 2.5), 2, 5), rows = clampN(Math.round(d / 2.5), 1, 4);
    for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) colBox(ctx, P, x + w * c / cols, y + d * r / rows, t, deckZ, shade(color, 0.85)); // interior support posts
    const top = deckZ + deckT;
    const pw = clampN(w * 0.16, 0.4, 1.4), pd = clampN(d * 0.3, 0.4, 2), ph = clampN(h * 0.18, 0.3, 1.2);
    for (let i = 0; i < 3; i++) {
      if (!loaded(i, seed, 0.7)) continue;
      box3dZ(ctx, P, x + w * (0.2 + 0.3 * i), y + d * 0.35, pw, pd, top, top + ph, lighten(color, 0.14)); // pallets on the deck
    }
  }
  function f3Conveyor(ctx, P, x, y, w, d, h, color, theme, seed, anim) {
    if (typeof anim === "number" && isFinite(anim)) return; // base already scrolls loads
    const horiz = w >= d;
    const rw = horiz ? clampN(w * 0.16, 0.3, 1.4) : clampN(w * 0.5, 0.3, 2);
    const rd = horiz ? clampN(d * 0.5, 0.3, 2) : clampN(d * 0.16, 0.3, 1.4);
    const top = h + clampN(h * 0.9, 0.4, 1.3), litc = lighten(color, 0.2);
    for (let i = 0; i < 2; i++) runner3D(ctx, P, x, y, w, d, 0.3 + 0.4 * i, horiz, rw, rd, top, litc);
  }
  function f3Forklift(ctx, P, x, y, w, d, h, color, theme, seed) {
    const s = clampN(Math.min(w, d) * 0.34, 0.3, 1.6);
    box3dZ(ctx, P, x + w * 0.62, y + (d - s) / 2, s, s, 0.05, 0.05 + clampN(h * 0.5, 0.3, 1.4), lighten(color, 0.16)); // pallet on the forks
  }
  function f3Vehicle(ctx, P, x, y, w, d, h, color, theme, seed) {
    const cw = clampN(Math.min(w, d) * 0.4, 0.4, 2);
    box3dZ(ctx, P, x + (w - cw) / 2, y + (d - cw) / 2, cw, cw, h, h + clampN(h * 0.5, 0.3, 1.2), lighten(color, 0.16)); // load on the body
  }
  const RICH3D = {
    "selective-racking": f3Rack(3), "double-deep": f3Rack(3), "drive-in": f3Rack(3),
    "push-back": f3Rack(3), "pallet-flow": f3Rack(3), "carton-flow": f3Rack(4),
    "mobile-racking": f3Rack(4), "vna": f3Rack(5), "pick-to-light": f3Rack(4),
    "asrs": f3Asrs, "shuttle": f3Shuttle, "mezzanine": f3Mezz,
    "conveyor": f3Conveyor, "forklift": f3Forklift, "rgv": f3Vehicle, "agv": f3Vehicle,
  };
  function richDraw3D(ctx, P, type, x, y, w, d, h, color, theme, seed, anim) {
    const fn = RICH3D[type];
    if (fn) fn(ctx, P, x, y, w, d, h, color, theme, seed, anim);
  }

  /* ==================================================================
   * GENERIC RENDERER for USER-DEFINED (library.js) types. A custom type
   * has NO REG entry; draw2D/draw3D fall back here, parameterised by the
   * type's `glyph` (2D) and `base` (3D form) which the caller passes on the
   * g / o object. This is how a DEFINED object draws recognisably at every
   * LOD tier without a bespoke per-type function. It reuses the same
   * primitives + several built-in drawers so a custom object looks at home
   * next to the built-ins. Illustrative schematic only, no external asset.
   * ================================================================== */
  function genericGlyph2D(ctx, glyph, x, y, w, d, cell, gc, color, theme, anim) {
    switch (glyph) {
      case "rack": return d2Selective(ctx, x, y, w, d, cell, gc);
      case "zone": return d2Staging(ctx, x, y, w, d, cell, gc);
      case "arrow": {
        pen(ctx, gc, cell);
        const cy = y + d / 2, m = clampN(Math.min(w, d) * 0.18, 2, 6);
        arr(ctx, x + m, cy, x + w - m, cy, clampN(Math.min(w, d) * 0.28, 4, 10));
        return;
      }
      case "circle": {
        pen(ctx, gc, cell);
        const r = clampN(Math.min(w, d) * 0.34, 3, Math.min(w, d) * 0.46);
        disc(ctx, x + w / 2, y + d / 2, r * 0.62);
        ring(ctx, x + w / 2, y + d / 2, r);
        return;
      }
      case "vehicle": {
        pen(ctx, gc, cell);
        const m = clampN(Math.min(w, d) * 0.2, 2, 6);
        ctx.fillRect(x + m, y + m, Math.max(1, w - 2 * m), Math.max(1, d - 2 * m)); // body
        seg(ctx, x + m, y + d - m * 0.6, x + w - m, y + d - m * 0.6);               // wheels
        seg(ctx, x + m, y + m * 0.6, x + w - m, y + m * 0.6);
        return;
      }
      case "box":
      default: {
        pen(ctx, gc, cell);
        const m = clampN(Math.min(w, d) * 0.2, 2, 7);
        ctx.strokeRect(x + m, y + m, Math.max(1, w - 2 * m), Math.max(1, d - 2 * m));
        seg(ctx, x + m, y + m, x + w - m, y + d - m);          // corner-to-corner (a taped box)
        ctx.strokeRect(x + w * 0.4, y + d * 0.4, w * 0.2, d * 0.2); // inner label square
        return;
      }
    }
  }
  function genericIcon(ctx, glyph, cx, cy, r) {
    switch (glyph) {
      case "rack": return icGrid(ctx, cx, cy, r);
      case "circle": return icRobot(ctx, cx, cy, r);
      case "vehicle": return icCart(ctx, cx, cy, r);
      case "arrow": return icBelt(ctx, cx, cy, r);
      case "zone": return icDash(ctx, cx, cy, r);
      case "box":
      default: return icStack(ctx, cx, cy, r);
    }
  }
  // Generic 3D form keyed on the type's BASE behaviour class - reuses the
  // built-in form that best represents that class (storage -> open frame,
  // conveyor -> belt bed, station -> bench, transporter -> guided vehicle,
  // dock -> door wall, zone -> low outlined pad).
  function genericForm3D(ctx, P, base, x, y, w, d, h, color, theme, anim) {
    switch (base) {
      case "conveyor": return d3Conveyor(ctx, P, x, y, w, d, h, color, theme, anim);
      case "station": return d3Pack(ctx, P, x, y, w, d, h, color, theme);
      case "transporter": return d3Agv(ctx, P, x, y, w, d, h, color, theme, anim);
      case "dock": return d3Dock(ctx, P, x, y, w, d, h, color, theme);
      case "zone": return d3Staging(ctx, P, x, y, w, d, h, color, theme);
      case "storage":
      default: return d3Selective(ctx, P, x, y, w, d, h, color, theme);
    }
  }

  /* ==================================================================
   * THE REGISTRY. Exactly the domain.ELEMENTS types (no orphans). Each
   * entry has a 2D glyph (d2), a 3D form (d3) and an LOD icon (icon).
   * ================================================================== */
  const REG = {
    "selective-racking": { d2: d2Selective, d3: d3Selective, icon: icGrid, g2: "shelf-bay grid (uprights + beams)", f3: "open see-through rack frame (3 levels)" },
    "block-stack": { d2: d2Block, d3: d3Block, icon: icStack, g2: "stacked-square honeycomb pattern", f3: "grid of stacked unit stacks" },
    "drive-in": { d2: d2DriveIn, d3: d3DriveIn, icon: icChevron, g2: "deep lanes + entry depth arrows", f3: "open-front deep-lane frame + floor rails" },
    "double-deep": { d2: d2DoubleDeep, d3: d3DoubleDeep, icon: icGrid, g2: "paired bays + two-deep divider", f3: "rack frame + mid-depth divider row" },
    "push-back": { d2: d2PushBack, d3: d3PushBack, icon: icChevron, g2: "nested chevrons toward the face", f3: "rack frame + inclined cart rails" },
    "pallet-flow": { d2: d2PalletFlow, d3: d3PalletFlow, icon: icChevron, g2: "roller dots + FIFO flow chevrons", f3: "rack frame + inclined gravity lanes" },
    "carton-flow": { d2: d2CartonFlow, d3: d3CartonFlow, icon: icChevron, g2: "inclined carton pick-face shelves", f3: "low multi-shelf pick-face frame" },
    "mobile-racking": { d2: d2Mobile, d3: d3Mobile, icon: icGrid, g2: "base rail + wheels + bay uprights", f3: "rack frame on a powered mobile base" },
    "cantilever": { d2: d2Cantilever, d3: d3Cantilever, icon: icArm, g2: "column with projecting arm ticks", f3: "back columns + projecting arms" },
    "asrs": { d2: d2Asrs, d3: d3Asrs, icon: icTower, g2: "tall-rack hatch + crane aisle + trolley", f3: "double-sided high bay + crane mast tower" },
    "shuttle": { d2: d2Shuttle, d3: d3Shuttle, icon: icTower, g2: "shuttle channels + carts + lift", f3: "deep-channel frame + lift shaft tower" },
    "mezzanine": { d2: d2Mezzanine, d3: d3Mezzanine, icon: icPlatform, g2: "dashed platform outline + posts + stairs", f3: "raised deck on legs (open underneath)" },
    "dock-in": { d2: d2DockIn, d3: d3Dock, icon: icDoor, g2: "door notch + inbound arrow", f3: "low wall with a recessed door opening" },
    "dock-out": { d2: d2DockOut, d3: d3Dock, icon: icDoor, g2: "door notch + outbound arrow", f3: "low wall with a recessed door opening" },
    "staging": { d2: d2Staging, d3: d3Staging, icon: icDash, g2: "dashed holding-area outline + lane", f3: "low outlined holding pad" },
    "conveyor": { d2: d2Conveyor, d3: d3Conveyor, icon: icBelt, g2: "belt side lines + rollers + direction", f3: "low belt bed with roller ticks" },
    "push-station": { d2: d2Push, d3: d3Push, icon: icBench, g2: "workbench + outward push arrow", f3: "bench on legs + push arrow" },
    "pull-station": { d2: d2Pull, d3: d3Pull, icon: icBench, g2: "workbench + inward pull arrow", f3: "bench on legs + pull arrow" },
    "pack-station": { d2: d2Pack, d3: d3Pack, icon: icBench, g2: "workbench + parcel with tape", f3: "bench on legs + a parcel on top" },
    "rgv": { d2: d2Rgv, d3: d3Rgv, icon: icCart, g2: "twin rails + cart body + heading", f3: "floor rails + a cart body" },
    "agv": { d2: d2Agv, d3: d3Agv, icon: icRobot, g2: "dashed guide path + robot body", f3: "dashed guide path + a robot body" },
    "pick-to-light": { d2: d2PickToLight, d3: d3PickToLight, icon: icLight, g2: "shelf grid + lit pick-to-light module dots", f3: "low shelf frame + lit pick-face displays" },
    "vna": { d2: d2Vna, d3: d3Vna, icon: icGrid, g2: "narrow tall bays + guided-aisle rail", f3: "tall narrow rack frame + floor guide rail" },
    "forklift": { d2: d2Forklift, d3: d3Forklift, icon: icForklift, g2: "truck body + mast + fork tines", f3: "vehicle body + vertical mast + forks" },
    "charging-station": { d2: d2Charging, d3: d3Charging, icon: icBolt, g2: "charge pad + post + lightning bolt", f3: "floor pad + charge post + cable" },
    "sorter": { d2: d2Sorter, d3: d3Sorter, icon: icLoop, g2: "closed loop track + trays + divert chutes", f3: "low sortation deck + loop channel + trays" },
    "stretch-wrap": { d2: d2StretchWrap, d3: d3StretchWrap, icon: icWrap, g2: "turntable ring + pallet + rotating wrap arm", f3: "turntable base + pallet + orbiting wrap mast" },
    "returns-station": { d2: d2Returns, d3: d3Returns, icon: icReturn, g2: "bench + return arrow + QA lens", f3: "bench on legs + inspection screen" },
    "gate": { d2: d2Gate, d3: d3Gate, icon: icGate, g2: "side posts + horizontal door slats + latch", f3: "wall / door frame + roller-door slats" },
  };

  /* ==================================================================
   * PUBLIC API.
   * ================================================================== */
  // On-screen size thresholds (px) below which the LOD icon replaces the
  // full glyph so it stays fast and legible when zoomed out.
  const LOD_MIN_W = 34;
  const LOD_MIN_H = 22;

  function has(type) {
    const r = REG[type];
    return !!(r && typeof r.d2 === "function" && typeof r.d3 === "function");
  }
  function types() { return Object.keys(REG); }

  // Top-down glyph. g = {x, y, w, d, cellPx, color, theme, lod}.
  //   x,y,w,d : footprint in the current draw units (base px)
  //   cellPx  : px per cell in the SAME units (feature density)
  //   lod     : effective ON-SCREEN px per cell (cellPx * zoom) - only
  //             used to pick the detail tier (full glyph vs LOD icon)
  function draw2D(ctx, type, g) {
    const r = REG[type];
    if (!g) return false;
    // Custom (user-defined) types have no REG entry; they carry a `glyph`
    // on g and route through the generic renderer instead.
    const isCustom = (!r || typeof r.d2 !== "function") && typeof g.glyph === "string";
    if ((!r || typeof r.d2 !== "function") && !isCustom) return false;
    const x = g.x, y = g.y, w = g.w, d = g.d;
    if (!(isFinite(x) && isFinite(y) && w > 0 && d > 0)) return false;
    const cell = g.cellPx > 0 ? g.cellPx : 20;
    const color = g.color || "#8b5cf6";
    const theme = g.theme === "dark" ? "dark" : "light";
    const eff = isFinite(g.lod) && g.lod > 0 ? g.lod : cell;
    const scale = eff / cell;
    const level = detailLevel(eff);            // px/cell tier: icon | glyph | rich
    const seed = isFinite(g.seed) ? (g.seed | 0) : 0; // deterministic load-unit fill seed
    const gc = glyphColors(color, theme);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.strokeStyle = gc.stroke;
    ctx.fillStyle = gc.fill;
    ctx.lineWidth = clampN(cell * 0.05, 1, 2.2);
    // A too-small on-screen FOOTPRINT also collapses to the icon (even if the
    // px/cell tier would allow a glyph) - the existing legibility guard.
    const tinyFootprint = (w * scale < LOD_MIN_W || d * scale < LOD_MIN_H);
    if (level === "icon" || tinyFootprint) {
      // LOD path: a single tiny centred icon (the tinted footprint is
      // already drawn by the caller), so it stays cheap + legible. The
      // animation is intentionally SKIPPED here (too small to read) - LOD-safe.
      const rr = clampN(Math.min(w, d) * 0.3, 3, Math.min(w, d) * 0.5);
      if (r) r.icon(ctx, x + w / 2, y + d / 2, rr);
      else genericIcon(ctx, g.glyph, x + w / 2, y + d / 2, rr);
    } else {
      // Optional animation phase (a number in [0,1)); animatable types draw
      // their moving part, all others ignore the extra argument.
      const anim = (isFinite(g.anim) && g.anim >= 0) ? g.anim : undefined;
      if (r) {
        r.d2(ctx, x, y, w, d, cell, gc, color, theme, anim);
        // Rich (zoomed-in) tier: layer the high-detail overlay ON TOP of the
        // base glyph so animated parts keep moving and the fill is additive.
        if (level === "rich") richDraw2D(ctx, type, x, y, w, d, cell, gc, color, theme, seed, anim);
      } else {
        // Custom type: generic glyph parameterised by g.glyph.
        genericGlyph2D(ctx, g.glyph, x, y, w, d, cell, gc, color, theme, anim);
      }
    }
    ctx.restore();
    return true;
  }

  // Isometric form. P(cx,cy,cz)->{x,y} px; o = {cx, cy, w, d, heightM,
  // color, theme, selected?, selColor?}. cx,cy = the footprint's min
  // (back) corner in world cells; heightM = domain.heightM (metres).
  function draw3D(ctx, type, P, o) {
    const r = REG[type];
    if (typeof P !== "function" || !o) return false;
    // Custom (user-defined) types have no REG entry; they carry a `base` on
    // o and route through the generic 3D form.
    const isCustom = (!r || typeof r.d3 !== "function") && typeof o.base === "string";
    if ((!r || typeof r.d3 !== "function") && !isCustom) return false;
    const x = o.cx, y = o.cy, w = o.w, d = o.d;
    if (!(isFinite(x) && isFinite(y) && w > 0 && d > 0)) return false;
    const h = isFinite(o.heightM) && o.heightM > 0 ? o.heightM : 1;
    const color = o.color || "#8b5cf6";
    const theme = o.theme === "dark" ? "dark" : "light";
    const anim = (isFinite(o.anim) && o.anim >= 0) ? o.anim : undefined;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = 1;
    if (r) {
      r.d3(ctx, P, x, y, w, d, h, color, theme, anim);
      // Rich (zoomed-in) tier: layer pallets / decked posts / vehicle loads on
      // top of the base extruded form. Gated on the caller supplying an
      // ON-SCREEN px/cell (o.lod) that reaches the rich tier; when absent (the
      // headless height/anim harnesses pass none) the base form draws alone, so
      // those forms stay byte-identical to before. Deterministic seed from the
      // element (o.seed, else its world corner) - stable, testable, no random.
      if (isFinite(o.lod) && detailLevel(o.lod) === "rich") {
        const seed = isFinite(o.seed) ? (o.seed | 0) : (((x | 0) * 73856093) ^ ((y | 0) * 19349663));
        richDraw3D(ctx, P, type, x, y, w, d, h, color, theme, seed, anim);
      }
    } else {
      // Custom type: generic extruded form parameterised by o.base.
      genericForm3D(ctx, P, o.base, x, y, w, d, h, color, theme, anim);
    }
    if (o.selected) selOutline(ctx, P, x, y, w, d, h, o.selColor || "#38bdf8");
    ctx.restore();
    return true;
  }

  // Per-type schematic descriptions (also proves 2D+3D coverage for the
  // catalogue / tests). Keyed identically to REG (no orphans).
  const meta = {};
  const ICONS = {};
  for (const k of Object.keys(REG)) {
    meta[k] = { type: k, glyph2d: REG[k].g2, form3d: REG[k].f3 };
    ICONS[k] = REG[k].icon;
  }

  WT.shapes = {
    has,
    types,
    draw2D,
    draw3D,
    ICONS,
    meta,
    // Deterministic equipment-animation phase (pure; seeded from the sim
    // tick, so it pauses when the sim pauses). Bounded in [0,1), periodic
    // with period ANIM_PERIOD. Exposed so the renderer + tests share ONE
    // source of truth for the moving-equipment timing.
    equipmentPhase,
    ANIM_PERIOD,
    // Progressive LOD detail tier (v1.11): the PURE on-screen-px/cell -> tier
    // map both renderers pick their fidelity from. "rich" is the zoomed-in,
    // high-detail overlay tier; "glyph"/"icon" are the existing tiers.
    detailLevel,
    DETAIL_GLYPH_MIN,
    DETAIL_RICH_MIN,
    // Exposed for reuse/tests; illustrative schematic drawing only.
    colors: { rgba, shade, lighten },
  };
})();
