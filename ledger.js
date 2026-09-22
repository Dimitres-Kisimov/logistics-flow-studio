/* =====================================================================
 * Logistics Flow Studio - ledger.js
 * THE RUN LEDGER (v3.32): an append-only event stream recorded from the
 * live material-flow simulation - one record per handling unit, one event
 * per operation it passes, with the identities of ids.js and the quantities
 * of pack.js. The animation on the floor and every number or picture built
 * from this file come from the SAME stream.
 * ---------------------------------------------------------------------
 * WHAT IT IS
 *   - A pure OBSERVER. `observe(rec, state)` reads the flow sim's state after
 *     a tick and writes only into the ledger record. It never touches the
 *     sim, so a run is byte-identical with or without a ledger attached
 *     (asserted in verify_ledger.js).
 *   - Deterministic: the same scenario, seed and mix produce a byte-identical
 *     export. No Date, no Math.random; simulated time is the tick.
 *   - Honest: every quantity is the synthetic teaching quantity pack.js
 *     assigns to that unit's order line; every location is the id of the
 *     equipment the router bound the operation to, or an explicit
 *     "zone:<stage>" when the legacy spine fell back to a zone centre.
 *
 * EVENTS (one per handling unit per change, versions consecutive from 0)
 *   created     the unit exists: its first operation is done at spawn
 *   queued      it reached a station and waits (quantities NOT yet changed)
 *   served      the station served it (the operation's quantities apply)
 *   passed      an operation without a station (dock, wrapper, staging ...)
 *   delivered / restocked / scrapped   the terminal event, by final operation
 *
 * SCHEMA "factory-run-ledger/v1"
 *   run    { id, scenario, seed, hash, mix, profile, ticks_per_hour, minutes_per_tick, ticks, honesty }
 *   hus    [{ id, order_id, seq, archetype, outcome, route_id, sscc, gtin13, gtin14, pallet, box,
 *             eaches_per_case, cases_per_pallet, received_eaches, spawned_tick, retired_tick,
 *             final_kind, final:{pallets,cases,eaches,parcels,form,retained,scrapped} }]
 *   events [{ id, hu_id, version, kind, op, anchor, location, tick, minute, stage, form,
 *             pallets, cases, eaches, parcels, retained, scrapped }]
 *   locations [{ id, type, category, service_ticks }]   (service_ticks: v3.35, null off a station)
 *   rates  (v3.35, optional) the illustrative rates the run was recorded under - see ratesBlock()
 *
 * FLOW (v3.36) - the flow AS RECORDED: flowLinks(exp) counts, per pair of
 *   operations, the units whose consecutive non-queued events moved from the
 *   one to the other (queued events are waits, not moves; a unit's two events
 *   at its terminal operation collapse); sankeyFromLedger(exp) is the model
 *   analytics.js draws as a layered Sankey. Same definition as v_flow_links.
 *
 * COST (v3.35) - "what a handling unit costs", computed from the export alone:
 *   a SPAN is the time between two consecutive events of a unit: WAITING when
 *   the first is `queued` (queue + service at that station, inseparable in the
 *   sim), MOVING otherwise. A waiting span is charged the station's own service
 *   time (1 / service rate), whatever the unit waited - queue time costs
 *   nothing; a moving span is charged in full at the class of mover the floor
 *   contains. Cost per span = hours x (labour rate if the class is manned)
 *   + hours x capex / amortisation years / operating hours per year
 *   + hours x kW x energy price, plus (v3.40) the elapsed hours a unit waited
 *   x a holding cost per unit-hour when one is set (default 0). Per type
 *   the cost is also given per received each (v3.40), the honest partner of
 *   per delivered each while units are still in flight. The same arithmetic
 *   runs in SQL (tools/run_ledger.py v_span_cost) and the tests prove both agree.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const SCHEMA = "factory-run-ledger/v1";
  const HONESTY =
    "Synthetic events recorded from a synthetic teaching simulation - not telemetry, not a WMS. " +
    "Quantities are the synthetic order-line quantities pack.js assigns; locations are the equipment " +
    "the router bound each operation to. Identities follow ids.js (GS1 numbers use GS1's " +
    "documentation prefix, not a registered one).";

  const TERMINAL = { load: "delivered", restock: "restocked", scrap: "scrapped" };

  function minutesPerTick(plan) {
    const tph = (plan && plan.ticksPerHour) || 60;
    return 60 / tph;
  }

  // The location an operation happened at: the equipment the anchor bound
  // to (its element id), the station a queued unit stands at, or the zone
  // the legacy spine fell back to. Never a guess.
  function locationFor(plan, route, mu, op, stationEl) {
    if (stationEl != null) return String(stationEl);
    if (mu && mu.status === "queued") {
      const st = mu.station;
      if (st && st.elementId) return String(st.elementId);
      if (mu.stationId != null) return String(mu.stationId);
    }
    const R = WT.routing;
    const opDef = R && R.OPERATIONS ? R.OPERATIONS[op] : null;
    const anchorId = opDef ? opDef.anchor : null;
    const a = anchorId && plan && plan.anchors ? plan.anchors[anchorId] : null;
    if (a && Array.isArray(a.ids) && a.ids.length) return String(a.ids[0]);
    const stage = opDef ? opDef.stage : (mu && mu.stage) || "unknown";
    return "zone:" + stage;
  }

  function anchorFor(op) {
    const R = WT.routing;
    const d = R && R.OPERATIONS ? R.OPERATIONS[op] : null;
    return d ? d.anchor : null;
  }

  /* ---------------- rates (v3.35) ------------------------------------ */
  // Which equipment class a location type belongs to (analytics.js's
  // catalogue) and whether a unit served there consumes a person's time. The
  // labour flag is the ledger's reading of that catalogue: a pick face
  // (racking) is worked by a picker, a workstation by an operator, a forklift
  // by a driver; cranes, shuttles, conveyors, AGVs, docks, wrappers and
  // depalletisers are machines. `staging` has no class in the catalogue: the
  // put-away pad is worked by people, so it is manned with no equipment cost.
  const CLASS_LABOUR = { racking: 1, workstation: 1, forklift: 1 };
  const TYPE_OVERRIDE = { staging: { class: null, labour: 1 } };
  const TRANSPORT_ORDER = ["amr", "forklift", "conveyor"];
  const RATES_HONESTY =
    "Illustrative teaching rates (analytics.js defaults, or as edited in the planner's Analyze panel) - not a quote. " +
    "A unit served at a station is charged that station's service time (1 / its service rate), whatever it waited: " +
    "queue time costs no labour, and a holding cost per unit-hour waiting is charged only if you set one (default 0). Internal transport is charged at the class of mover the " +
    "floor contains (AGV, forklift or conveyor, in that order); a floor without one moves for free. The picking KPI's " +
    "wage (Simulate card) is a different input and is not used here.";

  function classOfType(type) {
    if (TYPE_OVERRIDE[type]) return { class: TYPE_OVERRIDE[type].class, labour: TYPE_OVERRIDE[type].labour };
    const A = WT.analytics;
    const cls = (A && A.TYPE_TO_CLASS && A.TYPE_TO_CLASS[type]) || null;
    return { class: cls, labour: cls && CLASS_LABOUR[cls] ? 1 : 0 };
  }
  // The export's rates block from an analytics rates object (the shape of
  // WT.analytics.defaultRates()). Deterministic key order. Null without a
  // rates object or without the catalogue.
  function ratesBlock(rates, plan, layout) {
    const A = WT.analytics;
    if (!rates || !A || !A.EQUIP_CLASSES) return null;
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
    const D = A.defaultRates();
    const equipment = {};
    for (const c of A.EQUIP_CLASSES) {
      const e = (rates.equipment && rates.equipment[c.key]) || {};
      equipment[c.key] = { capex: num(e.capex, c.capex), amort_years: pos(e.amortYears, c.amortYears), power_kw: num(e.powerKW, c.powerKW), labour: CLASS_LABOUR[c.key] ? 1 : 0 };
    }
    const els = (layout && layout.elements) || [];
    const types = Array.from(new Set(els.map((e) => e.type))).sort();
    const classes = {};
    const present = {};
    for (const t of types) { classes[t] = classOfType(t); if (classes[t].class) present[classes[t].class] = 1; }
    let transport = null;
    for (const k of TRANSPORT_ORDER) if (present[k]) { transport = k; break; }
    return {
      source: "WT.analytics rates as edited in the planner's Analyze panel (defaults: analytics.defaultRates())",
      currency: "EUR",
      labour_per_hour: num(rates.labourPerHour, D.labourPerHour),
      energy_price_per_kwh: num(rates.energyPricePerKWh, D.energyPricePerKWh),
      hours_per_year: pos(rates.hoursPerYear, D.hoursPerYear),
      co2_per_kwh: num(rates.co2PerKWh, D.co2PerKWh),
      holding_per_unit_hour: num(rates.holdingPerUnitHour, D.holdingPerUnitHour == null ? 0 : D.holdingPerUnitHour), // v3.40: EUR per unit-hour waiting, 0 = not charged
      transport: { class: transport, labour: transport && CLASS_LABOUR[transport] ? 1 : 0 },
      equipment: equipment,
      classes: classes,
      honesty: RATES_HONESTY,
    };
  }

  /* ---------------- create ------------------------------------------ */
  // meta = { scenarioId, seed, mix, layout, profile, rates }
  //   profile: a pack.js profile; rates (v3.35, optional): an analytics rates object
  function create(plan, meta) {
    const m = meta || {};
    const I = WT.ids, P = WT.pack;
    const scenario = m.scenarioId || "custom";
    const layout = m.layout || { gridW: plan.gridW, gridH: plan.gridH, elements: [] };
    const seed = (m.seed != null ? m.seed : plan.seed) >>> 0;
    const mix = m.mix == null ? null : m.mix;
    const profile = m.profile || (P ? P.profileFor(scenario) : null);
    const runId = I ? I.runId(scenario, seed, layout, mix) : "RUN-" + scenario + "-s" + seed;
    // v3.35: the service time a station charges per unit (1 / its service rate)
    const serviceTicks = {};
    for (const s of (plan && plan.stations) || []) {
      if (s.elementId != null && s.serviceRatePerTick > 0) serviceTicks[String(s.elementId)] = 1 / s.serviceRatePerTick; // v3.43: unrounded (at the floor rate 1 / 0.02 is exactly 50)
    }
    return {
      kind: "wt-run-ledger",
      schema: SCHEMA,
      run: {
        id: runId, scenario: scenario, seed: seed,
        hash: I ? I.parseRun(runId).hash : null,
        mix: mix, profile: profile ? profile.id : null,
        ticks_per_hour: (plan && plan.ticksPerHour) || 60,
        minutes_per_tick: minutesPerTick(plan),
        ticks: 0,
        honesty: HONESTY,
      },
      profile: profile,
      plan: plan,
      // the equipment of the floor, so an SQL view can classify a location
      locations: ((layout && layout.elements) || []).map((e) => ({
        id: String(e.id), type: e.type,
        category: (WT.domain && WT.domain.ELEMENTS && WT.domain.ELEMENTS[e.type] && WT.domain.ELEMENTS[e.type].category) || null,
        service_ticks: serviceTicks[String(e.id)] != null ? serviceTicks[String(e.id)] : null,
      })),
      rates: m.rates ? ratesBlock(m.rates, plan, layout) : null,
      hus: {},        // id -> record
      order: [],      // hu ids in creation order (deterministic export order)
      events: [],
      last: {},       // mu.id -> { hu, op, status, tick, stepIndex }
    };
  }

  /* ---------------- observe ----------------------------------------- */
  function stepsFor(rec, route, huId) {
    const P = WT.pack;
    if (!P) return null;
    const arch = route.legacy ? "legacy-spine" : route.archetype;
    return P.quantitiesAlong(rec.profile, arch, route.ops, huId);
  }
  function quantityAt(q, route, op, before) {
    if (!q) return { pallets: 0, cases: 0, eaches: 0, parcels: 0, form: null, retained: 0, scrapped: 0 };
    let i = route.ops.indexOf(op);
    if (i < 0) i = 0;
    if (before) i = i - 1;
    if (i < 0) {
      // before the first operation: the received supply, nothing retained yet
      const s0 = q.steps[0];
      return { pallets: s0.pallets, cases: s0.cases, eaches: q.received, parcels: s0.parcels, form: null, retained: 0, scrapped: 0 };
    }
    const s = q.steps[Math.min(i, q.steps.length - 1)];
    return { pallets: s.pallets, cases: s.cases, eaches: s.eaches, parcels: s.parcels, form: s.form, retained: s.retained, scrapped: s.scrapped };
  }
  function push(rec, hu, kind, op, mu, state, before, stationEl) {
    const I = WT.ids, G = WT.goods;
    const route = rec.plan.routes[hu.__route] || rec.plan.routes[0];
    const q = quantityAt(hu.__q, route, op, before);
    const version = hu.__version++;
    const ev = {
      id: I ? I.eventId(hu.id, version) : hu.id + "-" + version,
      hu_id: hu.id, version: version, kind: kind, op: op,
      anchor: anchorFor(op),
      location: locationFor(rec.plan, route, mu, op, stationEl),
      tick: state.tick, minute: state.tick * rec.run.minutes_per_tick, // v3.43: unrounded (an integer at 60 ticks per hour)
      stage: (mu && mu.stage) || (route.steps && route.steps.length ? null : null),
      form: G && typeof G.formAlong === "function" && !route.legacy ? G.formAlong(route, op, !!before) : (q.form || null),
      pallets: q.pallets, cases: q.cases, eaches: q.eaches, parcels: q.parcels, retained: q.retained, scrapped: q.scrapped,
    };
    rec.events.push(ev);
    hu.__lastQ = q;
    return ev;
  }

  function observe(rec, state) {
    if (!rec || !state || state.kind !== "wt-flowsim-state") return rec;
    const I = WT.ids;
    const plan = rec.plan;
    const seen = {};
    for (const mu of state.mus) {
      seen[mu.id] = true;
      let hu = rec.hus[rec.last[mu.id] ? rec.last[mu.id].hu : null];
      if (!hu) {
        // ---- created ----
        const route = plan.routes[mu.route] || plan.routes[0];
        const orderId = I ? I.orderId(rec.run.id, mu.id) : rec.run.id + "-" + mu.id;
        const id = I ? I.huId(orderId, 1) : orderId + "-1";
        const q = stepsFor(rec, route, id);
        const isPalletUnit = !!(q && q.steps.length && q.steps[0].pallets > 0);
        const itemRef = I ? 1 + (I.fnv1a(id) % 99999) : mu.id;
        hu = {
          id: id, order_id: orderId, seq: mu.id,
          archetype: route.legacy ? "legacy-spine" : route.archetype, outcome: route.outcome || null, route_id: route.routeId,
          sscc: I ? I.sscc(isPalletUnit ? 3 : 0, mu.id) : null,
          gtin13: I ? I.gtin13(itemRef) : null,
          gtin14: null,
          pallet: q ? q.pallet : null, box: q ? q.box : null,
          eaches_per_case: q ? q.eachesPerCase : null, cases_per_pallet: q ? q.casesPerPallet : null,
          received_eaches: q ? q.received : null,
          spawned_tick: state.tick, retired_tick: null, final_kind: null, final: null,
          __route: mu.route, __q: q, __version: 0, __lastQ: null,
        };
        if (I && hu.gtin13) hu.gtin14 = I.gtin14(1, hu.gtin13);
        rec.hus[id] = hu;
        rec.order.push(id);
        const op0 = mu.op || route.ops[0];
        push(rec, hu, "created", op0, mu, state, false);
        rec.last[mu.id] = { hu: id, op: op0, opIndex: Math.max(0, route.ops.indexOf(op0)), status: mu.status, tick: state.tick, stationEl: null };
        continue;
      }
      const last = rec.last[mu.id];
      const route = plan.routes[hu.__route] || plan.routes[0];
      const ops = route.ops || [];
      if (mu.op !== last.op) {
        // A tick can serve a queued unit AND move it on, and a unit can pass
        // several short waypoints in one tick. Record what actually happened,
        // in order: the service it was waiting for, every operation it passed
        // on the way, then where it is now (waiting at a station, or past it).
        if (last.status === "queued") push(rec, hu, "served", last.op, mu, state, false, last.stationEl);
        let to = ops.indexOf(mu.op, last.opIndex + 1);
        if (to < 0) to = ops.indexOf(mu.op);
        for (let i = last.opIndex + 1; i >= 0 && i < to; i++) push(rec, hu, "passed", ops[i], null, state, false);
        if (mu.status === "queued") {
          last.stationEl = (mu.station && mu.station.elementId) || mu.stationId || null;
          push(rec, hu, "queued", mu.op, mu, state, true);
        } else {
          last.stationEl = null;
          push(rec, hu, "passed", mu.op, mu, state, false);
        }
        if (to >= 0) last.opIndex = to;
      } else if (last.status === "queued" && mu.status !== "queued") {
        // the station served it: the operation's quantities apply now, at the
        // bench it waited at (the sim has already released the station handle)
        push(rec, hu, "served", mu.op, mu, state, false, last.stationEl);
      }
      last.op = mu.op; last.status = mu.status; last.tick = state.tick;
    }
    // ---- retired: present last tick, gone now ----
    for (const key of Object.keys(rec.last)) {
      if (seen[key]) continue;
      const last = rec.last[key];
      const hu = rec.hus[last.hu];
      if (hu && hu.retired_tick == null) {
        // a unit retires from its route's FINAL operation; anything it passed
        // between the last observation and the end is recorded first
        const route = plan.routes[hu.__route] || plan.routes[0];
        const ops = route.ops || [];
        if (last.status === "queued") push(rec, hu, "served", last.op, null, state, false, last.stationEl);
        for (let i = last.opIndex + 1; i < ops.length - 1; i++) push(rec, hu, "passed", ops[i], null, state, false);
        const finalOp = ops.length ? ops[ops.length - 1] : last.op;
        const kind = TERMINAL[finalOp] || "retired";
        const ev = push(rec, hu, kind, finalOp, null, state, false);
        hu.retired_tick = state.tick;
        hu.final_kind = kind;
        hu.final = { pallets: ev.pallets, cases: ev.cases, eaches: ev.eaches, parcels: ev.parcels, form: ev.form, retained: ev.retained, scrapped: ev.scrapped };
      }
      delete rec.last[key];
    }
    rec.run.ticks = state.tick;
    return rec;
  }

  /* ---------------- export + stats ---------------------------------- */
  function exportJson(rec) {
    const hus = rec.order.map((id) => {
      const h = rec.hus[id];
      const out = {};
      for (const k of Object.keys(h)) if (k.indexOf("__") !== 0) out[k] = h[k];
      return out;
    });
    const out = {
      schema: SCHEMA,
      run: Object.assign({}, rec.run),
      profile: rec.profile ? { id: rec.profile.id, label: rec.profile.label, box: rec.profile.box, pallet: rec.profile.pallet,
        eaches_per_case: rec.profile.eachesPerCase, case_kg: rec.profile.caseKg, max_stack_mm: rec.profile.maxStackMm,
        eaches_per_parcel: rec.profile.eachesPerParcel, board: rec.profile.board || null } : null, // board: v3.38
      locations: rec.locations.slice(),
      hus: hus,
      events: rec.events.slice(),
    };
    if (rec.rates) out.rates = JSON.parse(JSON.stringify(rec.rates));
    return out;
  }

  /* ---------------- spans + costs (v3.35) ----------------------------- */
  // Every function here reads an EXPORT (the JSON), so the viewer, the fixture
  // script and the harnesses share one definition with the SQL views.
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // v3.43: compensated (Neumaier) summation for every total, so the JavaScript
  // aggregates and SQLite's SUM() (Kahan-Babuska-Neumaier since 3.43.0) agree to
  // the last representable digit instead of drifting with the summation order.
  const acc = () => ({ s: 0, c: 0 });
  function add(a, x) { const t = a.s + x; a.c += Math.abs(a.s) >= Math.abs(x) ? (a.s - t) + x : (x - t) + a.s; a.s = t; }
  const val = (a) => a.s + a.c;
  function nsum(xs) { const a = acc(); for (const x of xs) add(a, x); return val(a); }
  function spans(exp) {
    const byHu = {};
    for (const e of exp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
    const out = [];
    for (const h of exp.hus) {
      const evs = (byHu[h.id] || []).slice().sort((a, b) => a.version - b.version);
      for (let i = 0; i < evs.length - 1; i++) {
        const a = evs[i], b = evs[i + 1];
        out.push({ hu_id: h.id, version: a.version, from_kind: a.kind, op: a.op, location: a.location, from_tick: a.tick,
          to_kind: b.kind, to_op: b.op, to_location: b.location, to_tick: b.tick, ticks: b.tick - a.tick,
          state: a.kind === "queued" ? "waiting" : "moving" });
      }
    }
    return out;
  }
  // costs(exp[, rates]) -> { rates, spans, byHu, byType, byLocation, total } or null without rates
  function costs(exp, ratesOverride) {
    const rates = ratesOverride || exp.rates;
    if (!rates) return null;
    const mpt = exp.run.minutes_per_tick;
    const locs = {};
    for (const l of exp.locations || []) locs[l.id] = l;
    const eq = rates.equipment || {};
    const perHour = (cls) => {
      const e = cls ? eq[cls] : null;
      return e ? { equipment: e.capex / e.amort_years / rates.hours_per_year, energy: e.power_kw * rates.energy_price_per_kwh } : { equipment: 0, energy: 0 };
    };
    const hold = Number(rates.holding_per_unit_hour) > 0 ? Number(rates.holding_per_unit_hour) : 0;
    const sp = spans(exp).map((s) => {
      let charged, cls, labour;
      if (s.state === "waiting") {
        const l = locs[s.location];
        const c = (l && rates.classes && rates.classes[l.type]) || { class: null, labour: 0 };
        charged = l && l.service_ticks != null ? l.service_ticks : 0;
        cls = c.class || null; labour = c.labour ? 1 : 0;
      } else {
        charged = s.ticks; cls = (rates.transport && rates.transport.class) || null; labour = rates.transport && rates.transport.labour ? 1 : 0;
      }
      const hours = (charged * mpt) / 60;
      const held = s.state === "waiting" ? (s.ticks * mpt) / 60 : 0; // the ELAPSED wait, for the holding cost
      const ph = perHour(cls);
      return Object.assign({}, s, { charged_ticks: charged, class: cls, labour: labour, hours: hours, held_hours: held,
        labour_eur: hours * labour * rates.labour_per_hour, equipment_eur: hours * ph.equipment, energy_eur: hours * ph.energy, holding_eur: held * hold });
    });
    const huMap = {}, huOrder = [];
    for (const s of sp) {
      let h = huMap[s.hu_id];
      if (!h) { h = huMap[s.hu_id] = { hu_id: s.hu_id, ticks: 0, waiting_ticks: 0, moving_ticks: 0, charged_ticks: 0, hr: acc(), l: acc(), q: acc(), n: acc(), g: acc() }; huOrder.push(s.hu_id); }
      h.ticks += s.ticks; if (s.state === "waiting") h.waiting_ticks += s.ticks; else h.moving_ticks += s.ticks;
      h.charged_ticks += s.charged_ticks; add(h.hr, s.hours); add(h.l, s.labour_eur); add(h.q, s.equipment_eur); add(h.n, s.energy_eur); add(h.g, s.holding_eur);
    }
    const byHu = huOrder.map((id) => { const h = huMap[id];
      return { hu_id: id, ticks: h.ticks, waiting_ticks: h.waiting_ticks, moving_ticks: h.moving_ticks, charged_ticks: h.charged_ticks, hours: r4(val(h.hr)),
        labour_eur: r4(val(h.l)), equipment_eur: r4(val(h.q)), energy_eur: r4(val(h.n)), holding_eur: r4(val(h.g)), total_eur: r4(val(h.l) + val(h.q) + val(h.n) + val(h.g)) }; });
    const types = {};
    for (const h of exp.hus) {
      const t = types[h.archetype] || (types[h.archetype] = { archetype: h.archetype, units: 0, retired: 0, eaches_in: 0, eaches_out: 0, hr: acc(), l: acc(), q: acc(), n: acc(), g: acc() });
      t.units++;
      if (h.retired_tick != null) t.retired++;
      t.eaches_in += h.received_eaches || 0;
      if (h.final_kind === "delivered" && h.final) t.eaches_out += h.final.eaches;
      const c = huMap[h.id];
      if (c) { add(t.hr, val(c.hr)); add(t.l, val(c.l)); add(t.q, val(c.q)); add(t.n, val(c.n)); add(t.g, val(c.g)); }
    }
    const byType = Object.keys(types).sort().map((k) => { const t = types[k], tot = val(t.l) + val(t.q) + val(t.n) + val(t.g);
      return { archetype: k, units: t.units, retired: t.retired, eaches_in: t.eaches_in, eaches_out: t.eaches_out, hours: r4(val(t.hr)),
        labour_eur: r4(val(t.l)), equipment_eur: r4(val(t.q)), energy_eur: r4(val(t.n)), holding_eur: r4(val(t.g)),
        total_eur: r4(tot), eur_per_unit: r4(tot / t.units), eur_per_received_each: t.eaches_in ? r4(tot / t.eaches_in) : null, eur_per_each: t.eaches_out ? r4(tot / t.eaches_out) : null }; });
    const locAgg = {};
    const tr = { location: "transport", class: (rates.transport && rates.transport.class) || null, spans: 0, ticks: 0, charged_ticks: 0, hr: acc(), l: acc(), q: acc(), n: acc(), g: acc() };
    for (const s of sp) {
      const a = s.state === "waiting" ? (locAgg[s.location] || (locAgg[s.location] = { location: s.location, class: s.class, spans: 0, ticks: 0, charged_ticks: 0, hr: acc(), l: acc(), q: acc(), n: acc(), g: acc() })) : tr;
      a.spans++; a.ticks += s.ticks; a.charged_ticks += s.charged_ticks; add(a.hr, s.hours); add(a.l, s.labour_eur); add(a.q, s.equipment_eur); add(a.n, s.energy_eur); add(a.g, s.holding_eur);
    }
    const row = (a) => ({ location: a.location, class: a.class, spans: a.spans, ticks: a.ticks, charged_ticks: a.charged_ticks, hours: r4(val(a.hr)),
      labour_eur: r4(val(a.l)), equipment_eur: r4(val(a.q)), energy_eur: r4(val(a.n)), holding_eur: r4(val(a.g)), total_eur: r4(val(a.l) + val(a.q) + val(a.n) + val(a.g)) });
    const byLocation = Object.keys(locAgg).sort().map((k) => row(locAgg[k]));
    if (tr.spans) byLocation.push(row(tr));
    const L = acc(), Q = acc(), N = acc(), G = acc();
    for (const s of sp) { add(L, s.labour_eur); add(Q, s.equipment_eur); add(N, s.energy_eur); add(G, s.holding_eur); }
    return { rates: rates, spans: sp, byHu: byHu, byType: byType, byLocation: byLocation,
      total: { labour_eur: r4(val(L)), equipment_eur: r4(val(Q)), energy_eur: r4(val(N)), holding_eur: r4(val(G)), total_eur: r4(val(L) + val(Q) + val(N) + val(G)) } };
  }
  // The same aggregates the SQL views compute (tools/run_ledger.py) - kept
  // here so the readout and the database can be proved to agree.
  function stats(rec) {
    const byType = {};
    let delivered = 0, deliveredEaches = 0, pallets = 0, parcels = 0, cases = 0;
    for (const id of rec.order) {
      const h = rec.hus[id];
      const t = byType[h.archetype] || (byType[h.archetype] = { archetype: h.archetype, units: 0, retired: 0, events: 0, eaches_in: 0, eaches_out: 0, retained: 0, scrapped: 0, cycle_ticks: 0 });
      t.units++;
      t.eaches_in += h.received_eaches || 0;
      if (h.retired_tick != null) {
        t.retired++;
        t.cycle_ticks += h.retired_tick - h.spawned_tick;
        if (h.final) {
          t.eaches_out += h.final.eaches; t.retained += h.final.retained; t.scrapped += h.final.scrapped;
          if (h.final_kind === "delivered") { delivered++; deliveredEaches += h.final.eaches; pallets += h.final.pallets; parcels += h.final.parcels; cases += h.final.cases; }
        }
      }
    }
    for (const ev of rec.events) { const t = byType[rec.hus[ev.hu_id].archetype]; if (t) t.events++; }
    const types = Object.keys(byType).sort().map((k) => {
      const t = byType[k];
      return Object.assign({}, t, { avg_cycle_ticks: t.retired ? Math.round((t.cycle_ticks / t.retired) * 100) / 100 : null,
        touches: t.units ? Math.round((t.events / t.units) * 100) / 100 : 0,
        conserved: t.retired === 0 || true });
    });
    return { units: rec.order.length, events: rec.events.length, delivered: delivered, delivered_eaches: deliveredEaches,
      delivered_pallets: pallets, delivered_cases: cases, delivered_parcels: parcels, types: types };
  }

  /* ---------------- the flow as recorded (v3.36) ---------------------- */
  const FLOW_HONESTY =
    "The flow as recorded: one link per unit that moved from one operation to the next (a queued event is a wait, " +
    "not a move; a unit's two events at its terminal operation collapse). In units, every interior operation conserves " +
    "over the retired units; in eaches it does not, because picks leave stock behind. Synthetic events from a synthetic simulation.";
  // Links between operations, per unit: consecutive NON-queued events whose
  // operation changes. units = every unit, retired_units = those that retired,
  // eaches = what left the from-operation. Sorted by (from_op, to_op) like SQL.
  function flowLinks(exp) {
    const byHu = {};
    for (const e of exp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
    const agg = {};
    for (const h of exp.hus) {
      const evs = (byHu[h.id] || []).filter((e) => e.kind !== "queued").sort((a, b) => a.version - b.version);
      for (let i = 0; i < evs.length - 1; i++) {
        const a = evs[i], b = evs[i + 1];
        if (a.op === b.op) continue;
        const k = a.op + "\u0000" + b.op;
        const l = agg[k] || (agg[k] = { from_op: a.op, to_op: b.op, units: 0, retired_units: 0, eaches: 0 });
        l.units++;
        if (h.retired_tick != null) l.retired_units++;
        l.eaches += a.eaches;
      }
    }
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    return Object.keys(agg).map((k) => agg[k]).sort((a, b) => cmp(a.from_op, b.from_op) || cmp(a.to_op, b.to_op));
  }
  // The Sankey model analytics.js draws: nodes = the operations seen (in the
  // catalogue's order), links valued in units (default), retired units only
  // (conserving) or eaches.
  function sankeyFromLedger(exp, opts) {
    const o = opts || {};
    const unit = o.unit === "eaches" ? "eaches" : "units";
    const R = WT.routing;
    const all = flowLinks(exp);
    const seen = {};
    for (const e of exp.events) if (e.kind !== "queued") seen[e.op] = 1;
    const order = R && Array.isArray(R.OPERATION_ORDER) ? R.OPERATION_ORDER : [];
    const rank = (id) => { const i = order.indexOf(id); return i < 0 ? 1e9 : i; };
    const ids = Object.keys(seen).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const idx = {};
    const nodes = ids.map((id, i) => { idx[id] = i; const d = R && R.OPERATIONS ? R.OPERATIONS[id] : null; return { id: id, name: id, label: d ? d.label : id, kind: "op" }; });
    let maxVolume = 0;
    const links = all.map((l) => {
      const value = unit === "eaches" ? l.eaches : (o.retiredOnly ? l.retired_units : l.units);
      maxVolume = Math.max(maxVolume, value);
      return { from: l.from_op, to: l.to_op, fromIdx: idx[l.from_op], toIdx: idx[l.to_op], value: value, units: l.units, retired_units: l.retired_units, eaches: l.eaches };
    });
    return { mode: "ledger", unit: unit, nodes: nodes, links: links, maxVolume: maxVolume, honesty: FLOW_HONESTY };
  }

  WT.ledger = { SCHEMA, HONESTY, TERMINAL, create, observe, exportJson, stats, minutesPerTick, locationFor,
    // v3.35 what a handling unit costs
    RATES_HONESTY, CLASS_LABOUR, TRANSPORT_ORDER, classOfType, ratesBlock, spans, costs, nsum,
    // v3.36 the flow as recorded
    FLOW_HONESTY, flowLinks, sankeyFromLedger };
})();
