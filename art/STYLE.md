# pm-tycoon — art style (STYLE.md)

The rules every drawing routine (`tools/art/*.ts`), every PixelLab prompt and every hand edit obeys. Source: `plans/pm-tycoon/style-guide.md` §1 (copied and adapted; the plan's spec numbers are kept as written, `spec §` = `plans/pm-tycoon/spec-core.md`). The machine-readable halves are `art/palette.json` (colours), `art/manifest.json` (every sprite, its class, canvas, frames and variants) and `tools/art/draw-api.ts` (the drawer contract). `vlr art:lint` enforces this file.

## 1. The look in one paragraph

A small sunny city seen from a 2:1 isometric camera, Transport-Tycoon bright: saturated mid-tones, light warm-grey ground, cyan water, pastel and brick roofs, no dark grading, no day/night. Every object reads at 1× on a phone as a flat-filled silhouette with a 1 px dark outline (Into the Breach readability), ≤ 3 shades per material, tiny sharp shadows. Scale is intimate: ~6 tiles across the screen (spec §3.1), buildings are chunky, vehicles are toy-sized but recognisable at a glance by shape and colour (bike = narrow, van = tall box, truck = long box).

## 2. Light rule

One light for the whole game (OpenTTD base-set rule, kept as a rule, not as sprites): the sun is high at about 4:30–5 pm, screen-left/south-west. Objects are well lit on every side; where a shadow exists it is small and sharp-edged.

- Iso boxes: top face = ramp step +2 (lightest), left (south-west) face = step +1, right (south-east) face = step 0 (base). Never a fourth shade on a face; detail comes from outline and props, not gradients.
- Shadow: a solid 2 px strip of `outline` colour along the right (south-east) base edge, drawn **inside the sprite's own base diamond** (every building/prop sprite paints its own ground patch — pavement, yard, grass — so shadows never depend on the ground tile under it). No semi-transparent pixels anywhere (lint A02, style-guide.md §6).
- Interior (top-down 3/4): light from the top-left; the top face of a fixture is lightest, the front (south) face is the base step, a 1 px `outline` shadow line under the south edge.
- Vehicles: the left/south-west side is lit in every heading. Headings are never produced by in-engine `flipX`; the atlas holds all four (style-guide.md §3.7 reshade rule).

## 3. Outline, fills, readability (Into the Breach rules)

1. 1 px outline in the single darkest palette colour `outline` (#241e32) around every silhouette, darker than both the object and anything it stands on. No selective/light outlines in playtest 1.
2. Flat fills: a material is ≤ 3 shades of one ramp; no dithering (water frames are the one exception: 2-colour ordered dither allowed for shimmer).
3. No near-black fills: the only colours with V < 0.25 are `outline` and (for malware parcels only) `mal0`.
4. Strong silhouette: every building has one feature readable at 1× that no neighbour has (tower cap, chimney pair, awning, water tank, dome). Industrial = chimneys + sawtooth roofs; downtown = tall + glass; high-density residential = window grids + balconies; low-density = gable roofs; rural = barns/silos; civic = columns/flags.
5. One meaning per colour (§4). The checker never reads colour to decide anything; the player does.
6. No text inside sprites (names are BitmapText); no people on buildings; signage is a coloured board.

## 4. One meaning per colour

| Meaning                        | Ramp(s)                                                                                                                                     | Allowed classes (lint A07)                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Danger / blocked / lost        | `red`                                                                                                                                       | parcel (bomb icon only), icon16, ui, interior (dock light, Hold Bay full light) |
| Malware (revealed)             | `mal` (reserved)                                                                                                                            | parcel only (+ the Hold Bay card border in ui)                                  |
| Reward / money / magic         | `gold` (reserved)                                                                                                                           | parcel (magic only), icon16, ui (money text, "+$" popups)                       |
| Water, sea, lake               | `water`                                                                                                                                     | tile, dock-prop, ui (never on buildings)                                        |
| Roads, concrete, metal         | `grey` (warm)                                                                                                                               | everywhere                                                                      |
| Grass, lawns, pasture          | `grass`                                                                                                                                     | tile, building base patches, scenery                                            |
| Trees, hedges, foliage         | `leaf`                                                                                                                                      | scenery, building props                                                         |
| Materials and accents          | `orange` (brick, terracotta), `yellow` (paint, awnings, sun-lit signage), `blue` (glass, sky, UI primary), `purple`, `pink`, `brown` (wood) | buildings, vehicles, interior, ui                                               |
| Satisfaction / detection state | `grass2` green, `yellow2` amber, `red1` red (HUD readouts of spec §6.3, §9.4)                                                               | icon16, ui                                                                      |

## 5. Grid discipline

- World tile 64×32 (spec §3.1), 2:1 diamond, stair-step edges in 2 px runs. Building footprints follow `buildings.json` (`[w,h]` ∈ 1×1, 2×2, 3×3; spec §3.4).
- Every city sprite paints its full footprint diamond (ground patch included) and nothing outside it except height. The **anchor** is the bottom vertex of the footprint diamond = the canvas bottom-centre pixel `(W/2 − 1 … W/2, H − 1)`; Phaser uses `setOrigin(0.5, 1)` and the iso tile centre + `HH` (phaser4-notes.md §2).
- Height budget: 1×1 up to 64 px above the diamond, 2×2 up to 96, 3×3 up to 128 (keeps depth sorting honest: a sprite never covers more than the tile row behind it).
- Vehicles sit on the road centre line; the sprite centre is the tile centre; headings are the four iso diagonals NE/SE/SW/NW (spec §4.1).
- Interior grid: 32×32 cells, camera zoom 1 in the warehouse view (same pixel density as the city); a lane slot is a 2×2-cell pad (64×64 logical px = 64 CSS px on the iPhone, thumb-sized), the Hold Bay rack is 2×8 cells (64×256) holding five 44×44 bay pads, the shelf 7×2 cells (224×64), the dock door 32×56 on the west wall, the desk 48×32 beside the belt — the rect table is `warehouse-view.md` §1.3 **(default — confirm)**.
- No fractional scaling anywhere; integer camera zoom {1, 2} only; icons never scaled.

## 6. Canvas classes

| Class           | Canvas (px)                       | Used for                                                                                                                                                                                         | Frames / variants                                               |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `tile`          | 64×32                             | ground, road autotile, themed road edges, lot                                                                                                                                                    | water ×4 frames; `_locked` variants                             |
| `building1x1`   | 64×96                             | shops, houses, 1×1 props with ground                                                                                                                                                             | `_locked` where in a locked region                              |
| `building2x2`   | 128×160                           | flats, offices, small factories                                                                                                                                                                  | idem                                                            |
| `building3x3`   | 192×224                           | towers, big factories, piers, campus **(default — confirm; spec §3.4 has 12 live 3×3 rows, the art-pipeline.md open question assumed ≤ 2×2)**                                                    | idem                                                            |
| `warehouse-ext` | 256×256                           | the 4×4 company building (spec §3.1); 256 is PixelLab Pro Flash's side cap                                                                                                                       | `_t1`, `_t2`                                                    |
| `prop`          | 64×128                            | crane, trees, lamp, sign board (no ground patch; anchor = bottom-centre)                                                                                                                         | —                                                               |
| `dock-prop`     | 128×96                            | ship, container stack                                                                                                                                                                            | —                                                               |
| `vehicle-bike`  | 24×24                             | bike                                                                                                                                                                                             | `_ne/_se/_sw/_nw` × `_0/_1`                                     |
| `vehicle-van`   | 32×32                             | van                                                                                                                                                                                              | idem                                                            |
| `vehicle-truck` | 48×32                             | truck                                                                                                                                                                                            | idem                                                            |
| `interior-tile` | 32×32                             | floor, walls, conveyor, arrows                                                                                                                                                                   | conveyor ×4 frames; `_t2`                                       |
| `fixture`       | 64×64                             | slot outlines (`slot_empty_outline`, `slot_locked_outline`), the Quarantine Bin (`bin`)                                                                                                          | `_closed/_open`                                                 |
| `fixture-rack`  | 64×256                            | the Hold Bay rack (2×8 cells)                                                                                                                                                                    | one frame                                                       |
| `fixture-shelf` | 224×64                            | the storage shelf (7×2 cells)                                                                                                                                                                    | `_t1`, `_t2`                                                    |
| `fixture-door`  | 32×56                             | the dock door on the west wall                                                                                                                                                                   | `_closed`, `_open`, `_locked`                                   |
| `fixture-desk`  | 48×32                             | the inspection desk (top-down)                                                                                                                                                                   | one frame                                                       |
| `dock-tail`     | 40×40                             | the docked vehicle's tail through the door (`plan.md` Q27)                                                                                                                                       | `_closed`, `_open` × bike/van/truck                             |
| `sign`          | 200×24                            | the "days since last incident" board and its crack overlay                                                                                                                                       | `_t1`, `_t2`; `sign_crack_0/1`                                  |
| `interior-prop` | per manifest row (`canvas` field) | small interior dressing and outlines: bay pads 44×44, lamps 8×8, chute outlet 12×12, bulb 16×24, strip light 64×8, cardboard 48×48, shelving 48×64, wanted poster 32×32, extension outline 56×24 | per row                                                         |
| `machine`       | 48×48                             | checkers, locked silhouettes                                                                                                                                                                     | ×2–3 frames                                                     |
| `worker`        | 24×32                             | inspector                                                                                                                                                                                        | `_{s,n,e,w}_{idle,walk,scan}_{0,1}` + `_{dir}_jump` (28 frames) |
| `parcel`        | 32×32                             | S/M/L/XL boxes drawn 16×16, 20×20, 24×24, 28×28 inside (`plan.md` Q28); `parcel_mini_*` 10×10 live on an `icon16` canvas                                                                         | clean, malware, magic, flip ×6                                  |
| `fx`            | 16×16 / 32×32                     | smoke, ping, dust, decay ring                                                                                                                                                                    | ×4–9 frames                                                     |
| `icon16`        | 16×16                             | HUD and card icons                                                                                                                                                                               | 1 px transparent margin                                         |
| `ui`            | 16×16 nineslice, strips           | panels, buttons, chips, bars                                                                                                                                                                     | states                                                          |

## 7. UI panel style

Panels are cream `grey5` (#fcf9f1) with a 1 px `outline` border and a 2 px `grey3` inner bevel on the bottom/right (sharp, no gradient); dark panels (ticker, Garage sheet header) are `grey0` with `grey5` text. Buttons: 16×16 nineslice with 4 px corners, face `blue1` (primary), `grey4` (secondary), `red1` (danger) or `grass1` (confirm: `ui_btn_green` / `ui_btn_green_down`, the Hold Bay CLEAR button; its pressed lip is `leaf0`), 1 px `outline`, pressed state shifts the face down 1 px and darkens one step, disabled = `grey3` face + `grey2` text. Chips (region quick-jump) are pill-shaped 16-high nineslices, active chip face `yellow2`. Bars: 8 px tall, `grey3` track, fill in the state colour of §4. Cards use the same panel; the Hold Bay card border is `mal1` (2 px) so a flagged parcel's card is unmistakable. Text is m5x7 at 16 px, `outline` on light panels, `grey5` on dark ones, drop shadow 1 px only on the city overlay popups.

## 8. Palette — original, 48 colours (default — confirm, author approves the swatch)

Structured like Transport Tycoon's palette (hue-shifted ramps, highlights toward yellow/cyan, shadows toward blue/purple, saturation falling toward the light end) but every value is original. Targets come from measurements on the reference files in `references/openttd-palette/` (TTD DOS palette, 215 usable entries: mean saturation 0.57, mean value 0.64, mid-tone saturation 0.52, ramps of 6–10 shades stepping V by 0.07–0.10 with hue shifts up to ±30° — greens 111°→79°, blue 227°→207°, orange 21°→50° — and S falling from ~0.9–1.0 to 0.2–0.5; Endesga 64: mean S 0.58 / V 0.66, mid-tone S 0.59). This palette, measured the same way: **mean S 0.56, mean V 0.73, mid-tone S 0.60, one colour with V < 0.25**. It is deliberately brighter than TTD's mean V because TTD's 8-step ramps run down to near-black fills we do not use (decision #6-style); the mid-tone saturation matches both references. Steps are larger (0.10–0.18) because ramps have 3–6 shades, which keeps fills flat and readable at phone scale.

| Ramp (ids)           | Shades, dark → light                            | Hue shift, V range                                        |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `outline`            | #241e32                                         | the one darkest colour; V 0.20                            |
| `grey0-5` (warm)     | #4e4858 #716a74 #948e90 #b7b0a8 #d9d2c4 #fcf9f1 | purple-grey → cream, V 0.35→0.99                          |
| `grass0-3`           | #2f7d3a #47a048 #6cc05a #9bdc74                 | 128°→98° (toward yellow), V 0.49→0.86                     |
| `leaf0-2`            | #1f6a4a #2f8d5e #4bb27a                         | the second green, cooler; V 0.42→0.70                     |
| `water0-3`           | #1d6fae #2f9bd6 #5ec6ea #a5e8f4                 | 206°→189° (toward cyan), V 0.68→0.96                      |
| `blue0-2`            | #2d4d9c #4c7bd0 #86b4ee                         | 223°→213°, V 0.61→0.93                                    |
| `red0-2`             | #a8232e #e63e3e #ff7f68                         | danger only; 355°→9°, V 0.66→1.00                         |
| `orange0-3`          | #8a3a1f #c4582b #ea853d #f6b168                 | brick/terracotta; 15°→31°, V 0.54→0.96                    |
| `yellow0-3`          | #b5760f #e8a526 #f8d13e #fff38e                 | paint/awnings; 37°→54°, V 0.71→1.00                       |
| `purple0-2`          | #5a3b86 #8a60bc #bd99e0                         | roofs/glass accents; V 0.53→0.88                          |
| `pink0-1`            | #d4567c #f6a0b6                                 | downtown accents                                          |
| `brown0-3`           | #5a3a24 #8a5a3a #c08a58 #e2bb8a                 | wood, crates, cardboard; 24°→33°                          |
| `skin0`              | #f2ad7a                                         | workers                                                   |
| `mal0-2` (reserved)  | #301442 #4b1f66 #75399a                         | malware body; ≥ 22 RGB units from any non-reserved colour |
| `gold0-2` (reserved) | #cc7d00 #f5b000 #ffe066                         | magic parcel, money; ≥ 28 units from the yellow ramp      |

Files: `art/palette.json`, `art/palette.png` (the 48 × 1 swatch at 1×), `art/contact/palette-ramps@4x.png` (the 15-row ramp sheet with fog greys) — see §9. Quantization subsets per class: `all` minus `mal`/`gold` for every class except `parcel`, `icon16`, `ui` (which get the full palette) — so a generated purple roof can never quantize into the malware ramp (the full class table, including the §4 limits on `red` and `water`, is in §9). Game background colour = `water1` (#2f9bd6, the deep sea beyond the map edge; replaces the placeholder hex in phaser4-notes.md §1). Fog look (spec §3.5) is a derived sub-palette: each colour mixed 45 % toward `grey5` then fully desaturated and re-quantized to the nearest `grey`, computed by `palette.ts`, never hand-picked.

## 9. How the tools apply these rules

- **Palette files.** `art/palette.json` holds the 48 colours above in ramp order (`id`, `hex`, `ramp`, `step`, `reserved`); every hex comes from §8's table, none is derived. `vlr art:palette` writes `art/palette.png` (the 48 × 1 swatch at 1×, palette order — also the `color_image` handed to PixelLab) and `art/contact/palette-ramps@4x.png` (each ramp dark → light, with its fog greys beside it) and prints the measured stats (mean S 0.56, mean V 0.73, one colour with V < 0.25, `mal` ≥ 22.4 and `gold` ≥ 28.3 RGB units from every non-reserved colour).
- **Colour subsets** (`subsetFor(class, {district})` in `tools/art/palette.ts`; quantize and lint A01/A07 use the same table):
  - `mal`: `parcel`, `icon16`, `ui`, `font` only.
  - `gold`: those plus `fx` (the decay coin ring).
  - `red`: those plus `fx` (`fx_boom`) and the interior classes (`interior-tile`, `fixture*`, `dock-tail`, `sign`, `interior-prop`, `machine`, `worker`) — never on buildings, tiles, props or vehicles, so a red barn, roof, bike or hull is drawn in `orange`/`pink` instead.
  - `water`: `tile`, `dock-prop`, `fx`, `parcel`, `icon16`, `ui`, and buildings whose manifest `district` is `docks` (piers stand in the sea).
  - every other ramp: every class.
- **Fog** (`fogColor(hex)`, `FOG_MAP`): mix 45 % toward `grey5`, Rec. 601 luma, nearest `grey` ramp colour in RGB. The variants pass applies it pixel by pixel to make every `_locked` frame.
- **Frames.** Atlas frame name = manifest `id` + frame suffix (+ `_locked` for the derived fog variant): `dt_cache_cafe`, `in_glob_silos_locked`, `wh_ext_t1`, `van_ne_0`, `road_05`, `parcel_m_mal`, `ic_bell`, `ui_btn_down`, `mood_happy_2x2`. Finals live at `art/final/<class>/<frame name>.png`.
- **Canvas.** Fixed per class (§6); `prop`, `interior-prop`, `fx`, `ui` and `font` rows carry their own `canvas` (e.g. `sign_locked` 96 × 52 with a two-line face, `sign_days` 64 × 40, `ui_banner` 320 × 32).
- **Determinism.** Every procedural drawer is seeded with `mulberry32(hash(id))`; `vlr art:draw` writes byte-identical PNGs on every run.

## 10. Provenance (AI-generated art)

Kept for any later store submission (plan.md §14 Q70 / Q-AP9; default taken: a note here, no hand-touching in playtest 1).

- Two sources, recorded per sprite in `art/manifest.json`: `source: "procedural"` (drawn by code in `tools/art/*.ts`, seeded, no AI) and `source: "pixellab"` (generated with PixelLab, https://www.pixellab.ai, under the author's subscription and PixelLab's Terms of Service, which assign the outputs to the subscriber).
- Every generation call is logged in the entry's `gen[]` (`tool`, `endpoint`, the full prompt and parameters, `jobId`, `seed`, `candidate`, `cost`, `sha256` of the download, timestamp); spending is logged per batch in the manifest's root `batches[]`. No third-party art or ready-made pack is ever a model input. In the playtest-1 run the anchors (`anchorRole: "anchor"`, agent-approved at G2) were made text-only, and the bulk pass also ran text-only (Pro Flash with the frozen template and this palette): both style-reference routes copied the anchors' structure (evidence in `art/contact/candidates-probe@4x.png`, gitignored), so coherence was enforced in the vision pass instead. The truck is generated with the chosen van's `object_id` as `style_object_id`; the bike is a Pro Flash object like the van (the van style object is too large for a 24-px canvas).
- `placeholder: true` marks a procedural stand-in still occupying a PixelLab id; `approved` / `approvedBy` (`agent` or `author`) and `rejects[]` record the review (in playtest 1 only the seven anchors carry `approvedBy: "agent"`; every other chosen candidate stays `approved: false` until the author's gate). Post-processing is automatic: a generated candidate is keyed, quantized to this palette, outlined and fitted to its class contract when it is downloaded (`tools/art/candidates.ts`: plot diamond on the anchor, vehicle wheels on the per-heading road line, the worker's feet on row 29, the machines' 24-px belt opening); `vlr art:build` then quantizes, outlines and derives the fog variants for both sources alike, and its normalize pass only re-places a final whose size is not the class canvas.
- Staged runs (`vlr art:gen -- --staging`) log to `art/candidates/gen-log.json` and decide in `art/candidates/choices.json` (both gitignored with the candidates); `node tools/art/install.ts` copies the chosen frames into `art/final`, merges the logs into the manifest and is idempotent.
- Playtest 1 ships the sprites unedited by hand. If copyright protection of individual sprites matters later, hand-touched replacements get a new `gen[]` entry with `tool: "hand"`.
- Font: m5x7 by Daniel Linssen (CC0), see `CREDITS.md`.
