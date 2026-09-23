/* =====================================================================
 * Logistics Flow Studio - aas.js
 * ASSET SHELLS, AAS-SHAPED (v3.65): every element of a floor as an asset
 * administration shell with a nameplate, technical data and - when a run
 * was recorded - operational data.
 * ---------------------------------------------------------------------
 * WHY
 *   Gap 7 of the deep dive: the app's identities are internal. An element id
 *   lives inside one layout, a handling-unit id inside one run, and the SSCC
 *   is serialised from a sequence number, so it recurs. Nothing can be joined
 *   to an asset register, a maintenance system or a supplier's shipment.
 *   IEC 63278-1:2023 (the Asset Administration Shell, from Plattform
 *   Industrie 4.0) is the standard that answers exactly that: WHICH asset,
 *   WHAT it is, and in a form two pieces of software can exchange.
 *
 * WHAT THIS IS - AND IS NOT
 *   - AAS-SHAPED, not conformant, in the same sense the tracking twins are
 *     EPCIS-shaped: the structure is the AAS metamodel's JSON serialisation
 *     (assetAdministrationShells / submodels, modelType, idShort, semanticId
 *     as an ExternalReference, Property with a string value), and the three
 *     submodels are named after the public IDTA templates (Nameplate,
 *     TechnicalData, OperationalData).
 *   - The SEMANTIC IDS ARE NOT THE REAL ONES. A conformant Digital Nameplate
 *     carries ECLASS IRDIs; this app carries `urn:wt:aas:...` placeholders and
 *     says so in every submodel. Nothing here is registered: the asset ids are
 *     the layout's own element ids, which is what gap 7 is about - a real
 *     identifier needs an owner of the register, which is not a software task.
 *   - Every value is either read from this app's catalogue (a labelled
 *     teaching value with its source) or measured on a recorded run; what a
 *     conformant nameplate would require and this app cannot fill is listed
 *     in `wt:NotModelled` rather than invented.
 *   - Keys beginning `wt:` are this app's own additions to the shape.
 *   - Nothing here is keyed to a person: an asset is a machine, a rack or a
 *     dock, and the operational data are counts per element.
 *   - Pure and deterministic: no Date, no Math.random, no network.
 * ===================================================================== */
(function () {
  "use strict";
  const WT = (window.WT = window.WT || {});
  const SCHEMA = "wt-aas-shaped/v1";
  const HONESTY =
    "AAS-SHAPED, not AAS-conformant: the structure is the JSON serialisation of the Asset Administration Shell " +
    "metamodel (IEC 63278-1:2023, Plattform Industrie 4.0 / IDTA) and the submodels are named after the public " +
    "IDTA templates, but the semantic identifiers are urn:wt: placeholders instead of the ECLASS IRDIs a conformant " +
    "nameplate carries, and the asset identifiers are this layout's own element ids - not registered anywhere. " +
    "Values are either this app's catalogue (teaching values, each with its source) or measured on a recorded run; " +
    "what a real nameplate needs and this app cannot fill is listed under wt:NotModelled, never invented. Keys " +
    "beginning wt: are this app's own. No conformance, no certification, and nothing keyed to a person.";
  const SHAPED_AFTER = {
    standard: "IEC 63278-1:2023 - Asset Administration Shell for industrial applications (Plattform Industrie 4.0)",
    serialisation: "the AAS metamodel's JSON shape: assetAdministrationShells / submodels, modelType, idShort, semanticId as an ExternalReference, Property with a string value",
    templates: ["Digital Nameplate for Industrial Equipment (IDTA)", "Technical Data (IDTA)", "Operational data (this app's own, shaped like a submodel)"],
    claim: "shaped, not conformant - the semantic ids are placeholders and nothing is registered",
  };
  // What a conformant Digital Nameplate requires and a layout planner does not have.
  const NOT_MODELLED = ["ManufacturerName", "ManufacturerProductRoot", "YearOfConstruction", "DateOfManufacture",
    "SerialNumber (a real one: this carries the layout's element id)", "URIOfTheProduct", "Markings (CE and the rest)", "ContactInformation", "Address"];
  const SEMANTIC = {
    nameplate: "urn:wt:aas:sm:nameplate",
    technical: "urn:wt:aas:sm:technical-data",
    operational: "urn:wt:aas:sm:operational-data",
    property: (name) => "urn:wt:aas:prop:" + name,
  };
  const SOURCE_CATALOGUE = "WarehouseTwin element catalogue (domain.js) - a teaching value unless the element's own source says otherwise";
  const SOURCE_RATES = "WarehouseTwin analytics rates (analytics.js defaults, or as edited in the Analyze panel) - illustrative teaching values, not a quote";
  const SOURCE_RUN = "measured on this run's own record (the run ledger); synthetic unless the events were imported";

  const r2 = (v) => Math.round(v * 100) / 100;
  // Two rate shapes reach this module: the block a run ledger EXPORTS (snake_case, with a class map per
  // element type) and the one analytics.defaultRates() holds in memory (camelCase, no class map - the
  // mapping lives in analytics.TYPE_TO_CLASS). Both are read; neither is guessed at.
  const either = (o, a, b) => (o && o[a] != null ? o[a] : o && o[b] != null ? o[b] : null);
  function equipmentClassOf(type, rates) {
    if (rates && rates.classes && rates.classes[type]) return rates.classes[type];
    const A = WT.analytics;
    const cls = A && A.TYPE_TO_CLASS ? A.TYPE_TO_CLASS[type] : null;
    return cls ? { class: cls, labour: null } : null;
  }
  const ref = (value) => ({ type: "ExternalReference", keys: [{ type: "GlobalReference", value: value }] });
  const modelRef = (id) => ({ type: "ModelReference", keys: [{ type: "Submodel", value: id }] });
  // An AAS Property: the value is a STRING in the metamodel's JSON, which this keeps.
  function prop(idShort, value, valueType, source) {
    const out = { modelType: "Property", idShort: idShort, semanticId: ref(SEMANTIC.property(idShort)),
      valueType: valueType || "xs:string", value: value == null ? null : String(value) };
    if (source) out["wt:source"] = source;
    return out;
  }
  const collection = (idShort, elements, note) => {
    const out = { modelType: "SubmodelElementCollection", idShort: idShort, value: elements };
    if (note) out["wt:note"] = note;
    return out;
  };
  function submodel(assetId, idShort, semantic, elements, note) {
    const out = { modelType: "Submodel", kind: "Instance", id: "urn:wt:aas:sm:" + idShort.toLowerCase() + ":" + assetId,
      idShort: idShort, semanticId: ref(semantic), submodelElements: elements };
    if (note) out["wt:note"] = note;
    return out;
  }

  /* ---------------- the three submodels of one element ---------------- */
  function nameplateOf(el, def) {
    const std = def && def.standard;
    const els = [
      prop("ManufacturerProductDesignation", (def && def.label) || el.type, "xs:string", SOURCE_CATALOGUE),
      prop("ManufacturerProductType", el.type, "xs:string", SOURCE_CATALOGUE),
      prop("SerialNumber", el.id, "xs:string", "the layout's own element id - layout-local, not a registered serial number (gap 7 of the deep dive)"),
    ];
    if (std && std.din8580) {
      els.push(collection("ProductClassifications", [
        prop("ProductClassificationSystem", "DIN 8580:2022-12", "xs:string", std.source || SOURCE_CATALOGUE),
        prop("ProductClassId", "main group " + std.din8580.group, "xs:string", std.source || SOURCE_CATALOGUE),
        prop("ClassificationDescription", std.din8580.name, "xs:string", std.source || SOURCE_CATALOGUE),
      ], std.note || "informed by, not a certification"));
    }
    if (std && std.isa95) els.push(prop("wt:Isa95Role", std.isa95, "xs:string", std.source || SOURCE_CATALOGUE));
    els.push(collection("wt:NotModelled", NOT_MODELLED.map((n, i) => prop("Missing" + (i + 1), n, "xs:string")),
      "a conformant Digital Nameplate requires these and this app does not have them: a layout planner knows the type of a machine, not its manufacturer, year or markings"));
    return submodel(el.id, "Nameplate", SEMANTIC.nameplate, els,
      "shaped after the IDTA Digital Nameplate template; the semantic ids are urn:wt: placeholders, not the ECLASS IRDIs a conformant nameplate carries");
  }
  function technicalOf(el, def, cell, capacity, rates) {
    const m = (cells) => r2((Number(cells) || 0) * (Number(cell) > 0 ? Number(cell) : 1));
    const els = [
      prop("FootprintWidth_m", m(el.w != null ? el.w : def && def.w), "xs:double", SOURCE_CATALOGUE),
      prop("FootprintDepth_m", m(el.d != null ? el.d : def && def.d), "xs:double", SOURCE_CATALOGUE),
    ];
    if (def && def.heightM != null) els.push(prop("Height_m", def.heightM, "xs:double", SOURCE_CATALOGUE));
    if (def && def.category) els.push(prop("wt:Category", def.category, "xs:string", SOURCE_CATALOGUE));
    if (capacity > 0) els.push(prop("wt:StorageCapacity_pallets", capacity, "xs:integer", "domain.elementCapacity: the declared density and levels of this rack type over its footprint - a teaching value"));
    if (def && def.cycleSec != null) els.push(prop("wt:CycleTime_s", def.cycleSec, "xs:double", SOURCE_CATALOGUE));
    if (def && def.servers != null) els.push(prop("wt:Servers", def.servers, "xs:integer", SOURCE_CATALOGUE));
    const cls = equipmentClassOf(el.type, rates);
    const eq = cls && cls.class && rates && rates.equipment ? rates.equipment[cls.class] : null;
    if (eq) {
      els.push(prop("wt:EquipmentClass", cls.class, "xs:string", SOURCE_RATES));
      els.push(prop("wt:PowerDraw_kW", either(eq, "power_kw", "powerKW"), "xs:double", SOURCE_RATES));
      els.push(prop("wt:Capex_EUR", eq.capex, "xs:double", SOURCE_RATES));
      els.push(prop("wt:AmortisationYears", either(eq, "amort_years", "amortYears"), "xs:double", SOURCE_RATES));
      // the export's rates say whether a class charges labour; the in-memory rates do not carry it, and an
      // unknown is left out rather than guessed
      if (cls.labour != null) els.push(prop("wt:ChargesLabour", cls.labour ? "true" : "false", "xs:boolean", SOURCE_RATES));
    }
    return submodel(el.id, "TechnicalData", SEMANTIC.technical, els,
      "shaped after the IDTA Technical Data template; every value is this app's catalogue or its illustrative rates, each with its source");
  }
  // Only with a recorded run: what this element actually did, per the run ledger.
  function operationalOf(el, seen, runId) {
    if (!seen) return null;
    const els = [
      prop("wt:Run", runId, "xs:string", SOURCE_RUN),
      prop("wt:RecordedEvents", seen.events, "xs:integer", SOURCE_RUN),
      prop("wt:UnitsSeen", seen.units, "xs:integer", SOURCE_RUN),
      prop("wt:FirstTick", seen.first_tick, "xs:integer", SOURCE_RUN),
      prop("wt:LastTick", seen.last_tick, "xs:integer", SOURCE_RUN),
    ];
    if (seen.service_ticks != null) els.push(prop("wt:DeclaredServiceTime_ticks", seen.service_ticks, "xs:double", "the service time the run was recorded under (the floor's declared capacity, or the simulator's floor rate)"));
    if (seen.waits > 0) {
      els.push(prop("wt:CompletedWaits", seen.waits, "xs:integer", "queued-to-served spans that COMPLETED within the run at this element - not v_station_wait's `waits`, which counts every queued event including those still waiting at the end"));
      els.push(prop("wt:MeanWait_ticks", seen.mean_wait_ticks, "xs:double", "the mean of those completed spans over EVERY operation this element serves (v_station_wait means the same spans per element AND operation, so a bench that serves two operations reports a different mean here)"));
    }
    return submodel(el.id, "OperationalData", SEMANTIC.operational, els,
      "measured on one recorded run of this app, not a plant: a synthetic day unless the events were imported");
  }

  /* ---------------- the environment ---------------- */
  // Per element of a run-ledger export: events, distinct units, the first and last tick,
  // the declared service time and the queued-to-served waits. Pure over the export.
  function seenByElement(exp) {
    const out = {};
    if (!exp || !Array.isArray(exp.events)) return out;
    const loc = {};
    for (const l of exp.locations || []) loc[l.id] = l;
    const queued = {};
    for (const e of exp.events) {
      const id = String(e.location);
      const s = out[id] || (out[id] = { events: 0, unitSet: {}, first_tick: e.tick, last_tick: e.tick, waits: 0, waitSum: 0, service_ticks: loc[id] ? loc[id].service_ticks : null });
      s.events++;
      s.unitSet[e.hu_id] = 1;
      if (e.tick < s.first_tick) s.first_tick = e.tick;
      if (e.tick > s.last_tick) s.last_tick = e.tick;
      const key = e.hu_id + "|" + e.op;
      if (e.kind === "queued") queued[key] = e.tick;
      else if (e.kind === "served" && queued[key] != null) { s.waits++; s.waitSum += e.tick - queued[key]; delete queued[key]; }
    }
    for (const id in out) {
      const s = out[id];
      s.units = Object.keys(s.unitSet).length;
      s.mean_wait_ticks = s.waits ? r2(s.waitSum / s.waits) : null;
      delete s.unitSet;
      delete s.waitSum;
    }
    return out;
  }
  // A floor (a wt-1 layout, or anything with `elements`) as an AAS-shaped environment.
  //   opts: { rates, ledger (a factory-run-ledger/v1 export), site }
  function fromLayout(layout, opts) {
    const o = opts || {};
    const D = WT.domain || {};
    const defs = D.ELEMENTS || {};
    const cell = layout && layout.cell > 0 ? layout.cell : (D.METRES_PER_CELL || 1);
    const site = o.site ? String(o.site) : "wt-floor";
    const seen = o.ledger ? seenByElement(o.ledger) : {};
    const runId = o.ledger && o.ledger.run ? o.ledger.run.id : null;
    const shells = [], submodels = [];
    for (const el of (layout && layout.elements) || []) {
      const def = defs[el.type] || null;
      const assetId = "urn:wt:asset:" + site + ":" + el.id;
      const capacity = D.elementCapacity ? D.elementCapacity(el) : 0;
      const sms = [nameplateOf(el, def), technicalOf(el, def, cell, capacity, o.rates)];
      const op = operationalOf(el, seen[el.id], runId);
      if (op) sms.push(op);
      for (const sm of sms) submodels.push(sm);
      shells.push({
        modelType: "AssetAdministrationShell", id: "urn:wt:aas:" + site + ":" + el.id, idShort: el.id,
        assetInformation: { assetKind: "Instance", globalAssetId: assetId,
          "wt:note": "not a registered identifier: the layout's own element id in the scope " + site + " (gap 7 of the deep dive)" },
        submodels: sms.map((sm) => modelRef(sm.id)),
      });
    }
    return { schema: SCHEMA, honesty: HONESTY, shaped_after: SHAPED_AFTER,
      scope: { site: site, elements: shells.length, submodels: submodels.length, cell_metres: cell,
        run: runId, with_operational_data: !!runId, rates: !!o.rates },
      assetAdministrationShells: shells, submodels: submodels };
  }
  // The shape's own rules: ids unique, every reference resolves, every property carries a string value.
  function validate(env) {
    const errors = [];
    const err = (m) => { if (errors.length < 8) errors.push(m); };
    if (!env || env.schema !== SCHEMA) return { ok: false, errors: ["not a " + SCHEMA + " document"] };
    const ids = {}, smIds = {};
    for (const sm of env.submodels || []) {
      if (smIds[sm.id]) err("duplicate submodel id " + sm.id);
      smIds[sm.id] = 1;
      if (!sm.semanticId || !sm.semanticId.keys || !sm.semanticId.keys.length) err(sm.id + ": no semanticId");
      for (const e of sm.submodelElements || []) {
        if (e.modelType === "Property" && typeof e.value !== "string" && e.value !== null) err(sm.id + "/" + e.idShort + ": a Property value must be a string");
      }
    }
    for (const shell of env.assetAdministrationShells || []) {
      if (ids[shell.id]) err("duplicate shell id " + shell.id);
      ids[shell.id] = 1;
      if (!shell.assetInformation || !shell.assetInformation.globalAssetId) err(shell.id + ": no globalAssetId");
      for (const r of shell.submodels || []) {
        const target = r.keys && r.keys[0] ? r.keys[0].value : null;
        if (!smIds[target]) err(shell.id + ": the reference " + target + " resolves to no submodel");
      }
    }
    if (!(env.assetAdministrationShells || []).length) err("no shell in the environment");
    return { ok: errors.length === 0, errors: errors };
  }

  WT.aas = { SCHEMA, HONESTY, SHAPED_AFTER, NOT_MODELLED, SEMANTIC, fromLayout, seenByElement, validate };
})();
