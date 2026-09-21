"use strict";
const assert = require("node:assert/strict");
global.window = global;
for (const file of ["domain.js", "routing.js", "flowsim.js", "route-review.js"]) require("./" + file);
const empty = { gridW: 40, gridH: 24, elements: [] };
const before = JSON.stringify(empty);
const review = WT.routeReview.build(empty);
const legacy = review.rows.find((r) => r.legacy);
assert.equal(legacy.engineResolved, true, "the legacy animation still resolves on an empty floor");
assert.equal(legacy.status, "gaps", "fallback geometry must not imply placed equipment");
assert.deepEqual(legacy.steps.map((s) => s.status), ["fallback", "fallback", "fallback", "fallback", "fallback"]);
assert.equal(review.rows.find((r) => r.archetype === "piece-pick").status, "missing");
assert.equal(review.rows.find((r) => r.archetype === "vas").status, "missing");
assert.equal(review.rows.filter((r) => r.archetype === "returns").length, 2, "both return outcomes must be visible");
const floor = { gridW: 40, gridH: 24, elements: [
  { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
  { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  { id: "qa", type: "returns-station", x: 34, y: 4, w: 3, d: 2 },
  { id: "stage", type: "staging", x: 6, y: 16, w: 4, d: 2 },
] };
const fullBefore = JSON.stringify(floor);
const cross = WT.routeReview.build(floor).rows.find((r) => r.archetype === "cross-dock");
assert.equal(cross.status, "shared");
assert.deepEqual(cross.steps.map((s) => s.status), ["placed", "shared", "placed", "placed"]);
assert.deepEqual(cross.steps.map((s) => s.id), ["receive", "qc-sample", "stage-out", "load"]);
assert.ok(!cross.steps.some((s) => s.anchor === "storage"));
floor.elements = floor.elements.filter((e) => e.id !== "out");
assert.equal(WT.routeReview.build(floor).rows.find((r) => r.archetype === "cross-dock").status, "gaps",
  "deleting the outbound dock exposes fallback even when the legacy engine borrows the inbound dock");
assert.equal(JSON.stringify(empty), before);
floor.elements.push(JSON.parse(fullBefore).elements[1]);
const snap = JSON.stringify(floor);
assert.equal(JSON.stringify(WT.routeReview.build(floor)), JSON.stringify(WT.routeReview.build(floor)));
assert.equal(JSON.stringify(floor), snap);
console.log("PASS route review: empty-floor fallbacks, missing R2 stations, both returns outcomes, shared QC, missing outbound dock, deterministic and non-mutating");
