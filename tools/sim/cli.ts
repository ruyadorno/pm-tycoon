// `vlr sim` — the headless sim CLI (plan.md §6.9.2). Plain Node 26 type
// stripping: `node tools/sim/cli.ts --minutes 30 --seed 7`.
//
//   --minutes N        in-game minutes per seed (default 30; 600 ticks each)
//   --seed N | --seeds a-b   one seed (default 1) or an inclusive range
//   --policy competent|none  default: competent when src/sim/policy.ts exists
//   --config path      JSON partial deep-merged over src/data (load.node.ts)
//   --json             machine output only (see below)
//   --every N          print every Nth minute row (+ the last)
//   --gate             per-seed PASS/FAIL + medians vs economy.pacingTargets,
//                      writes docs/gate/latest.{json,md}; exit 1 on failure
//   --quick            the check gate: seeds 1-3 × 20 min → docs/gate/quick.*
//   --out dir          write the gate files there instead of docs/gate/
//
// Prints one row per in-game minute, '!' event lines, a GATE line, and the
// tick time percentiles. Asserts every tick: finite balance ≥ 0, no vehicle
// in one state > 120 s (idle_lot / inactive exempt); every 600 ticks:
// auditState (no NaN / non-JSON, ids resolve, each parcel in one place, the
// conservation identity). An assertion failure ends that seed and exits 1.
// --json: one seed (no --gate) → {seed, rows, events, gate, pass}; otherwise
// {runs: [{seed, rows, events, gate, pass}], summary?, pass}.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { DataError } from '../../src/data/index.ts'
import type { GameData } from '../../src/data/types.ts'
import type { PolicyFactory } from '../../src/sim/sim.ts'
import { auditState, Sim } from '../../src/sim/sim.ts'
import type { MinuteRow, VehicleState } from '../../src/sim/types.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../../src/sim/types.ts'
import { loadGameData } from './load.node.ts'
import type { GateSummary, RecordedEvent, SeedResult } from './report.ts'
import {
  computeMetrics,
  formatGate,
  formatGateLine,
  formatHeader,
  formatRow,
  gateMarkdown,
  Highlights,
  RunRecorder,
  seedResult,
  summarise,
} from './report.ts'

/** CLI sanity rule (plan.md §6.9.2): no vehicle stays in one state longer. */
const STUCK_S = 120
const STUCK_EXEMPT: readonly VehicleState[] = ['idle_lot', 'inactive']
const POLICY_URL = new URL('../../src/sim/policy.ts', import.meta.url)
const GATE_DIR = new URL('../../docs/gate/', import.meta.url)
const QUICK = { seeds: [1, 2, 3], minutes: 20 }
const FULL = { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], minutes: 30 }

export class UsageError extends Error {}

export interface CliOptions {
  minutes: number
  seeds: number[]
  /** null = auto (competent when policy.ts exists). */
  policy: 'competent' | 'none' | null
  config: string | null
  json: boolean
  every: number
  gate: boolean
  quick: boolean
  out: string | null
}

const USAGE =
  'usage: node tools/sim/cli.ts [--minutes N] [--seed N | --seeds a-b] [--policy competent|none] [--config path] [--json] [--every N] [--gate] [--quick] [--out dir]'

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
    v.policy !== 'competent' &&
    v.policy !== 'none'
  ) {
    throw new UsageError(`--policy: competent or none, got "${v.policy}"`)
  }
  const every = v.every === undefined ? 1 : posInt('every', v.every)
  if (every < 1) throw new UsageError('--every: at least 1')
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
  }
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
}

export interface RunResult {
  seed: number
  rows: MinuteRow[]
  events: RecordedEvent[]
  result: SeedResult
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
  const policy = policyFactory ? policyFactory(sim, 'competent') : null
  const total = minutes * TICKS_PER_DAY
  const times = new Float64Array(total)
  const asserts: string[] = []
  const since = new Map<number, { state: VehicleState; tick: number }>()
  let rowsSeen = 0
  let ran = 0
  for (let i = 0; i < total && asserts.length === 0; i++) {
    policy?.step()
    const t0 = performance.now()
    sim.tick()
    times[i] = performance.now() - t0
    ran += 1
    const s = sim.state
    const bal = s.economy.balance
    if (!Number.isFinite(bal) || bal < 0) {
      asserts.push(`${s.tick}: balance ${bal}`)
    }
    for (const v of s.vehicles) {
      const prev = since.get(v.id)
      if (!prev || prev.state !== v.state) {
        since.set(v.id, { state: v.state, tick: s.tick })
      } else if (
        !STUCK_EXEMPT.includes(v.state) &&
        s.tick - prev.tick > STUCK_S * TICKS_PER_S
      ) {
        asserts.push(`${s.tick}: ${v.name} stuck in ${v.state} > ${STUCK_S} s`)
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
  )
  return {
    seed,
    rows,
    events: recorder.events,
    result: seedResult(metrics, data.economy.pacingTargets, asserts),
    perf: {
      ticks: ran,
      p50Ms: pct(0.5),
      p99Ms: pct(0.99),
      maxMs: sorted.at(-1) ?? 0,
    },
  }
}

const ms = (x: number): string => x.toFixed(4)

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseCli(argv)
  const data = loadGameData(opts.config)
  const factory = opts.policy === 'none' ? null : await loadPolicyFactory()
  const policyName = factory
    ? 'competent'
    : opts.policy === 'competent'
      ? 'none (src/sim/policy.ts absent)'
      : opts.policy === 'none'
        ? 'none'
        : 'none (src/sim/policy.ts absent)'
  if (opts.policy === 'competent' && !factory) {
    console.error('sim: src/sim/policy.ts absent - running with no policy')
  }
  const out = (line: string): void => {
    if (!opts.json) console.log(line)
  }

  const runs: RunResult[] = []
  for (const seed of opts.seeds) {
    const lights = new Highlights()
    if (!opts.gate || opts.seeds.length === 1) {
      out(
        `# vlr sim · seed ${seed} · ${opts.minutes} min · policy ${policyName} · data ${data.hash}${opts.config ? ` · config ${opts.config}` : ''}`,
      )
      out(formatHeader())
    }
    const verbose = !opts.json && (!opts.gate || opts.seeds.length === 1)
    const run = runSeed(data, seed, opts.minutes, factory, {
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
      },
    )
    for (const line of formatGate(summary)) out(line)
    const dir = opts.out ? resolve(opts.out) : GATE_DIR
    const base = opts.quick ? 'quick' : 'latest'
    const cmd = `vlr sim:gate${opts.quick ? ' -- --quick' : ''}`
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
