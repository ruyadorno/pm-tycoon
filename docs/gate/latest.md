# Sim gate — PASS

`vlr sim:gate -- --baseline .logs/m7-latest.json` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `9be64b60`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.19 | 1.70 | 0 | 0.0 | 8.94 | 17.33 | 150.5 | 27 | 15.5% | 21.9 | 0/0/0 | 7 | 4 | 1 | 17.10 | 1.82 | — | — | PASS |
| 2 | 55.6 | 185.4 | 11.98 | 3.81 | 0 | 0.0 | 8.35 | 17.00 | 185.4 | 27 | 14.5% | 21.4 | 0/0/0 | 6 | 3 | 1 | 19.59 | 2.28 | — | — | PASS |
| 3 | 52.0 | 201.3 | 12.05 | 2.30 | 0 | 0.0 | 9.13 | 13.67 | 201.3 | 21 | 15.5% | 22.1 | 0/0/0 | 5 | 2 | 1 | 18.00 | 1.93 | — | — | PASS |
| 4 | 48.8 | 163.6 | 10.63 | 0.38 | 1 | 0.0 | 2.82 | 18.33 | 163.6 | 21 | 16.0% | 19.0 | 0/0/0 | 8 | 6 | 1 | 16.01 | 2.11 | — | — | FAIL |
| 5 | 60.8 | 176.5 | 12.36 | 2.20 | 0 | 0.0 | 10.52 | 16.00 | 176.5 | 21 | 14.5% | 23.4 | 0/0/0 | 6 | 3 | 1 | 19.52 | 3.48 | — | — | FAIL |
| 6 | 36.0 | 181.5 | 11.48 | 0.20 | 0 | 0.0 | 4.36 | 16.00 | 181.5 | 22 | 15.5% | 21.8 | 0/0/0 | 6 | 3 | 1 | 17.35 | 1.97 | — | — | FAIL |
| 7 | 31.5 | 180.1 | 11.89 | 0.41 | 0 | 0.0 | 6.73 | 16.00 | 180.1 | 29 | 15.5% | 22.3 | 0/0/0 | 6 | 2 | 1 | 17.96 | 2.26 | — | — | PASS |
| 8 | 37.8 | 205.7 | 12.22 | 2.73 | 1 | 0.0 | 6.55 | 15.33 | 205.7 | 17 | 15.0% | 22.5 | 0/0/0 | 6 | 4 | 1 | 18.49 | 2.57 | — | — | FAIL |
| 9 | 36.3 | 165.5 | 11.54 | 1.37 | 0 | 0.0 | 4.33 | 15.00 | 165.5 | 18 | 15.0% | 20.4 | 0/0/0 | 5 | 1 | 1 | 18.18 | 2.88 | — | — | FAIL |
| 10 | 34.5 | 153.1 | 10.27 | 0.61 | 0 | 0.0 | 6.82 | 16.67 | 153.1 | 22 | 16.5% | 19.4 | 0/0/0 | 7 | 5 | 1 | 15.36 | 2.00 | — | — | PASS |
| **median** | 43.3 | 178.3 | 11.72 | 1.54 | 0 | 0.0 | 6.78 | 16.00 | 178.3 | 22 | 16.0% | 22.0 | 0/0/0 | 6 | 3 | 1 | 17.98 | 2.18 | — | — | **PASS** |

| window | median | target | result | Δ% vs baseline |
| --- | --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS | 0.0% (43.30) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS | 0.0% (178.30) |
| `level2Min` | 11.72 | 8-15 min | PASS | 0.0% (11.72) |
| `truckAfterLevel2MaxMin` | 1.54 | ≤ 4 min | PASS | 0.0% (1.54) |
| `maxLivesLost` | 0 | ≤ 0 | PASS | = (0) |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS | = (0) |
| `holdBayEventsPer10MinMin` | 6.78 | ≥ 6 /10 min at L1 | PASS | 0.0% (6.78) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | PASS | — |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | PASS | — |
| `level3Min` | 17.98 | 15-20 min | PASS | — |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.18 | ≤ 3 min after L3 | PASS | — |
| `level4Min` | — | 20-25 min | informational (M9) | — |
| `level5Min` | — | 25-30 min | informational (M9) | — |
| `holdBayEventsPer10Min` | 16.000 | whole run | informational |  |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |  |
| `wrongTosses` | 21.500 | clean parcels tossed (Toss-everything) | informational |  |
| `malwareShareAt30Min` | 0.160 | share at 30 min | informational |  |
| `payrollShareOfGross` | 0.220 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |  |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |  |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |  |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |  |
| `hires` | 6.000 | hires (not re-hires) | informational |  |
| `overseasCleared` | 11.000 | overseas clearances (parcel:cleared, malware included) | informational |  |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |  |
| `dock2Min` | 20.580 | minute loading dock 2 is bought | informational |  |
| `dock3Min` | — | minute loading dock 3 is bought | informational (M9) |  |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min (seeds 1-10 × 35 min, --minutes 35) | informational (M9) |  |
| `victoryMaxMin` | — | ≤ 45 min (seeds 1-3 × 45 min, the long test) | informational (M9) |  |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |  |
| `magicOnTime` | 8/9 | golden parcels delivered on time / spawned (all seeds) | informational |  |
| `quest:magic_parcel` | offered 9 · completed 8 · failed 0 · declined 0 | per template, all seeds | informational |  |
| `quest:on_time_day` | offered 8 · completed 3 · failed 4 · declined 0 | per template, all seeds | informational |  |
| `quest:rush_district` | offered 16 · completed 12 · failed 4 · declined 0 | per template, all seeds | informational |  |
| `quest:night_shift` | offered 5 · completed 5 · failed 0 · declined 0 | per template, all seeds | informational |  |
| `quest:clean_sweep` | offered 2 · completed 1 · failed 1 · declined 0 | per template, all seeds | informational |  |
| `quest:customs_run` | offered 5 · completed 0 · failed 3 · declined 0 | per template, all seeds | informational |  |
| `quest:cheer_up` | offered 8 · completed 0 · failed 7 · declined 0 | per template, all seeds | informational |  |
| `quest:big_haul` | offered 8 · completed 3 · failed 4 · declined 0 | per template, all seeds | informational |  |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |  |

playtest-1 rows within ±5 %: yes — baseline `.logs/m7-latest.json` (data `20c5e42e`, tolerance ±5 %, informational).
