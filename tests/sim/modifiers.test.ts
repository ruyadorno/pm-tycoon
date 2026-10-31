// Build 3 modifier registry (spec-build3 §3.6; plan-build3 §8.2 task 4; M11
// contract stream A, D-3, D-5, D-6, D-21, D-24, D-32, D-34): the pure fold
// (src/sim/modifiers.ts modMult / modAdd — live rows of the key whose scope
// is null or the asked one, multiplied / summed, clamped to events.json
// modifiers.bounds; the identity with no row), priceOf, effChecker, the
// mutations of systems/modifierOps.ts, and every read site of the §3.6
// table: one probe per key reads the number the sim actually uses and is
// checked for the identity (no row, and a live row of every OTHER key), one
// row, two stacked rows, the bounds, and expiry; then the scoped keys, mult
// 0, the purchase prices and refunds, the desk resync, the machine roll vs
// the catch rate shown, payday vs payrollDuePerDay, the hub hand-off
// (income locked, clearanceS, the stored hand-off tick) and the shelf cap
// across a level-up.

import { describe, expect, it } from 'vitest'
import { MODIFIER_KEYS } from '../../src/data/schema.ts'
import type { LiveDistrictDef, ModifierKey } from '../../src/data/types.ts'
import {
  laneCatchRate,
  laneRatePerMin,
  lostLifeReport,
  machineChecker,
  processTicksAt,
} from '../../src/sim/detection.ts'
import {
  ADD_KEYS,
  effChecker,
  isLive,
  modAdd,
  modMult,
  MULT_KEYS,
  priceOf,
} from '../../src/sim/modifiers.ts'
import { auditState, Sim, stateHash } from '../../src/sim/sim.ts'
import { condHolds } from '../../src/sim/systems/deck.ts'
import { stopTicks } from '../../src/sim/systems/dispatch.ts'
import {
  debugMalwareDelivery,
  deliverParcel,
} from '../../src/sim/systems/economy.ts'
import { tossParcel } from '../../src/sim/systems/holdbay.ts'
import { handOff, handOffTick } from '../../src/sim/systems/hubs.ts'
import {
  applyModifier,
  endModifiers,
  modifiersStep,
} from '../../src/sim/systems/modifierOps.ts'
import { payOrder, payrollDuePerDay } from '../../src/sim/systems/payroll.ts'
import { effectiveP } from '../../src/sim/systems/people.ts'
import { spawnMultiplier } from '../../src/sim/systems/satisfaction.ts'
import { spawnIntervalTicks, spawnStep } from '../../src/sim/systems/spawn.ts'
import {
  driverMults,
  MILLI,
  speedPerTick,
} from '../../src/sim/systems/vehicles.ts'
import type {
  LaneNode,
  Modifier,
  Parcel,
  Size,
  Vehicle,
} from '../../src/sim/types.ts'
import {
  laneNode,
  TICKS_PER_DAY,
  TICKS_PER_S,
  ticksFromS,
} from '../../src/sim/types.ts'
import { isOnTime, lockValue, valueAt } from '../../src/sim/value.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  collect,
  dataFixture,
  eventLog,
  fund,
  heldParcel,
  injectParcel,
  laneParcel,
  makeSim,
  noCheckers,
  openingA,
  placeMachine,
  quietSim,
  runTicks,
  runUntil,
} from './helpers.ts'

const data = dataFixture()
const B = data.events.modifiers.bounds
const LABEL = 'Test card'
const isMultKey = (key: ModifierKey): boolean =>
  (MULT_KEYS as readonly string[]).includes(key)
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4
const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x))

interface RowOpts {
  scope?: string | null
  untilTick?: number | null
  label?: string
  eventId?: string
}

/** One modifier row through modifierOps (a mult key's value is `mult`, an add key's `add`). */
function row(
  sim: Sim,
  key: ModifierKey,
  value: number,
  opts: RowOpts = {},
): Modifier {
  const mult = isMultKey(key)
  return applyModifier(sim, {
    key,
    mult: mult ? value : 1,
    add: mult ? 0 : value,
    scope: opts.scope ?? null,
    untilTick: opts.untilTick ?? null,
    eventId: opts.eventId ?? 'ev_test',
    label: opts.label ?? LABEL,
  })
}

const desk = (sim: Sim): LaneNode =>
  sim.state.lane.nodes.find((n) => n.fixture?.kind === 'desk')!

/** A quiet sim past the malware grace with the L1 strain spawnable (spawn.ts step 4 draws). */
function pastGrace(sim: Sim): Sim {
  const m = data.parcels.malware
  runTicks(sim, ticksFromS(Math.max(m.graceS, m.newStrainDelayS)) + 1)
  sim.state.spawn.spawnedCount = Math.max(
    sim.state.spawn.spawnedCount,
    m.graceCount,
  )
  sim.state.spawn.scriptedDone = true
  return sim
}

/**
 * The chance() probabilities one due spawn in `district` draws, every one
 * answered false (so: clean, no decoy) — [malware share, decoy share].
 */
function spawnChances(sim: Sim, district = 'highres'): number[] {
  const seen: number[] = []
  const rng = sim.rng
  const real = rng.chance.bind(rng)
  rng.chance = (p: number): boolean => {
    seen.push(p)
    real(p)
    return false
  }
  try {
    sim.state.districts[district]!.nextSpawnTick = sim.state.tick
    spawnStep(sim)
  } finally {
    Reflect.deleteProperty(rng, 'chance')
  }
  return seen
}

const districtDef = (id: string): LiveDistrictDef =>
  data.districts.find((d) => d.id === id) as LiveDistrictDef

/** A parcel bound for a hub, `ageS` old, handed off now (no vehicle). */
function handedOff(sim: Sim, dest: string, ageS = 0, size: Size = 'S'): Parcel {
  const ageTicks = ageS * TICKS_PER_S
  if (sim.state.tick < ageTicks) runTicks(sim, ageTicks - sim.state.tick)
  const p = injectParcel(sim, 'hr_towers_a', dest, {
    size,
    spawnedTick: sim.state.tick - ageTicks,
  })
  const hub = data.districts.find((d) => d.id === p.destRegion)
  p.mult = hub?.kind === 'overseas' ? hub.valueMult : 1
  const b = sim.state.buildings[p.origin]!
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  handOff(sim, null, p)
  return p
}

/** A quiet, funded sim at `level` (debugForceLevel: the row's unlocks). */
function atLevel(level: number): Sim {
  const sim = quietSim(1)
  const res = sim.dispatch({ kind: 'debugForceLevel', level })
  if (!res.ok) throw new Error(`forceLevel ${level}: ${res.reason}`)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  return fund(sim)
}

/** Deliver a fresh (or `ageS`-old) S parcel now; the parcel:delivered payload. */
function deliverNow(
  sim: Sim,
  ageS = 0,
): { paid: number; onTime: boolean; lifetime: number } {
  const delivered = collect(sim, 'parcel:delivered')
  const before = sim.state.economy.lifetimeEarned
  const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
    spawnedTick: sim.state.tick - ageS * TICKS_PER_S,
  })
  const b = sim.state.buildings[p.origin]!
  b.waiting.splice(b.waiting.indexOf(p.id), 1)
  deliverParcel(sim, null, p)
  const d = delivered.at(-1)!
  return {
    paid: d.paid,
    onTime: d.onTime,
    lifetime: sim.state.economy.lifetimeEarned - before,
  }
}

/** A quiet lane with one Metal detector in slot 1 and nothing else. */
function detectorLane(): Sim {
  const sim = quietSim(1)
  noCheckers(sim)
  placeMachine(sim, 'metal_detector', 'slot1')
  return sim
}

const pctOf = (x: number): number => Math.round(100 * x)

/** Run to (and through) the next day boundary: payday. */
function payday(sim: Sim): void {
  runTicks(sim, TICKS_PER_DAY - (sim.state.tick % TICKS_PER_DAY))
}

/** Opening A on a quiet sim, funded so payday never runs short. */
function opened(): Sim {
  const sim = quietSim(1)
  openingA(sim)
  return fund(sim, 10_000)
}

/** The money:changed deltas of one reason in an eventLog. */
function lines(log: ReturnType<typeof eventLog>, reason: string): number[] {
  return log
    .filter(
      (e) =>
        e.name === 'money:changed' &&
        (e.p as { reason: string }).reason === reason,
    )
    .map((e) => (e.p as { delta: number }).delta)
}

/** stateHash without the modifier bookkeeping (the rows, their id counter, the peak). */
function strip(sim: Sim): string {
  const s = structuredClone(sim.state)
  s.modifiers = []
  s.nextId.modifier = 1
  s.events.stats.modifiersPeak = 0
  return stateHash(s)
}

// One probe per key: what the sim actually uses at that read site ------------------

interface Probe {
  key: ModifierKey
  /** The scope a row needs to reach this read (null: an unscoped row). */
  scope: string | null
  /** A fresh sim set up for the read. */
  make: () => Sim
  /** The number the read site produces now (may consume a fresh parcel). */
  read: (sim: Sim) => number
  /** That number under a fold of `fold`. */
  expected: (fold: number) => number
  /** Two in-bounds row values (moved / stacked). */
  values: [number, number]
  /** Other keys that feed the same number (left out of the identity check). */
  coupled?: ModifierKey[]
}

const S_VALUE = data.parcels.sizes.S.value
const INSPECTOR_P = effectiveP(data, { eye: 3, pace: 3, charisma: 0 }, [])
const pCap = data.employees.roles.inspector.pCap
const [mLo, mHi] = data.events.modifiers.machinePClamp
const METAL = data.machines.checkers.find((c) => c.id === 'metal_detector')!
const BIKE = data.vehicles.types.find((t) => t.id === 'bike')!
const VAN = data.vehicles.types.find((t) => t.id === 'van')!
const docksDef = data.districts.find((d) => d.id === 'docks')!
const airportDef = data.districts.find((d) => d.id === 'airport')!
if (docksDef.kind !== 'overseas' || airportDef.kind !== 'overseas') {
  throw new Error('districts.json: docks / airport are not overseas hubs')
}
const DOCKS_TICKS = ticksFromS(docksDef.clearanceS)
const AIRPORT_TICKS = ticksFromS(airportDef.clearanceS)
const ON_TIME = data.parcels.onTimeMaxS
const SALARIES = 28 // opening A: Audrey $20 + the standard bike driver $8
const SPAWN_SECONDS =
  districtDef('downtown').spawnIntervalS *
  spawnMultiplier(makeSim(1), data.economy.satisfaction.start)

const PROBES: Probe[] = [
  {
    key: 'speed',
    scope: null,
    make: () => {
      const sim = quietSim(1)
      buy(sim, 'bike')
      return sim
    },
    read: (sim) => speedPerTick(sim, sim.state.vehicles[0]!),
    expected: (f) =>
      Math.max(
        1,
        Math.round((BIKE.speedTilesPerS * 1 * f * MILLI) / TICKS_PER_S),
      ),
    values: [1.2, 1.1],
  },
  {
    key: 'stop',
    scope: null,
    make: () => {
      const sim = quietSim(1)
      buy(sim, 'bike')
      return sim
    },
    read: (sim) => stopTicks(sim, sim.state.vehicles[0]!),
    expected: (f) => ticksFromS(data.vehicles.stopS * 1 * f),
    values: [1.4, 0.8],
  },
  {
    key: 'inspectorP',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => desk(sim).stations[0]!.p!,
    expected: (f) =>
      round4(clamp(INSPECTOR_P + f, data.events.modifiers.deskPFloor, pCap)),
    values: [0.05, -0.1],
  },
  {
    key: 'machineP',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => effChecker(sim, machineChecker(METAL, 'mx', 0)).pMatch,
    expected: (f) => round4(clamp(METAL.pMatch + f, mLo, mHi)),
    values: [0.05, -0.2],
  },
  {
    key: 'processS',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => processTicksAt(sim, 'machine', ticksFromS(METAL.processS)),
    expected: (f) => Math.max(1, Math.round(ticksFromS(METAL.processS) * f)),
    values: [1.5, 0.8],
  },
  {
    key: 'payrollMult',
    scope: null,
    make: () => {
      const sim = quietSim(1)
      openingA(sim)
      return sim
    },
    read: (sim) => payrollDuePerDay(sim),
    expected: (f) => Math.round(20 * f) + Math.round(8 * f),
    values: [1.5, 0.5],
    coupled: ['payrollAdd'],
  },
  {
    key: 'payrollAdd',
    scope: null,
    make: () => {
      const sim = quietSim(1)
      openingA(sim)
      return sim
    },
    read: (sim) => payrollDuePerDay(sim),
    expected: (f) => SALARIES + Math.round(f),
    values: [15, 30],
    coupled: ['payrollMult'],
  },
  {
    key: 'income',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => deliverNow(sim).paid,
    expected: (f) => Math.round(S_VALUE * f),
    values: [1.2, 0.9],
  },
  {
    key: 'malwareShare',
    scope: null,
    make: () => pastGrace(quietSim(1)),
    read: (sim) => spawnChances(sim)[0]!,
    expected: (f) =>
      clamp(data.parcels.malware.baseShare + f, 0, data.parcels.malware.cap),
    values: [0.05, 0.04],
  },
  {
    key: 'decoyShare',
    scope: null,
    make: () => pastGrace(quietSim(1)),
    read: (sim) => spawnChances(sim)[1]!,
    expected: (f) => clamp(data.parcels.decoyShare + f, 0, 1),
    values: [0.1, -0.05],
  },
  {
    key: 'spawn',
    scope: 'downtown',
    make: () => quietSim(1),
    read: (sim) =>
      spawnIntervalTicks(
        sim,
        districtDef('downtown'),
        data.economy.satisfaction.start,
      ),
    expected: (f) => Math.max(1, Math.round(SPAWN_SECONDS * f * TICKS_PER_S)),
    values: [0.5, 1.5],
  },
  {
    key: 'tossBounty',
    scope: null,
    make: () => fund(quietSim(1)),
    read: (sim) => tossParcel(sim, heldParcel(sim, { malware: true })),
    expected: (f) => Math.round(data.economy.tossBounty * f),
    values: [2, 1.25],
  },
  {
    key: 'wrongTossFee',
    scope: null,
    make: () => fund(quietSim(1)),
    read: (sim) => {
      const before = sim.state.economy.balance
      tossParcel(sim, heldParcel(sim))
      return before - sim.state.economy.balance
    },
    expected: (f) => Math.round(data.economy.wrongTossFee * f),
    values: [2, 0.5],
  },
  {
    key: 'vehiclePrice',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => priceOf(sim, 'vehicle', BIKE.price),
    expected: (f) => Math.round(BIKE.price * f),
    values: [0.8, 1.25],
  },
  {
    key: 'machinePrice',
    scope: null,
    make: () => quietSim(1),
    read: (sim) => priceOf(sim, 'machine', METAL.price),
    expected: (f) => Math.round(METAL.price * f),
    values: [1.5, 0.9],
  },
  {
    key: 'onTimeMaxS',
    scope: null,
    make: () => quietSim(1),
    // 1 when a parcel 20 s past onTimeMaxS is still delivered on time.
    read: (sim) => (deliverNow(sim, ON_TIME + 20).onTime ? 1 : 0),
    expected: (f) => (ON_TIME + 20 <= ON_TIME + f ? 1 : 0),
    values: [30, -10],
  },
  {
    key: 'clearanceS',
    scope: 'docks',
    make: () => atLevel(3),
    read: (sim) => {
      const p = handedOff(sim, 'dk_pier_1')
      return p.clearTick! - sim.state.tick
    },
    expected: (f) => Math.max(1, Math.round(DOCKS_TICKS * f)),
    values: [2, 0.5],
  },
  {
    key: 'shelfCap',
    scope: null,
    make: () => quietSim(1),
    read: (sim) =>
      laneNode(sim.state.lane, sim.state.lane.shelfNodeId)!.cap ?? -1,
    expected: (f) =>
      Math.min(
        data.events.modifiers.shelfCapMax,
        data.levels[0]!.shelfCap + Math.round(f),
      ),
    values: [10, 5],
  },
]

describe('the fold (modifiers.ts modMult / modAdd; B3 §3.6, D-3, D-24)', () => {
  it('MULT_KEYS ∪ ADD_KEYS = MODIFIER_KEYS (disjoint), every key has a probe, and every bound holds the identity', () => {
    const all = [...MULT_KEYS, ...ADD_KEYS]
    expect(new Set(all).size).toBe(all.length)
    expect(all.toSorted()).toEqual([...MODIFIER_KEYS].toSorted())
    expect(PROBES.map((p) => p.key).toSorted()).toEqual(all.toSorted())
    for (const key of MULT_KEYS) {
      expect(B[key][0]).toBeLessThanOrEqual(1)
      expect(B[key][1]).toBeGreaterThanOrEqual(1)
    }
    for (const key of ADD_KEYS) {
      expect(B[key][0]).toBeLessThanOrEqual(0)
      expect(B[key][1]).toBeGreaterThanOrEqual(0)
    }
  })

  it('no rows: every mult key folds to 1 and every add key to 0, for any scope', () => {
    const sim = makeSim(1)
    expect(sim.state.modifiers).toEqual([])
    for (const key of MULT_KEYS) {
      expect(modMult(sim, key)).toBe(1)
      expect(modMult(sim, key, 'bike')).toBe(1)
    }
    for (const key of ADD_KEYS) expect(modAdd(sim, key)).toBe(0)
  })

  it('a row of another key leaves the fold at the identity (the slow path)', () => {
    const sim = makeSim(1)
    row(sim, 'income', 1.2)
    row(sim, 'machineP', 0.1)
    expect(modMult(sim, 'speed')).toBe(1)
    expect(modAdd(sim, 'inspectorP')).toBe(0)
    expect(modMult(sim, 'income')).toBe(1.2)
    expect(modAdd(sim, 'machineP')).toBe(0.1)
  })

  it('two rows of a key multiply (mult) or add (add)', () => {
    const sim = makeSim(1)
    row(sim, 'speed', 1.2)
    row(sim, 'speed', 1.1)
    row(sim, 'onTimeMaxS', 30)
    row(sim, 'onTimeMaxS', -10)
    expect(modMult(sim, 'speed')).toBeCloseTo(1.32, 12)
    expect(modAdd(sim, 'onTimeMaxS')).toBe(20)
  })

  it('the bounds clamp the fold (stacked rows cannot run away), not each row', () => {
    const sim = makeSim(1)
    row(sim, 'speed', 1.3)
    row(sim, 'speed', 1.3)
    expect(modMult(sim, 'speed')).toBe(B.speed[1])
    row(sim, 'speed', 0.4)
    // 1.69 × 0.4 = 0.676: inside the bounds — the clamp is on the product.
    expect(modMult(sim, 'speed')).toBeCloseTo(0.676, 12)
    row(sim, 'payrollAdd', -50)
    expect(modAdd(sim, 'payrollAdd')).toBe(B.payrollAdd[0])
    row(sim, 'malwareShare', 0.3)
    expect(modAdd(sim, 'malwareShare')).toBe(B.malwareShare[1])
  })

  it('scoped rows reach only their scope; an unscoped row reaches every scope', () => {
    const sim = makeSim(1)
    row(sim, 'speed', 1.2, { scope: 'bike' })
    expect(modMult(sim, 'speed', 'bike')).toBe(1.2)
    expect(modMult(sim, 'speed', 'van')).toBe(1)
    expect(modMult(sim, 'speed')).toBe(1)
    row(sim, 'speed', 0.9)
    expect(modMult(sim, 'speed', 'bike')).toBeCloseTo(1.08, 12)
    expect(modMult(sim, 'speed', 'van')).toBe(0.9)
    expect(modMult(sim, 'speed')).toBe(0.9)
  })

  it('mult 0 folds to 0 — alone or stacked — never NaN', () => {
    const sim = makeSim(1)
    row(sim, 'wrongTossFee', 0)
    expect(modMult(sim, 'wrongTossFee')).toBe(0)
    row(sim, 'wrongTossFee', 2)
    expect(modMult(sim, 'wrongTossFee')).toBe(0)
    row(sim, 'payrollMult', 0)
    expect(modMult(sim, 'payrollMult')).toBe(0)
    expect(Number.isNaN(modMult(sim, 'payrollMult'))).toBe(false)
  })

  it('a row is live until its untilTick: at that tick the fold is the identity even before modifiersStep removes it', () => {
    const sim = makeSim(1)
    const m = row(sim, 'income', 1.2, { untilTick: 5 })
    expect(isLive(m, 4)).toBe(true)
    expect(isLive(m, 5)).toBe(false)
    expect(isLive({ ...m, untilTick: null }, 1e9)).toBe(true)
    runTicks(sim, 4)
    expect(modMult(sim, 'income')).toBe(1.2)
    sim.state.tick = 5
    expect(modMult(sim, 'income')).toBe(1)
  })
})

describe('modifierOps (apply / end / expire; D-35)', () => {
  it('applyModifier: m<n> ids, appliedTick, modifiersPeak, `modifier:applied`', () => {
    const sim = makeSim(1)
    runTicks(sim, 3)
    const applied = collect(sim, 'modifier:applied')
    const a = row(sim, 'income', 1.2, { untilTick: 100 })
    const b = row(sim, 'shelfCap', 5)
    expect([a.id, b.id]).toEqual(['m1', 'm2'])
    expect(a.appliedTick).toBe(3)
    expect(sim.state.nextId.modifier).toBe(3)
    expect(sim.state.events.stats.modifiersPeak).toBe(2)
    expect(applied).toEqual([
      { id: 'm1', key: 'income', untilTick: 100, eventId: 'ev_test' },
      { id: 'm2', key: 'shelfCap', untilTick: null, eventId: 'ev_test' },
    ])
    endModifiers(sim, () => true)
    row(sim, 'income', 1.1)
    expect(sim.state.events.stats.modifiersPeak).toBe(2)
  })

  it('modifiersStep ends the rows whose untilTick has come: `modifier:expired` each, one ticker line per label', () => {
    const sim = makeSim(1)
    row(sim, 'income', 1.2, { untilTick: 10, label: 'Boom' })
    row(sim, 'spawn', 0.5, { untilTick: 10, label: 'Boom' })
    row(sim, 'speed', 1.2, { untilTick: 20, label: 'Tailwind' })
    row(sim, 'stop', 0.8, { label: 'Forever' })
    const expired = collect(sim, 'modifier:expired')
    const ticker = collect(sim, 'ticker:news')
    sim.state.tick = 9
    modifiersStep(sim)
    expect(expired).toEqual([])
    sim.state.tick = 10
    modifiersStep(sim)
    expect(expired).toEqual([
      { id: 'm1', key: 'income' },
      { id: 'm2', key: 'spawn' },
    ])
    const ended = data.puns.tickerEvent.modifierEnded
    expect(ticker).toEqual([
      { text: ended.replaceAll('{label}', 'Boom'), kind: 'event' },
    ])
    expect(sim.state.modifiers.map((m) => m.id)).toEqual(['m3', 'm4'])
    sim.state.tick = 1e6
    modifiersStep(sim)
    expect(sim.state.modifiers.map((m) => m.id)).toEqual(['m4'])
  })

  it('endModifiers(pred) removes only the matching rows (an `end` effect); nothing matching → [] and no event', () => {
    const sim = makeSim(1)
    row(sim, 'income', 1.2, { eventId: 'ev_a' })
    row(sim, 'speed', 1.2, { eventId: 'ev_b' })
    const expired = collect(sim, 'modifier:expired')
    expect(endModifiers(sim, (m) => m.eventId === 'ev_z')).toEqual([])
    expect(expired).toEqual([])
    const gone = endModifiers(sim, (m) => m.eventId === 'ev_a')
    expect(gone.map((m) => m.id)).toEqual(['m1'])
    expect(modMult(sim, 'income')).toBe(1)
    expect(modMult(sim, 'speed')).toBe(1.2)
  })
})

describe('every read site (B3 §3.6): identity, one row, two rows, the bounds, expiry', () => {
  for (const pr of PROBES) {
    const mult = isMultKey(pr.key)
    const id = mult ? 1 : 0
    const scope = { scope: pr.scope }
    describe(pr.key, () => {
      it('identity: no row, and a live row of every other key, read the build-2 number', () => {
        const a = pr.make()
        const base = pr.read(a)
        expect(base).toBe(pr.expected(id))
        const b = pr.make()
        for (const other of MODIFIER_KEYS) {
          if (other === pr.key || pr.coupled?.includes(other)) continue
          // In-bounds, non-identity values for every other key.
          const [lo, hi] = B[other]
          row(b, other, isMultKey(other) ? (1 + hi) / 2 : (lo + hi) / 2 || hi)
        }
        expect(pr.read(b)).toBe(base)
      })

      it(`one row (${pr.values[0]}) moves it by exactly the fold`, () => {
        const sim = pr.make()
        row(sim, pr.key, pr.values[0], scope)
        expect(pr.read(sim)).toBe(pr.expected(pr.values[0]))
        expect(pr.read(sim)).not.toBe(pr.expected(id))
      })

      it(`two rows (${pr.values.join(', ')}) stack`, () => {
        const sim = pr.make()
        row(sim, pr.key, pr.values[0], scope)
        row(sim, pr.key, pr.values[1], scope)
        const [lo, hi] = B[pr.key]
        const fold = clamp(
          mult ? pr.values[0] * pr.values[1] : pr.values[0] + pr.values[1],
          lo,
          hi,
        )
        expect(pr.read(sim)).toBe(pr.expected(fold))
      })

      it('the bounds clamp the fold', () => {
        const [lo, hi] = B[pr.key]
        const over = pr.make()
        row(over, pr.key, mult ? hi * 2 + 1 : hi + Math.abs(hi) + 1, scope)
        expect(pr.read(over)).toBe(pr.expected(hi))
        const under = pr.make()
        row(under, pr.key, mult ? lo / 2 : lo - Math.abs(lo) - 1, scope)
        expect(pr.read(under)).toBe(pr.expected(lo))
      })

      it('expiry (tick ≥ untilTick) restores it, with `modifier:expired` and the ticker line', () => {
        const sim = pr.make()
        const expired = collect(sim, 'modifier:expired')
        const ticker = collect(sim, 'ticker:news')
        const m = row(sim, pr.key, pr.values[0], {
          ...scope,
          untilTick: sim.state.tick + 5,
          label: 'Short-lived',
        })
        expect(pr.read(sim)).toBe(pr.expected(pr.values[0]))
        runTicks(sim, 5)
        modifiersStep(sim) // the deck step's first sub-step (idempotent)
        expect(sim.state.modifiers.some((x) => x.id === m.id)).toBe(false)
        expect(pr.read(sim)).toBe(pr.expected(id))
        expect(expired).toEqual([{ id: m.id, key: pr.key }])
        expect(ticker.filter((t) => t.text === 'Short-lived is over')).toEqual([
          { text: 'Short-lived is over', kind: 'event' },
        ])
      })
    })
  }
})

describe('scoped keys touch only their scope', () => {
  it('speed:bike moves the bike, not the van; speed (all) both', () => {
    const sim = quietSim(1)
    const bike = buy(sim, 'bike')
    const van = buy(sim, 'van')
    const raw = (v: Vehicle, f: number, tps: number): number =>
      Math.max(
        1,
        Math.round((tps * driverMults(sim, v).speedMult * f * MILLI) / 10),
      )
    row(sim, 'speed', 1.25, { scope: 'bike' })
    expect(speedPerTick(sim, bike)).toBe(raw(bike, 1.25, BIKE.speedTilesPerS))
    expect(speedPerTick(sim, van)).toBe(raw(van, 1, VAN.speedTilesPerS))
    row(sim, 'speed', 0.8)
    expect(speedPerTick(sim, bike)).toBe(raw(bike, 1, BIKE.speedTilesPerS))
    expect(speedPerTick(sim, van)).toBe(raw(van, 0.8, VAN.speedTilesPerS))
  })

  it('spawn:<district> moves that district’s timer only, and spawnStep schedules with it', () => {
    const sim = quietSim(1)
    const sat = data.economy.satisfaction.start
    const hr = spawnIntervalTicks(sim, districtDef('highres'), sat)
    const dt = spawnIntervalTicks(sim, districtDef('downtown'), sat)
    row(sim, 'spawn', 0.5, { scope: 'downtown' })
    expect(spawnIntervalTicks(sim, districtDef('highres'), sat)).toBe(hr)
    const halved = spawnIntervalTicks(sim, districtDef('downtown'), sat)
    expect(halved).toBe(Math.max(1, Math.round(SPAWN_SECONDS * 0.5 * 10)))
    expect(halved).toBeLessThan(dt)
    const st = sim.state.districts.downtown!
    st.satisfaction = sat
    st.nextSpawnTick = sim.state.tick
    spawnStep(sim)
    expect(st.nextSpawnTick - sim.state.tick).toBe(halved)
  })

  it('processS:desk slows the desk only (seat and lane rate agree); processS:machine the machines only', () => {
    const sim = quietSim(1)
    const d = desk(sim)
    const deskTicks = d.stations[0]!.processTicks!
    const viewRate = (): number => createViewSim(sim).lane.rate()
    expect(laneRatePerMin(sim.state.lane, data, sim)).toBe(
      (60 * TICKS_PER_S) / deskTicks,
    )
    row(sim, 'processS', 2, { scope: 'desk' })
    expect(processTicksAt(sim, 'desk', deskTicks)).toBe(2 * deskTicks)
    expect(processTicksAt(sim, 'machine', 10)).toBe(10)
    expect(processTicksAt(null, 'desk', deskTicks)).toBe(deskTicks)
    expect(laneRatePerMin(sim.state.lane, data, sim)).toBe(
      (60 * TICKS_PER_S) / (2 * deskTicks),
    )
    expect(viewRate()).toBe((60 * TICKS_PER_S) / (2 * deskTicks))
    expect(laneRatePerMin(sim.state.lane, data, null)).toBe(
      (60 * TICKS_PER_S) / deskTicks,
    )
    // The real process time: a parcel seated at the desk is done 2× later.
    laneParcel(sim, d.id)
    const seated = runUntil(sim, () => d.stations[0]!.parcelId !== null, 20)
    expect(seated).toBeGreaterThan(0)
    expect(d.stations[0]!.doneTick! - sim.state.tick).toBe(2 * deskTicks)

    const m = quietSim(1)
    noCheckers(m)
    placeMachine(m, 'metal_detector', 'slot1')
    row(m, 'processS', 2, { scope: 'machine' })
    row(m, 'processS', 0.5, { scope: 'desk' })
    const slot = laneNode(m.state.lane, 'slot1')!
    laneParcel(m, 'slot1')
    runUntil(m, () => slot.stations[0]!.parcelId !== null, 20)
    expect(slot.stations[0]!.doneTick! - m.state.tick).toBe(
      2 * ticksFromS(METAL.processS),
    )
  })

  it('processS rounds to ≥ 1 tick', () => {
    const sim = quietSim(1)
    row(sim, 'processS', 0.5)
    expect(processTicksAt(sim, 'machine', 1)).toBe(1)
    expect(processTicksAt(sim, 'desk', 3)).toBe(2)
  })

  it('clearanceS:docks stretches the Docks clearance, not the Airport’s; unscoped both', () => {
    const sim = atLevel(5)
    row(sim, 'clearanceS', 2, { scope: 'docks' })
    const pier = handedOff(sim, 'dk_pier_1')
    expect(pier.clearTick! - sim.state.tick).toBe(2 * DOCKS_TICKS)
    const air = data.buildings.find(
      (b) => b.district === 'airport' && b.recv > 0,
    )!
    const plane = handedOff(sim, air.id)
    expect(plane.clearTick! - sim.state.tick).toBe(AIRPORT_TICKS)
    row(sim, 'clearanceS', 0.5)
    const plane2 = handedOff(sim, air.id)
    expect(plane2.clearTick! - sim.state.tick).toBe(
      Math.round(AIRPORT_TICKS * 0.5),
    )
  })
})

describe('inspectorP: the desk is re-synced on apply and on expire (people.ts resyncDesks)', () => {
  it('the station p and the checker readout follow the fold; auditState stays clean', () => {
    const sim = quietSim(1)
    const d = desk(sim)
    expect(d.stations[0]!.p).toBe(INSPECTOR_P)
    const m = row(sim, 'inspectorP', 0.05, { untilTick: 10 })
    expect(d.stations[0]!.p).toBe(round4(INSPECTOR_P + 0.05))
    expect(d.fixture!.checker.pMatch).toBe(round4(INSPECTOR_P + 0.05))
    expect(auditState(sim.state, data)).toEqual([])
    runTicks(sim, 10)
    modifiersStep(sim)
    expect(sim.state.modifiers).not.toContain(m)
    expect(d.stations[0]!.p).toBe(INSPECTOR_P)
    expect(d.fixture!.checker.pMatch).toBe(INSPECTOR_P)
    expect(auditState(sim.state, data)).toEqual([])
    // The floor and the cap are result clamps (D-24).
    row(sim, 'inspectorP', -0.35)
    expect(d.stations[0]!.p).toBe(
      Math.max(data.events.modifiers.deskPFloor, round4(INSPECTOR_P - 0.35)),
    )
    endModifiers(sim, () => true)
    row(sim, 'inspectorP', 0.21)
    expect(d.stations[0]!.p).toBe(Math.min(pCap, round4(INSPECTOR_P + 0.21)))
    expect(auditState(sim.state, data)).toEqual([])
  })

  it('the lost-life card’s 5-eye "what if" (detection.ts fiveEyeP) folds inspectorP too', () => {
    const sim = quietSim(1)
    const d = desk(sim)
    const audrey = sim.state.employees.find((e) => e.role === 'inspector')!
    const missed = (): Parcel => {
      const p = injectParcel(sim, 'hr_towers_a', 'dt_cache_cafe', {
        malware: true,
      })
      p.trace.push({
        tick: sim.state.tick,
        what: 'missed',
        ref: d.id,
        chk: d.fixture!.checker.id,
        p: INSPECTOR_P,
        by: audrey.id,
        who: audrey.name,
      })
      return p
    }
    const p5 = effectiveP(data, { eye: 5 }, [])
    // One roll: compound([p5]) = 1 − (1 − p5).
    expect(lostLifeReport(sim, missed(), false).inspectorRate).toBeCloseTo(
      p5,
      12,
    )
    row(sim, 'inspectorP', -0.1)
    expect(lostLifeReport(sim, missed(), false).inspectorRate).toBeCloseTo(
      effectiveP(data, { eye: 5 }, [], -0.1),
      12,
    )
    expect(effectiveP(data, { eye: 5 }, [], -0.1)).toBe(round4(p5 - 0.1))
  })
})

describe('machineP: the roll, the catch rate shown and the condition are one number (D-5)', () => {
  it('effChecker: machines + the fold (clamped, 4 dp), desks unchanged, the stored checker untouched', () => {
    const sim = detectorLane()
    const c = laneNode(sim.state.lane, 'slot1')!.fixture!.checker
    expect(effChecker(sim, c)).toBe(c)
    row(sim, 'machineP', 0.05)
    expect(effChecker(sim, c)).toMatchObject({
      pMatch: round4(METAL.pMatch + 0.05),
      pOther: round4(METAL.pOther + 0.05),
    })
    expect(c.pMatch).toBe(METAL.pMatch)
    const deskSim = quietSim(1)
    row(deskSim, 'machineP', 0.2)
    const dc = desk(deskSim).fixture!.checker
    expect(effChecker(deskSim, dc)).toBe(dc)
    endModifiers(sim, () => true)
    row(sim, 'machineP', -0.7)
    expect(effChecker(sim, c)).toMatchObject({ pMatch: mLo, pOther: mLo })
    row(sim, 'machineP', 0.29) // −0.41 in all
    expect(effChecker(sim, c)).toMatchObject({
      pMatch: round4(METAL.pMatch - 0.41),
      pOther: mLo,
    })
  })

  it('the forced roll draws the p that laneCatchRate(…, ctx), the ViewSim detection and laneRateAtLeast read; the trace stores it', () => {
    const sim = detectorLane()
    row(sim, 'machineP', 0.05)
    const lane = sim.state.lane
    const rate = laneCatchRate(lane, 'metal', [], sim)
    const q = round4(METAL.pMatch + 0.05)
    // One checker: compound([q]) = 1 − (1 − q).
    expect(rate).toBeCloseTo(q, 12)
    expect(laneCatchRate(lane, 'metal', [], null)).toBeCloseTo(METAL.pMatch, 12)
    const vs = createViewSim(sim)
    expect(vs.lane.detection()).toEqual([
      { strain: 'metal', d: rate, counter: 'metal_detector' },
    ])
    expect(vs.laneStats().detectionPct).toBe(Math.round(100 * rate))
    const refs = { target: null, pick: null }
    expect(condHolds(sim, { laneRateAtLeast: rate }, refs)).toBe(true)
    expect(condHolds(sim, { laneRateAtLeast: rate + 1e-9 }, refs)).toBe(false)
    // The roll itself.
    const seen: number[] = []
    const rng = sim.rng
    const real = rng.chance.bind(rng)
    rng.chance = (p: number): boolean => {
      seen.push(p)
      return real(p)
    }
    const p = laneParcel(sim, 'slot1', { malware: true, strain: 'metal' })
    runUntil(sim, () => p.nodeDoneTick !== null, 50)
    Reflect.deleteProperty(rng, 'chance')
    expect(seen).toEqual([q])
    expect(seen[0]).toBeCloseTo(rate, 12)
    const entry = p.trace.find((t) => t.chk !== undefined)!
    expect(entry.p).toBe(q)
  })

  it('the "what if" checkers (extra) and the lost-life card’s debug route roll with the fold too', () => {
    const sim = detectorLane()
    row(sim, 'machineP', 0.05)
    const counter = machineChecker(METAL, 'counter:metal_detector', 0)
    const q = round4(METAL.pMatch + 0.05)
    expect(laneCatchRate(sim.state.lane, 'metal', [counter], sim)).toBeCloseTo(
      1 - (1 - q) * (1 - q),
      12,
    )
    expect(laneCatchRate(sim.state.lane, 'metal', [counter], null)).toBeCloseTo(
      1 - (1 - METAL.pMatch) ** 2,
      12,
    )
    debugMalwareDelivery(sim)
    const lost = sim.state.lastLostLife!
    if (lost.kind === 'event') throw new Error('expected a parcel loss')
    expect(lost.laneRate).toBeCloseTo(q, 12)
    expect(
      lost.path.some((h) => h.text?.includes(`${pctOf(q)}% vs metal`)),
    ).toBe(true)
    expect(lost.counterRate).toBeCloseTo(1 - (1 - q) * (1 - q), 12)
  })
})

describe('payroll: payrollMult per salary, payrollAdd as subscriptions, absence unpaid (D-34)', () => {
  it('identity: payday debits Σ salaries = payrollDuePerDay, as build 2', () => {
    const sim = opened()
    expect(payrollDuePerDay(sim)).toBe(SALARIES)
    const paid = collect(sim, 'payroll:paid')
    payday(sim)
    expect(paid).toEqual([{ amount: SALARIES }])
  })

  it('×0.5 pays round(salary × 0.5) each; payroll:paid, lastPayroll and payrollPaid agree', () => {
    const sim = opened()
    row(sim, 'payrollMult', 0.5)
    const due = payrollDuePerDay(sim)
    expect(due).toBe(10 + 4)
    const paid = collect(sim, 'payroll:paid')
    payday(sim)
    expect(paid).toEqual([{ amount: due }])
    expect(sim.state.economy.lastPayroll?.paid).toBe(due)
    expect(sim.state.stats.payrollPaid).toBe(due)
  })

  it('×0: everyone is paid $0 — no payroll line, unpaid marks clear', () => {
    const sim = quietSim(1)
    openingA(sim)
    sim.state.economy.balance = 0
    for (const e of sim.state.employees) e.unpaidPaydays = 1
    row(sim, 'payrollMult', 0)
    const paid = collect(sim, 'payroll:paid')
    const short = collect(sim, 'payroll:short')
    const log = eventLog(sim)
    payday(sim)
    expect(paid).toEqual([])
    expect(short).toEqual([])
    expect(lines(log, 'payroll')).toEqual([])
    expect(sim.state.employees.every((e) => e.unpaidPaydays === 0)).toBe(true)
    expect(sim.state.employees.every((e) => e.active)).toBe(true)
    expect(sim.state.economy.lastPayroll).toMatchObject({
      paid: 0,
      shortEmployeeIds: [],
    })
  })

  it('payrollAdd: one `subscriptions` line after the payroll, outside payrollPaid / lastPayroll / payroll:paid', () => {
    const sim = opened()
    row(sim, 'payrollAdd', 15.4)
    expect(payrollDuePerDay(sim)).toBe(SALARIES + 15)
    const paid = collect(sim, 'payroll:paid')
    const log = eventLog(sim)
    const before = sim.state.economy.balance
    payday(sim)
    expect(lines(log, 'payroll')).toEqual([-SALARIES])
    expect(lines(log, 'subscriptions')).toEqual([-15])
    const order = log
      .filter((e) => e.name === 'money:changed')
      .map((e) => (e.p as { reason: string }).reason)
    expect(order.indexOf('payroll')).toBeLessThan(
      order.indexOf('subscriptions'),
    )
    expect(paid).toEqual([{ amount: SALARIES }])
    expect(sim.state.stats.payrollPaid).toBe(SALARIES)
    expect(sim.state.economy.lastPayroll?.paid).toBe(SALARIES)
    expect(before - sim.state.economy.balance).toBe(SALARIES + 15)
  })

  it('subscriptions short: skipped with the ticker line — no debit, no unpaid mark, no walkout', () => {
    const sim = quietSim(1)
    openingA(sim)
    sim.state.economy.balance = SALARIES + 5
    row(sim, 'payrollAdd', 10)
    const ticker = collect(sim, 'ticker:news')
    const short = collect(sim, 'payroll:short')
    const log = eventLog(sim)
    payday(sim)
    expect(lines(log, 'payroll')).toEqual([-SALARIES])
    expect(lines(log, 'subscriptions')).toEqual([])
    expect(sim.state.economy.balance).toBe(5)
    expect(ticker).toContainEqual({
      text: data.puns.tickerEvent.subscriptionsUnpaid,
      kind: 'payroll',
    })
    expect(short).toEqual([])
    expect(sim.state.employees.every((e) => e.unpaidPaydays === 0)).toBe(true)
  })

  it('an absent worker is unpaid for the days away: out of payOrder, the mark untouched', () => {
    const sim = opened()
    const driver = sim.state.employees.find((e) => e.role === 'driver')!
    driver.absentUntilTick = sim.state.tick + 2 * TICKS_PER_DAY
    driver.unpaidPaydays = 1
    expect(payOrder(sim).map((e) => e.id)).not.toContain(driver.id)
    expect(payrollDuePerDay(sim)).toBe(20)
    const paid = collect(sim, 'payroll:paid')
    payday(sim)
    expect(paid).toEqual([{ amount: 20 }])
    expect(driver.unpaidPaydays).toBe(1)
    expect(driver.active).toBe(true)
  })

  it('payrollDuePerDay equals what payday debits (employees + subscriptions) under both keys', () => {
    const sim = opened()
    row(sim, 'payrollMult', 1.3)
    row(sim, 'payrollAdd', 12)
    runTicks(sim, TICKS_PER_DAY - 1)
    const due = payrollDuePerDay(sim)
    expect(due).toBe(Math.round(20 * 1.3) + Math.round(8 * 1.3) + 12)
    const log = eventLog(sim)
    runTicks(sim, 1)
    const debited = [
      ...lines(log, 'payroll'),
      ...lines(log, 'subscriptions'),
    ].reduce((a, b) => a - b, 0)
    expect(debited).toBe(due)
  })
})

describe('income: the delivery payout (rounded once) and the hub hand-off (locked)', () => {
  it('a delivery pays round(value × income) — one rounding — and lifetime earned follows', () => {
    const sim = quietSim(1)
    row(sim, 'income', 1.3)
    const age = 150 // f(t) is fractional here: the value is not whole dollars
    const p = { spawnedTick: 0, baseValue: S_VALUE, mult: 1, lockedValue: null }
    const raw = valueAt(data, p, age * TICKS_PER_S)
    expect(Number.isInteger(raw)).toBe(false)
    runTicks(sim, age * TICKS_PER_S)
    const d = deliverNow(sim, age)
    expect(d.paid).toBe(Math.round(raw * 1.3))
    expect(d.paid).not.toBe(Math.round(Math.round(raw) * 1.3))
    expect(d.lifetime).toBe(d.paid)
  })

  it('a hand-off locks round(base × mult × f × income); clearance pays the locked value after the row ends', () => {
    const sim = atLevel(3)
    const m = row(sim, 'income', 1.2)
    const p = handedOff(sim, 'dk_pier_1', 100, 'M')
    const locked = lockValue(data, p, sim.state.tick, 1.2)
    expect(p.lockedValue).toBe(locked)
    expect(locked).toBe(
      Math.round(
        data.parcels.sizes.M.value *
          docksDef.valueMult *
          valueAt(
            data,
            { ...p, lockedValue: null, mult: 1, baseValue: 1 },
            sim.state.tick,
          ) *
          1.2,
      ),
    )
    endModifiers(sim, (x) => x.id === m.id)
    const cleared = collect(sim, 'parcel:cleared')
    runTicks(sim, DOCKS_TICKS)
    expect(cleared).toHaveLength(1)
    expect(cleared[0]!.paid).toBe(locked)
  })
})

describe('onTimeMaxS: the delivery and the clearance on-time reads (D-32)', () => {
  it('isOnTime takes the fold as extraS', () => {
    expect(isOnTime(data, ON_TIME + 10)).toBe(false)
    expect(isOnTime(data, ON_TIME + 10, 10)).toBe(true)
    expect(isOnTime(data, ON_TIME, -1)).toBe(false)
  })

  it('a hand-off on time only under the row is cleared on time while the row lasts', () => {
    const sim = atLevel(3)
    row(sim, 'onTimeMaxS', 30)
    handedOff(sim, 'dk_pier_1', ON_TIME + 20)
    const cleared = collect(sim, 'parcel:cleared')
    runTicks(sim, DOCKS_TICKS)
    expect(cleared[0]!.onTime).toBe(true)
  })
})

describe('clearanceS: the hand-off tick is stored (the clearance no longer derives it)', () => {
  it('Parcel.handOffTick = the hand-off tick; on time is judged at it, not at clearTick − clearanceS', () => {
    const sim = atLevel(3)
    row(sim, 'clearanceS', 3, { scope: 'docks' })
    const p = handedOff(sim, 'dk_pier_1', ON_TIME - 10)
    expect(p.handOffTick).toBe(sim.state.tick)
    expect(handOffTick(data, p)).toBe(sim.state.tick)
    // Derived the build-2 way it would be 2 × clearanceS later — late.
    expect(p.clearTick! - DOCKS_TICKS).toBeGreaterThan(sim.state.tick)
    const cleared = collect(sim, 'parcel:cleared')
    runTicks(sim, 3 * DOCKS_TICKS - 1)
    expect(cleared).toEqual([])
    runTicks(sim, 1)
    expect(cleared).toHaveLength(1)
    expect(cleared[0]!.onTime).toBe(true)
  })

  it('a parcel without the stored tick (an older save) still derives it', () => {
    const sim = atLevel(3)
    const p = handedOff(sim, 'dk_pier_1')
    delete p.handOffTick
    expect(handOffTick(data, p)).toBe(p.clearTick! - DOCKS_TICKS)
  })
})

describe('tossBounty / wrongTossFee', () => {
  it('×2 bounty: the event, the credit (earned) and the return agree', () => {
    const sim = fund(quietSim(1))
    row(sim, 'tossBounty', 2)
    const tossed = collect(sim, 'parcel:tossed')
    const before = sim.state.economy.lifetimeEarned
    const got = tossParcel(sim, heldParcel(sim, { malware: true }))
    expect(got).toBe(2 * data.economy.tossBounty)
    expect(tossed[0]!.bounty).toBe(got)
    expect(sim.state.economy.lifetimeEarned - before).toBe(got)
  })

  it('×0 bounty and ×0 fee: no money moves, no NaN', () => {
    const sim = fund(quietSim(1))
    row(sim, 'tossBounty', 0)
    row(sim, 'wrongTossFee', 0)
    const log = eventLog(sim)
    const before = sim.state.economy.balance
    expect(tossParcel(sim, heldParcel(sim, { malware: true }))).toBe(0)
    expect(tossParcel(sim, heldParcel(sim))).toBe(0)
    expect(sim.state.economy.balance).toBe(before)
    expect(log.filter((e) => e.name === 'money:changed')).toEqual([])
  })

  it('the modded fee is still clamped to the balance', () => {
    const sim = quietSim(1)
    row(sim, 'wrongTossFee', 2)
    sim.state.economy.balance = 30
    tossParcel(sim, heldParcel(sim))
    expect(sim.state.economy.balance).toBe(0)
  })
})

describe('vehiclePrice / machinePrice: priceOf drives the purchase; refunds are half the price paid', () => {
  it('a bike at ×0.8 debits and stores the sale price; selling it refunds half of that', () => {
    const sim = quietSim(1)
    row(sim, 'vehiclePrice', 0.8)
    const price = priceOf(sim, 'vehicle', BIKE.price)
    expect(price).toBe(Math.round(BIKE.price * 0.8))
    sim.state.economy.balance = price
    const res = sim.dispatch({
      kind: 'buyVehicle',
      type: 'bike',
      applicantId: null,
    })
    expect(res.ok).toBe(true)
    expect(sim.state.economy.balance).toBe(0)
    const v = sim.state.vehicles[0]!
    expect(v.purchasePrice).toBe(price)
    endModifiers(sim, () => true)
    buy(sim, 'bike') // the last vehicle is unsellable
    const before = sim.state.economy.balance
    expect(sim.dispatch({ kind: 'sellVehicle', id: v.id }).ok).toBe(true)
    expect(sim.state.economy.balance - before).toBe(
      Math.round(price * data.economy.sellRefund),
    )
  })

  it('a refused purchase checks the modded price (×1.5 with only the list price in the bank)', () => {
    const sim = quietSim(1)
    row(sim, 'vehiclePrice', 1.5)
    sim.state.economy.balance = BIKE.price
    const res = sim.dispatch({
      kind: 'buyVehicle',
      type: 'bike',
      applicantId: null,
    })
    expect(res).toMatchObject({ ok: false, reason: 'insufficient-funds' })
  })

  it('a Metal detector at ×1.5 stores its price; removal refunds removalRefund × that', () => {
    const sim = quietSim(1)
    noCheckers(sim)
    row(sim, 'machinePrice', 1.5)
    const price = priceOf(sim, 'machine', METAL.price)
    sim.state.economy.balance = price
    expect(
      sim.dispatch({
        kind: 'buyMachine',
        defId: 'metal_detector',
        nodeId: 'slot1',
      }).ok,
    ).toBe(true)
    expect(sim.state.economy.balance).toBe(0)
    const c = laneNode(sim.state.lane, 'slot1')!.fixture!.checker
    expect(c.price).toBe(price)
    expect(sim.dispatch({ kind: 'removeFixture', nodeId: 'slot1' }).ok).toBe(
      true,
    )
    expect(sim.state.economy.balance).toBe(
      Math.round(price * data.machines.removalRefund),
    )
  })

  it('the Sorter Arm keeps its list price under machinePrice (D-21)', () => {
    const sim = atLevel(4)
    row(sim, 'machinePrice', 0.5)
    const arm = data.machines.upgrades.find((u) => u.id === 'sorter_arm')!
    const before = sim.state.economy.balance
    const res = sim.dispatch({
      kind: 'buyMachine',
      defId: 'sorter_arm',
      nodeId: sim.state.lane.holdBayNodeId,
    })
    expect(res.ok).toBe(true)
    expect(before - sim.state.economy.balance).toBe(arm.price)
  })
})

describe('shelfCap: the level row + the fold, ≤ shelfCapMax, kept across a level-up', () => {
  it('a +10 row raises the shelf now, survives the level-up, and ends back at the row', () => {
    const sim = quietSim(1)
    const shelf = (): number =>
      laneNode(sim.state.lane, sim.state.lane.shelfNodeId)!.cap!
    const m = row(sim, 'shelfCap', 10)
    expect(shelf()).toBe(data.levels[0]!.shelfCap + 10)
    expect(sim.state.level.shelfCap).toBe(shelf())
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    expect(shelf()).toBe(data.levels[1]!.shelfCap + 10)
    expect(auditState(sim.state, data)).toEqual([])
    endModifiers(sim, (x) => x.id === m.id)
    expect(shelf()).toBe(data.levels[1]!.shelfCap)
    expect(sim.state.level.shelfCap).toBe(data.levels[1]!.shelfCap)
  })

  it('the cap stops at modifiers.shelfCapMax', () => {
    const cap = data.levels[1]!.shelfCap + 5
    const sim = makeSim(1, { events: { modifiers: { shelfCapMax: cap } } })
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 2 }).ok).toBe(true)
    row(sim, 'shelfCap', 20)
    expect(sim.state.level.shelfCap).toBe(cap)
    expect(laneNode(sim.state.lane, sim.state.lane.shelfNodeId)!.cap).toBe(cap)
  })
})

describe('identity over a run: a live row at the identity of every key changes nothing', () => {
  it('3 minutes of opening A with mult-1 / add-0 rows of all 18 keys (the slow path everywhere) = the plain run', () => {
    const plain = makeSim(7)
    const rows = makeSim(7)
    for (const key of MODIFIER_KEYS) row(rows, key, isMultKey(key) ? 1 : 0)
    for (const sim of [plain, rows]) {
      openingA(sim, 'pool')
      runTicks(sim, 180 * TICKS_PER_S)
    }
    expect(rows.state.modifiers).toHaveLength(MODIFIER_KEYS.length)
    expect(plain.state.stats.deliveries).toBeGreaterThan(0)
    expect(strip(rows)).toBe(strip(plain))
  })
})
