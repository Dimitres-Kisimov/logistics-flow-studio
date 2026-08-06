/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * report.js - the consolidated "WMS Report" (phase P7)
 * ---------------------------------------------------------------------
 * ONE printable, exportable report that summarises the CURRENT model by
 * pulling every layer we have built into a single stakeholder artifact.
 * It does NOT recompute the physics - it AGGREGATES the real modules so
 * the report can never drift from the app:
 *
 *   header          - scenario / data mode / floor size / passed-in stamp
 *   layout          - element counts, storage capacity, floor use %
 *                     (WT.domain.elementCapacity - the single capacity fn)
 *   compliance      - pass/warn/fail per rule + the informed-by values
 *                     (verbatim from WT.compliance.check)
 *   operations      - throughput, cycle time, dock-to-stock, picking
 *                     productivity, utilisation, bottleneck
 *                     (WT.wms.runOperations + WT.wms.kpis)
 *   storage         - occupancy %, ABC placement quality, overflow
 *                     (WT.storage.buildLocations/assign/stats/occupancy)
 *   automation      - per-system throughput + utilisation + constraint
 *                     (WT.automation.report)
 *   dataProfile     - SKU / order statistics (WT.wmsdata.stats)
 *   standardsBasis  - the KB entries that informed the numbers, with their
 *                     sources + the not-a-certification note (WT.kb.list)
 *
 * API (pure + deterministic):
 *   build(layout, opts)  -> a structured, JSON-safe report object. Every
 *                           number is sourced from the real modules above.
 *                           Any timestamp is PASSED IN via opts.timestamp
 *                           so the body stays byte-stable; the module never
 *                           reads Date / Math.random itself.
 *   toHtml(report)       -> a SELF-CONTAINED printable HTML string (inline
 *                           CSS, no external refs, A4-print-friendly) with
 *                           the honesty banner. Print-to-PDF in the browser.
 *   toJson(report)       -> the full report as deterministic JSON bytes.
 *   toCsv(report)        -> a flat metric/value CSV roll-up (Excel-openable).
 *   SECTIONS             -> the section roster {key,title} the report emits.
 *
 * HARD HONESTY (mirrored in the UI + README): every figure is a
 * transparent, deterministic HEURISTIC informed by published standards
 * (ISO 22400, DIN 15185, ASR A1.8/A2.3, EN/VDI 4480/2510). All numbers are
 * SYNTHETIC teaching estimates unless the user imported their own data.
 * The report is NOT a certification, NOT measured and NOT a compliance /
 * safety statement. No real brands.
 *
 * Determinism: a pure function of (layout, opts, the loaded KB). No Date,
 * no Math.random. Classic script attaching to the global `WT` namespace so
 * it works from file:// too. Loads AFTER every module it aggregates
 * (domain, compliance, wms, automation, storage, wmsdata, knowledge). No
 * frameworks, no build step, fully offline.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const REPORT_VERSION = "wt-report-1";

  const HONESTY =
    "SYNTHETIC WMS report - every figure is a transparent, deterministic " +
    "HEURISTIC informed by published standards (ISO 22400, DIN 15185, " +
    "ASR A1.8 / A2.3, EN / VDI 4480 / VDI 2510). All numbers are SYNTHETIC " +
    "teaching estimates unless you imported your own SKU / order data, in " +
    "which case that layer is yours and stays on this device. This report " +
    "is NOT a certification, NOT measured, NOT a compliance or safety " +
    "statement and NOT a Gefaehrdungsbeurteilung - the user's to verify " +
    "against each standard's full text.";

  // The section roster the report emits, in order. Titles are the printed
  // <h2> headers; keys are the top-level report object fields.
  const SECTIONS = [
    { key: "header", title: "Report header" },
    { key: "layout", title: "Layout summary" },
    { key: "compliance", title: "Compliance findings" },
    { key: "operations", title: "WMS operations KPIs" },
    { key: "storage", title: "Storage & inventory" },
    { key: "automation", title: "Automation systems" },
    { key: "analytics", title: "Analysis suite (bottleneck, flow, cost, energy)" },
    { key: "dataProfile", title: "Data profile" },
    { key: "standardsBasis", title: "Standards basis" },
  ];

  // Fixed light theme for the printable report (white background). The
  // analytics SVGs are self-styling inline (no external CSS); passing a
  // constant theme keeps the report bytes deterministic.
  const REPORT_THEME = "light";

  // ------------------------------------------------------------------
  // Small helpers.
  // ------------------------------------------------------------------
  function mod(name) { return WT[name] || null; }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round1(v) { return Math.round(num(v) * 10) / 10; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtInt(v) { return Math.round(num(v)).toLocaleString("en-US"); }
  function fmtNum(v, d) {
    if (!isFinite(Number(v))) return "-";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d });
  }

  // Deep clone that guarantees a JSON round-trip: non-finite numbers -> null,
  // undefined / functions dropped, so JSON.parse(JSON.stringify(x)) === x.
  function jsonSafe(v) {
    if (v === null) return null;
    const t = typeof v;
    if (t === "number") return isFinite(v) ? v : null;
    if (t === "string" || t === "boolean") return v;
    if (t === "undefined" || t === "function") return undefined;
    if (Array.isArray(v)) return v.map((x) => { const s = jsonSafe(x); return s === undefined ? null : s; });
    if (t === "object") {
      const out = {};
      for (const k of Object.keys(v)) {
        const s = jsonSafe(v[k]);
        if (s !== undefined) out[k] = s;
      }
      return out;
    }
    return undefined;
  }

  // ------------------------------------------------------------------
  // Config resolution. A single, explicit, JSON-safe config object is used
  // for EVERY module call and echoed in report.meta.config so a consumer
  // (and the verify harness) can reproduce each source-module result and
  // prove cross-consistency.
  // ------------------------------------------------------------------
  function resolveConfig(layout, opts) {
    const o = opts || {};
    const lc = (layout && layout.config) || {};
    const oc = o.config || {};
    const D = mod("domain");
    const defAisle = (D && D.AISLE && D.AISLE.defaultMinMetres) || 2.9;
    const pick = (k, d) => (oc[k] != null ? oc[k] : (lc[k] != null ? lc[k] : d));
    return {
      seed: Math.max(0, Math.round(num(pick("seed", 42)))),
      strategy: pick("strategy", "abc") || "abc",
      orders: Math.max(1, Math.round(num(pick("orders", 300)))),
      hours: Math.max(1, Math.round(num(pick("hours", 8)))),
      skuCount: Math.max(1, Math.round(num(pick("skuCount", 80)))),
      demandSkew: num(pick("demandSkew", 1), 1) || 1,
      minAisleMetres: num(pick("minAisleMetres", defAisle), defAisle),
    };
  }

  // ------------------------------------------------------------------
  // Section builders. Each PULLS from the owning module; nothing is
  // re-derived. A section that cannot be produced for this layout is marked
  // { available:false, note } rather than throwing.
  // ------------------------------------------------------------------
  function buildHeader(layout, cfg, o, imported) {
    const D = mod("domain");
    const gridW = num((layout && layout.gridW), 40) || 40;
    const gridH = num((layout && layout.gridH), 24) || 24;
    const cell = num((layout && layout.cell), (D && D.METRES_PER_CELL) || 1) || 1;
    // Scenario: from opts, else the layout's own example meta if present.
    let scenario = null;
    if (o.scenario && typeof o.scenario === "object") {
      scenario = {
        id: o.scenario.id != null ? String(o.scenario.id) : null,
        name: o.scenario.name != null ? String(o.scenario.name) : null,
        industry: o.scenario.industry != null ? String(o.scenario.industry) : null,
        description: o.scenario.description != null ? String(o.scenario.description) : null,
      };
    } else if (layout && layout.meta && layout.meta.name) {
      scenario = {
        id: layout.meta.exampleId != null ? String(layout.meta.exampleId) : null,
        name: String(layout.meta.name),
        industry: layout.meta.industry != null ? String(layout.meta.industry) : null,
        description: layout.meta.description != null ? String(layout.meta.description) : null,
      };
    }
    return {
      title: "WMS Report",
      scenario: scenario,
      floor: {
        gridW: gridW, gridH: gridH, cell: cell,
        widthM: round1(gridW * cell), depthM: round1(gridH * cell),
        areaM2: round1(gridW * cell * gridH * cell),
      },
      generatedAt: o.timestamp != null ? String(o.timestamp) : null,
      dataMode: imported ? "imported (your data)" : "synthetic (generated)",
      imported: imported,
    };
  }

  function buildLayoutSummary(layout) {
    const D = mod("domain");
    const els = (layout && layout.elements) || [];
    const gridW = num((layout && layout.gridW), 40) || 40;
    const gridH = num((layout && layout.gridH), 24) || 24;

    const counts = {};
    let storageCapacity = 0;
    let floorArea = 0;
    for (const e of els) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (D && typeof D.elementCapacity === "function") storageCapacity += num(D.elementCapacity(e));
      floorArea += num(e.w) * num(e.d);
    }

    // Emit counts in the app's palette order for a stable, readable table.
    const order = (D && D.paletteOrder) ? D.paletteOrder.slice() : [];
    const seen = {};
    const byType = [];
    const labelOf = (t) => (D && D.ELEMENTS && D.ELEMENTS[t] && D.ELEMENTS[t].label) || t;
    for (const t of order) {
      if (counts[t]) { byType.push({ type: t, label: labelOf(t), count: counts[t] }); seen[t] = true; }
    }
    Object.keys(counts).sort().forEach((t) => {
      if (!seen[t]) byType.push({ type: t, label: labelOf(t), count: counts[t] });
    });

    return {
      elementCount: els.length,
      storageCapacityPositions: storageCapacity,
      floorUsePct: round1(floorArea / (gridW * gridH) * 100),
      byType: byType,
    };
  }

  function buildCompliance(layout, cfg) {
    const C = mod("compliance");
    if (!C || typeof C.check !== "function") return { available: false, note: "compliance.js not loaded." };
    const rep = C.check(layout, cfg);
    return {
      available: true,
      version: rep.version,
      summary: rep.summary, // {pass, warn, fail, total, worst}
      findings: rep.findings.map((f) => ({
        ruleId: f.ruleId,
        rule: f.rule,
        guideline: f.guideline,
        status: f.status,
        informedBy: f.informedBy,
        measured: f.measured,
        elementCount: (f.elements || []).length,
        explain: f.explain,
      })),
      guidelines: rep.guidelines,
      disclaimer: rep.disclaimer,
    };
  }

  function buildOperations(layout, cfg, precomputedRun) {
    const W = mod("wms");
    if (!W || typeof W.runOperations !== "function") return { available: false, note: "wms.js not loaded." };
    const run = precomputedRun || W.runOperations(layout, { orders: cfg.orders, hours: cfg.hours, seed: cfg.seed });
    const kp = W.kpis(run, layout);
    return {
      available: true,
      ran: !!run.ok,
      note: run.ok ? null : "The 7-stage flow needs at least one storage element (racking / block stack) to run; add storage, then this section fills in.",
      seed: run.seed,
      orders: run.orders,
      hours: run.hours,
      totalUnits: run.totalUnits,
      shippedUnits: run.shippedUnits,
      remainingWip: run.remainingWip,
      throughputUnitsPerHr: kp.throughputUnitsPerHr,
      throughputOrdersPerHr: kp.throughputOrdersPerHr,
      orderCycleTimeMin: kp.orderCycleTimeMin,
      dockToStockMin: kp.dockToStockMin,
      pickingLinesPerHr: kp.pickingLinesPerHr,
      storageUtilPct: kp.storageUtilPct,
      bottleneck: {
        index: kp.bottleneck.index,
        id: kp.bottleneck.id,
        label: kp.bottleneck.label,
        capacityUnitsPerHr: kp.bottleneck.capacityUnitsPerHr,
        avgUtilisation: kp.bottleneck.avgUtilisation,
        plain: kp.bottleneck.plain,
      },
      kpis: kp.kpis.map((k) => ({ id: k.id, label: k.label, value: k.value, unit: k.unit, source: k.source })),
      dataLabel: kp.dataLabel,
    };
  }

  function buildStorage(layout, cfg, master, imported) {
    const ST = mod("storage");
    if (!ST || typeof ST.buildLocations !== "function") return { available: false, note: "storage.js not loaded." };
    const locations = ST.buildLocations(layout);
    if (!locations || !locations.capacityTotal) {
      return { available: false, note: "No storage locations on this floor - add racking / block-stack to slot SKUs." };
    }
    const asg = ST.assign(locations, master, { strategy: cfg.strategy, seed: cfg.seed });
    const st = ST.stats(asg);
    const occ = ST.occupancy(asg);
    const byType = [];
    if (occ && occ.byType) {
      for (const k of Object.keys(occ.byType).sort()) {
        const t = occ.byType[k];
        byType.push({ type: t.type, label: t.label, capacity: t.capacity, placed: t.placed, fillPct: t.fillPct });
      }
    }
    return {
      available: true,
      strategy: st.strategy,
      source: imported ? "yours (imported)" : "synthetic",
      capacityTotal: st.capacityTotal,
      skuCount: st.skuCount,
      placedCount: st.placedCount,
      unplacedCount: st.unplacedCount,
      overflow: !!st.overflow,
      fillPct: st.fillPct,
      golden: st.golden,
      placement: st.placement,
      byType: byType,
      dataLabel: st.dataLabel,
    };
  }

  function buildAutomation(layout, demandUnitsPerHr) {
    const A = mod("automation");
    if (!A || typeof A.report !== "function") return { available: false, note: "automation.js not loaded." };
    const rep = A.report(layout, demandUnitsPerHr);
    const utilByType = {};
    for (const u of rep.utilisation) utilByType[u.type] = u;
    return {
      available: !!rep.hasAutomation,
      note: rep.hasAutomation ? null : "No automation systems on this floor - throughput is fully manual (WMS result unchanged from a hand-worked flow).",
      hasAutomation: rep.hasAutomation,
      totalThroughputUnitsPerHr: rep.throughput.totalUnitsPerHr,
      demandUnitsPerHr: rep.demandUnitsPerHr,
      demandSource: rep.demandSource,
      systems: rep.systems.map((s) => {
        const u = utilByType[s.type] || {};
        return {
          type: s.type, label: s.label, category: s.category, count: s.count,
          throughputUnitsPerHr: s.throughputUnitsPerHr,
          utilisationPct: u.utilisationPct != null ? u.utilisationPct : null,
          overCapacity: !!u.overCapacity,
        };
      }),
      constraint: rep.constraint,
      summary: rep.summary,
      dataLabel: rep.dataLabel,
    };
  }

  // ------------------------------------------------------------------
  // ANALYSIS SUITE (A3 - consolidated HtmlReport parity). PULLS the same
  // WT.analytics models the "Analyze" card renders, over the SAME sim the
  // report already ran, so the report can NEVER drift from the panels:
  //   warehouse -> reuses THIS report's operations run (WT.wms.runOperations)
  //                -> bottleneckFromWarehouse + sankeyFromWarehouse + cost +
  //                   energy models.
  //   factory   -> when a `process` block is supplied (opts.process, mirroring
  //                how opts.skuMaster feeds the storage section) and yields a
  //                bottleneck -> bottleneckFromProcess + sankeyFromProcess +
  //                cost + energy + the line-sim metrics; plus the optimiser's
  //                before/after summary when one was accepted (opts.optimize).
  // Nothing is re-run/re-invented here - it aggregates the analytics module.
  // ------------------------------------------------------------------
  function normaliseOptimize(opt) {
    if (!opt || typeof opt !== "object") return null;
    const h = opt.headline && typeof opt.headline === "object" ? opt.headline : opt;
    const val = (v) => (isFinite(Number(v)) ? Number(v) : null);
    const out = {
      mhiBefore: val(h.mhiBefore),
      mhiAfter: val(h.mhiAfter),
      mhiDeltaPct: val(h.mhiDeltaPct != null ? h.mhiDeltaPct : h.deltaPct),
      moved: val(h.moved != null ? h.moved : h.movedCount),
      lineEffBefore: val(h.lineEffBefore),
      lineEffAfter: val(h.lineEffAfter),
      throughputPerHr: val(h.throughputPerHr),
      bottleneckBefore: h.bottleneckBefore != null ? String(h.bottleneckBefore) : null,
      bottleneckAfter: h.bottleneckAfter != null ? String(h.bottleneckAfter) : null,
    };
    // Nothing meaningful -> treat as absent.
    if (out.mhiBefore == null && out.lineEffBefore == null && out.throughputPerHr == null) return null;
    return out;
  }

  function buildAnalytics(layout, cfg, o, opsRun) {
    const AN = mod("analytics");
    if (!AN || typeof AN.bottleneckFromWarehouse !== "function") {
      return { available: false, note: "analytics.js not loaded - the analysis suite (bottleneck, flow, cost, energy) is unavailable." };
    }
    const rates = (o && o.rates) || (typeof AN.defaultRates === "function" ? AN.defaultRates() : null);
    const els = (layout && layout.elements) || [];

    // FACTORY: a process block was supplied and the line has a bottleneck.
    const PR = mod("process");
    const procBlock = (o && o.process) || (layout && layout.process) || null;
    if (procBlock && PR && typeof PR.metrics === "function") {
      let m = null;
      try { m = PR.metrics(procBlock); } catch (_) { m = null; }
      if (m && m.bottleneck) {
        const input = { mode: "factory", sim: m, elements: els };
        return {
          available: true,
          mode: "factory",
          throughput: num(m.throughputPerHr),
          throughputUnit: "parts/hr",
          bottleneck: AN.bottleneckFromProcess(m),
          sankey: AN.sankeyFromProcess(procBlock),
          cost: AN.costModel(input, rates),
          energy: AN.energyModel(input, rates),
          lineSim: {
            throughputPerHr: num(m.throughputPerHr),
            taktSec: num(m.taktSec),
            demandMet: !!m.demandMet,
            lineEfficiency: num(m.lineEfficiency),
            balanceDelayPct: num(m.balanceDelayPct),
            stationsUsed: num(m.stationsUsed),
            wip: num(m.wip),
            leadTimeSec: num(m.leadTimeSec),
            bottleneck: m.bottleneck ? { opId: m.bottleneck.opId, name: m.bottleneck.name, effTimeSec: num(m.bottleneck.effTimeSec) } : null,
          },
          optimize: normaliseOptimize(o && o.optimize),
          honesty: AN.HONESTY,
        };
      }
    }

    // WAREHOUSE: reuse THIS report's own operations run so the analysis can
    // never drift from the WMS operations section above.
    if (opsRun && opsRun.ok && Array.isArray(opsRun.stages) && opsRun.stages.length) {
      const input = { mode: "warehouse", sim: opsRun, elements: els };
      return {
        available: true,
        mode: "warehouse",
        throughput: num(opsRun.shippedUnits) / (num(opsRun.hours, 1) || 1),
        throughputUnit: "units/hr",
        bottleneck: AN.bottleneckFromWarehouse(opsRun),
        sankey: AN.sankeyFromWarehouse(opsRun),
        cost: AN.costModel(input, rates),
        energy: AN.energyModel(input, rates),
        lineSim: null,
        optimize: null,
        honesty: AN.HONESTY,
      };
    }
    return {
      available: false,
      note: "The analysis suite needs a runnable model - a factory line (Generate in Factory mode) or a warehouse with storage for the 7-stage flow to run.",
    };
  }

  function buildDataProfile(master, orderPool, imported) {
    const DATA = mod("wmsdata");
    if (!DATA || typeof DATA.stats !== "function") return { available: false, note: "wmsdata.js not loaded." };
    const st = DATA.stats(master, orderPool || []);
    return {
      available: true,
      source: imported ? "yours (imported)" : "synthetic",
      skuCount: st.skuCount,
      orderCount: st.orderCount,
      lineCount: st.lineCount,
      avgLinesPerOrder: st.avgLinesPerOrder,
      totalVelocity: st.totalVelocity,
      abc: st.abc, // {A:{skus,skuPct,demand,demandPct}, B, C}
      topSkus: (st.topSkus || []).slice(0, 5).map((s) => ({ sku: s.sku, velocity: s.velocity, abcClass: s.abcClass })),
      dataLabel: DATA.SYNTHETIC_LABEL,
    };
  }

  function buildStandardsBasis() {
    const KB = mod("kb");
    if (!KB || typeof KB.list !== "function") return { available: false, note: "knowledge.js not loaded." };
    const entries = KB.list().map((e) => ({
      id: e.id, category: e.category, label: e.label,
      value: e.value, unit: e.unit || "", source: e.source, note: e.note,
    }));
    const meta = KB.meta || {};
    return {
      available: true,
      version: meta.version,
      disclaimer: (meta.honesty && meta.honesty.en) || meta.disclaimer || HONESTY,
      note: "These are the editable knowledge-base entries that informed the numbers above - each carries its source and is the user's to verify. NOT a certification.",
      entries: entries,
    };
  }

  /* ------------------------------------------------------------------
   * build(layout, opts) -> the aggregated, JSON-safe report object.
   * opts: { timestamp, scenario, config:{seed,strategy,orders,hours,
   *         skuCount,demandSkew,minAisleMetres}, skuMaster, orderPool }.
   * ------------------------------------------------------------------ */
  function build(layout, opts) {
    const o = opts || {};
    const lay = layout || { elements: [] };
    const cfg = resolveConfig(lay, opts);
    const DATA = mod("wmsdata");

    // The SKU / order data the storage + data-profile sections read: the
    // user's imported data when supplied, else a deterministic synthetic
    // bundle from the resolved config (byte-stable for a given seed).
    const imported = !!(o.skuMaster && o.skuMaster.length);
    let master = o.skuMaster || [];
    let orderPool = o.orderPool || [];
    if (!imported && DATA && typeof DATA.generate === "function") {
      const bundle = DATA.generate({ skuCount: cfg.skuCount, orders: cfg.orders, seed: cfg.seed, demandSkew: cfg.demandSkew });
      master = bundle.skuMaster;
      orderPool = bundle.orderPool;
    }

    // Run the 7-stage WMS flow ONCE and reuse it for both the operations
    // section and the warehouse analytics, so they can never diverge.
    const W = mod("wms");
    let opsRun = null;
    if (W && typeof W.runOperations === "function") {
      try { opsRun = W.runOperations(lay, { orders: cfg.orders, hours: cfg.hours, seed: cfg.seed }); } catch (_) { opsRun = null; }
    }
    const operations = buildOperations(lay, cfg, opsRun);
    const demand = operations && operations.available ? num(operations.throughputUnitsPerHr) : 0;

    const report = {
      reportVersion: REPORT_VERSION,
      honesty: HONESTY,
      sections: SECTIONS.map((s) => ({ key: s.key, title: s.title })),
      meta: {
        config: cfg,
        generatedAt: o.timestamp != null ? String(o.timestamp) : null,
        dataMode: imported ? "imported" : "synthetic",
        imported: imported,
      },
      header: buildHeader(lay, cfg, o, imported),
      layout: buildLayoutSummary(lay),
      compliance: buildCompliance(lay, cfg),
      operations: operations,
      storage: buildStorage(lay, cfg, master, imported),
      automation: buildAutomation(lay, demand),
      analytics: buildAnalytics(lay, cfg, o, opsRun),
      dataProfile: buildDataProfile(master, orderPool, imported),
      standardsBasis: buildStandardsBasis(),
    };
    return jsonSafe(report);
  }

  /* ------------------------------------------------------------------
   * toJson(report) -> deterministic JSON bytes (2-space indent). Round-
   * trips exactly: JSON.parse(toJson(x)) deep-equals x (see jsonSafe).
   * ------------------------------------------------------------------ */
  function toJson(report) {
    return JSON.stringify(report, null, 2);
  }

  // ------------------------------------------------------------------
  // Printable HTML. Self-contained: inline <style>, no external refs, no
  // scripts. A4-print-friendly. The user prints it to PDF in the browser.
  // ------------------------------------------------------------------
  function kv(label, value) {
    return '<div class="kv"><span class="kv-k">' + esc(label) + '</span><span class="kv-v">' + esc(value) + "</span></div>";
  }
  function th(cells) { return "<tr>" + cells.map((c) => "<th>" + esc(c) + "</th>").join("") + "</tr>"; }
  function tr(cells, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : "") + ">" + cells.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>";
  }
  function sectionOpen(key, title) {
    return '<section class="rpt-section" id="sec-' + esc(key) + '"><h2>' + esc(title) + "</h2>";
  }
  function notAvail(r) { return '<p class="rpt-na">' + esc((r && r.note) || "Not available for this model yet.") + "</p>"; }

  function htmlHeaderSection(r) {
    const h = r.header;
    let out = sectionOpen("header", "Report header");
    if (h.scenario && h.scenario.name) {
      out += '<h3 class="rpt-scenario">' + esc(h.scenario.name) + (h.scenario.industry ? ' <span class="rpt-ind">' + esc(h.scenario.industry) + "</span>" : "") + "</h3>";
      if (h.scenario.description) out += '<p class="rpt-desc">' + esc(h.scenario.description) + "</p>";
    } else {
      out += '<p class="rpt-desc">Custom layout (no example scenario loaded).</p>';
    }
    out += '<div class="kvs">';
    out += kv("Data mode", h.dataMode);
    out += kv("Floor", h.floor.gridW + " x " + h.floor.gridH + " cells (" + fmtNum(h.floor.widthM, 1) + " x " + fmtNum(h.floor.depthM, 1) + " m, " + fmtInt(h.floor.areaM2) + " m2)");
    out += kv("Generated", h.generatedAt || "(timestamp not provided)");
    out += kv("Report format", r.reportVersion);
    out += "</div></section>";
    return out;
  }

  function htmlLayoutSection(r) {
    const l = r.layout;
    let out = sectionOpen("layout", "Layout summary");
    out += '<div class="kvs">';
    out += kv("Elements", fmtInt(l.elementCount));
    out += kv("Storage capacity", fmtInt(l.storageCapacityPositions) + " positions (pallet-equiv)");
    out += kv("Floor use", fmtNum(l.floorUsePct, 1) + " %");
    out += "</div>";
    if (l.byType.length) {
      out += '<table class="rpt-tbl">' + th(["Element type", "Count"]);
      for (const b of l.byType) out += tr([b.label, fmtInt(b.count)]);
      out += "</table>";
    }
    return out + "</section>";
  }

  function htmlComplianceSection(r) {
    const c = r.compliance;
    let out = sectionOpen("compliance", "Compliance findings");
    if (!c.available) return out + notAvail(c) + "</section>";
    const s = c.summary;
    out += '<div class="badges">' +
      '<span class="badge b-fail">' + s.fail + " fail</span>" +
      '<span class="badge b-warn">' + s.warn + " warn</span>" +
      '<span class="badge b-pass">' + s.pass + " pass</span>" +
      '<span class="badge b-worst">worst: ' + esc(s.worst) + "</span></div>";
    out += '<table class="rpt-tbl">' + th(["Rule", "Guideline", "Status", "Finding"]);
    for (const f of c.findings) {
      const explain = (f.explain && (f.explain.en || f.explain)) || "";
      const rule = (f.rule && (f.rule.en || f.rule)) || f.ruleId;
      out += tr([rule, f.guideline, f.status.toUpperCase(), explain], "st-" + f.status);
    }
    out += "</table>";
    if (c.guidelines && c.guidelines.length) {
      out += '<p class="rpt-basis"><strong>Informed by:</strong> ';
      out += c.guidelines.map((g) => esc(g.code + " - " + g.value)).join("; ");
      out += "</p>";
    }
    if (c.disclaimer && c.disclaimer.en) out += '<p class="rpt-note">' + esc(c.disclaimer.en) + "</p>";
    return out + "</section>";
  }

  function htmlOperationsSection(r) {
    const op = r.operations;
    let out = sectionOpen("operations", "WMS operations KPIs");
    if (!op.available) return out + notAvail(op) + "</section>";
    if (!op.ran) out += '<p class="rpt-na">' + esc(op.note) + "</p>";
    out += '<div class="cards">';
    out += card("Throughput", fmtInt(op.throughputUnitsPerHr), "units / hr");
    out += card("Throughput", fmtNum(op.throughputOrdersPerHr, 1), "orders / hr");
    out += card("Order cycle time", fmtNum(op.orderCycleTimeMin, 1), "min (est.)");
    out += card("Dock-to-stock", fmtNum(op.dockToStockMin, 1), "min (est.)");
    out += card("Picking productivity", fmtInt(op.pickingLinesPerHr), "lines / hr");
    out += card("Storage utilisation", fmtNum(op.storageUtilPct, 1), "%");
    out += "</div>";
    if (op.bottleneck && op.bottleneck.plain) out += '<p class="rpt-bottleneck"><strong>Bottleneck:</strong> ' + esc(op.bottleneck.plain) + "</p>";
    out += '<p class="rpt-note">Deterministic seeded flow - seed ' + esc(op.seed) + ", " + fmtInt(op.orders) + " orders over a " + esc(op.hours) + "-hour shift (" + fmtInt(op.totalUnits) + " units in, " + fmtInt(op.shippedUnits) + " shipped). " + esc(op.dataLabel) + "</p>";
    return out + "</section>";
  }

  function htmlStorageSection(r) {
    const s = r.storage;
    let out = sectionOpen("storage", "Storage & inventory");
    if (!s.available) return out + notAvail(s) + "</section>";
    out += '<div class="kvs">';
    out += kv("Slotting strategy", s.strategy + " (" + s.source + " SKU master)");
    out += kv("Occupancy", fmtNum(s.fillPct, 1) + " % (" + fmtInt(s.placedCount) + " / " + fmtInt(s.capacityTotal) + " locations)");
    out += kv("A-class avg distance", fmtNum(s.placement.avgDistAClassM, 1) + " m vs floor avg " + fmtNum(s.placement.avgDistAllM, 1) + " m");
    out += kv("Golden zone", "A-class in golden slots: " + fmtNum(s.golden.aClassPct, 0) + " %");
    out += kv("Overflow", s.overflow ? fmtInt(s.unplacedCount) + " SKUs exceed capacity (reported, not dropped)" : "none");
    out += "</div>";
    if (s.byType.length) {
      out += '<table class="rpt-tbl">' + th(["Storage type", "Placed", "Capacity", "Fill %"]);
      for (const t of s.byType) out += tr([t.label, fmtInt(t.placed), fmtInt(t.capacity), fmtNum(t.fillPct, 0)]);
      out += "</table>";
    }
    out += '<p class="rpt-note">' + esc(s.dataLabel) + "</p>";
    return out + "</section>";
  }

  function htmlAutomationSection(r) {
    const a = r.automation;
    let out = sectionOpen("automation", "Automation systems");
    if (!a.available) return out + notAvail(a) + "</section>";
    out += '<div class="kvs">';
    out += kv("Modeled throughput", fmtInt(a.totalThroughputUnitsPerHr) + " units / hr across " + a.systems.length + " system type(s)");
    out += kv("Flow demand", fmtInt(a.demandUnitsPerHr) + " units / hr (" + esc(a.demandSource) + ")");
    out += "</div>";
    out += '<table class="rpt-tbl">' + th(["System", "Count", "Throughput (u/hr)", "Utilisation"]);
    for (const sy of a.systems) {
      const u = sy.utilisationPct == null ? "-" : (isFinite(sy.utilisationPct) ? fmtNum(sy.utilisationPct, 0) + " %" : ">999 %") + (sy.overCapacity ? " (over)" : "");
      out += tr([sy.label, fmtInt(sy.count), fmtInt(sy.throughputUnitsPerHr), u]);
    }
    out += "</table>";
    if (a.constraint && a.constraint.present && a.constraint.plain) out += '<p class="rpt-bottleneck"><strong>Constraint:</strong> ' + esc(a.constraint.plain) + "</p>";
    out += '<p class="rpt-note">' + esc(a.dataLabel) + "</p>";
    return out + "</section>";
  }

  function htmlAnalyticsSection(r) {
    const a = r.analytics;
    let out = sectionOpen("analytics", "Analysis suite (bottleneck, flow, cost, energy)");
    if (!a || !a.available) return out + notAvail(a) + "</section>";
    const AN = mod("analytics");
    const CUR = (AN && AN.CURRENCY) || "EUR";
    const modeLabel = a.mode === "factory"
      ? "Factory line - Theory of Constraints"
      : "Warehouse flow - per-stage load vs capacity";
    out += '<p class="rpt-basis"><strong>Mode:</strong> ' + esc(modeLabel) +
      '. These figures come straight from the same simulation the WMS/line sections above ran - the analysis cannot drift from the app.</p>';

    // --- Bottleneck ranking (table + proportional 0-based SVG) -----------
    const b = a.bottleneck;
    if (b && Array.isArray(b.resources) && b.resources.length) {
      out += "<h3 class=\"rpt-sub-h\">Bottleneck ranking</h3>";
      out += '<p class="rpt-bottleneck"><strong>Constraint:</strong> ' + esc(b.headline) + "</p>";
      out += '<table class="rpt-tbl">' + th(["#", "Resource", b.metricLabel, "Value"]);
      for (const rr of b.resources) {
        out += '<tr' + (rr.isConstraint ? ' class="rpt-constraint"' : "") + "><td>" + esc(rr.rank) +
          "</td><td>" + esc(rr.name) + (rr.isConstraint ? " (constraint)" : "") +
          "</td><td>" + esc(rr.detail || "") + "</td><td>" + esc(rr.pct) + "%</td></tr>";
      }
      out += "</table>";
      if (AN && typeof AN.bottleneckSvg === "function") out += '<div class="rpt-analytics-fig">' + AN.bottleneckSvg(b, REPORT_THEME) + "</div>";
      out += '<p class="rpt-note">' + esc(b.why) + "</p>";
    }

    // --- Material-flow Sankey (SVG + flow table) --------------------------
    const s = a.sankey;
    if (s && Array.isArray(s.links) && s.links.length) {
      out += "<h3 class=\"rpt-sub-h\">Material-flow Sankey</h3>";
      const nameOf = (id) => { const n = (s.nodes || []).find((x) => x.id === id); return n ? n.name : id; };
      let dom = s.links[0];
      for (const l of s.links) if (num(l.value) > num(dom.value)) dom = l;
      if (dom && num(dom.value) > 0) {
        out += '<p class="rpt-basis"><strong>Dominant flow:</strong> ' + esc(nameOf(dom.from)) + " -> " + esc(nameOf(dom.to)) +
          " at " + fmtNum(dom.value, 0) + " " + esc(s.unit) + ". Link widths are proportional to the flow volume.</p>";
      }
      if (AN && typeof AN.sankeySvg === "function") out += '<div class="rpt-analytics-fig">' + AN.sankeySvg(s, REPORT_THEME) + "</div>";
      out += '<table class="rpt-tbl">' + th(["From", "To", "Volume (" + s.unit + ")"]);
      for (const l of s.links) out += tr([nameOf(l.from), nameOf(l.to), fmtNum(l.value, 0)]);
      out += "</table>";
    }

    // --- Operating cost (cards + category breakdown) ---------------------
    const c = a.cost;
    if (c) {
      out += "<h3 class=\"rpt-sub-h\">Operating cost (illustrative)</h3>";
      out += '<div class="cards">';
      out += card("Total operating cost", CUR + fmtNum(c.totalCost, 0), fmtNum(c.operatingHours, 1) + " h window");
      out += card("Cost per " + c.throughputUnit, CUR + fmtNum(c.perUnit, 2), fmtNum(c.throughput, 0) + " " + c.throughputUnit + "s");
      out += "</div>";
      out += '<table class="rpt-tbl">' + th(["Category", "Cost", "Share"]);
      const tot = num(c.totalCost);
      for (const cat of (c.categories || [])) {
        const pct = tot > 0 ? Math.round((num(cat.amount) / tot) * 100) : 0;
        out += tr([cat.label, CUR + fmtNum(cat.amount, 0), pct + "%"]);
      }
      out += "</table>";
      if (AN && typeof AN.breakdownSvg === "function") {
        const catRows = (c.categories || []).map((cat) => ({ label: cat.label, value: num(cat.amount), text: CUR + fmtNum(cat.amount, 0) }));
        let mx = -1; catRows.forEach((x) => { if (x.value > mx) mx = x.value; });
        catRows.forEach((x) => { x.emphasis = x.value === mx; });
        out += '<div class="rpt-analytics-fig">' + AN.breakdownSvg(catRows, REPORT_THEME, { title: "Operating cost by category" }) + "</div>";
      }
      if (c.honesty) out += '<p class="rpt-note">' + esc(c.honesty) + "</p>";
    }

    // --- Energy (cards + per-resource breakdown) -------------------------
    const e = a.energy;
    if (e) {
      out += "<h3 class=\"rpt-sub-h\">Energy (modelled)</h3>";
      out += '<div class="cards">';
      out += card("Total energy", fmtNum(e.totalKWh, 0) + " kWh", fmtNum(e.operatingHours, 1) + " h window");
      out += card("Energy per " + e.throughputUnit, (num(e.perUnit) >= 1 ? fmtNum(e.perUnit, 1) : String(Math.round(num(e.perUnit) * 1000) / 1000)) + " kWh", fmtNum(e.throughput, 0) + " " + e.throughputUnit + "s");
      out += card("CO2e", fmtNum(e.co2Kg, 0) + " kg", (Math.round(num(e.co2Factor) * 1000) / 1000) + " kg/kWh (illustrative)");
      out += "</div>";
      out += '<table class="rpt-tbl">' + th(["Resource", "Count", "Power kW", "Energy kWh"]);
      for (const g of (e.byClass || [])) out += tr([g.label, fmtInt(g.count), fmtNum(g.powerKW, 2), fmtNum(g.energyKWh, 0)]);
      out += "</table>";
      if (AN && typeof AN.breakdownSvg === "function") {
        const enRows = (e.byClass || []).map((g) => ({ label: g.label, value: num(g.energyKWh), text: fmtNum(g.energyKWh, 0) + " kWh" }));
        let mx = -1; enRows.forEach((x) => { if (x.value > mx) mx = x.value; });
        enRows.forEach((x) => { x.emphasis = x.value === mx; });
        out += '<div class="rpt-analytics-fig">' + AN.breakdownSvg(enRows, REPORT_THEME, { title: "Energy by resource" }) + "</div>";
      }
      if (e.honesty) out += '<p class="rpt-note">' + esc(e.honesty) + "</p>";
    }

    // --- Factory line-sim metrics + optimiser before/after ---------------
    if (a.mode === "factory" && a.lineSim) {
      const ls = a.lineSim;
      out += "<h3 class=\"rpt-sub-h\">Line simulation (Theory of Constraints, Little's Law)</h3>";
      out += '<div class="cards">';
      out += card("Throughput", fmtNum(ls.throughputPerHr, 1), "parts / hr");
      out += card("Takt", fmtNum(ls.taktSec, 1), "s / part");
      out += card("Line efficiency", fmtNum(num(ls.lineEfficiency) * 100, 1), "%");
      out += card("WIP", fmtNum(ls.wip, 1), "parts");
      out += card("Lead time", fmtNum(ls.leadTimeSec, 1), "s");
      out += card("Stations", fmtInt(ls.stationsUsed), "used");
      out += "</div>";
      if (a.optimize) {
        const op = a.optimize;
        out += "<h3 class=\"rpt-sub-h\">Efficiency optimiser (accepted) - before / after</h3>";
        out += '<table class="rpt-tbl">' + th(["Metric", "Before", "After"]);
        if (op.lineEffBefore != null) out += tr(["Line efficiency", fmtNum(num(op.lineEffBefore) * 100, 1) + " %", fmtNum(num(op.lineEffAfter) * 100, 1) + " %"]);
        if (op.mhiBefore != null) out += tr(["Material-flow MHI", fmtNum(op.mhiBefore, 0), fmtNum(op.mhiAfter, 0) + (op.mhiDeltaPct != null ? " (-" + fmtNum(op.mhiDeltaPct, 1) + " %)" : "")]);
        if (op.bottleneckBefore != null) out += tr(["Bottleneck station", op.bottleneckBefore, op.bottleneckAfter || op.bottleneckBefore]);
        if (op.throughputPerHr != null) out += tr(["Throughput (parts/hr)", fmtNum(op.throughputPerHr, 1), fmtNum(op.throughputPerHr, 1) + " (a re-layout does not change cycle times)"]);
        if (op.moved != null) out += tr(["Stations moved", "-", fmtInt(op.moved)]);
        out += "</table>";
      }
    }

    if (a.honesty) out += '<p class="rpt-note">' + esc(a.honesty) + "</p>";
    return out + "</section>";
  }

  function htmlDataProfileSection(r) {
    const d = r.dataProfile;
    let out = sectionOpen("dataProfile", "Data profile");
    if (!d.available) return out + notAvail(d) + "</section>";
    out += '<div class="kvs">';
    out += kv("Data source", d.source);
    out += kv("SKUs", fmtInt(d.skuCount));
    out += kv("Orders", fmtInt(d.orderCount) + " (" + fmtInt(d.lineCount) + " lines, avg " + fmtNum(d.avgLinesPerOrder, 1) + " lines/order)");
    out += "</div>";
    out += '<table class="rpt-tbl">' + th(["ABC class", "SKUs", "% of SKUs", "% of demand"]);
    for (const k of ["A", "B", "C"]) {
      const c = d.abc[k] || { skus: 0, skuPct: 0, demandPct: 0 };
      out += tr([k, fmtInt(c.skus), fmtNum(c.skuPct, 1) + " %", fmtNum(c.demandPct, 1) + " %"]);
    }
    out += "</table>";
    out += '<p class="rpt-note">' + esc(d.dataLabel) + "</p>";
    return out + "</section>";
  }

  function htmlStandardsSection(r) {
    const sb = r.standardsBasis;
    let out = sectionOpen("standardsBasis", "Standards basis");
    if (!sb.available) return out + notAvail(sb) + "</section>";
    out += '<p class="rpt-note">' + esc(sb.note) + "</p>";
    out += '<table class="rpt-tbl rpt-basis-tbl">' + th(["Entry", "Value", "Source"]);
    for (const e of sb.entries) {
      out += tr([e.label, (e.value + (e.unit ? " " + e.unit : "")), e.source]);
    }
    out += "</table>";
    if (sb.disclaimer) out += '<p class="rpt-note">' + esc(sb.disclaimer) + "</p>";
    return out + "</section>";
  }

  function card(label, value, unit) {
    return '<div class="card"><div class="card-v">' + esc(value) + '</div><div class="card-l">' + esc(label) + '</div><div class="card-u">' + esc(unit) + "</div></div>";
  }

  const CSS =
    "*{box-sizing:border-box}" +
    "body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px}" +
    ".rpt-wrap{max-width:900px;margin:0 auto}" +
    "h1{font-size:26px;margin:0 0 2px}" +
    ".rpt-sub{color:#475569;margin:0 0 14px}" +
    ".rpt-banner{border:1px solid #f59e0b;background:#fff7ed;color:#7c2d12;border-radius:8px;padding:12px 14px;margin:0 0 20px;font-size:12.5px}" +
    ".rpt-banner strong{color:#9a3412}" +
    "h2{font-size:18px;margin:24px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}" +
    "h3.rpt-scenario{font-size:16px;margin:6px 0 2px}" +
    ".rpt-ind{font-weight:400;color:#64748b;font-size:13px}" +
    ".rpt-desc{color:#475569;margin:2px 0 10px}" +
    ".kvs{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;margin:6px 0}" +
    ".kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dotted #e2e8f0}" +
    ".kv-k{color:#475569}.kv-v{font-weight:600;text-align:right}" +
    ".rpt-tbl{width:100%;border-collapse:collapse;margin:10px 0;font-size:12.5px}" +
    ".rpt-tbl th{text-align:left;background:#f1f5f9;padding:6px 8px;border:1px solid #e2e8f0}" +
    ".rpt-tbl td{padding:6px 8px;border:1px solid #e2e8f0;vertical-align:top}" +
    ".rpt-basis-tbl td:last-child{color:#475569;font-size:11.5px}" +
    ".badges{margin:8px 0}.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;margin-right:6px}" +
    ".b-fail{background:#fee2e2;color:#991b1b}.b-warn{background:#fef3c7;color:#92400e}.b-pass{background:#dcfce7;color:#166534}.b-worst{background:#e2e8f0;color:#334155}" +
    "tr.st-fail td{background:#fef2f2}tr.st-warn td{background:#fffbeb}" +
    ".cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}" +
    ".card{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc}" +
    ".card-v{font-size:22px;font-weight:700}.card-l{color:#475569;font-size:12px}.card-u{color:#94a3b8;font-size:11px}" +
    ".rpt-bottleneck{background:#f1f5f9;border-left:3px solid #64748b;padding:8px 12px;margin:10px 0;border-radius:0 6px 6px 0}" +
    "h3.rpt-sub-h{font-size:14px;margin:16px 0 4px;color:#334155}" +
    ".rpt-analytics-fig{margin:8px 0 12px;max-width:100%;overflow-x:auto}" +
    ".rpt-analytics-fig svg{max-width:100%;height:auto}" +
    "tr.rpt-constraint td{background:#fef2f2;font-weight:600}" +
    ".rpt-note{color:#64748b;font-size:11.5px;margin:8px 0}" +
    ".rpt-na{color:#92400e;background:#fffbeb;border:1px dashed #fcd34d;border-radius:6px;padding:8px 12px;font-size:12.5px}" +
    ".rpt-basis{color:#475569;font-size:12px;margin:6px 0}" +
    ".rpt-foot{margin-top:28px;padding-top:12px;border-top:2px solid #e2e8f0;color:#64748b;font-size:11.5px}" +
    "@page{size:A4;margin:14mm}" +
    "@media print{body{padding:0}.rpt-section{break-inside:avoid}.rpt-banner{break-inside:avoid}}";

  function toHtml(report) {
    const r = report || {};
    const title = "WMS Report" + (r.header && r.header.scenario && r.header.scenario.name ? " - " + r.header.scenario.name : "");
    const body =
      '<div class="rpt-wrap">' +
      "<h1>" + esc((r.header && r.header.title) || "WMS Report") + "</h1>" +
      '<p class="rpt-sub">WarehouseTwin consolidated output - a single, printable summary of the current model.</p>' +
      '<div class="rpt-banner"><strong>Honesty:</strong> ' + esc(r.honesty || HONESTY) + "</div>" +
      htmlHeaderSection(r) +
      htmlLayoutSection(r) +
      htmlComplianceSection(r) +
      htmlOperationsSection(r) +
      htmlStorageSection(r) +
      htmlAutomationSection(r) +
      htmlAnalyticsSection(r) +
      htmlDataProfileSection(r) +
      htmlStandardsSection(r) +
      '<div class="rpt-foot">' + esc(r.honesty || HONESTY) + " Report format " + esc(r.reportVersion || REPORT_VERSION) + ".</div>" +
      "</div>";
    return (
      "<!doctype html>\n" +
      '<html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + esc(title) + "</title>" +
      "<style>" + CSS + "</style></head><body>" +
      body +
      "</body></html>\n"
    );
  }

  /* ------------------------------------------------------------------
   * toCsv(report) -> a flat, Excel-openable metric/value roll-up of the
   * section KPIs (CRLF + RFC-4180 quoting). Deterministic bytes.
   * ------------------------------------------------------------------ */
  function csvCell(v) {
    let s = v == null ? "" : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvRow(cells) { return cells.map(csvCell).join(","); }
  function toCsv(report) {
    const r = report || {};
    const rows = [];
    rows.push(csvRow(["Logistics Flow Studio - WarehouseTwin - WMS Report"]));
    rows.push(csvRow(["Report format", r.reportVersion || REPORT_VERSION]));
    rows.push(csvRow(["Data mode", r.meta ? r.meta.dataMode : ""]));
    rows.push(csvRow(["Generated", (r.meta && r.meta.generatedAt) || ""]));
    rows.push(csvRow(["Honesty", r.honesty || HONESTY]));
    rows.push("");
    rows.push(csvRow(["section", "metric", "value", "unit"]));
    const push = (sec, metric, value, unit) => rows.push(csvRow([sec, metric, value, unit || ""]));

    if (r.header) {
      if (r.header.scenario && r.header.scenario.name) push("header", "Scenario", r.header.scenario.name, "");
      push("header", "Floor width", r.header.floor.widthM, "m");
      push("header", "Floor depth", r.header.floor.depthM, "m");
    }
    if (r.layout) {
      push("layout", "Elements", r.layout.elementCount, "count");
      push("layout", "Storage capacity", r.layout.storageCapacityPositions, "positions");
      push("layout", "Floor use", r.layout.floorUsePct, "%");
    }
    if (r.compliance && r.compliance.available) {
      push("compliance", "Pass", r.compliance.summary.pass, "rules");
      push("compliance", "Warn", r.compliance.summary.warn, "rules");
      push("compliance", "Fail", r.compliance.summary.fail, "rules");
      push("compliance", "Worst", r.compliance.summary.worst, "");
    }
    if (r.operations && r.operations.available) {
      push("operations", "Throughput", r.operations.throughputUnitsPerHr, "units/hr");
      push("operations", "Order cycle time", r.operations.orderCycleTimeMin, "min");
      push("operations", "Dock-to-stock", r.operations.dockToStockMin, "min");
      push("operations", "Picking productivity", r.operations.pickingLinesPerHr, "lines/hr");
      push("operations", "Storage utilisation", r.operations.storageUtilPct, "%");
      push("operations", "Bottleneck", r.operations.bottleneck.label, "");
    }
    if (r.storage && r.storage.available) {
      push("storage", "Occupancy", r.storage.fillPct, "%");
      push("storage", "Capacity", r.storage.capacityTotal, "locations");
      push("storage", "Placed", r.storage.placedCount, "SKUs");
      push("storage", "Overflow", r.storage.unplacedCount, "SKUs");
      push("storage", "A-class avg distance", r.storage.placement.avgDistAClassM, "m");
    }
    if (r.automation && r.automation.available) {
      push("automation", "Modeled throughput", r.automation.totalThroughputUnitsPerHr, "units/hr");
      push("automation", "Flow demand", r.automation.demandUnitsPerHr, "units/hr");
      if (r.automation.constraint && r.automation.constraint.present) push("automation", "Constraint", r.automation.constraint.label, "");
    }
    if (r.analytics && r.analytics.available) {
      const a = r.analytics;
      push("analytics", "Mode", a.mode, "");
      if (a.bottleneck && a.bottleneck.constraint) push("analytics", "Constraint", a.bottleneck.constraint.name, "");
      push("analytics", "Throughput", a.throughput, a.throughputUnit || "");
      if (a.cost) {
        push("analytics", "Total operating cost", a.cost.totalCost, a.cost.currency || "");
        push("analytics", "Cost per " + a.cost.throughputUnit, a.cost.perUnit, a.cost.currency || "");
      }
      if (a.energy) {
        push("analytics", "Total energy", a.energy.totalKWh, "kWh");
        push("analytics", "Energy per " + a.energy.throughputUnit, a.energy.perUnit, "kWh");
        push("analytics", "CO2e", a.energy.co2Kg, "kg");
      }
      if (a.lineSim) {
        push("analytics", "Line efficiency", a.lineSim.lineEfficiency, "fraction");
        push("analytics", "WIP", a.lineSim.wip, "parts");
      }
      if (a.optimize) {
        push("analytics", "Optimiser line-eff before", a.optimize.lineEffBefore, "fraction");
        push("analytics", "Optimiser line-eff after", a.optimize.lineEffAfter, "fraction");
        push("analytics", "Optimiser MHI delta", a.optimize.mhiDeltaPct, "%");
      }
    }
    if (r.dataProfile && r.dataProfile.available) {
      push("dataProfile", "SKUs", r.dataProfile.skuCount, "count");
      push("dataProfile", "Orders", r.dataProfile.orderCount, "count");
      push("dataProfile", "Avg lines/order", r.dataProfile.avgLinesPerOrder, "lines");
    }
    return rows.join("\r\n") + "\r\n";
  }

  WT.report = {
    SECTIONS: SECTIONS,
    HONESTY: HONESTY,
    REPORT_VERSION: REPORT_VERSION,
    build: build,
    toHtml: toHtml,
    toJson: toJson,
    toCsv: toCsv,
  };
})();
