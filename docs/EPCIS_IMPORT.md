# The return path: importing recorded EPCIS 2.0 events (v3.58)

*Written 2026-09-23 for v3.58. The tracking database of v3.53 derives EPCIS-shaped twins from the simulation. This page is the other direction: recorded events from a plant, in the same vocabulary, into the same store and the same SQL views. Informed by GS1 EPCIS 2.0 and CBV 2.0; no conformance is claimed.*

## What it does

An EPCIS 2.0 **capture document** (JSON or JSON-LD: `type: "EPCISDocument"`, `epcisBody.eventList`) exported by a WMS, a scanner system or an EPCIS repository is mapped onto the shape the derived twins use (`factory-tracking-events/v1`) and:

- in the browser, lands in the tracking store next to the simulated runs (*Simulate → Run ledger → Import EPCIS 2.0 document*; the store is IndexedDB in this browser, nothing is sent anywhere), so `history(object)` and dwell per business step answer for recorded events too;
- in SQLite, lands in `tracking_event` with `source = 'imported'` (`python tools/epcis_import.py import <document.json> --database run.sqlite`), so `v_bizstep_dwell`, `v_unit_history` and `v_epcis_events` answer for it; the derived twins carry `source = 'derived'`.

Both sides run the same mapping (`tracking.js fromEpcis`, `tools/epcis_import.py from_epcis`); `test/test_epcis_import.py` pins them equal event by event on the fixture and `verify_epcis_import.js` pins the fixture's hand values.

## The rule

| What | How |
|---|---|
| Event types | `ObjectEvent` and `AggregationEvent` only. A `TransformationEvent`, `TransactionEvent` or `AssociationEvent` refuses the whole document, naming the event. |
| Business step, disposition | Only the identifiers this app knows (13 steps, 8 dispositions - the CBV 2.0 subset the twins emit). The three CBV forms are read: bare (`receiving`), URN (`urn:epcglobal:cbv:bizstep:receiving`), web URI (`https://ref.gs1.org/cbv/BizStep-receiving`); the form used is remembered in `wt:vocabulary`. A refusal names the identifier and says whether it is CBV 2.0 at all (the 41 steps, 33 dispositions and 13 transaction types of the ratified JSON-LD context). |
| Time | `eventTime` must be ISO 8601 with a zone (`Z` or `±hh:mm`). Events are ordered by time, ties by document order. `wt:tick` = whole minutes from the document's earliest event (`floor(x + 0.5)`), `wt:minute` exact; `eventTime` and `eventTimeZoneOffset` are kept as written. Parsed by hand in both languages (no `Date`, no `datetime`); fractions beyond the millisecond are dropped. |
| The object | An `AggregationEvent` is keyed by its `parentID` (children carried). An `ObjectEvent` naming several EPCs becomes **one mapped event per EPC** (`eventID` suffixed `#2`, `#3`, …) so every object's history is complete; the summary reports document events and mapped events. A class-level event (`quantityList` only) is keyed by its first class. |
| Identifiers | `eventID` kept when present, else `urn:wt:evt:import-<n>` (document position). Duplicates refuse. |
| Carried | `readPoint.id`, `bizLocation.id`, `bizTransactionList` (type normalised to the bare CBV identifier), `epcList` / `quantityList` / `childEPCs` / `childQuantityList`. Every other event field is counted in `ignored_fields` and dropped (`sourceList`, `sensorElementList`, `persistentDisposition`, vendor extensions …). |
| The run | `EPCIS-<fnv1a of the mapped events' signature>`, scenario `epcis-import`, `minutes_per_tick 1`, `ticks` = the last minute; `run.source` records the document id, schema version, creation date, counts, the earliest and latest time, the ignored fields. Re-importing the same document replaces the run. |
| Refused outright | not an `EPCISDocument`; `schemaVersion` outside 2.x; no or empty `eventList`; an event without a type, an action, a zoned time, a step, a disposition or an object. Up to eight reasons are listed; nothing is imported. |

## What it is not

A file is the physical-to-digital direction **by hand**. In Kritzinger's terms (model → shadow → twin, by the automation of the data flow) this makes the app a model with a *manual* shadow: nothing is streamed, nothing is sent back, nothing here acts on a recorded event. The identifiers, times and places are the document's own; the app does not say they are registered or true. An event names an object, a place and a step - never a person (BetrVG § 87(1)6, GDPR Art. 88).

## The fixture

`test/fixtures/epcis-document.json` is **synthetic**, this repository's own: one inbound pallet on GS1's documentation prefix 4012345, unpacked into cases, one case picked, packed under a parcel and shipped, one case found damaged and written off; ten document events (deliberately out of time order, in the three CBV forms, one without an `eventID`, one with fields the importer ignores) that map to eleven. GS1's published example documents were read for the shape (ref.gs1.org/docs/epcis/examples; github.com/gs1/EPCIS, folder `JSON`) and **none is copied**: that repository's LICENSE file is the GS1 IP-policy disclaimer, not a copying licence. The committed twin (`epcis-document.tracking.json`, `.tracking.views.json`) is regenerated by `node tools/make_epcis_fixture.mjs`.

Hand values the tests pin (minutes since the earliest event): ticks `0, 12, 40, 40, 41, 50, 90, 105, 125, 140, 180`; dwell receiving 12, storing avg 25.5 / max 50 over two cases, inspecting 9, packing 20, staging_outbound 15, loading 40; the damaged case's history storing → inspecting → destroying at 40, 41, 50.

## Reproduce

```sh
node verify_epcis_import.js                                                   # the mapping, arithmetic, questions, refusals, store, wiring
python -m unittest test.test_epcis_import -v                                   # the Python twin, the database, the command line
python tools/epcis_import.py check  test/fixtures/epcis-document.json         # the summary (exit 1 with the reasons when refused)
python tools/epcis_import.py import test/fixtures/epcis-document.json --database work/run.sqlite
python tools/epcis_import.py dwell  --database work/run.sqlite                # dwell per business step, in minutes
```
