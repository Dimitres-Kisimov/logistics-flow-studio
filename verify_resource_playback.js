"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),api=require("./resource-playback.js");
const raw=JSON.parse(fs.readFileSync("examples/routes/resource-motion.json","utf8"));
const before=JSON.stringify(raw),model=api.parse(raw);
assert.equal(JSON.stringify(raw),before);
assert.equal(model.plan.jobs[1].assignment_start_s,60);
assert.equal(model.plan.jobs[1].task_start_s,72.7);
let frame=api.sample(model,61);
assert.equal(frame.resources[0].state,"repositioning");
assert.deepEqual(frame.resources[0].position,{x:13,y:7.5});
assert.deepEqual(frame.loads[1].position,{x:4,y:4.8});
assert.equal(frame.loads[1].state,"waiting");
assert.equal(api.sample(model,40).resources[0].state,"off-shift");
assert.equal(api.sample(model,72.7).resources[0].state,"loading");
assert.equal(api.sample(model,200).elapsed_s,120);
assert.equal(api.sample(model,200).loads[1].state,"delivered");
for(const time of [0,5.6,10,20.7,30,60,61,72.7,78,90,93.4,120]){
  frame=api.sample(model,time);
  for(const load of frame.loads.filter(l=>["loading","travelling","unloading"].includes(l.state)))
    assert.deepEqual(load.position,frame.resources.find(r=>r.resource_id===load.resource_id).position);
}
const mutate=fn=>{const copy=structuredClone(raw);fn(copy);assert.throws(()=>api.parse(copy));};
mutate(t=>t.resources[0].skills=[]);
mutate(t=>t.resources[0].availability_s=[[0,80]]);
mutate(t=>t.resources[0].initial_position.x++);
mutate(t=>t.assignments[1].reposition_route=null);
mutate(t=>t.assignments[0].work_route.speed_mps=2);
mutate(t=>t.plan.jobs[1].reposition_from="PICK");
mutate(t=>t.plan.jobs[1].end_s--);
mutate(t=>t.assignments[0].work_route.reservation={});
mutate(t=>t.location_access.PACK=t.location_access.PICK);
mutate(t=>t.plan.jobs[1].areas=["unknown"]);
mutate(t=>t.assignments[0].work_route.segments[0].source.x++);
// Consistent timing moved earlier still rejects overlapping ownership.
mutate(t=>{const j=t.plan.jobs[1];for(const k of ["assignment_start_s","task_start_s","end_s"])j[k]-=50;t.resources[0].availability_s=[[0,120]];});
// Imported summary text is not trusted as the live state.
const altered=structuredClone(raw);altered.plan.jobs[0].state_at_horizon="unscheduled";
assert.equal(api.sample(api.parse(altered),120).loads[0].state,"delivered");
const unassigned=structuredClone(raw);unassigned.plan.jobs[1].resource_id=null;unassigned.assignments[1].reposition_route=null;
assert.equal(api.sample(api.parse(unassigned),120).loads[1].state,"unscheduled");
const shared=structuredClone(raw),second=shared.plan.jobs[1];
shared.resources.push({...structuredClone(shared.resources[0]),id:"WORKER-2"});
Object.assign(second,{resource_id:"WORKER-2",release_s:0,assignment_start_s:0,task_start_s:0,end_s:20.7,reposition_s:0,reposition_from:"PICK"});
shared.assignments[1].reposition_route=null;
shared.plan.jobs.forEach(j=>j.areas=["Z"]);shared.plan.areas=[{id:"Z",capacity:1,reservations:[]}];
assert.throws(()=>api.parse(shared),/capacity/);
shared.plan.areas[0].capacity=2;
assert.equal(api.sample(api.parse(shared),10).resources.filter(r=>r.state==="travelling").length,2);
assert.throws(()=>api.sample(model,-1));
const html=fs.readFileSync("resource-view.html","utf8"),sw=fs.readFileSync("sw.js","utf8");
for(const asset of ["resource-view.html","resource-view.css","resource-view.js","resource-playback.js","examples/routes/resource-motion.json"])assert.ok(sw.includes('"./'+asset+'"'));
assert.ok(html.includes('value="100"'));
console.log("Resource playback: route timing, ownership, skills, windows, return paths and states PASS");
