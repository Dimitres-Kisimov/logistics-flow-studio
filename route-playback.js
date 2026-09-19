(function () {
  "use strict";
  const requireThat=(ok,message)=>{if(!ok)throw new Error(message);};
  const finite=v=>Number.isFinite(v)&&v>=0;
  const same=(a,b)=>a.id===b.id&&a.x===b.x&&a.y===b.y;
  const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  function geometry(raw) {
    requireThat(raw&&raw.version==="wt-1"&&[raw.cell,raw.gridW,raw.gridH].every(v=>finite(v)&&v>0),"Invalid floor dimensions");
    const width=raw.cell*raw.gridW,depth=raw.cell*raw.gridH;
    requireThat(Number.isFinite(width+depth)&&Math.max(width,depth)<=1000000&&Array.isArray(raw.elements)&&raw.elements.length<=10000,"Unsupported floor extent");
    const ids=new Set();
    function rect(r,scale) {
      requireThat(r&&[r.x,r.y,r.w,r.d].every(finite)&&r.w>0&&r.d>0,"Invalid obstacle rectangle");
      const out={x:r.x*scale,y:r.y*scale,w:r.w*scale,d:r.d*scale};
      requireThat(Object.values(out).every(Number.isFinite)&&out.x+out.w<=width&&out.y+out.d<=depth,"Obstacle outside floor");return out;
    }
    const elements=raw.elements.map(e=>{requireThat(e&&typeof e.id==="string"&&e.id.trim()&&e.id.length<=200&&!ids.has(e.id),"Invalid equipment ID");ids.add(e.id);return {id:e.id,...rect(e,raw.cell)};}).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    let zones=[];
    if(raw.placementConstraintDraft!==undefined){
      requireThat(typeof raw.placementConstraintDraft==="string"&&raw.placementConstraintDraft.length<=32768,"Invalid placement draft");
      const draft=JSON.parse(raw.placementConstraintDraft);
      requireThat(draft&&typeof draft==="object"&&!Array.isArray(draft)&&Object.keys(draft).every(k=>["zones","fixedIds"].includes(k)),"Invalid placement draft fields");
      requireThat(draft.fixedIds===undefined||(Array.isArray(draft.fixedIds)&&draft.fixedIds.every(id=>ids.has(id))),"Unknown fixed equipment");
      zones=draft.zones===undefined?[]:draft.zones;
      requireThat(Array.isArray(zones)&&zones.length<=100,"Invalid reserved areas");
      zones=zones.map(z=>{requireThat(z&&Object.keys(z).length===4&&Object.keys(z).every(k=>["x","y","w","d"].includes(k)),"Invalid reserved area");return rect(z,1);}).sort((a,b)=>a.x-b.x||a.y-b.y||a.w-b.w||a.d-b.d);
    }
    return {width,depth,elements,...(zones.length?{reserved_zones:zones}:{})};
  }
  function intersects(a,b,r,c) {
    let lo=0,hi=1;
    for(const [axis,span] of [["x","w"],["y","d"]]){
      const low=r[axis]-c,high=r[axis]+r[span]+c,delta=b[axis]-a[axis];
      if(delta===0){if(a[axis]<low||a[axis]>high)return false;}
      else {const t=[(low-a[axis])/delta,(high-a[axis])/delta].sort((x,y)=>x-y);lo=Math.max(lo,t[0]);hi=Math.min(hi,t[1]);if(lo>hi)return false;}
    }return true;
  }
  function parse(raw,rawFloor,manifest) {
    requireThat(raw&&raw.schema==="factory-route-timeline/v1"&&raw.provenance==="assumed-simulation-not-telemetry","Use an assumed route timeline export");
    const floor=geometry(rawFloor);
    requireThat(raw.floor,"Timeline lacks floor snapshot; regenerate it with the current CLI");
    const snapshot=geometry({version:"wt-1",cell:1,gridW:raw.floor.width,gridH:raw.floor.depth,elements:raw.floor.elements,placementConstraintDraft:JSON.stringify({zones:raw.floor.reserved_zones||[]})});
    requireThat(JSON.stringify(snapshot)===JSON.stringify(floor),"Floor or reserved areas changed; regenerate route");
    const r=raw.route,c=r&&r.clearance_m;
    requireThat(r&&r.schema==="factory-route-proposal/v1"&&r.found===true&&["worker","forklift","agv"].includes(r.mode)&&finite(c),"Timeline has no usable screened route");
    requireThat(Array.isArray(r.points)&&r.points.length>0&&r.points.length<=1000&&Array.isArray(raw.segments)&&raw.segments.length===r.points.length-1,"Invalid route points or segments");
    if(raw.package_snapshot!==undefined||raw.location_access!==undefined){
      const p=raw.package_snapshot,access=raw.location_access;
      requireThat(p&&manifest&&["id","pick_id","source_id","destination_id","order_id","line_id","item_id","quantity","unit","version","updated_at"].every(k=>Object.hasOwn(p,k)&&p[k]===manifest[k]),"Scenario package identity or version differs from the selected ledger package");
      requireThat(access&&typeof access==="object"&&!Array.isArray(access)&&Object.keys(access).length===2&&p.source_id!==p.destination_id&&Object.hasOwn(access,p.source_id)&&Object.hasOwn(access,p.destination_id)&&access[p.source_id]===r.points[0].id&&access[p.destination_id]===r.points[r.points.length-1].id&&access[p.source_id]!==access[p.destination_id],"Package locations do not match declared route access nodes");
    }
    const ids=new Set();
    r.points.forEach(p=>{requireThat(p&&typeof p.id==="string"&&p.id.trim()&&p.id.length<=200&&!ids.has(p.id)&&finite(p.x)&&finite(p.y),"Invalid route point");ids.add(p.id);requireThat(p.x>=c&&p.y>=c&&p.x<=floor.width-c&&p.y<=floor.depth-c,"Route violates floor clearance");});
    requireThat(finite(raw.speed_mps)&&raw.speed_mps>0&&finite(raw.loading_s)&&finite(raw.unloading_s),"Invalid timing assumptions");
    let cursor=raw.loading_s,distance=0;
    const obstacles=[...floor.elements,...(floor.reserved_zones||[])];
    requireThat(!obstacles.some(o=>intersects(r.points[0],r.points[0],o,c)),"Route access intersects obstacle");
    raw.segments.forEach((s,i)=>{
      const a=r.points[i],b=r.points[i+1],length=Math.hypot(b.x-a.x,b.y-a.y),duration=length/raw.speed_mps;
      requireThat(s&&s.source&&s.destination&&same(s.source,a)&&same(s.destination,b)&&finite(s.start_s)&&finite(s.end_s)&&close(s.start_s,cursor)&&close(s.end_s,cursor+duration)&&(duration===0||s.end_s>s.start_s),"Segment geometry or timing inconsistent");
      requireThat(!obstacles.some(o=>intersects(a,b,o,c)),"Route intersects equipment or reserved area");
      distance+=length;cursor+=duration;
    });
    requireThat(close(r.distance_m,distance)&&close(raw.travel_end_s,cursor)&&close(raw.duration_s,cursor+raw.unloading_s)&&raw.duration_s<=31536000,"Invalid total duration or distance (maximum 365 days)");
    // Rebuild times from checked geometry so tolerated floating-point differences cannot create gaps.
    const result=JSON.parse(JSON.stringify(raw));cursor=result.loading_s;
    result.segments.forEach(s=>{s.start_s=cursor;cursor+=Math.hypot(s.destination.x-s.source.x,s.destination.y-s.source.y)/result.speed_mps;s.end_s=cursor;});
    result.travel_end_s=cursor;result.duration_s=cursor+result.unloading_s;return result;
  }
  function sample(t,tick) {
    requireThat(finite(tick),"Invalid elapsed time");
    const first=t.route.points[0],last=t.route.points[t.route.points.length-1];
    const position=p=>({x:p.x,y:p.y});
    if(tick>=t.duration_s)return {state:"delivered",position:position(last),heading:null};
    if(tick>=t.travel_end_s)return {state:"unloading",position:position(last),heading:null};
    if(tick<t.loading_s)return {state:"loading",position:position(first),heading:null};
    const s=t.segments.find(s=>tick>=s.start_s&&tick<s.end_s);
    requireThat(s,"Timeline has no segment at this time");
    const a=s.source,b=s.destination,f=(tick-s.start_s)/(s.end_s-s.start_s);
    return {state:"travelling",position:{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f},heading:Math.atan2(b.y-a.y,b.x-a.x)};
  }
  const api={parse,sample,geometry};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else window.RoutePlayback=api;
}());
