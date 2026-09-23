/* =====================================================================
 * Logistics Flow Studio - verify_library_preview.js
 * v3.48 THE LIBRARY SHOWS WHAT YOU PLACE - headless verification
 * ---------------------------------------------------------------------
 * The Class Library's swatches used to collapse to the LOD icon: the
 * painter passed the footprint in cells where draw2D expects pixels, and a
 * 28 px box never reaches the glyph tier. Now every entry draws the SAME
 * glyph the floor draws, aspect-true in a 56 x 36 box (draw2D's
 * `thumbnail` flag skips the on-screen footprint guard - nothing on the
 * floor passes it), with the goods the type handles on it
 * (WT.goods.formForType), a hover card from WT.library.describe, and a
 * placement ghost that shows where the armed / dragged type would land and
 * whether the spot is legal. This harness proves:
 *   1. the thumbnail flag reaches the glyph tier for every type in both
 *      themes (more drawing calls than the icon-tier control, all finite,
 *      draw2D returns true), and the guard line is the one line changed;
 *   2. thumbGeometry is aspect-true (five hand cases, invariants over the
 *      whole catalogue);
 *   3. formForType is total over the palette, deterministic, mutates
 *      nothing, and pins the pairs a reader expects;
 *   4. describe() mirrors the domain (never a literal), null for unknown;
 *   5. ghostCandidate in the manual-placement context: overlap, clamp at
 *      the edge, the reserved zone, an unknown type;
 *   6. shipped wiring: the ghost drawer and its events, setDragImage, the
 *      CSS without !important, the view toggle, the self-test names, the
 *      cache pin, the runner;
 *   7. (v3.49) the machine catalogue: the klt / workpiece forms, the
 *      MACHINE_STAGE_FORM table behind a flag, formForType, describe().
 * ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = global;
if (!global.matchMedia) global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
for (const f of ["domain.js", "iso.js", "shapes.js", "workers.js", "goods.js", "library.js"]) {
  (0, eval)(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
const D = global.WT.domain, S = global.WT.shapes, G = global.WT.goods, L = global.WT.library, I = global.WT.iso;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const app = read("app.js");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (detail ? " - " + detail : ""));
}

/* ---- the recording mock context of verify_shapes.js ------------------- */
function makeCtx() {
  const ctx = { _bad: [], _calls: 0 };
  const num = (name, args) => { ctx._calls++; for (const n of args) if (typeof n === "number" && !isFinite(n)) ctx._bad.push(name + "=" + n); };
  ctx.save = () => {}; ctx.restore = () => {};
  ctx.beginPath = () => {}; ctx.closePath = () => {};
  ctx.moveTo = (x, y) => num("moveTo", [x, y]);
  ctx.lineTo = (x, y) => num("lineTo", [x, y]);
  ctx.arc = (x, y, r, a, b) => num("arc", [x, y, r, a, b]);
  ctx.arcTo = (x1, y1, x2, y2, r) => num("arcTo", [x1, y1, x2, y2, r]);
  ctx.rect = (x, y, w, h) => num("rect", [x, y, w, h]);
  ctx.fillRect = (x, y, w, h) => num("fillRect", [x, y, w, h]);
  ctx.strokeRect = (x, y, w, h) => num("strokeRect", [x, y, w, h]);
  ctx.ellipse = (x, y, rx, ry) => num("ellipse", [x, y, rx, ry]);
  ctx.quadraticCurveTo = (a, b, c, d) => num("quadraticCurveTo", [a, b, c, d]);
  ctx.bezierCurveTo = (a, b, c, d, e, f) => num("bezierCurveTo", [a, b, c, d, e, f]);
  ctx.fill = () => {}; ctx.stroke = () => {}; ctx.clip = () => {}; ctx.scale = () => {}; ctx.translate = () => {}; ctx.rotate = () => {};
  ctx.setLineDash = () => {};
  ctx.measureText = (t) => ({ width: String(t).length * 6 });
  ctx.fillText = () => {}; ctx.strokeText = () => {};
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  ctx.fillStyle = ""; ctx.strokeStyle = ""; ctx.lineWidth = 1; ctx.lineJoin = ""; ctx.lineCap = "";
  ctx.font = ""; ctx.textAlign = ""; ctx.textBaseline = ""; ctx.globalAlpha = 1;
  return ctx;
}

/* ---- the pure app.js helpers, extracted like verify_manual_placement.js -- */
function extract(name) {
  const m = app.match(new RegExp("  function " + name + "\\([^]*?\\n  }"));
  if (!m) throw new Error("app.js has no function " + name);
  return m[0];
}
const helperCtx = {};
vm.createContext(helperCtx);
vm.runInContext(extract("thumbGeometry"), helperCtx);
const thumbGeometry = helperCtx.thumbGeometry;

/* ---- 1. the thumbnail flag reaches the glyph tier ---------------------- */
(function () {
  const types = D.paletteOrder;
  const CW = 56, CH = 36, PAD = 2;
  let ok = true, worst = null;
  for (const theme of ["light", "dark"]) {
    for (const t of types) {
      const def = D.ELEMENTS[t];
      const g = thumbGeometry(def.w, def.d, CW, CH, PAD);
      const base = { x: g.x, y: g.y, w: g.gw, d: g.gd, cellPx: g.cellPx, color: def.color, theme: theme, seed: 0, arc: def.arc, base: def.base };
      const flag = makeCtx(), ctrl = makeCtx();
      const okFlag = S.draw2D(flag, t, Object.assign({}, base, { lod: Math.max(S.DETAIL_GLYPH_MIN, g.cellPx), thumbnail: true }));
      const okCtrl = S.draw2D(ctrl, t, Object.assign({}, base, { lod: 3 }));
      const good = okFlag === true && okCtrl === true && flag._bad.length === 0 && ctrl._bad.length === 0 && flag._calls > ctrl._calls;
      if (!good && !worst) worst = t + "@" + theme + " flag=" + flag._calls + " ctrl=" + ctrl._calls + " bad=" + flag._bad.length;
      ok = ok && good;
    }
  }
  check("1a. with `thumbnail: true` every palette type draws MORE than its icon-tier control in both themes, all finite, draw2D true (" + types.length + " types)", ok, worst || types.length * 2 + " draws");
  const sh = read("shapes.js");
  check("1b. the footprint guard is the one line changed and it keys on g.thumbnail === true", (sh.match(/g\.thumbnail/g) || []).length === 1 && sh.indexOf("const tinyFootprint = g.thumbnail !== true && (w * scale < LOD_MIN_W || d * scale < LOD_MIN_H);") >= 0);
  const noFlag = makeCtx();
  const def = D.ELEMENTS["selective-racking"], g = thumbGeometry(def.w, def.d, CW, CH, PAD);
  const lodSame = Math.max(S.DETAIL_GLYPH_MIN, g.cellPx); // the same detail tier both times: only the footprint guard differs
  S.draw2D(noFlag, "selective-racking", { x: g.x, y: g.y, w: g.gw, d: g.gd, cellPx: g.cellPx, color: def.color, theme: "light", lod: lodSame });
  const withFlag = makeCtx();
  S.draw2D(withFlag, "selective-racking", { x: g.x, y: g.y, w: g.gw, d: g.gd, cellPx: g.cellPx, color: def.color, theme: "light", lod: lodSame, thumbnail: true });
  check("1c. the 6 x 1 rack at 56 x 36 is 52 x 8.67 px: at the same detail tier, without the flag the footprint guard (22 px) collapses it to the icon, with the flag it draws the rack", noFlag._calls < withFlag._calls && g.gd < 22, noFlag._calls + " vs " + withFlag._calls + " calls, gd " + g.gd.toFixed(2));
})();

/* ---- 2. thumbGeometry -------------------------------------------------- */
(function () {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const c = (w, d) => thumbGeometry(w, d, 56, 36, 2);
  const a = c(3, 2), b = c(2, 1), e = c(6, 4), f = c(8, 4), h = c(1, 1);
  check("2a. hand cases: 3x2 -> 16 px/cell at (4,2); 2x1 -> 26 at (2,5); 6x4 -> 8; 8x4 -> 6.5; 1x1 -> 32 at (12,2)",
    near(a.cellPx, 16) && near(a.x, 4) && near(a.y, 2) && near(b.cellPx, 26) && near(b.x, 2) && near(b.y, 5) && near(e.cellPx, 8) && near(f.cellPx, 6.5) && near(h.cellPx, 32) && near(h.x, 12) && near(h.y, 2),
    [a.cellPx, b.cellPx, e.cellPx, f.cellPx, h.cellPx].join("/"));
  let ok = true;
  for (const t of D.paletteOrder) {
    const def = D.ELEMENTS[t], g = c(def.w, def.d);
    if (!(g.cellPx >= 3 && g.gw <= 56 + 1e-9 && g.gd <= 36 + 1e-9 && near(g.gw / g.gd, def.w / def.d) && g.x >= 0 && g.y >= 0)) { ok = false; break; }
  }
  check("2b. over the whole catalogue: cellPx >= 3, the box never overflows 56 x 36, the aspect ratio is exact, the glyph is centred", ok);
  check("2c. a degenerate 0 x 0 footprint is treated as 1 x 1", near(c(0, 0).cellPx, 32));
})();

/* ---- 3. formForType ---------------------------------------------------- */
(function () {
  const types = D.paletteOrder;
  const forms = types.map((t) => G.formForType(t));
  check("3a. total over the palette: every type gives null or a FORMS member; at least 40 handle goods", forms.every((f) => f === null || G.FORMS.indexOf(f) >= 0) && forms.filter((f) => f).length >= 40, forms.filter((f) => f).length + " of " + types.length);
  const pins = { "selective-racking": "pallet-load", "carton-flow": "carton", "conveyor": "carton", "pack-station": "parcel", "push-station": "tote", "mfg-station": "workpiece", "mfg-source": "klt", "cnc-mill": "workpiece", "cmm-inspection": "workpiece", "stretch-wrap": "wrapped-pallet", "forklift": "pallet", "dock-out": "parcel", "pipe": null, "gate": null, "asrs": "pallet-load", "rgv": "pallet-load", "sorter": "carton" };
  check("3b. the pairs a reader expects", Object.keys(pins).every((k) => G.formForType(k) === pins[k]), Object.keys(pins).map((k) => k + "=" + G.formForType(k)).join(" "));
  check("3c. deterministic; unknown types are null; the table is not mutated", JSON.stringify(forms) === JSON.stringify(types.map((t) => G.formForType(t))) && G.formForType("nope") === null && G.formForType(undefined) === null && Object.isFrozen(G.TYPE_FORM) === false && JSON.stringify(G.TYPE_FORM).indexOf("nope") < 0);
  check("3d. every handled form has a nominal size", forms.filter((f) => f).every((f) => G.sizeOf(f) && G.sizeOf(f).f > 0 && G.sizeOf(f).l > 0 && G.sizeOf(f).z > 0));
})();

/* ---- 4. describe ------------------------------------------------------- */
(function () {
  const r = L.describe("selective-racking");
  const def = D.ELEMENTS["selective-racking"];
  const cap = String(D.elementCapacity({ type: "selective-racking", w: def.w, d: def.d }));
  check("4a. selective racking: label, group, footprint, height and the pallet-position row taken from the domain", !!r && r.label === def.label && r.group === "Storage & Racking" && r.footprint === def.w + " × " + def.d + " m" && r.heightM === I.elementHeight("selective-racking") &&
    r.rows.some((x) => x[0] === "Pallet positions" && x[1] === cap) && r.handles === "pallet-load" && typeof r.glyph2d === "string" && r.glyph2d.length > 3, r ? r.footprint + " · " + cap : "null");
  const m = L.describe("mfg-station");
  check("4b. a station: the cycle-time row is labelled a teaching value and the domain's numbers", !!m && m.rows.some((x) => x[0] === "Cycle time" && x[1] === D.ELEMENTS["mfg-station"].cycleSec + " s × " + (D.ELEMENTS["mfg-station"].servers || 1) + " server (teaching value)") && m.handles === "workpiece" && m.group === L.PRODUCTION); // v3.49: a station handles workpieces (was tote in v3.48)
  const rs = L.describe("selective-racking", { w: 12, d: 1 });
  check("4c. a resized element describes its own footprint and capacity", !!rs && rs.footprint === "12 × 1 m" && rs.rows.some((x) => x[0] === "Pallet positions" && x[1] === String(D.elementCapacity({ type: "selective-racking", w: 12, d: 1 }))));
  check("4d. unknown -> null; deterministic; every palette type describes", L.describe("nope") === null && JSON.stringify(L.describe("conveyor")) === JSON.stringify(L.describe("conveyor")) && D.paletteOrder.every((t) => L.describe(t) && L.describe(t).desc.length > 0));
})();

/* ---- 5. ghostCandidate in the manual-placement context ------------------ */
(function () {
  require("./view.js");
  const fields = { optConstraints: { value: '{"zones":[{"x":2,"y":1,"w":1,"d":2}],"fixedIds":[]}' } };
  const context = { GRID_W: 20, GRID_H: 20, CELL_M: 0.5, state: { elements: [{ id: "a", type: "rack", x: 2, y: 2, w: 2, d: 1 }], selectedId: null, flow: { playing: false }, idCounter: 0 },
    ELEMENTS: { rack: { w: 2, d: 1, label: "Rack" }, huge: { w: 30, d: 1, label: "Huge" } }, $: (id) => fields[id], status: () => {}, toast: () => {}, scheduleSave: () => {}, render: () => {}, console };
  vm.createContext(context);
  context.V = global.WT.view;
  for (const name of ["rectsOverlap", "readConstraintDraft", "placementProblem", "inBounds", "overlapsAny", "ghostCandidate"]) vm.runInContext(extract(name), context);
  const g1 = context.ghostCandidate("rack", 2, 2), g2 = context.ghostCandidate("rack", 19, 5), g3 = context.ghostCandidate("rack", 10, 10), g4 = context.ghostCandidate("rack", 4, 3), g5 = context.ghostCandidate("zzz", 0, 0), g6 = context.ghostCandidate("huge", 0, 0);
  check("5a. over the existing rack: not ok, the overlap named", g1 && g1.ok === false && /overlap/i.test(g1.problem), g1 && g1.problem);
  check("5b. at the right edge the ghost is clamped into the floor (x 19 -> 18) and ok", g2 && g2.ok === true && g2.x === 18 && g2.y === 5 && g2.w === 2 && g2.d === 1);
  check("5c. a free spot is ok with an empty problem", g3 && g3.ok === true && g3.problem === "");
  check("5d. a reserved zone is named", g4 && g4.ok === false && /reserved area 1/.test(g4.problem), g4 && g4.problem);
  check("5e. an unknown type is null; a type larger than the floor says so", g5 === null && g6 && g6.ok === false && /larger than the floor/.test(g6.problem));
})();

/* ---- 6. shipped wiring -------------------------------------------------- */
(function () {
  const css = read("styles.css"), html = read("index.html"), st = read("selftest.js"), sw = read("sw.js"), runall = read(path.join("test", "run-all.mjs"));
  check("6a. app.js draws the ghost, follows pointermove / dragover, clears on pointerleave / dragleave / drop / disarm, and sets the drag image from the thumbnail",
    /function drawPlacementGhost\(/.test(app) && /addEventListener\("pointerleave", \(\) => setHover\(null\)\)/.test(app) && /setDragImage\(thumb/.test(app) && /thumbnail: true/.test(app) && /if \(!type\) setHover\(null\)/.test(app) && (app.match(/setHover\(null\)/g) || []).length >= 5);
  check("6b. the thumbnail paints in px at the glyph tier with the handled goods, caches per mode/theme, and the flyout keeps the icon", /const THUMB_W = 56, THUMB_H = 36/.test(app) && /palThumbCache/.test(app) && /thumbUnit\(/.test(app) && /\{ mode: "icon" \}/.test(app) && /function drawThumbIso\(/.test(app));
  const block = css.slice(css.indexOf(".pal-swatch.pal-glyph {"), css.indexOf(".pal-swatch.pal-glyph {") + 400);
  check("6c. the swatch CSS has no !important and the 56 x 36 thumbnail rule; the card and the view toggle are styled", block.indexOf("!important") < 0 && /\.pal-item \.pal-swatch\.pal-glyph \{ width: 56px; height: 36px/.test(css) && /\.tooltip\.tooltip--card/.test(css) && /\.pal-view/.test(css) && /\.tip-rows/.test(css));
  check("6d. the page has the view toggle and the hint names the ghost and the touch path", /id="palViewToggle"/.test(html) && /data-view="plan"/.test(html) && /data-view="iso"/.test(html) && /a ghost on the floor/.test(html) && /touch screen/.test(html));
  check("6e. the self-test carries the three new checks", /class-library-thumbnails-are-real-glyphs/.test(st) && /placement-ghost-follows-pointer-while-armed/.test(st) && /palette-drag-over-floor-previews-drop/.test(st));
  check("6f. sw.js at wt-v131 (previously wt-v130); the runner lists this harness", /CACHE_VERSION\s*=\s*"wt-v131"/.test(sw) && /Previously wt-v130/.test(sw) && /verify_library_preview\.js/.test(runall));
  check("6g. library.js and goods.js export describe / formForType and reference no URL", typeof L.describe === "function" && typeof G.formForType === "function" && !/https?:\/\//.test(read("library.js")) && !/https?:\/\//.test(read("goods.js")));
})();

/* ---- 7. v3.49 STANDARD TYPES: the machine catalogue's forms and descriptors --- */
(function () {
  const MACH = ["cnc-mill", "cnc-mill-5axis", "cnc-lathe", "press-brake", "moulding-cell", "welding-cell", "coating-booth", "heat-treatment", "cmm-inspection"];
  const klt = G.sizeOf("klt"), wp = G.sizeOf("workpiece");
  check("7a. FORMS gained klt and workpiece at the END (the six earlier forms keep their order); the KLT is the VDA 4500 600 x 400 x 280 nominal, the workpiece a small block",
    G.FORMS.slice(0, 6).join(",") === "pallet-load,carton,tote,parcel,pallet,wrapped-pallet" && G.FORMS.slice(6).join(",") === "klt,workpiece" &&
    klt.f === 0.6 && klt.l === 0.4 && klt.z === 0.28 && wp.f === 0.15 && wp.l === 0.15 && wp.z === 0.1);
  check("7b. MACHINE_STAGE_FORM has exactly the STAGE_ORDER keys, KLT in / out and workpieces on the lane; STAGE_FORM is untouched (5 keys, receiving pallet-load)",
    Object.keys(G.MACHINE_STAGE_FORM).join(",") === G.STAGE_ORDER.join(",") && G.MACHINE_STAGE_FORM.receiving === "klt" && G.MACHINE_STAGE_FORM.storage === "workpiece" &&
    G.MACHINE_STAGE_FORM.picking === "workpiece" && G.MACHINE_STAGE_FORM.packing === "klt" && G.MACHINE_STAGE_FORM.shipping === "klt" &&
    Object.keys(G.STAGE_FORM).length === 5 && G.STAGE_FORM.receiving === "pallet-load" && G.STAGE_FORM.picking === "tote");
  const mu = { stage: "storage", status: "active" }, q = { stage: "picking", status: "queued" };
  check("7c. formFor without the flag is byte-identical (storage carton, queued-at-picking carton); with machineLine it gives the workpiece / KLT forms",
    G.formFor(mu, null) === "carton" && G.formFor(mu, null, {}) === "carton" && G.formFor(mu, null, { machineLine: false }) === "carton" && G.formFor(q, null) === "carton" &&
    G.formFor(mu, null, { machineLine: true }) === "workpiece" && G.formFor({ stage: "receiving", status: "active" }, null, { machineLine: true }) === "klt" &&
    G.formFor({ stage: "shipping", status: "active" }, null, { machineLine: true }) === "klt" && G.formFor({ stage: "receiving", status: "queued" }, null, { machineLine: true }) === "klt");
  let bad = null, calls = 0;
  const project = (x, y, z) => ({ x: 100 + (x - y) * 20, y: 60 + (x + y) * 10 - z * 11 });
  for (const form of ["klt", "workpiece"]) for (const tier of ["icon", "glyph", "rich"]) for (const theme of ["light", "dark"]) {
    const c = makeCtx();
    const ok = G.draw(c, { id: 3, form: form, size: G.sizeOf(form), x: 2, y: 3, z: 0.6, heading: 0.4, stage: "storage", status: "active", hot: tier === "rich", queueIndex: 0 },
      { project: project, cellPx: 24, tier: tier, theme: theme, stageColor: "#aa5500", congest: "#d00" });
    if (ok !== true || c._bad.length) { bad = bad || form + "/" + tier + "/" + theme + " ok=" + ok + " bad=" + c._bad.slice(0, 2).join(","); }
    calls += c._calls;
  }
  check("7d. both forms draw through goods.draw in every tier and theme with no throw and only finite coordinates", bad === null && calls > 0, bad || calls + " calls");
  check("7e. every machine handles a workpiece; source / drain handle a KLT; the warehouse pins of v3.48 are unchanged",
    MACH.every((t) => G.formForType(t) === "workpiece") && G.formForType("mfg-source") === "klt" && G.formForType("mfg-drain") === "klt" &&
    G.formForType("selective-racking") === "pallet-load" && G.formForType("pack-station") === "parcel" && G.formForType("conveyor") === "carton");
  check("7f. describe() for the nine carries the standard descriptor (8 with a DIN 8580 group 1-6, the CMM without), a chip, a Standard row and a footprint from the domain",
    MACH.every((t) => { const r = L.describe(t); const s = r && r.standard; return s && s.isa95 === "work-cell" && /informed by/.test(s.note) && /DIN 8580:2022-12/.test(s.source) && r.chip.length > 3 && r.rows.some((x) => x[0] === "Standard") && r.footprint === D.ELEMENTS[t].w + " × " + D.ELEMENTS[t].d + " m"; }) &&
    MACH.filter((t) => D.ELEMENTS[t].standard.din8580).length === 8 && MACH.filter((t) => D.ELEMENTS[t].standard.din8580).every((t) => { const g = D.ELEMENTS[t].standard.din8580.group; return g >= 1 && g <= 6; }) && D.ELEMENTS["cmm-inspection"].standard.din8580 === null);
  check("7g. the thumbnail tier proof of section 1 covers the nine (they are in paletteOrder) and each has a shape, an iso height and a cycle-time row",
    MACH.every((t) => D.paletteOrder.indexOf(t) >= 0 && S.has(t) && I.elementHeight(t) === D.ELEMENTS[t].heightM && L.describe(t).rows.some((x) => x[0] === "Cycle time" && /teaching value/.test(x[1]))));
  check("7h. goods.HONESTY names the KLT and the workpiece; app.js threads machineLine into units() from layoutHasStandardTypes()",
    /KLT, VDA 4500/.test(G.HONESTY) && /workpieces/.test(G.HONESTY) && /function layoutHasStandardTypes\(/.test(app) && /machineLine: layoutHasStandardTypes\(\)/.test(app) && (app.match(/goodsUnitOpts\(\)/g) || []).length >= 3);
})();

console.log("");
console.log(fail === 0 ? "ALL LIBRARY-PREVIEW CHECKS PASSED (" + pass + ")" : fail + " LIBRARY-PREVIEW CHECK(S) FAILED (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
