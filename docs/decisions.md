# Decisions log (playtest 1)

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
  pushes. (plan.md §6.12 / Q58.)
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

## Defaults taken (plan.md §14)

Filled in as each is coded; the complete list is in the final report.
