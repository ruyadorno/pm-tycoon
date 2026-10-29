// city-view.md §8.2 (the newspaper card — the Transport Tycoon nod), plan.md
// §9 "Newspaper": masthead from puns.json companyName, the picture per kind,
// the headline wrapped at 236 px in at most 4 lines, one paper at a time with
// a short queue, the resting place 8 px above the bottom bar, and the
// palette-snapped "photo" made for frames larger than the 48×48 box (no GPU
// scaling of world art, AGENTS.md). Pure helpers only; Phaser is stubbed
// because the module imports the Button kit.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const np = await import('../../src/ui/Newspaper.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { PALETTE } = await import('../../src/ui/theme.ts')
const { dataFixture } = await import('../sim/helpers.ts')

const data = dataFixture()
/** A stand-in for BitmapText width: 6 px per character. */
const measure = (s: string): number => s.length * 6

const area = (b: { footprint: readonly number[] }): number =>
  (b.footprint[0] ?? 0) * (b.footprint[1] ?? 0)

function item(headline: string, kind: 'level' | 'incident' = 'level') {
  return { kind, headline, day: 3, level: 2, picture: null }
}

describe('city-view §8.2: masthead and corners', () => {
  it('THE NODE HEIGHTS GAZETTE comes from puns.json companyName', () => {
    expect(data.puns.companyName).toBe('Node Heights Courier')
    expect(np.mastheadTitle(data.puns.companyName)).toBe(
      'THE NODE HEIGHTS GAZETTE',
    )
    expect(np.mastheadTitle('Lockfile')).toBe('THE LOCKFILE GAZETTE')
  })
})

describe('city-view §8.2: a 48×48 picture by kind', () => {
  it('level → the new tier wh_ext_tN (levels.json warehouseTier)', () => {
    expect(np.newsPicture('level', data, { level: 2 })).toBe('wh_ext_t2')
    expect(np.newsPicture('level', data, { level: 1 })).toBe('wh_ext_t1')
  })

  it('incident → parcel_m_mal; walkout → the worker idle frame', () => {
    expect(np.newsPicture('incident', data)).toBe('parcel_m_mal')
    expect(np.newsPicture('walkout', data)).toBe('worker_s_idle_0')
  })

  it("region → the region's hero building (largest footprint, first on ties)", () => {
    const hero = np.heroBuilding(data, 'industrial')
    expect(hero?.district).toBe('industrial')
    const max = Math.max(
      ...data.buildings.filter((b) => b.district === 'industrial').map(area),
    )
    expect(area(hero!)).toBe(max)
    expect(np.newsPicture('region', data, { district: 'industrial' })).toBe(
      hero!.id,
    )
    expect(np.heroBuilding(data, 'nowhere')).toBeNull()
  })

  it('fits a frame inside the box keeping its aspect, never upscaling', () => {
    expect(np.fitBox(32, 32, 48)).toEqual({ w: 32, h: 32 })
    expect(np.fitBox(24, 32, 48)).toEqual({ w: 24, h: 32 })
    expect(np.fitBox(256, 170, 46)).toEqual({ w: 46, h: 31 })
    expect(np.fitBox(192, 183, 46)).toEqual({ w: 46, h: 44 })
  })
})

describe('city-view §8.2: the headline wraps at 236 px, at most 4 lines', () => {
  it('wraps the levels.json L2 line on spaces inside 236 px', () => {
    const row = data.levels.find((l) => l.level === 2)!
    const lines = np.wrapHeadline(row.ticker, np.HEADLINE_W, 4, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(4)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(236)
    expect(lines.join(' ')).toBe(row.ticker)
  })

  it('cuts a 5th line: the 4th ends with … and still fits', () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const lines = np.wrapHeadline(text, 60, 4, measure)
    expect(lines).toHaveLength(4)
    expect(lines[3]!.endsWith('…')).toBe(true)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(60)
  })

  it('a short headline stays one line', () => {
    expect(np.wrapHeadline('Hoist Hill is now open', 236, 4, measure)).toEqual([
      'Hoist Hill is now open',
    ])
  })
})

describe('city-view §8.2: the TTD page look (greeked body columns)', () => {
  it('fills each row inside the column with em-dash words, deterministic per headline', () => {
    const a = np.greekLines('Hoist Hill is now open', 10, 100, measure)
    expect(a).toHaveLength(10)
    for (const l of a) {
      expect(l).toMatch(/^[— ]*$/)
      expect(measure(l)).toBeLessThanOrEqual(100)
    }
    expect(np.greekLines('Hoist Hill is now open', 10, 100, measure)).toEqual(a)
    expect(np.greekLines('Another headline', 10, 100, measure)).not.toEqual(a)
    // A paragraph end (a short line) within the first 5 rows.
    expect(a.slice(0, 5).some((l) => measure(l) < 70)).toBe(true)
  })
})

describe('city-view §8.2: one paper at a time, the rest queue', () => {
  it('shows the first, queues later ones, never the same headline twice', () => {
    const q = new np.NewspaperQueue()
    expect(q.push(item('A'))).toBe('show')
    expect(q.push(item('B'))).toBe('queued')
    expect(q.push(item('A'))).toBe('duplicate')
    expect(q.push(item('B'))).toBe('duplicate')
    expect(q.next()?.headline).toBe('B')
    expect(q.next()).toBeNull()
  })

  it(`keeps at most ${np.PAPER_QUEUE_MAX} waiting, dropping the oldest`, () => {
    const q = new np.NewspaperQueue()
    q.push(item('now'))
    for (const h of ['1', '2', '3', '4']) q.push(item(h))
    expect(q.waiting.map((w) => w.headline)).toEqual(['2', '3', '4'])
  })

  it('does not pause the sim and auto-dismisses after 6 s (Q39)', () => {
    expect(np.PAPER_SHOW_MS).toBe(6000)
    expect(np.PAPER_IN_MS).toBe(300)
  })
})

describe('city-view §8.2: 300×180, 8 px above the bottom bar', () => {
  it('rests at H − safeBottom − 64 − 8 − 180, centred, at most W − 12 wide', () => {
    for (const [W, H, sb] of [
      [360, 640, 0],
      [393, 852, 34],
      [430, 932, 34],
    ] as const) {
      const L = computeLayout(W, H, 47, sb, 1)
      expect(np.paperY(L)).toBe(H - sb - 64 - 8 - 180)
      expect(np.paperWidth(W)).toBe(300)
      // The paper clears the top bar + ticker + toast lane.
      expect(np.paperY(L)).toBeGreaterThan(L.toast.y + L.toast.h)
    }
    expect(np.paperWidth(300)).toBe(288)
  })
})

describe('AGENTS.md (no GPU scaling of world art): the palette-snapped photo', () => {
  it('box-filters with alpha weighting and a hard 50 % alpha cut', () => {
    // 4x2 source → 2x1: the left 2x2 block is 3/4 opaque red (kept, colour
    // weighted by alpha), the right block is clear (cut).
    const R = [255, 0, 0, 255]
    const C = [9, 9, 9, 0]
    const src = new Uint8ClampedArray([
      ...R,
      ...R,
      ...C,
      ...C,
      ...R,
      ...C,
      ...C,
      ...C,
    ])
    const out = np.downsampleBox(src, 4, 2, 2, 1)
    expect(Array.from(out.subarray(0, 4))).toEqual([255, 0, 0, 255])
    expect(out[7]).toBe(0)
  })

  it('snaps every opaque pixel to a palette colour and leaves clear ones', () => {
    const px = new Uint8ClampedArray([250, 60, 60, 255, 1, 2, 3, 0])
    np.quantizeToPalette(px, Object.values(PALETTE))
    const rgb = (px[0]! << 16) | (px[1]! << 8) | px[2]!
    expect(Object.values(PALETTE)).toContain(rgb)
    expect(Array.from(px.subarray(4))).toEqual([1, 2, 3, 0])
  })

  it('draws a 1-px outline around the opaque shape (size + 2 each axis)', () => {
    const one = new Uint8ClampedArray([10, 20, 30, 255])
    const out = np.outlinePixels(one, 1, 1, PALETTE.outline)
    expect(out.length).toBe(3 * 3 * 4)
    const at = (x: number, y: number): number[] =>
      Array.from(out.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4))
    expect(at(1, 1)).toEqual([10, 20, 30, 255])
    const o = PALETTE.outline
    expect(at(1, 0)).toEqual([(o >> 16) & 255, (o >> 8) & 255, o & 255, 255])
    // Corners are not 4-adjacent: they stay clear.
    expect(at(0, 0)[3]).toBe(0)
  })
})
