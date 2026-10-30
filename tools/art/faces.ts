// People art (build 2 M6, B2 §6.7, plan-build2 §8.3 task 8; design-m6 §6.5):
// the 16x16 portrait faces `face_00` … `face_11` the HireSheet, SlotCard,
// StationCard and Garage rows draw for an employee / applicant (`look` =
// the face index, assigned by the sim: people.ts FACE_LOOKS = 12).
//
// face_NN, NN = skin * 4 + hair: three skin tones (peach skin0, tan brown2,
// deep brown1) x four hair / hat combos (short dark hair, long auburn hair,
// a blue cap with its visor, a yellow hard hat) — the silhouettes differ at
// 1x (flat top, hair down the sides, a visor band, a dome with a brim). The
// shirt colour is seeded per id (d.rng = mulberry32(hash(id))), so the same
// face always wears the same shirt. Head and shoulders, lit from the top-
// left (icons.ts tpl auto-shading), 1-px `outline` silhouette, 1-px
// transparent margin (icon16 contract, lint A03). Eyes are flat outline
// pixels ('E', not 'o', so the skin around them is not edge-shaded).
//
// Class icon16 → packed into both atlases (home `world`): the HUD, the
// HireSheet (built in the Garage, world-only) and the room's front layers
// draw them (atlas.ts SHARED_CLASSES; design-m6 D7).

import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { CHARS, Grid, type Mat, gridFrames, tpl } from './icons.ts'

export const FACE_SKINS = 3
export const FACE_HAIRS = 4
/** face_00 … face_11 (the sim's FACE_LOOKS) */
export const FACE_COUNT = FACE_SKINS * FACE_HAIRS

/** skin materials [base, light edge, dark edge] + the mouth colour */
const SKINS: readonly { mat: Mat; mouth: string }[] = [
  { mat: ['skin0', 'skin0', 'orange3'], mouth: 'orange2' },
  { mat: ['brown2', 'brown3', 'brown1'], mouth: 'orange1' },
  { mat: ['brown1', 'brown2', 'brown0'], mouth: 'orange0' },
]

/** shirt materials the seeded pick draws from (no reserved ramps) */
const SHIRTS: readonly Mat[] = [
  ['blue1', 'blue2', 'blue0'],
  ['grass1', 'grass2', 'grass0'],
  ['purple1', 'purple2', 'purple0'],
  ['leaf1', 'leaf2', 'leaf0'],
  ['pink0', 'pink1', 'pink0'],
  ['grey3', 'grey4', 'grey2'],
]

// Templates, 12 x 12 (centred on the 16x16 canvas, then outlined):
//   s skin · E eye · m mouth · h hair · k hat / cap · v visor / brim (flat)
//   t hair under a cap (flat) · c shirt · w collar (flat grey5)
const SHOULDERS = ['.cccwsswccc.', 'cccccwwccccc', 'cccccccccccc']

const HAIR_ROWS: readonly (readonly string[])[] = [
  // 0: short dark hair, ears showing
  [
    '...hhhhhh...',
    '..hhhhhhhh..',
    '..hhhhhhhh..',
    '..hssssssh..',
    '.sssEssEsss.',
    '.ssssssssss.',
    '..sssmmsss..',
    '...ssssss...',
    '....ssss....',
    ...SHOULDERS,
  ],
  // 1: long auburn hair down to the shoulders
  [
    '...hhhhhh...',
    '..hhhhhhhh..',
    '.hhhhhhhhhh.',
    '.hhsssssshh.',
    '.hssEssEssh.',
    '.hssssssssh.',
    '.hhssmmsshh.',
    '.hhhsssshhh.',
    '.hhh.ss.hhh.',
    '.hhccwwcchh.',
    'cccccwwccccc',
    'cccccccccccc',
  ],
  // 2: blue cap with a visor band, dark hair at the temples
  [
    '....kkkk....',
    '..kkkkkkkk..',
    '..kkkkwkkk..',
    '.vvvvvvvvvv.',
    '.tssEssEsst.',
    '.tsssssssst.',
    '..sssmmsss..',
    '...ssssss...',
    '....ssss....',
    ...SHOULDERS,
  ],
  // 3: yellow hard hat (dome + full-width brim)
  [
    '....kkkk....',
    '..kkkkkkkk..',
    '..kkkkkkkk..',
    'vvvvvvvvvvvv',
    '.sssEssEsss.',
    '.ssssssssss.',
    '..sssmmsss..',
    '...ssssss...',
    '....ssss....',
    ...SHOULDERS,
  ],
]

const HAIR_MATS: readonly { h: Mat; k: Mat; v: string; t: string }[] = [
  {
    h: ['grey0', 'grey1', 'grey0'],
    k: ['grey0', 'grey1', 'grey0'],
    v: 'grey0',
    t: 'grey0',
  },
  {
    h: ['orange1', 'orange2', 'orange0'],
    k: ['orange1', 'orange2', 'orange0'],
    v: 'orange1',
    t: 'orange1',
  },
  {
    h: ['brown0', 'brown1', 'brown0'],
    k: ['blue1', 'blue2', 'blue0'],
    v: 'blue0',
    t: 'brown0',
  },
  {
    h: ['brown0', 'brown1', 'brown0'],
    k: ['yellow2', 'yellow3', 'yellow1'],
    v: 'yellow1',
    t: 'brown0',
  },
]

/** face index of a frame id ('face_07' -> 7) */
export function faceIndex(id: string): number {
  const m = /^face_(\d\d)$/.exec(id)
  if (!m) throw new Error(`faces: bad id ${id}`)
  const n = Number(m[1])
  if (n >= FACE_COUNT) throw new Error(`faces: ${id} >= ${FACE_COUNT}`)
  return n
}

/** skin and hair of face n (NN = skin * 4 + hair) */
export function faceParts(n: number): { skin: number; hair: number } {
  return { skin: Math.floor(n / FACE_HAIRS), hair: n % FACE_HAIRS }
}

/** the 16x16 portrait of face n with the given shirt */
export function faceGrid(n: number, shirt: Mat): Grid {
  const { skin, hair } = faceParts(n)
  const s = SKINS[skin] as (typeof SKINS)[number]
  const h = HAIR_MATS[hair] as (typeof HAIR_MATS)[number]
  const rows = HAIR_ROWS[hair] as readonly string[]
  const chars: Record<string, string | Mat> = {
    ...CHARS,
    s: s.mat,
    E: 'outline',
    m: s.mouth,
    h: h.h,
    k: h.k,
    v: h.v,
    t: h.t,
    c: shirt,
    w: 'grey5',
  }
  const tw = Math.max(...rows.map((r) => r.length))
  // centred; the shoulders sit on the bottom margin row (y 14 = outline)
  const g = tpl(rows, 16, 16, Math.floor((16 - tw) / 2), 2, chars)
  g.outline()
  return g
}

/** the seeded shirt of a face id */
export function shirtOf(d: DrawCtx): Mat {
  return d.rng.pick(SHIRTS)
}

registerDrawer({ id: /^face_\d\d$/ }, (d) => {
  const n = faceIndex(d.entry.id)
  const shirt = shirtOf(d)
  return gridFrames(
    d,
    d.entry.frames.map(() => faceGrid(n, shirt)),
  )
})
