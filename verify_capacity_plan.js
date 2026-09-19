"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
require("./capacity-plan.js");
const core = WT.capacityPlan;
const a = core.example("assembly-warehouse");
const before = JSON.stringify(a);
const result = core.evaluate(a);
assert.equal(result.labourMinutes, 960);
assert.equal(result.availableMinutes, 420);
assert.equal(result.workerLowerBound, 3);
assert.equal(result.shortfallMinutes, 120);
assert.equal(result.stockShortfall, 10);
assert.equal(result.netImportKWh, 80);
assert.equal(result.residualKWh, 0);
assert.equal(JSON.stringify(a), before);
assert.deepEqual(core.evaluate(a), result);
assert.equal(core.evaluate({...a, workers: 3}).shortfallMinutes, 0);
assert.equal(core.evaluate({...a, workers: 0}).shortfallMinutes, 960);
const p = core.evaluate(core.example("process-manufacturing"));
assert.equal(p.labourMinutes, 570);
assert.equal(p.workerLowerBound, 2);
assert.equal(p.residualKWh, 3);
assert.equal(p.energyBalanced, false);
for (const bad of [NaN, Infinity, -1, "300", null, true]) {
  assert.throws(() => core.evaluate({...a, quantity: bad}));
}
assert.throws(() => core.evaluate({...a, quantity: 0}));
assert.throws(() => core.evaluate({...a, workers: 1.5}));
assert.throws(() => core.evaluate({...a, breakMinutes: 480}));
assert.throws(() => core.evaluate({...a, profile: "unsupported"}));
assert.throws(() => core.evaluate({...a, profile: "__proto__"}));
assert.throws(() => core.evaluate({...a, quantity: Number.MAX_VALUE, labourMinutesPerUnit: 100}));
assert.throws(() => core.evaluate({...a, loadKWh: undefined}));
const index = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
for (const file of ["capacity-plan.js", "capacity-panel.js"]) {
  assert.ok(index.includes(`src="${file}"`));
  assert.ok(sw.includes(`"./${file}"`));
}
assert.ok(fs.readFileSync("app.js", "utf8").includes('cards: ["capacityCard", "simCard"'));
console.log("PASS capacity planner: workload, stock, energy residual, invalid inputs, deterministic/non-mutating, offline wiring");
