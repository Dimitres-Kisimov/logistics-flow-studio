/* tools/ledger_env.mjs - one headless loader for the ledger tools (v3.43).
 *
 * The browser modules are plain scripts that attach to window.WT; under node we
 * alias window to globalThis and eval them in dependency order (the same recipe
 * every verify_*.js harness uses). Two lists:
 *
 *   MODULES_HAND      the ledger chain plus the viewer's pure model - enough to
 *                     record and read a run on the hand-built floor;
 *   MODULES_SCENARIO  the example library (examples.build needs domain, generate,
 *                     compliance and nlcommands) and wms.js, which gives flowsim the
 *                     floor's DECLARED capacities. Load it only when you mean to:
 *                     with WT.wms present, flowsim.throughputOf stops falling back
 *                     to the floor rate, so the hand floor would record differently.
 *
 * FLOOR is the hand-built floor of verify_ledger.js (fixtures A and B); MIX_B the
 * cross-dock-heavy day of fixture B. scenarioLayout(id) is the layout adapter the
 * harnesses use for a library scenario.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MODULES_HAND = ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "tracking.js", "control.js", "run-ledger-sql.js", "run-ledger.js"];
export const MODULES_SCENARIO = ["compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js"];

export function loadWT(files) {
  globalThis.window = globalThis;
  for (const f of files) (0, eval)(fs.readFileSync(path.join(root, f), "utf8"));
  return globalThis.WT;
}

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
// fixture B: the same floor and seed, a cross-dock-heavy day (shares sum to 1)
export const MIX_B = [{ id: "cross-dock", share: 0.5 }, { id: "full-pallet-out", share: 0.2 }, { id: "case-pick", share: 0.15 }, { id: "piece-pick", share: 0.1 }, { id: "returns", share: 0.05 }];

export function scenarioLayout(id) {
  const E = globalThis.WT && globalThis.WT.examples;
  if (!E) throw new Error("load MODULES_SCENARIO before building a library scenario");
  const b = E.build(id);
  if (!b) throw new Error("unknown scenario " + id);
  return { gridW: b.gridW, gridH: b.gridH, cell: 1, elements: b.elements, config: b.config };
}
