/* =====================================================================
 * Logistics Flow Studio - pack.js
 * THE PACKAGING HIERARCHY (v3.31): eaches -> cases -> layers -> pallets ->
 * trailers, with real unit-load dimensions, per-industry packaging profiles,
 * a ti-hi pallet-pattern optimiser, trailer fill, and the QUANTITY a handling
 * unit carries at every operation of its order archetype - conserved.
 * ---------------------------------------------------------------------
 * WHAT IS REAL HERE (public standards, cited where they apply):
 *   - EUR pallet (EPAL 1): 1200 x 800 x 144 mm, ~25 kg, safe working load
 *     1,500 kg (DIN EN 13698-1 / EPAL). Industrial pallet (EPAL 2): 1200 x
 *     1000 mm (DIN EN 13698-2). Half pallet (EPAL 6): 800 x 600 mm.
 *   - VDA 4500 small-load carriers (KLT): 600 x 400 and 400 x 300 footprints
 *     on the ISO 3394 600 x 400 module.
 *   - A 13.6 m curtain-side trailer takes 33 EUR pallets or 26 industrial
 *     pallets single-stacked (the widely used planning figures).
 *   - ti x hi: cases per layer x layers per pallet - the way every DC
 *     describes a pallet pattern.
 * WHAT IS SYNTHETIC: the case sizes, eaches per case, case weights, stack
 * heights and order-line quantities in the industry profiles are TEACHING
 * VALUES, labelled as such. They are plausible, not measured, and they are
 * not anybody's packaging specification.
 * WHAT IS NOT MODELLED: interlocking for stability, overhang, layer
 * alternation, mixed-SKU pallets, weight distribution, double-stacking in
 * the trailer, axle loads. The optimiser is "informed by practice, not a
 * load plan". v3.34 adds BAND layouts (see bandDP) - the one-dimensional
 * knapsack over strips that finds the standard 5-KLT and 10-carton layers on
 * the industrial pallet. v3.38 adds the FOUR-BLOCK (pinwheel) layout (see
 * fourBlock) and STACKING STRENGTH (see bct / safeLayers): the simplified
 * McKee formula on SYNTHETIC board values with published derating factors -
 * a verdict informed by packaging practice, not a certification.
 *
 * CONSERVATION. `quantitiesAlong` returns, for every operation of an
 * archetype, the eaches / cases / pallets / parcels the handling unit carries
 * AND what left it (retained in stock, scrapped). At every step
 *   eaches_received == eaches_carried + eaches_retained + eaches_scrapped
 * and the harness asserts it. The animation still draws ONE unit per
 * handling unit (goods.js); this module says how much that unit is.
 *
 * DETERMINISM: no Date, no Math.random; quantities come from a pure hash of
 * the identity, so the same run reproduces the same numbers.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const HONESTY =
    "Unit-load dimensions follow DIN EN 13698 (EUR / industrial pallet), VDA 4500 (KLT) and " +
    "the 33 EUR / 26 industrial pallets per 13.6 m trailer planning figures. Case sizes, " +
    "eaches per case, weights, stack heights and order-line quantities are SYNTHETIC " +
    "teaching values. The pattern optimiser is informed by practice, not a load plan: no " +
    "interlocking-for-stability, overhang or weight-distribution model. Stacking strength (v3.38) is the " +
    "simplified McKee formula on SYNTHETIC board values (ECT, caliper) with published derating factors - " +
    "a verdict informed by packaging practice, not a certification; a real load plan needs the board " +
    "supplier's data, the actual humidity and the time under load.";

  /* ---------------- unit loads ----------------------------------------- */
  const PALLETS = {
    eur: { id: "eur", label: "EUR pallet (EPAL 1)", l: 1200, w: 800, h: 144, tareKg: 25, maxLoadKg: 1500,
      standard: "DIN EN 13698-1 / EPAL", trailerSlots: 33 },
    ind: { id: "ind", label: "Industrial pallet (EPAL 2)", l: 1200, w: 1000, h: 144, tareKg: 33, maxLoadKg: 1500,
      standard: "DIN EN 13698-2 / EPAL", trailerSlots: 26 },
    half: { id: "half", label: "Half pallet (EPAL 6)", l: 800, w: 600, h: 144, tareKg: 9.5, maxLoadKg: 500,
      standard: "EPAL 6", trailerSlots: 66 },
    drum: { id: "drum", label: "Chemical drum pallet 1200 x 1200", l: 1200, w: 1200, h: 150, tareKg: 30, maxLoadKg: 1200,
      standard: "CP-family plastic / wood drum pallet (synthetic dimensions)", trailerSlots: 22 },
    cage: { id: "cage", label: "Tyre cage (fixed capacity)", l: 1200, w: 1000, h: 1800, tareKg: 60, maxLoadKg: 800,
      standard: "returnable cage, capacity declared not computed", trailerSlots: 26, fixed: true },
  };
  const TRAILERS = {
    "curtainsider-13.6": { id: "curtainsider-13.6", label: "13.6 m curtain-side trailer", innerLmm: 13600, innerWmm: 2480,
      innerHmm: 2700, maxPayloadKg: 24000, note: "33 EUR or 26 industrial pallets single-stacked; double-stacking not modelled" },
  };
  // Case (box) archetypes. KLT sizes are VDA 4500 footprints; the rest are
  // synthetic but ISO 3394 module-friendly.
  const BOXES = {
    "case-400x300x250": { id: "case-400x300x250", label: "Shipping carton 400 x 300 x 250", l: 400, w: 300, h: 250 },
    "tray-400x300x200": { id: "tray-400x300x200", label: "Retail tray 400 x 300 x 200", l: 400, w: 300, h: 200 },
    "tray-400x300x135": { id: "tray-400x300x135", label: "Beverage tray 400 x 300 x 135", l: 400, w: 300, h: 135 },
    "klt-600x400x280": { id: "klt-600x400x280", label: "KLT 600 x 400 x 280 (VDA 4500)", l: 600, w: 400, h: 280 },
    "case-300x200x150": { id: "case-300x200x150", label: "Pharma carton 300 x 200 x 150", l: 300, w: 200, h: 150 },
    "case-400x300x300": { id: "case-400x300x300", label: "Parts carton 400 x 300 x 300", l: 400, w: 300, h: 300 },
    "crate-600x400x200": { id: "crate-600x400x200", label: "Food crate 600 x 400 x 200", l: 600, w: 400, h: 200 },
    "bulk-600x400x400": { id: "bulk-600x400x400", label: "Bulky carton 600 x 400 x 400", l: 600, w: 400, h: 400 },
    "drum-585x585x880": { id: "drum-585x585x880", label: "200 L drum, 585 mm dia x 880 mm", l: 585, w: 585, h: 880 },
    "tyre-630x630x230": { id: "tyre-630x630x230", label: "Passenger tyre ~630 dia x 230", l: 630, w: 630, h: 230 },
  };

  /* ---------------- industry packaging profiles ------------------------ */
  // Every value below is a SYNTHETIC teaching value (see HONESTY). `line` gives
  // the order-line quantity ranges the archetypes draw from.
  const PROFILES = {
    ecommerce: { id: "ecommerce", label: "E-commerce / general merchandise", box: "case-400x300x250", eachesPerCase: 12, caseKg: 6,
      pallet: "eur", maxStackMm: 1800, eachesPerParcel: 6, line: { cases: [2, 8], eaches: [1, 12], exportCases: [4, 8] },
      board: { ectKNm: 5, caliperMm: 4, note: "single-wall C flute (synthetic)" } },
    "grocery-ambient": { id: "grocery-ambient", label: "Grocery / FMCG ambient", box: "tray-400x300x200", eachesPerCase: 24, caseKg: 8,
      pallet: "eur", maxStackMm: 1650, eachesPerParcel: 12, line: { cases: [4, 16], eaches: [2, 24], exportCases: [8, 16] },
      board: { ectKNm: 4, caliperMm: 3, note: "single-wall B flute tray (synthetic; McKee is written for closed boxes - approximate for a tray)" } },
    beverage: { id: "beverage", label: "Beverage", box: "tray-400x300x135", eachesPerCase: 24, caseKg: 9.5,
      pallet: "eur", maxStackMm: 1650, eachesPerParcel: 6, line: { cases: [8, 40], eaches: [6, 24], exportCases: [16, 40] },
      board: { evaluated: false, note: "open beverage tray: the bottles carry the stack, the board is not evaluated" } },
    automotive: { id: "automotive", label: "Automotive (KLT)", box: "klt-600x400x280", eachesPerCase: 20, caseKg: 15,
      pallet: "ind", maxStackMm: 1600, eachesPerParcel: 4, line: { cases: [2, 8], eaches: [1, 20], exportCases: [4, 8] },
      board: { evaluated: false, note: "rigid plastic KLT: not corrugated, not evaluated" } },
    pharma: { id: "pharma", label: "Pharma (GDP)", box: "case-300x200x150", eachesPerCase: 48, caseKg: 4,
      pallet: "eur", maxStackMm: 1500, eachesPerParcel: 24, line: { cases: [2, 12], eaches: [1, 48], exportCases: [6, 16] },
      board: { ectKNm: 5, caliperMm: 3, note: "single-wall B flute (synthetic)" } },
    "spare-parts": { id: "spare-parts", label: "Spare parts / electronics / tools", box: "case-400x300x300", eachesPerCase: 6, caseKg: 10,
      pallet: "eur", maxStackMm: 1800, eachesPerParcel: 3, line: { cases: [1, 6], eaches: [1, 6], exportCases: [4, 8] },
      board: { ectKNm: 6, caliperMm: 4, note: "single-wall C flute, heavier grade (synthetic)" } },
    "cold-chain": { id: "cold-chain", label: "Cold chain / food production", box: "crate-600x400x200", eachesPerCase: 10, caseKg: 12,
      pallet: "eur", maxStackMm: 1700, eachesPerParcel: 5, line: { cases: [2, 4], eaches: [1, 10], exportCases: [4, 4] },
      board: { evaluated: false, note: "plastic crate: not corrugated, not evaluated" } },
    bulky: { id: "bulky", label: "Bulky goods / building materials / furniture", box: "bulk-600x400x400", eachesPerCase: 1, caseKg: 30,
      pallet: "ind", maxStackMm: 1400, eachesPerParcel: 1, line: { cases: [1, 4], eaches: [1, 2], exportCases: [2, 4] },
      board: { ectKNm: 9, caliperMm: 7, note: "double-wall BC flute (synthetic)" } },
    chemical: { id: "chemical", label: "Chemicals / hazmat (drums)", box: "drum-585x585x880", eachesPerCase: 1, caseKg: 220,
      pallet: "drum", maxStackMm: 1100, eachesPerParcel: 1, line: { cases: [1, 4], eaches: [1, 1], exportCases: [2, 4] },
      board: { evaluated: false, note: "steel / plastic drums: not corrugated, not evaluated" } },
    tyres: { id: "tyres", label: "Tyres (cages)", box: "tyre-630x630x230", eachesPerCase: 1, caseKg: 9,
      pallet: "cage", fixedPerPallet: 24, maxStackMm: 1800, eachesPerParcel: 1, line: { cases: [2, 8], eaches: [1, 4], exportCases: [4, 8] },
      board: { evaluated: false, note: "tyres in a cage: no case, not evaluated" } },
  };
  // Which profile each library scenario uses (by scenario id); a layout that is
  // not a library scenario gets the general profile.
  const SCENARIO_PROFILE = {
    "automotive-jit-sequencing": "automotive", "ecommerce-multichannel-fc": "ecommerce", "coldchain-frozen-dc": "cold-chain",
    "spare-parts-highsku": "spare-parts", "pharma-gdp-warehouse": "pharma", "3pl-crossdock-hub": "grocery-ambient",
    "beverage-drivein-warehouse": "beverage", "asrs-highbay-dc": "grocery-ambient", "furniture-bulky-goods": "bulky",
    "hazmat-storage-facility": "chemical", "apparel-textile-dc": "ecommerce", "building-materials-branch": "bulky",
    "grocery-ambient-chilled-dc": "grocery-ambient", "electronics-components-dc": "spare-parts",
    "returns-reverse-logistics": "ecommerce", "urban-micro-fulfilment": "ecommerce", "aerospace-mro-parts": "spare-parts",
    "food-production-raw-finished": "cold-chain", "media-book-distribution": "ecommerce", "tools-hardware-branch": "spare-parts",
    "chemical-drum-store": "chemical", "tyre-storage-dc": "tyres", "mega-automated-fulfilment-plant": "ecommerce",
    "assembly-line-factory": "automotive",
  };
  const DEFAULT_PROFILE = "grocery-ambient";
  function profileFor(scenarioId) {
    return PROFILES[SCENARIO_PROFILE[scenarioId] || DEFAULT_PROFILE];
  }

  /* ---------------- ti-hi and the pattern optimiser ------------------- */
  // cases per layer for one orientation; no overhang allowed.
  function tiFor(pallet, box, rotated) {
    const cl = rotated ? box.w : box.l, cw = rotated ? box.l : box.w;
    return Math.floor(pallet.l / cl) * Math.floor(pallet.w / cw);
  }
  /* ---- BAND (strip) layouts ------------------------------------------
   * Split the pallet into parallel bands; each band holds ONE orientation of
   * the case, packed along the band. Which bands to use is a one-dimensional
   * knapsack over the pallet's width:  f(w) = max_o f(w - h_o) + floor(L / l_o)
   * (Smith & De Cani, 1980, "An algorithm to optimize the layout of boxes in
   * pallets"). Exact for band layouts, and it finds the classic patterns a
   * single orientation cannot: 10 x (400 x 300) on 1200 x 1000 (bands 400 /
   * 300 / 300) and 5 x KLT 600 x 400 on 1200 x 1000 (bands 600 + 400) - the
   * layer every automotive plant actually stacks. Both band directions are
   * tried. NOT modelled: pinwheel / interlocking patterns, overhang, layer
   * alternation for stability. Pure; deterministic tie-breaks.
   * ------------------------------------------------------------------ */
  function bandDP(L, W, bl, bw) {
    const os = [[bl, bw], [bw, bl]]; // [size along L, size along W]
    const best = new Array(W + 1).fill(0), choice = new Array(W + 1).fill(-1);
    for (let w = 1; w <= W; w++) {
      best[w] = best[w - 1]; choice[w] = -1;
      for (let i = 0; i < os.length; i++) {
        const h = os[i][1], n = Math.floor(L / os[i][0]);
        if (h <= w && n > 0 && best[w - h] + n > best[w]) { best[w] = best[w - h] + n; choice[w] = i; }
      }
    }
    const bands = [];
    let w = W;
    while (w > 0) {
      if (choice[w] < 0) { w--; continue; }
      const o = os[choice[w]];
      bands.unshift({ alongL: o[0], alongW: o[1], n: Math.floor(L / o[0]), start: w - o[1], height: o[1] });
      w -= o[1];
    }
    return { count: best[W], bands: bands };
  }
  // grid or bands inside a rectangle L x W (no pinwheel) - the hole filler
  function gridOrBands(L, W, bl, bw) {
    const p = { l: L, w: W }, bx = { l: bl, w: bw };
    if (L < Math.min(bl, bw) || W < Math.min(bl, bw)) return { count: 0, pattern: "grid", rotated: false, axis: null, bands: null };
    const t0 = tiFor(p, bx, false), t1 = tiFor(p, bx, true), grid = Math.max(t0, t1);
    const a = bandDP(L, W, bl, bw), b = bandDP(W, L, bl, bw);
    const band = a.count >= b.count ? { axis: "W", count: a.count, bands: a.bands } : { axis: "L", count: b.count, bands: b.bands };
    if (band.count > grid) return { count: band.count, pattern: "bands", rotated: false, axis: band.axis, bands: band.bands };
    return { count: grid, pattern: "grid", rotated: t1 > t0, axis: null, bands: null };
  }
  /* ---- FOUR-BLOCK (pinwheel) layouts - v3.38 ----------------------------
   * Steudel (1979), "Generating pallet loading patterns: a special case of the
   * two-dimensional cutting stock problem", Management Science 25(10): four
   * blocks of cases along the pallet's edges, every case with its long side
   * along its edge, arranged pinwheel-fashion - each block runs into one corner
   * and stops short of the next - and the central hole filled with the best
   * grid / band layer. The block thicknesses (in case short sides) are
   * enumerated, a few hundred combinations, deterministic tie-break (fewest
   * blocks, then the first found). bestLayer uses it only when it packs
   * strictly more than both the grid and the bands: on the ten teaching
   * profiles x the standard pallets it never does (verify_stacking.js prints
   * where it would); 1000 x 1000 with a 600 x 400 case is the hand case where
   * it does (4 against 3). NOT a stability model: a pinwheel is drawn, not
   * judged. Blocks never overlap by construction: the bottom block ends where
   * the right one starts, the right ends where the top starts, and so on,
   * with bottom + top <= W and left + right <= L.
   * ------------------------------------------------------------------ */
  function fourBlock(L, W, bl, bw) {
    const a = Math.max(bl, bw), b = Math.min(bl, bw);
    const none = { count: 0, k: null, rects: [], hole: null, pattern: "pinwheel" };
    if (!(a > 0) || L < a || W < a) return none;
    const kmax = Math.floor(Math.min(L, W) / b);
    let best = null;
    for (let kb = 0; kb <= kmax; kb++) for (let kr = 0; kr <= kmax; kr++) for (let kt = 0; kt <= kmax; kt++) for (let kl = 0; kl <= kmax; kl++) {
      const tb = kb * b, tr = kr * b, tt = kt * b, tl = kl * b;
      if (tb + tt > W || tl + tr > L) continue;
      const nB = kb ? Math.floor((L - tr) / a) : 0, nR = kr ? Math.floor((W - tt) / a) : 0, nT = kt ? Math.floor((L - tl) / a) : 0, nL = kl ? Math.floor((W - tb) / a) : 0;
      const hl = L - tl - tr, hw = W - tb - tt;
      const hole = gridOrBands(hl, hw, bl, bw);
      const count = kb * nB + kr * nR + kt * nT + kl * nL + hole.count;
      const used = (kb && nB ? 1 : 0) + (kr && nR ? 1 : 0) + (kt && nT ? 1 : 0) + (kl && nL ? 1 : 0);
      if (!best || count > best.count || (count === best.count && used < best.used)) {
        best = { count, used, k: [kb, kr, kt, kl], tb, tr, tt, tl, nB, nR, nT, nL, hl, hw, hole };
      }
    }
    if (!best || best.used === 0) return none;
    const rects = [];
    for (let i = 0; i < best.k[0]; i++) for (let j = 0; j < best.nB; j++) rects.push({ x: j * a, y: i * b, w: a, h: b });
    for (let i = 0; i < best.k[1]; i++) for (let j = 0; j < best.nR; j++) rects.push({ x: L - best.tr + i * b, y: j * a, w: b, h: a });
    for (let i = 0; i < best.k[2]; i++) for (let j = 0; j < best.nT; j++) rects.push({ x: best.tl + j * a, y: W - best.tt + i * b, w: a, h: b });
    for (let i = 0; i < best.k[3]; i++) for (let j = 0; j < best.nL; j++) rects.push({ x: i * b, y: best.tb + j * a, w: b, h: a });
    const holeRects = best.hole.count ? layerRects({ l: best.hl, w: best.hw }, { l: bl, w: bw }, best.hole).map((r) => ({ x: r.x + best.tl, y: r.y + best.tb, w: r.w, h: r.h })) : [];
    return { count: best.count, k: best.k, rects: rects.concat(holeRects), blocks: rects.length,
      hole: { x: best.tl, y: best.tb, w: best.hl, h: best.hw, count: best.hole.count, pattern: best.hole.pattern }, pattern: "pinwheel" };
  }
  // The best LAYER for a case on a pallet: the single-orientation grid unless a
  // band layout packs strictly more, unless a four-block pinwheel packs strictly
  // more than both. `axis` says which pallet side the bands stack along ("W":
  // bands stacked across the width, "L": across the length).
  function bestLayer(pallet, box) {
    const t0 = tiFor(pallet, box, false), t1 = tiFor(pallet, box, true);
    const grid = Math.max(t0, t1);
    const a = bandDP(pallet.l, pallet.w, box.l, box.w);
    const b = bandDP(pallet.w, pallet.l, box.l, box.w);
    const band = a.count >= b.count ? { axis: "W", count: a.count, bands: a.bands } : { axis: "L", count: b.count, bands: b.bands };
    const pin = fourBlock(pallet.l, pallet.w, box.l, box.w);
    if (pin.count > Math.max(grid, band.count)) return { count: pin.count, pattern: "pinwheel", rotated: false, axis: null, bands: null, rects: pin.rects, hole: pin.hole, k: pin.k };
    if (band.count > grid) return { count: band.count, pattern: "bands", rotated: false, axis: band.axis, bands: band.bands };
    return { count: grid, pattern: "grid", rotated: t1 > t0, axis: null, bands: null };
  }
  // The rectangles of one layer in pallet millimetres (x along the pallet
  // length, y along its width) - for drawing and for the harness, which
  // asserts they never overlap and never leave the deck.
  function layerRects(pallet, box, layer) {
    const lay = layer || bestLayer(pallet, box);
    const out = [];
    if (lay.pattern === "pinwheel") return (lay.rects || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    if (lay.pattern === "grid") {
      const cl = lay.rotated ? box.w : box.l, cw = lay.rotated ? box.l : box.w;
      const cols = Math.floor(pallet.l / cl), rows = Math.floor(pallet.w / cw);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) out.push({ x: i * cl, y: j * cw, w: cl, h: cw });
      return out;
    }
    for (const b of lay.bands) {
      for (let k = 0; k < b.n; k++) {
        if (lay.axis === "W") out.push({ x: k * b.alongL, y: b.start, w: b.alongL, h: b.height });
        else out.push({ x: b.start, y: k * b.alongL, w: b.height, h: b.alongL });
      }
    }
    return out;
  }

  /* ---- STACKING STRENGTH - v3.38 ----------------------------------------
   * Simplified McKee formula (McKee, Gander & Wachuta, 1963): a box's
   * compression strength BCT = 5.874 x ECT x sqrt(caliper x perimeter) -
   * dimensionally consistent with ECT in kN/m (= N/mm) and lengths in mm,
   * giving newtons; published as valid for regular slotted containers whose
   * height is at least perimeter / 7 and whose footprint ratio is at most
   * 3 : 1. What a bottom case may bear in a warehouse is a fraction of BCT:
   * the published derating guidance (Fibre Box Handbook and the practice
   * built on it; McKee & Whitsitt 1972 for humidity x time) - about 40 % lost
   * after 90 days under load, about 40 % at 85 % RH and 50 % at 90 % RH,
   * about 32 % for 25 mm of overhang, interlocked stacking about half of
   * column stacking, a column as found in practice about 85 % - is offered as
   * multiplicative options with those values. The board values in the
   * profiles are SYNTHETIC teaching values; the verdict is informed by
   * packaging practice, not a certification.
   * ------------------------------------------------------------------ */
  const G_N_PER_KG = 9.80665;
  const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 10000) / 10000;
  function bct(ectKNm, caliperMm, perimeterMm) {
    if (!(ectKNm > 0) || !(caliperMm > 0) || !(perimeterMm > 0)) return 0;
    return 5.874 * ectKNm * Math.sqrt(caliperMm * perimeterMm);
  }
  const STACK_FACTORS = {
    humidity: { label: "relative humidity", default: "rh50", options: {
      rh50: { label: "50 % RH (test conditions)", value: 1.0 }, rh85: { label: "85 % RH (about 40 % lost)", value: 0.6 }, rh90: { label: "90 % RH (about 50 % lost)", value: 0.5 } } },
    duration: { label: "time under load", default: "d90", options: {
      test: { label: "minutes (a compression test)", value: 1.0 }, d90: { label: "90 days under load (about 40 % lost)", value: 0.6 }, year: { label: "a year or more (about 50 % lost)", value: 0.5 } } },
    overhang: { label: "pallet overhang", default: "none", options: {
      none: { label: "no overhang", value: 1.0 }, mm25: { label: "25 mm overhang (about 32 % lost)", value: 0.68 } } },
    pattern: { label: "stacking pattern", default: "column", options: {
      column: { label: "column stack, aligned", value: 1.0 }, misaligned: { label: "column stack as found in practice (about 15 % lost)", value: 0.85 }, interlocked: { label: "interlocked (about 50 % lost)", value: 0.5 } } },
  };
  // The product of the chosen factors; `sel` maps a factor to an option key or to a number.
  function stackFactor(sel) {
    let factor = 1;
    const parts = {};
    for (const k of Object.keys(STACK_FACTORS)) {
      const def = STACK_FACTORS[k];
      const v = sel && sel[k] != null ? sel[k] : def.default;
      const val = typeof v === "number" && v >= 0 ? v : (def.options[v] ? def.options[v].value : def.options[def.default].value);
      parts[k] = val; factor *= val;
    }
    return { factor: factor, parts: parts };
  }
  // The load on the bottom case of a column: the cases above it in its own
  // stack plus, per pallet stacked on top, that pallet's full column and its
  // share of the pallet's tare.
  function stackLoadKg(hi, caseKg, casesPerLayer, palletsOnTop, palletTareKg) {
    const above = Math.max(0, hi - 1) * caseKg;
    const top = palletsOnTop > 0 && casesPerLayer > 0 ? palletsOnTop * (hi * caseKg + (palletTareKg || 0) / casesPerLayer) : 0;
    return above + top;
  }
  // The layers a column may have so its bottom case stays within the allowable
  // load: (hi - 1) x kg + pallets-on-top x (hi x kg + tare share) <= BCT x factors / g.
  function safeLayers(bctN, caseKg, factors, stack) {
    const f = stackFactor(factors);
    const allowableN = bctN * f.factor, allowableKg = allowableN / G_N_PER_KG;
    const s = stack || {};
    const ds = s.palletsOnTop > 0 ? s.palletsOnTop : 0;
    const tareShare = ds && s.casesPerLayer > 0 ? (s.palletTareKg || 0) / s.casesPerLayer : 0;
    const layers = caseKg > 0 ? Math.max(0, Math.floor((allowableKg + caseKg - ds * tareShare) / (caseKg * (1 + ds)))) : Infinity;
    return { bctN: bctN, allowableN: allowableN, allowableKg: allowableKg, factor: f.factor, parts: f.parts, layers: layers };
  }

  // The pallet pattern: ti (cases per layer - the best grid, band or pinwheel
  // layer), hi (layers under the stack-height limit), reduced until the load
  // respects the pallet's safe working load and, when board values are given,
  // until the bottom case stays within its allowable load (v3.38). Pure.
  //   board   { ectKNm, caliperMm } or null / { evaluated: false }  (no strength verdict)
  //   factors { humidity, duration, overhang, pattern } option keys or numbers (defaults otherwise)
  //   stack   { palletsOnTop }  pallets stacked on top of this one (0)
  function tiHi(pallet, box, maxStackMm, caseKg, board, factors, stack) {
    if (pallet.fixed) {
      return { ti: null, hi: null, rotated: false, cases: 0, grossKg: pallet.tareKg, cubeUtil: 0, stackMm: 0, weightLimited: false, strengthLimited: false, strength: null, fixed: true, pattern: "fixed", layer: null };
    }
    const layer = bestLayer(pallet, box);
    const rotated = layer.rotated;
    const ti = layer.count;
    const usable = Math.max(0, (maxStackMm || 0) - pallet.h);
    let hi = ti > 0 ? Math.floor(usable / box.h) : 0;
    let weightLimited = false;
    const kg = isFinite(caseKg) && caseKg > 0 ? caseKg : 0;
    if (kg > 0 && ti > 0) {
      const maxLayers = Math.floor(pallet.maxLoadKg / (ti * kg));
      if (maxLayers < hi) { hi = Math.max(0, maxLayers); weightLimited = true; }
    }
    let strengthLimited = false, strength = null;
    if (board && board.ectKNm > 0 && board.caliperMm > 0 && kg > 0 && ti > 0) {
      const perimeter = 2 * (box.l + box.w);
      const b = bct(board.ectKNm, board.caliperMm, perimeter);
      const onTop = stack && stack.palletsOnTop > 0 ? stack.palletsOnTop : 0;
      const s = safeLayers(b, kg, factors, { palletsOnTop: onTop, casesPerLayer: ti, palletTareKg: pallet.tareKg });
      if (s.layers < hi) { hi = Math.max(0, s.layers); strengthLimited = true; }
      const loadKg = stackLoadKg(hi, kg, ti, onTop, pallet.tareKg);
      strength = { bctN: r2(b), bctKgf: r2(b / G_N_PER_KG), allowableN: r2(s.allowableN), allowableKg: r2(s.allowableKg), factor: r4(s.factor), parts: s.parts,
        safeLayers: s.layers, loadKg: r2(loadKg), utilisation: s.allowableKg > 0 ? r4(loadKg / s.allowableKg) : null, perimeterMm: perimeter, palletsOnTop: onTop,
        // the simplified formula's published range: RSC boxes, height >= perimeter / 7, footprint ratio <= 3 : 1
        inRange: box.h >= perimeter / 7 && Math.max(box.l, box.w) / Math.min(box.l, box.w) <= 3 };
    }
    const cases = ti * hi;
    const caseVol = box.l * box.w * box.h;
    const envelope = pallet.l * pallet.w * usable;
    return {
      ti: ti, hi: hi, rotated: rotated, cases: cases,
      grossKg: Math.round((pallet.tareKg + cases * kg) * 10) / 10,
      cubeUtil: envelope > 0 ? Math.round((cases * caseVol / envelope) * 10000) / 10000 : 0,
      stackMm: pallet.h + hi * box.h,
      weightLimited: weightLimited, strengthLimited: strengthLimited, strength: strength, fixed: false,
      pattern: layer.pattern, layer: layer,
    };
  }
  // Rank every candidate pallet for a PROFILE and say what the best one gains
  // over the profile's own pallet. Pure.
  function optimizeProfile(profile, candidates, factors, stack) {
    const box = BOXES[profile.box];
    if (!box || PALLETS[profile.pallet].fixed || profile.fixedPerPallet) {
      return { profile: profile.id, box: profile.box, current: null, best: null, ranked: [], gain: null, fixed: true };
    }
    const ranked = bestPattern(box, profile.maxStackMm, profile.caseKg, candidates, profile.board || null, factors, stack);
    const current = ranked.find((r) => r.pallet === profile.pallet) || null;
    const best = ranked[0] || null;
    const gain = current && best ? { cases: best.cases - current.cases, pct: current.cases ? Math.round((best.cases / current.cases - 1) * 1000) / 10 : null, samePallet: best.pallet === current.pallet } : null;
    return { profile: profile.id, box: profile.box, current: current, best: best, ranked: ranked, gain: gain, fixed: false };
  }
  function casesPerPallet(profile) {
    const pallet = PALLETS[profile.pallet];
    if (pallet.fixed || profile.fixedPerPallet) return profile.fixedPerPallet || 0;
    return tiHi(pallet, BOXES[profile.box], profile.maxStackMm, profile.caseKg).cases;
  }
  // Rank every candidate pallet type for a case: most cases per pallet first,
  // then cube utilisation. Cages are excluded (declared capacity, not a pattern).
  function bestPattern(box, maxStackMm, caseKg, candidates, board, factors, stack) {
    const ids = candidates && candidates.length ? candidates : ["eur", "ind", "half"];
    const out = ids.filter((id) => PALLETS[id] && !PALLETS[id].fixed).map((id) => {
      const p = PALLETS[id];
      const r = tiHi(p, box, maxStackMm, caseKg, board, factors, stack);
      return Object.assign({ pallet: id, label: p.label }, r);
    });
    out.sort((a, b) => b.cases - a.cases || b.cubeUtil - a.cubeUtil || a.pallet.localeCompare(b.pallet));
    return out;
  }
  // How many trailers a pallet count needs, and how full they are.
  function trailerFill(pallets, palletId, trailerId) {
    const p = PALLETS[palletId] || PALLETS.eur;
    const t = TRAILERS[trailerId || "curtainsider-13.6"];
    const slots = p.trailerSlots;
    const n = Math.max(0, Math.round(pallets || 0));
    const trailers = n > 0 ? Math.ceil(n / slots) : 0;
    return { pallets: n, slots: slots, trailers: trailers, fill: trailers ? Math.round((n / (trailers * slots)) * 10000) / 10000 : 0, trailer: t.id };
  }

  /* ---------------- quantities along an archetype -------------------- */
  // A pure hash in [0,1) from strings - the same as the goods layer uses, so a
  // handling unit's quantities are a function of its identity alone.
  function hash01(a, b) {
    let h = 2166136261;
    const s = String(a) + "|" + String(b);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 8) / 16777216;
  }
  function draw(range, key, salt) {
    const lo = range[0], hi = range[1];
    return lo + Math.floor(hash01(key, salt) * (hi - lo + 1));
  }
  // Which operations change the QUANTITY a unit carries (as opposed to its form).
  //   receive        the inbound load: what the trailer delivered
  //   depalletise    pallets -> cases (eaches unchanged)
  //   case-pick      the order's cases leave the inbound stock; the rest is RETAINED
  //   piece-pick     the order's eaches leave the case stock; the rest is RETAINED
  //   pallet-pick    a whole pallet comes off the rack (no split)
  //   pick           an in-stock pick: the order's eaches / cases
  //   pack           eaches -> parcels (ceil by eachesPerParcel)
  //   palletise      cases -> one dispatch pallet (partial pallets are honest)
  //   scrap          everything is written off
  //   restock        a return goes back to stock (carried -> retained)
  function quantitiesAlong(profile, archetype, ops, key) {
    const pr = profile || PROFILES[DEFAULT_PROFILE];
    const epc = pr.eachesPerCase;
    const cpp = casesPerPallet(pr);
    const k = key || archetype;
    const startsInStock = archetype === "vas" || archetype === "export-fragile";
    // The inbound (or in-stock) supply the unit starts as.
    let q;
    if (archetype === "returns") {
      const e = draw(pr.line.eaches, k, "returns");
      q = { pallets: 0, cases: 0, eaches: e, parcels: 1, form: "parcel" };
    } else if (startsInStock) {
      const c = archetype === "export-fragile" ? draw(pr.line.exportCases, k, "export") : 0;
      const e = archetype === "vas" ? draw(pr.line.eaches, k, "vas") : c * epc;
      q = { pallets: 0, cases: archetype === "export-fragile" ? c : Math.ceil(e / epc), eaches: e, parcels: 0, form: "carton" };
    } else {
      q = { pallets: 1, cases: cpp, eaches: cpp * epc, parcels: 0, form: "pallet-load" };
    }
    const received = q.eaches;
    let retained = 0, scrapped = 0;
    const steps = [];
    for (const op of ops || []) {
      if (op === "depalletise") { q = Object.assign({}, q, { pallets: 0 }); }
      else if (op === "case-pick") {
        const want = Math.min(q.cases, Math.max(1, draw(pr.line.cases, k, "case-pick")));
        retained += (q.cases - want) * epc;
        q = { pallets: 0, cases: want, eaches: want * epc, parcels: 0, form: "carton" };
      } else if (op === "piece-pick") {
        const want = Math.min(q.eaches, Math.max(1, draw(pr.line.eaches, k, "piece-pick")));
        retained += q.eaches - want;
        q = { pallets: 0, cases: Math.ceil(want / epc), eaches: want, parcels: 0, form: "tote" };
      } else if (op === "pick") { q = Object.assign({}, q, { form: "tote" }); }
      else if (op === "pallet-pick") { q = Object.assign({}, q, { form: "pallet-load" }); }
      else if (op === "pack") { q = Object.assign({}, q, { parcels: Math.max(1, Math.ceil(q.eaches / pr.eachesPerParcel)), form: "parcel" }); }
      else if (op === "palletise") { q = Object.assign({}, q, { pallets: 1, form: "pallet-load" }); }
      else if (op === "wrap") { q = Object.assign({}, q, { form: "wrapped-pallet" }); }
      else if (op === "scrap") { scrapped += q.eaches; q = { pallets: 0, cases: 0, eaches: 0, parcels: 0, form: "parcel" }; }
      else if (op === "restock") { retained += q.eaches; q = { pallets: 0, cases: Math.ceil(q.eaches / epc), eaches: 0, parcels: 0, form: "carton" }; }
      steps.push({ op: op, pallets: q.pallets, cases: q.cases, eaches: q.eaches, parcels: q.parcels, form: q.form, retained: retained, scrapped: scrapped });
    }
    return {
      profile: pr.id, archetype: archetype, received: received, casesPerPallet: cpp, eachesPerCase: epc,
      pallet: pr.pallet, box: pr.box, steps: steps,
      // The identity every step must satisfy (asserted in the harness):
      conserved: steps.every((s) => s.eaches + s.retained + s.scrapped === received),
    };
  }

  WT.pack = {
    HONESTY, PALLETS, TRAILERS, BOXES, PROFILES, SCENARIO_PROFILE, DEFAULT_PROFILE,
    profileFor, tiFor, tiHi, casesPerPallet, bestPattern, trailerFill,
    bandDP, bestLayer, layerRects, optimizeProfile, // v3.34
    fourBlock, gridOrBands, bct, STACK_FACTORS, stackFactor, stackLoadKg, safeLayers, G_N_PER_KG, // v3.38
    hash01, draw, quantitiesAlong,
  };
})();
