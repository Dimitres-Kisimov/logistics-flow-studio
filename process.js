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
 *          routing:    [{from,to,unitsPerHr}, ...] // the from-to FLOW matrix
 *        }
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
          routing.push({ from: r.from, to: r.to, unitsPerHr: Math.max(0, Math.round(num(r.unitsPerHr, 0))) });
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
  };
})();
