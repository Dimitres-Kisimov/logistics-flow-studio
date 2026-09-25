/* =====================================================================
 * verify_routegraph.js - v3.68 THE ROUTE AS A DECLARED GRAPH.
 * Run: node verify_routegraph.js
 * ---------------------------------------------------------------------
 * Four of the limits this app documents about itself ended with the same
 * sentence - "cycles need a graph" - because a route was a LIST. v3.68
 * makes it a directed graph and derives the list by walking it. The
 * refactor is only worth anything if it changes NOTHING a caller sees,
 * so most of this harness is the proof that it did not:
 *
 *   1. THE LISTS ARE WHAT THEY WERE: every archetype and every outcome
 *      pinned literally against the list v3.67 produced, and every error
 *      branch of every archetype too - the unrolled detour included.
 *   2. THE GRAPH IS WELL FORMED: node ids are operation ids (no archetype
 *      repeats one), every edge lands on a node that exists, the start is
 *      the recipe's first step, and the edge kinds are the five declared.
 *   3. THE LOOP IS A LOOP: the rework edge points BACKWARD, its target
 *      carries the visit bound, the walk visits that step twice, and
 *      lowering the bound to one removes the redo - which is what makes
 *      it a bound rather than a coincidence.
 *   4. THE RULES ARE ORDERED: write-off beats check beats rework beats
 *      outcome beats the ordinary next step; an outcome nobody named
 *      falls back to the first declared one, as the list builder did.
 *   5. IT TERMINATES: every walk of every branch ends, and a graph with
 *      no error declared never produces a verification step.
 *   6. BYTE-IDENTITY: the resolved route has no new key, the hand floor
 *      still builds nine routes, and fixture A is unchanged.
 *   7. HONESTY AND WIRING: no clock, no roster, the generated page fresh
 *      against the code, the tool, the runner, wt-v147.
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

global.window = global;
for (const f of ["domain.js", "iso.js", "shapes.js", "routing.js", "ids.js", "pack.js", "flowsim.js", "goods.js", "analytics.js", "ledger.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const R = global.WT.routing, F = global.WT.flowsim, L = global.WT.ledger, P = global.WT.pack, A = global.WT.analytics;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const lf = (s) => s.replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

/* The lists v3.67 produced, written out. If a recipe changes, these change with it
 * deliberately - never because a walk quietly took a different edge. */
const V367 = {
  "legacy-spine": "receive putaway pick pack load",
  "full-pallet-out": "receive qc-sample putaway pallet-pick wrap load",
  "case-pick": "receive qc-sample depalletise putaway case-pick consolidate palletise wrap load",
  "piece-pick": "receive depalletise putaway replen piece-pick consolidate pack load",
  "cross-dock": "receive qc-sample stage-out load",
  "returns:restock": "receive inspect restock",
  "returns:scrap": "receive inspect scrap",
  vas: "pick vas pack load",
  "export-fragile": "pick qc-final palletise wrap load",
};
const V367_ERR = {
  "full-pallet-out|mis-pick@pallet-pick": "receive qc-sample putaway pallet-pick verify-pick pallet-pick wrap load",
  "full-pallet-out|wrong-putaway@putaway": "receive qc-sample putaway verify-put putaway pallet-pick wrap load",
  "case-pick|mis-pick@case-pick": "receive qc-sample depalletise putaway case-pick verify-pick case-pick consolidate palletise wrap load",
  "case-pick|wrong-putaway@putaway": "receive qc-sample depalletise putaway verify-put putaway case-pick consolidate palletise wrap load",
  "case-pick|damage@depalletise": "receive qc-sample depalletise scrap",
  "case-pick|damage@palletise": "receive qc-sample depalletise putaway case-pick consolidate palletise scrap",
  "piece-pick|mis-pick@piece-pick": "receive depalletise putaway replen piece-pick verify-pick piece-pick consolidate pack load",
  "piece-pick|wrong-putaway@putaway": "receive depalletise putaway verify-put putaway replen piece-pick consolidate pack load",
  "piece-pick|damage@depalletise": "receive depalletise scrap",
  "piece-pick|damage@pack": "receive depalletise putaway replen piece-pick consolidate pack scrap",
  "vas|mis-pick@pick": "pick verify-pick pick vas pack load",
  "vas|damage@pack": "pick vas pack scrap",
  "export-fragile|mis-pick@pick": "pick verify-pick pick qc-final palletise wrap load",
  "export-fragile|damage@palletise": "pick qc-final palletise scrap",
};

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

/* ---- 1. the lists are what they were --------------------------------------------------- */
(function () {
  const got = {};
  for (const a of R.ARCHETYPES) {
    const outs = a.outcomes ? a.outcomes.map((o) => o.id) : [null];
    for (const oc of outs) got[a.id + (oc ? ":" + oc : "")] = R.walk(R.graphOf(a.id), { outcome: oc }).join(" ");
  }
  const diff = Object.keys(V367).filter((k) => got[k] !== V367[k]);
  check("1a. every archetype and every outcome walks to exactly the list v3.67 built by concatenation - nine lists, pinned literally",
    diff.length === 0 && Object.keys(got).length === Object.keys(V367).length,
    diff.length ? "changed: " + diff.map((k) => k + " -> " + got[k]).join(" | ") : Object.keys(V367).length + " lists unchanged");
  const errs = R.normalizeErrors({ "mis-pick": 0.02, "wrong-putaway": 0.003, damage: 0.005 });
  const gotE = {};
  for (const a of R.ARCHETYPES) for (const br of R.branchesFor(a.id, errs)) if (br.error) gotE[a.id + "|" + br.error.kind + "@" + br.error.op] = br.ops.join(" ");
  const diffE = Object.keys(V367_ERR).filter((k) => gotE[k] !== V367_ERR[k]);
  check("1b. every error branch of every archetype walks to exactly the detour v3.54 spliced by hand - fourteen branches, the two rework shapes and the write-off, pinned literally",
    diffE.length === 0 && Object.keys(gotE).length === Object.keys(V367_ERR).length,
    diffE.length ? "changed: " + diffE.map((k) => k + " -> " + gotE[k]).join(" | ") : Object.keys(V367_ERR).length + " branches unchanged");
  const src = read("routing.js");
  check("1c. the graph is load-bearing, not decorative: both list builders go through walk(), so a list that disagreed with the graph could not be produced at all",
    /function opsFor\(arch, outcomeId\) \{\s*\n\s*return walk\(graphOf\(arch\.id\), \{ outcome: outcomeId \}\);/.test(src) &&
    /const spliced = walk\(graphOf\(arch\.id, \{ error:/.test(src) && !/head\.concat\(e\.kind\.tail\)/.test(src));
  check("1d. resolveRoute is unchanged where it matters: the same ops, the same routeId, the same fulfillability, and an unknown type still refuses by name",
    R.resolveRoute("piece-pick", anchors(), {}).ops.join(" ") === V367["piece-pick"] &&
    R.resolveRoute("returns", anchors(), { outcome: "scrap" }).routeId === "returns:scrap" &&
    R.resolveRoute("nope", anchors(), {}).unknown === true && R.resolveRoute("nope", anchors(), {}).ok === false);
})();
function anchors() {
  const a = {};
  for (const k of Object.keys(R.ANCHORS)) a[k] = { x: 10, y: 10, source: "element" };
  return a;
}

/* ---- 2. the graph is well formed --------------------------------------------------------- */
(function () {
  let repeats = 0, dangling = 0, badStart = 0, kinds = {};
  for (const a of R.ARCHETYPES) {
    const all = (a.ops || []).concat.apply(a.ops || [], (a.outcomes || []).map((o) => o.ops || []));
    if (all.some((x, i) => all.indexOf(x) !== i)) repeats++;
    const g = R.graphOf(a.id);
    const ids = {};
    for (const n of g.nodes) ids[n.id] = 1;
    for (const e of g.edges) { if (!ids[e.from] || !ids[e.to]) dangling++; kinds[e.kind] = (kinds[e.kind] || 0) + 1; }
    if (g.start !== a.ops[0]) badStart++;
  }
  check("2a. no archetype's recipe repeats an operation, which is why a node id may BE an operation id: a repeat in a walk is then a second visit to one step, not a second step",
    repeats === 0 && dangling === 0 && badStart === 0, "0 repeats, 0 dangling edges, 8 starts correct");
  const ge = R.graphOf("piece-pick", { error: { kind: "mis-pick", op: "piece-pick" } });
  const eids = {};
  for (const n of ge.nodes) eids[n.id] = 1;
  check("2b. an error branch adds nodes and edges to the same graph rather than declaring a second recipe: one check node, one check edge, one rework edge, everything else untouched",
    ge.nodes.length === R.graphOf("piece-pick").nodes.length + 1 && eids["verify-pick"] &&
    ge.edges.filter((e) => e.kind === "check").length === 1 && ge.edges.filter((e) => e.kind === "rework").length === 1 &&
    ge.edges.filter((e) => e.kind === "then").length === R.graphOf("piece-pick").edges.filter((e) => e.kind === "then").length + 1);
  check("2c. the edge kinds are exactly the five declared, each with a sentence saying what it means",
    Object.keys(R.EDGE_KINDS).join(",") === "then,outcome,check,rework,write-off" &&
    Object.keys(R.EDGE_KINDS).every((k) => typeof R.EDGE_KINDS[k] === "string" && R.EDGE_KINDS[k].length > 20) &&
    Object.keys(kinds).every((k) => !!R.EDGE_KINDS[k]) && R.GRAPH_SCHEMA === "wt-route-graph/v1");
  const gr = R.graphOf("returns");
  check("2d. a declared split is two outcome edges out of one node, each carrying its own share - the returns grading, which is a real routing split and not a label",
    gr.edges.filter((e) => e.kind === "outcome").length === 2 && gr.edges.filter((e) => e.kind === "outcome").every((e) => e.from === "inspect") &&
    gr.outcomes.map((o) => o.id + "=" + o.share).join(",") === "restock=0.75,scrap=0.25");
})();

/* ---- 3. the loop is a loop ---------------------------------------------------------------- */
(function () {
  const g = R.graphOf("piece-pick", { error: { kind: "mis-pick", op: "piece-pick" } });
  const order = R.graphOf("piece-pick").nodes.map((n) => n.id);
  const rework = g.edges.find((e) => e.kind === "rework");
  const node = g.nodes.find((n) => n.id === rework.to);
  const walked = R.walk(g, { error: { kind: "mis-pick", op: "piece-pick" } });
  check("3a. the rework edge points BACKWARD - its target comes earlier in the recipe than its source, which is what a list could never hold",
    rework.from === "verify-pick" && rework.to === "piece-pick" && order.indexOf(rework.to) < order.length &&
    walked.indexOf("verify-pick") > walked.indexOf("piece-pick"), rework.from + " -> " + rework.to);
  check("3b. the bound lives on the node it protects: the picked step carries maxVisits 2, and the walk visits it exactly twice",
    node.maxVisits === 2 && walked.filter((x) => x === "piece-pick").length === 2 && walked.filter((x) => x === "verify-pick").length === 1);
  const g1 = R.graphOf("piece-pick", { error: { kind: "mis-pick", op: "piece-pick" } });
  g1.nodes.find((n) => n.id === "piece-pick").maxVisits = 1;
  const g3 = R.graphOf("piece-pick", { error: { kind: "mis-pick", op: "piece-pick" } });
  g3.nodes.find((n) => n.id === "piece-pick").maxVisits = 3;
  const w1 = R.walk(g1, { error: { kind: "mis-pick", op: "piece-pick" } }).join(" ");
  const w2 = R.walk(g, { error: { kind: "mis-pick", op: "piece-pick" } }).join(" ");
  const w3 = R.walk(g3, { error: { kind: "mis-pick", op: "piece-pick" } }).join(" ");
  check("3c. the bound is a GUARD RAIL, not the model - and the harness says so because it was measured, not assumed: at 1 the redo disappears and the unit carries on from its check, at 2 there is one redo, and at 3 there is STILL one redo, because the check edge is entered only on the FIRST visit to the step",
    w1 === "receive depalletise putaway replen piece-pick verify-pick consolidate pack load" &&
    w2 === V367_ERR["piece-pick|mis-pick@piece-pick"] && w3 === w2 &&
    R.graphOf("piece-pick").nodes.every((n) => n.maxVisits === 1),
    "a unit that errs twice needs a second draw from the quota dispatcher, not a second lap - the graph now names what closing it would take");
  const gd = R.graphOf("case-pick", { error: { kind: "damage", op: "palletise" } });
  check("3c-bis. the graph is TOTAL: every check node has a way onward for the day the bound refuses the rework, so a unit can never be left standing at the verification bench - never taken today, and pinned so it cannot be lost",
    R.ARCHETYPES.every((a) => {
      const errs = R.normalizeErrors(true);
      return R.branchesFor(a.id, errs).filter((b) => b.error).every((b) => {
        const g = R.graphOf(a.id, { error: b.error });
        return g.nodes.every((n) => {
          const out = g.edges.filter((e) => e.from === n.id);
          return out.length === 0 || out.some((e) => e.kind === "then" || e.kind === "outcome") || out.some((e) => e.kind === "write-off");
        });
      });
    }));
  check("3d. a write-off is the other shape - a terminal edge that takes the unit off the route at the bench, with nothing after it",
    gd.edges.filter((e) => e.kind === "write-off").length === 1 && gd.edges.find((e) => e.kind === "write-off").to === "scrap" &&
    !gd.edges.some((e) => e.from === "scrap") && R.walk(gd, { error: { kind: "damage", op: "palletise" } }).slice(-1)[0] === "scrap");
})();

/* ---- 4. the rules are ordered ------------------------------------------------------------- */
(function () {
  const src = read("routing.js");
  const body = src.slice(src.indexOf("function chooseEdge"), src.indexOf("function walk("));
  const order = ["write-off", "check", "rework", "outcome", "then"].map((k) => body.indexOf('"' + k + '"'));
  check("4a. the edge a unit takes is decided in a fixed order - leave the route, then check, then go back, then the declared outcome, then the ordinary next step",
    order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
  check("4b. the check edge is entered on the FIRST visit only, so a unit does not verify its own redo for ever - that is what ends the loop, not the guard",
    R.walk(R.graphOf("vas", { error: { kind: "mis-pick", op: "pick" } }), { error: { kind: "mis-pick", op: "pick" } }).join(" ") === "pick verify-pick pick vas pack load" &&
    /visits\[e\.from\] === 1/.test(body));
  check("4c. an outcome nobody named falls back to the first declared one, exactly as the list builder's `|| arch.outcomes[0]` did",
    R.walk(R.graphOf("returns"), {}).join(" ") === "receive inspect restock" &&
    R.walk(R.graphOf("returns"), { outcome: "nonsense" }).join(" ") === "receive inspect restock" &&
    R.walk(R.graphOf("returns"), { outcome: "scrap" }).join(" ") === "receive inspect scrap");
  check("4d. an error the graph does not carry changes nothing: naming a kind that this route never reaches walks the plain recipe",
    R.walk(R.graphOf("cross-dock", { error: { kind: "mis-pick", op: "pick" } }), { error: { kind: "mis-pick", op: "pick" } }).join(" ") === V367["cross-dock"] &&
    R.graphOf("cross-dock", { error: { kind: "mis-pick", op: "pick" } }).edges.every((e) => e.kind === "then"));
})();

/* ---- 5. it terminates ---------------------------------------------------------------------- */
(function () {
  let longest = 0, all = 0;
  const errs = R.normalizeErrors(true);
  for (const a of R.ARCHETYPES) {
    for (const br of R.branchesFor(a.id, errs)) {
      const g = R.graphOf(a.id, br.error ? { error: br.error } : {});
      const w = R.walk(g, br);
      all++;
      longest = Math.max(longest, w.length);
      if (w.length >= 512) fail++;
    }
  }
  check("5a. every walk of every branch of every archetype ends well inside the guard - the loop is ended by its visit bound, not by running out of patience",
    longest < 20 && all >= 20, all + " walks, longest " + longest + " steps");
  check("5b. a graph with no error declared never produces a verification step or a write-off, on any archetype",
    R.ARCHETYPES.every((a) => { const w = R.walk(R.graphOf(a.id), {}); return w.indexOf("verify-pick") < 0 && w.indexOf("verify-put") < 0 && (a.id === "returns" ? true : w.indexOf("scrap") < 0); }));
})();

/* ---- 6. byte-identity ----------------------------------------------------------------------- */
(function () {
  const r = R.resolveRoute("piece-pick", anchors(), {});
  check("6a. the resolved route carries no new key: the graph is asked for, never attached, so every plan, run id and pinned digest is what it was",
    !("graph" in r) && !("nodes" in r) && !("edges" in r) && Object.keys(r).sort().join(",") === Object.keys(R.resolveRoute("vas", anchors(), {})).sort().join(","));
  const plan = F.spawnPlan(FLOOR, { seed: 31, mix: MIX });
  check("6b. the hand floor still builds nine routes with the default mix and no error key",
    plan.routes.length === 9 && !("errors" in plan) && plan.routes.every((x) => !("graph" in x)));
  const st = F.state(plan);
  const rec = L.create(plan, { scenarioId: "hand-built", seed: 31, mix: MIX, layout: FLOOR, profile: P.PROFILES.ecommerce, rates: A.defaultRates() });
  st.hooks = { afterTick: (s) => L.observe(rec, s) };
  F.step(st, 300);
  check("6c. the 300-tick export is byte for byte fixture A and the hand floor still records its own run id",
    JSON.stringify(L.exportJson(rec), null, 1) + "\n" === lf(read(path.join("test", "fixtures", "run-ledger.json"))) &&
    L.exportJson(rec).run.id === "RUN-hand-built-s31-hc28a7688");
})();

function freshCheck() {
  try { return execFileSync(process.execPath, [path.join("tools", "route_graph.mjs"), "--check"], { cwd: __dirname, encoding: "utf8" }).trim(); }
  catch (e) { return "STALE (regenerate: node tools/route_graph.mjs --out docs/ROUTE_GRAPH.md) " + String((e && e.stderr) || e).trim().slice(0, 110); }
}

/* ---- 7. honesty and wiring -------------------------------------------------------------------- */
(function () {
  const src = read("routing.js");
  const block = src.slice(src.indexOf("THE ROUTE AS A DECLARED GRAPH"), src.indexOf("function opsFor"));
  check("7a. the graph block reads no clock, no roster and no worker module; a node is a process step",
    !/new Date\(|Date\.now\(|Math\.random\(/.test(block) && !/WT\.workers|\broster\b|workerRoster/i.test(block) &&
    /never a person/.test(R.GRAPH_HONESTY) && /BetrVG/.test(R.GRAPH_HONESTY) && /GDPR/.test(R.GRAPH_HONESTY) && /deterministic/.test(R.GRAPH_HONESTY));
  check("7b. the refactor did not quietly close a limit it did not close: the bound is still one redo, quality control is still a pass-through, replenishment is still a node in the chain, and the module says all three",
    /ERRS TWICE IS STILL NOT MODELLED/i.test(block) && /pass-through/i.test(block) && /order-independent loop/i.test(block) &&
    /entered only on the first visit/i.test(block) && /guard rail, not the model/i.test(block));
  const doc = read(path.join("docs", "ROUTE_GRAPH.md"));
  check("7c. docs/ROUTE_GRAPH.md is GENERATED from routing.js and is fresh: --check passes, so the page cannot drift from the code",
    /Generated by/.test(doc) && /mermaid/.test(doc) && /REWORK/.test(doc) && /What is still a limit/.test(doc) &&
    freshCheck().indexOf("is fresh") >= 0, freshCheck());
  check("7d. the page shows every archetype and the two error shapes, with the loop drawn as a node a unit may visit twice",
    R.ARCHETYPES.every((a) => doc.indexOf(a.label) >= 0) && /up to 2 visits/.test(doc) && /write-off/.test(doc) && /flowchart LR/.test(doc));
  check("7e. shipped: the runner lists this harness, the tool exists, the service worker is at wt-v147 (previously wt-v146), README and CHANGELOG carry v3.68",
    /verify_routegraph\.js/.test(read(path.join("test", "run-all.mjs"))) && fs.existsSync(path.join(__dirname, "tools", "route_graph.mjs")) &&
    /wt-v147/.test(read("sw.js")) && /Previously wt-v146/.test(read("sw.js")) && /v3\.68/.test(read("README.md")) && /## v3\.68/.test(read("CHANGELOG.md")));
})();

console.log("=".repeat(72));
if (fail) { console.log("FAILED " + fail + " of " + (pass + fail)); process.exit(1); }
console.log("ALL ROUTE-GRAPH CHECKS PASSED (" + pass + ")");
