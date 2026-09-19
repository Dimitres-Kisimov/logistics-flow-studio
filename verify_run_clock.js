"use strict";
const assert = require("node:assert/strict");
global.window = global;
require("./run-clock.js");
const C = WT.runClock;
assert.equal(C.duration(2, "days"), 2880);
assert.equal(C.duration(8, "hours"), 480);
for (const value of [0, -1, Infinity, NaN, 525601]) assert.throws(() => C.duration(value, "minutes"));
assert.throws(() => C.duration(1, "invalid"));
function run(hz, speed) {
  const c = C.create(480); let ticks = 0;
  for (let i = 0; i <= hz * 60; i++) ticks += C.frame(c, i * 1000 / hz, speed);
  return {c,ticks};
}
assert.equal(run(30, 1).ticks, 1);
assert.equal(run(144, 1).ticks, 1);
assert.equal(run(60, 100).ticks, 100);
const capped = C.create(1);
assert.equal(C.advance(capped, 8), 1);
assert.equal(C.advance(capped, 8), 0);
assert.equal(C.text(capped.elapsed), "0d 00:01:00");
const paused = C.create(60);
C.frame(paused, 0, 60); C.frame(paused, 1000, 60);
paused.previous = null;
assert.equal(C.frame(paused, 90000, 60), 0);
assert.equal(paused.elapsed, 1);
console.log("PASS clock: real-time speed, frame-rate independence, minute/hour/day units, exact stop, pause/resume");
