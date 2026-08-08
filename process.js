/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * process.js - the FACTORY PROCESS data model + deterministic line sim
 *              (v2.7 FACTORY-C: the foundation the efficiency optimizer needs)
 * ---------------------------------------------------------------------
 * Two things live here, both PURE, OFFLINE and DETERMINISTIC (NO Date, NO
 * RNG anywhere - same input -> byte-identical output):
 *
 *  1) THE `process` DATA MODEL. One OPTIONAL top-level `process` block that
 *     extends the app's integer-metre `wt-1` layout (exactly like the
 *     `library` embed): a PROCESS GRAPH laid over the SPATIAL graph. It is
 *     present ONLY for factory layouts, so a warehouse layout serializes
 *     BYTE-IDENTICALLY to before (embedInto adds nothing when absent).
 *
 *        process = {
 *          version: "wt-proc-1",
 *          shiftSec: 28800,          // available production time / shift
 *          demandPerShift: 480,      // customer demand  -> takt = shift/demand
 *          operations: [             // each BOUND to a placed mfg-* element
 *            { id, name, elementId, kind, cycleSec, servers, source,
 *              inputs?, outputs? } ],
 *          precedence: [[fromOpId,toOpId], ...],   // the precedence graph
 *          routing:    [{from,to,unitsPerHr,ratio?}, ...] // the from-to FLOW matrix
 *        }
 *
 *     v3.17 MULTI-WAY ROUTING: a routing arc may carry an OPTIONAL `ratio`
 *     (0..1]. When an operation has TWO OR MORE outgoing arcs (a SPLIT),
 *     every outgoing arc must declare a ratio and the ratios must sum to ~1
 *     (validated with a friendly message). Arcs INTO an operation ACCUMULATE
 *     (a MERGE). A block that declares such a branched network is resolved
 *     into a PROPORTIONAL FLOW NETWORK (resolveFlow) and simulated on that
 *     network (simulateFlow); metrics() then reports on the resolved flows.
 *     A block whose routing is a plain chain (every existing scenario) takes
 *     the EXACT pre-v3.17 code path - byte-identical results, and `ratio` is
 *     simply absent from its serialize.
 *
 *     `elementId` is the JOIN between the process graph and the spatial
 *     `wt-1` elements. DISTANCES are DERIVED from the integer-metre element
 *     positions (never stored) so the model can't drift.
 *
 *  2) THE LINE SIMULATION. A deterministic factory-line sim that flows PART
 *     tokens through the operations honouring cycle times + servers, with
 *     REAL Assembly (combine `inputs` -> 1) and Dismantle (1 -> `outputs`)
 *     behaviour in the flow, and computes HONEST metrics:
 *       - per-STATION utilisation (busy / available), in [0,1]
 *       - line THROUGHPUT (parts/hr) = 3600 / bottleneck effective cycle
 *       - the BOTTLENECK station (Theory of Constraints: max cycle/servers,
 *         weighted by the gozinto multiplier from assembly/dismantle)
 *       - WIP + LEAD TIME (Little's Law: L = lambda*W)
 *       - LINE EFFICIENCY (mean station load relative to the bottleneck)
 *
 * HONESTY: every figure is MODELLED, NOT MEASURED; DETERMINISTIC; TEACHING-
 * SCALE. The metrics use standard industrial-engineering formulas - Theory
 * of Constraints (bottleneck), takt time, line efficiency, Little's Law -
 * grounded in the sourced research (leanproduction.com TOC/OEE,
 * businessmap.io Little's Law, knowindustrialengineering.com line
 * balancing). It is NOT a validated discrete-event simulation, NOT CAD/BIM
 * and NOT a certification. Cycle times are synthetic REFA/MTM-style
 * estimates unless imported - and are EDITABLE.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Optional dep: WT.domain (for mfg-* cycle/server defaults);
 * graceful fallback when absent. No frameworks, no build step, fully
 * offline, no deps.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const PROC_VERSION = "wt-proc-1";
  const DEFAULT_SHIFT_SEC = 28800; // 8 h
  const DEFAULT_DEMAND = 480;      // -> takt = 60 s
  const DEFAULT_SOURCE_RATE = 120; // offered parts/hr into the line (from-to)
  const DEFAULT_STATION_CYCLE = 30;

  const HONESTY =
    "Modelled, not measured; deterministic, teaching-scale. Line metrics use " +
    "standard industrial-engineering formulas - Theory of Constraints " +
    "(bottleneck = max cycle/servers), takt time, line efficiency and Little's " +
    "Law (WIP = throughput x lead time). NOT a validated discrete-event " +
    "simulation, NOT CAD/BIM, NOT a certification. Cycle times are synthetic " +
    "REFA/MTM-style estimates unless imported - and are editable.";

  // The manufacturing components that become process OPERATIONS. Bound by
  // elementId to the placed mfg-* element. (pack-station et al. carry no
  // cycle/server model, so the finishing pack step stays STRUCTURAL - noted.)
  const OP_KIND = {
    "mfg-source": "source",
    "mfg-drain": "sink",
    "mfg-station": "station",
    "mfg-parallel-station": "parallel",
    "mfg-assembly": "assembly",
    "mfg-dismantle": "dismantle",
  };
  const ZONE_STAGE = { receiving: 0, storage: 1, picking: 2, packing: 3, shipping: 4 };
  const PROCESS_KINDS = { station: 1, parallel: 1, assembly: 1, dismantle: 1 };

  function domainDef(type) {
    return (WT.domain && WT.domain.ELEMENTS && WT.domain.ELEMENTS[type]) || null;
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clampPos(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }

  // A friendly, HONEST operation name from its kind + the element's zone.
  function opNameFor(kind, zone, idx) {
    if (kind === "source") return "Parts source";
    if (kind === "sink") return "Finished drain";
    if (kind === "parallel") return "Parallel machining " + idx;
    if (kind === "assembly") return "Assembly " + idx;
    if (kind === "dismantle") return "Dismantle " + idx;
    // plain station: name by lane so the panel reads naturally
    if (zone === "packing") return "QA / inspect " + idx;
    if (zone === "storage") return "Machining " + idx;
    return "Station " + idx;
  }

  /* ==================================================================
   * DERIVE - build a `process` block from a (factory) layout's elements.
   * Returns null for a non-factory layout (no source+sink+station), so a
   * warehouse layout never gains a process block. Distances are NOT stored
   * (they follow from x,y,w,d). Deterministic: a fixed element ordering.
   * ================================================================== */
  function derive(layout, opts) {
    opts = opts || {};
    const els = (layout && layout.elements) || [];
    // Collect the operation-bearing elements.
    const found = [];
    for (const e of els) {
      const kind = OP_KIND[e && e.type];
      if (kind) found.push({ el: e, kind: kind });
    }
    const hasSource = found.some((o) => o.kind === "source");
    const hasSink = found.some((o) => o.kind === "sink");
    const hasStation = found.some((o) => PROCESS_KINDS[o.kind]);
    if (!hasSource || !hasSink || !hasStation) return null; // not a factory line

    // Order along the flow: source first, sink last, middle by zone-stage
    // then x then y then id (deterministic; zones absent -> pure left->right).
    const src = found.filter((o) => o.kind === "source");
    const snk = found.filter((o) => o.kind === "sink");
    const mid = found.filter((o) => o.kind !== "source" && o.kind !== "sink");
    const byPos = (a, b) => {
      const za = ZONE_STAGE[a.el.zone], zb = ZONE_STAGE[b.el.zone];
      if (za != null && zb != null && za !== zb) return za - zb;
      if ((a.el.x | 0) !== (b.el.x | 0)) return (a.el.x | 0) - (b.el.x | 0);
      if ((a.el.y | 0) !== (b.el.y | 0)) return (a.el.y | 0) - (b.el.y | 0);
      return String(a.el.id) < String(b.el.id) ? -1 : 1;
    };
    src.sort(byPos); snk.sort(byPos); mid.sort(byPos);
    const ordered = src.concat(mid, snk);

    // Build the operations, reading cycle/servers from the domain def
    // (mfg-* carry cycleSec/servers/inputs/outputs) with honest fallbacks.
    const counters = {};
    const operations = ordered.map((o) => {
      const def = domainDef(o.el.type) || {};
      const kind = o.kind;
      counters[kind === "station" ? (o.el.zone || "station") : kind] =
        (counters[kind === "station" ? (o.el.zone || "station") : kind] || 0) + 1;
      const idx = counters[kind === "station" ? (o.el.zone || "station") : kind];
      const isProc = !!PROCESS_KINDS[kind];
      const fromDomain = Number.isFinite(def.cycleSec);
      const op = {
        id: "op-" + o.el.id,
        name: opNameFor(kind, o.el.zone, idx),
        elementId: o.el.id,
        kind: kind,
        cycleSec: isProc ? Math.round(clampPos(def.cycleSec, DEFAULT_STATION_CYCLE)) : 0,
        servers: isProc ? Math.max(1, Math.round(clampPos(def.servers, 1))) : 1,
        source: isProc
          ? (fromDomain ? "modelled (REFA/MTM-style estimate; editable)" : "modelled default (editable)")
          : "endpoint (not timed)",
      };
      if (kind === "assembly") op.inputs = Math.max(2, Math.round(clampPos(def.inputs, 2)));
      if (kind === "dismantle") op.outputs = Math.max(2, Math.round(clampPos(def.outputs, 2)));
      return op;
    });

    // Precedence = a linear chain along the flow order (the precedence graph).
    const precedence = [];
    for (let i = 0; i < operations.length - 1; i++) {
      precedence.push([operations[i].id, operations[i + 1].id]);
    }

    // Routing = the from-to FLOW matrix. Offered flow starts at the source
    // emit rate and is carried through the gozinto (dismantle multiplies the
    // part count, assembly divides it). This is the intended flow; achievable
    // throughput is computed from cycle times in metrics().
    const srcDef = domainDef("mfg-source") || {};
    let flow = clampPos(opts.sourceRate, clampPos(srcDef.emitRatePerHr, DEFAULT_SOURCE_RATE));
    const routing = [];
    for (let i = 0; i < operations.length - 1; i++) {
      const cur = operations[i + 1]; // the op the arc feeds INTO
      routing.push({ from: operations[i].id, to: cur.id, unitsPerHr: Math.round(flow) });
      if (cur.kind === "dismantle") flow *= cur.outputs;
      else if (cur.kind === "assembly") flow /= cur.inputs;
    }

    return sanitize({
      version: PROC_VERSION,
      shiftSec: Math.round(clampPos(opts.shiftSec, DEFAULT_SHIFT_SEC)),
      demandPerShift: Math.round(clampPos(opts.demandPerShift, DEFAULT_DEMAND)),
      operations: operations,
      precedence: precedence,
      routing: routing,
    });
  }

  /* ==================================================================
   * SANITIZE / REBUILD / EMBED - the wt-1 serialize round-trip. Mirrors
   * WT.library.embedInto: embedInto() adds obj.process ONLY when a process
   * block is present, so a warehouse layout stays BYTE-IDENTICAL. rebuild()
   * coerces a deserialized block back to the canonical shape (drops unknown
   * keys -> forward-compatible), deterministic key order both ways.
   * ================================================================== */
  function sanitize(block) {
    if (!block || typeof block !== "object") return null;
    const ops = Array.isArray(block.operations) ? block.operations : [];
    const validIds = {};
    const operations = [];
    for (const raw of ops) {
      if (!raw || typeof raw.id !== "string" || typeof raw.elementId !== "string") continue;
      const kind = OP_KIND[raw.kind] ? raw.kind : (raw.kind === "source" || raw.kind === "sink" ||
        raw.kind === "station" || raw.kind === "parallel" || raw.kind === "assembly" ||
        raw.kind === "dismantle" ? raw.kind : "station");
      const isProc = !!PROCESS_KINDS[kind];
      const op = {
        id: raw.id,
        name: typeof raw.name === "string" ? raw.name : raw.id,
        elementId: raw.elementId,
        kind: kind,
        cycleSec: isProc ? Math.max(0, Math.round(num(raw.cycleSec, DEFAULT_STATION_CYCLE))) : 0,
        servers: isProc ? Math.max(1, Math.round(num(raw.servers, 1))) : 1,
        source: typeof raw.source === "string" ? raw.source : "modelled (editable)",
      };
      if (kind === "assembly") op.inputs = Math.max(2, Math.round(num(raw.inputs, 2)));
      if (kind === "dismantle") op.outputs = Math.max(2, Math.round(num(raw.outputs, 2)));
      operations.push(op);
      validIds[op.id] = 1;
    }
    const precedence = [];
    if (Array.isArray(block.precedence)) {
      for (const p of block.precedence) {
        if (Array.isArray(p) && p.length === 2 && validIds[p[0]] && validIds[p[1]] && p[0] !== p[1]) {
          precedence.push([p[0], p[1]]);
        }
      }
    }
    const routing = [];
    if (Array.isArray(block.routing)) {
      for (const r of block.routing) {
        if (r && validIds[r.from] && validIds[r.to] && r.from !== r.to) {
          const arc = { from: r.from, to: r.to, unitsPerHr: Math.max(0, Math.round(num(r.unitsPerHr, 0))) };
          // v3.17: keep the OPTIONAL split ratio ONLY when declared, so a
          // block with no ratios (every existing scenario) serializes
          // BYTE-IDENTICALLY to before.
          const rr = Number(r.ratio);
          if (Number.isFinite(rr) && rr > 0 && rr <= 1) arc.ratio = round4(rr);
          routing.push(arc);
        }
      }
    }
    return {
      version: PROC_VERSION,
      shiftSec: Math.max(1, Math.round(clampPos(block.shiftSec, DEFAULT_SHIFT_SEC))),
      demandPerShift: Math.max(1, Math.round(clampPos(block.demandPerShift, DEFAULT_DEMAND))),
      operations: operations,
      precedence: precedence,
      routing: routing,
    };
  }
  function rebuild(obj) {
    if (!obj || typeof obj !== "object" || !obj.process) return null;
    const b = sanitize(obj.process);
    return b && b.operations.length ? b : null;
  }
  // Mutates `obj` ONLY when a process block is present -> byte-identical
  // (no `process` key) for a warehouse layout. Returns obj either way.
  function embedInto(obj, block) {
    const b = block && block.operations && block.operations.length ? sanitize(block) : null;
    if (b) obj.process = b;
    return obj;
  }

  /* ==================================================================
   * ORDER + GOZINTO - the ordered station list along the precedence chain,
   * and each station's cyclesPerFinished (gozinto multiplier: how many
   * cycles that station runs per ONE finished unit at the drain). Assembly
   * (inputs -> 1) makes upstream run MORE cycles; dismantle (1 -> outputs)
   * makes downstream run fewer.
   * ================================================================== */
  function orderedOps(block) {
    const ops = block.operations;
    const byId = {};
    for (const o of ops) byId[o.id] = o;
    const succ = {}, indeg = {};
    for (const o of ops) indeg[o.id] = 0;
    for (const [a, b] of block.precedence) { if (byId[a] && byId[b]) { succ[a] = b; indeg[b] = (indeg[b] || 0) + 1; } }
    // Start at the operation with no predecessor (the source of the chain).
    let start = ops.find((o) => indeg[o.id] === 0) || ops[0];
    const order = [];
    const seen = {};
    let cur = start;
    while (cur && !seen[cur.id]) { seen[cur.id] = 1; order.push(cur); cur = byId[succ[cur.id]]; }
    // Append any ops not reached by the linear walk (robustness for edits).
    for (const o of ops) if (!seen[o.id]) order.push(o);
    return order;
  }

  // Attach cyclesPerFinished (a gozinto multiplier) to each op via a
  // BACKWARD pass from the drain. Returns { order, stations } where stations
  // are the process ops (source/sink excluded).
  function annotate(block) {
    const order = orderedOps(block);
    // outParts = parts leaving a station per ONE finished unit. The station
    // feeding the sink outputs 1 finished unit -> start downOut = 1.
    let downOut = 1;
    // Walk backward over PROCESS stations only (skip source/sink endpoints).
    const procIdx = [];
    for (let i = 0; i < order.length; i++) if (PROCESS_KINDS[order[i].kind]) procIdx.push(i);
    for (let k = procIdx.length - 1; k >= 0; k--) {
      const op = order[procIdx[k]];
      let inParts, cyclesPerFinished;
      if (op.kind === "assembly") {
        cyclesPerFinished = downOut;                 // one cycle per output
        inParts = downOut * (op.inputs || 2);        // needs `inputs` per output
      } else if (op.kind === "dismantle") {
        inParts = downOut / (op.outputs || 2);       // one input -> `outputs`
        cyclesPerFinished = inParts;                 // one cycle per input
      } else {
        cyclesPerFinished = downOut;                 // plain / parallel: 1:1
        inParts = downOut;
      }
      op._cyclesPerFinished = cyclesPerFinished;
      op._effTimePerFinished = (cyclesPerFinished * op.cycleSec) / Math.max(1, op.servers);
      downOut = inParts;
    }
    const stations = procIdx.map((i) => order[i]);
    return { order: order, stations: stations };
  }

  /* ==================================================================
   * METRICS - the analytical, exact, deterministic line metrics. Headline
   * figures (throughput + the named bottleneck) come from cycle times; WIP
   * + lead time come from the line sim. Every figure is honest + labelled.
   * ================================================================== */
  function metrics(block, opts) {
    block = sanitize(block);
    if (!block || !block.operations.length) return null;
    // v3.17: a block that DECLARES multi-way routing (a split or a merge in
    // the from-to arcs) is computed on the resolved proportional-flow
    // network. Every plain-chain block takes the EXACT legacy path below -
    // byte-identical output.
    if (isMultiway(block)) return metricsFlow(block, opts);
    const a = annotate(block);
    const stations = a.stations;

    const takt = block.shiftSec / Math.max(1, block.demandPerShift);
    // Bottleneck = the station with the greatest effective time per finished
    // unit (Theory of Constraints). Ties -> the earliest in the flow order.
    let bottleneck = null;
    let sumEff = 0;
    for (const s of stations) {
      sumEff += s._effTimePerFinished;
      if (!bottleneck || s._effTimePerFinished > bottleneck._effTimePerFinished + 1e-9) bottleneck = s;
    }
    const bTime = bottleneck ? bottleneck._effTimePerFinished : 0; // s per finished unit
    const throughputPerHr = bTime > 0 ? 3600 / bTime : 0;
    const stationMetrics = stations.map((s) => ({
      opId: s.id,
      name: s.name,
      kind: s.kind,
      elementId: s.elementId,
      cycleSec: s.cycleSec,
      servers: s.servers,
      cyclesPerFinished: round4(s._cyclesPerFinished),
      effTimeSec: round4(s._effTimePerFinished),
      // Utilisation relative to the bottleneck (busy fraction when the line
      // runs at its own max rate) -> guaranteed in [0,1], =1 at the bottleneck.
      utilisation: bTime > 0 ? round4(s._effTimePerFinished / bTime) : 0,
      // Load vs takt (can exceed 1 = over-demand): reported separately, honest.
      taktLoad: takt > 0 ? round4(s._effTimePerFinished / takt) : 0,
      isBottleneck: s === bottleneck,
    }));
    const nStations = stations.length;
    const lineEfficiency = nStations > 0 && bTime > 0 ? sumEff / (nStations * bTime) : 0;
    const theoreticalMinStations = takt > 0 ? Math.ceil(sumEff / takt) : nStations;

    const sim = simulate(block, opts);

    return {
      version: PROC_VERSION,
      basis: "Theory of Constraints (bottleneck), takt time, line efficiency, Little's Law",
      honesty: HONESTY,
      shiftSec: block.shiftSec,
      demandPerShift: block.demandPerShift,
      taktSec: round4(takt),
      throughputPerHr: round4(throughputPerHr),
      demandMet: takt > 0 ? throughputPerHr >= 3600 / takt - 1e-6 : true,
      bottleneck: bottleneck ? { opId: bottleneck.id, name: bottleneck.name, effTimeSec: round4(bTime) } : null,
      lineEfficiency: round4(lineEfficiency),
      balanceDelayPct: round4((1 - lineEfficiency) * 100),
      theoreticalMinStations: theoreticalMinStations,
      stationsUsed: nStations,
      stations: stationMetrics,
      // WIP + lead time (Little's Law) measured on the deterministic sim.
      wip: round4(sim.wip),
      leadTimeSec: round4(sim.leadTimeSec),
      partFlowPerHr: round4(sim.partFlowPerHr),
      little: sim.little,
      sim: {
        measuredThroughputPerHr: round4(sim.throughputPerHr),
        finished: sim.finished,
        windowSec: sim.windowSec,
        utilisation: sim.utilisation, // opId -> measured busy fraction [0,1]
      },
    };
  }
  function round4(v) { return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0; }

  /* ==================================================================
   * SIMULATE - the deterministic token line simulation. Flows PART tokens
   * through the ordered stations honouring cycleSec + servers, with REAL
   * assembly (consume `inputs` -> emit 1) and dismantle (consume 1 -> emit
   * `outputs`). Finite per-station buffers (BLOCKING) keep WIP bounded and
   * the line at steady state. Integer-second ticks. NO Date, NO RNG ->
   * byte-identical across runs. Measures throughput, per-station busy
   * fraction, time-average WIP and mean lead time (for Little's Law).
   * ================================================================== */
  function simulate(block, opts) {
    opts = opts || {};
    block = sanitize(block);
    // v3.17: a multi-way block flows on the resolved network; a plain chain
    // takes the EXACT legacy path below (byte-identical results).
    if (isMultiway(block)) return simulateFlow(block, opts);
    const a = annotate(block);
    const order = a.order;
    const stations = a.stations;
    const n = stations.length;

    // Effective bottleneck time (s / finished unit) sizes the horizons so the
    // run always reaches steady state and samples enough finished units.
    let bTime = 0;
    for (const s of stations) bTime = Math.max(bTime, s._effTimePerFinished);
    bTime = Math.max(1, bTime);

    const bufferCap = Math.max(6, num(opts.bufferCap, 8)); // parts per input buffer
    const warmupSec = Math.max(2000, Math.ceil(80 * bTime) + 60 * n);
    const measureSec = Math.max(20000, Math.ceil(240 * bTime));
    const totalSec = warmupSec + measureSec;

    // Build the runtime stations (index 0..n-1 in flow order). Each carries
    // an input queue of tokens, a fixed pool of servers, and its transform.
    const S = stations.map((s) => ({
      op: s,
      kind: s.kind,
      cycleSec: Math.max(1, s.cycleSec),
      servers: Math.max(1, s.servers),
      inputs: s.inputs || 1,
      outputs: s.outputs || 1,
      bufferCap: bufferCap,            // finite input buffer (BLOCKING) -> bounded WIP
      queue: [],                       // waiting tokens
      pool: [],                        // busy/blocked servers: {rem, out|null, held}
      busySec: 0,                      // accumulated busy server-seconds (window)
    }));
    for (const st of S) for (let k = 0; k < st.servers; k++) st.pool.push({ rem: -1, out: null });

    // Token bookkeeping for Little's Law (birth-death population).
    let live = 0;                      // live tokens in the system
    let sumLdt = 0;                    // integral of live over the measurement window
    let deaths = 0;                    // token deaths in the window
    let lifeSum = 0;                   // sum of lifetimes of tokens that died in window
    let finished = 0;                  // finished units delivered to the drain (window)
    // Source rate: emit into station 0 whenever its buffer has room.

    function inWindow(t) { return t >= warmupSec; }

    for (let t = 0; t < totalSec; t++) {
      const win = inWindow(t);

      // --- Phase 1: advance services; on completion, transform + try deliver
      for (let i = 0; i < S.length; i++) {
        const st = S[i];
        const next = S[i + 1]; // undefined -> deliver to the drain (sink)
        for (const srv of st.pool) {
          if (srv.rem < 0) continue;      // idle
          if (srv.rem > 0) srv.rem -= 1;  // one second of work
          if (srv.rem === 0 && srv.out === null) {
            // Service just completed: realise the transform (births/deaths).
            if (st.kind === "assembly") {
              // consume `inputs` held tokens -> emit 1
              for (const tok of srv.held) { if (win) { deaths++; lifeSum += (t - tok.birth); } live--; }
              srv.out = [{ birth: t }]; live++;
            } else if (st.kind === "dismantle") {
              const tok = srv.held[0];
              if (win) { deaths++; lifeSum += (t - tok.birth); } live--;   // input consumed
              srv.out = [];
              for (let k = 0; k < st.outputs; k++) { srv.out.push({ birth: t }); live++; }
            } else {
              srv.out = srv.held;         // plain / parallel: token continues
            }
            srv.held = null;
          }
          if (srv.rem === 0 && srv.out !== null) {
            // Try to deliver the finished output(s) downstream (BLOCKING).
            if (!next) {
              // Deliver to the drain: each output is a finished unit + a death.
              for (const tok of srv.out) { if (win) { deaths++; lifeSum += (t - tok.birth); finished++; } live--; }
              srv.out = null; srv.rem = -1; // free the server
            } else if (next.queue.length + srv.out.length <= next.bufferCap) {
              for (const tok of srv.out) next.queue.push(tok);
              srv.out = null; srv.rem = -1;
            } // else: blocked, retry next tick (server stays occupied)
          }
        }
      }

      // --- Phase 2: source emits into station 0 while its buffer has room
      if (S.length && S[0].queue.length < S[0].bufferCap) { S[0].queue.push({ birth: t }); live++; }

      // --- Phase 3: start new services on idle servers with enough input
      for (const st of S) {
        const need = st.kind === "assembly" ? st.inputs : 1;
        for (const srv of st.pool) {
          if (srv.rem >= 0) continue;      // occupied (busy or blocked)
          if (st.queue.length < need) break; // not enough input tokens
          srv.held = st.queue.splice(0, need);
          srv.rem = st.cycleSec;
        }
      }

      // --- Phase 4: accumulate busy server-seconds + WIP integral (window)
      if (win) {
        for (const st of S) {
          let busy = 0;
          for (const srv of st.pool) if (srv.rem >= 0) busy++;
          st.busySec += busy;
        }
        sumLdt += live;
      }
    }

    const windowSec = measureSec;
    const utilisation = {};
    for (const st of S) utilisation[st.op.id] = round4(st.busySec / (st.servers * windowSec));
    const wip = sumLdt / windowSec;                 // time-average live tokens
    const lambda = deaths / windowSec;              // token birth/death rate (/s)
    const W = deaths > 0 ? lifeSum / deaths : 0;     // mean token lifetime (s)
    const littlePred = lambda * W;
    const littleResidualRel = wip > 0 ? Math.abs(wip - littlePred) / wip : 0;

    return {
      throughputPerHr: (finished / windowSec) * 3600,
      finished: finished,
      windowSec: windowSec,
      warmupSec: warmupSec,
      wip: wip,
      leadTimeSec: W,
      partFlowPerHr: lambda * 3600,
      utilisation: utilisation,
      little: { L: round4(wip), lambda: round4(lambda), W: round4(W), predictedL: round4(littlePred), residualRel: round4(littleResidualRel) },
    };
  }

  /* ==================================================================
   * v3.17 MULTI-WAY PROPORTIONAL-FLOW ROUTING
   * ------------------------------------------------------------------
   * Until v3.16 the routing arcs were STRUCTURAL: a branched from-to
   * network could be declared and serialized, but annotate()/simulate()/
   * metrics() flattened everything onto ONE linear chain (the succ walk
   * keeps a single successor and the token sim pushes every part through
   * every station serially). From v3.17 a block that DECLARES a split
   * (>= 2 outgoing arcs) or a merge (>= 2 incoming arcs) is RESOLVED into
   * a proportional flow network:
   *   - each outgoing arc of a split carries a declared `ratio`; the
   *     ratios must sum to ~1 (validated with a friendly message)
   *   - flow ACCUMULATES at merges (sum of incoming arc flows)
   *   - assembly divides (inputs -> 1) and dismantle multiplies (1 ->
   *     outputs) the flow exactly as on the chain
   *   - conservation holds at every node: flow out == transformed flow in
   * The SAME Theory-of-Constraints / takt / line-efficiency / Little's Law
   * formulas then run on the resolved per-finished-unit station loads, and
   * the token sim flows the network with a DETERMINISTIC largest-deficit
   * quota dispatcher at each split (NO RNG - exact long-run proportions).
   * Plain-chain blocks NEVER enter this path (byte-identical legacy).
   * ================================================================== */

  // Does the routing declare a split or a merge? (Counting raw arcs, so a
  // duplicated from-to pair also lands here and gets a friendly rejection.)
  function isMultiway(block) {
    if (!block || !Array.isArray(block.routing) || !Array.isArray(block.operations)) return false;
    const outdeg = {}, indeg = {};
    for (const r of block.routing) {
      if (!r) continue;
      outdeg[r.from] = (outdeg[r.from] || 0) + 1;
      indeg[r.to] = (indeg[r.to] || 0) + 1;
      if (outdeg[r.from] > 1 || indeg[r.to] > 1) return true;
    }
    return false;
  }

  // Build the routing NETWORK view of a sanitized block: arc adjacency, a
  // deterministic topological order, split/merge counts and every friendly
  // validation message. Internal - callers pass a sanitize()d block.
  function analyzeNet(block) {
    const ops = block.operations;
    const arcs = block.routing || [];
    const byId = {}, opIndex = {};
    ops.forEach((o, i) => { byId[o.id] = o; opIndex[o.id] = i; });
    const nameOf = (id) => (byId[id] ? byId[id].name : String(id));
    const outArcs = {}, inArcs = {};
    for (const o of ops) { outArcs[o.id] = []; inArcs[o.id] = []; }
    const errors = [];
    const seenPair = {};
    arcs.forEach((r, i) => {
      outArcs[r.from].push(i);
      inArcs[r.to].push(i);
      const key = r.from + " " + r.to;
      if (seenPair[key]) {
        errors.push('There are two routing arcs from "' + nameOf(r.from) + '" to "' + nameOf(r.to) +
          '" - keep one arc per direction (one arc carries that branch\'s whole share).');
      }
      seenPair[key] = 1;
    });
    let multiway = false;
    for (const o of ops) {
      if (outArcs[o.id].length > 1 || inArcs[o.id].length > 1) { multiway = true; break; }
    }
    const sources = ops.filter((o) => o.kind === "source");
    const sinks = ops.filter((o) => o.kind === "sink");
    if (sources.length !== 1 || sinks.length !== 1) {
      errors.push("Multi-way routing needs exactly one Parts source and one Finished drain (this process has " +
        sources.length + " source(s) and " + sinks.length + " drain(s)).");
    }
    const sourceId = sources.length ? sources[0].id : null;
    const sinkId = sinks.length ? sinks[0].id : null;
    if (sourceId != null && sinkId != null) {
      for (const ai of outArcs[sourceId]) {
        if (arcs[ai].to === sinkId) {
          errors.push('A routing arc runs straight from "' + nameOf(sourceId) + '" to "' + nameOf(sinkId) +
            '", skipping every station - remove it (flow must pass through the line).');
        }
      }
    }
    if (sourceId != null && !outArcs[sourceId].length) {
      errors.push("The flow network needs at least one routing arc leaving the Parts source.");
    }
    // SPLIT ratios: every outgoing arc of a split must declare a ratio and
    // the ratios must sum to ~1 (the friendly, rejected-not-guessed rule).
    for (const o of ops) {
      const oa = outArcs[o.id];
      if (oa.length < 2) continue;
      let sum = 0, allDeclared = true;
      for (const ai of oa) {
        const arc = arcs[ai];
        if (typeof arc.ratio !== "number") {
          allDeclared = false;
          errors.push('Split at "' + o.name + '": flow divides ' + oa.length +
            ' ways, so every outgoing arc needs a ratio - the arc to "' + nameOf(arc.to) +
            '" has none. Give each branch its share (e.g. 0.6 and 0.4).');
        } else {
          sum += arc.ratio;
        }
      }
      if (allDeclared && Math.abs(sum - 1) > 0.001) {
        errors.push('Split at "' + o.name + '": the branch ratios sum to ' + round4(sum) +
          ', not 1 - adjust them so the shares add up to 1 (e.g. 0.6 + 0.4).');
      }
    }
    // Deterministic topological order (Kahn; ties broken by operation order).
    const indeg = {};
    for (const o of ops) indeg[o.id] = inArcs[o.id].length;
    const avail = ops.filter((o) => indeg[o.id] === 0).map((o) => o.id);
    const topo = [];
    while (avail.length) {
      avail.sort((a, b) => opIndex[a] - opIndex[b]);
      const id = avail.shift();
      topo.push(id);
      for (const ai of outArcs[id]) {
        const to = arcs[ai].to;
        if (--indeg[to] === 0) avail.push(to);
      }
    }
    if (topo.length < ops.length) {
      const stuck = ops.find((o) => indeg[o.id] > 0);
      errors.push('The routing loops back on itself (through "' + (stuck ? stuck.name : "?") +
        '") - proportional flow needs a forward-only network.');
    }
    // Reachability: every timed station must sit ON the source-to-drain flow.
    if (sourceId != null && sinkId != null && topo.length === ops.length) {
      const fwd = {}; const stack1 = [sourceId]; fwd[sourceId] = 1;
      while (stack1.length) {
        const id = stack1.pop();
        for (const ai of outArcs[id]) { const to = arcs[ai].to; if (!fwd[to]) { fwd[to] = 1; stack1.push(to); } }
      }
      const bwd = {}; const stack2 = [sinkId]; bwd[sinkId] = 1;
      while (stack2.length) {
        const id = stack2.pop();
        for (const ai of inArcs[id]) { const fr = arcs[ai].from; if (!bwd[fr]) { bwd[fr] = 1; stack2.push(fr); } }
      }
      for (const o of ops) {
        if (!PROCESS_KINDS[o.kind]) continue;
        if (!fwd[o.id] || !bwd[o.id]) {
          errors.push('"' + o.name + '" is not connected to the source-to-drain flow - add routing arcs from/to it, or remove it from the process.');
        }
      }
    }
    let splits = 0, merges = 0;
    for (const o of ops) {
      if (outArcs[o.id].length > 1) splits++;
      if (inArcs[o.id].length > 1) merges++;
    }
    return {
      ops: ops, arcs: arcs, byId: byId, opIndex: opIndex,
      outArcs: outArcs, inArcs: inArcs, topo: topo,
      sourceId: sourceId, sinkId: sinkId,
      splits: splits, merges: merges,
      multiway: multiway, errors: errors,
    };
  }

  // PUBLIC validation. A plain-chain block is always ok (the legacy path is
  // authoritative there); a multi-way block returns every friendly message.
  function validateFlow(block) {
    block = sanitize(block);
    if (!block || !block.operations.length) return { ok: false, multiway: false, errors: ["No operations in the process block."] };
    const net = analyzeNet(block);
    if (!net.multiway) return { ok: true, multiway: false, errors: [] };
    return { ok: net.errors.length === 0, multiway: true, errors: net.errors };
  }

  /* ==================================================================
   * RESOLVE FLOW - propagate the offered source rate through the network:
   * split arcs carry out * ratio, merges accumulate, assembly divides and
   * dismantle multiplies. Deterministic, exact arithmetic; returns the
   * per-node flows, each station's cyclesPerFinished / effective time (the
   * SAME quantities the TOC metrics run on) and a node-by-node
   * CONSERVATION check (flow out == transformed flow in, residual ~0).
   * ================================================================== */
  function resolveFlow(block, opts) {
    opts = opts || {};
    block = sanitize(block);
    if (!block || !block.operations.length) return { ok: false, multiway: false, errors: ["No operations in the process block."] };
    const net = analyzeNet(block);
    if (net.errors.length) return { ok: false, multiway: net.multiway, errors: net.errors };
    const arcs = net.arcs;
    // Offered rate: the stored flow leaving the source (fallback: default).
    let R = 0;
    for (const ai of net.outArcs[net.sourceId]) R += arcs[ai].unitsPerHr;
    R = clampPos(opts.sourceRate, clampPos(R, DEFAULT_SOURCE_RATE));
    const inFlow = {}, outFlow = {}, cycFlow = {};
    for (const o of net.ops) { inFlow[o.id] = 0; outFlow[o.id] = 0; cycFlow[o.id] = 0; }
    const arcFlow = new Array(arcs.length).fill(0);
    let finished = 0;
    for (const id of net.topo) {
      const o = net.byId[id];
      let out;
      if (o.kind === "source") { out = R; cycFlow[id] = 0; }
      else if (o.kind === "sink") { out = 0; cycFlow[id] = 0; finished = inFlow[id]; }
      else if (o.kind === "assembly") { cycFlow[id] = inFlow[id] / (o.inputs || 2); out = cycFlow[id]; }
      else if (o.kind === "dismantle") { cycFlow[id] = inFlow[id]; out = inFlow[id] * (o.outputs || 2); }
      else { cycFlow[id] = inFlow[id]; out = inFlow[id]; }
      outFlow[id] = out;
      const oa = net.outArcs[id];
      for (const ai of oa) {
        const share = oa.length > 1 ? arcs[ai].ratio : 1;
        arcFlow[ai] = out * share;
        inFlow[arcs[ai].to] += arcFlow[ai];
      }
    }
    // Conservation: at every node the outgoing arc flows sum to the node's
    // transformed output (exact up to float rounding - verified, not assumed).
    let maxResidual = 0;
    for (const o of net.ops) {
      const oa = net.outArcs[o.id];
      if (!oa.length) continue;
      let s = 0;
      for (const ai of oa) s += arcFlow[ai];
      maxResidual = Math.max(maxResidual, Math.abs(s - outFlow[o.id]));
    }
    const nodes = {};
    for (const o of net.ops) {
      const isProc = !!PROCESS_KINDS[o.kind];
      const cpf = isProc && finished > 0 ? cycFlow[o.id] / finished : 0;
      nodes[o.id] = {
        kind: o.kind,
        inPerHr: inFlow[o.id],
        cyclesPerHr: cycFlow[o.id],
        outPerHr: o.kind === "sink" ? inFlow[o.id] : outFlow[o.id],
        cyclesPerFinished: cpf,
        effTimeSec: isProc ? (cpf * o.cycleSec) / Math.max(1, o.servers) : 0,
      };
    }
    return {
      ok: true,
      multiway: net.multiway,
      errors: [],
      order: net.topo.slice(),
      sourceRatePerHr: R,
      finishedPerHr: finished,
      nodes: nodes,
      arcs: arcs.map((r, i) => ({
        from: r.from, to: r.to,
        ratio: round4(net.outArcs[r.from].length > 1 ? r.ratio : 1),
        unitsPerHr: round4(arcFlow[i]),
      })),
      splits: net.splits,
      merges: net.merges,
      conservation: { ok: maxResidual <= 1e-6 * Math.max(1, R), maxAbsResidualPerHr: maxResidual },
    };
  }

  /* ==================================================================
   * SIMULATE FLOW - the deterministic token sim on the resolved network.
   * Identical mechanics to the legacy chain sim (same 4 phases, finite
   * blocking buffers, integer-second ticks, Little's Law bookkeeping) with
   * ONE addition: at a split, each completed token is dispatched to the
   * outgoing arc with the LARGEST REMAINING QUOTA (ratio * dispatched-so-
   * far minus already-sent) - deterministic, NO RNG, exact long-run
   * proportions. On a plain chain it reduces to the single next-station
   * delivery and reproduces the legacy sim BYTE-IDENTICALLY.
   * ================================================================== */
  function simulateFlow(block, opts) {
    opts = opts || {};
    block = sanitize(block);
    if (!block || !block.operations.length) throw new Error("No operations in the process block.");
    const net = analyzeNet(block);
    if (net.errors.length) throw new Error(net.errors.join(" "));
    const arcs = net.arcs;
    const stations = [];
    const stIdx = {}; // opId -> station index (process ops only)
    for (const id of net.topo) {
      const o = net.byId[id];
      if (PROCESS_KINDS[o.kind]) { stIdx[id] = stations.length; stations.push(o); }
    }
    const n = stations.length;
    if (!n) throw new Error("No timed stations on the flow network.");

    // Effective bottleneck time sizes the horizons (same formulas as the
    // legacy sim). Plain chain -> annotate() (the EXACT legacy numbers, so
    // the run windows match byte-for-byte); multi-way -> the resolved flow.
    let bTime = 1;
    if (net.multiway) {
      const rf = resolveFlow(block, opts);
      if (!rf.ok) throw new Error(rf.errors.join(" "));
      for (const s of stations) bTime = Math.max(bTime, rf.nodes[s.id].effTimeSec);
    } else {
      annotate(block); // attaches _effTimePerFinished to the ops of THIS sanitized copy
      for (const s of stations) bTime = Math.max(bTime, s._effTimePerFinished || 0);
      bTime = Math.max(1, bTime);
    }

    const bufferCap = Math.max(6, num(opts.bufferCap, 8));
    const warmupSec = Math.max(2000, Math.ceil(80 * bTime) + 60 * n);
    const measureSec = Math.max(20000, Math.ceil(240 * bTime));
    const totalSec = warmupSec + measureSec;

    const S = stations.map((s) => ({
      op: s,
      kind: s.kind,
      cycleSec: Math.max(1, s.cycleSec),
      servers: Math.max(1, s.servers),
      inputs: s.inputs || 1,
      outputs: s.outputs || 1,
      bufferCap: bufferCap,
      queue: [],
      pool: [],
      busySec: 0,
      outEdges: [],       // { toIdx (-1 = drain), ratio, sent }
      dispatchTotal: 0,   // tokens dispatched across this station's splits
    }));
    for (const st of S) for (let k = 0; k < st.servers; k++) st.pool.push({ rem: -1, groups: null, held: null });
    for (const st of S) {
      const oa = net.outArcs[st.op.id];
      for (const ai of oa) {
        const to = arcs[ai].to;
        st.outEdges.push({
          toIdx: stIdx[to] !== undefined ? stIdx[to] : -1,
          ratio: oa.length > 1 ? arcs[ai].ratio : 1,
          sent: 0,
        });
      }
      // No outgoing arc (robustness): deliver to the drain like the legacy sim.
      if (!st.outEdges.length) st.outEdges.push({ toIdx: -1, ratio: 1, sent: 0 });
    }
    // The source's own arcs (emission targets) share the same dispatcher.
    const srcEdges = [];
    let srcTotal = 0;
    for (const ai of net.outArcs[net.sourceId]) {
      const to = arcs[ai].to;
      const oa = net.outArcs[net.sourceId];
      srcEdges.push({ toIdx: stIdx[to] !== undefined ? stIdx[to] : -1, ratio: oa.length > 1 ? arcs[ai].ratio : 1, sent: 0 });
    }

    // Largest-remaining-quota pick: deterministic, ties -> the earliest arc.
    function pickEdge(edges, total) {
      let best = 0, bestDef = -Infinity;
      for (let i = 0; i < edges.length; i++) {
        const def = edges[i].ratio * (total + 1) - edges[i].sent;
        if (def > bestDef + 1e-12) { bestDef = def; best = i; }
      }
      return best;
    }
    // Assign completed output tokens to out-edges (one group per edge).
    function assignGroups(st, toks) {
      if (st.outEdges.length === 1) {
        st.outEdges[0].sent += toks.length;
        st.dispatchTotal += toks.length;
        return [{ edge: st.outEdges[0], toks: toks }];
      }
      const groups = st.outEdges.map((e) => ({ edge: e, toks: [] }));
      for (const tok of toks) {
        const i = pickEdge(st.outEdges, st.dispatchTotal);
        st.outEdges[i].sent++;
        st.dispatchTotal++;
        groups[i].toks.push(tok);
      }
      return groups.filter((g) => g.toks.length);
    }

    let live = 0, sumLdt = 0, deaths = 0, lifeSum = 0, finished = 0;
    function inWindow(t) { return t >= warmupSec; }

    for (let t = 0; t < totalSec; t++) {
      const win = inWindow(t);

      // --- Phase 1: advance services; on completion, transform + dispatch +
      // try to deliver each per-arc group (all-or-nothing per arc, BLOCKING).
      for (let i = 0; i < S.length; i++) {
        const st = S[i];
        for (const srv of st.pool) {
          if (srv.rem < 0) continue;
          if (srv.rem > 0) srv.rem -= 1;
          if (srv.rem === 0 && srv.groups === null) {
            let outToks;
            if (st.kind === "assembly") {
              for (const tok of srv.held) { if (win) { deaths++; lifeSum += (t - tok.birth); } live--; }
              outToks = [{ birth: t }]; live++;
            } else if (st.kind === "dismantle") {
              const tok = srv.held[0];
              if (win) { deaths++; lifeSum += (t - tok.birth); } live--;
              outToks = [];
              for (let k = 0; k < st.outputs; k++) { outToks.push({ birth: t }); live++; }
            } else {
              outToks = srv.held;
            }
            srv.held = null;
            srv.groups = assignGroups(st, outToks);
          }
          if (srv.rem === 0 && srv.groups !== null) {
            const rest = [];
            for (const g of srv.groups) {
              if (g.edge.toIdx === -1) {
                for (const tok of g.toks) { if (win) { deaths++; lifeSum += (t - tok.birth); finished++; } live--; }
              } else {
                const next = S[g.edge.toIdx];
                if (next.queue.length + g.toks.length <= next.bufferCap) {
                  for (const tok of g.toks) next.queue.push(tok);
                } else {
                  rest.push(g); // blocked on THIS arc, retry next tick
                }
              }
            }
            srv.groups = rest.length ? rest : null;
            if (srv.groups === null) srv.rem = -1; // every group delivered -> free
          }
        }
      }

      // --- Phase 2: the source emits one token into its quota-picked branch
      // while that branch's buffer has room (blocked branch -> retry, no skip
      // of the quota so the long-run proportions stay exact).
      if (srcEdges.length) {
        const i = pickEdge(srcEdges, srcTotal);
        const e = srcEdges[i];
        if (e.toIdx === -1) {
          // degenerate direct-to-drain arc (validation rejects it for
          // multi-way): the token is born finished.
          if (inWindow(t)) { finished++; deaths++; }
          e.sent++; srcTotal++;
        } else if (S[e.toIdx].queue.length < S[e.toIdx].bufferCap) {
          S[e.toIdx].queue.push({ birth: t });
          live++;
          e.sent++; srcTotal++;
        }
      }

      // --- Phase 3: start new services on idle servers with enough input
      for (const st of S) {
        const need = st.kind === "assembly" ? st.inputs : 1;
        for (const srv of st.pool) {
          if (srv.rem >= 0) continue;
          if (st.queue.length < need) break;
          srv.held = st.queue.splice(0, need);
          srv.rem = st.cycleSec;
        }
      }

      // --- Phase 4: accumulate busy server-seconds + WIP integral (window)
      if (win) {
        for (const st of S) {
          let busy = 0;
          for (const srv of st.pool) if (srv.rem >= 0) busy++;
          st.busySec += busy;
        }
        sumLdt += live;
      }
    }

    const windowSec = measureSec;
    const utilisation = {};
    for (const st of S) utilisation[st.op.id] = round4(st.busySec / (st.servers * windowSec));
    const wip = sumLdt / windowSec;
    const lambda = deaths / windowSec;
    const W = deaths > 0 ? lifeSum / deaths : 0;
    const littlePred = lambda * W;
    const littleResidualRel = wip > 0 ? Math.abs(wip - littlePred) / wip : 0;

    return {
      throughputPerHr: (finished / windowSec) * 3600,
      finished: finished,
      windowSec: windowSec,
      warmupSec: warmupSec,
      wip: wip,
      leadTimeSec: W,
      partFlowPerHr: lambda * 3600,
      utilisation: utilisation,
      little: { L: round4(wip), lambda: round4(lambda), W: round4(W), predictedL: round4(littlePred), residualRel: round4(littleResidualRel) },
    };
  }

  /* ==================================================================
   * METRICS on the resolved flow network (multi-way blocks only). The SAME
   * TOC / takt / line-efficiency / Little's Law formulas as the legacy
   * metrics, fed with the network-resolved cyclesPerFinished, plus an
   * additive `flow` summary (splits/merges/arcs/conservation).
   * ================================================================== */
  function metricsFlow(block, opts) {
    const rf = resolveFlow(block, opts);
    if (!rf.ok) return null; // callers surface validateFlow()'s messages
    const stations = [];
    const byId = {};
    for (const o of block.operations) byId[o.id] = o;
    for (const id of rf.order) {
      const o = byId[id];
      if (o && PROCESS_KINDS[o.kind]) stations.push(o);
    }
    if (!stations.length) return null;

    const takt = block.shiftSec / Math.max(1, block.demandPerShift);
    let bottleneck = null, bEff = 0, sumEff = 0;
    for (const s of stations) {
      const eff = rf.nodes[s.id].effTimeSec;
      sumEff += eff;
      if (!bottleneck || eff > bEff + 1e-9) { bottleneck = s; bEff = eff; }
    }
    const bTime = bottleneck ? bEff : 0;
    const throughputPerHr = bTime > 0 ? 3600 / bTime : 0;
    const stationMetrics = stations.map((s) => {
      const nd = rf.nodes[s.id];
      return {
        opId: s.id,
        name: s.name,
        kind: s.kind,
        elementId: s.elementId,
        cycleSec: s.cycleSec,
        servers: s.servers,
        cyclesPerFinished: round4(nd.cyclesPerFinished),
        effTimeSec: round4(nd.effTimeSec),
        utilisation: bTime > 0 ? round4(nd.effTimeSec / bTime) : 0,
        taktLoad: takt > 0 ? round4(nd.effTimeSec / takt) : 0,
        isBottleneck: s === bottleneck,
        flowPerHr: round4(nd.inPerHr), // resolved inflow at the offered source rate
      };
    });
    const nStations = stations.length;
    const lineEfficiency = nStations > 0 && bTime > 0 ? sumEff / (nStations * bTime) : 0;
    const theoreticalMinStations = takt > 0 ? Math.ceil(sumEff / takt) : nStations;

    const sim = simulateFlow(block, opts);

    return {
      version: PROC_VERSION,
      basis: "Theory of Constraints (bottleneck), takt time, line efficiency, Little's Law - on the resolved proportional-flow network (declared split ratios, merge accumulation)",
      honesty: HONESTY,
      shiftSec: block.shiftSec,
      demandPerShift: block.demandPerShift,
      taktSec: round4(takt),
      throughputPerHr: round4(throughputPerHr),
      demandMet: takt > 0 ? throughputPerHr >= 3600 / takt - 1e-6 : true,
      bottleneck: bottleneck ? { opId: bottleneck.id, name: bottleneck.name, effTimeSec: round4(bTime) } : null,
      lineEfficiency: round4(lineEfficiency),
      balanceDelayPct: round4((1 - lineEfficiency) * 100),
      theoreticalMinStations: theoreticalMinStations,
      stationsUsed: nStations,
      stations: stationMetrics,
      wip: round4(sim.wip),
      leadTimeSec: round4(sim.leadTimeSec),
      partFlowPerHr: round4(sim.partFlowPerHr),
      little: sim.little,
      sim: {
        measuredThroughputPerHr: round4(sim.throughputPerHr),
        finished: sim.finished,
        windowSec: sim.windowSec,
        utilisation: sim.utilisation,
      },
      flow: {
        multiway: true,
        sourceRatePerHr: round4(rf.sourceRatePerHr),
        finishedPerHr: round4(rf.finishedPerHr),
        splits: rf.splits,
        merges: rf.merges,
        arcs: rf.arcs,
        conservation: {
          ok: rf.conservation.ok,
          maxAbsResidualPerHr: round4(rf.conservation.maxAbsResidualPerHr),
        },
      },
    };
  }

  /* ==================================================================
   * DEMO - a hand-computable split/merge line as a complete, importable
   * wt-1 layout with the process block embedded (Import JSON loads it; the
   * process survives the app's serialize round-trip via rebuild()).
   *   source -> Machining -> 60% QA fast lane / 40% QA deep test -> merge
   *   -> Pack & finish -> drain, offered 100 parts/hr.
   * Expected (exact): cyclesPerFinished 1 / 0.6 / 0.4 / 1; effective times
   * 30 / 24 / 32 / 25 s per finished unit; bottleneck = QA deep test at
   * 32 s -> throughput 112.5/hr; utilisation 0.9375 / 0.75 / 1 / 0.78125;
   * line efficiency 111/128 = 0.8672; resolved arc flows 100 / 60 / 40 /
   * 60 / 40 / 100 parts/hr (conserved at every node). Modelled, NOT a
   * validated DES - the same honesty as every process figure.
   * ================================================================== */
  function demoNetwork() {
    const obj = {
      version: "wt-1",
      gridW: 40,
      gridH: 24,
      cell: 1,
      elements: [
        { id: "fn-src", type: "mfg-source", x: 1, y: 10, w: 2, d: 2 },
        { id: "fn-mach", type: "mfg-station", x: 6, y: 10, w: 3, d: 2 },
        { id: "fn-qaf", type: "mfg-station", x: 13, y: 5, w: 3, d: 2 },
        { id: "fn-qad", type: "mfg-station", x: 13, y: 15, w: 3, d: 2 },
        { id: "fn-pack", type: "mfg-station", x: 20, y: 10, w: 3, d: 2 },
        { id: "fn-drain", type: "mfg-drain", x: 26, y: 10, w: 2, d: 2 },
      ],
    };
    const proc = sanitize({
      version: PROC_VERSION,
      shiftSec: DEFAULT_SHIFT_SEC,
      demandPerShift: DEFAULT_DEMAND,
      operations: [
        { id: "op-src", name: "Parts source", elementId: "fn-src", kind: "source", cycleSec: 0, servers: 1, source: "endpoint (not timed)" },
        { id: "op-mach", name: "Machining", elementId: "fn-mach", kind: "station", cycleSec: 30, servers: 1, source: "modelled demo (editable)" },
        { id: "op-qaf", name: "QA fast lane", elementId: "fn-qaf", kind: "station", cycleSec: 40, servers: 1, source: "modelled demo (editable)" },
        { id: "op-qad", name: "QA deep test", elementId: "fn-qad", kind: "station", cycleSec: 80, servers: 1, source: "modelled demo (editable)" },
        { id: "op-pack", name: "Pack & finish", elementId: "fn-pack", kind: "station", cycleSec: 25, servers: 1, source: "modelled demo (editable)" },
        { id: "op-drain", name: "Finished drain", elementId: "fn-drain", kind: "sink", cycleSec: 0, servers: 1, source: "endpoint (not timed)" },
      ],
      precedence: [
        ["op-src", "op-mach"],
        ["op-mach", "op-qaf"],
        ["op-mach", "op-qad"],
        ["op-qaf", "op-pack"],
        ["op-qad", "op-pack"],
        ["op-pack", "op-drain"],
      ],
      routing: [
        { from: "op-src", to: "op-mach", unitsPerHr: 100 },
        { from: "op-mach", to: "op-qaf", unitsPerHr: 60, ratio: 0.6 },
        { from: "op-mach", to: "op-qad", unitsPerHr: 40, ratio: 0.4 },
        { from: "op-qaf", to: "op-pack", unitsPerHr: 60 },
        { from: "op-qad", to: "op-pack", unitsPerHr: 40 },
        { from: "op-pack", to: "op-drain", unitsPerHr: 100 },
      ],
    });
    return embedInto(obj, proc);
  }

  WT.process = {
    VERSION: PROC_VERSION,
    HONESTY: HONESTY,
    OP_KIND: OP_KIND,
    derive: derive,
    sanitize: sanitize,
    rebuild: rebuild,
    embedInto: embedInto,
    metrics: metrics,
    simulate: simulate,
    annotate: annotate,
    orderedOps: orderedOps,
    // v3.17 multi-way proportional-flow routing
    isMultiway: isMultiway,
    validateFlow: validateFlow,
    resolveFlow: resolveFlow,
    simulateFlow: simulateFlow,
    demoNetwork: demoNetwork,
  };
})();
