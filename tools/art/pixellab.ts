// PixelLab REST v2 client (style-guide.md §3.3, plan.md §10 "PixelLab
// status"). No SDK: fetch + poll.
// - base https://api.pixellab.ai/v2, `Authorization: Bearer
//   ${process.env.PIXELLAB_TOKEN}`. The token is never printed, logged or
//   written anywhere; error messages strip it.
// - GET /balance; POST /create-image-pro-flash, /generate-with-style-v2,
//   /create-object-pro-flash, /create-8-direction-object, /map-objects,
//   /create-character-with-4-directions, /edit-image-pro-flash,
//   /reduce-colors, /remove-background; GET /background-jobs/{id} polled
//   every 4 s with a 10 min timeout; 3 retries with backoff on 429 / 5xx.
// - Result images (base64 in last_response, or unauthenticated UUID URLs)
//   are extracted and returned as PNG buffers; callers write and hash them
//   immediately.
// - At first use the OpenAPI document is fetched and cached under
//   art/candidates/.openapi.json (gitignored) and the preset enum strings of
//   prompts.ts are asserted to exist (fail fast, never guess).
// CLI: `node tools/art/pixellab.ts balance` (also `vlr art:balance`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRESET_ENUMS } from './prompts.ts'

export const BASE = 'https://api.pixellab.ai/v2'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const OPENAPI_CACHE = join(ROOT, 'art/candidates/.openapi.json')

export const POLL_MS = 4000
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
function scrub(s: string): string {
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

/** one authenticated call with retries on 429 / 5xx */
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
        `${method} ${path}: ${res.status}`,
      )
      continue
    }
    const text = await res.text()
    if (!res.ok) {
      throw new PixelLabError(
        res.status,
        `${method} ${path}: ${res.status} ${text.slice(0, 300)}`,
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }
  throw lastErr instanceof Error
    ? new Error(scrub(lastErr.message))
    : new Error(`pixellab: ${method} ${path} failed`)
}

// ---------------------------------------------------------------------------
// Balance

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

// ---------------------------------------------------------------------------
// OpenAPI enum assertion

interface OpenApi {
  components?: {
    schemas?: Record<string, { properties?: Record<string, unknown> }>
  }
}

export async function openApi(): Promise<OpenApi> {
  if (existsSync(OPENAPI_CACHE)) {
    return JSON.parse(readFileSync(OPENAPI_CACHE, 'utf8')) as OpenApi
  }
  const res = await fetch(`${BASE}/openapi.json`)
  if (!res.ok) throw new Error(`pixellab: openapi.json ${res.status}`)
  const text = await res.text()
  mkdirSync(dirname(OPENAPI_CACHE), { recursive: true })
  writeFileSync(OPENAPI_CACHE, text)
  return JSON.parse(text) as OpenApi
}

function enumsOf(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  if (Array.isArray(n.enum)) for (const v of n.enum) out.add(String(v))
  for (const v of Object.values(n)) enumsOf(v, out)
}

/** throws when a preset enum string is not in the live schema */
export async function assertPresetEnums(): Promise<void> {
  const doc = await openApi()
  const schemas = doc.components?.schemas ?? {}
  const missing: string[] = []
  for (const { schema, prop, value } of PRESET_ENUMS) {
    const s = schemas[schema]?.properties?.[prop]
    const vals = new Set<string>()
    enumsOf(s, vals)
    if (!vals.has(value)) missing.push(`${schema}.${prop} = '${value}'`)
  }
  if (missing.length) {
    throw new Error(`pixellab: OpenAPI enum drift: ${missing.join('; ')}`)
  }
}

// ---------------------------------------------------------------------------
// Jobs

export interface JobResult {
  jobId: string
  status: string
  images: { png: Buffer; url: string }[]
  usage: { type?: string; usd?: number | null; generations?: number | null }
  raw: unknown
}

/** collect base64 images and image URLs anywhere in a response object */
export async function extractImages(
  obj: unknown,
): Promise<{ png: Buffer; url: string }[]> {
  const out: { png: Buffer; url: string }[] = []
  const urls: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      for (const x of n) walk(x)
      return
    }
    const o = n as Record<string, unknown>
    if (typeof o.base64 === 'string' && o.base64.length > 32) {
      out.push({ png: Buffer.from(o.base64, 'base64'), url: '' })
    }
    for (const [k, v] of Object.entries(o)) {
      if (
        typeof v === 'string' &&
        /^https?:\/\//.test(v) &&
        (/\.png(\?|$)/i.test(v) || /url/i.test(k))
      ) {
        urls.push(v)
      } else walk(v)
    }
  }
  walk(obj)
  for (const url of urls) {
    const res = await fetch(url)
    if (res.ok) out.push({ png: Buffer.from(await res.arrayBuffer()), url })
  }
  return out
}

/** poll /background-jobs/{id} until completed / failed / timeout */
export async function poll(
  jobId: string,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: string; usage: JobResult['usage']; last: unknown }> {
  const t0 = Date.now()
  for (;;) {
    const r = await api<{
      status: string
      usage?: JobResult['usage'] | null
      last_response?: unknown
    }>('GET', `/background-jobs/${jobId}`)
    if (r.status === 'completed' || r.status === 'failed') {
      return { status: r.status, usage: r.usage ?? {}, last: r.last_response }
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`pixellab: job ${jobId} timed out`)
    }
    await sleep(POLL_MS)
  }
}

/** POST an endpoint, poll its background job, download the images */
export async function runJob(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<JobResult> {
  const r = await api<Record<string, unknown>>('POST', endpoint, body)
  const jobId = String(r.background_job_id ?? r.job_id ?? '')
  if (!jobId) {
    // synchronous endpoints answer with the images directly
    return {
      jobId: '',
      status: 'completed',
      images: await extractImages(r),
      usage: (r.usage as JobResult['usage']) ?? {},
      raw: r,
    }
  }
  const done = await poll(jobId)
  if (done.status !== 'completed') {
    throw new Error(`pixellab: job ${jobId} ${done.status}`)
  }
  return {
    jobId,
    status: done.status,
    images: await extractImages(done.last),
    usage: done.usage,
    raw: done.last,
  }
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
export const character = (body: Record<string, unknown>) =>
  runJob('/create-character-with-4-directions', body)
export const reduceColors = (body: Record<string, unknown>) =>
  runJob('/reduce-colors', body)
export const removeBackground = (body: Record<string, unknown>) =>
  runJob('/remove-background', body)

/** run tasks with at most `limit` in flight (CONCURRENCY) */
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
  const cmd = process.argv[2] ?? 'balance'
  if (cmd !== 'balance') {
    console.error('usage: node tools/art/pixellab.ts balance')
    process.exitCode = 1
  } else {
    balance().then((code) => {
      process.exitCode = code
    })
  }
}
