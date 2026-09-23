/* =====================================================================
 * Logistics Flow Studio - verify_forms.js
 * v3.30 R3 "THE GOODS FOLLOW THE OPERATION" - headless verification
 * ---------------------------------------------------------------------
 * v3.23 drew every handling unit in the form of its STAGE (receiving =
 * wrapped pallet-load, storage = carton, picking = tote, packing/shipping =
 * parcel). That was honest for the single legacy spine, where the stage
 * implies the operation. With an order mix declared (v3.29) it is not: a
 * full pallet in "storage" is still a pallet, a cross-dock unit never
 * becomes a carton, a return arrives as a parcel. R3 makes the form a pure
 * function of the OPERATIONS a unit has passed on its own route.
 *
 * Checks:
 *   1. THE TABLE is closed: every transforming operation is a real routing
 *      operation, every form it names is a real, sized form; the new
 *      wrapped-pallet form shares the pallet-load envelope.
 *   2. HAND-DERIVED form sequences for every archetype (and both returns
 *      outcomes) on a hand-built floor, walked operation by operation.
 *   3. WAITING semantics: a unit queued at a station still shows the form
 *      before that station's operation.
 *   4. A LIVE RUN of the full mix: every form seen is a known form; a
 *      cross-dock unit is a pallet-load at every tick; a full pallet is never
 *      a carton / tote / parcel; a case-pick unit is seen as cartons after the
 *      depalletiser and as a wrapped pallet after the wrapper; a return
 *      arrives as a parcel; the drawable units carry the same forms.
 *   5. LEGACY BYTE-IDENTITY: with no mix declared every form is exactly the
 *      stage-driven v3.23 form at every tick, and the documented legacy
 *      tables are unchanged.
 *   6. DRAWING smoke: a wrapped pallet draws at every tier through a mock
 *      context with finite coordinates and no throw.
 *   7. Shipped wiring: sample() passes the route, makeRoute carries
 *      startsInStock, run-all lists this file, sw.js bumped to wt-v139.
 *
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "flowsim.js", "goods.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing;
const F = global.WT.flowsim;
const G = global.WT.goods;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const dedup = (arr) => arr.filter((v, i) => i === 0 || v !== arr[i - 1]);

// The hand-built floor from verify_stations.js: every station present.
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
const snapshot = JSON.stringify(FLOOR);

console.log("v3.30 R3 - the goods follow the operation, not the stage");
console.log("=".repeat(72));

/* ---- 1. the table --------------------------------------------------- */
(function () {
  const ops = Object.keys(G.OP_FORM);
  check("1a. every transforming operation in OP_FORM is a real routing operation",
    ops.length >= 8 && ops.every((o) => !!R.OPERATIONS[o]), ops.join(","));
  check("1b. every form OP_FORM names is a real, sized form",
    ops.every((o) => G.FORMS.indexOf(G.OP_FORM[o]) >= 0 && G.sizeOf(G.OP_FORM[o]).f > 0));
  const wp = G.NOMINAL["wrapped-pallet"], pl = G.NOMINAL["pallet-load"];
  check("1c. wrapped-pallet is a real form with the pallet-load envelope (1.20 x 0.80 x 1.45 m nominal)",
    G.FORMS.indexOf("wrapped-pallet") >= 0 && wp && wp.f === pl.f && wp.l === pl.l && wp.z === pl.z && wp.f === 1.2);
  const keepers = ["receive", "qc-sample", "qc-final", "inspect", "putaway", "replen", "consolidate", "vas", "stage-out", "load", "scrap"];
  check("1d. the non-transforming operations (QC, put-away, replenish, consolidate, VAS, stage, load, inspect, scrap) are NOT in the table - they keep the incoming form",
    keepers.every((o) => !G.OP_FORM[o]));
})();

/* ---- 2. hand-derived sequences per archetype ------------------------ */
(function () {
  const rep = R.resolveAll(FLOOR);
  const EXPECT = {
    "full-pallet-out": ["pallet-load", "wrapped-pallet"],
    "case-pick": ["pallet-load", "carton", "pallet-load", "wrapped-pallet"],
    "piece-pick": ["pallet-load", "carton", "tote", "parcel"],
    "cross-dock": ["pallet-load"],
    "returns:restock": ["parcel", "carton"],
    "returns:scrap": ["parcel"],
    // In-stock routes begin WITH the pick (their first operation), so the
    // first form a walked unit shows is already the tote it was picked into;
    // the case on the shelf is the start form (2c), seen only before the pick.
    "vas": ["tote", "parcel"],
    "export-fragile": ["tote", "pallet-load", "wrapped-pallet"],
  };
  const bad = [];
  for (const id of Object.keys(EXPECT)) {
    const route = rep.routes.find((r) => r.routeId === id);
    if (!route || !route.ok) { bad.push(id + ": unresolved"); continue; }
    const seq = dedup(route.ops.map((op) => G.formAlong(route, op, false)));
    if (seq.join(">") !== EXPECT[id].join(">")) bad.push(id + ": " + seq.join(">"));
  }
  check("2a. the form sequence of every archetype matches the hand-derived chain (full pallet stays a pallet; case pick: pallet > cartons > pallet > wrapped; each pick: pallet > cartons > tote > parcel; cross-dock: pallet only; returns: parcel > carton / parcel; VAS: tote > parcel; export: tote > pallet > wrapped)",
    bad.length === 0, bad.join(" | ") || "8 routes exact");
  const fp = rep.routes.find((r) => r.routeId === "full-pallet-out");
  const fpForms = fp.ops.map((op) => G.formAlong(fp, op, false));
  check("2b. a full pallet is a pallet at put-away and at loading - the legacy 'put-away depalletises' and 'load = parcel' never apply to it",
    fpForms[fp.ops.indexOf("putaway")] === "pallet-load" && fpForms[fp.ops.indexOf("load")] === "wrapped-pallet");
  check("2c. the start form is honest: trailer loads are pallet-loads, returns arrive as parcels, in-stock routes start as a case on the shelf",
    G.startFormOf(rep.routes.find((r) => r.routeId === "cross-dock")) === "pallet-load" &&
    G.startFormOf(rep.routes.find((r) => r.routeId === "returns:scrap")) === "parcel" &&
    G.startFormOf(rep.routes.find((r) => r.routeId === "vas")) === "carton" && G.startFormOf(null) === "pallet-load");
})();

/* ---- 3. waiting semantics ------------------------------------------- */
(function () {
  const rep = R.resolveAll(FLOOR);
  const cp = rep.routes.find((r) => r.routeId === "case-pick");
  const pp = rep.routes.find((r) => r.routeId === "piece-pick");
  check("3a. queued at the depalletiser a case-pick unit is still the pallet-load it arrived as; served, it is cartons",
    G.formAlong(cp, "depalletise", true) === "pallet-load" && G.formAlong(cp, "depalletise", false) === "carton");
  check("3b. queued at the pack bench an each-pick unit is still a tote; served, it is a parcel",
    G.formAlong(pp, "pack", true) === "tote" && G.formAlong(pp, "pack", false) === "parcel");
  check("3c. an operation that is not on the route yields the start form (defensive, never a throw)",
    G.formAlong(cp, "no-such-op", false) === "pallet-load" && G.formAlong(null, "pack", false) === "pallet-load");
})();

/* ---- 4. a live run of the full mix ---------------------------------- */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 21, mix: R.defaultMix() });
  const st = F.state(plan);
  const support = G.supportIndex(FLOOR);
  let unknown = 0, crossBad = 0, fullBad = 0, sawCarton = false, sawWrapped = false, retBad = 0, mismatch = 0, samples = 0;
  for (let i = 0; i < 600; i++) {
    F.step(st, 1);
    const drawn = {};
    for (const u of G.units(st, support)) drawn[u.id] = u.form;
    for (const mu of st.mus) {
      const r = plan.routes[mu.route];
      const f = G.formFor(mu, r);
      samples++;
      if (G.FORMS.indexOf(f) < 0) unknown++;
      if (r.archetype === "cross-dock" && f !== "pallet-load") crossBad++;
      if (r.archetype === "full-pallet-out" && (f === "carton" || f === "tote" || f === "parcel")) fullBad++;
      if (r.archetype === "case-pick" && f === "carton") sawCarton = true;
      if (r.archetype === "case-pick" && f === "wrapped-pallet") sawWrapped = true;
      if (r.archetype === "returns" && mu.op === "receive" && f !== "parcel") retBad++;
      if (drawn[mu.id] !== undefined && drawn[mu.id] !== f) mismatch++;
    }
  }
  check("4a. every form seen across " + samples + " unit-ticks is a known form", unknown === 0);
  check("4b. a cross-dock unit is a pallet-load at EVERY tick of its life", crossBad === 0);
  check("4c. a full pallet is never drawn as a carton, a tote or a parcel", fullBad === 0);
  check("4d. a case-pick unit is seen as CARTONS after the depalletiser and as a WRAPPED PALLET after the wrapper", sawCarton && sawWrapped);
  check("4e. every return arrives as a parcel", retBad === 0);
  check("4f. the drawable units (G.units) carry exactly the forms the model computes", mismatch === 0);
  check("4g. conservation untouched by the layer: spawned == in-flight + completed", st.spawned === st.inflight + st.completed);
})();

/* ---- 5. legacy byte-identity ---------------------------------------- */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 21 }); // no mix: the legacy spine only
  const st = F.state(plan);
  let diff = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    F.step(st, 1);
    for (const mu of st.mus) { n++; if (G.formFor(mu, plan.routes[mu.route]) !== G.formFor(mu)) diff++; }
  }
  check("5a. with NO mix declared the form is the stage-driven v3.23 form at every one of " + n + " unit-ticks (route 0 is the legacy spine)",
    diff === 0 && plan.routes.length === 1 && plan.routes[0].legacy === true);
  check("5b. the documented legacy tables are unchanged (5 stages, 5 transforms, receiving = pallet-load ... shipping = parcel)",
    Object.keys(G.STAGE_FORM).length === 5 && G.TRANSFORMS.length === 5 &&
    G.STAGE_FORM.receiving === "pallet-load" && G.STAGE_FORM.storage === "carton" &&
    G.STAGE_FORM.picking === "tote" && G.STAGE_FORM.packing === "parcel" && G.STAGE_FORM.shipping === "parcel");
})();

/* ---- 6. drawing smoke ----------------------------------------------- */
(function () {
  let calls = 0, nonFinite = 0, threw = null;
  const ctx = new Proxy({ canvas: {}, lineWidth: 1, globalAlpha: 1 }, {
    get(t, k) { if (k in t) return t[k]; return function () { calls++; for (const a of arguments) if (typeof a === "number" && !isFinite(a)) nonFinite++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  const project = (x, y, z) => ({ x: x * 20, y: y * 20 - (z || 0) * 12 });
  const u = { id: 7, form: "wrapped-pallet", size: G.sizeOf("wrapped-pallet"), x: 5, y: 5, z: 0, heading: 0.3, ride: "floor", stage: "packing", status: "active", queueIndex: -1, hot: false };
  try {
    for (const tier of ["rich", "glyph", "icon"]) for (const theme of ["light", "dark"]) G.draw(ctx, u, { project, cellPx: 24, tier, theme, stageColor: "#0d9488" });
  } catch (e) { threw = e; }
  check("6.  a wrapped pallet draws at every tier in both themes through a mock context: no throw, finite coordinates only",
    !threw && calls > 0 && nonFinite === 0, threw ? String(threw) : calls + " calls");
})();

/* ---- 7. shipped wiring + hygiene ------------------------------------- */
(function () {
  const goods = read("goods.js"), flow = read("flowsim.js"), sw = read("sw.js"), runall = read("test/run-all.mjs");
  check("7a. sample() hands the unit's own route to formFor, and makeRoute carries startsInStock",
    /formFor\(mu, route, so\)/.test(goods) /* v3.49: the opts ride along for MACHINE_STAGE_FORM */ && /startsInStock: !!res\.startsInStock/.test(flow));
  check("7b. test/run-all.mjs lists verify_forms.js", /verify_forms\.js/.test(runall));
  check("7c. sw.js cache bumped to wt-v139 (trail preserved: previously wt-v138)",
    /CACHE_VERSION\s*=\s*"wt-v139"/.test(sw) && /Previously wt-v138/.test(sw));
  check("7d. no Date / Math.random CALL in goods.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(goods));
  check("7e. nothing above mutated the hand-built floor", JSON.stringify(FLOOR) === snapshot);
})();

/* ---- 8. the rework drawing by op index (v3.57) ---------------------- */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 21, mix: ["piece-pick"], errors: { "mis-pick": 0.02 } });
  const route = plan.routes.find((r) => r.error);
  const picks = route.waypoints.map((w, i) => (w.op === "piece-pick" ? i : -1)).filter((i) => i >= 0);
  const first = picks[0], second = picks[picks.length - 1];
  check("8a. opIndexAt walks the waypoints of the rework route: the first pick is op 4, the verification op 5, the second pick op 6; out of range is -1",
    route.ops[4] === "piece-pick" && route.ops[5] === "verify-pick" && route.ops[6] === "piece-pick" && G.opIndexAt(route, first) === 4 && G.opIndexAt(route, second - 1) === 5 && G.opIndexAt(route, second) === 6 && G.opIndexAt(route, -1) === -1 && G.opIndexAt(null, 0) === -1);
  check("8b. a unit queued for its re-pick is drawn as the tote it already picked, one queued for its first pick as the carton it is about to pick from; formAlong without an index keeps the first occurrence",
    G.formFor({ op: "piece-pick", status: "queued", seg: second }, route) === "tote" && G.formFor({ op: "piece-pick", status: "queued", seg: first }, route) === "carton" &&
    G.formAlong(route, "piece-pick", true, 6) === "tote" && G.formAlong(route, "piece-pick", true) === "carton" && G.formAlong(route, "piece-pick", false, 6) === "tote" && G.formAlong(route, "piece-pick", false) === "tote");
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL FORM CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
