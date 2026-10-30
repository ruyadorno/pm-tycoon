# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · data `6225dd3d`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.60 | 2.24 | 1 | 0.0 | 6.89 | 15.67 | 150.5 | 8 | 20.0% | 27.7 | 38/3/1 | PASS |
| 2 | 55.6 | 185.4 | 11.67 | 2.82 | 0 | 0.0 | 9.43 | 19.00 | 185.4 | 7 | 20.0% | 25.9 | 45/2/0 | PASS |
| 3 | 52.0 | 201.3 | 12.45 | 3.96 | 1 | 0.0 | 12.05 | 16.67 | 201.3 | 12 | 20.0% | 27.1 | 35/3/1 | PASS |
| 4 | 48.8 | 163.6 | 11.04 | 0.96 | 2 | 0.0 | 3.62 | 14.00 | 163.6 | 7 | 20.0% | 26.5 | 37/5/2 | PASS |
| 5 | 60.8 | 176.5 | 13.47 | 4.31 | 1 | 0.0 | 8.91 | 17.00 | 176.5 | 8 | 20.0% | 28.5 | 39/2/1 | PASS |
| 6 | 36.0 | 181.5 | 12.34 | 1.52 | 2 | 0.0 | 5.67 | 15.67 | 181.5 | 6 | 20.0% | 25.9 | 40/3/0 | PASS |
| 7 | 31.5 | 180.1 | 12.21 | 2.71 | 1 | 0.0 | 6.55 | 18.33 | 180.1 | 7 | 20.0% | 27.0 | 47/3/1 | PASS |
| 8 | 37.8 | 205.7 | 13.14 | 2.19 | 0 | 0.0 | 6.85 | 14.33 | 205.7 | 7 | 20.0% | 28.2 | 34/2/0 | PASS |
| 9 | 36.3 | 165.5 | 13.26 | 2.25 | 2 | 0.0 | 6.03 | 12.67 | 165.5 | 9 | 20.0% | 29.3 | 30/4/1 | PASS |
| 10 | 34.5 | 153.1 | 11.93 | 2.48 | 3 | 0.0 | 8.38 | 9.67 | 153.1 | 10 | 20.0% | 40.7 | 16/3/2 | PASS |
| **median** | 43.3 | 178.3 | 12.28 | 2.37 | 1 | 0.0 | 6.87 | 15.67 | 178.3 | 8 | 20.0% | 27.0 | 37.5/3/1 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 12.28 | 8-15 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 2.37 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 1 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 6.87 | ≥ 6 /10 min at L1 | informational (delegating) |
| `holdBayEventsPer10Min` | 15.670 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 7.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.200 | share at 30 min | informational |
| `level3Min` | — | 15-20 min | build 2 — informational |
| `level4Min` | — | 20-25 min | build 2 — informational |
| `level5Min` | — | 25-30 min | build 2 — informational |
| `payrollShareOfGross` | 0.270 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 37.500 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 3.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 1.000 | malware the sorter left as looks clean | informational |
| `hires` | 5.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 1.000 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | — | ≤ 3 min after L3 | build 2 — informational |
| `questsOfferedBy30MinMin` | — | ≥ 4 by 30 min | build 2 — informational |
| `questsCompletedBy30MinMin` | — | ≥ 2 by 30 min | build 2 — informational |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min | build 2 — informational |
| `victoryMaxMin` | — | ≤ 45 min | build 2 — informational |
