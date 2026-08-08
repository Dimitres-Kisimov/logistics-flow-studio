/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * optimize_factory.js - the FACTORY EFFICIENCY OPTIMIZER (v2.8 FACTORY-D)
 *                       -> WT.factoryOpt
 * ---------------------------------------------------------------------
 * The defensible "unique factory logic": arrange + balance a factory line
 * for maximum efficiency, on top of the `process` model (process.js /
 * WT.process). Three transparent, deterministic, offline industrial-
 * engineering heuristics - no Date, no RNG, no deps beyond WT.domain +
 * WT.process - same input => byte-identical output:
 *
 *   1) MATERIAL-FLOW PLACEMENT (CRAFT pairwise-exchange). Build the from-to
 *      FLOW matrix F from process.routing and the rectilinear DISTANCE
 *      matrix D from the mfg elements' integer-metre centroids, then
 *      minimise MHI = SUM F*D (the Koopmans-Beckmann / QAP objective) by
 *      repeatedly evaluating candidate EQUAL-FOOTPRINT two-way position
 *      swaps of the process stations and committing the single best
 *      improving swap, to no-improvement. EVERY candidate is validated
 *      against the app's EXISTING legality guards (in-bounds, no overlap,
 *      and never increasing the DIN 15185 aisle-violation count) - an
 *      illegal swap is rejected. Reports MHI before/after + the delta%.
 *
 *   2) LINE BALANCING (Ranked Positional Weight, Helgeson-Birnie). takt =
 *      shiftSec/demandPerShift. v3.18 FLOW-BALANCE: the per-task time is the
 *      RESOLVED PER-FINISHED-UNIT EFFECTIVE LOAD - the SAME numbers
 *      WT.process.metrics computes (chain: annotate()'s gozinto- and
 *      servers-weighted cycle/servers x cyclesPerFinished; declared multi-way
 *      network: resolveFlow()'s effTimeSec, so a 60%-share QA branch weighs
 *      0.6 x its cycle). RPW(op) = load + SUM load of all precedence-
 *      successors; pack tasks by descending RPW into workstations <= takt
 *      honouring precedence (the precedence walk is a DAG walk, so both
 *      branches of a split rank + pack correctly). On a PURE chain (servers
 *      1, no assembly/dismantle) every load equals the raw cycleSec, so the
 *      result is BYTE-IDENTICAL to the pre-v3.18 balancer (harness-pinned).
 *      WHAT REMAINS CHAIN-ORIENTED (honest): the packing model treats a
 *      workstation as one sequential resource at takt - it groups tasks by
 *      capacity (per-finished-unit load) but does NOT re-route flow, move
 *      arcs, change declared ratios or add/remove servers; and an invalid
 *      multi-way network falls back to raw cycle times (chain-style) after
 *      validateFlow's rejection, never a guessed resolution. Reports the
 *      stations, line efficiency = SUM load / (n * takt), balance delay and
 *      smoothness index.
 *
 *   3) BOTTLENECK + THROUGHPUT (Theory of Constraints). Reuses the EXISTING
 *      WT.process.metrics read-back so the headline numbers can never
 *      diverge from the simulator: names the constraint + the takt-limited
 *      throughput.
 *
 * It NEVER mutates the caller's layout - it works on clones and returns a
 * PROPOSAL (proposedElements + moves) plus before/after figures, so the UI
 * previews the change before the user Accepts it. Accepting only moves mfg
 * element positions (all still legal); it never touches the data model.
 *
 * HONESTY: every figure is MODELLED, NOT MEASURED; DETERMINISTIC; TEACHING-
 * SCALE. A transparent SLP/CRAFT + RPW + TOC heuristic that finds a LOCAL
 * optimum - it is NOT "optimal", NOT a validated discrete-event simulation,
 * NOT CAD/BIM, NOT a certification, and does NOT beat the commercial suites
 * (Tecnomatix Plant Simulation, visTable, FlexSim, AnyLogic). Methods:
 * Muther SLP, CRAFT (Armour-Buffa), Helgeson-Birnie RPW, Goldratt TOC,
 * Little's Law.
 *
 * Classic script attaching to the global `WT` namespace (works from file://
 * too). Deps: WT.domain (aisle/overlap legality) + WT.process (metrics).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const OPT_VERSION = "wt-opt-1";
  const PROCESS_KINDS = { station: 1, parallel: 1, assembly: 1, dismantle: 1 };
  const MAX_PASSES = 200; // teaching-scale n; steepest descent terminates well within this

  const HONESTY =
    "Modelled, not measured; deterministic, teaching-scale. A transparent " +
    "SLP/CRAFT pairwise-exchange placement + Ranked Positional Weight line-" +
    "balancing + Theory-of-Constraints read-out. It finds a LOCAL optimum " +
    "(heuristic - NOT guaranteed optimal), and is NOT a validated discrete-" +
    "event simulation, NOT CAD/BIM, NOT a certification, and does NOT beat " +
    "the commercial suites (Tecnomatix Plant Simulation, visTable, FlexSim, " +
    "AnyLogic). Methods: Muther SLP, CRAFT (Armour-Buffa), Helgeson-Birnie " +
    "RPW, Goldratt TOC, Little's Law.";

  const BASIS =
    "Material flow: min SUM(flow x distance) via CRAFT pairwise exchange " +
    "(Koopmans-Beckmann QAP). Line balancing: Ranked Positional Weight to " +
    "takt on the resolved per-finished-unit effective loads (gozinto- and " +
    "servers-weighted; on a declared multi-way network, the proportional-" +
    "flow shares from resolveFlow - the same numbers metrics() reports). " +
    "Throughput: Theory of Constraints (bottleneck = max effective " +
    "cycle). Rectilinear (aisle-following) distance between element centroids.";

  function domain() { return WT.domain || null; }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function round4(v) { return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0; }

  function isProcessStation(kind) { return !!PROCESS_KINDS[kind]; }

  /* ==================================================================
   * BUILD F + D - the from-to FLOW matrix and the rectilinear DISTANCE
   * matrix, both indexed over the operations that carry a placed element,
   * in the block's deterministic operation order. Distances are DERIVED
   * from the integer-metre element centroids (never stored). Returns the
   * ordered id list so callers can read the matrices unambiguously.
   * ================================================================== */
  function buildFD(layout, block) {
    const els = (layout && layout.elements) || [];
    const elById = {};
    for (const e of els) elById[e.id] = e;
    const cell = num(layout && layout.cell, 1) || 1;

    // Nodes = operations that map to a placed element, in block order.
    const ops = (block && block.operations) || [];
    const nodes = [];
    for (const o of ops) if (elById[o.elementId]) nodes.push(o);
    const n = nodes.length;
    const idx = {}; // opId -> matrix index
    nodes.forEach((o, i) => { idx[o.id] = i; });

    // Centroid of an operation's element, in metres.
    function centroid(op) {
      const e = elById[op.elementId];
      return { x: (e.x + e.w / 2) * cell, y: (e.y + e.d / 2) * cell };
    }

    // Distance matrix D[i][j] = rectilinear (Manhattan) distance in metres.
    const cent = nodes.map(centroid);
    const D = [];
    for (let i = 0; i < n; i++) {
      D.push(new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        D[i][j] = Math.abs(cent[i].x - cent[j].x) + Math.abs(cent[i].y - cent[j].y);
      }
    }

    // Flow matrix F[i][j] = units/hr from routing (the from-to chart).
    const F = [];
    for (let i = 0; i < n; i++) F.push(new Array(n).fill(0));
    const routing = (block && block.routing) || [];
    for (const r of routing) {
      const a = idx[r.from], b = idx[r.to];
      if (a === undefined || b === undefined) continue;
      F[a][b] += Math.max(0, num(r.unitsPerHr, 0));
    }

    return {
      ids: nodes.map((o) => o.id),
      elementIds: nodes.map((o) => o.elementId),
      names: nodes.map((o) => o.name),
      kinds: nodes.map((o) => o.kind),
      cell: cell,
      F: F,
      D: D,
    };
  }

  // MHI = SUM_i SUM_j F[i][j] * D[i][j]  (Koopmans-Beckmann / QAP objective).
  function mhi(F, D) {
    let s = 0;
    for (let i = 0; i < F.length; i++)
      for (let j = 0; j < F.length; j++) s += F[i][j] * D[i][j];
    return s;
  }

  // MHI recomputed from the operation centroids given a positions map
  // (elementId -> {x,y}); footprints (w,d) come from the base elements.
  function mhiFor(fd, elById, pos, cell) {
    const ids = fd.elementIds;
    const n = ids.length;
    const cx = new Array(n), cy = new Array(n);
    for (let i = 0; i < n; i++) {
      const e = elById[ids[i]];
      const p = pos[ids[i]];
      cx[i] = (p.x + e.w / 2) * cell;
      cy[i] = (p.y + e.d / 2) * cell;
    }
    let s = 0;
    const F = fd.F;
    for (let i = 0; i < n; i++) {
      const row = F[i];
      for (let j = 0; j < n; j++) {
        const f = row[j];
        if (f !== 0) s += f * (Math.abs(cx[i] - cx[j]) + Math.abs(cy[i] - cy[j]));
      }
    }
    return s;
  }

  /* ==================================================================
   * LEGALITY - reuse the app's EXISTING guards on a candidate element
   * list: in-bounds, overlap-free, and never MORE aisle violations than
   * the baseline. Returns true iff the candidate layout is legal.
   * ================================================================== */
  function inBounds(e, gridW, gridH) {
    return e.x >= 0 && e.y >= 0 && e.x + e.w <= gridW && e.y + e.d <= gridH;
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
  }
  function legal(els, gridW, gridH, minAisleMetres, baseAisle) {
    for (const e of els) if (!inBounds(e, gridW, gridH)) return false;
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++)
        if (rectsOverlap(els[i], els[j])) return false;
    const D = domain();
    if (D && typeof D.aisleViolations === "function") {
      const v = D.aisleViolations(els, minAisleMetres).length;
      if (v > baseAisle) return false;
    }
    return true;
  }
  function aisleCount(els, minAisleMetres) {
    const D = domain();
    return D && typeof D.aisleViolations === "function"
      ? D.aisleViolations(els, minAisleMetres).length : 0;
  }

  /* ==================================================================
   * CRAFT - deterministic pairwise-exchange placement. Enumerates every
   * EQUAL-FOOTPRINT two-way swap of the process stations, keeps the single
   * best MHI-reducing legal swap per pass (steepest descent, lowest-index
   * tie-break), and iterates to no improvement. Equal-footprint swaps
   * leave the occupied-rectangle set invariant, so legality is preserved -
   * but every candidate is STILL validated against the guards (defensive +
   * required). Source/sink endpoints (docks) stay anchored. Deterministic:
   * fixed ordering, no Date/RNG. MHI is monotone non-increasing.
   * ================================================================== */
  function craft(layout, block, config) {
    config = config || {};
    const els = (layout.elements || []).map((e) => Object.assign({}, e));
    const gridW = num(layout.gridW, 0), gridH = num(layout.gridH, 0);
    const cell = num(layout.cell, 1) || 1;
    const minAisle = num(config.minAisleMetres, 0);
    const elById = {};
    for (const e of els) elById[e.id] = e;

    const fd = buildFD({ elements: els, cell: cell }, block);
    const baseAisle = aisleCount(els, minAisle);

    // Swappable = process stations (kind station/parallel/assembly/dismantle)
    // that map to a placed element, in block order (deterministic).
    const swap = [];
    (block.operations || []).forEach((o) => {
      if (isProcessStation(o.kind) && elById[o.elementId]) swap.push(o.elementId);
    });

    // Positions map (elementId -> {x,y}) we mutate as swaps commit.
    const pos = {};
    for (const e of els) pos[e.id] = { x: e.x, y: e.y };

    const mhiBefore = mhiFor(fd, elById, pos, cell);
    let curMhi = mhiBefore;
    let evaluated = 0, swaps = 0, passes = 0;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      passes++;
      let best = null; // {i,j,mhi}
      for (let a = 0; a < swap.length; a++) {
        for (let b = a + 1; b < swap.length; b++) {
          const idA = swap[a], idB = swap[b];
          const eA = elById[idA], eB = elById[idB];
          // CRAFT equal-area rule: only swap equal-footprint stations.
          if (eA.w !== eB.w || eA.d !== eB.d) continue;
          const pa = pos[idA], pb = pos[idB];
          if (pa.x === pb.x && pa.y === pb.y) continue;
          // Trial the swap on cloned elements + validate legality.
          const trialEls = els.map((e) => {
            if (e.id === idA) return Object.assign({}, e, { x: pb.x, y: pb.y });
            if (e.id === idB) return Object.assign({}, e, { x: pa.x, y: pa.y });
            return e;
          });
          evaluated++;
          if (!legal(trialEls, gridW, gridH, minAisle, baseAisle)) continue;
          // MHI after this candidate swap.
          const trialPos = Object.assign({}, pos);
          trialPos[idA] = { x: pb.x, y: pb.y };
          trialPos[idB] = { x: pa.x, y: pa.y };
          const m = mhiFor(fd, elById, trialPos, cell);
          if (m < curMhi - 1e-9 && (!best || m < best.mhi - 1e-12)) {
            best = { i: idA, j: idB, xa: pa.x, ya: pa.y, xb: pb.x, yb: pb.y, mhi: m };
          }
        }
      }
      if (!best) break; // no improving legal swap -> local optimum
      // Commit the single best improving swap.
      pos[best.i] = { x: best.xb, y: best.yb };
      pos[best.j] = { x: best.xa, y: best.ya };
      elById[best.i].x = best.xb; elById[best.i].y = best.yb;
      elById[best.j].x = best.xa; elById[best.j].y = best.ya;
      curMhi = best.mhi;
      swaps++;
    }

    // Apply the final positions to the working clone list.
    for (const e of els) { e.x = pos[e.id].x; e.y = pos[e.id].y; }

    // Moves = elements whose position actually changed.
    const moves = [];
    for (const id of swap) {
      const orig = (layout.elements || []).find((e) => e.id === id);
      const now = elById[id];
      if (orig && (orig.x !== now.x || orig.y !== now.y)) {
        moves.push({ id: id, from: { x: orig.x, y: orig.y }, to: { x: now.x, y: now.y } });
      }
    }

    const mhiAfter = curMhi;
    const deltaPct = mhiBefore > 1e-9 ? ((mhiBefore - mhiAfter) / mhiBefore) * 100 : 0;

    return {
      ids: fd.ids,
      elementIds: fd.elementIds,
      names: fd.names,
      F: fd.F,
      D: fd.D,
      mhiBefore: round4(mhiBefore),
      mhiAfter: round4(mhiAfter),
      deltaPct: round4(deltaPct),
      moves: moves,
      movedCount: moves.length,
      swaps: swaps,
      passes: passes,
      evaluated: evaluated,
      proposedElements: els,
      aisleBefore: baseAisle,
      aisleAfter: aisleCount(els, minAisle),
      improved: mhiAfter < mhiBefore - 1e-6,
    };
  }

  /* ==================================================================
   * EFFECTIVE PER-FINISHED-UNIT LOADS - v3.18 FLOW-BALANCE. The balancer's
   * task times, read from the SAME machinery metrics() uses so the two can
   * never disagree: a declared multi-way network -> resolveFlow()'s
   * effTimeSec (proportional-flow shares; a 60% branch weighs 0.6 x cycle);
   * a chain -> annotate()'s _effTimePerFinished (gozinto x cycle / servers)
   * on a FRESH sanitize copy (never mutates the caller's block). Returns
   * null when WT.process is absent or the declared network is INVALID
   * (validateFlow already rejected it with the friendly message) - the
   * caller then falls back to raw cycleSec, the honest chain-style basis,
   * never a guessed resolution. On a PURE chain (servers 1, no assembly/
   * dismantle) every load equals the raw cycleSec exactly.
   * ================================================================== */
  function effectiveLoads(block) {
    const P = WT.process;
    if (!P) return null;
    try {
      if (typeof P.isMultiway === "function" && P.isMultiway(block)) {
        if (typeof P.resolveFlow !== "function") return null;
        const rf = P.resolveFlow(block);
        if (!rf || !rf.ok) return null; // invalid network -> raw-cycle fallback
        const loads = {};
        for (const id in rf.nodes) loads[id] = rf.nodes[id].effTimeSec;
        return { loads: loads, basis: "network" };
      }
      if (typeof P.annotate === "function" && typeof P.sanitize === "function") {
        const a = P.annotate(P.sanitize(block)); // fresh copy: no caller mutation
        const loads = {};
        for (const s of a.stations) loads[s.id] = s._effTimePerFinished;
        return { loads: loads, basis: "chain" };
      }
    } catch (_) { /* fall through to the raw-cycle fallback */ }
    return null;
  }

  /* ==================================================================
   * RPW - Ranked Positional Weight (Helgeson-Birnie) line balancing.
   * Tasks = the timed process operations; task time = the EFFECTIVE
   * PER-FINISHED-UNIT LOAD (v3.18 FLOW-BALANCE - see effectiveLoads above;
   * raw cycleSec only as the no-WT.process / invalid-network fallback).
   * takt = shiftSec/demandPerShift. RPW(op) = load + SUM load of ALL
   * precedence-successors (a DAG walk - both branches of a split count).
   * Pack tasks by descending RPW into workstations <= takt honouring
   * precedence (a task is assignable only once every predecessor is
   * placed). A task whose load exceeds takt gets its own station
   * (over-takt, flagged).
   *
   * LINE EFFICIENCY = SUM load / (n * C) with C = the takt (the line's
   * demanded/design cycle time), so it reads as WORKSTATION-TIME UTILISED
   * at the takt pace: consolidating idle stations RAISES it, and balance
   * delay = idle/available = 1 - efficiency stays exactly consistent. The
   * fullest station's actual load (cycleMax) is reported separately. Before
   * = the current one-op-per-station line (n0 stations); after = the RPW-
   * balanced line (n1 <= n0). Smoothness = sqrt(SUM (takt - load)^2).
   * Deterministic: descending-RPW order, flow-order tie-break. The output
   * SCHEMA is unchanged from the pre-v3.18 balancer (task rows still carry
   * the raw cycleSec for reference; station `load`/`rpw`/efficiencies are
   * in effective per-finished-unit seconds) and on a PURE chain the whole
   * result is BYTE-IDENTICAL to the legacy balancer (harness-pinned).
   * CHAIN-ORIENTED REMAINDER (honest): grouping is capacity-only - it
   * never re-routes flow, changes ratios or adds/removes servers.
   * ================================================================== */
  function rpw(block) {
    const ops = (block && block.operations) || [];
    const tasks = ops.filter((o) => isProcessStation(o.kind) && o.cycleSec > 0);
    const takt = block.shiftSec / Math.max(1, block.demandPerShift);
    const byId = {};
    ops.forEach((o) => { byId[o.id] = o; });

    // v3.18 FLOW-BALANCE: per-task load = resolved effective time per
    // finished unit; raw cycleSec only when WT.process is absent or the
    // declared network is invalid (already rejected with a friendly message).
    const eff = effectiveLoads(block);
    const loadById = {};
    for (const t of tasks) {
      loadById[t.id] = eff && Number.isFinite(eff.loads[t.id]) && eff.loads[t.id] > 0
        ? eff.loads[t.id] : Math.max(0, num(t.cycleSec, 0));
    }
    const taskIdSet = {}; tasks.forEach((t) => { taskIdSet[t.id] = 1; });

    // Successor adjacency over ALL ops (source/sink load 0 -> harmless),
    // then transitive-successor LOAD sum restricted to task ops.
    const succ = {};
    ops.forEach((o) => { succ[o.id] = []; });
    for (const [a, b] of (block.precedence || [])) {
      if (succ[a] && byId[b]) succ[a].push(b);
    }
    function reachTaskTime(startId) {
      // Sum the loads of all task ops reachable from startId (excl. itself).
      const seen = {}; const stack = succ[startId].slice(); let sum = 0;
      while (stack.length) {
        const id = stack.pop();
        if (seen[id]) continue; seen[id] = 1;
        if (taskIdSet[id]) sum += loadById[id];
        for (const s of succ[id] || []) if (!seen[s]) stack.push(s);
      }
      return sum;
    }

    // Predecessor set per task (direct + transitive) restricted to task ids.
    const taskIds = {}; tasks.forEach((t) => { taskIds[t.id] = 1; });
    const predOf = {}; // taskId -> Set of task ids that must precede it
    tasks.forEach((t) => { predOf[t.id] = {}; });
    // BFS successors: for each op, everything reachable is a successor.
    for (const t of tasks) {
      const seen = {}; const stack = succ[t.id].slice();
      while (stack.length) {
        const id = stack.pop();
        if (seen[id]) continue; seen[id] = 1;
        if (taskIds[id] && predOf[id]) predOf[id][t.id] = 1;
        for (const s of succ[id] || []) if (!seen[s]) stack.push(s);
      }
    }

    // Flow order index (from process order) for a deterministic tie-break.
    const flowIdx = {}; ops.forEach((o, i) => { flowIdx[o.id] = i; });
    const rows = tasks.map((t) => ({
      opId: t.id,
      name: t.name,
      cycleSec: t.cycleSec, // raw cycle, kept for reference (schema-stable)
      servers: t.servers,
      rpw: round4(loadById[t.id] + reachTaskTime(t.id)),
    }));
    // Descending RPW; tie-break by flow order then id (deterministic).
    rows.sort((p, q) =>
      q.rpw - p.rpw || flowIdx[p.opId] - flowIdx[q.opId] ||
      (p.opId < q.opId ? -1 : 1));

    const totalCycle = tasks.reduce((s, t) => s + loadById[t.id], 0);
    const maxCycle = tasks.reduce((m, t) => Math.max(m, loadById[t.id]), 0);

    // --- The RPW packing pass (precedence-feasible, <= takt) ------------
    const assigned = {};
    const remaining = rows.slice();
    const stations = [];
    let cur = { load: 0, tasks: [] };
    let guard = 0, guardMax = rows.length * rows.length + rows.length + 5;
    function predsMet(opId) {
      const p = predOf[opId] || {};
      for (const k in p) if (!assigned[k]) return false;
      return true;
    }
    while (remaining.length && guard++ < guardMax) {
      // Highest-RPW remaining task whose predecessors are all assigned and
      // which fits the current station (already RPW-sorted -> first match).
      // Fit is judged on the task's effective per-finished-unit LOAD.
      let pickIdx = -1;
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i];
        if (!predsMet(t.opId)) continue;
        if (loadById[t.opId] <= takt - cur.load + 1e-9) { pickIdx = i; break; }
      }
      if (pickIdx === -1) {
        if (cur.tasks.length) { stations.push(cur); cur = { load: 0, tasks: [] }; continue; }
        // Empty station can't fit any assignable task -> a task load > takt.
        let soloIdx = -1;
        for (let i = 0; i < remaining.length; i++) if (predsMet(remaining[i].opId)) { soloIdx = i; break; }
        if (soloIdx === -1) break; // precedence deadlock (robustness) -> stop
        const t = remaining.splice(soloIdx, 1)[0];
        assigned[t.opId] = 1;
        stations.push({ load: loadById[t.opId], tasks: [t], overTakt: true });
        continue;
      }
      const t = remaining.splice(pickIdx, 1)[0];
      assigned[t.opId] = 1;
      cur.tasks.push(t); cur.load += loadById[t.opId];
    }
    if (cur.tasks.length) stations.push(cur);

    const nAfter = stations.length || 1;
    const maxLoadAfter = stations.reduce((m, s) => Math.max(m, s.load), 0) || 1;
    // Any single task whose LOAD exceeds takt cannot meet the demanded pace
    // as-is - flagged (over-takt) and reported honestly.
    const overTakt = maxCycle > takt + 1e-9;
    // Design cycle time C: the takt, exactly as before - EXCEPT when a task
    // load exceeds takt (over-takt, only possible on gozinto-/share-weighted
    // loads, v3.18): the line then cannot run at takt at all, and dividing by
    // takt would report a "utilisation" above 100%. In that case C is the
    // REALIZED bottleneck station time (maxCycle - the classical Helgeson-
    // Birnie basis), so line efficiency stays a true utilisation in [0,1].
    // Lines with every load <= takt (all pre-v3.18 outputs) are unchanged.
    const C = takt > 0 && !overTakt ? takt : (maxCycle || 1);
    // Line efficiency at C = value-added time / available station-time.
    const lineEffAfter = C > 0 ? totalCycle / (nAfter * C) : 0;
    // Smoothness index = sqrt(SUM (C - load)^2) over stations (0 = perfect).
    let smoo = 0; for (const s of stations) smoo += Math.pow(C - s.load, 2);
    const smoothness = Math.sqrt(smoo);

    // Before = one operation per station (the current arrangement), same basis.
    const nBefore = tasks.length || 1;
    const lineEffBefore = C > 0 ? totalCycle / (nBefore * C) : 0;

    // Named bottleneck = the fullest workstation (after) / the op with the
    // greatest effective load (before) - the same op metrics() would name.
    let slowest = null; for (const t of tasks) if (!slowest || loadById[t.id] > loadById[slowest.id]) slowest = t;
    let fullest = null; for (const s of stations) if (!fullest || s.load > fullest.load) fullest = s;
    const stationOut = stations.map((s, i) => ({
      index: i + 1,
      opIds: s.tasks.map((t) => t.opId),
      names: s.tasks.map((t) => t.name),
      load: round4(s.load),
      utilisation: round4(takt > 0 ? s.load / takt : 0),
      overTakt: !!s.overTakt,
      isBottleneck: s === fullest,
    }));

    return {
      taktSec: round4(takt),
      totalCycleSec: round4(totalCycle),
      cycleMaxAfter: round4(maxLoadAfter), // fullest balanced station load (info)
      overTakt: overTakt,                  // a single op exceeds takt (constraint)
      theoreticalMinStations: takt > 0 ? Math.ceil(totalCycle / takt) : nBefore,
      tasks: rows,
      stations: stationOut,
      nStationsBefore: nBefore,
      nStationsAfter: nAfter,
      lineEffBefore: round4(lineEffBefore),
      lineEffAfter: round4(lineEffAfter),
      balanceDelayBefore: round4((1 - lineEffBefore) * 100),
      balanceDelayAfter: round4((1 - lineEffAfter) * 100),
      smoothnessAfter: round4(smoothness),
      bottleneckBefore: slowest ? slowest.name : null,
      bottleneckAfter: fullest && fullest.tasks.length
        ? fullest.tasks.map((t) => t.name).join(" + ") : null,
      improved: round4(lineEffAfter) > round4(lineEffBefore) + 1e-9,
    };
  }

  /* ==================================================================
   * OPTIMIZE - the single entry point the UI calls. Runs CRAFT placement +
   * RPW balancing + reads the TOC metrics back through WT.process, and
   * returns ONE preview report (nothing is mutated; Accept applies the
   * placement's proposedElements). Deterministic + fully offline.
   * ================================================================== */
  function optimize(layout, block, config) {
    config = config || {};
    if (!layout || !Array.isArray(layout.elements)) return { ok: false, reason: "no layout" };
    if (!block || !Array.isArray(block.operations) || !block.operations.length) {
      return { ok: false, reason: "no process block (generate a factory line first)" };
    }
    const sane = (WT.process && typeof WT.process.sanitize === "function")
      ? WT.process.sanitize(block) : block;

    const placement = craft(layout, sane, config);
    const balance = rpw(sane);

    // TOC read-back through the EXISTING simulator metrics (so the headline
    // can never diverge from the sim). Placement does not change cycle times,
    // so throughput is the same before/after - reported honestly as the
    // constraint-limited rate. The balance view improves station UTILISATION.
    let toc = null;
    if (WT.process && typeof WT.process.metrics === "function") {
      try {
        const m = WT.process.metrics(sane);
        if (m) toc = {
          throughputPerHr: m.throughputPerHr,
          taktSec: m.taktSec,
          demandMet: m.demandMet,
          bottleneckName: m.bottleneck ? m.bottleneck.name : null,
          bottleneckEffTimeSec: m.bottleneck ? m.bottleneck.effTimeSec : null,
          lineEfficiency: m.lineEfficiency,
        };
      } catch (_) { toc = null; }
    }

    return {
      ok: true,
      version: OPT_VERSION,
      basis: BASIS,
      honesty: HONESTY,
      placement: placement,
      balance: balance,
      toc: toc,
      // Convenience headline fields for the calm UI.
      headline: {
        mhiDeltaPct: placement.deltaPct,
        mhiBefore: placement.mhiBefore,
        mhiAfter: placement.mhiAfter,
        moved: placement.movedCount,
        lineEffBefore: balance.lineEffBefore,
        lineEffAfter: balance.lineEffAfter,
        bottleneckBefore: balance.bottleneckBefore,
        bottleneckAfter: balance.bottleneckAfter,
        throughputPerHr: toc ? toc.throughputPerHr : null,
      },
      improved: placement.improved || balance.improved,
    };
  }

  WT.factoryOpt = {
    VERSION: OPT_VERSION,
    HONESTY: HONESTY,
    BASIS: BASIS,
    buildFD: buildFD,
    mhi: mhi,
    craft: craft,
    rpw: rpw,
    optimize: optimize,
  };
})();
