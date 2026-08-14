# Changelog

All notable changes to WarehouseTwin (Logistics Flow Studio) are recorded here.
Dates are ISO (YYYY-MM-DD). Every figure the app produces is a **synthetic,
seeded teaching heuristic unless you import your own data** — informed by public
standards (ISO 22400, DIN 15185, ASR, EN, VDI), not a certification and not a
measurement of a real site.

## [3.23] — 2026-08-14

**The goods are physical.** Since P3 the material flow has been a swarm of
abstract stage-coloured squares — and a warehouse does not move squares. New
`goods.js` (`WT.goods`) is a pure, deterministic model that turns every
handling unit the flow sim *already carries* into the object it actually is at
that point in the chain, and puts it on the surface that is carrying it.
Structure is untouched, every saved scenario stays **byte-identical**, and this
layer adds **no model and no number** — it is strictly read-only over the
existing sim.

**What a unit looks like at each stage** (mapped onto the sim's *own* stage
machine — nothing is invented):

| stage | form | the real event |
|---|---|---|
| receiving | wrapped **EUR pallet-load** — three bottom runners, a boarded deck, three tiers of kraft cartons, stretch-wrap film bands | a loaded pallet comes off the inbound trailer |
| storage | **kraft carton** with a taped seam | the put-away station **depalletises** it |
| picking | moulded **plastic tote** — lip and hand grips, signal blue with a red in the mix | cartons are **picked** into a tote |
| packing | taped, labelled **parcel** | the tote is **packed** |
| shipping | **parcel** | parcels are **loaded** on the outbound trailer |

The form changes exactly where the sim's own FIFO server does the work: a unit
**waiting** in a queue still shows the form it arrived in, and becomes the next
thing at the instant the station *serves* it. **Units are conserved** — this is
a change of *appearance only*: one MU stays one MU, so flowsim's invariant
(spawned == in-flight + completed) is untouched.

**Riding the active components.** A support index over the layout records the
belt top of every conveyor, curve, track and sorter, the deck of every RGV and
AGV, and the top of every pack bench — so a carton on a belt is drawn at **belt
height**, not floating over the floor. Because the sim already routes along the
conveyor cell centres (and along a curved conveyor's quarter-arc), a unit
follows the belt **round the bend** with its nose pointing the way it travels.

**Queues back up nose-to-tail.** A waiting unit is no longer stacked in a pile:
the queue extends *back along the sim's own route*, one unit length plus a
bumper gap per place in it, so congestion looks like congestion. The queue's
order, length and service rate remain entirely the sim's.

**Trucks carry the goods.** A forklift, RGV or AGV carries a pallet on its
forks or deck, moved by the **same lane parameter and the same animation phase**
its own carriage is drawn at — and a reach truck's forks *raise* with the load
and come back down empty.

**Racks show stock.** The rich tier's **existing** deterministic fill pattern is
scaled by the storage stage's share of the live flow, clamped inside the shape
registry's own `RICH_FILL` bound — the same slots, emptying and refilling in the
pattern's own order. No second inventory model, no new number, and byte-identical
to before whenever the plant is not running.

**One model, both views.** Every corner goes through the caller's
`project(x, y, heightM)`, so a unit is a solid oriented box with a contact
shadow on its carrying surface in 2.5D and a correctly oriented plan shape
top-down, by construction. The oriented-box painter and the kraft are
`WT.workers`' own (`boxFaces` + PPE) — the carton on the belt is literally the
same code and the same board as the carton in a worker's hands.

LOD-gated and culled (a cheap stage-coloured mark when a unit is a couple of
pixels across, a solid form at normal zoom, the full pallet at rich zoom, and a
*uniform* degrade above the drawing budget so the largest hall stays smooth);
deterministic (no `Date`, no `Math.random` — the clock is the sim's own tick, so
a paused plant and `prefers-reduced-motion` both resolve to a legible static
frame). Illustrative only: nominal generic handling-unit dimensions used as
drawing constants — **not** CAD/BIM, **not** a survey, **not** a measurement.

New `verify_goods.js` harness (48th); the browser self-test gains 7 checks
(140/140); the offline guard is clean; the cache is bumped to `wt-v78` with
every `verify_*.js` pin synced.

## [3.22] — 2026-08-14

**The plant has people in it, and they do their job.** Since v2.1 a "worker"
was a head disc and a shoulder bar bolted onto the furniture of a pack bench:
it could bob, it could not *work*. This release gives the floor an actual
workforce. New `workers.js` (`WT.workers`) is a pure, deterministic **pose +
gait model** — an articulated 1.75 m figure (hips, knees, feet, shoulders,
elbows, hands, head) placed by two-link IK and driven by named **work cycles**,
one per station type. Structure is untouched (no rail/drawer/panel change),
every saved scenario stays **byte-identical**, and nothing here feeds a KPI.

**What a worker actually does now.**
- **Pick face** — walks to the face with a real alternating gait and
  counter-swinging arms, **bends and reaches in**, straightens with a **kraft
  carton in its hands**, carries it back at chest height and sets it down. The
  reach height is stable per element, so a rack row is picked at *several*
  levels — and the body follows the hands: a floor-level face is a deep bend
  with the knees in it, a chest-level face is barely a lean.
- **Pack / processing bench** — draws the goods in, works over the bench
  (hands working at the carton), sweeps a tape gun **one-handed** across it
  while the other hand stays put, then pushes the finished parcel away and
  reaches out for the next one.
- **Staging (put-away)** — carries a carton in at chest height, places it,
  straightens, walks back empty, takes up the next one.
- **Dock door** — steps up to the door, **raises a handheld** above the
  shoulder, reads the label, lowers it and steps back.
- **Nobody is a mannequin.** A stationary worker still has a weight shift and
  breath; and a stage that has no goods in it yet stands **idle** until the
  shift wakes (latched per run, so a queue flickering around zero can never
  strobe the poses).

**The gait is driven by travel, not by the clock.** The stride phase is
`distance / stride length`, so a worker crossing a longer leg takes *more*
steps; the stride amplitude follows the leg's own speed profile, so the feet
come together as they arrive. Every cycle is a **closed pose loop** (each
step's end pose is the next one's start), verified over a fine sweep — there
is no pose pop at any step boundary or at the wrap.

**One skeleton, both views.** Joints live in a body frame (forward / lateral /
up, in metres) and are projected through the caller's
`project(x, y, heightM)` — the plain world→px map top-down, the iso projection
in 2.5D — and solid parts (torso, carton, tote, scanner) are drawn as
**oriented boxes** through that same projector. So from above you look down on
the shoulders and see the feet swing fore and aft; from the 2.5D camera the
same skeleton stands up; and a pick reads as a pick in both **by
construction**. The head's on-screen size is *measured* through the projector,
so the 2.5D figure never gets a balloon for a head.

**Hi-vis that reads at distance.** An EN ISO 20471-family yellow-green vest
with a retroreflective band, work-shirt sleeves that read *against* the vest,
dark trousers, safety boots, a hard hat and a deliberately **neutral head — no
skin tone, no gender, no identity is modelled** — all outlined in near-black,
which is what actually keeps a 7 px figure legible on the daylit slab *and*
the night shift (asserted at ≥ 3:1 as non-text UI in both themes). Full detail
(knees, elbows, helmet, reflective band, taped carton, contact shadow) only at
the zoomed-in tier; figures are culled entirely below the glyph tier,
view-culled top-down and capped at 64, so a big hall stays fast.

**Deterministic by construction.** No `Date` and no `Math.random` anywhere in
`workers.js` — the clock is the flow sim's own tick, so the workforce freezes
exactly when the sim pauses, and a null clock (plant stopped, or
`prefers-reduced-motion`) gives every worker the legible **standing** pose
their cycle rests at, never a leg-in-the-air freeze.

**Two fixes that fell out of the work.**
- Manned stations no longer draw a person welded into the glyph; they draw the
  **work in progress** — a carton that travels the bench and closes as it is
  made up (2D and 2.5D). People are their own layer now.
- **The dark-theme glyph pen was broken, and had been for a while.**
  `shade()`/`lighten()` hand back CSS `rgb(r,g,b)` strings while the colour
  parser only understood hex, so *every* `rgba(lighten(...))` call — which is
  the whole dark-theme pen — parsed `"rg"`/`"b("`/`"21"` as hex and collapsed
  to the **same dark crimson for every element**, whatever its material. That
  is the "interior strokes read redder than intended" note from v3.21: the
  dark pen now really is each element's own material colour, lightened.

**Gates:** all **47** harnesses pass (new `verify_workers.js`, 15 checks over
the pose/gait geometry: roster correctness + determinism + cap, finite and
bounded joints over full cycles, the gait laws, cycle continuity, the pose
matching the station, the load being in the hands, the reduced-motion static
frame, a draw smoke through both projectors × themes × tiers with no input
mutation, both views agreeing, no clock/RNG in source *or* live functions, the
honesty labels and the shipped wiring); `verify_shapes.js` gains a check
pinning the dark-theme pen; the in-browser self-test grows 125 → **133**; the
offline guard is clean; the cache is bumped to `wt-v77` with every
`verify_*.js` pin synced.

**Still honest about what this is:** an ILLUSTRATIVE schematic animation of
warehouse work — not motion capture, not ergonomics or biomechanics, not a
labour standard, not a measurement of anyone's workload, and the
one-worker-per-manned-element roster is a drawing heuristic, **not** a staffing
recommendation. The goods themselves are still the abstract stage-coloured
flow boxes; turning those into real pallets, cartons and totes riding the
equipment is the next step (A3).

## [3.21] — 2026-08-14

**The design correction: this is factory work, not a drafting tool.** The
v3.20.1 craft pass dressed the simulator as a *blueprint* — deep-blue slate
chrome, a blue-black canvas, cyan hairline grid, candy-pastel element tints.
Every one of those choices named the wrong subject. A plant floor is not an
IDE, and this release re-tokens the whole product to the **material world of a
factory**. Structure is untouched (the rail + drawers + icon-expand layout is
the user's own choice); nothing about behaviour, copy or serialization changes,
and **every saved scenario stays byte-identical**.

**The canvas is a plant floor.**
- The slab is **poured concrete** — a warm neutral gray with a deterministic
  *exposed-aggregate* speckle. The stones come from a pure, seeded function
  (`WT.floor.concreteSpecks`; no `Date`, no `Math.random`) baked once into an
  8 m repeating tile, so painting the whole hall costs a single `fillRect` no
  matter how large it is, and the same layout pours an identical slab on every
  run and every machine.
- The 5 m lines are **saw-cut control joints** with a chamfer highlight.
  Concrete really is poured in ~5 m bays and cut so it cracks where you choose
  — which happens to be the model's own major grid step, so the measurement aid
  and the material finally agree instead of arguing.
- The markings are **paint**: 100 mm safety-yellow aisle lines with stencilled
  travel arrows, 75 mm white zone borders, and a 150 mm black/yellow hazard
  hatch on every dock apron. All of it is *scuffed* by a deterministic wear
  function, because paint in a working plant gets driven over. None of it is a
  CAD hairline any more. The aisle paint is promoted from the **same**
  facing-pair model the compliance aisle check uses, so the paint on the floor
  can never disagree with the rule that governs it.
- Equipment gains a **contact shadow** so it stands *on* the slab instead of
  being drawn on top of it, and the building shell reads as a clad steel wall.
- **High-bay lighting** is modelled only where it is real: warm sodium/LED
  pools on the night shift, and *nothing added* to the evenly-lit daylit hall
  (every attempt to model daylight pooling either washed the concrete out to
  paper or left square seams where the gradients met — restraint was the
  correct answer, not more paint).

**Colour is material, not decoration.** 51 element types are re-toned off the
candy/blueprint ramp onto real materials: orange-red painted rack uprights on
galvanised steel beams, machine gray with safety-orange guards, kraft board,
pallet timber, and genuine plant signage (amber = attention, red = stop, green
= running). `shapes.js` gains a shared `MATERIALS` vocabulary so the 2D glyph
and the 2.5D form can never disagree; rack **beams are steel whatever the
uprights are painted**; and what sits on a rack is now wooden pallets and kraft
cartons rather than tinted copies of the rack's own hue. Blue survives only
where it is honest — plastic totes, cold-store and fluid cues, and ISO 7010
*mandatory-action* blue for the selection ring. No brands, no trademarks: every
motif stays a generic industrial schematic.

**The chrome is a machine console.** The rail is a powder-coated steel column
with brushed-metal separators, recessed lit keys, a condensed silk-screened
label set, an amber indicator keel on the engaged tool and a green ready LED.
Neutrals are warm concrete/steel throughout — in **both** themes, because a
night shift is not blue.

- **Light = daylit hall**, **dark = night shift**: the slab recedes into warm
  light pools while the machines and the painted lines stay lit.
- **Accessibility:** every text pair is WCAG AA in both themes, with the ratios
  *computed* and asserted live by the extended self-test — including the
  console's own ink against the powder-coat it sits on (11.3:1 / 5.3:1) and the
  indicator LEDs at ≥ 3:1 as non-text UI. `prefers-reduced-motion` is honoured
  exactly as before.

**Gates:** all 46 harnesses pass; the in-browser self-test grows 118 → **125**
checks (7 new: console tokens present, console ink AA on the powder-coat,
neutrals provably warm rather than blue-dominant, the canvas material palette
complete in both themes, concrete/paint determinism, a structural clock/RNG-free
scan of the material layer, and the shapes material vocabulary theme-complete);
`verify_floor.js` adds 13 checks over the new pure geometry; the offline guard
is clean across 97 files; the cache is bumped to `wt-v76` with every
`verify_*.js` pin synced.

**Honest limitation:** the material identity is a *rendering* correction. It
changes no number, no model and no export — capacities, KPIs, compliance
outcomes and the IFC geometry path are exactly what they were in v3.20.2.

## [3.20.2] — 2026-08-14

**The tier default is now `full`.** A first-time visitor used to meet a
component library with most storage systems padlocked, because the
demo/full showcase gate (`tiers.js`) defaulted to `demo`. This deployment
is a portfolio showcase, not a sales funnel, so the complete library — all
14 storage systems, every slotting strategy, the MRO preset, CSV import,
the floor-plan underlay and the unabridged advisor — is what the app opens
with.

The gate itself is untouched and still a first-class feature: the header
button now reads **"Switch to demo"**, and flipping it re-applies every
capability limit exactly as before, so the engineered entitlement split
(one capability-flag module, no scattered `if`s) stays demonstrable on
demand. Only `tiers.js`'s `current()` fallback changed — no capability
list, no behaviour, no copy, no serialization, and every scenario stays
byte-identical. `lsp/verify.js` now pins the new default *and* proves the
demo gate still bites by stubbing the entitlement store, and
`PUBLISH_ANDROID.md` §C states the default plus what a real paid
deployment would do instead. Cache `wt-v75`.

## [3.20.1] — 2026-08-12

An **award-level visual craft pass** — "industrial control room": the dark
canvas is the hero, chrome recedes, colour stays reserved for state. Entirely
**within** the established rail / multi-open-drawer structure (nothing
restructured), with **no behaviour, copy, or serialization change** — every
scenario stays byte-identical.

### Changed
- **Design-token layer** (`styles.css`): ink-role text tokens
  (`--accent-ink` / `--ok-ink` / `--warn-ink` / `--danger-ink`) so every
  status-coloured **text** pair passes **WCAG AA** in the light theme
  (accent-as-text was 2.77:1 on white → 5.93:1; ok 3.30 → 5.02;
  warn 3.19 → 5.02; ratios **computed**, and asserted **live** by the
  self-test) while the vivid base tokens keep painting borders and tints, so
  signal stays saturated where it isn't text. Dark inks equal the base
  colours (8.3–10.7:1 — already passing), so dark is visually unchanged.
  Plus: a disciplined **three-step elevation ladder** (`--shadow` resting
  card, `--shadow-2` docked drawer, `--shadow-3` floating panel —
  slate-tinted in light instead of dead black), **one** shared
  uppercase-label tracking token (`--track-label`, replacing 25 ad-hoc
  0.03–0.06 em values), and motion tokens (`--ease-out`, `--dur-1/2`).
- **Instrument typography**: KPI numerals are now tabular
  (`font-variant-numeric: tabular-nums` on `.kpi-value` / `.proc-kpi-val`)
  so a live readout never wobbles column-to-column; display-size KPI values
  get a touch of negative tracking.
- **Canvas craft** (`app.js`): a refined **selection affordance** — the one
  selected element earns a soft accent halo plus four corner ticks (glow is
  reserved for state that demands attention; nothing else on the floor
  glows); **stage-glow discipline** — only a *congested* flow station gets a
  halo, calm stations stay flat; **per-theme grid contrast** — dark 5 m
  major lines step up (`#2b3d5c → #34486b`) so the dark floor reads
  structured, light 1 m minors recede (`#e8edf3 → #eaeff5`) so placed
  elements pop. All deterministic — no time input, no RNG.
- **Micro-interactions**: a 1 px hover lift on rail icons authored *inside*
  `prefers-reduced-motion: no-preference` (reduce never sees it), an accent
  keel on the active rail tool, and drawer open/close riding the shared
  ease/duration tokens.
- **Empty-state composition**: a radial vignette focuses the welcome card
  while the floor grid stays legible at the edges; confident display-title
  tracking; the three action glyphs sit in quiet tinted chips. Same copy.

### Verification
- Self-test extended **114 → 118**: design tokens present, tabular KPI
  numerals, **live-computed** WCAG AA contrast on the ink tokens, and both
  reduced-motion guards in the shipped stylesheet.
- `sw.js` cache bumped `wt-v73 → wt-v74` (version-history trail preserved);
  all six harness cache pins synced. All 46 harnesses green; offline guard
  clean; no external assets (system font stacks only).

## [3.20.0] — 2026-08-10

Closes the two minor gaps the v3.17–v3.19 releases documented: (a) the CRAFT
placement optimizer still consumed the **stored** from-to arc rates even on a
declared multi-way process network, and (b) the per-element **fluid rate
overrides** were honoured in-memory by the v3.19 steady-state solver but
**dropped by the serializer**.

### Changed
- **CRAFT placement derives F from the resolved flow network**
  (`optimize_factory.js`): when the process block declares a **valid
  multi-way network**, `buildFD()` now builds the from-to flow matrix F from
  the **resolved arc flows** (`WT.process.resolveFlow` — the same numbers
  `metrics()` reports: split shares, merge accumulation, gozinto through
  assembly/dismantle) instead of the stored `process.routing` rates, so the
  placement objective **MHI = Σ F·D** weighs each arc by the
  material-handling intensity that actually flows on it. On the
  `machining-qa-split` archetype the 60/40 QA branch arcs weigh
  **72 / 48 parts/hr** at the offered 120/hr — even when the stored rates
  have gone stale (harness-proven: tampering every non-source arc's stored
  rate to 1/hr leaves the whole craft report **byte-identical**). A **plain
  chain** (every existing scenario) and an **invalid** declared network
  (already rejected by `validateFlow` with the friendly message) keep the
  stored rates on the **exact pre-v3.20 code path** — a full hand-written
  pin proves the chain craft report is **byte-identical** (MHI 3400 → 2200,
  one B↔C swap, no new keys). The never-illegal / never-worse guarantees
  are re-asserted on the resolved basis (independent legality oracle:
  in-bounds, overlap-free, DIN 15185 aisle count never increased; MHI
  monotone non-increasing; deterministic). `buildFD` reports the basis
  (`flowBasis: "resolved" | "stored"`); the craft report carries the key
  **only** on the resolved path so every existing output stays
  byte-identical.

### Added
- **Per-element fluid rate overrides persist** (`fluids.js` + `app.js`): the
  override keys the steady-state solver reads (`rateM3h`, `flowRateM3h`,
  `capacityM3`, `fillPct`, `inputs`) now survive save / load / share.
  `WT.fluids.overridesOf` / `WT.fluids.applyOverrides` are the single
  sanitizing source of truth (rates/capacity clamped ≥ 0, `fillPct` clamped
  0–100, mixer `inputs` a whole number ≥ 1; junk ignored; **non-fluid
  elements are never touched**). `serialize()` writes an override **only
  when actually set** on a fluid element — a layout with no overrides
  serializes **byte-identically** to before (asserted across all 24 example
  scenarios) — and `deserialize()` restores them. Hand-computed round-trip:
  the demo pipe's **30 m³/h** cap survives save → load (delivered 30 m³/h,
  tank full in **96 min**), where the v3.19 serializer silently reverted it
  to the 40 m³/h registry default (delivered 40, full in 120 min).
- **Role-aware rate fields in the existing Inspector** (Behaviour group —
  the established grouped-Inspector pattern, **no new panel, no redesign**):
  a Fluid source gets *Supply rate (m³/h)*, a conduit (Pipe / Portioner /
  DePortioner) *Flow capacity (m³/h)*, a Tank *Capacity (m³)* + *Fill level
  (%)*, a Mixer *Input streams*. Setting a value stores the override on
  that element; clearing the field (or re-entering the declared default)
  removes it, so the element serializes exactly as before.
- **Verification**: new `verify_craftflow.js` harness (the **46th**, wired
  into `test/run-all.mjs`, 38 checks, all expectations hand-computed): the
  full byte-identical chain-craft pin, the resolved 72/48 F matrix, the
  stale-stored-rates invariance proof, F ≡ resolveFlow arcs (can't
  diverge), an independent MHI recomputation, the never-illegal /
  never-worse oracle on the resolved basis, the invalid-network stored
  fallback, the override sanitization table, the 30-vs-40 m³/h round-trip
  proof and the example-scenario byte-identity sweep. Two new in-browser
  self-test checks (now **114/114**): the live serialize → deserialize
  override round-trip through the real app path, and the resolved-flows F
  matrix on the live `machining-qa-split` build.

### Honesty
- The optimizer remains a transparent **heuristic finding a local optimum**
  — modelled, not measured; NOT guaranteed optimal, NOT a validated
  discrete-event simulation, NOT CAD/BIM, NOT a certification. The fluids
  model remains a **steady-state analytical model** — NOT CFD, NOT
  hydraulics, NOT transient dynamics. Rates (including overrides) are
  synthetic teaching values the user edits.

### Infrastructure
- `sw.js` cache `wt-v72` → **`wt-v73`** (changed `optimize_factory.js`,
  `fluids.js`, `app.js`, `selftest.js`; no asset added or removed); the
  `verify_hardening` / `verify_palette` / `verify_analytics` /
  `verify_animation` / `verify_fluids` cache pins bumped to match.

## [3.19.0] — 2026-08-10

Gives the Fluids / process-industry component family (placeable since v3.7,
but static) its **deterministic continuous-flow behaviour** — the last big
functional parity item on the roadmap. Everything is a **steady-state
analytical model**: computed as closed-form arithmetic over the connected
component network — **no time stepping, no RNG, no clock**.

### Added
- **Fluids steady-state continuous-flow solver** (`fluids.js` → `WT.fluids`):
  fluid components that **touch** (a shared footprint edge ≥ 1 m; corner
  contact does not connect) form a network; multi-source BFS hop distances
  orient every junction from the drain-farther to the drain-nearer element
  (ties broken by source distance, then element id — a total order, so the
  directed network is **provably acyclic** and nothing ever flows into a
  source or out of a drain). Two analytical passes solve it: a **backward
  acceptance** pass (how much each element can accept and eventually deliver
  to a drain or buffer in a tank — a dead end accepts 0) and a **forward
  flow** pass (sources push their declared rate up to acceptance; at a
  branch, flow **splits equally capped by each branch's acceptance**, the
  excess re-filling unsaturated branches — deterministic water-filling, a
  documented model rule).
  - **Sources** produce at their declared `rateM3h`; supply the network
    cannot carry is reported as **curtailed** (back-pressure — an overflow
    risk at the source, with a plain-language warning).
  - **Pipes** carry up to `flowRateM3h`; a saturated pipe is named the
    **bottleneck** (utilisation 100 %).
  - **Tanks** buffer: `capacityM3` + `fillPct` give the free volume, and the
    net fill rate yields the **overflow horizon analytically** — *"fills at
    +50 m³/h, FULL in 96 min at current rates"* is free volume ÷ net inflow,
    pure arithmetic.
  - **Mixers** blend their input streams with **exact ratio conservation**
    (out = sum of ins; blend shares reported) and are flagged **starved**
    when fewer live input streams arrive than their declared `inputs`.
  - **Drains** consume; **Portioner/DePortioner** pass flow through
    conserved (their continuous↔discrete dosing is *not* modelled).
  - **Volume conservation is VERIFIED at every node** (in + produced = out +
    consumed + buffered + curtailed; residual reported — the same checked-
    not-assumed discipline as `resolveFlow`), and the network totals close:
    supply = delivered + buffered + curtailed.
- **Read-out in the existing Factory line efficiency card** (`#fluidsReadout`
  filled by `renderFluidsReadout()` — the v3.17 flow-rows pattern: **no new
  panel, no UI redesign**): network totals (supply → delivered / buffered /
  curtailed), the named bottleneck, per-element steady flows, tank fill
  horizons, and every warning (overflow risk / starved / dead end / no
  supply) in plain language. It refreshes with the panel and on every layout
  mutation, and renders **empty** for any layout without a connected fluid
  network.
- **A hand-computable demo** (`WT.fluids.demoLayout()`): 40 + 40 m³/h
  supplies → mixer blends 80 → 200 m³ tank at 60 % → pipe capped 30 m³/h
  (the bottleneck) → drain receives 30; the tank fills at +50 m³/h → FULL in
  **96 min**; conservation residual 0.
- **Verification**: new `verify_fluids.js` harness (the 45th, wired into
  `test/run-all.mjs`, 31 checks, all expectations hand-computed): the demo
  steady state, asymmetric mixer blending (60/20 → shares 0.75/0.25),
  capacity curtailment (40 offered → 30 carried, 10 backing up), terminal-
  tank fill time (120 min), branch water-filling (80 → 30/50), the starved-
  mixer / no-supply friendly messages, **collapse to the base case**
  (untouching fluid components = zero metrics; **every example scenario
  stays fluids-inactive and byte-identical** — `analyze()` is read-only and
  adds nothing to the serialize), determinism (byte-identical re-runs; no
  `Date`/`Math.random` in the source), the honesty labels, and the shipped
  wiring. Three new in-browser self-test checks (now **112/112**): the
  `WT.fluids` module shape, the demo computing + rendering in the live card,
  and the read-out staying inert/empty on a non-fluids layout.

### Changed
- `sw.js` cache `wt-v71` → **`wt-v72`** (new `fluids.js` in the app shell);
  `index.html` loads `fluids.js` before `app.js` and ships the
  `#fluidsReadout` container inside the existing Factory line card.
- Existing behaviour is otherwise untouched: **every existing scenario,
  example, generated layout and panel is byte-identical** — the solver only
  activates for layouts that actually connect fluid components into a
  network, and unconnected fluid components stay exactly as static as
  before.

### Honesty
- A **steady-state analytical model — modelled, not measured**. **NOT a
  validated process simulation, NOT CFD, NOT hydraulics** (no pressure,
  viscosity, head loss or pump curves), **not transient dynamics** (tank
  levels are a linear horizon at the current rates, drain-down / pull demand
  is not modelled), and **not a certification**. Rates are the components'
  synthetic order-of-magnitude teaching values; the equal-split branch rule
  is a documented model convention, not a hydraulic computation.

## [3.18.0] — 2026-08-08

Closes the two follow-up gaps the v3.17 release notes acknowledged: (a) the
factory layout **generator** could not emit a multi-way network (`derive()`
builds linear chains only — multi-way entered only via JSON import or the
demo), and (b) the optimizer consumed multi-way **metrics** but its **RPW
line-balancing** heuristics remained chain-oriented.

### Added
- **A fourth factory baseline that emits a genuine multi-way process network
  from the generator** (`generate.js`): **“Machining shop with QA split
  (multi-way flow)”** (`machining-qa-split`), selectable in the existing
  Generate flow (Factory mode), matched by generator keywords (“qa split”,
  “inspection split”, …), reachable from the command palette and from the
  plain-language *“use the machining-qa-split baseline”*. It lays out a
  machining feed lane (2 stations), **two QA branch stations** (the arms of a
  declared **60/40 split**) and a **pack-and-finish merge** step, and — new —
  **emits the matching `process` block from the generator itself**
  (`gen.process`, adopted by the app instead of the derived linear chain):
  operations bound to the placed elements (`op-<elementId>`, the `derive()`
  convention), split ratios declared on the arcs, accepted by
  `WT.process.validateFlow`, canonical under `sanitize`, ratio-preserving
  through the serialize round-trip. Hand-computed and harness-pinned at the
  offered 120 parts/hr: arc flows **120/120/72/48/72/48/120**, effective times
  **30/30/24/32/25 s** per finished unit, bottleneck **QA deep test** at 32 s
  → **112.5 parts/hr**, line efficiency 141/160 ≈ **88.1 %**, conservation
  residual ~0. Deterministic and seeded (the seed is recorded; the line
  composition is a fixed function of the profile — the same convention as
  every factory baseline). Reserving the branch lane emits **no** block (the
  app falls back to the honest derived chain — never a broken network).
- **RPW line balancing on resolved per-finished-unit effective loads**
  (`optimize_factory.js`): the balancer’s task times are now the **same
  numbers `WT.process.metrics` reports** — on a chain, the gozinto- and
  servers-weighted `cycle × cyclesPerFinished / servers`; on a declared
  multi-way network, `resolveFlow`’s proportional-flow effective times (a
  60 %-share QA branch weighs 0.6 × its cycle) — instead of raw chain cycle
  times. On the generated QA-split line this packs **[Machining 1+2] = 60 s /
  [QA deep + QA fast] = 56 s / [Pack] = 25 s** — the **theoretical minimum**
  of 3 stations (a raw-cycle balancer cannot see that the two branches
  together load only 56 s per finished unit). The RPW precedence walk is a
  DAG walk, so both branches of a split rank and pack correctly, and the
  packing respects precedence across the split and merge.
- **Verification**: new `verify_flowbalance.js` harness (the 44th, wired into
  `test/run-all.mjs`, 39 checks) — the generated block’s hand-computed
  resolved flows/metrics, byte-identical legacy builds, the reserved-lane
  fallback, a **full hand-written pin proving the pure-chain RPW output is
  byte-identical to the legacy balancer**, the multi-way packing hand case,
  bounded over-takt efficiency, and an optimizer that is **never illegal or
  worse** on multi-way inputs (independent legality oracle; TOC read-back
  equals `WT.process.metrics`). `verify_factory.js` now pins **4** factory
  profiles and runs the new baseline through the full geometry / compliance /
  determinism / part-flow battery. Two new in-browser self-test checks (now
  **109/109**). Service-worker cache bumped to `wt-v71` (every pinned
  harness synced).

### Changed (documented, deliberate)
- **Over-takt line efficiency is now bounded to [0, 1]**: when a task’s
  effective load exceeds takt (possible once loads are gozinto-weighted), the
  efficiency denominator switches from takt to the **realized bottleneck
  station time** (the classical Helgeson–Birnie basis). Previously an
  over-takt chain could report a “line efficiency” above 100 %. Lines with
  every load ≤ takt — which includes every pre-v3.18 balancer output — are
  computed exactly as before, and on a **pure chain** (servers 1, no
  assembly/dismantle) the entire balancer output is **byte-identical** to
  v3.17 (harness-pinned).
- Balancer outputs for chains **with** assembly/dismantle or multi-server
  stations (e.g. the generated assembly-line) now reflect the honest
  effective loads, so their groupings/efficiencies differ from v3.17’s
  raw-cycle numbers — the scenario **data** is untouched and byte-identical;
  only the advisory balance read-out changed.

### Unchanged / honesty — what remains chain-oriented
- The balance is a **capacity grouping only**: it never re-routes flow, never
  changes declared split ratios, and never adds/removes servers. An
  **invalid** declared network falls back to raw cycle times after
  `validateFlow`’s friendly rejection (never a guessed resolution). The CRAFT
  placement objective continues to use the stored from-to arc rates (which,
  for the generated baseline, equal the resolved flows). Structural
  plain-language edits on the new baseline **re-derive a linear chain**
  (`derive()` remains chain-only by design — the network comes from the
  generator recipe or an import).
- Every existing scenario, all three legacy factory baselines and all four
  warehouse baselines are **byte-identical**. UI direction unchanged — the
  new archetype appears inside the existing Generate flow; the optimizer
  panel only re-words its Balance labels (“Σ effective load ÷ n × takt”).
- Everything stays **modelled, not measured**; a **heuristic local
  optimum** (not guaranteed optimal); deterministic, teaching-scale; **NOT a
  validated discrete-event simulation**, not CAD/BIM, not a certification.

## [3.17.0] — 2026-08-08

### Added
- **Multi-way proportional-flow routing in the factory line simulation
  (`process.js`).** Until now the from-to routing arcs of a `process` block
  were *structural* — a branched network could be declared and serialized, but
  the deterministic line sim flattened everything onto one linear chain. Now a
  block that **declares** a split (≥ 2 outgoing arcs, each carrying a `ratio`,
  ratios summing to ~1) or a merge (≥ 2 incoming arcs) is **resolved into a
  proportional flow network** (`WT.process.resolveFlow`): split arcs carry
  their declared share, merges accumulate, assembly divides (inputs → 1) and
  dismantle multiplies (1 → outputs), and **conservation is verified at every
  node** (flow out = transformed flow in, residual ~0). The token line sim runs
  **on that network** (`WT.process.simulateFlow`) with the same 4-phase
  blocking-buffer mechanics plus a **deterministic largest-deficit quota
  dispatcher** at each split — no `Date`, no RNG, exact long-run proportions —
  and `metrics()` reports the Theory-of-Constraints bottleneck, takt,
  utilisation, line efficiency and Little's Law WIP/lead-time on the resolved
  per-finished-unit loads, plus an additive `flow` summary
  (splits/merges/arcs/conservation).
- **Friendly validation, never a guess** (`WT.process.validateFlow`): ratio
  sets that don't sum to ~1, a split arc without a ratio, routing cycles and
  duplicated arcs are rejected with a plain-language message (shown in the
  existing Factory line read-out; `metrics()` returns null rather than
  computing nonsense).
- **Hand-computable demo network** (`WT.process.demoNetwork()`): an importable
  wt-1 layout — source → Machining → **60 % QA fast / 40 % QA deep** → merge →
  Pack → drain at 100 parts/hr offered. Exact expectations: effective times
  30/24/32/25 s per finished unit, bottleneck *QA deep test* at 32 s →
  **112.5 parts/hr**, utilisation 0.9375/0.75/1/0.78125, line efficiency
  111/128 ≈ 86.7 %, arc flows 100/60/40/60/40/100 parts/hr, conserved at every
  node.
- **Verification**: new `verify_flownet.js` harness (the 43rd) — hand-computed
  split/merge flows, independent node-by-node conservation recompute, a
  dismantle-then-split gozinto case, determinism (identical 50/50 branches
  measure identical utilisation), friendly-rejection messages, and **collapse
  to the base case**: on every generated factory profile the network sim
  reproduces the legacy chain sim **byte-identically** and neither `flow` nor
  `ratio` keys appear anywhere. Three new in-browser self-test checks (now
  **107/107**). Service-worker cache bumped to `wt-v70`.

### Unchanged / honesty
- **Every existing scenario is byte-identical.** Plain-chain process blocks
  take the exact legacy code path; `derive()` still builds linear chains; a
  warehouse layout still has no process block. The UI direction is untouched —
  the only surface change is extra rows inside the existing Factory line
  read-out, and only for blocks that actually declare multi-way routing.
- The line metrics remain a **deterministic proportional-flow model —
  modelled, not measured**; teaching-scale; **not a validated discrete-event
  simulation**, not CAD/BIM, not a certification.

## [2.0.0] — 2026-08-05

### Added
- **Consolidated showpiece release.** Brings Story Mode, the 894-element
  signature plant, the user-definable object library and the 2.5D isometric
  view together as the flagship build, with a new README hero and captured
  in-app screenshots.
- No behavioural or determinism change versus 1.15.0 — this is the
  presentation/consolidation release; the version metadata is reconciled to
  **v2.0.0** across the docs.
- Verification is fully green and unchanged in substance: **35 headless logic
  harnesses** (`node test/run-all.mjs`) plus the in-browser end-to-end
  self-test at **PASS 57/57**. Proprietary, offline-only, strict-CSP intact.

## [1.15.0] — 2026-08-05

### Added
- **User-definable object library (`library.js`, `WT.library`).** The palette
  is no longer a fixed preset list — define your own object *types* from a base
  material-flow behaviour class (storage / conveyor / station / transporter /
  dock / zone), organised into a categorised, collapsible palette tree; the
  built-in equipment types become editable *seeds* (clone a built-in into a
  custom).
- A **"Define Object" dialog** (name, category, base, integer-metre footprint,
  height, a 2D glyph + colour, and base-specific behaviour params) with Edit /
  Clone / Delete. A saved def injects straight into `WT.domain.ELEMENTS` so
  every existing consumer (capacity, aisle/overlap, compliance, the WMS/flow
  sim, the IFC export, the 2D + 2.5D renderers, serialize) resolves it with
  **no special-casing** and a built-in-only layout stays byte-identical.
- Persists to localStorage, import/exports as JSON, and **embeds** any custom
  types a layout uses into the `wt-1` serialize output (a default no-custom
  layout serializes byte-identically to before). Deterministic: no `Date`, no
  RNG.
- New **`verify_library.js` harness (35th)** plus Define-Object /
  categorised-palette in-browser self-test checks.

## [1.14.0] — 2026-08-05

### Added
- **894-element signature mega-plant.** A single, deliberately huge *synthetic*
  automated fulfilment/distribution plant added to the Example Scenarios
  library (`examples.js`, `mega-automated-fulfilment-plant`), bringing the
  library to **23 scenarios**.
- Its **own large floor (372 × 248 m**, within the app's **400 × 250 m** max)
  and a dedicated deterministic tiling builder that lays **894 elements**
  exercising the whole equipment palette at once (AS/RS aisles, VNA, shuttle
  high-bay, deep-lane reserve, mezzanine pick faces, a conveyor-and-sorter
  spine with RGV/AGV lanes, inbound/outbound dock walls). Clean rack blocks
  separated by empty streets, so it is **overlap-free** and never *fails*
  aisle/escape compliance by construction.
- Loads as a first-class dropdown/side-panel example, renders in 2D + 2.5D,
  animates the material flow and works under Story Mode; the v1.6 view-culling
  + shapes LOD keep 800+ elements smooth. Deterministic (no `Date`, no RNG);
  the 22 existing scenarios stay byte-identical.
- `verify_examples.js` gains 10 showcase checks; the self-test gains a live
  "mega loads + renders + compliance-safe at 800+ elements" check.

## [1.13.0] — 2026-08-05

### Added
- **Story Mode — a cinematic one-click guided tour.** A new pure, DOM-free
  `WT.story` module (`story.js`): an ordered **7-step** plan (load a synthetic
  e-commerce FC scenario → frame the whole plant → walk the five functional
  zones in flow order with plain-language captions → start the live material
  flow) plus the camera math behind the moving shot (`ease`, `frameZone`,
  `lerpCamera`).
- A top-bar **"Story"** control starts/exits it; a caption HUD carries
  Pause/Resume + Skip + Exit; Esc exits; it is fully keyboard-accessible.
  Deterministic (a frame-counted tween, no `Date`/RNG); under
  `prefers-reduced-motion` the camera **jump-cuts** and each caption still
  dwells.
- Plays over the **same synthetic, illustrative** example scenario — a
  transparent teaching animation, **not** a real DES engine, **not** a
  measurement and **not** a certification.
- New **`verify_story.js` harness (34th)** plus Story in-browser self-test
  checks.

## [1.12.0] — 2026-08-04

### Added
- **Realistic floor: measurements, markings & a finer grid.** A
  **rendering-only, additive** facility layer on top of the rich objects
  (v1.11) so a big plant reads like a real facility — the *floor* now, not just
  the equipment. All geometry is a **pure, deterministic** function of the floor
  size + the element list in a new **DOM-free `floor.js` (`WT.floor`)** module
  (no `Date`, no RNG), consumed by `app.js` for the actual canvas strokes.
  - **Two-tier grid with LOD.** Major **5 m** grid lines always draw; the minor
    **1 m** lines are **level-of-detail-gated** — they appear only once a cell
    reads at least **14 px** on screen (`WT.floor.minorGridVisible`), so a
    400 × 250 m hall zoomed out isn't an unreadable smear and the wasted
    per-line cost is skipped. At normal zooms on any ordinary floor the 1 m
    lines show exactly as before, so the base look is unchanged.
  - **Scale ruler + dimensions.** A metre **ruler** runs along the **top and
    left** floor edges — ticks + labels from a pure `rulerTicks(floorMetres,
    stepM)` that always closes on the true floor edge — with the **label step
    widening** when zoomed out (`rulerLabelStepM`) so labels never collide. When
    an element is **selected**, its **dimensions** (`w × d m`, from
    `dimensionLabel`) show in a small pill beside it. The ruler + dimensions
    ride in **screen space** (crisp at any zoom) but are positioned via the
    **same `worldToScreen`** the hit-test uses, so they track pan/zoom/Fit.
  - **Floor markings (faint, theme-aware, under the elements).** A facility
    **perimeter** outline; **aisle centre guides** down the working aisle
    between facing rack rows — derived from the **same `WT.domain.facingAisle-
    Pairs`** model the Compliance Check uses, so a guide can never disagree with
    the aisle rule; **dock-approach hatching** in front of dock doors
    (`dockApproach`, clamped in-bounds); and functional **zone tints**
    (receiving / storage / picking / packing / shipping, coloured from the
    theme's flow-stage palette) that appear **only when zone-bearing elements
    exist**. The fine markings are LOD-gated (`markingsVisible`); the perimeter
    + tints are cheap and draw whenever the layer is on.
  - **A "Measure" toolbar toggle** (default **on**) shows/hides the ruler,
    dimensions and markings; the two-tier grid LOD is always on. Off, the view
    is essentially as before.
  - **The element data model is UNCHANGED** — positions and sizes stay
    **integer-metre cells**, so compliance, capacity and the simulation are
    untouched; the whole feature is view-culled + LOD-gated so 400 × 250 m maps
    stay smooth, with no per-frame allocation in the hot loops.
  - **Honest scope.** This is an **illustrative facility rendering of a
    synthetic model** — the "measurements" are the model's own **metre grid
    (1 cell = 1 m)**, **not** a site survey and **not** CAD/BIM (the real
    geometry path remains the IFC export). No real brands.
  - `floor.js` (new) + `app.js` (two-tier grid, zone tints, markings, ruler,
    dimension readout, the Measure toggle); `index.html` loads `floor.js` +
    gains the `measureBtn` control; `sw.js` precaches `floor.js` and bumps the
    cache **wt-v40 → wt-v41**. **New `verify_floor.js` harness (33rd):**
    `rulerTicks` positions/labels/edge-close (garbage → `[]`, deterministic,
    non-mutating), the grid tiers + minor-grid px/cell threshold, the ruler
    label-step widening, `dimensionLabel` text, `perimeter`/`dockApproach`/
    `aisleGuides` finite + in-bounds + non-mutating on every edge/axis,
    `zoneTints` only when zones exist (right stage, skips transport/boundary),
    the illustrative / not-a-survey / not-CAD-BIM honesty label, and the shipped
    wiring. The live pixels are verified in the browser; every geometry path is
    covered here.

## [1.11.0] — 2026-08-04

### Added
- **Realistic high-detail object rendering (progressive LOD).** A **third**
  level-of-detail tier on top of the existing **icon** (far) and **glyph** (mid)
  tiers, so the plant reads like a real facility when you zoom in — while big,
  zoomed-out layouts stay just as fast.
  - **`WT.shapes.detailLevel(pxPerCell)` → `"icon" | "glyph" | "rich"`**, a pure
    function of the **on-screen** pixels-per-cell (base `cellPx` × the view
    zoom). Thresholds: below **10 px/cell** → icon, **10–40** → glyph (today's
    default), **≥ 40** → the new **rich** tier. `draw2D` and `draw3D` pick their
    fidelity from it. The rich tier only fires when an element is **large on
    screen** (zoomed in) *and* clears the existing footprint-legibility guard —
    so a big hall at normal zoom never pays for it.
  - **What "rich" adds (2D top-down), layered on top of the base glyph so
    animated parts keep moving:** racking / AS-RS / shuttle / drive-in /
    push-back / flow gain **pallet load-units** sitting in a share of the bay
    positions; **AS/RS** a structured deep rack each side of the crane aisle;
    **docks** a panelled door with guide rails; **conveyor** a couple of belt
    load-units (they scroll when the flow is playing, static otherwise);
    **stations / returns** a tote on the bench; **mezzanine** an interior post
    grid; **forklift / RGV / AGV** a load body; plus sorter trays, stretch-wrap
    film bands, cantilever long-goods bars, a charging post and a gate
    threshold. Type colour kept; theme-aware.
  - **What "rich" adds (2.5D isometric):** the extruded forms gain **pallet
    load-units on the shelf levels** for racking; **AS/RS** a tall multi-level
    rack each side of the crane mast; **mezzanine** a decked platform on an
    **interior post grid** with pallets on the deck; **conveyor** belt
    load-units; **vehicles** a small 3D load body. Painter-order and the single
    light direction are unchanged.
  - **Deterministic, allocation-lean, LOD-gated.** The load-unit fill is a
    **fixed rule seeded from the element** (its floor position) — **no `Date`,
    no RNG** — so it is stable frame-to-frame, identical on re-render, and
    testable; identical racks at different spots don't look cloned. The rich
    overlays add **no per-frame allocation** in the hot path, and the existing
    v1.6 **view-culling** still only paints on-screen footprints, so zooming in
    on one corner of a large hall stays smooth. The `anim` phase still drives
    every moving part at the rich tier.
  - **Honest scope.** This is an **illustrative, higher-fidelity schematic of a
    synthetic model** — still **not** CAD, BIM or a survey (the real geometry
    path remains the IFC export), and the load-units shown are an **illustrative
    fill pattern, not the actual computed inventory count**. No real brands.
  - `shapes.js` gains `detailLevel` + the `RICH2D`/`RICH3D` overlays; `iso.js`
    `drawScene` threads the on-screen px/cell into `draw3D`; `app.js` passes the
    per-element fill seed (2D) and the on-screen px/cell (iso). **New
    `verify_detail.js` harness (32nd):** `detailLevel` thresholds +
    determinism, an **every-type** rich 2D+3D mock-context smoke (light + dark,
    all-finite, no throw, no input mutation), rich **adds** detail and is
    **LOD-gated** (icon < glyph < rich; below the threshold the output equals
    the plain glyph), the fill is deterministic + seed-sensitive, the anim phase
    still moves at the rich tier, and the illustrative / not-an-inventory-count /
    not-CAD-BIM honesty labels are present. Rendering only — the simulation,
    logic, compliance, IFC and isometric projection are untouched. Service
    worker cache bumped `wt-v39` → `wt-v40`. Offline, no dependencies, no cost.

## [1.10.0] — 2026-08-04

### Changed
- **Larger maps + wider zoom range — fit MORE items on the floor.** The
  editable warehouse now scales up to a **400 × 250 m** hall (was 120 × 80 m),
  and the interactive zoom clamp widens to **0.04× – 8×** (was 0.2× – 5×) so the
  **whole** largest floor can be **framed with Fit** and then zoomed in for
  detail.
  - **Fit actually frames the max floor now.** Because the viewport keeps the
    reference aspect, `fitView` computes a scale of **≈0.092×** for the full
    400 × 250 m floor — which used to be clamped up to the old 0.2× minimum
    (cutting the floor off). The new 0.04× minimum sits comfortably below that,
    so the clamp no longer floors the Fit scale and the entire hall is visible.
    Zooming out past Fit is still allowed for breathing room; **100%** still
    resets to a centred 1:1, and wheel / `+` / `−` keys work across the wider
    range.
  - **Still smooth at size.** Rendering and navigation only — **no change to the
    simulation, logic, compliance, IFC or isometric projection** (fully
    deterministic). The existing view-culling (`WT.view.cullToView`) means a big
    floor with many items only draws the elements whose footprint is on screen,
    and the per-type shapes LOD collapses to a single icon when zoomed out, so a
    large hall stays responsive.
  - A very large but **sparse** floor is honestly just extra empty space — the
    bigger maximum only gives complex layouts more room; it invents nothing.
  - `view.js` `FLOOR_MAX_W`/`FLOOR_MAX_H` and `SCALE_MIN`/`SCALE_MAX` raised;
    `index.html` floor-size input `max` attributes raised to match;
    `verify_view.js` extended with checks that `normalizeFloor` accepts the large
    max (and clamps beyond it), that `fitView` frames the max floor **within** the
    new clamp at any reference viewport, that the wider `clampScale` bounds hold,
    that a large-floor `cullToView` returns only on-screen elements, and a
    set-max-floor-then-Fit round-trip whose bounds cover the whole floor. Service
    worker cache bumped `wt-v38` → `wt-v39`. Offline, no dependencies, no cost.
  - Illustrative schematic of a synthetic model, **not** CAD/BIM; no real brands
    or vendor models; the sizes are order-of-magnitude teaching values.

## [1.9.0] — 2026-08-04

### Added
- **More equipment types: eight new, genuinely distinct warehouse objects in
  the palette.** Each carries an honest domain schema **and** a **distinct 2D
  top-down glyph plus a distinct 2.5D isometric form** (one source of truth,
  `WT.shapes`) — none is a plain rectangle. Additive and non-breaking: the
  existing 21 types and every saved layout / example / generated plant load and
  render **unchanged**; the new types route through the **same generic**
  place / select / drag / overlap / compliance / capacity paths. All
  in-browser, offline, no dependencies, no cost.
  - **Two storage systems** (they carry pallet positions and form working
    aisles like the other racking):
    - **Pick-to-light rack** — small-parts shelving with light-directed pick
      modules; fully selective each/carton pick faces, capacity stated in
      pallet-equivalents (`pickFace`), fast confirmed picks (−3 s/line in the
      sim). *Glyph:* shelf grid + a lit module dot per bay. *Form:* low
      see-through shelf frame + lit pick-face displays.
    - **VNA narrow-aisle racking** — very-narrow-aisle, guided man-up turret
      racking; near-drive-in floor density with **100 % selectivity** across
      full height, at a slower man-up cycle (+4 s/line) and a guided ~1.6–1.8 m
      aisle (informed by DIN 15185). *Glyph:* dense narrow bays + a guided-aisle
      rail. *Form:* tall many-level rack frame + a floor guide rail.
  - **Six handling / support / boundary elements** — all **0 storage capacity**
    (movement/processing equipment, like RGV/AGV):
    - **Forklift / reach truck** — a materials-handling truck at its operating
      spot (the working aisle it needs is placed separately as a gap).
    - **Charging station** — a battery/opportunity charging point for the
      AGV/AMR or truck fleet.
    - **Sorter loop (tilt-tray)** — a **closed-loop** tilt-tray/cross-belt
      sortation system with divert chutes (distinct from a straight conveyor
      *segment* — a routing **loop**, not a point-to-point link). *Animated:* a
      tray circulates the loop while the flow plays.
    - **Stretch-wrap / palletiser** — an end-of-line pallet-wrapping turntable.
      *Animated:* the wrap mast orbits the load while the flow plays.
    - **Returns / QA station** — a bench for returns processing and quality
      inspection (grade → re-label → restock or scrap).
    - **Gate / sectional door** — an internal zone-segregation barrier (fire /
      security / temperature), **distinct from a loading dock door** (no vehicle
      bay, no inbound/outbound flow direction).
  - **Honest categorisation + safe integration.** The two storage types are
    `category:"storage"` (non-zero `elementCapacity`, aisle-aware); the six
    handling/support types are `category:"flow"` with **0** capacity, so they
    never inflate storage or misfire the aisle/route logic. The 2.5D height
    table (`iso.js` `HEIGHTS`) and the editable KB densities auto-mirror the
    domain model. Illustrative schematics of a **synthetic** model — **NOT**
    CAD/BIM, no real brands or vendor models.
- **`verify_shapes.js` extended** (now **17 checks**): the eight new types are
  in the domain, the shape registry (2D **and** 3D) and the palette; their
  `elementCapacity` is **0** for the six handling/support types and **> 0** for
  the two storage types; a focused draw smoke covers every new type in
  2D + 3D × light/dark × small/large with **no throw**, **all-finite** coords
  and **no mutation**; and the two new animatable forms (sorter loop,
  stretch-wrap arm) visibly **move** their part across animation phases.

### Changed
- **Offline PWA cache** bumped `wt-v37` → `wt-v38` (`domain.js`, `shapes.js`,
  `iso.js`, `app.js` changed; nothing added to the shell). Fully offline; no new
  dependencies; no external references. (The `wt-v37` cache-version assertions
  in `verify_animation.js` and `verify_hardening.js` were updated to `wt-v38`.)

## [1.8.0] — 2026-08-04

### Added
- **A "living plant": press `P` to switch 2D ⇄ 3D, material flow now runs in
  the 3D view too, and the equipment itself is animated.** Additive and
  non-breaking — a normal load looks and behaves exactly as before, and when
  the flow isn't playing every element renders in its static form as today.
  All in-browser, offline, no dependencies, no cost.
  - **`P` toggles the whole view 2D ⇄ 2.5D.** A keyboard shortcut fires the
    **same** view-mode toggle the toolbar's "2.5D view" button uses (no
    re-implementation). It is **input-guarded** (ignored while typing in an
    `input`/`select`/`textarea`) and **modifier-guarded** (ignored when Ctrl/
    ⌘/Alt is held, so it never hijacks a browser/OS shortcut). Pan keeps its
    own affordances — the **Pan** button, **Space**, and **middle-mouse drag**
    — so `P` is unambiguously the view switch. The 2.5D button now advertises
    the shortcut in its label/title.
  - **Material flow renders in the 2.5D (3D) view too.** The animated flow
    handling-units (MUs) and the pick/put/pack **station rings + queue badges**
    are projected through the isometric projection (`WT.iso.project`, lifted a
    little off the floor) and drawn stage-coloured **inside the 2.5D scene** —
    not just top-down. It composes with zoom / pan / Fit exactly like the
    top-down overlay.
  - **The equipment is animated in both views.** While the flow is **playing**:
    **conveyors** scroll unit-loads along the belt in the flow direction;
    **RGV/AGV** vehicles travel their lane (rail-guided back-and-forth,
    free-roaming loop); **AS/RS** and **shuttle** carriages run the aisle and
    lift. It is driven by a **deterministic animation phase seeded from the
    flow sim's tick** — `WT.shapes.equipmentPhase(t, seed)`, a pure function
    with **no `Date`/`Math.random`**, bounded in `[0,1)` and periodic — passed
    as **one source of truth** into `WT.shapes.draw2D`/`draw3D` so the top-down
    glyph and the 2.5D form move **identically**. It **pauses with the sim**
    (the tick stops advancing → a static frame — Step/Pause show equipment
    still), is **LOD-aware** (skipped when an element reads too small on
    screen), honours **prefers-reduced-motion**, and allocates nothing new in
    the per-element hot loop.
  - **Honest scope.** This is **illustrative** animation of a **synthetic**
    teaching model — the moving parts do **not** change any KPI, label or the
    flow model; the 2.5D heights remain illustrative defaults (not a survey,
    not a BIM model — the real geometry path is the separate IFC export). No
    real brands; every motif is a generic material-handling schematic.
- **New harness** `verify_animation.js` (**31st**, 14 checks): `equipmentPhase`
  is bounded/deterministic/periodic/garbage-safe; a mock-context smoke draws
  every animatable type (conveyor/rgv/agv/asrs/shuttle) in **2D and 3D** across
  a range of phases + themes with **no throw** and **all-finite** coords; a
  distinct phase visibly **moves** the part (while a non-animatable type
  ignores `anim` and the static no-anim path is byte-identical); the 2D
  animation is **LOD-skipped** when tiny; neither draw mutates its inputs;
  `WT.iso.project` maps an MU world position to finite coords; and the shipped
  wiring is asserted (the `p`/`P` keydown → view toggle, input- + modifier-
  guarded; flow-in-3D via `projPx` → `WT.iso.project`; the anim tick-seeded,
  playing-gated, threaded into `draw2D` + `drawScene(animFor)`; the button
  hint; the `sw` bump; the self-test check; the runner entry).
- **Self-test extended** (`selftest.js`, now **47** checks): a live check that
  dispatching a real `KeyboardEvent("keydown", {key:"p"})` on the window
  **toggles the view mode** `top → iso → top` through the same handler a real
  keypress uses.

### Changed
- **Offline PWA cache** bumped `wt-v36` → `wt-v37`. `shapes.js` (the animation
  phase + moving parts) and `iso.js` (the `animFor` pass-through) already ship
  in the precache; nothing added to the shell. Fully offline; no new
  dependencies; no external references. (`verify_hardening.js`'s cache-version
  assertion updated `wt-v36` → `wt-v37`.)

## [1.7.0] — 2026-08-03

### Added
- **Deep-link to a scenario via URL.** A URL can now open a specific example
  scenario (and skip the onboarding modal), so a synthetic plant is
  **shareable/embeddable with a link** and a demo or screenshot can open a
  chosen plant directly, unobstructed. Additive and non-breaking — a normal
  load (no query flags) looks and behaves exactly as before.
  - `index.html?scenario=<id>` (or the alias `?example=<id>`) where `<id>` is a
    `WT.examples.library` id — e.g. `index.html?scenario=coldchain-frozen-dc` —
    loads that scenario onto the floor **via the same `loadExample()` the side
    panel and header quick-pick use** (no re-implementation) and suppresses the
    welcome modal for that load so the plant shows immediately.
  - `?onboarding=0` (also `false`/`off`/`no`) suppresses the welcome modal on
    its own, without loading a scenario; a `?scenario=` implies it.
  - **Nothing is persisted.** A deep-link is per-URL, not a saved preference —
    it never flips the "don't show onboarding again" `localStorage` flag; it
    only suppresses the modal for that one load. (Loading the scenario itself
    autosaves the working layout exactly as the UI "Load onto floor" button
    does — that is the shared loader's normal behaviour, unchanged.)
  - **Unknown id is safe:** a `?scenario=` that isn't in the library falls
    through to a normal boot with a gentle notice — a bad link never breaks the
    app.
  - **Composes with everything.** Boot **precedence**: an explicit `#layout=`
    share-hash wins, else a `?scenario=` deep-link, else the saved layout, else
    the demo starter. `?selftest=1` is never hijacked; `?tour=off` still works.
  - The parsing is a **pure, DOM-free, deterministic** helper
    `WT.deeplink.parse(search) → { scenario, skipOnboarding }` (`deeplink.js`)
    that reads nothing, mutates nothing and does **not** validate the id (it
    returns the raw id; the app validates it against the library) — so it is
    fully headless-tested.
- **New harness** `verify_deeplink.js` (**30th**): the parser returns the id
  for `?scenario=` and `?example=` with onboarding suppressed, `?onboarding=0`
  suppresses on its own (`?onboarding=1` keeps the modal), an empty/`?`/
  non-string query and `?selftest=1` are a clean no-op, an unknown id is
  returned verbatim, a real library id round-trips, purity + determinism
  (proven with a poisoned `document`, no input mutation), composition +
  order-independence, and tolerance of a trailing `#fragment`/`+`-space/
  malformed `%xx`/bare key without throwing.
- **Self-test extended** (`selftest.js`, now **46** checks): a live check that
  `WT.deeplink.parse` exists and that `parse("?scenario=<real id>")` yields
  that id with onboarding suppressed while `?selftest=1` stays a no-op.

### Changed
- **Offline PWA cache** bumped `wt-v35` → `wt-v36`; `deeplink.js` added to the
  service-worker precache and loaded in `index.html` before `app.js`. Fully
  offline; no new dependencies; no external references.

## [1.6.0] — 2026-08-03

### Added
- **Production hardening (pass 2): accessibility, large-layout performance, and
  a QA/production checklist.** Real, verified improvements — additive and
  non-breaking; a normal load looks and behaves exactly as before.
  - **Accessibility (real, but *not* a WCAG certification).**
    - **Landmarked regions:** `<main>` and the three columns carry `aria-label`s
      (building tools / floor / simulation panels) so assistive tech can jump
      between them.
    - **The `<canvas>` gets a text alternative.** A canvas is opaque to screen
      readers, so `#floor` now carries an `aria-label` **and** an
      `aria-describedby` pointing at an **offscreen summary** (`#floorDesc`,
      `.sr-only`) that `app.js` keeps current — element count, floor size (m),
      view mode, and live-flow status. It only touches the DOM when the text
      changes, so it stays cheap even during playback.
    - **Named toolbar controls:** the icon / short-text controls (zoom −/+,
      Fit, 100%, Pan, 2.5D, Guided demo, Play/Pause) all expose an accessible
      name (`aria-label`/`title`). Every primary control is a native
      `<button>` (keyboard-operable); the custom card-header toggles remain
      `role="button"` + `tabindex` + Enter/Space.
    - **Visible focus:** a `:focus-visible` outline is shown on every
      interactive control (buttons, button-styled links, role=button toggles).
    - **Reduced motion honoured:** with the OS "reduce motion" setting on, the
      continuous material-flow animation **does not auto-run** — Play shows a
      single static/stepped frame and the app stays **fully usable** (Step /
      Reset advance the model on demand). This governs the one-click Guided
      demo too. CSS transitions/animations are also stilled. `app.js` reads a
      cached `prefers-reduced-motion` matcher.
  - **Performance for large layouts (bounded effort, *not* a guarantee for
    arbitrary size).** A new **pure, testable** helper
    `WT.view.cullToView(elements, viewBounds, pad)` culls the per-frame element
    draw to the elements whose footprint overlaps the visible world rectangle
    (`WT.view.viewBounds`), so on a big floor (e.g. 120×80) zoomed in, glyph +
    label work is proportional to what is **on screen**, not the whole layout.
    The per-type shapes registry already drops to a single LOD icon when zoomed
    out. **Simulation results are unchanged** — this is rendering/throughput
    only; every logic/determinism harness still passes byte-for-byte.
- **New maintainer doc** `docs/QA_CHECKLIST.md` — an honest pre-release
  checklist (offline works; installs as a PWA; service-worker cache bumped;
  `?selftest=1` → `PASS n/n` with the headless one-liner; no console errors;
  CSP present; error boundary works; keyboard/a11y checks; large-layout perf
  sanity; data stays on-device; honesty labels present; proprietary license).
  Cross-linked from `docs/PRODUCTION.md` (new a11y/perf section).
- **Self-test extended** (`selftest.js`, now **45** checks): the canvas
  aria-label + offscreen description, key toolbar controls having accessible
  names, the reduced-motion flag hook, and the pure `cullToView` culling being
  correct + non-mutating — driven against the live app.
- **New harness** `verify_a11y_perf.js` (**29th**, ≥ 10 checks) gates all of
  the above headlessly: the canvas aria wiring, named toolbar controls,
  landmarked regions, the `prefers-reduced-motion` rule + the flow loop reading
  the flag, `:focus-visible` + `.sr-only`, `cullToView`/`viewBounds` purity +
  correctness + determinism, `QA_CHECKLIST.md` presence, the new self-test
  checks, and the license staying proprietary (no MIT in any touched file).
- Service-worker cache bumped **`wt-v34` → `wt-v35`**.

## [1.5.0] — 2026-08-03

### Added
- **Production hardening: in-browser self-test, global error boundary, and a
  strict Content-Security-Policy.** The app's DOM/UI had only ever been tested
  indirectly (the harnesses cover pure logic); this pass closes that gap with a
  real in-browser end-to-end self-test plus two safety nets — none of which
  change a normal load.
  - **Global error boundary** (`errors.js`, loaded **first**, before every other
    script). It installs `window.onerror` + `window.onunhandledrejection`,
    records every uncaught error / unhandled rejection into
    `window.__WT_ERRORS__`, and surfaces **one honest, non-blocking banner**
    — *"Something went wrong — details in console."* — instead of leaving a
    silently dead UI. It never **swallows** an error: the handlers do not return
    `true` / `preventDefault()`, so the browser's own console reporting stays
    intact. Tiny, dependency-free, CSP-safe.
  - **In-browser self-test** (`selftest.js`, `?selftest=1`). **Inert** by default
    — a normal load never runs it. When enabled it waits for boot, then drives
    the **live app** through the same functions the UI uses (exposed as
    `window.__WT_TEST_API__` only in self-test mode) and asserts ~40 checks:
    every `WT.*` module present and correctly shaped, a clean error-free boot,
    the key panels/buttons in the DOM, a real example load placing elements and
    redrawing, WMS ops populating its panel, the flow stepping/playing then
    stopping, the 2.5D toggle being a pure layout no-op, the report building with
    its expected sections, About/KB opening, and the zoom controls running. It
    writes a **machine-readable** result into a `#wt-selftest` element and the
    console — `WT-SELFTEST: PASS 40/40` or `WT-SELFTEST: FAIL n/40 :: <checks>`
    — for a maintainer to read headlessly. Each check is isolated (a thrown
    check is one FAIL, never a dead page) and the suite restores the app to a
    normal state at the end.
  - **Strict offline Content-Security-Policy** (`<meta>` in `index.html`):
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; connect-src 'self'; worker-src 'self';
    manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';
    frame-src 'none'`. No external hosts, **no `unsafe-eval`**, no inline scripts;
    inline **style** is allowed because the UI uses a handful of `style=""`
    attributes. A static scan confirms there is no `eval(` / `new Function(` and
    no inline `on*=` handler anywhere, so the policy breaks nothing. This is
    **best-practice hardening for an offline app, not a security certification**.
- **New harness** `verify_hardening.js` (28th) verifies all of the above
  headlessly (the error boundary actually installs + records + does not swallow
  under a window-shim; the CSP directives; the eval/inline-handler scan; the
  self-test's inertness, ≥ 25 assertions and machine-readable output; the
  guarded test API; the service-worker precache + cache bump). The **live**
  self-test runs in a real browser; the harness gates its presence and wiring.
- Service-worker cache bumped **`wt-v33` → `wt-v34`**; `errors.js` + `selftest.js`
  added to the offline precache shell.

## [1.4.0] — 2026-08-03

### Added
- **Distinct 2D + 3D object representations.** Every warehouse object type
  now has its **own recognizable schematic** in both views instead of a
  coloured rectangle (top-down) and a plain height-extruded box (2.5D). A new
  **single per-type shape registry** (`shapes.js` → `WT.shapes`, exposing
  `has / draw2D / draw3D / ICONS / meta`) is the **one source of truth** both
  renderers route through:
  - **Top-down glyphs** (`draw2D`): selective racking → shelf-bay grid;
    drive-in → deep lanes + entry depth arrows; double-deep → paired bays +
    two-deep divider; push-back → nested chevrons; pallet-flow/carton-flow →
    roller dots + FIFO flow chevrons; mobile racking → base rail + wheels;
    cantilever → column + projecting arms; AS/RS → tall-rack hatch + crane
    aisle + trolley; shuttle → channels + carts + lift; mezzanine → dashed
    platform + posts + stairs; dock-in/out → door notch + in/out arrow;
    staging → dashed holding area; conveyor → belt rollers + direction;
    push/pull/pack stations → workbench + flow arrow / parcel; block-stack →
    stacked-square pattern; RGV → twin rails + cart; AGV → guide path + robot.
  - **Isometric forms** (`draw3D`): open, **see-through rack frames** (uprights
    + beam levels, not a solid block); a **tall crane tower** for AS/RS; a
    **raised deck on legs** for the mezzanine; a **low belt bed** with rollers
    for the conveyor; **bench furniture** for the stations; small **floor
    vehicles** for RGV/AGV; a **door opening in a low wall** for docks;
    **stacked unit cubes** for block-stack; a **low outlined pad** for staging.
    The 3D forms reuse the **same per-type height** (`domain.heightM` via
    `iso.elementHeight`) the IFC export and the iso projection already agree on.
- Both renderers are wired through `WT.shapes` **fallback-safe**: the top-down
  loop (`app.js`) and the iso scene (`iso.js`) fall back to the previous rect /
  extruded-box draw if a type has no custom shape or the module is absent, so
  nothing breaks. The heatmap, aisle-violation, chain-arrow, compliance,
  reserved-zone, flow-MU and order-pool overlays, selection highlight, labels
  and hit-testing are **unchanged**.
- A **level-of-detail** path keeps large layouts smooth and legible: when a
  footprint is small on screen the glyph simplifies to the already-tinted
  footprint plus a tiny centred icon; at high zoom the full glyph is crisp.
  The module is **pure and deterministic** (a canvas `ctx` + plain geometry/
  colour in, drawing out — no app state, no per-call input mutation), theme-
  aware (light + dark) and **offline** (no external assets).
- These are **illustrative, recognizable schematic** glyphs and forms with
  heights taken from the domain model's **assumed** `heightM` — **not** CAD,
  **not** BIM, **not** a survey and **not** measured geometry. The real
  BIM/geometry path remains the separate **IFC export** (`ifc.js`). No real
  brands, logos or trademarked shapes.

### Engineering
- 27 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_shapes.js`, 13 checks). Because the pixels of a pure-draw feature
  can't be verified headlessly, the harness runs a **mock-context smoke test**
  that draws **every** object type in **both 2D and 3D**, in **light + dark**,
  at **small + large** scale (exercising the LOD path), asserting **no
  non-finite coordinate** and **no throw**; it also asserts `has()` is true for
  every domain type (2D **and** 3D defined — no type left a plain rect), the
  registry covers **exactly** the domain types (no orphans), the 3D forms use
  the domain `heightM` (a taller element rises on screen), neither draw mutates
  its inputs, unknown types are safe, and the honesty labels are present. All
  26 pre-existing harnesses still pass unchanged. Service-worker cache bumped
  to `wt-v33` (precaching `shapes.js`).

## [1.3.0] — 2026-08-03

### Added
- **Live order pool.** The demand side of the plant is now **visible and
  live**. A new bounded order-pool model (`orderpool.js` → `WT.orderpool`)
  mirrors the classic Siemens Plant Simulation spine — *generateOrders →
  DT_tempOrders (SizeOrderPool) → M_selectOrders → consumed*: orders are
  **generated over time** into a **bounded backlog** (a `SizeOrderPool`-style
  cap), **selected/released** into the picking flow at the line rate, and
  marked **completed** as the flow ships them. It is driven from the **same
  `requestAnimationFrame` loop** that steps `WT.flowsim` (no competing loop),
  so the pool's **selected** aligns with handling units entering picking and
  its **completed** with units shipped; the pool's selection/completion rates
  are taken from the flow's realized spawn/retire deltas each frame, and its
  arrival (order-generation) rate is a synthetic demand set a little above the
  modelled pick capacity so a live backlog is visible. When the flow isn't
  playing the pool **holds its last state**.
- A compact **"Order pool"** readout in the Live material flow card shows the
  **backlog + fill bar**, **generated / selected / completed** counts (and
  **dropped** when the cap overflows), live **in / out rates** (orders/hr),
  **in-flight** count, a backlog **sparkline**, and an honest **starving**
  (empty pool while the picker wants work) / **saturating** (backlog at the
  cap, overflowing) flag.
- The model is **pure and deterministic** (seeded mulberry32; no `Date`, no
  `Math.random`) and **count-conserving at every step**: `generated == inPool
  + inFlightSelected + completed + dropped`. Overflow at the cap is counted as
  **dropped** (backpressure) and pool **starvation** is flagged — both
  reported, never hidden. Order generation **reuses the SKU-velocity-weighted
  generator from `wmsdata`** when present (a Zipf/Pareto heuristic, not
  measured demand) and falls back to a simple seeded generator when it is not.
- A transparent **bounded-queue heuristic** — selection tied to the documented
  `wms.js`/`flowsim.js` throughput model — **not** a real discrete-event /
  queueing engine, **not measured**, not a certification. **SYNTHETIC** unless
  you import your own data.

### Engineering
- 26 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_orderpool.js`, 22 checks: determinism, count conservation, the cap +
  honest overflow, backlog grow/drain, the starving/saturating flags, the
  selection-rate tie to WT.wms/WT.flowsim, the wmsdata velocity-weighting +
  fallback, and the honesty labels). Service-worker cache bumped to `wt-v32`
  (precaching `orderpool.js`).

## [1.2.0] — 2026-08-03

### Added
- **Scenario A/B compare.** A new **"Scenario A/B compare"** panel lets you pick
  **two whole set-ups** — the current layout, a built-in example, or one of your
  saved scenarios — and see their key metrics **side-by-side with deltas** in a
  modal, so you can answer *"which layout / strategy is better?"*. Each side's
  numbers are **derived from the same consolidated WMS Report the app shows**
  (`WT.report.build`), which is itself cross-consistent with the WMS, storage,
  automation and compliance modules — so the two sides **can never drift** from
  the app. The table diffs layout capacity/floor-use, WMS operations KPIs
  (throughput, order cycle time, dock-to-stock, picking), storage
  occupancy/placement/A-class pick travel, automation throughput and compliance
  pass/warn/fail, with each delta given as an **absolute and % change (B-vs-A)**.
  A plain-language *"what changed"* summary calls out which side has higher
  throughput, lower pick travel and better compliance. **"Better/worse" colouring
  is shown only where the direction is unambiguous** (lower pick travel = better);
  capacity, utilisation and automation are left **neutral** with an honest
  *"higher isn't always better"* note (more automation ≠ automatically better).
  Comparing runs on the picked snapshots and **never disturbs your current
  floor**. Sources resolve through the **same builders the app uses**
  (`currentLayout` / `WT.examples.build` / `WT.scenarios.load`). The pure,
  deterministic engine lives in `compare.js` (`WT.compare`), covered by the new
  `verify_compare.js` harness (16 checks). This is broader than, and separate
  from, the existing strategy-only *Compare A/B* predictor. **SYNTHETIC** unless
  you imported your own data — a transparent heuristic informed by ISO/DIN/EN/VDI,
  **not a certification, not measured**.

### Engineering
- 25 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_compare.js` added). Service-worker cache bumped to `wt-v31`
  (precaching `compare.js`).

## [1.1.0] — 2026-08-03

### Added
- **Save / load named scenarios.** A compact **"My scenarios"** control (near
  the Layout Save/Export buttons) lets you save the plants **you** build under a
  **name**, then reload, rename or delete them, and **export/import** a JSON
  backup bundle to move them between devices. Saving captures the same
  `serialize()` layout + configuration used by JSON export and share links (and,
  when a real-data bundle is loaded, your imported SKU/order data rides along);
  loading applies it through the **same `deserialize()` loader as JSON import**.
  These are your **own saved work**, stored **only on this device** (browser
  `localStorage`) — nothing is uploaded — and are kept distinct from the
  read-only synthetic example scenarios. Saving under an existing name updates
  that scenario in place. The pure, storage-guarded store lives in
  `scenarios.js` (`WT.scenarios`) with deterministic, sorted-key serialization
  (a bundle round-trips exactly), covered by the new `verify_scenarios.js`
  harness.

### Engineering
- 24 headless verification harnesses via `node test/run-all.mjs` (the new
  `verify_scenarios.js` added). Service-worker cache bumped to `wt-v30`
  (precaching `scenarios.js`).

## [1.0.0] — 2026-08-03

First consolidated product release. WarehouseTwin is an offline, browser-based
warehouse / WMS digital twin and plant-flow simulator: draw or generate a
warehouse layout, simulate the material flow and the standard warehouse
operation, read live KPIs, check the layout against public design guidance, and
roll every layer up into one report — all fully offline, with no account and no
server.

### Design & generate
- Interactive HTML5-canvas floor plan: racks, block-stack, docks, staging,
  conveyor and push/pull stations on a 1 m grid, with overlap blocking and a
  DIN 15185-informed minimum working-aisle rule.
- AI Environment Generator: a deterministic rule/heuristic engine plus offline
  plain-language command parsing (no cloud, no trained model).
- 22 synthetic industry example scenarios, one-click loadable.
- Zoom / pan / Fit and a resizable warehouse floor (up to 120 × 80 m).
- Presentation-only 2.5D isometric view.

### Simulate & KPIs
- Seeded, deterministic slotting + pick-travel simulation (Random / ABC 80/20)
  with throughput, pick travel, storage fill and positions KPIs; a pick-travel
  heatmap overlay and a session-only run-history table.
- WMS Operations: the 7-stage receiving→shipping workflow with per-stage
  throughput and a plain-language bottleneck, grounded in the ISO 22400 KPI
  discipline.
- Live material-flow animation with station FIFO servers, conveyor-following
  routing and emergent queue congestion (a teaching animation, not a DES engine).
- Live KPI cockpit: throughput-over-time, seven-stage load-vs-capacity bars and
  in-flight-vs-shipped, with honest 0-based, colourblind-safe dataviz.
- Rule-based advisor, golden-zone layout optimizer (preview before apply) and an
  A/B configuration comparator.

### Data & storage
- SKU master + order pool data layer (seeded synthetic or import your own CSV).
- CSV import for your own article/order data, parsed in-browser with row-numbered
  validation; data stays on the device.
- Floor-plan image underlay with two-point scale calibration.
- Storage & inventory: physical locations from the racking, ABC/velocity slotting
  into the golden zone, occupancy with honest overflow, and a retrieval location
  the flow animation uses.

### Standards, compliance & automation
- Compliance Check (DIN 15185 / ASR A1.8 / ASR A2.3) — a deterministic
  pass/warn/fail design aid with measured + informed-by values and
  click-to-highlight; explicitly not a certification.
- Editable, versioned standards knowledge base (ISO/DIN/EN/VDI/ASR) that every
  engine reads from, with add/reset and JSON import/export.
- Automation systems modeling (AS/RS, shuttle, RGV, AGV, conveyor) as explicit
  per-system throughput contributors with editable VDI-informed cycle times.

### Outputs & demo
- Consolidated WMS Report (print / JSON / CSV) that aggregates every layer and
  pulls each number from its owning module so it cannot drift from the app.
- Dependency-free scoped IFC4 (STEP) BIM export.
- Save / load / export-import JSON, and a share link that carries the whole
  layout in its `#layout=…` URL fragment (nothing uploaded).
- One-click guided demo that sequences the existing features end-to-end, plus an
  honest About panel.
- LSP Planner companion app (network-level planning game) under `lsp/`.

### Added in this release
- **Collapsible side-panel cards.** Each side-panel card header is now a toggle
  (click, or Enter/Space when focused) that folds the card body away; the
  collapsed set persists in `localStorage` (guarded — a safe no-op when storage
  is unavailable). Cards ship **expanded**, so first load is unchanged. The
  collapse-state helper lives in `cards.js` (`WT.cards`) and is covered by the
  new `verify_ui.js` harness.
- **Product-level README** rewritten into one coherent document (what it is,
  grouped feature overview, run-it-locally, honesty & standards, verification).
- **This CHANGELOG.**

### Engineering
- 23 headless verification harnesses via `node test/run-all.mjs`; deterministic,
  ASCII-only, with an offline guard asserting the app references no external
  assets. Service-worker cache bumped to `wt-v29`.
