/* tools/ask_cli.mjs - ask the ledger from the command line (v3.61).
 *
 *   node tools/ask_cli.mjs "<question>" --export test/fixtures/run-ledger.json
 *   node tools/ask_cli.mjs --all --export test/fixtures/run-ledger.json
 *
 * Prints WT.ask.answer(question, { exp, kb }) as JSON - the deterministic layer of v3.60, unchanged:
 * the same modules the app loads (ask.js over ledger.js, control.js, tracking.js and the knowledge base
 * with its teaching values), so the answer is byte-identical to the drawer's and the viewer's. `--all`
 * prints every catalogue answer (the evidence pack tools/ask_model.py hands a model). Offline, no Date.
 */
import fs from "node:fs";
import path from "node:path";
import { MODULES_HAND, loadWT, root } from "./ledger_env.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const all = args.includes("--all");
const question = args.find((a) => !a.startsWith("--") && a !== opt("--export")) || "";
const file = opt("--export");
if (!file || (!all && !question)) {
  console.error('usage: node tools/ask_cli.mjs "<question>" --export <run-ledger.json>   |   --all --export <run-ledger.json>');
  process.exit(2);
}
loadWT(MODULES_HAND);
loadWT(["knowledge.js", "ask.js"]);
const WT = globalThis.WT;
const exp = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
if (all) {
  const out = {};
  for (const q of WT.ask.catalogue()) out[q.id] = WT.ask.answer(q.ask, { exp: exp, kb: WT.kb });
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
} else {
  process.stdout.write(JSON.stringify(WT.ask.answer(question, { exp: exp, kb: WT.kb }), null, 1) + "\n");
}
