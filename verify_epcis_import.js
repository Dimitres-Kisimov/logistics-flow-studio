/* =====================================================================
 * Logistics Flow Studio - verify_epcis_import.js
 * v3.58 THE RETURN PATH - headless verification
 * ---------------------------------------------------------------------
 * A recorded EPCIS 2.0 capture document (test/fixtures/epcis-document.json,
 * synthetic, this repository's own) is mapped by tracking.js fromEpcis() onto
 * the shape the derived twins use, lands in the same store and answers the
 * same questions. It must prove:
 *   1. THE MAPPING BY HAND: ten document events become eleven mapped events
 *      (one ObjectEvent names two cases), four objects, 180 minutes; the
 *      time order with document order as the tie-break; ticks and versions;
 *      the derived id for the event without one and the #2 suffix; the three
 *      CBV forms (bare, URN, web URI) normalised and remembered; parents,
 *      children, read points, transactions carried; nothing invented.
 *   2. THE ARITHMETIC: ISO 8601 by hand without Date (the epoch, a leap day,
 *      a negative offset, fraction truncation, the malformed refused).
 *   3. THE THREE QUESTIONS on recorded events: dwell per business step by
 *      hand (minutes), a case's history, the dispositions.
 *   4. REFUSALS that say which: a CBV step this app does not map, a step that
 *      is not CBV at all, a TransformationEvent, no eventTime, not an EPCIS
 *      document, an empty list, no object, a duplicate id, EPCIS 1.x.
 *   5. THE STORE: importJson takes the document, history by object, the
 *      imported run round-trips through export / import, a derived document
 *      is still refused for an unknown step.
 *   6. DETERMINISM + NOTHING IMPORTED, NOTHING CHANGED: the same document
 *      maps to the same bytes; the committed twin fixtures are fresh; the
 *      derived twins of fixture A are byte-identical to their fixture.
 *   7. HUMAN + NO CLOCK + THE PYTHON TWIN: no Date / Math.random, no worker;
 *      the honesty names step-not-person and "nothing is sent back"; the
 *      three CBV lists (41 / 33 / 13) equal in tracking.js and the tool.
 *   8. SHIPPED WIRING: the import button and file input, the app handler,
 *      the self-test, run-all, the docs.
 *   9. THE SYNCHRONISATION CONTRACT (v3.64, ISO 23247-1): every imported
 *      document carries the contract (direction, mode, staleness budget,
 *      who wins), freshness() measures the record against it by hand, a
 *      derived twin has no clock to be stale against, and the Python twin
 *      and the app say the same.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "ledger.js", "tracking.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const T = global.WT.tracking;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const FIX = path.join("test", "fixtures");
const INPUT = JSON.parse(read(path.join(FIX, "epcis-document.json")));
const P = "urn:epc:id:sscc:4012345.3000000001", K = "urn:epc:id:sscc:4012345.0000000003";
const C1 = "urn:epc:id:sgtin:4012345.001917.1001", C2 = "urn:epc:id:sgtin:4012345.001917.1002";
const R = T.fromEpcis(INPUT);
const doc = R.doc, ev = R.doc ? R.doc.events : [];
const byId = (suffix) => ev.find((e) => e.eventID.slice(-suffix.length) === suffix);

/* ---- 1. the mapping by hand ---------------------------------------------- */
(function () {
  check("1a. the fixture maps: 10 document events -> 11 mapped (one ObjectEvent names two cases), 4 objects, 180 minutes, run EPCIS-8fd695d0, scenario epcis-import, minutes_per_tick 1, the ignored fields named",
    R.ok && R.summary.document_events === 10 && R.summary.mapped_events === 11 && R.summary.units === 4 && R.summary.ticks === 180 && doc.run.id === "EPCIS-8fd695d0" && doc.run.scenario === "epcis-import" &&
    doc.run.minutes_per_tick === 1 && doc.run.ticks === 180 && doc.run.seed === 0 && doc.run.hash === "8fd695d0" && JSON.stringify(doc.run.source.ignored_fields) === '["destinationList","example:myField","sourceList"]' &&
    doc.run.source.document_id === "urn:wt:doc:epcis-example-1" && doc.run.source.schemaVersion === "2.0" && doc.run.source.earliest === "2026-09-21T06:00:00Z" && doc.run.source.latest === "2026-09-21T11:00:00+02:00" &&
    doc.schema === T.SCHEMA && doc.honesty === T.IMPORT_HONESTY, R.ok ? JSON.stringify(R.summary) : R.errors.join("; "));
  check("1b. time order with document order as the tie-break: ticks 0,12,40,40,41,50,90,105,125,140,180 (whole minutes from the earliest event; 08:41:20.5 -> 41.341.. -> 41) and versions per object",
    JSON.stringify(ev.map((e) => e["wt:tick"])) === "[0,12,40,40,41,50,90,105,125,140,180]" && JSON.stringify(ev.map((e) => e["wt:version"])) === "[0,1,0,0,1,2,1,0,1,2,3]" &&
    ev[4]["wt:minute"] === 2480500 / 60000 && ev[2]["wt:minute"] === 40 && ev.map((e) => e["wt:hu_id"]).join(" ") === [P, P, C1, C2, C2, C2, C1, K, K, K, K].join(" "));
  check("1c. ids: the event without an eventID gets urn:wt:evt:import-1; the two-case event keeps its id for the first case and #2 for the second; eventTime and its zone offset are kept as the document wrote them (Z form included)",
    ev[0].eventID === "urn:wt:evt:import-1" && byId("000003") && byId("000003#2") && byId("000003#2")["wt:hu_id"] === C2 && byId("000003")["wt:hu_id"] === C1 &&
    ev[0].eventTime === "2026-09-21T06:00:00Z" && ev[0].eventTimeZoneOffset === "+02:00" && ev[0]["wt:document_event"] === 1 && byId("000003#2")["wt:document_event"] === 3);
  check("1d. the three CBV forms normalised and remembered: bare (receiving), URN (urn:epcglobal:cbv:bizstep:storing -> storing), web URI (ref.gs1.org/cbv/BizStep-picking -> picking); the transaction type URN urn:epcglobal:cbv:btt:po -> po",
    ev[0].bizStep === "receiving" && ev[0]["wt:vocabulary"].bizStep === "bare" && byId("000003").bizStep === "storing" && byId("000003").disposition === "sellable_accessible" && byId("000003")["wt:vocabulary"].bizStep === "urn" &&
    byId("000004").bizStep === "picking" && byId("000004").disposition === "in_progress" && byId("000004")["wt:vocabulary"].bizStep === "web" && byId("000004")["wt:vocabulary"].disposition === "web" &&
    byId("000005").bizTransactionList.length === 1 && byId("000005").bizTransactionList[0].type === "po" && ev[0].bizTransactionList[0].type === "po" && ev[0].bizTransactionList[0].bizTransaction === "urn:epcglobal:cbv:bt:4012345000009:PO-1001");
  check("1e. an AggregationEvent is keyed by its parent with the children carried (unpacking: DELETE, two child EPCs, 46 of the class; packing: ADD under the parcel); an ObjectEvent carries its own EPC and an empty quantity list",
    byId("000002").type === "AggregationEvent" && byId("000002").action === "DELETE" && byId("000002").parentID === P && byId("000002").childEPCs.length === 2 && byId("000002").childQuantityList[0].quantity === 46 && byId("000002").childQuantityList[0].uom === "EA" &&
    byId("000005").action === "ADD" && byId("000005").parentID === K && byId("000005").childEPCs[0] === C1 && byId("000005").childQuantityList[0].quantity === 12 &&
    JSON.stringify(ev[0].epcList) === JSON.stringify([P]) && JSON.stringify(ev[0].quantityList) === "[]" && !("parentID" in ev[0]));
  check("1f. read points and locations as given, the shipping event without a business location, no error / delivery facts, wt:kind recorded and wt:source imported on every event, wt:op null",
    ev[0].readPoint.id === "urn:epc:id:sgln:4012345.31389.0" && ev[0].bizLocation.id === "urn:epc:id:sgln:4012345.00001.0" && byId("000007").bizLocation === null && byId("000007").disposition === "in_transit" &&
    ev.every((e) => e["wt:kind"] === "recorded" && e["wt:source"] === "imported" && e["wt:op"] === null && e["wt:error"] === null && e["wt:delivery"] === null && typeof e.readPoint.id === "string"));
})();

/* ---- 2. the arithmetic ---------------------------------------------------- */
(function () {
  check("2a. parseIsoMs by hand without Date: the epoch is 0; 2024-02-29T12:00:00+01:00 is day 19782 x 86400 + 11 h = 1709204400000; the GS1 example time 2005-04-03T20:33:31.116000-06:00 = 1112582011116; a fraction is truncated to the millisecond",
    T.parseIsoMs("1970-01-01T00:00:00Z") === 0 && T.daysFromCivil(2024, 2, 29) === 19782 && T.parseIsoMs("2024-02-29T12:00:00+01:00") === 1709204400000 && T.parseIsoMs("2005-04-03T20:33:31.116000-06:00") === 1112582011116 &&
    T.parseIsoMs("2026-09-21T08:41:20.5005+02:00") - T.parseIsoMs("2026-09-21T08:41:20+02:00") === 500 && T.parseIsoMs("2026-09-21T08:41:20.5+02:00") - T.parseIsoMs("2026-09-21T08:41:20+02:00") === 500);
  check("2b. the malformed are refused: month 13, no zone, a date only, a space instead of T, null", T.parseIsoMs("2026-13-01T00:00:00Z") === null && T.parseIsoMs("2026-09-21T08:00:00") === null && T.parseIsoMs("2026-09-21") === null && T.parseIsoMs("2026-09-21 08:00:00Z") === null && T.parseIsoMs(null) === null);
  check("2c. cbvId: bare / URN / web forms of a mapped step; a CBV step this app does not map is cbv:true; a made-up word is cbv:false; a foreign URI is form other; absent is null; the lists are 41 / 33 / 13",
    JSON.stringify(T.cbvId("receiving", "bizStep")) === '{"id":"receiving","form":"bare","cbv":true}' && T.cbvId("urn:epcglobal:cbv:bizstep:receiving", "bizStep").form === "urn" && T.cbvId("https://ref.gs1.org/cbv/BizStep-receiving", "bizStep").form === "web" &&
    T.cbvId("commissioning", "bizStep").cbv === true && T.cbvId("waiting", "bizStep").cbv === false && T.cbvId("https://example.com/steps/x", "bizStep").form === "other" && T.cbvId(null, "bizStep") === null && T.cbvId("", "disposition") === null &&
    T.CBV_BIZ_STEPS.length === 41 && T.CBV_DISPOSITIONS.length === 33 && T.CBV_BTT.length === 13 && T.BIZ_STEPS.every((s) => T.CBV_BIZ_STEPS.indexOf(s) >= 0) && T.DISPOSITIONS.every((d) => T.CBV_DISPOSITIONS.indexOf(d) >= 0));
})();

/* ---- 3. the three questions on recorded events ---------------------------- */
(function () {
  const dw = T.dwellByBizStep(ev), row = (s) => dw.find((r) => r.biz_step === s);
  check("3a. dwell per business step by hand, in minutes: receiving 12 (the pallet until it is unpacked); storing 2 events / 2 objects / spans 50 and 1 -> avg 25.5, max 50; inspecting 9; packing 20; staging_outbound 15; loading 40; unpacking, picking, destroying, shipping without a next event; no waiting anywhere",
    dw.length === 10 && row("receiving").avg_ticks_to_next === 12 && row("receiving").max_ticks_to_next === 12 && row("storing").events === 2 && row("storing").units === 2 && row("storing").spans === 2 && row("storing").avg_ticks_to_next === 25.5 && row("storing").max_ticks_to_next === 50 &&
    row("inspecting").avg_ticks_to_next === 9 && row("packing").avg_ticks_to_next === 20 && row("staging_outbound").avg_ticks_to_next === 15 && row("loading").avg_ticks_to_next === 40 &&
    ["unpacking", "picking", "destroying", "shipping"].every((s) => row(s).spans === 0 && row(s).avg_ticks_to_next === null) && dw.every((r) => r.waiting_ticks === 0));
  const h = T.historyOf(ev, C2), dc = T.dispositionCounts(ev);
  check("3b. the damaged case's history: stored at 40, found damaged at 41, written off at 50 (an ObjectEvent DELETE at destroying); dispositions: storing / sellable_accessible on 2 objects, inspecting / damaged on 1",
    h.length === 3 && h.map((e) => e.bizStep).join(">") === "storing>inspecting>destroying" && h.map((e) => e["wt:tick"]).join(",") === "40,41,50" && h[2].action === "DELETE" && h[2].disposition === "non_sellable_other" &&
    dc.find((r) => r.biz_step === "storing").units === 2 && dc.find((r) => r.biz_step === "inspecting").disposition === "damaged" && dc.length === 10);
})();

/* ---- 4. refusals that say which ------------------------------------------- */
(function () {
  const mutate = (fn) => { const d = clone(INPUT); fn(d); return T.fromEpcis(d); };
  const r1 = mutate((d) => { d.epcisBody.eventList[1].bizStep = "commissioning"; });
  const r2 = mutate((d) => { d.epcisBody.eventList[2].bizStep = "waiting"; });
  const r3 = mutate((d) => { d.epcisBody.eventList[3].type = "TransformationEvent"; });
  const r4 = mutate((d) => { delete d.epcisBody.eventList[4].eventTime; });
  const r5 = T.fromEpcis({ schema: "factory-tracking-events/v1", events: [] });
  const r6 = mutate((d) => { d.epcisBody.eventList = []; });
  const r7 = mutate((d) => { delete d.epcisBody.eventList[0].epcList; });
  const r8 = mutate((d) => { d.epcisBody.eventList[6].eventID = d.epcisBody.eventList[5].eventID; });
  const r9 = mutate((d) => { d.schemaVersion = "1.2"; });
  const r10 = mutate((d) => { d.epcisBody.eventList[8].disposition = "recalled"; });
  check("4a. a CBV 2.0 step this app does not map is refused naming it and saying so (event 2: commissioning); a step that is not CBV at all likewise (event 3: waiting); both list the known steps",
    !r1.ok && /event 2: business step "commissioning" is CBV 2\.0 but not one this app maps \(known: receiving, /.test(r1.errors[0]) && !r2.ok && /event 3: business step "waiting" is not a CBV 2\.0 business step/.test(r2.errors[0]) &&
    !r10.ok && /event 9: disposition "recalled" is CBV 2\.0 but not one this app maps/.test(r10.errors[0]), r1.errors[0].slice(0, 90));
  check("4b. a TransformationEvent is refused as not mapped; an event without eventTime; a document that is not an EPCISDocument; an empty event list; an event naming no object; a duplicate eventID; EPCIS 1.2",
    !r3.ok && /event 4: TransformationEvent is not mapped \(only ObjectEvent and AggregationEvent are\)/.test(r3.errors[0]) && !r4.ok && /event 5: eventTime null is not an ISO 8601/.test(r4.errors[0]) &&
    !r5.ok && /not an EPCIS 2\.0 capture document \(type null, expected EPCISDocument\)/.test(r5.errors[0]) && !r6.ok && /eventList is empty/.test(r6.errors[0]) && !r7.ok && /event 1: names no object \(no epcList or quantityList\)/.test(r7.errors[0]) &&
    !r8.ok && /event 7: duplicate eventID/.test(r8.errors[0]) && !r9.ok && /schemaVersion "1\.2": only EPCIS 2\.0 JSON is read/.test(r9.errors[0]) && r1.doc === null && r1.summary === null);
  check("4c. a refusal reports up to eight reasons and maps nothing; a document with a class-level ObjectEvent (quantityList only) is keyed by its first class",
    mutate((d) => { d.epcisBody.eventList.forEach((e) => { e.bizStep = "waiting"; }); }).errors.length === 8 &&
    (function () { const r = mutate((d) => { const e = d.epcisBody.eventList[0]; delete e.epcList; e.quantityList = [{ epcClass: "urn:epc:idpat:sgtin:4012345.001917.*", quantity: 48 }]; }); return r.ok && r.doc.events[0]["wt:hu_id"] === "urn:epc:idpat:sgtin:4012345.001917.*" && JSON.stringify(r.doc.events[0].epcList) === "[]" && r.doc.events[0].quantityList[0].uom === "EA"; })());
})();

/* ---- 5. the store ---------------------------------------------------------- */
async function storeChecks() {
  const store = await T.openStore({ name: "wt-epcis-verify", maxRuns: 5 });
  const imp = await store.importJson(clone(INPUT));
  const runs = await store.runs();
  const back = await store.getRun(doc.run.id);
  const hist = await store.history(C2);
  check("5a. importJson takes the EPCIS document: one run of eleven events with the summary; the stored run is the mapped document byte for byte; history by object works on the document's own identifiers",
    imp.runs === 1 && imp.events === 11 && imp.imported && imp.imported.run_id === doc.run.id && imp.imported.document_events === 10 && runs.length === 1 && runs[0].id === doc.run.id &&
    JSON.stringify(back) === JSON.stringify(doc) && hist.length === 1 && hist[0].events.length === 3 && hist[0].events[1].disposition === "damaged", JSON.stringify(imp.imported));
  const dump = await store.exportJson();
  const store2 = await T.openStore({ name: "wt-epcis-verify-2", maxRuns: 5 });
  const imp2 = await store2.importJson(dump);
  const dump2 = await store2.exportJson();
  check("5b. the imported run round-trips through the store export / import (it validates as a factory-tracking-events/v1 document)",
    dump.runs.length === 1 && imp2.runs === 1 && imp2.events === 11 && JSON.stringify(dump2.runs) === JSON.stringify(dump.runs) && T.validate(doc).ok);
  let refused = null, refused2 = null, refused3 = null;
  const badDoc = clone(INPUT); badDoc.epcisBody.eventList[1].bizStep = "commissioning";
  try { await store.importJson(badDoc); } catch (e) { refused = e.message; }
  const derived = T.fromLedger(JSON.parse(read(path.join(FIX, "run-ledger.json"))));
  derived.events[2].bizStep = "waiting";
  try { await store.importJson(derived); } catch (e) { refused2 = e.message; }
  try { await store.importJson({ hello: 1 }); } catch (e) { refused3 = e.message; }
  check("5c. the store refuses the document with the unmapped step naming it, still refuses a derived document with an unknown step, and names the three shapes it takes",
    /refused: event 2: business step "commissioning" is CBV 2\.0 but not one this app maps/.test(refused || "") && /unknown business step "waiting"/.test(refused2 || "") && /or EPCIS 2\.0 \(EPCISDocument\) document/.test(refused3 || "") && (await store.size()).runs === 1);
  await store.close(); await store2.close();
}

/* ---- 6. determinism + nothing imported, nothing changed ------------------ */
(function () {
  const again = T.fromEpcis(JSON.parse(read(path.join(FIX, "epcis-document.json"))));
  const fixture = lf(read(path.join(FIX, "epcis-document.tracking.json"))), fixViews = lf(read(path.join(FIX, "epcis-document.tracking.views.json")));
  check("6a. the same document maps to the same bytes; the committed epcis-document.tracking.json (+ .views.json) is exactly fromEpcis(document) and its dwell / disposition rows (tools/make_epcis_fixture.mjs)",
    JSON.stringify(again.doc) === JSON.stringify(doc) && fixture === JSON.stringify(doc, null, 1) + "\n" && fixViews === JSON.stringify({ bizstepDwell: T.dwellByBizStep(ev), dispositionCounts: T.dispositionCounts(ev) }, null, 1) + "\n");
  const expA = JSON.parse(read(path.join(FIX, "run-ledger.json"))), docA = T.fromLedger(expA);
  check("6b. nothing imported, nothing changed: the derived twins of fixture A are byte-identical to their committed fixture, carry no wt:source and no eventTime, and still validate",
    lf(read(path.join(FIX, "run-ledger.tracking.json"))) === JSON.stringify(docA, null, 1) + "\n" && docA.events.every((e) => !("wt:source" in e) && e.eventTime === null) && T.validate(docA).ok && T.gaps(expA, docA) === 0 && !T.isEpcis(docA) && T.isEpcis(INPUT));
})();

/* ---- 7. human + no clock + the Python twin -------------------------------- */
(function () {
  const src = read("tracking.js"), py = read(path.join("tools", "epcis_import.py")), rl = read(path.join("tools", "run_ledger.py"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("7a. tracking.js still has no Date / Math.random call and no worker / roster reference; IMPORT_HONESTY says never a person (BetrVG, GDPR), nothing is sent back, a shadow only in the manual sense",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/\bworker\b|\broster\b|WT\.workers/i.test(code.replace(/worker roster/g, "")) &&
    /never a person \(BetrVG 87\(1\)6, GDPR Art\. 88\)/.test(T.IMPORT_HONESTY) && /nothing is sent back/.test(T.IMPORT_HONESTY) && /shadow only in the manual sense/.test(T.IMPORT_HONESTY) && /never acts on them/.test(T.IMPORT_HONESTY));
  const listOf = (name) => { const m = new RegExp(name + ' = \\(([\\s\\S]*?)\\)\\n').exec(py); return m ? m[1].match(/"[a-z_]+"/g).map((s) => s.slice(1, -1)) : []; };
  check("7b. tools/epcis_import.py is the twin: the same 41 / 33 / 13 CBV lists, the same honesty sentence, source 'imported', the same tick rule (floor(x + 0.5)), a check / twin / import / dwell / sync CLI",
    JSON.stringify(listOf("CBV_BIZ_STEPS")) === JSON.stringify(T.CBV_BIZ_STEPS) && JSON.stringify(listOf("CBV_DISPOSITIONS")) === JSON.stringify(T.CBV_DISPOSITIONS) && JSON.stringify(listOf("CBV_BTT")) === JSON.stringify(T.CBV_BTT) &&
    /nothing is streamed, nothing is sent back/.test(py) && /IMPORT_SOURCE = "imported"/.test(py) && /\(minutes \+ 0\.5\) \/\/ 1/.test(py) && /choices=\("check", "twin", "import", "dwell", "sync"\)/.test(py) && /def from_epcis\(/.test(py) && /def import_document\(/.test(py));
  check("7c. tools/run_ledger.py: tracking_event carries source (derived | imported), no longer ties hu_id to a ledger unit, rebuilds an older table once, derived rows say 'derived', v_epcis_events joins hu on the left with the source column",
    /source TEXT NOT NULL DEFAULT 'derived' CHECK\(source IN \('derived','imported'\)\)/.test(rl) && /handling_event_id TEXT UNIQUE REFERENCES handling_event\(id\)/.test(rl) && /hu_id TEXT NOT NULL, version INTEGER NOT NULL/.test(rl) &&
    /"source" not in old\[0\]/.test(rl) && /ALTER TABLE tracking_event RENAME TO tracking_event_old/.test(rl) && /"derived"\)  # v3\.58: source/.test(rl) && /t\.error_latent, t\.source\nFROM tracking_event t LEFT JOIN hu h ON h\.id = t\.hu_id;/.test(rl));
})();

/* ---- 8. shipped wiring ---------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), st = read("selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js");
  const readme = read("README.md"), changelog = read("CHANGELOG.md"), credits = read("CREDITS.md"), dd = read(path.join("docs", "DIGITAL_TWIN_DEEP_DIVE.md")), schema = read(path.join("docs", "RUN_LEDGER_SCHEMA.md"));
  check("8a. index.html: the import button and the hidden file input beside the tracking buttons; app.js reads the file, hands it to store.importJson and reports the summary; the store still opens by name",
    /id="flowTrackingImport"/.test(html) && /id="flowTrackingImportInput" type="file"/.test(html) && /on\("flowTrackingImport"/.test(app) && /flowTrackingImportInput/.test(app) && /store\.importJson\(obj\)/.test(app) && /r\.imported/.test(app) && /readAsText\(file\)/.test(app));
  check("8b. selftest.js has the return-path check; test/run-all.mjs lists verify_epcis_import.js; sw.js precaches tracking.js; tools/make_epcis_fixture.mjs and docs/EPCIS_IMPORT.md exist",
    /epcis-import-return-path/.test(st) && /verify_epcis_import\.js/.test(runall) && /"\.\/tracking\.js"/.test(sw) && fs.existsSync(path.join(__dirname, "tools", "make_epcis_fixture.mjs")) && fs.existsSync(path.join(__dirname, "docs", "EPCIS_IMPORT.md")));
  check("8c. docs: README names the return path (v3.58); CHANGELOG has v3.58; CREDITS says GS1's examples were read and none copied and the fixture is synthetic; the deep dive calls it a manual shadow; the schema page names the source column",
    /v3\.58/.test(readme) && /EPCIS 2\.0 import|return path/i.test(readme) && /## v3\.58/.test(changelog) && /none is copied/.test(credits) && /synthetic/.test(credits) && /v3\.58/.test(dd) && /manual/.test(dd) && /source = imported|source TEXT|'imported'/.test(schema) && /epcis_import\.py/.test(schema));
})();

/* ---- 9. the synchronisation contract (v3.64, ISO 23247-1; the deep dive's gap 9) ---- */
(function () {
  const c = doc.run.sync, custom = T.fromEpcis(INPUT, { budgetMinutes: 120 });
  check("9a. every imported document carries the contract the standard asks for: the direction (physical to digital), the mode (a file a person carried), the staleness budget (a day by default, the caller's otherwise) and which side wins on a conflict; the honesty says declared, not negotiated, and that a stale record is not an error",
    !!c && c.kind === "wt-sync-contract/v1" && c.direction === "physical-to-digital" && /manual file import \(an EPCIS 2\.0 capture document\)/.test(c.mode) && c.budget_minutes === 1440 &&
    /the record wins; this app never writes to the plant/.test(c.conflict) && /a person importing a document/.test(c.refreshed_by) && c.honesty === T.SYNC_HONESTY &&
    /ISO 23247-1, DECLARED/.test(T.SYNC_HONESTY) && /A stale record is not an error/.test(T.SYNC_HONESTY) && custom.doc.run.sync.budget_minutes === 120 && T.SYNC_DEFAULTS.budgetMinutes === 1440 &&
    T.syncContract({ budgetMinutes: -5 }).budget_minutes === 1440 && T.syncContract({}).mode === "manual file import");
  const f = T.freshness(doc, { asOf: "2026-09-21T12:00:00+02:00" });
  const step = (s) => f.per_step.find((x) => x.biz_step === s);
  check("9b. freshness by hand on the fixture: 11 recorded events from 06:00Z to 11:00+02:00 - a span of 180 minutes; as of 12:00+02:00 the record is 60 minutes old against a budget of 1440, so fresh; per step receiving 240 minutes, storing 200, picking 150, shipping 60, and the fractional inspecting event 198.66",
    f.recorded === true && f.recorded_events === 11 && f.events === 11 && f.newest === "2026-09-21T11:00:00+02:00" && f.oldest === "2026-09-21T06:00:00Z" && f.span_minutes === 180 &&
    f.as_of === "2026-09-21T12:00:00+02:00" && f.age_minutes === 60 && f.stale === false && f.budget_minutes === 1440 && f.per_step.length === 10 &&
    step("receiving").age_minutes === 240 && step("storing").age_minutes === 200 && step("storing").events === 2 && step("picking").age_minutes === 150 && step("shipping").age_minutes === 60 && step("inspecting").age_minutes === 198.66 &&
    f.per_step.every((s) => s.stale === false), JSON.stringify({ age: f.age_minutes, span: f.span_minutes }));
  const late = T.freshness(doc, { asOf: "2026-09-25T12:00:00+02:00" }), wide = T.freshness(doc, { asOf: "2026-09-25T12:00:00+02:00", budgetMinutes: 10000 });
  const early = T.freshness(doc, { asOf: "2026-09-21T10:00:00+02:00" });
  check("9c. the budget decides: four days later the same record is 5820 minutes old and STALE against the default; with a budget of 10000 minutes it is fresh again; an instant before the newest event gives a negative age and is never stale; the per-step flags follow the same budget",
    late.age_minutes === 5820 && late.stale === true && late.per_step.every((s) => s.stale === true) && wide.age_minutes === 5820 && wide.stale === false && wide.budget_minutes === 10000 &&
    early.age_minutes === -60 && early.stale === false && T.freshness(doc, { asOf: 1758452400000 }).as_of === 1758452400000);
  const derived = T.fromLedger(JSON.parse(read(path.join(FIX, "run-ledger.json"))));
  const df = T.freshness(derived, { asOf: "2026-09-25T12:00:00+02:00" }), noAs = T.freshness(doc, {});
  check("9d. a derived twin has no wall clock to be stale against and says so (157 events, none recorded, stale null); without an instant to measure from the ages are null but the record's own span is still reported; a derived document carries no contract",
    df.recorded === false && df.events === 157 && df.recorded_events === 0 && df.stale === null && df.age_minutes === null && /nothing to be stale against/.test(df.reason) && !derived.run.sync &&
    noAs.as_of === null && noAs.age_minutes === null && noAs.stale === null && noAs.span_minutes === 180 && noAs.per_step.every((s) => s.age_minutes === null && s.stale === null));
  const py = read(path.join("tools", "epcis_import.py")), rl = read(path.join("tools", "run_ledger.py")), app = read("app.js"), st = read("selftest.js");
  check("9e. the Python twin carries the same contract and measures the same way: the 1440-minute default, sync_contract / freshness / measure / render_freshness, the JavaScript rounding rule so both agree to the second decimal, a sync command; the run row keeps the block (run.sync, with a guarded ALTER for an older database)",
    /SYNC_DEFAULTS = \{"budget_minutes": 1440/.test(py) && /def sync_contract\(/.test(py) && /def freshness\(/.test(py) && /def measure\(/.test(py) && /def render_freshness\(/.test(py) &&
    /math\.floor\(v \* 100 \+ 0\.5\) \/ 100/.test(py) && /choices=\("check", "twin", "import", "dwell", "sync"\)/.test(py) && /never writes to the plant/.test(py) &&
    /run\.sync: v3\.64/.test(rl) && /\("run", "sync", "TEXT"\)/.test(rl) && /sync TEXT\);/.test(rl));
  check("9f. the app reports the freshness of an imported record against its contract (the browser's clock, the module's own having none) and the self-test pins it; the readout says the data flows one way",
    /WT\.tracking\.freshness\(mapped\.doc, \{ asOf: Date\.now\(\) \}\)/.test(app) && /const ageText = /.test(app) && /old as of now against a budget of/.test(app) && /never writes to a plant/.test(app) &&
    /WT\.tracking\.freshness\(edoc, \{ asOf: "2026-09-21T10:00:00\+02:00" \}\)/.test(st) && /efr\.age_minutes === 30/.test(st));
})();

storeChecks().then(() => {
  console.log("=".repeat(72));
  console.log(fail === 0 ? "ALL EPCIS-IMPORT CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
  process.exit(fail === 0 ? 0 : 1);
}, (e) => {
  console.log("[FAIL] store checks threw - " + (e && e.stack || e));
  process.exit(1);
});
