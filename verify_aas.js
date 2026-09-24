/* =====================================================================
 * Logistics Flow Studio - verify_aas.js
 * v3.65 ASSET SHELLS, AAS-SHAPED - headless verification
 * ---------------------------------------------------------------------
 * aas.js turns a floor into an AAS-shaped environment (IEC 63278-1's JSON
 * shape): one asset administration shell per element with a Nameplate and a
 * TechnicalData submodel, and an OperationalData submodel for every element a
 * recorded run touched. It must prove:
 *   1. THE SHAPE: the schema, one shell per element, the references resolve,
 *      every Property value is a string, the ids are unique, and validate()
 *      catches a dangling reference, a non-string value and a foreign schema.
 *   2. THE NAMEPLATE by hand on a CNC machining centre: designation, type,
 *      the serial that says it is the layout's own element id, DIN 8580 main
 *      group 3 with its source, the ISA-95 role, and the nine things a
 *      conformant nameplate needs that this app lists as not modelled.
 *   3. TECHNICAL DATA by hand: the mill 3 x 3 m, 2.6 m high, 300 s, one
 *      server; the rack 20 x 1 m, 6 m, 48 pallet positions; the pack station's
 *      equipment class from the rates (0.6 kW, 6000 EUR, 10 years, labour).
 *   4. OPERATIONAL DATA from fixture A: the staging bench's 37 events over 27
 *      units from tick 49 to 300, six completed waits, a mean of 110.33 ticks
 *      - which is the viewer's own v_station_wait rows (122.4 over five
 *      completed put-away spans and 50 over one replenishment) weighted, and
 *      the harness recomputes it; the pack bench's 2.5; an element the run
 *      never touched has no operational submodel at all.
 *   5. HUMAN + PURE: no Date / Math.random / worker; the same layout twice is
 *      byte-identical; nothing is keyed to a person; the honesty says shaped,
 *      not conformant, and that the semantic ids are not the ECLASS IRDIs.
 *   6. THE TOOL: from a run-ledger export alone (12 shells, 35 submodels, the
 *      note that the geometry is the catalogue's), deterministic bytes, the
 *      usage, a refusal.
 *   7. SHIPPED WIRING: the script, the service worker, run-all, the app's
 *      button and handler, README, CHANGELOG, the doc.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js", "aas.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, A = WT.aas, AN = WT.analytics, RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const LAYOUT = { gridW: 40, gridH: 24, cell: 1, elements: [
  { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
  { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
  { id: "mill", type: "cnc-mill", x: 10, y: 10, w: 3, d: 3 },
  { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 }] };
const EXP = JSON.parse(read(path.join("test", "fixtures", "run-ledger.json")));
const RATES = EXP.rates;          // the block the run was recorded under (snake_case, with the class map)
const MEM_RATES = AN.defaultRates();  // the one the Analyze panel holds in memory (camelCase, no class map)
const ENV = A.fromLayout(LAYOUT, { rates: RATES, ledger: EXP, site: "hand-built" });
const smOf = (el, kind) => ENV.submodels.find((s) => s.idShort === kind && s.id.slice(-(el.length + 1)) === ":" + el);
const val = (sm, idShort) => { const e = (sm.submodelElements || []).find((x) => x.idShort === idShort); return e ? e.value : undefined; };
const src = (sm, idShort) => { const e = (sm.submodelElements || []).find((x) => x.idShort === idShort); return e ? e["wt:source"] : undefined; };

/* ---- 1. the shape ---------------------------------------------------------- */
(function () {
  check("1a. the environment: the schema, one shell per element, a Nameplate and a TechnicalData submodel each plus an OperationalData submodel for the three elements this run touched, the scope naming the site, the run and the cell size",
    ENV.schema === "wt-aas-shaped/v1" && ENV.assetAdministrationShells.length === 4 && ENV.submodels.length === 11 && ENV.scope.site === "hand-built" &&
    ENV.scope.run === "RUN-hand-built-s31-hc28a7688" && ENV.scope.with_operational_data === true && ENV.scope.cell_metres === 1 && ENV.scope.elements === 4 &&
    ENV.submodels.filter((s) => s.idShort === "OperationalData").length === 3 && ENV.submodels.filter((s) => s.idShort === "Nameplate").length === 4,
    JSON.stringify(ENV.scope));
  const shell = ENV.assetAdministrationShells.find((s) => s.idShort === "mill");
  check("1b. a shell carries the metamodel's own fields: modelType, an id in the site's scope, assetKind Instance, a globalAssetId that says it is not registered, and one model reference per submodel",
    shell.modelType === "AssetAdministrationShell" && shell.id === "urn:wt:aas:hand-built:mill" && shell.assetInformation.assetKind === "Instance" &&
    shell.assetInformation.globalAssetId === "urn:wt:asset:hand-built:mill" && /not a registered identifier/.test(shell.assetInformation["wt:note"]) &&
    shell.submodels.length === 2 && shell.submodels[0].type === "ModelReference" && shell.submodels[0].keys[0].type === "Submodel");
  let refsOk = true, stringsOk = true;
  const ids = ENV.submodels.map((s) => s.id);
  for (const s of ENV.assetAdministrationShells) for (const r of s.submodels) if (ids.indexOf(r.keys[0].value) < 0) refsOk = false;
  for (const s of ENV.submodels) for (const e of s.submodelElements) if (e.modelType === "Property" && typeof e.value !== "string") stringsOk = false;
  check("1c. every model reference resolves to a submodel that is in the environment, every Property value is a string as the metamodel's JSON requires, and the ids are unique",
    refsOk && stringsOk && new Set(ids).size === ids.length && new Set(ENV.assetAdministrationShells.map((s) => s.id)).size === 4 && A.validate(ENV).ok === true);
  const broken = clone(ENV); broken.assetAdministrationShells[0].submodels[0].keys[0].value = "urn:wt:aas:sm:nope";
  const numeric = clone(ENV); numeric.submodels[1].submodelElements[0].value = 3;
  const noShell = clone(ENV); noShell.assetAdministrationShells = [];
  check("1d. validate() refuses a dangling reference, a numeric Property value, an empty environment and a foreign schema, naming each",
    !A.validate(broken).ok && /resolves to no submodel/.test(A.validate(broken).errors[0]) && !A.validate(numeric).ok && /must be a string/.test(A.validate(numeric).errors[0]) &&
    !A.validate(noShell).ok && /no shell in the environment/.test(A.validate(noShell).errors[0]) && !A.validate({ schema: "x" }).ok && !A.validate(null).ok);
})();

/* ---- 2. the nameplate by hand ---------------------------------------------- */
(function () {
  const np = smOf("mill", "Nameplate");
  const cls = (np.submodelElements || []).find((e) => e.idShort === "ProductClassifications");
  const notModelled = (np.submodelElements || []).find((e) => e.idShort === "wt:NotModelled");
  check("2a. the CNC machining centre's nameplate: the catalogue's designation and type, the serial that says it is the layout's own element id and not a registered one, and the semantic id a urn:wt: placeholder",
    val(np, "ManufacturerProductDesignation") === "CNC machining centre (3-axis)" && val(np, "ManufacturerProductType") === "cnc-mill" && val(np, "SerialNumber") === "mill" &&
    /layout-local, not a registered serial number/.test(src(np, "SerialNumber")) && np.semanticId.keys[0].value === "urn:wt:aas:sm:nameplate" && np.semanticId.type === "ExternalReference" &&
    /not the ECLASS IRDIs a conformant nameplate carries/.test(np["wt:note"]));
  check("2b. the classification is the app's own standard labels: DIN 8580:2022-12, main group 3, Trennen (cutting), with the catalogue's source string and the informed-by note; the ISA-95 role rides beside it",
    !!cls && cls.modelType === "SubmodelElementCollection" && cls.value.length === 3 && cls.value[0].value === "DIN 8580:2022-12" && cls.value[1].value === "main group 3" &&
    cls.value[2].value === "Trennen (cutting)" && /DIN 8580:2022-12/.test(cls.value[0]["wt:source"]) && /informed by, not a certification/.test(cls["wt:note"]) && val(np, "wt:Isa95Role") === "work-cell");
  check("2c. what a conformant nameplate needs and this app does not have is listed, not invented: nine entries beginning with the manufacturer's name and including the year of construction and the markings, with a note saying why",
    !!notModelled && notModelled.value.length === 9 && notModelled.value[0].value === "ManufacturerName" && notModelled.value.some((e) => e.value === "YearOfConstruction") &&
    notModelled.value.some((e) => /Markings/.test(e.value)) && /a layout planner knows the type of a machine, not its manufacturer/.test(notModelled["wt:note"]) && A.NOT_MODELLED.length === 9);
  const dock = smOf("in", "Nameplate");
  check("2d. a type without a DIN 8580 group (a dock, not a manufacturing process) simply has no classification collection - the absence is the honest answer",
    !(dock.submodelElements || []).some((e) => e.idShort === "ProductClassifications") && val(dock, "ManufacturerProductType") === "dock-in" && !!(dock.submodelElements || []).find((e) => e.idShort === "wt:NotModelled"));
})();

/* ---- 3. technical data by hand ---------------------------------------------- */
(function () {
  const mill = smOf("mill", "TechnicalData"), rack = smOf("rack", "TechnicalData"), pk = smOf("pack", "TechnicalData");
  check("3a. the mill: a 3 x 3 m footprint at one metre per cell, 2.6 m high, a 300-second cycle and one server, every value from the catalogue and said to be a teaching value",
    val(mill, "FootprintWidth_m") === "3" && val(mill, "FootprintDepth_m") === "3" && val(mill, "Height_m") === "2.6" && val(mill, "wt:CycleTime_s") === "300" &&
    val(mill, "wt:Servers") === "1" && val(mill, "wt:Category") === "flow" && /teaching value/.test(src(mill, "Height_m")) && mill.semanticId.keys[0].value === "urn:wt:aas:sm:technical-data");
  check("3b. the rack: 20 x 1 m, 6 m high, 48 pallet positions from the declared density and levels; no cycle time and no server, because a rack is not a station",
    val(rack, "FootprintWidth_m") === "20" && val(rack, "FootprintDepth_m") === "1" && val(rack, "Height_m") === "6" && val(rack, "wt:Category") === "storage" &&
    val(rack, "wt:StorageCapacity_pallets") === "48" && String(WT.domain.elementCapacity(LAYOUT.elements[1])) === "48" && val(rack, "wt:CycleTime_s") === undefined && val(rack, "wt:Servers") === undefined &&
    /declared density and levels/.test(src(rack, "wt:StorageCapacity_pallets")));
  check("3c. the pack station carries the rates' equipment class exactly as the cost model reads it: workstation, 0.6 kW, 6000 EUR over 10 years, and it charges labour; the source says illustrative, not a quote; a machine the warehouse rates do not classify carries no equipment block",
    val(pk, "wt:EquipmentClass") === "workstation" && val(pk, "wt:PowerDraw_kW") === "0.6" && val(pk, "wt:PowerDraw_kW") === String(RATES.equipment.workstation.power_kw) && val(pk, "wt:Capex_EUR") === "6000" &&
    val(pk, "wt:AmortisationYears") === "10" && val(pk, "wt:ChargesLabour") === "true" && /not a quote/.test(src(pk, "wt:PowerDraw_kW")) &&
    val(smOf("mill", "TechnicalData"), "wt:EquipmentClass") === undefined, "workstation " + RATES.equipment.workstation.power_kw + " kW / " + RATES.equipment.workstation.capex + " EUR");
  const inMemory = A.fromLayout({ cell: 1, elements: [{ id: "pack", type: "pack-station", w: 3, d: 2 }] }, { rates: MEM_RATES }).submodels.find((s) => s.idShort === "TechnicalData");
  check("3c2. the two rate shapes both read: the run's exported block (snake_case, with the class map) and the Analyze panel's in-memory one (camelCase, no class map) give the same class, power, capex and amortisation - and the in-memory one omits whether the class charges labour, because it does not carry that, rather than guessing",
    val(inMemory, "wt:EquipmentClass") === "workstation" && val(inMemory, "wt:PowerDraw_kW") === "0.6" && val(inMemory, "wt:Capex_EUR") === "6000" && val(inMemory, "wt:AmortisationYears") === "10" &&
    val(inMemory, "wt:ChargesLabour") === undefined && MEM_RATES.equipment.workstation.powerKW === 0.6 && RATES.equipment.workstation.power_kw === 0.6);
  const noRates = A.fromLayout(LAYOUT, { ledger: EXP, site: "hand-built" });
  check("3d. without rates the technical submodel simply omits the equipment block (nothing is invented) and the scope says so",
    noRates.scope.rates === false && val(noRates.submodels.find((s) => s.idShort === "TechnicalData" && /:pack$/.test(s.id)), "wt:EquipmentClass") === undefined &&
    val(noRates.submodels.find((s) => s.idShort === "TechnicalData" && /:pack$/.test(s.id)), "FootprintWidth_m") === "3");
})();

/* ---- 4. operational data from a recorded run -------------------------------- */
(function () {
  const stg = A.seenByElement(EXP).stg, v = RL.views(EXP);
  const rows = v.wait.filter((w) => w.location === "stg");
  const completed = rows.reduce((a, w) => a + (w.waits - w.still_waiting), 0);
  const weighted = Math.round(rows.reduce((a, w) => a + (w.avg_wait_ticks || 0) * (w.waits - w.still_waiting), 0) / completed * 100) / 100;
  const fromLedgerOnly = A.fromLayout({ cell: 1, elements: (EXP.locations || []).filter((l) => WT.domain.ELEMENTS[l.type]).map((l) => ({ id: l.id, type: l.type })) }, { rates: RATES, ledger: EXP, site: "hand-built" });
  const op = fromLedgerOnly.submodels.find((s) => s.idShort === "OperationalData" && /:stg$/.test(s.id));
  check("4a. the staging bench on fixture A: 37 recorded events over 27 units from tick 49 to tick 300, the 50-tick service time the run was recorded under, six waits that completed and a mean of 110.33 ticks",
    stg.events === 37 && stg.units === 27 && stg.first_tick === 49 && stg.last_tick === 300 && stg.service_ticks === 50 && stg.waits === 6 && stg.mean_wait_ticks === 110.33 &&
    val(op, "wt:RecordedEvents") === "37" && val(op, "wt:UnitsSeen") === "27" && val(op, "wt:CompletedWaits") === "6" && val(op, "wt:MeanWait_ticks") === "110.33" && val(op, "wt:Run") === EXP.run.id);
  check("4b. that mean is the viewer's own v_station_wait rows weighted by their completed spans - put-away 122.4 over five and replenishment 50 over one - which is why the label says it is per ELEMENT, not per element and operation",
    completed === 6 && weighted === 110.33 && rows.length === 2 && rows.find((w) => w.op === "putaway").avg_wait_ticks === 122.4 && rows.find((w) => w.op === "replen").avg_wait_ticks === 50 &&
    /not v_station_wait's `waits`/.test(src(op, "wt:CompletedWaits")) && /per element AND operation/.test(src(op, "wt:MeanWait_ticks")), "completed " + completed + " weighted " + weighted);
  const packOp = smOf("pack", "OperationalData");
  check("4c. the pack bench: the same arithmetic gives 2.5 ticks over its two completed waits, and the declared service time is the floor's own 50 ticks",
    val(packOp, "wt:MeanWait_ticks") === "2.5" && val(packOp, "wt:CompletedWaits") === "2" && val(packOp, "wt:DeclaredServiceTime_ticks") === "50" &&
    /the service time the run was recorded under/.test(src(packOp, "wt:DeclaredServiceTime_ticks")) && /a synthetic day unless the events were imported/.test(packOp["wt:note"]));
  check("4d. an element this run never touched (the mill on a warehouse floor) has no operational submodel at all, and a floor exported without a run has none anywhere",
    !smOf("mill", "OperationalData") && ENV.assetAdministrationShells.find((s) => s.idShort === "mill").submodels.length === 2 &&
    (function () { const dry = A.fromLayout(LAYOUT, { rates: RATES, site: "hand-built" });
      return dry.submodels.filter((s) => s.idShort === "OperationalData").length === 0 && dry.scope.with_operational_data === false && dry.scope.run === null && dry.submodels.length === 8; })());
})();

/* ---- 5. human + pure -------------------------------------------------------- */
(function () {
  const src2 = read("aas.js"), code = src2.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const again = A.fromLayout(LAYOUT, { rates: RATES, ledger: EXP, site: "hand-built" });
  const before = JSON.stringify(EXP);
  A.fromLayout(LAYOUT, { rates: RATES, ledger: EXP, site: "hand-built" });
  check("5a. pure and deterministic: the same floor twice is byte-identical, the export is not mutated, and aas.js has no Date, no Math.random and no worker or roster reference",
    JSON.stringify(again) === JSON.stringify(ENV) && JSON.stringify(EXP) === before && !/new Date\(|Date\.now\(|Math\.random\(/.test(src2) && !/\bworker\b|\broster\b|WT\.workers/i.test(code));
  check("5b. the honesty says what this is not: shaped rather than conformant, the semantic ids placeholders instead of ECLASS IRDIs, the asset ids unregistered, what is missing listed rather than invented, and nothing keyed to a person; the standard is named with its edition",
    /AAS-SHAPED, not AAS-conformant/.test(A.HONESTY) && /ECLASS IRDIs/.test(A.HONESTY) && /not registered anywhere/.test(A.HONESTY) && /never invented/.test(A.HONESTY) && /nothing keyed to a person/.test(A.HONESTY) &&
    /IEC 63278-1:2023/.test(A.SHAPED_AFTER.standard) && /shaped, not conformant/.test(A.SHAPED_AFTER.claim) && ENV.honesty === A.HONESTY);
})();

/* ---- 6. the tool ------------------------------------------------------------- */
(function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-aas-"));
  const tool = path.join(__dirname, "tools", "aas_export.mjs");
  const run = (args) => spawnSync(process.execPath, [tool].concat(args), { encoding: "utf8", cwd: __dirname });
  const outA = path.join(tmp, "a.json"), outB = path.join(tmp, "b.json");
  const r1 = run(["--ledger", path.join("test", "fixtures", "run-ledger.json"), "--out", outA]);
  const r2 = run(["--ledger", path.join("test", "fixtures", "run-ledger.json"), "--out", outB]);
  const env = r1.status === 0 ? JSON.parse(fs.readFileSync(outA, "utf8")) : null;
  check("6a. from a run-ledger export alone the tool builds the twelve elements the floor recorded (3 submodels each: the run touched them all), names the site after the run's scenario, and says the geometry is the catalogue's own footprint rather than the floor's",
    r1.status === 0 && !!env && env.scope.elements === 12 && env.scope.submodels === 36 - 1 && env.scope.site === "hand-built" && /the geometry is the catalogue's own footprint/.test(env.scope["wt:from"]) &&
    A.validate(env).ok === true, (r1.stdout || r1.stderr || "").trim());
  check("6b. the tool writes the same bytes twice, exits 2 on the usage and refuses a file that is not a run-ledger export",
    r2.status === 0 && fs.readFileSync(outA, "utf8") === fs.readFileSync(outB, "utf8") && run([]).status === 2 && run(["--ledger", path.join("test", "fixtures", "run-ledger.json")]).status === 2 &&
    run(["--ledger", path.join("test", "fixtures", "epcis-document.json"), "--out", path.join(tmp, "c.json")]).status === 2);
})();

/* ---- 7. shipped wiring -------------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), sw = read("sw.js"), runall = read("test/run-all.mjs"), readme = read("README.md"), changelog = read("CHANGELOG.md");
  check("7a. index.html loads aas.js before app.js; sw.js precaches it at wt-v146 (trail preserved: previously wt-v145); test/run-all.mjs lists this harness",
    html.indexOf('<script src="aas.js"></script>') > 0 && html.indexOf('<script src="aas.js"></script>') < html.indexOf('<script src="app.js"></script>') &&
    /"\.\/aas\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v146"/.test(sw) && /Previously wt-v145/.test(sw) && /verify_aas\.js/.test(runall));
  check("7b. the standards card offers the export and app.js builds it from the live floor with the Analyze panel's rates and the live run when there is one",
    /id="aasExportBtn"/.test(html) && /WT\.aas\.fromLayout\(layout, \{ rates: ensureRates\(\), ledger: ledger, site: currentScenarioId\(\) \}\)/.test(app) && /WT\.aas\.validate\(env\)/.test(app) &&
    /downloadFile\("warehousetwin-asset-shells\.json"/.test(app) && /Shaped, not conformant/.test(app) && /Asset Administration Shell/.test(html) && /ECLASS IRDIs/.test(html));
  check("7c. README and CHANGELOG name v3.65 and docs/AAS_EXPORT.md states the claim and the limit",
    /v3\.65/.test(readme) && /## v3\.65/.test(changelog) && fs.existsSync(path.join(__dirname, "docs", "AAS_EXPORT.md")) &&
    /shaped, not conformant/i.test(read(path.join("docs", "AAS_EXPORT.md"))) && /ECLASS/.test(read(path.join("docs", "AAS_EXPORT.md"))));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL AAS CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
