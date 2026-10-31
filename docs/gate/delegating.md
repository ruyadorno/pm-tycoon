# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · events on · data `821dff60`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.00 | 3.99 | 0 | 0.0 | 8.00 | 18.67 | 150.5 | 6 | 11.0% | 26.1 | 47/2/1 | 6 | 2 | 1 | 17.00 | 3.69 | 20.93 | 26.49 | 26.49 | 23 | 3 | 18.4 | 0.50 | PASS |
| 2 | 55.6 | 185.4 | 10.45 | 8.89 | 0 | 0.0 | 9.57 | 12.00 | 185.4 | 8 | 9.5% | 31.6 | 25/2/1 | 6 | 2 | 1 | 20.29 | 2.03 | 23.67 | — | — | 22 | 5 | -16.7 | 0.50 | PASS |
| 3 | 52.0 | 201.3 | 10.83 | 2.29 | 2 | 0.0 | 11.08 | 17.00 | 201.3 | 13 | 11.0% | 27.3 | 39/5/2 | 6 | 4 | 1 | 17.26 | 3.88 | 22.64 | 27.29 | 27.29 | 19 | 4 | 48.3 | 0.50 | PASS |
| 4 | 48.8 | 163.6 | 9.44 | 1.54 | 2 | 0.0 | 4.24 | 14.00 | 163.6 | 6 | 11.0% | 27.9 | 37/4/2 | 5 | 3 | 1 | 14.76 | 3.67 | 19.75 | 25.42 | 25.42 | 23 | 3 | -7.1 | 0.38 | PASS |
| 5 | 60.8 | 176.5 | 11.33 | 2.44 | 1 | 0.0 | 9.71 | 18.67 | 176.5 | 9 | 11.0% | 28.1 | 44/4/0 | 6 | 3 | 1 | 17.34 | 1.97 | 19.44 | 25.73 | 25.73 | 18 | 5 | 8.8 | 0.75 | PASS |
| 6 | 36.0 | 181.5 | 10.72 | 2.15 | 0 | 0.0 | 4.66 | 19.33 | 181.5 | 11 | 11.0% | 25.0 | 52/9/0 | 5 | 2 | 1 | 15.51 | 1.98 | 20.14 | 24.26 | 24.26 | 26 | 5 | 46.9 | 0.47 | PASS |
| 7 | 31.5 | 180.1 | 10.74 | 1.56 | 2 | 0.0 | 5.59 | 15.33 | 180.1 | 5 | 11.0% | 29.1 | 40/2/1 | 6 | 3 | 1 | 16.36 | 2.03 | 20.89 | 25.95 | 25.95 | 20 | 4 | 34.9 | 0.54 | PASS |
| 8 | 37.8 | 205.7 | 11.83 | 5.95 | 0 | 0.0 | 8.46 | 13.67 | 205.7 | 7 | 11.0% | 26.9 | 31/0/0 | 5 | 3 | 1 | 19.54 | 3.15 | 23.07 | 27.66 | 27.66 | 24 | 4 | -1.3 | 0.50 | PASS |
| 9 | 36.3 | 165.5 | 10.97 | 6.50 | 3 | 0.0 | 6.38 | 9.33 | 165.5 | 5 | 8.0% | 45.3 | 16/0/2 | 4 | 2 | 1 | 19.16 | 1.27 | — | — | — | 14 | 4 | 23.7 | 0.67 | PASS |
| 10 | 34.5 | 153.1 | 9.33 | 1.52 | 1 | 0.0 | 9.64 | 29.00 | 153.1 | 10 | 11.0% | 25.6 | 77/6/1 | 6 | 4 | 1 | 14.56 | 2.81 | 18.65 | 22.65 | 22.65 | 23 | 3 | 45.0 | 0.50 | PASS |
| **median** | 43.3 | 178.3 | 10.73 | 2.37 | 1 | 0.0 | 8.23 | 16.17 | 178.3 | 8 | 11.0% | 28.0 | 39.5/3/1 | 6 | 3 | 1 | 17.13 | 2.42 | 20.91 | 26.22 | 26.22 | 22.5 | 4 | 21.1 | 0.50 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 10.73 | 7-13.5 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 2.37 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 1 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 8.23 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | informational (delegating) |
| `level3Min` | 17.13 | 13.5-18 min | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.42 | ≤ 3 min after L3 | informational (delegating) |
| `level4Min` | 20.91 | 18-22.5 min | informational (delegating) |
| `level5Min` | 26.22 | 22.5-27 min | informational (delegating) |
| `eventsOfferedBy30MinMin` | 22.50 | ≥ 15 cards by 30 min | informational (delegating) |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | informational (delegating) |
| `eventsL1PlateauMin` | 4 | ≥ 3 decision cards from min 3 to L2 | informational (delegating) |
| `policyEvPerCard` | 21.05 | -20 to 40 $/card (events.json policy.evBand) | informational (delegating) |
| `policyNonDefaultShare` | 0.50 | ≥ 0.4 (events.json policy.nonDefaultShareMin) | informational (delegating) |
| `holdBayEventsPer10Min` | 16.170 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 7.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 30 min | informational |
| `payrollShareOfGross` | 0.280 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 39.500 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 3.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 1.000 | malware the sorter left as looks clean | informational |
| `hires` | 7.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 1.000 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `overseasCleared` | 15.000 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 21.810 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 26.220 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 6/6 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 6 · completed 6 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 6 · completed 2 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 12 · completed 9 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 8 · completed 1 · failed 7 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 5 · completed 4 · failed 1 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 9 · completed 0 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 5 · completed 2 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 3 · completed 3 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 6/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 46 · underworld 22 · cityhall 18 · port 17 · weather 16 · fleet 16 · money 14 · customers 13 · tech 12 · press 12 · staff 10 · luck 10 · security 6 | cards offered per category, all seeds | informational |
| `chainsStarted` | 23 / 23 | chains started / finished, all seeds | informational |
| `modifiersActiveMax` | 2.500 | most modifiers live at once | informational |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational |
| `eventLivesGained` | median 0.0 (4) | lives events gave (all seeds in brackets) | informational |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational |
| `deckEvMean` | -30.880 | mean state-free score over every option of every card ($) | informational |
