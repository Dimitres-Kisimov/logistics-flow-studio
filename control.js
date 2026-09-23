/* =====================================================================
 * Logistics Flow Studio - control.js
 * THE CONTROL TOWER (v3.56): a rule engine in the shape of the compliance
 * check - pure functions over the run ledger's record and the simulation's
 * aggregate state - that PROPOSES a lever, explains it from aggregates, and
 * waits for a person. A human in the loop, mechanically:
 *   - it only READS: observe(ctl, rec, state) evaluates every evalEveryTicks
 *     ticks and writes only into the tower's own record; a run with the tower
 *     attached is byte-identical to one without (verify_control.js);
 *   - it never sees a person: the evidence of every proposal is element ids,
 *     counts, ticks and shares from the ledger and the stations' queues; the
 *     illustrative roster is not read and there is nothing per person to read
 *     (BetrVG 87(1)6, GDPR Art. 88);
 *   - nothing acts on its own: a proposal stays proposed until decide() records
 *     accepted, declined or snoozed in the audit; ACCEPT is the caller's only
 *     write path (the app sets the lever exactly as the picker would and re-runs
 *     the day from tick zero, because a run id is a hash of its inputs and a run
 *     that changed them half way would carry an id that lies);
 *   - deterministic: the proposals are a pure function of the run history (two
 *     identical runs propose the same at the same ticks); no Date, no
 *     Math.random.
 *
 * THE FOUR RULES (teaching rules with editable thresholds; each fires at most
 * once per run, again after a snooze; the expected effect is either measured
 * on the hand floor and says so, or arithmetic on declared values and says so)
 *   queue-congestion   a station's queue at or above the congestion threshold
 *                      at every evaluation for sustainTicks, no staffing policy
 *                      active -> propose the adaptive-staffing what-if
 *   rework-burden      the error what-if ran with a lever above 1 and, after
 *                      minUnits through the error-prone steps, the reworked share
 *                      exceeds maxShare -> propose resetting the largest lever
 *                      (the latent condition, named) with the share arithmetic
 *   inbound-late       a logged trailer later than lateTicks -> propose halving
 *                      the inbound period (twice the trailers, half the burst;
 *                      the lateness is the dataset's shape and unchanged)
 *   otif-below-target  at least minDeliveries delivered orders and OTIF below
 *                      the target -> propose halving the carrier period (the
 *                      dock dwell before departure falls by at most half a
 *                      period per unit; transit unchanged)
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const HONESTY =
    "The control tower proposes, a person decides; nothing acts on its own. Every proposal is explainable from " +
    "aggregates per step and station (element ids, counts, ticks, shares) recorded by the run ledger; no per-person " +
    "data exists to read, and none may (BetrVG 87(1)6, GDPR Art. 88). The four rules are teaching rules with editable " +
    "thresholds; an expected effect is either measured on the hand floor and says so, or arithmetic on declared values " +
    "and says so. Accepting a proposal re-runs the day from tick zero. Not a manufacturing execution system, not a " +
    "warehouse management system, not a scheduler, not a certification.";
  const DEFAULTS = {
    evalEveryTicks: 10, snoozeTicks: 120,
    queue: { threshold: 6, sustainTicks: 30 },
    rework: { maxShare: 0.01, minUnits: 20 },
    inbound: { lateTicks: 60 },
    otif: { minDeliveries: 20, target: 0.95 },
  };
  const RULES = [
    { id: "queue-congestion", label: "Queue congestion", reads: "the stations' queues (element id, length) at every evaluation", lever: "the adaptive-staffing what-if (a second worker joins at the threshold, leaves after the cool-down)" },
    { id: "rework-burden", label: "Rework burden", reads: "the ledger's quality by step: reworked units over units through the error-prone steps; the levers above 1", lever: "reset the largest performance-shaping lever above 1 - the latent condition, named" },
    { id: "inbound-late", label: "Inbound late", reads: "the trailers the receiving door logged (scheduled, arrival, late ticks)", lever: "halve the inbound period: twice the scheduled trailers, each burst about half" },
    { id: "otif-below-target", label: "OTIF below target", reads: "the ledger's service: delivered orders and their on-time-in-full share", lever: "halve the carrier period: departures twice as frequent" },
  ];
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const nonneg = (v, d) => (Number(v) >= 0 ? Number(v) : d);

  function normalise(t) {
    const s = t || {};
    const q = s.queue || {}, rw = s.rework || {}, ib = s.inbound || {}, ot = s.otif || {};
    return {
      evalEveryTicks: Math.max(1, Math.round(pos(s.evalEveryTicks, DEFAULTS.evalEveryTicks))),
      snoozeTicks: Math.max(1, Math.round(pos(s.snoozeTicks, DEFAULTS.snoozeTicks))),
      queue: { threshold: Math.max(1, Math.round(pos(q.threshold, DEFAULTS.queue.threshold))), sustainTicks: Math.max(0, Math.round(nonneg(q.sustainTicks, DEFAULTS.queue.sustainTicks))) },
      rework: { maxShare: nonneg(rw.maxShare, DEFAULTS.rework.maxShare), minUnits: Math.max(1, Math.round(pos(rw.minUnits, DEFAULTS.rework.minUnits))) },
      inbound: { lateTicks: Math.max(0, Math.round(nonneg(ib.lateTicks, DEFAULTS.inbound.lateTicks))) },
      otif: { minDeliveries: Math.max(1, Math.round(pos(ot.minDeliveries, DEFAULTS.otif.minDeliveries))), target: Math.min(1, nonneg(ot.target, DEFAULTS.otif.target)) },
    };
  }
  function create(thresholds) {
    return { kind: "wt-control", thresholds: normalise(thresholds), proposals: [], audit: [], lastEval: -1, evaluations: 0,
      state: { queueSince: {}, muted: {} }, honesty: HONESTY };
  }
  // A rule may propose when it has not fired yet, or its snooze has run out.
  const may = (ctl, rule, tick) => ctl.state.muted[rule] == null || (ctl.state.muted[rule] !== Infinity && tick >= ctl.state.muted[rule]);
  function propose(ctl, rule, tick, evidence, lever, expectedEffect, why) {
    const p = { id: "P-" + rule + "-" + tick, rule: rule, tick: tick, evidence: evidence, lever: lever, expectedEffect: expectedEffect, why: why, status: "proposed", decided_tick: null };
    ctl.proposals.push(p);
    ctl.state.muted[rule] = Infinity; // once per run, unless snoozed
    return p;
  }
  // The rules, each a pure reading of (rec, state) at `tick`.
  function ruleQueue(ctl, rec, state, tick) {
    const T = ctl.thresholds.queue, since = ctl.state.queueSince;
    const stations = state.stations || [];
    for (const st of stations) {
      const q = st.queue ? st.queue.length : 0;
      if (q >= T.threshold) { if (since[st.id] == null) since[st.id] = tick; } else delete since[st.id];
    }
    if (rec.plan && rec.plan.policy) return; // a staffing policy is already at work
    if (!may(ctl, "queue-congestion", tick)) return;
    const hot = stations.filter((st) => since[st.id] != null && tick - since[st.id] >= T.sustainTicks)
      .map((st) => ({ id: st.id, element: st.elementId != null ? String(st.elementId) : null, queue: st.queue.length, since_tick: since[st.id], sustained_ticks: tick - since[st.id] }));
    if (!hot.length) return;
    hot.sort((a, b) => b.queue - a.queue || String(a.id).localeCompare(String(b.id)));
    propose(ctl, "queue-congestion", tick, { stations: hot, threshold: T.threshold, sustain_ticks: T.sustainTicks },
      { kind: "picker", key: "staffing", value: "adaptive" },
      "on the hand floor at the floor rate the second worker cut the longest queue from 19 to 17 with no fewer completions (verify_staffing.js); your floor will differ - re-run to measure",
      "a queue of " + hot[0].queue + " at " + (hot[0].element || hot[0].id) + " has been at or above " + T.threshold + " for " + hot[0].sustained_ticks + " ticks");
  }
  function ruleRework(ctl, rec, state, tick) {
    const errors = rec.plan && rec.plan.errors;
    if (!errors || !may(ctl, "rework-burden", tick)) return;
    const L = WT.ledger;
    if (!L || typeof L.qualityByStep !== "function") return;
    const T = ctl.thresholds.rework;
    const q = L.qualityByStep({ hus: rec.order.map((id) => rec.hus[id]), events: rec.events });
    const prone = {};
    for (const k of errors.kinds) for (const op of k.ops) prone[op] = 1;
    let through = 0, reworked = 0, scrapped = 0;
    for (const row of q) if (prone[row.op]) { through += row.units_through; reworked += row.reworked; scrapped += row.scrapped_for_damage; }
    if (through < T.minUnits) return;
    const share = through ? (reworked + scrapped) / through : 0;
    if (!(share > T.maxShare)) return;
    const levers = Object.keys(errors.psf || {}).filter((k) => errors.psf[k] > 1).sort((a, b) => errors.psf[b] - errors.psf[a] || a.localeCompare(b));
    if (!levers.length) return; // the burden is the declared base share: nothing to remove
    const lever = levers[0], from = errors.psf[lever];
    const effect = errors.kinds.map((k) => ({ kind: k.kind, from: k.effective, to: r6(Math.min(errors.cap, k.share * errors.multiplier / from)) }));
    propose(ctl, "rework-burden", tick, { units_through: through, reworked: reworked, scrapped_for_damage: scrapped, share: r4(share), max_share: T.maxShare, lever: lever, from: from, to: 1, kinds: effect },
      { kind: "kb", key: "hf.psf." + lever, value: 1 },
      "the declared effective shares fall " + effect.map((e) => e.kind + " " + e.from + " -> " + e.to).join(", ") + " (arithmetic on the knowledge base's values); the rework spans leave the cost",
      (reworked + scrapped) + " of " + through + " units through the error-prone steps erred (" + r4(share) + " > " + T.maxShare + ") with the " + lever + " lever at x" + from);
  }
  function ruleInbound(ctl, rec, state, tick) {
    const ib = rec.plan && rec.plan.inbound;
    if (!ib || !may(ctl, "inbound-late", tick)) return;
    const T = ctl.thresholds.inbound;
    const log = rec.inbound || [];
    const late = log.filter((t) => t.late_ticks > T.lateTicks);
    if (!late.length) return;
    const worst = late.slice().sort((a, b) => b.late_ticks - a.late_ticks || a.trailer - b.trailer)[0];
    propose(ctl, "inbound-late", tick, { trailers: log.length, late_trailers: late.length, late_share: r4(late.length / log.length), worst: worst, limit_ticks: T.lateTicks, period_ticks: ib.periodTicks },
      { kind: "kb", key: "delivery.inbound.periodTicks", value: Math.max(1, Math.round(ib.periodTicks / 2)) },
      "twice the scheduled trailers, each burst at the door about half the size; the lateness is the dataset's shape and unchanged",
      "trailer " + worst.trailer + " arrived " + worst.late_ticks + " ticks late (limit " + T.lateTicks + "); " + late.length + " of " + log.length + " trailers so far were later than the limit");
  }
  function ruleOtif(ctl, rec, state, tick) {
    const ob = rec.plan && rec.plan.outbound;
    if (!ob || !may(ctl, "otif-below-target", tick)) return;
    const L = WT.ledger;
    if (!L || typeof L.serviceOf !== "function") return;
    const T = ctl.thresholds.otif;
    const s = L.serviceOf({ run: rec.run, hus: rec.order.map((id) => rec.hus[id]) });
    if (!s || s.delivered_orders < T.minDeliveries || s.otif == null || !(s.otif < T.target)) return;
    propose(ctl, "otif-below-target", tick, { delivered_orders: s.delivered_orders, otif_orders: s.otif_orders, otif: s.otif, target: T.target, shipped_on_time_share: s.shipped_on_time_share, period_ticks: ob.periodTicks },
      { kind: "kb", key: "delivery.outbound.periodTicks", value: Math.max(1, Math.round(ob.periodTicks / 2)) },
      "the dock dwell before a departure falls by at most " + Math.round(ob.periodTicks / 2) + " ticks per unit; the transit is unchanged",
      "on time in full " + s.otif + " over " + s.delivered_orders + " delivered orders is below the target " + T.target);
  }
  // Read-only. Evaluates at every multiple of evalEveryTicks on the simulation's clock (the
  // hook runs after the tick advanced, so the first evaluation is at tick evalEveryTicks).
  function observe(ctl, rec, state) {
    if (!ctl || ctl.kind !== "wt-control" || !rec || !state || state.kind !== "wt-flowsim-state") return ctl;
    const tick = state.tick;
    if (tick % ctl.thresholds.evalEveryTicks !== 0 || tick === ctl.lastEval) return ctl;
    ctl.lastEval = tick;
    ctl.evaluations++;
    ruleQueue(ctl, rec, state, tick);
    ruleRework(ctl, rec, state, tick);
    ruleInbound(ctl, rec, state, tick);
    ruleOtif(ctl, rec, state, tick);
    return ctl;
  }
  // A person's decision: accepted | declined | snoozed. Returns the audit row (or null).
  function decide(ctl, proposalId, status, tick) {
    const p = (ctl.proposals || []).find((x) => x.id === proposalId);
    if (!p || p.status !== "proposed" || ["accepted", "declined", "snoozed"].indexOf(status) < 0) return null;
    p.status = status;
    p.decided_tick = tick;
    if (status === "snoozed") ctl.state.muted[p.rule] = tick + ctl.thresholds.snoozeTicks;
    else ctl.state.muted[p.rule] = Infinity;
    const row = { seq: ctl.audit.length + 1, tick: tick, rule: p.rule, proposal_id: p.id, status: status, lever: p.lever, evidence: p.evidence };
    ctl.audit.push(row);
    return row;
  }
  const pending = (ctl) => (ctl && ctl.proposals ? ctl.proposals.filter((p) => p.status === "proposed") : []);
  // The audit rows aggregated per rule (the same rows as v_control), over an EXPORT's control block.
  function controlRows(exp) {
    const rows = (exp && exp.control) || [];
    const by = {};
    for (const r of rows) {
      const a = by[r.rule] || (by[r.rule] = { rule: r.rule, proposals: 0, accepted: 0, declined: 0, snoozed: 0, first_tick: null });
      a.proposals++;
      if (r.status === "accepted") a.accepted++; else if (r.status === "declined") a.declined++; else if (r.status === "snoozed") a.snoozed++;
      if (a.first_tick == null || r.tick < a.first_tick) a.first_tick = r.tick;
    }
    return Object.keys(by).sort().map((k) => by[k]);
  }

  WT.control = { HONESTY, DEFAULTS, RULES, normalise, create, observe, decide, pending, controlRows };
})();
