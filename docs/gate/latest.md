# Sim gate — PASS

`vlr sim:gate` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · events off · data `65a18544`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.06 | 2.58 | 0 | 0.0 | 8.94 | 17.33 | 150.5 | 23 | 11.0% | 20.5 | 0/0/0 | 6 | 3 | 1 | 15.30 | 2.66 | 20.12 | 25.50 | 25.50 | 5 | 0 | — | — | PASS |
| 2 | 55.6 | 185.4 | 10.20 | 3.43 | 1 | 0.0 | 7.85 | 18.00 | 185.4 | 29 | 11.0% | 21.0 | 0/0/0 | 6 | 3 | 1 | 16.52 | 3.93 | 21.85 | 25.52 | 25.52 | 5 | 0 | — | — | FAIL |
| 3 | 52.0 | 201.3 | 10.73 | 3.91 | 1 | 0.0 | 10.25 | 20.67 | 201.3 | 34 | 11.0% | 21.0 | 0/0/0 | 5 | 3 | 1 | 17.18 | 1.73 | 20.76 | 24.05 | 24.05 | 4 | 0 | — | — | FAIL |
| 4 | 48.8 | 163.6 | 9.70 | 1.76 | 0 | 0.0 | 3.09 | 15.67 | 163.6 | 22 | 11.0% | 24.5 | 0/0/0 | 5 | 3 | 1 | 14.76 | 3.53 | 19.36 | 25.41 | 25.41 | 4 | 0 | — | — | FAIL |
| 5 | 60.8 | 176.5 | 12.21 | 2.98 | 2 | 0.0 | 9.01 | 18.00 | 176.5 | 30 | 11.0% | 23.4 | 0/0/0 | 6 | 3 | 1 | 18.07 | 1.79 | 21.28 | 26.51 | 26.51 | 5 | 0 | — | — | FAIL |
| 6 | 36.0 | 181.5 | 10.78 | 1.76 | 0 | 0.0 | 5.56 | 17.00 | 181.5 | 28 | 11.0% | 20.1 | 0/0/0 | 6 | 3 | 1 | 15.91 | 3.81 | 20.35 | 24.35 | 24.35 | 5 | 0 | — | — | FAIL |
| 7 | 31.5 | 180.1 | 11.40 | 4.88 | 1 | 0.0 | 6.14 | 12.33 | 180.1 | 17 | 11.0% | 21.3 | 0/0/0 | 6 | 3 | 1 | 18.99 | 2.62 | 23.26 | 27.48 | 27.48 | 5 | 0 | — | — | FAIL |
| 8 | 37.8 | 205.7 | 11.30 | 5.50 | 0 | 0.0 | 6.20 | 11.33 | 205.7 | 15 | 11.0% | 22.0 | 0/0/0 | 6 | 2 | 1 | 19.77 | 2.65 | 24.39 | 28.77 | 28.77 | 5 | 0 | — | — | FAIL |
| 9 | 36.3 | 165.5 | 10.41 | 2.40 | 0 | 0.0 | 3.84 | 19.33 | 165.5 | 25 | 11.0% | 19.0 | 0/0/0 | 5 | 2 | 1 | 16.53 | 7.02 | 19.53 | 25.16 | 25.16 | 4 | 0 | — | — | FAIL |
| 10 | 34.5 | 153.1 | 9.09 | 2.36 | 0 | 0.0 | 7.70 | 21.00 | 153.1 | 32 | 11.0% | 21.7 | 0/0/0 | 6 | 3 | 1 | 15.61 | 1.78 | 19.91 | 25.23 | 25.23 | 5 | 0 | — | — | PASS |
| **median** | 43.3 | 178.3 | 10.57 | 2.78 | 0 | 0.0 | 6.95 | 17.67 | 178.3 | 27 | 11.0% | 21.0 | 0/0/0 | 6 | 3 | 1 | 16.52 | 2.66 | 20.56 | 25.46 | 25.46 | 5 | 0 | — | — | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS |
| `level2Min` | 10.57 | 7-13.5 min | PASS |
| `truckAfterLevel2MaxMin` | 2.78 | ≤ 4 min | PASS |
| `maxLivesLost` | 0 | ≤ 0 | PASS |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 6.95 | ≥ 6 /10 min at L1 | PASS |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | PASS |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | PASS |
| `level3Min` | 16.52 | 13.5-18 min | PASS |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.66 | ≤ 3 min after L3 | PASS |
| `level4Min` | 20.56 | 18-22.5 min | PASS |
| `level5Min` | 25.46 | 22.5-27 min | PASS |
| `eventsOfferedBy30MinMin` | 5 | ≥ 15 cards by 30 min | informational (M12) |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | informational (M12) |
| `eventsL1PlateauMin` | 0 | ≥ 3 decision cards from min 3 to L2 | informational (M12) |
| `policyEvPerCard` | — | -20 to 40 $/card (events.json policy.evBand) | informational (M12) |
| `policyNonDefaultShare` | — | ≥ 0.4 (events.json policy.nonDefaultShareMin) | informational (M12) |
| `holdBayEventsPer10Min` | 17.670 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 26.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 30 min | informational |
| `payrollShareOfGross` | 0.210 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |
| `hires` | 6.000 | hires (not re-hires) | informational |
| `overseasCleared` | 13.000 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 20.260 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 25.460 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 7/7 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 7 · completed 7 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 7 · completed 1 · failed 6 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 7 · completed 2 · failed 5 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 7 · completed 5 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 4 · completed 2 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 10 · completed 0 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 9 · completed 8 · failed 1 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 5 · completed 2 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 4/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 47 | cards offered per category, all seeds | informational (decisions off) |
| `chainsStarted` | 0 / 0 | chains started / finished, all seeds | informational (decisions off) |
| `modifiersActiveMax` | 0.000 | most modifiers live at once | informational (decisions off) |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational (decisions off) |
| `eventLivesGained` | median 0.0 (0) | lives events gave (all seeds in brackets) | informational (decisions off) |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational (decisions off) |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational (decisions off) |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational (decisions off) |
| `deckEvMean` | -62.830 | mean state-free score over every option of every card ($) | informational |
