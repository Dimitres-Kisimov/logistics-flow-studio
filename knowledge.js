/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * knowledge.js - the EDITABLE, versioned standards knowledge base (P5)
 * ---------------------------------------------------------------------
 * The "knowledge" the app reasons over - the standards-derived numeric
 * parameters and thresholds the Compliance Check, the Advisor, the AI
 * Environment Generator and the capacity model use - collected here as a
 * SINGLE, EDITABLE source of truth the user can view, edit, extend,
 * reset and import/export.
 *
 * Every seed value is the SAME number the code already used (pulled from
 * domain.js where it lives, so the two can never drift) plus its
 * standard / corpus source string and an honest "informed by, NOT a
 * certification" note. The consumers (compliance.js, advisor.js,
 * generate.js, domain.elementCapacity) READ from here through a
 * fallback-safe getter: when this module is absent, or the entry is
 * untouched, they fall back to the original constant, so DEFAULT
 * behaviour is byte-identical to before. Editing a value here visibly
 * changes the result the engines produce - that is the point.
 *
 * HARD HONESTY (mirrors WMS_STANDARDS_CORPUS.md): the values are
 * *informed by* published standards (ISO / DIN / EN / VDI / ASR / FEM)
 * and the project corpus. They are NOT a certification and NOT legally
 * binding. Numbers that live behind a paid standard text are recorded
 * only from official abstracts / reputable secondary sources and remain
 * the user's to verify. Any value the user edits is the user's own
 * responsibility to justify; a passing check never means "compliant".
 *
 * Each entry: { id, category, label, value, unit, source, note,
 *               editable, kind, min, max }.
 *
 * No frameworks, no build step, no network. Classic script attaching to
 * the global `WT` namespace so it works from file:// too. Loads AFTER
 * domain.js (it seeds from the domain constants), BEFORE the consumers
 * run (they read it at call time).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const D = WT.domain || {};

  const KB_VERSION = "wt-kb-1";
  const STORAGE_KEY = "wt-kb-v1"; // localStorage key for user edits (optional)

  // ------------------------------------------------------------------
  // Honest, bilingual banner shared by the panel + meta. Matches the
  // tone of the compliance disclaimer and the corpus honesty rules.
  // ------------------------------------------------------------------
  const HONESTY = {
    en:
      "Informed by public standards (ISO / DIN / EN / VDI / ASR / FEM) and the project standards corpus - these values are NOT a certification and NOT legally binding. Numbers that live behind a paid standard text are recorded only from official abstracts or reputable secondary sources and remain yours to verify against the purchased full text. Any value you edit is your own responsibility to justify; a passing check never means a layout is compliant.",
    de:
      "Orientiert an oeffentlichen Normen (ISO / DIN / EN / VDI / ASR / FEM) und dem Projekt-Normenkorpus - diese Werte sind KEINE Zertifizierung und nicht rechtsverbindlich. Zahlen hinter Bezahlschranken stammen nur aus offiziellen Kurzfassungen oder serioesen Sekundaerquellen und sind vom Nutzer am gekauften Volltext zu pruefen. Jeder geaenderte Wert liegt in Ihrer Verantwortung; ein bestandener Check bedeutet nie, dass eine Anordnung konform ist.",
  };

  // Standard per-entry note.
  const NOTE_INFORMED =
    "Informed by the cited standard - NOT a certification; edits are the user's responsibility to justify.";
  // Note for values whose exact figure lives behind a paywalled clause.
  const NOTE_PAYWALL =
    "The exact clause value is behind the paid standard text (see corpus); this is a public/secondary figure - verify against the full text. Edits are the user's responsibility.";

  const CATEGORIES = [
    { key: "compliance", label: "Compliance thresholds",
      desc: "Guidance values the Compliance Check reasons over (ASR A1.8 traffic routes and working-aisle widths, ASR A2.3 escape routes)." },
    { key: "advisor", label: "Advisor thresholds",
      desc: "Heuristic trigger points the offline Advisor uses to raise suggestions." },
    { key: "generator", label: "Generator profile params",
      desc: "Per-plant-profile working-aisle the AI Environment Generator builds to." },
    { key: "rack", label: "Rack-type parameters",
      desc: "Per storage-system capacity/height assumptions (order-of-magnitude teaching values)." },
    { key: "automation", label: "Automation throughput params",
      desc: "Per automation-system cycle-time / throughput assumptions the automation model (WT.automation) and the WMS capacity layer read (informed by VDI 4480 / VDI 2510)." },
    { key: "delivery", label: "Delivery windows (what-if)",
      desc: "Dock and carrier windows the flow's delivery what-if reads (Simulate -> Live material flow -> Delivery): the inbound period and door-open time, the shipment mode whose lateness shape (a public USAID SCMS delivery dataset, aggregates only) is scaled to plant ticks by a declared teaching parameter, the carrier period, the promised lead, the nominal transit and the OTIF target. Teaching values; the dataset's lanes are international pharmaceutical shipments, not a warehouse's dock." },
    { key: "control", label: "Control tower thresholds",
      desc: "The thresholds the control tower's four teaching rules read (Simulate -> Control tower): how often it evaluates, how long a queue must stay congested, the rework share and the units it needs, the trailer lateness limit, the deliveries the OTIF rule needs, the snooze. The tower proposes and a person decides; it reads aggregates per step and station, never a person." },
    { key: "human-factors", label: "Human factors (error what-if)",
      desc: "Per-step error shares and performance-shaping multipliers the flow's error what-if reads (Simulate -> Live material flow -> Human error). Errors belong to a process step and a latent condition, never to a person; nothing here is keyed to a worker (BetrVG § 87(1)6, GDPR Art. 88). Anchored on HEART / SPAR-H generic values - teaching values, not warehouse measurements." },
  ];

  // ------------------------------------------------------------------
  // SEED entries - the ONE source of truth. Numeric defaults are pulled
  // from domain.js (or a documented literal) so a seed can never drift
  // from the constant the code used before this KB existed.
  // ------------------------------------------------------------------
  const C = D.COMPLIANCE || {};
  const A = D.AISLE || {};
  const seeds = [];
  function seed(e) { seeds.push(e); }

  /* ---- compliance thresholds ---- */
  seed({
    id: "compliance.aisle.min", category: "compliance",
    label: "Min working-aisle width (default truck class)",
    value: num(A.defaultMinMetres, 2.9), unit: "m",
    source: "ASR A1.8 Verkehrswege (2022-03): vehicle-route width = widest transport means or load + a lateral safety margin each side (0.50 m vehicles only, 0.75 m mixed pedestrian/vehicle traffic below 20 km/h) + a meeting allowance of 0.40 m. Reach-truck default; a teaching value between the vehicle-only and mixed-traffic results, not derived from the rule. NOT DIN 15185, which covers floor tolerances and guided-aisle person protection.",
    note: NOTE_PAYWALL, editable: true, kind: "number", min: 0.5, max: 12,
  });
  seed({
    id: "compliance.aisle.warnMargin", category: "compliance",
    label: "Aisle-width WARN margin (meets value but tight)",
    value: 0.25, unit: "m",
    source: "WarehouseTwin derivation (compliance.js): clearance band above the truck-class minimum below which an aisle warns rather than passes.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 0, max: 5,
  });
  seed({
    id: "compliance.trafficRoute.min", category: "compliance",
    label: "Min main traffic-route clearance in front of a dock",
    value: num(C.mainRouteMinMetres, 2.5), unit: "m",
    source: "ASR A1.8 (Verkehrswege / traffic routes), BAuA. Corpus 2.3: vehicle-route width = vehicle/load width + safety margin each side. Assumed 1.5 m envelope + 2x0.5 m = 2.5 m.",
    note: NOTE_PAYWALL, editable: true, kind: "number", min: 0.5, max: 12,
  });
  seed({
    id: "compliance.escapeRoute.width", category: "compliance",
    label: "Min clear escape-route width",
    value: num(C.escapeWidthMinMetres, 1.2), unit: "m",
    source: "ASR A2.3 (Fluchtwege / escape routes), BAuA. Corpus 2.3: clear width for up to ~200 persons = 1.20 m [exact width-per-occupancy table is PW].",
    note: NOTE_PAYWALL, editable: true, kind: "number", min: 0.5, max: 6,
  });
  seed({
    id: "compliance.escapeRoute.travel", category: "compliance",
    label: "Max travel distance to an exit",
    value: num(C.escapeMaxTravelMetres, 35), unit: "m",
    source: "ASR A2.3, BAuA. Corpus 2.3: max escape-route length commonly cited ~35 m [PS] - verify the exact figure against the full text.",
    note: NOTE_PAYWALL, editable: true, kind: "number", min: 5, max: 200,
  });

  /* ---- advisor thresholds ---- */
  seed({
    id: "advisor.fill.highPct", category: "advisor",
    label: "Storage fill: 'almost full' warning at/above",
    value: 95, unit: "%",
    source: "Warehouse operations best-practice (corpus 4 utilization KPIs): high occupancy causes congestion / honeycombing; a common working target is ~85%.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 1, max: 100,
  });
  seed({
    id: "advisor.fill.lowPct", category: "advisor",
    label: "Storage fill: 'under-used' warning below",
    value: 40, unit: "%",
    source: "Warehouse operations best-practice (corpus 4 utilization KPIs): well below target occupancy means paid-for capacity sitting idle.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 1, max: 100,
  });
  seed({
    id: "advisor.lifoShareWarn", category: "advisor",
    label: "LIFO-position share that triggers a FIFO-rotation caution",
    value: 0.35, unit: "fraction",
    source: "Racking-type taxonomy (corpus 2.1): LIFO lanes (drive-in / push-back / block-stack) cannot guarantee FIFO; a material share warrants a rotation caution.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 0, max: 1,
  });
  seed({
    id: "advisor.smallPartsSkuThreshold", category: "advisor",
    label: "SKU count above which carton-flow pick faces are advised",
    value: 120, unit: "SKUs",
    source: "Order-picking practice (corpus 2.4, VDI 3590): high SKU counts of small parts pick fastest from carton-flow lanes.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 1, max: 100000,
  });
  seed({
    id: "advisor.optTravelDeltaPct", category: "advisor",
    label: "Min pick-travel saving to suggest relocating storage",
    value: 2, unit: "%",
    source: "WarehouseTwin heuristic (advisor.js): only surface a golden-zone move when the deterministic optimizer measures at least this saving.",
    note: NOTE_INFORMED, editable: true, kind: "number", min: 0, max: 100,
  });

  /* ---- generator profile working-aisle (mirrors generate.js PROFILES) ---- */
  const GEN_AISLE_SOURCE =
    "Plant-profile working aisle (informed by ASR A1.8 vehicle-route geometry, by truck class: VNA ~1.8 m guided, reach ~2.9-3.0 m, counterbalance ~3.8 m). Synthetic best-practice teaching value.";
  seed({ id: "generator.ecommerce-fulfilment.minAisle", category: "generator",
    label: "E-commerce fulfilment centre - min working aisle", value: 2.9, unit: "m",
    source: GEN_AISLE_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.5, max: 12 });
  seed({ id: "generator.spare-parts-distribution.minAisle", category: "generator",
    label: "Spare-parts distribution centre - min working aisle", value: 1.8, unit: "m",
    source: GEN_AISLE_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.5, max: 12 });
  seed({ id: "generator.automotive-supply.minAisle", category: "generator",
    label: "Automotive supply / JIT centre - min working aisle", value: 3.0, unit: "m",
    source: GEN_AISLE_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.5, max: 12 });
  seed({ id: "generator.cold-chain.minAisle", category: "generator",
    label: "Cold-chain / temperature-controlled DC - min working aisle", value: 1.8, unit: "m",
    source: GEN_AISLE_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.5, max: 12 });

  /* ---- rack-type parameters (density + assumed height), seeded from the
   * domain ELEMENTS so they mirror the model exactly. density is actively
   * read by domain.elementCapacity(); heightM is recorded design metadata
   * (the 2.5D / IFC export default) that travels with your KB. ---- */
  const RACK_DENSITY_SOURCE =
    "domain.js teaching value, informed by the racking-type taxonomy (corpus 2.1): pallet positions per m2 of footprint. Order-of-magnitude, NOT a vendor spec.";
  const RACK_HEIGHT_SOURCE =
    "domain.js assumed overall height (2.5D / IFC export default), in line with each system's levels. Illustrative, NOT measured, NOT a vendor spec.";
  const ELS = D.ELEMENTS || {};
  const storageTypes = Object.keys(ELS).filter((t) => (ELS[t] || {}).category === "storage");
  for (const t of storageTypes) {
    const def = ELS[t];
    if (typeof def.density === "number") {
      seed({
        id: "rack." + t + ".density", category: "rack",
        label: def.label + " - pallet density", value: def.density, unit: "pos/m2",
        source: RACK_DENSITY_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.01, max: 50,
      });
    }
    if (typeof def.heightM === "number") {
      seed({
        id: "rack." + t + ".heightM", category: "rack",
        label: def.label + " - assumed height", value: def.heightM, unit: "m",
        source: RACK_HEIGHT_SOURCE, note: NOTE_INFORMED, editable: true, kind: "number", min: 0.1, max: 60,
      });
    }
  }

  /* ---- automation throughput params (phase P6). These are the editable
   * per-system cycle-time / throughput values the automation model
   * (automation.js -> WT.automation) and the WMS capacity layer read
   * fallback-safe, so an untouched/absent KB reproduces the domain seed
   * exactly (BYTE-IDENTICAL default) while an edited value flows straight
   * into the modeled automation throughput and the stage capacities.
   *
   * SEEDED FROM DOMAIN so they can never drift from the model: AS/RS and
   * shuttle from the goods-to-person machine cycleSec (cycles/hr =
   * round(3600 / cycleSec)); RGV/AGV/conveyor from their domain
   * movesPerHr / unitsPerHr fields. Informed by VDI 4480 (throughput
   * determination for storage/retrieval machines) and VDI 2510 (AGV
   * systems). A transparent cycle-time HEURISTIC - NOT measured, NOT a
   * vendor spec, NOT a certification. ---- */
  const AUTO_SOURCE_ASRS =
    "AS/RS stacker-crane dual-command cycle throughput. Cycles/hr = round(3600 / domain cycleSec ~45 s). Informed by VDI 4480 (throughput determination for storage/retrieval) and VDI 3564 high-bay design. Synthetic teaching value, NOT measured, NOT a vendor spec.";
  const AUTO_SOURCE_SHUTTLE =
    "Shuttle+lift channel cycle throughput. Cycles/hr = round(3600 / domain cycleSec ~28 s). Informed by VDI 4480 (throughput determination for storage/retrieval). Synthetic teaching value, NOT measured, NOT a vendor spec.";
  const AUTO_SOURCE_RGV =
    "Rail-guided-vehicle transport moves per hour per lane (domain movesPerHr). Informed by VDI 2510 (Automated Guided Vehicle Systems) transport-cycle framing. Synthetic teaching value, NOT measured, NOT a vendor spec.";
  const AUTO_SOURCE_AGV =
    "AGV / AMR delivery moves per hour per route (domain movesPerHr). Informed by VDI 2510 (Automated Guided Vehicle Systems). Synthetic teaching value, NOT measured, NOT a vendor spec.";
  const AUTO_SOURCE_CONVEYOR =
    "Powered conveyor segment throughput (domain unitsPerHr). Informed by general material-flow throughput practice (VDI 4480 family). Synthetic teaching value, NOT measured, NOT a vendor spec.";
  const AUTO_NOTE =
    "A transparent, VDI-informed cycle-time heuristic - the user's to verify. NOT measured, NOT a vendor spec, NOT a certification.";
  function cyclesPerHr(type, dfltSec) {
    const def = ELS[type] || {};
    const sec = typeof def.cycleSec === "number" && def.cycleSec > 0 ? def.cycleSec : dfltSec;
    return Math.round(3600 / sec);
  }
  function fieldRate(type, field, dflt) {
    const def = ELS[type] || {};
    return typeof def[field] === "number" && def[field] >= 0 ? def[field] : dflt;
  }
  seed({ id: "auto.asrs.cyclesPerHr", category: "automation",
    label: "AS/RS crane - storage/retrieval cycles per hour", value: cyclesPerHr("asrs", 45), unit: "cycles/hr",
    source: AUTO_SOURCE_ASRS, note: AUTO_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "auto.shuttle.cyclesPerHr", category: "automation",
    label: "Shuttle system - storage/retrieval cycles per hour", value: cyclesPerHr("shuttle", 28), unit: "cycles/hr",
    source: AUTO_SOURCE_SHUTTLE, note: AUTO_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "auto.rgv.movesPerHr", category: "automation",
    label: "RGV transport lane - moves per hour", value: fieldRate("rgv", "movesPerHr", 60), unit: "moves/hr",
    source: AUTO_SOURCE_RGV, note: AUTO_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "auto.agv.movesPerHr", category: "automation",
    label: "AGV / AMR route - moves per hour", value: fieldRate("agv", "movesPerHr", 30), unit: "moves/hr",
    source: AUTO_SOURCE_AGV, note: AUTO_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "auto.conveyor.unitsPerHr", category: "automation",
    label: "Conveyor segment - units per hour", value: fieldRate("conveyor", "unitsPerHr", 180), unit: "units/hr",
    source: AUTO_SOURCE_CONVEYOR, note: AUTO_NOTE, editable: true, kind: "number", min: 1, max: 100000 });

  /* ---- v3.54 human factors: the error what-if's levers. Teaching values; routing.js
     ERROR_KINDS / PSF hold the same numbers (pinned equal in verify_errors.js). ---- */
  const HF_NOTE = "Teaching value anchored on a generic human-error probability from the nuclear / process industries (HEART, Williams 1986, consolidated 2017; SPAR-H, NUREG/CR-6883) - not a warehouse measurement. It belongs to a process step, never to a person; a site replaces it with its own step-level rate.";
  seed({ id: "hf.error.mis-pick", category: "human-factors", label: "Mis-pick share per pick (wrong item or quantity)", value: 0.02, unit: "share",
    source: "HEART generic task type: routine, highly practised, rapid task involving relatively low level of skill - nominal unreliability 0.02 (Williams 1986; consolidated 2017).", note: HF_NOTE, editable: true, kind: "number", min: 0, max: 0.5 });
  seed({ id: "hf.error.wrong-putaway", category: "human-factors", label: "Wrong-slot share per put-away", value: 0.003, unit: "share",
    source: "HEART generic task type: restore or shift a system to original or new state following procedures, with some checking - nominal unreliability 0.003.", note: HF_NOTE, editable: true, kind: "number", min: 0, max: 0.5 });
  seed({ id: "hf.error.damage", category: "human-factors", label: "Handling-damage share per depalletise / pack / palletise", value: 0.005, unit: "share",
    source: "Teaching value: no generic human-error probability covers handling damage (HEART and SPAR-H give none); a placeholder for a site's own damage log.", note: HF_NOTE, editable: true, kind: "number", min: 0, max: 0.5 });
  seed({ id: "hf.psf.timePressure", category: "human-factors", label: "Time pressure multiplier (1 = none)", value: 1, unit: "x",
    source: "HEART error-producing condition: a shortage of time available for error detection and correction - maximum effect x11.", note: HF_NOTE, editable: true, kind: "number", min: 1, max: 11 });
  seed({ id: "hf.psf.signalToNoise", category: "human-factors", label: "Low signal-to-noise multiplier (label contrast, lighting, look-alike articles; 1 = none)", value: 1, unit: "x",
    source: "HEART error-producing condition: a low signal-to-noise ratio - maximum effect x10.", note: HF_NOTE, editable: true, kind: "number", min: 1, max: 10 });
  seed({ id: "hf.psf.familiarity", category: "human-factors", label: "Unfamiliarity multiplier (training, a novel or infrequent task; 1 = none)", value: 1, unit: "x",
    source: "HEART error-producing condition: unfamiliarity with a situation which is potentially important but which only occurs infrequently or which is novel - maximum effect x17.", note: HF_NOTE, editable: true, kind: "number", min: 1, max: 17 });
  seed({ id: "hf.error.cap", category: "human-factors", label: "Cap on any effective error share", value: 0.5, unit: "share",
    source: "WarehouseTwin choice: the levers' product cannot push a step's share above one in two; when the cap binds the readout says so.", note: HF_NOTE, editable: true, kind: "number", min: 0.01, max: 1 });

  /* ---- v3.55 delivery windows: the what-if's levers (teaching values; the lateness SHAPE comes from data/scms-delivery.js) ---- */
  const DL_NOTE = "Teaching value for the delivery what-if. The lateness shape comes from the USAID SCMS delivery history (aggregates only, data/scms-delivery.json); the scale to plant ticks, the periods, the promised lead and the nominal transit are choices, not measurements.";
  seed({ id: "delivery.inbound.periodTicks", category: "delivery", label: "Inbound trailer period (ticks between scheduled trailers)", value: 120, unit: "ticks",
    source: "WarehouseTwin choice: one scheduled trailer every two plant hours at 60 ticks per hour.", note: DL_NOTE, editable: true, kind: "number", min: 10, max: 100000 });
  seed({ id: "delivery.inbound.openTicks", category: "delivery", label: "Door open time per trailer (ticks)", value: 30, unit: "ticks",
    source: "WarehouseTwin choice: half an hour of unloading at 60 ticks per hour.", note: DL_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "delivery.inbound.modeIndex", category: "delivery", label: "Shipment mode whose lateness shape is used (0 Air, 1 Air Charter, 2 Ocean, 3 Truck, 4 not captured)", value: 3, unit: "index",
    source: "The modes of data/scms-delivery.json in its order; 3 = Truck, the mode of a road-served dock.", note: DL_NOTE, editable: true, kind: "number", min: 0, max: 4 });
  seed({ id: "delivery.scaleTicksPerDay", category: "delivery", label: "Ticks per dataset day (the scale of the lateness shape)", value: 60, unit: "ticks/day",
    source: "WarehouseTwin choice: one day of the international dataset's lateness becomes one plant hour (60 ticks) - a teaching scaling, so the shape shows on a shift's clock.", note: DL_NOTE, editable: true, kind: "number", min: 1, max: 10000 });
  seed({ id: "delivery.outbound.periodTicks", category: "delivery", label: "Carrier departure period (ticks)", value: 240, unit: "ticks",
    source: "WarehouseTwin choice: a carrier every four plant hours.", note: DL_NOTE, editable: true, kind: "number", min: 10, max: 100000 });
  seed({ id: "delivery.promisedLeadTicks", category: "delivery", label: "Promised lead from order to customer (ticks)", value: 480, unit: "ticks",
    source: "WarehouseTwin choice: eight plant hours from spawn to the customer's door.", note: DL_NOTE, editable: true, kind: "number", min: 1, max: 1000000 });
  seed({ id: "delivery.transitTicks", category: "delivery", label: "Nominal transit from departure to customer (ticks; the lateness shape is added)", value: 120, unit: "ticks",
    source: "WarehouseTwin choice: two plant hours of nominal transit; the dataset's lateness shape (scaled) is added on top.", note: DL_NOTE, editable: true, kind: "number", min: 0, max: 1000000 });
  seed({ id: "delivery.otif.target", category: "delivery", label: "On-time-in-full target (share of delivered orders)", value: 0.95, unit: "share",
    source: "A commonly quoted OTIF target in logistics guides - not a standard, not a measurement; the control tower (v3.56) compares against it.", note: DL_NOTE, editable: true, kind: "number", min: 0, max: 1 });

  /* ---- v3.59 the plant's own rates: the site's trailer log (a site profile from tools/fit_rates.py sets these;
   * 0 trailers = not measured, the SCMS shape applies). Ticks: the simulation's tick is one minute at 60 ticks per hour. */
  const SITE_NOTE = "Set by a site profile (tools/fit_rates.py) from the plant's own trailer log - nearest-rank quantiles of arrived minus scheduled in minutes; aggregates per trailer, never per person. With delivery.site.n = 0 the delivery what-if uses the USAID SCMS lateness shape instead.";
  const SITE_SRC = "Not measured (0): the delivery what-if uses the USAID SCMS lateness shape (data/scms-delivery.json) until a site profile sets this from the plant's own trailer log.";
  seed({ id: "delivery.site.n", category: "delivery", label: "Site trailer log: trailers measured (0 = not measured, the SCMS shape applies)", value: 0, unit: "trailers", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: 0, max: 1000000000 });
  seed({ id: "delivery.site.latenessMin", category: "delivery", label: "Site lateness, minimum (ticks = minutes; negative = early)", value: 0, unit: "ticks", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: -1000000, max: 1000000 });
  seed({ id: "delivery.site.latenessP10", category: "delivery", label: "Site lateness, 10th percentile (ticks)", value: 0, unit: "ticks", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: -1000000, max: 1000000 });
  seed({ id: "delivery.site.latenessMedian", category: "delivery", label: "Site lateness, median (ticks)", value: 0, unit: "ticks", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: -1000000, max: 1000000 });
  seed({ id: "delivery.site.latenessP90", category: "delivery", label: "Site lateness, 90th percentile (ticks)", value: 0, unit: "ticks", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: -1000000, max: 1000000 });
  seed({ id: "delivery.site.latenessMax", category: "delivery", label: "Site lateness, maximum (ticks)", value: 0, unit: "ticks", source: SITE_SRC, note: SITE_NOTE, editable: true, kind: "number", min: -1000000, max: 1000000 });

  /* ---- v3.56 control tower: the rules' thresholds (teaching values; control.js DEFAULTS hold the same numbers) ---- */
  const CT_NOTE = "Teaching threshold for a control-tower rule; the tower proposes, a person decides. Edit it and the next run evaluates with it.";
  seed({ id: "control.evalEveryTicks", category: "control", label: "Evaluate every n ticks", value: 10, unit: "ticks", source: "WarehouseTwin choice: ten ticks between evaluations.", note: CT_NOTE, editable: true, kind: "number", min: 1, max: 10000 });
  seed({ id: "control.queue.sustainTicks", category: "control", label: "Queue congestion: ticks a queue must stay at or above the congestion threshold", value: 30, unit: "ticks", source: "WarehouseTwin choice: half an hour at 60 ticks per hour before a queue is called sustained.", note: CT_NOTE, editable: true, kind: "number", min: 0, max: 100000 });
  seed({ id: "control.rework.maxShare", category: "control", label: "Rework burden: the reworked-or-scrapped share of units through the error-prone steps above which the tower proposes", value: 0.01, unit: "share", source: "WarehouseTwin choice: one in a hundred.", note: CT_NOTE, editable: true, kind: "number", min: 0, max: 1 });
  seed({ id: "control.rework.minUnits", category: "control", label: "Rework burden: units through the error-prone steps before the rule may fire", value: 20, unit: "units", source: "WarehouseTwin choice: twenty units before a share is worth a proposal.", note: CT_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "control.inbound.lateTicks", category: "control", label: "Inbound late: a trailer later than this many ticks triggers the rule", value: 60, unit: "ticks", source: "WarehouseTwin choice: an hour late at 60 ticks per hour.", note: CT_NOTE, editable: true, kind: "number", min: 0, max: 100000 });
  seed({ id: "control.otif.minDeliveries", category: "control", label: "OTIF below target: delivered orders before the rule may fire", value: 20, unit: "orders", source: "WarehouseTwin choice: twenty delivered orders before a share is worth a proposal (the target is delivery.otif.target).", note: CT_NOTE, editable: true, kind: "number", min: 1, max: 100000 });
  seed({ id: "control.search.minGainHalfWidths", category: "control", label: "Lever search: the best combination's OTIF gain must exceed this many half-widths of the wider 95 % interval", value: 1, unit: "x", source: "WarehouseTwin choice: a gain inside the confidence interval is no gain; one half-width (v3.62).", note: CT_NOTE, editable: true, kind: "number", min: 0, max: 10 });
  seed({ id: "control.snoozeTicks", category: "control", label: "Snooze: ticks before a snoozed rule may propose again", value: 120, unit: "ticks", source: "WarehouseTwin choice: two hours at 60 ticks per hour.", note: CT_NOTE, editable: true, kind: "number", min: 1, max: 100000 });

  // ------------------------------------------------------------------
  // Build the store. `defaults` is a frozen id -> default-value map;
  // `store` is the live, editable id -> entry map. Custom (user) rules
  // are tracked in insertion order so export is stable + round-trips.
  // ------------------------------------------------------------------
  const seedOrder = seeds.map((e) => e.id);
  const seedIndex = {};
  seeds.forEach((e, i) => (seedIndex[e.id] = i));
  const defaults = {};
  const store = {};
  const customOrder = [];
  for (const e of seeds) {
    defaults[e.id] = e.value;
    store[e.id] = cloneEntry(e);
  }
  Object.freeze(defaults);

  // ------------------------------------------------------------------
  // Small helpers.
  // ------------------------------------------------------------------
  function num(v, dflt) { return typeof v === "number" && isFinite(v) ? v : dflt; }
  function cloneEntry(e) {
    const out = {
      id: e.id, category: e.category, label: e.label, value: e.value, unit: e.unit,
      source: e.source, note: e.note, editable: e.editable !== false,
      kind: e.kind || "number",
      min: typeof e.min === "number" ? e.min : undefined,
      max: typeof e.max === "number" ? e.max : undefined,
    };
    if (e.measured && typeof e.measured.label === "string") out.measured = { label: e.measured.label, n: e.measured.n, source: e.measured.source == null ? null : e.measured.source }; // v3.59
    return out;
  }
  function isSeed(id) { return Object.prototype.hasOwnProperty.call(seedIndex, id); }

  // ------------------------------------------------------------------
  // validate(id, raw) -> { ok, value?, error? }. Numeric entries reject
  // non-numeric and out-of-range (negative unless the entry allows it);
  // text rules accept any non-empty string.
  // ------------------------------------------------------------------
  function validate(id, raw) {
    const e = store[id];
    if (!e) return { ok: false, error: "unknown entry: " + id };
    if (e.editable === false) return { ok: false, error: "entry is read-only: " + id };
    if (e.kind === "text") {
      const s = raw == null ? "" : String(raw);
      if (!s.trim()) return { ok: false, error: "value must not be empty" };
      return { ok: true, value: s };
    }
    // numeric
    if (raw === "" || raw === null || raw === undefined || (typeof raw === "boolean")) {
      return { ok: false, error: "value must be a number" };
    }
    const v = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!isFinite(v)) return { ok: false, error: "value must be a number" };
    const lo = typeof e.min === "number" ? e.min : 0;
    if (v < lo) return { ok: false, error: "value must be >= " + lo };
    if (typeof e.max === "number" && v > e.max) return { ok: false, error: "value must be <= " + e.max };
    return { ok: true, value: v };
  }

  // ------------------------------------------------------------------
  // Public API.
  // ------------------------------------------------------------------
  function get(id) {
    const e = store[id];
    return e ? e.value : undefined;
  }
  function entry(id) {
    const e = store[id];
    return e ? cloneEntry(e) : null;
  }
  function set(id, value) {
    const r = validate(id, value);
    if (!r.ok) return false;
    store[id].value = r.value;
    persist();
    return true;
  }
  // addRule(entry) - add a user-defined fact/rule. Returns the stored id
  // (auto-namespaced under "custom." when the caller gives no id) or null.
  function addRule(input) {
    if (!input || typeof input !== "object") return null;
    let id = input.id ? String(input.id) : "custom." + slug(input.label || "rule") + "." + (customOrder.length + 1);
    // Never let a rule silently overwrite a seed entry.
    if (isSeed(id)) return null;
    if (store[id]) {
      // de-dupe id
      let n = 2;
      while (store[id + "-" + n]) n++;
      id = id + "-" + n;
    }
    const kind = input.kind === "text" ? "text" : "number";
    let value = input.value;
    if (kind === "number") {
      value = Number(value);
      if (!isFinite(value)) return null;
    } else {
      value = value == null ? "" : String(value);
      if (!value.trim()) return null;
    }
    const e = cloneEntry({
      id: id,
      category: input.category && catExists(input.category) ? input.category : "custom",
      label: input.label ? String(input.label) : id,
      value: value, unit: input.unit ? String(input.unit) : "",
      source: input.source ? String(input.source) : "User-defined rule (added in-app).",
      note: input.note ? String(input.note) : "User-defined - the user's own responsibility to justify. NOT a certification.",
      editable: true, kind: kind,
      min: typeof input.min === "number" ? input.min : (kind === "number" ? 0 : undefined),
      max: typeof input.max === "number" ? input.max : undefined,
    });
    store[id] = e;
    customOrder.push(id);
    persist();
    return id;
  }
  function catExists(key) { return CATEGORIES.some((c) => c.key === key) || key === "custom"; }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "rule";
  }

  // reset(id?) - restore one entry (or, with no id, the whole KB) to its
  // seeded default. Custom rules are removed on a full reset.
  function reset(id) {
    if (id == null) {
      for (const sid of seedOrder) store[sid] = cloneEntry(seeds[seedIndex[sid]]);
      for (const cid of customOrder.splice(0)) delete store[cid];
      profileInfo = null; // v3.59
      persist();
      return true;
    }
    if (isSeed(id)) { store[id] = cloneEntry(seeds[seedIndex[id]]); persist(); return true; }
    // resetting a custom rule removes it
    const ci = customOrder.indexOf(id);
    if (ci !== -1) { customOrder.splice(ci, 1); delete store[id]; persist(); return true; }
    return false;
  }

  // list(category?) - the entries for the panel, in a stable order
  // (seeds in seed order, then custom rules in insertion order).
  function list(category) {
    const ids = seedOrder.concat(customOrder);
    const out = [];
    for (const id of ids) {
      const e = store[id];
      if (!e) continue;
      if (category && e.category !== category) continue;
      out.push(cloneEntry(e));
    }
    return out;
  }

  // exportJson() / importJson() - round-trip the whole KB so the user can
  // save / share / version it. Deterministic: no timestamps, stable order.
  function exportJson() {
    return JSON.stringify(profileInfo ? { version: KB_VERSION, entries: list(), profile: profileInfo } : { version: KB_VERSION, entries: list() }, null, 2); // v3.59: the applied site profile rides along
  }
  function importJson(str) {
    let data;
    try { data = typeof str === "string" ? JSON.parse(str) : str; }
    catch (err) { return { ok: false, error: "not valid JSON: " + err.message, applied: 0, added: 0 }; }
    if (data && data.schema === PROFILE_SCHEMA) return applyProfile(data); // v3.59: a site profile is an overlay, not a replacement
    if (!data || !Array.isArray(data.entries)) {
      return { ok: false, error: "missing an 'entries' array", applied: 0, added: 0 };
    }
    reset(); // back to seed defaults, drop existing custom rules
    let applied = 0, added = 0;
    const errors = [];
    for (const e of data.entries) {
      if (!e || typeof e.id !== "string") { errors.push("skipped an entry with no id"); continue; }
      if (isSeed(e.id)) {
        if (set(e.id, e.value)) { applied++; if (e.measured && typeof e.measured.label === "string") store[e.id].measured = { label: e.measured.label, n: e.measured.n, source: e.measured.source == null ? null : e.measured.source }; }
        else errors.push("rejected value for " + e.id);
      } else {
        const id = addRule(e);
        if (id) added++;
        else errors.push("could not add rule " + e.id);
      }
    }
    if (data.profile && typeof data.profile === "object" && data.profile.schema === PROFILE_SCHEMA) { profileInfo = data.profile; persist(); } // v3.59
    return { ok: errors.length === 0, applied: applied, added: added, errors: errors };
  }


  // ------------------------------------------------------------------
  // v3.59 the plant's own rates: a SITE PROFILE (wt-site-profile/v1, written by
  // tools/fit_rates.py from recorded events and a trailer log) is an OVERLAY:
  // only the fitted human-factors and delivery.site entries change, each
  // stamped `measured` with its label "measured on <source>, n = ..." (shown
  // above the teaching default); everything else stays; reset(id) / reset()
  // restore the teaching value and drop the stamp. Aggregates per step and
  // per trailer, never per person - the tool cannot be pointed at one.
  // ------------------------------------------------------------------
  const PROFILE_SCHEMA = "wt-site-profile/v1";
  let profileInfo = null;
  const fittable = (id) => isSeed(id) && (id.indexOf("hf.error.") === 0 || id.indexOf("delivery.site.") === 0);
  function applyProfile(p) {
    if (!p || typeof p !== "object" || p.schema !== PROFILE_SCHEMA || !p.values || typeof p.values !== "object") {
      return { ok: false, error: "not a " + PROFILE_SCHEMA + " document", applied: 0, added: 0, measured: 0, skipped: [] };
    }
    const skipped = [];
    let measured = 0;
    for (const id of Object.keys(p.values)) {
      const v = p.values[id];
      if (!fittable(id)) { skipped.push(id + ": not a fittable entry (hf.error.* or delivery.site.*)"); continue; }
      if (!v || typeof v.value !== "number" || !(v.n >= 1) || typeof v.label !== "string" || v.label.indexOf("measured on ") !== 0) { skipped.push(id + ": needs a numeric value, n >= 1 and a label starting with 'measured on'"); continue; }
      if (!set(id, v.value)) { skipped.push(id + ": value " + v.value + " rejected (" + (validate(id, v.value).error || "out of range") + ")"); continue; }
      store[id].measured = { label: v.label, n: v.n, source: typeof p.site === "string" && p.site ? p.site : (p.fitted_from && Array.isArray(p.fitted_from.documents) ? p.fitted_from.documents.join(", ") : null) };
      measured++;
    }
    if (measured) profileInfo = { schema: p.schema, site: typeof p.site === "string" ? p.site : null, tool: typeof p.tool === "string" ? p.tool : null, fitted_from: p.fitted_from || null, measured: measured };
    persist();
    return { ok: skipped.length === 0 && measured > 0, applied: measured, added: 0, measured: measured, skipped: skipped, error: measured ? undefined : "no value applied" };
  }
  function profile() { return profileInfo ? JSON.parse(JSON.stringify(profileInfo)) : null; }
  // ------------------------------------------------------------------
  // Optional persistence (guarded). In Node harnesses window.localStorage
  // is absent, so the KB is purely in-memory there. In the browser, user
  // edits survive a reload. Never throws.
  // ------------------------------------------------------------------
  function persist() {
    try {
      const ls = window.localStorage;
      if (!ls) return;
      // Only persist a DELTA from defaults (edited seeds + custom rules).
      const changed = list().filter((e) => !isSeed(e.id) || e.value !== defaults[e.id] || e.measured); // v3.59: a measured value equal to the default keeps its stamp
      if (!changed.length && !profileInfo) { ls.removeItem(STORAGE_KEY); return; }
      ls.setItem(STORAGE_KEY, JSON.stringify(profileInfo ? { version: KB_VERSION, entries: changed, profile: profileInfo } : { version: KB_VERSION, entries: changed }));
    } catch (_) { /* storage unavailable / full - stay in-memory */ }
  }
  function loadPersisted() {
    try {
      const ls = window.localStorage;
      if (!ls) return;
      const raw = ls.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) return;
      for (const e of data.entries) {
        if (!e || typeof e.id !== "string") continue;
        if (isSeed(e.id)) { if (set(e.id, e.value) && e.measured && typeof e.measured.label === "string") store[e.id].measured = { label: e.measured.label, n: e.measured.n, source: e.measured.source == null ? null : e.measured.source }; } // v3.59: the stamp survives a reload
        else addRule(e);
      }
      if (data.profile && typeof data.profile === "object" && data.profile.schema === PROFILE_SCHEMA) profileInfo = data.profile;
    } catch (_) { /* ignore corrupt persisted state */ }
  }

  const meta = {
    version: KB_VERSION,
    honesty: HONESTY,
    categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label, desc: c.desc })),
    seededCount: seeds.length,
    // convenience for a panel banner
    disclaimer: HONESTY.en,
  };

  WT.kb = {
    defaults: defaults,
    meta: meta,
    get: get,
    entry: entry,
    set: set,
    validate: validate,
    addRule: addRule,
    reset: reset,
    list: list,
    exportJson: exportJson,
    importJson: importJson,
    applyProfile: applyProfile, // v3.59 the plant's own rates
    profile: profile,
    PROFILE_SCHEMA: PROFILE_SCHEMA,
    categories: meta.categories,
    // internal helpers exposed for the panel/tests
    isSeed: isSeed,
  };

  // Restore any persisted user edits (browser only; no-op in Node).
  loadPersisted();
})();
