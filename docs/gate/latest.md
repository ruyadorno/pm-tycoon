# Sim gate — PASS

`vlr sim:gate` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `competent` · events on · data `6c7f8631`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.06 | 1.74 | 0 | 0.0 | 8.94 | 19.33 | 150.5 | 33 | 11.0% | 22.6 | 0/0/0 | 7 | 4 | 1 | 16.49 | 3.16 | 20.08 | 25.29 | 25.29 | 21 | 3 | 22.3 | 0.47 | FAIL |
| 2 | 55.6 | 185.4 | 10.06 | 1.81 | 1 | 0.0 | 9.94 | 19.00 | 185.4 | 29 | 11.0% | 21.8 | 0/0/0 | 6 | 4 | 1 | 15.52 | 2.31 | 19.41 | 24.78 | 24.78 | 19 | 4 | 41.2 | 0.64 | FAIL |
| 3 | 52.0 | 201.3 | 10.16 | 3.62 | 1 | 0.0 | 12.80 | 18.00 | 201.3 | 30 | 11.0% | 23.1 | 0/0/0 | 5 | 4 | 1 | 16.81 | 1.90 | 20.07 | 25.62 | 25.62 | 17 | 3 | 17.4 | 0.67 | FAIL |
| 4 | 48.8 | 163.6 | 9.32 | 3.12 | 0 | 0.0 | 5.36 | 17.00 | 163.6 | 27 | 11.0% | 21.6 | 0/0/0 | 6 | 4 | 1 | 15.39 | 3.64 | 19.03 | 23.55 | 23.55 | 21 | 3 | 18.9 | 0.50 | FAIL |
| 5 | 60.8 | 176.5 | 11.79 | 8.14 | 0 | 0.0 | 11.88 | 13.33 | 176.5 | 18 | 9.5% | 26.2 | 0/0/0 | 5 | 2 | 1 | 21.36 | 4.77 | 26.00 | — | — | 23 | 5 | 37.0 | 0.63 | FAIL |
| 6 | 36.0 | 181.5 | 11.68 | 5.37 | 2 | 0.0 | 4.28 | 14.33 | 181.5 | 18 | 9.5% | 26.0 | 0/0/0 | 6 | 2 | 1 | 20.10 | 3.43 | 24.54 | — | — | 23 | 3 | -24.5 | 0.39 | FAIL |
| 7 | 31.5 | 180.1 | 12.45 | 6.44 | 0 | 0.0 | 8.83 | 13.67 | 180.1 | 23 | 9.5% | 27.8 | 0/0/0 | 5 | 1 | 1 | 21.23 | 1.82 | 27.05 | — | — | 21 | 5 | 40.3 | 0.71 | FAIL |
| 8 | 37.8 | 205.7 | 11.59 | 0.63 | 0 | 0.0 | 9.49 | 17.67 | 205.7 | 27 | 11.0% | 20.5 | 0/0/0 | 5 | 2 | 1 | 17.91 | 2.15 | 22.64 | 26.58 | 26.58 | 19 | 3 | 72.0 | 0.79 | FAIL |
| 9 | 36.3 | 165.5 | 10.41 | 2.44 | 0 | 0.0 | 3.84 | 19.67 | 165.5 | 25 | 11.0% | 20.0 | 0/0/0 | 6 | 3 | 1 | 16.64 | 2.28 | 20.17 | 25.00 | 25.00 | 21 | 2 | 26.3 | 0.54 | FAIL |
| 10 | 34.5 | 153.1 | 9.41 | 1.11 | 0 | 0.0 | 7.44 | 23.00 | 153.1 | 35 | 11.0% | 20.0 | 0/0/0 | 7 | 4 | 1 | 13.94 | 2.78 | 17.84 | 23.50 | 23.50 | 21 | 2 | 23.7 | 0.64 | FAIL |
| **median** | 43.3 | 178.3 | 10.29 | 2.78 | 0 | 0.0 | 8.89 | 17.84 | 178.3 | 27 | 11.0% | 22.0 | 0/0/0 | 6 | 3.5 | 1 | 16.73 | 2.55 | 20.13 | 25.46 | 25.46 | 21 | 3 | 25.0 | 0.63 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS |
| `level2Min` | 10.29 | 7-13.5 min | PASS |
| `truckAfterLevel2MaxMin` | 2.78 | ≤ 4 min | PASS |
| `maxLivesLost` | 0 | ≤ 0 | PASS |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 8.89 | ≥ 6 /10 min at L1 | PASS |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | PASS |
| `questsCompletedBy30MinMin` | 3.50 | ≥ 2 by 30 min | PASS |
| `level3Min` | 16.73 | 13.5-18 min | PASS |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.55 | ≤ 3 min after L3 | PASS |
| `level4Min` | 20.13 | 18-22.5 min | PASS |
| `level5Min` | 25.46 | 22.5-27 min | PASS |
| `eventsOfferedBy30MinMin` | 21 | ≥ 15 cards by 30 min | PASS |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | PASS |
| `eventsL1PlateauMin` | 3 | ≥ 3 decision cards from min 3 to L2 | PASS |
| `policyEvPerCard` | 25.01 | -20 to 40 $/card (events.json policy.evBand) | PASS |
| `policyNonDefaultShare` | 0.63 | ≥ 0.4 (events.json policy.nonDefaultShareMin) | PASS |
| `holdBayEventsPer10Min` | 17.840 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 27.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 30 min | informational |
| `payrollShareOfGross` | 0.220 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |
| `hires` | 6.500 | hires (not re-hires) | informational |
| `overseasCleared` | 12.000 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 19.310 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 25.460 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 7/7 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 7 · completed 7 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 8 · completed 1 · failed 7 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 12 · completed 9 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 7 · completed 4 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 4 · completed 4 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 9 · completed 0 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 7 · completed 3 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 2 · failed 2 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 3/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 49 · underworld 37 · staff 21 · customers 19 · money 18 · fleet 16 · security 12 · weather 8 · luck 8 · cityhall 8 · port 4 · tech 4 · press 2 | cards offered per category, all seeds | informational |
| `chainsStarted` | 17 / 12 | chains started / finished, all seeds | informational |
| `modifiersActiveMax` | 2.500 | most modifiers live at once | informational |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational |
| `eventLivesGained` | median 0.5 (5) | lives events gave (all seeds in brackets) | informational |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational |
| `deckEvMean` | -33.860 | mean state-free score over every option of every card ($) | informational |
