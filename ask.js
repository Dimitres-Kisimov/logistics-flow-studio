/* =====================================================================
 * Logistics Flow Studio - ask.js
 * ASK THE LEDGER (v3.60): a deterministic, offline question box over the
 * run ledger's views and the knowledge base.
 * ---------------------------------------------------------------------
 * WHAT IT IS
 *   - A rule-based matcher over a FIXED CATALOGUE of questions a planner asks
 *     of a recorded run ("which step waits longest", "why did OTIF fall",
 *     "what did the tower propose", "what does a mis-pick cost", ...), in
 *     English with German synonyms. Every answer names the SQL view it read
 *     (the same rows the run-ledger viewer and tools/run_ledger.py show),
 *     lists the rows it used and the source of any threshold - the knowledge
 *     base entry with its label: a teaching value with its citation, or
 *     "measured on <source>, n = ..." once a site profile (v3.59) is loaded.
 *   - The aggregates it computes itself (station wait, cycle time, the run
 *     summary, the invariants) are twins of the viewer's computeViews and of
 *     the SQL views, pinned equal in verify_ask.js; the rest it reads from
 *     ledger.js (costs, quality, service, inbound) and control.js.
 *   - No language model is connected. A question outside the catalogue gets
 *     the catalogue back, marked unanswered - never a guess. Deterministic:
 *     the same question over the same export gives the same answer; no Date,
 *     no Math.random. Nothing here names a person.
 *   - The same module serves the Simulate drawer (the live run's export) and
 *     the run-ledger viewer (a loaded export): answer(question, { exp, kb }).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const HONESTY =
    "Ask the ledger is an offline, rule-based matcher over a fixed catalogue of questions: every answer names the SQL view it read " +
    "(the same rows the viewer and tools/run_ledger.py show), lists the rows it used and the source of any threshold - the knowledge-base " +
    "entry, a teaching value with its citation or a value measured on the plant's own record. No language model is connected; a question " +
    "outside the catalogue gets the catalogue back, not a guess. Nothing here names a person.";
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const STORAGE_OPS = { putaway: 1, replen: 1, pick: 1, "piece-pick": 1, "case-pick": 1, "pallet-pick": 1 };
  const TERMINAL = { delivered: 1, restocked: 1, scrapped: 1 };
  const PICK_OPS = { pick: 1, "piece-pick": 1, "case-pick": 1, "pallet-pick": 1 };
  const num = (v) => (v == null ? "-" : String(typeof v === "number" ? r2(v) : v));
  const pct = (v) => (v == null ? "-" : (Math.round(v * 1000) / 10) + " %");
  const eur = (v) => (v == null ? "-" : (Math.round(v * 100) / 100).toFixed(2) + " EUR");

  /* ---------------- the aggregates (twins of run-ledger.js computeViews / the SQL views) ---- */
  function index(exp) {
    const hus = {}, byHu = {}, loc = {};
    for (const h of exp.hus) hus[h.id] = h;
    for (const e of exp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
    for (const k in byHu) byHu[k].sort((a, b) => a.version - b.version);
    for (const l of exp.locations || []) loc[l.id] = l;
    return { hus: hus, byHu: byHu, loc: loc };
  }
  // v_run_summary
  function summaryOf(exp) {
    const delivered = exp.hus.filter((h) => h.final_kind === "delivered");
    const sum = (k) => delivered.reduce((a, h) => a + (h.final ? h.final[k] : 0), 0);
    return { units: exp.hus.length, events: exp.events.length, delivered: delivered.length, delivered_eaches: sum("eaches"), delivered_pallets: sum("pallets"), delivered_parcels: sum("parcels") };
  }
  // v_cycle_time_by_type
  function cycleRows(exp) {
    const types = {};
    for (const h of exp.hus) {
      const t = types[h.archetype] || (types[h.archetype] = { units: 0, retired: 0, cyc: [] });
      t.units++;
      if (h.retired_tick != null) { t.retired++; t.cyc.push(h.retired_tick - h.spawned_tick); }
    }
    const mpt = exp.run.minutes_per_tick;
    return Object.keys(types).sort().map((k) => {
      const t = types[k], n = t.cyc.length, sum = t.cyc.reduce((a, b) => a + b, 0);
      return { archetype: k, units: t.units, retired: t.retired, avg_cycle_ticks: n ? r2(sum / n) : null, avg_cycle_minutes: n ? r2(sum * mpt / n) : null,
        min_cycle_ticks: n ? Math.min.apply(null, t.cyc) : null, max_cycle_ticks: n ? Math.max.apply(null, t.cyc) : null };
    });
  }
  // v_station_wait: each queued event paired with the first later served event of the same unit and operation
  function waitRows(exp) {
    const { byHu } = index(exp), waitMap = {};
    for (const e of exp.events) {
      if (e.kind !== "queued") continue;
      const served = (byHu[e.hu_id] || []).find((s) => s.kind === "served" && s.op === e.op && s.version > e.version);
      const key = e.location + "|" + e.op;
      const w = waitMap[key] || (waitMap[key] = { location: e.location, op: e.op, waits: 0, sum: 0, n: 0, max: null, still_waiting: 0 });
      w.waits++;
      if (served) { const d = served.tick - e.tick; w.sum += d; w.n++; w.max = w.max == null ? d : Math.max(w.max, d); } else w.still_waiting++;
    }
    return Object.keys(waitMap).sort().map((k) => { const w = waitMap[k];
      return { location: w.location, op: w.op, waits: w.waits, avg_wait_ticks: w.n ? r2(w.sum / w.n) : null, max_wait_ticks: w.max, still_waiting: w.still_waiting }; });
  }
  // the invariant views (each must be 0)
  function invariantsOf(exp) {
    const { hus, byHu, loc } = index(exp);
    let conservation = 0, crossDock = 0, versionGaps = 0, terminals = 0;
    for (const e of exp.events) {
      const h = hus[e.hu_id];
      if (!h) continue;
      if (e.eaches + e.retained + e.scrapped !== h.received_eaches) conservation++;
      if (h.archetype === "cross-dock") { const l = loc[e.location]; if ((l && l.category === "storage") || STORAGE_OPS[e.op]) crossDock++; }
    }
    for (const h of exp.hus) {
      const evs = byHu[h.id] || [];
      if (evs.length && (evs[0].version !== 0 || evs[evs.length - 1].version + 1 !== evs.length)) versionGaps++;
      if ((h.retired_tick != null && !TERMINAL[h.final_kind]) || (h.retired_tick == null && h.final_kind)) terminals++;
    }
    const out = { v_conservation_violations: conservation, v_cross_dock_violations: crossDock, v_version_gaps: versionGaps, v_terminal_violations: terminals };
    const T = WT.tracking;
    if (T && typeof T.fromLedger === "function" && typeof T.gaps === "function") out.v_tracking_gaps = T.gaps(exp, T.fromLedger(exp));
    return out;
  }

  /* ---------------- sources: the knowledge base and the recorded rates ---------------- */
  function kbSource(kb, id) {
    const e = kb && typeof kb.entry === "function" ? kb.entry(id) : null;
    if (!e) return { id: id, value: null, label: id, source: "knowledge base not loaded on this page", measured: false };
    return { id: id, value: e.value, unit: e.unit || "", label: e.label, measured: !!e.measured,
      source: e.measured ? e.measured.label : (/teaching|choice|commonly quoted/i.test(e.source + " " + (e.note || "")) ? "teaching value - " : "") + e.source };
  }
  const srcText = (s) => s.id + " = " + num(s.value) + (s.unit ? " " + s.unit : "") + " (" + s.source + ")";
  function ratesSource(exp) {
    const r = exp.rates;
    return r ? { id: "rates.labour_per_hour", value: r.labour_per_hour, unit: (r.currency || "EUR") + "/h", label: "labour rate the run was recorded under", source: (r.source || "recorded rates") + " - " + (r.honesty || ""), measured: false } : null;
  }
  const ledger = () => WT.ledger || null;
  const controlRowsOf = (exp) => (WT.control && typeof WT.control.controlRows === "function" ? WT.control.controlRows(exp) : []);

  /* ---------------- the catalogue ---------------------------------------------------- */
  const RULE_SOURCES = { "queue-congestion": ["control.queue.sustainTicks"], "rework-burden": ["control.rework.maxShare", "control.rework.minUnits"], "inbound-late": ["control.inbound.lateTicks"], "otif-below-target": ["delivery.otif.target", "control.otif.minDeliveries"] };
  const QUESTIONS = [
    { id: "help", ask: "What can I ask?", de: "Was kann ich fragen?", view: "the catalogue",
      match: /\bhelp\b|what can|hilfe|was kann|\bquestions?\b|catalog/,
      answer: () => ({ text: helpText(), read: [], sources: [], catalogue: catalogue() }) },
    { id: "mispick-cost", ask: "What does a mis-pick cost?", de: "Was kostet ein Fehlgriff?", view: "v_quality_by_step",
      match: /mis.?pick.*(cost|kost|eur|€|price|preis)|(cost|kost|price|preis).*(mis.?pick|fehlgriff|\berror|fehler)|fehlgriff.*kost/,
      answer: (exp, kb) => {
        const L = ledger(), mpt = exp.run.minutes_per_tick;
        const rows = L && typeof L.qualityByStep === "function" ? L.qualityByStep(exp).filter((r) => PICK_OPS[r.op]) : [];
        const served = exp.events.find((e) => e.kind === "served" && PICK_OPS[e.op]);
        const loc = served ? (exp.locations || []).find((l) => l.id === served.location) : null;
        const rates = exp.rates || null;
        const cls = loc && rates && rates.classes ? rates.classes[loc.type] : null;
        const labour = cls ? (cls.labour ? 1 : 0) : (loc ? 1 : 0);
        const extra = loc && loc.service_ticks != null ? loc.service_ticks : null;
        const per = extra != null && rates ? extra * mpt / 60 * labour * rates.labour_per_hour : 0;
        const errors = rows.reduce((a, r) => a + r.errors, 0), through = rows.reduce((a, r) => a + r.units_through, 0), reworked = rows.reduce((a, r) => a + r.reworked, 0);
        const share = kbSource(kb, "hf.error.mis-pick");
        let text = "A mis-pick is caught at the verification step and the pick is redone: one extra pick service plus the wait for it. ";
        if (!loc) text += "No pick was served in this run yet, so the pick station is unknown. ";
        else if (extra == null) text += "This floor's pick station (" + loc.id + ", " + loc.type + ") has no declared service time (the simulator's floor rate), so the cost model charges no station labour for the redo - only the extra waiting time is real. ";
        else text += "At this floor's pick station (" + loc.id + ", " + loc.type + ") the service time is " + num(extra) + " ticks" + (labour ? " with labour" : " without labour") + (rates ? " and the recorded labour rate " + rates.labour_per_hour + " " + (rates.currency || "EUR") + "/h, so the redo costs " + eur(per) + " in station labour per reworked unit (queue time costs no labour in this cost model)" : "; no rates were recorded") + ". ";
        text += errors ? "This run: " + errors + " mis-picks (errors at picking) of " + through + " units through, " + reworked + " reworked" + (rows.length === 1 ? " - first pass yield " + num(rows[0].first_pass_yield) : "") + " (v_quality_by_step)." :
          "No error was realised at picking in this run" + (exp.run.errors ? "" : " (no error what-if ran)") + ": first pass yield 1 at every pick. The share the what-if would use is " + srcText(share) + ".";
        return { text: text, read: [{ view: "v_quality_by_step", rows: rows }], sources: [share].concat(rates ? [ratesSource(exp)] : []), numbers: { extra_service_ticks: extra, labour_eur_per_rework: r4(per), errors: errors, reworked: reworked, through: through } };
      } },
    { id: "errors-source", ask: "Where do the error shares come from?", de: "Woher kommen die Fehleranteile?", view: "knowledge base (human-factors)",
      match: /(where|woher|source|quelle|teaching|measured|anchor|heart|spar).*(\berror|share|rate|fehler|anteil)|(\berror|share|rate|fehler|anteil).*(come from|source|quelle|teaching|measured|anchor|heart|spar)/,
      answer: (exp, kb) => {
        const ids = ["hf.error.mis-pick", "hf.error.wrong-putaway", "hf.error.damage", "hf.psf.timePressure", "hf.psf.signalToNoise", "hf.psf.familiarity"];
        const s = ids.map((id) => kbSource(kb, id));
        const measured = s.filter((x) => x.measured).length;
        const text = "The error what-if reads its shares from the knowledge base: " + s.slice(0, 3).map(srcText).join("; ") + ". The multipliers: " + s.slice(3).map((x) => x.id + " = " + num(x.value)).join(", ") + ". " +
          (measured ? measured + " of these are measured on the plant's own record (a site profile, tools/fit_rates.py); the rest are teaching values. " : "All are teaching values anchored on public human-reliability literature (HEART / SPAR-H), not warehouse measurements; a site profile (tools/fit_rates.py) replaces them with values measured on the plant's own record. ") +
          "A share is attributed to a process step and a latent condition, never to a person (BetrVG 87(1)6, GDPR Art. 88)." + (exp.run.errors ? " This run ran the what-if with " + (exp.run.errors.kinds || []).map((k) => k.kind + " " + num(k.effective)).join(", ") + "." : " This run did not run the what-if.");
        return { text: text, read: [{ view: "knowledge base (human-factors)", rows: s.map((x) => ({ id: x.id, value: x.value, unit: x.unit, source: x.source })) }], sources: s };
      } },
    { id: "tower", ask: "What did the control tower propose?", de: "Was hat der Leitstand vorgeschlagen?", view: "v_control",
      match: /tower|propos|decision|decid|accept|declin|snooz|revert|vorschl|entsch|leitstand/,
      answer: (exp, kb) => {
        const rows = controlRowsOf(exp), audit = exp.control || [];
        if (!rows.length) return { text: "No decision is recorded in this run: the control tower proposes from aggregates per step and station, and a run exports its audit only when a person accepted, declined, snoozed or reverted a proposal (Simulate -> Control tower). Nothing acts on its own.", read: [{ view: "v_control", rows: [] }], sources: [] };
        const ids = [];
        for (const r of rows) for (const id of RULE_SOURCES[r.rule] || []) if (ids.indexOf(id) < 0) ids.push(id);
        const last = audit[audit.length - 1];
        const text = rows.map((r) => r.rule + ": " + r.proposals + " proposal" + (r.proposals === 1 ? "" : "s") + " - " + r.accepted + " accepted, " + r.declined + " declined, " + r.snoozed + " snoozed" + (r.reverted ? ", " + r.reverted + " reverted" : "") + " (first at tick " + r.first_tick + ")").join("; ") +
          ". The last decision: " + last.status + " " + last.rule + " at tick " + last.tick + (last.lever ? " (" + (last.lever.key || last.lever.kind) + " -> " + last.lever.value + ")" : "") + ". Every proposal was explained from aggregates; a person decided.";
        return { text: text, read: [{ view: "v_control", rows: rows }, { view: "control (the audit)", rows: audit.map((a) => ({ seq: a.seq, tick: a.tick, rule: a.rule, status: a.status, lever: a.lever ? (a.lever.key || a.lever.kind) + " -> " + a.lever.value : "" })) }], sources: ids.map((id) => kbSource(kb, id)) };
      } },
    { id: "inbound", ask: "Were the trailers late?", de: "Kamen die Lkw zu spät?", view: "v_inbound",
      match: /trailer|\bdock|inbound|\blkw|anliefer|arriv|ankunft/,
      answer: (exp, kb) => {
        const L = ledger(), rows = L && typeof L.inboundRows === "function" ? L.inboundRows(exp) : [];
        const thr = kbSource(kb, "control.inbound.lateTicks");
        if (!rows.length) return { text: "No trailer log in this run: it ran without dock windows (no delivery what-if), so every unit was received the instant it was due. Turn on Delivery windows and re-run to see arrivals against the schedule.", read: [{ view: "v_inbound", rows: [] }], sources: [thr] };
        const late = rows.filter((r) => r.late_ticks > 0), early = rows.filter((r) => r.late_ticks < 0), over = typeof thr.value === "number" ? rows.filter((r) => r.late_ticks > thr.value) : [];
        const worst = rows.reduce((a, r) => (a == null || r.late_ticks > a.late_ticks ? r : a), null);
        const text = rows.length + " trailers: " + late.length + " arrived late, " + early.length + " early, " + (rows.length - late.length - early.length) + " on time; the latest was trailer " + worst.trailer + " at " + worst.late_ticks + " ticks after its slot" +
          (typeof thr.value === "number" ? "; " + over.length + " later than the tower's late threshold of " + thr.value + " ticks" : "") + ". The lateness follows " + (exp.run.inbound && exp.run.inbound.source ? exp.run.inbound.source : "the recorded window shape") + " - the shape, not a forecast.";
        return { text: text, read: [{ view: "v_inbound", rows: rows }], sources: [thr], numbers: { trailers: rows.length, late: late.length, early: early.length, over_threshold: over.length } };
      } },
    { id: "otif", ask: "Why did OTIF fall?", de: "Warum ist OTIF gesunken?", view: "v_otif",
      match: /otif|on.?time|in full|\bdue\b|promise|verspät|pünktlich|termin|customer|kunde/,
      answer: (exp, kb) => {
        const L = ledger(), s = L && typeof L.serviceOf === "function" ? L.serviceOf(exp) : null;
        const target = kbSource(kb, "delivery.otif.target"), thr = kbSource(kb, "control.inbound.lateTicks");
        if (!s) return { text: "OTIF was not measured in this run: it ran without carrier windows (no delivery what-if), so no unit had a promised lead to miss. Turn on Delivery windows and re-run to measure it against the target " + srcText(target) + ".", read: [{ view: "v_otif", rows: [] }], sources: [target] };
        const inbound = L && typeof L.inboundRows === "function" ? L.inboundRows(exp) : [];
        const lateTrailers = inbound.filter((r) => typeof thr.value === "number" && r.late_ticks > thr.value).length;
        const below = typeof target.value === "number" && s.otif != null && s.otif < target.value;
        let why;
        if (s.otif == null) why = "No order has been delivered in full yet, so there is nothing to compare.";
        else if (s.shipped_on_time_share != null && s.shipped_on_time_share >= 0.999 && below) why = "Every delivered unit left the dock by its due tick, so the misses happened in transit: the carrier's lateness shape (mean transit " + num(s.avg_transit_ticks) + " ticks) is longer than the promise allows for some orders.";
        else if (below) why = "Only " + pct(s.shipped_on_time_share) + " of delivered units left the dock by their due tick, so the misses happened before departure - dock dwell until the next carrier departure and the waits before it" + (lateTrailers ? ", with " + lateTrailers + " trailers later than the tower's late threshold at receiving" : "") + ".";
        else why = "OTIF is at or above the target; " + pct(s.shipped_on_time_share) + " of delivered units left the dock by their due tick.";
        const text = "OTIF " + pct(s.otif) + ": " + s.otif_orders + " of " + s.delivered_orders + " delivered orders (of " + s.orders + " spawned) reached the customer by their due tick; the target is " + num(target.value) + " (" + target.source + "). " + why;
        return { text: text, read: [{ view: "v_otif", rows: [s] }, { view: "v_inbound", rows: inbound }], sources: [target, thr], numbers: { otif: s.otif, delivered_orders: s.delivered_orders, otif_orders: s.otif_orders, shipped_on_time_share: s.shipped_on_time_share, late_trailers: lateTrailers } };
      } },
    { id: "wait", ask: "Which step waits longest?", de: "Wo warten die Einheiten am längsten?", view: "v_station_wait",
      match: /\bwait|queue|warten|bottleneck|engpass|\bstau|longest|slowest|congest/,
      answer: (exp) => {
        const rows = waitRows(exp).slice().sort((a, b) => (b.avg_wait_ticks || 0) - (a.avg_wait_ticks || 0) || a.location.localeCompare(b.location));
        if (!rows.length) return { text: "No unit waited in this run: no queued event was recorded (every station was free when a unit arrived).", read: [{ view: "v_station_wait", rows: [] }], sources: [] };
        const t = rows[0], n = rows[1];
        const text = "Units wait longest at " + t.location + " for " + t.op + ": " + num(t.avg_wait_ticks) + " ticks on average over " + t.waits + " waits (the longest " + num(t.max_wait_ticks) + "; " + t.still_waiting + " still waiting at the end of the run)." +
          (n ? " Next: " + n.location + " for " + n.op + " at " + num(n.avg_wait_ticks) + " ticks over " + n.waits + " waits." : "") + " A wait is the time from a unit's queued event to its first later served event at the same operation (v_station_wait).";
        return { text: text, read: [{ view: "v_station_wait", rows: rows }], sources: [], numbers: { location: t.location, op: t.op, avg_wait_ticks: t.avg_wait_ticks, waits: t.waits, max_wait_ticks: t.max_wait_ticks } };
      } },
    { id: "quality", ask: "What is the first pass yield?", de: "Wie hoch ist der First Pass Yield?", view: "v_quality_by_step",
      match: /first.?pass|yield|rework|scrap|quality|qualit|nacharbeit|ausschuss|defect|error rate|fehlerquote|\berrors?\b|fehler/,
      answer: (exp, kb) => {
        const L = ledger(), rows = L && typeof L.qualityByStep === "function" ? L.qualityByStep(exp) : [];
        const bad = rows.filter((r) => r.errors > 0);
        const text = bad.length ? bad.map((r) => r.op + ": first pass yield " + num(r.first_pass_yield) + ", rework ratio " + num(r.rework_ratio) + ", scrap ratio " + num(r.scrap_ratio) + " (" + r.errors + " errors of " + r.units_through + " through)").join("; ") + ". ISO 22400-2 names; an error belongs to a step, never to a person."
          : "First pass yield 1 at every operation (" + rows.length + " operations with units through): " + (exp.run.errors ? "the error what-if ran but realised no error in this run." : "no error what-if ran, so every step was perfect by construction.") + " ISO 22400-2 names (v_quality_by_step).";
        return { text: text, read: [{ view: "v_quality_by_step", rows: rows }], sources: ["hf.error.mis-pick", "hf.error.wrong-putaway", "hf.error.damage"].map((id) => kbSource(kb, id)) };
      } },
    { id: "cycle", ask: "How long does an order take?", de: "Wie lange dauert ein Auftrag?", view: "v_cycle_time_by_type",
      match: /how long|cycle|lead.?time|durchlauf|wie lange|dauer|\btakes?\b|through.?put time/,
      answer: (exp) => {
        const rows = cycleRows(exp), done = rows.filter((r) => r.retired > 0);
        const text = (done.length ? done.map((r) => r.archetype + " " + num(r.avg_cycle_ticks) + " ticks on average over " + r.retired + " of " + r.units + " units (min " + num(r.min_cycle_ticks) + ", max " + num(r.max_cycle_ticks) + ")").join("; ") : "no unit has finished yet") +
          ". Cycle time is retired tick minus spawned tick per unit; " + exp.run.minutes_per_tick + " minute" + (exp.run.minutes_per_tick === 1 ? "" : "s") + " per tick (v_cycle_time_by_type).";
        return { text: text, read: [{ view: "v_cycle_time_by_type", rows: rows }], sources: [] };
      } },
    { id: "cost", ask: "What does the run cost?", de: "Was kostet der Lauf?", view: "v_cost_by_type",
      match: /cost|\beur\b|€|kost|money|expens|teuer|price|preis/,
      answer: (exp) => {
        const L = ledger(), c = L && typeof L.costs === "function" ? L.costs(exp) : null;
        if (!c) return { text: "No rates were recorded with this run, so nothing can be costed (the planner's Analyze panel supplies them).", read: [{ view: "v_cost_by_type", rows: [] }], sources: [] };
        const t = c.total, byType = c.byType || [];
        const dearest = byType.slice().sort((a, b) => (b.eur_per_unit || 0) - (a.eur_per_unit || 0))[0];
        const text = "The run cost " + eur(t.total_eur) + " at the recorded rates: labour " + eur(t.labour_eur) + ", equipment " + eur(t.equipment_eur) + ", energy " + eur(t.energy_eur) + ", holding " + eur(t.holding_eur || 0) + "; " + eur(exp.hus.length ? t.total_eur / exp.hus.length : null) + " per handling unit." +
          (dearest ? " The dearest type per unit: " + dearest.archetype + " at " + eur(dearest.eur_per_unit) + "." : "") + " Spans between a unit's events charged at the rates the run was recorded under (v_cost_by_type); teaching rates, not a quote.";
        return { text: text, read: [{ view: "v_cost_by_type", rows: byType }], sources: [ratesSource(exp)], numbers: { total_eur: t.total_eur } };
      } },
    { id: "summary", ask: "How many units were delivered?", de: "Wie viele Einheiten wurden ausgeliefert?", view: "v_run_summary",
      match: /how many|\bunits?\b|deliver|throughput|\bcount|wie viele|durchsatz|geliefert|volume|\bevents?\b/,
      answer: (exp) => {
        const s = summaryOf(exp);
        const text = s.units + " handling units and " + s.events + " events in " + exp.run.ticks + " ticks (" + num(exp.run.ticks * exp.run.minutes_per_tick) + " min): " + s.delivered + " delivered - " + s.delivered_eaches + " eaches, " + s.delivered_pallets + " pallets, " + s.delivered_parcels + " parcels - the rest restocked, scrapped or still in flight (v_run_summary).";
        return { text: text, read: [{ view: "v_run_summary", rows: [s] }], sources: [] };
      } },
    { id: "invariants", ask: "Is the run consistent?", de: "Ist der Lauf konsistent?", view: "the invariant views",
      match: /consistent|invariant|conserv|\bgaps?\b|violation|konsistent|integrity|plausib|\bvalid/,
      answer: (exp) => {
        const inv = invariantsOf(exp), names = Object.keys(inv), bad = names.filter((k) => inv[k] > 0);
        const text = bad.length ? "The run is NOT consistent: " + bad.map((k) => k + " " + inv[k] + " row" + (inv[k] === 1 ? "" : "s")).join(", ") + " - a recording bug, not a plant fact."
          : "The run is consistent: conservation of eaches at every event, no cross-dock unit in storage, consecutive event versions per unit, terminal kinds only at retirement" + (inv.v_tracking_gaps != null ? ", one tracking twin per event inside the vocabulary" : "") + " - every one of the " + names.length + " invariant views returns 0 rows.";
        return { text: text, read: names.map((k) => ({ view: k, rows: [{ violations: inv[k] }] })), sources: [] };
      } },
  ];
  const catalogue = () => QUESTIONS.map((q) => ({ id: q.id, ask: q.ask, de: q.de, view: q.view }));
  function helpText() {
    return "I answer these questions from the recorded run's SQL views and the knowledge base - offline and rule-based, no language model: " + QUESTIONS.filter((q) => q.id !== "help").map((q) => '"' + q.ask + '"').join(", ") + ". German works too. Every answer names the view it read, the rows it used and the source of any threshold.";
  }
  function answer(question, ctx) {
    const q = String(question == null ? "" : question).trim();
    const c = ctx || {};
    const exp = c.exp;
    const kb = c.kb || WT.kb || null;
    if (!exp || !Array.isArray(exp.hus) || !Array.isArray(exp.events) || !exp.run) {
      return { id: "no-run", question: q, view: null, text: "No run is loaded yet: press Play in Simulate (the live run records itself) or load an export in the run-ledger viewer.", read: [], sources: [], unanswered: true, honesty: HONESTY };
    }
    const lower = q.toLowerCase();
    const item = q ? QUESTIONS.find((x) => x.match.test(lower)) : null;
    if (!item) {
      return { id: "help", question: q, view: "the catalogue", text: (q ? "I cannot answer that from the ledger. " : "") + helpText(), read: [], sources: [], unanswered: !!q, catalogue: catalogue(), honesty: HONESTY };
    }
    const out = item.answer(exp, kb, c);
    return Object.assign({ id: item.id, question: q, view: item.view }, out, { unanswered: false, honesty: HONESTY });
  }

  /* ---------------- rendering (shared by the drawer and the viewer) ---------------- */
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const cell = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : typeof v === "number" ? String(r4(v)) : String(v));
  function html(a, maxRows) {
    const limit = maxRows > 0 ? maxRows : 8;
    let out = '<p class="ask-text' + (a.unanswered ? " ask-unanswered" : "") + '">' + esc(a.text) + "</p>";
    for (const r of a.read || []) {
      out += '<p class="ask-read">Read: <code>' + esc(r.view) + "</code> (" + r.rows.length + " row" + (r.rows.length === 1 ? "" : "s") + ")</p>";
      if (r.rows.length) {
        const cols = Object.keys(r.rows[0]);
        out += '<div class="ask-table"><table><thead><tr>' + cols.map((k) => "<th scope=\"col\">" + esc(k) + "</th>").join("") + "</tr></thead><tbody>" +
          r.rows.slice(0, limit).map((row) => "<tr>" + cols.map((k) => "<td>" + esc(cell(row[k])) + "</td>").join("") + "</tr>").join("") + "</tbody></table>" +
          (r.rows.length > limit ? '<p class="ask-more">' + (r.rows.length - limit) + " more rows in the view.</p>" : "") + "</div>";
      }
    }
    if (a.sources && a.sources.length) out += '<ul class="ask-sources">' + a.sources.map((s) => "<li><code>" + esc(s.id) + "</code> = " + esc(num(s.value)) + (s.unit ? " " + esc(s.unit) : "") + " - " + esc(s.source) + "</li>").join("") + "</ul>";
    if (a.catalogue) out += '<p class="ask-catalogue">' + a.catalogue.filter((q) => q.id !== "help").map((q) => '<button type="button" class="ask-chip" data-ask="' + esc(q.ask) + '">' + esc(q.ask) + "</button>").join(" ") + "</p>";
    return out;
  }
  const chips = () => catalogue().filter((q) => q.id !== "help").map((q) => '<button type="button" class="ask-chip" data-ask="' + esc(q.ask) + '">' + esc(q.ask) + "</button>").join(" ");

  WT.ask = { HONESTY, QUESTIONS: catalogue(), catalogue, answer, html, chips, summaryOf, cycleRows, waitRows, invariantsOf, kbSource };
})();
