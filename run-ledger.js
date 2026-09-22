/* =====================================================================
 * Logistics Flow Studio - run-ledger.js
 * THE RUN-LEDGER VIEWER (v3.33, restructured v3.39): the whole run from
 * start to finish, drawn from ONE file - the `factory-run-ledger/v1` export
 * the simulator records - as one report.
 * ---------------------------------------------------------------------
 * Every table on the page is computed by the SAME definitions as the SQL
 * views in tools/run_ledger.py (RunLedger.views mirrors them one for one),
 * and the SQL shown under each table IS the view SQLite runs: run-ledger-sql.js
 * is generated from tools/run_ledger.py by tools/export_viewer_sql.py and a
 * test fails when it is stale. The test suite proves JavaScript and SQLite
 * agree on the recorded fixtures and on a hand-built ledger with hand-computed
 * answers. Nothing on the page is measured off a drawing.
 *
 * Sections (v3.39 order): the run at a glance (identity, totals, cost,
 * invariants, data-quality flags) · start to finish (the ribbon per order
 * type; the flow as recorded, a layered Sankey) · what the planner asks
 * (cycle time, touches, waiting, WIP, quantities) · what a handling unit
 * costs · the dispatch manifest · packaging (hierarchy, the pattern
 * optimiser, your case) · trace one unit · compare two runs · the
 * invariants · the appendix (how to read the page, reproduce commands).
 *
 * Pure model (RunLedger.model / views / ribbon / trace / compare / yourCase /
 * glance / csv) + DOM rendering. Everything derived from an export is
 * computed ONCE per export (RunLedger.model memoises on the object). No Date,
 * no Math.random, no network beyond loading the local example files.
 * ===================================================================== */
(function () {
  "use strict";
  const RunLedger = (window.RunLedger = window.RunLedger || {});
  const TRAILER_SLOTS = { eur: 33, ind: 26, half: 66, drum: 22, cage: 26 };
  const STORAGE_OPS = { putaway: 1, replen: 1, pick: 1, "piece-pick": 1, "case-pick": 1, "pallet-pick": 1 };
  const TERMINAL = { delivered: 1, restocked: 1, scrapped: 1 };
  // 1 / flowsim.js PARAMS.minStationServicePerTick (0.02): the service time a
  // station gets when its floor declares no capacity. ledger.js records
  // round(1 / rate, 4), so a station at the floor rate carries exactly 50.
  const FLOOR_SERVICE_TICKS = 50;
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // the SQL shown under every table: generated from tools/run_ledger.py (run-ledger-sql.js)
  const SQL = window.RunLedgerSQL || {};

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
  function computeViews(exp, m) {
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
    // v3.35 what a handling unit costs / v3.36 the flow - the same definitions as
    // the SQL views (WT.ledger); computed once per export by model(), null without
    // rates or without ledger.js
    const cost = m.costs;
    return { summary, cycle, touches, wait, wip, byOp, dispatch,
      invariants: { v_conservation_violations: conservation, v_cross_dock_violations: crossDock, v_version_gaps: versionGaps, v_terminal_violations: terminals },
      flowLinks: m.flowLinks,
      rates: exp.rates || null, spans: cost ? cost.spans : null, costByHu: cost ? cost.byHu : null,
      costByType: cost ? cost.byType : null, costByLocation: cost ? cost.byLocation : null, costTotal: cost ? cost.total : null };
  }

  /* ---------------- the memo (v3.39): everything once per export ------ */
  const MEMO = typeof WeakMap === "function" ? new WeakMap() : null;
  function model(exp) {
    let m = MEMO && MEMO.get(exp);
    if (m) return m;
    const Lg = window.WT && window.WT.ledger;
    m = { exp: exp, sankeys: {} };
    m.costs = Lg && typeof Lg.costs === "function" ? Lg.costs(exp) : null;
    m.flowLinks = Lg && typeof Lg.flowLinks === "function" ? Lg.flowLinks(exp) : null;
    m.views = computeViews(exp, m);
    m.ribbon = ribbon(exp);
    m.costByHu = {};
    if (m.costs) for (const r of m.costs.byHu) m.costByHu[r.hu_id] = r;
    // (unit, retiredOnly) -> the Sankey model, built once per combination
    m.sankey = (unit, retiredOnly) => {
      const k = unit + (retiredOnly ? ":retired" : "");
      if (!m.sankeys[k] && Lg && typeof Lg.sankeyFromLedger === "function") m.sankeys[k] = Lg.sankeyFromLedger(exp, { unit: unit, retiredOnly: !!retiredOnly });
      return m.sankeys[k] || null;
    };
    if (MEMO) MEMO.set(exp, m);
    return m;
  }
  function views(exp) { return model(exp).views; }

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

  /* ---------------- your case (v3.38) ------------------------------- */
  // A case of your own on every standard pallet (and a custom one): pattern,
  // layers under the height / load / strength limits, the strength verdict.
  // Pure; the page's form calls it (debounced) on every change.
  function yourCase(inp) {
    const P = window.WT && window.WT.pack;
    if (!P) return null;
    const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
    const box = { id: "custom", label: "your case " + n(inp.l, 0) + " × " + n(inp.w, 0) + " × " + n(inp.h, 0), l: n(inp.l, 0), w: n(inp.w, 0), h: n(inp.h, 0) };
    if (!(box.l > 0 && box.w > 0 && box.h > 0)) return { error: "case length, width and height must be positive" };
    const board = n(inp.ect, 0) > 0 && n(inp.caliper, 0) > 0 ? { ectKNm: n(inp.ect, 0), caliperMm: n(inp.caliper, 0) } : null;
    const factors = { humidity: inp.humidity, duration: inp.duration, overhang: inp.overhang, pattern: inp.pattern };
    const stack = { palletsOnTop: Math.max(0, Math.floor(n(inp.palletsOnTop, 0))) };
    const pallets = { eur: P.PALLETS.eur, ind: P.PALLETS.ind, half: P.PALLETS.half };
    if (n(inp.palletL, 0) > 0 && n(inp.palletW, 0) > 0) {
      pallets.custom = { id: "custom", label: "your pallet " + n(inp.palletL, 0) + " × " + n(inp.palletW, 0), l: n(inp.palletL, 0), w: n(inp.palletW, 0), h: 144, tareKg: 25, maxLoadKg: n(inp.palletLoad, 1500) > 0 ? n(inp.palletLoad, 1500) : 1500, standard: "your pallet", trailerSlots: 0 };
    }
    const rows = Object.keys(pallets).map((id) => Object.assign({ pallet: id, label: pallets[id].label }, P.tiHi(pallets[id], box, n(inp.stackMm, 1800), n(inp.kg, 0), board, factors, stack)));
    rows.sort((a, b) => b.cases - a.cases || b.cubeUtil - a.cubeUtil || (a.pallet < b.pallet ? -1 : a.pallet > b.pallet ? 1 : 0));
    return { box: box, board: board, factors: P.stackFactor(factors), stack: stack, rows: rows, best: rows[0] || null, pallets: pallets };
  }

  /* ---------------- the run at a glance (v3.39) ---------------------- */
  // The order mix as text: an array of {id, share} (the recorder), an object
  // (older hand files), or none (the standard spine).
  function mixOf(r) {
    if (!r || !r.mix) return "standard spine (no mix)";
    if (Array.isArray(r.mix)) return r.mix.map((m) => m.id + " " + Math.round(m.share * 100) + "%").join(" · ");
    return Object.keys(r.mix).map((k) => k + " " + Math.round(r.mix[k] * 100) + "%").join(" · ");
  }
  // Identity, totals, cost, invariants and the DATA-QUALITY FLAGS a reader
  // must know before trusting any table. Pure.
  function glance(exp) {
    const m = model(exp), v = m.views, r = exp.run;
    const stations = (exp.locations || []).filter((l) => l.service_ticks != null);
    const atFloor = stations.filter((l) => Math.abs(l.service_ticks - FLOOR_SERVICE_TICKS) < 1e-6);
    const retired = exp.hus.filter((h) => h.retired_tick != null).length;
    const inFlight = exp.hus.length - retired;
    const eachesOut = v.summary.delivered_eaches;
    const flags = [];
    if (!exp.rates) flags.push({ kind: "no-rates", text: "This file carries no rates: the cost section is empty. Export it from the planner (v3.35 or later) to cost its units." });
    if (stations.length && atFloor.length === stations.length) {
      flags.push({ kind: "floor-rate", text: "Every station on this floor (" + stations.length + ") serves at the simulator's floor rate: a service time of " + FLOOR_SERVICE_TICKS + " ticks per unit (1 / 0.02 per tick), because the floor declares no station capacities. Waits and costs are disclosed as recorded, not tuned." });
    } else if (atFloor.length) {
      flags.push({ kind: "floor-rate", text: atFloor.length + " of " + stations.length + " stations serve at the simulator's floor rate of " + FLOOR_SERVICE_TICKS + " ticks per unit: " + atFloor.map((l) => l.id).join(", ") + "." });
    }
    if (inFlight) flags.push({ kind: "in-flight", text: inFlight + " of " + exp.hus.length + " units (" + Math.round((100 * inFlight) / exp.hus.length) + " %) were still in flight at tick " + r.ticks + ": their cycle time and cost are open, and every per-delivered figure covers only what was delivered." });
    const bad = Object.keys(v.invariants).filter((k) => v.invariants[k] > 0);
    return {
      run: r, mix: mixOf(r), minutes: r2(r.ticks * r.minutes_per_tick), units: exp.hus.length, events: exp.events.length, retired: retired, inFlight: inFlight,
      delivered: v.summary.delivered, delivered_eaches: eachesOut, delivered_pallets: v.summary.delivered_pallets, delivered_parcels: v.summary.delivered_parcels,
      trailers: v.dispatch ? v.dispatch.trailers : 0,
      cost: m.costs ? { total: m.costs.total.total_eur, per_unit: exp.hus.length ? r4(m.costs.total.total_eur / exp.hus.length) : null, per_delivered_each: eachesOut ? r4(m.costs.total.total_eur / eachesOut) : null } : null,
      invariantsOk: bad.length === 0, invariantsBad: bad, flags: flags, stations: stations.length, atFloor: atFloor.length,
    };
  }

  /* ---------------- CSV (v3.39): raw values, RFC 4180, LF ------------ */
  function csv(rows, cols) {
    const cell = (v) => { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(cell).join(",")].concat((rows || []).map((r) => cols.map((c) => cell(r[c])).join(","))).join("\n") + "\n";
  }
  /* ---------------- one formatter for every cell (v3.39) ------------- */
  // eur_per_* keeps 4 dp (0.0161 per each would vanish at 2), other money 2 dp,
  // hours 2 dp, everything else 2 dp / integer. Raw numbers stay in the rows.
  const MONEY4 = /^(delta_)?eur_per_/;
  const MONEY2 = /_eur(_[ab])?$/;
  const money = (v, dp) => (v == null ? "—" : "€ " + (Math.round(v * Math.pow(10, dp == null ? 2 : dp)) / Math.pow(10, dp == null ? 2 : dp)).toFixed(dp == null ? 2 : dp));
  function fmtCell(col, v) {
    if (v == null) return "—";
    if (typeof v !== "number") return String(v);
    if (MONEY4.test(col)) return money(v, 4);
    if (MONEY2.test(col) || col === "capex") return money(v, 2);
    if (col === "hours" || /_hours$/.test(col)) return v.toFixed(2);
    return Number.isInteger(v) ? String(v) : String(r2(v));
  }

  RunLedger.model = model;
  RunLedger.views = views;
  RunLedger.ribbon = ribbon;
  RunLedger.trace = trace;
  RunLedger.compare = compare;
  RunLedger.yourCase = yourCase;
  RunLedger.whatIf = whatIf;
  RunLedger.glance = glance;
  RunLedger.mixOf = mixOf;
  RunLedger.csv = csv;
  RunLedger.fmtCell = fmtCell;
  RunLedger.TRAILER_SLOTS = TRAILER_SLOTS;
  RunLedger.FLOOR_SERVICE_TICKS = FLOOR_SERVICE_TICKS;
  RunLedger.SQL = SQL;

  /* ================================================================
   * RENDERING (only when the page is present)
   * ================================================================ */
  if (typeof document === "undefined" || !document.getElementById("rlImport")) return;
  const $ = (id) => document.getElementById(id);
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SQL_NOTE = "run_id filters the run in a multi-run database; this page holds one run, so its tables omit that column and are otherwise the same definition.";
  let EXP = null;
  let EXP_B = null; // v3.37 the second run to compare against
  const LOADED = {};
  let CSV_REG = {}, csvSeq = 0;

  // A table with <th scope="col">, one formatter per cell, an optional set of
  // display-only minutes columns derived from *_ticks columns (never a column
  // of the view), and a CSV button in the caption (raw values).
  function table(rows, cols, caption, opts) {
    if (!rows || !rows.length) return "<p class=\"note\">No rows.</p>";
    const o = opts || {};
    const paired = {};
    for (const c of o.minutes || []) paired[c] = 1;
    const mptFor = (c) => {
      const mp = o.mpt;
      if (mp == null) return null;
      if (typeof mp === "number") return mp;
      if (/_a$/.test(c)) return mp.a; if (/_b$/.test(c)) return mp.b;
      if (/^delta_/.test(c)) return mp.a === mp.b ? mp.a : null;
      return mp.a;
    };
    let head = "", starred = false;
    for (const c of cols) {
      head += '<th scope="col">' + esc(c) + "</th>";
      if (paired[c] && mptFor(c) != null) { head += '<th scope="col" class="derived" title="ticks × minutes per tick; computed for display, not a column of the view">' + esc(c.replace(/_ticks/, "")) + " (min)*</th>"; starred = true; }
    }
    const body = rows.map((r) => "<tr>" + cols.map((c) => {
      let s = "<td>" + esc(fmtCell(c, r[c])) + "</td>";
      if (paired[c] && mptFor(c) != null) s += '<td class="derived">' + esc(typeof r[c] === "number" ? String(r2(r[c] * mptFor(c))) : "—") + "</td>";
      return s;
    }).join("") + "</tr>").join("");
    const id = "t" + (++csvSeq);
    CSV_REG[id] = { rows: rows, cols: cols, caption: caption || id };
    const cap = "<caption>" + esc(caption || "") + ' <button type="button" class="csv" data-csv="' + id + '" aria-label="Download ' + esc(caption || "table") + ' as CSV">CSV</button>' + (starred ? '<span class="footnote">* minutes = ticks × minutes per tick, for display only</span>' : "") + "</caption>";
    return '<div class="table-wrap"><table>' + cap + "<thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function sqlBlock(name) {
    return '<details class="sql" data-view="' + esc(name) + '"><summary>SQL: ' + esc(name) + "</summary><pre>" + esc(SQL[name] || "") + '</pre><p class="note sql-note">' + esc(SQL_NOTE) + "</p></details>";
  }
  function cards(items) {
    return '<div class="cards">' + items.map((it) => '<article' + (it.cls ? ' class="' + it.cls + '"' : "") + "><span>" + esc(it.label) + "</span><strong" + (it.mono ? ' class="mono"' : "") + ">" + (it.html ? it.value : esc(it.value)) + "</strong>" + (it.sub ? "<span>" + esc(it.sub) + "</span>" : "") + "</article>").join("") + "</div>";
  }
  function slug(s) { return String(s || "table").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "table"; }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- the run at a glance ------------------------------ */
  function renderGlance(exp) {
    const g = glance(exp), r = exp.run;
    const items = [
      { label: "Run", value: r.id, mono: true, sub: r.scenario + " · seed " + r.seed + " · profile " + (r.profile || "—") },
      { label: "Order mix", value: g.mix },
      { label: "Simulated", value: r.ticks + " ticks · " + g.minutes + " min", sub: r.minutes_per_tick + " min per tick" },
      { label: "Units · events", value: g.units + " · " + g.events, sub: g.retired + " retired · " + g.inFlight + " in flight" },
      { label: "Delivered", value: g.delivered + " units · " + g.delivered_eaches + " eaches", sub: g.delivered_pallets + " pallets · " + g.delivered_parcels + " parcels · " + g.trailers + " trailer" + (g.trailers === 1 ? "" : "s") },
      g.cost ? { label: "Cost of this run", value: money(g.cost.total), sub: money(g.cost.per_unit) + " per unit · " + (g.cost.per_delivered_each == null ? "—" : money(g.cost.per_delivered_each, 4)) + " per delivered each" } : { label: "Cost of this run", value: "—", sub: "no rates in this file" },
      { label: "Invariants", value: g.invariantsOk ? "all four hold" : g.invariantsBad.length + " broken", cls: g.invariantsOk ? "good" : "bad", sub: g.invariantsOk ? "conservation, cross-dock, versions, terminals" : g.invariantsBad.join(", ") },
    ];
    const flags = g.flags.length ? '<ul class="flags">' + g.flags.map((f) => '<li class="flag-' + esc(f.kind) + '">' + esc(f.text) + "</li>").join("") + "</ul>" : "<p class=\"note\">No data-quality flags: rates present, every station has a declared capacity, every unit retired.</p>";
    $("rlGlance").innerHTML = cards(items) + flags + sqlBlock("v_run_summary") + "<p class=\"note\">" + esc(r.honesty || "") + "</p>";
  }

  /* ---------------- packaging ---------------------------------------- */
  // One layer drawn from its rectangles (grid, bands or pinwheel), in pallet millimetres.
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
      eaches: r.cases * prof.eaches_per_case, gross_kg: r.grossKg, cube: Math.round(r.cubeUtil * 100) + "%", limit: r.strengthLimited ? "strength" : r.weightLimited ? "weight" : "height",
      bottom_case_kg: r.strength ? r.strength.loadKg + " of " + r.strength.allowableKg : "—" }));
    const w = whatIf(exp, opt);
    const box = P.BOXES[prof.box];
    const drawings = '<div class="pallet-row">' + layerSvg(P, P.PALLETS[opt.current.pallet], box, opt.current.layer, "now: " + opt.current.label + " · " + opt.current.ti + " per layer") +
      (opt.gain && !opt.gain.samePallet ? layerSvg(P, P.PALLETS[opt.best.pallet], box, opt.best.layer, "best: " + opt.best.label + " · " + opt.best.ti + " per layer") : "") + "</div>";
    const cardsHtml = w ? cards([
      { label: "Pallet-borne eaches in this run", value: w.eaches + " eaches · " + w.units + " units" },
      { label: "Inbound pallets · trailers now", value: w.now.pallets + " × " + w.now.pallet + " · " + w.now.trailers + " trailer" + (w.now.trailers === 1 ? "" : "s") },
      { label: "With the best pattern", value: w.best.pallets + " × " + w.best.pallet + " · " + w.best.trailers + " trailer" + (w.best.trailers === 1 ? "" : "s") + (w.same ? " (no change)" : "") },
    ]) : "";
    const verdict = opt.gain ? (opt.gain.samePallet ? "<p><b>The profile already uses the best pattern</b> (" + opt.best.cases + " cases per pallet).</p>"
      : "<p><b>" + esc(opt.best.label) + "</b> holds <b>" + opt.best.cases + "</b> cases against " + opt.current.cases + " on the profile's " + esc(opt.current.label) + " (" + (opt.gain.pct > 0 ? "+" : "") + opt.gain.pct + " %).</p>") : "";
    out.innerHTML = verdict + table(rows, ["pallet", "per_layer", "layers", "cases", "eaches", "gross_kg", "cube", "limit", "bottom_case_kg"], "Candidates for " + box.label + " at " + prof.max_stack_mm + " mm stack height") + drawings + cardsHtml +
      "<p class=\"note\">Grid = one orientation; bands = strips of mixed orientation; pinwheel = four blocks around the edges. Height limit from the profile, load limit from the pallet's safe working load, strength limit from the board (bottom case load of its allowable, at the default factors). " + esc(P.HONESTY) + "</p>";
  }
  function renderPackaging(exp) {
    const P = window.WT && window.WT.pack;
    const prof = exp.profile;
    const out = $("rlPack");
    if (!prof || !P) { out.innerHTML = "<p class=\"note\">No packaging profile in this file.</p>"; return; }
    const pallet = P.PALLETS[prof.pallet], box = P.BOXES[prof.box];
    if (!pallet || !box) { out.innerHTML = "<p class=\"note\">Unknown pallet or box id.</p>"; return; }
    const board = prof.board !== undefined ? prof.board : (P.PROFILES[prof.id] ? P.PROFILES[prof.id].board : null);
    const t = P.tiHi(pallet, box, prof.max_stack_mm, prof.case_kg, board);
    const fixed = t.fixed;
    const casesPer = fixed ? (exp.hus[0] && exp.hus[0].cases_per_pallet) || 0 : t.cases;
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
    elev += '<text x="10" y="196" class="svg-label">' + esc(fixed ? "cage: " + casesPer + " units declared" : t.hi + " layers · " + t.stackMm + " mm high · " + t.grossKg + " kg gross" + (t.weightLimited ? " (weight-limited)" : "")) + "</text></svg>";
    out.innerHTML = cards([
      { label: "Each → case", value: prof.eaches_per_case + " per " + box.label },
      { label: "Case → pallet", value: casesPer + " cases (" + casesPer * prof.eaches_per_case + " eaches)" },
      { label: "Pallet → trailer", value: slots + " per 13.6 m trailer" },
    ]) + '<div class="pallet-row">' + plan + elev + "</div>" +
      "<p class=\"note\">" + esc(pallet.label) + " (" + esc(pallet.standard) + "), safe working load " + esc(pallet.maxLoadKg) + " kg. " +
      (fixed ? "" : "Cube utilisation " + Math.round(t.cubeUtil * 100) + "%. ") + esc(P.HONESTY) + "</p>" +
      (fixed ? "" : strengthText(t, board));
  }
  // v3.38 the stack-strength verdict, with its arithmetic shown (one rounding path: whole newtons, kilograms to 2 dp)
  function strengthText(t, board) {
    if (!board || !(board.ectKNm > 0) || !t.strength) return "<p class=\"note\"><b>Stack strength:</b> not evaluated - " + esc((board && board.note) || "no board values for this case") + ".</p>";
    const s = t.strength, p = s.parts;
    return "<p><b>Stack strength</b> (simplified McKee on synthetic board values" + (board.note ? ": " + esc(board.note) : "") + "): ECT " + esc(board.ectKNm) + " kN/m × caliper " + esc(board.caliperMm) + " mm × perimeter " + esc(s.perimeterMm) + " mm → BCT ≈ " + Math.round(s.bctN) + " N (" + Math.round(s.bctKgf) + " kgf) per case" + (s.inRange ? "" : " - outside the formula's published range (height ≥ perimeter / 7, footprint ratio ≤ 3 : 1)") +
      ". After the factors humidity " + p.humidity + " × time under load " + p.duration + " × overhang " + p.overhang + " × pattern " + p.pattern + " = " + r4(s.factor) + ", the allowable load on a bottom case is " + r2(s.allowableKg).toFixed(2) + " kg" + (s.palletsOnTop ? " with " + s.palletsOnTop + " pallet" + (s.palletsOnTop > 1 ? "s" : "") + " stacked on top" : "") + "; this pattern puts " + r2(s.loadKg).toFixed(2) + " kg on it (" + Math.round((s.utilisation || 0) * 100) + " %) - " +
      (t.strengthLimited ? "<b>the board, not the height, limits the stack to " + t.hi + " layers</b>." : "within the " + s.safeLayers + " layers the board allows.") + "</p>";
  }
  // v3.38 your case: a form over RunLedger.yourCase - listeners bound ONCE,
  // number inputs debounced (v3.39), selects on change.
  let ycDraw = null, ycTimer = null, ycBound = false;
  function renderYourCase(exp) {
    const P = window.WT && window.WT.pack;
    const out = $("rlYourCase");
    if (!P) { out.innerHTML = "<p class=\"note\">pack.js is not loaded.</p>"; return; }
    const prof = exp.profile && P.PROFILES[exp.profile.id] ? P.PROFILES[exp.profile.id] : P.PROFILES.ecommerce;
    const box = P.BOXES[prof.box] || P.BOXES["case-400x300x250"];
    const board = prof.board && prof.board.ectKNm > 0 ? prof.board : { ectKNm: 5, caliperMm: 4 };
    const F = P.STACK_FACTORS;
    const sel = (k) => '<label>' + esc(F[k].label) + '<select data-yc="' + k + '">' + Object.keys(F[k].options).map((o) => '<option value="' + o + '"' + (o === F[k].default ? " selected" : "") + ">" + esc(F[k].options[o].label) + " × " + F[k].options[o].value + "</option>").join("") + "</select></label>";
    const num = (k, label, v, step) => '<label>' + esc(label) + '<input data-yc="' + k + '" type="number" step="' + (step || 1) + '" min="0" value="' + esc(v) + '"></label>';
    out.innerHTML = '<div class="yc-form">' + num("l", "case length (mm)", box.l) + num("w", "case width (mm)", box.w) + num("h", "case height (mm)", box.h) + num("kg", "case weight (kg)", prof.caseKg, 0.1) +
      num("ect", "board ECT (kN/m; 0 = no strength check)", board.ectKNm, 0.1) + num("caliper", "board caliper (mm)", board.caliperMm, 0.1) + num("stackMm", "stack height limit (mm)", prof.maxStackMm, 10) + num("palletsOnTop", "pallets stacked on top", 0) +
      num("palletL", "custom pallet length (mm, 0 = none)", 0, 10) + num("palletW", "custom pallet width (mm)", 0, 10) + num("palletLoad", "custom pallet load limit (kg)", 1500, 10) +
      sel("humidity") + sel("duration") + sel("overhang") + sel("pattern") + '</div><div id="rlYourCaseOut"></div>';
    ycDraw = () => {
      const inp = {};
      out.querySelectorAll("[data-yc]").forEach((el) => { inp[el.getAttribute("data-yc")] = el.value; });
      const r = yourCase(inp);
      const o = $("rlYourCaseOut");
      if (!r || r.error) { o.innerHTML = "<p class=\"note\">" + esc(r ? r.error : "no result") + "</p>"; return; }
      const rows = r.rows.map((x) => ({ pallet: x.label, per_layer: x.ti + " (" + x.pattern + (x.rotated ? ", rotated" : "") + ")", layers: x.hi, cases: x.cases, gross_kg: x.grossKg, cube: Math.round(x.cubeUtil * 100) + "%",
        limit: x.strengthLimited ? "strength" : x.weightLimited ? "weight" : "height", bottom_case_kg: x.strength ? x.strength.loadKg + " of " + x.strength.allowableKg : "—", safe_layers: x.strength ? x.strength.safeLayers : "—" }));
      const b = r.best;
      const drawing = b && b.layer && b.ti > 0 ? '<div class="pallet-row">' + layerSvg(P, r.pallets[b.pallet], r.box, b.layer, b.label + " · " + b.ti + " per layer (" + b.pattern + ")") + "</div>" : "";
      o.innerHTML = table(rows, ["pallet", "per_layer", "layers", "cases", "gross_kg", "cube", "limit", "bottom_case_kg", "safe_layers"], "Your case " + r.box.l + " × " + r.box.w + " × " + r.box.h + " mm, " + inp.kg + " kg, on every pallet") + drawing +
        (b ? strengthText(b, r.board ? Object.assign({ note: "your board values" }, r.board) : null) : "") +
        "<p class=\"note\">Factors in force: " + Object.keys(r.factors.parts).map((k) => k + " " + r.factors.parts[k]).join(" × ") + " = " + r4(r.factors.factor) + ". " + esc(P.HONESTY) + "</p>";
    };
    if (!ycBound) {
      ycBound = true;
      const schedule = () => { clearTimeout(ycTimer); ycTimer = setTimeout(() => { if (ycDraw) ycDraw(); }, 150); };
      out.addEventListener("input", (ev) => { if (ev.target && ev.target.tagName === "INPUT") schedule(); });
      out.addEventListener("change", (ev) => { if (ev.target && ev.target.tagName === "SELECT") schedule(); });
    }
    ycDraw();
  }

  /* ---------------- start to finish ---------------------------------- */
  function renderRibbon(exp) {
    const lanes = model(exp).ribbon;
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
  // v3.36 the flow as recorded: a layered Sankey over the recorded links
  function renderFlow(exp) {
    const out = $("rlFlow");
    const An = window.WT && window.WT.analytics;
    const m = model(exp);
    if (!m.flowLinks || !An || typeof An.sankeySvgLayered !== "function") { out.innerHTML = "<p class=\"note\">ledger.js / analytics.js are not loaded on this page.</p>"; return; }
    out.innerHTML = '<p><label for="rlFlowUnit">Ribbon width:</label> <select id="rlFlowUnit"><option value="units">units, every unit</option><option value="retired">units, retired only (conserving)</option><option value="eaches">eaches</option></select></p><div id="rlFlowSvg"></div><div id="rlFlowTable"></div>';
    const draw = () => {
      const mode = $("rlFlowUnit").value;
      const sm = m.sankey(mode === "eaches" ? "eaches" : "units", mode === "retired");
      if (!sm) { $("rlFlowSvg").innerHTML = "<p class=\"note\">No recorded flow to draw.</p>"; return; }
      const geo = An.sankeyLayoutLayered(sm);
      $("rlFlowSvg").innerHTML = '<div class="an-sankey" role="figure" aria-label="The flow as recorded, a layered Sankey in ' + esc(sm.unit) + '">' + An.sankeySvgLayered(sm, "dark") + "</div>";
      $("rlFlowTable").innerHTML = table(m.flowLinks, ["from_op", "to_op", "units", "retired_units", "eaches"], "Links between operations (" + m.flowLinks.length + ")") + sqlBlock("v_flow_links") +
        "<p class=\"note\">" + esc(sm.honesty) + (geo && geo.cyclic ? " A cycle was found: back-links are outlined." : "") + "</p>";
    };
    $("rlFlowUnit").onchange = draw;
    draw();
  }

  /* ---------------- what the planner asks ---------------------------- */
  function renderPlanner(exp) {
    const v = views(exp), mpt = exp.run.minutes_per_tick;
    $("rlCycle").innerHTML = table(v.cycle, ["archetype", "units", "retired", "avg_cycle_ticks", "avg_cycle_minutes", "min_cycle_ticks", "max_cycle_ticks"], "Cycle time by order type") + sqlBlock("v_cycle_time_by_type");
    $("rlTouches").innerHTML = table(v.touches, ["archetype", "units", "events", "touches", "served_per_unit"], "Touches by order type") + sqlBlock("v_touches_by_type");
    $("rlWait").innerHTML = table(v.wait, ["location", "op", "waits", "avg_wait_ticks", "max_wait_ticks", "still_waiting"], "Waiting at each bench", { minutes: ["avg_wait_ticks", "max_wait_ticks"], mpt: mpt }) + sqlBlock("v_station_wait");
    // WIP sparkline
    const W = 680, H = 140, n = v.wip.length, maxW = Math.max(1, ...v.wip.map((r) => r.in_flight));
    const pts = v.wip.map((r, i) => ((i / Math.max(1, n - 1)) * (W - 20) + 10).toFixed(1) + "," + (H - 20 - (r.in_flight / maxW) * (H - 40)).toFixed(1)).join(" ");
    const last = v.wip[n - 1] || { in_flight: 0, retired: 0 };
    $("rlWip").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" class="wip" role="img" aria-label="Work in progress over time"><polyline points="' + pts + '" class="wip-line"/>' +
      '<text x="10" y="14" class="svg-label">in flight, peak ' + maxW + '</text><text x="10" y="' + (H - 4) + '" class="svg-label">tick 0</text><text x="' + (W - 10) + '" y="' + (H - 4) + '" class="svg-label" text-anchor="end">tick ' + exp.run.ticks + " (" + r2(exp.run.ticks * mpt) + " min) · " + last.in_flight + " in flight · " + last.retired + " retired</text></svg>" + sqlBlock("v_wip_by_tick");
    $("rlByOp").innerHTML = table(v.byOp, ["op", "kind", "events", "pallets", "cases", "eaches", "parcels", "retained", "scrapped"], "Quantities at each operation") + sqlBlock("v_quantities_by_op");
  }

  /* ---------------- dispatch ------------------------------------------ */
  function renderDispatch(exp) {
    const d = views(exp).dispatch;
    if (!d) { $("rlDispatch").innerHTML = "<p class=\"note\">Nothing delivered yet in this run.</p>" + sqlBlock("v_dispatch"); return; }
    const cols = d.trailer_slots === 26 ? 13 : d.trailer_slots === 22 ? 11 : 11, rows = Math.ceil(d.trailer_slots / cols);
    let trailers = "";
    for (let t = 0; t < Math.min(d.trailers, 6); t++) {
      const filled = Math.min(d.trailer_slots, d.pallets - t * d.trailer_slots);
      let g = '<svg viewBox="0 0 ' + (cols * 16 + 8) + " " + (rows * 16 + 26) + '" class="trailer" role="img" aria-label="Trailer ' + (t + 1) + '">';
      for (let i = 0; i < d.trailer_slots; i++) g += '<rect x="' + (4 + (i % cols) * 16) + '" y="' + (4 + Math.floor(i / cols) * 16) + '" width="14" height="14" class="' + (i < filled ? "slot-full" : "slot-empty") + '"/>';
      g += '<text x="4" y="' + (rows * 16 + 20) + '" class="svg-label">trailer ' + (t + 1) + ": " + filled + " / " + d.trailer_slots + "</text></svg>";
      trailers += g;
    }
    $("rlDispatch").innerHTML = cards([
      { label: "Delivered", value: d.delivered_units + " units" },
      { label: "Pallets · cases · parcels", value: d.pallets + " · " + d.cases + " · " + d.parcels },
      { label: "Trailers", value: d.trailers + " × " + d.trailer_slots + " slots · " + Math.round(d.fill * 100) + "% full" },
    ]) + '<div class="trailer-row">' + trailers + (d.trailers > 6 ? '<p class="note">… and ' + (d.trailers - 6) + " more</p>" : "") + "</div>" + sqlBlock("v_dispatch");
  }

  /* ---------------- the invariants ----------------------------------- */
  function renderInvariants(exp) {
    const inv = views(exp).invariants;
    const bad = Object.keys(inv).filter((k) => inv[k] > 0);
    $("rlInvariants").innerHTML = cards(Object.keys(inv).map((k) => ({ label: k, value: inv[k] + (inv[k] ? " violations" : " · holds"), cls: inv[k] ? "bad" : "good" }))) +
      (bad.length ? '<p class="note">This file breaks an invariant - it is not a faithful recording.</p>' : "<p class=\"note\">Every invariant holds on this file: eaches are conserved at every event, no cross-dock unit touched storage, versions are consecutive, terminals are well-formed.</p>") +
      sqlBlock("v_conservation_violations") + sqlBlock("v_cross_dock_violations") + sqlBlock("v_version_gaps") + sqlBlock("v_terminal_violations");
  }

  /* ---------------- compare two runs ---------------------------------- */
  function renderCompare() {
    const out = $("rlCompare");
    if (!EXP || !EXP_B) { out.innerHTML = "<p class=\"note\">Load a second run (B) above - the recorded example B, or your own export - to compare it against this one. Deltas are B − A.</p>"; return; }
    const c = compare(EXP, EXP_B);
    const mpt = { a: EXP.run.minutes_per_tick, b: EXP_B.run.minutes_per_tick };
    const head = cards([
      { label: "A", value: c.run_a, mono: true, sub: mixOf(EXP.run) },
      { label: "B", value: c.run_b, mono: true, sub: mixOf(EXP_B.run) },
      { label: "Comparable?", value: c.same_scenario ? "same scenario and profile" : "different scenario or profile", cls: c.same_scenario ? "good" : "bad", sub: c.same_scenario ? "deltas are B − A" : "deltas shown, but the runs are not like for like" },
    ]);
    out.innerHTML = head +
      table(c.summary, ["units_a", "units_b", "delta_units", "events_a", "events_b", "delta_events", "delivered_a", "delivered_b", "delta_delivered", "delivered_eaches_a", "delivered_eaches_b", "delta_delivered_eaches"], "Summary") + sqlBlock("v_compare_summary") +
      table(c.cycle, ["archetype", "units_a", "units_b", "delta_units", "retired_a", "retired_b", "delta_retired", "avg_cycle_ticks_a", "avg_cycle_ticks_b", "delta_avg_cycle_ticks"], "Cycle time by order type", { minutes: ["avg_cycle_ticks_a", "avg_cycle_ticks_b", "delta_avg_cycle_ticks"], mpt: mpt }) + sqlBlock("v_compare_cycle") +
      table(c.touches, ["archetype", "touches_a", "touches_b", "delta_touches", "served_per_unit_a", "served_per_unit_b", "delta_served_per_unit"], "Touches by order type") + sqlBlock("v_compare_touches") +
      table(c.wait, ["location", "op", "waits_a", "waits_b", "delta_waits", "avg_wait_ticks_a", "avg_wait_ticks_b", "delta_avg_wait_ticks", "still_waiting_a", "still_waiting_b", "delta_still_waiting"], "Waiting at each bench", { minutes: ["avg_wait_ticks_a", "avg_wait_ticks_b", "delta_avg_wait_ticks"], mpt: mpt }) + sqlBlock("v_compare_wait") +
      table(c.dispatch, ["delivered_units_a", "delivered_units_b", "delta_delivered_units", "pallets_a", "pallets_b", "delta_pallets", "parcels_a", "parcels_b", "delta_parcels", "trailers_a", "trailers_b", "delta_trailers"], "Dispatch") + sqlBlock("v_compare_dispatch") +
      table(c.cost, ["archetype", "total_eur_a", "total_eur_b", "delta_total_eur", "eur_per_unit_a", "eur_per_unit_b", "delta_eur_per_unit", "eur_per_each_a", "eur_per_each_b", "delta_eur_per_each"], "Cost by order type (empty when a run carries no rates)") + sqlBlock("v_compare_cost") +
      "<p class=\"note\">A key seen in only one run still appears, with the other side and the delta empty. In SQLite both runs live in one database and the views pair every ordered pair of runs; <code>python tools/run_ledger.py compare --database run.sqlite --runs A B</code> prints them.</p>";
  }

  /* ---------------- what a handling unit costs ------------------------ */
  function renderCost(exp) {
    const out = $("rlCost");
    const m = model(exp);
    if (!(window.WT && window.WT.ledger)) { out.innerHTML = "<p class=\"note\">ledger.js is not loaded on this page.</p>"; return; }
    if (!exp.rates || !m.costs) { out.innerHTML = "<p class=\"note\">This file carries no rates: export it from the planner (v3.35 or later) to cost its units.</p>" + sqlBlock("v_cost_by_type"); return; }
    const c = m.costs, r = c.rates;
    const units = exp.hus.length;
    const eachesOut = c.byType.reduce((a, t) => a + t.eaches_out, 0);
    const head = cards([
      { label: "This run", value: money(c.total.total_eur), sub: "labour " + money(c.total.labour_eur) + " · equipment " + money(c.total.equipment_eur) + " · energy " + money(c.total.energy_eur) },
      { label: "Per handling unit", value: money(units ? c.total.total_eur / units : null), sub: units + " units, delivered or in flight" },
      { label: "Per delivered each", value: eachesOut ? money(c.total.total_eur / eachesOut, 4) : "—", sub: eachesOut + " eaches delivered" },
    ]);
    const locRows = c.byLocation.map((l) => Object.assign({}, l, { class: l.class || "—" }));
    const rateRows = Object.keys(r.equipment).map((k) => { const e = r.equipment[k];
      return { class: k, capex: e.capex, amort_years: e.amort_years, eur_per_hour: r4(e.capex / e.amort_years / r.hours_per_year), power_kw: e.power_kw, manned: e.labour ? "yes" : "no" }; });
    const classList = Object.keys(r.classes).map((t) => t + " → " + (r.classes[t].class || "no class") + (r.classes[t].labour ? " (manned)" : "")).join(" · ");
    out.innerHTML = head +
      table(c.byType, ["archetype", "units", "retired", "eaches_out", "labour_eur", "equipment_eur", "energy_eur", "total_eur", "eur_per_unit", "eur_per_each"], "Cost by order type") + sqlBlock("v_cost_by_type") +
      table(locRows, ["location", "class", "spans", "ticks", "charged_ticks", "labour_eur", "equipment_eur", "energy_eur", "total_eur"], "Cost by location: waiting spans charged at the station's service time, and internal transport") + sqlBlock("v_cost_by_location") + sqlBlock("v_spans") + sqlBlock("v_span_cost") +
      "<p><b>Rates in this file:</b> labour " + money(r.labour_per_hour) + "/h · energy " + money(r.energy_price_per_kwh) + "/kWh · " + r.hours_per_year + " operating hours per year · internal transport: " + (r.transport.class ? esc(r.transport.class) + (r.transport.labour ? " (manned)" : " (unmanned)") : "no mover on this floor, movement is free") + ".</p>" +
      table(rateRows, ["class", "capex", "amort_years", "eur_per_hour", "power_kw", "manned"], "Equipment classes (illustrative)") +
      "<p class=\"note\">Location types on this floor: " + esc(classList) + ".</p><p class=\"note\">" + esc(r.honesty) + "</p>";
  }

  /* ---------------- trace one unit ------------------------------------ */
  function renderTrace(exp) {
    const sel = $("rlUnit");
    sel.innerHTML = exp.hus.map((h) => '<option value="' + esc(h.id) + '">' + esc(h.archetype + (h.outcome ? "/" + h.outcome : "") + " · " + h.id.slice(-8)) + "</option>").join("");
    const mpt = exp.run.minutes_per_tick;
    const draw = () => {
      const t = trace(exp, sel.value);
      if (!t) { $("rlTrace").innerHTML = ""; return; }
      const h = t.hu;
      const W = 680, X0 = 10, span = Math.max(1, (t.end == null ? 0 : t.end) - (t.start || 0));
      const x = (tick) => X0 + ((tick - t.start) / span) * (W - 2 * X0);
      let g = '<svg viewBox="0 0 ' + W + ' 86" class="gantt" role="img" aria-label="Timeline of ' + esc(h.id) + '">';
      for (const s of t.spans) g += '<rect x="' + x(s.from).toFixed(1) + '" y="10" width="' + Math.max(1, x(s.to) - x(s.from)).toFixed(1) + '" height="24" class="span-' + s.state + '"><title>' + esc(s.state + " · " + s.op + " · ticks " + s.from + "–" + s.to + " (" + r2((s.to - s.from) * mpt) + " min)") + "</title></rect>";
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
      g += '<text x="10" y="82" class="svg-label">tick ' + t.start + " → " + t.end + " (minute " + r2(t.start * mpt) + " → " + r2(t.end * mpt) + ") · dark = waiting at a bench, light = moving / being worked</text></svg>";
      const cost = model(exp).costByHu[h.id] || null; // v3.35, computed once per export
      const items = [
        { label: "Unit", value: h.id, mono: true },
        { label: "SSCC · GTIN-14", value: esc(h.sscc) + "<br>" + esc(h.gtin14), mono: true, html: true },
        { label: "Received", value: h.received_eaches + " eaches · " + h.cases_per_pallet + " cases × " + h.eaches_per_case + " on " + h.pallet },
      ];
      if (cost) items.push({ label: "Cost so far", value: money(cost.total_eur), sub: cost.charged_ticks + " charged ticks: labour " + money(cost.labour_eur) + " · equipment " + money(cost.equipment_eur) + " · energy " + money(cost.energy_eur) });
      $("rlTrace").innerHTML = cards(items) + g +
        table(t.events, ["version", "tick", "minute", "kind", "op", "location", "form", "pallets", "cases", "eaches", "parcels", "retained", "scrapped"], "Recorded events") + sqlBlock("v_cost_by_hu");
    };
    sel.onchange = draw;
    draw();
  }

  /* ---------------- appendix ------------------------------------------ */
  function renderAppendix(exp) {
    const id = exp.run.id, b = EXP_B ? EXP_B.run.id : "<RUN-B>";
    const guide = [
      ["The run at a glance", "identity, totals, cost and the four invariants, with the data-quality flags a reader must know first (no rates; stations at the floor rate; units still in flight)", "v_run_summary · verify_run_ledger_view.js"],
      ["Start to finish", "the ribbon per order type (units and eaches at every operation) and the flow as recorded, a layered Sankey where every interior operation conserves over the retired units", "v_flow_links · verify_ledger_flow.js"],
      ["What the planner asks", "cycle time, touches, waiting at each bench, work in progress, quantities at each operation", "v_cycle_time_by_type … v_quantities_by_op · verify_run_ledger_view.js"],
      ["What a handling unit costs", "every span between a unit's events charged at the recorded rates; queue time costs nothing", "v_spans · v_span_cost · v_cost_by_type · v_cost_by_location · verify_cost_ledger.js"],
      ["Dispatch manifest", "delivered units, pallets, parcels and trailers, slot by slot", "v_dispatch"],
      ["Packaging", "the hierarchy and the drawn pallet pattern, the ranked alternatives with the what-if on this run's volumes, the stack-strength verdict, and a case of your own", "pack.js · verify_pack.js · verify_stacking.js"],
      ["Trace one unit", "one handling unit's events with its timeline and cost", "v_cost_by_hu"],
      ["Compare two runs", "every table paired key by key against a second run, deltas B − A", "v_compare_* · verify_run_compare.js"],
      ["The invariants", "the four views that must return zero rows; a deliberate corruption in the tests makes each fire", "v_conservation_violations … v_terminal_violations · test_run_ledger.py"],
    ];
    const cmds = [
      "python tools/run_ledger.py import <this file> --database run.sqlite",
      "python tools/run_ledger.py views --database run.sqlite --run " + id + " --all",
      "python tools/run_ledger.py summary --database run.sqlite --run " + id + " --out summary.json",
      "python tools/run_ledger.py compare --database run.sqlite --runs " + id + " " + b,
      "python tools/export_viewer_sql.py --check          # the SQL on this page is the SQL in the tool",
      "node verify_run_ledger_view.js && node verify_cost_ledger.js && node verify_ledger_flow.js && node verify_run_compare.js && node verify_stacking.js",
      "python -m unittest discover -s test -p 'test_run_ledger.py'",
    ];
    $("rlAppendix").innerHTML = '<div class="table-wrap"><table><caption>How to read this page</caption><thead><tr><th scope="col">section</th><th scope="col">what it shows</th><th scope="col">proved by</th></tr></thead><tbody>' +
      guide.map((g) => "<tr><td>" + esc(g[0]) + "</td><td>" + esc(g[1]) + "</td><td>" + esc(g[2]) + "</td></tr>").join("") + "</tbody></table></div>" +
      "<p>Every table carries a <b>CSV</b> button (raw values) and the <b>SQL</b> that SQLite runs for it; the SQL texts are generated from <code>tools/run_ledger.py</code> and a test fails when they drift. Columns marked * are minutes derived from ticks for display only. <b>Print report</b> (in the navigation) prints every section with its SQL expanded.</p>" +
      "<h3>Reproduce in SQLite</h3><pre class=\"cmds\">" + esc(cmds.join("\n")) + "</pre>" +
      "<p class=\"note\">Deterministic: the same scenario, seed and order mix reproduce this file byte for byte. Synthetic events from a synthetic teaching simulation; illustrative rates; synthetic board values. Informed by practice, not a certification.</p>";
  }

  /* ---------------- navigation, print, CSV ---------------------------- */
  function setCurrentNav(secId) {
    $("rlNav").querySelectorAll("a[href^='#']").forEach((a) => { if (a.getAttribute("href") === "#" + secId) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }
  (function wireNav() {
    const nav = $("rlNav");
    if (!nav) return;
    nav.addEventListener("click", (ev) => { const a = ev.target.closest("a[href^='#']"); if (a) setCurrentNav(a.getAttribute("href").slice(1)); });
    if (typeof IntersectionObserver === "function") {
      const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setCurrentNav(e.target.id); }, { rootMargin: "-35% 0px -55% 0px" });
      document.querySelectorAll("section[id^='sec']").forEach((s) => io.observe(s));
    }
    const print = $("rlPrint");
    if (print) print.addEventListener("click", () => window.print());
    let remembered = null;
    window.addEventListener("beforeprint", () => { remembered = []; document.querySelectorAll("details.sql").forEach((d) => { remembered.push([d, d.open]); d.open = true; }); });
    window.addEventListener("afterprint", () => { for (const [d, was] of remembered || []) d.open = was; remembered = null; });
    $("rlView").addEventListener("click", (ev) => {
      const b = ev.target.closest("button.csv");
      if (!b) return;
      const reg = CSV_REG[b.getAttribute("data-csv")];
      if (reg) download(slug(reg.caption) + ".csv", csv(reg.rows, reg.cols), "text/csv");
    });
  })();

  /* ---------------- loading --------------------------------------------- */
  function announce(side, exp) {
    LOADED[side] = exp;
    try { document.dispatchEvent(new CustomEvent("rl:loaded", { detail: { side: side, run: exp.run.id } })); } catch (_) { /* no CustomEvent */ }
  }
  RunLedger.whenLoaded = (side) => (LOADED[side] ? Promise.resolve(LOADED[side])
    : new Promise((res) => document.addEventListener("rl:loaded", function h(ev) { if (ev.detail && ev.detail.side === side) { document.removeEventListener("rl:loaded", h); res(LOADED[side]); } })));
  const valid = (exp) => exp && exp.schema === "factory-run-ledger/v1" && Array.isArray(exp.hus) && Array.isArray(exp.events) && exp.run;

  function load(exp) {
    if (!valid(exp)) { $("rlStatus").textContent = "That file is not a factory-run-ledger/v1 export."; return; }
    EXP = exp;
    CSV_REG = {}; csvSeq = 0;
    $("rlStatus").textContent = "Loaded " + exp.hus.length + " units and " + exp.events.length + " events from " + exp.run.id + ".";
    $("rlView").hidden = false;
    renderGlance(exp); renderRibbon(exp); renderFlow(exp); renderPlanner(exp); renderCost(exp); renderDispatch(exp);
    renderPackaging(exp); renderOptimise(exp); renderYourCase(exp); renderTrace(exp); renderCompare(); renderInvariants(exp); renderAppendix(exp);
    $("rlNav").hidden = false;
    setCurrentNav("secGlance");
    try { $("rlGlance").focus({ preventScroll: true }); } catch (_) { /* older focus() */ }
    announce("a", exp);
  }
  function loadB(exp) {
    if (!valid(exp)) { $("rlStatus").textContent = "That file is not a factory-run-ledger/v1 export."; return; }
    EXP_B = exp;
    $("rlStatus").textContent = "B: loaded " + exp.hus.length + " units and " + exp.events.length + " events from " + exp.run.id + (EXP ? "; compared against " + EXP.run.id + "." : ". Load run A to compare.");
    if (EXP) { $("rlView").hidden = false; renderCompare(); renderAppendix(EXP); }
    announce("b", exp);
  }
  const readFile = (ev, into) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { into(JSON.parse(String(rd.result))); } catch (e) { $("rlStatus").textContent = "Could not read that file: " + e.message; } };
    rd.readAsText(f);
  };
  $("rlFile").addEventListener("change", (ev) => readFile(ev, load));
  $("rlFileB").addEventListener("change", (ev) => readFile(ev, loadB));
  $("rlDemo").addEventListener("click", () => {
    fetch("test/fixtures/run-ledger.json").then((r) => r.json()).then(load).catch((e) => { $("rlStatus").textContent = "Could not load the example: " + e.message; });
  });
  $("rlDemoB").addEventListener("click", () => {
    const go = () => fetch("test/fixtures/run-ledger-b.json").then((r) => r.json()).then(loadB).catch((e) => { $("rlStatus").textContent = "Could not load example B: " + e.message; });
    if (EXP) go(); else fetch("test/fixtures/run-ledger.json").then((r) => r.json()).then((a) => { load(a); go(); }).catch((e) => { $("rlStatus").textContent = "Could not load the example: " + e.message; });
  });
  // handed over from the planner (Simulate -> Live material flow -> Open in the run-ledger viewer); else ?example=a|b
  let handed = null;
  try {
    handed = localStorage.getItem("wt-run-ledger");
    if (handed) { load(JSON.parse(handed)); localStorage.removeItem("wt-run-ledger"); }
  } catch (_) { /* no storage */ }
  const q = /[?&]example=(a|b)(?:&|$)/.exec(window.location.search);
  if (!handed && q) $(q[1] === "b" ? "rlDemoB" : "rlDemo").click();
  RunLedger.load = load;
  RunLedger.loadB = loadB;
  RunLedger.current = () => EXP;
  RunLedger.currentB = () => EXP_B;
})();
