// plan.md §12.9 / §12.7 task 1, v2 plan-build2 §8.7 task 1, v3 plan-build3
// §8.6 task 1 / spec-build3 §6 (the M15 metrics contract §1.7):
// `playtest.json` has every field with the right type (version 3, buildStamp, seed,
// startedAt, device {ua, cssW, cssH, dpr, zoom, maxTexture}, elapsedS /
// simS / pausedS, firstDeliveryS, firstMalware {spawnedS, caughtS, by,
// tossedS}, level2AtS … level5AtS, victoryAtS, endlessS, truckBoughtS,
// deliveries {total, onTime, late, byType}, moneyPerMin, lifetimeEarned,
// balanceEnd, malware {spawned, caught, missed, tossedClean, cleared},
// livesLost[] (+ sorter, hub; v3 cause, eventId, option, livesLeft),
// vehiclesBought[], inspectorsHired,
// machinesBought[], docksBought[], desks, hires[] {role, pips, salary, star,
// atS, cheapest}, fired, adsPosted, sorter {decisions, wrong,
// clearedMalware}, quests {offered, accepted, declined, completed, failed,
// firstCompletedS, byTemplate}, overseas {handedOff, cleared,
// malwareAtClearance}, taps, tapsPerMin, rushTaps, viewSwitches, warehouseS,
// fps {p50, p5, min, samples}, holdBayEvents, holdBayEventsPer10Min, stalls
// {count, totalS}, payroll {paid, short, walkouts}, satisfactionEnd
// {district: value}; v3 events {offered, decided, byCategory, choices[] {id,
// kind, title, option, label, default, atS, thinkS, chain {head, title,
// depth, end} | null}, thinkMedianS, chainsStarted, chainsFinished,
// chainsRunning, livesLost, livesGained, vehiclesLost, workersLost, gameOverByEvent,
// modifiersPeak} and beats[] {atS, kind}) — both from a 35-minute recorder
// run under Node (the deck on, the policy answering every card) and in the
// committed format example tests/playtest/seed-7.json (written by `vlr
// shots`' 35-minute automated run). The rules: every *S is sim seconds
// except elapsedS / pausedS / thinkS / thinkMedianS (wall clock), null = not
// reached, p5 = the slowest 5 %, hidden time is not play time, a card's think
// time is the time the EventCard showed it (D-M15-5), and a stored profile
// resumes only for the same run (a v2 or v1 profile never).
//
// Card ids are picked by shape from the shipped deck (the first plain
// two-option card, a 3+-card chain head, a pair head, a card whose option
// takes a life — patched to −2), never hard-coded: M13 rewrote the deck and
// the pacing passes move it. Fun bar 3 states on the policy run are asserted
// as sets: M14 moves the level times.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EventDef } from '../../src/data/types.ts'
import type {
  LifeLostEventPayload,
  SimEventPayloads,
} from '../../src/sim/events.ts'
import {
  BEATS_MAX,
  CHOICES_MAX,
  fpsStats,
  funBar,
  FUN_TARGETS,
  lifeExplained,
  longestQuiet,
  MAX_FRAME_GAP_MS,
  moneyPerMinute,
  PLAYTEST_VERSION,
  PlaytestRecorder,
  questCounts,
  rampWindow,
  sameRun,
  storiesOf,
  SUMMARY_OFFER_S,
  summaryOfferDue,
  thinkMedian,
  type FunState,
  type Playtest,
  type PlaytestChoice,
  type PlaytestDevice,
  type RecorderDeps,
} from '../../src/metrics/playtest.ts'
import { createPolicy } from '../../src/sim/policy.ts'
import { Sim } from '../../src/sim/sim.ts'
import {
  cardOptions,
  cardTitle,
  chainsRunning,
} from '../../src/sim/systems/deck.ts'
import { salaryOf } from '../../src/sim/systems/people.ts'
import { ticksFromS } from '../../src/sim/types.ts'
import {
  dataFixture,
  decideOpen,
  deckOn,
  fund,
  makeSim,
  parcelLoss,
  quiet,
  runUntil,
} from '../sim/helpers.ts'

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
  | { orNull: Shape }

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
  cause: 'string',
  eventId: 'string|null',
  option: 'string|null',
  livesLeft: 'number|null',
}

/** v3 (B3 §6, D-M15-7): one answered card. */
const CHOICE: Shape = {
  id: 'string',
  kind: 'string',
  title: 'string',
  option: 'number',
  label: 'string',
  default: 'boolean',
  atS: 'number',
  thinkS: 'number',
  chain: {
    orNull: {
      head: 'string',
      title: 'string',
      depth: 'number',
      end: 'boolean',
    },
  },
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

/** plan.md §12.9 + plan-build2 §8.7 task 1 + B3 §6 / plan-build3 §8.6, field by field. */
const SCHEMA: Shape = {
  version: { literal: 3 },
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
  events: {
    offered: 'number',
    decided: 'number',
    byCategory: { record: 'number' },
    choices: { array: CHOICE },
    thinkMedianS: 'number|null',
    chainsStarted: 'number',
    chainsFinished: 'number',
    chainsRunning: 'number',
    livesLost: 'number',
    livesGained: 'number',
    vehiclesLost: 'number',
    workersLost: 'number',
    gameOverByEvent: 'number',
    modifiersPeak: 'number',
  },
  beats: { array: { atS: 'number', kind: 'string' } },
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
  if ('orNull' in shape && Object.keys(shape).length === 1)
    return v === null ? [] : problems(shape.orNull as Shape, v, path)
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
    if (!(k in want)) out.push(`${path}.${k}: not in B3 §6 / plan-build3 §8.6`)
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
  /** event:decided of kind 'decision', and those off the default (gate report.ts' tally). */
  decisions: number
  nonDefault: number
}

/**
 * The seed-7 competent-policy run the e2e format example also uses (35 min,
 * 5:00-6:00 in the Warehouse), with an independent tally of the quest,
 * hire, hand-off and sorter events next to the recorder.
 */
function policyRun(): { r: Rig; pt: Playtest; tally: Tally } {
  // Build 3 (B3 §3.2): jobs come as cards from the deck's draws, so this
  // policy run keeps the deck on (makeSim turns it off, D-8); the policy
  // answers every card on its step.
  const r = rig(deckOn(makeSim(7)))
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
    decisions: 0,
    nonDefault: 0,
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
  ev.on('event:decided', (p) => {
    if (p.kind !== 'decision') return
    tally.decisions += 1
    if (!p.default) tally.nonDefault += 1
  })
  const policy = createPolicy(r.sim, 'competent')
  r.clock.taps = 3
  play(r, 300, policy)
  r.rec.setView('warehouse')
  play(r, 60, policy)
  r.rec.setView('city')
  play(r, RUN_S - 360, policy)
  return { r, pt: r.rec.snapshot(), tally }
}

// The playtest-3 profile (M15): decisions on (the default since M12), the
// policy answering every card on its step — choices, chains and beats.
const run = policyRun()

describe('plan-build3 §8.6 task 1: every playtest.json v3 field, with its type', () => {
  it('a 35-minute seed-7 policy profile matches the schema exactly', () => {
    expect(PLAYTEST_VERSION).toBe(3)
    expect(problems(SCHEMA, run.pt)).toEqual([])
    // JSON-safe (what the card downloads and pm.playtest.v3 stores).
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
    // v3: the cards and the beats, recorded from tick 0.
    expect(ex.events.offered).toBeGreaterThan(0)
    expect(ex.events.choices).toHaveLength(ex.events.decided)
    expect(ex.beats.length).toBeGreaterThan(0)
    for (const b of ex.beats) expect(b.atS).toBeLessThanOrEqual(ex.simS)
  })
})

describe('B3 §6: the v3 cards and beats of the seed-7 policy run', () => {
  const { r, pt } = run
  const es = r.sim.state.events.stats

  it('events.* counters are state.events.stats (jobs included); a choice per decided card', () => {
    expect(pt.events).toMatchObject({
      offered: es.offered,
      decided: es.decided,
      byCategory: es.byCategory,
      chainsStarted: es.chainsStarted,
      chainsFinished: es.chainsFinished,
      chainsRunning: chainsRunning(r.sim.state.events),
      livesLost: es.livesLost,
      livesGained: es.livesGained,
      vehiclesLost: es.vehiclesLost,
      workersLost: es.workersLost,
      modifiersPeak: es.modifiersPeak,
    })
    expect(pt.events.offered).toBeGreaterThan(0)
    expect(es.decided).toBeLessThanOrEqual(CHOICES_MAX)
    expect(pt.events.choices).toHaveLength(es.decided)
    const kinds = new Set(pt.events.choices.map((c) => c.kind))
    expect(kinds.has('decision')).toBe(true)
    expect(kinds.has('job')).toBe(true)
    // The choice's atS is the card's decision tick, in step with the history.
    const decided = r.sim.state.events.history.filter(
      (h) => h.outcome === 'decided',
    )
    const tail = pt.events.choices.slice(-decided.length)
    expect(tail.map((c) => [c.id, c.option, c.default, c.atS])).toEqual(
      decided.map((h) => [h.eventId, h.option, h.default, h.closedTick / 10]),
    )
  })

  it('a policy decides each card in the step that opens it: every thinkS 0, thinkMedianS 0 (D-M15-6)', () => {
    expect(pt.events.choices.every((c) => c.thinkS === 0)).toBe(true)
    expect(pt.events.thinkMedianS).toBe(0)
    // The held-card paused time (D-M15-5) never accrues under a policy.
    expect(pt.pausedS).toBe(0)
  })

  it('chains: one chain.end per finished chain; a link carries its head and depth', () => {
    const ends = pt.events.choices.filter((c) => c.chain?.end)
    expect(ends).toHaveLength(es.chainsFinished)
    expect(storiesOf(pt.events.choices)).toHaveLength(es.chainsFinished)
    for (const c of pt.events.choices) {
      if (c.kind !== 'decision' || c.chain === null) continue
      expect(c.chain.depth).toBeGreaterThanOrEqual(1)
      expect(data.events.deck.some((e) => e.id === c.chain!.head)).toBe(true)
      if (c.chain.end) expect(c.chain.depth).toBeGreaterThanOrEqual(2)
    }
    expect(
      pt.events.choices.filter((c) => c.kind === 'job' && c.chain !== null),
    ).toEqual([])
  })

  it('beats: sorted by sim time, one hold beat per Hold Bay parcel, a level beat per level-up, a card beat per offer', () => {
    const at = pt.beats.map((b) => b.atS)
    expect(at).toEqual(at.toSorted((a, b) => a - b))
    expect(pt.beats.length).toBeLessThanOrEqual(BEATS_MAX)
    const count = (k: string): number =>
      pt.beats.filter((b) => b.kind === k).length
    if (pt.beats.length < BEATS_MAX) {
      expect(count('hold')).toBe(pt.holdBayEvents)
      expect(count('level')).toBe(r.sim.state.level.level - 1)
      expect(count('decision') + count('news') + count('job')).toBe(es.offered)
    }
  })

  it('Q-B3-8: the non-default decisions are the ones the gate`s policyNonDefaultShare row counts', () => {
    const d = pt.events.choices.filter((c) => c.kind === 'decision')
    expect(d.length).toBe(run.tally.decisions)
    expect(d.filter((c) => !c.default).length).toBe(run.tally.nonDefault)
    // The row's floor (policy.nonDefaultShareMin) is a median over the gate's
    // ten seeds; one 35-minute seed only has to answer some cards off the
    // default (seed 7 at 3b8bc50: 0.375).
    expect(run.tally.nonDefault).toBeGreaterThan(0)
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
  it("waits for 30:00 of game time and for fun bar item 5's 25 real minutes, so opening it when offered passes item 5", () => {
    const at30 = SUMMARY_OFFER_S * 10
    expect(summaryOfferDue(at30 - 1, 2000)).toBe(false)
    // 2x: the game clock at 30:00 after ~17 real minutes — not yet.
    expect(summaryOfferDue(at30, 1020)).toBe(false)
    expect(summaryOfferDue(at30, FUN_TARGETS.keepPlayingS)).toBe(false)
    expect(summaryOfferDue(at30, FUN_TARGETS.keepPlayingS + 0.1)).toBe(true)
    const opened = FUN_TARGETS.keepPlayingS + 0.1
    const pt = { ...rig(makeSim(1)).rec.snapshot() }
    const five = funBar(pt, FUN_TARGETS, opened).find((c) => c.n === 5)!
    expect(five.state).toBe('pass')
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
    expect(l.parcelId).toBe(parcelLoss(sim)?.parcelId)
    expect(l.atS).toBe(sim.state.tick / 10)
    expect(l.label).toBe(parcelLoss(sim)?.label)
    expect(l.clearedByPlayer).toBe(false)
    expect(l.sorter).toBeNull()
    expect(l.hub).toBeNull()
    expect(l).toMatchObject({
      cause: 'malware',
      eventId: null,
      option: null,
      livesLeft: sim.state.economy.lives,
    })
    expect(pt.malware.missed).toBe(1)
  })

  it('two parcels with the same label lost on one tick are two lives; the same parcel again (a replay) is one', () => {
    const sim = makeSim(3)
    const r = rig(sim)
    expect(sim.dispatch({ kind: 'debugMalwareDelivery' }).ok).toBe(true)
    const first = parcelLoss(sim)!
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
    const first = parcelLoss(sim)!
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
    expect(after.events).toEqual(before.events)
    expect(after.beats).toEqual(before.beats)
    expect(after.livesLost).toEqual(before.livesLost)
  })

  it('a New game (another seed, or the same seed at tick 0) or a v2 / v1 profile starts a fresh profile', () => {
    const stored = run.r.rec.persisted()
    expect(sameRun(stored, run.r.sim.state)).toBe(true)
    expect(sameRun(stored, makeSim(7).state)).toBe(false)
    expect(sameRun(stored, makeSim(8).state)).toBe(false)
    expect(sameRun({ ...stored, version: 2 }, run.r.sim.state)).toBe(false)
    expect(sameRun({ ...stored, version: 1 }, run.r.sim.state)).toBe(false)
    expect(sameRun(null, run.r.sim.state)).toBe(false)
    const fresh = rig(makeSim(7), stored)
    expect(fresh.rec.snapshot().elapsedS).toBe(0)
    expect(fresh.rec.snapshot().fps.samples).toBe(0)
    expect(fresh.rec.snapshot().hires).toEqual([])
    expect(fresh.rec.snapshot().events.choices).toEqual([])
    expect(fresh.rec.snapshot().beats).toEqual([])
  })
})

const funStates = (pt: Playtest): FunState[] => funBar(pt).map((c) => c.state)

describe('plan-build3 §9 fun bar 3 from the same object', () => {
  it('reads the seed-7 policy run: seven items, each in the states its data allows', () => {
    const checks = funBar(run.pt, FUN_TARGETS)
    expect(checks.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const [one, two, three, four, five, six, seven] = funStates(run.pt)
    // Judged items read `judge` once the data holds; M14 moves the level
    // times, so the data items are sets, not exact values.
    expect(['judge', 'fail']).toContain(one)
    expect(['pass', 'fail', 'judge']).toContain(two)
    expect(['pass', 'fail']).toContain(three)
    expect(['judge', 'fail']).toContain(four)
    expect(five).toBe('pass')
    expect(six).toBe('pass') // every lost life explained (a data pass, D-M15-8)
    // A 35:00 run ends before the 36:00 stretch bound: pass or still open.
    expect(['pass', 'pending']).toContain(seven)
    // Item 1 from the independent tally; the policy's think median is 0 s,
    // so item 2 never reads `judge` (D-M15-8: the soft half).
    expect(one).toBe(
      run.tally.nonDefault >= FUN_TARGETS.nonDefault ? 'judge' : 'fail',
    )
    expect(two).not.toBe('judge')
    expect(checks[1]?.detail).toMatch(/^gap \d+:\d\d · think 0 s$/)
  })

  it('the summary offer moved to 30:00', () => {
    expect(SUMMARY_OFFER_S).toBe(1800)
  })
})

// ---- v3: the cards, card by card (contract §1.7 blocks 1–5) ------------------------

const deck = data.events.deck
const deckById = new Map(deck.map((e) => [e.id, e]))

/** Cards in the longest run of plain (non-router) `next` links from `id`, itself included. */
function plainDepth(id: string, seen: ReadonlySet<string> = new Set()): number {
  const e = deckById.get(id)
  if (!e || e.router || seen.has(id)) return 0
  const next = new Set(seen).add(id)
  let best = 0
  for (const o of e.options ?? [])
    for (const x of o.effects)
      if (x.kind === 'next' && 'eventId' in x)
        best = Math.max(best, plainDepth(x.eventId, next))
  return 1 + best
}

/** The first drawable head whose plain chain is exactly / at least `n` cards. */
function chainHead(n: number, exact: boolean): EventDef {
  const h = deck.find(
    (e) =>
      e.drawable !== false &&
      !e.router &&
      (exact ? plainDepth(e.id) === n : plainDepth(e.id) >= n),
  )
  if (!h) throw new Error(`no ${exact ? '' : '≥ '}${n}-card chain head`)
  return h
}

/** Option `i` of `e` books a link. */
const books = (e: EventDef, i: number): boolean =>
  e.options![i]!.effects.some((x) => x.kind === 'next')

/** Hold beats at these sim seconds. */
const beatsAt = (...at: number[]) =>
  at.map((atS) => ({ atS, kind: 'hold' as const }))

/** A hand-made choice (helpers and caps). */
const choice = (
  kind: PlaytestChoice['kind'],
  thinkS: number,
  id = 'ev_x',
): PlaytestChoice => ({
  id,
  kind,
  title: 'X',
  option: 0,
  label: 'OK',
  default: true,
  atS: 0,
  thinkS,
  chain: null,
})

/** The first plain card: two or more options, no cond, no option `if`. */
const PLAIN = deck.find(
  (e) =>
    !e.router &&
    e.cond === undefined &&
    (e.options?.length ?? 0) >= 2 &&
    e.options!.every((o) => o.if === undefined),
)!

/** A sim past the deck's opening quiet (links open, debug offers land), deck draws off. */
function cardSim(overrides?: unknown): Sim {
  const sim = quiet(fund(makeSim(7, overrides)))
  const at = ticksFromS(sim.data.events.schedule.firstEventS) + 10
  runUntil(sim, () => sim.state.tick >= at)
  return sim
}

function offer(sim: Sim, id: string): void {
  const res = sim.dispatch({ kind: 'debugOfferEvent', eventId: id })
  if (!res.ok) throw new Error(`offer ${id}: ${res.reason}`)
}

/** Answer the open card off its default (the first visible, affordable non-default option). */
function answerOff(sim: Sim): number {
  const open = sim.state.events.open!
  const o = cardOptions(sim, open).find(
    (x) => x.visible && x.affordable && !x.default,
  )!
  decideOpen(sim, o.index)
  return o.index
}

/** `s` wall seconds of frames, one per second, nothing ticking (the card holds the sim). */
function wait(r: Rig, s: number): void {
  for (let i = 0; i < s; i++) {
    r.clock.ms += 1000
    r.rec.update()
  }
}

/** The HUD's EventCard (D-M15-5): shows the sim's open card while `up`. */
function shownCard(sim: () => Sim): {
  up: boolean
  dep: NonNullable<RecorderDeps['cardShown']>
} {
  const s = {
    up: true,
    dep: () => {
      const o = sim().state.events.open
      return s.up && o !== null
        ? { eventId: o.eventId, openedTick: o.openedTick }
        : null
    },
  }
  return s
}

describe('B3 §6 think time (D-M15-5): the wall time the EventCard showed the card', () => {
  it('12 s on screen, answered off the default → thinkS 12, default false, kind and title from the card', () => {
    const sim = cardSim()
    const card = shownCard(() => sim)
    const r = rig(sim, null, { cardShown: card.dep })
    offer(sim, PLAIN.id)
    const open = sim.state.events.open!
    wait(r, 12)
    const option = answerOff(sim)
    const pt = r.rec.snapshot()
    expect(pt.events.choices).toHaveLength(1)
    const c = pt.events.choices[0]!
    expect(problems(CHOICE, c)).toEqual([])
    expect(c).toMatchObject({
      id: PLAIN.id,
      kind: open.kind,
      option,
      default: false,
      atS: sim.state.tick / 10,
      thinkS: 12,
      chain: null,
    })
    expect(c.title).toBe(cardTitle(data, open))
    expect(c.label).toBe(sim.state.events.history.at(-1)!.label)
    expect(pt.events.thinkMedianS).toBe(12)
    // The offer's beat, at the offer's sim second.
    expect(pt.beats).toEqual([{ atS: open.openedTick / 10, kind: open.kind }])
  })

  it('waiting behind a sheet or a paper is not thinking: 5 s hidden, 3 s shown → 3', () => {
    const sim = cardSim()
    const card = shownCard(() => sim)
    const r = rig(sim, null, { cardShown: card.dep })
    offer(sim, PLAIN.id)
    card.up = false
    wait(r, 5)
    card.up = true
    wait(r, 3)
    answerOff(sim)
    expect(r.rec.snapshot().events.choices[0]?.thinkS).toBe(3)
  })

  it('another card on screen, or a throwing dep, does not count', () => {
    const sim = cardSim()
    let other = true
    const r = rig(sim, null, {
      cardShown: () => {
        const o = sim.state.events.open!
        if (other)
          return { eventId: 'ev_not_this_one', openedTick: o.openedTick }
        throw new Error('scene gone')
      },
    })
    offer(sim, PLAIN.id)
    wait(r, 4)
    other = false
    wait(r, 4)
    answerOff(sim)
    expect(r.rec.snapshot().events.choices[0]?.thinkS).toBe(0)
  })

  it('a 5-s frame gap counts MAX_FRAME_GAP_MS; a hidden tab counts nothing', () => {
    const sim = cardSim()
    const card = shownCard(() => sim)
    const r = rig(sim, null, { cardShown: card.dep })
    offer(sim, PLAIN.id)
    r.clock.ms += 5000
    r.rec.update()
    r.rec.hidden()
    r.clock.ms += 600_000
    r.rec.update()
    r.clock.ms += 500
    r.rec.update()
    answerOff(sim)
    expect(r.rec.snapshot().events.choices[0]?.thinkS).toBe(
      MAX_FRAME_GAP_MS / 1000 + 0.5,
    )
  })

  it('without a cardShown dep the clock runs while the sim holds itself; a policy never holds', () => {
    const sim = cardSim()
    const r = rig(sim)
    offer(sim, PLAIN.id)
    expect(sim.held).toBe(true)
    wait(r, 4)
    const detach = sim.attachPolicy()
    expect(sim.held).toBe(false)
    wait(r, 5)
    detach()
    answerOff(sim)
    expect(r.rec.snapshot().events.choices[0]?.thinkS).toBe(4)
  })

  it('pausedS counts the held card through the HUD`s isPaused (Sim.held, D-M15-5)', () => {
    const sim = cardSim()
    const r = rig(sim, null, { isPaused: () => sim.held })
    offer(sim, PLAIN.id)
    wait(r, 6)
    answerOff(sim)
    wait(r, 2)
    expect(r.rec.snapshot().pausedS).toBe(6)
  })
})

describe('B3 §6 think time across a reload (the restore record keeps the card)', () => {
  it('4 s, persisted, JSON, a new recorder on the loaded sim, 3 s more → thinkS 7', () => {
    const sim = cardSim()
    const r = rig(sim, null, { cardShown: shownCard(() => sim).dep })
    offer(sim, PLAIN.id)
    wait(r, 4)
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as {
      restore: { card: unknown }
    }
    expect(stored.restore.card).toMatchObject({
      eventId: PLAIN.id,
      thinkMs: 4000,
    })
    const loaded = Sim.load(data, JSON.parse(JSON.stringify(sim.snapshot())))
    const again = rig(loaded, stored, {
      cardShown: shownCard(() => loaded).dep,
    })
    wait(again, 3)
    answerOff(loaded)
    const pt = again.rec.snapshot()
    expect(pt.events.choices.map((c) => c.thinkS)).toEqual([7])
    // The offer's beat came with the profile; the reload added none.
    expect(pt.beats).toHaveLength(1)
  })

  it('a stored card that is no longer the open one is dropped; the open card is timed from 0, with no beat', () => {
    const sim = cardSim()
    const r = rig(sim, null, { cardShown: shownCard(() => sim).dep })
    offer(sim, PLAIN.id)
    wait(r, 4)
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as unknown
    answerOff(sim)
    runUntil(sim, () => false, 30) // 3 s on: the next offer opens on another tick
    offer(sim, PLAIN.id)
    r.rec.detach()
    const again = rig(sim, stored, { cardShown: shownCard(() => sim).dep })
    wait(again, 2)
    answerOff(sim)
    const pt = again.rec.snapshot()
    // The first answer came after the profile was stored, and the second
    // card's offer before the attach: one choice, 2 s, the stored beat only.
    expect(pt.events.choices.map((c) => c.thinkS)).toEqual([2])
    expect(pt.beats).toHaveLength(1)
    expect(pt.events.decided).toBe(2) // the counters are the sim's
  })

  it('a fresh profile attached on an open card times it from 0 and adds no beat', () => {
    const sim = cardSim()
    offer(sim, PLAIN.id)
    const r = rig(sim, null, { cardShown: shownCard(() => sim).dep })
    wait(r, 3)
    answerOff(sim)
    const pt = r.rec.snapshot()
    expect(pt.events.choices.map((c) => c.thinkS)).toEqual([3])
    expect(pt.beats).toEqual([])
    expect(pt.events.offered).toBe(1)
  })

  it('a resumed profile ahead of its save drops what the sim will replay (the open card answered again is one choice)', () => {
    const sim = cardSim()
    offer(sim, PLAIN.id)
    const save = JSON.parse(JSON.stringify(sim.snapshot())) as unknown
    const r = rig(sim)
    answerOff(sim)
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as unknown
    expect(r.rec.snapshot().events.choices).toHaveLength(1)
    // The save was written with the card still open; the profile after.
    const loaded = Sim.load(data, save)
    const again = rig(loaded, stored)
    expect(again.rec.snapshot().events.choices).toEqual([])
    answerOff(loaded)
    expect(again.rec.snapshot().events.choices).toHaveLength(1)
  })
})

/** Play the open chain through: each card's deepest plain next, then an ending answer. */
function playChain(sim: Sim, onLink?: () => void): void {
  for (let guard = 0; guard < 10; guard++) {
    const open = sim.state.events.open!
    const def = deckById.get(open.eventId)!
    const score = (i: number): number => {
      const n = def.options?.[i]?.effects.find((x) => x.kind === 'next')
      if (n === undefined) return 0
      return 'eventId' in n ? plainDepth(n.eventId) : -1
    }
    const o = cardOptions(sim, open)
      .filter((x) => x.visible && x.affordable)
      .toSorted((a, b) => score(b.index) - score(a.index))[0]!
    decideOpen(sim, o.index)
    if (sim.state.events.scheduled.length === 0) return
    onLink?.()
    runUntil(
      sim,
      () =>
        sim.state.events.open !== null ||
        sim.state.events.scheduled.length === 0,
      30_000,
    )
    if (sim.state.events.open === null) return
  }
}

describe('B3 §6 chains: choices[].chain {head, title, depth, end}; fun bar 4 (D-M15-4)', () => {
  it('a 3+-card story: depth 1..N under one head and title, only the closing card ends it → item 4 judge', () => {
    const head = chainHead(3, false)
    const sim = cardSim()
    const r = rig(sim)
    offer(sim, head.id)
    const under: string[] = []
    playChain(sim, () => {
      const four = funBar(r.rec.snapshot()).find((c) => c.n === 4)!
      under.push(`${four.state} ${four.detail}`)
    })
    const pt = r.rec.snapshot()
    const ch = pt.events.choices.map((c) => c.chain)
    expect(ch.length).toBeGreaterThanOrEqual(3)
    expect(ch.map((c) => c?.depth)).toEqual(ch.map((_, i) => i + 1))
    expect(ch.map((c) => c?.end)).toEqual(ch.map((_, i) => i === ch.length - 1))
    expect(new Set(ch.map((c) => c?.head))).toEqual(new Set([head.id]))
    expect(new Set(ch.map((c) => c?.title))).toEqual(
      new Set([pt.events.choices[0]!.title]),
    )
    expect(pt.events.chainsStarted).toBe(1)
    expect(pt.events.chainsFinished).toBe(1)
    expect(storiesOf(pt.events.choices)).toEqual([ch.at(-1)])
    // While a link was booked the story was under way.
    expect(under[0]).toBe('pending 1 under way')
    const four = funBar(pt).find((c) => c.n === 4)!
    expect(four.state).toBe('judge')
    expect(four.detail).toBe('1 of 3+ · you judge')
  })

  it('a 2-card pair finishes a chain but is no story: item 4 fail, pairs only', () => {
    const head = chainHead(2, true)
    const sim = cardSim()
    const r = rig(sim)
    offer(sim, head.id)
    playChain(sim)
    const pt = r.rec.snapshot()
    expect(
      pt.events.choices.map((c) => [c.chain?.depth, c.chain?.end]),
    ).toEqual([
      [1, false],
      [2, true],
    ])
    expect(pt.events.chainsFinished).toBe(1)
    const four = funBar(pt).find((c) => c.n === 4)!
    expect([four.state, four.detail]).toEqual(['fail', 'pairs only'])
  })

  it('a head answered without a next has chain null (and starts no chain)', () => {
    const head = deck.find(
      (e) =>
        e.drawable !== false &&
        !e.router &&
        plainDepth(e.id) >= 2 &&
        e.options!.some((o, i) => o.if === undefined && !books(e, i)),
    )!
    const sim = cardSim()
    const r = rig(sim)
    offer(sim, head.id)
    const stop = cardOptions(sim, sim.state.events.open!).find(
      (o) => o.visible && o.affordable && !books(head, o.index),
    )!
    decideOpen(sim, stop.index)
    const pt = r.rec.snapshot()
    expect(pt.events.choices.map((c) => c.chain)).toEqual([null])
    expect(pt.events.chainsStarted).toBe(0)
  })
})

describe('B3 §3.5 / §6: lives an event option took', () => {
  // The first card with an option that takes a life, patched to −2.
  const li = deck.findIndex((e) =>
    e.options?.some((o) =>
      o.effects.some((x) => x.kind === 'lives' && x.delta < 0),
    ),
  )
  const oi = deck[li]!.options!.findIndex((o) =>
    o.effects.some((x) => x.kind === 'lives' && x.delta < 0),
  )
  const ei = deck[li]!.options![oi]!.effects.findIndex(
    (x) => x.kind === 'lives' && x.delta < 0,
  )
  const patch: unknown[] = []
  const effects: unknown[] = []
  effects[ei] = { delta: -2 }
  const options: unknown[] = []
  options[oi] = { effects }
  patch[li] = { options }
  const card = deck[li]!

  function minus2(lives: number): {
    sim: Sim
    r: Rig
    emitted: LifeLostEventPayload[]
  } {
    const sim = cardSim({ events: { deck: patch } })
    sim.state.economy.lives = lives
    const r = rig(sim)
    const emitted: LifeLostEventPayload[] = []
    const listen = (p: SimEventPayloads['life:lost']): void => {
      if (p.cause === 'event') emitted.push(structuredClone(p))
    }
    sim.events.on('life:lost', listen)
    offer(sim, card.id)
    const open = sim.state.events.open!
    const opt = cardOptions(sim, open)[oi]!
    expect(opt.visible && opt.affordable).toBe(true)
    decideOpen(sim, oi)
    sim.events.off('life:lost', listen)
    return { sim, r, emitted }
  }

  it('a lives −2 option: two entries (cause event, one atS and eventId, livesLeft n−1 and n−2), both explained', () => {
    const { sim, r, emitted } = minus2(3)
    const pt = r.rec.snapshot()
    expect(problems({ array: LIFE }, pt.livesLost)).toEqual([])
    const label = sim.state.events.history.at(-1)!.label
    const title = pt.events.choices[0]!.title
    expect(pt.livesLost).toEqual(
      [2, 1].map((livesLeft) => ({
        parcelId: null,
        atS: sim.state.tick / 10,
        label: title,
        strain: null,
        laneRate: 0,
        counter: null,
        clearedByPlayer: false,
        sorter: null,
        hub: null,
        cause: 'event',
        eventId: card.id,
        option: label,
        livesLeft,
      })),
    )
    expect(pt.livesLost.every(lifeExplained)).toBe(true)
    expect(pt.events.livesLost).toBe(2)
    expect(pt.events.gameOverByEvent).toBe(0)
    expect(funBar(pt).find((c) => c.n === 6)).toMatchObject({
      state: 'pass',
      detail: 'all 2 explained',
    })
    // A replay of the same emits (a reload just before) adds nothing.
    for (const p of emitted) sim.events.emit('life:lost', p)
    expect(r.rec.snapshot().livesLost).toHaveLength(2)
    // A malware loss on the same tick is its own entry.
    expect(sim.dispatch({ kind: 'debugMalwareDelivery' }).ok).toBe(true)
    expect(r.rec.snapshot().livesLost.map((l) => l.cause)).toEqual([
      'event',
      'event',
      'malware',
    ])
  })

  it('taking the last life: game over by a card, counted once', () => {
    const { sim, r } = minus2(1)
    expect(sim.state.economy.gameOver).toBe(true)
    const pt = r.rec.snapshot()
    expect(pt.livesLost.map((l) => l.livesLeft)).toEqual([0])
    expect(pt.events.gameOverByEvent).toBe(1)
    expect(pt.events.choices).toHaveLength(1)
  })

  it('an event entry survives the restore record; an older record without cause parses as malware', () => {
    const { sim, r } = minus2(3)
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as {
      restore: { livesLost: Record<string, unknown>[] }
    }
    stored.restore.livesLost.push({
      parcelId: 7,
      atS: 1,
      label: 'colors@2.0.0-rc',
      strain: 'metal',
      laneRate: 0.5,
      counter: 'metal_detector',
      clearedByPlayer: false,
      sorter: null,
      hub: null,
    })
    const again = rig(sim, stored)
    expect(
      again.rec.snapshot().livesLost.map((l) => [l.cause, l.livesLeft]),
    ).toEqual([
      ['event', 2],
      ['event', 1],
      ['malware', null],
    ])
  })
})

describe('B3 §6 beats and the fun bar 3 helpers', () => {
  it('beats: a hold, a level-up, a gold quest offer and a quest end; a job quest:offered is its card`s beat', () => {
    const sim = makeSim(1)
    const r = rig(sim)
    const emit = sim.events.emit.bind(sim.events)
    emit('parcel:held', { id: 1 })
    emit('level:up', { level: 2 })
    emit('quest:offered', {
      questId: 'q1',
      templateId: 'x',
      target: null,
      ultimate: false,
    })
    emit('quest:offered', {
      questId: 'q2',
      templateId: 'golden_release',
      target: null,
      ultimate: true,
    })
    emit('quest:completed', {
      questId: 'q1',
      templateId: 'x',
      reward: { money: 0 } as never,
    })
    emit('quest:failed', {
      questId: 'q2',
      templateId: 'x',
      reason: 'timeout' as never,
    })
    expect(r.rec.snapshot().beats.map((b) => b.kind)).toEqual([
      'hold',
      'level',
      'quest',
      'quest',
      'quest',
    ])
  })

  it('longestQuiet: no beats = the window; beats outside ignored; the edges count; an empty window is null', () => {
    const b = beatsAt
    expect(longestQuiet([], 180, 600)).toBe(420)
    expect(longestQuiet(b(10, 700), 180, 600)).toBe(420)
    expect(longestQuiet(b(180, 600), 180, 600)).toBe(420)
    expect(longestQuiet(b(180, 270, 360, 450, 540, 600), 180, 600)).toBe(90)
    expect(longestQuiet(b(500, 200), 180, 600)).toBe(300)
    expect(longestQuiet(b(250.3, 300.1), 180, 600)).toBe(299.9)
    expect(longestQuiet(b(200), 600, 600)).toBeNull()
    expect(longestQuiet(b(200), 600, 180)).toBeNull()
  })

  it('rampWindow (D-M15-2): to the L2 tick once reached, else to min(simS, 11:00), open before both', () => {
    const pt = rig(makeSim(1)).rec.snapshot()
    const w = (level2AtS: number | null, simS: number) =>
      rampWindow({ ...pt, level2AtS, simS })
    expect(w(null, 300)).toEqual({ fromS: 180, toS: 300, open: true })
    expect(w(null, 700)).toEqual({ fromS: 180, toS: 660, open: false })
    expect(w(600, 650)).toEqual({ fromS: 180, toS: 600, open: false })
    expect(w(720, 900)).toEqual({ fromS: 180, toS: 720, open: false })
  })

  it('thinkMedian (D-M15-6): decisions and jobs, news excluded, one decimal; none → null', () => {
    const c = choice
    expect(thinkMedian([])).toBeNull()
    expect(thinkMedian([c('news', 9)])).toBeNull()
    expect(thinkMedian([c('decision', 3), c('job', 1), c('decision', 2)])).toBe(
      2,
    )
    expect(
      thinkMedian([
        c('decision', 1),
        c('news', 99),
        c('job', 2),
        c('decision', 3),
        c('decision', 10.1),
      ]),
    ).toBe(2.5)
    expect(thinkMedian([c('decision', 1.04), c('job', 1.12)])).toBe(1.1)
  })

  it('caps (D-M15-10): beats stop at BEATS_MAX and choices at CHOICES_MAX; the counters keep counting', () => {
    const sim = cardSim()
    const r = rig(sim)
    for (let i = 0; i < BEATS_MAX + 5; i++)
      sim.events.emit('parcel:held', { id: i })
    expect(r.rec.snapshot().beats).toHaveLength(BEATS_MAX)
    const stored = JSON.parse(JSON.stringify(r.rec.persisted())) as {
      restore: { choices: PlaytestChoice[] }
    }
    const filler = choice('decision', 1, 'ev_filler')
    stored.restore.choices = Array.from(
      { length: CHOICES_MAX + 3 },
      () => filler,
    )
    const again = rig(sim, stored)
    expect(again.rec.snapshot().events.choices).toHaveLength(CHOICES_MAX)
    offer(sim, PLAIN.id)
    answerOff(sim)
    const pt = again.rec.snapshot()
    expect(pt.events.choices).toHaveLength(CHOICES_MAX)
    expect(pt.events.choices.at(-1)?.id).toBe('ev_filler')
    expect(pt.events.decided).toBe(1)
    expect(pt.beats).toHaveLength(BEATS_MAX)
  })
})
