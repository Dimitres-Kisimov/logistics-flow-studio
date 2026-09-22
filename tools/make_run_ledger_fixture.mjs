/* Regenerate test/fixtures/run-ledger.json (+ .stats.json, .views.json) from the
 * hand-built floor of verify_ledger.js with the FULL order mix, 300 ticks, seed 31,
 * recorded under the default analytics rates (v3.35).
 * Deterministic: the same commit reproduces the same bytes.
 *   node tools/make_run_ledger_fixture.mjs
 * run-ledger.views.json holds the JavaScript cost tables the Python test equates
 * with the SQL views (v_cost_by_type, v_cost_by_location).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
globalThis.window = globalThis;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(root, f), "utf8"));
}
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;

const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
    { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 },
    { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 },
    { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 },
    { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 },
    { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 },
    { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
const mix = R.defaultMix();
const plan = F.spawnPlan(FLOOR, { seed: 31, mix });
const st = F.state(plan);
const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
st.hooks = { afterTick: (s) => L.observe(rec, s) };
F.step(st, 300);
const out = path.join(root, "test", "fixtures");
fs.mkdirSync(out, { recursive: true });
const exp = L.exportJson(rec);
const cost = L.costs(exp);
fs.writeFileSync(path.join(out, "run-ledger.json"), JSON.stringify(exp, null, 1) + "\n");
fs.writeFileSync(path.join(out, "run-ledger.stats.json"), JSON.stringify(L.stats(rec), null, 1) + "\n");
fs.writeFileSync(path.join(out, "run-ledger.views.json"), JSON.stringify({ costByType: cost.byType, costByLocation: cost.byLocation, costTotal: cost.total }, null, 1) + "\n");
console.log("fixture:", rec.order.length, "units,", rec.events.length, "events, run", rec.run.id, "- cost", cost.total.total_eur, "EUR, transport", exp.rates.transport.class);
