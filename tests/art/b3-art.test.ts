// Build-3 art contracts (B3 §5, plan-build3 §6 + §8.3 task 1 + R24): the 13
// event category pictures on the new 48x48 `event-pic` class (world atlas,
// district ui, keyed, outlined, no malware ramp), the 208x104 victory art
// (ui, world), the procedural ic_event bell (icon16, both atlases like
// ic_quest) and the fx_confetti burst (fx 32x32, 8 frames, world); the
// procedural fallbacks of tools/art/eventPics.ts and the PixelLab prompts;
// the per-id colour rules (gold only on the reward pictures, no malware
// ramp on the victory art) and the agent picks installed into art/final.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FRAMES,
  FRAME_ATLAS,
  SHARED_FRAMES,
} from '../../src/render/frames.generated.ts'
import { atlasesOf, placementOf } from '../../tools/art/atlas.ts'
import {
  EVENT_PIC_IDS,
  eventPic,
  victoryPlate,
} from '../../tools/art/eventPics.ts'
import { type Img, bbox, get, opaque, readImg } from '../../tools/art/iso.ts'
import {
  ASSET_CLASSES,
  CLASS_CANVAS,
  ROOT,
  FLEX_CANVAS_CLASSES,
  finalPath,
  getEntry,
  loadManifest,
  validateManifest,
} from '../../tools/art/manifest.ts'
import { entrySubset } from '../../tools/art/normalize.ts'
import { needsOutline } from '../../tools/art/outline.ts'
import {
  GOLD_PICTURES,
  ID_RAMP_DENY,
  PALETTE,
  rampAllowed,
  subsetFor,
} from '../../tools/art/palette.ts'
import {
  EVENT_PIC_PREFIX,
  SUBJECT_OVERRIDES,
  proFlashCost,
  promptFor,
  wantsKey,
} from '../../tools/art/prompts.ts'

const m = loadManifest()

function final(id: string, suffix = ''): Img {
  return readImg(finalPath(getEntry(m, id), id + suffix)).img
}

function rampOf(id: string): string {
  return PALETTE.colors.find((c) => c.id === id)?.ramp ?? id
}

const frameAtlas = FRAME_ATLAS as Record<string, string>
const frames = FRAMES as Record<string, string>

/** [id, class, canvas, frame suffixes, atlases] */
const ROWS: [string, string, [number, number], string[], string[]][] = [
  ...EVENT_PIC_IDS.map(
    (id) =>
      [id, 'event-pic', [48, 48], [''], ['world']] as [
        string,
        string,
        [number, number],
        string[],
        string[],
      ],
  ),
  ['victory_art', 'ui', [208, 104], [''], ['world']],
  ['ic_event', 'icon16', [16, 16], [''], ['world', 'interior']],
  [
    'fx_confetti',
    'fx',
    [32, 32],
    ['_f0', '_f1', '_f2', '_f3', '_f4', '_f5', '_f6', '_f7'],
    ['world'],
  ],
]

describe('the event-pic class (B3 §5)', () => {
  it('is a fixed 48x48 class (not a flex canvas)', () => {
    expect(ASSET_CLASSES).toContain('event-pic')
    expect(CLASS_CANVAS['event-pic']).toEqual([48, 48])
    expect(FLEX_CANVAS_CLASSES).not.toContain('event-pic')
  })

  it('takes gold, red and water but never the malware ramp', () => {
    expect(rampAllowed('gold', 'event-pic')).toBe(true)
    expect(rampAllowed('red', 'event-pic')).toBe(true)
    expect(rampAllowed('water', 'event-pic')).toBe(true)
    expect(rampAllowed('mal', 'event-pic')).toBe(false)
    expect(subsetFor('event-pic').some((c) => c.ramp === 'mal')).toBe(false)
  })

  it('gold only on the reward pictures (coins, the job star, the gift)', () => {
    expect([...GOLD_PICTURES].sort()).toEqual([
      'ev_pic_job',
      'ev_pic_luck',
      'ev_pic_money',
    ])
    for (const id of EVENT_PIC_IDS) {
      const gold = entrySubset(getEntry(m, id)).some((c) => c.ramp === 'gold')
      expect(gold, id).toBe(GOLD_PICTURES.includes(id))
      expect(rampAllowed('gold', 'event-pic', { id }), id).toBe(gold)
    }
  })

  it('the victory art (ui, full palette) never takes the malware ramp', () => {
    expect(ID_RAMP_DENY.victory_art).toEqual(['mal'])
    expect(rampAllowed('mal', 'ui')).toBe(true)
    expect(rampAllowed('mal', 'ui', { id: 'victory_art' })).toBe(false)
    const sub = entrySubset(getEntry(m, 'victory_art'))
    expect(sub.some((c) => c.ramp === 'mal')).toBe(false)
    expect(sub.some((c) => c.ramp === 'gold')).toBe(true)
  })

  it('keeps the STYLE.md outline rule (procedural or generated)', () => {
    for (const id of EVENT_PIC_IDS)
      expect(needsOutline(getEntry(m, id))).toBe(true)
  })

  it('the manifest is still valid with the build-3 rows', () => {
    expect(validateManifest(m)).toEqual([])
  })
})

describe('build-3 frames: in frames.generated.ts with the right atlas and size', () => {
  for (const [id, cls, canvas, sfx, atlases] of ROWS) {
    it(`${id}: ${cls} ${canvas.join('x')} in ${atlases.join(' + ')}`, () => {
      const e = getEntry(m, id)
      expect(e.class).toBe(cls)
      expect(e.canvas).toEqual(canvas)
      expect(e.frames).toEqual(sfx)
      expect(atlasesOf(e)).toEqual(atlases)
      for (const f of sfx) {
        const name = id + f
        expect(frames[name], `${name} in FRAMES`).toBe(name)
        // shared frames ('both') list world as their FRAME_ATLAS
        expect(frameAtlas[name], name).toBe('world')
        expect(SHARED_FRAMES.has(name), name).toBe(atlases.length > 1)
        const p = finalPath(e, name)
        expect(existsSync(p), p).toBe(true)
        const img = final(id, f)
        expect([img.w, img.h], name).toEqual(canvas)
        expect(bbox(img), name).not.toBeNull()
      }
    })
  }

  it('ic_event is placed like ic_quest (both atlases)', () => {
    expect(placementOf(getEntry(m, 'ic_event'))).toBe(
      placementOf(getEntry(m, 'ic_quest')),
    )
  })

  it('the pictures and the victory art are world-only, district ui', () => {
    for (const id of [...EVENT_PIC_IDS, 'victory_art']) {
      const e = getEntry(m, id)
      expect(e.atlas, id).toBe('world')
      expect(e.district, id).toBe('ui')
      expect(e.source, id).toBe('pixellab')
      expect(e.subject, id).toBeTruthy()
    }
  })
})

describe('the shipped pictures obey the contract', () => {
  for (const id of EVENT_PIC_IDS) {
    it(`${id}: palette-only, no malware ramp, outlined silhouette`, () => {
      const img = final(id)
      const allowed = new Set(entrySubset(getEntry(m, id)).map((c) => c.id))
      let edgeOff = 0
      for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
          const c = get(img, x, y)
          if (c === null) continue
          expect(allowed.has(c), `${id} (${x},${y}) ${c}`).toBe(true)
          expect(rampOf(c)).not.toBe('mal')
          if (!GOLD_PICTURES.includes(id)) expect(rampOf(c)).not.toBe('gold')
          const edge =
            !opaque(img, x - 1, y) ||
            !opaque(img, x + 1, y) ||
            !opaque(img, x, y - 1) ||
            !opaque(img, x, y + 1)
          if (edge && c !== 'outline') edgeOff++
        }
      }
      expect(edgeOff, `${id}: silhouette pixels not outline`).toBe(0)
      // a readable picture: the content spans at least half the canvas
      const b = bbox(img)!
      expect(Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1)).toBeGreaterThanOrEqual(
        24,
      )
    })
  }
})

describe('procedural fallbacks (tools/art/eventPics.ts, R24)', () => {
  it('every category has a 48x48 composition that differs from the others', () => {
    const seen = new Set<string>()
    for (const id of EVENT_PIC_IDS) {
      const g = eventPic(id)
      expect([g.w, g.h]).toEqual([48, 48])
      const key = g.px.join(',')
      expect(seen.has(key), id).toBe(false)
      seen.add(key)
      expect(g.px.some((c) => c !== null && rampOf(c) === 'mal')).toBe(false)
    }
  })

  it('off the reward pictures the fallbacks paint no gold', () => {
    for (const id of EVENT_PIC_IDS) {
      if (GOLD_PICTURES.includes(id)) continue
      const g = eventPic(id)
      expect(
        g.px.some((c) => c !== null && rampOf(c) === 'gold'),
        id,
      ).toBe(false)
    }
  })

  it('the victory plate is 208x104, opaque, framed in outline', () => {
    const g = victoryPlate()
    expect([g.w, g.h]).toEqual([208, 104])
    expect(g.px.every((c) => c !== null)).toBe(true)
    for (const [x, y] of [
      [0, 0],
      [207, 0],
      [0, 103],
      [207, 103],
      [104, 0],
      [0, 52],
    ] as const) {
      expect(g.get(x, y)).toBe('outline')
    }
  })
})

describe('fx_confetti and ic_event', () => {
  it('fx_confetti: every frame keeps a 1-px clear margin, the burst thins out', () => {
    const counts: number[] = []
    for (let f = 0; f < 8; f++) {
      const img = final('fx_confetti', `_f${f}`)
      for (let k = 0; k < 32; k++) {
        for (const [x, y] of [
          [k, 0],
          [k, 31],
          [0, k],
          [31, k],
        ] as const) {
          expect(opaque(img, x, y), `f${f} (${x},${y})`).toBe(false)
        }
      }
      let n = 0
      for (const i of img.px) if (i >= 0) n++
      counts.push(n)
    }
    // it grows out of the flash, then pieces leave or land
    expect(Math.max(...counts)).toBeGreaterThan(counts[0]!)
    expect(counts[7]!).toBeLessThan(Math.max(...counts))
  })

  it('ic_event: a 16x16 icon with the 1-px margin, an orange bell', () => {
    const img = final('ic_event')
    for (let k = 0; k < 16; k++) {
      expect(opaque(img, k, 0)).toBe(false)
      expect(opaque(img, k, 15)).toBe(false)
      expect(opaque(img, 0, k)).toBe(false)
      expect(opaque(img, 15, k)).toBe(false)
    }
    const ramps = (i: Img) => {
      const n = new Map<string, number>()
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const r = rampOf(get(i, x, y) ?? '')
          n.set(r, (n.get(r) ?? 0) + 1)
        }
      }
      return n
    }
    // not the rush bell: an orange body where ic_bell is yellow, so the
    // two read apart at 16 px (the HUD chip and the city's rush glyph)
    expect(ramps(img).get('orange') ?? 0).toBeGreaterThan(40)
    expect(ramps(img).get('yellow') ?? 0).toBe(0)
    expect(ramps(final('ic_bell')).get('yellow') ?? 0).toBeGreaterThan(40)
  })
})

describe('PixelLab prompts (B3 §5)', () => {
  it('event-pic: Pro Flash at 48x48 on a key background, the frozen prefix, 5 generations', () => {
    for (const id of EVENT_PIC_IDS) {
      const e = getEntry(m, id)
      const p = promptFor(e)
      expect(p.endpoint).toBe('/create-image-pro-flash')
      const subject = SUBJECT_OVERRIDES[id] ?? e.subject
      expect(p.text.startsWith(`${EVENT_PIC_PREFIX}: ${subject}`)).toBe(true)
      expect(p.text).toMatch(/plain solid flat (magenta|cyan) background/)
      expect(p.params.image_size).toEqual({ width: 48, height: 48 })
      expect(p.params.no_background).toBe(false)
      expect(wantsKey(e)).toBe(true)
      expect(p.cost).toBe(5)
    }
  })

  it('victory_art: Pro Flash at 208x104 on a key background, 6 generations', () => {
    const e = getEntry(m, 'victory_art')
    const p = promptFor(e)
    expect(p.endpoint).toBe('/create-image-pro-flash')
    expect(p.text.startsWith(e.subject!)).toBe(true)
    expect(p.text).toMatch(/plain solid flat (magenta|cyan) background/)
    expect(p.params.image_size).toEqual({ width: 208, height: 104 })
    expect(p.cost).toBe(6)
  })

  it('proFlashCost follows the measured bands (5 / 6 / 9)', () => {
    expect(proFlashCost(48, 48)).toBe(5)
    expect(proFlashCost(96, 96)).toBe(5)
    expect(proFlashCost(208, 104)).toBe(6)
    expect(proFlashCost(160, 160)).toBe(6)
    expect(proFlashCost(192, 224)).toBe(9)
    expect(proFlashCost(256, 256)).toBe(9)
  })
})

describe('the agent picks (G7 pending, approved: false)', () => {
  const ids = [...EVENT_PIC_IDS, 'victory_art']

  it('every picture has a chosen candidate, unapproved, not a placeholder', () => {
    for (const id of ids) {
      const e = getEntry(m, id)
      expect(e.chosenCandidate, id).toBeTypeOf('number')
      expect(e.approved, id).toBe(false)
      expect(e.placeholder, id).toBe(false)
      // the pick is never one of the agent's own rejects
      expect(
        e.rejects.some(
          (r) => r.candidate === e.chosenCandidate && r.by === 'claude',
        ),
        id,
      ).toBe(false)
    }
  })

  // art/candidates is gitignored (it lives on the art VM only); a
  // single-frame candidate is art/candidates/<id>/<n>/base.png
  const pick = (id: string, n: number) =>
    join(ROOT, 'art/candidates', id, String(n), 'base.png')
  const local = existsSync(pick('victory_art', 0))
  it.skipIf(!local)('art/final holds the chosen candidate', () => {
    for (const id of ids) {
      const e = getEntry(m, id)
      const src = pick(id, e.chosenCandidate!)
      expect(readFileSync(finalPath(e, id)).equals(readFileSync(src)), id).toBe(
        true,
      )
    }
  })

  it('the port re-roll keeps the stamp free of glyphs (B3 §5 no text)', () => {
    expect(SUBJECT_OVERRIDES.ev_pic_port).toMatch(/check mark/)
    expect(SUBJECT_OVERRIDES.ev_pic_port).toMatch(/no letters/)
  })
})
