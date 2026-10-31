// M6 the Hold Bay station (spec-build2 §2.6, §2.8; design-m6 §4.3, D3, D4,
// D19; plan-build2 §8.3 tasks 5 + 11): the Toss-only sorter — "wanted label →
// Toss with certainty", "never Clears", "judged clean → tagged and left;
// judged malware → tossed; a missed malware stays held", "player tap within
// 2 s wins" — its cadence by pace, magic parcels skipped, a walked-out sorter
// idle, the wanted list; and the Sorter Arm in the same station (L4, reached
// through debug.forceLevel(4) at M6): every held parcel tossed 3 s after
// arrival, the player first, a touch restarts it, decoys pay the fee, never a
// magic parcel, never both, removal refunds half. M9 (design-m8-m9 §4.6, §7
// M9 3): the same rule at the real L4 — the shipped cap 5, the threshold
// earned, no debug command — in a live seeded game.

import { describe, expect, it, vi } from 'vitest'
import { auditState, type Sim } from '../../src/sim/sim.ts'
import { applyEffect, effectSummary } from '../../src/sim/systems/effects.ts'
import * as sorterModule from '../../src/sim/systems/sorter.ts'
import type { Pips } from '../../src/sim/types.ts'
import { laneNode } from '../../src/sim/types.ts'
import { touchRenewDue } from '../../src/sim/systems/sorter.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  collect,
  dataFixture,
  fund,
  heldParcel,
  makeSim,
  openingA,
  quiet,
  quietSim,
  runTicks,
  runUntil,
  standardApplicant,
} from './helpers.ts'

const data = dataFixture()
const eco = data.economy

/** debug.forceLevel; a quiet sim stays quiet (the new region's timer stopped). */
function forceLevel(sim: Sim, level: number): void {
  const quietBefore = Object.values(sim.state.districts).every(
    (d) => d.nextSpawnTick === null,
  )
  const res = sim.dispatch({ kind: 'debugForceLevel', level })
  if (!res.ok) throw new Error(`forceLevel ${level}: ${res.reason}`)
  if (quietBefore) quiet(sim)
}

/** A quiet L2 game with a sorter (default 3/3: 85 %, one call / 6 s) on the station. */
function sorterSim(seed = 1, pips?: Pips) {
  const sim = fund(quietSim(seed))
  forceLevel(sim, 2)
  const a = standardApplicant(sim, 'sorter', pips)
  const res = sim.dispatch({
    kind: 'hire',
    role: 'sorter',
    applicantId: a.id,
    target: { station: 'hold' },
  })
  if (!res.ok) throw new Error(`hire sorter: ${res.reason}`)
  const e = sim.state.employees.find((x) => x.role === 'sorter')!
  return { sim, e }
}

describe('the sorter (spec-build2 §2.6, Toss-only — Q-B2-3)', () => {
  it('wanted label → Toss with certainty: no draw on state.rng, `viaWanted`, the bounty, source sorter', () => {
    const { sim, e } = sorterSim()
    const first = heldParcel(sim, { malware: true })
    first.label = 'evil-lodash'
    expect(sim.dispatch({ kind: 'toss', parcelId: first.id }).ok).toBe(true)
    expect(sim.state.wanted).toEqual(['evil-lodash'])
    const p = heldParcel(sim, { malware: true })
    p.label = 'evil-lodash'
    const decided = collect(sim, 'sorter:decided')
    const tossed = collect(sim, 'parcel:tossed')
    const word = sim.state.rng
    const balance = sim.state.economy.balance
    runTicks(sim, 1) // the clock starts: one call in 6 s
    expect(sim.state.lane.holdStation.nextDecisionTick).toBe(
      sim.state.tick + 60,
    )
    runTicks(sim, 59)
    expect(decided).toEqual([])
    runTicks(sim, 1)
    expect(decided).toEqual([
      {
        parcelId: p.id,
        employeeId: e.id,
        call: 'toss',
        correct: true,
        viaWanted: true,
      },
    ])
    expect(tossed).toEqual([
      {
        id: p.id,
        wasMalware: true,
        bounty: eco.tossBounty,
        source: 'sorter',
        employeeId: e.id,
      },
    ])
    expect(sim.state.rng).toBe(word) // certainty: no roll
    expect(sim.state.economy.balance).toBe(balance + eco.tossBounty)
    expect(sim.state.lane.holdStation.nextDecisionTick).toBeNull()
    expect(p.trace.at(-1)?.text).toBe(`Tossed by ${e.name}`)
    expect(sim.state.wanted).toEqual(['evil-lodash']) // deduped
  })

  it('judged clean → tagged and left: `sorted`, still held, the HoldBay item and the trace read "Pat: looks clean (85%)"', () => {
    const { sim, e } = sorterSim()
    const p = heldParcel(sim, { decoy: 'metal' })
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(true)
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 61)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(0.85)
    spy.mockRestore()
    expect(decided).toEqual([
      {
        parcelId: p.id,
        employeeId: e.id,
        call: 'leave',
        correct: true,
        viaWanted: false,
      },
    ])
    expect(p.state).toBe('held')
    expect(p.sorted).toEqual({ by: e.id, name: e.name, pct: 85 })
    expect(p.trace.at(-1)).toMatchObject({
      what: 'sorted',
      ref: 'hold',
      text: `${e.name}: looks clean (85%)`,
    })
    expect(createViewSim(sim).holdBay.items[0]!.sorted).toEqual({
      name: e.name,
      pct: 85,
    })
    // Judged once: no second call on it.
    runTicks(sim, 200)
    expect(decided).toHaveLength(1)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('judged malware → tossed: the bounty for malware; a clean parcel judged malware pays the wrong-Toss fee and the satisfaction hit', () => {
    const { sim, e } = sorterSim()
    const mal = heldParcel(sim, { malware: true })
    const clean = heldParcel(sim, { decoy: 'metal' })
    const spy = vi.spyOn(sim.rng, 'chance')
    spy.mockReturnValueOnce(true) // malware: a correct call → Toss
    spy.mockReturnValueOnce(false) // clean: a wrong call → Toss
    const tossed = collect(sim, 'parcel:tossed')
    const sat = collect(sim, 'satisfaction:changed')
    const balance = sim.state.economy.balance
    runTicks(sim, 61 + 60)
    spy.mockRestore()
    expect(tossed).toEqual([
      {
        id: mal.id,
        wasMalware: true,
        bounty: eco.tossBounty,
        source: 'sorter',
        employeeId: e.id,
      },
      {
        id: clean.id,
        wasMalware: false,
        bounty: 0,
        source: 'sorter',
        employeeId: e.id,
      },
    ])
    expect(sim.state.economy.balance).toBe(
      balance + eco.tossBounty - eco.wrongTossFee,
    )
    expect(sat.map((x) => x.delta)).toContain(eco.satisfaction.wrongToss)
    expect(sim.state.wanted).toEqual([mal.label])
    expect(sim.state.stats.wrongToss).toBe(1)
  })

  it('a missed malware stays held (no damage): tagged "looks clean", for the player to decide', () => {
    const { sim } = sorterSim()
    const p = heldParcel(sim, { malware: true })
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(false)
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 61)
    spy.mockRestore()
    expect(decided[0]).toMatchObject({ call: 'leave', correct: false })
    expect(p.state).toBe('held')
    expect(p.sorted?.pct).toBe(85)
    expect(sim.state.economy.lives).toBe(eco.lives.start)
    expect(sim.state.wanted).toEqual([])
  })

  it('never Clears: a seeded 30-min run with a sorter and nobody at the Hold Bay — no parcel:cleared_by_player, no Clear path in sorter.ts', () => {
    const sim = fund(makeSim(3))
    openingA(sim)
    forceLevel(sim, 2)
    const a = standardApplicant(sim, 'sorter')
    sim.dispatch({
      kind: 'hire',
      role: 'sorter',
      applicantId: a.id,
      target: { station: 'hold' },
    })
    const cleared = collect(sim, 'parcel:cleared_by_player')
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 18_000)
    expect(cleared).toEqual([])
    expect(decided.length).toBeGreaterThan(5)
    expect(decided.some((d) => d.call === 'toss')).toBe(true)
    expect(decided.some((d) => d.call === 'leave')).toBe(true)
    expect(Object.keys(sorterModule).some((k) => /clear/i.test(k))).toBe(false)
    expect(data.employees.roles.sorter.canClear).toBe(false)
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('player tap within 2 s wins: a touched parcel waits out playerGraceS before the clock starts, and a touch restarts a running clock', () => {
    const { sim } = sorterSim()
    const hs = sim.state.lane.holdStation
    const p = heldParcel(sim, { malware: true })
    const vs = createViewSim(sim)
    expect(vs.holdBay.touch(p.id)).toEqual({ ok: true })
    const t0 = sim.state.tick
    expect(p.touchedTick).toBe(t0)
    runTicks(sim, 19)
    expect(hs.nextDecisionTick).toBeNull() // skipped for 2 s
    runTicks(sim, 1)
    expect(hs.nextDecisionTick).toBe(t0 + 20 + 60)
    runTicks(sim, 30)
    expect(vs.holdBay.touch(p.id)).toEqual({ ok: true })
    expect(hs.nextDecisionTick).toBe(sim.state.tick + 60) // restarted
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 59)
    expect(decided).toEqual([])
    runTicks(sim, 1)
    expect(decided).toHaveLength(1)
    // A player Toss also restarts the clock of the next one.
    const q = heldParcel(sim, { decoy: 'metal' })
    const r = heldParcel(sim, { decoy: 'metal' })
    runTicks(sim, 1)
    runTicks(sim, 30)
    expect(sim.dispatch({ kind: 'toss', parcelId: q.id }).ok).toBe(true)
    expect(hs.nextDecisionTick).toBe(sim.state.tick + 60)
    expect(r.state).toBe('held')
  })

  it('an open HoldBayCard keeps its parcel (M6 review, B2 §2.6 "the player\'s tap always wins"): its renewed touches hold a pace-5 sorter off it for 10 s while the sorter keeps calling the others', () => {
    const { sim } = sorterSim(1, { judgement: 3, pace: 5 })
    const open = heldParcel(sim, { decoy: 'metal' }) // the oldest
    const other = heldParcel(sim, { decoy: 'metal' })
    const vs = createViewSim(sim)
    const grace = 20 // playerGraceS 2 s
    // Every call is judged malware → Toss (the worst case for the player).
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(false)
    const decided = collect(sim, 'sorter:decided')
    expect(vs.holdBay.touch(open.id)).toEqual({ ok: true })
    let last = sim.state.tick
    const log0 = sim.commandLog.length
    for (let i = 0; i < 100; i++) {
      // HoldBayCard.frame(), once per tick here (every frame in the game)
      if (touchRenewDue(sim.state.tick, last, grace)) {
        expect(vs.holdBay.touch(open.id)).toEqual({ ok: true })
        last = sim.state.tick
      }
      sim.tick()
    }
    expect(open.state).toBe('held')
    expect(decided.map((d) => d.parcelId)).toEqual([other.id])
    expect(other.state).toBe('tossed')
    // a renewal every half grace: 9 more touches in 10 s, all logged
    expect(sim.commandLog.length - log0).toBe(9)
    // The card closes: the grace lapses, then one call later it is judged.
    runTicks(sim, 61)
    spy.mockRestore()
    expect(decided.map((d) => d.parcelId)).toEqual([other.id, open.id])
    expect(auditState(sim.state, sim.data)).toEqual([])
  })

  it('touchRenewDue: every half grace (≥ 1 tick); a sim that went back in time renews at once', () => {
    expect(touchRenewDue(100, 100, 20)).toBe(false)
    expect(touchRenewDue(109, 100, 20)).toBe(false)
    expect(touchRenewDue(110, 100, 20)).toBe(true)
    expect(touchRenewDue(101, 100, 1)).toBe(true)
    expect(touchRenewDue(50, 100, 20)).toBe(true)
  })

  it('the tag is a data flag: roles.sorter.tagsClean false still judges each parcel once, but shows no tag, trace line or lost-life call', () => {
    const sim = fund(
      quietSim(1, { employees: { roles: { sorter: { tagsClean: false } } } }),
    )
    forceLevel(sim, 2)
    const a = standardApplicant(sim, 'sorter')
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'sorter',
        applicantId: a.id,
        target: { station: 'hold' },
      }).ok,
    ).toBe(true)
    const p = heldParcel(sim, { decoy: 'metal' })
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(true)
    const decided = collect(sim, 'sorter:decided')
    const trace = p.trace.length
    runTicks(sim, 61)
    expect(decided).toHaveLength(1)
    expect(decided[0]).toMatchObject({ call: 'leave' })
    expect(p.sorted).toBeDefined() // judged once
    expect(p.trace).toHaveLength(trace)
    expect(createViewSim(sim).holdBay.items[0]!.sorted).toBeNull()
    runTicks(sim, 200)
    spy.mockRestore()
    expect(decided).toHaveLength(1)
  })

  it('cadence = decisionS by pace (pace 5: one call / 4 s), the oldest first; the clock runs only while a candidate waits', () => {
    const { sim } = sorterSim(1, { judgement: 3, pace: 5 })
    const hs = sim.state.lane.holdStation
    runTicks(sim, 100)
    expect(hs.nextDecisionTick).toBeNull()
    const ps = [0, 1, 2].map(() => heldParcel(sim, { decoy: 'metal' }))
    const spy = vi.spyOn(sim.rng, 'chance').mockReturnValue(true)
    const decided = collect(sim, 'sorter:decided')
    const t0 = sim.state.tick
    const at: number[] = []
    sim.addTap((name, _p, tick) => {
      if (name === 'sorter:decided') at.push(tick - t0)
    })
    runTicks(sim, 200)
    spy.mockRestore()
    expect(decided.map((d) => d.parcelId)).toEqual(ps.map((p) => p.id))
    expect(at).toEqual([41, 81, 121])
    expect(hs.nextDecisionTick).toBeNull()
  })

  it('magic parcels are never judged; a walked-out sorter makes no calls', () => {
    const { sim, e } = sorterSim()
    const magic = heldParcel(sim, { magic: true })
    const decided = collect(sim, 'sorter:decided')
    runTicks(sim, 200)
    expect(decided).toEqual([])
    expect(magic.state).toBe('held')
    expect(sim.state.lane.holdStation.nextDecisionTick).toBeNull()
    e.active = false
    heldParcel(sim, { malware: true })
    runTicks(sim, 200)
    expect(decided).toEqual([])
  })
})

/** A quiet L4 game with the Sorter Arm bought into the station ($600). */
function armSim() {
  const sim = fund(quietSim(2))
  forceLevel(sim, 3)
  expect(
    sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
  ).toEqual({ ok: false, reason: 'locked' })
  forceLevel(sim, 4)
  sim.state.economy.balance = 600
  expect(
    sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
  ).toEqual({ ok: true })
  expect(sim.state.economy.balance).toBe(0)
  fund(sim)
  return sim
}

describe('the Sorter Arm in the same station (design §4.3; L4 via debug.forceLevel)', () => {
  it('locked at L3; bought into the Hold Bay at L4 ($600); auto-Tosses every held parcel 3 s after arrival — two arrivals on one tick → both; no draw', () => {
    const sim = armSim()
    expect(sim.state.lane.holdStation).toEqual({
      fixture: 'sorter_arm',
      nextDecisionTick: null,
    })
    expect(createViewSim(sim).holdStation.kind).toBe('sorter_arm')
    const a = heldParcel(sim, { malware: true })
    const b = heldParcel(sim, { malware: true })
    const tossed = collect(sim, 'parcel:tossed')
    const word = sim.state.rng
    runTicks(sim, 29)
    expect(tossed).toEqual([])
    runTicks(sim, 1)
    expect(tossed.map((x) => [x.id, x.source, x.employeeId])).toEqual([
      [a.id, 'arm', null],
      [b.id, 'arm', null],
    ])
    expect(sim.state.rng).toBe(word)
    expect(a.trace.at(-1)?.text).toBe('Tossed by the Sorter Arm')
  })

  it('a player Clear first wins; a touch restarts its 3 s; decoys pay the wrong-Toss fee; never a magic parcel', () => {
    const sim = armSim()
    const cleared = heldParcel(sim, { malware: true })
    const touched = heldParcel(sim, { decoy: 'metal' })
    const magic = heldParcel(sim, { magic: true })
    const tossed = collect(sim, 'parcel:tossed')
    runTicks(sim, 10)
    expect(sim.dispatch({ kind: 'clear', parcelId: cleared.id }).ok).toBe(true)
    runTicks(sim, 10)
    expect(sim.dispatch({ kind: 'touchHeld', parcelId: touched.id }).ok).toBe(
      true,
    )
    const balance = sim.state.economy.balance
    runTicks(sim, 29)
    expect(tossed).toEqual([])
    runTicks(sim, 1)
    expect(tossed).toEqual([
      {
        id: touched.id,
        wasMalware: false,
        bounty: 0,
        source: 'arm',
        employeeId: null,
      },
    ])
    expect(sim.state.economy.balance).toBe(balance - eco.wrongTossFee)
    runTicks(sim, 300)
    expect(magic.state).toBe('held')
    expect(cleared.state).toBe('on_shelf')
  })

  it('an open HoldBayCard keeps its parcel from the Arm too: renewed touches outlast its 3 s; the other parcels still go at +3 s', () => {
    const sim = armSim()
    const open = heldParcel(sim, { decoy: 'metal' })
    const other = heldParcel(sim, { decoy: 'metal' })
    const vs = createViewSim(sim)
    const tossed = collect(sim, 'parcel:tossed')
    expect(vs.holdBay.touch(open.id)).toEqual({ ok: true })
    let last = sim.state.tick
    for (let i = 0; i < 100; i++) {
      if (touchRenewDue(sim.state.tick, last, 20)) {
        vs.holdBay.touch(open.id)
        last = sim.state.tick
      }
      sim.tick()
    }
    expect(open.state).toBe('held')
    expect(tossed.map((t) => t.id)).toEqual([other.id])
    runTicks(sim, 30)
    expect(tossed.map((t) => t.id)).toEqual([other.id, open.id])
  })

  it('station-occupied both ways; removing the Arm refunds removalRefund × $600 = $300', () => {
    const sim = armSim()
    const a = standardApplicant(sim, 'sorter')
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'sorter',
        applicantId: a.id,
        target: { station: 'hold' },
      }),
    ).toEqual({ ok: false, reason: 'station-occupied' })
    const removed = collect(sim, 'lane:fixtureRemoved')
    const balance = sim.state.economy.balance
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'hold' })).toEqual({
      ok: true,
    })
    expect(removed).toEqual([{ nodeId: 'hold', refund: 300 }])
    expect(sim.state.economy.balance).toBe(balance + 300)
    expect(sim.state.lane.holdStation.fixture).toBeNull()
    // A sorter (even walked out) on the station blocks the Arm.
    const { sim: other, e } = sorterSim(3)
    forceLevel(other, 4)
    e.active = false
    expect(
      other.dispatch({
        kind: 'buyMachine',
        defId: 'sorter_arm',
        nodeId: 'hold',
      }),
    ).toEqual({ ok: false, reason: 'station-occupied' })
    expect(
      other.dispatch({
        kind: 'buyMachine',
        defId: 'sorter_arm',
        nodeId: 'slot2',
      }),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(laneNode(other.state.lane, 'slot2')?.fixture).toBeNull()
  })

  it('a game with the Arm survives a long run: every invariant, nothing held past 3 s but magic', () => {
    const sim = armSim()
    for (const d of Object.values(sim.state.districts)) {
      if (d.live) d.nextSpawnTick = sim.state.tick + 1
    }
    openingA(sim)
    runUntil(sim, () => sim.state.stats.holdBayEvents >= 5, 12_000)
    const hold = laneNode(sim.state.lane, 'hold')!
    for (const id of hold.queue) {
      const p = sim.state.parcels[String(id)]!
      expect(sim.state.tick - (p.nodeEnterTick ?? 0)).toBeLessThan(30)
    }
    expect(auditState(sim.state, sim.data)).toEqual([])
  })
})

describe('the Sorter Arm at the real L4 (M9: the shipped cap 5; design-m8-m9 §4.6, §7 M9 3)', () => {
  it('locked at a funded L3 reached by lifetime earned; at L4 (earned, no debug command) it goes into the Hold Bay station and, in a live seeded game, auto-Tosses each flagged parcel 3 s after it arrives unless the player taps first', () => {
    const sim = makeSim(4)
    openingA(sim)
    fund(sim)
    const L3 = data.levels.find((l) => l.level === 3)!
    const L4 = data.levels.find((l) => l.level === 4)!
    expect(eco.playtestMaxLevel).toBe(5)
    sim.state.economy.lifetimeEarned = L3.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(3)
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
    ).toEqual({ ok: false, reason: 'locked' })
    sim.state.economy.lifetimeEarned = L4.threshold
    runTicks(sim, 1)
    expect(sim.state.level.level).toBe(4)
    expect(sim.commandLog.some((e) => e.cmd.kind === 'debugForceLevel')).toBe(
      false,
    )
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'sorter_arm', nodeId: 'hold' }),
    ).toEqual({ ok: true })
    expect(createViewSim(sim).holdStation.kind).toBe('sorter_arm')
    // A second inspector-free checker so the lane flags more than metal.
    expect(
      sim.dispatch({ kind: 'buyMachine', defId: 'xray', nodeId: 'slot5' }),
    ).toEqual({ ok: true })
    const delay =
      data.machines.upgrades.find((u) => u.id === 'sorter_arm')!
        .autoTossDelayS * 10
    expect(delay).toBe(30)
    const heldAt = new Map<number, number>()
    const tossedAt: { id: number; tick: number; source: string }[] = []
    sim.addTap((name, p, tick) => {
      if (name === 'parcel:held') heldAt.set((p as { id: number }).id, tick)
      if (name === 'parcel:tossed') {
        const t = p as { id: number; source: string }
        tossedAt.push({ id: t.id, tick, source: t.source })
      }
    })
    // The player taps the first held parcel 1 s in (its 3 s restart) and
    // Tosses the second one at once; nobody touches the rest.
    let touched: number | null = null
    let tossedByPlayer: number | null = null
    const touchTick = new Map<number, number>()
    for (let t = 0; t < 20 * 600 && tossedAt.length < 8; t++) {
      sim.tick()
      for (const [id, at] of heldAt) {
        const p = sim.state.parcels[String(id)]
        if (!p || p.state !== 'held' || p.magic) continue
        if (touched === null && sim.state.tick === at + 10) {
          expect(sim.dispatch({ kind: 'touchHeld', parcelId: id }).ok).toBe(
            true,
          )
          touched = id
          touchTick.set(id, sim.state.tick)
        } else if (
          touched !== null &&
          touched !== id &&
          tossedByPlayer === null
        ) {
          expect(sim.dispatch({ kind: 'toss', parcelId: id }).ok).toBe(true)
          tossedByPlayer = id
        }
      }
    }
    expect(touched).not.toBeNull()
    expect(tossedByPlayer).not.toBeNull()
    expect(tossedAt.length).toBeGreaterThanOrEqual(8)
    for (const x of tossedAt) {
      if (x.id === tossedByPlayer) {
        expect(x.source).toBe('player')
        continue
      }
      expect(x.source, `parcel ${x.id}`).toBe('arm')
      const from = touchTick.get(x.id) ?? heldAt.get(x.id)!
      expect(x.tick - from, `parcel ${x.id}`).toBe(delay)
    }
    expect(auditState(sim.state, sim.data)).toEqual([])
  }, 30_000)
})

describe('build 3: an absent sorter (B3 §3.5 staff absent)', () => {
  it('calls nothing while away (no draw, the held parcel stays), then resumes when the absence ends', () => {
    const { sim, e } = sorterSim()
    const hs = sim.state.lane.holdStation
    const p = heldParcel(sim, { malware: true })
    const effect = {
      kind: 'staff',
      absent: 'sorter',
      pick: 'all',
      days: 0.5,
    } as const
    const refs = { eventId: 'ev_test', title: 'Test', target: null, pick: null }
    expect(effectSummary(sim, [effect], refs)).toEqual([
      { text: `${e.name} off for 12h (unpaid)`, tone: 'cost' },
    ])
    applyEffect(
      sim,
      {
        eventId: 'ev_test',
        title: 'Test',
        optionLabel: 'OK',
        optionIndex: 0,
        target: null,
        pick: null,
        chainHeadId: 'ev_test',
        depth: 1,
      },
      effect,
    )
    expect(e.absentUntilTick).toBe(sim.state.tick + 300)
    expect(e.active).toBe(true)
    const decided = collect(sim, 'sorter:decided')
    const word = sim.state.rng
    runTicks(sim, 250)
    expect(decided).toEqual([])
    expect(hs.nextDecisionTick).toBeNull()
    expect(sim.state.parcels[String(p.id)]?.state).toBe('held')
    expect(sim.state.rng).toBe(word)
    expect(auditState(sim.state, sim.data)).toEqual([])
    runUntil(sim, () => decided.length > 0, 200)
    expect(decided).toHaveLength(1)
    expect(e.absentUntilTick).toBeUndefined()
  })
})
