// plan.md §12.9 / §12.7 task 1: `playtest.json` has every field with the
// right type (version 1, buildStamp, seed, startedAt, device {ua, cssW, cssH,
// dpr, zoom, maxTexture}, elapsedS / simS / pausedS, firstDeliveryS,
// firstMalware {spawnedS, caughtS, by, tossedS}, level2AtS, truckBoughtS,
// deliveries {total, onTime, late, byType}, moneyPerMin, lifetimeEarned,
// balanceEnd, malware {spawned, caught, missed, tossedClean, cleared},
// livesLost[], vehiclesBought[], inspectorsHired, machinesBought[], taps,
// tapsPerMin, rushTaps, viewSwitches, warehouseS, fps {p50, p5, min,
// samples}, holdBayEvents, holdBayEventsPer10Min, stalls {count, totalS},
// payroll {paid, short, walkouts}, satisfactionEnd {district: value}) — both
// from a recorder run under Node and in the committed format example
// tests/playtest/seed-7.json (written by `vlr shots`' 12-minute run). The
// rules: every *S is sim seconds except elapsedS / pausedS (wall clock),
// null = not reached, p5 = the slowest 5 %, hidden time is not play time,
// and a stored profile resumes only for the same run.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  fpsStats,
  funBar,
  MAX_FRAME_GAP_MS,
  moneyPerMinute,
  PlaytestRecorder,
  sameRun,
  type Playtest,
  type PlaytestDevice,
  type RecorderDeps,
} from '../../src/metrics/playtest.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import { dataFixture, makeSim } from '../sim/helpers.ts'

const data = dataFixture()
const EXAMPLE = 'tests/playtest/seed-7.json'

// ---- the schema ------------------------------------------------------------------

type Kind = 'number' | 'string' | 'boolean' | 'number|null' | 'string|null'
type Shape =
  | Kind
  | { [key: string]: Shape }
  | { array: Shape }
  | { record: Kind }
  | { literal: number }

const LIFE: Shape = {
  atS: 'number',
  label: 'string',
  strain: 'string|null',
  laneRate: 'number',
  counter: 'string|null',
  clearedByPlayer: 'boolean',
}

/** plan.md §12.9, field by field. */
const SCHEMA: Shape = {
  version: { literal: 1 },
  buildStamp: 'string',
  seed: 'number',
  startedAt: 'string',
  device: {
    ua: 'string',
    cssW: 'number',
    cssH: 'number',
    dpr: 'number',
    zoom: 'number',
    maxTexture: 'number',
  },
  elapsedS: 'number',
  simS: 'number',
  pausedS: 'number',
  firstDeliveryS: 'number|null',
  firstMalware: {
    spawnedS: 'number|null',
    caughtS: 'number|null',
    by: 'string|null',
    tossedS: 'number|null',
  },
  level2AtS: 'number|null',
  truckBoughtS: 'number|null',
  deliveries: {
    total: 'number',
    onTime: 'number',
    late: 'number',
    byType: { bike: 'number', van: 'number', truck: 'number' },
  },
  moneyPerMin: { array: 'number' },
  lifetimeEarned: 'number',
  balanceEnd: 'number',
  malware: {
    spawned: 'number',
    caught: 'number',
    missed: 'number',
    tossedClean: 'number',
    cleared: 'number',
  },
  livesLost: { array: LIFE },
  vehiclesBought: { array: { type: 'string', atS: 'number' } },
  inspectorsHired: 'number',
  machinesBought: { array: { id: 'string', atS: 'number' } },
  taps: 'number',
  tapsPerMin: 'number',
  rushTaps: 'number',
  viewSwitches: 'number',
  warehouseS: 'number',
  fps: { p50: 'number', p5: 'number', min: 'number', samples: 'number' },
  holdBayEvents: 'number',
  holdBayEventsPer10Min: 'number',
  stalls: { count: 'number', totalS: 'number' },
  payroll: { paid: 'number', short: 'number', walkouts: 'number' },
  satisfactionEnd: { record: 'number' },
}

function kindOk(kind: Kind, v: unknown): boolean {
  const finite = typeof v === 'number' && Number.isFinite(v)
  switch (kind) {
    case 'number':
      return finite
    case 'string':
      return typeof v === 'string'
    case 'boolean':
      return typeof v === 'boolean'
    case 'number|null':
      return v === null || finite
    case 'string|null':
      return v === null || typeof v === 'string'
  }
}

/** Every mismatch as `path: expected …, got …` (exact keys: none missing, none extra). */
function problems(shape: Shape, v: unknown, path = '$'): string[] {
  if (typeof shape === 'string')
    return kindOk(shape, v)
      ? []
      : [`${path}: expected ${shape}, got ${JSON.stringify(v)}`]
  if ('literal' in shape && Object.keys(shape).length === 1)
    return v === shape.literal ? [] : [`${path}: expected ${shape.literal}`]
  if ('array' in shape && Object.keys(shape).length === 1) {
    if (!Array.isArray(v)) return [`${path}: expected an array`]
    return v.flatMap((x, i) =>
      problems(shape.array as Shape, x, `${path}[${i}]`),
    )
  }
  if ('record' in shape && Object.keys(shape).length === 1) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return [`${path}: expected an object`]
    return Object.entries(v).flatMap(([k, x]) =>
      problems(shape.record as Kind, x, `${path}.${k}`),
    )
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return [`${path}: expected an object`]
  const o = v as Record<string, unknown>
  const want = shape as Record<string, Shape>
  const out: string[] = []
  for (const k of Object.keys(want))
    if (!(k in o)) out.push(`${path}.${k}: missing`)
    else out.push(...problems(want[k]!, o[k], `${path}.${k}`))
  for (const k of Object.keys(o))
    if (!(k in want)) out.push(`${path}.${k}: not in plan.md §12.9`)
  return out
}

// ---- a recorder over a headless policy run -------------------------------------------

const DEVICE: PlaytestDevice = {
  ua: 'vitest',
  cssW: 393,
  cssH: 852,
  dpr: 3,
  zoom: 1,
  maxTexture: 8192,
}

interface Rig {
  sim: Sim
  rec: PlaytestRecorder
  clock: { ms: number; paused: boolean; fps: number; taps: number }
}

function rig(
  sim: Sim,
  stored: unknown = null,
  deps: Partial<RecorderDeps> = {},
): Rig {
  const clock = { ms: 1_790_000_000_000, paused: false, fps: 60, taps: 0 }
  const rec = new PlaytestRecorder({
    buildStamp: 'test 2026-10-30',
    device: () => DEVICE,
    now: () => clock.ms,
    fps: () => clock.fps,
    pointerDowns: () => clock.taps,
    isPaused: () => clock.paused,
    ...deps,
  })
  rec.attach(sim, stored)
  rec.update()
  return { sim, rec, clock }
}

/** `s` sim seconds at 1x: one frame (update) per tick, the policy before each. */
function play(r: Rig, s: number, policy?: { step(): void }): void {
  for (let i = 0; i < s * 10; i++) {
    policy?.step()
    r.sim.tick()
    r.clock.ms += 100
    r.rec.update()
  }
}

/** The seed-7 competent-policy run the e2e format example also uses (12 min). */
function policyRun(): { r: Rig; pt: Playtest } {
  const r = rig(makeSim(7))
  const policy = createPolicy(r.sim, 'competent')
  r.clock.taps = 3
  play(r, 300, policy)
  r.rec.setView('warehouse')
  play(r, 60, policy)
  r.rec.setView('city')
  play(r, 360, policy)
  return { r, pt: r.rec.snapshot() }
}

const run = policyRun()

describe('plan.md §12.9: every playtest.json field, with its type', () => {
  it('a 12-minute seed-7 policy profile matches the schema exactly', () => {
    expect(problems(SCHEMA, run.pt)).toEqual([])
    // JSON-safe (what the card downloads and pm.playtest.v1 stores).
    expect(JSON.parse(JSON.stringify(run.pt))).toEqual(run.pt)
  })

  it(`the committed format example ${EXAMPLE} (vlr shots) matches it too`, () => {
    expect(existsSync(EXAMPLE), `${EXAMPLE} missing: run vlr shots`).toBe(true)
    const ex = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Playtest
    expect(problems(SCHEMA, ex)).toEqual([])
    expect(ex.seed).toBe(7)
    expect(ex.simS).toBeGreaterThanOrEqual(720)
    expect(ex.fps.samples).toBeGreaterThan(0)
    expect(ex.moneyPerMin.length).toBe(Math.floor(ex.simS / 60))
  })
})

describe('plan.md §12.9 rules: sim seconds, null = not reached', () => {
  const { r, pt } = run
  const st = r.sim.state.stats

  it('*S fields are sim seconds (ticks ÷ 10) read from the sim', () => {
    expect(pt.simS).toBe(720)
    expect(pt.firstDeliveryS).toBe((st.firstDeliveryTick ?? NaN) / 10)
    expect(pt.firstMalware.caughtS).toBe((st.firstCatchTick ?? NaN) / 10)
    expect(pt.firstMalware.spawnedS).not.toBeNull()
    expect(pt.firstMalware.spawnedS!).toBeLessThanOrEqual(
      pt.firstMalware.caughtS!,
    )
    expect(['inspector', ...data.machines.checkers.map((c) => c.id)]).toContain(
      pt.firstMalware.by,
    )
    expect(pt.warehouseS).toBe(60)
  })

  it('null = not reached (seed 7 levels up just before 12:00 since M7 quests, the truck comes later)', () => {
    expect(r.sim.state.level.level).toBe(2)
    expect(pt.level2AtS).toBe((st.levelTick['2'] ?? NaN) / 10)
    expect(st.truckTick).toBeNull()
    expect(pt.truckBoughtS).toBeNull()
  })

  it('deliveries and malware are the sim counters; byType covers every delivery', () => {
    expect(pt.deliveries).toMatchObject({
      total: st.deliveries,
      onTime: st.onTime,
      late: st.late,
    })
    const byType = pt.deliveries.byType
    expect(byType.bike + byType.van + byType.truck).toBe(st.deliveries)
    expect(pt.malware).toMatchObject({
      spawned: st.malwareSpawned,
      caught: st.malwareCaught,
      missed: st.malwareMissed,
      tossedClean: r.sim.state.lane.quarantine.clean,
    })
    expect(pt.holdBayEvents).toBe(st.holdBayEvents)
    expect(pt.holdBayEventsPer10Min).toBe(
      Math.round(((st.holdBayEvents * 600) / 720) * 10) / 10,
    )
  })

  it('moneyPerMin = gross income per in-game minute (sums to lifetime earned at the minute)', () => {
    expect(pt.moneyPerMin).toHaveLength(12)
    const sum = pt.moneyPerMin.reduce((a, b) => a + b, 0)
    expect(sum).toBe(st.minutes.at(-1)?.earned)
    expect(
      moneyPerMinute([{ earned: 20 }, { earned: 68 }, { earned: 68 }]),
    ).toEqual([20, 48, 0])
  })

  it('purchases, hires and rushes come from the command log', () => {
    const log = r.sim.commandLog
    expect(pt.vehiclesBought).toEqual(
      log
        .filter((e) => e.cmd.kind === 'buyVehicle')
        .map((e) => ({
          type: (e.cmd as { type: string }).type,
          atS: e.tick / 10,
        })),
    )
    expect(pt.vehiclesBought[0]?.type).toBe('bike')
    expect(pt.machinesBought.map((m) => m.id)).toContain('metal_detector')
    expect(pt.inspectorsHired).toBe(
      log.filter((e) => e.cmd.kind === 'hire' && e.cmd.role === 'inspector')
        .length,
    )
    expect(pt.rushTaps).toBe(log.filter((e) => e.cmd.kind === 'rush').length)
  })

  it('satisfactionEnd lists the live local districts (Industrial opens at L2)', () => {
    expect(Object.keys(pt.satisfactionEnd).toSorted()).toEqual([
      'downtown',
      'highres',
      'industrial',
    ])
  })

  it('elapsedS / pausedS are wall seconds; taps / tapsPerMin per wall minute; one fps sample per second', () => {
    expect(pt.elapsedS).toBe(720)
    expect(pt.pausedS).toBe(0)
    expect(pt.taps).toBe(3)
    expect(pt.tapsPerMin).toBe(0.3)
    expect(pt.fps).toEqual({ p50: 60, p5: 60, min: 60, samples: 720 })
    expect(pt.viewSwitches).toBe(2)
    expect(pt.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(pt.device).toEqual(DEVICE)
  })
})

describe('plan.md §12.9: fps percentiles (p5 = the slowest 5 %)', () => {
  it('nearest rank over the per-second samples', () => {
    const hist: Record<string, number> = { '60': 90, '40': 4, '22': 1, '59': 5 }
    expect(fpsStats(hist)).toEqual({ p50: 60, p5: 40, min: 22, samples: 100 })
    expect(fpsStats({})).toEqual({ p50: 0, p5: 0, min: 0, samples: 0 })
  })

  it('samples the injected fps once per elapsed second', () => {
    const r = rig(makeSim(1))
    for (const f of [60, 60, 30, 58]) {
      r.clock.fps = f
      r.clock.ms += 1000
      r.rec.update()
    }
    expect(r.rec.snapshot().fps).toEqual({
      p50: 58,
      p5: 30,
      min: 30,
      samples: 4,
    })
  })
})

describe('plan.md §12.9: wall clocks — paused time counts, hidden time does not', () => {
  it('pausedS grows while the sim is held; a hidden tab is not play time', () => {
    const r = rig(makeSim(1))
    r.clock.paused = true
    for (let i = 0; i < 30; i++) {
      r.clock.ms += 100
      r.rec.update()
    }
    r.clock.paused = false
    r.rec.hidden()
    r.clock.ms += 3_600_000 // an hour in the background
    r.rec.update()
    r.clock.ms += 500
    r.rec.update()
    const pt = r.rec.snapshot()
    expect(pt.pausedS).toBe(3)
    expect(pt.elapsedS).toBe(3.5)
    expect(pt.simS).toBe(0)
  })

  it('a long frame gap (a hitch) counts at most MAX_FRAME_GAP_MS', () => {
    const r = rig(makeSim(1))
    r.clock.ms += 10_000
    r.rec.update()
    expect(r.rec.snapshot().elapsedS).toBe(MAX_FRAME_GAP_MS / 1000)
  })
})

describe('plan.md §12.9: lives, stalls, payroll and the Hold Bay from sim events', () => {
  it('records each lost life with its label, strain, lane rate, counter and Clear', () => {
    const sim = makeSim(3)
    const r = rig(sim)
    const res = sim.dispatch({ kind: 'debugMalwareDelivery' })
    expect(res.ok).toBe(true)
    const pt = r.rec.snapshot()
    expect(pt.livesLost).toHaveLength(1)
    expect(problems({ array: LIFE }, pt.livesLost)).toEqual([])
    const l = pt.livesLost[0]!
    expect(l.atS).toBe(sim.state.tick / 10)
    expect(l.label).toBe(sim.state.lastLostLife?.label)
    expect(l.clearedByPlayer).toBe(false)
    expect(pt.malware.missed).toBe(1)
  })

  it('counts a stall once until the lane resumes; totalS from the stall seconds', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    sim.events.emit('lane:stalled', { reason: 'holdBayFull', nodeId: 'hold' })
    sim.events.emit('lane:stalled', { reason: 'shelfFull', nodeId: 'shelf' })
    sim.events.emit('lane:resumed', {})
    sim.events.emit('lane:stalled', { reason: 'shelfFull', nodeId: 'shelf' })
    sim.state.lane.stallSecondsToday = 4.2
    expect(r.rec.snapshot().stalls).toEqual({ count: 2, totalS: 4.2 })
  })

  it('payroll {paid, short, walkouts} counts paydays, short paydays and walkouts', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    sim.events.emit('payroll:paid', { amount: 30 })
    sim.events.emit('payroll:paid', { amount: 30 })
    sim.events.emit('payroll:short', { employeeIds: [1] })
    sim.events.emit('worker:walkedOut', {
      employeeId: 1,
      role: 'driver',
      nodeId: null,
      vehicleId: 1,
    })
    expect(r.rec.snapshot().payroll).toEqual({ paid: 2, short: 1, walkouts: 1 })
  })
})

describe('plan.md §12.9: the profile survives a reload of the same run only', () => {
  it('resumes the stored profile for the same run (Continue), with its accumulators', () => {
    const { r } = run
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as unknown
    const loaded = Sim.load(data, JSON.parse(JSON.stringify(r.sim.snapshot())))
    const again = rig(loaded, stored)
    const before = r.rec.snapshot()
    const after = again.rec.snapshot()
    expect(after.startedAt).toBe(before.startedAt)
    expect(after.elapsedS).toBe(before.elapsedS)
    expect(after.fps).toEqual(before.fps)
    expect(after.taps).toBe(before.taps)
    expect(after.firstMalware).toEqual(before.firstMalware)
    expect(after.deliveries).toEqual(before.deliveries)
    expect(after.viewSwitches).toBe(before.viewSwitches)
    expect(after.warehouseS).toBe(before.warehouseS)
  })

  it('a New game (another seed, or the same seed at tick 0) starts a fresh profile', () => {
    const stored = run.r.rec.persisted()
    expect(sameRun(stored, run.r.sim.state)).toBe(true)
    expect(sameRun(stored, makeSim(7).state)).toBe(false)
    expect(sameRun(stored, makeSim(8).state)).toBe(false)
    expect(sameRun({ ...stored, version: 2 }, run.r.sim.state)).toBe(false)
    expect(sameRun(null, run.r.sim.state)).toBe(false)
    const fresh = rig(makeSim(7), stored)
    expect(fresh.rec.snapshot().elapsedS).toBe(0)
    expect(fresh.rec.snapshot().fps.samples).toBe(0)
  })
})

describe('plan.md §12.9 fun bar from the same object', () => {
  it('reads the seed-7 run: delivery, catch and L2 pass, 15 min not reached', () => {
    const checks = funBar(run.pt, data.economy.pacingTargets)
    expect(checks.map((c) => [c.n, c.state])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'pass'],
      [4, 'fail'],
      [5, 'pass'],
    ])
  })
})
