/* tools/replicate.mjs - replications over seeds (v3.46).
 *
 *   node tools/replicate.mjs <scenario-id|hand> --seeds 1-10 --ticks 300 --out <dir> [--policy queue-staffing]
 *
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

const USAGE = "usage: node tools/replicate.mjs <scenario-id|hand> --seeds 1-10 --ticks 300 --out <dir> [--policy queue-staffing]";

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
if (!outDir || !seeds.length) { console.error(USAGE); process.exit(2); }

loadWT(MODULES_HAND);
const { routing: R, flowsim: F, ledger: L, pack: P, analytics: A } = globalThis.WT;
let layout, mix, scenarioId, profile;
if (target === "hand") {
  layout = FLOOR; mix = R.defaultMix(); scenarioId = "hand-built"; profile = P.PROFILES.ecommerce;
} else {
  loadWT(MODULES_SCENARIO);
  layout = scenarioLayout(target); mix = layout.config.orderMix; scenarioId = target; profile = P.profileFor(target);
}
fs.mkdirSync(outDir, { recursive: true });
const runs = [];
let policy = null;
for (const seed of seeds) {
  const o = { seed: seed, mix: mix };
  if (policyKind) o.policy = { kind: policyKind };
  const plan = F.spawnPlan(layout, o);
  if (policyKind && !plan.policy) { console.error("unknown policy kind " + policyKind); process.exit(2); }
  policy = plan.policy || null;
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
fs.writeFileSync(path.join(outDir, "bundle.json"), JSON.stringify(bundle, null, 1) + "\n");
console.log("bundle: " + runs.length + " runs of " + scenarioId + " over " + ticks + " ticks -> " + path.join(outDir, "bundle.json"));
