// M4 robustness hunt (plan.md §12.7, §6.9.2 CLI rules, §6.11 perf budget),
// the fast part: hostile runs under the invariant Monitor of
// tests/sim/robust.ts — conservation, no NaN, balance ≥ 0, lives in
// [0, cap], no vehicle stuck > 120 s (parked / inactive exempt), caps
// respected except the documented Q-RUN1 relief / sold-cargo overflow — on
// the idle run, a few bad-player and chaos seeds; saves loaded at awkward
// moments continue identically; replay after save → load chains; the tick
// budget and the save size with a full L2 fleet; the ViewSim failure
// strings. The 20-seed sweeps (90-min policy runs, bad player, chaos) are
// tests/sim/robustness-*.long.test.ts, tagged [long] and excluded from
// `vlr check:quick` like policy.test.ts.

import { describe, expect, it } from 'vitest'
import {
  FAIL_REASONS,
  type CommandResult,
  type FailReason,
} from '../../src/sim/commands.ts'
import {
  Autosave,
  checkSave,
  loadGame,
  PLAYTEST_KEY,
  readPlaytest,
  readSave,
  SAVE_FAILED_TEXT,
  SAVE_KEY,
  savedRun,
  STALE_SAVE_TEXT,
  startupGame,
} from '../../src/boot/autosave.ts'
import { serialise } from '../../src/sim/save.ts'
import {
  auditState,
  replay,
  Sim,
  snapshotProblems,
  stateHash,
  type SimSnapshot,
} from '../../src/sim/sim.ts'
import { DECK_OFF_TICK } from '../../src/sim/systems/deck.ts'
import { walkOut } from '../../src/sim/systems/payroll.ts'
import { laneNode, TICKS_PER_DAY } from '../../src/sim/types.ts'
import type { Role, Strain, Vehicle, VehicleType } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  fund,
  heldParcel,
  injectParcel,
  laneParcel,
  quietSim,
  runTicks,
  shelveParcel,
  unlockDistrict,
} from './helpers.ts'
import {
  answerCard,
  badPlayer,
  cardRng,
  chaosPlayer,
  continuationProblems,
  hostileRun,
  idlePlayer,
  Monitor,
  policyPlayer,
  scenarioRng,
} from './robust.ts'

/** Put `n` S parcels aboard `v` as if it had collected them (inbound). */
function loadInbound(sim: Sim, v: Vehicle, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', { size: 'S' })
    const b = sim.state.buildings.hr_towers_a as { waiting: number[] }
    b.waiting.splice(b.waiting.indexOf(p.id), 1)
    v.cargo.push(p.id)
    v.unitsUsed += 1
    p.state = 'in_transit_in'
    p.vehicleId = v.id
  }
  v.state = 'returning'
}

describe('sold inbound cargo (spec §4.1, decisions.md "Selling a vehicle with inbound cargo")', () => {
  it('selling a full truck and a full van onto a full conveyor keeps a loadable save (the overflow is the sold cargo, not corruption)', () => {
    const sim = quietSim(3)
    sim.state.level.level = 2
    unlockDistrict(sim, 'industrial')
    const truck = buy(sim, 'truck')
    const van = buy(sim, 'van')
    buy(sim, 'bike')
    fund(sim)
    const m = new Monitor(sim)
    loadInbound(sim, truck, 32)
    loadInbound(sim, van, 16)
    for (let i = 0; i < 6; i++) laneParcel(sim, 'conv1')
    expect(m.dispatch({ kind: 'sellVehicle', id: truck.id }).ok).toBe(true)
    expect(m.dispatch({ kind: 'sellVehicle', id: van.id }).ok).toBe(true)
    const conv = laneNode(sim.state.lane, 'conv1')!
    expect(conv.queue.length).toBe(6 + 32 + 16)
    m.audit()
    expect(m.problems).toEqual([])
    const loaded = Sim.load(
      dataFixture(),
      JSON.parse(JSON.stringify(sim.snapshot())),
    )
    expect(loaded.state).toEqual(sim.state)
    // …and it drains: every parcel still passes the lane (nothing waved through).
    for (let t = 0; t < 6000 && conv.queue.length > 0; t++) m.tick()
    expect(conv.queue.length).toBe(0)
    expect(m.problems).toEqual([])
  })
})

/**
 * Run a facade call; a failure must name a plan.md §5 reason and — unless
 * marked `applied` (a rush keeps its flag, spec §4.1) — leave the state,
 * the rng word and the command log untouched.
 */
function expectResult(
  sim: Sim,
  call: () => CommandResult,
  want: CommandResult,
): void {
  const before = stateHash(sim.state)
  const logged = sim.commandLog.length
  const res = call()
  expect(res).toEqual(want)
  if (!res.ok) {
    expect(FAIL_REASONS).toContain(res.reason)
    if (res.applied !== true) {
      expect(stateHash(sim.state)).toBe(before)
      expect(sim.commandLog).toHaveLength(logged)
    } else {
      expect(sim.commandLog).toHaveLength(logged + 1)
    }
  } else {
    expect(sim.commandLog).toHaveLength(logged + 1)
  }
}
const fail = (reason: FailReason): CommandResult => ({ ok: false, reason })

describe('ViewSim facade (plan.md §5): every command returns its documented failure strings and a failure touches nothing', () => {
  it('buyVehicle / sellVehicle / setHomeZone / rehireDriver', () => {
    const sim = quietSim(1)
    const vs = createViewSim(sim)
    expectResult(
      sim,
      () => vs.buyVehicle('boat' as VehicleType, null),
      fail('invalid'),
    )
    expectResult(sim, () => vs.buyVehicle('truck', null), fail('locked'))
    expectResult(
      sim,
      () => vs.buyVehicle('van', null),
      fail('insufficient-funds'),
    )
    expectResult(sim, () => vs.buyVehicle('bike', 999), fail('no-applicant'))
    const dee = sim.state.applicants.driver[0]!
    sim.state.economy.balance = 200 // the bike, not its driver's fee
    expectResult(
      sim,
      () => vs.buyVehicle('bike', dee.id),
      fail('insufficient-funds'),
    )
    fund(sim)
    expectResult(sim, () => vs.buyVehicle('bike', dee.id), {
      ok: true,
      vehicleId: 1,
      employeeId: 2,
    })
    const bike = sim.state.vehicles[0]!
    expectResult(sim, () => vs.sellVehicle(999), fail('no-vehicle'))
    expectResult(sim, () => vs.sellVehicle(bike.id), fail('last-vehicle'))
    expectResult(sim, () => vs.setHomeZone(999, 'any'), fail('no-vehicle'))
    expectResult(sim, () => vs.setHomeZone(bike.id, 'mars'), fail('invalid'))
    expectResult(sim, () => vs.setHomeZone(bike.id, 'docks'), fail('invalid'))
    expectResult(sim, () => vs.setHomeZone(bike.id, 'lowres'), fail('locked'))
    expectResult(
      sim,
      () => vs.setHomeZone(bike.id, 'industrial'),
      fail('locked'),
    )
    expectResult(sim, () => vs.setHomeZone(bike.id, 'downtown'), { ok: true })
    expectResult(sim, () => vs.rehireDriver(bike.id), fail('no-vehicle'))
    expectResult(sim, () => vs.rehireDriver(999), fail('no-vehicle'))
    // L2: Industrial is trucks-only for a bike's home zone.
    sim.state.level.level = 2
    unlockDistrict(sim, 'industrial')
    expectResult(
      sim,
      () => vs.setHomeZone(bike.id, 'industrial'),
      fail('trucks-only'),
    )
    // A walked-out driver: re-hire needs the fee.
    const driver = sim.state.employees.find((e) => e.id === bike.driverId)!
    sim.state.economy.balance = 0
    walkOut(sim, driver)
    expectResult(
      sim,
      () => vs.rehireDriver(bike.id),
      fail('insufficient-funds'),
    )
    fund(sim)
    expectResult(sim, () => vs.rehireDriver(bike.id), { ok: true })
    expectResult(sim, () => vs.buyVehicle('bike', null), {
      ok: true,
      vehicleId: 2,
    })
    expectResult(sim, () => vs.sellVehicle(bike.id), { ok: true })
  })

  it('rush: invalid / locked / no-vehicle (applied) / already-rushed / trucks-only / needs-van, then a vehicle', () => {
    const sim = quietSim(2)
    const vs = createViewSim(sim)
    expectResult(sim, () => vs.rush('nope'), fail('invalid'))
    expectResult(sim, () => vs.rush('hr_towers_a'), fail('invalid'))
    expectResult(sim, () => vs.rush('in_lodash_smelting'), fail('locked'))
    injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expectResult(sim, () => vs.rush('hr_towers_a'), {
      ok: false,
      reason: 'no-vehicle',
      applied: true,
    })
    expectResult(sim, () => vs.rush('hr_towers_a'), fail('already-rushed'))
    buy(sim, 'bike')
    fund(sim)
    injectParcel(sim, 'dt_cache_cafe', 'hr_towers_a', { size: 'L' })
    expectResult(sim, () => vs.rush('dt_cache_cafe'), {
      ok: false,
      reason: 'needs-van',
      applied: true,
    })
    sim.state.level.level = 2
    unlockDistrict(sim, 'industrial')
    injectParcel(sim, 'in_lodash_smelting', 'hr_towers_a')
    expectResult(sim, () => vs.rush('in_lodash_smelting'), {
      ok: false,
      reason: 'trucks-only',
      applied: true,
    })
    injectParcel(sim, 'hr_towers_b', 'dt_cache_cafe')
    const bike = sim.state.vehicles[0]!
    expectResult(sim, () => vs.rush('hr_towers_b'), {
      ok: true,
      vehicleId: bike.id,
    })
  })

  it('lane: buyMachine / placeDesk / moveFixture / removeFixture / hire / fire / rehire', () => {
    const sim = quietSim(3)
    const vs = createViewSim(sim)
    const L = vs.lane
    expectResult(sim, () => L.buyMachine('laser', 'slot2'), fail('invalid'))
    expectResult(
      sim,
      () => L.buyMachine('metal_detector', 'hold'),
      fail('invalid'),
    )
    expectResult(
      sim,
      () => L.buyMachine('shaky_shaker', 'slot2'),
      fail('locked'),
    )
    expectResult(
      sim,
      () => L.buyMachine('metal_detector', 'slot4'),
      fail('slot-locked'),
    )
    expectResult(
      sim,
      () => L.buyMachine('metal_detector', 'slot1'),
      fail('slot-occupied'),
    )
    sim.state.economy.balance = 100
    expectResult(
      sim,
      () => L.buyMachine('metal_detector', 'slot2'),
      fail('insufficient-funds'),
    )
    fund(sim)
    expectResult(sim, () => L.buyMachine('metal_detector', 'slot2'), {
      ok: true,
    })
    expectResult(sim, () => L.placeDesk('slot3', 1), fail('desk-exists'))
    expectResult(sim, () => L.placeDesk('slot3', 2), fail('desk-locked'))
    expectResult(sim, () => L.placeDesk('slot3', 9), fail('invalid'))
    expectResult(sim, () => L.moveFixture('slot1', 'slot1'), fail('invalid'))
    expectResult(sim, () => L.moveFixture('slot3', 'slot1'), fail('invalid'))
    expectResult(sim, () => L.moveFixture('hold', 'slot1'), fail('invalid'))
    expectResult(
      sim,
      () => L.moveFixture('slot1', 'slot4'),
      fail('slot-locked'),
    )
    expectResult(sim, () => L.moveFixture('slot1', 'slot2'), { ok: true })
    expectResult(sim, () => L.removeFixture('slot3'), fail('invalid'))
    expectResult(sim, () => L.removeFixture('shelf'), fail('invalid'))
    // The desk (now in slot2): hire up to maxPerDesk, then desk-full.
    const next = () => sim.state.applicants.inspector[0]!.id
    const desk2 = { nodeId: 'slot2' }
    sim.state.economy.balance = 0
    expectResult(
      sim,
      () => vs.hire('inspector', next(), desk2),
      fail('insufficient-funds'),
    )
    fund(sim)
    const per = sim.data.employees.desks.maxPerDesk
    for (let i = 1; i < per; i++) {
      const id = next()
      expectResult(sim, () => vs.hire('inspector', id, desk2), {
        ok: true,
        employeeId: sim.state.nextId.employee,
      })
    }
    expectResult(
      sim,
      () => vs.hire('inspector', next(), desk2),
      fail('desk-full'),
    )
    const insp = sim.state.employees.filter((e) => e.role === 'inspector')
    expectResult(sim, () => vs.fire(999), fail('invalid'))
    expectResult(sim, () => vs.fire(insp[0]!.id), { ok: true })
    // A walked-out inspector keeps the seat: re-hire rules (Fire frees it, D10).
    const out = insp[1]!
    sim.state.economy.balance = 0
    walkOut(sim, out)
    expectResult(sim, () => L.rehire(out.id), fail('insufficient-funds'))
    expectResult(sim, () => L.rehire(insp[2]!.id), fail('invalid'))
    fund(sim)
    expectResult(sim, () => L.rehire(out.id), { ok: true })
    expectResult(sim, () => L.removeFixture('slot2'), { ok: true })
    expectResult(
      sim,
      () => vs.hire('inspector', next(), desk2),
      fail('invalid'),
    )
    expectResult(sim, () => L.placeDesk('slot4', 1), fail('slot-locked'))
    expectResult(sim, () => L.placeDesk('slot1', 1), fail('slot-occupied'))
    expectResult(sim, () => L.placeDesk('slot3', 1), { ok: true })
  })

  it('people: hire / fire / postAd / holdBay.touch / debug.forceLevel failure strings (M6)', () => {
    const sim = quietSim(5)
    const vs = createViewSim(sim, { debug: true })
    const insp = () => sim.state.applicants.inspector[0]!.id
    expectResult(
      sim,
      () => vs.hire('janitor' as Role, insp(), { nodeId: 'slot1' }),
      fail('invalid'),
    )
    expectResult(
      sim,
      () => vs.hire('inspector', 999, { nodeId: 'slot1' }),
      fail('no-applicant'),
    )
    expectResult(
      sim,
      () => vs.hire('inspector', insp(), { station: 'hold' }),
      fail('invalid'),
    )
    expectResult(
      sim,
      () => vs.hire('inspector', insp(), { nodeId: 'slot2' }),
      fail('invalid'),
    )
    expectResult(
      sim,
      () => vs.hire('inspector', insp(), { nodeId: 'slot4' }),
      fail('slot-locked'),
    )
    const sorter = sim.state.applicants.sorter[0]!.id
    expectResult(
      sim,
      () => vs.hire('sorter', sorter, { station: 'hold' }),
      fail('station-locked'),
    )
    expectResult(
      sim,
      () => vs.hire('sorter', sorter, { nodeId: 'slot1' }),
      fail('invalid'),
    )
    const driver = sim.state.applicants.driver[0]!.id
    expectResult(
      sim,
      () => vs.hire('driver', driver, { vehicleId: 7 }),
      fail('no-vehicle'),
    )
    expectResult(sim, () => vs.postAd('janitor' as Role), fail('invalid'))
    sim.state.economy.balance = 29
    expectResult(sim, () => vs.postAd('driver'), fail('insufficient-funds'))
    fund(sim)
    expectResult(sim, () => vs.postAd('driver'), { ok: true })
    expectResult(sim, () => vs.holdBay.touch(999), fail('invalid'))
    const p = heldParcel(sim)
    expectResult(sim, () => vs.holdBay.touch(p.id), { ok: true })
    expectResult(sim, () => vs.debug!.forceLevel(1), fail('invalid'))
    expectResult(sim, () => vs.debug!.forceLevel(6), fail('invalid'))
    expectResult(sim, () => vs.debug!.forceLevel(2), { ok: true })
    expectResult(
      sim,
      () => vs.lane.buyMachine('sorter_arm', 'hold'),
      fail('locked'),
    )
    expectResult(sim, () => vs.lane.removeFixture('hold'), fail('invalid'))
  })

  it('holdBay.toss / holdBay.clear (shelf-full) and grantLife', () => {
    const sim = quietSim(4)
    const vs = createViewSim(sim, { debug: true })
    const p = heldParcel(sim)
    const q = heldParcel(sim)
    expectResult(sim, () => vs.holdBay.toss(999), fail('invalid'))
    const shelf = laneNode(sim.state.lane, 'shelf')!
    while (shelf.queue.length < shelf.cap!)
      shelveParcel(sim, 'hr_towers_a', 'dt_cache_cafe')
    expectResult(sim, () => vs.holdBay.clear(p.id), fail('shelf-full'))
    expectResult(sim, () => vs.holdBay.toss(p.id), { ok: true })
    expectResult(sim, () => vs.holdBay.toss(p.id), fail('invalid'))
    shelf.queue.pop()
    expectResult(sim, () => vs.holdBay.clear(q.id), { ok: true })
    expectResult(sim, () => vs.holdBay.clear(q.id), fail('invalid'))
    expectResult(sim, () => vs.grantLife(), fail('locked'))
    expectResult(
      sim,
      () => vs.debug!.forceFlagNext('plutonium' as Strain),
      fail('invalid'),
    )
    // With the playtest flag on: only after game over.
    const flagged = quietSim(4, { economy: { continueWithOneLife: true } })
    const fv = createViewSim(flagged)
    expectResult(flagged, () => fv.grantLife(), fail('invalid'))
    flagged.state.economy.lives = 0
    flagged.state.economy.gameOver = true
    expectResult(flagged, () => fv.grantLife(), { ok: true })
    expect(flagged.state.economy).toMatchObject({ lives: 1, gameOver: false })
  })
})

// Hostile runs (a few seeds; the sweeps are the *.long.test.ts files) ------------------------

describe('the idle run: nothing bought for 30 min (seeds 1-3)', () => {
  it.each([1, 2, 3])(
    'seed %i (the deck off): parcels pile up to the building cap, the inspector is paid until the money runs out and then walks out, and every invariant holds',
    (seed) => {
      const sim = new Sim(dataFixture(), seed)
      // Build 3: with the deck on, the rescue's loaner bike ends the idle
      // run's premise (B3 §3.5) — the deck-on case is the next test.
      sim.state.events.nextDrawTick = DECK_OFF_TICK
      const walked = collect(sim, 'worker:walkedOut')
      const run = hostileRun(sim, idlePlayer, 30, seed)
      expect(run.monitor.problems).toEqual([])
      const s = sim.state
      expect(s.vehicles).toEqual([])
      expect(s.stats.deliveries).toBe(0)
      const cap = sim.data.parcels.spawn.maxWaitingPerBuilding
      for (const b of Object.values(s.buildings)) {
        expect(b.waiting.length).toBeLessThanOrEqual(cap)
      }
      expect(Object.keys(s.parcels).length).toBeLessThanOrEqual(
        cap * sim.data.buildings.length,
      )
      // $450 at $20/day: short from day 23, out at the second miss (§7.4).
      expect(walked).toEqual([
        { employeeId: 1, role: 'inspector', nodeId: 'slot1', vehicleId: null },
      ])
      expect(continuationProblems(run)).toEqual([])
    },
    20_000,
  )

  it('seed 1 (the deck on, build 3): job cards are answered at random, the rescue loaner comes once the balance is below a bike, and every invariant holds', () => {
    const sim = new Sim(dataFixture(), 1)
    // The loaner delivers; the idle player never Tosses, so a full Hold Bay
    // is its own stall (as for the bad player).
    const run = hostileRun(sim, idlePlayer, 30, 1, { allowPlayerStall: true })
    expect(run.monitor.problems).toEqual([])
    const h = sim.state.events.history
    expect(h.some((r) => r.kind === 'job')).toBe(true)
    expect(h.some((r) => r.eventId === 'ev_luck_loaner')).toBe(true)
    expect(continuationProblems(run)).toEqual([])
  }, 20_000)
})

describe('the bad player (seeds 1-3 × 30 min; 20 seeds in robustness-players.long.test.ts)', () => {
  const seen = new Set<string>()
  it.each([1, 2, 3])(
    'seed %i: six bikes then a starved payroll, never Toss, Clear everything, sell down to one mid-trip, desk removed mid-process, fixtures moved around — every invariant; saves at every hostile moment continue identically; the log replays',
    (seed) => {
      const sim = new Sim(dataFixture(), seed)
      sim.addTap((name) => seen.add(name))
      const run = hostileRun(sim, badPlayer(seed), 30, seed, {
        allowPlayerStall: true,
      })
      expect(run.monitor.problems).toEqual([])
      const kinds = sim.commandLog.map((e) => e.cmd.kind)
      expect(kinds).not.toContain('toss')
      expect(kinds).toContain('removeFixture')
      expect(kinds).toContain('moveFixture')
      expect(continuationProblems(run)).toEqual([])
      const again = replay(sim.data, seed, sim.commandLog, sim.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    },
    20_000,
  )

  it('…and between them every hostile moment happened at least once', () => {
    for (const name of [
      'worker:walkedOut',
      'vehicle:sold',
      'game:over',
      'life:lost',
      'lane:fixtureRemoved',
      'parcel:cleared_by_player',
      'payroll:short',
      'level:up',
    ]) {
      expect(seen.has(name), name).toBe(true)
    }
  })
})

describe('the chaos player (seeds 1-2 × 30 min, rich; 10 seeds in robustness-players.long.test.ts)', () => {
  const rich = dataFixture({ economy: { startMoney: 20000 } })
  it.each([1, 2])(
    'seed %i: random commands of every kind — every invariant (stuck = no progress for 120 s), saves continue identically, the log replays',
    (seed) => {
      const sim = new Sim(rich, seed)
      const run = hostileRun(sim, chaosPlayer(seed), 30, seed, {
        allowPlayerStall: true,
        stuck: 'progress',
      })
      expect(run.monitor.problems).toEqual([])
      expect(continuationProblems(run)).toEqual([])
      const again = replay(rich, seed, sim.commandLog, sim.state.tick)
      expect(stateHash(again.state)).toBe(stateHash(sim.state))
    },
    20_000,
  )
})

describe('save → load → save chains (plan.md §6.4; __pm.replay after loads)', () => {
  it('a game saved and resumed three times through the pm.save.v2 payload ends in the uninterrupted state, and replay(seed, log) of each resumed sim matches it', () => {
    const data = dataFixture()
    const live = new Sim(data, 11)
    const lm = new Monitor(live, { allowPlayerStall: true })
    const player = badPlayer(11)
    let resumed: Sim | null = null
    let rm: Monitor | null = null
    let hop = 0
    const hops = [4, 9, 17].map((min) => min * TICKS_PER_DAY + 137)
    const end = 24 * TICKS_PER_DAY
    const cards = cardRng(11)
    while (live.state.tick < end) {
      const before = live.commandLog.length
      player.step(lm)
      answerCard(lm, cards) // build 3: an open card holds a policy-less sim
      // The resumed copy gets the same commands at the same ticks.
      for (const e of live.commandLog.slice(before)) rm?.dispatch(e.cmd)
      lm.tick()
      rm?.tick()
      if (hop < hops.length && live.state.tick === hops[hop]) {
        const text = serialise(resumed ?? live, {
          savedAt: hop,
          build: 'test',
          onboarding: null,
        })
        const check = checkSave(text, data)
        expect(check.kind).toBe('ok')
        if (check.kind !== 'ok') return
        resumed = loadGame(data, check.payload).sim
        rm = new Monitor(resumed, { allowPlayerStall: true })
        expect(stateHash(resumed.state)).toBe(stateHash(live.state))
        const again = replay(data, 11, resumed.commandLog, resumed.state.tick)
        expect(stateHash(again.state)).toBe(stateHash(resumed.state))
        hop += 1
      }
    }
    expect(hop).toBe(3)
    expect(stateHash(resumed!.state)).toBe(stateHash(live.state))
    expect(resumed!.commandLog).toEqual(live.commandLog)
    const again = replay(data, 11, resumed!.commandLog, end)
    expect(stateHash(again.state)).toBe(stateHash(live.state))
    expect([...lm.problems, ...rm!.problems]).toEqual([])
  }, 20_000)
})

describe('performance and save size (plan.md §6.11: tick() p99 < 1 ms)', () => {
  it('a full L2 fleet for 90 min (the policy’s 3 bikes + truck, then 3 bikes, 2 vans, 2 trucks: 11 vehicles, one per parking tile): tick p99 < 1 ms over minutes 60-90; the save stays < 120 KB at 60 min and grows ≈ linearly (minute rows + command log); live parcels stay bounded; no terminal parcel is kept', () => {
    const data = dataFixture()
    const sim = new Sim(data, 7)
    const m = new Monitor(sim, { every: 10 })
    const policy = policyPlayer(sim)
    const price = (t: VehicleType): number =>
      data.vehicles.types.find((x) => x.id === t)!.price
    const units = (t: VehicleType): number =>
      data.vehicles.types.find((x) => x.id === t)!.capacityUnits
    let topped = false
    const times: number[] = []
    const bytes: number[] = []
    let maxLive = 0
    for (let t = 0; t < 90 * TICKS_PER_DAY; t++) {
      policy.step(m)
      if (!topped && sim.state.vehicles.some((v) => v.type === 'truck')) {
        topped = true
        // A perf scenario, not balance: the extra fleet is paid for here.
        for (const type of [
          'bike',
          'bike',
          'bike',
          'van',
          'van',
          'truck',
          'truck',
        ] as const) {
          sim.state.economy.balance += price(type) + 100
          m.resyncLedger()
          const a = sim.state.applicants.driver[0]!
          expect(
            m.dispatch({ kind: 'buyVehicle', type, applicantId: a.id }).ok,
          ).toBe(true)
        }
        sim.state.economy.balance += 100_000
        m.resyncLedger()
      }
      const t0 = performance.now()
      m.tick()
      const dt = performance.now() - t0
      if (sim.state.tick > 60 * TICKS_PER_DAY) times.push(dt)
      maxLive = Math.max(maxLive, Object.keys(sim.state.parcels).length)
      if (sim.state.tick % (10 * TICKS_PER_DAY) === 0) {
        bytes.push(JSON.stringify(sim.snapshot()).length)
        const terminal = Object.values(sim.state.parcels).filter(
          (p) => p.state === 'delivered' || p.state === 'tossed',
        )
        expect(terminal).toEqual([])
      }
    }
    expect(m.problems).toEqual([])
    expect(sim.state.vehicles).toHaveLength(11)
    times.sort((a, b) => a - b)
    expect(times[Math.floor(0.99 * times.length)]!).toBeLessThan(1)
    // Live parcels ≤ building caps + lane nodes and stations + fleet units.
    const lane = sim.state.lane.nodes.reduce(
      (n, x) => n + (x.cap ?? 0) + x.stations.length,
      0,
    )
    const fleet = sim.state.vehicles.reduce((u, v) => u + units(v.type), 0)
    const cap = data.parcels.spawn.maxWaitingPerBuilding
    expect(maxLive).toBeLessThanOrEqual(
      cap * data.buildings.length + lane + fleet,
    )
    // 10, 20, …, 90 min: < 120 KB at 60 min, < 12 KB per 10 min on average.
    expect(bytes).toHaveLength(9)
    expect(bytes[5]!).toBeLessThan(120_000)
    expect((bytes[8]! - bytes[0]!) / 8).toBeLessThan(12_000)
  }, 30_000)
})

/** A 12-minute policy game (vehicles mid-route, parcels everywhere). */
function savedGame(): { sim: Sim; text: string } {
  const sim = new Sim(dataFixture(), 7)
  const m = new Monitor(sim)
  const p = policyPlayer(sim)
  for (let t = 0; t < 12 * TICKS_PER_DAY; t++) {
    p.step(m)
    m.tick()
  }
  return {
    sim,
    text: serialise(sim, { savedAt: 1, build: 'test', onboarding: null }),
  }
}

describe('the pm.save.v2 payload under damage (plan.md §6.4, R9; autosave.ts)', () => {
  it('600 seeded damages (truncations, flipped characters, fields deleted / retyped / out of range): checkSave never throws, and any payload it accepts loads and runs a minute with no throw and a clean audit', () => {
    const data = dataFixture()
    const { text } = savedGame()
    const base = JSON.parse(text) as unknown
    const paths: (string | number)[][] = []
    const walk = (v: unknown, p: (string | number)[]): void => {
      if (p.length > 0) paths.push(p)
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]))
      else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, [...p, k])
      }
    }
    walk(base, [])
    const r = scenarioRng(2026)
    const junk: unknown[] = [null, -1, 1e9, 0.5, 'x', [], {}, true, 2 ** 53]
    const crashes: string[] = []
    const kinds: Record<string, number> = {}
    for (let i = 0; i < 600; i++) {
      let damaged: string
      let what: string
      const k = r()
      if (k < 0.15) {
        const cut = Math.floor(r() * text.length)
        damaged = text.slice(0, cut)
        what = `truncated at ${cut}`
      } else if (k < 0.3) {
        const at = Math.floor(r() * text.length)
        const ch = '0123456789{}[],:"ae-.'[Math.floor(r() * 21)] ?? '0'
        damaged = text.slice(0, at) + ch + text.slice(at + 1)
        what = `char ${at} → ${ch}`
      } else {
        const o = structuredClone(base) as Record<string | number, unknown>
        const path = paths[Math.floor(r() * paths.length)]!
        let cur = o
        for (const key of path.slice(0, -1)) {
          cur = cur[key] as Record<string | number, unknown>
        }
        const key = path.at(-1)!
        const j = Math.floor(r() * (junk.length + 1))
        if (j === junk.length) {
          if (Array.isArray(cur)) cur.splice(key as number, 1)
          else delete cur[key]
        } else {
          cur[key] = junk[j]
        }
        damaged = JSON.stringify(o)
        what = `${path.join('.')} → ${j === junk.length ? 'deleted' : JSON.stringify(junk[j])}`
      }
      let check: ReturnType<typeof checkSave>
      try {
        check = checkSave(damaged, data)
      } catch (err) {
        crashes.push(`checkSave threw (${what}): ${String(err)}`)
        continue
      }
      kinds[check.kind] = (kinds[check.kind] ?? 0) + 1
      if (check.kind !== 'ok') continue
      try {
        const game = loadGame(data, check.payload)
        const m = new Monitor(game.sim, { allowPlayerStall: true })
        const p = policyPlayer(game.sim)
        for (let t = 0; t < TICKS_PER_DAY; t++) {
          p.step(m)
          game.sim.tick()
        }
        const problems = auditState(game.sim.state, data)
        if (problems.length > 0) crashes.push(`audit (${what}): ${problems[0]}`)
      } catch (err) {
        crashes.push(`accepted, then threw (${what}): ${String(err)}`)
      }
    }
    expect(crashes).toEqual([])
    // Both outcomes happen: harmless damage (a number changed) still loads.
    expect(kinds.ok).toBeGreaterThan(20)
    expect(kinds.stale).toBeGreaterThan(200)
  }, 30_000)

  it('Sim.load names the damaged field instead of crashing later (validate.ts): a vehicle type, a path index past its route, a parked vehicle off the roads, a parcel value past the safe sums, ids behind nextId', () => {
    const data = dataFixture()
    const { sim } = savedGame()
    const snap = sim.snapshot()
    const damaged = (edit: (s: SimSnapshot['state']) => void): string[] => {
      const copy = structuredClone(snap)
      edit(copy.state)
      return snapshotProblems(data, JSON.parse(JSON.stringify(copy)))
    }
    expect(snapshotProblems(data, snap)).toEqual([])
    const moving = snap.state.vehicles.find((v) => v.path.length > 2)!
    const vi = snap.state.vehicles.indexOf(moving)
    const resting = snap.state.vehicles.findIndex((v) => v.path.length === 0)
    const parcel = Object.keys(snap.state.parcels)[0]!
    expect(
      damaged((s) => (s.vehicles[0]!.type = 'boat' as VehicleType)),
    ).toEqual(['state.vehicles[0].type: "boat" is not one of bike|van|truck'])
    expect(damaged((s) => (s.vehicles[vi]!.pathIndex = 99))[0]).toMatch(
      /pathIndex: 99 past its \d+-tile path/,
    )
    if (resting >= 0) {
      expect(
        damaged((s) => (s.vehicles[resting]!.pos = { tx: 0, ty: 0 }))[0],
      ).toMatch(/pos: \(0,0\) is off the drive graph/)
    }
    expect(
      damaged((s) => (s.parcels[parcel]!.lockedValue = 2 ** 53))[0],
    ).toMatch(/lockedValue: 9007199254740992 is not a number/)
    expect(damaged((s) => (s.nextId.parcel = 1))[0]).toMatch(
      /nextId.parcel: 1 ≤ parcel \d+/,
    )
    expect(damaged((s) => delete (s as Partial<typeof s>).nextId)).toEqual([
      'state.nextId: missing',
    ])
  })

  it('Autosave: a quota error toasts once and keeps the previous save, which still resumes tick-exact; a failing pm.playtest.v2 write never blocks the save; a stale payload is discarded with the toast', () => {
    const data = dataFixture()
    const { sim } = savedGame()
    const map = new Map<string, string>()
    let full = false
    let playtestFull = false
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full || (playtestFull && k === PLAYTEST_KEY)) {
          throw new Error('QuotaExceededError')
        }
        map.set(k, v)
      },
      removeItem: (k: string) => void map.delete(k),
    }
    const errors: string[] = []
    const saver = new Autosave({
      getSim: () => sim,
      getOnboarding: () => null,
      build: 'test',
      now: () => 1,
      store,
      onError: (msg) => errors.push(msg),
      getPlaytest: () => ({ simS: sim.state.tick / 10 }),
    })
    expect(saver.save('timer')).toBe(true)
    const savedHash = stateHash(sim.state)
    const warn = console.warn
    console.warn = () => {}
    try {
      // The playtest key alone failing: the save still lands.
      playtestFull = true
      expect(saver.save('timer')).toBe(true)
      expect(errors).toEqual([])
      // The whole store full: one toast per streak, the old save kept.
      full = true
      runTicks(sim, 600)
      expect(saver.save('timer')).toBe(false)
      expect(saver.save('hidden')).toBe(false)
      expect(errors).toEqual([SAVE_FAILED_TEXT])
    } finally {
      console.warn = warn
    }
    const check = readSave(data, store)
    expect(check.kind).toBe('ok')
    if (check.kind !== 'ok') return
    expect(stateHash(loadGame(data, check.payload).sim.state)).toBe(savedHash)
    // Damaged on disk → discarded with "Save from an older build was reset".
    map.set(SAVE_KEY, map.get(SAVE_KEY)!.replace('"lives":', '"lives":"x",'))
    const opts = { skipTitle: true, newGame: false, seedFromUrl: false }
    const got = startupGame(data, opts, store)
    expect(got).toEqual({ game: null, toast: STALE_SAVE_TEXT })
    expect(map.has(SAVE_KEY)).toBe(false)
    // Corrupt JSON in every key: nothing throws.
    for (const k of [SAVE_KEY, PLAYTEST_KEY]) map.set(k, '{"version":1,')
    expect(readSave(data, store).kind).toBe('stale')
    expect(readPlaytest(store)).toBeNull()
    expect(savedRun(store)).toBeNull()
  }, 20_000)
})
