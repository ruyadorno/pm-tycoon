// `node tools/art/install.ts` — install the staged PixelLab choices
// (art/candidates/choices.json + gen-log.json, written by `vlr art:gen --
// --staging`) into art/manifest.json and art/final (.logs/handoff/
// pixellab.json "INSTALL PROCEDURE" parts 1-2; style-guide.md §3.5, §4.4,
// §5). No network, idempotent (re-running changes nothing):
// - every entry with a gen-log record gets its gen[] / rejects[] merged
//   (records already in the manifest are skipped);
// - a choice with a `candidate` n copies art/candidates/<id>/<n>/<stem>.png
//   (stem 'base' for the '' suffix, else the suffix without its '_') to
//   art/final/<class>/<id><suffix>.png and sets chosenCandidate = n,
//   placeholder false and finalSha256; approved / approvedBy 'agent' only for
//   anchorRole 'anchor' (G2, provisional) — every other choice stays
//   approved:false for the author's gate; the choice's smokeAnchors (the
//   re-measured chimney tops) replace the manifest's;
// - a { keep: 'procedural' } choice keeps its placeholder final untouched
//   (only the log merge applies);
// - the gen-log batches[] are appended to manifest.batches.
// Then run `vlr art:build` (variants derive _locked from the new finals,
// atlas regenerates frames.generated.ts / SMOKE_ANCHORS).

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { frameStem } from './candidates.ts'
import { CHOICES, GEN_LOG, type GenLogFile, candidateDir } from './gen.ts'
import { writeIfChanged } from './iso.ts'
import {
  type Batch,
  type GenLog,
  type Manifest,
  type ManifestEntry,
  type RejectLog,
  finalPath,
  frameSetSha256,
  loadManifest,
  saveManifest,
  validateManifest,
} from './manifest.ts'

type InstallChoice =
  | {
      candidate: number
      path: string
      smokeAnchors?: [number, number][]
    }
  | { keep: 'procedural'; reason: string }

export interface InstallReport {
  installed: string[]
  kept: string[]
  framesWritten: number
  genMerged: number
  rejectsMerged: number
  batchesMerged: number
  approved: string[]
  smoke: string[]
  errors: string[]
}

const genKey = (g: GenLog): string =>
  `${g.jobId}|${g.candidate}|${g.sha256}|${g.at}`
const rejectKey = (r: RejectLog): string =>
  `${r.candidate}|${r.by}|${r.at}|${r.reason}`
const batchKey = (b: Batch): string => `${b.at}|${b.tool}|${b.ids.join(',')}`

/** source PNG of frame `suffix` of candidate n */
export function chosenFramePath(id: string, n: number, suffix: string): string {
  return `${candidateDir(id, n)}/${frameStem(suffix)}.png`
}

function mergeLog(
  e: ManifestEntry,
  log: GenLogFile['entries'][string] | undefined,
  r: InstallReport,
): void {
  if (!log) return
  const gens = new Set(e.gen.map(genKey))
  for (const g of log.gen) {
    if (gens.has(genKey(g))) continue
    e.gen.push(g)
    gens.add(genKey(g))
    r.genMerged++
  }
  const rejs = new Set(e.rejects.map(rejectKey))
  for (const x of log.rejects) {
    if (rejs.has(rejectKey(x))) continue
    e.rejects.push(x)
    rejs.add(rejectKey(x))
    r.rejectsMerged++
  }
}

function installEntry(
  e: ManifestEntry,
  c: Extract<InstallChoice, { candidate: number }>,
  r: InstallReport,
): void {
  const n = c.candidate
  const srcs = e.frames.map((f) => chosenFramePath(e.id, n, f))
  const missing = srcs.filter((p) => !existsSync(p))
  if (missing.length > 0) {
    r.errors.push(`${e.id}: candidate ${n} lacks ${missing.join(', ')}`)
    return
  }
  e.frames.forEach((f, i) => {
    const buf = readFileSync(srcs[i] as string)
    if (writeIfChanged(finalPath(e, e.id + f), buf)) r.framesWritten++
  })
  e.chosenCandidate = n
  e.placeholder = false
  e.finalSha256 = frameSetSha256(e) ?? undefined
  if (e.anchorRole === 'anchor') {
    e.approved = true
    e.approvedBy = 'agent'
    r.approved.push(e.id)
  } else {
    e.approved = false
    delete e.approvedBy
  }
  if (c.smokeAnchors?.length) {
    e.smokeAnchors = c.smokeAnchors.map(([x, y]) => [x, y])
    r.smoke.push(`${e.id} ${JSON.stringify(e.smokeAnchors)}`)
  }
  r.installed.push(`${e.id}:${n}`)
}

export function install(
  m: Manifest,
  choices: Record<string, InstallChoice>,
  log: GenLogFile,
): InstallReport {
  const r: InstallReport = {
    installed: [],
    kept: [],
    framesWritten: 0,
    genMerged: 0,
    rejectsMerged: 0,
    batchesMerged: 0,
    approved: [],
    smoke: [],
    errors: [],
  }
  const ids = new Set(m.entries.map((e) => e.id))
  for (const id of Object.keys(choices)) {
    if (!ids.has(id)) r.errors.push(`choices.json: unknown id ${id}`)
  }
  for (const e of m.entries) {
    mergeLog(e, log.entries[e.id], r)
    const c = choices[e.id]
    if (!c) continue
    if (e.source !== 'pixellab') {
      r.errors.push(`${e.id}: choice for a procedural entry`)
      continue
    }
    if ('keep' in c) r.kept.push(e.id)
    else installEntry(e, c, r)
  }
  const batches = new Set(m.batches.map(batchKey))
  for (const b of log.batches) {
    if (batches.has(batchKey(b))) continue
    m.batches.push(b)
    batches.add(batchKey(b))
    r.batchesMerged++
  }
  return r
}

export function run(): number {
  const m = loadManifest()
  const choices = JSON.parse(readFileSync(CHOICES, 'utf8')) as Record<
    string,
    InstallChoice
  >
  const log = JSON.parse(readFileSync(GEN_LOG, 'utf8')) as GenLogFile
  const r = install(m, choices, log)
  const schema = validateManifest(m)
  for (const s of [...r.errors, ...schema]) console.error(`install: ${s}`)
  if (r.errors.length || schema.length) return 1
  const changed = saveManifest(m)
  console.log(
    `install: ${r.installed.length} chosen candidates (${r.framesWritten} ` +
      `final PNGs changed), ${r.kept.length} KEEP-PROCEDURAL ` +
      `(${r.kept.join(', ')}); agent-approved anchors: ${r.approved.join(', ')}; ` +
      `merged ${r.genMerged} gen, ${r.rejectsMerged} rejects, ` +
      `${r.batchesMerged} batches${changed ? ' (manifest updated)' : ' (manifest unchanged)'}`,
  )
  for (const s of r.smoke) console.log(`install: smokeAnchors ${s}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = run()
}
