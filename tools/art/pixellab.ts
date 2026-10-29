// PixelLab REST v2 client (style-guide.md §3.3, plan.md §10 "PixelLab
// status"). No SDK: fetch + poll. Exercised against the live API on
// 2026-10-29 (G2 anchor pass); the response shapes below are the observed
// ones, not guesses.
// - base https://api.pixellab.ai/v2, `Authorization: Bearer
//   ${process.env.PIXELLAB_TOKEN}`. The token is never printed, logged or
//   written anywhere; error messages and saved responses are scrubbed.
// - Request bodies are validated against the cached OpenAPI request schema
//   before the POST (every v2 request schema is additionalProperties:false,
//   so an unknown field is a 422 `extra_forbidden`; we fail before paying).
// - POST returns 200/202 with `background_job_id` plus the durable ids
//   (`object_id`, `character_id`, `image_id`, `source_image_id`), recorded
//   in JobResult.ids (bike/truck use the van's object_id as style_object_id).
// - GET /background-jobs/{id} is polled every 5 s (statuses `queued`,
//   `processing`, then `completed` / `failed`), 10 min timeout, 3 retries
//   with backoff on 429 / 5xx and network errors.
// - Completed `last_response` shapes (collectImages):
//     create-image-pro-flash   images: [{base64,width,height}] (palette-
//                              mapped), original_images: [...] (pre-palette,
//                              kept as `orig_*`), image_url (same image: not
//                              downloaded again)
//     create-object-pro-flash  storage_urls: {south, south-west, west, …}
//     create-character-pro-flash  storage_urls: {direction: url}
//     create-character-with-4-directions  images: {south: {base64}, …}
//     map-objects              image: '<base64>' + storage_url
//     animate-character        one job per direction; images: [{base64}]
//                              + direction
//   so every image keeps a name: '0','1',… or the direction.
// - Billing: job `usage` is {type:'generations', generations} for Pro Flash
//   and objects, but animation jobs report {type:'usd'} although the
//   subscription is charged generations; batch accounting therefore uses
//   the /balance delta (gen.ts) and `estimate` only as a fallback.
// - Concurrency: a process-wide semaphore keeps at most CONCURRENCY (8)
//   background jobs in flight (Tier 2 allows 10); an animate-character call
//   takes one slot per direction it creates.
// - At first use the OpenAPI document is fetched and cached under
//   art/candidates/.openapi.json (gitignored; refreshed when older than a
//   day or with PIXELLAB_REFRESH_OPENAPI=1) and the preset enum strings of
//   prompts.ts are asserted to exist (fail fast, never guess).
// CLI: `node tools/art/pixellab.ts balance` (also `vlr art:balance`),
// `node tools/art/pixellab.ts cost <operation> <w> <h> [n_directions]`.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRESET_ENUMS } from './prompts.ts'

export const BASE = 'https://api.pixellab.ai/v2'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const OPENAPI_CACHE = join(ROOT, 'art/candidates/.openapi.json')

export const POLL_MS = 5000
export const TIMEOUT_MS = 10 * 60 * 1000
export const RETRIES = 3
/** Tier 2 allows 10 concurrent jobs; the client caps at 8 (plan.md §10) */
export const CONCURRENCY = 8

export function hasToken(): boolean {
  return (
    typeof process.env.PIXELLAB_TOKEN === 'string' &&
    process.env.PIXELLAB_TOKEN.trim().length > 0
  )
}

function token(): string {
  const t = process.env.PIXELLAB_TOKEN?.trim()
  if (!t) throw new Error('pixellab: PIXELLAB_TOKEN is not set (.env)')
  return t
}

/** remove any accidental echo of the token from a message */
export function scrub(s: string): string {
  const t = process.env.PIXELLAB_TOKEN?.trim()
  return t ? s.split(t).join('<token>') : s
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class PixelLabError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(scrub(message))
    this.status = status
  }
}

/** one authenticated call with retries on 429 / 5xx / network errors */
export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1))
    let res: Response
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    try {
      res = await fetch(BASE + path, init)
    } catch (err) {
      lastErr = err
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new PixelLabError(
        res.status,
        `${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`,
      )
      continue
    }
    const text = await res.text()
    if (!res.ok) {
      throw new PixelLabError(
        res.status,
        `${method} ${path}: ${res.status} ${text.slice(0, 600)}`,
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }
  throw lastErr instanceof Error
    ? new Error(scrub(lastErr.message))
    : new Error(`pixellab: ${method} ${path} failed`)
}

// ---------------------------------------------------------------------------
// Balance and cost

export interface Balance {
  usd: number
  generations: number
  total: number | null
  plan: string | null
  status: string | null
}

export async function getBalance(): Promise<Balance> {
  const r = await api<{
    credits?: { usd?: number }
    subscription?: {
      generations?: number
      total?: number
      plan?: string | null
      status?: string
    }
  }>('GET', '/balance')
  return {
    usd: r.credits?.usd ?? 0,
    generations: r.subscription?.generations ?? 0,
    total: r.subscription?.total ?? null,
    plan: r.subscription?.plan ?? null,
    status: r.subscription?.status ?? null,
  }
}

/** `vlr art:balance`: prints the balance; exit code 0 / 1 */
export async function balance(): Promise<number> {
  if (!hasToken()) {
    console.log('balance: no PIXELLAB_TOKEN in .env — nothing to check')
    return 0
  }
  try {
    const b = await getBalance()
    console.log(
      `balance: ${b.plan ?? 'no plan'} (${b.status ?? '?'}): ` +
        `${b.generations} generations left` +
        (b.total !== null ? ` of ${b.total}` : '') +
        `, $${b.usd.toFixed(2)} credits`,
    )
    return 0
  } catch (err) {
    console.error(`balance: ${scrub((err as Error).message)}`)
    return 1
  }
}

/** GET /pro-flash/cost: provisional generations of one Pro Flash call */
export async function proFlashCost(
  operation: 'create' | 'edit' | 'inpaint' | 'character' | 'object',
  width: number,
  height: number,
  nDirections?: number,
): Promise<number> {
  const q = new URLSearchParams({
    operation,
    width: String(width),
    height: String(height),
  })
  if (nDirections !== undefined) q.set('n_directions', String(nDirections))
  const r = await api<{ total?: number }>('GET', `/pro-flash/cost?${q}`)
  if (typeof r.total !== 'number') throw new Error('pixellab: cost: no total')
  return r.total
}

// ---------------------------------------------------------------------------
// OpenAPI: cache, request-body validation, enum assertion

interface Schema {
  $ref?: string
  type?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  items?: Schema
  minimum?: number
  maximum?: number
}

interface OpenApi {
  paths?: Record<
    string,
    Record<
      string,
      {
        requestBody?: { content?: Record<string, { schema?: Schema }> }
      }
    >
  >
  components?: { schemas?: Record<string, Schema> }
}

let openApiDoc: OpenApi | null = null

export async function openApi(): Promise<OpenApi> {
  if (openApiDoc) return openApiDoc
  const fresh =
    existsSync(OPENAPI_CACHE) &&
    process.env.PIXELLAB_REFRESH_OPENAPI !== '1' &&
    Date.now() - statSync(OPENAPI_CACHE).mtimeMs < 24 * 3600 * 1000
  if (!fresh) {
    try {
      const res = await fetch(`${BASE}/openapi.json`)
      if (!res.ok) throw new Error(`pixellab: openapi.json ${res.status}`)
      const text = await res.text()
      JSON.parse(text)
      mkdirSync(dirname(OPENAPI_CACHE), { recursive: true })
      writeFileSync(OPENAPI_CACHE, text)
    } catch (err) {
      if (!existsSync(OPENAPI_CACHE)) throw err
    }
  }
  openApiDoc = JSON.parse(readFileSync(OPENAPI_CACHE, 'utf8')) as OpenApi
  return openApiDoc
}

function deref(doc: OpenApi, s: Schema | undefined): Schema | undefined {
  if (!s?.$ref) return s
  return doc.components?.schemas?.[s.$ref.split('/').pop() as string]
}

/** the JSON request schema of POST `endpoint` (null when unknown) */
export async function requestSchema(endpoint: string): Promise<Schema | null> {
  const doc = await openApi()
  const s =
    doc.paths?.[endpoint]?.post?.requestBody?.content?.['application/json']
      ?.schema
  return deref(doc, s) ?? null
}

function enumsOf(doc: OpenApi, node: Schema | undefined, out: Set<string>) {
  const n = deref(doc, node)
  if (!n) return
  if (Array.isArray(n.enum)) for (const v of n.enum) out.add(String(v))
  if (n.const !== undefined) out.add(String(n.const))
  for (const a of n.anyOf ?? []) enumsOf(doc, a, out)
}

/**
 * Validate a request body against the live schema: required fields,
 * unknown fields (every v2 schema forbids them) and enum/const values of
 * top-level string fields. Throws with every problem listed.
 */
export async function validateBody(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<void> {
  const doc = await openApi()
  const s = await requestSchema(endpoint)
  if (!s) throw new Error(`pixellab: ${endpoint} is not in the OpenAPI`)
  const props = s.properties ?? {}
  const problems: string[] = []
  for (const k of s.required ?? []) {
    if (body[k] === undefined) problems.push(`missing ${k}`)
  }
  for (const [k, v] of Object.entries(body)) {
    const p = props[k]
    if (!p) {
      if (s.additionalProperties === false) problems.push(`unknown ${k}`)
      continue
    }
    if (typeof v === 'string' || typeof v === 'number') {
      const allowed = new Set<string>()
      enumsOf(doc, p, allowed)
      if (allowed.size > 0 && !allowed.has(String(v))) {
        problems.push(`${k}='${v}' not in [${[...allowed].join('|')}]`)
      }
    }
  }
  if (problems.length) {
    throw new Error(`pixellab: ${endpoint} body: ${problems.join('; ')}`)
  }
}

/** throws when a preset enum string is not in the live schema */
export async function assertPresetEnums(): Promise<void> {
  const doc = await openApi()
  const missing: string[] = []
  for (const { endpoint, prop, value } of PRESET_ENUMS) {
    const s = await requestSchema(endpoint)
    const vals = new Set<string>()
    enumsOf(doc, s?.properties?.[prop], vals)
    if (!vals.has(value)) missing.push(`${endpoint} ${prop} = '${value}'`)
  }
  if (missing.length) {
    throw new Error(`pixellab: OpenAPI enum drift: ${missing.join('; ')}`)
  }
}

// ---------------------------------------------------------------------------
// Job slots (process-wide concurrency cap)

let inFlight = 0
const waiters: (() => void)[] = []

async function acquire(n = 1): Promise<void> {
  const need = Math.min(n, CONCURRENCY)
  while (inFlight + need > CONCURRENCY) {
    await new Promise<void>((r) => waiters.push(r))
  }
  inFlight += need
}

function release(n = 1): void {
  inFlight -= Math.min(n, CONCURRENCY)
  for (const w of waiters.splice(0)) w()
}

// ---------------------------------------------------------------------------
// Jobs

export interface NamedImage {
  /** '0', '1', … for lists; the direction ('south-east') for rotations */
  name: string
  png: Buffer
  url: string
}

export interface Usage {
  type?: string
  usd?: number | null
  generations?: number | null
}

export interface JobResult {
  endpoint: string
  jobId: string
  status: string
  /** durable ids from the POST answer and the final response */
  ids: {
    object_id?: string
    character_id?: string
    image_id?: string
    source_image_id?: string
    animation_group_id?: string
  }
  images: NamedImage[]
  /** pre-palette originals (Pro Flash create), not candidates */
  originals: NamedImage[]
  usage: Usage
  /** generations billed when the job says so (null: usd-typed usage) */
  generations: number | null
  /** last_response with base64 payloads elided (safe to log) */
  raw: unknown
}

async function download(url: string): Promise<Buffer> {
  let err: unknown = null
  for (let i = 0; i <= RETRIES; i++) {
    if (i > 0) await sleep(1000 * 2 ** i)
    try {
      const res = await fetch(url)
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      err = new Error(`download ${res.status}`)
    } catch (e) {
      err = e
    }
  }
  throw new Error(`pixellab: ${scrub((err as Error).message)} ${url}`)
}

const isB64Img = (v: unknown): v is { base64: string } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { base64?: unknown }).base64 === 'string'

function decodeList(v: unknown): { name: string; b64: string }[] {
  if (Array.isArray(v)) {
    return v
      .filter(isB64Img)
      .map((im, i) => ({ name: String(i), b64: im.base64 }))
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, im]) => isB64Img(im))
      .map(([name, im]) => ({ name, b64: (im as { base64: string }).base64 }))
  }
  return []
}

/** the images of a completed job's last_response, named (see header) */
export async function collectImages(
  last: Record<string, unknown>,
): Promise<{ images: NamedImage[]; originals: NamedImage[] }> {
  const toPng = (
    l: { name: string; b64: string }[],
    prefix = '',
  ): NamedImage[] =>
    l.map((x) => ({
      name: prefix + x.name,
      png: Buffer.from(x.b64, 'base64'),
      url: '',
    }))
  const originals = toPng(decodeList(last.original_images), 'orig_')
  let images: NamedImage[] = toPng(decodeList(last.images))
  if (images.length === 0 && typeof last.image === 'string') {
    images = [
      {
        name: '0',
        png: Buffer.from(last.image, 'base64'),
        url: typeof last.storage_url === 'string' ? last.storage_url : '',
      },
    ]
  }
  const urls = last.storage_urls
  if (images.length === 0 && urls && typeof urls === 'object') {
    for (const [name, url] of Object.entries(urls)) {
      if (typeof url !== 'string') continue
      images.push({ name, png: await download(url), url })
    }
  }
  if (images.length === 0 && typeof last.image_url === 'string') {
    images = [
      { name: '0', png: await download(last.image_url), url: last.image_url },
    ]
  }
  return { images, originals }
}

/** last_response without base64 payloads (for logs) */
export function elide(v: unknown): unknown {
  return JSON.parse(
    scrub(
      JSON.stringify(v, (k, x) =>
        typeof x === 'string' &&
        (k === 'base64' || k === 'image') &&
        x.length > 64
          ? `<${x.length} b64 chars>`
          : x,
      ),
    ),
  )
}

/** poll /background-jobs/{id} until completed / failed / timeout */
export async function poll(
  jobId: string,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: string; usage: Usage; last: Record<string, unknown> }> {
  const t0 = Date.now()
  for (;;) {
    await sleep(POLL_MS)
    const r = await api<{
      status: string
      usage?: Usage | null
      last_response?: Record<string, unknown> | null
    }>('GET', `/background-jobs/${jobId}`)
    if (r.status === 'completed' || r.status === 'failed') {
      return {
        status: r.status,
        usage: r.usage ?? {},
        last: r.last_response ?? {},
      }
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`pixellab: job ${jobId} timed out (${r.status})`)
    }
  }
}

const ID_KEYS = [
  'object_id',
  'character_id',
  'image_id',
  'source_image_id',
  'animation_group_id',
] as const

function pickIds(...objs: Record<string, unknown>[]): JobResult['ids'] {
  const ids: JobResult['ids'] = {}
  for (const o of objs) {
    for (const k of ID_KEYS) {
      if (typeof o[k] === 'string' && o[k]) ids[k] = o[k] as string
    }
  }
  return ids
}

function billed(u: Usage): number | null {
  return u.type === 'generations' && typeof u.generations === 'number'
    ? u.generations
    : null
}

async function finish(
  endpoint: string,
  jobId: string,
  post: Record<string, unknown>,
): Promise<JobResult> {
  const done = await poll(jobId)
  if (done.status !== 'completed') {
    const why = JSON.stringify(elide(done.last)).slice(0, 400)
    throw new Error(`pixellab: ${endpoint} job ${jobId} ${done.status} ${why}`)
  }
  const { images, originals } = await collectImages(done.last)
  if (images.length === 0) {
    throw new Error(`pixellab: ${endpoint} job ${jobId} returned no images`)
  }
  return {
    endpoint,
    jobId,
    status: done.status,
    ids: pickIds(post, done.last),
    images,
    originals,
    usage: done.usage,
    generations: billed(done.usage),
    raw: elide(done.last),
  }
}

/** POST an endpoint, poll its background job, download the images */
export async function runJob(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<JobResult> {
  await validateBody(endpoint, body)
  await acquire(1)
  try {
    const r = await api<Record<string, unknown>>('POST', endpoint, body)
    const jobId = String(r.background_job_id ?? r.job_id ?? '')
    if (!jobId) {
      // synchronous endpoints answer with the images directly
      const { images, originals } = await collectImages(r)
      const usage = (r.usage as Usage | null) ?? {}
      return {
        endpoint,
        jobId: '',
        status: 'completed',
        ids: pickIds(r),
        images,
        originals,
        usage,
        generations: billed(usage),
        raw: elide(r),
      }
    }
    return await finish(endpoint, jobId, r)
  } finally {
    release(1)
  }
}

/**
 * POST /animate-character (template mode: one background job per
 * direction); returns one JobResult per direction, images named '0'..'n-1'
 * and `ids.animation_group_id` set.
 */
export async function animateCharacter(
  body: Record<string, unknown> & { directions: string[] },
): Promise<(JobResult & { direction: string })[]> {
  const endpoint = '/animate-character'
  await validateBody(endpoint, body)
  const n = body.directions.length
  await acquire(n)
  try {
    const r = await api<{
      background_job_ids: string[]
      directions: string[]
      animation_group_id?: string
    }>('POST', endpoint, body)
    return await Promise.all(
      r.background_job_ids.map(async (id, i) => {
        const res = await finish(endpoint, id, r as Record<string, unknown>)
        const dir =
          (res.raw as { direction?: string }).direction ??
          r.directions[i] ??
          String(i)
        return { ...res, direction: dir }
      }),
    )
  } finally {
    release(n)
  }
}

export function getObject(id: string): Promise<Record<string, unknown>> {
  return api('GET', `/objects/${id}`)
}

export function getCharacter(id: string): Promise<Record<string, unknown>> {
  return api('GET', `/characters/${id}`)
}

const b64 = (png: Buffer) => ({
  type: 'base64',
  base64: png.toString('base64'),
  format: 'png',
})

export function base64Image(png: Buffer): Record<string, string> {
  return b64(png)
}

// Endpoint wrappers (bodies per the v2 OpenAPI request schemas)
export const proFlash = (body: Record<string, unknown>) =>
  runJob('/create-image-pro-flash', body)
export const editProFlash = (body: Record<string, unknown>) =>
  runJob('/edit-image-pro-flash', body)
export const withStyle = (body: Record<string, unknown>) =>
  runJob('/generate-with-style-v2', body)
export const objectProFlash = (body: Record<string, unknown>) =>
  runJob('/create-object-pro-flash', body)
export const object8 = (body: Record<string, unknown>) =>
  runJob('/create-8-direction-object', body)
export const mapObject = (body: Record<string, unknown>) =>
  runJob('/map-objects', body)
export const characterProFlash = (body: Record<string, unknown>) =>
  runJob('/create-character-pro-flash', body)
export const character = (body: Record<string, unknown>) =>
  runJob('/create-character-with-4-directions', body)
export const reduceColors = (body: Record<string, unknown>) =>
  runJob('/reduce-colors', body)
export const removeBackground = (body: Record<string, unknown>) =>
  runJob('/remove-background', body)

/** run tasks with at most `limit` in flight */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i] as T, i)
      }
    },
  )
  await Promise.all(workers)
  return out
}

/** StepRun shape for build.ts (`balance` falls back to run) */
export function run(): Promise<number> {
  return balance()
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const [cmd = 'balance', ...rest] = process.argv.slice(2)
  if (cmd === 'balance') {
    balance().then((code) => {
      process.exitCode = code
    })
  } else if (cmd === 'cost' && rest.length >= 3) {
    const [op, w, h, n] = rest
    proFlashCost(
      op as 'create',
      Number(w),
      Number(h),
      n === undefined ? undefined : Number(n),
    ).then(
      (c) => console.log(`cost: ${op} ${w}x${h}${n ? ` n=${n}` : ''}: ${c}`),
      (err: Error) => {
        console.error(`cost: ${scrub(err.message)}`)
        process.exitCode = 1
      },
    )
  } else {
    console.error(
      'usage: node tools/art/pixellab.ts balance | cost <op> <w> <h> [n]',
    )
    process.exitCode = 1
  }
}
