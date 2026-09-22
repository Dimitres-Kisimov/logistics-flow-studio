/* =====================================================================
 * Logistics Flow Studio - verify_staffing.js
 * v3.45 ADAPTIVE STAFFING - headless verification
 * ---------------------------------------------------------------------
 * The first adapting strategy in the flow: an opt-in what-if policy
 * (flowsim opts.policy = {kind:"queue-staffing", threshold, maxServers,
 * cooldownTicks}). Before serving, a bench whose queue reached the
 * threshold gains a worker (up to maxServers); a bench with an empty
 * queue and the cool-down elapsed since its last change loses one. The
 * serve loop banks serviceRatePerTick x servers; nothing else changes.
 * Every change is logged; the ledger copies the log (export.staffing),
 * records the policy on the run (with its own honesty text) and folds it
 * into the run id; SQL has staffing_event + v_staffing, the viewer a twin.
 * Honest: it ADDS capacity the declared floor does not have; a unit is
 * still charged one worker's service time; idle time is not charged.
 * This harness proves:
 *   1. On the hand floor (fixture A's floor, seed 31, the default mix)
 *      the put-away bench's queue first reaches 6 at tick 97 without a
 *      policy; with the policy the first (and only) change is exactly
 *      {tick 97, put-0 / stg, 2 workers}, the max queue is lower (17 vs
 *      19) and completions are not fewer (11 = 11) - a floor served at the
 *      floor rate stays congested with two workers, said honestly.
 *   2. Byte-identity: without a policy (or with policy: null) the state
 *      snapshot is identical, no station carries a servers key, no
 *      staffing log exists, the export is byte for byte fixture A.
 *   3. The rule: a threshold-1, cool-down-5 policy on the six-unit hand
 *      pool adds and later removes workers; every decrement comes at least
 *      the cool-down after the previous change at that bench; servers
 *      stay within [1, maxServers]; a change never precedes tick 0.
 *   4. The ledger: export.staffing equals the sim's log (location = the
 *      element id), run.policy carries the normalised policy and the
 *      staffing honesty, the run id differs from the policy-less id while
 *      the policy-less hash is untouched; the viewer's staffing twin gives
 *      the v_staffing row by hand ({stg, 1 change, max 2, first 97, 203
 *      ticks with the extra worker}).
 *   5. Shipped wiring: the picker, the app's opts.policy and readout, the
 *      SQL table / view / planner view / reconcile key, the viewer section
 *      and glance card, the self-tests, the runner.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, A = global.WT.analytics, P = global.WT.pack, I = global.WT.ids, RL = global.RunLedger;
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
const POOL = [
  { orderId: "A", lines: [{ sku: "S1", qty: 2 }, { sku: "S2", qty: 12 }] },
  { orderId: "B", lines: [{ sku: "S1", qty: 5 }] },
  { orderId: "C", lines: [{ sku: "S3", qty: 1 }, { sku: "S2", qty: 7 }, { sku: "S1", qty: 3 }] },
];
const snapshot = (s) => JSON.stringify({
  tick: s.tick, spawned: s.spawned, completed: s.completed, queued: s.queued, maxQueue: s.maxQueue, congestedStations: s.congestedStations,
  stations: s.stations.map((st) => [st.id, st.queue.length, +st.serviceAccum.toFixed(9)]),
  mus: s.mus.map((m) => [m.id, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]),
});
function run(opts, ticks, observe) {
  const plan = F.spawnPlan(FLOOR, opts);
  const st = F.state(plan);
  let rec = null;
  if (observe) { rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: MIX, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() }); st.hooks = { afterTick: (s) => L.observe(rec, s) }; }
  const firstAt = {};
  for (let t = 0; t < ticks; t++) {
    F.step(st, 1);
    for (const s of st.stations) if (firstAt[s.id] == null && s.queue.length >= F.PARAMS.congestQueueThreshold) firstAt[s.id] = st.tick;
  }
  return { plan, st, rec, exp: rec ? L.exportJson(rec) : null, firstAt };
}

/* ---- 1. the hand floor: the policy acts when the queue reaches 6 --------- */
const base = run({ seed: 31, mix: MIX }, 300);
const pol = run({ seed: 31, mix: MIX, policy: { kind: "queue-staffing" } }, 300, true);
(function () {
  check("1a. the policy normalises to threshold 6 (the congestion threshold), 2 workers at most, a 30-tick cool-down",
    JSON.stringify(pol.plan.policy) === JSON.stringify({ kind: "queue-staffing", threshold: F.PARAMS.congestQueueThreshold, maxServers: 2, cooldownTicks: 30 }) && F.PARAMS.congestQueueThreshold === 6, JSON.stringify(pol.plan.policy));
  check("1b. without a policy the put-away bench's queue first reaches 6 at tick 97", base.firstAt["put-0"] === 97 && base.st.maxQueue === 19 && base.st.completed === 11, JSON.stringify(base.firstAt) + " maxQueue " + base.st.maxQueue);
  const log = pol.st.staffing;
  check("1c. with the policy the first change is exactly {tick 97, put-0 (element stg), 2 workers} - the same tick",
    log.length >= 1 && log[0].tick === base.firstAt["put-0"] && log[0].station === "put-0" && log[0].elementId === "stg" && log[0].servers === 2, JSON.stringify(log[0]));
  check("1d. the max queue is lower (17 vs 19) and completions are not fewer (11 = 11); the floor stays congested with two workers at the floor rate - said, not hidden",
    pol.st.maxQueue === 17 && pol.st.maxQueue < base.st.maxQueue && pol.st.completed >= base.st.completed && pol.st.completed === 11 && pol.st.congestedStations >= 1, "maxQueue " + pol.st.maxQueue + " completed " + pol.st.completed);
  check("1e. only the put-away bench changed (one change in 300 ticks); servers put-0 = 2, the others 1; state.maxServers = 2",
    log.length === 1 && pol.st.stations.map((s) => s.id + ":" + s.servers).join(",") === "put-0:2,pick-0:1,pack-0:1" && pol.st.maxServers === 2);
})();

/* ---- 2. byte-identity without a policy ---------------------------------- */
(function () {
  const nul = run({ seed: 31, mix: MIX, policy: null }, 300);
  const bad = run({ seed: 31, mix: MIX, policy: { kind: "something-else" } }, 300);
  check("2a. policy absent, null or of an unknown kind: the same state snapshot, no plan.policy key", snapshot(base.st) === snapshot(nul.st) && snapshot(base.st) === snapshot(bad.st) && !("policy" in base.plan) && !("policy" in nul.plan) && !("policy" in bad.plan));
  check("2b. no servers key on any station, no staffing log, no maxServers without a policy", base.st.stations.every((s) => !("servers" in s) && !("changedAt" in s)) && base.st.staffing === undefined && base.st.maxServers === undefined);
  const a = run({ seed: 31, mix: MIX }, 300, true);
  check("2c. the export without a policy is byte for byte fixture A (no policy, no staffing key)", JSON.stringify(a.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) && !("policy" in a.exp.run) && !("staffing" in a.exp), a.exp.run.id);
  check("2d. the policy run differs from fixture A in its snapshot (it served put-away twice as fast from tick 97)", snapshot(pol.st) !== snapshot(base.st));
})();

/* ---- 3. the rule under a low threshold: workers join and leave ----------- */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, pool: POOL, loop: false, policy: { kind: "queue-staffing", threshold: 1, cooldownTicks: 5, maxServers: 3 } });
  const st = F.state(plan);
  F.step(st, 300);
  const log = st.staffing;
  const ups = log.filter((e, i) => i === 0 || e.servers > (log.slice(0, i).filter((x) => x.station === e.station).pop() || { servers: 1 }).servers);
  const downs = log.filter((e, i) => i > 0 && e.servers < (log.slice(0, i).filter((x) => x.station === e.station).pop() || { servers: 1 }).servers);
  check("3a. a threshold-1 policy on the six-unit pool adds workers and later removes them", ups.length >= 1 && downs.length >= 1, ups.length + " up, " + downs.length + " down: " + JSON.stringify(log.slice(0, 6)));
  const spaced = downs.every((e) => { const prev = log.filter((x) => x.station === e.station && x.tick < e.tick).pop(); return prev && e.tick - prev.tick >= 5; });
  check("3b. every removal comes at least the cool-down (5 ticks) after the previous change at that bench", spaced);
  check("3c. servers stay within [1, 3], every change is at a non-negative tick, and the log is in tick order",
    log.every((e) => e.servers >= 1 && e.servers <= 3 && e.tick >= 0) && log.every((e, i) => i === 0 || e.tick >= log[i - 1].tick) && st.stations.every((s) => s.servers >= 1 && s.servers <= 3));
  check("3d. maxServers on the state is the most any bench had", st.maxServers === Math.max(1, ...log.map((e) => e.servers)));
})();

/* ---- 4. the ledger and the viewer's twin --------------------------------- */
(function () {
  const exp = pol.exp;
  check("4a. export.staffing equals the sim's log with the element id as the location", JSON.stringify(exp.staffing) === JSON.stringify(pol.st.staffing.map((e) => ({ tick: e.tick, location_id: e.elementId, servers: e.servers }))) && exp.staffing[0].location_id === "stg");
  check("4b. run.policy carries the normalised policy and the staffing honesty; RATES_HONESTY is unchanged",
    exp.run.policy.kind === "queue-staffing" && exp.run.policy.threshold === 6 && exp.run.policy.maxServers === 2 && exp.run.policy.cooldownTicks === 30 && exp.run.policy.honesty === L.STAFFING_HONESTY && /idle time is not charged/.test(L.STAFFING_HONESTY) && !/adaptive/i.test(L.RATES_HONESTY));
  check("4c. the policy joins the run id (a different id than fixture A) while the policy-less hash stays c28a7688",
    exp.run.id !== "RUN-hand-built-s31-hc28a7688" && I.inputHash(FLOOR, 31, MIX) === "c28a7688" && exp.run.id === "RUN-hand-built-s31-h" + I.inputHash(FLOOR, 31, MIX, null, pol.plan.policy), exp.run.id);
  const v = RL.views(exp);
  check("4d. the viewer's staffing twin gives the v_staffing row by hand: stg, 1 change, max 2 workers, first change 97, 300 - 97 = 203 ticks with the extra worker",
    JSON.stringify(v.staffing) === JSON.stringify([{ location_id: "stg", changes: 1, max_servers: 2, first_change_tick: 97, ticks_with_extra_server: 203 }]), JSON.stringify(v.staffing));
  const g = RL.glance(exp), g0 = RL.glance(JSON.parse(lf(read(path.join("test", "fixtures", "run-ledger.json")))));
  check("4e. the glance names the what-if on the policy run and 'declared stations only' on fixture A", /adaptive staffing/.test(g.policy.text) && /declared stations only/.test(g0.policy.text) && RL.views(JSON.parse(lf(read(path.join("test", "fixtures", "run-ledger.json"))))).staffing.length === 0);
  check("4f. the invariants hold on the policy run and the cost model still charges one worker's service time (charged ticks per waiting span = 50)",
    Object.keys(v.invariants).every((k) => v.invariants[k] === 0) && L.costs(exp).spans.filter((s) => s.state === "waiting").every((s) => s.charged_ticks === 50));
})();

/* ---- 5. shipped wiring ---------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), py = read(path.join("tools", "run_ledger.py")), rl = read("run-ledger.html"), js = read("run-ledger.js");
  const st = read("selftest.js"), vst = read("run-ledger-selftest.js"), runall = read(path.join("test", "run-all.mjs")), mk = read(path.join("tools", "make_run_ledger_fixture.mjs"));
  check("5a. the planner has the staffing picker with its two options and the honest hint", /id="flowStaffingSelect"/.test(html) && /value="declared"/.test(html) && /value="adaptive"/.test(html) && /adds capacity the declared floor does not have/.test(html));
  check("5b. app.js remembers the choice, hands opts.policy to the flow, nulls the signature on change and shows workers in the readout",
    /wt-flow-staffing/.test(app) && /opts\.policy = \{ kind: "queue-staffing" \}/.test(app) && /function wireStaffing/.test(app) && /workers <strong>/.test(app));
  check("5c. tools/run_ledger.py has staffing_event, v_staffing in PLANNER_VIEWS, run.policy with a guarded ALTER, the reconcile key",
    /CREATE TABLE IF NOT EXISTS staffing_event/.test(py) && /CREATE VIEW IF NOT EXISTS v_staffing AS/.test(py) && /PLANNER_VIEWS = \([^)]*"v_staffing"\)/.test(py) && /\("run", "policy", "TEXT"\)/.test(py) && /"v_staffing": \("location_id",\)/.test(py) && typeof RL.SQL.v_staffing === "string");
  check("5d. the viewer has the section, the step chart, the glance card and the compare note", /id="rlStaffing"/.test(rl) && /function staffingHtml/.test(js) && /class="staff-line"/.test(js) && /label: "Staffing"/.test(js) && /adaptive staffing \(what-if\)/.test(js));
  check("5e. both self-tests cover it and the fixture script reconciles v_staffing", /staffing-what-if-picker-and-policy/.test(st) && /staffing-section-without-policy/.test(vst) && /"rlStaffing"/.test(vst) && /v_staffing: v\.staffing/.test(mk));
  check("5f. test/run-all.mjs lists this harness", /verify_staffing\.js/.test(runall));
})();

console.log("");
console.log(fail === 0 ? "ALL STAFFING CHECKS PASSED (" + pass + ")" : fail + " STAFFING CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
