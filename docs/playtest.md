# Reading `playtest.json`

`playtest.json` is the profile of one run: what happened, when, and how the phone coped. The recorder is
`src/metrics/playtest.ts` (plan.md §12.9, M4 task 1); `tests/metrics/playtest-schema.test.ts` pins every field and type,
and `tests/playtest/seed-7.json` is a real example written by `vlr shots` from a 12-minute automated run (seed 7, the
§7 policy). Nothing is sent anywhere: the file stays on the device until you download or copy it.

## Where to find it

| Where         | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary card  | Tap ❚❚ to pause, then ❚❚ again while paused: the pause menu → **End run — show summary** (Space only toggles pause); the Game Over card has a **Run summary** button, and a ticker line offers the card once at 20:00 of play (Q55). **Download playtest.json** saves the file (on the iPhone: Safari's Downloads, then Files or AirDrop); **Copy summary** copies the card as plain text.                                                                                                                                                                |
| Debug console | With `?debug=1`: `__pm.playtest()` returns the live object, `__pm.downloadPlaytest()` saves it. On the iPhone the console is Safari Web Inspector (iPhone: Settings → Apps → Safari → Advanced → Web Inspector; Mac Safari: Develop → your iPhone → the page).                                                                                                                                                                                                                                                                                            |
| localStorage  | Key `pm.playtest.v1` on the page's origin (a `?config=<name>` session: `pm.playtest.v1:cfg:<name>`, e.g. `:cfg:spicy`), written every 10 s and when the tab hides. Desktop console: `copy(localStorage['pm.playtest.v1'])` (spicy: `copy(localStorage['pm.playtest.v1:cfg:spicy'])`). It also holds a `restore` record (fps histogram, event counters) so a reload resumes the same profile; the download and `__pm.playtest()` leave it out. Title → **Reset** clears every profile with the saves (`pm.save.v2`, `pm.save.v2:cfg:<name>`) and settings. |

The origin matters: `http://localhost:4173` and `http://<mac-lan-ip>:4173` are different origins with separate storage.

## Units

- Every field ending in `S` is **sim seconds** (ticks ÷ 10), except `elapsedS` and `pausedS`, which are **wall-clock
  seconds**. At 1× speed one sim second is one real second; at 2× it is half of one.
- One **in-game minute** = one **in-game day** = 60 sim seconds (spec §2): payday, satisfaction drift and the daily
  ticker line happen on that boundary. A twenty-minute session at 1× is about twenty in-game days.
- `null` means "not reached" (no truck bought yet, level 2 not reached, …), never zero.
- Money is in game dollars, integers.

## Fields

| Field                   | Type          | Meaning                                                                                                                                                                                                                                                                                                      | Fun bar   |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `version`               | `1`           | Schema version of the file.                                                                                                                                                                                                                                                                                  |           |
| `buildStamp`            | string        | `<short sha> <date>` of the build, plus ` cfg:<name>` when a `?config=` override was active (a `cfg:spicy` profile is not a cold run).                                                                                                                                                                       |           |
| `seed`                  | int           | Sim seed of the run (`?seed=N` reproduces the world, not your choices).                                                                                                                                                                                                                                      |           |
| `startedAt`             | ISO 8601 UTC  | Wall-clock start of the run.                                                                                                                                                                                                                                                                                 |           |
| `device`                | object        | `ua` (browser user agent), `cssW`/`cssH` (viewport in CSS px), `dpr` (device pixel ratio), `zoom` (integer canvas zoom, 1 below 720 CSS px wide), `maxTexture` (GPU max texture size; the ground bake needs ≥ 4096).                                                                                         |           |
| `elapsedS`              | wall s        | Real time the run has been on screen: wall seconds while the page is visible, paused time included, a hidden tab not counted (a frame gap counts at most 1 s); it carries over a Continue of the same run.                                                                                                   | (4)       |
| `simS`                  | sim s         | Sim time played.                                                                                                                                                                                                                                                                                             |           |
| `pausedS`               | wall s        | The part of `elapsedS` spent with the sim held (pause, the Paused card after backgrounding, the lost-life and summary cards).                                                                                                                                                                                |           |
| `firstDeliveryS`        | sim s \| null | First `parcel:delivered`.                                                                                                                                                                                                                                                                                    | (1)       |
| `firstMalware`          | object        | `spawnedS` = when the first malware parcel spawned; `caughtS` (flagged by a checker), `by` (`inspector` or the machine id that flagged it) and `tossedS` (when you tossed it) describe the first malware a checker caught, which can be a later parcel if the first slipped through. Any part can be `null`. | (2)       |
| `level2AtS`             | sim s \| null | `level:up {2}`.                                                                                                                                                                                                                                                                                              | (3)       |
| `truckBoughtS`          | sim s \| null | First truck bought (L2 unlock).                                                                                                                                                                                                                                                                              |           |
| `deliveries`            | object        | `total`, `onTime` (paid ≥ 75 % of base, ≤ 160 s), `late`, `byType` `{bike, van, truck}` (the vehicle that carried the parcel on its last leg).                                                                                                                                                               |           |
| `moneyPerMin`           | int[]         | Gross income per completed in-game minute (deliveries + toss bounties), index 0 = minute 1. The curve's slope is the "is it growing" signal.                                                                                                                                                                 |           |
| `lifetimeEarned`        | $             | Lifetime earned at the end (drives the level bar).                                                                                                                                                                                                                                                           |           |
| `balanceEnd`            | $             | Cash at the end.                                                                                                                                                                                                                                                                                             |           |
| `malware`               | object        | `spawned`, `caught` (flagged by a checker), `missed` (delivered = a lost life), `tossedClean` (wrong tosses: clean parcels binned), `cleared` (malware parcels you Cleared out of the Hold Bay — mistakes).                                                                                                  | (2), (5)  |
| `livesLost`             | object[]      | One entry per lost life: `atS`, `label` (the parcel's package label), `strain`, `laneRate` (the lane's catch rate for that strain when it passed), `counter` (the machine that counters the strain), `clearedByPlayer` (you pressed Clear on it).                                                            | (5)       |
| `vehiclesBought`        | object[]      | `{type, atS}` per purchase, in order.                                                                                                                                                                                                                                                                        |           |
| `inspectorsHired`       | int           | Inspectors hired beyond the starting one.                                                                                                                                                                                                                                                                    |           |
| `machinesBought`        | object[]      | `{id, atS}` per machine bought.                                                                                                                                                                                                                                                                              |           |
| `taps`                  | int           | Canvas `pointerdown`s (every touch, HUD included).                                                                                                                                                                                                                                                           |           |
| `tapsPerMin`            | number        | `taps` per minute of `elapsedS` — how busy the hands were.                                                                                                                                                                                                                                                   |           |
| `rushTaps`              | int           | Buildings rushed.                                                                                                                                                                                                                                                                                            |           |
| `viewSwitches`          | int           | City ⇄ Warehouse switches.                                                                                                                                                                                                                                                                                   |           |
| `warehouseS`            | sim s         | Time spent in the Warehouse view.                                                                                                                                                                                                                                                                            |           |
| `fps`                   | object        | `p50` and `p5` (median and slowest-5 % of the per-second frame-rate samples), `min`, `samples` (count).                                                                                                                                                                                                      | perf (R4) |
| `holdBayEvents`         | int           | Parcels that reached the Hold Bay (`parcel:held`): the Toss/Clear decisions you were offered.                                                                                                                                                                                                                |           |
| `holdBayEventsPer10Min` | number        | `holdBayEvents` normalised by `simS` (gate target ≥ 6 at L1).                                                                                                                                                                                                                                                |           |
| `stalls`                | object        | Lane stalls (Hold Bay full / shelf full / jammed buffer): `count`, `totalS`.                                                                                                                                                                                                                                 |           |
| `payroll`               | object        | Paydays `paid`, paydays `short` (someone unpaid), `walkouts`.                                                                                                                                                                                                                                                |           |
| `satisfactionEnd`       | object        | Satisfaction 0–100 per live district at the end (`highres`, `downtown`, `industrial` once unlocked).                                                                                                                                                                                                         |           |

## The fun bar (decision #15, plan.md §12.9)

A cold, solo, **twenty-minute** play on the iPhone passes when:

1. **First delivery under a minute** — `firstDeliveryS < 60`.
2. **The first malware is caught by a checker by 5:00** — `firstMalware.caughtS ≤ 300` (the scripted one spawns from
   ~2:00 on and is always caught; a `null` here means it never arrived or the run ended first).
3. **Level 2 between 8 and 15 minutes** — `480 ≤ level2AtS ≤ 900`.
4. **You kept playing past 15 minutes** — `elapsedS > 900` at the moment you first opened the summary card (the recorder keeps that moment; the card reads it). Only you can
   judge whether you _wanted_ to.
5. **Every lost life is explainable** — every `livesLost[]` entry has a `counter` or `clearedByPlayer: true`, _and_ the
   lost-life card made sense to you when it appeared.

The summary card shows the same five as pass / fail (`pending` while a window is still open; item 5 reads "you judge" when every loss is explainable, because only you know whether the card made sense). Items 1–3 are what the sim gate already predicts for a
competent player (docs/gate/latest.md, seeds 1–10 medians: first delivery 44 s, scripted catch 174 s, L2 13.05 min);
4 and 5 only a human can answer.

## Reading a profile

- **Pacing**: compare `firstDeliveryS`, `firstMalware.caughtS`, `level2AtS` and `truckBoughtS` with the gate medians
  above. A late L2 with a flat `moneyPerMin` means the fleet stayed small; check `vehiclesBought`.
- **Decisions**: `holdBayEvents` vs `malware.tossedClean` and `malware.cleared` shows how you treated flagged parcels
  (toss everything, or read the labels). `rushTaps` and `viewSwitches` show how much you dispatched vs watched.
- **Pressure**: `stalls.totalS`, `payroll.short`/`walkouts` and `satisfactionEnd` show where the run hurt.
- **Phone performance (R4)**: `fps.p50 < 50` or `fps.p5 < 30` triggers the cut order of plan.md §12.8 (mood overlays
  off → popups halved → smoke off → badges only when rushed → static wheels, `src/render/quality.ts`). `device.zoom`
  should be 1 on the iPhone 16 (393 CSS px) and `device.maxTexture` ≥ 4096.
- **Not a cold run**: `buildStamp` ending in `cfg:spicy`, or a `seed` you typed, means a debug session.

Send the file (or the copied summary) with your notes; together with the seed it is enough to replay the world
headless (`vlr sim -- --seed <seed> --minutes 20`) and compare your run with the policy's.
