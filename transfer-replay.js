(function () {
  "use strict";
  const next = { waiting:["assigned"], assigned:["loading"], loading:["travelling"], travelling:["blocked","unloading"], blocked:["travelling"], unloading:["delivered"], delivered:[] };
  function requireThat(ok, message) { if (!ok) throw new Error(message); }
  function id(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
  function parse(raw) {
    requireThat(raw && raw.schema === "factory-transfer-ledger/v1", "Unsupported ledger schema");
    requireThat(Array.isArray(raw.packages) && raw.packages.length <= 1000 && Array.isArray(raw.events) && raw.events.length <= 10000, "Invalid or oversized ledger");
    const packages = new Map(), ids = new Set();
    raw.packages.forEach(p => {
      requireThat(p && [p.id,p.pick_id,p.order_id,p.line_id,p.item_id,p.unit,p.source_id,p.destination_id].every(id), "Missing package identity or contents");
      requireThat(!packages.has(p.id) && Number.isSafeInteger(p.quantity) && p.quantity > 0 && Number.isSafeInteger(p.version) && p.version >= 0, "Duplicate package or invalid quantity/version");
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
    return {provenance:typeof raw.provenance === "string"?raw.provenance:"Unverified declared data",packages:Array.from(packages.values())};
  }
  const api={parse};
  if (typeof module !== "undefined" && module.exports) module.exports=api;
  else window.TransferReplay=api;
}());
