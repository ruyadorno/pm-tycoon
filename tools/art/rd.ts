// Retro Diffusion fallback (art-pipeline.md recipe §4, style-guide.md
// §3.1): inactive unless RD_API_KEY is set, and not used in playtest 1
// unless the author asks. REST v2: POST /v2/inferences with X-RD-Token and
// a persisted Idempotency-Key, check_cost dry run first, poll
// GET /v2/inferences/tasks/{task_id}; GET /v2/inferences/credits before a
// batch; hard USD cap per run (RD_USD_CAP, default 5). The key is never
// printed.

import { randomUUID } from 'node:crypto'
import type { StepOpts } from './draw-api.ts'

export const RD_BASE = 'https://api.retrodiffusion.ai/v2'
export const USD_CAP = Number(process.env.RD_USD_CAP ?? 5)

export function active(): boolean {
  return (process.env.RD_API_KEY ?? '').trim().length > 0
}

async function rd<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const key = (process.env.RD_API_KEY ?? '').trim()
  if (!key) throw new Error('rd: RD_API_KEY is not set')
  const headers: Record<string, string> = {
    'X-RD-Token': key,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(RD_BASE + path, init)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `rd: ${method} ${path}: ${res.status} ${text.slice(0, 200)}`,
    )
  }
  return JSON.parse(text) as T
}

export function credits(): Promise<unknown> {
  return rd('GET', '/inferences/credits')
}

/** dry-run cost of an inference (check_cost: true) */
export function cost(body: Record<string, unknown>): Promise<unknown> {
  return rd('POST', '/inferences', { ...body, check_cost: true })
}

export function infer(
  body: Record<string, unknown>,
  idempotencyKey: string = randomUUID(),
): Promise<unknown> {
  return rd('POST', '/inferences', body, idempotencyKey)
}

export function task(taskId: string): Promise<unknown> {
  return rd('GET', `/inferences/tasks/${taskId}`)
}

export function run(opts: StepOpts): number {
  void opts
  console.log(
    active()
      ? 'rd: RD_API_KEY present — Retro Diffusion available as a fallback ' +
          `(USD cap ${USD_CAP}); not used in playtest 1 unless asked`
      : 'rd: inactive (no RD_API_KEY)',
  )
  return 0
}
