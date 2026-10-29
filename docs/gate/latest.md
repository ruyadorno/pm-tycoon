# Sim gate — PASS

`vlr sim:gate` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `2112987b`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 57.3 | 154.4 | 11.44 | 1.17 | 0 | 0.0 | 7.87 | 16.00 | 154.4 | 19 | 20.0% | PASS |
| 2 | 58.3 | 178.1 | 13.78 | 3.86 | 0 | 0.0 | 8.71 | 16.33 | 178.1 | 21 | 20.0% | PASS |
| 3 | 54.8 | 161.8 | 14.40 | 5.11 | 1 | 0.0 | 7.64 | 12.67 | 161.8 | 19 | 20.0% | FAIL |
| 4 | 50.8 | 172.1 | 10.93 | 0.92 | 0 | 0.0 | 7.32 | 18.00 | 172.1 | 21 | 20.0% | PASS |
| 5 | 60.8 | 176.5 | 13.05 | 1.81 | 0 | 0.0 | 9.20 | 13.33 | 176.5 | 20 | 20.0% | FAIL |
| 6 | 37.3 | 180.0 | 16.23 | 3.96 | 0 | 0.0 | 4.31 | 13.00 | 180.0 | 11 | 20.0% | FAIL |
| 7 | 33.3 | 191.0 | 12.91 | 2.27 | 0 | 0.0 | 6.97 | 15.33 | 191.0 | 27 | 20.0% | PASS |
| 8 | 37.3 | 197.7 | 13.46 | 1.26 | 0 | 0.0 | 4.46 | 13.67 | 197.7 | 11 | 20.0% | FAIL |
| 9 | 37.3 | 166.4 | 13.04 | 2.69 | 0 | 0.0 | 6.13 | 14.33 | 166.4 | 18 | 20.0% | PASS |
| 10 | 37.3 | 166.0 | 12.51 | 1.93 | 1 | 0.0 | 6.39 | 12.00 | 166.0 | 11 | 20.0% | FAIL |
| **median** | 44.0 | 174.3 | 13.05 | 2.10 | 0 | 0.0 | 7.15 | 14.00 | 174.3 | 19 | 20.0% | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 44.05 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | 174.30 | ≤ 300 s | PASS |
| `level2Min` | 13.05 | 8-15 min | PASS |
| `truckAfterLevel2MaxMin` | 2.10 | ≤ 4 min | PASS |
| `maxLivesLost` | 0 | ≤ 0 | PASS |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 7.15 | ≥ 6 /10 min at L1 | PASS |
| `holdBayEventsPer10Min` | 14.000 | whole run | informational |
| `scriptedCaughtS` | 174.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 19.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.200 | share at 30 min | informational |
| `level3Min` | — | 15-20 min | build 2 — informational |
| `level4Min` | — | 20-25 min | build 2 — informational |
| `level5Min` | — | 25-30 min | build 2 — informational |
