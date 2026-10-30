# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · data `9be64b60`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.19 | 1.73 | 0 | 0.0 | 8.94 | 18.00 | 150.5 | 6 | 16.0% | 25.6 | 42/2/0 | 6 | 3 | 1 | 16.98 | 3.62 | — | — | PASS |
| 2 | 55.6 | 185.4 | 11.98 | 4.31 | 0 | 0.0 | 8.35 | 17.67 | 185.4 | 8 | 14.5% | 25.7 | 43/0/0 | 6 | 2 | 1 | 19.42 | 2.62 | — | — | PASS |
| 3 | 52.0 | 201.3 | 12.05 | 2.60 | 2 | 0.0 | 9.13 | 16.67 | 201.3 | 7 | 15.0% | 23.9 | 39/1/2 | 6 | 3 | 1 | 18.44 | 2.00 | — | — | PASS |
| 4 | 48.8 | 163.6 | 10.63 | 0.40 | 3 | 0.0 | 2.82 | 15.67 | 163.6 | 6 | 16.5% | 21.9 | 43/5/3 | 8 | 6 | 1 | 15.72 | 3.41 | — | — | PASS |
| 5 | 60.8 | 176.5 | 12.36 | 2.98 | 1 | 0.0 | 10.52 | 15.67 | 176.5 | 8 | 14.5% | 28.7 | 34/2/1 | 6 | 3 | 1 | 19.19 | 2.16 | — | — | PASS |
| 6 | 36.0 | 181.5 | 11.48 | 0.29 | 0 | 0.0 | 4.36 | 13.33 | 181.5 | 7 | 15.5% | 26.1 | 34/5/0 | 6 | 3 | 1 | 17.83 | 3.27 | — | — | PASS |
| 7 | 31.5 | 180.1 | 11.89 | 0.61 | 2 | 0.0 | 6.73 | 14.67 | 180.1 | 5 | 15.5% | 25.6 | 36/1/2 | 6 | 3 | 1 | 17.68 | 6.13 | — | — | PASS |
| 8 | 37.8 | 205.7 | 12.22 | 2.70 | 2 | 0.0 | 6.55 | 13.00 | 205.7 | 5 | 14.5% | 24.3 | 30/0/1 | 7 | 4 | 1 | 19.30 | 3.25 | — | — | PASS |
| 9 | 36.3 | 165.5 | 11.54 | 1.43 | 1 | 0.0 | 4.33 | 15.00 | 165.5 | 6 | 15.5% | 21.1 | 40/3/0 | 5 | 2 | 1 | 17.63 | 2.28 | — | — | PASS |
| 10 | 34.5 | 153.1 | 10.27 | 0.64 | 2 | 0.0 | 6.82 | 17.00 | 153.1 | 4 | 16.5% | 20.8 | 43/1/2 | 8 | 7 | 1 | 15.22 | 2.14 | — | — | PASS |
| **median** | 43.3 | 178.3 | 11.72 | 1.58 | 2 | 0.0 | 6.78 | 15.67 | 178.3 | 6 | 16.0% | 25.0 | 39.5/1.5/1 | 6 | 3 | 1 | 17.76 | 2.94 | — | — | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 11.72 | 8-15 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 1.58 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 1.50 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 6.78 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | informational (delegating) |
| `level3Min` | 17.76 | 15-20 min | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.94 | ≤ 3 min after L3 | informational (delegating) |
| `level4Min` | — | 20-25 min | informational (delegating) |
| `level5Min` | — | 25-30 min | informational (delegating) |
| `holdBayEventsPer10Min` | 15.670 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 6.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.160 | share at 30 min | informational |
| `payrollShareOfGross` | 0.250 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 39.500 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 1.500 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 1.000 | malware the sorter left as looks clean | informational |
| `hires` | 7.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 1.500 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `overseasCleared` | 11.500 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 20.270 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational (M9) |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min (seeds 1-10 × 35 min, --minutes 35) | informational (M9) |
| `victoryMaxMin` | — | ≤ 45 min (seeds 1-3 × 45 min, the long test) | informational (M9) |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 9/10 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 10 · completed 9 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 8 · completed 4 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 16 · completed 12 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 11 · completed 2 · failed 6 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 5 · completed 3 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 8 · completed 0 · failed 7 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 4 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
