/* =====================================================================
 * Logistics Flow Studio - verify_people.js
 * v3.66 LEARNING AND FATIGUE, DECLARED - headless verification
 * ---------------------------------------------------------------------
 * people.js adds the two human-factors effects the deep dive's gap 11 named
 * as documented-only: a learning curve on a step's own units and a fatigue
 * uplift on the minutes since the last break. Both are declared, both belong
 * to a STEP and a SHIFT, neither may be keyed to a person. It must prove:
 *   1. THE CURVES BY HAND: Wright's rate in Crawford's unit-time form (at
 *      0.9 the second unit takes 0.9, the fourth 0.81, the eighth 0.729);
 *      the floor that stops the curve; the fatigue uplift (1 at a break,
 *      1.0375 after an hour, 1.075 after two, 1.15 at the four-hour peak and
 *      flat after it); the break clock that resets and reads zero through the
 *      break; the two multiplied and the service RATE scaled by the
 *      reciprocal; and what normalise() clamps.
 *   2. THE RUN: without the what-if the plan has no key, no station carries
 *      a count and the hand floor still records fixture A's own run id; with
 *      it the id changes, the block is recorded with its sources, the
 *      stations count their own units, and two identical runs agree.
 *   3. THE DIRECTIONS on the hand floor at 1200 ticks, seed 31: 56 units
 *      shipped without the curves, 61 with learning alone (rate 0.9, no
 *      fatigue), 55 with fatigue alone (no learning, 15 %), 58 with both -
 *      learning never below the baseline, fatigue never above it.
 *   4. THE RUN ID: the curves are a run input, so two different rates give
 *      two different ids and the same curves give the same one.
 *   5. HUMAN + PURE: no Date, no Math.random, no worker or roster anywhere
 *      in the module; the honesty names step-and-shift, the staggered break,
 *      the count that resets every run, BetrVG and GDPR; the knowledge
 *      base's six seeds equal the module's defaults.
 *   6. SHIPPED WIRING: the script, the picker, the build option, the
 *      readout, the service worker, run-all, the self-test, the docs.
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "knowledge.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "people.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT, P = WT.people, F = WT.flowsim, R = WT.routing, L = WT.ledger, PK = WT.pack, AN = WT.analytics, KB = WT.kb, I = WT.ids;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const FLOOR = { gridW: 40, gridH: 24, cell: 1, elements: [
  { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 }, { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 }, { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
  { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 }, { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 }, { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
  { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 }, { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 }, { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
  { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 }, { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 }, { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 }] };
const MIX = R.defaultMix();
function record(opts, ticks) {
  const plan = F.spawnPlan(FLOOR, opts);
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: MIX, layout: FLOOR, profile: PK.PROFILES.ecommerce, rates: AN.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  let left = ticks || 600;
  while (left > 0) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  return { plan: plan, st: st, rec: rec, exp: L.exportJson(rec) };
}

/* ---- 1. the curves by hand -------------------------------------------------- */
(function () {
  const nine = P.normalise({ learning: { rate: 0.9, floor: 0.1 } });
  check("1a. Wright's rate in Crawford's unit-time form: with a learning rate of 0.9 the first unit costs 1, the second 0.9, the fourth 0.81 and the eighth 0.729 - each doubling of a station's cumulative units multiplies the unit time by the rate; the exponent is log2(rate)",
    nine.learning.exponent === -0.152003 && P.learningFactor(1, nine.learning) === 1 && P.learningFactor(2, nine.learning) === 0.9 && P.learningFactor(4, nine.learning) === 0.81 &&
    P.learningFactor(8, nine.learning) === 0.729 && P.learningFactor(16, nine.learning) === 0.6561 && P.learningFactor(3, nine.learning) === 0.846206,
    [1, 2, 4, 8, 16].map((n) => P.learningFactor(n, nine.learning)).join(" "));
  const d = P.normalise(true);
  check("1b. the floor stops the curve where a bench stops improving: at the default rate of 0.95 the hundredth unit costs 0.71121 and the thousandth would fall below the floor of 0.7, so it reads 0.7; a rate of 1 never improves and a floor of 1 forbids improvement",
    d.learning.rate === 0.95 && d.learning.floor === 0.7 && P.learningFactor(100, d.learning) === 0.71121 && P.learningFactor(1000, d.learning) === 0.7 && P.learningFactor(1e6, d.learning) === 0.7 &&
    P.learningFactor(50, P.normalise({ learning: { rate: 1 } }).learning) === 1 && P.learningFactor(50, P.normalise({ learning: { rate: 0.8, floor: 1 } }).learning) === 1);
  check("1c. the fatigue uplift: 1 at a break, 1.0375 after an hour, 1.075 after two, the full 1.15 at the four-hour peak and flat beyond it; an uplift of 0 is no fatigue at all",
    P.fatigueFactor(0, d.fatigue) === 1 && P.fatigueFactor(60, d.fatigue) === 1.0375 && P.fatigueFactor(120, d.fatigue) === 1.075 && P.fatigueFactor(240, d.fatigue) === 1.15 &&
    P.fatigueFactor(480, d.fatigue) === 1.15 && d.fatigue.maxUplift === 0.15 && d.fatigue.toPeakMinutes === 240 && P.fatigueFactor(200, P.normalise({ fatigue: { maxUplift: 0 } }).fatigue) === 1);
  check("1d. the break clock (breaks assumed staggered: it resets the clock, it does not stop the bench): minutes 0 to 119 count up, the fifteen minutes of the break read zero, and minute 135 starts the next block - so the uplift never passes 1.075 under the default rhythm",
    P.minutesSinceBreak(0, d.fatigue) === 0 && P.minutesSinceBreak(60, d.fatigue) === 60 && P.minutesSinceBreak(119, d.fatigue) === 119 && P.minutesSinceBreak(120, d.fatigue) === 0 &&
    P.minutesSinceBreak(134, d.fatigue) === 0 && P.minutesSinceBreak(135, d.fatigue) === 0 && P.minutesSinceBreak(136, d.fatigue) === 1 && P.minutesSinceBreak(255, d.fatigue) === 0 &&
    P.fatigueFactor(P.minutesSinceBreak(119, d.fatigue), d.fatigue) === 1.074375 && P.minutesSinceBreak(300, P.normalise({ fatigue: { breakMinutes: 0, breakEveryMinutes: 120 } }).fatigue) === 60);
  const f = P.serviceFactor(4, 60, P.normalise({ learning: { rate: 0.9, floor: 0.1 } }));
  check("1e. the two curves multiply and the service RATE is scaled by the reciprocal: the fourth unit an hour into a block costs 0.81 x 1.0375 = 0.840375 of nominal, so the bench serves 1.189945 times as fast; without a block every factor is 1",
    f.learning === 0.81 && f.fatigue === 1.0375 && f.multiplier === 0.840375 && f.factor === 1.189945 && f.minutes_since_break === 60 &&
    JSON.stringify(P.serviceFactor(4, 60, null)) === JSON.stringify({ learning: 1, fatigue: 1, multiplier: 1, factor: 1, minutes_since_break: null }));
  const clamped = P.normalise({ learning: { rate: 2, floor: 0 }, fatigue: { maxUplift: -1, toPeakMinutes: 0, breakEveryMinutes: -5, breakMinutes: -3 } });
  check("1f. normalise clamps what a person can type and falls back to the defaults for the rest: a rate above 1 becomes 1, below 0.5 becomes 0.5, a floor of 0 is not a floor at all and takes the default, a floor of 0.05 clamps to 0.1, a negative uplift and a zero peak take the defaults; `true` means the defaults; anything falsy means no block",
    clamped.learning.rate === 1 && clamped.learning.floor === 0.7 && P.normalise({ learning: { floor: 0.05 } }).learning.floor === 0.1 && P.normalise({ learning: { rate: 0.1 } }).learning.rate === 0.5 && clamped.fatigue.maxUplift === 0.15 &&
    clamped.fatigue.toPeakMinutes === 240 && clamped.fatigue.breakEveryMinutes === 120 && clamped.fatigue.breakMinutes === 15 && P.normalise(true).kind === "declared-curves" &&
    P.normalise(false) === null && P.normalise(null) === null && P.block(null) === null);
})();

/* ---- 2. the run ------------------------------------------------------------- */
(function () {
  const a = record({ seed: 31, mix: MIX }, 600), b = record({ seed: 31, mix: MIX, people: true }, 600);
  const a2 = record({ seed: 31, mix: MIX }, 600), b2 = record({ seed: 31, mix: MIX, people: true }, 600);
  check("2a. without the what-if nothing moves: the plan carries no people key, no station carries a count, and the hand floor still records fixture A's own run id - the same bytes as every release before this one",
    !("people" in a.plan) && !a.st.stations.some((s) => Object.prototype.hasOwnProperty.call(s, "served")) && a.exp.run.id === "RUN-hand-built-s31-hc28a7688" &&
    !a.exp.run.people && JSON.stringify(a.exp) === JSON.stringify(a2.exp));
  check("2b. with it: the plan carries the normalised curves, the run id changes, the ledger records the block with Wright's and the rest-allowance sources, each station counts ITS OWN units, and two identical runs agree byte for byte",
    b.plan.people.kind === "declared-curves" && b.exp.run.id !== a.exp.run.id && b.exp.run.people.learning.rate === 0.95 && b.exp.run.people.learning.exponent === -0.074001 &&
    /Wright, T\. P\. \(1936\)/.test(b.exp.run.people.learning.source) && /rest allowance/.test(b.exp.run.people.fatigue.source) && b.exp.run.people.honesty === P.HONESTY &&
    b.st.stations.every((s) => typeof s.served === "number") && b.st.stations.reduce((x, s) => x + s.served, 0) > 0 && JSON.stringify(b.exp) === JSON.stringify(b2.exp),
    b.st.stations.map((s) => s.id + ":" + s.served).join(" "));
})();

/* ---- 3. the directions ------------------------------------------------------- */
(function () {
  const ticks = 1200;
  const base = record({ seed: 31, mix: MIX }, ticks);
  const learn = record({ seed: 31, mix: MIX, people: { learning: { rate: 0.9 }, fatigue: { maxUplift: 0 } } }, ticks);
  const tire = record({ seed: 31, mix: MIX, people: { learning: { rate: 1 }, fatigue: { maxUplift: 0.15 } } }, ticks);
  const both = record({ seed: 31, mix: MIX, people: true }, ticks);
  check("3a. on the hand floor over 1200 ticks at seed 31: 56 units shipped with no curves, 61 with learning alone, 55 with fatigue alone and 58 with both - a bench that learns ships more, a bench that tires ships fewer, and the two together land between them",
    base.st.completed === 56 && learn.st.completed === 61 && tire.st.completed === 55 && both.st.completed === 58 &&
    learn.st.completed > base.st.completed && tire.st.completed < base.st.completed && both.st.completed > tire.st.completed && both.st.completed < learn.st.completed,
    [base.st.completed, learn.st.completed, tire.st.completed, both.st.completed].join(" / "));
  check("3b. the counts follow: a learning bench gets through more of its own units than a tiring one at every station, and the conservation the simulation has always kept still holds with the curves on (spawned = in flight + completed)",
    learn.st.stations.every((s, i) => s.served >= tire.st.stations[i].served) && learn.st.stations[0].served === 32 && tire.st.stations[0].served === 23 &&
    both.st.spawned === both.st.inflight + both.st.completed && learn.st.spawned === learn.st.inflight + learn.st.completed,
    "learning " + learn.st.stations.map((s) => s.served).join(",") + " vs fatigue " + tire.st.stations.map((s) => s.served).join(","));
})();

/* ---- 4. the run id ----------------------------------------------------------- */
(function () {
  const p1 = P.normalise({ learning: { rate: 0.9 } }), p2 = P.normalise({ learning: { rate: 0.8 } });
  const h = (people) => I.inputHash(FLOOR, 31, MIX, null, null, null, null, null, people);
  check("4a. the curves are a run input: two different learning rates hash to two different ids, the same curves hash to the same one, and no block hashes exactly as every run before v3.66 did",
    h(p1) !== h(p2) && h(p1) === h(P.normalise({ learning: { rate: 0.9 } })) && h(null) === I.inputHash(FLOOR, 31, MIX, null, null, null, null, null) &&
    I.runId("hand-built", 31, FLOOR, MIX, null, null, null, null, null, p1) !== I.runId("hand-built", 31, FLOOR, MIX, null, null, null, null, null, p2));
})();

/* ---- 5. human + pure --------------------------------------------------------- */
(function () {
  const src = read("people.js"), code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("5a. people.js has no Date, no Math.random and no worker, roster or WT.workers reference: the curves belong to a step and a shift, and there is nothing per person to read",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/\bworker\b|\broster\b|WT\.workers/i.test(code.replace(/workforce/g, "")));
  check("5b. the honesty says what it is and is not: declared curves on a step and a shift, never on a person, with BetrVG and GDPR named; the learning count is the station's and resets every run; the break is staggered - it resets the clock without stopping the bench; no turnover, no skill mix",
    /never on a person/.test(P.HONESTY) && /keyed to a person/.test(P.HONESTY) && /BetrVG 87\(1\)6, GDPR Art\. 88/.test(P.HONESTY) && /does not model a\s+workforce|it does not model a workforce/.test(P.HONESTY.replace(/\s+/g, " ")) &&
    /assumed staggered/.test(P.HONESTY) && /no turnover, no skill mix/.test(P.HONESTY) && /teaching values with their sources/.test(P.HONESTY));
  const ids = ["people.learning.rate", "people.learning.floor", "people.fatigue.maxUplift", "people.fatigue.toPeakMinutes", "people.fatigue.breakEveryMinutes", "people.fatigue.breakMinutes"];
  check("5c. the knowledge base's six seeds are the module's own defaults, in their own category, each saying it is per step and per shift and never per person; the sources name Wright and the work-study rest allowance",
    KB.list("people").map((e) => e.id).join(",") === ids.join(",") && KB.get("people.learning.rate") === P.DEFAULTS.learning.rate && KB.get("people.learning.floor") === P.DEFAULTS.learning.floor &&
    KB.get("people.fatigue.maxUplift") === P.DEFAULTS.fatigue.maxUplift && KB.get("people.fatigue.toPeakMinutes") === P.DEFAULTS.fatigue.toPeakMinutes &&
    KB.get("people.fatigue.breakEveryMinutes") === P.DEFAULTS.fatigue.breakEveryMinutes && KB.get("people.fatigue.breakMinutes") === P.DEFAULTS.fatigue.breakMinutes &&
    KB.list("people").every((e) => /never (on|per) a person|never per person/.test(e.note) || /never on a person/.test(e.note)) &&
    /Wright \(1936\)/.test(KB.entry("people.learning.rate").source) && /rest allowance/.test(KB.entry("people.fatigue.maxUplift").source) &&
    /never per person/.test((KB.categories.find((c) => c.key === "people") || {}).desc || ""));
})();

/* ---- 6. shipped wiring -------------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), flow = read("flowsim.js"), sw = read("sw.js"), runall = read("test/run-all.mjs"), st = read("selftest.js");
  const readme = read("README.md"), changelog = read("CHANGELOG.md");
  check("6a. index.html loads people.js before app.js and offers the picker with its two options and the hint that names the step-and-shift rule; sw.js precaches it at wt-v146 (previously wt-v145); run-all lists this harness",
    html.indexOf('<script src="people.js"></script>') > 0 && html.indexOf('<script src="people.js"></script>') < html.indexOf('<script src="app.js"></script>') &&
    /id="flowPeopleSelect"/.test(html) && /Benches never learn and never tire/.test(html) && /never to a person/.test(html) && /"\.\/people\.js"/.test(sw) &&
    /CACHE_VERSION\s*=\s*"wt-v146"/.test(sw) && /Previously wt-v145/.test(sw) && /verify_people\.js/.test(runall));
  check("6b. flowsim applies the factor to the service rate only when the plan carries the curves, counts each station's own units, and keys the plan only then; app.js reads the six knowledge-base values, passes them as opts.people and shows what the curves are doing per bench",
    /const people = o\.people && WT\.people/.test(flow) && /if \(people\) plan\.people = people;/.test(flow) && /perTick \*= WT\.people\.serviceFactor\(\(st\.served \|\| 0\) \+ 1, peopleMinute, plan\.people\)\.factor;/.test(flow) &&
    /if \(plan\.people\) st\.served = \(st\.served \|\| 0\) \+ 1;/.test(flow) && /function readPeopleLevers\(/.test(app) && /opts\.people = readPeopleLevers\(\)/.test(app) &&
    /Learning &amp; fatigue \(declared curves, per bench - never per person\)/.test(app) && /wirePeople/.test(app));
  check("6c. the self-test drives the picker, README and CHANGELOG name v3.66, and docs/PEOPLE_CURVES.md states the curves and their limits",
    /learning-and-fatigue-curves/.test(st) && /v3\.66/.test(readme) && /## v3\.66/.test(changelog) && fs.existsSync(path.join(__dirname, "docs", "PEOPLE_CURVES.md")) &&
    /Crawford/.test(read(path.join("docs", "PEOPLE_CURVES.md"))) && /staggered/.test(read(path.join("docs", "PEOPLE_CURVES.md"))));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL PEOPLE-CURVE CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
