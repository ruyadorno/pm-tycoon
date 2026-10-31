# Playtest 3 — end-of-run report

Package Management Tycoon build 3: the event cards (a deck of 115 decision, news and job cards that pause the game and
print each option's effects before you choose), stories that run across several cards, the job board folded into the
deck, and a game about 8 % shorter. Built in one autonomous run on 2026-10-31 (02:19 UTC, 2db4c6e → the M15 commit
`<pending: M15 sha>`) from plans/pm-tycoon/plan-build3.md (DRAFT v3) and spec-build3.md (cited `B3 §N`). Node v26,
vlt 1.6.x, Phaser 4.2.1, Chromium (Chrome for Testing, SwiftShader WebGL) with the Playwright `iPhone 16` profile.
Sources for every number below: docs/status.md (M11–M14 entries), docs/decisions.md ("Run decisions (build 3)"),
docs/art-todo.md, docs/gate/{latest,latest-35min,delegating}.md, the 40-seed gate output and the M15 review-fix and
merge logs (`.logs/`, local to the VM), a 10- and a 40-seed policy recording made for this report (§9), `art/manifest.json`
and `tests/playtest/seed-7.json`.

**What to do first:** serve the build (§2.1), play **thirty to forty minutes cold** on the iPhone 16, answer the cards
as you like, open the summary card when it is offered at 30:00 (or from the pause menu), download `playtest.json`,
then read §6 (rough edges), §7 (decisions to confirm, Q-RUN12–Q-RUN21) and §11 (art approval G7). §8 maps your
playtest-2 notes P1–P10 to what shipped and says what happened to the feel check: your notes never arrived.

## 1. What was built

**M11 — pacing pass 1 and the events engine** (DONE at 7d2ec44, 06:30 UTC; after fe38cbe the AGENTS.md scope guard,
c6726f8 the art and 9a928db the engine skeleton)

- The events engine, headless (B3 §3, §6): `src/sim/systems/deck.ts` is one scheduler for decision cards and job cards
  (level bands, blank draws, two salted event streams, quiet rules, chains, routers and conditional links resolved
  when due, link inheritance, the queue, the rescue draw). Jobs are offered through `quests.ts offerJob`; the old offer
  timer and offer expiry are retired (P5).
- `effects.ts` covers every B3 §3.5 kind and generates the effect lines. `modifiers.ts` + `modifierOps.ts` carry 18
  keys at every B3 §3.6 read site, with bounds and expiry. The hold (`Sim.held`), `decideEvent`, and
  `policies/eventPolicy.ts` (B3 §3.8 scores, −∞ for the last life) complete it; `STATE_VERSION` 6.
- `src/data/events.json` (schedule, categories, modifier bounds, policy weights, the 19-card seed deck) with
  `checkEvents` (harsh-consequence rule, paid sibling, acyclic chains of at most 5). New gate rows
  `eventsOfferedBy30MinMin`, `eventsOpenMaxTicks`, `eventsL1PlateauMin`, `policyEvPerCard`, `policyNonDefaultShare`.
- Pacing pass 1 (B3 §2.2): `newStrainDelayS` 90, thresholds L2 $1,750 / L3 $3,250 / L4 $4,650 / L5 $6,500,
  `perLevel` 0.015. With the decision deck off: L2 10.57 (−9.8 %), L3 16.52, L4 20.56, L5 25.46 min.
- The art came first (c6726f8, B3 §5): 13 category pictures, `victory_art`, `ic_event`, `fx_confetti`; 233 PixelLab
  generations.

**M12 — the cards on screen** (DONE at 617e97b, 10:05 UTC; build checkpoint 266015e)

- `src/ui/effectText.ts` (the pure card model) and `EventCard.ts` in four modes (decision, three options, job, news):
  generated effect lines, `Can't afford · $N`, `…then:`, `Outcome depends on`, `— this can end the run`, the PAUSED
  pill and the read-in guard. `EventChip.ts` with the compact quest chip, and `EffectsCard.ts` with its pause-menu
  entry (B3 §3.4).
- HudScene plumbing: the card holds the sim and waits behind modals, the gold card and the level-up moment; ticker
  lines, SFX, newspaper items, HUD-cell pulses; `?event=`; the lost-life and game-over event variants; the VictoryCard
  art and confetti; SALE tags; the Garage refund at the price paid.
- The deck at 62 cards, `SIM_FEATURES.events` on, `e2e/events.spec.ts`, and the review fixes (the chip over a sheet,
  `costPerVehicle`, the CREW policy rule, the poach tie).
- `docs/feel-check-m12.md` and a mid-run hand-off zip (`pm-tycoon-617e97b.zip` + shots). This was part A's
  checkpoint; the run did not stop there (§8).

**M13 — the full deck** (DONE at f4cb2a4, 11:58 UTC)

- B3 §4 authored in full (145 cards + 4 routers), judged by three fresh-context reviewers on the sim's own generated
  lines, and shipped at **115 cards** (Q-B3-11): 29 whole singles cut, every chain kept whole, 19 stories.
- About 70 copy edits, honest effects, 20-odd spec numbers changed (decisions.md M13, Q-RUN15), per-category weights
  and a 15-day cooldown floor on repeatable decision cards.
- `tests/sim/chains-stories.test.ts` drives every shipped 4–5-card story through `decideEvent`, both branches of each
  condition; a 60-min deck soak on seeds 1–3; the EV band on seeds 1–10. Jobs fully folded (dead offer code removed).
- 12 `event-card-<category>` shots; `art/contact/events@4x.png` rebuilt from them.

**M14 — pacing pass 2 with the deck on** (DONE at 3b8bc50, 12:46 UTC)

- The Golden Release at `minOnTimeRate` 0.85 (Q-B3-7). Full gates with the shipped deck needed no threshold nudge:
  L2–L5 at −8.4 / −8.2 / −8.1 / −8.6 % against build 2 (§10).
- The long victory test, the delegating rows and the robustness sweeps run with the deck on; `policy.test.ts`,
  `levels3.long` and `quests-policy.long` became pass-2 runs.
- The M13 copy polish (the gang's `Pay up ($300)` / `Refuse`, the watch's `Hide the fleet` / `Carry on`, the poach's
  `Pay a bonus ($180)`, …); fixtures regenerated (the victory fixture now from seed 7).

**M15 — the playtest-3 build** (this report; commit `<pending: M15 sha>`)

- `src/metrics/playtest.ts` v3 (`pm.playtest.v3`, B3 §6): `events` {offered, decided, byCategory, `choices[]` with
  each card's think time, `thinkMedianS`, chains started / finished / running, lives, vehicles and workers lost,
  `gameOverByEvent`, `modifiersPeak`} and `beats[]`; `livesLost[]` gains `cause`, `eventId`, `option`. The schema test
  (57 cases) and `tests/playtest/seed-7.json` v3 from a 35-min automated run.
- `src/metrics/funBar.ts` and SummaryCard v3: new rows **Cards**, **Stories**, **Longest quiet**; fun bar 3
  (plan-build3 §9).
- README "Cards", `playtest-README.txt` v3, docs/playtest.md v3, docs/phone-checklist.md and docs/art-todo.md (G7);
  dist 6.59 MB.
- Four adversarial passes (sim, scenes, mobile, and a deck/copy pass over 30 cards on the shots): 16 findings, 9
  fixed, 7 refuted (§6).

**Not built**, as plan-build3 §3 says: belts, a management scene, train, splitters, traffic, day/night, bankruptcy,
PWA, save migrations (build-2 saves are discarded), landscape, minimap, chance rolls in events, timed cards or `Later`
on event cards, a picture per event, new quest templates, changes to the Golden Release's `days` / `deliveries`.
Nothing in the plan-build3 §8.7 cut order was cut.

## 2. How to play

### 2.1 Get the build

Hand-off bundle: `dist-zip/pm-tycoon-<pending: M15 sha>.zip` (`vlr bundle` of `dist/` built at the M15 commit), sent
with this report and the shots zip. Rebuild any time with `vlr build && vlr bundle`.

| Path                  | How                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Desktop devtools   | Serve `dist/` (path 2), open `http://localhost:4173/` in Chrome, devtools → device toolbar → **iPhone 16** (393 × 852, DPR 3), reload. Add a custom 393 × 659 (or 360 × 604) device to see the tall rooms scroll.    |
| 2. iPhone via the Mac | Unzip, `cd dist && python3 -m http.server 4173`, open `http://<mac-lan-ip>:4173/` in Safari (same Wi-Fi; `ipconfig getifaddr en0`).                                                                                  |
| 3. GitHub Pages       | `https://ruyadorno.com/pm-tycoon/`, only if the M15 dispatch went through: `<pending: Pages dispatch result>` (§13.1). Otherwise Actions → **Pages** → Run workflow (or `gh workflow run pages.yml`) deploys `main`. |
| SSH tunnel            | Only with a route to the VM: `vlr preview -- --host` there, `ssh -g -L 4173:localhost:4173 <vm>` on the Mac, then the LAN URL on the phone.                                                                          |

Plain http works (localStorage, WebGL, the audio-unlock tap; no service worker). Each origin keeps its own save and
profile. A build-2 save is discarded with the stale-save toast (`STATE_VERSION` 6, Q-B3-12); a v2 profile is never
resumed (`pm.playtest.v3`).

### 2.2 The first minutes

The tutorial is build 2's: **"Buy a bike in the Garage and pick its driver"**, **"Your inspector catches 85% by hand.
A Metal detector ($150) lifts the lane to 97%"**, **"Tap a building with waiting parcels to rush a vehicle there"**,
then the first flag (**"A parcel was flagged — open the warehouse to Toss or Clear it"**) and the scripted malware
around 2:00. New in build 3:

1. **The first card opens at 3:20** of game time (Day 4), after the scripted catch. On seed 7 it is `MONEY ·
   Small-business grant` (`Apply` +$150 / `Skip`). Then one card every 60–100 s of game time at L1 (60–110 s at L2 …
   90–140 s at L5); 33 cards can be drawn at L1.
2. **Every card pauses the game** (`PAUSED` in its corner) until you tap an option. Under each option the card prints
   exactly what it does (costs red, gains green, the rest grey). A greyed option reads `Can't afford · $N`; a red one
   can take a life, a vehicle or a person, and adds `— this can end the run` at your last life. `Enter` takes the
   first option, never a red or greyed one.
3. **Jobs are cards** (`JOB BOARD`, **Accept** / **Decline**, no Later). On seed 7 the first is `Like clockwork` at
   6:26. The Golden Release keeps its gold card, which does not pause and has **Later**.
4. **Stories**: an option with `…then: <card> (in N days)` books the next card; it opens with `You chose: …`.
5. **The effects chip** (an orange bell in the top bar's second row) counts the running effects; tap it, or
   **Effects · N** in the pause menu, for the list.

### 2.3 The brief: thirty to forty minutes cold, then the summary card

Play **thirty to forty minutes cold** (no debug flags, no help) and **answer the cards as you like**: there is no
right answer the build is waiting for. The policy timeline (10-seed gate medians, deck on): L2 ~10.7 min, L3 ~16.5,
L4 ~20.6, L5 ~25.3 — game time; the pauses come on top. At **30:00 of game time, and never before 25 real minutes**, a
ticker line and a toast offer the run summary; or tap **❚❚**, then **❚❚** again → **End run — show summary**. Press
**Download playtest.json** and **Copy summary**.

| Fun bar 3 item (plan-build3 §9)      | Read from                                                                     | What the gate predicts (competent policy)                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Decisions felt like mine (judged) | ≥ 3 decision cards answered off the default (`events.choices[]`)              | the policy goes off the default on 7.5 decision cards per run (5–11; 40/40 seeds ≥ 3); only you can say whether they felt like yours                                                       |
| 2. Never idle on the ramp            | longest gap between beats from 3:00 to L2 ≤ 90 s; think median < 15 s (soft)  | gap median 85 s on seeds 1–10 (6/10 ≤ 90 s), 80.5 s on 40 seeds (28/40), counted by a probe for this report; seed 7's profile reads 1:35 ✗. The policy thinks 0 s; the think time is yours |
| 3. L2 by 10:30, L3 by 16:30          | `level2AtS ≤ 630`, `level3AtS ≤ 990`                                          | **likely ✗**: the medians are 10:44 / 16:31; both met on 2/10 seeds (9/40). The bar was set for −10 %, the run reached −8 % (Q-RUN14)                                                      |
| 4. A story (3+ cards) (judged)       | a chain of ≥ 3 cards closed (`choices[].chain.end`, depth ≥ 3)                | 5/10 seeds (17/40) finish one by 30 min: the permit fight, the gang, the dock strike, the rival; seed 7 finishes pairs only                                                                |
| 5. Kept playing past 25:00           | `elapsedS > 1500` at the first opening of the card                            | real minutes; only you                                                                                                                                                                     |
| 6. Every lost life explained         | each `livesLost[]` has a counter, a sorter, a Clear, or a card and its option | lives median 0 (2/10 seeds lose one to malware); no card took a life in any gate run (the policy always takes the way out)                                                                 |
| 7. (stretch) Golden Release by 36:00 | `victoryAtS ≤ 2160`                                                           | out of reach for the policy: no seed of 1–10 wins before 46 min (§10.4)                                                                                                                    |

docs/playtest.md explains every field of `playtest.json` v3; docs/phone-checklist.md is the device checklist for the
same session.

### 2.4 Optional short sessions (after the cold run)

Both need `?debug=1` (the fps / draw-call overlay, 4× speed with key `4`, `window.__pm`) and keep their own save and
profile (`pm.save.v2:cfg:<name>`, `pm.playtest.v3:cfg:<name>`).

- **`?debug=1&config=spicy`** (`public/configs/spicy.json`): malware 9 % instead of 5 % at L1, decoys 30 %, a Hold Bay
  of 2 at L1–L2, and the cards at about twice the pace: the first at 1:00, then every 30–60 s at L1–L2 and 40–70 s
  from L3 (Q-B3-14). A stall, a lost-life card, a job and a story within minutes.
- **`?debug=1&config=tycoon`** (`public/configs/tycoon.json`): every New game starts at L5 with the lane, the Sorter
  Arm, docks 2–3 and 3 bikes / 2 vans / 3 trucks with drivers; the Golden Release is offered from the first minute.
  Accept alone wins in 4.21–4.95 min on seeds 1–10 at 0.85 (R29).

### 2.5 URL parameters worth knowing (`src/debug/params.ts`)

| Param                     | Does                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `debug=1`                 | `window.__pm`, the overlay, 4× speed; enables `config=`, `level=`, `quest=`, `event=`, gallery                  |
| `config=spicy` / `tycoon` | data override from `configs/<name>.json` (with `debug=1`)                                                       |
| `event=<id>` (new)        | a fresh game opens that deck card at once, e.g. `event=ev_crime_gang` (the gang story) or `event=ev_sec_recall` |
| `quest=<id>`              | a fresh game offers that job as a `JOB BOARD` card (`golden_release` gives the gold card)                       |
| `level=N`                 | a fresh game forced to level N                                                                                  |
| `newGame=1`, `seed=N`     | ignore the autosave; the world of seed N (a new seed starts a fresh profile)                                    |
| `attract=0`               | the Title on a plain backdrop, no demo city                                                                     |
| `policy=1` / `delegating` | the competent / delegating scripted player drives the sim (and answers the cards)                               |
| `fastForward=S`           | run S sim seconds before the first frame (it waits while a card holds the sim)                                  |
| `mute=1`, `audio=0`       | start muted / never create audio                                                                                |
| `skipTitle=1`, `view=`    | skip the Title; open `city`, `warehouse` or `gallery` (gallery needs debug)                                     |

## 3. Screenshots

119 PNGs in `shots/`: 117 from the final `vlr shots` run (2026-10-31 14:02–14:09 UTC, HEAD 3b8bc50 plus the M15 working
tree; 87 iPhone 16 at 393 × 659 CSS / DPR 3, 23 min-fit 360 × 604, 3 desktop column 430 × 932, 4 Gallery pages) and
**2 stale files**: `quest-offer.png` and `quest-offer-360x604.png` are from M11 (06:27 UTC) and show the retired
QuestCard job offer; no test writes them since M12 (`event-card-job` replaced them). Delete them before zipping (§6.27).
The shots in **bold** were read at the final tree for this report; the others carry the verdict of the milestone
that made them (docs/status.md) and were regenerated with passing e2e assertions. **117/117 PASS**; the notes are
cosmetic and listed in §6.

| Shot                                                                                                              | Shows                                                                                                                                                                                  | Verdict                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **event-card.png**, **event-card-360x604.png**                                                                    | `UNDERWORLD · Protection` at $102: greyed `Pay up ($300)` over `Can't afford · $300`, `Refuse` over `…then: On the doorstep (in 1 day)`, the PAUSED pill, the crowbar-and-mask picture | PASS (every line fits at 360)                                                      |
| **event-card-danger.png**                                                                                         | `SECURITY · The recall` at 1 life: the fine greyed, a red `Take the strike` over `−1 life — this can end the run`                                                                      | PASS                                                                               |
| **event-chain-gang.png**                                                                                          | `You chose: Refuse` above `On the doorstep`; `Hide the fleet` (`all vehicles ×0.85 speed for 1 day · …then: The price went up (in 2 days)`); red `Carry on` (`Bike 1 lost · …`)        | PASS (the body's last word wraps under the picture, R22's designed fallback)       |
| **event-card-three.png**                                                                                          | `STAFF · Scanner course`: `Send everyone` greyed (`Can't afford · $150`), `Send Audrey` (`−$60 · Audrey: eye +1`), `Skip`                                                              | PASS (the mug in `ev_pic_staff` reads as a line drawing on the cream panel, §6.22) |
| **event-card-job.png**                                                                                            | `JOB BOARD · Rush hour`: the objective, `Reward: $120 · Limit: 3 days` in green, `Decline` over `No jobs for 1 day` (the M15 wording)                                                  | PASS                                                                               |
| event-card-{staff, fleet, customers, security, money, cityhall, weather, press, underworld, tech, port, luck}.png | one shipped card per category; cropped 1× into `art/contact/events@4x.png`                                                                                                             | PASS (M13; titles on one line, bodies ≤ 3 lines; regenerated at M15)               |
| event-chip.png                                                                                                    | the 24-px bell chip beside the 82-px compact quest chip                                                                                                                                | PASS (M12)                                                                         |
| **effects-card.png**                                                                                              | `EFFECTS · 1 active`: `bikes ×0.85 speed`, `23h left · Rain`, Close                                                                                                                    | PASS                                                                               |
| **event-lost-life.png**                                                                                           | the event variant: `The recall` in red, `You chose: Take the strike`, `Lives: 2`, OK                                                                                                   | PASS (the Node Heights plate under the region chips, report-2 §6.9)                |
| **event-game-over.png**                                                                                           | GAME OVER with `The recall — you chose: Take the strike`, six stats, New game / Run summary                                                                                            | PASS                                                                               |
| buysheet-sale.png                                                                                                 | the SALE tag on the Metal detector at $90 (machines at 60 % after `Cheap scanners → Take the deal`)                                                                                    | PASS (M13)                                                                         |
| **golden-release-offer.png**, -360x604                                                                            | the gold card: `In 5 days: 60 deliveries, no malware, 85 % on time`, `Reward: Victory`, Accept · Later                                                                                 | PASS (the flavour line repeats the title, §6.14)                                   |
| **victory.png**, victory-360x604.png                                                                              | TYCOON over `victory_art` (the glass HQ at night, fireworks, the fleet lined up), confetti over the top edge; 46 days, $22,840, 488 parcels, 83 / 0, 4 of 5                            | PASS (the `QUEST COMPLETE — VICTORY` toast covers the Day chip, report-2 §6.8)     |
| **summary-card.png**                                                                                              | the 35-min seed-7 card: 17 rows incl. `Cards 18 · 16 decisions · 2 news`, `Stories 2 · longest 2 cards`, `Longest quiet 1:35`; fun bar 3 `? ✗ ✗ ✗ ✗ ✓ –`                               | PASS (layout; the ✗s are the automated run's real values, §6.17–§6.19)             |
| **summary-card-360x604.png**                                                                                      | the 10-min card at 360 × 604: `1:35 so far`, items 2–3 `–` / not yet, item 4 `pairs only` ✗                                                                                            | PASS for layout (`0:01 played`, `Taps/min 180.0`: a frozen-clock shot, §6.21)      |

The other 87 shots are build 2's views (city, warehouse tiers 1–5, people, quests, ports, Title, lost life, Victory
card) regenerated with passing assertions; build 3 changed nothing in them except the top bar's event chip and the
compact quest chip. The audio renders of playtest 1 are unchanged (`shots/audio/`).

## 4. Gate results

`vlr sim:gate`: seeds 1–10 × 30 min, competent policy, events on, data `4c4343f6`. **GATE PASS** on medians. The M15
review fixes changed only text in `events.json`, so every gate output equals M14's apart from the data-hash line.

| Window (`economy.pacingTargets`)         | Median    | Target      | Min / max     | Build 2   |
| ---------------------------------------- | --------- | ----------- | ------------- | --------- |
| First delivery                           | 43.3 s    | < 60 s      | 31.5 / 60.8   | 43.3 s    |
| Scripted malware caught                  | 178.3 s   | ≤ 300 s     | 150.5 / 205.7 | 178.3 s   |
| Level 2                                  | 10.73 min | 7–13.5 min  | 9.33 / 11.83  | 11.72 min |
| Truck bought after L2                    | +2.30 min | ≤ 4 min     | 1.62 / 6.72   | +1.54 min |
| Lives lost (malware, Toss-everything)    | 0         | 0           | 0 / 3         | 0         |
| Shelf stall                              | 0 s       | 0 s         | 0 / 0         | 0 s       |
| Hold Bay events per 10 min at L1         | 8.23      | ≥ 6         | 4.24 / 11.08  | 6.78      |
| Quests offered / completed by 30 min     | 6 / 3     | ≥ 4 / ≥ 2   | 5–7 / 2–4     | 7 / 3.5   |
| Level 3                                  | 16.51 min | 13.5–18 min | 14.75 / 19.63 | 17.98 min |
| First overseas clearance after L3        | +2.95 min | ≤ 3 min     | 1.97 / 4.74   | +2.18 min |
| Level 4                                  | 20.55 min | 18–22.5 min | 18.71 / 23.91 | 22.35 min |
| Level 5                                  | 25.33 min | 22.5–27 min | 22.31 / 29.04 | 27.70 min |
| Cards by 30 min (new)                    | 21        | ≥ 15        | 18 / 26       | —         |
| Longest open card under the policy (new) | 0 ticks   | ≤ 1 tick    | 0 / 0         | —         |
| Decision cards on the L1 plateau (new)   | 4         | ≥ 3         | 3 / 5         | —         |
| Policy EV per card (new)                 | $24.38    | −$20 … +$40 | −20.9 / 51.1  | —         |
| Policy non-default share (new)           | 0.52      | ≥ 0.4       | 0.35 / 0.67   | —         |
| Payroll share of gross (informational)   | 21.0 %    | ≤ 25 %      | 19.9 / 22.6   | 21.0 %    |
| Malware share at 30 min (informational)  | 11 %      | —           | 11 / 11       | 13 %      |

The build-2 windows were 8–15 / 15–20 / 20–25 / 25–30 min and a Golden Release offer ≤ 32 min; build 3 multiplies
every window by 0.9 (Q-B3-1).

| Seed | First del. s | L2    | Truck +  | Lives | Hold/10 min L1 | L3        | Clearance + | L4        | L5        | Cards | L1 dec. | EV $      | Non-def. | Misses                                    |
| ---- | ------------ | ----- | -------- | ----- | -------------- | --------- | ----------- | --------- | --------- | ----- | ------- | --------- | -------- | ----------------------------------------- |
| 1    | 54.3         | 10.00 | 1.96     | **1** | 8.00           | 15.70     | **3.37**    | 19.49     | 25.33     | 20    | 3       | 22.2      | 0.50     | a life; clearance late                    |
| 2    | 55.6         | 10.45 | **6.72** | 0     | 9.57           | **19.16** | 2.28        | **23.09** | 26.87     | 22    | 5       | −15.9     | 0.50     | truck late; L3, L4 late                   |
| 3    | 52.0         | 10.83 | 2.28     | 0     | 11.08          | 16.21     | 2.52        | 19.67     | 25.32     | 23    | 4       | **−20.9** | **0.35** | EV and non-default share low              |
| 4    | 48.8         | 9.44  | 3.87     | 0     | **4.24**       | 16.67     | **3.64**    | 20.48     | 25.77     | 19    | 3       | **51.1**  | 0.61     | few Hold Bay events; clearance; EV high   |
| 5    | **60.8**     | 11.33 | 1.93     | 0     | 9.71           | 16.38     | **4.74**    | 19.16     | 24.83     | 18    | 5       | 34.8      | 0.67     | first delivery; clearance late            |
| 6    | 36.0         | 10.72 | 1.62     | **3** | **4.66**       | 16.64     | **4.45**    | 21.09     | 24.19     | 26    | 5       | **49.0**  | 0.53     | three lives; few Hold Bay events; EV high |
| 7    | 31.5         | 10.74 | 1.91     | 0     | **5.59**       | 15.92     | 2.28        | 20.61     | 24.85     | 19    | 4       | 26.5      | **0.39** | few Hold Bay events; non-default share    |
| 8    | 37.8         | 11.83 | **5.33** | 0     | 8.46           | **19.63** | **4.12**    | **23.91** | **29.04** | 23    | 4       | 13.4      | 0.47     | truck, L3, clearance, L4, L5 late         |
| 9    | 36.3         | 10.97 | 3.48     | 0     | 6.38           | 17.23     | 1.97        | 21.59     | **27.64** | 19    | 4       | 21.4      | 0.67     | L5 late                                   |
| 10   | 34.5         | 9.33  | 2.31     | 0     | 9.64           | 14.75     | 2.09        | 18.71     | **22.31** | 22    | 3       | 33.6      | 0.53     | L5 early                                  |

Every median passes, but **no seed passes every window** (build 2: 3/10). The misses are in the clearance row (5
seeds), the EV band (3), the level rows (seeds 2, 8, 9, 10), the Hold Bay row (3) and the truck row (2). A card that
parks a van for a day or a policy that spends $200 on bike lanes moves a seed by a minute; §6.1–§6.5 list them as
rough edges.

**The 35-minute gate** (`vlr sim:gate -- --minutes 35`, docs/gate/latest-35min.md): PASS. The Golden Release is offered
at 25.33 min median (target ≤ 29; seed 8 latest at 29.04); offered 19 times over the ten seeds, failed 11 times,
completed 0 times by minute 35; EV $22.0, non-default 0.49; 26 chains started, 24 finished.

**The delegating policy** (`vlr sim:delegating`, rows informational): PASS. L2 / L3 / L4 / L5 at 10.73 / 17.13 / 20.91 /
26.22 min; lives lost to trusting the sorter median 1 (6/10 seeds lose one); sorter calls 39.5, wrong 3, missed 1;
payroll 28 % (≤ 25 % is informational); EV $21.05, non-default 0.50; cards 22.5.

**The 40-seed run** (seeds 1–40 × 30 min, `.logs/m15-gate40/`): PASS. L2 10.61, truck +3.21, L3 16.97, overseas +2.78,
L4 21.50, L5 26.68 (reached on 32/40 seeds by 30 min), cards 21, EV $20.55 (29/40 seeds inside the band),
non-default 0.54 (35/40 ≥ 0.4); **12/40 seeds lose a malware life** (30 %, limit 35 %; M11 13/40). No event game over
on any seed; events took 0 lives, 0 vehicles and 0 workers and gave 5 lives.

**The victory long test** (`tests/sim/victory.long.test.ts`, seeds 1–3, deck on): PASS. It asserts a win by 48 min on
at least one of seeds 1–3 (seed 3 at 47.62; seeds 1 and 2 at 48.82 and 56.60) and prints the 40-min target, which no
seed meets (§10.4, Q-RUN13).

**JSON values changed in build 3** (a script diff of `src/data/*.json` at 2db4c6e against the M15 tree; one
decisions.md line each, B3 §2.2 order: the lives lever first by design, then thresholds, then `perLevel`):

| Key                                        | From → shipped                                                               | When    | Rule and the row that moved it                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parcels.json malware.newStrainDelayS`     | 60 → **90**                                                                  | M11     | B3 §2.2 lever 1, applied before the scan (rows `maxLivesLost`, 40-seed share): share 11/40 → 9/40, L5 27.58 → 27.55.                                                                                                    |
| `levels.json` L2 `threshold`               | 2,000 → **1,750**                                                            | M11     | Row `level2Min`: 11.75 → 10.57 (−9.8 %); truck +1.53 → +2.78. $1,700 is a cliff (truck +3.55, L3–L5 back to −1…−2 %).                                                                                                   |
| `levels.json` L3 `threshold`               | 3,700 → **3,250**                                                            | M11     | Row `level3Min`: 17.80 → 16.52 (−8.1 %); overseas +2.24 → +2.66. $3,200 fails the overseas row, $3,400+ the lives row.                                                                                                  |
| `levels.json` L4 `threshold`               | 5,200 → **4,650**                                                            | M11     | Row `level4Min`: 21.99 → 20.56 (−8.0 %).                                                                                                                                                                                |
| `levels.json` L5 `threshold`               | 7,400 → **6,500**                                                            | M11     | Rows `level5Min`, `goldenReleaseOfferedMaxMin`: 27.58 → 25.46 (−8.1 %). $100 below the plan's $6,600–6,800 range: the in-range sets gave −7.4…−7.7 % with a 35-min lives median of 0.5 (R26).                           |
| `parcels.json malware.perLevel`            | 0.02 → **0.015**                                                             | M11     | B3 §2.2 lever 3 (R26): 40-seed share 14/40 → 13/40, overseas +3.10 (fail) → +2.66.                                                                                                                                      |
| `levels.json ultimateQuest.minOnTimeRate`  | 0.9 → **0.85**                                                               | M14     | Q-B3-7 (your answer). Rows `goldenReleaseOfferedMaxMin` / `victoryMaxMin` (informational): no gate moved; victory seeds 1–3 unchanged (the 5-day clock decides, §10.4).                                                 |
| `economy.json pacingTargets` level windows | × 0.9; GR 32 → 29; victory 45 → 40                                           | M11     | B3 §2.1 as written (Q-B3-1).                                                                                                                                                                                            |
| `economy.json pacingTargets` + 3 rows      | new                                                                          | M11     | `eventsOfferedBy30MinMin` 15, `eventsOpenMaxTicks` 1, `eventsL1PlateauMin` 3 (B3 §3.9); the EV band and share live in `events.json policy`.                                                                             |
| `quests.json offer`                        | `firstOfferDay`, `intervalDays`, `offerExpiresDays` removed                  | M11     | Jobs come from the deck scheduler (`events.json schedule.jobShare` 0.65, `jobCooldownDays` 1; B3 §7 as written).                                                                                                        |
| `quests.json` `night_shift` name           | "Night shift" → **"Bay watch"**                                              | M14     | Copy (the job is about the Hold Bay, not the night).                                                                                                                                                                    |
| `events.json` (new file)                   | B3 §7 + the deck                                                             | M11–M15 | Schedule, categories, bounds and policy weights as B3 §7; the deck's numbers differ from B3 §4 on 20-odd cards (decisions.md M13, Q-RUN15); weights and cooldowns tuned for the EV band and category spread (M12, M13). |
| `puns.json`, `audio.json`, `sfx.json`      | + `eventWords`, `tickerEvent`, `eventPing`; quest lines end with a full stop | M11–M14 | Text and sound only.                                                                                                                                                                                                    |

`vehicles.json`, `machines.json`, `employees.json`, `districts.json`, `map.json` and the rest of `economy.json`,
`parcels.json` and `levels.json` match build 2. Outside `src/data`: `public/configs/spicy.json` gains the faster card
schedule (Q-B3-14); `tycoon.json` is unchanged.

## 5. Tests and checks

At the M15 working tree (HEAD 3b8bc50 plus the M15 changes), after the review fixes, unless noted.

| Check                    | Result                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                   | 126 files, 3,102 tests: **3,101 passed**, 1 todo, 0 failed (104.6 s, rerun for this report). Growth: M10 2,151 → M11 2,544 → M14 3,052 → M15 3,101.                                                                                                                                                                                                                           |
| `vlr check`              | PASS in **186.3 s** (6 s over the 3-min target): toolchain 0.1, typecheck 12.3, lint 0.3, fmt 0.5, test 104.8, art:lint 1.9, quick gate 1.4, e2e:smoke 65.0 s. Per milestone: M11 167 s, M13 188, M14 189, M15 186.                                                                                                                                                           |
| `vlr e2e`                | Final full run after every review fix: **170 passed, 146 skipped** (project-scoped), **0 failed**, 10.2 min — smoke, dist, lifecycle, audio, quests, configs, events (incl. the new think-time-behind-the-rotate-card test) and every shot.                                                                                                                                   |
| `vlr shots`              | 109 passed, 146 skipped, 6.0 min (117 PNGs, 13 `*.card.json`, `tests/playtest/seed-7.json` v3).                                                                                                                                                                                                                                                                               |
| Schema test              | `tests/metrics/playtest-schema.test.ts` 57/57 on the regenerated `seed-7.json` (plan-build3 §8.6 acceptance).                                                                                                                                                                                                                                                                 |
| Sim gates                | `sim:gate` (30 min), `-- --minutes 35`, `sim:delegating`, 40 seeds: PASS; medians identical to M14; victory long test PASS.                                                                                                                                                                                                                                                   |
| `vlr build` + check-dist | PASS: **6.59 MB raw / ~4.43 MB gzip** transfer in 68 files vs the 8 MB budget (Q-B2-10); excluded: 5 sourcemaps (16.17 MB) and the dev-only `gallery.html` (§6.28).                                                                                                                                                                                                           |
| JS chunks (gzip)         | phaser 353.3 kB, index 265.0 kB (221.9 in build 2: the deck, effects and cards), director (lazy audio) 73.4 kB, policy 5.6 kB, offline 1.0 kB. `world` 2048² 2,456 kB (536 frames, ≈ 82 % of the sheet), `interior` 2048×512 144.5 kB (299 frames).                                                                                                                           |
| Draw calls               | an open EventCard 5, the EffectsCard 5 (budget 8; M12); city and warehouse unchanged from build 2.                                                                                                                                                                                                                                                                            |
| Browser perf             | seed-7 profile: fps p50 61, p5 59, min 55 over 107 real seconds (SwiftShader). Sim step at L5: mean 0.03 ms, p99 ≤ 0.15 ms (M11).                                                                                                                                                                                                                                             |
| `vlr art:lint`           | 0 errors, 38 warnings (A12 colour counts; `victory_art` at 18 colours is the new one), 3 placeholders (`desk`, `shelf_t1`, `shelf_t2`).                                                                                                                                                                                                                                       |
| Cold install             | PASS: a fresh clone of 3b8bc50 + the M15 working-tree diff, `vlt install` (vlt 1.6.1, Node 26.13.0) EXIT 0 with the lockfile unchanged, `grep -c registry.vlt.io vlt-lock.json` 0; `vlr check:quick` **PASS in 52.2 s** (typecheck 12.1, test 39.1 s).                                                                                                                        |
| AI attribution           | Commit messages: **0** hits over 2db4c6e..3b8bc50 (8 commits) and over the whole history (`generated with`, `co-authored-by: claude`, `claude.ai/code`, `noreply@anthropic`). Files: 9 lines match, all false positives (AGENTS.md's own rule line and eight "(re)generated with/without" phrases in art and fixture notes). Re-run on the M15 commit: 0 hits in its message. |

WebKit cannot launch on this VM, so every browser check ran in Chromium.

## 6. Known bugs and rough edges

Nothing here blocks the playtest. File references are to the M15 tree. Items marked "refuted" were raised by the M15
review passes and judged not to be bugs (the spec asks for it, or the real game cannot reach it); they are listed so
you can overrule.

**Balance** (see §10 for the numbers)

1. **Victory by 40 min is not met** (B3 §2.1, informational): the Golden Release fails on its 5-day clock for 60
   deliveries, not on the on-time rate — 34 of 44 offers time out at both 0.9 and 0.85. Seeds 1–3 win at 48.82 /
   56.60 / 47.62 min; 10 seeds median 52.36, 9/10 by 62 min. `levels.json ultimateQuest` (Q-RUN13).
2. **The game is ≈ 8 % shorter, not 10 %** (R26): 10-seed medians −8.4 / −8.2 / −8.1 / −8.6 %; over 40 seeds L3–L5 are
   only −5.6 / −3.8 / −3.7 % (the band is a 10-seed rule). L4 at −8.05 % sits on the band's edge (Q-RUN14).
3. **No seed passes every window** (§4): the overseas row misses on 5 seeds (up to +4.74 min), the truck row on 2
   (+6.72, +5.33), L5 on 3 (22.31 early, 27.64 and 29.04 late). Medians pass.
4. **The EV band is wide per seed**: −$20.9 … +$51.1 on seeds 1–10, −$20.9 … +$65.6 over 40 seeds (29/40 inside
   [−20, 40]). The median $24.38 is above R21's +$20 mark; the fallback (halve the richest money options) was not used
   because no level median left its band (decisions.md M14).
5. **Lives**: 12/40 seeds lose a malware life in 30 min; in the 10-seed gate seed 6 loses three. Delegating loses 1
   median (6/10 seeds). The M11 levers stay (`newStrainDelayS` 90, `perLevel` 0.015).
6. **The harsh cards are never exercised by the policy**: it always takes the way out, so in every gate and sweep
   no card took a life, a vehicle or a worker (robustness sweeps saw absences only). Those paths are covered by unit
   tests (`tests/sim/effects.test.ts`, `chains-stories.test.ts`, `robustness.test.ts`) and the e2e danger, lost-life
   and game-over shots — not by a played run. Your run is the first.
7. **Satisfaction still drifts angry** (report-2 §6.3, not tuned): the Victory shot's mood reads 24 on Day 46.
8. **`express_lane` (L5) is still only offered after Victory**: jobs stay blocked while the Golden Release is pending
   (Q-B3-6 default, `src/sim/systems/quests.ts:711`).
9. **Chains that never finish in the policy's runs**: the investor (declined 4/4, Q-RUN16), the crate (tossed 5/5),
   the union (granted 1/1) and the ring (`ev_sec_breach` never drawn in 40 × 30 min, nor `ev_fleet_gearbox` or
   `ev_crime_insider` by 30 min). 93 of the 116 cards were seen at least once over 40 seeds (§9).

**Cards and deck copy**

10. **12 link and outcome cards open their body by repeating the gold title above it** (e.g. `ev_port_strike_on`,
    `ev_city_hearing`, `ev_city_audit_pass`) — refuted (deck-1): the bodies are B3 §4's text; copy polish for later.
11. **The influencer hides its condition**: `Do it` shows `…then: The video (in 1 day)`, and the video is a router that
    picks the glowing or the roasting outcome on the target district's satisfaction (45+); the VIP, award, review and
    spot check print `Outcome depends on …` — refuted (deck-3): B3 §4.9 gives the router no hint.
12. **`Furious` says the VIP "tells everyone"** but takes −10 in the VIP's district only (`ev_cust_vip_mad`,
    `src/data/events.json:84`) — refuted (deck-6): B3 §4.4's text and effect.
13. **`The report` (`ev_sec_aftermath`, events.json:106) keys on "lives lost ≥ 1"**, true for the rest of the run, and
    repeats (15-day cooldown), so one old incident can bring a second report "after the incident" — refuted
    (deck-7): B3 §4.5 defines it repeatable.
14. **Star names can clash**: `Like clockwork`'s ★ driver Rae and `Clean sweep`'s ★ inspector Vera are also pool names,
    so after hiring a pool Rae the reward reads `★ driver Rae 2` — refuted (deck-4): build 2's design. The Golden
    Release's flavour line repeats its title (`golden-release-offer.png`).
15. M13 shot notes not yet acted on: `Street fair` prints `orders +43 %` (spawn interval ×0.7; ×0.67 would read +50 %);
    a price in a button label repeats in the line below (`Fund them ($200)` / `−$200`, also left-pad, theft, the
    audit); `…then: Inside` (the crate, 0 days) has no "(now)"; the Snow card shows the rain picture (one picture per
    category, as planned).
16. `Front page` (`ev_press_expose`, events.json:146): the default `Sue` is a −$200 consequence, not a paid option, so
    at a low balance its line reads the capped amount (`−$30 (all you have)`, the M15 sim-2 fix) instead of being
    greyed. The ticker still says `Subscriptions unpaid` when a loan repayment cannot be paid; the card line says
    `bills +$N/day` (deck-2, Q-RUN21).

**Metrics and the summary card**

17. **Fun bar 3 item 3 is set for −10 %** (`L2 by 10:30, L3 by 16:30`): the policy medians are 10:44 / 16:31 and only
    2/10 seeds meet both; the seed-7 profile fails it by 14 s (Q-RUN14). `src/metrics/playtest.ts FUN_TARGETS`.
18. **Item 2 on the seed-7 profile fails by 5 s** (`gap 1:35`, from 4:51 to 6:26 of game time, no card, job or Hold Bay
    beat). Over 40 seeds 12 have a gap over 90 s on the ramp. Item 2 also stays `–` before L2 even when the gap so far
    is already over 90 s, and between 11:00 and a late L2 it can read ✓ and then flip to ✗ — refuted (scenes-1): the
    contract's window rule (D-M15-2).
19. **Item 4 reads `pairs only` ✗ before the run is over** whenever no chain is under way (`summary-card-360x604.png`
    at 10 min). That is the contract's rule (a fail when nothing is running), but it can look like a final verdict.
20. `stats.chainsStarted` still counts a chain whose due link was dropped (its card's condition failed) as started and
    never finished, so the gate's started/finished pair (79 / 72 over 40 seeds) overstates open stories; the profile
    reads `events.chainsRunning` instead (review sim-1, metrics side only; a `stats.chainsDropped` counter would
    change the save shape).
21. `tests/playtest/seed-7.json` comes from a fast-forwarded run (107.6 real seconds): `thinkMedianS` 0, `Taps/min`
    high, item 5 ✗ by design; its `buildStamp` reads `3b8bc50` until shots run at the M15 sha. Restoring a save that is
    older than the profile (not something the HUD leaves behind: every choice and event life saves on the next frame)
    can keep an event life the restored sim has back — refuted (sim-3).

**UI and UX** (unchanged from build 2 unless noted)

22. `ev_pic_staff`'s mug and paper and the press paper use the panel's cream (`grey5`), so on the card they read as
    line drawings (`event-card-three.png`); a darker inset behind the 48×48 slot would fix it without new art.
23. A card drawn while a sheet is open holds the sim until the sheet closes (the chip pulses) — a departure from B3 §3.4
    (Q-RUN17). `Enter` takes the first option, never a red or greyed one (Q-RUN18).
24. The ticker's blinking PAUSED follows the game clock, so six of the twelve category shots show it and six do not
    (not visible to players; shots are not pixel-identical between runs).
25. Still open from build 2: no scroll hint in the tall rooms (§6.6), warehouse toasts over the incident sign / the
    QUARANTINE label (§6.7), HUD toasts over the Day chip (§6.8, `victory.png`), district plates under the region
    chips (§6.9, `event-lost-life.png`), the tier-4 bin tag cut at 393 × 659 (§6.10). You asked for no UI tweaks this
    build (plan-build3 §2).
26. iOS-only behaviour is unverified (no WebKit here): the card's tap guard on a real touch screen, rotating with a card
    open, safe areas, 100dvh under Safari's toolbars. The rotate card now stops a card's think clock (M15 fix,
    scenes-2 / mobile-1). docs/phone-checklist.md lists the lines to tick.

**Platform, art and housekeeping**

27. Two stale shots (`quest-offer.png`, `quest-offer-360x604.png`, M11) sit in `shots/`; delete them before zipping.
28. `check-dist` warns about the tracked 0.01 MB `public/gallery.html` (dev-only, in `dist/` and the zip).
29. `vlr check` takes 186 s, past plan.md's 3-minute target by 6 s (the unit suite grew to 3,101 tests).
30. The `world` atlas holds 536 frames, ≈ 82 % of the sheet: over the 75 % target, under R13's 90 % trigger.
31. Art carried over: the flat dust cloud, `ap_plane`'s single heading, eight finals with pink specks,
    `ru_peer_pasture`'s earth rim (report-2 §6.21–§6.24); `victory_art` is a night scene with 18 colours (A12) — your
    call in G7 (§11).
32. The Phaser chunk is 353 kB gzip against plan.md §6.11's ~300 kB estimate; the music is still unheard on this VM.

## 7. Open questions

### 7.1 plan-build3 §11 (Q-B3): your answers and the defaults taken

| #       | Question                                     | Shipped                                                                                                                                                                                                                 | Where coded                                                     |
| ------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Q-B3-1  | Pacing −10 %                                 | Windows × 0.9; thresholds L2 $1,750 / L3 $3,250 / L4 $4,650 / L5 $6,500 with `newStrainDelayS` 90 and `perLevel` 0.015; reached ≈ −8 % (R26)                                                                            | `levels.json`, `parcels.json`, `economy.json pacingTargets`     |
| Q-B3-2  | Cards pause and never expire (answered)      | Every card holds the sim until tapped; jobs too, no Later; the Golden Release keeps its gold card and Later                                                                                                             | `src/sim/systems/deck.ts` (the hold), `src/ui/EventCard.ts`     |
| Q-B3-3  | Event cash (accepted)                        | Balance only, never lifetime earned: cards never move the level clock directly                                                                                                                                          | `src/sim/systems/effects.ts` (`earned: false`)                  |
| Q-B3-4  | Harsh consequences (answered)                | Cards may take the last life, the last vehicle, the only inspector — always with a way out on the card or its chain head (schema rule), red options, `— this can end the run`, the game-over variant, the rescue loaner | `effects.ts`, `src/data/schema.ts`, `tests/data/events.test.ts` |
| Q-B3-5  | Cadence                                      | L1 60–100 s … L5 90–140 s of sim time; first card at 200 s; one open + one queued; links do not restart the timer                                                                                                       | `events.json schedule`                                          |
| Q-B3-6  | Jobs while the Golden Release waits          | Blocked (decision cards keep coming), so `express_lane` stays after Victory (§6.8)                                                                                                                                      | `quests.ts ultimatePending`                                     |
| Q-B3-7  | Golden Release rate + Victory art (answered) | `minOnTimeRate` 0.85; `victory_art` 208×104 + `fx_confetti`                                                                                                                                                             | `levels.json ultimateQuest`, `src/ui/VictoryCard.ts`            |
| Q-B3-8  | Policy scores                                | Data weights (`events.json policy.weights`, life $600, the last −∞); band −$20 … +$40, non-default ≥ 0.4 — both met on the median                                                                                       | `src/sim/policies/eventPolicy.ts`                               |
| Q-B3-9  | Pictures                                     | 13 PixelLab 48×48 `event-pic` + the Victory art; 233 of 400 generations; G7 open                                                                                                                                        | `art/manifest.json`                                             |
| Q-B3-10 | No chance rolls                              | Outcomes are fixed or depend on a stated condition on your own state                                                                                                                                                    | `deck.ts` conditional next, routers                             |
| Q-B3-11 | Deck size                                    | 115 shipped of the 145-card pool (+ 4 routers + the rescue)                                                                                                                                                             | `events.json deck`                                              |
| Q-B3-12 | Save                                         | `STATE_VERSION` 6 under `pm.save.v2`; build-2 saves discarded                                                                                                                                                           | `src/sim/types.ts`, `src/sim/save.ts`                           |
| Q-B3-13 | Stop after M12 (answered)                    | Overridden by the part-B prompt (part A never ran); the M12 zip was sent mid-run instead (Q-RUN12)                                                                                                                      | —                                                               |
| Q-B3-14 | spicy cadence                                | First card at 60 s; 30–60 s at L1–L2, 40–70 s from L3                                                                                                                                                                   | `public/configs/spicy.json`                                     |
| Q-B3-15 | Job offers on the EventCard (accepted)       | `JOB BOARD` card, Accept / Decline with the objective and reward lines; the QuestCard keeps active / complete and the gold offer                                                                                        | `src/ui/EventCard.ts`, `src/ui/QuestCard.ts`                    |

### 7.2 The run's own decisions that need your confirmation (Q-RUN continues at 12)

| #       | Decision                              | What shipped and why                                                                                                                                                                                                                                                                                                                                                                                    | Where                                                         |
| ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Q-RUN12 | Part A never ran; no feel-check notes | The part-B prompt arrived with `main` at the build-2 hand-off and the notes block holding its template text. The run built M11 → M15 in one go, sent the M12 zip mid-run, and ran the M13 / M15 deck reviews on the plan's rules. No Q-B3 default was changed by a note. Notes now go into a follow-up deck pass.                                                                                       | decisions.md "Run-start findings (2026-10-31)"                |
| Q-RUN13 | Victory by 40 min not met             | Continues Q-RUN9. The Golden Release fails on its 5-day clock (34/44 offers time out); 0.85 did not move a single seed's win. `days` and `deliveries` are out of scope (plan-build3 §3), so the call is yours: 6–7 days, 45–50 deliveries, or the stretch item stays a stretch.                                                                                                                         | `levels.json ultimateQuest`, `tests/sim/victory.long.test.ts` |
| Q-RUN14 | ≈ −8 %, not −10 %                     | R26: the $100 steps that reach −10 % push L2 out of the band (−12.5 %) or break the lives / overseas rows. Fun bar 3 item 3 kept the −10 % bars (10:30 / 16:30), which the policy meets on 2/10 seeds. Default: accepted; your call: the bars at 11:00 / 17:00, or the levers of §10.5.                                                                                                                 | `levels.json`, `FUN_TARGETS`                                  |
| Q-RUN15 | Spec numbers changed on ~20 cards     | B3 §4 was a first pass: rewards halved (sponsor, crate owner, VIP, award), the investor $800 → $400, bike lanes ×1.15 → ×1.05, the container 8 → 4 parcels, three cards made into decisions, the tax at L3, … each to keep an option under `evMax` or the policy inside the band.                                                                                                                       | decisions.md M13                                              |
| Q-RUN16 | The investor is declined              | At $400 (was $800) the angel's money for −10 % income no longer scores above Decline; the policy declined 4 of 4 offers. B3 §3.8's "+275" no longer holds. You still see the chain.                                                                                                                                                                                                                     | `events.json ev_money_investor`                               |
| Q-RUN17 | A card behind a sheet holds the sim   | B3 §3.4 said a sheet does not hold; with the sim-side hold a card drawn under a sheet freezes the game (the chip pulses) until the sheet closes. Kept: every card pauses (Q-B3-2), the frame is stable.                                                                                                                                                                                                 | `src/sim/sim.ts held`, `HudScene.ts`                          |
| Q-RUN18 | Enter takes the first option          | B3 said Enter = the default, but the default is invisible and can be the danger face (`On the doorstep` → `Carry on`); Enter takes the first shown option, never a red or greyed one, and Esc is swallowed on decision and job cards (D-M12-2).                                                                                                                                                         | `src/ui/EventCard.ts`                                         |
| Q-RUN19 | Engine departures                     | Blank draws instead of "retry next tick" (D-1), a second event stream for content (D-2), no per-tick modifier cache (D-3), a payday tick is quiet for the deck, the L5 threshold $100 under the plan's scan range.                                                                                                                                                                                      | decisions.md M11                                              |
| Q-RUN20 | Metrics v3 departures (D-M15-1…12)    | No "slid" row (nothing slides under Q-B3-2): `Cards 18 · 16 decisions · 2 news`; the ramp window is [3:00, L2], capped at 11:00 before L2; fun bar 1 counts decision cards only; fun bar 4 counts a closed chain of 3+ cards; think time is the wall time the card was visible (not behind a sheet, a hidden tab or the rotate card); `events.chainsRunning` added beyond B3 §6; `FUN_TARGETS` in code. | `src/metrics/playtest.ts`, `src/metrics/funBar.ts`            |
| Q-RUN21 | Effect-line wording                   | A `payrollAdd` effect reads `bills +$N/day` (it is a loan, a cat, a night crew or insurance as often as a subscription); the ledger row and ticker keep `Subscriptions`. A job's Decline reads `No jobs for 1 day`. A loss larger than the balance reads `−$30 (all you have)`.                                                                                                                         | `src/sim/systems/effects.ts`, `deck.ts`                       |

Still open from builds 1–2 (report-playtest2.md §7, answers welcome by number): samples before the Title tap (R14), the
walkout "finishes its trip" rule (R11), the Q-RUN1 dock relief, the satisfaction drift (R25), the scan frames (D15),
the palette G1 and the G2–G6 art verdicts.

## 8. Feedback P1–P10 and the feel check: what changed

| #   | Your note (plan-build3 §2)                                    | What shipped                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Graphics are fine — no tweaks                                 | No art or UI change outside the cards: 13 category pictures, `victory_art`, `ic_event`, `fx_confetti` (B3 §5). G1–G6 untouched; G7 waits for you (§11).                                                                                                                            |
| P2  | L1 → L2 is too long                                           | L2 11.72 → **10.73 min** (−8.4 %), by threshold ($2,000 → $1,750) with `newStrainDelayS` 90; the plateau now carries 4 decision cards (median, 3–5 per seed) and jobs between 3:20 and L2. Longest quiet on the ramp: 85 s median on seeds 1–10.                                   |
| P3  | The whole game ≈ 10 % shorter                                 | L3 −8.2 %, L4 −8.1 %, L5 −8.6 % (16.51 / 20.55 / 25.33 min); the Golden Release offered at 25.33 min and at 0.85 on time. Two passes (deck off at M11, deck on at M14). **−8 %, not −10 %** (Q-RUN14).                                                                             |
| P4  | A new mechanic: events, Reigns × Crusader Kings               | A deck of decision cards with two or three options, each option's effects printed before the choice; the card pauses the game and never expires (Q-B3-2); 18 modifiable keys behind one registry; permanent and timed effects, listed on the EffectsCard.                          |
| P5  | Jobs become a type of event; events more generic and frequent | One scheduler draws every card; a job is a `JOB BOARD` card (Accept / Decline) feeding the unchanged quest engine; 21 cards by 30 min (per run: 14 decisions, 2 news, 5 jobs); 6 jobs offered, 3 done by 30 min.                                                                   |
| P6  | Show the effects of each decision                             | Every effect line is generated by the sim's own summariser from the data the sim applies (never hand-written); `…then:` for a link, `Outcome depends on …` for a condition, `Can't afford · $N`; the M15 fix makes a capped loss honest too (`(all you have)`). No dice (Q-B3-10). |
| P7  | Chains with branches (the gang example)                       | 19 stories shipped: the gang (4 cards, as you wrote it), union, rival, investor, permit / hearing, audit, crate, strike, storm, ring, plus outcome trios and pairs. Over 40 seeds the policy finished 72 chains, 21 of them 3+-card stories.                                       |
| P8  | 100–120 unique events; lives, permanent effects, anything     | 115 cards across 12 categories (from a 145-card pool); cards can take or give lives — the last one included — vehicles, staff, pips, the shelf cap, parcels, money; the reactive cards; the rescue loaner keeps a grounded company playable.                                       |
| P9  | A few icons per category; nice art for the victory screen     | 13 PixelLab 48×48 pictures (one per category + the job board) and a 208×104 night-time Victory illustration with a confetti burst; 233 generations.                                                                                                                                |
| P10 | A review by a clear-context agent                             | On the plan before the run (DRAFT v2), on the deck at M13 (three reviewers by category group, every card on its generated lines), and at M15: a deck/copy pass over 30 cards on the shots plus sim, scenes and mobile passes — 16 findings, 9 fixed, 7 refuted (§6).               |

**The feel check.** The plan put a phone feel check between M12 and M13 (Q-B3-13), with your notes pasted into the
part-B prompt. When the run started, part A had never run (no M11 or M12 commit on `main`) and the notes block still
held the template text. The prompt says never to wait, so the run did M11 → M15 in one go and, instead of stopping:

- wrote `docs/feel-check-m12.md` and sent the M12 build (`pm-tycoon-617e97b.zip` + shots) at 10:06 UTC, so a short
  phone session could still happen in parallel;
- ran M13's deck review on plan-build3 §8.4 task 3's rules alone (sense, tone, fit at 360 px, honest effects, a real
  choice), with three fresh-context reviewers reading each card's generated lines;
- repeated it at M15 on 30 random cards in the shots (deck-1 … deck-8: the `bills` wording, the intern's two days and
  the `Send {inspector}` label fixed; five refuted as B3 §4's own copy, §6.10–§6.14);
- left every Q-B3 default as planned, and left R32 (a second tap on a last-life option) and R34 (news cards that stop
  pausing) unused: both wait for your notes on pause feel and danger colour.

Any notes you send now (pause feel, cadence, the effect lines, the red, the chip, specific cards) go into a follow-up
deck pass, recorded in decisions.md by Q-B3 number where they change a default.

## 9. The deck: what the policy chose

**The shipped deck** (`src/data/events.json`, 120 rows): 115 cards + 4 routers (`ev_sec_breach_day`, `ev_city_audit_day`,
`ev_wx_storm_hits`, `ev_press_video`) + the rescue (`ev_luck_loaner`). 89 decision cards (83 with two options, 6 with
three) and 27 one-button rows (news, outcomes and the rescue); 47 rows are never drawn (42 links, the 4 routers, the
rescue); 33 cards can be drawn at L1.

Sources: the 10-seed gate (seeds 1–10 × 30 min) and the 40-seed run, recorded with a node script that hooks
`event:offered` / `event:decided` through `runSeed` (the gate's own loop, competent policy, the shipped data
`4c4343f6`); its counts match the gate's `eventsByCategory` and `chainsStarted` rows exactly.

| Category   | Shipped | Seeds 1–10: decisions · off-default · news | 40 seeds: offered | 40 seeds: decisions · off-default share |
| ---------- | ------- | ------------------------------------------ | ----------------- | --------------------------------------- |
| staff      | 11      | 9 · 4 · 0                                  | 48                | 48 · 0.69                               |
| fleet      | 7       | 19 · 7 · 0                                 | 50                | 50 · 0.36                               |
| customers  | 15      | 12 · 7 · 2                                 | 72                | 60 · 0.58                               |
| security   | 13      | 6 · 5 · 0                                  | 44                | 43 · 0.60                               |
| money      | 11      | 11 · 7 · 1                                 | 46                | 44 · 0.66                               |
| city hall  | 13      | 9 · 6 · 6                                  | 65                | 41 · 0.61                               |
| weather    | 7       | 13 · 8 · 6                                 | 60                | 42 · 0.76                               |
| press      | 9       | 11 · 4 · 3                                 | 43                | 37 · 0.38                               |
| underworld | 9       | 14 · 8 · 1                                 | 64                | 58 · 0.48                               |
| tech       | 5       | 12 · 7 · 0                                 | 41                | 41 · 0.76                               |
| port (L3+) | 9       | 15 · 6 · 3                                 | 54                | 45 · 0.40                               |
| luck       | 6 (+1)  | 9 · 3 · 0                                  | 48                | 48 · 0.31                               |
| job        | —       | 49 jobs                                    | 203               | —                                       |
| **All**    | **115** | **140 · 72 (0.51) · 22**                   | **838**           | **557 · 0.55**                          |

Per run (40 seeds, medians): 14 decision cards (11–18), 2 news, 5 jobs; 7.5 answered off the default (5–11); 9
categories (7–11). Coverage: 59 distinct decision cards on seeds 1–10, 76 on 40 seeds; 93 of the 116 cards seen at
least once in 40 × 30 min. Drawable two-option cards never offered by 30 min in 40 seeds: `ev_fleet_gearbox` (seed 7
meets it at 34:31), `ev_sec_breach` (the ring), `ev_crime_insider`.

**Chains** (started / finished, gate rows): seeds 1–10 21 / 19; 35 min 26 / 24; delegating 23 / 23; 40 seeds 79 / 72.
Stories of 3+ cards finished: 6 on seeds 1–10 (on 5 seeds), 21 on 40 seeds (on 17): the permit fight 8, the gang 6,
the dock strike 4, the rival 3. Pairs: the storm 15, the audit 9, the fence, the review, the spot check and the VIP 5
each, the influencer 3, the tax and the leak 2. Never finished as a story: the investor (declined 4/4), the crate
(tossed 5/5), the union (granted 1/1, so no strike), the ring (never drawn).

**The EV band** (`policyEvPerCard`: the mean score of the options the policy chose, in dollars per card; band −$20 …
+$40, `events.json policy.evBand`):

| Run              | EV per card median | Per seed      | Seeds in band | Non-default share | deckEvMean |
| ---------------- | ------------------ | ------------- | ------------- | ----------------- | ---------- |
| Gate, seeds 1–10 | $24.38             | −20.9 … +51.1 | 7/10          | 0.52 (8/10 ≥ 0.4) | −$30.88    |
| 35-min gate      | $22.0              | —             | —             | 0.49              | −$30.88    |
| Delegating       | $21.05             | —             | —             | 0.50              | −$30.88    |
| 40 seeds         | $20.55             | −20.9 … +65.6 | 29/40         | 0.54 (35/40)      | −$30.88    |

`deckEvMean` is the state-free mean over every option of every card: picked blindly, a card costs about $31; the
policy's +$20…24 is what choosing is worth. No life is ever lost to a card in any run (the policy's last-life rule and
the $600 life weight keep it on the way out); events gave 1 life on seeds 1–10 and 5 over 40 seeds; at most 3
modifiers ran at once.

**The ten most-picked options** (40 seeds; the policy is deterministic per state, so most cards always get the same
answer; 21 of 76 cards saw both answers, e.g. the dock strike Oppose 4 / Support 5, the VIP Promise 5 / Decline 9, the
storm Board up 12 / Ignore 3):

| #   | Card (category)              | Option            | Picked / offered | What it does                                                   |
| --- | ---------------------------- | ----------------- | ---------------- | -------------------------------------------------------------- |
| 1   | Heatwave (weather)           | Ice cream         | 17 / 17          | −$30 against a day of slower lanes and bikes                   |
| 2   | A wallet (luck)              | Keep it (default) | 16 / 16          | +$60 (Return it: +4 satisfaction there)                        |
| 3   | Small-business grant (money) | Apply             | 14 / 14          | +$150, once                                                    |
| 4   | The alley (fleet)            | Allow it          | 14 / 14          | speed ×1.1 for 2 days, −4 satisfaction in the district         |
| 5   | Fast lane (port)             | No (default)      | 14 / 14          | declines clearance ×0.5 for 3 days at $200                     |
| 6   | Smash and grab (underworld)  | Give chase        | 13 / 13          | a vehicle parked half a day, +3 satisfaction                   |
| 7   | Bargain tyres (fleet)        | No (default)      | 12 / 12          | declines +$60 for bikes ×0.92 speed for 2 days                 |
| 8   | Storm warning (weather)      | Board up ($100)   | 12 / 15          | $100 now; the storm's damage card is skipped                   |
| 9   | You've won! (underworld)     | Delete (default)  | 12 / 12          | declines a vehicle discount that brings +5 % malware for a day |
| 10  | The cat (luck)               | Keep it           | 12 / 12          | processing ×0.98 for good, $2 a day                            |

Tied at 12: Radios → Buy them ($40 per vehicle, every driver +1 energy) and A tip → Pay ($50, one wanted label).

**Never picked** (the most-offered options the policy never chose, 40 seeds): Heatwave → No (0/17), A wallet → Return it
(0/16), Grant → Skip (0/14), The alley → Forbid it (0/14), Fast lane → Pay ($200) (0/14), Smash and grab → Refund them
($80) and → Report it (0/13), Bargain tyres → Take them (0/12), You've won! → Click (0/12), The cat → Shoo it (0/12),
Security drill → Skip (0/11). Also never: An angel → Take it (0/4, Q-RUN16), Protection → Pay up ($300) (0/7: it always
refuses, hides the fleet and calls the police), The recall → Take the strike (0/6) and every other red option.

Reading it: the policy is a cautious accountant (it buys cheap permanent gains, pays to skip trouble, keeps found
money, never takes a red option). A human who returns the wallet, pays the gang or takes the angel's money will see
cards and stories the gate never played.

## 10. Balance: the −10 % pass

### 10.1 Build 2 → M11 → M14 (medians, seeds 1–10 × 30 min; M15 equals M14)

| median (min)                       | build 2    | M11 (deck off)  | M14 (deck on)         | Δ vs build 2 |
| ---------------------------------- | ---------- | --------------- | --------------------- | ------------ |
| L2                                 | 11.72      | 10.57           | 10.73                 | −8.4 %       |
| L3                                 | 17.98      | 16.52           | 16.51                 | −8.2 %       |
| L4                                 | 22.35      | 20.56           | 20.55                 | −8.1 %       |
| L5                                 | 27.70      | 25.46           | 25.33                 | −8.6 %       |
| truck after L2                     | +1.54      | +2.78           | +2.30                 |              |
| overseas after L3                  | +2.18      | +2.66           | +2.95                 |              |
| Golden Release offered (35 min)    | 27.70      | 25.46           | 25.33                 |              |
| 40 seeds: L5 · seeds losing a life | — · 14/40  | 26.11 · 13/40   | 26.68 · 12/40         |              |
| victory seeds 1–3 (target ≤ 40)    | none by 45 | 47.6 / 49.5 / — | 48.82 / 56.60 / 47.62 |              |

M11's informational run with the 19-card seed deck on was −11.0 / −11.6 / −8.2 / −11.0 %; with the full deck (M12–M13)
the medians settled at ≈ −8 %.

### 10.2 Level times per seed (minutes; build 2 → M11 deck off → M14 deck on)

| Seed       | L2                    | L3                    | L4                    | L5                      |
| ---------- | --------------------- | --------------------- | --------------------- | ----------------------- |
| 1          | 11.19 → 10.06 → 10.00 | 17.10 → 15.30 → 15.70 | 22.33 → 20.12 → 19.49 | 28.39 → 25.50 → 25.33   |
| 2          | 11.98 → 10.20 → 10.45 | 19.59 → 16.52 → 19.16 | 23.44 → 21.85 → 23.09 | 28.22 → 25.52 → 26.87   |
| 3          | 12.05 → 10.73 → 10.83 | 18.00 → 17.18 → 16.21 | 22.38 → 20.76 → 19.67 | 26.56 → 24.05 → 25.32   |
| 4          | 10.63 → 9.70 → 9.44   | 16.01 → 14.76 → 16.67 | 19.63 → 19.36 → 20.48 | 24.93 → 25.41 → 25.77   |
| 5          | 12.36 → 12.21 → 11.33 | 19.52 → 18.07 → 16.38 | 24.89 → 21.28 → 19.16 | (31.50) → 26.51 → 24.83 |
| 6          | 11.48 → 10.78 → 10.72 | 17.01 → 15.91 → 16.64 | 21.12 → 20.35 → 21.09 | 27.72 → 24.35 → 24.19   |
| 7          | 11.89 → 11.40 → 10.74 | 17.96 → 18.99 → 15.92 | 22.72 → 23.26 → 20.61 | 27.88 → 27.48 → 24.85   |
| 8          | 12.22 → 11.30 → 11.83 | 18.49 → 19.77 → 19.63 | 22.71 → 24.39 → 23.91 | 27.68 → 28.77 → 29.04   |
| 9          | 11.54 → 10.41 → 10.97 | 18.18 → 16.53 → 17.23 | 21.72 → 19.53 → 21.59 | 26.99 → 25.16 → 27.64   |
| 10         | 10.27 → 9.09 → 9.33   | 15.36 → 15.61 → 14.75 | 19.79 → 19.91 → 18.71 | 25.22 → 25.23 → 22.31   |
| **Median** | 11.72 → 10.57 → 10.73 | 17.98 → 16.52 → 16.51 | 22.35 → 20.56 → 20.55 | 27.70 → 25.46 → 25.33   |

Seed 5's build-2 L5 (31.50) is from the 35-min run (none by 30). Seed 7's automated profile, the closest thing to a
played run: L2 10:44, L3 15:55, L4 20:36, L5 24:51, 309 deliveries (62 % on time), $12,449 lifetime, 23 cards (16
decisions, 5 jobs, 2 news; 6 off the default), two pairs finished, no life lost.

### 10.3 The levers used

1. `newStrainDelayS` 60 → 90 first, by design (B3 §2.2 lever 1): build 2 had shown that lower thresholds break the
   lives row.
2. The four thresholds, one row at a time with full gates (M11 scan, §4 table).
3. `perLevel` 0.02 → 0.015 when the first-guess thresholds pushed the 40-seed share to 15/40.
4. `minOnTimeRate` 0.85 (your answer); no gate row moved.
5. The deck itself at M12–M13: card weights, cooldowns and 20-odd card numbers tuned for the EV band, never a balance
   file (R21's "deck before data").

### 10.4 Why −8 %, not −10 %

- **The thresholds move in steps that overshoot.** L2 $1,700 is a cliff (truck +3.55 min and L3–L5 back to −1…−2 %);
  L3 $3,200 fails the overseas row and $3,400+ the lives row; the in-range L5 values gave −7.4…−7.7 % with a 35-min
  lives median of 0.5. An all-−10 % set (1,750 / 3,150 / 4,450 / 6,300) was green with the deck off but put L3 at
  −13.2 % with the deck on.
- **M14's probe** of −$100 on every row gave L2 10.25 (−12.5 %, out of the −8…−12 % band) and 13/40 lives.
- **R26** says −8 % is accepted before any value beyond the lives levers moves, so the run stopped there. Every window
  passes on 10 and 40 seeds; the 40-seed L3–L5 are only −5.6 / −3.8 / −3.7 %.
- **Victory** is set by the Golden Release's 5-day clock: 34 of 44 offers time out at both 0.9 and 0.85.

### 10.5 Levers left for you (B3 §2.2 order; one decisions.md line each)

1. **The L1 openers** (B3 §2.2 lever 2, untouched): start money $450 → $500 (tested at M13: passes the quick gate on
   its own, but puts 7/10 seeds at the L1 card floor of 3 and moves every later level), then the bike price $180.
2. **Single-row nudges** of −$50 on L3 / L4 / L5 (−$100 steps overshoot), each checked against the overseas and lives
   rows over 40 seeds.
3. **The Golden Release** (`days` 5 → 6–7 or `deliveries` 60 → 45–50; out of the plan's scope, so yours), checked with
   the tycoon config's ≥ 3-min rule (R29).
4. **Lives**: `perLevel` 0.0125, or `newStrainDelayS` 120.
5. **The deck**: halve the richest money options if EV per card should come under +$20 (R21); `jobShare` 0.65 → 0.5
   for fewer jobs and more decisions.
6. **The fun bar**: item 3's bars at 11:00 / 17:00 if −8 % stays.

## 11. Art approval request G7

**State** (`art/manifest.json`): build 3 adds 14 PixelLab ids — the 13 category pictures (`ev_pic_*`, class `event-pic`,
48×48, `world` atlas) and `victory_art` (208×104) — plus the procedural `ic_event` and `fx_confetti` (no approval flag).
Two PixelLab rounds on 2026-10-31 (Pro Flash, magenta key): 3 candidates per id, then one re-roll of `ev_pic_port`.
After an independent vision review two picks were swapped (`ev_pic_security`, `ev_pic_cityhall`) and `victory_art`
was reprocessed without the malware ramp. Every id ships a PixelLab pick (no procedural fallback in the game); every
pick is `approved: false` and waits for you.

**Sheet: `art/contact/events@4x.png`** (4960 × 6776): the 13 pictures at 4×, each in situ on the real EventCard
cropped from the M15 shots (`shots/event-card-<category>.png`, one shipped card per category, plus the job board), the
victory art on a VictoryCard mock with the confetti, the confetti frames, `ic_event` beside the rush `ic_bell`, an
EventChip mock and the procedural fallbacks for comparison. Candidates: `art/contact/candidates-b3-events@4x.png` and
`candidates-b3-port-reroll@4x.png` (gitignored, on this VM).

| id                  | Pick | What it shows                                                                                              |
| ------------------- | ---: | ---------------------------------------------------------------------------------------------------------- |
| `ev_pic_staff`      |   #2 | a clipboard and a big white coffee mug                                                                     |
| `ev_pic_fleet`      |   #2 | a spoked bike wheel crossed by a wrench                                                                    |
| `ev_pic_customers`  |   #0 | a blue mailbox with a red heart and a raised flag                                                          |
| `ev_pic_security`   |   #2 | a parcel, a magnifier and a red skull tag (swapped from #1 by the review)                                  |
| `ev_pic_money`      |   #0 | gold coin stacks on a green ledger                                                                         |
| `ev_pic_cityhall`   |   #0 | a blue-roofed civic hall with a clock and a flag (swapped from #1, which was busy at 1×)                   |
| `ev_pic_weather`    |   #2 | a rain cloud, the sun behind it, blue drops                                                                |
| `ev_pic_press`      |   #2 | a newspaper and a microphone                                                                               |
| `ev_pic_underworld` |   #2 | a red crowbar and a burglar's mask                                                                         |
| `ev_pic_tech`       |   #0 | a grey gear with an orange bug                                                                             |
| `ev_pic_port`       |   #5 | a blue container and a red customs stamp with a check mark (re-roll; every first-round stamp held a glyph) |
| `ev_pic_luck`       |   #0 | a four-leaf clover rising from a red gift                                                                  |
| `ev_pic_job`        |   #2 | the job board's clipboard with a gold star                                                                 |
| `victory_art`       |   #2 | the glass HQ at night with a winged-parcel emblem, fireworks, the fleet lined up, confetti                 |

The exact commands (in a clone after `vlt install`; no token needed; each edits only `art/manifest.json`, commit it):

```sh
vlr art:approve -- ev_pic_staff ev_pic_fleet ev_pic_customers ev_pic_security ev_pic_money ev_pic_cityhall ev_pic_weather
vlr art:approve -- ev_pic_press ev_pic_underworld ev_pic_tech ev_pic_port ev_pic_luck ev_pic_job victory_art
vlr art:reject -- victory_art "want a daylight scene"   # one id per command; logs the reason, keeps the image until a re-roll
```

A rejected id keeps its image until a re-roll replaces it: `vlr art:gen -- --ids <id> --n 3 --seed 6000` (needs
`PIXELLAB_TOKEN` in `.env`; 67 generations left before the reserve, 167 with it), pick from the printed
`art/contact/candidates-*@4x.png`, then `vlr art:approve -- <id>:<n>`, `vlr art:build`, `vlr check`. To fall back to the
procedural composition instead, set the row's `placeholder: true`, drop its `chosenCandidate` and run `vlr art:build`.

What the agent would look at first:

- **`victory_art` is a night scene**: Pro Flash painted its own sky on all three candidates; #2 kept the whole scene.
  It is the one picture that breaks STYLE.md §1's "no dark grading" (on purpose: the B3 §5 prompt asks for the HQ at
  night with fireworks), with 18 colours (lint A12). Say if you want a daylight re-roll.
- **`ev_pic_staff`** (and the press paper): cream `grey5` on the cream card panel reads as a line drawing; a darker
  inset behind the 48×48 slot would fix it without new art (a UI call).
- **`ev_pic_cityhall`** lost its stamp in the swap; **`ev_pic_security`** has one stray purple pixel at the magnifier.
- **Colour rules** (lint A07 per id): `event-pic` never uses the malware ramp; gold only on the reward pictures (money,
  job, luck).

**Still open from builds 1–2** (sheets and commands in docs/art-todo.md and report-playtest2.md §9): G1 palette, the
six G2 anchors, the G3 buildings and vehicles, G4 (the four fixes), G5 (the five regions), G6 (tiers, machines,
people) and the scripted inspector scan frames.

## 12. Cost spent

| Item            | Spent                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PixelLab        | **233 generations** of the 400-generation build-3 budget (100 reserve untouched; 67 left before it), in 2 batches: `b3-events` 213 (2,422 → 2,209), the `ev_pic_port` re-roll 20 (2,209 → 2,189). M13–M15: 0. Balance **2,422 → 2,189**. **$0** in credits. |
| Builds 1–2      | Playtest 1: 1,700 generations (5,000 → 3,300); build 2: 877 (3,299 → 2,422).                                                                                                                                                                                |
| Retro Diffusion | $0 (no `RD_API_KEY`; never called)                                                                                                                                                                                                                          |
| Other paid APIs | $0                                                                                                                                                                                                                                                          |

Provenance per batch (time, tool, ids, balance before / after) is in `art/manifest.json#batches`; docs/art-todo.md has
the table and the regeneration one-liner.

## 13. Next steps

### 13.1 GitHub state, Pages and hand-off

- `main` was pushed at every checkpoint (M11 7d2ec44, M12 617e97b, M13 f4cb2a4, M14 3b8bc50) and at the end (M15
  `<pending: M15 sha>`), always `git push origin main`, no branches or PRs.
- Pages: `<pending: the result of the one gh workflow run pages.yml dispatch>`. In build 2 it was refused (`HTTP 403:
  Resource not accessible by integration`: the GitHub App has Contents: write but not Actions: write, Q-RUN11), and the
  site still served the playtest-1 build. To deploy by hand: Actions → **Pages** → **Run workflow** (or
  `gh workflow run pages.yml`).
- Hand-off: `dist-zip/pm-tycoon-<pending: M15 sha>.zip` and the shots zip, both sent with this report; `dist-zip/` is
  gitignored. docs/status.md gets its M15 entry and is copied back to `plans/pm-tycoon/status.md`.

### 13.2 What `playtest.json` v3 should answer

- **Did the cards feel like decisions or interruptions?** `events.thinkMedianS` (< 15 s is the soft bar),
  `events.choices[].thinkS` per card (a long think on a red card is fine; a long think on news is not), and how many
  you answered off the default.
- **Is the ramp busy?** `beats[]` from 3:00 to `level2AtS`: the longest quiet against 90 s, and whether the gaps are
  where the policy's are (4:51–6:26 on seed 7).
- **Did a story land?** `choices[].chain` with `end` and depth ≥ 3, and whether the `You chose:` line made it read as
  one story.
- **Which cards did you meet and how did you answer?** `events.byCategory`, `choices[].id` / `label` against §9 — the
  policy never pays the gang, never takes the angel, never returns the wallet; your answers show the stories it skips.
- **Pacing**: `level2AtS` … `level5AtS` against 10.73 / 16.51 / 20.55 / 25.33 min, and `pausedS` (time held on cards,
  sheets and pauses) on top of it.
- **Harsh cards**: `livesLost[]` with `cause: 'event'` and the option; `events.vehiclesLost`, `workersLost`,
  `gameOverByEvent` — the gate never sees these (§6.6).
- **Victory**: whether the Golden Release felt winnable in a session (Q-RUN13).
- **Phone**: fps, the card's tap guard and the red option's 0.6-s wait on a real finger, rotating with a card open,
  plus the unticked lines of docs/phone-checklist.md.

### 13.3 Cut-order items not built

None: the EffectsCard, the confetti, the SALE tags, the newspaper item on a chain's end, the deck/copy pass, the
PixelLab pictures, the delegating event rows and the spicy cadence all shipped.

### 13.4 Known follow-ups

1. Your feel-check and playtest notes → a follow-up deck pass (pause feel, cadence, effect lines, danger colour, the
   chip, specific cards), recorded by Q-B3 number.
2. Your Victory call (Q-RUN13) and the −8 % / fun bar item 3 call (Q-RUN14), then one pacing pass checked on 40 seeds.
3. Deck copy polish: the title echoes (§6.10, and the Golden Release's flavour line), the influencer's hint, `Furious`,
   `The report` as `once`, the price repeated under a label, `orders +43 %`, `Subscriptions unpaid` for a loan.
4. Metrics: a `stats.chainsDropped` counter (§6.20) with the next save bump; fun bar item 4's wording mid-run.
5. Art: your G1–G7 verdicts; a darker picture inset on the EventCard if the staff mug bothers you.
6. Housekeeping: delete the stale `quest-offer*.png`, keep `public/gallery.html` out of `dist/`, and bring `vlr check`
   back under 3 minutes (the long sweeps out of the default `vlr test`).
