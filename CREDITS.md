# Credits

Package Management Tycoon is original work released under the MIT licence (`LICENSE`). Nothing from Transport
Tycoon or OpenTTD is used; their look is a reference only.

## Font

- **m5x7** by Daniel Linssen — CC0 (public domain dedication). Vendored as `art/fonts/m5x7.ttf` (itch.io upload
  170386, sha256 `47c3f0b0…8cbf`) and rendered into the `m5x7` glyph sheet of the `world` atlas by
  `tools/art/font.ts`.

## Art

- Every sprite in `public/assets/world.png` is drawn by this repository's procedural generators (`tools/art/*.ts`)
  or generated with PixelLab (pixellab.ai, the author's subscription; provenance per id in `art/manifest.json`
  `gen[]`) and post-processed into the project's original 48-colour palette (`art/palette.json`).

## Audio

Music

- "Semver Swing" — original composition for pm-tycoon, MIT (same licence as the code).
- Instrument samples: FluidR3_GM SoundFont by Frank Wen, as pre-rendered by Benjamin Gleitzman's
  midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts), Creative Commons Attribution 3.0
  (https://creativecommons.org/licenses/by/3.0/us/). Instruments used: Acoustic Grand Piano, Acoustic Bass,
  Vibraphone, Muted Trumpet. Vendored note ranges in public/audio/sf/ (one sample every 3 semitones: piano C2–C6,
  bass E1–G3, vibraphone C4–C6, muted trumpet G3–C6; 47 unmodified mp3 files, 1.03 MB; notice in
  public/audio/sf/LICENSE.txt).

Audio code

- Tone.js 15.1.22 — MIT, Yotam Mann. Used as the transport clock (only its context and Transport modules).
- smplr 1.1.0 — MIT, danigb (https://github.com/danigb/smplr).
- ZzFX 1.4.0 — MIT, Frank Force. buildSamples() vendored in src/audio/zzfx-samples.ts.

Sound effects are synthesized at runtime; no sample packs. Transport Tycoon / OpenTTD music is a style
reference only; nothing from either is used.
