/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * selftest.js - a REAL in-browser end-to-end self-test.
 * ---------------------------------------------------------------------
 * INERT by default. It only runs when the URL carries `?selftest=1`
 * (e.g. index.html?selftest=1); a normal load is COMPLETELY unaffected -
 * the guard below returns immediately and nothing else executes.
 *
 * When enabled, it waits for the app to finish booting, then drives the
 * LIVE app through the SAME functions the UI uses (exposed in self-test
 * mode as window.__WT_TEST_API__ by app.js) and asserts wiring + a clean
 * boot. It writes a MACHINE-READABLE result into a #wt-selftest element
 * (created here) and console.log()s it, in one of two exact formats:
 *
 *     WT-SELFTEST: PASS 78/78
 *     WT-SELFTEST: FAIL 45/78 :: <comma-separated failed check names>
 *
 * A maintainer runs it headlessly (e.g. headless Edge) and reads the
 * #wt-selftest text / the console line.
 *
 * HONESTY: this verifies WIRING and a NO-UNCAUGHT-ERROR boot - that every
 * module is present and of the right shape, the panels/buttons exist, and
 * the real handlers run without throwing. It does NOT verify visual/pixel
 * correctness (that is what the human eye + the pure-draw harnesses cover).
 * Each check is isolated in try/catch, so one failing check is one FAIL,
 * never a dead page; the suite restores the app to a normal state at the end.
 *
 * Loaded LAST (after app.js). Dependency-free, CSP-safe (no eval, no inline).
 * ===================================================================== */
(function () {
  "use strict";

  // --- The single gate: inert unless ?selftest=1 is in the query string ---
  function selftestEnabled() {
    return /[?&]selftest=1(?:&|$)/.test(window.location.search);
  }
  if (!selftestEnabled()) return; // NORMAL load: do nothing at all.

  var results = []; // { name, ok, detail }

  function check(name, fn) {
    var ok = false;
    var detail = "";
    try {
      var r = fn();
      if (r && typeof r === "object" && "ok" in r) {
        ok = !!r.ok;
        detail = r.detail || "";
      } else {
        ok = !!r;
      }
    } catch (e) {
      ok = false;
      detail = e && e.message ? e.message : String(e);
    }
    results.push({ name: name, ok: ok, detail: detail });
    return ok;
  }

  function raf() {
    return new Promise(function (resolve) {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(function () { resolve(); });
      } else {
        setTimeout(resolve, 16);
      }
    });
  }

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------
  // The check suite. Runs against the LIVE, booted app.
  // ------------------------------------------------------------------
  async function runSuite() {
    var WT = window.WT || {};
    var API = window.__WT_TEST_API__ || null;

    // ---- Error-boundary state: a clean boot has recorded NO errors -----
    check("errors-global-array", function () {
      return { ok: Array.isArray(window.__WT_ERRORS__), detail: "type=" + typeof window.__WT_ERRORS__ };
    });
    check("no-errors-during-boot", function () {
      var e = window.__WT_ERRORS__ || [];
      return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" };
    });

    // ---- Every expected WT.* module present + of the right shape -------
    var MODULES = [
      ["domain", function (m) { return m && m.ELEMENTS && typeof m.elementCapacity === "function"; }],
      ["view", function (m) { return m && typeof m.worldToScreen === "function" && typeof m.fitView === "function"; }],
      ["compliance", function (m) { return m && typeof m.check === "function"; }],
      ["advisor", function (m) { return m && typeof m.analyze === "function"; }],
      ["generate", function (m) { return m && typeof m.generateLayout === "function" && m.plantProfiles; }],
      ["examples", function (m) { return m && Array.isArray(m.library) && m.library.length >= 20 && typeof m.build === "function"; }],
      ["wms", function (m) { return m && typeof m.runOperations === "function" && typeof m.kpis === "function"; }],
      ["flowsim", function (m) { return m && typeof m.step === "function" && typeof m.state === "function"; }],
      ["kpicharts", function (m) { return m && typeof m.drawDashboard === "function" && typeof m.series === "function"; }],
      ["wmsdata", function (m) { return m && typeof m.stats === "function" && typeof m.generate === "function"; }],
      ["storage", function (m) { return m && typeof m.stats === "function" && typeof m.assign === "function"; }],
      ["kb", function (m) { return m && typeof m.get === "function" && typeof m.list === "function"; }],
      ["automation", function (m) { return m && typeof m.report === "function" && typeof m.systems === "function"; }],
      ["report", function (m) { return m && typeof m.build === "function" && typeof m.toHtml === "function" && typeof m.toJson === "function"; }],
      ["compare", function (m) { return m && typeof m.compare === "function"; }],
      ["scenarios", function (m) { return m && typeof m.save === "function" && typeof m.list === "function"; }],
      ["orderpool", function (m) { return m && typeof m.create === "function" && typeof m.step === "function"; }],
      ["iso", function (m) { return m && typeof m.project === "function" && typeof m.elementHeight === "function"; }],
      ["shapes", function (m) { return m && typeof m.has === "function" && typeof m.draw2D === "function" && typeof m.draw3D === "function"; }],
      ["cards", function (m) { return m && typeof m.create === "function" && typeof m.slug === "function"; }],
      ["demo", function (m) { return m && typeof m.run === "function" && Array.isArray(m.ACTIONS) && m.ABOUT; }],
      ["story", function (m) { return m && Array.isArray(m.STEPS) && m.STEPS.length > 0 && typeof m.run === "function" && typeof m.frameZone === "function" && typeof m.lerpCamera === "function"; }],
      ["tiers", function (m) { return m && typeof m.caps === "function" && typeof m.current === "function"; }],
      ["library", function (m) { return m && typeof m.define === "function" && typeof m.paletteTree === "function" && typeof m.embedInto === "function" && Array.isArray(m.BASES); }],
      ["fluids", function (m) { return m && typeof m.analyze === "function" && typeof m.demoLayout === "function" && typeof m.NOTE === "string"; }],
    ];
    MODULES.forEach(function (pair) {
      var name = pair[0];
      var shapeOk = pair[1];
      check("module:WT." + name, function () {
        var m = WT[name];
        return { ok: !!m && shapeOk(m), detail: m ? "present" : "MISSING" };
      });
    });

    // ---- The self-test hook the app exposes in self-test mode ----------
    check("test-api-exposed", function () {
      return {
        ok: !!API && typeof API.loadExample === "function" && typeof API.runWmsOps === "function" && typeof API.render === "function",
        detail: API ? "attached" : "MISSING (__WT_TEST_API__)",
      };
    });

    // ---- v1.7 DEEP-LINK: the scenario deep-link parser exists + works --
    // index.html?scenario=<id> opens that example scenario (and skips the
    // welcome modal) at boot. Assert the PURE parser is present and returns
    // a REAL library id verbatim, that ?onboarding=0 skips on its own, and
    // that ?selftest=1 is NOT hijacked (no scenario, no skip).
    check("deeplink-parser-parses-scenario", function () {
      var DL = WT.deeplink;
      if (!DL || typeof DL.parse !== "function") return { ok: false, detail: "WT.deeplink.parse MISSING" };
      var ex = WT.examples && WT.examples.library && WT.examples.library[0];
      if (!ex) return { ok: false, detail: "no example in library" };
      var r = DL.parse("?scenario=" + ex.id);
      var off = DL.parse("?onboarding=0");
      var st = DL.parse("?selftest=1");
      var ok = r.scenario === ex.id && r.skipOnboarding === true &&
        off.skipOnboarding === true && st.scenario === null && st.skipOnboarding === false;
      return { ok: ok, detail: "scenario=" + r.scenario + " skip=" + r.skipOnboarding +
        " onboarding0=" + off.skipOnboarding + " selftestSafe=" + (st.scenario === null) };
    });

    // ---- Canvas exists + has a non-zero drawing buffer -----------------
    check("canvas-present-sized", function () {
      var c = $("floor");
      return {
        ok: !!c && c.tagName === "CANVAS" && c.width > 0 && c.height > 0,
        detail: c ? c.width + "x" + c.height : "no #floor",
      };
    });

    // ---- Key panels / cards present in the DOM -------------------------
    check("panels-present", function () {
      var ids = ["genCard", "examplesCard", "scenariosCard", "compareCard", "dataCard",
        "wmsDataCard", "propCard", "wmsCard", "autoCard", "storageCard", "flowCard",
        "complCard", "kbCard"];
      var missing = ids.filter(function (id) { return !$(id); });
      return { ok: missing.length === 0, detail: missing.length ? "missing: " + missing.join(",") : ids.length + " ok" };
    });

    // ---- Key buttons / controls present in the DOM ---------------------
    check("buttons-present", function () {
      var ids = ["genBtn", "exampleLoadBtn", "wmsBtn", "flowPlayBtn", "flowPauseBtn",
        "flowResetBtn", "flowStepBtn", "reportOpenBtn", "reportJsonBtn", "compareRunBtn",
        "scenarioSaveBtn", "storageAssignBtn", "autoBtn", "complBtn", "kbAddRuleBtn",
        "guidedDemoBtn", "storyBtn", "aboutBtn", "isoBtn", "zoomInBtn", "zoomOutBtn", "zoomFitBtn"];
      var missing = ids.filter(function (id) { return !$(id); });
      return { ok: missing.length === 0, detail: missing.length ? "missing: " + missing.join(",") : ids.length + " ok" };
    });

    // ---- Live example load places elements + redraws with no error -----
    // From here on we DRIVE the app through the exposed handlers.
    var haveApi = !!API;
    check("load-example-places-elements", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      var before = API.state.elements.length;
      var ex = WT.examples && WT.examples.library && WT.examples.library[0];
      if (!ex) return { ok: false, detail: "no example in library" };
      API.loadExample(ex.id);
      var after = API.state.elements.length;
      return { ok: after > 0, detail: ex.id + ": " + before + " -> " + after + " elements" };
    });

    check("redraw-no-error", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.render(); // reuses the same render() the whole app draws through
      return { ok: true, detail: "render() returned" };
    });

    // ---- v1.14 SIGNATURE SHOWCASE: the 800+ element mega plant loads, frames
    // and RENDERS in the LIVE app (the perf-critical path - build + adopt +
    // Fit + cull + render at scale) and stays compliance-safe (never a FAIL).
    // Afterwards the first example is reloaded so later checks are unaffected.
    check("mega-showcase-loads-renders-800-plus", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      var lib = (WT.examples && WT.examples.library) || [];
      var mega = lib.filter(function (e) { return e.config && e.config.mega; })[0];
      if (!mega) return { ok: false, detail: "no config.mega scenario in library" };
      API.loadExample(mega.id);           // build + adopt + Fit the big floor
      var n = API.state.elements.length;
      API.render();                        // same render() the app draws through
      var worst = "n/a";
      try {
        var lay = API.currentLayout();
        var rep = WT.compliance.check(lay, { minAisleMetres: lay.config && lay.config.minAisleMetres });
        worst = rep.summary.worst;
      } catch (e) { worst = "threw:" + (e && e.message); }
      var restored = lib[0] ? (API.loadExample(lib[0].id), API.state.elements.length > 0) : true;
      return {
        ok: n >= 800 && worst !== "fail" && worst.indexOf("threw") !== 0 && restored,
        detail: mega.id + ": " + n + " elements, compliance " + worst + ", restored=" + restored,
      };
    });

    // ---- WMS ops populates its panel -----------------------------------
    check("wms-ops-populates-panel", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.runWmsOps();
      var out = $("wmsOut");
      var html = out ? out.innerHTML : "";
      var empty = html.indexOf('class="empty"') !== -1;
      return { ok: !!html && html.length > 40 && !empty, detail: "wmsOut html len=" + html.length };
    });

    // ---- Flow: stepping advances the flowsim tick, no error ------------
    check("flow-step-advances-sim", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.flowReset();
      var sim0 = API.state.flow.sim;
      if (!sim0) return { ok: false, detail: "no sim after reset" };
      var tick0 = sim0.tick;
      API.flowStep();
      API.flowStep();
      var sim1 = API.state.flow.sim;
      return { ok: !!sim1 && sim1.tick > tick0, detail: "tick " + tick0 + " -> " + (sim1 ? sim1.tick : "?") };
    });

    // ---- v3.12: toggle Flow links -> the CONNECTION overlay renders on a
    // routed scenario. Drives the SAME toggle + model the toolbar button uses,
    // asserts the directed link set is non-empty on a real layout, then draws
    // it through the LIVE render() without throwing, and restores the toggle.
    check("flow-links-overlay-renders", function () {
      if (!haveApi || !API.flowLinks || !WT.flowlinks) return { ok: false, detail: "no flowLinks test API / module" };
      // Ensure a routed scenario is on the floor (first example = a real plant).
      var ex = WT.examples && WT.examples.library && WT.examples.library[0];
      if (ex) API.loadExample(ex.id);
      var was = API.flowLinks.on();
      API.flowLinks.set(true);
      var onNow = API.flowLinks.on();
      var btn = $("flowLinksBtn");
      var pressed = btn && btn.getAttribute("aria-pressed") === "true";
      var model = API.flowLinks.model();
      var hasNetwork = !!model && !model.empty && model.nodes.length >= 2 && model.links.length >= 1;
      // Every link is directed downstream along the flow spine (no skips).
      var order = WT.flowlinks.STAGE_ORDER;
      var directed = hasNetwork && model.links.every(function (l) {
        return order.indexOf(l.fromStage) < order.indexOf(l.toStage);
      });
      var threw = "";
      try { API.render(); } catch (e) { threw = e && e.message ? e.message : String(e); }
      API.flowLinks.set(!!was); // restore
      return {
        ok: onNow && pressed && hasNetwork && directed && !threw,
        detail: threw ? ("render threw: " + threw)
          : (model ? (model.nodes.length + " stages, " + model.links.length + " links, routed=" + model.routed + ", pressed=" + pressed) : "no model"),
      };
    });

    // ---- v2.1: curved conveyor + worker figures wired into the live app -
    // The curved segment is registered + 0-capacity, its pure arc sampler
    // rides a quarter-arc, buildWaypoints routes a box ALONG the arc, and a
    // worker figure draws at a manned station on a REAL canvas without throwing.
    check("curved-conveyor-and-worker-figures", function () {
      var S = WT.shapes, F = WT.flowsim, DM = WT.domain;
      if (!S || !F || !DM) return { ok: false, detail: "shapes/flowsim/domain missing" };
      var hasCurve = S.has("conveyor-curve") === true && !!DM.ELEMENTS["conveyor-curve"];
      var cap = DM.elementCapacity({ type: "conveyor-curve", w: 3, d: 3 });
      var pts = F.curveArcPoints({ type: "conveyor-curve", x: 18, y: 3, w: 3, d: 3, arc: "bl" }, 8);
      var onArc = pts.length === 9 && pts.every(function (p) { return Math.abs(Math.hypot(p.x - 18, p.y - 6) - 1.5) < 1e-6; });
      var lay = { elements: [
        { id: "a", type: "selective-racking", x: 2, y: 4, w: 6, d: 1 },
        { id: "b", type: "conveyor", x: 8, y: 4, w: 10, d: 1 },
        { id: "c", type: "conveyor-curve", x: 18, y: 3, w: 3, d: 3, arc: "bl" },
        { id: "d", type: "conveyor", x: 19, y: 6, w: 1, d: 10 },
        { id: "e", type: "carton-flow", x: 18, y: 16, w: 4, d: 2 },
      ], gridW: 40, gridH: 24, cell: 1, config: { seed: 4 } };
      var wps = F.buildWaypoints(lay);
      var arcWps = wps.filter(function (w) { return w.onCurve; });
      var routed = arcWps.length >= 5 && arcWps.every(function (w) { return Math.abs(Math.hypot(w.x - 18, w.y - 6) - 1.5) < 1e-6; });
      var workerOk = true;
      try {
        var cv = document.createElement("canvas"); cv.width = 200; cv.height = 200;
        var g = cv.getContext("2d");
        // rich (zoomed-in) tier -> the manned station draws its worker figure
        S.draw2D(g, "pack-station", { x: 10, y: 10, w: 90, d: 60, cellPx: 30, color: "#eab308", theme: "light", lod: 60, anim: 0.3 });
      } catch (e) { workerOk = false; }
      return {
        ok: hasCurve && cap === 0 && onArc && routed && workerOk,
        detail: "curve=" + hasCurve + " cap=" + cap + " arc9=" + onArc + " arcWps=" + arcWps.length + " routed=" + routed + " worker=" + workerOk,
      };
    });

    // ---- Flow: play starts the animation, then it stops cleanly --------
    // Awaits a couple of real animation frames, then pauses (async check).
    var playOk = false;
    var playDetail = "";
    try {
      if (haveApi) {
        API.flowReset();
        API.flowPlay();
        var playing = !!API.state.flow.playing;
        await raf();
        await raf();
        API.flowPause();
        var stopped = API.state.flow.playing === false;
        playOk = playing && stopped;
        playDetail = "playing=" + playing + " -> stopped=" + stopped;
      } else {
        playDetail = "no test API";
      }
    } catch (e) {
      playOk = false;
      playDetail = e && e.message ? e.message : String(e);
    }
    results.push({ name: "flow-play-then-stop", ok: playOk, detail: playDetail });

    // ---- 2.5D toggle is a pure no-op on the layout ---------------------
    check("iso-toggle-layout-unchanged", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      var snapshot = JSON.stringify(API.state.elements);
      API.setViewMode("iso");
      var inIso = API.state.viewMode === "iso";
      API.setViewMode("top");
      var backTop = API.state.viewMode === "top";
      var same = JSON.stringify(API.state.elements) === snapshot;
      return { ok: inIso && backTop && same, detail: "iso=" + inIso + " top=" + backTop + " layout-unchanged=" + same };
    });

    // ---- v1.8: pressing "P" switches the whole view 2D <-> 2.5D ---------
    // Dispatch a REAL KeyboardEvent so the live window keydown handler runs
    // (the SAME code path a keypress takes). From a top view, one "P" must
    // flip to iso and a second "P" must flip back - proving the shortcut is
    // wired to the view-mode toggle and is not swallowed.
    check("key-p-toggles-view-mode", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.setViewMode("top");
      var start = API.state.viewMode;
      function pressP() {
        var ev;
        try { ev = new KeyboardEvent("keydown", { key: "p", bubbles: true }); }
        catch (e) {
          ev = document.createEvent("Event");
          ev.initEvent("keydown", true, true);
          try { ev.key = "p"; } catch (_) { /* read-only in some engines */ }
        }
        window.dispatchEvent(ev);
      }
      pressP();
      var afterOne = API.state.viewMode;
      pressP();
      var afterTwo = API.state.viewMode;
      var ok = start === "top" && afterOne === "iso" && afterTwo === "top";
      return { ok: ok, detail: start + " -> " + afterOne + " -> " + afterTwo };
    });

    // ---- Report builds with the expected sections ----------------------
    var report = null;
    check("report-build-sections", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      report = API.buildCurrentReport();
      var need = ["header", "layout", "compliance", "operations", "storage", "automation", "dataProfile", "standardsBasis"];
      var missing = need.filter(function (k) { return !report || report[k] == null; });
      var sectionsOk = report && Array.isArray(report.sections) && report.sections.length > 0;
      return { ok: missing.length === 0 && sectionsOk, detail: missing.length ? "missing: " + missing.join(",") : "all sections + " + (report.sections ? report.sections.length : 0) + " section refs" };
    });

    check("report-json-roundtrip", function () {
      if (!report || !WT.report) return { ok: false, detail: "no report" };
      var json = WT.report.toJson(report);
      var parsed = JSON.parse(json);
      return { ok: !!parsed && !!parsed.header && !!parsed.compliance, detail: "json len=" + json.length };
    });

    // ---- About / knowledge-base panels open without throwing -----------
    check("about-open-close", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.openAbout();
      var body = $("aboutBody");
      var opened = $("about") && $("about").hidden === false && body && body.innerHTML.length > 0;
      API.closeAbout();
      var closed = $("about") && $("about").hidden === true;
      return { ok: !!opened && !!closed, detail: "opened=" + !!opened + " closed=" + !!closed };
    });

    check("knowledge-base-populated", function () {
      var list = $("kbList");
      return { ok: !!list && list.innerHTML.replace(/\s/g, "").length > 0, detail: list ? "kbList len=" + list.innerHTML.length : "no #kbList" };
    });

    // ---- Zoom controls run without throwing ----------------------------
    check("zoom-controls-run", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      API.zoomAt(1.2);
      API.fitToFloor();
      return { ok: API.view.scale > 0, detail: "scale=" + API.view.scale.toFixed(3) };
    });

    // ---- v1.6 A11Y: the canvas exposes a text alternative --------------
    // A canvas is opaque to assistive tech; it must carry an aria-label AND
    // point at an offscreen description that reflects the current layout.
    check("a11y-canvas-has-aria-label", function () {
      var c = $("floor");
      var label = c ? (c.getAttribute("aria-label") || "") : "";
      return { ok: !!c && label.trim().length > 0, detail: c ? 'aria-label="' + label + '"' : "no #floor" };
    });
    check("a11y-canvas-described-by-summary", function () {
      var c = $("floor");
      var ref = c ? c.getAttribute("aria-describedby") : null;
      var desc = ref ? $(ref) : null;
      var text = desc ? (desc.textContent || "").trim() : "";
      // The description is kept current by the app (element count / floor
      // size / sim status); after boot + a render it must be non-trivial.
      return { ok: !!desc && text.length > 10, detail: desc ? "#" + ref + " len=" + text.length : "no describedby target" };
    });

    // ---- v1.6 A11Y: key toolbar controls have accessible names ---------
    check("a11y-toolbar-accessible-names", function () {
      var ids = ["zoomInBtn", "zoomOutBtn", "zoomFitBtn", "zoom100Btn", "panBtn",
        "isoBtn", "guidedDemoBtn", "flowPlayBtn", "flowPauseBtn"];
      var missing = ids.filter(function (id) {
        var b = $(id);
        if (!b) return true;
        var name = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "").trim();
        return name.length === 0;
      });
      return { ok: missing.length === 0, detail: missing.length ? "no accessible name: " + missing.join(",") : ids.length + " named" };
    });

    // ---- v1.6 A11Y: reduced-motion preference is honoured --------------
    // The app exposes a reduced-motion flag it reads before auto-running the
    // material-flow animation; here we assert the hook exists and is boolean.
    check("a11y-reduced-motion-flag", function () {
      if (!haveApi) return { ok: false, detail: "no test API" };
      var rm = API.prefersReducedMotion;
      return { ok: typeof rm === "function" && typeof rm() === "boolean", detail: "prefersReducedMotion()=" + (typeof rm === "function" ? rm() : "MISSING") };
    });

    // ---- v1.6 PERF: cullToView is pure + correct (live wiring) ----------
    check("perf-cullToView-culls-offscreen", function () {
      if (!haveApi || typeof API.cullToView !== "function") return { ok: false, detail: "no cullToView on API" };
      var bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      var inside = { id: "in", type: "shelf", x: 2, y: 2, w: 2, d: 2 };
      var outside = { id: "out", type: "shelf", x: 100, y: 100, w: 2, d: 2 };
      var els = [inside, outside];
      var kept = API.cullToView(els, bounds, 0);
      var mutated = els.length !== 2;
      var determ = JSON.stringify(API.cullToView(els, bounds, 0)) === JSON.stringify(kept);
      var ok = kept.length === 1 && kept[0].id === "in" && !mutated && determ;
      return { ok: ok, detail: "kept=" + kept.length + " determ=" + determ + " noMutate=" + !mutated };
    });

    // ---- v1.13 STORY MODE: the cinematic guided tour -------------------
    // The "Story" control frames each zone with a moving WT.view camera and
    // a caption, then plays the live flow. Assert the control has a name, the
    // plan is well-formed, framing a zone MOVES the camera (the SAME
    // storyTargetFor math the live tour tweens to), and Esc exits the tour.
    check("story-control-has-accessible-name", function () {
      var b = $("storyBtn");
      var name = b ? (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "").trim() : "";
      return { ok: !!b && name.length > 0, detail: b ? 'name="' + name + '"' : "no #storyBtn" };
    });

    check("story-plan-well-formed", function () {
      var st = WT.story;
      if (!st || typeof st.script !== "function") return { ok: false, detail: "WT.story MISSING" };
      var plan = st.script();
      var known = {};
      (st.ACTIONS || []).forEach(function (a) { known[a] = true; });
      var stageOk = {}; (st.STAGES || []).concat(["all"]).forEach(function (s) { stageOk[s] = true; });
      var ok = Array.isArray(plan) && plan.length > 0 && plan.every(function (s) {
        return s.id && s.title && s.caption && known[s.action] && stageOk[s.stage];
      });
      return { ok: ok, detail: plan.length + " steps: " + plan.map(function (s) { return s.stage; }).join(">") };
    });

    check("story-frame-zone-moves-camera", function () {
      if (!haveApi || !API.story || typeof API.story.frame !== "function") return { ok: false, detail: "no story frame API" };
      API.fitToFloor();
      var fit = { s: API.view.scale, x: API.view.panX, y: API.view.panY };
      var recv = API.story.frame("receiving");
      var ship = API.story.frame("shipping");
      var movedFromFit = recv.scale !== fit.s || recv.panX !== fit.x || recv.panY !== fit.y;
      var zonesDiffer = recv.panX !== ship.panX || recv.panY !== ship.panY;
      var finite = isFinite(recv.scale) && isFinite(recv.panX) && isFinite(recv.panY);
      return {
        ok: movedFromFit && zonesDiffer && finite,
        detail: "movedFromFit=" + movedFromFit + " zonesDiffer=" + zonesDiffer + " scale=" + recv.scale.toFixed(2),
      };
    });

    check("story-start-then-esc-exits", function () {
      if (!haveApi || !API.story || typeof API.story.start !== "function") return { ok: false, detail: "no story start API" };
      API.story.start();
      var running = API.story.isRunning();
      // Dispatch a REAL Escape keydown so the live window handler runs.
      var ev;
      try { ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true }); }
      catch (e) {
        ev = document.createEvent("Event"); ev.initEvent("keydown", true, true);
        try { ev.key = "Escape"; } catch (_) { /* read-only in some engines */ }
      }
      window.dispatchEvent(ev);
      var exited = API.story.isRunning() === false;
      if (API.story.isRunning()) { try { API.story.stop(); } catch (_) { /* ensure clean */ } }
      return { ok: running && exited, detail: "running=" + running + " exitedOnEsc=" + exited };
    });

    // ---- v1.15 USER-DEFINABLE OBJECT LIBRARY --------------------------
    // The "Define Object" control exists, the palette is a categorised tree
    // (groups + My Objects), and a defined object registers, appears in the
    // palette and can be PLACED on the floor. Cleans up after itself.
    check("define-object-control-present", function () {
      var btn = document.getElementById("defineObjectBtn");
      var heads = document.querySelectorAll("#palette .pal-group-head");
      return { ok: !!btn && heads.length >= 3, detail: btn ? ("groups=" + heads.length) : "no defineObjectBtn" };
    });
    check("palette-shows-categories-and-my-objects", function () {
      var labels = [];
      document.querySelectorAll("#palette .pal-group-label").forEach(function (el) { labels.push(el.textContent); });
      return { ok: labels.indexOf("My Objects") !== -1 && labels.indexOf("Storage & Racking") !== -1, detail: labels.join(" | ") };
    });

    // ---- v2.3 UI-1: the CALM, SEARCHABLE Class Library ----------------
    // Progressive disclosure: the palette is a collapsible, searchable tree.
    // A search box exists, the group headers expose aria-expanded and at least
    // one is COLLAPSED by default (first-run declutter), and the live search
    // filters components by name across every group (with a no-match note),
    // then restores the full tree on clear.
    check("class-library-search-and-collapsible", function () {
      var input = document.getElementById("paletteSearch");
      var heads = document.querySelectorAll("#palette .pal-group-head");
      // Every group header is a collapsible control (aria-expanded true|false).
      var allHaveAria = heads.length >= 2, i;
      for (i = 0; i < heads.length; i++) {
        var v = heads[i].getAttribute("aria-expanded");
        if (v !== "true" && v !== "false") allHaveAria = false;
      }
      // Prove a group actually collapses/expands via the SAME path the UI uses
      // (robust to whatever collapse state is persisted for this profile).
      var toggleOk = false;
      if (haveApi && API.library && typeof API.library.toggleGroup === "function" && typeof API.library.collapsedState === "function" && heads.length) {
        var label = heads[0].dataset.group;
        var before = !!API.library.collapsedState()[label];
        API.library.toggleGroup(label);
        var after = !!API.library.collapsedState()[label];
        API.library.toggleGroup(label); // restore
        toggleOk = before !== after;
      }
      return {
        ok: !!input && allHaveAria && toggleOk,
        detail: "search=" + !!input + " heads=" + heads.length + " aria=" + allHaveAria + " toggles=" + toggleOk,
      };
    });
    check("class-library-search-filters", function () {
      if (!haveApi || !API.library || typeof API.library.setSearch !== "function") return { ok: false, detail: "no setSearch API" };
      API.library.setSearch("conveyor");
      var items = document.querySelectorAll("#palette .pal-item");
      var filtered = items.length;
      var everyMatches = filtered > 0;
      items.forEach(function (b) {
        var nm = (b.querySelector(".pal-name") || {}).textContent || "";
        if (nm.toLowerCase().indexOf("conveyor") === -1) everyMatches = false;
      });
      // A term that matches nothing shows the no-match note + zero items.
      API.library.setSearch("zzzz-no-such-object");
      var noMatch = document.querySelectorAll("#palette .pal-item").length === 0 &&
        !!document.querySelector("#palette .pal-no-match");
      // Clear: the full tree returns (items in collapsed groups stay in the DOM).
      API.library.setSearch("");
      var restored = document.querySelectorAll("#palette .pal-item").length >= filtered;
      return {
        ok: everyMatches && filtered >= 1 && noMatch && restored,
        detail: "filtered=" + filtered + " everyMatch=" + everyMatches + " noMatch=" + noMatch + " restored=" + restored,
      };
    });
    check("defined-object-registers-places-renders", function () {
      if (!WT.library || !haveApi || !API.library) return { ok: false, detail: "no library api" };
      var def = WT.library.define({ name: "Selftest Widget", base: "station", w: 2, d: 2, height: 1.5, glyph: "box", color: "#123456", params: { cycleSec: 12 } });
      if (!def) return { ok: false, detail: "define failed" };
      API.library.buildPalette();
      var inPalette = false;
      document.querySelectorAll("#palette .pal-item").forEach(function (b) { if (b.dataset.type === def.id) inPalette = true; });
      var before = API.state.elements.length;
      var lay = API.currentLayout();
      var placed = false;
      var spots = [[0, 0], [1, 1], [0, (lay.gridH || 10) - 1], [(lay.gridW || 10) - 2, 0]];
      for (var i = 0; i < spots.length && !placed; i++) {
        API.library.placeAt(def.id, spots[i][0], spots[i][1]);
        if (API.state.elements.length > before) placed = true;
      }
      var el = placed ? API.state.elements[API.state.elements.length - 1] : null;
      var typeOk = !!(el && el.type === def.id && WT.domain.ELEMENTS[def.id]);
      // cleanup: drop the placed instance + the custom type, restore the palette.
      if (el) API.state.elements = API.state.elements.filter(function (e) { return e.id !== el.id; });
      WT.library.remove(def.id);
      API.library.buildPalette();
      API.render();
      return { ok: inPalette && placed && typeOk, detail: "inPalette=" + inPalette + " placed=" + placed + " typeOk=" + typeOk };
    });

    // ---- v2.4 UI-2: Simple/Expert DENSITY toggle ----------------------
    // The global density lever exists, is labelled + aria-pressed, seeds a root
    // data-density state, and FLIPS it (Simple <-> Expert) through the SAME
    // path the toolbar button uses. Every state is restored afterwards.
    check("density-toggle-present-and-labelled", function () {
      var btn = $("densityBtn");
      if (!btn) return { ok: false, detail: "no #densityBtn" };
      var pressed = btn.getAttribute("aria-pressed");
      var name = (btn.getAttribute("aria-label") || btn.textContent || btn.getAttribute("title") || "").trim();
      var rootState = document.documentElement.getAttribute("data-density");
      var ok = (pressed === "true" || pressed === "false") && name.length > 0 &&
        (rootState === "simple" || rootState === "expert");
      return { ok: ok, detail: "aria-pressed=" + pressed + " root=" + rootState + " named=" + (name.length > 0) };
    });
    check("density-toggle-flips-root-state", function () {
      if (!haveApi || !API.density || typeof API.density.set !== "function") return { ok: false, detail: "no density API" };
      var original = API.density.mode();
      API.density.set("simple");
      var simpleRoot = document.documentElement.getAttribute("data-density");
      var pressedSimple = $("densityBtn") && $("densityBtn").getAttribute("aria-pressed");
      API.density.set("expert");
      var expertRoot = document.documentElement.getAttribute("data-density");
      var pressedExpert = $("densityBtn") && $("densityBtn").getAttribute("aria-pressed");
      API.density.toggle();
      var toggledRoot = document.documentElement.getAttribute("data-density");
      API.density.set(original); // restore the profile's density
      var ok = simpleRoot === "simple" && expertRoot === "expert" && toggledRoot === "simple" &&
        pressedSimple === "false" && pressedExpert === "true";
      return { ok: ok, detail: "simple=" + simpleRoot + " expert=" + expertRoot + " toggled=" + toggledRoot + " aria(" + pressedSimple + "/" + pressedExpert + ")" };
    });

    // ---- v3.13 FULL-ACCESS DEFAULT ------------------------------------
    // On a FRESH profile (no stored density choice) the app defaults to EXPERT /
    // full-access so NOTHING is hidden - a control previously gated by Simple is
    // visible by default. Re-seed from an emptied store the way boot does, then
    // restore the profile's stored choice so we leave no trace.
    check("density-default-full-access-on-fresh-profile", function () {
      if (!haveApi || !API.density || typeof API.density.reseed !== "function")
        return { ok: false, detail: "no density.reseed API" };
      var KEY = "wt.ui.density.v1";
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) { /* storage may be unavailable */ }
      try { localStorage.removeItem(KEY); } catch (e) { /* best-effort */ }
      var freshMode = API.density.reseed(); // fresh profile => full-access
      var fullAccess = freshMode === "expert" &&
        document.documentElement.getAttribute("data-density") === "expert";
      // A previously Simple-hidden control must now be VISIBLE by default: use
      // the Inspector's Advanced group (data-density="expert").
      var advVisible = true;
      if (typeof API.selectElement === "function") {
        if (!API.state.elements.length) {
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        }
        if (API.state.elements.length) {
          API.selectElement(API.state.elements[0].id);
          var panel = $("propPanel");
          var advanced = panel && panel.querySelector('.prop-group[data-group="advanced"]');
          if (advanced) { var cs = window.getComputedStyle(advanced); advVisible = !!cs && cs.display !== "none"; }
        }
      }
      // Restore the profile's stored choice + re-seed (leave no trace).
      try {
        if (saved === "simple" || saved === "expert") localStorage.setItem(KEY, saved);
        else localStorage.removeItem(KEY);
      } catch (e) { /* best-effort */ }
      API.density.reseed();
      return { ok: fullAccess && advVisible,
        detail: "freshMode=" + freshMode + " advancedVisibleByDefault=" + advVisible };
    });

    // ---- v2.4 UI-2: grouped Inspector (Basic always, Advanced gated) --
    // Select an element, then assert the Properties panel shows a Basic group
    // (always visible, never gated) and an Advanced group that is DENSITY-
    // GATED: computed display:none in Simple, visible in Expert.
    check("inspector-groups-basic-always-advanced-gated", function () {
      if (!haveApi || typeof API.selectElement !== "function") return { ok: false, detail: "no selectElement API" };
      if (!API.state.elements.length) {
        var ex = WT.examples && WT.examples.library && WT.examples.library[0];
        if (ex) API.loadExample(ex.id);
      }
      if (!API.state.elements.length) return { ok: false, detail: "no elements to select" };
      var origDensity = API.density ? API.density.mode() : "simple";
      API.selectElement(API.state.elements[0].id);
      var panel = $("propPanel");
      var basic = panel.querySelector('.prop-group[data-group="basic"]');
      var advanced = panel.querySelector('.prop-group[data-group="advanced"]');
      var basicOk = !!basic;
      var advancedPresent = !!advanced;
      var advancedGated = advancedPresent && advanced.getAttribute("data-density") === "expert";
      var basicUngated = basicOk && basic.getAttribute("data-density") === null;
      function disp(el) { var cs = el && window.getComputedStyle(el); return cs ? cs.display : "none"; }
      var hiddenInSimple = true, shownInExpert = true;
      if (API.density && advancedPresent) {
        API.density.set("simple");
        hiddenInSimple = disp(advanced) === "none";
        API.density.set("expert");
        shownInExpert = disp(advanced) !== "none";
        API.density.set(origDensity); // restore
      }
      var ok = basicOk && advancedPresent && advancedGated && basicUngated && hiddenInSimple && shownInExpert;
      return {
        ok: ok,
        detail: "basic=" + basicOk + " advGated=" + advancedGated + " ungatedBasic=" + basicUngated +
          " hiddenSimple=" + hiddenInSimple + " shownExpert=" + shownInExpert,
      };
    });

    // ---- v2.5 FACTORY-A: Warehouse / Factory MODE + manufacturing parts -
    // The mode toggle exists, is labelled + aria-pressed, seeds a root
    // data-mode state; switching to Factory REVEALS the Production / Assembly
    // group in the Class Library and lets a manufacturing component be placed;
    // Warehouse HIDES that group again. Every state is restored afterwards.
    check("factory-mode-toggle-present-and-labelled", function () {
      var btn = $("modeBtn");
      if (!btn) return { ok: false, detail: "no #modeBtn" };
      var pressed = btn.getAttribute("aria-pressed");
      var name = (btn.getAttribute("aria-label") || btn.textContent || btn.getAttribute("title") || "").trim();
      var rootState = document.documentElement.getAttribute("data-mode");
      var ok = (pressed === "true" || pressed === "false") && name.length > 0 &&
        (rootState === "warehouse" || rootState === "factory");
      return { ok: ok, detail: "aria-pressed=" + pressed + " root=" + rootState + " named=" + (name.length > 0) };
    });
    check("factory-mode-shows-production-group-and-places-a-component", function () {
      if (!haveApi || !API.plantMode || !API.library) return { ok: false, detail: "no plantMode/library API" };
      var PROD = (WT.library && WT.library.PRODUCTION) || "Production / Assembly";
      function hasGroup(label) {
        var found = false;
        document.querySelectorAll("#palette .pal-group-head").forEach(function (h) { if (h.dataset.group === label) found = true; });
        return found;
      }
      var original = API.plantMode.mode();
      // Warehouse HIDES the group.
      API.plantMode.set("warehouse");
      var hiddenInWarehouse = !hasGroup(PROD);
      var whRoot = document.documentElement.getAttribute("data-mode");
      // Factory SHOWS it + a manufacturing component is placeable.
      API.plantMode.set("factory");
      var shownInFactory = hasGroup(PROD);
      var facRoot = document.documentElement.getAttribute("data-mode");
      var before = API.state.elements.length;
      var lay = API.currentLayout();
      var placed = false;
      var spots = [[0, 0], [1, 1], [0, (lay.gridH || 10) - 1], [(lay.gridW || 10) - 2, 0]];
      for (var i = 0; i < spots.length && !placed; i++) {
        API.library.placeAt("mfg-source", spots[i][0], spots[i][1]);
        if (API.state.elements.length > before) placed = true;
      }
      var el = placed ? API.state.elements[API.state.elements.length - 1] : null;
      var typeOk = !!(el && el.type === "mfg-source");
      // cleanup: drop the placed instance + restore the profile's mode.
      if (el) API.state.elements = API.state.elements.filter(function (e) { return e.id !== el.id; });
      API.plantMode.set(original);
      API.library.buildPalette();
      API.render();
      var ok = hiddenInWarehouse && shownInFactory && placed && typeOk && whRoot === "warehouse" && facRoot === "factory";
      return { ok: ok, detail: "whHidden=" + hiddenInWarehouse + " facShown=" + shownInFactory + " placed=" + placed + " typeOk=" + typeOk };
    });
    check("factory-mode-part-flows-source-to-drain", function () {
      if (!WT.flowsim || typeof WT.flowsim.buildWaypoints !== "function") return { ok: false, detail: "no flowsim" };
      // A minimal production line: Source -> conveyor -> Station -> Drain. The
      // Part MU rides the EXISTING flow animation: the spine anchors receiving
      // at the Source and shipping at the Drain (deep line-sim deferred).
      var lay = { gridW: 22, gridH: 12, elements: [
        { id: "s1", type: "mfg-source", x: 1, y: 5, w: 2, d: 2 },
        { id: "c1", type: "conveyor", x: 3, y: 5, w: 9, d: 1 },
        { id: "m1", type: "mfg-station", x: 12, y: 4, w: 3, d: 2 },
        { id: "d1", type: "mfg-drain", x: 19, y: 5, w: 2, d: 2 },
      ] };
      var wp = WT.flowsim.buildWaypoints(lay);
      var recv = null, ship = null;
      for (var i = 0; i < wp.length; i++) { if (wp[i].stage === "receiving") recv = wp[i]; if (wp[i].stage === "shipping") ship = wp[i]; }
      var srcOk = !!recv && recv.x < 7;   // receiving anchored at the Source (left)
      var drnOk = !!ship && ship.x > 15;  // shipping anchored at the Drain (right)
      return { ok: srcOk && drnOk && wp.length >= 5, detail: "recv.x=" + (recv && recv.x) + " ship.x=" + (ship && ship.x) + " wps=" + wp.length };
    });

    // ---- v3.4 FACTORY-A2: flow-geometry components place + render + animate -
    // The eight new Siemens-style flow-geometry types (Converter / Angular-
    // Converter / Turntable / Turnplate / FlowControl / Cycle / Track /
    // TwoLaneTrack) are registered with a declared base (conveyor/transporter)
    // + 0 capacity, RENDER on a REAL canvas at the zoomed-in tier without
    // throwing, the turntable's rotation MOVES across anim phases, and one
    // places through the SAME library.placeAt path the palette uses.
    check("flow-geometry-components-place-and-render", function () {
      var S = WT.shapes, DM = WT.domain;
      if (!S || !DM) return { ok: false, detail: "shapes/domain missing" };
      var A2 = ["converter", "angular-converter", "turntable", "turnplate", "flow-control", "cycle", "track", "two-lane-track"];
      var registered = A2.every(function (t) { return S.has(t) === true && !!DM.ELEMENTS[t]; });
      var zeroCap = A2.every(function (t) { var def = DM.ELEMENTS[t] || {}; return DM.elementCapacity({ type: t, w: def.w, d: def.d }) === 0; });
      var basedOk = DM.elementBase("turntable") === "conveyor" && DM.elementBase("track") === "transporter";
      var drewOk = true;
      try {
        var cv = document.createElement("canvas"); cv.width = 240; cv.height = 240;
        var g = cv.getContext("2d");
        A2.forEach(function (t) {
          var def = DM.ELEMENTS[t];
          S.draw2D(g, t, { x: 10, y: 10, w: def.w * 30, d: def.d * 30, cellPx: 30, color: def.color, theme: "light", lod: 60, anim: 0.3, seed: 3 });
        });
      } catch (e) { drewOk = false; }
      // the turntable rotation moves its through-track bar across phases. Use a
      // QUARTER turn apart (0.0 -> horizontal, 0.25 -> vertical): the diametric
      // bar is symmetric under a HALF turn, so 0/0.25 (not 0/0.5) reads distinct.
      function turnFrame(a) {
        var def = DM.ELEMENTS["turntable"], cv2 = document.createElement("canvas");
        cv2.width = 130; cv2.height = 130;
        S.draw2D(cv2.getContext("2d"), "turntable", { x: 8, y: 8, w: def.w * 24, d: def.d * 24, cellPx: 24, color: def.color, theme: "light", lod: 44, anim: a });
        return cv2.toDataURL();
      }
      var rotates = turnFrame(0.0) !== turnFrame(0.25);
      // place a turntable through the library path (its group is always visible)
      var placed = false, typeOk = false;
      if (haveApi && API.library && typeof API.library.placeAt === "function") {
        var before = API.state.elements.length;
        var lay = API.currentLayout();
        var spots = [[0, 0], [1, 1], [0, (lay.gridH || 10) - 3], [(lay.gridW || 10) - 3, 0]];
        for (var i = 0; i < spots.length && !placed; i++) {
          API.library.placeAt("turntable", spots[i][0], spots[i][1]);
          if (API.state.elements.length > before) placed = true;
        }
        var el = placed ? API.state.elements[API.state.elements.length - 1] : null;
        typeOk = !!(el && el.type === "turntable");
        if (el) API.state.elements = API.state.elements.filter(function (e) { return e.id !== el.id; });
        API.render();
      } else { placed = true; typeOk = true; } // no API -> render + registry checks still gate
      return {
        ok: registered && zeroCap && basedOk && drewOk && rotates && placed && typeOk,
        detail: "reg=" + registered + " cap0=" + zeroCap + " base=" + basedOk + " drew=" + drewOk + " rotates=" + rotates + " placed=" + placed + " typeOk=" + typeOk,
      };
    });

    // ---- v3.7 FLUIDS: process-industry components place + render + animate -
    // The seven new Siemens-style Fluids / Process types (Pipe / FluidSource /
    // FluidDrain / Tank / Mixer / Portioner / DePortioner) are registered with a
    // declared base (conveyor/dock/storage/station) + 0 capacity (all category
    // "flow", including the Tank - it holds FLUID, not pallets), RENDER on a
    // REAL canvas at the zoomed-in tier without throwing, the tank fill level +
    // mixer agitator MOVE across anim phases, and one places through the SAME
    // library.placeAt path the palette uses. Continuous-flow physics is
    // illustrative / deferred (honest) - this gates the placeable + render path.
    check("fluids-process-components-place-and-render", function () {
      var S = WT.shapes, DM = WT.domain;
      if (!S || !DM) return { ok: false, detail: "shapes/domain missing" };
      var FL = ["pipe", "fluid-source", "fluid-drain", "tank", "mixer", "portioner", "deportioner"];
      var registered = FL.every(function (t) { return S.has(t) === true && !!DM.ELEMENTS[t]; });
      var zeroCap = FL.every(function (t) { var def = DM.ELEMENTS[t] || {}; return DM.elementCapacity({ type: t, w: def.w, d: def.d }) === 0; });
      var basedOk = DM.elementBase("pipe") === "conveyor" && DM.elementBase("fluid-source") === "dock" &&
        DM.elementBase("tank") === "storage" && DM.elementBase("mixer") === "station";
      // the Tank declares base "storage" yet holds FLUID (capacityM3), not pallets.
      var tank = DM.ELEMENTS["tank"] || {};
      var tankFluid = tank.fluid === true && typeof tank.capacityM3 === "number" && typeof tank.fillPct === "number";
      var drewOk = true;
      try {
        var cv = document.createElement("canvas"); cv.width = 240; cv.height = 240;
        var g = cv.getContext("2d");
        FL.forEach(function (t) {
          var def = DM.ELEMENTS[t];
          S.draw2D(g, t, { x: 10, y: 10, w: def.w * 30, d: def.d * 30, cellPx: 30, color: def.color, theme: "light", lod: 60, anim: 0.3, seed: 4 });
        });
      } catch (e) { drewOk = false; }
      // the tank fill level bobs + the mixer agitator spins - each moves its part.
      function frame(t, a) {
        var def = DM.ELEMENTS[t], c2 = document.createElement("canvas");
        c2.width = 140; c2.height = 140;
        S.draw2D(c2.getContext("2d"), t, { x: 8, y: 8, w: def.w * 24, d: def.d * 24, cellPx: 24, color: def.color, theme: "light", lod: 44, anim: a });
        return c2.toDataURL();
      }
      var animates = frame("tank", 0.05) !== frame("tank", 0.55) && frame("mixer", 0.0) !== frame("mixer", 0.25);
      // place a pipe through the library path (its group is shown in Factory mode).
      var placed = false, typeOk = false;
      if (haveApi && API.library && typeof API.library.placeAt === "function") {
        var wasMode = API.plantMode ? API.plantMode.mode() : null;
        if (API.plantMode) API.plantMode.set("factory");
        var before = API.state.elements.length;
        var lay = API.currentLayout();
        var spots = [[0, 0], [1, 1], [0, (lay.gridH || 10) - 2], [(lay.gridW || 10) - 6, 0]];
        for (var i = 0; i < spots.length && !placed; i++) {
          API.library.placeAt("pipe", spots[i][0], spots[i][1]);
          if (API.state.elements.length > before) placed = true;
        }
        var el = placed ? API.state.elements[API.state.elements.length - 1] : null;
        typeOk = !!(el && el.type === "pipe");
        if (el) API.state.elements = API.state.elements.filter(function (e) { return e.id !== el.id; });
        if (API.plantMode && wasMode) API.plantMode.set(wasMode);
        if (API.library.buildPalette) API.library.buildPalette();
        API.render();
      } else { placed = true; typeOk = true; } // no API -> render + registry checks still gate
      return {
        ok: registered && zeroCap && basedOk && tankFluid && drewOk && animates && placed && typeOk,
        detail: "reg=" + registered + " cap0=" + zeroCap + " base=" + basedOk + " tankFluid=" + tankFluid + " drew=" + drewOk + " animates=" + animates + " placed=" + placed + " typeOk=" + typeOk,
      };
    });

    // ---- v2.6 FACTORY-B: GENERATE A WHOLE FACTORY (live) ---------------
    // Drive the REAL Generate handler in Factory mode for a factory profile:
    // it builds a complete production line (Source -> machining -> assembly
    // -> QA/pack -> Drain, straight + curved conveyors), the app RENDERS it,
    // and a finite flow pool DRAINS to completion (a Part travels the line
    // Source -> ... -> Drain). Restores the app to a warehouse example after.
    check("factory-generate-builds-line-renders-and-flows", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function") {
        return { ok: false, detail: "no plantMode/runGenerate API" };
      }
      if (!WT.generate || !WT.generate.factoryProfiles || !WT.flowsim) {
        return { ok: false, detail: "no factory generator / flowsim" };
      }
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("assembly-line"); // the REAL Generate handler
        var els = API.state.elements || [];
        function has(type) { return els.some(function (e) { return e.type === type; }); }
        function stationCount() {
          return els.filter(function (e) {
            var d = WT.domain.ELEMENTS[e.type]; return d && d.base === "station";
          }).length;
        }
        var builtLine = has("mfg-source") && has("mfg-drain") && stationCount() >= 1 &&
          has("conveyor") && has("conveyor-curve");
        API.render(); // renders without throwing (the error boundary would catch it)
        var rendered = els.length > 0;
        // A Part flows Source -> ... -> Drain: a finite pool drains to done.
        var lay = API.currentLayout();
        var units = 8;
        var s = WT.flowsim.state(lay, { seed: 9, loop: false, units: units });
        var guard = 0;
        while (!(s.completed === units && s.inflight === 0) && guard < 900) { WT.flowsim.step(s, 1); guard++; }
        var flowed = s.spawned === units && s.completed === units && s.inflight === 0;
        okAll = builtLine && rendered && flowed;
        detail = "line=" + builtLine + " rendered=" + rendered + " stations=" + stationCount() +
          " els=" + els.length + " flow(spawned=" + s.spawned + " completed=" + s.completed + " inflight=" + s.inflight + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        // Restore: warehouse mode + a warehouse example on the floor.
        try {
          API.plantMode.set(original);
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.5 IFC/BIM: EXPORT A GENERATED FACTORY -> WELL-FORMED IFC ----
    // Drive the REAL Generate handler in Factory mode, then export the layout
    // through WT.ifc (the SAME writer the IFC button uses) and assert the file
    // is well-formed (STEP framing + IfcProject + IFC4), covers the factory
    // components (one proxy per element + the MechClass behaviour class + the
    // ModelKind honesty flag + the process attributes) and is deterministic.
    // Schematic geometry from a synthetic model - NOT a certified BIM.
    // Restores the app to a warehouse example after.
    check("ifc-export-covers-factory-components-and-well-formed", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function") {
        return { ok: false, detail: "no plantMode/runGenerate API" };
      }
      if (!WT.ifc || typeof WT.ifc.generate !== "function") {
        return { ok: false, detail: "no WT.ifc" };
      }
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("assembly-line"); // the REAL Generate handler
        var lay = API.currentLayout();
        var els = lay.elements || [];
        var step = WT.ifc.generate(lay);
        var framed = step.indexOf("ISO-10303-21;") === 0 &&
          step.indexOf("END-ISO-10303-21;") !== -1 &&
          step.indexOf("FILE_SCHEMA(('IFC4'));") !== -1 &&
          step.indexOf("IFCPROJECT(") !== -1;
        var proxies = (step.match(/IFCBUILDINGELEMENTPROXY/g) || []).length;
        var proxyPerEl = proxies === els.length && els.length > 0;
        var baseEls = els.filter(function (e) {
          var d = WT.domain.ELEMENTS[e.type]; return d && d.base;
        }).length;
        var mech = (step.match(/'MechClass'/g) || []).length;
        var honesty = (step.match(/schematic-synthetic/g) || []).length;
        var factoryMeta = baseEls > 0 && mech === baseEls && honesty === baseEls &&
          step.indexOf("'EmitRatePerHr'") !== -1 && step.indexOf("'CycleSec'") !== -1;
        var clean = step.indexOf("undefined") === -1 && step.indexOf("NaN") === -1;
        var deterministic = WT.ifc.generate(lay) === step;
        okAll = framed && proxyPerEl && factoryMeta && clean && deterministic;
        detail = "framed=" + framed + " proxies=" + proxies + "/" + els.length +
          " factoryComponents=" + baseEls + " (mech=" + mech + " honesty=" + honesty + ")" +
          " clean=" + clean + " deterministic=" + deterministic;
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          API.plantMode.set(original);
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v2.7 FACTORY-C: GENERATE FACTORY -> LINE SIM -> METRICS RENDER --
    // Drive the REAL Generate handler in Factory mode, then assert the process
    // model + the deterministic line sim produce honest metrics AND the
    // Factory-line read-out renders them (headline throughput + the named
    // bottleneck, not the empty hint). Restores to a warehouse example after.
    check("factory-line-process-model-sim-and-metrics-render", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function") {
        return { ok: false, detail: "no plantMode/runGenerate API" };
      }
      if (!WT.process || typeof WT.process.metrics !== "function") {
        return { ok: false, detail: "no WT.process" };
      }
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("assembly-line"); // the REAL Generate handler
        var block = API.state.process;
        var blockOk = !!block && block.version === "wt-proc-1" &&
          block.operations.length >= 3 &&
          block.operations.every(function (o) {
            return API.state.elements.some(function (e) { return e.id === o.elementId; });
          });
        var m = WT.process.metrics(block);
        var utilOk = m && m.stations.every(function (s) { return s.utilisation >= 0 && s.utilisation <= 1; });
        var metricsOk = !!m && m.throughputPerHr > 0 && !!m.bottleneck && utilOk &&
          m.lineEfficiency >= 0 && m.lineEfficiency <= 1 && m.little.residualRel < 0.1 &&
          Math.abs(m.throughputPerHr - 3600 / m.bottleneck.effTimeSec) < 1e-3;
        API.renderProcessPanel();
        var head = document.getElementById("procHeadline");
        var txt = head ? (head.textContent || "") : "";
        var rendered = txt.indexOf("throughput") !== -1 && txt.indexOf(m.bottleneck.name) !== -1 &&
          txt.indexOf("Generate a factory line") === -1;
        okAll = blockOk && metricsOk && rendered;
        detail = "block=" + blockOk + " metrics=" + metricsOk + " rendered=" + rendered +
          " (tp=" + (m && m.throughputPerHr) + "/hr bottleneck=" + (m && m.bottleneck && m.bottleneck.name) +
          " little=" + (m && m.little.residualRel) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          API.plantMode.set(original);
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.17 FLOW-NET: multi-way proportional-flow routing -----------
    // The demo split/merge network resolves to the hand-computed flows AND
    // the existing factory read-out renders the flow-network rows (splits/
    // merges/arcs/conservation). Temporarily swaps state.process, restores.
    check("flownet-split-merge-demo-resolves-and-renders", function () {
      if (!WT.process || typeof WT.process.demoNetwork !== "function" ||
        typeof WT.process.resolveFlow !== "function" || typeof WT.process.metrics !== "function") {
        return { ok: false, detail: "no WT.process flow API" };
      }
      var okAll = false, detail = "";
      var prev = haveApi && API.state ? API.state.process : null;
      try {
        var block = WT.process.rebuild(WT.process.demoNetwork());
        var rf = WT.process.resolveFlow(block);
        var m = WT.process.metrics(block);
        var resolved = !!rf && rf.ok && rf.splits === 1 && rf.merges === 1 &&
          rf.conservation.ok === true && Math.abs(rf.nodes["op-pack"].inPerHr - 100) < 1e-9 &&
          Math.abs(rf.nodes["op-qaf"].inPerHr - 60) < 1e-9 && Math.abs(rf.nodes["op-qad"].inPerHr - 40) < 1e-9;
        var metricsOk = !!m && m.bottleneck.opId === "op-qad" &&
          Math.abs(m.throughputPerHr - 112.5) < 1e-6 && !!m.flow && m.flow.multiway === true;
        var rendered = true;
        if (haveApi && API.state && typeof API.renderProcessPanel === "function") {
          API.state.process = block;
          API.renderProcessPanel();
          var d = document.getElementById("procDetail");
          var txt = d ? (d.textContent || "") : "";
          rendered = txt.indexOf("Flow network") !== -1 && txt.indexOf("QA deep test") !== -1 &&
            txt.indexOf("conservation holds") !== -1;
        }
        okAll = resolved && metricsOk && rendered;
        detail = "resolved=" + resolved + " metrics=" + metricsOk + " rendered=" + rendered +
          " (tp=" + (m && m.throughputPerHr) + "/hr bottleneck=" + (m && m.bottleneck && m.bottleneck.name) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          if (haveApi && API.state) { API.state.process = prev; API.renderProcessPanel(); }
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.19 FLUIDS-FLOW: steady-state continuous-flow model ---------
    // The hand-computable demo network (two 40 m3/h supplies -> mixer ->
    // 200 m3 tank at 60% -> pipe capped 30 -> drain) resolves to the exact
    // analytical numbers AND the existing Factory line card renders the
    // fluids rows. Temporarily swaps state.elements, restores after.
    check("fluids-steady-state-demo-computes-and-renders", function () {
      if (!WT.fluids || typeof WT.fluids.analyze !== "function" ||
        typeof WT.fluids.demoLayout !== "function") {
        return { ok: false, detail: "no WT.fluids API" };
      }
      var okAll = false, detail = "";
      var prevEls = haveApi && API.state ? API.state.elements : null;
      try {
        var lay = WT.fluids.demoLayout();
        var r = WT.fluids.analyze(lay);
        var net = r.networks && r.networks[0];
        var tank = net && net.nodes["fl-tank"];
        var mix = net && net.nodes["fl-mix"];
        var solved = !!net && r.active === true && net.conservation.ok === true &&
          Math.abs(net.supplyM3h - 80) < 1e-9 && Math.abs(net.deliveredM3h - 30) < 1e-9 &&
          Math.abs(net.bufferedM3h - 50) < 1e-9 && Math.abs(net.curtailedM3h) < 1e-9 &&
          !!net.bottleneck && net.bottleneck.id === "fl-pipe" &&
          !!tank && Math.abs(tank.netFillM3h - 50) < 1e-9 && Math.abs(tank.timeToFullMin - 96) < 1e-9 &&
          !!mix && Math.abs(mix.inM3h - 80) < 1e-9 && Math.abs(mix.outM3h - 80) < 1e-9;
        var deterministic = JSON.stringify(r) === JSON.stringify(WT.fluids.analyze(WT.fluids.demoLayout()));
        var rendered = true;
        if (haveApi && API.state && typeof API.renderFluidsReadout === "function") {
          API.state.elements = lay.elements;
          API.renderFluidsReadout();
          var box = document.getElementById("fluidsReadout");
          var txt = box ? (box.textContent || "") : "";
          rendered = txt.indexOf("Fluid network") !== -1 && txt.indexOf("Bottleneck") !== -1 &&
            txt.indexOf("96 min") !== -1 && txt.indexOf("conservation holds") !== -1 &&
            txt.indexOf("NOT a validated process simulation") !== -1;
        }
        okAll = solved && deterministic && rendered;
        detail = "solved=" + solved + " deterministic=" + deterministic + " rendered=" + rendered +
          (net ? " (supply=" + net.supplyM3h + " delivered=" + net.deliveredM3h +
            " buffered=" + net.bufferedM3h + " fullIn=" + (tank && tank.timeToFullMin) + "min)" : "");
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          if (haveApi && API.state && prevEls) { API.state.elements = prevEls; API.renderFluidsReadout(); }
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // Collapse to base case: the CURRENT (non-fluids) layout yields NO
    // fluids network and an EMPTY read-out container - the existing panel
    // stays byte-identical for every layout without connected fluids.
    check("fluids-inert-on-non-fluid-layout", function () {
      if (!WT.fluids || typeof WT.fluids.analyze !== "function") {
        return { ok: false, detail: "no WT.fluids API" };
      }
      var okAll = false, detail = "";
      try {
        var model = haveApi && typeof API.fluidsModel === "function"
          ? API.fluidsModel()
          : WT.fluids.analyze({ elements: [] });
        var inert = !!model && model.active === false;
        var boxEmpty = true;
        if (haveApi && typeof API.renderFluidsReadout === "function") {
          API.renderFluidsReadout();
          var box = document.getElementById("fluidsReadout");
          boxEmpty = !!box && (box.innerHTML === "" || model.active === true);
        }
        okAll = inert && boxEmpty;
        detail = "inert=" + inert + " boxEmpty=" + boxEmpty +
          " (fluidCount=" + (model && model.fluidCount) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.20 FLUIDS-PERSIST: a per-element fluid rate override survives
    // the REAL serialize() -> deserialize() round-trip (the same pair the
    // Save/Load/localStorage/JSON-export flows use), while an element with
    // NO override serializes byte-identically to before. Restores state.
    check("fluids-override-persists-through-serialize", function () {
      if (!haveApi || typeof API.serializeLayout !== "function" ||
        typeof API.deserializeLayout !== "function" ||
        !WT.fluids || typeof WT.fluids.overridesOf !== "function") {
        return { ok: false, detail: "no serialize/deserialize API" };
      }
      var okAll = false, detail = "";
      var snapshot = null;
      try {
        snapshot = API.serializeLayout();
        // Pure helper shape: an override is picked up, a plain element is null.
        var pureOk = (function () {
          var ov = WT.fluids.overridesOf({ id: "p1", type: "pipe", x: 0, y: 0, w: 6, d: 1, flowRateM3h: 25 });
          var none = WT.fluids.overridesOf({ id: "p2", type: "pipe", x: 0, y: 0, w: 6, d: 1 });
          return !!ov && ov.flowRateM3h === 25 && none === null;
        })();
        // Real round-trip: push a pipe carrying an override, serialize,
        // pop it, and confirm the remaining serialize is byte-identical.
        API.state.elements.push({ id: "st-fluid-pipe", type: "pipe", x: 0, y: 0, w: 6, d: 1, flowRateM3h: 25 });
        var withOv = API.serializeLayout();
        var saved = null;
        for (var i = 0; i < withOv.elements.length; i++) {
          if (withOv.elements[i].id === "st-fluid-pipe") saved = withOv.elements[i];
        }
        var persisted = !!saved && saved.flowRateM3h === 25;
        API.state.elements.pop();
        var identical = JSON.stringify(API.serializeLayout().elements) ===
          JSON.stringify(snapshot.elements);
        // Load the override layout through the REAL deserialize().
        API.deserializeLayout(withOv);
        var live = null;
        for (var j = 0; j < API.state.elements.length; j++) {
          if (API.state.elements[j].id === "st-fluid-pipe") live = API.state.elements[j];
        }
        var restored = !!live && live.flowRateM3h === 25;
        okAll = pureOk && persisted && identical && restored;
        detail = "pure=" + pureOk + " persisted=" + persisted +
          " byteIdenticalWithoutOverride=" + identical + " restored=" + restored;
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try { if (snapshot) API.deserializeLayout(snapshot); } catch (_) { /* best effort */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.20 CRAFT-FLOW: the CRAFT placement's flow matrix F reads the
    // RESOLVED network flows (resolveFlow arc flows - 72/48 on the 60/40 QA
    // split) even when the STORED from-to rates are stale, and a plain
    // chain keeps the stored basis (byte-identical fallback, no flowBasis
    // key in its report).
    check("optimize-craft-F-from-resolved-flows", function () {
      if (!WT.generate || !WT.process || !WT.factoryOpt ||
        typeof WT.factoryOpt.buildFD !== "function" || typeof WT.factoryOpt.craft !== "function") {
        return { ok: false, detail: "no generate/process/factoryOpt API" };
      }
      var okAll = false, detail = "";
      try {
        var gen = WT.generate.generateFactoryLayout("machining-qa-split", { seed: 7 });
        var block = WT.process.sanitize(gen.process);
        // Stale stored rates on every non-source arc: the resolved flows must win.
        for (var i = 1; i < block.routing.length; i++) block.routing[i].unitsPerHr = 1;
        var layout = { elements: gen.elements, gridW: gen.gridW, gridH: gen.gridH, cell: 1 };
        var fd = WT.factoryOpt.buildFD(layout, block);
        var ix = {};
        fd.ids.forEach(function (id, k) { ix[id] = k; });
        var a06 = null, a04 = null;
        for (var r = 0; r < block.routing.length; r++) {
          if (block.routing[r].ratio === 0.6) a06 = block.routing[r];
          if (block.routing[r].ratio === 0.4) a04 = block.routing[r];
        }
        var resolvedOk = fd.flowBasis === "resolved" && !!a06 && !!a04 &&
          Math.abs(fd.F[ix[a06.from]][ix[a06.to]] - 72) < 1e-6 &&
          Math.abs(fd.F[ix[a04.from]][ix[a04.to]] - 48) < 1e-6;
        var c = WT.factoryOpt.craft(layout, block, { minAisleMetres: 0 });
        var craftOk = c.flowBasis === "resolved" && c.mhiAfter <= c.mhiBefore + 1e-9;
        // Plain-chain fallback: stored basis, no flowBasis key in the report.
        var chain = WT.process.derive(gen);
        var fd2 = WT.factoryOpt.buildFD(layout, chain);
        var c2 = WT.factoryOpt.craft(layout, chain, { minAisleMetres: 0 });
        var chainOk = fd2.flowBasis === "stored" && !("flowBasis" in c2);
        okAll = resolvedOk && craftOk && chainOk;
        detail = "resolvedF=" + resolvedOk + " craft=" + craftOk + " chainFallback=" + chainOk +
          (a06 ? " (F06=" + fd.F[ix[a06.from]][ix[a06.to]] + " F04=" + fd.F[ix[a04.from]][ix[a04.to]] + ")" : "");
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // Ratios that don't sum to ~1 are REJECTED with the friendly message
    // (module -> null metrics; panel -> the plain-language explanation).
    check("flownet-invalid-ratios-friendly-message", function () {
      if (!WT.process || typeof WT.process.validateFlow !== "function") {
        return { ok: false, detail: "no validateFlow" };
      }
      var okAll = false, detail = "";
      var prev = haveApi && API.state ? API.state.process : null;
      try {
        var bad = WT.process.rebuild(WT.process.demoNetwork());
        bad.routing[1].ratio = 0.5;
        bad.routing[2].ratio = 0.6; // sums to 1.1
        var v = WT.process.validateFlow(bad);
        var rejected = !v.ok && v.errors.length > 0 && v.errors[0].indexOf("sum") !== -1 &&
          WT.process.metrics(bad) === null;
        var rendered = true;
        if (haveApi && API.state && typeof API.renderProcessPanel === "function") {
          API.state.process = bad;
          API.renderProcessPanel();
          var h = document.getElementById("procHeadline");
          var txt = h ? (h.textContent || "") : "";
          rendered = txt.indexOf("does not resolve") !== -1 && txt.indexOf("sum") !== -1;
        }
        okAll = rejected && rendered;
        detail = "rejected=" + rejected + " rendered=" + rendered +
          (v && v.errors && v.errors[0] ? " msg=" + v.errors[0] : "");
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          if (haveApi && API.state) { API.state.process = prev; API.renderProcessPanel(); }
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // Collapse to base case: a plain-chain line takes the legacy path and
    // the network sim reproduces it BYTE-IDENTICALLY (existing scenarios
    // cannot change - no `flow` metric key, no `ratio` in the serialize).
    check("flownet-chain-collapse-byte-identical", function () {
      if (!WT.process || typeof WT.process.simulateFlow !== "function" ||
        typeof WT.process.derive !== "function") {
        return { ok: false, detail: "no simulateFlow/derive" };
      }
      try {
        var lay = { elements: [
          { id: "s", type: "mfg-source", x: 0, y: 0, w: 2, d: 2, zone: "receiving" },
          { id: "a", type: "mfg-station", x: 4, y: 0, w: 3, d: 2, zone: "storage" },
          { id: "j", type: "mfg-assembly", x: 9, y: 0, w: 4, d: 3, zone: "picking" },
          { id: "d", type: "mfg-drain", x: 15, y: 0, w: 2, d: 2, zone: "shipping" },
        ] };
        var lb = WT.process.derive(lay);
        var same = JSON.stringify(WT.process.simulate(lb)) === JSON.stringify(WT.process.simulateFlow(lb));
        var noFlowKey = WT.process.metrics(lb).flow === undefined;
        var noRatio = JSON.stringify(WT.process.sanitize(lb)).indexOf('"ratio"') === -1;
        var notMw = WT.process.isMultiway(lb) === false;
        return { ok: same && noFlowKey && noRatio && notMw,
          detail: "simEqual=" + same + " noFlowKey=" + noFlowKey + " noRatio=" + noRatio + " linear=" + notMw };
      } catch (e) {
        return { ok: false, detail: "threw: " + (e && e.message) };
      }
    });

    // ---- v3.18 FLOW-GEN: the GENERATOR emits a multi-way network -------
    // Generate the machining-qa-split baseline through the REAL Generate
    // handler and assert the adopted state.process IS the declared 60/40
    // split network (validateFlow ok, bottleneck QA deep test -> 112.5/hr)
    // and the existing factory read-out renders its flow-network rows.
    check("flowgen-qa-split-baseline-emits-multiway-network", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function") {
        return { ok: false, detail: "no generate API" };
      }
      if (!WT.process || !WT.generate || !WT.generate.factoryProfiles ||
        !WT.generate.factoryProfiles["machining-qa-split"]) {
        return { ok: false, detail: "no machining-qa-split profile" };
      }
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("machining-qa-split"); // the REAL Generate handler
        var block = API.state.process;
        var v = block ? WT.process.validateFlow(block) : { ok: false, multiway: false };
        var mw = !!block && WT.process.isMultiway(block) === true && v.ok && v.multiway;
        var m = block ? WT.process.metrics(block) : null;
        var metricsOk = !!m && m.bottleneck && m.bottleneck.name === "QA deep test" &&
          Math.abs(m.throughputPerHr - 112.5) < 1e-6 && !!m.flow && m.flow.multiway === true &&
          m.flow.splits === 1 && m.flow.merges === 1 && m.flow.conservation.ok === true;
        var d = document.getElementById("procDetail");
        var txt = d ? (d.textContent || "") : "";
        var rendered = txt.indexOf("Flow network") !== -1 && txt.indexOf("QA deep test") !== -1 &&
          txt.indexOf("conservation holds") !== -1;
        okAll = mw && metricsOk && rendered;
        detail = "multiway=" + mw + " metrics=" + metricsOk + " rendered=" + rendered +
          " (tp=" + (m && m.throughputPerHr) + "/hr bottleneck=" + (m && m.bottleneck && m.bottleneck.name) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          API.plantMode.set(original);
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.18 FLOW-BALANCE: RPW balances on resolved effective loads --
    // On the generated multi-way network, the balancer's loads are the
    // resolveFlow per-finished-unit times (total 141 s, packs to the
    // 3-station theoretical minimum, efficiency 0.47 -> 0.7833), and on a
    // pure chain it collapses to the legacy grouping ([T1] + [T2,T3]).
    check("flowbalance-rpw-on-effective-loads", function () {
      if (!WT.factoryOpt || typeof WT.factoryOpt.rpw !== "function" ||
        !WT.generate || typeof WT.generate.generateFactoryLayout !== "function" || !WT.process) {
        return { ok: false, detail: "no factoryOpt/generate API" };
      }
      try {
        var gen = WT.generate.generateFactoryLayout("machining-qa-split", { seed: 7 });
        if (!gen.process) return { ok: false, detail: "generator emitted no process block" };
        var r = WT.factoryOpt.rpw(WT.process.sanitize(gen.process));
        var mwOk = r.nStationsAfter === 3 && r.theoreticalMinStations === 3 &&
          Math.abs(r.totalCycleSec - 141) < 1e-3 &&
          Math.abs(r.lineEffAfter - 0.7833) < 1e-4 && r.lineEffAfter <= 1;
        var chain = WT.process.sanitize({
          version: "wt-proc-1", shiftSec: 40, demandPerShift: 1,
          operations: [
            { id: "t0", name: "src", elementId: "e0", kind: "source" },
            { id: "t1", name: "T1", elementId: "e1", kind: "station", cycleSec: 30, servers: 1 },
            { id: "t2", name: "T2", elementId: "e2", kind: "station", cycleSec: 20, servers: 1 },
            { id: "t3", name: "T3", elementId: "e3", kind: "station", cycleSec: 10, servers: 1 },
            { id: "t4", name: "snk", elementId: "e4", kind: "sink" },
          ],
          precedence: [["t0", "t1"], ["t1", "t2"], ["t2", "t3"], ["t3", "t4"]],
          routing: [{ from: "t0", to: "t1", unitsPerHr: 90 }, { from: "t1", to: "t2", unitsPerHr: 90 },
            { from: "t2", to: "t3", unitsPerHr: 90 }, { from: "t3", to: "t4", unitsPerHr: 90 }],
        });
        var rc = WT.factoryOpt.rpw(chain);
        var chainOk = rc.nStationsAfter === 2 && rc.stations[0].opIds.join(",") === "t1" &&
          rc.stations[1].opIds.join(",") === "t2,t3" && rc.lineEffAfter === 0.75;
        return { ok: mwOk && chainOk,
          detail: "multiway=" + mwOk + " (total=" + r.totalCycleSec + " stations=" + r.nStationsAfter +
            " eff=" + r.lineEffAfter + ") chainCollapse=" + chainOk };
      } catch (e) {
        return { ok: false, detail: "threw: " + (e && e.message) };
      }
    });

    // ---- v2.8 FACTORY-D: efficiency optimiser preview -> accept --------
    // Generate a factory line, run the REAL optimise handler (which renders
    // a before/after headline + dashed preview ghosts), then Accept and
    // assert the line was re-laid-out LEGALLY (in-bounds, overlap-free, aisle
    // count NOT increased) and that placement actually moved the stations.
    check("factory-optimise-preview-accept-relays-out-legally", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function" ||
        typeof API.runFactoryOptimise !== "function" || typeof API.acceptFactoryOptimise !== "function") {
        return { ok: false, detail: "no optimise API" };
      }
      if (!WT.factoryOpt || !WT.domain) return { ok: false, detail: "no WT.factoryOpt/domain" };
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("assembly-line"); // the REAL Generate handler
        var lay0 = API.currentLayout();
        var gw = lay0.gridW, gh = lay0.gridH;
        var minAisle = API.state.config.minAisleMetres;
        function legal(els) {
          for (var i = 0; i < els.length; i++) {
            var e = els[i];
            if (!(e.x >= 0 && e.y >= 0 && e.x + e.w <= gw && e.y + e.d <= gh)) return false;
          }
          for (var a = 0; a < els.length; a++) for (var b = a + 1; b < els.length; b++) {
            var p = els[a], q = els[b];
            if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.d && q.y < p.y + p.d) return false;
          }
          return true;
        }
        var aisleBefore = WT.domain.aisleViolations(API.state.elements, minAisle).length;
        var pos0 = {};
        API.state.elements.forEach(function (e) { pos0[e.id] = e.x + "," + e.y; });
        // Run the REAL preview handler: headline into #procOptOut + ghosts.
        API.runFactoryOptimise();
        var out = document.getElementById("procOptOut");
        var txt = out ? (out.textContent || "") : "";
        var opt = API.lastOptResult();
        var previewOk = !!opt && opt.ok && txt.indexOf("→") !== -1 && // an arrow (before -> after)
          /line efficiency/i.test(txt) && !!document.getElementById("procOptAccept") &&
          opt.placement.mhiAfter <= opt.placement.mhiBefore + 1e-6;
        var movedExpected = opt ? opt.placement.movedCount : 0;
        // Accept -> apply the placement to the real layout.
        API.acceptFactoryOptimise(opt);
        var afterLegal = legal(API.state.elements) &&
          WT.domain.aisleViolations(API.state.elements, minAisle).length <= aisleBefore;
        var moved = 0;
        API.state.elements.forEach(function (e) { if (pos0[e.id] !== e.x + "," + e.y) moved++; });
        var relayedOut = movedExpected === 0 ? moved === 0 : moved === movedExpected;
        var procStillValid = !!API.state.process && API.state.process.operations.length >= 3 &&
          API.state.process.operations.every(function (o) {
            return API.state.elements.some(function (e) { return e.id === o.elementId; });
          });
        okAll = previewOk && afterLegal && relayedOut && procStillValid;
        detail = "preview=" + previewOk + " legalAfter=" + afterLegal + " moved=" + moved +
          "/" + movedExpected + " procValid=" + procStillValid +
          " (MHI " + (opt && opt.placement.mhiBefore) + "->" + (opt && opt.placement.mhiAfter) +
          ", eff " + (opt && opt.balance.lineEffBefore) + "->" + (opt && opt.balance.lineEffAfter) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try {
          API.plantMode.set(original);
          var ex = WT.examples && WT.examples.library && WT.examples.library[0];
          if (ex) API.loadExample(ex.id);
        } catch (_) { /* best-effort restore */ }
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.1 ANALYTICS A1: the Analyze panel (Bottleneck + Sankey) -----
    // Drive the REAL Analyze handler (the SAME one the button fires) in BOTH
    // modes and assert it renders: the headline names the constraint, the
    // bottleneck ranking flags it, the Sankey draws an <svg> - and the named
    // constraint matches the sim/process the app already runs (can't diverge).
    check("analyze-panel-factory-bottleneck-and-sankey-render-and-match-sim", function () {
      if (!haveApi || !API.plantMode || typeof API.runGenerate !== "function" ||
        typeof API.renderAnalyzePanel !== "function") {
        return { ok: false, detail: "no analyze API" };
      }
      if (!WT.analytics || !WT.process) return { ok: false, detail: "no WT.analytics/process" };
      var original = API.plantMode.mode();
      var okAll = false, detail = "";
      try {
        API.plantMode.set("factory");
        API.runGenerate("assembly-line"); // the REAL Generate handler
        var m = WT.process.metrics(API.state.process);
        API.renderAnalyzePanel(); // the REAL Analyze handler
        var head = document.getElementById("analyzeHeadline");
        var bott = document.getElementById("analyzeBottleneck");
        var sank = document.getElementById("analyzeSankey");
        var headTxt = head ? (head.textContent || "") : "";
        var bottTxt = bott ? (bott.textContent || "") : "";
        var bottHtml = bott ? (bott.innerHTML || "") : "";
        var sankHtml = sank ? (sank.innerHTML || "") : "";
        var headOk = headTxt.indexOf("throughput") !== -1 && headTxt.indexOf(m.bottleneck.name) !== -1 &&
          headTxt.indexOf("Press") === -1;
        var bottOk = bottTxt.indexOf("constraint") !== -1 && bottTxt.indexOf(m.bottleneck.name) !== -1 &&
          /<svg/.test(bottHtml) && /class="an-table"/.test(bottHtml);
        var sankOk = /<svg/.test(sankHtml) && /<path/.test(sankHtml);
        var mdl = API.analyzeModel();
        var matchOk = !!mdl && mdl.mode === "factory" && mdl.bottleneck.constraint.id === m.bottleneck.opId &&
          mdl.bottleneck.resources[0].id === m.bottleneck.opId;
        okAll = headOk && bottOk && sankOk && matchOk;
        detail = "head=" + headOk + " bottleneck=" + bottOk + " sankey=" + sankOk + " matchesSim=" + matchOk +
          " (constraint=" + (mdl && mdl.bottleneck.constraint.name) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      } finally {
        try { API.plantMode.set(original); } catch (_) { /* best-effort */ }
      }
      return { ok: okAll, detail: detail };
    });

    check("analyze-panel-warehouse-bottleneck-and-sankey-render-and-match-sim", function () {
      if (!haveApi || typeof API.renderAnalyzePanel !== "function" || typeof API.analyzeModel !== "function") {
        return { ok: false, detail: "no analyze API" };
      }
      if (!WT.analytics || !WT.wms) return { ok: false, detail: "no WT.analytics/wms" };
      var okAll = false, detail = "";
      try {
        // A warehouse example (no process block) -> the warehouse flow path.
        var ex = WT.examples && WT.examples.library && WT.examples.library[0];
        if (ex && typeof API.loadExample === "function") API.loadExample(ex.id);
        var mdl = API.analyzeModel();
        API.renderAnalyzePanel();
        var head = document.getElementById("analyzeHeadline");
        var sank = document.getElementById("analyzeSankey");
        var headTxt = head ? (head.textContent || "") : "";
        var sankHtml = sank ? (sank.innerHTML || "") : "";
        var renderedOk = mdl && mdl.mode === "warehouse" &&
          headTxt.indexOf(mdl.bottleneck.constraint.name) !== -1 && /<svg/.test(sankHtml);
        // The named constraint === the WMS flow sim's bottleneck stage (can't diverge).
        var matchOk = false;
        if (mdl) {
          var r0 = mdl.bottleneck.resources[0];
          matchOk = r0.isConstraint && r0.id === mdl.bottleneck.constraint.id;
        }
        okAll = !!renderedOk && matchOk;
        detail = "mode=" + (mdl && mdl.mode) + " rendered=" + !!renderedOk + " matchesSim=" + matchOk +
          " (constraint=" + (mdl && mdl.bottleneck.constraint.name) + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.2: the Cost + Energy analyzers render, and editing an
    // illustrative rate updates the total (view-only, layout untouched). ----
    check("analyze-cost-and-energy-render-and-rate-edit-updates-total", function () {
      if (!haveApi || typeof API.renderCostPanel !== "function" ||
        typeof API.renderEnergyPanel !== "function" || typeof API.renderAnalyzePanel !== "function") {
        return { ok: false, detail: "no cost/energy API" };
      }
      if (!WT.analytics || typeof WT.analytics.costModel !== "function") return { ok: false, detail: "no WT.analytics cost API" };
      var okAll = false, detail = "";
      try {
        // A warehouse example (no process block) -> the warehouse flow path.
        var ex = WT.examples && WT.examples.library && WT.examples.library[0];
        if (ex && typeof API.loadExample === "function") API.loadExample(ex.id);
        API.renderAnalyzePanel(); // renders the whole Analyze card incl. cost + energy
        var cost = document.getElementById("analyzeCost");
        var energy = document.getElementById("analyzeEnergy");
        var costHtml = cost ? (cost.innerHTML || "") : "";
        var energyHtml = energy ? (energy.innerHTML || "") : "";
        // Both headline figures + an editable-rate input rendered.
        var costOk = /an-figure-val/.test(costHtml) && /per\s/.test((cost && cost.textContent) || "") &&
          /data-rate="energyPricePerKWh"/.test(costHtml);
        var energyOk = /kWh/.test(energyHtml) && /data-equip=/.test(energyHtml) && /CO/.test((energy && energy.textContent) || "");
        // Serialize BEFORE the edit -> proves the edit is view-only.
        var serBefore = (typeof API.serialize === "function") ? API.serialize() :
          JSON.stringify(API.currentLayout ? API.currentLayout() : null);
        // Read the total, edit the €/kWh rate up, and confirm the total moves.
        var kwhInput = cost.querySelector('input[data-rate="energyPricePerKWh"]');
        var totalBefore = cost.querySelector(".an-figure-val");
        var tb = totalBefore ? totalBefore.textContent : "";
        var moved = false;
        if (kwhInput) {
          kwhInput.value = String((Number(kwhInput.value) || 0.3) * 5 + 1);
          kwhInput.dispatchEvent(new Event("change", { bubbles: true }));
          var ta = cost.querySelector(".an-figure-val");
          moved = !!ta && ta.textContent !== tb;
        }
        var serAfter = (typeof API.serialize === "function") ? API.serialize() :
          JSON.stringify(API.currentLayout ? API.currentLayout() : null);
        var layoutSame = serBefore === serAfter;
        okAll = costOk && energyOk && moved && layoutSame;
        detail = "cost=" + costOk + " energy=" + energyOk + " totalMovedOnEdit=" + moved + " layoutUnchanged=" + layoutSame;
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.3 A3: the consolidated report's ANALYSIS SUITE section is
    // present AND equals the "Analyze" panels (can't drift). Build the report
    // via the SAME handler the button uses, render the Analyze panel, and
    // assert the report's bottleneck + sankey EQUAL the panel model; the
    // cost/energy figures are present + internally consistent; the printable
    // HTML carries the section + inline figures. ----------------------------
    check("report-analytics-section-present-and-equals-panels", function () {
      if (!haveApi || typeof API.buildCurrentReport !== "function" ||
        typeof API.analyzeModel !== "function" || typeof API.renderAnalyzePanel !== "function") {
        return { ok: false, detail: "no analyze/report API" };
      }
      if (!WT.report || !WT.analytics) return { ok: false, detail: "no WT.report/analytics" };
      var okAll = false, detail = "";
      try {
        // A warehouse example (no process block) -> the warehouse flow path.
        var ex = WT.examples && WT.examples.library && WT.examples.library[0];
        if (ex && typeof API.loadExample === "function") API.loadExample(ex.id);
        API.renderAnalyzePanel(); // the panel model the report must equal
        var panel = API.analyzeModel();
        var rep = API.buildCurrentReport();
        var a = rep && rep.analytics;
        var present = !!a && a.available === true && a.mode === "warehouse";
        // Bottleneck + sankey EQUAL the panel model (rates-independent).
        var bottleneckMatch = present && !!panel && panel.mode === "warehouse" &&
          a.bottleneck.constraint.id === panel.bottleneck.constraint.id &&
          a.bottleneck.headline === panel.bottleneck.headline &&
          a.bottleneck.resources.length === panel.bottleneck.resources.length;
        var sankeyMatch = present && a.sankey.maxVolume === panel.sankey.maxVolume &&
          a.sankey.links.length === panel.sankey.links.length;
        // Cost + energy present + the per-unit identity holds (total/throughput).
        var costOk = present && a.cost && a.cost.totalCost > 0 &&
          Math.abs(a.cost.perUnit * a.cost.throughput - a.cost.totalCost) < 1e-6;
        var energyOk = present && a.energy && a.energy.totalKWh >= 0 &&
          Math.abs(a.energy.perUnit * a.energy.throughput - a.energy.totalKWh) < 1e-3;
        // The printable HTML carries the section + inline SVG figures.
        var html = WT.report.toHtml(rep);
        var htmlOk = html.indexOf("Analysis suite (bottleneck, flow, cost, energy)") !== -1 &&
          (html.match(/<svg/g) || []).length >= 3;
        okAll = present && bottleneckMatch && sankeyMatch && costOk && energyOk && htmlOk;
        detail = "present=" + present + " bottleneck=" + bottleneckMatch + " sankey=" + sankeyMatch +
          " cost=" + costOk + " energy=" + energyOk + " html=" + htmlOk +
          " (constraint=" + (present ? a.bottleneck.constraint.name : "-") + ")";
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.3 A4: the honest "How we compare" page is folded into About,
    // names the suites factually, carries the disclaimer + framing, and has
    // NO "beats/superior/no-competition" boast tokens. ----------------------
    check("about-how-we-compare-present-and-honest", function () {
      if (!WT.howwecompare || typeof WT.howwecompare.html !== "function") {
        return { ok: false, detail: "no WT.howwecompare" };
      }
      var okAll = false, detail = "";
      try {
        if (haveApi && typeof API.openAbout === "function") API.openAbout();
        var body = $("aboutBody");
        var bodyHtml = body ? (body.innerHTML || "") : "";
        var page = WT.howwecompare.html();
        var inAbout = bodyHtml.indexOf("How we compare") !== -1 && /Plant Simulation/.test(bodyHtml);
        var names = /Plant Simulation/.test(page) && /FlexSim/.test(page) && /AnyLogic/.test(page);
        var honest = /independent comparison/i.test(page) && /use this app/i.test(page) &&
          /commercial suites/i.test(page);
        var banned = /\bbeats\b/i.test(page) || /\bsuperior\b/i.test(page) || /no[\s-]?competition/i.test(page);
        var sourced = /10,000/.test(page) && /subscription-only/i.test(page);
        if (haveApi && typeof API.closeAbout === "function") API.closeAbout();
        okAll = inAbout && names && honest && sourced && !banned;
        detail = "inAbout=" + inAbout + " names=" + names + " honest=" + honest +
          " sourced=" + sourced + " bannedTokens=" + banned;
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.6 UI-3: the Ctrl/Cmd-K COMMAND PALETTE opens on the real global
    // shortcut, filtering narrows the list, Enter runs a command, Esc closes;
    // and the model is built from the real registries (every component has an
    // Add command; core actions + a Generate command present). ----------------
    check("cmdk-palette-open-filter-run-close", function () {
      if (!haveApi || !API.commandPalette) return { ok: false, detail: "no command-palette API" };
      var CP = API.commandPalette;
      var overlay = $("cmdPalette"), input = $("cmdPaletteInput"), list = $("cmdPaletteList");
      if (!overlay || !input || !list) return { ok: false, detail: "palette DOM missing" };
      function key(target, opts) {
        var ev;
        try { ev = new KeyboardEvent("keydown", opts); }
        catch (e) {
          ev = document.createEvent("Event"); ev.initEvent("keydown", true, true);
          try { ev.key = opts.key; ev.ctrlKey = !!opts.ctrlKey; } catch (_) { /* read-only */ }
        }
        target.dispatchEvent(ev);
      }
      var okAll = false, detail = "";
      try {
        CP.close();
        // 1) Ctrl-K opens via the REAL global shortcut (dispatched on window).
        key(window, { key: "k", ctrlKey: true, bubbles: true });
        var opened = CP.isOpen() && overlay.hidden === false;
        var full = list.querySelectorAll(".cmdk-opt").length;
        // 2) typing narrows the list.
        input.value = "analyze";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        var narrowed = list.querySelectorAll(".cmdk-opt").length;
        var filters = opened && full > 0 && narrowed > 0 && narrowed < full;
        // 3) Esc closes.
        key(input, { key: "Escape", bubbles: true });
        var escClosed = !CP.isOpen() && overlay.hidden === true;
        // 4) reopen, filter to a safe command, Enter runs it + closes.
        key(window, { key: "k", ctrlKey: true, bubbles: true });
        input.value = "fit view";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        var hasHit = list.querySelectorAll(".cmdk-opt").length > 0;
        key(input, { key: "Enter", bubbles: true });
        var enterClosed = !CP.isOpen() && overlay.hidden === true;
        // model: built from the real registries.
        var cmds = CP.commands();
        var addCount = cmds.filter(function (c) { return c.kind === "place"; }).length;
        var genOk = cmds.some(function (c) { return c.kind === "generate"; });
        var coreOk = cmds.some(function (c) { return c.id === "act:analyze"; }) &&
                     cmds.some(function (c) { return c.id === "act:export-ifc"; });
        okAll = opened && filters && escClosed && hasHit && enterClosed && addCount > 0 && genOk && coreOk;
        detail = "opened=" + opened + " full=" + full + " narrowed=" + narrowed +
          " escClosed=" + escClosed + " enterClosed=" + enterClosed +
          " addCmds=" + addCount + " gen=" + genOk + " core=" + coreOk;
      } catch (e) {
        detail = "threw: " + (e && e.message);
      }
      return { ok: okAll, detail: detail };
    });

    // ---- v3.8 REDESIGN-1: canvas-hero EMPTY-STATE + big empty walled hall.
    // The overlay exposes the THREE starting actions (+ three hall-size presets),
    // is shown ONLY when the floor is empty, "Start empty hall" gives a big empty
    // WALLED room, and drag-placing an item populates the floor + hides the
    // overlay. Restores to a normal example afterwards so later state is clean.
    check("empty-state-3-actions-then-empty-hall-then-drag-place", function () {
      if (!haveApi || !API.emptyState || !API.library) {
        return { ok: false, detail: "no emptyState/library API" };
      }
      var ES = API.emptyState;
      var overlay = $("emptyState");
      if (!overlay) return { ok: false, detail: "no #emptyState overlay" };
      // 1) the three primary actions + three hall-size presets exist + are labelled
      var ids = ["emptyHallBtn", "emptyGenerateBtn", "emptyExampleBtn",
                 "emptyHallMediumBtn", "emptyHallLargeBtn", "emptyHallHugeBtn"];
      var allPresent = ids.every(function (id) {
        var b = $(id);
        return b && (b.textContent || b.getAttribute("aria-label") || b.title || "").trim().length > 0;
      });
      var libFirst = WT.examples && WT.examples.library && WT.examples.library[0];
      // 2) "Start empty hall" (Medium preset) -> a big empty WALLED room, overlay shown
      ES.startHall(ES.presets.medium.w, ES.presets.medium.h);
      var floor = ES.floor();
      var emptyNow = API.state.elements.length === 0;
      var shownWhenEmpty = ES.shown() && overlay.hidden === false;
      var band = ES.wallBand();
      var walled = !!band && Array.isArray(band.segments) && band.segments.length === 4 && band.thickness > 0;
      var bigHall = floor.gridW >= 100 && floor.gridH >= 60;
      // 3) drag-place a component (the SAME placeAt a pointer drop uses) -> populated
      var before = API.state.elements.length;
      var placed = false;
      var spots = [[2, 2], [1, 1], [0, 0]];
      for (var i = 0; i < spots.length && !placed; i++) {
        API.library.placeAt("selective-racking", spots[i][0], spots[i][1]);
        if (API.state.elements.length > before) placed = true;
      }
      API.render();
      var hiddenWhenPopulated = ES.shown() === false && overlay.hidden === true;
      // restore: reload a real example so the app + later state are normal
      if (libFirst) API.loadExample(libFirst.id);
      API.fitToFloor();
      API.render();
      var ok = allPresent && emptyNow && shownWhenEmpty && walled && bigHall && placed && hiddenWhenPopulated;
      return {
        ok: ok,
        detail: "actions=" + allPresent + " empty=" + emptyNow + " shownEmpty=" + shownWhenEmpty +
          " walled=" + walled + " hall=" + floor.gridW + "x" + floor.gridH +
          " placed=" + placed + " hiddenPop=" + hiddenWhenPopulated,
      };
    });

    // ---- v3.9 REDESIGN-2 / v3.13 MULTI-OPEN: slim ICON RAIL + FLYOUT DRAWERS -
    // The de-clutter: a slim rail of labelled icon buttons; clicking one TOGGLES
    // its flyout drawer. v3.13: the user can keep AS MANY drawers open at once
    // as they like - opening a 2nd leaves the 1st OPEN; toggling / X / focused-
    // Esc closes only that ONE drawer, the rest stay open. The existing cards
    // were RE-HOMED into the drawers, so every previously-verified control
    // still exists inside its drawer.
    check("rail-renders-labelled-icon-buttons", function () {
      var rail = document.getElementById("wtRail");
      var btns = rail ? rail.querySelectorAll(".wt-rail-btn") : [];
      var n = btns.length;
      var allLabelled = n > 0;
      var allIconed = n > 0;
      for (var i = 0; i < n; i++) {
        if (!btns[i].getAttribute("aria-label")) allLabelled = false;
        if (!btns[i].querySelector(".wt-rail-ico svg")) allIconed = false;
      }
      return { ok: !!rail && n >= 10 && allLabelled && allIconed,
        detail: "rail=" + !!rail + " buttons=" + n + " labelled=" + allLabelled + " iconed=" + allIconed };
    });

    check("rail-click-opens-its-drawer", function () {
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      if (!libBtn) return { ok: false, detail: "no library rail button" };
      libBtn.click();
      var host = document.getElementById("wtDrawerHost");
      var panel = document.querySelector('.wt-drawer[data-drawer="library"]');
      var open = !!panel && panel.classList.contains("open") && !panel.hidden;
      var hostShown = !!host && !host.hidden;
      var expanded = libBtn.getAttribute("aria-expanded") === "true";
      var hasPalette = !!(panel && panel.querySelector("#palette"));
      return { ok: open && hostShown && expanded && hasPalette,
        detail: "open=" + open + " hostShown=" + hostShown + " aria-expanded=" + expanded + " containsPalette=" + hasPalette };
    });

    // v3.13: opening a SECOND drawer must leave the FIRST open (multi-open),
    // and each rail icon reflects its OWN drawer's state (aria-expanded +
    // aria-pressed + .active) independently.
    check("rail-multiple-drawers-open-at-once", function () {
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var genBtn = document.querySelector('#wtRail [data-drawer="generate"]');
      if (!libBtn || !genBtn) return { ok: false, detail: "missing library/generate rail button" };
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      var gen = document.querySelector('.wt-drawer[data-drawer="generate"]');
      if (!lib.classList.contains("open")) libBtn.click(); // ensure Library open (first)
      if (!gen.classList.contains("open")) genBtn.click(); // open Generate (second)
      var libOpen = lib.classList.contains("open") && !lib.hidden;
      var genOpen = gen.classList.contains("open") && !gen.hidden;
      var libState = libBtn.getAttribute("aria-expanded") === "true" && libBtn.getAttribute("aria-pressed") === "true";
      var genState = genBtn.getAttribute("aria-expanded") === "true" && genBtn.getAttribute("aria-pressed") === "true";
      var genHasBtn = !!(gen && gen.querySelector("#genBtn"));
      return { ok: libOpen && genOpen && libState && genState && genHasBtn,
        detail: "libraryStillOpen=" + libOpen + " generateOpen=" + genOpen +
          " libIconOn=" + libState + " genIconOn=" + genState + " containsGenBtn=" + genHasBtn };
    });

    // v3.13: toggling a rail icon closes ONLY its own drawer - the others stay
    // open (this is the key multi-open behaviour).
    check("rail-toggle-closes-only-its-own-drawer", function () {
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var genBtn = document.querySelector('#wtRail [data-drawer="generate"]');
      if (!libBtn || !genBtn) return { ok: false, detail: "missing library/generate rail button" };
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      var gen = document.querySelector('.wt-drawer[data-drawer="generate"]');
      if (!lib.classList.contains("open")) libBtn.click();
      if (!gen.classList.contains("open")) genBtn.click();
      genBtn.click(); // toggle Generate CLOSED - Library must remain open
      var genClosed = !gen.classList.contains("open") && gen.hidden &&
        genBtn.getAttribute("aria-expanded") === "false" && genBtn.getAttribute("aria-pressed") === "false";
      var libStillOpen = lib.classList.contains("open") && !lib.hidden &&
        libBtn.getAttribute("aria-expanded") === "true";
      return { ok: genClosed && libStillOpen,
        detail: "generateClosed=" + genClosed + " libraryStillOpen=" + libStillOpen };
    });

    // v3.13: Esc closes only the FOCUSED drawer; other open drawers stay put and
    // the host stays visible while any drawer remains open.
    check("rail-esc-closes-focused-drawer-only", function () {
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var genBtn = document.querySelector('#wtRail [data-drawer="generate"]');
      if (!libBtn || !genBtn) return { ok: false, detail: "missing library/generate rail button" };
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      var gen = document.querySelector('.wt-drawer[data-drawer="generate"]');
      if (!lib.classList.contains("open")) libBtn.click();
      if (!gen.classList.contains("open")) genBtn.click();
      // focus INSIDE the Generate drawer, then Esc -> only Generate closes
      var focusTarget = gen.querySelector("button, input, select, textarea, [tabindex]") || gen;
      try { focusTarget.focus(); } catch (e) { /* headless focus best-effort */ }
      var ev;
      try { ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true }); }
      catch (e) { ev = document.createEvent("Event"); ev.initEvent("keydown", true, true); ev.key = "Escape"; }
      gen.dispatchEvent(ev);
      var host = document.getElementById("wtDrawerHost");
      var genClosed = !gen.classList.contains("open") && gen.hidden;
      var libStillOpen = lib.classList.contains("open") && !lib.hidden;
      var hostStillShown = !!host && !host.hidden; // Library still open => host visible
      // tidy up: close remaining drawers so later checks start from the rail's
      // resting (all-closed) state.
      if (haveApi && API.rail && API.rail.close) API.rail.close();
      return { ok: genClosed && libStillOpen && hostStillShown,
        detail: "generateClosed=" + genClosed + " libraryStillOpen=" + libStillOpen + " hostShown=" + hostStillShown };
    });

    check("rail-relocated-controls-preserved-in-drawers", function () {
      var probes = ["palette", "genBtn", "exampleList", "simCard", "analyzeBottleneck", "propPanel"];
      var missing = [], outside = [];
      probes.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) { missing.push(id); return; }
        if (!el.closest || !el.closest(".wt-drawer")) outside.push(id);
      });
      return { ok: missing.length === 0 && outside.length === 0,
        detail: "missing=[" + missing.join(",") + "] notInDrawer=[" + outside.join(",") + "]" };
    });

    // ---- v3.15 FLOATING / DRAGGABLE / PINNABLE DRAWERS -------------------
    // Each open drawer's title bar carries a DRAG HANDLE (grip) + a PIN/DOCK
    // toggle. Toggling the pin flips the drawer between docked (the left stack)
    // and floating (position:fixed, free-placed); a class + data-float flip and
    // a position style is applied. The floating layout PERSISTS (write -> read
    // via wt.ui.drawers.v1), and a "reset layout" path re-docks EVERY panel.
    var DRAWERS_KEY = "wt.ui.drawers.v1";

    check("drawer-has-drag-handle-and-pin-toggle", function () {
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      if (!libBtn) return { ok: false, detail: "no library rail button" };
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      if (!lib.classList.contains("open")) libBtn.click(); // ensure open
      var head = lib.querySelector(".wt-drawer-head");
      var grip = head && head.querySelector(".wt-drawer-grip");
      var pin = head && head.querySelector(".wt-drawer-pin");
      var gripNamed = !!(grip && grip.getAttribute("aria-label"));
      var pinIsButton = !!(pin && pin.tagName === "BUTTON" && pin.hasAttribute("aria-pressed"));
      var close = head && head.querySelector(".wt-drawer-close"); // chrome preserved
      return { ok: !!grip && !!pin && gripNamed && pinIsButton && !!close,
        detail: "grip=" + !!grip + " pin=" + !!pin + " gripAria=" + gripNamed +
          " pinButton=" + pinIsButton + " closePreserved=" + !!close };
    });

    check("drawer-pin-toggles-docked-and-floating", function () {
      if (!haveApi || !API.rail || typeof API.rail.toggleFloat !== "function")
        return { ok: false, detail: "no rail float API" };
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      if (!lib.classList.contains("open")) libBtn.click();
      // ensure we start docked
      if (API.rail.isFloating("library")) API.rail.toggleFloat("library");
      var pin = lib.querySelector(".wt-drawer-pin");
      // -> FLOAT
      API.rail.toggleFloat("library");
      var floatOn = API.rail.isFloating("library") &&
        lib.classList.contains("wt-drawer--floating") &&
        lib.getAttribute("data-float") === "1" &&
        /px/.test(lib.style.left || "") && /px/.test(lib.style.top || "") &&
        pin.getAttribute("aria-pressed") === "true";
      // -> DOCK
      API.rail.toggleFloat("library");
      var dockOn = !API.rail.isFloating("library") &&
        !lib.classList.contains("wt-drawer--floating") &&
        !lib.hasAttribute("data-float") &&
        (lib.style.left === "" || lib.style.left == null) &&
        pin.getAttribute("aria-pressed") === "false";
      return { ok: floatOn && dockOn,
        detail: "floatApplied=" + floatOn + " dockRestored=" + dockOn };
    });

    check("drawer-float-layout-persists", function () {
      if (!haveApi || !API.rail || typeof API.rail.setFloating !== "function")
        return { ok: false, detail: "no rail float API" };
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      if (!lib.classList.contains("open")) libBtn.click();
      API.rail.setFloating("library", true);
      if (typeof API.rail.moveTo === "function") API.rail.moveTo("library", 260, 140);
      var pos = API.rail.position("library");
      // read back the PERSISTED payload (proves write -> read round-trip)
      var raw = null; try { raw = window.localStorage.getItem(DRAWERS_KEY); } catch (e) { raw = null; }
      var parsed = null; try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      var rec = parsed && parsed.layout ? parsed.layout.library : null;
      var stored = !!(rec && rec.float === true && typeof rec.x === "number" && typeof rec.y === "number");
      var matches = !!(pos && rec && rec.x === pos.x && rec.y === pos.y);
      // tidy: dock it again (leaves storage without the float)
      API.rail.setFloating("library", false);
      return { ok: stored && matches,
        detail: "storedFloat=" + stored + " matchesLive=" + matches +
          " pos=" + (pos ? pos.x + "," + pos.y : "null") };
    });

    check("drawer-reset-layout-redocks-all", function () {
      if (!haveApi || !API.rail || typeof API.rail.resetLayout !== "function")
        return { ok: false, detail: "no rail resetLayout API" };
      var libBtn = document.querySelector('#wtRail [data-drawer="library"]');
      var genBtn = document.querySelector('#wtRail [data-drawer="generate"]');
      var lib = document.querySelector('.wt-drawer[data-drawer="library"]');
      var gen = document.querySelector('.wt-drawer[data-drawer="generate"]');
      if (!lib.classList.contains("open")) libBtn.click();
      if (!gen.classList.contains("open")) genBtn.click();
      API.rail.setFloating("library", true);
      API.rail.setFloating("generate", true);
      var bothFloat = API.rail.isFloating("library") && API.rail.isFloating("generate");
      API.rail.resetLayout();
      var noneFloat = !API.rail.isFloating("library") && !API.rail.isFloating("generate") &&
        !lib.classList.contains("wt-drawer--floating") && !gen.classList.contains("wt-drawer--floating") &&
        !lib.hasAttribute("data-float") && !gen.hasAttribute("data-float");
      // reset re-docks but does NOT close: both drawers stay open
      var stillOpen = lib.classList.contains("open") && gen.classList.contains("open");
      // persisted payload no longer carries any float record
      var raw = null; try { raw = window.localStorage.getItem(DRAWERS_KEY); } catch (e) { raw = null; }
      var parsed = null; try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      var noFloatStored = !!(parsed && parsed.layout && Object.keys(parsed.layout).length === 0);
      // tidy up: close all drawers so later checks start from the resting state
      if (API.rail.close) API.rail.close();
      return { ok: bothFloat && noneFloat && stillOpen && noFloatStored,
        detail: "bothFloat=" + bothFloat + " noneFloatAfterReset=" + noneFloat +
          " stillOpen=" + stillOpen + " noFloatStored=" + noFloatStored };
    });

    // ---- v3.10 REDESIGN-3 (move #3): Simulate = one Run + Advanced expander ----
    // Opening the Simulate drawer leads with a prominent Run + a one-line result
    // headline; the detailed parameters are hidden behind a COLLAPSED "Advanced
    // parameters" expander (progressive disclosure). Expanding reveals editable
    // params; Run still works from the sensible defaults. The #runBtn id + its
    // handler are unchanged - this proves the relocation kept the behaviour.
    check("simulate-run-plus-advanced-expander", function () {
      var simBtn = document.querySelector('#wtRail [data-drawer="simulate"]');
      if (!simBtn) return { ok: false, detail: "no simulate rail button" };
      simBtn.click(); // open the Simulate drawer (expands the lead simCard)
      var runBtn = document.getElementById("runBtn");
      var headline = document.getElementById("simHeadline");
      var toggle = document.getElementById("simAdvancedToggle");
      var region = document.getElementById("simAdvanced");
      var strategy = document.getElementById("strategySelect");
      var seed = document.getElementById("seedInput");
      // Run LEADS: a prominent Run + a one-line headline in the card's lead
      // block, inside the flyout drawer, ABOVE the collapsed Advanced params.
      var runInDrawer = !!(runBtn && runBtn.closest && runBtn.closest(".wt-drawer"));
      var runIsLead = !!(runBtn && runBtn.closest && runBtn.closest(".sim-lead"));
      var haveHeadline = !!headline && (headline.textContent || "").length > 0;
      // Advanced expander starts COLLAPSED: params HIDDEN until expanded.
      var collapsedDefault = !!toggle && toggle.getAttribute("aria-expanded") === "false" &&
        !!region && region.hidden === true;
      var paramInAdv = !!(strategy && strategy.closest && strategy.closest("#simAdvanced"));
      // Expand -> params become visible + editable.
      if (toggle) toggle.click();
      var expands = !!toggle && toggle.getAttribute("aria-expanded") === "true" &&
        !!region && region.hidden === false;
      var editable = false;
      if (seed && !seed.disabled && !seed.readOnly) {
        var prev = seed.value; seed.value = "43"; editable = seed.value === "43"; seed.value = prev;
      }
      // Run STILL WORKS: click it - no uncaught error, KPI container present.
      var errsBefore = (window.__WT_ERRORS__ || []).length;
      if (runBtn) runBtn.click();
      var errsAfter = (window.__WT_ERRORS__ || []).length;
      var runOk = !!document.getElementById("kpi") && errsAfter === errsBefore;
      // Restore: re-collapse the expander + close the drawer.
      if (toggle) toggle.click();
      simBtn.click();
      return {
        ok: runInDrawer && runIsLead && haveHeadline && collapsedDefault && paramInAdv &&
          expands && editable && runOk,
        detail: "runLead=" + runIsLead + " headline=" + haveHeadline +
          " collapsedDefault=" + collapsedDefault + " paramInAdv=" + paramInAdv +
          " expands=" + expands + " editable=" + editable + " runOk=" + runOk,
      };
    });

    // ---- v3.10 REDESIGN-3 (move #5): thinned header + overflow "More" menu ----
    // The secondary header actions were RELOCATED into a keyboard-accessible
    // overflow disclosure so the top bar reads calm. The menu ships closed;
    // opening it reveals the SAME nodes (ids/handlers intact); a menu action
    // fires its original handler (clicking About opens the About modal). Esc
    // closes it. Nothing removed, every action still reachable.
    check("header-overflow-menu-opens-and-actions-fire", function () {
      var toggle = document.getElementById("overflowBtn");
      var menu = document.getElementById("overflowMenu");
      if (!toggle || !menu) return { ok: false, detail: "no overflow toggle/menu" };
      // Ships CLOSED (runtime-seeded): hidden + aria-expanded=false.
      var closedFirst = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      // The secondary actions live here now (ids preserved = handlers preserved).
      var relocated = ["aboutBtn", "tierBtn", "helpBtn", "installBtn"].every(function (id) {
        var el = document.getElementById(id);
        return !!(el && el.closest && el.closest("#overflowMenu"));
      });
      // Opens on click: menu visible + aria-expanded true.
      toggle.click();
      var opens = menu.hidden === false && toggle.getAttribute("aria-expanded") === "true";
      // A menu action fires the SAME handler: clicking About opens the About
      // overlay (and the menu closes behind it).
      var about = document.getElementById("aboutBtn");
      if (about) about.click();
      var aboutEl = document.getElementById("about");
      var actionFired = !!aboutEl && aboutEl.hidden === false;
      var closedAfterAction = menu.hidden === true;
      // Clean up: close the About overlay; ensure the menu is shut via Esc too.
      try { if (haveApi && API.closeAbout) API.closeAbout(); } catch (_) { /* best-effort */ }
      toggle.click(); // reopen to prove Esc closes
      var esc;
      try { esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true }); }
      catch (e) { esc = document.createEvent("Event"); esc.initEvent("keydown", true, true); esc.key = "Escape"; }
      document.dispatchEvent(esc);
      var escCloses = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      return {
        ok: closedFirst && relocated && opens && actionFired && closedAfterAction && escCloses,
        detail: "closedFirst=" + closedFirst + " relocated=" + relocated + " opens=" + opens +
          " actionFired=" + actionFired + " closedAfterAction=" + closedAfterAction + " escCloses=" + escCloses,
      };
    });

    // ---- v3.11: EMPTY-HALL GUARD on Run + flow Play + RUN discoverability ----
    // The reported failure: pressing Run on an EMPTY floor silently did nothing
    // (there is nothing to simulate). Now Run AND flow Play give a friendly,
    // ANNOUNCED hint on an empty floor, while a POPULATED floor runs 100% as
    // before; and the Simulate rail tool lights a calm "ready to run" dot the
    // moment the floor has content. Drives the SAME handlers the UI uses.
    (function () {
      if (!haveApi) {
        results.push({ name: "sim-empty-run-guides-not-silent", ok: false, detail: "no test API" });
        results.push({ name: "sim-empty-flow-play-guides", ok: false, detail: "no test API" });
        results.push({ name: "sim-populated-run-unchanged-plus-nudge", ok: false, detail: "no test API" });
        return;
      }
      var simBtn = document.querySelector('#wtRail [data-drawer="simulate"]');

      // (1) EMPTY floor: Run must GUIDE, not silently no-op. Clear to an empty
      // hall (a valid preset size), then drive the SAME Run handler #runBtn uses.
      var P = API.emptyState.presets.medium;
      API.emptyState.startHall(P.w, P.h);
      var emptyNow = API.state.elements.length === 0 && API.hasSimulatableLayout() === false;
      API.runSim("run");
      var toastEl = $("toast");
      var headText = ($("simHeadline").textContent || "");
      var toastText = toastEl ? (toastEl.textContent || "") : "";
      var runGuides = /nothing to simulate/i.test(headText) &&
        /nothing to simulate/i.test(toastText) && !!toastEl && toastEl.hidden === false;
      var nudgeOffEmpty = !!simBtn && simBtn.classList.contains("is-ready") === false;
      check("sim-empty-run-guides-not-silent", function () {
        return { ok: emptyNow && runGuides && nudgeOffEmpty,
          detail: "empty=" + emptyNow + " guides=" + runGuides + " nudgeOff=" + nudgeOffEmpty };
      });

      // (2) EMPTY floor: flow Play must GUIDE too - and NOT start the animation.
      API.flowPlay();
      var playBlocked = API.state.flow.playing === false;
      var playGuides = /nothing to simulate/i.test(($("simHeadline").textContent || ""));
      check("sim-empty-flow-play-guides", function () {
        return { ok: playBlocked && playGuides,
          detail: "notPlaying=" + playBlocked + " guides=" + playGuides };
      });

      // (3) POPULATED floor: Run is UNCHANGED - a REAL result lands in the
      // headline (res.ok, "Ran N orders", no guard text) - and the Simulate rail
      // dot lights up (Run is now discoverable from the rail).
      var ex = WT.examples && WT.examples.library && WT.examples.library[0];
      if (ex) API.loadExample(ex.id);
      API.render();
      var populated = API.state.elements.length > 0 && API.hasSimulatableLayout() === true;
      API.runSim("run");
      var res = API.state.lastResult;
      var head2 = ($("simHeadline").textContent || "");
      var ranResult = !!(res && res.ok) && /Ran\s+\d+\s+orders/i.test(head2) &&
        !/nothing to simulate/i.test(head2);
      var nudgeOnPopulated = !!simBtn && simBtn.classList.contains("is-ready") === true;
      check("sim-populated-run-unchanged-plus-nudge", function () {
        return { ok: populated && ranResult && nudgeOnPopulated,
          detail: "populated=" + populated + " ran=" + ranResult + " nudgeOn=" + nudgeOnPopulated };
      });
    })();

    // ---- v3.14 PROFESSIONAL COMPACT DENSITY + ICON TOOLBAR -------------
    // The header/toolbar/in-panel action clusters now read as compact ICON
    // buttons: each carries an inline SVG glyph AND keeps an accessible name
    // (aria-label / title / text), so a screen-reader user never loses the
    // control's name. The SAME ids + handlers are preserved (e.g. #runBtn still
    // runs - proven above by simulate-run-plus-advanced-expander). Some icons
    // EXPAND into a detailed flyout (Export -> IFC/report/JSON/CSV/share; View
    // -> fit/zoom/overlays) or into their rail drawer (Analyze) - progressive
    // disclosure that ADDS reach without hiding anything. And the professional
    // compact-density stylesheet is live by default.
    check("pro-toolbar-icons-render-with-accessible-names", function () {
      var ids = ["heatBtn", "measureBtn", "flowLinksBtn", "zoomFitBtn", "panBtn", "isoBtn",
        "exportMenuBtn", "viewMenuBtn", "simMenuBtn", "addMenuBtn", "saveBtn", "loadBtn",
        "exportBtn", "importBtn", "clearBtn", "demoBtn", "storyBtn", "guidedDemoBtn"];
      var bad = [];
      ids.forEach(function (id) {
        var b = $(id);
        if (!b) { bad.push(id + ":missing"); return; }
        if (!b.querySelector("svg")) bad.push(id + ":no-svg");
        var name = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "").trim();
        if (!name.length) bad.push(id + ":no-name");
      });
      return { ok: bad.length === 0,
        detail: bad.length ? bad.join(",") : ids.length + " icon buttons OK (svg glyph + accessible name)" };
    });

    // #runBtn stays the SAME id + keeps an accessible name after the icon pass
    // (its handler firing is proven by the simulate test above).
    check("pro-run-keeps-id-and-accessible-name", function () {
      var b = $("runBtn");
      if (!b) return { ok: false, detail: "no #runBtn" };
      var name = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "").trim();
      var isButton = b.tagName === "BUTTON";
      return { ok: isButton && name.length > 0, detail: "tag=" + b.tagName + " name='" + name + "'" };
    });

    function escKey() {
      var e;
      try { e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true }); }
      catch (_) { e = document.createEvent("Event"); e.initEvent("keydown", true, true); e.key = "Escape"; }
      return e;
    }

    // The Export icon EXPANDS into a detailed menu of every export/share path;
    // every item proxies an EXISTING control (its handler is reused, not
    // duplicated). Ships closed, opens on click, Esc closes.
    check("export-icon-expands-into-detailed-menu", function () {
      var toggle = $("exportMenuBtn"), menu = $("exportMenu");
      if (!toggle || !menu) return { ok: false, detail: "no export flyout" };
      var closedFirst = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      var items = menu.querySelectorAll(".tb-menu-item[data-proxy]");
      var proxiesResolve = items.length >= 4 && Array.prototype.every.call(items, function (it) {
        return !!document.getElementById(it.getAttribute("data-proxy"));
      });
      toggle.click();
      var opens = menu.hidden === false && toggle.getAttribute("aria-expanded") === "true";
      document.dispatchEvent(escKey());
      var escCloses = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      return { ok: closedFirst && proxiesResolve && opens && escCloses,
        detail: "closed=" + closedFirst + " items=" + items.length + " proxiesResolve=" + proxiesResolve +
          " opens=" + opens + " escCloses=" + escCloses };
    });

    // The View icon EXPANDS into a detailed menu of the view + overlay controls
    // (fit/zoom/pan/2.5D/heatmap/measure/flow-links), each proxying its existing
    // control. Ships closed, opens, toggles closed again.
    check("view-icon-expands-into-detailed-menu", function () {
      var toggle = $("viewMenuBtn"), menu = $("viewMenu");
      if (!toggle || !menu) return { ok: false, detail: "no view flyout" };
      var closedFirst = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      var items = menu.querySelectorAll(".tb-menu-item[data-proxy]");
      var proxiesResolve = items.length >= 5 && Array.prototype.every.call(items, function (it) {
        return !!document.getElementById(it.getAttribute("data-proxy"));
      });
      toggle.click();
      var opens = menu.hidden === false && toggle.getAttribute("aria-expanded") === "true";
      toggle.click(); // toggle closes
      var closes = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      return { ok: closedFirst && proxiesResolve && opens && closes,
        detail: "closed=" + closedFirst + " items=" + items.length + " proxiesResolve=" + proxiesResolve +
          " opens=" + opens + " closes=" + closes };
    });

    // v3.16 ICON-EXTEND: the SIMULATE icon EXPANDS into a detailed menu of the
    // run + material-flow playback controls, each item proxying an EXISTING
    // control (its handler is reused, not duplicated). Ships closed, opens on
    // click, Esc closes - and FIRING the Run item triggers the REAL Run (on a
    // populated, simulatable layout the headline shows "Ran N orders").
    check("simulate-icon-expands-into-detailed-menu", function () {
      var toggle = $("simMenuBtn"), menu = $("simMenu");
      if (!toggle || !menu) return { ok: false, detail: "no simulate flyout" };
      var closedFirst = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      var items = menu.querySelectorAll(".tb-menu-item[data-proxy]");
      var proxiesResolve = items.length >= 5 && Array.prototype.every.call(items, function (it) {
        return !!document.getElementById(it.getAttribute("data-proxy"));
      });
      toggle.click();
      var opens = menu.hidden === false && toggle.getAttribute("aria-expanded") === "true";
      document.dispatchEvent(escKey());
      var escCloses = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      // Fire the Run item -> the SAME #runBtn Run handler runs on a populated layout.
      var ran = true;
      if (haveApi && typeof API.loadExample === "function") {
        var ex = WT.examples && WT.examples.library && WT.examples.library[0];
        if (ex) API.loadExample(ex.id);
        API.render();
        var runItem = menu.querySelector('.tb-menu-item[data-proxy="runBtn"]');
        if (runItem) runItem.click(); // proxies #runBtn
        var head = ($("simHeadline").textContent || "");
        var res = API.state.lastResult;
        ran = !!(res && res.ok) && /Ran\s+\d+\s+orders/i.test(head) && !/nothing to simulate/i.test(head);
      }
      return { ok: closedFirst && proxiesResolve && opens && escCloses && ran,
        detail: "closed=" + closedFirst + " items=" + items.length + " proxiesResolve=" + proxiesResolve +
          " opens=" + opens + " escCloses=" + escCloses + " runFires=" + ran };
    });

    // v3.16 ICON-EXTEND: the ADD-COMPONENT icon EXPANDS into the Class Library
    // CATEGORIES (built at runtime from paletteTree()). Every component item's
    // data-proxy-type resolves to a REAL palette item (no dangling); a category
    // is a keyboard disclosure; and FIRING an item ARMS placement via the SAME
    // setTool path (proving one-click add of any of the 51 components).
    check("add-icon-expands-into-category-flyout-arming-setTool", function () {
      var toggle = $("addMenuBtn"), menu = $("addMenu");
      if (!toggle || !menu) return { ok: false, detail: "no add flyout" };
      // Clear any leftover palette search so the full Class Library renders
      // (the add menu mirrors paletteTree(); #palette items must be present).
      if (haveApi && API.library && typeof API.library.setSearch === "function") API.library.setSearch("");
      var closedFirst = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      var heads = menu.querySelectorAll(".tb-submenu-head");
      var items = menu.querySelectorAll(".tb-menu-item[data-proxy-type]");
      var itemsResolve = items.length > 0 && Array.prototype.every.call(items, function (it) {
        return !!document.querySelector('#palette .pal-item[data-type="' + it.getAttribute("data-proxy-type") + '"]');
      });
      toggle.click();
      var opens = menu.hidden === false && toggle.getAttribute("aria-expanded") === "true";
      // A category disclosure: expanding the first head reveals its sub-list.
      var firstHead = heads[0], catExpands = false;
      if (firstHead) {
        firstHead.click();
        var body = document.getElementById(firstHead.getAttribute("aria-controls"));
        catExpands = firstHead.getAttribute("aria-expanded") === "true" && !!body && body.hidden === false;
      }
      // Fire a component item unlocked in every tier -> arms setTool(type).
      var TYPE = "selective-racking";
      var addItem = menu.querySelector('.tb-menu-item[data-proxy-type="' + TYPE + '"]');
      var palItem = document.querySelector('#palette .pal-item[data-type="' + TYPE + '"]');
      var armed = false;
      if (haveApi && addItem && palItem) {
        if (API.state.activeTool === TYPE) addItem.click(); // start disarmed (deterministic)
        addItem.click(); // proxies the real palette item -> setTool(TYPE)
        armed = API.state.activeTool === TYPE;
        if (API.state.activeTool && palItem) palItem.click(); // restore: disarm placement
      }
      document.dispatchEvent(escKey());
      var escCloses = menu.hidden === true && toggle.getAttribute("aria-expanded") === "false";
      return { ok: closedFirst && itemsResolve && opens && catExpands && armed && escCloses,
        detail: "closed=" + closedFirst + " cats=" + heads.length + " items=" + items.length +
          " itemsResolve=" + itemsResolve + " opens=" + opens + " catExpands=" + catExpands +
          " armed=" + armed + " escCloses=" + escCloses };
    });

    // A rail icon EXPANDS into its drawer of detailed controls (the "icon opens
    // its drawer" form of progressive disclosure). Restores the prior state.
    check("rail-analyze-icon-expands-into-drawer", function () {
      var btn = document.querySelector('#wtRail [data-drawer="analyze"]');
      if (!btn) return { ok: false, detail: "no analyze rail button" };
      var wasOpen = btn.getAttribute("aria-expanded") === "true";
      if (!wasOpen) btn.click();
      var openState = btn.getAttribute("aria-expanded") === "true" && btn.classList.contains("active");
      var hasOpenDrawer = !!document.querySelector(".wt-drawer.open");
      if (!wasOpen) btn.click(); // restore closed
      return { ok: openState && hasOpenDrawer,
        detail: "opened=" + openState + " drawerOpen=" + hasOpenDrawer + " wasOpen=" + wasOpen };
    });

    // The professional COMPACT DENSITY stylesheet is active by default (a live
    // CSS sentinel proves the section loaded) and the density default stays a
    // valid full-access state (the fresh-profile Expert default is proven by
    // density-default-full-access-on-fresh-profile above).
    check("pro-compact-density-stylesheet-active", function () {
      var sentinel = "";
      try { sentinel = (getComputedStyle(document.documentElement).getPropertyValue("--wt-density") || "").trim(); }
      catch (_) { sentinel = ""; }
      var densityAttr = document.documentElement.getAttribute("data-density");
      var validDensity = densityAttr === "expert" || densityAttr === "simple";
      return { ok: sentinel === "compact" && validDensity,
        detail: "sentinel='" + sentinel + "' data-density=" + densityAttr };
    });

    // ---- v3.20.1 CRAFT PASS: design tokens + typography + motion guards ----
    // The visual craft pass is gate-verified, not eyeballed: the token layer
    // exists, KPI numerals are tabular, the ink-role text tokens really pass
    // WCAG AA against their surface (contrast is COMPUTED here, live, from
    // the resolved custom properties), and the new micro-interactions sit
    // behind a prefers-reduced-motion guard in the shipped stylesheet.
    function cssVar(name) {
      try { return (getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim(); }
      catch (_) { return ""; }
    }
    function hexLum(hex) {
      var h = String(hex).replace("#", "");
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (!/^[0-9a-fA-F]{6}$/.test(h)) return -1;
      var c = [0, 2, 4].map(function (i) {
        var v = parseInt(h.substr(i, 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) {
      var la = hexLum(a), lb = hexLum(b);
      if (la < 0 || lb < 0) return 0;
      var hi = Math.max(la, lb), lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    }

    check("craft-design-tokens-present", function () {
      var need = ["--accent-ink", "--ok-ink", "--warn-ink", "--danger-ink",
        "--track-label", "--shadow-2", "--shadow-3", "--ease-out", "--dur-1", "--dur-2"];
      var missing = need.filter(function (n) { return cssVar(n) === ""; });
      return { ok: missing.length === 0,
        detail: missing.length ? "missing: " + missing.join(",") : "all " + need.length + " tokens resolve" };
    });

    check("craft-kpi-numerals-tabular", function () {
      var probe = document.createElement("span");
      probe.className = "kpi-value";
      probe.textContent = "1234";
      document.body.appendChild(probe);
      var fvn = "";
      try { fvn = getComputedStyle(probe).fontVariantNumeric || ""; }
      finally { probe.remove(); }
      return { ok: fvn.indexOf("tabular-nums") !== -1, detail: "font-variant-numeric='" + fvn + "'" };
    });

    check("craft-ink-tokens-pass-aa-contrast", function () {
      var surface = cssVar("--surface");
      var pairs = [["--accent-ink", 4.5], ["--ok-ink", 4.5], ["--warn-ink", 4.5],
        ["--danger-ink", 4.5], ["--text-dim", 4.5]];
      var bad = [];
      var seen = [];
      for (var i = 0; i < pairs.length; i++) {
        var v = cssVar(pairs[i][0]);
        var cr = contrast(v, surface);
        seen.push(pairs[i][0] + "=" + cr.toFixed(2));
        if (cr < pairs[i][1]) bad.push(pairs[i][0] + " " + cr.toFixed(2) + "<" + pairs[i][1]);
      }
      return { ok: bad.length === 0,
        detail: bad.length ? bad.join("; ") : "on " + surface + ": " + seen.join(" ") };
    });

    check("craft-motion-behind-reduced-motion-guard", function () {
      // The shipped stylesheet must carry BOTH guards: a reduce block that
      // stills the drawer/rail chrome, and the rail-icon micro-lift authored
      // INSIDE a no-preference block (so reduce never sees it at all).
      var foundReduce = false, foundNoPref = false;
      try {
        for (var s = 0; s < document.styleSheets.length; s++) {
          var rules;
          try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
          if (!rules) continue;
          for (var r = 0; r < rules.length; r++) {
            var rule = rules[r];
            if (!rule.conditionText || String(rule.conditionText).indexOf("prefers-reduced-motion") === -1) continue;
            var body = rule.cssText || "";
            if (String(rule.conditionText).indexOf("reduce") !== -1 &&
                body.indexOf(".wt-drawer") !== -1 && body.indexOf(".wt-rail") !== -1) foundReduce = true;
            if (String(rule.conditionText).indexOf("no-preference") !== -1 &&
                body.indexOf(".wt-rail-ico") !== -1 && body.indexOf("transform") !== -1) foundNoPref = true;
          }
        }
      } catch (_) { /* fall through with whatever was found */ }
      return { ok: foundReduce && foundNoPref,
        detail: "reduceGuard=" + foundReduce + " noPrefLift=" + foundNoPref };
    });

    /* ---- v3.21 INDUSTRIAL MATERIAL IDENTITY -------------------------
     * The design correction is GATE-VERIFIED, not eyeballed: the machine-
     * console token layer exists, its text really passes WCAG AA against
     * the powder-coat it sits on (contrast COMPUTED live from the resolved
     * custom properties, both themes), the neutrals are genuinely WARM
     * rather than the blue-gray of the drafting-tool pass, the canvas
     * material palette is complete, and the concrete/paint geometry is
     * DETERMINISTIC (same seed -> byte-identical, no Date, no RNG).
     * ---------------------------------------------------------------- */

    check("material-console-tokens-present", function () {
      var need = ["--console", "--console-2", "--console-line", "--console-ink",
        "--console-ink-dim", "--led-run", "--led-attn", "--led-stop", "--led-off"];
      var missing = need.filter(function (n) { return cssVar(n) === ""; });
      return { ok: missing.length === 0,
        detail: missing.length ? "missing: " + missing.join(",") : "all " + need.length + " console tokens resolve" };
    });

    check("material-console-ink-passes-aa-on-powder-coat", function () {
      // The rail is a dark powder-coated column in BOTH themes, so its own
      // ink pair must pass on its own background - not on --surface.
      var coat = cssVar("--console");
      var pairs = [["--console-ink", 4.5], ["--console-ink-dim", 4.5],
        ["--led-run", 3], ["--led-attn", 3], ["--led-stop", 3]];
      var bad = [], seen = [];
      for (var i = 0; i < pairs.length; i++) {
        var cr = contrast(cssVar(pairs[i][0]), coat);
        seen.push(pairs[i][0] + "=" + cr.toFixed(2));
        if (cr < pairs[i][1]) bad.push(pairs[i][0] + " " + cr.toFixed(2) + "<" + pairs[i][1]);
      }
      return { ok: bad.length === 0,
        detail: bad.length ? bad.join("; ") : "on " + coat + ": " + seen.join(" ") };
    });

    check("material-neutrals-are-warm-not-blueprint-slate", function () {
      // The correction in one assertion: in a WARM neutral the red channel is
      // >= the blue channel. The v3.20.1 drafting palette failed this on every
      // surface (slate #0f172a, #f1f5f9, canvas #0e1626 - all blue-dominant).
      var names = ["--bg", "--surface", "--surface-2", "--border", "--text",
        "--text-dim", "--canvas-bg", "--canvas-grid", "--canvas-grid-strong", "--console"];
      var cold = [], seen = [];
      for (var i = 0; i < names.length; i++) {
        var v = cssVar(names[i]);
        var h = String(v).replace("#", "");
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (!/^[0-9a-fA-F]{6}$/.test(h)) { cold.push(names[i] + "=?" + v); continue; }
        var r = parseInt(h.slice(0, 2), 16), b = parseInt(h.slice(4, 6), 16);
        seen.push(names[i] + "(r" + r + ">=b" + b + ")");
        if (r < b) cold.push(names[i] + " " + v + " is blue-dominant (r" + r + "<b" + b + ")");
      }
      return { ok: cold.length === 0,
        detail: cold.length ? cold.join("; ") : names.length + " neutrals all warm: " + seen.join(" ") };
    });

    check("material-canvas-palette-complete-and-warm", function () {
      // app.js owns the canvas palette (a canvas cannot read CSS vars). Every
      // material the floor renderer names must be present in BOTH themes.
      var need = ["concrete", "aggDark", "aggLight", "joint", "paintYellow",
        "paintWhite", "hazardDark", "steel", "upright", "guard", "wood",
        "kraft", "toteBlue", "toteRed"];
      if (!haveApi || !API.themeColors) return { ok: false, detail: "no themeColors() on the test API" };
      var c = API.themeColors();
      var missing = need.filter(function (k) { return !/^#[0-9a-fA-F]{6}$/.test(String(c[k])); });
      // The slab itself must be a warm neutral, never the old blue-black.
      var h = String(c.concrete).replace("#", "");
      var warm = /^[0-9a-fA-F]{6}$/.test(h) &&
        parseInt(h.slice(0, 2), 16) >= parseInt(h.slice(4, 6), 16);
      return { ok: missing.length === 0 && warm,
        detail: missing.length ? "missing: " + missing.join(",")
          : "14 materials present; concrete=" + c.concrete + " warm=" + warm };
    });

    check("material-concrete-and-paint-are-deterministic", function () {
      // The slab's aggregate and the paint's wear are PURE functions of a
      // seed: identical across calls, and different seeds really do differ.
      var F = window.WT && window.WT.floor;
      if (!F || typeof F.concreteSpecks !== "function") return { ok: false, detail: "WT.floor material helpers absent" };
      var a = JSON.stringify(F.concreteSpecks(16, 4242, 0.6));
      var b = JSON.stringify(F.concreteSpecks(16, 4242, 0.6));
      var c = JSON.stringify(F.concreteSpecks(16, 99, 0.6));
      var w1 = F.wearAt(3.5, 8.25, 7717), w2 = F.wearAt(3.5, 8.25, 7717);
      var inRange = w1 >= 0.62 && w1 <= 1;
      // Every stone must sit fully inside the tile (0..1 on both axes).
      var specks = F.concreteSpecks(16, 4242, 0.6);
      var escaped = specks.filter(function (s) {
        return !(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1 && s.r > 0 && s.r < 0.5);
      }).length;
      return { ok: a === b && a !== c && w1 === w2 && inRange && escaped === 0 && specks.length > 0,
        detail: "stable=" + (a === b) + " seedSensitive=" + (a !== c) +
          " wear=" + w1.toFixed(4) + " stones=" + specks.length + " escaped=" + escaped };
    });

    check("material-no-clock-or-rng-in-the-floor-material-layer", function () {
      // Determinism is STRUCTURAL, not incidental: read the shipped source of
      // every exported floor helper straight off the live functions (no
      // network, so this holds from file:// too) and prove none of them can
      // reach a clock or an RNG.
      var F = window.WT && window.WT.floor;
      if (!F) return { ok: false, detail: "WT.floor absent" };
      var src = "", n = 0;
      for (var k in F) {
        if (typeof F[k] !== "function") continue;
        src += String(F[k]) + "\n";
        n++;
      }
      var hasClock = /Date\.now|new Date\(/.test(src);
      var hasRng = /Math\.random/.test(src);
      var hasMaterial = typeof F.concreteSpecks === "function" && typeof F.hazardBands === "function";
      return { ok: !hasClock && !hasRng && hasMaterial && n > 0,
        detail: n + " floor helpers scanned; clock=" + hasClock + " rng=" + hasRng +
          " materialHelpers=" + hasMaterial };
    });

    check("material-shapes-vocabulary-theme-complete", function () {
      // The shared material vocabulary (steel beam, painted upright, safety
      // guard, pallet timber, kraft board, plastic totes) must resolve in
      // BOTH themes, or one renderer would silently fall back to gray.
      var S = window.WT && window.WT.shapes;
      if (!S || !S.MATERIALS) return { ok: false, detail: "WT.shapes.MATERIALS absent" };
      var need = ["beam", "upright", "guard", "wood", "kraft", "toteBlue", "toteRed"];
      var bad = [];
      for (var i = 0; i < need.length; i++) {
        var l = S.mat(need[i], "light"), d = S.mat(need[i], "dark");
        if (!/^#[0-9a-fA-F]{6}$/.test(l) || !/^#[0-9a-fA-F]{6}$/.test(d)) bad.push(need[i]);
      }
      return { ok: bad.length === 0,
        detail: bad.length ? "incomplete: " + bad.join(",")
          : need.length + " materials x 2 themes; beam=" + S.mat("beam", "light") + "/" + S.mat("beam", "dark") };
    });

    /* ---- v3.22 LIVING WORKERS ---------------------------------------
     * The plant has people in it and they do their job. These run against
     * the LIVE app: the roster the renderer actually draws, the pure pose
     * model behind it, and the real draw pass in BOTH view modes.
     * ---------------------------------------------------------------- */
    var WKR = window.WT && window.WT.workers;
    var wkApi = haveApi && API.workers ? API.workers : null;

    check("workers-roster-staffs-the-live-layout", function () {
      if (!WKR || !wkApi) return { ok: false, detail: "WT.workers / test API absent" };
      var a = wkApi.roster(), b = wkApi.roster();
      if (!a.length) return { ok: false, detail: "nobody staffed on the live layout" };
      var jobs = {}, bad = [];
      for (var i = 0; i < a.length; i++) {
        jobs[a[i].task] = (jobs[a[i].task] || 0) + 1;
        if (WKR.TASKS.indexOf(a[i].task) < 0) bad.push(a[i].task);
        if (!(a[i].route && a[i].route.length === 2)) bad.push(a[i].id + " has no route");
      }
      var keys = Object.keys(jobs).sort().map(function (k) { return k + "=" + jobs[k]; });
      return { ok: bad.length === 0 && a.length <= WKR.MAX_WORKERS && a === b,
        detail: bad.length ? bad.join(",") : a.length + " workers (" + keys.join(" ") + "), cached=" + (a === b) };
    });

    check("workers-pose-is-deterministic-bounded-and-alive", function () {
      if (!WKR || !wkApi) return { ok: false, detail: "WT.workers absent" };
      var roster = wkApi.roster();
      if (!roster.length) return { ok: false, detail: "empty roster" };
      var bad = [], moved = 0, keys = ["hip", "head", "handL", "handR", "footL", "footR", "kneeL", "elR"];
      for (var i = 0; i < roster.length && i < 12; i++) {
        var prev = null;
        for (var s = 0; s <= 24; s++) {
          var t = (s / 24) * WKR.CYCLES[roster[i].task].ticks;
          var p1 = WKR.pose(WKR.sample(roster[i], t));
          var p2 = WKR.pose(WKR.sample(roster[i], t));
          if (JSON.stringify(p1) !== JSON.stringify(p2)) bad.push(roster[i].id + " non-deterministic");
          for (var k = 0; k < keys.length; k++) {
            var j = p1[keys[k]];
            if (!isFinite(j.f) || !isFinite(j.l) || !isFinite(j.z) ||
                Math.abs(j.f) > 1.1 || Math.abs(j.l) > 0.8 || j.z < -0.02 || j.z > 2.1) {
              bad.push(roster[i].id + "." + keys[k]);
            }
          }
          if (prev && JSON.stringify(prev) !== JSON.stringify(p1)) moved++;
          prev = p1;
        }
      }
      // Nobody is a mannequin: the pose really changes across the cycle.
      return { ok: bad.length === 0 && moved > 100,
        detail: bad.length ? bad.slice(0, 3).join(",") : "poses bounded + deterministic; " + moved + " live pose changes" };
    });

    check("workers-walk-with-a-real-gait-and-carry-the-load-in-their-hands", function () {
      if (!WKR || !wkApi) return { ok: false, detail: "WT.workers absent" };
      var roster = wkApi.roster(), spec = null;
      for (var i = 0; i < roster.length; i++) {
        if (roster[i].task === "pick" || roster[i].task === "put") { spec = roster[i]; break; }
      }
      if (!spec) return { ok: false, detail: "no walking worker on this layout" };
      var per = WKR.CYCLES[spec.task].ticks, steps = 0, alt = 0, counter = 0, swing = 0, held = 0, inHands = 0;
      for (var s = 0; s <= 240; s++) {
        var w = WKR.sample(spec, (s / 240) * per);
        var sk = WKR.pose(w);
        if (w.gaitAmp > 0.4 && Math.abs(sk.footL.f - sk.footR.f) > 0.05) {
          steps++;
          if ((sk.footL.f > 0) !== (sk.footR.f > 0)) alt++;
          // The arms counter-swing when they are FREE. A worker carrying a
          // carton holds it with both hands instead - which is the point.
          if (w.params.task < 0.5) {
            swing++;
            if ((sk.footL.f > sk.footR.f) !== (sk.handL.f > sk.handR.f)) counter++;
          }
        }
        if (sk.load) {
          held++;
          var mf = (sk.handL.f + sk.handR.f) / 2, ml = (sk.handL.l + sk.handR.l) / 2, mz = (sk.handL.z + sk.handR.z) / 2;
          var d = Math.sqrt(Math.pow(sk.load.c.f - mf, 2) + Math.pow(sk.load.c.l - ml, 2) + Math.pow(sk.load.c.z - mz, 2));
          if (d < 0.2) inHands++;
        }
      }
      return { ok: steps > 10 && alt === steps && swing > 5 && counter === swing && held > 20 && inHands === held,
        detail: "strideSamples=" + steps + " alternating=" + alt + " freeArmStrides=" + swing +
          " counterSwing=" + counter + " carrying=" + held + " inHands=" + inHands };
    });

    check("workers-freeze-to-a-standing-pose-without-a-clock", function () {
      // What prefers-reduced-motion (and a stopped plant) gets: the app
      // passes a null clock and every worker rests in a legible stance.
      if (!WKR || !wkApi) return { ok: false, detail: "WT.workers absent" };
      var roster = wkApi.roster(), bad = [];
      for (var i = 0; i < roster.length; i++) {
        var w = WKR.sample(roster[i], null);
        var sk = WKR.pose(w);
        if (w.gaitAmp !== 0 || w.breath !== 0) bad.push(roster[i].id + " still moving");
        if (sk.footL.z > 1e-9 || sk.footR.z > 1e-9) bad.push(roster[i].id + " foot in the air");
        if (Math.abs(sk.footL.f - sk.footR.f) > 0.2) bad.push(roster[i].id + " mid-stride");
        if (sk.head.z < 1.25) bad.push(roster[i].id + " folded over");
      }
      var wired = typeof wkApi.animT === "function";
      return { ok: bad.length === 0 && wired && roster.length > 0,
        detail: bad.length ? bad.slice(0, 3).join(",") : roster.length + " workers rest standing; app clock hook=" + wired };
    });

    check("workers-draw-in-both-views-on-the-live-canvas", function () {
      if (!haveApi || !wkApi) return { ok: false, detail: "test API absent" };
      var errsBefore = (window.__WT_ERRORS__ || []).length;
      var threw = "";
      var mode = API.state.viewMode;
      try {
        API.setViewMode("top"); API.render(); wkApi.draw();
        API.setViewMode("iso"); API.render(); wkApi.draw();
        API.setViewMode(mode); API.render();
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      var errsAfter = (window.__WT_ERRORS__ || []).length;
      var tier = wkApi.tier();
      return { ok: !threw && errsAfter === errsBefore && (tier === "icon" || tier === "glyph" || tier === "rich"),
        detail: threw ? "threw " + threw : "top + iso drew clean; LOD tier at this zoom = " + tier };
    });

    check("workers-hi-vis-outline-is-legible-in-both-themes", function () {
      // A 7 px figure does not read by hue: it reads because hi-vis sits
      // against a near-black outline. Assert that contrast as non-text UI
      // (>= 3:1) in BOTH themes - and that the vest really is hi-vis
      // yellow-green (green channel dominant, blue lowest).
      if (!WKR) return { ok: false, detail: "WT.workers absent" };
      var out = [], bad = [];
      ["light", "dark"].forEach(function (th) {
        var vest = WKR.ppe("vest", th), ink = WKR.ppe("ink", th);
        var cr = contrast(vest, ink);
        out.push(th + " vest " + vest + " on ink " + ink + " = " + cr.toFixed(2) + ":1");
        if (cr < 3) bad.push(th + " outline " + cr.toFixed(2) + "<3");
        var h = String(vest).replace("#", "");
        var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
        if (!(g > r && r > b)) bad.push(th + " vest is not hi-vis yellow-green");
      });
      return { ok: bad.length === 0, detail: bad.length ? bad.join("; ") : out.join(" | ") };
    });

    check("workers-no-clock-or-rng-in-the-workforce-layer", function () {
      // Determinism is STRUCTURAL: read the shipped source straight off the
      // live functions (no network, so this holds from file:// too).
      if (!WKR) return { ok: false, detail: "WT.workers absent" };
      var src = "", n = 0;
      for (var k in WKR) {
        if (typeof WKR[k] !== "function") continue;
        src += String(WKR[k]) + "\n";
        n++;
      }
      var hasClock = /Date\.now|new Date\(/.test(src);
      var hasRng = /Math\.random/.test(src);
      var hasModel = typeof WKR.pose === "function" && typeof WKR.roster === "function" && typeof WKR.draw === "function";
      return { ok: !hasClock && !hasRng && hasModel && n >= 8,
        detail: n + " workforce functions scanned; clock=" + hasClock + " rng=" + hasRng + " model=" + hasModel };
    });

    check("workers-station-glyph-shows-the-work-not-a-welded-figure", function () {
      // The people moved OUT of the furniture: a manned station's rich
      // glyph now draws the WORK IN PROGRESS (a carton that travels the
      // bench with the phase), and the shape registry carries no person.
      var S = window.WT && window.WT.shapes;
      if (!S) return { ok: false, detail: "WT.shapes absent" };
      var moved = false, threw = "";
      try {
        var draw = function (anim) {
          var cc = document.createElement("canvas");
          cc.width = 160; cc.height = 120;
          var x = cc.getContext("2d");
          S.draw2D(x, "pack-station", { x: 10, y: 10, w: 90, d: 60, cellPx: 30,
            color: "#8a9096", theme: "light", lod: 60, anim: anim, seed: 3 });
          return cc.toDataURL();
        };
        moved = draw(0.05) !== draw(0.75);
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      var noPerson = !/person2D|person3D/.test(String(S.draw2D) + String(S.draw3D));
      return { ok: !threw && moved && noPerson,
        detail: threw ? "threw " + threw : "bench work animates=" + moved + " figureRemovedFromGlyph=" + noPerson };
    });

    /* ---- v3.23 THE GOODS ARE PHYSICAL --------------------------------
     * The material flow stopped being abstract squares. These run against
     * the LIVE app: the units the renderer actually draws, the surfaces
     * they ride, the form transformation at the sim's own stations, and
     * the real draw pass in BOTH view modes.
     * ---------------------------------------------------------------- */
    var GDS = window.WT && window.WT.goods;
    var gdApi = haveApi && API.goods ? API.goods : null;

    check("goods-are-real-handling-units-on-the-live-flow", function () {
      if (!GDS || !gdApi || !haveApi) return { ok: false, detail: "WT.goods / test API absent" };
      var threw = "";
      var forms = {}, n = 0, bad = [];
      try {
        API.flowPlay();
        for (var k = 0; k < 40; k++) API.flowStep();
        var list = gdApi.units();
        n = list.length;
        for (var i = 0; i < list.length; i++) {
          var u = list[i];
          forms[u.form] = (forms[u.form] || 0) + 1;
          if (GDS.FORMS.indexOf(u.form) < 0) bad.push("unknown form " + u.form);
          if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.z) || !isFinite(u.heading)) bad.push("non-finite " + u.id);
          if (!(u.size && u.size.f > 0 && u.size.l > 0 && u.size.z > 0)) bad.push("no size " + u.id);
        }
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      var keys = Object.keys(forms).sort().map(function (f) { return f + "=" + forms[f]; });
      return { ok: !threw && bad.length === 0 && n > 0,
        detail: threw ? "threw " + threw : bad.length ? bad.slice(0, 3).join(",") : n + " live units: " + keys.join(" ") };
    });

    check("goods-ride-the-belts-decks-and-benches-not-the-air", function () {
      if (!GDS || !gdApi) return { ok: false, detail: "WT.goods absent" };
      var sup = gdApi.support();
      if (!sup) return { ok: false, detail: "no support index" };
      var list = gdApi.units(), bad = [], rides = {};
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        var s = GDS.supportAt(sup, u.x, u.y);
        rides[u.ride] = (rides[u.ride] || 0) + 1;
        if (Math.abs(u.z - s.z) > 1e-9) bad.push(u.id + " floats " + u.z + " over " + s.z);
        if (u.z < 0 || u.z > 25) bad.push(u.id + " absurd height " + u.z);
      }
      var keys = Object.keys(rides).sort().map(function (r) { return r + "=" + rides[r]; });
      return { ok: bad.length === 0 && list.length > 0,
        detail: bad.length ? bad.slice(0, 3).join(",") : list.length + " units on " + (sup.count || 0) +
          " carrier cells: " + keys.join(" ") };
    });

    check("goods-change-form-at-the-station-that-does-the-work", function () {
      // The honest visual of a warehouse: a unit WAITING at a station still
      // shows what it arrived as; it becomes the next thing when the sim's
      // own FIFO server SERVES it. Assert the mapping on the live module.
      if (!GDS) return { ok: false, detail: "WT.goods absent" };
      var want = [
        ["receiving", "active", "pallet-load"], ["storage", "queued", "pallet-load"],
        ["storage", "active", "carton"], ["picking", "queued", "carton"],
        ["picking", "active", "tote"], ["packing", "queued", "tote"],
        ["packing", "active", "parcel"], ["shipping", "active", "parcel"],
      ];
      var bad = [];
      for (var i = 0; i < want.length; i++) {
        var got = GDS.formFor({ stage: want[i][0], status: want[i][1] });
        if (got !== want[i][2]) bad.push(want[i][0] + "/" + want[i][1] + "->" + got);
      }
      // ...and one MU is still one unit: the form change is not a split.
      var sim = haveApi && API.state.flow ? API.state.flow.sim : null;
      var conserved = !sim || (sim.spawned === sim.inflight + sim.completed &&
        (!gdApi || gdApi.units().length === sim.mus.length));
      return { ok: bad.length === 0 && conserved,
        detail: bad.length ? bad.join(",") : want.length + " stage/status cases correct; conserved=" + conserved +
          (sim ? " (spawned " + sim.spawned + " = inflight " + sim.inflight + " + completed " + sim.completed + ")" : "") };
    });

    check("goods-draw-in-both-views-on-the-live-canvas", function () {
      if (!haveApi || !gdApi) return { ok: false, detail: "test API absent" };
      var errsBefore = (window.__WT_ERRORS__ || []).length;
      var threw = "";
      var mode = API.state.viewMode;
      var simBefore = "", simAfter = "";
      try {
        var sim = API.state.flow.sim;
        var snap = function () {
          return sim ? JSON.stringify([sim.tick, sim.spawned, sim.completed, sim.inflight,
            sim.mus.map(function (m) { return [m.id, m.cx, m.cy, m.stage, m.status]; })]) : "";
        };
        simBefore = snap();
        API.setViewMode("top"); API.render(); gdApi.draw();
        API.setViewMode("iso"); API.render(); gdApi.draw();
        API.setViewMode(mode); API.render();
        simAfter = snap();
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      var errsAfter = (window.__WT_ERRORS__ || []).length;
      var tier = gdApi.tier();
      return { ok: !threw && errsAfter === errsBefore && simBefore === simAfter &&
          (tier === "icon" || tier === "glyph" || tier === "rich"),
        detail: threw ? "threw " + threw : "top + iso drew clean, sim untouched=" +
          (simBefore === simAfter) + "; LOD tier at this zoom = " + tier };
    });

    check("goods-trucks-carry-a-pallet-and-rest-legibly-without-a-clock", function () {
      if (!GDS || !gdApi) return { ok: false, detail: "WT.goods absent" };
      var fleet = gdApi.fleet();
      if (!fleet.length) return { ok: true, detail: "no forklift/RGV/AGV on this floor - nothing to carry" };
      var bad = [], moved = 0;
      for (var i = 0; i < fleet.length; i++) {
        var v = fleet[i];
        var rest = GDS.sampleVehicle(v, null);
        if (!rest.resting) bad.push(v.id + " not resting");
        if (rest.x < v.x - 0.8 || rest.x > v.x + v.w + 0.8 || rest.y < v.y - 0.8 || rest.y > v.y + v.d + 0.8) {
          bad.push(v.id + " load off its truck at rest");
        }
        var a = GDS.sampleVehicle(v, 0.3), b = GDS.sampleVehicle(v, 1.5);
        if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9 || Math.abs(a.z - b.z) > 1e-9) moved++;
      }
      return { ok: bad.length === 0 && moved > 0,
        detail: bad.length ? bad.slice(0, 3).join(",") : fleet.length + " trucks carrying, " + moved + " visibly moving their load" };
    });

    check("goods-racks-show-stock-inside-the-existing-fill-model", function () {
      var SH = window.WT && window.WT.shapes;
      if (!GDS || !SH || !gdApi) return { ok: false, detail: "WT.goods / WT.shapes absent" };
      var lo = 1 - SH.RICH_FILL;
      var v = gdApi.stock();
      var inBand = v === undefined || (v >= lo - 1e-9 && v <= 1 + 1e-9);
      // The same deterministic pattern, emptying and refilling in its own
      // order - and byte-identical to the pre-v3.23 picture with no scale.
      var monotone = true, unchanged = true;
      for (var seed = 0; seed < 24; seed++) {
        for (var i = 0; i < 24; i++) {
          if (SH.loaded(i, seed, undefined, 0.4) && !SH.loaded(i, seed, undefined, 0.9)) monotone = false;
          if (SH.loaded(i, seed) !== SH.loaded(i, seed, undefined, 1)) unchanged = false;
        }
      }
      return { ok: inBand && monotone && unchanged,
        detail: "stock=" + (v === undefined ? "off (plant stopped)" : v.toFixed(3)) +
          " band [" + lo.toFixed(2) + ",1] monotone=" + monotone + " unchangedWithoutScale=" + unchanged };
    });

    check("goods-no-clock-or-rng-in-the-goods-layer", function () {
      if (!GDS) return { ok: false, detail: "WT.goods absent" };
      var src = "", n = 0;
      for (var k in GDS) {
        if (typeof GDS[k] !== "function") continue;
        src += String(GDS[k]) + "\n";
        n++;
      }
      var hasClock = /Date\.now|new Date\(/.test(src);
      var hasRng = /Math\.random/.test(src);
      var hasModel = typeof GDS.formFor === "function" && typeof GDS.supportIndex === "function" &&
        typeof GDS.units === "function" && typeof GDS.draw === "function";
      return { ok: !hasClock && !hasRng && hasModel && n >= 12,
        detail: n + " goods functions scanned; clock=" + hasClock + " rng=" + hasRng + " model=" + hasModel };
    });

    /* ---- v3.24 THE PLANT READS LIKE A WORKING SHIFT ------------------
     * Manned trucks that actually haul, a congestion signal that cannot
     * strobe, trailers on the doors that are working, and floor paint
     * that agrees with the flow. These run against the LIVE app: the
     * app's own smoothing store, its own haul roster and its own draw
     * passes in BOTH view modes.
     * ---------------------------------------------------------------- */
    var SFT = window.WT && window.WT.shift;
    var sfApi = haveApi && API.shift ? API.shift : null;

    check("shift-module-present-and-honest-about-what-it-is", function () {
      if (!SFT) return { ok: false, detail: "WT.shift absent" };
      var model = typeof SFT.hauls === "function" && typeof SFT.truckPose === "function" &&
        typeof SFT.updateStore === "function" && typeof SFT.bandStep === "function" &&
        typeof SFT.docks === "function" && typeof SFT.orientArrows === "function" &&
        typeof SFT.andon === "function";
      var H = SFT.HONESTY || "";
      var honest = /READ-ONLY/i.test(H) && /NO model/i.test(H) && /NO number/i.test(H) &&
        /DRAWING FILTER/i.test(H) && /NOT a measurement/i.test(H) && H.length > 400;
      return { ok: model && honest, detail: "model=" + model + " honesty=" + H.length + " chars" };
    });

    check("shift-floor-arrows-agree-with-the-direction-the-flow-goes", function () {
      if (!SFT || !haveApi || !window.WT.floor || !window.WT.domain) {
        return { ok: false, detail: "WT.shift / floor / domain absent" };
      }
      var sim = API.state.flow && API.state.flow.sim;
      if (!sim) { API.flowPlay(); API.flowStep(); sim = API.state.flow.sim; }
      if (!sim) return { ok: false, detail: "no live sim" };
      var legs = SFT.legsOf(sim.plan);
      var pairs = window.WT.domain.facingAislePairs(API.state.elements);
      var arrows = window.WT.floor.aisleArrows(window.WT.floor.aislePaint(pairs), 6);
      var fixed = SFT.orientArrows(arrows, legs);
      var bad = [], flipped = 0;
      for (var ai = 0; ai < arrows.length; ai++) {
        var a0 = arrows[ai], b0 = fixed[ai];
        if (a0.x !== b0.x || a0.y !== b0.y || a0.size !== b0.size) bad.push("mark moved");
        var fd = SFT.dirAt(legs, b0.x, b0.y);
        if (fd && b0.dx * fd.dx + b0.dy * fd.dy < -1e-12) bad.push("arrow fights the flow");
        if (b0.flipped) flipped++;
      }
      return { ok: bad.length === 0 && legs.length > 0,
        detail: bad.length ? bad.slice(0, 2).join(",") : arrows.length + " painted arrows over " +
          legs.length + " flow legs, " + flipped + " flipped to agree, geometry untouched" };
    });

    check("shift-congestion-band-cannot-strobe-on-the-live-store", function () {
      if (!SFT || !sfApi || !haveApi) return { ok: false, detail: "WT.shift / test API absent" };
      var threw = "", bad = [], changes = 0, minGap = Infinity, samples = 0;
      try {
        API.flowPlay();
        var seen = {};
        for (var k = 0; k < 60; k++) {
          API.flowStep();
          var store = sfApi.update();
          var sim = API.state.flow.sim;
          if (!sim || !sim.stations) break;
          for (var i = 0; i < sim.stations.length; i++) {
            var st = sim.stations[i];
            var rec = SFT.readStation(store, st.id);
            if (!rec) continue;
            samples++;
            if (!isFinite(rec.level) || rec.level < 0 || rec.level > SFT.CONG.levelMax + 1e-9) {
              bad.push(st.id + " level " + rec.level);
            }
            var p = seen[st.id];
            if (!p) { seen[st.id] = p = { band: rec.band, at: null, eff: rec.eff }; }
            else {
              if (rec.band !== p.band) {
                changes++;
                if (p.at !== null) minGap = Math.min(minGap, k - p.at);
                p.at = k; p.band = rec.band;
              }
              if (rec.eff < p.eff - 1e-9) bad.push(st.id + " work clock ran backwards");
              p.eff = rec.eff;
            }
          }
        }
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      // The dwell is in SIM TICKS; Step advances a whole bucket at a time,
      // so the observed gap is converted before it is compared.
      var perStep = 8; // API.flowStep() advances FLOW_STEP_TICKS
      var gapTicks = minGap === Infinity ? Infinity : minGap * perStep;
      return { ok: !threw && bad.length === 0 && samples > 0 &&
          (gapTicks === Infinity || gapTicks >= SFT.CONG.dwell),
        detail: threw ? "threw " + threw : bad.length ? bad.slice(0, 3).join(",") :
          samples + " station samples, " + changes + " band changes, closest " +
          (gapTicks === Infinity ? "n/a" : gapTicks + " ticks") + " apart (dwell " + SFT.CONG.dwell + ")" };
    });

    check("shift-workers-pace-from-their-own-station-clock", function () {
      if (!SFT || !sfApi || !window.WT.workers) return { ok: false, detail: "WT.shift / WT.workers absent" };
      var store = sfApi.update();
      var sim = API.state.flow && API.state.flow.sim;
      if (!store || !sim || !sim.stations || !sim.stations.length) {
        return { ok: false, detail: "no live stations" };
      }
      var bad = [], found = 0;
      for (var i = 0; i < sim.stations.length; i++) {
        var st = sim.stations[i];
        var rec = sfApi.station(st.x, st.y);
        if (!rec) continue;
        found++;
        if (!(rec.pace >= SFT.CONG.paceLo - 1e-9 && rec.pace <= SFT.CONG.paceHi + 1e-9)) {
          bad.push(st.id + " pace " + rec.pace);
        }
        if (!isFinite(rec.eff) || rec.eff < 0) bad.push(st.id + " clock " + rec.eff);
      }
      // and a worker really poses from that clock rather than the raw tick
      var spec = window.WT.workers.roster(API.currentLayout())[0];
      var usesWork = true;
      if (spec) {
        var pa = JSON.stringify(window.WT.workers.sample(spec, 100, { busy: true, work: 40 }));
        var pb = JSON.stringify(window.WT.workers.sample(spec, 100, { busy: true }));
        usesWork = pa !== pb;
      }
      return { ok: bad.length === 0 && found > 0 && usesWork,
        detail: bad.length ? bad.slice(0, 3).join(",") : found + " stations paced inside [" +
          SFT.CONG.paceLo + "," + SFT.CONG.paceHi + "], workers read the station clock=" + usesWork };
    });

    check("shift-manned-trucks-haul-a-real-aisle-and-park-where-they-always-did", function () {
      if (!SFT || !haveApi) return { ok: false, detail: "WT.shift / test API absent" };
      var lib = (WT.examples && WT.examples.library) || [];
      // The shipped small halls are conveyor/RGV plants; the mega showcase
      // is the one with manned trucks on it, so the truck path is exercised
      // there and the first example is restored afterwards.
      var mega = lib.filter(function (e) { return e.config && e.config.mega; })[0];
      if (!mega) return { ok: false, detail: "no mega scenario in library" };
      var bad = [], n = 0, lanes = [], threw = "";
      try {
        API.loadExample(mega.id);
        var lay = API.currentLayout();
        var sim = API.state.flow && API.state.flow.sim;
        var trucks = SFT.hauls(lay, sim ? sim.plan : null);
        var occ = SFT.occupancy(lay.elements);
        n = trucks.length;
        for (var i = 0; i < trucks.length; i++) {
          var t = trucks[i];
          lanes.push(t.len.toFixed(1));
          // parked exactly at its own bay with no clock (the old picture)
          var rest = SFT.truckPose(t, null);
          if (Math.abs(rest.x - t.home.x) > 1e-9 || Math.abs(rest.y - t.home.y) > 1e-9 || rest.lift !== 0) {
            bad.push(t.id + " does not park at its bay");
          }
          // the lane is on the slab and clear of every other element
          for (var s = 0; s <= t.len + 1e-9; s += 0.25) {
            var x = t.home.x + t.dir.x * s, y = t.home.y + t.dir.y * s;
            if (x < 0 || y < 0 || x > lay.gridW || y > lay.gridH) bad.push(t.id + " lane leaves the slab");
            var hit = occ.get(Math.floor(x) + "," + Math.floor(y));
            if (hit != null && lay.elements[hit] && lay.elements[hit].type !== "forklift") {
              bad.push(t.id + " lane crosses a " + lay.elements[hit].type);
            }
          }
          // and the path is continuous over the whole cycle
          var prev = null, jump = 0;
          for (var q = 0; q <= 600; q++) {
            var p = SFT.truckPose(t, (q / 600) * SFT.HAUL.ticks * 1.2);
            if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.lift)) bad.push(t.id + " non-finite pose");
            if (prev) {
              var dx = p.x - prev.x, dy = p.y - prev.y;
              jump = Math.max(jump, Math.sqrt(dx * dx + dy * dy));
            }
            prev = p;
          }
          if (jump > Math.max(0.25, t.len * 0.05)) bad.push(t.id + " path jumps " + jump.toFixed(3));
        }
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      try { if (lib[0]) API.loadExample(lib[0].id); } catch (_) { /* best effort */ }
      return { ok: !threw && bad.length === 0 && n > 0,
        detail: threw ? "threw " + threw : bad.length ? bad.slice(0, 3).join(",") :
          n + " manned trucks, lanes " + lanes.join("/") + " cells, all clear of the racking, " +
          "continuous over the cycle and parked at their bays without a clock" };
    });

    check("shift-docks-carry-trailers-only-while-they-work", function () {
      if (!SFT || !sfApi || !haveApi) return { ok: false, detail: "WT.shift / test API absent" };
      var lay = API.currentLayout();
      var docks = SFT.docks(lay);
      if (!docks.length) return { ok: false, detail: "no dock doors on this floor" };
      var bad = [];
      // no sim at all -> no trailer and no open door (the pre-v3.24 picture)
      var cold = SFT.createStore();
      for (var i = 0; i < docks.length; i++) {
        var d = docks[i];
        var s0 = SFT.dockRead(cold, d, null);
        if (s0.open || s0.trailer) bad.push(d.id + " docked with the plant stopped");
        // the trailer body stands OUTSIDE the building line
        var nx = d.face.x + d.dir.x * SFT.DOCK.gap, ny = d.face.y + d.dir.y * SFT.DOCK.gap;
        if (nx > 0.001 && ny > 0.001 && nx < lay.gridW - 0.001 && ny < lay.gridH - 0.001) {
          bad.push(d.id + " trailer would stand on the floor");
        }
      }
      // running -> the working doors take a trailer
      API.flowPlay();
      for (var k = 0; k < 12; k++) { API.flowStep(); sfApi.update(); }
      var store = sfApi.store();
      var open = 0;
      for (var j = 0; j < docks.length; j++) {
        if (SFT.dockRead(store, docks[j], API.state.flow.sim).trailer) open++;
      }
      return { ok: bad.length === 0,
        detail: bad.length ? bad.slice(0, 3).join(",") : docks.length + " doors: none docked with the plant " +
          "stopped, " + open + " with a trailer once the flow is running, every trailer outside the building line" };
    });

    check("shift-draws-in-both-views-on-the-live-canvas", function () {
      if (!haveApi || !sfApi) return { ok: false, detail: "test API absent" };
      var errsBefore = (window.__WT_ERRORS__ || []).length;
      var threw = "", mode = API.state.viewMode, simBefore = "", simAfter = "";
      try {
        var sim = API.state.flow.sim;
        var snap = function () {
          return sim ? JSON.stringify([sim.tick, sim.spawned, sim.completed, sim.inflight,
            sim.stations.map(function (s) { return [s.id, s.queue.length]; })]) : "";
        };
        simBefore = snap();
        API.setViewMode("top"); API.render(); sfApi.draw();
        API.setViewMode("iso"); API.render(); sfApi.draw();
        API.setViewMode(mode); API.render();
        simAfter = snap();
      } catch (e) { threw = e && e.message ? e.message : String(e); }
      var errsAfter = (window.__WT_ERRORS__ || []).length;
      var tier = sfApi.tier();
      return { ok: !threw && errsAfter === errsBefore && simBefore === simAfter &&
          (tier === "icon" || tier === "glyph" || tier === "rich"),
        detail: threw ? "threw " + threw : "top + iso drew clean, sim untouched=" +
          (simBefore === simAfter) + "; LOD tier at this zoom = " + tier };
    });

    check("shift-andon-reads-the-run-as-shape-plus-colour-plus-words", function () {
      if (!SFT || !sfApi || !haveApi) return { ok: false, detail: "WT.shift / test API absent" };
      var live = sfApi.andon();
      var stopped = SFT.andon(null, sfApi.store(), { on: false });
      // a jammed plant reads ATTENTION off the SMOOTHED bands
      var jamStore = SFT.createStore();
      var sim = API.state.flow.sim;
      var sts = [], i, z;
      for (i = 0; i < (sim && sim.stations ? sim.stations.length : 0); i++) {
        var s = sim.stations[i];
        var q = [];
        for (z = 0; z < 40; z++) q.push(0);
        sts.push({ id: s.id, kind: s.kind, stage: s.stage, x: s.x, y: s.y, queue: q });
      }
      var jam = { tick: 0, tickAccum: 0, stations: sts, perStage: { picking: 40 }, completed: 0, inflight: 40 };
      for (i = 0; i <= 200; i++) { jam.tick = i; SFT.updateStore(jamStore, jam, { docks: [] }); }
      var hot = SFT.andon(jam, jamStore);
      var marks = {};
      marks[stopped.mark] = 1; marks[hot.mark] = 1;
      if (live) marks[live.mark] = 1;
      var distinct = 0;
      for (var mk in marks) if (marks.hasOwnProperty(mk)) distinct++;
      // the panel really shows it, with a per-state class (never colour alone)
      var el = document.querySelector(".flow-andon");
      var classed = !!el && /andon-(running|attention|stopped)/.test(el.className) && el.textContent.length > 0;
      return { ok: stopped.state === "stopped" && hot.state === "attention" && !!live &&
          distinct >= 2 && (!sts.length || hot.congested > 0) && (classed || !el),
        detail: "live=" + (live ? live.state + " " + live.mark : "none") + " stopped=" + stopped.mark +
          " jammed=" + hot.state + " " + hot.mark + " (" + hot.congested + "/" + hot.stations +
          " backed up) distinctMarks=" + distinct + " panel=" + classed };
    });

    check("shift-no-clock-or-rng-in-the-shift-layer", function () {
      if (!SFT) return { ok: false, detail: "WT.shift absent" };
      var src = "", n = 0;
      for (var k in SFT) {
        if (typeof SFT[k] !== "function") continue;
        src += String(SFT[k]) + "\n";
        n++;
      }
      var hasClock = /Date\.now|new Date\(/.test(src);
      var hasRng = /Math\.random/.test(src);
      return { ok: !hasClock && !hasRng && n >= 20,
        detail: n + " shift functions scanned; clock=" + hasClock + " rng=" + hasRng };
    });

    // ---- Restore the app to a normal, usable state ---------------------
    try {
      if (haveApi) {
        if (API.commandPalette) API.commandPalette.close(); // ensure the palette isn't left open
        API.story.stop(); // ensure no lingering tour timers/rAF
        API.flowPause();
        API.setViewMode("top");
        API.fitToFloor();
        API.render();
      }
    } catch (_) { /* restoration is best-effort */ }

    // ---- Final: driving the app introduced NO uncaught errors ----------
    // ---- v3.25 ORDER-DRIVEN ROUTING (R1) ------------------------------
    // Until v3.24 flowsim pushed EVERY handling unit onto one hardcoded
    // spine. These four checks drive the SHIPPED routing engine in the live
    // browser: the model is loaded and closed, the router reports what this
    // floor cannot do instead of quietly re-routing, a cross-docked unit
    // never enters the racking, and the legacy collapse is byte-identical.
    check("routing-model-loaded-and-closed", function () {
      var R = WT.routing, F = WT.flowsim;
      if (!R || !F) return { ok: false, detail: "WT.routing / WT.flowsim missing" };
      var want = ["legacy-spine", "full-pallet-out", "case-pick", "piece-pick", "cross-dock", "returns", "vas", "export-fragile"];
      var ids = R.ARCHETYPES.map(function (a) { return a.id; });
      var idsOk = ids.join(",") === want.join(",");
      var stages = F.STAGES;
      var closed = true;
      R.OPERATION_ORDER.forEach(function (id) {
        var op = R.OPERATIONS[id];
        if (!op || !R.ANCHORS[op.anchor] || stages.indexOf(op.stage) < 0) closed = false;
      });
      R.ARCHETYPES.forEach(function (a) {
        (a.ops || []).forEach(function (o) { if (!R.OPERATIONS[o]) closed = false; });
      });
      // A full pallet is never packed and never depalletised - the two things
      // the old single spine forced onto every unit.
      var fp = R.ARCHETYPE_BY_ID["full-pallet-out"].ops;
      var fpOk = fp.indexOf("pack") < 0 && fp.indexOf("depalletise") < 0 && fp.indexOf("wrap") >= 0;
      var labelOk = /SYNTHETIC/.test(R.SYNTHETIC_LABEL || "") && /NOT a WMS/.test(R.SYNTHETIC_LABEL || "");
      return { ok: idsOk && closed && fpOk && labelOk,
        detail: ids.length + " order types, " + R.OPERATION_ORDER.length + " operations, closed=" + closed + " fullPallet=" + fpOk };
    });
    check("routing-reports-unfulfillable-order-types-instead-of-re-routing", function () {
      var F = WT.flowsim;
      if (!F || typeof F.routingReport !== "function") return { ok: false, detail: "no routingReport" };
      // A floor with a dock, racking, a pick face and a pack bench - but NO
      // QA bench and NO wrapper. The spine still runs; the order types that
      // need the missing kit must SAY SO and name the element to place.
      var lay = { gridW: 30, gridH: 18, elements: [
        { id: "i", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
        { id: "r", type: "selective-racking", x: 8, y: 6, w: 4, d: 1 },
        { id: "c", type: "carton-flow", x: 16, y: 6, w: 3, d: 1 },
        { id: "k", type: "pack-station", x: 20, y: 12, w: 3, d: 2 },
        { id: "o", type: "dock-out", x: 24, y: 17, w: 2, d: 1 }
      ] };
      var rep = F.routingReport(lay);
      var legacyOk = rep.byArchetype["legacy-spine"].ok === true;
      var xd = rep.byArchetype["cross-dock"];
      var named = xd.ok === false && /returns-station|staging/.test(xd.message) &&
        /Nothing has been re-routed/.test(xd.message);
      // And nothing of an unfulfillable type is ever spawned.
      var plan = F.spawnPlan(lay, { seed: 5, mix: ["cross-dock"] });
      var st = F.state(plan);
      F.step(st, 120);
      var noneSpawned = plan.spawnable === false && st.blocked === true && st.spawned === 0 && st.blockedReason.length > 0;
      return { ok: legacyOk && named && noneSpawned,
        detail: "spine ok=" + legacyOk + " unfulfillable named=" + named + " spawned=" + st.spawned };
    });
    check("routing-cross-dock-never-enters-storage", function () {
      var F = WT.flowsim, R = WT.routing;
      if (!F || !R) return { ok: false, detail: "modules missing" };
      var lay = { gridW: 30, gridH: 18, elements: [
        { id: "i", type: "dock-in", x: 2, y: 0, w: 2, d: 1 },
        { id: "r", type: "selective-racking", x: 8, y: 6, w: 4, d: 1 },
        { id: "c", type: "carton-flow", x: 16, y: 6, w: 3, d: 1 },
        { id: "k", type: "pack-station", x: 20, y: 12, w: 3, d: 2 },
        { id: "s", type: "staging", x: 4, y: 12, w: 4, d: 2 },
        { id: "q", type: "returns-station", x: 25, y: 3, w: 3, d: 2 },
        { id: "o", type: "dock-out", x: 24, y: 17, w: 2, d: 1 }
      ] };
      var res = R.resolveRoute("cross-dock", F.anchors(lay), null);
      if (!res.ok) return { ok: false, detail: res.message };
      var noStorage = res.steps.every(function (s) { return s.anchor !== "storage" && s.stage !== "storage"; });
      var plan = F.spawnPlan(lay, { seed: 5, mix: ["cross-dock"] });
      var st = F.state(plan), sawStorage = false, units = 0;
      for (var i = 0; i < 200; i++) {
        F.step(st, 1);
        for (var j = 0; j < st.mus.length; j++) {
          units++;
          if (st.mus[j].stage === "storage" || st.mus[j].stage === "picking") sawStorage = true;
        }
      }
      return { ok: noStorage && !sawStorage && st.spawned > 0 && res.invariantOk,
        detail: res.steps.map(function (s) { return s.op; }).join(" > ") + " | " + st.spawned + " units, storage touched=" + sawStorage };
    });
    check("routing-legacy-collapse-is-byte-identical", function () {
      var F = WT.flowsim;
      if (!F) return { ok: false, detail: "no flowsim" };
      var lay = API.state ? { gridW: API.state.gridW, gridH: API.state.gridH, cell: API.state.cell,
        elements: API.state.elements, config: API.state.config } : null;
      if (!lay || !lay.elements || !lay.elements.length) return { ok: false, detail: "no live layout" };
      function snap(opts) {
        var st = F.state(lay, opts);
        F.step(st, 180);
        return JSON.stringify({
          spawned: st.spawned, completed: st.completed, inflight: st.inflight,
          queued: st.queued, perStage: st.perStage,
          mus: st.mus.map(function (m) { return [m.id, m.seg, +m.t.toFixed(9), +m.cx.toFixed(9), +m.cy.toFixed(9), m.stage, m.status]; })
        });
      }
      var noMix = snap({ seed: 7, loop: true });
      var legacyMix = snap({ seed: 7, loop: true, mix: ["legacy-spine"] });
      var plan = F.spawnPlan(lay, { seed: 7 });
      var oneRoute = plan.mix === null && plan.routes.length === 1 &&
        plan.routes[0].waypoints === plan.waypoints && plan.spawnShares.length === 1;
      return { ok: noMix === legacyMix && oneRoute,
        detail: "identical=" + (noMix === legacyMix) + " singleSpine=" + oneRoute + " on " + lay.elements.length + " elements" };
    });
    check("no-errors-after-drive", function () {
      var e = window.__WT_ERRORS__ || [];
      return { ok: e.length === 0, detail: e.length ? e.map(function (x) { return x.message; }).join(" | ") : "clean" };
    });

    report_result();
  }

  // ------------------------------------------------------------------
  // Emit the machine-readable result into #wt-selftest and the console.
  // ------------------------------------------------------------------
  function report_result() {
    var total = results.length;
    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.filter(function (r) { return !r.ok; });
    var line;
    if (failed.length === 0) {
      line = "WT-SELFTEST: PASS " + passed + "/" + total;
    } else {
      line = "WT-SELFTEST: FAIL " + passed + "/" + total + " :: " +
        failed.map(function (r) { return r.name; }).join(", ");
    }

    var el = $("wt-selftest");
    if (!el) {
      el = document.createElement("div");
      el.id = "wt-selftest";
      // Off to the corner, out of the way, but present in the DOM for a
      // headless reader to scrape. Not hidden (display:none) so it is always
      // reachable via textContent.
      el.style.position = "fixed";
      el.style.left = "-99999px";
      el.style.top = "0";
      el.style.whiteSpace = "pre";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = line;
    el.setAttribute("data-pass", String(passed));
    el.setAttribute("data-total", String(total));
    el.setAttribute("data-ok", failed.length === 0 ? "1" : "0");

    // Full detail for a human reading the console.
    try {
      /* eslint-disable no-console */
      console.log(line);
      results.forEach(function (r) {
        console.log((r.ok ? "  [PASS] " : "  [FAIL] ") + r.name + (r.detail ? " - " + r.detail : ""));
      });
      /* eslint-enable no-console */
    } catch (_) { /* console may be unavailable */ }

    // A convenient programmatic handle for a headless driver.
    window.__WT_SELFTEST_RESULT__ = { line: line, passed: passed, total: total, ok: failed.length === 0, results: results };
  }

  // ------------------------------------------------------------------
  // Kick off AFTER the app has booted. app.js registers its DOMContentLoaded
  // boot listener before this file runs, so a setTimeout(0) scheduled from
  // (or after) DOMContentLoaded is guaranteed to run once boot() has already
  // executed synchronously.
  // ------------------------------------------------------------------
  function kick() {
    setTimeout(function () {
      runSuite().catch(function (e) {
        results.push({ name: "selftest-runner", ok: false, detail: e && e.message ? e.message : String(e) });
        report_result();
      });
    }, 0);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", kick);
  } else {
    kick();
  }
})();
