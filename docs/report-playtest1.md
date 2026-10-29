# Playtest 1 — end-of-run report

Package Management Tycoon, company levels 1 → 2, built in one run on 2026-10-29 (05:13 → 16:55 UTC) from
plans/pm-tycoon/plan.md v1. Node v26.12.1, vlt 1.6.0, Phaser 4.2.1, Chromium 156 (SwiftShader) with the Playwright
`iPhone 16` profile. Sources for every number below: docs/status.md (M0–M3 entries), docs/decisions.md,
docs/gate/latest.md, the M4 agents' verification logs (.logs/handoff/, local to the VM) and art/manifest.json.

**What to do first:** serve the build (§2.1), play **twenty minutes cold** on the iPhone 16, open the summary card,
download `playtest.json`, then read §6 (rough edges) and §9 (defaults to confirm).

## 1. What was built

**M0 — scaffold + gallery** (DONE at 5bce619, 06:37 UTC)

- `vlr check` (8 steps), AGENTS.md, the pre-commit hook, the vlt registry pin, the toolchain check.
- The nine spec §12 tables copied verbatim into `src/data/*.json`, plus `map.json` (avenues, lot, regions, 53 props)
  and the `schema.ts` validator run at boot.
- Sim skeleton: seeded Rng, typed events, the §7.1 start state, the 12-step tick order (§2), the ViewSim facade,
  save/load, the `vlr sim` CLI and the gate report.
- Procedural art pipeline (palette, STYLE.md, manifest, generators → normalize → quantize → outline → lint → atlas):
  one 2048² `world` atlas plus the m5x7 glyph sheet. Boot chain, iso render core, `__pm` debug API, dev Gallery.
- Spec sections: §2, §3.1–§3.2, §7.1, §12 (data).

**M1 — city loop** (DONE at 460e515, 08:33 UTC)

- World sim: trimmed road graph + cached A\*, spawning with hidden malware/decoys and the scripted first malware, the
  §4.6 vehicle state machine, the §4.5 greedy dispatcher with reservations, rush and home zones, one loading dock with
  the FIFO lot queue, the generic lane, payouts with decay, satisfaction with both daily caps and drift.
- The competent policy (`src/sim/policy.ts`) and the 10-seed gate.
- CityScene (ground bake, buildings, fog, vehicles, badges, popups, tooltip, all gestures), HudScene, GarageSheet,
  ZonePicker, DistrictPanel, ShieldPopover, autosave, Title Continue/New/Reset. The audio track landed alongside.
- Spec sections: §3–§5, §6.4–§6.5, §7.3, §9.

**M2 — warehouse loop** (DONE at 820e4f4, 12:15 UTC; sim part 63af110)

- The §6 lane: conveyor cap 6 → slots with buffers of 2 → Hold Bay cap 3 → shelf; checkers with process timers, the
  §6.3 roll cases, D(s) compounding, stall propagation; the scripted first malware with a forced catch.
- Toss/Clear with bounty, fee and satisfaction; fixtures buy/move/swap/remove; hire/fire inspectors; lives, the full
  `life:lost` trace, game over; the Q-RUN1 dock deadlock rules + a soak test.
- WarehouseScene (room layout, lane renderer, dock view, workers, catch moment, stall visuals, wanted poster), BuySheet,
  SlotCard, HoldBayCard, drag-to-move; LostLifeCard, GameOverCard; the first-flag funnel.
- Spec sections: §6.1–§6.8, §10, §11.

**M3 — levels, economy, audio, polish** (DONE at 77061cd, 14:32 UTC)

- Levels 1 → 2 with the `playtestMaxLevel = 2` cap ("Lv 3 coming soon", the bar keeps counting), the Industrial
  unlock, tier 2, the `rattle` strain, post-cap malware escalation.
- Payroll with unpaid marks, walkouts and re-hire; the full competent policy (+ COUNTERS / REHIRE extensions); Q-RUN3;
  stable Hold Bay bays.
- PixelLab art installed (63 generated sprites, 3 procedural kept). Audio wired: director, sample preload, Title-tap
  unlock, mute, visibility, sim hooks, Credits card, e2e audio + offline render specs.
- City and warehouse flourishes (unlock fade, level-up dust/stamp, mood overlays, smoke, dock lights, days-since sign,
  tier-2 room), HUD level bar, newspaper, payroll toasts, Garage payroll header.
- Spec sections: §3.3, §5.4 (escalation), §7.4, §8 (L1–L2), §9.2.

**M4 — playtest build, metrics, report** (the commit that carries this report)

- `src/metrics/playtest.ts`: the §12.9 recorder (32 keys, stored to `pm.playtest.v1` every 10 s and on hide);
  `src/ui/SummaryCard.ts` with the fun bar, Download and Copy; the pause menu (❚❚ twice); the 20:00 offer;
  `tests/playtest/seed-7.json` from a 12-minute automated run.
- Build checks: `tools/check-dist.mjs`, `e2e/dist.spec.ts` (a `dist` Playwright project), `public/playtest-README.txt`,
  the inert `.github/workflows/pages.yml`; docs/playtest.md, docs/phone-checklist.md, docs/art-todo.md.
- Review passes fixed 3 sim bugs (an unloadable save after selling vehicles, damaged saves crashing `tick()`, a
  driverless vehicle making a trip), 5 scene bugs (pan freeze on a HUD tap, an orphan 19 MB ground texture, taps on
  hidden vehicles, a 2 s view-switch stall, vehicles clipped by multi-tile buildings) and 6 mobile issues (stale
  Dialogs, the rotate card under the Garage, red toasts dropped, safe-area order, iOS page pinch, 100vh fallback).
- New tests: robustness sweeps (`tests/sim/robustness*.test.ts`), `e2e/lifecycle.spec.ts` (11 storms), 12 UI tests.

**Left as data rows (schema-valid, ignored by the code):** L3–L5 in `levels.json` (Docks/overseas clearance §5.6,
Airport, Low-density residential, Rural, Park & civic), the Battery checker, X-ray and Sorter Arm (`machines.json`),
loading docks 2–3 (`economy.json docks`), Hold Bay cap 5, slots 5–6, strains `battery`/`dense`, magic parcels (§5.5),
`overseasShare`, the Golden Release quest. Locked regions show as fogged scenery with "Unlocks at Lv N".

## 2. How to play

### 2.1 Get the build

Hand-off bundle: `dist-zip/pm-tycoon-77615ef.zip` (5.4 MB, `vlr bundle` of `dist/` built from the M4 commit 77615ef; sha256 prefix 247d26fdbac75807), sent with this report and `pm-tycoon-shots-77615ef.zip` (the 44 PNGs + the 8-bar audio render). Rebuild any time with `vlr build && vlr bundle`.

| Path                    | How                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Desktop devtools     | Serve `dist/` (path 2), open `http://localhost:4173/` in Chrome, devtools → device toolbar → **iPhone 16** (393 × 852, DPR 3), reload.         |
| 2. iPhone via the Mac   | Unzip, `cd dist && python3 -m http.server 4173`, open `http://<mac-lan-ip>:4173/` in Safari (same Wi-Fi; `ipconfig getifaddr en0`).            |
| 3. GitHub Pages (final) | Actions → **Pages** → Run workflow (§11.1). The site is `https://ruyadorno.com/pm-tycoon/` (`ruyadorno.github.io/pm-tycoon/` redirects there). |
| SSH tunnel (Q57)        | Only with a route to the VM: `vlr preview -- --host` there, `ssh -g -L 4173:localhost:4173 <vm>` on the Mac, then the LAN URL on the phone.    |

Plain http works (localStorage, WebGL, the audio-unlock tap; no service worker). Each origin keeps its own save and
profile: `localhost` and the LAN address do not share them. README "How to serve on a phone" has the same steps.

### 2.2 The 60-second tutorial (the in-game text)

1. Onboarding step 1 points at the Garage: **"Buy a bike in the Garage to start delivering"**.
2. Step 2: **"Your inspector catches 85% by hand. A Metal detector ($150) lifts the lane to 97%"**.
3. Step 3, once a building with waiting parcels is on screen: **"Tap a building with waiting parcels to rush a vehicle
   there"**. The first delivery pops a gold `DELIVERED +$20` (gate median 44 s).
4. The first flag of the run: **"A parcel was flagged — open the warehouse to Toss or Clear it"**, then in the room
   **"Flagged parcels wait in the Hold Bay — tap one to Toss or Clear it"**. The scripted malware (from ~2:00) gets the
   red **"A parcel flagged — Toss it. Lives: 3"**; after the first Toss: **"Not every flag is malware — tins, marbles
   and chargers are harmless; typo'd package names are not"**.

### 2.3 The brief: twenty minutes cold, then the summary card

Play **twenty minutes cold** (no debug flags, no help). L2, Industrial, the truck, the Shaky shaker and the tier-2
warehouse all land after minute 10 (gate median L2 13.05 min). Then open the summary card: tap **❚❚** (pause), tap
**❚❚** again for the pause menu → **End run — show summary**. A ticker line and a toast offer it once at 20:00; the
Game Over card has a **Run summary** button. Press **Download playtest.json** and **Copy summary**.

| Fun-bar item (plan §12.9)       | Read from                                         | Gate prediction (seeds 1–10) |
| ------------------------------- | ------------------------------------------------- | ---------------------------- |
| 1. First delivery < 60 s        | `firstDeliveryS`                                  | 44.05 s median, 9/10 seeds   |
| 2. First malware caught by 5:00 | `firstMalware.caughtS ≤ 300`                      | 174.3 s median, 10/10 seeds  |
| 3. L2 in 8–15 min               | `level2AtS`                                       | 13.05 min median, 9/10 seeds |
| 4. You kept playing past 15 min | `elapsedS > 900` at the first opening of the card | only you can judge           |
| 5. Every lost life explainable  | each `livesLost[]` has a counter or was Cleared   | the card shows "you judge"   |

docs/playtest.md explains every field; docs/phone-checklist.md is the device checklist for the same session.

### 2.4 Optional short session: `?debug=1&config=spicy`

`public/configs/spicy.json` sets `malware.baseShare` 0.09 (base 0.05), `decoyShare` 0.30 (base 0.22) and a Hold Bay
of 2 at L1–L2, so a Hold Bay stall and the lost-life card show up within minutes. **Download the cold run's
playtest.json first:** the spicy data changes the data hash, so the Title discards the cold run's save (with the
toast "Save from an older build was reset") and a fresh profile replaces `pm.playtest.v1`. A spicy profile's
`buildStamp` ends in `cfg:spicy`.

### 2.5 URL parameters worth knowing (`src/debug/params.ts`)

| Param                  | Does                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `debug=1`              | `window.__pm`, the fps/draw-call overlay, 4× speed (key `4`); enables `config=`        |
| `config=spicy`         | data override from `configs/spicy.json` (needs `debug=1`)                              |
| `newGame=1`            | ignore the autosave, start fresh                                                       |
| `seed=N`               | the world of seed N (the gate uses 1–10; a new seed starts a fresh profile)            |
| `mute=1` / `audio=0`   | start muted / never create audio                                                       |
| `policy=1`             | the scripted competent player drives the sim (watch the gate's opening)                |
| `fastForward=S`        | run S sim seconds (cap 1800) before the first frame                                    |
| `skipTitle=1`, `view=` | skip the Title; open `city`, `warehouse`, or `gallery&page=1..4` (gallery needs debug) |

## 3. Screenshots

44 PNGs in `shots/` from the final `vlr shots` (2026-10-29 16:23 UTC, HEAD 77061cd + the M4 working tree):
29 iPhone 16 (393×659 CSS, DPR 3), 2 desktop column (430×932, DPR 2), 10 min-fit (360×604, DPR 3), 4 Gallery pages.
Each was read against art/STYLE.md and the view docs. **44/44 PASS**; the notes are cosmetic and listed in §6.

| Shot                                                   | Shows                                                                                                  | Verdict                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| title.png                                              | Title board, white + gold "Tycoon", PixelLab skyline, New game / Reset / Credits, "tuning up…"         | PASS                                   |
| city-0s.png                                            | New game: empty lot, $450, 3 of 5 bombs, onboarding step 1 pointing at Garage, Hoist Hill fogged       | PASS                                   |
| city-30s.png                                           | Policy at 0:30: $100 after bike + detector, chips row, ticker headline, shield 97 %                    | PASS                                   |
| city-30s-430x932.png                                   | Same in the 430×932 desktop column                                                                     | PASS (board shows through the top bar) |
| city-first-delivery.png                                | Gold `DELIVERED +$20`, "+$20" float, bar $20 / $2,000, "0 days" board                                  | PASS                                   |
| city-zoom2.png                                         | Zoom 2 on Bike 1 queued at the dock, follow strip                                                      | PASS                                   |
| city-rush.png                                          | Cache Cafe tooltip "Rushed · 0:59", bell + ring                                                        | PASS (board shows through the top bar) |
| city-late-badge.png                                    | Plain / amber / red waiting badges clearly distinct                                                    | PASS                                   |
| city-locked.png                                        | Fogged Hoist Hill, "Unlocks at Lv 2 / Trucks only" board, active chip                                  | PASS                                   |
| city-10min.png                                         | Seed 7 policy at 10:00: $1,269 / $2,000, mood 29 (angry), red late badges                              | PASS (balance note, §6.1)              |
| garage.png, garage-430x932.png                         | Garage: payday header, payroll $28/day, Bike 1 row, van red (unaffordable), truck "Unlocks at Lv 2"    | PASS (430: empty area)                 |
| garage-zone-picker.png                                 | Any ✓ / Node Heights / Registry Row; locked rows greyed with their level                               | PASS                                   |
| district-panel.png                                     | Registry Row: satisfaction 63, favours van, earned $40, waiting 4 · oldest 1:12                        | PASS (empty lower half)                |
| paused.png                                             | Scrim, "Paused — tap to resume", the new `End run — show summary` button, ❚❚ latched                   | PASS                                   |
| warehouse-l1.png, -360x604                             | L1 room: "Lane: 15/min · Detection 97%", desk + inspector, detector, locked slot 4, poster             | PASS (toast over the sign)             |
| warehouse-catch.png, -360x604                          | Forced catch: dark parcel + red bomb at the desk, first-flag funnel toast                              | PASS                                   |
| warehouse-holdcard.png, -360x604                       | HoldBayCard: react-dom@18.3.1, route, "Flagged by: Inspection desk", value $45, red TOSS / green CLEAR | PASS                                   |
| warehouse-stalled.png, -360x604                        | "Lane: STALLED (Hold Bay full)", three bays full, red slot outline and rack lamp                       | PASS                                   |
| warehouse-buysheet.png, -360x604                       | Slot 3 sheet: Metal detector $150 in red at $92, Move desk here, shaker Lv 2, Lv 3/4 "coming soon"     | PASS                                   |
| lost-life.png, -360x604                                | "MALWARE DELIVERED": evil-lodash, mm:ss trace, catch rate 97 %, "Cleared by you at 03:11"              | PASS                                   |
| game-over.png, -360x604                                | GAME OVER stats, New game + the new `Run summary` button                                               | PASS                                   |
| level-up.png                                           | Dust over the warehouse, gold "LEVEL 2 — LOCAL", Industrial mid-fade, "Lv 3 coming soon"               | PASS (fx_dust note, §6.23)             |
| industrial-unlocked.png                                | Hoist Hill in colour, chimney smoke, tier-2 warehouse                                                  | PASS                                   |
| newspaper.png                                          | THE NODE HEIGHTS GAZETTE, Day 13 / Lv 2, tier-2 photo                                                  | PASS                                   |
| shield-popover.png                                     | metal 99 % green, rattle 89 % amber → Shaky shaker $300                                                | PASS                                   |
| payroll-short.png                                      | $0, red "Payroll short: Audrey, Dee unpaid", Garage "!"                                                | PASS                                   |
| warehouse-tier2.png, -360x604                          | Tier-2 room: blue floor, plates, slot 4 unrolled, shelf 1/45                                           | PASS                                   |
| warehouse-l2.png, -360x604                             | Fixture l2-lane: detectors in slots 2–3, shaker in 4, Detection 99 %, shelf 12/45                      | PASS                                   |
| summary-card.png                                       | 12-min run (seed 7, real time at 4×): $1,727, 73 deliveries, fun bar ✓ ✓ – ✗ ✓, four buttons           | PASS ("3:03 played" is wall time)      |
| summary-card-360x604.png                               | Card layout at 360×604 on a fast-forwarded state                                                       | PASS for layout (data: §6.9)           |
| m0-gallery.png, m0-map.png, m0-palette.png, m0-hud.png | Gallery: 442 frames 1× over 2×, the 48×48 map, the 48 colours by ramp, the HUD mock with hit rects     | PASS                                   |

Audio renders in `shots/audio/` (listen on headphones and on the phone speaker): `semver-swing-8bars.wav` (2.8 MB;
peak 0.324, bar RMS −24.6 … −22.9 dBFS) and `semver-swing-full.wav` (22.9 MB, one 130.1 s pass; peak 0.438, tune RMS
−25.3 … −22.4 dBFS, tail −120 dBFS). The brushes (off by default) render at −47.1 dBFS.

## 4. Gate results

`vlr sim:gate`: seeds 1–10 × 30 min, competent policy, data `2112987b`. **GATE PASS** on medians. The final full run
(4 s) wrote docs/gate/latest.{md,json} byte-identical to the M3 commit.

| Window (`economy.pacingTargets`)        | Median    | Target   | Min / max     |
| --------------------------------------- | --------- | -------- | ------------- |
| First delivery                          | 44.05 s   | < 60 s   | 33.3 / 60.8   |
| Scripted malware caught                 | 174.3 s   | ≤ 300 s  | 154.4 / 197.7 |
| Level 2                                 | 13.05 min | 8–15 min | 10.93 / 16.23 |
| Truck bought after L2                   | +2.10 min | ≤ 4 min  | 0.92 / 5.11   |
| Lives lost (Toss-everything)            | 0         | 0        | 0 / 1         |
| Shelf stall                             | 0 s       | 0 s      | 0 / 0         |
| Hold Bay events per 10 min at L1        | 7.15      | ≥ 6      | 4.31 / 9.20   |
| Wrong tosses (informational)            | 19        | —        | 11 / 27       |
| Malware share at 30 min (informational) | 20 %      | —        | 20 / 20       |

| Seed | First del. s | Caught s | L2 min    | Truck +min | Lives | Hold/10 min L1 | Misses                       |
| ---- | ------------ | -------- | --------- | ---------- | ----- | -------------- | ---------------------------- |
| 1    | 57.3         | 154.4    | 11.44     | 1.17       | 0     | 7.87           | —                            |
| 2    | 58.3         | 178.1    | 13.78     | 3.86       | 0     | 8.71           | —                            |
| 3    | 54.8         | 161.8    | 14.40     | **5.11**   | **1** | 7.64           | truck late, one life lost    |
| 4    | 50.8         | 172.1    | 10.93     | 0.92       | 0     | 7.32           | —                            |
| 5    | **60.8**     | 176.5    | 13.05     | 1.81       | 0     | 9.20           | first delivery 0.8 s over    |
| 6    | 37.3         | 180.0    | **16.23** | 3.96       | 0     | **4.31**       | L2 late, few Hold Bay events |
| 7    | 33.3         | 191.0    | 12.91     | 2.27       | 0     | 6.97           | —                            |
| 8    | 37.3         | 197.7    | 13.46     | 1.26       | 0     | **4.46**       | few Hold Bay events          |
| 9    | 37.3         | 166.4    | 13.04     | 2.69       | 0     | 6.13           | —                            |
| 10   | 37.3         | 166.0    | 12.51     | 1.93       | **1** | 6.39           | one life lost                |

5/10 seeds pass every window, the same as at M3. Shelf stall is 0 s on every seed.

**JSON values changed from spec §12.** A script diff of the spec tables against `src/data/*.json` finds exactly these:

| Key                                         | Spec → shipped | When | Rule and evidence                                                                                                                                                                     |
| ------------------------------------------- | -------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parcels.malware.baseShare`                 | 0.03 → 0.05    | M2   | Gate row `holdBayEventsPer10MinMin` (plan Q-R2 levers, numbers after code per §7.6): at spec values the L1 density was ~4/10 min.                                                     |
| `parcels.decoyShare`                        | 0.10 → 0.20    | M2   | Same row. 40-seed study on the L1 window: 0.15 → median 6.67 (18/40 seeds < 6); 0.20 → 7.50 (13/40).                                                                                  |
| `parcels.decoyShare`                        | 0.20 → 0.22    | M3   | Same row once the policy bought a 2nd detector: quick gate 5.97 → 7.87, full 6.59 → 7.15; seeds < 6: 21/80 → 11/80. `baseShare` 0.06 was tried first and rejected (lives median → 1). |
| `vehicles.types[truck].price`               | 1300 → 1200    | M3   | Row `truckAfterLevel2MaxMin`, §7.6 "truck late → lower its price": quick gate +5.18 → +3.86 min; seeds > 4 min: 29/80 → 12/80. The sell refund becomes $600.                          |
| `economy.satisfaction.waitingPenaltyAfterS` | (new) 180      | M1   | Q-RUN2: the spec's "crosses 180 s" moved from code into data. Not a retune.                                                                                                           |

Also: `malware.postVictoryPerDay` 0.005 was tried and reverted (it moved no row). Outside §12,
`public/configs/spicy.json` `decoyShare` went 0.20 → 0.30 so spicy stays above the new base. Policy extensions (code,
not data): COUNTERS cut the share of 80 seeds losing ≥ 1 life in 30 min from 37/80 to 22/80; REHIRE re-hires walked-out
workers.

**Robustness notes**

- The lives window is dice: at a lane detection of ~0.97–0.99 with the post-cap escalation, ~19–29 % of 80 seeds lose
  one life in 30 min; seeds 1–10 pass on the median with 2/10 losing one.
- Longer sessions: under the policy 6 of 20 seeds (1, 3, 9, 10, 14, 17) lose all 3 lives by minute 90, from post-cap
  escalation to the 20 % cap. A long phone session will end in game over at about that rate.
- Hostile players (bad player 20 seeds, chaos 10 + 152 scratch seeds, idle 3) ran under an every-tick invariant
  monitor: 0 problems. Every save/load and replay comparison matched. Tick p99 0.089 ms (budget 1 ms); save 46.6–58.6
  KB at 60 min.
- `vlr sim -- --minutes 30 --seed 1`: level 2 at tick 6864, no `level:up {3}`; at minute 30 lvl 2, $3,340, 222
  deliveries, 3 lives.
- **L3–L5 rows (`level3Min` … `level5Min`) are not measured**: the counter stops at 2, so no run reaches L3.

## 5. Tests and checks

All at the final M4 working tree (HEAD 77061cd + the M4 changes); all green.

| Check                      | Result                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vitest                     | 64 files, 1,082 tests: 1,081 passed, 1 todo, 0 failed (42 s). Growth: M0 430 → M1 632 → M2 818 → M3 950 → M4 1,082.                                                                        |
| `vlr check`                | PASS in **84.4 s** (target < 3 min): toolchain 0.2, typecheck 7.9, lint 0.3, fmt 0.5, test 42.1, art:lint 1.3, quick gate 1.1, e2e:smoke 31.1 s.                                           |
| `vlr e2e`                  | Exit 0 in 461 s: **65 passed, 49 skipped** (skips are project-scoped), 0 failed. iphone16: smoke 4, audio 4, audio-render 1, lifecycle 11, shots 29; dist 4; desktop-column 2; min-fit 10. |
| `vlr shots`                | 41 passed in 279 s (44 PNGs + `tests/playtest/seed-7.json`).                                                                                                                               |
| `vlr audio:render`         | PASS in 58 s (metrics in §3).                                                                                                                                                              |
| `vlr build` + check-dist   | PASS: 4.88 MB raw transfer (~3.20 MB gzip) in 63 files vs the 6 MB budget; sourcemaps (14.59 MB) and the dev gallery (2.06 MB) excluded.                                                   |
| JS chunks (gzip)           | phaser 353.3 kB, index 154.9 kB, director (lazy) 73.0 kB, policy 1.5 kB, offline 1.0 kB; world.png 2048² at 1,584 kB; samples 1.03 MB.                                                     |
| `vlr sim:gate`             | GATE PASS in 4 s (§4).                                                                                                                                                                     |
| Cold install               | `/tmp/pm-check` copy (805 files): `vlt install` 2.8 s with an empty cache; lockfile 0 registry.vlt.io / 231 npmjs entries; `vlr check:quick` PASS in **27.3 s** (target < 40 s).           |
| AI attribution in history  | The `git log` grep for the four patterns prints **0** over 18 commits.                                                                                                                     |
| Browser perf (SwiftShader) | 30-min `?policy=1` run: heap 8.7 → 13.1 MB, textures 7 → 9, draw calls 4–5, fps p50 60–61, no leak, no console error.                                                                      |
| Draw calls by view         | City 3, Garage over City 6, Warehouse at L2 6, district panel 8, **Garage over Warehouse 9** (budget 8).                                                                                   |

A first cold-install copy under `$CLAUDE_JOB_DIR/tmp` failed lint with "No files found to lint": the VM's global git
excludes list `.claude/` and oxlint honours it. The `/tmp/pm-check` copy (the plan's own path) is the valid result.
WebKit cannot launch on this VM (root-only system libraries), so every browser check ran in Chromium.

## 6. Known bugs and rough edges

Nothing here blocks the playtest. File references are to the M4 tree.

**Balance (not tuned; R5 tunes gate rows only)**

1. Satisfaction drifts angry under the policy during L2 (seed 7: 61 at 3 min → 26 at 12 → 6 at 30; mood 29 in
   `city-10min.png`). Late deliveries (`economy.json satisfaction.late` −3, uncapped) outweigh `positiveCapPerDay` +4
   (`src/sim/systems/satisfaction.ts:53`). Levers: `late`, `positiveCapPerDay`, or more vehicles in the policy.
2. L1 plateau, minutes 7–13: nothing new to buy besides the $1,000 van (`levels.json` L1). This is a risk for fun-bar
   item 4.
3. The lives window is dice (§4), and long sessions end in game over (6/20 policy seeds by minute 90).
4. The music is unheard: it was judged by render metrics only (R3). Your phone is the ear.

**UI and UX**

5. Desktop only: the pause menu is not on the modal stack (`src/ui/PausedCard.ts:105` `show()`, `:110` `hide()`).
   W switches views under it, Esc in the Warehouse goes back to the City, and G opens the Garage over it. Fix:
   push/popModal in show/hide and claim Esc.
6. The ticker trails the clock: one FIFO of 8 lines at 40 px/s (`src/ui/Ticker.ts:24-25`). In the M3 journey runs it
   still showed "Day 5: …" at 13:16 and "Day 15: …" at 20:21, and after the 13:13 level-up the "Close call!" line held
   before the stale daily line. If 8+ lines queue, the 20:00 offer line can drop (its toast still shows).
7. Warehouse toasts sit on the room's north wall, over the "DAYS SINCE LAST INCIDENT" sign (`src/scenes/HudScene.ts`
   `toastLane()`, ~line 2395), chosen so they never cover the lane readout. `warehouse-l1.png` shows a payday toast
   there, and the Hold Bay funnel toasts land on it too.
8. World boards ("Unlocks at Lv 4") show faintly through the 0.94-alpha top bar (`HudScene.ts:268 TOP_ALPHA`) in
   city-rush, city-30s-430x932, garage-430x932 and district-panel.
9. The summary card computes "played" and taps/min from wall time (`src/metrics/playtest.ts:713`). A profile opened
   seconds after a `fastForward` reads "0:00 played" and "Taps per min 200.0". A real session is unaffected.
10. Fixed at hand-off: the Garage sell prompt now reads "Its parcels go back to the warehouse." (collected,
    not-yet-inspected parcels go back through the lane; outbound cargo returns to the shelf — decisions.md).
11. The Title's Credits card is not modal (`src/scenes/TitleScene.ts:106`): Reset can open over it.
12. Enter on the Game Over card starts a new game at once (`src/ui/GameOverCard.ts:184`), skipping the summary.
13. The spicy session discards the cold run's save with the misleading toast "Save from an older build was reset"
    (`src/boot/autosave.ts:246`, the data-hash check). This is mitigated in the docs only; the code fix is a save key per
    config.
14. The district panel and the 430-column Garage have large empty areas (fixed-height layouts).
15. Reasoned, not reproduced: a Garage tap in the same frame a lost-life or game-over card opens may put the Garage
    above the card (HudScene `prepareModal()`); closing the Garage reveals the card.
16. Long-press vibration (`src/scenes/CityScene.ts:2044`) is ignored by iOS.

**Platform and performance**

17. Samples are fetched before the Title tap (51/51 in `e2e/dist.spec.ts`), per audio.md §3.2/§8.2
    (`src/scenes/PreloadScene.ts:79`); plan §12.7 task 3 says "after the tap". Nothing sounds before the tap. See §7 R14.
18. The Phaser chunk is 353 kB gzip against the ~300 kB estimate in plan §6.11; total transfer is well inside 6 MB.
19. Garage over Warehouse makes 9 draw calls against ≤ 8, only while that sheet is open.
20. iOS-only behaviours are unverified (no WebKit here): env() safe areas, 100dvh with Safari's floating toolbar,
    `gesture*` blocking, copy-box zoom, rotating with a card open. They are in docs/phone-checklist.md.
21. `public/assets/world.{png,json}` are unhashed: after a Pages redeploy (max-age 600 s), a new JS bundle can briefly
    meet a cached old atlas. A build-2 concern.
22. Fixed at hand-off: `vite.config.ts` sets `build.chunkSizeWarningLimit: 1600` (the phaser chunk is large by design).

**Art** (details and re-roll commands in docs/art-todo.md)

23. `fx_dust` (level-up) reads as a field of separate puffs, not one cloud (`tools/art/fx.ts:278`).
24. The `worker` scan frames come from PixelLab's picking-up template (bend/crouch) and are ~25 px tall, so the
    inspector can sink behind the desk while scanning.
25. `bike` is an orange delivery scooter (real cargo bikes broke the 1-px margin). `cv_stadium` sits among townhouses
    (only its fogged frame ships). 18 sprites carry A12 warnings (17–20 colours, all within the palette).

**Sim edge cases (minor, left as is)**

26. A driver who walks out after part of the outbound set is loaded finishes loading and delivers ("finishes its trip").
27. A rush given during a stop where nothing fits keeps `rushBuildingId` until the flag expires.
28. A sim ticked after game over keeps running (the HUD holds the stepper, so the game is unaffected).

**Build and hand-off**

29. The hand-off build was made after removing the dev-only `public/gallery/` (gitignored, regenerated by
    `vlr art:gallery`); the 14.59 MB of sourcemaps stay in `dist/` and the zip for debugging (never loaded by the game
    unless devtools open).
30. `pages.yml` is unverified until its first run (Q58), including whether `setup-node@v4` resolves Node 26.
31. Fixed at hand-off: `tools/check-sim-purity.mjs` (and AGENTS.md) now list `src/render/vehicleDepth.ts` and
    `src/input/GestureClassifier.ts` as Phaser-free.

## 7. Open questions

The 79 questions of plan §14 are in the table of §9, each with its shipped default and where it is coded. These are
the questions raised during the run (docs/decisions.md and the status "Open" lines), each with the default taken.

| #   | Question                                                   | Default taken                                                                                                                                                                    | Code                                                                 |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| R1  | Q-RUN1: one dock + a full shelf deadlocks                  | Yield after `dockIdleWaitS`; stall preference; the shelf takes the lane's parcels past its cap until the docked vehicle has unloaded                                             | `src/sim/systems/{docks,dispatch}.ts`, `tests/sim/dock-soak.test.ts` |
| R2  | Q-RUN2: waiting-penalty threshold in data                  | `economy.satisfaction.waitingPenaltyAfterS = 180`                                                                                                                                | `satisfaction.ts`, `schema.ts`                                       |
| R3  | Q-RUN3: the scripted malware waited up to 8 min for pickup | Origin narrowed to where a vehicle collects next; any servable building after `deferUntilCheckerS`                                                                               | `src/sim/systems/spawn.ts` `nextPickupOrigins`                       |
| R4  | Selling a vehicle with inbound cargo                       | Collected-but-uninspected parcels go through the lane; only outbound cargo returns to the shelf                                                                                  | `src/sim/systems/vehicles.ts` `sellVehicle`                          |
| R5  | Wrong Toss of a same-district parcel                       | −3 once, not twice                                                                                                                                                               | `src/sim/systems/holdbay.ts`                                         |
| R6  | Lost-life card rates                                       | From the parcel's own rolls (the lane when it passed)                                                                                                                            | `src/sim/detection.ts` `lostLifeReport`                              |
| R7  | Trait icon on generalist flags                             | None (it would give decoys away); machines show their strain                                                                                                                     | `HoldBayCard.ts`, `LaneRenderer.ts`                                  |
| R8  | The first flag is often a decoy                            | Any first flag gets the neutral funnel toast + arrow; the scripted malware keeps "Toss it"                                                                                       | `src/ui/Onboarding.ts:192-197`, `HudScene.ts`                        |
| R9  | A busy checker                                             | Backpressure, not a stall; the policy's 2nd-inspector rule is re-based on dock-blocked time                                                                                      | `src/sim/systems/lane.ts`, `src/sim/policy.ts`                       |
| R10 | Competent policy beyond spec §7                            | COUNTERS (a counter machine at price + $50) and REHIRE (fee + $50)                                                                                                               | `src/sim/policy.ts`                                                  |
| R11 | Walkout during `docked_loading`                            | Departs and delivers what is loaded (§4.6 over §11); M4: empty in the dock → inactive at once                                                                                    | `payroll.ts` `walkOut`, `docks.ts` `loadTick`                        |
| R12 | Payroll details                                            | `payroll:paid` only when > 0; pay order keeps the hire time after a re-hire; "Seat held for re-hire"                                                                             | `src/sim/systems/payroll.ts`, `commands.ts`                          |
| R13 | Hold Bay bays                                              | Stable: a held parcel keeps its bay                                                                                                                                              | `src/sim/systems/holdbay.ts`                                         |
| R14 | Samples load before or after the Title tap                 | Before (audio.md, which plan §11 names the audio contract); nothing sounds before the tap. Loading after the tap would delay the first notes until the 1.03 MB of samples arrive | `src/scenes/PreloadScene.ts:79`, `src/audio/director.ts`             |
| R15 | Where the pause menu lives                                 | The Paused card, opened by ❚❚ while paused; the first pause toasts "Paused — tap pause again for the menu"                                                                       | `src/ui/PausedCard.ts`, `HudScene.ts:297`                            |
| R16 | Summary on game over                                       | Opened by the card's `Run summary` button (not automatically); `Back` replaces `Keep playing`                                                                                    | `src/ui/GameOverCard.ts`, `src/ui/SummaryCard.ts:59`                 |
| R17 | New game from the summary during a live run                | Asks first (destructive confirm)                                                                                                                                                 | `HudScene.ts` `NEW_GAME_CONFIRM_*`                                   |
| R18 | Fun-bar items 4 and 5                                      | 4 is judged at the first opening of the card (persisted); 5 reads "you judge" when every loss is explainable                                                                     | `src/metrics/playtest.ts` `funBar`                                   |
| R19 | Resuming a profile after a reload                          | `pm.playtest.v1` = §12.9 + a `restore` record; the download and `__pm.playtest()` are exactly §12.9                                                                              | `src/metrics/playtest.ts`, `src/boot/autosave.ts`                    |
| R20 | A damaged save with a matching data hash                   | Validated on load; discarded with the stale-save toast instead of crashing                                                                                                       | `src/sim/validate.ts`                                                |
| R21 | Conveyor over cap after sales                              | Allowed only for sold-vehicle cargo                                                                                                                                              | `src/sim/sim.ts` `auditState`, `lane.ts` `isSoldInbound`             |
| R22 | Vehicles in front of multi-tile buildings                  | Drawn in front; a hidden vehicle is not tappable; district plates and lock boards are picked first                                                                               | `src/render/vehicleDepth.ts`, `CityScene.ts`                         |
| R23 | The spicy session and the cold save                        | The docs say to download first; no code change                                                                                                                                   | README, `public/playtest-README.txt`                                 |
| R24 | The lives window is dice                                   | Accepted; seeds 1–10 pass on the median                                                                                                                                          | docs/gate/latest.md                                                  |
| R25 | Satisfaction drifts angry under the policy                 | Not tuned (not a gate row)                                                                                                                                                       | `economy.json satisfaction`                                          |
| R26 | L1 plateau, minutes 7–13                                   | Not tuned; watch `moneyPerMin` and fun-bar item 4                                                                                                                                | `levels.json`                                                        |
| R27 | The music is unheard                                       | Ships live; you decide after listening (`audio.json music: 'off'` = SFX only)                                                                                                    | `src/data/audio.json`                                                |
| R28 | Top bar / ticker alpha                                     | 0.94 (city-view's 0.85 let world labels read through)                                                                                                                            | `HudScene.ts:268`, `Ticker.ts:29`                                    |
| R29 | Reserved red                                               | Red means danger only: the style guide's red barn/roofs/bike are orange; `sign_locked` is 96×52 so its text fits                                                                 | `art/STYLE.md` §4, `tools/art/*.ts`                                  |
| R30 | Other view-level deviations (M0–M3)                        | One per line in docs/decisions.md ("View-level deviations")                                                                                                                      | —                                                                    |

## 8. Art approval requests

**State** (art/manifest.json, 234 ids): 168 procedural (final by design) and 66 PixelLab-class. Of those 66, 63 are
generated and installed and 3 stay procedural placeholders (`desk`, `shelf_t1`, `shelf_t2`: their candidates failed the
sprite contract). One 2048² atlas with 442 frames; `vlr art:lint` reports 0 errors and 19 warnings (18 × A12 plus the
placeholder line).

| Gate | What to look at                                                                                                                                                                | State                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| G1   | `art/palette.png` (48×1), `art/contact/palette-ramps@4x.png`, `art/STYLE.md` (§8 palette, §10 provenance)                                                                      | Awaiting you (Q41)                                   |
| G2   | `art/contact/anchors@4x.png`, `anchors-incontext@4x.png`: `dt_scope_offices`, `hr_async_arms`, `in_esbuild_engines`, `cv_civic_2x2`, `van`, `worker`, `metal_detector`         | Agent-approved provisionally (`approvedBy: 'agent'`) |
| G3   | `art/contact/buildings-{downtown,highres,industrial}@4x.png`, `scenery-locked`, `docks`, `vehicles`, `warehouse-exterior`, `warehouse-interior`, `city-sample` (all `@4x.png`) | 56 ids installed with `approved: false`              |
| —    | `art/contact/procedural@4x.png`                                                                                                                                                | Final by design                                      |

The 56 G3 ids are listed by category in docs/art-todo.md. The bulk pass used text prompts only, because both
style-reference routes copied the anchors' structure. So the G3 sprites were not generated from the anchors, and
rejecting an anchor re-rolls only that id.

PixelLab balance: **5,000 → 3,300** generations (Tier 2 monthly allowance), $0 credits.

- Confirm: `vlr art:approve -- dt_scope_offices hr_async_arms …` (sets `approvedBy: 'author'`; no image changes).
- Reject and re-roll one id (needs `PIXELLAB_TOKEN` in `.env`):
  `vlr art:reject -- cv_stadium "townhouses around the pitch"` → `vlr art:gen -- --ids cv_stadium --n 3 --seed 5000`
  → pick from the printed `art/contact/candidates-*@4x.png` → `vlr art:approve -- cv_stadium:4` → `vlr art:build` →
  `vlr check`. On a fresh clone, pass a new `--seed` base (`art/candidates/` is gitignored).
- A procedural id (`fx_dust`, `desk`, `shelf_t1`, …) is redrawn in `tools/art/*.ts` and rebuilt by `vlr art:build`;
  no token needed.

## 9. Decisions to confirm (plan §14)

Each default ships as stated unless the last column says otherwise. **Changed** = a run decision moved it.

| #   | Question (tag)                                        | Shipped                                                   | Where coded                                                               | Run change                                                                                    |
| --- | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Start money (Q-SP1)                                   | $450                                                      | `economy.json startMoney`                                                 | —                                                                                             |
| 2   | Thresholds, van and truck prices (Q-SP2)              | $2k/$5k/$9k/$16k; van $1,000; truck **$1,200**            | `levels.json`, `vehicles.json`                                            | **Changed**: truck $1,300 → $1,200 (§4)                                                       |
| 3   | Walkout after 2 unpaid paydays, no bankruptcy (Q-SP3) | Yes; re-hire = one day's salary                           | `employees.json`, `src/sim/systems/payroll.ts`                            | Refined (§7 R11, R12)                                                                         |
| 4   | Bike carries S and M (Q-SP4)                          | Yes                                                       | `vehicles.json types[bike].sizes`                                         | —                                                                                             |
| 5   | Specialists 0.80/0.15, inspector 0.85 at 4 s (Q-SP5)  | Yes                                                       | `machines.json`, `employees.json`, `src/sim/detection.ts`                 | —                                                                                             |
| 6   | One desk, ≤ 3 inspectors (Q-SP6)                      | Yes                                                       | `employees.json`, `src/sim/commands.ts:242,298`                           | —                                                                                             |
| 7   | Waiting penalty −2, capped −6/day (Q-SP7)             | Yes                                                       | `economy.json`, `satisfaction.ts:58`                                      | Threshold moved to data (Q-RUN2)                                                              |
| 8   | Locked regions' roads routable (Q-SP8)                | Yes                                                       | `src/sim/roads.ts` (header)                                               | —                                                                                             |
| 9   | Dock 3 at L4 for $2,000 (Q-SP9)                       | Data row                                                  | `economy.json docks`                                                      | —                                                                                             |
| 10  | Overseas hubs via `zoneDistricts` (Q-SP10)            | Data row                                                  | `districts.json`                                                          | —                                                                                             |
| 11  | Machine removal refund 50 % (Q-SP11)                  | 50 %; the desk is free                                    | `machines.json removalRefund`, `commands.ts:283`                          | —                                                                                             |
| 12  | Magic parcels skip checkers (Q-SP12)                  | Data row                                                  | `parcels.json magic`                                                      | —                                                                                             |
| 13  | Level counter capped at 2 (Q-SP13)                    | Capped                                                    | `economy.json playtestMaxLevel`, `src/sim/systems/levels.ts:49`           | —                                                                                             |
| 14  | Positive satisfaction cap +4/day (Q-SP14)             | Yes                                                       | `economy.json`, `satisfaction.ts:53`                                      | — (drift note, §6.1)                                                                          |
| 15  | No `packageManager` field (Q-T1)                      | Yes                                                       | `tools/check-toolchain.mjs`, AGENTS.md                                    | —                                                                                             |
| 16  | Sim events beyond §11 (Q-T3)                          | Kept; `lane:changed` dropped                              | `src/sim/events.ts:156-165`                                               | —                                                                                             |
| 17  | oxfmt style (Q-T2)                                    | Single quotes, no semicolons, trailing commas, 80 columns | `.oxfmtrc.json`                                                           | Also ignores fixtures, gate output and the manifest                                           |
| 18  | `vlr check` = quick gate + e2e smoke (Q-T4)           | Yes                                                       | `tools/check.mjs`                                                         | M4: quick skips `*.long.test.ts`; the smoke step adds `dist.spec`                             |
| 19  | Pre-commit hook via `core.hooksPath` (Q-T5)           | Kept                                                      | `.githooks/pre-commit` (local git config)                                 | —                                                                                             |
| 20  | Artifact hosting of `dist/` (Q-T7)                    | Skipped                                                   | —                                                                         | —                                                                                             |
| 21  | Water static in the bake (Q-C1)                       | Static (frame 0)                                          | `src/render/ground.ts:89`; shimmer frames in `tools/art/tiles.ts:127`     | —                                                                                             |
| 22  | Lot layout (Q-C3)                                     | Dock, queue and parking tiles as stated                   | `map.json lot`                                                            | **Changed**: parking order starts at (26,25), on visible tiles (+2.5 s to the first delivery) |
| 23  | Days-since sign at (26,20) (Q-C4)                     | Yes                                                       | `map.json lot.sign`, `src/render/cityFx.ts`                               | —                                                                                             |
| 24  | Vehicle origin (0.5, 0.75) (Q-C6)                     | Per-type foot point                                       | `VEHICLE_FOOT` (`src/render/frames.ts`), `VehicleView.ts`                 | **Changed**: read from the manifest (the PixelLab canvases differ)                            |
| 25  | 6×6 zone dot on the roof (Q-C8)                       | Yes                                                       | `src/render/VehicleView.ts`                                               | —                                                                                             |
| 26  | Double-tap = rush + zoom (Q-C9)                       | Yes                                                       | `src/scenes/CityScene.ts`                                                 | M4: hidden vehicles are not tappable                                                          |
| 27  | Docked vehicle as a 40×40 tail (Q-W4)                 | Yes                                                       | `src/render/warehouse/DockView.ts`                                        | City side: a render-only dock pose on the SW face                                             |
| 28  | Parcel sprites 16/20/24/28 px (Q-W5)                  | Yes                                                       | `tools/art/parcels.ts`                                                    | —                                                                                             |
| 29  | Coin ring only in the Hold Bay and cards (Q-W6)       | Yes                                                       | `src/ui/warehouse/HoldBayCard.ts`                                         | —                                                                                             |
| 30  | Long-press 450 ms drag; a drop swaps (Q-W2)           | Swap                                                      | `WarehouseScene.ts`, `src/sim/systems/lane.ts`                            | —                                                                                             |
| 31  | A moved fixture restarts the process (Q-W3)           | Yes                                                       | `src/sim/systems/lane.ts`                                                 | —                                                                                             |
| 32  | Cleared parcel: clean frame + badge (Q-W10)           | Yes                                                       | `src/render/warehouse/LaneRenderer.ts`                                    | —                                                                                             |
| 33  | Cracked sign until the counter reaches 1 (Q-W11)      | Yes                                                       | `src/render/cityFx.ts:164`                                                | —                                                                                             |
| 34  | " · coming soon" past the cap (Q-W12)                 | Yes; no "next build" string                               | `WarehouseScene.ts:165`, `BuySheet.ts`                                    | —                                                                                             |
| 35  | Clear refused at the shelf cap (Q-W15)                | Refused ("Shelf full")                                    | `src/sim/systems/holdbay.ts:85`, `HoldBayCard.ts`                         | —                                                                                             |
| 36  | Stalled readout wording (Q-W9)                        | `Lane: STALLED (Hold Bay full) · Detection 97%`           | `LaneRenderer.ts:230`                                                     | —                                                                                             |
| 37  | City → warehouse transition (Q-W13)                   | Pan + integer snap to zoom 2 + 120 ms fade                | `CityScene.ts`, `WarehouseScene.ts:30`                                    | M4: camera requests are ignored during the exit pan                                           |
| 38  | District `$ earned` = deliveries to it (Q-C7)         | Destination side                                          | `src/sim/systems/economy.ts`, `DistrictPanel.ts`                          | —                                                                                             |
| 39  | The newspaper does not pause; 6 s (Q-C11)             | Yes                                                       | `src/ui/Newspaper.ts:44`                                                  | Level papers wait 2.4 s after the stamp                                                       |
| 40  | `continueWithOneLife` false (Q-M29)                   | False                                                     | `economy.json`, `GameOverCard.ts`                                         | —                                                                                             |
| 41  | Original 48-colour palette (Q-A1)                     | Original                                                  | `art/palette.json`, `art/palette.png`                                     | Awaiting G1 (§8)                                                                              |
| 42  | Interior 32-px cells at zoom 1 (Q-A3)                 | Yes                                                       | `src/render/warehouse/RoomLayout.ts`                                      | —                                                                                             |
| 43  | `building3x3` class 192×224 (Q-A2)                    | Yes                                                       | `tools/art/manifest.ts:64`                                                | —                                                                                             |
| 44  | Warehouse exterior 256×256; t2 = an edit of t1 (Q-A8) | Yes                                                       | `tools/art/manifest.ts:65`; the `edit-image-pro-flash` batch              | —                                                                                             |
| 45  | Placeholders may ship (Q-A9)                          | 3 ship (`desk`, `shelf_t1`, `shelf_t2`)                   | `art/manifest.json placeholder`                                           | —                                                                                             |
| 46  | `pauseOnBlur = false` + AudioDirector (Q-P4)          | Director                                                  | `src/audio/director.ts`, `BootScene.ts`                                   | The Title also retries unlock on pointerup (iOS)                                              |
| 47  | Music plays at 0× and under the lost-life card (Q-S3) | Yes; tape-stop on `life:lost`                             | `src/audio/director.ts`                                                   | —                                                                                             |
| 48  | Drumless v1 (Q-S1)                                    | Brushes off                                               | `semver-swing.json parts.brushes: false`                                  | The ride/hat arrays were fixed (they rendered silence)                                        |
| 49  | Samples vendored at step 3 (Q-S2)                     | 47 mp3, 1.03 MB                                           | `public/audio/sf/`, `tools/audio/vendor.mjs`                              | —                                                                                             |
| 50  | 18 SFX (Q-I1)                                         | 18 + ride/hat = 20 keys                                   | `src/data/sfx.json`; throttles in `audio.json`                            | —                                                                                             |
| 51  | Live track, unheard (Q-S7)                            | `music: 'live'`                                           | `src/data/audio.json`                                                     | One render-metric iteration (gain staging)                                                    |
| 52  | Credits = CREDITS.md + Title card (Q-S5)              | Yes                                                       | `CREDITS.md`, `TitleScene.ts:70`                                          | — (the card is not modal, §6.11)                                                              |
| 53  | In-repo m5x7 exporter (Q-M8)                          | Yes                                                       | `tools/art/font.ts`                                                       | —                                                                                             |
| 54  | First-malware gate = caught ≤ 300 s (Q-M4)            | Yes                                                       | `economy.json pacingTargets`, `tools/sim/report.ts`                       | Met through Q-RUN3                                                                            |
| 55  | Summary offer at 20:00 (Q-M5)                         | Ticker line + 6 s toast, once per run                     | `src/metrics/playtest.ts:63`, `HudScene.ts:292`                           | **Changed**: toast added; the menu is ❚❚ twice                                                |
| 56  | Status, decisions and report in the repo (Q-M3)       | Both; status is copied back at the end                    | `docs/`                                                                   | —                                                                                             |
| 57  | Phone access = zip + Mac LAN (Q-M2)                   | Zip + Mac; the tunnel is optional                         | README "How to serve on a phone"                                          | **Changed** context: the repo exists and Pages is enabled (§11)                               |
| 58  | Pages workflow checked by eye (Q-M10)                 | Unverified                                                | `.github/workflows/pages.yml`                                             | **Changed** shape: + `contents: read`, concurrency, a check-dist step                         |
| 59  | PixelLab (Q-M1)                                       | Anchors agent-approved; bulk pass run                     | `art/manifest.json batches`                                               | 1,700 of the 2,500-generation run budget                                                      |
| 60  | Fog via `_locked` frames (Q-A4)                       | Yes                                                       | `src/render/ground.ts`, `BuildingView.ts`                                 | —                                                                                             |
| 61  | One `world` atlas including the font (Q-A5)           | 442 frames in 2048²                                       | `src/render/atlases.ts`, `public/assets/world.png`                        | —                                                                                             |
| 62  | Shared locked scenery (Q-A6)                          | 16 sprites cover 35 buildings                             | `coversBuildings` in `art/manifest.json`                                  | —                                                                                             |
| 63  | Vehicles generated (Q-A7)                             | PixelLab bike, van and truck (token present)              | `art/manifest.json`                                                       | — (the bike is a scooter, §6.25)                                                              |
| 64  | `Scale.NONE` + integer zoom + `pixelArt` (Q-P1)       | Yes                                                       | `src/main.ts`                                                             | M4: safe area set before resize; 100vh fallback                                               |
| 65  | One 3072×1536 ground bake (Q-P2)                      | Yes; re-baked on unlock                                   | `src/render/ground.ts`                                                    | M4: the old texture is destroyed on New game                                                  |
| 66  | Tile-centre iso origin (Q-P3)                         | Yes                                                       | `src/render/iso.ts`                                                       | —                                                                                             |
| 67  | Pinch at the 0.8 / 1.25 ratios (Q-P5)                 | Yes                                                       | `src/input/GestureClassifier.ts:25-26`                                    | M4: pointers tracked by id                                                                    |
| 68  | MCP re-registered at user scope (Q-AP7)               | Not needed                                                | Token in the gitignored `.env`                                            | **Changed**: your registration already covered the repo path                                  |
| 69  | Retro Diffusion not used (Q-AP8)                      | Not used                                                  | `tools/art/rd.ts` (inert without `RD_API_KEY`)                            | —                                                                                             |
| 70  | AI-art provenance note (Q-AP9)                        | Note kept; no hand-touching                               | `art/STYLE.md` §10, CREDITS.md                                            | —                                                                                             |
| 71  | No Modal scene (Q-I2)                                 | The HUD owns the cards                                    | `src/scenes/HudScene.ts`                                                  | —                                                                                             |
| 72  | zzfx vendored as one function (Q-I3)                  | Yes                                                       | `src/audio/zzfx-samples.ts`                                               | —                                                                                             |
| 73  | `vlt skills link` into both dirs (Q-I4)               | Yes                                                       | `vlt.json config.allow-skills`                                            | —                                                                                             |
| 74  | Tests layout, HUD bands 64/64, minimum 360×604 (Q-I5) | Yes                                                       | `vitest.config.ts`, `e2e/`, `src/ui/layout.ts`                            | —                                                                                             |
| 75  | Twenty-minute cold play, numbers untouched (Q-R1)     | Twenty minutes; the L2 threshold of $2,000 kept           | `src/metrics/playtest.ts:61,63`                                           | The truck price was retuned for the gate anyway                                               |
| 76  | Hold Bay density gate (Q-R2)                          | Gate on; `baseShare` 0.05, `decoyShare` 0.22              | `parcels.json`, `economy.json pacingTargets`                              | **Changed**: the decoy lever went past the suggested 0.15; spicy 0.30                         |
| 77  | Scripted malware size S, servable origin (Q-R3)       | Yes                                                       | `parcels.json firstScripted`, `spawn.ts`                                  | **Extended** by Q-RUN3                                                                        |
| 78  | Post-cap escalation (Q-R4)                            | +0.01/day up to the 20 % cap; the bar keeps counting      | `parcels.json malware`, `src/sim/tick.ts:105`                             | 0.005 tried and reverted                                                                      |
| 79  | Toss hint + wanted poster (Q-R5)                      | Both; the poster lists only labels already seen           | `puns.json tossHint`, `WarehouseScene.ts`, `pm.save.v1.onboarding.wanted` | First-flag funnel added (§7 R8)                                                               |

## 10. Cost spent

| Item            | Spent                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PixelLab        | **1,700 generations** of the 5,000/month Tier 2 allowance (balance 5,000 → 3,300), in 25 batches: anchor pass 344 (24 probe + 320), bulk pass 1,356. **$0** in credits. The run budget was 2,500. |
| Retro Diffusion | $0 (no `RD_API_KEY`; never called)                                                                                                                                                                |
| Other paid APIs | $0                                                                                                                                                                                                |

Provenance per batch (time, tool, ids, balance before/after) is in `art/manifest.json#batches`.

## 11. Next steps

### 11.1 GitHub state and Pages

- The repository `github.com/ruyadorno/pm-tycoon` exists (public, created by you, with the ruy-bot app installed).
  `main` was pushed at each checkpoint (M0 5bce619, M1 460e515, M2 820e4f4, M3 77061cd) and at the end (M4 77615ef + this
  hand-off commit), always `git push origin main`, no PR.
- `.github/workflows/pages.yml` is inert: `workflow_dispatch` only. It installs with `vlt ci`, runs `vlr check`
  (e2e is SKIPPED on the runner), `vlr build` and `tools/check-dist.mjs`, then deploys with `actions/deploy-pages@v4`.
  It was committed last (d6e3ee1) in case the app token lacked **Workflows: write**; the push went through, so the
  workflow is on `main` and runnable.
- Pages is enabled with source "GitHub Actions" and a custom domain: `https://ruyadorno.github.io/pm-tycoon/` answers
  301 → `https://ruyadorno.com/pm-tycoon/`, which returns 404 until the first deploy.
- To deploy: Actions → **Pages** → **Run workflow**. To deploy on every push, uncomment the `push: branches: [main]`
  block in one commit. `vite.config.ts` has `base: './'`, so the same build works under `/pm-tycoon/`.

### 11.2 Hand-off

`dist-zip/pm-tycoon-77615ef.zip` (built from 77615ef; the build stamp in the HUD reads `77615ef 2026-10-29`) and `dist-zip/pm-tycoon-shots-77615ef.zip`, both sent with this report. `dist-zip/` is gitignored; the full 68-bar audio render (`shots/audio/semver-swing-full.wav`, 22.9 MB) stays on the VM.

The zip holds `dist/` with `playtest-README.txt`; this report and `shots/` (PNGs + `audio/*.wav`) travel with it.

### 11.3 Iteration 2 (build 2)

- **Belts**: the lane is already a generic `LaneNode[]` (spec §6.9 forward note); add the belt grid, drag-to-paint and
  splitters.
- **L3 and beyond**: the counter past 2; Docks with overseas clearance ×1.5 (§5.6), the `battery` strain and Battery
  checker, Hold Bay cap 5, dock 2; then L4–L5 (X-ray, Sorter Arm, slots 5–6, `dense`) and tier 3–5 art.
- **Quests**: quests and magic parcels (+1 life), the Golden Release + Victory card, endless escalation.
- From this report: put the pause menu on the modal stack (§6.5), fix ticker pacing (§6.6), add a save key per config
  (§6.13), hash the atlas URLs (§6.21), tune satisfaction and the L1 plateau (§6.1–§6.2) if your play agrees, and add
  a second tune if the first works.

### 11.4 What the playtest profile should answer

- **Fun bar 1–3 against the sim** (§2.3): `firstDeliveryS`, `firstMalware.caughtS` and `level2AtS` vs the gate
  medians of 44 s / 174 s / 13.05 min. A human L2 well past 15 min argues for Q75's alternative (L2 at ~$1,400).
- **Fun bar 4**: did you want to keep going past 15 min? A flat `moneyPerMin` and no `vehiclesBought` between minutes
  7 and 13 point at the L1 plateau.
- **Fun bar 5**: every `livesLost[]` entry has a counter or `clearedByPlayer`, and the lost-life card made sense to
  you.
- **Decisions**: `holdBayEvents` vs `malware.tossedClean` and `malware.cleared` shows whether you read the labels or
  tossed everything. `rushTaps`, `viewSwitches` and `warehouseS` show whether you dispatched and visited the warehouse.
- **Pressure**: `stalls`, `payroll.short`/`walkouts`, `satisfactionEnd` (is the angry drift visible to a human?).
- **Phone**: `fps.p50 ≥ 50` and `p5 ≥ 30` (otherwise the R4 cut order in `src/render/quality.ts` applies);
  `device.zoom` 1 and `maxTexture` ≥ 4096. Plus the unticked lines of docs/phone-checklist.md, and whether the music
  works.
