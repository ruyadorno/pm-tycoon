// `vlr sim` — the headless sim CLI (plan.md §6.9.2). Plain Node 26 type
// stripping: `node tools/sim/cli.ts --minutes 30 --seed 7`.
//
//   --minutes N        in-game minutes per seed (default 30; 600 ticks each)
//   --seed N | --seeds a-b   one seed (default 1) or an inclusive range
//   --policy competent|delegating|none  default: competent when
//                      src/sim/policy.ts exists; `delegating` (build 2, M6 —
//                      SIM_FEATURES.people) hires a sorter at L2 and Clears
//                      what it tags `looks clean` (spec-build2 §7.2);
//                      `none` (build 3, D-8) answers every open card with
//                      its default option before each tick, so the hold
//                      (B3 §6) never freezes the run
//   --events on|off    build 3 (M11): SIM_FEATURES.events — the deck's
//                      decision draw (job cards come regardless) — set
//                      before the runs (default: the build's flag); echoed
//                      in the headers and the gate .md command line; a gate
//                      with the non-default value writes
//                      <base>-events-<on|off>.* (never latest.*)
//   --config path      JSON partial deep-merged over src/data (load.node.ts);
//                      its `start` recipe (src/data/configStart.ts, e.g.
//                      public/configs/tycoon.json's L5 lane) is played at
//                      tick 0 before the policy, as ?config= does on a New
//                      game (src/boot/configStart.ts), and printed
//   --json             machine output only (see below)
//   --every N          print every Nth minute row (+ the last)
//   --gate             per-seed PASS/FAIL + medians vs economy.pacingTargets,
//                      writes docs/gate/latest.{json,md}; exit 1 on failure.
//                      With --policy delegating: docs/gate/delegating.*
//                      (never latest.*), every window informational, exit 0
//                      unless an invariant broke (`vlr sim:delegating`)
//   --quick            the check gate: seeds 1-3 × 20 min → docs/gate/quick.*
//                      (M8: every level window informational — "quick")
//   --out dir          write the gate files there instead of docs/gate/
//   --baseline path    (--gate) a previous gate JSON, e.g. the committed
//                      docs/gate/baseline-build2.json (D-41): adds the Δ% of
//                      the seven playtest-1 medians and L3-L5, and "baseline
//                      rows within band" — ±5 % (plan-build2 §8.3 task 11),
//                      the level rows L2-L5 −12…−8 % (B3 §2.1, build 3);
//                      informational — the exit code is unchanged. Read
//                      before the gate files are written, so it may name the
//                      file being replaced.
//
// A gate (not --quick) with --minutes other than 30 writes
// latest-<N>min.{json,md} (delegating-<N>min.*) and never replaces latest.*
// (M8, design-m8-m9 §5.3): `vlr sim:gate -- --minutes 35` → latest-35min.*,
// the Golden Release row's run.
//
// Prints one row per in-game minute (M7: + the active quest), '!' event
// lines (M7: every quest offer / accept / completion / fail), a GATE line
// (M7: + questsOfferedBy30MinMin / questsCompletedBy30MinMin, gated behind
// SIM_FEATURES.quests, informational below 30 minutes), a quests line (the
// per-template offered / completed / failed counts), the conservation
// identity and the tick time percentiles. Asserts every tick:
// finite balance ≥ 0, finite vehicle positions, no vehicle without progress
// (stuckKey: state, cargo, stop, wait timer, reservations — never position)
// for > 120 s (M9: was "in one state"; idle_lot / inactive exempt); every
// 600 ticks: auditState (no NaN /
// non-JSON, ids resolve, each parcel in one place, the conservation identity
// spawned = waiting + in vehicles + in lane + held + shelf + delivered +
// tossed). An assertion failure ends that seed and exits 1. Gate windows
// whose sim system is not built yet (src/sim/features.ts) are informational.
// --json: one seed (no --gate) → {seed, rows, events, gate, conservation,
// pass}; otherwise {runs: [{…the same}], summary?, pass}. Build 3: the gate
// carries the event rows (gate.metrics: eventsOffered30, eventsOpenMaxTicks,
// eventsL1Decisions, policyEvPerCard from the policy's metrics() tally read
// before dispose, policyNonDefaultShare and the informational counts), the
// policy band comes from events.json policy and its weights print in the
// gate header; a '!' line names every decided decision / news card, an
// event's life and a vehicle lost to an event.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import {
  applyConfigStart,
  type ConfigStartReport,
} from '../../src/boot/configStart.ts'
import { DataError, type ConfigStart } from '../../src/data/index.ts'
import type { GameData } from '../../src/data/types.ts'
import { SIM_FEATURES } from '../../src/sim/features.ts'
import {
  answerWithDefault,
  deckEvMean,
} from '../../src/sim/policies/eventPolicy.ts'
import type { PolicyFactory, PolicyKind } from '../../src/sim/sim.ts'
import {
  auditState,
  conservation,
  formatConservation,
  Sim,
} from '../../src/sim/sim.ts'
import type { Conservation } from '../../src/sim/sim.ts'
import type { MinuteRow, Vehicle, VehicleState } from '../../src/sim/types.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import { loadConfigured } from './load.node.ts'
import type { GateSummary, RecordedEvent, SeedResult } from './report.ts'
import {
  compareBaseline,
  computeMetrics,
  DELEGATING_NOTE,
  formatGate,
  formatGateLine,
  formatHeader,
  formatRow,
  gateMarkdown,
  Highlights,
  RunRecorder,
  questTallies,
  seedResult,
  summarise,
} from './report.ts'

/**
 * CLI sanity rule (plan.md §6.9.2, "no vehicle stuck > 120 s"): no vehicle
 * goes this long without progress — the same stuckKey (state, cargo, stop,
 * wait timer and reservations; tests/sim/robust.ts `stuck: 'progress'`).
 * M9: a truck's delivering leg over the L4-L5 map (a dozen stops across five
 * regions) runs past 120 s while it moves, so "one state" is no longer a
 * deadlock sign (docs/decisions.md). Position is not progress: a vehicle
 * driving a routing loop moves every tick but never reaches its next stop.
 * The longest stretch without a key change in the policy runs is ~33 s
 * (M9 review, 6 runs × 60 min, both policies).
 */
const STUCK_S = 120
const STUCK_EXEMPT: readonly VehicleState[] = ['idle_lot', 'inactive']

/** A vehicle's progress key: any change of it (never its position) is progress. */
export function stuckKey(v: Vehicle): string {
  return `${v.state}|${v.cargo.length}|${v.stopIndex}|${v.waitUntilTick}|${v.reserved.length}`
}
const POLICY_URL = new URL('../../src/sim/policy.ts', import.meta.url)
const GATE_DIR = new URL('../../docs/gate/', import.meta.url)
const QUICK = { seeds: [1, 2, 3], minutes: 20 }
const FULL = { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], minutes: 30 }
/** The build's SIM_FEATURES.events (a gate run with the other value writes its own files). */
export const BUILD_EVENTS: boolean = SIM_FEATURES.events

export class UsageError extends Error {}

export interface CliOptions {
  minutes: number
  seeds: number[]
  /** null = auto (competent when policy.ts exists). */
  policy: PolicyKind | 'none' | null
  config: string | null
  json: boolean
  every: number
  gate: boolean
  quick: boolean
  out: string | null
  /** A previous gate JSON to compare the medians with (--gate only). */
  baseline: string | null
  /** --events on|off: SIM_FEATURES.events for the runs; null = the build's flag. */
  events: boolean | null
}

const USAGE =
  'usage: node tools/sim/cli.ts [--minutes N] [--seed N | --seeds a-b] [--policy competent|delegating|none] [--events on|off] [--config path] [--json] [--every N] [--gate] [--quick] [--out dir] [--baseline gate.json]'

const POLICIES: readonly (PolicyKind | 'none')[] = [
  'competent',
  'delegating',
  'none',
]

function posInt(name: string, v: string): number {
  const n = Number(v)
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n)) {
    throw new UsageError(
      `--${name}: expected a non-negative integer, got "${v}"`,
    )
  }
  return n
}

export function parseCli(argv: readonly string[]): CliOptions {
  // `vlr sim -- --minutes 1` may forward the separator itself.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  let parsed
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        minutes: { type: 'string' },
        seed: { type: 'string' },
        seeds: { type: 'string' },
        policy: { type: 'string' },
        config: { type: 'string' },
        json: { type: 'boolean' },
        every: { type: 'string' },
        gate: { type: 'boolean' },
        quick: { type: 'boolean' },
        out: { type: 'string' },
        baseline: { type: 'string' },
        events: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err))
  }
  const v = parsed.values
  if (v.help) throw new UsageError('')
  const quick = v.quick === true
  const gate = v.gate === true || quick
  if (v.seed !== undefined && v.seeds !== undefined) {
    throw new UsageError('use --seed or --seeds, not both')
  }
  let seeds = gate ? FULL.seeds : [1]
  if (v.seed !== undefined) seeds = [posInt('seed', v.seed)]
  if (v.seeds !== undefined) {
    const m = /^(\d+)-(\d+)$/.exec(v.seeds)
    if (!m) throw new UsageError(`--seeds: expected a-b, got "${v.seeds}"`)
    const a = posInt('seeds', m[1] as string)
    const b = posInt('seeds', m[2] as string)
    if (b < a) throw new UsageError(`--seeds: ${a}-${b} is empty`)
    seeds = Array.from({ length: b - a + 1 }, (_, i) => a + i)
  }
  let minutes = v.minutes === undefined ? 30 : posInt('minutes', v.minutes)
  if (quick) {
    seeds = QUICK.seeds
    minutes = QUICK.minutes
  }
  if (minutes < 1) throw new UsageError('--minutes: at least 1')
  if (
    v.policy !== undefined &&
    !POLICIES.includes(v.policy as PolicyKind | 'none')
  ) {
    throw new UsageError(`--policy: ${POLICIES.join(', ')}; got "${v.policy}"`)
  }
  if (v.policy === 'delegating' && !SIM_FEATURES.people) {
    throw new UsageError(
      '--policy delegating needs the people layer (SIM_FEATURES.people, M6)',
    )
  }
  if (v.baseline !== undefined && !gate) {
    throw new UsageError('--baseline needs --gate')
  }
  const every = v.every === undefined ? 1 : posInt('every', v.every)
  if (every < 1) throw new UsageError('--every: at least 1')
  if (v.events !== undefined && v.events !== 'on' && v.events !== 'off') {
    throw new UsageError(`--events: on or off; got "${v.events}"`)
  }
  return {
    minutes,
    seeds,
    policy: (v.policy as CliOptions['policy']) ?? null,
    config: v.config ?? null,
    json: v.json === true,
    every,
    gate,
    quick,
    out: v.out ?? null,
    baseline: v.baseline ?? null,
    events: v.events === undefined ? null : v.events === 'on',
  }
}

/**
 * The gate files' base name: `delegating` (the delegating rows never
 * replace latest.* / quick.*, B2 §7.2), `quick` (--quick), else `latest`; a
 * non-quick run of other than 30 minutes appends `-<N>min` (M8), so only
 * the 30-minute gate writes latest.*; build 3: `--events` with the value
 * the build does not ship appends `-events-<on|off>` (M11 pass 1 / pass 2
 * gates side by side).
 */
export function gateFileBase(
  opts: Pick<CliOptions, 'quick' | 'policy' | 'minutes'> & {
    events?: boolean | null
  },
): string {
  const base =
    opts.policy === 'delegating'
      ? 'delegating'
      : opts.quick
        ? 'quick'
        : 'latest'
  const sized =
    opts.quick || opts.minutes === FULL.minutes
      ? base
      : `${base}-${opts.minutes}min`
  const ev = opts.events ?? null
  return ev === null || ev === BUILD_EVENTS
    ? sized
    : `${sized}-events-${ev ? 'on' : 'off'}`
}

/** A previous gate summary (docs/gate/*.json) for --baseline. */
export function readBaseline(path: string): GateSummary {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolve(path), 'utf8'))
  } catch (err) {
    throw new UsageError(
      `--baseline ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const g = raw as Partial<GateSummary> | null
  if (!g || !Array.isArray(g.checks) || typeof g.dataHash !== 'string') {
    throw new UsageError(`--baseline ${path}: not a gate summary JSON`)
  }
  return g as GateSummary
}

/** src/sim/policy.ts's createPolicy, or null while the file does not exist (M0). */
export async function loadPolicyFactory(): Promise<PolicyFactory | null> {
  if (!existsSync(POLICY_URL)) return null
  const mod = (await import(POLICY_URL.href)) as { createPolicy?: unknown }
  if (typeof mod.createPolicy !== 'function') {
    throw new Error('src/sim/policy.ts must export createPolicy(sim, kind)')
  }
  return mod.createPolicy as PolicyFactory
}

export interface RunHooks {
  onRow?: (row: MinuteRow, sim: Sim) => void
  onEvent?: (e: RecordedEvent, sim: Sim) => void
  /** The policy kind policyFactory builds (default 'competent'). */
  kind?: PolicyKind
  /** M8: the quick gate — the level windows are informational per seed too. */
  quick?: boolean
  /**
   * A config's `start` recipe, played at tick 0 through a debug ViewSim
   * (applyConfigStart — logged commands, as the browser's New game) after
   * the recorder attaches and before the policy is built.
   */
  start?: ConfigStart | null
  /** Called once the `start` recipe was played (not without one). */
  onStart?: (report: ConfigStartReport | null, sim: Sim) => void
}

export interface RunResult {
  seed: number
  rows: MinuteRow[]
  events: RecordedEvent[]
  result: SeedResult
  /** Where every spawned parcel is at the end of the run. */
  conservation: Conservation
  /** What the config's `start` recipe did (null: none played). */
  start: ConfigStartReport | null
  perf: { ticks: number; p50Ms: number; p99Ms: number; maxMs: number }
}

/** One headless run: policy.step() before every tick, invariants checked as it goes. */
export function runSeed(
  data: GameData,
  seed: number,
  minutes: number,
  policyFactory: PolicyFactory | null,
  hooks: RunHooks = {},
): RunResult {
  const sim = new Sim(data, seed)
  const recorder = new RunRecorder(sim, (e) => hooks.onEvent?.(e, sim))
  let start: ConfigStartReport | null = null
  if (hooks.start) {
    start = applyConfigStart(
      createViewSim(sim, { debug: true }),
      sim,
      hooks.start,
    )
    hooks.onStart?.(start, sim)
  }
  const kind = hooks.kind ?? 'competent'
  const policy = policyFactory ? policyFactory(sim, kind) : null
  const total = minutes * TICKS_PER_DAY
  const times = new Float64Array(total)
  const asserts: string[] = []
  const since = new Map<number, { key: string; tick: number }>()
  let rowsSeen = 0
  let ran = 0
  for (let i = 0; i < total && asserts.length === 0; i++) {
    // D-8: with no policy every open card takes its default option (the
    // hold, B3 §6, would freeze the run otherwise).
    if (policy) policy.step()
    else answerWithDefault(sim)
    const before = sim.state.tick
    const t0 = performance.now()
    sim.tick()
    times[i] = performance.now() - t0
    ran += 1
    const s = sim.state
    if (s.tick === before) {
      // (Sim.tick never holds at game over.)
      asserts.push(
        `${s.tick}: held by card ${s.events.open?.eventId ?? '?'} (no answerable option)`,
      )
      break
    }
    const bal = s.economy.balance
    if (!Number.isFinite(bal) || bal < 0) {
      asserts.push(`${s.tick}: balance ${bal}`)
    }
    for (const v of s.vehicles) {
      if (!Number.isFinite(v.pos.tx) || !Number.isFinite(v.pos.ty)) {
        asserts.push(`${s.tick}: ${v.name} position NaN`)
      }
      const key = stuckKey(v)
      const prev = since.get(v.id)
      if (!prev || prev.key !== key) {
        since.set(v.id, { key, tick: s.tick })
      } else if (
        !STUCK_EXEMPT.includes(v.state) &&
        s.tick - prev.tick > STUCK_S * TICKS_PER_S
      ) {
        asserts.push(
          `${s.tick}: ${v.name} stuck in ${v.state} > ${STUCK_S} s without progress`,
        )
      }
    }
    while (rowsSeen < s.stats.minutes.length) {
      hooks.onRow?.(s.stats.minutes[rowsSeen] as MinuteRow, sim)
      rowsSeen += 1
    }
    if (s.tick % TICKS_PER_DAY === 0) {
      for (const p of auditState(s, data)) asserts.push(`${s.tick}: ${p}`)
    }
  }
  // The EV tally is read before dispose (B3 §3.8; metrics only).
  const tally = policy?.metrics?.() ?? null
  policy?.dispose?.()
  recorder.detach()
  const sorted = Array.from(times.subarray(0, ran)).toSorted((a, b) => a - b)
  const pct = (q: number): number =>
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ??
        0)
  const rows = sim.state.stats.minutes
  const metrics = computeMetrics(
    seed,
    minutes,
    recorder.events,
    rows,
    sim.state.stats,
    tally,
    sim.state.events.stats,
  )
  return {
    seed,
    rows,
    events: recorder.events,
    result: seedResult(
      metrics,
      data.economy.pacingTargets,
      asserts,
      SIM_FEATURES,
      policy && kind === 'delegating' ? DELEGATING_NOTE : null,
      hooks.quick === true,
      data.events.policy,
    ),
    conservation: conservation(sim.state),
    start,
    perf: {
      ticks: ran,
      p50Ms: pct(0.5),
      p99Ms: pct(0.99),
      maxMs: sorted.at(-1) ?? 0,
    },
  }
}

const ms = (x: number): string => x.toFixed(4)

/** `# quests: 5 offered · 3 completed by 30 min · active in min 7-13: yes · magic 1/1 on time · rush_district 2/2, …` */
export function questsLine(run: RunResult): string {
  const m = run.result.metrics
  const by = questTallies([m])
    .map(([id, t]) => `${id} ${t.completed}/${t.offered}`)
    .join(', ')
  return `# quests: ${m.questsOffered30} offered · ${m.questsCompleted30} completed by 30 min · active in min 7-13: ${m.questActive7to13 === 1 ? 'yes' : 'no'} · magic ${m.magicOnTime}/${m.magicSpawned} on time${by ? ` · completed/offered: ${by}` : ''}`
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseCli(argv)
  // Build 3: --events sets the deck's decision draw for every run below.
  if (opts.events !== null) SIM_FEATURES.events = opts.events
  const eventsWord = SIM_FEATURES.events ? 'on' : 'off'
  const { data, start } = loadConfigured(opts.config)
  const factory = opts.policy === 'none' ? null : await loadPolicyFactory()
  const kind: PolicyKind =
    opts.policy === 'delegating' ? 'delegating' : 'competent'
  const policyName = factory
    ? kind
    : opts.policy === 'none'
      ? 'none'
      : 'none (src/sim/policy.ts absent)'
  if (opts.policy !== null && opts.policy !== 'none' && !factory) {
    console.error('sim: src/sim/policy.ts absent - running with no policy')
  }
  // Asked for the delegating rows: never written over latest.* / quick.*.
  const delegating = opts.policy === 'delegating'
  // Read before the gate files are written (it may be the one replaced).
  const baseline = opts.baseline ? readBaseline(opts.baseline) : null
  const out = (line: string): void => {
    if (!opts.json) console.log(line)
  }

  const runs: RunResult[] = []
  for (const seed of opts.seeds) {
    const lights = new Highlights()
    if (!opts.gate || opts.seeds.length === 1) {
      out(
        `# vlr sim · seed ${seed} · ${opts.minutes} min · policy ${policyName} · events ${eventsWord} · data ${data.hash}${opts.config ? ` · config ${opts.config}` : ''}${start ? ` · start recipe Lv ${start.level}` : ''}`,
      )
      out(formatHeader())
    }
    const verbose = !opts.json && (!opts.gate || opts.seeds.length === 1)
    const run = runSeed(data, seed, opts.minutes, factory, {
      kind,
      quick: opts.quick,
      start,
      onStart: (report) => {
        if (!verbose) return
        const refused = report?.failures ?? []
        console.log(
          `# config start: ${report?.applied ?? 0} commands applied${refused.length > 0 ? ` · ${refused.length} refused: ${refused.map((f) => `${f.step} (${f.reason})`).join(', ')}` : ''}`,
        )
      },
      onEvent: (e, sim) => {
        if (!verbose) return
        const line = lights.line(e, sim)
        if (line) console.log(line)
      },
      onRow: (row) => {
        if (!verbose) return
        if (row.min % opts.every === 0 || row.min === opts.minutes) {
          console.log(formatRow(row))
        }
      },
    })
    runs.push(run)
    for (const a of run.result.asserts)
      console.error(`ASSERT seed ${seed} @${a}`)
    if (verbose) {
      console.log(formatGateLine(run.result))
      if (SIM_FEATURES.quests) console.log(questsLine(run))
      console.log(`# conservation: ${formatConservation(run.conservation)}`)
      console.log(
        `# perf: ${run.perf.ticks} ticks · tick p50 ${ms(run.perf.p50Ms)} ms · p99 ${ms(run.perf.p99Ms)} ms · max ${ms(run.perf.maxMs)} ms`,
      )
    }
  }

  let summary: GateSummary | null = null
  if (opts.gate) {
    summary = summarise(
      runs.map((r) => r.result),
      {
        dataHash: data.hash,
        config: opts.config,
        policy: policyName,
        minutes: opts.minutes,
        targets: data.economy.pacingTargets,
        quick: opts.quick,
        eventPolicy: data.events.policy,
        deckEvMean: deckEvMean(data),
      },
    )
    if (baseline && opts.baseline) {
      summary.baseline = compareBaseline(summary, baseline, opts.baseline)
    }
    for (const line of formatGate(summary)) out(line)
    const dir = opts.out ? resolve(opts.out) : GATE_DIR
    const base = gateFileBase(opts)
    const extra = [
      ...(opts.quick ? ['--quick'] : []),
      ...(!opts.quick && opts.minutes !== FULL.minutes
        ? ['--minutes', String(opts.minutes)]
        : []),
      ...(opts.baseline ? ['--baseline', opts.baseline] : []),
      ...(opts.events !== null ? ['--events', eventsWord] : []),
    ]
    const cmd = delegating
      ? `vlr sim:delegating${extra.length > 0 ? ` -- ${extra.join(' ')}` : ''}`
      : `vlr sim:gate${extra.length > 0 ? ` -- ${extra.join(' ')}` : ''}`
    mkdirSync(dir, { recursive: true })
    const jsonUrl = opts.out
      ? resolve(dir as string, `${base}.json`)
      : new URL(`${base}.json`, GATE_DIR)
    const mdUrl = opts.out
      ? resolve(dir as string, `${base}.md`)
      : new URL(`${base}.md`, GATE_DIR)
    writeFileSync(jsonUrl, `${JSON.stringify(summary, null, 2)}\n`)
    writeFileSync(mdUrl, gateMarkdown(summary, cmd))
    out(`# wrote ${opts.out ?? 'docs/gate'}/${base}.{json,md}`)
  }

  const asserted = runs.some((r) => r.result.asserts.length > 0)
  const pass = summary ? summary.pass : runs.every((r) => r.result.pass)
  if (opts.json) {
    const perSeed = runs.map((r) => ({
      seed: r.seed,
      rows: r.rows,
      events: r.events,
      gate: r.result,
      conservation: r.conservation,
      ...(r.start ? { start: r.start } : {}),
      pass: r.result.pass,
    }))
    const body =
      perSeed.length === 1 && !summary
        ? perSeed[0]
        : { runs: perSeed, ...(summary ? { summary } : {}), pass }
    process.stdout.write(`${JSON.stringify(body)}\n`)
  }
  if (asserted) return 1
  return opts.gate && !pass ? 1 : 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      if (err instanceof UsageError) {
        if (err.message) console.error(`sim: ${err.message}`)
        console.error(USAGE)
        process.exitCode = 2
      } else if (err instanceof DataError) {
        console.error(`data: ${err.problems.length} problem(s)`)
        for (const p of err.problems) console.error(`  ${p}`)
        process.exitCode = 1
      } else {
        console.error(err)
        process.exitCode = 1
      }
    },
  )
}
