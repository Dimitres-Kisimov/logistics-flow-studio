(function () {
  "use strict";
  const $=id=>document.getElementById(id);
  let model=null, token=0;
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
    model=null; $("ledgerView").hidden=true;
    if (!file) { $("ledgerStatus").textContent="No file selected."; return; }
    try {
      if (file.size>5*1024*1024) throw new Error("File exceeds 5 MB");
      const text=await file.text(); if (request!==token) return;
      model=window.TransferReplay.parse(JSON.parse(text));
      $("ledgerPackage").replaceChildren();
      model.packages.forEach((entry,i)=>$("ledgerPackage").append(new Option(entry.manifest.id,String(i))));
      $("ledgerPosition").value="0"; $("ledgerProvenance").textContent=model.provenance;
      $("ledgerView").hidden=!model.packages.length;
      $("ledgerStatus").textContent=`Loaded ${model.packages.length} package(s). Event sequences match their manifests; real-world accuracy is unverified.`;
      render();
    } catch(error) { model=null; $("ledgerStatus").textContent="Cannot open ledger: "+error.message; }
  });
  $("ledgerPackage").addEventListener("change",()=>{$("ledgerPosition").max="10000"; $("ledgerPosition").value="0"; render();});
  $("ledgerPosition").addEventListener("input",render);
  $("ledgerPrevious").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)-1);render();});
  $("ledgerNext").addEventListener("click",()=>{$("ledgerPosition").value=String(Number($("ledgerPosition").value)+1);render();});
}());
