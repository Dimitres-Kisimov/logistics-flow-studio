/* tools/search_levers.mjs - search over levers (v3.62): combinations of staffing, error and delivery levers on a
 * scenario across seeds, ranked by OTIF and cost with the replication confidence intervals.
 *
 *   node tools/search_levers.mjs <scenario-id|hand> --seeds 1-3 --ticks 600 --out <dir>
 *        [--staffing declared,adaptive] [--inbound-period 120,60] [--outbound-period 240,120] [--errors declared|none]
 *
 * THE RULE (stated once; verify_search.js pins it by hand on the hand floor for two levers and two seeds):
 *   - the grid is the cartesian product of the lever values given (defaults: staffing declared,adaptive x
 *     outbound period 240,120; inbound period 120; errors declared); every combination runs once per seed with
 *     dock and carrier windows on (the app's delivery defaults: door open 30 ticks, the SCMS Truck lateness shape
 *     at 60 ticks per day, transit 120 + the same shape, promised lead 480) - the same inputs the app's pickers
 *     and knowledge base would set, written into each combination as `kb` levers the control tower can apply;
 *   - per combination: OTIF (v_otif's share over the delivered orders; a seed without a delivered order counts
 *     as missing), the run's cost at the default rates (v_cost_by_type's total) and the delivered orders, each as
 *     mean, sample standard deviation and the Student-t 95 % half-width over the seeds (the same arithmetic as the
 *     viewer's replications: T975 from run-ledger.js);
 *   - ranked by OTIF mean descending, then cost mean ascending, then the combination id; the best is the first;
 *   - deterministic: the same arguments write the same bytes (search.json, search.md, run-<combo>-<seed>.json).
 *
 * Honesty: a search over a synthetic teaching simulation with teaching rates and teaching error shares (or the
 * plant's own rates once a site profile is loaded into the knowledge base - this tool reads the app's defaults,
 * not a browser's knowledge base). A ranking with overlapping half-widths is not a ranking; the tower's rule
 * (lever-search) proposes the best only when its gain exceeds the half-widths. Nothing here is per person.
 */
import fs from "node:fs";
import path from "node:path";
import { FLOOR, MODULES_HAND, MODULES_SCENARIO, loadWT, root, scenarioLayout } from "./ledger_env.mjs";

const USAGE = "usage: node tools/search_levers.mjs <scenario-id|hand> --seeds 1-3 --ticks 600 --out <dir> [--staffing declared,adaptive] [--inbound-period 120,60] [--outbound-period 240,120] [--errors declared|none]";
const args = process.argv.slice(2);
const target = args[0] && !args[0].startsWith("--") ? args[0] : null;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const seedsArg = opt("--seeds", "1-3");
const seeds = /^\d+-\d+$/.test(seedsArg) ? (() => { const [a, b] = seedsArg.split("-").map(Number); const out = []; for (let s = a; s <= b; s++) out.push(s); return out; })() : seedsArg.split(",").map(Number).filter((n) => n > 0);
const ticks = Math.max(1, Math.round(Number(opt("--ticks", 600))));
const outDir = opt("--out", null);
const list = (k, d) => String(opt(k, d)).split(",").map((s) => s.trim()).filter(Boolean);
const staffing = list("--staffing", "declared,adaptive");
const inboundPeriods = list("--inbound-period", "120").map(Number);
const outboundPeriods = list("--outbound-period", "240,120").map(Number);
const errorsMode = opt("--errors", "declared");
if (!target || !outDir || !seeds.length || staffing.some((s) => s !== "declared" && s !== "adaptive") || inboundPeriods.some((n) => !(n > 0)) || outboundPeriods.some((n) => !(n > 0)) || (errorsMode !== "declared" && errorsMode !== "none")) {
  console.error(USAGE); process.exit(2);
}

loadWT(MODULES_HAND);
loadWT(["data/scms-delivery.js"]);
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;
const RL = globalThis.RunLedger;
let layout, mix, scenarioId, profile;
if (target === "hand") {
  layout = FLOOR; mix = R.defaultMix(); scenarioId = "hand-built"; profile = P.PROFILES.ecommerce;
} else {
  loadWT(MODULES_SCENARIO);
  layout = scenarioLayout(target); mix = layout.config.orderMix; scenarioId = target; profile = P.profileFor(target);
}
// The app's delivery defaults (readDeliveryLevers) with the period as the lever
const DS = globalThis.WT.datasets && globalThis.WT.datasets.scmsDelivery;
const q = DS ? DS.by_mode.Truck.lateness_days : { min: 0, p10: 0, median: 0, p90: 0, max: 0 };
const late = F.windowLateness(q, 60, 16);
const source = DS ? "USAID SCMS delivery history (aggregates, data/scms-delivery.json), mode Truck, scaled 60 ticks per day" : "no dataset loaded: every trailer on time";
const inboundOf = (period) => ({ periodTicks: period, openTicks: 30, lateness: late, mode: "Truck", scaleTicksPerDay: 60, source: source });
const outboundOf = (period) => ({ periodTicks: period, promisedLeadTicks: 480, transit: late.map((v) => Math.max(0, 120 + v)), mode: "Truck", scaleTicksPerDay: 60, source: source + "; nominal transit 120 ticks plus the same lateness shape" });

// the replication arithmetic (run-ledger.js repStats): mean, sample sd, t half-width
const r4 = (v) => Math.round(v * 10000) / 10000;
const nsum = (xs) => { let s = 0, c = 0; for (const x of xs) { const y = x - c, t = s + y; c = t - s - y; s = t; } return s; };
function stats(values) {
  const v = values.filter((x) => typeof x === "number" && isFinite(x));
  if (!v.length) return { n: 0, mean: null, stdev: null, ci95_half: null, min: null, max: null };
  const n = v.length, mean = nsum(v) / n;
  const s = n > 1 ? Math.sqrt(nsum(v.map((x) => (x - mean) * (x - mean))) / (n - 1)) : null;
  const t = RL.T975[n - 1] || 1.96;
  return { n: n, mean: r4(mean), stdev: s == null ? null : r4(s), ci95_half: s == null ? null : r4(t * s / Math.sqrt(n)), min: r4(Math.min.apply(null, v)), max: r4(Math.max.apply(null, v)) };
}

fs.mkdirSync(outDir, { recursive: true });
const combos = [];
for (const st of staffing) for (const ip of inboundPeriods) for (const op of outboundPeriods) {
  const id = "staffing=" + st + "|inbound=" + ip + "|outbound=" + op + "|errors=" + errorsMode;
  const kb = [{ kind: "picker", key: "staffing", value: st }, { kind: "kb", key: "delivery.inbound.periodTicks", value: ip }, { kind: "kb", key: "delivery.outbound.periodTicks", value: op }];
  const otif = [], cost = [], delivered = [], runs = [];
  for (const seed of seeds) {
    const o = { seed: seed, mix: mix, inbound: inboundOf(ip), outbound: outboundOf(op) };
    if (st === "adaptive") o.policy = { kind: "queue-staffing" };
    if (errorsMode === "declared") o.errors = true;
    const plan = F.spawnPlan(layout, o);
    const state = F.state(plan);
    const rec = L.create(plan, { scenarioId: scenarioId, seed: seed, mix: mix, layout: layout, profile: profile, rates: A.defaultRates() });
    state.hooks = { afterTick: (s) => L.observe(rec, s) };
    let left = ticks;
    while (left > 0) { const d = Math.min(600, left); F.step(state, d); left -= d; }
    const exp = L.exportJson(rec);
    const s = L.serviceOf(exp), c = L.costs(exp);
    otif.push(s ? s.otif : null); cost.push(c ? c.total.total_eur : null); delivered.push(s ? s.delivered_orders : 0); runs.push(exp.run.id);
    fs.writeFileSync(path.join(outDir, "run-" + combos.length + "-" + seed + ".json"), JSON.stringify(exp, null, 1) + "\n");
  }
  combos.push({ id: id, index: combos.length, levers: { staffing: st, inbound_period: ip, outbound_period: op, errors: errorsMode }, kb: kb, n: seeds.length,
    otif: stats(otif), cost_eur: stats(cost), delivered_orders: stats(delivered), otif_by_seed: otif, cost_by_seed: cost, runs: runs });
}
const rank = (a, b) => ((b.otif.mean == null ? -1 : b.otif.mean) - (a.otif.mean == null ? -1 : a.otif.mean)) || ((a.cost_eur.mean == null ? Infinity : a.cost_eur.mean) - (b.cost_eur.mean == null ? Infinity : b.cost_eur.mean)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ranked = combos.slice().sort(rank).map((c) => c.id);
const search = {
  kind: "wt-lever-search", scenario: scenarioId, ticks: ticks, seeds: seeds, grid: { staffing: staffing, inbound_period: inboundPeriods, outbound_period: outboundPeriods, errors: errorsMode },
  rule: "ranked by OTIF mean descending, then cost mean ascending, then id; mean, sample standard deviation and Student-t 95 % half-width over the seeds (run-ledger.js T975); a seed without a delivered order is missing for OTIF",
  combos: combos, ranked: ranked, best: ranked[0],
  honesty: "A search over a synthetic teaching simulation with teaching rates and shares: the same floor, mix and ticks, the levers varied, one run per seed. Overlapping half-widths mean no ranking; the control tower's lever-search rule proposes the best only when its OTIF gain exceeds the half-widths. Nothing is per person.",
};
fs.writeFileSync(path.join(outDir, "search.json"), JSON.stringify(search, null, 1) + "\n");
const pm = (s) => (s.mean == null ? "-" : s.mean + (s.ci95_half == null ? "" : " ± " + s.ci95_half));
const md = ["# Lever search: " + scenarioId + " over seeds " + seeds.join(", ") + ", " + ticks + " ticks", "", "| rank | combination | n | OTIF | cost (EUR) | delivered orders |", "|---|---|---|---|---|---|"]
  .concat(ranked.map((id, i) => { const c = combos.find((x) => x.id === id); return "| " + (i + 1) + " | " + id + " | " + c.n + " | " + pm(c.otif) + " | " + pm(c.cost_eur) + " | " + pm(c.delivered_orders) + " |"; }))
  .concat(["", search.rule + ".", "", search.honesty, ""]);
fs.writeFileSync(path.join(outDir, "search.md"), md.join("\n"));
console.log("search: " + combos.length + " combinations x " + seeds.length + " seeds of " + scenarioId + " over " + ticks + " ticks -> best " + ranked[0] + " (OTIF " + pm(combos.find((c) => c.id === ranked[0]).otif) + ") -> " + path.join(outDir, "search.json"));
