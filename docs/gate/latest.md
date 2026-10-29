# Sim gate — PASS

`vlr sim:gate` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · data `79d84791`

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | mal@end | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 52.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 2 | 55.9 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 3 | 52.4 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 4 | 46.4 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 5 | 56.4 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 6 | 32.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 7 | 28.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 8 | 32.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 9 | 32.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| 10 | 32.3 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | PASS |
| **median** | 39.4 | — | — | — | 0 | 0.0 | 0.00 | 0.00 | 3.0% | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 39.35 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | — | ≤ 300 s | informational (M2) |
| `level2Min` | — | 8-15 min | informational (M3) |
| `truckAfterLevel2MaxMin` | — | ≤ 4 min | informational (M3) |
| `maxLivesLost` | 0 | ≤ 0 | informational (M2) |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 0 | ≥ 6 /10 min at L1 | informational (M2) |
| `holdBayEventsPer10Min` | 0.000 | whole run | informational |
| `malwareShareAt30Min` | 0.030 | share at 30 min | informational |
| `level3Min` | — | 15-20 min | build 2 — informational |
| `level4Min` | — | 20-25 min | build 2 — informational |
| `level5Min` | — | 25-30 min | build 2 — informational |
