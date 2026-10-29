// `vlr art:gen` — PixelLab batch driver (style-guide.md §3.5, §3.6, §4.1;
// plan.md §10 "PixelLab status").
//
// 1. Install chosen candidates (no network): an entry with
//    `chosenCandidate` whose final differs from that candidate gets the
//    normalized candidate copied into art/final (placeholder -> false).
// 2. Generate (network) only when PIXELLAB_TOKEN is set and not --offline:
//    - targets: source 'pixellab' entries still on placeholders (or the
//      --ids list), anchors first: while an anchor (anchorRole) is not
//      approved only anchors are generated (G2), 4 candidates each;
//    - budget guard: GET /balance before the batch; refuse when the
//      estimate would leave fewer than PIXELLAB_RESERVE (default 300)
//      generations or exceed the run budget PIXELLAB_RUN_BUDGET (default
//      2,500, counted from manifest.batches) or --max-gens N;
//    - at most 8 jobs in flight; every call appends gen[] to the entry and
//      one record to manifest.batches;
//    - candidates land in art/candidates/<id>/<n>.raw.png (download) and
//      <n>.png (normalize -> quantize -> outline), pre-filtered with lint
//      A02-A05 (failures get rejects[] by 'claude', reason 'lint:A0x');
//    - art/contact/candidates-<batch>@4x.png (anchors@4x.png for the anchor
//      pass) is written for the vision pass; the agent then approves with
//      `vlr art:approve -- id:n`.
// Inside `vlr art:build` (build.ts `all`) gen never calls the API unless
// `--gen` is passed (the anchor pass is run deliberately, separately);
// otherwise: "gen: skipped (...) — N placeholders in use".

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { StepOpts } from './draw-api.ts'
import {
  type Img,
  bbox,
  decodePng,
  encodeImg,
  readImg,
  writeIfChanged,
} from './iso.ts'
import {
  type GenLog,
  type Manifest,
  type ManifestEntry,
  ROOT,
  baseFrameNames,
  finalPath,
  frameSetSha256,
  loadManifest,
  saveManifest,
} from './manifest.ts'
import { normalizeRgba } from './normalize.ts'
import { outlineFinal } from './outline.ts'
import {
  CONCURRENCY,
  assertPresetEnums,
  base64Image,
  getBalance,
  hasToken,
  pool,
  runJob,
} from './pixellab.ts'
import { FLOOR_TILE_PNG, palettePngBase64, promptFor } from './prompts.ts'
import { quantizeImg } from './quantize.ts'

const CANDIDATES = join(ROOT, 'art/candidates')
export const RESERVE = Number(process.env.PIXELLAB_RESERVE ?? 300)
export const RUN_BUDGET = Number(process.env.PIXELLAB_RUN_BUDGET ?? 2500)

function candidateDir(id: string): string {
  return join(CANDIDATES, id)
}

/** candidate n of a single-frame entry, or frame `suffix` of candidate n */
export function candidatePath(id: string, n: number, suffix = ''): string {
  return suffix
    ? join(candidateDir(id), String(n), `${suffix.replace(/^_/, '')}.png`)
    : join(candidateDir(id), `${n}.png`)
}

// ---------------------------------------------------------------------------
// 1. install chosen candidates

function installChosen(m: Manifest): string[] {
  const installed: string[] = []
  for (const e of m.entries) {
    if (e.source !== 'pixellab' || e.chosenCandidate === undefined) continue
    const n = e.chosenCandidate
    const multi = e.frames.length > 1 || e.frames[0] !== ''
    let changed = false
    for (const f of e.frames) {
      const src = multi ? candidatePath(e.id, n, f) : candidatePath(e.id, n)
      if (!existsSync(src)) continue
      const buf = readFileSync(src)
      if (writeIfChanged(finalPath(e, e.id + f), buf)) changed = true
    }
    if (changed) {
      e.placeholder = false
      e.finalSha256 = frameSetSha256(e) ?? undefined
      installed.push(`${e.id}:${n}`)
    }
  }
  return installed
}

// ---------------------------------------------------------------------------
// 2. generation

/** lint A02-A05 subset on a normalized candidate (empty = ok) */
export function prefilter(e: ManifestEntry, img: Img | null): string | null {
  if (!img) return 'lint:A03'
  const b = bbox(img)
  if (!b) return 'lint:A05'
  if (e.class.startsWith('building') || e.class === 'warehouse-ext') {
    const fp = e.footprint?.[0] ?? 1
    // the lowest row must sit on the anchor and the base span the diamond
    if (b.y1 !== e.canvas[1] - 1) return 'lint:A04'
    if (b.x1 - b.x0 + 1 < 64 * fp - 8) return 'lint:A04'
  }
  return null
}

async function postProcess(e: ManifestEntry, png: Buffer): Promise<Img | null> {
  // downloads may be any PNG flavour: sharp converts to raw RGBA first
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const n = normalizeRgba(e, data, info.width, info.height)
  return n ? outlineFinal(e, quantizeImg(e, n)) : null
}

interface Task {
  e: ManifestEntry
  n: number
}

async function generateOne(
  t: Task,
  anchors: Buffer[],
  styleObject: string | null,
): Promise<{ logs: GenLog[]; gens: number; usd: number }> {
  const { e, n } = t
  const p = promptFor(e)
  const body: Record<string, unknown> = { ...p.params, seed: 1000 + n }
  delete body.t2_edit
  if (p.attach.includes('style_anchors') && anchors.length) {
    if (p.endpoint === '/generate-with-style-v2') {
      body.style_images = anchors.slice(0, 4).map((png) => {
        const { w, h } = decodePng(png)
        return { image: base64Image(png), width: w, height: h }
      })
    } else {
      const png = anchors[0] as Buffer
      const { w, h } = decodePng(png)
      body.style_image = {
        image: base64Image(png),
        size: { width: w, height: h },
      }
    }
  }
  if (p.attach.includes('palette_png')) {
    body.color_image = {
      type: 'base64',
      base64: palettePngBase64(),
      format: 'png',
    }
  }
  if (p.attach.includes('floor_tile') && existsSync(FLOOR_TILE_PNG)) {
    body.background_image = base64Image(readFileSync(FLOOR_TILE_PNG))
  }
  if (p.attach.includes('style_object') && styleObject) {
    body.style_object_id = styleObject
  }
  const res = await runJob(p.endpoint, body)
  const at = new Date().toISOString()
  const logs: GenLog[] = []
  mkdirSync(candidateDir(e.id), { recursive: true })
  for (const [k, im] of res.images.entries()) {
    const cand = n * Math.max(1, p.perCall) + k
    const raw = join(candidateDir(e.id), `${cand}.raw.png`)
    writeFileSync(raw, im.png)
    const img = await postProcess(e, im.png)
    const reason = prefilter(e, img)
    if (img) writeFileSync(candidatePath(e.id, cand), encodeImg(img))
    if (reason) {
      e.rejects.push({ candidate: cand, reason, by: 'claude', at })
    }
    logs.push({
      tool: p.tool,
      endpoint: p.endpoint,
      params: { ...p.params, seed: 1000 + n, prompt: p.text },
      jobId: res.jobId,
      seed: 1000 + n,
      candidate: cand,
      cost: p.cost,
      downloadUrl: im.url,
      sha256: createHash('sha256').update(im.png).digest('hex'),
      at,
    })
  }
  return {
    logs,
    gens: res.usage.generations ?? p.cost,
    usd: res.usage.usd ?? 0,
  }
}

function parseMaxGens(args: string[]): number | null {
  const i = args.findIndex(
    (a) => a === '--max-gens' || a.startsWith('--max-gens='),
  )
  if (i < 0) return null
  const a = args[i] as string
  const v = Number(a.includes('=') ? a.split('=')[1] : args[i + 1])
  return Number.isFinite(v) ? v : null
}

export async function run(opts: StepOpts): Promise<number> {
  const m = loadManifest()
  const installed = installChosen(m)
  if (installed.length) {
    saveManifest(m)
    console.log(`gen: installed chosen candidates ${installed.join(', ')}`)
  }
  const placeholders = m.entries.filter((e) => e.placeholder).length
  // inside `vlr art:build` gen is offline unless --gen (deliberate anchors)
  const inAll = process.argv[2] === 'all'
  const explicit = opts.args.includes('--gen')
  let reason: string | null = null
  if (!hasToken()) reason = 'no PIXELLAB_TOKEN'
  else if (opts.offline) reason = '--offline'
  else if (inAll && !explicit) reason = 'art:build runs gen offline; pass --gen'
  if (reason) {
    console.log(
      `gen: skipped (${reason}) — ${placeholders} placeholders in use`,
    )
    return 0
  }

  let targets = m.entries.filter(
    (e) =>
      e.source === 'pixellab' &&
      (opts.ids ? opts.ids.includes(e.id) : e.placeholder && !e.approved),
  )
  const pendingAnchors = m.entries.filter(
    (e) => e.anchorRole === 'anchor' && !e.approved,
  )
  const anchorPass = !opts.ids && pendingAnchors.length > 0
  if (anchorPass) targets = pendingAnchors
  if (targets.length === 0) {
    console.log(
      `gen: nothing to generate — ${placeholders} placeholders in use`,
    )
    return 0
  }
  const n = anchorPass ? 4 : opts.n
  const tasks: Task[] = []
  let estimate = 0
  for (const e of targets) {
    const p = promptFor(e)
    const calls = Math.ceil(n / Math.max(1, p.perCall))
    for (let i = 0; i < calls; i++) tasks.push({ e, n: i })
    estimate += calls * p.cost
  }
  await assertPresetEnums()
  const before = await getBalance()
  const spent = m.batches.reduce((a, b) => a + b.generations, 0)
  const maxGens = parseMaxGens(opts.args)
  const problems: string[] = []
  if (before.generations - estimate < RESERVE) {
    problems.push(
      `estimate ${estimate} would leave ${before.generations - estimate} < ` +
        `reserve ${RESERVE}`,
    )
  }
  if (spent + estimate > RUN_BUDGET) {
    problems.push(`run budget ${RUN_BUDGET} (spent ${spent}, +${estimate})`)
  }
  if (maxGens !== null && estimate > maxGens) {
    problems.push(`--max-gens ${maxGens} < estimate ${estimate}`)
  }
  if (problems.length) {
    console.error(`gen: budget guard refused the batch: ${problems.join('; ')}`)
    console.log(`gen: skipped (budget) — ${placeholders} placeholders in use`)
    return 0
  }
  console.log(
    `gen: ${anchorPass ? 'anchor pass' : 'bulk pass'}: ${targets.length} ids, ` +
      `${tasks.length} calls, ~${estimate} generations (balance ` +
      `${before.generations})`,
  )
  const anchors = m.entries
    .filter((e) => e.anchorRole === 'anchor' && e.approved)
    .filter((e) => e.class.startsWith('building'))
    .flatMap((e) => baseFrameNames(e).map((f) => finalPath(e, f)))
    .filter((p) => existsSync(p))
    .map((p) => encodeImg(readImg(p).img))
  const van = m.entries.find((e) => e.id === 'van')
  const styleObject =
    (van?.gen.find((g) => g.candidate === van.chosenCandidate)?.params
      .object_id as string | undefined) ?? null
  let gens = 0
  let usd = 0
  const failures: string[] = []
  await pool(tasks, CONCURRENCY, async (t) => {
    try {
      const r = await generateOne(t, anchors, styleObject)
      t.e.gen.push(...r.logs)
      gens += r.gens
      usd += r.usd
    } catch (err) {
      failures.push(`${t.e.id}#${t.n}: ${(err as Error).message}`)
    }
  })
  const after = await getBalance().catch(() => before)
  m.batches.push({
    at: new Date().toISOString(),
    ids: targets.map((e) => e.id),
    tool: [...new Set(targets.map((e) => promptFor(e).tool))].join('+'),
    generations: Math.max(gens, before.generations - after.generations),
    usd,
    balanceBefore: before.generations,
    balanceAfter: after.generations,
  })
  saveManifest(m)
  const { candidateSheet } = await import('./gallery.ts')
  const sheet = join(
    ROOT,
    'art/contact',
    anchorPass ? 'anchors@4x.png' : `candidates-${m.batches.length}@4x.png`,
  )
  candidateSheet(
    targets.map((e) => e.id),
    sheet,
  )
  for (const f of failures) console.error(`gen: ${f}`)
  console.log(
    `gen: done — ${gens} generations, $${usd.toFixed(2)}, balance ` +
      `${before.generations} -> ${after.generations}; candidates in ` +
      `art/candidates/, sheet ${sheet.replace(ROOT, '')}; approve with ` +
      '`vlr art:approve -- id:n`',
  )
  return failures.length > 0 && failures.length === tasks.length ? 1 : 0
}
