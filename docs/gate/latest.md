# Sim gate — PASS

`vlr sim:gate` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `34873b38`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 57.3 | 252.5 | — | — | 1 | 0.0 | 7.67 | 7.67 | 252.5 | 10 | 5.0% | FAIL |
| 2 | 58.3 | 211.0 | — | — | 0 | 0.0 | 7.33 | 7.33 | 211.0 | 10 | 5.0% | PASS |
| 3 | 54.8 | 473.1 | — | — | 1 | 0.0 | 8.00 | 8.00 | 473.1 | 13 | 5.0% | FAIL |
| 4 | 50.8 | 270.3 | — | — | 0 | 0.0 | 6.67 | 6.67 | 270.3 | 8 | 5.0% | PASS |
| 5 | 60.8 | 225.8 | — | — | 0 | 0.0 | 11.67 | 11.67 | 225.8 | 19 | 5.0% | FAIL |
| 6 | 37.3 | 196.5 | — | — | 0 | 0.0 | 9.67 | 9.67 | 196.5 | 12 | 5.0% | PASS |
| 7 | 33.3 | 381.4 | — | — | 0 | 0.0 | 6.00 | 6.00 | 381.4 | 9 | 5.0% | FAIL |
| 8 | 37.3 | 234.5 | — | — | 0 | 0.0 | 5.00 | 5.00 | 312.6 | 7 | 5.0% | FAIL |
| 9 | 37.3 | 326.5 | — | — | 0 | 0.0 | 8.33 | 8.33 | 326.5 | 11 | 5.0% | FAIL |
| 10 | 37.3 | 306.1 | — | — | 0 | 0.0 | 7.67 | 7.67 | 306.1 | 11 | 5.0% | FAIL |
| **median** | 44.0 | 261.4 | — | — | 0 | 0.0 | 7.67 | 7.67 | 288.2 | 11 | 5.0% | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 44.05 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | 261.40 | ≤ 300 s | PASS |
| `level2Min` | — | 8-15 min | informational (M3) |
| `truckAfterLevel2MaxMin` | — | ≤ 4 min | informational (M3) |
| `maxLivesLost` | 0 | ≤ 0 | PASS |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 7.67 | ≥ 6 /10 min at L1 | PASS |
| `holdBayEventsPer10Min` | 7.670 | whole run | informational |
| `scriptedCaughtS` | 288.200 | flag time of the scripted malware | informational |
| `wrongTosses` | 10.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.050 | share at 30 min | informational |
| `level3Min` | — | 15-20 min | build 2 — informational |
| `level4Min` | — | 20-25 min | build 2 — informational |
| `level5Min` | — | 25-30 min | build 2 — informational |
