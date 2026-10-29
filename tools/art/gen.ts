// `vlr art:gen` — PixelLab batch driver (style-guide.md §3.5, §3.6, §4.1;
// plan.md §10 "PixelLab status"). Exercised end to end on the live API in
// the G2 anchor pass (2026-10-29).
//
// 1. Install chosen candidates (no network; not in --staging): an entry
//    with `chosenCandidate` whose finals differ from that candidate's
//    processed frames gets them copied into art/final (placeholder ->
//    false).
// 2. Generate (network) only when PIXELLAB_TOKEN is set and not --offline:
//    - targets: source 'pixellab' entries still on placeholders (or the
//      --ids list), anchors first: while an anchor (anchorRole) is
//      undecided only anchors are generated (G2), 4 candidates each;
//    - budget guard: GET /balance before the batch; refuse when the
//      estimate would leave fewer than PIXELLAB_RESERVE (default 300)
//      generations or exceed the run budget PIXELLAB_RUN_BUDGET (default
//      2,500, counted from the logged batches) or --max-gens N;
//    - at most 8 background jobs in flight (pixellab.ts semaphore);
//    - each candidate gets art/candidates/<id>/<n>/ with raw/<name>.png
//      (every download), <frame>.png (normalize -> quantize -> outline,
//      candidates.ts) and meta.json; pre-filter failures (lint A03-A06)
//      are logged as rejects by 'claude' with reason 'lint:A0x …';
//    - every call appends a gen[] record, every run one batch record
//      { at, ids, tool, generations (the /balance delta), usd,
//      balanceBefore, balanceAfter };
//    - contact sheets for the vision pass: art/contact/anchors@4x.png +
//      anchors-incontext@4x.png (anchor pass) or candidates-<n>@4x.png.
// --staging (shared working tree): never writes art/manifest.json or
//    art/final; gen[] / rejects / batches go to art/candidates/gen-log.json
//    and decisions are read from art/candidates/choices.json ({id:
//    {candidate, path, …} | {keep: 'procedural'}}): a decided anchor no
//    longer blocks the bulk pass, a chosen van's object_id becomes the
//    style_object_id of bike/truck, chosen building anchors become style
//    images. An install step applies choices.json later.
// Other flags: --ids a,b  --n 1..8  --max-gens N  --seed N (seed base,
//    default 1000; seed = base + candidate number)  --sheet (rebuild the
//    contact sheets from existing candidates, no network)  --anchors
//    (force the anchor set as targets).
// Inside `vlr art:build` (build.ts `all`) gen never calls the API unless
// `--gen` is passed; otherwise: "gen: skipped (...) — N placeholders in use".

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type Processed,
  frameStem,
  processBuilding,
  processMachine,
  processProp,
  processShelf,
  processVehicle,
  processWorker,
  toImg,
} from './candidates.ts'
import type { StepOpts } from './draw-api.ts'
import {
  type Img,
  decodePng,
  encodeImg,
  readImg,
  writeIfChanged,
} from './iso.ts'
import {
  type Batch,
  type GenLog,
  type Manifest,
  type ManifestEntry,
  type RejectLog,
  ROOT,
  baseFrameNames,
  finalPath,
  frameSetSha256,
  loadManifest,
  saveManifest,
} from './manifest.ts'
import {
  CONCURRENCY,
  type JobResult,
  animateCharacter,
  assertPresetEnums,
  base64Image,
  getBalance,
  hasToken,
  pool,
  runJob,
  scrub,
} from './pixellab.ts'
import {
  type Prompt,
  type StyleAnchor,
  type StyleMode,
  promptFor,
} from './prompts.ts'

export const CANDIDATES = join(ROOT, 'art/candidates')
export const GEN_LOG = join(CANDIDATES, 'gen-log.json')
export const CHOICES = join(CANDIDATES, 'choices.json')
export const RESERVE = Number(process.env.PIXELLAB_RESERVE ?? 300)
export const RUN_BUDGET = Number(process.env.PIXELLAB_RUN_BUDGET ?? 2500)

export function candidateDir(id: string, n: number): string {
  return join(CANDIDATES, id, String(n))
}

/** processed frame `suffix` of candidate n ('' -> base.png) */
export function candidatePath(id: string, n: number, suffix = ''): string {
  return join(candidateDir(id, n), `${frameStem(suffix)}.png`)
}

/** candidate numbers present on disk for an id */
export function candidateNumbers(id: string): number[] {
  const dir = join(CANDIDATES, id)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d+$/.test(f))
    .map(Number)
    .toSorted((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Staging log + choices

export interface GenLogFile {
  version: 1
  entries: Record<string, { gen: GenLog[]; rejects: RejectLog[] }>
  batches: Batch[]
}

function readGenLogFile(): GenLogFile {
  if (!existsSync(GEN_LOG)) return { version: 1, entries: {}, batches: [] }
  return JSON.parse(readFileSync(GEN_LOG, 'utf8')) as GenLogFile
}

/** lengths at load time: a run only appends, so its delta is a tail */
const loadedLen = new WeakMap<
  GenLogFile,
  { batches: number; entries: Map<string, [number, number]> }
>()

export function loadGenLog(): GenLogFile {
  const g = readGenLogFile()
  loadedLen.set(g, {
    batches: g.batches.length,
    entries: new Map(
      Object.entries(g.entries).map(([id, x]) => [
        id,
        [x.gen.length, x.rejects.length],
      ]),
    ),
  })
  return g
}

/**
 * Append-only save: this run's new gen / rejects / batches are merged onto
 * a fresh read of the file, so concurrent writers (decide.ts, another gen
 * run) never lose each other's records.
 */
function saveGenLog(g: GenLogFile): void {
  mkdirSync(CANDIDATES, { recursive: true })
  const base = loadedLen.get(g)
  const disk = readGenLogFile()
  if (base) {
    disk.batches.push(...g.batches.slice(base.batches))
    for (const [id, x] of Object.entries(g.entries)) {
      const [ng, nr] = base.entries.get(id) ?? [0, 0]
      const slot = (disk.entries[id] ??= { gen: [], rejects: [] })
      slot.gen.push(...x.gen.slice(ng))
      slot.rejects.push(...x.rejects.slice(nr))
    }
  }
  const out = base ? disk : g
  writeFileSync(GEN_LOG, `${JSON.stringify(out, null, 1)}\n`)
  // the in-memory log now mirrors the file; reset its baseline
  loadedLen.set(g, {
    batches: g.batches.length,
    entries: new Map(
      Object.entries(g.entries).map(([id, x]) => [
        id,
        [x.gen.length, x.rejects.length],
      ]),
    ),
  })
}

export type Choice =
  | {
      candidate: number
      path: string
      score: number
      reason: string
      approvedBy: 'agent' | 'author'
      provisional: boolean
      /** wh_ext: which follow-up edit (raw/edit_t2_<k>) is the _t2 frame */
      t2Edit?: number
    }
  | { keep: 'procedural'; reason: string }

export function loadChoices(): Record<string, Choice> {
  if (!existsSync(CHOICES)) return {}
  return JSON.parse(readFileSync(CHOICES, 'utf8')) as Record<string, Choice>
}

// ---------------------------------------------------------------------------
// 1. install chosen candidates (not in staging)

function installChosen(m: Manifest): string[] {
  const installed: string[] = []
  for (const e of m.entries) {
    if (e.source !== 'pixellab' || e.chosenCandidate === undefined) continue
    const n = e.chosenCandidate
    let changed = false
    for (const f of e.frames) {
      const src = candidatePath(e.id, n, f)
      if (!existsSync(src)) continue
      if (writeIfChanged(finalPath(e, e.id + f), readFileSync(src))) {
        changed = true
      }
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

interface Task {
  e: ManifestEntry
  /** first candidate number this call produces */
  n: number
  p: Prompt
}

interface Anchor extends StyleAnchor {
  png: Buffer
}

interface Ctx {
  anchors: Anchor[]
  styleObject: string | null
  seedBase: number
  /** chosen candidate frame (single-frame entries) by id, for edits */
  editSource: (id: string) => Buffer | null
}

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function placeholderFrames(e: ManifestEntry): Map<string, Img> {
  const out = new Map<string, Img>()
  for (const f of e.frames) {
    const p = finalPath(e, e.id + f)
    if (existsSync(p)) out.set(f, readImg(p).img)
  }
  return out
}

const NO_SEED = new Set(['/create-8-direction-object'])

/** the request body of one call: params + seed + attached images */
function bodyFor(t: Task, ctx: Ctx): Record<string, unknown> {
  const { p, e } = t
  const body: Record<string, unknown> = { ...p.params }
  // /create-8-direction-object has no seed field (extra fields are a 422)
  if (!NO_SEED.has(p.endpoint)) body.seed = ctx.seedBase + t.n
  if (p.attach.includes('style_anchors') && ctx.anchors.length) {
    body.style_images = ctx.anchors.slice(0, 4).map((a) => ({
      image: base64Image(a.png),
      width: a.w,
      height: a.h,
    }))
  }
  if (p.attach.includes('style_anchor_fit')) {
    const [W, H] = e.canvas
    const fit =
      ctx.anchors.find((a) => a.id === p.styleAnchor) ??
      ctx.anchors.find((a) => a.w <= W && a.h <= H)
    if (fit) {
      body.style_image = {
        image: base64Image(fit.png),
        size: { width: fit.w, height: fit.h },
        usage_description:
          'style reference only: palette, outline, shading and isometric ' +
          'angle; draw the described subject, not this building',
      }
    }
  }
  if (p.attach.includes('style_object') && ctx.styleObject) {
    body.style_object_id = ctx.styleObject
  }
  if (p.attach.includes('edit_source')) {
    const png = p.editOf ? ctx.editSource(p.editOf) : null
    if (!png)
      throw new Error(
        `${e.id}: edit source ${p.editOf} has no chosen candidate`,
      )
    body.image = base64Image(png)
  }
  return body
}

function logFor(
  t: Task,
  res: JobResult,
  cand: number,
  body: Record<string, unknown>,
  png: Buffer,
  url: string,
  at: string,
  extra: Record<string, unknown> = {},
): GenLog {
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    // image payloads are not logged (their sha256 is)
    if (/image|images$/.test(k) && typeof v === 'object') continue
    params[k] = v
  }
  return {
    tool: t.p.tool,
    endpoint: res.endpoint,
    params: {
      ...params,
      prompt: t.p.text,
      ...(t.p.styleAnchor ? { style_anchor: t.p.styleAnchor } : {}),
      ...res.ids,
      ...extra,
    },
    jobId: res.jobId,
    seed: body.seed as number,
    candidate: cand,
    cost: res.generations ?? t.p.cost,
    downloadUrl: url,
    sha256: sha(png),
    at,
  }
}

interface Produced {
  cand: number
  processed: Processed
  logs: GenLog[]
  gens: number
}

/** raw downloads of candidate n, by name */
export function readRaw(id: string, n: number): Map<string, Buffer> {
  const dir = join(candidateDir(id, n), 'raw')
  const out = new Map<string, Buffer>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).toSorted()) {
    if (f.endsWith('.png')) out.set(f.slice(0, -4), readFileSync(join(dir, f)))
  }
  return out
}

function readMeta(id: string, n: number): Record<string, unknown> {
  const p = join(candidateDir(id, n), 'meta.json')
  return existsSync(p)
    ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {}
}

/** normalize -> quantize -> outline one candidate from its raw downloads */
export async function processFromRaw(
  e: ManifestEntry,
  raw: Map<string, Buffer>,
  editPick = 0,
): Promise<Processed> {
  const recipe = promptFor(e).recipe
  if (recipe === 'image') {
    const name = [...raw.keys()].find(
      (k) => !k.startsWith('orig_') && !k.startsWith('edit_'),
    )
    const png = name === undefined ? undefined : raw.get(name)
    if (!png)
      return { frames: new Map(), reject: 'lint:A03 no image', notes: [] }
    const img = await toImg(e, png, raw.get(`orig_${name}`))
    const pr =
      e.class.startsWith('building') || e.class === 'warehouse-ext'
        ? processBuilding(e, img)
        : e.class === 'prop' || e.class === 'dock-prop'
          ? processProp(e, img)
          : e.class === 'fixture-shelf'
            ? processShelf(e, img)
            : processMachine(e, img)
    // follow-up edits (wh_ext _t2): raw/edit_<frame>_<k>.png; every edit is
    // written as <frame>_<k>.png for review, the picked one as <frame>.png
    for (const [k, buf] of raw) {
      const em = /^edit_([a-z0-9]+)_(\d+)$/.exec(k)
      if (!em) continue
      const suffix = `_${em[1]}`
      const ep = processBuilding(e, await toImg(e, buf), suffix)
      const fr = ep.frames.get(suffix)
      if (!fr) continue
      pr.frames.set(`${suffix}_${em[2]}`, fr)
      if (Number(em[2]) === editPick) pr.frames.set(suffix, fr)
      pr.notes.push(
        `edit ${suffix}_${em[2]}${ep.reject ? ` REJECT ${ep.reject}` : ''}`,
      )
    }
    return pr
  }
  const rot = new Map<string, Img>()
  const anims = new Map<string, Map<string, Img[]>>()
  for (const [name, png] of raw) {
    const m = /^anim_([a-z]+)_([a-z-]+)_(\d+)$/.exec(name)
    if (!m) {
      rot.set(name, await toImg(e, png))
      continue
    }
    const [, key, dir, i] = m as unknown as [string, string, string, string]
    const byDir = anims.get(key) ?? new Map<string, Img[]>()
    anims.set(key, byDir)
    const list = byDir.get(dir) ?? []
    byDir.set(dir, list)
    list[Number(i)] = await toImg(e, png)
  }
  if (recipe === 'object8') {
    return processVehicle(e, rot, placeholderFrames(e))
  }
  return processWorker(e, rot, anims)
}

function writeRaw(
  e: ManifestEntry,
  cand: number,
  raw: { name: string; png: Buffer }[],
): void {
  const dir = join(candidateDir(e.id, cand), 'raw')
  mkdirSync(dir, { recursive: true })
  for (const r of raw) writeFileSync(join(dir, `${r.name}.png`), r.png)
}

function writeProcessed(
  e: ManifestEntry,
  cand: number,
  processed: Processed,
  meta: Record<string, unknown> = {},
): void {
  const dir = candidateDir(e.id, cand)
  mkdirSync(dir, { recursive: true })
  for (const [s, img] of processed.frames) {
    writeFileSync(candidatePath(e.id, cand, s), encodeImg(img))
  }
  const merged = {
    ...readMeta(e.id, cand),
    ...meta,
    reject: processed.reject,
    notes: processed.notes,
  }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(merged, null, 1)}\n`)
}

/**
 * Template animations of a character candidate that have no raw frames
 * yet: run them, write their raw frames, return logs + generations.
 */
async function animateMissing(
  e: ManifestEntry,
  cand: number,
  characterId: string,
): Promise<{ logs: GenLog[]; gens: number }> {
  const p = promptFor(e)
  const have = new Set(
    [...readRaw(e.id, cand).keys()]
      .map((k) => /^anim_([a-z]+)_/.exec(k)?.[1])
      .filter(Boolean),
  )
  const logs: GenLog[] = []
  let gens = 0
  await Promise.all(
    (p.animations ?? [])
      .filter((a) => !have.has(a.key))
      .map(async (a) => {
        const abody = {
          character_id: characterId,
          mode: 'template',
          template_animation_id: a.template,
          directions: a.directions,
        }
        try {
          const jobs = await animateCharacter(abody)
          for (const j of jobs) {
            writeRaw(
              e,
              cand,
              j.images.map((im) => ({
                name: `anim_${a.key}_${j.direction}_${im.name}`,
                png: im.png,
              })),
            )
            gens += j.generations ?? 1
            logs.push({
              tool: 'animate-character',
              endpoint: '/animate-character',
              params: { ...abody, ...j.ids, direction: j.direction },
              jobId: j.jobId,
              candidate: cand,
              cost: j.generations ?? 1,
              downloadUrl: '',
              sha256: sha(Buffer.concat(j.images.map((i) => i.png))),
              at: new Date().toISOString(),
            })
          }
        } catch (err) {
          console.error(
            `gen: ${e.id}#${cand} ${a.template}: ${scrub((err as Error).message)}`,
          )
        }
      }),
  )
  return { logs, gens }
}

async function produce(t: Task, ctx: Ctx): Promise<Produced[]> {
  const { e, p } = t
  const at = new Date().toISOString()
  const body = bodyFor(t, ctx)
  const res = await runJob(p.endpoint, body)
  const meta = {
    id: e.id,
    tool: p.tool,
    endpoint: p.endpoint,
    prompt: p.text,
    seed: body.seed,
    jobId: res.jobId,
    ids: res.ids,
    generations: res.generations,
    at,
  }
  if (p.recipe === 'image') {
    // one candidate per returned image
    const out: Produced[] = []
    for (const [k, im] of res.images.entries()) {
      const cand = t.n + k
      const orig = res.originals[k]
      writeRaw(e, cand, [
        { name: im.name, png: im.png },
        ...(orig ? [orig] : []),
      ])
      const processed = await processFromRaw(e, readRaw(e.id, cand))
      writeProcessed(e, cand, processed, meta)
      out.push({
        cand,
        processed,
        logs: [logFor(t, res, cand, body, im.png, im.url, at)],
        gens: k === 0 ? (res.generations ?? p.cost) : 0,
      })
    }
    return out
  }
  writeRaw(e, t.n, res.images)
  const logs: GenLog[] = [
    logFor(
      t,
      res,
      t.n,
      body,
      Buffer.concat(res.images.map((i) => i.png)),
      res.images[0]?.url ?? '',
      at,
      { files: res.images.map((i) => i.name) },
    ),
  ]
  let gens = res.generations ?? p.cost
  if (p.recipe === 'character') {
    const characterId = res.ids.character_id
    if (!characterId) throw new Error(`${e.id}: no character_id in response`)
    const a = await animateMissing(e, t.n, characterId)
    logs.push(...a.logs)
    gens += a.gens
  }
  const processed = await processFromRaw(e, readRaw(e.id, t.n))
  writeProcessed(e, t.n, processed, meta)
  return [{ cand: t.n, processed, logs, gens }]
}

function parseNum(args: string[], flag: string): number | null {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (i < 0) return null
  const a = args[i] as string
  const v = Number(a.includes('=') ? a.split('=')[1] : args[i + 1])
  return Number.isFinite(v) ? v : null
}

/** approved building anchors as style images (finals or staged choices) */
function styleAnchors(m: Manifest, staging: boolean): Anchor[] {
  const choices = staging ? loadChoices() : {}
  const out: Anchor[] = []
  const add = (id: string, png: Buffer) => {
    const { w, h } = decodePng(png)
    out.push({ id, png, w, h })
  }
  for (const e of m.entries) {
    if (e.anchorRole !== 'anchor' || !e.class.startsWith('building')) continue
    const c = choices[e.id]
    if (c && 'candidate' in c && existsSync(join(ROOT, c.path))) {
      add(e.id, readFileSync(join(ROOT, c.path)))
    } else if (!staging && e.approved && !e.placeholder) {
      for (const f of baseFrameNames(e)) {
        const p = finalPath(e, f)
        if (existsSync(p)) add(e.id, encodeImg(readImg(p).img))
      }
    }
  }
  return out
}

function parseStr(args: string[], flag: string): string | null {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (i < 0) return null
  const a = args[i] as string
  return a.includes('=') ? (a.split('=')[1] ?? null) : (args[i + 1] ?? null)
}

/** the chosen candidate of an id (staging: choices.json; else manifest) */
function chosenOf(e: ManifestEntry, staging: boolean): number | null {
  if (!staging) return e.chosenCandidate ?? null
  const c = loadChoices()[e.id]
  return c && 'candidate' in c ? c.candidate : null
}

/**
 * `--edit`: the follow-up edits of entries with a prompt `followUp`
 * (wh_ext _t2 = edit-image-pro-flash on the chosen _t1): --n edits of the
 * chosen candidate's processed _t1, written to its raw/edit_t2_<k>.png and
 * reprocessed. Budget-guarded, logged as a batch.
 */
async function edits(
  m: Manifest,
  log: GenLogFile,
  opts: StepOpts,
  staging: boolean,
): Promise<number> {
  const work: { e: ManifestEntry; cand: number; p: Prompt; k: number }[] = []
  for (const e of m.entries) {
    if (opts.ids && !opts.ids.includes(e.id)) continue
    const p = promptFor(e)
    if (!p.followUp) continue
    const cand = chosenOf(e, staging)
    if (cand === null) {
      console.error(`gen: --edit ${e.id}: no chosen candidate yet`)
      continue
    }
    const have = [...readRaw(e.id, cand).keys()].filter((k) =>
      k.startsWith('edit_'),
    )
    for (let i = 0; i < opts.n; i++)
      work.push({ e, cand, p, k: have.length + i })
  }
  if (!work.length) return 0
  const estimate = work.length * 9
  await assertPresetEnums()
  const before = await getBalance()
  const spent = (staging ? log.batches : m.batches).reduce(
    (a, b) => a + b.generations,
    0,
  )
  if (
    before.generations - estimate < RESERVE ||
    spent + estimate > RUN_BUDGET
  ) {
    console.error(`gen: budget guard refused --edit (${estimate})`)
    return 0
  }
  const at = new Date().toISOString()
  const seedBase = parseNum(opts.args, '--seed') ?? 2000
  let gens = 0
  await pool(work, CONCURRENCY, async (w) => {
    const fu = w.p.followUp as NonNullable<Prompt['followUp']>
    const src = candidatePath(w.e.id, w.cand, w.e.frames[0] ?? '')
    const png = readFileSync(src)
    const body = {
      image: base64Image(png),
      method: 'text',
      description: fu.description,
      no_background: true,
      seed: seedBase + w.k,
    }
    try {
      const res = await runJob(fu.endpoint, body)
      const im = res.images[0]
      if (!im) throw new Error('no image')
      writeRaw(w.e, w.cand, [
        { name: `edit_${fu.frame.replace(/^_/, '')}_${w.k}`, png: im.png },
      ])
      gens += res.generations ?? 9
      const g: GenLog = {
        tool: 'edit-image-pro-flash',
        endpoint: fu.endpoint,
        params: {
          method: 'text',
          description: fu.description,
          no_background: true,
          frame: fu.frame,
          edit: w.k,
          source: `candidate ${w.cand} ${w.e.frames[0]}`,
          source_sha256: sha(png),
          ...res.ids,
        },
        jobId: res.jobId,
        seed: body.seed,
        candidate: w.cand,
        cost: res.generations ?? 9,
        downloadUrl: im.url,
        sha256: sha(im.png),
        at,
      }
      if (staging)
        (log.entries[w.e.id] ??= { gen: [], rejects: [] }).gen.push(g)
      else w.e.gen.push(g)
      console.log(`gen: edited ${w.e.id}#${w.cand} ${fu.frame} edit ${w.k}`)
    } catch (err) {
      console.error(
        `gen: --edit ${w.e.id}#${w.cand}: ${scrub((err as Error).message)}`,
      )
    }
  })
  for (const id of new Set(work.map((w) => w.e.id))) {
    const e = work.find((w) => w.e.id === id)?.e as ManifestEntry
    const cand = chosenOf(e, staging) as number
    const c = staging ? loadChoices()[id] : undefined
    const pick = c && 'candidate' in c ? (c.t2Edit ?? 0) : 0
    const pr = await processFromRaw(e, readRaw(id, cand), pick)
    writeProcessed(e, cand, pr)
    console.log(`gen: reprocessed ${id}#${cand} (${pr.notes.join('; ')})`)
  }
  const after = await getBalance().catch(() => before)
  const batch: Batch = {
    at,
    ids: [...new Set(work.map((w) => w.e.id))],
    tool: 'edit-image-pro-flash',
    generations: Math.max(gens, before.generations - after.generations),
    usd: 0,
    balanceBefore: before.generations,
    balanceAfter: after.generations,
  }
  if (staging) {
    log.batches.push(batch)
    saveGenLog(log)
  } else {
    m.batches.push(batch)
    saveManifest(m)
  }
  console.log(
    `gen: --edit done — ${batch.generations} generations, balance ` +
      `${before.generations} -> ${after.generations}`,
  )
  return 0
}

/** the chosen van's object_id (style_object_id for bike / truck) */
function vanObjectId(
  m: Manifest,
  log: GenLogFile,
  staging: boolean,
): string | null {
  const van = m.entries.find((e) => e.id === 'van')
  if (!van) return null
  const c = staging ? loadChoices().van : undefined
  const cand =
    c && 'candidate' in c
      ? c.candidate
      : staging
        ? undefined
        : van.chosenCandidate
  if (cand === undefined) return null
  const gens = staging ? (log.entries.van?.gen ?? []) : van.gen
  const g = gens.find((x) => x.candidate === cand && x.params.object_id)
  return (g?.params.object_id as string | undefined) ?? null
}

/**
 * `--complete`: character candidates whose template animations are missing
 * (a refused template id, a failed job) get them run now, then are
 * reprocessed. Budget-guarded and logged like a batch.
 */
async function complete(
  m: Manifest,
  log: GenLogFile,
  opts: StepOpts,
  staging: boolean,
): Promise<number> {
  const work: { e: ManifestEntry; n: number; cid: string; missing: number }[] =
    []
  for (const e of m.entries) {
    if (opts.ids && !opts.ids.includes(e.id)) continue
    const p = promptFor(e)
    if (p.recipe !== 'character' || e.source !== 'pixellab') continue
    for (const n of candidateNumbers(e.id)) {
      const ids = (readMeta(e.id, n).ids ?? {}) as { character_id?: string }
      if (!ids.character_id) continue
      const have = new Set(
        [...readRaw(e.id, n).keys()]
          .map((k) => /^anim_([a-z]+)_/.exec(k)?.[1])
          .filter(Boolean),
      )
      const missing = (p.animations ?? [])
        .filter((a) => !have.has(a.key))
        .reduce((a, x) => a + x.directions.length, 0)
      if (missing) work.push({ e, n, cid: ids.character_id, missing })
    }
  }
  const estimate = work.reduce((a, w) => a + w.missing, 0)
  if (!work.length) {
    console.log('gen: --complete: nothing missing')
    return 0
  }
  await assertPresetEnums()
  const before = await getBalance()
  if (before.generations - estimate < RESERVE) {
    console.error(`gen: budget guard refused --complete (${estimate})`)
    return 0
  }
  console.log(
    `gen: --complete: ${work.length} candidates, ~${estimate} generations ` +
      `(balance ${before.generations})`,
  )
  let gens = 0
  const at = new Date().toISOString()
  await pool(work, CONCURRENCY, async (w) => {
    const r = await animateMissing(w.e, w.n, w.cid)
    gens += r.gens
    const pr = await processFromRaw(w.e, readRaw(w.e.id, w.n))
    writeProcessed(w.e, w.n, pr)
    if (staging) {
      const slot = (log.entries[w.e.id] ??= { gen: [], rejects: [] })
      slot.gen.push(...r.logs)
    } else w.e.gen.push(...r.logs)
    console.log(
      `gen: completed ${w.e.id}#${w.n}${pr.reject ? ` REJECT ${pr.reject}` : ''}` +
        ` (${pr.notes.slice(0, 4).join('; ')})`,
    )
  })
  const after = await getBalance().catch(() => before)
  const batch: Batch = {
    at,
    ids: [...new Set(work.map((w) => w.e.id))],
    tool: 'animate-character (complete)',
    generations: Math.max(gens, before.generations - after.generations),
    usd: 0,
    balanceBefore: before.generations,
    balanceAfter: after.generations,
  }
  if (staging) {
    log.batches.push(batch)
    saveGenLog(log)
  } else {
    m.batches.push(batch)
    saveManifest(m)
  }
  const { anchorSheets } = await import('./contact.ts')
  const sheets = anchorSheets(
    m,
    m.entries.filter((e) => e.anchorRole).map((e) => e.id),
  )
  console.log(
    `gen: done — ${batch.generations} generations, balance ` +
      `${before.generations} -> ${after.generations}; sheets ${sheets.join(', ')}`,
  )
  return 0
}

export async function run(opts: StepOpts): Promise<number> {
  const args = opts.args
  const staging = args.includes('--staging')
  const m = loadManifest()
  const log = loadGenLog()
  if (!staging) {
    const installed = installChosen(m)
    if (installed.length) {
      saveManifest(m)
      console.log(`gen: installed chosen candidates ${installed.join(', ')}`)
    }
  }
  const placeholders = m.entries.filter((e) => e.placeholder).length
  const choices = staging ? loadChoices() : {}
  const decided = (e: ManifestEntry) =>
    staging ? choices[e.id] !== undefined : e.approved
  const pendingAnchors = m.entries.filter(
    (e) => e.anchorRole === 'anchor' && !decided(e),
  )
  const anchorIds = m.entries.filter((e) => e.anchorRole).map((e) => e.id)
  if (args.includes('--reprocess')) {
    // offline: re-run normalize -> quantize -> outline from raw downloads
    for (const id of opts.ids ?? anchorIds) {
      const e = m.entries.find((x) => x.id === id)
      if (!e) continue
      const c = staging ? loadChoices()[id] : undefined
      const pick = c && 'candidate' in c ? (c.t2Edit ?? 0) : 0
      for (const n of candidateNumbers(id)) {
        const pr = await processFromRaw(e, readRaw(id, n), pick)
        writeProcessed(e, n, pr)
        console.log(
          `gen: reprocessed ${id}#${n}${pr.reject ? ` REJECT ${pr.reject}` : ''}` +
            ` (${pr.notes.slice(0, 4).join('; ')})`,
        )
      }
    }
    args.push('--sheet')
  }
  if (args.includes('--sheet')) {
    const { anchorSheets, candidateSheet } = await import('./contact.ts')
    const batchName = parseStr(args, '--batch')
    if (batchName && opts.ids) {
      console.log(`gen: sheet ${candidateSheet(m, opts.ids, batchName)}`)
    } else console.log(`gen: sheets ${anchorSheets(m, anchorIds).join(', ')}`)
    return 0
  }
  // inside `vlr art:build` gen is offline unless --gen (deliberate anchors)
  const inAll = process.argv[2] === 'all'
  let reason: string | null = null
  if (!hasToken()) reason = 'no PIXELLAB_TOKEN'
  else if (opts.offline) reason = '--offline'
  else if (inAll && !args.includes('--gen')) {
    reason = 'art:build runs gen offline; pass --gen'
  }
  if (reason) {
    console.log(
      `gen: skipped (${reason}) — ${placeholders} placeholders in use`,
    )
    return 0
  }

  if (args.includes('--complete')) return complete(m, log, opts, staging)
  if (args.includes('--edit')) return edits(m, log, opts, staging)

  let targets = m.entries.filter(
    (e) =>
      e.source === 'pixellab' &&
      (opts.ids
        ? opts.ids.includes(e.id)
        : e.placeholder && !e.approved && !decided(e)),
  )
  const anchorPass =
    args.includes('--anchors') || (!opts.ids && pendingAnchors.length > 0)
  if (anchorPass && !opts.ids) targets = pendingAnchors
  if (targets.length === 0) {
    console.log(
      `gen: nothing to generate — ${placeholders} placeholders in use`,
    )
    return 0
  }
  // the anchor pass defaults to 4 candidates (style-guide §3.5); build.ts
  // consumes --n, so an explicit value other than the default 3 wins
  const n = anchorPass && opts.n === 3 ? 4 : opts.n
  const anchors = styleAnchors(m, staging)
  const ctx: Ctx = {
    anchors,
    styleObject: vanObjectId(m, log, staging),
    seedBase: parseNum(args, '--seed') ?? 1000,
    editSource: (id) => {
      const se = m.entries.find((x) => x.id === id)
      const n = se ? chosenOf(se, staging) : null
      if (!se || n === null) return null
      const p = candidatePath(id, n, se.frames[0] ?? '')
      return existsSync(p) ? readFileSync(p) : null
    },
  }
  const sizes: StyleAnchor[] = anchors.map(({ id, w, h }) => ({ id, w, h }))
  const style = (parseStr(args, '--style') ?? 'auto') as StyleMode
  if (!['auto', 'none', 'anchor', 'v2'].includes(style)) {
    console.error(`gen: --style must be auto|none|anchor|v2, got ${style}`)
    return 1
  }
  const tasks: Task[] = []
  let estimate = 0
  for (const e of targets) {
    const keyArg = parseStr(args, '--key')
    const p = promptFor(e, {
      anchors: sizes,
      style,
      ...(keyArg === null ? {} : { key: keyArg === 'on' }),
      ...(parseStr(args, '--vehicle') === 'proflash'
        ? { vehicle: 'proflash' as const }
        : parseStr(args, '--vehicle') === 'object8'
          ? { vehicle: 'object8' as const }
          : {}),
    })
    if (p.attach.includes('style_object') && !ctx.styleObject) {
      console.error(`gen: ${e.id}: no chosen van object_id yet — skipped`)
      continue
    }
    if (p.editOf && !ctx.editSource(p.editOf)) {
      console.error(
        `gen: ${e.id}: edit source ${p.editOf} not chosen yet — skipped`,
      )
      continue
    }
    let next = Math.max(-1, ...candidateNumbers(e.id)) + 1
    const calls = Math.ceil(n / Math.max(1, p.perCall))
    for (let i = 0; i < calls; i++) {
      tasks.push({ e, n: next, p })
      next += Math.max(1, p.perCall)
      estimate += p.cost
    }
  }
  await assertPresetEnums()
  if (args.includes('--dry')) {
    // build + validate every request body, print the plan, spend nothing
    const { validateBody } = await import('./pixellab.ts')
    for (const t of tasks) {
      const body = bodyFor(t, ctx)
      await validateBody(t.p.endpoint, body)
      const shown = Object.fromEntries(
        Object.entries(body).map(([k, v]) =>
          /image/.test(k) && typeof v === 'object' ? [k, '<image>'] : [k, v],
        ),
      ) as Record<string, unknown>
      delete shown.target_palette
      console.log(
        `gen: dry ${t.e.id}#${t.n} ${t.p.endpoint} cost ${t.p.cost}` +
          `${t.p.styleAnchor ? ` style ${t.p.styleAnchor}` : ''} ${JSON.stringify(shown).slice(0, 300)}`,
      )
    }
    console.log(
      `gen: dry run — ${tasks.length} calls, ~${estimate} generations, valid`,
    )
    return 0
  }
  const before = await getBalance()
  const batches = staging ? log.batches : m.batches
  const spent = batches.reduce((a, b) => a + b.generations, 0)
  const maxGens = parseNum(args, '--max-gens')
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
    `gen: ${anchorPass ? 'anchor pass' : 'bulk pass'}${staging ? ' (staging)' : ''}: ` +
      `${targets.length} ids, ${tasks.length} calls, ~${estimate} generations ` +
      `(balance ${before.generations}, run spent ${spent})`,
  )
  const failures: string[] = []
  const results: { e: ManifestEntry; r: Produced }[] = []
  await pool(tasks, CONCURRENCY, async (t) => {
    try {
      for (const r of await produce(t, ctx)) {
        results.push({ e: t.e, r })
        console.log(
          `gen: ${t.e.id}#${r.cand}${r.processed.reject ? ` REJECT ${r.processed.reject}` : ' ok'}` +
            ` (${r.processed.notes.slice(0, 3).join('; ')})`,
        )
      }
    } catch (err) {
      failures.push(`${t.e.id}#${t.n}: ${scrub((err as Error).message)}`)
    }
  })
  const after = await getBalance().catch(() => before)
  const gens = results.reduce((a, x) => a + x.r.gens, 0)
  const at = new Date().toISOString()
  const batch: Batch = {
    at,
    ids: targets.map((e) => e.id),
    tool: [...new Set(tasks.map((t) => t.p.tool))].join('+'),
    generations: Math.max(gens, before.generations - after.generations),
    usd: 0,
    balanceBefore: before.generations,
    balanceAfter: after.generations,
  }
  for (const { e, r } of results) {
    const rejects: RejectLog[] = r.processed.reject
      ? [{ candidate: r.cand, reason: r.processed.reject, by: 'claude', at }]
      : []
    if (staging) {
      const slot = (log.entries[e.id] ??= { gen: [], rejects: [] })
      slot.gen.push(...r.logs)
      slot.rejects.push(...rejects)
    } else {
      e.gen.push(...r.logs)
      e.rejects.push(...rejects)
    }
  }
  if (staging) {
    log.batches.push(batch)
    saveGenLog(log)
  } else {
    m.batches.push(batch)
    saveManifest(m)
  }
  const { anchorSheets, candidateSheet } = await import('./contact.ts')
  const allAnchors = m.entries.filter((e) => e.anchorRole === 'anchor')
  const batchName = parseStr(args, '--batch') ?? String(batches.length)
  const sheets = args.includes('--no-sheet')
    ? ['(skipped: --no-sheet)']
    : anchorPass || targets.every((e) => e.anchorRole === 'anchor')
      ? anchorSheets(
          m,
          allAnchors.map((e) => e.id),
        )
      : [
          candidateSheet(
            m,
            targets.map((e) => e.id),
            batchName,
          ),
        ]
  for (const f of failures) console.error(`gen: ${f}`)
  console.log(
    `gen: done — ${batch.generations} generations (jobs report ${gens}), ` +
      `balance ${before.generations} -> ${after.generations}; candidates in ` +
      `art/candidates/, sheets ${sheets.join(', ')}` +
      (staging
        ? '; log art/candidates/gen-log.json, decisions art/candidates/choices.json'
        : '; approve with `vlr art:approve -- id:n`'),
  )
  return failures.length > 0 && failures.length === tasks.length ? 1 : 0
}
