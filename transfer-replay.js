(function () {
  "use strict";
  const next = { waiting:["assigned"], assigned:["loading"], loading:["travelling"], travelling:["blocked","unloading"], blocked:["travelling"], unloading:["delivered"], delivered:[] };
  function requireThat(ok, message) { if (!ok) throw new Error(message); }
  function id(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
  function parse(raw) {
    requireThat(raw && raw.schema === "factory-transfer-ledger/v1", "Unsupported ledger schema");
    requireThat(Array.isArray(raw.packages) && raw.packages.length <= 1000 && Array.isArray(raw.events) && raw.events.length <= 10000, "Invalid or oversized ledger");
    const packages = new Map(), ids = new Set(), picks = new Set();
    raw.packages.forEach(p => {
      requireThat(p && [p.id,p.pick_id,p.order_id,p.line_id,p.item_id,p.unit,p.source_id,p.destination_id].every(id), "Missing package identity or contents");
      requireThat(!packages.has(p.id) && Number.isSafeInteger(p.quantity) && p.quantity > 0 && Number.isSafeInteger(p.version) && p.version >= 0, "Duplicate package or invalid quantity/version");
      requireThat(!picks.has(p.pick_id), "A completed pick cannot belong to two packages"); picks.add(p.pick_id);
      requireThat(p.source_id !== p.destination_id, "Transfer endpoints must differ");
      packages.set(p.id, {manifest:{...p}, events:[], frames:[]});
    });
    raw.events.forEach(e => {
      requireThat(e && id(e.id) && !ids.has(e.id) && packages.has(e.package_id), "Duplicate event or unknown package");
      requireThat(Number.isSafeInteger(e.version) && e.version >= 0 && typeof e.occurred_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/.test(e.occurred_at) && Number.isFinite(Date.parse(e.occurred_at)), "Invalid event version or UTC time");
      requireThat(e.payload && typeof e.payload === "object" && e.payload.at === e.occurred_at, "Event timestamp/payload mismatch");
      requireThat(new Date(e.occurred_at).toISOString().slice(0,19) === e.occurred_at.slice(0,19), "Invalid calendar date");
      ids.add(e.id); packages.get(e.package_id).events.push({...e,payload:{...e.payload}});
    });
    packages.forEach(entry => {
      const p=entry.manifest; let state=null, resource=null, previousTime="";
      entry.events.sort((a,b)=>a.version-b.version);
      requireThat(entry.events.length === p.version+1, "Incomplete package history");
      entry.events.forEach((e,i)=>{
        const q=e.payload;
        requireThat(e.version === i && e.occurred_at >= previousTime, "Noncontiguous versions or backwards time");
        if (i===0) requireThat(e.state === "waiting" && q.kind === "created" && q.pick === p.pick_id && q.source === p.source_id && q.destination === p.destination_id, "Creation identity mismatch");
        else {
          requireThat(q.kind === "transition" && q.target === e.state && q.expected_version === i-1 && next[state].includes(e.state), "Illegal state transition");
          if (e.state === "assigned") { requireThat(id(q.resource), "Assignment needs a resource"); resource=q.resource; }
          else requireThat(q.resource === null, "Unexpected reassignment");
          requireThat(typeof q.reason === "string" && q.reason.length <= 1000 && (e.state !== "blocked" || q.reason.trim()), "Invalid blocking reason");
        }
        state=e.state; previousTime=e.occurred_at;
        const location=["travelling","blocked"].includes(state)?null:["unloading","delivered"].includes(state)?p.destination_id:p.source_id;
        entry.frames.push({version:i,state,resource,location,at:e.occurred_at,reason:q.reason || "",eventId:e.id});
      });
      const last=entry.frames[entry.frames.length-1];
      requireThat(last && last.state===p.state && last.location===p.location_id && last.resource===p.resource_id && last.at===p.updated_at, "Manifest does not match event history");
    });
    const occupancy=new Map();
    packages.forEach(entry=>{
      const start=entry.frames.find(f=>f.state==="assigned");
      if(!start)return;
      const last=entry.frames[entry.frames.length-1];
      const end=last.state==="delivered"?last.at:null;
      // Half-open intervals: a release and next assignment may share a time.
      // Fixed-width UTC strings preserve all six fractional digits.
      if(!occupancy.has(start.resource))occupancy.set(start.resource,[]);
      occupancy.get(start.resource).push({start:start.at,end,packageId:entry.manifest.id});
    });
    occupancy.forEach((intervals,resource)=>{
      intervals.sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:(a.end || "~")<(b.end || "~")?-1:(a.end || "~")>(b.end || "~")?1:0);
      let previous=null;
      intervals.forEach(current=>{
        requireThat(!previous || (previous.end!==null && current.start>=previous.end), `Overlapping transfers for resource ${resource}`);
        previous=current;
      });
    });
    return {provenance:typeof raw.provenance === "string"?raw.provenance:"Unverified declared data",packages:Array.from(packages.values())};
  }
  function parseLayout(raw) {
    requireThat(raw && raw.version === "wt-1" && [raw.gridW,raw.gridH,raw.cell].every(v=>Number.isFinite(v)&&v>0), "Use a planner layout export with positive dimensions and cell size");
    requireThat(Array.isArray(raw.elements) && raw.elements.length<=10000, "Invalid or oversized layout");
    const ids=new Set();
    const elements=raw.elements.map(e=>{
      requireThat(e && id(e.id) && !ids.has(e.id) && [e.x,e.y,e.w,e.d].every(Number.isFinite) && e.x>=0 && e.y>=0 && e.w>0 && e.d>0 && e.x+e.w<=raw.gridW && e.y+e.d<=raw.gridH, "Duplicate ID or invalid equipment footprint");
      ids.add(e.id);
      return {id:e.id,type:typeof e.type==="string"?e.type:"equipment",x:e.x*raw.cell,y:e.y*raw.cell,w:e.w*raw.cell,d:e.d*raw.cell};
    });
    requireThat([raw.gridW*raw.cell,raw.gridH*raw.cell,...elements.flatMap(e=>[e.x,e.y,e.w,e.d])].every(Number.isFinite), "Layout coordinates overflow");
    return {width:raw.gridW*raw.cell,depth:raw.gridH*raw.cell,elements};
  }
  function locate(layout, bindings, frame) {
    if (!layout || !frame.location) return null;
    const element=layout.elements.find(e=>e.id===bindings.get(frame.location));
    return element?{id:element.id,x:element.x+element.w/2,y:element.y+element.d/2}:null;
  }
  function floorSnapshot(layout) {
    requireThat(layout, "Load a floor first");
    return {width:layout.width,depth:layout.depth,elements:layout.elements.map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,w:e.w,d:e.d})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
  }
  function importBindings(raw, layout, locations) {
    requireThat(raw && raw.schema === "factory-transfer-map/v1" && raw.floor, "Unsupported location-link format");
    const checked=parseLayout({version:"wt-1",gridW:raw.floor.width,gridH:raw.floor.depth,cell:1,elements:raw.floor.elements});
    requireThat(JSON.stringify(floorSnapshot(checked)) === JSON.stringify(floorSnapshot(layout)), "Floor geometry or equipment identity changed; review and relink locations");
    requireThat(Array.isArray(raw.bindings) && raw.bindings.length<=2000, "Invalid or oversized location links");
    const result=new Map(), knownLocations=new Set(locations), equipment=new Set(layout.elements.map(e=>e.id));
    raw.bindings.forEach(pair=>{
      requireThat(Array.isArray(pair) && pair.length===2 && pair.every(id) && knownLocations.has(pair[0]) && equipment.has(pair[1]) && !result.has(pair[0]), "Unknown, duplicate or malformed location link");
      result.set(pair[0],pair[1]);
    });
    return result;
  }
  function exportBindings(layout, bindings, locations) {
    const result={schema:"factory-transfer-map/v1",floor:floorSnapshot(layout),bindings:Array.from(bindings).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)};
    importBindings(result,layout,locations);
    return result;
  }
  const api={parse,parseLayout,locate,exportBindings,importBindings};
  if (typeof module !== "undefined" && module.exports) module.exports=api;
  else window.TransferReplay=api;
}());
