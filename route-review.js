/* Route review: evidence about a teaching recipe, never a capacity or safety approval.
 * Reuses routing.resolveAll and its anchor index; does not alter simulation state. */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const PURPOSE = {
    "legacy-spine": "The default teaching route: receive, store, pick, pack and ship.",
    "full-pallet-out": "Receive and retrieve a whole pallet without breaking it into cases or repacking it.",
    "case-pick": "Break inbound pallets into cases, pick whole cases, then build and wrap an outbound pallet.",
    "piece-pick": "Replenish a pick face from reserve stock, pick individual items and pack the order.",
    "cross-dock": "Check the inbound load, stage it and ship it directly. This recipe never enters storage.",
    returns: "Inspect a returned unit, then follow the selected restock or scrap outcome.",
    vas: "Pick stock already in the building, kit or relabel it, then pack and ship.",
    "export-fragile": "Pick existing stock, check it, build the dispatch pallet and wrap it before loading.",
  };
  function build(layout) {
    const R = WT.routing;
    const report = R.resolveAll(layout);
    const rows = report.routes.map((route) => {
      const steps = route.ops.map((id) => {
        const op = R.OPERATIONS[id];
        const anchor = R.ANCHORS[op.anchor];
        const point = report.anchors[op.anchor];
        const resolved = route.steps.find((s) => s.op === id);
        const missing = route.missing.find((s) => s.op === id);
        const fallback = !!resolved && !(point && point.count > 0);
        const equipment = op.anchor === "qc"
          ? "a Goods-in QC bench (or a Returns / QA station, which the router borrows)" : "a " + anchor.label;
        const status = missing ? (missing.pending ? "unsupported" : "missing") :
          fallback ? "fallback" : resolved && resolved.sharedWith ? "shared" : "placed";
        return {
          id: id, label: op.label, anchor: op.anchor, anchorLabel: anchor.label,
          status: status, element: anchor.element,
          note: status === "unsupported" ? "This version has no equipment type for this operation." :
            status === "missing" ? "Add " + equipment + " to the floor." :
            status === "fallback" ? "No matching equipment counted. The animation uses a zone or fallback position." :
            status === "shared" ? (op.anchor === "qc" ? "Uses the Returns / QA station; inbound checks and returns share equipment." : "Uses the stretch-wrap equipment for pallet building too.") : anchor.label,
        };
      });
      const unsupported = steps.some((s) => s.status === "unsupported");
      const missingAny = steps.some((s) => s.status === "missing"); // unroutable: a station is absent
      const gaps = steps.some((s) => s.status === "fallback");        // routable on fallback geometry
      const shared = steps.some((s) => s.status === "shared");
      return {
        id: route.routeId, archetype: route.id, label: route.short,
        outcome: route.outcomeLabel, legacy: route.legacy,
        description: PURPOSE[route.id], engineResolved: route.ok,
        status: unsupported ? "unsupported" : missingAny ? "missing" : gaps ? "gaps" : shared ? "shared" : "placed",
        steps: steps,
      };
    });
    return { kind: "wt-route-review", rows: rows,
      limits: "Modelled route review, not measured operations. Equipment presence does not establish capacity, inventory availability, safe access or regulatory compliance. Shared stations and fallback positions remain explicit." };
  }
  WT.routeReview = { build: build };
})();
