/* =====================================================================
 * Logistics Flow Studio - verify_tracking.js
 * v3.53 THE TRACKING DATABASE - headless verification
 * ---------------------------------------------------------------------
 * Every handling event the run ledger writes has exactly one EPCIS-shaped
 * twin (tracking.js), derived from the ledger and never recorded twice. On
 * the hand-built floor of verify_ledger.js (seed 31, 600 ticks, the full
 * order mix) it must prove:
 *   1. THE MAPPING: one twin per handling event with unique ids and no gap;
 *      the first event of every unit an ADD at receiving or picking; the
 *      terminals mapped as the table (shipping / in_transit, stocking /
 *      sellable_accessible, destroying / non_sellable_other as a DELETE);
 *      depalletise an AggregationEvent DELETE whose child list is exactly
 *      the cases on the pallet as GTIN-14, pack an ADD of eaches as GTIN-13
 *      under the parcel SSCC, palletise an ADD of cases; a return entering
 *      as `returned` with an `rma` transaction, everything else `in_progress`
 *      with a `po`; a queued event an OBSERVE that keeps the disposition.
 *   2. THE VOCABULARY: every emitted business step and disposition is in the
 *      module's CBV 2.0 list AND named in the deep dive; the EPC URIs by hand;
 *      read-point GLNs valid and one-to-one with the elements; the op table's
 *      stages equal routing.js's.
 *   3. THE THREE QUESTIONS: dwell per business step equals the ledger's own
 *      spans; a unit's history is its ledger walk; dispositions sum up.
 *   4. THE STORE (memory backend under node): round-trip, replacement,
 *      eviction at maxRuns, history by unit and by order reference across
 *      runs, an import that refuses an unknown business step, an export that
 *      round-trips; a byte-identical document over two identical runs with
 *      no wall clock.
 *   5. PURITY: the observer never mutates the ledger or the sim; a run with
 *      the tracker attached is byte-identical to one without.
 *   6. fromLedger(export) equals the incremental observer, event for event.
 *   7. HUMAN + NO CLOCK: no worker / roster reference, no Date / Math.random;
 *      HONESTY names step-not-person, BetrVG and GDPR, and "not conformant".
 *   8. SHIPPED WIRING: index.html + run-ledger.html load tracking.js after
 *      ledger.js; sw.js precaches it at wt-v139; run-all lists this file; the
 *      app's after-tick multiplexer, the save / export buttons, the joined
 *      scene snapshot, the assistant's text; the viewer section; the fresh
 *      committed fixture; the Python twin's table, views and reconcile key.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "ledger.js", "tracking.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack, T = global.WT.tracking;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
    { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 },
    { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 },
    { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
    { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 },
    { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
const TICKS = 600;
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });
function record(withTracking) {
  const mix = R.defaultMix();
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: mix, layout: FLOOR, profile: P.PROFILES.ecommerce });
  const track = withTracking ? T.create(rec) : null;
  st.hooks = { afterTick: (s) => { L.observe(rec, s); if (track) T.observe(track, rec); } };
  F.step(st, TICKS);
  return { st: st, rec: rec, track: track, exp: L.exportJson(rec) };
}
const A = record(true);
const exp = A.exp, doc = T.exportJson(A.track);
const hus = {};
for (const h of exp.hus) hus[h.id] = h;
const byHu = {};
for (const ev of doc.events) (byHu[ev["wt:hu_id"]] = byHu[ev["wt:hu_id"]] || []).push(ev);
const ledgerByHu = {};
for (const e of exp.events) (ledgerByHu[e.hu_id] = ledgerByHu[e.hu_id] || []).push(e);
const first = (id) => byHu[id][0];
const last = (id) => byHu[id][byHu[id].length - 1];

/* ---- 1. the mapping ------------------------------------------------------ */
(function () {
  const ids = {};
  let dup = 0;
  for (const ev of doc.events) { if (ids[ev.eventID]) dup++; ids[ev.eventID] = 1; }
  check("1a. one twin per handling event (" + doc.events.length + " of " + exp.events.length + "), ids unique, no gap",
    doc.events.length === exp.events.length && exp.events.length > 100 && dup === 0 && T.gaps(exp, doc) === 0 &&
    exp.events.every((e, i) => doc.events[i].eventID === "urn:wt:evt:" + e.id && doc.events[i]["wt:version"] === e.version && doc.events[i]["wt:tick"] === e.tick));
  const firsts = exp.hus.map((h) => first(h.id));
  check("1b. the first event of every unit is an ObjectEvent ADD at receiving or picking; in_progress, a return `returned`",
    firsts.every((ev) => ev.type === "ObjectEvent" && ev.action === "ADD" && (ev.bizStep === "receiving" || ev.bizStep === "picking") &&
      ev.disposition === (hus[ev["wt:hu_id"]].archetype === "returns" ? "returned" : "in_progress")) &&
    firsts.some((ev) => ev.bizStep === "picking") && firsts.some((ev) => ev.bizStep === "receiving"));
  const retired = exp.hus.filter((h) => h.retired_tick != null);
  const want = { delivered: ["shipping", "in_transit", "OBSERVE"], restocked: ["stocking", "sellable_accessible", "OBSERVE"], scrapped: ["destroying", "non_sellable_other", "DELETE"] };
  const kinds = {};
  for (const h of retired) kinds[h.final_kind] = 1;
  check("1c. the terminals map as the table: " + Object.keys(want).join(" / ") + " (" + retired.length + " retired, all three kinds seen)",
    retired.every((h) => { const ev = last(h.id), w = want[h.final_kind]; return ev["wt:kind"] === h.final_kind && ev.bizStep === w[0] && ev.disposition === w[1] && ev.action === w[2]; }) &&
    Object.keys(want).every((k) => kinds[k]));
  const loadArrivals = doc.events.filter((ev) => ev["wt:op"] === "load" && ev["wt:kind"] === "passed");
  const scrapArrivals = doc.events.filter((ev) => ev["wt:op"] === "scrap" && ev["wt:kind"] === "passed");
  check("1d. the arrival at `load` is loading / in_progress; the arrival at `scrap` is holding / non_sellable_other",
    loadArrivals.length > 0 && loadArrivals.every((ev) => ev.bizStep === "loading" && ev.disposition === "in_progress" && ev.action === "OBSERVE") &&
    scrapArrivals.length > 0 && scrapArrivals.every((ev) => ev.bizStep === "holding" && ev.disposition === "non_sellable_other"));
  const dep = doc.events.filter((ev) => ev["wt:op"] === "depalletise" && ev["wt:kind"] !== "queued");
  const depOk = dep.every((ev) => {
    const h = hus[ev["wt:hu_id"]], e = exp.events.find((x) => "urn:wt:evt:" + x.id === ev.eventID);
    return ev.type === "AggregationEvent" && ev.action === "DELETE" && ev.bizStep === "unpacking" && ev.parentID === T.ssccUrn(h.sscc) && h.sscc.charAt(0) === "3" &&
      ev.childQuantityList.length === 1 && ev.childQuantityList[0].quantity === e.cases && e.cases === h.cases_per_pallet && ev.childQuantityList[0].epcClass === T.sgtinPattern(h.gtin14) && ev.childQuantityList[0].uom === "EA" && !ev.epcList;
  });
  check("1e. depalletise is an AggregationEvent DELETE (unpacking) under the pallet SSCC with exactly cases_per_pallet x GTIN-14 (" + dep.length + " events)", dep.length > 5 && depOk);
  const packs = doc.events.filter((ev) => ev["wt:op"] === "pack" && ev["wt:kind"] === "served");
  const packOk = packs.every((ev) => {
    const h = hus[ev["wt:hu_id"]], e = exp.events.find((x) => "urn:wt:evt:" + x.id === ev.eventID);
    return ev.type === "AggregationEvent" && ev.action === "ADD" && ev.bizStep === "packing" && ev.parentID === T.ssccUrn(I.sscc(0, h.seq)) &&
      ev.childQuantityList[0].quantity === e.eaches && ev.childQuantityList[0].epcClass === T.sgtinPattern(h.gtin13);
  });
  const pals = doc.events.filter((ev) => ev["wt:op"] === "palletise" && ev["wt:kind"] === "passed");
  const palOk = pals.every((ev) => { const h = hus[ev["wt:hu_id"]], e = exp.events.find((x) => "urn:wt:evt:" + x.id === ev.eventID);
    return ev.type === "AggregationEvent" && ev.action === "ADD" && ev.parentID === T.ssccUrn(I.sscc(3, h.seq)) && ev.childQuantityList[0].quantity === e.cases && ev.childQuantityList[0].epcClass === T.sgtinPattern(h.gtin14); });
  check("1f. pack is an AggregationEvent ADD (packing) of eaches x GTIN-13 under the parcel SSCC (extension 0); palletise an ADD of cases x GTIN-14 under the pallet SSCC (" + packs.length + " / " + pals.length + ")",
    packs.length > 0 && packOk && pals.length > 0 && palOk);
  check("1g. a return enters `returned` with an `rma` transaction, everything else `in_progress` with a `po`; every transaction names the unit's order",
    exp.hus.every((h) => { const ev = first(h.id), bt = ev.bizTransactionList[0]; return bt.bizTransaction === h.order_id && bt.type === (h.archetype === "returns" ? "rma" : "po"); }) &&
    exp.hus.some((h) => h.archetype === "returns"));
  const queued = doc.events.filter((ev) => ev["wt:kind"] === "queued");
  check("1h. a queued event is an ObjectEvent OBSERVE at the op's step that keeps the previous disposition (" + queued.length + " waits)",
    queued.length > 10 && queued.every((ev) => { const prev = byHu[ev["wt:hu_id"]][ev["wt:version"] - 1];
      return ev.type === "ObjectEvent" && ev.action === "OBSERVE" && ev.bizStep === T.OPS[ev["wt:op"]].step && prev && ev.disposition === prev.disposition; }));
  check("1i. every event carries the unit's SSCC as an EPC URI (or the aggregation parent), a quantity in eaches, eventTime null, tick and minute",
    doc.events.every((ev) => ev.eventTime === null && typeof ev["wt:tick"] === "number" && typeof ev["wt:minute"] === "number" &&
      (ev.type === "AggregationEvent" ? typeof ev.parentID === "string" && Array.isArray(ev.childQuantityList) : ev.epcList.length === 1 && ev.epcList[0] === T.ssccUrn(hus[ev["wt:hu_id"]].sscc) && ev.quantityList[0].uom === "EA")));
})();

/* ---- 2. the vocabulary --------------------------------------------------- */
(function () {
  const dd = read(path.join("docs", "DIGITAL_TWIN_DEEP_DIVE.md"));
  const steps = {}, disps = {};
  for (const ev of doc.events) { steps[ev.bizStep] = 1; disps[ev.disposition] = 1; }
  const outside = Object.keys(steps).filter((s) => T.BIZ_STEPS.indexOf(s) < 0).concat(Object.keys(disps).filter((d) => T.DISPOSITIONS.indexOf(d) < 0));
  const unnamed = Object.keys(steps).concat(Object.keys(disps)).filter((k) => dd.indexOf("`" + k + "`") < 0);
  check("2a. every emitted business step (" + Object.keys(steps).length + ") and disposition (" + Object.keys(disps).length + ") is in the module's CBV 2.0 list and named in the deep dive",
    outside.length === 0 && unnamed.length === 0 && Object.keys(steps).length >= 11, (outside.length ? "outside: " + outside.join(",") : "") + (unnamed.length ? " unnamed: " + unnamed.join(",") : ""));
  check("2b. the EPC URIs by hand: SSCC, GTIN-13 and GTIN-14 class patterns, GLN",
    T.ssccUrn("340123450000000017") === "urn:epc:id:sscc:4012345.3000000001" && T.ssccUrn("040123450000000031") === "urn:epc:id:sscc:4012345.0000000003" &&
    T.sgtinPattern("4012345019179") === "urn:epc:idpat:sgtin:4012345.001917.*" && T.sgtinPattern("14012345019176") === "urn:epc:idpat:sgtin:4012345.101917.*" &&
    T.sglnUrn("4012345313895") === "urn:epc:id:sgln:4012345.31389.0");
  const elements = FLOOR.elements.map((e) => e.id);
  const glns = elements.map((id) => T.glnFor(id));
  const urns = {};
  for (const ev of doc.events) if (ev.readPoint.id) urns[ev.readPoint["wt:element"]] = ev.readPoint.id;
  check("2c. read-point GLNs are valid GS1 numbers, one per element, distinct across the floor's " + elements.length + " elements; every read point names an element or a zone",
    glns.every((g) => I.isValidGs1(g) && g.length === 13) && new Set(glns).size === elements.length &&
    Object.keys(urns).every((el) => urns[el] === T.sglnUrn(T.glnFor(el)) && elements.indexOf(el) >= 0) &&
    doc.events.every((ev) => (ev.readPoint.id && ev.readPoint["wt:element"]) || (ev.readPoint.id === null && ev.readPoint["wt:zone"])));
  const ops = Object.keys(R.OPERATIONS);
  check("2d. every routing operation has a row in the op table with routing's own stage; the two v3.54 detection steps map to inspecting",
    ops.every((op) => T.OPS[op] && T.OPS[op].stage === R.OPERATIONS[op].stage && T.BIZ_STEPS.indexOf(T.OPS[op].step) >= 0) &&
    T.OPS["verify-pick"].step === "inspecting" && T.OPS["verify-put"].step === "inspecting" && Object.keys(T.OPS).length === ops.length + (R.OPERATIONS["verify-pick"] ? 0 : 2));
  check("2e. the document names its vocabulary source, the notes for queued / inspecting / repackaging / holding / aggregation, and the run",
    /CBV\) 2\.0/.test(doc.vocabulary.source) && doc.vocabulary.bizSteps.length === T.BIZ_STEPS.length && ["queued", "inspecting", "repackaging", "holding", "aggregation"].every((k) => typeof doc.notes[k] === "string") &&
    doc.run.id === exp.run.id && doc.run.ticks === TICKS && doc.run.minutes_per_tick === exp.run.minutes_per_tick && doc.schema === "factory-tracking-events/v1");
})();

/* ---- 3. the three questions ---------------------------------------------- */
(function () {
  const spans = L.spans(exp);
  const dwell = T.dwellByBizStep(doc.events);
  const byStep = {};
  for (const d of dwell) byStep[d.biz_step] = d;
  const stepOf = (s) => { const ev = byHu[s.hu_id][s.version]; return ev.bizStep; };
  const agg = {};
  for (const s of spans) { const k = stepOf(s); const a = agg[k] || (agg[k] = { n: 0, ticks: 0, waiting: 0, max: null }); a.n++; a.ticks += s.ticks; if (s.state === "waiting") a.waiting += s.ticks; a.max = a.max == null ? s.ticks : Math.max(a.max, s.ticks); }
  const same = Object.keys(agg).every((k) => byStep[k] && byStep[k].spans === agg[k].n && byStep[k].total_ticks === agg[k].ticks && byStep[k].waiting_ticks === agg[k].waiting && byStep[k].max_ticks_to_next === agg[k].max &&
    byStep[k].avg_ticks_to_next === Math.round((agg[k].ticks / agg[k].n) * 100) / 100 && byStep[k].waiting_share === (agg[k].ticks > 0 ? Math.round((agg[k].waiting / agg[k].ticks) * 10000) / 10000 : null));
  check("3a. dwell per business step equals the ledger's own spans (spans, total, waiting, max, mean and waiting share, step by step; " + spans.length + " spans over " + dwell.length + " steps)",
    same && dwell.reduce((a, d) => a + d.total_ticks, 0) === spans.reduce((a, s) => a + s.ticks, 0) && dwell.reduce((a, d) => a + d.spans, 0) === spans.length);
  check("3b. the storing step carries the put-away wait of the hand floor (waiting share above 0.5), the terminal steps have no span",
    byStep.storing && byStep.storing.waiting_share > 0.5 && byStep.shipping.spans === 0 && byStep.shipping.avg_ticks_to_next === null && byStep.shipping.waiting_share === null);
  const h = exp.hus.find((x) => x.archetype === "piece-pick" && x.retired_tick != null);
  const hist = T.historyOf(doc.events, h.id);
  check("3c. a unit's history is its ledger walk: versions 0..n-1, the same operations and ticks, ending in_transit",
    hist.length === ledgerByHu[h.id].length && hist.every((ev, i) => ev["wt:version"] === i && ev["wt:op"] === ledgerByHu[h.id][i].op && ev["wt:tick"] === ledgerByHu[h.id][i].tick) && hist[hist.length - 1].disposition === "in_transit");
  const dc = T.dispositionCounts(doc.events);
  check("3d. disposition counts sum to the events, name the three terminal dispositions and the returned entry",
    dc.reduce((a, r) => a + r.events, 0) === doc.events.length && dc.some((r) => r.disposition === "in_transit" && r.biz_step === "shipping") && dc.some((r) => r.disposition === "sellable_accessible") &&
    dc.some((r) => r.disposition === "non_sellable_other" && r.biz_step === "destroying") && dc.some((r) => r.disposition === "returned" && r.biz_step === "receiving") &&
    dc.every((r, i) => i === 0 || r.biz_step + " " + r.disposition > dc[i - 1].biz_step + " " + dc[i - 1].disposition));
})();

/* ---- 4. the store + byte identity ---------------------------------------- */
const docB = T.fromLedger(JSON.parse(read(path.join("test", "fixtures", "run-ledger-b.json"))));
const docC = T.fromLedger(JSON.parse(read(path.join("test", "fixtures", "run-ledger-c.json"))));
const docD = T.fromLedger(JSON.parse(read(path.join("test", "fixtures", "run-ledger-d.json"))));
async function storeChecks() {
  const store = await T.openStore({ name: "wt-tracking-verify", maxRuns: 2 });
  check("4a. under node the store falls back to memory with a reason, the same API", store.backend === "memory" && /IndexedDB/.test(store.reason) && ["putRun", "runs", "getRun", "deleteRun", "history", "byOrderRef", "exportJson", "importJson", "size", "close"].every((k) => typeof store[k] === "function"));
  const r1 = await store.putRun(doc);
  const r2 = await store.putRun(docB);
  const r3 = await store.putRun(docC);
  const runs = await store.runs();
  check("4b. three runs into a store of two: the oldest is evicted, the sequence counts on, the ids are kept in stored order",
    r1.evicted.length === 0 && r2.evicted.length === 0 && r3.evicted.length === 1 && r3.evicted[0] === doc.run.id && runs.length === 2 && runs[0].id === docB.run.id && runs[1].id === docC.run.id &&
    runs[0].stored_seq === 2 && runs[1].stored_seq === 3 && runs[1].events_count === docC.events.length, JSON.stringify(r3));
  const back = await store.getRun(docC.run.id);
  check("4c. a stored run comes back byte for byte (events in their original order); an evicted run is gone", JSON.stringify(back) === JSON.stringify(docC) && (await store.getRun(doc.run.id)) === null);
  const again = await store.putRun(docB);
  const size = await store.size();
  check("4d. re-putting a run replaces it (no duplicate events, a new stored sequence)", again.evicted.length === 0 && size.runs === 2 && size.events === docB.events.length + docC.events.length && (await store.runs())[1].id === docB.run.id);
  const hu = docB.events[0]["wt:hu_id"];
  const hist = await store.history(hu);
  check("4e. history by handling unit across the store: one group for run B with the unit's events in order",
    hist.length === 1 && hist[0].run_id === docB.run.id && hist[0].events.length === docB.events.filter((e) => e["wt:hu_id"] === hu).length && hist[0].events.every((e, i) => e["wt:version"] === i));
  await store.putRun(docD);
  const refs = await store.byOrderRef("ORD-0001");
  const wantD = docD.events.filter((e) => e.bizTransactionList.some((b) => b.type === "wt:order_ref" && b.bizTransaction === "ORD-0001")).length;
  check("4f. history by order reference (fixture D, the order file): the run's events for ORD-0001, none from a synthetic run",
    wantD > 0 && refs.length === 1 && refs[0].run_id === docD.run.id && refs[0].events.length === wantD && (await store.byOrderRef("nope")).length === 0);
  let refused = null;
  const bad = JSON.parse(JSON.stringify(docB));
  bad.events[3].bizStep = "waiting";
  try { await store.importJson(bad); } catch (e) { refused = e.message; }
  let refused2 = null;
  try { await store.importJson({ schema: "x" }); } catch (e) { refused2 = e.message; }
  check("4g. importJson refuses an unknown business step and a foreign schema, naming the reason", /unknown business step "waiting"/.test(refused || "") && /not a factory-tracking-events/.test(refused2 || ""));
  const dump = await store.exportJson();
  const store2 = await T.openStore({ name: "wt-tracking-verify-2", maxRuns: 20 });
  const imp = await store2.importJson(dump);
  const dump2 = await store2.exportJson();
  check("4h. the store export round-trips through importJson (schema factory-tracking-store/v1, the same runs and events)",
    dump.schema === "factory-tracking-store/v1" && dump.runs.length === 2 && imp.runs === 2 && imp.events === dump.runs.reduce((a, d) => a + d.events.length, 0) && JSON.stringify(dump2.runs) === JSON.stringify(dump.runs));
  await store.deleteRun(docD.run.id);
  check("4i. deleteRun removes the run and its events", (await store.size()).runs === 1 && (await store.byOrderRef("ORD-0001")).length === 0);
  await store.close(); await store2.close();
}
(function () {
  const B = record(true);
  const a = JSON.stringify(T.exportJson(A.track), null, 1) + "\n", b = JSON.stringify(T.exportJson(B.track), null, 1) + "\n";
  check("4j. two identical runs export byte-identical tracking documents with no wall clock (eventTime null everywhere, no Date in the file)",
    a === b && !/"eventTime": "/.test(a) && (a.match(/"eventTime": null/g) || []).length === doc.events.length && !/new Date\(|Date\.now\(|Math\.random\(/.test(read("tracking.js")));
})();

/* ---- 5. purity ------------------------------------------------------------ */
(function () {
  const plain = record(false);
  check("5a. a run with the tracker attached is byte-identical to one without (sim state and ledger export)",
    snap(plain.st) === snap(A.st) && JSON.stringify(plain.exp) === JSON.stringify(A.exp));
  const before = JSON.stringify(A.rec);
  const t2 = T.create(A.rec);
  T.observe(t2, A.rec); T.observe(t2, A.rec);
  const expBefore = JSON.stringify(exp);
  T.fromLedger(exp);
  check("5b. observe() and fromLedger() never mutate the record or the export; a second observe() adds nothing",
    JSON.stringify(A.rec) === before && JSON.stringify(exp) === expBefore && t2.events.length === doc.events.length && t2.cursor === A.rec.events.length);
})();

/* ---- 6. export == observer ------------------------------------------------ */
(function () {
  const fromExport = T.fromLedger(exp);
  check("6. fromLedger(export) equals the incremental observer event for event (" + fromExport.events.length + " events)", JSON.stringify(fromExport) === JSON.stringify(doc));
})();

/* ---- 7. human + no clock -------------------------------------------------- */
(function () {
  const src = read("tracking.js");
  check("7a. tracking.js references no worker, roster or WT.workers; no Date / Math.random call", !/\bworker\b|\broster\b|WT\.workers/i.test(src.replace(/\/\*[\s\S]*?\*\//, "").replace(/worker roster/g, "")) && !/new Date\(|Date\.now\(|Math\.random\(/.test(src));
  check("7b. HONESTY: EPCIS-shaped not conformant, no wall clock, never a person, BetrVG and GDPR named",
    /not EPCIS-conformant/.test(T.HONESTY) && /no wall clock/.test(T.HONESTY) && /never to a person/.test(T.HONESTY) && /BetrVG/.test(T.HONESTY) && /GDPR/.test(T.HONESTY) && /documentation prefix/.test(T.HONESTY));
})();

/* ---- 8. shipped wiring ---------------------------------------------------- */
(function () {
  const html = read("index.html"), rl = read("run-ledger.html"), sw = read("sw.js"), runall = read("test/run-all.mjs"), app = read("app.js"), sa = read("scene-assistant.js");
  const st = read("selftest.js"), rlst = read("run-ledger-selftest.js"), rljs = read("run-ledger.js"), py = read(path.join("tools", "run_ledger.py")), env = read(path.join("tools", "ledger_env.mjs"));
  const mk = read(path.join("tools", "make_run_ledger_fixture.mjs")), schema = read(path.join("docs", "RUN_LEDGER_SCHEMA.md")), credits = read("CREDITS.md"), changelog = read("CHANGELOG.md");
  check("8a. index.html and run-ledger.html load tracking.js after ledger.js (and before app.js / run-ledger.js)",
    html.indexOf('<script src="tracking.js"></script>') > html.indexOf('<script src="ledger.js"></script>') && html.indexOf('<script src="tracking.js"></script>') < html.indexOf('<script src="app.js"></script>') &&
    rl.indexOf('<script src="tracking.js"></script>') > rl.indexOf('<script src="ledger.js"></script>') && rl.indexOf('<script src="tracking.js"></script>') < rl.indexOf('<script src="run-ledger.js"></script>'));
  check("8b. sw.js precaches ./tracking.js at wt-v139 (trail preserved: previously wt-v138)", /"\.\/tracking\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v139"/.test(sw) && /Previously wt-v138/.test(sw));
  check("8c. test/run-all.mjs lists verify_tracking.js", /verify_tracking\.js/.test(runall));
  check("8d. app.js: the after-tick multiplexer observes the ledger first and then the tracker; the save and export buttons; the store opened by name",
    /afterTick: \(st\) => \{ WT\.ledger\.observe\(state\.flow\.ledger, st\); if \(state\.flow\.track\) WT\.tracking\.observe\(state\.flow\.track, state\.flow\.ledger\);/.test(app) &&
    /WT\.tracking\.create\(state\.flow\.ledger\)/.test(app) && /flowTrackingSave/.test(app) && /flowTrackingExport/.test(app) && /openStore\(\{ name: "wt-tracking-v1", maxRuns: 20 \}\)/.test(app) && /id="flowTrackingSave"/.test(html) && /id="flowTrackingExport"/.test(html));
  check("8e. the scene snapshot joins every package to its handling unit (hu, sscc, order_id, order_ref) and the assistant no longer says the identities are not connected",
    /hu: last \? last\.hu : null/.test(app) && /sscc: hu \? hu\.sscc : null/.test(app) && /order_ref: hu && hu\.order_ref != null/.test(app) && !/not connected yet/.test(sa) && /handling unit/i.test(sa) && /chosen\.hu/.test(sa));
  check("8f. selftest.js has the tracking check; the viewer self-test drives the tracking section and pins the SQL text count (33 at v3.53, one more per later view)",
    /tracking-maps-ledger-and-persists-across-runs/.test(st) && /tracking-section-bizstep-dwell-and-unit-history/.test(rlst) && /"rlTracking"/.test(rlst) && /Object\.keys\(R\.SQL\)\.length === (3[3-9]|[4-9]\d)/.test(rlst));
  check("8g. the viewer: a Tracking section with its nav anchor, renderTracking in load(), biz_step and disposition on the trace, the gaps invariant",
    /id="secTracking"/.test(rl) && /href="#secTracking"/.test(rl) && /id="rlTracking"/.test(rl) && /renderTracking\(exp\)/.test(rljs) && /v_bizstep_dwell/.test(rljs) && /v_unit_history/.test(rljs) && /v_tracking_gaps/.test(rljs) && /v_epcis_events/.test(rljs) && /biz_step/.test(rljs));
  const fixture = lf(read(path.join("test", "fixtures", "run-ledger.tracking.json")));
  const fixViews = lf(read(path.join("test", "fixtures", "run-ledger.tracking.views.json")));
  const expA = JSON.parse(read(path.join("test", "fixtures", "run-ledger.json")));
  const docA = T.fromLedger(expA);
  check("8h. the committed test/fixtures/run-ledger.tracking.json (+ .tracking.views.json) is exactly fromLedger(fixture A) and its dwell / disposition rows",
    fixture === JSON.stringify(docA, null, 1) + "\n" && fixViews === JSON.stringify({ bizstepDwell: T.dwellByBizStep(docA.events), dispositionCounts: T.dispositionCounts(docA.events) }, null, 1) + "\n" &&
    /run-ledger\.tracking\.json|\.tracking\.json/.test(mk) && /tracking\.js/.test(env));
  check("8i. tools/run_ledger.py derives tracking_event at import with the four views in their groups and the reconcile key on biz_step",
    /CREATE TABLE IF NOT EXISTS tracking_event\(/.test(py) && /def track_events\(/.test(py) && /VIEWS\["v_epcis_events"\]/.test(py) && /VIEWS\["v_unit_history"\]/.test(py) && /VIEWS\["v_bizstep_dwell"\]/.test(py) && /VIEWS\["v_tracking_gaps"\]/.test(py) &&
    /"v_bizstep_dwell": \("biz_step",\)/.test(py) && /INVARIANT_VIEWS = \([^)]*"v_tracking_gaps"/.test(py) && /PLANNER_VIEWS = \([^)]*"v_bizstep_dwell"/.test(py) && /v_bizstep_dwell: v\.bizstepDwell/.test(mk));
  check("8j. docs: the schema page names the tracking twins and views; CREDITS names GS1 EPCIS / CBV as vocabulary without conformance; CHANGELOG has v3.53",
    /v_bizstep_dwell/.test(schema) && /factory-tracking-events\/v1/.test(schema) && /EPCIS 2\.0/.test(credits) && /CBV/.test(credits) && /no conformance/i.test(credits) && /## v3\.53/.test(changelog));
})();

storeChecks().then(() => {
  console.log("=".repeat(72));
  console.log(fail === 0 ? "ALL TRACKING CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
  process.exit(fail === 0 ? 0 : 1);
}, (e) => {
  console.log("[FAIL] store checks threw - " + (e && e.stack || e));
  process.exit(1);
});
