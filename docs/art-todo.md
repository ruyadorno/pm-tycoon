# Art to-do (playtest 1, build 2)

## Build 2 — M7 (quests, plan-build2 §6 / §8.4, design-m7 §6.1, §6.9, B2 §3, §6.5, §6.6)

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

## Build 2 — M6 (people, plan-build2 §6 / §8.3 task 8, B2 §2.6, §6.5, §6.7)

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

## Build 2 — M5 (the author's four fixes, plan-build2 §6 / §8.2, B2 §6.1-§6.4)

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

## Procedural placeholders still in use (`placeholder: true`)

The PixelLab candidates for these three were rejected in the vision pass and the procedural drawings kept
(`vlr art:lint` warns `A12 3 placeholder sprites in use`):

| id         | class                | why it stayed procedural                                                                                                                                                |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desk`     | fixture-desk 48×32   | Transparent candidates drew 26-px stools; keyed ones carried a lamp/magnifier poking out of the silhouette. The placeholder reads at 1× (paper, magnifier, red button). |
| `shelf_t1` | fixture-shelf 224×64 | The shelf must carry the in-engine mini parcels on x 6..221 / y 6..39; generated shelves were 158–195-px front views, and stretched the minis float above the boards.   |
| `shelf_t2` | fixture-shelf 224×64 | Tier 2 must keep `shelf_t1`'s geometry (the edit recipe needs a generated `shelf_t1`).                                                                                  |

The other 168 procedural ids (ground and road tiles, lot, parcels, icons, UI nine-slices, fx, interior floor/belts,
signs, the m5x7 glyph sheet) are procedural by design and final; they are listed on `art/contact/procedural@4x.png`.

## G2 — anchors approved provisionally by the agent (`approvedBy: 'agent'`)

These were the style anchors of the bulk pass; confirm each (or reject it, which re-opens everything styled after it):
`art/contact/anchors@4x.png`, `art/contact/anchors-incontext@4x.png`.

| id                   | class       | district                                                          |
| -------------------- | ----------- | ----------------------------------------------------------------- |
| `dt_scope_offices`   | building2x2 | downtown                                                          |
| `hr_async_arms`      | building2x2 | highres                                                           |
| `in_esbuild_engines` | building2x2 | industrial                                                        |
| `cv_civic_2x2`       | building2x2 | civic (locked scenery: playtest 1 shows only its `_locked` frame) |
| `van`                | vehicle-van | —                                                                 |
| `worker`             | worker      | warehouse                                                         |
| `metal_detector`     | machine     | warehouse                                                         |

Confirm: `vlr art:approve -- dt_scope_offices hr_async_arms in_esbuild_engines cv_civic_2x2 van worker metal_detector`
(sets `approvedBy: 'author'`; no image changes).

## G3 — generated sprites awaiting the author's confirmation (`approved: false`)

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
  author and retired in build 2 M5), `ap_terminal`,
  `ap_hangar`, `cv_hall`, `cv_stadium`, `cv_pavilion`.
- **Docks and map props**: `dk_crane`, `dk_ship`, `dk_containers`, `tree_round`, `tree_pine`, `bush`.
- **Vehicles, warehouse, machines**: `bike`, `truck`, `wh_ext` (`_t1` + its `_t2` edit), `shaky_shaker`.

Confirm a category in one line, e.g. `vlr art:approve -- dt_registry_tower dt_peer_plaza …`; reject one with the
re-roll below.

## Art notes from the run (author to judge)

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
candidates come back identical.

```sh
vlr art:reject -- cv_stadium "townhouses around the pitch"   # logs the reason, clears approval
vlr art:gen -- --ids cv_stadium --n 3 --seed 5000            # 3 new candidates (budget guard: GET /balance first)
# look at the contact sheet gen prints (art/contact/candidates-*@4x.png), then pick one:
vlr art:approve -- cv_stadium:4                              # id:candidate → installed as the final by art:build
vlr art:build                                                # normalize → … → lint → atlas → gallery (offline)
vlr check
```

`vlr art:balance` prints the PixelLab balance first. A procedural id (`fx_dust`, `desk`, `shelf_t1`, …) is redrawn by
its generator in `tools/art/*.ts` and picked up by `vlr art:build`; no token needed.

## Regenerate these lists

```sh
node -e "const m=require('./art/manifest.json');const p=(f)=>m.entries.filter(f).map(e=>e.id).join(' ');console.log('placeholder:',p(e=>e.placeholder));console.log('G2 agent:',p(e=>e.approvedBy==='agent'));console.log('G3:',p(e=>e.source==='pixellab'&&!e.approved&&!e.placeholder))"
```
