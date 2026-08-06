/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * analytics.js - the ANALYTICS suite (A1): Bottleneck Analyzer + Sankey
 *                material-flow diagram (Siemens Plant Simulation "Tools"
 *                parity - BottleneckAnalyzer + SankeyDiagram - free,
 *                offline, honest).
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
  };
})();
