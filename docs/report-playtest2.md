# Playtest 2 — end-of-run report

Package Management Tycoon build 2: company levels 1 → 5, hired people, quests, the Golden Release and endless mode,
built in one autonomous run on 2026-10-30 (00:46 UTC, 9c32062 → the M10 commit 13245fd) from
plans/pm-tycoon/plan-build2.md (DRAFT v2) and spec-build2.md (cited `B2 §N`). Node v26, vlt 1.6.1, Phaser 4.2.1,
Chromium (Chrome for Testing, SwiftShader WebGL) with the Playwright `iPhone 16` profile. Sources for every number
below: docs/status.md (M5–M9 entries), docs/decisions.md, docs/art-todo.md, docs/gate/{latest,latest-35min,delegating}.md,
the M10 integration and review-fix verification logs (`.logs/`, local to the VM), `art/manifest.json` and
`tests/playtest/seed-7.json`.

**What to do first:** serve the build (§2.1), play **thirty to forty minutes cold** on the iPhone 16, open the summary
card when it is offered at 30:00 (or from the pause menu), download `playtest.json`, then read §6 (rough edges), §7
(decisions to confirm) and §9 (art approvals). §8 maps each of your playtest-1 notes F1–F12 to what shipped.

## 1. What was built

**M5 — foundations and your fixes** (DONE at 67fd97a, 02:38 UTC)

- The Title is an overlay over an attract-mode City (B2 §5): your logo (`tools/art/logo.ts`, 352×176, Q-B2-1) over a
  demo city replayed from `src/assets/attract.json` (seed 7, competent policy), a camera tour
  (`src/render/AttractCamera.ts`), only New game / Reset / Credits as UI; Continue and New game swap in the real sim
  under a fade.
- F2–F5: the warehouse slab, ramp and bollards stamped on the ground bake under apron-less exteriors (lint A04 strict,
  B2 §6.1); a courier on a bicycle with a helmet on a 32×32 canvas (B2 §6.2, Q-B2-14); the pickup hop sinking into the
  vehicle body by crop (B2 §6.3); the modern port (`dk_terminal_a/b`, `dk_port_office`; `dk_pier` and `dk_customs`
  rejected with your reasons and retired, B2 §6.4).
- Two atlases (`world`, `interior`) behind content-hashed URLs (B2 §6.8, report-1 §6.21); save v2 with a key per
  `?config=` (report-1 §6.13).
- Report-1 rough edges fixed: pause menu on the modal stack (§6.5), ticker pacing (§6.6), Credits card modal (§6.11),
  Enter on Game Over opens the summary (§6.12), Garage and district sheets sized to their content (§6.14), one dust cloud
  per frame (§6.23), arm-raised inspector scan frames (§6.24).
- `economy.playtestMaxLevel` stayed 2; no sim or data change, so the gate equals M4's.

**M6 — people** (DONE at 1f0b631, 05:21 UTC)

- `employees.json` in the B2 §9 shape and `src/sim/systems/people.ts`: three applicants per role on their own RNG
  stream, a free daily refresh, pips → numbers, salaries and hire fees from the aggregate, ★ applicants that expire,
  hire / fire / Post an ad (B2 §2.1–§2.2, §2.7).
- Detection per inspector with same-desk charisma (cap 0.96), desk 2 at L3 for $400 (B2 §2.3–§2.4).
- `src/sim/systems/sorter.ts`: the Toss-only Hold Bay sorter (wanted list → certain Toss, judgement → Toss or a
  `looks clean` tag, a 2-s grace on the parcel under your finger) and the Sorter Arm in the same station (B2 §2.6, §2.8).
- Drivers from the same picker on every purchase, `Hire later`, Replace after the trip, speed / energy / charisma /
  affinity (B2 §2.5); payroll with sorters; `STATE_VERSION` 3.
- UI: HireSheet, the Garage driver picker and `···` row menu, StationCard, a desk card per inspector, the HoldBayCard
  hint, the lost-life card naming the person; procedural faces, pips, ★, `worker_sorter`, `hold_station`.
- The competent policy's applicant rules and the informational `delegating` policy (`vlr sim:delegating`, B2 §7.2).

**M7 — quests** (DONE at 11b6517, 08:20 UTC)

- `src/data/quests.json` and `src/sim/systems/quests.ts`: an offer from day 3 then every 2 days, a 1-day cooldown after a
  decline or expiry, one active quest, ten templates counted from sim events, rewards (cash into lifetime earned, lives up
  to 5, satisfaction, ★ applicants, vouchers), no penalty on a fail (B2 §3.1–§3.2, Q-B2-7, Q-B2-12).
- `src/sim/systems/magic.ts`: the golden parcel (busiest sender → a live district within 20 road tiles, skips the
  checkers, 120-s countdown, on time +1 life and $150; B2 §3.3, Q-B2-13).
- The Golden Release from `levels.json ultimateQuest`, `game:victory`, the endless ramp from Victory (B2 §3.4);
  `STATE_VERSION` 4.
- QuestCard, QuestChip, VictoryCard, the district panel's quest row, ticker lines, the QUEST COMPLETE stamp and SFX, the
  victory stinger, life slots 4–5, gold markers and countdown rings; `?quest=<id>` and `__pm.quests()` for debugging.

**M8 — L3 Regional** (DONE at 99ce939, 11:15 UTC)

- The level counter to 3 with the L3 row from data: the Docks live, the `battery` strain and Battery checker, Hold Bay
  5, shelf 60, tier 3, loading dock 2 for $800 (B2 §4.1).
- `src/sim/systems/hubs.ts`: overseas parcels handed off at a pier with their value locked, a 45-s clearance at the
  port office, malware costing its life only at clearance ("— the ship has sailed"), `hub:departure` (spec-core §5.6).
- Docks 2–3 (`buyDock`, a round-robin feed into slot 1, the Q-RUN1 relief per dock, two- and three-dock soak tests);
  `STATE_VERSION` 5.
- The tier-3 room (green epoxy, brick, the 20×5 shelf grid, roller pads for docks 2–3, the buy-dock dialog); the port in
  colour, the clearance ring, the ship departure; the overseas lost-life route; the policy's L3 plan plus REPLACE.
- The L5 region art was generated here (fogged until M9).

**M9 — L4 and L5 Tycoon** (DONE at bb5646e, 14:39 UTC)

- Level cap 5 (B2 §9). L4 National: Semver Street and Pasture Peer Fields live, X-ray, the Sorter Arm, the `dense`
  strain with typosquat labels, slot 5, shelf 80, dock 3, tier 4. L5 Tycoon: the Airport live (×2, S/M only, 20-s
  clearance, the plane departure), Monorepo Commons live, slot 6, shelf 100, tier 5 with neon (B2 §4.2–§4.3).
- The Golden Release offered on `level:up {5}`; Victory → endless with a ticker line; `Tycoon ✓` on the Title.
- Room growth 14 / 14 / 14 / 16 / 18 rows; the room scrolls vertically only when it does not fit, with the lane readout
  fixed above it (B2 §4.4).
- The policy's L4/L5 plan, NEW STRAIN FIRST and the Arm taking over the Hold Bay; the balance pass (§4); `dk_ship` and
  `xray` re-rolled; the G5/G6 contact sheets; a ✓ glyph in m5x7.

**M10 — playtest-2 build** (13245fd; this report's hand-off details are in the docs commit after it)

- `src/metrics/playtest.ts` v2 (`pm.playtest.v2`, plan-build2 §8.7 task 1): level 3–5 and Victory times, `hires[]`
  with a `cheapest` flag, fired, ads, sorter, quests by template, overseas, docks, desks, endless time;
  `tests/playtest/seed-7.json` from a 35-minute automated run.
- SummaryCard v2 with the fun bar 2 (plan-build2 §9); the offer at 30:00 game time, never before 25 real minutes.
- Configs: `spicy.json` gains a fast job board; the new `tycoon.json` carries a `start` recipe (L5, full lane and
  fleet) played by `src/boot/configStart.ts` in the browser and by `vlr sim -- --config` on the CLI.
- Build and docs: `tools/check-dist.mjs` checks both configs against an 8 MB budget; README and `playtest-README.txt`
  v2; docs/playtest.md, docs/phone-checklist.md and docs/art-todo.md for build 2; "Logo: Ruy Adorno" on the Credits card.
- Three review passes (sim, scenes, mobile): 17 of 19 findings fixed, 2 refuted. Fixed: the recorder dropping a second
  same-label loss on one tick; `debugForceLevel` booking ~$7,400 of fake income; the CLI ignoring a config's `start`
  recipe; `magic.skipsCheckers` never read; the rotate card hidden after any full-screen card (Phaser reuses freed
  camera ids: `src/ui/cameraBits.ts removeCamera`); a VictoryCard lost on reload; G and W working under the rotate card;
  a Paused card stacking under a card on its way; region chips unlocking off screen; money floats printed over each
  other; the 0.94-alpha top bar; the baseboard Rectangle (−2 draw calls); the summary offer before 25 real minutes.

**Not built**, as plan-build2 §3 says: belts (removed from the backlog, F6), a management scene, train, splitters,
traffic, day/night, bankruptcy, PWA, save migrations (v1 saves are discarded), landscape, minimap, a second music track.
Nothing in the plan-build2 §8.8 cut order was cut.

## 2. How to play

### 2.1 Get the build

Hand-off bundle: `dist-zip/pm-tycoon-13245fd.zip` (`vlr bundle` of `dist/` built from 13245fd), sent with this report and the shots
zip. Rebuild any time with `vlr build && vlr bundle` (remove the dev-only `public/gallery/` first, §6.30).

| Path                  | How                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Desktop devtools   | Serve `dist/` (path 2), open `http://localhost:4173/` in Chrome, devtools → device toolbar → **iPhone 16** (393 × 852, DPR 3), reload. At 393 × 852 the tier 4–5 rooms fit; add a custom 393 × 659 (or 360 × 604) device to see them scroll. |
| 2. iPhone via the Mac | Unzip, `cd dist && python3 -m http.server 4173`, open `http://<mac-lan-ip>:4173/` in Safari (same Wi-Fi; `ipconfig getifaddr en0`).                                                                                                          |
| 3. GitHub Pages       | `https://ruyadorno.com/pm-tycoon/` (still the playtest-1 build: the run's dispatch was refused, §12.1; run it once by hand). Actions → **Pages** → Run workflow (or `gh workflow run pages.yml`) redeploys `main`.                           |
| SSH tunnel            | Only with a route to the VM: `vlr preview -- --host` there, `ssh -g -L 4173:localhost:4173 <vm>` on the Mac, then the LAN URL on the phone.                                                                                                  |

Plain http works (localStorage, WebGL, the audio-unlock tap; no service worker). Each origin (`localhost`, the LAN
address, the Pages domain) keeps its own save and profile. README "How to serve on a phone" has the same steps.

### 2.2 The first minutes (the in-game text)

1. Onboarding step 1 points at the Garage: **"Buy a bike in the Garage and pick its driver"**; the picker asks
   **"Who drives the Bike?"** with three applicants (`Hire later` parks the bike as `No driver`).
2. Step 2: **"Your inspector catches 85% by hand. A Metal detector ($150) lifts the lane to 97%"**.
3. Step 3, once a building with waiting parcels is on screen: **"Tap a building with waiting parcels to rush a vehicle
   there"**. The first delivery pops a gold `DELIVERED +$20` (gate median 43.3 s).
4. The first flag: **"A parcel was flagged — open the warehouse to Toss or Clear it"**, then in the room **"Flagged
   parcels wait in the Hold Bay — tap one to Toss or Clear it"**; the scripted malware (from ~2:00) gets the red
   **"A parcel flagged — Toss it. Lives: 3"**, and the first Toss the hint about tins, marbles and chargers.
5. The job board opens on Day 4 (3:00 of game time) with a card: **Accept · Later · Decline**.

### 2.3 The brief: thirty to forty minutes cold, then the summary card

Play **thirty to forty minutes cold** (no debug flags, no help). The policy timeline puts L2 at ~12 min, L3 (the Docks
and the ship) at ~18, L4 at ~22 and L5 at ~28; a cold human is expected later. At **30:00 of game time, and never before
25 real minutes**, a ticker line and a toast offer the run summary; or tap **❚❚**, then **❚❚** again for the pause menu
→ **End run — show summary**. The Game Over and Victory cards have a **Run summary** button. Press **Download
playtest.json** and **Copy summary**.

| Fun-bar 2 item (plan-build2 §9)     | Read from                                             | Gate prediction (seeds 1–10, competent policy)                                    |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Hiring was a choice              | `hires[].cheapest` false ≥ 1, and you can say why     | the policy always pays for pips (seed 7: 7 of 7 not the cheapest); only you judge |
| 2. A quest done by 15:00            | `quests.firstCompletedS ≤ 900`                        | a quest active in minutes 7–13 on 10/10 seeds; seed 7's first done at 9:25        |
| 3. Level 3 between 15:00 and 22:00  | `level3AtS`                                           | 17.98 min median, 10/10 seeds in the window (15.36–19.59)                         |
| 4. Kept playing past 25:00          | `elapsedS > 1500` at the first opening of the card    | real minutes, not game time; only you can judge                                   |
| 5. Every lost life explained        | each `livesLost[]` has a counter, a sorter or a Clear | lives median 0 (2/10 seeds lose one); the card reads "you judge" when one is lost |
| 6. (stretch) L5 or Victory by 40:00 | `level5AtS`, `victoryAtS`                             | L5 27.70 min median (all 10 by 35 min); Victory not by 45 min on any seed (§10.4) |

docs/playtest.md explains every field; docs/phone-checklist.md is the device checklist for the same session.

### 2.4 Optional short sessions (after the cold run)

Both need `?debug=1` (the fps / draw-call overlay, 4× speed with key `4`, `window.__pm`) and each keeps its own save and
profile (`pm.save.v2:cfg:<name>`, `pm.playtest.v2:cfg:<name>`), so the cold run's stay untouched; a config profile's
`buildStamp` ends in `cfg:<name>`.

- **`?debug=1&config=spicy`** (`public/configs/spicy.json`): malware 9 % instead of 5 % at L1, decoys 30 % instead of
  22 %, a Hold Bay of 2 at L1–L2, and a job board that opens on Day 2 (1:00) and offers again one day after each job
  ends — a Hold Bay stall, a lost-life card and a quest within minutes.
- **`?debug=1&config=tycoon`** (`public/configs/tycoon.json`): every New game starts at L5 with the lane built (desk 1
  and desk 2 with two inspectors each, Metal detector, Shaky shaker, Battery checker, X-ray), the Sorter Arm, docks 2–3,
  3 bikes / 2 vans / 3 trucks with drivers, about $3,340 left of a $14,500 start; the Golden Release is on offer from the
  first minute. In Node runs, tapping Accept alone wins in 4.2–4.9 min on seeds 1–5 (§10.4).

### 2.5 URL parameters worth knowing (`src/debug/params.ts`)

| Param                     | Does                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `debug=1`                 | `window.__pm`, the overlay, 4× speed; enables `config=`, `level=`, `quest=`, gallery |
| `config=spicy` / `tycoon` | data override from `configs/<name>.json` (with `debug=1`)                            |
| `level=N`, `quest=<id>`   | a fresh game forced to level N; offer that quest on a fresh game (debug)             |
| `newGame=1`, `seed=N`     | ignore the autosave; the world of seed N (a new seed starts a fresh profile)         |
| `attract=0`               | the Title on a plain backdrop, no demo city                                          |
| `policy=1` / `delegating` | the competent / delegating scripted player drives the sim                            |
| `fastForward=S`           | run S sim seconds before the first frame                                             |
| `mute=1`, `audio=0`       | start muted / never create audio                                                     |
| `skipTitle=1`, `view=`    | skip the Title; open `city`, `warehouse` or `gallery` (gallery needs debug)          |

## 3. Screenshots

96 PNGs in `shots/` from the final `vlr shots` run (2026-10-30 16:43–16:51 UTC, HEAD bb5646e plus the M10 working
tree): 66 iPhone 16 (393 × 659 CSS, DPR 3; `city-hop-crop` is a crop), 3 desktop column (430 × 932, DPR 2), 23 min-fit
(360 × 604, DPR 3), 4 Gallery pages. The 33 shots in **bold** were read at the final tree against art/STYLE.md and the
view docs, for this report or by the M10 integration pass; the others carry the verdict of the milestone that made them
(docs/status.md, "Mn") and were regenerated under the same names, with passing e2e assertions. **96/96 PASS**; the notes
are cosmetic and listed in §6.

| Shot                                                              | Shows                                                                                                                                                                    | Verdict                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| m0-gallery, m0-hud, m0-map, m0-palette                            | Gallery: every atlas frame 1× over 2×, the HUD mock with hit boxes, the 48×48 map, the palette ramps                                                                     | PASS (M0, regenerated)                                         |
| **title.png**, title-430x932.png                                  | Your logo over the L5 demo city (seed 7 at 32:00, the glass HQ with its neon sign), New game / Reset / Credits, no HUD                                                   | PASS                                                           |
| **title-tycoon.png**, -360x604                                    | Continue line "Day 46 · $3,580 · Lv 5 · Tycoon ✓"                                                                                                                        | PASS                                                           |
| city-0s.png                                                       | New game at t = 0 on the lot, onboarding step 1 at the Garage                                                                                                            | PASS (M1, M6 text)                                             |
| **city-30s.png**, city-30s-430x932.png                            | Policy at 0:30: $91, Lv1 $0 / $2,000, the shed on its slab, chips, opaque top bar                                                                                        | PASS (Node Heights plate partly under the chips)               |
| city-first-delivery.png                                           | Gold `DELIVERED +$20` and the money float                                                                                                                                | PASS (M1)                                                      |
| city-zoom2.png                                                    | A followed bike at zoom 2, follow strip "Bike 1 · Sem" with speed pips                                                                                                   | PASS (M6)                                                      |
| city-rush.png, city-late-badge.png, city-locked.png               | Rush tooltip and ring; plain / amber / red waiting badges; fogged Hoist Hill with its board                                                                              | PASS (M1)                                                      |
| city-10min.png                                                    | Seed 7 at 10:00                                                                                                                                                          | PASS (M3)                                                      |
| city-lot-zoom2.png                                                | The lot at zoom 2 with the debug crosses on the slab corners, joints on the tile grid                                                                                    | PASS (M5)                                                      |
| **city-bike.png**                                                 | The courier on the orange bicycle, white helmet, cargo box, queued at the open dock door                                                                                 | PASS                                                           |
| city-hop.png, **city-hop-crop.png**                               | ~210 ms into a pickup: the parcel icon cropped down into the cargo box                                                                                                   | PASS                                                           |
| garage.png, garage-430x932.png                                    | Garage with driver pips and the `···` row menu, sized to its rows                                                                                                        | PASS (M5, M6)                                                  |
| garage-zone-picker.png                                            | Any / Node Heights / Registry Row, locked rows greyed                                                                                                                    | PASS (M1)                                                      |
| **garage-driver-picker.png**                                      | "Who drives the Bike?": Mo, Sem, Kit with speed / energy / charisma pips, ×speed · stop, likes, $/day · fee, Hire later                                                  | PASS                                                           |
| district-panel.png, district-panel-quest.png                      | District panel sized to content; the Rush hour row "1/6 · 2d 11h"                                                                                                        | PASS (M5, M7)                                                  |
| paused.png                                                        | Scrim, "Paused — tap to resume", End run — show summary                                                                                                                  | PASS (M4)                                                      |
| **warehouse-l1.png**, -360x604                                    | Tier-1 room, inspector at the desk, detector, locked station outline "Lv2", the slots 5–6 marker, shelf 0/30                                                             | PASS (payday toast over the incident sign)                     |
| warehouse-catch, -holdcard, -stalled, -buysheet (each + -360x604) | 300 ms into a catch; the HoldBayCard; Hold Bay at cap; the BuySheet                                                                                                      | PASS (M2–M3)                                                   |
| lost-life.png, -360x604                                           | "Slot 1 desk — Audrey: …" with the better-counter line                                                                                                                   | PASS (M6)                                                      |
| game-over.png, -360x604                                           | GAME OVER stats, New game + Run summary                                                                                                                                  | PASS (M4)                                                      |
| level-up.png                                                      | L2 dust frame 2 (one cloud) and the LEVEL stamp                                                                                                                          | PASS (M5; the cloud reads flat, §6.21)                         |
| industrial-unlocked, newspaper, shield-popover, payroll-short     | Hoist Hill after the fade; the level newspaper; the shield rows; $0 at payday with the Garage "!"                                                                        | PASS (M3)                                                      |
| warehouse-tier2.png, warehouse-l2.png (each + -360x604)           | The tier-2 cross-fade with slot 4; the L2 lane with the shaker                                                                                                           | PASS (M5, M3)                                                  |
| **summary-card.png**                                              | The 35-min seed-7 card: 14 rows (Level 2 · 3 · 4 · 5 at 11:53 · 17:57 · 22:43 · 27:52, hires 7, quests 7 · 3 · 3, overseas 17 · 0), fun bar 2 ? ✓ ✓ ✗ ✓ ✓                | PASS ("1:47 played" is the real-time part; item 4 ✗ by design) |
| **summary-card-360x604.png**                                      | The 10-min card at 360 × 604: Level 3 and the stretch "not yet", quest done at 9:25                                                                                      | PASS for layout ("0:01 played", §6.12)                         |
| docks-locked.png                                                  | The fogged modern port as `_locked` sprites                                                                                                                              | PASS (M5)                                                      |
| **hire-sheet.png**, -360x604                                      | "Hire an inspector": Fay, Cass, Sol with pips, catch % · s, false-flag, $/day · fee, Post an ad $30, "New faces in 0:59"                                                 | PASS                                                           |
| warehouse-two-desks.png, warehouse-desk2-card.png                 | Desks in slots 1 and 3, desk 2 at 0.87 / 0.96; desk 2's card                                                                                                             | PASS (M6)                                                      |
| **station-sorter.png**, station-card.png                          | The orange-vest sorter at the station, the S on the rack lamp; the StationCard                                                                                           | PASS                                                           |
| **holdcard-sorter-hint.png**, -360x604                            | "Mo: looks clean (85%)" on `babelcli`, a malware label: the sorter's wrong call is the player's to catch                                                                 | PASS                                                           |
| **quest-offer.png**, -360x604                                     | JOB BOARD "Rush hour", Accept · Later · Decline; the chip "New job"                                                                                                      | PASS                                                           |
| quest-chip.png                                                    | The gold quest bar "4/10 · 1d 19h"                                                                                                                                       | PASS (M7)                                                      |
| **magic-parcel.png**                                              | The 2:00 golden-parcel chip, gold markers and rings at A and B                                                                                                           | PASS                                                           |
| **quest-complete.png**                                            | "QUEST COMPLETE +1 life +$150", "+1 life — 4 of 5", the Special Delivery paper; floats +$170 / −$209 side by side                                                        | PASS                                                           |
| victory-card.png, -360x604                                        | The debug VictoryCard: TYCOON, six stats, three buttons                                                                                                                  | PASS (M7)                                                      |
| level-up-3.png                                                    | "LEVEL 3 — REGIONAL" over the dust, the Docks chip NEW                                                                                                                   | PASS (M8)                                                      |
| **docks-live.png**                                                | The port in colour: port office with radar, reach-stacker terminal, gantry terminal, the ship at its quay                                                                | PASS                                                           |
| **warehouse-tier3.png**, -360x604                                 | Green floor, brick walls, 5 bays, shelf 0/60, dock 2 "+ $800", dock 3 "Lv4"                                                                                              | PASS                                                           |
| **warehouse-two-docks.png**, -360x604                             | Tier 4, two docks with green lamps "2 docks 1 unloading", dock 3 for sale at $1,000                                                                                      | PASS                                                           |
| warehouse-dock-dialog.png                                         | "Loading dock 2 · $800"                                                                                                                                                  | PASS (M8)                                                      |
| **clearance-ring.png**                                            | The ring with ×3 over the port office at zoom 2                                                                                                                          | PASS (the first-Toss hint toast shows on this fixture frame)   |
| **ship-departure.png**                                            | The ship sailing out bow first                                                                                                                                           | PASS (same hint toast)                                         |
| **lost-life-overseas.png**, -360x604                              | `ua-parser-rs`: every slot's miss vs battery, "Handed off at Prefetch Pier 1 18:27 / Cleared 19:12 — the ship has sailed", "Another Battery checker would make it 99.5%" | PASS                                                           |
| **lowres-live.png**, **rural-live.png**                           | Semver Street and Pasture Peer Fields in colour, the NEW chips                                                                                                           | PASS                                                           |
| **level-up-5.png**                                                | "LEVEL 5 — TYCOON" over the dust, both L5 NEW chips scrolled into view                                                                                                   | PASS (the cloud reads flat, §6.21)                             |
| **airport-live.png**                                              | Terminal, cargo hangar, tower, the plane at its stand, both NEW chips on screen                                                                                          | PASS (one plane heading, §6.22)                                |
| **civic-live.png**                                                | Monorepo Commons: town hall, library, museum with its T-rex, school, hospital, stadium, pavilion, fountain                                                               | PASS                                                           |
| **warehouse-tier4.png**, -360x604                                 | Charcoal floor, steel walls, a forklift, five slots, 0/80, dock 3 "$1,000" on a tag                                                                                      | PASS (at 393 × 659 the bin's tag is cut at scroll 0, §6.10)    |
| **warehouse-tier5.png**, **-360x604**                             | Terrazzo, glass, pink neon, two inspectors, four machines, slot 6 "+", the shelf below the view                                                                          | PASS (no scroll affordance, §6.6)                              |
| **warehouse-tier5-scrolled.png**, -360x604                        | Max scroll: the shelf 11/100 and the bin ×49, the readout fixed                                                                                                          | PASS (a toast covers the QUARANTINE label, §6.7)               |
| **golden-release-offer.png**, -360x604                            | THE GOLDEN RELEASE gold card: "In 5 days: 60 deliveries, no malware, 90% on time", Reward: Victory, Accept · Later                                                       | PASS                                                           |
| **plane-departure.png**                                           | The plane on its climb east; the chip "30/60 0✕ 56%" shows the on-time rule failing (§10.4)                                                                              | PASS                                                           |
| **victory.png**, -360x604                                         | The real TYCOON card: 45 days, $20,943, 463 parcels, 79 / 0, 4 of 5, Lv5; Continue / New game / Run summary                                                              | PASS (the stamp toast covers the Day chip, §6.8)               |

The audio renders of playtest 1 are unchanged (`shots/audio/`); the music is still unheard on this VM.

## 4. Gate results

`vlr sim:gate`: seeds 1–10 × 30 min, competent policy, data `0af23d08`. **GATE PASS** on medians. The final runs (after
the review fixes) wrote docs/gate/latest.md, latest-35min.md and delegating.md byte-identical to the committed files.

| Window (`economy.pacingTargets`)               | Median    | Target    | Min / max                         | Playtest 1 |
| ---------------------------------------------- | --------- | --------- | --------------------------------- | ---------- |
| First delivery                                 | 43.3 s    | < 60 s    | 31.5 / 60.8                       | 44.05 s    |
| Scripted malware caught                        | 178.3 s   | ≤ 300 s   | 150.5 / 205.7                     | 174.3 s    |
| Level 2                                        | 11.72 min | 8–15 min  | 10.27 / 12.36                     | 13.05 min  |
| Truck bought after L2                          | +1.54 min | ≤ 4 min   | 0.20 / 3.81                       | +2.10 min  |
| Lives lost (Toss-everything)                   | 0         | 0         | 0 / 2                             | 0          |
| Shelf stall                                    | 0 s       | 0 s       | 0 / 0                             | 0 s        |
| Hold Bay events per 10 min at L1               | 6.78      | ≥ 6       | 2.82 / 10.52                      | 7.15       |
| Quests offered by 30 min (new)                 | 7         | ≥ 4       | 6 / 8                             | —          |
| Quests completed by 30 min (new)               | 3.5       | ≥ 2       | 2 / 6                             | —          |
| Level 3 (now active)                           | 17.98 min | 15–20 min | 15.36 / 19.59                     | —          |
| First overseas clearance after L3 (new)        | +2.18 min | ≤ 3 min   | 1.74 / 3.48                       | —          |
| Level 4 (now active)                           | 22.35 min | 20–25 min | 19.63 / 24.89                     | —          |
| Level 5 (now active)                           | 27.70 min | 25–30 min | 24.93 / 28.39 (seed 5 none by 30) | —          |
| Payroll share of gross (informational, ≤ 0.25) | 21.0 %    | ≤ 25 %    | 18.8 / 22.8                       | —          |
| Wrong tosses (informational)                   | 27.5      | —         | 23 / 36                           | 19         |
| Malware share at 30 min (informational)        | 13 %      | —         | 11 / 13                           | 20 %       |

| Seed | First del. s | Caught s | L2    | Truck + | Lives | Hold/10 min L1 | Quests off / done | L3    | Clearance + | L4        | L5            | Misses                                      |
| ---- | ------------ | -------- | ----- | ------- | ----- | -------------- | ----------------- | ----- | ----------- | --------- | ------------- | ------------------------------------------- |
| 1    | 54.3         | 150.5    | 11.19 | 1.70    | 0     | 8.94           | 7 / 4             | 17.10 | 1.82        | 22.33     | 28.39         | —                                           |
| 2    | 55.6         | 185.4    | 11.98 | 3.81    | 0     | 8.35           | 7 / 3             | 19.59 | 2.28        | 23.44     | 28.22         | —                                           |
| 3    | 52.0         | 201.3    | 12.05 | 2.30    | **1** | 9.13           | 6 / 3             | 18.00 | 1.93        | 22.38     | 26.56         | one life lost                               |
| 4    | 48.8         | 163.6    | 10.63 | 0.38    | 0     | **2.82**       | 8 / 6             | 16.01 | 2.11        | **19.63** | **24.93**     | few Hold Bay events; L4 and L5 early        |
| 5    | **60.8**     | 176.5    | 12.36 | 2.20    | 0     | 10.52          | 6 / 3             | 19.52 | **3.48**    | 24.89     | **— (31.50)** | first delivery, clearance late, L5 at 31.50 |
| 6    | 36.0         | 181.5    | 11.48 | 0.20    | 0     | **4.36**       | 7 / 5             | 17.01 | 1.74        | 21.12     | 27.72         | few Hold Bay events                         |
| 7    | 31.5         | 180.1    | 11.89 | 0.41    | 0     | 6.73           | 7 / 3             | 17.96 | 2.26        | 22.72     | 27.88         | —                                           |
| 8    | 37.8         | 205.7    | 12.22 | 2.73    | **2** | 6.55           | 7 / 5             | 18.49 | 2.57        | 22.71     | 27.68         | two lives lost                              |
| 9    | 36.3         | 165.5    | 11.54 | 1.37    | 0     | **4.33**       | 6 / 2             | 18.18 | 2.88        | 21.72     | 26.99         | few Hold Bay events                         |
| 10   | 34.5         | 153.1    | 10.27 | 0.61    | 0     | 6.82           | 7 / 5             | 15.36 | 2.00        | **19.79** | 25.22         | L4 early                                    |

3/10 seeds pass every window (1, 2, 7); every median passes. Shelf stall is 0 s on every seed. The playtest-1 rows are
within ±5 % of M8 (the gate's baseline); against playtest 1, L2 is 1.3 min earlier (quest cash and the faster drivers
the policy hires, §7.2 D1) and every window still passes.

**The 35-minute gate** (`vlr sim:gate -- --minutes 35`, docs/gate/latest-35min.md): PASS. The Golden Release is offered
at 27.70 min median (target ≤ 32; seed 5 latest at 31.50); dock 3 is bought at 32.86 min; the Sorter Arm tosses 3.5
parcels; 8 hires. Across the ten seeds the Golden Release was offered 17 times (re-offers after fails), completed 0
times and failed 8 times by minute 35.

**The delegating policy** (`vlr sim:delegating`, informational: it hires a sorter and Clears what it tags clean):
PASS (only an invariant fails it). L2 / L3 / L4 / L5 at 11.72 / 17.73 / 22.46 / 28.02 min; lives lost median **1.5**
(0–3; B2 §7.3 prints ≤ 1); sorter calls 43, wrong tosses 3.5, malware missed 1; wrong tosses overall 8 (27.5 for
Toss-everything); payroll share 24.0 % (22.0–29.4 %); quests 7 offered, 4 completed; first clearance +2.94 min.

**The victory long test** (`tests/sim/victory.long.test.ts`, seeds 1–3 × 48 min, in the full `vlr check`): PASS. It
asserts that at least one of seeds 1–3 wins by 48 min (seed 2 at 45.70; seeds 1 and 3 have no Victory by 48) and prints
the 45-min target, which no seed meets (waived pending you, §10.4).

**JSON values changed in build 2.** A script diff of B2 §9's tables and of `src/data/*.json` at 84334f7 against the
shipped data finds exactly these (B2 §7.3 order: a late level → lower its threshold; truck / dock late → price; quests
too rare → `offer.intervalDays`; too rich → `reward.cash`; values last; one decisions.md line each):

| Key                                               | From → shipped               | When   | Rule and the row that moved it                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `levels.json` L3 `threshold`                      | 5,000 → **3,700**            | M8     | "A late level → lower its threshold", row `level3Min`: 22.38 → 17.98 min. Scan 3,500–3,900 with full gates: 3,500 and 3,900 broke the lives median, 3,600 left 4/10 seeds losing a life.                     |
| `levels.json` L4 `threshold`                      | 9,000 → **5,200**            | M9     | Same rule, row `level4Min`: 31.84 min with 3/10 seeds reaching L4 by 30 → 22.35. Scan L4 5,000–5,800 × L5 7,400–8,600; over 100 seeds L4 22.13.                                                              |
| `levels.json` L5 `threshold`                      | 16,000 → **7,400**           | M9     | Same rule, row `level5Min`: no L5 by 35 min → 27.70 (100 seeds 27.31). 5,800 / 8,600 gave L5 30.2; 5,400 / 7,400 broke the 35-min lives median.                                                              |
| `economy.json docks` dock 3 `price`               | 2,000 → **1,000**            | M9     | "Dock late → price", informational rows `dock3Min` / `victoryMaxMin`: bought 33.4 → 31.5 min over 40 seeds; victories by 48 min 7 → 18 of 40. Supersedes spec-core Q-SP9.                                    |
| `quests.json on_time_day` `rate`, `minDeliveries` | 0.95 → **0.85**, 8 → **6**   | M7     | Row `questsCompletedBy30MinMin` (B2 §3.2 "completable by the competent policy on a median seed"): 1 of 11 offers completed → 4 of 11.                                                                        |
| `quests.json big_haul` `count`                    | 5 → **3**                    | M7     | Same row: ~2.3 XL parcels per 4-day window; 0 of 8 offers completed → 2 of 8.                                                                                                                                |
| `quests.json customs_run` `count`, `limitDays`    | 6 → **3**, 4 → **5**         | M9     | Same row (B2 §3.2 bound at ~0.9 clearances/min): 0 of 5 completed at M8 → 3 of 3.                                                                                                                            |
| `quests.json cheer_up` `goal.value`               | 60 → **52**                  | M9     | Same row: targets start at 36–48 and gain at most ~+7 in 5 days; 55 gave 0 of 8, 52 gives 2 of 8 (1 of 8 in the final gate). The schema keeps it above the 50 targeting threshold.                           |
| `parcels.json malware.postVictoryPerDay`          | 0.01 → 0.005 → **0.01**      | M7, M9 | M7: row `maxLivesLost`, seeds losing a life 6/10 → 4/10 (lever-order deviation: `reward.cash` was not tried first). M9: back to B2 §3.4's +0.01/day; with the cap at 5 it only drives endless; no row moves. |
| `economy.json playtestMaxLevel`                   | 2 → 3 → **5**                | M8, M9 | Scope, not a retune (B2 §9's end value; 3 at M8 is decision D2, §7.2).                                                                                                                                       |
| `economy.json pacingTargets`                      | + 6 rows                     | M6     | B2 §9 as written (`firstOverseasClearedAfterLevel3MaxMin`, `questsOffered/CompletedBy30MinMin`, `payrollShareOfGrossMax`, `goldenReleaseOfferedMaxMin`, `victoryMaxMin`).                                    |
| `puns.json quests` `rush_district`, `cheer_up`    | district name → `{district}` | M7     | Text only (the target district varies, M7 Q4).                                                                                                                                                               |

`employees.json` matches B2 §9; `vehicles.json`, `machines.json`, `parcels.json`, `districts.json` and the rest of
`economy.json` and `levels.json` match playtest 1; `map.json` changed only in layout (the Airport label tile and the
runway, field and fountain scenery rows, decisions.md M9). Outside `src/data`: `public/configs/spicy.json` gains
`quests.offer {firstOfferDay: 1, intervalDays: 1}`; `public/configs/tycoon.json` is new (`economy.startMoney` 14,500 +
the `start` recipe).

## 5. Tests and checks

At the final M10 working tree (HEAD bb5646e plus the M10 changes), after the review fixes, unless noted.

| Check                    | Result                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                   | 103 files, 2,152 tests: **2,151 passed**, 1 todo, 0 failed (83.3 s, rerun for this report). Growth: M4 1,082 → M5 1,204 → M6 1,344 (outside the long sweeps) → M8 1,925 → M9 2,099 → M10 2,151.                                                    |
| `vlr check`              | PASS in **158.3 s** (target < 3 min): toolchain 0.1, typecheck 10.5, lint 0.3, fmt 0.5, test 84.8, art:lint 1.9, quick gate 1.2, e2e:smoke (smoke + dist) 58.9 s. Per milestone: M5 88 s, M6 107, M7 118, M8 125, M9 ~157.                         |
| `vlr e2e`                | Final full run at the M10 tree (after every review fix): **135 passed, 104 skipped** (project-scoped), **0 failed**, 8.9 min — smoke, dist, lifecycle, audio, audio-render, quests, configs and every shot.                                        |
| `vlr shots`              | 88 passed, 104 skipped, 5.2 min (96 PNGs + `tests/playtest/seed-7.json`).                                                                                                                                                                          |
| Sim gates                | `sim:gate` (30 min), `sim:gate -- --minutes 35`, `sim:delegating`: PASS, outputs byte-identical to the committed files; victory long test PASS.                                                                                                    |
| `vlr build` + check-dist | PASS: **6.35 MB raw / ~4.32 MB gzip** transfer in 68 files vs the 8 MB budget (Q-B2-10); excluded: 5 sourcemaps (15.64 MB). Every asset hashed and fetched once; both configs present and byte-identical to `public/configs/`.                     |
| JS chunks (gzip)         | phaser 353.3 kB, index 221.9 kB, director (lazy audio) 73.3 kB, policy 3.2 kB (the Title's demo city), offline 1.0 kB. `world` 2048² 2,394.9 kB (513 frames, 80.3 % full), `interior` 2048×512 144.2 kB (298 frames, 37.1 %); samples 1.03 MB.     |
| Draw calls               | City 3; warehouse 4 (6 at M9 — the baseboard is an atlas frame now); tier 5 scrolled 4; tier 5 with the full tycoon lane 6 while a dock's loading bar shows (budget 7); attract Title 4 at 56.1–56.3 fps under SwiftShader.                        |
| Browser perf             | seed-7 profile: fps p50 60, p5 59, min 55 over 107 real seconds (SwiftShader).                                                                                                                                                                     |
| Cold install             | At the final M10 commit: `git archive 13245fd` unpacked into a fresh `/tmp` dir (no `node_modules`, no `.env`), `vlt install` then `vlr check:quick`: **PASS in 46.4 s** (test step 35.0 s), 47 s in all; lockfile unchanged, 0 `registry.vlt.io`. |
| AI attribution           | Commit history: **0** hits over 84334f7..HEAD (6 commits) and over all 29 commits. Files: 257 matching lines in 14 files, none an attribution line or session link (§6.33).                                                                        |

WebKit cannot launch on this VM, so every browser check ran in Chromium (as in playtest 1).

## 6. Known bugs and rough edges

Nothing here blocks the playtest. File references are to the M10 tree.

**Balance** (see §10 for the numbers)

1. **Victory by 45 min is not met** (plan-build2 §8.6 acceptance, waived pending you): the Golden Release's ≥ 90 %
   on-time rule fails against the L5 fleet; 10 of 40 seeds win by 48 min, none by 45. `levels.json ultimateQuest`,
   `src/sim/systems/quests.ts`.
2. **The lives row is fragile**: 2/10 gate seeds lose a life (3 and 8), ~35 % of 40 seeds lose one in 30 min, and the
   delegating policy loses 1.5 (above B2 §7.3's ≤ 1). Untried lever: `parcels.json malware.newStrainDelayS` 60 → 90.
3. **Satisfaction still drifts angry under the policy** (report-1 §6.1, not tuned): the HUD mood reads 37 on Day 28
   (tier-5 shots), 30 on Day 32 and 29 on Day 46; seed 7's profile ends with Hoist Hill at 3. Late deliveries (−3,
   uncapped) outweigh the +4/day positive cap (`economy.json satisfaction`, `src/sim/systems/satisfaction.ts`).
4. **`cheer_up` and `on_time_day` rarely complete** (1 of 8 and 3 of 8 in the gate): the policy never steers a district
   or a day; a human can.
5. **`express_lane` (L5) is only ever offered after Victory**: while the Golden Release is pending no regular template
   is offered (`src/sim/systems/quests.ts:755-759`, the M7 review rule), and L5 is the Golden Release's level.

**UI and UX**

6. **No scroll affordance in the tall rooms**: at tier 5 the shelf and bin are below the view at scroll 0 on both phone
   sizes (`warehouse-tier5.png`, `-360x604`); the drag works but nothing hints at it. A shelf stall is still announced by
   the fixed readout (decisions.md M9, R22's cut order).
7. Warehouse toasts sit in the room's toast lane (`src/scenes/HudScene.ts:3133 toastLane()`): at tiers 1–3 over the
   "DAYS SINCE LAST INCIDENT" sign (report-1 §6.7, `warehouse-l1.png`), at tier 5 low over the Hold Bay and the
   QUARANTINE label (`warehouse-tier5-scrolled.png`).
8. HUD toasts at the top-left cover the Day chip (`quest-complete.png`, `victory.png`).
9. District name plates show partly under the region chips row (`city-30s.png` "Node Heights", the "Monorepo Commons"
   plate under the chips in `lost-life-overseas.png`).
10. At 393 × 659 the tier-4 room is 9 px taller than the view: at scroll 0 the bin's count tag is cut
    (`warehouse-tier4.png`).
11. If you tap Continue on the VictoryCard and reload within ~2 s (before the next autosave) the card shows again
    (`HudScene.ts` ~1747, harmless).
12. The summary card's "played" and taps per minute come from wall time (`src/metrics/playtest.ts`): a profile opened
    right after a fast-forward reads "0:01 played" and "Taps/min 180.0" (`summary-card-360x604.png`, a frozen-clock
    shot). A real session is unaffected (report-1 §6.9).
13. Two of your fun-bar items are soft by construction: item 5 cannot fail on the shipped data (every strain has a
    counter, so a loss is always "explained" and reads "you judge"); item 1 counts any non-cheapest pick.
14. The recorder misses what happened before it attached (`?fastForward=`, a fixture, `?level=`, the tycoon recipe): the
    recipe's hires are not in `hires[]`, while `docksBought[]` shows its docks at 0 s (decisions.md M10).
15. The sim keeps the last 50 quests (`QUEST_HISTORY_MAX`, `src/sim/types.ts:656`), so a very long endless run
    undercounts `quests.byTemplate`.
16. The tycoon session is easy: the Sorter Arm clears the Hold Bay and Accept alone wins in 4.2–4.9 min; set
    `"holdStation": null` in `tycoon.json` to leave the bay to the player (your call).
17. `tests/playtest/seed-7.json` comes from a fast-forwarded run (108 real seconds, fun-bar item 4 ✗ by design); it
    still carries the buildStamp `bb5646e` until shots run at the final sha, and its hire count moves 6 ↔ 7 with the
    tick the run ends on.
18. The first-Toss hint toast shows on the fixture-loaded city shots (`ship-departure.png`, `clearance-ring.png`); a
    cold run shows it once, near minute 3.
19. Re-hire is two taps (`···` → Re-hire) so Sell stays reachable on a driverless row (decisions.md M6 D16).
20. Long-press vibration is ignored by iOS (report-1 §6.16).

**Art** (details and commands in docs/art-todo.md and §9)

21. The level-up dust is one cloud per frame now, but it reads as a flat beige blob (`level-up-5.png`; M5 art call,
    `tools/art/fx.ts`).
22. `ap_plane` has one heading and faces across the runway; a plane rolling along it needs a second heading (≈ 12
    generations).
23. Eight playtest-1 finals keep 1–42 px of pink key background (`dt_peer_plaza`, `dt_monorepo_media`,
    `dt_tarball_hotel`, `dt_transpile_campus`, `in_lodash_smelting`, `in_chalk_pigment`, `in_tarball_packing`,
    `in_gzip_compressors`); the fix is `vlr art:gen -- --reprocess --ids <id>` on this VM.
24. `ru_peer_pasture` keeps a thin earth rim on its front edges; `vlr art:lint`: 0 errors, 37 warnings (A12 colour
    counts of 17–19 on multi-material sprites, all in the palette), 3 placeholders (`desk`, `shelf_t1`, `shelf_t2`).
25. The `world` atlas is 80.3 % full: over the 75 % target, under R13's 90 % trigger (no `city2` atlas needed yet).

**Platform, performance and housekeeping**

26. The dock loading bars are two Rectangles (`src/render/warehouse/DockView.ts:284-285`): +2 draw calls while a dock
    loads (6 of 7). Atlas frames would need new art.
27. The Phaser chunk is 353 kB gzip against plan.md §6.11's ~300 kB estimate; total transfer is well inside 8 MB.
28. iOS-only behaviour is unverified (no WebKit here): safe areas, 100dvh under Safari's toolbars, `gesture*` blocking,
    rotating with a card open, and the tall-room drag on a real touch screen. All are in docs/phone-checklist.md.
29. Samples load before the Title tap (report-1 R14, unchanged); nothing sounds before it. The music is still unheard on
    this VM.
30. Fixed at hand-off: the dev-only `public/gallery/` (regenerated by every `vlr art:build`) was removed before the
    hand-off build, so the zip carries no gallery files; `check-dist` still warns about the tracked 0.01 MB
    `public/gallery.html`.
31. The cold `vlr check:quick` took 46.4 s, over playtest 1's 40-s target (the unit suite grew from 1,082 to 2,151).
32. Fixed at hand-off: the M7 status entry's test count (1,651 outside the long sweeps) was filled in.
33. The attribution grep's file hits (none is an attribution line): 238 are the art reviewer id in the manifest's `by`
    fields (`art/manifest.json` 228, `tools/art/decide.ts` 6, `gen.ts` 2, `manifest.ts` 2) — a provenance value the code
    compares against, so renaming it means a manifest change too (your call); 10 match the generation-tool pattern (7
    "regenerated" sentences, 2 PixelLab provenance lines in `art/STYLE.md` 128 and 130, the AGENTS.md rule itself); the
    rest name the agent tooling's own files (`.gitignore`, AGENTS.md, decisions, status, report-playtest1).
    `.mcp.json` holds `Bearer ${PIXELLAB_TOKEN}`, an environment reference, not a token.

**Sim edge cases** (minor, unchanged from report-1 §6.26–§6.28): a driver who walks out mid-loading finishes the trip; a
rush given where nothing fits keeps its flag until it expires; a sim ticked after game over keeps running.

## 7. Open questions

### 7.1 plan-build2 §11 (Q-B2): your answers and the defaults taken

| #       | Question                                 | Shipped                                                                                                   | Where coded                                                                            |
| ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Q-B2-1  | Logo treatment (answered: as-is)         | `art/logo.png` Lanczos-downscaled to 352×176, drawn 1:1, outside the palette lint and both atlases        | `tools/art/logo.ts` (`vlr art:logo`), `src/scenes/TitleScene.ts`                       |
| Q-B2-2  | Driver picker (answered: every purchase) | `Who drives the Bike?` on every vehicle; `Hire later` → `No driver`                                       | `src/ui/HireSheet.ts`, `src/scenes/GarageSheet.ts`, `buyVehicle {applicantId \| null}` |
| Q-B2-3  | Sorter (answered: Toss-only)             | Wanted list + judgement toss; the rest tagged `looks clean`; it never Clears, so it can never cost a life | `src/sim/systems/sorter.ts`                                                            |
| Q-B2-4  | Second desk                              | L3 for $400                                                                                               | `employees.json desks.rows`                                                            |
| Q-B2-5  | Charisma reach                           | Same desk only                                                                                            | `src/sim/systems/people.ts`                                                            |
| Q-B2-6  | Post an ad                               | $30 rerolls one pool now; pools also refresh free every day                                               | `employees.json applicants.adPrice`, `people.ts`                                       |
| Q-B2-7  | Failed quest penalty                     | None                                                                                                      | `src/sim/systems/quests.ts`                                                            |
| Q-B2-8  | Run shape (answered: one long run)       | M5 → M10 in one run, reviews at the end                                                                   | —                                                                                      |
| Q-B2-9  | Pages deploy                             | Dispatch refused (HTTP 403, the app lacks Actions: write); the one GET served playtest 1 — run it by hand | `.github/workflows/pages.yml`                                                          |
| Q-B2-10 | Dist budget                              | 8 MB (6.35 MB used)                                                                                       | `tools/check-dist.mjs`                                                                 |
| Q-B2-11 | Attract city                             | A fixed demo snapshot, never your save: seed 7 at 32:00 (L5, all eight districts; the plan said L3)       | `src/assets/attract.json` from `vlr fixtures:attract` (`tools/fixtures/attract.ts`)    |
| Q-B2-12 | Quest cash and lifetime earned           | Counts toward lifetime earned (levels)                                                                    | `quests.ts` rewards                                                                    |
| Q-B2-13 | Magic parcel distance                    | Destination within 20 road tiles of the lot                                                               | `quests.json magic_parcel.goal.maxRoadTiles`, `src/sim/systems/magic.ts`               |
| Q-B2-14 | Bike canvas                              | 32×32                                                                                                     | `tools/art/manifest.ts`                                                                |
| Q-B2-15 | PixelLab budget (set by the run prompt)  | 1,500 generations with a 300 reserve; 877 spent                                                           | `tools/art/gen.ts` (`PIXELLAB_RUN_BUDGET`, `PIXELLAB_RESERVE`)                         |

### 7.2 The run's own decisions that need your confirmation

| #   | Decision                               | What shipped and why                                                                                                                                                                                                                                                                                                             | Where                                                                              |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1  | The ±5 % drift at M6                   | With the people layer, L2 moved 13.05 → 12.28 min (−5.9 %) and the truck row 2.10 → 1.93 (−8.1 %), outside plan-build2 §8.3's ±5 %. Cause: the policy hires the fastest of three drivers; with neutral drivers the rows match exactly. The R16 lever moved L2 further and broke the lives median, so no value changed. Accepted. | decisions.md M6; `src/sim/policy.ts`                                               |
| D2  | Level cap 3 at M8 (R1)                 | The plan said 5 at M8; slots 5–6 had no room geometry and L4/L5 no live art until M9, and the Golden Release would have fired mid-M8. 5 since M9.                                                                                                                                                                                | `economy.json playtestMaxLevel`                                                    |
| D3  | 18 rows at tier 5                      | B2 §4.4 says 16; six slots at the 64-px pitch need 18 (14 / 14 / 14 / 16 / 18). The room scrolls at tier 4 by 9 px (393 × 659) / 64 px (360 × 604), at tier 5 by 73 / 128 px. R17's alternative (a 56-px pitch for slots 5–6) was not needed.                                                                                    | `src/render/warehouse/RoomLayout.ts rowsForTier`                                   |
| D4  | Atlas placement by binder              | B2 §6.8 lists faces and machines under `interior`; frames go where they are drawn: `world` for the city, HUD, `src/ui/**` and the room's front layers, `interior` for the room's back layers, shared classes in both — so the HUD never switches texture.                                                                        | `src/render/atlases.ts` (`roomAtlas()` / `atlasOf()`), `art/manifest.json atlas`   |
| D5  | NEW STRAIN FIRST (policy extension)    | When a level announces a strain, the policy buys its counter before older pending steps (the X-ray at L4). Seeds 1–10 × 48 min lives lost 15 → 7; 40 seeds losing a life in 30 min 43 % → 35 %. Cost: the van and 2nd truck ~4 min later, wins by 45 min 2 → 0, L5 +0.7 min.                                                     | `src/sim/policies/levelPlan.ts`                                                    |
| D6  | Victory-by-45-min waiver               | Not met; `victoryMaxMin` is informational (B2 §7.3); the build keeps the spec's Golden Release rules. Options in §10.4–§10.5.                                                                                                                                                                                                    | `levels.json ultimateQuest`, `tests/sim/victory.long.test.ts`                      |
| D7  | Threshold and price retunes            | L3 $3,700, L4 $5,200, L5 $7,400 (spec-core $5,000 / $9,000 / $16,000), dock 3 $1,000 (Q-SP9's $2,000); the quest retunes of §4.                                                                                                                                                                                                  | `levels.json`, `economy.json docks`, `quests.json`                                 |
| D8  | REPLACE (policy extension, M8)         | With every slot full, the last duplicate machine is sold for the Battery checker (never a desk).                                                                                                                                                                                                                                 | `src/sim/policies/levelPlan.ts`                                                    |
| D9  | Quest design defaults (M7 Q1–Q22)      | e.g. a wrong Toss resets `clean_sweep`; the first offer at 3:00 (Day 4); the golden parcel rides first in its vehicle; no regular offer while the Golden Release is pending (which hides `express_lane` until Victory, §6.5).                                                                                                    | decisions.md "M7 — quests"                                                         |
| D10 | People design defaults (M6 D1–D20)     | e.g. Replace swaps after the trip; a ★ applicant stays 2–3 days; the hire fee on purchase comes out of the policy's $50 buffer.                                                                                                                                                                                                  | decisions.md "M6 — people"                                                         |
| D11 | The stuck rule                         | "No vehicle in one state > 120 s" flagged genuine 12–19-stop L4–L5 legs; now "no progress for 120 s".                                                                                                                                                                                                                            | `tools/sim/cli.ts stuckKey`, `tests/sim/robust.ts`                                 |
| D12 | The fun bar 2 thresholds and the offer | Live in code like v1's (`FUN_TARGETS`, `SUMMARY_OFFER_S` 1,800); the offer also waits for 25 real minutes so item 4 can pass.                                                                                                                                                                                                    | `src/metrics/playtest.ts:81-121`                                                   |
| D13 | The tycoon recipe                      | The competent policy's L5 end state; played only on a fresh game with the debug API, through ordinary commands, so the save and replay carry it.                                                                                                                                                                                 | `public/configs/tycoon.json`, `src/boot/configStart.ts`, `src/data/configStart.ts` |
| D14 | `debugForceLevel` books no income      | `?level=` and the tycoon recipe no longer add the threshold to lifetime earned; the level bar shows an empty bar at a forced level.                                                                                                                                                                                              | `src/sim/systems/levels.ts`                                                        |
| D15 | Inspector scan frames                  | Scripted from the PixelLab idle frames (arm raised with a scanner, 0 generations) instead of a PixelLab animation at another scale. Say yes or no in writing (§9).                                                                                                                                                               | `tools/art/candidates.ts scanPose`                                                 |

Still open from playtest 1 (report-playtest1.md §7 and §9; answers welcome by number): samples before the Title tap
(R14), the walkout "finishes its trip" rule (R11), the Q-RUN1 dock relief, the satisfaction drift (R25), the palette G1.

## 8. Feedback F1–F12: what changed

| #   | Your note (plan-build2 §2)                                                                               | What shipped                                                                                                                                                                                                                                                                                                       | Where to see it                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Title: your logo over the moving city, only the title buttons                                            | Logo as-is over an attract-mode City (seed 7's L5 city replayed, a camera tour), New game / Reset / Credits; Continue shows the save's day, money, level and `Tycoon ✓`                                                                                                                                            | `title.png`, `title-430x932.png`, `title-tycoon.png`                                                                                                      |
| F2  | The warehouse foundation was misaligned with the grid                                                    | Exteriors regenerated, now without an apron (lint A04 strict); the slab, a dropped-kerb ramp and bollards are ground-bake tiles on the lot's 4×4 footprint; tiers 3–5 follow the same recipe                                                                                                                       | `city-lot-zoom2.png`, `city-30s.png`; `art/contact/fixes@4x.png`, `tiers@4x.png`                                                                          |
| F3  | The bike should be a bike, or a scooter with a helmeted rider                                            | A courier on an orange bicycle with a white helmet and a rear cargo box, 32×32, eight headings (no scooter fallback needed)                                                                                                                                                                                        | `city-bike.png`; `art/contact/fixes@4x.png`                                                                                                               |
| F4  | Vans and trucks must not show parcels on the roof                                                        | The pickup icon shrinks by crop into the vehicle body; the delivery hop starts from inside it                                                                                                                                                                                                                      | `city-hop.png`, `city-hop-crop.png`                                                                                                                       |
| F5  | The docks looked medieval: keep containers, ship, crane; drop pier and customs                           | `dk_pier` and `dk_customs` retired with your reasons; new `dk_terminal_a` (reach-stacker), `dk_terminal_b` (gantry), `dk_port_office` (radar mast); live in colour from L3; the ship re-rolled to sail bow first                                                                                                   | `docks-locked.png`, `docks-live.png`, `ship-departure.png`, `clearance-ring.png`                                                                          |
| F6  | Keep the single conveyor with slots; no belt building                                                    | No belts anywhere; the room grows rows per tier (slots 5–6 unroll below slot 4) and scrolls when it does not fit                                                                                                                                                                                                   | `warehouse-tier4.png`, `warehouse-tier5.png`, `warehouse-tier5-scrolled.png`                                                                              |
| F7  | Worker options with their own detection and salary; up to three per desk                                 | Pools of three applicants per role with eye / pace / charisma pips → catch %, false flags, seconds per parcel; salary and fee from the pips; ★ applicants; Post an ad; three per desk                                                                                                                              | `hire-sheet.png` (+360), `warehouse-desk2-card.png`                                                                                                       |
| F8  | A charismatic worker lifts a colleague's detection                                                       | Charisma 1–2 adds +2 / +4 points to every other inspector at the same desk (cap 96 %); the desk card shows each inspector's rate and the average                                                                                                                                                                   | `warehouse-two-desks.png` (desk 2 at 0.87 / 0.96)                                                                                                         |
| F9  | A second desk; humans cost more than machines                                                            | Desk 2 at L3 for $400; inspectors $12–$36/day against one-off machine prices ($150 Metal detector)                                                                                                                                                                                                                 | `warehouse-two-desks.png`, `warehouse-desk2-card.png`                                                                                                     |
| F10 | A worker slot by the quarantined parcels to automate tossing, from L2                                    | The Hold Bay station: a Toss-only sorter (L2; your answer) that tosses the wanted labels and what it judges malware and tags the rest `looks clean` for your Clear; or the Sorter Arm (L4, $600, tosses after 3 s)                                                                                                 | `station-sorter.png`, `station-card.png`, `holdcard-sorter-hint.png` (+360)                                                                               |
| F11 | Driver hiring like workers: three options, skills, salary                                                | The same picker on every vehicle purchase (`Who drives the Bike?`), speed / energy / charisma / affinity, Replace / Fire / Re-hire / Sell in the Garage `···` menu, the driver's name and pips in the follow strip                                                                                                 | `garage-driver-picker.png`, `garage.png`, `city-zoom2.png`, `city-bike.png`                                                                               |
| F12 | Milestones with acceptance, the test player's L3–L5 rules, quests, five new regions' art, open questions | M5–M10 done with their acceptance (docs/status.md); the policy's L3–L5 plans (`src/sim/policies/levelPlan.ts`); ten quest templates, the golden parcel and the Golden Release; unique art for the Docks, Semver Street, Pasture Peer Fields, the Airport and Monorepo Commons, tiers 3–5; the open questions in §7 | `quest-offer.png`, `magic-parcel.png`, `quest-complete.png`, the `*-live.png` shots, `warehouse-tier3/4/5.png`, `golden-release-offer.png`, `victory.png` |

Also folded in from report-playtest1 §6 (M5 unless noted): the pause menu on the modal stack (§6.5), ticker pacing
(§6.6), the opaque top bar and ticker (§6.8, M10), the Credits card modal (§6.11), Enter on Game Over → summary
(§6.12), a save key per config (§6.13), sheets sized to content (§6.14), hashed atlas URLs (§6.21), one dust cloud
(§6.23), arm-raised scan frames (§6.24), `cv_stadium` re-rolled as `cv_changelog_stadium` without townhouses (§6.25,
M8). The angry drift (§6.1) and the L1 plateau (§6.2) were addressed with quests and hiring rather than retuned: a quest
is active in minutes 7–13 on 10/10 gate seeds.

## 9. Art approval requests (G4–G6)

**State** (`art/manifest.json`, 323 ids): build 2 added or regenerated **47 PixelLab sprites** (43 new ids plus
`wh_ext`, `bike`, `ap_terminal`, `dk_ship` redone) and 59 procedural ids. The agent picked one candidate per id from the
contact sheets (`tools/art/decide.ts --manifest`); every pick is in the game and waits for you (`approved: false`). No
PixelLab id fell back to procedural in build 2. 85 PixelLab ids await you in all (G3–G6), 6 G2 anchors are
agent-approved provisionally, 3 placeholders remain from playtest 1. Sheets are committed under `art/contact/` (4×).

| Gate | Sheet                                                                                                                         | ids                                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G4   | `art/contact/fixes@4x.png` (exterior t1 / t2 on the slab, the eight bike frames, the port in colour and fogged, the hop cell) | `wh_ext` (#6; `_t2` = edit 1), `bike` (#6), `dk_terminal_a` (#2), `dk_terminal_b` (#1), `dk_port_office` (#0)                                                                                                     |
| G5   | `art/contact/lowres@4x.png` (Semver Street, L4)                                                                               | `lr_major_house` `lr_patch_bungalow` `lr_prerelease_villa` `lr_range_ranch_house` `lr_caret_cottage` `lr_tilde_terrace` `lr_minor_cottage` `lr_exact_pin` `lr_wildcard_shop` `lr_buildmeta_bungalow`              |
| G5   | `art/contact/rural@4x.png` (Pasture Peer Fields, L4)                                                                          | `ru_peer_pasture` `ru_dev_dairy` `ru_range_ranch` `ru_optional_orchard` `ru_hay_barn` `ru_grain_coop` `ru_caret_mill` `ru_tilde_tractors` `ru_semver_stables` `ru_farmhouse_once`                                 |
| G5   | `art/contact/airport@4x.png` (Prefetch International, L5)                                                                     | `ap_terminal` (re-rolled) `ap_cargo_hangar` `ap_tower` `ap_plane`                                                                                                                                                 |
| G5   | `art/contact/civic@4x.png` (Monorepo Commons, L5)                                                                             | `cv_town_hall` `cv_lint_school` `cv_museum` `cv_changelog_stadium` `cv_patch_hospital` `cv_police` `cv_fire` `cv_readme_library` `cv_courthouse` `cv_park_pavilion` `fountain`                                    |
| G5   | `art/contact/docks@4x.png` (Shrinkwrap Shore, L3)                                                                             | `dk_ship` (M9 re-roll, bow first), `dk_crane`, `dk_containers` (kept in F5, never approved by id)                                                                                                                 |
| G6   | `art/contact/tiers@4x.png`, `g6-tiers-machines-people@4x.png`, `people@4x.png`, `warehouse-tier3@4x.png`                      | `wh_ext_t3` (#1, brick depot), `wh_ext_t4` (edit 0 of t3, steel), `wh_ext_t5` (#2, glass HQ with neon), `battery_checker` (#0), `xray` (#7, second M9 re-roll: a screen with an x-ray outline), `sorter_arm` (#0) |

The exact commands (in a clone after `vlt install`; no token needed; each edits only `art/manifest.json`, commit it):

```sh
vlr art:approve -- wh_ext bike dk_terminal_a dk_terminal_b dk_port_office
vlr art:approve -- lr_major_house lr_patch_bungalow lr_prerelease_villa lr_range_ranch_house lr_caret_cottage lr_tilde_terrace lr_minor_cottage lr_exact_pin lr_wildcard_shop lr_buildmeta_bungalow
vlr art:approve -- ru_peer_pasture ru_dev_dairy ru_range_ranch ru_optional_orchard ru_hay_barn ru_grain_coop ru_caret_mill ru_tilde_tractors ru_semver_stables ru_farmhouse_once
vlr art:approve -- ap_terminal ap_cargo_hangar ap_tower ap_plane
vlr art:approve -- cv_town_hall cv_lint_school cv_museum cv_changelog_stadium cv_patch_hospital cv_police cv_fire cv_readme_library cv_courthouse cv_park_pavilion fountain
vlr art:approve -- dk_ship dk_crane dk_containers
vlr art:approve -- wh_ext_t3 wh_ext_t4 wh_ext_t5 battery_checker xray sorter_arm
vlr art:reject -- ap_plane "faces across the runway"   # one id per command; logs the reason, clears the pick
```

A rejected id keeps its image until a re-roll replaces it: `vlr art:gen -- --ids ap_plane --n 3 --seed 5000` (needs
`PIXELLAB_TOKEN` in `.env`; the budget guard counts it), pick from the printed `art/contact/candidates-*@4x.png`, then
`vlr art:approve -- ap_plane:3`, `vlr art:build`, `vlr check`. On a fresh clone pass a new `--seed` base
(`art/candidates/` is gitignored).

What the agent would look at first: `ap_plane`'s single heading (§6.22); `ru_peer_pasture`'s earth rim; the 17–19-colour
A12 warnings on `cv_museum`, `cv_changelog_stadium` and most new uniques; `xray` (a re-roll with curtains would have to
stay above row 16 to keep the belt opening). **The inspector's scan frames** (scripted, §7.2 D15): `vlr art:approve --
worker` says yes and also confirms the G2 anchor; for a no, write the reason down rather than `art:reject -- worker`,
which would reopen the anchor pass and regenerate the inspector.

Procedural, so no approval flag (a "no" is a note for the next build, redrawn in `tools/art/*.ts`): the slab, ramp and
bollards, the tier 3–5 interiors and the neon strip, the faces, pips and ★, `worker_sorter`, `hold_station`, the quest
and hub icons, the runway tiles, `hay_bale`, the ★ and ✓ glyphs. Your logo is `source: "author"`.

**Still open from playtest 1** (sheets and commands in docs/art-todo.md): G1 palette (`art/palette.png`,
`art/contact/palette-ramps@4x.png`, `art/STYLE.md`), the six G2 anchors (`vlr art:approve -- dt_scope_offices
hr_async_arms in_esbuild_engines van worker metal_detector`) and the playtest-1 G3 buildings, trees, truck and shaker.

## 10. Balance: L3–L5 and quests

### 10.1 Level times per seed (competent policy, minutes)

| Seed       | L2    | L3    | L4    | L5 (= Golden Release offered) | First clearance after L3 | Lives lost |
| ---------- | ----- | ----- | ----- | ----------------------------- | ------------------------ | ---------- |
| 1          | 11.19 | 17.10 | 22.33 | 28.39                         | +1.82                    | 0          |
| 2          | 11.98 | 19.59 | 23.44 | 28.22                         | +2.28                    | 0          |
| 3          | 12.05 | 18.00 | 22.38 | 26.56                         | +1.93                    | 1          |
| 4          | 10.63 | 16.01 | 19.63 | 24.93                         | +2.11                    | 0          |
| 5          | 12.36 | 19.52 | 24.89 | 31.50 (35-min run)            | +3.48                    | 0          |
| 6          | 11.48 | 17.01 | 21.12 | 27.72                         | +1.74                    | 0          |
| 7          | 11.89 | 17.96 | 22.72 | 27.88                         | +2.26                    | 0          |
| 8          | 12.22 | 18.49 | 22.71 | 27.68                         | +2.57                    | 2          |
| 9          | 11.54 | 18.18 | 21.72 | 26.99                         | +2.88                    | 0          |
| 10         | 10.27 | 15.36 | 19.79 | 25.22                         | +2.00                    | 0          |
| **Median** | 11.72 | 17.98 | 22.35 | 27.70                         | +2.18                    | 0          |
| Delegating | 11.72 | 17.73 | 22.46 | 28.02                         | +2.94                    | 1.5        |

Dock 2 is bought at 20.48 min (delegating 20.09), dock 3 at 32.86 min (35-min gate). Seed 7's automated profile, the
closest thing to a played run: L2 11:53, L3 17:57, L4 22:43, L5 27:52, 299 deliveries (63 % on time), $11,308 lifetime,
17 overseas clearances, no life lost.

### 10.2 Quests by template (all ten seeds; completed / offered, failed in brackets)

| Template           | Unlocks             | Competent, 30 min | Competent, 35 min | Delegating, 30 min |
| ------------------ | ------------------- | ----------------- | ----------------- | ------------------ |
| Rush hour          | L1                  | 12 / 16 (4)       | 12 / 16 (4)       | 12 / 16 (3)        |
| Special delivery   | L1, after a Toss    | 8 / 9 (0)         | 8 / 9 (1)         | 9 / 9 (0)          |
| Night shift        | L2                  | 5 / 5 (0)         | 5 / 5 (0)         | 4 / 4 (0)          |
| Big haul           | L2                  | 5 / 7 (2)         | 5 / 7 (2)         | 2 / 8 (6)          |
| Customs run        | L3, Docks live      | 3 / 3 (0)         | 3 / 3 (0)         | 5 / 5 (0)          |
| Like clockwork     | L1                  | 3 / 8 (4)         | 3 / 8 (5)         | 4 / 7 (3)          |
| Clean sweep        | L2                  | 1 / 2 (1)         | 1 / 2 (1)         | 1 / 1 (0)          |
| Inspector general  | L3                  | 1 / 1 (0)         | 1 / 1 (0)         | 1 / 1 (0)          |
| Cheer up           | L1, a district < 50 | 1 / 8 (7)         | 1 / 8 (7)         | 2 / 8 (6)          |
| Express lane       | L5, Airport live    | 0 / 0             | 0 / 0             | 0 / 0              |
| The Golden Release | L5                  | 0 / 9 (0)         | 0 / 17 (8)        | 0 / 12 (3)         |

Per seed by 30 min: 7 offered and 3.5 completed (medians; rows ≥ 4 / ≥ 2 PASS); a quest is active in minutes 7–13 on
10/10 seeds; golden parcels delivered on time 8 of 9 (delegating 9 of 9). The policy accepts every offer and never
steers a district, so `cheer_up` and `on_time_day` understate what a human can do. `express_lane` is never offered before
Victory (§6.5).

### 10.3 Payroll and lives

- **Payroll** is 21.0 % of gross income at 30 min (18.8–22.8 % per seed; B2's ≤ 25 % is informational), 24.0 % for the
  delegating policy (up to 29.4 % on seed 5). The policy hires 6 people by 30 min and 8 by 35; seed 7's profile paid 35
  paydays with 1 short and no walkout.
- **Lives** are the fragile row. Competent median 0 with 2/10 seeds losing one (seed 8 two); about 35 % of 40 seeds lose
  at least one in 30 min (decisions.md M9; the M9 status measured 15 of 40); none was lost at an overseas clearance.
  Trusting the sorter's `looks clean` (delegating) costs 1.5 lives per 30 min: the sorter is wrong on 3.5 of 43 calls
  and leaves 1 malware in the bay. NEW STRAIN FIRST halved the 48-min losses (15 → 7). The malware share reaches 13 % at
  L5 and climbs +1 point a day after Victory up to 20 %.

### 10.4 The Golden Release and Victory

- **Offered on time**: median 27.70 min, all ten seeds by 31.50 (row ≤ 32 PASS).
- **Not won on time**: by 35 min it was offered 17 times and failed 8 times with no completion; over seeds 1–40 × 48 min
  10 runs win and none by 45 min (seed 2 at 45.70; seeds 1 and 3 never by 48). The quest's counters match an independent
  event count: this is the economy, not a counting bug.
- **Why**: it is accepted at L5 (~27 min) while the fleet is 5–7 vehicles, and its ≥ 90 % on-time rule fails because
  industrial and rural parcels wait for trucks (seed 3's attempts: 43 %, 43 %, 88.6 %, then a pass; `plane-departure.png`
  shows 30/60 at 56 % on Day 32). With a full L5 fleet from the start (`?config=tycoon`), Accept alone wins in 4.2–4.9 min
  on seeds 1–5.
- **Policy orders measured** (decisions.md M9): X-ray → Arm → 2nd van, then 3rd truck → dock 3 wins 14/40, 4 by 45
  (seeds 2 and 3, never seed 1); vans before dock 3 2/10 by 45; dock 3 after the 3rd truck 0/10. No order reaches seed 1,
  so the shipped plan keeps B2 §7.2's order.

### 10.5 Levers left for you (B2 §7.3 order; one decisions.md line each)

1. **Victory**: `levels.json ultimateQuest` `minOnTimeRate` 0.9 (e.g. 0.85), `days` 5 or `deliveries` 60 — the spec
   says unchanged, so this is your call; or cheaper L5 fleet growth (truck $1,200, van $1,000). Cross-check with the
   tycoon session.
2. **Lives**: `parcels.json malware.newStrainDelayS` 60 → 90 (untried), or `perLevel` 0.02.
3. **Satisfaction drift**: `economy.json satisfaction.late` −3 or `positiveCapPerDay` 4.
4. **Quest reach**: `cheer_up` `limitDays` 5 → 7; `on_time_day` `rate` 0.85; let `express_lane` be offered while the
   Golden Release waits (a code rule, `quests.ts:755`).
5. **Pacing if your L3 is late**: the L3 threshold $3,700 (the gate window is 15–20 min; fun bar 2 item 3 allows 22).
6. **Endless**: `postVictoryPerDay` 0.01 (the ramp after Victory).

## 11. Cost spent

| Item            | Spent                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PixelLab        | **877 generations** of the 1,500-generation build-2 budget (300 reserve untouched; 623 left), in 16 batches: M5 126, M6 207, M7 276, M8 220, M9 48, M10 0. Balance **3,299 → 2,422** of the 5,000/month Tier 2 allowance. **$0** in credits. |
| Playtest 1      | 1,700 generations (5,000 → 3,300) for reference; one generation was spent outside any batch between the runs (3,300 → 3,299).                                                                                                                |
| Retro Diffusion | $0 (no `RD_API_KEY`; never called)                                                                                                                                                                                                           |
| Other paid APIs | $0                                                                                                                                                                                                                                           |

PixelLab answered "heavy load" on 20 of 36 jobs in M5 and 2 in M6; failed jobs were not billed. Provenance per batch
(time, tool, ids, balance before / after) is in `art/manifest.json#batches`; docs/art-todo.md has the regeneration
one-liner.

## 12. Next steps

### 12.1 GitHub state, Pages and hand-off

- `main` was pushed at every checkpoint (M5 67fd97a, M6 1f0b631, M7 11b6517, M8 99ce939, M9 bb5646e) and at the end
  (M10 13245fd), always `git push origin main`, no branches or PRs.
- Pages: **the dispatch was refused.** `gh workflow run pages.yml` with the ruy-bot token returned `HTTP 403: Resource
  not accessible by integration` (the GitHub App has Contents: write for the pushes but not Actions: write). The one GET
  of `https://ruyadorno.com/pm-tycoon/` returned HTTP 200 with the bundle `assets/index-u7CqBocO.js` — the build of your
  manual Pages run of 2026-10-29 (playtest 1), not build 2 (`assets/index-BGt1Jkp1.js`). Deploy build 2 with one manual
  run (below) or grant the app Actions: write. To redeploy: Actions → **Pages** → **Run workflow** (or `gh workflow run pages.yml`); uncomment the
  `push` block of `.github/workflows/pages.yml` to deploy on every push. The atlases are content-hashed, so a redeploy
  never mixes old art with new code.
- Hand-off: `dist-zip/pm-tycoon-13245fd.zip` and the shots zip, both sent with this report; `dist-zip/` is gitignored. docs/status.md
  gets its M10 entry and is copied back to `plans/pm-tycoon/status.md`.

### 12.2 What the playtest profile should answer

- **Fun bar 2, item by item** (§2.3): `hires[]` and whether you can say why you paid for pips; `quests.firstCompletedS`
  and `quests.byTemplate` (which jobs you took, declined, failed); `level3AtS` against 17.98 min and whether the Docks
  felt like a new beat; `elapsedS` at the card; `livesLost[]` with `sorter` and `hub`; `level5AtS` / `victoryAtS`.
- **Pacing**: `level2AtS` … `level5AtS` against 11.72 / 17.98 / 22.35 / 27.70 min. A human L3 well past 22 min argues
  for a lower L3 threshold; a flat `moneyPerMin` with few `vehiclesBought` says the fleet stayed small.
- **People**: `cheapest` false on most hires means the pips read; `fired`, `adsPosted`, `payroll.short` / `walkouts` say
  whether the crew felt manageable; `sorter.wrong` and `sorter.clearedMalware` whether the sorter could be trusted.
- **Overseas**: `overseas.handedOff` / `cleared` / `malwareAtClearance`, and `docksBought[]`.
- **Victory**: if you reach L5, whether the Golden Release felt winnable (§10.4) — the main balance call left open.
- **Phone**: `fps.p50 ≥ 50` and `p5 ≥ 30` (otherwise the cut order in `src/render/quality.ts`; R14 for the attract
  Title), `device.zoom` 1, the tall-room drag at tiers 4–5, plus the unticked lines of docs/phone-checklist.md and
  whether the music works.

### 12.3 Cut-order items not built

None: the plane and ship departures, the delegating rows, Post an ad and star expiry, driver energy and affinity, all ten
quest templates, the tier-5 props and neon, the attract camera tour and the 430-column fixes all shipped. Out of scope
as planned: belts, a management scene, train, PWA, a second music track.

### 12.4 Known follow-ups

1. Your Victory call (§10.4–§10.5), then a lives pass (`newStrainDelayS`) checked against the 40-seed sweep.
2. A scroll hint in the tall rooms (§6.6) and a better toast lane in the warehouse (§6.7), both seen on the phone first.
3. Let `express_lane` reach players before Victory (§6.5) if the L5 stretch feels thin.
4. Art: your G1–G6 verdicts, a second `ap_plane` heading, the pink-speck reprocess, the dust cloud.
5. Housekeeping: decide on the manifest's `by` reviewer id (§6.33); keep the tracked `public/gallery.html` out of dist
   or out of the warning.
