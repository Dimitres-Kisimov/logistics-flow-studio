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
 *     that changed them half way would carry an id that lies); the caller may
 *     later REVERT an accepted lever to the value it had, with an audit row of
 *     status reverted (v3.57) - the tower itself never writes a lever;
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
    "data exists to read, and none may (BetrVG 87(1)6, GDPR Art. 88). The five rules are teaching rules with editable " +
    "thresholds; an expected effect is either measured on the hand floor and says so, or arithmetic on declared values " +
    "and says so. Accepting a proposal re-runs the day from tick zero. Not a manufacturing execution system, not a " +
    "warehouse management system, not a scheduler, not a certification.";
  const DEFAULTS = {
    evalEveryTicks: 10, snoozeTicks: 120,
    queue: { threshold: 6, sustainTicks: 30 },
    rework: { maxShare: 0.01, minUnits: 20 },
    inbound: { lateTicks: 60 },
    otif: { minDeliveries: 20, target: 0.95 },
    search: { minGainHalfWidths: 1 }, // v3.62: the best's OTIF gain must clear this many half-widths
  };
  const RULES = [
    { id: "queue-congestion", label: "Queue congestion", reads: "the stations' queues (element id, length) at every evaluation", lever: "the adaptive-staffing what-if (a second worker joins at the threshold, leaves after the cool-down)" },
    { id: "rework-burden", label: "Rework burden", reads: "the ledger's quality by step: reworked units over units through the error-prone steps; the levers above 1", lever: "reset the largest performance-shaping lever above 1 - the latent condition, named" },
    { id: "inbound-late", label: "Inbound late", reads: "the trailers the receiving door logged (scheduled, arrival, late ticks)", lever: "halve the inbound period: twice the scheduled trailers, each burst about half" },
    { id: "otif-below-target", label: "OTIF below target", reads: "the ledger's service: delivered orders and their on-time-in-full share", lever: "halve the carrier period: departures twice as frequent" },
    { id: "lever-search", label: "Lever search", reads: "a lever-search table the person loaded (tools/search_levers.mjs): the ranked combinations with their OTIF and cost means and half-widths, and the rates it was searched under (v3.63: a table measured under other rates is refused)", lever: "the best-ranked combination's levers that differ from this run's, applied together as a combination lever" }, // v3.62
  ];
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const nonneg = (v, d) => (Number(v) >= 0 ? Number(v) : d);

  function normalise(t) {
    const s = t || {};
    const q = s.queue || {}, rw = s.rework || {}, ib = s.inbound || {}, ot = s.otif || {}, se = s.search || {};
    return {
      evalEveryTicks: Math.max(1, Math.round(pos(s.evalEveryTicks, DEFAULTS.evalEveryTicks))),
      snoozeTicks: Math.max(1, Math.round(pos(s.snoozeTicks, DEFAULTS.snoozeTicks))),
      queue: { threshold: Math.max(1, Math.round(pos(q.threshold, DEFAULTS.queue.threshold))), sustainTicks: Math.max(0, Math.round(nonneg(q.sustainTicks, DEFAULTS.queue.sustainTicks))) },
      rework: { maxShare: nonneg(rw.maxShare, DEFAULTS.rework.maxShare), minUnits: Math.max(1, Math.round(pos(rw.minUnits, DEFAULTS.rework.minUnits))) },
      inbound: { lateTicks: Math.max(0, Math.round(nonneg(ib.lateTicks, DEFAULTS.inbound.lateTicks))) },
      otif: { minDeliveries: Math.max(1, Math.round(pos(ot.minDeliveries, DEFAULTS.otif.minDeliveries))), target: Math.min(1, nonneg(ot.target, DEFAULTS.otif.target)) },
      search: { minGainHalfWidths: nonneg(se.minGainHalfWidths, DEFAULTS.search.minGainHalfWidths) },
    };
  }
  function create(thresholds, opts) { // v3.62: opts.search - a loaded lever-search table (tools/search_levers.mjs), or null
    const s = opts && opts.search && opts.search.kind === "wt-lever-search" && Array.isArray(opts.search.combos) ? opts.search : null;
    return { kind: "wt-control", thresholds: normalise(thresholds), proposals: [], audit: [], lastEval: -1, evaluations: 0,
      state: { queueSince: {}, muted: {}, searchNote: null }, search: s, honesty: HONESTY };
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
  // v3.62 the run's own lever combination in the search table's id form
  function comboOf(rec) {
    const p = (rec && rec.plan) || {};
    return "staffing=" + (p.policy && p.policy.kind === "queue-staffing" ? "adaptive" : "declared") + "|inbound=" + (p.inbound ? p.inbound.periodTicks : "none") +
      "|outbound=" + (p.outbound ? p.outbound.periodTicks : "none") + "|errors=" + (p.errors ? "declared" : "none");
  }
  // v3.63: a table searched under OTHER RATES does not transfer - the ranking was measured in a different world
  // (other error shares, another lateness shape). The run's own plan says what it runs at; when the run has no
  // such block there is nothing to contradict and the proposal carries the table's rates into the run.
  function searchRatesMatch(S, rec) {
    const Rt = S.rates, p = rec.plan || {};
    if (!Rt) return { ok: true };
    if (p.errors && Array.isArray(Rt.errors)) {
      const mine = (p.errors.kinds || []).map((k) => k.kind + "=" + k.effective).sort().join(", ");
      const theirs = Rt.errors.map((e) => e[0] + "=" + e[1]).sort().join(", ");
      if (mine !== theirs) return { ok: false, reason: "the table was searched with error shares " + (theirs || "none") + "; this run uses " + (mine || "none") };
    }
    if (p.inbound && Array.isArray(Rt.inbound_lateness) && JSON.stringify(p.inbound.lateness) !== JSON.stringify(Rt.inbound_lateness)) {
      return { ok: false, reason: "the table was searched on the " + (Rt.inbound_mode || "recorded") + " lateness shape; this run uses " + (p.inbound.mode || "another") };
    }
    return { ok: true };
  }
  // v3.62 lever-search: a search table the person loaded (tools/search_levers.mjs), never a live feed. At the first
  // evaluation it compares the run's own combination with the table's best and proposes the best's differing levers as
  // ONE combination lever when the table is this scenario's, the run is not at the best, and the best's OTIF gain over
  // the run's combination clears minGainHalfWidths x the wider half-width (a combination the table did not search is
  // compared to nothing: the rule proposes the best and says so).
  function ruleSearch(ctl, rec, state, tick) {
    const S = ctl.search;
    if (!S || !may(ctl, "lever-search", tick) || !rec.run || S.scenario !== rec.run.scenario || !Array.isArray(S.combos)) return;
    const best = S.combos.find((c) => c.id === S.best);
    if (!best || !best.levers || !best.otif) return;
    const rm = searchRatesMatch(S, rec); // v3.63
    ctl.state.searchNote = rm.ok ? null : rm.reason;
    if (!rm.ok) return;
    const cur = comboOf(rec), curRow = S.combos.find((c) => c.id === cur);
    if (cur === S.best) return;
    const k = ctl.thresholds.search.minGainHalfWidths;
    let gain = null;
    if (curRow && curRow.otif && curRow.otif.mean != null && best.otif.mean != null) {
      gain = r4(best.otif.mean - curRow.otif.mean);
      const half = Math.max(best.otif.ci95_half || 0, curRow.otif.ci95_half || 0);
      if (!(gain > k * half)) return;
    }
    const p = rec.plan || {}, Lv = best.levers, levers = [];
    if ((Lv.staffing === "adaptive") !== !!(p.policy && p.policy.kind === "queue-staffing")) levers.push({ kind: "picker", key: "staffing", value: Lv.staffing === "adaptive" ? "adaptive" : "declared" });
    if (!p.inbound || !p.outbound) levers.push({ kind: "picker", key: "delivery", value: "windows" });
    if (!p.inbound || p.inbound.periodTicks !== Lv.inbound_period) levers.push({ kind: "kb", key: "delivery.inbound.periodTicks", value: Lv.inbound_period });
    if (!p.outbound || p.outbound.periodTicks !== Lv.outbound_period) levers.push({ kind: "kb", key: "delivery.outbound.periodTicks", value: Lv.outbound_period });
    if ((Lv.errors === "declared") !== !!p.errors) levers.push({ kind: "picker", key: "errors", value: Lv.errors === "declared" ? "declared" : "none" });
    if (!levers.length) return;
    const pm = (s) => (s && s.mean != null ? s.mean + (s.ci95_half != null ? " ± " + s.ci95_half : "") : "-");
    const table = (S.ranked || S.combos.map((c) => c.id)).map((id) => { const c = S.combos.find((x) => x.id === id) || {}; return { id: id, n: c.n, otif_mean: c.otif ? c.otif.mean : null, otif_half: c.otif ? c.otif.ci95_half : null, cost_mean: c.cost_eur ? c.cost_eur.mean : null, cost_half: c.cost_eur ? c.cost_eur.ci95_half : null }; });
    propose(ctl, "lever-search", tick, { table: table, current: cur, current_searched: !!curRow, best: S.best, gain: gain, min_gain_half_widths: k, searched_ticks: S.ticks, seeds: S.seeds },
      { kind: "combo", levers: levers },
      "OTIF " + pm(best.otif) + " over " + best.n + " seeds in the search" + (curRow ? " against " + pm(curRow.otif) + " for this run's combination" : " (this run's combination was not searched)") + "; the day re-runs with the levers set",
      "the loaded lever search ranks " + S.best + " first" + (curRow ? " and its gain clears the half-widths" : ""));
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
    ruleSearch(ctl, rec, state, tick); // v3.62
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
      const a = by[r.rule] || (by[r.rule] = { rule: r.rule, proposals: 0, accepted: 0, declined: 0, snoozed: 0, reverted: 0, first_tick: null });
      a.proposals++;
      if (r.status === "accepted") a.accepted++; else if (r.status === "declined") a.declined++; else if (r.status === "snoozed") a.snoozed++; else if (r.status === "reverted") a.reverted++;
      if (a.first_tick == null || r.tick < a.first_tick) a.first_tick = r.tick;
    }
    return Object.keys(by).sort().map((k) => by[k]);
  }

  WT.control = { HONESTY, DEFAULTS, RULES, normalise, create, observe, decide, pending, controlRows, comboOf, searchRatesMatch }; // v3.62: comboOf; v3.63: searchRatesMatch
})();
