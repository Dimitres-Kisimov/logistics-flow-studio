/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * routing.js - ORDER-DRIVEN ROUTING MODEL (v3.25, R1: the engine)
 * ---------------------------------------------------------------------
 * Until v3.24 every handling unit in the warehouse animation walked ONE
 * hardcoded spine:
 *
 *     receiving -> storage -> picking -> packing -> shipping
 *
 * That is not how a warehouse works. A full pallet that is cross-docked
 * never touches the racking. A customer return runs COUNTER-flow and ends
 * either back in stock or in the scrap cage. An e-commerce each-pick is
 * depalletised on the way in, replenished to a pick face, picked into a
 * tote, consolidated, packed and only then loaded. An export pallet is
 * built and stretch-wrapped before it goes near a trailer.
 *
 * This module is the MODEL that makes that true:
 *
 *   OPERATIONS   the atomic things that can happen to goods (receive, QC,
 *                depalletise, put-away, replenish, pick, consolidate,
 *                value-add, pack, palletise, stretch-wrap, stage, load,
 *                inspect, restock, scrap). Each declares WHICH physical
 *                ANCHOR in the layout performs it, which flow STAGE the
 *                unit is in while it does it, which flowsim STATION kind
 *                serves it (so queues keep working) and what the unit
 *                LOOKS like afterwards (the R3 form hint).
 *
 *   ARCHETYPES   order types. An order declares the OPERATION SEQUENCE it
 *                requires - NOT a stage list. Some archetypes have two
 *                OUTCOMES (a return is restocked OR scrapped), which is a
 *                real routing split, not a label.
 *
 *   THE ROUTER   resolves an archetype's operations against the ANCHORS
 *                that actually exist in the CURRENT layout. If an
 *                operation has no station on the floor the order is
 *                UNFULFILLABLE and SAYS SO in plain language (the same
 *                discipline as process.js validateFlow / fluids.js). It is
 *                NEVER silently skipped and NEVER silently re-routed.
 *
 *   THE MIX      which archetypes the order pool is made of, plus a
 *                deterministic largest-remaining-QUOTA dispatcher - the
 *                SAME rule process.js uses at a multi-way split - so the
 *                k-th order's route is an exact function of k and the mix.
 *                NO Date, NO Math.random anywhere.
 *
 * WHY THE OLD HARDCODED ARRAY WAS WRONG, in the words of the guideline the
 * app already cites: VDI 3590 states that the sequence of its basic
 * functions is "nicht notwendigerweise determiniert" and that steps
 * "teilweise auch entfallen koennen" - not necessarily determined, and
 * steps may be omitted. A single `STAGES` array that every unit had to
 * walk contradicted the very guideline it claimed to be informed by. An
 * order declaring the operations it needs is the guideline-consistent
 * shape; expressing the remaining freedom (arbitrary order, omitted
 * steps, cycles) needs the graph model noted under KNOWN LIMITS below.
 *
 * BACKWARD COMPATIBILITY IS A HARD GATE. The archetype `legacy-spine` is
 * the default: its operation list resolves to EXACTLY the v3.24 waypoint
 * spine, so a caller that declares no mix gets byte-identical behaviour.
 * Proven by verify_routing.js (legacy collapse) and by every pre-existing
 * flow harness continuing to pass unchanged.
 *
 * HONESTY (load-bearing, mirrored in the UI + README):
 *   - SYNTHETIC. These are TRANSPARENT TEACHING ROUTE RECIPES informed by
 *     ordinary distribution-centre practice (goods-in check, put-away,
 *     replenishment, pick/pack, cross-dock, returns grading, end-of-line
 *     wrapping). They are NOT a WMS, NOT a vendor process definition, NOT
 *     a measurement of any real operation and NOT a certification.
 *   - The archetype demand shares are ILLUSTRATIVE defaults, not measured
 *     order-profile data. Supply your own mix to model your own operation.
 *   - Some operations currently resolve onto a SHARED anchor because the
 *     app has no dedicated element for them yet (goods-in QC borrows the
 *     Returns / QA bench; palletising borrows the Stretch-wrap /
 *     palletiser). Every shared binding is REPORTED per step and per
 *     archetype - it is disclosed, never hidden.
 *   - `depalletise` and `value-add` have NO element type at all in v3.25,
 *     so every archetype that needs them is honestly UNFULFILLABLE until
 *     the R2 station types land.
 *   - The recipes are INFORMED BY the German process decomposition in
 *     VDI 4490 (Wareneingang, Qualitaetssicherung, Retouren, Einlagerung,
 *     Lagerung/Nachschub, Kommissionierung, Verpackung, Versand, Leergut)
 *     and by the VDI 3590 unit-transformation chain (Lagereinheit ->
 *     Transporteinheit -> Beschickungseinheit -> Bereitstelleinheit ->
 *     Entnahmeeinheit -> Sammeleinheit -> Versandeinheit). Informed by,
 *     NOT compliant with, NOT a certification. The full texts are
 *     paywalled; nothing here reproduces them.
 *   - KNOWN LIMITS of this R1 engine, stated plainly rather than implied:
 *       * Each archetype's operation order is FIXED. VDI 3590 says the
 *         sequence is not necessarily determined and that steps may be
 *         omitted; expressing that needs the graph model, not a list.
 *       * Quality control is a PASS-THROUGH step, not a branch. Real
 *         goods-in QC can divert a unit to blocked stock, where it dwells
 *         and is not pickable until it is explicitly released.
 *       * Returns has TWO outcomes here (restock / scrap). Practice
 *         distinguishes as-new, lightly damaged, dismantled for parts and
 *         disposal - four - and the middle two need a refurbish bench.
 *       * Replenishment is a STEP inside the each-pick sequence, not the
 *         order-independent LOOP it really is; the same is true of
 *         re-slotting and of the return leg inside picking. Cycles need
 *         a directed graph.
 *       * (v3.54) A HUMAN ERROR is a declared share per step, realised as an
 *         UNROLLED detour - the operation, its verification, the operation
 *         once more - or a write-off. A unit that errs twice is not modelled,
 *         a second error kind on one unit is not modelled, and the detour is
 *         a list for the same reason the loops above are: cycles need a graph.
 *       * (v3.68) THE GRAPH EXISTS NOW. A route is a directed graph and the
 *         list is its walk (graphOf / walk below, docs/ROUTE_GRAPH.md), so
 *         the detour above is a check edge and a REWORK back edge rather
 *         than a splice. Every limit above that ended "cycles need a graph"
 *         is therefore a missing DECLARATION from here on, not a missing
 *         model: no archetype declares an optional step, an alternative
 *         path, a blocked-stock branch or a replenishment loop. And the
 *         reason a unit that errs twice is still not modelled is now
 *         precise - the check edge is entered only on the FIRST visit to a
 *         step, so a second error would be a second draw from the quota
 *         dispatcher, not a second lap of the loop.
 *       * Not modelled at all: dangerous goods, the cold chain as a routed
 *         zone, the empties counter-flow, second-stage batch sortation and
 *         dispatch-label (SSCC) application.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Pure model: no DOM, no geometry, no dependencies. The
 * geometric ANCHOR RESOLUTION lives in flowsim.js (WT.flowsim.anchors),
 * which already owns the layout-centroid helpers; this module is handed
 * the resolved anchor index and never touches a layout itself.
 * No frameworks, no build step, fully offline, no deps.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const SYNTHETIC_LABEL =
    "SYNTHETIC order-routing model - transparent TEACHING route recipes for " +
    "ordinary distribution-centre order types (full pallet, case pick, each " +
    "pick, cross-dock, returns, value-add, export), NOT a WMS, NOT a vendor " +
    "process definition, NOT a measurement of any real operation and NOT a " +
    "certification. The demand shares are ILLUSTRATIVE defaults, not measured " +
    "order-profile data. Where an operation has no station on the floor the " +
    "order is reported UNFULFILLABLE - it is never silently skipped and never " +
    "silently re-routed. Where an operation borrows a SHARED anchor (goods-in " +
    "QC on the Returns / QA bench, palletising on the Stretch-wrap / " +
    "palletiser) the sharing is reported on every step.";

  /* ==================================================================
   * ANCHORS - the physical places on the floor an operation can happen.
   * `dedicated` anchors have an element type of their own. `sharedWith`
   * names the element whose documented function is being borrowed because
   * the app has no dedicated element yet (disclosed on every step).
   * `pending` anchors have NO element at all in v3.25 - R2 adds them; any
   * archetype needing one is honestly unfulfillable today.
   *
   * The FIRST FIVE are the legacy spine's anchors and keep their exact
   * v3.24 fallback chains (zone metadata, then a geometric default), which
   * is what makes the legacy collapse byte-identical. Every anchor added
   * here is STRICT: no element, no fallback, no route.
   * ================================================================== */
  const ANCHORS = {
    "dock-in": {
      id: "dock-in", label: "Inbound dock door", element: "dock-in",
      legacy: true, strict: false,
      note: "Inbound dock doors (or a user-defined receiving dock).",
    },
    storage: {
      id: "storage", label: "Storage racking", element: "(any storage class)",
      legacy: true, strict: false,
      note: "The racking centroid - velocity-weighted onto the real slotting when a storage assignment rides on the layout.",
    },
    pickface: {
      id: "pickface", label: "Pick face", element: "(pick-face / goods-to-person classes)",
      legacy: true, strict: false,
      note: "Pick faces, carton flow, pick-to-light, goods-to-person stations.",
    },
    pack: {
      id: "pack", label: "Pack station", element: "pack-station",
      legacy: true, strict: false,
      note: "Packing / consolidation bench (or a user-defined processing station).",
    },
    "dock-out": {
      id: "dock-out", label: "Outbound dock door", element: "dock-out",
      legacy: true, strict: false,
      note: "Outbound dock doors (or a user-defined shipping dock).",
    },
    staging: {
      id: "staging", label: "Staging / marshalling area", element: "staging",
      legacy: false, strict: true,
      note: "Marshalling buffer - the cross-dock transfer lane and the outbound consolidation floor.",
    },
    qc: {
      id: "qc", label: "Quality-control bench", element: "qc-bench",
      legacy: false, strict: true,
      sharedWith: "returns-station",
      sharedNote:
        "With no Goods-in QC bench placed, quality control borrows the Returns / QA station (whose documented job " +
        "is grade + inspect) and the step is reported SHARED. R2 (v3.29) added the dedicated qc-bench so inbound " +
        "checking and returns grading no longer have to share one bench - place one and this step stops being shared.",
      note: "Goods-in sampling and outbound / export checking. Resolves to a Goods-in QC bench, else borrows the Returns / QA station.",
    },
    returns: {
      id: "returns", label: "Returns / QA station", element: "returns-station",
      legacy: false, strict: true,
      note: "The returns bench: grade, re-label, then restock or scrap.",
    },
    wrap: {
      id: "wrap", label: "Stretch-wrap turntable", element: "stretch-wrap",
      legacy: false, strict: true,
      note: "End-of-line stretch-wrapping before dispatch. Promoted from scenery to a real routing step.",
    },
    palletise: {
      id: "palletise", label: "Palletiser", element: "stretch-wrap",
      legacy: false, strict: true,
      sharedWith: "stretch-wrap",
      sharedNote:
        "Palletising borrows the Stretch-wrap / palletiser element (its own label names both jobs). " +
        "R2 (v3.29) kept build-the-pallet and wrap-the-pallet on that one station; a separate palletiser is a " +
        "documented gap, not a hidden one.",
      note: "Building the outbound pallet before it is wrapped.",
    },
    depalletise: {
      id: "depalletise", label: "Depalletiser", element: "depalletiser",
      legacy: false, strict: true,
      note: "Breaking an inbound pallet down into cases. Resolves to a Depalletiser (the element R2 added in v3.29).",
    },
    vas: {
      id: "vas", label: "Value-add / kitting bench", element: "vas-station",
      legacy: false, strict: true,
      note: "Kitting, labelling, bundling, gift-wrap. Resolves to a Value-add / kitting bench (the element R2 added in v3.29).",
    },
  };

  /* ==================================================================
   * OPERATIONS - what can happen to a handling unit.
   *   stage    the flow stage the unit REPORTS while doing this operation.
   *            Always one of the five legacy stages, so every existing
   *            drawing/colour/KPI layer keeps working untouched.
   *   anchor   where on the floor it happens (an ANCHORS id).
   *   station  the flowsim station kind that SERVES it ("put" | "pick" |
   *            "pack" | null). A unit queues at a station exactly as it
   *            does today; null means the operation is a waypoint, not a
   *            server.
   *   form     what the unit LOOKS like once the operation is done - the
   *            hint R3 turns into operation-driven goods drawing. `wrapped-
   *            pallet` has no drawing yet (R3 adds it).
   * ================================================================== */
  const OPERATIONS = {
    receive: {
      id: "receive", label: "Goods-in / unload", stage: "receiving",
      anchor: "dock-in", station: null, form: "pallet-load",
      desc: "The trailer is unloaded and the handling unit enters the building.",
    },
    "qc-sample": {
      id: "qc-sample", label: "Goods-in QC (sample check)", stage: "receiving",
      anchor: "qc", station: null, form: "pallet-load",
      desc: "A sample of the inbound load is checked before it is accepted into stock.",
    },
    "qc-final": {
      id: "qc-final", label: "Outbound / export QC", stage: "packing",
      anchor: "qc", station: null, form: "carton",
      desc: "A second, stricter check on export or fragile goods before dispatch.",
    },
    inspect: {
      id: "inspect", label: "Returns inspection & grading", stage: "receiving",
      anchor: "returns", station: null, form: "carton",
      desc: "A customer return is opened, graded and routed to stock or to scrap.",
    },
    depalletise: {
      id: "depalletise", label: "Depalletise (break to cases)", stage: "receiving",
      anchor: "depalletise", station: null, form: "carton",
      desc: "The inbound pallet is broken down so cases can be put away individually.",
    },
    putaway: {
      id: "putaway", label: "Put-away into storage", stage: "storage",
      anchor: "storage", station: "put", form: "carton",
      desc: "The unit is driven to its slot and put into the racking.",
    },
    replen: {
      id: "replen", label: "Replenish the pick face", stage: "storage",
      anchor: "storage", station: "put", form: "carton",
      desc: "Stock is pulled down from reserve to refill the forward pick face.",
    },
    restock: {
      id: "restock", label: "Restock to sellable stock", stage: "storage",
      anchor: "storage", station: "put", form: "carton",
      desc: "A graded-good return goes back into the racking as sellable stock.",
    },
    pick: {
      id: "pick", label: "Order pick", stage: "picking",
      anchor: "pickface", station: "pick", form: "tote",
      desc: "The generic pick of the v3.24 spine - kept so the legacy route is expressible.",
    },
    "pallet-pick": {
      id: "pallet-pick", label: "Full-pallet retrieval", stage: "picking",
      anchor: "pickface", station: "pick", form: "pallet-load",
      desc: "A whole pallet is taken from reserve - no case handling, no packing.",
    },
    "case-pick": {
      id: "case-pick", label: "Case pick", stage: "picking",
      anchor: "pickface", station: "pick", form: "carton",
      desc: "Full cases are picked from the pick face onto an order pallet or roll cage.",
    },
    "piece-pick": {
      id: "piece-pick", label: "Piece / each pick", stage: "picking",
      anchor: "pickface", station: "pick", form: "tote",
      desc: "Individual eaches are picked into a tote - the e-commerce touch.",
    },
    consolidate: {
      id: "consolidate", label: "Tote consolidation", stage: "picking",
      anchor: "staging", station: null, form: "tote",
      desc: "Totes from several pick zones are married up into one order.",
    },
    vas: {
      id: "vas", label: "Value-add: kitting / labelling", stage: "packing",
      anchor: "vas", station: null, form: "carton",
      desc: "Kitting, re-labelling, bundling or gift-wrap before the order is packed.",
    },
    pack: {
      id: "pack", label: "Pack & label", stage: "packing",
      anchor: "pack", station: "pack", form: "parcel",
      desc: "The order is boxed, documented and labelled for the carrier.",
    },
    palletise: {
      id: "palletise", label: "Build the outbound pallet", stage: "packing",
      anchor: "palletise", station: null, form: "pallet-load",
      desc: "Cases are stacked into a dispatch pallet.",
    },
    wrap: {
      id: "wrap", label: "Stretch-wrap the pallet", stage: "packing",
      anchor: "wrap", station: null, form: "wrapped-pallet",
      desc: "The pallet is turned on the wrapper and secured for transport.",
    },
    "stage-out": {
      id: "stage-out", label: "Outbound staging / marshalling", stage: "shipping",
      anchor: "staging", station: null, form: "pallet-load",
      desc: "The unit waits on the marshalling floor for its trailer - a cross-dock unit does this INSTEAD of being stored.",
    },
    load: {
      id: "load", label: "Load the trailer", stage: "shipping",
      anchor: "dock-out", station: null, form: "parcel",
      desc: "The unit is loaded onto the outbound vehicle and leaves the building.",
    },
    scrap: {
      id: "scrap", label: "Scrap / write-off", stage: "shipping",
      anchor: "returns", station: null, form: "carton",
      desc: "A return that failed grading is written off at the returns bench - it never re-enters stock.",
    },
    // v3.54 HUMAN ERROR: the two DETECTION steps a rework passes through. No new
    // anchors - a pick is verified at the pick face, a put-away at the storage
    // location - and no station: the check is a scan, not a served queue.
    "verify-pick": {
      id: "verify-pick", label: "Pick verification (scan check at the face)", stage: "picking",
      anchor: "pickface", station: null, form: "tote",
      desc: "The pick is checked against the order line at the face; a mis-pick is caught here and the pick is done again once (the v3.54 error what-if).",
    },
    "verify-put": {
      id: "verify-put", label: "Put-away verification (location scan)", stage: "storage",
      anchor: "storage", station: null, form: "carton",
      desc: "The location scan after put-away; a wrong slot is caught here and the put-away is done again once (the v3.54 error what-if).",
    },
  };

  const OPERATION_ORDER = Object.keys(OPERATIONS);

  /* ==================================================================
   * ARCHETYPES - the order types. `ops` is the required OPERATION
   * SEQUENCE. `outcomes` (optional) makes the archetype BRANCH: each
   * outcome appends its own tail, and the branch a given order takes is
   * decided by the same deterministic quota dispatcher used for the mix.
   *
   * `share` is the ILLUSTRATIVE default demand weight (documented as a
   * teaching assumption, not measured order-profile data).
   * `neverStorage` is a declared INVARIANT the harness asserts against the
   * resolved route - a cross-dock unit must never touch the racking.
   * ================================================================== */
  const LEGACY_ID = "legacy-spine";

  const ARCHETYPES = [
    {
      id: LEGACY_ID,
      label: "Standard flow spine (legacy default)",
      short: "Standard spine",
      ops: ["receive", "putaway", "pick", "pack", "load"],
      share: 1,
      legacy: true,
      desc:
        "The single hardcoded path every unit walked before v3.25: in at the dock, " +
        "away to storage, picked, packed, shipped. Kept as the DEFAULT so a caller " +
        "that declares no order mix gets byte-identical v3.24 behaviour.",
    },
    {
      id: "full-pallet-out",
      label: "Full pallet out (no touch)",
      short: "Full pallet",
      ops: ["receive", "qc-sample", "putaway", "pallet-pick", "wrap", "load"],
      share: 0.18,
      desc:
        "A whole pallet in, a whole pallet out. It is sample-checked on arrival, put " +
        "away, retrieved intact, stretch-wrapped and loaded. It is NEVER depalletised " +
        "and NEVER packed - the two operations the old spine forced on every unit.",
    },
    {
      id: "case-pick",
      label: "Case pick (carton out)",
      short: "Case pick",
      ops: ["receive", "qc-sample", "depalletise", "putaway", "case-pick", "consolidate", "palletise", "wrap", "load"],
      share: 0.22,
      desc:
        "Retail replenishment. The inbound pallet is broken to cases, cases are put " +
        "away, picked whole, consolidated, built into a dispatch pallet and secured. " +
        "Note it is NOT re-packed: full cases usually ship as they are, which is why " +
        "this route ends in palletise + stretch-wrap rather than at a pack bench.",
    },
    {
      id: "piece-pick",
      label: "Each / piece pick (e-commerce)",
      short: "Each pick",
      ops: ["receive", "depalletise", "putaway", "replen", "piece-pick", "consolidate", "pack", "load"],
      share: 0.3,
      desc:
        "The longest route in the building: depalletise, put away to reserve, " +
        "replenish the forward face, pick eaches into a tote, consolidate the order, " +
        "pack it and load it. Eight touches, not five.",
    },
    {
      id: "cross-dock",
      label: "Cross-dock (never enters storage)",
      short: "Cross-dock",
      ops: ["receive", "qc-sample", "stage-out", "load"],
      share: 0.12,
      neverStorage: true,
      desc:
        "Straight across the building. Checked at goods-in, marshalled on the " +
        "outbound floor and loaded. It NEVER enters the racking - the defining " +
        "property the old single spine could not express. This is the SINGLE-STAGE " +
        "form, where the supplier has already picked for the recipient and the load " +
        "unit is never broken; the two-stage (break-and-re-form) variant needs the " +
        "consolidation and de-consolidation stations R2 adds.",
    },
    {
      id: "returns",
      label: "Customer returns (restock or scrap)",
      short: "Returns",
      ops: ["receive", "inspect"],
      outcomes: [
        { id: "restock", label: "graded good - back to stock", ops: ["restock"], share: 0.75 },
        { id: "scrap", label: "failed grading - written off", ops: ["scrap"], share: 0.25 },
      ],
      share: 0.1,
      desc:
        "Counter-flow. A return comes IN through the dock, is inspected and graded, " +
        "and then takes one of TWO outcomes: back into sellable stock, or written off " +
        "at the bench. A real routing split, not a label.",
    },
    {
      id: "vas",
      label: "Value-add services (kitting / labelling)",
      short: "VAS",
      ops: ["pick", "vas", "pack", "load"],
      share: 0.05,
      startsInStock: true,
      desc:
        "Work on stock that is ALREADY in the building: pick it, kit or re-label it, " +
        "pack it, load it. It starts at the pick face, not at the dock.",
    },
    {
      id: "export-fragile",
      label: "Export / fragile (extra QC + palletise + wrap)",
      short: "Export",
      ops: ["pick", "qc-final", "palletise", "wrap", "load"],
      share: 0.03,
      startsInStock: true,
      desc:
        "Stock already held is picked, checked a second time, built into a dispatch " +
        "pallet, stretch-wrapped and loaded. Extra assurance, extra handling.",
    },
  ];

  const ARCHETYPE_BY_ID = {};
  for (const a of ARCHETYPES) ARCHETYPE_BY_ID[a.id] = a;

  /* ==================================================================
   * The deterministic largest-remaining-QUOTA dispatcher. This is the
   * SAME rule process.js uses to send tokens down a multi-way split:
   *
   *     deficit(i) = share(i) * (dispatched + 1) - sent(i)
   *     pick the largest deficit; ties -> the earliest declared branch
   *
   * No RNG, no Date. The k-th order's branch is an exact function of k and
   * the share vector, so a route is a pure function of order identity.
   * ================================================================== */
  function pickBranch(shares, sent, dispatched) {
    let best = 0, bestDef = -Infinity;
    for (let i = 0; i < shares.length; i++) {
      const def = shares[i] * (dispatched + 1) - sent[i];
      if (def > bestDef + 1e-12) { bestDef = def; best = i; }
    }
    return best;
  }

  // PURE: the first n branch indices the dispatcher produces for `shares`.
  // Used by the harness to hand-check the sequence the sim will walk.
  function dispatchSequence(shares, n) {
    const s = (shares || []).map((v) => (isFinite(v) && v > 0 ? Number(v) : 0));
    const count = Math.max(0, Math.round(Number(n) || 0));
    if (!s.length) return [];
    const sent = s.map(() => 0);
    const out = [];
    for (let k = 0; k < count; k++) {
      const i = pickBranch(s, sent, k);
      sent[i]++;
      out.push(i);
    }
    return out;
  }

  /* ==================================================================
   * MIX normalisation. Accepts, in order of convenience:
   *   null / undefined / []            -> null (the LEGACY default)
   *   "case-pick"                      -> that one archetype
   *   ["case-pick", "cross-dock"]      -> equal shares
   *   [{ id, share }, ...]             -> declared shares
   *   { "case-pick": 2, "returns": 1 } -> weights
   * Unknown ids are reported, never guessed. Shares are renormalised to
   * sum to exactly 1 over the RECOGNISED entries. Declaration order is
   * preserved (object form: key order), so the dispatcher is stable.
   * ================================================================== */
  function normalizeMix(mix) {
    if (mix == null) return null;
    let raw = [];
    if (typeof mix === "string") raw = [{ id: mix, share: 1 }];
    else if (Array.isArray(mix)) {
      for (const m of mix) {
        if (typeof m === "string") raw.push({ id: m, share: 1 });
        else if (m && typeof m === "object" && m.id) raw.push({ id: String(m.id), share: Number(m.share) });
      }
    } else if (typeof mix === "object") {
      for (const k of Object.keys(mix)) raw.push({ id: k, share: Number(mix[k]) });
    }
    if (!raw.length) return null;
    const entries = [], unknown = [];
    const seen = {};
    for (const r of raw) {
      if (!ARCHETYPE_BY_ID[r.id]) { unknown.push(r.id); continue; }
      if (seen[r.id]) continue; // first declaration wins; deterministic
      seen[r.id] = 1;
      const w = isFinite(r.share) && r.share > 0 ? r.share : ARCHETYPE_BY_ID[r.id].share || 1;
      entries.push({ id: r.id, weight: w });
    }
    if (!entries.length) {
      return { entries: [], unknown: unknown, ok: false,
        message: unknown.length
          ? "No recognised order type in the mix (" + unknown.join(", ") + "). Known types: " +
            ARCHETYPES.map((a) => a.id).join(", ") + "."
          : "The order mix is empty." };
    }
    let total = 0;
    for (const e of entries) total += e.weight;
    for (const e of entries) e.share = e.weight / total;
    return { entries: entries, unknown: unknown, ok: true, message: "" };
  }

  // The DEFAULT full mix: every non-legacy archetype at its documented
  // illustrative share. Exposed so the UI/R4 can offer "a realistic day".
  function defaultMix() {
    const out = [];
    for (const a of ARCHETYPES) if (!a.legacy) out.push({ id: a.id, share: a.share });
    return out;
  }

  /* ==================================================================
   * THE ROUTER. Resolve one archetype (optionally one outcome branch)
   * against a RESOLVED ANCHOR INDEX:
   *
   *   anchors = { <anchorId>: { x, y, present, count, source } | null }
   *
   * built by WT.flowsim.anchors(layout) (which owns the layout geometry).
   *
   * Every operation must find its anchor. A missing anchor makes the route
   * UNFULFILLABLE with a friendly, specific message naming the element the
   * user has to place - the same discipline as process.js validateFlow.
   * Nothing is skipped, nothing is re-routed.
   * ================================================================== */
  function routeIdOf(archetypeId, outcomeId) {
    return outcomeId ? archetypeId + ":" + outcomeId : archetypeId;
  }

  /* ---- v3.68 THE ROUTE AS A DECLARED GRAPH ---------------------------------
   * Every limit in the KNOWN LIMITS list above that ends "cycles need a graph"
   * ends there because a route was a LIST. A list cannot say "do this step
   * again", so v3.54's rework had to be UNROLLED - the operation, its check,
   * the operation once more, spliced into a flat array - and a unit that erred
   * twice could not be expressed at all.
   *
   * A route is now a directed graph, and the list is what you get by WALKING
   * it. The graph is built from the same archetype declarations as before, so
   * there is one source of truth and no drift: `opsFor` and `branchesFor` both
   * go through `walk()`, and the harness pins every resulting list literally
   * against the lists v3.67 produced. Nothing a caller sees changes in this
   * release - the plan, the routes, the run ids and the fixtures are byte for
   * byte what they were. What changes is what the model can SAY.
   *
   * EDGE KINDS
   *   then       the ordinary sequence: the next step of the recipe.
   *   outcome    a declared split (returns: restocked or written off).
   *   check      entered only when a declared error was realised at this step.
   *   rework     a BACK EDGE. The step is done again after its check. This is
   *              the cycle the list could not express; it is bounded by the
   *              target node's `maxVisits`, which is 2 in this release - one
   *              redo, exactly the unrolled detour v3.54 produced by hand.
   *   write-off  a terminal edge: the unit leaves the route at a bench.
   *
   * WHAT IS STILL A LIMIT, so the honesty survives the refactor:
   *   - A UNIT THAT ERRS TWICE IS STILL NOT MODELLED, and the graph now says
   *     precisely why, which the old flat list could not. Raising a node's
   *     `maxVisits` from 2 to 3 changes nothing on its own: the CHECK edge is
   *     entered only on the first visit to the step, so a unit that has been
   *     reworked once is never offered a second verification. A second error
   *     is a second draw from the quota dispatcher, not a second lap of the
   *     loop, and closing it needs the dispatcher and the check rule to change
   *     together. The visit bound is the guard rail, not the model.
   *   - Quality control is still a PASS-THROUGH node with one `then` edge out.
   *     The graph can hold the branch to blocked stock; nothing declares it.
   *   - Replenishment is still a node in the each-pick chain, not the
   *     order-independent loop it is in a real building.
   *   - The walk is DETERMINISTIC and takes no random draw: which branch a
   *     unit takes is decided by the quota dispatcher, as before.
   */
  const GRAPH_SCHEMA = "wt-route-graph/v1";
  const EDGE_KINDS = {
    then: "the ordinary sequence: the next step of the recipe",
    outcome: "a declared split - the route takes one outcome and not the others",
    check: "a verification step, entered only when a declared error was realised at this step",
    rework: "a BACK EDGE - the step is done again after its check, bounded by the target's maxVisits",
    "write-off": "a terminal edge - the unit leaves the route at a write-off bench",
  };
  const GRAPH_HONESTY =
    "A declared route graph, not an observed one: the nodes are this app's teaching operations and the edges are " +
    "the recipe's own order, informed by ordinary distribution-centre practice (VDI 4490's process decomposition, " +
    "VDI 3590's unit-transformation chain) and by nothing measured in any plant. The walk is deterministic and takes " +
    "no random draw. A rework is a bounded back edge - one redo in this release - and a unit that errs twice is still " +
    "not modelled. A node is a process step and never a person, and nothing here is keyed to one (BetrVG 87(1)6, GDPR Art. 88).";

  function graphNode(opId, maxVisits) {
    const op = OPERATIONS[opId] || {};
    return { id: opId, op: opId, label: op.label || opId, stage: op.stage || null, anchor: op.anchor || null, maxVisits: maxVisits || 1 };
  }
  // graphOf(archetypeId, opts) -> the declared graph of a route.
  //   opts.error = { kind, op }  adds that error branch's check / rework / write-off edges.
  // Node ids are operation ids: no archetype's own list repeats an operation (asserted in
  // the harness), so a node is a step of the recipe and a repeat is a second VISIT to it.
  function graphOf(archetypeId, opts) {
    const o = opts || {};
    const arch = ARCHETYPE_BY_ID[archetypeId];
    if (!arch) return null;
    const nodes = [], edges = [], byId = {};
    const add = (opId, maxVisits) => {
      if (!byId[opId]) { byId[opId] = graphNode(opId, maxVisits); nodes.push(byId[opId]); }
      else if (maxVisits && maxVisits > byId[opId].maxVisits) byId[opId].maxVisits = maxVisits;
      return opId;
    };
    const base = (arch.ops || []).slice();
    for (let i = 0; i < base.length; i++) {
      add(base[i]);
      if (i) edges.push({ from: base[i - 1], to: base[i], kind: "then" });
    }
    const outs = outcomesOf(arch);
    const last = base.length ? base[base.length - 1] : null;
    if (outs) {
      for (const oc of outs) {
        let prev = last;
        const ops = oc.ops || [];
        for (let i = 0; i < ops.length; i++) {
          add(ops[i]);
          edges.push({ from: prev, to: ops[i], kind: i === 0 ? "outcome" : "then", outcome: oc.id });
          prev = ops[i];
        }
      }
    }
    // The error branch's own edges: a check and a back edge, or a terminal write-off.
    const err = o.error && o.error.kind && o.error.op ? o.error : null;
    const def = err ? ERROR_KINDS.find((k) => k.kind === err.kind) : null;
    if (def && byId[err.op]) {
      if (def.tail && def.tail.length) {
        let prev = err.op;
        for (let i = 0; i < def.tail.length; i++) {
          add(def.tail[i]);
          edges.push({ from: prev, to: def.tail[i], kind: i === 0 ? "write-off" : "then", error: def.kind });
          prev = def.tail[i];
        }
      } else if (def.rework && def.rework.length === 2) {
        const checkOp = def.rework[0];
        const backOp = def.rework[1] === SAME_OP ? err.op : def.rework[1];
        add(checkOp);
        add(backOp, 2); // the bound: one redo
        edges.push({ from: err.op, to: checkOp, kind: "check", error: def.kind });
        edges.push({ from: checkOp, to: backOp, kind: "rework", error: def.kind });
        // The graph must be TOTAL. If the visit bound ever refuses the rework - it cannot in this
        // release, where the bound is 2 and the step has been visited once - the unit must still
        // have a way onward, or it would stand at the verification bench for ever and never ship.
        // The fallback is the step the recipe would have gone to anyway. It is never taken today
        // (the rework edge is tried first and always wins), and the harness pins that it exists.
        const after = edges.find((e) => e.from === err.op && e.kind === "then");
        if (after) edges.push({ from: checkOp, to: after.to, kind: "then", error: def.kind });
      }
    }
    return { schema: GRAPH_SCHEMA, id: arch.id, label: arch.label, start: base.length ? base[0] : null,
      nodes: nodes, edges: edges, outcomes: outs ? outs.map((x) => ({ id: x.id, label: x.label, share: x.share })) : null,
      error: err ? { kind: err.kind, op: err.op } : null, honesty: GRAPH_HONESTY };
  }
  // Which edge a unit takes out of a node, given how often it has been here already.
  // Order matters and is the model: leave the route, then check, then go back, then
  // the declared outcome, then the ordinary next step.
  function chooseEdge(out, visits, byId, o) {
    const err = o.error || null;
    for (const e of out) if (e.kind === "write-off" && err && e.error === err.kind && visits[e.from] === 1) return e;
    for (const e of out) if (e.kind === "check" && err && e.error === err.kind && visits[e.from] === 1) return e;
    for (const e of out) if (e.kind === "rework" && (visits[e.to] || 0) < ((byId[e.to] && byId[e.to].maxVisits) || 1)) return e;
    let firstOutcome = null;
    for (const e of out) if (e.kind === "outcome") { if (e.outcome === o.outcome) return e; if (!firstOutcome) firstOutcome = e; }
    if (firstOutcome) return firstOutcome; // no outcome named: the first declared one, as the list builder always did
    for (const e of out) if (e.kind === "then") return e;
    return null;
  }
  // walk(graph, opts) -> the operation list a unit performs. opts: { outcome, error }.
  function walk(graph, opts) {
    const o = opts || {};
    if (!graph || !graph.nodes || !graph.nodes.length || !graph.start) return [];
    const byId = {}, out = {}, visits = {}, list = [];
    for (const n of graph.nodes) byId[n.id] = n;
    for (const e of graph.edges) (out[e.from] = out[e.from] || []).push(e);
    let id = graph.start, guard = 0;
    while (id && byId[id] && guard++ < 512) {
      list.push(byId[id].op);
      visits[id] = (visits[id] || 0) + 1;
      const next = chooseEdge(out[id] || [], visits, byId, o);
      id = next ? next.to : null;
    }
    return list;
  }
  // v3.68: the list is what you get by walking the graph. Pinned equal to every list
  // v3.67 produced, for every archetype and every outcome, by verify_routegraph.js.
  function opsFor(arch, outcomeId) {
    return walk(graphOf(arch.id), { outcome: outcomeId });
  }

  function outcomesOf(arch) {
    return arch.outcomes && arch.outcomes.length ? arch.outcomes : null;
  }

  function missingMessage(arch, missing) {
    const parts = missing.map((m) => {
      const a = ANCHORS[m.anchor] || {};
      if (a.pending) {
        return '"' + m.label + '" needs a ' + a.label +
          ", which this version has no element for yet (it arrives in R2)";
      }
      const alt = a.sharedWith ? " (or a " + a.sharedWith + ", which the router borrows)" : "";
      return '"' + m.label + '" needs a ' + a.label +
        " - place a " + (a.element || a.label) + alt + " on the floor";
    });
    return "Orders of type '" + arch.label + "' cannot be fulfilled by this layout: " +
      parts.join("; ") + ". Nothing has been re-routed around the gap - the order type is simply " +
      "reported as unfulfillable.";
  }

  function resolveRoute(archetypeId, anchors, opts) {
    const o = opts || {};
    const arch = ARCHETYPE_BY_ID[archetypeId];
    if (!arch) {
      return {
        ok: false, id: String(archetypeId), routeId: String(archetypeId), outcome: null,
        label: String(archetypeId), ops: [], steps: [], missing: [], shared: [],
        unknown: true,
        message: 'Unknown order type "' + archetypeId + '". Known types: ' +
          ARCHETYPES.map((a) => a.id).join(", ") + ".",
      };
    }
    const outs = outcomesOf(arch);
    const outcomeId = outs ? (o.outcome && outs.some((x) => x.id === o.outcome) ? o.outcome : outs[0].id) : null;
    const ops = Array.isArray(o.ops) && o.ops.length ? o.ops.slice() : opsFor(arch, outcomeId); // v3.54: an error branch hands its spliced list
    const A = anchors || {};

    const steps = [], missing = [], shared = [];
    for (const opId of ops) {
      const op = OPERATIONS[opId];
      if (!op) continue; // catalogue is closed; defensive only
      const anc = ANCHORS[op.anchor] || {};
      const pt = A[op.anchor];
      if (!pt || pt.present === false || !isFinite(pt.x) || !isFinite(pt.y)) {
        missing.push({ op: op.id, label: op.label, anchor: op.anchor, anchorLabel: anc.label || op.anchor,
          element: anc.element || null, pending: anc.pending || null });
        continue;
      }
      const step = {
        op: op.id, label: op.label, stage: op.stage, form: op.form,
        station: op.station || null, anchor: op.anchor,
        x: pt.x, y: pt.y,
        source: pt.source || "element",
      };
      // A borrowed binding is disclosed ONLY when the borrowing actually
      // happened on this floor (the anchor index marks it `shared`).
      if (anc.sharedWith && pt.shared) {
        step.sharedWith = anc.sharedWith;
        step.sharedNote = anc.sharedNote;
        shared.push({ op: op.id, label: op.label, anchor: op.anchor, sharedWith: anc.sharedWith, note: anc.sharedNote });
      }
      steps.push(step);
    }

    const ok = missing.length === 0 && steps.length >= 2;
    let message = "";
    if (missing.length) message = missingMessage(arch, missing);
    else if (steps.length < 2) {
      message = "Orders of type '" + arch.label + "' resolved to fewer than two stations on this " +
        "layout, so there is no route to walk.";
    }

    const touchesStorage = steps.some((s) => s.anchor === "storage");
    const res = {
      ok: ok,
      id: arch.id,
      routeId: routeIdOf(arch.id, outcomeId) + (o.error ? ":" + o.error.kind + "@" + o.error.op : ""), // v3.54
      outcome: outcomeId,
      outcomeLabel: outcomeId && outs ? (outs.find((x) => x.id === outcomeId) || {}).label || null : null,
      label: arch.label + (o.error ? " - " + errorLabel(o.error.kind) + " at " + o.error.op : ""),
      short: arch.short || arch.label,
      legacy: !!arch.legacy,
      startsInStock: !!arch.startsInStock,
      desc: arch.desc || "",
      ops: ops.slice(),
      steps: steps,
      missing: missing,
      shared: shared,
      touchesStorage: touchesStorage,
      neverStorage: !!arch.neverStorage,
      // The declared invariant HOLDS on the resolved route (asserted in the harness).
      invariantOk: arch.neverStorage ? !touchesStorage : true,
      message: message,
    };
    if (o.error) res.error = o.error; // v3.54: the declared error this branch realises (key only on an error branch)
    return res;
  }

  // Every route an archetype can produce (one per outcome branch).
  function routesOf(archetypeId, anchors) {
    const arch = ARCHETYPE_BY_ID[archetypeId];
    if (!arch) return [resolveRoute(archetypeId, anchors, null)];
    const outs = outcomesOf(arch);
    if (!outs) return [resolveRoute(archetypeId, anchors, null)];
    return outs.map((oc) => resolveRoute(archetypeId, anchors, { outcome: oc.id }));
  }


  /* ==================================================================
   * v3.54 HUMAN ERROR, HONESTLY - declared shares per STEP, dispatched
   * by quota (never a random draw) and realised as BRANCHES the way the
   * returns split is: for every base branch of an archetype and every
   * error kind that applies to one of its operations, one extra route
   * with the rework spliced in (an UNROLLED detour: the operation, its
   * verification, the operation once more) or the write-off appended.
   * An error belongs to a process step and a LATENT CONDITION (the three
   * performance-shaping levers), never to a person: nothing here is keyed
   * to a worker (BetrVG 87(1)6, GDPR Art. 88). The shares are TEACHING
   * VALUES anchored on the only citable generic human-error probabilities
   * (HEART, Williams 1986 / consolidated 2017; SPAR-H, NUREG/CR-6883) -
   * nuclear and process-industry values, not warehouse measurements. A
   * unit errs at most once; a second error on one unit is not modelled.
   * ================================================================== */
  const SAME_OP = "@same";
  const ERROR_KINDS = [
    { kind: "mis-pick", label: "Mis-pick (wrong item or quantity)", ops: ["pick", "case-pick", "piece-pick", "pallet-pick"], share: 0.02,
      rework: ["verify-pick", SAME_OP], disposition: "mismatch_class",
      source: "HEART generic task type: routine, highly practised, rapid task involving relatively low level of skill - nominal unreliability 0.02 (Williams 1986; consolidated 2017). A nuclear-industry anchor used as a TEACHING VALUE, not a warehouse measurement." },
    { kind: "wrong-putaway", label: "Put-away into the wrong slot", ops: ["putaway"], share: 0.003,
      rework: ["verify-put", "putaway"], disposition: "sellable_not_accessible",
      source: "HEART generic task type: restore or shift a system to original or new state following procedures, with some checking - nominal unreliability 0.003. Teaching value." },
    { kind: "damage", label: "Handling damage", ops: ["depalletise", "pack", "palletise"], share: 0.005,
      tail: ["scrap"], disposition: "damaged",
      source: "Teaching value: no generic human-error probability covers handling damage (HEART and SPAR-H give none); to be replaced by a site's own damage log." },
  ];
  // THE PERFORMANCE-SHAPING LEVERS (v3.54: three; v3.67: seven of the eight, and one refusal).
  // SPAR-H (NUREG/CR-6883) modifies its nominal human error probabilities by EIGHT performance-
  // shaping factors; HEART (Williams 1986) by 38 error-producing conditions. Seven of the eight
  // can be declared about a STEP, a WORKPLACE or a SHIFT, and those are the levers below. The
  // eighth - fitness for duty - is defined on the individual and is refused: see PSF_NOT_MODELLED.
  // Each lever names ONE method and ONE factor. `min` is below 1 only where that method publishes
  // a level below 1 on its ACTION worksheet: a lever that can only make a floor worse cannot model
  // a poka-yoke, and three of these can now model one. `max` is the method's worst published level.
  // NOTE, stated wherever the product is shown: the three levers of v3.54 carry HEART's maxima and
  // the four of v3.67 carry SPAR-H's. Multiplying values from two methods is this app's own choice,
  // not something either method provides for; the two disagree (SPAR-H's ergonomics reaches x50
  // where HEART's signal-to-noise reaches x10).
  const PSF = {
    timePressure: { label: "Time pressure", factor: "SPAR-H Available Time / HEART shortage of time", min: 1, max: 11,
      levels: "Worse: HEART's maximum x11. No credit below 1 is offered, because SPAR-H's positive levels for this factor (x0.1 at five times the time the task requires, x0.01 at fifty times) are defined as multiples of a REQUIRED time, and this app declares none.",
      source: "HEART error-producing condition: a shortage of time available for error detection and correction - maximum effect x11" },
    signalToNoise: { label: "Low signal-to-noise (label contrast, lighting, look-alike articles)", factor: "SPAR-H Ergonomics/HMI / HEART low signal-to-noise", min: 0.5, max: 10,
      levels: "Worse: HEART's maximum x10. Better: x0.5, SPAR-H's 'Good' for ergonomics and the human-machine interface on an action task - a label, a light or a pick-to-light display better than nominal.",
      source: "HEART error-producing condition: a low signal-to-noise ratio - maximum effect x10; the credit x0.5 from SPAR-H Ergonomics/HMI level 'Good' (NUREG/CR-6883, action worksheet)" },
    familiarity: { label: "Unfamiliarity (training, a novel or infrequent task)", factor: "SPAR-H Experience/Training / HEART unfamiliarity", min: 0.5, max: 17,
      levels: "Worse: HEART's maximum x17. Better: x0.5, SPAR-H's 'High' experience and training on an action task.",
      source: "HEART error-producing condition: unfamiliarity with a situation which is potentially important but which only occurs infrequently or which is novel - maximum effect x17; the credit x0.5 from SPAR-H Experience/Training level 'High' (NUREG/CR-6883, action worksheet)" },
    stressors: { label: "Workplace stressors (cold store, noise, cramped aisle, glare)", factor: "SPAR-H Stress/Stressors - the ENVIRONMENTAL reading only", min: 1, max: 5,
      levels: "Worse: x2 high, x5 extreme (SPAR-H action worksheet). No credit below 1: the method publishes none.",
      source: "SPAR-H Stress/Stressors (NUREG/CR-6883, action worksheet: High x2, Extreme x5). Declared here in the method's OWN environmental reading and no other: 'Environmental factors often referred to as stressors, such as excessive heat, noise, poor ventilation, or radiation' (2.4.4.2). SPAR-H's peer reviewers asked for the factor to be renamed from Stress to Stressors precisely so that it would not claim knowledge of what a particular individual feels, and the authors agreed. This app declares the WORKPLACE (a cold store at -22 C, a depalletiser's noise, a cramped aisle, glare on a label) and never a state of mind." },
    complexity: { label: "Task complexity (mixed-SKU pallets, multi-touch picks, look-alike families)", factor: "SPAR-H Complexity", min: 1, max: 5,
      levels: "Worse: x2 moderately complex, x5 highly complex (SPAR-H action worksheet). No credit below 1 on the action worksheet: the x0.1 'obvious diagnosis' level belongs to the diagnosis column.",
      source: "SPAR-H Complexity (NUREG/CR-6883, action worksheet: Moderately complex x2, Highly complex x5). 'Complexity refers to how difficult the task is to perform in the given context. Complexity considers both the task and the environment in which it is to be performed' (2.4.4.3) - a property of the step, which is why it can be a lever here." },
    procedures: { label: "Procedures (a written instruction, a scan verification, a check)", factor: "SPAR-H Procedures", min: 1, max: 50,
      levels: "Worse: x5 available but poor, x20 incomplete, x50 not available (SPAR-H action worksheet). No credit below 1 on the action worksheet: the x0.5 'diagnostic / symptom oriented' level belongs to the diagnosis column.",
      source: "SPAR-H Procedures (NUREG/CR-6883, action worksheet: Available but poor x5, Incomplete x20, Not available x50). 'This PSF refers to the existence and use of formal operating procedures for the tasks under consideration' (2.4.4.5) - a property of the step." },
    workProcesses: { label: "Work processes (shift handover, work planning, communication)", factor: "SPAR-H Work Processes", min: 0.5, max: 5,
      levels: "Worse: x5 poor. Better: x0.5 good (SPAR-H action worksheet).",
      source: "SPAR-H Work Processes (NUREG/CR-6883, action worksheet: Poor x5, Nominal x1, Good x0.5). 'Work processes refer to aspects of doing work, including inter-organizational, safety culture, work planning, communication, and management support and policies ... Examples seen in event investigations are problems due to information not being communicated during shift turnover' (2.4.4.8) - a property of the organisation and the shift, not of a person." },
  };
  // THE EIGHTH FACTOR, AND WHY IT IS NOT A LEVER. Kept here so that the refusal is part of the
  // model and travels with every export, rather than being a line in a document nobody reads.
  const PSF_NOT_MODELLED = [{
    factor: "Fitness for duty",
    published: "SPAR-H action worksheet: Unfit P(failure) = 1.0, Degraded fitness x5, Nominal x1 (NUREG/CR-6883).",
    definition: "SPAR-H 2.4.4.7: 'Fitness for duty refers to whether or not the individual performing the task is physically and mentally fit to perform the task at the time. Things that may affect fitness include fatigue, sickness, drug use (legal or illegal), overconfidence, personal problems, and distractions. Fitness for duty includes factors associated with individuals.'",
    refused: "Refused, and of the eight it is the one that must be. Every other factor can be declared about a step, a workplace or a shift; this one is defined on the individual. A lever for it would be an assertion about a named worker's health, and a tool that held or implied one would be a technical device capable of monitoring performance (BetrVG 87(1)6) processing health data (GDPR Art. 9 and Art. 88). The only part of this factor the app models is the part that belongs to a shift rather than to a person: the fatigue curve of v3.66, which reads the minutes since a break assumed staggered and knows nothing about who is standing at the bench.",
  }];
  // SPAR-H's OWN arithmetic for a strongly negative context, quoted from the action worksheet,
  // part C: "When 3 or more negative PSF influences are present, in lieu of the equation above,
  // you must compute a composite PSF score used in conjunction with the adjustment factor.
  // Negative PSFs are present anytime a multiplier greater than 1 is selected."
  //       HEP = NHEP x composite / (NHEP x (composite - 1) + 1)
  // The composite is the product of ALL the assigned levers, the ones below 1 included; the
  // method's nominal HEP is this app's declared share for the step. Below three negative levers
  // the method multiplies, and so does this. The formula cannot reach 1, which is why the method
  // has it; the app's cap is a separate, cruder limit of its own and still binds afterwards.
  // Reproduced by the harness on SPAR-H's own two worked examples (0.81 and 6.41E-5).
  const SPARH_ADJUSTMENT =
    "SPAR-H adjustment factor for three or more negative performance-shaping factors (NUREG/CR-6883, " +
    "action worksheet part C): share x composite / (share x (composite - 1) + 1), used in place of the " +
    "plain product. Below three negative levers the plain product applies. The app's cap binds afterwards.";
  // applyLevers(share, psf, cap) -> what a declared share becomes in the levers' context.
  function applyLevers(share, psf, cap) {
    const capN = Number(cap);
    const c = isFinite(capN) && capN > 0 && capN <= 1 ? capN : ERROR_CAP;
    const s = Math.max(0, Math.min(1, Number(share) || 0));
    let composite = 1, negatives = 0, credits = 0;
    for (const k of Object.keys(PSF)) {
      const v = psf && isFinite(Number(psf[k])) && Number(psf[k]) > 0 ? Number(psf[k]) : 1;
      composite *= v;
      if (v > 1) negatives += 1;
      else if (v < 1) credits += 1;
    }
    const adjusted = negatives >= 3;
    const denom = s * (composite - 1) + 1;
    const raw = adjusted && denom > 0 ? (s * composite) / denom : s * composite;
    return { composite: r6(composite), negatives: negatives, credits: credits, adjusted: adjusted,
      raw: r6(raw), effective: r6(Math.min(c, raw)), capped: raw > c };
  }
  const ERROR_CAP = 0.5;
  const ERRORS_HONESTY =
    "Human error is a what-if: declared shares per process step, realised as branches dispatched by quota (exact to within " +
    "one unit, replayable) - never a random draw and never a person. The shares are teaching values anchored on generic " +
    "human-error probabilities from the nuclear industry (HEART, SPAR-H), not warehouse measurements; seven levers shape " +
    "them - SPAR-H's own adjustment factor replaces their product once three or more stand above nominal - and the cap " +
    "binds last. Fitness for duty is the eighth performance-shaping factor and the one this app refuses: it is defined on " +
    "the individual, not on the step. A rework is one detection and one redo, a damage a write-off; a unit errs at most once. " +
    "Errors belong to a step and a latent condition, and nothing here is keyed to a worker (BetrVG 87(1)6, GDPR Art. 88).";
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  function errorLabel(kind) {
    const d = ERROR_KINDS.find((k) => k.kind === kind);
    return d ? d.label : String(kind);
  }
  // normalizeErrors(spec) -> null (no what-if) or the normalised levers:
  //   spec = true                       every kind at its default share, levers 1
  //   spec = { "mis-pick": 0.02, damage: { share: 0.005 }, psf: { timePressure: 2 }, cap: 0.5 }
  //   a kind that is not named, false, null or 0 is OFF; a share above 1 is clamped;
  //   a lever is clamped into its own [min, max] - below 1 only where the method publishes a level
  //   below 1 (see PSF); effective = min(cap, the levers applied to the share by applyLevers()).
  function normalizeErrors(spec) {
    if (!spec) return null;
    const s = spec === true ? {} : spec;
    const psfIn = (s && s.psf) || {};
    const psf = {}, latent = [];
    let mult = 1;
    const credit = [];
    for (const k of Object.keys(PSF)) {
      const def = PSF[k];
      const raw = Number(psfIn[k]);
      const v = isFinite(raw) && raw > 0 ? Math.min(def.max, Math.max(def.min, raw)) : 1;
      psf[k] = v;
      mult *= v;
      if (v > 1) latent.push(k);
      else if (v < 1) credit.push(k);
    }
    const capRaw = Number(s.cap);
    const cap = isFinite(capRaw) && capRaw > 0 && capRaw <= 1 ? capRaw : ERROR_CAP;
    const kinds = [];
    for (const def of ERROR_KINDS) {
      const raw = spec === true ? true : s[def.kind];
      let share = null;
      if (raw === true) share = def.share;
      else if (typeof raw === "number") share = raw;
      else if (raw && typeof raw === "object" && typeof raw.share === "number") share = raw.share;
      if (!(share > 0)) continue;
      share = Math.min(1, share);
      const applied = applyLevers(share, psf, cap);
      kinds.push({ kind: def.kind, label: def.label, ops: def.ops.slice(), share: r6(share), effective: applied.effective,
        raw: applied.raw, capped: applied.capped,
        disposition: def.disposition, rework: def.rework ? def.rework.slice() : null, tail: def.tail ? def.tail.slice() : null, source: def.source });
    }
    if (!kinds.length) return null;
    const shape = applyLevers(1, psf, cap);
    return { kind: "human-error", kinds: kinds, psf: psf, multiplier: r6(mult), composite: shape.composite,
      negatives: shape.negatives, adjusted: shape.adjusted, adjustment: shape.adjusted ? SPARH_ADJUSTMENT : null,
      latent: latent, credit: credit, cap: cap, honesty: ERRORS_HONESTY };
  }
  // branchesFor(archetypeId, errors) -> the branch list flowsim builds routes from:
  // without errors exactly the static outcome list; with them, per base branch, the
  // base (its share less the error shares) followed by one branch per (kind, step)
  // whose `ops` carry the rework spliced after the step (or the write-off appended)
  // and whose `error` names the kind, the step, the outcome and the latent levers.
  // The legacy spine never branches (it is the byte-identical v3.24 default).
  function branchesFor(archetypeId, errors) {
    const arch = ARCHETYPE_BY_ID[archetypeId];
    const outs = arch ? outcomesOf(arch) : null;
    const base = outs ? outs.map((o) => ({ outcome: o.id, share: o.share })) : [{ outcome: null, share: 1 }];
    if (!arch || arch.legacy || !errors || !Array.isArray(errors.kinds) || !errors.kinds.length) return base;
    const out = [];
    for (const b of base) {
      const ops = opsFor(arch, b.outcome);
      const errs = [];
      for (const k of errors.kinds) for (let i = 0; i < ops.length; i++) if (k.ops.indexOf(ops[i]) >= 0) errs.push({ kind: k, op: ops[i], at: i });
      let total = 0;
      for (const e of errs) total += e.kind.effective;
      const scale = total > 1 ? 1 / total : 1; // the levers can push the sum past one: the base branch then gets nothing, said in the readout
      out.push({ outcome: b.outcome, share: b.share * (1 - total * scale) });
      for (const e of errs) {
        // v3.68: the detour is no longer spliced into an array by hand - it is the walk of a
        // graph whose check edge leads to the verification and whose REWORK edge leads back.
        const spliced = walk(graphOf(arch.id, { error: { kind: e.kind.kind, op: e.op } }), { outcome: b.outcome, error: { kind: e.kind.kind, op: e.op } });
        out.push({ outcome: b.outcome, share: b.share * e.kind.effective * scale, ops: spliced,
          error: { kind: e.kind.kind, op: e.op, disposition: e.kind.disposition, rework: !e.kind.tail, latent: errors.latent.slice() } });
      }
    }
    return out;
  }

  /* ==================================================================
   * resolveAll - the per-archetype FULFILLABILITY REPORT for a layout.
   * Pulls the anchor index from WT.flowsim.anchors (lazy lookup so this
   * module keeps no load-order dependency) unless one is passed in.
   * ================================================================== */
  function anchorsFor(layout, given) {
    if (given) return given;
    if (WT.flowsim && typeof WT.flowsim.anchors === "function") return WT.flowsim.anchors(layout);
    return {};
  }

  function resolveAll(layout, opts) {
    const o = opts || {};
    const anchors = anchorsFor(layout, o.anchors);
    const routes = [], fulfillable = [], unfulfillable = [], messages = [];
    const byArchetype = {};
    for (const a of ARCHETYPES) {
      const rs = routesOf(a.id, anchors);
      const anyOk = rs.some((r) => r.ok);
      byArchetype[a.id] = {
        id: a.id, label: a.label, short: a.short || a.label, legacy: !!a.legacy,
        share: a.share, ops: (a.ops || []).slice(),
        outcomes: (outcomesOf(a) || []).map((x) => ({ id: x.id, label: x.label, share: x.share })),
        ok: anyOk,
        routes: rs.map((r) => r.routeId),
        missing: rs[0] ? rs[0].missing.slice() : [],
        message: anyOk ? "" : (rs[0] ? rs[0].message : ""),
      };
      for (const r of rs) {
        routes.push(r);
        (r.ok ? fulfillable : unfulfillable).push(r.routeId);
      }
      // ONE message per order type, not one per outcome branch - the user
      // cares that returns cannot run, not that both of its branches cannot.
      const m = byArchetype[a.id].message;
      if (!anyOk && m && messages.indexOf(m) < 0) messages.push(m);
    }
    // Which anchors the floor is missing, once, in catalogue order.
    const missingAnchors = [];
    for (const id of Object.keys(ANCHORS)) {
      const pt = anchors[id];
      if (!pt || pt.present === false) missingAnchors.push({ id: id, label: ANCHORS[id].label, element: ANCHORS[id].element, pending: ANCHORS[id].pending || null });
    }
    return {
      kind: "wt-routing-report",
      anchors: anchors,
      routes: routes,
      byArchetype: byArchetype,
      fulfillable: fulfillable,
      unfulfillable: unfulfillable,
      missingAnchors: missingAnchors,
      messages: messages,
      label: SYNTHETIC_LABEL,
    };
  }

  WT.routing = {
    // v3.54 human error, honestly
    ERROR_KINDS: ERROR_KINDS, PSF: PSF, ERROR_CAP: ERROR_CAP, ERRORS_HONESTY: ERRORS_HONESTY, SAME_OP: SAME_OP,
    // v3.67 the rest of SPAR-H: four more levers, one refusal, the method's own adjustment factor
    PSF_NOT_MODELLED: PSF_NOT_MODELLED, SPARH_ADJUSTMENT: SPARH_ADJUSTMENT, applyLevers: applyLevers,
    // v3.68 the route as a declared graph: the list is the walk
    GRAPH_SCHEMA: GRAPH_SCHEMA, EDGE_KINDS: EDGE_KINDS, GRAPH_HONESTY: GRAPH_HONESTY, graphOf: graphOf, walk: walk,
    normalizeErrors: normalizeErrors, branchesFor: branchesFor, errorLabel: errorLabel,
    LEGACY_ID: LEGACY_ID,
    ANCHORS: ANCHORS,
    OPERATIONS: OPERATIONS,
    OPERATION_ORDER: OPERATION_ORDER,
    ARCHETYPES: ARCHETYPES,
    ARCHETYPE_BY_ID: ARCHETYPE_BY_ID,
    SYNTHETIC_LABEL: SYNTHETIC_LABEL,
    // model helpers (pure)
    normalizeMix: normalizeMix,
    defaultMix: defaultMix,
    dispatchSequence: dispatchSequence,
    pickBranch: pickBranch,
    opsFor: opsFor,
    routeIdOf: routeIdOf,
    // the router
    resolveRoute: resolveRoute,
    routesOf: routesOf,
    resolveAll: resolveAll,
  };
})();
