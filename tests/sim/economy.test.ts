// spec §7.1-§7.3 economy at M1: start $450, purchases need balance ≥ price
// (never negative), a local delivery pays round(base × f(t)) into the
// balance, lifetime earned and the destination district's `earned`;
// malware pays $0; selling refunds 50 % and never touches lifetime earned.

import { describe, expect, it } from 'vitest'
import { paidValue } from '../../src/sim/value.ts'
import {
  buy,
  collect,
  dataFixture,
  injectParcel,
  makeSim,
  noCheckers,
  quietSim,
  runUntil,
} from './helpers.ts'

const data = dataFixture()

describe('economy (spec §7)', () => {
  it('§7.1 start $450; buying needs balance ≥ price and the balance never goes negative', () => {
    const sim = makeSim(1)
    expect(sim.state.economy.balance).toBe(data.economy.startMoney)
    expect(sim.dispatch({ kind: 'buyVehicle', type: 'van' })).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    })
    expect(sim.dispatch({ kind: 'buyVehicle', type: 'bike' }).ok).toBe(true)
    expect(sim.dispatch({ kind: 'buyVehicle', type: 'bike' }).ok).toBe(true)
    expect(sim.dispatch({ kind: 'buyVehicle', type: 'bike' })).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    })
    expect(sim.state.economy.balance).toBe(50)
  })

  it('local delivery pays round(base × f(t)) into balance, lifetime earned and the district', () => {
    const sim = quietSim(1)
    buy(sim, 'bike')
    sim.state.economy.balance = 0
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
      size: 'M',
      spawnedTick: -1500, // ~2.5 min old already: decayed
    })
    const money = collect(sim, 'money:changed')
    const delivered = collect(sim, 'parcel:delivered')
    runUntil(sim, () => delivered.length > 0)
    const expected = paidValue(data, p, sim.state.tick)
    expect(expected).toBeLessThan(45)
    expect(delivered[0]).toMatchObject({
      id: p.id,
      paid: expected,
      malware: false,
    })
    expect(money).toEqual([
      { delta: expected, reason: 'delivery', balance: expected },
    ])
    expect(sim.state.economy.lifetimeEarned).toBe(expected)
    expect(sim.state.stats.income).toBe(expected)
    expect(sim.state.districts.downtown?.earned).toBe(expected)
    expect(sim.state.stats.firstDeliveryTick).toBe(sim.state.tick)
  })

  it('malware delivered pays $0: nothing toward the balance or lifetime earned', () => {
    const sim = noCheckers(quietSim(1)) // nothing in the lane to catch it
    buy(sim, 'bike')
    const before = sim.state.economy.balance
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { malware: true })
    const delivered = collect(sim, 'parcel:delivered')
    runUntil(sim, () => delivered.length > 0)
    expect(delivered[0]).toMatchObject({ paid: 0, malware: true })
    expect(sim.state.economy.balance).toBe(before)
    expect(sim.state.economy.lifetimeEarned).toBe(0)
    expect(sim.state.stats.malwareMissed).toBe(1)
    expect(sim.state.economy.lives).toBe(data.economy.lives.start - 1) // §10, lives.test.ts
  })

  it('selling refunds sellRefund × price as `refund`; lifetime earned never decreases', () => {
    const sim = quietSim(1)
    const a = buy(sim, 'bike')
    buy(sim, 'bike')
    sim.state.economy.lifetimeEarned = 123
    const balance = sim.state.economy.balance
    const money = collect(sim, 'money:changed')
    expect(sim.dispatch({ kind: 'sellVehicle', id: a.id })).toEqual({
      ok: true,
    })
    const refund = Math.round(a.purchasePrice * data.economy.sellRefund)
    expect(refund).toBe(100)
    expect(money).toEqual([
      { delta: refund, reason: 'refund', balance: balance + refund },
    ])
    expect(sim.state.economy.lifetimeEarned).toBe(123)
  })
})
