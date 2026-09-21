# Packaging optimisation — the deep dive

*What the simulator models about pallets, cases and trailers, where that comes from, what it does not model, and how every number can be reproduced. Written 2026-09-22 for v3.34.*

## 1. The question

A distributor or factory does not move "items". It moves **handling units**: eaches inside cases, cases stacked in layers on pallets, pallets in trailers. Every operation in the plant changes which of those a unit is (a depalletiser turns one pallet into 48 cases; a pack bench turns four eaches into a parcel), and every cost the plant has — touches, travel, dock time, trailers — is paid per handling unit, not per each. So the questions a planner asks are:

1. **How many cases go on a pallet, and in what pattern?** (ti-hi: cases per layer × layers)
2. **How many eaches, cases, pallets and parcels does each order type push through each operation?**
3. **How many pallets and trailers does a day's volume need, and what if the pallet or the pattern changed?**

The simulator answers all three from one recorded run (see [RUN_LEDGER_SCHEMA.md](RUN_LEDGER_SCHEMA.md)). This document is about the packaging model behind the answers.

## 2. What is real, with sources

| Fact used | Value in the model | Source |
|---|---|---|
| EUR pallet (EPAL 1) footprint and height | 1200 × 800 × 144 mm | DIN EN 13698-1; EPAL |
| EUR pallet safe working load | 1,500 kg (dynamic); 4,000 kg static when stacked | EPAL technical data for EPAL 1 |
| Industrial pallet (EPAL 2) | 1200 × 1000 mm | DIN EN 13698-2; EPAL |
| Half pallet (EPAL 6) | 800 × 600 mm | EPAL |
| Small-load carrier (KLT) footprints | 600 × 400 and 400 × 300 mm | VDA 4500 |
| Modular packaging base | 600 × 400 mm module | ISO 3394 |
| Pallets per 13.6 m curtain-side trailer | 33 EUR or 26 industrial, single-stacked | widely used planning figures (trailer inner length ≈ 13.6 m, width ≈ 2.48 m) |
| Logistic-unit and trade-item identifiers | SSCC (18 digits), GTIN-13 / GTIN-14, GLN, mod-10 check digit with weights 3,1,3,1… from the right | GS1 General Specifications |
| The band-layout algorithm | one-dimensional knapsack over strips | Smith & De Cani (1980), "An algorithm to optimize the layout of boxes in pallets", *Journal of the Operational Research Society* |
| The pallet loading problem it belongs to | manufacturer's pallet loading problem (identical boxes, one pallet) | Dowsland (1987), "An exact algorithm for the pallet loading problem", *EJOR*; Bischoff & Ratcliff (1995), "Issues in the development of approaches to container loading", *Omega*; Morabito & Morales (1998), *JORS* |
| Compression strength of a stacked case depends on the pattern | interlocked / misaligned stacking reduces box compression strength; column stacking preserves it | McKee, Gander & Wachuta (1963) box-compression formula and the packaging-engineering practice built on it |

Everything in the next table is **synthetic**: plausible teaching values, labelled as such in the code (`pack.js` `HONESTY`) and in every export. They are not anybody's specification.

| Synthetic value | Where |
|---|---|
| Case dimensions per industry (e.g. 400 × 300 × 250 shipping carton, 300 × 200 × 150 pharma carton) | `pack.js` `BOXES` |
| Eaches per case, case weight, maximum stack height, eaches per parcel | `pack.js` `PROFILES` |
| Order-line quantity ranges per archetype | `pack.js` `PROFILES[*].line` |
| The drum pallet 1200 × 1200 and the tyre cage with a declared capacity of 24 | `pack.js` `PALLETS` |

## 3. The pattern model

### 3.1 Single-orientation grid

For a case *l × w* on a pallet *L × W*, cases per layer in one orientation is ⌊L/l⌋·⌊W/w⌋; the model takes the better of the two orientations. No overhang is ever allowed.

### 3.2 Band (strip) layouts — v3.34

A single orientation misses the layers every plant actually stacks. Split the pallet width *W* into parallel **bands**; each band holds one orientation packed along the length *L*. Choosing the bands is a one-dimensional knapsack:

> f(w) = max over orientations o of f(w − h<sub>o</sub>) + ⌊L / l<sub>o</sub>⌋, with f(0) = 0

where h<sub>o</sub> is the case's size across the band and l<sub>o</sub> its size along it. It is solved by dynamic programming in *W* steps (`pack.js` `bandDP`), for both band directions, and is **exact for band layouts**. The model uses the band layer only when it packs strictly more than the grid (`bestLayer`).

Worked examples (all asserted by hand in `verify_pack.js`):

| Case | Pallet | Grid | Bands | Layer chosen |
|---|---|---|---|---|
| 400 × 300 shipping carton | EUR 1200 × 800 | 8 (rotated: 300 along 1200) | 8 | grid, 8 |
| 400 × 300 shipping carton | industrial 1200 × 1000 | 9 (3 × 3) | **10** (bands 400 / 300 / 300 = 4 + 3 + 3, a perfect tiling) | bands, 10 |
| KLT 600 × 400 | industrial 1200 × 1000 | 4 (2 × 2) | **5** (bands 600 + 400 = 3 + 2) | bands, 5 — the standard VDA layer |
| 300 × 200 pharma carton | EUR | 16 (perfect) | 16 | grid, 16 |
| 600 × 400 crate | EUR | 4 | 4 | grid, 4 |
| 585 mm drum | 1200 × 1200 | 4 | 4 | grid, 4 |

### 3.3 Height and weight limits

Layers = ⌊(stack height limit − pallet height) / case height⌋, then reduced until *tare + cases × case weight* ≤ the pallet's safe working load. The model reports `weightLimited` when the load limit, not the height, decided. Example: a 40 kg carton at 8 per layer gives 320 kg per layer; ⌊1500 / 320⌋ = 4 layers, so 32 cases and 1,305 kg gross, although 6 layers would fit under 1.8 m.

### 3.4 Cube utilisation

cases × case volume ÷ (L × W × usable height). With the examples above the 400 × 300 × 250 carton reaches 90.6 % on EUR, industrial and half pallets alike — perfect layers under the same height limit.

### 3.5 Ranking and the what-if

`optimizeProfile(profile)` ranks EUR, industrial and half pallets for the profile's case (cases per pallet first, cube utilisation second) and states the gain over the profile's own pallet. For the e-commerce profile: EUR 48 → industrial 60, +25 %. For automotive KLTs the profile is already on its best pattern (25 per industrial pallet).

The viewer then applies the best pattern to the run's **own** pallet-borne volume: the eaches that arrived on pallets, divided by eaches per pallet, gives inbound pallets now versus with the best pattern, and trailers at 33 / 26 per trailer. On the recorded fixture the gain shows in pallets before it shows in trailers — small volumes rarely cross a trailer boundary. Partial dispatch pallets are unchanged by a better pattern: a five-case order still needs one pallet.

## 4. What is deliberately not modelled

- **Pinwheel and interlocking patterns.** Real layers are often pinwheeled and alternate orientation layer by layer for stability. The band model does neither. It therefore *under*-counts some layers (a pinwheel can beat the best band layout) and says nothing about stability.
- **Stacking strength.** Column stacking keeps a case's compression strength; interlocking reduces it substantially, and overhang reduces it further. The model has no ECT / BCT inputs, so it cannot say whether a stack is safe — only how many cases fit.
- **Mixed-SKU pallets**, rainbow pallets, layer picking.
- **Weight distribution, centre of gravity, wrapping tension.**
- **Trailer loading** beyond a slot count: no double-stacking, no axle-load check, no payload-mass check against the 24 t figure.
- **Racking consequences** of a pallet-type change (an industrial pallet needs deeper beams and different handling), which is why the viewer calls the change a what-if, not a recommendation.

A high score obtained by hiding any of these would be a failure. The viewer prints the honesty text next to every ranking.

## 5. How it connects to the rest of the simulator

- The order archetypes (`routing.js`) say **which operations** a unit passes; `pack.js` `quantitiesAlong` says **how much** it is at each of them, and the run ledger (`ledger.js`) records both per unit and per event.
- The conservation identity *eaches received = carried + retained + scrapped* holds at every step of every archetype × profile (asserted for all of them), so the SQL view `v_conservation_violations` can be a genuine invariant.
- `pack.js` is loaded by the planner (`index.html`) and by the viewer (`run-ledger.html`); the same code draws the pattern the ledger's `cases_per_pallet` came from.

## 6. Reproduce

```sh
node verify_pack.js                 # every number in this document, by hand
node verify_run_ledger_view.js      # the what-if on a hand-built ledger
node tools/make_run_ledger_fixture.mjs && python tools/run_ledger.py import test/fixtures/run-ledger.json --database work/run.sqlite && python tools/run_ledger.py views --database work/run.sqlite
```

Open `run-ledger.html`, load the recorded example, and read the *Optimise the pallet pattern* section against the table in §3.2.
