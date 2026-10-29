// warehouse-view.md §1.9 / §4: the lane readout strip reads exactly
// `Lane: 15/min · Detection 97%`; while stalled the rate segment becomes
// `Lane: STALLED (Hold Bay full)` in red — only that segment, so
// "Detection" never reads as the failing part (UX M2 review). Phaser is
// stubbed; readoutParts is pure.
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

const { readoutParts } =
  await import('../../src/render/warehouse/LaneRenderer.ts')

const joined = (p: { lead: string; mid: string; pct: string }): string =>
  p.lead + p.mid + p.pct

describe('§1.9 lane readout strip', () => {
  it('reads `Lane: 15/min · Detection 97%`', () => {
    const p = readoutParts(15, 97, null)
    expect(joined(p)).toBe('Lane: 15/min · Detection 97%')
    expect(p.stalled).toBe(false)
  })

  it('stalled: only the rate segment carries the stall (red), the detection label stays separate', () => {
    const p = readoutParts(15, 97, { reason: 'holdBayFull' })
    expect(joined(p)).toBe('Lane: STALLED (Hold Bay full) · Detection 97%')
    expect(p.stalled).toBe(true)
    expect(p.lead).toBe('Lane: STALLED (Hold Bay full) ')
    expect(p.mid).toBe('· Detection ')
  })

  it('§4 captions: shelfFull → Shelf full, bufferFull → Lane jammed', () => {
    expect(readoutParts(15, 97, { reason: 'shelfFull' }).lead).toBe(
      'Lane: STALLED (Shelf full) ',
    )
    expect(readoutParts(15, 97, { reason: 'bufferFull' }).lead).toBe(
      'Lane: STALLED (Lane jammed) ',
    )
  })
})
