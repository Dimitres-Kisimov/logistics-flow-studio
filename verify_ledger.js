/* =====================================================================
 * Logistics Flow Studio - verify_ledger.js
 * v3.32 THE RUN LEDGER - headless verification
 * ---------------------------------------------------------------------
 * The ledger is a pure observer of the flow sim. On the hand-built floor of
 * verify_stations.js with the FULL order mix it must prove:
 *   1. IDENTITY: every unit ever spawned has one record with well-formed,
 *      unique RUN / ORD / HU ids and VALID GS1 numbers (SSCC extension 3 for
 *      pallet units, 0 for parcels; GTIN-13 + GTIN-14 with correct checks).
 *   2. EVENTS: versions are consecutive from 0 per unit; the first event is
 *      `created`; a retired unit ends in delivered / restocked / scrapped; the
 *      operations recorded are exactly the unit's route operations, in order.
 *   3. QUANTITIES: at EVERY event eaches carried + retained + scrapped equals
 *      the eaches the unit received (the conservation identity).
 *   4. LOCATIONS: an operation bound to a strict station names that element
 *      (depalletise -> "dep", wrap -> "wrap", value-add -> "vas", QC -> "qc",
 *      staging -> "stg"); a queued / served event names the bench the unit
 *      stood at; nothing is a guess.
 *   5. THE SQL INVARIANTS restated in JS: no cross-dock event at a storage or
 *      pick-face element; delivered eaches equal the sum of the retired units'
 *      final eaches; stats() agrees with the records.
 *   6. DETERMINISM + BYTE-IDENTITY: two runs export identical JSON; the sim
 *      state after 600 ticks is identical with and without the ledger hook;
 *      observe() never mutates the state.
 *   7. Simulated time: minute = tick x 60 / ticks-per-hour.
 *   8. Shipped wiring: the after-tick hook, station elementId and anchor ids
 *      in flowsim.js; the app creating the ledger and its export button; the
 *      flow card block; sw.js precaching ledger.js at wt-v145.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

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
const TICKS = 600;
function run(withLedger) {
  const mix = R.defaultMix();
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: mix });
  const st = F.state(plan);
  let rec = null;
  if (withLedger) {
    rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: mix, layout: FLOOR, profile: P.PROFILES.ecommerce });
    st.hooks = { afterTick: (s) => L.observe(rec, s) };
  }
  F.step(st, TICKS);
  return { plan: plan, st: st, rec: rec };
}
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });

console.log("v3.32 - the run ledger");
console.log("=".repeat(72));

const A = run(true);
const rec = A.rec, exp = L.exportJson(rec);
const huIds = Object.keys(rec.hus);

/* ---- 1. identity -------------------------------------------------------- */
(function () {
  check("1a. every unit ever spawned has exactly one record (" + huIds.length + " units, " + A.st.spawned + " spawned)",
    huIds.length === A.st.spawned && rec.order.length === huIds.length && new Set(rec.order).size === huIds.length);
  const runOk = /^RUN-hand-built-s31-h[0-9a-f]{8}$/.test(rec.run.id);
  const idsOk = rec.order.every((id) => { const h = rec.hus[id]; return new RegExp("^HU-ORD-" + rec.run.id.replace(/[-.]/g, "\\$&") + "-\\d{6}-1$").test(h.id) && h.order_id === id.slice(3, -2); });
  check("1b. run / order / unit ids are well-formed and nested", runOk && idsOk, rec.run.id);
  const gs1 = rec.order.every((id) => { const h = rec.hus[id]; return I.isValidGs1(h.sscc) && I.isValidGs1(h.gtin13) && I.isValidGs1(h.gtin14) && h.gtin14.slice(1, 13) === h.gtin13.slice(0, 12); });
  check("1c. every unit carries a VALID SSCC, GTIN-13 and GTIN-14 (the GTIN-14 wraps the GTIN-13)", gs1);
  const ext = rec.order.every((id) => { const h = rec.hus[id]; const pallet = h.archetype !== "returns" && h.archetype !== "vas"; return h.sscc[0] === (pallet ? "3" : "0") || h.archetype === "export-fragile"; });
  check("1d. SSCC extension digit follows the convention: 3 for a pallet unit, 0 for a parcel", ext);
  const ssccs = new Set(rec.order.map((id) => rec.hus[id].sscc));
  check("1e. SSCCs never collide within the run", ssccs.size === huIds.length);
})();

/* ---- 2. events ------------------------------------------------------------ */
(function () {
  const byHu = {};
  for (const ev of rec.events) (byHu[ev.hu_id] = byHu[ev.hu_id] || []).push(ev);
  let badVersion = 0, badFirst = 0, badTerminal = 0, badOps = 0, retired = 0, kinds = {};
  for (const id of rec.order) {
    const evs = byHu[id] || [], h = rec.hus[id];
    if (!evs.length || evs[0].kind !== "created") badFirst++;
    for (let i = 0; i < evs.length; i++) { if (evs[i].version !== i) badVersion++; kinds[evs[i].kind] = 1; }
    const route = A.plan.routes[h.__route];
    const ops = evs.map((e) => e.op).filter((op, i, arr) => i === 0 || op !== arr[i - 1]);
    const want = route.ops;
    if (h.retired_tick != null) {
      retired++;
      const lastKind = evs[evs.length - 1].kind;
      if (["delivered", "restocked", "scrapped"].indexOf(lastKind) < 0) badTerminal++;
      if (ops.join(">") !== want.join(">")) badOps++;
    } else if (ops.join(">") !== want.slice(0, ops.length).join(">")) badOps++;
  }
  check("2a. versions are consecutive from 0 and the first event of every unit is `created`", badVersion === 0 && badFirst === 0);
  check("2b. every retired unit (" + retired + ") ends in delivered / restocked / scrapped and walked EXACTLY its route's operations in order; live units are on a prefix", badTerminal === 0 && badOps === 0 && retired > 0);
  check("2c. event kinds are the documented set", Object.keys(kinds).every((k) => ["created", "queued", "served", "passed", "delivered", "restocked", "scrapped"].indexOf(k) >= 0), Object.keys(kinds).sort().join(","));
  const served = rec.events.filter((e) => e.kind === "served").length, queued = rec.events.filter((e) => e.kind === "queued").length;
  check("2d. stations were really used: queued and served events both occurred, served <= queued", queued > 0 && served > 0 && served <= queued, "queued=" + queued + " served=" + served);
})();

/* ---- 3. quantities ------------------------------------------------------- */
(function () {
  let bad = 0;
  for (const ev of rec.events) { const h = rec.hus[ev.hu_id]; if (ev.eaches + ev.retained + ev.scrapped !== h.received_eaches) bad++; }
  check("3a. eaches carried + retained + scrapped == eaches received at EVERY one of " + rec.events.length + " events", bad === 0);
  // The depalletiser is a WAYPOINT operation (no server): a unit passes it.
  const dep = rec.events.filter((e) => e.op === "depalletise" && e.kind === "passed");
  check("3b. passing the depalletiser leaves the pallet count at 0 and the case count intact (a pallet became cases)", dep.length > 0 && dep.every((e) => e.pallets === 0 && e.cases > 0));
  const cp = rec.events.filter((e) => e.op === "case-pick" && e.kind === "served");
  check("3c. a served case-pick carries fewer cases than the pallet held and books the rest as retained", cp.length > 0 && cp.every((e) => e.cases >= 1 && e.retained === (rec.hus[e.hu_id].cases_per_pallet - e.cases) * rec.hus[e.hu_id].eaches_per_case));
  // The pick face IS a server: a unit queued for its case-pick still holds the full case count.
  const q = rec.events.filter((e) => e.kind === "queued" && e.op === "case-pick");
  check("3d. a unit QUEUED for its case-pick still carries every case (quantities change when served, not when waiting)", q.length > 0 && q.every((e) => e.cases === rec.hus[e.hu_id].cases_per_pallet && e.retained === 0));
  const packs = rec.events.filter((e) => e.op === "pack" && e.kind === "served");
  check("3e. a served pack books parcels = ceil(eaches / eaches-per-parcel)", packs.length > 0 && packs.every((e) => e.parcels === Math.ceil(e.eaches / P.PROFILES.ecommerce.eachesPerParcel)));
})();

/* ---- 4. locations ---------------------------------------------------------- */
(function () {
  const want = { depalletise: "dep", wrap: "wrap", vas: "vas", "qc-sample": "qc", "stage-out": "stg", "qc-final": "qc", inspect: "ret", scrap: "ret" };
  const bad = [];
  for (const ev of rec.events) if (want[ev.op] && ev.location !== want[ev.op] && ev.kind !== "delivered") bad.push(ev.op + "@" + ev.location);
  check("4a. operations bound to strict stations name that element (depalletiser 'dep', wrapper 'wrap', VAS bench 'vas', QC 'qc', staging 'stg', returns 'ret')", bad.length === 0, bad.slice(0, 4).join(",") || "all exact");
  const ids = new Set(FLOOR.elements.map((e) => e.id));
  const qs = rec.events.filter((e) => e.kind === "queued" || e.kind === "served");
  check("4b. every queued / served event names a real element of the floor (never a station index, never a zone)", qs.length > 0 && qs.every((e) => ids.has(e.location)));
  check("4c. no event location is a guess: each is an element id or an explicit zone:<stage> fallback", rec.events.every((e) => ids.has(e.location) || /^zone:[a-z]+$/.test(e.location)));
})();

/* ---- 5. the SQL invariants in JS --------------------------------------- */
(function () {
  const storage = new Set(["rack", "face"]);
  const xd = rec.events.filter((e) => rec.hus[e.hu_id].archetype === "cross-dock");
  check("5a. no cross-dock event happens at a storage or pick-face element (" + xd.length + " cross-dock events)", xd.length > 0 && xd.every((e) => !storage.has(e.location)));
  const s = L.stats(rec);
  const finalEaches = rec.order.filter((id) => rec.hus[id].final_kind === "delivered").reduce((a, id) => a + rec.hus[id].final.eaches, 0);
  check("5b. stats(): units and events match the records; delivered eaches equal the sum of the delivered units' final eaches",
    s.units === huIds.length && s.events === rec.events.length && s.delivered_eaches === finalEaches && s.delivered > 0);
  const typed = s.types.find((t) => t.archetype === "full-pallet-out");
  check("5c. per-type stats carry touches (events per unit) and an average cycle time in ticks for retired units", !!typed && typed.touches > 0 && (typed.retired === 0 || typed.avg_cycle_ticks > 0));
})();

/* ---- 6. determinism + byte-identity ------------------------------------ */
(function () {
  const B = run(true);
  check("6a. two runs export byte-identical ledgers", JSON.stringify(L.exportJson(B.rec)) === JSON.stringify(exp), exp.events.length + " events");
  const C = run(false);
  check("6b. the sim state after " + TICKS + " ticks is byte-identical WITH and WITHOUT the ledger hook", snap(C.st) === snap(A.st));
  const before = snap(A.st);
  L.observe(rec, A.st);
  check("6c. observe() never mutates the sim state", snap(A.st) === before);
  check("6d. the export carries no wall-clock field and no internal (__) fields", !("generated" in exp.run) && exp.hus.every((h) => Object.keys(h).every((k) => k.indexOf("__") !== 0)));
})();

/* ---- 7. simulated time ------------------------------------------------- */
(function () {
  const mpt = 60 / A.plan.ticksPerHour;
  check("7.  minute = tick x " + mpt + " on every event", rec.events.every((e) => Math.abs(e.minute - e.tick * mpt) < 1e-6) && rec.run.minutes_per_tick === mpt);
})();

/* ---- 8. shipped wiring -------------------------------------------------- */
(function () {
  const flow = read("flowsim.js"), app = read("app.js"), html = read("index.html"), sw = read("sw.js"), runall = read("test/run-all.mjs");
  check("8a. flowsim.js runs after-tick hooks, stamps elementId on stations and ids on anchors",
    /state\.hooks\.afterTick\(state\)/.test(flow) && /elementId: e && e\.id/.test(flow) && /ids: idsOf\(els, pred\)/.test(flow));
  check("8b. app.js creates the ledger on every run and wires the export button",
    /WT\.ledger\.create\(/.test(app) && /flowLedgerExport/.test(app) && /afterTick: \(st\) => \{ WT\.ledger\.observe/.test(app)); // v3.53: the hook multiplexes the tracker after the ledger
  check("8c. index.html ships the run-ledger block and loads ledger.js", /id="flowLedger"/.test(html) && /<script src="ledger\.js"><\/script>/.test(html));
  check("8d. sw.js precaches ledger.js at wt-v145 (trail preserved: previously wt-v144)", /"\.\/ledger\.js"/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v145"/.test(sw) && /Previously wt-v144/.test(sw));
  check("8e. test/run-all.mjs lists verify_ledger.js", /verify_ledger\.js/.test(runall));
  check("8f. honesty label: synthetic, not telemetry, not a WMS", /not telemetry/.test(L.HONESTY) && /not a WMS/.test(L.HONESTY) && /SYNTHETIC|synthetic/.test(L.HONESTY));
  check("8g. no Date / Math.random CALL in ledger.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(read("ledger.js")));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL RUN-LEDGER CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
