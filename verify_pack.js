/* =====================================================================
 * Logistics Flow Studio - verify_pack.js
 * v3.31 THE PACKAGING HIERARCHY + THE NUMBERING SYSTEM - headless verification
 * ---------------------------------------------------------------------
 * Everything below is checked against numbers WRITTEN OUT BY HAND here, not
 * read back from the code:
 *   1. Unit loads carry the public standard dimensions (EUR 1200 x 800 x 144,
 *      industrial 1200 x 1000, half 800 x 600; 33 / 26 pallets per trailer).
 *   2. ti-hi pallet patterns: e-commerce carton 400 x 300 x 250 on EUR at
 *      1.8 m -> 8 per layer (rotated) x 6 layers = 48 cases, 313 kg, 90.6 %
 *      cube; KLT 600 x 400 x 280 on an industrial pallet at 1.6 m -> 4 x 5 =
 *      20; pharma 300 x 200 x 150 on EUR at 1.5 m -> 16 x 9 = 144; beverage
 *      tray -> 8 x 11 = 88; food crate -> 4 x 7 = 28; drums on a 1200 x 1200
 *      pallet -> 4 x 1; a 40 kg carton is WEIGHT-limited to 4 layers = 32.
 *   3. The pattern optimiser ranks the industrial pallet (9 x 6 = 54) above
 *      EUR (48) above half (24) for that carton, and reports cube utilisation.
 *   4. Trailer fill: 40 EUR pallets need 2 trailers at 60.6 %; 33 fit one.
 *   5. GS1 check digits computed by hand: SSCC 340123450000000017, GTIN-13
 *      4012345678901, GTIN-14 14012345678908, GLN 4012345000016; a corrupted
 *      digit is rejected.
 *   6. Run / order / unit / event identities are deterministic, change with
 *      any input, parse back, and never collide across the whole library.
 *   7. Quantities along EVERY archetype are conserved at EVERY operation:
 *      eaches received == carried + retained + scrapped; a full pallet is never
 *      split; a cross-dock pallet is untouched; a return is scrapped or
 *      restocked in full; parcels = ceil(eaches / eaches-per-parcel).
 *   8. Every library scenario maps to a packaging profile and every mapped
 *      id is a real scenario; every profile's box and pallet exist.
 *   9. Honesty labels present; no Date / Math.random calls.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js", "routing.js", "ids.js", "pack.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const P = global.WT.pack;
const I = global.WT.ids;
const R = global.WT.routing;
const E = global.WT.examples;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

console.log("v3.31 - packaging hierarchy + numbering system");
console.log("=".repeat(72));

/* ---- 1. unit loads --------------------------------------------------- */
(function () {
  const e = P.PALLETS.eur, i = P.PALLETS.ind, h = P.PALLETS.half;
  check("1a. EUR pallet is 1200 x 800 x 144 mm, safe working load 1,500 kg (DIN EN 13698-1)",
    e.l === 1200 && e.w === 800 && e.h === 144 && e.maxLoadKg === 1500 && /13698-1/.test(e.standard));
  check("1b. industrial pallet 1200 x 1000, half pallet 800 x 600", i.l === 1200 && i.w === 1000 && h.l === 800 && h.w === 600);
  check("1c. 13.6 m trailer: 33 EUR / 26 industrial / 66 half pallets single-stacked",
    e.trailerSlots === 33 && i.trailerSlots === 26 && h.trailerSlots === 66 && P.TRAILERS["curtainsider-13.6"].innerLmm === 13600);
  check("1d. every box and pallet a profile names exists",
    Object.keys(P.PROFILES).every((k) => P.BOXES[P.PROFILES[k].box] && P.PALLETS[P.PROFILES[k].pallet]));
})();

/* ---- 2. ti-hi by hand ------------------------------------------------ */
(function () {
  const t = P.tiHi(P.PALLETS.eur, P.BOXES["case-400x300x250"], 1800, 6);
  check("2a. e-commerce carton on EUR at 1.8 m: 8 per layer (rotated 300 along 1200) x 6 layers = 48 cases",
    t.ti === 8 && t.rotated === true && t.hi === 6 && t.cases === 48, JSON.stringify(t));
  check("2b. ... gross 25 + 48 x 6 = 313 kg, stack 144 + 6 x 250 = 1644 mm, cube 1.44 / 1.58976 m3 = 90.58 %",
    near(t.grossKg, 313) && t.stackMm === 1644 && near(t.cubeUtil, 0.9058, 1e-4) && t.weightLimited === false);
  const k = P.tiHi(P.PALLETS.ind, P.BOXES["klt-600x400x280"], 1600, 15);
  check("2c. KLT 600 x 400 x 280 on an industrial pallet at 1.6 m: 2 x 2 = 4 per layer, 5 layers = 20, 333 kg",
    k.ti === 4 && k.rotated === false && k.hi === 5 && k.cases === 20 && near(k.grossKg, 333));
  const ph = P.tiHi(P.PALLETS.eur, P.BOXES["case-300x200x150"], 1500, 4);
  check("2d. pharma carton 300 x 200 x 150 on EUR at 1.5 m: 4 x 4 = 16 per layer, 9 layers = 144, 601 kg",
    ph.ti === 16 && ph.hi === 9 && ph.cases === 144 && near(ph.grossKg, 601));
  const bv = P.tiHi(P.PALLETS.eur, P.BOXES["tray-400x300x135"], 1650, 9.5);
  check("2e. beverage tray on EUR at 1.65 m: 8 x 11 = 88 trays, 861 kg (under the 1,500 kg limit)",
    bv.ti === 8 && bv.hi === 11 && bv.cases === 88 && near(bv.grossKg, 861) && !bv.weightLimited);
  const cc = P.tiHi(P.PALLETS.eur, P.BOXES["crate-600x400x200"], 1700, 12);
  check("2f. food crate 600 x 400 x 200 on EUR at 1.7 m: 2 x 2 = 4 per layer, 7 layers = 28",
    cc.ti === 4 && cc.hi === 7 && cc.cases === 28);
  const dr = P.tiHi(P.PALLETS.drum, P.BOXES["drum-585x585x880"], 1100, 220);
  check("2g. four 200 L drums on a 1200 x 1200 pallet, one layer, 910 kg", dr.ti === 4 && dr.hi === 1 && dr.cases === 4 && near(dr.grossKg, 910));
  const wl = P.tiHi(P.PALLETS.eur, P.BOXES["case-400x300x250"], 1800, 40);
  check("2h. a 40 kg carton is WEIGHT-limited: 8 x 40 = 320 kg per layer -> floor(1500 / 320) = 4 layers = 32 cases, 1,305 kg",
    wl.weightLimited === true && wl.hi === 4 && wl.cases === 32 && near(wl.grossKg, 1305));
  const bk = P.tiHi(P.PALLETS.ind, P.BOXES["bulk-600x400x400"], 1400, 30);
  check("2i. bulky 600 x 400 x 400 on an industrial pallet at 1.4 m: 4 x 3 = 12", bk.ti === 4 && bk.hi === 3 && bk.cases === 12);
  check("2j. a cage has a DECLARED capacity (24 tyres), not a computed pattern",
    P.casesPerPallet(P.PROFILES.tyres) === 24 && P.tiHi(P.PALLETS.cage, P.BOXES["tyre-630x630x230"], 1800, 9).fixed === true);
  check("2k. casesPerPallet(profile) agrees with the hand values: ecommerce 48, automotive 20, pharma 144, beverage 88, cold-chain 28, chemical 4, bulky 12",
    P.casesPerPallet(P.PROFILES.ecommerce) === 48 && P.casesPerPallet(P.PROFILES.automotive) === 20 &&
    P.casesPerPallet(P.PROFILES.pharma) === 144 && P.casesPerPallet(P.PROFILES.beverage) === 88 &&
    P.casesPerPallet(P.PROFILES["cold-chain"]) === 28 && P.casesPerPallet(P.PROFILES.chemical) === 4 && P.casesPerPallet(P.PROFILES.bulky) === 12);
})();

/* ---- 3. the pattern optimiser ---------------------------------------- */
(function () {
  const r = P.bestPattern(P.BOXES["case-400x300x250"], 1800, 6);
  check("3a. ranking for the e-commerce carton: industrial 3 x 3 = 9 per layer x 6 = 54, then EUR 48, then half 24",
    r.length === 3 && r[0].pallet === "ind" && r[0].ti === 9 && r[0].cases === 54 && r[1].pallet === "eur" && r[1].cases === 48 && r[2].pallet === "half" && r[2].cases === 24,
    r.map((x) => x.pallet + ":" + x.cases).join(" "));
  check("3b. ... with cube utilisation reported: industrial 81.5 %, EUR and half 90.6 %",
    near(r[0].cubeUtil, 0.8152, 1e-4) && near(r[1].cubeUtil, 0.9058, 1e-4) && near(r[2].cubeUtil, 0.9058, 1e-4));
  check("3c. cages never appear in a computed ranking", P.bestPattern(P.BOXES["tyre-630x630x230"], 1800, 9, ["cage", "eur"]).every((x) => x.pallet !== "cage"));
})();

/* ---- 4. trailer fill --------------------------------------------------- */
(function () {
  const a = P.trailerFill(40, "eur"), b = P.trailerFill(33, "eur"), c = P.trailerFill(0, "eur"), d = P.trailerFill(26, "ind");
  check("4.  40 EUR pallets -> 2 trailers at 40 / 66 = 60.61 %; 33 -> 1 at 100 %; 0 -> none; 26 industrial -> 1 full trailer",
    a.trailers === 2 && near(a.fill, 0.6061, 1e-4) && b.trailers === 1 && b.fill === 1 && c.trailers === 0 && c.fill === 0 && d.trailers === 1 && d.fill === 1);
})();

/* ---- 5. GS1 by hand ---------------------------------------------------- */
(function () {
  // SSCC body 3 4012345 000000001: weights 3,1,3,... from the right ->
  // 1x3 + 5x1 + 4x3 + 3x1 + 2x3 + 1x1 + 0 + 4x1 + 3x3 = 43 -> check 7.
  check("5a. SSCC(extension 3, serial 1) = 340123450000000017 (check digit 7, computed by hand)", I.sscc(3, 1) === "340123450000000017", I.sscc(3, 1));
  // GTIN-13 body 401234567890 -> 0x3+9+8x3+7+6x3+5+4x3+3+2x3+1+0+4 = 89 -> check 1.
  check("5b. GTIN-13(item 67890) = 4012345678901 (check digit 1)", I.gtin13(67890) === "4012345678901", I.gtin13(67890));
  // GTIN-14 body 1 401234567890 -> 89 + 1x3 = 92 -> check 8.
  check("5c. GTIN-14(indicator 1) of that item = 14012345678908 (check digit 8)", I.gtin14(1, "4012345678901") === "14012345678908");
  // GLN body 401234500001 -> 1x3 + 5x1 + 4x3 + 3x1 + 2x3 + 1x1 + 0 + 4x1 = 34 -> check 6.
  check("5d. GLN(location 1) = 4012345000016 (check digit 6)", I.gln(1) === "4012345000016");
  check("5e. every number above validates, and a single corrupted digit is rejected",
    ["340123450000000017", "4012345678901", "14012345678908", "4012345000016"].every(I.isValidGs1) &&
    !I.isValidGs1("340123450000000018") && !I.isValidGs1("4012345678902") && !I.isValidGs1("abc"));
  check("5f. a longer serial is right-aligned and zero-padded to 18 digits", I.sscc(0, 987654321).length === 18 && I.sscc(0, 987654321).slice(1, 8) === "4012345" && /987654321\d$/.test(I.sscc(0, 987654321)));
  check("5g. the honesty label says the prefix is the GS1 documentation prefix and not registered",
    /4012345/.test(I.HONESTY) && /not a registered/i.test(I.HONESTY));
})();

/* ---- 6. run / order / unit / event identities ----------------------- */
(function () {
  const b = E.build("ecommerce-multichannel-fc");
  const lay = { gridW: b.gridW, gridH: b.gridH, elements: b.elements };
  const mix = b.config.orderMix;
  const r1 = I.runId("ecommerce-multichannel-fc", 7, lay, mix);
  const r2 = I.runId("ecommerce-multichannel-fc", 7, lay, mix);
  check("6a. the run id is deterministic and well-formed", r1 === r2 && /^RUN-ecommerce-multichannel-fc-s7-h[0-9a-f]{8}$/.test(r1), r1);
  const moved = { gridW: lay.gridW, gridH: lay.gridH, elements: lay.elements.map((e, i) => (i === 0 ? Object.assign({}, e, { x: e.x + 1 }) : e)) };
  check("6b. moving one element, changing the seed or changing the mix each changes the input hash",
    I.runId("ecommerce-multichannel-fc", 7, moved, mix) !== r1 && I.runId("ecommerce-multichannel-fc", 8, lay, mix) !== r1 &&
    I.runId("ecommerce-multichannel-fc", 7, lay, { "cross-dock": 1 }) !== r1);
  const p = I.parseRun(r1);
  check("6c. the run id parses back to scenario, seed and hash", p && p.scenario === "ecommerce-multichannel-fc" && p.seed === 7 && p.hash.length === 8);
  const o = I.orderId(r1, 123), h = I.huId(o, 1), ev = I.eventId(h, 4);
  check("6d. order / unit / event ids nest and are zero-padded (ORD-...-000123, HU-...-1, EVT-...-4)",
    o === "ORD-" + r1 + "-000123" && h === "HU-" + o + "-1" && ev === "EVT-" + h + "-4");
  const seen = {}; let dup = 0, n = 0;
  for (const ex of E.library) {
    const bb = E.build(ex.id);
    const id = I.runId(ex.id, bb.config.seed, { gridW: bb.gridW, gridH: bb.gridH, elements: bb.elements }, bb.config.orderMix || null);
    n++; if (seen[id]) dup++; seen[id] = 1;
  }
  check("6e. run ids never collide across the whole library (" + n + " scenarios)", dup === 0 && n >= 23);
})();

/* ---- 7. quantities along every archetype ---------------------------- */
(function () {
  const bad = [];
  let checkedRoutes = 0;
  for (const arch of R.ARCHETYPES) {
    if (arch.legacy) continue;
    const outcomes = arch.outcomes ? arch.outcomes.map((o) => o.id) : [null];
    for (const oc of outcomes) {
      const ops = arch.ops.concat(oc ? (arch.outcomes.find((o) => o.id === oc).ops || []) : []);
      for (const prof of Object.keys(P.PROFILES)) {
        for (let k = 0; k < 5; k++) {
          const q = P.quantitiesAlong(P.PROFILES[prof], arch.id, ops, "HU-test-" + prof + "-" + arch.id + "-" + k);
          checkedRoutes++;
          if (!q.conserved) bad.push(prof + "/" + arch.id + "/" + oc + ": not conserved");
          const last = q.steps[q.steps.length - 1];
          if (arch.id === "full-pallet-out" && !q.steps.every((s) => s.pallets === 1 && s.cases === q.casesPerPallet)) bad.push(prof + "/full-pallet split");
          if (arch.id === "cross-dock" && !q.steps.every((s) => s.eaches === q.received && s.pallets === 1)) bad.push(prof + "/cross-dock touched");
          if (arch.id === "returns" && oc === "scrap" && !(last.eaches === 0 && last.scrapped === q.received)) bad.push(prof + "/scrap");
          if (arch.id === "returns" && oc === "restock" && !(last.eaches === 0 && last.retained === q.received)) bad.push(prof + "/restock");
          if (arch.id === "piece-pick") {
            const pack = q.steps.find((s) => s.op === "pack");
            if (!pack || pack.parcels !== Math.ceil(pack.eaches / P.PROFILES[prof].eachesPerParcel) || pack.eaches < 1) bad.push(prof + "/piece-pick parcels");
          }
          if (arch.id === "case-pick") {
            const cp = q.steps.find((s) => s.op === "case-pick");
            if (!cp || cp.cases < 1 || cp.cases > q.casesPerPallet || cp.retained !== (q.casesPerPallet - cp.cases) * q.eachesPerCase) bad.push(prof + "/case-pick retained");
            if (q.steps.find((s) => s.op === "palletise").pallets !== 1) bad.push(prof + "/palletise");
          }
          const again = P.quantitiesAlong(P.PROFILES[prof], arch.id, ops, "HU-test-" + prof + "-" + arch.id + "-" + k);
          if (JSON.stringify(again) !== JSON.stringify(q)) bad.push(prof + "/" + arch.id + " not deterministic");
        }
      }
    }
  }
  check("7a. eaches received == carried + retained + scrapped at EVERY operation of EVERY archetype x profile x 5 units (" + checkedRoutes + " routes walked)",
    bad.length === 0, bad.slice(0, 5).join("; ") || "all conserved");
  const q = P.quantitiesAlong(P.PROFILES.ecommerce, "case-pick", R.ARCHETYPE_BY_ID["case-pick"].ops, "HU-x");
  check("7b. an e-commerce case-pick unit arrives as 1 pallet / 48 cases / 576 eaches and leaves as 1 dispatch pallet of the picked cases, the rest retained",
    q.received === 576 && q.steps[0].cases === 48 && q.steps[0].pallets === 1 && q.steps[q.steps.length - 1].pallets === 1 &&
    q.steps[q.steps.length - 1].cases >= 2 && q.steps[q.steps.length - 1].cases <= 8 && q.steps[q.steps.length - 1].form === "wrapped-pallet",
    JSON.stringify(q.steps.map((s) => s.op + ":" + s.pallets + "/" + s.cases + "/" + s.eaches)));
})();

/* ---- 8. profile coverage --------------------------------------------- */
(function () {
  const ids = E.library.map((e) => e.id);
  const missing = ids.filter((id) => !P.SCENARIO_PROFILE[id]);
  const stale = Object.keys(P.SCENARIO_PROFILE).filter((id) => ids.indexOf(id) < 0);
  check("8a. every library scenario maps to a packaging profile and every mapping names a real scenario",
    missing.length === 0 && stale.length === 0, (missing.join(",") || "none missing") + " / " + (stale.join(",") || "none stale"));
  check("8b. every mapped profile exists and an unknown layout gets the general profile",
    Object.keys(P.SCENARIO_PROFILE).every((id) => P.PROFILES[P.SCENARIO_PROFILE[id]]) && P.profileFor("no-such-scenario").id === P.DEFAULT_PROFILE);
})();

/* ---- 9. honesty + hygiene -------------------------------------------- */
(function () {
  check("9a. the packaging honesty label names the standards and calls the profile values synthetic",
    /13698/.test(P.HONESTY) && /VDA 4500/.test(P.HONESTY) && /SYNTHETIC/.test(P.HONESTY) && /not a load plan/.test(P.HONESTY));
  const src = read("pack.js") + read("ids.js");
  check("9b. no Date / Math.random CALL in pack.js or ids.js", !/new Date\(|Date\.now\(|Math\.random\(/.test(src));
  check("9c. index.html loads ids.js and pack.js before the app, and sw.js precaches them",
    /<script src="ids\.js"><\/script>/.test(read("index.html")) && /<script src="pack\.js"><\/script>/.test(read("index.html")) &&
    /"\.\/ids\.js"/.test(read("sw.js")) && /"\.\/pack\.js"/.test(read("sw.js")));
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL PACKAGING + NUMBERING CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
