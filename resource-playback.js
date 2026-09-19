(function () {
  "use strict";
  const route=typeof module!=="undefined"&&module.exports?require("./route-playback.js"):window.RoutePlayback;
  const ledger=typeof module!=="undefined"&&module.exports?require("./transfer-replay.js"):window.TransferReplay;
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const number=v=>Number.isFinite(v)&&v>=0&&v<=31536000;
  const id=v=>typeof v==="string"&&v.trim()&&v.length<=200;
  const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  const same=(a,b)=>a&&b&&close(a.x,b.x)&&close(a.y,b.y);
  function parse(input) {
    check(input&&input.schema==="factory-resource-motion/v1","Use a resource motion scenario export");
    const out=JSON.parse(JSON.stringify(input)),p=out.plan,f=out.floor;
    check(p&&p.schema==="factory-resource-plan/v1"&&p.provenance==="assumed-resource-dispatch"&&number(p.horizon_s)&&p.horizon_s>0,"Invalid resource plan or horizon");
    check(f&&Array.isArray(out.resources)&&out.resources.length<=100&&Array.isArray(p.jobs)&&p.jobs.length<=1000&&Array.isArray(out.assignments)&&out.assignments.length===p.jobs.length,"Invalid scenario size");
    const floor={version:"wt-1",cell:1,gridW:f.width,gridH:f.depth,elements:f.elements,placementConstraintDraft:JSON.stringify({zones:f.reserved_zones||[]})};
    out.floor=route.geometry(floor);
    check(["worker","forklift","agv"].includes(out.mode)&&number(out.clearance_m)&&number(out.speed_mps)&&out.speed_mps>0,"Invalid movement assumptions");
    const access=out.location_access;
    check(access&&typeof access==="object"&&!Array.isArray(access)&&Object.keys(access).length<=1000&&Object.entries(access).every(([a,b])=>id(a)&&id(b))&&new Set(Object.values(access)).size===Object.keys(access).length,"Invalid location access map");
    const resources=new Map(),paths=new Map(),jobs=new Set(),points=new Map();
    const remember=point=>{check(!points.has(point.id)||same(points.get(point.id),point),"Inconsistent access-node coordinates");points.set(point.id,point);};
    function checkedRoute(t) {
      check(t&&t.reservation===undefined&&t.package_snapshot===undefined&&t.location_access===undefined,"Resource routes cannot embed independent reservations or SQL bindings");
      check(t.route&&t.route.mode===out.mode&&t.route.clearance_m===out.clearance_m&&t.speed_mps===out.speed_mps,"Mixed movement assumptions");
      const result=route.parse(t,floor);result.route.points.forEach(remember);return result;
    }
    out.resources.forEach(r=>{
      check(r&&id(r.id)&&!resources.has(r.id)&&Object.hasOwn(access,r.start_location),"Invalid resource identity or start location");
      check(Array.isArray(r.skills)&&r.skills.length<=100&&r.skills.every(id)&&new Set(r.skills).size===r.skills.length,"Invalid resource skills");
      check(Array.isArray(r.availability_s)&&r.availability_s.length<=100,"Invalid resource windows");
      let prior=-1;r.availability_s.forEach(w=>{check(Array.isArray(w)&&w.length===2&&w.every(number)&&w[0]<w[1]&&w[0]>=prior,"Invalid resource windows");prior=w[1];});
      check(r.initial_position&&Number.isFinite(r.initial_position.x)&&Number.isFinite(r.initial_position.y),"Invalid initial position");
      const anchor={id:access[r.start_location],x:r.initial_position.x,y:r.initial_position.y};
      checkedRoute({schema:"factory-route-timeline/v1",provenance:"assumed-simulation-not-telemetry",floor:out.floor,
        route:{schema:"factory-route-proposal/v1",found:true,mode:out.mode,clearance_m:out.clearance_m,points:[anchor],distance_m:0},
        speed_mps:out.speed_mps,loading_s:0,unloading_s:0,segments:[],travel_end_s:0,duration_s:0});
      resources.set(r.id,r);
    });
    out.assignments.forEach(a=>{
      check(a&&id(a.job_id)&&!paths.has(a.job_id),"Duplicate route association");
      a.work_route=checkedRoute(a.work_route);
      if(a.reposition_route!==null)a.reposition_route=checkedRoute(a.reposition_route);
      paths.set(a.job_id,a);
    });
    const perResource=new Map([...resources.keys()].map(k=>[k,[]])),areas=new Map();
    check(Array.isArray(p.areas)&&p.areas.length<=100,"Invalid shared areas");
    p.areas.forEach(a=>{check(a&&id(a.id)&&!areas.has(a.id)&&Number.isInteger(a.capacity)&&a.capacity>=1&&a.capacity<=100,"Invalid area capacity");areas.set(a.id,{capacity:a.capacity,claims:[]});});
    p.jobs.forEach(j=>{
      check(j&&id(j.id)&&!jobs.has(j.id)&&paths.has(j.id)&&number(j.release_s)&&number(j.duration_s)&&j.duration_s>0,"Invalid job");jobs.add(j.id);
      check(Object.hasOwn(access,j.source)&&Object.hasOwn(access,j.destination)&&Array.isArray(j.required_skills)&&j.required_skills.length<=100&&j.required_skills.every(id),"Invalid job locations or skills");
      check(Array.isArray(j.areas)&&new Set(j.areas).size===j.areas.length&&j.areas.every(a=>areas.has(a)),"Invalid job area claims");
      const a=paths.get(j.id),t=a.work_route,ps=t.route.points;
      check(ps[0].id===access[j.source]&&ps[ps.length-1].id===access[j.destination]&&close(t.duration_s,j.duration_s),"Job route endpoints or duration disagree");
      if(j.resource_id===null){check(a.reposition_route===null,"Unassigned job has a return route");return;}
      check(resources.has(j.resource_id)&&j.required_skills.every(s=>resources.get(j.resource_id).skills.includes(s)),"Unknown or unqualified resource");
      check([j.assignment_start_s,j.task_start_s,j.end_s,j.reposition_s].every(number)&&j.assignment_start_s>=j.release_s&&j.task_start_s>=j.assignment_start_s&&j.end_s>j.task_start_s&&close(j.task_start_s-j.assignment_start_s,j.reposition_s)&&close(j.end_s-j.task_start_s,t.duration_s),"Job timing disagrees with route");
      check(close(j.reposition_s,a.reposition_route?a.reposition_route.duration_s:0),"Return duration disagrees with schedule");
      j.reposition_s=a.reposition_route?a.reposition_route.duration_s:0;
      j.task_start_s=j.assignment_start_s+j.reposition_s;
      j.end_s=j.task_start_s+t.duration_s;
      check(resources.get(j.resource_id).availability_s.some(w=>j.assignment_start_s>=w[0]&&j.end_s<=w[1]),"Job crosses unavailable time");
      perResource.get(j.resource_id).push(j);
      j.areas.forEach(k=>areas.get(k).claims.push({start:j.assignment_start_s,end:j.end_s}));
    });
    perResource.forEach((list,key)=>{
      list.sort((a,b)=>a.assignment_start_s-b.assignment_start_s);
      let end=0,location=resources.get(key).start_location;
      list.forEach(j=>{
        check(j.assignment_start_s>=end&&j.reposition_from===location,"Resource overlap or location discontinuity");
        const back=paths.get(j.id).reposition_route;
        if(location===j.source)check(back===null&&j.reposition_s===0,"Unexpected return trip");
        else {
          check(back&&back.loading_s===0&&back.unloading_s===0&&close(back.duration_s,j.reposition_s),"Missing or inconsistent return trip");
          const ps=back.route.points;check(ps[0].id===access[location]&&ps[ps.length-1].id===access[j.source],"Return trip endpoints disagree");
        }
        end=j.end_s;location=j.destination;
      });
    });
    areas.forEach(a=>{
      const events=a.claims.flatMap(c=>[{t:c.start,d:1},{t:c.end,d:-1}]).sort((x,y)=>x.t-y.t||x.d-y.d);
      let count=0;events.forEach(e=>{count+=e.d;check(count<=a.capacity,"Shared area capacity exceeded");});
    });
    if(out.package_bindings!==undefined||out.source_ledger!==undefined){
      check(Array.isArray(out.package_bindings)&&out.package_bindings.length===p.jobs.length&&out.package_bindings.length>0,"Bind exactly one SQL package per job");
      const source=ledger.parse(out.source_ledger),packages=new Map(source.packages.map(e=>[e.manifest.id,e.manifest]));
      const boundJobs=new Set(),boundPackages=new Set(),fields=["id","pick_id","source_id","destination_id","order_id","line_id","item_id","quantity","unit","version","updated_at"];
      out.package_bindings.forEach(b=>{
        check(b&&jobs.has(b.job_id)&&!boundJobs.has(b.job_id)&&b.package_snapshot,"Invalid or duplicate package binding");
        const snapshot=b.package_snapshot,manifest=packages.get(snapshot.id),job=p.jobs.find(j=>j.id===b.job_id);
        check(manifest&&!boundPackages.has(snapshot.id)&&fields.every(k=>Object.hasOwn(snapshot,k)&&snapshot[k]===manifest[k]),"Package snapshot differs from ledger identity or version");
        check(job.source===manifest.source_id&&job.destination===manifest.destination_id,"Job endpoints differ from SQL package");
        boundJobs.add(b.job_id);boundPackages.add(snapshot.id);
      });
      check(boundPackages.size===packages.size,"Ledger includes unrelated packages");
    }
    // Display samples use checked jobs/routes, not imported summary metrics or state labels.
    return out;
  }
  function sample(bundle,tick) {
    check(Number.isFinite(tick)&&tick>=0,"Invalid simulation time");
    const time=Math.min(tick,bundle.plan.horizon_s),paths=new Map(bundle.assignments.map(a=>[a.job_id,a]));
    const loads=bundle.plan.jobs.map(j=>{
      const state=time<j.release_s?"not-released":j.resource_id===null?"unscheduled":time<j.task_start_s?"waiting":null;
      const work=paths.get(j.id).work_route;
      const pose=route.sample(work,state?0:time>=j.end_s?work.duration_s:time-j.task_start_s);
      return {job_id:j.id,resource_id:j.resource_id,...pose,state:state||pose.state};
    });
    const resources=bundle.resources.map(r=>{
      let pose={position:r.initial_position,heading:null},state=r.availability_s.some(w=>w[0]<=time&&time<w[1])?"idle":"off-shift",job_id=null;
      const list=bundle.plan.jobs.filter(j=>j.resource_id===r.id).sort((a,b)=>a.assignment_start_s-b.assignment_start_s);
      for(const j of list){
        if(time<j.assignment_start_s)break;
        const a=paths.get(j.id);
        if(time>=j.end_s){pose=route.sample(a.work_route,a.work_route.duration_s);continue;}
        job_id=j.id;
        if(time<j.task_start_s){pose=route.sample(a.reposition_route,time-j.assignment_start_s);state="repositioning";}
        else {pose=route.sample(a.work_route,time-j.task_start_s);state=pose.state;}
        break;
      }
      return {resource_id:r.id,job_id,...pose,state};
    });
    return {elapsed_s:time,resources,loads};
  }
  const api={parse,sample};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else window.ResourcePlayback=api;
}());
