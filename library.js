/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * library.js - the USER-DEFINABLE object library (WT.library).
 * ---------------------------------------------------------------------
 * The palette is NOT a fixed preset list. Exactly like Siemens Plant
 * Simulation's UserObjects (derive your own objects from the base
 * MaterialFlow classes - PartA / MyFrame / LKBox - and organise them in a
 * class tree), this module lets the user DEFINE THEIR OWN object TYPES and
 * group them into a categorised tree. The ~30 built-in equipment types are
 * editable SEEDS (clone one into a custom), not a hardcoded menu.
 *
 * A custom type is a plain object that is SHAPE-COMPATIBLE with a
 * WT.domain.ELEMENTS entry, plus three extra fields:
 *   - custom:true            (marks it user-defined)
 *   - base:"storage"|"conveyor"|"station"|"transporter"|"dock"|"zone"
 *                            (maps the type onto ONE existing simulation
 *                             behaviour class - the SAME paths the built-in
 *                             types use, keyed on `base`)
 *   - glyph:"rack"|"box"|"circle"|"vehicle"|"arrow"|"zone"
 *                            (the generic 2D glyph WT.shapes draws)
 * register() injects the def straight into WT.domain.ELEMENTS[id], so
 * EVERY existing consumer (capacity, aisle/overlap, chains, compliance,
 * the WMS/flow sim, the IFC export, the 2D + 2.5D renderers, serialize)
 * resolves it with no special-casing. Built-in ELEMENTS entries carry NO
 * `base` field, so every base-aware branch elsewhere is a strict no-op for
 * a built-in-only layout (byte-identical behaviour).
 *
 * PERSISTENCE: the library is saved to localStorage (browser only; a Node
 * harness is a no-op) and can be exported / imported as JSON, mirroring the
 * knowledge-base editor. The custom-type definitions a LAYOUT uses are also
 * embedded INTO the wt-1 serialize() output and rebuilt on deserialize(),
 * so a saved / shared layout with custom objects round-trips fully.
 *
 * DETERMINISTIC: NO Date, NO RNG anywhere here. A custom type's id is a
 * pure slug of its name (collisions get a numeric suffix by scanning the
 * existing keys) - reproducible, no wall-clock, no random-number generator.
 *
 * HONEST: custom objects are ILLUSTRATIVE schematic teaching elements, not
 * vendor specs, CAD or BIM. No frameworks, no build step; classic script
 * attaching to the global WT namespace so it works from file://.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const STORAGE_KEY = "wt-library-v1"; // localStorage key for user-defined types
  const LIB_VERSION = "wt-lib-1";

  // The six BASE behaviours a custom type can derive from. Each maps onto
  // an existing built-in simulation class (see the comment per base).
  const BASES = ["storage", "conveyor", "station", "transporter", "dock", "zone"];
  // The small set of 2D glyphs the generic renderer knows.
  const GLYPHS = ["rack", "box", "circle", "vehicle", "arrow", "zone"];
  // Sensible default glyph per base (used when the editor leaves it blank).
  const DEFAULT_GLYPH = {
    storage: "rack", conveyor: "arrow", station: "box",
    transporter: "vehicle", dock: "box", zone: "zone",
  };

  /* ------------------------------------------------------------------
   * The CATEGORISED PALETTE TREE. The seven canonical groups (collapsible
   * like the Siemens class tree). Built-ins live under their group; user-
   * defined types live under "My Objects" (or whatever category they were
   * given). GROUP_ORDER fixes the display order.
   * ------------------------------------------------------------------ */
  const MY_OBJECTS = "My Objects";
  // v2.5 FACTORY-A: the manufacturing group. It is filtered by the Warehouse
  // / Factory MODE switch (paletteTree({ mode })): hidden in Warehouse mode,
  // shown in Factory mode. Nothing is ever deleted - both modes are reachable.
  const PRODUCTION = "Production / Assembly";
  const GROUP_ORDER = [
    "Storage & Racking",
    "Conveying & Sortation",
    "Stations",
    "Transport",
    "Docks & Endpoints",
    "Zones",
    PRODUCTION,
    MY_OBJECTS,
  ];
  // Which built-in type sits in which group (display only; the built-ins are
  // untouched). Any built-in not listed falls back by its domain category.
  const BUILTIN_GROUP = {
    "selective-racking": "Storage & Racking", "block-stack": "Storage & Racking",
    "drive-in": "Storage & Racking", "double-deep": "Storage & Racking",
    "push-back": "Storage & Racking", "pallet-flow": "Storage & Racking",
    "carton-flow": "Storage & Racking", "mobile-racking": "Storage & Racking",
    "cantilever": "Storage & Racking", "asrs": "Storage & Racking",
    "shuttle": "Storage & Racking", "mezzanine": "Storage & Racking",
    "pick-to-light": "Storage & Racking", "vna": "Storage & Racking",
    "conveyor": "Conveying & Sortation", "conveyor-curve": "Conveying & Sortation",
    "sorter": "Conveying & Sortation",
    "push-station": "Stations", "pull-station": "Stations",
    "pack-station": "Stations", "returns-station": "Stations",
    "stretch-wrap": "Stations", "charging-station": "Stations",
    "forklift": "Stations",
    "rgv": "Transport", "agv": "Transport",
    "dock-in": "Docks & Endpoints", "dock-out": "Docks & Endpoints",
    "staging": "Docks & Endpoints",
    "gate": "Zones",
    // v2.5 FACTORY-A manufacturing components (Production / Assembly group).
    "mfg-source": PRODUCTION, "mfg-drain": PRODUCTION, "mfg-station": PRODUCTION,
    "mfg-parallel-station": PRODUCTION, "mfg-assembly": PRODUCTION, "mfg-dismantle": PRODUCTION,
  };
  // The base each built-in maps onto (so a CLONE of a built-in gets a sane
  // base). Used only when cloning; the built-in itself is never modified.
  const BUILTIN_BASE = {
    "selective-racking": "storage", "block-stack": "storage", "drive-in": "storage",
    "double-deep": "storage", "push-back": "storage", "pallet-flow": "storage",
    "carton-flow": "storage", "mobile-racking": "storage", "cantilever": "storage",
    "asrs": "storage", "shuttle": "storage", "mezzanine": "storage",
    "pick-to-light": "storage", "vna": "storage",
    "conveyor": "conveyor", "conveyor-curve": "conveyor", "sorter": "conveyor",
    "push-station": "station", "pull-station": "station", "pack-station": "station",
    "returns-station": "station", "stretch-wrap": "station", "charging-station": "station",
    "forklift": "station",
    "rgv": "transporter", "agv": "transporter",
    "dock-in": "dock", "dock-out": "dock", "staging": "dock",
    "gate": "zone",
    // v2.5 FACTORY-A: cloning a manufacturing built-in seeds the right base
    // (Source/Drain -> dock endpoint, the Station family -> station server).
    "mfg-source": "dock", "mfg-drain": "dock", "mfg-station": "station",
    "mfg-parallel-station": "station", "mfg-assembly": "station", "mfg-dismantle": "station",
  };

  // The live store of user-defined types, keyed by id (insertion order kept
  // via customOrder so the palette + export are stable).
  const custom = {};
  const customOrder = [];

  /* ------------------------------------------------------------------
   * Small pure helpers (NO Date, NO RNG).
   * ------------------------------------------------------------------ */
  const D = () => WT.domain || {};
  const ELEMENTS = () => (WT.domain && WT.domain.ELEMENTS) || {};
  function clampInt(v, lo, hi, dflt) {
    let n = Math.round(Number(v));
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function clampNum(v, lo, hi, dflt) {
    let n = Number(v);
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function isHexColor(s) { return typeof s === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s); }

  // A deterministic slug of a name. NO Date, NO RNG.
  function slug(name) {
    const s = String(name == null ? "" : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || "object";
  }
  // A unique id for a new custom type: "u-" + slug, with a numeric suffix if
  // that key is already taken (by a built-in OR another custom). Pure
  // function of (name, existing keys) - NO Date, NO RNG.
  function uniqueId(name, ignoreId) {
    const base = "u-" + slug(name);
    const taken = (id) => id !== ignoreId && (ELEMENTS()[id] || custom[id]);
    if (!taken(base)) return base;
    for (let i = 2; i < 100000; i++) {
      const cand = base + "-" + i;
      if (!taken(cand)) return cand;
    }
    return base + "-x";
  }

  /* ------------------------------------------------------------------
   * buildDef(input) -> a full ELEMENTS-compatible custom definition.
   * `input` is the editor form:
   *   { id?, name, category, base, w, d, height, color, glyph, params }
   * where `params` carries the base-specific behaviour knobs. Everything
   * is clamped to a safe, finite range. The output is DETERMINISTIC.
   * ------------------------------------------------------------------ */
  function buildDef(input) {
    input = input || {};
    const base = BASES.indexOf(input.base) !== -1 ? input.base : "storage";
    const name = String(input.name || "Custom object").trim() || "Custom object";
    const id = (typeof input.id === "string" && input.id) ? input.id : uniqueId(name);
    const glyph = GLYPHS.indexOf(input.glyph) !== -1 ? input.glyph : DEFAULT_GLYPH[base];
    const category = base === "storage" ? "storage" : "flow"; // domain sim class
    const paletteCategory = String(input.category || MY_OBJECTS).trim() || MY_OBJECTS;
    const w = clampInt(input.w, 1, 200, 4);
    const d = clampInt(input.d, 1, 200, 2);
    const heightM = clampNum(input.height, 0.1, 60, 3);
    const color = isHexColor(input.color) ? input.color : "#0ea5e9";
    const p = input.params || {};

    const def = {
      id: id, label: name, category: category, custom: true, base: base,
      glyph: glyph, paletteCategory: paletteCategory,
      w: w, d: d, color: color, heightM: heightM, resizable: true,
    };

    if (base === "storage") {
      def.density = clampNum(p.density, 0.1, 12, 2.0);
      def.levels = clampInt(p.levels, 1, 20, 3);
      def.selectivity = clampNum(p.selectivity, 0.05, 1, 1.0);
      def.rotation = String(p.rotation || "FIFO");
      def.costIndex = clampInt(p.costIndex, 1, 12, 4);
      if (p.pickFace) def.pickFace = true;
      if (isFinite(Number(p.handlingDeltaSec))) def.handlingDeltaSec = clampNum(p.handlingDeltaSec, -20, 40, 0);
      def.desc = "User-defined STORAGE object (base: storage). Contributes " +
        "pallet-equivalent positions at " + def.density + " pos/m^2 across " +
        def.levels + " level(s); " + Math.round(def.selectivity * 100) + "% selective. " +
        "Illustrative teaching element, NOT a vendor spec.";
    } else if (base === "conveyor") {
      def.unitsPerHr = clampInt(p.unitsPerHr, 1, 100000, 180);
      def.transport = true;
      def.desc = "User-defined CONVEYING object (base: conveyor). Carries unit-loads " +
        "along the flow at ~" + def.unitsPerHr + " units/hr; holds 0 storage positions. " +
        "Illustrative teaching element, NOT a vendor spec.";
    } else if (base === "station") {
      def.cycleSec = clampNum(p.cycleSec, 0.5, 3600, 30);
      def.throughputPerHr = Math.max(1, Math.round(3600 / def.cycleSec));
      def.stationServer = true; // acts as a FIFO server in the flow sim
      def.desc = "User-defined STATION object (base: station). Acts as a server with a " +
        def.cycleSec + " s cycle time (~" + def.throughputPerHr + " units/hr); holds 0 " +
        "storage positions. Illustrative teaching element, NOT a vendor spec.";
    } else if (base === "transporter") {
      def.movesPerHr = clampInt(p.movesPerHr, 1, 100000, 30);
      def.speedMps = clampNum(p.speedMps, 0.1, 10, 1.2);
      def.transport = true;
      if (isFinite(Number(p.aisleWidthM))) def.aisleWidthM = clampNum(p.aisleWidthM, 0.5, 8, 1.6);
      def.desc = "User-defined TRANSPORTER object (base: transporter). Mobile: carries loads " +
        "between zones at ~" + def.speedMps + " m/s (~" + def.movesPerHr + " moves/hr); holds 0 " +
        "storage positions. Illustrative teaching element, NOT a vendor spec.";
    } else if (base === "dock") {
      def.io = p.io === "receiving" ? "receiving" : "shipping";
      def.desc = "User-defined DOCK / ENDPOINT object (base: dock). A flow " +
        (def.io === "receiving" ? "SOURCE (goods enter here)" : "SINK (goods leave here)") +
        "; holds 0 storage positions. Illustrative teaching element, NOT a vendor spec.";
    } else { // zone
      def.zoneMark = true;
      def.desc = "User-defined ZONE object (base: zone). A floor marking / boundary; " +
        "holds 0 storage positions and does not process flow. Illustrative teaching element.";
    }
    return def;
  }

  /* ------------------------------------------------------------------
   * REGISTRY. register() injects the def into WT.domain.ELEMENTS so every
   * consumer resolves it. Returns the registered def (or null on bad input).
   * ------------------------------------------------------------------ */
  function isCustom(type) { return !!custom[type]; }
  function get(type) { return custom[type] || null; }
  function list() { return customOrder.map((id) => custom[id]); }

  function registerDef(def, opts) {
    if (!def || typeof def.id !== "string" || !def.id) return null;
    if (!def.custom || BASES.indexOf(def.base) === -1) return null;
    const els = ELEMENTS();
    // Never clobber a BUILT-IN type; only own our u-* / custom keys.
    if (els[def.id] && !custom[def.id]) return null;
    els[def.id] = def;
    if (!custom[def.id]) customOrder.push(def.id);
    custom[def.id] = def;
    if (!opts || opts.persist !== false) persist();
    return def;
  }

  // Create + register a brand-new custom type from an editor form.
  function define(input) {
    const def = buildDef(input);
    return registerDef(def, { persist: true });
  }

  // Edit an existing custom type in place (keeps its id, so placed elements
  // and saved layouts still resolve it). Returns the updated def or null.
  function update(id, input) {
    if (!custom[id]) return null;
    const merged = Object.assign({}, input, { id: id });
    const def = buildDef(merged);
    def.id = id; // force-keep the id
    ELEMENTS()[id] = def;
    custom[id] = def;
    persist();
    return def;
  }

  // Clone any type (built-in OR custom) into a NEW custom type. Built-ins are
  // SEEDS: cloning copies their footprint / colour / behaviour into an
  // editable custom, and never removes the original.
  function clone(sourceType, newName) {
    const src = ELEMENTS()[sourceType];
    if (!src) return null;
    const base = src.custom ? src.base : (BUILTIN_BASE[sourceType] || (src.category === "storage" ? "storage" : "station"));
    const name = String(newName || (src.label + " copy")).trim();
    const input = {
      name: name,
      category: src.custom ? src.paletteCategory : MY_OBJECTS,
      base: base,
      w: src.w, d: src.d, height: src.heightM, color: src.color,
      glyph: src.glyph || DEFAULT_GLYPH[base],
      params: {
        density: src.density, levels: src.levels, selectivity: src.selectivity,
        rotation: src.rotation, costIndex: src.costIndex, pickFace: src.pickFace,
        handlingDeltaSec: src.handlingDeltaSec,
        unitsPerHr: src.unitsPerHr, cycleSec: src.cycleSec,
        movesPerHr: src.movesPerHr, speedMps: src.speedMps, aisleWidthM: src.aisleWidthM,
        io: src.io,
      },
    };
    return define(input);
  }

  // Delete a custom type (built-ins can never be deleted). Returns true if
  // removed. Callers should also drop any placed elements of this type.
  function remove(id) {
    if (!custom[id]) return false;
    delete custom[id];
    const i = customOrder.indexOf(id);
    if (i !== -1) customOrder.splice(i, 1);
    const els = ELEMENTS();
    if (els[id] && els[id].custom) delete els[id];
    persist();
    return true;
  }

  /* ------------------------------------------------------------------
   * The categorised palette tree the UI renders. Returns an ordered array
   * of { key, label, types:[typeId,...] }. Empty canonical groups are
   * dropped EXCEPT "My Objects" (always shown so the user sees where their
   * definitions land). Custom categories outside the canonical set get
   * their own group appended in first-seen order.
   *
   * v2.5 FACTORY-A: the Warehouse / Factory MODE switch. `opts.mode` is
   * "warehouse" | "factory":
   *   - "warehouse" HIDES the "Production / Assembly" manufacturing group
   *     (a warehouse layout does not need the factory parts) - the spec's
   *     declutter lever;
   *   - "factory" (or ANY other value, incl. none) SHOWS every group.
   * Nothing is ever deleted - a hidden group's types stay in the domain and
   * are reachable by switching mode. A pure function of (mode, registry);
   * no DOM, no localStorage (the caller owns persistence). NO Date, NO RNG.
   * ------------------------------------------------------------------ */
  function paletteTree(opts) {
    const mode = opts && typeof opts.mode === "string" ? opts.mode : null;
    const hideProduction = mode === "warehouse"; // Factory (and default) shows it
    const els = ELEMENTS();
    const order = (D().paletteOrder || []).slice();
    const groups = {};
    const groupList = [];
    function ensure(label) {
      if (!groups[label]) { groups[label] = { key: label, label: label, types: [] }; groupList.push(label); }
      return groups[label];
    }
    GROUP_ORDER.forEach(ensure); // seed canonical order
    // Built-ins in their group.
    for (const id of order) {
      const def = els[id];
      if (!def || def.custom) continue;
      ensure(BUILTIN_GROUP[id] || (def.category === "storage" ? "Storage & Racking" : "Docks & Endpoints")).types.push(id);
    }
    // Custom types under their chosen category (default My Objects).
    for (const id of customOrder) {
      const def = custom[id];
      if (!def) continue;
      ensure(def.paletteCategory || MY_OBJECTS).types.push(id);
    }
    return groupList
      .map((label) => groups[label])
      .filter((g) => g.types.length > 0 || g.label === MY_OBJECTS)
      .filter((g) => !(hideProduction && g.label === PRODUCTION));
  }

  /* ------------------------------------------------------------------
   * wt-1 ROUND-TRIP. embedInto() adds the custom-type defs a layout USES
   * into the serialize() object - but ONLY when the layout actually uses
   * custom types, so a default (no-custom) layout is byte-identical to
   * before (no `library` key is added). rebuildFrom() re-registers embedded
   * defs on deserialize so a shared layout renders + simulates its objects.
   * ------------------------------------------------------------------ */
  function defsForElements(elements) {
    const seen = {};
    const out = [];
    for (const e of (elements || [])) {
      const t = e && e.type;
      if (t && custom[t] && !seen[t]) { seen[t] = 1; out.push(cloneDef(custom[t])); }
    }
    return out;
  }
  function cloneDef(def) { return JSON.parse(JSON.stringify(def)); }

  // Mutates `obj` ONLY if the layout uses custom types (adds obj.library).
  // Returns obj either way, so a no-custom layout stays byte-identical.
  function embedInto(obj, elements) {
    const defs = defsForElements(elements);
    if (defs.length) obj.library = defs;
    return obj;
  }

  // Register every embedded def from a deserialized layout. Existing customs
  // with the same id are kept (the user's own edits win); genuinely new ones
  // are added + persisted so a shared layout's objects join My Objects.
  function rebuildFrom(obj) {
    if (!obj || !Array.isArray(obj.library)) return 0;
    let added = 0;
    for (const raw of obj.library) {
      if (!raw || typeof raw.id !== "string") continue;
      if (custom[raw.id] || (ELEMENTS()[raw.id] && !custom[raw.id])) continue; // keep existing / never clobber built-ins
      const def = buildDef(Object.assign({}, raw, {
        name: raw.label, category: raw.paletteCategory, height: raw.heightM,
        params: raw,
      }));
      def.id = raw.id;
      if (registerDef(def, { persist: false })) added++;
    }
    if (added) persist();
    return added;
  }

  /* ------------------------------------------------------------------
   * Import / export (mirrors the KB editor). export = the whole library;
   * import validates + registers each type, returns a small report.
   * ------------------------------------------------------------------ */
  function exportJson() {
    return JSON.stringify({ version: LIB_VERSION, types: list().map(cloneDef) }, null, 2);
  }
  function importJson(str) {
    let data;
    try { data = JSON.parse(str); } catch (e) { return { ok: false, added: 0, error: "not valid JSON" }; }
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.types) ? data.types : null);
    if (!arr) return { ok: false, added: 0, error: "no `types` array" };
    let added = 0; const errors = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") { errors.push("skipped a non-object entry"); continue; }
      const input = {
        id: (typeof raw.id === "string" && raw.id) ? raw.id : undefined,
        name: raw.label || raw.name, category: raw.paletteCategory || raw.category,
        base: raw.base, w: raw.w, d: raw.d, height: raw.heightM || raw.height,
        color: raw.color, glyph: raw.glyph, params: raw.params || raw,
      };
      const def = buildDef(input);
      if (def.id && !(ELEMENTS()[def.id] && !custom[def.id])) {
        // avoid overwriting a built-in; allow overwriting an own custom
        ELEMENTS()[def.id] = def;
        if (!custom[def.id]) customOrder.push(def.id);
        custom[def.id] = def;
        added++;
      } else { errors.push("skipped " + (raw.label || raw.id || "an entry")); }
    }
    persist();
    return { ok: added > 0, added: added, errors: errors };
  }

  /* ------------------------------------------------------------------
   * Optional persistence (guarded). In Node harnesses window.localStorage
   * is absent, so these are no-ops and the library is purely in-memory.
   * ------------------------------------------------------------------ */
  function persist() {
    try {
      const ls = window.localStorage;
      if (!ls) return;
      const types = list().map(cloneDef);
      if (!types.length) { ls.removeItem(STORAGE_KEY); return; }
      ls.setItem(STORAGE_KEY, JSON.stringify({ version: LIB_VERSION, types: types }));
    } catch (_) { /* storage may be unavailable/full - the library still works in-memory */ }
  }
  function loadPersisted() {
    try {
      const ls = window.localStorage;
      if (!ls) return;
      const raw = ls.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const arr = data && Array.isArray(data.types) ? data.types : null;
      if (!arr) return;
      for (const t of arr) {
        if (!t || typeof t.id !== "string") continue;
        if (ELEMENTS()[t.id] && !custom[t.id]) continue; // never clobber a built-in
        const def = buildDef(Object.assign({}, t, {
          name: t.label, category: t.paletteCategory, height: t.heightM, params: t,
        }));
        def.id = t.id;
        registerDef(def, { persist: false });
      }
    } catch (_) { /* ignore corrupt persisted state */ }
  }

  // Remove every user-defined type (built-ins are never touched).
  function reset() {
    for (const id of customOrder.slice()) remove(id);
  }

  WT.library = {
    BASES: BASES,
    GLYPHS: GLYPHS,
    GROUP_ORDER: GROUP_ORDER,
    MY_OBJECTS: MY_OBJECTS,
    PRODUCTION: PRODUCTION,
    BUILTIN_BASE: BUILTIN_BASE,
    buildDef: buildDef,
    define: define,
    update: update,
    clone: clone,
    remove: remove,
    reset: reset,
    register: registerDef,
    isCustom: isCustom,
    get: get,
    list: list,
    paletteTree: paletteTree,
    // wt-1 round-trip
    embedInto: embedInto,
    rebuildFrom: rebuildFrom,
    defsForElements: defsForElements,
    // import / export
    exportJson: exportJson,
    importJson: importJson,
  };

  // Restore any persisted user-defined types (browser only; no-op in Node).
  loadPersisted();
})();
