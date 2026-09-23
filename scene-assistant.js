/* Visible local guide and scene inspector. No model connection or external requests. */
(function () {
  "use strict";
  const WT = window.WT;
  function answer(question, snap) {
    const q = question.toLowerCase();
    if (/safety|safe|regulat|placement|danger|put/.test(q)) return "Placement proposals still need reviewed geometry, access envelopes, exits and applicable rules. The current layout checks are screening heuristics. I cannot approve a safe layout or invent regulatory clearances. Open Analyze for the existing findings.";
    if (/worker|people|person/.test(q)) return `${snap.workers.length} illustrative workers are represented. Select one below to inspect the same pose used by both views. Their movement is a drawing model, not tracked staff, a work schedule or a headcount recommendation.`;
    if (/package|parcel|track|order|pick/.test(q)) return `${snap.packages.length} packages are currently in the simulation, with ${snap.completed} completions at tick ${snap.tick}. Select an ID to see its stage, position and heading, and the handling unit it is in the run ledger (HU id, SSCC, order); the tracking store keeps a unit's EPCIS-shaped history across runs once you save the run - keyed to the unit, never to a person.${snap.packagesVisible ? "" : " Package drawing is hidden: use Play or Step to show it."}`;
    if (/speed|time|timer/.test(q)) return "In Simulate → Live material flow, choose 1×–100× and a duration in minutes, hours or days. 1× uses real elapsed time, but movement still updates in one-minute model buckets. Step advances up to eight minutes. Changing the duration resets the run.";
    if (/3d|2d|view/.test(q)) return "Use the 2.5D view button (P) to switch views. The selected entity uses the same world coordinates in both projections. Heights, worker poses and package dimensions remain illustrative; this is not surveyed BIM geometry.";
    return "I can explain packages, workers, timing, 2D/3D views and placement limitations using the current model. I am an offline rule-based guide; no language model is connected. Try ‘Track packages’ or ‘Explain workers’.";
  }
  WT.sceneAssistant = { answer };
  const panel = document.getElementById("sceneAssistant");
  if (!panel) return;
  const toggle = document.getElementById("sceneAssistantToggle");
  const picker = document.getElementById("sceneEntity");
  const details = document.getElementById("sceneEntityDetails");
  const log = document.getElementById("sceneChatLog");
  let signature = "";
  function message(text, role) {
    const p = document.createElement("p"); p.className = "scene-message scene-" + role;
    const label = document.createElement("strong"); label.textContent = role === "user" ? "You: " : "Guide: ";
    p.append(label, document.createTextNode(text)); log.append(p);
    while (log.children.length > 12) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function refresh() {
    if (panel.hidden) return;
    const snap = WT.sceneTracking.snapshot();
    const all = snap.packages.concat(snap.workers);
    if (!snap.selected) picker.value = "";
    const ids = all.map(p => p.id).join("|");
    if (ids !== signature) {
      const previous = picker.value;
      picker.replaceChildren(new Option("Choose a package or worker", ""));
      all.forEach(p => picker.append(new Option(p.id + " · " + p.task, p.id)));
      if (all.some(p => p.id === previous)) picker.value = previous;
      signature = ids;
    }
    if (snap.selected && !all.some(p => p.id === snap.selected)) WT.sceneTracking.select(null);
    document.getElementById("sceneCounts").textContent = `${snap.packages.length} packages · ${snap.workers.length} illustrative workers · tick ${snap.tick}`;
    const chosen = all.find(p => p.id === picker.value);
    if (chosen) {
      const degrees = ((chosen.heading * 180 / Math.PI) % 360 + 360) % 360;
      details.textContent = `${chosen.task} / ${chosen.status}. X ${chosen.x.toFixed(2)} m · Y ${chosen.y.toFixed(2)} m · heading ${degrees.toFixed(0)}°. ${chosen.basis}.` +
        (chosen.hu ? ` Handling unit ${chosen.hu} · SSCC ${chosen.sscc} · order ${chosen.order_ref || chosen.order_id} (run ledger, v3.53; its tracking twins carry the EPCIS-shaped history).` : "");
    } else details.textContent = "Select an entity to mark it in 2D and 3D. Package IDs leave the active list when completed; the run ledger and the tracking store keep the handling unit's history.";
  }
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); refresh();
  });
  document.getElementById("sceneAssistantClose").addEventListener("click", () => {
    panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus();
  });
  picker.addEventListener("change", () => { WT.sceneTracking.select(picker.value); refresh(); });
  document.getElementById("sceneChatForm").addEventListener("submit", event => {
    event.preventDefault(); const input = document.getElementById("sceneQuestion");
    const question = input.value.trim(); if (!question) return;
    message(question, "user"); message(answer(question, WT.sceneTracking.snapshot()), "guide"); input.value = "";
  });
  panel.querySelectorAll("[data-question]").forEach(button => button.addEventListener("click", () => {
    message(button.dataset.question, "user"); message(answer(button.dataset.question, WT.sceneTracking.snapshot()), "guide");
  }));
  message("I can explain this model and help inspect packages and workers. No AI model is connected; answers use local rules and current scene data.", "guide");
  refresh(); setInterval(refresh, 1000);
}());
