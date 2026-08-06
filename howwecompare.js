/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * howwecompare.js - the honest "How we compare" page (ANALYTICS A4)
 *                   -> WT.howwecompare
 * ---------------------------------------------------------------------
 * A FAIR, SOURCED comparison of this app against the serious commercial
 * plant/warehouse simulators - Siemens Tecnomatix Plant Simulation,
 * FlexSim and AnyLogic. It states plainly what THEY are strong at
 * (validated discrete-event simulation, deep object libraries, decades of
 * industrial track record) AND where they cost the user (licence price,
 * desktop-only install, a steep learning curve with paid training, limited
 * sharing), against THIS app's specific wedge (free, offline, no-install,
 * no-training, open/shareable, user-definable, honest-by-design).
 *
 * HARD HONESTY (the whole point of this page):
 *   - This is an INDEPENDENT comparison of publicly available information -
 *     no affiliation with, endorsement by, or access to the named products.
 *   - Every competitor claim carries a fetched, cited source.
 *   - NO "beats everyone", NO "no competition", NO "superior". The wedge is
 *     specific and honest: for validated, certified DES the commercial
 *     suites are the right tool; for free, offline, fast, shareable
 *     modelling + teaching + a first-pass layout/efficiency read, use this.
 *   - Product names are used factually to identify the compared tools; all
 *     trademarks belong to their owners.
 *
 * PURE + DETERMINISTIC + OFFLINE: a fixed data model + a pure HTML
 * serializer - no wall-clock, no RNG, no network - sources are cited as
 * TEXT (publisher + path), never as opened links. Classic script attaching
 * to the global `WT` namespace (works from file:// too). No deps, no build.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  const VERSION = "wt-howwecompare-1";

  // The independent-comparison disclaimer, restated on the page + asserted
  // by the harness. Deliberately plain: no hype, no "beats/superior".
  const DISCLAIMER =
    "Independent comparison of publicly available information - this project " +
    "is not affiliated with, endorsed by, or built with access to the named " +
    "products; all trademarks belong to their owners. Every competitor claim " +
    "carries a cited source. This is a fair statement of trade-offs, not a " +
    "ranking: for validated, certified discrete-event simulation the " +
    "commercial suites are the right tool.";

  // The one honest framing sentence - the wedge stated as a trade-off.
  const FRAMING =
    "For validated, certified discrete-event simulation - with deep object " +
    "libraries and a long industrial track record - use the commercial suites " +
    "(Siemens Tecnomatix Plant Simulation, FlexSim, AnyLogic). For free, " +
    "offline, fast, shareable modelling, teaching, and a first-pass layout / " +
    "efficiency read, use this app. They are different tools for different " +
    "jobs.";

  // Cited sources (from the competitive-analysis brief). `cite` is the
  // scheme-less publisher path shown on the page - offline, never a link.
  const SOURCES = [
    { id: "worldmetrics", publisher: "worldmetrics.org", cite: "worldmetrics.org/best/production-line-simulation-software",
      note: "Production-line simulation software - pricing + scale statistics." },
    { id: "capterra", publisher: "Capterra", cite: "capterra.com/compare/AnyLogic-vs-FlexSim",
      note: "AnyLogic vs FlexSim - licensing model comparison." },
    { id: "g2", publisher: "G2 / Capterra reviews", cite: "g2.com/compare/anylogic-vs-flexsim",
      note: "User reviews - learning curve, Java, training cost." },
    { id: "gitnux", publisher: "Gitnux", cite: "gitnux.org/best/warehouse-simulation-software",
      note: "Warehouse simulation software - native desktop install." },
    { id: "saashub", publisher: "SaaSHub", cite: "saashub.com/compare-anylogic-vs-flexsim",
      note: "AnyLogic vs FlexSim - export / interoperability." },
  ];

  // What the commercial suites are genuinely strong at (stated first + plainly).
  const THEIR_STRENGTHS = [
    "Validated, certified discrete-event simulation with statistical rigour (replications, confidence intervals, warm-up).",
    "Deep, mature object libraries and decades of industrial track record.",
    "3D visualisation, emulation and connection to real control systems / PLCs.",
    "Vendor support, training, consultancy and a large practitioner community.",
  ];

  // Where they cost the user - each with a cited source id.
  const COMPETITORS = [
    {
      name: "Siemens Tecnomatix Plant Simulation",
      strong: "The reference material-flow DES for large plants; the Tools palette this app takes as its parity target (BottleneckAnalyzer, CostAnalyzer, EnergyAnalyzer, SankeyDiagram, Chart, HtmlReport).",
      costs: [
        { claim: "About $10,000 / year for a basic licence.", sourceId: "worldmetrics" },
        { claim: "Native desktop application - no browser, no zero-install, no offline-anywhere.", sourceId: "gitnux" },
        { claim: "Steep learning curve; effective use typically needs paid training.", sourceId: "g2" },
      ],
    },
    {
      name: "FlexSim",
      strong: "Strong 3D discrete-event simulation with a rich drag-and-drop object library and good visualisation.",
      costs: [
        { claim: "Relatively expensive - may not be feasible for smaller organisations.", sourceId: "capterra" },
        { claim: "Can show performance issues on very large / complex models and needs significant compute.", sourceId: "worldmetrics" },
        { claim: "Steep learning curve for advanced logic.", sourceId: "g2" },
      ],
    },
    {
      name: "AnyLogic",
      strong: "Multi-method (DES + agent-based + system-dynamics) simulation with great flexibility for custom models.",
      costs: [
        { claim: "Subscription-only - no one-time purchase.", sourceId: "capterra" },
        { claim: "Custom logic needs Java; the learning curve and training cost are hard for the academic sector.", sourceId: "g2" },
        { claim: "Model / format export is limited, so sharing and interoperability suffer.", sourceId: "saashub" },
      ],
    },
  ];

  // This app's wedge (already true - stated honestly, no hype).
  const WEDGE = [
    "Free - no licence, no install: runs in any browser and works fully offline.",
    "No learning curve: Story Mode, a guided demo, plain-language edits, and a plant from a keyword.",
    "Open + shareable: JSON / CSV export and a whole plant deep-linked in a URL - no locked format.",
    "User-definable objects (like Siemens UserObjects) with no scripting or Java.",
    "Honest by design: labelled 'modelled, not measured', 'informed by ISO / DIN, not a certification', 'deterministic procedural generator, not a trained model'.",
  ];

  // The side-by-side matrix. `note` gives the honest nuance so no cell reads
  // as a boast. `edge` is which side the row favours (informational only).
  const AXES = [
    { label: "Price", suites: "~$10,000 / yr (Siemens); FlexSim relatively expensive; AnyLogic subscription-only", thisApp: "Free (no licence)", edge: "this", sourceId: "worldmetrics" },
    { label: "Install / platform", suites: "Native desktop app", thisApp: "Browser + offline PWA, zero-install", edge: "this", sourceId: "gitnux" },
    { label: "Learning curve", suites: "Steep; paid training common", thisApp: "Guided, plain-language, no training", edge: "this", sourceId: "g2" },
    { label: "Sharing", suites: "Proprietary formats; export can be limited", thisApp: "JSON / CSV + shareable URL", edge: "this", sourceId: "saashub" },
    { label: "Validated / certified DES", suites: "Yes - the reason to buy them", thisApp: "No - modelled, not measured; teaching-scale", edge: "suites", sourceId: null },
    { label: "Object libraries + track record", suites: "Deep, mature, decades of use", thisApp: "Focused, user-definable, honest", edge: "suites", sourceId: null },
    { label: "Statistical rigour (replications, CI)", suites: "Yes", thisApp: "Deterministic single-run heuristics", edge: "suites", sourceId: null },
    { label: "Honesty labelling (model vs measurement)", suites: "Not foregrounded", thisApp: "Foregrounded everywhere", edge: "this", sourceId: null },
  ];

  const MODEL = {
    version: VERSION,
    title: "How we compare",
    lede: "An honest, sourced look at this app against the serious commercial simulators - what they are strong at, and where they cost the user.",
    disclaimer: DISCLAIMER,
    framing: FRAMING,
    theirStrengths: THEIR_STRENGTHS,
    competitors: COMPETITORS,
    wedge: WEDGE,
    axes: AXES,
    sources: SOURCES,
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function sourceById(id) { return SOURCES.find((x) => x.id === id) || null; }
  function citeRef(id) {
    const s = sourceById(id);
    if (!s) return "";
    return ' <span class="hwc-cite">[' + esc(s.publisher) + "]</span>";
  }

  /* ------------------------------------------------------------------
   * html(opts) -> a self-contained, OFFLINE HTML fragment for embedding in
   * the About panel (or a dedicated view). No <script>, no external links -
   * sources are cited as plain text. Deterministic bytes (pure function of
   * the fixed MODEL). opts.headingLevel picks the top heading tag (default h3
   * so it nests under the About dialog's h2).
   * ------------------------------------------------------------------ */
  function html(opts) {
    opts = opts || {};
    const hl = opts.headingLevel === 2 ? "h2" : "h3";
    let out = '<section class="hwc" aria-label="How we compare">';
    out += "<" + hl + ' class="hwc-title">' + esc(MODEL.title) + "</" + hl + ">";
    out += '<p class="hwc-lede">' + esc(MODEL.lede) + "</p>";
    out += '<p class="hwc-disclaimer"><strong>Independent comparison.</strong> ' + esc(MODEL.disclaimer) + "</p>";

    // What they are strong at - stated first.
    out += '<h4 class="hwc-h">What the commercial suites are strong at</h4>';
    out += '<ul class="hwc-list">' + MODEL.theirStrengths.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

    // The side-by-side matrix.
    out += '<h4 class="hwc-h">Side by side</h4>';
    out += '<table class="hwc-table"><thead><tr><th scope="col">Dimension</th>' +
      '<th scope="col">Plant Simulation / FlexSim / AnyLogic</th>' +
      '<th scope="col">This app</th></tr></thead><tbody>';
    for (const a of MODEL.axes) {
      out += "<tr><th scope=\"row\">" + esc(a.label) + "</th>" +
        '<td>' + esc(a.suites) + (a.sourceId ? citeRef(a.sourceId) : "") + "</td>" +
        '<td>' + esc(a.thisApp) + "</td></tr>";
    }
    out += "</tbody></table>";

    // Where they cost the user (per product, each claim sourced).
    out += '<h4 class="hwc-h">Where they cost the user (sourced)</h4>';
    for (const c of MODEL.competitors) {
      out += '<div class="hwc-comp"><h5 class="hwc-comp-name">' + esc(c.name) + "</h5>";
      out += '<p class="hwc-strong"><strong>Strong at:</strong> ' + esc(c.strong) + "</p>";
      out += '<ul class="hwc-list">';
      for (const cost of c.costs) out += "<li>" + esc(cost.claim) + citeRef(cost.sourceId) + "</li>";
      out += "</ul></div>";
    }

    // This app's wedge.
    out += '<h4 class="hwc-h">This app\'s wedge</h4>';
    out += '<ul class="hwc-list">' + MODEL.wedge.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

    // The honest framing.
    out += '<p class="hwc-framing"><strong>The honest bottom line.</strong> ' + esc(MODEL.framing) + "</p>";

    // Sources, cited as text (offline - not opened).
    out += '<h4 class="hwc-h">Sources</h4>';
    out += '<ul class="hwc-sources">';
    for (const s of MODEL.sources) {
      out += "<li><strong>" + esc(s.publisher) + "</strong> - " + esc(s.note) + ' <span class="hwc-url">' + esc(s.cite) + "</span></li>";
    }
    out += "</ul>";
    out += '<p class="hwc-note">Sources are cited as text and never opened - the app stays fully offline. Fetched for the competitive analysis; the user is free to verify each against the original publisher.</p>';
    out += "</section>";
    return out;
  }

  WT.howwecompare = {
    VERSION: VERSION,
    DISCLAIMER: DISCLAIMER,
    FRAMING: FRAMING,
    MODEL: MODEL,
    SOURCES: SOURCES,
    html: html,
  };
})();
