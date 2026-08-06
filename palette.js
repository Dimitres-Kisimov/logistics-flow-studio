/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * palette.js - the Ctrl/Cmd-K COMMAND PALETTE (WT.palette).
 * ---------------------------------------------------------------------
 * UI-3, the final calm-UI piece: a power-user shortcut that reaches ANY
 * action or ANY Class Library component in one keystroke, so the visible
 * chrome can stay minimal (progressive disclosure - see FACTORY_UI_REDESIGN
 * "the command palette"). It is an ADDITIVE overlay: every existing control
 * still works; the palette is a FASTER path, not a replacement.
 *
 * TWO parts, cleanly separated so the model is headlessly verifiable:
 *
 *  1) A PURE, DOM-free MODEL (NO Date, NO RNG):
 *       - CORE_ACTIONS: the static registry of the app's toolbar/core
 *         actions. Each entry maps to an EXISTING control - either an
 *         `elementId` (a real button in index.html whose click handler is
 *         invoked, so behaviour is byte-identical to pressing it) or an
 *         `actionKey` (a named action app.js dispatches to the SAME
 *         internal handler the button uses, for actions with no 1:1
 *         button, e.g. the Analyze sub-views).
 *       - buildCommands({ tree, elements, generate }): assembles the full,
 *         deterministic command list from the REAL registries - the core
 *         actions, one "Generate <profile>" per WT.generate profile, and an
 *         "Add <component>" for EVERY component in the WT.library palette
 *         tree - so the list stays in sync with the app (no hand-kept copy).
 *       - score()/filter(): a substring + fuzzy-subsequence filter,
 *         deterministic (stable tiebreak on original order).
 *     None of these touch the DOM, so verify_palette.js runs them in Node.
 *
 *  2) A self-contained OVERLAY CONTROLLER (mount): a modal, focus-trapped,
 *     ARIA combobox/listbox search box over the command list, opened on
 *     Ctrl/Cmd-K (from anywhere, even inside a field) or the toolbar
 *     affordance. Up/Down move, Enter runs, Esc closes; reduced-motion safe
 *     (CSS). It calls back into app.js (`run`) so every command invokes the
 *     SAME handler the corresponding control does - the palette never
 *     re-implements an action.
 *
 * HONEST: a keyboard shortcut layer over the existing app - no new
 * behaviour, no data-model change. Classic script attaching to the global
 * WT namespace so it works from file://; offline, no deps, no eval.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  /* ------------------------------------------------------------------
   * 1) THE STATIC CORE-ACTION REGISTRY.
   * Each command carries EITHER `elementId` (invoke that button's click -
   * the identical handler) OR `actionKey` (app.js dispatches it to the same
   * internal handler). `hint` is an optional keyboard-shortcut badge.
   * Grouped + labelled for a calm, scannable list.
   * ------------------------------------------------------------------ */
  const CORE_ACTIONS = [
    // --- View ---
    { id: "act:toggle-view", group: "View", label: "Toggle 2D / 2.5D view", hint: "P", elementId: "isoBtn", keywords: "iso isometric 3d perspective" },
    { id: "act:fit", group: "View", label: "Fit view to floor", hint: "0", elementId: "zoomFitBtn", keywords: "zoom frame whole" },
    { id: "act:zoom-100", group: "View", label: "Reset zoom to 100%", hint: "1", elementId: "zoom100Btn", keywords: "zoom actual size" },
    { id: "act:zoom-in", group: "View", label: "Zoom in", hint: "+", elementId: "zoomInBtn", keywords: "closer magnify" },
    { id: "act:zoom-out", group: "View", label: "Zoom out", hint: "-", elementId: "zoomOutBtn", keywords: "further" },
    { id: "act:pan", group: "View", label: "Pan / hand mode", elementId: "panBtn", keywords: "move drag hand scroll" },
    { id: "act:measure", group: "View", label: "Toggle measurements & floor markings", elementId: "measureBtn", keywords: "ruler dimensions grid markings scale" },
    { id: "act:heatmap", group: "View", label: "Toggle heatmap overlay", elementId: "heatBtn", keywords: "travel distance walked density" },
    // --- Workspace ---
    { id: "act:mode", group: "Workspace", label: "Switch Warehouse / Factory mode", elementId: "modeBtn", keywords: "production assembly plant domain" },
    { id: "act:density", group: "Workspace", label: "Switch Simple / Expert density", elementId: "densityBtn", keywords: "advanced disclosure detail" },
    { id: "act:define-object", group: "Workspace", label: "Define a new object type…", elementId: "defineObjectBtn", keywords: "custom user object library class create" },
    // --- Guides ---
    { id: "act:story", group: "Guides", label: "Play Story Mode (cinematic tour)", elementId: "storyBtn", keywords: "tour camera walk cinematic" },
    { id: "act:demo", group: "Guides", label: "Run guided demo", elementId: "guidedDemoBtn", keywords: "walkthrough tour end to end" },
    { id: "act:about", group: "Guides", label: "About this app", elementId: "aboutBtn", keywords: "help how we compare honesty" },
    { id: "act:help", group: "Guides", label: "Show the quick guide", elementId: "helpBtn", keywords: "onboarding welcome intro" },
    // --- Material flow ---
    { id: "act:flow-play", group: "Material flow", label: "Play material-flow animation", elementId: "flowPlayBtn", keywords: "run boxes animate live" },
    { id: "act:flow-pause", group: "Material flow", label: "Pause material-flow animation", elementId: "flowPauseBtn", keywords: "stop halt" },
    { id: "act:flow-step", group: "Material flow", label: "Step the material flow", elementId: "flowStepBtn", keywords: "advance frame tick" },
    { id: "act:flow-reset", group: "Material flow", label: "Reset the material flow", elementId: "flowResetBtn", keywords: "clear restart" },
    // --- Analyse ---
    { id: "act:run-sim", group: "Analyse", label: "Run pick-travel simulation", elementId: "runBtn", keywords: "simulate travel distance" },
    { id: "act:wms", group: "Analyse", label: "Run WMS operations", elementId: "wmsBtn", keywords: "operations throughput stages workflow" },
    { id: "act:automation", group: "Analyse", label: "Analyse automation systems", elementId: "autoBtn", keywords: "asrs agv rgv conveyor utilisation" },
    { id: "act:compliance", group: "Analyse", label: "Run compliance check", elementId: "complBtn", keywords: "aisle din asr escape route rules" },
    { id: "act:advise", group: "Analyse", label: "Analyze layout (advisor)", elementId: "adviseBtn", keywords: "advice recommendations" },
    { id: "act:optimize", group: "Analyse", label: "Optimize layout (preview)", elementId: "optimizeBtn", keywords: "improve rearrange" },
    { id: "act:opt-factory", group: "Analyse", label: "Optimise factory (preview → accept)", elementId: "procOptBtn", keywords: "craft rpw line balance toc efficiency" },
    { id: "act:compare", group: "Analyse", label: "Compare A vs B", elementId: "compareBtn", keywords: "scenario side by side deltas" },
    { id: "act:analyze", group: "Analyse", label: "Analyze: open the analysis panel", elementId: "analyzeBtn", keywords: "bottleneck sankey cost energy" },
    { id: "act:analyze-bottleneck", group: "Analyse", label: "Analyze: Bottleneck ranking", actionKey: "analyze-bottleneck", keywords: "constraint rank resource" },
    { id: "act:analyze-sankey", group: "Analyse", label: "Analyze: Sankey flow diagram", actionKey: "analyze-sankey", keywords: "material flow volume diagram" },
    { id: "act:analyze-cost", group: "Analyse", label: "Analyze: Cost breakdown", actionKey: "analyze-cost", keywords: "capex labour cost per unit money" },
    { id: "act:analyze-energy", group: "Analyse", label: "Analyze: Energy breakdown", actionKey: "analyze-energy", keywords: "kwh power co2 energy per unit" },
    // --- Export & data ---
    { id: "act:export-ifc", group: "Export & data", label: "Export IFC (BIM)", elementId: "ifcBtn", keywords: "bim step ifc4 building download" },
    { id: "act:report-open", group: "Export & data", label: "WMS Report (printable)", elementId: "reportOpenBtn", keywords: "report print pdf consolidated" },
    { id: "act:report-json", group: "Export & data", label: "Export report JSON", elementId: "reportJsonBtn", keywords: "report json archive" },
    { id: "act:report-csv", group: "Export & data", label: "Export report summary (CSV)", elementId: "reportCsvBtn", keywords: "report csv excel kpi" },
    { id: "act:export-json", group: "Export & data", label: "Export layout JSON", elementId: "exportBtn", keywords: "download save file wt-1" },
    { id: "act:import-json", group: "Export & data", label: "Import layout JSON…", elementId: "importBtn", keywords: "open load file" },
    { id: "act:share", group: "Export & data", label: "Share layout link", elementId: "shareBtn", keywords: "url copy link fragment" },
    // --- Layout ---
    { id: "act:save", group: "Layout", label: "Save layout to this browser", elementId: "saveBtn", keywords: "store persist" },
    { id: "act:load", group: "Layout", label: "Load the saved layout", elementId: "loadBtn", keywords: "restore open" },
    { id: "act:clear", group: "Layout", label: "Clear the floor", elementId: "clearBtn", keywords: "remove all empty reset" },
    { id: "act:demo-layout", group: "Layout", label: "Load the starter demo layout", elementId: "demoBtn", keywords: "example starter sample" },
    { id: "act:scenario-save", group: "Layout", label: "Save current as a named scenario…", elementId: "scenarioSaveBtn", keywords: "store named my plants" },
    { id: "act:generate-current", group: "Generate", label: "Generate environment (selected profile)", elementId: "genBtn", keywords: "ai build layout profile" },
    { id: "act:generate-command", group: "Generate", label: "Run a plain-language command…", elementId: "genCmdBtn", keywords: "nl natural language steer edit" },
  ];

  // The set of base actionKeys app.js dispatches (verify_palette cross-checks
  // these against the switch in app.js so a command can never dangle).
  const ACTION_KEYS = ["analyze-bottleneck", "analyze-sankey", "analyze-cost", "analyze-energy"];

  /* ------------------------------------------------------------------
   * Small pure helpers.
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) { return String(s == null ? "" : s).toLowerCase(); }

  /* ------------------------------------------------------------------
   * buildCommands({ tree, elements, generate }) -> ordered command list.
   * Deterministic (fixed order: core actions, then a Generate command per
   * profile, then an Add command per palette-tree component). PURE: no DOM,
   * no Date, no RNG. `tree` is WT.library.paletteTree()'s output; `elements`
   * is WT.domain.ELEMENTS; `generate` is WT.generate (optional).
   * ------------------------------------------------------------------ */
  function buildCommands(opts) {
    opts = opts || {};
    const elements = opts.elements || {};
    const generate = opts.generate || null;
    const tree = Array.isArray(opts.tree) ? opts.tree : [];
    const cmds = [];

    // (a) Core actions (in declared order).
    for (const a of CORE_ACTIONS) {
      cmds.push({
        id: a.id,
        kind: a.elementId ? "el" : "act",
        group: a.group,
        label: a.label,
        hint: a.hint || "",
        keywords: a.keywords || "",
        elementId: a.elementId || null,
        actionKey: a.actionKey || null,
        type: null,
        profileKey: null,
      });
    }

    // (b) One "Generate <profile>" command per real generator profile - built
    // from WT.generate so it stays in sync with the generator (warehouse
    // profiles first, then factory line profiles).
    if (generate) {
      const emit = (profiles, suffix) => {
        if (!profiles) return;
        for (const key of Object.keys(profiles)) {
          const p = profiles[key] || {};
          cmds.push({
            id: "gen:" + key,
            kind: "generate",
            group: "Generate",
            label: "Generate: " + (p.label || key) + suffix,
            hint: "",
            keywords: "ai build layout " + key + " " + (p.label || ""),
            elementId: null,
            actionKey: null,
            type: null,
            profileKey: key,
          });
        }
      };
      emit(generate.plantProfiles, "");
      emit(generate.factoryProfiles, " (factory line)");
    }

    // (c) "Add <component>" for EVERY component in the Class Library tree -
    // built-ins + custom user objects - so the palette stays in sync with the
    // library registry (each carries a `type` that must exist in ELEMENTS).
    for (const g of tree) {
      if (!g || !Array.isArray(g.types)) continue;
      for (const type of g.types) {
        const def = elements[type];
        if (!def) continue; // never emit a dangling Add
        cmds.push({
          id: "add:" + type,
          kind: "place",
          group: "Add · " + g.label,
          label: "Add " + (def.label || type),
          hint: "",
          keywords: "place drop component " + (def.label || "") + " " + (def.category || "") + " " + g.label,
          elementId: null,
          actionKey: null,
          type: type,
          profileKey: null,
        });
      }
    }
    return cmds;
  }

  /* ------------------------------------------------------------------
   * score(command, query) -> number (higher = better match) or -1 for no
   * match. A calm, predictable ranking: exact-word/prefix > substring >
   * fuzzy subsequence. Deterministic; pure.
   * ------------------------------------------------------------------ */
  function score(command, query) {
    const q = norm(query).trim();
    if (!q) return 0; // empty query: everything matches, original order kept
    const label = norm(command.label);
    const hay = label + " " + norm(command.group) + " " + norm(command.keywords);
    // Substring in the LABEL scores highest (earlier = better); a word-start
    // boundary gets a bonus.
    let li = label.indexOf(q);
    if (li !== -1) {
      let s = 2000 - li;
      if (li === 0 || /\s/.test(label.charAt(li - 1))) s += 300;
      return s;
    }
    // Substring anywhere in the haystack (label+group+keywords).
    const hi = hay.indexOf(q);
    if (hi !== -1) return 1200 - Math.min(hi, 400);
    // Fuzzy: every query char appears in order in the haystack.
    let haIdx = 0, gaps = 0, matched = 0, lastHit = -1;
    for (let i = 0; i < q.length; i++) {
      const ch = q.charAt(i);
      const found = hay.indexOf(ch, haIdx);
      if (found === -1) return -1;
      if (lastHit !== -1) gaps += found - lastHit - 1;
      lastHit = found;
      haIdx = found + 1;
      matched++;
    }
    return matched === q.length ? Math.max(1, 600 - gaps) : -1;
  }

  /* ------------------------------------------------------------------
   * filter(commands, query) -> filtered + ranked list. Stable: ties keep the
   * original order (so an empty query returns the list unchanged). Pure.
   * ------------------------------------------------------------------ */
  function filter(commands, query) {
    const list = Array.isArray(commands) ? commands : [];
    const q = norm(query).trim();
    if (!q) return list.slice();
    const scored = [];
    for (let i = 0; i < list.length; i++) {
      const s = score(list[i], q);
      if (s >= 0) scored.push({ cmd: list[i], s: s, i: i });
    }
    scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
    return scored.map((x) => x.cmd);
  }

  /* ==================================================================
   * 2) THE OVERLAY CONTROLLER (mount). Lives behind the pure model so a Node
   * harness never touches it. app.js calls mount() once, supplying:
   *   getCommands() -> the live command list (rebuilt from the registries)
   *   run(command)  -> dispatch to the SAME handler the control uses
   *   reducedMotion() -> boolean (optional; CSS also honours the media query)
   * Returns { open, close, toggle, isOpen, refresh }.
   * ================================================================== */
  function mount(config) {
    config = config || {};
    const doc = window.document;
    if (!doc || !doc.getElementById) return noopController();
    const overlay = doc.getElementById("cmdPalette");
    const input = doc.getElementById("cmdPaletteInput");
    const listEl = doc.getElementById("cmdPaletteList");
    const emptyEl = doc.getElementById("cmdPaletteEmpty");
    const dialog = overlay ? overlay.querySelector(".cmdk-dialog") : null;
    const backdrop = doc.getElementById("cmdPaletteBackdrop");
    const openBtn = doc.getElementById("cmdPaletteBtn");
    if (!overlay || !input || !listEl) return noopController();

    let current = [];   // the filtered command list currently shown
    let active = -1;     // index of the active option within `current`
    let openState = false;
    let lastFocus = null;

    const getCommands = typeof config.getCommands === "function" ? config.getCommands : function () { return []; };
    const runCommand = typeof config.run === "function" ? config.run : function () {};

    function optId(i) { return "cmdPaletteOpt-" + i; }

    function renderList() {
      const q = input.value || "";
      current = filter(getCommands(), q);
      if (active < 0 && current.length) active = 0;
      if (active >= current.length) active = current.length - 1;
      let html = "";
      for (let i = 0; i < current.length; i++) {
        const c = current[i];
        const isActive = i === active;
        html +=
          '<li id="' + optId(i) + '" class="cmdk-opt' + (isActive ? " active" : "") + '" role="option" ' +
          'data-i="' + i + '" aria-selected="' + (isActive ? "true" : "false") + '">' +
          '<span class="cmdk-opt-label">' + esc(c.label) + "</span>" +
          '<span class="cmdk-opt-group">' + esc(c.group) + "</span>" +
          (c.hint ? '<kbd class="cmdk-opt-hint">' + esc(c.hint) + "</kbd>" : "") +
          "</li>";
      }
      listEl.innerHTML = html;
      const has = current.length > 0;
      if (emptyEl) emptyEl.hidden = has;
      listEl.hidden = !has;
      input.setAttribute("aria-activedescendant", (has && active >= 0) ? optId(active) : "");
      scrollActiveIntoView();
    }

    function scrollActiveIntoView() {
      if (active < 0) return;
      const el = doc.getElementById(optId(active));
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest" }); } catch (_) { /* older engines */ } }
    }

    function setActive(i) {
      if (!current.length) { active = -1; return; }
      active = Math.max(0, Math.min(current.length - 1, i));
      // Re-mark selection without a full rebuild (cheaper + keeps caret).
      const opts = listEl.querySelectorAll(".cmdk-opt");
      for (let k = 0; k < opts.length; k++) {
        const on = k === active;
        opts[k].classList.toggle("active", on);
        opts[k].setAttribute("aria-selected", on ? "true" : "false");
      }
      input.setAttribute("aria-activedescendant", active >= 0 ? optId(active) : "");
      scrollActiveIntoView();
    }

    function open() {
      if (openState) return;
      lastFocus = doc.activeElement;
      openState = true;
      overlay.hidden = false;
      overlay.classList.add("open");
      input.value = "";
      active = -1;
      renderList();
      // focus after the overlay is visible so the caret lands in the box
      try { input.focus(); } catch (_) {}
      if (input.select) { try { input.select(); } catch (_) {} }
    }

    function close() {
      if (!openState) return;
      openState = false;
      overlay.classList.remove("open");
      overlay.hidden = true;
      listEl.innerHTML = "";
      current = [];
      active = -1;
      // restore focus to where the user was (or the toolbar affordance)
      const back = lastFocus && lastFocus.focus ? lastFocus : openBtn;
      if (back && back.focus) { try { back.focus(); } catch (_) {} }
    }

    function toggle() { openState ? close() : open(); }

    function runActive() {
      if (active < 0 || active >= current.length) return;
      const cmd = current[active];
      // Close FIRST so focus/scroll effects of the command land cleanly, then
      // invoke the SAME handler the corresponding control uses.
      close();
      try { runCommand(cmd); } catch (_) { /* the app surfaces its own errors */ }
    }

    // --- input: type to filter ---
    input.addEventListener("input", function () { active = current.length ? 0 : -1; renderList(); });

    // --- keyboard on the search box (combobox pattern) ---
    input.addEventListener("keydown", function (e) {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); setActive(active + 1); break;
        case "ArrowUp": e.preventDefault(); setActive(active - 1); break;
        case "Home": e.preventDefault(); setActive(0); break;
        case "End": e.preventDefault(); setActive(current.length - 1); break;
        case "Enter": e.preventDefault(); runActive(); break;
        case "Escape": e.preventDefault(); close(); break;
        case "Tab": e.preventDefault(); break; // focus-trap: only the input is focusable
        default: break;
      }
    });

    // --- click / hover on an option ---
    listEl.addEventListener("mousemove", function (e) {
      const li = e.target && e.target.closest ? e.target.closest(".cmdk-opt") : null;
      if (li) { const i = parseInt(li.getAttribute("data-i"), 10); if (!isNaN(i) && i !== active) setActive(i); }
    });
    listEl.addEventListener("click", function (e) {
      const li = e.target && e.target.closest ? e.target.closest(".cmdk-opt") : null;
      if (!li) return;
      const i = parseInt(li.getAttribute("data-i"), 10);
      if (!isNaN(i)) { active = i; runActive(); }
    });

    // --- backdrop / outside click closes; keep the dialog focus-trapped ---
    if (backdrop) backdrop.addEventListener("mousedown", function (e) { e.preventDefault(); close(); });
    overlay.addEventListener("mousedown", function (e) {
      if (dialog && e.target === overlay) { e.preventDefault(); close(); }
    });

    // --- the toolbar affordance opens it ---
    if (openBtn) openBtn.addEventListener("click", function () { open(); });

    // --- the GLOBAL Ctrl/Cmd-K shortcut (capture phase so it wins from any
    //     focus, including inside a text field) ---
    window.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        toggle();
      }
    }, true);

    return {
      open: open,
      close: close,
      toggle: toggle,
      isOpen: function () { return openState; },
      refresh: function () { if (openState) renderList(); },
      // exposed for the in-browser self-test only (read-only inspection):
      current: function () { return current.slice(); },
      activeIndex: function () { return active; },
    };
  }

  function noopController() {
    return { open: function () {}, close: function () {}, toggle: function () {}, isOpen: function () { return false; }, refresh: function () {}, current: function () { return []; }, activeIndex: function () { return -1; } };
  }

  WT.palette = {
    CORE_ACTIONS: CORE_ACTIONS,
    ACTION_KEYS: ACTION_KEYS,
    buildCommands: buildCommands,
    score: score,
    filter: filter,
    mount: mount,
  };
})();
