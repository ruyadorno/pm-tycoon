// city-view.md §9.4 / spec §10: the game-over screen's headline and stats
// block (days survived, lifetime earned, parcels delivered, malware caught /
// missed, level reached, best day's $). Phaser is stubbed (the module
// imports the Button kit).
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

const go = await import('../../src/ui/GameOverCard.ts')
const { dataFixture } = await import('../sim/helpers.ts')

const data = dataFixture()

describe('§9.4: `Three malware parcels reached customers`', () => {
  it('counts the parcels in words', () => {
    expect(go.gameOverHeadline(3)).toBe(
      'Three malware parcels reached customers',
    )
    expect(go.gameOverHeadline(4)).toBe(
      'Four malware parcels reached customers',
    )
    expect(go.gameOverHeadline(1)).toBe('One malware parcel reached a customer')
    expect(go.gameOverHeadline(12)).toBe('12 malware parcels reached customers')
  })
})

describe("§9.4: best day's $ from the per-day rows", () => {
  it('is the largest daily step of the cumulative earned column', () => {
    const rows = [{ earned: 40 }, { earned: 140 }, { earned: 190 }]
    expect(go.bestDay(rows, 200)).toBe(100)
  })

  it('counts the running day (lifetime − the last row)', () => {
    expect(go.bestDay([{ earned: 40 }], 300)).toBe(260)
    expect(go.bestDay([], 75)).toBe(75)
  })
})

describe('§9.4: the stats block', () => {
  it('lists days, earned, clean deliveries, caught / missed, level, best day', () => {
    const m = go.gameOverModel(
      {
        day: 14,
        lifetimeEarned: 3410,
        deliveries: 215,
        malwareMissed: 3,
        defused: 9,
        level: 2,
        rows: [{ earned: 100 }, { earned: 450 }],
      },
      data,
    )
    expect(m.headline).toBe('Three malware parcels reached customers')
    const level = data.levels.find((l) => l.level === 2)!
    expect(m.stats).toEqual([
      ['Days survived', '14'],
      ['Lifetime earned', '$3,410'],
      ['Parcels delivered', '212'],
      ['Malware caught / missed', '9 / 3'],
      ['Level reached', `Lv2 ${level.title}`],
      ['Best day', '$2,960'],
    ])
  })

  it('never shows a negative delivery count', () => {
    const m = go.gameOverModel(
      {
        day: 0,
        lifetimeEarned: 0,
        deliveries: 1,
        malwareMissed: 3,
        defused: 0,
        level: 1,
        rows: [],
      },
      data,
    )
    expect(m.stats[2]).toEqual(['Parcels delivered', '0'])
  })
})
