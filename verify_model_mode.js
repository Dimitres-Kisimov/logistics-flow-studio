/* =====================================================================
 * Logistics Flow Studio - verify_model_mode.js
 * v3.61 THE OPTIONAL MODEL MODE - headless verification
 * ---------------------------------------------------------------------
 * A language model rewrites the deterministic answer of ask.js into prose,
 * BESIDE the app (tools/ask_model.py over an OpenAI-compatible endpoint),
 * never inside the offline page. It must prove:
 *   1. THE DETERMINISTIC LAYER FROM THE COMMAND LINE: tools/ask_cli.mjs
 *      prints exactly WT.ask.answer over the same modules; --all prints the
 *      twelve catalogue answers; the usage exits 2.
 *   2. OFF BY DEFAULT: the Python tool's dry run calls nothing, prints the
 *      deterministic answer and its evidence lines; the number guard refuses
 *      an invented number (spawned Python).
 *   3. THE APP UNCHANGED WITH THE MODE OFF: the CSP still says connect-src
 *      'self'; no fetch to a host in the app or ask.js; the cache pin did not
 *      move (nothing shipped changed); the deterministic answers are the
 *      v3.60 ones (stg / putaway 122.4; 349.74 EUR).
 *   4. THE RULES ARE WRITTEN DOWN: the prompt forbids new numbers and any
 *      person; the honesty says off by default and beside the app; the docs,
 *      README, CHANGELOG and run-all carry the release.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "knowledge.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "control.js", "ask.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, ASK = WT.ask, KB = WT.kb;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const PY = process.env.PYTHON || "python";
const FIX = path.join("test", "fixtures", "run-ledger.json");
const expA = JSON.parse(read(FIX));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-model-"));
const node = (args) => spawnSync(process.execPath, [path.join(__dirname, "tools", "ask_cli.mjs")].concat(args), { encoding: "utf8", cwd: __dirname });
const py = (args) => spawnSync(PY, [path.join(__dirname, "tools", "ask_model.py")].concat(args), { encoding: "utf8", cwd: __dirname });

/* ---- 1. the deterministic layer from the command line ---------------------- */
(function () {
  const r = node(["which step waits longest", "--export", FIX]);
  const want = JSON.stringify(ASK.answer("which step waits longest", { exp: expA, kb: KB }), null, 1) + "\n";
  check("1a. tools/ask_cli.mjs prints exactly WT.ask.answer over the same modules (the knowledge base's teaching values included)", r.status === 0 && r.stdout === want, (r.stderr || "").trim().slice(0, 120));
  const all = node(["--all", "--export", FIX]);
  const obj = all.status === 0 ? JSON.parse(all.stdout) : {};
  check("1b. --all prints the twelve catalogue answers keyed by id, each with its text and read", all.status === 0 && Object.keys(obj).length === 12 && ASK.catalogue().every((q) => obj[q.id] && obj[q.id].id === q.id && typeof obj[q.id].text === "string" && Array.isArray(obj[q.id].read)));
  check("1c. the usage exits 2 without a question or an export", node([]).status === 2 && node(["hello"]).status === 2 && /usage:/.test(node([]).stderr));
})();

/* ---- 2. off by default ------------------------------------------------------ */
(function () {
  const out = path.join(tmp, "dry.json");
  const r = py(["which step waits longest", "--export", FIX, "--out", out]);
  const j = r.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  check("2a. the dry run (no --endpoint) calls nothing: mode deterministic, model null, the v3.60 text, the prompt's size, and the evidence lines printed",
    r.status === 0 && j && j.mode === "deterministic" && j.model === null && j.dry_run === true && /122\.4 ticks on average over 23 waits/.test(j.deterministic.text) && j.prompt_chars > 1000 &&
    /\(dry run: no endpoint given, nothing was called/.test(r.stdout) && /Evidence: read v_station_wait \(6 rows\)/.test(r.stdout) && j.evidence.answer.id === "wait", (r.stdout || r.stderr).trim().split("\n").pop());
  const g = spawnSync(PY, ["-c", "import sys; sys.path.insert(0, 'tools'); import ask_model as M; import json; print(json.dumps(M.guard('stg waits 122.4 ticks over 23 waits; 99 units and 3 shifts', {'x': 122.4, 'y': 23})))"], { encoding: "utf8", cwd: __dirname });
  check("2b. the number guard refuses an invented number and names it (99 and 3 are not in the evidence; 122.4 and 23 are)", g.status === 0 && g.stdout.trim() === '{"ok": false, "offending": ["3", "99"]}', g.stdout.trim());
})();

/* ---- 3. the app unchanged with the mode off ---------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), ask = read("ask.js"), sw = read("sw.js"), guardSrc = read(path.join("tools", "offline-guard.mjs"));
  check("3a. the page is still offline: connect-src 'self' in the CSP, no fetch to a host in app.js or ask.js, the offline guard still forbids external fetches, the service worker still pins a wt-vNNN cache (v3.61 itself shipped no app file)",
    /connect-src 'self'/.test(html) && !/fetch\(\s*["'`]https?:\/\//.test(app) && !/fetch\(|XMLHttpRequest|WebSocket/.test(ask) && /fetch to external host/.test(guardSrc) && /CACHE_VERSION\s*=\s*"wt-v\d+"/.test(sw));
  const w = ASK.answer("which step waits longest", { exp: expA, kb: KB }), c = ASK.answer("what does the run cost", { exp: expA, kb: KB });
  check("3b. the deterministic answers are the v3.60 ones with the mode off (stg / putaway 122.4 over 23; 349.74 EUR)", w.numbers.location === "stg" && w.numbers.avg_wait_ticks === 122.4 && w.numbers.waits === 23 && /The run cost 349\.74 EUR/.test(c.text));
})();

/* ---- 4. the rules are written down ---------------------------------------------- */
(function () {
  const tool = read(path.join("tools", "ask_model.py")), doc = read(path.join("docs", "MODEL_MODE.md")), readme = read("README.md"), changelog = read("CHANGELOG.md"), runall = read("test/run-all.mjs");
  check("4a. the prompt forbids a number of the model's own and any person; the honesty says off by default and beside the app; a key is read from the environment only",
    /never introduce a number of your own/.test(tool) && /Never name, guess or imply a person/.test(tool) && /Off by default; nothing is called without --endpoint/.test(tool) && /beside the app, never inside it/.test(tool) && /os\.environ\.get\(a\.api_key_env\)/.test(tool) && !/api[-_]?key\s*=\s*["'][A-Za-z0-9]{8,}/.test(tool));
  check("4b. docs/MODEL_MODE.md states the runtime decision (beside, never inside), the two rules, the NETWORK banner and the refusal; README names v3.61 as off by default; CHANGELOG has v3.61; run-all lists this harness",
    /beside/.test(doc) && /never inside/.test(doc) && /NETWORK/.test(doc) && /refused/.test(doc) && /connect-src 'self'/.test(doc) && /v3\.61/.test(readme) && /off by default/.test(readme) && /## v3\.61/.test(changelog) && /verify_model_mode\.js/.test(runall));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL MODEL-MODE CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
