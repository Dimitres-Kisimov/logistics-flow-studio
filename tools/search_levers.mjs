/* tools/search_levers.mjs - search over levers (v3.62): combinations of staffing, error and delivery levers on a
 * scenario across seeds, ranked by OTIF and cost with the replication confidence intervals.
 *
 *   node tools/search_levers.mjs <scenario-id|hand> --seeds 1-3 --ticks 600 --out <dir>
 *        [--staffing declared,adaptive] [--inbound-period 120,60] [--outbound-period 240,120] [--errors declared|none]
 *        [--profile <site-profile.json>] [--min-delivered 5]
 *
 * THE RULE (stated once; verify_search.js pins it by hand on the hand floor for two levers and two seeds):
 *   - THE RATES (v3.63): without --profile the runs use the app's teaching values - the HEART-anchored error shares
 *     and the SCMS Truck lateness shape at 60 ticks per day. With a site profile (tools/fit_rates.py,
 *     wt-site-profile/v1) the search runs at the PLANT'S OWN rates instead: the fitted error shares (a kind the
 *     profile did not fit keeps its teaching default) and, when delivery.site.n > 0, the site's own lateness
 *     quantiles in ticks (= minutes, scale 1) instead of the dataset shape. search.json records the rates it
 *     searched under, and the control tower's fifth rule refuses a table measured under other rates: a ranking
 *     measured in a different world does not transfer;
 *   - the grid is the cartesian product of the lever values given (defaults: staffing declared,adaptive x
 *     outbound period 240,120; inbound period 120; errors declared); every combination runs once per seed with
 *     dock and carrier windows on (the app's delivery defaults: door open 30 ticks, the SCMS Truck lateness shape
 *     at 60 ticks per day, transit 120 + the same shape, promised lead 480) - the same inputs the app's pickers
 *     and knowledge base would set, written into each combination as `kb` levers the control tower can apply;
 *   - per combination: OTIF (v_otif's share over the delivered orders; a seed without a delivered order counts
 *     as missing), the run's cost at the default rates (v_cost_by_type's total) and the delivered orders, each as
 *     mean, sample standard deviation and the Student-t 95 % half-width over the seeds (the same arithmetic as the
 *     viewer's replications: T975 from run-ledger.js);
 *   - THIN SAMPLES CANNOT WIN (v3.63): a combination whose mean delivered orders is below --min-delivered
 *     (default 5) is marked `thin` and ranked after every combination that is not - an OTIF of 1 over one and a
 *     half delivered orders is not a better day than 0.91 over eleven, and the half-widths alone do not say so;
 *   - ranked by OTIF mean descending, then cost mean ascending, then the combination id; the best is the first;
 *   - deterministic: the same arguments write the same bytes (search.json, search.md, run-<combo>-<seed>.json).
 *
 * Honesty: a search over a synthetic teaching simulation. Without --profile the rates and shares are teaching
 * values; with one they are the plant's own, fitted from its records by tools/fit_rates.py - what the record says
 * for the period it covers, not a forecast, and aggregates per step and per trailer, never per person. A ranking
 * with overlapping half-widths is not a ranking; the tower's rule (lever-search) proposes the best only when its
 * gain exceeds the half-widths, and refuses a table measured under other rates than the run's.
 */
import fs from "node:fs";
import path from "node:path";
import { FLOOR, MODULES_HAND, MODULES_SCENARIO, loadWT, root, scenarioLayout } from "./ledger_env.mjs";

const USAGE = "usage: node tools/search_levers.mjs <scenario-id|hand> --seeds 1-3 --ticks 600 --out <dir> [--staffing declared,adaptive] [--inbound-period 120,60] [--outbound-period 240,120] [--errors declared|none] [--profile <site-profile.json>] [--min-delivered 5]";
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
const profilePath = opt("--profile", null);
const minDelivered = Math.max(0, Number(opt("--min-delivered", 5)));
if (!target || !outDir || !seeds.length || !isFinite(minDelivered) || staffing.some((s) => s !== "declared" && s !== "adaptive") || inboundPeriods.some((n) => !(n > 0)) || outboundPeriods.some((n) => !(n > 0)) || (errorsMode !== "declared" && errorsMode !== "none")) {
  console.error(USAGE); process.exit(2);
}

loadWT(MODULES_HAND);
loadWT(["data/scms-delivery.js"]);
// v3.63: the plant's own rates, when a site profile is given (tools/fit_rates.py)
let siteProfile = null;
if (profilePath) {
  try { siteProfile = JSON.parse(fs.readFileSync(path.resolve(root, profilePath), "utf8")); } catch (e) { console.error("could not read the site profile: " + e.message); process.exit(2); }
  if (!siteProfile || siteProfile.schema !== "wt-site-profile/v1" || !siteProfile.values) { console.error("not a wt-site-profile/v1 document (tools/fit_rates.py): " + profilePath); process.exit(2); }
}
const profValue = (id) => (siteProfile && siteProfile.values[id] && typeof siteProfile.values[id].value === "number" ? siteProfile.values[id].value : null);
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;
const RL = globalThis.RunLedger;
let layout, mix, scenarioId, profile;
if (target === "hand") {
  layout = FLOOR; mix = R.defaultMix(); scenarioId = "hand-built"; profile = P.PROFILES.ecommerce;
} else {
  loadWT(MODULES_SCENARIO);
  layout = scenarioLayout(target); mix = layout.config.orderMix; scenarioId = target; profile = P.profileFor(target);
}
// The app's delivery defaults (readDeliveryLevers) with the period as the lever; a site profile replaces the
// dataset shape with the plant's own quantiles in ticks (= minutes), exactly as readDeliveryLevers does (v3.63).
const DS = globalThis.WT.datasets && globalThis.WT.datasets.scmsDelivery;
const siteN = profValue("delivery.site.n");
const siteQ = siteN > 0 ? { min: profValue("delivery.site.latenessMin") || 0, p10: profValue("delivery.site.latenessP10") || 0, median: profValue("delivery.site.latenessMedian") || 0, p90: profValue("delivery.site.latenessP90") || 0, max: profValue("delivery.site.latenessMax") || 0 } : null;
const q = siteQ || (DS ? DS.by_mode.Truck.lateness_days : { min: 0, p10: 0, median: 0, p90: 0, max: 0 });
const scale = siteQ ? 1 : 60;
const mode = siteQ ? "site" : "Truck";
const late = F.windowLateness(q, scale, 16);
const source = siteQ ? "site profile: the plant's own trailer log, " + siteN + " trailers (lateness in ticks = minutes, nearest-rank quantiles)" : DS ? "USAID SCMS delivery history (aggregates, data/scms-delivery.json), mode Truck, scaled 60 ticks per day" : "no dataset loaded: every trailer on time";
// The error spec the runs use: the profile's fitted shares where it has them, the teaching default otherwise.
const errorsSpec = (function () {
  if (errorsMode !== "declared") return null;
  if (!siteProfile) return true;
  const spec = {};
  for (const def of R.ERROR_KINDS) { const v = profValue("hf.error." + def.kind); spec[def.kind] = v == null ? def.share : v; }
  return spec;
})();
const errorsBlock = errorsSpec ? R.normalizeErrors(errorsSpec).kinds.map((k) => [k.kind, k.effective]) : null;
const inboundOf = (period) => ({ periodTicks: period, openTicks: 30, lateness: late, mode: mode, scaleTicksPerDay: scale, source: source });
const outboundOf = (period) => ({ periodTicks: period, promisedLeadTicks: 480, transit: late.map((v) => Math.max(0, 120 + v)), mode: mode, scaleTicksPerDay: scale, source: source + "; nominal transit 120 ticks plus the same lateness shape" });

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
    if (errorsSpec) o.errors = errorsSpec;
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
  const del = stats(delivered);
  combos.push({ id: id, index: combos.length, levers: { staffing: st, inbound_period: ip, outbound_period: op, errors: errorsMode }, kb: kb, n: seeds.length,
    otif: stats(otif), cost_eur: stats(cost), delivered_orders: del, thin: !(del.mean >= minDelivered), otif_by_seed: otif, cost_by_seed: cost, runs: runs });
}
const rank = (a, b) => (a.thin === b.thin ? 0 : a.thin ? 1 : -1) || ((b.otif.mean == null ? -1 : b.otif.mean) - (a.otif.mean == null ? -1 : a.otif.mean)) || ((a.cost_eur.mean == null ? Infinity : a.cost_eur.mean) - (b.cost_eur.mean == null ? Infinity : b.cost_eur.mean)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ranked = combos.slice().sort(rank).map((c) => c.id);
const search = {
  kind: "wt-lever-search", scenario: scenarioId, ticks: ticks, seeds: seeds, grid: { staffing: staffing, inbound_period: inboundPeriods, outbound_period: outboundPeriods, errors: errorsMode },
  min_delivered: minDelivered,
  rule: "a combination whose mean delivered orders is below min_delivered is marked thin and ranked after every one that is not (v3.63); then by OTIF mean descending, cost mean ascending, id; mean, sample standard deviation and Student-t 95 % half-width over the seeds (run-ledger.js T975); a seed without a delivered order is missing for OTIF",
  // v3.63: the rates the whole grid was searched under - the tower's fifth rule refuses a table measured under other rates
  rates: { profile: siteProfile ? (siteProfile.site || "a site profile") : null,
    source: siteProfile ? "tools/fit_rates.py site profile" + (siteProfile.fitted_from && Array.isArray(siteProfile.fitted_from.documents) ? " fitted on " + siteProfile.fitted_from.documents.join(", ") : "") : "the app's teaching values (HEART-anchored error shares, the SCMS Truck lateness shape)",
    errors: errorsBlock, inbound_mode: mode, inbound_lateness: late.slice(), outbound_transit: late.map((v) => Math.max(0, 120 + v)) },
  combos: combos, ranked: ranked, best: ranked[0],
  honesty: "A search over a synthetic teaching simulation: the same floor, mix and ticks, the levers varied, one run per seed. " +
    (siteProfile ? "The rates are the plant's own, fitted from its records by tools/fit_rates.py (aggregates per step and per trailer, never per person) - what the record says for the period it covers, not a forecast. " : "The rates and shares are teaching values (HEART-anchored, the SCMS lateness shape), not measurements of any plant. ") +
    "Overlapping half-widths mean no ranking; the control tower's lever-search rule proposes the best only when its OTIF gain exceeds the half-widths, and refuses a table measured under other rates. Nothing is per person.",
};
fs.writeFileSync(path.join(outDir, "search.json"), JSON.stringify(search, null, 1) + "\n");
const pm = (s) => (s.mean == null ? "-" : s.mean + (s.ci95_half == null ? "" : " ± " + s.ci95_half));
const md = ["# Lever search: " + scenarioId + " over seeds " + seeds.join(", ") + ", " + ticks + " ticks", "",
  "Rates: " + search.rates.source + (search.rates.profile ? " (" + search.rates.profile + ")" : "") + (errorsBlock ? "; error shares " + errorsBlock.map((e) => e[0] + " " + e[1]).join(", ") : "; no error what-if") + "; lateness shape " + mode + ".", "", "| rank | combination | n | OTIF | cost (EUR) | delivered orders |", "|---|---|---|---|---|---|"]
  .concat(ranked.map((id, i) => { const c = combos.find((x) => x.id === id); return "| " + (i + 1) + " | " + id + (c.thin ? " (thin)" : "") + " | " + c.n + " | " + pm(c.otif) + " | " + pm(c.cost_eur) + " | " + pm(c.delivered_orders) + " |"; }))
  .concat(["", search.rule + ".", "", search.honesty, ""]);
fs.writeFileSync(path.join(outDir, "search.md"), md.join("\n"));
console.log("search: " + combos.length + " combinations x " + seeds.length + " seeds of " + scenarioId + " over " + ticks + " ticks at " + (siteProfile ? "the plant's own rates (" + search.rates.profile + ")" : "teaching rates") + " -> best " + ranked[0] + " (OTIF " + pm(combos.find((c) => c.id === ranked[0]).otif) + ") -> " + path.join(outDir, "search.json"));
