# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · data `20c5e42e`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.19 | 1.73 | 0 | 0.0 | 8.94 | 12.33 | 150.5 | 6 | 16.5% | 27.0 | 27/2/0 | 7 | 4 | 1 | PASS |
| 2 | 55.6 | 185.4 | 11.98 | 4.31 | 1 | 0.0 | 8.35 | 15.00 | 185.4 | 9 | 16.5% | 26.7 | 35/1/0 | 6 | 4 | 1 | PASS |
| 3 | 52.0 | 201.3 | 12.05 | 2.60 | 0 | 0.0 | 9.13 | 14.33 | 201.3 | 7 | 16.0% | 26.8 | 32/1/0 | 6 | 3 | 1 | PASS |
| 4 | 48.8 | 163.6 | 10.63 | 0.40 | 2 | 0.0 | 2.82 | 16.00 | 163.6 | 4 | 17.0% | 23.7 | 45/3/1 | 7 | 4 | 1 | PASS |
| 5 | 60.8 | 176.5 | 12.36 | 2.98 | 0 | 0.0 | 10.52 | 16.00 | 176.5 | 8 | 16.0% | 29.2 | 34/2/0 | 6 | 4 | 1 | PASS |
| 6 | 36.0 | 181.5 | 11.48 | 0.29 | 0 | 0.0 | 4.36 | 18.33 | 181.5 | 6 | 16.5% | 24.6 | 48/4/0 | 7 | 4 | 1 | PASS |
| 7 | 31.5 | 180.1 | 11.89 | 0.61 | 1 | 0.0 | 6.73 | 13.33 | 180.1 | 7 | 16.5% | 26.1 | 32/3/1 | 6 | 4 | 1 | PASS |
| 8 | 37.8 | 205.7 | 12.22 | 2.70 | 0 | 0.0 | 6.55 | 13.00 | 205.7 | 7 | 16.0% | 25.9 | 31/2/0 | 7 | 5 | 1 | PASS |
| 9 | 36.3 | 165.5 | 11.54 | 1.43 | 1 | 0.0 | 4.33 | 11.67 | 165.5 | 6 | 16.5% | 24.9 | 30/3/0 | 6 | 4 | 1 | PASS |
| 10 | 34.5 | 153.1 | 10.27 | 0.64 | 1 | 0.0 | 6.82 | 15.00 | 153.1 | 10 | 17.0% | 25.3 | 37/7/0 | 7 | 5 | 1 | PASS |
| **median** | 43.3 | 178.3 | 11.72 | 1.58 | 1 | 0.0 | 6.78 | 14.67 | 178.3 | 7 | 17.0% | 26.0 | 33/2.5/0 | 6.5 | 4 | 1 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 11.72 | 8-15 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 1.58 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 0.50 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 6.78 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 6.50 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 4 | ≥ 2 by 30 min | informational (delegating) |
| `holdBayEventsPer10Min` | 14.670 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 7.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.170 | share at 30 min | informational |
| `level3Min` | — | 15-20 min | build 2 — informational |
| `level4Min` | — | 20-25 min | build 2 — informational |
| `level5Min` | — | 25-30 min | build 2 — informational |
| `payrollShareOfGross` | 0.260 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 33.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 2.500 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |
| `hires` | 5.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 0.500 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | — | ≤ 3 min after L3 | build 2 — informational |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min (seeds 1-10 × 35 min, --minutes 35) | informational (M9) |
| `victoryMaxMin` | — | ≤ 45 min (seeds 1-3 × 45 min, the long test) | informational (M9) |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 11/11 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 11 · completed 11 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 10 · completed 5 · failed 4 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 18 · completed 14 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 9 · completed 4 · failed 4 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 8 · completed 6 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 8 · completed 0 · failed 8 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
