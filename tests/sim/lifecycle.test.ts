// spec §11 parcel lifecycle + §4.6: one bike, one spawned parcel, end to
// end — the parcel state path, its trace, and the event order.

import { describe, expect, it } from 'vitest'
import type { ParcelState } from '../../src/sim/types.ts'
import { buy, makeSim, quiet, runUntil } from './helpers.ts'

describe('parcel lifecycle (spec §11)', () => {
  it('one bike end to end: spawned → waiting → picked_up → in_transit_in → unloading → in_conveyor → in_slot → on_shelf → loaded → in_transit_out → delivered', () => {
    const sim = makeSim(1)
    sim.state.districts.downtown!.nextSpawnTick = null // one parcel only
    const bike = buy(sim, 'bike')
    const states: ParcelState[] = []
    const events: string[] = []
    let id = -1
    let trace: string[] = []
    sim.addTap((name, p) => {
      const pl = p as { id?: number; vehicleId?: number }
      if (name === 'parcel:spawned' && id < 0) id = pl.id as number
      const mine =
        (name.startsWith('parcel:') && pl.id === id) ||
        (name.startsWith('vehicle:') && pl.id === bike.id)
      if (!mine) return
      events.push(name)
      const parcel = sim.state.parcels[String(id)]
      if (parcel && states.at(-1) !== parcel.state) states.push(parcel.state)
      if (name === 'parcel:delivered' && parcel) {
        trace = parcel.trace.map((t) => `${t.what}${t.ref ? `@${t.ref}` : ''}`)
      }
    })
    runUntil(sim, () => id > 0, 100)
    quiet(sim) // no second parcel
    const ticks = runUntil(sim, () => events.includes('parcel:delivered'), 3000)
    expect(ticks).toBeGreaterThan(0)
    expect(states).toEqual([
      'waiting',
      'picked_up',
      'in_transit_in',
      'unloading',
      'in_conveyor',
      'in_slot',
      'on_shelf',
      'loaded',
      'in_transit_out',
      'delivered',
    ])
    expect(events).toEqual([
      'parcel:spawned',
      'vehicle:collecting',
      'parcel:pickedUp',
      'vehicle:returning',
      'vehicle:queued',
      'vehicle:docked',
      'parcel:unloaded',
      'vehicle:unloaded',
      'parcel:enteredSlot',
      'parcel:enteredSlot',
      'parcel:enteredSlot',
      'parcel:shelved',
      'parcel:loaded',
      'vehicle:departed',
      'parcel:delivered',
    ])
    expect(trace.map((t) => t.split('@')[0])).toEqual([
      'spawned',
      'pickedUp',
      'unloaded',
      'slot',
      'slot',
      'slot',
      'shelved',
      'loaded',
      'delivered',
    ])
    expect(trace).toContain(`pickedUp@${bike.id}`)
    expect(trace).toContain('unloaded@dock1')
    // gc removes the terminal parcel at the end of its tick
    expect(sim.state.parcels[String(id)]).toBeUndefined()
    expect(sim.state.stats.deliveries).toBe(1)
  })
})
