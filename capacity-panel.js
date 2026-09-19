/* DOM adapter for the offline, manually editable shift planning workbench. */
(function () {
  "use strict";
  const core = window.WT.capacityPlan;
  const root = document.getElementById("capacityCard");
  if (!root) return;
  const pick = document.getElementById("capacityProfile");
  const form = document.getElementById("capacityInputs");
  const output = document.getElementById("capacityResults");
  const notice = document.getElementById("capacityNotice");
  const plans = Object.fromEntries(Object.keys(core.profiles).map(k => [k, core.example(k)]));
  const edited = new Set();
  const n = value => Number(value.toFixed(2)).toLocaleString("en-GB");
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function renderResults() {
    output.replaceChildren();
    const input = plans[pick.value];
    try {
      const r = core.evaluate(input);
      const tiles = el("div", undefined, "capacity-metrics");
      for (const [value, label] of [[r.workerLowerBound, "Workers · workload bound"],
        [n(r.labourMinutes), "Labour · person-minutes"], [n(r.closingStock), "Closing stock · " + core.profiles[pick.value].stockUnit],
        [n(r.netImportKWh), "Net electricity import · kWh"]]) {
        const tile = el("div", undefined, "capacity-metric");
        tile.append(el("strong", String(value)), el("span", label)); tiles.append(tile);
      }
      output.append(tiles);
      const findings = el("ul", undefined, "capacity-findings");
      findings.append(el("li", r.shortfallMinutes > 0 ?
        `${n(r.shortfallMinutes)} person-minutes short with ${input.workers} workers. Review staffing or the order window.` :
        "Workload fits the entered labour budget. Machine capacity, skills and task timing still need scheduling.",
      r.shortfallMinutes > 0 ? "capacity-gap" : ""));
      findings.append(el("li", r.stockShortfall > 0 ? `${n(r.stockShortfall)} ${core.profiles[pick.value].stockUnit} short of the closing reserve. Check supply before release.` :
        "Closing stock covers the entered reserve. Receipt timing and intermediate stockouts are not checked.",
      r.stockShortfall > 0 ? "capacity-gap" : ""));
      findings.append(el("li", r.energyBalanced ? "Electricity inputs reconcile for the entered period." :
        `${n(r.residualKWh)} kWh unexplained. Check meter boundaries, missing readings and losses.`,
      r.energyBalanced ? "" : "capacity-gap"));
      output.append(findings);
      document.getElementById("capacityExport").disabled = false;
    } catch (error) {
      output.append(el("p", error.message, "capacity-gap"));
      document.getElementById("capacityExport").disabled = true;
    }
    notice.textContent = edited.has(pick.value) ? "Edited planning assumptions · not measured. Kept in this tab until reloaded; export to retain your work." :
      "Synthetic starting assumptions · edit to explore. These inputs are separate from the floor simulation.";
  }
  function renderFields() {
    form.replaceChildren();
    const headings = { order: "01 / Order & people", shift: "02 / Shift availability", stock: "03 / Material balance", energy: "04 / Electricity balance" };
    for (const [group, heading] of Object.entries(headings)) {
      const section = el("details", undefined, "capacity-section");
      section.open = group === "order";
      section.append(el("summary", heading));
      if (group === "stock") section.append(el("p", "One material: " + core.profiles[pick.value].stockUnit + ". Opening + receipts − issues. Other movements are outside this worksheet.", "hint"));
      if (group === "energy") section.append(el("p", "Same period and meter boundary. Enter interval kWh, not cumulative readings. Import and export stay separate.", "hint"));
      const grid = el("div", undefined, "capacity-fields");
      for (const [key, label, sectionName] of core.fields) {
        if (sectionName !== group) continue;
        const wrap = el("div"), caption = el("label", label + (key === "quantity" ? " (" + core.profiles[pick.value].unit + ")" : ""));
        caption.htmlFor = "capacity-" + key;
        const input = el("input"); input.type = "number"; input.id = caption.htmlFor;
        input.min = "0"; input.step = key === "workers" ? "1" : "any";
        input.value = String(plans[pick.value][key]);
        input.addEventListener("input", () => {
          plans[pick.value][key] = input.value === "" ? NaN : Number(input.value);
          edited.add(pick.value); renderResults();
        });
        wrap.append(caption, input); grid.append(wrap);
      }
      section.append(grid); form.append(section);
    }
    renderResults();
  }
  pick.addEventListener("change", renderFields);
  document.getElementById("capacityReset").addEventListener("click", () => {
    plans[pick.value] = core.example(pick.value); edited.delete(pick.value); renderFields();
  });
  document.getElementById("capacityImport").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error("Plan file exceeds 100 KB.");
      const payload = JSON.parse(await file.text());
      if (payload.kind !== "factory-shift-screening") throw new Error("Choose an exported shift plan.");
      core.evaluate(payload.inputs);
      const clean = { version: 1, profile: payload.inputs.profile };
      core.fields.forEach(([key]) => { clean[key] = payload.inputs[key]; });
      plans[clean.profile] = clean; pick.value = clean.profile; edited.add(clean.profile); renderFields();
    } catch (error) { notice.textContent = "Import not applied: " + error.message; }
    event.target.value = "";
  });
  document.getElementById("capacityExport").addEventListener("click", () => {
    const inputs = plans[pick.value];
    const payload = { kind: "factory-shift-screening", inputs, results: core.evaluate(inputs),
      scope: "Planning assumptions, not measured data. Workload bound only; no schedule, safety or utility design validation." };
    const link = el("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.download = "factory-shift-" + pick.value + ".json"; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  renderFields();
}());
