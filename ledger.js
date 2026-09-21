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

  /* ---------------- create ------------------------------------------ */
  // meta = { scenarioId, seed, mix, layout, profile }  (profile: a pack.js profile)
  function create(plan, meta) {
    const m = meta || {};
    const I = WT.ids, P = WT.pack;
    const scenario = m.scenarioId || "custom";
    const layout = m.layout || { gridW: plan.gridW, gridH: plan.gridH, elements: [] };
    const seed = (m.seed != null ? m.seed : plan.seed) >>> 0;
    const mix = m.mix == null ? null : m.mix;
    const profile = m.profile || (P ? P.profileFor(scenario) : null);
    const runId = I ? I.runId(scenario, seed, layout, mix) : "RUN-" + scenario + "-s" + seed;
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
      })),
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
      tick: state.tick, minute: Math.round(state.tick * rec.run.minutes_per_tick * 1000) / 1000,
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
    return {
      schema: SCHEMA,
      run: Object.assign({}, rec.run),
      profile: rec.profile ? { id: rec.profile.id, label: rec.profile.label, box: rec.profile.box, pallet: rec.profile.pallet,
        eaches_per_case: rec.profile.eachesPerCase, case_kg: rec.profile.caseKg, max_stack_mm: rec.profile.maxStackMm,
        eaches_per_parcel: rec.profile.eachesPerParcel } : null,
      locations: rec.locations.slice(),
      hus: hus,
      events: rec.events.slice(),
    };
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

  WT.ledger = { SCHEMA, HONESTY, TERMINAL, create, observe, exportJson, stats, minutesPerTick, locationFor };
})();
