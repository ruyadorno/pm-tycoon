// Build-2 M9 art contracts (design-m8-m9 §6.1, §6.4, §8 lane F; plan-build2
// §6 "Interiors t3–t5", Airport "runway themed tiles", §8.6; B2 §4.2-§4.4,
// §6.6): the tier-4 / tier-5 room pieces (names, canvases, interior atlas,
// the shared 20x5 @11 shelf geometry, neon_strip on the strip_light spots),
// the runway tiles, the M9 re-rolls (dk_ship bow first along its -x exit,
// the X-ray scanner), the G5 / G6 sheets and the m5x7 ✓ (U+2713).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRAME_ATLAS, inAtlas } from '../../src/render/frames.generated.ts'
import { atlasesOf } from '../../tools/art/atlas.ts'
import { DRAWN, XML_PATH } from '../../tools/art/font.ts'
import { type Img, bbox, get, readImg } from '../../tools/art/iso.ts'
import {
  ROOT,
  finalPath,
  getEntry,
  loadManifest,
} from '../../tools/art/manifest.ts'
import { promptFor } from '../../tools/art/prompts.ts'

const m = loadManifest()

function final(id: string, suffix = ''): Img {
  return readImg(finalPath(getEntry(m, id), id + suffix)).img
}

/** pixels of `img` whose palette id matches `re` */
function count(img: Img, re: RegExp): number {
  let n = 0
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) if (re.test(get(img, x, y) ?? '')) n++
  }
  return n
}

const has = (img: Img, re: RegExp): boolean => count(img, re) > 0

const ROOM: [string, string, [number, number], string[]][] = [
  ['floor_t4', 'interior-tile', [32, 32], ['']],
  ['floor_t4_lane', 'interior-tile', [32, 32], ['']],
  ['floor_t5', 'interior-tile', [32, 32], ['']],
  ['floor_t5_lane', 'interior-tile', [32, 32], ['']],
  ['wall_t4', 'interior-tile', [32, 32], ['']],
  ['wall_t5', 'interior-tile', [32, 32], ['']],
  ['wallface_t4', 'interior-tile', [32, 32], ['']],
  ['wallface_t5', 'interior-tile', [32, 32], ['']],
  ['sign_t4', 'sign', [200, 24], ['']],
  ['sign_t5', 'sign', [200, 24], ['']],
  ['shelf_t4', 'fixture-shelf', [224, 64], ['']],
  ['shelf_t5', 'fixture-shelf', [224, 64], ['']],
  ['props_t4', 'interior-prop', [48, 64], ['']],
  ['props_t5', 'interior-prop', [48, 64], ['']],
  ['wanted_poster_t4', 'interior-prop', [32, 32], ['']],
  ['wanted_poster_t5', 'interior-prop', [32, 32], ['']],
  ['neon_strip', 'interior-prop', [64, 8], ['_f0', '_f1']],
]

describe('tier-4 / tier-5 room pieces (design-m8-m9 §6.4 M9): room back layers, interior atlas', () => {
  for (const [id, cls, canvas, frames] of ROOM) {
    it(`${id}: ${cls} ${canvas.join('x')}, procedural, interior only`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe(cls)
      expect(e.source).toBe('procedural')
      expect(e.canvas).toEqual(canvas)
      expect(e.frames).toEqual(frames)
      expect(atlasesOf(e)).toEqual(['interior'])
      for (const f of frames) {
        expect(existsSync(finalPath(e, id + f)), id + f).toBe(true)
        expect(bbox(final(id, f)), id + f).not.toBeNull()
        expect((FRAME_ATLAS as Record<string, string>)[id + f]).toBe('interior')
      }
    })
  }

  it('the props share the props_t3 canvas, the neon the strip_light one', () => {
    const p3 = getEntry(m, 'props_t3').canvas
    expect(getEntry(m, 'props_t4').canvas).toEqual(p3)
    expect(getEntry(m, 'props_t5').canvas).toEqual(p3)
    expect(getEntry(m, 'neon_strip').canvas).toEqual(
      getEntry(m, 'strip_light').canvas,
    )
  })

  it('the floor and wall tiles are opaque 32x32 (they tile the room)', () => {
    for (const t of [4, 5]) {
      for (const stem of ['floor', 'floor_lane', 'wall', 'wallface']) {
        const id = stem === 'floor_lane' ? `floor_t${t}_lane` : `${stem}_t${t}`
        expect(
          final(id).px.every((p) => p >= 0),
          id,
        ).toBe(true)
      }
    }
  })

  it('the lane tiles: the floor colours plus 2-px lines at x 0-1 / 30-31 (t4 yellow, t5 pink)', () => {
    for (const [t, ramp] of [
      [4, /^yellow/],
      [5, /^pink/],
    ] as const) {
      const lane = final(`floor_t${t}_lane`)
      const plain = final(`floor_t${t}`)
      for (const x of [0, 1, 30, 31]) {
        for (let y = 0; y < 32; y++) {
          expect(get(lane, x, y), `t${t} ${x},${y}`).toMatch(ramp)
        }
      }
      // inside the lines: the floor's own colours (its specks are seeded
      // per id, so not pixel-identical)
      const floor = new Set<string | null>()
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) floor.add(get(plain, x, y))
      }
      for (let y = 0; y < 32; y++) {
        for (let x = 2; x < 30; x++) {
          expect(floor.has(get(lane, x, y)), `t${t} ${x},${y}`).toBe(true)
        }
      }
    }
  })

  it('sign_t4 / sign_t5: a light face in the text area (LaneRenderer signDark: dark text at t >= 2)', () => {
    for (const id of ['sign_t4', 'sign_t5']) {
      const img = final(id)
      let light = 0
      let n = 0
      for (let y = 4; y <= 19; y++) {
        for (let x = 8; x <= 191; x++) {
          n++
          if (get(img, x, y) === 'grey5') light++
        }
      }
      expect(light / n, id).toBeGreaterThan(0.9)
    }
  })

  it('shelf_t4 / shelf_t5: the 20x5 @11 deck rows of shelf_t3 (C ↔ F contract)', () => {
    for (const id of ['shelf_t4', 'shelf_t5']) {
      const img = final(id)
      expect(
        img.px.slice(0, 224 * 63).every((p) => p >= 0),
        id,
      ).toBe(true)
      for (let r = 0; r < 5; r++) {
        const y = 4 + 11 * r
        expect(get(img, 50, y), `${id} row ${r} top`).toBe('grey5')
        expect(get(img, 50, y + 10), `${id} row ${r} seam`).toBe('grey2')
      }
      expect(get(img, 50, 63), id).toBe('outline')
      // the front beam under the last row is not the deck colour
      expect(get(img, 50, 60), id).not.toBe(get(img, 50, 30))
    }
  })

  it('neon_strip: pink tube, f0 lit (a white-hot core) and f1 dimmer', () => {
    const f0 = final('neon_strip', '_f0')
    const f1 = final('neon_strip', '_f1')
    expect(count(f0, /^pink/)).toBeGreaterThan(50)
    expect(count(f1, /^pink/)).toBeGreaterThan(50)
    expect(get(f0, 30, 3)).toBe('grey5')
    expect(get(f1, 30, 3)).toMatch(/^pink/)
  })
})

describe('Airport runway tiles (plan-build2 §6 "runway themed tiles")', () => {
  for (const id of ['runway_threshold', 'taxiway']) {
    it(`${id}: tile 64x32, procedural, world, with its _locked twin`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe('tile')
      expect(e.canvas).toEqual([64, 32])
      expect(e.district).toBe('airport')
      expect(e.variants).toEqual(['locked'])
      expect(atlasesOf(e)).toEqual(['world'])
      expect(inAtlas(id, 'world')).toBe(true)
      expect(inAtlas(`${id}_locked`, 'world')).toBe(true)
    })
  }

  it('the threshold paints white bars, the taxiway a yellow line', () => {
    expect(has(final('runway_threshold'), /^grey5$/)).toBe(true)
    expect(has(final('taxiway'), /^yellow2$/)).toBe(true)
    expect(has(final('runway'), /^grey5$/)).toBe(false)
  })
})

describe('M9 re-rolls (agent picks, approved false until the author)', () => {
  it('dk_ship: the hull runs from the lower right to the upper left (bow first along exit [-5, 0])', () => {
    const e = getEntry(m, 'dk_ship')
    expect(e.chosenCandidate).toBe(5)
    expect(e.approved).toBe(false)
    expect(promptFor(e).text).toMatch(/bow pointing to the upper left/)
    const img = final('dk_ship')
    // the leftmost opaque column sits higher than the rightmost one
    let left: [number, number] | null = null
    let right: [number, number] | null = null
    for (let x = 0; x < img.w && !left; x++) {
      for (let y = 0; y < img.h; y++) {
        if ((img.px[y * img.w + x] as number) >= 0) {
          left = [x, y]
          break
        }
      }
    }
    for (let x = img.w - 1; x >= 0 && !right; x--) {
      for (let y = img.h - 1; y >= 0; y--) {
        if ((img.px[y * img.w + x] as number) >= 0) {
          right = [x, y]
          break
        }
      }
    }
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(left![1]).toBeLessThan(right![1])
    expect(inAtlas('dk_ship', 'world')).toBe(true)
    expect(inAtlas('dk_ship_locked', 'world')).toBe(true)
  })

  it('xray: the M9 pick (#7, a header screen with the x-ray picture), both atlases', () => {
    const e = getEntry(m, 'xray')
    expect(e.chosenCandidate).toBe(7)
    expect(e.approved).toBe(false)
    expect(atlasesOf(e)).toEqual(['world', 'interior'])
    // the rejected M6 pick stays in the provenance
    expect(e.rejects.some((r) => r.candidate === 0)).toBe(true)
  })
})

describe('G5 / G6 contact sheets (plan-build2 §6 approval gates)', () => {
  it('the five region sheets, tiers and the G6 sheet exist', () => {
    for (const f of [
      'lowres@4x.png',
      'rural@4x.png',
      'airport@4x.png',
      'civic@4x.png',
      'docks@4x.png',
      'tiers@4x.png',
      'g6-tiers-machines-people@4x.png',
    ]) {
      expect(existsSync(`${ROOT}art/contact/${f}`), f).toBe(true)
    }
  })
})

describe('m5x7 ✓ (design-m8-m9 §6.3: "Tycoon ✓" on the bar, toast and Title)', () => {
  it('DRAWN has U+2713 at x-height (like v) and the XML lists it', () => {
    const check = DRAWN.find(([id]) => id === 0x2713)
    expect(check).toBeDefined()
    const [, adv, , yoff, rows] = check!
    expect(rows).toHaveLength(5)
    expect(yoff).toBe(6)
    expect(adv).toBeGreaterThanOrEqual(Math.max(...rows.map((r) => r.length)))
    expect(readFileSync(XML_PATH, 'utf8')).toContain('<char id="10003"')
  })
})
