# Art to-do (playtest 1 + builds 2–3)

## For the author: G7 — the build-3 pictures (B3 §5) — start here

Build 3 adds the only art of the run: **13 category pictures** (`ev_pic_*`, new class `event-pic`, 48×48, `world`
atlas, district `ui`) for the EventCard and the Newspaper's picture slot, the **victory illustration** `victory_art`
(`ui`, 208×104, `world`) for the VictoryCard and the victory newspaper item, plus three procedural pieces: `ic_event`
(the ringing orange event bell, icon16, both atlases like `ic_quest`), `fx_confetti` (`_f0`…`_f7`, fx 32×32, `world`)
and the fallbacks in `tools/art/eventPics.ts`. Two PixelLab rounds on 2026-10-31, Pro Flash on a magenta key: the
first batch (`b3-events`, 3 candidates per id, **213 generations**, balance 2,422 → 2,209) and one re-roll of
`ev_pic_port` (4 candidates, **20 generations**, 2,209 → 2,189). After an independent vision review, two picks were
swapped to another first-round candidate, `ev_pic_port` was re-rolled, and `victory_art` was reprocessed from its raw
download without the malware ramp (no spend). Every id has a PixelLab pick, so **no picture ships procedural**. Every
pick is `approved: false` and waits for your yes or no.

Sheet: **`art/contact/events@4x.png`** shows the 13 pictures as they ship, four EventCard mocks at 1× (344 px = the
card at 360), the victory art on a VictoryCard mock with the confetti over its top edge, the confetti frames,
`ic_event` beside the rush `ic_bell`, an EventChip mock, and the procedural fallbacks for comparison. The candidates
are on `art/contact/candidates-b3-events@4x.png` and `candidates-b3-port-reroll@4x.png` (processed | raw download per
candidate). Both are gitignored like every candidate sheet.

| id                  | Agent pick | What it shows                                                                                                                                                            |
| ------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ev_pic_staff`      |         #2 | a dark-clipped clipboard (its board snapped from gold to yellow) beside a big white coffee mug                                                                           |
| `ev_pic_fleet`      |         #2 | a dark spoked bike wheel crossed by a grey wrench                                                                                                                        |
| `ev_pic_customers`  |         #0 | a blue mailbox on a post, red heart, raised flag, grass tuft                                                                                                             |
| `ev_pic_security`   |         #2 | a crisp cardboard parcel, a magnifier (rim snapped from gold to yellow), a round red skull tag (swapped from #1, whose top was lumpy and whose tag was half hidden)      |
| `ev_pic_money`      |         #0 | gold coin stacks on a green ledger                                                                                                                                       |
| `ev_pic_cityhall`   |         #0 | a symmetric blue-roofed civic hall with a clock, columns, a flag and bushes (swapped from #1, busy at 1× with a red roof); no stamp, the `CITY HALL` masthead carries it |
| `ev_pic_weather`    |         #2 | a grey rain cloud, a yellow sun behind it, blue drops                                                                                                                    |
| `ev_pic_press`      |         #2 | a newspaper with a photo box and a blue-ball microphone                                                                                                                  |
| `ev_pic_underworld` |         #2 | a red crowbar and a dark burglar domino mask                                                                                                                             |
| `ev_pic_tech`       |         #0 | a grey gear with an orange bug on it                                                                                                                                     |
| `ev_pic_port`       |         #5 | a blue shipping container with door bars and corner castings, a round red customs stamp with a plain check mark (re-roll: every first-round stamp held a glyph)          |
| `ev_pic_luck`       |         #0 | a four-leaf clover rising from a red gift with a gold bow                                                                                                                |
| `ev_pic_job`        |         #2 | the job board's clipboard with a gold star and ruled lines                                                                                                               |
| `victory_art`       |         #2 | a full-bleed night scene: the glass HQ with a winged parcel emblem (no letters), fireworks, courier bikes, vans and trucks lined up, confetti on the street              |

```sh
vlr art:approve -- ev_pic_staff ev_pic_fleet ev_pic_customers ev_pic_security ev_pic_money ev_pic_cityhall ev_pic_weather
vlr art:approve -- ev_pic_press ev_pic_underworld ev_pic_tech ev_pic_port ev_pic_luck ev_pic_job victory_art
vlr art:reject -- ev_pic_cityhall "reason"   # one line per id you reject
```

Notes for the review:

- **The victory art is a night scene.** Pro Flash ignored the magenta key on all three victory candidates and painted
  its own night sky. On #0 and #1 the key flood ate part of that sky and left ragged skylines; #2 kept the whole scene
  and ships framed by a 1-px outline. It is the one picture that breaks STYLE.md §1's "no dark grading". That is on
  purpose, since the B3 §5 prompt asks for the HQ at night with fireworks; say so if you want a daylight re-roll. The
  raw had painted the sky band and the dark shades of the building, vans and bikes in the malware ramp (2,504 px of
  `mal0`/`mal1`). It is now quantized without `mal` (palette.ts `ID_RAMP_DENY`), so the sky reads `purple0`/`blue0`.
  It has 18 colours, which gives a lint A12 warning (> 16).
- **Colour meaning**: `event-pic` may use `gold`, `red` and `water` but never the `mal` ramp, so a purple mask cannot
  read as malware. Gold stays on the reward pictures only (palette.ts `GOLD_PICTURES`: `ev_pic_money`, `ev_pic_job`,
  `ev_pic_luck`). On the other ten, a gold pixel snaps to the matching yellow: the staff clipboard board and the
  security magnifier rim. Lint A07 enforces both rules per id.
- **Weak spots that are still shipped**: `ev_pic_staff`'s mug and paper are cream `grey5`, the `ui_panel` colour, so on
  the card the mug reads as a line drawing; the press paper is the same. A darker inset behind the 48×48 slot on the
  EventCard / Newspaper would fix both without new art (a UI call). `ev_pic_cityhall` lost its stamp in the swap.
  `ev_pic_security` #2 has one stray purple pixel at the magnifier's top-left.
- **`ic_event`** is the rush bell's shape with two white ringing ticks and an orange body. The ticks alone were too
  faint to tell it from the yellow `ic_bell` at 16 px.
- **Fallbacks (R24)**: until a picture is approved, or if you reject one and no re-roll is made, `vlr art:reject` leaves
  the current image in place. To go back to the procedural composition, set the row's `placeholder: true`, drop its
  `chosenCandidate`, then run `vlr art:build`. The fallbacks are two existing icon templates on a 48×48 plate (the main
  one redrawn at 2×, the second a 1× badge; weather and press use small templates of their own) and a
  skyline-and-fireworks plate for the victory art.
- **Budget**: build 3's PixelLab budget is 400 generations with a 100 reserve (Q-B3-9). `tools/art/gen.ts` counts from
  2026-10-31 (`PIXELLAB_RUN_SINCE`), refuses batches past 300 without `--use-reserve` (`PIXELLAB_RUN_RESERVE`) and past
  400 outright (`PIXELLAB_RUN_BUDGET`). 233 are spent, so 67 are left before the reserve.

## For the author: what to approve or reject (build 2, G4–G6) — start here

Build 2 added or regenerated **47 PixelLab sprites** (43 new ids + `wh_ext`, `bike`, `ap_terminal` and `dk_ship`
re-done). The agent picked one candidate per id by reading the contact sheets (`tools/art/decide.ts --manifest`); every
pick is in the game now and waits for your yes or no (`approved: false` in `art/manifest.json`). Nothing shipped
procedural for lack of a good candidate: no PixelLab id fell back to procedural in M5–M9.

How the commands work (in a clone after `vlt install`; no token needed for either):

- `vlr art:approve -- id …` sets `approved: true, approvedBy: 'author'` on each id. It edits only
  `art/manifest.json` (no image changes); commit that file.
- `vlr art:reject -- id "reason"` takes **one id per command**, logs your reason in the id's `rejects[]` and clears the
  pick. The current image stays in the game until a re-roll replaces it ("Re-roll a sprite" below: `vlr art:gen` with
  a token, then `vlr art:approve -- id:N` for the new candidate, `vlr art:build`, `vlr check`).
- The sheets are committed under `art/contact/` (4× scale, nearest-neighbour). The candidate sheets the agent chose from
  (`art/contact/candidates-m5-…@4x.png` … `candidates-m9-…@4x.png`) and the raw candidates (`art/candidates/`) are
  gitignored and exist only on the build VM. In a running build, `?debug=1&view=gallery` (or `dist/gallery.html`) shows
  every frame.

### G4 — the four fixes (F2 slab, F3 bike, F4 hop, F5 port), made in M5

Sheet: **`art/contact/fixes@4x.png`** — the exterior t1 / t2 on the procedural slab at 2× with the footprint grid, the
eight bike frames and the bike beside the van and truck, the modern port as the map lays it out (colour and fogged), and
the hop cell (`node tools/art/contact.ts fixes --hop shots/city-hop-crop.png` fills it from the shots; in the game:
`shots/city-hop.png` in the shots zip, the pickup icon sinking into the bike).

| id               | What the agent picked                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `wh_ext`         | candidate 6: the corrugated shed with no apron (front corner on the 4×4 diamond); `_t2` = edit 1 (cream trim, a sign board) |
| `bike`           | candidate 6: a courier on an orange bicycle, white helmet, rear cargo box, 32×32, eight headings                            |
| `dk_terminal_a`  | candidate 2: container terminal with a reach-stacker and a control tower (on the old `dk_pier_1` spot)                      |
| `dk_terminal_b`  | candidate 1: ship-to-shore gantry base on rails, a reefer rack (on `dk_pier_2`)                                             |
| `dk_port_office` | candidate 0: glass-fronted port authority, radar mast, barrier gate (on the old `dk_customs` spot)                          |

```sh
vlr art:approve -- wh_ext bike dk_terminal_a dk_terminal_b dk_port_office
vlr art:reject -- bike "reason"          # one line per id you reject; same for the other four
```

`wh_ext` covers `_t1` and its `_t2` edit (one row). Already done with your reasons: `dk_pier` and `dk_customs` were
rejected and retired (`manifest.retired[]`). The slab (`lot_slab`, `lot_ramp`, `bollard`) and the hop sink are
procedural / code: no approval flag.

### G5 — the five live regions, made in M6–M9

Each sheet shows the region on its map window at the level it goes live, in colour, then the fogged `_locked` look it
has before, then each sprite close up.

| Region (level)                  | Sheet                        | ids                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semver Street, L4 (M6)          | `art/contact/lowres@4x.png`  | `lr_major_house` `lr_patch_bungalow` `lr_prerelease_villa` `lr_range_ranch_house` (2×2); `lr_caret_cottage` `lr_tilde_terrace` `lr_minor_cottage` `lr_exact_pin` `lr_wildcard_shop` `lr_buildmeta_bungalow` (1×1)                   |
| Pasture Peer Fields, L4 (M7)    | `art/contact/rural@4x.png`   | `ru_peer_pasture` `ru_dev_dairy` `ru_range_ranch` (3×3); `ru_optional_orchard` `ru_hay_barn` `ru_grain_coop` `ru_caret_mill` `ru_tilde_tractors` `ru_semver_stables` (2×2); `ru_farmhouse_once` (1×1)                               |
| Prefetch International, L5 (M8) | `art/contact/airport@4x.png` | `ap_terminal` (re-rolled for live quality) `ap_cargo_hangar` (3×3); `ap_tower` (prop); `ap_plane` (dock-prop)                                                                                                                       |
| Monorepo Commons, L5 (M8)       | `art/contact/civic@4x.png`   | `cv_town_hall` `cv_lint_school` `cv_museum` `cv_changelog_stadium` (re-roll: no townhouses) `cv_patch_hospital` (3×3); `cv_police` `cv_fire` `cv_readme_library` `cv_courthouse` (2×2); `cv_park_pavilion` (1×1); `fountain` (prop) |
| Shrinkwrap Shore, L3 (M8–M9)    | `art/contact/docks@4x.png`   | `dk_ship` (M9 re-roll: it now sails bow first); `dk_crane`, `dk_containers` (the two you kept in F5, never approved by id)                                                                                                          |

```sh
vlr art:approve -- lr_major_house lr_patch_bungalow lr_prerelease_villa lr_range_ranch_house lr_caret_cottage lr_tilde_terrace lr_minor_cottage lr_exact_pin lr_wildcard_shop lr_buildmeta_bungalow
vlr art:approve -- ru_peer_pasture ru_dev_dairy ru_range_ranch ru_optional_orchard ru_hay_barn ru_grain_coop ru_caret_mill ru_tilde_tractors ru_semver_stables ru_farmhouse_once
vlr art:approve -- ap_terminal ap_cargo_hangar ap_tower ap_plane
vlr art:approve -- cv_town_hall cv_lint_school cv_museum cv_changelog_stadium cv_patch_hospital cv_police cv_fire cv_readme_library cv_courthouse cv_park_pavilion fountain
vlr art:approve -- dk_ship dk_crane dk_containers
vlr art:reject -- ap_plane "reason"      # one line per id you reject
```

Things the agent would look at first: `ap_plane` has one heading and faces +x, across the runway (a plane rolling along
the runway needs a second heading, ≈ 12 generations); `ru_peer_pasture` keeps a thin earth rim on its front edges (all
three candidates drew the pasture as a raised island); `cv_museum`, `cv_changelog_stadium` and most new uniques carry
17–19 colours (lint A12 warnings, inside the 48-colour palette, as the playtest-1 buildings). The fence, hay bales and
runway threshold / taxiway tiles on these sheets are procedural.

### G6 — tiers, machines, people, made in M6–M9

Sheets: **`art/contact/tiers@4x.png`** (`wh_ext_t1` … `_t5` on the lot slab, tiers 3–5 with their bay lights and
docked poses), **`art/contact/g6-tiers-machines-people@4x.png`** (1× room mocks of tiers 3 / 4 / 5 at 14 / 16 / 18 rows,
every tier-4 / tier-5 piece, the four lane machines idle / scanning, the Sorter Arm's three frames, faces, pips and the
★, the station with the sorter, `worker` beside `worker_sorter`), **`art/contact/people@4x.png`** (faces, pips, ★, the
station, the three M6 machines) and **`art/contact/warehouse-tier3@4x.png`** (the tier-3 room and its docks).

| id                | What the agent picked                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `wh_ext_t3`       | candidate 1: red-orange brick depot, two hazard-striped bays with amber lamps, a two-storey office, a water tank |
| `wh_ext_t4`       | edit 0 of `wh_ext_t3`: grey steel cladding with blue bands, a third bay, a blue and yellow logo board            |
| `wh_ext_t5`       | candidate 2: white steel and glass HQ, a blue glass tower with gold trim, a pink neon parcel sign, a roof garden |
| `battery_checker` | candidate 0: grey arch, green charge-meter pillars, a battery on the header                                      |
| `xray`            | candidate 7 (M9 second re-roll): slim pillars under a dark header whose screen shows a parcel's x-ray outline    |
| `sorter_arm`      | candidate 0: orange column on a round pedestal, yellow segments, a two-finger claw (frames 1–2 scripted from it) |

```sh
vlr art:approve -- wh_ext_t3 wh_ext_t4 wh_ext_t5 battery_checker xray sorter_arm
vlr art:reject -- xray "reason"          # one line per id you reject
```

Procedural, so no approval flag (a "no" is a note for the next build, redrawn in `tools/art/*.ts`): the tier 3–5
interiors, the faces, pips and ★, `worker_sorter` (the inspector's frames with the vest swapped to orange),
`hold_station`, the neon strip. One open question from M5: the **inspector's eight scan frames** are scripted edits of
the PixelLab idle frames (the forearm raised with a handheld scanner). `vlr art:approve -- worker` says yes to them
and also confirms the G2 anchor below; for a no, write the reason down rather than `art:reject -- worker` (a reject
clears the anchor approval, so the next token run of `art:gen` would re-open the anchor pass and regenerate the
inspector).

### Still open from playtest 1 (G2 anchors, G3)

The agent-approved anchors and the playtest-1 sprites wait for you too (details in "Playtest 1" below; sheets
`art/contact/anchors@4x.png`, `anchors-incontext@4x.png`, `buildings-downtown@4x.png`, `buildings-highres@4x.png`,
`buildings-industrial@4x.png`, `vehicles@4x.png`, `scenery-locked@4x.png`):

```sh
vlr art:approve -- dt_scope_offices hr_async_arms in_esbuild_engines van worker metal_detector
vlr art:approve -- dt_registry_tower dt_semver_bank dt_peer_plaza dt_lockfile_legal dt_hoist_insurance dt_monorepo_media dt_tarball_hotel dt_cache_cafe dt_bundle_boutique dt_transpile_campus dt_yarn_tailors
vlr art:approve -- hr_towers_a hr_towers_b hr_callback_court hr_promise_place hr_event_loop_lofts hr_is_odd_store hr_rimraf_laundry hr_closure_coop hr_buffer_block hr_pizza hr_daycare
vlr art:approve -- in_lodash_smelting in_chalk_pigment in_tarball_packing in_gzip_compressors in_webpack_warehouse in_rimraf_yard in_minify_metal in_polyfill_plastics in_glob_silos
vlr art:approve -- tree_round tree_pine bush truck shaky_shaker
```

Eight playtest-1 finals still carry 1–42 px of pink key background (`dt_peer_plaza`, `dt_monorepo_media`,
`dt_tarball_hotel`, `dt_transpile_campus`, `in_lodash_smelting`, `in_chalk_pigment`, `in_tarball_packing`,
`in_gzip_compressors`; M5 notes below). The route to clear them is `vlr art:gen -- --reprocess --ids <id>` on the
build VM (it needs the raw downloads in `art/candidates/`) and then `vlr art:build`; untouched until you ask.

### Shipped procedural

- **No PixelLab id fell back to procedural** in build 2; every id got its candidates (`xray` and `dk_ship` were
  re-rolled in M9, `xray` twice).
- **Placeholders since playtest 1** (`placeholder: true`, the PixelLab candidates were rejected): `desk`, `shelf_t1`,
  `shelf_t2`.
- **Procedural by design, new in build 2** (59 ids, drawn by `tools/art/*.ts`, final unless you say otherwise):
  - city: `lot_slab` (3 variants), `lot_ramp`, `bollard`, `runway_threshold`, `taxiway`, `hay_bale`;
  - warehouse tiers 3–5: `floor_t3/t4/t5` (+ `_lane`), `wall_t3/t4/t5`, `wallface_t3/t4/t5`, `sign_t3/t4/t5`,
    `shelf_t3/t4/t5`, `props_t3/t4/t5`, `wanted_poster_t3/t4/t5`, `neon_strip`, `dock_pad`, `hold_station`,
    `station_outline`;
  - people: `face_00` … `face_11`, `ic_star`, `ic_pip_on`, `ic_pip_off`, `worker_sorter`;
  - quests and hubs: `ic_quest`, `ic_magic`, `magic_ring`, `ui_card_gold`, `ui_bar_fill_gold`, `ic_handoff`,
    `ic_cleared`, `ic_ship`, `ic_plane`.
  - Also redrawn or extended: `fx_dust` (one cloud per frame), `lamp_lock` (a fifth `lamp` frame), the m5x7 sheet's
    drawn glyphs (+ ★ and ✓). The logo is your own art (`source: 'author'`, not in an atlas).

### PixelLab spend (from `art/manifest.json` `batches[]`)

| Milestone   | Batches | Generations | Balance before → after | What                                                                           |
| ----------- | ------: | ----------: | ---------------------- | ------------------------------------------------------------------------------ |
| M5          |       7 |         126 | 3,299 → 3,173          | `wh_ext` (3 + two `_t2` edits), `bike`, `dk_terminal_a/b`, `dk_port_office`    |
| M6          |       3 |         207 | 3,173 → 2,966          | `battery_checker`, `xray`, `sorter_arm`; the ten Low-density uniques; a retry  |
| M7          |       3 |         276 | 2,966 → 2,690          | the ten Rural uniques; `wh_ext_t3`, `_t5`, `_t4` (two edits)                   |
| M8          |       1 |         220 | 2,690 → 2,470          | the Airport (4) and Park & civic (11) ids, 2 candidates each                   |
| M9          |       2 |          48 | 2,470 → 2,422          | re-rolls: `dk_ship`, `xray` (twice)                                            |
| M10         |       0 |           0 | —                      | none (as of the M10 docs)                                                      |
| **Build 2** |  **16** |     **877** | **3,299 → 2,422**      | 47 ids                                                                         |
| Build 3 M12 |       2 |         233 | 2,422 → 2,189          | the 13 `ev_pic_*` pictures + `victory_art` (3 each); `ev_pic_port` re-roll (4) |
| Playtest 1  |      25 |       1,700 | 5,000 → 3,300          | 66 ids                                                                         |

$0 in credits throughout (Tier 2 subscription generations only). The build-2 run budget was 1,500 generations with a
300 reserve (Q-B2-15 as set by the run prompt; `tools/art/gen.ts` `PIXELLAB_RUN_BUDGET` / `PIXELLAB_RESERVE`, counted
from `PIXELLAB_RUN_SINCE` 2026-10-30): 877 spent, 623 left. The balance read 3,300 at the end of playtest 1 and 3,299
when build 2 started (one generation outside any batch). Re-rolls after the run count against the same budget unless
you set those variables. Regenerate the table:

```sh
node -e "const m=require('./art/manifest.json');let t=0;for(const b of m.batches.filter(b=>b.at>='2026-10-30')){t+=b.generations;console.log(b.at.slice(0,16),b.generations,b.balanceBefore+'->'+b.balanceAfter,b.ids.join(' '))}console.log('build 2 total',t)"
```

## Build 2 — per-milestone notes (newest first; the agent's working record)

### Build 2 — M9 (L4 National + L5 Tycoon, plan-build2 §6 / §8.6, design-m8-m9 §6.1, §6.4, §8 lane F, B2 §4.2-§4.4, §6.6)

Sheets (G5 / G6, plan-build2 §6 approval gates):

- G5 regions, live in colour in context (`node tools/art/contact.ts lowres|rural|airport|civic`; the new
  `contact.ts contextScene` bakes the window as the city does at that level — `schema.ts groundAt` block grounds and
  accents, scenery, roads — with every building and prop in it, each district in colour once its `unlockLevel` ≤ the
  level and `_locked` otherwise): `art/contact/lowres@4x.png` and `rural@4x.png` at level 4,
  `airport@4x.png` and `civic@4x.png` at level 5, each followed by the fogged look before the unlock and the close-ups.
  `art/contact/docks@4x.png` (gallery) now draws `dk_ship` faint at 35 % / 70 % of its sail-out along `map.hubs` exit
  [-5, 0], so the bow-first departure is visible on the sheet.
- G6: `art/contact/tiers@4x.png` (`contact.ts tiers`: `wh_ext_t1` … `_t5` on the lot slab, tiers 3-5 with their bay
  lights / docked poses) and the new `art/contact/g6-tiers-machines-people@4x.png` (`contact.ts g6`): 1x room mocks of
  tiers 3 / 4 / 5 in the M9 geometry (14 / 16 / 18 rows, design-m8-m9 R2; slots 5-6 in the belt column, shelf and bin
  moved down 64 / 128, docks 2-3 owned from tier 4, the Sorter Arm in the station from tier 4, neon at tier 5), every
  tier-4 / tier-5 piece on its own floor (shelves at 80 / 100), the four belt machines idle / scan, the Sorter Arm f0-f2,
  faces / pips / the star, the station with the sorter, `worker` vs `worker_sorter`.

Atlas fill after M9: world 80.3 % (513 frames; 80.1 % after M8), interior 37.1 % (297 frames, 2048×512; 31.8 % after
M8). Under plan-build2 §8.8 R13's 90 % trigger (`tests/render/atlases.test.ts WORLD_FILL_R13`): no `city2` atlas, the
`_locked` twins stay per building. The L4 / L5 uniques, `wh_ext_t4` / `_t5`, `ap_plane`, `ap_tower`, `fence`,
`hay_bale`, `fountain` (+ `_locked`), `xray` and `sorter_arm_f0-f2` (`"atlas": "both"`) were already packed (M6-M8);
M9 adds 18 interior frames and 4 world tiles.

Procedural (by design, no PixelLab id; interior atlas, the room's back layers unless noted) — the frame names are the
contract for the warehouse lane (LaneRenderer `tierFrame` resolves `<stem>_t4` / `_t5` with no code change; only the
neon needs `tierParts(5)`):

- Tier 4 "National" (wh_ext_t4 from inside): `floor_t4` (charcoal anti-slip epoxy, 32-px joints with a lit bevel, grit
  specks), `floor_t4_lane` (+ the 2-px yellow lane lines at x 0-1 / 30-31), `wall_t4` (ribbed grey steel cladding with
  a blue band), `wallface_t4` (ribbed cladding, a blue band, a yellow kick rail), `sign_t4` (200×24: a cream face in a
  blue band, yellow chevron caps at x 4-7 / 192-195 outside the text area — dark text, `signDark` as t2 / t3),
  `shelf_t4` (high-bay racking on the shelf_t3 geometry: 20 × 5 @ 11 from canvas (3, 4), row tops grey5 / seams grey2,
  yellow uprights, blue beams), `props_t4` (48×64: a yellow forklift seen from behind with a pallet of blue totes on
  its forks), `wanted_poster_t4` (a steel notice board, the WANTED sheet for the L4 `dense` strain — a grey weight —
  with a yellow typosquat tag and a blue magnet).
- Tier 5 "Tycoon" (the glass HQ of wh_ext_t5): `floor_t5` (white terrazzo with pink / blue / yellow chips and a sheen
  streak), `floor_t5_lane` (pink lane lines), `wall_t5` (blue glass in white mullions from above), `wallface_t5` (glass
  panes over a white dado with a pink neon line), `sign_t5` (a white lightbox face in a dark board ringed by a pink
  neon tube with white-hot corners — dark text), `shelf_t5` (white gloss racking, same grid, chrome uprights, pink
  beams), `props_t5` (a potted palm and a small white delivery robot carrying a parcel), `wanted_poster_t5` (a MOST
  WANTED wall screen: the four strains' mugshots on a dark blue display, a pink status LED).
- `neon_strip_f0` / `_f1` (interior-prop 64×8, the `strip_light` canvas and spots `STRIP_LIGHTS`): tier 5 replaces the
  strip lights (B2 §6.6 "strip lights → neon"); f0 lit (white-hot core), f1 the dimmer flicker frame. Interior classes
  have no `water` / `gold` ramps (palette.ts RAMP_RULES), so the glass is the blue ramp and the trim pink / yellow.
- Runway themed tiles (plan-build2 §6 Airport; class `tile` + `_locked`, world): `runway_threshold` (white piano-key
  bars along the runway on its end rows) and `taxiway` (tarmac with a yellow taxi line along +x — the plane's exit — and
  blue edge lights). Not on the map until Lane A adds the `ground.scenery` rows (`contact.ts AIRPORT_M9_SCENERY`,
  drawn on `airport@4x.png`).
- Slots 5-6 need no new pieces: `belt_v`, `chute_v`, `slot_empty_outline` / `slot_locked_outline`, `ext_outline` +
  `ic_lock` cover the grown column and the `Slot 6 — unlocks at Lv 5` strip.

PixelLab (agent picks, `node tools/art/decide.ts --manifest`; `approved: false` until the author's gates):

- `dk_ship` #5 (M9 re-roll, `prompts.ts DOCK_PROP_HEADING`: "bow pointing to the upper left"): a red-hulled feeder with
  a block of blue / green / orange containers, bow to the upper left (-x, the hub exit [-5, 0]), white bridge at the
  stern nearest the viewer — it now sails bow first (the M5 pick pointed to the lower left and slid broadside).
  Rejected: #1 (the M5 pick), #3 (an anchor chain and buoy that would sail along), #4 (the longest hull, reads bigger
  than the quay).
- `xray` #7 (M9 re-roll, second round; `SUBJECT_OVERRIDES.xray` now asks for a screen on the header): slim pillars under
  a deep dark header whose wide screen shows a light-blue x-ray outline of a parcel (the scan frame turns it yellow), a
  radiation sticker on the left pillar; the belt opening holds (`OPENINGS.xray`). Rejected: #0 (the M6 pick, a plain
  arch), #5 (squashed, monitor cut off), #8 (a blank screen); #3, #4, #6 failed the belt-opening contract in the
  pre-filter.

PixelLab spend (M9 cap 150; run budget 1,500 / 300 reserve): 48 generations in 2 batches (`m9-rerolls` 33: dk_ship 3 +
xray 3; `m9-xray2` 15: xray 3), balance 2,470 → 2,422, $0 credits, run spent 829 → 877. No failed jobs; no PixelLab id
fell back to procedural.

The author's gates G4–G6: consolidated in "For the author" at the top of this file.

Follow-ups / for other lanes:

- Lane A (`src/data/map.json`, optional): the runway dressing rows, listed before "runway apron" (first match wins):
  `{"name": "runway north threshold", "rect": [45, 3, 47, 3], "frame": "runway_threshold"}`, `{"name": "runway south
  threshold", "rect": [45, 19, 47, 19], "frame": "runway_threshold"}`, `{"name": "taxi line", "rect": [44, 10, 44, 10],
  "frame": "taxiway"}`; and the fountain prop `{"frame": "fountain", "tile": [22, 41], "region": "civic"}` (all placed
  at the M9 integration, with `ap_plane`, `ap_tower` and the two `hay_bale` props).
- Lane C: tier 5 swaps `strip_light` for `neon_strip_f0` (f1 as an optional flicker) at `STRIP_LIGHTS`; every other
  tier-4 / tier-5 frame resolves through `tierFrame` as named above.
- Lane G: `dk_ship` and `xray` changed, so the shots that show them (docks-live, ship-departure, warehouse-tier4/5)
  change.
- The ship at its home tile (1, 29) now lies along the quay with its stern by Prefetch Pier 1's west corner; the
  departure moves it along its own axis.
- `ap_plane` still faces +x across the runway (which runs along y); a plane rolling along the runway would need a
  second heading sprite.

### Build 2 — M8 (L3 Regional, plan-build2 §6 / §8.5, design-m8-m9 §6.1-§6.4, B2 §4.1, §6.5, §6.6)

Sheets: `art/contact/warehouse-tier3@4x.png` (`node tools/art/contact.ts tier3`: room mocks t1 / t2 / t3 with the M8
dock geometry — dock 1 open, dock 2 bought with its roller pad, dock 3 locked —, the tier-3 pieces on the floor, the
shelf at 60 / 100, the overseas icons), `art/contact/docks@4x.png` (the gallery's docks sheet now opens with the port
on the map in colour, live at L3), `art/contact/airport@4x.png` and `art/contact/civic@4x.png` (`node
tools/art/contact.ts airport|civic`: the L5 uniques on their map positions in colour and as the `_locked` look they
ship with until M9, then each one close up), `art/contact/tiers@4x.png` (re-made: every bay's docked pose marked).
Atlas fill after M8: world 80.1 % (509 frames; 72.2 % after M7), interior 31.8 % (2048×512). Over the M5 target of 75 %
(`art:atlas` warns), under plan-build2 §8.8 R13's trigger (no pack / > 90 %), so the R13 fallback is not applied:
the `_locked` twins stay per building and there is no `city2` atlas. `tests/render/atlases.test.ts` now holds the
90 % line (`WORLD_FILL_R13`); M9 adds little to `world` (its exteriors, machines and the L4 uniques are already in).

Procedural (by design, no PixelLab id) — frame names are the contract for the warehouse lane:

- Tier 3 "Regional" room (interior atlas, the room's back layers): `floor_t3` (green epoxy, 32-px slab joints),
  `floor_t3_lane` (the same with the 2-px yellow lane lines at x 0-1 / 30-31, as `floor_t2_lane`), `wall_t3` (red brick
  between two grey copings), `wallface_t3` (red brick over a cream dado), `sign_t3` (200×24, a cream enamel face in a
  green band with rivets: a light board, so the sign text is the dark tint as at t2), `shelf_t3` (224×64 pallet
  racking: five wire-deck rows for the 20 × 5 @ 11 grid — minis at canvas (3 + 11c, 4 + 11r), i.e. room (35, 388) with
  the shelf at (32, 384), seam rows at y 14 + 11r, cell dividers at x 13 + 11c, blue uprights, the orange front beam at
  y 59-61), `props_t3` (48×64 like `props_t2`: a shrink-wrapped pallet of boxes and an orange pallet jack),
  `wanted_poster_t3` (32×32 corkboard: a WANTED sheet whose mugshot is the battery-strain parcel, a yellow sticky
  note), `dock_pad` (interior-prop 24×56, the roller pad of docks 2-3 at room (32, door.y): rollers across the
  northward flow, hazard ends; the six mini spots centred at (7|18, 11|27|43) = room (39|50, y + 11|27|43)).
- `lamp_lock` (a fifth frame of `lamp`, 8×8, world like the other lamps): a dim grey padlock for a dock the player does
  not own (DockView's three-lamp row; the design names `ic_lock` 8×8, which is a 16×16 icon).
- Overseas icons (icon16, both atlases): `ic_handoff` (a parcel with a padlock: the value is locked at the pier),
  `ic_cleared` (a round green customs stamp with a check), `ic_ship` (the Docks hub: a cargo ship), `ic_plane` (the
  Airport hub, used from M9: a plane from above). The design's popups are text (`LOCKED $18`, `CLEARED +$18`), so the
  icons are optional for the city / HUD lanes. The clearance ring reuses `ring_0` … `ring_8` (fx, both atlases).
- Per-bay docked poses (design-m8-m9 §6.2 `DOCK_POSES_CANVAS`): `frames.generated.ts WH_ANCHORS` rows carry
  `dockPoses` (one per bay light, `[0]` = `dockPose`); a manifest row may list them (`dockPoses`, validated), else
  `manifest.ts dockPosesOf` derives bay k as `dockPose + (bayLights[k] − bayLights[0])` — the vehicle keeps bay 1's place
  relative to its own lamp. t1 (4, 166) (31, 180) (58, 195); t2 (4, 166) (32, 180) (59, 194); t3 (4, 185) (42, 205); t4
  (4, 186) (32, 201) (61, 213); t5 (6, 192) (24, 203) (43, 213).
- Unchanged and reused: `dock_door_{closed,open,locked}`, `dock_tail_*`, `lamp_*`, `bay_pad` (bays 4-5),
  `strip_light` (t2-t4), the runway tiles `tarmac`, `runway`, `runway_stripe` (+ `_locked`).

PixelLab (agent picks, `node tools/art/decide.ts --manifest`; `approved: false` until the author's gate G5; shipped
`_locked` until M9, one row per `buildings.json` id, no `coversBuildings`):

- `ap_terminal` #4 (re-roll for live quality: a terminal under a sweeping white wave roof over a blue glass front, two
  jet bridges, a row of flags; no tower — `ap_tower` is its own prop), `ap_cargo_hangar` #0 (barrel-vault hangar, an
  orange checkered band, open doors with blue and orange containers, a blue office box).
- `ap_tower` #1 (prop: slim white tower, wide blue glass cab, radar dish), `ap_plane` #1 (dock-prop 128×96: a white
  jet with a blue tail, nose to the lower right — it taxis east along +x, `prompts.ts DOCK_PROP_HEADING`).
- `cv_town_hall` #0 (colonnade, clock tower with a green copper dome and a flag), `cv_lint_school` #0 (brick school,
  bell cupola, a yellow schoolyard with a climbing frame and a slide), `cv_museum` #1 (glass pyramid, banners, a T-rex
  skeleton on the lawn), `cv_changelog_stadium` #0 (re-roll, report §6.25: blue and yellow stands round the pitch,
  floodlights, nothing else on the plot — no townhouses), `cv_patch_hospital` #0 (white and blue block, rooftop
  helipad, green cross, striped canopy).
- `cv_police` #1 (dark blue, white trim, flag, radio antenna), `cv_fire` #0 (orange brick, two open bays with the fire
  engine, a hose tower; `VEHICLE_OK`), `cv_readme_library` #1 (sandstone, arched windows, a big open-book sculpture,
  two lions), `cv_courthouse` #0 (four columns, the yellow scales on top), `cv_park_pavilion` #0 (white bandstand,
  green cone roof, flower beds), `fountain` #0 (prop: a blue basin and a tiered column with a tall jet).
- Retired (`decide.ts --retire … --reason`, finals deleted, provenance in `manifest.retired[]`): `ap_hangar`,
  `cv_hall`, `cv_stadium`, `cv_civic_2x2` (also the playtest-1 G2 civic anchor: `prompts.ts DISTRICT_ANCHOR` now lends
  civic / rural / map `hr_async_arms`, used only by `--style anchor`), `cv_pavilion` — the shared locked-only scenery.

PixelLab spend (M8 cap 260 incl. re-rolls; run budget 1,500 / 300 reserve): 220 generations in one batch (`--batch
m8-l5`, 2 candidates per id, Q-B2-15 rule for L5; balance 2,690 → 2,470; $0 credits; run spent 609 → 829). No failed
jobs, no pre-filter rejects, no re-rolls; no PixelLab id fell back to procedural.

Follow-ups:

- M9 map rows (Lane A): `ap_plane` at (45, 10) and `ap_tower` at (44, 16) as design-m8-m9 §1.2 lists them (both
  shown there on `airport@4x.png`); the `fountain` prop is not on the map — `civic@4x.png` shows it at the suggested
  tile (22, 41) in the park block beside the pavilion.
- `ap_plane` faces +x (the exit of §1.2), i.e. across the runway, which runs along y; a plane rolling along the runway
  would need its own heading sprite (≈ 12 generations) and an exit along ±y.
- `dk_ship`'s bow points to the lower left (+y) while its `map.hubs` exit is [-5, 0] (−x, upper left): the departure
  tween slides it broadside. A bow-first exit would run along +y (or a second ship heading, ≈ 12 generations).
- `cv_museum` and `cv_changelog_stadium` carry 17 colours (lint A12 warnings, as the other uniques).

### Build 2 — M7 (quests, plan-build2 §6 / §8.4, design-m7 §6.1, §6.9, B2 §3, §6.5, §6.6)

Sheets: `art/contact/rural@4x.png` (`node tools/art/contact.ts rural`: the ten Rural uniques on their map
positions, colour and the `_locked` look they ship with until M9, then each unique and the fence / hay_bale props
close up) and `art/contact/tiers@4x.png` (`node tools/art/contact.ts tiers`: `wh_ext_t1` … `_t5` on the lot slab,
then tiers 3-5 at 2x with the footprint grid and their manifest bay lights / dock pose marked). Atlas fill after
M7: world 72.2 % (486 frames; 61.7 % after M6, target ≤ 75 %, R13 trigger 90 % / no pack), interior 29.0 %
(2048×512) — plan-build2 §8.8 R13 fallback not needed (the `_locked` twins stay per building).

Procedural (by design, no PixelLab id; every one packed into `world` — the HUD and `src/ui/**` bind world only):

- `ic_quest` (icon16): the job board — a brown clipboard with a cream sheet and a gold ★ (QuestCard masthead, the
  HUD quest chip, the district panel's quest row, the newspaper's quest picture).
- `ic_magic` (icon16): the golden parcel at 16 px — gold box, pink ribbon and bow, one grey5 sparkle pixel on the
  lid, the look of `parcel_s_magic` (which already reads gold: its body is the gold ramp with the pink ribbon).
- `ui_card_gold` (ui 16×16 nine-slice, 4 px corners): `ui_panel` inside a 2-px gold border (gold2 lit top/left,
  gold0 bottom/right, gold1 inner ring) — the ultimate / complete QuestCard and the VictoryCard.
- `ui_bar_fill_gold` (ui 8×8, 3-slice): the quest progress fill, `ui_bar_fill_*` geometry in the gold ramp.
- `magic_ring_0…3` (fx 16×16): the magic parcel's countdown, `rush_ring` geometry in the gold ramp.
- m5x7 `★` (U+2605, `font.ts DRAWN`, 7×7 at cap height, advance 8): the ticker's star-applicant line. The M6
  comment "m5x7 has no ★ glyph" (`src/ui/Newspaper.ts`) is out of date.
- `hay_bale` (prop 64×128 + `_locked`, rural): three square straw bales with twine bands, the prop rule of `fence`.
  Not placed on the map yet (`map.json` props are data; suggested tiles in the M7 report).
- Stand-ins for the tier exteriors (`exterior.ts drawTierExt`, apron-less so they pass A04 strict): shown only for a
  tier row without a chosen candidate.
- Not made (the design does not need them): new life-slot frames (slots 4-5 blink `ic_life_on` / `ic_life_off`).

PixelLab (agent picks, `node tools/art/decide.ts --manifest`; `approved: false` until the author's gates G5 / G6):

- Rural uniques (Pro Flash, 3×3 = 9, 2×2 = 6, 1×1 = 5 per candidate), one per `buildings.json` id, shipped
  `_locked` until M9: `ru_peer_pasture` #0 (fenced cow pasture, three cows, small orange gambrel barn, blue
  trough), `ru_dev_dairy` #0 (white barn with big black cow spots, spotted milk silo, steel churns),
  `ru_range_ranch` #0 (log ranch house, round white-rail corral, wooden gate arch), `ru_optional_orchard` #2 (rows
  of fruit trees, striped-awning fruit stand), `ru_hay_barn` #2 (orange gambrel barn, open hayloft, round bales),
  `ru_grain_coop` #0 (three corrugated silos, yellow grain elevator, blue office), `ru_caret_mill` #0 (white
  windmill with lattice sails, flour shed), `ru_tilde_tractors` #1 (open garage with the green tractor, yellow sign
  board, tyres), `ru_semver_stables` #2 (horse heads in the half doors, green roof, cupola, rooster weathervane),
  `ru_farmhouse_once` #0 (white farmhouse, steep orange roof, porch, brick chimney). Prompts: `ru_peer_pasture`,
  `ru_range_ranch`, `ru_optional_orchard` are GROUP_SUBJECTS; `ru_tilde_tractors` drops CITY_SUFFIX's "no
  vehicles" (`prompts.ts VEHICLE_OK`: the tractor is its unique feature).
- Retired (`decide.ts --retire … --reason`, finals deleted): `ru_farm`, `ru_barn`, `ru_orchard`, `ru_farmhouse` —
  the shared Rural scenery, replaced by the ten uniques.
- Warehouse exteriors (warehouse-ext 256², no apron, A04 strict), rows of their own (`wh_ext_t3`, `_t4`, `_t5`,
  frame name = id; `wh_ext` keeps `_t1` / `_t2`); unused until M8 (t3) / M9 (t4, t5):
  `wh_ext_t3` #1 (red-orange brick depot, two open hazard-striped bays with an amber lamp each, a two-storey brick
  office with tall white windows at the front corner, rooftop water tank), `wh_ext_t4` = edit 0 of `wh_ext_t3` #1
  (`prompts.ts EDIT_OF`: grey steel cladding with blue bands, a third open bay with its lamp, a blue and yellow logo
  board on the roof edge; same footprint, office and tank), `wh_ext_t5` #2 (white steel and glass HQ, a blue glass
  tower with gold trim at the front corner, a pink neon parcel-box sign on a dark board, rooftop garden, three bays
  with lamps). Unlike t1 / t2 (a long shed whose west end overhangs the dock column), the three fill the 4×4
  footprint. Manifest anchors (frames.generated `WH_ANCHORS`, cityFx `warehouseAnchors(frame)`): t3 bayLights
  (23, 128), (61, 148), dockPose (4, 185); t4 (19, 133), (47, 148), (76, 160), dockPose (4, 186); t5 (18, 156),
  (36, 167), (55, 177), dockPose (6, 192) — each light on an amber (orange2 / yellow1) lamp pixel
  (tests/art/m5-art.test.ts), the docked pose ~6 px left of and ~9 px below bay 1's door base, as t1's. t3 has
  two lights: CityScene creates one light per tier-1 bay (3) and re-uses the last point for a missing one (M8 to
  hide the third at t3).

PixelLab spend (M7 cap 300, run budget 1,500 / 300 reserve): 276 generations in 3 batches (balance 2,966 → 2,690;
$0 credits; run spent 333 → 609): Rural 204 (30 of 30 candidates, `--batch m7-rural`), `wh_ext_t3` + `_t5` 54 (3
candidates each, `m7-tiers`), `wh_ext_t4` 18 (2 edits, `m7-t4`). No failed jobs, no re-rolls; every id got its
full candidate count; no PixelLab id fell back to procedural.

Follow-ups: the Rural finals carry 17-18 colours (lint A12 warnings, as the Low-density ones) and `wh_ext_t5` 17.
`ru_peer_pasture` #0 keeps a thin earth rim on the plot's front edges (all three candidates drew the pasture as a
raised island; #0's is the thinnest). The `hay_bale` prop is not on the map (`src/data/map.json` props). The
dock tiles (map `lot.docks`) and the docked pose were laid out for the t1 shed, whose west end overhangs the dock
column; t3-t5 stand inside the 4×4 footprint with their bays at its west end, so M8 / M9 re-check the docked vehicle
against them on the city (the poses above follow t1's door-relative offset).

### Build 2 — M6 (people, plan-build2 §6 / §8.3 task 8, B2 §2.6, §6.5, §6.7)

Sheets: `art/contact/people@4x.png` (`node tools/art/contact.ts people`: faces, ★, pips, worker vs worker_sorter,
the Hold Bay station with the sorter on duty, the three new machines) and `art/contact/lowres@4x.png` (`node
tools/art/contact.ts lowres`: the ten Low-density uniques on their map positions, colour and the `_locked` look
they ship with until M9, plus each unique close up). Atlas fill after M6: world 61.7 % (target ≤ 75 %), interior
28.8 % (2048×512).

Procedural (by design, no PixelLab id):

- `face_00` … `face_11` (icon16, `tools/art/faces.ts`): NN = skin × 4 + hair — peach / tan / deep skin × short
  dark hair, long auburn hair, blue cap, yellow hard hat; the shirt colour is seeded per id. The sim's
  `Employee.look` / `Applicant.look` (people.ts `FACE_LOOKS = 12`) index them. Packed into both atlases (icon16).
- `ic_star` (icon16, gold) — the ★ mark drawn top-right of a face (a separate icon, not a face overlay variant).
- `ic_pip_on` / `ic_pip_off` (ui 8×8, world atlas): a 6×6 dot at (1, 1), lit = yellow3 + ink outline, empty = a
  grey2 ring on a grey4 socket; drawn at a 7-px pitch.
- `worker_sorter` (class worker, 28 frames): every `worker` final with the vest's yellow ramp swapped to orange step
  for step (`variants.ts SORTER_SWAP`, drawn from the worker finals by `warehouse.ts`; lint A14 re-draws it, so a
  `worker` final changed without a rebuild is caught). Packed into both atlases.
- `hold_station` (interior-prop 48×48, interior atlas): rubber mat with painted corner marks, a standing desk with
  the clipboard and the roll of green `looks clean` tags on its west half; the east half stays clear for the
  sorter's stand point.
- Procedural stand-ins also exist for `battery_checker`, `xray`, `sorter_arm` (shown only without a chosen
  candidate). Not made (the design doc does not use them): `ic_helmet`, `ui_pip_bar`.

PixelLab (agent picks, `node tools/art/decide.ts --manifest`; `approved: false` until the author's gate G6 / G5):

- Machines (Pro Flash 48² / 64², 5 per candidate): `battery_checker` #0 (grey arch, green charge-meter pillars, a
  battery with its terminal nub on the header), `xray` #0 (boxy light-grey tunnel with depth, purple trim, a dark
  blue monitor on the right wall), `sorter_arm` #0 (orange column on a round pedestal, yellow segments, a big
  two-finger claw). The checkers keep the detector's belt-opening contract (`candidates.ts OPENINGS`, x 12..35 empty
  below row 16) and its idle/scan header strip (f0 blue / f1 yellow). The arm's `_f1` / `_f2` are scripted from the
  one image (`candidates.ts SWING_IDS` / `lean`: the upper ~60 % sheared 3 px toward −x = reach, +x = toss; the
  pedestal stays) — M9 draws it and may replace the swing.
- Low-density uniques (Pro Flash, 2×2 = 6, 1×1 = 5 per candidate), one per `buildings.json` id (no
  `coversBuildings`: each id covers itself), shipped `_locked` until M9: `lr_major_house` #2 (round corner turret),
  `lr_patch_bungalow` #1 (patchwork roof, porch), `lr_prerelease_villa` #0 (scaffolding wing, brick pallet),
  `lr_range_ranch_house` #0 (long low ranch, picket fence, windmill), `lr_caret_cottage` #1 (steep purple A-frame),
  `lr_tilde_terrace` #0 (wavy roof edge, blue striped bay), `lr_minor_cottage` #0 (thatch, round window),
  `lr_exact_pin` #2 (orange ball finial like a map pin), `lr_wildcard_shop` #0 (striped awning, star sign),
  `lr_buildmeta_bungalow` #2 (solar-panel roof, satellite dish).
- Retired (`manifest.retired[]`, finals deleted; `decide.ts --retire … --reason`, new in M6 for superseded rows that
  nobody rejected): `lr_house_a`, `lr_house_b`, `lr_house_c`, `lr_villa` — replaced by the ten uniques.

PixelLab spend (M6 cap 230, run budget 1,500 / 300 reserve): 207 generations in 3 batches (balance 3,173 → 2,966;
$0 credits; run spent 126 → 333): machines 35 (7 of 9 jobs; 2 failed "heavy load", not billed), Low-density 150
(28 of 30), a retry of the 4 failed jobs 22 (battery_checker #3, xray #2, lr_major_house #3, lr_prerelease_villa
#3 — none beat the picks; xray #2 failed the belt-opening contract). Every id got 3 candidates except `xray` (2
usable). No PixelLab id fell back to procedural.

Follow-ups: the new Low-density finals carry 17-19 colours (lint A12 warnings, as the playtest-1 buildings); the
`worker_sorter` walk/scan frames inherit the worker's 17-18. `xray` reads more as an arch with depth than a closed
tunnel because the belt opening is cleared below row 16 — re-roll at G6 if the author wants curtains (they would
have to stay above row 16).

### Build 2 — M5 (the author's four fixes, plan-build2 §6 / §8.2, B2 §6.1-§6.4)

G4 sheet: `art/contact/fixes@4x.png` (`node tools/art/contact.ts fixes [--hop <crop.png>]`): the exterior t1 / t2 on
the slab tiles at 2x (with a footprint-grid overlay), the eight bike frames and the bike beside the van and truck at 4x,
the docks as the map lays them out (colour and the `_locked` look they ship with until M8), and the hop cell (the
orchestrator adds the crop from shots).

What changed:

- **F2 warehouse foundation.** `wh_ext_t1` regenerated without its own apron (Pro Flash 256², keyed background, "no
  ground, no pavement, no lot, no apron"; candidates.ts `processExterior`: the walls' bottom vertex on the anchor, nothing
  kept below the diamond edges, no ground diamond painted, no shadow strip). Pick: candidate 6 (front corner and SE base on
  the diamond's bottom and right vertices; the SW face is set back so the slab shows as the loading apron before the bays).
  `wh_ext_t2` = `edit-image-pro-flash` edit 1 of it (`editPick: 1`). Lint A04 is strict for `warehouse-ext`
  (`iso.ts exteriorBaseOk`). The slab is procedural ground-bake art: `lot_slab_a/b/c`, `lot_ramp`, `bollard_a/b`.
  The bay-lamp and docked-vehicle anchors moved and are manifest data now: `wh_ext.bayLights` (21, 106), (48, 120),
  (75, 135) and `dockPose` (4, 166), with the `_t2` override in `frameAnchors` (manifest.ts `warehouseAnchorTable` →
  `WH_ANCHORS` in frames.generated.ts, which cityFx reads).
- **F3 bike.** Canvas 24² → 32² (Q-B2-14); a courier on a bicycle with a white helmet, orange frame and a rear cargo box
  (create-object-pro-flash, 8 directions at 28 px). Pick: candidate 6. Second wheel frame = the 1-px hub shift as before.
  The foot point is manifest data now (`foot`: bike (16, 26), van (16, 23), truck (24, 22)); STYLE.md rule 6 amended
  (the rider is the one person a vehicle shows). The procedural stand-in is a bicycle + helmeted rider too.
- **F5 modern port.** `dk_pier` ("medieval timber pier") and `dk_customs` ("victorian customs house") rejected by the
  author's reasons and retired (`manifest.retired[]`, finals deleted). New rows `dk_terminal_a` (reach-stacker, control
  tower; covers `dk_pier_1`), `dk_terminal_b` (ship-to-shore gantry base on rails, reefer rack; covers `dk_pier_2`) and
  `dk_port_office` (glass front, radar mast, barrier gate; covers `dk_customs`), each with its `_locked` twin; they ship
  fogged until M8. Picks: terminal_a #2, terminal_b #1, port office #0. Keyed candidates now also lose enclosed key
  pockets (`clearKeyPockets`: the magenta between the gantry legs used to quantize to pink).
- **§6.23 `fx_dust`.** One cloud per frame over the whole exterior: 256×224 frames placed like `wh_ext`
  (`setOrigin(0.5, 1)` at the lot's footprint anchor) — scaffold rising from a dust skirt, the cloud engulfing the
  building, the cloud settling, the reveal (a low wisp + sparkles). Each cloud is one mass shaded as one body.
- **§6.24 worker scan frames.** Scripted edits of the PixelLab idle frames (`candidates.ts scanPose`, from the raw
  downloads, no generations): the forearm raised to chest height holding a handheld scanner (east / west toward the belt,
  south in both hands), the lamp yellow → red on frame 1; north = the idle back view. Same height as idle — the inspector
  no longer sinks behind the desk. Chosen over a PixelLab custom animation because template / v3 frames come at a
  different scale than the idle frames (playtest 1: ~20 % smaller), which would make the inspector jump between poses.
- **Logo.** Manifest row `logo` (class `logo`, `source: 'author'`, 352×176): `tools/art/logo.ts` writes
  `src/assets/logo.png`; lint checks only its size and that it is non-blank there (A01/A02/A07 exempt); never packed.
- **Atlas field.** Optional `atlas: 'world' | 'interior'` on manifest rows (validated; the packer falls back to a class
  default; class `logo` is never packed — `isAtlasPacked`).

PixelLab spend (M5, build-2 run budget 1,500 with a 300 reserve, counted from 2026-10-30 by `gen.ts runSpent`):
126 generations in 7 batches (balance 3,299 → 3,173; $0 credits): `wh_ext` 3 candidates (27) + 2 `_t2` edits (18),
`bike` 3 candidates (18), `dk_terminal_a` 3 (27), `dk_terminal_b` 2 (18), `dk_port_office` 3 (18) — under the M5 cap
of 250. PixelLab answered "Generation failed due to heavy load" on 20 of 36 jobs during the run; failed jobs were not
billed and were retried in later batches (`dk_terminal_b` stopped at 2 candidates: #1 was clearly good).

Shipped procedural in M5 (by design, no PixelLab id): `lot_slab`, `lot_ramp`, `bollard`, `fx_dust`, the worker scan
frames (scripted). No PixelLab id fell back to procedural.

Follow-ups for the author / later milestones:

- The new exterior is a long shed: its west end reaches about tile x 20.2, over the dock column, and door 1 (open) faces
  the dock tile (20, 24). Doors 2-3 face (21, 24) and (22, 24) on the slab apron — the docks of M8/M9 (map.json
  `lot.docks` lists (20, 23), (20, 22), which lie under the building's west end).
- `wh_ext_t2`'s bay lamps sit 5-6 px right of t1's for bays 2-3 (`frameAnchors._t2`: (26, 107), (54, 121), (81, 135),
  re-measured in the M5 review: the first set put bays 2-3 on the blue wall). CityScene re-places the lights and the
  docked-vehicle pose on every tier swap (`warehouseAnchors(frame)`), so each tier's own set applies;
  tests/render/cityFx.test.ts checks every `WH_ANCHORS` light is within 2 px of an amber lamp pixel of its frame.
- **Author check: the worker's 8 scan frames** (`worker_{s,n,e,w}_scan_{0,1}`, M5, scripted from the idle frames) changed
  the `worker` final set. Its `approved: true, approvedBy: 'agent'` is the G2 anchor approval of the PixelLab frames and
  stays (resetting it would make the next token run of `art:gen` re-open the anchor pass and regenerate the worker);
  the scan frames themselves are not covered by it and wait for the author's yes / no (`manifest` note on the row).
- **Pink specks in 9 playtest-1 finals** (M5 review): `dt_peer_plaza`, `dt_monorepo_media`, `dt_tarball_hotel`,
  `dt_transpile_campus`, `in_lodash_smelting`, `in_chalk_pigment`, `in_tarball_packing`, `in_gzip_compressors`,
  `ru_farm` keep 1-42 px of enclosed key background that quantized to pink (`#d4567c`). M5's `clearKeyPockets` would
  clear them, but only a deliberate `vlr art:gen -- --reprocess --ids <id>` followed by a `gen` step re-installs those
  finals (`installChosen`), so the shipped art is unchanged until the author picks that. Pocket clearing now applies
  only to a requested key colour (magenta to dusty pink, or cyan: `isRequestedKey`); a background the model chose
  itself is border-flooded only, so its colour inside the sprite stays.
- The procedural `wh_ext` stand-in (`exterior.ts`) still paints its own apron; it is never shipped while the generated
  finals exist.
- Tiers 3-5 exteriors (M8/M9) follow the same recipe: the no-apron prompt + `processExterior` + A04 strict.

## Playtest 1 (the M4 state; superseded lines are marked)

What the author still has to confirm or replace in the art, from `art/manifest.json` (234 ids: 168 procedural by
design, 66 PixelLab-class) and the review notes in docs/status.md, docs/decisions.md and the agent's vision pass
(`art/candidates/choices.json`, local to the VM). The contract is art/STYLE.md; the gates are plan.md §10 (G1 palette,
G2 anchors, G3 category sheets). Status as of the M4 build; regenerate the lists with the one-liner at the end.

PixelLab spend: 1,700 generations in 25 batches, $0 in credits (Tier 2 subscription; balance 5,000 → 3,300), against
a 2,500-generation run budget.

### Procedural placeholders still in use (`placeholder: true`)

The PixelLab candidates for these three were rejected in the vision pass and the procedural drawings kept
(`vlr art:lint` warns `A12 3 placeholder sprites in use`):

| id         | class                | why it stayed procedural                                                                                                                                                |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desk`     | fixture-desk 48×32   | Transparent candidates drew 26-px stools; keyed ones carried a lamp/magnifier poking out of the silhouette. The placeholder reads at 1× (paper, magnifier, red button). |
| `shelf_t1` | fixture-shelf 224×64 | The shelf must carry the in-engine mini parcels on x 6..221 / y 6..39; generated shelves were 158–195-px front views, and stretched the minis float above the boards.   |
| `shelf_t2` | fixture-shelf 224×64 | Tier 2 must keep `shelf_t1`'s geometry (the edit recipe needs a generated `shelf_t1`).                                                                                  |

The other 168 procedural ids (ground and road tiles, lot, parcels, icons, UI nine-slices, fx, interior floor/belts,
signs, the m5x7 glyph sheet) are procedural by design and final; they are listed on `art/contact/procedural@4x.png`.

### G2 — anchors approved provisionally by the agent (`approvedBy: 'agent'`)

These were the style anchors of the bulk pass; confirm each (or reject it, which re-opens everything styled after it):
`art/contact/anchors@4x.png`, `art/contact/anchors-incontext@4x.png`.

| id                   | class       | district                                                            |
| -------------------- | ----------- | ------------------------------------------------------------------- |
| `dt_scope_offices`   | building2x2 | downtown                                                            |
| `hr_async_arms`      | building2x2 | highres                                                             |
| `in_esbuild_engines` | building2x2 | industrial                                                          |
| `cv_civic_2x2`       | building2x2 | civic (locked scenery; retired in build 2 M8 for the civic uniques) |
| `van`                | vehicle-van | —                                                                   |
| `worker`             | worker      | warehouse                                                           |
| `metal_detector`     | machine     | warehouse                                                           |

Confirm: `vlr art:approve -- dt_scope_offices hr_async_arms in_esbuild_engines van worker metal_detector`
(sets `approvedBy: 'author'`; no image changes).

### G3 — generated sprites awaiting the author's confirmation (`approved: false`)

56 ids, each with the agent's chosen candidate installed as the final. Review them on the category sheets
(`art/contact/buildings-downtown@4x.png`, `buildings-highres@4x.png`, `buildings-industrial@4x.png`,
`scenery-locked@4x.png`, `docks@4x.png`, `vehicles@4x.png`, `warehouse-exterior@4x.png`,
`warehouse-interior@4x.png`, `city-sample@4x.png`) and in the game.

- **Downtown** (P0): `dt_registry_tower`, `dt_peer_plaza`, `dt_monorepo_media`, `dt_tarball_hotel`,
  `dt_transpile_campus` (3×3); `dt_semver_bank`, `dt_lockfile_legal`, `dt_hoist_insurance` (2×2); `dt_cache_cafe`,
  `dt_bundle_boutique`, `dt_yarn_tailors` (1×1).
- **High-density residential** (P0): `hr_towers_a`, `hr_towers_b` (3×3); `hr_callback_court`, `hr_promise_place`,
  `hr_event_loop_lofts`, `hr_closure_coop`, `hr_buffer_block`, `hr_daycare` (2×2); `hr_is_odd_store`,
  `hr_rimraf_laundry`, `hr_pizza` (1×1).
- **Industrial** (P1, live from L2): `in_lodash_smelting`, `in_chalk_pigment`, `in_tarball_packing`,
  `in_gzip_compressors`, `in_minify_metal` (3×3); `in_webpack_warehouse`, `in_rimraf_yard`, `in_polyfill_plastics`,
  `in_glob_silos` (2×2).
- **Locked scenery** (playtest 1 shows only the fogged `_locked` frame): `lr_house_a`, `lr_house_b`, `lr_house_c`,
  `lr_villa` (all four retired in build 2 M6 for the ten Low-density uniques), `ru_farm`, `ru_barn`, `ru_orchard`, `ru_farmhouse`, `dk_pier` and `dk_customs` (both rejected by the
  author and retired in build 2 M5), `ap_terminal` (re-rolled in build 2 M8),
  `ap_hangar`, `cv_hall`, `cv_stadium`, `cv_pavilion` (the last four retired in build 2 M8 for the L5 uniques).
- **Docks and map props**: `dk_crane`, `dk_ship`, `dk_containers`, `tree_round`, `tree_pine`, `bush`.
- **Vehicles, warehouse, machines**: `bike`, `truck`, `wh_ext` (`_t1` + its `_t2` edit), `shaky_shaker`.

Confirm a category in one line, e.g. `vlr art:approve -- dt_registry_tower dt_peer_plaza …`; reject one with the
re-roll below.

### Art notes from the run (author to judge)

- (superseded in build 2 M5: a courier on a bicycle, 32×32) **`bike` is a scooter.** The chosen candidate is a narrow orange delivery scooter (the van's tool,
  `create-object-pro-flash` at 24×24): the real cargo bicycles came out 24 px tall and broke the 1-px margin (lint
  A05), the 20-px re-rolls read as a cart or a quad. Gameplay calls it a bike everywhere.
- **`cv_stadium` sits among townhouses.** All three candidates surrounded the pitch with townhouses; acceptable while it
  is fogged (playtest 1 ships only `cv_stadium_locked`). Re-roll for build 2, when Civic unlocks.
- (superseded in build 2 M5: scripted arm-raised scan frames) **`worker` scan frames** come from PixelLab's picking-up template (bend/crouch; the east/west frames hold a parcel),
  not an arm-raised scanner, so the inspector may sink behind the desk while scanning; the sprite is ~25 px tall
  against the 20-px placeholder it replaced.
- (superseded in build 2 M5: one cloud per frame) **`fx_dust`** (procedural, the level-up construction burst) reads as a field of separate puffs rather than one
  dust cloud (a jittered grid of 32×32 puffs over the exterior; no `setScale` on world art). Redraw in
  `tools/art/fx.ts` if it bothers you.
- **A12 colour warnings** (> 16 colours in one sprite; warnings, not errors — `vlr art:lint` reports 19 with the
  placeholder line): `dt_cache_cafe`, `dt_scope_offices`, `dt_bundle_boutique`, `dt_yarn_tailors`,
  `hr_promise_place`, `hr_is_odd_store`, `hr_pizza`, `hr_daycare`, `in_gzip_compressors`, `lr_house_a`, `lr_house_c`,
  `lr_villa`, `cv_civic_2x2`, `dk_containers`, `wh_ext_t2`, `worker_s_walk_0`, `worker_s_walk_1`, `props_t2`
  (17–20 colours each: multi-material sprites, all inside the 48-colour palette).
- `in_lodash_smelting` was re-rolled once with "chimneys without any smoke or steam" (the first candidates baked smoke
  over the `fx_smoke` emitters); watch the other Industrial chimneys for the same.

## Re-roll a sprite

Needs `PIXELLAB_TOKEN` in the gitignored `.env` (plan.md §10). Candidate numbers continue after the ones on disk and
`seed = base + candidate`; `art/candidates/` is gitignored, so on a fresh clone pass a new `--seed` base or the first
candidates come back identical. The build-2 budget guard still applies (1,500 generations counted from 2026-10-30, 877
spent, a 300 reserve under the balance); `PIXELLAB_RUN_BUDGET`, `PIXELLAB_RUN_SINCE` and `PIXELLAB_RESERVE` in the
environment change it without a code edit.

```sh
vlr art:reject -- ap_plane "faces across the runway"   # logs the reason, clears the pick (the image stays until replaced)
vlr art:balance                                         # the PixelLab balance
vlr art:gen -- --ids ap_plane --n 3 --seed 5000         # 3 new candidates (budget guard: GET /balance first)
# look at the contact sheet gen prints (art/contact/candidates-*@4x.png), then pick one, e.g. candidate 3:
vlr art:approve -- ap_plane:3                           # id:candidate → installed as the final by art:build
vlr art:build                                           # install → normalize → … → lint → atlas → gallery (offline)
vlr check
```

A procedural id (`fx_dust`, `desk`, `shelf_t1`, `face_03`, `floor_t5`, …) is redrawn by its generator in
`tools/art/*.ts` and picked up by `vlr art:build`; no token needed.

## Regenerate these lists

```sh
node -e "const m=require('./art/manifest.json');const p=(f)=>m.entries.filter(f).map(e=>e.id).join(' ');console.log('placeholder:',p(e=>e.placeholder));console.log('G2 agent:',p(e=>e.approvedBy==='agent'));console.log('awaiting the author (G3-G6):',p(e=>e.source==='pixellab'&&!e.approved&&!e.placeholder))"
```
