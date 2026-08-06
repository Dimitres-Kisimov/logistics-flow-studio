/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * flowlinks.js - Material-flow CONNECTION overlay model (v3.12)
 * ---------------------------------------------------------------------
 * A pure, DETERMINISTIC, DOM-free model of the DIRECTED CONNECTIONS the
 * material flow actually follows - so a user can SEE the connected
 * network (source/receiving -> storage -> pick -> pack -> ship/drain;
 * in factory mode Source -> stations -> Drain) the way a plant-sim model
 * wires its objects with visible directed connectors.
 *
 * IMPORTANT - this INVENTS NO NEW GRAPH. The links are read straight off
 * the app's OWN routing model:
 *
 *   WT.flowsim.buildWaypoints(layout)  ->  the ordered spine the animated
 *                                          boxes (MUs) travel along, incl.
 *                                          the conveyor-following leg.
 *
 * We simply turn that spine into (a) a NODE per flow STAGE that the layout
 * ACTUALLY contains and (b) DIRECTED LINK segments between consecutive
 * present stages, riding the conveyor cells on the storage->pick leg
 * exactly where the boxes do. Stages the layout does NOT contain get NO
 * node and NO phantom link (honest: if two things are not on a detected
 * flow path, nothing is drawn between them).
 *
 * HONEST: this is an ILLUSTRATIVE SCHEMATIC of the app's own synthetic
 * routing model - NOT a CAD/BIM drawing, NOT a validated process graph,
 * NOT a measurement. It is a VISUALISATION of the existing flow; it does
 * not change the sim, the data model, compliance, IFC, or the elements.
 *
 * Deterministic: a pure function of buildWaypoints (which is itself pure +
 * seeded) - NO Date, NO Math.random - so the link SET is byte-identical
 * across runs. Draws in the WORLD transform (caller supplies the world->px
 * projection) so zoom / pan / Fit all apply, and is LOD-aware.
 *
 * Usage (browser): WT.flowlinks.buildLinks(layout) -> model;
 *                  WT.flowlinks.draw(ctx, model, opts).
 * Usage (Node/tests): same, under the window shim the harnesses use.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const NOTE =
    "Illustrative schematic of the app's OWN material-flow routing " +
    "(WT.flowsim.buildWaypoints) - the directed path the animated boxes " +
    "follow. NOT a CAD/BIM drawing, NOT a validated process graph, NOT a " +
    "measurement. A visualisation of the existing flow only.";

  // The flow spine stages, in travel order. Same stage names the live
  // flow legend + WT.flowsim use, so the overlay reads consistently.
  const STAGE_ORDER = ["receiving", "storage", "picking", "packing", "shipping"];
  const STAGE_LABELS = {
    receiving: "Receiving",
    storage: "Storage",
    picking: "Picking",
    packing: "Packing",
    shipping: "Shipping",
  };

  const EPS = 1e-6;

  // ---- element classification (delegated to the domain registry) -------
  // These mirror the SAME predicates WT.flowsim.buildWaypoints keys its
  // stage centroids off, but read purely from WT.domain.ELEMENTS (the one
  // registry) so they never drift as element types change.
  function elDef(e) {
    const els = WT.domain && WT.domain.ELEMENTS;
    return (els && e && els[e.type]) || {};
  }
  function baseOf(e) {
    const d = elDef(e);
    return typeof d.base === "string" ? d.base : null;
  }
  function isReceiving(e) {
    return e.type === "dock-in" || (baseOf(e) === "dock" && elDef(e).io === "receiving");
  }
  function isShipping(e) {
    return e.type === "dock-out" || (baseOf(e) === "dock" && elDef(e).io === "shipping");
  }
  function isStorageEl(e) {
    return elDef(e).category === "storage";
  }
  function isPickFace(e) {
    const d = elDef(e);
    return !!d.pickFace || !!d.goodsToPerson || e.type === "pallet-flow";
  }
  function isPacking(e) {
    return e.type === "pack-station" || baseOf(e) === "station";
  }

  // A zone-rect present in the layout metadata (generator/examples), used
  // by buildWaypoints as a secondary anchor - so it also grounds a stage.
  function hasZone(layout, key) {
    const zs = layout && layout.meta && layout.meta.zones;
    return Array.isArray(zs) && zs.some((q) => q && q.key === key);
  }

  // Is a stage backed by a REAL element (or zone) in this layout? If not,
  // buildWaypoints only had a geometric FALLBACK for it - so we draw no
  // node/link there (no phantom stage in, e.g., a pure Source->Drain line).
  function stagePresent(layout, stage) {
    const els = (layout && layout.elements) || [];
    switch (stage) {
      case "receiving": return els.some(isReceiving) || hasZone(layout, "receiving");
      case "storage": return els.some(isStorageEl) || hasZone(layout, "storage");
      case "picking": return els.some(isPickFace) || hasZone(layout, "picking");
      case "packing": return els.some(isPacking) || hasZone(layout, "packing");
      // shipping falls back to receiving in buildWaypoints, so a receiving-
      // only layout still has a sink; mirror that so the spine stays closed.
      case "shipping": return els.some(isShipping) || hasZone(layout, "shipping") || els.some(isReceiving);
      default: return false;
    }
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const EMPTY_MODEL = Object.freeze({ empty: true, nodes: [], links: [], routed: false, mode: "warehouse", note: NOTE });

  /* ------------------------------------------------------------------
   * buildLinks(layout) -> a directed connection model:
   *   { empty, mode, routed, nodes:[{x,y,stage,label}],
   *     links:[{x1,y1,x2,y2,fromStage,toStage,onConveyor}], note }
   * Pure function of WT.flowsim.buildWaypoints(layout). Empty (no nodes /
   * no links) for an empty or no-flow layout.
   * ------------------------------------------------------------------ */
  function buildLinks(layout) {
    const FS = WT.flowsim;
    const els = (layout && layout.elements) || [];
    // No elements => nothing is routed => an empty overlay (honest).
    if (!FS || typeof FS.buildWaypoints !== "function" || !els.length) return EMPTY_MODEL;

    let wps;
    try { wps = FS.buildWaypoints(layout); } catch (_) { return EMPTY_MODEL; }
    if (!wps || !wps.length) return EMPTY_MODEL;

    // Split the spine into stage ANCHORS (the zone centroids) and the
    // conveyor-following CELLS on the storage->picking leg.
    const anchorByStage = {};
    const convCells = [];
    for (const w of wps) {
      if (w.onConveyor) convCells.push({ x: w.x, y: w.y });
      else if (!(w.stage in anchorByStage)) anchorByStage[w.stage] = { x: w.x, y: w.y, stage: w.stage };
    }

    // Present stages, in travel order - only those the layout truly has.
    const present = STAGE_ORDER.filter((s) => anchorByStage[s] && stagePresent(layout, s));
    // A connected NETWORK needs >= 2 grounded stages to draw a directed link
    // between. Fewer => no flow to show (honest: no phantom lone node/link).
    if (present.length < 2) return EMPTY_MODEL;

    const nodes = present.map((s) => ({ x: anchorByStage[s].x, y: anchorByStage[s].y, stage: s, label: STAGE_LABELS[s] }));

    // Directed links between consecutive PRESENT stages. The storage->pick
    // leg rides the conveyor cells (exactly where the boxes do) when both
    // ends are present and a conveyor route exists; every other leg is a
    // straight directed segment. Zero-length segments are dropped.
    const links = [];
    let routed = false;
    for (let i = 0; i < present.length - 1; i++) {
      const fromStage = present[i], toStage = present[i + 1];
      const a = anchorByStage[fromStage], b = anchorByStage[toStage];
      const conveyorLeg = fromStage === "storage" && toStage === "picking" && convCells.length > 0;
      const pts = [a];
      if (conveyorLeg) { for (const c of convCells) pts.push(c); routed = true; }
      pts.push(b);
      for (let j = 0; j < pts.length - 1; j++) {
        const p = pts[j], q = pts[j + 1];
        if (dist(p, q) <= EPS) continue; // collapse coincident anchors/cells
        links.push({
          x1: p.x, y1: p.y, x2: q.x, y2: q.y,
          fromStage: fromStage, toStage: toStage,
          onConveyor: !!conveyorLeg && j < pts.length - 1 && (j > 0 || dist(a, p) <= EPS),
        });
      }
    }

    return {
      empty: links.length === 0 && nodes.length === 0,
      mode: factoryish(els) ? "factory" : "warehouse",
      routed: routed,
      nodes: nodes,
      links: links,
      note: NOTE,
    };
  }

  // A light hint used only for the status wording: a layout carrying the
  // factory built-ins (Source/Drain -> base "dock", Station -> base
  // "station") reads as a production line rather than a warehouse.
  function factoryish(els) {
    for (const e of els) { const b = baseOf(e); if (b === "station" || b === "dock") return true; }
    return false;
  }

  /* ==================================================================
   * DRAW. Renders the connection model into a 2D context that is ALREADY
   * in the world transform (the caller has translated by pan + scaled by
   * zoom). All geometry is produced in canvas BASE px via opts.project
   * (world cell -> base px), so zoom / pan / Fit compose unchanged and the
   * links stay glued to the floor. Theme-aware (colours are passed in),
   * LOD-aware (arrowheads + labels drop out when zoomed far out) and
   * deterministic (no Date, no RNG, no animation - reduced-motion safe).
   * ================================================================== */
  function draw(ctx, model, opts) {
    if (!ctx || !model || model.empty || (!model.links.length && !model.nodes.length)) return;
    const o = opts || {};
    const cellPx = o.cellPx || 1;
    const project = typeof o.project === "function" ? o.project : (x, y) => ({ x: x * cellPx, y: y * cellPx });
    const onCell = o.onCell || cellPx; // px per world cell ON SCREEN (LOD signal)
    const C = o.colors || {};
    const stageCols = C.stages || {};
    const linkCol = C.link || "#64748b";
    const nodeText = C.nodeText || "#0f172a";
    const nodeBg = C.nodeBg || "#ffffff";

    // LOD tiers: far out => lines only; mid => + arrowheads; near => + node
    // dots; close => + text labels. Keeps a big zoomed-out plant legible.
    const showArrows = onCell >= 5;
    const showNodes = onCell >= 7;
    const showLabels = onCell >= 16;

    const lineW = Math.max(1.1, cellPx * 0.07);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);

    // 1) LINK SEGMENTS - subtle directed lines, tinted by the stage they
    // leave. Drawn first (under the nodes + the animated boxes).
    for (const lk of model.links) {
      const p = project(lk.x1, lk.y1), q = project(lk.x2, lk.y2);
      const col = stageCols[lk.fromStage] || linkCol;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = col;
      ctx.globalAlpha = lk.onConveyor ? 0.85 : 0.7;
      ctx.lineWidth = lineW;
      ctx.stroke();

      // Direction arrowhead near the segment midpoint, only when the
      // segment reads long enough on screen (LOD) so it never crowds.
      if (showArrows) {
        const segLenPx = Math.hypot(q.x - p.x, q.y - p.y) * (onCell / cellPx);
        if (segLenPx >= 13) drawArrow(ctx, p, q, cellPx, col);
      }
    }
    ctx.globalAlpha = 1;

    // 2) STAGE NODES - a small filled marker per present stage (the wired
    // "objects"), with a label when zoomed in enough to read it.
    if (showNodes) {
      const r = Math.max(2.6, cellPx * 0.26);
      for (const n of model.nodes) {
        const c = project(n.x, n.y);
        const col = stageCols[n.stage] || linkCol;
        // halo so the node reads over racks/floor of any colour
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + Math.max(1, cellPx * 0.06), 0, Math.PI * 2);
        ctx.fillStyle = nodeBg;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cellPx * 0.04);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 1;
        ctx.stroke();

        if (showLabels && typeof ctx.fillText === "function") {
          const fs = Math.max(7, Math.round(cellPx * 0.34));
          ctx.font = "600 " + fs + "px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const tw = (ctx.measureText ? ctx.measureText(n.label).width : n.label.length * fs * 0.6) + cellPx * 0.3;
          const bx = c.x - tw / 2, by = c.y - r - Math.max(2, cellPx * 0.16) - fs;
          // label chip
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = nodeBg;
          if (typeof ctx.fillRect === "function") ctx.fillRect(bx, by, tw, fs + cellPx * 0.16);
          ctx.globalAlpha = 1;
          ctx.fillStyle = nodeText;
          ctx.fillText(n.label, c.x, by + fs + cellPx * 0.12);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A small filled triangular arrowhead pointing from p -> q, placed a
  // little past the segment midpoint. Pure geometry (no rotate/translate)
  // so it renders in any minimal 2D context.
  function drawArrow(ctx, p, q, cellPx, col) {
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;       // unit along the segment
    const nx = -uy, ny = ux;                   // unit normal
    // tip at 58% along the segment; base a size back from the tip
    const tipX = p.x + dx * 0.58, tipY = p.y + dy * 0.58;
    const size = Math.max(2.4, cellPx * 0.22);
    const baseX = tipX - ux * size, baseY = tipY - uy * size;
    const half = size * 0.6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + nx * half, baseY + ny * half);
    ctx.lineTo(baseX - nx * half, baseY - ny * half);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.95;
    ctx.fill();
  }

  WT.flowlinks = {
    NOTE: NOTE,
    STAGE_ORDER: STAGE_ORDER,
    STAGE_LABELS: STAGE_LABELS,
    stagePresent: stagePresent,
    buildLinks: buildLinks,
    draw: draw,
  };
})();
