// plan.md §12.9 / §12.7 task 1, v2 plan-build2 §8.7 task 1: `playtest.json`
// has every field with the right type (version 2, buildStamp, seed,
// startedAt, device {ua, cssW, cssH, dpr, zoom, maxTexture}, elapsedS /
// simS / pausedS, firstDeliveryS, firstMalware {spawnedS, caughtS, by,
// tossedS}, level2AtS … level5AtS, victoryAtS, endlessS, truckBoughtS,
// deliveries {total, onTime, late, byType}, moneyPerMin, lifetimeEarned,
// balanceEnd, malware {spawned, caught, missed, tossedClean, cleared},
// livesLost[] (+ sorter, hub), vehiclesBought[], inspectorsHired,
// machinesBought[], docksBought[], desks, hires[] {role, pips, salary, star,
// atS, cheapest}, fired, adsPosted, sorter {decisions, wrong,
// clearedMalware}, quests {offered, accepted, declined, completed, failed,
// firstCompletedS, byTemplate}, overseas {handedOff, cleared,
// malwareAtClearance}, taps, tapsPerMin, rushTaps, viewSwitches, warehouseS,
// fps {p50, p5, min, samples}, holdBayEvents, holdBayEventsPer10Min, stalls
// {count, totalS}, payroll {paid, short, walkouts}, satisfactionEnd
// {district: value}) — both from a 35-minute recorder run under Node and in
// the committed format example tests/playtest/seed-7.json (written by `vlr
// shots`' 35-minute automated run). The rules: every *S is sim seconds
// except elapsedS / pausedS (wall clock), null = not reached, p5 = the
// slowest 5 %, hidden time is not play time, and a stored profile resumes
// only for the same run (a v1 profile never).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  fpsStats,
  funBar,
  FUN_TARGETS,
  MAX_FRAME_GAP_MS,
  moneyPerMinute,
  PLAYTEST_VERSION,
  PlaytestRecorder,
  questCounts,
  sameRun,
  SUMMARY_OFFER_S,
  summaryOfferDue,
  type Playtest,
  type PlaytestDevice,
  type RecorderDeps,
} from '../../src/metrics/playtest.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import { dataFixture, makeSim } from '../sim/helpers.ts'

const data = dataFixture()
const EXAMPLE = 'tests/playtest/seed-7.json'
/** The automated run's length (plan-build2 §8.7 task 1: 35 minutes). */
const RUN_S = 2100

// ---- the schema ------------------------------------------------------------------

type Kind = 'number' | 'string' | 'boolean' | 'number|null' | 'string|null'
type Shape =
  | Kind
  | { [key: string]: Shape }
  | { array: Shape }
  | { record: Shape }
  | { literal: number }

const LIFE: Shape = {
  parcelId: 'number|null',
  atS: 'number',
  label: 'string',
  strain: 'string|null',
  laneRate: 'number',
  counter: 'string|null',
  clearedByPlayer: 'boolean',
  sorter: 'string|null',
  hub: 'string|null',
}

const HIRE: Shape = {
  role: 'string',
  pips: { record: 'number' },
  salary: 'number',
  star: 'boolean',
  atS: 'number',
  cheapest: 'boolean',
}

const QUEST_COUNTS = {
  offered: 'number',
  accepted: 'number',
  declined: 'number',
  completed: 'number',
  failed: 'number',
} as const satisfies Record<string, Shape>

/** plan.md §12.9 + plan-build2 §8.7 task 1, field by field. */
const SCHEMA: Shape = {
  version: { literal: 2 },
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
  level3AtS: 'number|null',
  level4AtS: 'number|null',
  level5AtS: 'number|null',
  victoryAtS: 'number|null',
  endlessS: 'number|null',
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
  docksBought: { array: { index: 'number', atS: 'number' } },
  desks: 'number',
  hires: { array: HIRE },
  fired: 'number',
  adsPosted: 'number',
  sorter: { decisions: 'number', wrong: 'number', clearedMalware: 'number' },
  quests: {
    ...QUEST_COUNTS,
    firstCompletedS: 'number|null',
    byTemplate: { record: QUEST_COUNTS },
  },
  overseas: {
    handedOff: 'number',
    cleared: 'number',
    malwareAtClearance: 'number',
  },
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
      problems(shape.record as Shape, x, `${path}.${k}`),
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
    if (!(k in want)) out.push(`${path}.${k}: not in plan-build2 §8.7`)
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

interface Tally {
  offered: number
  accepted: number
  declined: number
  completed: number
  failed: number
  firstCompletedTick: number | null
  hiresLogged: number
  handedOff: number
  sorterCalls: number
}

/**
 * The seed-7 competent-policy run the e2e format example also uses (35 min,
 * 5:00-6:00 in the Warehouse), with an independent tally of the quest,
 * hire, hand-off and sorter events next to the recorder.
 */
function policyRun(): { r: Rig; pt: Playtest; tally: Tally } {
  const r = rig(makeSim(7))
  const tally: Tally = {
    offered: 0,
    accepted: 0,
    declined: 0,
    completed: 0,
    failed: 0,
    firstCompletedTick: null,
    hiresLogged: 0,
    handedOff: 0,
    sorterCalls: 0,
  }
  const ev = r.sim.events
  ev.on('quest:offered', () => (tally.offered += 1))
  ev.on('quest:accepted', () => (tally.accepted += 1))
  ev.on('quest:declined', (p) => {
    if (p.reason !== 'withdrawn') tally.declined += 1
  })
  ev.on('quest:completed', () => {
    tally.completed += 1
    tally.firstCompletedTick ??= r.sim.state.tick
  })
  ev.on('quest:failed', () => (tally.failed += 1))
  ev.on('worker:hired', (p) => {
    if (!p.rehire) tally.hiresLogged += 1
  })
  ev.on('parcel:handedOff', () => (tally.handedOff += 1))
  ev.on('sorter:decided', () => (tally.sorterCalls += 1))
  const policy = createPolicy(r.sim, 'competent')
  r.clock.taps = 3
  play(r, 300, policy)
  r.rec.setView('warehouse')
  play(r, 60, policy)
  r.rec.setView('city')
  play(r, RUN_S - 360, policy)
  return { r, pt: r.rec.snapshot(), tally }
}

const run = policyRun()

describe('plan-build2 §8.7 task 1: every playtest.json v2 field, with its type', () => {
  it('a 35-minute seed-7 policy profile matches the schema exactly', () => {
    expect(PLAYTEST_VERSION).toBe(2)
    expect(problems(SCHEMA, run.pt)).toEqual([])
    // JSON-safe (what the card downloads and pm.playtest.v2 stores).
    expect(JSON.parse(JSON.stringify(run.pt))).toEqual(run.pt)
  })

  it(`the committed format example ${EXAMPLE} (vlr shots) matches it too`, () => {
    expect(existsSync(EXAMPLE), `${EXAMPLE} missing: run vlr shots`).toBe(true)
    const ex = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Playtest
    expect(problems(SCHEMA, ex)).toEqual([])
    expect(ex.seed).toBe(7)
    expect(ex.simS).toBeGreaterThanOrEqual(RUN_S)
    expect(ex.fps.samples).toBeGreaterThan(0)
    expect(ex.moneyPerMin.length).toBe(Math.floor(ex.simS / 60))
    // A 35-minute policy run reaches L3 (and its quests, hires and docks).
    expect(ex.level3AtS).not.toBeNull()
    expect(ex.hires.length).toBeGreaterThan(0)
    expect(ex.quests.offered).toBeGreaterThan(0)
  })
})

describe('plan.md §12.9 rules: sim seconds, null = not reached', () => {
  const { r, pt } = run
  const st = r.sim.state.stats

  it('*S fields are sim seconds (ticks ÷ 10) read from the sim', () => {
    expect(pt.simS).toBe(RUN_S)
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

  it('levels 2-5 from stats.levelTick (seed 7 reaches L5 before 35:00); no Victory yet = null', () => {
    expect(r.sim.state.level.level).toBe(5)
    for (const lv of [2, 3, 4, 5] as const) {
      const at = pt[`level${lv}AtS` as const]
      expect(at, `level${lv}AtS`).toBe((st.levelTick[String(lv)] ?? NaN) / 10)
    }
    expect(pt.level2AtS!).toBeLessThan(pt.level3AtS!)
    expect(pt.level3AtS!).toBeLessThan(pt.level4AtS!)
    expect(pt.level4AtS!).toBeLessThan(pt.level5AtS!)
    expect(st.victoryTick).toBeNull()
    expect(pt.victoryAtS).toBeNull()
    expect(pt.endlessS).toBeNull()
    expect(pt.truckBoughtS).toBe((st.truckTick ?? NaN) / 10)
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
      Math.round(((st.holdBayEvents * 600) / RUN_S) * 10) / 10,
    )
  })

  it('moneyPerMin = gross income per in-game minute (sums to lifetime earned at the minute)', () => {
    expect(pt.moneyPerMin).toHaveLength(RUN_S / 60)
    const sum = pt.moneyPerMin.reduce((a, b) => a + b, 0)
    expect(sum).toBe(st.minutes.at(-1)?.earned)
    expect(
      moneyPerMinute([{ earned: 20 }, { earned: 68 }, { earned: 68 }]),
    ).toEqual([20, 48, 0])
  })

  it('purchases, docks, hires, fires, ads and rushes come from the command log', () => {
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
    expect(pt.docksBought).toEqual(
      log
        .filter((e) => e.cmd.kind === 'buyDock')
        .map((e) => ({
          index: (e.cmd as { index: number }).index,
          atS: e.tick / 10,
        })),
    )
    expect(pt.docksBought.map((d) => d.index)).toContain(2)
    expect(pt.inspectorsHired).toBe(
      log.filter((e) => e.cmd.kind === 'hire' && e.cmd.role === 'inspector')
        .length,
    )
    expect(pt.fired).toBe(log.filter((e) => e.cmd.kind === 'fire').length)
    expect(pt.adsPosted).toBe(log.filter((e) => e.cmd.kind === 'postAd').length)
    expect(pt.rushTaps).toBe(log.filter((e) => e.cmd.kind === 'rush').length)
    expect(pt.desks).toBe(
      r.sim.state.lane.nodes.filter((n) => n.fixture?.kind === 'desk').length,
    )
    expect(pt.desks).toBeGreaterThanOrEqual(1)
  })

  it('hires[]: one entry per pick (not re-hires), the salary fixed at hire', () => {
    expect(pt.hires).toHaveLength(run.tally.hiresLogged)
    expect(pt.hires.length).toBe(
      r.sim.commandLog.filter(
        (e) =>
          e.cmd.kind === 'hire' ||
          (e.cmd.kind === 'buyVehicle' && e.cmd.applicantId !== null),
      ).length,
    )
    expect(pt.hires[0]).toMatchObject({ role: 'driver', atS: 0 })
    for (const h of pt.hires) {
      const roles = data.employees.roles
      expect(Object.keys(roles)).toContain(h.role)
      expect(Object.keys(h.pips).toSorted()).toEqual(
        [...roles[h.role as keyof typeof roles].stats].toSorted(),
      )
      expect(h.salary).toBeGreaterThan(0)
    }
  })

  it('quests: the counts and per-template counts agree with the quest events', () => {
    const q = pt.quests
    const t = run.tally
    expect(q.offered).toBe(t.offered)
    expect(q.accepted).toBe(t.accepted)
    expect(q.declined).toBe(t.declined)
    expect(q.completed).toBe(t.completed)
    expect(q.failed).toBe(t.failed)
    expect(q.firstCompletedS).toBe((t.firstCompletedTick ?? NaN) / 10)
    expect(q.offered).toBeGreaterThanOrEqual(4)
    const sum = (k: 'offered' | 'completed' | 'failed'): number =>
      Object.values(q.byTemplate).reduce((a, b) => a + b[k], 0)
    expect(sum('offered')).toBe(q.offered)
    expect(sum('completed')).toBe(q.completed)
    expect(sum('failed')).toBe(q.failed)
    expect(Object.keys(q.byTemplate)).toContain('golden_release')
    expect(questCounts(r.sim.state)).toEqual(q)
  })

  it('overseas: hand-offs (cleared + still clearing), clearances from stats; sorter calls from events', () => {
    expect(pt.overseas.handedOff).toBe(run.tally.handedOff)
    expect(pt.overseas.cleared).toBe(st.cleared)
    expect(pt.overseas.cleared).toBeGreaterThan(0)
    expect(pt.overseas.handedOff).toBeGreaterThanOrEqual(pt.overseas.cleared)
    expect(pt.overseas.malwareAtClearance).toBe(0)
    expect(pt.sorter.decisions).toBe(run.tally.sorterCalls)
  })

  it('satisfactionEnd lists the live local districts (no overseas hub)', () => {
    const want = data.districts
      .filter((d) => d.kind === 'district' && r.sim.state.districts[d.id]?.live)
      .map((d) => d.id)
      .toSorted()
    expect(Object.keys(pt.satisfactionEnd).toSorted()).toEqual(want)
    expect(want).toContain('industrial')
    expect(want).not.toContain('docks')
  })

  it('elapsedS / pausedS are wall seconds; taps / tapsPerMin per wall minute; one fps sample per second', () => {
    expect(pt.elapsedS).toBe(RUN_S)
    expect(pt.pausedS).toBe(0)
    expect(pt.taps).toBe(3)
    expect(pt.tapsPerMin).toBe(Math.round((3 * 60 * 10) / RUN_S) / 10)
    expect(pt.fps).toEqual({ p50: 60, p5: 60, min: 60, samples: RUN_S })
    expect(pt.viewSwitches).toBe(2)
    expect(pt.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(pt.device).toEqual(DEVICE)
  })
})

describe('plan-build2 §8.7 task 1: the v2 event fields', () => {
  it('hires[].cheapest: false when an applicant left in the pool asked less', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    const sal = (pips: Record<string, number | undefined>): number =>
      salaryOf(data, 'driver', pips, 'bike')
    const pool = sim.state.applicants.driver
    const dear = pool.toSorted((a, b) => sal(b.pips) - sal(a.pips))[0]!
    expect(sal(dear.pips)).toBeGreaterThan(
      Math.min(...pool.map((a) => sal(a.pips))),
    )
    expect(
      sim.dispatch({ kind: 'buyVehicle', type: 'bike', applicantId: dear.id })
        .ok,
    ).toBe(true)
    const pool2 = sim.state.applicants.inspector
    const cheap = pool2.toSorted(
      (a, b) =>
        salaryOf(data, 'inspector', a.pips) -
        salaryOf(data, 'inspector', b.pips),
    )[0]!
    expect(
      sim.dispatch({
        kind: 'hire',
        role: 'inspector',
        applicantId: cheap.id,
        target: { nodeId: 'slot1' },
      }).ok,
    ).toBe(true)
    const pt = r.rec.snapshot()
    expect(pt.hires).toEqual([
      {
        role: 'driver',
        pips: dear.pips,
        salary: sal(dear.pips),
        star: false,
        atS: 0,
        cheapest: false,
      },
      {
        role: 'inspector',
        pips: cheap.pips,
        salary: salaryOf(data, 'inspector', cheap.pips),
        star: false,
        atS: 0,
        cheapest: true,
      },
    ])
    expect(pt.inspectorsHired).toBe(1)
  })

  it('fired and adsPosted count the player`s fire / postAd commands', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    expect(sim.dispatch({ kind: 'postAd', role: 'driver' }).ok).toBe(true)
    const start = sim.state.employees[0]!
    expect(sim.dispatch({ kind: 'fire', employeeId: start.id }).ok).toBe(true)
    const pt = r.rec.snapshot()
    expect(pt.adsPosted).toBe(1)
    expect(pt.fired).toBe(1)
    expect(pt.hires).toEqual([])
  })

  it('sorter {decisions, wrong, clearedMalware}: clearedMalware = malware the sorter left as clean', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    play(r, 120)
    const ids = Object.keys(sim.state.parcels).map(Number)
    expect(ids.length).toBeGreaterThan(1)
    const [mal, clean] = ids as [number, number]
    sim.state.parcels[String(mal)]!.malware = true
    sim.state.parcels[String(clean)]!.malware = false
    const call = (
      parcelId: number,
      c: 'toss' | 'leave',
      correct: boolean,
    ): void => {
      sim.events.emit('sorter:decided', {
        parcelId,
        employeeId: 9,
        call: c,
        correct,
        viaWanted: false,
      })
    }
    call(mal, 'leave', false)
    call(clean, 'leave', true)
    call(mal, 'toss', true)
    call(clean, 'toss', false)
    expect(r.rec.snapshot().sorter).toEqual({
      decisions: 4,
      wrong: 2,
      clearedMalware: 1,
    })
  })

  it('an overseas malware costs a life at clearance: hub on the entry, malwareAtClearance', () => {
    const loaded = Sim.load(
      data,
      JSON.parse(JSON.stringify(run.r.sim.snapshot())),
    )
    const r = rig(loaded)
    expect(
      loaded.dispatch({ kind: 'debugOverseasMalware', hub: 'docks' }).ok,
    ).toBe(true)
    const hub = data.districts.find((d) => d.id === 'docks')
    expect(hub?.kind).toBe('overseas')
    play(r, (hub?.kind === 'overseas' ? hub.clearanceS : 45) + 2)
    const pt = r.rec.snapshot()
    expect(pt.overseas.malwareAtClearance).toBe(1)
    const lost = pt.livesLost.find((l) => l.hub !== null)
    expect(lost, JSON.stringify(pt.livesLost)).toBeDefined()
    expect(lost!.hub).toBe('docks')
    expect(lost!.sorter).toBeNull()
  })

  it('victoryAtS from stats.victoryTick; endlessS = sim seconds since it', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    play(r, 10)
    sim.state.stats.victoryTick = 40
    const pt = r.rec.snapshot()
    expect(pt.victoryAtS).toBe(4)
    expect(pt.endlessS).toBe(6)
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

describe('the summary offer (final review, mobile #7)', () => {
  it("waits for 30:00 of game time and for fun bar item 4's 25 real minutes, so opening it when offered passes item 4", () => {
    const at30 = SUMMARY_OFFER_S * 10
    expect(summaryOfferDue(at30 - 1, 2000)).toBe(false)
    // 2x: the game clock at 30:00 after ~17 real minutes — not yet.
    expect(summaryOfferDue(at30, 1020)).toBe(false)
    expect(summaryOfferDue(at30, FUN_TARGETS.keepPlayingS)).toBe(false)
    expect(summaryOfferDue(at30, FUN_TARGETS.keepPlayingS + 0.1)).toBe(true)
    const opened = FUN_TARGETS.keepPlayingS + 0.1
    const pt = { ...rig(makeSim(1)).rec.snapshot() }
    const four = funBar(pt, FUN_TARGETS, opened).find((c) => c.n === 4)!
    expect(four.state).toBe('pass')
  })
})

describe('plan.md §12.9: lives, stalls, payroll and the Hold Bay from sim events', () => {
  it('records each lost life with its label, strain, lane rate, counter, Clear, sorter and hub', () => {
    const sim = makeSim(3)
    const r = rig(sim)
    const res = sim.dispatch({ kind: 'debugMalwareDelivery' })
    expect(res.ok).toBe(true)
    const pt = r.rec.snapshot()
    expect(pt.livesLost).toHaveLength(1)
    expect(problems({ array: LIFE }, pt.livesLost)).toEqual([])
    const l = pt.livesLost[0]!
    expect(l.parcelId).toBe(sim.state.lastLostLife?.parcelId)
    expect(l.atS).toBe(sim.state.tick / 10)
    expect(l.label).toBe(sim.state.lastLostLife?.label)
    expect(l.clearedByPlayer).toBe(false)
    expect(l.sorter).toBeNull()
    expect(l.hub).toBeNull()
    expect(pt.malware.missed).toBe(1)
  })

  it('two parcels with the same label lost on one tick are two lives; the same parcel again (a replay) is one', () => {
    const sim = makeSim(3)
    const r = rig(sim)
    expect(sim.dispatch({ kind: 'debugMalwareDelivery' }).ok).toBe(true)
    const first = sim.state.lastLostLife!
    const ev = (parcelId: number) => ({
      parcelId,
      label: first.label,
      strain: first.strain,
      destBuildingId: first.destBuildingId,
      path: first.path,
      laneRate: first.laneRate,
      counterMachineId: first.counterMachineId,
      counterOwned: first.counterOwned,
      counterRate: first.counterRate,
      clearedByPlayerAt: first.clearedByPlayerAt,
      missedBy: first.missedBy,
      inspectorRate: first.inspectorRate,
      sorterCall: first.sorterCall,
      report: { ...first, parcelId },
    })
    // Same tick, same label, another parcel (findings: colors@2.0.0-rc ×2).
    sim.events.emit('life:lost', ev(first.parcelId + 1000))
    // The first parcel's loss replayed (a reload just before it).
    sim.events.emit('life:lost', ev(first.parcelId))
    const lost = r.rec.snapshot().livesLost
    expect(lost.map((l) => l.parcelId)).toEqual([
      first.parcelId,
      first.parcelId + 1000,
    ])
    expect(lost.every((l) => l.label === first.label)).toBe(true)
  })

  it('a restored record without parcelId (an older profile) still dedupes a replay by time + label', () => {
    const sim = makeSim(3)
    const r = rig(sim)
    expect(sim.dispatch({ kind: 'debugMalwareDelivery' }).ok).toBe(true)
    const first = sim.state.lastLostLife!
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as {
      restore: { livesLost: Record<string, unknown>[] }
    }
    delete stored.restore.livesLost[0]!.parcelId
    const again = rig(sim, stored)
    expect(again.rec.snapshot().livesLost[0]!.parcelId).toBeNull()
    sim.events.emit('life:lost', {
      parcelId: first.parcelId,
      label: first.label,
      strain: first.strain,
      destBuildingId: first.destBuildingId,
      path: first.path,
      laneRate: first.laneRate,
      counterMachineId: first.counterMachineId,
      counterOwned: first.counterOwned,
      counterRate: first.counterRate,
      clearedByPlayerAt: first.clearedByPlayerAt,
      missedBy: first.missedBy,
      inspectorRate: first.inspectorRate,
      sorterCall: first.sorterCall,
      report: first,
    })
    expect(again.rec.snapshot().livesLost).toHaveLength(1)
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
    expect(after.hires).toEqual(before.hires)
    expect(after.sorter).toEqual(before.sorter)
    expect(after.quests).toEqual(before.quests)
    expect(after.overseas).toEqual(before.overseas)
    expect(after.docksBought).toEqual(before.docksBought)
  })

  it('a New game (another seed, or the same seed at tick 0) or a v1 profile starts a fresh profile', () => {
    const stored = run.r.rec.persisted()
    expect(sameRun(stored, run.r.sim.state)).toBe(true)
    expect(sameRun(stored, makeSim(7).state)).toBe(false)
    expect(sameRun(stored, makeSim(8).state)).toBe(false)
    expect(sameRun({ ...stored, version: 1 }, run.r.sim.state)).toBe(false)
    expect(sameRun(null, run.r.sim.state)).toBe(false)
    const fresh = rig(makeSim(7), stored)
    expect(fresh.rec.snapshot().elapsedS).toBe(0)
    expect(fresh.rec.snapshot().fps.samples).toBe(0)
    expect(fresh.rec.snapshot().hires).toEqual([])
  })
})

describe('plan-build2 §9 fun bar 2 from the same object', () => {
  it('reads the seed-7 run: quest by 15:00, L3 in 15-22, 25 min played, no life lost, L5 by 40:00', () => {
    const checks = funBar(run.pt, FUN_TARGETS)
    const choice = run.pt.hires.some((h) => !h.cheapest)
    expect(checks.map((c) => [c.n, c.state])).toEqual([
      [1, choice ? 'judge' : 'fail'],
      [2, 'pass'],
      [3, 'pass'],
      [4, 'pass'],
      [5, 'pass'],
      [6, 'pass'],
    ])
    expect(checks[5]?.detail).toBe(
      `Lv 5 ${Math.floor(run.pt.level5AtS! / 60)}:${String(Math.floor(run.pt.level5AtS! % 60)).padStart(2, '0')}`,
    )
  })

  it('the summary offer moved to 30:00', () => {
    expect(SUMMARY_OFFER_S).toBe(1800)
  })
})
