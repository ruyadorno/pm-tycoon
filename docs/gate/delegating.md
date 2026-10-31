# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · events on · data `6c7f8631`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.06 | 2.49 | 0 | 0.0 | 8.94 | 18.67 | 150.5 | 10 | 11.0% | 26.5 | 47/6/0 | 5 | 1 | 1 | 15.96 | 2.47 | 20.59 | 25.78 | 25.78 | 18 | 3 | 14.2 | 0.61 | PASS |
| 2 | 55.6 | 185.4 | 10.06 | 7.12 | 2 | 0.0 | 9.94 | 18.67 | 185.4 | 9 | 11.0% | 26.7 | 45/3/2 | 7 | 3 | 1 | 17.81 | 2.81 | 21.72 | 26.97 | 26.97 | 23 | 4 | 4.8 | 0.44 | PASS |
| 3 | 52.0 | 201.3 | 10.16 | 4.78 | 1 | 0.0 | 12.80 | 14.00 | 201.3 | 10 | 11.0% | 27.1 | 28/3/1 | 5 | 3 | 1 | 17.62 | 2.96 | 21.83 | 26.64 | 26.64 | 18 | 3 | 4.6 | 0.57 | PASS |
| 4 | 48.8 | 163.6 | 9.32 | 2.54 | 0 | 0.0 | 5.36 | 25.00 | 163.6 | 13 | 11.0% | 24.7 | 69/11/0 | 6 | 4 | 1 | 14.54 | 3.42 | 17.96 | 22.05 | 22.05 | 28 | 3 | 11.4 | 0.35 | PASS |
| 5 | 60.8 | 176.5 | 11.79 | 5.94 | 0 | 0.0 | 11.88 | 12.00 | 176.5 | 10 | 9.5% | 30.4 | 22/3/1 | 6 | 3 | 1 | 19.49 | 2.35 | 25.73 | — | — | 22 | 5 | 22.0 | 0.57 | PASS |
| 6 | 36.0 | 181.5 | 11.68 | 5.02 | 1 | 0.0 | 4.28 | 18.33 | 181.5 | 3 | 11.0% | 25.0 | 45/2/0 | 6 | 3 | 1 | 18.78 | 2.14 | 22.09 | 24.72 | 24.72 | 20 | 3 | 9.3 | 0.36 | PASS |
| 7 | 31.5 | 180.1 | 12.45 | 8.64 | 2 | 0.0 | 8.83 | 11.33 | 180.1 | 6 | 9.5% | 33.0 | 22/1/2 | 6 | 3 | 1 | 21.94 | 2.00 | 26.95 | — | — | 20 | 5 | 44.1 | 0.67 | PASS |
| 8 | 37.8 | 205.7 | 11.59 | 0.63 | 0 | 0.0 | 9.49 | 16.33 | 205.7 | 10 | 11.0% | 26.0 | 37/3/0 | 5 | 1 | 1 | 17.60 | 2.98 | 22.39 | 26.03 | 26.03 | 23 | 3 | 39.2 | 0.65 | PASS |
| 9 | 36.3 | 165.5 | 10.41 | 3.08 | 0 | 0.0 | 3.84 | 15.67 | 165.5 | 4 | 11.0% | 25.5 | 42/2/0 | 5 | 2 | 1 | 16.14 | 2.58 | 21.44 | 25.28 | 25.28 | 22 | 2 | 30.5 | 0.61 | PASS |
| 10 | 34.5 | 153.1 | 9.41 | 1.50 | 2 | 0.0 | 7.44 | 24.00 | 153.1 | 5 | 11.0% | 25.1 | 63/2/1 | 7 | 4 | 1 | 14.38 | 2.51 | 18.06 | 21.91 | 21.91 | 21 | 2 | 23.7 | 0.64 | PASS |
| **median** | 43.3 | 178.3 | 10.29 | 3.93 | 1 | 0.0 | 8.89 | 17.33 | 178.3 | 10 | 11.0% | 26.0 | 43.5/3/0.5 | 6 | 3 | 1 | 17.61 | 2.55 | 21.78 | 25.91 | 25.91 | 21.5 | 3 | 18.1 | 0.59 | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 10.29 | 7-13.5 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 3.93 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 0.50 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 8.89 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 3 | ≥ 2 by 30 min | informational (delegating) |
| `level3Min` | 17.61 | 13.5-18 min | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.55 | ≤ 3 min after L3 | informational (delegating) |
| `level4Min` | 21.78 | 18-22.5 min | informational (delegating) |
| `level5Min` | 25.91 | 22.5-27 min | informational (delegating) |
| `eventsOfferedBy30MinMin` | 21.50 | ≥ 15 cards by 30 min | informational (delegating) |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | informational (delegating) |
| `eventsL1PlateauMin` | 3 | ≥ 3 decision cards from min 3 to L2 | informational (delegating) |
| `policyEvPerCard` | 18.08 | -20 to 40 $/card (events.json policy.evBand) | informational (delegating) |
| `policyNonDefaultShare` | 0.59 | ≥ 0.4 (events.json policy.nonDefaultShareMin) | informational (delegating) |
| `holdBayEventsPer10Min` | 17.330 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 9.500 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 30 min | informational |
| `payrollShareOfGross` | 0.260 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 43.500 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 3.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.500 | malware the sorter left as looks clean | informational |
| `hires` | 7.500 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 0.500 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `overseasCleared` | 15.500 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 23.240 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 25.910 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 7/7 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 7 · completed 7 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 7 · completed 2 · failed 5 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 11 · completed 9 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 7 · completed 0 · failed 7 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 11 · completed 0 · failed 4 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 6 · completed 4 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 1 · failed 3 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 4 · completed 4 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 1 · completed 0 · failed 0 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 5/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 47 · underworld 33 · customers 32 · staff 22 · fleet 18 · money 14 · cityhall 10 · luck 9 · security 9 · weather 8 · press 6 · tech 5 · port 2 | cards offered per category, all seeds | informational |
| `chainsStarted` | 15 / 13 | chains started / finished, all seeds | informational |
| `modifiersActiveMax` | 3.000 | most modifiers live at once | informational |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational |
| `eventLivesGained` | median 0.0 (4) | lives events gave (all seeds in brackets) | informational |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational |
| `deckEvMean` | -33.860 | mean state-free score over every option of every card ($) | informational |
