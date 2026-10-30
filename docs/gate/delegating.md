# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · data `0af23d08`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.19 | 1.73 | 1 | 0.0 | 8.94 | 15.33 | 150.5 | 8 | 13.0% | 23.6 | 35/4/1 | 7 | 4 | 1 | 16.98 | 3.62 | 21.56 | 26.82 | 26.82 | PASS |
| 2 | 55.6 | 185.4 | 11.98 | 4.31 | 0 | 0.0 | 8.35 | 19.00 | 185.4 | 9 | 13.0% | 26.6 | 46/1/0 | 7 | 2 | 1 | 19.42 | 2.62 | 23.09 | 29.09 | 29.09 | PASS |
| 3 | 52.0 | 201.3 | 12.05 | 2.60 | 2 | 0.0 | 9.13 | 15.33 | 201.3 | 9 | 13.0% | 23.4 | 34/3/2 | 6 | 3 | 1 | 18.44 | 2.00 | 23.57 | 28.43 | 28.43 | PASS |
| 4 | 48.8 | 163.6 | 10.63 | 0.40 | 3 | 0.0 | 2.82 | 19.33 | 163.6 | 5 | 13.0% | 22.6 | 52/4/3 | 8 | 6 | 1 | 15.72 | 3.41 | 20.01 | 25.52 | 25.52 | PASS |
| 5 | 60.8 | 176.5 | 12.36 | 2.98 | 0 | 0.0 | 10.52 | 17.00 | 176.5 | 8 | 13.0% | 29.4 | 38/2/0 | 6 | 3 | 1 | 19.19 | 2.16 | 22.66 | 28.66 | 28.66 | PASS |
| 6 | 36.0 | 181.5 | 11.48 | 0.29 | 1 | 0.0 | 4.36 | 15.67 | 181.5 | 7 | 13.0% | 26.3 | 41/5/1 | 7 | 3 | 1 | 17.83 | 3.27 | 22.70 | 28.89 | 28.89 | PASS |
| 7 | 31.5 | 180.1 | 11.89 | 0.61 | 2 | 0.0 | 6.73 | 19.33 | 180.1 | 7 | 13.0% | 25.3 | 45/3/2 | 7 | 4 | 1 | 17.24 | 4.34 | 22.26 | 27.66 | 27.66 | PASS |
| 8 | 37.8 | 205.7 | 12.22 | 2.70 | 1 | 0.0 | 6.55 | 13.67 | 205.7 | 7 | 13.0% | 25.8 | 33/2/1 | 7 | 4 | 1 | 19.30 | 3.25 | 23.02 | 28.37 | 28.37 | PASS |
| 9 | 36.3 | 165.5 | 11.54 | 1.43 | 2 | 0.0 | 4.33 | 18.00 | 165.5 | 8 | 13.0% | 22.0 | 48/5/0 | 7 | 4 | 1 | 17.63 | 2.28 | 21.46 | 25.89 | 25.89 | PASS |
| 10 | 34.5 | 153.1 | 10.27 | 0.64 | 2 | 0.0 | 6.82 | 24.00 | 153.1 | 11 | 13.0% | 22.5 | 64/8/2 | 9 | 7 | 1 | 15.22 | 2.14 | 19.29 | 25.05 | 25.05 | PASS |
| **median** | 43.3 | 178.3 | 11.72 | 1.58 | 2 | 0.0 | 6.78 | 17.50 | 178.3 | 8 | 13.0% | 24.0 | 43/3.5/1 | 7 | 4 | 1 | 17.73 | 2.94 | 22.46 | 28.02 | 28.02 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 11.72 | 8-15 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 1.58 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 1.50 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 6.78 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 7 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 4 | ≥ 2 by 30 min | informational (delegating) |
| `level3Min` | 17.73 | 15-20 min | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.94 | ≤ 3 min after L3 | informational (delegating) |
| `level4Min` | 22.46 | 20-25 min | informational (delegating) |
| `level5Min` | 28.02 | 25-30 min | informational (delegating) |
| `holdBayEventsPer10Min` | 17.500 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 8.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.130 | share at 30 min | informational |
| `payrollShareOfGross` | 0.240 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 43.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 3.500 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 1.000 | malware the sorter left as looks clean | informational |
| `hires` | 7.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 1.500 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `overseasCleared` | 12.500 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 20.090 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 28.020 | ≤ 32 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 45 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 9/9 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 9 · completed 9 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 7 · completed 4 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 16 · completed 12 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 8 · completed 2 · failed 6 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 5 · completed 5 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 12 · completed 0 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 8 · completed 2 · failed 6 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 4 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
