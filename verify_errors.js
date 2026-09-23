/* =====================================================================
 * Logistics Flow Studio - verify_errors.js
 * v3.54 HUMAN ERROR, HONESTLY - headless verification
 * ---------------------------------------------------------------------
 * The error what-if (flowsim opts.errors -> routing.normalizeErrors): declared
 * shares per STEP, multiplied by three performance-shaping levers and capped,
 * realised as BRANCHES dispatched by quota (never a random draw) - an unrolled
 * rework (the operation, its verification, the operation once more) or a
 * write-off. Errors belong to a step and a latent condition, never to a
 * person. On the hand floor of verify_ledger.js it proves:
 *   1. BYTE-IDENTITY without the what-if: the plan, the route count (9 with
 *      the default mix), the run id hash c28a7688 and a 300-tick export equal
 *      to fixture A byte for byte; no `errors` key anywhere.
 *   2. THE DISPATCHER by hand: shares [0.98, 0.02] over 100 units err at
 *      indices [25, 75] (the deficit rule); the piece-pick error route's exact
 *      operation list and shares; the full default mix with mis-pick + damage
 *      gives 20 routes (9 base + 11 error branches: full-pallet 1, case-pick 3,
 *      piece-pick 3, vas 2, export 2, cross-dock 0, returns 0) whose mix shares
 *      sum to 1; on a floor without a returns bench every damage branch is
 *      unfulfillable, named, and every mis-pick branch fulfillable.
 *   3. THE LEVERS: 0.02 x 11 = 0.22; the cap binds at 17 x 11; a lever below
 *      1 is 1, above its maximum the maximum; `true` = every kind at its
 *      default; a kind not named is off; nothing on = null.
 *   4. THE RUN (600 ticks, high shares): conservation at every event and per
 *      route; a reworked unit's collapsed operations equal its route, the queued
 *      event at the second pick carries the PICKED quantity (the op-index fix);
 *      a rework costs exactly one more waiting span charged one service (50
 *      ticks at the floor rate) than the plain unit; the ledger's quality block
 *      (ISO 22400-2 names) on a finite pool of 100 piece-pick units: errors 2,
 *      first pass yield 0.98, rework ratio 0.02, scrap 0 - the erring units are
 *      the 26th and 76th; hu.error_* only on error branches; run.errors with its
 *      honesty; the run id differs while the plain hash is untouched.
 *   5. THE TRACKING TWINS: mismatch_class at the mis-pick with wt:error, the
 *      verification `inspecting` / in_progress with detected true and the latent
 *      lever named, damage -> damaged -> holding (still damaged) -> destroying,
 *      wrong put-away -> sellable_not_accessible; every disposition in the CBV
 *      list; no gap; routing's dispositions equal tracking's.
 *   6. THE KNOWLEDGE BASE: seven seeds equal to routing's defaults; the category
 *      names step-not-person, BetrVG and GDPR.
 *   7. HONESTY: the KNOWN LIMITS keep their pinned phrases and say a unit that
 *      errs twice is not modelled; no Date / Math.random; no worker reference
 *      in the new code; the two detection operations after the twenty.
 *   8. SHIPPED WIRING: the picker and its hint, app.js opts.errors and the
 *      readout, SQL columns / view / planner group / reconcile key, the Python
 *      twin's error logic, the viewer section + glance card, both self-tests,
 *      the runner, sw.js at wt-v142, README / CHANGELOG / CREDITS.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "compliance.js", "automation.js", "knowledge.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack, A = global.WT.analytics, T = global.WT.tracking, KB = global.WT.kb;
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
const NO_RETURNS = { gridW: 40, gridH: 24, cell: 1, elements: FLOOR.elements.filter((e) => e.id !== "ret") };
const MIX = R.defaultMix();
const snap = (st) => JSON.stringify({ spawned: st.spawned, completed: st.completed, inflight: st.inflight, tick: st.tick, queued: st.queued,
  mus: st.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9), m.stage, m.status, m.op]) });
// step() clamps one call to 600 ticks: advance in chunks, and with `untilDone` stop when a finite pool has drained
function record(opts, ticks, floor, untilDone) {
  const lay = floor || FLOOR;
  const plan = F.spawnPlan(lay, opts);
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: lay, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  const track = T.create(rec);
  st.hooks = { afterTick: (s) => { L.observe(rec, s); T.observe(track, rec); } };
  let left = ticks;
  while (left > 0 && !(untilDone && st.done)) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  return { plan: plan, st: st, rec: rec, track: track, exp: L.exportJson(rec), doc: T.exportJson(track) };
}

/* ---- 1. byte-identity without the what-if ------------------------------------ */
(function () {
  const plain = F.spawnPlan(FLOOR, { seed: 31, mix: MIX });
  const nul = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, errors: null });
  const off = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, errors: false });
  const empty = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, errors: { damage: 0 } });
  check("1a. errors absent, null, false or all off: the same plan JSON, 9 routes with the default mix, no `errors` key, no route with an `error` key",
    JSON.stringify(plain) === JSON.stringify(nul) && JSON.stringify(plain) === JSON.stringify(off) && JSON.stringify(plain) === JSON.stringify(empty) &&
    plain.routes.length === 9 && !("errors" in plain) && plain.routes.every((r) => !("error" in r)) && plain.mix.every((m) => !("error" in m)));
  const a = record({ seed: 31, mix: MIX }, 300);
  check("1b. the 300-tick export without the what-if is byte for byte fixture A; no quality block in the stats; the hash is c28a7688",
    JSON.stringify(a.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) && !("quality" in L.stats(a.rec)) && I.inputHash(FLOOR, 31, MIX) === "c28a7688" && a.exp.hus.every((h) => !("error_kind" in h)));
  check("1c. the two detection operations come after the twenty (the catalogue's first twenty unchanged), at existing anchors, without a station",
    R.OPERATION_ORDER.length === 22 && R.OPERATION_ORDER[19] === "scrap" && R.OPERATION_ORDER[20] === "verify-pick" && R.OPERATION_ORDER[21] === "verify-put" &&
    R.OPERATIONS["verify-pick"].anchor === "pickface" && R.OPERATIONS["verify-pick"].station === null && R.OPERATIONS["verify-pick"].stage === "picking" &&
    R.OPERATIONS["verify-put"].anchor === "storage" && R.OPERATIONS["verify-put"].station === null && R.OPERATIONS["verify-put"].stage === "storage");
})();

/* ---- 2. the dispatcher and the branches ------------------------------------------ */
(function () {
  const shares = [0.98, 0.02], sent = [0, 0];
  let total = 0;
  const errAt = [];
  for (let k = 0; k < 100; k++) { const i = F.quotaPick(shares, sent, total); sent[i]++; total++; if (i === 1) errAt.push(k); }
  check("2a. the quota dispatcher by hand: shares [0.98, 0.02] over 100 units err exactly at indices [25, 75] (deficit rule, ties to the base)", JSON.stringify(errAt) === "[25,75]", JSON.stringify(errAt));
  const p = F.spawnPlan(FLOOR, { seed: 31, mix: ["piece-pick"], errors: { "mis-pick": 0.02 } });
  const er = p.routes[2];
  check("2b. mix [piece-pick] + mis-pick 0.02: three routes (the spine, the base, the error branch); the error route's exact operation list; shares [0.98, 0.02]; route id and label name the kind and the step",
    p.routes.length === 3 && !!p.errors && p.errors.kinds.length === 1 && er && er.error && er.error.kind === "mis-pick" && er.error.op === "piece-pick" && er.error.rework === true &&
    JSON.stringify(er.ops) === JSON.stringify(["receive", "depalletise", "putaway", "replen", "piece-pick", "verify-pick", "piece-pick", "consolidate", "pack", "load"]) &&
    er.routeId === "piece-pick:mis-pick@piece-pick" && /Mis-pick .* at piece-pick/.test(er.label) && JSON.stringify(p.spawnShares.map((v) => Math.round(v * 1e6) / 1e6)) === "[0.98,0.02]" && p.routes[1].routeId === "piece-pick" && !("error" in p.routes[1]),
    JSON.stringify(p.spawnShares) + " " + (er ? er.ops.join(">") : "?"));
  const full = F.spawnPlan(FLOOR, { seed: 31, mix: MIX, errors: { "mis-pick": 0.02, damage: 0.005 } });
  const perArch = {};
  for (const r of full.routes) if (r.error) perArch[r.archetype] = (perArch[r.archetype] || 0) + 1;
  const want = { "full-pallet-out": 1, "case-pick": 3, "piece-pick": 3, vas: 2, "export-fragile": 2 };
  const mixSum = full.mix.reduce((s, m) => s + m.share, 0);
  const baseShares = full.mix.filter((m) => !m.error);
  check("2c. the full default mix with mis-pick + damage: 20 routes = 9 base + 11 error branches (full-pallet 1, case-pick 3, piece-pick 3, vas 2, export 2, cross-dock 0, returns 0); the mix shares sum to 1",
    full.routes.length === 20 && JSON.stringify(perArch) === JSON.stringify(want) && Math.abs(mixSum - 1) < 1e-9 && baseShares.length === 9 - 1 &&
    full.mix.filter((m) => m.error).every((m) => m.share > 0 && m.share < 0.01), JSON.stringify(perArch) + " sum " + mixSum);
  const bare = F.spawnPlan(NO_RETURNS, { seed: 31, mix: MIX, errors: { "mis-pick": 0.02, damage: 0.005 } });
  const dmg = bare.routes.filter((r) => r.error && r.error.kind === "damage"), mis = bare.routes.filter((r) => r.error && r.error.kind === "mis-pick");
  check("2d. on a floor without a returns bench every damage branch is unfulfillable and names the Returns / QA station; every mis-pick branch is fulfillable; the base branches unchanged (only the two returns routes, which need the bench too, are out)",
    dmg.length === 6 && dmg.every((r) => !r.ok && /Returns \/ QA station/.test(r.message)) && mis.length === 5 && mis.every((r) => r.ok) &&
    bare.unfulfillable.filter((u) => /damage@/.test(u.routeId)).length === 6 && bare.unfulfillable.length === 8 && bare.routes.filter((r) => !r.error && r.archetype !== "returns").every((r) => r.ok) &&
    bare.routes.filter((r) => r.archetype === "returns").every((r) => !r.ok));
  const dmgRoute = full.routes.find((r) => r.error && r.error.kind === "damage" && r.error.op === "pack");
  check("2e. a damage branch truncates the route after the damaging step and appends the write-off; its error says rework false; the returns split still has its two outcomes",
    dmgRoute && JSON.stringify(dmgRoute.ops) === JSON.stringify(["receive", "depalletise", "putaway", "replen", "piece-pick", "consolidate", "pack", "scrap"]) && dmgRoute.error.rework === false &&
    full.routes.filter((r) => r.archetype === "returns").length === 2 && JSON.stringify(R.branchesFor("returns", full.errors)) === JSON.stringify(R.branchesFor("returns", null)));
})();

/* ---- 3. the levers ------------------------------------------------------------------- */
(function () {
  const n1 = R.normalizeErrors({ "mis-pick": 0.02, psf: { timePressure: 11 } });
  const n2 = R.normalizeErrors({ "mis-pick": 0.02, psf: { familiarity: 17, timePressure: 11 } });
  const n3 = R.normalizeErrors(true);
  const n4 = R.normalizeErrors({ "mis-pick": 0.02, psf: { timePressure: 0.5, signalToNoise: 99 } });
  check("3a. 0.02 x 11 = 0.22 with timePressure the latent condition; 17 x 11 caps at 0.5; `true` = the three kinds at their defaults with no latent lever",
    n1.kinds[0].effective === 0.22 && JSON.stringify(n1.latent) === '["timePressure"]' && n1.multiplier === 11 &&
    n2.kinds[0].effective === 0.5 && n2.multiplier === 187 && JSON.stringify(n2.latent) === '["timePressure","familiarity"]' &&
    n3.kinds.length === 3 && n3.kinds.map((k) => k.share).join(",") === "0.02,0.003,0.005" && n3.kinds.every((k) => k.effective === k.share) && n3.latent.length === 0 && n3.multiplier === 1);
  check("3b. a lever below 1 is 1, above its maximum the maximum (signal-to-noise 99 -> 10); a kind not named is off; nothing on -> null; the cap is a lever too",
    n4.psf.timePressure === 1 && n4.psf.signalToNoise === 10 && n4.kinds[0].effective === 0.2 && n4.kinds.length === 1 && R.normalizeErrors({ psf: { timePressure: 5 } }) === null &&
    R.normalizeErrors({ "mis-pick": 0.4, cap: 0.1 }).kinds[0].effective === 0.1 && R.normalizeErrors({ "mis-pick": { share: 0.05 } }).kinds[0].share === 0.05 && R.normalizeErrors(null) === null);
  check("3c. every kind's disposition is one tracking.js names, its ops are real operations, its rework or tail names real operations; the honesty says step-not-person, BetrVG, GDPR, teaching values",
    R.ERROR_KINDS.every((k) => T.ERROR_DISPOSITION[k.kind] === k.disposition && k.ops.every((op) => !!R.OPERATIONS[op]) && (k.rework || k.tail).every((op) => op === R.SAME_OP || !!R.OPERATIONS[op])) &&
    /never a person/.test(R.ERRORS_HONESTY) && /BetrVG/.test(R.ERRORS_HONESTY) && /GDPR/.test(R.ERRORS_HONESTY) && /teaching values/.test(R.ERRORS_HONESTY) && /not warehouse measurements/.test(R.ERRORS_HONESTY));
})();

/* ---- 4. the run ---------------------------------------------------------------------- */
const E = record({ seed: 31, mix: MIX, errors: { "mis-pick": 0.1, "wrong-putaway": 0.1, damage: 0.05, psf: { timePressure: 2 } } }, 600);
// a finite pool of 50 piece-pick units with mis-pick 0.02, run until it drains (two put-away services
// per unit at the floor rate of 50 ticks each: about 5 500 ticks): the 26th unit errs, index 25
const Q = record({ seed: 31, mix: ["piece-pick"], errors: { "mis-pick": 0.02 }, loop: false, units: 50 }, 12000, null, true);
(function () {
  const exp = E.exp;
  const hus = {};
  for (const h of exp.hus) hus[h.id] = h;
  const bad = exp.events.filter((e) => e.eaches + e.retained + e.scrapped !== hus[e.hu_id].received_eaches);
  const byRoute = {};
  for (const h of exp.hus) byRoute[h.route_id] = 1;
  check("4a. 600 ticks with high shares: eaches + retained + scrapped == received at every event (" + exp.events.length + " events over " + Object.keys(byRoute).length + " routes); errors of all three kinds realised",
    bad.length === 0 && ["mis-pick", "wrong-putaway", "damage"].every((k) => exp.hus.some((h) => h.error_kind === k)) && exp.hus.some((h) => h.error_kind && h.retired_tick != null), bad.length + " violations");
  const qexp = Q.exp, byHu = {};
  for (const e of qexp.events) (byHu[e.hu_id] = byHu[e.hu_id] || []).push(e);
  const routes = {};
  for (const r of Q.plan.routes) routes[r.routeId] = r;
  const reworked = qexp.hus.filter((h) => h.error_kind === "mis-pick" && h.retired_tick != null && h.archetype === "piece-pick");
  const collapsed = (evs) => { const out = []; for (const e of evs) if (!out.length || out[out.length - 1] !== e.op) out.push(e.op); return out; };
  const walkOk = reworked.every((h) => JSON.stringify(collapsed(byHu[h.id])) === JSON.stringify(routes[h.route_id].ops));
  const pickedOk = reworked.every((h) => {
    const evs = byHu[h.id];
    const firstServed = evs.find((e) => e.kind === "served" && e.op === "piece-pick");
    const verify = evs.find((e) => e.op === "verify-pick");
    const secondQueued = evs.find((e) => e.kind === "queued" && e.op === "piece-pick" && e.version > verify.version);
    return firstServed && verify && secondQueued && secondQueued.eaches === firstServed.eaches && secondQueued.eaches < h.received_eaches && verify.eaches === firstServed.eaches;
  });
  check("4b. a reworked piece-pick unit's collapsed operations equal its route (pick, verify, pick again); the queued event at the second pick carries the PICKED quantity, not the pallet (" + reworked.length + " units)",
    reworked.length === 1 && walkOk && pickedOk);
  const cost = L.costs(qexp);
  const spansOf = (id) => cost.spans.filter((s) => s.hu_id === id && s.state === "waiting");
  const plain = qexp.hus.find((h) => !h.error_kind && h.retired_tick != null && h.archetype === "piece-pick" && h.route_id === "piece-pick");
  const rw = reworked[0];
  const w0 = spansOf(plain.id), w1 = spansOf(rw.id);
  const charged = (ws) => ws.reduce((a, s) => a + s.charged_ticks, 0);
  check("4c. a rework costs exactly one more waiting span at the pick face, charged one service (50 ticks at the floor rate) more than a plain unit of the same route",
    w1.length === w0.length + 1 && charged(w1) - charged(w0) === 50 && w1.filter((s) => s.op === "piece-pick").length === w0.filter((s) => s.op === "piece-pick").length + 1,
    w0.length + " vs " + w1.length + " waiting spans, charged " + charged(w0) + " vs " + charged(w1));
  const q = L.stats(E.rec).quality;
  const qp = q.find((r) => r.reworked > 0), qv = q.find((r) => r.op === "verify-pick");
  const fpyOk = q.every((r) => r.first_pass_yield === Math.round(((r.units_through - r.errors) / r.units_through) * 10000) / 10000 && r.errors === r.reworked + r.scrapped_for_damage &&
    r.rework_ratio === Math.round((r.reworked / r.units_through) * 10000) / 10000 && r.scrap_ratio === Math.round((r.scrapped_for_damage / r.units_through) * 10000) / 10000);
  check("4d. stats().quality exists with the what-if: per operation units through, errors = reworked + scrapped, FPY = (through - errors) / through, the ratios; a reworked pick op, a damaged op, verify-pick with no error; equal to the pure qualityByStep(export)",
    Array.isArray(q) && fpyOk && qp && /pick/.test(qp.op) && qp.scrapped_for_damage === 0 && qv && qv.errors === 0 && qv.first_pass_yield === 1 && qv.units_through > 0 &&
    q.some((r) => r.scrapped_for_damage > 0 && r.scrap_ratio > 0 && /depalletise|pack|palletise/.test(r.op)) && JSON.stringify(q) === JSON.stringify(L.qualityByStep(exp)), qp ? qp.op + " reworked " + qp.reworked : "no rework");
  check("4e. hu.error_kind / error_op / error_outcome / error_latent only on error branches (latent = the levers above 1); run.errors carries the kinds, the levers and the ledger's honesty; the id differs from the plain run",
    exp.hus.every((h) => (h.error_kind ? h.route_id.indexOf(h.error_kind + "@" + h.error_op) > 0 && JSON.stringify(h.error_latent) === '["timePressure"]' && (h.error_outcome === (h.error_kind === "damage" ? "scrap" : "rework")) : !("error_op" in h) && !("error_latent" in h))) &&
    exp.run.errors && exp.run.errors.kinds.length === 3 && exp.run.errors.psf.timePressure === 2 && exp.run.errors.multiplier === 2 && /never a person/.test(exp.run.errors.honesty) && /BetrVG/.test(exp.run.errors.honesty) &&
    exp.run.id !== "RUN-hand-built-s31-hc28a7688" && /^RUN-hand-built-s31-h[0-9a-f]{8}$/.test(exp.run.id) && I.inputHash(FLOOR, 31, MIX) === "c28a7688");
  const qq = L.stats(Q.rec).quality, pp = qq.find((r) => r.op === "piece-pick"), vv = qq.find((r) => r.op === "verify-pick");
  const erring = Q.exp.hus.filter((h) => h.error_kind).map((h) => h.seq - 1);
  check("4f. a finite pool of 50 piece-pick units with mis-pick 0.02 drains (" + Q.st.tick + " ticks): piece-pick through 50, errors 1, first pass yield 0.98, rework ratio 0.02, scrap 0; the erring unit is the 26th (index 25, as the dispatcher by hand)",
    Q.st.done && Q.exp.hus.length === 50 && Q.exp.hus.every((h) => h.retired_tick != null) && pp && pp.units_through === 50 && pp.errors === 1 && pp.reworked === 1 && pp.first_pass_yield === 0.98 && pp.rework_ratio === 0.02 && pp.scrap_ratio === 0 &&
    vv && vv.units_through === 1 && JSON.stringify(erring) === "[25]", JSON.stringify(erring) + " " + JSON.stringify(pp));
  const plainRun = record({ seed: 31, mix: MIX }, 600);
  check("4g. a run with the what-if differs from the plain run in its snapshot (the branches walk), while the plain run's snapshot equals the tracker-free run of verify_tracking.js",
    snap(E.st) !== snap(plainRun.st) && plainRun.exp.run.id === "RUN-hand-built-s31-hc28a7688");
})();

/* ---- 5. the tracking twins ----------------------------------------------------------- */
(function () {
  const doc = E.doc, exp = E.exp;
  const byHu = {};
  for (const ev of doc.events) (byHu[ev["wt:hu_id"]] = byHu[ev["wt:hu_id"]] || []).push(ev);
  const mis = exp.hus.filter((h) => h.error_kind === "mis-pick" && h.retired_tick != null);
  const misOk = mis.every((h) => {
    const evs = byHu[h.id];
    const at = evs.find((ev) => ev["wt:op"] === h.error_op && ev["wt:kind"] !== "queued");
    const verify = evs.find((ev) => ev["wt:op"] === "verify-pick");
    const after = evs.filter((ev) => ev["wt:version"] > verify["wt:version"]);
    return at && at.disposition === "mismatch_class" && at["wt:error"] && at["wt:error"].detected === false && at["wt:error"].kind === "mis-pick" && JSON.stringify(at["wt:error"].latent) === '["timePressure"]' &&
      verify && verify.bizStep === "inspecting" && verify.disposition === "in_progress" && verify["wt:error"].detected === true && after.every((ev) => ev["wt:error"] === null) &&
      evs.filter((ev) => ev["wt:error"]).length === 2 && evs[evs.length - 1].disposition === "in_transit";
  });
  check("5a. a mis-pick: mismatch_class at the step with wt:error (detected false, the latent lever named), inspecting / in_progress at the verification with detected true, nothing after; delivered in_transit (" + mis.length + " units)", mis.length > 0 && misOk);
  const dmg = exp.hus.filter((h) => h.error_kind === "damage" && h.retired_tick != null);
  const dmgOk = dmg.every((h) => {
    const evs = byHu[h.id];
    const at = evs.find((ev) => ev["wt:op"] === h.error_op && ev["wt:kind"] !== "queued");
    const hold = evs.find((ev) => ev.bizStep === "holding"), last = evs[evs.length - 1];
    return at && at.disposition === "damaged" && at["wt:error"].detected === true && hold && hold.disposition === "damaged" && last.bizStep === "destroying" && last.disposition === "non_sellable_other" && last.action === "DELETE";
  });
  check("5b. a damage: damaged at the step (detected there), still damaged while held at the returns bench, destroyed non_sellable_other (" + dmg.length + " units)", dmg.length > 0 && dmgOk);
  // wrong put-aways need two put-away services at the congested bench: a six-unit case-pick pool, drained (units 2, 4, 6 err)
  const W = record({ seed: 31, mix: ["case-pick"], errors: { "wrong-putaway": 0.5 }, loop: false, units: 6 }, 9000, null, true);
  const wByHu = {};
  for (const ev of W.doc.events) (wByHu[ev["wt:hu_id"]] = wByHu[ev["wt:hu_id"]] || []).push(ev);
  const wp = W.exp.hus.filter((h) => h.error_kind === "wrong-putaway" && h.retired_tick != null);
  const wpOk = wp.every((h) => { const evs = wByHu[h.id]; const at = evs.find((ev) => ev["wt:op"] === "putaway" && ev["wt:kind"] === "served"); const v = evs.find((ev) => ev["wt:op"] === "verify-put");
    const again = evs.filter((ev) => ev["wt:op"] === "putaway" && ev["wt:kind"] === "served");
    return at && at.disposition === "sellable_not_accessible" && v && v.bizStep === "inspecting" && v.disposition === "in_progress" && v["wt:error"].detected === true && again.length === 2 && again[1].disposition === "in_progress"; });
  check("5c. a wrong put-away (six-unit case-pick pool, drained in " + W.st.tick + " ticks): sellable_not_accessible at the put-away, detected at the location scan, put away again in_progress; units 2, 4 and 6 err (" + wp.length + " units)",
    W.st.done && wp.length === 3 && JSON.stringify(wp.map((h) => h.seq)) === "[2,4,6]" && wpOk && W.exp.hus.every((h) => h.retired_tick != null));
  const outside = doc.events.filter((ev) => T.BIZ_STEPS.indexOf(ev.bizStep) < 0 || T.DISPOSITIONS.indexOf(ev.disposition) < 0);
  check("5d. every twin's step and disposition is in the CBV list, no gap, fromLedger(export) equals the observer, and the verification steps map to inspecting",
    outside.length === 0 && T.gaps(exp, doc) === 0 && JSON.stringify(T.fromLedger(exp)) === JSON.stringify(doc) && doc.events.filter((ev) => ev["wt:op"] === "verify-pick").every((ev) => ev.bizStep === "inspecting"));
})();

/* ---- 6. the knowledge base ------------------------------------------------------------ */
(function () {
  const ids = ["hf.error.mis-pick", "hf.error.wrong-putaway", "hf.error.damage", "hf.psf.timePressure", "hf.psf.signalToNoise", "hf.psf.familiarity", "hf.error.cap"];
  const kinds = {};
  for (const k of R.ERROR_KINDS) kinds[k.kind] = k;
  check("6a. the seven human-factors seeds equal routing's defaults (shares, levers at 1 with HEART's maxima, the cap)",
    KB.get("hf.error.mis-pick") === kinds["mis-pick"].share && KB.get("hf.error.wrong-putaway") === kinds["wrong-putaway"].share && KB.get("hf.error.damage") === kinds.damage.share &&
    KB.get("hf.psf.timePressure") === 1 && KB.get("hf.psf.signalToNoise") === 1 && KB.get("hf.psf.familiarity") === 1 && KB.get("hf.error.cap") === R.ERROR_CAP &&
    KB.entry("hf.psf.timePressure").max === R.PSF.timePressure.max && KB.entry("hf.psf.signalToNoise").max === R.PSF.signalToNoise.max && KB.entry("hf.psf.familiarity").max === R.PSF.familiarity.max &&
    KB.list("human-factors").map((e) => e.id).join(",") === ids.join(","));
  const cats = typeof KB.categories === "function" ? KB.categories() : KB.categories;
  const cat = (cats || []).find((c) => c.key === "human-factors");
  check("6b. the category says step-not-person, names BetrVG and GDPR, HEART / SPAR-H as anchors and teaching values; every seed's source names its HEART anchor or says it has none",
    !!cat && /never to a person/.test(cat.desc) && /BetrVG/.test(cat.desc) && /GDPR/.test(cat.desc) && /HEART/.test(cat.desc) && /teaching values/.test(cat.desc) &&
    KB.list("human-factors").every((e) => /HEART|no generic human-error probability|WarehouseTwin choice/.test(e.source) && /never to a person/.test(e.note)));
})();

/* ---- 7. honesty ----------------------------------------------------------------------- */
(function () {
  const src = read("routing.js");
  check("7a. the KNOWN LIMITS keep their pinned phrases and say a unit that errs twice is not modelled (cycles need a graph)",
    /KNOWN LIMITS/.test(src) && /not necessarily determined/.test(src) && /PASS-THROUGH step, not a branch/.test(src) && /Cycles need/.test(src) && /dangerous goods/.test(src) && /errs twice is not modelled/.test(src));
  const block = src.slice(src.indexOf("v3.54 HUMAN ERROR, HONESTLY"), src.indexOf("resolveAll - the per-archetype"));
  check("7b. no Date / Math.random in routing.js, ledger.js or tracking.js; the error block reads no roster and no worker module (it may say it is never keyed to a worker); the sources name HEART / SPAR-H as anchors",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(src) && !/new Date\(|Date\.now\(|Math\.random\(/.test(read("ledger.js")) && !/new Date\(|Date\.now\(|Math\.random\(/.test(read("tracking.js")) &&
    !/WT\.workers|\broster\b|workerRoster|workers\.sample/i.test(block) && /HEART/.test(block) && /SPAR-H/.test(block) && /TEACHING/.test(block));
})();

/* ---- 8. shipped wiring ---------------------------------------------------------------- */
(function () {
  const html = read("index.html"), app = read("app.js"), py = read(path.join("tools", "run_ledger.py")), rl = read("run-ledger.html"), js = read("run-ledger.js");
  const st = read("selftest.js"), vst = read("run-ledger-selftest.js"), runall = read("test/run-all.mjs"), sw = read("sw.js"), mk = read(path.join("tools", "make_run_ledger_fixture.mjs"));
  const readme = read("README.md"), changelog = read("CHANGELOG.md"), credits = read("CREDITS.md"), schema = read(path.join("docs", "RUN_LEDGER_SCHEMA.md")), kb = read("knowledge.js");
  check("8a. the planner has the human-error picker with its two options and the honest hint (step and latent condition, never a person; teaching values; quota)",
    /id="flowErrorsSelect"/.test(html) && /value="none"/.test(html) && /value="declared"/.test(html) && /id="flowErrorsHint"/.test(html) && /never to a person/.test(html) && /HEART/.test(html) && /quota/.test(html));
  check("8b. app.js remembers the choice (wt-flow-errors), reads the levers from the knowledge base, hands opts.errors to the flow, nulls the signature on change and shows the quality line",
    /wt-flow-errors/.test(app) && /function readErrorLevers\(/.test(app) && /opts\.errors = readErrorLevers\(\)/.test(app) && /hf\.psf\.familiarity/.test(app) && /s\.quality/.test(app) && /first pass yield per step/.test(app));
  check("8c. tools/run_ledger.py: run.errors, hu.error_kind / error_op / error_outcome / error_latent, tracking_event.error_detected with guarded ALTERs, the Python twin's detection, v_quality_by_step in PLANNER_VIEWS, the reconcile key",
    /policy TEXT, errors TEXT/.test(py) && /error_kind TEXT, error_op TEXT, error_outcome TEXT, error_latent TEXT,/.test(py) && /\("tracking_event", "error_detected", "INTEGER"\)/.test(py) && /\("hu", "error_outcome", "TEXT"\)/.test(py) &&
    /ERROR_DISPOSITION = \{"mis-pick": "mismatch_class"/.test(py) && /VERIFY_OPS = \("verify-pick", "verify-put"\)/.test(py) && /CREATE VIEW IF NOT EXISTS v_quality_by_step AS/.test(py) && /PLANNER_VIEWS = \([^)]*"v_quality_by_step"/.test(py) && /"v_quality_by_step": \("op",\)/.test(py));
  check("8d. the viewer: the Quality section, qualityHtml with the perfect-run note, the glance card, the invariant count no longer says four; the fixture script reconciles v_quality_by_step",
    /id="rlQuality"/.test(rl) && /function qualityHtml/.test(js) && /Every step was perfect/.test(js) && /label: "Human error"/.test(js) && !/all four hold/.test(js) && /v_quality_by_step: v\.quality/.test(mk));
  check("8e. both self-tests cover it; run-all lists this harness; the knowledge base has the category",
    /human-error-what-if-picker-and-branches/.test(st) && /quality-section-without-errors/.test(vst) && /"rlQuality"/.test(vst) && /Object\.keys\(R\.SQL\)\.length === (3[4-9]|[4-9]\d)/.test(vst) && /verify_errors\.js/.test(runall) && /key: "human-factors"/.test(kb));
  check("8f. sw.js at wt-v142 (previously wt-v141)", /CACHE_VERSION\s*=\s*"wt-v142"/.test(sw) && /Previously wt-v141/.test(sw));
  check("8g. README names the what-if and step-not-person; CHANGELOG has v3.54 and the cosmetic formAlong limit; CREDITS names HEART / SPAR-H as anchors; the schema page has the error columns and the view",
    /Human error, honestly \(v3\.54\)/.test(readme) && /never to a person/.test(readme) && /## v3\.54/.test(changelog) && /formAlong/.test(changelog) && /HEART/.test(credits) && /SPAR-H/.test(credits) &&
    /v_quality_by_step/.test(schema) && /error_outcome/.test(schema));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL HUMAN-ERROR CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
