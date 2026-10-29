// city-view.md §5.3 (shield popover: readout header, one row per strain,
// the weakest suggests its counter machine), spec §6.3 (readout colours
// green ≥ 90 / amber 70–89 / red < 70; opening A = 15/min, 97 %). Pure
// helpers only; Phaser is stubbed because the module imports the Button kit.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  // Base classes the kit extends at module load (Container, Scene).
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

const sp = await import('../../src/ui/ShieldPopover.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { dataFixture, makeSim, openingA } = await import('../sim/helpers.ts')

const data = dataFixture()

describe('Shield popover (city-view §5.3, spec §6.3 readout)', () => {
  it('detection colours: green ≥ 90, amber 70–89, red < 70', () => {
    expect(sp.detectionTone(97)).toBe('ok')
    expect(sp.detectionTone(90)).toBe('ok')
    expect(sp.detectionTone(89)).toBe('warn')
    expect(sp.detectionTone(70)).toBe('warn')
    expect(sp.detectionTone(69)).toBe('danger')
  })

  it('header reads "Lane 15/min · Detection 97%"', () => {
    expect(sp.laneReadout({ ratePerMin: 15, detectionPct: 97 })).toBe(
      'Lane 15/min · Detection 97%',
    )
  })

  it('one row per strain; only the weakest appends its counter machine and price', () => {
    const rows = sp.strainRows(
      {
        byStrain: [
          { strain: 'metal', pct: 97, counter: 'metal_detector' },
          { strain: 'rattle', pct: 15, counter: 'shaky_shaker' },
        ],
      },
      data,
    )
    expect(rows.map((r) => r.text)).toEqual(['metal 97%', 'rattle 15%'])
    expect(rows.map((r) => r.tone)).toEqual(['ok', 'danger'])
    expect(rows[0]?.counter).toBeNull()
    expect(rows[1]?.counter).toEqual({
      machineId: 'shaky_shaker',
      text: '→ Shaky shaker $300',
    })
  })

  it('ties go to the first strain (parcels.json order)', () => {
    const rows = sp.strainRows(
      {
        byStrain: [
          { strain: 'metal', pct: 85, counter: 'metal_detector' },
          { strain: 'rattle', pct: 85, counter: 'shaky_shaker' },
        ],
      },
      data,
    )
    expect(rows.filter((r) => r.counter).map((r) => r.strain)).toEqual([
      'metal',
    ])
  })

  it('counter text comes from machines.json name and price', () => {
    expect(sp.counterText(data, 'metal_detector')).toBe('→ Metal detector $150')
    expect(sp.counterText(data, 'nope')).toBeNull()
  })

  it('height is 24 + 20 per strain row (+2 px border)', () => {
    expect(sp.shieldPopoverHeight(1)).toBe(46)
    expect(sp.shieldPopoverHeight(2)).toBe(66)
  })

  it('opening A (inspector + Metal detector) reads Lane 15/min · Detection 97% from the live sim', () => {
    const sim = makeSim(1)
    openingA(sim)
    const vs = createViewSim(sim)
    const stats = vs.laneStats()
    expect(sp.laneReadout(stats)).toBe('Lane 15/min · Detection 97%')
    const rows = sp.strainRows(stats, vs.data)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('metal 97%')
    // The lane already holds the counter: no advert for it.
    expect(stats.suggest?.owned).toBe(true)
    expect(rows[0]?.counter).toBeNull()
  })

  it('the inspector alone reads metal 85% → Metal detector $150 from the live sim', () => {
    const vs = createViewSim(makeSim(1))
    const rows = sp.strainRows(vs.laneStats(), vs.data)
    expect(rows[0]?.text).toBe('metal 85%')
    expect(rows[0]?.counter?.text).toBe('→ Metal detector $150')
  })
})
