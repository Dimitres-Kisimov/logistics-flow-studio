/* =====================================================================
 * Logistics Flow Studio - verify_fit_rates.js
 * v3.59 THE PLANT'S OWN RATES - headless verification
 * ---------------------------------------------------------------------
 * tools/fit_rates.py fits a site profile from recorded events and a
 * trailer log; the knowledge base loads it as an overlay with measured
 * labels; the what-ifs read it. On the hand-designed fixture it must prove:
 *   1. THE FIT BY HAND: 50 picking events with 2 mis-picks -> 0.04; 20
 *      put-aways with 1 wrong slot -> 0.05; 10 + 10 unpacking / packing
 *      with 1 damage -> 0.05; each with its n, numerator and label
 *      "measured on <document>, n = ..."; the step table; the trailer log's
 *      nearest-rank quantiles -30 / -30 / 0 / 45 / 90 and shares .5 / .3 / .2.
 *   2. REFUSALS + NOT FITTED: a derived-only database is refused (exit 2,
 *      the reason names the twins); a record without picking events leaves
 *      hf.error.mis-pick unfitted with the reason; `check` rejects a label
 *      that does not start with "measured on".
 *   3. DETERMINISM: the committed test/fixtures/site-profile.json is the
 *      tool's output byte for byte.
 *   4. THE KNOWLEDGE BASE: applyProfile (and importJson routing the schema)
 *      sets the values and stamps the labels; a value out of range, a
 *      non-fittable id and a bad label are skipped with the reason;
 *      reset(id) / reset() restore the teaching values and drop the stamps;
 *      the stamps survive export -> import; profile() reports the source.
 *   5. THE WHAT-IFS: windowLateness on the site quantiles starts at the
 *      minimum and stays within [min, max]; app.js reads delivery.site.*
 *      when n > 0 and the error levers read the knowledge base.
 *   6. HUMAN: aggregates only - the tool has no per-person key, the
 *      honesty names BetrVG / GDPR, the fixture says SYNTHETIC.
 *   7. SHIPPED WIRING: the card's badge and label, the hint, the self-test,
 *      run-all, sw.js at wt-v140, README, CHANGELOG, docs/SITE_PROFILE.md.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "knowledge.js", "iso.js", "shapes.js", "routing.js", "flowsim.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const KB = global.WT.kb, F = global.WT.flowsim;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const PY = process.env.PYTHON || "python";
const FIX = path.join(__dirname, "test", "fixtures");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-fit-"));
const tool = path.join(__dirname, "tools", "fit_rates.py");
const run = (args) => spawnSync(PY, [tool].concat(args), { encoding: "utf8", cwd: __dirname });
const out1 = path.join(tmp, "profile.json");
const r1 = run(["fit", "--document", path.join(FIX, "fit-rates.events.json"), "--deliveries", path.join(FIX, "fit-rates.deliveries.csv"), "--site", "example plant", "--out", out1]);
const prof = r1.status === 0 ? JSON.parse(fs.readFileSync(out1, "utf8")) : null;
const v = (id) => (prof && prof.values[id]) || {};

/* ---- 1. the fit by hand ------------------------------------------------- */
(function () {
  check("1a. the tool runs on the hand-designed record and the trailer log: 100 events, 40 objects, 9 values fitted, none unfitted, the schema and the tool named",
    r1.status === 0 && !!prof && prof.schema === "wt-site-profile/v1" && prof.site === "example plant" && prof.fitted_from.events === 100 && prof.fitted_from.objects === 40 &&
    Object.keys(prof.values).length === 9 && Object.keys(prof.not_fitted).length === 0 && /fit_rates\.py \(v3\.59\)/.test(prof.tool), (r1.stdout || r1.stderr || "").trim().split("\n").pop());
  check("1b. the three error shares by hand: mis-pick 2 of 50 picking events = 0.04; wrong put-away 1 of 20 storing events = 0.05; damage 1 of 20 unpacking + packing events = 0.05 - each with n, numerator, disposition, steps",
    v("hf.error.mis-pick").value === 0.04 && v("hf.error.mis-pick").n === 50 && v("hf.error.mis-pick").numerator === 2 && v("hf.error.mis-pick").disposition === "mismatch_class" && JSON.stringify(v("hf.error.mis-pick").steps) === '["picking"]' &&
    v("hf.error.wrong-putaway").value === 0.05 && v("hf.error.wrong-putaway").n === 20 && v("hf.error.wrong-putaway").numerator === 1 &&
    v("hf.error.damage").value === 0.05 && v("hf.error.damage").n === 20 && v("hf.error.damage").numerator === 1 && JSON.stringify(v("hf.error.damage").steps) === '["unpacking","packing"]');
  check("1c. every label starts with 'measured on <source>, n = ...' and names the tool; the error labels name the events and the disposition",
    Object.keys(prof.values).every((id) => /^measured on .+, n = \d+ /.test(prof.values[id].label) && /tools\/fit_rates\.py \(v3\.59\)/.test(prof.values[id].label)) &&
    v("hf.error.mis-pick").label === "measured on urn:wt:doc:fit-rates-example-1, n = 50 picking events (2 mismatch_class); tools/fit_rates.py (v3.59)" &&
    /^measured on fit-rates\.deliveries\.csv, n = 10 trailers/.test(v("delivery.site.latenessP90").label));
  const step = (s) => prof.steps.find((x) => x.biz_step === s);
  check("1d. the step table: picking 50 events over 20 objects with 2 error dispositions (share 0.04); storing 20 events all not in_progress (sellable_*) with 1 error; unpacking 10 with 1 damaged; the dispositions counted; sorted by step",
    prof.steps.map((s) => s.biz_step).join(",") === "packing,picking,receiving,storing,unpacking" && step("picking").events === 50 && step("picking").objects === 20 && step("picking").errors === 2 && step("picking").error_share === 0.04 &&
    step("storing").non_in_progress === 20 && step("storing").non_in_progress_share === 1 && step("storing").errors === 1 && step("storing").error_share === 0.05 && step("storing").dispositions.sellable_not_accessible === 1 && step("storing").dispositions.sellable_accessible === 19 &&
    step("unpacking").errors === 1 && step("unpacking").dispositions.damaged === 1 && step("packing").errors === 0 && step("receiving").non_in_progress === 0);
  check("1e. the trailer log by hand: ten trailers late by -30,-10,-5,0,0,5,10,20,45,90 -> nearest rank min -30, p10 -30 (rank ceil(1) = 1), median 0 (rank 5), p90 45 (rank 9), max 90; late 5 / early 3 / on time 2; delivery.site.n 10",
    prof.deliveries && prof.deliveries.n === 10 && JSON.stringify(prof.deliveries.lateness_minutes) === '{"latenessMin":-30,"latenessP10":-30,"latenessMedian":0,"latenessP90":45,"latenessMax":90}' &&
    prof.deliveries.share_late === 0.5 && prof.deliveries.share_early === 0.3 && prof.deliveries.share_on_time === 0.2 && prof.deliveries.source === "fit-rates.deliveries.csv" &&
    v("delivery.site.n").value === 10 && v("delivery.site.latenessMin").value === -30 && v("delivery.site.latenessP10").value === -30 && v("delivery.site.latenessMedian").value === 0 && v("delivery.site.latenessP90").value === 45 && v("delivery.site.latenessMax").value === 90);
})();

/* ---- 2. refusals + not fitted ------------------------------------------- */
(function () {
  const dbf = path.join(tmp, "derived.sqlite");
  const imp = spawnSync(PY, [path.join(__dirname, "tools", "run_ledger.py"), "import", path.join(FIX, "run-ledger.json"), "--database", dbf], { encoding: "utf8", cwd: __dirname });
  const r2 = run(["fit", "--database", dbf, "--out", path.join(tmp, "x.json")]);
  check("2a. a database with only the simulation's own twins is refused (exit 2) and the reason counts the derived twins", imp.status === 0 && r2.status === 2 && /refused: no imported events in the database \(157 derived twins present - a fit on the simulation's own twins is refused\)/.test(r2.stdout), (r2.stdout || "").trim());
  const doc = JSON.parse(read(path.join("test", "fixtures", "fit-rates.events.json")));
  doc.epcisBody.eventList = doc.epcisBody.eventList.filter((e) => e.bizStep !== "picking");
  const noPick = path.join(tmp, "no-picking.json");
  fs.writeFileSync(noPick, JSON.stringify(doc));
  const r3 = run(["fit", "--document", noPick, "--out", path.join(tmp, "np.json")]);
  const np = r3.status === 0 ? JSON.parse(fs.readFileSync(path.join(tmp, "np.json"), "utf8")) : null;
  check("2b. a record without picking events leaves hf.error.mis-pick unfitted with the reason (the teaching value stays) while the two others are fitted; no deliveries block without a log",
    r3.status === 0 && np && !("hf.error.mis-pick" in np.values) && /no picking events in the record - the teaching value stays/.test(np.not_fitted["hf.error.mis-pick"]) && np.values["hf.error.wrong-putaway"].value === 0.05 && np.values["hf.error.damage"].value === 0.05 && np.deliveries === null && np.fitted_from.events === 50);
  const bad = JSON.parse(JSON.stringify(prof));
  bad.values["hf.error.mis-pick"].label = "teaching value";
  const badf = path.join(tmp, "bad.json");
  fs.writeFileSync(badf, JSON.stringify(bad));
  const r4 = run(["check", badf]), r5 = run(["check", out1]);
  check("2c. `check` accepts the profile (exit 0, every value with its label) and rejects a label that does not start with 'measured on' (exit 1)",
    r5.status === 0 && /hf\.error\.mis-pick = 0\.04  \(measured on /.test(r5.stdout) && r4.status === 1 && /hf\.error\.mis-pick: the label must start with 'measured on '/.test(r4.stdout));
  const csvBad = path.join(tmp, "bad.csv");
  fs.writeFileSync(csvBad, "trailer,scheduled,arrived\nT-1,2026-09-22 07:00,2026-09-22T07:10:00+02:00\n");
  const r6 = run(["fit", "--document", path.join(FIX, "fit-rates.events.json"), "--deliveries", csvBad, "--out", path.join(tmp, "y.json")]);
  check("2d. a trailer log line without a zoned ISO time is refused naming the line", r6.status === 2 && /refused: trailer log: line 2: scheduled \/ arrived must be ISO 8601 with a zone/.test(r6.stdout));
})();

/* ---- 3. determinism ------------------------------------------------------- */
(function () {
  const committed = lf(read(path.join("test", "fixtures", "site-profile.json")));
  const again = run(["fit", "--document", path.join(FIX, "fit-rates.events.json"), "--deliveries", path.join(FIX, "fit-rates.deliveries.csv"), "--site", "example plant", "--out", path.join(tmp, "again.json")]);
  check("3a. the committed test/fixtures/site-profile.json is the tool's output byte for byte, and a second run writes the same bytes",
    again.status === 0 && committed === lf(fs.readFileSync(out1, "utf8")) && committed === lf(fs.readFileSync(path.join(tmp, "again.json"), "utf8")) && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(JSON.stringify(prof.values)));
})();

/* ---- 4. the knowledge base ------------------------------------------------ */
(function () {
  const dflt = KB.get("hf.error.mis-pick");
  const r = KB.applyProfile(prof);
  const e = KB.entry("hf.error.mis-pick"), n = KB.entry("delivery.site.n");
  check("4a. applyProfile sets the nine values and stamps them measured with the label and the site; the teaching default was 0.02; profile() names the site and the count",
    r.ok && r.measured === 9 && r.skipped.length === 0 && dflt === 0.02 && KB.get("hf.error.mis-pick") === 0.04 && KB.get("hf.error.damage") === 0.05 && KB.get("delivery.site.n") === 10 && KB.get("delivery.site.latenessMin") === -30 && KB.get("delivery.site.latenessMax") === 90 &&
    e.measured && e.measured.label === v("hf.error.mis-pick").label && e.measured.n === 50 && e.measured.source === "example plant" && n.measured && n.measured.n === 10 && KB.profile().site === "example plant" && KB.profile().measured === 9 && typeof e.source === "string" && e.source !== e.measured.label);
  check("4b. an unmeasured entry serialises exactly as before (no measured key); list() carries the stamp only on the fitted entries", !("measured" in KB.entry("hf.error.cap")) && !("measured" in KB.entry("delivery.otif.target")) && KB.list("human-factors").filter((x) => x.measured).length === 3 && KB.list("delivery").filter((x) => x.measured).length === 6);
  const snap = KB.exportJson();
  KB.reset();
  const gone = KB.entry("hf.error.mis-pick");
  check("4c. reset() restores the teaching values, drops the stamps and forgets the profile", !gone.measured && KB.get("hf.error.mis-pick") === 0.02 && KB.get("delivery.site.n") === 0 && KB.profile() === null);
  const imp = KB.importJson(snap);
  check("4d. the stamps and the applied profile survive export -> import of the whole knowledge base (the round trip is byte-identical); a measured value equal to the teaching default (the site median 0) keeps its stamp too",
    imp.ok && KB.entry("hf.error.mis-pick").measured && KB.entry("hf.error.mis-pick").measured.label === v("hf.error.mis-pick").label && KB.exportJson() === snap && KB.profile() && KB.profile().site === "example plant" && KB.entry("delivery.site.latenessMedian").measured && KB.get("delivery.site.latenessMedian") === 0);
  KB.reset("hf.error.mis-pick");
  check("4e. reset(id) restores one teaching value and drops its stamp while the others stay measured", KB.get("hf.error.mis-pick") === 0.02 && !KB.entry("hf.error.mis-pick").measured && KB.entry("hf.error.damage").measured && KB.get("hf.error.damage") === 0.05);
  KB.reset();
  const skewed = { schema: "wt-site-profile/v1", site: "s", values: {
    "hf.error.mis-pick": { value: 0.9, n: 10, label: "measured on s, n = 10 picking events" },
    "hf.psf.timePressure": { value: 3, n: 10, label: "measured on s, n = 10" },
    "hf.error.damage": { value: 0.01, n: 10, label: "teaching value" },
    "hf.error.wrong-putaway": { value: 0.02, n: 0, label: "measured on s, n = 0 storing events" },
    "delivery.site.n": { value: 4, n: 4, label: "measured on s, n = 4 trailers" } } };
  const rs = KB.applyProfile(skewed);
  check("4f. a value above the entry's range, a non-fittable id (a multiplier), a label without 'measured on' and n = 0 are skipped with the reason; the one good value is applied; ok is false",
    !rs.ok && rs.measured === 1 && rs.skipped.length === 4 && /hf\.error\.mis-pick: value 0\.9 rejected \(value must be <= 0\.5\)/.test(rs.skipped[0]) && /hf\.psf\.timePressure: not a fittable entry/.test(rs.skipped[1]) &&
    /hf\.error\.damage: needs a numeric value, n >= 1 and a label starting with 'measured on'/.test(rs.skipped[2]) && /hf\.error\.wrong-putaway: needs/.test(rs.skipped[3]) && KB.get("delivery.site.n") === 4 && KB.get("hf.error.mis-pick") === 0.02, JSON.stringify(rs.skipped));
  KB.reset();
  const viaImport = KB.importJson(JSON.stringify(prof));
  check("4g. importJson routes a wt-site-profile/v1 document to applyProfile as an overlay (custom rules and other edits untouched) and refuses a foreign object",
    viaImport.ok && viaImport.measured === 9 && KB.get("hf.error.mis-pick") === 0.04 && !KB.applyProfile({ schema: "x" }).ok && /not a wt-site-profile\/v1 document/.test(KB.applyProfile({ schema: "x" }).error));
  KB.reset();
})();

/* ---- 5. the what-ifs ------------------------------------------------------ */
(function () {
  const late = F.windowLateness({ min: -30, p10: -30, median: 0, p90: 45, max: 90 }, 1, 16);
  const app = read("app.js");
  check("5a. windowLateness on the site quantiles at scale 1: the first Weyl point (u = 0) is the minimum -30, every value within [-30, 90], sixteen ticks, integers",
    late.length === 16 && late[0] === -30 && late.every((x) => x >= -30 && x <= 90 && x === Math.round(x)) && Math.max.apply(null, late) <= 90);
  check("5b. app.js: readDeliveryLevers uses delivery.site.* at scale 1 with mode 'site' when delivery.site.n > 0 and names the measured label as the source; readErrorLevers reads hf.error.* from the knowledge base (so a measured share flows into the error what-if); the test API exposes the levers",
    /const siteN = g\("delivery\.site\.n", 0\);/.test(app) && /const scale = site \? 1 : g\("delivery\.scaleTicksPerDay", 60\);/.test(app) && /const mode = site \? "site" :/.test(app) && /site profile: /.test(app) &&
    /g\("hf\.error\.mis-pick", 0\.02\)/.test(app) && /levers: \{ error: readErrorLevers, delivery: readDeliveryLevers \}/.test(app));
})();

/* ---- 6. human ---------------------------------------------------------- */
(function () {
  const py = read(path.join("tools", "fit_rates.py")), fixture = read(path.join("test", "fixtures", "fit-rates.events.json"));
  check("6a. the tool keys nothing to a person (no worker / operator / employee / badge field), its honesty names BetrVG and GDPR and 'never per person', it does not import datetime; the fixture says SYNTHETIC and the profile's honesty names the limits",
    !/\b(worker|operator|employee|badge|user_id|person_id)\b/i.test(py.replace(/never per person|never a person|nothing is keyed to a person|pointed at one/g, "")) && /BetrVG 87\(1\)6, GDPR Art\. 88/.test(py) && /never per person/.test(py) && !/^import datetime|^from datetime/m.test(py) &&
    /SYNTHETIC/.test(fixture) && /not a validated error model, not a forecast/.test(prof.honesty) && /never per person/.test(prof.honesty));
})();

/* ---- 7. shipped wiring ----------------------------------------------------- */
(function () {
  const app = read("app.js"), html = read("index.html"), css = read("styles.css"), st = read("selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js"), kb = read("knowledge.js");
  const readme = read("README.md"), changelog = read("CHANGELOG.md");
  check("7a. the knowledge base: six delivery.site.* seeds, applyProfile / profile / PROFILE_SCHEMA exported, importJson routes the schema, reset forgets the profile, the stamp survives a reload",
    ["delivery.site.n", "delivery.site.latenessMin", "delivery.site.latenessP10", "delivery.site.latenessMedian", "delivery.site.latenessP90", "delivery.site.latenessMax"].every((id) => KB.isSeed(id) && KB.get(id) === 0) &&
    typeof KB.applyProfile === "function" && typeof KB.profile === "function" && KB.PROFILE_SCHEMA === "wt-site-profile/v1" && /if \(data && data\.schema === PROFILE_SCHEMA\) return applyProfile\(data\);/.test(kb) && /profileInfo = null; \/\/ v3\.59/.test(kb) && /the stamp survives a reload/.test(kb));
  check("7b. the card shows the measured badge and label above the teaching default; the import handler reports a site profile; the hint names it; the badge is styled",
    /kb-badge measured/.test(app) && /Measured:<\/span>/.test(app) && /Teaching default:/.test(app) && /Site profile applied:/.test(app) && /site profile/.test(html) && /measured on …, n = …/.test(html) && /\.kb-badge\.measured/.test(css));
  check("7c. selftest.js has site-profile-measured-labels; run-all lists verify_fit_rates.js; sw.js at wt-v140 (previously wt-v139); README and CHANGELOG name v3.59; docs/SITE_PROFILE.md exists and names the rule",
    /site-profile-measured-labels/.test(st) && /verify_fit_rates\.js/.test(runall) && /CACHE_VERSION\s*=\s*"wt-v140"/.test(sw) && /Previously wt-v139/.test(sw) && /v3\.59/.test(readme) && /## v3\.59/.test(changelog) &&
    fs.existsSync(path.join(__dirname, "docs", "SITE_PROFILE.md")) && /nearest-rank/.test(read(path.join("docs", "SITE_PROFILE.md"))) && /never per person|never a person|nothing is keyed to a person/.test(read(path.join("docs", "SITE_PROFILE.md"))));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL FIT-RATES CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
