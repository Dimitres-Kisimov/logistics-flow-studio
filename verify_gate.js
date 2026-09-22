/* =====================================================================
 * Logistics Flow Studio - verify_gate.js
 * v3.42 THE ONE GATE - static verification (never spawns the runner)
 * ---------------------------------------------------------------------
 * tools/gate.py runs every check a release must pass - the harnesses, the
 * Python tests, ruff, the generated SQL, and BOTH in-browser self-tests
 * through a headless Chromium-based browser - and prints the README
 * line-9 sentence; CI's verify-browser job runs the two self-tests through
 * it on every push and once a week. This harness proves the wiring
 * statically (it must not spawn run-all: run-all spawns it):
 *   1. the gate exists, documents every flag, drives the browser the way
 *      docs/PRODUCTION.md says (headless=new, a virtual-time budget,
 *      dump-dom, its own profile), treats a missing result line as a
 *      failure, never raises from find_browser, needs no dependency;
 *   2. CI has the verify-browser job, the weekly schedule, and calls the
 *      gate with --check-readme;
 *   3. README line 9 is exactly the sentence the gate renders; its harness
 *      count equals the entries in test/run-all.mjs (this harness
 *      included), its cache pin equals sw.js, its two self-test counts are
 *      quoted consistently below it, and the "not in CI" sentence is gone;
 *   4. the maintainer docs name the gate and carry no stale counts.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

const gate = read(path.join("tools", "gate.py"));
const ci = read(path.join(".github", "workflows", "ci.yml"));
const readme = read("README.md");
const runAll = read(path.join("test", "run-all.mjs"));
const sw = read("sw.js");
const qa = read(path.join("docs", "QA_CHECKLIST.md"));
const prod = read(path.join("docs", "PRODUCTION.md"));

/* ---- 1. the gate ------------------------------------------------------- */
(function () {
  const steps = ["test/run-all.mjs", '"unittest", "discover"', '"ruff", "check"', "tools/export_viewer_sql.py"];
  check("1a. tools/gate.py runs the harnesses, unittest, ruff and the generated-SQL check", steps.every((t) => gate.indexOf(t) >= 0));
  const drive = ["--headless=new", "--disable-gpu", "--virtual-time-budget=", "--dump-dom", "--user-data-dir=", "WT-SELFTEST: (PASS|FAIL)", 'data-page="'];
  check("1b. the browser is driven as docs/PRODUCTION.md says and the result line is scraped", drive.every((t) => gate.indexOf(t) >= 0));
  const flags = ["--browser", "--virtual-time-budget", "--skip-node", "--skip-python", "--skip-browser", "--check-readme", "--date"];
  check("1c. every documented flag is declared", flags.every((f) => gate.indexOf('"' + f + '"') >= 0), flags.length + " flags");
  check("1d. a missing WT-SELFTEST line is a failure; find_browser never raises",
    /no WT-SELFTEST line/.test(gate) && /def find_browser/.test(gate) && /Never raises/.test(gate) && /return None/.test(gate));
  check("1e. both pages are driven and the viewer's data-page is required", gate.indexOf("index.html?selftest=1") >= 0 && gate.indexOf("run-ledger.html?selftest=1") >= 0 && gate.indexOf('"run-ledger"') >= 0);
  check("1f. standard library only", !/^\s*(import|from)\s+(playwright|selenium|requests|pytest)\b/m.test(gate) && /^import subprocess$/m.test(gate));
  check("1g. the sandbox is dropped only under CI on Linux, and the browser gets its own profile",
    /os\.environ\.get\("CI"\) and sys\.platform != "win32"/.test(gate) && /TemporaryDirectory\(prefix="wt-gate-"\)/.test(gate));
})();

/* ---- 2. CI ------------------------------------------------------------- */
(function () {
  check("2a. CI has the verify-browser job calling the gate with --check-readme",
    /^\s*verify-browser:/m.test(ci) && /python tools\/gate\.py --skip-node --skip-python --check-readme/.test(ci));
  check("2b. CI runs on a weekly schedule as well as on push and pull request",
    /^\s*schedule:/m.test(ci) && /cron:/.test(ci) && /^\s*push:/m.test(ci) && /^\s*pull_request:/m.test(ci));
  check("2c. CI names the browser it expects before running", /which google-chrome/.test(ci));
})();

/* ---- 3. README line 9 --------------------------------------------------- */
const LINE9 = /^- \*\*Verified at the current commit \((\d{4}-\d{2}-\d{2})\)\*\* — `node test\/run-all\.mjs`: \*\*(\d+) headless harnesses\*\* green; `python -m pytest test`: \*\*(\d+) Python tests\*\* green; `index\.html\?selftest=1` in headless Chromium: \*\*WT-SELFTEST PASS (\d+)\/(\d+)\*\* and `run-ledger\.html\?selftest=1`: \*\*WT-SELFTEST PASS (\d+)\/(\d+)\*\*; service-worker cache `(wt-v\d+)`\./;
const line9 = readme.split(/\r?\n/)[8] || "";
const m = LINE9.exec(line9);
const entries = (runAll.match(/^\s*\{ name: /gm) || []).length;
(function () {
  check("3a. README line 9 is the gate's sentence", !!m, m ? m[2] + " harnesses, " + m[3] + " Python, " + m[4] + "/" + m[5] + ", " + m[6] + "/" + m[7] + ", " + m[8] : line9.slice(0, 80));
  check("3b. its harness count equals the entries of test/run-all.mjs (this harness included)",
    !!m && Number(m[2]) === entries && /verify_gate\.js/.test(runAll), m ? m[2] + " vs " + entries : "");
  check("3c. both self-test counts are full passes and are quoted consistently further down",
    !!m && m[4] === m[5] && m[6] === m[7] && readme.indexOf("WT-SELFTEST: PASS " + m[4] + "/" + m[5]) >= 0 && readme.indexOf("WT-SELFTEST: PASS " + m[6] + "/" + m[7]) >= 0);
  check("3d. its cache pin is sw.js's CACHE_VERSION", !!m && sw.indexOf('const CACHE_VERSION = "' + m[8] + '"') >= 0);
  check("3e. README no longer says the self-tests run outside CI", !/CI has no browser/.test(readme) && /verify-browser/.test(readme));
  const py = Number(m ? m[3] : 0);
  const tests = fs.readdirSync(path.join(__dirname, "test")).filter((f) => /^test_.*\.py$/.test(f));
  check("3f. the Python count is plausible: at least one test per test module", tests.length > 0 && py >= tests.length, py + " tests over " + tests.length + " modules");
})();

/* ---- 4. the maintainer docs -------------------------------------------- */
(function () {
  check("4a. docs/QA_CHECKLIST.md names the gate, the viewer suite, the run-all sentence, and no stale count",
    /tools\/gate\.py/.test(qa) && /run-ledger\.html\?selftest=1/.test(qa) && /ALL <n> HARNESSES PASSED/.test(qa) && !/ALL 29 HARNESSES/.test(qa) && !/57\/57/.test(qa));
  check("4b. docs/PRODUCTION.md names the gate, the viewer suite and CI, and no stale count",
    /tools\/gate\.py/.test(prod) && /run-ledger\.html\?selftest=1/.test(prod) && /verify-browser/.test(prod) && !/57\/57/.test(prod) && !/49 Node harnesses/.test(prod) && !/~57 checks/.test(prod));
  check("4c. the runner lists this harness", /verify_gate\.js/.test(runAll));
})();

console.log("");
console.log(fail === 0 ? "ALL CHECKS PASSED (" + pass + ")" : fail + " CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
