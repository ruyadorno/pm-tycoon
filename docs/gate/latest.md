# Sim gate — PASS

`vlr sim:gate -- --baseline .logs/m6-latest.json` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `20c5e42e`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.19 | 1.70 | 1 | 0.0 | 8.94 | 14.33 | 150.5 | 19 | 16.5% | 21.2 | 0/0/0 | 6 | 3 | 1 | FAIL |
| 2 | 55.6 | 185.4 | 11.98 | 3.81 | 0 | 0.0 | 8.35 | 16.33 | 185.4 | 21 | 16.5% | 21.6 | 0/0/0 | 6 | 3 | 1 | PASS |
| 3 | 52.0 | 201.3 | 12.05 | 2.30 | 0 | 0.0 | 9.13 | 15.33 | 201.3 | 25 | 16.0% | 22.9 | 0/0/0 | 5 | 1 | 1 | FAIL |
| 4 | 48.8 | 163.6 | 10.63 | 0.38 | 0 | 0.0 | 2.82 | 15.33 | 163.6 | 23 | 17.0% | 22.3 | 0/0/0 | 7 | 4 | 1 | FAIL |
| 5 | 60.8 | 176.5 | 12.36 | 2.20 | 0 | 0.0 | 10.52 | 14.67 | 176.5 | 20 | 16.0% | 22.1 | 0/0/0 | 7 | 4 | 1 | FAIL |
| 6 | 36.0 | 181.5 | 11.48 | 0.20 | 1 | 0.0 | 4.36 | 13.67 | 181.5 | 15 | 16.5% | 22.0 | 0/0/0 | 6 | 5 | 1 | FAIL |
| 7 | 31.5 | 180.1 | 11.89 | 0.41 | 1 | 0.0 | 6.73 | 11.33 | 180.1 | 11 | 16.5% | 23.6 | 0/0/0 | 7 | 4 | 1 | FAIL |
| 8 | 37.8 | 205.7 | 12.22 | 2.73 | 0 | 0.0 | 6.55 | 12.67 | 205.7 | 17 | 16.0% | 23.6 | 0/0/0 | 6 | 3 | 1 | PASS |
| 9 | 36.3 | 165.5 | 11.54 | 1.37 | 0 | 0.0 | 4.33 | 15.33 | 165.5 | 16 | 16.5% | 20.1 | 0/0/0 | 5 | 1 | 1 | FAIL |
| 10 | 34.5 | 153.1 | 10.27 | 0.61 | 1 | 0.0 | 6.82 | 15.33 | 153.1 | 22 | 17.0% | 19.9 | 0/0/0 | 7 | 5 | 1 | FAIL |
| **median** | 43.3 | 178.3 | 11.72 | 1.54 | 0 | 0.0 | 6.78 | 15.00 | 178.3 | 20 | 17.0% | 22.0 | 0/0/0 | 6 | 3.5 | 1 | **PASS** |

| window | median | target | result | Δ% vs baseline |
| --- | --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS | 0.0% (43.30) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS | 0.0% (178.30) |
| `level2Min` | 11.72 | 8-15 min | PASS | -4.6% (12.28) |
| `truckAfterLevel2MaxMin` | 1.54 | ≤ 4 min | PASS | -20.2% (1.93) ✗ |
| `maxLivesLost` | 0 | ≤ 0 | PASS | = (0) |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS | = (0) |
| `holdBayEventsPer10MinMin` | 6.78 | ≥ 6 /10 min at L1 | PASS | -1.3% (6.87) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | PASS | — |
| `questsCompletedBy30MinMin` | 3.50 | ≥ 2 by 30 min | PASS | — |
| `holdBayEventsPer10Min` | 15.000 | whole run | informational |  |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |  |
| `wrongTosses` | 19.500 | clean parcels tossed (Toss-everything) | informational |  |
| `malwareShareAt30Min` | 0.170 | share at 30 min | informational |  |
| `level3Min` | — | 15-20 min | build 2 — informational |  |
| `level4Min` | — | 20-25 min | build 2 — informational |  |
| `level5Min` | — | 25-30 min | build 2 — informational |  |
| `payrollShareOfGross` | 0.220 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |  |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |  |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |  |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |  |
| `hires` | 4.000 | hires (not re-hires) | informational |  |
| `firstOverseasClearedAfterLevel3MaxMin` | — | ≤ 3 min after L3 | build 2 — informational |  |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min (seeds 1-10 × 35 min, --minutes 35) | informational (M9) |  |
| `victoryMaxMin` | — | ≤ 45 min (seeds 1-3 × 45 min, the long test) | informational (M9) |  |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |  |
| `magicOnTime` | 10/10 | golden parcels delivered on time / spawned (all seeds) | informational |  |
| `quest:magic_parcel` | offered 10 · completed 10 · failed 0 · declined 0 | per template, all seeds | informational |  |
| `quest:on_time_day` | offered 11 · completed 4 · failed 6 · declined 0 | per template, all seeds | informational |  |
| `quest:rush_district` | offered 19 · completed 13 · failed 4 · declined 0 | per template, all seeds | informational |  |
| `quest:big_haul` | offered 8 · completed 2 · failed 4 · declined 0 | per template, all seeds | informational |  |
| `quest:cheer_up` | offered 8 · completed 0 · failed 7 · declined 0 | per template, all seeds | informational |  |
| `quest:clean_sweep` | offered 5 · completed 3 · failed 2 · declined 0 | per template, all seeds | informational |  |
| `quest:night_shift` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |  |

playtest-1 rows within ±5 %: no (rows: truckAfterLevel2MaxMin -20.2%) — baseline `.logs/m6-latest.json` (data `6225dd3d`, tolerance ±5 %, informational).
