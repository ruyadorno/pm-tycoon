# Sim gate — PASS

`vlr sim:gate -- --baseline docs/gate/latest.json` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `6225dd3d`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 11.60 | 1.87 | 0 | 0.0 | 6.89 | 17.33 | 150.5 | 23 | 20.0% | 21.2 | 0/0/0 | PASS |
| 2 | 55.6 | 185.4 | 11.67 | 1.67 | 0 | 0.0 | 9.43 | 17.00 | 185.4 | 19 | 20.0% | 24.2 | 0/0/0 | PASS |
| 3 | 52.0 | 201.3 | 12.45 | 3.34 | 0 | 0.0 | 12.05 | 17.33 | 201.3 | 21 | 20.0% | 23.2 | 0/0/0 | PASS |
| 4 | 48.8 | 163.6 | 11.04 | 0.71 | 0 | 0.0 | 3.62 | 17.00 | 163.6 | 18 | 20.0% | 21.4 | 0/0/0 | FAIL |
| 5 | 60.8 | 176.5 | 13.47 | 3.19 | 0 | 0.0 | 8.91 | 14.67 | 176.5 | 20 | 20.0% | 24.8 | 0/0/0 | FAIL |
| 6 | 36.0 | 181.5 | 12.34 | 0.76 | 0 | 0.0 | 5.67 | 16.33 | 181.5 | 15 | 20.0% | 22.7 | 0/0/0 | FAIL |
| 7 | 31.5 | 180.1 | 12.21 | 1.85 | 1 | 0.0 | 6.55 | 18.00 | 180.1 | 18 | 20.0% | 23.6 | 0/0/0 | FAIL |
| 8 | 37.8 | 205.7 | 13.14 | 1.98 | 0 | 0.0 | 6.85 | 14.33 | 205.7 | 14 | 20.0% | 22.7 | 0/0/0 | PASS |
| 9 | 36.3 | 165.5 | 13.26 | 5.38 | 0 | 0.0 | 6.03 | 14.67 | 165.5 | 24 | 20.0% | 26.4 | 0/0/0 | FAIL |
| 10 | 34.5 | 153.1 | 11.93 | 2.28 | 1 | 0.0 | 8.38 | 16.67 | 153.1 | 24 | 20.0% | 22.5 | 0/0/0 | FAIL |
| **median** | 43.3 | 178.3 | 12.28 | 1.93 | 0 | 0.0 | 6.87 | 16.84 | 178.3 | 20 | 20.0% | 23.0 | 0/0/0 | **PASS** |

| window | median | target | result | Δ% vs baseline |
| --- | --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS | -1.7% (44.05) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS | +2.3% (174.30) |
| `level2Min` | 12.28 | 8-15 min | PASS | -5.9% (13.05) ✗ |
| `truckAfterLevel2MaxMin` | 1.93 | ≤ 4 min | PASS | -8.1% (2.10) ✗ |
| `maxLivesLost` | 0 | ≤ 0 | PASS | = (0) |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS | = (0) |
| `holdBayEventsPer10MinMin` | 6.87 | ≥ 6 /10 min at L1 | PASS | -3.9% (7.15) |
| `holdBayEventsPer10Min` | 16.840 | whole run | informational |  |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |  |
| `wrongTosses` | 19.500 | clean parcels tossed (Toss-everything) | informational |  |
| `malwareShareAt30Min` | 0.200 | share at 30 min | informational |  |
| `level3Min` | — | 15-20 min | build 2 — informational |  |
| `level4Min` | — | 20-25 min | build 2 — informational |  |
| `level5Min` | — | 25-30 min | build 2 — informational |  |
| `payrollShareOfGross` | 0.230 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |  |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |  |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |  |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |  |
| `hires` | 4.000 | hires (not re-hires) | informational |  |
| `firstOverseasClearedAfterLevel3MaxMin` | — | ≤ 3 min after L3 | build 2 — informational |  |
| `questsOfferedBy30MinMin` | — | ≥ 4 by 30 min | build 2 — informational |  |
| `questsCompletedBy30MinMin` | — | ≥ 2 by 30 min | build 2 — informational |  |
| `goldenReleaseOfferedMaxMin` | — | ≤ 32 min | build 2 — informational |  |
| `victoryMaxMin` | — | ≤ 45 min | build 2 — informational |  |

playtest-1 rows within ±5 %: no (rows: level2Min -5.9%, truckAfterLevel2MaxMin -8.1%) — baseline `docs/gate/latest.json` (data `2112987b`, tolerance ±5 %, informational).
