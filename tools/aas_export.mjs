/* tools/aas_export.mjs - asset shells, AAS-shaped (v3.65).
 *
 *   node tools/aas_export.mjs --layout <layout.json> [--ledger <run-ledger.json>] --out <aas.json> [--site <name>]
 *   node tools/aas_export.mjs --ledger <run-ledger.json> --out <aas.json>        (no layout: the run's own locations)
 *
 * Writes a `wt-aas-shaped/v1` environment: one asset administration shell per floor element with a
 * Nameplate and a TechnicalData submodel, plus an OperationalData submodel for every element a
 * recorded run actually touched. The shape is the AAS metamodel's JSON (IEC 63278-1); the semantic
 * ids are urn:wt: placeholders and the asset ids are the layout's own element ids - shaped, NOT
 * conformant, and nothing is registered (aas.js says so in the document's own honesty block).
 *
 * A layout is the app's own export (`wt-1`: gridW, gridH, cell, elements). Without one the tool falls
 * back to the run-ledger export's `locations`, which carry the type but no geometry: the technical
 * submodel then reports the catalogue's own footprint for the type and says so in the scope.
 * Deterministic: the same inputs write the same bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { MODULES_HAND, loadWT, root } from "./ledger_env.mjs";

const USAGE = "usage: node tools/aas_export.mjs [--layout <layout.json>] [--ledger <run-ledger.json>] --out <aas.json> [--site <name>]";
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const layoutPath = opt("--layout", null), ledgerPath = opt("--ledger", null), outPath = opt("--out", null), site = opt("--site", null);
if ((!layoutPath && !ledgerPath) || !outPath) { console.error(USAGE); process.exit(2); }

loadWT(MODULES_HAND);
loadWT(["aas.js"]);
const { aas: A, analytics: AN } = globalThis.WT;
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));

let ledger = null;
if (ledgerPath) {
  ledger = readJson(ledgerPath);
  if (!ledger || ledger.schema !== "factory-run-ledger/v1") { console.error("not a factory-run-ledger/v1 export: " + ledgerPath); process.exit(2); }
}
let layout = null, fromLocations = false;
if (layoutPath) {
  layout = readJson(layoutPath);
  if (!layout || !Array.isArray(layout.elements)) { console.error("not a wt-1 layout (no elements array): " + layoutPath); process.exit(2); }
} else {
  // no layout: the run's own locations, which have the type but no geometry (the catalogue's footprint is used)
  const defs = globalThis.WT.domain.ELEMENTS || {};
  const zones = (ledger.locations || []).filter((l) => String(l.id).indexOf("zone:") !== 0 && defs[l.type]);
  layout = { cell: globalThis.WT.domain.METRES_PER_CELL || 1, elements: zones.map((l) => ({ id: l.id, type: l.type })) };
  fromLocations = true;
  if (!layout.elements.length) { console.error("the export names no element this catalogue knows: " + ledgerPath); process.exit(2); }
}
const env = A.fromLayout(layout, { rates: AN.defaultRates(), ledger: ledger, site: site || (ledger && ledger.run ? ledger.run.scenario : "wt-floor") });
if (fromLocations) env.scope["wt:from"] = "a run-ledger export's locations: the type is known, the geometry is the catalogue's own footprint for that type, not the floor's";
const v = A.validate(env);
if (!v.ok) { console.error("the environment does not validate: " + v.errors.join("; ")); process.exit(1); }
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(env, null, 1) + "\n");
console.log("AAS-shaped: " + env.scope.elements + " asset shells, " + env.scope.submodels + " submodels" +
  (env.scope.run ? " (operational data from " + env.scope.run + ")" : " (no run: nameplate and technical data only)") +
  (fromLocations ? ", built from the export's locations" : "") + " -> " + outPath);
