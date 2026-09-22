/* =====================================================================
 * Logistics Flow Studio - run-ledger.js
 * THE RUN-LEDGER VIEWER (v3.33): the whole run from start to finish, drawn
 * from ONE file - the `factory-run-ledger/v1` export the simulator records.
 * ---------------------------------------------------------------------
 * Every table on the page is computed by the SAME definitions as the SQL
 * views in tools/run_ledger.py (RunLedger.views mirrors them one for one);
 * the test suite proves both agree on the recorded fixture and on a
 * hand-built ledger with hand-computed answers. Nothing on the page is
 * measured off a drawing: every number is a query result.
 *
 * Sections: the run · the packaging hierarchy (pallet pattern drawn from the
 * profile) · the start-to-finish ribbon per order type (units and eaches at
 * every operation, arrow width = eaches) · the planner tables (cycle time,
 * touches, station wait, WIP over time, quantities per operation) · the
 * dispatch manifest with trailers · a unit trace with its timeline · the
 * invariants (must be zero) · the SQL behind each table · (v3.35) what a
 * handling unit costs, from the spans between its events and the rates the
 * run was recorded under (WT.ledger.costs; ledger.js is loaded on the page) ·
 * (v3.37) compare two runs key by key, deltas B - A (RunLedger.compare).
 *
 * Pure model (RunLedger.views / ribbon / trace) + DOM rendering. No Date,
 * no Math.random, no network beyond loading the local example file.
 * ===================================================================== */
(function () {
  "use strict";
  const RunLedger = (window.RunLedger = window.RunLedger || {});
  const TRAILER_SLOTS = { eur: 33, ind: 26, half: 66, drum: 22, cage: 26 };
  const STORAGE_OPS = { putaway: 1, replen: 1, pick: 1, "piece-pick": 1, "case-pick": 1, "pallet-pick": 1 };
  const TERMINAL = { delivered: 1, restocked: 1, scrapped: 1 };
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  /* ---------------- the views (mirror tools/run_ledger.py) --------- */
  function index(exp) {
    const hus = {};
    for (const h of exp.hus) hus[h.id] = h;
    const byHu = {};
    for (const e of exp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
    for (const k in byHu) byHu[k].sort((a, b) => a.version - b.version);
    const loc = {};
    for (const l of exp.locations || []) loc[l.id] = l;
    return { hus, byHu, loc };
  }
  function views(exp) {
    const { hus, byHu, loc } = index(exp);
    const types = {};
    for (const h of exp.hus) {
      const t = types[h.archetype] || (types[h.archetype] = { archetype: h.archetype, units: 0, retired: 0, cyc: [], events: 0, served: 0 });
      t.units++;
      if (h.retired_tick != null) { t.retired++; t.cyc.push(h.retired_tick - h.spawned_tick); }
      for (const e of byHu[h.id] || []) { t.events++; if (e.kind === "served") t.served++; }
    }
    const mpt = exp.run.minutes_per_tick;
    const cycle = Object.keys(types).sort().map((k) => {
      const t = types[k];
      const n = t.cyc.length, sum = t.cyc.reduce((a, b) => a + b, 0);
      return { archetype: k, units: t.units, retired: t.retired, avg_cycle_ticks: n ? r2(sum / n) : null, avg_cycle_minutes: n ? r2(sum * mpt / n) : null,
        min_cycle_ticks: n ? Math.min.apply(null, t.cyc) : null, max_cycle_ticks: n ? Math.max.apply(null, t.cyc) : null };
    });
    const touches = Object.keys(types).sort().map((k) => {
      const t = types[k];
      return { archetype: k, units: t.units, events: t.events, touches: r2(t.events / t.units), served_per_unit: r2(t.served / t.units) };
    });
    // station wait: each queued event paired with the first later served event of the same unit + op
    const waitMap = {};
    for (const e of exp.events) {
      if (e.kind !== "queued") continue;
      const served = (byHu[e.hu_id] || []).find((s) => s.kind === "served" && s.op === e.op && s.version > e.version);
      const key = e.location + "|" + e.op;
      const w = waitMap[key] || (waitMap[key] = { location: e.location, op: e.op, waits: 0, sum: 0, n: 0, max: null, still_waiting: 0 });
      w.waits++;
      if (served) { const d = served.tick - e.tick; w.sum += d; w.n++; w.max = w.max == null ? d : Math.max(w.max, d); } else w.still_waiting++;
    }
    const wait = Object.keys(waitMap).sort().map((k) => { const w = waitMap[k];
      return { location: w.location, op: w.op, waits: w.waits, avg_wait_ticks: w.n ? r2(w.sum / w.n) : null, max_wait_ticks: w.max, still_waiting: w.still_waiting }; });
    const wip = [];
    for (let tick = 0; tick <= exp.run.ticks; tick++) {
      let inflight = 0, retired = 0;
      for (const h of exp.hus) {
        if (h.spawned_tick <= tick && (h.retired_tick == null || h.retired_tick > tick)) inflight++;
        if (h.retired_tick != null && h.retired_tick <= tick) retired++;
      }
      wip.push({ tick, in_flight: inflight, retired });
    }
    const opMap = {};
    for (const e of exp.events) {
      const k = e.op + "|" + e.kind;
      const o = opMap[k] || (opMap[k] = { op: e.op, kind: e.kind, events: 0, pallets: 0, cases: 0, eaches: 0, parcels: 0, retained: 0, scrapped: 0 });
      o.events++; o.pallets += e.pallets; o.cases += e.cases; o.eaches += e.eaches; o.parcels += e.parcels; o.retained += e.retained; o.scrapped += e.scrapped;
    }
    const byOp = Object.keys(opMap).sort().map((k) => opMap[k]);
    const delivered = exp.hus.filter((h) => h.final_kind === "delivered");
    let slots = 0;
    for (const h of delivered) slots = Math.max(slots, TRAILER_SLOTS[h.pallet || "eur"] || 33);
    const pallets = delivered.reduce((a, h) => a + (h.final ? h.final.pallets : 0), 0);
    const dispatch = delivered.length ? {
      delivered_units: delivered.length, pallets,
      cases: delivered.reduce((a, h) => a + h.final.cases, 0), eaches: delivered.reduce((a, h) => a + h.final.eaches, 0),
      parcels: delivered.reduce((a, h) => a + h.final.parcels, 0), trailer_slots: slots,
      trailers: slots ? Math.floor((pallets + slots - 1) / slots) : 0,
    } : null;
    if (dispatch) dispatch.fill = dispatch.trailers ? r4(pallets / (dispatch.trailers * slots)) : 0;
    // invariants (must all be 0)
    let conservation = 0, crossDock = 0, versionGaps = 0, terminals = 0;
    for (const e of exp.events) {
      const h = hus[e.hu_id];
      if (e.eaches + e.retained + e.scrapped !== h.received_eaches) conservation++;
      if (h.archetype === "cross-dock") { const l = loc[e.location]; if ((l && l.category === "storage") || STORAGE_OPS[e.op]) crossDock++; }
    }
    for (const h of exp.hus) {
      const evs = byHu[h.id] || [];
      if (evs.length && (evs[0].version !== 0 || evs[evs.length - 1].version + 1 !== evs.length)) versionGaps++;
      if ((h.retired_tick != null && !TERMINAL[h.final_kind]) || (h.retired_tick == null && h.final_kind)) terminals++;
    }
    const summary = {
      units: exp.hus.length, events: exp.events.length, delivered: delivered.length,
      delivered_eaches: dispatch ? dispatch.eaches : 0, delivered_pallets: pallets, delivered_parcels: dispatch ? dispatch.parcels : 0,
    };
    // v3.35 what a handling unit costs - the same definition as the SQL views
    // (WT.ledger.costs); null when the file carries no rates or ledger.js is absent
    const Lg = window.WT && window.WT.ledger;
    const cost = Lg && typeof Lg.costs === "function" ? Lg.costs(exp) : null;
    return { summary, cycle, touches, wait, wip, byOp, dispatch,
      invariants: { v_conservation_violations: conservation, v_cross_dock_violations: crossDock, v_version_gaps: versionGaps, v_terminal_violations: terminals },
      flowLinks: Lg && typeof Lg.flowLinks === "function" ? Lg.flowLinks(exp) : null, // v3.36
      rates: exp.rates || null, spans: cost ? cost.spans : null, costByHu: cost ? cost.byHu : null,
      costByType: cost ? cost.byType : null, costByLocation: cost ? cost.byLocation : null, costTotal: cost ? cost.total : null };
  }

  /* ---------------- the start-to-finish ribbon --------------------- */
  // One lane per route (returns split into its two outcomes): the operations
  // in order, with the units that reached each and the eaches they carried
  // after it. Arrow width between operations is proportional to eaches.
  function ribbon(exp) {
    const { byHu } = index(exp);
    const lanes = {};
    for (const h of exp.hus) {
      const lane = lanes[h.route_id] || (lanes[h.route_id] = { route: h.route_id, archetype: h.archetype, outcome: h.outcome, units: 0, ops: [], at: {} });
      lane.units++;
      const seenOp = {};
      for (const e of byHu[h.id] || []) {
        if (e.kind === "queued") continue; // an op counts once per unit, when passed / served / created / retired at it
        if (seenOp[e.op]) continue;
        seenOp[e.op] = 1;
        if (lane.ops.indexOf(e.op) < 0) lane.ops.push(e.op);
        const a = lane.at[e.op] || (lane.at[e.op] = { op: e.op, units: 0, pallets: 0, cases: 0, eaches: 0, parcels: 0, forms: {} });
        a.units++; a.pallets += e.pallets; a.cases += e.cases; a.eaches += e.eaches; a.parcels += e.parcels;
        if (e.form) a.forms[e.form] = (a.forms[e.form] || 0) + 1;
      }
    }
    return Object.keys(lanes).sort().map((k) => {
      const l = lanes[k];
      const steps = l.ops.map((op) => { const a = l.at[op]; const form = Object.keys(a.forms).sort((x, y) => a.forms[y] - a.forms[x])[0] || null; return Object.assign({ form }, a); });
      return { route: l.route, archetype: l.archetype, outcome: l.outcome, units: l.units, steps };
    });
  }

  /* ---------------- one unit's trace ------------------------------- */
  function trace(exp, huId) {
    const { hus, byHu } = index(exp);
    const h = hus[huId];
    if (!h) return null;
    const evs = byHu[huId] || [];
    const spans = [];
    for (let i = 0; i < evs.length - 1; i++) {
      const a = evs[i], b = evs[i + 1];
      spans.push({ from: a.tick, to: b.tick, state: a.kind === "queued" ? "waiting" : "moving", op: a.kind === "queued" ? a.op : b.op });
    }
    return { hu: h, events: evs, spans, start: evs.length ? evs[0].tick : null, end: evs.length ? evs[evs.length - 1].tick : null };
  }

  /* ---------------- SQL shown beside each table --------------------- */
  const SQL = {
    v_cycle_time_by_type: "SELECT archetype, COUNT(*) units, SUM(retired_tick IS NOT NULL) retired,\n       ROUND(AVG(retired_tick - spawned_tick), 2) avg_cycle_ticks,\n       ROUND(AVG((retired_tick - spawned_tick) * r.minutes_per_tick), 2) avg_cycle_minutes,\n       MIN(retired_tick - spawned_tick), MAX(retired_tick - spawned_tick)\nFROM hu h JOIN run r ON r.id = h.run_id GROUP BY archetype;",
    v_touches_by_type: "SELECT archetype, COUNT(DISTINCT h.id) units, COUNT(e.id) events,\n       ROUND(1.0 * COUNT(e.id) / COUNT(DISTINCT h.id), 2) touches,\n       ROUND(1.0 * SUM(e.kind = 'served') / COUNT(DISTINCT h.id), 2) served_per_unit\nFROM hu h LEFT JOIN handling_event e ON e.hu_id = h.id GROUP BY archetype;",
    v_station_wait: "SELECT q.location, q.op, COUNT(*) waits, ROUND(AVG(s.tick - q.tick), 2) avg_wait_ticks,\n       MAX(s.tick - q.tick) max_wait_ticks, SUM(s.tick IS NULL) still_waiting\nFROM handling_event q LEFT JOIN handling_event s\n  ON s.hu_id = q.hu_id AND s.kind = 'served' AND s.op = q.op AND s.version > q.version\nWHERE q.kind = 'queued' GROUP BY q.location, q.op;",
    v_wip_by_tick: "WITH RECURSIVE t(tick) AS (SELECT 0 UNION ALL SELECT tick + 1 FROM t WHERE tick < (SELECT ticks FROM run))\nSELECT tick,\n  (SELECT COUNT(*) FROM hu WHERE spawned_tick <= tick AND (retired_tick IS NULL OR retired_tick > tick)) in_flight,\n  (SELECT COUNT(*) FROM hu WHERE retired_tick IS NOT NULL AND retired_tick <= tick) retired\nFROM t;",
    v_quantities_by_op: "SELECT op, kind, COUNT(*) events, SUM(pallets), SUM(cases), SUM(eaches), SUM(parcels), SUM(retained), SUM(scrapped)\nFROM handling_event GROUP BY op, kind;",
    v_dispatch: "SELECT COUNT(*) delivered_units, SUM(final_pallets) pallets, SUM(final_cases) cases, SUM(final_eaches) eaches,\n       SUM(final_parcels) parcels, MAX(p.trailer_slots) trailer_slots,\n       (SUM(final_pallets) + MAX(p.trailer_slots) - 1) / MAX(p.trailer_slots) trailers\nFROM hu h JOIN pallet_type p ON p.id = COALESCE(h.pallet, 'eur') WHERE final_kind = 'delivered';",
    v_run_summary: "SELECT r.scenario, r.seed, r.profile, r.ticks, (SELECT COUNT(*) FROM hu) units, (SELECT COUNT(*) FROM handling_event) events,\n       (SELECT COUNT(*) FROM hu WHERE final_kind = 'delivered') delivered,\n       (SELECT COALESCE(SUM(final_eaches), 0) FROM hu WHERE final_kind = 'delivered') delivered_eaches,\n       (SELECT COALESCE(SUM(final_pallets), 0) FROM hu WHERE final_kind = 'delivered') delivered_pallets,\n       (SELECT COALESCE(SUM(final_parcels), 0) FROM hu WHERE final_kind = 'delivered') delivered_parcels\nFROM run r;",
    // v3.37 compare two runs (deltas B - A; one row per ordered pair of runs and key)
    v_compare_summary: "SELECT a.run_id run_a, b.run_id run_b, a.units units_a, b.units units_b, b.units - a.units delta_units,\n       a.events events_a, b.events events_b, b.events - a.events delta_events, a.delivered delivered_a, b.delivered delivered_b, b.delivered - a.delivered delta_delivered,\n       a.delivered_eaches delivered_eaches_a, b.delivered_eaches delivered_eaches_b, b.delivered_eaches - a.delivered_eaches delta_delivered_eaches\nFROM v_run_summary a JOIN v_run_summary b ON b.run_id <> a.run_id;",
    v_compare_cycle: "WITH keys AS (SELECT DISTINCT ra.id run_a, rb.id run_b, h.archetype FROM run ra JOIN run rb ON rb.id <> ra.id JOIN hu h ON h.run_id IN (ra.id, rb.id))\nSELECT k.run_a, k.run_b, k.archetype, a.units units_a, b.units units_b, b.units - a.units delta_units, a.retired retired_a, b.retired retired_b, b.retired - a.retired delta_retired,\n       a.avg_cycle_ticks avg_cycle_ticks_a, b.avg_cycle_ticks avg_cycle_ticks_b, ROUND(b.avg_cycle_ticks - a.avg_cycle_ticks, 4) delta_avg_cycle_ticks\nFROM keys k LEFT JOIN v_cycle_time_by_type a ON a.run_id = k.run_a AND a.archetype = k.archetype\n            LEFT JOIN v_cycle_time_by_type b ON b.run_id = k.run_b AND b.archetype = k.archetype;",
    v_compare_touches: "WITH keys AS (... archetypes of either run ...)\nSELECT k.run_a, k.run_b, k.archetype, a.touches touches_a, b.touches touches_b, ROUND(b.touches - a.touches, 4) delta_touches,\n       a.served_per_unit served_per_unit_a, b.served_per_unit served_per_unit_b, ROUND(b.served_per_unit - a.served_per_unit, 4) delta_served_per_unit\nFROM keys k LEFT JOIN v_touches_by_type a ON ... LEFT JOIN v_touches_by_type b ON ...;",
    v_compare_wait: "WITH keys AS (SELECT DISTINCT ra.id run_a, rb.id run_b, w.location, w.op FROM run ra JOIN run rb ON rb.id <> ra.id JOIN v_station_wait w ON w.run_id IN (ra.id, rb.id))\nSELECT k.run_a, k.run_b, k.location, k.op, a.waits waits_a, b.waits waits_b, b.waits - a.waits delta_waits,\n       a.avg_wait_ticks avg_wait_ticks_a, b.avg_wait_ticks avg_wait_ticks_b, ROUND(b.avg_wait_ticks - a.avg_wait_ticks, 4) delta_avg_wait_ticks,\n       a.still_waiting still_waiting_a, b.still_waiting still_waiting_b, b.still_waiting - a.still_waiting delta_still_waiting\nFROM keys k LEFT JOIN v_station_wait a ON a.run_id = k.run_a AND a.location = k.location AND a.op = k.op\n            LEFT JOIN v_station_wait b ON b.run_id = k.run_b AND b.location = k.location AND b.op = k.op;",
    v_compare_dispatch: "SELECT ra.id run_a, rb.id run_b, a.delivered_units delivered_units_a, b.delivered_units delivered_units_b, b.delivered_units - a.delivered_units delta_delivered_units,\n       a.pallets pallets_a, b.pallets pallets_b, b.pallets - a.pallets delta_pallets, a.parcels parcels_a, b.parcels parcels_b, b.parcels - a.parcels delta_parcels,\n       a.trailers trailers_a, b.trailers trailers_b, b.trailers - a.trailers delta_trailers\nFROM run ra JOIN run rb ON rb.id <> ra.id LEFT JOIN v_dispatch a ON a.run_id = ra.id LEFT JOIN v_dispatch b ON b.run_id = rb.id;",
    v_compare_cost: "WITH keys AS (... archetypes of either run ...)\nSELECT k.run_a, k.run_b, k.archetype, a.total_eur total_eur_a, b.total_eur total_eur_b, ROUND(b.total_eur - a.total_eur, 4) delta_total_eur,\n       a.eur_per_unit eur_per_unit_a, b.eur_per_unit eur_per_unit_b, ROUND(b.eur_per_unit - a.eur_per_unit, 4) delta_eur_per_unit,\n       a.eur_per_each eur_per_each_a, b.eur_per_each eur_per_each_b, ROUND(b.eur_per_each - a.eur_per_each, 4) delta_eur_per_each\nFROM keys k LEFT JOIN v_cost_by_type a ON ... LEFT JOIN v_cost_by_type b ON ...;",
    // v3.36 the flow as recorded
    v_flow_links: "WITH s AS (SELECT e.hu_id, e.op, e.eaches, h.retired_tick, LEAD(e.op) OVER (PARTITION BY e.hu_id ORDER BY e.version) to_op\n  FROM handling_event e JOIN hu h ON h.id = e.hu_id WHERE e.kind <> 'queued')\nSELECT op from_op, to_op, COUNT(*) units, SUM(retired_tick IS NOT NULL) retired_units, SUM(eaches) eaches\nFROM s WHERE to_op IS NOT NULL AND to_op <> op GROUP BY op, to_op;",
    // v3.35 what a handling unit costs
    v_spans: "WITH s AS (SELECT hu_id, version, kind, op, location, tick,\n  LEAD(tick) OVER (PARTITION BY hu_id ORDER BY version) to_tick, LEAD(kind) OVER w to_kind, LEAD(op) OVER w to_op, LEAD(location) OVER w to_location\n  FROM handling_event WINDOW w AS (PARTITION BY hu_id ORDER BY version))\nSELECT hu_id, version, kind from_kind, op, location, tick from_tick, to_kind, to_op, to_location, to_tick, to_tick - tick ticks,\n       CASE WHEN kind = 'queued' THEN 'waiting' ELSE 'moving' END state\nFROM s WHERE to_tick IS NOT NULL;",
    v_span_cost: "-- a waiting span is charged the station's service time (1 / its rate); a moving span in full at the floor's mover class\nWITH c AS (SELECT s.*, CASE WHEN s.state = 'waiting' THEN COALESCE(l.service_ticks, 0) ELSE s.ticks END charged_ticks,\n  CASE WHEN s.state = 'waiting' THEN lc.class ELSE r.transport_class END class,\n  CASE WHEN s.state = 'waiting' THEN COALESCE(lc.labour, 0) ELSE r.transport_labour END labour\n  FROM v_spans s JOIN rate r LEFT JOIN location l ON l.id = s.location LEFT JOIN location_class lc ON lc.type = l.type)\nSELECT c.hu_id, c.version, c.state, c.op, c.location, c.ticks, c.charged_ticks, c.class, c.labour,\n       c.charged_ticks * run.minutes_per_tick / 60.0 hours,\n       hours * c.labour * r.labour_per_hour labour_eur,\n       hours * COALESCE(er.capex / er.amort_years / r.hours_per_year, 0) equipment_eur,\n       hours * COALESCE(er.power_kw, 0) * r.energy_price_per_kwh energy_eur\nFROM c JOIN run JOIN rate r LEFT JOIN equipment_rate er ON er.class = c.class;",
    v_cost_by_hu: "SELECT hu_id, SUM(ticks) ticks, SUM(state = 'waiting') waiting_spans, SUM(charged_ticks) charged_ticks,\n       ROUND(SUM(labour_eur), 4) labour_eur, ROUND(SUM(equipment_eur), 4) equipment_eur, ROUND(SUM(energy_eur), 4) energy_eur,\n       ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4) total_eur\nFROM v_span_cost GROUP BY hu_id;",
    v_cost_by_type: "WITH c AS (SELECT hu_id, SUM(labour_eur) l, SUM(equipment_eur) q, SUM(energy_eur) n FROM v_span_cost GROUP BY hu_id)\nSELECT h.archetype, COUNT(*) units, SUM(h.retired_tick IS NOT NULL) retired,\n       COALESCE(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0) eaches_out,\n       ROUND(COALESCE(SUM(c.l), 0), 4) labour_eur, ROUND(COALESCE(SUM(c.q), 0), 4) equipment_eur, ROUND(COALESCE(SUM(c.n), 0), 4) energy_eur,\n       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0), 4) total_eur,\n       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0) / COUNT(*), 4) eur_per_unit,\n       ROUND(COALESCE(SUM(c.l + c.q + c.n), 0) / NULLIF(SUM(CASE WHEN h.final_kind = 'delivered' THEN h.final_eaches END), 0), 4) eur_per_each\nFROM hu h JOIN rate r LEFT JOIN c ON c.hu_id = h.id GROUP BY h.archetype;",
    v_cost_by_location: "SELECT location, MAX(class) class, COUNT(*) spans, SUM(ticks) ticks, SUM(charged_ticks) charged_ticks,\n       ROUND(SUM(labour_eur), 4) labour_eur, ROUND(SUM(equipment_eur), 4) equipment_eur, ROUND(SUM(energy_eur), 4) energy_eur,\n       ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4) total_eur\nFROM v_span_cost WHERE state = 'waiting' GROUP BY location\nUNION ALL\nSELECT 'transport', MAX(class), COUNT(*), SUM(ticks), SUM(charged_ticks), ROUND(SUM(labour_eur), 4), ROUND(SUM(equipment_eur), 4), ROUND(SUM(energy_eur), 4),\n       ROUND(SUM(labour_eur + equipment_eur + energy_eur), 4)\nFROM v_span_cost WHERE state = 'moving';",
    v_conservation_violations: "SELECT e.id FROM handling_event e JOIN hu h ON h.id = e.hu_id\nWHERE e.eaches + e.retained + e.scrapped <> h.received_eaches;   -- must be empty",
    v_cross_dock_violations: "SELECT e.id FROM handling_event e JOIN hu h ON h.id = e.hu_id JOIN location l ON l.id = e.location\nWHERE h.archetype = 'cross-dock' AND (l.category = 'storage' OR e.op IN ('putaway','replen','pick','piece-pick','case-pick','pallet-pick'));   -- must be empty",
    v_version_gaps: "SELECT h.id hu_id, COUNT(e.id) events, MIN(e.version) first_version, MAX(e.version) last_version\nFROM hu h JOIN handling_event e ON e.hu_id = h.id GROUP BY h.id\nHAVING MIN(e.version) <> 0 OR MAX(e.version) + 1 <> COUNT(e.id);   -- must be empty",
    v_terminal_violations: "SELECT id hu_id, final_kind, retired_tick FROM hu\nWHERE (retired_tick IS NOT NULL AND final_kind NOT IN ('delivered', 'restocked', 'scrapped'))\n   OR (retired_tick IS NULL AND final_kind IS NOT NULL);   -- must be empty",
  };

  /* ---------------- the pallet-pattern what-if ------------------------ */
  // The same eaches this run received on pallets, re-palletised with the best
  // pattern: inbound pallets and trailers now vs then. Pure.
  function whatIf(exp, opt) {
    const prof = exp.profile;
    if (!prof || !opt || !opt.current || !opt.best) return null;
    const epc = prof.eaches_per_case;
    let eaches = 0, units = 0;
    for (const h of exp.hus) {
      if (h.cases_per_pallet > 0 && ["full-pallet-out", "case-pick", "piece-pick", "cross-dock", "legacy-spine"].indexOf(h.archetype) >= 0) { eaches += h.received_eaches; units++; }
    }
    const side = (c) => {
      const epp = c.cases * epc;
      const pallets = epp ? Math.ceil(eaches / epp) : 0;
      const slots = TRAILER_SLOTS[c.pallet] || 33;
      return { pallet: c.pallet, cases: c.cases, eachesPerPallet: epp, pallets: pallets, slots: slots, trailers: pallets ? Math.ceil(pallets / slots) : 0 };
    };
    return { units: units, eaches: eaches, now: side(opt.current), best: side(opt.best), same: opt.best.pallet === opt.current.pallet && opt.best.cases === opt.current.cases };
  }
  /* ---------------- compare two runs (v3.37) ------------------------ */
  // The same tables for two exports, paired key by key (order type; bench +
  // operation); deltas are B - A and null whenever a side lacks the key, so
  // a type or bench seen in only one run still appears. Mirrors v_compare_*.
  function compare(a, b) {
    const va = views(a), vb = views(b);
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    const pair = (ra, rb, ks, fields, keysA, keysB) => {
      const key = (r) => ks.map((k) => r[k]);
      const map = {};
      const put = (rows, side) => { for (const r of rows || []) { const k = JSON.stringify(key(r)); const m = map[k] || (map[k] = { k: key(r) }); if (side) m[side] = r; } };
      put(ra, "a"); put(rb, "b"); put(keysA, null); put(keysB, null);
      const order = (p, q) => { for (let i = 0; i < ks.length; i++) { const c = cmp(p.k[i], q.k[i]); if (c) return c; } return 0; };
      return Object.keys(map).map((k) => map[k]).sort(order).map((m) => {
        const row = {};
        ks.forEach((kk, i) => { row[kk] = m.k[i]; });
        for (const f of fields) {
          const x = m.a && m.a[f] != null ? m.a[f] : null, y = m.b && m.b[f] != null ? m.b[f] : null;
          row[f + "_a"] = x; row[f + "_b"] = y; row["delta_" + f] = x == null || y == null ? null : r4(y - x);
        }
        return row;
      });
    };
    return {
      run_a: a.run.id, run_b: b.run.id,
      same_scenario: a.run.scenario === b.run.scenario && a.run.profile === b.run.profile,
      summary: pair([va.summary], [vb.summary], [], ["units", "events", "delivered", "delivered_eaches"]),
      cycle: pair(va.cycle, vb.cycle, ["archetype"], ["units", "retired", "avg_cycle_ticks"]),
      touches: pair(va.touches, vb.touches, ["archetype"], ["touches", "served_per_unit"]),
      wait: pair(va.wait, vb.wait, ["location", "op"], ["waits", "avg_wait_ticks", "still_waiting"]),
      dispatch: pair([va.dispatch || {}], [vb.dispatch || {}], [], ["delivered_units", "pallets", "parcels", "trailers"]),
      cost: pair(va.costByType || [], vb.costByType || [], ["archetype"], ["total_eur", "eur_per_unit", "eur_per_each"], va.cycle, vb.cycle),
    };
  }
  RunLedger.compare = compare;
  RunLedger.whatIf = whatIf;
  RunLedger.TRAILER_SLOTS = TRAILER_SLOTS;
  RunLedger.SQL = SQL;
  RunLedger.views = views;
  RunLedger.ribbon = ribbon;
  RunLedger.trace = trace;

  /* ================================================================
   * RENDERING (only when the page is present)
   * ================================================================ */
  if (typeof document === "undefined" || !document.getElementById("rlImport")) return;
  const $ = (id) => document.getElementById(id);
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(r2(v))) : String(v));
  let EXP = null;
  let EXP_B = null; // v3.37 the second run to compare against

  function table(rows, cols, caption) {
    if (!rows || !rows.length) return "<p class=\"note\">No rows.</p>";
    const head = cols.map((c) => "<th>" + esc(c) + "</th>").join("");
    const body = rows.map((r) => "<tr>" + cols.map((c) => "<td>" + esc(fmt(r[c])) + "</td>").join("") + "</tr>").join("");
    return '<div class="table-wrap"><table>' + (caption ? "<caption>" + esc(caption) + "</caption>" : "") + "<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function sqlBlock(name) { return '<details class="sql"><summary>SQL: ' + esc(name) + "</summary><pre>" + esc(SQL[name] || "") + "</pre></details>"; }

  function renderRun(exp) {
    const r = exp.run;
    const mix = r.mix ? Object.keys(r.mix).map((k) => k + " " + Math.round(r.mix[k] * 100) + "%").join(" · ") : "standard spine (no mix)";
    $("rlRun").innerHTML =
      '<div class="cards"><article><span>Run</span><strong class="mono">' + esc(r.id) + "</strong></article>" +
      "<article><span>Scenario · seed</span><strong>" + esc(r.scenario) + " · " + esc(r.seed) + "</strong></article>" +
      "<article><span>Simulated</span><strong>" + esc(r.ticks) + " ticks · " + esc(r2(r.ticks * r.minutes_per_tick)) + " min</strong></article></div>" +
      "<p><b>Order mix:</b> " + esc(mix) + " · <b>packaging profile:</b> " + esc(r.profile || "—") + "</p><p class=\"note\">" + esc(r.honesty || "") + "</p>";
  }

  // One layer drawn from its rectangles (grid or bands), in pallet millimetres.
  function layerSvg(P, pallet, box, layer, caption) {
    const S = 220 / Math.max(pallet.l, pallet.w);
    const rects = P.layerRects(pallet, box, layer);
    let s = '<svg viewBox="0 0 250 ' + (pallet.w * S + 30) + '" class="pallet" role="img" aria-label="' + esc(caption) + '">';
    s += '<rect x="10" y="10" width="' + pallet.l * S + '" height="' + pallet.w * S + '" class="pallet-deck"/>';
    for (const r of rects) s += '<rect x="' + (10 + r.x * S + 1) + '" y="' + (10 + r.y * S + 1) + '" width="' + Math.max(1, r.w * S - 2) + '" height="' + Math.max(1, r.h * S - 2) + '" class="pallet-case"/>';
    s += '<text x="10" y="' + (pallet.w * S + 24) + '" class="svg-label">' + esc(caption) + "</text></svg>";
    return s;
  }
  function renderOptimise(exp) {
    const P = window.WT && window.WT.pack;
    const out = $("rlOptimise");
    const prof = exp.profile;
    if (!P || !prof || !P.PROFILES[prof.id]) { out.innerHTML = "<p class=\"note\">No packaging profile in this file.</p>"; return; }
    const opt = P.optimizeProfile(P.PROFILES[prof.id]);
    if (opt.fixed) { out.innerHTML = "<p class=\"note\">This profile ships in cages with a declared capacity; there is no pattern to optimise.</p>"; return; }
    const rows = opt.ranked.map((r) => ({ pallet: r.label, per_layer: r.ti + " (" + r.pattern + (r.rotated ? ", rotated" : "") + ")", layers: r.hi, cases: r.cases,
      eaches: r.cases * prof.eaches_per_case, gross_kg: r.grossKg, cube: Math.round(r.cubeUtil * 100) + "%", limit: r.weightLimited ? "weight" : "height" }));
    const w = whatIf(exp, opt);
    const box = P.BOXES[prof.box];
    const drawings = '<div class="pallet-row">' + layerSvg(P, P.PALLETS[opt.current.pallet], box, opt.current.layer, "now: " + opt.current.label + " · " + opt.current.ti + " per layer") +
      (opt.gain && !opt.gain.samePallet ? layerSvg(P, P.PALLETS[opt.best.pallet], box, opt.best.layer, "best: " + opt.best.label + " · " + opt.best.ti + " per layer") : "") + "</div>";
    const cards = w ? '<div class="cards"><article><span>Pallet-borne eaches in this run</span><strong>' + w.eaches + " eaches · " + w.units + " units</strong></article>" +
      "<article><span>Inbound pallets · trailers now</span><strong>" + w.now.pallets + " × " + esc(w.now.pallet) + " · " + w.now.trailers + " trailer" + (w.now.trailers === 1 ? "" : "s") + "</strong></article>" +
      "<article><span>With the best pattern</span><strong>" + w.best.pallets + " × " + esc(w.best.pallet) + " · " + w.best.trailers + " trailer" + (w.best.trailers === 1 ? "" : "s") + (w.same ? " (no change)" : "") + "</strong></article></div>" : "";
    const verdict = opt.gain ? (opt.gain.samePallet ? "<p><b>The profile already uses the best pattern</b> (" + opt.best.cases + " cases per pallet).</p>"
      : "<p><b>" + esc(opt.best.label) + "</b> holds <b>" + opt.best.cases + "</b> cases against " + opt.current.cases + " on the profile's " + esc(opt.current.label) + " (" + (opt.gain.pct > 0 ? "+" : "") + opt.gain.pct + " %).</p>") : "";
    out.innerHTML = verdict + table(rows, ["pallet", "per_layer", "layers", "cases", "eaches", "gross_kg", "cube", "limit"], "Candidates for " + esc(box.label) + " at " + prof.max_stack_mm + " mm stack height") + drawings + cards +
      "<p class=\"note\">Grid = one orientation; bands = strips of mixed orientation. Height limit from the profile, load limit from the pallet's safe working load. " + esc(P.HONESTY) + "</p>";
  }
  function renderPackaging(exp) {
    const P = window.WT && window.WT.pack;
    const prof = exp.profile;
    const out = $("rlPack");
    if (!prof || !P) { out.innerHTML = "<p class=\"note\">No packaging profile in this file.</p>"; return; }
    const pallet = P.PALLETS[prof.pallet], box = P.BOXES[prof.box];
    if (!pallet || !box) { out.innerHTML = "<p class=\"note\">Unknown pallet or box id.</p>"; return; }
    const t = P.tiHi(pallet, box, prof.max_stack_mm, prof.case_kg);
    const fixed = t.fixed;
    const cases = fixed ? (exp.hus[0] && exp.hus[0].cases_per_pallet) || 0 : t.cases;
    const slots = TRAILER_SLOTS[prof.pallet] || 33;
    // plan view of one layer (the actual grid or band layout) + elevation of the stack
    const S = 220 / Math.max(pallet.l, pallet.w);
    const plan = fixed
      ? '<svg viewBox="0 0 250 ' + (pallet.w * S + 30) + '" class="pallet" role="img" aria-label="Cage"><rect x="10" y="10" width="' + pallet.l * S + '" height="' + pallet.w * S + '" class="pallet-deck"/><text x="10" y="' + (pallet.w * S + 24) + '" class="svg-label">' + esc(pallet.l + " × " + pallet.w + " mm · declared capacity") + "</text></svg>"
      : layerSvg(P, pallet, box, t.layer, pallet.l + " × " + pallet.w + " mm · " + t.ti + " per layer (" + t.pattern + (t.rotated ? ", rotated" : "") + ")");
    const H = fixed ? 0 : t.stackMm;
    const ES = 160 / Math.max(H, pallet.h + box.h);
    let elev = '<svg viewBox="0 0 250 200" class="pallet" role="img" aria-label="Pallet stack, elevation">';
    elev += '<rect x="10" y="' + (180 - pallet.h * ES) + '" width="' + pallet.l * S + '" height="' + pallet.h * ES + '" class="pallet-deck"/>';
    for (let k = 0; k < (fixed ? 0 : t.hi); k++) elev += '<rect x="11" y="' + (180 - pallet.h * ES - (k + 1) * box.h * ES + 1) + '" width="' + (pallet.l * S - 2) + '" height="' + (box.h * ES - 2) + '" class="pallet-case"/>';
    elev += '<text x="10" y="196" class="svg-label">' + esc(fixed ? "cage: " + cases + " units declared" : t.hi + " layers · " + t.stackMm + " mm high · " + t.grossKg + " kg gross" + (t.weightLimited ? " (weight-limited)" : "")) + "</text></svg>";
    out.innerHTML =
      '<div class="cards"><article><span>Each → case</span><strong>' + esc(prof.eaches_per_case) + " per " + esc(box.label) + "</strong></article>" +
      "<article><span>Case → pallet</span><strong>" + esc(cases) + " cases (" + esc(cases * prof.eaches_per_case) + " eaches)</strong></article>" +
      "<article><span>Pallet → trailer</span><strong>" + esc(slots) + " per 13.6 m trailer</strong></article></div>" +
      '<div class="pallet-row">' + plan + elev + "</div>" +
      "<p class=\"note\">" + esc(pallet.label) + " (" + esc(pallet.standard) + "), safe working load " + esc(pallet.maxLoadKg) + " kg. " +
      (fixed ? "" : "Cube utilisation " + Math.round(t.cubeUtil * 100) + "%. ") + esc(P.HONESTY) + "</p>";
  }

  function renderRibbon(exp) {
    const lanes = ribbon(exp);
    let maxE = 1;
    for (const l of lanes) for (const s of l.steps) maxE = Math.max(maxE, s.eaches);
    const BW = 92, BH = 54, GAP = 34, X0 = 150;
    const html = lanes.map((l) => {
      const W = X0 + l.steps.length * (BW + GAP) + 10;
      let svg = '<svg viewBox="0 0 ' + W + ' ' + (BH + 30) + '" class="ribbon" role="img" aria-label="' + esc(l.route) + ' from start to finish">';
      svg += '<text x="4" y="' + (BH / 2 + 4) + '" class="lane-label">' + esc(l.route) + "</text><text x=\"4\" y=\"" + (BH / 2 + 20) + '" class="svg-label">' + esc(l.units + " units") + "</text>";
      l.steps.forEach((s, i) => {
        const x = X0 + i * (BW + GAP);
        if (i > 0) {
          const prev = l.steps[i - 1];
          const w = Math.max(1.5, 14 * prev.eaches / maxE);
          svg += '<line x1="' + (x - GAP) + '" y1="' + (BH / 2) + '" x2="' + x + '" y2="' + (BH / 2) + '" class="ribbon-arrow" stroke-width="' + w.toFixed(1) + '"/>';
        }
        svg += '<rect x="' + x + '" y="4" width="' + BW + '" height="' + BH + '" rx="6" class="op-box form-' + esc(s.form || "none") + '"/>';
        svg += '<text x="' + (x + BW / 2) + '" y="20" class="op-name" text-anchor="middle">' + esc(s.op) + "</text>";
        svg += '<text x="' + (x + BW / 2) + '" y="36" class="op-qty" text-anchor="middle">' + esc(s.units + "u · " + s.eaches + " ea") + "</text>";
        svg += '<text x="' + (x + BW / 2) + '" y="50" class="op-qty" text-anchor="middle">' + esc((s.pallets ? s.pallets + " plt " : "") + (s.cases ? s.cases + " cs " : "") + (s.parcels ? s.parcels + " pcl" : "")) + "</text>";
        svg += '<text x="' + (x + BW / 2) + '" y="' + (BH + 22) + '" class="svg-label" text-anchor="middle">' + esc(s.form || "") + "</text>";
      });
      return svg + "</svg>";
    }).join("");
    $("rlRibbon").innerHTML = html + "<p class=\"note\">Each box: the units that reached the operation and the eaches they carried after it (pallets / cases / parcels below); the drawn form under it. Arrow width is proportional to eaches. Units still in flight appear only up to the operation they have reached.</p>";
  }

  function renderViews(exp) {
    const v = views(exp);
    const s = v.summary;
    $("rlSummary").innerHTML = '<div class="cards"><article><span>Units · events</span><strong>' + s.units + " · " + s.events + "</strong></article>" +
      "<article><span>Delivered</span><strong>" + s.delivered + " units · " + s.delivered_eaches + " eaches</strong></article>" +
      "<article><span>Delivered pallets · parcels</span><strong>" + s.delivered_pallets + " · " + s.delivered_parcels + "</strong></article></div>" + sqlBlock("v_run_summary");
    $("rlCycle").innerHTML = table(v.cycle, ["archetype", "units", "retired", "avg_cycle_ticks", "avg_cycle_minutes", "min_cycle_ticks", "max_cycle_ticks"], "Cycle time by order type") + sqlBlock("v_cycle_time_by_type");
    $("rlTouches").innerHTML = table(v.touches, ["archetype", "units", "events", "touches", "served_per_unit"], "Touches by order type") + sqlBlock("v_touches_by_type");
    $("rlWait").innerHTML = table(v.wait, ["location", "op", "waits", "avg_wait_ticks", "max_wait_ticks", "still_waiting"], "Waiting at each bench") + sqlBlock("v_station_wait");
    // WIP sparkline
    const W = 680, H = 140, n = v.wip.length, maxW = Math.max(1, ...v.wip.map((r) => r.in_flight));
    const pts = v.wip.map((r, i) => ((i / Math.max(1, n - 1)) * (W - 20) + 10).toFixed(1) + "," + (H - 20 - (r.in_flight / maxW) * (H - 40)).toFixed(1)).join(" ");
    const last = v.wip[n - 1] || { in_flight: 0, retired: 0 };
    $("rlWip").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" class="wip" role="img" aria-label="Work in progress over time"><polyline points="' + pts + '" class="wip-line"/>' +
      '<text x="10" y="14" class="svg-label">in flight, peak ' + maxW + '</text><text x="10" y="' + (H - 4) + '" class="svg-label">tick 0</text><text x="' + (W - 10) + '" y="' + (H - 4) + '" class="svg-label" text-anchor="end">tick ' + exp.run.ticks + " · " + last.in_flight + " in flight · " + last.retired + " retired</text></svg>" + sqlBlock("v_wip_by_tick");
    $("rlByOp").innerHTML = table(v.byOp, ["op", "kind", "events", "pallets", "cases", "eaches", "parcels", "retained", "scrapped"], "Quantities at each operation") + sqlBlock("v_quantities_by_op");
    // dispatch + trailer graphic
    const d = v.dispatch;
    if (!d) { $("rlDispatch").innerHTML = "<p class=\"note\">Nothing delivered yet in this run.</p>"; }
    else {
      const cols = d.trailer_slots === 26 ? 13 : d.trailer_slots === 22 ? 11 : 11, rows = Math.ceil(d.trailer_slots / cols);
      let trailers = "";
      for (let t = 0; t < Math.min(d.trailers, 6); t++) {
        const filled = Math.min(d.trailer_slots, d.pallets - t * d.trailer_slots);
        let g = '<svg viewBox="0 0 ' + (cols * 16 + 8) + " " + (rows * 16 + 26) + '" class="trailer" role="img" aria-label="Trailer ' + (t + 1) + '">';
        for (let i = 0; i < d.trailer_slots; i++) g += '<rect x="' + (4 + (i % cols) * 16) + '" y="' + (4 + Math.floor(i / cols) * 16) + '" width="14" height="14" class="' + (i < filled ? "slot-full" : "slot-empty") + '"/>';
        g += '<text x="4" y="' + (rows * 16 + 20) + '" class="svg-label">trailer ' + (t + 1) + ": " + filled + " / " + d.trailer_slots + "</text></svg>";
        trailers += g;
      }
      $("rlDispatch").innerHTML = '<div class="cards"><article><span>Delivered</span><strong>' + d.delivered_units + " units</strong></article><article><span>Pallets · cases · parcels</span><strong>" + d.pallets + " · " + d.cases + " · " + d.parcels + "</strong></article><article><span>Trailers</span><strong>" + d.trailers + " × " + d.trailer_slots + " slots · " + Math.round(d.fill * 100) + "% full</strong></article></div>" +
        '<div class="trailer-row">' + trailers + (d.trailers > 6 ? '<p class="note">… and ' + (d.trailers - 6) + " more</p>" : "") + "</div>" + sqlBlock("v_dispatch");
    }
    const inv = v.invariants;
    const bad = Object.keys(inv).filter((k) => inv[k] > 0);
    $("rlInvariants").innerHTML = '<div class="cards">' + Object.keys(inv).map((k) => '<article class="' + (inv[k] ? "bad" : "good") + '"><span>' + esc(k) + "</span><strong>" + inv[k] + (inv[k] ? " violations" : " · holds") + "</strong></article>").join("") + "</div>" +
      (bad.length ? '<p class="note">This file breaks an invariant - it is not a faithful recording.</p>' : "<p class=\"note\">Every invariant holds on this file: eaches are conserved at every event, no cross-dock unit touched storage, versions are consecutive, terminals are well-formed.</p>") +
      sqlBlock("v_conservation_violations") + sqlBlock("v_cross_dock_violations") + sqlBlock("v_version_gaps") + sqlBlock("v_terminal_violations");
  }

  // v3.36 the flow as recorded: a layered Sankey over the recorded links
  function renderFlow(exp) {
    const out = $("rlFlow");
    const Lg = window.WT && window.WT.ledger, An = window.WT && window.WT.analytics;
    if (!Lg || !An || typeof Lg.sankeyFromLedger !== "function" || typeof An.sankeySvgLayered !== "function") { out.innerHTML = "<p class=\"note\">ledger.js / analytics.js are not loaded on this page.</p>"; return; }
    out.innerHTML = '<p><label for="rlFlowUnit">Ribbon width:</label> <select id="rlFlowUnit"><option value="units">units, every unit</option><option value="retired">units, retired only (conserving)</option><option value="eaches">eaches</option></select></p><div id="rlFlowSvg"></div><div id="rlFlowTable"></div>';
    const draw = () => {
      const mode = $("rlFlowUnit").value;
      const model = Lg.sankeyFromLedger(exp, { unit: mode === "eaches" ? "eaches" : "units", retiredOnly: mode === "retired" });
      const geo = An.sankeyLayoutLayered(model);
      $("rlFlowSvg").innerHTML = '<div class="an-sankey">' + An.sankeySvgLayered(model, "dark") + "</div>";
      const links = Lg.flowLinks(exp);
      $("rlFlowTable").innerHTML = table(links, ["from_op", "to_op", "units", "retired_units", "eaches"], "Links between operations (" + links.length + ")") + sqlBlock("v_flow_links") +
        "<p class=\"note\">" + esc(model.honesty) + (geo && geo.cyclic ? " A cycle was found: back-links are outlined." : "") + "</p>";
    };
    $("rlFlowUnit").onchange = draw;
    draw();
  }

  // v3.37 compare two runs: A (the loaded run) against B, deltas B - A
  function renderCompare() {
    const out = $("rlCompare");
    if (!EXP || !EXP_B) { out.innerHTML = "<p class=\"note\">Load a second run (B) above - the recorded example B, or your own export - to compare it against this one. Deltas are B − A.</p>"; return; }
    const c = compare(EXP, EXP_B);
    const mixOf = (r) => (r.mix ? (Array.isArray(r.mix) ? r.mix.map((m) => m.id + " " + Math.round(m.share * 100) + "%").join(" · ") : Object.keys(r.mix).map((k) => k + " " + Math.round(r.mix[k] * 100) + "%").join(" · ")) : "standard spine");
    const fmtRow = (r, moneyFields) => { const o = Object.assign({}, r); for (const f of moneyFields || []) for (const s of ["_a", "_b"]) o[f + s] = money(r[f + s]); return o; };
    const head = '<div class="cards"><article><span>A</span><strong class="mono">' + esc(c.run_a) + "</strong><span>" + esc(mixOf(EXP.run)) + "</span></article>" +
      '<article><span>B</span><strong class="mono">' + esc(c.run_b) + "</strong><span>" + esc(mixOf(EXP_B.run)) + "</span></article>" +
      '<article class="' + (c.same_scenario ? "good" : "bad") + '"><span>Comparable?</span><strong>' + (c.same_scenario ? "same scenario and profile" : "different scenario or profile") + "</strong><span>" + (c.same_scenario ? "deltas are B − A" : "deltas shown, but the runs are not like for like") + "</span></article></div>";
    out.innerHTML = head +
      table(c.summary, ["units_a", "units_b", "delta_units", "events_a", "events_b", "delta_events", "delivered_a", "delivered_b", "delta_delivered", "delivered_eaches_a", "delivered_eaches_b", "delta_delivered_eaches"], "Summary") + sqlBlock("v_compare_summary") +
      table(c.cycle, ["archetype", "units_a", "units_b", "delta_units", "retired_a", "retired_b", "delta_retired", "avg_cycle_ticks_a", "avg_cycle_ticks_b", "delta_avg_cycle_ticks"], "Cycle time by order type") + sqlBlock("v_compare_cycle") +
      table(c.touches, ["archetype", "touches_a", "touches_b", "delta_touches", "served_per_unit_a", "served_per_unit_b", "delta_served_per_unit"], "Touches by order type") + sqlBlock("v_compare_touches") +
      table(c.wait, ["location", "op", "waits_a", "waits_b", "delta_waits", "avg_wait_ticks_a", "avg_wait_ticks_b", "delta_avg_wait_ticks", "still_waiting_a", "still_waiting_b", "delta_still_waiting"], "Waiting at each bench") + sqlBlock("v_compare_wait") +
      table(c.dispatch, ["delivered_units_a", "delivered_units_b", "delta_delivered_units", "pallets_a", "pallets_b", "delta_pallets", "parcels_a", "parcels_b", "delta_parcels", "trailers_a", "trailers_b", "delta_trailers"], "Dispatch") + sqlBlock("v_compare_dispatch") +
      table(c.cost.map((r) => fmtRow(r, ["total_eur", "eur_per_unit", "eur_per_each"])), ["archetype", "total_eur_a", "total_eur_b", "delta_total_eur", "eur_per_unit_a", "eur_per_unit_b", "delta_eur_per_unit", "eur_per_each_a", "eur_per_each_b", "delta_eur_per_each"], "Cost by order type (null when a run carries no rates)") + sqlBlock("v_compare_cost") +
      "<p class=\"note\">A key seen in only one run still appears, with the other side and the delta empty. In SQLite both runs live in one database and the views pair every ordered pair of runs; <code>python tools/run_ledger.py compare --database run.sqlite --runs A B</code> prints them.</p>";
  }
  function loadB(exp) {
    if (!exp || exp.schema !== "factory-run-ledger/v1" || !Array.isArray(exp.hus) || !Array.isArray(exp.events) || !exp.run) { $("rlStatus").textContent = "That file is not a factory-run-ledger/v1 export."; return; }
    EXP_B = exp;
    $("rlStatus").textContent = "B: loaded " + exp.hus.length + " units and " + exp.events.length + " events from " + exp.run.id + (EXP ? "; compared against " + EXP.run.id + "." : ". Load run A to compare.");
    if (EXP) { $("rlView").hidden = false; renderCompare(); }
  }

  // v3.35 what a handling unit costs
  const money = (v) => (v == null ? "—" : "€\u202f" + (Math.round(v * 100) / 100).toFixed(2));
  function renderCost(exp) {
    const out = $("rlCost");
    const Lg = window.WT && window.WT.ledger;
    if (!Lg || typeof Lg.costs !== "function") { out.innerHTML = "<p class=\"note\">ledger.js is not loaded on this page.</p>"; return; }
    if (!exp.rates) { out.innerHTML = "<p class=\"note\">This file carries no rates: export it from the planner (v3.35 or later) to cost its units.</p>"; return; }
    const c = Lg.costs(exp);
    const r = c.rates;
    const units = exp.hus.length;
    const eachesOut = c.byType.reduce((a, t) => a + t.eaches_out, 0);
    const cards = '<div class="cards"><article><span>This run</span><strong>' + money(c.total.total_eur) + "</strong><span>labour " + money(c.total.labour_eur) + " · equipment " + money(c.total.equipment_eur) + " · energy " + money(c.total.energy_eur) + "</span></article>" +
      "<article><span>Per handling unit</span><strong>" + money(units ? c.total.total_eur / units : null) + "</strong><span>" + units + " units, delivered or in flight</span></article>" +
      "<article><span>Per delivered each</span><strong>" + (eachesOut ? money(c.total.total_eur / eachesOut) : "—") + "</strong><span>" + eachesOut + " eaches delivered</span></article></div>";
    const typeRows = c.byType.map((t) => Object.assign({}, t, { labour_eur: money(t.labour_eur), equipment_eur: money(t.equipment_eur), energy_eur: money(t.energy_eur), total_eur: money(t.total_eur), eur_per_unit: money(t.eur_per_unit), eur_per_each: money(t.eur_per_each) }));
    const locRows = c.byLocation.map((l) => Object.assign({}, l, { class: l.class || "—", labour_eur: money(l.labour_eur), equipment_eur: money(l.equipment_eur), energy_eur: money(l.energy_eur), total_eur: money(l.total_eur) }));
    const rateRows = Object.keys(r.equipment).map((k) => { const e = r.equipment[k];
      return { class: k, capex: e.capex, amort_years: e.amort_years, eur_per_hour: Math.round((e.capex / e.amort_years / r.hours_per_year) * 10000) / 10000, power_kw: e.power_kw, manned: e.labour ? "yes" : "no" }; });
    const classList = Object.keys(r.classes).map((t) => t + " → " + (r.classes[t].class || "no class") + (r.classes[t].labour ? " (manned)" : "")).join(" · ");
    out.innerHTML = cards +
      table(typeRows, ["archetype", "units", "retired", "eaches_out", "labour_eur", "equipment_eur", "energy_eur", "total_eur", "eur_per_unit", "eur_per_each"], "Cost by order type") + sqlBlock("v_cost_by_type") +
      table(locRows, ["location", "class", "spans", "ticks", "charged_ticks", "labour_eur", "equipment_eur", "energy_eur", "total_eur"], "Cost by location: waiting spans charged at the station's service time, and internal transport") + sqlBlock("v_cost_by_location") + sqlBlock("v_spans") + sqlBlock("v_span_cost") +
      "<p><b>Rates in this file:</b> labour " + money(r.labour_per_hour) + "/h · energy " + money(r.energy_price_per_kwh) + "/kWh · " + r.hours_per_year + " operating hours per year · internal transport: " + (r.transport.class ? r.transport.class + (r.transport.labour ? " (manned)" : " (unmanned)") : "no mover on this floor, movement is free") + ".</p>" +
      table(rateRows, ["class", "capex", "amort_years", "eur_per_hour", "power_kw", "manned"], "Equipment classes (illustrative)") +
      "<p class=\"note\">Location types on this floor: " + esc(classList) + ".</p><p class=\"note\">" + esc(r.honesty) + "</p>";
  }

  function renderTrace(exp) {
    const sel = $("rlUnit");
    sel.innerHTML = exp.hus.map((h) => '<option value="' + esc(h.id) + '">' + esc(h.archetype + (h.outcome ? "/" + h.outcome : "") + " · " + h.id.slice(-8)) + "</option>").join("");
    const draw = () => {
      const t = trace(exp, sel.value);
      if (!t) { $("rlTrace").innerHTML = ""; return; }
      const h = t.hu;
      const W = 680, X0 = 10, span = Math.max(1, (t.end == null ? 0 : t.end) - (t.start || 0));
      const x = (tick) => X0 + ((tick - t.start) / span) * (W - 2 * X0);
      let g = '<svg viewBox="0 0 ' + W + ' 86" class="gantt" role="img" aria-label="Timeline of ' + esc(h.id) + '">';
      for (const s of t.spans) g += '<rect x="' + x(s.from).toFixed(1) + '" y="10" width="' + Math.max(1, x(s.to) - x(s.from)).toFixed(1) + '" height="24" class="span-' + s.state + '"><title>' + esc(s.state + " · " + s.op + " · ticks " + s.from + "–" + s.to) + "</title></rect>";
      // labels go on two rows; a label too close to the previous one on a row
      // moves to the other row, and is dropped when both rows are taken (the
      // event table below and the span tooltips still carry every operation)
      let lastLabelOp = null;
      const rowX = [-1e9, -1e9], MIN_GAP = 46;
      t.events.forEach((e) => {
        const px = x(e.tick);
        g += '<line x1="' + px.toFixed(1) + '" y1="8" x2="' + px.toFixed(1) + '" y2="40" class="ev-tick"/>';
        if (e.op === lastLabelOp) return;
        lastLabelOp = e.op;
        const row = px - rowX[0] >= MIN_GAP ? 0 : px - rowX[1] >= MIN_GAP ? 1 : -1;
        if (row < 0) return;
        rowX[row] = px;
        g += '<text x="' + px.toFixed(1) + '" y="' + (row ? 66 : 54) + '" class="svg-label" text-anchor="middle">' + esc(e.op) + "</text>";
      });
      g += '<text x="10" y="82" class="svg-label">tick ' + t.start + " → " + t.end + " · dark = waiting at a bench, light = moving / being worked</text></svg>";
      // v3.35 what this unit cost (null without rates)
      const Lg = window.WT && window.WT.ledger;
      const cost = Lg && typeof Lg.costs === "function" && exp.rates ? Lg.costs(exp).byHu.find((x) => x.hu_id === h.id) : null;
      const costCard = cost ? "<article><span>Cost so far</span><strong>" + money(cost.total_eur) + "</strong><span>" + cost.charged_ticks + " charged ticks: labour " + money(cost.labour_eur) + " · equipment " + money(cost.equipment_eur) + " · energy " + money(cost.energy_eur) + "</span></article>" : "";
      $("rlTrace").innerHTML = '<div class="cards"><article><span>Unit</span><strong class="mono">' + esc(h.id) + "</strong></article><article><span>SSCC · GTIN-14</span><strong class=\"mono\">" + esc(h.sscc) + "<br>" + esc(h.gtin14) + "</strong></article><article><span>Received</span><strong>" + esc(h.received_eaches) + " eaches · " + esc(h.cases_per_pallet) + " cases × " + esc(h.eaches_per_case) + " on " + esc(h.pallet) + "</strong></article>" + costCard + "</div>" + g +
        table(t.events, ["version", "minute", "kind", "op", "location", "form", "pallets", "cases", "eaches", "parcels", "retained", "scrapped"], "Recorded events");
    };
    sel.onchange = draw;
    draw();
  }

  function load(exp) {
    if (!exp || exp.schema !== "factory-run-ledger/v1" || !Array.isArray(exp.hus) || !Array.isArray(exp.events) || !exp.run) {
      $("rlStatus").textContent = "That file is not a factory-run-ledger/v1 export.";
      return;
    }
    EXP = exp;
    $("rlStatus").textContent = "Loaded " + exp.hus.length + " units and " + exp.events.length + " events from " + exp.run.id + ".";
    $("rlView").hidden = false;
    renderRun(exp); renderPackaging(exp); renderOptimise(exp); renderRibbon(exp); renderFlow(exp); renderViews(exp); renderCost(exp); renderCompare(); renderTrace(exp);
  }

  $("rlFile").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { load(JSON.parse(String(rd.result))); } catch (e) { $("rlStatus").textContent = "Could not read that file: " + e.message; } };
    rd.readAsText(f);
  });
  $("rlDemo").addEventListener("click", () => {
    fetch("test/fixtures/run-ledger.json").then((r) => r.json()).then(load).catch((e) => { $("rlStatus").textContent = "Could not load the example: " + e.message; });
  });
  // v3.37 the second run
  $("rlFileB").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { loadB(JSON.parse(String(rd.result))); } catch (e) { $("rlStatus").textContent = "Could not read that file: " + e.message; } };
    rd.readAsText(f);
  });
  $("rlDemoB").addEventListener("click", () => {
    const go = () => fetch("test/fixtures/run-ledger-b.json").then((r) => r.json()).then(loadB).catch((e) => { $("rlStatus").textContent = "Could not load example B: " + e.message; });
    if (EXP) go(); else fetch("test/fixtures/run-ledger.json").then((r) => r.json()).then((a) => { load(a); go(); }).catch((e) => { $("rlStatus").textContent = "Could not load the example: " + e.message; });
  });
  // handed over from the planner (Simulate -> Live material flow -> Open in the run-ledger viewer)
  try {
    const handed = localStorage.getItem("wt-run-ledger");
    if (handed) { load(JSON.parse(handed)); localStorage.removeItem("wt-run-ledger"); }
  } catch (_) { /* no storage */ }
  RunLedger.load = load;
  RunLedger.loadB = loadB;
  RunLedger.current = () => EXP;
  RunLedger.currentB = () => EXP_B;
})();
