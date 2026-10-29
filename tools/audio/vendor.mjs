// `vlr audio:vendor` (audio.md §8.1): vendors the FluidR3_GM note set pre-rendered by gleitz/midi-js-soundfonts
// into public/audio/sf/<instrument>/<Note>.mp3, writes one SmplrPreset per instrument and the CC-BY 3.0 notice.
// Run once; the output is committed. Flags:
//   --step N        sampling step in semitones (default 3; 1 = every semitone)
//   --only a,b      only (re)vendor these gleitz ids; the other instruments are left as they are
//   --force         re-download files that already exist
//   --check         no network: verify presets + files exist and the total stays within the budget
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = 'public/audio/sf'
const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'
const BUDGET_BYTES = 3_000_000 // audio.md §8.1: `vlr check` fails above 3 MB
// gleitz id, part names, vendored midi range (audio.md §8.1 table)
const INSTRUMENTS = [
  { id: 'acoustic_grand_piano', parts: 'piano, piano2', lo: 36, hi: 84 },
  { id: 'acoustic_bass', parts: 'bass, bass2', lo: 28, hi: 55 },
  { id: 'vibraphone', parts: 'vibes, vibes2', lo: 60, hi: 84 },
  { id: 'muted_trumpet', parts: 'trumpet, trumpet2', lo: 55, hi: 84 },
]
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export const LICENSE_TEXT = `Instrument samples in this directory

FluidR3_GM SoundFont by Frank Wen, as pre-rendered by Benjamin Gleitzman's
midi-js-soundfonts (https://github.com/gleitz/midi-js-soundfonts), Creative Commons Attribution 3.0
(https://creativecommons.org/licenses/by/3.0/us/). Instruments used: Acoustic Grand Piano, Acoustic Bass,
Vibraphone, Muted Trumpet. Vendored note ranges in public/audio/sf/.

Files: public/audio/sf/<instrument>/<Note>.mp3 (note names use flats, e.g. Db4) and
public/audio/sf/<instrument>.preset.json (generated SmplrPreset, smplr 1.1.0 format) written by
tools/audio/vendor.mjs. The samples are unmodified copies of the gleitz mp3 renders.
`

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

export function midiToFlatName(midi) {
  return `${FLATS[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Sample pitches for a range at a step; the top of the range is always included. */
export function samplePitches(lo, hi, step) {
  const out = []
  for (let m = lo; m <= hi; m += step) out.push(m)
  if (out[out.length - 1] !== hi) out.push(hi)
  return out
}

/** Regions split at the midpoint between neighbouring samples; the ends extend by half a step. */
export function presetFor(id, pitches, step) {
  const half = Math.floor(step / 2)
  const regions = pitches.map((pitch, i) => {
    const prev = pitches[i - 1]
    const next = pitches[i + 1]
    const low =
      prev === undefined
        ? Math.max(0, pitch - half)
        : prev + Math.floor((pitch - prev) / 2) + 1
    const high =
      next === undefined
        ? Math.min(127, pitch + half)
        : pitch + Math.floor((next - pitch) / 2)
    return { sample: midiToFlatName(pitch), pitch, keyRange: [low, high] }
  })
  return {
    meta: {
      name: id,
      license: 'CC-BY-3.0',
      source: 'gleitz/midi-js-soundfonts FluidR3_GM',
    },
    samples: { baseUrl: `./${id}/`, formats: ['mp3'] },
    groups: [{ regions }],
  }
}

function isMp3(buf) {
  if (buf.length < 4) return false
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true // ID3
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 // MPEG frame sync
}

async function download(url, dest) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (!isMp3(buf)) throw new Error('not an mp3 payload')
      await writeFile(dest, buf)
      return buf.length
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(`${url}: ${lastErr?.message ?? lastErr}`)
}

async function pool(items, limit, fn) {
  const queue = [...items]
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) await fn(queue.shift())
  })
  await Promise.all(workers)
}

function dirBytes(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    total += st.isDirectory() ? dirBytes(p) : st.size
  }
  return total
}

function fmt(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1e6).toFixed(2)} MB)`
}

async function check() {
  const problems = []
  for (const inst of INSTRUMENTS) {
    const presetPath = join(OUT, `${inst.id}.preset.json`)
    if (!existsSync(presetPath)) {
      problems.push(`missing ${presetPath}`)
      continue
    }
    const preset = JSON.parse(await readFile(presetPath, 'utf8'))
    for (const r of preset.groups.flatMap((g) => g.regions)) {
      const f = join(OUT, inst.id, `${r.sample}.mp3`)
      if (!existsSync(f) || statSync(f).size === 0)
        problems.push(`missing ${f}`)
    }
  }
  if (!existsSync(join(OUT, 'LICENSE.txt')))
    problems.push(`missing ${OUT}/LICENSE.txt`)
  const total = dirBytes(OUT)
  if (total > BUDGET_BYTES)
    problems.push(`${OUT} is ${fmt(total)} > budget ${fmt(BUDGET_BYTES)}`)
  for (const p of problems) console.error(`audio:vendor --check: ${p}`)
  console.log(`audio:vendor --check: ${OUT} total ${fmt(total)}`)
  return problems.length ? 1 : 0
}

async function vendor() {
  const step = Number(arg('--step', '3'))
  if (!Number.isInteger(step) || step < 1 || step > 12)
    throw new Error(`--step must be an integer 1..12, got ${step}`)
  const only = arg('--only', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const force = process.argv.includes('--force')
  const unknown = only.filter((id) => !INSTRUMENTS.some((i) => i.id === id))
  if (unknown.length) throw new Error(`unknown --only ids: ${unknown}`)

  // Instrument ids are checked against gleitz names.json when reachable (non-fatal otherwise).
  try {
    const res = await fetch(`${BASE}/names.json`)
    if (res.ok) {
      const names = await res.json()
      const missing = INSTRUMENTS.filter((i) => !names.includes(i.id))
      if (missing.length)
        throw new Error(`not in names.json: ${missing.map((i) => i.id)}`)
    }
  } catch (err) {
    if (String(err).includes('names.json')) throw err
    console.warn(`audio:vendor: names.json not checked (${err})`)
  }

  mkdirSync(OUT, { recursive: true })
  for (const inst of INSTRUMENTS) {
    if (only.length && !only.includes(inst.id)) continue
    const dir = join(OUT, inst.id)
    mkdirSync(dir, { recursive: true })
    const pitches = samplePitches(inst.lo, inst.hi, step)
    const wanted = new Set(pitches.map((p) => `${midiToFlatName(p)}.mp3`))
    for (const name of readdirSync(dir)) {
      if (!wanted.has(name)) await rm(join(dir, name)) // stale notes from another --step
    }
    let fetched = 0
    await pool(pitches, 4, async (p) => {
      const file = `${midiToFlatName(p)}.mp3`
      const dest = join(dir, file)
      if (!force && existsSync(dest) && statSync(dest).size > 0) return
      await download(`${BASE}/${inst.id}-mp3/${file}`, dest)
      fetched++
    })
    const preset = presetFor(inst.id, pitches, step)
    await writeFile(
      join(OUT, `${inst.id}.preset.json`),
      `${JSON.stringify(preset, null, 2)}\n`,
    )
    console.log(
      `audio:vendor: ${inst.id.padEnd(22)} ${String(pitches.length).padStart(2)} notes ` +
        `(${midiToFlatName(inst.lo)}-${midiToFlatName(inst.hi)}, step ${step}, ${fetched} fetched) ${fmt(dirBytes(dir))}`,
    )
  }
  await writeFile(join(OUT, 'LICENSE.txt'), LICENSE_TEXT)
  const total = dirBytes(OUT)
  console.log(`audio:vendor: total ${fmt(total)} (budget ${fmt(BUDGET_BYTES)})`)
  if (total > BUDGET_BYTES) {
    console.error('audio:vendor: over budget')
    return 1
  }
  return 0
}

if (import.meta.main) {
  const run = process.argv.includes('--check') ? check : vendor
  run().then(
    (code) => {
      console.log(`EXIT ${code}`)
      process.exit(code)
    },
    (err) => {
      console.error(`audio:vendor: ${err?.stack ?? err}`)
      console.log('EXIT 1')
      process.exit(1)
    },
  )
}
