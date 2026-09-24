/* =====================================================================
 * Logistics Flow Studio - people.js
 * LEARNING AND FATIGUE, DECLARED (v3.66): the two human-factors effects
 * the deep dive's gap 11 named, as curves on a STEP and a SHIFT.
 * ---------------------------------------------------------------------
 * WHY
 *   Every station in this simulation is a server with a fixed rate. Grosse,
 *   Glock, Jaber and Neumann (IJPR 2015) reviewed the order-picking planning
 *   literature and found that almost none of it represents the person doing
 *   the work: a model whose benches never learn and never tire predicts the
 *   throughput of a plant with no people in it. v3.54 added the first human
 *   factor (error, with three HEART-anchored levers). This adds the two the
 *   deep dive listed as documented-only: LEARNING and FATIGUE.
 *
 * THE TWO CURVES (both multiply the SERVICE TIME of a step)
 *   - LEARNING: Crawford's unit-time form of the learning curve with
 *     Wright's rate parameter (Wright 1936). The n-th unit through a station
 *     takes n^b of the first, b = log2(rate): at a rate of 0.9 the second
 *     unit takes 0.9, the fourth 0.81, the eighth 0.729. A FLOOR stops the
 *     curve where a real bench stops improving (default 0.7 of nominal).
 *     The count is the STATION's units in this run - not a worker's career.
 *   - FATIGUE: a declared uplift that rises with the minutes since the last
 *     break and is flat at its peak: 1 + maxUplift x min(1, minutes / toPeak).
 *     Work-study practice adds a rest allowance of a few per cent of basic
 *     time plus variable allowances (ILO, Introduction to Work Study); the
 *     numbers here are teaching values in that spirit, not measurements.
 *
 * WHAT IT IS NOT - AND MAY NOT BE
 *   - NOT KEYED TO A PERSON, and it may not be: the curves belong to a step
 *     and a shift, the count is per station, and nothing here reads the
 *     illustrative roster (BetrVG 87(1)6, GDPR Art. 88).
 *   - The learning count resets with every run. A bench's crew does not start
 *     from zero every morning, so this is a teaching device for what a
 *     learning curve DOES to a day, not a workforce model.
 *   - BREAKS ARE ASSUMED STAGGERED: a break resets the fatigue clock, it does
 *     not stop the bench. A plant that halts a line for a break is not this.
 *   - No turnover, no skill mix, no warm-up, no night-shift effect, and no
 *     claim that any rate or uplift applies to any real plant.
 *   - Absent by default: without `opts.people` a run is byte-identical to
 *     every run before this release.
 *   - Pure and deterministic: no Date, no Math.random.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const DEFAULTS = {
    learning: { rate: 0.95, floor: 0.7 },
    fatigue: { maxUplift: 0.15, toPeakMinutes: 240, breakEveryMinutes: 120, breakMinutes: 15 },
  };
  const SOURCES = {
    learning: "Wright, T. P. (1936), 'Factors Affecting the Cost of Airplanes', Journal of the Aeronautical Sciences 3(4) - the learning curve; " +
      "implemented in Crawford's unit-time form (the n-th unit takes n^log2(rate) of the first), which is the form a per-unit simulation needs. " +
      "Rates between 0.80 and 0.95 are commonly quoted for repetitive manual work - a teaching value here, not a measurement of any plant.",
    floor: "WarehouseTwin choice: a bench stops improving somewhere, and an unbounded curve would drive the service time to zero. A teaching value.",
    fatigue: "Work-study practice (ILO, Introduction to Work Study) adds a rest allowance of a few per cent of basic time plus variable allowances for " +
      "the conditions; Grosse, Glock, Jaber and Neumann (IJPR 53(3) 2015) name fatigue as a human factor the planning literature omits. The uplift and " +
      "the time to its peak here are teaching values in that spirit, not measurements.",
    breaks: "WarehouseTwin choice: a break every two hours of fifteen minutes, assumed STAGGERED - it resets the fatigue clock and does not stop the bench.",
  };
  const HONESTY =
    "Learning and fatigue as DECLARED curves on a process step and a shift - never on a person. The learning count is the station's " +
    "units in this run (a crew does not start from zero every morning: this shows what a learning curve does to a day, it does not model a " +
    "workforce), and the fatigue clock is the minutes since the last break, which is assumed staggered so a break resets the clock without " +
    "stopping the bench. Wright's rate in Crawford's unit form and a rest-allowance-shaped uplift, both teaching values with their sources; " +
    "no turnover, no skill mix, no warm-up. Nothing here reads the app's illustrative staffing figures, and nothing may be " +
    "keyed to a person (BetrVG 87(1)6, GDPR Art. 88).";

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const nonneg = (v, d) => (Number(v) >= 0 && isFinite(Number(v)) ? Number(v) : d);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  // normalise(spec): true / an object -> the block a plan carries; anything falsy -> null.
  function normalise(spec) {
    if (!spec) return null;
    const s = spec === true ? {} : spec;
    const l = s.learning || {}, f = s.fatigue || {};
    const rate = clamp(pos(l.rate, DEFAULTS.learning.rate), 0.5, 1);
    const floor = clamp(pos(l.floor, DEFAULTS.learning.floor), 0.1, 1);
    return {
      kind: "declared-curves",
      learning: { rate: rate, floor: floor, exponent: r6(Math.log(rate) / Math.LN2), source: SOURCES.learning, floor_source: SOURCES.floor },
      fatigue: {
        maxUplift: clamp(nonneg(f.maxUplift, DEFAULTS.fatigue.maxUplift), 0, 2),
        toPeakMinutes: pos(f.toPeakMinutes, DEFAULTS.fatigue.toPeakMinutes),
        breakEveryMinutes: pos(f.breakEveryMinutes, DEFAULTS.fatigue.breakEveryMinutes),
        breakMinutes: nonneg(f.breakMinutes, DEFAULTS.fatigue.breakMinutes),
        source: SOURCES.fatigue, breaks_source: SOURCES.breaks,
      },
      honesty: HONESTY,
    };
  }
  // The n-th unit through a station (1-based) takes this share of the first, floored.
  function learningFactor(n, learning) {
    const L = learning || DEFAULTS.learning;
    const k = Math.max(1, Math.floor(Number(n) || 1));
    const b = L.exponent != null ? L.exponent : Math.log(L.rate) / Math.LN2;
    return r6(clamp(Math.pow(k, b), L.floor, 1));
  }
  // Minutes since the last break, with breaks assumed staggered: the clock rises through the
  // working block, sits at zero through the break, and rises again.
  function minutesSinceBreak(minute, fatigue) {
    const F = fatigue || DEFAULTS.fatigue;
    const m = Math.max(0, Number(minute) || 0);
    const cycle = F.breakEveryMinutes + F.breakMinutes;
    if (!(cycle > 0)) return m;
    const inCycle = m % cycle;
    return inCycle >= F.breakEveryMinutes ? 0 : inCycle;
  }
  // 1 at a break, rising to 1 + maxUplift at the peak and flat after it.
  function fatigueFactor(minutesSince, fatigue) {
    const F = fatigue || DEFAULTS.fatigue;
    const m = Math.max(0, Number(minutesSince) || 0);
    return r6(1 + F.maxUplift * Math.min(1, m / F.toPeakMinutes));
  }
  // What one unit costs at a station: the two curves multiplied, and the factor the SERVICE RATE
  // is scaled by (the reciprocal - a slower bench serves fewer units a tick).
  function serviceFactor(n, minute, people) {
    if (!people) return { learning: 1, fatigue: 1, multiplier: 1, factor: 1, minutes_since_break: null };
    const learning = learningFactor(n, people.learning);
    const msb = minutesSinceBreak(minute, people.fatigue);
    const fatigue = fatigueFactor(msb, people.fatigue);
    const multiplier = r6(learning * fatigue);
    return { learning: learning, fatigue: fatigue, multiplier: multiplier, factor: r6(1 / multiplier), minutes_since_break: msb };
  }
  // The block a run ledger records (the numbers and their sources, without the functions).
  function block(people) {
    if (!people) return null;
    return { kind: people.kind,
      learning: { rate: people.learning.rate, floor: people.learning.floor, exponent: people.learning.exponent, source: people.learning.source },
      fatigue: { maxUplift: people.fatigue.maxUplift, toPeakMinutes: people.fatigue.toPeakMinutes,
        breakEveryMinutes: people.fatigue.breakEveryMinutes, breakMinutes: people.fatigue.breakMinutes, source: people.fatigue.source },
      honesty: HONESTY };
  }

  WT.people = { DEFAULTS, SOURCES, HONESTY, normalise, learningFactor, minutesSinceBreak, fatigueFactor, serviceFactor, block };
})();
