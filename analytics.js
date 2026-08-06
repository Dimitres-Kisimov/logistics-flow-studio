/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * analytics.js - the ANALYTICS suite: Bottleneck Analyzer + Sankey material-
 *                flow diagram (A1, v3.1) + Cost Analyzer + Energy Analyzer
 *                (v3.2) - Siemens Plant Simulation "Tools" parity
 *                (BottleneckAnalyzer + SankeyDiagram + CostAnalyzer +
 *                EnergyAnalyzer) - free, offline, honest.
 * ---------------------------------------------------------------------
 * Two READ-ONLY analysis views over the app's EXISTING simulation state.
 * Nothing here re-runs or re-invents a sim: the bottleneck and the flow
 * volumes come STRAIGHT from the same modules the app already runs, so
 * the analysis can NEVER diverge from the app -
 *
 *   FACTORY mode  -> WT.process.metrics(block)  (the deterministic line
 *                    sim: per-station utilisation, effective cycle, the
 *                    Theory-of-Constraints bottleneck, throughput).
 *   WAREHOUSE mode-> WT.wms.runOperations(layout) (the 7-stage flow sim:
 *                    per-stage capacity, measured load, the lowest-
 *                    throughput bottleneck stage).
 *
 * Everything is PURE, OFFLINE and DETERMINISTIC (NO Date, NO Math.random)
 * so a given sim state renders BYTE-IDENTICAL SVG every time.
 *
 *  1) THE BOTTLENECK ANALYZER. Ranks the resources/stations and flags the
 *     #1 constraint - the SAME one the sim/process reports (it reads the
 *     constraint from the sim, it does not recompute it a second way):
 *       - factory: rank by station utilisation (=1 at the bottleneck).
 *       - warehouse: rank by stage load-vs-capacity; the constraint is the
 *         lowest-capacity stage (identical rule + tiebreak to wms.js).
 *     Returns a ranked model + a plain-language "why" (this resource gates
 *     throughput; raising it needs +servers or -cycle / +capacity).
 *
 *  2) THE SANKEY MATERIAL-FLOW DIAGRAM. A hand-drawn SVG Sankey (NO
 *     plotting library) of flow VOLUMES between stages/zones:
 *       - factory : Source -> stations -> Drain, following process.routing.
 *       - warehouse: receiving -> put-away -> storage -> replenishment ->
 *         order-picking -> packing -> shipping, widths from the volume the
 *         flow sim moved between consecutive stages.
 *     Link widths are PROPORTIONAL to flow; the layout is a pure geometry
 *     model (sankeyLayout) the SVG serializer (sankeySvg) draws, so the
 *     proportionality + the bytes are both headlessly verifiable.
 *
 * HONESTY (load-bearing, mirrored in the UI): every figure is MODELLED,
 * NOT MEASURED; DETERMINISTIC; TEACHING-SCALE. The bottleneck + the flow
 * come straight from the sim so they can't diverge from it. NOT a
 * validated discrete-event simulation, NOT CAD/BIM, NOT a certification.
 * Theme-aware (light + dark) and static (reduced-motion safe).
 *
 * Classic script attaching to the global `WT` namespace (works from
 * file:// too). Optional deps: WT.process + WT.wms (the sim outputs it
 * reads). No frameworks, no build step, fully offline, no deps.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const VERSION = "wt-analytics-1";

  const HONESTY =
    "Modelled, not measured; deterministic, teaching-scale. The named " +
    "bottleneck and the flow volumes come STRAIGHT from the same " +
    "simulation the app runs (Theory of Constraints for the production " +
    "line; per-stage load vs capacity for the warehouse) - the analysis " +
    "cannot diverge from it. NOT a validated discrete-event simulation, " +
    "NOT CAD/BIM, NOT a certification.";

  /* ------------------------------------------------------------------
   * Theme token sets. These MIRROR the app's own CSS variables (styles.css
   * :root and the prefers-color-scheme: dark block) so the panels match
   * whatever theme the page is in. SVG cannot read CSS vars, so the app
   * passes the theme name (or an override object) into the renderers.
   * ------------------------------------------------------------------ */
  const THEMES = {
    light: {
      surface: "#ffffff",
      panel: "#f8fafc",
      ink: "#0f172a",
      sub: "#475569",
      muted: "#64748b",
      grid: "#e2e8f0",
      track: "#eef2f7",
      node: "#334155",
      flow: "#0d9488", // material flow (teal)
      flowSoft: "#5eead4",
      good: "#16a34a",
      warn: "#d97706",
      crit: "#dc2626", // the constraint / dominant flow
    },
    dark: {
      surface: "#0f172a",
      panel: "#111c31",
      ink: "#e2e8f0",
      sub: "#94a3b8",
      muted: "#94a3b8",
      grid: "#1e293b",
      track: "#0c1524",
      node: "#94a3b8",
      flow: "#2dd4bf",
      flowSoft: "#155e57",
      good: "#4ade80",
      warn: "#fbbf24",
      crit: "#f87171",
    },
  };

  function resolveTheme(theme) {
    let mode = "light";
    if (typeof theme === "string") mode = theme === "dark" ? "dark" : "light";
    else if (theme && typeof theme === "object") mode = (theme.dark === true || theme.mode === "dark") ? "dark" : "light";
    return { mode: mode, t: THEMES[mode] };
  }

  /* ---- small deterministic helpers -------------------------------- */
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
  function clamp(v, a, b) { v = num(v, a); return v < a ? a : (v > b ? b : v); }
  // Fixed 2-decimal coordinate string -> byte-identical SVG across runs.
  function r2(n) { n = num(n, 0); const v = Math.round(n * 100) / 100; return (Object.is(v, -0) ? 0 : v).toFixed(2); }
  // Friendly integer-ish number for labels.
  function fmt(v) {
    const n = num(v, 0);
    return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  }
  // XML / HTML text escaping (SVG <text> + HTML labels are user-derived names).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ==================================================================
   * BOTTLENECK ANALYZER - the ranked model. Reads the constraint from the
   * sim so it can't drift. Returns:
   *   { mode, metricLabel, unit, resources[], constraint, headline, why,
   *     basis, honesty, throughput, throughputUnit }
   * resources are sorted #1..#n; resources[0] === constraint (the exact
   * resource the sim/process names as its bottleneck).
   * ================================================================== */

  // FACTORY: from WT.process.metrics(). Rank by station utilisation, which
  // is =1 at the bottleneck (utilisation = effTime / bottleneck effTime).
  // Tiebreak = flow order asc, matching the sim's first-max TOC choice.
  function bottleneckFromProcess(metrics) {
    if (!metrics || !Array.isArray(metrics.stations) || !metrics.stations.length) return null;
    const rows = metrics.stations.map((s, i) => {
      const util = clamp(s.utilisation, 0, 4);
      return {
        id: s.opId,
        name: s.name,
        order: i,
        value: util, // 0..1, =1 at the bottleneck
        pct: Math.round(util * 100),
        rankKey: num(s.effTimeSec, 0), // max effective cycle = the TOC bottleneck
        isConstraint: !!s.isBottleneck,
        detail: "cycle " + fmt(s.cycleSec) + " s x" + s.servers + " server" + (s.servers === 1 ? "" : "s") +
          " - " + fmt(s.effTimeSec) + " s/unit effective",
      };
    });
    rows.sort((a, b) => (b.rankKey - a.rankKey) || (a.order - b.order));
    rows.forEach((r, i) => { r.rank = i + 1; });
    const constraint = rows.find((r) => r.isConstraint) || rows[0];
    const tp = num(metrics.throughputPerHr, 0);
    const bEff = metrics.bottleneck ? num(metrics.bottleneck.effTimeSec, 0) : 0;
    return {
      mode: "factory",
      metricLabel: "Station utilisation (busy / available at the line pace)",
      unit: "%",
      resources: rows,
      constraint: constraint,
      headline: constraint.name + " is the constraint - it gates the line at " + fmt(tp) + " parts/hr.",
      why: "At the line's own pace this station is 100% busy while every other station waits on it " +
        "(Theory of Constraints). Line throughput = 3600 / its effective cycle (" + fmt(bEff) + " s/unit). " +
        "To lift the line, add a parallel server here or cut its cycle time - then the next station in the " +
        "ranking becomes the constraint.",
      basis: metrics.basis || "Theory of Constraints (bottleneck = max cycle/servers), takt, line efficiency.",
      honesty: HONESTY,
      throughput: tp,
      throughputUnit: "parts/hr",
    };
  }

  // WAREHOUSE: from WT.wms.runOperations(). Rank by load-vs-capacity; the
  // constraint is the LOWEST-capacity stage - the identical rule + tiebreak
  // (most peak backlog) wms.js uses, so resources[0] is exactly the stage
  // the flow sim reports as its bottleneck. The displayed bar value is the
  // offered-load / capacity ratio (congestion); the ranking key is 1/cap so
  // the min-capacity stage always ranks #1 regardless of the offered load.
  function bottleneckFromWarehouse(wms) {
    if (!wms || !Array.isArray(wms.stages) || !wms.stages.length) return null;
    const hours = num(wms.hours, 1) || 1;
    const demandPerHr = num(wms.totalUnits, 0) / hours; // offered load, units/hr
    const rows = wms.stages.map((s, i) => {
      const cap = num(s.capacityUnitsPerHr, 0);
      const load = cap > 0 ? demandPerHr / cap : 0; // load vs capacity
      const measured = clamp(s.avgUtilisation, 0, 1);
      const backlog = num(s.maxBacklog, 0);
      return {
        id: s.id,
        name: s.label,
        order: i,
        value: load,
        pct: Math.round(clamp(load, 0, 4) * 100),
        capacity: cap,
        measuredUtil: measured,
        maxBacklog: backlog,
        rankKey: cap > 0 ? 1 / cap : Number.MAX_VALUE, // lowest capacity ranks #1
        isConstraint: i === (wms.bottleneckIndex | 0),
        detail: "capacity " + fmt(cap) + " units/hr - measured busy " + Math.round(measured * 100) + "%" +
          (backlog > 0.5 ? " - peak backlog " + fmt(backlog) + " units" : ""),
      };
    });
    // Identical ordering to wms.js: lowest capacity first (max rankKey),
    // ties -> most peak backlog, then flow order.
    rows.sort((a, b) => (b.rankKey - a.rankKey) || (b.maxBacklog - a.maxBacklog) || (a.order - b.order));
    rows.forEach((r, i) => { r.rank = i + 1; });
    const constraint = rows.find((r) => r.isConstraint) || rows[0];
    return {
      mode: "warehouse",
      metricLabel: "Stage load vs capacity (offered demand / stage throughput)",
      unit: "%",
      resources: rows,
      constraint: constraint,
      headline: constraint.name + " is the constraint - the lowest-throughput stage (" +
        fmt(constraint.capacity) + " units/hr), so it caps the whole line" +
        (constraint.maxBacklog > 0.5 ? " and backs up to " + fmt(constraint.maxBacklog) + " units." : "."),
      why: "Every unit must pass this stage and it has the least throughput of the seven, so the whole " +
        "line runs at its pace (load = offered demand / capacity is highest here). To lift the line, add " +
        "capacity at this stage - more docks / stations / automation lanes serving it - then the next stage " +
        "in the ranking becomes the constraint.",
      basis: "Per-stage load vs capacity; the constraint is the lowest-capacity stage (matches the WMS flow sim's bottleneck).",
      honesty: HONESTY + " " + (wms.dataLabel || ""),
      throughput: num(wms.shippedUnits, 0) / hours,
      throughputUnit: "units/hr",
      demandPerHr: demandPerHr,
    };
  }

  /* ==================================================================
   * SANKEY MATERIAL-FLOW MODEL - nodes (stages/stations) + links (the
   * flow volume between consecutive nodes). Deterministic, straight from
   * the sim. Returns { mode, nodes[], links[], maxVolume, unit, honesty }.
   * ================================================================== */

  // FACTORY: Source -> stations -> Drain following process.routing (the
  // from-to flow matrix). Link volume = routing.unitsPerHr (intended flow;
  // the gozinto multiplier already shrinks/grows it at assembly/dismantle).
  function sankeyFromProcess(block) {
    if (!block || !Array.isArray(block.operations) || !block.operations.length) return null;
    const order = (WT.process && typeof WT.process.orderedOps === "function")
      ? WT.process.orderedOps(block)
      : block.operations.slice();
    const nodes = order.map((o) => ({ id: o.id, name: o.name, kind: o.kind }));
    const idIndex = {};
    nodes.forEach((n, i) => { idIndex[n.id] = i; });
    const links = [];
    const routing = Array.isArray(block.routing) ? block.routing : [];
    for (const r of routing) {
      if (idIndex[r.from] == null || idIndex[r.to] == null) continue;
      links.push({ from: r.from, to: r.to, fromIdx: idIndex[r.from], toIdx: idIndex[r.to], value: Math.max(0, num(r.unitsPerHr, 0)) });
    }
    // Keep the links in flow order (by from-node index) for a stable draw.
    links.sort((a, b) => (a.fromIdx - b.fromIdx) || (a.toIdx - b.toIdx));
    let maxVolume = 0;
    for (const l of links) maxVolume = Math.max(maxVolume, l.value);
    return {
      mode: "factory",
      unit: "units/hr",
      nodes: nodes,
      links: links,
      maxVolume: maxVolume,
      honesty: HONESTY,
    };
  }

  // WAREHOUSE: the 7-stage flow spine. Link volume between stage i and i+1
  // = the units the flow sim PROCESSED at stage i (what it hands downstream).
  function sankeyFromWarehouse(wms) {
    if (!wms || !Array.isArray(wms.stages) || wms.stages.length < 2) return null;
    const nodes = wms.stages.map((s) => ({ id: s.id, name: s.label, kind: s.role || "stage" }));
    const links = [];
    for (let i = 0; i < wms.stages.length - 1; i++) {
      links.push({
        from: wms.stages[i].id,
        to: wms.stages[i + 1].id,
        fromIdx: i,
        toIdx: i + 1,
        value: Math.max(0, num(wms.stages[i].processed, 0)),
      });
    }
    let maxVolume = 0;
    for (const l of links) maxVolume = Math.max(maxVolume, l.value);
    return {
      mode: "warehouse",
      unit: "units",
      nodes: nodes,
      links: links,
      maxVolume: maxVolume,
      honesty: HONESTY + " " + (wms.dataLabel || ""),
    };
  }

  /* ==================================================================
   * SANKEY GEOMETRY - a pure geometry model (no SVG). The dominant flow
   * (widest link) is flagged. Link band thickness is PROPORTIONAL to its
   * volume: w = value / maxVolume * maxThick. Verifiable independently of
   * the SVG string.
   * ================================================================== */
  function sankeyLayout(model, dims) {
    if (!model || !Array.isArray(model.nodes) || model.nodes.length < 2) return null;
    dims = dims || {};
    const W = num(dims.width, 680);
    const H = num(dims.height, 240);
    const padL = num(dims.padL, 10), padR = num(dims.padR, 10);
    const padT = num(dims.padT, 34), padB = num(dims.padB, 30);
    const nodeW = num(dims.nodeW, 12);
    const n = model.nodes.length;
    const innerW = Math.max(1, W - padL - padR);
    const chartH = Math.max(1, H - padT - padB);
    const midY = padT + chartH / 2;
    const maxThick = Math.min(chartH, num(dims.maxThick, 70));
    const minThick = num(dims.minThick, 2);
    const maxVol = model.maxVolume > 0 ? model.maxVolume : 1;
    const thickScale = maxThick / maxVol;

    const step = n > 1 ? (innerW - nodeW) / (n - 1) : 0;
    const colX = model.nodes.map((_, i) => padL + step * i);

    // Dominant flow = the widest link (max volume); ties -> earliest.
    let domIdx = -1, domVal = -1;
    model.links.forEach((l, i) => { if (l.value > domVal + 1e-9) { domVal = l.value; domIdx = i; } });

    const links = model.links.map((l, i) => {
      const w = l.value > 0 ? Math.max(minThick, l.value * thickScale) : 0;
      const x0 = colX[l.fromIdx] + nodeW;
      const x1 = colX[l.toIdx];
      return {
        index: i,
        from: l.from, to: l.to, fromIdx: l.fromIdx, toIdx: l.toIdx,
        value: l.value,
        w: w,
        x0: x0, x1: x1,
        yTop: midY - w / 2,
        yBot: midY + w / 2,
        isDominant: i === domIdx && l.value > 0,
      };
    });

    // Node bar height = the throughput passing THROUGH it = max(in, out) link.
    const inW = new Array(n).fill(0), outW = new Array(n).fill(0);
    links.forEach((l) => { outW[l.fromIdx] = Math.max(outW[l.fromIdx], l.w); inW[l.toIdx] = Math.max(inW[l.toIdx], l.w); });
    const nodes = model.nodes.map((nd, i) => {
      const h = Math.max(minThick + 2, Math.max(inW[i], outW[i]));
      return { id: nd.id, name: nd.name, kind: nd.kind, index: i, x: colX[i], w: nodeW, y: midY - h / 2, h: h };
    });

    return { width: W, height: H, midY: midY, padT: padT, nodes: nodes, links: links, maxVolume: maxVol, unit: model.unit, dominantIndex: domIdx };
  }

  /* ==================================================================
   * SANKEY SVG - serialize the geometry to a deterministic, well-formed,
   * theme-aware, static (reduced-motion safe) inline SVG. NO plotting lib.
   * ================================================================== */
  function sankeySvg(model, theme, dims) {
    const th = resolveTheme(theme);
    const t = th.t;
    const geo = sankeyLayout(model, dims);
    if (!geo) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 60" role="img" width="100%">' +
        '<title>Material-flow Sankey</title>' +
        '<text x="12" y="34" font-family="system-ui,sans-serif" font-size="13" fill="' + t.sub + '">No flow to draw yet.</text></svg>';
    }
    const W = geo.width, H = geo.height;
    const domLabel = model.mode === "factory" ? "Source -> Drain production flow" : "Receiving -> Shipping material flow";
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(W) + ' ' + r2(H) +
      '" role="img" width="100%" preserveAspectRatio="xMidYMid meet" class="an-sankey-svg">';
    s += '<title>' + esc(domLabel) + '</title>';
    s += '<desc>Material-flow Sankey; link widths are proportional to flow volume (' + esc(model.unit) +
      '). Modelled, deterministic, teaching-scale.</desc>';

    // Links first (under the node bars). Straight ribbons (a linear chain
    // has no branching); a gentle cubic keeps the ribbon soft.
    for (const l of geo.links) {
      if (l.w <= 0) continue;
      const cx = (l.x0 + l.x1) / 2;
      const d =
        "M" + r2(l.x0) + " " + r2(l.yTop) +
        "C" + r2(cx) + " " + r2(l.yTop) + " " + r2(cx) + " " + r2(l.yTop) + " " + r2(l.x1) + " " + r2(l.yTop) +
        "L" + r2(l.x1) + " " + r2(l.yBot) +
        "C" + r2(cx) + " " + r2(l.yBot) + " " + r2(cx) + " " + r2(l.yBot) + " " + r2(l.x0) + " " + r2(l.yBot) +
        "Z";
      const fill = l.isDominant ? t.flow : t.flowSoft;
      const op = l.isDominant ? "0.85" : "0.55";
      s += '<path d="' + d + '" fill="' + fill + '" fill-opacity="' + op + '">' +
        '<title>' + esc(model.nodes[l.fromIdx].name) + " -> " + esc(model.nodes[l.toIdx].name) +
        ": " + esc(fmt(l.value)) + " " + esc(model.unit) + '</title></path>';
    }

    // Node bars + labels.
    for (const nd of geo.nodes) {
      s += '<rect x="' + r2(nd.x) + '" y="' + r2(nd.y) + '" width="' + r2(nd.w) + '" height="' + r2(nd.h) +
        '" rx="2" fill="' + t.node + '"><title>' + esc(nd.name) + '</title></rect>';
    }
    // Labels: alternate above / below the mid-line so they never overlap.
    for (let i = 0; i < geo.nodes.length; i++) {
      const nd = geo.nodes[i];
      const cx = nd.x + nd.w / 2;
      const above = (i % 2) === 0;
      const ly = above ? (geo.padT - 8) : (H - 10);
      const anchor = i === 0 ? "start" : (i === geo.nodes.length - 1 ? "end" : "middle");
      const lx = i === 0 ? nd.x : (i === geo.nodes.length - 1 ? nd.x + nd.w : cx);
      s += '<text x="' + r2(lx) + '" y="' + r2(ly) + '" font-family="system-ui,-apple-system,sans-serif" ' +
        'font-size="11" fill="' + t.sub + '" text-anchor="' + anchor + '">' + esc(shortName(nd.name)) + '</text>';
    }
    s += "</svg>";
    return s;
  }

  function shortName(name) {
    const s = String(name == null ? "" : name);
    return s.length > 22 ? s.slice(0, 21) + "…" : s;
  }

  /* ==================================================================
   * BOTTLENECK BAR CHART SVG - a deterministic, theme-aware ranked bar
   * chart. Bars are 0-based and PROPORTIONAL to the ranked value (width =
   * value / maxValue * barMax); the constraint bar is flagged in the
   * critical colour with a text tag. The accessible ranked TABLE the app
   * also renders carries the same data for screen readers.
   * ================================================================== */
  function bottleneckSvg(model, theme, dims) {
    const th = resolveTheme(theme);
    const t = th.t;
    if (!model || !Array.isArray(model.resources) || !model.resources.length) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 40" role="img" width="100%">' +
        '<text x="10" y="24" font-family="system-ui,sans-serif" font-size="13" fill="' + t.sub + '">Nothing to rank yet.</text></svg>';
    }
    dims = dims || {};
    const W = num(dims.width, 640);
    const rowH = num(dims.rowH, 30);
    const padT = num(dims.padT, 8), padB = num(dims.padB, 8);
    const labelW = num(dims.labelW, 190);
    const valW = num(dims.valW, 54);
    const barX = labelW + 6;
    const barMax = Math.max(1, W - barX - valW - 6);
    const rows = model.resources;
    const H = padT + padB + rows.length * rowH;
    let maxValue = 0;
    for (const r of rows) maxValue = Math.max(maxValue, num(r.value, 0));
    if (maxValue <= 0) maxValue = 1;

    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(W) + ' ' + r2(H) +
      '" role="img" width="100%" preserveAspectRatio="xMidYMid meet" class="an-bar-svg">';
    s += '<title>Resources ranked by ' + esc(model.metricLabel) + '</title>';
    s += '<desc>Ranked bar chart; the #1 bar is the constraint. Bars are 0-based and proportional. Modelled, deterministic, teaching-scale.</desc>';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = padT + i * rowH;
      const cy = y + rowH / 2;
      const val = num(r.value, 0);
      const w = Math.max(0, (val / maxValue) * barMax);
      const fill = r.isConstraint ? t.crit : t.flow;
      // Track (0-based baseline).
      s += '<rect x="' + r2(barX) + '" y="' + r2(y + 5) + '" width="' + r2(barMax) + '" height="' + r2(rowH - 12) +
        '" rx="3" fill="' + t.track + '"/>';
      // Value bar.
      s += '<rect x="' + r2(barX) + '" y="' + r2(y + 5) + '" width="' + r2(w) + '" height="' + r2(rowH - 12) +
        '" rx="3" fill="' + fill + '"><title>' + esc(r.name) + ": " + esc(String(r.pct)) + '%</title></rect>';
      // Rank + name label.
      s += '<text x="0" y="' + r2(cy + 4) + '" font-family="system-ui,-apple-system,sans-serif" font-size="12" fill="' + t.ink + '">' +
        esc(String(r.rank) + ". " + shortName(r.name)) + (r.isConstraint ? " ⬥" : "") + "</text>";
      // Value % at the right.
      s += '<text x="' + r2(W) + '" y="' + r2(cy + 4) + '" font-family="system-ui,-apple-system,sans-serif" font-size="12" ' +
        'text-anchor="end" fill="' + (r.isConstraint ? t.crit : t.sub) + '">' + esc(String(r.pct)) + "%</text>";
    }
    s += "</svg>";
    return s;
  }

  /* ==================================================================
   * COST + ENERGY ANALYZERS (v3.2) - two more READ-ONLY analysis views over
   * the SAME sim state (Siemens Plant Simulation "Tools" parity: CostAnalyzer
   * + EnergyAnalyzer - free, offline, honest). Nothing is re-run: the Cost
   * Analyzer reads the sim's throughput + the placed equipment; the Energy
   * Analyzer reads labelled power ratings x active time from the sim. Rates
   * are ILLUSTRATIVE, EDITABLE constants - editing one changes the ANALYSIS
   * VIEW only, never the layout or the data model. Every figure is MODELLED,
   * NOT MEASURED / NOT METERED / NOT A QUOTE; deterministic, teaching-scale.
   *
   *   COST  = equipment (amortised capex) + labour + energy
   *   cost / unit = total / throughput (identity holds by construction)
   *   ENERGY = SUM(power x active-time)   energy / unit = total / throughput
   *   CO2   = energy x an editable illustrative grid factor (optional line)
   * ================================================================== */

  const COST_HONESTY =
    "Illustrative operating cost from EDITABLE assumptions - NOT a quote. " +
    "Equipment capex is amortised at illustrative rates; labour and energy " +
    "are modelled from the sim's throughput and active time, NOT metered. " +
    "Deterministic, teaching-scale. Editing a rate changes the analysis view " +
    "only, never the layout.";

  const ENERGY_HONESTY =
    "Energy MODELLED from illustrative power ratings x active time from the " +
    "sim - NOT metered. The grid CO2 factor is an editable illustrative " +
    "constant, not a measurement. Deterministic, teaching-scale. Editing a " +
    "rate changes the analysis view only, never the layout.";

  const CURRENCY = "€"; // euro

  // Equipment classes: each groups placed element TYPES and carries default
  // ILLUSTRATIVE rates (capex EUR, amortisation years, power kW). Ordered for
  // a deterministic breakdown. Teaching-scale - NOT vendor specs, NOT measured.
  const EQUIP_CLASSES = [
    { key: "racking", label: "Storage racking (passive)", capex: 8000, amortYears: 15, powerKW: 0.15,
      types: ["selective-racking", "block-stack", "drive-in", "double-deep", "push-back", "pallet-flow",
        "carton-flow", "mobile-racking", "cantilever", "mezzanine", "pick-to-light", "vna"] },
    { key: "asrs", label: "AS/RS crane aisle", capex: 250000, amortYears: 12, powerKW: 15, types: ["asrs"] },
    { key: "shuttle", label: "Shuttle system", capex: 180000, amortYears: 10, powerKW: 8, types: ["shuttle"] },
    { key: "conveyor", label: "Conveyor / sortation", capex: 12000, amortYears: 10, powerKW: 1.5,
      types: ["conveyor", "conveyor-curve", "sorter"] },
    { key: "amr", label: "AGV / RGV transport", capex: 45000, amortYears: 8, powerKW: 2, types: ["agv", "rgv"] },
    { key: "forklift", label: "Forklift / reach truck", capex: 35000, amortYears: 8, powerKW: 3, types: ["forklift"] },
    { key: "dock", label: "Dock door + leveller", capex: 15000, amortYears: 20, powerKW: 0.5, types: ["dock-in", "dock-out"] },
    { key: "workstation", label: "Pack / handling station", capex: 6000, amortYears: 10, powerKW: 0.6,
      types: ["pack-station", "push-station", "pull-station", "returns-station"] },
    { key: "wrapper", label: "Stretch wrapper", capex: 20000, amortYears: 12, powerKW: 2, types: ["stretch-wrap"] },
    { key: "charging", label: "Charging station", capex: 8000, amortYears: 10, powerKW: 0.2, types: ["charging-station"] },
  ];

  // Factory station kinds (from WT.process.metrics().stations[].kind): each
  // carries default illustrative rates. Keys share the rates.equipment
  // namespace with EQUIP_CLASSES (no collision). `labour` = does it need a
  // tending operator (source/drain do not). NOT vendor specs, NOT measured.
  const STATION_KINDS = [
    { key: "station", label: "Workstation", capex: 60000, amortYears: 10, powerKW: 5, labour: true },
    { key: "parallel", label: "Parallel machining station", capex: 80000, amortYears: 10, powerKW: 7, labour: true },
    { key: "assembly", label: "Assembly station", capex: 90000, amortYears: 10, powerKW: 6, labour: true },
    { key: "dismantle", label: "Dismantle station", capex: 70000, amortYears: 10, powerKW: 6, labour: true },
    { key: "source", label: "Parts source", capex: 8000, amortYears: 15, powerKW: 0.5, labour: false },
    { key: "sink", label: "Finished drain", capex: 8000, amortYears: 15, powerKW: 0.5, labour: false },
  ];

  const CLASS_LABEL = {};
  const TYPE_TO_CLASS = {};
  const STATION_LABOUR = {};
  EQUIP_CLASSES.forEach((c) => { CLASS_LABEL[c.key] = c.label; c.types.forEach((t) => { TYPE_TO_CLASS[t] = c.key; }); });
  STATION_KINDS.forEach((k) => { CLASS_LABEL[k.key] = k.label; STATION_LABOUR[k.key] = !!k.labour; });

  // A fresh deep copy of the DEFAULT illustrative rates. Never share the object
  // - the app edits its OWN copy; the defaults stay pristine for Reset.
  function defaultRates() {
    const equip = {};
    EQUIP_CLASSES.forEach((c) => { equip[c.key] = { capex: c.capex, amortYears: c.amortYears, powerKW: c.powerKW }; });
    STATION_KINDS.forEach((k) => { equip[k.key] = { capex: k.capex, amortYears: k.amortYears, powerKW: k.powerKW }; });
    return {
      energyPricePerKWh: 0.30, // EUR / kWh (illustrative EU-ish tariff)
      co2PerKWh: 0.30,         // kg CO2e / kWh (illustrative grid factor)
      labourPerHour: 35,       // EUR / labour-hour (fully loaded, illustrative)
      hoursPerYear: 4000,      // operating hours / year (amortisation basis, ~2 shifts)
      equipment: equip,
    };
  }

  // Read one equipment/station rate with a safe fallback to the seed default
  // (a garbage/blank edit never breaks the maths - it falls back).
  function rateFor(rates, key) {
    const e = rates && rates.equipment && rates.equipment[key];
    const def = EQUIP_CLASSES.find((c) => c.key === key) || STATION_KINDS.find((k) => k.key === key) || {};
    return {
      capex: e && Number.isFinite(Number(e.capex)) && Number(e.capex) >= 0 ? Number(e.capex) : num(def.capex, 0),
      amortYears: e && Number(e.amortYears) > 0 ? Number(e.amortYears) : Math.max(1, num(def.amortYears, 10)),
      powerKW: e && Number.isFinite(Number(e.powerKW)) && Number(e.powerKW) >= 0 ? Number(e.powerKW) : num(def.powerKW, 0),
    };
  }
  function rateNum(rates, key, dflt) {
    const v = rates ? Number(rates[key]) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  }

  // Count placed elements by equipment class (warehouse). PURE, read-only -
  // never mutates the element array.
  function classifyEquipment(elements) {
    const counts = {};
    if (Array.isArray(elements)) {
      for (const el of elements) {
        const cls = el && TYPE_TO_CLASS[el.type];
        if (cls) counts[cls] = (counts[cls] || 0) + 1;
      }
    }
    return counts;
  }

  // The sim's operating window (hours) - a genuine sim quantity, NOT invented.
  function operatingHours(mode, sim) {
    if (mode === "factory") { const h = num(sim && sim.shiftSec, 0) / 3600; return h > 0 ? h : 8; }
    return Math.max(1e-9, num(sim && sim.hours, 1));
  }
  // Units the sim moved over the window (per-unit denominator): warehouse ships
  // pallet-equivalent units; the factory line makes parts (throughput x hours).
  function throughputUnits(mode, sim, H) {
    if (mode === "factory") return Math.max(0, num(sim && sim.throughputPerHr, 0) * H);
    return Math.max(0, num(sim && sim.shippedUnits, 0));
  }

  // Build the per-resource rows (equipment/station). ENERGY = power x active
  // time; active time comes STRAIGHT from the sim:
  //   factory   -> per station: active hours = H x station utilisation, and
  //                power/capex scale by the station's server count.
  //   warehouse -> per equipment class: active hours = H x duty, where duty =
  //                how hard the constraint ran (served / bottleneck capacity),
  //                both sim outputs. Deterministic, non-mutating.
  function resourceRows(input, rates, H) {
    const mode = input.mode === "factory" ? "factory" : "warehouse";
    const sim = input.sim || {};
    const rows = [];
    let duty = 1;
    if (mode === "factory") {
      const stations = Array.isArray(sim.stations) ? sim.stations : [];
      for (const st of stations) {
        const key = STATION_LABOUR.hasOwnProperty(st.kind) ? st.kind : "station";
        const rate = rateFor(rates, key);
        const servers = Math.max(0, Math.round(num(st.servers, 1)));
        const util = clamp(st.utilisation, 0, 1);
        const activeHours = H * util;
        rows.push({
          key: key, label: CLASS_LABEL[key] || key, name: st.name || CLASS_LABEL[key] || key,
          count: servers, powerKW: rate.powerKW, capex: rate.capex, amortYears: rate.amortYears,
          util: util, labour: STATION_LABOUR[key] === true, activeHours: activeHours,
          energyKWh: rate.powerKW * servers * activeHours,
        });
      }
    } else {
      const counts = classifyEquipment(input.elements);
      const bIdx = sim.bottleneckIndex | 0;
      const bStage = Array.isArray(sim.stages) ? sim.stages[bIdx] : null;
      const bCap = bStage ? num(bStage.capacityUnitsPerHr, 0) : 0;
      const served = H > 0 ? num(sim.shippedUnits, 0) / H : 0; // units/hr the line shipped
      duty = bCap > 0 ? clamp(served / bCap, 0, 1) : 1;         // constraint load fraction (sim)
      const activeHours = H * duty;
      for (const c of EQUIP_CLASSES) {
        const count = counts[c.key] || 0;
        if (count <= 0) continue;
        const rate = rateFor(rates, c.key);
        rows.push({
          key: c.key, label: c.label, name: c.label,
          count: count, powerKW: rate.powerKW, capex: rate.capex, amortYears: rate.amortYears,
          util: duty, labour: false, activeHours: activeHours,
          energyKWh: rate.powerKW * count * activeHours,
        });
      }
    }
    return { rows: rows, duty: duty };
  }

  // Group per-resource rows by class/kind for the breakdown table (sum energy +
  // count; keep the shared per-item power rate). Deterministic first-seen order.
  function groupResources(rows) {
    const out = [], idx = {};
    for (const r of rows) {
      if (idx[r.key] == null) { idx[r.key] = out.length; out.push({ key: r.key, label: r.label, count: 0, powerKW: r.powerKW, energyKWh: 0 }); }
      const g = out[idx[r.key]];
      g.count += r.count; g.energyKWh += r.energyKWh;
    }
    return out;
  }

  // Labour hours over the window from the sim (paid headcount x active time):
  //   factory   -> SUM over tending stations of servers x H x utilisation.
  //   warehouse -> H x SUM of the 7 stages' average utilisation (one operator-
  //                equivalent per stage, active per its measured busy share).
  function labourHours(mode, sim, H) {
    if (mode === "factory") {
      let lh = 0;
      const stations = Array.isArray(sim.stations) ? sim.stations : [];
      for (const st of stations) {
        if (STATION_LABOUR[st.kind] === false) continue;
        lh += Math.max(0, Math.round(num(st.servers, 1))) * H * clamp(st.utilisation, 0, 1);
      }
      return lh;
    }
    let sumUtil = 0;
    const stages = Array.isArray(sim.stages) ? sim.stages : [];
    for (const s of stages) sumUtil += clamp(s.avgUtilisation, 0, 1);
    return H * sumUtil;
  }

  /* ----- ENERGY ANALYZER: total kWh, energy/unit, CO2, per-class breakdown -- */
  function energyModel(input, rates) {
    input = input || {};
    if (!input.sim) return null;
    rates = rates || defaultRates();
    const mode = input.mode === "factory" ? "factory" : "warehouse";
    const H = operatingHours(mode, input.sim);
    const tp = throughputUnits(mode, input.sim, H);
    const built = resourceRows(input, rates, H);
    let totalKWh = 0;
    for (const r of built.rows) totalKWh += r.energyKWh;
    const co2Factor = rateNum(rates, "co2PerKWh", 0.30);
    return {
      mode: mode,
      unit: "kWh",
      resources: built.rows,
      byClass: groupResources(built.rows),
      totalKWh: totalKWh,
      co2Factor: co2Factor,
      co2Kg: totalKWh * co2Factor,
      perUnit: tp > 0 ? totalKWh / tp : 0,
      throughput: tp,
      throughputUnit: mode === "factory" ? "part" : "unit",
      operatingHours: H,
      dutyCycle: built.duty,
      honesty: ENERGY_HONESTY + (mode === "warehouse" && input.sim.dataLabel ? " " + input.sim.dataLabel : ""),
    };
  }

  /* ----- COST ANALYZER: equipment (amortised) + labour + energy, cost/unit -- */
  function costModel(input, rates) {
    input = input || {};
    if (!input.sim) return null;
    rates = rates || defaultRates();
    const mode = input.mode === "factory" ? "factory" : "warehouse";
    const H = operatingHours(mode, input.sim);
    const tp = throughputUnits(mode, input.sim, H);
    const em = energyModel(input, rates); // energy category == the Energy analyzer (can't diverge)

    const hoursPerYear = Math.max(1, rateNum(rates, "hoursPerYear", 4000));
    const periodFraction = H / hoursPerYear; // share of a year the window covers
    let equipmentCost = 0;
    for (const r of em.resources) {
      equipmentCost += r.count * (r.capex / Math.max(1, r.amortYears)) * periodFraction;
    }
    const lh = labourHours(mode, input.sim, H);
    const labourCost = lh * rateNum(rates, "labourPerHour", 35);
    const energyCost = em.totalKWh * rateNum(rates, "energyPricePerKWh", 0.30);
    const totalCost = equipmentCost + labourCost + energyCost;

    const categories = [
      { key: "equipment", label: "Equipment (amortised capex)", amount: equipmentCost },
      { key: "labour", label: "Labour", amount: labourCost },
      { key: "energy", label: "Energy", amount: energyCost },
    ];
    return {
      mode: mode,
      currency: CURRENCY,
      categories: categories,
      equipmentByClass: em.byClass,
      totalCost: totalCost,
      perUnit: tp > 0 ? totalCost / tp : 0,
      throughput: tp,
      throughputUnit: mode === "factory" ? "part" : "unit",
      operatingHours: H,
      hoursPerYear: hoursPerYear,
      labourHours: lh,
      energy: em,
      honesty: COST_HONESTY + (mode === "warehouse" && input.sim.dataLabel ? " " + input.sim.dataLabel : ""),
    };
  }

  /* ==================================================================
   * GENERIC BREAKDOWN BAR-CHART SVG - deterministic, theme-aware, 0-based,
   * proportional. Reused by the Cost (by category) + Energy (by resource)
   * views. rows: [{ label, value(number, >=0), text(display string), emphasis }].
   * ================================================================== */
  function breakdownSvg(rows, theme, opts) {
    const th = resolveTheme(theme);
    const t = th.t;
    rows = Array.isArray(rows) ? rows : [];
    opts = opts || {};
    if (!rows.length) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 40" role="img" width="100%">' +
        '<text x="10" y="24" font-family="system-ui,sans-serif" font-size="13" fill="' + t.sub + '">Nothing to break down yet.</text></svg>';
    }
    const W = num(opts.width, 640);
    const rowH = num(opts.rowH, 28);
    const padT = 8, padB = 8;
    const labelW = num(opts.labelW, 200);
    const valW = num(opts.valW, 96);
    const barX = labelW + 6;
    const barMax = Math.max(1, W - barX - valW - 6);
    const H = padT + padB + rows.length * rowH;
    let maxV = 0;
    for (const r of rows) maxV = Math.max(maxV, num(r.value, 0));
    if (maxV <= 0) maxV = 1;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(W) + ' ' + r2(H) +
      '" role="img" width="100%" preserveAspectRatio="xMidYMid meet" class="an-bar-svg">';
    s += '<title>' + esc(opts.title || "Breakdown") + '</title>';
    s += '<desc>Proportional breakdown; bars are 0-based. Modelled, illustrative, deterministic.</desc>';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = padT + i * rowH;
      const cy = y + rowH / 2;
      const val = Math.max(0, num(r.value, 0));
      const w = Math.max(0, (val / maxV) * barMax);
      const fill = r.emphasis ? t.flow : t.flowSoft;
      const txt = r.text != null ? String(r.text) : fmt(val);
      s += '<rect x="' + r2(barX) + '" y="' + r2(y + 5) + '" width="' + r2(barMax) + '" height="' + r2(rowH - 12) +
        '" rx="3" fill="' + t.track + '"/>';
      s += '<rect x="' + r2(barX) + '" y="' + r2(y + 5) + '" width="' + r2(w) + '" height="' + r2(rowH - 12) +
        '" rx="3" fill="' + fill + '"><title>' + esc(r.label) + ": " + esc(txt) + '</title></rect>';
      s += '<text x="0" y="' + r2(cy + 4) + '" font-family="system-ui,-apple-system,sans-serif" font-size="12" fill="' + t.ink + '">' +
        esc(shortName(r.label)) + "</text>";
      s += '<text x="' + r2(W) + '" y="' + r2(cy + 4) + '" font-family="system-ui,-apple-system,sans-serif" font-size="12" ' +
        'text-anchor="end" fill="' + t.sub + '">' + esc(txt) + "</text>";
    }
    s += "</svg>";
    return s;
  }

  WT.analytics = {
    VERSION: VERSION,
    HONESTY: HONESTY,
    THEMES: THEMES,
    resolveTheme: resolveTheme,
    esc: esc,
    // bottleneck analyzer
    bottleneckFromProcess: bottleneckFromProcess,
    bottleneckFromWarehouse: bottleneckFromWarehouse,
    bottleneckSvg: bottleneckSvg,
    // sankey material-flow
    sankeyFromProcess: sankeyFromProcess,
    sankeyFromWarehouse: sankeyFromWarehouse,
    sankeyLayout: sankeyLayout,
    sankeySvg: sankeySvg,
    // v3.2 cost + energy analyzers (read-only, editable illustrative rates)
    COST_HONESTY: COST_HONESTY,
    ENERGY_HONESTY: ENERGY_HONESTY,
    CURRENCY: CURRENCY,
    EQUIP_CLASSES: EQUIP_CLASSES,
    STATION_KINDS: STATION_KINDS,
    CLASS_LABEL: CLASS_LABEL,
    defaultRates: defaultRates,
    classifyEquipment: classifyEquipment,
    energyModel: energyModel,
    costModel: costModel,
    breakdownSvg: breakdownSvg,
  };
})();
