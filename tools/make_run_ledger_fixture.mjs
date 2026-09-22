/* Regenerate the recorded run-ledger fixtures (deterministic: the same commit
 * reproduces the same bytes).
 *   node tools/make_run_ledger_fixture.mjs [a|b|c|all]      (default: all)
 *   a  test/fixtures/run-ledger.json     the hand-built floor of verify_ledger.js, seed 31, 300 ticks,
 *                                        the full default order mix
 *   b  test/fixtures/run-ledger-b.json   the same floor and seed, a cross-dock-heavy day (v3.37 compare)
 *   c  test/fixtures/run-ledger-c.json   the library floor ecommerce-multichannel-fc built with wms.js
 *                                        loaded, so its eight stations serve at the floor's DECLARED
 *                                        capacities instead of the simulator's floor rate (v3.43);
 *                                        seed 6, 180 ticks (300 would weigh 1.25 MB in the precache)
 *   node tools/make_run_ledger_fixture.mjs reconcile <dir> [a|b|c ...]
 *      reads the COMMITTED exports and writes <dir>/<base>.reconcile.json - the JavaScript rows
 *      of every planner, detail and cost view - for `python tools/run_ledger.py reconcile`, which
 *      measures how far SQLite's rows are from these (nothing is committed; CI generates them).
 * Each variant also writes <base>.stats.json (WT.ledger.stats) and <base>.views.json (the
 * JavaScript cost tables and flow links the Python test equates with the SQL views).
 * a and b are built BEFORE wms.js is loaded: flowsim.throughputOf picks WT.wms up whenever it is
 * present, and the hand floor must keep recording at the floor rate byte for byte. The run id
 * differs between the variants because the hash covers the layout, the seed and the order mix.
 */
import fs from "node:fs";
import path from "node:path";
import { FLOOR, MIX_B, MODULES_HAND, MODULES_SCENARIO, loadWT, root, scenarioLayout } from "./ledger_env.mjs";

export { FLOOR, MIX_B };
loadWT(MODULES_HAND);
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;

const VARIANTS = {
  a: { base: "run-ledger", mix: R.defaultMix(), seed: 31, ticks: 300, note: "the full default mix" },
  b: { base: "run-ledger-b", mix: MIX_B, seed: 31, ticks: 300, note: "a cross-dock-heavy day" },
  c: { base: "run-ledger-c", scenario: "ecommerce-multichannel-fc", seed: 6, ticks: 180, note: "a library floor with declared capacities" },
};
const OUT = path.join(root, "test", "fixtures");

function record(v) {
  let layout, mix, scenarioId, profile;
  if (v.scenario) {
    if (!globalThis.WT.wms) loadWT(MODULES_SCENARIO);
    layout = scenarioLayout(v.scenario);
    mix = layout.config.orderMix;
    scenarioId = v.scenario;
    profile = P.profileFor(v.scenario);
  } else {
    if (globalThis.WT.wms) throw new Error("build a and b before c: with wms.js loaded the hand floor no longer serves at the floor rate");
    layout = FLOOR; mix = v.mix; scenarioId = "hand-built"; profile = P.PROFILES.ecommerce;
  }
  const plan = F.spawnPlan(layout, { seed: v.seed, mix: mix });
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: scenarioId, seed: v.seed, mix: mix, layout: layout, profile: profile, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, v.ticks);
  return rec;
}

function build(v) {
  const rec = record(v);
  fs.mkdirSync(OUT, { recursive: true });
  const exp = L.exportJson(rec);
  const cost = L.costs(exp);
  fs.writeFileSync(path.join(OUT, v.base + ".json"), JSON.stringify(exp, null, 1) + "\n");
  fs.writeFileSync(path.join(OUT, v.base + ".stats.json"), JSON.stringify(L.stats(rec), null, 1) + "\n");
  fs.writeFileSync(path.join(OUT, v.base + ".views.json"), JSON.stringify({ costByType: cost.byType, costByLocation: cost.byLocation, costTotal: cost.total, flowLinks: L.flowLinks(exp) }, null, 1) + "\n");
  const stations = exp.locations.filter((l) => l.service_ticks != null);
  console.log(v.base + ":", rec.order.length, "units,", rec.events.length, "events, run", rec.run.id, "(" + v.note + ") - cost", cost.total.total_eur, "EUR, transport", exp.rates.transport.class + ", stations", stations.length, "at", stations.map((l) => +l.service_ticks.toFixed(4)).join("/"), "ticks per unit");
}

// The JavaScript rows of every view the Python tool can also compute, keyed by view name.
export function reconcileRows(exp) {
  const RL = globalThis.RunLedger;
  const v = RL.views(exp);
  const c = L.costs(exp);
  return {
    run: exp.run.id,
    views: {
      v_run_summary: [v.summary], v_cycle_time_by_type: v.cycle, v_touches_by_type: v.touches, v_station_wait: v.wait,
      v_wip_by_tick: v.wip, v_quantities_by_op: v.byOp, v_dispatch: v.dispatch ? [v.dispatch] : [], v_flow_links: v.flowLinks || [],
      v_spans: c ? c.spans : L.spans(exp), v_span_cost: c ? c.spans : [], v_cost_by_hu: c ? c.byHu : [], v_cost_by_type: c ? c.byType : [], v_cost_by_location: c ? c.byLocation : [],
    },
  };
}

const args = process.argv.slice(2);
if (args[0] === "reconcile") {
  const dir = args[1];
  if (!dir) { console.error("usage: reconcile <dir> [a|b|c ...]"); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  for (const k of args.length > 2 ? args.slice(2) : Object.keys(VARIANTS)) {
    if (!VARIANTS[k]) { console.error("unknown variant " + k + " (a | b | c)"); process.exit(2); }
    const base = VARIANTS[k].base;
    const exp = JSON.parse(fs.readFileSync(path.join(OUT, base + ".json"), "utf8"));
    const target = path.join(dir, base + ".reconcile.json");
    fs.writeFileSync(target, JSON.stringify(reconcileRows(exp), null, 1) + "\n");
    console.log(base + ": reconcile rows written to " + target);
  }
} else {
  const which = args[0] || "all";
  for (const k of which === "all" ? Object.keys(VARIANTS) : [which]) {
    if (!VARIANTS[k]) { console.error("unknown variant " + k + " (a | b | c | all)"); process.exit(2); }
    build(VARIANTS[k]);
  }
}
