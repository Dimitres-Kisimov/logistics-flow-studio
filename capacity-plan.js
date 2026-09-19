/* Editable single-order screening. No scheduling, physics or compliance claims. */
(function () {
  "use strict";
  const WT = window.WT = window.WT || {};
  const fields = [
    ["quantity", "Order quantity", "order"],
    ["labourMinutesPerUnit", "Labour minutes per unit", "order"],
    ["setupLabourMinutes", "Setup labour minutes", "order"],
    ["workers", "Available workers", "order"],
    ["paidMinutes", "Shift minutes per worker", "shift"],
    ["breakMinutes", "Break minutes per worker", "shift"],
    ["otherUnavailableMinutes", "Other unavailable minutes", "shift"],
    ["opening", "Opening stock", "stock"],
    ["receipts", "Expected receipts", "stock"],
    ["issues", "Planned material issues", "stock"],
    ["reserved", "Required closing reserve", "stock"],
    ["importKWh", "Electricity imported (kWh)", "energy"],
    ["exportKWh", "Electricity exported (kWh)", "energy"],
    ["generationKWh", "On-site generation (kWh)", "energy"],
    ["loadKWh", "Recorded load (kWh)", "energy"],
    ["batteryChargeKWh", "Battery charge (kWh)", "energy"],
    ["batteryDischargeKWh", "Battery discharge (kWh)", "energy"],
    ["lossKWh", "Declared losses (kWh)", "energy"]
  ];
  const profiles = {
    "assembly-warehouse": { label: "Assembly & warehouse", unit: "pieces", stockUnit: "kits",
      values: [300, 3, 60, 2, 480, 30, 30, 250, 40, 300, 0, 100, 20, 40, 105, 10, 0, 5] },
    "process-manufacturing": { label: "Process manufacturing", unit: "kg", stockUnit: "kg feedstock",
      values: [1200, 0.4, 90, 1, 480, 30, 30, 1500, 200, 1200, 100, 360, 5, 60, 405, 10, 10, 7] }
  };
  function example(profile) {
    if (!Object.keys(profiles).includes(profile)) throw new Error("Select a supported factory type.");
    const out = { version: 1, profile };
    fields.forEach((f, i) => { out[f[0]] = profiles[profile].values[i]; });
    return out;
  }
  function evaluate(input) {
    if (!input || input.version !== 1 || !Object.keys(profiles).includes(input.profile)) throw new Error("Unsupported planning format.");
    fields.forEach(([key, label]) => {
      if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0)
        throw new Error(label + " must be a finite, non-negative number.");
    });
    if (!Number.isInteger(input.workers)) throw new Error("Available workers must be a whole number.");
    if (input.quantity <= 0) throw new Error("Order quantity must be greater than zero.");
    const available = input.paidMinutes - input.breakMinutes - input.otherUnavailableMinutes;
    if (available <= 0) throw new Error("Breaks and unavailable time leave no productive shift time.");
    const labour = input.quantity * input.labourMinutesPerUnit + input.setupLabourMinutes;
    const capacity = input.workers * available;
    const residual = input.importKWh + input.generationKWh + input.batteryDischargeKWh -
      input.exportKWh - input.loadKWh - input.batteryChargeKWh - input.lossKWh;
    const closing = input.opening + input.receipts - input.issues;
    const result = { availableMinutes: available, labourMinutes: labour,
      workerLowerBound: Math.ceil(labour / available), capacityMinutes: capacity,
      shortfallMinutes: Math.max(0, labour - capacity), closingStock: closing,
      stockShortfall: Math.max(0, input.reserved - closing), netImportKWh: input.importKWh - input.exportKWh,
      residualKWh: residual, energyBalanced: Math.abs(residual) <= 1e-6 };
    Object.values(result).forEach(value => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Values are too large to calculate reliably.");
    });
    return result;
  }
  WT.capacityPlan = { fields, profiles, example, evaluate };
}());
