// M7 magic parcel (spec §5.5, spec-build2 §3.3; plan-build2 §8.4 task 3;
// design-m7 §3.5, Q5-Q7): the route (A = the busiest sender with room in a
// servable non-hard-rule district, B in another one within 20 road tiles of
// the lot), ineligible with no vehicle, spawned at once on Accept (one
// parcel, conservation intact), checkers skip it and it is never held (so
// never sorted), it rides first and its stop is first, on time → +1 life +
// $150 + the base delivery, late → quest:failed {timeout} the tick after the
// deadline and base only, and maxAlive 1.

import { describe, expect, it } from 'vitest'
import { anchorOf, districtOf } from '../../src/sim/map.ts'
import type { Sim } from '../../src/sim/sim.ts'
import {
  auditState,
  conservation,
  snapshotProblems,
} from '../../src/sim/sim.ts'
import {
  deliveryStops,
  outboundSet,
  reserveAt,
} from '../../src/sim/systems/dispatch.ts'
import {
  isMagicParcel,
  magicRoute,
  servableDistricts,
} from '../../src/sim/systems/magic.ts'
import { eligibleTemplates } from '../../src/sim/systems/quests.ts'
import type { Parcel, Quest } from '../../src/sim/types.ts'
import { ticksFromS } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  acceptOffer,
  buy,
  collect,
  dataFixture,
  fund,
  injectParcel,
  noOffers,
  offerQuest,
  openingA,
  quietSim,
  runTicks,
  runUntil,
  shelveParcel,
  startQuest,
  unlockDistrict,
} from './helpers.ts'

const data = dataFixture()
const magic = data.parcels.magic
const MAX_TILES = 20
const countdown = ticksFromS(magic.countdownS)

const sendOf = (id: string) => data.buildings.find((b) => b.id === id)!.send

function magicParcel(sim: Sim, q: Quest): Parcel {
  if (q.progress.kind !== 'magicParcel' || q.progress.parcelId === null) {
    throw new Error('not a magic quest')
  }
  return sim.state.parcels[String(q.progress.parcelId)]!
}

describe('the route (B2 §3.3; design Q5, Q6, Q-B2-13)', () => {
  it('A = the busiest sender of a servable district; B in another servable district ≤ 20 road tiles from the lot; never Industrial or a hub', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = fund(quietSim(seed))
      buy(sim, 'bike')
      buy(sim, 'truck') // Industrial is servable by a truck, still excluded (hardRule)
      unlockDistrict(sim, 'industrial')
      unlockDistrict(sim, 'docks')
      expect(servableDistricts(sim)).toEqual(['highres', 'downtown'])
      const r = magicRoute(sim, MAX_TILES, true)!
      const live = data.buildings.filter((b) =>
        ['highres', 'downtown'].includes(b.district),
      )
      const busiest = Math.max(...live.map((b) => b.send))
      expect(sendOf(r.origin)).toBe(busiest)
      const a = districtOf(data, r.origin)
      const b = districtOf(data, r.dest)
      expect(b).not.toBe(a)
      expect(['highres', 'downtown']).toContain(b)
      expect(
        sim.paths.distance(sim.roads.entrance, anchorOf(data, r.dest)),
      ).toBeLessThanOrEqual(MAX_TILES)
      // Eligibility asks without drawing: the first busiest sender and the first B.
      const word = sim.state.quests.rng
      const first = magicRoute(sim, MAX_TILES, false)!
      expect(sim.state.quests.rng).toBe(word)
      expect(sendOf(first.origin)).toBe(busiest)
    }
  })

  it('a full sender is skipped; a district no driven vehicle may serve is not servable; no vehicle → no route, the quest is not offered', () => {
    const sim = fund(quietSim(1))
    sim.state.lane.quarantine.count = 1
    expect(magicRoute(sim, MAX_TILES, false)).toBeNull()
    expect(eligibleTemplates(sim).map((c) => c.t.id)).not.toContain(
      'magic_parcel',
    )
    const bike = buy(sim, 'bike')
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'highres' })
    expect(servableDistricts(sim)).toEqual(['highres'])
    expect(magicRoute(sim, MAX_TILES, false)).toBeNull() // B needs another district
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'any' })
    const r = magicRoute(sim, MAX_TILES, false)!
    expect(eligibleTemplates(sim).map((c) => c.t.id)).toContain('magic_parcel')
    // Fill the chosen sender: the next busiest takes over.
    const cap = data.parcels.spawn.maxWaitingPerBuilding
    sim.state.buildings[r.origin]!.waiting.push(
      ...Array.from({ length: cap }, (_, i) => 10_000 + i),
    )
    expect(magicRoute(sim, MAX_TILES, false)?.origin).not.toBe(r.origin)
    sim.state.buildings[r.origin]!.waiting = []
    // A bike with no driver serves nothing.
    sim.dispatch({ kind: 'fire', employeeId: bike.driverId! })
    expect(servableDistricts(sim)).toEqual([])
  })
})

describe('spawn and the lane (spec §5.5)', () => {
  it('Accept spawns the golden parcel at A at once: parcel:spawned, magicAlive 1, conservation intact, never malware', () => {
    const sim = noOffers(quietSim(2))
    openingA(sim)
    const spawned = collect(sim, 'parcel:spawned')
    const log: string[] = []
    sim.addTap((name) => log.push(name))
    const q = startQuest(sim, 'magic_parcel')
    const p = magicParcel(sim, q)
    expect(spawned).toEqual([
      { id: p.id, origin: p.origin, dest: p.dest, size: 'S', label: p.label },
    ])
    expect(log.slice(-2)).toEqual(['parcel:spawned', 'quest:accepted'])
    expect(p).toMatchObject({
      size: 'S',
      baseValue: data.parcels.sizes.S.value,
      mult: 1,
      magic: true,
      malware: false,
      strain: null,
      decoy: null,
      state: 'waiting',
      spawnedTick: sim.state.tick,
    })
    expect(isMagicParcel(p)).toBe(true)
    expect(sim.state.buildings[p.origin]!.waiting).toContain(p.id)
    expect(sim.state.spawn.magicAlive).toBe(1)
    expect(sim.state.spawn.malwareCount).toBe(0)
    expect(conservation(sim.state).ok).toBe(true)
    expect(auditState(sim.state, sim.data)).toEqual([])
    expect(q).toMatchObject({
      status: 'active',
      deadlineTick: p.spawnedTick + countdown,
      progress: {
        kind: 'magicParcel',
        parcelId: p.id,
        origin: p.origin,
        dest: p.dest,
        deliveredTick: null,
        onTime: false,
      },
    })
    expect(createViewSim(sim).quests().active?.route).toEqual({
      origin: p.origin,
      dest: p.dest,
    })
  })

  it('it rides first: the outbound set puts it first (its region the target) and its stop is the first', () => {
    const sim = fund(noOffers(quietSim(3)))
    const van = buy(sim, 'van')
    const old1 = shelveParcel(sim, 'hr_towers_a', 'dt_registry_tower')
    const old2 = shelveParcel(sim, 'hr_towers_b', 'dt_registry_tower')
    const gold = shelveParcel(sim, 'dt_cache_cafe', 'hr_rimraf_laundry', {
      spawnedTick: 0,
    })
    gold.magic = true
    gold.spawnedTick = old2.spawnedTick + 1 // the newest on the shelf
    const set = outboundSet(sim, van)
    expect(set[0]).toBe(gold.id)
    expect(set).toContain(old1.id)
    van.cargo = [old1.id, old2.id, gold.id]
    const stops = deliveryStops(sim, van, sim.roads.entrance)
    expect(stops[0]).toMatchObject({
      buildingId: 'hr_rimraf_laundry',
      parcelIds: [gold.id],
    })
    van.cargo = []
  })

  it('at its origin it is reserved and picked up first, ahead of older parcels (the VIP rule at A; review M7)', () => {
    const sim = fund(noOffers(quietSim(3)))
    const bike = buy(sim, 'bike') // 4 units
    const a = 'hr_towers_a'
    const m1 = injectParcel(sim, a, 'dt_registry_tower', { size: 'M' })
    const m2 = injectParcel(sim, a, 'dt_registry_tower', { size: 'M' })
    const gold = injectParcel(sim, a, 'dt_cache_cafe')
    gold.magic = true
    sim.state.spawn.magicAlive = 1
    // Oldest first would fill the bike with the two Ms and leave it behind.
    expect(reserveAt(sim, bike, a)).toEqual([gold.id, m1.id])
    for (const p of [gold, m1]) p.reservedBy = null
    bike.reserved = []
    // The rushed bike's collect stop reserves the same way and picks them up.
    const picked = collect(sim, 'parcel:pickedUp')
    expect(sim.dispatch({ kind: 'rush', buildingId: a }).ok).toBe(true)
    expect(bike.reserved).toEqual([gold.id, m1.id])
    expect(m2.reservedBy).toBeNull()
    runUntil(sim, () => picked.length > 0, 1200)
    expect(picked.map((x) => x.id)).toEqual([gold.id, m1.id])
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('a pickup that leaves it behind (the vehicle full of earlier reservations) keeps the rush flag up; the next pass sends another vehicle', () => {
    const sim = fund(noOffers(quietSim(4)))
    const bike = buy(sim, 'bike')
    const a = 'hr_towers_a'
    injectParcel(sim, a, 'dt_registry_tower', { size: 'M' })
    injectParcel(sim, a, 'dt_registry_tower', { size: 'M' })
    expect(sim.dispatch({ kind: 'rush', buildingId: a }).ok).toBe(true)
    expect(bike.reserved).toHaveLength(2) // both Ms, before the golden one exists
    const gold = injectParcel(sim, a, 'dt_cache_cafe')
    gold.magic = true
    sim.state.spawn.magicAlive = 1
    const cleared = collect(sim, 'building:rushCleared')
    const picked = collect(sim, 'parcel:pickedUp')
    runUntil(sim, () => picked.length > 0, 1200)
    expect(picked.map((x) => x.id)).not.toContain(gold.id)
    expect(gold.state).toBe('waiting')
    expect(cleared).toEqual([])
    expect(sim.state.buildings[a]?.rushUntilTick).not.toBeNull()
    // A second bike answers the bell on the next dispatcher pass.
    const bike2 = buy(sim, 'bike')
    const rushed = collect(sim, 'building:rushed')
    runUntil(sim, () => rushed.length > 0, 20)
    expect(rushed[0]).toMatchObject({ buildingId: a, vehicleId: bike2.id })
    runUntil(sim, () => gold.state !== 'waiting', 1200)
    expect(gold.vehicleId).toBe(bike2.id)
    expect(cleared).toEqual([{ buildingId: a }])
  })

  it('game over while it is on its way: its delivery is still recorded (no dangling parcel id; the save loads), and a continued run pays it', () => {
    const sim = fund(
      noOffers(quietSim(4, { economy: { continueWithOneLife: true } })),
    )
    openingA(sim)
    const q = startQuest(sim, 'magic_parcel')
    const p = magicParcel(sim, q)
    sim.dispatch({ kind: 'rush', buildingId: p.origin })
    for (let i = 0; i < 3; i++) sim.dispatch({ kind: 'debugMalwareDelivery' })
    expect(sim.state.economy.gameOver).toBe(true)
    const delivered = collect(sim, 'parcel:delivered')
    runUntil(sim, () => delivered.some((d) => d.id === p.id), countdown)
    runTicks(sim, 50) // gc
    expect(sim.state.parcels[String(p.id)]).toBeUndefined()
    expect(q.progress).toMatchObject({
      parcelId: p.id,
      deliveredTick: expect.any(Number),
      onTime: true,
    })
    expect(auditState(sim.state, sim.data)).toEqual([])
    expect(
      snapshotProblems(sim.data, JSON.parse(JSON.stringify(sim.snapshot()))),
    ).toEqual([])
    // Continue with one life: the quest completes on the next step.
    expect(sim.dispatch({ kind: 'continueWithOneLife' }).ok).toBe(true)
    runTicks(sim, 1)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
    })
    expect(sim.state.economy.lives).toBe(2)
  })

  it('on time (rush A, deliver ≤ 120 s): checkers skip it, never held; quest:completed, +1 life, +$150 + the base delivery; magicAlive 0', () => {
    const sim = fund(noOffers(quietSim(4)))
    openingA(sim)
    const q = startQuest(sim, 'magic_parcel')
    const p = magicParcel(sim, q)
    expect(sim.dispatch({ kind: 'rush', buildingId: p.origin }).ok).toBe(true)
    const flagged = collect(sim, 'parcel:flagged')
    const held = collect(sim, 'parcel:held')
    const delivered = collect(sim, 'parcel:delivered')
    const completed = collect(sim, 'quest:completed')
    const gained = collect(sim, 'life:gained')
    const money = collect(sim, 'money:changed')
    const ran = runUntil(
      sim,
      () => sim.state.quests.active === null,
      countdown + 5,
    )
    expect(ran).toBeGreaterThan(0)
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      id: q.id,
      outcome: 'completed',
    })
    expect(flagged).toEqual([])
    expect(held).toEqual([])
    const d = delivered.find((x) => x.id === p.id)!
    expect(d).toMatchObject({ onTime: true, malware: false })
    expect(d.paid).toBe(data.parcels.sizes.S.value)
    const slots = p.trace.filter((t) => t.ref?.startsWith('slot'))
    expect(slots.filter((t) => t.what === 'skipped')).toHaveLength(2) // desk + detector
    expect(
      slots.filter((t) => ['passed', 'missed', 'flagged'].includes(t.what)),
    ).toEqual([])
    expect(completed).toEqual([
      { questId: q.id, templateId: 'magic_parcel', reward: q.reward },
    ])
    expect(q.reward).toMatchObject({ cash: magic.reward, lives: magic.lives })
    expect(gained).toEqual([{ lives: 4, delta: 1, reason: 'magic' }])
    expect(sim.state.economy.lives).toBe(4)
    expect(money.filter((m) => m.reason === 'quest')).toEqual([
      expect.objectContaining({ delta: magic.reward }),
    ])
    expect(money).toContainEqual(
      expect.objectContaining({ delta: d.paid, reason: 'delivery' }),
    )
    expect(sim.state.spawn.magicAlive).toBe(0)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('late: quest:failed {timeout} the tick after the deadline; the parcel stays golden, later pays its base only, no life; maxAlive blocks a second magic quest while it lives', () => {
    const sim = fund(noOffers(quietSim(5)))
    openingA(sim)
    const bike = sim.state.vehicles[0]!
    const q = startQuest(sim, 'magic_parcel')
    const p = magicParcel(sim, q)
    // Keep the bike out of A's district until the countdown is over.
    const other =
      districtOf(data, p.origin) === 'highres' ? 'downtown' : 'highres'
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: other })
    const failed = collect(sim, 'quest:failed')
    runTicks(sim, q.deadlineTick! - sim.state.tick)
    expect(failed).toEqual([])
    runTicks(sim, 1)
    expect(failed).toEqual([
      { questId: q.id, templateId: 'magic_parcel', reason: 'timeout' },
    ])
    expect(sim.state.tick).toBe(q.deadlineTick! + 1)
    expect(p.magic).toBe(true)
    expect(sim.state.spawn.magicAlive).toBe(1)
    // One alive: no second magic offer, and a debug one is withdrawn on Accept.
    sim.state.lane.quarantine.count = 1
    expect(eligibleTemplates(sim).map((c) => c.t.id)).not.toContain(
      'magic_parcel',
    )
    offerQuest(sim, 'magic_parcel')
    expect(
      sim.dispatch({
        kind: 'acceptQuest',
        questId: sim.state.quests.offer!.id,
      }),
    ).toEqual({ ok: false, reason: 'quest-expired', applied: true })
    sim.state.lane.quarantine.count = 0
    runTicks(sim, 400) // well past onTimeMaxS before anyone fetches it
    // Let the bike fetch it now: delivered late, base value only.
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'any' })
    const delivered = collect(sim, 'parcel:delivered')
    const money = collect(sim, 'money:changed')
    const gained = collect(sim, 'life:gained')
    runUntil(sim, () => delivered.some((x) => x.id === p.id), 6000)
    const d = delivered.find((x) => x.id === p.id)!
    expect(d.onTime).toBe(false)
    expect(money.filter((m) => m.reason === 'quest')).toEqual([])
    expect(gained).toEqual([])
    expect(sim.state.economy.lives).toBe(3)
    expect(sim.state.spawn.magicAlive).toBe(0)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('the policy-free player can still lose it: a debug offer and Accept then abandon leave the parcel golden', () => {
    const sim = fund(noOffers(quietSim(6)))
    openingA(sim)
    offerQuest(sim, 'magic_parcel')
    const q = acceptOffer(sim)
    const p = magicParcel(sim, q)
    sim.dispatch({ kind: 'abandonQuest' })
    expect(sim.state.quests.history.at(-1)).toMatchObject({
      outcome: 'abandoned',
    })
    expect(p.magic).toBe(true)
    expect(sim.state.spawn.magicAlive).toBe(1)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})
