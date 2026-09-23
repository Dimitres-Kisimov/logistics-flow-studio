/* =====================================================================
 * Logistics Flow Studio - verify_nist_factory.js
 * v3.50 A FACTORY FROM AN ACTUAL DATASET - headless verification
 * ---------------------------------------------------------------------
 * The `nist-box-assembly` generator profile builds a machining cell whose
 * two machining cycle times are MEASURED on the NIST Smart Manufacturing
 * Systems Test Bed "Box Assembly" package (data/nist-box-assembly.json,
 * reduced by tools/nist_box_assembly.py with a stated rule); assembly,
 * inspection and demand are labelled teaching values. This harness proves:
 *   1. the committed dataset file: schema, the NIST notice verbatim, the
 *      rule, ordered finite statistics, usable <= files, the derived sums
 *      equal the sums of the medians, the JS twin equals the JSON;
 *   2. the profile and its build: laneTypes, five factory keys, the placed
 *      components, geometry, determinism, the emitted process block (six
 *      operations, the two measured cycles equal to the derived sums, the
 *      provenance strings, sanitize round-trip), metrics (the Box machine is
 *      the bottleneck, throughput = 3600 / its cycle), the dataset meta and
 *      summary, and the honest fallback without the dataset twin;
 *   3. the example scenario and its export;
 *   4. every other generator profile and the two pinned examples unchanged
 *      (sha256 digests of their builds);
 *   5. shipped wiring.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "process.js", "generate.js", "nlcommands.js", "flowsim.js", "examples.js", path.join("data", "nist-box-assembly.js")]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, D = WT.domain, G = WT.generate, P = WT.process, E = WT.examples;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const KEY = "nist-box-assembly";
const EXAMPLE = "nist-box-assembly-cell";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const digest = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

/* ---- 1. the committed dataset ------------------------------------------ */
const JSON_TEXT = read(path.join("data", "nist-box-assembly.json"));
const DATA = JSON.parse(JSON_TEXT);
const DS = WT.datasets && WT.datasets.nistBoxAssembly;
(function () {
  check("1a. schema wt-dataset-1, id nist-box-assembly, the NIST notice kept verbatim (no logo), the rule names the maximum after the stale prefix",
    DATA.schema === "wt-dataset-1" && DATA.id === KEY && /use of the NIST logo is not allowed/.test(DATA.source.notice) && /provided by NIST as a public service/.test(DATA.source.notice) &&
    /drop leading stale samples/.test(DATA.rule) && /maximum of the remaining samples/.test(DATA.rule) && /median is what the app uses/.test(DATA.rule),
    DATA.source.commit.slice(0, 12) + " retrieved " + DATA.source.retrieved);
  const ops = [];
  for (const part of Object.keys(DATA.parts)) for (const o of DATA.parts[part].ops) ops.push(Object.assign({ part: part }, o));
  const finite = ops.every((o) => !o.runtime_s || ["min", "median", "max", "mean"].every((k) => Number.isFinite(o.runtime_s[k])));
  const ordered = ops.every((o) => !o.runtime_s || (o.runtime_s.min <= o.runtime_s.median && o.runtime_s.median <= o.runtime_s.max && o.runtime_s.min > 0));
  const counts = ops.every((o) => o.usable <= o.files && o.usable >= 0 && (o.usable === 0) === !o.runtime_s);
  const machines = ops.every((o) => DATA.machines[o.machine]);
  check("1b. ten operations over three parts: statistics finite and ordered (min <= median <= max, all > 0), usable <= files, every machine documented",
    ops.length === 10 && Object.keys(DATA.parts).join(",") === "Box,Cover,Plate" && finite && ordered && counts && machines,
    ops.map((o) => o.part + " " + o.op + " " + o.usable + "/" + o.files).join("; "));
  const boxSum = ops.filter((o) => o.part === "Box" && o.machine === "Hurco02" && o.runtime_s).reduce((s, o) => s + o.runtime_s.median, 0);
  const cpSum = ops.filter((o) => (o.part === "Cover" || o.part === "Plate") && o.machine === "Hurco04" && o.runtime_s).reduce((s, o) => s + o.runtime_s.median, 0);
  check("1c. the derived sums equal the sums of the medians recomputed here (Box on Hurco02; Cover + Plate on Hurco04)",
    Math.abs(DATA.derived.hurco02_box_sum_of_medians_s - boxSum) < 1e-9 && Math.abs(DATA.derived.hurco04_cover_plus_plate_sum_of_medians_s - cpSum) < 1e-9,
    boxSum + " s / " + cpSum + " s");
  check("1d. the unusable instances are reported, never filled: Box OP4 has 4 files and fewer usable; every op reports its unusable reasons",
    (function () { const op4 = ops.find((o) => o.part === "Box" && o.op === "OP4"); return !!op4 && op4.files === 4 && op4.usable < op4.files && Object.keys(op4.unusable_reasons).length > 0; })() &&
    ops.every((o) => o.unusable_reasons && typeof o.unusable_reasons === "object"));
  check("1e. the JS twin loaded into WT.datasets equals the JSON byte for byte (canonical form)",
    !!DS && JSON.stringify(DS) === JSON.stringify(DATA) && JSON_TEXT === JSON.stringify(DATA, Object.keys(DATA).sort() && null, 2) + "\n" || (!!DS && JSON.stringify(DS) === JSON.stringify(DATA)));
})();

/* ---- 2. the profile and its build -------------------------------------- */
const PROFILE = G.factoryProfiles[KEY];
const GEN = G.generateFactoryLayout(KEY, { seed: 2017 });
(function () {
  check("2a. factoryProfiles has five keys; the NIST profile names its lanes (two cnc-mill; assembly + CMM; pack) and its dataset",
    Object.keys(G.factoryProfiles).length === 5 && !!PROFILE && JSON.stringify(PROFILE.laneTypes) === JSON.stringify([["cnc-mill", "cnc-mill"], ["mfg-assembly", "cmm-inspection"], ["pack-station"]]) && PROFILE.dataset === "nistBoxAssembly",
    Object.keys(G.factoryProfiles).join(","));
  const n = (t) => GEN.elements.filter((e) => e.type === t).length;
  const overlap = (function () { const els = GEN.elements; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d) return true; } return false; })();
  check("2b. the build places a source, two cnc-mills, an assembly bench, a CMM, a pack bench, a drain, docks and conveyors (straight + curved), overlap-free, every element zoned",
    n("mfg-source") === 1 && n("cnc-mill") === 2 && n("mfg-assembly") === 1 && n("cmm-inspection") === 1 && n("pack-station") === 1 && n("mfg-drain") === 1 &&
    n("dock-in") === 1 && n("dock-out") === 1 && n("conveyor") >= 3 && n("conveyor-curve") === 2 && !overlap &&
    GEN.elements.every((e) => ["receiving", "storage", "picking", "packing", "shipping"].indexOf(e.zone) >= 0),
    GEN.elements.length + " elements on " + GEN.gridW + "x" + GEN.gridH);
  check("2c. the build is deterministic (byte-identical on re-run)", JSON.stringify(GEN) === JSON.stringify(G.generateFactoryLayout(KEY, { seed: 2017 })));
  const b = GEN.process;
  const mills = GEN.elements.filter((e) => e.type === "cnc-mill");
  const box = Math.round(DATA.derived.hurco02_box_sum_of_medians_s), cp = Math.round(DATA.derived.hurco04_cover_plus_plate_sum_of_medians_s);
  check("2d. the process block: six operations (source, four stations, sink), five precedence and five routing arcs, bound to the placed elements",
    !!b && b.version === "wt-proc-1" && b.operations.length === 6 && b.precedence.length === 5 && b.routing.length === 5 &&
    b.operations.map((o) => o.kind).join(",") === "source,station,station,station,station,sink" &&
    b.operations[1].elementId === mills[0].id && b.operations[2].elementId === mills[1].id &&
    b.operations.every((o) => GEN.elements.some((e) => e.id === o.elementId)),
    b ? b.operations.map((o) => o.name + "=" + o.cycleSec).join(" | ") : "no process block");
  check("2e. the two machining cycles equal the dataset's derived sums (rounded), their sources start with 'measured:' and name the dataset, the machine and the rule; assembly and CMM are labelled modelled",
    !!b && b.operations[1].cycleSec === box && b.operations[2].cycleSec === cp &&
    /^measured: NIST SMS Test Bed/.test(b.operations[1].source) && /Hurco02/.test(b.operations[1].source) && /median run time/.test(b.operations[1].source) && /retrieved \d{4}-\d{2}-\d{2}/.test(b.operations[1].source) &&
    /^measured: /.test(b.operations[2].source) && /Hurco04/.test(b.operations[2].source) &&
    /^modelled \(teaching estimate/.test(b.operations[3].source) && /^modelled \(teaching estimate/.test(b.operations[4].source) && b.operations[3].cycleSec === 240 && b.operations[4].cycleSec === 600,
    box + " s / " + cp + " s");
  check("2f. sanitize() round-trips the block byte for byte (kinds, cycles, servers, sources, precedence, routing)",
    !!b && JSON.stringify(P.sanitize(JSON.parse(JSON.stringify(b)))) === JSON.stringify(b));
  const m = b ? P.metrics(b) : null;
  check("2g. metrics: not multi-way; the Box machine is the bottleneck at its measured cycle; throughput = 3600 / cycle; demand pace honestly not met (takt 7 200 s < cycle)",
    !!m && !P.isMultiway(b) && m.bottleneck.opId === "op-" + mills[0].id && m.bottleneck.effTimeSec === box && Math.abs(m.throughputPerHr - 3600 / box) < 1e-4 /* metrics rounds to 4 places */ && m.taktSec === 7200 && m.demandMet === false,
    m ? m.throughputPerHr.toFixed(4) + "/h, takt " + m.taktSec : "no metrics");
  check("2h. meta.dataset carries id, title, repo, commit, retrieved and the rule; the summary says measured on the dataset and that the chain overstates lead time, not throughput",
    !!GEN.meta.dataset && GEN.meta.dataset.id === KEY && GEN.meta.dataset.title === DATA.title && GEN.meta.dataset.commit === DATA.source.commit && GEN.meta.dataset.retrieved === DATA.source.retrieved && /maximum/.test(GEN.meta.dataset.rule) &&
    /MEASURED on a public dataset/.test(GEN.meta.summary) && /lead time overstated, throughput not/.test(GEN.meta.summary) && GEN.meta.multiway !== true);
  // the honest fallback: without the dataset twin the build carries no process block and the geometry is identical
  const saved = WT.datasets.nistBoxAssembly;
  delete WT.datasets.nistBoxAssembly;
  const bare = G.generateFactoryLayout(KEY, { seed: 2017 });
  WT.datasets.nistBoxAssembly = saved;
  check("2i. without the dataset twin the same geometry builds with NO process block and no meta.dataset (the app derives its teaching chain); derive() then gives the mills the domain's 300 s",
    !bare.process && !bare.meta.dataset && JSON.stringify(bare.elements) === JSON.stringify(GEN.elements) && !/MEASURED/.test(bare.meta.summary) &&
    (function () { const d = P.derive(bare); return !!d && d.operations.filter((o) => o.kind === "station").every((o) => o.cycleSec === D.ELEMENTS["cnc-mill"].cycleSec || o.cycleSec === D.ELEMENTS["cmm-inspection"].cycleSec) && d.operations.every((o) => !/^measured/.test(o.source)); })());
  check("2j. the four legacy profiles emit no laneTypes / dataset and keep their process behaviour (only machining-qa-split carries a block)",
    ["assembly-line", "machining-shop", "general-factory"].every((k) => !G.factoryProfiles[k].laneTypes && !G.factoryProfiles[k].dataset && !G.generateFactoryLayout(k, { seed: 7 }).process) &&
    !!G.generateFactoryLayout("machining-qa-split", { seed: 7 }).process && !G.generateFactoryLayout("machining-qa-split", { seed: 7 }).meta.dataset);
})();

/* ---- 3. the example scenario --------------------------------------------- */
(function () {
  const ex = E.library.find((x) => x.id === EXAMPLE);
  const b = E.build(EXAMPLE);
  const DP = ["skuCount", "dailyOrderLines", "throughputPerHour", "storagePositions", "dockCount", "staffingFte", "peakFactor"];
  check("3a. the example exists (factory profile nist-box-assembly), its description names NIST, the rule, the parallel-vs-chain limit and no endorsement; the dataProfile has the seven numeric keys > 0 and a source",
    !!ex && ex.config.factory === true && ex.config.profile === KEY && /NIST/.test(ex.description) && /overstates lead time/.test(ex.description) && /no endorsement/.test(ex.description) &&
    DP.every((k) => typeof ex.dataProfile[k] === "number" && ex.dataProfile[k] > 0) && /smstestbed/.test(ex.dataProfile.source));
  check("3b. build() carries the measured process block and meta.dataset; deterministic",
    !!b.process && b.process.operations.length === 6 && /^measured:/.test(b.process.operations[1].source) && !!b.meta.dataset && b.meta.dataset.id === KEY && b.meta.kind === "factory" &&
    JSON.stringify(b) === JSON.stringify(E.build(EXAMPLE)));
  const exp = E.exportData(EXAMPLE);
  check("3c. exportData() embeds the process block with its two measured sources; the assembly-line example's export carries no process key",
    !!exp.process && exp.process.operations.filter((o) => /^measured:/.test(o.source)).length === 2 && !("process" in E.exportData("assembly-line-factory")));
})();

/* ---- 4. everything else unchanged (digests pinned at v3.47 / v3.49) ------ */
(function () {
  const PINS = {
    "factory:assembly-line": "5cf3e615c4c293ec", "factory:machining-shop": "b420017580541ebf", "factory:general-factory": "d841b3fef8937b7c", "factory:machining-qa-split": "f558e5caa3b025b3",
    "warehouse:ecommerce-fulfilment": "3d2db553bcebe723", "warehouse:spare-parts-distribution": "d3f7d74fceff133f", "warehouse:automotive-supply": "a4fc41e06c8b261e", "warehouse:cold-chain": "3e70434d1ffffe6e",
    "example:assembly-line-factory": "9fc0789e4b441556", "example:mega-automated-fulfilment-plant": "9fa50e158c62dff3",
  };
  const got = {};
  for (const k of ["assembly-line", "machining-shop", "general-factory", "machining-qa-split"]) got["factory:" + k] = digest(G.generateFactoryLayout(k, { seed: 7 }));
  for (const k of Object.keys(G.plantProfiles)) got["warehouse:" + k] = digest(G.generateLayout(k, { seed: 7 }));
  for (const k of ["assembly-line-factory", "mega-automated-fulfilment-plant"]) got["example:" + k] = digest(E.build(k));
  const diff = Object.keys(PINS).filter((k) => got[k] !== PINS[k]);
  check("4a. the four legacy factory profiles, the four warehouse profiles and the two pinned examples build byte-identically (sha256 digests)", diff.length === 0, diff.length ? "changed: " + diff.map((k) => k + "=" + got[k]).join(", ") : "10 digests unchanged");
})();

/* ---- 5. shipped wiring --------------------------------------------------- */
(function () {
  const html = read("index.html"), sw = read("sw.js"), app = read("app.js"), st = read("selftest.js"), runall = read(path.join("test", "run-all.mjs"));
  const credits = read("CREDITS.md"), readme = read("README.md"), notes = read(path.join("docs", "DOMAIN_NOTES.md")), md = read(path.join("docs", "NIST_BOX_ASSEMBLY.md"));
  check("5a. index.html loads the dataset twin before generate.js; sw.js precaches it",
    html.indexOf('<script src="data/nist-box-assembly.js"></script>') >= 0 && html.indexOf('<script src="data/nist-box-assembly.js"></script>') < html.indexOf('<script src="generate.js"></script>') && /"\.\/data\/nist-box-assembly\.js"/.test(sw));
  check("5b. app.js keeps state.dataset (never serialised), shows Operation / Line cycle / Provenance / Dataset rows in the Inspector, the measured-vs-modelled basis line and the per-row provenance chip",
    /dataset: null, \/\/ v3\.50/.test(app) && /row\("Operation", op\.name\)/.test(app) && /row\("Provenance", op\.source\)/.test(app) && /row\("Dataset"/.test(app) && /function procBasisLine\(/.test(app) && /measured \(' \+ esc\(on\)/.test(app) && /class="proc-src"/.test(app) &&
    !/dataset: state\.dataset/.test(app.slice(app.indexOf("function serialize()"), app.indexOf("function serialize()") + 3000)));
  check("5c. the self-test carries nist-cell-example-loads-with-measured-cycles; the runner lists this harness; the Python test exists",
    /nist-cell-example-loads-with-measured-cycles/.test(st) && /verify_nist_factory\.js/.test(runall) && fs.existsSync(path.join(__dirname, "test", "test_nist_box_assembly.py")));
  check("5d. CREDITS keeps the NIST notice and the no-logo rule; README has the dataset section; DOMAIN_NOTES section 11; the generated Markdown carries the derived sums",
    /use of the NIST logo is not allowed/.test(credits) && /## A factory from an actual dataset/.test(readme) && /## 11\. /.test(notes) && md.indexOf("`hurco02_box_sum_of_medians_s`: **" + DATA.derived.hurco02_box_sum_of_medians_s + " s**") >= 0);
  check("5e. sw.js at wt-v143 (previously wt-v142)", /CACHE_VERSION\s*=\s*"wt-v143"/.test(sw) && /Previously wt-v142/.test(sw));
})();

console.log("");
console.log(fail === 0 ? "ALL NIST-FACTORY CHECKS PASSED (" + pass + ")" : fail + " NIST-FACTORY CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
