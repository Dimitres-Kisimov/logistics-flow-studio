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
 * WHAT IS NOT MODELLED: interlocking / pinwheel patterns, overhang, load
 * stability, mixed-SKU pallets, weight distribution, double-stacking in the
 * trailer, axle loads. The optimiser is "informed by practice, not a load
 * plan".
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
    "interlocking, overhang, stability or weight-distribution model.";

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
      pallet: "eur", maxStackMm: 1800, eachesPerParcel: 6, line: { cases: [2, 8], eaches: [1, 12], exportCases: [4, 8] } },
    "grocery-ambient": { id: "grocery-ambient", label: "Grocery / FMCG ambient", box: "tray-400x300x200", eachesPerCase: 24, caseKg: 8,
      pallet: "eur", maxStackMm: 1650, eachesPerParcel: 12, line: { cases: [4, 16], eaches: [2, 24], exportCases: [8, 16] } },
    beverage: { id: "beverage", label: "Beverage", box: "tray-400x300x135", eachesPerCase: 24, caseKg: 9.5,
      pallet: "eur", maxStackMm: 1650, eachesPerParcel: 6, line: { cases: [8, 40], eaches: [6, 24], exportCases: [16, 40] } },
    automotive: { id: "automotive", label: "Automotive (KLT)", box: "klt-600x400x280", eachesPerCase: 20, caseKg: 15,
      pallet: "ind", maxStackMm: 1600, eachesPerParcel: 4, line: { cases: [2, 8], eaches: [1, 20], exportCases: [4, 8] } },
    pharma: { id: "pharma", label: "Pharma (GDP)", box: "case-300x200x150", eachesPerCase: 48, caseKg: 4,
      pallet: "eur", maxStackMm: 1500, eachesPerParcel: 24, line: { cases: [2, 12], eaches: [1, 48], exportCases: [6, 16] } },
    "spare-parts": { id: "spare-parts", label: "Spare parts / electronics / tools", box: "case-400x300x300", eachesPerCase: 6, caseKg: 10,
      pallet: "eur", maxStackMm: 1800, eachesPerParcel: 3, line: { cases: [1, 6], eaches: [1, 6], exportCases: [4, 8] } },
    "cold-chain": { id: "cold-chain", label: "Cold chain / food production", box: "crate-600x400x200", eachesPerCase: 10, caseKg: 12,
      pallet: "eur", maxStackMm: 1700, eachesPerParcel: 5, line: { cases: [2, 4], eaches: [1, 10], exportCases: [4, 4] } },
    bulky: { id: "bulky", label: "Bulky goods / building materials / furniture", box: "bulk-600x400x400", eachesPerCase: 1, caseKg: 30,
      pallet: "ind", maxStackMm: 1400, eachesPerParcel: 1, line: { cases: [1, 4], eaches: [1, 2], exportCases: [2, 4] } },
    chemical: { id: "chemical", label: "Chemicals / hazmat (drums)", box: "drum-585x585x880", eachesPerCase: 1, caseKg: 220,
      pallet: "drum", maxStackMm: 1100, eachesPerParcel: 1, line: { cases: [1, 4], eaches: [1, 1], exportCases: [2, 4] } },
    tyres: { id: "tyres", label: "Tyres (cages)", box: "tyre-630x630x230", eachesPerCase: 1, caseKg: 9,
      pallet: "cage", fixedPerPallet: 24, maxStackMm: 1800, eachesPerParcel: 1, line: { cases: [2, 8], eaches: [1, 4], exportCases: [4, 8] } },
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
  // The pallet pattern: ti (cases per layer, best of the two orientations),
  // hi (layers under the stack-height limit), reduced until the load respects
  // the pallet's safe working load. Pure.
  function tiHi(pallet, box, maxStackMm, caseKg) {
    if (pallet.fixed) {
      return { ti: null, hi: null, rotated: false, cases: 0, grossKg: pallet.tareKg, cubeUtil: 0, weightLimited: false, fixed: true };
    }
    const t0 = tiFor(pallet, box, false), t1 = tiFor(pallet, box, true);
    const rotated = t1 > t0;
    const ti = Math.max(t0, t1);
    const usable = Math.max(0, (maxStackMm || 0) - pallet.h);
    let hi = ti > 0 ? Math.floor(usable / box.h) : 0;
    let weightLimited = false;
    const kg = isFinite(caseKg) && caseKg > 0 ? caseKg : 0;
    if (kg > 0 && ti > 0) {
      const maxLayers = Math.floor(pallet.maxLoadKg / (ti * kg));
      if (maxLayers < hi) { hi = Math.max(0, maxLayers); weightLimited = true; }
    }
    const cases = ti * hi;
    const caseVol = box.l * box.w * box.h;
    const envelope = pallet.l * pallet.w * usable;
    return {
      ti: ti, hi: hi, rotated: rotated, cases: cases,
      grossKg: Math.round((pallet.tareKg + cases * kg) * 10) / 10,
      cubeUtil: envelope > 0 ? Math.round((cases * caseVol / envelope) * 10000) / 10000 : 0,
      stackMm: pallet.h + hi * box.h,
      weightLimited: weightLimited, fixed: false,
    };
  }
  function casesPerPallet(profile) {
    const pallet = PALLETS[profile.pallet];
    if (pallet.fixed || profile.fixedPerPallet) return profile.fixedPerPallet || 0;
    return tiHi(pallet, BOXES[profile.box], profile.maxStackMm, profile.caseKg).cases;
  }
  // Rank every candidate pallet type for a case: most cases per pallet first,
  // then cube utilisation. Cages are excluded (declared capacity, not a pattern).
  function bestPattern(box, maxStackMm, caseKg, candidates) {
    const ids = candidates && candidates.length ? candidates : ["eur", "ind", "half"];
    const out = ids.filter((id) => PALLETS[id] && !PALLETS[id].fixed).map((id) => {
      const p = PALLETS[id];
      const r = tiHi(p, box, maxStackMm, caseKg);
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
    hash01, draw, quantitiesAlong,
  };
})();
