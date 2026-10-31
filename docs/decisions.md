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
- Top bar + ticker opaque (city-view says 0.85: world labels read through it; 0.94 still did — final review); Warehouse/Garage buttons up to 92 px
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

## Run decisions and deviations (M8 — L3 Regional)

- **R1 — the level cap is 3 at M8, 5 at M9** (plan-build2 §8.5 task 1 says 5 at M8): slots 5–6 have no room geometry and
  L4/L5 regions no live art until M9, and the Golden Release would fire mid-M8. `economy.json playtestMaxLevel` 3 now;
  "Lv 4 coming soon" is the existing cap UI. Tests of the cap mechanism run under a `playtestMaxLevel: 2` override.
- **Retune — L3 threshold $5,000 → $3,700** (`levels.json`, gate row `level3Min`, B2 §7.3 order "a late level → lower its
  threshold"): with the L3 plan alone the median was 22.38 min (window 15–20). Thresholds 3,500–3,900 were scanned with
  full gates: 3,500 broke the lives median, 3,600 left 4/10 seeds losing a life, 3,700 gave L3 17.98 min with 2/10 seeds
  losing one, 3,900 broke lives again. First overseas clearance after L3: 2.37 → 2.18 min. spec-core's "$5,000" heading
  is superseded by the data.
- **Overseas clearance** (B2 §4.1, spec-core §5.6) in `systems/hubs.ts`: the hand-off at the pier locks the value; the 45-s
  clearance pays it; malware clears for $0 and costs a life only at clearance (route lines "Handed off at …" / "Cleared
  … — the ship has sailed"); one `hub:departure` per hub per tick with clearances (the renderer ignores departures while
  the vessel is away, so a "batch" is one 18-s trip — R3); `handed_off` covers the whole wait (R4); clearances never
  count as local deliveries or touch satisfaction (R5; the Golden Release counts non-malware clearances, M7 Q13); the
  daily ticker line adds "N cleared overseas". `STATE_VERSION` 5 (`lane.feedIndex`, `stats.cleared`).
- **Docks 2–3** (B2 §4.1, §4.4): dock/conveyor pairs kept in dock-number order (dock 3 may be bought before dock 2 — R8);
  the conveyors feed slot 1 round-robin through `lane.feedIndex` (one dock behaves exactly as before), except that the
  lowest-numbered dock in Q-RUN1 relief takes every feed while its conveyor holds a parcel (M8 review: with 1/n of the
  feed a relieving truck stayed docked 2–3 min on 4 of 1,000 two-dock soak seeds; now 0 of 1,000 for one, two and three
  docks); a blocked vehicle yields its dock only while more vehicles are queued than docks are free. In the room each extra dock is a 24×56 roller
  pad by its door (R7); the dock panel stacks three lamps in a column; a lamp blinks red only for its own blocked
  vehicle or a busy dock with a queue. In the city the docked pose follows position along the dock run (not `dockId`,
  which jumped), bay poses come from the manifest's per-bay `dockPoses`.
- **Policy L3 plan** (B2 §7.2, `src/sim/policies/levelPlan.ts`): Battery checker → dock 2 → van → 2nd truck at price + $50,
  starting once the playtest-1 purchases are owned; impossible steps re-checked each step; a vehicle step with an empty
  driver pool waits; COUNTERS waits for the plan. **REPLACE** (R9, policy extension): with every slot full, the last
  duplicate machine in flow order is sold for the Battery checker (never a desk). Desk 2 only when the dock-blocked rule
  fires with desk 1 full, with the hire in the same step, and never while a plan machine step is pending (M8 review:
  desk 2 in the REPLACE slot left the Battery checker impossible for the run; like COUNTERS it waits for the plan). Rows `level3Min` and `firstOverseasClearedAfterLevel3MaxMin`
  are gated (informational in `--quick` and on runs shorter than the window); other-length gate runs write
  `latest-<N>min.*`.
- **Fixtures**: the attract scan holds first at minute 30 on seed 7 (L3, bike ×3, van, two trucks, Docks live) — R15's
  24 → 30 scan; `vlr fixtures` runs every generator; `level-up-3.json`, `l3-docks.json`, `overseas-malware.json` are new.
- **Art (M8)**: tier 3 is a green epoxy floor with brick walls; 220 generations for the L5 regions at 2 candidates (Airport
  terminal + cargo hangar re-rolled, tower, plane; ten Park & civic uniques with `cv_changelog_stadium` re-rolled without
  townhouses); five old shared rows retired; world atlas 80.1 % (over M5's 75 % target, under the R13 trigger of 90 % —
  no shared locked silhouettes, no `city2`).

## Run decisions and deviations (M9 — L4 + L5 Tycoon)

- **The level cap reaches 5** (`economy.json playtestMaxLevel`, B2 §9 end value): the at-cap escalation never fires on
  shipped data; only Victory starts the endless ramp (M7 Q16). The Airport hub row and props joined `map.json hubs`;
  the schema now requires a hub row for every overseas district live at or below the cap.
- **Balance pass (plan-build2 §8.6 task 5, B2 §7.3 order), seeds 1–10 medians:**
  - L4 threshold $9,000 → $5,200 and L5 $16,000 → $7,400 (`levels.json`; rows `level4Min`, `level5Min` — "a late level →
    lower its threshold"): before, L4 31.84 min with 3/10 seeds reaching it by 30 min and no L5 by 35 min; after, L4
    22.35, L5 26.91 on the balance lane's tree — the final gate (with X-ray first below) reads L4 22.35, L5 27.70. A scan of L4 5,000–5,800 × L5 7,400–8,600 rejected 5,800/8,600 (L5 30.2) and 5,400/7,400 (35-min
    lives 0.5); over 100 seeds L4 22.13, L5 27.31. spec-core §7.6's $9,000 / $16,000 are superseded by the data.
  - `customs_run` count 6 → 3, limitDays 4 → 5 (row `questsCompletedBy30MinMin`; B2 §3.2 bound at ~0.9 clearances/min):
    0/5 completed at M8 → 3/3.
  - `cheer_up` goal 60 → 52 (same row; targets start at 36–48 and the policy never steers a district; 55 gave 0/8, 52 gives
    2/8; the schema keeps the goal above the 50 target threshold). Closes M7's open item.
  - Dock 3 $2,000 → $1,000 (`economy.json docks`; informational rows `dock3Min`, `victoryMaxMin`, "dock late → price";
    spec-core §7.6 places dock 3 before L5): bought at 33.4 → 31.5 min over 40 seeds; victories by 48 min 7 → 18 of 40.
    Supersedes spec-core Q-SP9's $2,000.
  - `postVictoryPerDay` 0.005 → 0.01 (back to B2 §3.4's +0.01/day): with the cap at 5 it only drives endless after Victory;
    no row moves.
- **Policy L4/L5 plan** (B2 §7.2): L4 X-ray → dock 3 → the Sorter Arm into the empty station → 2nd van → counters; L5
  accept the Golden Release → 3rd truck → counters. Once the Arm holds the Hold Bay the policy stops tossing by hand
  (`armHoldsBay`), so the Arm's 3-s auto-Toss does the work. **X-ray first** (policy extension, like COUNTERS): when L4
  arrives the X-ray is bought before any L3 step still pending — a competent player covers the newly announced `dense`
  strain first; over seeds 1–10 × 48 min lives lost 15 → 7, over 40 seeds × 30 min the share losing a life 43 % → 35 %.
  Only the X-ray moves (the L3 tail keeps its order behind it). **Its cost is on Victory**: the van and 2nd truck come
  ~4 min later, so the fleet is thinner when the Golden Release runs — seeds 1–10 × 48 min, wins by 45 min 2 → 0 (M9 sim
  review, rule toggled off vs on); L5 +0.7 min (26.91 → 27.70). Kept: lives is a gated row, victory informational.
- **Victory by 45 min on seeds 1–3 (plan-build2 §8.6 acceptance) is not met — waived pending the author's call.**
  `victoryMaxMin` is informational (B2 §7.3). Competent policy, current tree, seeds 1–40 × 48 min: 10/40 win, 0 by 45 min
  (seed 2 at 45.70, seeds 1 and 3 none). The Golden Release is accepted at L5 (~27 min) while the fleet is 5–7 vehicles;
  attempts fail its 90 % on-time rule (seed 3: 43 %, 43 %, 88.6 %, then a pass) — the economy, not a counting bug (the
  quest's counters match an independent event count). Plan orders measured (seeds 1–10, 40 for the first two): L4 X-ray →
  Sorter Arm → 2nd van, L5 3rd truck → dock 3 — 14/40 win, 4/40 by 45 min (seeds 2 at 43.93 and 3 at 42.40; seed 1
  never by 48 min); vans before dock 3 (X-ray → 2nd van → dock 3 → Arm) 2/10 by 45; X-ray → 2nd van → Arm, dock 3 after the
  3rd truck 0/10. No order reaches seed 1, so the plan keeps B2 §7.2's order; the levers are balance (the ultimateQuest
  on-time rate / window, or L5 fleet cost — §7.6 order) and were not touched in the M9 fix pass. The long test
  (`victory.long.test.ts`) now asserts at least one of seeds 1–3 wins by 48 min (seed 2 does), so its chain checks are
  never vacuous; the 45-min target stays printed.
- **The CLI's stuck rule** (`tools/sim/cli.ts stuckKey`, also `tests/sim/robust.ts` `stuck: 'progress'`): "no vehicle in
  one state > 120 s" (plan.md §6.9.2) flagged genuine L4–L5 delivering legs (12–19 stops, ~110 s on the road), so since M9
  it is "no progress for 120 s" — progress = a change of state, cargo count, stop index, wait timer or reservation count,
  never position (a vehicle looping on a bad route moves every tick but is still stuck). The longest stretch without a
  key change measured over 6 runs × 60 min, both policies, is 28–33 s; the chaos, policy and delegating sweeps pass.
- **Room growth** (B2 §4.4, design R2/R10/R21/R22): rows 14/14/14/16/**18** (six slots at the 64-px pitch need 18 rows;
  B2 says 16/16); slots 5–6 unroll below slot 4 and everything at y ≥ 352 moves down 64/128 px; the room scrolls (integer,
  clamped) only when it does not fit — tier 4 by 64 px at 360×604 and 9 px at 393×659, tier 5 by 128 / 73 px — with the
  readout fixed above it; a vertical move > 8 px before the 450-ms lift scrolls, a lifted fixture never scrolls; cards
  opened from the room scroll their target toward view (as far as the range goes: a BuySheet still covers slot 6 at
  max scroll, as it covers the lowest slots of a room that fits — no overscroll); a level-up inside the room rebuilds it on
  the next frame under the tier fade, the old room fading on the new room's origin so what they share lines up with the
  taps. The scroll moves the room container (no second camera); a mouse wheel scrolls 32 px per notch.
  - **The cover** over the bands outside the viewport is two world-atlas `ui_panel_dark` nine-slices FILL-tinted the
    camera's background colour, their rounded corners bled off screen (`coverRects`), so it batches with the readout and
    the HUD: tier 4–5 at 393×659 drew 9 calls with a Graphics cover (M9 review), 6 now in `dist.spec`'s tier-5
    scrolled check (budget 7).
  - **Slack**: a room block up to 4 px too tall fits, the readout moving up into its 4-px top margin (`ROOM_SLACK`) — at
    375×667 tier 4 overflows by 1 px, which scrolled 1 px and raised the cover for it.
  - **Gestures**: a press whose pointer-up a HUD band caught (the HUD scene is on top) is dropped on the next frame or the
    next pointer-down (another `downTime`), so a lifted ghost snaps back; tooltips anchor on a picked rect's top clamped
    into the viewport, popovers below the HUD's top band; the readout's tap flash draws in the readout's own container.
  - **No scroll affordance** (no bar, fade or hint): R22's cut order; a shelf stall is announced by the fixed readout.
    Open UX item for the author (M9 mobile review: the tier-5 shelf is off screen at scroll 0 on both phones).
  - The HUD toast lane follows the room's height on a level-up or a sim swap inside the warehouse (was only on a view
    switch or resize).
- **Map data**: the Airport `labelTile` moved [39,10] → [41,10] so the pan to the Airport frames the plane at its stand,
  the terminal, the tower and the hangar door; `map.ground.scenery[]` rows take an optional `region` (schema-checked
  against the districts) and fog with that district — the runway, its apron and thresholds (airport), the field rows
  (rural) and the fountain (civic).
- **Dock price tag**: a buyable dock's price sits on a `ui_badge` pill (dark text) under the door's "+" — the tier-4
  steel and tier-5 glass walls are too light for the white `Lv3` text style.
- **Attract fixture**: the scan window runs 24 → 34 min (design R15 said 24 → 30): with X-ray first seed 7's van comes at
  ≈ 29 min and its 2nd truck at ≈ 32 min, and the fixture still needs a van and two trucks.
- **`?level=N` strain lines**: a level forced at tick 0 announces its strains at tick 0, which the start strain's
  "no spotted line" rule silenced; now only the first levels.json row's strain is silent, so a debug `?level=5` session
  shows "New strain spotted" for rattle, battery and dense newStrainDelayS in (debug builds only; no gate row moves).
- **City**: the plane crosses the runway nose first and fades over the last 20 % of its climb; every clearance stamp
  (`CLEARED +$N`, `SHIP HAS SAILED`, `PLANE HAS LEFT`) rises from above the office's ring; the runway is Airport scenery
  that fogs with its region; `dk_ship` was re-rolled with its bow toward its exit (48 generations incl. an `xray`
  re-roll).
- **HUD/Title**: at the top level the bar drops "coming soon"; after Victory the tap toast reads `Tycoon ✓ — endless mode`;
  the Title's Continue line shows `Tycoon ✓` for a save with Victory (✓ is a new m5x7 glyph, like ★ in M7); the
  lost-life route for an Airport clearance ends "— the plane has left" (R11).
- **Tier art**: tier 4 charcoal floor and steel walls with racking and a forklift; tier 5 white terrazzo, glass walls and
  pink neon (`neon_strip` replaces the strip lights), lane lines pink.
- **Fixtures/shots**: `l3-docks.json` is taken at a real L4 (seed 7 has no Docks hand-off between dock 2 and L4); M9 shots
  skip the tour hints so region and room art are not covered; `golden-release-offer` abandons the policy's active quest
  first.

## Run decisions and deviations (M10 — playtest-2 build)

### Metrics: `playtest.json` v2 and the summary card (plan-build2 §8.7 tasks 1–2, §9)

- **The profile key is `pm.playtest.v2`** (`src/boot/autosave.ts PLAYTEST_KEY`; `pm.playtest.v2:cfg:<name>` in a config
  session). `PLAYTEST_VERSION` is 2 and the recorder's `sameRun` refuses any other version, so a stored v1 profile is
  never resumed. The old key is `LEGACY_PLAYTEST_KEY` (`pm.playtest.v1`): never read, cleared by Reset with its `:cfg:`
  copies (it is in `STORAGE_KEYS` and the per-config prefixes).
- **`hires[]` carries a `cheapest` flag** beyond B2's {role, pips, salary, star, atS}; fun bar 2 item 1 needs it. At
  `worker:hired` the hired applicant has left the pool and the pool is not refilled yet, so the flag compares it with
  the applicants left in that pool; drivers are compared within the same vehicle class; a lone applicant counts as the
  cheapest; re-hires are not recorded. The policy always picks the best pips, so every policy hire is "not the
  cheapest".
- **Quest counts**: `declined` includes offers left to expire; `failed` includes abandoned quests; a withdrawn offer
  counts only toward `offered`; `firstCompletedS` is an extra field (also read from the history). The sim keeps the last
  50 quests, so a very long endless run undercounts.
- **`livesLost[]` entries gain `sorter`** (the sorter whose "looks clean" call the parcel carried) **and `hub`** (null
  for a local delivery). "Explained" (fun bar item 5) = a counter machine, a sorter or a player Clear; overseas losses
  read "the ship has sailed" / "the plane has left". With the shipped data every strain has a counter, so the data part
  of item 5 cannot fail and the item reads "you judge" whenever a life was lost: the author's read of the lost-life
  card is the check (plan-build2 §9 names 5 as judged). Kept as the plan wrote it rather than "counter not owned"
  (final review): a loss with the counter owned is explained too ("got through on the N%"). The `no counter` branch
  stays for a config strain without one. Entries carry `parcelId` (final review), the replay-dedupe key: two
  same-label parcels lost on one tick are two entries.
- **`sorter.clearedMalware`** counts malware the sorter judged clean and left in the bay — the Toss-only sorter's
  (Q-B2-3) version of a Clear. **`overseas.handedOff`** = clearances done + parcels still waiting; `cleared` includes
  malware.
- **The fun bar 2 thresholds live in code** (`FUN_TARGETS` in `src/metrics/playtest.ts`: a quest by 900 s, L3 in
  15–22 min, 1,500 s played before opening the card, the stretch by 2,400 s), like v1's `FUN_KEEP_PLAYING_S`: playtest
  instrumentation, not balance numbers. `SUMMARY_OFFER_S` = 1,800 (the offer at 30:00).
- **Card rows merged to fit 360×604**: "First delivery · catch", "Level 2 · 3 · 4 · 5", "Taps/min · FPS p50 · p5";
  "Machines · docks · desks" replaces "Inspectors · machines"; 14 fixed rows + up to 4 lost-life rows, tightened down to
  one text line each when they would not fit. Fun bar items 1 and 5 read "? … you judge" when the data passes; 2, 3, 4
  and 6 are pass/fail from the data, or "not yet" while their window is open.
- **`tests/playtest/seed-7.json` comes from a fast-forwarded 35-minute run** (e2e `playtest-35min`: 6 real minutes at
  4×, 5:00–6:00 in the Warehouse, then 20-s `__pm.advance` chunks with real frames between them), so its `elapsedS`
  and fps samples cover only ~108 s of real time and its fun bar item 4 is a ✗ by design. Its level times match the
  headless CLI exactly. Every `vlr shots` run rewrites it.
- **Recorder blind spot (unchanged from v1)**: fields fed by sim events (hires, sorter, malware at clearance,
  deliveries by type, lives lost) miss what happened before the recorder attached — a `?fastForward=` boot, a loaded
  fixture, `?level=` and the tycoon recipe below. Command-log fields (`docksBought[]`, `fired`, `adsPosted`) do include
  the recipe's commands (its docks show at 0 s); its hires are not in `hires[]`, which is right for fun bar item 1 (they
  were not choices).

### Configs: `spicy.json` for build 2 and `tycoon.json` (plan-build2 §8.7 task 3)

- **spicy.json "late quests" cadence**: keeps the playtest-1 levers and adds `quests.offer {firstOfferDay: 1,
  intervalDays: 1}` (base tables 3 and 2): the first offer at 1:00 (tick 600 on seeds 1, 7 and 42, and in the browser on
  seed 7), then one day after each quest ends. The quest templates are unchanged.
- **A config may carry a `start` recipe**: a reserved top-level key, kept out of the merge and the data hash
  (`applyConfig` rejects any other unknown key with "… or start") and checked against the merged tables
  (`src/data/configStart.ts checkConfigStart`, problems with their paths; a bad recipe is a `DataError` in
  `loadConfigured`). Boot plays it (`src/boot/configStart.ts applyConfigStart`) only on a fresh game (tick 0, empty
  command log) in a build with the debug API, through ordinary ViewSim commands after one `debugForceLevel`:
  `placeDesk`, `buyMachine`, `hire` (inspectors), the Arm, `buyDock`, `buyVehicle` with the best driver. So the command
  log replays it, the save resumes it (Continue never re-runs it) and the attract sim never gets it. A refused step is
  reported and warned about, never thrown.
- **The recipe runs before `?level=` and `?quest=`**, which then find the game no longer fresh and stay out of it.
  Under the Title flow Boot's own throwaway sim also gets the recipe before the attract sim replaces it (invisible).
- **Applicants are picked like the competent policy picks them** (`bestApplicant`), so each seed builds the same crew.
- **The money comes from data**: `economy.startMoney` 14,500 leaves about $3,340 after setup (seeds 1–10:
  $3,329–3,355). The CLI `--config` plays `start` too (final review): `tools/sim/load.node.ts loadConfigured` validates
  it like the browser loader and `runSeed` applies it through a debug ViewSim at tick 0, after the recorder and before
  the policy; the header says `start recipe Lv 5` and a `# config start: N commands applied` line follows the recipe.
- **`debugForceLevel` books no income** (final review): it used to raise lifetime earned to the forced row's
  threshold, which added ~$7,400 to every tycoon run's first minute row, the profile's `lifetimeEarned` /
  `moneyPerMin[0]`, the cards' "Lifetime earned" and "Best day", and broke `stats.income === lifetimeEarned`. Lifetime
  earned now stays the money the game paid; the level bar already clamps a total below the forced row's threshold to an
  empty bar (`$0 / $N` at a forced L4, `$N · Tycoon` at L5).
- **tycoon.json mirrors the competent policy's L5 end state**: desk 1, metal detector, shaker, battery checker, X-ray,
  desk 2, 2 inspectors per desk, the Sorter Arm, docks 2–3, 3 bikes / 2 vans / 3 trucks. Seed 7 builds a 20-command log
  (one `debugForceLevel 5` + 19 player commands, all at tick 0) and the Golden Release is offered on the first tick.
- **Measured**: from this start, tapping Accept alone wins in 4.2–4.9 min (Victory ticks 2526–2955) on seeds 1–5 in a
  Node run. Cross-reference the M9 open item (Victory by 45 min not met): with a full L5 fleet from the start the
  Golden Release is won on its first try. The session is easy (the Arm clears the Hold Bay); `"holdStation": null`
  would leave the bay to the player — the author's call.
- **`tools/check-dist.mjs`** checks both configs the same way (in dist, valid JSON, byte-identical to
  `public/configs/`). The tycoon e2e (`e2e/configs.spec.ts`) asserts a fleet of 8 and a log of 20: changing the recipe
  means updating those numbers.

### Docs (plan-build2 §8.7 tasks 4 and 6)

- Numbers in the player docs are quoted from `src/data/*.json`; level arrival times are the M9 gate medians (11.72 /
  17.98 / 22.35 / 27.70 min).
- `docs/art-todo.md` assigns each PixelLab batch to a milestone by its timestamp against the M5–M9 commit times; the run
  budget is stated as 1,500 with a 300 reserve (Q-B2-15 as set).
- In CREDITS, the PixelLab art line now reads "PixelLab (AI image generation)", so the M10 attribution grep over the
  tree has no hit there.
- The docs ask the author to say no to the inspector's scan frames in writing, not with `art:reject -- worker`: a reject
  would reopen the anchor pass and regenerate the inspector.

### Final review fixes (M10: sim, scenes and phone reviews)

- **Card cameras leave no ignore bits** (`src/ui/cameraBits.ts removeCamera`): every full-screen card, dialog, sheet
  list and picker that draws through its own camera now clears that camera's id bit from every object in the scene
  (containers' children too) before removing it. Phaser 4 hands a freed id to the next camera, so a bit left behind hid
  a later camera's objects — after any lost-life, victory, summary or confirm card, landscape showed the paused HUD
  instead of the rotate card. The rotate card also clears a stale bit on its own root when it opens.
- **The rotate card holds the keyboard** (`Sheet.ts blockKeys`): while it is up no listener can claim a key, so G no
  longer lifts the Garage over it and W no longer switches views under it (City's F and arrow pan check it too).
- **A VictoryCard survives a reload**: a save written within two frames' ticks of `stats.victoryTick` (the HUD saves on
  the victory tick and holds the sim while the card is up) reopens the card on the HUD's boot sync. Endless play runs
  10 s between autosaves, so a later save keeps the card closed.
- **No Paused card over a card on its way**: `onVisible` treats the lost-life and game-over lead-in timers, the victory
  timer and the `victory` / `gameOver` holds like an open card.
- **The chips row reveals new chips**: a region unlock scrolls its chip (and NEW badge) into view (the later of two
  unlocks on one level, so both L5 chips show at 393 and 360), and `<` / `>` marks show at the row's ends while chips
  hide past them. The README Controls list the swipe.
- **Money floats add up**: a delta joins a still-opaque float of its kind (earnings, other income, costs) instead of
  printing over it; another kind starts after the live floats.
- **The top bar and the ticker are opaque** (were 0.94): world signs no longer read through behind the money and lives.
- **The warehouse baseboard is an interior-atlas frame** (`baseboard`, 32 × 2 `outline`, procedural, tiled along the
  south edge): the Rectangle split the back batch (2 draw calls at every tier). A dist test now measures tier 5 with
  the tycoon lane (six slots, two desks of two, the Arm, three docks), scrolled and not.
- **The summary offer waits for 25 real minutes too** (`summaryOfferDue`): at 2× the game clock reaches 30:00 after
  ~15–20 real minutes, and fun bar item 4 counts real minutes, so a tester who opened the card when offered failed it.
- **`magic.skipsCheckers` is read**: false makes the golden parcel take each checker's process time and pass like a
  clean parcel (it is never flagged either way); true, as shipped, keeps the skip. The data hash is unchanged.
- **Docs**: the first job offer is on Day 4 (3:00; spicy: Day 2, 1:00); the tall-room scroll needs a 393 × 659 (or
  360 × 604) custom device in devtools — at 393 × 852 tier 5 fits; item 4 counts real minutes; check-dist labels the
  policy chunk as loaded by the Title's demo city.

## Run decisions (build 3)

### Run-start findings (2026-10-31)

- **Part A of `prompt-build3.md` was never run.** The author pasted part B (M13 → M15, "continue from the M12
  commit"), but `main`, `origin/main` and the reflog all end at the build-2 hand-off (2db4c6e): there is no M11 or M12
  commit and no `docs/feel-check-m12.md`. The prompt says "never wait on me", so this run implements **M11 → M15 in
  one go**: M11 and M12 as part A specifies (plan-build3 §8.2–§8.3), M12 pushed with `docs/feel-check-m12.md` as a
  checkpoint the author can still play, then M13 → M15 as part B specifies. Q-B3-13 ("stop after M12") is overridden by
  the later part-B instruction; the M12 zip is sent mid-run so the feel check can still happen in parallel.
- **The feel-check notes block was empty** (the template placeholder `[the author pastes the notes here …]`). M13's
  deck review therefore runs on plan-build3 §8.4 task 3's rules alone; no Q-B3 default is changed by a note. If notes
  arrive later they go into a follow-up deck pass.

### Q-B3 defaults taken (plan-build3 §11; the author: "the rest looks good")

- [Q-B3-1] Pacing: every level median −10 % (windows × 0.9: L2 7–13.5, L3 13.5–18, L4 18–22.5, L5 22.5–27 min;
  Golden Release ≤ 29); the threshold scan runs with `newStrainDelayS` 90 from its first gate, then the L1 openers,
  then `perLevel` 0.015; −8 % accepted before any other value moves — `economy.json pacingTargets`, `levels.json`.
- [Q-B3-2] **Author's answer, not a default:** every card pauses the sim and never expires; job offers too, no Later —
  `src/sim/systems/deck.ts` (the hold), `src/ui/EventCard.ts`.
- [Q-B3-3] Event cash is balance-only (never lifetime earned) — `src/sim/systems/effects.ts` (`money*` appliers credit
  with `earned: false`).
- [Q-B3-4] **Author's answer:** events may take the last life, the last vehicle and the only inspector, with a way out
  on the card or its chain head (the harsh-consequence rule, schema-checked) — `effects.ts`, `tests/data/events.test.ts`.
- [Q-B3-5] Cadence bands by level (L1 60–100 s … L5 90–140 s, sim time), first card at 200 s, one open + one queued;
  links and outcome cards do not restart the timer — `events.json schedule`.
- [Q-B3-6] Jobs stay blocked while the Golden Release is pending (decision cards keep coming) — `deck.ts` job
  eligibility.
- [Q-B3-7] **Author's answer:** `minOnTimeRate` 0.85 plus the Victory art — `levels.json ultimateQuest`, B3 §5.
- [Q-B3-8] The policy scores options with the data weights of `events.json policy.weights` (life $600, −∞ for the last
  one); gate rows `policyEvPerCard` ∈ [−20, 40] and `policyNonDefaultShare` ≥ 0.4 — `src/sim/policies/eventPolicy.ts`.
- [Q-B3-9] 13 PixelLab category pictures (48×48 `event-pic`) + the Victory art, budget 400 + 100 reserve, G7 —
  `art/manifest.json`.
- [Q-B3-10] No chance rolls: outcomes are deterministic or decided by a stated condition on the player's own state —
  `deck.ts` conditional next.
- [Q-B3-11] Ship 100–120 cards from the 145-card pool, the M13 review cutting whole singles only — `events.json deck`.
- [Q-B3-12] `STATE_VERSION` 6 under `pm.save.v2`; build-2 saves are discarded with the stale-save toast —
  `src/sim/types.ts`, `src/sim/save.ts`.
- [Q-B3-13] **Author's answer** (stop after M12) — overridden by the part-B prompt, see the run-start findings above.
- [Q-B3-14] `spicy.json` cadence halves (first card at 60 s, bands 30–70 s) — `public/configs/spicy.json`.
- [Q-B3-15] The job offer moves to the EventCard (Accept / Decline); the QuestCard keeps active / complete and the gold
  Golden Release offer — `src/ui/EventCard.ts`, `src/ui/QuestCard.ts`.

## Run decisions and deviations (M11 — pacing pass 1 + the events engine)

### Engine (B3 §3, §6; the M11 design contract's D-numbers in brackets)

- **Blank draws** [D-1]: B3 §3.2's "no candidate → retry next tick" is replaced by a blank: a draw that yields no card
  (decisions off, or no eligible decision) consumes the slot and the next draw is due a full band gap later. The job
  roll and the gap are always drawn in the same order, so pass 1 (decisions off) sees exactly pass 2's job cadence and
  the stream-isolation acceptance (plan-build3 §8.2) holds exactly.
- **Two event streams** [D-2]: `events.rng` draws the cadence (the job roll and the gap), `events.picks.rng` the
  content (decision picks, random targets, `one` picks, every draw an effect makes). Job templates stay on the quest
  stream. With one word, a decision answered or not would shift every later job.
- **No per-tick modifier cache** [D-3]: B3 §3.6 / plan §8.2 task 4 ask for a fold cache keyed by tick, but decisions
  are commands between ticks, so a tick-keyed cache goes stale on the very tick a card is answered. The fold is a
  plain O(rows) loop with an empty fast path (≤ ~12 rows); R23's dirty flag stays the fallback if the step time
  passes 1 ms at tick 18,000.
- **`machineP` only on machines** [D-5]: desks get `inspectorP` through `syncDesk`; `checkerP`'s callers read a
  modified checker through `effChecker`, and `laneCatchRate` / `laneRatePerMin` take the sim context, so the
  StationCard, the SlotCard, the `laneRateAtLeast` condition and the roll agree (R31).
- **`malwareShare` add inside `malwareShare()`** [D-6]: a fourth `extra` parameter applied before `overseasMult`, as
  B3 §3.6 intends (adding at the callers would land after it).
- **The hold and headless runs** [D-8, D-9]: `Sim.attachPolicy()` tells the sim a policy decides cards on the step;
  test sims built through `makeSim` start with the deck off, `--policy none` answers the default option, `replay`
  stops on a held tick instead of spinning.
- **Inspector absence** [D-10]: an absent inspector keeps their seat and contract (unpaid for the days away); stations
  exist only for on-duty inspectors. A vehicle's absence also marks its driver absent.
- **`parcels lose`** [D-11]: a new terminal parcel state `lost` (with its conservation term and `parcel:lost`); only
  unreserved, non-magic shelf parcels.
- **The Golden Release quiet window** [D-14, critique 30]: Later is UI-only, so the sim's quiet window is
  `afterLevelUpS` after the gold offer or after the last regular quest ended, whichever is later; the HUD queues
  decision cards behind the gold card (M12).
- **Job cards in M11** [D-18]: until the EventCard lands in M12, the QuestCard's offer mode answers job cards with
  Accept / Decline (no Later), routed through `acceptQuest` / `declineQuest` → `decideEvent`.
- **The seed deck** [D-19]: "14 cards: one single per category + the gang chain + the audit router" does not add
  up; the seed is 10 singles + the 4-card gang chain + the audit chain (4 cards + its router) + the rescue loaner =
  19 cards + 1 router.
- **No `≥` in card copy** [D-20]: m5x7 has no `≥` glyph; copy says "95 % or better" / "at least" (a glyph test
  enforces it).
- **Forced harsh options** [critique 21]: a card whose only harsh-free option is paid carries a `balanceAtLeast` of
  that price in its `cond` (the recall at $250, the double fine at $400), so the policy and the player are never left
  with a strike as the only affordable answer. The harsh-consequence schema rule checks it.
- **The lives rows measure malware** [critique 26]: `maxLivesLost` and the 40-seed share count `cause !== 'event'`;
  lives taken by a card go to the informational `eventLivesLost` row (B3 §3.5: "the gate's lives row still measures
  malware").
- **`evMax` excludes life gains** [critique 20]: any `+1 life` option scores ≥ 600 > `evMax` 400; the static check
  leaves lives out (they are rewards, not cash); `deckEvMean` keeps them.
- **Policy scores** [D-37, D-38, critique 24]: a job's Accept scores `max(1, reward value)` and Decline 0 (the policy
  always accepts, plan-build3 §7); a ★ applicant scores Σ pip weight × (pip − 3); `parcels` effects score through
  data weights; a conditional `next` is scored on the branch its condition picks now, with the option's own `flag`
  effects applied virtually (the audit's consultant scores the pass branch).
- **Subscriptions are not payroll** [D-34]: the `payrollAdd` line is a separate `subscriptions` debit paid after every
  employee, skipped when short (ticker `Subscriptions unpaid`), never counted in `payrollPaid`.
- **The Sorter Arm has no stored price** [D-21]: `machinePrice` modifiers do not apply to it.
- **Fixture tooling** (wave 0): fixtures answer an open card through a logged `decideEvent` (default option) instead
  of patching `nextDrawTick`, so every fixture still replays to its state hash; `tools/fixtures/cards.ts`.

### Wave 1 deviations (the stream reports; recorded at the merge)

- **The hold ends at game over**: `Sim.tick()` does not hold while `economy.gameOver` — a card the deck opened on the
  tick the last life went cannot be decided then (`decideEvent` → `invalid`), and a headless loop would spin forever.
  The HUD pauses the stepper at game over anyway; `continueWithOneLife` brings the hold back with the card still open.
- **Bit-identical identity** (modifiers): every fold helper (`processTicksAt`, `clearanceTicks`, the payday `due`)
  returns its input untouched when the fold is exactly 1; a key with no matching row folds to the identity unclamped
  (a test pins every shipped bound to contain it). `effChecker` rounds a modified machine p to 4 decimals (the desk
  precision) so `laneRateAtLeast` boundaries are free of float noise.
- **Displayed value follows the income fold**: `ViewSim.parcelValue` = the locked value, else `round(valueAt ×
  income)` (what a delivery pays); the hub readout's `clearanceS` = `clearanceTicks / 10` (the rounded timer).
- **The deck** (stream B): the rescue checks the balance against the cheapest vehicle type, not `bike` by name; a
  queued card is counted (`offered`, `seen`, cooldown, `event:offered`, `openedTick`) when it opens, not when queued;
  a link inherits its head's target and pick, and resolves its own rule at open only when it inherited none (or its
  pick names another role); `debugOfferJob` withdraws any open offer first (build 2's `debugOfferQuest` rule); an
  Accept while a quest is active returns `quest-active` and leaves the card open (unreachable in play); the chain-end
  ticker line uses the chain head's title.
- **Effects** (stream C): `hireStar` draws the look on the people stream (critique 10 over D-44's "picks"); the gift
  driver's name avoids both staff and waiting applicants (`Mo 2`), so no pool applicant is re-rolled; the applier
  parks the vehicle for `absent: "driver"`, but the schema rejects that value (use `"vehicles"`), so shipped data never
  reaches it; effects lines carry state-aware suffixes beyond the contract table (`(room for N)`, `(no room)`,
  `(shelf empty)`, `(N there)`, `(max 5)`, `(not running)`, `— Bike 1 has no driver`, `— no one sorts the Hold Bay`).
- **Policy scores** (stream D): scores round to cents so float noise never breaks a tie (the radio ad is an exact tie,
  so the default "No" wins); a vehicle voucher is valued at `vehicleGainShare` × list price; the investor chain head
  scores +255, not B3 §3.8's +275 (the chain weight); in the state-free score `vehicle lose any` prices the first
  vehicle type (bike); the baseline line reads "baseline rows within band (±5 %; level rows −12…−8 %)".
- **Schema rules beyond B3 §7** (stream E): the default option is always shown, and a paid default needs
  `cond.balanceAtLeast` ≥ its cost (so `--policy none` and fixture answers never stall); every card keeps one option
  with no `if`; `end` must name a card that applies a `mod` or `cap`; a `cond` may only read a flag some option sets;
  `bounds` must contain the identity; `scope` only on speed / spawn / processS / clearanceS; only the five known
  placeholders.
- **Interim job UI** (stream E, D-18): a job card that holds the sim auto-opens its QuestCard in either view and
  through the onboarding tour (else the game would sit frozen with nothing on screen); `__pm.answerCard()` and an
  `answer` flag on `__pm.advance` / `__pm.waitEvent` answer cards with the default through logged commands (e2e); the
  copy-fit placeholder test joins an option's effects lines with " · " into ≤ 2 lines at 276 px (stricter than one
  line per effect — M12's EventCard layout may relax it).

### Wave 1 review fixes (confirmed findings; no balance value changed)

- **The interim answer to a non-job card** (review deck-1, D-18): the rescue's loaner opens whatever
  `SIM_FEATURES.events` says (critique 16), and it — like any debug card — held a policy-less sim with nothing on
  screen. Until M12's EventCard, the HUD answers an open non-job card with its default option (else the first
  affordable one) through a logged `decideEvent` once no HUD hold is up, and tickers `<title>: <effects lines>`
  (`interimCardAnswer`, `src/ui/questText.ts`); never under a policy or at game over.
- **The stepper stops through the hold** (review deck-2, B3 §3.2 / §6): `Sim.held` (a card open, no policy, not game
  over) is what `tick()` checks, and the browser stepper reads it — a held frame leaves the accumulator and the
  render alpha untouched (vehicles stood replaying their last 100 ms step at 10 Hz), a frame or an advance stops at
  the tick that opened the card, and `ticks` / `__pm.advance` count only the ticks that ran. M12's `holds.event`
  builds on it.
- **No card on a payday tick** (review policy-1): the deck step runs before the day step, so a card opened on a
  payday had its cond `balanceAtLeast` and its options' affordability checked against a balance payroll was about to
  cut — the recall's paid way out greyed, the strike forced at the last life. A payday tick is now a quiet tick
  (`deckQuiet`): a due draw, link or rescue opens one tick later, against the paid balance.
- **A way out must be one** (review policy-2, critique 21–22): on the way to a link with no harsh-free answer, an
  option counts as the chain's escape only when it is always shown, free of harsh effects, and free or covered by its
  card's cond `balanceAtLeast` — the rule a drawn card's own way out already had. (The gang's "Accept ($300)" is an
  escape for its watch link only while the head's cond covers it; the shipped watch keeps its own way out, "Yes".)
- **[Q-B3-8] refined — the policy sees a fatal link** (review policy-2): a plain `next` still scores the chain weight
  (B3 §3.8's default, so the hand-checked values stand), except when every shown, affordable option of the card it
  books takes the last life now — then the option is −∞, and the policy takes the chain's way out instead of walking
  into a link that ends its run (B3 §3.8 "the policy never ends its own run").
- **A vehicle pick is a driven vehicle** (review effects-3, B3 §3.5 "a driver's vehicle parked"): `pick: "vehicle"`
  candidates are the vehicles not absent with an active, present driver at the wheel — the population the absence's
  `all` parks; a picked vehicle whose driver left since parks nothing (`(no vehicle to park)`, no tone) and the policy
  scores it 0.
- **The long victory test is never vacuous** (review deck-4): `RUN_MINUTES` = max(victoryMaxMin, 50 — the latest victory
  seen) + the longer of the 3 endless days and the job window (cooldown + 4 × L5's longest gap) + 1 = 62, and the
  endless test asserts the "job cards come back" check ran on at least one winning seed.

### Pacing pass 1 — the threshold scan (B3 §2.2, plan-build3 §8.2 task 3; decision deck off, job cards on)

Build-2 medians (docs/gate/baseline-build2.json): L2 11.72, L3 17.98, L4 22.35, L5 27.70 min. The job scheduler alone
(wave 1, build-2 data) moved them to 11.75 / 17.80 / 21.99 / 27.58 and quests offered 7 → 6. Every gate below is
seeds 1–10 × 30 min, competent policy, events off; the 40-seed share counts seeds losing a malware life.

- `parcels.json malware.newStrainDelayS` 60 → **90** (B3 §2.2 lever 1, applied first by design; rows `maxLivesLost`
  and the 40-seed share): 40-seed share 11/40 → 9/40, seeds losing a life 3/10 → 2/10, lives median 0 → 0; L5
  27.58 → 27.55.
- `levels.json` L2 threshold $2,000 → **$1,750** (row `level2Min`): 11.75 → **10.57** min (−9.8 % vs build 2);
  `truckAfterLevel2MaxMin` +1.53 → +2.78 (≤ 4). $1,700 is a cliff (truck +3.55 and L3–L5 back to −1…−2 %).
- `levels.json` L3 $3,700 → **$3,250** (row `level3Min`): 17.80 → **16.52** (−8.1 %);
  `firstOverseasClearedAfterLevel3MaxMin` +2.24 → +2.66 (≤ 3). $3,200 fails the overseas row, $3,400+ the lives row.
- `levels.json` L4 $5,200 → **$4,650** (row `level4Min`): 21.99 → **20.56** (−8.0 %).
- `levels.json` L5 $7,400 → **$6,500** (rows `level5Min`, `goldenReleaseOfferedMaxMin`): 27.58 → **25.46** (−8.1 %);
  the Golden Release offered 27.58 → 25.46 (≤ 29). **$100 below plan-build3 §8.2's $6,600–6,800 range**: the best
  in-range set gave 25.57–25.64 (−7.7…−7.4 %) with a 35-min lives median of 0.5; stepping down by $50, $6,500 is the
  first in band (R26).
- `parcels.json malware.perLevel` 0.02 → **0.015** (B3 §2.2 lever 3, R26): triggered by the 40-seed share 15/40 at the
  first-guess thresholds; at the final thresholds 14/40 → **13/40** (32.5 % ≤ 35 %), the overseas row +3.10 (FAIL) →
  +2.66, L5 25.52 → 25.46. Lever 2 (start money, bike price) was not needed (L2 and truck rows pass), nor `jobShare`
  (quests offered 6 ≥ 4).
- Not taken: an all-−10 % alternative (1750/3150/4450/6300) — green with the deck off, but with the deck on its L3
  falls to −13.2 %, outside the band, so M14 would have to raise it again. With the deck on, the shipped set gives
  −11.0 / −11.6 / −8.2 / −11.0 % (in band) — the starting point of pass 2.

### Wave 2 (fixtures and tests)

- The fixture generators count only payouts that leave lifetime earned under a threshold (a quest reward paid after
  `levels` in the same tick made level-up-5 cross it); `l2-lane` is taken 40 s after the shaker or 45 s before L3,
  whichever is sooner (`L2_QUIET_S`). The widened fixture windows of wave 1 went back to build 2's (600 s, 34 min).
- `levels3.long` "the plan at L3": the Battery checker is checked on or after the L3 tick (the cheaper L3 leaves
  $233–$390 at L3, so the $500 checker lands 21–96 s later), and dock 2 only when it was bought (L4 may come first,
  and the plan buys the new strain's X-ray before the dock by design, Q-RUN8).
- `quests-policy.long`: a Golden Release failed by a malware life on the same tick is allowed when the median of such
  failures stays within `maxLivesLost` (the gate's own semantics); no seed fails on the shipped data.
- Step time at L5 (R23): `sim.tick` mean 0.03 ms, p99 ≤ 0.15 ms, max 0.40 ms — far under 1 ms; no dirty flag needed.

## Run decisions and deviations (M12 — the cards on screen)

### The contract's decisions (the M12 contract's D-numbers; the critique's numbers in brackets)

- **D-M12-1** The EventCard and the EffectsCard are bottom cards on the HUD camera (QuestCard architecture, depth 6000),
  so the deny tooltip, toasts and the red flash draw over them; the scrims are Zones (D-M12-20: no draw call).
- **D-M12-2** Enter takes the **first** shown option — never a `danger` or an unaffordable one (it shows `Tap an
  option` and denies instead); on a news card Enter is the OK. B3 §3.2/§4.1 say "Enter = default", but the default is
  invisible and can be the danger face (`ev_crime_gang_watch` "No"). Esc is swallowed on decision and job cards.
- **D-M12-3** A greyed option's effects row reads `Can't afford · $N` (the reason plus the price; many labels carry no
  price).
- **D-M12-4 / D-M12-5** A waiting card opens only when no visible paper, level-up moment, HUD hold or lead-in timer is
  up; the Golden Release goes first only when its card could open now [3]. No HUD hold while a card only waits — the
  sim holds itself (`Sim.held`) and the event chip pulses. The order is lost-life → EventCard → papers.
- **A card waiting behind a sheet freezes the sim** [4]: with M11's sim-side hold (`Sim.held`), an open card holds the
  sim whatever is on top of it — a departure from B3 §3.4 "a sheet does not hold the sim" (M11 D-15). The ticker
  freezes with it (stream D).
- **D-M12-6** The job objective is drawn by the UI (`questText.objectiveText`); the sim's job lines carry the reward and
  the limit.
- **D-M12-7** [9] The copy fit lives in `tests/data/events-fit.test.ts` (every non-router card and job template through
  the real ViewSim and `layoutEventCard`, states S1–S3, every target district, jobs at L5, the balance-0 guard [10]).
  The plan §8.3 acceptance command becomes `vlr test -- tests/data/events` (it matches both files; the literal
  `tests/data/events.test.ts` would skip it).
- **D-M12-8** `wrapHeadline` lives in the Phaser-free `src/ui/text.ts`; Newspaper re-exports it. `src/ui/effectText.ts`
  joins the sim-purity Phaser-free list (AGENTS.md updated).
- **D-M12-9** The $100 bell / paper thresholds are UI constants in hudKit, not balance data.
- **D-M12-10** The compact quest chip (82 px, beside the event chip) drops its label and keeps the warning in its bar
  fill: red on danger, amber on warn, gold otherwise (`questChipFillColour`).
- **D-M12-11** The event chip alone sits right-aligned in the quest chip's slot; B3 §3.4's width sums are 4 px off, the
  pins (≥ 64 px of row B at 360, ≥ 96 at 393) hold.
- **D-M12-12** `victory_art` sits 1:1 under `TYCOON`; the confetti plays on `game:victory` and on a reload's reopen,
  never on a relayout, after Back from the summary, or under reduced motion; teardown stops the burst before the root
  is destroyed [16]. The Golden Release stamp's burst is centred on the stamp, clamped to `CONFETTI_HALF_SPAN` (112 px)
  from both screen edges [15], and stopped where the stamp is destroyed.
- **D-M12-13** A raised shelf cap past the room's drawn capacity draws no extra minis; the badge counts `/N` and the
  tooltip reads `Shelf a/b (+N)`.
- **D-M12-14** The director's `quest:offered` bell rings for the Golden Release only; the HUD pings job cards when it
  shows them (policy runs and queued cards stay silent).
- **D-M12-15** The EffectsCard never holds; opened from the pause menu it keeps speed 0 and returns to the menu on close.
- **D-M12-16** An event's lost life gets the lost-life card's event variant (the card title in red, `You chose: …`,
  `Lives: N`, one OK) and no incident paper — the decision's paper covers it; a last life gets the GameOver variant
  headline (`<title> — you chose: <label>`).
- **D-M12-17** The HUD-cell pulses come from a state diff around `decide` (the mood on the unrounded mean [14]).
- **D-M12-18 / [18]** The HUD matches its card to the sim's on `eventId` + `openedTick` (back-to-back job cards share
  `job:<templateId>`).
- **D-M12-19** The EventCard rebuilds its children on each open or relayout; opening it again with the same card
  rebuilds in place without a new slide.
- **[5]** A card is a news card only when its data kind says so; "three" is three shown options.
- **[6] / [7] The paper headline**: a chain end reads `<chain head title> — the story ends` (the sim's ticker rule); a
  news card reads its title (plus the first effect line), never `you chose: OK`; a decision reads
  `<title> — you chose: <label>`.
- **[8]** At game over a waiting card neither shows the chip nor makes it pulse (`eventChipModel(ev, pending,
  gameOver)`, and the HUD's own `!gameOver` guard); `onEventOption` returns right after closing the card when the
  decision ended the run [2].
- **[19]** News-card dismiss taps on the scrim or the panel are ignored for `EVENT_CARD_IN_MS` (300 ms) of scene clock;
  option buttons and keys are not guarded.
- **[20]** A chip tap opens the waiting card when the open check passes, else the EffectsCard; a refusal closes
  nothing. Opening a card closes the player's panels, the EffectsCard included.
- **[23]** Effect lines are split at an internal `·` before wrapping, and a lone `—`, `·` or `–` sticks to the word
  before it, so no row starts with a separator; a separator inside a line draws neutral grey.
- **`?event=<id>`** (debug only, a fresh game): offers that card at create through `offerEventParam`, registered after
  `?quest=`.

### Wave 1 deviations (the stream reports; recorded at the merge)

- **Copy fit** (stream A): a button label wider than the inner width − 2 × `CONTENT_PAD` (266 px at 300) fails the fit —
  labels never wrap (`OptionLayout.labelOverflow`, critique 10a); `wrapFlow` also cuts a single word wider than its
  line with `…`, so nothing draws past the card edge.
- **EffectsCard icons** (stream B, critique 17): each row icon sits on a grey3 plate with a 1-px outline (the EventCard
  picture inset's look) instead of a `textDark` tint — the tint turns every icon into a near-black silhouette; only
  `ic_shield` and `ic_speed2` vanished on the light panel. Enter closes the card too (Close is its only button), and
  `refresh()` updates in place when the rows keep their shape (the 2-Hz poll would otherwise destroy Close mid-press).
- **Prices** (stream C): the OOPS stamp shows what the sim takes (the `wrongTossFee` modifier, clamped to the balance;
  plain `OOPS` at $0, `wrongTossFeeNow`); the BuySheet draws no SALE pill on a locked row (the Garage's locked cards
  match; the model still flags it); the Hold Bay card's value includes the income modifier (`vs.parcelValue`); the
  Garage refunds half the price paid (`purchasePrice`), so a sale purchase refunds half the sale price.
- **HUD** (stream D): a leftover `'event'` hold with no card on screen is dropped, so the game cannot freeze on it; the
  interim job-card answer and the interim auto-answer of non-job cards (M11 D-18) are retired —
  `tests/ui/interim-card.test.ts` is deleted (the loaner stays covered in `tests/sim`, the hold/replay in `hud-m12`).
- **The deck** (stream E, plan §8.3 tasks 4–5): **62 cards + 1 router** (40 drawable at L1) — every L1 single of B3 §4,
  the investor and rival chains, the kept seed cards (gang, audit, loaner, grant, …) and both sales. The plan's
  "about 40" undercounts its own list. Copy is B3 §4's; no `puns.json` keys were needed. Deviations from B3 §4:
  - the price war (`ev_cust_rival_opens`) costs $100 instead of income ×0.9 for 3 days (three effect segments do not
    fit two 276-px rows); the gang raid's effects are reordered (wanted, money, lives, satisfaction) to fit at the
    lives cap;
  - the rival poach's quit uses pick `one` (the named `{driver}` leaves; B3 says `best`), the link needs
    `balanceAtLeast` 200 (both head options book it and the paid "Match it" is the only way out), and the head carries
    `pick: driver` for the link's `{driver}`;
  - targets where B3 names none: the alley and the roadworks `random`; theft, graffiti, wallet and slow week
    `busiest`;
  - cost convention: a voluntary flat payment is a `cost` (greyed when short), a consequence is a money delta, a
    per-vehicle charge is `moneyPerVehicle`.
- **The EV band** (stream E; R21/R33 — card weights and one cooldown only, no policy weight and no card number moved):
  with B3 §4's default weights the policy's EV per card was 40.01 on seeds 1–10 (44.1 on 40 seeds), over the −20…40
  band (the driver-pip cards and the one-time gifts). Lowered: pauses 2, training 2 (cooldown 5 → 8 days), shortcut 2,
  fair 2, drill 2, grant 2, cat 2, tips 1, update 1, barcode 1; raised: birthday 4, heat 4 (cheap cards where the
  policy takes the non-default). After: EV 30.4 (seeds 1–10), 25.4 (40 seeds); non-default share 0.64 / 0.58.
- **Tests under the flag flip** (stream E): `withDecisions(on, f)` in `tests/sim/helpers.ts` keeps the decisions-off
  premise where a due draw with no job must be a blank (8 tests in `events.test.ts`, 3 in `quests.test.ts`, 1 in
  `victory.test.ts`); the pacing tests (`policy.test.ts` / `quests-policy.long` `runs()`, `levels3.long`,
  `victory.long`) and the fun-bar-2 profile in `tests/metrics/playtest-schema.test.ts` stay pass-1 runs (decisions off)
  until M14 / M15 (B3 §2.3: pass 1 events off, pass 2 on); `events-policy.long` gates the event rows with the deck on;
  `robust.ts` exempts absent vehicles from "inactive with an active driver" and counts only inspectors on duty; the
  90-min perf test expects `11 + gifted − lost` vehicles.

### Wave 2 (the merge: fixtures and smoke)

- **Fixtures under the deck** (`vlr fixtures`, events on): every fixture has `events.open === null`; the next draw is
  33–1059 ticks after the snapshot (`level-up` 33, `l2-lane` 86 — both loaded with `?policy=1`; the policy-less shots
  have ≥ 530). Seed 7's trajectory moved with the deck, so:
  - `l2-lane` tries seeds from 7 and takes the first with a real L2 lane holding the shaker, a truck, and a clean
    30-s policy watch (no level:up, no life lost) — **seed 8** (seed 7 places the shaker only after L3);
  - `people-l3` tries seeds from 7 for a real L3 that is still L3 after the settle (`debugForceLevel` only if no seed
    reaches one) — **seed 9** (seed 7 crosses L4 inside the settle; seed 8 is still at L2 at the stop);
  - `attract.json`: seed 7 reaches L5 at ≈ 29.9 min and buys its van at ≈ 34.7 and its 2nd truck at ≈ 39.3 min, so the
    scan runs to 45 min, and `attractProblems` adds a 2-min policy watch (deliveries, no life lost, no stall — the
    shot-fixtures test's own watch; minutes 40 and 41 lose a life to an unchecked parcel): the city is **minute 42**.
  - `overseas-malware`'s test counts lives **lost** (`stats.livesLost`), not lives: seed 7's magic_parcel job pays +1
    life 18.8 s after the load.
- **Smoke**: the M11 interim-answer smoke test now drives the EventCard (the loaner shows under the `'event'` hold,
  `event:opt0` answers it).

### Review fixes (M12 confirmed findings; the review ids in brackets)

- **The chip over a Warehouse sheet** [hud-1, card-1]: `raiseEventCard` now closes the room's sheets too — a new game
  event `pm:closeSheets` (`nav.ts EV_CLOSE_SHEETS`) that WarehouseScene answers with `closeSheets(true)` (BuySheet,
  SlotCard, HoldBayCard, StationCard, its HireSheet, the dock dialog; synchronous pops) — so a tap on the pulsing
  chip opens the card on the same tap. It returns true only when the card showed (or the Garage is on its queued
  sleep); otherwise the event chip falls back to the EffectsCard (critique 20), and a job offer's quest chip / district
  row plays `deny` instead of doing nothing (no new copy).
- **pm:goto's BuySheet under a card** [hud-2]: `WarehouseScene.highlight()` opens the BuySheet only on an empty modal
  stack (`modalCount() === 0`); the slot pulse and the scroll stay. The card stays the top modal (Enter / Esc its own).
- **Held, ❚❚ lights** [hud-3]: the speed segment reads `stepper.paused || vs.held` (critique 4's third symptom). The
  playtest recorder's `isPaused` is unchanged: whether a held wait behind a sheet counts as paused play is M15's
  metrics-v3 call (think times), recorded there.
- **Option taps wait for the slide** [card-2]: an option button (and a greyed one's deny) is ignored for the first
  `EVENT_CARD_IN_MS` after the card opened or another card took the slot — critique 19's guard, extended from the news
  card's scrim / panel. `EventCard.tap()` (tests, e2e) and Enter / Esc are not guarded.
- **`costPerVehicle`** [deck-1]: a voluntary per-vehicle purchase is an option field `costPerVehicle: {each, type?}`
  — its price `each ×` the owned vehicles (of `type`) is the option's `cost` in `cardOptions` (greyed while short,
  debited once, never clamped), its line keeps `−$120 ($40 × 3 vehicles)` (`effects.ts perVehicleLine`). The schema
  refuses it with `cost`, on the default, in a way out (`safeExit`), and counts it as paid for the unpaid-sibling rule;
  `staticScore` counts one vehicle. The radio, the fleet service and the livery moved to it (`moneyPerVehicle` stays a
  consequence, clamped). The cost convention above becomes: voluntary flat = `cost`, voluntary per vehicle =
  `costPerVehicle`, consequence = a money / moneyPerVehicle delta. M13's draft (`ev_fleet_fuel` Absorb it,
  `ev_fleet_ebike` Convert them — `type: bike` —, `ev_wx_snow` Tyres) should use it too.
- **CREW** [deck-2, R28]: the policy (both kinds) seats the best driver applicant in any vehicle with no driver and
  no pending Replace (a card's quit, a driverless gift), oldest vehicle first, at hire fee + purchaseBuffer, right
  after REHIRE; an empty pool waits. A no-op on every deck-off run.
- **The poach tie** [deck-3]: `ev_cust_rival_poach`'s bonus $200 → **$180** (the link's cond `balanceAtLeast` 200 →
  180 with it): against staffQuit 200 the old price was an exact tie that went to the default (`Let them go`) on 8/8
  poaches over 40 seeds. Gate row: none moved by design (a tie-break; the policy's non-default share / EV rows are
  re-read in the gate below). A data test now refuses any harsh option that ties a harsh-free sibling state-free.
- **Not fixed here** [hud-5]: `e2e/quests.spec.ts`'s three job-offer tests and `e2e/shots.spec.ts`'s `quest-offer`
  shot still drive the retired job QuestCard; they belong to the M12 contract §9 wave-2 e2e repair (events.spec.ts
  test 5, the `event-card-job` shot), which owns those files.
- **Fixtures and the gate after the fixes** (data `6c7f8631`): every fixture regenerated (`vlr fixtures`). Seed 7's
  run moved (its fleet service is now `Skip it` when short instead of a free `Service now`): L5 at ≈ 32.7 min and its
  Golden Release times out three times by 60 min, so `tools/fixtures/m9.ts` victory tries seeds from 7 and takes
  **seed 8** (wins at ≈ 47.8 min; `fixture.seed` records it); the attract city is **minute 40**; `l3-docks`
  (`tools/fixtures/m8.ts`) now also waits for a snapshot with no card due before its clearance + 1 s (shot-fixtures
  runs it without the policy, where a card holds) — tick 17150, L4, clearInS 29.6. Gate (seeds 1–10 × 30 min) PASS:
  first delivery 43.3 s, catch 178.3 s, L2 10.29, truck +2.78, lives 0, stall 0, hold/10 min 8.89, quests 6 / 3.5,
  L3 16.73, overseas +2.55, L4 20.13, L5 25.46, cards 21, L1 plateau 3, EV/card 25.01, non-default 0.63
  (was EV 30.37, L4 20.60, L5 26.17); 35 min PASS (Golden Release offered by 25.46, EV 38.1, non-default 0.57);
  delegating PASS (EV 18.1, non-default 0.59, events took no workers — was 2).

### M12 wave 2 (e2e, shots, the mobile and sim review passes)

- **A press counts where it lands** (review mobile-1): the read-in guard is checked on pointerdown — a finger that
  lands while the card slides in never answers it, however late it lifts; a red (danger) option waits 600 ms
  (`EVENT_DANGER_IN_MS`, a UI timing, not balance). The news scrim and panel follow the same rule.
- **No world select under a card** (mobile-2): a city long-press already under way when a card opens is dropped.
- **The Victory card opens once** (sim-2): `sawVictory` in the onboarding save, set by Continue, so a card held near
  the victory tick no longer reopens the VictoryCard and its confetti on every reload.
- **The sim's hold silences the loops** (sim-3): `simStopped()` (paused, 0×, or held by a pending card) drives the
  audio director's and the City's grumble pause.
- **`?event=` / `?quest=` act on a new game only** (sim-4): freshness comes from the Title's new-game swap, not from
  tick 0 (the hold can keep a saved game at tick 0).
- **e2e**: `quest-offer` is replaced by `event-card-job`; `policyOff` disposes the policy; `deckOff` keeps fixture
  shots without a policy from holding. Draw calls with an open EventCard: 5 (≤ 8); the EffectsCard: 5.
- **The plan's acceptance command** `vlr test -- tests/data/events.test.ts` is run as `vlr test -- tests/data/events`
  so it also matches `events-fit.test.ts` (the real copy-fit cases at 360 × 604 and 393 × 659).
- **A card waiting behind a sheet holds the sim** (M12 wave 0): with M11's sim-side hold, a card drawn while a sheet
  is open freezes the sim (the chip pulses) until the sheet closes and the card shows — B3 §3.4 said "a sheet does
  not hold the sim". Kept: every card pauses (Q-B3-2), and the frozen frame is stable (no jitter).

## Run decisions and deviations (M13 — the full deck)

- **No author notes**: the feel-check notes block was empty, so the deck review applied plan-build3 §8.4 task 3's
  rules alone; three fresh-context reviewers (by category group) judged every card on the sim's own generated lines.
- **[Q-B3-11] Ship 115 cards** of the 145-card pool (+ 4 routers and the rescue loaner = 120 rows). 29 whole singles
  cut, weakest first, no chain link: `ev_luck_lottery`, `ev_staff_sorter_screen`, `ev_staff_retire`, `ev_fleet_keys`,
  `ev_sec_marbles`, `ev_money_machine_sale`, `ev_city_roadworks`, `ev_wx_fog`, `ev_press_scandal`,
  `ev_crime_graffiti`, `ev_tech_bug`, `ev_tech_drone`, `ev_port_crane`, `ev_luck_competitor`, `ev_fleet_schoolrun`,
  `ev_cust_loyalty`, `ev_sec_firmware`, `ev_cust_bulk`, `ev_sec_outbreak`, `ev_money_prices`, `ev_money_accountant`,
  `ev_fleet_gps`, `ev_fleet_ebike`, `ev_staff_sick`, `ev_city_zoning`, `ev_staff_pauses`, `ev_fleet_livery`,
  `ev_money_lot_sale`, `ev_city_noise` (reasons: never offered in 40 seeds, a same-shape twin in the category, no real
  choice, or a flat body). Shipped by category: staff 11, fleet 7, customers 15, security 13, money 11, city hall 13,
  weather 7, press 9, underworld 9, tech 5, port 9, luck 6; 33 eligible at L1; every modifier key still used.
- **Spec numbers changed** (B3 §4 is a first pass; each to keep an option under `evMax` 400, the policy EV band, or an
  option a human would pick): bike lanes speed ×1.15 → ×1.05; the container 8 → 4 large parcels; the investor $800
  → $400, buy-out $1,000 → $300, exit −$300 → −$150 (the policy now declines the angel — B3 §3.8's "+275" no longer
  holds; humans still see the chain); the gang's return $500 → $400; sponsor, crate owner, VIP and award rewards
  halved (R21: "the richest money options halved before any threshold moves"); the influencer's glowing video loses
  its +$100, sat +5 → +3, spawn ×0.6 → ×0.75; tips income ×0.97 → ×0.95; barcode and the dispatch update ×0.9 →
  ×0.94; night cargo ×0.5 → ×0.6; insider Ignore becomes desk catch −3 %; the election's loser becomes every
  district −1; the scam's Click adds a vehicle price ×0.85 (the vehicle discount moved off the cut lot sale); the
  cat drops its +2 happiness and costs $2/day; spot check, outage and festival became decisions; the rival poach
  bonus $180 (M12); per-vehicle voluntary charges are `costPerVehicle` (fuel, snow, radio, service).
- **Copy fit (R22)**: hints use `50+` / `45+` (no `≥` glyph and two lines at 360 px); the storm's "Do it yourselves"
  drops its processS line to fit two rows.
- **Weights and cooldowns** (plan §8.4 task 1: ≥ 9 categories per 30-min run, ≥ 3 decision cards on the L1 plateau
  on 10/10 seeds, no `once` repeat): decision weights per category (staff 4, fleet 5, customers 4, security 5, money
  5, city hall 11, weather 9, press 7, underworld 6, tech 7, port 16, luck 7; the reactive cards 12; news 1) and a
  15-day cooldown floor on repeatable decision cards (≈ 13 deck draws over 12 categories gives a random-draw limit
  of ≈ 8.5 distinct categories; the floor lifts the median to 9). Seven news cards moved from L1 to L2 (they took
  plateau slots).
- **Two late changes at the final check** (the quick gate's seeds 1–3 failed the truck row, the EV band and the
  non-default share): `ev_money_tax` minLevel 2 → **3** (a % of the balance at L2 is the truck fund; B3 §4.6 said L≥2)
  and `ev_fleet_gearbox` gains `cond.balanceAtLeast` 200 (its "Fix it now ($200)" must be affordable — the rule the
  poach and recall cards already follow). Over 40 seeds: truck within 4 min 25 → 26/40, EV in band 34 → 36/40,
  non-default ≥ 0.4 30 → 33/40, L5 26.91 → 26.68; seeds losing a malware life 10 → 12/40 (≤ 14).
- **Deferred copy edits** (pinned in tests; for the M14 copy polish): the gang's "Accept ($300)" / "Deny" → "Pay up
  ($300)" / "Refuse"; the watch's Yes / No → "Hide the fleet" / "Carry on"; "Match it (a bonus)" → "Pay a bonus
  ($180)"; the audit hint's awkward wrap; the friend's "Offer a job"; "Send everyone" only with two inspectors;
  "satisfaction" → "happiness" in job lines. Not taken: the recall's appeal option and the grant's desk cost (they
  move the policy's picks and the gate).
