# Sim gate — PASS

`vlr sim:delegating` · seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 × 30 min · policy `delegating` · events off · data `65a18544`

policy weights ($): money 1 · life 600 (the last −∞) · sat/pt 6 · vehicle gain ×0.5 · quit 200 · absent/day 60 · wanted 80 · cap 1 · chain -20 · parcels spawn ×1 lost 20 · pips eye 150 judgement 100 speed 120 pace 60 energy 60 charisma 40 · mod speed 500 stop 150 inspectorP 900 machineP 500 processS 150 payrollMult 120 payrollAdd 1 income 350 malwareShare 1500 decoyShare 150 spawn 300 tossBounty 40 wrongTossFee 20 vehiclePrice 150 machinePrice 120 onTimeMaxS 1 clearanceS 80 shelfCap 1 · evBand -20…40 · evMax 400 · nonDefault ≥ 0.4.

Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). The `delegating` policy (spec-build2 §7.2) is informational: only an invariant fails it; null = never happened.

| seed | firstDel_s | catch_s | L2_min | truck+min | lives | shelfStall_s | hold/10m@L1 | hold/10m | script_s | wrong | mal@end | pay% | sorter d/w/m | qOff | qDone | q7-13 | L3_min | ovs+min | L4_min | L5_min | GR_min | cards | L1dec | EV$ | nonDef | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 54.3 | 150.5 | 10.06 | 3.77 | 1 | 0.0 | 8.94 | 17.67 | 150.5 | 7 | 11.0% | 28.3 | 44/3/1 | 6 | 2 | 1 | 16.95 | 3.01 | 21.09 | 26.58 | 26.58 | 5 | 0 | — | — | PASS |
| 2 | 55.6 | 185.4 | 10.20 | 5.25 | 3 | 0.0 | 7.85 | 15.00 | 185.4 | 9 | 11.0% | 28.2 | 36/4/1 | 7 | 2 | 1 | 17.23 | 3.19 | 21.94 | 26.94 | 26.94 | 5 | 0 | — | — | PASS |
| 3 | 52.0 | 201.3 | 10.73 | 3.79 | 0 | 0.0 | 10.25 | 16.33 | 201.3 | 11 | 11.0% | 25.5 | 37/5/0 | 5 | 3 | 1 | 17.25 | 1.60 | 20.38 | 25.16 | 25.16 | 4 | 0 | — | — | PASS |
| 4 | 48.8 | 163.6 | 9.70 | 2.27 | 5 | 0.0 | 3.09 | 14.33 | 163.6 | 3 | 11.0% | 31.0 | 35/2/4 | 5 | 4 | 1 | 14.90 | 3.93 | 18.87 | 23.09 | 23.09 | 4 | 0 | — | — | PASS |
| 5 | 60.8 | 176.5 | 12.21 | 3.36 | 1 | 0.0 | 9.01 | 19.00 | 176.5 | 5 | 11.0% | 29.3 | 45/0/1 | 6 | 3 | 1 | 17.42 | 2.62 | 20.30 | 25.72 | 25.72 | 5 | 0 | — | — | PASS |
| 6 | 36.0 | 181.5 | 10.78 | 2.49 | 2 | 0.0 | 5.56 | 18.00 | 181.5 | 8 | 11.0% | 24.2 | 48/5/2 | 7 | 3 | 1 | 16.27 | 2.38 | 19.74 | 24.34 | 24.34 | 5 | 0 | — | — | PASS |
| 7 | 31.5 | 180.1 | 11.40 | 5.45 | 0 | 0.0 | 6.14 | 15.00 | 180.1 | 7 | 11.0% | 28.5 | 38/3/0 | 6 | 2 | 1 | 18.06 | 3.90 | 23.12 | 27.91 | 27.91 | 5 | 0 | — | — | PASS |
| 8 | 37.8 | 205.7 | 11.30 | 6.64 | 1 | 0.0 | 6.20 | 11.33 | 205.7 | 5 | 9.5% | 32.2 | 27/1/0 | 5 | 1 | 1 | 19.88 | 6.18 | 24.58 | — | — | 5 | 0 | — | — | PASS |
| 9 | 36.3 | 165.5 | 10.41 | 2.39 | 0 | 0.0 | 3.84 | 17.33 | 165.5 | 7 | 11.0% | 22.2 | 47/5/0 | 5 | 2 | 1 | 15.72 | 2.86 | 20.51 | 24.05 | 24.05 | 4 | 0 | — | — | PASS |
| 10 | 34.5 | 153.1 | 9.09 | 2.73 | 0 | 0.0 | 7.70 | 23.33 | 153.1 | 6 | 11.0% | 22.4 | 62/3/0 | 7 | 5 | 1 | 14.32 | 2.76 | 18.68 | 22.98 | 22.98 | 5 | 0 | — | — | PASS |
| **median** | 43.3 | 178.3 | 10.57 | 3.57 | 1 | 0.0 | 6.95 | 16.83 | 178.3 | 7 | 11.0% | 28.0 | 41/3/0.5 | 6 | 2.5 | 1 | 17.09 | 2.93 | 20.45 | 25.44 | 25.44 | 5 | 0 | — | — | **PASS** |

| window | median | target | result |
| --- | --- | --- | --- |
| `firstDeliveryS` | 43.30 | < 60 s | informational (delegating) |
| `firstMalwareCaughtMaxS` | 178.30 | ≤ 300 s | informational (delegating) |
| `level2Min` | 10.57 | 7-13.5 min | informational (delegating) |
| `truckAfterLevel2MaxMin` | 3.57 | ≤ 4 min | informational (delegating) |
| `maxLivesLost` | 1 | ≤ 0 | informational (delegating) |
| `maxShelfStallS` | 0 | ≤ 0 s | informational (delegating) |
| `holdBayEventsPer10MinMin` | 6.95 | ≥ 6 /10 min at L1 | informational (delegating) |
| `questsOfferedBy30MinMin` | 6 | ≥ 4 by 30 min | informational (delegating) |
| `questsCompletedBy30MinMin` | 2.50 | ≥ 2 by 30 min | informational (delegating) |
| `level3Min` | 17.09 | 13.5-18 min | informational (delegating) |
| `firstOverseasClearedAfterLevel3MaxMin` | 2.93 | ≤ 3 min after L3 | informational (delegating) |
| `level4Min` | 20.45 | 18-22.5 min | informational (delegating) |
| `level5Min` | 25.44 | 22.5-27 min | informational (delegating) |
| `eventsOfferedBy30MinMin` | 5 | ≥ 15 cards by 30 min | informational (delegating) |
| `eventsOpenMaxTicks` | 0 | ≤ 1 tick open | informational (delegating) |
| `eventsL1PlateauMin` | 0 | ≥ 3 decision cards from min 3 to L2 | informational (delegating) |
| `policyEvPerCard` | — | -20 to 40 $/card (events.json policy.evBand) | informational (delegating) |
| `policyNonDefaultShare` | — | ≥ 0.4 (events.json policy.nonDefaultShareMin) | informational (delegating) |
| `holdBayEventsPer10Min` | 16.830 | whole run | informational |
| `scriptedCaughtS` | 178.300 | flag time of the scripted malware | informational |
| `wrongTosses` | 7.000 | clean parcels tossed (Toss-everything) | informational |
| `malwareShareAt30Min` | 0.110 | share at 30 min | informational |
| `payrollShareOfGross` | 0.280 | ≤ 0.25 (payroll paid ÷ gross income at 30 min) | informational |
| `sorterDecisions` | 41.000 | Hold Bay sorter calls | informational |
| `sorterWrongToss` | 3.000 | clean parcels the sorter tossed | informational |
| `sorterMissed` | 0.500 | malware the sorter left as looks clean | informational |
| `hires` | 7.000 | hires (not re-hires) | informational |
| `delegatingLivesLost` | 1.000 | lives lost trusting the sorter (B2 §7.3) | informational (delegating) |
| `overseasCleared` | 14.000 | overseas clearances (parcel:cleared, malware included) | informational |
| `overseasLivesLost` | 0.000 | lives lost at a clearance (the ship has sailed) | informational |
| `dock2Min` | 21.670 | minute loading dock 2 is bought | informational |
| `dock3Min` | — | minute loading dock 3 is bought | informational |
| `armTosses` | 0.000 | Hold Bay parcels the Sorter Arm tossed (L4 plan) | informational |
| `goldenReleaseOfferedMaxMin` | 25.440 | ≤ 29 min (seeds 1-10 × 35 min, --minutes 35) | informational |
| `victoryMaxMin` | — | ≤ 40 min (seeds 1-3 × 45 min, the long test) | informational |
| `questActive7to13` | 10/10 seeds | a quest active between minutes 7 and 13 on ≥ 8/10 seeds (plan-build2 §8.4) | informational |
| `magicOnTime` | 7/7 | golden parcels delivered on time / spawned (all seeds) | informational |
| `quest:magic_parcel` | offered 7 · completed 7 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:on_time_day` | offered 5 · completed 1 · failed 4 · declined 0 | per template, all seeds | informational |
| `quest:rush_district` | offered 10 · completed 8 · failed 2 · declined 0 | per template, all seeds | informational |
| `quest:big_haul` | offered 8 · completed 1 · failed 6 · declined 0 | per template, all seeds | informational |
| `quest:customs_run` | offered 5 · completed 5 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:golden_release` | offered 12 · completed 0 · failed 5 · declined 0 | per template, all seeds | informational |
| `quest:cheer_up` | offered 6 · completed 1 · failed 5 · declined 0 | per template, all seeds | informational |
| `quest:night_shift` | offered 4 · completed 2 · failed 1 · declined 0 | per template, all seeds | informational |
| `quest:inspector_general` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `quest:clean_sweep` | offered 1 · completed 1 · failed 0 · declined 0 | per template, all seeds | informational |
| `livesLostShare` | 6/10 seeds | seeds that lost a life to malware (the 40-seed share: ≤ 35 %) | informational |
| `eventsByCategory` | job 47 | cards offered per category, all seeds | informational (decisions off) |
| `chainsStarted` | 0 / 0 | chains started / finished, all seeds | informational (decisions off) |
| `modifiersActiveMax` | 0.000 | most modifiers live at once | informational (decisions off) |
| `eventLivesLost` | median 0.0 (0) | lives events took (all seeds in brackets) | informational (decisions off) |
| `eventLivesGained` | median 0.0 (0) | lives events gave (all seeds in brackets) | informational (decisions off) |
| `eventVehiclesLost` | median 0.0 (0) | vehicles events took (all seeds in brackets) | informational (decisions off) |
| `eventWorkersLost` | median 0.0 (0) | workers events took (all seeds in brackets) | informational (decisions off) |
| `eventGameOvers` | 0/10 seeds | runs an event ended | informational (decisions off) |
| `deckEvMean` | -62.830 | mean state-free score over every option of every card ($) | informational |
