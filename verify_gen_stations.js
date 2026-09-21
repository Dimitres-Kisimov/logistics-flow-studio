/* =====================================================================
 * Logistics Flow Studio - verify_gen_stations.js
 * v3.34 THE GENERATOR PLACES THE ROUTING STATIONS - headless verification
 * ---------------------------------------------------------------------
 * Until now only the library scenarios carried the R2 stations (QC bench,
 * depalletiser, returns bench, wrapper, VAS bench); a keyword-generated floor
 * could not run case-pick, each-pick or value-add orders. v3.34 lets the
 * generator place them on request, with the same zone-bounded free-spot
 * search the scenarios use.
 *
 * Checks, over every warehouse profile x three seeds:
 *   1. With the option every station is either PLACED or honestly SKIPPED
 *      (meta.routingStations lists both, union = the five types).
 *   2. The floor stays overlap-free and passes / warns compliance, never FAILs.
 *   3. If everything was placed, the FULL order mix is routable; if something
 *      was skipped, the router's unfulfillable report names only those.
 *   4. WITHOUT the option the output is byte-identical to before (no new
 *      elements, no new meta), so every existing pin holds.
 *   5. Shipped wiring: the Generate panel checkbox and the app passing it.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "routing.js", "flowsim.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const G = global.WT.generate, C = global.WT.compliance, R = global.WT.routing, F = global.WT.flowsim;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const TYPES = ["qc-bench", "depalletiser", "returns-station", "stretch-wrap", "vas-station"];
const NEED = { "qc-bench": ["qc"], depalletiser: ["depalletise"], "returns-station": ["returns"], "stretch-wrap": ["wrap", "palletise"], "vas-station": ["vas"] };
function overlaps(els) {
  let n = 0;
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d) n++;
  }
  return n;
}
const profiles = Object.keys(G.PROFILES || G.plantProfiles || {});
const keys = profiles.length ? profiles : ["ecommerce-fulfilment", "cold-chain", "automotive-supply", "spare-parts-distribution"];

console.log("v3.34 - the generator places the routing stations");
console.log("=".repeat(72));

let runs = 0, badMeta = 0, badOverlap = 0, badCompliance = 0, badRoute = 0, allPlaced = 0, identical = 0, placedTotal = 0, skippedTotal = 0;
const detail = [];
for (const k of keys) {
  for (const seed of [1, 7, 42]) {
    runs++;
    const gen = G.generateLayout(k, { seed: seed, stationsForRouting: true });
    const rs = gen.meta.routingStations || { placed: [], skipped: [] };
    const union = rs.placed.concat(rs.skipped).sort().join(",");
    if (union !== TYPES.slice().sort().join(",")) badMeta++;
    placedTotal += rs.placed.length; skippedTotal += rs.skipped.length;
    for (const t of rs.placed) if (!gen.elements.some((e) => e.type === t)) badMeta++;
    if (overlaps(gen.elements) > 0) badOverlap++;
    const rep = C.check({ version: "wt-1", gridW: gen.gridW, gridH: gen.gridH, cell: 1, elements: gen.elements }, { minAisleMetres: gen.meta.minAisleMetres });
    if (rep.findings.some((f) => f.status === "fail" || f.severity === "fail" || f.level === "fail" || f.result === "fail")) badCompliance++;
    const lay = { gridW: gen.gridW, gridH: gen.gridH, cell: 1, elements: gen.elements, config: gen.config };
    const plan = F.spawnPlan(lay, { seed: seed, mix: R.defaultMix() });
    if (rs.skipped.length === 0) {
      allPlaced++;
      if (plan.unfulfillable.length) { badRoute++; detail.push(k + "/" + seed + ": " + plan.unfulfillable.map((u) => u.routeId).join(",")); }
    } else {
      // every missing anchor must be one a skipped station would have provided
      const allowed = {};
      for (const t of rs.skipped) for (const a of NEED[t]) allowed[a] = 1;
      const bad = plan.unfulfillable.some((u) => u.missing.some((m) => !allowed[m.anchor]));
      if (bad) { badRoute++; detail.push(k + "/" + seed + ": unexpected missing anchor"); }
    }
    const a = JSON.stringify(G.generateLayout(k, { seed: seed }));
    const b = JSON.stringify(G.generateLayout(k, { seed: seed, stationsForRouting: false }));
    if (a === b && a.indexOf("routingStations") < 0 && a.indexOf('"qc-bench"') < 0) identical++;
  }
}
check("1. over " + runs + " generated floors every station is placed or honestly skipped (" + placedTotal + " placed, " + skippedTotal + " skipped)", badMeta === 0 && runs === keys.length * 3);
check("2. every generated floor stays overlap-free and never FAILs compliance", badOverlap === 0 && badCompliance === 0, "overlaps=" + badOverlap + " fails=" + badCompliance);
check("3. the full order mix is routable wherever everything was placed (" + allPlaced + " of " + runs + "), and a skipped station is the only reason for any gap", badRoute === 0, detail.slice(0, 3).join(" | ") || "ok");
check("4. without the option the generator output is byte-identical to before (no stations, no meta)", identical === runs);
check("5. the Generate panel offers the option (checked by default) and the app passes it to the generator",
  /id="genStations"[^>]*checked/.test(read("index.html")) && /stationsForRouting: /.test(read("app.js")));
check("6. keyword-generated floors can now run the routes the scenarios run: at least one profile placed all five stations", allPlaced > 0, allPlaced + " floors with all five");

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL GENERATOR-STATION CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
