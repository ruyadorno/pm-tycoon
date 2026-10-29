// Record vision-pass decisions for the PixelLab bulk pass (art agent only;
// staging: writes art/candidates/{choices,scores,gen-log}.json, never the
// manifest or art/final).
//
//   node tools/art/decide.ts <decisions.json>
//
// decisions.json: { "<id>": { "choose": <n> | "procedural", "score": 8,
//   "reason": "one line", "scores": { "<n>": [7, "why"], … },
//   "t2Edit"?: <k> } }
// - choose n: choices[id] = { candidate, path, score, reason, approvedBy:
//   'agent', provisional: true, approved: <anchor ? true : false> } — §5:
//   only anchors are agent-approved; bulk choices stay approved:false until
//   the author's gate (chosenCandidate + placeholder:false at install).
// - choose 'procedural': choices[id] = { keep: 'procedural', reason }.
// - every other candidate with a score line becomes a gen-log reject
//   { candidate, reason, by: 'claude', at } (once per candidate).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHOICES,
  GEN_LOG,
  type GenLogFile,
  candidatePath,
  loadChoices,
} from './gen.ts'
import { ROOT, loadManifest } from './manifest.ts'
import { promptFor } from './prompts.ts'

const SCORES = join(ROOT, 'art/candidates/scores.json')

interface Decision {
  choose: number | 'procedural'
  score?: number
  reason: string
  scores?: Record<string, [number, string]>
  t2Edit?: number
}

const file = process.argv[2]
if (!file) {
  console.error('usage: node tools/art/decide.ts <decisions.json>')
  process.exit(1)
}
const decisions = JSON.parse(readFileSync(file, 'utf8')) as Record<
  string,
  Decision
>
const m = loadManifest()
const choices = loadChoices() as Record<string, unknown>
const scores = (
  existsSync(SCORES)
    ? JSON.parse(readFileSync(SCORES, 'utf8'))
    : { candidates: {} }
) as { candidates: Record<string, Record<string, unknown>> }
const log = JSON.parse(readFileSync(GEN_LOG, 'utf8')) as GenLogFile
const at = new Date().toISOString()

for (const [id, d] of Object.entries(decisions)) {
  const e = m.entries.find((x) => x.id === id)
  if (!e) throw new Error(`decide: unknown id ${id}`)
  if (d.choose === 'procedural') {
    choices[id] = { keep: 'procedural', reason: d.reason }
  } else {
    const n = d.choose
    const single = e.frames.length === 1
    const path = single
      ? candidatePath(id, n, e.frames[0]).replace(ROOT, '')
      : `art/candidates/${id}/${n}`
    // a follow-up frame (wh_ext _t2, an edit of the chosen _t1) is made
    // after the choice: `vlr art:gen -- --staging --edit --ids <id>`
    const follow = promptFor(e).followUp?.frame
    for (const f of e.frames) {
      if (existsSync(candidatePath(id, n, f))) continue
      if (f === follow) {
        console.log(`decide: ${id}#${n}: ${f} pending (run --edit)`)
        continue
      }
      throw new Error(`decide: ${id}#${n} lacks frame ${f || "''"}`)
    }
    choices[id] = {
      candidate: n,
      path,
      score: d.score ?? d.scores?.[String(n)]?.[0] ?? 0,
      reason: d.reason,
      approvedBy: 'agent',
      provisional: true,
      approved: e.anchorRole === 'anchor',
      ...(d.t2Edit === undefined ? {} : { t2Edit: d.t2Edit }),
    }
  }
  const sc: Record<string, unknown> = (scores.candidates[id] ??= {})
  const slot = (log.entries[id] ??= { gen: [], rejects: [] })
  for (const [k, [s, why]] of Object.entries(d.scores ?? {})) {
    const chosen = d.choose === Number(k)
    sc[k] = { score: s, reason: chosen ? `CHOSEN — ${why}` : why }
    if (
      !chosen &&
      !slot.rejects.some(
        (r) =>
          r.candidate === Number(k) &&
          r.by === 'claude' &&
          !r.reason.startsWith('lint:'),
      )
    ) {
      slot.rejects.push({ candidate: Number(k), reason: why, by: 'claude', at })
    }
  }
  console.log(
    `decide: ${id} -> ${d.choose === 'procedural' ? 'KEEP-PROCEDURAL' : `#${d.choose}`} (${d.reason.slice(0, 80)})`,
  )
}
writeFileSync(CHOICES, `${JSON.stringify(choices, null, 1)}\n`)
writeFileSync(SCORES, `${JSON.stringify(scores, null, 1)}\n`)
writeFileSync(GEN_LOG, `${JSON.stringify(log, null, 1)}\n`)
