# Run report: RUN-hand-built-s31-hc28a7688

Scenario `hand-built` · seed 31 · profile ecommerce · order mix: full-pallet-out 18% · case-pick 22% · piece-pick 30% · cross-dock 12% · returns 10% · vas 5% · export-fragile 3% · 300 ticks (300.0 min, 1.0 min per tick)

## At a glance

| units | events | delivered | delivered_eaches | pallets | parcels | trailers | received_eaches | in_flight | total_eur | eur_per_unit | eur_per_received_each | eur_per_delivered_each |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | 157 | 8 | 2461 | 6 | 3 | 1 | 18567 | 28 | 349.7417 | 8.9677 | 0.0188 | 0.1421 |

Data-quality flags: no holding cost is set (0 per unit-hour): waiting stock costs nothing; every station (3) serves at the simulator's floor rate of 50 ticks per unit (the floor declares no capacities); 28 of 39 units were still in flight at tick 300: their cycle time and cost are open

## Planner views

### v_run_summary

| scenario | seed | profile | ticks | dataset_source | dataset_orders | dataset_lines | policy | units | events | delivered | delivered_eaches | delivered_pallets | delivered_parcels |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hand-built | 31 | ecommerce | 300 | — | — | — | — | 39 | 157 | 8 | 2461 | 6 | 3 |

### v_cycle_time_by_type

| archetype | units | retired | avg_cycle_ticks | avg_cycle_minutes | min_cycle_ticks | max_cycle_ticks |
|---|---|---|---|---|---|---|
| case-pick | 8 | 1 | 259.0 | 259.0 | 259 | 259 |
| cross-dock | 5 | 3 | 107.0 | 107.0 | 107 | 107 |
| export-fragile | 1 | 1 | 112.0 | 112.0 | 112 | 112 |
| full-pallet-out | 7 | 1 | 268.0 | 268.0 | 268 | 268 |
| piece-pick | 12 | 1 | 224.0 | 224.0 | 224 | 224 |
| returns | 4 | 3 | 116.0 | 116.0 | 80 | 134 |
| vas | 2 | 1 | 107.0 | 107.0 | 107 | 107 |

### v_touches_by_type

| archetype | units | events | touches | served_per_unit |
|---|---|---|---|---|
| case-pick | 8 | 40 | 5.0 | 0.38 |
| cross-dock | 5 | 20 | 4.0 | 0.0 |
| export-fragile | 1 | 6 | 6.0 | 0.0 |
| full-pallet-out | 7 | 26 | 3.71 | 0.29 |
| piece-pick | 12 | 45 | 3.75 | 0.42 |
| returns | 4 | 13 | 3.25 | 0.0 |
| vas | 2 | 7 | 3.5 | 0.5 |

### v_station_wait

| location | op | waits | avg_wait_ticks | max_wait_ticks | still_waiting |
|---|---|---|---|---|---|
| face | case-pick | 1 | 1.0 | 1 | 0 |
| face | pallet-pick | 1 | 1.0 | 1 | 0 |
| face | piece-pick | 1 | 1.0 | 1 | 0 |
| pack | pack | 2 | 2.5 | 4 | 0 |
| stg | putaway | 23 | 122.4 | 206 | 18 |
| stg | replen | 2 | 50.0 | 50 | 1 |

### v_quantities_by_op

| op | kind | events | pallets | cases | eaches | parcels | retained | scrapped |
|---|---|---|---|---|---|---|---|---|
| case-pick | queued | 1 | 0 | 48 | 576 | 0 | 0 | 0 |
| case-pick | served | 1 | 0 | 5 | 60 | 0 | 516 | 0 |
| consolidate | passed | 2 | 0 | 6 | 64 | 0 | 1088 | 0 |
| depalletise | passed | 19 | 0 | 912 | 10944 | 0 | 0 | 0 |
| inspect | passed | 3 | 0 | 0 | 22 | 3 | 0 | 0 |
| load | delivered | 8 | 6 | 206 | 2461 | 3 | 1088 | 0 |
| load | passed | 8 | 6 | 206 | 2461 | 3 | 1088 | 0 |
| pack | queued | 2 | 0 | 2 | 13 | 0 | 572 | 0 |
| pack | served | 2 | 0 | 2 | 13 | 3 | 572 | 0 |
| pallet-pick | queued | 1 | 1 | 48 | 576 | 0 | 0 | 0 |
| pallet-pick | served | 1 | 1 | 48 | 576 | 0 | 0 | 0 |
| palletise | passed | 2 | 2 | 12 | 144 | 0 | 516 | 0 |
| pick | created | 3 | 0 | 9 | 102 | 0 | 0 | 0 |
| piece-pick | queued | 1 | 0 | 48 | 576 | 0 | 0 | 0 |
| piece-pick | served | 1 | 0 | 1 | 4 | 0 | 572 | 0 |
| putaway | queued | 23 | 6 | 1104 | 13248 | 0 | 0 | 0 |
| putaway | served | 5 | 1 | 240 | 2880 | 0 | 0 | 0 |
| qc-final | passed | 1 | 0 | 7 | 84 | 0 | 0 | 0 |
| qc-sample | passed | 20 | 20 | 960 | 11520 | 0 | 0 | 0 |
| receive | created | 36 | 32 | 1536 | 18465 | 4 | 0 | 0 |
| replen | queued | 2 | 0 | 96 | 1152 | 0 | 0 | 0 |
| replen | served | 1 | 0 | 48 | 576 | 0 | 0 | 0 |
| restock | passed | 2 | 0 | 2 | 0 | 0 | 17 | 0 |
| restock | restocked | 2 | 0 | 2 | 0 | 0 | 17 | 0 |
| scrap | passed | 1 | 0 | 0 | 0 | 0 | 0 | 5 |
| scrap | scrapped | 1 | 0 | 0 | 0 | 0 | 0 | 5 |
| stage-out | passed | 4 | 4 | 192 | 2304 | 0 | 0 | 0 |
| vas | passed | 1 | 0 | 1 | 9 | 0 | 0 | 0 |
| wrap | passed | 3 | 3 | 60 | 720 | 0 | 516 | 0 |

### v_dispatch

| delivered_units | pallets | cases | eaches | parcels | trailer_slots | trailers |
|---|---|---|---|---|---|---|
| 8 | 6 | 206 | 2461 | 3 | 33 | 1 |

### v_cost_by_type

| archetype | units | retired | eaches_in | eaches_out | hours | labour_eur | equipment_eur | energy_eur | holding_eur | total_eur | eur_per_unit | eur_per_received_each | eur_per_each |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| case-pick | 8 | 1 | 4608 | 60 | 9.75 | 87.5 | 2.2861 | 3.3 | 0.0 | 93.0861 | 11.6358 | 0.0202 | 1.5514 |
| cross-dock | 5 | 3 | 2880 | 1728 | 6.1333 | 0.0 | 1.84 | 2.76 | 0.0 | 4.6 | 0.92 | 0.0016 | 0.0027 |
| export-fragile | 1 | 1 | 84 | 84 | 1.8667 | 0.0 | 0.56 | 0.84 | 0.0 | 1.4 | 1.4 | 0.0167 | 0.0167 |
| full-pallet-out | 7 | 1 | 4032 | 576 | 6.9 | 58.3333 | 1.6811 | 2.3925 | 0.0 | 62.4069 | 8.9153 | 0.0155 | 0.1083 |
| piece-pick | 12 | 1 | 6912 | 4 | 13.3333 | 145.8333 | 2.9861 | 4.3125 | 0.0 | 153.1319 | 12.761 | 0.0222 | 38.283 |
| returns | 4 | 3 | 33 | 0 | 5.8 | 0.0 | 1.74 | 2.61 | 0.0 | 4.35 | 1.0875 | 0.1318 | — |
| vas | 2 | 1 | 18 | 9 | 2.6 | 29.1667 | 0.655 | 0.945 | 0.0 | 30.7667 | 15.3833 | 1.7093 | 3.4185 |

### v_cost_by_location

| location | class | spans | ticks | charged_ticks | hours | labour_eur | equipment_eur | energy_eur | holding_eur | total_eur |
|---|---|---|---|---|---|---|---|---|---|---|
| face | racking | 3 | 3 | 150.0 | 2.5 | 87.5 | 0.3333 | 0.1125 | 0.0 | 87.9458 |
| pack | workstation | 2 | 5 | 100.0 | 1.6667 | 58.3333 | 0.25 | 0.3 | 0.0 | 58.8833 |
| stg | — | 6 | 662 | 300.0 | 5.0 | 175.0 | 0.0 | 0.0 | 0.0 | 175.0 |
| transport | conveyor | 107 | 2233 | 2233 | 37.2167 | 0.0 | 11.165 | 16.7475 | 0.0 | 27.9125 |

### v_flow_links

| from_op | to_op | units | retired_units | eaches |
|---|---|---|---|---|
| case-pick | consolidate | 1 | 1 | 60 |
| consolidate | pack | 1 | 1 | 4 |
| consolidate | palletise | 1 | 1 | 60 |
| depalletise | putaway | 4 | 2 | 2304 |
| inspect | restock | 2 | 2 | 17 |
| inspect | scrap | 1 | 1 | 5 |
| pack | load | 2 | 2 | 13 |
| pallet-pick | wrap | 1 | 1 | 576 |
| palletise | wrap | 2 | 2 | 144 |
| pick | qc-final | 1 | 1 | 84 |
| pick | vas | 1 | 1 | 9 |
| piece-pick | consolidate | 1 | 1 | 4 |
| putaway | case-pick | 1 | 1 | 576 |
| putaway | pallet-pick | 1 | 1 | 576 |
| putaway | replen | 1 | 1 | 576 |
| qc-final | palletise | 1 | 1 | 84 |
| qc-sample | depalletise | 8 | 1 | 4608 |
| qc-sample | putaway | 1 | 1 | 576 |
| qc-sample | stage-out | 4 | 3 | 2304 |
| receive | depalletise | 11 | 1 | 6336 |
| receive | inspect | 3 | 3 | 22 |
| receive | qc-sample | 20 | 5 | 11520 |
| replen | piece-pick | 1 | 1 | 576 |
| stage-out | load | 3 | 3 | 1728 |
| vas | pack | 1 | 1 | 9 |
| wrap | load | 3 | 3 | 720 |

### v_staffing

(no rows)

### v_bizstep_dwell

| biz_step | events | units | spans | avg_ticks_to_next | max_ticks_to_next | waiting_ticks | total_ticks | waiting_share |
|---|---|---|---|---|---|---|---|---|
| destroying | 1 | 1 | 0 | — | — | 0 | 0 | — |
| holding | 1 | 1 | 1 | 8.0 | 8 | 0 | 8 | 0.0 |
| inspecting | 24 | 24 | 22 | 21.09 | 60 | 0 | 464 | 0.0 |
| loading | 8 | 8 | 8 | 8.0 | 8 | 0 | 64 | 0.0 |
| packing | 9 | 5 | 9 | 12.67 | 26 | 5 | 114 | 0.0439 |
| picking | 9 | 6 | 8 | 22.13 | 52 | 3 | 177 | 0.0169 |
| receiving | 36 | 36 | 34 | 21.12 | 72 | 0 | 718 | 0.0 |
| repackaging | 1 | 1 | 1 | 20.0 | 20 | 0 | 20 | 0.0 |
| shipping | 8 | 8 | 0 | — | — | 0 | 0 | — |
| staging_outbound | 6 | 6 | 5 | 57.0 | 65 | 0 | 285 | 0.0 |
| stocking | 7 | 4 | 4 | 22.25 | 50 | 50 | 89 | 0.5618 |
| storing | 28 | 23 | 9 | 73.11 | 206 | 612 | 658 | 0.9301 |
| unpacking | 19 | 19 | 17 | 18.0 | 18 | 0 | 306 | 0.0 |

### v_quality_by_step

| op | units_through | errors | reworked | scrapped_for_damage | first_pass_yield | rework_ratio | scrap_ratio |
|---|---|---|---|---|---|---|---|
| case-pick | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| consolidate | 2 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| depalletise | 19 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| inspect | 3 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| load | 8 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| pack | 2 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| pallet-pick | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| palletise | 2 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| pick | 3 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| piece-pick | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| putaway | 5 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| qc-final | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| qc-sample | 20 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| receive | 36 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| replen | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| restock | 2 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| scrap | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| stage-out | 4 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| vas | 1 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |
| wrap | 3 | 0 | 0 | 0 | 1.0 | 0.0 | 0.0 |

### v_otif

(no rows)

### v_inbound

(no rows)

### v_control

(no rows)

## Cost detail

| hours | labour_eur | equipment_eur | energy_eur | holding_eur | total_eur |
|---|---|---|---|---|---|
| 46.3833 | 320.8333 | 11.7483 | 17.16 | 0.0 | 349.7417 |

Rates: labour 35.0 per hour · energy 0.3 per kWh · 4000.0 operating hours per year · holding 0.0 per unit-hour waiting · transport conveyor

## Invariants

| view | rows |
|---|---|
| v_conservation_violations | 0 |
| v_cross_dock_violations | 0 |
| v_version_gaps | 0 |
| v_terminal_violations | 0 |
| v_tracking_gaps | 0 |

Invariant violations: 0

## Compare RUN-hand-built-s31-hc28a7688 → RUN-hand-built-s31-hd35e45d4 (deltas B − A)

### v_compare_summary

| units_a | units_b | delta_units | events_a | events_b | delta_events | delivered_a | delivered_b | delta_delivered | delivered_eaches_a | delivered_eaches_b | delta_delivered_eaches |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | 39 | 0 | 157 | 167 | 10 | 8 | 16 | 8 | 2461 | 8676 | 6215 |

### v_compare_cycle

| archetype | units_a | units_b | delta_units | retired_a | retired_b | delta_retired | avg_cycle_ticks_a | avg_cycle_ticks_b | delta_avg_cycle_ticks |
|---|---|---|---|---|---|---|---|---|---|
| case-pick | 8 | 6 | -2 | 1 | 1 | 0 | 259.0 | 197.0 | -62.0 |
| cross-dock | 5 | 19 | 14 | 3 | 13 | 10 | 107.0 | 107.0 | 0.0 |
| export-fragile | 1 | — | — | 1 | — | — | 112.0 | — | — |
| full-pallet-out | 7 | 8 | 1 | 1 | 2 | 1 | 268.0 | 180.0 | -88.0 |
| piece-pick | 12 | 4 | -8 | 1 | 0 | -1 | 224.0 | — | — |
| returns | 4 | 2 | -2 | 3 | 1 | -2 | 116.0 | 134.0 | 18.0 |
| vas | 2 | — | — | 1 | — | — | 107.0 | — | — |

### v_compare_touches

| archetype | touches_a | touches_b | delta_touches | served_per_unit_a | served_per_unit_b | delta_served_per_unit |
|---|---|---|---|---|---|---|
| case-pick | 5.0 | 5.5 | 0.5 | 0.38 | 0.67 | 0.29 |
| cross-dock | 4.0 | 4.32 | 0.32 | 0.0 | 0.0 | 0.0 |
| export-fragile | 6.0 | — | — | 0.0 | — | — |
| full-pallet-out | 3.71 | 4.25 | 0.54 | 0.29 | 0.5 | 0.21 |
| piece-pick | 3.75 | 3.25 | -0.5 | 0.42 | 0.25 | -0.17 |
| returns | 3.25 | 2.5 | -0.75 | 0.0 | 0.0 | 0.0 |
| vas | 3.5 | — | — | 0.5 | — | — |

### v_compare_wait

| location | op | waits_a | waits_b | delta_waits | avg_wait_ticks_a | avg_wait_ticks_b | delta_avg_wait_ticks | still_waiting_a | still_waiting_b | delta_still_waiting |
|---|---|---|---|---|---|---|---|---|---|---|
| face | case-pick | 1 | 2 | 1 | 1.0 | 1.0 | 0.0 | 0 | 0 | 0 |
| face | pallet-pick | 1 | 2 | 1 | 1.0 | 1.0 | 0.0 | 0 | 0 | 0 |
| face | piece-pick | 1 | — | — | 1.0 | — | — | 0 | — | — |
| pack | pack | 2 | — | — | 2.5 | — | — | 0 | — | — |
| stg | putaway | 23 | 15 | -8 | 122.4 | 67.2 | -55.2 | 18 | 10 | -8 |
| stg | replen | 2 | 1 | -1 | 50.0 | — | — | 1 | 1 | 0 |

### v_compare_dispatch

| delivered_units_a | delivered_units_b | delta_delivered_units | pallets_a | pallets_b | delta_pallets | parcels_a | parcels_b | delta_parcels | trailers_a | trailers_b | delta_trailers |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 16 | 8 | 6 | 16 | 10 | 3 | 0 | -3 | 1 | 1 | 0 |

### v_compare_cost

| archetype | total_eur_a | total_eur_b | delta_total_eur | eur_per_unit_a | eur_per_unit_b | delta_eur_per_unit | eur_per_each_a | eur_per_each_b | delta_eur_per_each |
|---|---|---|---|---|---|---|---|---|---|
| case-pick | 93.0861 | 121.5389 | 28.4528 | 11.6358 | 20.2565 | 8.6207 | 1.5514 | 3.3761 | 1.8247 |
| cross-dock | 4.6 | 19.675 | 15.075 | 0.92 | 1.0355 | 0.1155 | 0.0027 | 0.0026 | -0.0001 |
| export-fragile | 1.4 | — | — | 1.4 | — | — | 0.0167 | — | — |
| full-pallet-out | 62.4069 | 122.3014 | 59.8945 | 8.9153 | 15.2877 | 6.3724 | 0.1083 | 0.1062 | -0.0021 |
| piece-pick | 153.1319 | 30.9417 | -122.1902 | 12.761 | 7.7354 | -5.0256 | 38.283 | — | — |
| returns | 4.35 | 1.675 | -2.675 | 1.0875 | 0.8375 | -0.25 | — | — | — |
| vas | 30.7667 | — | — | 15.3833 | — | — | 3.4185 | — | — |

## Honesty

Synthetic events recorded from a synthetic teaching simulation - not telemetry, not a WMS. Quantities are the synthetic order-line quantities pack.js assigns; locations are the equipment the router bound each operation to. Identities follow ids.js (GS1 numbers use GS1's documentation prefix, not a registered one).

Illustrative teaching rates (analytics.js defaults, or as edited in the planner's Analyze panel) - not a quote. A unit served at a station is charged that station's service time (1 / its service rate), whatever it waited: queue time costs no labour, and a holding cost per unit-hour waiting is charged only if you set one (default 0). Internal transport is charged at the class of mover the floor contains (AGV, forklift or conveyor, in that order); a floor without one moves for free. The picking KPI's wage (Simulate card) is a different input and is not used here.

Generated by tools/run_ledger.py report from the views the viewer shows; no timestamp, so the same database gives the same text.
