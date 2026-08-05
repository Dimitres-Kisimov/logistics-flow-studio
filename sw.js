/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * sw.js - service worker: precache the app shell so it works offline.
 * ---------------------------------------------------------------------
 * Cache-first for the precached shell (fully offline, no network needed
 * at runtime). Bump CACHE_VERSION when shipping new asset content so
 * clients pick up the update.
 * ===================================================================== */
const CACHE_VERSION = "wt-v42"; // v1.13: Story Mode - a cinematic one-click guided tour. A new PURE, DOM-free WT.story module (story.js) is the CINEMATIC cousin of the P8 Guided demo: it declares an ordered 7-step plan (load a synthetic e-commerce FC scenario -> frame the whole plant -> walk the five functional zones in flow order, receiving -> put-away/storage -> picking -> packing -> shipping, each with a plain-language caption -> start the live material flow) and the pure CAMERA MATH behind the moving shot - ease() (easeInOutCubic on clamped [0,1]), frameZone() (centre a world zone centroid in the viewport at a window-fitting scale, clamped through the SAME WT.view.clampScale bounds) and lerpCamera() (one eased interpolation frame between two view transforms). app.js drives it through the SAME machinery it already has - loadExample for the scenario, the WT.view {scale,panX,panY} transform for the camera, WT.flowsim.buildWaypoints for the exact zone centroids the flow then animates across, and flowPlay for the live boxes - it only SEQUENCES them (WT.story.run, interruptible like WT.demo.run). A top-bar "▶ Story" control starts/exits it; a caption HUD carries Pause/Resume + Skip + Exit; Esc exits; it is fully keyboard-accessible. DETERMINISTIC: the live camera tween is FRAME-COUNTED on the requestAnimationFrame animation clock (WT.story.PARAMS.flySteps frames), NO Date / NO RNG anywhere in the logic; under prefers-reduced-motion the camera JUMP-CUTS (no motion) and each caption still dwells so it stays readable. HONEST: it plays over the SAME synthetic, illustrative example scenario (no real company/brand) and the captions describe only what the deterministic model represents - a transparent teaching animation, NOT a real DES engine, NOT a measurement and NOT a certification; no "AI magic". New story.js precached here + new verify_story.js harness (34th) + Story checks added to the in-browser self-test (control present, plan shape, framing a zone moves the camera, Esc exits). Rendering/navigation + sequencing only - the element data model, sim, compliance, IFC and iso are untouched. Previously wt-v41 (v1.12): Realistic floor - measurements, markings & finer grid. A rendering-only, ADDITIVE facility layer on top of the rich objects (v1.11): a TWO-TIER grid (major 5 m lines always + subtle metre edge labels; minor 1 m lines LOD-gated to appear only when a cell reads >= 14 px on screen, so a huge floor zoomed out isn't a smear and the base look at normal zooms is unchanged); a metre SCALE RULER along the top + left floor edges (ticks + labels, label step widens when zoomed out so they never collide) with the SELECTED element's DIMENSIONS (w x d m) shown in a pill beside it; and faint, theme-aware FLOOR MARKINGS drawn UNDER the elements - a facility PERIMETER outline, AISLE CENTRE guides between facing rack rows (reusing the SAME WT.domain.facingAislePairs model the compliance aisle check uses, so they can never disagree), DOCK-APPROACH hatching in front of dock doors, and functional ZONE TINTS (receiving/storage/picking/packing/shipping, coloured from the flow-stage palette, only when zone-bearing elements exist). All geometry is a PURE, DETERMINISTIC function of the floor + elements in the new DOM-free WT.floor module (NO Date/RNG); the ruler + dimensions ride in SCREEN space positioned via the SAME worldToScreen the hit-test uses, the markings ride in the world transform, so zoom/pan/Fit all keep working, and the v1.6 view-culling still bounds the per-frame element draw. A "Measure" toolbar toggle (default ON) shows/hides the ruler + dimensions + markings; the two-tier grid LOD is always on. The element DATA MODEL is UNCHANGED (positions/sizes stay integer-metre cells) so compliance/capacity/sim are untouched. Illustrative facility rendering of a synthetic model - the measurements are the model's own metre grid (1 cell = 1 m), NOT a site survey and NOT CAD/BIM (the real geometry path is the IFC export); no real brands. New floor.js + verify_floor.js harness (33rd). Previously wt-v40 (v1.11): Realistic high-detail object rendering (progressive LOD) - a THIRD level-of-detail tier on top of the existing icon (far) + glyph (mid) tiers so the plant reads like a real facility when zoomed in. WT.shapes.detailLevel(onScreenPxPerCell) -> "icon" | "glyph" | "rich" (thresholds 10 / 40 px per cell); draw2D + draw3D pick the tier. The RICH tier renders ONLY when an element reads large on screen (zoomed in) and layers high-detail overlays ON TOP of the base glyph/form (so animated parts keep moving): racking/AS-RS/shuttle/drive-in/push-back/flow gain pallet load-units sitting in a DETERMINISTIC share of the bay/shelf positions (a fixed rule seeded from the element - NO Date, NO RNG - stable frame-to-frame + testable, illustrative not a real inventory count), AS/RS a tall multi-level rack each side of the crane aisle, mezzanine a decked platform on an interior post grid, conveyor belt load-units, docks a panelled door + guide rails, stations/returns a tote on the bench, vehicles (forklift/rgv/agv) a load body, sorter trays, stretch-wrap film bands. Zoomed OUT the app never reaches the rich tier (icon/glyph exactly as before) and the v1.6 view-culling still only paints on-screen footprints, so BIG layouts stay smooth - rendering only, sim/logic/compliance/IFC/iso untouched. Bumped into iso.js (drawScene threads the on-screen px/cell) + app.js (per-element fill seed + pxPerCell). New verify_detail.js harness (32nd): detailLevel thresholds + determinism, an every-type rich 2D+3D mock-context smoke (light+dark, finite, no-throw, no-mutation), rich adds detail + is LOD-gated, deterministic + seed-sensitive fill, anim still moves at rich, honesty labels. Illustrative schematic of a synthetic model, NOT CAD/BIM/survey, no real brands - the real geometry path is the IFC export. Previously wt-v39 (v1.10): Larger maps + wider zoom range - the editable floor now scales up to a 400 x 250 m hall (was 120 x 80) and the interactive zoom clamp widens to 0.04x-8x (was 0.2x-5x) so the WHOLE largest floor can be framed with Fit (fitView computes ~0.092x for the max floor, comfortably inside the new clamp - the clamp no longer floors it) and zoomed in for detail; 100% still resets to a centred 1:1 and wheel / +/- keys work across the wider range. Rendering + navigation only, fully deterministic: the existing v1.6 view-culling (WT.view.cullToView) keeps a big floor with many items cheap to draw (only on-screen footprints are painted) and the shapes LOD collapses to icons when zoomed out, so a large hall stays smooth; the sim/logic/compliance/IFC/iso are untouched. A very large but sparse floor is honestly just extra empty space. view.js FLOOR_MAX_W/H + SCALE_MIN/MAX raised; index.html floor input max attributes raised to match; verify_view.js extended (large-max normalizeFloor, max-floor fitView framable-within-clamp, wider clampScale bounds, large-floor cullToView, set-large-floor-then-Fit-covers-the-floor round-trip). Illustrative schematic of a synthetic model, NOT CAD/BIM, no real brands - sizes are order-of-magnitude teaching values. Previously wt-v38 (v1.9): More equipment types - eight new, genuinely distinct warehouse objects added to the palette, each with an honest domain schema, a DISTINCT 2D top-down glyph AND a DISTINCT 2.5D isometric form (WT.shapes registry): two STORAGE systems - Pick-to-light rack (light-directed small-parts pick faces; capacity in pallet-equivalents) and VNA narrow-aisle racking (guided man-up turret, tall + dense + fully selective) - plus six FLOW / handling / support / boundary elements that hold ZERO storage positions: Forklift / reach truck (handling vehicle), Charging station (AGV/truck fleet charging), Sorter loop (closed-loop tilt-tray/cross-belt sortation - animated tray circulates the loop), Stretch-wrap / palletiser (end-of-line pallet wrapping - animated wrap mast orbits the load), Returns / QA station (returns + quality inspection bench) and Gate / sectional door (internal zone-segregation barrier, distinct from a loading dock door). Additive + safe: the existing 21 types and every saved layout / example / generated plant load and render unchanged; new types route through the SAME generic place/select/drag/compliance/capacity paths (storage types form working aisles + carry pallet positions, the six flow types are 0-capacity like RGV/AGV); iso HEIGHTS + KB densities auto-mirror the domain model. verify_shapes.js extended with new-type checks (has/palette/capacity/smoke). Illustrative schematic of a synthetic model, NOT CAD/BIM, no real brands or vendor models. Previously wt-v37 (v1.8): Living plant - "P" switches the whole view 2D <-> 2.5D (the SAME toggle the "2.5D view" button fires; input- + modifier-guarded keydown, Pan keeps its own button/Space/middle-drag); the animated MATERIAL FLOW now renders in the 2.5D view too (the in-flight MUs + station queues are projected through the iso projection via projPx and drawn stage-coloured, zoom/pan/Fit-safe - not just top-down); and the EQUIPMENT itself is animated in BOTH views (conveyor belts scroll unit-loads, RGV/AGV vehicles travel their lane, AS/RS + shuttle carriages run the aisle and lift) via a DETERMINISTIC animation phase seeded from the flow sim's tick (WT.shapes.equipmentPhase - NO Date/Math.random; one source of truth passed into WT.shapes.draw2D/draw3D so 2D + 3D move identically), which PAUSES when the sim is paused (static frame), is LOD-aware (skipped when tiny), honours reduced-motion, and leaves the static form byte-identical when the flow is not running. Illustrative animation of a synthetic model - labels/data unaffected, no real brands, offline/no deps. New verify_animation.js harness (31st) + a live "P"-toggles-the-view self-test check. Previously wt-v36 (v1.7): Deep-link to a scenario via URL - a new PURE, DOM-free parser (deeplink.js -> WT.deeplink.parse) lets a URL open a specific example scenario and skip onboarding, so a plant is shareable/embeddable with a link (index.html?scenario=coldchain-frozen-dc) and demos/screenshots can open a chosen plant directly. On boot, ?scenario=<id> / ?example=<id> loads that library scenario onto the floor via the SAME loadExample() the UI uses (the app validates the id against WT.examples.library; an unknown id falls through to a normal boot with a gentle toast), ?onboarding=0 suppresses the welcome modal on its own, and a ?scenario= implies onboarding suppression - for THAT load only, never flipping the saved "don't show again" flag. Composes with ?selftest=1 and the existing #layout= share-hash (precedence: share-hash wins, else scenario, else saved, else demo). Nothing new is persisted; fully offline. New verify_deeplink.js harness (30th) + a live ?scenario= self-test check. Previously wt-v35 (v1.6): Production hardening pass 2 - ACCESSIBILITY (aria-labelled main regions + toolbar controls; the #floor canvas gains an aria-label + an aria-describedby offscreen summary kept current by app.js; a visible :focus-visible outline; prefers-reduced-motion honoured so the material-flow animation never auto-runs - Play shows a static/stepped frame, app stays fully usable) and PERFORMANCE for large layouts (the pure WT.view.cullToView culls the per-frame element draw to the visible world rectangle; shapes LOD unchanged; simulation results unchanged - rendering only). New docs/QA_CHECKLIST.md + a PRODUCTION.md section; selftest.js extended with a11y/perf checks; new verify_a11y_perf.js harness (29th). A11y is real but NOT a WCAG certification; perf is bounded-effort. Previously wt-v34 (v1.5): Production hardening - global error boundary (errors.js), in-browser E2E self-test (selftest.js, ?selftest=1), and a strict offline Content-Security-Policy meta in index.html. errors.js loads first (before all app scripts) and records uncaught errors/rejections into window.__WT_ERRORS__ + surfaces a non-blocking honest banner; selftest.js is INERT without the flag and, when enabled, drives the LIVE app through the same handlers the UI uses (exposed as window.__WT_TEST_API__ in self-test mode) writing a machine-readable `WT-SELFTEST: PASS n/n` into #wt-selftest. New verify_hardening.js harness (28th). Previously wt-v33: Distinct 2D + 3D object representations (shapes.js -> WT.shapes, the SINGLE per-type shape registry: has/draw2D/draw3D/ICONS/meta). Every warehouse object type now has a distinct, recognizable top-down GLYPH (shelf-bay grids, depth/flow chevrons, cantilever arms, AS/RS crane-aisle hatch, shuttle channels, mezzanine platform, dock notches, conveyor rollers, station benches, RGV/AGV vehicles, block-stack pattern) AND a distinct ISOMETRIC form (open see-through rack frames, tall crane tower, raised deck on legs, low belt bed, bench furniture, floor vehicles, stacked cubes) - reused by BOTH renderers (app.js draw2D + iso.js draw3D route through WT.shapes, fallback-safe to the old rect/box). LOD path keeps large layouts fast + legible at any zoom; iso forms reuse the domain heightM (single source of truth with the IFC export). Illustrative schematic, NOT CAD/BIM. New verify_shapes.js harness (shapes/app/iso/index/sw changed)
const CACHE_NAME = "warehousetwin-" + CACHE_VERSION;

// The complete offline app shell. All local, no external hosts.
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./errors.js",
  "./view.js",
  "./floor.js",
  "./domain.js",
  "./knowledge.js",
  "./tiers.js",
  "./simulation.js",
  "./optimizer.js",
  "./advisor.js",
  "./compliance.js",
  "./generate.js",
  "./nlcommands.js",
  "./examples.js",
  "./share.js",
  "./deeplink.js",
  "./ifc.js",
  "./data.js",
  "./wms.js",
  "./automation.js",
  "./flowsim.js",
  "./kpicharts.js",
  "./wmsdata.js",
  "./iso.js",
  "./shapes.js",
  "./storage.js",
  "./report.js",
  "./demo.js",
  "./story.js",
  "./cards.js",
  "./scenarios.js",
  "./compare.js",
  "./orderpool.js",
  "./app.js",
  "./selftest.js",
  // P5: LSP Planner sub-app (network-level planning game)
  "./lsp/index.html",
  "./lsp/lsp-styles.css",
  "./lsp/lsp-engine.js",
  "./lsp/lsp.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only serve our own origin from cache; never reach out to the network
  // for third-party hosts (there are none, but stay defensive & offline).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Runtime-cache same-origin GETs (e.g. future assets).
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          // Offline fallback: serve the shell for navigations.
          if (req.mode === "navigate") return caches.match("./index.html");
          return new Response("", { status: 504, statusText: "Offline" });
        });
    })
  );
});
