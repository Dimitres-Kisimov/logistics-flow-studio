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
      id: "qc", label: "Quality-control bench", element: "returns-station",
      legacy: false, strict: true,
      sharedWith: "returns-station",
      sharedNote:
        "Quality control currently borrows the Returns / QA station (whose documented job is grade + inspect). " +
        "R2 adds a DEDICATED goods-in QC bench so inbound checking and returns grading stop sharing one bench.",
      note: "Goods-in sampling and outbound / export checking.",
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
        "Palletising currently borrows the Stretch-wrap / palletiser element (its own label names both jobs). " +
        "R2 splits build-the-pallet from wrap-the-pallet into separate stations.",
      note: "Building the outbound pallet before it is wrapped.",
    },
    depalletise: {
      id: "depalletise", label: "Depalletiser", element: null,
      legacy: false, strict: true, pending: "R2",
      note: "Breaking an inbound pallet down into cases. NO element type exists in v3.25 - R2 adds it.",
    },
    vas: {
      id: "vas", label: "Value-add / kitting bench", element: null,
      legacy: false, strict: true, pending: "R2",
      note: "Kitting, labelling, bundling, gift-wrap. NO element type exists in v3.25 - R2 adds it.",
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

  function opsFor(arch, outcomeId) {
    const base = (arch.ops || []).slice();
    if (!arch.outcomes || !arch.outcomes.length) return base;
    const oc = arch.outcomes.find((o) => o.id === outcomeId) || arch.outcomes[0];
    return base.concat(oc.ops || []);
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
      return '"' + m.label + '" needs a ' + a.label +
        " - place a " + (a.element || a.label) + " on the floor";
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
    const ops = opsFor(arch, outcomeId);
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
      if (anc.sharedWith) {
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
    return {
      ok: ok,
      id: arch.id,
      routeId: routeIdOf(arch.id, outcomeId),
      outcome: outcomeId,
      outcomeLabel: outcomeId && outs ? (outs.find((x) => x.id === outcomeId) || {}).label || null : null,
      label: arch.label,
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
