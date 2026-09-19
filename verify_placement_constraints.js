"use strict";
const assert = require("node:assert/strict");
global.window = global;
for (const f of ["domain.js", "simulation.js", "optimizer.js"]) require("./" + f);
const layout = { gridW:40, gridH:24, cell:0.5, elements:[
  {id:"dock",type:"dock-out",x:20,y:23,w:2,d:1},
  {id:"rack",type:"selective-racking",x:6,y:5,w:8,d:1}
]};
const cfg = {seed:42,strategy:"abc",orders:200,skuCount:80,minAisleMetres:2,flowMode:"pull",demandSkew:1,palletType:"EUR1",boxType:"EURO-CASE"};
const run = c => WT.optimizer.optimize(layout,{...cfg,placementConstraints:c});
const source = JSON.stringify(layout);
const free = run({});
assert.ok(free.ok && free.movedCount > 0);
const fixed = run({fixedIds:["rack"]});
assert.equal(fixed.movedCount,0);
assert.deepEqual(fixed.proposedElements,layout.elements);
// A horizontal reserved strip separates rack and dock. Metres must be
// converted to cells; no rack footprint may cross it.
const constraints = {zones:[{x:0,y:5,w:20,d:1}]};
const guarded = run(constraints);
assert.ok(guarded.ok);
assert.ok(guarded.audit.rejected["reserved-zone"] > 0);
const rack = guarded.proposedElements.find(e=>e.id==="rack");
assert.ok((rack.y+rack.d)*layout.cell <= 5);
assert.deepEqual(guarded,run(constraints));
for (const invalid of [null,[],{fixedIds:["missing"]},{zones:null},{zones:[{x:0,y:0,w:-1,d:1}]},{zones:[{x:0,y:0,w:Infinity,d:1}]},{zones:[{x:0,y:0,w:21,d:1}]},{zone:[]},{zones:[{x:3,y:2.5,w:4,d:0.5}]}]) {
  const result=run(invalid);
  assert.equal(result.ok,false);
  assert.ok(result.audit.errors.length);
  assert.deepEqual(result.proposedElements,layout.elements);
}
assert.equal(JSON.stringify(layout),source);
console.log("Placement constraints: fixed IDs, metre conversion, barrier, conflict rejection, determinism and nonmutation pass.");
