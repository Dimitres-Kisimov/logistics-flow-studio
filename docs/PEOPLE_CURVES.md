# Learning and fatigue, declared (v3.66)

*Written 2026-09-24 for v3.66. Gap 11 of the [digital-twin deep dive](DIGITAL_TWIN_DEEP_DIVE.md): the workers in this app walk and pose, but they do not learn, tire or err. v3.54 added error. This page is the other two - and the line that keeps them lawful.*

## Why a bench that never learns and never tires is wrong

Every station in this simulation is a server with a fixed rate. Grosse, Glock, Jaber and Neumann (IJPR 53(3) 2015) reviewed the order-picking planning literature and found that almost none of it represents the person doing the work; their 2017 content analysis found learning and fatigue documented in the literature and absent from the models. A model whose benches never change predicts the throughput of a plant with no people in it - reliably, and wrongly, in both directions at once.

## The two curves

Both multiply the **service time** of a step, and the simulation scales the station's service *rate* by the reciprocal.

| Curve | Formula | Default | Source |
|---|---|---|---|
| **Learning** | the n-th unit through a station costs `n^log2(rate)` of the first, floored | rate 0.95, floor 0.70 | Wright (1936) in Crawford's unit-time form; rates of 0.80-0.95 are commonly quoted for repetitive manual work - a teaching value |
| **Fatigue** | `1 + maxUplift x min(1, minutesSinceBreak / toPeakMinutes)` | uplift 0.15, peak at 240 min, a break every 120 min lasting 15 | Work-study rest allowances (ILO, *Introduction to Work Study*) shape the magnitude; Grosse et al. name fatigue as omitted - a teaching value in that spirit |

At a rate of 0.9 the second unit takes 0.9 of the first, the fourth 0.81, the eighth 0.729: each doubling of a station's cumulative units multiplies the unit time by the rate. Under the default break rhythm the fatigue uplift never passes 1.075, because the clock resets every two hours before it reaches its four-hour peak.

Both are **off by default**. Without the what-if a run is byte-identical to every run before this release - the hand floor still records fixture A's own id.

## The line that keeps it lawful

- The curves belong to a **process step and a shift**. The learning count is the **station's** units in this run; the fatigue clock is the **minutes since the last break**. Neither is a person's.
- Nothing here reads the app's illustrative staffing figures, and nothing may be keyed to a worker: BetrVG § 87(1)6 makes a technical device that is merely *capable* of monitoring performance co-determinable, and GDPR Art. 88 governs employment data. A per-person learning curve would be exactly such a device. This one cannot become one, because the count lives on the station.
- The knowledge base's own category says the same, and `verify_people.js` asserts the module references no roster and has no clock of its own.

## What it is not

- **The learning count resets with every run.** A bench's crew does not start from zero every morning. This shows what a learning curve *does to a day*; it is not a workforce model.
- **Breaks are assumed staggered.** A break resets the fatigue clock; it does not stop the bench. A plant that halts a line for a break is not this model.
- No turnover, no skill mix, no warm-up, no night-shift effect, no second-order interaction with the error what-if.
- The factor is evaluated once a tick on the station's next unit, not re-evaluated inside a tick.

## What it does to a day

On the hand floor at seed 31 over 1200 ticks:

| Curves | Units shipped |
|---|---|
| none | 56 |
| learning only (rate 0.9) | 61 |
| fatigue only (uplift 0.15) | 55 |
| both (the defaults) | 58 |

A bench that learns ships more, a bench that tires ships fewer, and the two together land between them. Those are this model's numbers on this floor, not a plant's.

## Reproduce

```sh
node verify_people.js
```
