/* =====================================================================
 * Logistics Flow Studio - verify_stations.js
 * v3.29 R2 "THE MISSING STATIONS" - headless verification
 * ---------------------------------------------------------------------
 * The defect this release fixes: the order-driven router (v3.25) declared
 * eight order archetypes, but THREE of them (case pick, each pick and
 * value-add) could never be routed on ANY floor because the app had no
 * element type for a depalletiser or a value-add bench, and goods-in QC had
 * to borrow the returns bench. R2 adds three real element types - a Goods-in
 * QC bench, a Depalletiser and a Value-add / kitting bench - and binds the
 * router's strict anchors to them.
 *
 * This harness proves the stations are real everywhere a station must be:
 *   1. DOMAIN: the three types exist, are 0-capacity "flow" equipment with
 *      the declared footprints and heights, and sit in the palette order.
 *   2. SHAPE REGISTRY: each has a 2D glyph, a 3D form and an icon that draws
 *      through a mock context without throwing.
 *   3. THE OTHER LAYERS agree: iso heights, floor stage tint, palette group
 *      + clone base, the workforce (benches are manned, the machine is not),
 *      the goods carrier surface, and the analytics equipment catalogue.
 *   4. ANCHOR RESOLUTION on a hand-built floor with HAND-COMPUTED centroids:
 *      qc / depalletise / vas resolve onto their own elements; with the QC
 *      bench removed, QC borrows the returns bench and is marked SHARED
 *      (disclosed on the step); with both removed it is absent and the
 *      message names both elements. Nothing is 'pending' any more.
 *   5. ALL EIGHT ARCHETYPES resolve on that floor; the routes visit the new
 *      stations in the right order and at the right coordinates.
 *   6. A LIVE RUN of the full default mix on that floor is spawnable, conserved
 *      at every tick, spawns every order type, never sends a cross-dock unit
 *      into storage, and shows a case-pick unit at the depalletise operation.
 *   7. Route review reports every recipe as placed or shared, none missing.
 *   8. Determinism + no input mutation.
 *
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "floor.js", "library.js", "shapes.js", "workers.js", "goods.js",
                 "routing.js", "flowsim.js", "route-review.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const D = global.WT.domain;
const S = global.WT.shapes;
const R = global.WT.routing;
const F = global.WT.flowsim;
const W = global.WT.workers;
const G = global.WT.goods;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const TYPES = ["qc-bench", "depalletiser", "vas-station"];
const SPEC = {
  "qc-bench": { w: 3, d: 2, h: 1.1, stage: "receiving", task: "pack" },
  "depalletiser": { w: 3, d: 3, h: 2.4, stage: "receiving", task: null },
  "vas-station": { w: 3, d: 2, h: 1.1, stage: "packing", task: "pack" },
};

console.log("v3.29 R2 - the missing stations: QC bench, depalletiser, VAS bench");
console.log("=".repeat(72));

/* ---- 1. Domain ---------------------------------------------------- */
(function () {
  const inDomain = TYPES.every((t) => D.ELEMENTS[t] && D.ELEMENTS[t].id === t && D.ELEMENTS[t].category === "flow");
  check("1a. the three R2 types are in the domain as category 'flow' (processing equipment, not storage)", inDomain);
  const zeroCap = TYPES.every((t) => D.elementCapacity({ type: t, w: D.ELEMENTS[t].w, d: D.ELEMENTS[t].d }) === 0);
  check("1b. they hold ZERO pallet positions", zeroCap);
  const sized = TYPES.every((t) => D.ELEMENTS[t].w === SPEC[t].w && D.ELEMENTS[t].d === SPEC[t].d && D.ELEMENTS[t].heightM === SPEC[t].h);
  check("1c. declared footprints + heights: QC bench 3x2 @1.1 m, depalletiser 3x3 @2.4 m, VAS bench 3x2 @1.1 m", sized);
  const order = D.paletteOrder;
  const inPal = TYPES.every((t) => order.indexOf(t) > order.indexOf("returns-station"));
  check("1d. all three sit in the palette order, after the returns station", inPal, TYPES.map((t) => order.indexOf(t)).join(","));
  const honest = TYPES.every((t) => /[Ss]ynthetic teaching element/.test(D.ELEMENTS[t].desc) && /not a vendor spec/.test(D.ELEMENTS[t].desc));
  check("1e. every description carries the honesty label (synthetic teaching element, not a vendor spec)", honest);
})();

/* ---- 2. Shape registry (2D glyph + 3D form + icon) ---------------- */
(function () {
  const meta = TYPES.every((t) => S.meta[t] && String(S.meta[t].glyph2d).length > 3 && String(S.meta[t].form3d).length > 3);
  check("2a. the registry describes a 2D glyph and a 3D form for each", meta,
    TYPES.map((t) => (S.meta[t] || {}).glyph2d).join(" | "));
  const icons = TYPES.every((t) => typeof S.ICONS[t] === "function");
  check("2b. each has an icon function", icons);
  // A mock 2D context that records calls and never throws; every numeric
  // argument must be finite.
  let calls = 0, nonFinite = 0, threw = null;
  const ctx = new Proxy({ canvas: {}, lineWidth: 1 }, {
    get(target, k) {
      if (k in target) return target[k];
      return function () { calls++; for (const a of arguments) if (typeof a === "number" && !isFinite(a)) nonFinite++; };
    },
    set(target, k, v) { target[k] = v; return true; },
  });
  try { for (const t of TYPES) S.ICONS[t](ctx, 12, 12, 7); } catch (e) { threw = e; }
  check("2c. the three icons draw through a mock context: no throw, finite coordinates only",
    !threw && calls > 0 && nonFinite === 0, threw ? String(threw) : calls + " calls");
  const src = read("shapes.js");
  check("2d. the rich (zoomed-in) tier stages WORK IN PROGRESS on the two benches in 2D and 3D",
    /"qc-bench": r2StationWork, "vas-station": r2StationWork/.test(src) && /"qc-bench": f3StationWork, "vas-station": f3StationWork/.test(src));
})();

/* ---- 3. The other layers agree ------------------------------------ */
(function () {
  const iso = read("iso.js");
  check("3a. iso.js carries the same heights as the domain",
    /"qc-bench": 1\.1,/.test(iso) && /"depalletiser": 2\.4,/.test(iso) && /"vas-station": 1\.1,/.test(iso));
  const st = global.WT.floor && typeof global.WT.floor.stageOfType === "function"
    ? TYPES.every((t) => global.WT.floor.stageOfType(t) === SPEC[t].stage)
    : /"qc-bench": "receiving", "depalletiser": "receiving", "vas-station": "packing"/.test(read("floor.js"));
  check("3b. floor stage tint: QC + depalletiser belong to receiving, the VAS bench to packing", st);
  const lib = read("library.js");
  check("3c. palette group 'Stations' + clone base 'station' for all three",
    /"qc-bench": "Stations", "depalletiser": "Stations", "vas-station": "Stations"/.test(lib) &&
    /"qc-bench": "station", "depalletiser": "station", "vas-station": "station"/.test(lib));
  const task = TYPES.every((t) => W.taskForType(t) === SPEC[t].task);
  check("3d. the workforce staffs the two benches (bench pose) and leaves the depalletiser unmanned (a machine)", task,
    TYPES.map((t) => t + "=" + W.taskForType(t)).join(" "));
  const bench = G.carrierOf({ type: "qc-bench" }), vas = G.carrierOf({ type: "vas-station" }), depal = G.carrierOf({ type: "depalletiser" });
  check("3e. goods sit on the bench top of both benches and on the depalletiser's infeed deck (0.45 m drawing constant)",
    bench && bench.kind === "bench" && Math.abs(bench.z - 1.1 * G.BENCH_TOP) < 1e-9 &&
    vas && vas.kind === "bench" && Math.abs(vas.z - 1.1 * G.BENCH_TOP) < 1e-9 &&
    depal && depal.kind === "bench" && depal.z === 0.45);
  const an = read("analytics.js");
  check("3f. the analytics equipment catalogue prices the benches with the workstations and the depalletiser as its own class",
    /"returns-station", "qc-bench", "vas-station"\]/.test(an) && /key: "depalletiser"/.test(an));
})();

/* ---- 4 + 5. Anchor resolution + every archetype on a hand-built floor */
// Hand-computed centroids: x + w/2, y + d/2.
const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },          // (16, 3)
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },           // (7.5, 3)
    { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },     // (11.5, 3.5)
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 },  // (31.5, 3)
    { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },   // (21.5, 19)
    { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },   // (25, 19)
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 },     // (29.5, 19)
    { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const snapshot = JSON.stringify(FLOOR);
(function () {
  const A = F.anchors(FLOOR);
  check("4a. qc resolves onto the DEDICATED QC bench at its hand-computed centroid (7.5, 3), source 'element', not shared",
    A.qc.present === true && r6(A.qc.x) === 7.5 && r6(A.qc.y) === 3 && A.qc.source === "element" && !A.qc.shared, JSON.stringify([A.qc.x, A.qc.y, A.qc.source]));
  check("4b. depalletise resolves onto the depalletiser at (11.5, 3.5) - no longer 'pending'",
    A.depalletise.present === true && r6(A.depalletise.x) === 11.5 && r6(A.depalletise.y) === 3.5 && !A.depalletise.pending);
  check("4c. vas resolves onto the VAS bench at (29.5, 19)",
    A.vas.present === true && r6(A.vas.x) === 29.5 && r6(A.vas.y) === 19 && !A.vas.pending);
  check("4d. the anchor table itself binds depalletise -> depalletiser, vas -> vas-station, qc -> qc-bench (borrowing returns-station)",
    R.ANCHORS.depalletise.element === "depalletiser" && !R.ANCHORS.depalletise.pending &&
    R.ANCHORS.vas.element === "vas-station" && !R.ANCHORS.vas.pending &&
    R.ANCHORS.qc.element === "qc-bench" && R.ANCHORS.qc.sharedWith === "returns-station");

  const noQc = { gridW: 40, gridH: 24, cell: 1, elements: FLOOR.elements.filter((e) => e.id !== "qc") };
  const B = F.anchors(noQc);
  const cp = R.resolveRoute("case-pick", B);
  const qcStep = cp.steps.find((s) => s.op === "qc-sample");
  check("4e. with the QC bench removed, QC BORROWS the returns bench at (31.5, 3), marked shared, and the step discloses it",
    B.qc.present === true && r6(B.qc.x) === 31.5 && r6(B.qc.y) === 3 && B.qc.shared === "returns-station" &&
    /shared:returns-station/.test(B.qc.source) && qcStep && qcStep.sharedWith === "returns-station" && cp.shared.length === 2);
  const withQc = R.resolveRoute("case-pick", A);
  check("4f. with the QC bench present the same step is NOT reported shared (the disclosure is truthful either way)",
    withQc.ok && !withQc.steps.find((s) => s.op === "qc-sample").sharedWith && withQc.shared.length === 1 && withQc.shared[0].anchor === "palletise");
  const bare = { gridW: 40, gridH: 24, cell: 1, elements: FLOOR.elements.filter((e) => e.id !== "qc" && e.id !== "ret") };
  const C = F.anchors(bare);
  const xd = R.resolveRoute("cross-dock", C);
  check("4g. with both benches removed, QC is absent and the message names BOTH elements the user could place",
    C.qc.present === false && !xd.ok && /qc-bench/.test(xd.message) && /returns-station/.test(xd.message) && /Nothing has been re-routed/.test(xd.message),
    xd.message.slice(0, 110) + "...");
  const missing = Object.keys(R.ANCHORS).filter((k) => R.ANCHORS[k].pending);
  check("4h. no anchor in the table is 'pending' any more", missing.length === 0, missing.join(",") || "none");
})();

(function () {
  const rep = R.resolveAll(FLOOR);
  const routes = rep.routes;
  const allOk = routes.every((r) => r.ok);
  check("5a. ALL routes resolve on the hand-built floor: 8 archetypes, returns as two outcomes = 9 routes, none missing",
    allOk && routes.length === 9, routes.filter((r) => !r.ok).map((r) => r.routeId).join(",") || "9 ok");
  const cp = routes.find((r) => r.routeId === "case-pick");
  const seq = cp.steps.map((s) => s.op).join(">");
  check("5b. case pick visits the depalletiser BEFORE put-away and the wrapper AFTER palletising",
    seq === "receive>qc-sample>depalletise>putaway>case-pick>consolidate>palletise>wrap>load", seq);
  const dep = cp.steps.find((s) => s.op === "depalletise");
  check("5c. its depalletise step lands at the machine's hand-computed centroid (11.5, 3.5)", r6(dep.x) === 11.5 && r6(dep.y) === 3.5);
  const vas = routes.find((r) => r.routeId === "vas");
  const vseq = vas.steps.map((s) => s.op + "@" + r6(s.x) + "," + r6(s.y)).join(" ");
  check("5d. value-add starts at the pick face, works at the VAS bench (29.5, 19), packs at (21.5, 19) and loads",
    vas.ok && vas.startsInStock && vas.steps[1].op === "vas" && r6(vas.steps[1].x) === 29.5 && r6(vas.steps[1].y) === 19 &&
    vas.steps[2].op === "pack" && r6(vas.steps[2].x) === 21.5 && r6(vas.steps[2].y) === 19, vseq);
  const pp = routes.find((r) => r.routeId === "piece-pick");
  check("5e. each pick is routable (eight touches) and passes the depalletiser second",
    pp.ok && pp.steps.length === 8 && pp.steps[1].op === "depalletise", pp.steps.map((s) => s.op).join(">"));
  const xd = routes.find((r) => r.routeId === "cross-dock");
  check("5f. cross-dock still never touches storage", xd.ok && !xd.touchesStorage && xd.invariantOk);
  const shared = routes.filter((r) => r.shared.length);
  check("5g. the ONLY shared binding left is palletise on the stretch-wrap element (a documented gap), on case pick + export",
    shared.length === 2 && shared.every((r) => r.shared.length === 1 && r.shared[0].sharedWith === "stretch-wrap") &&
    shared.map((r) => r.routeId).sort().join(",") === "case-pick,export-fragile", shared.map((r) => r.routeId).join(","));
})();

/* ---- 6. A live run of the FULL default mix ------------------------ */
(function () {
  const plan = F.spawnPlan(FLOOR, { seed: 11, mix: R.defaultMix() });
  check("6a. the full default mix is spawnable on this floor with NOTHING unfulfillable",
    plan.spawnable && plan.unfulfillable.length === 0 && plan.routes.length === 9, "routes=" + plan.routes.length + " unfulfillable=" + plan.unfulfillable.length);
  const st = F.state(plan);
  let conserved = true, crossInStorage = false, sawDepal = false, ticks = 0;
  for (let i = 0; i < 500; i++) {
    F.step(st, 1); ticks++;
    if (st.spawned !== st.inflight + st.completed) conserved = false;
    for (const mu of st.mus) {
      if (mu.archetype === "cross-dock" && (mu.stage === "storage" || mu.stage === "picking")) crossInStorage = true;
      if (mu.archetype === "case-pick" && mu.op === "depalletise") sawDepal = true;
    }
  }
  check("6b. spawned == in-flight + completed at EVERY one of " + ticks + " ticks", conserved);
  const pa = st.perArchetype;
  const spawnedTypes = Object.keys(pa).filter((k) => pa[k].spawned > 0);
  check("6c. every order type (and both returns outcomes) actually spawned units", spawnedTypes.length === 8, spawnedTypes.length + " of 8: " + spawnedTypes.join(","));
  check("6d. no cross-dock unit ever entered storage or picking", !crossInStorage);
  check("6e. a case-pick unit was observed AT the depalletise operation (the new station is on the walked route, not just in the table)", sawDepal);
  check("6f. completions happened (units really walk the new routes to the end)", st.completed > 0, st.completed + " completed");
})();

/* ---- 7. Route review ---------------------------------------------- */
(function () {
  const review = global.WT.routeReview.build(FLOOR);
  const statuses = {};
  for (const r of review.rows) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const none = review.rows.every((r) => r.status === "placed" || r.status === "shared");
  check("7a. route review reports every recipe on this floor as placed or shared - nothing missing, nothing unsupported", none, JSON.stringify(statuses));
  const empty = global.WT.routeReview.build({ gridW: 40, gridH: 24, elements: [] });
  const pp = empty.rows.find((r) => r.archetype === "piece-pick");
  const dep = pp.steps.find((s) => s.id === "depalletise");
  check("7b. on an empty floor the depalletise step is MISSING (not 'unsupported') and tells the user to add a Depalletiser",
    pp.status === "missing" && dep.status === "missing" && /Add a Depalletiser/.test(dep.note), dep.note);
})();

/* ---- 8. Determinism + no mutation --------------------------------- */
(function () {
  const a = JSON.stringify(F.spawnPlan(FLOOR, { seed: 11, mix: R.defaultMix() }).routes.map((r) => r.waypoints));
  const b = JSON.stringify(F.spawnPlan(FLOOR, { seed: 11, mix: R.defaultMix() }).routes.map((r) => r.waypoints));
  check("8a. planning the same floor twice yields byte-identical routes", a === b);
  check("8b. nothing above mutated the hand-built floor", JSON.stringify(FLOOR) === snapshot);
  const src = TYPES.map((t) => read("domain.js")).join("") + read("routing.js") + read("flowsim.js");
  check("8c. no Date / Math.random CALL entered domain.js, routing.js or flowsim.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(src));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL R2 STATION CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
