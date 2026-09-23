/* Regenerate the committed twin of the synthetic EPCIS 2.0 document (v3.58, the return path).
 *   node tools/make_epcis_fixture.mjs
 * reads  test/fixtures/epcis-document.json           the synthetic capture document (hand-written)
 * writes test/fixtures/epcis-document.tracking.json  WT.tracking.fromEpcis(document).doc - the recorded events
 *                                                    on the twins' shape (factory-tracking-events/v1)
 *        test/fixtures/epcis-document.tracking.views.json  the dwell-per-business-step and disposition rows
 * Deterministic: the same commit reproduces the same bytes. test/test_epcis_import.py pins the Python
 * mapping (tools/epcis_import.py) equal to the first file event by event and the SQL dwell view equal to
 * the second; verify_epcis_import.js pins both files fresh.
 */
import fs from "node:fs";
import path from "node:path";
import { MODULES_HAND, loadWT, root } from "./ledger_env.mjs";

loadWT(MODULES_HAND);
const T = globalThis.WT.tracking;
const FIX = path.join(root, "test", "fixtures");
const input = JSON.parse(fs.readFileSync(path.join(FIX, "epcis-document.json"), "utf8"));
const r = T.fromEpcis(input);
if (!r.ok) { console.error("refused: " + r.errors.join("; ")); process.exit(1); }
fs.writeFileSync(path.join(FIX, "epcis-document.tracking.json"), JSON.stringify(r.doc, null, 1) + "\n");
fs.writeFileSync(path.join(FIX, "epcis-document.tracking.views.json"),
  JSON.stringify({ bizstepDwell: T.dwellByBizStep(r.doc.events), dispositionCounts: T.dispositionCounts(r.doc.events) }, null, 1) + "\n");
console.log("epcis-document.tracking.json: " + r.doc.run.id + " - " + r.summary.document_events + " document events -> " + r.summary.mapped_events + " mapped, " + r.summary.units + " units, " + r.summary.ticks + " minutes");
