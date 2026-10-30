// Build-2 M7 art contracts (design-m7 §6.1, §6.8; plan-build2 §6 Rural /
// Warehouse exterior, §8.4; B2 §3.3, §6.5, §6.6): the quest frames (world
// atlas, gold), the golden parcel, the ★ glyph, the Rural uniques replacing
// the shared scenery, the hay_bale prop and the tier 3-5 exteriors with
// their manifest anchors.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRAME_ATLAS, WH_ANCHORS } from '../../src/render/frames.generated.ts'
import { atlasesOf, placementOf } from '../../tools/art/atlas.ts'
import { type DrawCtx, makeCanvas } from '../../tools/art/draw-api.ts'
import { drawTierExt } from '../../tools/art/exterior.ts'
import { DRAWN, XML_PATH } from '../../tools/art/font.ts'
import {
  type Img,
  bbox,
  exteriorBaseOk,
  get,
  opaque,
  readImg,
} from '../../tools/art/iso.ts'
import {
  ROOT,
  buildingCoverage,
  finalPath,
  getEntry,
  loadBuildingIds,
  loadManifest,
  validateManifest,
  warehouseAnchorTable,
} from '../../tools/art/manifest.ts'
import { PALETTE, subsetFor } from '../../tools/art/palette.ts'
import { EDIT_OF, promptFor } from '../../tools/art/prompts.ts'
import { rngFor } from '../../tools/art/rng.ts'

const m = loadManifest()

/** the final of `id` + `suffix` as an Img */
function final(id: string, suffix = ''): Img {
  return readImg(finalPath(getEntry(m, id), id + suffix)).img
}

/** the draw context `vlr art:draw` gives an entry (build.ts drawCtxFor) */
function drawCtx(id: string): DrawCtx {
  const e = getEntry(m, id)
  const subset = subsetFor(e.class, { district: e.district })
  return {
    entry: e,
    rng: rngFor(e.id),
    pal: PALETTE,
    subset,
    hex: (name) => PALETTE.hex(name),
    newCanvas: makeCanvas,
  }
}

/** palette ramp of every opaque pixel, counted */
function ramps(img: Img): Map<string, number> {
  const out = new Map<string, number>()
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const id = get(img, x, y)
      if (id === null) continue
      const ramp = PALETTE.colors.find((c) => c.id === id)?.ramp ?? id
      out.set(ramp, (out.get(ramp) ?? 0) + 1)
    }
  }
  return out
}

const QUEST_FRAMES: [string, string, [number, number], string[]][] = [
  ['ic_quest', 'icon16', [16, 16], ['']],
  ['ic_magic', 'icon16', [16, 16], ['']],
  ['ui_card_gold', 'ui', [16, 16], ['']],
  ['ui_bar_fill_gold', 'ui', [8, 8], ['']],
  ['magic_ring', 'fx', [16, 16], ['_0', '_1', '_2', '_3']],
]

describe('quest frames (design-m7 §6.1): world atlas, names are the contract', () => {
  for (const [id, cls, canvas, frames] of QUEST_FRAMES) {
    it(`${id}: ${cls} ${canvas.join('x')}, drawn, packed into world`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe(cls)
      expect(e.source).toBe('procedural')
      expect(e.canvas).toEqual(canvas)
      expect(e.frames).toEqual(frames)
      // the HUD and src/ui/** bind world only: never an interior-only frame
      expect(atlasesOf(e)).toContain('world')
      for (const f of frames) {
        const name = id + f
        expect(existsSync(finalPath(e, name)), name).toBe(true)
        expect(bbox(final(id, f)), name).not.toBeNull()
        expect((FRAME_ATLAS as Record<string, string>)[name], name).toBe(
          'world',
        )
      }
    })
  }

  it('ic_star (M6) is still there for the ★ newspaper / applicant picture', () => {
    expect(placementOf(getEntry(m, 'ic_star'))).toBe('both')
  })

  it('ui_card_gold: ui_panel inside a 2-px gold border, cream face', () => {
    const img = final('ui_card_gold')
    const ring = (x: number, y: number) => get(img, x, y) ?? ''
    // left edge, mid height: outline, then two gold px, then the face
    expect(ring(0, 8)).toBe('outline')
    expect(ring(1, 8)).toMatch(/^gold/)
    expect(ring(2, 8)).toMatch(/^gold/)
    expect(ring(8, 8)).toBe('grey5')
    // the lit / shaded sides of the border differ (gold2 top-left, gold0 bottom-right)
    expect(ring(1, 8)).toBe('gold2')
    expect(ring(14, 8)).toBe('gold0')
  })

  it('ui_bar_fill_gold: the bar fill geometry of ui_bar_fill_green in the gold ramp', () => {
    const gold = final('ui_bar_fill_gold')
    const green = final('ui_bar_fill_green')
    for (let i = 0; i < gold.px.length; i++) {
      expect(gold.px[i]! < 0).toBe(green.px[i]! < 0)
    }
    const r = ramps(gold)
    expect(r.get('gold')).toBeGreaterThan(0)
    expect(r.get('grass') ?? 0).toBe(0)
  })

  it('magic_ring: the rush_ring geometry in gold, draining _0 -> _3', () => {
    const golds: number[] = []
    for (const f of ['_0', '_1', '_2', '_3']) {
      const ring = final('magic_ring', f)
      const rush = final('rush_ring', f)
      for (let i = 0; i < ring.px.length; i++) {
        expect(ring.px[i]! < 0, `${f} px ${i}`).toBe(rush.px[i]! < 0)
      }
      const r = ramps(ring)
      expect(r.get('blue') ?? 0).toBe(0)
      golds.push(r.get('gold') ?? 0)
    }
    for (let k = 1; k < golds.length; k++) {
      expect(golds[k]!).toBeLessThan(golds[k - 1]!)
    }
  })

  it('ic_quest: a clipboard (brown board, cream sheet) with a gold star', () => {
    const r = ramps(final('ic_quest'))
    expect(r.get('gold')).toBeGreaterThanOrEqual(15)
    expect(r.get('brown')).toBeGreaterThan(0)
    expect(r.get('grey')).toBeGreaterThan(0)
  })

  it('ic_magic matches parcel_s_magic: gold box, pink ribbon, a white sparkle', () => {
    for (const [id, f] of [
      ['ic_magic', ''],
      ['parcel_s', '_magic'],
    ] as const) {
      const r = ramps(final(id, f))
      const body = [...r.entries()]
        .filter(([k]) => k !== 'outline')
        .reduce((a, [, n]) => a + n, 0)
      // reads gold: the gold ramp is most of the body
      expect((r.get('gold') ?? 0) / body, `${id}${f}`).toBeGreaterThan(0.5)
      expect(r.get('pink'), `${id}${f}`).toBeGreaterThan(0)
    }
    const img = final('ic_magic')
    let sparkle = 0
    for (let i = 0; i < img.px.length; i++) {
      if (get(img, i % img.w, Math.floor(i / img.w)) === 'grey5') sparkle++
    }
    expect(sparkle).toBe(1)
  })
})

describe('m5x7 ★ (design-m7 §6.1: the ticker star-applicant line)', () => {
  it('DRAWN has U+2605 at cap height and the XML lists it', () => {
    const star = DRAWN.find(([id]) => id === 0x2605)
    expect(star).toBeDefined()
    const [, adv, , yoff, rows] = star!
    expect(rows).toHaveLength(7)
    expect(yoff).toBe(4)
    expect(adv).toBeGreaterThanOrEqual(Math.max(...rows.map((r) => r.length)))
    expect(readFileSync(XML_PATH, 'utf8')).toContain('<char id="9733"')
  })
})

const RURAL = [
  'ru_peer_pasture',
  'ru_dev_dairy',
  'ru_range_ranch',
  'ru_optional_orchard',
  'ru_hay_barn',
  'ru_grain_coop',
  'ru_caret_mill',
  'ru_tilde_tractors',
  'ru_semver_stables',
  'ru_farmhouse_once',
]

describe('Rural uniques (plan-build2 §6 Rural, B2 §6.5)', () => {
  it('each rural building maps to its own sprite', () => {
    const ids = loadBuildingIds() ?? []
    expect(ids.filter((b) => b.startsWith('ru_')).toSorted()).toEqual(
      RURAL.toSorted(),
    )
    const { map, errors } = buildingCoverage(m, ids)
    expect(errors).toEqual([])
    for (const id of RURAL) {
      expect(map.get(id)).toBe(id)
      const e = getEntry(m, id)
      expect(e.source).toBe('pixellab')
      expect(e.district).toBe('rural')
      expect(e.variants).toContain('locked')
      expect(e.coversBuildings).toBeUndefined()
      const fp = e.footprint?.[0]
      expect(e.class).toBe(`building${fp}x${fp}`)
      expect(existsSync(finalPath(e, id))).toBe(true)
      expect(existsSync(finalPath(e, `${id}_locked`))).toBe(true)
    }
  })

  it('the shared Rural scenery is retired, its finals gone', () => {
    const retired = m.retired ?? []
    for (const id of ['ru_farm', 'ru_barn', 'ru_orchard', 'ru_farmhouse']) {
      const r = retired.find((x) => x.id === id)
      expect(r, id).toBeDefined()
      expect(r?.reason.length).toBeGreaterThan(0)
      expect(m.entries.some((e) => e.id === id)).toBe(false)
    }
    expect(validateManifest(m)).toEqual([])
  })

  it('hay_bale: a procedural rural prop with its _locked twin', () => {
    const e = getEntry(m, 'hay_bale')
    expect(e.class).toBe('prop')
    expect(e.source).toBe('procedural')
    expect(e.variants).toEqual(['locked'])
    const r = ramps(final('hay_bale'))
    expect(r.get('yellow')).toBeGreaterThan(r.get('brown') ?? 0)
    expect(existsSync(finalPath(e, 'hay_bale_locked'))).toBe(true)
  })
})

describe('warehouse exteriors t3-t5 (B2 §6.1, §6.6)', () => {
  const TIERS = ['wh_ext_t3', 'wh_ext_t4', 'wh_ext_t5']

  it('one warehouse-ext row per tier, frame name = id, packed into world', () => {
    for (const id of TIERS) {
      const e = getEntry(m, id)
      expect(e.class).toBe('warehouse-ext')
      expect(e.frames).toEqual([''])
      expect(e.footprint).toEqual([4, 4])
      expect(atlasesOf(e)).toEqual(['world'])
      expect((FRAME_ATLAS as Record<string, string>)[id]).toBe('world')
    }
  })

  it('t4 is an edit of the chosen t3 (same footprint and bays)', () => {
    expect(EDIT_OF.wh_ext_t4?.source).toBe('wh_ext_t3')
    expect(promptFor(getEntry(m, 'wh_ext_t4')).editOf).toBe('wh_ext_t3')
    expect(promptFor(getEntry(m, 'wh_ext_t4')).endpoint).toBe(
      '/edit-image-pro-flash',
    )
    // only tier 1 carries the _t2 follow-up edit
    expect(promptFor(getEntry(m, 'wh_ext')).followUp?.frame).toBe('_t2')
    expect(promptFor(getEntry(m, 'wh_ext_t3')).followUp).toBeUndefined()
  })

  it('every tier stands on the 4x4 diamond (lint A04 strict, no apron)', () => {
    for (const id of TIERS) {
      expect(exteriorBaseOk(final(id), 256), id).toEqual([])
    }
  })

  it('the procedural stand-ins stand on the diamond too', () => {
    for (const [id, tier] of [
      ['wh_ext_t3', 3],
      ['wh_ext_t4', 4],
      ['wh_ext_t5', 5],
    ] as const) {
      const img = drawTierExt(drawCtx(id), tier)
      expect(exteriorBaseOk(img, 256), id).toEqual([])
      expect(opaque(img, 127, 255)).toBe(true)
    }
  })

  it('WH_ANCHORS carries every tier: 2 bay lights at t3, 3 at t4 / t5', () => {
    const table = warehouseAnchorTable(m)
    expect(Object.keys(table)).toEqual(
      expect.arrayContaining([
        'wh_ext_t1',
        'wh_ext_t2',
        'wh_ext_t3',
        'wh_ext_t4',
        'wh_ext_t5',
      ]),
    )
    // frames.generated WH_ANCHORS (the city's copy) by frame name
    const gen = WH_ANCHORS as Readonly<
      Record<string, { bayLights: readonly unknown[] } | undefined>
    >
    expect(gen.wh_ext_t3?.bayLights).toHaveLength(2)
    expect(gen.wh_ext_t4?.bayLights).toHaveLength(3)
    expect(gen.wh_ext_t5?.bayLights).toHaveLength(3)
    for (const id of TIERS) {
      const set = table[id]
      expect(set, id).toBeDefined()
      for (const [x] of set!.bayLights) expect(x).toBeLessThan(128) // SW face
      // the docked pose stands in front of bay 1, low on the canvas
      expect(set!.dockPose[1]).toBeGreaterThan(128)
    }
    // tier 1 stays the row's own set (cityFx BAY_LIGHTS); M8 adds the
    // per-bay dockPoses (first = dockPose), checked in m8-art.test.ts
    expect(table.wh_ext_t1).toMatchObject({
      bayLights: getEntry(m, 'wh_ext').bayLights,
      dockPose: getEntry(m, 'wh_ext').dockPose,
    })
  })
})

describe('contact sheets (M7 G5 / G6)', () => {
  it('rural@4x.png and tiers@4x.png exist', () => {
    for (const f of ['rural@4x.png', 'tiers@4x.png']) {
      expect(existsSync(`${ROOT}art/contact/${f}`), f).toBe(true)
    }
  })
})
