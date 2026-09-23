/* =====================================================================
 * Logistics Flow Studio - verify_ask.js
 * v3.60 ASK THE LEDGER - headless verification
 * ---------------------------------------------------------------------
 * ask.js answers a fixed catalogue of planner questions from the run
 * ledger's views and the knowledge base - offline, rule-based, deterministic.
 * It must prove:
 *   1. THE CATALOGUE routes: every catalogue question (English and German)
 *      reaches its own answer; the matching order keeps "what does a mis-pick
 *      cost" off the cost answer and "where do the error shares come from"
 *      off the wait answer; an unknown question is unanswered and returns
 *      the catalogue; no run loaded is said.
 *   2. HAND ANSWERS ON FIXTURE A: the longest wait (stg / putaway 122.4 over
 *      23, max 206, 18 still waiting), the summary (39 / 157 / 8 / 2461 / 6 /
 *      3), the cycle times, OTIF not measured with the target's source, no
 *      decision, first pass yield 1 at 20 operations, a mis-pick's redo at
 *      50 ticks x 35 EUR/h = 29.17 EUR, the six human-factors sources, the
 *      cost total 349.74 EUR, no trailer log, five invariants at 0.
 *   3. A WINDOWED RUN with errors, dock and carrier windows and a decided
 *      proposal: OTIF cites v_otif's own numbers and the target, the tower
 *      lists the decision with the rule's threshold, the trailer log counts
 *      the late ones against control.inbound.lateTicks, the mis-pick answer
 *      counts the realised errors.
 *   4. TWINS: waitRows / cycleRows / summaryOf / invariantsOf equal the
 *      viewer's computeViews rows on fixtures A, C and D.
 *   5. PURITY + DETERMINISM: the same question twice is byte-identical; the
 *      export is not mutated; no Date / Math.random; no worker; every view
 *      an answer names exists in the SQL bundle (or is the knowledge base /
 *      the audit); the html renderer escapes.
 *   6. SHIPPED WIRING: the drawer's form and output, the viewer's section,
 *      nav and scripts (domain.js + knowledge.js for the sources), both
 *      self-tests, run-all, sw.js at wt-v140, README, CHANGELOG, the doc.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "knowledge.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "control.js", "ask.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, ASK = WT.ask, R = WT.routing, F = WT.flowsim, L = WT.ledger, P = WT.pack, A = WT.analytics, T = WT.tracking, C = WT.control, KB = WT.kb, RL = global.RunLedger, SQL = global.RunLedgerSQL;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const FIX = path.join("test", "fixtures");
const expA = JSON.parse(read(path.join(FIX, "run-ledger.json")));
const ask = (q, exp) => ASK.answer(q, { exp: exp || expA, kb: KB });
const FLOOR = { gridW: 40, gridH: 24, cell: 1, elements: [
  { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 }, { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 }, { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
  { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 }, { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 }, { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
  { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 }, { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 }, { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
  { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 }, { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 }, { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 }] };

/* ---- 1. the catalogue routes ------------------------------------------------ */
(function () {
  const cat = ASK.catalogue();
  check("1a. the catalogue has twelve questions (help plus eleven), each with an id, an English and a German wording and the view it reads; QUESTIONS is the same list",
    cat.length === 12 && cat.every((q) => q.id && q.ask && q.de && q.view) && cat.filter((q) => q.id === "help").length === 1 && JSON.stringify(ASK.QUESTIONS) === JSON.stringify(cat));
  check("1b. every catalogue question routes to its own answer, in English and in German", cat.every((q) => ask(q.ask).id === q.id && ask(q.de).id === q.id), cat.map((q) => q.id + ":" + ask(q.ask).id + "/" + ask(q.de).id).join(" "));
  check("1c. the matching order: a mis-pick's cost reaches mispick-cost (not cost, not quality); the error shares' origin reaches errors-source (not wait); the run's cost reaches cost; units delivered reaches summary; trailers reach inbound before OTIF",
    ask("what does a mis-pick cost").id === "mispick-cost" && ask("how much does the run cost").id === "cost" && ask("where do the error shares come from").id === "errors-source" && ask("where do units wait").id === "wait" &&
    ask("how many units were delivered").id === "summary" && ask("were the trailers on time").id === "inbound" && ask("did we deliver on time").id === "otif" && ask("Was kostet ein Fehlgriff?").id === "mispick-cost");
  const u = ask("what is the meaning of life"), none = ASK.answer("which step waits longest", { exp: null, kb: KB }), empty = ask("");
  check("1d. an unknown question is unanswered and returns the catalogue (never a guess); no run loaded is said; an empty question is the catalogue, not unanswered",
    u.unanswered === true && u.id === "help" && /I cannot answer that from the ledger/.test(u.text) && u.catalogue.length === 12 && none.id === "no-run" && none.unanswered === true && /No run is loaded yet/.test(none.text) && empty.id === "help" && empty.unanswered === false);
})();

/* ---- 2. hand answers on fixture A ------------------------------------------ */
(function () {
  const w = ask("which step waits longest");
  check("2a. the longest wait on fixture A: stg for putaway, 122.4 ticks on average over 23 waits, the longest 206, 18 still waiting; next stg for replen at 50 over 2; read from v_station_wait (6 rows)",
    w.id === "wait" && w.numbers.location === "stg" && w.numbers.op === "putaway" && w.numbers.avg_wait_ticks === 122.4 && w.numbers.waits === 23 && w.numbers.max_wait_ticks === 206 && /18 still waiting/.test(w.text) && /Next: stg for replen at 50 ticks over 2 waits/.test(w.text) &&
    w.read[0].view === "v_station_wait" && w.read[0].rows.length === 6 && w.read[0].rows[0].location === "stg", w.text.slice(0, 120));
  const s = ask("how many units were delivered");
  check("2b. the summary: 39 units, 157 events, 300 ticks, 8 delivered - 2461 eaches, 6 pallets, 3 parcels (v_run_summary)",
    s.id === "summary" && /^39 handling units and 157 events in 300 ticks \(300 min\): 8 delivered - 2461 eaches, 6 pallets, 3 parcels/.test(s.text) && s.read[0].view === "v_run_summary" && s.read[0].rows[0].delivered_eaches === 2461);
  const c = ask("how long does an order take");
  check("2c. the cycle times: case-pick 259 over 1 of 8; cross-dock 107 over 3 of 5; returns 116 over 3 of 4 (min 80, max 134); one minute per tick",
    c.id === "cycle" && /case-pick 259 ticks on average over 1 of 8 units \(min 259, max 259\)/.test(c.text) && /cross-dock 107 ticks on average over 3 of 5 units/.test(c.text) && /returns 116 ticks on average over 3 of 4 units \(min 80, max 134\)/.test(c.text) && /1 minute per tick/.test(c.text) && c.read[0].rows.length === 7);
  const o = ask("why did otif fall");
  check("2d. OTIF on fixture A: not measured (no carrier windows), the target 0.95 named with its knowledge-base source (a commonly quoted target, not a standard); v_otif read with 0 rows",
    o.id === "otif" && /OTIF was not measured in this run: it ran without carrier windows/.test(o.text) && /delivery\.otif\.target = 0\.95 share \(teaching value - A commonly quoted OTIF target/.test(o.text) && o.read[0].view === "v_otif" && o.read[0].rows.length === 0 && o.sources[0].id === "delivery.otif.target" && o.sources[0].measured === false);
  const t = ask("what did the tower propose");
  check("2e. the tower on fixture A: no decision recorded, nothing acts on its own; v_control read with 0 rows", t.id === "tower" && /No decision is recorded in this run/.test(t.text) && /Nothing acts on its own/.test(t.text) && t.read[0].view === "v_control" && t.read[0].rows.length === 0);
  const q = ask("what is the first pass yield");
  check("2f. quality on fixture A: first pass yield 1 at every one of 20 operations, no error what-if ran; the three error shares as sources", q.id === "quality" && /First pass yield 1 at every operation \(20 operations with units through\): no error what-if ran/.test(q.text) && q.read[0].rows.length === 20 && q.sources.length === 3 && q.sources.every((x) => /teaching value/.test(x.source)));
  const m = ask("what does a mis-pick cost");
  check("2g. a mis-pick's cost on fixture A: the pick face (face, carton-flow) serves in 50 ticks with labour at 35 EUR/h -> 50 x 1/60 x 35 = 29.17 EUR per reworked unit; no error realised; the teaching share 0.02 with its HEART anchor and the recorded rates as sources",
    m.id === "mispick-cost" && /pick station \(face, carton-flow\) the service time is 50 ticks with labour and the recorded labour rate 35 EUR\/h, so the redo costs 29\.17 EUR in station labour per reworked unit/.test(m.text) && m.numbers.labour_eur_per_rework === 29.1667 && m.numbers.errors === 0 &&
    /hf\.error\.mis-pick = 0\.02 share \(teaching value - HEART/.test(m.text) && m.sources.length === 2 && m.sources[1].id === "rates.labour_per_hour" && m.sources[1].value === 35 && m.read[0].view === "v_quality_by_step" && m.read[0].rows.every((r) => /pick/.test(r.op)));
  const e = ask("where do the error shares come from");
  check("2h. the error shares' origin: the six human-factors entries with their sources, all teaching values (HEART / SPAR-H), never a person; this run did not run the what-if",
    e.id === "errors-source" && e.sources.length === 6 && e.sources.every((x) => x.measured === false) && /All are teaching values anchored on public human-reliability literature \(HEART \/ SPAR-H\)/.test(e.text) && /never to a person \(BetrVG 87\(1\)6, GDPR Art\. 88\)/.test(e.text) && /This run did not run the what-if/.test(e.text) && e.read[0].view === "knowledge base (human-factors)");
  const k = ask("what does the run cost");
  check("2i. the run's cost on fixture A: 349.74 EUR total (labour 320.83, equipment 11.75, energy 17.16), 8.97 EUR per unit, the dearest type vas at 15.38 EUR; the recorded rates as the source",
    k.id === "cost" && /The run cost 349\.74 EUR at the recorded rates: labour 320\.83 EUR, equipment 11\.75 EUR, energy 17\.16 EUR, holding 0\.00 EUR; 8\.97 EUR per handling unit/.test(k.text) && /The dearest type per unit: vas at 15\.38 EUR/.test(k.text) && k.read[0].view === "v_cost_by_type" && k.read[0].rows.length === 7 && k.sources[0].id === "rates.labour_per_hour");
  const i = ask("were the trailers late"), v = ask("is the run consistent");
  check("2j. no trailer log on fixture A (no dock windows); the run is consistent: every one of the five invariant views returns 0 rows",
    i.id === "inbound" && /No trailer log in this run/.test(i.text) && i.sources[0].id === "control.inbound.lateTicks" && v.id === "invariants" && /every one of the 5 invariant views returns 0 rows/.test(v.text) && v.read.length === 5 && v.read.every((r) => r.rows[0].violations === 0) && v.read[4].view === "v_tracking_gaps");
})();

/* ---- 3. a windowed run with errors, windows and a decided proposal ------------ */
(function () {
  const late = [0, 53, -40, 159, -4, 30, 80, 0];
  const opts = { seed: 31, mix: R.defaultMix(), errors: { "mis-pick": 0.2, psf: { timePressure: 2 } }, inbound: { periodTicks: 100, openTicks: 20, lateness: late }, outbound: { periodTicks: 120, promisedLeadTicks: 300, transit: late.map((x) => Math.max(0, 60 + x)) } };
  const plan = F.spawnPlan(FLOOR, opts), st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  const ctl = C.create({ queue: { threshold: 1, sustainTicks: 0 } });
  st.hooks = { afterTick: (s) => { L.observe(rec, s); C.observe(ctl, rec, s); } };
  let left = 1500;
  while (left > 0) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  const p = ctl.proposals[0], row = p ? C.decide(ctl, p.id, "declined", 1500) : null;
  if (row) rec.control = [Object.assign({}, row, { from_run: rec.run.id })];
  const exp = L.exportJson(rec), service = L.serviceOf(exp), inbound = L.inboundRows(exp), quality = L.qualityByStep(exp);
  const o = ask("why did otif fall", exp);
  check("3a. OTIF on the windowed run cites v_otif's own numbers (orders, delivered, OTIF orders, the share) and the target, and says on which side the misses fall",
    !!service && o.id === "otif" && o.numbers.otif === service.otif && o.numbers.delivered_orders === service.delivered_orders && o.numbers.otif_orders === service.otif_orders && o.read[0].rows[0] === service ? false :
    !!service && o.id === "otif" && o.numbers.otif === service.otif && o.numbers.delivered_orders === service.delivered_orders && JSON.stringify(o.read[0].rows[0]) === JSON.stringify(service) && o.read[1].view === "v_inbound" && o.read[1].rows.length === inbound.length &&
    new RegExp("^OTIF " + (service.otif == null ? "-" : (Math.round(service.otif * 1000) / 10) + " %") + ": " + service.otif_orders + " of " + service.delivered_orders + " delivered orders").test(o.text) && /the target is 0\.95/.test(o.text) && /(misses happened|at or above the target|nothing to compare)/.test(o.text) && o.sources.length === 2,
    o.text.slice(0, 200));
  const i = ask("were the trailers late", exp), lateCount = inbound.filter((r) => r.late_ticks > 0).length, over = inbound.filter((r) => r.late_ticks > 60).length;
  check("3b. the trailer log: the counts late / early / on time, the worst trailer, and how many are later than control.inbound.lateTicks (60)",
    i.id === "inbound" && inbound.length >= 8 && i.numbers.trailers === inbound.length && i.numbers.late === lateCount && i.numbers.over_threshold === over && new RegExp("^" + inbound.length + " trailers: " + lateCount + " arrived late").test(i.text) && /later than the tower's late threshold of 60 ticks/.test(i.text) && i.sources[0].value === 60, i.text.slice(0, 160));
  const t = ask("what did the tower propose", exp);
  check("3c. the tower: the declined queue-congestion proposal listed per rule with the last decision and the rule's threshold as the source",
    !!row && t.id === "tower" && /^queue-congestion: 1 proposal - 0 accepted, 1 declined, 0 snoozed \(first at tick \d+\)\. The last decision: declined queue-congestion at tick 1500 \(staffing -> adaptive\)/.test(t.text) && t.read[0].view === "v_control" && t.read[0].rows.length === 1 && t.read[1].rows.length === 1 && t.sources[0].id === "control.queue.sustainTicks", t.text.slice(0, 160));
  const m = ask("what does a mis-pick cost", exp), picks = quality.filter((r) => /pick/.test(r.op)), errs = picks.reduce((a, r) => a + r.errors, 0);
  check("3d. the mis-pick answer on a run with the error what-if counts the realised errors at picking and the reworked units from v_quality_by_step; the effective share 0.4 (0.2 x 2) is named by the errors-source answer",
    errs > 0 && m.numbers.errors === errs && m.numbers.reworked === picks.reduce((a, r) => a + r.reworked, 0) && new RegExp("This run: " + errs + " mis-picks \\(errors at picking\\)").test(m.text) && /mis-pick 0\.4/.test(ask("where do the error shares come from", exp).text), m.text.slice(-160));
})();

/* ---- 4. twins ----------------------------------------------------------------- */
(function () {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true, detail = [];
  for (const f of ["run-ledger.json", "run-ledger-c.json", "run-ledger-d.json"]) {
    const exp = JSON.parse(read(path.join(FIX, f))), v = RL.views(exp);
    const w = same(ASK.waitRows(exp), v.wait), c = same(ASK.cycleRows(exp), v.cycle), s = same(ASK.summaryOf(exp), v.summary), i = same(ASK.invariantsOf(exp), v.invariants);
    if (!(w && c && s && i)) { ok = false; detail.push(f + " wait " + w + " cycle " + c + " summary " + s + " invariants " + i); }
  }
  check("4a. waitRows / cycleRows / summaryOf / invariantsOf equal the viewer's computeViews rows on fixtures A, C and D (the same definitions as v_station_wait, v_cycle_time_by_type, v_run_summary and the invariant views)", ok, detail.join("; "));
})();

/* ---- 5. purity + determinism ---------------------------------------------------- */
(function () {
  const before = JSON.stringify(expA);
  const a1 = ask("which step waits longest"), a2 = ask("which step waits longest");
  const src = read("ask.js"), code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("5a. the same question twice is byte-identical; the export is not mutated; ask.js has no Date / Math.random call and no worker / roster reference; HONESTY says no language model, not a guess, nothing names a person",
    JSON.stringify(a1) === JSON.stringify(a2) && JSON.stringify(expA) === before && !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/\bworker\b|\broster\b|WT\.workers/i.test(code) &&
    /No language model is connected/.test(ASK.HONESTY) && /not a guess/.test(ASK.HONESTY) && /Nothing here names a person/.test(ASK.HONESTY) && a1.honesty === ASK.HONESTY);
  const views = Object.keys(SQL);
  const named = [];
  for (const q of ASK.catalogue()) for (const r of ask(q.ask).read || []) named.push(r.view);
  const foreign = named.filter((v) => views.indexOf(v) < 0 && !/^knowledge base|^control \(the audit\)/.test(v));
  check("5b. every view an answer names exists in the SQL bundle (run-ledger-sql.js) - or is the knowledge base or the audit", named.length >= 12 && foreign.length === 0, foreign.join(","));
  const h = ASK.html(Object.assign({}, a1, { text: "<b>x</b> & y", sources: [{ id: "k<", value: 1, unit: "u", source: "s>" }] }));
  check("5c. the html renderer escapes text, cells and sources, names the view with its row count, caps the table at eight rows and renders the catalogue as chips",
    /&lt;b&gt;x&lt;\/b&gt; &amp; y/.test(h) && /Read: <code>v_station_wait<\/code> \(6 rows\)/.test(h) && /<th scope="col">location<\/th>/.test(h) && /k&lt;/.test(h) && /s&gt;/.test(h) && !/<b>x/.test(h) &&
    (ASK.html(ask("what can i ask")).match(/ask-chip/g) || []).length === 11 && (ASK.html(ask("is the run consistent")).match(/<table>/g) || []).length === 5 && /5 more rows in the view/.test(ASK.html({ text: "t", read: [{ view: "v", rows: Array.from({ length: 13 }, (_, n) => ({ n: n })) }] })));
})();

/* ---- 6. shipped wiring ----------------------------------------------------------- */
(function () {
  const html = read("index.html"), rl = read("run-ledger.html"), app = read("app.js"), rljs = read("run-ledger.js"), st = read("selftest.js"), rlst = read("run-ledger-selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js");
  const css = read("styles.css"), rlcss = read("run-ledger.css"), readme = read("README.md"), changelog = read("CHANGELOG.md");
  check("6a. index.html loads ask.js after control.js and before app.js; the drawer has the form, the input, the chips and the output beside the trace; app.js wires it over the live run's export and exposes ask on the test API",
    html.indexOf('<script src="ask.js"></script>') > html.indexOf('<script src="control.js"></script>') && html.indexOf('<script src="ask.js"></script>') < html.indexOf('<script src="app.js"></script>') &&
    /id="flowAskForm"/.test(html) && /id="flowAsk"/.test(html) && /id="flowAskChips"/.test(html) && /id="flowAskOut"/.test(html) && /WT\.ask\.answer\(q, \{ exp: WT\.ledger\.exportJson\(state\.flow\.ledger\), kb: WT\.kb \}\)/.test(app) && /ask: \(q\) =>/.test(app) && /WT\.ask\.html\(/.test(app));
  check("6b. run-ledger.html loads domain.js + knowledge.js (the sources) and ask.js after control.js; the Ask section with its nav anchor, form and output; run-ledger.js renders it in load() and answers over the loaded export",
    /<script src="domain\.js"><\/script><script src="knowledge\.js"><\/script>/.test(rl) && rl.indexOf('<script src="ask.js"></script>') > rl.indexOf('<script src="control.js"></script>') && rl.indexOf('<script src="ask.js"></script>') < rl.indexOf('<script src="run-ledger.js"></script>') &&
    /id="secAsk"/.test(rl) && /href="#secAsk"/.test(rl) && /id="rlAskForm"/.test(rl) && /id="rlAskOut"/.test(rl) && /function renderAsk\(exp\)/.test(rljs) && /renderAsk\(exp\)/.test(rljs.slice(rljs.indexOf("function load(exp)"))) && /ASK\.answer\(q, \{ exp: EXP, kb: window\.WT && window\.WT\.kb \}\)/.test(rljs));
  check("6c. both self-tests, run-all, sw.js precaches ask.js at wt-v140 (previously wt-v139), the styles, README and CHANGELOG name v3.60, docs/ASK_THE_LEDGER.md exists",
    /ask-the-ledger-deterministic/.test(st) && /ask-section-answers-on-example-a/.test(rlst) && /"rlAskOut"/.test(rlst) && /verify_ask\.js/.test(runall) && /"\.\/ask\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v140"/.test(sw) && /Previously wt-v139/.test(sw) &&
    /\.ask-chip/.test(css) && /\.ask-chip/.test(rlcss) && /v3\.60/.test(readme) && /## v3\.60/.test(changelog) && fs.existsSync(path.join(__dirname, "docs", "ASK_THE_LEDGER.md")));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL ASK-THE-LEDGER CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
