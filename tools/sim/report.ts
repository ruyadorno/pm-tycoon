// Timeline formatting, event recording and the playtest-1 gate (plan.md
// §6.9.2, spec §7). Every threshold comes from economy.pacingTargets; none
// is hard-coded here. Pure functions over recorded runs, so Vitest (the M1+
// policy test) can reuse them without the CLI. A window whose sim system is
// not built yet (src/sim/features.ts SIM_FEATURES) is printed as
// "informational (Mn)" and does not fail the gate.

import type { PacingTargets } from '../../src/data/types.ts'
import type { SimEventName } from '../../src/sim/events.ts'
import type { SimFeature } from '../../src/sim/features.ts'
import { FEATURE_MILESTONE, SIM_FEATURES } from '../../src/sim/features.ts'
import type { Sim } from '../../src/sim/sim.ts'
import type { MinuteRow, RunStats } from '../../src/sim/types.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../../src/sim/types.ts'

// Recording -------------------------------------------------------------------------

/** One emitted event: {tick, name, ...payload} (payload deep-copied). */
export interface RecordedEvent {
  tick: number
  name: SimEventName
  [field: string]: unknown
}

/** Taps a sim and keeps every event (plus an optional live callback). */
export class RunRecorder {
  readonly events: RecordedEvent[] = []
  readonly #detach: () => void

  constructor(sim: Sim, onEvent?: (e: RecordedEvent) => void) {
    this.#detach = sim.addTap((name, payload, tick) => {
      const copy = structuredClone(payload) as Record<string, unknown>
      const e: RecordedEvent = { tick, name, ...copy }
      this.events.push(e)
      onEvent?.(e)
    })
  }

  detach(): void {
    this.#detach()
  }
}

// Timeline rows ---------------------------------------------------------------------

const COLUMNS: readonly [string, number][] = [
  ['min', 4],
  ['money', 7],
  ['earned', 7],
  ['lvl', 3],
  ['sat', 4],
  ['spawn', 6],
  ['deliv', 6],
  ['late', 5],
  ['mal', 6],
  ['s/c/m', 9],
  ['shelf', 6],
  ['held', 7],
  ['stall_s', 8],
  ['dock%', 6],
  ['fleet', 6],
  ['lives', 6],
]

/** `min money earned lvl sat spawn deliv late mal s/c/m shelf held stall_s dock% fleet lives` */
export function formatHeader(): string {
  return COLUMNS.map(([name, w]) => name.padStart(w)).join(' ')
}

/** One row; mal = malware share now, s/c/m = malware spawned/caught/missed, held = now/total. */
export function formatRow(r: MinuteRow): string {
  const cells = [
    String(r.min),
    String(r.money),
    String(r.earned),
    String(r.lvl),
    String(r.sat),
    String(r.spawn),
    String(r.deliv),
    String(r.late),
    `${(r.malShare * 100).toFixed(1)}%`,
    `${r.malSpawned}/${r.malCaught}/${r.malMissed}`,
    String(r.shelf),
    `${r.held}/${r.heldTotal}`,
    r.stallS.toFixed(1),
    String(r.dockPct),
    String(r.fleet),
    String(r.lives),
  ]
  return cells.map((c, i) => c.padStart(COLUMNS[i]?.[1] ?? 0)).join(' ')
}

/** m:ss of a tick. */
export function clockOf(tick: number): string {
  const s = Math.floor(tick / TICKS_PER_S)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The '!' lines: firsts (pickup, shelved, delivery, malware delivered,
 * scripted malware flagged + tossed, first malware toss, first wrong toss,
 * first stall per reason, first short payroll) and every rush, level-up, unlock, purchase, sale, hire, walkout, life
 * lost and game over. Call in emit order, while the sim is current (purchases
 * are named from its state).
 */
export class Highlights {
  readonly #seen: string[] = []
  readonly #scripted: number[] = []

  #first(key: string): boolean {
    if (this.#seen.includes(key)) return false
    this.#seen.push(key)
    return true
  }

  line(e: RecordedEvent, sim: Sim): string | null {
    const at = `! ${clockOf(e.tick).padStart(5)}`
    const s = sim.state
    switch (e.name) {
      case 'parcel:pickedUp':
        return this.#first('pickedUp')
          ? `${at} first pickup #${e.id} by vehicle ${e.vehicleId}`
          : null
      case 'parcel:shelved':
        return this.#first('shelved')
          ? `${at} first parcel shelved #${e.id}`
          : null
      case 'parcel:delivered':
        if (this.#first('delivered')) {
          return `${at} first delivery #${e.id}: $${e.paid}${e.onTime ? ' on time' : ' late'}${e.malware ? ' (MALWARE)' : ''}`
        }
        return e.malware === true && this.#first('malwareDelivered')
          ? `${at} first malware delivered #${e.id} (paid $0)`
          : null
      case 'building:rushed':
        return `${at} rush ${e.buildingId} → ${e.vehicleId === null ? 'no vehicle yet' : `vehicle ${e.vehicleId}`}`
      case 'parcel:flagged':
        if (e.scripted === true) {
          this.#scripted.push(e.id as number)
          return `${at} scripted malware #${e.id} flagged by ${e.checkerId} at ${e.nodeId} (${e.strain})`
        }
        return null
      case 'parcel:tossed': {
        if (this.#scripted.includes(e.id as number)) {
          return `${at} scripted malware #${e.id} tossed (+$${e.bounty})`
        }
        const key = e.wasMalware ? 'tossMalware' : 'tossClean'
        if (!this.#first(key)) return null
        return e.wasMalware
          ? `${at} first malware tossed #${e.id} (+$${e.bounty})`
          : `${at} first wrong toss #${e.id} (clean parcel)`
      }
      case 'level:up':
        return `${at} level ${e.level}`
      case 'region:unlocked':
        return `${at} region ${e.district} unlocked`
      case 'vehicle:bought': {
        const v = s.vehicles.find((x) => x.id === e.id)
        return `${at} bought ${v ? `${v.name} (${v.type})` : `vehicle ${e.id}`}`
      }
      case 'vehicle:sold':
        return `${at} sold vehicle ${e.id}`
      case 'lane:fixturePlaced': {
        const f = e.fixture as { checker?: { defId?: string } } | undefined
        return `${at} placed ${f?.checker?.defId ?? 'fixture'} in ${e.nodeId}`
      }
      case 'worker:hired':
      case 'worker:walkedOut':
      case 'worker:fired': {
        const who = s.employees.find((x) => x.id === e.employeeId)
        const verb = e.name.slice('worker:'.length)
        return `${at} ${e.kind} ${who?.name ?? e.employeeId} ${verb}`
      }
      case 'lane:stalled':
        return this.#first(`stall:${e.reason}`)
          ? `${at} first lane stall: ${e.reason} at ${e.nodeId}`
          : null
      case 'payroll:short':
        return this.#first('payrollShort')
          ? `${at} first short payroll (${(e.employeeIds as number[]).length} unpaid)`
          : null
      case 'life:lost':
        return `${at} LIFE LOST: #${e.parcelId} ${e.label} → ${e.destBuildingId} (lives ${s.economy.lives})`
      case 'game:over':
        return `${at} GAME OVER`
      default:
        return null
    }
  }
}

// Metrics and the gate --------------------------------------------------------------

/** One seed's playtest-1 numbers (null = never happened in the run). */
export interface RunMetrics {
  seed: number
  minutes: number
  firstDeliveryS: number | null
  /** Flag time of the first malware caught by a checker. */
  firstMalwareCaughtS: number | null
  level2Min: number | null
  truckAfterLevel2Min: number | null
  livesLost: number
  /** Seconds the lane spent stalled on a full shelf. */
  shelfStallS: number
  /** Hold Bay arrivals per 10 min while at L1 (the gated density). */
  holdBayEventsPer10MinL1: number | null
  /** Hold Bay arrivals per 10 min over the whole run (informational). */
  holdBayEventsPer10Min: number
  /** Malware share at the end of the run (informational; at 30 min in the gate). */
  malwareShareAtEnd: number
  level3Min: number | null
  level4Min: number | null
  level5Min: number | null
}

export interface GateCheck {
  /** The economy.pacingTargets key. */
  key: keyof PacingTargets
  metric: keyof RunMetrics
  target: string
  value: number | null
  /** The comparison itself (meaningful only when `note` is null). */
  pass: boolean
  /** "informational (M2)" while the window's system is not built (SIM_FEATURES); null = gated. */
  note: string | null
}

/** Sim systems each playtest-1 window needs (none listed = active from M1). */
export const WINDOW_NEEDS: Partial<Record<keyof PacingTargets, SimFeature[]>> =
  {
    firstMalwareCaughtMaxS: ['lane'],
    maxLivesLost: ['lives'],
    holdBayEventsPer10MinMin: ['lane'],
    level2Min: ['levels'],
    truckAfterLevel2MaxMin: ['levels'],
  }

export type SimFeatures = Record<SimFeature, boolean>

/** null when every system the window needs is built, else "informational (Mn)". */
export function windowNote(
  key: keyof PacingTargets,
  features: SimFeatures = SIM_FEATURES,
): string | null {
  const missing = (WINDOW_NEEDS[key] ?? []).filter((f) => !features[f])
  const first = missing[0]
  return first === undefined
    ? null
    : `informational (${FEATURE_MILESTONE[first]})`
}

/** A check counts toward the gate when gated (no note) and passing. */
export const checkOk = (c: GateCheck): boolean => c.pass || c.note !== null

const round = (x: number, d = 1): number => Math.round(x * 10 ** d) / 10 ** d

/**
 * Metrics from the recorded events (+ the final stats for the truck tick,
 * set by the buyVehicle command, and levelTick as a fallback).
 */
export function computeMetrics(
  seed: number,
  minutes: number,
  events: readonly RecordedEvent[],
  rows: readonly MinuteRow[],
  stats: RunStats,
): RunMetrics {
  const endTick = minutes * TICKS_PER_DAY
  const firstTick = (pred: (e: RecordedEvent) => boolean): number | null =>
    events.find(pred)?.tick ?? null
  const levelTick = (lvl: number): number | null =>
    firstTick((e) => e.name === 'level:up' && e.level === lvl) ??
    stats.levelTick[String(lvl)] ??
    null
  const toMin = (t: number | null): number | null =>
    t === null ? null : round(t / TICKS_PER_DAY, 2)

  const malwareIds = events
    .filter(
      (e) =>
        (e.name === 'parcel:flagged' && e.scripted === true) ||
        (e.name === 'parcel:tossed' && e.wasMalware === true),
    )
    .map((e) => e.id)
  const catchTick =
    firstTick(
      (e) => e.name === 'parcel:flagged' && malwareIds.includes(e.id),
    ) ?? stats.firstCatchTick

  // Shelf stall seconds from lane:stalled / lane:resumed segments.
  let shelfStallTicks = 0
  let open: { reason: unknown; tick: number } | null = null
  const close = (tick: number): void => {
    if (open && open.reason === 'shelfFull') shelfStallTicks += tick - open.tick
    open = null
  }
  for (const e of events) {
    if (e.name === 'lane:stalled') {
      close(e.tick)
      open = { reason: e.reason, tick: e.tick }
    } else if (e.name === 'lane:resumed') close(e.tick)
  }
  close(endTick)

  const l2 = levelTick(2)
  const held = events.filter((e) => e.name === 'parcel:held')
  const l1End = l2 ?? endTick
  const heldL1 = held.filter((e) => e.tick < l1End).length
  const truck = stats.truckTick
  const last = rows.at(-1)
  const delivered = firstTick((e) => e.name === 'parcel:delivered')
  return {
    seed,
    minutes,
    firstDeliveryS: delivered === null ? null : delivered / TICKS_PER_S,
    firstMalwareCaughtS: catchTick === null ? null : catchTick / TICKS_PER_S,
    level2Min: toMin(l2),
    truckAfterLevel2Min:
      l2 === null || truck === null ? null : toMin(Math.max(0, truck - l2)),
    livesLost: events.filter((e) => e.name === 'life:lost').length,
    shelfStallS: shelfStallTicks / TICKS_PER_S,
    holdBayEventsPer10MinL1:
      l1End <= 0 ? null : round((heldL1 * 10 * TICKS_PER_DAY) / l1End, 2),
    holdBayEventsPer10Min:
      minutes <= 0 ? 0 : round((held.length * 10) / minutes, 2),
    malwareShareAtEnd: last ? last.malShare : 0,
    level3Min: toMin(levelTick(3)),
    level4Min: toMin(levelTick(4)),
    level5Min: toMin(levelTick(5)),
  }
}

/** What the seven windows read (a RunMetrics, or the medians; null = never). */
export interface GateInputs {
  firstDeliveryS: number | null
  firstMalwareCaughtS: number | null
  level2Min: number | null
  truckAfterLevel2Min: number | null
  livesLost: number | null
  shelfStallS: number | null
  holdBayEventsPer10MinL1: number | null
}

const le = (v: number | null, max: number): boolean => v !== null && v <= max

/** The seven playtest-1 windows (spec §7, plan.md §6.9.2) against economy.pacingTargets. */
export function checkMetrics(
  m: GateInputs,
  t: PacingTargets,
  features: SimFeatures = SIM_FEATURES,
): GateCheck[] {
  const [lo, hi] = t.level2Min
  const checks: Omit<GateCheck, 'note'>[] = [
    {
      key: 'firstDeliveryS',
      metric: 'firstDeliveryS',
      target: `< ${t.firstDeliveryS} s`,
      value: m.firstDeliveryS,
      pass: m.firstDeliveryS !== null && m.firstDeliveryS < t.firstDeliveryS,
    },
    {
      key: 'firstMalwareCaughtMaxS',
      metric: 'firstMalwareCaughtS',
      target: `≤ ${t.firstMalwareCaughtMaxS} s`,
      value: m.firstMalwareCaughtS,
      pass: le(m.firstMalwareCaughtS, t.firstMalwareCaughtMaxS),
    },
    {
      key: 'level2Min',
      metric: 'level2Min',
      target: `${lo}-${hi} min`,
      value: m.level2Min,
      pass: m.level2Min !== null && m.level2Min >= lo && m.level2Min <= hi,
    },
    {
      key: 'truckAfterLevel2MaxMin',
      metric: 'truckAfterLevel2Min',
      target: `≤ ${t.truckAfterLevel2MaxMin} min`,
      value: m.truckAfterLevel2Min,
      pass: le(m.truckAfterLevel2Min, t.truckAfterLevel2MaxMin),
    },
    {
      key: 'maxLivesLost',
      metric: 'livesLost',
      target: `≤ ${t.maxLivesLost}`,
      value: m.livesLost,
      pass: le(m.livesLost, t.maxLivesLost),
    },
    {
      key: 'maxShelfStallS',
      metric: 'shelfStallS',
      target: `≤ ${t.maxShelfStallS} s`,
      value: m.shelfStallS,
      pass: le(m.shelfStallS, t.maxShelfStallS),
    },
    {
      key: 'holdBayEventsPer10MinMin',
      metric: 'holdBayEventsPer10MinL1',
      target: `≥ ${t.holdBayEventsPer10MinMin} /10 min at L1`,
      value: m.holdBayEventsPer10MinL1,
      pass:
        m.holdBayEventsPer10MinL1 !== null &&
        m.holdBayEventsPer10MinL1 >= t.holdBayEventsPer10MinMin,
    },
  ]
  return checks.map((c) => ({ ...c, note: windowNote(c.key, features) }))
}

/** Median with null = "never happened" = +∞ (fails every window); returns null for ∞. */
export function median(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null
  const xs = values
    .map((v) => (v === null ? Number.POSITIVE_INFINITY : v))
    .toSorted((a, b) => a - b)
  const mid = Math.floor(xs.length / 2)
  const m =
    xs.length % 2 === 1
      ? (xs[mid] as number)
      : ((xs[mid - 1] as number) + (xs[mid] as number)) / 2
  return Number.isFinite(m) ? round(m, 2) : null
}

export interface MedianMetrics extends GateInputs {
  holdBayEventsPer10Min: number | null
  malwareShareAtEnd: number | null
  level3Min: number | null
  level4Min: number | null
  level5Min: number | null
}

/** Medians of the gated metrics + the informational ones. */
export function medianMetrics(runs: readonly RunMetrics[]): MedianMetrics {
  const pick = (k: keyof RunMetrics): number | null =>
    median(runs.map((r) => r[k] as number | null))
  return {
    firstDeliveryS: pick('firstDeliveryS'),
    firstMalwareCaughtS: pick('firstMalwareCaughtS'),
    level2Min: pick('level2Min'),
    truckAfterLevel2Min: pick('truckAfterLevel2Min'),
    livesLost: pick('livesLost'),
    shelfStallS: pick('shelfStallS'),
    holdBayEventsPer10MinL1: pick('holdBayEventsPer10MinL1'),
    holdBayEventsPer10Min: pick('holdBayEventsPer10Min'),
    malwareShareAtEnd: pick('malwareShareAtEnd'),
    level3Min: pick('level3Min'),
    level4Min: pick('level4Min'),
    level5Min: pick('level5Min'),
  }
}

export interface SeedResult {
  metrics: RunMetrics
  checks: GateCheck[]
  /** Invariant failures (NaN, negative balance, conservation, stuck vehicle). */
  asserts: string[]
  pass: boolean
}

export interface GateSummary {
  version: 1
  dataHash: string
  config: string | null
  policy: string
  seeds: number[]
  minutes: number
  targets: PacingTargets
  runs: SeedResult[]
  medians: MedianMetrics
  checks: GateCheck[]
  /** SIM_FEATURES when the gate ran (which windows were gated). */
  features: SimFeatures
  /** Printed only: hold density over the run, malware share at the end, the build-2 level windows. */
  informational: {
    key: string
    target: string
    median: number | null
    note: string
  }[]
  pass: boolean
}

export function seedResult(
  metrics: RunMetrics,
  targets: PacingTargets,
  asserts: string[],
  features: SimFeatures = SIM_FEATURES,
): SeedResult {
  const checks = checkMetrics(metrics, targets, features)
  return {
    metrics,
    checks,
    asserts,
    pass: asserts.length === 0 && checks.every(checkOk),
  }
}

/** Medians must pass every playtest-1 window and no seed may break an invariant. */
export function summarise(
  runs: SeedResult[],
  meta: {
    dataHash: string
    config: string | null
    policy: string
    minutes: number
    targets: PacingTargets
    features?: SimFeatures
  },
): GateSummary {
  const features = meta.features ?? SIM_FEATURES
  const medians = medianMetrics(runs.map((r) => r.metrics))
  const checks = checkMetrics(medians, meta.targets, features)
  const t = meta.targets
  const build2 = 'build 2 — informational'
  const informational = [
    {
      key: 'holdBayEventsPer10Min',
      target: 'whole run',
      median: medians.holdBayEventsPer10Min,
      note: 'informational',
    },
    {
      key: 'malwareShareAt30Min',
      target: `share at ${meta.minutes} min`,
      median: medians.malwareShareAtEnd,
      note: 'informational',
    },
    {
      key: 'level3Min',
      target: `${t.level3Min[0]}-${t.level3Min[1]} min`,
      median: medians.level3Min,
      note: build2,
    },
    {
      key: 'level4Min',
      target: `${t.level4Min[0]}-${t.level4Min[1]} min`,
      median: medians.level4Min,
      note: build2,
    },
    {
      key: 'level5Min',
      target: `${t.level5Min[0]}-${t.level5Min[1]} min`,
      median: medians.level5Min,
      note: build2,
    },
  ]
  return {
    version: 1,
    dataHash: meta.dataHash,
    config: meta.config,
    policy: meta.policy,
    seeds: runs.map((r) => r.metrics.seed),
    minutes: meta.minutes,
    targets: meta.targets,
    runs,
    medians,
    checks,
    features: { ...features },
    informational,
    pass: runs.every((r) => r.asserts.length === 0) && checks.every(checkOk),
  }
}

// Gate tables ------------------------------------------------------------------------

const GATE_COLS: readonly {
  head: string
  w: number
  cell: (m: Partial<RunMetrics>) => string
}[] = [
  { head: 'firstDel_s', w: 10, cell: (m) => num(m.firstDeliveryS) },
  { head: 'catch_s', w: 8, cell: (m) => num(m.firstMalwareCaughtS) },
  { head: 'L2_min', w: 7, cell: (m) => num(m.level2Min, 2) },
  { head: 'truck+min', w: 9, cell: (m) => num(m.truckAfterLevel2Min, 2) },
  { head: 'lives', w: 5, cell: (m) => num(m.livesLost, 0) },
  { head: 'shelfStall_s', w: 12, cell: (m) => num(m.shelfStallS) },
  {
    head: 'hold/10m@L1',
    w: 11,
    cell: (m) => num(m.holdBayEventsPer10MinL1, 2),
  },
  { head: 'hold/10m', w: 8, cell: (m) => num(m.holdBayEventsPer10Min, 2) },
  {
    head: 'mal@end',
    w: 7,
    cell: (m) =>
      m.malwareShareAtEnd === undefined
        ? '—'
        : `${(m.malwareShareAtEnd * 100).toFixed(1)}%`,
  },
]

function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

/** A check value: integers bare, otherwise 2 decimals. */
function val(v: number | null): string {
  return v !== null && Number.isInteger(v) ? String(v) : num(v, 2)
}

const passWord = (p: boolean): string => (p ? 'PASS' : 'FAIL')

/** The terminal gate table: per-seed PASS/FAIL, medians vs targets, build-2 rows. */
export function formatGate(g: GateSummary): string[] {
  const lines: string[] = []
  lines.push(
    `GATE seeds ${g.seeds.join(',')} × ${g.minutes} min · policy ${g.policy} · data ${g.dataHash}${g.config ? ` · config ${g.config}` : ''}`,
  )
  lines.push(
    [
      'seed'.padStart(6),
      ...GATE_COLS.map((c) => c.head.padStart(c.w)),
      'result',
    ].join(' '),
  )
  for (const r of g.runs) {
    lines.push(
      [
        String(r.metrics.seed).padStart(6),
        ...GATE_COLS.map((c) => c.cell(r.metrics).padStart(c.w)),
        `${passWord(r.pass)}${r.asserts.length ? ` (${r.asserts.length} assert)` : ''}`,
      ].join(' '),
    )
  }
  const med = g.medians as Partial<RunMetrics>
  lines.push(
    [
      'median'.padStart(6),
      ...GATE_COLS.map((c) => c.cell(med).padStart(c.w)),
      passWord(g.pass),
    ].join(' '),
  )
  for (const c of g.checks) {
    const word = c.note === null ? passWord(c.pass) : 'info'
    lines.push(
      `  ${word} ${c.key}: median ${val(c.value)} (target ${c.target})${c.note === null ? '' : ` — ${c.note}`}`,
    )
  }
  for (const i of g.informational) {
    lines.push(
      `  info ${i.key}: median ${num(i.median, 3)} (${i.target}) — ${i.note}`,
    )
  }
  lines.push(
    `GATE ${passWord(g.pass)}${g.pass ? '' : ` (${failures(g).join(', ')})`}`,
  )
  return lines
}

function failures(g: GateSummary): string[] {
  const out = g.checks.filter((c) => !checkOk(c)).map((c) => c.key as string)
  const bad = g.runs.filter((r) => r.asserts.length > 0)
  if (bad.length > 0) {
    out.push(`asserts on seed ${bad.map((r) => r.metrics.seed).join(',')}`)
  }
  return out
}

/** One-run GATE line (informational outside --gate). */
export function formatGateLine(r: SeedResult): string {
  const parts = r.checks.map(
    (c) =>
      `${c.key} ${val(c.value)}${c.note !== null ? ' (info)' : c.pass ? '' : '✗'}`,
  )
  return `GATE seed ${r.metrics.seed} ${passWord(r.pass)}: ${parts.join(' · ')}`
}

const mdRow = (cells: string[]): string => `| ${cells.join(' | ')} |`

/** docs/gate/*.md */
export function gateMarkdown(g: GateSummary, cmd: string): string {
  const head = ['seed', ...GATE_COLS.map((c) => c.head), 'result']
  const lines = [
    `# Sim gate — ${passWord(g.pass)}`,
    '',
    `\`${cmd}\` · seeds ${g.seeds.join(', ')} × ${g.minutes} min · policy \`${g.policy}\` · data \`${g.dataHash}\`${g.config ? ` · config \`${g.config}\`` : ''}`,
    '',
    'Thresholds: `economy.pacingTargets` (spec §7, plan.md §6.9.2). Medians must pass; null = never happened.',
    '',
    mdRow(head),
    mdRow(head.map(() => '---')),
    ...g.runs.map((r) =>
      mdRow([
        String(r.metrics.seed),
        ...GATE_COLS.map((c) => c.cell(r.metrics)),
        passWord(r.pass) +
          (r.asserts.length ? ` (${r.asserts.join('; ')})` : ''),
      ]),
    ),
    mdRow([
      '**median**',
      ...GATE_COLS.map((c) => c.cell(g.medians as Partial<RunMetrics>)),
      `**${passWord(g.pass)}**`,
    ]),
    '',
    '| window | median | target | result |',
    '| --- | --- | --- | --- |',
    ...g.checks.map((c) =>
      mdRow([
        `\`${c.key}\``,
        val(c.value),
        c.target,
        c.note === null ? passWord(c.pass) : c.note,
      ]),
    ),
    ...g.informational.map((i) =>
      mdRow([`\`${i.key}\``, num(i.median, 3), i.target, i.note]),
    ),
    '',
  ]
  return lines.join('\n')
}
