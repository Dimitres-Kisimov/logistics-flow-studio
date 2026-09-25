/* =====================================================================
 * Logistics Flow Studio - units.js
 * ONE PLACE WHERE A SPEED IS DECLARED (v3.70) -> WT.units
 * ---------------------------------------------------------------------
 * WHY
 *   Until v3.70 a rate or a speed in this app was a bare number in a
 *   PARAMS block, and the conversion between ticks, hours, seconds and
 *   metres was written out by hand at every site that needed it. Three
 *   models each did it their own way, and they disagreed:
 *
 *     - `ticksPerHour` is 60 in flowsim.js and 4 in wms.js.
 *     - the animation's travel speed is 0.35 cells/tick, which with a
 *       one-metre cell and a one-minute tick is 0.35 m/min, about
 *       0.0058 m/s; the pick-travel model walks at 1.2 m/s, which is
 *       72 m/min. The two differ by a factor of about 206 and nothing
 *       in the app reconciled them or said so.
 *     - a conveyor has no speed at all: it is geometry, plus a
 *       dimensionless count, plus a units/hour figure with no length.
 *     - `library.js` accepts a `speedMps` for a custom transporter that
 *       no simulation has ever read.
 *
 * WHAT THIS IS
 *   A declaration and an arithmetic, not a type system. Two halves:
 *
 *   1) THE CONVERSIONS. Small, exact, single-expression functions, each
 *      written in the SAME ORDER as the expression it is meant to stand
 *      for, because floating-point arithmetic is not associative and
 *      `cap * (1/tph)` is not `cap / tph`. A caller adopts one only when
 *      the harness has proven `Object.is` equality on real values.
 *
 *   2) THE REGISTRY. Every rate and speed in the app, with its value,
 *      its unit, who owns it and where it came from. It is AUTHORITATIVE
 *      BY DECLARATION AND ASSERTED BY THE HARNESS: `agrees(id, literal)`
 *      compares the registry with the live module, so a literal edited
 *      without the registry fails verify_units.js. In a repository with
 *      no build step that is the strongest guarantee available, and it is
 *      weaker than a compiler. This file says so rather than implying
 *      more.
 *
 * WHAT IT DOES NOT DO IN THIS RELEASE
 *   It changes NO behaviour and replaces NO call site. Every value here
 *   is a copy of a literal that is still where it was, so every run, run
 *   id, fixture and pinned digest is exactly what it was. Adoption at the
 *   call sites is a later, separately gated step, one site at a time.
 *
 * SOURCE KINDS
 *   Every registered value is `cited`, `teaching` or `measured`, the same
 *   three-valued vocabulary tools/fit_rates.py already writes. Nothing is
 *   unlabelled. A `teaching` value is a number chosen so the model is
 *   instructive; it is not a measurement of any plant.
 *
 * Pure: no DOM, no Date, no Math.random, no dependencies. Classic script
 * on window.WT so it works from file:// like every other module.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const HONESTY =
    "Every rate and speed in this app, with its unit and where it came from. A value is cited, a teaching value, or " +
    "measured on a named source with its n - never unlabelled. The conversions are exact arithmetic written in the same " +
    "order as the expressions they stand for, because floating-point arithmetic is not associative; a caller adopts one " +
    "only where equality has been proven on real values, and the one site where it cannot be is named. The registry is " +
    "AUTHORITATIVE BY DECLARATION AND ASSERTED BY A HARNESS, not enforced by a compiler: this repository has no build " +
    "step, so verify_units.js compares the registry with the live modules and fails when they drift. A rate belongs to a " +
    "bench, a step or a shift - never to a person - and a utilisation computed from one may not be read as an " +
    "individual's performance (BetrVG 87(1)6, GDPR Art. 88).";

  const SOURCE_KINDS = ["cited", "teaching", "measured"];

  /* ---- units and their dimensions ------------------------------------------
   * A conversion is refused across dimensions. The context that makes the
   * conversions possible is stated once: a cell is a metre, a tick is a
   * minute at 60 ticks per hour. Both are declarations of this app, not
   * facts about any plant.
   */
  const UNITS = {
    "units/hr": { dimension: "rate", label: "units per hour" },
    "units/tick": { dimension: "rate", label: "units per tick" },
    "units/shift": { dimension: "rate", label: "units per shift" },
    "s/unit": { dimension: "time-per-unit", label: "seconds per unit" },
    "ticks/unit": { dimension: "time-per-unit", label: "ticks per unit" },
    "m/s": { dimension: "speed", label: "metres per second" },
    "m/min": { dimension: "speed", label: "metres per minute" },
    "cells/tick": { dimension: "speed", label: "grid cells per tick" },
    s: { dimension: "time", label: "seconds" },
    minutes: { dimension: "time", label: "minutes" },
    ticks: { dimension: "time", label: "ticks" },
    hours: { dimension: "time", label: "hours" },
    m: { dimension: "length", label: "metres" },
    cells: { dimension: "length", label: "grid cells" },
    x: { dimension: "ratio", label: "a multiplier" },
    share: { dimension: "ratio", label: "a share of one" },
    count: { dimension: "count", label: "a count" },
  };
  const CONTEXT = {
    ticksPerHour: 60, // flowsim.js PARAMS.ticksPerHour - one tick stands for one minute
    metresPerCell: 1, // domain.js METRES_PER_CELL
    shiftSec: 28800, // process.js DEFAULT_SHIFT_SEC - eight hours
  };

  const isNum = (v) => typeof v === "number" && isFinite(v);

  function quantity(value, unit, source) {
    if (!UNITS[unit]) throw new Error('units: unknown unit "' + unit + '"');
    if (!isNum(value)) throw new Error("units: a quantity needs a finite number, got " + value);
    const s = source || null;
    return Object.freeze({ value: value, unit: unit, dimension: UNITS[unit].dimension, source: s && s.text ? s.text : s, kind: s && s.kind ? s.kind : null });
  }
  const isQuantity = (q) => !!q && typeof q === "object" && typeof q.value === "number" && !!UNITS[q.unit];

  /* ---- the conversions -----------------------------------------------------
   * Each one IS the expression it stands for, in the same order. The comment
   * names the site it was lifted from so a reader can check it.
   */
  const perTick = (unitsPerHr, ticksPerHour) => unitsPerHr / ticksPerHour; //            flowsim.js:943, :1238
  const perHour = (unitsPerTick, ticksPerHour) => unitsPerTick * ticksPerHour; //        the inverse reading
  const ticksPerUnit = (unitsPerTick) => 1 / unitsPerTick; //                            ledger.js:219
  const secondsPerUnit = (unitsPerHr) => 3600 / unitsPerHr; //                           library.js:254 read backwards
  const unitsPerHrFromSeconds = (sec) => 3600 / sec; //                                  library.js:254, wms.js:255, process.js:372
  const minutesPerTick = (ticksPerHour) => 60 / ticksPerHour; //                         ledger.js:71, flowsim.js:1291, app.js:3044
  const takt = (shiftSec, demandPerShift) => shiftSec / Math.max(1, demandPerShift); //  process.js:362
  const cellsPerTickOf = (mps, metresPerCell, ticksPerHour) => (mps * (3600 / ticksPerHour)) / metresPerCell;
  const mpsOf = (cellsPerTick, metresPerCell, ticksPerHour) => (cellsPerTick * metresPerCell) / (3600 / ticksPerHour);

  /* The coefficient of variation of a uniform band, from its endpoints.
   * NOTE, and it is not a pedantic one: 1.3 - 0.7 is 0.6000000000000001 in
   * IEEE-754, so this endpoint form gives 0.17320508075688776 for the band
   * flowsim.js ships, while Math.sqrt(0.03) - the same number by algebra -
   * gives 0.17320508075688773. Only the second squares back to exactly 0.03.
   * The registry carries BOTH, labelled, because which one a caller uses
   * decides whether its arithmetic round-trips. verify_units.js pins both. */
  const cvOfUniform = (lo, hi) => (hi - lo) / (Math.sqrt(12) * ((lo + hi) / 2));
  const varOfUniform = (lo, hi) => ((hi - lo) * (hi - lo)) / 12;

  function to(q, unit, ctx) {
    if (!isQuantity(q)) throw new Error("units: to() needs a quantity");
    if (!UNITS[unit]) throw new Error('units: unknown unit "' + unit + '"');
    const c = Object.assign({}, CONTEXT, ctx || {});
    const from = q.unit;
    if (from === unit) return q.value;
    if (UNITS[from].dimension !== UNITS[unit].dimension) {
      throw new Error("units: refusing to convert " + from + " (" + UNITS[from].dimension + ") to " + unit + " (" + UNITS[unit].dimension + ")");
    }
    const rate = { "units/hr": 1, "units/tick": c.ticksPerHour, "units/shift": 3600 / c.shiftSec };
    const tpu = { "ticks/unit": 1, "s/unit": 1 / (60 / c.ticksPerHour) / 60 };
    // base is m/min: one m/s IS sixty m/min, and one cell/tick is metresPerCell over the tick's minutes
    const speed = { "m/min": 1, "m/s": 60, "cells/tick": c.metresPerCell / (60 / c.ticksPerHour) };
    const time = { minutes: 1, s: 1 / 60, ticks: 60 / c.ticksPerHour, hours: 60 };
    const length = { m: 1, cells: c.metresPerCell };
    const table = { rate: rate, "time-per-unit": tpu, speed: speed, time: time, length: length, ratio: { x: 1, share: 1 }, count: { count: 1 } };
    const t = table[UNITS[from].dimension];
    if (!t || t[from] == null || t[unit] == null) throw new Error("units: no conversion from " + from + " to " + unit);
    return (q.value * t[from]) / t[unit];
  }

  /* ---- the registry -------------------------------------------------------- */
  const REGISTRY = {};
  function register(e) {
    if (!e || !e.id) throw new Error("units: a registry entry needs an id");
    if (REGISTRY[e.id]) throw new Error('units: duplicate registry id "' + e.id + '"');
    if (!UNITS[e.unit]) throw new Error('units: entry "' + e.id + '" has unknown unit "' + e.unit + '"');
    if (SOURCE_KINDS.indexOf(e.kind) < 0) throw new Error('units: entry "' + e.id + '" needs a kind of ' + SOURCE_KINDS.join(" | "));
    if (!isNum(e.value)) throw new Error('units: entry "' + e.id + '" needs a finite value');
    if (!e.owner || !e.source) throw new Error('units: entry "' + e.id + '" needs an owner and a source');
    REGISTRY[e.id] = Object.freeze({ id: e.id, value: e.value, unit: e.unit, dimension: UNITS[e.unit].dimension,
      kind: e.kind, owner: e.owner, source: e.source, label: e.label || e.id, note: e.note || null });
    return REGISTRY[e.id];
  }
  const get = (id) => REGISTRY[id] || null;
  const ids = () => Object.keys(REGISTRY).sort();
  const list = (owner) => ids().map(get).filter((e) => !owner || e.owner === owner);
  const owners = () => { const o = {}; for (const id of ids()) o[REGISTRY[id].owner] = 1; return Object.keys(o).sort(); };
  function describe(id) {
    const e = get(id);
    if (!e) return null;
    return e.label + ": " + e.value + " " + e.unit + " (" + e.kind + ", " + e.owner + ") - " + e.source;
  }
  // The gate the harness uses: does the registry still match the live module?
  const agrees = (id, literal) => { const e = get(id); return !!e && Object.is(e.value, literal); };

  /* A SOURCE SCAN, not a parser: find rate-shaped declarations in a module's
   * text and report the ones the registry does not carry. It reads names, so a
   * rate called something unexpected can hide from it; verify_units.js says so
   * rather than claiming completeness. */
  const RATE_NAME = /([A-Za-z_$][\w$]*(?:PerHr|PerHour|PerTick|PerSec|PerMinute|UnitsHr|MovesPerHr|CyclesPerHr|CycleSec|Mps|TicksPerHour|SecPerUnit))\s*:\s*(-?\d+(?:\.\d+)?)/g;
  function unregistered(sourceText, owner) {
    const out = [];
    const known = {};
    for (const id of ids()) known[id.split(".").pop()] = 1;
    let m;
    RATE_NAME.lastIndex = 0;
    while ((m = RATE_NAME.exec(String(sourceText || ""))) !== null) {
      if (!known[m[1]]) out.push({ name: m[1], value: Number(m[2]), owner: owner || null });
    }
    return out;
  }

  /* =====================================================================
   * WHAT IS DECLARED. Every value below is a COPY of a literal that is
   * still in its own module; nothing here is read by the app in v3.70.
   * ===================================================================== */
  const TEACH = "A teaching value of this app: chosen so the model is instructive, not measured in any plant.";
  const FLOWSIM = "flowsim.js PARAMS";
  const WMS = "wms.js PARAMS";
  const PROCESS = "process.js defaults";
  const DOMAIN = "domain.js ELEMENTS";
  const LIB = "library.js custom-object defaults";

  // ---- the two declarations that make every other conversion meaningful
  register({ id: "flowsim.ticksPerHour", value: 60, unit: "count", kind: "teaching", owner: FLOWSIM,
    label: "Ticks that stand for one hour in the flow simulation", source: "A declaration of this app: one tick stands for one minute.",
    note: "wms.js declares 4 for the same word - a quarter-hour bucket. The two models do not share this constant and never did." });
  register({ id: "domain.metresPerCell", value: 1, unit: "m", kind: "teaching", owner: "domain.js",
    label: "Metres per grid cell", source: "A declaration of this app: one grid cell is one metre.",
    note: "Because a cell is a metre and a tick a minute, cells/tick reads directly as m/min." });

  // ---- flowsim.js
  register({ id: "flowsim.cellsPerTick", value: 0.35, unit: "cells/tick", kind: "teaching", owner: FLOWSIM,
    label: "Base travel speed of a moving unit", source: TEACH,
    note: "0.35 m/min, about 0.0058 m/s. simulation.js walks its picker at 1.2 m/s (72 m/min), about 206 times faster. The two models have never been reconciled; this note is the first place the app says so." });
  register({ id: "flowsim.minStationServicePerTick", value: 0.02, unit: "units/tick", kind: "teaching", owner: FLOWSIM,
    label: "Floor on a station's service rate", source: TEACH, note: "A floor of 50 ticks per unit, so a bench always eventually drains its queue." });
  register({ id: "flowsim.minLineThroughput", value: 8, unit: "units/hr", kind: "teaching", owner: FLOWSIM,
    label: "Floor on line throughput so a sparse layout still animates", source: TEACH });
  register({ id: "flowsim.shipDwellTicks", value: 8, unit: "ticks", kind: "teaching", owner: FLOWSIM,
    label: "Dwell at the outbound dock before a unit retires", source: TEACH });
  register({ id: "flowsim.autoBoostPerLane", value: 0.12, unit: "x", kind: "teaching", owner: FLOWSIM,
    label: "Travel-speed lift per automation lane", source: TEACH, note: "A dimensionless count multiplier, not a conveyor speed. A conveyor has no speed in this model." });
  register({ id: "flowsim.autoFactorMax", value: 2.2, unit: "x", kind: "teaching", owner: FLOWSIM,
    label: "Cap on the automation travel multiplier", source: TEACH });
  register({ id: "flowsim.spawnNoiseLo", value: 0.7, unit: "x", kind: "teaching", owner: FLOWSIM,
    label: "Lower bound of the per-tick arrival ripple", source: TEACH,
    note: "The whole of the arrival variability this model has. Service has none at all." });
  register({ id: "flowsim.spawnNoiseHi", value: 1.3, unit: "x", kind: "teaching", owner: FLOWSIM,
    label: "Upper bound of the per-tick arrival ripple", source: TEACH });
  register({ id: "flowsim.congestQueueThreshold", value: 6, unit: "count", kind: "teaching", owner: FLOWSIM,
    label: "Queue length at which a bench is called congested", source: TEACH });

  // The band's coefficient of variation, both ways, because they differ in the last digit.
  register({ id: "flowsim.arrivalCv.fromEndpoints", value: cvOfUniform(0.7, 1.3), unit: "share", kind: "teaching", owner: FLOWSIM,
    label: "Arrival coefficient of variation, computed from the band endpoints", source: "Derived from flowsim.js spawnNoiseLo / spawnNoiseHi by (hi - lo) / (sqrt(12) x mean).",
    note: "0.17320508075688776. Its square is 0.03000000000000001, not 0.03, because 1.3 - 0.7 is 0.6000000000000001 in IEEE-754." });
  register({ id: "flowsim.arrivalCv.fromVariance", value: Math.sqrt(0.03), unit: "share", kind: "teaching", owner: FLOWSIM,
    label: "Arrival coefficient of variation, computed from the exact variance", source: "Math.sqrt(0.03), the same number by algebra as the endpoint form.",
    note: "0.17320508075688773. This one squares back to exactly 0.03 and satisfies sqrt(3) x cv === 0.3 exactly; the endpoint form does neither. Which form a caller uses decides whether its arithmetic round-trips." });

  // ---- wms.js: the stage rates. Every one of these is hard-coded today with no editable path.
  register({ id: "wms.ticksPerHour", value: 4, unit: "count", kind: "teaching", owner: WMS,
    label: "Ticks that stand for one hour in the stage model", source: "A declaration of this app: a quarter-hour bucket.",
    note: "flowsim.js declares 60 for the same word. Reading one model's tick as the other's is an error this registry exists to make visible." });
  register({ id: "wms.receiveUnitsPerDockHr", value: 45, unit: "units/hr", kind: "teaching", owner: WMS, label: "Receiving rate per inbound dock", source: TEACH });
  register({ id: "wms.shipUnitsPerDockHr", value: 50, unit: "units/hr", kind: "teaching", owner: WMS, label: "Shipping rate per outbound dock", source: TEACH });
  register({ id: "wms.putawayTeamUnitsHr", value: 28, unit: "units/hr", kind: "teaching", owner: WMS, label: "Put-away rate per team", source: TEACH });
  register({ id: "wms.replenTeamUnitsHr", value: 30, unit: "units/hr", kind: "teaching", owner: WMS, label: "Replenishment rate per resource", source: TEACH });
  register({ id: "wms.packUnitsPerStationHr", value: 40, unit: "units/hr", kind: "teaching", owner: WMS, label: "Packing rate per bench", source: TEACH });
  register({ id: "wms.storageBaseUnitsHr", value: 60, unit: "units/hr", kind: "teaching", owner: WMS, label: "Base internal move rate of storage", source: TEACH });
  register({ id: "wms.storageRatePerPosition", value: 0.15, unit: "units/hr", kind: "teaching", owner: WMS, label: "Internal move rate added per pallet position", source: TEACH });
  register({ id: "wms.autoRefUnitsPerHr", value: 1200, unit: "units/hr", kind: "teaching", owner: WMS, label: "Automation served units that equal a full stage lift", source: TEACH });
  register({ id: "wms.stageHandleMin", value: 4, unit: "minutes", kind: "teaching", owner: WMS, label: "Handling latency per stage", source: TEACH });

  // ---- simulation.js: the only real metres per second in the app
  register({ id: "simulation.pickerSpeedMps", value: 1.2, unit: "m/s", kind: "teaching", owner: "simulation.js PARAMS",
    label: "Walking speed in the pick-travel model", source: TEACH,
    note: "The only genuine m/s in the app, and it reaches the pick bench's service rate through orders per hour. It is 206 times the animation's own travel speed and nothing reconciles them." });
  register({ id: "simulation.handlingSecPerLine", value: 12, unit: "s/unit", kind: "teaching", owner: "simulation.js PARAMS", label: "Handling time per pick line", source: TEACH });

  // ---- process.js: the factory line
  register({ id: "process.shiftSec", value: 28800, unit: "s", kind: "teaching", owner: PROCESS, label: "Available production time per shift", source: "Eight hours. " + TEACH });
  register({ id: "process.demandPerShift", value: 480, unit: "count", kind: "teaching", owner: PROCESS, label: "Customer demand per shift", source: TEACH, note: "With the shift above this is a takt of 60 s." });
  register({ id: "process.sourceRatePerHr", value: 120, unit: "units/hr", kind: "teaching", owner: PROCESS, label: "Default emit rate of a source", source: TEACH });
  register({ id: "process.stationCycleSec", value: 30, unit: "s/unit", kind: "teaching", owner: PROCESS, label: "Default station cycle time", source: TEACH });

  // ---- domain.js element rates
  register({ id: "domain.conveyor.unitsPerHr", value: 180, unit: "units/hr", kind: "teaching", owner: DOMAIN, label: "Conveyor throughput", source: TEACH,
    note: "A throughput with no length and no velocity. A conveyor's band speed does not exist in this model." });
  register({ id: "domain.rgv.movesPerHr", value: 60, unit: "units/hr", kind: "teaching", owner: DOMAIN, label: "Rail-guided vehicle moves", source: TEACH });
  register({ id: "domain.agv.movesPerHr", value: 30, unit: "units/hr", kind: "teaching", owner: DOMAIN, label: "Automated guided vehicle moves", source: TEACH });
  register({ id: "domain.mfgSource.emitRatePerHr", value: 120, unit: "units/hr", kind: "teaching", owner: DOMAIN, label: "Emit rate of a manufacturing source", source: TEACH,
    note: "Found by the source scan below rather than by hand - which is the scan earning its keep on its first run." });
  register({ id: "domain.asrs.cycleSec", value: 45, unit: "s/unit", kind: "teaching", owner: DOMAIN, label: "AS/RS cycle", source: TEACH });
  register({ id: "domain.shuttle.cycleSec", value: 28, unit: "s/unit", kind: "teaching", owner: DOMAIN, label: "Shuttle cycle", source: TEACH });

  // ---- library.js custom-object defaults
  register({ id: "library.station.cycleSec", value: 30, unit: "s/unit", kind: "teaching", owner: LIB, label: "Default cycle of a custom station", source: TEACH,
    note: "library.js computes a throughput from it and sets stationServer; flowsim.js reads neither, and lumps a custom station into the packing group at the packing rate split evenly." });
  register({ id: "library.transporter.movesPerHr", value: 30, unit: "units/hr", kind: "teaching", owner: LIB, label: "Default moves of a custom transporter", source: TEACH });
  register({ id: "library.transporter.speedMps", value: 1.2, unit: "m/s", kind: "teaching", owner: LIB, label: "Declared speed of a custom transporter", source: TEACH,
    note: "Editable in the object editor, stored, round-tripped, printed - and read by no simulation. It is display-only metadata today." });

  /* ---- the findings this registry exists to surface -------------------------
   * Kept as data so the generated page and the harness read the same words. */
  const FINDINGS = [
    { id: "tick-disagreement", what: "Two models declare a different number of ticks per hour under the same name",
      detail: "flowsim.js declares 60 (a tick is a minute); wms.js declares 4 (a tick is a quarter hour). Neither reads the other.",
      ids: ["flowsim.ticksPerHour", "wms.ticksPerHour"] },
    { id: "travel-speed-disagreement", what: "The two travel speeds in the app differ by a factor of about 206",
      detail: "The animation moves a unit at 0.35 cells/tick, which is 0.35 m/min or about 0.0058 m/s. The pick-travel model walks at 1.2 m/s, which is 72 m/min. 72 / 0.35 is 205.71428571428572. Reconciling them would change behaviour, so v3.70 states it and changes nothing.",
      ids: ["flowsim.cellsPerTick", "simulation.pickerSpeedMps"] },
    { id: "no-conveyor-speed", what: "A conveyor has no speed",
      detail: "It is geometry that reshapes a path, plus a dimensionless count multiplier capped at 2.2, plus a units/hour figure with no length. Nothing in the app converts a belt length and a band speed into a transit time.",
      ids: ["domain.conveyor.unitsPerHr", "flowsim.autoBoostPerLane", "flowsim.autoFactorMax"] },
    { id: "declared-speed-never-read", what: "A declared transporter speed is never read",
      detail: "library.js accepts metres per second for a custom transporter, stores it and prints it. No simulation consumes it.",
      ids: ["library.transporter.speedMps"] },
    { id: "cv-two-values", what: "The arrival band's coefficient of variation has two values that differ in the last digit",
      detail: "1.3 - 0.7 is 0.6000000000000001 in IEEE-754, so computing the coefficient from the endpoints gives 0.17320508075688776 while the exact-variance route gives 0.17320508075688773. Only the second squares back to exactly 0.03. Which form a caller uses decides whether its arithmetic round-trips.",
      ids: ["flowsim.arrivalCv.fromEndpoints", "flowsim.arrivalCv.fromVariance"] },
    { id: "service-has-no-variability", what: "Service time has no variability at all",
      detail: "The serving loop adds a rate to an accumulator and releases whole units; there is no service-time distribution, so the coefficient of variation of service is zero by construction. The arrival ripple is the only variability the model has.",
      ids: ["flowsim.spawnNoiseLo", "flowsim.spawnNoiseHi"] },
  ];

  /* What the source scan reports and why each one is not a registry entry. Pinned
   * so a genuinely new rate literal cannot hide among the known exceptions. */
  const SCAN_EXPLAINED = [
    { name: "throughputOrdersPerHour", owner: "wms.js", reason: "An accumulator initialised to 0, not a declared rate. The scan reads names, so it cannot tell the difference; this list is where that limit is admitted." },
    { name: "labourPerHour", owner: "analytics.js", reason: "A cost in euros per hour, not a speed. Costs are deliberately outside this registry - analytics.defaultRates owns them and says so." },
  ];

  /* ---- what this release deliberately does not adopt ------------------------
   * Named so a later step does not have to rediscover it. */
  const NOT_ADOPTED = [
    { site: "wms.js capTick", reason: "The stage loop multiplies a capacity by a precomputed 1/ticksPerHour. In floating point cap x (1/tph) is not cap / tph, and the arrival and capacity chains both depend on the existing order. The conversion is declared here and the literal stays." },
    { site: "flowsim.js arrival ripple", reason: "Re-expressing 0.7 + 0.6u as 1 + (2u - 1) x 0.3 is equal by algebra and unequal in floating point for most generator outputs, first at the very first draw. The literal stays character for character; a declared coefficient of variation is a different run with a different id, never the same run re-expressed." },
  ];

  WT.units = {
    HONESTY, SOURCE_KINDS, UNITS, CONTEXT, FINDINGS, NOT_ADOPTED, SCAN_EXPLAINED,
    quantity, isQuantity, to,
    perTick, perHour, ticksPerUnit, secondsPerUnit, unitsPerHrFromSeconds, minutesPerTick, takt,
    cellsPerTickOf, mpsOf, cvOfUniform, varOfUniform,
    REGISTRY, register, get, ids, list, owners, describe, agrees, unregistered,
  };
})();
