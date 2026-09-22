/* Regenerate the recorded run-ledger fixtures from the hand-built floor of
 * verify_ledger.js: 300 ticks, seed 31, the default analytics rates (v3.35).
 *   node tools/make_run_ledger_fixture.mjs [a|b|all]      (default: all)
 *   a  test/fixtures/run-ledger.json     the full default order mix
 *   b  test/fixtures/run-ledger-b.json   a cross-dock-heavy day on the SAME floor (v3.37 compare)
 * Each variant also writes <base>.stats.json (WT.ledger.stats) and <base>.views.json
 * (the JavaScript cost tables and flow links the Python test equates with the SQL
 * views v_cost_by_type, v_cost_by_location, v_flow_links).
 * Deterministic: the same commit reproduces the same bytes. The run id differs
 * between the variants because the hash covers the order mix.
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

export const FLOOR = {
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
// variant b: the same floor and seed, a cross-dock-heavy day (shares sum to 1)
export const MIX_B = [{ id: "cross-dock", share: 0.5 }, { id: "full-pallet-out", share: 0.2 }, { id: "case-pick", share: 0.15 }, { id: "piece-pick", share: 0.1 }, { id: "returns", share: 0.05 }];
const VARIANTS = {
  a: { base: "run-ledger", mix: R.defaultMix(), note: "the full default mix" },
  b: { base: "run-ledger-b", mix: MIX_B, note: "a cross-dock-heavy day" },
};

function build(v) {
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: v.mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: v.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  const out = path.join(root, "test", "fixtures");
  fs.mkdirSync(out, { recursive: true });
  const exp = L.exportJson(rec);
  const cost = L.costs(exp);
  fs.writeFileSync(path.join(out, v.base + ".json"), JSON.stringify(exp, null, 1) + "\n");
  fs.writeFileSync(path.join(out, v.base + ".stats.json"), JSON.stringify(L.stats(rec), null, 1) + "\n");
  fs.writeFileSync(path.join(out, v.base + ".views.json"), JSON.stringify({ costByType: cost.byType, costByLocation: cost.byLocation, costTotal: cost.total, flowLinks: L.flowLinks(exp) }, null, 1) + "\n");
  console.log(v.base + ":", rec.order.length, "units,", rec.events.length, "events, run", rec.run.id, "(" + v.note + ") - cost", cost.total.total_eur, "EUR, transport", exp.rates.transport.class);
}

const which = process.argv[2] || "all";
for (const k of which === "all" ? Object.keys(VARIANTS) : [which]) {
  if (!VARIANTS[k]) { console.error("unknown variant " + k + " (a | b | all)"); process.exit(2); }
  build(VARIANTS[k]);
}
