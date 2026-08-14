/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * domain.js - the honest domain model (P1 foundation)
 * ---------------------------------------------------------------------
 * Everything here is a SYNTHETIC, SIMPLIFIED model of real warehouse
 * logistics. Dimensions and characteristics are drawn from public
 * standards and industry references (cited in comments below and in
 * docs/DOMAIN_NOTES.md). Cost/capacity/selectivity figures are
 * relative, order-of-magnitude teaching values - NOT vendor specs and
 * NOT a certification of anything.
 *
 * No frameworks, no build step. Attaches to the global `WT` namespace
 * so the app works when opened directly from disk (file://) as well as
 * over http. Classic script (not an ES module) on purpose.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  /* ------------------------------------------------------------------
   * Units. One grid cell = 1.0 metre. The whole simulator works in
   * metres so numbers stay human-readable.
   * ------------------------------------------------------------------ */
  const METRES_PER_CELL = 1.0;

  /* ------------------------------------------------------------------
   * EURO PALLETS (EPAL / UIC 435-2). Dimensions in millimetres.
   * Sources:
   *   - EPAL (European Pallet Association) pallet range.
   *   - UIC 435-2 (International Union of Railways) load-unit standard.
   *   - Wikipedia "EUR-pallet" summary table (cross-checked).
   * EUR1/2/3/6 are well-established EPAL sizes. EUR4/EUR5 are far less
   * standardised; the values below are commonly quoted by pallet
   * suppliers but vary by source - flagged `standardised:false`.
   * ------------------------------------------------------------------ */
  const PALLETS = [
    // EUR1 = EPAL 1, the classic "Euro pallet". 1200 x 800 mm, ~25 kg.
    { id: "EUR1", label: "EUR1 / EPAL 1", length: 1200, width: 800, mass: 25, standardised: true,
      note: "The classic Euro pallet (EPAL 1). Most common in EU FMCG." },
    // EUR2 = EPAL 2 (a.k.a. UK / industrial). 1200 x 1000 mm.
    { id: "EUR2", label: "EUR2 / EPAL 2", length: 1200, width: 1000, mass: 33, standardised: true,
      note: "1200x1000 mm. Common for heavier/industrial loads." },
    // EUR3 = EPAL 3. 1000 x 1200 mm (EUR2 rotated footprint family).
    { id: "EUR3", label: "EUR3 / EPAL 3", length: 1000, width: 1200, mass: 29, standardised: true,
      note: "1000x1200 mm industrial pallet." },
    // EUR4 - less standardised; ~1300 x 1100 mm quoted by suppliers.
    { id: "EUR4", label: "EUR4 (non-EPAL)", length: 1300, width: 1100, mass: 30, standardised: false,
      note: "~1300x1100 mm. Not an official EPAL/UIC size; dimensions vary by source." },
    // EUR5 - less standardised; ~1140 x 760 mm quoted by suppliers.
    { id: "EUR5", label: "EUR5 (non-EPAL)", length: 1140, width: 760, mass: 20, standardised: false,
      note: "~1140x760 mm. Not an official EPAL/UIC size; dimensions vary by source." },
    // EUR6 = EPAL 6, the half pallet. 800 x 600 mm.
    { id: "EUR6", label: "EUR6 / EPAL 6", length: 800, width: 600, mass: 10, standardised: true,
      note: "Half pallet (800x600 mm). Used for display/retail-ready units." },
  ];

  /* ------------------------------------------------------------------
   * CARTON / BOX / TOTE TYPES (P3 expanded catalogue).
   * Synthetic but plausible EU unit-load sizes (mm). The 600x400 and
   * 400x300 modules tile cleanly onto the 1200x800 EUR1 pallet (the
   * "Euro-modular" footprint family). Masses are assumptions. Totes are
   * reusable plastic containers (KLT-style small-load carriers in
   * spirit) - `tote:true`; original generic sizes, no vendor spec.
   * ------------------------------------------------------------------ */
  const BOXES = [
    { id: "C05", label: "Mini carton", length: 150, width: 100, height: 100, mass: 0.5,
      note: "Small-parts mailer size." },
    { id: "C10", label: "Small carton", length: 200, width: 150, height: 120, mass: 2,
      note: "Common e-commerce small box." },
    { id: "C15", label: "Flat carton", length: 350, width: 250, height: 150, mass: 4,
      note: "Document/flat-goods carton." },
    { id: "C20", label: "Medium carton", length: 400, width: 300, height: 250, mass: 8,
      note: "Euro-modular 400x300 footprint." },
    { id: "C30", label: "Large carton", length: 600, width: 400, height: 300, mass: 15,
      note: "Euro-modular 600x400 footprint." },
    { id: "C40", label: "Bulk carton", length: 600, width: 400, height: 400, mass: 18,
      note: "Tall 600x400; heavy, bottom layers only in practice." },
    { id: "EURO-CASE", label: "Euro case (400x300)", length: 400, width: 300, height: 200, mass: 6,
      note: "Standard Euro-modular case." },
    { id: "TOTE-64", label: "Tote 600x400", length: 600, width: 400, height: 320, mass: 12, tote: true,
      note: "Reusable plastic tote, Euro-modular footprint. Stackable." },
    { id: "TOTE-43", label: "Tote 400x300", length: 400, width: 300, height: 220, mass: 6, tote: true,
      note: "Reusable small-load tote (KLT-style footprint)." },
    { id: "TOTE-HALF", label: "Half tote 300x200", length: 300, width: 200, height: 170, mass: 2.5, tote: true,
      note: "Half-module tote for small parts / kitting." },
  ];

  /* ------------------------------------------------------------------
   * Cartons-per-pallet math. How many cartons of a given type fit on a
   * given EUR pallet: best-of-two-orientations per layer x layers that
   * fit in the usable load height. Load height default 1200 mm (a
   * conservative teaching assumption for a ~1.35 m max load minus
   * unevenness; documented in DOMAIN_NOTES.md). Interlocking/overhang
   * patterns are NOT modelled - this is the simple rectangular fit.
   * ------------------------------------------------------------------ */
  function cartonsPerPallet(boxId, palletId, loadHeightMm) {
    const box = BOXES.find((b) => b.id === boxId) || BOXES[0];
    const pal = palletById(palletId);
    const H = loadHeightMm || 1200;
    const a = Math.floor(pal.length / box.length) * Math.floor(pal.width / box.width);
    const b = Math.floor(pal.length / box.width) * Math.floor(pal.width / box.length);
    const perLayer = Math.max(a, b);
    const layers = Math.max(1, Math.floor(H / box.height));
    return { perLayer, layers, perPallet: perLayer * layers };
  }

  /* ------------------------------------------------------------------
   * PLACEABLE ELEMENTS (the P1 palette).
   *   category "storage" -> contributes pallet positions to the sim.
   *   category "flow"    -> docks, staging, conveyor, push/pull nodes.
   *
   * Footprint is given in grid CELLS (metres). `resizable` elements can
   * have their footprint edited in the properties panel.
   *
   * Storage characteristics (relative teaching values):
   *   density     = pallet positions per m^2 of the element footprint,
   *                 accounting roughly for beam levels & pallet gaps.
   *                 (This footprint is the racking itself; the aisle it
   *                 needs is a separate placed gap - see aisle rule.)
   *   selectivity = fraction of stored pallets directly accessible
   *                 without moving another pallet (1.0 = every pallet).
   *   rotation    = achievable stock rotation (FIFO / LIFO).
   *   costIndex   = relative capital cost per position (1 = cheapest).
   *
   * P3 sim-relevant characteristics (all synthetic, documented in
   * docs/DOMAIN_NOTES.md):
   *   handlingDeltaSec = seconds ADDED to (or, if negative, saved from)
   *                 the base per-line handling time when picking from
   *                 this system. Deep-lane/low-selectivity systems cost
   *                 extra repositioning time; flow-rack pick faces
   *                 present goods and save time.
   *   goodsToPerson + cycleSec = the system delivers the load to the
   *                 operator (AS/RS crane, shuttle): a pick line from it
   *                 adds a machine cycle time instead of walking travel.
   *   pickFace    = carton-level pick-face system; capacity is stated
   *                 in PALLET-EQUIVALENT positions.
   * Sources: general MHE/racking literature; see DOMAIN_NOTES.md. These
   * are illustrative, not quotations.
   *
   * heightM (IFC export, W4): ASSUMED overall height of the element in
   * metres, used as the extrusion depth of its proxy solid in the IFC
   * export (ifc.js). Plausible order-of-magnitude teaching values in
   * line with each system's `levels` - NOT vendor specs, NOT measured;
   * the export marks them as assumptions in the WT_ElementType pset.
   * ------------------------------------------------------------------ */
  const ELEMENTS = {
    "selective-racking": {
      id: "selective-racking", label: "Selective racking", category: "storage",
      w: 6, d: 1, color: "#b84a22", resizable: true,
      density: 2.4, levels: 3, selectivity: 1.0, rotation: "FIFO/LIFO", costIndex: 3, heightM: 6.0,
      desc: "Single-deep adjustable pallet racking. Every pallet directly accessible (100% selective). Needs a working aisle in front. Good FIFO.",
    },
    "block-stack": {
      id: "block-stack", label: "Block-stack zone", category: "storage",
      w: 4, d: 4, color: "#a8763f", resizable: true,
      density: 3.2, levels: 3, selectivity: 0.35, rotation: "LIFO", costIndex: 1, heightM: 4.5,
      handlingDeltaSec: 8,
      desc: "Floor block stacking, no racking. Highest floor density and lowest cost, but LIFO and low selectivity (honeycombing losses). +8 s/line repositioning in the sim.",
    },
    "drive-in": {
      id: "drive-in", label: "Drive-in racking", category: "storage",
      w: 4, d: 4, color: "#96401f", resizable: true,
      density: 3.0, levels: 3, selectivity: 0.25, rotation: "LIFO", costIndex: 2, heightM: 6.0,
      handlingDeltaSec: 10,
      desc: "Deep-lane racking the truck drives into. High density, low cost per position, but LIFO and poor selectivity (~25%): reaching a specific pallet often means digging. +10 s/line in the sim. Best for few SKUs in volume.",
    },
    "double-deep": {
      id: "double-deep", label: "Double-deep racking", category: "storage",
      w: 6, d: 2, color: "#c4552a", resizable: true,
      density: 2.9, levels: 3, selectivity: 0.5, rotation: "FIFO within pairs", costIndex: 4, heightM: 6.0,
      handlingDeltaSec: 6,
      desc: "Two pallets deep; needs a telescopic-fork reach truck. ~20% denser than selective, but only the front pallet of each pair is directly accessible (~50% selectivity). +6 s/line in the sim.",
    },
    "push-back": {
      id: "push-back", label: "Push-back racking", category: "storage",
      w: 4, d: 3, color: "#8c4a2a", resizable: true,
      density: 3.0, levels: 3, selectivity: 0.4, rotation: "LIFO", costIndex: 5, heightM: 6.0,
      handlingDeltaSec: 4,
      desc: "Nested carts on inclined rails, loaded and picked from the same aisle face. Dense, fast face access - but strictly LIFO per lane. +4 s/line in the sim. Avoid for FIFO-critical (shelf-life/batch) SKUs.",
    },
    "pallet-flow": {
      id: "pallet-flow", label: "Pallet-flow racking", category: "storage",
      w: 4, d: 4, color: "#7d6a4a", resizable: true,
      density: 3.4, levels: 3, selectivity: 0.45, rotation: "FIFO", costIndex: 7, heightM: 6.0,
      handlingDeltaSec: -2,
      desc: "Gravity roller lanes: load the back, pick the front - true FIFO. The front pallet is always presented at the pick face (-2 s/line in the sim). High density; higher capital cost; great for high-velocity SKUs.",
    },
    "carton-flow": {
      id: "carton-flow", label: "Carton-flow pick faces", category: "storage",
      w: 3, d: 1, color: "#a37b45", resizable: true, pickFace: true,
      density: 1.6, levels: 4, selectivity: 1.0, rotation: "FIFO", costIndex: 4, heightM: 2.5,
      handlingDeltaSec: -4,
      desc: "Inclined roller shelves presenting cartons at ergonomic pick faces, replenished from the back - FIFO at carton level. Fastest manual picking in the model (-4 s/line). Capacity in pallet-equivalents.",
    },
    "mobile-racking": {
      id: "mobile-racking", label: "Mobile (compact) racking", category: "storage",
      w: 6, d: 4, color: "#6e6259", resizable: true,
      density: 3.8, levels: 4, selectivity: 1.0, rotation: "FIFO/LIFO", costIndex: 8, heightM: 8.0,
      handlingDeltaSec: 15,
      desc: "Racking on powered mobile bases sharing ONE opening aisle. Near block-stack density with 100% selectivity - but you wait for the aisle to open (+15 s/line amortised in the sim). Suits slow movers / cold storage.",
    },
    "cantilever": {
      id: "cantilever", label: "Cantilever racking", category: "storage",
      w: 6, d: 2, color: "#57534e", resizable: true, longGoods: true,
      density: 0.8, levels: 3, selectivity: 1.0, rotation: "FIFO/LIFO", costIndex: 4, heightM: 5.0,
      handlingDeltaSec: 6,
      desc: "Arms on columns, no front uprights - for long goods (pipes, profiles, timber). Low position density in pallet-equivalents; awkward loads (+6 s/line in the sim, usually side-loaded).",
    },
    "asrs": {
      id: "asrs", label: "AS/RS crane aisle", category: "storage",
      w: 8, d: 2, color: "#8c9196", resizable: true,
      density: 5.0, levels: 10, selectivity: 1.0, rotation: "FIFO", costIndex: 10, heightM: 20.0,
      goodsToPerson: true, cycleSec: 45,
      desc: "Automated high-bay aisle: a stacker crane serves double-sided racking. Goods-to-person: a pick line costs a ~45 s machine cycle instead of walking. Highest density (10+ levels) and highest capital cost. Informed by VDI 3564 high-bay design guidance (not certified).",
    },
    "shuttle": {
      id: "shuttle", label: "Shuttle system", category: "storage",
      w: 6, d: 3, color: "#6f7c85", resizable: true,
      density: 4.5, levels: 6, selectivity: 0.9, rotation: "FIFO/LIFO", costIndex: 9, heightM: 12.0,
      goodsToPerson: true, cycleSec: 28,
      desc: "Deep-lane channels served by autonomous shuttle carts + lifts. Goods-to-person (~28 s cycle/line). Denser than AS/RS per channel, per-level throughput scales with shuttle count (simplified to one cycle time here).",
    },
    "mezzanine": {
      id: "mezzanine", label: "Mezzanine pick level", category: "storage",
      w: 6, d: 4, color: "#9a8a6a", resizable: true, pickFace: true,
      density: 2.0, levels: 2, selectivity: 1.0, rotation: "FIFO", costIndex: 5, heightM: 5.0,
      handlingDeltaSec: 5,
      desc: "A steel platform doubling the floor for small-parts shelving above/below. Capacity in pallet-equivalents across both levels; +5 s/line in the sim for the level change (stairs/lift).",
    },
    // SMALL-PARTS / NARROW-AISLE STORAGE (v1.9 "more equipment types").
    // Both are STORAGE systems (category "storage"): they contribute pallet
    // positions via elementCapacity() and form working aisles like the other
    // racking. Honest, synthetic teaching values - no vendor spec, no brand.
    "pick-to-light": {
      id: "pick-to-light", label: "Pick-to-light rack", category: "storage",
      w: 4, d: 1, color: "#d79b28", resizable: true, pickFace: true,
      density: 1.8, levels: 4, selectivity: 1.0, rotation: "FIFO", costIndex: 5, heightM: 2.2,
      handlingDeltaSec: -3,
      desc: "Small-parts shelving whose bays carry light modules that direct the operator to the location and quantity - light-directed picking. Fully selective each/carton pick faces (capacity in pallet-equivalents), fast confirmed picks (-3 s/line in the sim). Replenished from behind/above.",
    },
    "vna": {
      id: "vna", label: "VNA narrow-aisle racking", category: "storage",
      w: 6, d: 1, color: "#a05a2c", resizable: true,
      density: 4.0, levels: 5, selectivity: 1.0, rotation: "FIFO/LIFO", costIndex: 6, heightM: 10.0,
      handlingDeltaSec: 4,
      desc: "Very-narrow-aisle racking served by a guided man-up turret truck. A ~1.6-1.8 m guided aisle gives near-drive-in floor density with 100% selectivity across full height, but the man-up turret cycle is slower per line (+4 s/line in the sim) and the aisle must be wire/rail guided. Informed by DIN 15185 VNA aisle guidance (not certified).",
    },
    "dock-in": {
      id: "dock-in", label: "Dock door (inbound)", category: "flow",
      w: 2, d: 1, color: "#2e7d32", resizable: false, io: "receiving", heightM: 4.5,
      desc: "Inbound (receiving) dock door. Goods arrive here and enter the flow.",
    },
    "dock-out": {
      id: "dock-out", label: "Dock door (outbound)", category: "flow",
      w: 2, d: 1, color: "#c1272d", resizable: false, io: "shipping", heightM: 4.5,
      desc: "Outbound (shipping) dock door. Picked orders leave here - it is the default I/O point for pick travel.",
    },
    "staging": {
      id: "staging", label: "Staging area", category: "flow",
      w: 4, d: 2, color: "#e8b01e", resizable: true, heightM: 1.5,
      desc: "Marshalling / staging buffer for inbound put-away or outbound consolidation. Buffer, not long-term storage.",
    },
    "conveyor": {
      id: "conveyor", label: "Conveyor segment", category: "flow",
      w: 6, d: 1, color: "#8c9196", resizable: true, heightM: 0.9,
      // unitsPerHr: throughput of ONE powered conveyor segment (units/hr).
      // Synthetic order-of-magnitude teaching value, informed by general
      // material-flow throughput practice (VDI 4480 family). Seeds the
      // editable KB entry "auto.conveyor.unitsPerHr" and the automation
      // throughput model (automation.js / WT.wms). NOT a vendor spec.
      unitsPerHr: 180,
      desc: "Powered conveyor segment for internal material flow between zones.",
    },
    "conveyor-curve": {
      id: "conveyor-curve", label: "Curved conveyor (90 deg)", category: "flow",
      // Square footprint so the quarter-arc belt turns cleanly inside it; the
      // `arc` field is the corner the belt wraps around ("tr" top-right, "br"
      // bottom-right, "bl" bottom-left, "tl" top-left) and rotate cycles it.
      w: 3, d: 3, color: "#767c82", resizable: true, heightM: 0.9, arc: "tr",
      // unitsPerHr mirrors the straight conveyor: a curved segment carries the
      // SAME synthetic order-of-magnitude throughput (a turn, not a bottleneck).
      // Informed by general material-flow throughput practice (VDI 4480 family).
      // NOT a vendor spec.
      unitsPerHr: 180,
      desc: "Powered 90-degree curved conveyor segment - turns a belt run around a corner so a layout is not limited to straight runs. Material rides the ARC. Synthetic teaching element, not a vendor spec.",
    },
    "push-station": {
      id: "push-station", label: "Push station", category: "flow",
      w: 2, d: 2, color: "#b07a12", flow: "push", heightM: 1.2,
      desc: "PUSH control point: material is released to storage on a forecast/schedule (make-to-stock replenishment). Can build buffer ahead of demand.",
    },
    "pull-station": {
      id: "pull-station", label: "Pull station", category: "flow",
      w: 2, d: 2, color: "#3d7a45", flow: "pull", heightM: 1.2,
      desc: "PULL control point: material moves only when a downstream order/kanban signal asks for it (make-to-order). Lower inventory, demand-paced.",
    },
    "pack-station": {
      id: "pack-station", label: "Pack station", category: "flow",
      w: 3, d: 2, color: "#a8763f", resizable: true, stage: "pack", heightM: 1.1,
      desc: "Packing/consolidation bench between picking and shipping. A complete outbound chain runs storage → (conveyor) → pack → outbound dock.",
    },
    // TRANSPORT LANES (added for the AI Environment Generator). These are
    // MOVEMENT elements, not storage: they hold ZERO pallet positions
    // (elementCapacity() returns 0 because category !== "storage") but
    // occupy floor cells like an aisle would. Honest, synthetic teaching
    // elements — no vendor spec. The Python generator mirrors the exact
    // type strings ("rgv"/"agv"). Category "flow" so the palette groups
    // them with the other movement elements.
    "rgv": {
      id: "rgv", label: "RGV transport lane", category: "flow",
      w: 4, d: 1, color: "#b8641f", resizable: true, transport: true, heightM: 1.2,
      // movesPerHr: transport moves per hour of ONE rail-guided-vehicle
      // lane. Synthetic teaching value informed by VDI 2510 (AGV systems)
      // transport-cycle framing; seeds "auto.rgv.movesPerHr". NOT measured.
      movesPerHr: 60,
      desc: "Rail-guided-vehicle (RGV) shuttle lane — a powered transport track that carries loads between zones. Transport ONLY: it holds no pallet positions (0 storage capacity) but occupies floor like a reserved lane. Synthetic teaching element, not a vendor spec.",
    },
    "agv": {
      id: "agv", label: "AGV / AMR route", category: "flow",
      w: 4, d: 1, color: "#d17a1a", resizable: true, transport: true, heightM: 0.8,
      // movesPerHr: delivery moves per hour of ONE AGV / AMR route.
      // Informed by VDI 2510 (Automated Guided Vehicle Systems); seeds
      // "auto.agv.movesPerHr". Synthetic teaching value, NOT a vendor spec.
      movesPerHr: 30,
      desc: "Automated-guided-vehicle / autonomous-mobile-robot travel lane. Transport ONLY: 0 storage capacity; occupies floor as a reserved robot path between zones. Synthetic teaching element, not a vendor spec.",
    },
    // HANDLING VEHICLES + SUPPORT / PROCESS / BOUNDARY EQUIPMENT (v1.9 "more
    // equipment types"). All MOVEMENT / handling / processing / boundary
    // elements, NOT storage: they hold ZERO pallet positions (elementCapacity()
    // returns 0 because category !== "storage") but occupy floor cells like a
    // working position would. Category "flow" so the palette groups them with
    // the other movement/support elements. Honest, synthetic teaching elements
    // - no vendor spec, no real brand or model.
    "forklift": {
      id: "forklift", label: "Forklift / reach truck", category: "flow",
      w: 2, d: 2, color: "#e4610f", resizable: false, heightM: 2.5,
      desc: "A materials-handling truck (counterbalance or reach) shown at an operating / parking spot. Handling equipment only: 0 storage capacity; it occupies floor like a working position. The working aisle a real truck needs is placed separately as a gap. Illustrative, not a vendor spec.",
    },
    "charging-station": {
      id: "charging-station", label: "Charging station", category: "flow",
      w: 2, d: 1, color: "#7a8f3a", resizable: false, heightM: 1.4,
      desc: "A battery / opportunity charging point for the AGV/AMR or truck fleet. Support equipment: 0 storage capacity; a fixed servicing position on the floor. Synthetic teaching element, not a vendor spec.",
    },
    "sorter": {
      id: "sorter", label: "Sorter loop (tilt-tray)", category: "flow",
      w: 6, d: 4, color: "#a05a2c", resizable: true, heightM: 1.2,
      desc: "A closed-loop tilt-tray / cross-belt sortation system that carries items past divert chutes to their destination lane. Movement only: 0 storage capacity; occupies floor as a reserved sortation footprint. Distinct from a straight conveyor segment (a routing LOOP, not a point-to-point link). Synthetic teaching element.",
    },
    "stretch-wrap": {
      id: "stretch-wrap", label: "Stretch-wrap / palletiser", category: "flow",
      w: 2, d: 2, color: "#5f5a63", resizable: false, heightM: 2.6,
      desc: "An end-of-line station that builds and stretch-wraps a pallet on a rotating turntable before dispatch. Processing equipment: 0 storage capacity; a fixed working position. Synthetic teaching element, not a vendor spec.",
    },
    "returns-station": {
      id: "returns-station", label: "Returns / QA station", category: "flow",
      w: 3, d: 2, color: "#5d7a5a", resizable: true, heightM: 1.1,
      desc: "A bench for processing customer returns and quality inspection - grade, re-label, then restock or scrap. Processing equipment: 0 storage capacity; a working bench position. Synthetic teaching element.",
    },
    "gate": {
      id: "gate", label: "Gate / sectional door", category: "flow",
      w: 2, d: 1, color: "#78716c", resizable: false, heightM: 4.0,
      desc: "An internal sectional door / barrier that segregates zones (fire, security or temperature separation) - distinct from a loading dock door (no vehicle bay, no inbound/outbound flow direction). Boundary element: 0 storage capacity. Synthetic teaching element.",
    },

    // ==================================================================
    // PRODUCTION / ASSEMBLY (v2.5 FACTORY-A "manufacturing components").
    // Siemens-Plant-Simulation-style MaterialFlow parts so the app models
    // FACTORIES, not just warehouses: a Source emits parts, a Drain
    // consumes them, and a family of Stations processes them. These are
    // the FIRST built-in types to DECLARE a `base` behaviour class - the
    // SAME mechanism library.js custom objects use (storage|conveyor|
    // station|transporter|dock|zone) - so they RIDE the existing flow
    // machinery with NO re-invented sim: Source/Drain map onto the dock
    // ENDPOINT path (a flow source / sink, via elementBase -> "dock" + io)
    // and the Station family onto the station-SERVER path (via elementBase
    // -> "station", the same class the custom-object station uses and the
    // flow sim already treats as a FIFO server). elementBase()/flowsim's
    // baseOf() honour a DECLARED base on a built-in; the ~30 warehouse
    // built-ins declare none, so every base-aware branch stays a strict
    // NO-OP for a warehouse-only layout (behaviour BYTE-IDENTICAL).
    //
    // Category "flow" -> 0 storage positions (like docks / stations /
    // conveyors: elementCapacity() returns 0). Assembly / Dismantle carry
    // an inputs / outputs COUNT now (represented STRUCTURALLY - a station
    // with a BOM count); the deep combine / split flow logic is DEFERRED
    // to the line-simulation build (honest). Honest, synthetic teaching
    // elements - no vendor spec, no real brand or model.
    // ==================================================================
    "mfg-source": {
      id: "mfg-source", label: "Source (parts)", category: "flow",
      base: "dock", io: "receiving", w: 2, d: 2, color: "#3d7a45", resizable: false, heightM: 1.6,
      // emitRatePerHr: work-piece parts EMITTED per hour (inter-arrival =
      // 3600 / rate seconds). Synthetic order-of-magnitude teaching value;
      // the live part-flow reuses the WMS/flow line rate (no separate clock).
      emitRatePerHr: 120,
      desc: "Production SOURCE: emits work-piece PARTS into the line at a set inter-arrival rate (~120 parts/hr here => ~30 s apart). A flow ENTRY endpoint (maps onto the receiving-dock path) - parts spawn here and travel Source -> Station -> ... -> Drain along the connected conveyors, reusing the existing material-flow animation. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "mfg-drain": {
      id: "mfg-drain", label: "Drain / Sink (parts)", category: "flow",
      base: "dock", io: "shipping", w: 2, d: 2, color: "#a52a24", resizable: false, heightM: 1.6,
      sink: true,
      desc: "Production DRAIN / SINK: consumes FINISHED parts and counts throughput - the end of a production line. A flow EXIT endpoint (maps onto the shipping-dock path). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "mfg-station": {
      id: "mfg-station", label: "Station (process)", category: "flow",
      base: "station", w: 3, d: 2, color: "#6f7c85", resizable: true, heightM: 2.2,
      // cycleSec: single-machine process time per part; servers: 1 machine.
      cycleSec: 30, servers: 1,
      desc: "Single-machine process STATION: one server with a cycle time (~30 s/part). Maps onto the station-SERVER flow path (parts pass THROUGH it, like a pack station). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "mfg-parallel-station": {
      id: "mfg-parallel-station", label: "Parallel station (N machines)", category: "flow",
      base: "station", w: 4, d: 3, color: "#5c6975", resizable: true, heightM: 2.2,
      // servers: N identical machines in parallel; stage throughput scales
      // with the machine count (deep per-server queueing deferred to line-sim).
      cycleSec: 30, servers: 3,
      desc: "Parallel STATION: N identical machines working in PARALLEL (servers = 3 here), so the stage throughput scales with the machine count. Maps onto the station-server path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "mfg-assembly": {
      id: "mfg-assembly", label: "Assembly station (join)", category: "flow",
      base: "station", w: 4, d: 3, color: "#a8541f", resizable: true, heightM: 2.4,
      // inputs: how many input parts combine into one (a simple BOM count).
      cycleSec: 40, servers: 1, inputs: 2,
      desc: "Assembly STATION: combines SEVERAL input parts into ONE (a simple BOM - inputs = 2 here) before releasing it downstream. Represented STRUCTURALLY now (a station carrying an inputs count); the deep combine / BOM flow logic is DEFERRED to the line-simulation build. Maps onto the station-server path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "mfg-dismantle": {
      id: "mfg-dismantle", label: "Dismantle station (split)", category: "flow",
      base: "station", w: 4, d: 3, color: "#8c4a2a", resizable: true, heightM: 2.4,
      // outputs: how many parts one input splits into.
      cycleSec: 40, servers: 1, outputs: 2,
      desc: "Dismantle STATION: SPLITS one part into SEVERAL (outputs = 2 here). Represented STRUCTURALLY now (a station carrying an outputs count); the deep split flow logic is DEFERRED to the line-simulation build. Maps onto the station-server path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },

    // ==================================================================
    // FLOW-GEOMETRY COMPONENTS (v3.4 FACTORY-A2). The remaining Siemens-
    // Plant-Simulation-style MaterialFlow FLOW-GEOMETRY objects, rounding
    // out component parity: Converter / AngularConverter (transfer /
    // redirect flow between conveyor lines), Turntable / Turnplate
    // (rotating carrier / track plates), FlowControl (a routing-rule node),
    // Cycle (a repeating closed carrier loop) and Track / TwoLaneTrack
    // (AGV / vehicle guide paths, single + dual lane).
    //
    // Like the FACTORY-A manufacturing built-ins, each DECLARES a `base`
    // behaviour class so it RIDES the existing flow machinery with NO
    // re-invented sim: the conveying / routing nodes map onto the
    // conveyor CONNECTOR path (base "conveyor" -> domain.isConnector +
    // flowsim isTransport/conveyor-cell treat them like a belt segment)
    // and the guide paths onto the transporter path (base "transporter",
    // the SAME movement family as rgv / agv). Every WAREHOUSE built-in
    // still declares no base, so every base-aware branch stays a strict
    // NO-OP for a warehouse-only layout (behaviour BYTE-IDENTICAL; the
    // new types are additive).
    //
    // Category "flow" -> 0 storage positions (elementCapacity() returns 0,
    // like conveyors / docks / stations). FlowControl carries an `outputs`
    // COUNT + a `rule` label and Converter / AngularConverter a `divert`
    // direction - the routing rule is represented STRUCTURALLY now; the
    // deep MULTI-WAY routing / divert-decision flow logic is DEFERRED to a
    // later line-simulation build (honest). Turntable / Turnplate / Cycle
    // ANIMATE deterministically (rotation / loop) seeded from
    // equipmentPhase - NO Date, NO RNG; LOD-gated + reduced-motion-safe.
    // Honest, synthetic teaching elements - no vendor spec, no real brand.
    // ==================================================================
    "converter": {
      id: "converter", label: "Converter (transfer)", category: "flow",
      base: "conveyor", w: 3, d: 3, color: "#7e858c", resizable: true, heightM: 0.9,
      // divert: the lateral direction material can be redirected to; the
      // straight-through path continues in the belt-run direction. unitsPerHr
      // mirrors the straight conveyor (a transfer, not a bottleneck).
      divert: "lateral", unitsPerHr: 180,
      desc: "Flow CONVERTER: transfers / redirects material between conveyor lines - a straight-through belt with a LATERAL divert (a part carries on, or is pushed sideways onto a crossing line). Maps onto the conveyor CONNECTOR path so it passes material THROUGH the chain. The straight-vs-divert routing DECISION is structural now (the deep multi-way divert logic is deferred). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "angular-converter": {
      id: "angular-converter", label: "Angular converter (90 deg transfer)", category: "flow",
      base: "conveyor", w: 3, d: 3, color: "#68707a", resizable: true, heightM: 0.9,
      // divert: a right-angle transfer between two PERPENDICULAR lines - a
      // corner transfer, distinct from the curved belt (a sharp 90 deg hand-off,
      // not a swept arc).
      divert: "90deg", unitsPerHr: 180,
      desc: "ANGULAR converter: a 90-degree transfer between two PERPENDICULAR conveyor lines - a part is handed off at a right angle (a corner transfer, distinct from the swept curved belt). Maps onto the conveyor CONNECTOR path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "turntable": {
      id: "turntable", label: "Turntable (rotating disc)", category: "flow",
      base: "conveyor", w: 3, d: 3, color: "#96751f", resizable: true, heightM: 0.9,
      // rotates: the disc turns a carrier / MU to a new heading. A subtle
      // DETERMINISTIC rotation animates from equipmentPhase (NO Date/RNG).
      rotates: true, unitsPerHr: 180,
      desc: "TURNTABLE: a rotating disc that turns a carrier / load-unit to a new heading before it continues - the through-track ROTATES on the disc (animated deterministically from the sim clock, paused/reduced-motion safe). Maps onto the conveyor CONNECTOR path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "turnplate": {
      id: "turnplate", label: "Turnplate (rotating track plate)", category: "flow",
      base: "conveyor", w: 3, d: 3, color: "#7d6620", resizable: true, heightM: 0.9,
      // rotates: a rotating SQUARE plate carrying a track segment (rotates the
      // whole track section, not just a disc). Animated deterministically.
      rotates: true, unitsPerHr: 180,
      desc: "TURNPLATE: a rotating square PLATE carrying a track / conveyor segment - it swings the whole track section round to align with a different line (animated deterministically; paused/reduced-motion safe). Distinct from the disc turntable (a square plate + track, not a bare disc). Maps onto the conveyor CONNECTOR path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "flow-control": {
      id: "flow-control", label: "Flow control (routing rule)", category: "flow",
      base: "conveyor", w: 2, d: 2, color: "#e4610f", resizable: true, heightM: 1.0,
      // outputs: how many downstream lines the node can route to; rule: the
      // (illustrative) routing policy label. Represented STRUCTURALLY - the
      // deep per-output routing DECISION logic is deferred to the line-sim.
      outputs: 2, rule: "cyclic", unitsPerHr: 180,
      desc: "FLOW CONTROL: a routing-rule node that directs a part to ONE of its outputs (outputs = 2, rule = cyclic here). The rule is represented STRUCTURALLY now (an outputs count + a rule label); the deep multi-way routing DECISION logic is DEFERRED to the line-simulation build. Maps onto the conveyor CONNECTOR path (material passes through). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "cycle": {
      id: "cycle", label: "Cycle (carrier loop)", category: "flow",
      base: "conveyor", w: 6, d: 4, color: "#9a6a5a", resizable: true, heightM: 1.0,
      // loop: a closed carrier loop - a carrier circulates the track endlessly.
      // A DETERMINISTIC carrier animates around the loop (NO Date/RNG).
      loop: true, unitsPerHr: 180,
      desc: "CYCLE: a repeating CLOSED carrier loop - a carrier circulates the track endlessly (animated deterministically around the loop; paused/reduced-motion safe). Distinct from the sorter loop (a plain circulating carrier, no divert chutes). Maps onto the conveyor CONNECTOR path. 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "track": {
      id: "track", label: "Track (AGV guide path)", category: "flow",
      base: "transporter", w: 4, d: 1, color: "#6e6a62", resizable: true, transport: true, heightM: 0.4,
      // lanes: a SINGLE guided lane (the passive guide PATH an AGV / vehicle
      // rides). Same movement family as rgv / agv (base transporter). A carrier
      // marker travels the lane when animating (deterministic, NO Date/RNG).
      lanes: 1,
      desc: "TRACK: a single-lane AGV / vehicle GUIDE PATH - the passive guided route a transporter rides between points (a carrier marker travels the lane when the flow runs). Transport ONLY: 0 storage positions; occupies floor like a reserved lane. Maps onto the transporter path (same family as rgv / agv). Illustrative synthetic model, NOT a vendor spec.",
    },
    "two-lane-track": {
      id: "two-lane-track", label: "Two-lane track (dual guide path)", category: "flow",
      base: "transporter", w: 4, d: 2, color: "#57544e", resizable: true, transport: true, heightM: 0.4,
      // lanes: TWO parallel guided lanes running OPPOSITE directions (a
      // bidirectional dual-lane guide path). Two markers travel opposite ways
      // when animating (deterministic, NO Date/RNG).
      lanes: 2,
      desc: "TWO-LANE TRACK: a dual-lane AGV / vehicle guide path - two parallel guided lanes running OPPOSITE directions (bidirectional). Transport ONLY: 0 storage positions; occupies floor as a reserved twin lane. Maps onto the transporter path (same family as rgv / agv). Illustrative synthetic model, NOT a vendor spec.",
    },

    // ==================================================================
    // FLUIDS / PROCESS INDUSTRY (v3.7 FLUIDS). The LAST Siemens-Plant-
    // Simulation-style component family: the FLUIDS objects for the
    // continuous / batch PROCESS industry (chemicals, food & beverage,
    // water) - a Pipe conveys fluid, a FluidSource supplies it and a
    // FluidDrain consumes it, a Tank stores it, a Mixer blends input
    // fluids, and a Portioner / DePortioner convert between a continuous
    // fluid and discrete portions. This completes the placeable component
    // parity with the screenshots.
    //
    // Like the FACTORY-A / A2 built-ins, each DECLARES a `base` behaviour
    // class so it RIDES the existing flow machinery with NO re-invented sim:
    //   - Pipe        -> "conveyor" (a fluid CONNECTOR: a fluid parcel passes
    //                    THROUGH it, like a belt segment - isConnector /
    //                    isTransport / conveyor-cell all treat it as a belt);
    //   - FluidSource -> "dock" io "receiving" (a flow ENTRY endpoint);
    //   - FluidDrain  -> "dock" io "shipping"  (a flow EXIT endpoint / sink);
    //   - Tank        -> "storage" (it STORES fluid) but category "flow" so
    //                    elementCapacity() returns 0: a tank holds cubic
    //                    metres of FLUID, NOT pallet positions, so it never
    //                    pollutes the pallet KPIs (honest). The fluid it holds
    //                    is a STRUCTURAL capacityM3 + fillPct field;
    //   - Mixer / Portioner / DePortioner -> "station" (the station-SERVER
    //                    path: fluid passes THROUGH, like a process station).
    // Every WAREHOUSE built-in still declares NO base, so every base-aware
    // branch stays a strict NO-OP for a warehouse-only layout (behaviour
    // BYTE-IDENTICAL; the new types are additive).
    //
    // Category "flow" -> 0 storage positions for all seven. The CONTINUOUS-
    // FLOW physics (rate balancing, level / mass dynamics, batch scheduling,
    // deep CFD) is DEFERRED and represented STRUCTURALLY / ILLUSTRATIVELY: a
    // fluid "parcel" rides the EXISTING MU / flow-rendering - an honest
    // SCHEMATIC of flow, NOT validated process simulation. The fill-level,
    // agitator and pipe-fluid-scroll ANIMATIONS are DETERMINISTIC (seeded
    // from equipmentPhase - NO Date, NO RNG), LOD-gated + reduced-motion-safe.
    // Honest, synthetic teaching elements - no vendor spec, no real brand.
    // ==================================================================
    "pipe": {
      id: "pipe", label: "Pipe (fluid conduit)", category: "flow",
      base: "conveyor", w: 6, d: 1, color: "#4a7f9e", resizable: true, heightM: 0.6, fluid: true,
      // flowRateM3h: the continuous throughput of fluid through the conduit
      // (cubic metres per hour). Synthetic order-of-magnitude teaching value;
      // the live parcel rides the EXISTING material-flow line rate (no separate
      // rate solver - continuous-flow balancing is deferred, honest). Kept as
      // a FLUID rate (m3/h), NOT units/hr, so it stays out of the discrete
      // conveyor throughput KPIs (a pipe carries fluid, not unit loads).
      flowRateM3h: 40,
      desc: "Fluid PIPE: a continuous conduit that conveys FLUID (a liquid / slurry) at a set flow rate (~40 m3/h here). Maps onto the conveyor CONNECTOR path so a fluid parcel passes THROUGH the chain, reusing the existing material-flow animation; the fluid scrolls along the pipe (animated deterministically, paused / reduced-motion safe). Continuous-flow physics (rate balancing / CFD) is DEFERRED - represented STRUCTURALLY / illustratively. 0 storage positions. Illustrative synthetic model, NOT a vendor spec, NOT validated process simulation.",
    },
    "fluid-source": {
      id: "fluid-source", label: "Fluid source (supply)", category: "flow",
      base: "dock", io: "receiving", w: 2, d: 2, color: "#2f6e8f", resizable: false, heightM: 1.8, fluid: true,
      // rateM3h: fluid SUPPLIED per hour (a continuous supply). The live fluid
      // flow reuses the WMS / flow line rate (no separate clock).
      rateM3h: 40,
      desc: "Fluid SOURCE: supplies FLUID into the process at a set rate (~40 m3/h here). A flow ENTRY endpoint (maps onto the receiving-dock path) - fluid enters here and travels Source -> Pipe -> ... -> Drain along the connected conduits, reusing the existing material-flow animation. Continuous-flow rate balancing is DEFERRED (structural). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "fluid-drain": {
      id: "fluid-drain", label: "Fluid drain (outfall)", category: "flow",
      base: "dock", io: "shipping", w: 2, d: 2, color: "#1f5470", resizable: false, heightM: 1.8, fluid: true, sink: true,
      desc: "Fluid DRAIN / OUTFALL: consumes FLUID and counts throughput - the end of a fluid process line. A flow EXIT endpoint (maps onto the shipping-dock path). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "tank": {
      id: "tank", label: "Tank (fluid storage)", category: "flow",
      base: "storage", w: 3, d: 3, color: "#7e8c94", resizable: true, heightM: 5.0, fluid: true,
      // capacityM3: the fluid the tank holds (cubic metres); fillPct: the
      // current fill level as a percent (0..100), used to drive the
      // illustrative fill-level animation + the inspector read-out. Represented
      // STRUCTURALLY (a stored volume + level) - the level DYNAMICS / mass
      // balance are DEFERRED. NOTE category "flow" -> elementCapacity() returns
      // 0: a tank holds fluid (m3), NOT pallet positions, so it never pollutes
      // the pallet KPIs (honest). base "storage" is DECLARATIVE (it reads as a
      // storage vessel + seeds a sane clone base); it is inert in the flow sim.
      capacityM3: 200, fillPct: 60,
      desc: "Fluid TANK: stores FLUID (a vessel / silo) - here ~200 m3 at ~60% fill. Declares base \"storage\" so it reads as a storage vessel, but as a FLUID store it contributes 0 PALLET positions (it holds cubic metres, not pallets - honest). The fill level bobs (animated deterministically from the sim clock, paused / reduced-motion safe). Level dynamics / mass balance are DEFERRED (structural). Illustrative synthetic model, NOT a vendor spec.",
    },
    "mixer": {
      id: "mixer", label: "Mixer (blend fluids)", category: "flow",
      base: "station", w: 3, d: 3, color: "#6f7c85", resizable: true, heightM: 2.6, fluid: true,
      // cycleSec: blend time per batch; servers: 1 vessel; inputs: how many
      // input fluids combine into one (a simple blend count). A rotating
      // AGITATOR animates deterministically. Deep blend / recipe / mass-balance
      // logic is deferred (structural).
      cycleSec: 45, servers: 1, inputs: 2,
      desc: "Fluid MIXER: combines SEVERAL input fluids into ONE blended output (inputs = 2 here) in a stirred vessel. Maps onto the station-SERVER flow path (fluid passes THROUGH, like a process station). A rotating AGITATOR spins (animated deterministically, paused / reduced-motion safe). The deep blend / recipe / mass-balance logic is DEFERRED (structural). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "portioner": {
      id: "portioner", label: "Portioner (fluid to portions)", category: "flow",
      base: "station", w: 3, d: 2, color: "#5f6d78", resizable: true, heightM: 2.2, fluid: true,
      // cycleSec: fill time per portion; servers: 1 filling head. Converts a
      // CONTINUOUS fluid into DISCRETE portions (a filler / doser). The
      // continuous -> discrete conversion is represented STRUCTURALLY (deferred).
      cycleSec: 20, servers: 1,
      desc: "PORTIONER: converts a CONTINUOUS fluid into DISCRETE portions (a filler / doser - e.g. bottling). Maps onto the station-SERVER flow path (parts pass THROUGH, like a process station). The continuous -> discrete conversion is represented STRUCTURALLY now (the deep dosing / fill logic is DEFERRED). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
    "deportioner": {
      id: "deportioner", label: "DePortioner (portions to fluid)", category: "flow",
      base: "station", w: 3, d: 2, color: "#546270", resizable: true, heightM: 2.2, fluid: true,
      // cycleSec: empty time per portion; servers: 1 emptying head. Converts
      // DISCRETE portions back into a CONTINUOUS fluid (an emptier / dumper -
      // the inverse of the portioner). Represented STRUCTURALLY (deferred).
      cycleSec: 20, servers: 1,
      desc: "DEPORTIONER: converts DISCRETE portions back into a CONTINUOUS fluid (an emptier / dumper - the inverse of the portioner). Maps onto the station-SERVER flow path. The discrete -> continuous conversion is represented STRUCTURALLY now (deferred). 0 storage positions. Illustrative synthetic model, NOT a vendor spec.",
    },
  };

  /* ------------------------------------------------------------------
   * SLOTTING + PICKING STRATEGIES.
   * P1: random + ABC 80/20 slotting. ABC uses the Pareto principle: a
   * small share of SKUs drives most of the picks (A: top 20% of SKUs ~
   * 80% of pick lines; B: next 30%; C: last 50%). A-items are slotted
   * closest to the I/O point to cut travel.
   * P3 adds PICKING strategies layered on ABC slotting:
   *   zone  - the floor splits into vertical zones, one resident picker
   *           each; an order's lines are picked in parallel per zone and
   *           consolidated (consolidation overhead per order).
   *   batch - N orders are combined into one picking tour; the tour's
   *           travel is shared, with a downstream sort overhead/order.
   *   wave  - orders are released in timed waves; within a wave, larger
   *           batches are built (more sharing) at the cost of a wave
   *           setup overhead. See DOMAIN_NOTES.md for the simplifications.
   * ------------------------------------------------------------------ */
  const STRATEGIES = {
    random: {
      id: "random", label: "Random slotting",
      desc: "SKUs assigned to free locations at random (seeded). Simple, spreads wear, but ignores demand - more travel. Discrete order picking.",
    },
    abc: {
      id: "abc", label: "ABC 80/20 slotting",
      desc: "Popularity-based: fast-moving A-items nearest the I/O, then B, then C. Cuts average pick travel for the same demand. Discrete order picking.",
      classes: [
        { cls: "A", skuShare: 0.2, note: "~20% of SKUs, ~80% of picks" },
        { cls: "B", skuShare: 0.3, note: "~30% of SKUs, ~15% of picks" },
        { cls: "C", skuShare: 0.5, note: "~50% of SKUs, ~5% of picks" },
      ],
    },
    zone: {
      id: "zone", label: "Zone picking (ABC slotted)",
      desc: "The floor is split into 3 vertical zones with a resident picker each. Lines are picked in parallel per zone, then consolidated (+15 s/order; +10 s more if no conveyor chain to shipping). Short, zone-confined tours.",
    },
    batch: {
      id: "batch", label: "Batch picking (ABC slotted)",
      desc: "4 orders are combined into one tour - travel is shared across the batch, then orders are sorted out downstream (+18 s/order sort). Big travel win for small orders.",
    },
    wave: {
      id: "wave", label: "Wave picking (ABC slotted)",
      desc: "Orders release in timed waves of 20; within a wave, batches of 6 share tours (+18 s/order sort, +90 s setup per wave). Best travel sharing, most coordination overhead.",
    },
  };

  /* ------------------------------------------------------------------
   * AISLE-WIDTH GUIDANCE (informed by DIN 15185).
   * DIN 15185-1 addresses the safety of storage installations and
   * working-aisle design. Different trucks need different aisles:
   *   - Counterbalance truck : ~3.5-4.0 m
   *   - Reach truck          : ~2.7-3.0 m
   *   - VNA (man-up turret)   : ~1.5-1.8 m (wire/rail guided)
   * WarehouseTwin uses a single configurable minimum working-aisle gap
   * between facing racking rows. Default reflects a reach-truck aisle.
   * This is design guidance to keep layouts sane - NOT a compliance
   * check or certification.
   * ------------------------------------------------------------------ */
  const AISLE = {
    defaultMinMetres: 2.9,
    presets: [
      { id: "vna", label: "VNA / man-up turret", metres: 1.8 },
      { id: "reach", label: "Reach truck", metres: 2.9 },
      { id: "counterbalance", label: "Counterbalance", metres: 3.8 },
    ],
    note: "Informed by DIN 15185-1 working-aisle guidance. Design aid only, not a compliance check.",
  };

  /* ------------------------------------------------------------------
   * WORKPLACE-GUIDELINE GUIDANCE VALUES (shared by the Compliance Check).
   * These are PUBLISHED guidance figures used to keep a layout sensible.
   * They are "informed by" the named guidelines - they are NOT legally
   * binding limits, and meeting them is NOT a certification, a
   * legal-compliance guarantee, or a Gefaehrdungsbeurteilung (risk
   * assessment). Every value below carries an explicit ASSUMPTION so the
   * derivation is transparent. See compliance.js and docs/DOMAIN_NOTES.md.
   * ------------------------------------------------------------------ */
  const COMPLIANCE = {
    // ASR A1.8 (Verkehrswege / traffic routes). For a one-directional
    // MAIN traffic route used by an industrial truck, ASR A1.8's approach
    // is: clear width >= transport-means width + a 0.5 m lateral safety
    // clearance on EACH side. WarehouseTwin ASSUMES a 1.5 m transport
    // envelope (a counterbalance truck carrying a load): 1.5 + 2*0.5 =
    // 2.5 m. Published guidance value, not a binding limit.
    mainRouteMinMetres: 2.5,
    mainRouteNote:
      "Informed by ASR A1.8: transport-means envelope (assumed 1.5 m) + 2 x 0.5 m lateral safety clearances = 2.5 m one-directional main route.",
    // ASR A2.3 (Fluchtwege / escape routes). Minimum clear escape-route
    // width scales with the number of persons using it (ASR A2.3 table:
    // up to 5 -> 0.875 m; up to 20 -> 1.00 m; up to 200 -> 1.20 m;
    // up to 300 -> 1.80 m; up to 400 -> 2.40 m). WarehouseTwin ASSUMES a
    // warehouse band of up to ~200 persons and uses 1.20 m. ASR A2.3 also
    // advises the travel distance to an exit stay within ~35 m. Published
    // guidance values, not binding limits.
    escapeWidthMinMetres: 1.2,
    escapeMaxTravelMetres: 35,
    escapeNote:
      "Informed by ASR A2.3: clear escape-route width for up to ~200 persons (1.20 m) and a ~35 m maximum travel distance to an exit.",
  };

  /* ------------------------------------------------------------------
   * Helpers.
   * ------------------------------------------------------------------ */
  function elementCapacity(el) {
    // Pallet positions contributed by a storage element instance. The
    // per-type pallet density is a seed in the editable standards
    // knowledge base (knowledge.js -> WT.kb "rack.<type>.density"); we
    // read it fallback-safe so an untouched/absent KB uses the model's own
    // def.density (BYTE-IDENTICAL default), while an edited density flows
    // straight into capacity, fill % and the KPIs.
    const def = ELEMENTS[el.type];
    if (!def || def.category !== "storage") return 0;
    let density = def.density;
    const kb = WT.kb;
    if (kb && typeof kb.get === "function") {
      const v = kb.get("rack." + el.type + ".density");
      if (typeof v === "number" && isFinite(v) && v > 0) density = v;
    }
    const areaM2 = el.w * el.d * METRES_PER_CELL * METRES_PER_CELL;
    return Math.max(0, Math.round(areaM2 * density));
  }

  function palletById(id) {
    return PALLETS.find((p) => p.id === id) || PALLETS[0];
  }

  // The BASE behaviour class of a type - a def DECLARES it via `base`. Two
  // kinds of def declare one: user-defined (library.js) custom objects, and
  // the v2.5 FACTORY-A manufacturing built-ins (Source/Drain -> "dock",
  // the Station family -> "station"). Every WAREHOUSE built-in declares
  // NONE and returns null, so every base-aware branch below is a strict
  // no-op for a warehouse-only layout (behaviour stays BYTE-IDENTICAL - the
  // new types are additive). One of: storage|conveyor|station|transporter|
  // dock|zone. Storage-base types use category "storage" (so capacity /
  // aisles / slotting already treat them), so `base` here only routes the
  // FLOW-side helpers (connectors + dock endpoints).
  function elementBase(type) {
    const def = ELEMENTS[type];
    return def && typeof def.base === "string" ? def.base : null;
  }

  /* ------------------------------------------------------------------
   * Aisle-width guard (informed by DIN 15185). Shared by the canvas
   * editor (app.js), the advisor and the optimizer so there is ONE
   * definition of "too narrow". Returns the storage-element pairs whose
   * facing gap is > 0 but < the minimum working aisle. `gap == 0`
   * (racks back-to-back) is fine; overlap is handled elsewhere.
   * ------------------------------------------------------------------ */
  function facingAislePairs(elements) {
    // Every facing storage-row pair that forms a working aisle (gap > 0),
    // with the gap in metres and the axis the aisle runs along. `axis`
    // "y" = rows stacked vertically, the aisle runs horizontally; "x" =
    // rows side by side, the aisle runs vertically. Back-to-back racks
    // (gap 0) and overlapping racks are not aisles and are excluded.
    const st = (elements || []).filter((e) => (ELEMENTS[e.type] || {}).category === "storage");
    const out = [];
    for (let i = 0; i < st.length; i++) {
      for (let j = i + 1; j < st.length; j++) {
        const a = st[i], b = st[j];
        const oX = a.x < b.x + b.w && b.x < a.x + a.w;
        const oY = a.y < b.y + b.d && b.y < a.y + a.d;
        if (oX && oY) continue; // overlap, not an aisle
        if (oX && !oY) {
          const gap = Math.max(a.y, b.y) - Math.min(a.y + a.d, b.y + b.d);
          if (gap > 0) out.push({ a, b, gapM: gap * METRES_PER_CELL, axis: "y" });
        } else if (oY && !oX) {
          const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
          if (gap > 0) out.push({ a, b, gapM: gap * METRES_PER_CELL, axis: "x" });
        }
      }
    }
    return out;
  }

  // The single definition of "too narrow": a facing rack-row pair whose
  // working gap is below the minimum aisle. Derived from facingAislePairs
  // so the canvas editor, advisor, optimizer and compliance check all
  // agree. Output shape ({a, b, gapM}) is unchanged for its callers.
  function aisleViolations(elements, minAisleMetres) {
    return facingAislePairs(elements)
      .filter((p) => p.gapM < minAisleMetres - 1e-6)
      .map((p) => ({ a: p.a, b: p.b, gapM: p.gapM }));
  }

  /* ------------------------------------------------------------------
   * MATERIAL-FLOW CHAIN ANALYSIS (P3).
   * The logical chain is: dock-in (receive) -> staging -> put-away ->
   * storage -> replenish -> pick -> pack -> dock-out (ship).
   * Elements CONNECT when their footprints touch (share an edge or a
   * corner, i.e. gap 0 on the 1 m grid). Material can pass THROUGH
   * connector elements (conveyor, staging, push/pull stations, pack
   * station); storage systems and dock doors are chain ENDPOINTS.
   *
   * Returns (all deterministic, pure function of the element list):
   *   edges            [{a,b}] element-id pairs that form the chain graph
   *   distToShip       id -> hops to the nearest outbound dock (chain)
   *   distFromReceive  id -> hops from the nearest inbound dock (chain)
   *   outboundCovered  Set of STORAGE ids with a chain path to shipping
   *   inboundCovered   Set of STORAGE ids fed from receiving by chain
   *   warnings         [{code,severity,msg,elId?}] broken-chain findings
   * ------------------------------------------------------------------ */
  const CONNECTOR_TYPES = { conveyor: 1, "conveyor-curve": 1, staging: 1, "push-station": 1, "pull-station": 1, "pack-station": 1 };

  function isConnector(el) {
    if (CONNECTOR_TYPES[el.type]) return true;
    // Custom conveying / station objects pass material THROUGH the chain
    // (same as the built-in conveyor + stations). Custom transporter / dock /
    // zone are endpoints or markings, not connectors. No-op for built-ins.
    const b = elementBase(el.type);
    return b === "conveyor" || b === "station";
  }

  function touching(a, b) {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.d && b.y <= a.y + a.d;
  }

  function analyzeChains(elements) {
    const els = elements || [];
    const byId = {};
    els.forEach((e) => (byId[e.id] = e));
    const isStorageEl = (e) => (ELEMENTS[e.type] || {}).category === "storage";
    const isDock = (e) => e.type === "dock-in" || e.type === "dock-out" || elementBase(e.type) === "dock";

    // Chain edges: touching pairs where at least one side is a connector,
    // plus direct dock<->storage contact (a rack right at the door).
    const edges = [];
    const nbr = {};
    els.forEach((e) => (nbr[e.id] = []));
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (!touching(a, b)) continue;
        const chainy = isConnector(a) || isConnector(b) ||
          (isDock(a) && isStorageEl(b)) || (isDock(b) && isStorageEl(a));
        if (!chainy) continue;
        edges.push({ a: a.id, b: b.id });
        nbr[a.id].push(b.id);
        nbr[b.id].push(a.id);
      }
    }

    // BFS that only passes THROUGH connectors (endpoints terminate).
    function bfs(sources) {
      const dist = {};
      const q = [];
      sources.forEach((e) => { dist[e.id] = 0; q.push(e.id); });
      while (q.length) {
        const id = q.shift();
        const el = byId[id];
        // May expand from a source itself or any connector node.
        if (dist[id] > 0 && !isConnector(el)) continue;
        for (const nid of nbr[id]) {
          if (dist[nid] === undefined) {
            dist[nid] = dist[id] + 1;
            q.push(nid);
          }
        }
      }
      return dist;
    }

    // Outbound / inbound BFS seeds. A user-defined DOCK (base "dock") seeds
    // the same endpoint BFS per its io direction, so custom docks are real
    // flow source/sinks. No-op for built-ins (elementBase returns null).
    const dockDir = (e) => (elementBase(e.type) === "dock" ? (ELEMENTS[e.type].io === "receiving" ? "receiving" : "shipping") : null);
    const distToShip = bfs(els.filter((e) => e.type === "dock-out" || dockDir(e) === "shipping"));
    const distFromReceive = bfs(els.filter((e) => e.type === "dock-in" || dockDir(e) === "receiving"));

    const outboundCovered = new Set();
    const inboundCovered = new Set();
    els.forEach((e) => {
      if (!isStorageEl(e)) return;
      if (distToShip[e.id] !== undefined) outboundCovered.add(e.id);
      if (distFromReceive[e.id] !== undefined) inboundCovered.add(e.id);
    });

    // ---- Broken-chain warnings ------------------------------------
    const warnings = [];
    const connectors = els.filter(isConnector);
    const hasDockOut = els.some((e) => e.type === "dock-out");
    const hasDockIn = els.some((e) => e.type === "dock-in");
    const hasStorage = els.some(isStorageEl);
    const at = (e) => `(${e.x}, ${e.y})`;

    if (hasDockOut && hasStorage && connectors.length && outboundCovered.size === 0) {
      warnings.push({
        code: "no-pick-feed", severity: "high",
        msg: "Outbound dock has no connected pick feed - no storage reaches shipping through the chain, so every order is carried manually.",
      });
    }
    if (hasDockIn && hasStorage && connectors.length && inboundCovered.size === 0) {
      warnings.push({
        code: "no-inbound-chain", severity: "medium",
        msg: "Receiving is not chained to any storage - put-away and replenishment run manually (longer pull replenishment lead time in the sim).",
      });
    }
    for (const c of els.filter((e) => e.type === "conveyor")) {
      if (nbr[c.id].length < 2) {
        warnings.push({
          code: "dangling-conveyor", severity: "medium", elId: c.id,
          msg: `Conveyor at ${at(c)} is ${nbr[c.id].length === 0 ? "connected to nothing" : "connected at only one end"} - the flow dead-ends there.`,
        });
      }
    }
    for (const st of els.filter((e) => e.type === "push-station" || e.type === "pull-station")) {
      if (nbr[st.id].length === 0) {
        warnings.push({
          code: "orphan-station", severity: "low", elId: st.id,
          msg: `${ELEMENTS[st.type].label} at ${at(st)} is not connected to any flow - it controls nothing.`,
        });
      }
    }
    if (outboundCovered.size > 0) {
      const packOnPath = els.some((e) => e.type === "pack-station" && distToShip[e.id] !== undefined);
      if (!packOnPath) {
        warnings.push({
          code: "no-pack-step", severity: "low",
          msg: "The pick chain reaches shipping without a pack station - orders ship unconsolidated (add a Pack station before the outbound dock).",
        });
      }
    }

    return {
      edges,
      distToShip,
      distFromReceive,
      outboundCovered,
      inboundCovered,
      inboundConnected: inboundCovered.size > 0,
      outboundConnected: outboundCovered.size > 0,
      warnings,
    };
  }

  /* ------------------------------------------------------------------
   * PRESETS (P3). One-click illustrative layouts.
   * The MRO preset is an INDEPENDENT, ILLUSTRATIVE layout typical of a
   * large industrial MRO (maintenance/repair/operations) parts
   * distributor, drawn from publicly known patterns of that industry
   * segment (very high SKU count, strong 80/20 demand skew, small-parts
   * pick faces, AS/RS + conveyor spine). It is NOT affiliated with,
   * endorsed by, or a depiction of Wuerth or any real company; no real
   * layout, data, or branding is used.
   * ------------------------------------------------------------------ */
  const PRESETS = {
    "mro-distributor": {
      id: "mro-distributor",
      label: "Industrial MRO distributor (illustrative)",
      desc: "A bigger, realistic layout in the style of an industrial MRO parts distributor: three selective rack rows, deep-lane storage (drive-in, push-back, pallet-flow, double-deep), an AS/RS crane aisle + shuttle system, carton-flow and mezzanine small-parts picking, a conveyor spine with push/pull stations, pack station, staging, and paired inbound/outbound docks. Demand is 80/20-skewed. Independent and illustrative, based on public information about this industry segment - not affiliated with or endorsed by Wuerth or any real company.",
      config: {
        seed: 42, strategy: "abc", orders: 300, skuCount: 240,
        demandSkew: 1.15, flowMode: "pull", minAisleMetres: 2.9,
      },
      elements: [
        { type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
        { type: "dock-in", x: 6, y: 0, w: 2, d: 1 },
        { type: "staging", x: 2, y: 1, w: 6, d: 2 },
        { type: "conveyor", x: 4, y: 3, w: 1, d: 3 },
        { type: "selective-racking", x: 2, y: 6, w: 12, d: 1 },
        { type: "selective-racking", x: 2, y: 10, w: 12, d: 1 },
        { type: "selective-racking", x: 2, y: 14, w: 12, d: 1 },
        { type: "conveyor", x: 14, y: 6, w: 1, d: 11 },
        { type: "drive-in", x: 17, y: 6, w: 4, d: 4 },
        { type: "push-back", x: 17, y: 13, w: 4, d: 3 },
        { type: "conveyor", x: 21, y: 6, w: 1, d: 11 },
        { type: "pallet-flow", x: 24, y: 6, w: 4, d: 4 },
        { type: "conveyor", x: 23, y: 10, w: 1, d: 7 },
        { type: "double-deep", x: 24, y: 13, w: 6, d: 2 },
        { type: "asrs", x: 31, y: 6, w: 8, d: 2 },
        { type: "conveyor", x: 32, y: 8, w: 1, d: 9 },
        { type: "shuttle", x: 33, y: 11, w: 6, d: 3 },
        { type: "push-station", x: 10, y: 15, w: 2, d: 2 },
        { type: "pull-station", x: 34, y: 15, w: 2, d: 2 },
        { type: "conveyor", x: 4, y: 17, w: 32, d: 1 },
        { type: "cantilever", x: 2, y: 18, w: 8, d: 2 },
        { type: "conveyor", x: 15, y: 18, w: 1, d: 1 },
        { type: "mezzanine", x: 13, y: 19, w: 6, d: 4 },
        { type: "conveyor", x: 23, y: 18, w: 1, d: 1 },
        { type: "carton-flow", x: 22, y: 19, w: 4, d: 2 },
        { type: "conveyor", x: 31, y: 18, w: 1, d: 3 },
        { type: "staging", x: 27, y: 21, w: 3, d: 2 },
        { type: "pack-station", x: 30, y: 21, w: 3, d: 2 },
        { type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
        { type: "dock-out", x: 32, y: 23, w: 2, d: 1 },
      ],
    },
  };

  WT.domain = {
    METRES_PER_CELL,
    PALLETS,
    BOXES,
    ELEMENTS,
    STRATEGIES,
    AISLE,
    COMPLIANCE,
    PRESETS,
    elementCapacity,
    elementBase,
    palletById,
    cartonsPerPallet,
    aisleViolations,
    facingAislePairs,
    analyzeChains,
    isConnector,
    // Palette order shown in the UI (storage first, then flow).
    paletteOrder: [
      "selective-racking", "block-stack", "drive-in", "double-deep",
      "push-back", "pallet-flow", "carton-flow", "mobile-racking",
      "cantilever", "asrs", "shuttle", "mezzanine",
      "pick-to-light", "vna",
      "dock-in", "dock-out", "staging", "conveyor", "conveyor-curve",
      "push-station", "pull-station", "pack-station",
      "rgv", "agv",
      "forklift", "charging-station", "sorter", "stretch-wrap",
      "returns-station", "gate",
      // v2.5 FACTORY-A: Production / Assembly manufacturing components.
      "mfg-source", "mfg-drain", "mfg-station", "mfg-parallel-station",
      "mfg-assembly", "mfg-dismantle",
      // v3.4 FACTORY-A2: flow-geometry components (Conveying & Sortation +
      // Transport). Additive; a warehouse-only layout never uses them.
      "converter", "angular-converter", "turntable", "turnplate",
      "flow-control", "cycle", "track", "two-lane-track",
      // v3.7 FLUIDS: process-industry fluid components (Fluids / Process
      // group). Additive; a warehouse-only layout never uses them.
      "pipe", "fluid-source", "fluid-drain", "tank",
      "mixer", "portioner", "deportioner",
    ],
  };
})();
