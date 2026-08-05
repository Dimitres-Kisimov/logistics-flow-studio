/* =====================================================================
 * Logistics Flow Studio - WarehouseTwin
 * story.js - the cinematic "Story Mode" guided tour (plan + camera math)
 * ---------------------------------------------------------------------
 * Story Mode is the richer, CINEMATIC cousin of the P8 Guided demo
 * (demo.js). Where the Guided demo drives the side-panel controls end to
 * end, Story Mode tells the warehouse's STORY to a first-time viewer: it
 * frames each functional zone in turn with a moving camera and a plain-
 * language caption (receiving -> put-away/storage -> picking -> packing ->
 * shipping), then starts the live material-flow animation so the viewer
 * sees synthetic handling units actually moving through the plant.
 *
 * Like demo.js, this module is a PURE, DETERMINISTIC DESCRIPTION - data +
 * math, NOT DOM. It knows the ORDER of the tour, the caption per step and
 * the camera MATH (how to frame a world zone into the viewport and how to
 * tween the view between two framings). It does NOT touch the page: app.js
 * drives the real UI by handing `run()` a controller whose `actions` map
 * the step action names to the SAME functions the manual controls already
 * call (loadExample, the WT.view transform, flowPlay) - so Story Mode
 * never re-implements a feature, it only SEQUENCES them.
 *
 * WT.story = { PARAMS, STAGES, ACTIONS, STEPS, script, run,
 *              ease, frameZone, lerpCamera }
 *   PARAMS      timing / framing knobs - plain numbers.
 *   STAGES      the five functional zones, in flow order.
 *   ACTIONS     the KNOWN capability names a step may reference (the set
 *               verify_story.js asserts every step.action against).
 *   STEPS       the canonical ordered cinematic plan. Each step:
 *                 { id, stage, title, caption, action[, exampleId] }
 *   script()    -> a FRESH deep copy of the ordered step list (so a caller
 *               can annotate its copy without mutating the canon; two
 *               calls are byte-identical -> deterministic).
 *   run(ctrl)   -> drives the plan through an injected controller and
 *               resolves to { ran:[actionNames], stopped:bool, steps:n }.
 *               Interruptible: ctrl.stopped() is checked before every step.
 *   ease(t)     -> easeInOutCubic on a clamped [0,1] progress - the pure
 *               camera-tween easing (NO Date, NO RNG).
 *   frameZone(o)-> the pure "fly-to" MATH: given a world zone centroid, the
 *               floor + viewport and a framing window, returns the
 *               { scale, panX, panY } view transform that CENTRES that zone
 *               in the viewport. Reuses WT.view.clampScale for the bounds.
 *   lerpCamera(from,to,t) -> the eased interpolation between two view
 *               transforms - one frame of the camera move.
 *
 * HONESTY (mirrored in the UI + README): Story Mode plays over the SAME
 * SYNTHETIC, illustrative example scenario the rest of the app uses (no
 * real company/brand). The captions describe only what the deterministic
 * model actually represents - it is a transparent teaching animation, NOT
 * a real discrete-event simulation, NOT a measurement and NOT a
 * certification. No "AI magic": the camera is scripted, the flow is the
 * documented WT.flowsim heuristic.
 *
 * DETERMINISM: every function here is a pure function of its inputs. No
 * Date, NO RNG. The live camera tween in app.js advances on the request-
 * AnimationFrame animation clock (frame-counted), never the wall clock.
 *
 * Classic script attaching to the global `WT` namespace so it works from
 * file:// too. No dependencies at module-load time (WT.view is read lazily
 * inside frameZone, so load order is not fragile).
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});

  // The five functional zones, in flow order. These are the SAME stage
  // keys WT.flowsim.STAGES uses, so the camera frames the exact zones the
  // material-flow animation then runs across.
  const STAGES = ["receiving", "storage", "picking", "packing", "shipping"];

  // Timing / framing knobs. Plain numbers so the plan stays deterministic
  // and the app can override per-run (e.g. a faster screenshot pass).
  const PARAMS = {
    captionMs: 4200,   // dwell on each zone caption so it is readable
    flowWarmupMs: 3600, // extra dwell after Play so the floor fills with MUs
    flySteps: 42,      // rAF frames for one camera move (frame-counted; NO Date)
    framePadCells: 7,  // half-window (world cells) the zoom frames around a zone
    zoneMaxScale: 3.0, // never zoom a single zone in tighter than this
    fitPad: 0.06,      // breathing margin when framing the WHOLE floor
  };

  // The KNOWN set of capability names a step may reference. Each maps to a
  // real app function (wired in app.js's Story controller). verify_story.js
  // asserts every step.action is in this set - a step can never name a
  // capability the app does not expose.
  //   loadScenario -> app.loadExample(id)  (Example scenarios loader)
  //   frameZone    -> fly the WT.view camera to that stage's centroid
  //   playFlow     -> app.flowPlay()        (Live material-flow animation)
  const ACTIONS = ["loadScenario", "frameZone", "playFlow"];

  // The canonical cinematic tour: load a rich synthetic scenario, frame the
  // whole plant, walk the five zones in flow order with a plain-language
  // caption each, then start the live flow. `stage: "all"` frames the whole
  // floor (Fit); the five zone steps frame one zone each.
  const STEPS = [
    {
      id: "intro",
      stage: "all",
      title: "Meet the warehouse",
      caption:
        "A synthetic e-commerce fulfilment centre - an illustrative scenario, no real company. " +
        "We'll walk it from the inbound dock to dispatch, then watch the goods move.",
      action: "loadScenario",
      exampleId: "ecommerce-multichannel-fc",
    },
    {
      id: "receiving",
      stage: "receiving",
      title: "1 - Receiving & inbound docks",
      caption:
        "Inbound trucks dock here. Pallets are unloaded, scanned and staged before they move " +
        "into the building - the start of the flow.",
      action: "frameZone",
    },
    {
      id: "storage",
      stage: "storage",
      title: "2 - Put-away & storage",
      caption:
        "Goods are put away into the racking. In the model the fast movers are slotted closest " +
        "to picking (ABC/velocity), so the busiest stock travels the least.",
      action: "frameZone",
    },
    {
      id: "picking",
      stage: "picking",
      title: "3 - Order picking",
      caption:
        "Pickers travel the aisles pulling order lines from the pick faces. This is usually the " +
        "busiest stage - the modelled bottleneck the KPIs watch.",
      action: "frameZone",
    },
    {
      id: "packing",
      stage: "packing",
      title: "4 - Packing & consolidation",
      caption:
        "Picked items are consolidated, packed and labelled at the pack stations, ready to ship.",
      action: "frameZone",
    },
    {
      id: "shipping",
      stage: "shipping",
      title: "5 - Shipping & dispatch",
      caption:
        "Finished orders are staged and dispatched from the outbound docks - the end of the flow.",
      action: "frameZone",
    },
    {
      id: "flow",
      stage: "all",
      title: "Now watch it run",
      caption:
        "The live material flow: synthetic handling units move receiving -> storage -> pick -> " +
        "pack -> ship. A transparent teaching animation, not a real DES engine.",
      action: "playFlow",
    },
  ];

  // A fresh deep copy each call: callers may annotate their copy without
  // mutating the canon, and two calls are byte-identical (determinism is
  // asserted in verify_story.js). NO Date, NO RNG anywhere.
  function script() {
    return STEPS.map((s) => Object.assign({}, s));
  }

  // easeInOutCubic on a CLAMPED [0,1] progress - the camera-move easing.
  // Pure + deterministic (NO Date, NO RNG). t<=0 -> 0, t>=1 -> 1.
  function ease(t) {
    let x = Number(t);
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  // The pure "fly-to" framing MATH. Given a WORLD zone centroid (cx, cy),
  // the base pixels-per-cell (cellPx), the viewport size (vw x vh) and a
  // half-window in world cells (padCells), return the { scale, panX, panY }
  // view transform that CENTRES the zone in the viewport at a scale which
  // frames a ~(2*padCells) cell window. Scale is clamped to the zoom bounds
  // (and to zoneMaxScale) via WT.view.clampScale, so a tiny zone can never
  // zoom into a blur. DOM-free + deterministic.
  //
  //   opts = { cx, cy, cellPx, vw, vh [, padCells] [, maxScale] }
  function frameZone(opts) {
    const o = opts || {};
    const cx = Number(o.cx), cy = Number(o.cy);
    const cellPx = Number(o.cellPx) > 0 ? Number(o.cellPx) : 20;
    const vw = Number(o.vw) > 0 ? Number(o.vw) : 800;
    const vh = Number(o.vh) > 0 ? Number(o.vh) : 480;
    const pad = Number(o.padCells) > 0 ? Number(o.padCells) : PARAMS.framePadCells;
    const maxScale = Number(o.maxScale) > 0 ? Number(o.maxScale) : PARAMS.zoneMaxScale;
    // The scale that fits a (2*pad) x (2*pad) cell window into the viewport.
    const windowPx = 2 * pad * cellPx;
    let scale = Math.min(vw / windowPx, vh / windowPx);
    if (scale > maxScale) scale = maxScale;
    scale = clampScale(scale);
    const k = cellPx * scale; // effective pixels-per-cell at this scale
    const safeCx = isFinite(cx) ? cx : vw / (2 * cellPx);
    const safeCy = isFinite(cy) ? cy : vh / (2 * cellPx);
    return {
      scale: scale,
      panX: vw / 2 - safeCx * k,
      panY: vh / 2 - safeCy * k,
    };
  }

  // One frame of the camera move: the eased interpolation between two view
  // transforms `from` and `to` at progress t in [0,1]. Pure + deterministic.
  function lerpCamera(from, to, t) {
    const a = from || {}, b = to || {};
    const e = ease(t);
    const fs = num(a.scale, 1), ts = num(b.scale, 1);
    const fx = num(a.panX, 0), tx = num(b.panX, 0);
    const fy = num(a.panY, 0), ty = num(b.panY, 0);
    return {
      scale: fs + (ts - fs) * e,
      panX: fx + (tx - fx) * e,
      panY: fy + (ty - fy) * e,
    };
  }

  // Drive the plan through an injected controller so this module stays
  // DOM-free (and headlessly testable). The controller supplies:
  //   actions  { [name]: fn(step) }  - the real app capabilities
  //   pause    (ms) => Promise        - an INTERRUPTIBLE delay
  //   stopped  () => boolean          - true once the user hit Exit
  //   onStep   (step, index, total)   - update the caption HUD
  //   onDone   ()                     - the plan finished
  //   onStop   (index)                - the plan was interrupted
  // Resolves to a summary of what actually ran (used by verify_story.js).
  function run(controller) {
    const c = controller || {};
    const actions = c.actions || {};
    const pause = typeof c.pause === "function" ? c.pause : function () { return Promise.resolve(); };
    const stopped = typeof c.stopped === "function" ? c.stopped : function () { return false; };
    const steps = script();
    const total = steps.length;
    const ran = [];

    return (async function () {
      for (let i = 0; i < total; i++) {
        if (stopped()) {
          if (c.onStop) c.onStop(i);
          return { ran: ran, stopped: true, steps: total };
        }
        const step = steps[i];
        if (c.onStep) c.onStep(step, i, total);
        const fn = actions[step.action];
        if (typeof fn === "function") {
          fn(step);
          ran.push(step.action);
        }
        if (i < total - 1) {
          const ms = step.action === "playFlow" ? PARAMS.flowWarmupMs : PARAMS.captionMs;
          await pause(ms);
        }
      }
      if (c.onDone) c.onDone();
      return { ran: ran, stopped: false, steps: total };
    })();
  }

  // --- tiny helpers -------------------------------------------------------
  function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }
  // Clamp a zoom multiplier through the SINGLE shared definition when it is
  // present (WT.view), with an identical fallback so this module is safe to
  // load/test on its own. NO Date, NO RNG.
  function clampScale(s) {
    if (WT.view && typeof WT.view.clampScale === "function") return WT.view.clampScale(s);
    const n = Number(s);
    if (!(n > 0) || !isFinite(n)) return 1;
    return Math.max(0.04, Math.min(8.0, n));
  }

  WT.story = {
    PARAMS: PARAMS,
    STAGES: STAGES,
    ACTIONS: ACTIONS,
    STEPS: STEPS,
    script: script,
    run: run,
    ease: ease,
    frameZone: frameZone,
    lerpCamera: lerpCamera,
  };
})();
