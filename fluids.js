/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * fluids.js - deterministic STEADY-STATE continuous-flow model for the
 *             Fluids / process-industry components (v3.19 FLUIDS-FLOW)
 * ---------------------------------------------------------------------
 * Since v3.7 the app has the Fluids component family (Pipe / FluidSource /
 * FluidDrain / Tank / Mixer / Portioner / DePortioner) - placed and
 * rendered, but STATIC. This module gives them a PURE, DETERMINISTIC
 * steady-state continuous-flow solver (the roadmap's "Fluids continuous-
 * flow physics" parity item), computed ANALYTICALLY - no time stepping,
 * NO Date, NO RNG anywhere. Same layout -> byte-identical result.
 *
 * THE MODEL (all rates in m3/h, a single homogeneous incompressible
 * fluid; volume == mass conservation):
 *
 *   TOPOLOGY - fluid components CONNECT BY TOUCHING: two fluid elements
 *     form a junction when their footprints share an edge (>= 1 m of
 *     common boundary; corner-to-corner does NOT connect). Connected
 *     components of that junction graph are candidate NETWORKS. Flow
 *     DIRECTION is derived, never guessed loosely: multi-source BFS
 *     hop-distances from the supplies (dSrc) and to the drains (dDrn)
 *     orient every junction from the drain-farther to the drain-nearer
 *     element (ties broken by dSrc then element id - a total order, so
 *     the directed network is provably acyclic). Nothing flows INTO a
 *     source or OUT of a drain.
 *
 *   ELEMENT BEHAVIOUR (declared rates from the domain registry; a
 *     per-element override of the same key wins when present):
 *       - fluid-source  PRODUCES at rateM3h (declared supply).
 *       - pipe          CARRIES up to flowRateM3h (throughput cap).
 *       - tank          BUFFERS: capacityM3 + fillPct give the stored
 *                       volume; the net fill rate and the time until
 *                       OVERFLOW are computed analytically (free volume /
 *                       net inflow - no time-stepped integration).
 *       - mixer         COMBINES its input streams into one output with
 *                       exact ratio conservation (out = sum of ins; the
 *                       blend shares are reported); expects `inputs`
 *                       incoming streams and is flagged STARVED short.
 *       - fluid-drain   CONSUMES whatever arrives (the outfall).
 *       - portioner / deportioner pass flow through conserved (their
 *                       continuous<->discrete dosing is NOT modelled).
 *
 *   THE SOLVER - two analytical passes over the acyclic network:
 *     1. BACKWARD ACCEPTANCE (reverse topological): how much steady flow
 *        each element can accept and eventually deliver to a drain or
 *        buffer in a tank. Drains and tanks accept without limit (a tank
 *        buffers - its overflow horizon is reported separately); a pipe
 *        accepts min(its cap, what its successors accept); a dead end
 *        (no drain / no tank downstream) accepts 0.
 *     2. FORWARD FLOW (topological): sources push min(declared rate,
 *        acceptance) - the unaccepted remainder is CURTAILED supply
 *        (back-pressure, flagged); at a branch, flow splits EQUALLY
 *        across the outgoing junctions, capped by each branch's
 *        acceptance, with the excess re-filling unsaturated branches
 *        (deterministic water-filling - a documented model rule, not a
 *        hydraulic computation).
 *
 *   VERIFIED CONSERVATION - at every node, in + produced == out +
 *     consumed + buffered + curtailed (checked, not assumed - the same
 *     discipline as WT.process.resolveFlow); the network totals close:
 *     supply == delivered + buffered + curtailed (residual reported).
 *
 *   DETECTION - the report names the BOTTLENECK (the saturated capacity
 *     element limiting the network), every OVERFLOW RISK (a tank filling:
 *     "full in X min at current rates"; curtailed supply backing up), and
 *     every STARVED element (connected but receiving no flow; a mixer
 *     with fewer live input streams than it expects; a network with
 *     drains but no supply).
 *
 * COLLAPSE TO BASE CASE - fluid elements that touch nothing (or a layout
 * with no fluid elements at all) produce NO network and ZERO metrics:
 * exactly the pre-v3.19 static behaviour. analyze() is READ-ONLY (never
 * mutates the layout) and adds nothing to the serialize, so every
 * existing scenario stays byte-identical.
 *
 * HONESTY (load-bearing, mirrored in the UI + README): this is a
 * steady-state ANALYTICAL model - modelled, not measured. It is NOT a
 * validated process simulation, NOT CFD, NOT hydraulics (no pressure,
 * viscosity, head loss or pump curves), NOT transient dynamics and NOT a
 * certification. Rates are the components' synthetic order-of-magnitude
 * teaching values. The equal-split branching is a documented model rule.
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Optional dep: WT.domain (the element registry); graceful
 * empty result when absent. No frameworks, no build step, fully offline.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const EPS = 1e-9;

  const NOTE =
    "STEADY-STATE ANALYTICAL continuous-flow model - modelled, not measured; " +
    "deterministic (no clock, no RNG); teaching-scale. Volume conservation is " +
    "verified at every node. NOT a validated process simulation, NOT CFD, NOT " +
    "hydraulics (no pressure/viscosity/head loss/pump curves), NOT transient " +
    "dynamics, NOT a certification. Rates are the components' synthetic " +
    "declared values; at a branch, flow splits equally across branches capped " +
    "by downstream acceptance (a documented model rule, not a measurement).";

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function defOf(el) {
    const els = WT.domain && WT.domain.ELEMENTS;
    return (els && el && els[el.type]) || null;
  }
  // A fluid element: its registry def declares `fluid: true` (the v3.7
  // family + any user-defined clone of it). Non-fluid elements are never
  // touched, so a warehouse/factory-only layout yields the empty result.
  function isFluidEl(el) {
    const d = defOf(el);
    return !!(d && d.fluid === true);
  }
  // Element role in the flow model, read from the DECLARED def fields (so
  // user-defined clones behave like their base component, not by type name).
  function roleOf(el) {
    const d = defOf(el) || {};
    if (d.sink === true) return "drain";
    if (d.io === "receiving") return "source";
    if (Number.isFinite(d.capacityM3) || Number.isFinite(el.capacityM3)) return "tank";
    if (Number.isFinite(d.inputs) || Number.isFinite(el.inputs)) return "mixer";
    return "conduit"; // pipe / portioner / deportioner: flow passes through
  }
  // Declared rate fields; a per-element override of the same key wins.
  function prop(el, key, dflt) {
    const d = defOf(el) || {};
    return num(el[key], num(d[key], dflt));
  }
  function labelOf(el) {
    const d = defOf(el) || {};
    return (d.label || el.type) + " (" + el.id + ")";
  }

  /* ------------------------------------------------------------------
   * ADJACENCY - two footprints connect when they share an edge with a
   * positive common span (integer-metre grid: >= 1 m). A corner-only
   * touch does not connect; a (defensive) interior overlap does.
   * ------------------------------------------------------------------ */
  function touches(a, b) {
    const xo = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const yo = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
    if (xo < 0 || yo < 0) return false;      // apart
    if (xo > 0 && yo > 0) return true;       // overlap (defensive: connected)
    return (xo === 0 && yo > 0) || (yo === 0 && xo > 0); // shared edge
  }

  // Multi-source BFS hop distance over an undirected adjacency list.
  // Returns a map id -> hops (unreached ids absent). Deterministic: the
  // frontier is processed in the sorted-id order it was built in.
  function bfs(startIds, adj) {
    const dist = {};
    let frontier = startIds.slice();
    for (const id of frontier) dist[id] = 0;
    let hops = 0;
    while (frontier.length) {
      hops++;
      const next = [];
      for (const id of frontier) {
        for (const nb of adj[id]) {
          if (!(nb in dist)) { dist[nb] = hops; next.push(nb); }
        }
      }
      frontier = next;
    }
    return dist;
  }

  // Deterministic equal-split water-filling: distribute `total` across
  // branches with acceptance caps `caps` (Infinity allowed). Every branch
  // gets an equal share, capped; the excess re-fills unsaturated branches.
  function distribute(total, caps) {
    const out = new Array(caps.length).fill(0);
    if (!caps.length || !(total > 0)) return out;
    let remaining = total;
    let active = caps.map((_, i) => i).filter((i) => caps[i] > 0);
    while (remaining > EPS && active.length) {
      const share = remaining / active.length;
      let consumed = 0;
      const next = [];
      for (const i of active) {
        const room = caps[i] - out[i];
        const give = Math.min(share, room);
        out[i] += give;
        consumed += give;
        if (caps[i] - out[i] > EPS) next.push(i);
      }
      remaining -= consumed;
      if (consumed <= EPS) break; // every branch saturated
      active = next;
    }
    return out;
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  /* ==================================================================
   * ANALYZE - the whole model. analyze(layout) -> {
   *   active, note, networks: [net...], fluidCount, unconnected }
   * where net = {
   *   id, elementIds, supplyM3h, deliveredM3h, bufferedM3h, curtailedM3h,
   *   nodes: { elId: { role, label, inM3h, outM3h, capM3h?, utilisation?,
   *            producedM3h?, curtailedM3h?, consumedM3h?, netFillM3h?,
   *            freeM3?, timeToFullMin?, mixShares?, expectedInputs?,
   *            starved? } },
   *   arcs: [{ from, to, m3h }],
   *   bottleneck: { id, label, capM3h, utilisation } | null,
   *   warnings: [plain-language strings],
   *   conservation: { ok, maxAbsResidualM3h } }
   * READ-ONLY and pure: no mutation, no Date, no RNG.
   * ================================================================== */
  function analyze(layout) {
    const els = ((layout && layout.elements) || []).filter(isFluidEl);
    const base = { active: false, note: NOTE, networks: [], fluidCount: els.length, unconnected: els.length };
    if (els.length < 2) return base;

    // Deterministic ordering: sort by id (stable regardless of placement order).
    const sorted = els.slice().sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    const byId = {};
    for (const e of sorted) byId[e.id] = e;
    const ids = sorted.map((e) => e.id);

    // Undirected adjacency (sorted order kept everywhere).
    const adj = {};
    for (const id of ids) adj[id] = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (touches(sorted[i], sorted[j])) {
          adj[sorted[i].id].push(sorted[j].id);
          adj[sorted[j].id].push(sorted[i].id);
        }
      }
    }

    // Connected components (BFS in sorted-id order).
    const comp = {};
    const components = [];
    for (const id of ids) {
      if (id in comp) continue;
      const members = [];
      let frontier = [id];
      comp[id] = components.length;
      while (frontier.length) {
        const next = [];
        for (const cur of frontier) {
          members.push(cur);
          for (const nb of adj[cur]) {
            if (!(nb in comp)) { comp[nb] = components.length; next.push(nb); }
          }
        }
        frontier = next;
      }
      members.sort();
      components.push(members);
    }

    const networks = [];
    let unconnected = 0;
    let netSeq = 0;
    for (const members of components) {
      if (members.length < 2) { unconnected += members.length; continue; } // lone element: static, zero metrics
      const sources = members.filter((id) => roleOf(byId[id]) === "source");
      const drains = members.filter((id) => roleOf(byId[id]) === "drain");
      if (!sources.length) {
        // Connected but with NO supply: nothing can flow - an inactive,
        // zero-metric network with a friendly note (starved as a whole).
        netSeq++;
        networks.push({
          id: "fluid-net-" + netSeq,
          elementIds: members.slice(),
          active: false,
          supplyM3h: 0, deliveredM3h: 0, bufferedM3h: 0, curtailedM3h: 0,
          nodes: {}, arcs: [], bottleneck: null,
          warnings: ["This fluid network has no supply - add a Fluid source to make it flow. Every element in it is starved (0 m3/h)."],
          conservation: { ok: true, maxAbsResidualM3h: 0 },
        });
        continue;
      }

      // Orientation keys: hops from the supplies and to the drains.
      const dSrc = bfs(sources, adj);
      const dDrn = drains.length ? bfs(drains, adj) : null;

      // Directed arcs. a -> b when b is nearer the drains (falls back to
      // farther-from-source, then id order - a total order => acyclic).
      // Nothing flows INTO a source or OUT of a drain; a junction between
      // two sources / two drains carries no arc.
      function downstream(aId, bId) { // true => arc aId -> bId
        if (dDrn) {
          const da = dDrn[aId], db = dDrn[bId];
          if (da !== db) return db < da;
        }
        const sa = dSrc[aId], sb = dSrc[bId];
        if (sa !== sb) return sb > sa;
        return String(aId) < String(bId);
      }
      const arcs = []; // { from, to, m3h }
      const outArcs = {}, inArcs = {};
      for (const id of members) { outArcs[id] = []; inArcs[id] = []; }
      for (const aId of members) {
        for (const bId of adj[aId]) {
          if (String(aId) >= String(bId)) continue; // each undirected pair once
          const ra = roleOf(byId[aId]), rb = roleOf(byId[bId]);
          if (ra === "source" && rb === "source") continue;
          if (ra === "drain" && rb === "drain") continue;
          let from = aId, to = bId;
          if (!downstream(aId, bId)) { from = bId; to = aId; }
          if (roleOf(byId[to]) === "source") { const t = from; from = to; to = t; }
          if (roleOf(byId[from]) === "drain") { const t = from; from = to; to = t; }
          if (roleOf(byId[to]) === "source" || roleOf(byId[from]) === "drain") continue;
          const ai = arcs.length;
          arcs.push({ from: from, to: to, m3h: 0 });
          outArcs[from].push(ai);
          inArcs[to].push(ai);
        }
      }

      // Kahn topological order (defensive: the orientation is a total
      // order, so a cycle is impossible; guard anyway with a friendly stop).
      const indeg = {};
      for (const id of members) indeg[id] = inArcs[id].length;
      const topo = [];
      let queue = members.filter((id) => indeg[id] === 0).sort();
      while (queue.length) {
        const nextQ = [];
        for (const id of queue) {
          topo.push(id);
          for (const ai of outArcs[id]) {
            const to = arcs[ai].to;
            if (--indeg[to] === 0) nextQ.push(to);
          }
        }
        nextQ.sort();
        queue = nextQ;
      }
      if (topo.length !== members.length) {
        netSeq++;
        networks.push({
          id: "fluid-net-" + netSeq,
          elementIds: members.slice(),
          active: false,
          supplyM3h: 0, deliveredM3h: 0, bufferedM3h: 0, curtailedM3h: 0,
          nodes: {}, arcs: [], bottleneck: null,
          warnings: ["This fluid network loops back on itself - recirculation is not modelled. Break the loop to analyze it."],
          conservation: { ok: true, maxAbsResidualM3h: 0 },
        });
        continue;
      }

      // ---- pass 1: BACKWARD ACCEPTANCE (reverse topo) -----------------
      const accept = {};
      for (let t = topo.length - 1; t >= 0; t--) {
        const id = topo[t];
        const role = roleOf(byId[id]);
        if (role === "drain" || role === "tank") { accept[id] = Infinity; continue; }
        let succ = 0;
        for (const ai of outArcs[id]) succ += accept[arcs[ai].to];
        if (role === "source") { accept[id] = succ; continue; }
        const cap = role === "conduit" ? prop(byId[id], "flowRateM3h", Infinity) : Infinity;
        accept[id] = Math.min(cap, succ); // dead end (no succ) -> 0
      }

      // ---- pass 2: FORWARD FLOW (topo) --------------------------------
      const inFlow = {}, outFlow = {};
      for (const id of members) { inFlow[id] = 0; outFlow[id] = 0; }
      const produced = {}, curtailed = {}, consumed = {}, buffered = {};
      for (const id of topo) {
        const el = byId[id];
        const role = roleOf(el);
        let sendable = 0;
        if (role === "source") {
          produced[id] = Math.max(0, prop(el, "rateM3h", 0));
          sendable = produced[id];
        } else if (role === "drain") {
          consumed[id] = inFlow[id];
          continue;
        } else if (role === "conduit") {
          sendable = Math.min(inFlow[id], prop(el, "flowRateM3h", Infinity));
        } else {
          sendable = inFlow[id]; // tank / mixer / anything pass-through
        }
        const caps = outArcs[id].map((ai) => accept[arcs[ai].to]);
        const given = distribute(sendable, caps);
        let sent = 0;
        outArcs[id].forEach((ai, k) => {
          arcs[ai].m3h = given[k];
          inFlow[arcs[ai].to] += given[k];
          sent += given[k];
        });
        outFlow[id] = sent;
        if (role === "source" && produced[id] - sent > EPS) curtailed[id] = produced[id] - sent;
        if (role === "tank") buffered[id] = inFlow[id] - sent; // net fill (>= 0 in a push network)
      }

      // ---- node reports + detection ----------------------------------
      const warnings = [];
      const nodes = {};
      let bottleneck = null;
      let supply = 0, delivered = 0, buffering = 0, curtailedTotal = 0;
      for (const id of topo) {
        const el = byId[id];
        const role = roleOf(el);
        const n = { role: role, label: labelOf(el), inM3h: round3(inFlow[id]), outM3h: round3(outFlow[id]) };
        if (role === "source") {
          n.producedM3h = round3(produced[id]);
          supply += produced[id];
          const cut = curtailed[id] || 0;
          if (cut > EPS) {
            n.curtailedM3h = round3(cut);
            curtailedTotal += cut;
            warnings.push("Overflow risk at " + n.label + ": the network can only carry " +
              round3(produced[id] - cut) + " of its " + round3(produced[id]) +
              " m3/h supply - " + round3(cut) + " m3/h backs up at the source.");
          }
        } else if (role === "drain") {
          n.consumedM3h = round3(inFlow[id]);
          delivered += inFlow[id];
          if (inFlow[id] <= EPS) { n.starved = true; warnings.push("Starved: " + n.label + " receives no flow."); }
        } else if (role === "tank") {
          const capacity = Math.max(0, prop(el, "capacityM3", 0));
          const fillPct = Math.max(0, Math.min(100, prop(el, "fillPct", 0)));
          const net = buffered[id] || 0;
          const free = capacity * (1 - fillPct / 100);
          n.capacityM3 = round3(capacity);
          n.fillPct = round3(fillPct);
          n.netFillM3h = round3(net);
          n.freeM3 = round3(free);
          buffering += net;
          if (net > EPS) {
            if (free > EPS) {
              n.timeToFullMin = round3((free / net) * 60);
              warnings.push("Overflow risk: " + n.label + " fills at " + round3(net) +
                " m3/h and is FULL in " + Math.round(n.timeToFullMin) + " min at current rates.");
            } else {
              n.timeToFullMin = 0;
              warnings.push("Overflow: " + n.label + " is already full and still receives " + round3(net) + " m3/h.");
            }
          }
          if (inFlow[id] <= EPS) { n.starved = true; warnings.push("Starved: " + n.label + " receives no flow."); }
        } else { // conduit / mixer
          if (role === "mixer") {
            const expected = Math.max(1, Math.round(prop(el, "inputs", 1)));
            const live = inArcs[id].filter((ai) => arcs[ai].m3h > EPS).length;
            n.expectedInputs = expected;
            n.liveInputs = live;
            if (inFlow[id] > EPS) {
              n.mixShares = inArcs[id]
                .filter((ai) => arcs[ai].m3h > EPS)
                .map((ai) => ({ from: arcs[ai].from, m3h: round3(arcs[ai].m3h), share: round3(arcs[ai].m3h / inFlow[id]) }));
            }
            if (live < expected) {
              n.starved = true;
              warnings.push("Starved mixer: " + n.label + " expects " + expected +
                " input stream(s) but only " + live + " flow(s) arrive.");
            }
          } else {
            const cap = prop(el, "flowRateM3h", Infinity);
            if (Number.isFinite(cap) && cap > 0) {
              n.capM3h = round3(cap);
              n.utilisation = round3(Math.min(1, outFlow[id] / cap));
              if (outFlow[id] >= cap - EPS * Math.max(1, cap) && outFlow[id] > EPS) {
                if (!bottleneck || outFlow[id] > bottleneck._flow + EPS) {
                  bottleneck = { id: id, label: n.label, capM3h: round3(cap), utilisation: 1, _flow: outFlow[id] };
                }
              }
            }
            if (inFlow[id] <= EPS) { n.starved = true; warnings.push("Starved: " + n.label + " receives no flow."); }
          }
          if (accept[id] <= EPS && outArcs[id].length === 0) {
            warnings.push("Dead end: " + n.label + " leads nowhere - connect it onward to a Tank or a Fluid drain.");
          }
        }
        nodes[id] = n;
      }
      if (bottleneck) delete bottleneck._flow;

      // ---- VERIFIED conservation (checked, not assumed) ---------------
      let maxResidual = 0;
      for (const id of members) {
        const residual = inFlow[id] + (produced[id] || 0)
          - outFlow[id] - (consumed[id] || 0) - (buffered[id] || 0) - (curtailed[id] || 0);
        maxResidual = Math.max(maxResidual, Math.abs(residual));
      }
      const totalResidual = Math.abs(supply - delivered - buffering - curtailedTotal);
      maxResidual = Math.max(maxResidual, totalResidual);

      netSeq++;
      networks.push({
        id: "fluid-net-" + netSeq,
        elementIds: members.slice(),
        active: true,
        supplyM3h: round3(supply),
        deliveredM3h: round3(delivered),
        bufferedM3h: round3(buffering),
        curtailedM3h: round3(curtailedTotal),
        nodes: nodes,
        arcs: arcs.map((a) => ({ from: a.from, to: a.to, m3h: round3(a.m3h) })),
        bottleneck: bottleneck,
        warnings: warnings,
        conservation: { ok: maxResidual <= 1e-6 * Math.max(1, supply), maxAbsResidualM3h: maxResidual },
      });
    }

    return {
      active: networks.some((n) => n.active),
      note: NOTE,
      networks: networks,
      fluidCount: els.length,
      unconnected: unconnected,
    };
  }

  /* ------------------------------------------------------------------
   * A hand-computable DEMO network (used by the self-test + harness and
   * placeable for teaching): two supplies (40 + 40 m3/h) blend in a
   * mixer, buffer in a 200 m3 tank at 60% fill, and leave through a
   * 30 m3/h pipe to the outfall. Expected steady state: mixer out 80,
   * pipe saturated at 30 (the bottleneck), drain receives 30, tank fills
   * at +50 m3/h -> its 80 m3 of free space is FULL in 96 min.
   * Pure data (fresh copy per call); NOT auto-placed anywhere.
   * ------------------------------------------------------------------ */
  function demoLayout() {
    return {
      version: "wt-1",
      gridW: 20, gridH: 8, cell: 1,
      elements: [
        { id: "fl-srcA", type: "fluid-source", x: 0, y: 0, w: 2, d: 2 },
        { id: "fl-srcB", type: "fluid-source", x: 0, y: 2, w: 2, d: 2 },
        { id: "fl-mix", type: "mixer", x: 2, y: 0, w: 3, d: 3 },
        { id: "fl-tank", type: "tank", x: 5, y: 0, w: 3, d: 3 },
        { id: "fl-pipe", type: "pipe", x: 8, y: 1, w: 6, d: 1, flowRateM3h: 30 },
        { id: "fl-drain", type: "fluid-drain", x: 14, y: 0, w: 2, d: 2 },
      ],
      config: {},
    };
  }

  WT.fluids = {
    NOTE: NOTE,
    isFluidEl: isFluidEl,
    roleOf: roleOf,
    touches: touches,
    analyze: analyze,
    demoLayout: demoLayout,
  };
})();
