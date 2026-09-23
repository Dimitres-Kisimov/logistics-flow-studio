/* =====================================================================
 * Logistics Flow Studio - tracking.js
 * THE TRACKING DATABASE (v3.53): every handling event the run ledger writes
 * has exactly one EPCIS-shaped twin, in the vocabulary of GS1 EPCIS 2.0 and
 * the Core Business Vocabulary 2.0 - derived, not recorded.
 * ---------------------------------------------------------------------
 * WHAT IT IS
 *   - A pure function of the run ledger. `fromLedger(exp)` maps an export;
 *     `create(rec)` + `observe(track, rec)` map the events the ledger appended
 *     since the last tick. Both produce the same document, event for event
 *     (asserted in verify_tracking.js). The ledger and the simulation are
 *     never touched.
 *   - EPCIS-SHAPED, not EPCIS-conformant: a simulation has no wall clock, so
 *     `eventTime` is null and the tick and minute ride in `wt:` extension
 *     fields; the identifiers are EPC URIs built on GS1's documentation
 *     prefix (ids.js), which identify nothing real. The business steps and
 *     dispositions are the CBV 2.0 identifiers, used as a vocabulary; no
 *     conformance is claimed.
 *   - Human, mechanically: an event is keyed to a handling unit, an element
 *     and a business step - never to a worker. Nothing here reads the
 *     illustrative roster (BetrVG § 87(1)6, GDPR Art. 88; see HONESTY).
 *   - Deterministic: no Date, no Math.random. The store counts a stored
 *     sequence instead of a clock.
 *
 * THE MAPPING (docs/DIGITAL_TWIN_DEEP_DIVE.md chapter 6; the Python twin in
 * tools/run_ledger.py derives the same rows at import, and the tests pin the
 * two equal on the committed fixture)
 *   ledger kind        EPCIS                    business step / disposition
 *   created            ObjectEvent ADD          the op's step; in_progress (a return: returned)
 *   queued             ObjectEvent OBSERVE      the op's step; unchanged; wt:kind "queued" (a wait,
 *                                               which CBV does not name - kept so that
 *                                               count(twins) == count(handling events) and dwell
 *                                               can separate waiting from processing)
 *   served / passed    the op's row below       depalletise = AggregationEvent DELETE (unpacking:
 *                                               parent = the pallet SSCC, children = cases x GTIN-14);
 *                                               pack / palletise = AggregationEvent ADD (packing:
 *                                               parent = the parcel / pallet SSCC, children = eaches
 *                                               x GTIN-13 / cases x GTIN-14); everything else an
 *                                               ObjectEvent OBSERVE at the op's step
 *   delivered          ObjectEvent OBSERVE      shipping / in_transit (the arrival at `load` is loading)
 *   restocked          ObjectEvent OBSERVE      stocking / sellable_accessible
 *   scrapped           ObjectEvent DELETE       destroying / non_sellable_other (the arrival at `scrap`
 *                                               is holding / non_sellable_other)
 *   TransformationEvent is deliberately unused: nothing in the warehouse
 *   changes one SKU into another (a stated non-claim).
 *
 * SCHEMA "factory-tracking-events/v1"
 *   { schema, honesty, notes, vocabulary: { source, bizSteps, dispositions },
 *     run: { id, scenario, seed, hash, ticks, minutes_per_tick },
 *     events: [{ eventID, type, action, eventTime: null,
 *                "wt:tick", "wt:minute", "wt:kind", "wt:op", "wt:hu_id", "wt:version",
 *                epcList + quantityList | parentID + childQuantityList,
 *                bizStep, disposition, readPoint: { id, "wt:element" } | { id: null, "wt:zone" },
 *                bizLocation: { id } | null, bizTransactionList: [{ type: "po" | "rma", bizTransaction }, ...],
 *                "wt:error": null, "wt:delivery": null }] }
 *
 * THE STORE (persistence across runs): openStore({ name, maxRuns, openTimeoutMs })
 * resolves to the same promise-shaped API over IndexedDB (a browser over http)
 * or an in-memory map (Node, file://, a private window, a refused open, or an
 * open that does not complete within openTimeoutMs - Chromium under a headless
 * virtual-time budget never completes an IndexedDB request; the store names the
 * backend it serves and the reason): putRun,
 * runs, getRun, deleteRun, history(huId), byOrderRef(ref), exportJson,
 * importJson, size, close. History across runs is keyed by the handling-unit
 * id (which embeds the run id) or by the order reference - not by the SSCC,
 * which recurs from run to run because it is serialised from the unit's
 * sequence number.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const SCHEMA = "factory-tracking-events/v1";
  const STORE_SCHEMA = "factory-tracking-store/v1";
  const HONESTY =
    "EPCIS-SHAPED, not EPCIS-conformant: synthetic events derived from a synthetic teaching simulation's run ledger - " +
    "not telemetry, not a WMS. There is no wall clock (eventTime is null; the tick and minute ride in wt: fields); the " +
    "EPC identifiers are built on GS1's documentation prefix and identify nothing real; the business steps and " +
    "dispositions are GS1 CBV 2.0 identifiers used as a vocabulary. Every event is keyed to a handling unit, an " +
    "element and a business step - never to a person: nothing here reads the illustrative worker roster, and nothing " +
    "may (BetrVG § 87(1)6, GDPR Art. 88).";
  const NOTES = {
    queued: "a unit waiting at a station; CBV has no business step for waiting, so the op's step is kept and wt:kind says queued",
    inspecting: "pass-through: the simulation grades nothing at a QC bench or a returns bench (v3.53); an error what-if (v3.54) records its detection here",
    repackaging: "the value-add bench (kitting, labelling) as repackaging - a stated choice; kitting could also be read as assembling",
    holding: "a return graded out at the returns bench, held for write-off; the write-off itself is the destroying event",
    aggregation: "depalletise breaks the inbound pallet into cases (DELETE); pack and palletise build a parcel or a dispatch pallet (ADD); the child quantities are the ledger's own conserved quantities",
  };
  const VOCAB_SOURCE = "GS1 EPCIS 2.0 and Core Business Vocabulary (CBV) 2.0, ratified June 2022 - identifiers used as vocabulary, no conformance claimed";
  // The CBV 2.0 business steps and dispositions this module may emit (all
  // verified present in the ratified text). An emitted identifier outside these
  // lists is a gap (v_tracking_gaps).
  const BIZ_STEPS = ["receiving", "inspecting", "unpacking", "storing", "stocking", "picking", "staging_outbound", "repackaging", "packing", "loading", "shipping", "holding", "destroying"];
  const DISPOSITIONS = ["in_progress", "returned", "in_transit", "sellable_accessible", "sellable_not_accessible", "non_sellable_other", "mismatch_class", "damaged"];
  const BIZ_TRANSACTION_TYPES = ["po", "rma"];
  const EVENT_TYPES = ["ObjectEvent", "AggregationEvent"];
  const ACTIONS = ["ADD", "OBSERVE", "DELETE"];

  // Per operation: the business step, the stage zone (routing.js's stage for the
  // op - pinned equal in verify_tracking.js), and for the three aggregation
  // operations the action, the parent and the children. verify-pick / verify-put
  // are the v3.54 detection steps (mapped now so the vocabulary is complete).
  const OPS = {
    receive: { step: "receiving", stage: "receiving" },
    "qc-sample": { step: "inspecting", stage: "receiving" },
    "qc-final": { step: "inspecting", stage: "packing" },
    inspect: { step: "inspecting", stage: "receiving" },
    depalletise: { step: "unpacking", stage: "receiving", aggregation: "DELETE", parent: "pallet", children: "cases" },
    putaway: { step: "storing", stage: "storage" },
    replen: { step: "stocking", stage: "storage" },
    restock: { step: "stocking", stage: "storage" },
    pick: { step: "picking", stage: "picking" },
    "pallet-pick": { step: "picking", stage: "picking" },
    "case-pick": { step: "picking", stage: "picking" },
    "piece-pick": { step: "picking", stage: "picking" },
    consolidate: { step: "staging_outbound", stage: "picking" },
    vas: { step: "repackaging", stage: "packing" },
    pack: { step: "packing", stage: "packing", aggregation: "ADD", parent: "parcel", children: "eaches" },
    palletise: { step: "packing", stage: "packing", aggregation: "ADD", parent: "pallet", children: "cases" },
    wrap: { step: "packing", stage: "packing" },
    "stage-out": { step: "staging_outbound", stage: "shipping" },
    load: { step: "loading", stage: "shipping" },
    scrap: { step: "holding", stage: "shipping", disposition: "non_sellable_other" },
    "verify-pick": { step: "inspecting", stage: "picking" },
    "verify-put": { step: "inspecting", stage: "storage" },
  };
  // The terminal kinds: the step and the disposition after, and the action when
  // it is not OBSERVE.
  const TERMINAL = {
    delivered: { step: "shipping", disposition: "in_transit" },
    restocked: { step: "stocking", disposition: "sellable_accessible" },
    scrapped: { step: "destroying", disposition: "non_sellable_other", action: "DELETE" },
  };

  /* ---------------- EPC URIs (GS1 EPC Tag Data Standard, pure-identity URNs) ---- */
  const prefixLen = () => (WT.ids && WT.ids.DEMO_PREFIX ? WT.ids.DEMO_PREFIX.length : 7);
  // SSCC (18 digits: extension, company prefix, serial, check) ->
  // urn:epc:id:sscc:<prefix>.<extension + serial>
  function ssccUrn(sscc) {
    const s = String(sscc), p = prefixLen();
    return "urn:epc:id:sscc:" + s.slice(1, 1 + p) + "." + s.charAt(0) + s.slice(1 + p, 17);
  }
  // GTIN-13 or GTIN-14 -> the class pattern urn:epc:idpat:sgtin:<prefix>.<indicator + item reference>.*
  function sgtinPattern(gtin) {
    const g = String(gtin).length === 13 ? "0" + gtin : String(gtin), p = prefixLen();
    return "urn:epc:idpat:sgtin:" + g.slice(1, 1 + p) + "." + g.charAt(0) + g.slice(1 + p, 13) + ".*";
  }
  // GLN (13 digits) -> urn:epc:id:sgln:<prefix>.<location reference>.0
  function sglnUrn(gln) {
    const g = String(gln), p = prefixLen();
    return "urn:epc:id:sgln:" + g.slice(0, p) + "." + g.slice(p, 12) + ".0";
  }
  // The read point of an element: a GLN derived from the element id through the
  // shipped ids.gln (the item-reference recipe of ledger.js: 1 + fnv1a % 99999).
  function glnFor(elementId) {
    const I = WT.ids;
    return I ? I.gln(1 + (I.fnv1a(String(elementId)) % 99999)) : null;
  }
  const isZone = (location) => String(location).indexOf("zone:") === 0;
  function readPointFor(location, ctx) {
    const loc = String(location);
    if (isZone(loc)) return { id: null, "wt:zone": loc.slice(5) };
    const cache = ctx.gln || (ctx.gln = {});
    if (!cache[loc]) cache[loc] = sglnUrn(glnFor(loc));
    return { id: cache[loc], "wt:element": loc };
  }
  // The aggregation parents: the unit's own SSCC carries extension 3 for a pallet
  // unit and 0 for a parcel unit (ledger.js); the other level is the same serial
  // with the other extension digit - the app's convention, nothing registered.
  function palletSscc(h) { return String(h.sscc).charAt(0) === "3" || !WT.ids ? h.sscc : WT.ids.sscc(3, h.seq); }
  function parcelSscc(h) { return String(h.sscc).charAt(0) === "0" || !WT.ids ? h.sscc : WT.ids.sscc(0, h.seq); }

  /* ---------------- the mapping ------------------------------------------ */
  const initialDisposition = (h) => (h.archetype === "returns" ? "returned" : "in_progress");
  // One handling event -> its twin. `st` is the unit's running state (its
  // disposition after the previous event); `ctx` caches read points.
  function twin(e, h, st, ctx) {
    const def = OPS[e.op] || { step: "wt:unknown:" + e.op, stage: e.stage || "unknown" };
    const term = TERMINAL[e.kind];
    let type = "ObjectEvent", action = "OBSERVE", step = def.step, disp = st.disposition, agg = null;
    if (e.kind === "created") action = "ADD";
    else if (term) { step = term.step; disp = term.disposition; if (term.action) action = term.action; }
    else if (e.kind !== "queued") {
      if (def.aggregation) { type = "AggregationEvent"; action = def.aggregation; agg = def; }
      if (def.disposition) disp = def.disposition;
    }
    st.disposition = disp;
    const ev = { eventID: "urn:wt:evt:" + e.id, type: type, action: action, eventTime: null,
      "wt:tick": e.tick, "wt:minute": e.minute, "wt:kind": e.kind, "wt:op": e.op, "wt:hu_id": e.hu_id, "wt:version": e.version };
    if (agg) {
      ev.parentID = ssccUrn(agg.parent === "pallet" ? palletSscc(h) : parcelSscc(h));
      ev.childQuantityList = [{ epcClass: sgtinPattern(agg.children === "cases" ? h.gtin14 : h.gtin13), quantity: agg.children === "cases" ? e.cases : e.eaches, uom: "EA" }];
    } else {
      ev.epcList = [ssccUrn(h.sscc)];
      ev.quantityList = [{ epcClass: sgtinPattern(h.gtin13), quantity: e.eaches, uom: "EA" }];
    }
    ev.bizStep = step;
    ev.disposition = disp;
    ev.readPoint = readPointFor(e.location, ctx);
    ev.bizLocation = disp === "in_transit" ? null : { id: "urn:wt:zone:" + def.stage };
    ev.bizTransactionList = [{ type: h.archetype === "returns" ? "rma" : "po", bizTransaction: h.order_id }];
    if (h.order_ref != null) ev.bizTransactionList.push({ type: "wt:order_ref", bizTransaction: String(h.order_ref) });
    ev["wt:error"] = null;
    ev["wt:delivery"] = null;
    return ev;
  }
  function runBlock(run) {
    return { id: run.id, scenario: run.scenario, seed: run.seed, hash: run.hash == null ? null : run.hash, ticks: run.ticks, minutes_per_tick: run.minutes_per_tick };
  }
  function makeDocument(run, events) {
    return { schema: SCHEMA, honesty: HONESTY, notes: NOTES, vocabulary: { source: VOCAB_SOURCE, bizSteps: BIZ_STEPS.slice(), dispositions: DISPOSITIONS.slice() },
      run: runBlock(run), events: events };
  }
  // The whole document from a ledger EXPORT (the JSON), in the export's event order.
  function fromLedger(exp) {
    const hus = {};
    for (const h of exp.hus || []) hus[h.id] = h;
    const state = {}, ctx = {}, out = [];
    for (const e of exp.events || []) {
      const h = hus[e.hu_id];
      if (!h) continue;
      const st = state[h.id] || (state[h.id] = { disposition: initialDisposition(h) });
      out.push(twin(e, h, st, ctx));
    }
    return makeDocument(exp.run, out);
  }
  // Incremental: a tracker attached to a live ledger record. observe() maps the
  // events appended since the last call and reads the record only.
  function create(rec) {
    return { kind: "wt-tracking", schema: SCHEMA, run: rec ? rec.run : null, events: [], cursor: 0, state: {}, ctx: {} };
  }
  function observe(track, rec) {
    if (!track || !rec || !Array.isArray(rec.events)) return track;
    for (let i = track.cursor; i < rec.events.length; i++) {
      const e = rec.events[i], h = rec.hus[e.hu_id];
      if (!h) continue;
      const st = track.state[h.id] || (track.state[h.id] = { disposition: initialDisposition(h) });
      track.events.push(twin(e, h, st, track.ctx));
    }
    track.cursor = rec.events.length;
    track.run = rec.run;
    return track;
  }
  function exportJson(track) { return makeDocument(track.run || {}, track.events.slice()); }

  /* ---------------- the three questions (pure over events[]) --------------- */
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const byUnit = (events) => {
    const m = {};
    for (const ev of events) (m[ev["wt:hu_id"]] = m[ev["wt:hu_id"]] || []).push(ev);
    for (const k in m) m[k].sort((a, b) => a["wt:version"] - b["wt:version"]);
    return m;
  };
  // Where was unit X and what happened to it: its events in version order.
  function historyOf(events, huId) { return (byUnit(events)[huId] || []).slice(); }
  // At which step do units wait, and for how long: per business step the events,
  // the units, the spans (events with a next event of the same unit), the mean
  // and maximum ticks to that next event, the waiting ticks (queued events) and
  // their share. The same definition as v_bizstep_dwell (LEAD(tick) - tick).
  function dwellByBizStep(events) {
    const units = byUnit(events), agg = {};
    for (const id in units) {
      const evs = units[id];
      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i], next = evs[i + 1];
        const a = agg[ev.bizStep] || (agg[ev.bizStep] = { biz_step: ev.bizStep, events: 0, units: {}, spans: 0, sum: 0, max: null, waiting: 0 });
        a.events++; a.units[id] = 1;
        if (next) { const d = next["wt:tick"] - ev["wt:tick"]; a.spans++; a.sum += d; a.max = a.max == null ? d : Math.max(a.max, d); if (ev["wt:kind"] === "queued") a.waiting += d; }
      }
    }
    return Object.keys(agg).sort().map((k) => { const a = agg[k];
      return { biz_step: k, events: a.events, units: Object.keys(a.units).length, spans: a.spans, avg_ticks_to_next: a.spans ? r2(a.sum / a.spans) : null,
        max_ticks_to_next: a.max, waiting_ticks: a.waiting, total_ticks: a.sum, waiting_share: a.sum > 0 ? r4(a.waiting / a.sum) : null }; });
  }
  // Which steps produce which dispositions: per (business step, disposition) the events and units.
  function dispositionCounts(events) {
    const agg = {};
    for (const ev of events) {
      const k = ev.bizStep + " " + ev.disposition;
      const a = agg[k] || (agg[k] = { biz_step: ev.bizStep, disposition: ev.disposition, events: 0, units: {} });
      a.events++; a.units[ev["wt:hu_id"]] = 1;
    }
    return Object.keys(agg).sort().map((k) => { const a = agg[k]; return { biz_step: a.biz_step, disposition: a.disposition, events: a.events, units: Object.keys(a.units).length }; });
  }
  // The invariant: handling events without a twin, twins outside the vocabulary
  // (the same definition as v_tracking_gaps). Must be 0.
  function gaps(exp, doc) {
    const seen = {};
    let n = 0;
    for (const ev of doc.events || []) {
      seen[ev.eventID] = 1;
      if (BIZ_STEPS.indexOf(ev.bizStep) < 0) n++;
      if (DISPOSITIONS.indexOf(ev.disposition) < 0) n++;
    }
    for (const e of exp.events || []) if (!seen["urn:wt:evt:" + e.id]) n++;
    return n;
  }
  // A document's shape and vocabulary: { ok, errors } (the first errors named).
  function validate(doc) {
    const errors = [];
    const err = (m) => { if (errors.length < 8) errors.push(m); };
    if (!doc || typeof doc !== "object") return { ok: false, errors: ["not an object"] };
    if (doc.schema !== SCHEMA) err("schema is " + JSON.stringify(doc.schema) + ", expected " + SCHEMA);
    if (!doc.run || typeof doc.run.id !== "string") err("run.id missing");
    if (!Array.isArray(doc.events)) { err("events is not an array"); return { ok: false, errors: errors }; }
    const ids = {};
    doc.events.forEach((ev, i) => {
      if (!ev || typeof ev.eventID !== "string") { err("event " + i + " has no eventID"); return; }
      if (ids[ev.eventID]) err("duplicate eventID " + ev.eventID);
      ids[ev.eventID] = 1;
      if (EVENT_TYPES.indexOf(ev.type) < 0) err(ev.eventID + ": type " + ev.type);
      if (ACTIONS.indexOf(ev.action) < 0) err(ev.eventID + ": action " + ev.action);
      if (BIZ_STEPS.indexOf(ev.bizStep) < 0) err(ev.eventID + ": unknown business step " + JSON.stringify(ev.bizStep));
      if (DISPOSITIONS.indexOf(ev.disposition) < 0) err(ev.eventID + ": unknown disposition " + JSON.stringify(ev.disposition));
      if (typeof ev["wt:hu_id"] !== "string") err(ev.eventID + ": wt:hu_id missing");
      if (typeof ev["wt:tick"] !== "number") err(ev.eventID + ": wt:tick missing");
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------------- the store ----------------------------------------------- */
  // Two engines behind one API. An engine is a handful of promise-returning
  // primitives; the store logic (validation, replacement, eviction, ordering,
  // export / import) is written once on top of them.
  const orderRefOf = (ev) => {
    const bt = (ev.bizTransactionList || []).find((b) => b.type === "wt:order_ref");
    return bt ? String(bt.bizTransaction) : undefined;
  };
  function rowsOf(doc, seq) {
    return doc.events.map((ev, n) => {
      const row = { eventID: ev.eventID, run_id: doc.run.id, stored_seq: seq, n: n, hu_id: ev["wt:hu_id"], tick: ev["wt:tick"], version: ev["wt:version"], event: ev };
      const ref = orderRefOf(ev);
      if (ref !== undefined) row.order_ref = ref;
      return row;
    });
  }
  function memoryEngine() {
    const runs = {}, events = {};
    let seq = 0;
    const P = (v) => Promise.resolve(v);
    const rowsWhere = (pred) => P(Object.keys(events).map((k) => events[k]).filter(pred));
    return {
      backend: "memory",
      nextSeq: () => P(++seq),
      allRuns: () => P(Object.keys(runs).map((k) => runs[k])),
      getRunRow: (id) => P(runs[id] || null),
      putRunRow: (row) => { runs[row.id] = row; return P(); },
      deleteRunRow: (id) => { delete runs[id]; return P(); },
      putEvents: (rows) => { for (const r of rows) events[r.eventID] = r; return P(); },
      deleteEventsByRun: (id) => { for (const k of Object.keys(events)) if (events[k].run_id === id) delete events[k]; return P(); },
      eventsByRun: (id) => rowsWhere((r) => r.run_id === id),
      eventsByHu: (hu) => rowsWhere((r) => r.hu_id === hu),
      eventsByOrderRef: (ref) => rowsWhere((r) => r.order_ref === ref),
      count: () => P({ runs: Object.keys(runs).length, events: Object.keys(events).length }),
      close: () => P(),
    };
  }
  function idbEngine(db) {
    const reqp = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error || new Error("IndexedDB request failed")); });
    const tx = (names, mode, fn) => new Promise((res, rej) => {
      let out;
      const t = db.transaction(names, mode);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error || new Error("IndexedDB transaction failed"));
      t.onabort = () => rej(t.error || new Error("IndexedDB transaction aborted"));
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch (_) { /* already done */ } rej(e); });
    });
    const getAll = (store) => reqp(store.getAll());
    const byIndex = (name, key) => tx(["events"], "readonly", (t) => reqp(t.objectStore("events").index(name).getAll(key)));
    return {
      backend: "indexeddb",
      nextSeq: () => tx(["meta"], "readwrite", (t) => reqp(t.objectStore("meta").get("seq")).then((row) => {
        const next = ((row && row.value) || 0) + 1;
        return reqp(t.objectStore("meta").put({ key: "seq", value: next })).then(() => next);
      })),
      allRuns: () => tx(["runs"], "readonly", (t) => getAll(t.objectStore("runs"))),
      getRunRow: (id) => tx(["runs"], "readonly", (t) => reqp(t.objectStore("runs").get(id)).then((r) => r || null)),
      putRunRow: (row) => tx(["runs"], "readwrite", (t) => reqp(t.objectStore("runs").put(row))),
      deleteRunRow: (id) => tx(["runs"], "readwrite", (t) => reqp(t.objectStore("runs").delete(id))),
      putEvents: (rows) => tx(["events"], "readwrite", (t) => { const s = t.objectStore("events"); for (const r of rows) s.put(r); }),
      deleteEventsByRun: (id) => tx(["events"], "readwrite", (t) => reqp(t.objectStore("events").index("by_run").getAllKeys(id)).then((keys) => { const s = t.objectStore("events"); for (const k of keys) s.delete(k); })),
      eventsByRun: (id) => byIndex("by_run", id),
      eventsByHu: (hu) => byIndex("by_hu", hu),
      eventsByOrderRef: (ref) => byIndex("by_order_ref", ref),
      count: () => tx(["runs", "events"], "readonly", (t) => Promise.all([reqp(t.objectStore("runs").count()), reqp(t.objectStore("events").count())]).then((c) => ({ runs: c[0], events: c[1] }))),
      close: () => { try { db.close(); } catch (_) { /* closed */ } return Promise.resolve(); },
    };
  }
  const bySeq = (a, b) => a.stored_seq - b.stored_seq;
  const byRunThenN = (a, b) => a.stored_seq - b.stored_seq || a.n - b.n;
  function docOf(runRow, rows) {
    rows.sort((a, b) => a.n - b.n);
    return { schema: SCHEMA, honesty: runRow.honesty, notes: runRow.notes, vocabulary: runRow.vocabulary, run: runRow.run, events: rows.map((r) => r.event) };
  }
  function grouped(rows) {
    rows.sort(byRunThenN);
    const out = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.run_id === r.run_id) last.events.push(r.event);
      else out.push({ run_id: r.run_id, stored_seq: r.stored_seq, events: [r.event] });
    }
    return out;
  }
  function storeOver(engine, name, maxRuns, reason) {
    const store = { backend: engine.backend, name: name, maxRuns: maxRuns, reason: reason || null };
    store.putRun = (doc) => {
      const v = validate(doc);
      if (!v.ok) return Promise.reject(new Error("refused: " + v.errors.join("; ")));
      const id = doc.run.id;
      return engine.getRunRow(id).then((old) => (old ? engine.deleteEventsByRun(id) : null))
        .then(() => engine.nextSeq())
        .then((seq) => engine.putRunRow({ id: id, stored_seq: seq, events_count: doc.events.length, run: doc.run, honesty: doc.honesty, notes: doc.notes, vocabulary: doc.vocabulary })
          .then(() => engine.putEvents(rowsOf(doc, seq))).then(() => seq))
        .then((seq) => engine.allRuns().then((runs) => {
          runs.sort(bySeq);
          const evict = runs.slice(0, Math.max(0, runs.length - maxRuns)).map((r) => r.id);
          let p = Promise.resolve();
          for (const rid of evict) p = p.then(() => engine.deleteEventsByRun(rid)).then(() => engine.deleteRunRow(rid));
          return p.then(() => ({ id: id, stored_seq: seq, events: doc.events.length, evicted: evict }));
        }));
    };
    store.runs = () => engine.allRuns().then((runs) => runs.sort(bySeq).map((r) => ({ id: r.id, stored_seq: r.stored_seq, events_count: r.events_count, run: r.run })));
    store.getRun = (id) => engine.getRunRow(id).then((row) => (row ? engine.eventsByRun(id).then((rows) => docOf(row, rows)) : null));
    store.deleteRun = (id) => engine.deleteEventsByRun(id).then(() => engine.deleteRunRow(id)).then(() => true);
    store.history = (huId) => engine.eventsByHu(huId).then(grouped);
    store.byOrderRef = (ref) => engine.eventsByOrderRef(String(ref)).then(grouped);
    store.exportJson = () => store.runs().then((runs) => Promise.all(runs.map((r) => store.getRun(r.id)))).then((docs) => ({ schema: STORE_SCHEMA, runs: docs }));
    store.importJson = (obj) => {
      const docs = obj && obj.schema === STORE_SCHEMA && Array.isArray(obj.runs) ? obj.runs : obj && obj.schema === SCHEMA ? [obj] : null;
      if (!docs) return Promise.reject(new Error("refused: not a " + SCHEMA + " or " + STORE_SCHEMA + " document"));
      for (const d of docs) { const v = validate(d); if (!v.ok) return Promise.reject(new Error("refused: " + v.errors.join("; "))); }
      let p = Promise.resolve(), events = 0;
      for (const d of docs) p = p.then(() => store.putRun(d)).then((r) => { events += r.events; });
      return p.then(() => ({ runs: docs.length, events: events }));
    };
    store.size = () => engine.count().then((c) => ({ runs: c.runs, events: c.events, backend: engine.backend }));
    store.close = () => engine.close();
    return store;
  }
  function openStore(opts) {
    const o = opts || {};
    const name = o.name || "wt-tracking-v1";
    const maxRuns = o.maxRuns > 0 ? Math.floor(o.maxRuns) : 20;
    const timeoutMs = o.openTimeoutMs > 0 ? Math.floor(o.openTimeoutMs) : 5000;
    let idb = null;
    try { idb = typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function" ? indexedDB : null; } catch (_) { idb = null; }
    if (!idb || o.backend === "memory") return Promise.resolve(storeOver(memoryEngine(), name, maxRuns, idb ? "memory requested" : "no IndexedDB in this environment"));
    return new Promise((resolve) => {
      let req, settled = false, timer = null;
      const settle = (store) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(store); };
      try { req = idb.open(name, 1); } catch (e) { settle(storeOver(memoryEngine(), name, maxRuns, "open threw: " + (e && e.message))); return; }
      // an open that never completes (a headless virtual-time budget) must not stall the caller
      timer = setTimeout(() => settle(storeOver(memoryEngine(), name, maxRuns, "IndexedDB open did not complete within " + timeoutMs + " ms")), timeoutMs);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("events")) {
          const s = db.createObjectStore("events", { keyPath: "eventID" });
          s.createIndex("by_run", "run_id", { unique: false });
          s.createIndex("by_hu", "hu_id", { unique: false });
          s.createIndex("by_order_ref", "order_ref", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onerror = () => settle(storeOver(memoryEngine(), name, maxRuns, "open failed: " + (req.error && req.error.message)));
      req.onblocked = () => settle(storeOver(memoryEngine(), name, maxRuns, "open blocked"));
      req.onsuccess = () => {
        if (settled) { try { req.result.close(); } catch (_) { /* late open after the fallback */ } return; }
        settle(storeOver(idbEngine(req.result), name, maxRuns, null));
      };
    });
  }
  // Remove a store's database (tests). Resolves on the memory backend too.
  function deleteStore(name) {
    let idb = null;
    try { idb = typeof indexedDB !== "undefined" && indexedDB ? indexedDB : null; } catch (_) { idb = null; }
    if (!idb) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(false), 2000); // the same guard as openStore
      let req;
      try { req = idb.deleteDatabase(name); } catch (_) { clearTimeout(timer); finish(false); return; }
      req.onsuccess = () => { clearTimeout(timer); finish(true); };
      req.onerror = () => { clearTimeout(timer); finish(false); };
      req.onblocked = () => { clearTimeout(timer); finish(false); };
    });
  }

  WT.tracking = { SCHEMA, STORE_SCHEMA, HONESTY, NOTES, VOCAB_SOURCE, BIZ_STEPS, DISPOSITIONS, BIZ_TRANSACTION_TYPES, EVENT_TYPES, ACTIONS, OPS, TERMINAL,
    ssccUrn, sgtinPattern, sglnUrn, glnFor, twin, fromLedger, create, observe, exportJson,
    historyOf, dwellByBizStep, dispositionCounts, gaps, validate, openStore, deleteStore };
})();
