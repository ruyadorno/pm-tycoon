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
- **`malware.postVictoryPerDay` stays 0.01** (a 0.005 retune was tried and reverted by the sim review: at the final
  config it moved no gate row).
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
