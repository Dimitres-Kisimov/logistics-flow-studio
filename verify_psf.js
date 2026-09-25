/* =====================================================================
 * verify_psf.js - v3.67 THE REST OF SPAR-H: four more levers, one refusal,
 * and the method's own arithmetic. Run: node verify_psf.js
 * ---------------------------------------------------------------------
 * v3.54 shipped three performance-shaping levers on the error what-if and
 * the deep dive recorded the other five of SPAR-H's eight as documented
 * only. This harness checks what v3.67 did with them:
 *
 *   1. SEVEN LEVERS AND ONE REFUSAL: four more - workplace stressors,
 *      task complexity, procedures, work processes - each clamped to the
 *      levels SPAR-H publishes on its ACTION worksheet, each naming one
 *      method and one factor. Fitness for duty is refused, in the module,
 *      with the reason and the definition that forces it.
 *   2. THE METHOD'S OWN ARITHMETIC, BY HAND: SPAR-H's adjustment factor
 *      (NUREG/CR-6883, action worksheet part C) replaces the product once
 *      three or more levers stand above nominal. Checked on the standard's
 *      own worked example: composite 400 on a nominal 0.01 gives 0.801603
 *      where the plain product gives 4 - not a probability, which is why
 *      the method has the formula. Below three negatives, the product.
 *   3. THE CLAMPS: each lever into its own [min, max]; a credit below 1
 *      only where the method publishes one (ergonomics good, training
 *      high, work processes good), so a floor can now model a poka-yoke
 *      and not only a hazard.
 *   4. ABSENT BY DEFAULT: without the what-if the run is byte for byte
 *      fixture A; with the what-if and every lever at nominal the run id
 *      equals the one with no levers named at all - so the lever set can
 *      grow again without moving a single recorded run.
 *   5. WHAT IS RECORDED: composite, the count above nominal, whether the
 *      adjustment applied and its text, the credits, and the refusal -
 *      all in the export, so a reader sees what shaped the shares.
 *   6. ON THE HAND FLOOR: a negative context and a good design, measured.
 *   7. HONESTY AND WIRING: no clock, no roster, the tower's arithmetic
 *      through the same combiner, the knowledge base, the docs, wt-v148.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "people.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js", "knowledge.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, I = global.WT.ids, P = global.WT.pack, A = global.WT.analytics, KB = global.WT.kb;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}
const FLOOR = {
  gridW: 40, gridH: 24, cell: 1,
  elements: [
    { id: "in", type: "dock-in", x: 2, y: 0, w: 2, d: 1 }, { id: "stg", type: "staging", x: 14, y: 2, w: 4, d: 2 },
    { id: "qc", type: "qc-bench", x: 6, y: 2, w: 3, d: 2 }, { id: "dep", type: "depalletiser", x: 10, y: 2, w: 3, d: 3 },
    { id: "ret", type: "returns-station", x: 30, y: 2, w: 3, d: 2 }, { id: "rack", type: "selective-racking", x: 4, y: 8, w: 20, d: 1 },
    { id: "face", type: "carton-flow", x: 4, y: 12, w: 12, d: 1 }, { id: "belt", type: "conveyor", x: 4, y: 15, w: 14, d: 1 },
    { id: "pack", type: "pack-station", x: 20, y: 18, w: 3, d: 2 }, { id: "wrap", type: "stretch-wrap", x: 24, y: 18, w: 2, d: 2 },
    { id: "vas", type: "vas-station", x: 28, y: 18, w: 3, d: 2 }, { id: "out", type: "dock-out", x: 30, y: 23, w: 2, d: 1 },
  ],
};
const MIX = R.defaultMix();
function record(opts, ticks) {
  const plan = F.spawnPlan(FLOOR, opts);
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: opts.seed, mix: opts.mix, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  let left = ticks;
  while (left > 0) { const d = Math.min(600, left); F.step(st, d); left -= d; }
  return { plan: plan, st: st, rec: rec, exp: L.exportJson(rec) };
}

/* ---- 1. seven levers and one refusal ------------------------------------------------- */
(function () {
  const keys = Object.keys(R.PSF);
  const NEW = { stressors: [1, 5], complexity: [1, 5], procedures: [1, 50], workProcesses: [0.5, 5] };
  check("1a. seven levers in a fixed order - the three of v3.54 and the four of v3.67; each names a factor, a source, its published levels and its own [min, max]",
    keys.join(",") === "timePressure,signalToNoise,familiarity,stressors,complexity,procedures,workProcesses" &&
    keys.every((k) => { const d = R.PSF[k]; return d.label && d.factor && d.source && d.levels && typeof d.min === "number" && typeof d.max === "number" && d.min <= 1 && d.max >= 1; }),
    keys.join(", "));
  check("1b. the four new levers carry SPAR-H's ACTION-worksheet levels: stressors x2 / x5, complexity x2 / x5, procedures x5 / x20 / x50, work processes x5 with a x0.5 credit",
    Object.keys(NEW).every((k) => R.PSF[k].min === NEW[k][0] && R.PSF[k].max === NEW[k][1] && /SPAR-H/.test(R.PSF[k].source) && /NUREG\/CR-6883/.test(R.PSF[k].source)) &&
    /High x2, Extreme x5/.test(R.PSF.stressors.source) && /Moderately complex x2, Highly complex x5/.test(R.PSF.complexity.source) &&
    /Available but poor x5, Incomplete x20, Not available x50/.test(R.PSF.procedures.source) && /Poor x5, Nominal x1, Good x0.5/.test(R.PSF.workProcesses.source));
  check("1c. stressors is taken in SPAR-H's OWN environmental reading and says so: the workplace (heat, noise, ventilation), never a claim about what a person feels",
    /environmental/i.test(R.PSF.stressors.factor) && /excessive heat, noise, poor ventilation/.test(R.PSF.stressors.source) &&
    /renamed from Stress to Stressors/.test(R.PSF.stressors.source) && /never a state of mind/.test(R.PSF.stressors.source) && /cold store/.test(R.PSF.stressors.label));
  check("1d. complexity, procedures and work processes quote the definition that makes them a property of the step or the organisation, not of a person",
    /difficult the task is to perform in the given context/.test(R.PSF.complexity.source) &&
    /existence and use of formal operating procedures/.test(R.PSF.procedures.source) &&
    /work planning, communication/.test(R.PSF.workProcesses.source) && /not of a person/.test(R.PSF.workProcesses.source));
  const nm = R.PSF_NOT_MODELLED;
  check("1e. the eighth factor is refused IN THE MODULE, with SPAR-H's own definition ('factors associated with individuals'), the legal reason, and the pointer to the fatigue curve that does belong to a shift",
    Array.isArray(nm) && nm.length === 1 && nm[0].factor === "Fitness for duty" && !("fitnessForDuty" in R.PSF) && !("fitness" in R.PSF) &&
    /factors associated with individuals/.test(nm[0].definition) && /Degraded fitness x5/.test(nm[0].published) &&
    /BetrVG 87\(1\)6/.test(nm[0].refused) && /GDPR Art. 9/.test(nm[0].refused) && /v3.66/.test(nm[0].refused) && /staggered/.test(nm[0].refused));
  check("1f. the two methods are not silently blended: the module says the three HEART maxima and the four SPAR-H maxima sit in one product by this app's choice, and that the two disagree",
    /Multiplying values from two methods is this app's own choice/.test(read("routing.js")) && /SPAR-H's ergonomics reaches x50/.test(read("routing.js")) &&
    /HEART/.test(R.PSF.timePressure.source) && /SPAR-H/.test(R.PSF.stressors.source));
})();

/* ---- 2. SPAR-H's adjustment factor, by hand ------------------------------------------ */
(function () {
  // NUREG/CR-6883, action worksheet part C: "When 3 or more negative PSF influences are present,
  // in lieu of the equation above, you must compute a composite PSF score used in conjunction with
  // the adjustment factor."   HEP = NHEP x composite / (NHEP x (composite - 1) + 1)
  const ex1 = R.applyLevers(0.01, { procedures: 20, signalToNoise: 10, stressors: 2 }, 1);
  const byHand = (0.01 * 400) / (0.01 * (400 - 1) + 1); // 4 / 4.99
  check("2a. the standard's own worked example: composite 400 (procedures x20, signal-to-noise x10, stressors x2) on a nominal 0.01 gives 0.801603 - where the plain product gives 4, which is not a probability",
    ex1.composite === 400 && ex1.negatives === 3 && ex1.adjusted === true && ex1.raw === 0.801603 && Math.abs(byHand - 0.8016032064128257) < 1e-15 && 0.01 * 400 === 4,
    "4 / 4.99 = " + byHand.toFixed(6) + "; the published example prints 0.81, which is a rounding in the document - the formula as published gives 0.8016, and the formula is what is implemented");
  const two = R.applyLevers(0.02, { complexity: 2, procedures: 5 }, 0.5);
  const three = R.applyLevers(0.02, { stressors: 2, complexity: 2, procedures: 5 }, 0.5);
  check("2b. the worksheet's trigger is a COUNT, not a size: two levers at composite 10 keep the plain product (0.2); a third at composite 20 turns the adjustment on and declares 0.289855, not 0.4",
    two.negatives === 2 && two.adjusted === false && two.raw === 0.2 && two.effective === 0.2 &&
    three.negatives === 3 && three.adjusted === true && three.composite === 20 && three.raw === 0.289855 && 0.02 * 20 === 0.4);
  const huge = R.applyLevers(0.02, { timePressure: 11, signalToNoise: 10, familiarity: 17, procedures: 50 }, 1);
  check("2c. the formula cannot reach 1, which is the reason the method has it: four levers at composite 93500 still land below 1, and the app's cap is a separate and cruder limit that binds afterwards",
    huge.composite === 93500 && huge.adjusted === true && huge.raw < 1 && huge.raw > 0.99 &&
    R.applyLevers(0.02, { timePressure: 11, signalToNoise: 10, familiarity: 17, procedures: 50 }, 0.5).effective === 0.5 &&
    R.applyLevers(0.02, { timePressure: 11, signalToNoise: 10, familiarity: 17, procedures: 50 }, 0.5).capped === true,
    "raw " + huge.raw);
  check("2d. credits are not negatives: three levers BELOW nominal leave the plain product (0.5 x 0.5 x 0.5 = 0.125 of the declared share), because the worksheet counts only multipliers above 1",
    R.applyLevers(0.02, { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 }, 0.5).adjusted === false &&
    R.applyLevers(0.02, { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 }, 0.5).composite === 0.125 &&
    R.applyLevers(0.02, { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 }, 0.5).effective === 0.0025 &&
    R.applyLevers(0.02, { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 }, 0.5).credits === 3);
  check("2e. the adjustment's text names the standard, the worksheet part, the trigger and the order of the two limits",
    /NUREG\/CR-6883/.test(R.SPARH_ADJUSTMENT) && /part C/.test(R.SPARH_ADJUSTMENT) && /three or more/.test(R.SPARH_ADJUSTMENT) &&
    /cap binds afterwards/.test(R.SPARH_ADJUSTMENT) && /Below three negative levers the plain product applies/.test(R.SPARH_ADJUSTMENT));
  check("2f. the module records which rule the app follows where the standard is inconsistent: its worksheet says three or more NEGATIVE factors, its body text applies the same formula to an all-positive example",
    /worksheet/.test(read("docs/PSF_LEVERS.md")) && /body text/.test(read("docs/PSF_LEVERS.md")) && /worksheet rule/.test(read("docs/PSF_LEVERS.md")));
})();

/* ---- 3. the clamps ------------------------------------------------------------------- */
(function () {
  const n = R.normalizeErrors({ "mis-pick": 0.02, psf: { timePressure: 0.5, signalToNoise: 0.1, familiarity: 99, stressors: 9, complexity: 0, procedures: 500, workProcesses: 0.2 } });
  check("3a. every lever is clamped into its OWN range: time pressure has no published credit so 0.5 -> 1; signal-to-noise 0.1 -> 0.5; familiarity 99 -> 17; stressors 9 -> 5; complexity 0 (invalid) -> 1; procedures 500 -> 50; work processes 0.2 -> 0.5",
    n.psf.timePressure === 1 && n.psf.signalToNoise === 0.5 && n.psf.familiarity === 17 && n.psf.stressors === 5 &&
    n.psf.complexity === 1 && n.psf.procedures === 50 && n.psf.workProcesses === 0.5);
  check("3b. a lever left out, or given a value that is not a positive number, is nominal - never an error and never a guess",
    JSON.stringify(R.normalizeErrors({ "mis-pick": 0.02 }).psf) === JSON.stringify({ timePressure: 1, signalToNoise: 1, familiarity: 1, stressors: 1, complexity: 1, procedures: 1, workProcesses: 1 }) &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: "x" } }).psf.complexity === 1 &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: NaN } }).psf.complexity === 1 &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: -3 } }).psf.complexity === 1);
  const good = R.normalizeErrors({ "mis-pick": 0.02, psf: { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 } });
  check("3c. the levers above nominal are the latent conditions and those below are the credits, named separately - so a floor can be declared BETTER than nominal and not only worse (a scan verification, a trained crew, a clean handover)",
    JSON.stringify(good.latent) === "[]" && JSON.stringify(good.credit) === '["signalToNoise","familiarity","workProcesses"]' &&
    JSON.stringify(R.normalizeErrors({ "mis-pick": 0.02, psf: { stressors: 2, workProcesses: 0.5 } }).latent) === '["stressors"]' &&
    JSON.stringify(R.normalizeErrors({ "mis-pick": 0.02, psf: { stressors: 2, workProcesses: 0.5 } }).credit) === '["workProcesses"]');
  check("3d. `multiplier` still means the product of all seven and still equals the composite, so v3.54's readings of it hold: one lever at x11 is 11, two at x17 and x11 are 187",
    R.normalizeErrors({ "mis-pick": 0.02, psf: { timePressure: 11 } }).multiplier === 11 &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { familiarity: 17, timePressure: 11 } }).multiplier === 187 &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { familiarity: 17, timePressure: 11 } }).composite === 187 &&
    R.normalizeErrors({ "mis-pick": 0.02 }).multiplier === 1 && R.normalizeErrors({ "mis-pick": 0.02 }).kinds[0].effective === 0.02);
})();

/* ---- 4. absent by default, and the nominal-lever property ----------------------------- */
(function () {
  const plain = record({ seed: 31, mix: MIX }, 300);
  check("4a. without the what-if the 300-tick export is byte for byte fixture A and the hand floor still records its own run id",
    JSON.stringify(plain.exp, null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) &&
    plain.exp.run.id === "RUN-hand-built-s31-hc28a7688" && !("errors" in plain.plan));
  const bare = R.normalizeErrors({ "mis-pick": 0.02 });
  const nominal = R.normalizeErrors({ "mis-pick": 0.02, psf: { stressors: 1, complexity: 1, procedures: 1, workProcesses: 1, timePressure: 1, signalToNoise: 1, familiarity: 1 } });
  const lever = R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: 2 } });
  check("4b. a lever at nominal never enters the run id: naming all seven at 1 hashes exactly as naming none - which is what let the set grow from three to seven without moving a recorded run",
    I.inputHash(FLOOR, 31, MIX, null, null, bare) === I.inputHash(FLOOR, 31, MIX, null, null, nominal) &&
    I.inputHash(FLOOR, 31, MIX, null, null, lever) !== I.inputHash(FLOOR, 31, MIX, null, null, bare) &&
    I.inputHash(FLOOR, 31, MIX) !== I.inputHash(FLOOR, 31, MIX, null, null, bare));
  check("4c. a lever that moves changes the id, and two different lever sets with the same effective share are still told apart (the levers enter as named pairs, not as a product)",
    I.inputHash(FLOOR, 31, MIX, null, null, R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: 2 } })) !==
    I.inputHash(FLOOR, 31, MIX, null, null, R.normalizeErrors({ "mis-pick": 0.02, psf: { stressors: 2 } })) &&
    R.normalizeErrors({ "mis-pick": 0.02, psf: { complexity: 2 } }).kinds[0].effective === R.normalizeErrors({ "mis-pick": 0.02, psf: { stressors: 2 } }).kinds[0].effective);
})();

/* ---- 5. what is recorded -------------------------------------------------------------- */
(function () {
  const spec = { "mis-pick": 0.02, psf: { stressors: 2, complexity: 2, procedures: 5 } };
  const run = record({ seed: 31, mix: MIX, errors: spec }, 600);
  const e = run.exp.run.errors;
  check("5a. the export carries the shape of the context, not only its result: the composite, how many levers stand above nominal, that the adjustment applied, and its text",
    e.composite === 20 && e.negatives === 3 && e.adjusted === true && /NUREG\/CR-6883/.test(e.adjustment) &&
    e.kinds[0].share === 0.02 && e.kinds[0].effective === 0.289855 && JSON.stringify(e.latent) === '["stressors","complexity","procedures"]',
    "composite " + e.composite + ", declared " + e.kinds[0].effective + " where the plain product would declare 0.4");
  check("5b. the refusal travels with the run: every export that used the what-if carries the eighth factor, its definition and why it is not a lever",
    Array.isArray(e.not_modelled) && e.not_modelled[0].factor === "Fitness for duty" && /factors associated with individuals/.test(e.not_modelled[0].definition) &&
    /BetrVG/.test(e.not_modelled[0].refused));
  check("5c. the recorded honesty names the seven levers, the adjustment factor, the refusal and the person it is never about",
    /Seven/.test(e.honesty) && /adjustment factor/.test(e.honesty) && /fitness for duty, is refused/i.test(e.honesty) &&
    /never a person/.test(e.honesty) && /BetrVG/.test(e.honesty) && /GDPR/.test(e.honesty) && /teaching values/.test(e.honesty));
  const nul = R.normalizeErrors({ "mis-pick": 0.02 });
  check("5d. a run whose levers are all nominal records no adjustment and no credit - the block says plainly that nothing shaped the share",
    nul.adjusted === false && nul.adjustment === null && JSON.stringify(nul.credit) === "[]" && nul.negatives === 0 && nul.composite === 1);
})();

/* ---- 6. on the hand floor -------------------------------------------------------------- */
(function () {
  const neg = record({ seed: 31, mix: MIX, errors: { "mis-pick": 0.02, psf: { stressors: 2, complexity: 2, procedures: 5 } } }, 600);
  const q = {};
  for (const row of L.stats(neg.rec).quality) q[row.op] = row;
  check("6a. a negative context on the hand floor, 600 ticks (cold store, mixed pallets, a procedure that is available but poor): the picks err and the verification steps appear",
    q["case-pick"].errors === 1 && q["case-pick"].units_through === 3 && q.pick.errors === 2 && q.pick.units_through === 7 &&
    q["pallet-pick"].errors === 1 && q["pallet-pick"].units_through === 2 && q["verify-pick"].units_through === 4 && q["verify-pick"].errors === 0,
    "pick FPY " + q.pick.first_pass_yield + ", case-pick " + q["case-pick"].first_pass_yield + ", four verifications");
  const good = record({ seed: 31, mix: MIX, errors: { "mis-pick": 0.02, psf: { signalToNoise: 0.5, familiarity: 0.5, workProcesses: 0.5 } } }, 600);
  const gq = L.stats(good.rec).quality.filter((r) => /pick$/.test(r.op));
  check("6b. the same floor with the three published credits declares 0.0025 instead of 0.02 and, over the same 600 ticks, no pick errs - the first design the levers have been able to describe as GOOD",
    good.exp.run.errors.kinds[0].effective === 0.0025 && gq.length > 0 && gq.every((r) => r.errors === 0 && r.first_pass_yield === 1),
    gq.map((r) => r.op + " " + r.units_through).join(", "));
  check("6c. the run id differs from the plain run's and from the negative context's; neither run is the hand floor's own",
    neg.exp.run.id !== good.exp.run.id && neg.exp.run.id !== "RUN-hand-built-s31-hc28a7688" && good.exp.run.id !== "RUN-hand-built-s31-hc28a7688" &&
    /^RUN-hand-built-s31-h[0-9a-f]{8}$/.test(neg.exp.run.id));
})();

/* ---- 7. honesty and wiring -------------------------------------------------------------- */
(function () {
  const src = read("routing.js"), ctl = read("control.js"), app = read("app.js"), ask = read("ask.js");
  const block = src.slice(src.indexOf("THE PERFORMANCE-SHAPING LEVERS"), src.indexOf("function normalizeErrors"));
  check("7a. the lever block reads no clock, no roster and no worker module, and takes nothing from the app's illustrative staffing figures",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(block) && !/WT\.workers|\broster\b|workerRoster|workers\.sample/i.test(block));
  check("7b. the control tower quotes what the re-run would declare: its expected effect goes through routing's own combiner, so the adjustment dropping away is part of the arithmetic it shows",
    /WT\.routing\.applyLevers/.test(ctl) && /const alt = Object\.assign\(\{\}, errors\.psf\)/.test(ctl) &&
    R.applyLevers(0.02, { stressors: 2, complexity: 2, procedures: 1 }, 0.5).adjusted === false &&
    R.applyLevers(0.02, { stressors: 2, complexity: 2, procedures: 1 }, 0.5).effective === 0.08);
  check("7c. the knowledge base holds all seven levers at nominal with the module's own bounds, and the four new ones carry SPAR-H's note",
    Object.keys(R.PSF).every((k) => KB.get("hf.psf." + k) === 1 && KB.entry("hf.psf." + k).min === R.PSF[k].min && KB.entry("hf.psf." + k).max === R.PSF[k].max) &&
    ["stressors", "complexity", "procedures", "workProcesses"].every((k) => /SPAR-H/.test(KB.entry("hf.psf." + k).source) && /never to a person/.test(KB.entry("hf.psf." + k).note) && /fitness for duty, is refused/i.test(KB.entry("hf.psf." + k).note)) &&
    KB.list("human-factors").length === 11);
  check("7d. the app reads all seven levers from the knowledge base and says in the readout when the adjustment applied and which levers earned a credit; the ask panel lists them",
    /hf\.psf\.stressors/.test(app) && /hf\.psf\.complexity/.test(app) && /hf\.psf\.procedures/.test(app) && /hf\.psf\.workProcesses/.test(app) &&
    /SPAR-H's adjustment factor applies/.test(app) && /\(credit\)/.test(app) && /hf\.psf\.workProcesses/.test(ask));
  const doc = read("docs/PSF_LEVERS.md");
  check("7e. docs/PSF_LEVERS.md gives the eight factors with their published levels, the refusal with its reason, the adjustment factor with the standard's worked example, and the warning that two methods are multiplied",
    /Fitness for duty/.test(doc) && /NUREG\/CR-6883/.test(doc) && /0.801603|0\.8016/.test(doc) && /BetrVG/.test(doc) && /two methods/i.test(doc) && /poka-yoke/.test(doc));
  const deep = read(path.join("docs", "DIGITAL_TWIN_DEEP_DIVE.md"));
  check("7f. the deep dive's chapter 5.3 no longer says the five are documented only, and corrects itself where it had lumped stressors in with fitness for duty",
    /v3.67/.test(deep) && /PSF_LEVERS.md/.test(deep) && !/Three of the eight become editable multipliers in the knowledge base \(R20\); the other five are documented and not modelled/.test(deep));
  check("7g. shipped: the runner lists this harness, the service worker is at wt-v148 (previously wt-v147), README and CHANGELOG carry v3.67",
    /verify_psf\.js/.test(read(path.join("test", "run-all.mjs"))) && /wt-v148/.test(read("sw.js")) && /Previously wt-v147/.test(read("sw.js")) &&
    /v3\.67/.test(read("README.md")) && /## v3\.67/.test(read("CHANGELOG.md")));
})();

console.log("=".repeat(72));
if (fail) { console.log("FAILED " + fail + " of " + (pass + fail)); process.exit(1); }
console.log("ALL PERFORMANCE-SHAPING-FACTOR CHECKS PASSED (" + pass + ")");
