// city-view.md §4.3 (bottom bar: `icon_warehouse` + `Warehouse` in the wide
// button) and style-guide.md §1.7 (buttons: 1 px outline + bevel): a label
// never touches the face's edge — the icon gap tightens, then the icon hides.
// Phaser is stubbed because Button extends Phaser's Container at load.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const { fitContent, CONTENT_PAD, ICON_GAP, ICON_GAP_TIGHT } =
  await import('../../src/ui/Button.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')

// m5x7 advances: `Warehouse` 54 px, `Garage` 35 px, `City` 20 px; icons 16.
const WAREHOUSE = 54
const GARAGE = 35

describe('Button content fit (labels keep CONTENT_PAD inside the face)', () => {
  it('keeps the normal gap when icon + label fit', () => {
    expect(fitContent(92, 16, WAREHOUSE)).toEqual({
      icon: true,
      gap: ICON_GAP,
      textW: WAREHOUSE,
    })
  })

  it('tightens the gap, then hides the icon, before the label touches the edge', () => {
    // 16 + 2 + 54 = 72 fits an 83-px face (73 inside), 16 + 4 + 54 = 74 does not.
    expect(fitContent(83, 16, WAREHOUSE).gap).toBe(ICON_GAP_TIGHT)
    expect(fitContent(77, 16, WAREHOUSE)).toEqual({
      icon: false,
      gap: 0,
      textW: WAREHOUSE,
    })
    expect(77 - 2 * CONTENT_PAD).toBeGreaterThanOrEqual(WAREHOUSE)
  })

  it('icon-only and label-only buttons are untouched', () => {
    expect(fitContent(44, 16, 0)).toEqual({ icon: true, gap: 0, textW: 0 })
    expect(fitContent(44, 0, 12)).toEqual({ icon: false, gap: 0, textW: 12 })
  })

  it('the bottom bar keeps both icons from W 393 up; at W 360 Warehouse drops its icon', () => {
    for (const W of [393, 430]) {
      const L = computeLayout(W, 800, 0, 0, 1)
      expect(fitContent(L.warehouse.rect.w, 16, WAREHOUSE).icon).toBe(true)
      expect(fitContent(L.garage.rect.w, 16, GARAGE).icon).toBe(true)
    }
    const L = computeLayout(360, 640, 0, 0, 1)
    expect(fitContent(L.warehouse.rect.w, 16, WAREHOUSE).icon).toBe(false)
    expect(fitContent(L.garage.rect.w, 16, GARAGE).icon).toBe(true)
    expect(fitContent(L.warehouse.rect.w, 16, 20).icon).toBe(true) // `City`
  })
})
