// Record vision-pass decisions (art agent only).
//
//   node tools/art/decide.ts <decisions.json>             staging (playtest 1)
//   node tools/art/decide.ts --manifest <decisions.json>  build 2: manifest
//   node tools/art/decide.ts --retire <id>[=<new>,<new>] …
//
// decisions.json: { "<id>": { "choose": <n> | "procedural", "score": 8,
//   "reason": "one line", "scores": { "<n>": [7, "why"], … },
//   "t2Edit"?: <k> } }
//
// Staging (default; writes art/candidates/{choices,scores,gen-log}.json,
// never the manifest or art/final):
// - choose n: choices[id] = { candidate, path, score, reason, approvedBy:
//   'agent', provisional: true, approved: <anchor ? true : false> } — §5:
//   only anchors are agent-approved; bulk choices stay approved:false until
//   the author's gate (chosenCandidate + placeholder:false at install).
// - choose 'procedural': choices[id] = { keep: 'procedural', reason }.
// - every other candidate with a score line becomes a gen-log reject
//   { candidate, reason, by: 'claude', at } (once per candidate).
//
// --manifest (build 2, non-staging `vlr art:gen`, whose gen[] / batches are
// already in the manifest): the same decisions go straight into
// art/manifest.json — choose n sets chosenCandidate = n (installed into
// art/final by the next `vlr art:gen`, offline or not), approved stays
// false and approvedBy is cleared, so the author's gate (G4) decides; the
// pick's reason goes into the entry's note; t2Edit sets editPick; every
// other scored candidate becomes a reject by 'claude'. `vlr art:approve`
// is the author's command (it records approvedBy 'author') and is not used
// for agent picks. choose 'procedural' keeps the placeholder.
//
// --retire id[=replacement,…]: moves a rejected entry into the manifest's
// retired[] (its gen[] / rejects[] kept for provenance, the reason = its
// last reject) and deletes its finals (base + variants). Run after
// `vlr art:reject -- <id> "<reason>"` and with the replacement rows added,
// so every building stays covered (A13).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHOICES,
  GEN_LOG,
  type GenLogFile,
  candidatePath,
  loadChoices,
} from './gen.ts'
import {
  ROOT,
  getEntry,
  loadManifest,
  retire,
  retiredFinals,
  saveManifest,
} from './manifest.ts'
import { promptFor } from './prompts.ts'

const SCORES = join(ROOT, 'art/candidates/scores.json')

interface Decision {
  choose: number | 'procedural'
  score?: number
  reason: string
  scores?: Record<string, [number, string]>
  t2Edit?: number
}

function readScores(): {
  candidates: Record<string, Record<string, unknown>>
} {
  return existsSync(SCORES)
    ? (JSON.parse(readFileSync(SCORES, 'utf8')) as {
        candidates: Record<string, Record<string, unknown>>
      })
    : { candidates: {} }
}

/** the candidate's frames on disk (a pending follow-up frame is allowed) */
function checkFrames(
  id: string,
  n: number,
  frames: string[],
  follow: string | undefined,
): void {
  for (const f of frames) {
    if (existsSync(candidatePath(id, n, f))) continue
    if (f === follow) {
      console.log(`decide: ${id}#${n}: ${f} pending (run --edit)`)
      continue
    }
    throw new Error(`decide: ${id}#${n} lacks frame ${f || "''"}`)
  }
}

function staging(decisions: Record<string, Decision>): void {
  const m = loadManifest()
  const choices = loadChoices() as Record<string, unknown>
  const scores = readScores()
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
      checkFrames(id, n, e.frames, promptFor(e).followUp?.frame)
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
        slot.rejects.push({
          candidate: Number(k),
          reason: why,
          by: 'claude',
          at,
        })
      }
    }
    console.log(
      `decide: ${id} -> ${d.choose === 'procedural' ? 'KEEP-PROCEDURAL' : `#${d.choose}`} (${d.reason.slice(0, 80)})`,
    )
  }
  writeFileSync(CHOICES, `${JSON.stringify(choices, null, 1)}\n`)
  writeFileSync(SCORES, `${JSON.stringify(scores, null, 1)}\n`)
  writeFileSync(GEN_LOG, `${JSON.stringify(log, null, 1)}\n`)
}

function intoManifest(decisions: Record<string, Decision>): void {
  const m = loadManifest()
  const scores = readScores()
  const at = new Date().toISOString()
  for (const [id, d] of Object.entries(decisions)) {
    const e = getEntry(m, id)
    if (d.choose === 'procedural') {
      e.placeholder = e.source === 'pixellab'
      delete e.chosenCandidate
      delete e.editPick
      e.note = `agent (${at.slice(0, 10)}): kept procedural — ${d.reason}`
    } else {
      const n = d.choose
      checkFrames(id, n, e.frames, promptFor(e).followUp?.frame)
      e.chosenCandidate = n
      e.approved = false
      delete e.approvedBy
      if (d.t2Edit !== undefined) e.editPick = d.t2Edit
      e.note = `agent pick #${n} (${at.slice(0, 10)}): ${d.reason}`
    }
    const sc: Record<string, unknown> = (scores.candidates[id] ??= {})
    for (const [k, [s, why]] of Object.entries(d.scores ?? {})) {
      const chosen = d.choose === Number(k)
      sc[k] = { score: s, reason: chosen ? `CHOSEN — ${why}` : why }
      if (
        !chosen &&
        !e.rejects.some(
          (r) =>
            r.candidate === Number(k) &&
            r.by === 'claude' &&
            !r.reason.startsWith('lint:'),
        )
      ) {
        e.rejects.push({ candidate: Number(k), reason: why, by: 'claude', at })
      }
    }
    console.log(
      `decide: ${id} -> ${d.choose === 'procedural' ? 'KEEP-PROCEDURAL' : `#${d.choose}`} (${d.reason.slice(0, 80)})`,
    )
  }
  saveManifest(m)
  writeFileSync(SCORES, `${JSON.stringify(scores, null, 1)}\n`)
}

function retireIds(specs: string[]): void {
  const m = loadManifest()
  for (const spec of specs) {
    const [id, repl] = spec.split('=') as [string, string | undefined]
    const e = getEntry(m, id)
    const last = e.rejects.at(-1)
    if (!last) throw new Error(`decide: --retire ${id}: reject it first`)
    const files = retiredFinals(e)
    retire(m, id, last.reason, repl ? repl.split(',') : [])
    let n = 0
    for (const f of files) {
      if (!existsSync(f)) continue
      rmSync(f)
      n++
    }
    console.log(`decide: retired ${id} (${last.reason}); ${n} finals deleted`)
  }
  saveManifest(m)
}

const args = process.argv.slice(2)
if (args[0] === '--retire' && args.length > 1) {
  retireIds(args.slice(1))
} else {
  const manifest = args[0] === '--manifest'
  const file = manifest ? args[1] : args[0]
  if (!file) {
    console.error(
      'usage: node tools/art/decide.ts [--manifest] <decisions.json> | ' +
        '--retire <id>[=<new>,…] …',
    )
    process.exit(1)
  }
  const decisions = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    Decision
  >
  if (manifest) intoManifest(decisions)
  else staging(decisions)
}
