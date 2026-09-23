/* =====================================================================
 * Logistics Flow Studio - verify_delivery.js
 * v3.55 DELIVERY AND SHIPPING TIMES IN BETWEEN - headless verification
 * ---------------------------------------------------------------------
 * The delivery what-if (flowsim opts.inbound / opts.outbound): dock windows
 * whose lateness is a Weyl sequence through the quantiles of a public
 * delivery dataset (USAID SCMS, aggregates only), carrier departures on a
 * period, a promised lead per unit and on time in full per order. On the
 * hand floor of verify_ledger.js it proves:
 *   1. BYTE-IDENTITY without the keys: the plan, the state after 400 ticks,
 *      a 300-tick export equal to fixture A byte for byte; no `inbound`,
 *      `outbound`, `trailer`, `due_tick` key anywhere; the hash c28a7688.
 *   2. THE SHAPE BY HAND: u = [0, .618034, .236068, .854102, .472136]; the
 *      inverse distribution through (min -2, p10 -1, median 0, p90 3, max
 *      12) at those u, times 60, is [-120, 53, -40, 159, -4]; the window
 *      openings for P 100, O 20, lateness [0, 53, -40, 159] are [0,20),
 *      [153,173), [200,220), [400,420) (trailer 4, the list repeats),
 *      [459,479); units spawn only inside them; the trailer log is exactly
 *      those five rows; no PRNG draw was added to the spawn loop; a finite
 *      pool of forty drains with windows.
 *   3. OUTBOUND: every delivered unit retires exactly at a carrier departure
 *      (a multiple of M), never sooner than eight ticks after loading; restock
 *      and scrap termini keep their eight; OTIF on a six-unit pool by
 *      independent arithmetic from the recorded ticks; conservation intact.
 *   4. THE DATASET TWIN: modes, sums, ordered quantiles, shares summing to
 *      one, the attribution and the licence status, no date anywhere.
 *   5. THE LEDGER: keys only with windows (hu due / trailer / transit /
 *      customer / on-time, run.inbound / outbound with the honesty, the
 *      trailer log, the tracking twins' wt:delivery); the run id differs while
 *      the plain hash is untouched; serviceOf / inboundRows twins.
 *   6. HUMAN + NO CLOCK: no Date / Math.random; no worker reference.
 *   7. SHIPPED WIRING: the picker and its hint, app.js opts.inbound /
 *      outbound and the readout, the knowledge base's delivery category (eight
 *      seeds), SQL columns / table / views / groups / reconcile keys, the
 *      replication views keyed on the levers, the viewer section + glance card,
 *      both self-tests, the runner, sw.js at wt-v139 precaching the dataset
 *      twin, README / CHANGELOG / CREDITS / the schema page / docs/SCMS_DELIVERY.md.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "compliance.js", "automation.js", "knowledge.js", "data/scms-delivery.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack, A = global.WT.analytics, T = global.WT.tracking, KB = global.WT.kb;
const DS = global.WT.datasets.scmsDelivery;
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
const HAND_Q = { min: -2, p10: -1, median: 0, p90: 3, max: 12 };
const HAND_IN = { periodTicks: 100, openTicks: 20, lateness: [0, 53, -40, 159] };
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued, rng: st.rngState,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });
// step() clamps one call to 600 ticks: advance in chunks; with `untilDone` stop when a finite pool has drained
function record(opts, ticks, untilDone) {
  const plan = F.spawnPlan(FLOOR, opts);
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  const track = T.create(rec);
  st.hooks = { afterTick: (s) => { L.observe(rec, s); T.observe(track, rec); } };
  let left = ticks;
  while (left > 0 && !(untilDone && st.done)) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  return { plan: plan, st: st, rec: rec, track: track, exp: L.exportJson(rec), doc: T.exportJson(track) };
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/* ---- 1. byte-identity without the keys ------------------------------------------ */
(function () {
  const plain = F.spawnPlan(FLOOR, { seed: 31, mix: MIX }), nul = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, inbound: null, outbound: false });
  check("1a. inbound / outbound absent, null or false: the same plan JSON, no `inbound` / `outbound` key", JSON.stringify(plain) === JSON.stringify(nul) && !("inbound" in plain) && !("outbound" in plain));
  const a = record({ seed: 31, mix: MIX }, 400), b = record({ seed: 31, mix: MIX, inbound: null }, 400);
  check("1b. the state after 400 ticks is byte-identical with and without the (absent) keys; no state.inbound, no mu.trailer",
    snap(a.st) === snap(b.st) && !("inbound" in a.st) && a.st.mus.every((m) => !("trailer" in m)));
  const c = record({ seed: 31, mix: MIX }, 300);
  check("1c. the 300-tick export without windows is byte for byte fixture A; no delivery key on any unit; no service / inbound in the stats; the hash is c28a7688",
    JSON.stringify(c.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) && c.exp.hus.every((h) => !("due_tick" in h) && !("trailer" in h)) &&
    !("service" in L.stats(c.rec)) && !("inbound" in L.stats(c.rec)) && !("inbound" in c.exp) && L.serviceOf(c.exp) === null && L.inboundRows(c.exp).length === 0 && I.inputHash(FLOOR, 31, MIX) === "c28a7688");
})();

/* ---- 2. the shape and the windows by hand ------------------------------------- */
(function () {
  const u = [0, 1, 2, 3, 4].map(F.weyl).map(r6);
  check("2a. the Weyl sequence u_j = frac(j x 0.6180339887): [0, 0.618034, 0.236068, 0.854102, 0.472136]", JSON.stringify(u) === "[0,0.618034,0.236068,0.854102,0.472136]", JSON.stringify(u));
  const late = F.windowLateness(HAND_Q, 60, 5);
  check("2b. the inverse distribution through (-2, -1, 0, 3, 12) at those u, times 60 ticks per day, rounded: [-120, 53, -40, 159, -4]; the ends clamp; sixteen by default",
    JSON.stringify(late) === "[-120,53,-40,159,-4]" && F.quantileAt(HAND_Q, 0) === -2 && F.quantileAt(HAND_Q, 1) === 12 && Math.abs(F.quantileAt(HAND_Q, 0.1) + 1) < 1e-9 && Math.abs(F.quantileAt(HAND_Q, 0.5)) < 1e-9 && Math.abs(F.quantileAt(HAND_Q, 0.9) - 3) < 1e-9 &&
    F.windowLateness(HAND_Q, 60).length === 16, JSON.stringify(late));
  const opts = { seed: 31, mix: ["cross-dock"], inbound: HAND_IN };
  const plan = F.spawnPlan(FLOOR, opts), st = F.state(plan);
  const windows = [[0, 20], [153, 173], [200, 220], [400, 420], [459, 479]];
  const inside = (t) => windows.some((w) => t >= w[0] && t < w[1]);
  const spawnedAt = [];
  let constant = true;
  for (let t = 0; t < 500; t++) { const before = st.spawned; F.step(st, 1); if (st.spawned > before) spawnedAt.push(t); if (t >= 20 && t < 153 && st.spawned !== spawnedAt.length) constant = false; }
  const log = st.inbound.trailers.map((r) => [r.trailer, r.scheduled_tick, r.arrival_tick, r.late_ticks]);
  check("2c. windows by hand (P 100, O 20, lateness [0, 53, -40, 159]): the trailer log is exactly [0@0, 1@153 (+53), 2@200 (-40 waits for its slot), 4@400 (the list repeats), 3@459 (+159)] over 500 ticks",
    JSON.stringify(log) === "[[0,0,0,0],[1,100,153,53],[2,200,200,-40],[4,400,400,0],[3,300,459,159]]", JSON.stringify(log));
  check("2d. units spawn only while a window is open (" + spawnedAt.length + " spawns), none between tick 20 and 152, the spawn count is constant while the door is closed, every unit names its trailer",
    spawnedAt.length > 8 && spawnedAt.every(inside) && constant && !spawnedAt.some((t) => t >= 20 && t < 153) && st.mus.every((m) => typeof m.trailer === "number"));
  const src = read("flowsim.js");
  const spawnBlock = src.slice(src.indexOf("// --- 1) Spawn"), src.indexOf("// --- 2) Serve station queues"));
  check("2e. the spawn loop draws the PRNG exactly twice as before (the arrival noise, the jitter) - the windows add no draw; the gate sits between the pool guard and the in-flight cap",
    (spawnBlock.match(/nextRand\(/g) || []).length === 2 && spawnBlock.indexOf("poolRemaining <= 0") < spawnBlock.indexOf("inboundOpen(plan, state)") && spawnBlock.indexOf("inboundOpen(plan, state)") < spawnBlock.indexOf("maxInFlight"));
  const two = [record({ seed: 31, mix: MIX, inbound: HAND_IN }, 400), record({ seed: 31, mix: MIX, inbound: HAND_IN }, 400)];
  check("2f. two identical windowed runs are byte-identical (state incl. the PRNG state, export)", snap(two[0].st) === snap(two[1].st) && JSON.stringify(two[0].exp) === JSON.stringify(two[1].exp));
  const pool = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN, loop: false, units: 40 }, 6000, true);
  check("2g. a finite pool of forty drains with windows (" + pool.st.tick + " ticks): completed 40, nothing in flight, done", pool.st.done && pool.st.completed === 40 && pool.st.inflight === 0 && pool.exp.hus.length === 40);
})();

/* ---- 3. outbound: departures and OTIF ------------------------------------------ */
const OUT = { periodTicks: 100, promisedLeadTicks: 300, transit: [10, 200, 10, 10] };
const W = record({ seed: 31, mix: MIX, inbound: HAND_IN, outbound: OUT }, 600);
(function () {
  const exp = W.exp;
  const byHu = {};
  for (const e of exp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
  const delivered = exp.hus.filter((h) => h.final_kind === "delivered");
  const others = exp.hus.filter((h) => h.retired_tick != null && h.final_kind !== "delivered");
  const loadTick = (h) => byHu[h.id].find((e) => e.op === "load" && e.kind === "passed").tick;
  const lastPass = (h) => { const evs = byHu[h.id]; return evs[evs.length - 2].tick; };
  check("3a. every delivered unit (" + delivered.length + ") retires exactly at a carrier departure (a multiple of 100) and never sooner than eight ticks after loading",
    delivered.length > 5 && delivered.every((h) => h.retired_tick % 100 === 0 && h.retired_tick - loadTick(h) >= 8));
  check("3b. restock and scrap termini keep their eight-tick dwell (" + others.length + " units)", others.length > 0 && others.every((h) => h.retired_tick - lastPass(h) === 8));
  const bad = exp.events.filter((e) => e.eaches + e.retained + e.scrapped !== exp.hus.find((h) => h.id === e.hu_id).received_eaches);
  check("3c. conservation at every event with windows on both ends (" + exp.events.length + " events)", bad.length === 0);
  // OTIF by independent arithmetic on a six-unit pool
  const six = record({ seed: 31, mix: ["cross-dock"], inbound: HAND_IN, outbound: OUT, loop: false, units: 6 }, 6000, true);
  const hus = six.exp.hus;
  const hand = hus.map((h) => { const due = h.spawned_tick + 300, transit = OUT.transit[h.seq % 4], customer = h.retired_tick + transit;
    return { due: due, transit: transit, customer: customer, ots: h.retired_tick <= due, ot: customer <= due }; });
  const fieldsOk = hus.every((h, i) => h.due_tick === hand[i].due && h.transit_ticks === hand[i].transit && h.customer_tick === hand[i].customer && h.on_time_shipped === hand[i].ots && h.on_time === hand[i].ot);
  const otif = hand.filter((x) => x.ot).length, ots = hand.filter((x) => x.ots).length;
  const s = L.serviceOf(six.exp), st2 = L.stats(six.rec).service;
  check("3d. OTIF on a six-unit pool by hand from the recorded ticks (due = spawn + 300, customer = retired + transit by sequence): the unit fields, orders 6, delivered 6, OTIF " + otif + "/6, shipped on time " + ots + "/6; serviceOf == stats().service",
    six.st.done && hus.length === 6 && fieldsOk && s.orders === 6 && s.delivered_orders === 6 && s.otif_orders === otif && s.otif === Math.round((otif / 6) * 1e4) / 1e4 && s.shipped_on_time_share === Math.round((ots / 6) * 1e4) / 1e4 &&
    s.avg_transit_ticks === Math.round((hand.reduce((a, x) => a + x.transit, 0) / 6) * 100) / 100 && JSON.stringify(st2) === JSON.stringify(s) && otif < 6 && otif > 0, JSON.stringify(s));
  const rows = L.inboundRows(six.exp);
  check("3e. inboundRows names every trailer the door logged with the units it brought (sum = 6)", rows.length === six.st.inbound.trailers.length && rows.reduce((a, r) => a + r.units, 0) === 6 && rows.every((r) => typeof r.late_ticks === "number"));
})();

/* ---- 4. the dataset twin ------------------------------------------------------- */
(function () {
  const modes = DS.modes;
  const sumN = modes.reduce((a, m) => a + DS.by_mode[m].n, 0), sumU = modes.reduce((a, m) => a + DS.by_mode[m].usable, 0);
  const ordered = (q) => q.min <= q.p10 && q.p10 <= q.median && q.median <= q.p90 && q.p90 <= q.max;
  check("4a. data/scms-delivery.js: five modes (Air, Air Charter, Ocean, Truck, not captured) whose rows sum to the 10 324 of the dataset, quantiles ordered, shares summing to one",
    JSON.stringify(modes) === '["Air","Air Charter","Ocean","Truck","(not captured)"]' && sumN === 10324 && sumN === DS.overall.n && sumU === DS.overall.usable && DS.source.rows === 10324 && DS.source.columns === 33 &&
    modes.every((m) => ordered(DS.by_mode[m].lateness_days) && Math.abs(DS.by_mode[m].share.late + DS.by_mode[m].share.early + DS.by_mode[m].share.on_time - 1) < 1e-3) && ordered(DS.overall.lateness_days));
  check("4b. the attribution, the licence recorded as unresolved with the reason, the rule and the honesty in the file; no retrieval date anywhere; the Markdown carries them",
    DS.source.attribution === "USAID Development Data Library" && DS.source.licence.status === "unresolved" && /CC BY-ND 4\.0/.test(DS.source.licence.note) && /nearest-rank/.test(DS.rule) && /SHAPE/.test(DS.honesty) &&
    !/retrieved/.test(read(path.join("data", "scms-delivery.json"))) && /USAID Development Data Library/.test(read(path.join("docs", "SCMS_DELIVERY.md"))) && /\*\*unresolved\*\*/.test(read(path.join("docs", "SCMS_DELIVERY.md"))));
  check("4c. Truck (a road-served dock's mode) has median lateness 0 with a p10 of -37 and a p90 of 9 days - the shape the app scales", DS.by_mode.Truck.lateness_days.median === 0 && DS.by_mode.Truck.lateness_days.p10 === -37 && DS.by_mode.Truck.lateness_days.p90 === 9);
})();

/* ---- 5. the ledger and the twins ---------------------------------------------------- */
(function () {
  const exp = W.exp, doc = W.doc;
  check("5a. with windows every unit carries trailer, due_tick, transit_ticks and the outcome fields (null until delivered); run.inbound / run.outbound carry the windows and the ledger's honesty; the trailer log is exported",
    exp.hus.every((h) => typeof h.trailer === "number" && typeof h.due_tick === "number" && typeof h.transit_ticks === "number" && (h.final_kind === "delivered" ? typeof h.on_time === "boolean" && typeof h.customer_tick === "number" : h.on_time === null && h.customer_tick === null)) &&
    exp.run.inbound.kind === "dock-windows" && exp.run.outbound.kind === "carrier-windows" && /never a random draw/.test(exp.run.inbound.honesty) && /not a customer calendar/.test(exp.run.outbound.honesty) &&
    Array.isArray(exp.inbound) && exp.inbound.length === W.st.inbound.trailers.length && JSON.stringify(exp.inbound) === JSON.stringify(W.st.inbound.trailers));
  check("5b. the windows join the run id (a different id than fixture A) while the plain hash stays c28a7688; inbound alone and outbound alone give two more ids",
    exp.run.id !== "RUN-hand-built-s31-hc28a7688" && I.inputHash(FLOOR, 31, MIX) === "c28a7688" && I.inputHash(FLOOR, 31, MIX, null, null, null, W.plan.inbound) !== I.inputHash(FLOOR, 31, MIX, null, null, null, null, W.plan.outbound) &&
    I.inputHash(FLOOR, 31, MIX, null, null, null, W.plan.inbound) !== "c28a7688");
  const created = doc.events.filter((ev) => ev["wt:kind"] === "created"), shipped = doc.events.filter((ev) => ev["wt:kind"] === "delivered");
  check("5c. the tracking twins carry wt:delivery: the trailer on the first event, the promise / transit / outcome on the shipping event, null elsewhere",
    created.length > 0 && created.every((ev) => ev["wt:delivery"] && typeof ev["wt:delivery"].trailer === "number") && shipped.length > 0 &&
    shipped.every((ev) => ev["wt:delivery"] && typeof ev["wt:delivery"].due_tick === "number" && typeof ev["wt:delivery"].on_time === "boolean") &&
    doc.events.filter((ev) => ev["wt:kind"] !== "created" && ev["wt:kind"] !== "delivered").every((ev) => ev["wt:delivery"] === null) && T.gaps(exp, doc) === 0);
  const q = L.stats(W.rec);
  check("5d. stats() carries service and inbound only with windows; the readout's numbers are the twins'", JSON.stringify(q.service) === JSON.stringify(L.serviceOf(exp)) && JSON.stringify(q.inbound) === JSON.stringify(L.inboundRows(exp)));
})();

/* ---- 6. human + no clock ---------------------------------------------------------- */
(function () {
  const src = read("flowsim.js");
  const block = src.slice(src.indexOf("v3.55 DELIVERY AND SHIPPING TIMES IN BETWEEN"), src.indexOf("Seeded PRNG (mulberry32)"));
  check("6a. no Date / Math.random in flowsim.js, ledger.js, tracking.js, data/scms-delivery.js; the windows block reads no roster; the honesty names the dataset's limits",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/new Date\(|Date\.now\(|Math\.random\(/.test(read("ledger.js")) && !/new Date\(|Date\.now\(|Math\.random\(/.test(read(path.join("data", "scms-delivery.js"))) &&
    !/WT\.workers|\broster\b|nextRand\(/.test(block) && /never a random draw/.test(F.DELIVERY_HONESTY) && /not a customer calendar/.test(F.DELIVERY_HONESTY) && /never keyed to a person|not keyed to a person|keyed to a person/.test(F.DELIVERY_HONESTY));
})();

/* ---- 7. shipped wiring ---------------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), py = read(path.join("tools", "run_ledger.py")), rl = read("run-ledger.html"), js = read("run-ledger.js");
  const st = read("selftest.js"), vst = read("run-ledger-selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js"), mk = read(path.join("tools", "make_run_ledger_fixture.mjs"));
  const readme = read("README.md"), changelog = read("CHANGELOG.md"), credits = read("CREDITS.md"), schema = read(path.join("docs", "RUN_LEDGER_SCHEMA.md")), kb = read("knowledge.js");
  check("7a. the planner has the delivery picker with its two options and the honest hint; index.html loads data/scms-delivery.js",
    /id="flowDeliverySelect"/.test(html) && /value="instant"/.test(html) && /value="windows"/.test(html) && /id="flowDeliveryHint"/.test(html) && /aggregates only/.test(html) && /<script src="data\/scms-delivery\.js"><\/script>/.test(html));
  check("7b. app.js remembers the choice (wt-flow-delivery), builds the tick lists from the dataset and the knowledge base, hands opts.inbound / outbound to the flow, shows the delivery line",
    /wt-flow-delivery/.test(app) && /function readDeliveryLevers\(/.test(app) && /WT\.flowsim\.windowLateness\(q, scale, 16\)/.test(app) && /opts\.inbound = d\.inbound; opts\.outbound = d\.outbound;/.test(app) && /OTIF <strong>/.test(app));
  const seeds = KB.list("delivery").map((e) => e.id);
  check("7c. the knowledge base's delivery category: the eight teaching seeds (periods, mode index, scale, promised lead, nominal transit, OTIF target) that say teaching value, plus the six delivery.site.* entries of v3.59 (0 = not measured)",
    seeds.length === 14 && seeds.filter((id) => id.indexOf("delivery.site.") === 0).length === 6 && KB.get("delivery.site.n") === 0 && ["delivery.inbound.periodTicks", "delivery.inbound.openTicks", "delivery.inbound.modeIndex", "delivery.scaleTicksPerDay", "delivery.outbound.periodTicks", "delivery.promisedLeadTicks", "delivery.transitTicks", "delivery.otif.target"].every((id) => seeds.indexOf(id) >= 0) &&
    KB.get("delivery.inbound.periodTicks") === 120 && KB.get("delivery.outbound.periodTicks") === 240 && KB.get("delivery.promisedLeadTicks") === 480 && KB.get("delivery.otif.target") === 0.95 && KB.list("delivery").every((e) => /Teaching value/.test(e.note) || /Set by a site profile/.test(e.note)));
  check("7d. tools/run_ledger.py: run.inbound / outbound, the six hu columns, inbound_event, v_otif + v_inbound as planner views with reconcile keys, guarded ALTERs; the replication views key on the levers",
    /policy TEXT, errors TEXT, inbound TEXT, outbound TEXT\);/.test(py) && /due_tick INTEGER, trailer INTEGER, transit_ticks INTEGER, customer_tick INTEGER, on_time_shipped INTEGER, on_time INTEGER,/.test(py) && /CREATE TABLE IF NOT EXISTS inbound_event\(/.test(py) &&
    /CREATE VIEW IF NOT EXISTS v_otif AS/.test(py) && /CREATE VIEW IF NOT EXISTS v_inbound AS/.test(py) && /PLANNER_VIEWS = \([^)]*"v_otif", "v_inbound"/.test(py) && /"v_otif": \(\), "v_inbound": \("trailer",\)/.test(py) && /\("hu", "on_time", "INTEGER"\)/.test(py) &&
    /GROUP BY scenario, COALESCE\(mix, ''\), ticks, COALESCE\(policy, ''\), COALESCE\(errors, ''\), COALESCE\(inbound, ''\), COALESCE\(outbound, ''\)/.test(py) && /v_otif: v\.otif/.test(mk));
  check("7e. the viewer: the Delivery section, deliveryHtml with the no-windows note, the glance card, replication groups keyed on the levers and named in the heading",
    /id="rlDelivery"/.test(rl) && /function deliveryHtml/.test(js) && /Instantaneous dock and carrier/.test(js) && /label: "Delivery"/.test(js) && /leverKey\(r\.inbound/.test(js) && /delivery windows \(what-if\)/.test(js));
  check("7f. both self-tests cover it; run-all lists this harness; sw.js precaches the dataset twin at wt-v139 (previously wt-v138)",
    /delivery-windows-picker-and-otif/.test(st) && /delivery-section-without-windows/.test(vst) && /"rlDelivery"/.test(vst) && /Object\.keys\(R\.SQL\)\.length === (3[6-9]|[4-9]\d)/.test(vst) && /verify_delivery\.js/.test(runall) &&
    /"\.\/data\/scms-delivery\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v139"/.test(sw) && /Previously wt-v138/.test(sw));
  check("7g. README names the what-if and the dataset's limits; CHANGELOG has v3.55; CREDITS names the USAID SCMS aggregates with the licence status; the schema page has the columns and views",
    /Delivery and shipping times in between \(v3\.55\)/.test(readme) && /shape only/.test(readme) && /## v3\.55/.test(changelog) && /USAID SCMS/.test(credits) && /unresolved/.test(credits) && /v_otif/.test(schema) && /inbound_event/.test(schema));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL DELIVERY CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
