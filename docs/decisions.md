# Decisions log (playtest 1 + build 2)

Every "(default — confirm)" choice taken during the run, numbered as in `plan.md` §14, with where it is coded;
every runtime dependency (why, licence, size); every deviation from the plan found while running. The author
overrules any line by number.

## Run-start findings (sanity check, 2026-10-29)

- **Remote exists.** `github.com/ruyadorno/pm-tycoon` was created by the author (public, Pages source "GitHub
  Actions", ruy-bot app installed on it) and this checkout is a clone with `origin` set and an initial README
  commit, so `git init -b main` was skipped. Per plan.md §13.2 ("once the author has created the remote, push with
  `git push origin main` only") the run pushes `main` at milestone checkpoints; no branches, no PRs, no Pages deploy.
  AGENTS.md's git-auth paragraph was updated to say so (the template predates the repo).
- **`.github/workflows/pages.yml` is committed last.** Whether the app token has Workflows: write cannot be checked
  without pushing a workflow file; holding it until the final commit means a refusal cannot block the checkpoint
  pushes. (plan.md §6.12 / Q58.) Outcome: pushed at d6e3ee1 without a refusal.
- **PixelLab MCP already visible from the repo.** The author's registration covers both `~/agents/main` and this
  repo path at local scope, so the user-scope re-registration of plan.md §10 step (2) was skipped; the token was
  copied into the gitignored `.env` for the REST client without being printed. `GET /v2/balance`: Tier 2, 5,000
  generations, $0 credits.
- **Chromium**: Playwright 1.64.1 installs Chrome for Testing 156 without root; SwiftShader WebGL works (max
  texture 8192, `OES_standard_derivatives`); the `iPhone 16` descriptor exists (no R11 fallback needed).
- **`@types/node@26.6.6`** added as a dev dependency (not in plan.md §6.2): `tools/**` and `vite.config.ts` import
  `node:*` modules and `tsconfig.json` typechecks them; `types` is `["vite/client", "node"]`.
- **vite 8 / rolldown** rejects the object form of `manualChunks`; the phaser chunk is split with the function form.

- **This VM's global `~/.gitignore` ignores `*.md` and `CLAUDE.md`.** The repo `.gitignore` re-includes them (`!*.md`,
  `!CLAUDE.md`) so the docs are tracked.

## Run decisions on spec gaps (numbered Q-RUN; each also listed in the report's open questions)

- **Q-RUN1 — single loading dock + full shelf deadlock** (found by the M1 sim review; spec §6.4/§6.8 make a full
  shelf stall the lane, and with one dock nothing can load while the docked vehicle cannot unload into the full
  conveyor). Three rules, all in `src/sim/systems/{docks,dispatch}.ts`; inbound parcels never skip a checker:
  (a) **yield** — a `docked_unloading` vehicle blocked for ≥ `vehicles.dockIdleWaitS` while someone is queued leaves
  the dock with its cargo and rejoins the back of the queue; (b) **stall preference** — while the lane is stalled with
  `shelfFull`, the `idle_lot` pass prefers "re-queue to load" over "go collect", so an empty truck/van can dock and
  drain the shelf; (c) **relief** — when the dock has been blocked ≥ `dockIdleWaitS` with the shelf at cap, the docked
  vehicle could carry ≥ 1 shelf parcel and no empty vehicle that could is queued, the shelf accepts the lane's parcels
  past its cap (as it accepts a sold vehicle's cargo, §4.1) until that vehicle has unloaded; it then loads as usual. A
  randomized soak test (`tests/sim/dock-soak.test.ts`) asserts no deadlock. Default — confirm.
- **Selling a vehicle with inbound cargo**: spec §4.1 says carried parcels return to the shelf; parcels that were
  collected but not yet inspected now go to the dock conveyor instead (they pass the checkers like any inbound
  parcel), only outbound cargo returns to the shelf — otherwise selling a vehicle let malware bypass every checker
  (§6.4 "never wave through"). `src/sim/systems/vehicles.ts` sellVehicle.
- **Q-RUN2 — `economy.satisfaction.waitingPenaltyAfterS = 180`** added (spec §9.1 "crosses 180 s"), so no threshold is
  hard-coded in `satisfaction.ts`; validated by `schema.ts`.
- **Retune (gate row `holdBayEventsPer10MinMin`, §7.6 order after values; plan Q-R2 levers):**
  `parcels.malware.baseShare` 0.03 → 0.05 and `parcels.decoyShare` 0.10 → 0.20. At the spec values the L1 Hold Bay
  density was ~4/10 min (< 6). A 40-seed study on the L1 window (~12 min): decoyShare 0.15 → median 6.67 with 18/40
  seeds < 6; 0.20 → 7.50 with 13/40. Cost: ~2.5 more wrong tosses per 30 min under the Toss-everything policy.
- **Wrong Toss of a same-district parcel** costs that district −3 once (origin and destination are the same
  district), not twice. `src/sim/systems/holdbay.ts`. Default — confirm.
- **Lost-life card rates come from the parcel's own rolls** (the lane as it was when this parcel passed), not the lane
  at the moment of loss — otherwise a detector bought after the parcel passed showed "was 97%" next to "missed (85% vs
  metal)". Cleared parcels keep the lane-now reading (their card leads with "Cleared by you").
- **Generalist flags show no trait icon** (warehouse-view §1.5/§3.1 call for the flagging checker's trait icon): decoy
  traits are uniform over all four strains (spec §5.4) while L1 malware is metal only, so a desk flag showing a
  battery/dense/rattle icon would give the decoy away. Specialist machines show their own strain. `HoldBayCard`,
  `LaneRenderer`.
- **First-flag funnel**: city-view §9.2 ties the toast + arrow to the scripted malware only, but on many seeds the first
  flag is a decoy minutes earlier; the first flag of a run now gets a neutral toast + the bouncing arrow + a room hint,
  and the scripted malware keeps its red "Toss it. Lives: 3". `HudScene`, `Onboarding`.
- **Busy checker = backpressure, not a stall**: `lane:stalled` fires for Hold Bay full / shelf full / a jammed buffer
  only, never while a slot is merely busy processing — otherwise the red button and stall alarm flashed ~15×/min with
  the desk behind a machine. The §7 policy rule "2nd inspector when the lane stalls > 10 s" is re-based on the dock
  being blocked (M3).

## View-level deviations (M1–M2)

- `map.json lot.parking` re-ordered: the first parking tiles are the ones the warehouse sprite does not hide (+2.5 s on
  the first delivery, still < 60 s median).
- Top bar + ticker alpha 0.94 (city-view says 0.85: world labels read through it); Warehouse/Garage buttons up to 92 px
  wide where W ≥ 393 (76 px left 1 px around the label).
- Onboarding step 3 waits until a building with waiting parcels is on screen; onboarding cards hide while a sheet,
  popover or dialog is up.
- `sign_locked`/`sign_pop` 96×52 (city-view 48×32) so m5x7 "Unlocks at Lv N" + "Trucks only" fit.
- Phaser 4.2.1 `TweenManager` reads `Date.now()`, so `__pm.freeze` drives tweens from the stepped delta
  (phaser4-notes §10 says tweens follow the frozen clock — not true for 4.2.1).
- Toasts in the warehouse sit on the room's north wall (L.toast covered the lane readout at 360×604).
- Lost-life card, counterOwned branch: "This one got through on the 3%" (city-view's "Your lane was at 97% — …" repeated
  the line above it).

## Run decisions and retunes (M3)

- **Q-RUN3 — scripted first malware origin** (`src/sim/systems/spawn.ts` nextPickupOrigins): among fleet-servable
  buildings with room, the origin is narrowed to where a vehicle collects next (a collecting vehicle's current target
  when an S still fits, or a delivering vehicle's last stop), so the §4.5 nearest-first leg starts there; after
  `atS + deferUntilCheckerS` any servable building is used. Before: the scripted parcel waited up to ~8 min for pickup
  (seed 3: 473 s; 4/10 seeds > 300 s). After: catch median 174 s, max 198 s on seeds 1–10. The suggested "within
  collectRadiusTiles of the lot" rule did not help (vehicles collect from wherever they finished delivering). Default —
  confirm.
- **Competent-policy extensions** (`src/sim/policy.ts`; spec §7 defines the gate policy, these make it play like a
  competent human): (1) **COUNTERS** — once the level's spec purchases are done (3 bikes at L1; truck + shaker at L2), a
  free slot gets the counter machine of the weakest announced strain at price + $50 (a 2nd Metal detector at L1, the
  shaker in slot 4 at L2). Share of 80 seeds losing ≥ 1 life in 30 min: spec policy 37/80 → 22/80. (2) **REHIRE** —
  walked-out workers are re-hired in pay order at fee + $50 before any purchase (spec §7 is silent; without it one
  walkout disables a run for good). (3) The "2nd/3rd inspector when the lane stalls > 10 s in a day" rule is re-based on
  the dock being blocked (summed `LoadingDock.blockedTicksThisDay` > 10 s), since a busy checker is backpressure, not a
  stall; at most one hire per day. It is dormant in playtest 1 (worst blocked day 7.9 s; the desk is ~68 % busy at L2).
- **Retune — `parcels.decoyShare` 0.20 → 0.22** (gate row `holdBayEventsPer10MinMin`; the quick gate of `vlr check`
  was 5.97 < 6 once the policy bought a 2nd detector): quick gate 5.97 → 7.87, full gate 6.59 → 7.15; 80 seeds below 6:
  21/80 → 11/80. `baseShare` 0.06 was tried first per the lever order and rejected (full-gate lives median → 1).
- **Retune — truck price $1,300 → $1,200** (gate row `truckAfterLevel2MaxMin`, §7.6 "truck late → lower its price"):
  with COUNTERS' $150 at L1 and decoy 0.22, the quick-gate truck landed +5.18 min after L2; after: +3.86 (quick), +2.10
  (full median); 80 seeds > 4 min: 29/80 → 12/80. Sell refund becomes $600. UI tests now read prices from data.
- **`malware.postVictoryPerDay` stayed 0.01 in playtest 1** (a 0.005 retune was tried and reverted by the sim review:
  at the final config it moved no gate row). Superseded in M7: 0.005, see "Run decisions and deviations (M7 — quests)".
- **`public/configs/spicy.json` decoyShare 0.2 → 0.3**: the plan's literal 0.20 is now below the base 0.22; the schema
  test asserts both spicy levers sit above the base tables.
- **Residual risk (author)**: the "no lost life in 30 min" window is dice at D ≈ 0.97–0.99 with the post-cap escalation
  (malware share 20 % by minute 30): ~19–29 % of 80 seeds lose one life; seeds 1–10 pass by median (2/10 lose one).
  Per-seed, 5/10 seeds miss at least one window while every median passes (docs/gate/latest.md).
- **Balance observation (author; not a gate row, not tuned per R5)**: under the competent policy the mean
  satisfaction drifts into the angry band during L2 (seed 7: 61 at 3 min → 26 at 12 → 6 at 30); late deliveries (−3,
  uncapped) outweigh the +4/day positive cap when the fleet saturates. The UX journey with a human-like opening stayed
  44–62 through L2 until a starvation walkout. Levers if the author wants a happier city: `satisfaction.late`,
  `positiveCapPerDay`, or more vehicles in the policy.
- **Walkout "finishes its trip"**: the vehicle serves the stop it is driving to or standing at, starts no new leg,
  unloads at home if it carries inbound parcels, then parks `inactive`; a vehicle already empty on the lot goes inactive
  at once. A driver who walks out during `docked_loading` departs and delivers the loaded parcels (§4.6) rather than
  returning them to the shelf (§11's lifecycle line) — author to confirm.
- **Payroll details**: `payroll:paid` only when the amount > 0; payroll runs before `day:ended` so the daily ticker line
  counts it; pay order keeps the original hire time after a re-hire; `payroll().short` means someone is still owed
  (re-hire clears it); hiring is refused while walked-out inspectors hold the free seats ("Seat held for re-hire").
- **Hold Bay bays are stable** (a held parcel keeps its bay; new ones take the lowest free bay) so the rack no longer
  compacts under the player's finger.

## View-level deviations (M3)

- PixelLab art installed: 63 generated sprites (7 anchors agent-approved provisionally, G2), 3 kept procedural (desk,
  shelf_t1, shelf_t2); 1,700 generations spent of the 2,500 run budget. Both style-reference routes copied the anchors'
  structure (breaking "one unique feature per building"), so the bulk pass used text prompts only; 3×3/exterior
  canvases use a keyed solid background. `tools/art/normalize.ts` passes through finals already on their class canvas
  (the first build re-centred 44 generated frames).
- Docked vehicles are drawn at a render-only dock pose on the visible SW face of the warehouse sprite (`dockBlend` near
  the dock tile): `map.json` docks run along the sprite's hidden NW side. Sim and map data unchanged.
- Vehicle origin from the manifest's `VEHICLE_FOOT` instead of Q24's (0.5, 0.75).
- Level-up: the warehouse swaps to `wh_ext_t2` on the dust "reveal" frame (750 ms); the stamp holds 800 ms then fades;
  the level/region newspapers wait 2.4 s so they never cover the moment; fx_dust is a jittered grid of 32×32 puffs over
  the exterior (no setScale on world art).
- Newspaper pictures larger than 48×48 become a palette-snapped 46-px "photo" texture (no setScale); two greeked text
  columns fill the card; several walkouts on one payday → one red toast, one paper, one ticker line; DEFUSED lines do
  not open a paper (only a lost life does, after its card closes).
- The "Now playing" toast shows once per title per session (audio.md says every loop pass ≈ every 2.3 min).
- Lost-life card rates keep one decimal from 99 % (a 99.8 % lane read "100 %").
- Grumble plays for an angry district label on screen (spec §9.2), throttled to one per 20 s by the director.
- The fps-based quality sampler is off under `navigator.webdriver` (SwiftShader frame rates would degrade every shot).
- Audio (Q46 addendum): the audio code is its own lazily imported chunk (~74 KB gz) started in `main.ts`; the director
  costs ~5 ms in Boot; the 18 zzfx renders are spread one per macrotask after boot; the Title retries `unlock()` on
  pointerup (iOS activation is on touchend). The plan's "ctx.state === 'suspended' before the tap" check cannot hold in
  headless Chromium (contexts start running), so e2e asserts the director's stronger guarantee: not unlocked, Transport
  stopped, no notes, SFX dropped as 'locked'.

## Run decisions (M4)

- **`src/sim/validate.ts`**: `Sim.load` validates the state's shape, ids and bounds before ticking, so a damaged save
  with a matching data hash is discarded with the toast instead of crashing after Continue (fuzzed: 23,000 cases, 0
  crashes; ~1.4 ms on a 112 KB save). The conveyor audit bound counts sold-vehicle inbound parcels separately (a large
  sale past a full conveyor made the save unloadable).
- **A walked-out driver's vehicle waiting at the dock with nothing aboard parks inactive at once** (it never loads a new
  trip; §7.4 refinement).
- **City picking and depth**: a vehicle hidden behind a building drawn over it is not tappable (the tap goes to what
  the player sees); district name plates and lock boards are pickable; vehicles are lifted above multi-tile footprints
  they are strictly in front of (`src/render/vehicleDepth.ts`); the gesture classifier tracks pointers by id, so a HUD
  finger never pinches or flings the city; pan/follow requests are ignored during the City's exit transition.
- **Dialogs cancel when their scene sleeps** (onCancel runs) — a Dialog left open in the Warehouse no longer survives a
  view switch; the rotate card covers every scene; iOS page pinch-zoom is also blocked through WebKit `gesture*` events.
- **Sold-vehicle prompt** reads "Its parcels go back to the warehouse." (outbound cargo to the shelf, uninspected cargo
  through the lane — M2 rule).
- **Samples preload before the Title tap** (audio.md §3/§8: piano + bass first so music starts on the tap) — plan.md
  §12.7 task 3 says "load after the Title tap"; nothing sounds before the tap either way (asserted by e2e/audio.spec and
  dist.spec). Author to choose; the switch is one call in `PreloadScene`.
- **Pause menu**: tapping ❚❚ while paused opens the Paused card as the pause menu ("End run — show summary"); the first
  pause shows a one-time hint toast. The summary card is offered once at 20:00 sim time by a ticker line + toast (Q55).
- **Dist budget** excludes `*.map` (14.6 MB of sourcemaps stay in dist/ for debugging; not transferred unless devtools
  open) and the dev-only gallery (`public/gallery/` is removed before the hand-off build). Transfer: 4.88 MB raw /
  ~3.2 MB gzip (budget 6 MB).
- **Long robustness sweeps** (`tests/sim/*.long.test.ts`) run in the full `vlr check` only, like the policy gate test.
- **`vlr check` e2e step** runs the smoke and the dist specs (`__pm` absent without `?debug=1`, present with it).

## Defaults taken (plan.md §14)

Every §14 question (Q1–Q79) is listed with the shipped default and where it is coded in `docs/report-playtest1.md`
§7/§9; the run's own decisions (Q-RUN1…Q-RUN3, policy extensions, retunes) are the sections above.

## Runtime dependencies

- `phaser@4.2.1` — the engine (MIT). ~1.2 MB min / ~0.3 MB gz in its own chunk.
- `eventemitter3@5.0.4` — typed sim event bus imported by `src/sim` directly instead of through Phaser (MIT, ~3 KB).

## Runtime dependencies (audio)

- **`tone@15.1.22`** (MIT, Yotam Mann). It is the audio clock.
  - The Transport gives tempo, a 4/4 loop over 68 bars, and one scheduleRepeat callback per bar, about 0.15 s ahead on the audio clock.
  - Its tick timeline (getTicksAtTime) places stingers on the band's swung grid.
  - Tone creates no sound-producing nodes here. Its Transport keeps one internal ConstantSourceNode (the bpm signal), never connected to the output.
  - Import rule: only src/audio/tone.ts imports Tone, through `tone/build/esm/core/Global.js` and `core/clock/Transport.js`. Tone's index module calls getContext() at import time, which would create a second AudioContext (phaser4-notes §6).
  - Size, measured in a rolldown production build: 173 KB min / 45 KB gz in its own chunk (Transport plus standardized-audio-context). The audio.md estimate was ~100–150 KB gz.
- **`smplr@1.1.0`** (MIT, danigb). It plays sampled General MIDI instruments from a SmplrPreset (the vendored FluidR3_GM notes).
  - One shared SampleLoader means each mp3 is fetched and decoded once.
  - `notesToLoad` with the 'nearest' fallback pitch-shifts between samples spaced 3 semitones apart.
  - renderOffline gives the WAV render metrics of audio.md §9.5.
  - smplr's interval-polling scheduler is replaced by an immediate one (src/audio/instruments.ts).
  - Size: 25.7 KB min / 9.8 KB gz.
  - Samples: 47 mp3 files, 1,025,371 B, under CC-BY 3.0 (public/audio/sf/LICENSE.txt, CREDITS.md). tests/audio/assets.test.ts enforces the 3 MB budget, so `vlr check` fails above it.
- **ZzFX 1.4.0** (MIT, Frank Force) is not a dependency (Q72). Only buildSamples() is vendored, in src/audio/zzfx-samples.ts, with the MIT header, a seeded random source and the sample rate as parameters. Its output is bit-identical to the npm tarball. The upstream module creates an AudioContext at import.

## Defaults taken — audio (plan.md §14)

- **Q46 — pauseOnBlur false + AudioDirector.**
  - The director owns visibility. Phaser 'hidden' and window 'pagehide' pause the band, stop every voice (stingers included) and suspend the context.
  - On return nothing plays until a tap: the Paused card calls resumeAfterPause(). A capture-phase tap watcher (pointerdown, pointerup, touchend, keydown) also resumes on the next tap, and retries when iOS leaves the context 'interrupted', even while the page stays visible.
  - Nothing sounds before the Title tap, whatever the autoplay policy allows. The unlock resumes the context and Tone inside the gesture.
  - Desktop blur/focus is ignored. Boot must set `game.sound.pauseOnBlur = false`.
  - Audio never throws into the game: setup, data or handler failures leave a working game, and the reason goes to state().errors.
  - Code: src/audio/director.ts.
- **Q47 — music keeps playing at 0× and under the lost-life card.** Only a tab hide pauses the Transport. life:lost does a one-beat tape-stop and resumes. The hiss, stall-alarm and grumble loops wait while `lookups.isPaused()` is true.
- **Q48 — drumless v1.** semver-swing.json has `parts.brushes: false`. The synthesized ride and hat (zzfx noise buffers, high-passed at 7 / 8 kHz, about 15 dB under the band) sit behind that flag or `audio.json brushes.override: true`. The ride/hat arrays in audio.md §5 rendered silence (frequency 0) and were fixed.
- **Q49 — samples vendored at step 3.** That is 1.03 MB (1,025,371 B, 47 files), well under the 3 MB budget. `vlr audio:vendor -- --step 1` vendors every semitone; `node tools/audio/vendor.mjs --check` and tests/audio/assets.test.ts verify the budget offline.
- **Q50 — 18 SFX.** sfx.json has 20 keys: the 18 plus ride and hat. Throttles live in audio.json:
  - pickup 150 ms, hiss 4 s, honks 3 s overall, stall alarm 8 s, grumble 20 s;
  - the loops respect them on every play, including the first, with a 250 ms timer slack (`throttleSlackMs`).
- **Q51 — live music, unheard; music: 'live'.**
  - One render-metric iteration was used (gain staging).
    - Before: −43…−46 dBFS per bar at the starting volumes.
    - Changes: +22 dB sampler make-up trim; a master safety limiter; instrument volumes piano 74 / bass 87 / vibes 116 / trumpet 80; pad velocity 60; zzfx volume 0.5.
    - After: bars 0–63 at −22.4…−25.3 dBFS, peak 0.44, tail −120 dBFS.
    - Phone-weighted balance relative to the trumpet melody: bass −3, piano −5, pads −12 dB.
  - Composition changes:
    - the final chord became F6/9 with a final F5 melody note;
    - the arranger voice-leads the whole comping sequence, scoring each candidate after its clash fix;
    - the piano never rubs (semitone or b9) against, nor doubles, the tune, and the root is never its lowest voice;
    - the vibes pads never double the piano;
    - walking-bass passing tones resolve by step;
    - the only cross-part unison is the written trumpet + vibes unison of chorus 2.
  - Verdict: "unheard on this VM — author to judge".
- **Q52 — Credits.** CREDITS.md audio section (text supplied) plus the Title-screen Credits card, which the integration adds.

## Run decisions (build 2)

Build 2 (plan-build2.md, spec-build2.md cited `B2 §N`) runs M5 → M10 in one autonomous run from 84334f7. Each line is a
plan-build2.md §11 question with what is coded and where; the author overrules any line by number.

**Answered by the author before the run (2026-10-30), coded as stated:**

- **Q-B2-1 — logo as-is.** `art/logo.png` is Lanczos-downscaled to 352×176 by `tools/art/logo.ts` (`vlr art:logo`, a step
  of `art:build`) and drawn 1:1 logical on the Title; manifest class `logo`, outside both atlases and exempt from lint
  A01/A07 (B2 §5).
- **Q-B2-2 — driver picker on every vehicle purchase**; `Hire later` parks the vehicle `No driver` (B2 §2.5).
- **Q-B2-3 — the Hold Bay sorter is Toss-only**: the wanted list and its judgement decide what to toss; the rest is tagged
  `looks clean` for the player's Clear; it never Clears, so it can never cost a life (B2 §2.6).
- **Q-B2-8 — one long autonomous run M5 → M10** with the review at the end.
- **Q-B2-15 — PixelLab budget 1,500 generations with a 300 reserve**, set by the author's run prompt (the plan's
  alternative to the 2,000 / 400 default). L5 region ids start at 2 candidates; the bulk order stays fixes →
  machines/people → Docks → L4 regions → L5 regions → tiers (plan-build2 §8.8 R18). `tools/art/gen.ts` counts only
  batches from 2026-10-30 on; `PIXELLAB_RUN_BUDGET` / `PIXELLAB_RESERVE` change the limits without a code edit. Balance
  at the start: 3,299 of the 5,000 monthly generations.

**Defaults taken (plan-build2 §11), implemented as stated:**

- **Q-B2-4** — desk 2 unlocks at L3 for $400 (`employees.json desks.rows`).
- **Q-B2-5** — charisma reaches colleagues at the same desk only (`src/sim/systems/people.ts`).
- **Q-B2-6** — `Post an ad` ($30, `employees.json applicants.adPrice`) rerolls one pool now; pools also refresh free every day.
- **Q-B2-7** — a failed or expired quest has no penalty (`src/sim/systems/quests.ts`).
- **Q-B2-9** — at M10 the run dispatches the Pages workflow once (`gh workflow run pages.yml`) with the ruy-bot token and
  checks `https://ruyadorno.com/pm-tycoon/` with one GET.
- **Q-B2-10** — dist transfer budget 6 → 8 MB (`tools/check-dist.mjs`).
- **Q-B2-11** — the attract city is a fixed demo snapshot (seed 7, competent policy, 24 min; `src/assets/attract.json`
  from `vlr fixtures:attract`), never the player's own save.
- **Q-B2-12** — quest cash counts toward lifetime earned (spec §7.3); R15 guards the level windows.
- **Q-B2-13** — the magic parcel's destination is within 20 road tiles of the lot (`quests.json magic_parcel.goal.maxRoadTiles`).
- **Q-B2-14** — the `vehicle-bike` canvas grows 24×24 → 32×32 (`tools/art/manifest.ts`); no gameplay effect.

**Run-start findings (2026-10-30):**

- The VM's vlt moved 1.6.0 → 1.6.1; `tools/check-toolchain.mjs` accepts any 1.6.x patch (same CLI and lockfile format).
- The AGENTS.md scope guard was rewritten for build 2 in the first M5 commit (plan-build2 §10).

## Run decisions and deviations (M5)

- **Atlas placement follows who binds the frame** (deviation from B2 §6.8's list): `world` holds the city, the
  nine-slices and everything the HUD, `src/ui/**`, the Garage and the room's front layers (parcels, machines, workers,
  badges, fx, readout) draw; `interior` holds the room's back layers (floor, walls, belts, fixtures, dock tail);
  `icon16`, `parcel`, `fx`, `machine`, `worker`, `fixture-desk` and the font are packed into both. Phaser draws one
  texture per batch on the iPhone profile, so an interior-only machine or face would cost the HUD a texture switch.
  The room binds per layer (`roomAtlas()` for back layers, `atlasOf()` for front layers; the north-wall sign uses
  `ROOM_FONT_KEY`). Measured: world 2048² at 57.9 %, interior 2048×512 at 24.2 %; draw calls city 3, warehouse 6.
- **Hashed assets**: the atlases, the m5x7 XML, the logo and the attract snapshot live in `src/assets/` behind the `?url`
  imports of `src/render/assetUrls.ts` (`assetsInlineLimit: 0`); `tools/check-dist.mjs` requires every one hashed and
  fetched once, budget 8 MB (Q-B2-10). Dist: 5.24 MB raw, ~3.45 MB gzip.
- **Hop sink is a crop, not a scale** (B2 §6.3; no setScale on world art): the pickup icon is cut to a centred square
  stepping 16 → 0 px over the last 40 % of the flight, ending on the vehicle body centre (`VehicleView.bodyCentre()`,
  y − 4); the delivery hop starts there at full size.
- **Slab** (B2 §6.1): `slabStamps()` in `src/render/cityFx.ts` stamps `lot_slab_a/b/c` on the 16 footprint tiles,
  `lot_ramp` on the dock tiles (a dropped kerb) and `bollard_a/b` on the three tiles off the slab's S, W and E corners
  (baked into the ground, so only on tiles in front of the building and off every vehicle path). The exterior is
  generated without an apron or shadow strip; lint A04 is strict for `warehouse-ext`. Bay-light and dock-pose anchors
  are measured per exterior frame in the manifest (`WH_ANCHORS`).
- **Art picks**: the agent's picks go through `tools/art/decide.ts --manifest` (`chosenCandidate`, `approved: false`);
  `vlr art:approve` stays the author's. `dk_pier` and `dk_customs` were rejected with the author's reasons and moved to
  `manifest.retired[]`. The worker scan frames are a scripted edit of the PixelLab idle frames (forearm raised with a
  scanner, 0 generations: PixelLab's animations came out at another scale). `fx_dust` is one 256×224 cloud per frame.
  PixelLab spend M5: 126 generations (3,299 → 3,173).
- **Save v2**: `STATE_VERSION = 2` (state, snapshot, save); with `?config=<name>` the save and playtest keys take a
  `:cfg:<name>` suffix (report §6.13); a `pm.save.v1` reads as stale only when the session has no v2 save of its own;
  Reset enumerates and clears every `pm.save.*` key.
- **Attract title**: the HUD does not run on the Title (it launches at the swap); `__pm.ready` flips on `pm:attractEnd`;
  the policy chunk loads in `main.ts` with the audio chunk (a failed fetch falls back to the plain backdrop); the audio
  director never attaches to the attract sim, so the demo city is silent until the first tap; the demo is recycled
  after 30 min of attract time, a lost life or game over; the fps sampler skips attract frames. Phaser 4.2.1's
  `KeyboardPlugin#shutdown` calls `game.events.off(BLUR, resetKeys)` without a context and strips every scene's blur
  listener; `BootScene` patches it to pass `this` (the Title now stops while the City keeps running).
- **Report §6 fixes**: the ticker drops queued `day` lines when a newer one queues and any line older than 90 s of
  unpaused display time; the 8-line cap evicts by rank (filler < daily < other < offer/incident/level). Enter on Game Over
  opens the run summary (nothing without one). The district sheet grows but never shrinks while open; the Garage list
  is sized to its rows, capped at the old height. The Paused card is on the modal stack: W, G and Esc-to-City wait,
  Space/1/2/4 still resume. The Title's Credits card is modal.

## Run decisions and deviations (M6 — people)

The M6 contract (design defaults D1–D20, reconciled across M6–M9 by a critic pass) is summarised here; each line names
the spec section it settles.

- **D1 — applicant RNG stream** (B2 §2.7 "rolled from the sim RNG"): pools draw from their own seeded mulberry32 word
  (`state.applicants.rng`, saved with the state), so opening sheets, ads and picks never shift a spawn or a checker roll;
  same determinism, and the gate's main stream keeps its draw count.
- **D2 — Replace swaps after the trip** (B2 §2.5): `Vehicle.nextDriverId`; immediate on the lot; the old driver keeps
  driving (and is paid) until the trip is over ON THE LOT — the unload, or, for a trip that ends in the city with nothing
  aboard, the arrival at the lot entrance (it drives home first; M6 review); a pending driver who walks out cancels the
  Replace at once (they leave, `worker:fired {replaced}`; the current driver stays); a driver whose Replace waits cannot
  be re-hired (the swap lets them go; the Garage offers no Re-hire then); a vehicle with a pending Replace or no driver
  counts as driverless.
- **D3 — the player's tap** (B2 §2.6): the sim cannot see UI taps, so the HoldBayCard dispatches `touchHeld {parcelId}`
  when it opens and, while it stays open with a sorter or the Sorter Arm at the station, renews it every half grace of
  SIM time (logged, replay-exact; `sorter.ts touchRenewDue`) — one touch on open let a pace-5 sorter or the Arm toss the
  parcel under the player's finger (M6 review). A touch inside the grace only extends it (the sorter keeps calling the
  other parcels); player Toss / Clear / a fresh touch restart the sorter's clock.
- **D4 — sorter cadence**: its clock starts when an unjudged parcel waits; it decides on the oldest one `decisionS`
  later, so nothing vanishes on arrival. Trace text `Tossed by <name>` / `Tossed by the Sorter Arm`.
- **D5/D6 — stars** (B2 §2.7): a ★ applicant takes the front of its pool of three (the last regular leaves; refresh
  keeps stars; with an all-star pool the oldest star leaves); it leaves with "<name> took another job" at the first day
  boundary at least `starExpiryDays` after it arrived (2–3 days, never less — `leavesOnDay = day + 2` gave a ★ arriving
  on a day's last tick one day; M6 review); the card reads `leaves in 2d`, `1d`, `today`. The same ★ again — matched by
  `Applicant.starKey`, its def name, so a ★ renamed `Audrey 2` still matches — only refreshes its expiry.
- **D7 — atlas for people art** (B2 §6.8 lists faces under interior): faces, `ic_star`, `worker_sorter_*` and the new
  machines pack into both atlases, `ic_pip_on/off` into world (the HireSheet, the Garage and the follow strip bind world
  only), `hold_station` into interior; `sorter_arm_f0–f2` into both.
- **D8 — delegating policy at L1**: tosses by hand until an active sorter is seated (no station before L2), then never;
  Clears every `looks clean` parcel; a walkout returns it to hand tossing.
- **D9 — driver hire fee on purchase** (B2 §7.1 "any role"): one day's salary; the policy's vehicle triggers stay
  `price + purchaseBuffer` (B2 §7.2), the fee comes out of the $50 buffer; the opening bike needs price + its fee.
- **D10/D11** — a walked-out worker can be fired (frees the seat at once); hiring into an occupied station replaces the
  sorter; `station-occupied` only refuses a sorter while the Sorter Arm stands there (B2 §2.6 "never both").
- **D12** — the readout, shield and ShieldPopover show a desk's mean effective `p`; SlotCard rows show each inspector's
  (B2 §2.3); "avg" shows with two or more seated.
- **D14 — the 5-eye line** on the lost-life card: computed on the parcel's faced rolls, only for a desk miss by an
  inspector with eye < 5; the machine line wins ties; none for a parcel the player Cleared.
- **D15 — the Hold Bay station, poster and props move now** (B2 §4.4): `HOLD_STATION {264,300,48,48}`, the poster at
  (272,120), `PROPS_T1` to (264,164)/(264,236), `PROPS_T2` to (264,196); the sorter walks in along row y 352 (above the
  rack it would pass behind the dock panel).
- **D16** — Garage rows put Replace / Fire / Sell behind a 44-px `···` menu (three 64-px buttons do not fit at 360).
  Every row's slot is the `···` (M6 integration): a Hire-later or fired-driver row lists `Hire driver` / `Sell`, a
  walked-out driver's row `Re-hire $N` / `Fire driver` / `Sell`, so a driverless vehicle can still be sold — two taps
  instead of the playtest-1 one-tap Re-hire. The trade-off is keeping Sell reachable on a driverless row, not width (a
  labelled `Re-hire $13` would fit the old 72-px slot on its own). The `···` sits at the row's right edge and the zone
  chip 4 px left of it (M6 review: the chip was placed from the old 72-px slot, so at 360 the driver line's tail had
  31 px — `$6/day` read `$6`; now 59 px fits `$13/day`, `! unpaid` and `→ Audrey`).
- **D17/D18** — all six B2 §9 pacing keys landed in `economy.json` at M6; `STATE_VERSION` 3 (key stays `pm.save.v2`).
- **D19 — the wanted list**: any malware Toss (player, sorter, Arm) and every lost life append to `state.wanted`; the
  UI-side `onboarding.wanted` is gone.
- **D20** — the policy's "highest speed" is the effective pip for the bought type (affinity counted); ties → lowest
  salary → lowest applicant id.
- **The Sorter Arm rule is built in M6** (plan-build2 §8.3 task 5): `buyMachine sorter_arm` into the `hold` station at
  L4 ($600), every due parcel auto-Tossed `autoTossDelayS` after `max(nodeEnterTick, touchedTick)`; removal refunds 50 %.
  Its idle/reach/toss frames are scripted from one generated image (no extra generations).
- **The station's dashed outline is an atlas frame** (`station_outline`, interior-prop 48×48 packed into world like
  `slot_empty_outline` / `ext_outline`): a Graphics in the room's badges layer broke its image batch (Warehouse + HUD 8
  draw calls > 7); with the frame it is 6.
- **Removing a desk** re-seats its parcels first, then fires every inspector there (walked-out ones too), reason
  `deskRemoved`; the card's line and confirm name the walked-out ones too (`Remove desk — 2 inspectors let go, no
  refund`, `Lin (walked out) is let go, no refund.`).
- **M6 review fixes** (no balance value changed):
  - A driver fired mid-trip leaves their speed / stop multipliers on the vehicle (`Vehicle.tripMults`) until it parks
    `inactive`, as a walkout already did — firing a slow driver no longer made the rest of the trip faster and unpaid.
  - `employees.roles.sorter.tagsClean` is honoured: `false` = the sorter still judges each parcel once
    (`Parcel.sorted`), but no `looks clean` tag (HoldBayItem), trace line or lost-life `sorterCall` shows.
  - B2 §2.6's station tooltip `Pat · judgement 85 % · one call / 6 s · $28/day` is the StationCard's on-duty rows (the
    name row + the stats line): a station tap opens the card, so the unused `stationTooltip` helper was removed.
  - Onboarding step 1 (`Buy a bike in the Garage and pick its driver`) clears on the first driver hire, not on the
    purchase; after `Hire later` it reads `Bike 1 has no driver yet: hire one in the Garage` (step 2 waits for it).
  - The Garage opening drops an open Warehouse HireSheet (`pm:garageOpening`), so two applicant pickers never stack.
  - A HireSheet without a caller note shows the pool-refresh countdown `New faces in 0:23` in its title band (the
    day's re-roll under an open sheet is expected); the buy flow keeps its `Bike $200 + fee` note.
  - Worker name tags sit above the head, so a card covering a person's feet (the SlotCard at 360 × 604) still shows
    the name of someone in view.
- **Gate drift accepted (plan-build2 §8.3 task 11, ±5 %)**: with the people layer on, `level2Min` moved 13.05 → 12.28
  (−5.9 %) and `truckAfterLevel2MaxMin` 2.10 → 1.93 (−8.1 %); every other playtest-1 row stays within ±5 % and every
  window passes. Cause, isolated with `--config` runs: the policy hires the fastest of three drivers (speed pips ×1.08 /
  ×1.15), so trips are shorter; with neutral driver multipliers the rows match the baseline exactly. The R16 lever
  (`pipWeights` band 1) moved L2 further (−8.8 %) and broke the lives median, so it was not applied; no balance value
  changed. The delegating policy's lives median is 1 (≤ 1 per B2 §7.3).
- **UI notes**: m5x7 has no ★ ● ○ ⋯ glyphs, so stars, pips and the row menu are images/rectangles; the HireSheet draws its
  own refusal bubble (the HUD's tooltip layer sits under the Garage); a closed or slept HireSheet runs no callback
  (`cancel()` runs `onCancel`); ViewSim lists are cached per `sim.revision`, so HUD event handlers read sim state directly;
  `?level=N` forces a level only on a fresh game (debug), `?policy=delegating` attaches the delegating policy.
- **Art (M6)**: 207 PixelLab generations (machines `battery_checker`, `xray`, `sorter_arm`; the ten Low-density uniques,
  fogged until M9); the four old Low-density scenery rows retired with `decide.ts --retire`; `lr_exact_pin`'s finial is
  orange (red is reserved for danger, STYLE.md).

## Run decisions and deviations (M7 — quests)

Design defaults Q1–Q22 of the M7 contract (B2 §3 gaps), as coded:

- **Q1** `clean_sweep`: a wrong Toss resets the streak (B2 §3.2 table); the quest fails only on its deadline (fail-on-break
  would fail nearly always under Toss-everything). **Q2** `night_shift`: a `holdBayFull` stall resets the count to 0.
- **Q3** "from day 3" = `state.day` 3 → the first offer at 3:00 sim time (HUD "Day 4"), clear of the 2:00 scripted
  malware and the onboarding.
- **Q4** `rush_district` / `cheer_up` flavour lines carry a `{district}` placeholder (the targets vary).
- **Q5** the magic parcel's A = the live building with the highest static `send` (ties by the quest RNG); **Q6** A and B
  exclude truck-only (`hardRule`) districts so a bike can make 120 s; B within 20 road tiles of the lot (Q-B2-13).
- **Q7** the magic parcel rides first in its vehicle's outbound set and is its first stop (a VIP rule in
  `dispatch.ts`; B2 §3.3 has no outbound rule and the newest shelf parcel would miss 120 s).
- **Q8** an expired offer behaves like a Decline (`declineCooldownDays`); **Q9** new event `life:gained`.
- **Q10** all quest frames are in `world` (`ic_quest`, `ic_magic`, `magic_ring_*` packed into both; `ui_card_gold`,
  `ui_bar_fill_gold` world) — the HUD binds world only (M5 rule over B2 §6.8's wording). A ★ glyph was added to m5x7.
- **Q11** the chip shows `✕` (m5x7 has no `✗`); the Golden Release chip reads `41/60` with `0✕ 94%`, time left on the
  card. **Q12** the ultimate quest's name lives in `puns.ultimateQuestName`.
- **Q13** the Golden Release counts local deliveries and non-malware overseas clearances; a malware clearance counts as
  malware delivered and fails it. **Q14** `onTimeRateDay` counts only full days after accept, malware excluded.
- **Q15** at L5 an open regular offer is withdrawn for the ultimate; an active regular quest finishes first.
- **Q16** `malwareShare` escalates from `stats.victoryTick` (endless, B2 §3.4); the at-cap rule applies only while the
  level cap is below the last level.
- **Q17** `STATE_VERSION` 4. **Q18** the voucher reward is built (sim + BuySheet `FREE` row) though no template ships one.
- **Q19** the QuestCard sits on the modal stack without holding the sim; it never auto-opens while a policy drives the
  stepper. **Q20** `cheer_up` targets the live district with the highest satisfaction below 50 (closest to 60).
- **Q21/R-rng** offers and magic routes draw on their own quest stream (`state.quests.rng`, `QUEST_RNG_SALT`): with no
  quest accepted a run reproduces M6 exactly. **Q22** the magic parcel lives in the active quest's progress (one copy).
- The victory stinger is the I–vi–ii–V tag over a 5–1–3–5 → 8 trumpet fanfare; the band ramps down for it and resumes.
- Policy (B2 §7.2): `questPolicyStep` accepts every offer on the step it appears (the Golden Release once nothing is
  active) and rushes the magic parcel's origin; never declines, abandons or rushes B. Gate rows `questsOfferedBy30Min`
  and `questsCompletedBy30Min` are gated behind `SIM_FEATURES.quests` (informational on runs shorter than 30 min).

Balance retunes taken at the M7 integration (B2 §7.3: one line per change, naming its gate row; seeds 1–10 × 30 min):

- **Retune — `malware.postVictoryPerDay` 0.01 → 0.005** (gate row `maxLivesLost`). Quest cash brings L2 about half a
  minute earlier (median 12.28 → 11.72 min), so the at-cap escalation runs longer (≈ 6 % more malware). Seeds losing a
  life: M6 2/10; M7 at 0.01 6/10 (median 0.5, FAIL); M7 at 0.005 4/10 (median 0, PASS). 320-seed sweep: 111 → 86 seeds
  losing ≥ 1 life. **Lever-order deviation**: B2 §7.3 puts "quests too rich (levels early) → `reward.cash` arrays"
  ahead of values; `rush_district.reward.cash` was not tried. The key also sets the endless escalation after Victory
  (B2 §3.4), which the M8/M9 design pins at +0.01/day — **open for M9**: split an at-cap rate off
  `postVictoryPerDay`, or restore 0.01 after a `reward.cash` retune.
- **Retune — `on_time_day` rate 0.95 → 0.85, `minDeliveries` 8 → 6** (gate row `questsCompletedBy30MinMin`; B2 §3.2
  "completable by the competent policy on a median seed"). At the spec numbers a qualifying day happened on 0.5–13 % of
  days: 1 of 11 offers completed on seeds 1–10. Now 4 of 11.
- **Retune — `big_haul` count 5 → 3** (same rows). About 2.3 XL parcels are delivered per 4-day window: 0 of 8 offers
  completed at the spec's 5. Now 2 of 8 (3 of 8 before the review fixes below moved seed 4).
- Gate after these retunes and the review fixes: every median passes — first delivery 43.3 s, scripted catch 178.3 s,
  L2 11.72 min, truck +1.54 min, lives 0 (4/10 seeds lose one), shelf stall 0, Hold Bay 6.78/10 min at L1, quests
  offered 6 and completed 3.5. `vlr sim:delegating` PASS (informational): lives median 0.5, quests 6.5 / 4.
- **Open — `cheer_up` is unreachable** (B2 §3.2 bound). 0 of 8 offers completed on seeds 1–10 (delegating 0 of 8).
  Targets start at 36–48 satisfaction and gain at most +7 in 5 days (the +4/day positive cap less the drift toward 50;
  the policy never helps a district), against the +12–24 needed for 60. Each offer holds the only slot for 5 days plus
  the interval. Not retuned in M7 (the data is frozen after the integration): candidates are `goal.value` 55 or a
  longer `limitDays`, with a line naming `questsCompletedBy30MinMin`.

M7 review fixes (rules the M7 contract did not state, or stated against the spec):

- **The ultimate and the regular scheduler** (B2 §3.1, §3.4; the contract's "ultimate: unchanged" gap). While the
  Golden Release is pending (its level reached, no Victory) no regular template is offered, including during its
  cooldown after a fail. Any end of the ultimate sets `nextOfferTick ≥ tick + intervalDays`. Before this, a regular quest
  took the slot on the tick the ultimate failed and delayed its re-offer by 3–5 days, and endless play got a regular
  offer on the victory tick.
- **The golden parcel at its origin** (extends Q7). It is reserved and picked up first, after a vehicle's earlier
  reservations. A pickup that leaves it behind no longer clears the building's rush flag, so the next dispatcher pass
  sends another vehicle.
- **City markers follow the parcel** (B2 §3.3 "while it is alive", over design §6.8's "countdown running"). A late,
  failed or abandoned Special delivery keeps the gold `ic_magic` on A and B with an empty ring until the parcel is
  delivered (`QuestsView.magic`).
- **Game over keeps the golden parcel's delivery.** The quest counters still stop at game over, but the observer
  records the magic delivery. Before this, the active quest named a parcel that gc had removed, so the audit failed and
  the save loader refused the snapshot. A continued run (`continueWithOneLife`) judges the delivery.
- **★ reward names** (`starApplicantName`). `quest:completed`, the stamp, the paper and both ticker lines carry the name
  the pool gives the applicant, which is "Vera 2" when an employee is already called Vera.
- **The Golden Release waiting behind an active quest** (design §4). The chip pulses, and the active card's flavour row
  reads `The Golden Release is waiting — finish or abandon this job to take it.` in gold, with Abandon one tap away.
  Auto-open still waits until the slot frees.
- **Resize with a confirm open.** `Dialog.relayout` re-raises its camera. The HUD re-fits the New-game confirm after the
  Victory and Summary cards rebuild their cameras, and the QuestCard re-fits its Abandon confirm.
