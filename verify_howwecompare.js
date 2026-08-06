/* =====================================================================
 * verify_howwecompare.js - honest "How we compare" page verification (A4).
 *
 * Runs the REAL WT.howwecompare module under the same window shim the
 * other harnesses use and asserts the page is a FAIR, SOURCED, HONEST
 * comparison - never a boast:
 *
 *   1. API surface: MODEL / html / DISCLAIMER / FRAMING / SOURCES.
 *   2. Names the three compared products factually (Siemens Tecnomatix
 *      Plant Simulation / FlexSim / AnyLogic).
 *   3. States what THEY are strong at (validated DES, deep libraries) FIRST.
 *   4. Carries the SOURCED competitor facts (~$10,000/yr, subscription-only,
 *      desktop-only, steep learning curve + training, limited sharing) and
 *      every competitor cost row references a cited source.
 *   5. Carries the independent-comparison DISCLAIMER + the honest FRAMING
 *      ("for validated, certified DES ... use the commercial suites; for
 *      free, offline ... use this app").
 *   6. NO banned tokens anywhere in the rendered page: no "beats", no
 *      "superior", no "no competition" (case-insensitive) - the whole point.
 *   7. This app's wedge is present (free / offline / no-install / open /
 *      user-definable / honest).
 *   8. Sources are cited as TEXT (a publisher + a scheme-less path) - the
 *      page opens NO external links: no <a href="http...">, no <script>.
 *   9. DETERMINISM: html() is pure (byte-identical across calls) - NO Date,
 *      NO Math.random.
 *
 * Usage:  node verify_howwecompare.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["howwecompare.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const H = WT.howwecompare;

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

console.log("How-we-compare page verification (honest, sourced, deterministic)");
console.log("");

/* ---- 1. API surface ---------------------------------------------------- */
check("WT.howwecompare exposes MODEL + html + DISCLAIMER + FRAMING + SOURCES",
  H && typeof H.html === "function" && H.MODEL && typeof H.MODEL === "object" &&
  typeof H.DISCLAIMER === "string" && typeof H.FRAMING === "string" && Array.isArray(H.SOURCES));

const page = H.html();
const model = H.MODEL;

/* ---- 2. Names the three compared products factually -------------------- */
check("names Siemens Tecnomatix Plant Simulation / FlexSim / AnyLogic (factually)",
  /Siemens Tecnomatix Plant Simulation/.test(page) && /FlexSim/.test(page) && /AnyLogic/.test(page),
  model.competitors.map((c) => c.name).join(" | "));

/* ---- 3. States their strengths FIRST ----------------------------------- */
check("states what the commercial suites are STRONG at (validated DES + deep libraries)",
  /validated,?\s*certified discrete-event simulation/i.test(page) &&
  /deep,? .*object librar/i.test(page) &&
  Array.isArray(model.theirStrengths) && model.theirStrengths.length >= 3);

/* ---- 4. Sourced competitor facts --------------------------------------- */
const factsOk =
  /10,000\s*\/\s*year|10,000 \/ yr|\$10,000/i.test(page) &&
  /subscription-only/i.test(page) &&
  /desktop|native desktop/i.test(page) &&
  /steep learning curve/i.test(page) &&
  /training/i.test(page) &&
  /(export|interoperab|sharing)/i.test(page);
check("carries the SOURCED competitor facts (~$10k/yr, subscription-only, desktop-only, steep curve+training, limited sharing)",
  factsOk);

// every competitor cost row references a real cited source id.
const srcIds = model.sources.map((s) => s.id);
let allSourced = true;
for (const c of model.competitors) for (const cost of c.costs) if (srcIds.indexOf(cost.sourceId) === -1) allSourced = false;
check("every competitor cost claim references a cited source", allSourced && model.sources.length >= 4,
  model.sources.length + " sources");

/* ---- 5. Disclaimer + honest framing ------------------------------------ */
check("carries the independent-comparison DISCLAIMER (not affiliated / trademarks / cited)",
  /independent comparison/i.test(page) && /not affiliated/i.test(page) &&
  /trademark/i.test(page) && /cited source/i.test(page));

check("carries the honest FRAMING (validated-DES -> the suites; free/offline -> this app; different tools)",
  /for validated,?\s*certified discrete-event simulation/i.test(page) &&
  /commercial suites/i.test(page) && /use this app/i.test(page) &&
  /different tools/i.test(page));

/* ---- 6. NO banned tokens (the whole point) ----------------------------- */
const banned = [
  { re: /\bbeats\b/i, label: "beats" },
  { re: /\bsuperior\b/i, label: "superior" },
  { re: /no[\s-]?competition/i, label: "no competition" },
  { re: /\bbest-in-class\b/i, label: "best-in-class" },
  { re: /\bguaranteed\b/i, label: "guaranteed" },
];
const hits = banned.filter((b) => b.re.test(page)).map((b) => b.label);
check("NO banned tokens anywhere (no 'beats' / 'superior' / 'no competition' / 'best-in-class' / 'guaranteed')",
  hits.length === 0, hits.length ? "found: " + hits.join(",") : "clean");

/* ---- 7. This app's wedge present --------------------------------------- */
const wedgeOk =
  /free/i.test(page) && /offline/i.test(page) && /(no[- ]install|zero-install)/i.test(page) &&
  /(shareable|JSON|CSV|URL)/i.test(page) && /user-definable/i.test(page) &&
  /(modelled,? not measured|not a certification)/i.test(page);
check("states this app's wedge (free / offline / no-install / open+shareable / user-definable / honest)", wedgeOk);

/* ---- 8. Offline: sources cited as text, no opened links ---------------- */
const offlineOk =
  !/<a\s[^>]*href\s*=\s*["']https?:/i.test(page) &&
  !/<script/i.test(page) &&
  !/(?:src|href)\s*=\s*["']https?:\/\//i.test(page) &&
  // the source citations are present as plain text (publisher path).
  /worldmetrics\.org/.test(page);
check("sources cited as TEXT (no <a href=http>, no <script>) - the page opens no external links", offlineOk);

/* ---- 9. Determinism ---------------------------------------------------- */
check("html() is pure + deterministic (byte-identical across calls; no Date/RNG)",
  H.html() === page && H.html({ headingLevel: 2 }) === H.html({ headingLevel: 2 }),
  page.length + " bytes");

// The source module itself CALLS no Date / Math.random (comments may mention
// them; only real API usage would make the page non-deterministic).
const src = fs.readFileSync(path.join(__dirname, "howwecompare.js"), "utf8");
check("howwecompare.js source calls no Date / Math.random (deterministic + offline)",
  !/new\s+Date|Date\.(now|parse|UTC)|Date\(/.test(src) && !/Math\.random/.test(src));

console.log("");
console.log(failures === 0 ? "ALL HOW-WE-COMPARE CHECKS PASSED (" + checks + " checks)" : failures + " OF " + checks + " CHECKS FAILED");
process.exit(failures === 0 ? 0 : 1);
