# Asset shells, AAS-shaped (v3.65)

*Written 2026-09-23 for v3.65. Gap 7 of the [digital-twin deep dive](DIGITAL_TWIN_DEEP_DIVE.md): the app's identities are internal, so nothing it models can be joined to an asset register. This page is how far that gap can honestly be closed by software alone. Informed by IEC 63278-1:2023; no conformance is claimed.*

## What it does

`WT.aas.fromLayout(layout, { rates, ledger, site })` - and `node tools/aas_export.mjs` - turn a floor into an **AAS-shaped environment** (`wt-aas-shaped/v1`): one **asset administration shell** per element, with the submodels the Industrie 4.0 templates name.

```sh
node tools/aas_export.mjs --layout my-floor.json --ledger run-ledger.json --out asset-shells.json
node tools/aas_export.mjs --ledger test/fixtures/run-ledger.json --out asset-shells.json   # no layout: the run's own locations
```

In the app: *Settings & data → German standards this app is informed by → **Export asset shells (AAS-shaped JSON)***. The live floor, the Analyze panel's rates, and the live run when one has been recorded.

| Submodel | What it carries | Where each value comes from |
|---|---|---|
| **Nameplate** | designation, product type, serial number, the DIN 8580 classification and ISA-95 role where the type has them, and `wt:NotModelled` | the element catalogue (`domain.js`); the serial is the layout's own element id and says so |
| **TechnicalData** | footprint in metres, height, category, storage capacity in pallet positions, cycle time, servers, equipment class, power, capex, amortisation, whether it charges labour | the catalogue and the analytics rates - each property carries its own `wt:source`, each labelled a teaching value |
| **OperationalData** (only for an element a recorded run touched) | the run id, recorded events, units seen, first and last tick, the declared service time, the waits that completed and their mean | the run ledger: measured on that run, synthetic unless the events were imported |

## Shaped, not conformant

The same rule as the EPCIS-shaped tracking twins, and for the same reason:

- the **structure** is the AAS metamodel's JSON serialisation - `assetAdministrationShells` / `submodels`, `modelType`, `idShort`, `semanticId` as an `ExternalReference`, `Property` with a **string** value - and the submodel names are the public IDTA templates';
- the **semantic identifiers are not the real ones**. A conformant Digital Nameplate carries ECLASS IRDIs; this carries `urn:wt:aas:...` placeholders, and every submodel says so in its own note;
- the **asset identifiers are not registered**. They are this layout's element ids in a site scope. That *is* gap 7: a real identifier needs an owner of the register and of the GS1 or ECLASS prefixes, which is not a software task;
- what a conformant nameplate requires and a layout planner does not have - manufacturer name, year of construction, date of manufacture, a real serial, the product URI, CE and other markings, contact and address - is **listed under `wt:NotModelled`, never invented**;
- keys beginning `wt:` are this app's own additions to the shape;
- nothing is keyed to a person: an asset here is a machine, a rack or a dock, and the operational data are counts per element.

## One number worth reading twice

`OperationalData.wt:MeanWait_ticks` is the mean of the queued-to-served spans that **completed within the run**, over **every operation the element serves**. The viewer's `v_station_wait` means the same spans **per element and operation**. On fixture A the staging bench therefore reports 110.33 ticks here and two rows there - put-away 122.4 over five completed spans and replenishment 50 over one - and 110.33 is exactly those weighted: (5 × 122.4 + 1 × 50) ÷ 6. `verify_aas.js` recomputes it from the viewer's own rows rather than trusting either side. The property names say which is which (`wt:CompletedWaits`, not `waits`), because the same word counting two things is how a number starts lying.

## Reproduce

```sh
node verify_aas.js
node tools/aas_export.mjs --ledger test/fixtures/run-ledger.json --out work/asset-shells.json
```
