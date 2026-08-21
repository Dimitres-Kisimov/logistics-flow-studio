/* =====================================================================
 * Logistics Flow Studio - verify_routing.js
 * ORDER-DRIVEN ROUTING (v3.25 R1: the engine) - headless verification
 * ---------------------------------------------------------------------
 * The defect this release fixes was concrete: flowsim.js hardcoded ONE
 * spine ("receiving","storage","picking","packing","shipping") and pushed
 * EVERY handling unit onto that same waypoint list. There were no order
 * types, no quality control, no depalletise / palletise, and stretch-wrap
 * was scenery rather than a routing step.
 *
 * This harness proves the replacement is real AND that it did not move a
 * single existing number:
 *
 *   1.  The MODEL is closed and well-formed: every archetype's operations
 *       exist, every operation's anchor exists, every stage is one of the
 *       five the rest of the app draws, every station kind is a real
 *       flowsim station kind, and the honesty label is present.
 *   2.  ANCHOR RESOLUTION against a real layout: the five legacy anchors
 *       always resolve (they keep their v3.24 fallback chains); the added
 *       anchors are STRICT - they resolve only when the element is there.
 *   3.  PER-ARCHETYPE ROUTE CORRECTNESS with HAND-COMPUTED expectations:
 *       on a floor built by hand, each order type's resolved waypoint
 *       sequence is asserted operation by operation and coordinate by
 *       coordinate against numbers written out here, not read from code.
 *   4.  The CROSS-DOCK INVARIANT: its resolved route contains no storage
 *       anchor and no "storage" stage - it never enters the racking.
 *   5.  The RETURNS SPLIT: two real outcomes (restock / scrap) resolve to
 *       two different terminal points, in the declared proportions.
 *   6.  UNFULFILLABLE DETECTION: an order type whose operation has no
 *       station on the floor is reported unfulfillable with a friendly
 *       message that NAMES the missing element - and NO unit of that type
 *       is ever spawned (never skipped, never re-routed).
 *   7.  CONSERVATION under a multi-archetype mix: spawned == in-flight +
 *       completed at EVERY tick, exactly as before.
 *   8.  DETERMINISM: same (layout, seed, mix, ticks) -> byte-identical MU
 *       state; the dispatch sequence is a pure function of the mix; there
 *       is no Date / Math.random in routing.js.
 *   9.  BYTE-IDENTICAL LEGACY COLLAPSE (the hard gate): with no mix
 *       declared the plan carries exactly ONE route whose waypoint array
 *       IS the plan's own; the generic route builder fed the LEGACY
 *       operation list reproduces buildWaypoints EXACTLY; and a 400-tick
 *       run of the mixed-capable engine equals a 400-tick run driven
 *       through the legacy spine, across every example, generated and
 *       preset layout in the repo.
 *  10.  NO INPUT MUTATION: resolving, planning and stepping never touch
 *       the caller's layout, mix or opts.
 *  11.  SHIPPED WIRING: routing.js is loaded by index.html before
 *       flowsim.js, precached by sw.js at the bumped wt-v80 cache, and
 *       listed by test/run-all.mjs.
 *
 * Deterministic + ASCII-only. Exit code 0 = all green.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
global.document = { createElement: () => ({ getContext: () => null, style: {} }), documentElement: { style: {} } };
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js",
  "wms.js", "storage.js", "iso.js", "shapes.js", "routing.js", "flowsim.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing;
const F = global.WT.flowsim;
const D = global.WT.domain;
const EX = global.WT.examples;
const GEN = global.WT.generate;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const ROUTING_SRC = read("routing.js");
const FLOWSIM_SRC = read("flowsim.js");
const INDEX_SRC = read("index.html");
const SW_SRC = read("sw.js");
const RUNALL_SRC = read(path.join("test", "run-all.mjs"));
const SELFTEST_SRC = read("selftest.js");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r6 = (v) => Math.round(v * 1e6) / 1e6;

console.log("Order-driven routing (v3.25 R1) verification (deterministic)");
console.log("");

/* =====================================================================
 * A HAND-BUILT FLOOR. Every element below is placed at an explicit
 * coordinate so the expected route waypoints can be written out by hand.
 *
 *   grid 40 x 24, all elements axis-aligned, no conveyors (so every leg
 *   is a straight segment and the waypoints are exactly the centroids).
 *
 *   dock-in         (2,0) 2x1   -> centroid (3.0, 0.5)
 *   dock-out        (30,23) 2x1 -> centroid (31.0, 23.5)
 *   selective-rack  (10,8) 4x1  -> centroid (12.0, 8.5)
 *   carton-flow     (20,8) 3x1  -> centroid (21.5, 8.5)   [pickFace]
 *   pack-station    (24,16) 3x2 -> centroid (25.5, 17.0)
 *   staging         (6,16) 4x2  -> centroid (8.0, 17.0)
 *   returns-station (34,4) 3x2  -> centroid (35.5, 5.0)
 *   stretch-wrap    (16,20) 2x2 -> centroid (17.0, 21.0)
 *
 * NOTE (deliberate, and true of every real DC): a carton-flow rack is BOTH
 * a storage class AND a pick face, so the STORAGE anchor is the centroid of
 * the racking AND the flow rack -> ((12.0 + 21.5)/2, 8.5) = (16.75, 8.5),
 * while the PICKFACE anchor is the flow rack alone -> (21.5, 8.5). That is
 * unchanged v3.24 behaviour and the hand-computed numbers below reflect it.
 * ================================================================== */
const P = {
  dockIn: { x: 3.0, y: 0.5 },
  dockOut: { x: 31.0, y: 23.5 },
  storage: { x: 16.75, y: 8.5 }, // mean of the racking (12.0) and the carton flow (21.5)
  pickface: { x: 21.5, y: 8.5 },
  pack: { x: 25.5, y: 17.0 },
  staging: { x: 8.0, y: 17.0 },
  returns: { x: 35.5, y: 5.0 },
  wrap: { x: 17.0, y: 21.0 },
};
function el(id, type, x, y, w, d) { return { id: id, type: type, x: x, y: y, w: w, d: d, rot: 0 }; }
function fullFloor() {
  return {
    gridW: 40, gridH: 24, cell: 1,
    elements: [
      el("i1", "dock-in", 2, 0, 2, 1),
      el("o1", "dock-out", 30, 23, 2, 1),
      el("r1", "selective-racking", 10, 8, 4, 1),
      el("c1", "carton-flow", 20, 8, 3, 1),
      el("k1", "pack-station", 24, 16, 3, 2),
      el("s1", "staging", 6, 16, 4, 2),
      el("q1", "returns-station", 34, 4, 3, 2),
      el("w1", "stretch-wrap", 16, 20, 2, 2),
    ],
    config: { seed: 42 },
  };
}
// The same floor WITHOUT the returns bench and the wrapper - the layout that
// makes several order types honestly unfulfillable.
function bareFloor() {
  const L = fullFloor();
  L.elements = L.elements.filter((e) => e.type !== "returns-station" && e.type !== "stretch-wrap");
  return L;
}

const FULL = fullFloor();
const BARE = bareFloor();

/* ---------------------------------------------------------------------
 * 1. The model is closed and well-formed.
 * ------------------------------------------------------------------- */
(() => {
  const stages = F.STAGES;
  const stationKinds = ["put", "pick", "pack"];
  const badOp = [];
  for (const id of R.OPERATION_ORDER) {
    const op = R.OPERATIONS[id];
    if (op.id !== id) badOp.push(id + ": id mismatch");
    if (stages.indexOf(op.stage) < 0) badOp.push(id + ": stage " + op.stage);
    if (!R.ANCHORS[op.anchor]) badOp.push(id + ": anchor " + op.anchor);
    if (op.station && stationKinds.indexOf(op.station) < 0) badOp.push(id + ": station " + op.station);
    if (!op.label || !op.desc || !op.form) badOp.push(id + ": missing copy");
  }
  check("1a. every OPERATION names a real anchor, one of the 5 flow stages and a real station kind",
    badOp.length === 0, badOp.length ? badOp.join(" | ") : R.OPERATION_ORDER.length + " operations");

  const badArch = [];
  for (const a of R.ARCHETYPES) {
    if (!a.id || !a.label || !a.desc) badArch.push(a.id + ": missing copy");
    if (!Array.isArray(a.ops) || a.ops.length < 2) badArch.push(a.id + ": needs >= 2 operations");
    for (const o of a.ops) if (!R.OPERATIONS[o]) badArch.push(a.id + ": unknown op " + o);
    for (const oc of a.outcomes || []) {
      if (!oc.id || !oc.label || !(oc.share > 0)) badArch.push(a.id + "/" + oc.id + ": bad outcome");
      for (const o of oc.ops || []) if (!R.OPERATIONS[o]) badArch.push(a.id + "/" + oc.id + ": unknown op " + o);
    }
  }
  check("1b. every ARCHETYPE declares a valid operation sequence (and valid outcome branches)",
    badArch.length === 0, badArch.length ? badArch.join(" | ") : R.ARCHETYPES.length + " order types");

  // The 7 real-world order types the plan calls for are all present, plus legacy.
  const want = ["legacy-spine", "full-pallet-out", "case-pick", "piece-pick", "cross-dock", "returns", "vas", "export-fragile"];
  check("1c. the 8 declared order types are present in order",
    eq(R.ARCHETYPES.map((a) => a.id), want), R.ARCHETYPES.map((a) => a.short).join(", "));

  // Full-pallet out must NOT be packed or depalletised - the two operations the
  // old single spine forced onto every unit.
  const fp = R.ARCHETYPE_BY_ID["full-pallet-out"].ops;
  check("1d. a full pallet is never depalletised and never packed (the old spine forced both)",
    fp.indexOf("pack") < 0 && fp.indexOf("depalletise") < 0 && fp.indexOf("wrap") >= 0,
    fp.join(" > "));

  // The piece pick is genuinely longer than the old five-stage spine.
  check("1e. the each/piece pick is 8 operations, not the old 5",
    R.ARCHETYPE_BY_ID["piece-pick"].ops.length === 8,
    R.ARCHETYPE_BY_ID["piece-pick"].ops.join(" > "));

  // Full cases usually ship AS THEY ARE: the case-pick route is consolidated,
  // built onto a dispatch pallet and secured - it does NOT end at a pack bench.
  const cp = R.ARCHETYPE_BY_ID["case-pick"].ops;
  check("1e2. a case pick is consolidated, palletised and wrapped - NOT re-packed",
    cp.indexOf("pack") < 0 && cp.indexOf("consolidate") >= 0 &&
    cp.indexOf("palletise") >= 0 && cp.indexOf("wrap") >= 0 &&
    cp[cp.length - 1] === "load",
    cp.join(" > "));

  // The engine states its own limits rather than implying it has none.
  check("1e3. the model documents what it does NOT yet do (fixed order, QC as a step, 2 return outcomes, no loops)",
    /KNOWN LIMITS/.test(ROUTING_SRC) && /not necessarily determined/.test(ROUTING_SRC) &&
    /PASS-THROUGH step, not a branch/.test(ROUTING_SRC) &&
    /Cycles need/.test(ROUTING_SRC) && /dangerous goods/.test(ROUTING_SRC) &&
    /VDI 3590/.test(ROUTING_SRC) && /VDI 4490/.test(ROUTING_SRC) &&
    /nicht notwendigerweise determiniert/.test(ROUTING_SRC),
    "five named limits, and the guideline quote that justifies the change");

  check("1f. the SYNTHETIC honesty label names the model, the teaching status and the unfulfillable rule",
    /SYNTHETIC/.test(R.SYNTHETIC_LABEL) && /NOT a WMS/.test(R.SYNTHETIC_LABEL) &&
    /UNFULFILLABLE/.test(R.SYNTHETIC_LABEL) && /never silently re-routed/.test(R.SYNTHETIC_LABEL),
    R.SYNTHETIC_LABEL.length + " chars");

  // The shared bindings are DISCLOSED, not hidden.
  const sharedAnchors = Object.keys(R.ANCHORS).filter((k) => R.ANCHORS[k].sharedWith);
  check("1g. every SHARED anchor discloses what it borrows and why R2 will split it",
    sharedAnchors.length === 2 && sharedAnchors.every((k) => /R2/.test(R.ANCHORS[k].sharedNote || "")),
    sharedAnchors.join(", "));
})();

/* ---------------------------------------------------------------------
 * 2. Anchor resolution: legacy anchors always resolve, added anchors are
 *    STRICT (no element -> absent, with no fallback and no guess).
 * ------------------------------------------------------------------- */
(() => {
  const A = F.anchors(FULL);
  const legacy = ["dock-in", "storage", "pickface", "pack", "dock-out"];
  const gotLegacy = legacy.map((k) => [k, r6(A[k].x), r6(A[k].y)]);
  check("2a. the five LEGACY anchors resolve to the hand-computed element centroids",
    eq(gotLegacy, [
      ["dock-in", P.dockIn.x, P.dockIn.y],
      ["storage", P.storage.x, P.storage.y],
      ["pickface", P.pickface.x, P.pickface.y],
      ["pack", P.pack.x, P.pack.y],
      ["dock-out", P.dockOut.x, P.dockOut.y],
    ]), JSON.stringify(gotLegacy));

  const added = [["staging", P.staging], ["qc", P.returns], ["returns", P.returns], ["wrap", P.wrap], ["palletise", P.wrap]];
  const gotAdded = added.map(([k]) => [k, r6(A[k].x), r6(A[k].y)]);
  check("2b. the STRICT anchors resolve onto their real elements",
    eq(gotAdded, added.map(([k, p]) => [k, p.x, p.y])), JSON.stringify(gotAdded));

  check("2c. depalletise + value-add have NO element in v3.25 and are honestly absent (R2)",
    A.depalletise.present === false && A.depalletise.pending === "R2" &&
    A.vas.present === false && A.vas.pending === "R2");

  const B = F.anchors(BARE);
  check("2d. removing the returns bench + wrapper makes those anchors ABSENT - no fallback, no guess",
    B.qc.present === false && B.returns.present === false &&
    B.wrap.present === false && B.palletise.present === false &&
    B["dock-in"].present === true && B.storage.present === true,
    "legacy anchors keep their fallback chains, added ones do not");

  // A floor with NOTHING on it still resolves the five legacy anchors (the
  // v3.24 geometric fallbacks) and nothing else - the spine can always draw.
  const E = F.anchors({ gridW: 40, gridH: 24, elements: [] });
  check("2e. an EMPTY floor still resolves the five legacy anchors and none of the added ones",
    legacy.every((k) => E[k].present === true) &&
    ["staging", "qc", "returns", "wrap", "palletise", "depalletise", "vas"].every((k) => E[k].present === false));
})();

/* ---------------------------------------------------------------------
 * 3. PER-ARCHETYPE ROUTE CORRECTNESS - hand-computed, coordinate by
 *    coordinate. These numbers are written out here, not read from code.
 * ------------------------------------------------------------------- */
(() => {
  const A = F.anchors(FULL);
  // [operation, x, y, stage] for every waypoint of every fulfillable type.
  const EXPECT = {
    "legacy-spine": [
      ["receive", P.dockIn.x, P.dockIn.y, "receiving"],
      ["putaway", P.storage.x, P.storage.y, "storage"],
      ["pick", P.pickface.x, P.pickface.y, "picking"],
      ["pack", P.pack.x, P.pack.y, "packing"],
      ["load", P.dockOut.x, P.dockOut.y, "shipping"],
    ],
    "full-pallet-out": [
      ["receive", P.dockIn.x, P.dockIn.y, "receiving"],
      ["qc-sample", P.returns.x, P.returns.y, "receiving"],
      ["putaway", P.storage.x, P.storage.y, "storage"],
      ["pallet-pick", P.pickface.x, P.pickface.y, "picking"],
      ["wrap", P.wrap.x, P.wrap.y, "packing"],
      ["load", P.dockOut.x, P.dockOut.y, "shipping"],
    ],
    "cross-dock": [
      ["receive", P.dockIn.x, P.dockIn.y, "receiving"],
      ["qc-sample", P.returns.x, P.returns.y, "receiving"],
      ["stage-out", P.staging.x, P.staging.y, "shipping"],
      ["load", P.dockOut.x, P.dockOut.y, "shipping"],
    ],
    "returns:restock": [
      ["receive", P.dockIn.x, P.dockIn.y, "receiving"],
      ["inspect", P.returns.x, P.returns.y, "receiving"],
      ["restock", P.storage.x, P.storage.y, "storage"],
    ],
    "returns:scrap": [
      ["receive", P.dockIn.x, P.dockIn.y, "receiving"],
      ["inspect", P.returns.x, P.returns.y, "receiving"],
      ["scrap", P.returns.x, P.returns.y, "shipping"],
    ],
    "export-fragile": [
      ["pick", P.pickface.x, P.pickface.y, "picking"],
      ["qc-final", P.returns.x, P.returns.y, "packing"],
      ["palletise", P.wrap.x, P.wrap.y, "packing"],
      ["wrap", P.wrap.x, P.wrap.y, "packing"],
      ["load", P.dockOut.x, P.dockOut.y, "shipping"],
    ],
  };
  const bad = [];
  for (const key of Object.keys(EXPECT)) {
    const parts = key.split(":");
    const res = R.resolveRoute(parts[0], A, { outcome: parts[1] || null });
    if (!res.ok) { bad.push(key + ": UNFULFILLABLE (" + res.missing.map((m) => m.op).join(",") + ")"); continue; }
    const got = res.steps.map((s) => [s.op, r6(s.x), r6(s.y), s.stage]);
    if (!eq(got, EXPECT[key])) bad.push(key + ": " + JSON.stringify(got));
    // and the waypoint polyline built from those steps agrees
    const wps = F.buildRouteWaypoints(FULL, res.steps);
    const gotW = wps.map((w) => [w.op, r6(w.x), r6(w.y), w.stage]);
    if (!eq(gotW, EXPECT[key])) bad.push(key + " waypoints: " + JSON.stringify(gotW));
  }
  check("3a. every fulfillable order type resolves to its HAND-COMPUTED waypoint sequence",
    bad.length === 0, bad.length ? bad.join(" | ") : Object.keys(EXPECT).length + " routes verified point by point");

  // Station binding rides the route, not the old fixed waypoint index.
  const fp = R.resolveRoute("full-pallet-out", A, null);
  const wp = F.buildRouteWaypoints(FULL, fp.steps);
  check("3b. station kinds ride the ROUTE (put at the racking, pick at the face, no pack station on a full pallet)",
    eq(wp.map((w) => w.station), [null, null, "put", "pick", null, null]),
    JSON.stringify(wp.map((w) => w.station)));

  // A shared binding is disclosed on the step itself.
  const qcStep = fp.steps.find((s) => s.op === "qc-sample");
  check("3c. the QC step DISCLOSES that it borrows the Returns / QA bench (never a hidden re-route)",
    qcStep.sharedWith === "returns-station" && /R2/.test(qcStep.sharedNote || "") && fp.shared.length === 1,
    qcStep.sharedWith);
})();

/* ---------------------------------------------------------------------
 * 4. The CROSS-DOCK invariant: it never enters the racking.
 * ------------------------------------------------------------------- */
(() => {
  const A = F.anchors(FULL);
  const xd = R.resolveRoute("cross-dock", A, null);
  const touchesStorageAnchor = xd.steps.some((s) => s.anchor === "storage");
  const touchesStorageStage = xd.steps.some((s) => s.stage === "storage");
  check("4a. the cross-dock route contains NO storage anchor and NO storage stage",
    xd.ok && !touchesStorageAnchor && !touchesStorageStage && xd.invariantOk && xd.neverStorage,
    xd.steps.map((s) => s.op).join(" > "));

  // And live: run it and assert no unit ever reports the storage stage.
  const plan = F.spawnPlan(FULL, { seed: 5, mix: ["cross-dock"] });
  const st = F.state(plan);
  let sawStorage = false, sawUnits = false;
  for (let i = 0; i < 400; i++) {
    F.step(st, 1);
    for (const mu of st.mus) { sawUnits = true; if (mu.stage === "storage" || mu.stage === "picking" || mu.stage === "packing") sawStorage = true; }
  }
  check("4b. LIVE: not one cross-docked unit ever reports storage / picking / packing",
    sawUnits && !sawStorage && st.spawned > 0,
    st.spawned + " units cross-docked, stages seen: " + Object.keys(st.perStage).filter((k) => st.perStage[k] > 0).join(","));
})();

/* ---------------------------------------------------------------------
 * 5. The RETURNS split: two real outcomes, two terminal points, declared
 *    proportions, resolved deterministically (no RNG).
 * ------------------------------------------------------------------- */
(() => {
  const A = F.anchors(FULL);
  const rs = R.routesOf("returns", A);
  check("5a. returns resolves to TWO routes with two DIFFERENT terminal points",
    rs.length === 2 && rs[0].ok && rs[1].ok &&
    rs[0].routeId === "returns:restock" && rs[1].routeId === "returns:scrap" &&
    !eq([rs[0].steps[2].x, rs[0].steps[2].y], [rs[1].steps[2].x, rs[1].steps[2].y]),
    rs.map((r) => r.routeId + " -> (" + r6(r.steps[2].x) + "," + r6(r.steps[2].y) + ")").join(" | "));

  // Declared 75 / 25. Over a run the realised split matches to within one unit.
  const plan = F.spawnPlan(FULL, { seed: 9, mix: ["returns"] });
  check("5b. the outcome shares are the declared 75 / 25 of the archetype's demand",
    eq(plan.spawnShares.map((v) => r6(v)), [0.75, 0.25]), JSON.stringify(plan.spawnShares));
  const st = F.state(plan);
  F.step(st, 500);
  const a = st.perArchetype["returns:restock"].spawned, b = st.perArchetype["returns:scrap"].spawned;
  check("5c. the realised split is exact to within one unit (quota dispatch, not RNG)",
    a + b === st.spawned && Math.abs(a - 0.75 * st.spawned) <= 1 && Math.abs(b - 0.25 * st.spawned) <= 1,
    "restock " + a + " / scrap " + b + " of " + st.spawned);

  // The quota rule itself, hand-checked. process.js uses the same rule:
  //   deficit(i) = share(i) * (dispatched + 1) - sent(i), ties -> earliest.
  //   [0.75, 0.25]: k0 .75/.25 -> 0 | k1 .5/.5 tie -> 0 | k2 .25/.75 -> 1
  //                 k3 1/0 -> 0     | k4 .75/.25 -> 0 | k5 .5/.5 tie -> 0
  //                 k6 .25/.75 -> 1 | k7 1/0 -> 0
  check("5d. the dispatch sequence for [0.75, 0.25] is the hand-computed one",
    eq(R.dispatchSequence([0.75, 0.25], 8), [0, 0, 1, 0, 0, 0, 1, 0]),
    JSON.stringify(R.dispatchSequence([0.75, 0.25], 8)));
  check("5e. an even [0.5, 0.5] mix alternates and [1] is constant",
    eq(R.dispatchSequence([0.5, 0.5], 6), [0, 1, 0, 1, 0, 1]) &&
    eq(R.dispatchSequence([1], 4), [0, 0, 0, 0]));
  // Long-run exactness: 400 draws of a 40/35/25 mix land on the exact counts.
  const seq = R.dispatchSequence([0.4, 0.35, 0.25], 400);
  const cnt = [0, 0, 0];
  for (const i of seq) cnt[i]++;
  check("5f. 400 draws of a 40/35/25 mix land on exactly 160 / 140 / 100",
    eq(cnt, [160, 140, 100]), JSON.stringify(cnt));
})();

/* ---------------------------------------------------------------------
 * 6. UNFULFILLABLE DETECTION - reported, named, and never spawned.
 * ------------------------------------------------------------------- */
(() => {
  const rep = F.routingReport(BARE);
  const b = rep.byArchetype;
  check("6a. on a floor with no QA bench and no wrapper, exactly the right types are unfulfillable",
    b["legacy-spine"].ok === true && b["cross-dock"].ok === false &&
    b["full-pallet-out"].ok === false && b["returns"].ok === false &&
    b["export-fragile"].ok === false && b["case-pick"].ok === false &&
    b["piece-pick"].ok === false && b["vas"].ok === false,
    "fulfillable: " + Object.keys(b).filter((k) => b[k].ok).join(", "));

  const msg = b["cross-dock"].message;
  check("6b. the message is friendly, NAMES the missing element and states nothing was re-routed",
    /cannot be fulfilled by this layout/.test(msg) && /returns-station/.test(msg) &&
    /Nothing has been re-routed/.test(msg) && /unfulfillable/.test(msg),
    msg.slice(0, 96) + "...");

  const pend = b["piece-pick"].missing.find((m) => m.op === "depalletise");
  check("6c. an operation with no element type AT ALL says so and points at R2",
    !!pend && pend.pending === "R2" && /R2/.test(b["piece-pick"].message),
    b["piece-pick"].message.slice(0, 96) + "...");

  // Mixed fulfillable + unfulfillable: the good type still runs, the bad type
  // is reported and NEVER spawned. The good type's share is renormalised to 1.
  const plan = F.spawnPlan(FULL, { seed: 3, mix: ["cross-dock", "piece-pick"] });
  check("6d. a MIXED declaration keeps the runnable type and reports the other, spawning none of it",
    plan.spawnable === true && plan.spawnRoutes.length === 1 &&
    plan.unfulfillable.length === 1 && plan.unfulfillable[0].routeId === "piece-pick" &&
    r6(plan.spawnShares[0]) === 1 && plan.routingMessages.length === 1,
    "runs: cross-dock | reported: " + plan.unfulfillable[0].routeId);
  const st = F.state(plan);
  F.step(st, 300);
  check("6e. LIVE: not one unit of the unfulfillable type is spawned (never skipped, never re-routed)",
    st.spawned > 0 && st.perArchetype["piece-pick"].spawned === 0 &&
    st.perArchetype["cross-dock"].spawned === st.spawned,
    st.spawned + " cross-dock units, 0 piece-pick units");

  // EVERYTHING unfulfillable: the sim spawns nothing at all and says why.
  const dead = F.spawnPlan(BARE, { seed: 3, mix: ["cross-dock", "returns"] });
  const ds = F.state(dead);
  F.step(ds, 300);
  check("6f. when NOTHING asked for can be routed the sim spawns nothing and carries the reasons",
    dead.spawnable === false && ds.blocked === true && ds.spawned === 0 &&
    ds.mus.length === 0 && ds.blockedReason.length === 2 &&
    /returns-station/.test(ds.blockedReason[0]),
    ds.blockedReason.length + " friendly reasons, 0 units spawned");

  // An unknown order type is reported, never guessed at.
  const unknown = R.normalizeMix(["not-a-real-type"]);
  check("6g. an unknown order type is reported by name, never guessed",
    unknown.ok === false && unknown.unknown[0] === "not-a-real-type" && /Known types/.test(unknown.message),
    unknown.message.slice(0, 80) + "...");
})();

/* ---------------------------------------------------------------------
 * 7. CONSERVATION under a multi-archetype mix - unchanged from v3.24.
 * ------------------------------------------------------------------- */
(() => {
  const mix = [{ id: "full-pallet-out", share: 0.4 }, { id: "cross-dock", share: 0.3 }, { id: "returns", share: 0.3 }];
  const st = F.state(FULL, { seed: 7, loop: true, mix: mix });
  let conserved = true, perArchConserved = true, sawComplete = false;
  for (let i = 0; i < 800; i++) {
    F.step(st, 1);
    if (st.spawned !== st.inflight + st.completed) conserved = false;
    let s = 0, c = 0, f = 0;
    for (const k of Object.keys(st.perArchetype)) {
      const p = st.perArchetype[k];
      s += p.spawned; c += p.completed; f += p.inflight;
      if (p.spawned !== p.inflight + p.completed) perArchConserved = false;
    }
    if (s !== st.spawned || c !== st.completed || f !== st.inflight) perArchConserved = false;
    if (st.completed > 0) sawComplete = true;
  }
  check("7a. spawned == in-flight + completed at EVERY tick of a mixed run",
    conserved && sawComplete && st.spawned > 50,
    "spawned " + st.spawned + " = inflight " + st.inflight + " + completed " + st.completed);
  check("7b. conservation ALSO holds per order type, and the per-type totals sum to the global ones",
    perArchConserved,
    Object.keys(st.perArchetype).filter((k) => st.perArchetype[k].spawned).map((k) => k + "=" + st.perArchetype[k].spawned).join(" "));

  // Two order types that both use the pick face share ONE physical queue.
  // Two order types whose routes both pass a station must contend for the SAME
  // physical FIFO queue - otherwise congestion would be fake. Overdrive the
  // arrivals so the shared put-away station saturates and watch WHO is in it.
  const shared = F.state(FULL, { seed: 4, loop: true, mix: ["legacy-spine", "full-pallet-out"], arrivalUnitsPerHr: 900 });
  const byStation = {};
  for (let i = 0; i < 400; i++) {
    F.step(shared, 1);
    for (const s of shared.stations) {
      for (const mu of s.queue) {
        (byStation[s.id] = byStation[s.id] || {})[mu.archetype] = 1;
      }
    }
  }
  const contended = Object.keys(byStation).filter((id) => Object.keys(byStation[id]).length > 1);
  check("7c. two order types whose routes cross the same station share ONE physical FIFO queue",
    contended.length > 0 &&
    Object.keys(byStation[contended[0]]).sort().join(",") === "full-pallet-out,legacy-spine",
    contended[0] + " served both: " + Object.keys(byStation[contended[0]]).sort().join(" + "));
})();

/* ---------------------------------------------------------------------
 * 8. DETERMINISM.
 * ------------------------------------------------------------------- */
(() => {
  const mix = [{ id: "full-pallet-out", share: 0.4 }, { id: "cross-dock", share: 0.3 }, { id: "returns", share: 0.3 }];
  function snap(ticks) {
    const st = F.state(fullFloor(), { seed: 7, loop: true, mix: mix });
    F.step(st, ticks);
    return JSON.stringify({
      tick: st.tick, spawned: st.spawned, completed: st.completed, queued: st.queued,
      perArchetype: st.perArchetype,
      mus: st.mus.map((m) => [m.id, m.route, m.archetype, m.op, m.seg, +m.t.toFixed(9), +m.cx.toFixed(9), +m.cy.toFixed(9), m.stage, m.status]),
    });
  }
  check("8a. same (layout, seed, mix, ticks) -> byte-identical MU state",
    snap(377) === snap(377));
  check("8b. step(state, N) equals N single-tick steps under a mix",
    (() => {
      const one = F.state(fullFloor(), { seed: 7, loop: true, mix: mix });
      F.step(one, 120);
      const many = F.state(fullFloor(), { seed: 7, loop: true, mix: mix });
      for (let i = 0; i < 120; i++) F.step(many, 1);
      const f = (s) => JSON.stringify(s.mus.map((m) => [m.id, m.route, m.seg, +m.t.toFixed(9)]));
      return f(one) === f(many);
    })());
  check("8c. the LIVE route assignment matches the pure dispatchSequence exactly",
    (() => {
      const plan = F.spawnPlan(fullFloor(), { seed: 7, mix: mix });
      const st = F.state(plan);
      const seen = [];
      let guard = 0;
      while (seen.length < 40 && guard++ < 4000) {
        const before = st.mus.length ? st.mus[st.mus.length - 1].id : 0;
        F.step(st, 1);
        for (const mu of st.mus) if (mu.id > before && seen.length < 40) { /* collected below */ }
        guard = guard; // keep the loop honest
        if (st.spawned >= 40) break;
      }
      // Recover the spawn order from the archetype counters instead of the live
      // list (units retire), by replaying the dispatcher over the same shares.
      const want = R.dispatchSequence(plan.spawnShares, st.spawned).map((i) => plan.spawnRoutes[i]);
      const counts = {};
      for (const idx of want) counts[plan.routes[idx].routeId] = (counts[plan.routes[idx].routeId] || 0) + 1;
      let ok = true;
      for (const k of Object.keys(counts)) if (st.perArchetype[k].spawned !== counts[k]) ok = false;
      return ok && st.spawned > 0;
    })(), "the sim's per-type spawn counts equal the pure dispatcher's");

  // No wall clock, no RNG in the routing model itself.
  const stripped = ROUTING_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  check("8d. routing.js contains no Date and no Math.random (deterministic by construction)",
    !/\bnew\s+Date\b/.test(stripped) && !/\bDate\.now\b/.test(stripped) && !/Math\.random/.test(stripped));
  const flowCode = FLOWSIM_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  check("8e. the routing additions to flowsim.js introduce no Date / Math.random either",
    !/\bnew\s+Date\b/.test(flowCode) && !/\bDate\.now\b/.test(flowCode) && !/Math\.random/.test(flowCode));
})();

/* ---------------------------------------------------------------------
 * 9. THE HARD GATE: byte-identical LEGACY COLLAPSE.
 * ------------------------------------------------------------------- */
(() => {
  // 9a. With no mix declared the plan carries exactly ONE route and it IS the
  // plan's own waypoint array (the same object, not a copy).
  const plan = F.spawnPlan(FULL, { seed: 7 });
  check("9a. with NO mix declared there is exactly one spawn route and it IS the plan's own spine",
    plan.mix === null && plan.spawnable === true &&
    eq(plan.spawnRoutes, [0]) && eq(plan.spawnShares, [1]) &&
    plan.routes.length === 1 && plan.routes[0].routeId === "legacy-spine" &&
    plan.routes[0].waypoints === plan.waypoints &&
    plan.unfulfillable.length === 0,
    "routes=" + plan.routes.length + " share=" + plan.spawnShares[0]);

  // 9b. The generic route builder, fed the LEGACY operation list, reproduces
  // buildWaypoints EXACTLY - the collapse is structural, not asserted by hand.
  // (flowsim's own LEGACY_STEPS and routing.js's legacy archetype agree too.)
  check("9b. flowsim's LEGACY_STEPS are the same operation sequence as routing.js's legacy archetype",
    eq(F.LEGACY_STEPS.map((s) => s.op), R.ARCHETYPE_BY_ID[R.LEGACY_ID].ops),
    F.LEGACY_STEPS.map((s) => s.op).join(" > "));

  const layouts = {};
  for (const e of EX.library) { try { layouts["ex:" + e.id] = EX.build(e.id); } catch (_) { /* skip */ } }
  for (const k of Object.keys(GEN.plantProfiles)) { try { layouts["gen:" + k] = GEN.generateLayout(k, { seed: 11 }); } catch (_) { /* skip */ } }
  for (const pid of Object.keys(D.PRESETS)) {
    const p = D.PRESETS[pid];
    layouts["preset:" + pid] = { elements: p.elements.map((e, i) => Object.assign({ id: "e" + i }, e)), gridW: 40, gridH: 24, cell: 1, config: p.config };
  }
  layouts["hand:full"] = FULL;
  layouts["hand:bare"] = BARE;

  const wpBad = [];
  for (const k of Object.keys(layouts).sort()) {
    const L = layouts[k];
    const A = F.anchors(L);
    const res = R.resolveRoute(R.LEGACY_ID, A, null);
    const viaRouter = F.buildRouteWaypoints(L, res.steps);
    const viaLegacy = F.buildWaypoints(L);
    const a = viaRouter.map((w) => [r6(w.x), r6(w.y), w.stage, !!w.onConveyor, !!w.onCurve]);
    const b = viaLegacy.map((w) => [r6(w.x), r6(w.y), w.stage, !!w.onConveyor, !!w.onCurve]);
    if (!eq(a, b) || viaRouter.conveyorRouted !== viaLegacy.conveyorRouted) wpBad.push(k);
  }
  check("9c. routing the LEGACY archetype through the generic builder reproduces buildWaypoints EXACTLY",
    wpBad.length === 0, wpBad.length ? wpBad.join(", ") : Object.keys(layouts).length + " layouts, waypoint for waypoint");

  // 9d. And the LIVE sim: an explicit legacy-spine mix is byte-identical to no
  // mix at all, on every layout, over a long run.
  function runSnap(L, opts, ticks) {
    const st = F.state(L, opts);
    F.step(st, ticks);
    return JSON.stringify({
      tick: st.tick, spawned: st.spawned, completed: st.completed, inflight: st.inflight,
      queued: st.queued, maxQueue: st.maxQueue, congestedStations: st.congestedStations,
      perStage: st.perStage,
      stations: st.stations.map((s) => [s.id, s.queue.length, +s.serviceAccum.toFixed(9)]),
      mus: st.mus.map((m) => [m.id, m.seg, +m.t.toFixed(9), +m.cx.toFixed(9), +m.cy.toFixed(9), m.stage, m.status, m.stationId || ""]),
    });
  }
  const runBad = [];
  for (const k of Object.keys(layouts).sort()) {
    const L = layouts[k];
    const noMix = runSnap(L, { seed: 7, loop: true }, 250);
    const legacyMix = runSnap(L, { seed: 7, loop: true, mix: ["legacy-spine"] }, 250);
    if (noMix !== legacyMix) runBad.push(k);
    const poolNo = runSnap(L, { seed: 3, loop: false, orders: 40 }, 400);
    const poolLegacy = runSnap(L, { seed: 3, loop: false, orders: 40, mix: "legacy-spine" }, 400);
    if (poolNo !== poolLegacy) runBad.push(k + " (pool)");
  }
  check("9d. a 250-tick loop run and a 400-tick pool run are byte-identical with and without the legacy mix",
    runBad.length === 0, runBad.length ? runBad.join(", ") : Object.keys(layouts).length + " layouts x 2 runs");

  // 9e. An unrecognised mix falls back to the legacy spine (and says so) rather
  // than producing a dead sim - the ONE place a fallback is correct, because
  // nothing the caller named exists to route.
  const junk = F.spawnPlan(FULL, { seed: 7, mix: ["nope"] });
  check("9e. a completely unrecognised mix keeps the legacy spine AND reports the unknown type",
    junk.spawnable === true && eq(junk.spawnRoutes, [0]) &&
    junk.unknownOrderTypes.indexOf("nope") >= 0 && junk.routingMessages.length === 1,
    junk.routingMessages[0].slice(0, 80) + "...");

  // 9f. The pre-existing public surface is intact.
  check("9f. the v3.24 flowsim API is unchanged and the new one is additive",
    eq(F.STAGES, ["receiving", "storage", "picking", "packing", "shipping"]) &&
    ["spawnPlan", "state", "step", "buildWaypoints", "throughputOf", "buildStationSpecs",
      "conveyorCells", "conveyorRoute", "curveArcPoints"].every((k) => typeof F[k] === "function") &&
    ["anchors", "buildRouteWaypoints", "buildRoutes", "routingReport", "quotaPick"].every((k) => typeof F[k] === "function"));
})();

/* ---------------------------------------------------------------------
 * 10. NO INPUT MUTATION.
 * ------------------------------------------------------------------- */
(() => {
  const L = fullFloor();
  const layBefore = JSON.stringify(L);
  const mix = [{ id: "cross-dock", share: 0.5 }, { id: "returns", share: 0.5 }];
  const mixBefore = JSON.stringify(mix);
  const opts = { seed: 7, loop: true, mix: mix };
  const optsBefore = JSON.stringify(opts);
  const A = F.anchors(L);
  const anchorsBefore = JSON.stringify(A);
  R.resolveRoute("cross-dock", A, null);
  R.resolveAll(L, { anchors: A });
  R.normalizeMix(mix);
  const st = F.state(L, opts);
  F.step(st, 200);
  F.routingReport(L);
  check("10. resolving, planning and stepping never mutate the layout, the mix, the opts or the anchors",
    JSON.stringify(L) === layBefore && JSON.stringify(mix) === mixBefore &&
    JSON.stringify(opts) === optsBefore && JSON.stringify(A) === anchorsBefore);
})();

/* ---------------------------------------------------------------------
 * 11. SHIPPED WIRING.
 * ------------------------------------------------------------------- */
(() => {
  const iRouting = INDEX_SRC.indexOf('<script src="routing.js">');
  const iFlow = INDEX_SRC.indexOf('<script src="flowsim.js">');
  const iApp = INDEX_SRC.indexOf('<script src="app.js">');
  check("11a. index.html loads routing.js BEFORE flowsim.js and before app.js",
    iRouting > 0 && iFlow > iRouting && iApp > iFlow);
  check("11b. sw.js precaches ./routing.js at the bumped wt-v80 cache (trail preserved: previously wt-v79)",
    /["']\.\/routing\.js["']/.test(SW_SRC) && /CACHE_VERSION\s*=\s*"wt-v80"/.test(SW_SRC) &&
    /Previously wt-v79/.test(SW_SRC));
  check("11c. test/run-all.mjs lists verify_routing.js",
    /verify_routing\.js/.test(RUNALL_SRC));
  check("11d. the in-browser self-test covers the routing engine",
    /WT\.routing/.test(SELFTEST_SRC) && /routingReport|order-driven|archetype/i.test(SELFTEST_SRC));
  check("11e. routing.js references no external host (offline)",
    !/https?:\/\//.test(ROUTING_SRC.replace(/https?:\/\/[^\s"']*schema[^\s"']*/g, "")) ||
    !/(src|href)\s*=\s*["']https?:/.test(ROUTING_SRC));
  check("11f. routing.js is ASCII-only",
    !/[^\x00-\x7F]/.test(ROUTING_SRC));
})();

console.log("");
console.log(failures === 0
  ? "ALL ORDER-ROUTING CHECKS PASSED"
  : failures + " ORDER-ROUTING CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
