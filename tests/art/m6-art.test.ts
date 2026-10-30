// Build-2 M6 art contracts (plan-build2 §8.3 task 8, §6 Machines /
// Low-density; B2 §6.5, §6.7; design-m6 §6.5): the procedural faces, pips
// and ★, the orange-vest worker_sorter swap, the Hold Bay station, the
// atlas placement of the new frames, the new machines' belt opening and
// the Sorter Arm swing, and the Low-density uniques replacing the shared
// scenery.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { placementOf } from '../../tools/art/atlas.ts'
import { OPENINGS, lean } from '../../tools/art/candidates.ts'
import { FACE_COUNT, faceIndex, faceParts } from '../../tools/art/faces.ts'
import {
  type Img,
  bbox,
  get,
  newImg,
  opaque,
  put,
  readImg,
  sameImg,
} from '../../tools/art/iso.ts'
import {
  buildingCoverage,
  finalPath,
  getEntry,
  loadBuildingIds,
  loadManifest,
  validateManifest,
} from '../../tools/art/manifest.ts'
import { SORTER_SWAP, sorterImg } from '../../tools/art/variants.ts'

const m = loadManifest()
const FACES = Array.from(
  { length: FACE_COUNT },
  (_, n) => `face_${String(n).padStart(2, '0')}`,
)
const LOWRES = [
  'lr_major_house',
  'lr_patch_bungalow',
  'lr_prerelease_villa',
  'lr_range_ranch_house',
  'lr_caret_cottage',
  'lr_tilde_terrace',
  'lr_minor_cottage',
  'lr_exact_pin',
  'lr_wildcard_shop',
  'lr_buildmeta_bungalow',
]

/** the final of `id` + `suffix` as an Img */
function final(id: string, suffix = ''): Img {
  return readImg(finalPath(getEntry(m, id), id + suffix)).img
}

describe('faces (B2 §6.7: 3 skins x 4 hair / hat)', () => {
  it('twelve 16x16 icon16 rows, face_NN = skin * 4 + hair', () => {
    expect(FACE_COUNT).toBe(12)
    for (const id of FACES) {
      const e = getEntry(m, id)
      expect(e.class).toBe('icon16')
      expect(e.source).toBe('procedural')
      expect(e.canvas).toEqual([16, 16])
    }
    expect(faceIndex('face_07')).toBe(7)
    expect(faceParts(7)).toEqual({ skin: 1, hair: 3 })
    expect(() => faceIndex('face_12')).toThrow()
  })

  it('every face keeps the 1-px margin and no two faces are alike', () => {
    const imgs = FACES.map((id) => final(id))
    for (const [k, img] of imgs.entries()) {
      for (let i = 0; i < 16; i++) {
        for (const [x, y] of [
          [i, 0],
          [i, 15],
          [0, i],
          [15, i],
        ] as const) {
          expect(opaque(img, x, y), `${FACES[k]} (${x},${y})`).toBe(false)
        }
      }
    }
    for (let a = 0; a < imgs.length; a++) {
      for (let b = a + 1; b < imgs.length; b++) {
        expect(sameImg(imgs[a] as Img, imgs[b] as Img)).toBe(false)
      }
    }
  })

  it('ic_star is a gold icon16, the pips are 8x8 ui dots', () => {
    const star = final('ic_star')
    const ids = new Set<string>()
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) ids.add(get(star, x, y) ?? '')
    }
    expect([...ids].some((c) => c.startsWith('gold'))).toBe(true)
    for (const id of ['ic_pip_on', 'ic_pip_off']) {
      const e = getEntry(m, id)
      expect(e.class).toBe('ui')
      expect(e.canvas).toEqual([8, 8])
      const b = bbox(final(id))
      // the 6x6 dot at (1, 1)
      expect(b).toEqual({ x0: 1, y0: 1, x1: 6, y1: 6 })
    }
    expect(get(final('ic_pip_on'), 3, 3)).toBe('yellow3')
    expect(get(final('ic_pip_off'), 3, 3)).toBe('grey4')
  })
})

describe('worker_sorter (orange-vest palette swap of worker)', () => {
  const worker = getEntry(m, 'worker')
  const sorter = getEntry(m, 'worker_sorter')

  it('has every worker frame suffix', () => {
    expect(sorter.class).toBe('worker')
    expect(sorter.frames).toEqual(worker.frames)
  })

  it('each frame is the worker frame with yellow -> orange', () => {
    for (const f of worker.frames) {
      const w = final('worker', f)
      const s = final('worker_sorter', f)
      expect(sameImg(s, sorterImg(w)), f).toBe(true)
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          expect(SORTER_SWAP.has(get(s, x, y) ?? '')).toBe(false)
        }
      }
    }
  })
})

describe('atlas placement of the M6 frames (design-m6 §6.5 / D7)', () => {
  it('faces, ★, workers and machines pack into both; pips world; podium interior', () => {
    for (const id of [
      ...FACES,
      'ic_star',
      'worker_sorter',
      'battery_checker',
      'xray',
      'sorter_arm',
    ]) {
      expect(placementOf(getEntry(m, id)), id).toBe('both')
    }
    expect(placementOf(getEntry(m, 'ic_pip_on'))).toBe('world')
    expect(placementOf(getEntry(m, 'ic_pip_off'))).toBe('world')
    expect(placementOf(getEntry(m, 'hold_station'))).toBe('interior')
  })
})

describe('machines (plan-build2 §6: battery_checker, xray, sorter_arm)', () => {
  it('rows: 48x48 x2 frames for the checkers, 64x64 x3 for the arm', () => {
    for (const id of ['battery_checker', 'xray']) {
      const e = getEntry(m, id)
      expect(e.class).toBe('machine')
      expect(e.frames).toEqual(['_f0', '_f1'])
    }
    const arm = getEntry(m, 'sorter_arm')
    expect(arm.class).toBe('fixture')
    expect(arm.canvas).toEqual([64, 64])
    expect(arm.frames).toEqual(['_f0', '_f1', '_f2'])
  })

  it('the checkers keep the belt opening empty', () => {
    for (const id of ['battery_checker', 'xray']) {
      const [x0, x1, y0] = OPENINGS[id] as [number, number, number]
      for (const f of ['_f0', '_f1']) {
        const img = final(id, f)
        for (let y = y0; y < 48; y++) {
          for (let x = x0; x <= x1; x++) {
            expect(opaque(img, x, y), `${id}${f} (${x},${y})`).toBe(false)
          }
        }
      }
    }
  })

  it('lean shears the rows above the pivot and keeps the base', () => {
    const img = newImg(16, 16)
    for (let y = 2; y < 16; y++) put(img, 7, y, 'grey3')
    const out = lean(img, 10, 3)
    expect(opaque(out, 10, 2)).toBe(true) // top row moved +3
    expect(opaque(out, 7, 2)).toBe(false)
    for (let y = 10; y < 16; y++) expect(opaque(out, 7, y)).toBe(true)
    expect(opaque(lean(img, 10, -3), 4, 2)).toBe(true)
  })
})

describe('hold_station (B2 §2.6 podium, 48x48 interior-prop)', () => {
  it('is drawn on its 48x48 canvas', () => {
    const e = getEntry(m, 'hold_station')
    expect(e.class).toBe('interior-prop')
    expect(e.canvas).toEqual([48, 48])
    expect(bbox(final('hold_station'))).not.toBeNull()
  })
})

describe('Low-density uniques (B2 §6.5)', () => {
  it('each lowres building maps to its own sprite', () => {
    const ids = loadBuildingIds() ?? []
    const lowres = ids.filter((b) => b.startsWith('lr_'))
    expect(lowres.toSorted()).toEqual(LOWRES.toSorted())
    const { map, errors } = buildingCoverage(m, ids)
    expect(errors).toEqual([])
    for (const id of LOWRES) {
      expect(map.get(id)).toBe(id)
      const e = getEntry(m, id)
      expect(e.district).toBe('lowres')
      expect(e.variants).toContain('locked')
      expect(e.class).toBe(
        e.footprint?.[0] === 2 ? 'building2x2' : 'building1x1',
      )
      expect(existsSync(finalPath(e, id))).toBe(true)
      expect(existsSync(finalPath(e, `${id}_locked`))).toBe(true)
    }
  })

  it('the shared scenery is retired, its finals gone', () => {
    const retired = (m.retired ?? []).map((r) => r.id)
    for (const id of ['lr_house_a', 'lr_house_b', 'lr_house_c', 'lr_villa']) {
      expect(retired).toContain(id)
      expect(m.entries.some((e) => e.id === id)).toBe(false)
    }
    expect(validateManifest(m)).toEqual([])
  })
})
