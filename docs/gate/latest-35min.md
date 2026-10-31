# Sim gate — PASS

`vlr sim:gate -- --minutes 35` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 35 min · policy `competent` · events on · data `687a5002`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.00 | 1.96 | 1 | 0.0 | 8.00 | 24.86 | 150.5 | 48 | 11.0% | 20.5 | 0/0/0 | 6 | 3 | 1 | 15.70 | 3.37 | 19.49 | 25.33 | 25.33 | 20 | 3 | 23.9 | 0.47 | FAIL |
| 2 | 55.6 | 185.4 | 10.45 | 6.72 | 0 | 0.0 | 9.57 | 22.00 | 185.4 | 38 | 11.0% | 21.7 | 0/0/0 | 7 | 3 | 1 | 19.16 | 2.28 | 23.09 | 26.87 | 26.87 | 22 | 5 | 3.5 | 0.59 | FAIL |
| 3 | 52.0 | 201.3 | 10.83 | 2.28 | 0 | 0.0 | 11.08 | 27.43 | 201.3 | 49 | 11.0% | 21.0 | 0/0/0 | 5 | 4 | 1 | 16.21 | 2.52 | 19.67 | 25.32 | 25.32 | 23 | 4 | -25.2 | 0.30 | FAIL |
| 4 | 48.8 | 163.6 | 9.44 | 3.87 | 0 | 0.0 | 4.24 | 19.43 | 163.6 | 37 | 11.0% | 22.7 | 0/0/0 | 6 | 4 | 1 | 16.67 | 3.64 | 20.48 | 25.77 | 25.77 | 19 | 3 | 68.3 | 0.60 | FAIL |
| 5 | 60.8 | 176.5 | 11.33 | 1.93 | 0 | 0.0 | 9.71 | 24.00 | 176.5 | 47 | 11.0% | 21.1 | 0/0/0 | 6 | 3 | 1 | 16.38 | 4.74 | 19.16 | 24.83 | 24.83 | 18 | 5 | 32.6 | 0.60 | FAIL |
| 6 | 36.0 | 181.5 | 10.72 | 1.62 | 3 | 0.0 | 4.66 | 24.86 | 181.5 | 40 | 11.0% | 18.9 | 0/0/0 | 7 | 3 | 1 | 16.64 | 4.45 | 21.09 | 24.19 | 24.19 | 26 | 5 | 30.4 | 0.50 | FAIL |
| 7 | 31.5 | 180.1 | 10.74 | 1.91 | 0 | 0.0 | 5.59 | 28.00 | 180.1 | 49 | 11.0% | 21.6 | 0/0/0 | 6 | 4 | 1 | 15.92 | 2.28 | 20.61 | 24.85 | 24.85 | 19 | 4 | 20.3 | 0.38 | FAIL |
| 8 | 37.8 | 205.7 | 11.83 | 5.33 | 0 | 0.0 | 8.46 | 15.71 | 205.7 | 28 | 11.0% | 22.0 | 0/0/0 | 5 | 2 | 1 | 19.63 | 4.12 | 23.91 | 29.04 | 29.04 | 23 | 4 | 8.5 | 0.44 | FAIL |
| 9 | 36.3 | 165.5 | 10.97 | 3.48 | 0 | 0.0 | 6.38 | 18.29 | 165.5 | 38 | 11.0% | 23.2 | 0/0/0 | 6 | 2 | 1 | 17.23 | 1.97 | 21.59 | 27.64 | 27.64 | 19 | 4 | 19.6 | 0.67 | FAIL |
| 10 | 34.5 | 153.1 | 9.33 | 2.31 | 0 | 0.0 | 9.64 | 31.43 | 153.1 | 54 | 11.0% | 20.6 | 0/0/0 | 7 | 4 | 1 | 14.75 | 2.09 | 18.71 | 22.31 | 22.31 | 22 | 3 | 23.7 | 0.44 | FAIL |
| **median** | 43.3 | 178.3 | 10.73 | 2.30 | 0 | 0.0 | 8.23 | 24.43 | 178.3 | 44 | 11.0% | 21.0 | 0/0/0 | 6 | 3 | 1 | 16.51 | 2.95 | 20.55 | 25.33 | 25.33 | 21 | 4 | 22.0 | 0.49 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | PASS |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | PASS |
| `level2Min` | 10.73 | 7-13.5 min | PASS |
| `truckAfterLevel2MaxMin` | 2.30 | ≤ 4 min | PASS |
| `maxLivesLost` | 0 | ≤ 0 | PASS |
| `maxShelfStallS` | 0 | ≤ 0 s | PASS |
| `holdBayEventsPer10MinMin` | 8.23 | ≥ 6 /10 min at L1 | PASS |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | PASS |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | PASS |
| `level3Min` | 16.51 | 13.5-18 min | PASS |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.95 | ≤ 3 min after L3 | PASS |
| `level4Min` | 20.55 | 18-22.5 min | PASS |
| `level5Min` | 25.33 | 22.5-27 min | PASS |
| `eventsOfferedBy30MinMin` | 21 | ≥ 15 cards by 30 min | PASS |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | PASS |
| `eventsL1PlateauMin` | 4 | ≥ 3 decision cards from min 3 to L2 | PASS |
| `policyEvPerCard` | 22 | -20 to 40 $/card (events.json policy.evBand) | PASS |
| `policyNonDefaultShare` | 0.49 | ≥ 0.4 (events.json policy.nonDefaultShareMin) | PASS |
| `holdBayEventsPer10Min` | 24.430 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 43.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 35 min | informational |
| `payrollShareOfGross` | 0.210 | ≤ 0.25 (payroll paid ÷ gross income at 35 min) | informational |
| `sorterDecisions` | 0.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 0.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.000 | malware the sorter left as looks clean | informational |
| `hires` | 7.000 | hires (not re-hires) | informational |
| `overseasCleared` | 24.000 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 21.520 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 25.330 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 7/7 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 7 · completed 7 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 6 · completed 3 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 12 · completed 9 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 9 · completed 4 · failed 5 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 4 · completed 3 · failed 1 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 19 · completed 0 · failed 11 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 6 · completed 2 · failed 4 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 3 · failed 1 · declined 0 | per template, all seeds | informational |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 2/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 49 · port 24 · weather 22 · fleet 21 · cityhall 21 · customers 19 · underworld 17 · money 15 · tech 14 · press 14 · luck 11 · security 10 · staff 9 | cards offered per category, all seeds | informational |
| `chainsStarted` | 26 / 24 | chains started / finished, all seeds | informational |
| `modifiersActiveMax` | 4.000 | most modifiers live at once | informational |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational |
| `eventLivesGained` | median 0.0 (2) | lives events gave (all seeds in brackets) | informational |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational |
| `deckEvMean` | -30.880 | mean state-free score over every option of every card ($) | informational |
