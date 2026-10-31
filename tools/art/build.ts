// `vlr art:<step>` runner (style-guide.md §3.2):
//   node tools/art/build.ts <step> [--ids a,b,c] [--offline] [--n 3] [args…]
// Steps: palette, draw, gen, normalize, quantize, outline, variants, lint,
// logo, atlas, gallery, approve, reject, balance, all.
// palette/draw/approve/reject live here (with palette.ts, manifest.ts); the
// others are modules tools/art/<step>.ts exporting run(opts: StepOpts) (type
// in draw-api.ts) that return an exit code (void = 0). A missing module
// prints "<step>: not built yet" and exits 0 — except lint, which exits 1
// once art/manifest.json exists. balance calls pixellab.ts balance() / run().
// all = draw → gen → normalize → quantize → outline → variants → lint →
// logo → atlas → gallery, stopping at the first non-zero step. `logo`
// (tools/art/logo.ts, B2 §5) renders art/logo.png into src/assets/logo.png:
// brand art outside the atlases and the palette contract.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type DrawCtx,
  type DrawnFrame,
  type StepOpts,
  makeCanvas,
} from './draw-api.ts'
import { drawerFor, findDrawer, loadDrawers } from './drawers.ts'
import { fallbackDrawer } from './fallback.ts'
import {
  type ManifestEntry,
  MANIFEST_PATH,
  approve,
  finalPath,
  frameSetSha256,
  hasKeptFinal,
  loadManifest,
  manifestCounts,
  reject,
  saveManifest,
  validateManifest,
} from './manifest.ts'
import { PALETTE, run as runPalette, subsetFor } from './palette.ts'
import { rngFor } from './rng.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

export const ALL_STEPS = [
  'draw',
  'gen',
  'normalize',
  'quantize',
  'outline',
  'variants',
  'lint',
  'logo',
  'atlas',
  'gallery',
] as const

const MODULE_STEPS = new Set([
  'gen',
  'normalize',
  'quantize',
  'outline',
  'variants',
  'lint',
  'logo',
  'atlas',
  'gallery',
])

export function parseArgs(argv: string[]): { step: string; opts: StepOpts } {
  const [step = 'help', ...rest] = argv
  const opts: StepOpts = {
    ids: null,
    offline: false,
    n: 3,
    args: [],
    root: ROOT,
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a === '--offline') opts.offline = true
    else if (a === '--ids' || a.startsWith('--ids=')) {
      const v = a === '--ids' ? rest[++i] : a.slice(6)
      opts.ids = (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (a === '--n' || a.startsWith('--n=')) {
      const v = Number(a === '--n' ? rest[++i] : a.slice(4))
      if (!Number.isInteger(v) || v < 1 || v > 8) {
        throw new Error(`--n must be an integer 1..8, got ${String(v)}`)
      }
      opts.n = v
    } else opts.args.push(a)
  }
  return { step, opts }
}

function selected(e: ManifestEntry, opts: StepOpts): boolean {
  return opts.ids === null || opts.ids.includes(e.id)
}

function writeIfChanged(path: string, buf: Buffer): boolean {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  writeFileSync(path, buf)
  return true
}

/** Problems with a drawer's output against the entry (empty = ok). */
export function checkFrames(e: ManifestEntry, frames: DrawnFrame[]): string[] {
  const problems: string[] = []
  const got = frames.map((f) => f.suffix)
  if (got.join('|') !== e.frames.join('|')) {
    problems.push(`frames [${got}] != manifest [${e.frames}]`)
  }
  for (const f of frames) {
    if (f.canvas.width !== e.canvas[0] || f.canvas.height !== e.canvas[1]) {
      problems.push(
        `frame '${f.suffix}' is ${f.canvas.width}x${f.canvas.height}, ` +
          `class canvas ${e.canvas[0]}x${e.canvas[1]}`,
      )
    }
  }
  return problems
}

export function drawCtxFor(e: ManifestEntry): DrawCtx {
  const subset = subsetFor(e.class, { district: e.district, id: e.id })
  const allowed = new Set(subset.map((c) => c.id))
  return {
    entry: e,
    rng: rngFor(e.id),
    pal: PALETTE,
    subset,
    hex(name) {
      if (!allowed.has(name)) {
        throw new Error(
          `${e.id}: colour '${name}' is not in subsetFor(${e.class})`,
        )
      }
      return PALETTE.hex(name)
    },
    newCanvas: makeCanvas,
  }
}

/** `vlr art:draw`: every selected entry lacking a kept final. */
export async function runDraw(opts: StepOpts): Promise<number> {
  await loadDrawers()
  const m = loadManifest()
  const schema = validateManifest(m)
  if (schema.length > 0) {
    for (const s of schema) console.error(s)
    console.error(`draw: manifest invalid (${schema.length} errors)`)
    return 1
  }
  let drawn = 0
  let written = 0
  let kept = 0
  let fell = 0
  let failed = 0
  for (const e of m.entries) {
    if (!selected(e, opts)) continue
    if (e.class === 'font') continue // vlr font:build owns the glyph sheet
    if (hasKeptFinal(e)) {
      kept++
      continue
    }
    const custom = findDrawer(e)
    let frames: DrawnFrame[] = []
    let problems: string[] = []
    try {
      frames = drawerFor(e)(drawCtxFor(e))
      problems = checkFrames(e, frames)
    } catch (err) {
      problems = [(err as Error).message]
    }
    if (problems.length > 0) {
      if (custom) {
        console.error(`draw: ${e.id}: ${problems.join('; ')} — using fallback`)
        failed++
      }
      frames = fallbackDrawer(drawCtxFor(e))
      const again = checkFrames(e, frames)
      if (again.length > 0) {
        console.error(`draw: ${e.id}: fallback failed: ${again.join('; ')}`)
        return 1
      }
    }
    if (!custom || problems.length > 0) fell++
    for (const f of frames) {
      const buf = f.canvas.toBuffer('image/png')
      if (writeIfChanged(finalPath(e, e.id + f.suffix), buf)) written++
    }
    e.finalSha256 = frameSetSha256(e) ?? undefined
    drawn++
  }
  const changed = saveManifest(m)
  const c = manifestCounts(m)
  console.log(
    `draw: ${drawn} entries drawn (${fell} by fallback, ${failed} drawer ` +
      `errors), ${kept} kept finals, ${written} PNGs changed; manifest ` +
      `${c.entries} entries / ${c.baseFrames} base frames / ${c.frames} ` +
      `frames incl. variants${changed ? ' (manifest updated)' : ''}`,
  )
  return failed > 0 ? 1 : 0
}

function runApprove(opts: StepOpts): number {
  if (opts.args.length === 0) {
    console.error('usage: vlr art:approve -- id[:candidate] …')
    return 1
  }
  const m = loadManifest()
  for (const spec of opts.args) {
    const e = approve(m, spec, 'author')
    console.log(
      `approve: ${e.id}` +
        (e.chosenCandidate !== undefined
          ? ` (candidate ${e.chosenCandidate})`
          : ''),
    )
  }
  saveManifest(m)
  return 0
}

function runReject(opts: StepOpts): number {
  const [spec, ...words] = opts.args
  if (!spec || words.length === 0) {
    console.error('usage: vlr art:reject -- id[:candidate] "reason"')
    return 1
  }
  const m = loadManifest()
  const e = reject(m, spec, words.join(' '), 'author')
  saveManifest(m)
  console.log(`reject: ${e.id}: ${words.join(' ')}`)
  return 0
}

async function importStep(
  step: string,
): Promise<Record<string, unknown> | null> {
  const path = fileURLToPath(new URL(`./${step}.ts`, import.meta.url))
  if (!existsSync(path)) return null
  return (await import(`./${step}.ts`)) as Record<string, unknown>
}

async function runModuleStep(step: string, opts: StepOpts): Promise<number> {
  const mod = await importStep(step)
  const run = mod?.run
  if (typeof run !== 'function') {
    if (step === 'lint' && existsSync(MANIFEST_PATH)) {
      console.error(
        'lint: tools/art/lint.ts missing — cannot lint the manifest',
      )
      return 1
    }
    console.log(`${step}: not built yet`)
    return 0
  }
  const code = (await (run as (o: StepOpts) => unknown)(opts)) as number | void
  return typeof code === 'number' ? code : 0
}

async function runBalance(opts: StepOpts): Promise<number> {
  const mod = await importStep('pixellab')
  const fn = mod?.balance ?? mod?.run
  if (typeof fn !== 'function') {
    console.log('balance: not built yet')
    return 0
  }
  const res = (await (fn as (o: StepOpts) => unknown)(opts)) as unknown
  if (typeof res === 'number') return res
  if (res !== undefined) console.log(JSON.stringify(res, null, 2))
  return 0
}

export async function runStep(step: string, opts: StepOpts): Promise<number> {
  if (step === 'palette') return runPalette()
  if (step === 'draw') return runDraw(opts)
  if (step === 'approve') return runApprove(opts)
  if (step === 'reject') return runReject(opts)
  if (step === 'balance') return runBalance(opts)
  if (MODULE_STEPS.has(step)) return runModuleStep(step, opts)
  if (step === 'all') {
    for (const s of ALL_STEPS) {
      const code = await runStep(s, opts)
      if (code !== 0) {
        console.error(`all: stopped at ${s} (exit ${code})`)
        return code
      }
    }
    return 0
  }
  console.error(
    `usage: node tools/art/build.ts <palette|draw|${[...MODULE_STEPS].join('|')}` +
      `|approve|reject|balance|all> [--ids a,b] [--offline] [--n 3]`,
  )
  return step === 'help' ? 0 : 1
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const { step, opts } = parseArgs(process.argv.slice(2))
  runStep(step, opts).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : err)
      process.exitCode = 1
    },
  )
}
