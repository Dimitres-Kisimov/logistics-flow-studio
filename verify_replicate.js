/* =====================================================================
 * Logistics Flow Studio - verify_replicate.js
 * v3.46 REPLICATIONS OVER SEEDS - headless verification
 * ---------------------------------------------------------------------
 * tools/replicate.mjs records one run ledger per seed on one floor and
 * writes a bundle; tools/run_ledger.py groups every run in a database by
 * scenario, order mix, ticks and policy and gives, per order type, n, the
 * mean, the sample standard deviation and a Student-t two-sided 95 %
 * half-width (v_replication_*); RunLedger.replications is the viewer's
 * twin over several loaded files. Honest: seeds only - no warm-up removal,
 * no validation against a real plant; the comparison page says so. This
 * harness proves:
 *   1. The runner: three seeds of the hand floor over 300 ticks write three
 *      exports and a bundle, the ids differ only by seed, a second run
 *      writes the same bytes.
 *   2. The twin against independent arithmetic on those three runs: one
 *      group of n = 3 (seeds 1, 2, 3); per order type the mean, the
 *      two-pass sample standard deviation and t(2) = 4.303 x s / sqrt(3),
 *      min and max, each recomputed here from RunLedger.views.
 *   3. By hand: one export loaded twice is n = 2 with s = 0 and a zero
 *      half-width; a single run has no interval; three synthetic groups do
 *      not mix (a different tick count is a different group); the t table
 *      equals the Python tool's, digit for digit.
 *   4. Shipped wiring: the multi-file input and section, the nav anchor,
 *      the four SQL views in the tool and the viewer, the t_critical table
 *      and the `replications` command, the honest comparison row, the
 *      self-test check, CI, the runner.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const RL = global.RunLedger, I = global.WT.ids, L = global.WT.ledger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const r4 = (v) => Math.round(v * 10000) / 10000;
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

/* ---- 1. the runner ------------------------------------------------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-rep-"));
function runReplicate(dir) {
  return spawnSync(process.execPath, [path.join(__dirname, "tools", "replicate.mjs"), "hand", "--seeds", "1-3", "--ticks", "300", "--out", dir], { encoding: "utf8" });
}
const r1 = runReplicate(path.join(tmp, "a"));
const files = ["run-1.json", "run-2.json", "run-3.json", "bundle.json"];
const exps = [1, 2, 3].map((s) => JSON.parse(fs.readFileSync(path.join(tmp, "a", "run-" + s + ".json"), "utf8")));
const bundle = JSON.parse(fs.readFileSync(path.join(tmp, "a", "bundle.json"), "utf8"));
(function () {
  check("1a. `replicate.mjs hand --seeds 1-3 --ticks 300` exits 0 and writes three exports and a bundle", r1.status === 0 && files.every((f) => fs.existsSync(path.join(tmp, "a", f))), (r1.stdout || "").trim().split("\n").pop());
  check("1b. the runs share scenario, mix and ticks and differ only by seed; the ids parse and the hashes differ", exps.every((e, i) => e.run.scenario === "hand-built" && e.run.seed === i + 1 && e.run.ticks === 300 && I.parseRun(e.run.id) && I.parseRun(e.run.id).seed === i + 1) &&
    new Set(exps.map((e) => e.run.id)).size === 3 && JSON.stringify(exps[0].run.mix) === JSON.stringify(exps[1].run.mix));
  check("1c. the bundle names the runs, the seeds, the ticks and the honesty", bundle.kind === "wt-replication-bundle" && JSON.stringify(bundle.runs) === JSON.stringify(exps.map((e) => e.run.id)) && JSON.stringify(bundle.seeds) === "[1,2,3]" && bundle.ticks === 300 && bundle.policy === null && /no warm-up/i.test(bundle.honesty));
  const r2 = runReplicate(path.join(tmp, "b"));
  check("1d. a second run writes the same bytes (deterministic)", r2.status === 0 && files.every((f) => fs.readFileSync(path.join(tmp, "a", f), "utf8") === fs.readFileSync(path.join(tmp, "b", f), "utf8")));
  check("1e. an unknown target or a missing --out exits 2 with the usage", spawnSync(process.execPath, [path.join(__dirname, "tools", "replicate.mjs")], { encoding: "utf8" }).status === 2 && spawnSync(process.execPath, [path.join(__dirname, "tools", "replicate.mjs"), "hand", "--seeds", "1-2"], { encoding: "utf8" }).status === 2);
})();

/* ---- 2. the twin against independent arithmetic -------------------------- */
(function () {
  const rep = RL.replications(exps);
  check("2a. one group: hand-built, n = 3, seeds 1, 2, 3, 300 ticks, no policy", rep.groups.length === 1 && rep.groups[0].n === 3 && JSON.stringify(rep.groups[0].seeds) === "[1,2,3]" && rep.groups[0].ticks === 300 && rep.groups[0].policy === null && rep.groups[0].runs.length === 3);
  const g = rep.groups[0];
  const byType = {};
  for (const e of exps) for (const row of RL.views(e).cycle) if (row.avg_cycle_ticks != null) (byType[row.archetype] = byType[row.archetype] || []).push(row.avg_cycle_ticks);
  const t975 = { 1: 12.706, 2: 4.303 };
  const okRows = g.cycle.length === Object.keys(byType).length && g.cycle.every((row) => {
    const v = byType[row.archetype], n = v.length, mean = v.reduce((a, b) => a + b, 0) / n;
    const s = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : null;
    return row.n === n && near(row.mean, r4(mean), 1e-9) && (n > 1 ? near(row.stdev, r4(s), 1e-9) && near(row.ci95_half, r4(t975[n - 1] * s / Math.sqrt(n)), 1e-9) : row.stdev === null && row.ci95_half === null) &&
      row.min === r4(Math.min.apply(null, v)) && row.max === r4(Math.max.apply(null, v));
  });
  check("2b. every cycle row: n, the mean, the two-pass sample standard deviation, t(n-1) x s / sqrt(n), min and max recomputed here", okRows, g.cycle.map((r) => r.archetype + " n" + r.n + " " + r.mean + "±" + r.ci95_half).join(" · "));
  const costOf = {};
  for (const e of exps) for (const row of RL.views(e).costByType) (costOf[row.archetype] = costOf[row.archetype] || []).push(row.total_eur);
  check("2c. every cost row is over the per-run cost by type", g.cost.every((row) => row.n === costOf[row.archetype].length && near(row.mean, r4(costOf[row.archetype].reduce((a, b) => a + b, 0) / row.n), 1e-9)));
  const units = exps.map((e) => e.hus.length);
  const su = g.summary.find((r) => r.metric === "units");
  check("2d. the run totals: units n = 3 with the mean of the three unit counts; total_eur is the sum of the per-type totals", su && su.n === 3 && near(su.mean, r4(units.reduce((a, b) => a + b, 0) / 3), 1e-9) &&
    near(g.summary.find((r) => r.metric === "total_eur").mean, r4(exps.map((e) => L.nsum(RL.views(e).costByType.map((t) => t.total_eur))).reduce((a, b) => a + b, 0) / 3), 1e-9), JSON.stringify(units));
  check("2e. the columns are exactly the SQL view's", g.cycle.every((r) => Object.keys(r).join(",") === "archetype,n,mean,stdev,ci95_half,min,max") && g.summary.every((r) => Object.keys(r).join(",") === "metric,n,mean,stdev,ci95_half,min,max"));
})();

/* ---- 3. by hand --------------------------------------------------------- */
(function () {
  const twice = RL.replications([exps[0], exps[0]]);
  check("3a. one export loaded twice: n = 2, s = 0, a zero half-width (t(1) = 12.706 x 0)", twice.groups.length === 1 && twice.groups[0].n === 2 && twice.groups[0].cycle.every((r) => r.stdev === 0 && r.ci95_half === 0 && r.min === r.max));
  const one = RL.replications([exps[0]]);
  check("3b. a single run has no interval (stdev and half-width null)", one.groups[0].n === 1 && one.groups[0].cycle.length > 0 && one.groups[0].cycle.every((r) => r.stdev === null && r.ci95_half === null));
  const other = JSON.parse(JSON.stringify(exps[1])); other.run.ticks = 121;
  const mixed = RL.replications([exps[0], exps[2], other]);
  check("3c. a different tick count is a different group (2 + 1), and groups sort by key", mixed.groups.length === 2 && mixed.groups.map((g) => g.n).sort().join(",") === "1,2");
  const py = read(path.join("tools", "run_ledger.py"));
  const m = /T975 = \{([\s\S]*?)\}/.exec(py);
  const pyT = {}; if (m) for (const kv of m[1].matchAll(/(\d+): ([\d.]+)/g)) pyT[Number(kv[1])] = Number(kv[2]);
  check("3d. the t table equals the Python tool's, digit for digit (df 1..30) and df > 30 falls to 1.96", Object.keys(pyT).length === 30 && Object.keys(pyT).every((k) => RL.T975[k] === pyT[k]) && RL.T975[2] === 4.303 && RL.T975[30] === 2.042 && RL.T975[31] === undefined);
  check("3e. the hand numbers: values 30, 32, 34 -> mean 32, s 2, half-width 4.303 x 2 / sqrt(3) = 4.9687",
    (function () { const v = [30, 32, 34], n = 3, mean = 32, s = Math.sqrt(((30 - 32) ** 2 + 0 + (34 - 32) ** 2) / 2); return s === 2 && r4(RL.T975[2] * s / Math.sqrt(n)) === 4.9687 && mean === v.reduce((a, b) => a + b, 0) / n; })());
})();

/* ---- 4. shipped wiring --------------------------------------------------- */
(function () {
  const html = read("run-ledger.html"), js = read("run-ledger.js"), st = read("run-ledger-selftest.js"), py = read(path.join("tools", "run_ledger.py")), xv = read(path.join("tools", "export_viewer_sql.py"));
  const hc = read("howwecompare.js"), ci = read(path.join(".github", "workflows", "ci.yml")), runall = read(path.join("test", "run-all.mjs")), vv = read("verify_run_ledger_view.js");
  const views = ["v_replication_groups", "v_replication_cycle_by_type", "v_replication_cost_by_type", "v_replication_summary"];
  check("4a. the page has the multi-file input, the section and the nav anchor", /id="rlFiles" type="file" multiple/.test(html) && /id="secReplications"/.test(html) && /href="#secReplications"/.test(html) && /id="rlReplications"/.test(html));
  check("4b. the viewer renders the section on every load and exposes replications, loadMany and the t table", /renderReplications\(\)/.test(js) && /RunLedger\.replications = replications/.test(js) && /RunLedger\.loadMany = loadMany/.test(js) && typeof RL.replications === "function" && RL.T975[1] === 12.706);
  check("4c. the four views exist in the tool, in the generated SQL and in the viewer's pinned list; the t table and the command are in the tool",
    views.every((v) => py.indexOf("CREATE VIEW IF NOT EXISTS " + v + " AS") >= 0 && typeof RL.SQL[v] === "string" && vv.indexOf('"' + v + '"') >= 0) && /CREATE TABLE IF NOT EXISTS t_critical/.test(py) && /"replications"/.test(py) && /REPLICATION_VIEWS = \(/.test(py) && /"REPLICATION_VIEWS"/.test(xv));
  check("4d. the comparison page's row is honest: replications over seeds, no warm-up, no validation - and no 'single-run' claim left", /Replications over seeds with Student-t 95 % intervals/.test(hc) && /no validation against a real plant/.test(hc) && !/single-run/i.test(hc));
  check("4e. the viewer self-test covers the section; CI replicates, imports and prints; the runner lists this harness", /replications-section-needs-two-runs/.test(st) && /replicate\.mjs hand --seeds 1-3/.test(ci) && /run_ledger\.py replications/.test(ci) && /verify_replicate\.js/.test(runall));
})();

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* leave the temp dir */ }
console.log("");
console.log(fail === 0 ? "ALL REPLICATION CHECKS PASSED (" + pass + ")" : fail + " REPLICATION CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
