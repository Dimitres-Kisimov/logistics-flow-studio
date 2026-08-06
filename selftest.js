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
 *     WT-SELFTEST: PASS 60/60
 *     WT-SELFTEST: FAIL 45/60 :: <comma-separated failed check names>
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

    // ---- Restore the app to a normal, usable state ---------------------
    try {
      if (haveApi) {
        API.story.stop(); // ensure no lingering tour timers/rAF
        API.flowPause();
        API.setViewMode("top");
        API.fitToFloor();
        API.render();
      }
    } catch (_) { /* restoration is best-effort */ }

    // ---- Final: driving the app introduced NO uncaught errors ----------
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
