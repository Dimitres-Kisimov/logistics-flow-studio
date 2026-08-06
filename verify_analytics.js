/* =====================================================================
 * verify_analytics.js - ANALYTICS suite A1 harness (v3.1). Proves the NEW
 * analytics.js code path: the Bottleneck Analyzer + the Sankey material-
 * flow diagram (WT.analytics), READ-ONLY analysis over the app's EXISTING
 * sim state (WT.process.metrics for a factory line, WT.wms.runOperations
 * for a warehouse). It re-runs NOTHING and re-invents NOTHING; everything
 * is pure + deterministic.
 *
 *   BOTTLENECK ANALYZER (ranks by utilisation / load vs capacity + names
 *   the SAME constraint the sim/process reports -> can't diverge)
 *     - FACTORY: bottleneckFromProcess() rank #1 === the metrics.bottleneck
 *       station (utilisation = 1 at the bottleneck); resources sorted desc;
 *       constraint === rank #1; pct = round(value * 100) (proportional).
 *     - WAREHOUSE: bottleneckFromWarehouse() rank #1 === the wms flow sim's
 *       bottleneckIndex stage (lowest capacity), identical tiebreak; the
 *       displayed value is load vs capacity (offered demand / capacity).
 *     - a plain-language "why" + the honesty labels are present.
 *
 *   SANKEY MATERIAL-FLOW DIAGRAM (widths proportional to flow; the SVG is
 *   deterministic + well-formed + theme-aware)
 *     - FACTORY: nodes = Source..stations..Drain from process.routing;
 *       WAREHOUSE: the 7-stage spine, volumes = the flow sim's processed.
 *     - sankeyLayout() link band thickness w is PROPORTIONAL to the flow
 *       value (w_i / w_j == value_i / value_j) and the dominant link flagged.
 *     - sankeySvg() is BYTE-IDENTICAL across runs, well-formed (balanced
 *       tags, no NaN/undefined), theme-aware (light != dark), a11y title.
 *
 *   ADDITIVE + SAFE (read-only analysis over existing sim state)
 *     - the analytics calls do NOT mutate their inputs (the process block,
 *       the metrics, the wms result and the layout are byte-identical before
 *       and after every analyzer/sankey call) -> a warehouse layout's
 *       serialize stays byte-identical (no data-model change).
 *
 * Runs the REAL app modules under the same window shim the other harnesses
 * use. Everything is deterministic. Usage:  node verify_analytics.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of [
  "domain.js", "compliance.js", "knowledge.js", "automation.js", "wms.js",
  "wmsdata.js", "storage.js", "simulation.js", "generate.js", "process.js",
  "analytics.js",
]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const A = WT.analytics;
const G = WT.generate;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}
function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.max(1e-9, Math.abs(b)); }
function isSortedDesc(arr) { for (let i = 1; i < arr.length; i++) if (arr[i] > arr[i - 1] + 1e-9) return false; return true; }
// Pragmatic SVG well-formedness: every element open (<tag) is either self-
// closed (/>) or has a matching close (</). Names are esc()'d so no stray '<'.
function wellFormed(s) {
  const opens = (s.match(/<[a-zA-Z]/g) || []).length;
  const closes = (s.match(/<\//g) || []).length;
  const selfCloses = (s.match(/\/>/g) || []).length;
  return s.indexOf("<svg") === 0 && /<\/svg>\s*$/.test(s) &&
    !/NaN|undefined|Infinity/.test(s) && opens === closes + selfCloses;
}

const FACTORY_KEYS = ["assembly-line", "machining-shop", "general-factory"];
const WAREHOUSE_KEYS = ["ecommerce-fulfilment", "spare-parts-distribution", "automotive-supply", "cold-chain"];

console.log("Analytics suite (Bottleneck Analyzer + Sankey) verification (deterministic)");
console.log("");

/* ---- 1. Module surface -------------------------------------------------- */
check("WT.analytics exposes the analyzer + sankey API",
  A && ["bottleneckFromProcess", "bottleneckFromWarehouse", "bottleneckSvg",
    "sankeyFromProcess", "sankeyFromWarehouse", "sankeyLayout", "sankeySvg"].every((k) => typeof A[k] === "function"));
check("WT.analytics.VERSION is wt-analytics-1", A.VERSION === "wt-analytics-1", A.VERSION);
check("honesty string states modelled / deterministic / teaching-scale + can't-diverge + NOT-a-cert",
  /modelled, not measured/i.test(A.HONESTY) && /deterministic/i.test(A.HONESTY) &&
  /teaching-scale/i.test(A.HONESTY) && /cannot diverge|can't diverge/i.test(A.HONESTY) &&
  /not a validated discrete-event/i.test(A.HONESTY) && /not cad\/bim/i.test(A.HONESTY) &&
  /not a certification/i.test(A.HONESTY));

/* ---- 2. FACTORY: bottleneck ranks by utilisation, names the same one --- */
for (const k of FACTORY_KEYS) {
  const fac = G.generateFactoryLayout(k, { seed: 7 });
  const block = WT.process.derive(fac);
  const m = WT.process.metrics(block);
  const b = A.bottleneckFromProcess(m);

  check(k + " (factory): analyzer builds a ranked model with every station",
    !!b && b.mode === "factory" && b.resources.length === m.stations.length && !!b.constraint,
    b ? "n=" + b.resources.length : "null");

  check(k + " (factory): resources sorted DESC by utilisation, ranks 1..n",
    !!b && isSortedDesc(b.resources.map((r) => r.value)) && b.resources.every((r, i) => r.rank === i + 1));

  const rank1 = b.resources[0];
  check(k + " (factory): rank #1 === the sim's TOC bottleneck (can't diverge)",
    rank1.id === m.bottleneck.opId && rank1.isConstraint && b.constraint.id === rank1.id,
    "rank1=" + rank1.name + " sim=" + m.bottleneck.name);

  check(k + " (factory): bottleneck utilisation is 100% (=1 at the constraint)",
    approx(rank1.value, 1, 1e-6) && rank1.pct === 100, "pct=" + rank1.pct);

  check(k + " (factory): pct is proportional to value (round(value*100)) for every row",
    b.resources.every((r) => r.pct === Math.round(Math.min(4, Math.max(0, r.value)) * 100)));

  check(k + " (factory): plain-language 'why' + headline name the constraint + raise-it advice",
    b.headline.indexOf(b.constraint.name) === 0 && /parallel server|cut its cycle/i.test(b.why) &&
    /Theory of Constraints/i.test(b.why));

  // determinism of the model
  const b2 = A.bottleneckFromProcess(WT.process.metrics(WT.process.derive(fac)));
  check(k + " (factory): bottleneck model is deterministic (byte-identical)",
    JSON.stringify(b) === JSON.stringify(b2));
}

/* ---- 3. WAREHOUSE: bottleneck names the flow sim's bottleneck stage ----- */
for (const k of WAREHOUSE_KEYS) {
  const wh = G.generateLayout(k, { seed: 5 });
  const layout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, config: wh.config || {} };
  const wms = WT.wms.runOperations(layout, { orders: 300, hours: 8, seed: 0 });
  const b = A.bottleneckFromWarehouse(wms);

  check(k + " (warehouse): analyzer builds a ranked model over the 7 stages",
    !!b && b.mode === "warehouse" && b.resources.length === wms.stages.length && !!b.constraint,
    b ? "n=" + b.resources.length : "null");

  check(k + " (warehouse): resources sorted DESC by load, ranks 1..n",
    !!b && isSortedDesc(b.resources.map((r) => r.value)) && b.resources.every((r, i) => r.rank === i + 1));

  const rank1 = b.resources[0];
  const simStage = wms.stages[wms.bottleneckIndex];
  check(k + " (warehouse): rank #1 === the WMS flow sim's bottleneck stage (can't diverge)",
    rank1.id === simStage.id && rank1.isConstraint && b.constraint.id === rank1.id,
    "rank1=" + rank1.name + " sim=" + simStage.label);

  check(k + " (warehouse): the constraint is the lowest-capacity stage",
    wms.stages.every((s) => s.capacityUnitsPerHr >= simStage.capacityUnitsPerHr - 1e-9),
    "cap=" + simStage.capacityUnitsPerHr);

  check(k + " (warehouse): displayed value is load vs capacity (offered demand / capacity)",
    b.resources.every((r) => {
      const cap = wms.stages.find((s) => s.id === r.id).capacityUnitsPerHr;
      const expect = cap > 0 ? (wms.totalUnits / wms.hours) / cap : 0;
      return approx(r.value, expect, 1e-6);
    }));

  check(k + " (warehouse): plain-language 'why' + headline name the constraint + add-capacity advice",
    b.headline.indexOf(b.constraint.name) === 0 && /add\s+capacity/i.test(b.why) &&
    /lowest-throughput stage/i.test(b.headline));
}

/* ---- 4. SANKEY: proportional widths + deterministic well-formed SVG ----- */
function sankeyChecks(tag, model, unit) {
  check(tag + ": sankey model has nodes + links + a maxVolume",
    !!model && model.nodes.length >= 2 && model.links.length >= 1 && model.maxVolume > 0 && model.unit === unit,
    model ? "nodes=" + model.nodes.length + " links=" + model.links.length : "null");

  const geo = A.sankeyLayout(model);
  check(tag + ": link band thickness w is PROPORTIONAL to flow volume",
    geo.links.every((l) => {
      if (l.value <= 0) return l.w === 0 || l.w <= 2.001;
      // w = max(minThick, value/maxVol * maxThick); the ratio to the widest
      // link equals the volume ratio (both above the minThick floor here).
      const widest = geo.links.reduce((a, x) => (x.value > a.value ? x : a), geo.links[0]);
      return approx(l.w / widest.w, l.value / widest.value, 0.02) || l.w <= 2.001;
    }));

  check(tag + ": exactly one dominant (widest) link is flagged",
    geo.links.filter((l) => l.isDominant).length === 1 &&
    geo.links.find((l) => l.isDominant).value === model.maxVolume);

  const svg1 = A.sankeySvg(model, "light");
  const svg2 = A.sankeySvg(model, "light");
  check(tag + ": sankey SVG is DETERMINISTIC (byte-identical across runs)", svg1 === svg2, "len=" + svg1.length);
  check(tag + ": sankey SVG is well-formed (balanced tags, no NaN/undefined)", wellFormed(svg1));
  check(tag + ": sankey SVG is theme-aware (light != dark) + carries a11y <title>",
    A.sankeySvg(model, "light") !== A.sankeySvg(model, "dark") && /<title>/.test(svg1) && /role="img"/.test(svg1));
  // one <path> per non-zero link
  const paths = (svg1.match(/<path /g) || []).length;
  const nonZero = model.links.filter((l) => l.value > 0).length;
  check(tag + ": one ribbon <path> per non-zero-flow link", paths === nonZero, "paths=" + paths + " links=" + nonZero);
}

{
  const fac = G.generateFactoryLayout("assembly-line", { seed: 7 });
  const block = WT.process.derive(fac);
  sankeyChecks("factory sankey", A.sankeyFromProcess(block), "units/hr");

  const wh = G.generateLayout("ecommerce-fulfilment", { seed: 5 });
  const layout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, config: wh.config || {} };
  const wms = WT.wms.runOperations(layout, { orders: 300, hours: 8, seed: 0 });
  sankeyChecks("warehouse sankey", A.sankeyFromWarehouse(wms), "units");
}

/* ---- 5. Bottleneck bar-chart SVG: deterministic, 0-based, proportional -- */
{
  const fac = G.generateFactoryLayout("assembly-line", { seed: 7 });
  const b = A.bottleneckFromProcess(WT.process.metrics(WT.process.derive(fac)));
  const svg1 = A.bottleneckSvg(b, "dark");
  check("bottleneck bar SVG is deterministic + well-formed",
    svg1 === A.bottleneckSvg(b, "dark") && wellFormed(svg1), "len=" + svg1.length);
  // 0-based: a track rect + a value rect per row (2 rects/row) + n text pairs.
  const rects = (svg1.match(/<rect /g) || []).length;
  check("bottleneck bar SVG draws a 0-based track + value bar per resource",
    rects === b.resources.length * 2, "rects=" + rects + " rows=" + b.resources.length);
  check("bottleneck bar SVG is theme-aware (light != dark)",
    A.bottleneckSvg(b, "light") !== A.bottleneckSvg(b, "dark"));
}

/* ---- 6. READ-ONLY: analytics never mutates its inputs (byte-identical) -- */
{
  // FACTORY: the process block + the metrics stay byte-identical.
  const fac = G.generateFactoryLayout("machining-shop", { seed: 7 });
  const block = WT.process.derive(fac);
  const m = WT.process.metrics(block);
  const blockBefore = JSON.stringify(block);
  const mBefore = JSON.stringify(m);
  A.bottleneckFromProcess(m); A.sankeyFromProcess(block); A.sankeyLayout(A.sankeyFromProcess(block)); A.bottleneckSvg(A.bottleneckFromProcess(m), "light");
  check("read-only: analyzing a factory does NOT mutate the process block or metrics",
    JSON.stringify(block) === blockBefore && JSON.stringify(m) === mBefore);

  // WAREHOUSE: the layout + the wms result stay byte-identical -> a warehouse
  // layout's serialize is unchanged by analysis (no data-model change).
  const wh = G.generateLayout("cold-chain", { seed: 5 });
  const layout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, config: wh.config || {} };
  const layoutBefore = JSON.stringify(layout);
  const wms = WT.wms.runOperations(layout, { orders: 300, hours: 8, seed: 0 });
  const wmsBefore = JSON.stringify(wms);
  A.bottleneckFromWarehouse(wms); A.sankeyFromWarehouse(wms); A.sankeyLayout(A.sankeyFromWarehouse(wms)); A.bottleneckSvg(A.bottleneckFromWarehouse(wms), "dark");
  check("read-only: analyzing a warehouse does NOT mutate the layout or the wms result (serialize byte-identical)",
    JSON.stringify(layout) === layoutBefore && JSON.stringify(wms) === wmsBefore);

  // The process block a warehouse layout would carry is still null (analysis
  // adds no data-model surface) - the factory-only guarantee is untouched.
  check("read-only: a warehouse layout has NO process block (analysis adds none)",
    WT.process.derive(layout) === null);
}

/* ---- 7. Honesty labels on the returned models --------------------------- */
{
  const fac = G.generateFactoryLayout("assembly-line", { seed: 7 });
  const bF = A.bottleneckFromProcess(WT.process.metrics(WT.process.derive(fac)));
  const sF = A.sankeyFromProcess(WT.process.derive(fac));
  check("factory models carry the modelled/deterministic/teaching-scale honesty",
    /modelled, not measured/i.test(bF.honesty) && /teaching-scale/i.test(sF.honesty));

  const wh = G.generateLayout("ecommerce-fulfilment", { seed: 5 });
  const layout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, config: wh.config || {} };
  const wms = WT.wms.runOperations(layout, { orders: 300, hours: 8, seed: 0 });
  const bW = A.bottleneckFromWarehouse(wms);
  check("warehouse model restates the SYNTHETIC WMS data label (not measured, not a certification)",
    /SYNTHETIC/i.test(bW.honesty) && /NOT a certification/i.test(bW.honesty));
}

/* ==================================================================
 * v3.2 COST ANALYZER + ENERGY ANALYZER - two more READ-ONLY views over the
 * SAME sim state. Proves the load-bearing identities:
 *   cost   = SUM(equipment, labour, energy)   cost/unit = total / throughput
 *   energy = SUM(power x active-time)          energy/unit = total / throughput
 * plus predictable rate scaling, determinism, and read-only (byte-identical).
 * ================================================================== */

/* ---- 8. Module surface + fresh default rates ---------------------------- */
check("WT.analytics exposes the cost + energy API (v3.2)",
  ["defaultRates", "classifyEquipment", "energyModel", "costModel", "breakdownSvg"].every((k) => typeof A[k] === "function"));
{
  const r1 = A.defaultRates(), r2 = A.defaultRates();
  r1.energyPricePerKWh = 999; r1.equipment.asrs.powerKW = 999;
  check("defaultRates() returns a FRESH deep copy (editing one never touches another/the seed)",
    r2.energyPricePerKWh === 0.30 && r2.equipment.asrs.powerKW === 15 &&
    A.defaultRates().energyPricePerKWh === 0.30);
  check("default illustrative rates are the documented constants (EUR/kWh, EUR/h, CO2, amort basis)",
    r2.energyPricePerKWh === 0.30 && r2.co2PerKWh === 0.30 && r2.labourPerHour === 35 && r2.hoursPerYear === 4000);
}

// Shared cost+energy identity + scaling checks for one input (mode/sim/elements).
function costEnergyChecks(tag, input) {
  const rates = A.defaultRates();
  const em = A.energyModel(input, rates);
  const cm = A.costModel(input, rates);
  check(tag + ": energy + cost models build with a positive throughput",
    !!em && !!cm && em.throughput > 0 && cm.throughput > 0 && em.throughput === cm.throughput,
    em ? "tp=" + em.throughput : "null");

  // ENERGY = SUM(power x active-time): each row's kWh == power x count x activeHours,
  // and the total is exactly their sum.
  check(tag + ": every energy row = power x count x active-hours (SUM(power x time))",
    em.resources.every((rr) => approx(rr.energyKWh, rr.powerKW * rr.count * rr.activeHours, 1e-9)));
  let sumK = 0; for (const rr of em.resources) sumK += rr.energyKWh;
  check(tag + ": total energy == SUM of the per-resource kWh", approx(em.totalKWh, sumK, 1e-9), "total=" + em.totalKWh);
  check(tag + ": energy per unit == total / throughput (identity)",
    approx(em.perUnit, em.totalKWh / em.throughput, 1e-9));
  check(tag + ": CO2 == total energy x the editable grid factor", approx(em.co2Kg, em.totalKWh * em.co2Factor, 1e-9));
  check(tag + ": byClass sums the resources (count + kWh conserved)", (() => {
    let c = 0, k = 0; for (const g of em.byClass) { c += g.count; k += g.energyKWh; }
    let rc = 0; for (const rr of em.resources) rc += rr.count;
    return approx(k, em.totalKWh, 1e-9) && c === rc;
  })());

  // COST = SUM(categories); cost per unit == total / throughput.
  let catSum = 0; for (const c of cm.categories) catSum += c.amount;
  check(tag + ": total cost == SUM(equipment + labour + energy)", approx(cm.totalCost, catSum, 1e-9), "total=" + cm.totalCost);
  check(tag + ": cost has exactly the three categories (equipment/labour/energy)",
    cm.categories.map((c) => c.key).join(",") === "equipment,labour,energy");
  check(tag + ": cost per unit == total / throughput (identity)",
    approx(cm.perUnit, cm.totalCost / cm.throughput, 1e-9));
  const enCat = cm.categories.find((c) => c.key === "energy").amount;
  check(tag + ": cost's energy category == energy kWh x price (can't diverge from the Energy analyzer)",
    approx(enCat, em.totalKWh * rates.energyPricePerKWh, 1e-9));

  // PREDICTABLE RATE SCALING.
  const rp = A.defaultRates(); rp.energyPricePerKWh *= 2;
  check(tag + ": doubling EUR/kWh doubles the energy cost category (predictable)",
    approx(A.costModel(input, rp).categories.find((c) => c.key === "energy").amount, 2 * enCat, 1e-6));
  const rc = A.defaultRates(); rc.co2PerKWh *= 3;
  check(tag + ": tripling the grid CO2 factor triples the CO2 line (predictable)",
    approx(A.energyModel(input, rc).co2Kg, 3 * em.co2Kg, 1e-6));
  // Double the power rating of the LARGEST-energy class -> that class doubles.
  const big = em.byClass.slice().sort((a, b) => b.energyKWh - a.energyKWh)[0];
  if (big && big.energyKWh > 0) {
    const rpow = A.defaultRates(); rpow.equipment[big.key].powerKW *= 2;
    const em2 = A.energyModel(input, rpow);
    const big2 = em2.byClass.find((g) => g.key === big.key);
    check(tag + ": doubling a class's power rating doubles that class's energy (predictable)",
      approx(big2.energyKWh, 2 * big.energyKWh, 1e-6));
  }
  // Double the capex of a present class -> equipment cost rises by its share.
  const eqCat = cm.categories.find((c) => c.key === "equipment").amount;
  if (em.byClass.length) {
    const k0 = em.byClass[0].key;
    const rcap = A.defaultRates(); rcap.equipment[k0].capex *= 2;
    check(tag + ": doubling a class capex raises the equipment cost (monotonic, predictable)",
      A.costModel(input, rcap).categories.find((c) => c.key === "equipment").amount > eqCat - 1e-9);
  }

  // DETERMINISM (no Date/RNG): byte-identical models on re-run.
  check(tag + ": cost + energy models are DETERMINISTIC (byte-identical JSON on re-run)",
    JSON.stringify(A.costModel(input, A.defaultRates())) === JSON.stringify(cm) &&
    JSON.stringify(A.energyModel(input, A.defaultRates())) === JSON.stringify(em));

  // HONESTY labels.
  check(tag + ": cost honesty says illustrative + not-a-quote; energy says modelled + not-metered",
    /not a quote/i.test(cm.honesty) && /illustrative/i.test(cm.honesty) &&
    /not metered/i.test(em.honesty) && /modelled/i.test(em.honesty));

  // Deterministic, well-formed, theme-aware breakdown SVG for both.
  const catRows = cm.categories.map((c) => ({ label: c.label, value: c.amount, text: String(c.amount) }));
  const svg1 = A.breakdownSvg(catRows, "light");
  check(tag + ": cost breakdown SVG deterministic + well-formed + theme-aware",
    svg1 === A.breakdownSvg(catRows, "light") && wellFormed(svg1) && svg1 !== A.breakdownSvg(catRows, "dark"));
}

/* ---- 9. FACTORY cost + energy ------------------------------------------- */
{
  const fac = G.generateFactoryLayout("assembly-line", { seed: 7 });
  const m = WT.process.metrics(WT.process.derive(fac));
  costEnergyChecks("factory", { mode: "factory", sim: m, elements: fac.elements });
  // factory per-unit is per PART; the operating window is the shift.
  const em = A.energyModel({ mode: "factory", sim: m, elements: fac.elements }, A.defaultRates());
  check("factory: energy/cost per-unit denominator is parts (throughput x shift hours)",
    em.throughputUnit === "part" && approx(em.throughput, m.throughputPerHr * (m.shiftSec / 3600), 1e-9));
}

/* ---- 10. WAREHOUSE cost + energy + read-only (serialize byte-identical) -- */
{
  const wh = G.generateLayout("ecommerce-fulfilment", { seed: 5 });
  const layout = { elements: wh.elements, gridW: wh.gridW, gridH: wh.gridH, config: wh.config || {} };
  const wms = WT.wms.runOperations(layout, { orders: 300, hours: 8, seed: 0 });
  const input = { mode: "warehouse", sim: wms, elements: layout.elements };
  costEnergyChecks("warehouse", input);

  // classifyEquipment counts match a hand count of the mapped element types.
  const counts = A.classifyEquipment(layout.elements);
  const dockCount = layout.elements.filter((e) => e.type === "dock-in" || e.type === "dock-out").length;
  check("warehouse: classifyEquipment counts the dock class == hand count of dock-in/out elements",
    (counts.dock || 0) === dockCount, "dock=" + (counts.dock || 0) + " hand=" + dockCount);
  check("warehouse: per-unit denominator is shipped units (per pallet-equivalent unit)",
    A.energyModel(input, A.defaultRates()).throughputUnit === "unit");

  // READ-ONLY: analysing does NOT mutate the layout or the wms result -> a
  // warehouse layout's serialize is byte-identical (no data-model change).
  const layoutBefore = JSON.stringify(layout);
  const wmsBefore = JSON.stringify(wms);
  A.costModel(input, A.defaultRates()); A.energyModel(input, A.defaultRates()); A.classifyEquipment(layout.elements);
  check("read-only: cost + energy analysis does NOT mutate the layout or wms (serialize byte-identical)",
    JSON.stringify(layout) === layoutBefore && JSON.stringify(wms) === wmsBefore);
}

/* ---- 11. Shipped wiring (source guards) --------------------------------- */
{
  const idx = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  check("index.html loads analytics.js before app.js + ships the Analyze card + button",
    idx.indexOf('src="analytics.js"') !== -1 &&
    idx.indexOf('src="analytics.js"') < idx.indexOf('src="app.js"') &&
    /id="analyzeCard"/.test(idx) && /id="analyzeBtn"/.test(idx) &&
    /id="analyzeBottleneck"/.test(idx) && /id="analyzeSankey"/.test(idx));
  check("index.html ships the Cost + Energy drill-ins in the Analyze card (v3.2)",
    /id="analyzeCost"/.test(idx) && /id="analyzeEnergy"/.test(idx) &&
    /id="analyzeCostDetails"/.test(idx) && /id="analyzeEnergyDetails"/.test(idx));
  check("sw.js precaches ./analytics.js at the bumped wt-v56 cache",
    /["']\.\/analytics\.js["']/.test(sw) && /CACHE_VERSION\s*=\s*"wt-v56"/.test(sw));
  check("app.js wires the Analyze button + exposes the self-test hooks (bottleneck + cost + energy)",
    /analyzeBtn"\)\.addEventListener\("click", renderAnalyzePanel\)/.test(app) &&
    /renderAnalyzePanel:\s*renderAnalyzePanel/.test(app) &&
    /renderCostPanel:\s*renderCostPanel/.test(app) && /renderEnergyPanel:\s*renderEnergyPanel/.test(app));
}

console.log("");
console.log(failures === 0
  ? "ALL ANALYTICS CHECKS PASSED"
  : failures + " ANALYTICS CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
