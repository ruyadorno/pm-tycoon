// spec §5.3 value decay + §7.3 payout: f = 1 to 90 s, linear to 0.25 at
// 300 s, flat after; on time ⇔ t ≤ 160 s; paid = round(base × f(t)); an
// overseas value is locked at hand-off. valueAt is computed, never stored.

import { describe, expect, it } from 'vitest'
import {
  decayFactor,
  isOnTime,
  lockValue,
  paidValue,
  valueAt,
} from '../../src/sim/value.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import { dataFixture, injectParcel, quietSim } from './helpers.ts'

const data = dataFixture()

describe('value decay f(t) (spec §5.3)', () => {
  it('f at 0 / 90 / 160 / 300 / 400 s = 1 / 1 / 0.75 / 0.25 / 0.25', () => {
    expect(decayFactor(data, 0)).toBe(1)
    expect(decayFactor(data, 90)).toBe(1)
    expect(decayFactor(data, 160)).toBeCloseTo(0.75, 10)
    expect(decayFactor(data, 300)).toBe(0.25)
    expect(decayFactor(data, 400)).toBe(0.25)
    expect(decayFactor(data, 195)).toBeCloseTo(1 - (0.75 * 105) / 210, 10)
  })

  it('on-time boundary is 160 s (paid ≥ 75 % of base)', () => {
    expect(isOnTime(data, 160)).toBe(true)
    expect(isOnTime(data, 160.1)).toBe(false)
    expect(decayFactor(data, 160)).toBeGreaterThanOrEqual(0.75)
    expect(decayFactor(data, 160.1)).toBeLessThan(0.75)
  })

  it('paid value = round(base × f(t)): S at 160 s → $15, M at 200 s → $27, L at 400 s → $23', () => {
    const sim = quietSim()
    sim.state.tick = 5000
    const at = (s: number) => sim.state.tick - s * TICKS_PER_S
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: at(160),
    })
    expect(paidValue(data, p, sim.state.tick)).toBe(15)
    const m = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      size: 'M',
      spawnedTick: at(200),
    })
    expect(valueAt(data, m, sim.state.tick)).toBeCloseTo(27.32, 1)
    expect(paidValue(data, m, sim.state.tick)).toBe(27)
    const l = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      size: 'L',
      spawnedTick: at(400),
    })
    expect(paidValue(data, l, sim.state.tick)).toBe(Math.round(90 * 0.25))
  })

  it('value is locked at hand-off: later ticks do not change it (spec §5.6)', () => {
    const sim = quietSim()
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      size: 'M',
      spawnedTick: 0,
    })
    p.mult = 1.5
    p.lockedValue = lockValue(data, p, 1200) // 120 s: f = 1 − 0.75 × 30 / 210
    expect(p.lockedValue).toBe(Math.round(45 * 1.5 * (1 - (0.75 * 30) / 210)))
    expect(valueAt(data, p, 99999)).toBe(p.lockedValue)
    expect(paidValue(data, p, 99999)).toBe(p.lockedValue)
  })

  it('the value is never stored: the parcel has no value field and ages with the clock', () => {
    const sim = quietSim()
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      spawnedTick: 0,
    })
    expect(Object.keys(p)).not.toContain('value')
    expect(paidValue(data, p, 900)).toBe(20)
    expect(paidValue(data, p, 3000)).toBe(5)
  })
})
