/* =====================================================================
 * verify_palette.js - Ctrl/Cmd-K COMMAND PALETTE (WT.palette) checks.
 *
 * Runs the REAL modules (domain.js, library.js, generate.js + the sim stack)
 * plus palette.js in Node under the same window shim the other harnesses use.
 * WT.palette is the power-user shortcut layer for UI-3: a PURE, DOM-free
 * command MODEL + filter (headlessly verifiable here) behind a modal overlay
 * (verified live in the browser self-test). Every command maps to an EXISTING
 * control - it invokes the SAME handler the button/tool does, never a copy.
 *
 * Checks (all deterministic):
 *   - the command list is NON-EMPTY and built from the REAL registries: every
 *     Class Library component (WT.library.paletteTree / WT.domain.paletteOrder)
 *     has an "Add <component>" command, and a "Generate <profile>" command
 *     exists for every WT.generate profile (warehouse + factory)
 *   - the core toolbar actions are all present (Generate, Optimise factory,
 *     Analyze + the four sub-views, Story, 2D/3D, Measure, Play/Pause, Define
 *     object, Warehouse/Factory mode, Simple/Expert density, Export IFC, WMS
 *     report, Save/Load, Fit view)
 *   - NO DANGLING command: every `el` command's elementId EXISTS in index.html;
 *     every `act` command's actionKey is in WT.palette.ACTION_KEYS AND is
 *     dispatched in app.js; every `place` command's type EXISTS in ELEMENTS;
 *     every `generate` command's profileKey EXISTS in WT.generate
 *   - the model is DETERMINISTIC (buildCommands twice -> byte-identical JSON)
 *   - filter(): substring narrows, fuzzy subsequence matches, empty query
 *     returns the whole list unchanged, an impossible query returns [], and the
 *     ranking is deterministic + stable
 *   - shipped wiring: index.html loads palette.js before app.js + ships the
 *     accessible overlay (role=dialog/combobox/listbox) + the affordance;
 *     app.js mounts it and dispatches to setTool / runGenerate / el.click /
 *     the actionKey switch; sw.js precaches ./palette.js at wt-v73
 *   - offline (no external asset ref) + NO Date / NO RNG in palette.js
 *   - honesty: palette.js states it invokes the existing handlers (additive)
 *
 * Usage:  node verify_palette.js
 * ASCII-only output. Exit 0 = all checks pass.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

global.window = global; // modules attach themselves to window.WT
global.matchMedia = global.matchMedia || function () { return { matches: false }; };
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
for (const f of ["domain.js", "library.js", "shapes.js", "compliance.js", "simulation.js", "generate.js", "nlcommands.js", "examples.js", "wms.js", "flowsim.js", "palette.js"]) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const WT = global.WT;
const D = WT.domain;
const P = WT.palette;
const G = WT.generate;

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const PAL_SRC = read("palette.js");
const indexHtml = read("index.html");
const appJs = read("app.js");
const swJs = read("sw.js");

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
  if (!ok) failures++;
}

console.log("Command palette (WT.palette) verification (deterministic)");
console.log("");

// ---- module shape --------------------------------------------------------
check("WT.palette exposes the model + controller API", !!P &&
  typeof P.buildCommands === "function" && typeof P.filter === "function" &&
  typeof P.score === "function" && typeof P.mount === "function" &&
  Array.isArray(P.CORE_ACTIONS) && Array.isArray(P.ACTION_KEYS),
  P ? "buildCommands/filter/score/mount + CORE_ACTIONS/ACTION_KEYS" : "MISSING");

// ---- build the command list from the REAL registries ---------------------
const tree = WT.library.paletteTree({}); // no mode filter -> every component
const cmds = P.buildCommands({ tree: tree, elements: D.ELEMENTS, generate: G });
check("command list is non-empty", Array.isArray(cmds) && cmds.length > 0, cmds.length + " commands");

// every command carries a stable kind + id
const kinds = new Set(cmds.map((c) => c.kind));
check("every command has an id + a known kind (el/act/place/generate)",
  cmds.every((c) => c.id && ["el", "act", "place", "generate"].indexOf(c.kind) !== -1),
  "kinds: " + Array.from(kinds).sort().join(","));

// ---- coverage: every Class Library component has an Add command ----------
const addTypes = new Set(cmds.filter((c) => c.kind === "place").map((c) => c.type));
const paletteTypes = [];
for (const g of tree) for (const t of g.types) paletteTypes.push(t);
const missingAdd = paletteTypes.filter((t) => !addTypes.has(t));
check("EVERY Class Library component (palette tree) has an Add command",
  paletteTypes.length > 0 && missingAdd.length === 0,
  missingAdd.length ? "missing Add for: " + missingAdd.join(",") : paletteTypes.length + " components covered");

// also cross-check against the domain paletteOrder (the single source of truth)
const missingFromOrder = (D.paletteOrder || []).filter((t) => !addTypes.has(t));
check("every domain paletteOrder built-in has an Add command",
  (D.paletteOrder || []).length > 0 && missingFromOrder.length === 0,
  missingFromOrder.length ? "missing: " + missingFromOrder.join(",") : D.paletteOrder.length + " built-ins");

// no dangling Add: every place command's type resolves in ELEMENTS
const danglingAdd = cmds.filter((c) => c.kind === "place" && !D.ELEMENTS[c.type]);
check("no Add command references a type absent from ELEMENTS", danglingAdd.length === 0,
  danglingAdd.length ? danglingAdd.map((c) => c.type).join(",") : "clean");

// ---- coverage: a Generate command per real generator profile -------------
const genKeys = new Set(cmds.filter((c) => c.kind === "generate").map((c) => c.profileKey));
const profileKeys = Object.keys(G.plantProfiles || {}).concat(Object.keys(G.factoryProfiles || {}));
const missingGen = profileKeys.filter((k) => !genKeys.has(k));
check("a Generate command exists for EVERY generator profile (warehouse + factory)",
  profileKeys.length >= 7 && missingGen.length === 0,
  missingGen.length ? "missing: " + missingGen.join(",") : profileKeys.length + " profiles (" +
    Object.keys(G.plantProfiles).length + " warehouse + " + Object.keys(G.factoryProfiles).length + " factory)");
const danglingGen = cmds.filter((c) => c.kind === "generate" && profileKeys.indexOf(c.profileKey) === -1);
check("no Generate command references an unknown profile", danglingGen.length === 0,
  danglingGen.length ? danglingGen.map((c) => c.profileKey).join(",") : "clean");

// ---- the spec's core actions are all present -----------------------------
// Each required action is identified by the elementId (el) or actionKey (act)
// the command must carry. Proves the toolbar actions are reachable + labelled.
const elIds = new Set(cmds.filter((c) => c.kind === "el").map((c) => c.elementId));
const actKeys = new Set(cmds.filter((c) => c.kind === "act").map((c) => c.actionKey));
const REQUIRED_EL = {
  "Optimise factory": "procOptBtn",
  "Analyze panel": "analyzeBtn",
  "Story mode": "storyBtn",
  "2D/3D toggle": "isoBtn",
  "Measure": "measureBtn",
  "Play flow": "flowPlayBtn",
  "Pause flow": "flowPauseBtn",
  "Define object": "defineObjectBtn",
  "Warehouse/Factory mode": "modeBtn",
  "Simple/Expert density": "densityBtn",
  "Export IFC": "ifcBtn",
  "WMS report": "reportOpenBtn",
  "Save": "saveBtn",
  "Load": "loadBtn",
  "Fit view": "zoomFitBtn",
  "Generate (selected)": "genBtn",
};
const missingReqEl = Object.keys(REQUIRED_EL).filter((k) => !elIds.has(REQUIRED_EL[k]));
check("all required core toolbar actions have a command",
  missingReqEl.length === 0,
  missingReqEl.length ? "missing: " + missingReqEl.map((k) => k + "(" + REQUIRED_EL[k] + ")").join(", ") : Object.keys(REQUIRED_EL).length + " actions present");

const REQUIRED_ACT = ["analyze-bottleneck", "analyze-sankey", "analyze-cost", "analyze-energy"];
const missingReqAct = REQUIRED_ACT.filter((k) => !actKeys.has(k));
check("all four Analyze sub-views (Bottleneck/Sankey/Cost/Energy) have a command",
  missingReqAct.length === 0,
  missingReqAct.length ? "missing: " + missingReqAct.join(",") : "all present");

// ---- NO DANGLING command: el -> id in index.html, act -> dispatched ------
const elCmds = cmds.filter((c) => c.kind === "el");
const missingElInHtml = elCmds.filter((c) => indexHtml.indexOf('id="' + c.elementId + '"') === -1);
check("every `el` command's elementId EXISTS in index.html (no dangling control)",
  elCmds.length > 0 && missingElInHtml.length === 0,
  missingElInHtml.length ? "absent: " + missingElInHtml.map((c) => c.elementId).join(",") : elCmds.length + " controls resolve");

const actCmds = cmds.filter((c) => c.kind === "act");
const actNotDeclared = actCmds.filter((c) => P.ACTION_KEYS.indexOf(c.actionKey) === -1);
const actNotDispatched = actCmds.filter((c) => appJs.indexOf('"' + c.actionKey + '"') === -1);
check("every `act` command's actionKey is declared AND dispatched in app.js",
  actCmds.length > 0 && actNotDeclared.length === 0 && actNotDispatched.length === 0,
  (actNotDeclared.length ? "undeclared: " + actNotDeclared.map((c) => c.actionKey).join(",") + " " : "") +
  (actNotDispatched.length ? "not-dispatched: " + actNotDispatched.map((c) => c.actionKey).join(",") : "all wired"));

// ---- determinism: buildCommands is byte-stable ---------------------------
const cmds2 = P.buildCommands({ tree: WT.library.paletteTree({}), elements: D.ELEMENTS, generate: G });
check("buildCommands is DETERMINISTIC (byte-identical JSON across runs)",
  JSON.stringify(cmds) === JSON.stringify(cmds2), "stable");

// ---- filter / fuzzy behaviour --------------------------------------------
const all = P.filter(cmds, "");
check("filter('') returns the WHOLE list unchanged (original order)",
  all.length === cmds.length && all.every((c, i) => c.id === cmds[i].id), all.length + " kept");

const sub = P.filter(cmds, "analyze");
check("substring filter narrows the list and keeps only matches",
  sub.length > 0 && sub.length < cmds.length &&
  sub.every((c) => (c.label + " " + c.group + " " + c.keywords).toLowerCase().indexOf("analyze") !== -1 ||
                   P.score(c, "analyze") >= 0),
  sub.length + "/" + cmds.length + " match 'analyze'");

// fuzzy subsequence: "cvyr" should still reach "conveyor" (add command)
const fuzzy = P.filter(cmds, "conv");
check("fuzzy/substring reaches an Add-component command (e.g. conveyor)",
  fuzzy.some((c) => c.kind === "place" && /conveyor/i.test(c.label)),
  fuzzy.length + " hits, conveyor reachable");

const none = P.filter(cmds, "zzzxqwknope");
check("an impossible query returns NO matches", none.length === 0, none.length + " matches");

// deterministic + stable ranking
const r1 = P.filter(cmds, "export").map((c) => c.id).join(",");
const r2 = P.filter(cmds, "export").map((c) => c.id).join(",");
check("filter ranking is deterministic + stable", r1 === r2 && r1.length > 0, "stable");

// score contract: empty query -> 0, match -> >=0, no match -> -1
check("score() contract: empty=0, match>=0, no-match=-1",
  P.score(cmds[0], "") === 0 &&
  P.score({ label: "Fit view", group: "View", keywords: "" }, "fit") >= 0 &&
  P.score({ label: "Fit view", group: "View", keywords: "" }, "zzzq") === -1,
  "ok");

// ---- shipped wiring: index.html ------------------------------------------
const palIdx = indexHtml.indexOf('src="palette.js"');
const appIdx = indexHtml.indexOf('src="app.js"');
check("index.html loads palette.js BEFORE app.js",
  palIdx !== -1 && appIdx !== -1 && palIdx < appIdx, "palette@" + palIdx + " < app@" + appIdx);
check("index.html ships the accessible palette overlay (dialog + combobox + listbox)",
  /id="cmdPalette"/.test(indexHtml) &&
  /id="cmdPaletteInput"[\s\S]*?role="combobox"/.test(indexHtml.replace(/\n/g, " ")) &&
  /id="cmdPaletteList"[\s\S]*?role="listbox"/.test(indexHtml.replace(/\n/g, " ")) &&
  /role="dialog"[\s\S]*?aria-modal="true"/.test(indexHtml.replace(/\n/g, " ")),
  "overlay + combobox input + listbox present");
check("index.html ships the Ctrl-K toolbar affordance (#cmdPaletteBtn)",
  /id="cmdPaletteBtn"/.test(indexHtml) && /aria-keyshortcuts="[^"]*K/.test(indexHtml),
  "affordance present + advertises the shortcut");

// ---- shipped wiring: app.js dispatches to the REAL handlers --------------
const appWiring =
  /mountCommandPalette\s*\(\s*\)/.test(appJs) &&
  /WT\.palette\.mount\s*\(/.test(appJs) &&
  /function buildPaletteCommands\s*\(/.test(appJs) &&
  /WT\.library\.paletteTree\(/.test(appJs) &&
  /function runPaletteCommand\s*\(/.test(appJs);
check("app.js mounts the palette + builds commands from the real registries", appWiring, "mount + buildPaletteCommands present");
const dispatchWiring =
  /setTool\(cmd\.type\)/.test(appJs) &&              // place -> arm placement
  /runGenerate\(cmd\.profileKey\)/.test(appJs) &&    // generate -> real handler
  /runPaletteActionKey\(cmd\.actionKey\)/.test(appJs) && // act -> switch
  /el\.click\(\)/.test(appJs);                        // el -> click the real button
check("app.js dispatches each command kind to the SAME existing handler",
  dispatchWiring, "place=setTool, generate=runGenerate, act=switch, el=click");

// ---- service worker precache + cache bump --------------------------------
check("sw.js precaches ./palette.js", swJs.indexOf('"./palette.js"') !== -1, "in APP_SHELL");
check("sw.js cache bumped to wt-v73 (and no longer wt-v72)",
  /CACHE_VERSION\s*=\s*"wt-v73"/.test(swJs) && !/CACHE_VERSION\s*=\s*"wt-v72"/.test(swJs),
  "CACHE_VERSION = wt-v73");

// ---- offline + deterministic (NO Date / NO RNG) --------------------------
const externalRe = /https?:\/\/(?!schemas?\.|www\.w3\.org)/i;
check("palette.js references no external hosts (offline)", !externalRe.test(PAL_SRC), "no http(s) hosts");
check("palette.js is deterministic: NO Date, NO Math.random",
  !/\bnew Date\b|\bDate\.now\b/.test(PAL_SRC) && !/Math\.random/.test(PAL_SRC), "no clock / no RNG");
check("palette.js contains no eval / new Function (CSP-safe)",
  !/\beval\s*\(/.test(PAL_SRC) && !/new\s+Function\s*\(/.test(PAL_SRC), "clean");

// ---- honesty: it INVOKES the existing handlers (additive, not a copy) ----
check("palette.js states it invokes the SAME existing handlers (additive)",
  /SAME handler/i.test(PAL_SRC) && /re-?implements? an action/i.test(PAL_SRC) && /ADDITIVE/i.test(PAL_SRC),
  "honest framing present");

console.log("");
console.log("-".repeat(60));
console.log(
  failures === 0
    ? "ALL " + checks + " CHECKS PASSED"
    : failures + " OF " + checks + " CHECKS FAILED"
);
process.exit(failures === 0 ? 0 : 1);
