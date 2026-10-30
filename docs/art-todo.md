# Art to-do (playtest 1, build 2)

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
  `lr_villa`, `ru_farm`, `ru_barn`, `ru_orchard`, `ru_farmhouse`, `dk_pier` and `dk_customs` (both rejected by the
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
