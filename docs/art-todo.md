# Art to-do (playtest 1)

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
  `lr_villa`, `ru_farm`, `ru_barn`, `ru_orchard`, `ru_farmhouse`, `dk_pier`, `dk_customs`, `ap_terminal`,
  `ap_hangar`, `cv_hall`, `cv_stadium`, `cv_pavilion`.
- **Docks and map props**: `dk_crane`, `dk_ship`, `dk_containers`, `tree_round`, `tree_pine`, `bush`.
- **Vehicles, warehouse, machines**: `bike`, `truck`, `wh_ext` (`_t1` + its `_t2` edit), `shaky_shaker`.

Confirm a category in one line, e.g. `vlr art:approve -- dt_registry_tower dt_peer_plaza …`; reject one with the
re-roll below.

## Art notes from the run (author to judge)

- **`bike` is a scooter.** The chosen candidate is a narrow orange delivery scooter (the van's tool,
  `create-object-pro-flash` at 24×24): the real cargo bicycles came out 24 px tall and broke the 1-px margin (lint
  A05), the 20-px re-rolls read as a cart or a quad. Gameplay calls it a bike everywhere.
- **`cv_stadium` sits among townhouses.** All three candidates surrounded the pitch with townhouses; acceptable while it
  is fogged (playtest 1 ships only `cv_stadium_locked`). Re-roll for build 2, when Civic unlocks.
- **`worker` scan frames** come from PixelLab's picking-up template (bend/crouch; the east/west frames hold a parcel),
  not an arm-raised scanner, so the inspector may sink behind the desk while scanning; the sprite is ~25 px tall
  against the 20-px placeholder it replaced.
- **`fx_dust`** (procedural, the level-up construction burst) reads as a field of separate puffs rather than one
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
