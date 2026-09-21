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
 * invariants (must be zero) · the SQL behind each table.
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
    return { summary, cycle, touches, wait, wip, byOp, dispatch,
      invariants: { v_conservation_violations: conservation, v_cross_dock_violations: crossDock, v_version_gaps: versionGaps, v_terminal_violations: terminals } };
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
    v_conservation_violations: "SELECT e.id FROM handling_event e JOIN hu h ON h.id = e.hu_id\nWHERE e.eaches + e.retained + e.scrapped <> h.received_eaches;   -- must be empty",
    v_cross_dock_violations: "SELECT e.id FROM handling_event e JOIN hu h ON h.id = e.hu_id JOIN location l ON l.id = e.location\nWHERE h.archetype = 'cross-dock' AND (l.category = 'storage' OR e.op IN ('putaway','replen','pick','piece-pick','case-pick','pallet-pick'));   -- must be empty",
  };

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
    // plan view of one layer + elevation of the stack
    const S = 220 / Math.max(pallet.l, pallet.w);
    const cl = t.rotated ? box.w : box.l, cw = t.rotated ? box.l : box.w;
    const cols = fixed ? 0 : Math.floor(pallet.l / cl), rows = fixed ? 0 : Math.floor(pallet.w / cw);
    let plan = '<svg viewBox="0 0 250 ' + (pallet.w * S + 30) + '" class="pallet" role="img" aria-label="Pallet pattern, plan view">';
    plan += '<rect x="10" y="10" width="' + pallet.l * S + '" height="' + pallet.w * S + '" class="pallet-deck"/>';
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) plan += '<rect x="' + (10 + i * cl * S + 1) + '" y="' + (10 + j * cw * S + 1) + '" width="' + (cl * S - 2) + '" height="' + (cw * S - 2) + '" class="pallet-case"/>';
    plan += '<text x="10" y="' + (pallet.w * S + 24) + '" class="svg-label">' + esc(pallet.l + " × " + pallet.w + " mm · " + (fixed ? "declared capacity" : t.ti + " cases per layer" + (t.rotated ? " (rotated)" : ""))) + "</text></svg>";
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
      "<article><span>Delivered pallets · parcels</span><strong>" + s.delivered_pallets + " · " + s.delivered_parcels + "</strong></article></div>";
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
      sqlBlock("v_conservation_violations") + sqlBlock("v_cross_dock_violations");
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
      $("rlTrace").innerHTML = '<div class="cards"><article><span>Unit</span><strong class="mono">' + esc(h.id) + "</strong></article><article><span>SSCC · GTIN-14</span><strong class=\"mono\">" + esc(h.sscc) + "<br>" + esc(h.gtin14) + "</strong></article><article><span>Received</span><strong>" + esc(h.received_eaches) + " eaches · " + esc(h.cases_per_pallet) + " cases × " + esc(h.eaches_per_case) + " on " + esc(h.pallet) + "</strong></article></div>" + g +
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
    renderRun(exp); renderPackaging(exp); renderRibbon(exp); renderViews(exp); renderTrace(exp);
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
  // handed over from the planner (Simulate -> Live material flow -> Open in the run-ledger viewer)
  try {
    const handed = localStorage.getItem("wt-run-ledger");
    if (handed) { load(JSON.parse(handed)); localStorage.removeItem("wt-run-ledger"); }
  } catch (_) { /* no storage */ }
  RunLedger.load = load;
  RunLedger.current = () => EXP;
})();
