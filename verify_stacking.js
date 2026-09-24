/* =====================================================================
 * Logistics Flow Studio - verify_stacking.js
 * v3.38 STACKING STRENGTH, THE FOUR-BLOCK PINWHEEL, YOUR CASE - headless
 * ---------------------------------------------------------------------
 * Every number below is WRITTEN OUT BY HAND here, not read back from the code:
 *   1. McKee: ECT 5 kN/m, caliper 4 mm, a 400 x 300 case (perimeter 1,400 mm)
 *      -> BCT = 5.874 x 5 x sqrt(5,600) = 2,197.85 N = 224.1 kgf; linear in
 *      ECT; zero for missing inputs.
 *   2. Loads: 6 kg cases, 7 layers, single stack -> the bottom case bears
 *      36 kg; with one pallet on top (8 per layer, EUR tare 25 kg) 81.125 kg.
 *   3. Factors: the defaults are 50 % RH x 90 days under load x no overhang x
 *      an aligned column = 1.0 x 0.6 x 1.0 x 1.0 = 0.6 -> allowable 1,318.71 N
 *      = 134.47 kg -> 23 safe layers single-stacked, 11 with a pallet on top;
 *      90 % RH x a year x 25 mm overhang x interlocked = 0.085; numeric
 *      overrides work; the options carry the published values.
 *   4. The pinwheel: 1000 x 1000 with a 600 x 400 case -> grid 2, bands 3,
 *      four-block 4 (four non-overlapping rectangles inside the deck, a
 *      200 x 200 hole); bestLayer chooses it and layerRects draws it.
 *   5. On the ten teaching profiles x the standard pallets the pinwheel NEVER
 *      beats the bands (printed, not hidden): every bestLayer is grid or bands
 *      and equals max(grid, bands in both directions), so every profile's
 *      cases per pallet, the recorded fixture and optimizeProfile are
 *      unchanged (e-commerce 48, automotive 25, fixture 48).
 *   6. tiHi with a board: the e-commerce carton is height-limited to 6 layers
 *      within the 23 the board allows (30 kg of 134.47 on the bottom case);
 *      a 40 kg carton on ECT 3 board is STRENGTH-limited to 3 layers although
 *      the load limit allows 4; a board with `evaluated: false` yields no
 *      verdict; at 90 % RH for a year the grocery tray becomes strength-
 *      limited (the honest finding: at the default factors none of the ten
 *      profiles is).
 *   7. RunLedger.yourCase on the e-commerce inputs: industrial 60 first, the
 *      strength verdict present, a custom pallet joins the ranking, bad
 *      inputs return an error.
 *   8. Shipped wiring: the viewer section, the profile board in the export,
 *      sw.js at wt-v145, the runner; no Date / Math.random in pack.js.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "compliance.js", "generate.js", "nlcommands.js", "examples.js", "routing.js", "ids.js", "pack.js", "run-ledger-sql.js", "run-ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const P = global.WT.pack;
const RL = global.RunLedger;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
function overlapFree(rects, L, W) {
  for (const r of rects) if (r.x < -1e-9 || r.y < -1e-9 || r.x + r.w > L + 1e-9 || r.y + r.h > W + 1e-9) return false;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9) return false;
  }
  return true;
}

console.log("v3.38 - stacking strength, the pinwheel, your case");
console.log("=".repeat(72));

/* ---- 1. McKee ------------------------------------------------------------ */
(function () {
  const b = P.bct(5, 4, 1400);
  check("1a. BCT = 5.874 x 5 x sqrt(4 x 1400) = 2,197.85 N (224.1 kgf) for a 400 x 300 case on ECT 5 kN/m, caliper 4 mm", near(b, 2197.85, 0.05) && near(b / P.G_N_PER_KG, 224.1, 0.05), b.toFixed(2));
  check("1b. linear in ECT (ECT 10 doubles it), zero for a missing input", near(P.bct(10, 4, 1400), 2 * b, 1e-6) && P.bct(0, 4, 1400) === 0 && P.bct(5, 0, 1400) === 0 && P.bct(5, 4, 0) === 0);
})();

/* ---- 2. loads ------------------------------------------------------------ */
(function () {
  check("2a. 6 kg cases, 7 layers, single stack: the bottom case bears 6 x 6 = 36 kg", near(P.stackLoadKg(7, 6, 8, 0, 25), 36));
  check("2b. with one pallet on top (8 per layer, 25 kg tare): 36 + 7 x 6 + 25 / 8 = 81.125 kg", near(P.stackLoadKg(7, 6, 8, 1, 25), 81.125));
  check("2c. a single layer bears nothing on its own; two pallets on top double the top share", near(P.stackLoadKg(1, 6, 8, 0, 25), 0) && near(P.stackLoadKg(7, 6, 8, 2, 25), 36 + 2 * (42 + 3.125)));
})();

/* ---- 3. factors + safe layers ------------------------------------------- */
(function () {
  const f = P.stackFactor();
  check("3a. default factors: 50 % RH x 90 days under load x no overhang x aligned column = 1.0 x 0.6 x 1.0 x 1.0 = 0.6", near(f.factor, 0.6, 1e-12) && f.parts.humidity === 1 && f.parts.duration === 0.6 && f.parts.overhang === 1 && f.parts.pattern === 1);
  const worst = P.stackFactor({ humidity: "rh90", duration: "year", overhang: "mm25", pattern: "interlocked" });
  check("3b. the published derating options: 90 % RH 0.5, a year 0.5, 25 mm overhang 0.68, interlocked 0.5 -> 0.085; 85 % RH 0.6; column in practice 0.85", near(worst.factor, 0.5 * 0.5 * 0.68 * 0.5, 1e-12) &&
    P.STACK_FACTORS.humidity.options.rh85.value === 0.6 && P.STACK_FACTORS.pattern.options.misaligned.value === 0.85 && P.STACK_FACTORS.duration.options.d90.value === 0.6);
  check("3c. a numeric override is accepted; an unknown key falls back to the default", near(P.stackFactor({ humidity: 0.7 }).factor, 0.42, 1e-12) && near(P.stackFactor({ humidity: "nope" }).factor, 0.6, 1e-12));
  const b = P.bct(5, 4, 1400);
  const s = P.safeLayers(b, 6);
  check("3d. allowable = 2,197.85 x 0.6 = 1,318.71 N = 134.47 kg -> 22 cases above + 1 = 23 safe layers single-stacked", near(s.allowableN, 1318.71, 0.05) && near(s.allowableKg, 134.47, 0.01) && s.layers === 23, s.allowableKg.toFixed(2) + " kg, " + s.layers);
  const s1 = P.safeLayers(b, 6, null, { palletsOnTop: 1, casesPerLayer: 8, palletTareKg: 25 });
  check("3e. with one pallet on top: floor((134.47 + 6 - 3.125) / 12) = 11 safe layers", s1.layers === 11, String(s1.layers));
  check("3f. safe layers are monotone in ECT and in the factors", P.safeLayers(P.bct(3, 4, 1400), 6).layers < s.layers && P.safeLayers(b, 6, { humidity: "rh90" }).layers < s.layers && P.safeLayers(2 * b, 6).layers > s.layers);
})();

/* ---- 4. the pinwheel ------------------------------------------------------ */
(function () {
  const pin = P.fourBlock(1000, 1000, 600, 400);
  const bands = Math.max(P.bandDP(1000, 1000, 600, 400).count, P.bandDP(1000, 1000, 600, 400).count);
  const grid = Math.max(P.tiFor({ l: 1000, w: 1000 }, { l: 600, w: 400 }, false), P.tiFor({ l: 1000, w: 1000 }, { l: 600, w: 400 }, true));
  check("4a. 1000 x 1000 with a 600 x 400 case: grid 2, bands 3, four-block pinwheel 4 (one case per block, a 200 x 200 hole)", grid === 2 && bands === 3 && pin.count === 4 && pin.blocks === 4 && pin.hole.w === 200 && pin.hole.h === 200 && pin.hole.count === 0, grid + " / " + bands + " / " + pin.count);
  check("4b. the four rectangles never overlap and never leave the deck", pin.rects.length === 4 && overlapFree(pin.rects, 1000, 1000));
  const lay = P.bestLayer({ l: 1000, w: 1000, h: 144 }, { l: 600, w: 400, h: 300 });
  const rects = P.layerRects({ l: 1000, w: 1000 }, { l: 600, w: 400 }, lay);
  check("4c. bestLayer chooses the pinwheel there and layerRects draws its four cases", lay.pattern === "pinwheel" && lay.count === 4 && rects.length === 4 && overlapFree(rects, 1000, 1000));
  const t = P.tiHi({ id: "sq", label: "1000 x 1000", l: 1000, w: 1000, h: 144, tareKg: 25, maxLoadKg: 1500, trailerSlots: 0 }, { l: 600, w: 400, h: 300 }, 1800, 10);
  check("4d. tiHi on that pallet: 4 per layer x 5 layers = 20 cases, pattern pinwheel", t.ti === 4 && t.hi === 5 && t.cases === 20 && t.pattern === "pinwheel");
  check("4e. a case too big for the pallet gives no pinwheel; the degenerate all-zero combination is never reported as a pinwheel", P.fourBlock(500, 500, 600, 400).count === 0 && P.fourBlock(1200, 800, 400, 300).pattern === "pinwheel" && P.fourBlock(1200, 800, 400, 300).count <= 8);
})();

/* ---- 5. the ten profiles are unchanged ------------------------------------ */
(function () {
  const wins = [];
  let allOk = true;
  for (const id of Object.keys(P.PROFILES)) {
    const prof = P.PROFILES[id], box = P.BOXES[prof.box];
    for (const pid of ["eur", "ind", "half", "drum"]) {
      const pallet = P.PALLETS[pid];
      const lay = P.bestLayer(pallet, box);
      const grid = Math.max(P.tiFor(pallet, box, false), P.tiFor(pallet, box, true));
      const bands = Math.max(P.bandDP(pallet.l, pallet.w, box.l, box.w).count, P.bandDP(pallet.w, pallet.l, box.l, box.w).count);
      const pin = P.fourBlock(pallet.l, pallet.w, box.l, box.w).count;
      if (pin > Math.max(grid, bands)) wins.push(id + " on " + pid + ": pinwheel " + pin + " > " + Math.max(grid, bands));
      if (lay.pattern === "pinwheel" || lay.count !== Math.max(grid, bands)) allOk = false;
    }
  }
  check("5a. on every profile x pallet the layer is grid or bands and equals max(grid, bands) - the pinwheel wins nowhere (" + (wins.length ? wins.join("; ") : "none") + ")", allOk && wins.length === 0);
  check("5b. cases per pallet unchanged: e-commerce 48, automotive 25, grocery 56, pharma 144, bulky 15, tyres 24 declared",
    P.casesPerPallet(P.PROFILES.ecommerce) === 48 && P.casesPerPallet(P.PROFILES.automotive) === 25 && P.casesPerPallet(P.PROFILES["grocery-ambient"]) === 56 && P.casesPerPallet(P.PROFILES.pharma) === 144 && P.casesPerPallet(P.PROFILES.bulky) === 15 && P.casesPerPallet(P.PROFILES.tyres) === 24);
  const fix = JSON.parse(read("test/fixtures/run-ledger.json"));
  check("5c. the recorded fixture's pallet units still carry 48 cases per pallet; its profile block now names the board", fix.hus.filter((h) => h.cases_per_pallet != null).every((h) => h.cases_per_pallet === 48) && fix.profile.board && fix.profile.board.ectKNm === 5);
  const opt = P.optimizeProfile(P.PROFILES.ecommerce);
  check("5d. optimizeProfile still ranks industrial 60 over EUR 48 over half 24 for the e-commerce carton, none strength-limited at the defaults", opt.best.pallet === "ind" && opt.best.cases === 60 && opt.current.cases === 48 && opt.ranked.every((r) => r.strengthLimited === false && r.strength && r.strength.safeLayers >= r.hi));
  const limited = Object.keys(P.PROFILES).filter((id) => { const pr = P.PROFILES[id]; if (P.PALLETS[pr.pallet].fixed) return false; return P.tiHi(P.PALLETS[pr.pallet], P.BOXES[pr.box], pr.maxStackMm, pr.caseKg, pr.board).strengthLimited; });
  check("5e. at the default factors NO profile is strength-limited (the height or the load decides first) - the honest finding", limited.length === 0, limited.join(",") || "none");
  const damp = Object.keys(P.PROFILES).filter((id) => { const pr = P.PROFILES[id]; if (P.PALLETS[pr.pallet].fixed) return false; return P.tiHi(P.PALLETS[pr.pallet], P.BOXES[pr.box], pr.maxStackMm, pr.caseKg, pr.board, { humidity: "rh90", duration: "year" }).strengthLimited; });
  check("5f. at 90 % RH for a year the grocery tray (and only corrugated profiles) become strength-limited: " + damp.join(","), damp.indexOf("grocery-ambient") >= 0 && damp.every((id) => P.PROFILES[id].board && P.PROFILES[id].board.ectKNm > 0));
})();

/* ---- 6. tiHi with a board -------------------------------------------------- */
(function () {
  const eur = P.PALLETS.eur, box = P.BOXES["case-400x300x250"];
  const t = P.tiHi(eur, box, 1800, 6, P.PROFILES.ecommerce.board);
  check("6a. e-commerce carton on EUR: 8 x 6 = 48, height-limited, within the 23 layers the board allows; the bottom case bears 5 x 6 = 30 kg of 134.47 (22 %)",
    t.ti === 8 && t.hi === 6 && t.cases === 48 && !t.strengthLimited && !t.weightLimited && t.strength.safeLayers === 23 && near(t.strength.loadKg, 30) && near(t.strength.allowableKg, 134.47, 0.01) && near(t.strength.utilisation, 0.2231, 1e-3) && t.strength.inRange === true);
  const heavy = P.tiHi(eur, box, 1800, 40, { ectKNm: 3, caliperMm: 4 });
  check("6b. a 40 kg carton on ECT 3 board: the load limit allows 4 layers (32 cases) but the board allows 3 (80.68 kg / 40 = 2 above + 1) -> strength-limited to 24 cases",
    heavy.hi === 3 && heavy.cases === 24 && heavy.strengthLimited === true && heavy.weightLimited === true && heavy.strength.safeLayers === 3, heavy.hi + " layers, " + heavy.strength.allowableKg + " kg allowable");
  const none = P.tiHi(eur, box, 1800, 6, { evaluated: false, note: "x" });
  check("6c. a board marked not evaluated (or no board) gives no verdict and the v3.34 numbers", none.strength === null && none.strengthLimited === false && none.cases === 48 && P.tiHi(eur, box, 1800, 6).strength === null);
  const top = P.tiHi(eur, box, 1800, 6, P.PROFILES.ecommerce.board, null, { palletsOnTop: 1 });
  check("6d. with a pallet on top the safe layers fall to 11 (still above 6) and the bottom case bears 30 + 36 + 25/8 = 69.125 kg", top.hi === 6 && top.strength.safeLayers === 11 && near(top.strength.loadKg, 69.13, 0.01) && top.strength.palletsOnTop === 1);
  const cage = P.tiHi(P.PALLETS.cage, box, 1800, 6, P.PROFILES.ecommerce.board);
  check("6e. a fixed-capacity cage reports stackMm 0 and no strength (the v3.34 gap closed)", cage.fixed && cage.stackMm === 0 && cage.strength === null && cage.strengthLimited === false);
  const flat = P.tiHi(eur, { l: 1000, w: 300, h: 100 }, 1800, 6, { ectKNm: 5, caliperMm: 4 });
  check("6f. a case outside the formula's range (footprint 3.3 : 1, height < perimeter / 7) is flagged inRange false, not silently accepted", flat.strength && flat.strength.inRange === false);
})();

/* ---- 7. your case --------------------------------------------------------- */
(function () {
  const inp = { l: 400, w: 300, h: 250, kg: 6, ect: 5, caliper: 4, stackMm: 1800, palletsOnTop: 0, palletL: 0, palletW: 0, palletLoad: 1500, humidity: "rh50", duration: "d90", overhang: "none", pattern: "column" };
  const r = RL.yourCase(inp);
  check("7a. the e-commerce inputs rank industrial 60 (bands 10 x 6) first, EUR 48, half 24; every row carries the strength verdict", r && r.best.pallet === "ind" && r.best.cases === 60 && r.rows.map((x) => x.cases).join(",") === "60,48,24" && r.rows.every((x) => x.strength && x.strength.safeLayers === 23));
  const c = RL.yourCase(Object.assign({}, inp, { palletL: 1000, palletW: 1000, palletLoad: 1200 }));
  check("7b. a custom 1000 x 1000 pallet joins the ranking with its own pattern (bands 400 / 300 / 300 = 7 per layer)", c.rows.some((x) => x.pallet === "custom") && c.rows.find((x) => x.pallet === "custom").ti === 7 && c.rows.find((x) => x.pallet === "custom").pattern === "bands");
  const k = RL.yourCase(Object.assign({}, inp, { l: 600, w: 400, h: 300, kg: 10, palletL: 1000, palletW: 1000 }));
  check("7c. a 600 x 400 case on that custom pallet is the pinwheel (4 per layer)", k.rows.find((x) => x.pallet === "custom").pattern === "pinwheel" && k.rows.find((x) => x.pallet === "custom").ti === 4);
  const n = RL.yourCase(Object.assign({}, inp, { ect: 0 }));
  check("7d. ECT 0 means no strength check (no board); bad dimensions return an error", n.board === null && n.rows.every((x) => x.strength === null) && RL.yourCase(Object.assign({}, inp, { l: 0 })).error);
  const w = RL.yourCase(Object.assign({}, inp, { kg: 40, ect: 3 }));
  check("7e. the 40 kg / ECT 3 case: 3 layers on every pallet - strength-limited on EUR (load limit 4), the load limit already at 3 on the industrial and half pallets", w.rows.every((x) => x.hi === 3) && w.rows.find((x) => x.pallet === "eur").strengthLimited === true && w.rows.find((x) => x.pallet === "ind").weightLimited === true);
})();

/* ---- 8. shipped wiring ---------------------------------------------------- */
(function () {
  const html = read("run-ledger.html"), js = read("run-ledger.js"), sw = read("sw.js"), runall = read("test/run-all.mjs"), ledger = read("ledger.js"), pack = read("pack.js");
  check("8a. the viewer has the 'Your case' section and the strength verdict; the packaging section passes the board", /id="rlYourCase"/.test(html) && /function renderYourCase/.test(js) && /function strengthText/.test(js) && /P\.tiHi\(pallet, box, prof\.max_stack_mm, prof\.case_kg, board\)/.test(js));
  check("8b. the export's profile block carries the board", /board: rec\.profile\.board \|\| null/.test(ledger));
  check("8c. every profile declares a board (values or an honest 'not evaluated' note); the honesty text names McKee and the synthetic values", Object.keys(P.PROFILES).every((id) => P.PROFILES[id].board && (P.PROFILES[id].board.ectKNm > 0 || (P.PROFILES[id].board.evaluated === false && P.PROFILES[id].board.note))) && /McKee/.test(P.HONESTY) && /SYNTHETIC/.test(P.HONESTY) && /not a certification/.test(P.HONESTY));
  check("8d. sw.js at wt-v145 (previously wt-v144)", /CACHE_VERSION\s*=\s*"wt-v145"/.test(sw) && /Previously wt-v144/.test(sw));
  check("8e. test/run-all.mjs lists this harness", /verify_stacking\.js/.test(runall));
  check("8f. no Date / Math.random CALL in pack.js; Steudel and McKee cited in the source", !/new Date\(|Date\.now\(|Math\.random\(/.test(pack) && /Steudel \(1979\)/.test(pack) && /McKee, Gander & Wachuta, 1963/.test(pack));
})();

/* ---- 8. v3.47 board grades: the certificate classes, exact conversion, approximate calipers ---- */
(function () {
  const K = P.LBF_PER_IN_TO_KN_PER_M, ids = Object.keys(P.BOARDS);
  const fixA = JSON.parse(fs.readFileSync(path.join(__dirname, "test", "fixtures", "run-ledger.json"), "utf8"));
  check("8a. 1 lbf/in = 4.4482216152605 N / 25.4 mm = 0.175127 kN/m (exact definitions); 32 ECT = 32 x K = 5.6041 kN/m",
    near(K, 0.175127, 5e-7) && K === 4.4482216152605 / 25.4 && P.BOARDS.ect32.ectKNm === 32 * K && near(P.BOARDS.ect32.ectKNm, 5.6041, 5e-5), K.toFixed(9));
  check("8b. twelve classes 23..90 lbf/in in strictly increasing order, each computed (never typed), each with wall, flute, a positive caliper and the source",
    ids.length === 12 && ids[0] === "ect23" && ids[11] === "ect90" && ids.every((k, i) => i === 0 || P.BOARDS[k].ectKNm > P.BOARDS[ids[i - 1]].ectKNm) &&
    ids.every((k) => P.BOARDS[k].ectKNm === P.BOARDS[k].ectLbIn * K && P.BOARDS[k].wall && P.BOARDS[k].flute && P.BOARDS[k].caliperMm > 0 && P.BOARDS[k].source === P.BOARD_SOURCE && /approximate/.test(P.BOARDS[k].caliperNote)));
  check("8c. the source says what it is: certificate classes, exact conversion, calipers as commonly listed - not a supplier specification", /not a supplier specification/.test(P.BOARD_SOURCE) && /exact/.test(P.BOARD_SOURCE));
  check("8d. nearestGrade: the synthetic 5 kN/m sits nearest 29 ECT (5.08), 4 nearest 23, 6 nearest 32 (5.60) over 40 (7.01), 9 nearest 51 (8.93)",
    P.nearestGrade(5).id === "ect29" && P.nearestGrade(4).id === "ect23" && P.nearestGrade(6).id === "ect32" && P.nearestGrade(9).id === "ect51" && P.nearestGrade(100).id === "ect90");
  const base = { l: 400, w: 300, h: 250, kg: 5, ect: "", caliper: "", stackMm: 1800, palletsOnTop: 0, humidity: "rh50", duration: "d90", overhang: "none", pattern: "column" };
  const byGrade = RL.yourCase(Object.assign({}, base, { grade: "ect32" })), explicit = RL.yourCase(Object.assign({}, base, { grade: "ect32", ect: 5, caliper: 4 })), none = RL.yourCase(base);
  check("8e. Your case: a grade fills blank board inputs (32 ECT -> 5.6041 kN/m, 4 mm), explicit values win over the grade, no grade and no values = no strength check",
    byGrade.grade === "ect32" && near(byGrade.board.ectKNm, 5.6041, 5e-5) && byGrade.board.caliperMm === 4 && byGrade.rows.every((x) => x.strength) &&
    explicit.board.ectKNm === 5 && explicit.board.caliperMm === 4 && explicit.grade === "ect32" && none.board === null && none.grade === null);
  check("8f. the profiles' board values are untouched (fixture A still carries ECT 5, caliper 4) - the grade link is derived, never stored",
    P.PROFILES.ecommerce.board.ectKNm === 5 && !("grade" in P.PROFILES.ecommerce.board) && fixA.profile.board.ectKNm === 5 && Object.keys(fixA.profile.board).join(",") === "ectKNm,caliperMm,note");
})();

console.log("=".repeat(72));
console.log(fail === 0 ? "ALL STACKING CHECKS PASSED (" + pass + ")" : fail + " FAILED, " + pass + " passed");
process.exit(fail === 0 ? 0 : 1);
