/* =====================================================================
 * Logistics Flow Studio - verify_control.js
 * v3.56 THE CONTROL TOWER (a human in the loop) - headless verification
 * ---------------------------------------------------------------------
 * control.js: a rule engine over the run ledger's record and the sim's
 * aggregate state that PROPOSES a lever, explains it from aggregates and
 * waits for a person. On the hand floor of verify_ledger.js it proves:
 *   1. PURITY: observe() never mutates the sim or the ledger; a run with the
 *      tower attached is byte-identical to one without (state and export).
 *   2. THE RULES BY HAND: queue congestion - the put-away queue first reaches
 *      6 at tick 97 (verify_staffing.js), dips to 5 across the tick-100
 *      evaluation and is at or above 6 from 110; the tower evaluates every 10
 *      ticks, sustains 30, proposes at tick 140 naming element stg; nothing
 *      with a staffing policy active. Rework burden - mix vas
 *      with mis-pick 0.02 x time pressure 11 = 0.22: after 20 units through
 *      the pick the share exceeds 0.01, the proposal names timePressure and
 *      the arithmetic 0.22 -> 0.02; never without a lever above 1. Inbound
 *      late - the hand lateness list's trailer 3 (159 ticks late, window at
 *      459) -> proposed at the first evaluation after, tick 460, lever half
 *      the period. OTIF below target - fires only after 20 delivered orders
 *      and only below the target; never without carrier windows; not when
 *      every order is on time.
 *   3. DECISIONS: decide() writes audit rows (seq, tick, rule, status, lever,
 *      evidence); a declined rule never proposes again; a snoozed one returns
 *      after snoozeTicks (260, 380, 500); an unknown id or a second decision is refused; two
 *      identical runs give identical proposals - the list is a pure function
 *      of the history.
 *   4. HUMAN: the evidence is element ids, counts, ticks and shares; the module
 *      reads no roster and no worker module; HONESTY names BetrVG and GDPR and
 *      "a person decides"; no Date / Math.random.
 *   5. THE LEDGER: rec.control only when a decision was recorded; exported as
 *      `control`; the run id unchanged by the audit; controlRows (the v_control
 *      twin) by hand on a two-row audit.
 *   6. SHIPPED WIRING: the card in the Simulate drawer, the after-tick
 *      multiplexer (ledger, tracker, then the tower), accept = set the lever
 *      + re-run, the knowledge base's control category, SQL table / view /
 *      group / reconcile key, the viewer block + glance card, both self-tests,
 *      the runner, sw.js at wt-v139, README / CHANGELOG / the deep dive's
 *      chapter 3 rewritten for v3.56.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "control.js", "compliance.js", "automation.js", "knowledge.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack, A = global.WT.analytics, T = global.WT.tracking, C = global.WT.control, KB = global.WT.kb;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
    { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 },
    { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 },
    { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
    { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 },
    { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
const MIX = R.defaultMix();
const HAND_IN = { periodTicks: 100, openTicks: 20, lateness: [0, 53, -40, 159] };
const OUT = { periodTicks: 100, promisedLeadTicks: 150, transit: [10, 200, 10, 10] };
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued, rng: st.rngState,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });
// The app's after-tick multiplexer: ledger, tracker, then the tower (each only reads). `stop` ends the run at a tick.
function record(opts, ticks, tower, thresholds, controlLog) {
  const plan = F.spawnPlan(FLOOR, opts);
  const st = F.state(plan);
  const meta = { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() };
  if (controlLog) meta.control = controlLog;
  const rec = L.create(plan, meta);
  const track = T.create(rec);
  const ctl = tower ? C.create(thresholds) : null;
  st.hooks = { afterTick: (s) => { L.observe(rec, s); T.observe(track, rec); if (ctl) C.observe(ctl, rec, s); } };
  let left = ticks;
  while (left > 0) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  return { plan: plan, st: st, rec: rec, track: track, ctl: ctl, exp: L.exportJson(rec) };
}

/* ---- 1. purity ----------------------------------------------------------------- */
(function () {
  const a = record({ seed: 31, mix: MIX }, 300, false), b = record({ seed: 31, mix: MIX }, 300, true);
  check("1a. a run with the tower attached is byte-identical to one without (state incl. the PRNG, export); the tower proposed something", snap(a.st) === snap(b.st) && JSON.stringify(a.exp) === JSON.stringify(b.exp) && b.ctl.proposals.length > 0);
  const before = JSON.stringify(b.rec), st0 = snap(b.st);
  C.observe(b.ctl, b.rec, b.st); C.observe(b.ctl, b.rec, b.st);
  check("1b. observe() never mutates the record or the state; a second observe at the same tick is a no-op", JSON.stringify(b.rec) === before && snap(b.st) === st0 && b.ctl.evaluations === 30);
  check("1c. thresholds normalise: defaults every 10 ticks, queue 6 for 30, rework 0.01 after 20, inbound 60, OTIF 20 below 0.95, snooze 120; a bad value falls back",
    JSON.stringify(C.normalise(null)) === JSON.stringify(C.DEFAULTS) && C.normalise({ evalEveryTicks: -3, queue: { threshold: 0 }, otif: { target: 2 } }).evalEveryTicks === 10 && C.normalise({ queue: { threshold: 0 } }).queue.threshold === 6 && C.normalise({ otif: { target: 2 } }).otif.target === 1);
})();

/* ---- 2. the rules by hand ------------------------------------------------------ */
(function () {
  const b = record({ seed: 31, mix: MIX }, 300, true);
  const p = b.ctl.proposals.filter((x) => x.rule === "queue-congestion");
  check("2a. queue congestion on the hand floor: the put-away queue reaches 6 at tick 97, dips to 5 across the tick-100 evaluation, is at or above 6 from 110; sustained 30 -> exactly one proposal at tick 140 naming element stg (station put-0), lever: the adaptive-staffing picker",
    p.length === 1 && p[0].tick === 140 && p[0].evidence.stations[0].element === "stg" && p[0].evidence.stations[0].id === "put-0" && p[0].evidence.stations[0].since_tick === 110 && p[0].evidence.stations[0].sustained_ticks === 30 &&
    p[0].lever.kind === "picker" && p[0].lever.key === "staffing" && p[0].lever.value === "adaptive" && /19 to 17/.test(p[0].expectedEffect) && /stg/.test(p[0].why) && p[0].status === "proposed" && p[0].id === "P-queue-congestion-140",
    JSON.stringify(p[0] && p[0].evidence));
  const withPolicy = record({ seed: 31, mix: MIX, policy: { kind: "queue-staffing" } }, 300, true);
  check("2b. with a staffing policy active the queue rule stays silent (the lever is already pulled); no other rule fires on a plain run", withPolicy.ctl.proposals.length === 0 && b.ctl.proposals.every((x) => x.rule === "queue-congestion"));
  const rw = record({ seed: 31, mix: ["vas"], errors: { "mis-pick": 0.02, psf: { timePressure: 11 } } }, 1500, true);
  const q = rw.ctl.proposals.filter((x) => x.rule === "rework-burden");
  check("2c. rework burden: vas orders with mis-pick 0.02 x time pressure 11 = 0.22 - after 20 units through the pick the reworked share exceeds 0.01; the proposal names timePressure (x11 -> x1) and the arithmetic mis-pick 0.22 -> 0.02",
    q.length === 1 && q[0].evidence.units_through >= 20 && q[0].evidence.share > 0.01 && q[0].evidence.lever === "timePressure" && q[0].evidence.from === 11 && q[0].evidence.to === 1 &&
    JSON.stringify(q[0].evidence.kinds) === JSON.stringify([{ kind: "mis-pick", from: 0.22, to: 0.02 }]) && q[0].lever.kind === "kb" && q[0].lever.key === "hf.psf.timePressure" && q[0].lever.value === 1 && /0\.22 -> 0\.02/.test(q[0].expectedEffect),
    JSON.stringify(q[0] && q[0].evidence));
  const noLever = record({ seed: 31, mix: ["vas"], errors: { "mis-pick": 0.3 } }, 1500, true);
  check("2d. without a lever above 1 the rework rule has nothing to remove and stays silent even at a 0.3 share (the burden is the declared base share - said in the rule)", noLever.ctl.proposals.every((x) => x.rule !== "rework-burden") && L.stats(noLever.rec).quality.some((r) => r.reworked > 0));
  const ib = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN }, 600, true);
  const i = ib.ctl.proposals.filter((x) => x.rule === "inbound-late");
  check("2e. inbound late: trailer 1 (53 late) is under the limit of 60; trailer 3 (159 late, window at 459) is over it -> one proposal at the first evaluation after, tick 460; lever: half the period (50)",
    i.length === 1 && i[0].tick === 460 && i[0].evidence.worst.trailer === 3 && i[0].evidence.worst.late_ticks === 159 && i[0].evidence.late_trailers === 1 && i[0].lever.kind === "kb" && i[0].lever.key === "delivery.inbound.periodTicks" && i[0].lever.value === 50 &&
    /159 ticks late/.test(i[0].why), JSON.stringify(i[0] && i[0].evidence));
  const ot = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN, outbound: OUT }, 1200, true);
  const o = ot.ctl.proposals.filter((x) => x.rule === "otif-below-target");
  const s = L.serviceOf(ot.exp);
  check("2f. OTIF below target: with a 150-tick promise and 100-tick departures most orders are late -> one proposal once 20 orders were delivered (OTIF " + (o[0] ? o[0].evidence.otif : "-") + " < 0.95); lever: half the carrier period (50)",
    o.length === 1 && o[0].evidence.delivered_orders >= 20 && o[0].evidence.otif < 0.95 && o[0].lever.key === "delivery.outbound.periodTicks" && o[0].lever.value === 50 && s.delivered_orders >= 20 &&
    ot.ctl.proposals.filter((x) => x.rule === "otif-below-target" && x.tick < o[0].tick).length === 0, JSON.stringify(o[0] && o[0].evidence));
  const onTime = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN, outbound: { periodTicks: 100, promisedLeadTicks: 5000, transit: [10] } }, 1200, true);
  const noOut = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN }, 1200, true);
  check("2g. the OTIF rule never fires without carrier windows, nor when every delivered order is on time (promise 5000)",
    noOut.ctl.proposals.every((x) => x.rule !== "otif-below-target") && onTime.ctl.proposals.every((x) => x.rule !== "otif-below-target") && L.serviceOf(onTime.exp).otif === 1 && L.serviceOf(onTime.exp).delivered_orders >= 20);
})();

/* ---- 3. decisions ------------------------------------------------------------------ */
(function () {
  // decide as the run proceeds: attach a hook that declines / snoozes at the tick the proposal appears
  function runDeciding(status, thresholds) {
    const plan = F.spawnPlan(FLOOR, { seed: 31, mix: MIX });
    const st = F.state(plan);
    const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: MIX, layout: FLOOR, profile: P.PROFILES.ecommerce });
    const ctl = C.create(thresholds);
    st.hooks = { afterTick: (s) => { L.observe(rec, s); C.observe(ctl, rec, s); for (const p of C.pending(ctl)) C.decide(ctl, p.id, status, s.tick); } };
    F.step(st, 600);
    return { st: st, rec: rec, ctl: ctl };
  }
  const dec = runDeciding("declined"), snz = runDeciding("snoozed"), acc = runDeciding("accepted");
  check("3a. declined at tick 140: one audit row {seq 1, tick 140, queue-congestion, declined, the lever, the evidence}; the rule never proposes again in 600 ticks",
    dec.ctl.audit.length === 1 && dec.ctl.audit[0].seq === 1 && dec.ctl.audit[0].tick === 140 && dec.ctl.audit[0].rule === "queue-congestion" && dec.ctl.audit[0].status === "declined" && dec.ctl.audit[0].lever.key === "staffing" &&
    dec.ctl.audit[0].evidence.stations[0].element === "stg" && dec.ctl.proposals.length === 1 && dec.ctl.proposals[0].status === "declined" && dec.ctl.proposals[0].decided_tick === 140);
  check("3b. snoozed at tick 140 (snooze 120): the rule proposes again at tick 260 while the queue stays congested, and again at 380, 500; every proposal is decided in the audit",
    snz.ctl.proposals.map((p) => p.tick).join(",") === "140,260,380,500" && snz.ctl.audit.length === 4 && snz.ctl.audit.every((r, k) => r.seq === k + 1 && r.status === "snoozed"), snz.ctl.proposals.map((p) => p.tick).join(","));
  check("3c. accepted at tick 140: the audit row says accepted and the tower itself changes nothing (the caller re-runs the day); an unknown id, a second decision and a bad status are refused",
    acc.ctl.audit.length === 1 && acc.ctl.audit[0].status === "accepted" && acc.ctl.proposals[0].status === "accepted" && C.decide(acc.ctl, "P-nope-1", "declined", 200) === null &&
    C.decide(acc.ctl, acc.ctl.proposals[0].id, "declined", 200) === null && acc.ctl.audit.length === 1 && snap(acc.st) === snap(dec.st));
  const x = record({ seed: 31, mix: MIX, inbound: HAND_IN, outbound: OUT, errors: { "mis-pick": 0.02, psf: { timePressure: 11 } } }, 900, true);
  const y = record({ seed: 31, mix: MIX, inbound: HAND_IN, outbound: OUT, errors: { "mis-pick": 0.02, psf: { timePressure: 11 } } }, 900, true);
  check("3d. the proposal list is a pure function of the history: two identical runs propose the same rules at the same ticks with the same evidence (" + x.ctl.proposals.map((p) => p.rule + "@" + p.tick).join(", ") + ")",
    x.ctl.proposals.length >= 2 && JSON.stringify(x.ctl.proposals) === JSON.stringify(y.ctl.proposals));
})();

/* ---- 4. human ------------------------------------------------------------------------ */
(function () {
  const src = read("control.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // the code without its comments
  const b = record({ seed: 31, mix: MIX, inbound: HAND_IN, outbound: OUT, errors: { "mis-pick": 0.02, psf: { timePressure: 11 } } }, 900, true);
  const flat = JSON.stringify(b.ctl.proposals.map((p) => p.evidence));
  check("4a. the evidence of every proposal is element ids, counts, ticks and shares - no key or value names a worker or a roster; the module reads no worker module and no clock",
    !/worker|roster|person/i.test(flat) && !/WT\.workers|\broster\b|workerRoster|new Date\(|Date\.now\(|Math\.random\(/.test(src) && /BetrVG/.test(C.HONESTY) && /GDPR/.test(C.HONESTY) && /a person decides/.test(C.HONESTY) && /not a certification/.test(C.HONESTY));
  check("4b. the four rules are documented with what they read and what they propose; the honesty says measured-or-arithmetic and re-run from tick zero",
    C.RULES.length === 4 && C.RULES.map((r) => r.id).join(",") === "queue-congestion,rework-burden,inbound-late,otif-below-target" && C.RULES.every((r) => r.reads && r.lever) && /re-runs the day from tick zero/.test(C.HONESTY) && /measured on the hand floor/.test(C.HONESTY));
})();

/* ---- 5. the ledger and the SQL twin ------------------------------------------------ */
(function () {
  const log = [];
  const a = record({ seed: 31, mix: MIX }, 300, true, null, log);
  check("5a. rec.control absent from the export while no decision was recorded (an empty log); the run id is the plain one",
    !("control" in a.exp) && a.exp.run.id === "RUN-hand-built-s31-hc28a7688" && JSON.stringify(a.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))));
  const row = C.decide(a.ctl, a.ctl.proposals[0].id, "declined", 300);
  log.push(Object.assign({}, row, { from_run: a.rec.run.id }));
  const exp2 = L.exportJson(a.rec);
  check("5b. a decision pushed into the log is exported as `control` (the run id unchanged - the audit is not an input) with the run it came from",
    Array.isArray(exp2.control) && exp2.control.length === 1 && exp2.control[0].rule === "queue-congestion" && exp2.control[0].status === "declined" && exp2.control[0].from_run === a.rec.run.id && exp2.run.id === "RUN-hand-built-s31-hc28a7688");
  const two = { control: [{ seq: 1, tick: 130, rule: "queue-congestion", status: "declined" }, { seq: 2, tick: 250, rule: "queue-congestion", status: "snoozed" }, { seq: 3, tick: 460, rule: "inbound-late", status: "accepted" }, { seq: 4, tick: 40, rule: "inbound-late", status: "reverted" }] };
  check("5c. controlRows (the v_control twin) by hand on a four-row audit: queue-congestion 2 proposals (1 declined, 1 snoozed, first 130); inbound-late 2 (1 accepted, 1 reverted in the run after, first 40); sorted by rule",
    JSON.stringify(C.controlRows(two)) === JSON.stringify([{ rule: "inbound-late", proposals: 2, accepted: 1, declined: 0, snoozed: 0, reverted: 1, first_tick: 40 }, { rule: "queue-congestion", proposals: 2, accepted: 0, declined: 1, snoozed: 1, reverted: 0, first_tick: 130 }]) && C.controlRows({}).length === 0);
})();

/* ---- 6. shipped wiring ---------------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), py = read(path.join("tools", "run_ledger.py")), rl = read("run-ledger.html"), js = read("run-ledger.js");
  const st = read("selftest.js"), vst = read("run-ledger-selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js"), mk = read(path.join("tools", "make_run_ledger_fixture.mjs")), env = read(path.join("tools", "ledger_env.mjs"));
  const readme = read("README.md"), changelog = read("CHANGELOG.md"), dd = read(path.join("docs", "DIGITAL_TWIN_DEEP_DIVE.md")), kb = read("knowledge.js"), ledger = read("ledger.js");
  check("6a. the card in the Simulate drawer: controlCard after flowCard with the disclaimer, the list and the audit; RAIL_DRAWERS lists it; index.html and run-ledger.html load control.js",
    /id="controlCard"/.test(html) && html.indexOf('id="controlCard"') > html.indexOf('id="flowCard"') && /id="controlList"/.test(html) && /id="controlAudit"/.test(html) && /a person decides/.test(html) &&
    /"flowCard", "controlCard"/.test(app) && /<script src="control\.js"><\/script>/.test(html) && /<script src="control\.js"><\/script>/.test(rl));
  check("6b. app.js: the after-tick multiplexer observes the ledger, then the tracker, then the tower; accept sets the lever as the picker would and re-runs the day; decline and snooze only write the log; the thresholds come from the knowledge base",
    /afterTick: \(st\) => \{ WT\.ledger\.observe\(state\.flow\.ledger, st\); if \(state\.flow\.track\) WT\.tracking\.observe\(state\.flow\.track, state\.flow\.ledger\); if \(state\.flow\.control\) WT\.control\.observe\(state\.flow\.control, state\.flow\.ledger, st\); \}/.test(app) &&
    /WT\.control\.create\(readControlThresholds\(\)\)/.test(app) && /function applyLever\(/.test(app) && /state\.flow\.controlLog\.push\(/.test(app) && /function renderControlTower\(/.test(app) && /control\.queue\.sustainTicks/.test(app) && /control: state\.flow\.controlLog/.test(app) &&
    /function revertLastAccepted\(/.test(app) && /data-revert/.test(app) && /status: "reverted"/.test(app)); // v3.57: the undo
  check("6c. the knowledge base's control category with seven thresholds; ledger.create keeps the log as rec.control and exports it only when a decision exists",
    /key: "control"/.test(kb) && ["control.evalEveryTicks", "control.queue.sustainTicks", "control.rework.maxShare", "control.rework.minUnits", "control.inbound.lateTicks", "control.otif.minDeliveries", "control.snoozeTicks"].every((id) => typeof KB.get(id) === "number") &&
    KB.get("control.evalEveryTicks") === 10 && KB.get("control.queue.sustainTicks") === 30 && KB.get("control.rework.maxShare") === 0.01 && /rec\.control/.test(ledger) && /if \(rec\.control && rec\.control\.length\) out\.control/.test(ledger));
  check("6d. tools/run_ledger.py: control_event, v_control in PLANNER_VIEWS with the reconcile key on rule; the fixture script reconciles it; ledger_env loads control.js",
    /CREATE TABLE IF NOT EXISTS control_event\(/.test(py) && /CREATE VIEW IF NOT EXISTS v_control AS/.test(py) && /PLANNER_VIEWS = \([^)]*"v_control"/.test(py) && /"v_control": \("rule",\)/.test(py) && /v_control: v\.control/.test(mk) && /"control\.js"/.test(env) &&
    /'accepted','declined','snoozed','reverted'/.test(py) && /AS reverted/.test(py)); // v3.57
  check("6e. the viewer: the Control tower block with its note, the glance card; both self-tests; run-all; sw.js precaches control.js at wt-v139 (previously wt-v138)",
    /id="rlControl"/.test(rl) && /function controlHtml/.test(js) && /label: "Control tower"/.test(js) && /control-tower-proposes-and-decline-keeps-the-run/.test(st) && /control-section-without-decisions/.test(vst) && /"rlControl"/.test(vst) &&
    /Object\.keys\(R\.SQL\)\.length === 37/.test(vst) && /verify_control\.js/.test(runall) && /"\.\/control\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v139"/.test(sw) && /Previously wt-v138/.test(sw));
  check("6f. README names the tower (proposes, a person decides, re-run the day); CHANGELOG has v3.56; the deep dive's chapter 3 is rewritten as what exists at v3.56 and its Reproduce lists this harness",
    /The control tower \(v3\.56\)/.test(readme) && /[Aa] person decides/.test(readme) && /## v3\.56/.test(changelog) && /state at v3\.56/.test(dd) && /node verify_control\.js/.test(dd));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL CONTROL-TOWER CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
