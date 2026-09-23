# Credits & asset provenance

WarehouseTwin ships **only original or permissively-licensed open assets**. There are no third-party trademarks, company logos, copyrighted images, web fonts, or 3D models anywhere in this repository, and no company's intellectual property is used.

## Code

- All application code (`index.html`, `styles.css`, `app.js`, `domain.js`, `simulation.js`, `optimizer.js`, `advisor.js`, `compliance.js`, `sw.js`) is **original**, written for this project — © 2026 Dimitres Kisimov, all rights reserved (see `LICENSE`). The Pass 2 advisor (`advisor.js`) and the Compliance Check (`compliance.js`) are hand-written rule/heuristic engines — no trained model, no third-party ML libraries.
- The seeded PRNG in `simulation.js` is **mulberry32**, a widely published public-domain one-liner (no attribution required); implemented here from scratch.

## Icons & graphics

- The app mark (`icons/icon.svg`) and all raster icons (`icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-512.png`, `icons/favicon-32.png`) are **original geometry I drew** — a 2×2 grid of storage units with a flow arrow. No third-party icon set is used.
- The PNGs are generated from original primitives by `generate_icons.py` using **Pillow**.
- All other UI icons/graphics are **inline SVG drawn by hand** in the HTML/CSS/canvas. No icon fonts, no icon libraries.

## Fonts

- **System font stack only** (`system-ui`, Segoe UI, Roboto, etc.). No web fonts are downloaded or bundled — nothing to attribute, nothing to license.

## Tooling (build-time only, not shipped in the app)

- **Python** and **Pillow** — used by `generate_icons.py` to rasterise the icons. Pillow is under the MIT-CMU / HPND-style licence. Not shipped or linked at runtime.
- **Ruff** — Python linter used in development only.
- **Playwright** (`tools/screenshot.py`, `tools/selftest_realtime.py`, v3.51 / v3.53) — drives headless Chrome for the README screenshots and for the in-browser self-test in real time (the IndexedDB proof the gate's virtual-time driver cannot give). Apache-2.0. Development only; not shipped, not part of the gate or CI.

## Data

- **All data is synthetic and seeded.** No real inventory, orders, telemetry, or personal data. Pallet dimensions, the aisle rule and the Compliance Check guidance values are drawn from public standards/references (EPAL/UIC pallet sizes; ASR A1.8 working-aisle and traffic-route geometry; ASR A1.8 traffic-route and ASR A2.3 escape-route guidance values, with the derivation assumptions written down in `domain.js` and `docs/DOMAIN_NOTES.md`). Referencing a public standard's published guidance numbers is not a use of anyone's proprietary assets, and WarehouseTwin makes **no certification claim** of any kind — the Compliance Check is a design aid, not a certification or a Gefährdungsbeurteilung.
- **Human-error anchors (v3.54).** The error what-if's default shares and levers are teaching values anchored on public human-reliability literature: HEART's generic task types and error-producing conditions (Williams, J. C., 1986, *HEART - a proposed method for assessing and reducing human error*; consolidated values as reproduced in public HRA guidance) and SPAR-H's nominal human-error probabilities (Gertman et al., NUREG/CR-6883, US NRC / INL 2005). Nuclear and process-industry anchors, **not warehouse measurements**; no site's error rate is claimed, and every value is labelled a teaching value. Errors are attributed to a process step and a latent condition, never to a person.
- **GS1 EPCIS 2.0 / CBV 2.0 vocabulary (v3.53).** The tracking database (`tracking.js`, `tools/run_ledger.py`) names its events with the GS1 EPCIS 2.0 event types and actions and the Core Business Vocabulary 2.0 business-step and disposition identifiers (ratified June 2022; ref.gs1.org/standards/epcis and /cbv) - used as vocabulary so a record is exchangeable, **no conformance is claimed**: a simulation has no wall-clock event time, and the EPC URIs are built on GS1's documentation prefix 4012345, which identifies nothing real. GS1 and EPCIS are trademarks of GS1 AISBL; no affiliation.
- **NIST SMS Test Bed - Box Assembly (v3.50).** `data/nist-box-assembly.json` (and its JS twin) is a reduction of the public *Box Assembly* package of the NIST Smart Manufacturing Systems Test Bed with the Manufacturing Technology Centre (github.com/usnistgov/smstestbed, folder `tdp/mtc`, commit as recorded in the file): per-operation run-time statistics computed by `tools/nist_box_assembly.py` with the rule stated in the file. NIST notice, verbatim: "We would appreciate acknowledgment if any of the project results are used, however, the use of the NIST logo is not allowed. NIST-developed software is provided by NIST as a public service. You may use, copy and distribute copies of the software in any medium, provided that you keep intact this entire notice. NIST-developed software is expressly provided "AS IS." NIST MAKES NO WARRANTY OF ANY KIND, EXPRESS, IMPLIED, IN FACT OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT AND DATA ACCURACY. The use of any software or hardware by the project does not imply a recommendation or endorsement by NIST." The NIST logo is not used anywhere in this project. The machine models (Hurco VMX 24) are as documented by NIST (AMS 200-2 device descriptions), not a vendor claim.
- **Standard types (v3.49).** The machine catalogue's classes are labelled with the DIN 8580 main group of the manufacturing process (DIN 8580:2022-12, a public classification: 1 Urformen, 2 Umformen, 3 Trennen, 4 Fügen, 5 Beschichten, 6 Stoffeigenschaft ändern) and the ISA-95 / IEC 62264-1 equipment-hierarchy role (work cell); the KLT drawing constant follows the VDA 4500 small-load-carrier recommendation (600 × 400 × 280 mm nominal). These are classification labels and public nominal dimensions - informed by the standards, not a certification, not an ISA-95 information model, and no licensed standard text is reproduced. Every machine cycle time is a teaching value, not a vendor specification.
- **Board grades (v3.47).** The table of ECT box-certificate classes lists the classes commonly printed on cartons and converts them with the exact pound-force and inch definitions - public classification values and unit arithmetic, not any supplier's proprietary board table; the flute calipers are typical values, labelled approximate.

## Runtime dependencies

- **None.** No CDN, no external scripts/styles/fonts, no network calls at runtime. The app is fully self-contained and works offline.
