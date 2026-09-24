# The performance-shaping levers (v3.67)

*Written 2026-09-24 for v3.67. v3.54 gave the error what-if three levers and the [digital-twin deep dive](DIGITAL_TWIN_DEEP_DIVE.md) recorded the other five of SPAR-H's eight as documented only. This page is what became of those five: four more levers, one refusal, and the method's own arithmetic for a context that is going badly in several ways at once.*

## The eight factors, and what this app does with each

SPAR-H (NUREG/CR-6883, Idaho National Laboratory for the U.S. NRC, 2005) modifies its nominal human error probabilities by eight performance-shaping factors. The multipliers below are the ones on its **action** worksheet, which is the right column for a warehouse: a picker acts, a picker does not diagnose a reactor.

| SPAR-H factor | Published action levels | In this app | Lever |
|---|---|---|---|
| Available time | inadequate → P(failure) 1.0; ≈ required ×10; nominal ×1; ≥ 5× required ×0.1; ≥ 50× ×0.01 | **Time pressure**, ×1 … ×11 on HEART's maximum | `hf.psf.timePressure` |
| Stress / stressors | extreme ×5; high ×2; nominal ×1 | **Workplace stressors**, the environmental reading only | `hf.psf.stressors` |
| Complexity | highly complex ×5; moderately ×2; nominal ×1 | **Task complexity** | `hf.psf.complexity` |
| Experience / training | low ×3; nominal ×1; high ×0.5 | **Unfamiliarity**, ×0.5 … ×17 on HEART's maximum | `hf.psf.familiarity` |
| Procedures | not available ×50; incomplete ×20; available but poor ×5; nominal ×1 | **Procedures** | `hf.psf.procedures` |
| Ergonomics / HMI | missing or misleading ×50; poor ×10; nominal ×1; good ×0.5 | **Low signal-to-noise**, ×0.5 … ×10 on HEART's maximum | `hf.psf.signalToNoise` |
| Fitness for duty | unfit → P(failure) 1.0; degraded ×5; nominal ×1 | **Refused.** See below. | — |
| Work processes | poor ×5; nominal ×1; good ×0.5 | **Work processes** | `hf.psf.workProcesses` |

Every lever is at nominal by default, and a run with every lever at nominal is byte-identical to a run that names none.

## Why seven and not eight

Seven of the eight can be declared about a **step**, a **workplace** or a **shift**. The eighth cannot.

> "Fitness for duty refers to whether or not **the individual** performing the task is physically and mentally fit to perform the task at the time. Things that may affect fitness include fatigue, sickness, drug use (legal or illegal), overconfidence, personal problems, and distractions. Fitness for duty includes **factors associated with individuals**." — NUREG/CR-6883 § 2.4.4.7

A lever for it would be an assertion about a named worker's health. A tool that held one, or let one be inferred, would be a technical device capable of monitoring performance (BetrVG § 87(1)6) processing health data (GDPR Art. 9 and Art. 88). It is refused in `routing.js` itself, as `PSF_NOT_MODELLED`, so the refusal and its reason travel with every export rather than living in a document nobody reads.

The only part of that factor the app models is the part that belongs to a shift rather than a person: the **fatigue curve of v3.66** ([PEOPLE_CURVES.md](PEOPLE_CURVES.md)), which reads the minutes since a break assumed staggered and knows nothing about who is standing at the bench.

**Stressors is the factor that had to be read carefully, not refused.** An earlier draft of the deep dive lumped it in with fitness for duty as unrepresentable. That was wrong, and SPAR-H itself says why: "Environmental factors often referred to as stressors, such as excessive heat, noise, poor ventilation, or radiation, can induce stress in a person" (§ 2.4.4.2). The method's peer reviewers asked for the factor to be renamed from *Stress* to *Stressors* precisely so that it would stop claiming knowledge of what a particular individual feels, and the authors agreed. This app declares the **workplace** — a cold store at −22 °C, a depalletiser's noise, a cramped aisle, glare on a label — and never a state of mind.

## A design can now be declared good, not only bad

Until v3.67 every lever could only make a floor worse. Three of them now carry the credit their method publishes: ergonomics and the human-machine interface *good* (×0.5), experience and training *high* (×0.5), work processes *good* (×0.5). A scan verification, a trained crew and a clean shift handover are a **poka-yoke** the model can finally describe. On the hand floor the three credits together take a declared mis-pick share of 0.02 to 0.0025, and over 600 ticks no pick errs.

The other four offer no credit, because their method publishes none for an action task: complexity's ×0.1 and procedures' ×0.5 belong to the diagnosis column, and SPAR-H's positive levels for available time are defined as multiples of the time a task *requires*, which this app does not declare.

## The adjustment factor

Multiplying seven levers into a share produces nonsense quickly: a nominal 0.01 with a composite of 400 gives 4, which is not a probability. SPAR-H has its own answer, and v3.67 uses it.

> "When 3 or more negative PSF influences are present, in lieu of the equation above, you must compute a composite PSF score used in conjunction with the adjustment factor. Negative PSFs are present anytime a multiplier greater than 1 is selected." — NUREG/CR-6883, action worksheet, part C

```
                 share × composite
effective = ───────────────────────────────
             share × (composite − 1) + 1
```

The composite is the product of **all** the levers, the ones below nominal included; the method's nominal HEP is this app's declared share for the step. The trigger is a **count**, not a size: below three levers above nominal the plain product applies. The formula cannot reach 1, which is why the method has it.

**The standard's own worked example**, reproduced in `verify_psf.js`: a nominal 0.01 with procedures ×20, ergonomics ×10 and complexity ×2 gives a composite of 400, and `4 / 4.99 = 0.801603`. The published example prints `0.81`; that is a rounding in the document, and the formula as published is what is implemented.

**Where the standard is inconsistent, the app follows the worksheet.** The worksheet rule is three or more *negative* factors. The body text of § 2.5.1 applies the same formula to a second example whose factors are all positive ("The adjustment factor is also applicable in situations determined where the positive influence of PSFs is present"). This app takes the worksheet rule: a context made *better* in three ways is not the failure mode the adjustment exists to bound.

The app's cap (`hf.error.cap`, 0.5 by default) is a separate and cruder limit of its own and still binds afterwards.

## What it does, on the hand floor

Seed 31, 600 ticks, a declared mis-pick share of 0.02 in a context that is going badly in three ways — a cold store (stressors ×2), mixed-SKU pallets (complexity ×2) and a procedure that exists but is poor (×5):

| | Declared share at the pick |
|---|---|
| the plain product (composite 20) | 0.4 |
| SPAR-H's adjustment factor | **0.289855** |

Two picks of seven err, one case-pick of three, one pallet-pick of two, and four verification steps appear in the event log.

## The honest limits

- **Two methods are multiplied in one product, and that is this app's choice, not either method's.** The three levers of v3.54 carry HEART's maxima (×11, ×10, ×17); the four of v3.67 carry SPAR-H's. The two disagree about the same construct — SPAR-H's ergonomics factor reaches ×50 where HEART's signal-to-noise reaches ×10. Neither method provides for mixing them.
- **Nuclear values on a warehouse floor.** SPAR-H was built for control rooms. Its multipliers are the only public, documented, generic set that exists; they are used here as *teaching values* and are labelled as such in the code, the knowledge base and every export. A site replaces them with its own judgement of its own steps.
- **A lever is a declaration, not a measurement.** Nothing in the app observes complexity or a handover. Somebody types a number and says why.
- **The levers apply to a share, not to a person, and the model has no person.** Errors are dispatched by quota over a step's units.
- **Still at most one error per unit**, and a rework is still one detection and one redo. Those limits are v3.54's and unchanged.

## Reproduce

```sh
node verify_psf.js
node verify_errors.js
```
