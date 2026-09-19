(function () {
  "use strict";
  const $=id=>document.getElementById(id),api=window.ResourcePlayback,route=window.RoutePlayback;
  let scenario=null,time=0,playing=false,raf=null,last=null,revision=0;
  function pause(){if(raf!==null)cancelAnimationFrame(raf);raf=null;last=null;playing=false;$("motionPlay").textContent="Play";}
  function begin(){pause();scenario=null;$("motionView").hidden=true;return ++revision;}
  function accept(raw,request){if(request!==revision)return;scenario=api.parse(raw);time=0;$("motionSeek").max=String(scenario.plan.horizon_s);$("motionView").hidden=false;$("motionStatus").textContent="Checked planned scenario · assumed motion, not SQL history or telemetry.";table();draw();}
  function fail(error,request){if(request===revision){scenario=null;$("motionView").hidden=true;$("motionStatus").textContent="Cannot open scenario: "+error.message;}}
  function table(){
    $("motionJobs").replaceChildren();
    const bindings=scenario.package_bindings||[];
    $("motionPackageRows").replaceChildren();$("motionPackageTable").hidden=!bindings.length;
    $("motionAssociation").textContent=bindings.length?"SQL-linked what-if plan. Recorded versions and event history match this imported snapshot. Planning does not reserve resources, execute orders or confirm the database is still current.":"Unbound scenario: these job IDs are not linked to SQL packages.";
    bindings.forEach(b=>{
      const p=b.package_snapshot,manifest=scenario.source_ledger.packages.find(m=>m.id===p.id),row=document.createElement("tr");
      [b.job_id,`${p.id} / ${p.order_id} / ${p.pick_id}`,`${p.quantity} ${p.unit} · ${p.item_id}`,manifest.state,`${p.version} · ${p.updated_at}`].forEach(value=>{const td=document.createElement("td");td.textContent=value;row.append(td);});$("motionPackageRows").append(row);
    });
    scenario.plan.jobs.forEach(j=>{const row=document.createElement("tr");[j.id,j.resource_id||"Unassigned",j.assignment_start_s,j.task_start_s,j.end_s].forEach(v=>{const td=document.createElement("td");td.textContent=typeof v==="number"?v.toFixed(2):v===undefined?"—":v;row.append(td);});$("motionJobs").append(row);});
  }
  function draw(){
    if(!scenario)return;
    const frame=api.sample(scenario,time),floor=scenario.floor,view=$("motionProjection").value,svg=$("motionFloor");
    const camera=route.camera(floor,view,1,{x:0,y:0}),project=p=>route.project(p,view),size=Math.max(floor.width,floor.depth)*.018;
    svg.replaceChildren();svg.setAttribute("viewBox",`${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
    function shape(tag,attrs,label){const n=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));if(label){const title=document.createElementNS(n.namespaceURI,"title");title.textContent=label;n.append(title);}svg.append(n);return n;}
    const points=ps=>ps.map(project).map(p=>`${p.x},${p.y}`).join(" ");
    const rect=r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.d},{x:r.x,y:r.y+r.d}];
    shape("polygon",{points:points(rect({x:0,y:0,w:floor.width,d:floor.depth})),fill:"#202f29",stroke:"#789c89","stroke-width":size*.2});
    floor.elements.forEach(e=>shape("polygon",{points:points(rect(e)),fill:"#526d5f",stroke:"#a3bbae","stroke-width":size*.12},e.id));
    (floor.reserved_zones||[]).forEach(e=>shape("polygon",{points:points(rect(e)),fill:"#b89134",opacity:.6},"Reserved area"));
    const seen=new Set();scenario.assignments.forEach(a=>[a.work_route,a.reposition_route].forEach((t,i)=>{
      if(!t)return;const key=JSON.stringify(t.route.points)+i;if(seen.has(key))return;seen.add(key);
      shape("polyline",{points:points(t.route.points),fill:"none",stroke:i?"#d3b17a":"#6daea2","stroke-width":size*.18,"stroke-dasharray":i?`${size*.7} ${size*.7}`:"none",opacity:.65});
    }));
    frame.resources.forEach(r=>{const p=project(r.position);shape("circle",{cx:p.x,cy:p.y,r:size,fill:"none",stroke:"#c3fff0","stroke-width":size*.25},`${r.resource_id}: ${r.state}`);if(r.heading!==null){const q=project({x:r.position.x+Math.cos(r.heading)*size*2,y:r.position.y+Math.sin(r.heading)*size*2});shape("line",{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:"#fff","stroke-width":size*.2});}});
    frame.loads.filter(l=>l.state!=="not-released").forEach(l=>{const p=project(l.position);shape("rect",{x:p.x-size*.42,y:p.y-size*.42,width:size*.84,height:size*.84,fill:l.state==="delivered"?"#a5c99b":"#efc786",stroke:"#18241f","stroke-width":size*.12},`${l.job_id}: ${l.state}`);});
    $("motionClock").textContent=`${time.toFixed(2)} / ${scenario.plan.horizon_s.toFixed(2)} simulated seconds · ${frame.loads.filter(l=>l.state==="delivered").length} / ${frame.loads.length} loads delivered`;
    $("motionSeek").value=String(time);$("motionStates").replaceChildren();
    [...frame.resources.map(r=>({name:r.resource_id,detail:r.job_id?`Assigned to ${r.job_id}`:"No active assignment",...r})),...frame.loads.map(l=>({name:l.job_id,detail:l.resource_id?`Resource ${l.resource_id}`:"No resource assigned",...l}))].forEach(item=>{
      const card=document.createElement("article"),name=document.createElement("strong"),detail=document.createElement("small"),position=document.createElement("small");name.textContent=`${item.name} · ${item.state}`;detail.textContent=item.detail;position.textContent=`X ${item.position.x.toFixed(2)} m / Y ${item.position.y.toFixed(2)} m`;card.append(name,detail,position);$("motionStates").append(card);
    });
  }
  function tick(now){if(!playing||!scenario)return;if(last!==null)time=Math.min(scenario.plan.horizon_s,time+Math.min(1,(now-last)/1000)*Number($("motionSpeed").value));last=now;draw();if(time>=scenario.plan.horizon_s)pause();else raf=requestAnimationFrame(tick);}
  $("motionDemo").addEventListener("click",async()=>{const request=begin();$("motionStatus").textContent="Loading synthetic scenario…";try{const response=await fetch("examples/routes/resource-motion.json");if(!response.ok)throw new Error("Example could not be loaded");const raw=await response.json();if(request===revision)$("motionFile").value="";accept(raw,request);}catch(error){fail(error,request);}});
  $("motionPackageDemo").addEventListener("click",async()=>{const request=begin();$("motionStatus").textContent="Loading SQL-linked synthetic scenario…";try{const response=await fetch("examples/routes/package-resource-motion.json");if(!response.ok)throw new Error("Example could not be loaded");const raw=await response.json();if(request===revision)$("motionFile").value="";accept(raw,request);}catch(error){fail(error,request);}});
  $("motionFile").addEventListener("change",async()=>{const request=begin(),file=$("motionFile").files[0];if(!file){$("motionStatus").textContent="Choose a scenario or explore the example.";return;}try{if(file.size>5*1024*1024)throw new Error("Scenario exceeds 5 MB");accept(JSON.parse(await file.text()),request);}catch(error){fail(error,request);}});
  $("motionPlay").addEventListener("click",()=>{if(!scenario)return;if(playing){pause();return;}if(time>=scenario.plan.horizon_s)time=0;playing=true;last=null;$("motionPlay").textContent="Pause";raf=requestAnimationFrame(tick);});
  $("motionReset").addEventListener("click",()=>{pause();time=0;draw();});
  $("motionSeek").addEventListener("input",()=>{pause();time=Number($("motionSeek").value);draw();});
  $("motionSpeed").addEventListener("change",()=>{last=null;});
  $("motionProjection").addEventListener("change",draw);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pause();});
}());
