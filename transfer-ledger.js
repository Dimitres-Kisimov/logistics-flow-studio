(function () {
  "use strict";
  const $=id=>document.getElementById(id);
  let model=null, token=0, layout=null, layoutToken=0;
  const bindings=new Map();
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
    model=null; bindings.clear(); $("ledgerView").hidden=true;
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
  $("ledgerPackage").addEventListener("change",()=>{$("ledgerPosition").max="10000"; $("ledgerPosition").value="0"; render();});
  $("ledgerLayoutFile").addEventListener("change",async()=>{
    const request=++layoutToken,file=$("ledgerLayoutFile").files[0];
    layout=null; bindings.clear(); $("ledgerMapElement").replaceChildren(); render();
    if(!file){$("ledgerMapStatus").textContent="No floor loaded.";return;}
    try {
      if(file.size>5*1024*1024) throw new Error("Layout exceeds 5 MB");
      const text=await file.text(); if(request!==layoutToken)return;
      layout=window.TransferReplay.parseLayout(JSON.parse(text));
      layout.elements.forEach(e=>$("ledgerMapElement").append(new Option(`${e.id} · ${e.type}`,e.id)));
      $("ledgerMapStatus").textContent=`${layout.width} × ${layout.depth} m · ${layout.elements.length} equipment footprints. Source geometry is user-declared.`;render();
    } catch(error){$("ledgerMapStatus").textContent="Cannot open floor: "+error.message;render();}
  });
  $("ledgerBind").addEventListener("click",()=>{
    const location=$("ledgerMapLocation").value,equipment=$("ledgerMapElement").value;
    if(!layout || !location || !layout.elements.some(e=>e.id===equipment)){$("ledgerMapStatus").textContent="Load a floor and choose a location and equipment.";return;}
    bindings.set(location,equipment);render();
  });
  $("ledgerUnbind").addEventListener("click",()=>{bindings.delete($("ledgerMapLocation").value);render();});
  $("ledgerPosition").addEventListener("input",render);
  $("ledgerPrevious").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)-1);render();});
  $("ledgerNext").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)+1);render();});
}());
