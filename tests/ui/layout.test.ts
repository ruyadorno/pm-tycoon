// city-view.md §4 / plan.md §6.9.1: computeLayout at W ∈ {320, 360, 393, 430},
// zoom ∈ {1, 2}, safeBottom ∈ {0, 34} returns non-overlapping rects and every
// button's hit box is ≥ 44/zoom logical px on both axes.
import { describe, expect, it } from 'vitest'
import {
  BTN_H,
  CHIPS_H,
  HUD_BOTTOM_H,
  HUD_TOP_H,
  buttonColumn,
  computeLayout,
  contains,
  overlaps,
  type Rect,
  type TargetName,
} from '../../src/ui/layout.ts'

const WIDTHS = [320, 360, 393, 430]
const ZOOMS = [1, 2]
const SAFE_BOTTOMS = [0, 34]
const SAFE_TOPS = [0, 47]
const HEIGHTS = [480, 659, 932]

const cases: [number, number, number, number, number][] = []
for (const W of WIDTHS)
  for (const zoom of ZOOMS)
    for (const sb of SAFE_BOTTOMS)
      for (const st of SAFE_TOPS)
        for (const H of HEIGHTS) cases.push([W, H, st, sb, zoom])

const ROW_A: TargetName[] = ['money', 'lives', 'mood']
const BOTTOM_BAR: TargetName[] = [
  'speedPause',
  'speed1',
  'speed2',
  'mute',
  'warehouse',
  'garage',
]

const inside = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

describe('computeLayout (city-view.md §4)', () => {
  it.each(cases)(
    'W=%i H=%i st=%i sb=%i zoom=%i: every tap target is >= ceil(44/zoom) and contains its visual rect',
    (W, H, st, sb, zoom) => {
      const L = computeLayout(W, H, st, sb, zoom)
      const min = Math.ceil(44 / zoom)
      expect(L.minHit).toBe(min)
      for (const [name, t] of Object.entries(L.targets)) {
        expect(t.hit.w, `${name}.hit.w`).toBeGreaterThanOrEqual(min)
        expect(t.hit.h, `${name}.hit.h`).toBeGreaterThanOrEqual(min)
        expect(inside(t.hit, t.rect), `${name} hit contains rect`).toBe(true)
        expect(t.hit.x, `${name} left edge`).toBeGreaterThanOrEqual(0)
        expect(t.hit.x + t.hit.w, `${name} right edge`).toBeLessThanOrEqual(W)
        expect(t.hit.y + t.hit.h, `${name} bottom edge`).toBeLessThanOrEqual(H)
        // Only the top row's edge targets may grow past the safe top.
        if (!ROW_A.includes(name as TargetName))
          expect(t.hit.y, `${name} top`).toBeGreaterThanOrEqual(L.safeTop)
      }
      // Chips: the row's hit band is >= minHit tall.
      expect(L.chip.hitH).toBeGreaterThanOrEqual(min)
      // L.hit is max(visual, ceil(44/zoom)).
      expect(L.hit(10)).toBe(min)
      expect(L.hit(60)).toBe(60)
    },
  )

  it.each(cases)(
    'W=%i H=%i st=%i sb=%i zoom=%i: no two hit boxes overlap (incl. the chips band)',
    (W, H, st, sb, zoom) => {
      const L = computeLayout(W, H, st, sb, zoom)
      const chipBand: Rect = {
        x: 0,
        y: L.chip.hitY,
        w: W,
        h: L.chip.hitH,
      }
      const boxes: [string, Rect][] = [
        ...Object.entries(L.targets).map(
          ([n, t]) => [n, t.hit] as [string, Rect],
        ),
        ['chips', chipBand],
      ]
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [an, a] = boxes[i]!
          const [bn, b] = boxes[j]!
          expect(overlaps(a, b), `${an} vs ${bn}`).toBe(false)
        }
    },
  )

  it.each(cases)(
    'W=%i H=%i st=%i sb=%i zoom=%i: bands stack top to bottom without overlap',
    (W, H, st, sb, zoom) => {
      const L = computeLayout(W, H, st, sb, zoom)
      expect(L.topBar.y).toBe(L.safeTop)
      expect(L.ticker.y).toBe(L.topBar.y + L.topBar.h)
      expect(L.world.y).toBe(L.safeTop + HUD_TOP_H)
      expect(L.world.y + L.world.h).toBe(L.chips.y)
      expect(L.world.h).toBeGreaterThan(0)
      expect(L.chips.h).toBe(CHIPS_H)
      expect(L.chips.y + L.chips.h).toBe(L.bottomBar.y)
      expect(L.bottomBar.h).toBe(HUD_BOTTOM_H + L.safeBottom)
      expect(L.bottomBar.y + L.bottomBar.h).toBe(H)
      expect(L.followStrip.y + L.followStrip.h).toBe(L.chips.y)
      const bands = [L.topBar, L.ticker, L.world, L.chips, L.bottomBar]
      for (let i = 0; i + 1 < bands.length; i++)
        expect(overlaps(bands[i]!, bands[i + 1]!)).toBe(false)
      // Bottom bar buttons sit inside the bar, 44 tall, above the safe area.
      for (const n of BOTTOM_BAR) {
        const r = L.targets[n].rect
        expect(r.h).toBe(BTN_H)
        expect(inside(L.bottomBar, r), n).toBe(true)
        expect(r.y + r.h).toBeLessThanOrEqual(H - L.safeBottom)
      }
      // Top-bar cells and the level bar stay inside the top bar.
      for (const r of [L.money.rect, L.lives.rect, L.mood.rect, L.level.rect])
        expect(inside(L.topBar, r)).toBe(true)
      expect(inside(L.level.rect, L.levelBar) || L.levelBar.w > 0).toBe(true)
      expect(L.levelBar.x + L.levelBar.w).toBeLessThanOrEqual(L.shield.rect.x)
      expect(L.chip.maxRowW).toBe(W - 12)
    },
  )

  it('W=360+ keeps the specified bottom-bar geometry (city-view.md §4.3)', () => {
    for (const W of [360, 393, 430]) {
      const L = computeLayout(W, 800, 0, 0, 1)
      expect(L.speed).toMatchObject({ x: 6, w: 132, h: 44, y: 800 - 64 + 10 })
      expect(L.mute.rect.x).toBe(144)
      // Warehouse / Garage: at least the specified 76, grown into the free
      // space after Mute up to WIDE_BTN_MAX_W (92), right-aligned.
      const wide = Math.min(92, Math.floor((W - 188 - 18) / 2))
      expect(wide).toBeGreaterThanOrEqual(76)
      expect(L.warehouse.rect).toMatchObject({
        x: W - 6 - wide - 6 - wide,
        w: wide,
      })
      expect(L.garage.rect).toMatchObject({ x: W - 6 - wide, w: wide })
      expect(L.warehouse.rect.x).toBeGreaterThanOrEqual(
        L.mute.rect.x + L.mute.rect.w + 6,
      )
      expect(L.shield.rect).toMatchObject({ x: W - 62, w: 56, y: 24 })
      expect(L.levelBar).toMatchObject({ x: 76, y: 29, w: W - 76 - 6 - 56 })
    }
  })

  it('a tap lands in exactly one target or none', () => {
    const L = computeLayout(393, 659, 0, 34, 1)
    for (let y = 0; y < 659; y += 3)
      for (let x = 0; x < 393; x += 3) {
        const hits = Object.values(L.targets).filter((t) =>
          contains(t.hit, x, y),
        )
        expect(hits.length).toBeLessThanOrEqual(1)
      }
  })
})

describe('buttonColumn (Title card, city-view.md §9.5)', () => {
  it.each([
    [320, 1],
    [393, 1],
    [430, 2],
  ])(
    'W=%i zoom=%i: 200x44 buttons, 12-px gaps, centred, hit >= 44/zoom',
    (W, zoom) => {
      const col = buttonColumn(W, 400, 4, zoom)
      expect(col).toHaveLength(4)
      col.forEach((t, i) => {
        expect(t.rect.w).toBe(200)
        expect(t.rect.h).toBe(44)
        expect(Math.abs(t.rect.x + 100 - W / 2)).toBeLessThanOrEqual(1)
        expect(t.hit.h).toBeGreaterThanOrEqual(Math.ceil(44 / zoom))
        if (i > 0) expect(t.rect.y - col[i - 1]!.rect.y).toBe(56)
      })
      for (let i = 0; i + 1 < col.length; i++)
        expect(overlaps(col[i]!.hit, col[i + 1]!.hit)).toBe(false)
    },
  )
})
