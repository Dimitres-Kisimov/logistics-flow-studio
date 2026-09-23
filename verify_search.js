/* =====================================================================
 * Logistics Flow Studio - verify_search.js
 * v3.62 SEARCH OVER LEVERS + THE TOWER'S FIFTH RULE - headless verification
 * ---------------------------------------------------------------------
 * tools/search_levers.mjs tries combinations of the staffing, error and
 * delivery levers on a scenario across seeds and ranks them by OTIF and cost
 * with the replication confidence intervals; the control tower's fifth rule
 * (lever-search) proposes the best-ranked combination with the table as its
 * evidence. It must prove:
 *   1. THE SEARCH BY HAND on the hand floor for two levers (staffing
 *      declared / adaptive x carrier period 240 / 120) and two seeds over
 *      400 ticks: four combinations, eight runs; every combination's OTIF,
 *      cost and delivered orders recomputed from the exports the tool wrote
 *      (WT.ledger.serviceOf / costs), the mean, the sample standard deviation
 *      and the half-width with t = 12.706 (n = 2); the ranking by the stated
 *      order; the literal facts (the best is declared staffing with carrier
 *      period 120: OTIF 0.7778 +- 0, 9 delivered orders); the cost statistics
 *      equal the viewer's own replication rows; byte-identical on a second
 *      run; the usage; each combination's levers in the tower's format.
 *   2. THE FIFTH RULE on a hand table (three combinations, n = 5): it
 *      proposes the best's differing levers as one combination lever at the
 *      first evaluation when the run sits at a worse combination with a
 *      clear gain; it stays silent at the best, inside the half-widths, on
 *      another scenario, and without a table; a run the table did not search
 *      gets every lever including the delivery and error pickers; a decision
 *      lands in the audit and in controlRows; the rule is documented.
 *   3. THE PLANT'S OWN RATES (v3.63): --profile runs the grid at a site
 *      profile's fitted shares and its own lateness quantiles, the table
 *      records them, the ranking changes (11 orders at 0.9091 against 9 at
 *      0.7778), a thin sample cannot win, and the tower refuses a table
 *      measured under other rates than the run's.
 *   4. SHIPPED WIRING: the app applies a combination lever (and the delivery
 *      and error pickers) and reverts it, creates the tower with the loaded
 *      table, imports the table; the knowledge-base threshold; the self-test;
 *      run-all; sw.js at wt-v143; verify_control updated; README, CHANGELOG,
 *      docs/LEVER_SEARCH.md.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "knowledge.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "control.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, R = WT.routing, F = WT.flowsim, L = WT.ledger, P = WT.pack, A = WT.analytics, C = WT.control, RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const r4 = (v) => Math.round(v * 10000) / 10000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-search-"));
const tool = path.join(__dirname, "tools", "search_levers.mjs");
const run = (args) => spawnSync(process.execPath, [tool].concat(args), { encoding: "utf8", cwd: __dirname });
const FLOOR = { gridW: 40, gridH: 24, cell: 1, elements: [
  { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 }, { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 }, { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
  { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 }, { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 }, { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
  { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 }, { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 }, { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
  { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 }, { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 }, { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 }] };

/* ---- 1. the search by hand -------------------------------------------------- */
const outA = path.join(tmp, "a");
const r1 = run(["hand", "--seeds", "1-2", "--ticks", "400", "--staffing", "declared,adaptive", "--outbound-period", "240,120", "--out", outA]);
const S = r1.status === 0 ? JSON.parse(fs.readFileSync(path.join(outA, "search.json"), "utf8")) : null;
(function () {
  check("1a. the tool runs on the hand floor for two seeds: kind wt-lever-search, scenario hand-built, 400 ticks, four combinations (declared / adaptive x carrier 240 / 120, dock 120, errors declared), a ranking of four, the best first",
    r1.status === 0 && !!S && S.kind === "wt-lever-search" && S.scenario === "hand-built" && S.ticks === 400 && JSON.stringify(S.seeds) === "[1,2]" && S.combos.length === 4 && S.ranked.length === 4 && S.best === S.ranked[0] &&
    JSON.stringify(S.grid) === '{"staffing":["declared","adaptive"],"inbound_period":[120],"outbound_period":[240,120],"errors":"declared"}' && fs.existsSync(path.join(outA, "search.md")), (r1.stdout || r1.stderr || "").trim().split("\n").pop());
  if (!S) return;
  const stats = (vals) => { const v = vals.filter((x) => typeof x === "number"); const n = v.length; if (!n) return { n: 0, mean: null, ci95_half: null }; const mean = v.reduce((a, b) => a + b, 0) / n;
    const s = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (n - 1)) : null; return { n: n, mean: r4(mean), stdev: s == null ? null : r4(s), ci95_half: s == null ? null : r4(12.706 * s / Math.sqrt(n)) }; };
  let allEqual = true, detail = [], exportsByCombo = {};
  for (const c of S.combos) {
    const exps = [1, 2].map((seed) => JSON.parse(fs.readFileSync(path.join(outA, "run-" + c.index + "-" + seed + ".json"), "utf8")));
    exportsByCombo[c.id] = exps;
    const otif = stats(exps.map((e) => { const s = L.serviceOf(e); return s ? s.otif : null; })), cost = stats(exps.map((e) => L.costs(e).total.total_eur)), del = stats(exps.map((e) => { const s = L.serviceOf(e); return s ? s.delivered_orders : 0; }));
    const same = (x, y) => x.n === y.n && x.mean === y.mean && x.ci95_half === y.ci95_half && x.stdev === y.stdev;
    if (!(same(otif, c.otif) && same(cost, c.cost_eur) && same(del, c.delivered_orders))) { allEqual = false; detail.push(c.id + " otif " + JSON.stringify([otif, c.otif])); }
    const plan0 = exps[0].run;
    if (!((c.levers.staffing === "adaptive") === !!(plan0.policy && plan0.policy.kind === "queue-staffing") && plan0.inbound.periodTicks === c.levers.inbound_period && plan0.outbound.periodTicks === c.levers.outbound_period && !!plan0.errors)) { allEqual = false; detail.push(c.id + " levers not in the run"); }
  }
  check("1b. every combination's OTIF, cost and delivered orders recomputed from the eight exports (serviceOf, costs) with mean, sample sd and the t = 12.706 half-width equal the tool's; each run carries its combination's levers", allEqual, detail.join("; "));
  const order = S.combos.slice().sort((a, b) => ((b.otif.mean == null ? -1 : b.otif.mean) - (a.otif.mean == null ? -1 : a.otif.mean)) || ((a.cost_eur.mean == null ? Infinity : a.cost_eur.mean) - (b.cost_eur.mean == null ? Infinity : b.cost_eur.mean)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => c.id);
  const best = S.combos.find((c) => c.id === S.best);
  check("1c. the ranking is the stated order (OTIF mean desc, cost mean asc, id); the literal facts: the best is declared staffing with carrier period 120 - OTIF 0.7778 +- 0 over 2 seeds, 9 +- 0 delivered orders; carrier period 240 leaves OTIF at 0.25 with a half-width of 3.1765 (n = 2, t = 12.706: no ranking inside it)",
    JSON.stringify(order) === JSON.stringify(S.ranked) && S.best === "staffing=declared|inbound=120|outbound=120|errors=declared" && best.otif.mean === 0.7778 && best.otif.ci95_half === 0 && best.delivered_orders.mean === 9 &&
    S.combos.find((c) => c.id === "staffing=declared|inbound=120|outbound=240|errors=declared").otif.ci95_half === 3.1765, JSON.stringify(S.ranked));
  const grp = RL.replications(exportsByCombo[S.best]).groups;
  const costRow = grp.length === 1 ? grp[0].summary.find((r) => r.metric === "total_eur") : null;
  check("1d. the cost statistics equal the viewer's own replication rows for the same runs (RunLedger.replications: one group, total_eur mean and half-width)", grp.length === 1 && grp[0].n === 2 && !!costRow && costRow.mean === best.cost_eur.mean && costRow.ci95_half === best.cost_eur.ci95_half, JSON.stringify(costRow));
  const r2 = run(["hand", "--seeds", "1-2", "--ticks", "400", "--staffing", "declared,adaptive", "--outbound-period", "240,120", "--out", path.join(tmp, "b")]);
  check("1e. a second run writes the same bytes (search.json, search.md); the usage exits 2 on a bad staffing value and without --out",
    r2.status === 0 && lf(fs.readFileSync(path.join(outA, "search.json"), "utf8")) === lf(fs.readFileSync(path.join(tmp, "b", "search.json"), "utf8")) && lf(fs.readFileSync(path.join(outA, "search.md"), "utf8")) === lf(fs.readFileSync(path.join(tmp, "b", "search.md"), "utf8")) &&
    run(["hand", "--staffing", "robots", "--out", path.join(tmp, "c")]).status === 2 && run(["hand"]).status === 2);
  check("1f. each combination carries its levers in the tower's format (the staffing picker, the two knowledge-base periods) and the markdown table has one row per combination in rank order",
    S.combos.every((c) => JSON.stringify(c.kb) === JSON.stringify([{ kind: "picker", key: "staffing", value: c.levers.staffing }, { kind: "kb", key: "delivery.inbound.periodTicks", value: c.levers.inbound_period }, { kind: "kb", key: "delivery.outbound.periodTicks", value: c.levers.outbound_period }])) &&
    (fs.readFileSync(path.join(outA, "search.md"), "utf8").match(/^\| \d \| /gm) || []).length === 4 && /\| 1 \| staffing=declared\|inbound=120\|outbound=120\|errors=declared \| 2 \| 0\.7778 ± 0 \|/.test(fs.readFileSync(path.join(outA, "search.md"), "utf8")));
})();

/* ---- 2. the fifth rule on a hand table ------------------------------------------ */
(function () {
  const mk = (st, ip, op, mean, half, cost) => ({ id: "staffing=" + st + "|inbound=" + ip + "|outbound=" + op + "|errors=declared", levers: { staffing: st, inbound_period: ip, outbound_period: op, errors: "declared" },
    kb: [{ kind: "picker", key: "staffing", value: st }, { kind: "kb", key: "delivery.inbound.periodTicks", value: ip }, { kind: "kb", key: "delivery.outbound.periodTicks", value: op }], n: 5,
    otif: { n: 5, mean: mean, stdev: 0.05, ci95_half: half }, cost_eur: { n: 5, mean: cost, stdev: 3, ci95_half: 3.7 }, delivered_orders: { n: 5, mean: 20, stdev: 0, ci95_half: 0 } });
  const Acombo = mk("adaptive", 120, 120, 0.9, 0.05, 600), Bcombo = mk("declared", 120, 240, 0.6, 0.1, 520), Ccombo = mk("declared", 120, 120, 0.88, 0.05, 510);
  const table = { kind: "wt-lever-search", scenario: "hand-built", ticks: 600, seeds: [1, 2, 3, 4, 5], combos: [Acombo, Bcombo, Ccombo], ranked: [Acombo.id, Ccombo.id, Bcombo.id], best: Acombo.id };
  const late = [0, 53, -40, 159];
  const recordAt = (opts, tableIn, thresholds, ticks) => {
    const plan = F.spawnPlan(FLOOR, opts), st = F.state(plan);
    const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
    const ctl = C.create(thresholds || {}, { search: tableIn });
    st.hooks = { afterTick: (s) => { L.observe(rec, s); C.observe(ctl, rec, s); } };
    F.step(st, ticks || 20);
    return { ctl: ctl, rec: rec, plan: plan };
  };
  const mix = R.defaultMix();
  const atB = recordAt({ seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } }, table);
  const p = atB.ctl.proposals[0];
  check("2a. a run at the worst combination (declared, carrier 240) gets the proposal at the first evaluation (tick 10): the best's differing levers as one combination lever - staffing adaptive and carrier period 120 (the dock period and the errors already match) - with the ranked table, the current id, the gain 0.3 and the half-width rule as evidence",
    atB.ctl.proposals.length === 1 && p.rule === "lever-search" && p.tick === 10 && p.lever.kind === "combo" && JSON.stringify(p.lever.levers) === JSON.stringify([{ kind: "picker", key: "staffing", value: "adaptive" }, { kind: "kb", key: "delivery.outbound.periodTicks", value: 120 }]) &&
    p.evidence.current === Bcombo.id && p.evidence.current_searched === true && p.evidence.best === Acombo.id && p.evidence.gain === 0.3 && p.evidence.min_gain_half_widths === 1 && p.evidence.table.length === 3 && p.evidence.table[0].id === Acombo.id && p.evidence.table[0].otif_mean === 0.9 && p.evidence.table[0].otif_half === 0.05 &&
    /OTIF 0\.9 ± 0\.05 over 5 seeds in the search against 0\.6 ± 0\.1 for this run's combination; the day re-runs/.test(p.expectedEffect) && /ranks .* first and its gain clears the half-widths/.test(p.why), p ? JSON.stringify(p.lever) : "no proposal");
  const atA = recordAt({ seed: 31, mix: mix, errors: true, policy: { kind: "queue-staffing" }, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 120, promisedLeadTicks: 480, transit: [120] } }, table);
  const atC = recordAt({ seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 120, promisedLeadTicks: 480, transit: [120] } }, table);
  const atC0 = recordAt({ seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 120, promisedLeadTicks: 480, transit: [120] } }, table, { search: { minGainHalfWidths: 0 } });
  check("2b. silent when the run is already at the best; silent at the second-best whose gain 0.02 is inside the half-width 0.05; with the threshold at 0 half-widths it proposes (any positive gain)",
    atA.ctl.proposals.length === 0 && atC.ctl.proposals.length === 0 && atC0.ctl.proposals.length === 1 && atC0.ctl.proposals[0].evidence.gain === 0.02 && JSON.stringify(atC0.ctl.proposals[0].lever.levers) === JSON.stringify([{ kind: "picker", key: "staffing", value: "adaptive" }]));
  const other = recordAt({ seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } }, Object.assign({}, table, { scenario: "other-floor" }));
  const none = recordAt({ seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } }, null);
  const bad = recordAt({ seed: 31, mix: mix }, { kind: "something-else" });
  check("2c. silent on another scenario's table, without a table, and with a foreign document (create keeps no search)", other.ctl.proposals.length === 0 && none.ctl.proposals.length === 0 && none.ctl.search === null && bad.ctl.proposals.length === 0 && bad.ctl.search === null);
  const plain = recordAt({ seed: 31, mix: mix }, table);
  const q = plain.ctl.proposals[0];
  check("2d. a run the table did not search (no windows, no errors, no policy) gets every lever of the best - the staffing picker, the delivery picker on, both periods, the errors picker - and the evidence says the current combination was not searched",
    plain.ctl.proposals.length === 1 && q.evidence.current === "staffing=declared|inbound=none|outbound=none|errors=none" && q.evidence.current_searched === false && q.evidence.gain === null &&
    JSON.stringify(q.lever.levers) === JSON.stringify([{ kind: "picker", key: "staffing", value: "adaptive" }, { kind: "picker", key: "delivery", value: "windows" }, { kind: "kb", key: "delivery.inbound.periodTicks", value: 120 }, { kind: "kb", key: "delivery.outbound.periodTicks", value: 120 }, { kind: "picker", key: "errors", value: "declared" }]) &&
    /this run's combination was not searched/.test(q.expectedEffect), q ? JSON.stringify(q.lever.levers) : "none");
  const row = C.decide(atB.ctl, p.id, "accepted", 30);
  atB.rec.control = [Object.assign({}, row, { from_run: atB.rec.run.id })];
  const exp = L.exportJson(atB.rec), rows = C.controlRows(exp);
  check("2e. a decision on the combination lever lands in the audit with the lever intact and in controlRows (v_control's twin); the rule is the fifth, documented with what it reads and proposes; the honesty names five rules",
    !!row && row.status === "accepted" && row.lever.kind === "combo" && row.lever.levers.length === 2 && C.pending(atB.ctl).length === 0 && rows.length === 1 && rows[0].rule === "lever-search" && rows[0].accepted === 1 && exp.control[0].lever.kind === "combo" &&
    C.RULES.length === 5 && C.RULES[4].id === "lever-search" && /search table/.test(C.RULES[4].reads) && /combination lever/.test(C.RULES[4].lever) && /five rules/.test(C.HONESTY) && C.DEFAULTS.search.minGainHalfWidths === 1);
  check("2f. the observer stays read-only with a table attached: the plan and the sim state are byte-identical to a run without the tower", (function () {
    const a = F.spawnPlan(FLOOR, { seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } });
    const sa = F.state(a); F.step(sa, 20);
    return JSON.stringify(atB.plan) === JSON.stringify(a) && JSON.stringify(sa) === JSON.stringify((function () { const b = F.spawnPlan(FLOOR, { seed: 31, mix: mix, errors: true, inbound: { periodTicks: 120, openTicks: 30, lateness: late }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } }); const sb = F.state(b); const rec = L.create(b, { scenarioId: "hand-built", seed: 31, mix: mix, layout: FLOOR, profile: P.PROFILES.ecommerce }); const ctl = C.create({}, { search: table }); sb.hooks = { afterTick: (s) => { L.observe(rec, s); C.observe(ctl, rec, s); } }; F.step(sb, 20); delete sb.hooks; return sb; })());
  })());
})();

/* ---- 3. shipped wiring ----------------------------------------------------------- */
(function () {
  const app = read("app.js"), html = read("index.html"), kb = read("knowledge.js"), st = read("selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js"), vc = read("verify_control.js");
  const readme = read("README.md"), changelog = read("CHANGELOG.md"), ctl = read("control.js");
  check("3a. app.js: applyLever takes a combination (every lever applied, the froms kept for the revert) and the delivery and errors pickers; the tower is created with the loaded table; readControlThresholds carries control.search.minGainHalfWidths; leverText joins a combination",
    /lever\.kind === "combo" && Array\.isArray\(lever\.levers\)/.test(app) && /lever\.key === "delivery"/.test(app) && /lever\.key === "errors"/.test(app) && /WT\.control\.create\(readControlThresholds\(\), \{ search: state\.flow\.search \}\)/.test(app) &&
    /search: \{ minGainHalfWidths: g\("control\.search\.minGainHalfWidths", 1\) \}/.test(app) && /lever\.kind === "combo" \? lever\.levers\.map\(leverText\)\.join\("; "\)/.test(app) && /Array\.isArray\(r\.lever\.from\)/.test(app));
  check("3b. the control card: an Import lever search button with its hidden input, the loaded table's line; the handler validates wt-lever-search, keeps it on state.flow.search and re-runs the day",
    /id="controlSearchImport"/.test(html) && /id="controlSearchImportInput" type="file"/.test(html) && /id="controlSearchInfo"/.test(html) && /obj\.kind !== "wt-lever-search"/.test(app) && /state\.flow\.search = obj/.test(app) && /controlSearchImportInput/.test(app));
  check("3c. the knowledge base's control category carries control.search.minGainHalfWidths (1); the self-test lever-search-rule-proposes-from-a-table; run-all lists verify_search.js; sw.js at wt-v143 (previously wt-v142); verify_control pins five rules and eight thresholds",
    /id: "control\.search\.minGainHalfWidths"/.test(kb) && WT.kb.get("control.search.minGainHalfWidths") === 1 && /lever-search-rule-proposes-from-a-table/.test(st) && /verify_search\.js/.test(runall) && /CACHE_VERSION\s*=\s*"wt-v143"/.test(sw) && /Previously wt-v142/.test(sw) &&
    /C\.RULES\.length === 5/.test(vc) && /"control\.search\.minGainHalfWidths"/.test(vc));
  check("3d. control.js: the rule reads the table the person loaded, never a live feed; README and CHANGELOG name v3.62; docs/LEVER_SEARCH.md states the three conditions and the honesty",
    /function ruleSearch\(/.test(ctl) && /function comboOf\(/.test(ctl) && /ctl\.search/.test(ctl) && /v3\.62/.test(readme) && /## v3\.62/.test(changelog) && fs.existsSync(path.join(__dirname, "docs", "LEVER_SEARCH.md")) &&
    /minGainHalfWidths/.test(read(path.join("docs", "LEVER_SEARCH.md"))) && /overlapping half-widths is not a ranking/.test(read(path.join("docs", "LEVER_SEARCH.md"))));
})();

/* ---- 5. the plant's own rates, the thin-sample guard and the tower's rates refusal (v3.63) ---- */
(function () {
  const outP = path.join(tmp, "p");
  const rp = run(["hand", "--seeds", "1-2", "--ticks", "400", "--staffing", "declared,adaptive", "--outbound-period", "240,120", "--profile", path.join("test", "fixtures", "site-profile.json"), "--out", outP]);
  const SP = rp.status === 0 ? JSON.parse(fs.readFileSync(path.join(outP, "search.json"), "utf8")) : null;
  const siteLate = F.windowLateness({ min: -30, p10: -30, median: 0, p90: 45, max: 90 }, 1, 16);
  check("5a. --profile runs the whole grid at the plant's own rates: the committed site profile's fitted shares (mis-pick 0.04, wrong put-away 0.05, damage 0.05) and its own lateness quantiles in ticks (mode site, scale 1, the first Weyl point the minimum -30, every value within [-30, 90]) reach every run's plan",
    rp.status === 0 && !!SP && [1, 2].every((seed) => { const e = JSON.parse(fs.readFileSync(path.join(outP, "run-0-" + seed + ".json"), "utf8"));
      return JSON.stringify(e.run.errors.kinds.map((k) => [k.kind, k.effective])) === '[["mis-pick",0.04],["wrong-putaway",0.05],["damage",0.05]]' &&
        e.run.inbound.mode === "site" && e.run.inbound.scaleTicksPerDay === 1 && JSON.stringify(e.run.inbound.lateness) === JSON.stringify(siteLate) && siteLate[0] === -30 && siteLate.every((v) => v >= -30 && v <= 90); }),
    (rp.stdout || rp.stderr || "").trim().split("\n").pop());
  check("5b. the table records the rates it searched under - the site's name, the tool that fitted it and the document, the effective shares, the lateness shape - and the markdown names them; a search without a profile records the teaching values instead",
    !!SP && SP.rates.profile === "example plant" && /tools\/fit_rates\.py site profile fitted on urn:wt:doc:fit-rates-example-1/.test(SP.rates.source) && JSON.stringify(SP.rates.errors) === '[["mis-pick",0.04],["wrong-putaway",0.05],["damage",0.05]]' &&
    SP.rates.inbound_mode === "site" && JSON.stringify(SP.rates.inbound_lateness) === JSON.stringify(siteLate) && /^Rates: tools\/fit_rates\.py site profile fitted on .* \(example plant\); error shares mis-pick 0\.04, wrong-putaway 0\.05, damage 0\.05; lateness shape site\.$/m.test(fs.readFileSync(path.join(outP, "search.md"), "utf8")) &&
    S.rates.profile === null && /teaching values/.test(S.rates.source) && JSON.stringify(S.rates.errors) === '[["mis-pick",0.02],["wrong-putaway",0.003],["damage",0.005]]' && S.rates.inbound_mode === "Truck");
  check("5c. the rates change the answer: at the plant's own rates the same grid delivers 11 orders at OTIF 0.9091 where the teaching rates deliver 9 at 0.7778 - the reason the tool had to read a profile at all",
    !!SP && SP.best === "staffing=declared|inbound=120|outbound=120|errors=declared" && SP.combos.find((c) => c.id === SP.best).otif.mean === 0.9091 && SP.combos.find((c) => c.id === SP.best).delivered_orders.mean === 11 &&
    S.combos.find((c) => c.id === S.best).otif.mean === 0.7778 && S.combos.find((c) => c.id === S.best).delivered_orders.mean === 9);
  const thin = SP ? SP.combos.filter((c) => c.thin) : [];
  const outZ = path.join(tmp, "z");
  const rz = run(["hand", "--seeds", "1-2", "--ticks", "400", "--staffing", "declared,adaptive", "--outbound-period", "240,120", "--profile", path.join("test", "fixtures", "site-profile.json"), "--min-delivered", "0", "--out", outZ]);
  const SZ = rz.status === 0 ? JSON.parse(fs.readFileSync(path.join(outZ, "search.json"), "utf8")) : null;
  check("5d. a thin sample cannot win: the two carrier-period-240 combinations delivered 1.5 orders on average (below the default min_delivered 5), are marked thin and ranked last although their OTIF is 1; with --min-delivered 0 nothing is thin and OTIF 1 over 1.5 orders takes the first place - the guard is what demotes it",
    !!SP && SP.min_delivered === 5 && thin.length === 2 && thin.every((c) => c.delivered_orders.mean === 1.5 && c.otif.mean === 1 && SP.ranked.indexOf(c.id) >= 2) && SP.ranked.slice(0, 2).every((id) => !SP.combos.find((c) => c.id === id).thin) &&
    rz.status === 0 && !!SZ && SZ.min_delivered === 0 && SZ.combos.every((c) => c.thin === false) && SZ.best === "staffing=declared|inbound=120|outbound=240|errors=declared" && SZ.combos.find((c) => c.id === SZ.best).otif.mean === 1 &&
    / \(thin\) \| 2 \| 1 ± 0 \|/.test(fs.readFileSync(path.join(outP, "search.md"), "utf8")) && /min_delivered is marked thin/.test(SP.rule), JSON.stringify(SP ? SP.ranked : null));
  // the tower: a table measured under other rates than the run's does not transfer
  const mix = R.defaultMix();
  // both runs sit at a dock period the table did not search, so the rule has a proposal to make when the rates agree
  const teaching = { seed: 31, mix: mix, errors: true, inbound: { periodTicks: 60, openTicks: 30, lateness: [0, 53, -40, 159] }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } };
  const plant = { seed: 31, mix: mix, errors: { "mis-pick": 0.04, "wrong-putaway": 0.05, damage: 0.05 }, inbound: { periodTicks: 60, openTicks: 30, lateness: siteLate, mode: "site" }, outbound: { periodTicks: 240, promisedLeadTicks: 480, transit: [120] } };
  const towerAt = (opts, table) => {
    const plan = F.spawnPlan(FLOOR, opts), st = F.state(plan);
    const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
    const ctl = C.create({}, { search: table });
    st.hooks = { afterTick: (s) => { L.observe(rec, s); C.observe(ctl, rec, s); } };
    F.step(st, 20);
    return ctl;
  };
  const wrongRates = towerAt(teaching, SP), rightRates = towerAt(plant, SP);
  check("5e. the tower refuses a table measured under other rates: a run at the teaching shares with the plant's table stays silent and the note names both sets of shares; the same run at the plant's own shares and lateness proposes from the same table, and the note is cleared",
    !!SP && wrongRates.proposals.length === 0 && /the table was searched with error shares damage=0\.05, mis-pick=0\.04, wrong-putaway=0\.05; this run uses damage=0\.005, mis-pick=0\.02, wrong-putaway=0\.003/.test(wrongRates.state.searchNote || "") &&
    rightRates.proposals.length === 1 && rightRates.proposals[0].rule === "lever-search" && rightRates.state.searchNote === null, wrongRates.state.searchNote || "no note");
  const noRates = JSON.parse(JSON.stringify(SP || {}));
  delete noRates.rates;
  const lateOnly = JSON.parse(JSON.stringify(SP || {}));
  lateOnly.rates.errors = null;
  check("5f. searchRatesMatch by hand: a table without a rates block matches anything (the tables of v3.62); a run without the block it names has nothing to contradict; only the lateness shape can also refuse",
    C.searchRatesMatch({ rates: null }, { plan: { errors: { kinds: [{ kind: "mis-pick", effective: 0.9 }] } } }).ok === true && towerAt(teaching, noRates).proposals.length === 1 &&
    C.searchRatesMatch(SP, { plan: {} }).ok === true && C.searchRatesMatch(lateOnly, { plan: { errors: { kinds: [{ kind: "mis-pick", effective: 0.02 }] } } }).ok === true &&
    C.searchRatesMatch(SP, { plan: { inbound: { lateness: [1, 2, 3], mode: "Truck" } } }).ok === false && /the table was searched on the site lateness shape; this run uses Truck/.test(C.searchRatesMatch(SP, { plan: { inbound: { lateness: [1, 2, 3], mode: "Truck" } } }).reason));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL LEVER-SEARCH CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
