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
 * importJson (v3.58: also an EPCIS 2.0 capture document, mapped by fromEpcis -
 * the return path; v3.64: an imported document carries the synchronisation
 * contract of ISO 23247-1 and freshness() measures it), size, close. History
 * across runs is keyed by the handling-unit
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
  // v3.54 the declared error of a unit (ledger hu.error_*): realised at the first
  // non-queued event at its step (the disposition the kind names, wt:error with
  // detected false - true for a damage, which is seen at the step), detected at the
  // verification step (inspecting, back to in_progress, wt:error.detected true); the
  // redo is an ordinary event. routing.js ERROR_KINDS names the same dispositions
  // (pinned equal in verify_errors.js); tools/run_ledger.py mirrors this.
  const ERROR_DISPOSITION = { "mis-pick": "mismatch_class", "wrong-putaway": "sellable_not_accessible", damage: "damaged" };
  const VERIFY_OPS = { "verify-pick": 1, "verify-put": 1 };
  const initialDisposition = (h) => (h.archetype === "returns" ? "returned" : "in_progress");
  const initialState = (h) => ({ disposition: initialDisposition(h), errored: false, detected: false });
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
      if (def.disposition && st.disposition !== "damaged") disp = def.disposition; // a damaged unit stays damaged until it is destroyed
    }
    let error = null;
    if (h.error_op && e.kind !== "queued" && !term) {
      if (!st.errored && e.op === h.error_op) {
        st.errored = true;
        disp = ERROR_DISPOSITION[h.error_kind] || "non_sellable_other";
        error = { kind: h.error_kind, step: h.error_op, detected: h.error_outcome === "scrap", latent: (h.error_latent || []).slice() };
      } else if (st.errored && !st.detected && VERIFY_OPS[e.op]) {
        st.detected = true;
        disp = "in_progress";
        error = { kind: h.error_kind, step: h.error_op, detected: true, latent: (h.error_latent || []).slice() };
      }
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
    ev["wt:error"] = error;
    // v3.55: the delivery facts ride on the first event (the trailer) and the shipping event (promise, transit, outcome)
    let delivery = null;
    if (e.kind === "created" && h.trailer != null) delivery = { trailer: h.trailer };
    else if (e.kind === "delivered" && h.due_tick != null) delivery = { due_tick: h.due_tick, transit_ticks: h.transit_ticks, customer_tick: h.customer_tick, on_time_shipped: h.on_time_shipped, on_time: h.on_time };
    ev["wt:delivery"] = delivery;
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
      const st = state[h.id] || (state[h.id] = initialState(h));
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
      const st = track.state[h.id] || (track.state[h.id] = initialState(h));
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


  /* ---------------- v3.58 the return path: a recorded EPCIS 2.0 document ------ */
  // An EPCIS 2.0 capture document (JSON / JSON-LD: { type: "EPCISDocument", schemaVersion: "2.0",
  // epcisBody: { eventList: [...] } }) from a WMS or a scanner system, mapped onto the shape the
  // twins use, so recorded events can be asked the same three questions and kept in the same
  // store. Strict on purpose: only ObjectEvent and AggregationEvent; only the business steps and
  // dispositions this app knows (the refusal names the identifier and says whether it is CBV 2.0
  // at all); every event with a zoned time and an object. The three CBV forms are read - the
  // bare 2.0 identifier, the 1.x URN (urn:epcglobal:cbv:bizstep:x) and the web URI
  // (https://ref.gs1.org/cbv/BizStep-x). An ObjectEvent naming several objects becomes one
  // mapped event per object (eventID suffixed #2, #3, ...) so that a unit's history is
  // complete; the summary reports both counts. wt:tick counts whole minutes from the document's
  // earliest event (the wall clock stays in eventTime, which the derived twins never carry).
  // No Date: ISO 8601 is parsed by hand (days from civil, the zone offset applied). The Python
  // twin is tools/epcis_import.py; verify_epcis_import.js pins the two equal on the fixture.
  const EPCIS_TYPES = ["EPCISDocument"];
  // The CBV 2.0 vocabularies as the ratified JSON-LD context enumerates them
  // (ref.gs1.org/standards/epcis/epcis-context.jsonld, read 2026-09-23): 41 business steps,
  // 33 dispositions, 13 business transaction types. Used to tell "CBV, but not mapped here"
  // from "not CBV at all" in a refusal.
  const CBV_BIZ_STEPS = ["accepting", "arriving", "assembling", "collecting", "commissioning", "consigning", "creating_class_instance", "cycle_counting", "decommissioning", "departing", "destroying", "disassembling", "dispensing", "encoding", "entering_exiting", "holding", "inspecting", "installing", "killing", "loading", "other", "packing", "picking", "receiving", "removing", "repackaging", "repairing", "replacing", "reserving", "retail_selling", "sampling", "sensor_reporting", "shipping", "staging_outbound", "stock_taking", "stocking", "storing", "transporting", "unloading", "unpacking", "void_shipping"];
  const CBV_DISPOSITIONS = ["active", "available", "completeness_inferred", "completeness_verified", "conformant", "container_closed", "container_open", "damaged", "destroyed", "dispensed", "disposed", "encoded", "expired", "in_progress", "in_transit", "inactive", "mismatch_class", "mismatch_instance", "mismatch_quantity", "needs_replacement", "no_pedigree_match", "non_conformant", "non_sellable_other", "partially_dispensed", "recalled", "reserved", "retail_sold", "returned", "sellable_accessible", "sellable_not_accessible", "stolen", "unavailable", "unknown"];
  const CBV_BTT = ["bol", "cert", "desadv", "inv", "pedigree", "po", "poc", "prodorder", "recadv", "rma", "testprd", "testres", "upevt"];
  const IMPORT_SOURCE = "imported";
  const IMPORT_HONESTY =
    "Recorded events imported from an EPCIS 2.0 document - the physical-to-digital direction, by hand (a file), so a " +
    "shadow only in the manual sense of Kritzinger's ladder: nothing is streamed, nothing is sent back, the app reads " +
    "the events, aggregates them per business step and never acts on them. The identifiers, times and places are the " +
    "document's own (nothing here says they are registered or true); wt:tick counts whole minutes from the document's " +
    "earliest event and the wall clock stays in eventTime. An event names an object, a place and a step - never a " +
    "person (BetrVG 87(1)6, GDPR Art. 88).";
  const CBV_URN = { bizStep: "urn:epcglobal:cbv:bizstep:", disposition: "urn:epcglobal:cbv:disp:", btt: "urn:epcglobal:cbv:btt:" };
  const CBV_WEB = { bizStep: "https://ref.gs1.org/cbv/BizStep-", disposition: "https://ref.gs1.org/cbv/Disp-", btt: "https://ref.gs1.org/cbv/BTT-" };
  const CBV_LIST = { bizStep: CBV_BIZ_STEPS, disposition: CBV_DISPOSITIONS, btt: CBV_BTT };
  // The event fields the mapping reads; every other event-level field is counted as ignored.
  const EPCIS_FIELDS = ["eventID", "type", "@type", "isA", "action", "eventTime", "eventTimeZoneOffset", "bizStep", "disposition", "epcList", "quantityList", "parentID", "childEPCs", "childQuantityList", "readPoint", "bizLocation", "bizTransactionList"];
  // A CBV identifier in any of its three forms -> { id, form: bare | urn | web | other, cbv } (null when absent).
  function cbvId(value, kind) {
    if (typeof value !== "string" || !value) return null;
    let id = value, form = "bare";
    if (value.indexOf(CBV_URN[kind]) === 0) { id = value.slice(CBV_URN[kind].length); form = "urn"; }
    else if (value.indexOf(CBV_WEB[kind]) === 0) { id = value.slice(CBV_WEB[kind].length); form = "web"; }
    else if (!/^[a-z][a-z0-9_]*$/.test(value)) return { id: value, form: "other", cbv: false };
    return { id: id, form: form, cbv: CBV_LIST[kind].indexOf(id) >= 0 };
  }
  // Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's days_from_civil).
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  // An ISO 8601 date-time with a zone (Z or +-hh:mm) -> milliseconds since the epoch; null when it is not one.
  // Fractions beyond the millisecond are dropped (not rounded), so JavaScript and Python agree.
  function parseIsoMs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(String(s == null ? "" : s));
    if (!m) return null;
    const mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5], ss = +m[6];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 60) return null;
    const frac = m[7] ? +((m[7] + "00").slice(0, 3)) : 0;
    let ms = (daysFromCivil(+m[1], mo, d) * 86400 + hh * 3600 + mi * 60 + ss) * 1000 + frac;
    if (m[8] !== "Z") { const sign = m[8].charAt(0) === "-" ? -1 : 1; ms -= sign * ((+m[8].slice(1, 3)) * 3600 + (+m[8].slice(4, 6)) * 60) * 1000; }
    return ms;
  }
  // FNV-1a 32-bit over the string's code units (the same as ids.js / tools/run_ledger.py).
  function fnv1a32(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // The objects an event names: the parent of an aggregation; the EPCs of an object event, or its
  // first class when it is class-level only.
  function unitKeys(ev, type) {
    if (type === "AggregationEvent") return typeof ev.parentID === "string" && ev.parentID ? [ev.parentID] : [];
    const epcs = Array.isArray(ev.epcList) ? ev.epcList.filter((x) => typeof x === "string" && x) : [];
    if (epcs.length) return epcs;
    const q = Array.isArray(ev.quantityList) ? ev.quantityList.filter((x) => x && typeof x.epcClass === "string" && x.epcClass) : [];
    return q.length ? [q[0].epcClass] : [];
  }
  const quantitiesOf = (list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x.epcClass === "string" && typeof x.quantity === "number")
    .map((x) => ({ epcClass: x.epcClass, quantity: x.quantity, uom: typeof x.uom === "string" && x.uom ? x.uom : "EA" }));
  // The document -> { ok, errors, doc (factory-tracking-events/v1), summary }. Pure and deterministic.
  function fromEpcis(input, opts) {
    const errors = [];
    const err = (m) => { if (errors.length < 8) errors.push(m); };
    const fail = () => ({ ok: false, errors: errors.slice(), doc: null, summary: null });
    if (!input || typeof input !== "object" || Array.isArray(input)) { err("not an object"); return fail(); }
    const dtype = input.type || input["@type"] || input.isA;
    if (EPCIS_TYPES.indexOf(dtype) < 0) { err("not an EPCIS 2.0 capture document (type " + JSON.stringify(dtype == null ? null : dtype) + ", expected EPCISDocument)"); return fail(); }
    if (input.schemaVersion != null && !/^2(\.\d+)*$/.test(String(input.schemaVersion))) { err("schemaVersion " + JSON.stringify(String(input.schemaVersion)) + ": only EPCIS 2.0 JSON is read"); return fail(); }
    const list = input.epcisBody && Array.isArray(input.epcisBody.eventList) ? input.epcisBody.eventList : null;
    if (!list) { err("epcisBody.eventList missing"); return fail(); }
    if (!list.length) { err("epcisBody.eventList is empty"); return fail(); }
    const ignored = {}, ids = {}, mapped = [];
    list.forEach((ev, i) => {
      const where = "event " + (i + 1);
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) { err(where + ": not an object"); return; }
      const type = ev.type || ev["@type"] || ev.isA;
      if (EVENT_TYPES.indexOf(type) < 0) { err(where + ": " + (type == null ? "no event type" : String(type) + " is not mapped") + " (only ObjectEvent and AggregationEvent are)"); return; }
      if (ACTIONS.indexOf(ev.action) < 0) { err(where + ": action " + JSON.stringify(ev.action == null ? null : ev.action) + " (ADD, OBSERVE or DELETE)"); return; }
      const ms = parseIsoMs(ev.eventTime);
      if (ms == null) { err(where + ": eventTime " + JSON.stringify(ev.eventTime == null ? null : ev.eventTime) + " is not an ISO 8601 date-time with a zone"); return; }
      const step = cbvId(ev.bizStep, "bizStep"), disp = cbvId(ev.disposition, "disposition");
      if (!step) { err(where + ": no bizStep (known: " + BIZ_STEPS.join(", ") + ")"); return; }
      if (BIZ_STEPS.indexOf(step.id) < 0) { err(where + ": business step " + JSON.stringify(step.id) + (step.cbv ? " is CBV 2.0 but not one this app maps" : " is not a CBV 2.0 business step") + " (known: " + BIZ_STEPS.join(", ") + ")"); return; }
      if (!disp) { err(where + ": no disposition (known: " + DISPOSITIONS.join(", ") + ")"); return; }
      if (DISPOSITIONS.indexOf(disp.id) < 0) { err(where + ": disposition " + JSON.stringify(disp.id) + (disp.cbv ? " is CBV 2.0 but not one this app maps" : " is not a CBV 2.0 disposition") + " (known: " + DISPOSITIONS.join(", ") + ")"); return; }
      const keys = unitKeys(ev, type);
      if (!keys.length) { err(where + ": names no object (no " + (type === "AggregationEvent" ? "parentID" : "epcList or quantityList") + ")"); return; }
      for (const k of Object.keys(ev)) if (EPCIS_FIELDS.indexOf(k) < 0) ignored[k] = (ignored[k] || 0) + 1;
      const baseId = typeof ev.eventID === "string" && ev.eventID ? ev.eventID : "urn:wt:evt:import-" + (i + 1);
      const epcs = Array.isArray(ev.epcList) ? ev.epcList.filter((x) => typeof x === "string" && x) : [];
      keys.forEach((key, n) => {
        const id = n === 0 ? baseId : baseId + "#" + (n + 1);
        if (ids[id]) { err(where + ": duplicate eventID " + id); return; }
        ids[id] = 1;
        const out = { eventID: id, type: type, action: ev.action, eventTime: String(ev.eventTime), eventTimeZoneOffset: typeof ev.eventTimeZoneOffset === "string" ? ev.eventTimeZoneOffset : null,
          "wt:tick": 0, "wt:minute": 0, "wt:kind": "recorded", "wt:op": null, "wt:hu_id": key, "wt:version": 0, "wt:source": IMPORT_SOURCE, "wt:document_event": i + 1 };
        if (type === "AggregationEvent") {
          out.parentID = key;
          out.childEPCs = Array.isArray(ev.childEPCs) ? ev.childEPCs.filter((x) => typeof x === "string" && x) : [];
          out.childQuantityList = quantitiesOf(ev.childQuantityList);
        } else {
          out.epcList = epcs.length ? [key] : [];
          out.quantityList = quantitiesOf(ev.quantityList);
        }
        out.bizStep = step.id;
        out.disposition = disp.id;
        out["wt:vocabulary"] = { bizStep: step.form, disposition: disp.form };
        out.readPoint = { id: ev.readPoint && typeof ev.readPoint.id === "string" ? ev.readPoint.id : null };
        out.bizLocation = ev.bizLocation && typeof ev.bizLocation.id === "string" ? { id: ev.bizLocation.id } : null;
        out.bizTransactionList = (Array.isArray(ev.bizTransactionList) ? ev.bizTransactionList : []).filter((b) => b && typeof b.bizTransaction === "string")
          .map((b) => { const t = cbvId(b.type, "btt"); return { type: t ? t.id : null, bizTransaction: b.bizTransaction }; });
        out["wt:error"] = null;
        out["wt:delivery"] = null;
        mapped.push({ ms: ms, i: i, n: n, ev: out });
      });
    });
    if (errors.length) return fail();
    mapped.sort((a, b) => a.ms - b.ms || a.i - b.i || a.n - b.n);
    const t0 = mapped[0].ms, versions = {};
    let maxTick = 0;
    for (const m of mapped) {
      const minutes = (m.ms - t0) / 60000, key = m.ev["wt:hu_id"];
      m.ev["wt:minute"] = minutes;
      m.ev["wt:tick"] = Math.floor(minutes + 0.5);
      m.ev["wt:version"] = versions[key] || 0;
      versions[key] = m.ev["wt:version"] + 1;
      if (m.ev["wt:tick"] > maxTick) maxTick = m.ev["wt:tick"];
    }
    const events = mapped.map((m) => m.ev);
    const sig = events.map((e) => [e.eventID, e["wt:hu_id"], e["wt:tick"], e.bizStep, e.disposition, e.type, e.action].join("|")).join("\n");
    const hash = ("00000000" + fnv1a32(sig).toString(16)).slice(-8);
    const source = { kind: "epcis-2.0-document", document_id: typeof input.id === "string" ? input.id : null, schemaVersion: input.schemaVersion == null ? null : String(input.schemaVersion),
      creationDate: typeof input.creationDate === "string" ? input.creationDate : null, document_events: list.length, mapped_events: events.length,
      units: Object.keys(versions).length, earliest: events[0].eventTime, latest: events[events.length - 1].eventTime, ignored_fields: Object.keys(ignored).sort() };
    const run = { id: "EPCIS-" + hash, scenario: "epcis-import", seed: 0, hash: hash, ticks: maxTick, minutes_per_tick: 1 };
    const doc = makeDocument(run, events);
    doc.honesty = IMPORT_HONESTY;
    doc.run.source = source;
    doc.run.sync = syncContract({ mode: "manual file import (an EPCIS 2.0 capture document)", budgetMinutes: opts && opts.budgetMinutes }); // v3.64
    return { ok: true, errors: [], doc: doc, summary: Object.assign({ run_id: run.id, ticks: maxTick }, source) };
  }
  const isEpcis = (obj) => !!obj && typeof obj === "object" && EPCIS_TYPES.indexOf(obj.type || obj["@type"] || obj.isA) >= 0;

  /* ---------------- v3.64 the synchronisation contract (ISO 23247-1; the deep dive's gap 9) ---- */
  // ISO 23247-1 defines a digital twin as a representation WITH SYNCHRONISATION between the observable
  // element and the representation. Until v3.58 there was nothing to be stale against - a simulation is
  // never late for itself - so the app had no contract to state. An imported record has one, and it is
  // the four things the standard and the deep dive name: in which DIRECTION data flows, HOW it is
  // refreshed, HOW STALE it may be before the record says so, and WHICH SIDE WINS on a conflict.
  // freshness() measures a document against that contract. Pure: the caller passes the instant to
  // measure from (the app passes the browser's clock, a harness a fixed instant), so this module still
  // has no Date of its own.
  const SYNC_DEFAULTS = { budgetMinutes: 1440, direction: "physical-to-digital", mode: "manual file import",
    conflict: "the record wins; this app never writes to the plant", refreshedBy: "a person importing a document" };
  const SYNC_HONESTY =
    "A synchronisation contract in the sense of ISO 23247-1, DECLARED - not negotiated with any plant and not a " +
    "conformance claim: the data flows one way, a person carries it (a file, not a stream), the record may be as old " +
    "as the budget says before it is called stale, and on a conflict the record wins because this app never writes to " +
    "a plant. A stale record is not an error: it is the app saying it does not know what has happened since. The " +
    "budget is a declared teaching default until a plant sets its own.";
  function syncContract(opts) {
    const o = opts || {};
    const b = Number(o.budgetMinutes);
    return { kind: "wt-sync-contract/v1", direction: SYNC_DEFAULTS.direction,
      mode: o.mode ? String(o.mode) : SYNC_DEFAULTS.mode,
      budget_minutes: isFinite(b) && b > 0 ? Math.round(b) : SYNC_DEFAULTS.budgetMinutes,
      conflict: SYNC_DEFAULTS.conflict,
      refreshed_by: o.refreshedBy ? String(o.refreshedBy) : SYNC_DEFAULTS.refreshedBy,
      honesty: SYNC_HONESTY };
  }
  const asMs = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" ? parseIsoMs(v) : null);
  // How fresh is a record against its contract, as of an instant the caller names?
  //   { recorded, events, recorded_events, contract, budget_minutes, newest, oldest, span_minutes,
  //     as_of, age_minutes, stale, per_step: [{ biz_step, events, newest, age_minutes, stale }] }
  // A derived twin carries no wall clock at all: `recorded` is false and the reason says so. Without an
  // `asOf` the ages are null - the record's own span is still reported.
  function freshness(doc, opts) {
    const o = opts || {};
    const events = (doc && doc.events) || [];
    const contract = (doc && doc.run && doc.run.sync) || null;
    const budget = o.budgetMinutes != null && Number(o.budgetMinutes) > 0 ? Math.round(Number(o.budgetMinutes))
      : contract && contract.budget_minutes > 0 ? contract.budget_minutes : SYNC_DEFAULTS.budgetMinutes;
    const stamped = [];
    for (const e of events) { const ms = typeof e.eventTime === "string" ? parseIsoMs(e.eventTime) : null; if (ms != null) stamped.push({ ms: ms, at: e.eventTime, step: e.bizStep }); }
    const out = { recorded: stamped.length > 0, events: events.length, recorded_events: stamped.length, contract: contract,
      budget_minutes: budget, newest: null, oldest: null, span_minutes: null, as_of: null, age_minutes: null, stale: null, per_step: [] };
    if (!out.recorded) { out.reason = "no event carries a wall clock: a derived twin of a simulation has nothing to be stale against"; return out; }
    let lo = stamped[0], hi = stamped[0];
    const byStep = {};
    for (const s of stamped) {
      if (s.ms < lo.ms) lo = s;
      if (s.ms > hi.ms) hi = s;
      const b = byStep[s.step] || (byStep[s.step] = { events: 0, ms: s.ms, at: s.at });
      b.events++;
      if (s.ms > b.ms) { b.ms = s.ms; b.at = s.at; }
    }
    out.newest = hi.at; out.oldest = lo.at; out.span_minutes = r2((hi.ms - lo.ms) / 60000);
    const nowMs = asMs(o.asOf);
    if (nowMs != null) {
      out.as_of = typeof o.asOf === "string" ? o.asOf : nowMs;
      out.age_minutes = r2((nowMs - hi.ms) / 60000);
      out.stale = out.age_minutes > budget;
    }
    out.per_step = Object.keys(byStep).sort().map((k) => {
      const b = byStep[k], age = nowMs == null ? null : r2((nowMs - b.ms) / 60000);
      return { biz_step: k, events: b.events, newest: b.at, age_minutes: age, stale: age == null ? null : age > budget };
    });
    return out;
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
      let imported = null;
      if (isEpcis(obj)) { // v3.58 the return path: a recorded document lands beside the derived runs
        imported = fromEpcis(obj);
        if (!imported.ok) return Promise.reject(new Error("refused: " + imported.errors.join("; ")));
      }
      const docs = imported ? [imported.doc] : obj && obj.schema === STORE_SCHEMA && Array.isArray(obj.runs) ? obj.runs : obj && obj.schema === SCHEMA ? [obj] : null;
      if (!docs) return Promise.reject(new Error("refused: not a " + SCHEMA + ", " + STORE_SCHEMA + " or EPCIS 2.0 (EPCISDocument) document"));
      for (const d of docs) { const v = validate(d); if (!v.ok) return Promise.reject(new Error("refused: " + v.errors.join("; "))); }
      let p = Promise.resolve(), events = 0;
      for (const d of docs) p = p.then(() => store.putRun(d)).then((r) => { events += r.events; });
      return p.then(() => (imported ? { runs: docs.length, events: events, imported: imported.summary } : { runs: docs.length, events: events }));
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
    ERROR_DISPOSITION, VERIFY_OPS, // v3.54
    ssccUrn, sgtinPattern, sglnUrn, glnFor, twin, fromLedger, create, observe, exportJson,
    historyOf, dwellByBizStep, dispositionCounts, gaps, validate, openStore, deleteStore,
    EPCIS_TYPES, CBV_BIZ_STEPS, CBV_DISPOSITIONS, CBV_BTT, IMPORT_HONESTY, IMPORT_SOURCE, cbvId, daysFromCivil, parseIsoMs, fnv1a32, fromEpcis, isEpcis, // v3.58 the return path
    SYNC_DEFAULTS, SYNC_HONESTY, syncContract, freshness }; // v3.64 the synchronisation contract
})();
