/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * optimizer.js - spatial-layout optimizer (P2)
 * ---------------------------------------------------------------------
 * A transparent, deterministic HEURISTIC (not a trained model). It
 * implements the "golden-zone" idea: high-throughput storage should sit
 * closest to the outbound dock. It does a greedy hill-climb that steps
 * storage elements one cell at a time toward the I/O point, keeping the
 * layout legal (in bounds, no overlap, and never increasing the count of
 * ASR A1.8-informed aisle violations). Flow elements (docks, staging,
 * conveyor, push/pull) stay put - they anchor the flow.
 *
 * It never mutates the caller's layout: it works on clones and returns a
 * proposal plus before/after KPIs (measured with the REAL sim) so the UI
 * can preview the change before the user accepts it.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const D = WT.domain;

  function isStorage(el) {
    return (D.ELEMENTS[el.type] || {}).category === "storage";
  }

  function optimize(layout, config) {
    const cell = layout.cell || D.METRES_PER_CELL;
    const gridW = layout.gridW, gridH = layout.gridH;

    // Baseline KPIs on the original layout (real sim).
    const before = WT.sim.run(
      { elements: layout.elements, gridW, gridH, cell },
      config
    );

    // Work on clones so we never touch the caller's objects.
    const els = layout.elements.map((e) => Object.assign({}, e));
    const original = layout.elements.map((e) => ({ id: e.id, x: e.x, y: e.y }));
    const audit = { errors: [], rejected: {}, fixedIds: [], zones: [] };
    const reject = code => { audit.rejected[code] = (audit.rejected[code] || 0) + 1; };
    const raw = config.placementConstraints;
    const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["fixedIds", "zones"].includes(k))) audit.errors.push("Use an object containing only fixedIds and zones.");
      else {
        const ids = raw.fixedIds === undefined ? [] : raw.fixedIds;
        const zones = raw.zones === undefined ? [] : raw.zones;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !els.some(e => e.id === id))) audit.errors.push("Every fixed ID must name an existing element.");
        else audit.fixedIds = [...new Set(ids)];
        if (!Array.isArray(zones) || zones.length > 100) audit.errors.push("Zones must be an array with at most 100 rectangles.");
        else zones.forEach((z, i) => {
          if (!z || typeof z !== "object" || Object.keys(z).some(k => !["x", "y", "w", "d"].includes(k)) || ![z.x,z.y,z.w,z.d].every(Number.isFinite) || z.x < 0 || z.y < 0 || z.w <= 0 || z.d <= 0 || z.x + z.w > gridW * cell || z.y + z.d > gridH * cell) audit.errors.push(`Zone ${i + 1} must be a positive rectangle inside the floor, in metres.`);
          else audit.zones.push({ x:z.x/cell, y:z.y/cell, w:z.w/cell, d:z.d/cell });
        });
        els.forEach(e => audit.zones.forEach((z, i) => { if (intersects(e,z)) audit.errors.push(`Element ${e.id} occupies reserved zone ${i + 1}. Resolve the baseline conflict before optimization.`); }));
      }
    }
    if (audit.errors.length) return { ok:false, proposedElements:els, before, after:before, movedCount:0, moves:[], improved:false, travelDeltaPct:0, audit };

    const io = WT.sim.ioPointOf(els, gridW, gridH, cell);

    const inB = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= gridW && r.y + r.d <= gridH;
    const overlaps = (cand, exceptIdx) =>
      els.some(
        (o, k) =>
          k !== exceptIdx &&
          cand.x < o.x + o.w && o.x < cand.x + cand.w &&
          cand.y < o.y + o.d && o.y < cand.y + cand.d
      );
    const distM = (e) => Math.hypot((e.x + e.w / 2) * cell - io.x, (e.y + e.d / 2) * cell - io.y);

    const storageIdx = [];
    els.forEach((e, i) => { if (isStorage(e) && !audit.fixedIds.includes(e.id)) storageIdx.push(i); });

    let curViol = D.aisleViolations(els, config.minAisleMetres).length;
    // P3: never trade away material-flow chain coverage - a storage
    // element that leaves its conveyor connection would lose the chain's
    // travel/handling benefit, defeating the golden-zone gain.
    let curCovered = D.analyzeChains(els).outboundCovered.size;

    // Greedy hill-climb. Each pass tries to step every storage element one
    // cell closer to the I/O point. Distance must strictly decrease, which
    // guarantees termination. Bigger-capacity storage gets first pick of
    // the golden zone (processed first each pass).
    const MAX_PASSES = 400;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let anyMove = false;
      const order = storageIdx
        .slice()
        .sort((p, q) => D.elementCapacity(els[q]) - D.elementCapacity(els[p]));
      for (const i of order) {
        const e = els[i];
        const cxM = (e.x + e.w / 2) * cell, cyM = (e.y + e.d / 2) * cell;
        const stepX = cxM > io.x + 1e-9 ? -1 : cxM < io.x - 1e-9 ? 1 : 0;
        const stepY = cyM > io.y + 1e-9 ? -1 : cyM < io.y - 1e-9 ? 1 : 0;
        const before0 = distM(e);
        // Prefer a diagonal step, then single-axis steps.
        const tries = [];
        if (stepX && stepY) tries.push({ x: e.x + stepX, y: e.y + stepY });
        if (stepY) tries.push({ x: e.x, y: e.y + stepY });
        if (stepX) tries.push({ x: e.x + stepX, y: e.y });
        for (const t of tries) {
          const cand = { x: t.x, y: t.y, w: e.w, d: e.d };
          if (!inB(cand)) { reject("outside-floor"); continue; }
          if (overlaps(cand, i)) { reject("occupied-footprint"); continue; }
          if (audit.zones.some(z => intersects(cand,z))) { reject("reserved-zone"); continue; }
          const ox = e.x, oy = e.y;
          e.x = cand.x; e.y = cand.y;
          const newViol = D.aisleViolations(els, config.minAisleMetres).length;
          const newCovered = D.analyzeChains(els).outboundCovered.size;
          if (newViol <= curViol && newCovered >= curCovered && distM(e) < before0 - 1e-9) {
            curViol = newViol;
            curCovered = newCovered;
            anyMove = true;
            break; // accept; move to next element
          }
          if (newViol > curViol) reject("aisle-warning-increase");
          if (newCovered < curCovered) reject("flow-coverage-loss");
          if (distM(e) >= before0 - 1e-9) reject("no-distance-improvement");
          e.x = ox; e.y = oy; // revert
        }
      }
      if (!anyMove) break;
    }

    // KPIs after (real sim, same config -> isolates the spatial effect).
    const after = WT.sim.run({ elements: els, gridW, gridH, cell }, config);

    // Count elements that actually moved.
    let movedCount = 0;
    const moves = [];
    for (const o of original) {
      const now = els.find((e) => e.id === o.id);
      if (now && (now.x !== o.x || now.y !== o.y)) {
        movedCount++;
        moves.push({ id: o.id, from: { x: o.x, y: o.y }, to: { x: now.x, y: now.y } });
      }
    }

    const travelBefore = before.avgPickTravelM;
    const travelAfter = after.avgPickTravelM;
    const travelDeltaPct =
      travelBefore > 0 ? ((travelBefore - travelAfter) / travelBefore) * 100 : 0;

    return {
      ok: before.ok && after.ok,
      proposedElements: els,
      before,
      after,
      movedCount,
      moves,
      travelDeltaPct,
      improved: after.avgPickTravelM < before.avgPickTravelM - 1e-6,
      aisleViolations: curViol,
      audit,
    };
  }

  WT.optimizer = { optimize };

  /* ==================================================================
   * TODO (P2+/P5): richer optimisation - simulated annealing / swaps of
   * whole rack rows, multi-objective (travel + fill + aisle safety),
   * and per-SKU slot assignment once the sim exposes slot-level control.
   * ================================================================== */
})();
