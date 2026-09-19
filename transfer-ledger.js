(function () {
  "use strict";
  const $=id=>document.getElementById(id);
  let model=null, token=0, layout=null, layoutToken=0, bindingRevision=0, bindingRequest=0;
  const bindings=new Map();
  let rawLayout=null, timeline=null, routeRequest=0, elapsed=0, playing=false, lastTick=null, animationId=null;
  function pauseRoute(){if(animationId!==null)cancelAnimationFrame(animationId);animationId=null;playing=false;lastTick=null;$("routePlay").textContent="Play scenario";}
  function clearRoute(){pauseRoute();timeline=null;routeRequest++;$("routeView").hidden=true;$("routeStatus").textContent="Load a floor, then a timeline from route_plan.py.";}
  function drawRoute(){
    if(!timeline)return;
    const frame=window.RoutePlayback.sample(timeline,elapsed),svg=$("routeFloor"),f=timeline.floor;
    svg.replaceChildren();svg.setAttribute("viewBox",`-1 -1 ${f.width+2} ${f.depth+2}`);
    const shape=(tag,attrs)=>{const n=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));svg.append(n);return n;};
    shape("rect",{x:0,y:0,width:f.width,height:f.depth,fill:"#1b201d",stroke:"#73877b","stroke-width":.05});
    f.elements.forEach(e=>shape("rect",{x:e.x,y:e.y,width:e.w,height:e.d,fill:"#405348"}));
    (f.reserved_zones||[]).forEach(e=>shape("rect",{x:e.x,y:e.y,width:e.w,height:e.d,fill:"#b89134",opacity:.5}));
    const size=Math.max(f.width,f.depth)*.012;
    shape("polyline",{points:timeline.route.points.map(p=>`${p.x},${p.y}`).join(" "),fill:"none",stroke:"#79dace","stroke-width":size*.45});
    shape("circle",{cx:frame.position.x,cy:frame.position.y,r:size,fill:"#a7fff0",stroke:"#15241f","stroke-width":size*.2});
    if(frame.heading!==null)shape("line",{x1:frame.position.x,y1:frame.position.y,x2:frame.position.x+Math.cos(frame.heading)*size*2.5,y2:frame.position.y+Math.sin(frame.heading)*size*2.5,stroke:"#fff","stroke-width":size*.4});
    $("routeSeek").value=String(elapsed);
    $("routeClock").textContent=`${elapsed.toFixed(2)} / ${timeline.duration_s.toFixed(2)} simulated seconds · ${frame.state} · X ${frame.position.x.toFixed(2)} m / Y ${frame.position.y.toFixed(2)} m · Assumed travel ${timeline.speed_mps} m/s`;
  }
  function animateRoute(now){
    if(!playing||!timeline)return;
    if(lastTick!==null)elapsed=Math.min(timeline.duration_s,elapsed+Math.min(1,(now-lastTick)/1000)*Number($("routeSpeed").value));
    lastTick=now;drawRoute();if(elapsed>=timeline.duration_s)pauseRoute();else animationId=requestAnimationFrame(animateRoute);
  }
  $("routeFile").addEventListener("change",async()=>{
    clearRoute();const request=routeRequest,currentFloor=rawLayout,file=$("routeFile").files[0];if(!file)return;
    try{
      if(!currentFloor)throw new Error("Load a floor first");if(file.size>5*1024*1024)throw new Error("Timeline exceeds 5 MB");
      const text=await file.text();if(request!==routeRequest||currentFloor!==rawLayout)return;
      const manifest=model&&model.packages[Number($("ledgerPackage").value)].manifest;
      timeline=window.RoutePlayback.parse(JSON.parse(text),currentFloor,manifest);elapsed=0;
      $("routeSeek").max=String(timeline.duration_s);$("routeView").hidden=false;
      const association=timeline.package_snapshot?`Scenario for ${manifest.id} · order ${manifest.order_id} · pick ${manifest.pick_id} · ledger version ${manifest.version}. Access nodes are user-declared; not execution history.`:"Unbound scenario; not linked to a SQL package.";
      $("routeStatus").textContent=`Checked geometry and timing · ${timeline.route.distance_m.toFixed(2)} m · ${timeline.route.mode}. ${association}`;drawRoute();
    }catch(error){$("routeStatus").textContent="Cannot preview route: "+error.message;}
  });
  $("routePlay").addEventListener("click",()=>{if(!timeline)return;if(playing){pauseRoute();return;}if(elapsed>=timeline.duration_s)elapsed=0;playing=true;lastTick=null;$("routePlay").textContent="Pause scenario";animationId=requestAnimationFrame(animateRoute);});
  $("routeReset").addEventListener("click",()=>{pauseRoute();elapsed=0;drawRoute();});
  $("routeSeek").addEventListener("input",()=>{pauseRoute();elapsed=Number($("routeSeek").value);drawRoute();});
  $("routeSpeed").addEventListener("change",()=>{lastTick=null;});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pauseRoute();});
  function drawMap(frame) {
    const svg=$("ledgerFloor"); svg.replaceChildren(); svg.toggleAttribute("hidden",!layout);
    $("ledgerBindings").textContent=Array.from(bindings,([location,equipment])=>`${location} → ${equipment}`).join(" · ") || "No locations linked.";
    const anchor=window.TransferReplay.locate(layout,bindings,frame);
    $("ledgerPositionNote").textContent=!frame.location?"In transit: no package marker is drawn because the ledger has no coordinates or path.":anchor?`Declared equipment anchor: ${anchor.id} · X ${anchor.x.toFixed(2)} m · Y ${anchor.y.toFixed(2)} m. Not a measured package position.`:`Location ${frame.location} has no equipment anchor. Link it explicitly.`;
    if (!layout) return;
    svg.setAttribute("viewBox",`-1 -1 ${layout.width+2} ${layout.depth+2}`);
    function shape(tag,attrs,label) {
      const node=document.createElementNS("http://www.w3.org/2000/svg",tag);
      Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));
      if(label){const title=document.createElementNS(node.namespaceURI,"title");title.textContent=label;node.append(title);}
      svg.append(node); return node;
    }
    shape("rect",{x:0,y:0,width:layout.width,height:layout.depth,fill:"#1b201d",stroke:"#73877b","stroke-width":.05});
    layout.elements.forEach(e=>shape("rect",{x:e.x,y:e.y,width:e.w,height:e.d,fill:"#405348",stroke:"#9baa9d","stroke-width":.05},`${e.id} · ${e.type}`));
    if(anchor){
      const radius=Math.max(layout.width,layout.depth)*.012;
      shape("circle",{cx:anchor.x,cy:anchor.y,r:radius,fill:"#f4d47d",stroke:"#171918","stroke-width":radius*.18},"Declared anchor for "+frame.location);
      const label=shape("text",{x:anchor.x+radius*1.5,y:anchor.y,"font-size":Math.max(layout.width,layout.depth)*.023,fill:"#fff0c0"}); label.textContent=frame.location;
    }
  }
  function render() {
    if (!model || !model.packages.length) return;
    const entry=model.packages[Number($("ledgerPackage").value)], p=entry.manifest;
    const position=Math.max(0,Math.min(entry.frames.length-1,Number($("ledgerPosition").value)));
    const frame=entry.frames[position];
    $("ledgerPosition").max=String(entry.frames.length-1); $("ledgerPosition").value=String(position);
    $("ledgerContents").textContent=`${p.quantity} × ${p.unit} of ${p.item_id} · Order ${p.order_id} · Line ${p.line_id} · Pick ${p.pick_id}`;
    $("ledgerState").textContent=frame.state;
    $("ledgerLocation").textContent=frame.location || "In transit · location unknown";
    $("ledgerResource").textContent=frame.resource || "Not assigned";
    $("ledgerRoute").textContent=`Declared transfer: ${p.source_id} → ${p.destination_id}`;
    $("ledgerReason").textContent=frame.reason || "No reason recorded for this event.";
    $("ledgerTime").textContent=`Event ${position+1} of ${entry.frames.length} · ${frame.at} · ID ${frame.eventId}`;
    drawMap(frame);
    $("ledgerPrevious").disabled=position===0; $("ledgerNext").disabled=position===entry.frames.length-1;
    $("ledgerRows").replaceChildren();
    entry.frames.forEach(f=>{
      const row=document.createElement("tr"); row.setAttribute("aria-current",String(f.version===position));
      [f.version,f.at,f.state,f.reason || "—"].forEach(value=>{const cell=document.createElement("td");cell.textContent=String(value);row.append(cell);});
      $("ledgerRows").append(row);
    });
  }
  $("ledgerFile").addEventListener("change",async()=>{
    const request=++token, file=$("ledgerFile").files[0];
    model=null; clearRoute(); bindings.clear(); bindingRevision++; $("ledgerView").hidden=true;
    if (!file) { $("ledgerStatus").textContent="No file selected."; return; }
    try {
      if (file.size>5*1024*1024) throw new Error("File exceeds 5 MB");
      const text=await file.text(); if (request!==token) return;
      model=window.TransferReplay.parse(JSON.parse(text));
      $("ledgerPackage").replaceChildren();
      model.packages.forEach((entry,i)=>$("ledgerPackage").append(new Option(entry.manifest.id,String(i))));
      $("ledgerMapLocation").replaceChildren();
      [...new Set(model.packages.flatMap(entry=>[entry.manifest.source_id,entry.manifest.destination_id]))].sort().forEach(id=>$("ledgerMapLocation").append(new Option(id,id)));
      $("ledgerPosition").value="0"; $("ledgerProvenance").textContent=model.provenance;
      $("ledgerView").hidden=!model.packages.length;
      $("ledgerStatus").textContent=`Loaded ${model.packages.length} package(s). Histories and resource intervals are consistent within this file; real-world accuracy is unverified.`;
      render();
    } catch(error) { model=null; $("ledgerStatus").textContent="Cannot open ledger: "+error.message; }
  });
  $("ledgerPackage").addEventListener("change",()=>{clearRoute();$("ledgerPosition").max="10000"; $("ledgerPosition").value="0"; render();});
  $("ledgerLayoutFile").addEventListener("change",async()=>{
    const request=++layoutToken,file=$("ledgerLayoutFile").files[0];
    layout=null;rawLayout=null;clearRoute(); bindings.clear(); bindingRevision++; $("ledgerMapElement").replaceChildren(); render();
    if(!file){$("ledgerMapStatus").textContent="No floor loaded.";return;}
    try {
      if(file.size>5*1024*1024) throw new Error("Layout exceeds 5 MB");
      const text=await file.text(); if(request!==layoutToken)return;
      const candidate=JSON.parse(text);layout=window.TransferReplay.parseLayout(candidate);rawLayout=candidate;
      layout.elements.forEach(e=>$("ledgerMapElement").append(new Option(`${e.id} · ${e.type}`,e.id)));
      $("ledgerMapStatus").textContent=`${layout.width} × ${layout.depth} m · ${layout.elements.length} equipment footprints. Source geometry is user-declared.`;render();
    } catch(error){$("ledgerMapStatus").textContent="Cannot open floor: "+error.message;render();}
  });
  $("ledgerBind").addEventListener("click",()=>{
    const location=$("ledgerMapLocation").value,equipment=$("ledgerMapElement").value;
    if(!layout || !location || !layout.elements.some(e=>e.id===equipment)){$("ledgerMapStatus").textContent="Load a floor and choose a location and equipment.";return;}
    bindings.set(location,equipment);bindingRevision++;render();
  });
  $("ledgerUnbind").addEventListener("click",()=>{bindings.delete($("ledgerMapLocation").value);bindingRevision++;render();});
  function locationIds() { if(!model)throw new Error("Load a ledger first");return model.packages.flatMap(e=>[e.manifest.source_id,e.manifest.destination_id]); }
  $("ledgerMapExport").addEventListener("click",()=>{
    try {
      const snapshot=window.TransferReplay.exportBindings(layout,bindings,locationIds());
      const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="factory-location-links.json";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      $("ledgerMapStatus").textContent="Location-link download prepared with its floor geometry snapshot.";
    } catch(error){$("ledgerMapStatus").textContent="Cannot export links: "+error.message;}
  });
  $("ledgerMapImport").addEventListener("change",async()=>{
    const request=++bindingRequest, revision=bindingRevision, currentLayout=layout, currentModel=model, file=$("ledgerMapImport").files[0];
    if(!file)return;
    try {
      if(file.size>5*1024*1024)throw new Error("Location links exceed 5 MB");
      const text=await file.text();if(request!==bindingRequest)return;
      if(revision!==bindingRevision || currentLayout!==layout || currentModel!==model)throw new Error("Floor, ledger or links changed during import; choose the file again");
      const imported=window.TransferReplay.importBindings(JSON.parse(text),layout,locationIds());
      bindings.clear();imported.forEach((equipment,location)=>bindings.set(location,equipment));bindingRevision++;render();
      $("ledgerMapStatus").textContent=`Imported ${bindings.size} links matching this floor. Declared associations still require review.`;
    } catch(error){$("ledgerMapStatus").textContent="Cannot import links: "+error.message;}
  });
  $("ledgerPosition").addEventListener("input",render);
  $("ledgerPrevious").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)-1);render();});
  $("ledgerNext").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)+1);render();});
}());
