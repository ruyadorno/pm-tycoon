// city-view.md §1.3 / spec-core.md §5.3: the waiting badge's decay phase is
// plain inside the grace window (f = 1), amber while the value falls but the
// parcel is still on time (t ≤ onTimeMaxS ⇔ f ≥ 0.75), red once it would be
// late. Thresholds come from parcels.json, never literals in the renderer.
import { describe, expect, it } from 'vitest'
import {
  decayPhase,
  formatMmSs,
  phaseSuffix,
  valueFactor,
} from '../../src/render/decayPhase.ts'
import { applyConfig, buildGameData } from '../../src/data/index.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'

const shipped = buildGameData(loadRawData()).parcels
const { graceS } = shipped.decay
const { onTimeMaxS } = shipped
const tick = 1 / TICKS_PER_S

describe('decayPhase (spec §5.3 grace window → falling → late)', () => {
  it('is plain from spawn through the last grace second', () => {
    expect(decayPhase(0, shipped)).toBe('plain')
    expect(decayPhase(graceS / 2, shipped)).toBe('plain')
    expect(decayPhase(graceS, shipped)).toBe('plain')
  })

  it('turns amber one tick after the grace window: value starts falling', () => {
    expect(decayPhase(graceS + tick, shipped)).toBe('amber')
    expect(valueFactor(graceS + tick, shipped)).toBeLessThan(1)
    expect(decayPhase((graceS + onTimeMaxS) / 2, shipped)).toBe('amber')
  })

  it('stays amber at exactly onTimeMaxS (still on time: f ≥ 0.75)', () => {
    expect(decayPhase(onTimeMaxS, shipped)).toBe('amber')
    expect(valueFactor(onTimeMaxS, shipped)).toBeGreaterThanOrEqual(0.75)
  })

  it('is red one tick past onTimeMaxS and stays red at the floor', () => {
    expect(decayPhase(onTimeMaxS + tick, shipped)).toBe('red')
    expect(valueFactor(onTimeMaxS + tick, shipped)).toBeLessThan(0.75)
    expect(decayPhase(shipped.decay.floorAtS * 3, shipped)).toBe('red')
  })

  it('reads its thresholds from parcels.json (a config patch moves them)', () => {
    const patched = buildGameData(
      applyConfig(
        loadRawData(),
        { parcels: { decay: { graceS: 30 }, onTimeMaxS: 60 } },
        'test',
      ),
    ).parcels
    expect(decayPhase(31, patched)).toBe('amber')
    expect(decayPhase(31, shipped)).toBe('plain')
    expect(decayPhase(61, patched)).toBe('red')
    expect(decayPhase(61, shipped)).toBe('plain')
  })
})

describe('valueFactor (spec §5.3 f(t))', () => {
  it('is 1 in grace, linear to the floor, then flat', () => {
    const { floorAtS, floor } = shipped.decay
    expect(valueFactor(graceS, shipped)).toBe(1)
    expect(valueFactor(floorAtS, shipped)).toBeCloseTo(floor, 9)
    expect(valueFactor(floorAtS * 2, shipped)).toBe(floor)
    const mid = (graceS + floorAtS) / 2
    expect(valueFactor(mid, shipped)).toBeCloseTo((1 + floor) / 2, 9)
  })
})

describe('tooltip text helpers (city-view §5.2)', () => {
  it('suffixes the amber and red phases', () => {
    expect(phaseSuffix('plain')).toBe('')
    expect(phaseSuffix('amber')).toBe(' (falling)')
    expect(phaseSuffix('red')).toBe(' (late)')
  })

  it('formats ages as m:ss', () => {
    expect(formatMmSs(0)).toBe('0:00')
    expect(formatMmSs(42.9)).toBe('0:42')
    expect(formatMmSs(130)).toBe('2:10')
    expect(formatMmSs(-3)).toBe('0:00')
  })
})
