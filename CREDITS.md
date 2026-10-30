# Credits

Package Management Tycoon is original work released under the MIT licence (`LICENSE`). Nothing from Transport
Tycoon or OpenTTD is used; their look is a reference only. The Title screen's Credits card summarises the font and
music lines below.

## Font

- **m5x7** by Daniel Linssen — CC0 (public domain dedication). Vendored as `art/fonts/m5x7.ttf` (itch.io upload
  170386, sha256 `47c3f0b0…8cbf`) and rendered into the `m5x7` glyph sheet of the `world` atlas by
  `tools/art/font.ts`.

## Art

Every sprite in the two atlases (`src/assets/world.png`, `src/assets/interior.png`) comes from one of two sources, recorded per id in `art/manifest.json`
(`source`), and is post-processed into the project's original 48-colour palette (`art/palette.json`; no third-party
palette, no ready-made art pack):

- **Procedural** (168 ids — ground and road tiles, the lot, parcels, icons, UI nine-slices, effects, the warehouse
  floor and belts, signs — plus the inspection desk and the two shelves, whose PixelLab candidates were rejected) —
  drawn by this repository's seeded generators in `tools/art/*.ts`; MIT, same as the code.
- **Generated with PixelLab** (63 ids: the city buildings and locked scenery, the bike, van and truck, the warehouse
  exterior, the inspector, the Metal detector and the Shaky shaker) — https://www.pixellab.ai, under the author's
  Tier 2 subscription and PixelLab's Terms of Service (https://pixellab.ai/termsofservice), which assign the outputs
  to the subscriber. Provenance per id in `art/manifest.json` `gen[]` (tool, endpoint, prompt, seed, candidate) and
  `batches[]` (1,700 generations in playtest 1); review state in `approved` / `approvedBy`; the provenance and
  disclosure note is `art/STYLE.md` §10. Generated candidates were keyed, quantized to the palette, outlined and
  fitted to the sprite contract by `tools/art/*.ts`; no sprite was hand-retouched.

## Audio

Music

- "Semver Swing" — original composition for pm-tycoon, MIT (same licence as the code).
- Instrument samples: FluidR3_GM SoundFont by Frank Wen, as pre-rendered by Benjamin Gleitzman's
  midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts), Creative Commons Attribution 3.0
  (https://creativecommons.org/licenses/by/3.0/us/). Instruments used: Acoustic Grand Piano, Acoustic Bass,
  Vibraphone, Muted Trumpet. Vendored note ranges in public/audio/sf/ (one sample every 3 semitones: piano C2–C6,
  bass E1–G3, vibraphone C4–C6, muted trumpet G3–C6; 47 unmodified mp3 files, 1.03 MB; notice in
  public/audio/sf/LICENSE.txt).

Sound effects are synthesized at runtime with ZzFX (below); no sample packs. Transport Tycoon / OpenTTD music is a
style reference only; nothing from either is used.

## Code shipped in the game

The libraries bundled into `dist/assets/*.js` (read from the build's source maps), all permissive:

| Library                                                                                    | Version | Licence | Author                        | Used for                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------- | ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Phaser](https://phaser.io)                                                                | 4.2.1   | MIT     | Richard Davey / Phaser Studio | the game engine (`phaser` chunk)                                                                                                                    |
| [eventemitter3](https://github.com/primus/eventemitter3)                                   | 5.0.4   | MIT     | Arnout Kazemier               | the sim's typed event bus (also Phaser's)                                                                                                           |
| [Tone.js](https://tonejs.github.io)                                                        | 15.1.22 | MIT     | Yotam Mann                    | the music clock (Transport only; audio chunk)                                                                                                       |
| [smplr](https://github.com/danigb/smplr)                                                   | 1.1.0   | MIT     | danigb                        | sampled instruments for the band and stingers                                                                                                       |
| [standardized-audio-context](https://github.com/chrisguttandin/standardized-audio-context) | 25.3.77 | MIT     | Christoph Guttandin           | Tone.js dependency                                                                                                                                  |
| [automation-events](https://github.com/chrisguttandin/automation-events)                   | 7.1.19  | MIT     | Christoph Guttandin           | Tone.js dependency                                                                                                                                  |
| [@babel/runtime](https://babel.dev)                                                        | 7.29.10 | MIT     | The Babel Team                | helpers pulled in by the audio dependencies                                                                                                         |
| [tslib](https://github.com/microsoft/tslib)                                                | 2.8.1   | 0BSD    | Microsoft                     | helpers pulled in by the audio dependencies                                                                                                         |
| [ZzFX](https://github.com/KilledByAPixel/ZzFX)                                             | 1.4.0   | MIT     | Frank Force                   | sound-effect synthesis; only `buildSamples()` is vendored, with its MIT header, in `src/audio/zzfx-samples.ts` (not an npm dependency, plan.md Q72) |

Why each runtime dependency was added, with sizes: `docs/decisions.md` ("Runtime dependencies").

## Build and test tools (not shipped)

Vite, TypeScript, Vitest, Playwright (Chromium for the e2e specs), oxlint and oxfmt, sharp, @napi-rs/canvas and
free-tex-packer-core (the art pipeline), and @types/node — each under its own open-source licence, installed by
`vlt install` from `vlt-lock.json`.
