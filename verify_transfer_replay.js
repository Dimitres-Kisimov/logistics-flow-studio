"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs");
const {parse,parseLayout,locate}=require("./transfer-replay.js");
const raw=JSON.parse(fs.readFileSync("test/fixtures/transfer-ledger.json","utf8"));
const original=JSON.stringify(raw), result=parse(raw), entry=result.packages[0];
assert.equal(entry.frames.length,8);
assert.equal(entry.frames[3].location,null);
assert.equal(entry.frames[4].state,"blocked");
assert.match(entry.frames[4].reason,/aisle/);
assert.equal(entry.frames[7].location,"PACK-BENCH");
assert.equal(entry.manifest.order_id,"ORDER-A");
assert.equal(JSON.stringify(raw),original);
for (const change of [
  x=>x.events.pop(), x=>x.events.push(x.events[0]),
  x=>x.events[2].version=9, x=>x.events[2].state="delivered",
  x=>x.packages[0].state="waiting", x=>x.packages[0].quantity=1.5,
  x=>x.events[0].payload.pick="other", x=>x.events[4].payload.reason="",
  x=>x.events[2].occurred_at="2026-02-30T10:00:00.000000+00:00",
  x=>x.events[1].payload.resource=null,
]) { const copy=JSON.parse(original); change(copy); assert.throws(()=>parse(copy)); }
const shuffled=JSON.parse(original); shuffled.events.reverse();
assert.deepEqual(parse(shuffled),result);
assert.equal(parse({schema:raw.schema,packages:[],events:[]}).packages.length,0);
console.log("Transfer replay: SQL fixture, state/location history, malformed data, determinism and nonmutation pass.");
const floor={version:"wt-1",gridW:40,gridH:24,cell:.5,elements:[{id:"bench",type:"pack-station",x:4,y:6,w:2,d:4}]};
const geometry=parseLayout(floor);
assert.deepEqual(geometry.elements[0],{id:"bench",type:"pack-station",x:2,y:3,w:1,d:2});
const bindings=new Map([["PACK-BENCH","bench"]]);
assert.deepEqual(locate(geometry,bindings,entry.frames[7]),{id:"bench",x:2.5,y:4});
assert.equal(locate(geometry,bindings,entry.frames[3]),null);
assert.equal(locate(geometry,new Map(),entry.frames[7]),null);
assert.equal(locate(geometry,bindings,entry.frames[0]),null);
for(const change of [x=>x.cell=0,x=>x.elements.push(x.elements[0]),x=>x.elements[0].x=-1,x=>x.elements[0].w=100,x=>x.gridW=Infinity]){
  const invalid=JSON.parse(JSON.stringify(floor));change(invalid);assert.throws(()=>parseLayout(invalid));
}
console.log("Layout mapping: metre conversion, explicit anchors, unknown moving positions and adverse geometry pass.");
