/* tools/replicate.mjs - replications over seeds (v3.46).
 *
 *   node tools/replicate.mjs <scenario-id|hand> --seeds 1-10 --ticks 300 --out <dir> [--policy queue-staffing]
 *                           [--errors declared|<json>] [--inbound windows|<json>] [--outbound windows|<json>]
 *
 * v3.57: the three what-ifs of v3.54 / v3.55 as run inputs - `declared` / `windows` take the app's defaults
 * (the error kinds at their teaching shares; dock and carrier windows on the SCMS Truck lateness shape at
 * 60 ticks per day), a JSON literal is handed to flowsim as it is; the bundle records them, and runs with
 * different levers never form one replication group (the SQL and the viewer key on them).
 * Builds the floor once (the hand-built floor of fixture A, or a library scenario with
 * its declared mix and capacities), records one run ledger per seed and writes
 * run-<seed>.json plus bundle.json {scenario, mix, ticks, policy, seeds, runs}.
 * Deterministic: the same arguments write the same bytes. Import the runs into one
 * database (python tools/run_ledger.py import ...) and `replications` prints, per
 * order type, the mean, the sample standard deviation and a Student-t 95 % half-width
 * over the seeds; the viewer does the same from several files (Replications section).
 * Seeds only: no warm-up removal, no validation against a real plant.
 */
import fs from "node:fs";
import path from "node:path";
import { FLOOR, MODULES_HAND, MODULES_SCENARIO, loadWT, scenarioLayout } from "./ledger_env.mjs";

const USAGE = "usage: node tools/replicate.mjs <scenario-id|hand> --seeds 1-10 --ticks 300 --out <dir> [--policy queue-staffing] [--errors declared|<json>] [--inbound windows|<json>] [--outbound windows|<json>]";

export function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec || "").split(",")) {
    const p = part.trim();
    const m = /^(\d+)-(\d+)$/.exec(p);
    if (m) { for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i); } else if (/^\d+$/.test(p)) out.push(Number(p));
  }
  return out;
}

const args = process.argv.slice(2);
const target = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
if (!target || target.startsWith("--") || args.includes("--help")) { console.error(USAGE); process.exit(2); }
const seeds = parseSeeds(opt("--seeds", "1-5"));
const ticks = Math.max(1, Math.round(Number(opt("--ticks", 300)) || 300));
const outDir = opt("--out", null);
const policyKind = opt("--policy", null);
// v3.57 the levers: a keyword takes the app's defaults, a JSON literal is passed through
const leverArg = (v) => (v == null ? null : /^(true|declared|windows)$/i.test(v) ? true : JSON.parse(v));
let errorsArg, inboundArg, outboundArg;
try { errorsArg = leverArg(opt("--errors", null)); inboundArg = leverArg(opt("--inbound", null)); outboundArg = leverArg(opt("--outbound", null)); }
catch (e) { console.error("a lever must be a keyword or a JSON literal: " + e.message); process.exit(2); }
if (!outDir || !seeds.length) { console.error(USAGE); process.exit(2); }

loadWT(MODULES_HAND);
if (inboundArg || outboundArg) loadWT(["data/scms-delivery.js"]);
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;
// The app's delivery defaults (readDeliveryLevers): the Truck lateness shape of the SCMS aggregates at 60 ticks per day
function defaultWindows(kind) {
  const DS = globalThis.WT.datasets && globalThis.WT.datasets.scmsDelivery;
  const q = DS ? DS.by_mode.Truck.lateness_days : { min: 0, p10: 0, median: 0, p90: 0, max: 0 };
  const late = F.windowLateness(q, 60, 16);
  const source = DS ? "USAID SCMS delivery history (aggregates, data/scms-delivery.json), mode Truck, scaled 60 ticks per day" : "no dataset loaded: every trailer on time";
  return kind === "inbound" ? { periodTicks: 120, openTicks: 30, lateness: late, mode: "Truck", scaleTicksPerDay: 60, source: source }
    : { periodTicks: 240, promisedLeadTicks: 480, transit: late.map((v) => Math.max(0, 120 + v)), mode: "Truck", scaleTicksPerDay: 60, source: source + "; nominal transit 120 ticks plus the same lateness shape" };
}
let layout, mix, scenarioId, profile;
if (target === "hand") {
  layout = FLOOR; mix = R.defaultMix(); scenarioId = "hand-built"; profile = P.PROFILES.ecommerce;
} else {
  loadWT(MODULES_SCENARIO);
  layout = scenarioLayout(target); mix = layout.config.orderMix; scenarioId = target; profile = P.profileFor(target);
}
fs.mkdirSync(outDir, { recursive: true });
const runs = [];
let policy = null, errors = null, inbound = null, outbound = null;
for (const seed of seeds) {
  const o = { seed: seed, mix: mix };
  if (policyKind) o.policy = { kind: policyKind };
  if (errorsArg) o.errors = errorsArg;
  if (inboundArg) o.inbound = inboundArg === true ? defaultWindows("inbound") : inboundArg;
  if (outboundArg) o.outbound = outboundArg === true ? defaultWindows("outbound") : outboundArg;
  const plan = F.spawnPlan(layout, o);
  if (policyKind && !plan.policy) { console.error("unknown policy kind " + policyKind); process.exit(2); }
  policy = plan.policy || null;
  errors = plan.errors || null; inbound = plan.inbound || null; outbound = plan.outbound || null; // v3.57
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: scenarioId, seed: seed, mix: mix, layout: layout, profile: profile, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, ticks);
  const exp = L.exportJson(rec);
  fs.writeFileSync(path.join(outDir, "run-" + seed + ".json"), JSON.stringify(exp, null, 1) + "\n");
  runs.push(exp.run.id);
  console.log("seed " + seed + ": " + exp.run.id + " - " + exp.hus.length + " units, " + exp.events.length + " events");
}
const bundle = {
  kind: "wt-replication-bundle", scenario: scenarioId, mix: mix, ticks: ticks, policy: policy, seeds: seeds, runs: runs,
  honesty: "Replications over seeds of a synthetic teaching simulation: the same floor, mix and ticks, a different seed each. No warm-up removal, no validation against a real plant.",
};
if (errors) bundle.errors = errors; // v3.57: the levers, keys only when present
if (inbound) bundle.inbound = inbound;
if (outbound) bundle.outbound = outbound;
fs.writeFileSync(path.join(outDir, "bundle.json"), JSON.stringify(bundle, null, 1) + "\n");
console.log("bundle: " + runs.length + " runs of " + scenarioId + " over " + ticks + " ticks -> " + path.join(outDir, "bundle.json"));
