// Lead sheet -> deterministic note events (audio.md §4.4). Pure and seeded: no Tone, no smplr, no DOM, no
// Math.random. Each part draws from its own PRNG stream so muting a part never changes another part's notes.
import {
  type Chord,
  chordScale,
  guideTones,
  keyScale,
  midiToNote,
  noteToMidi,
  avoidClashes,
  parseChord,
  pitchClass,
  placeNear,
  voiceSequence,
} from './chords.ts'
import {
  type Bar,
  type LeadSheet,
  chorusBars,
  sectionLabels,
  splitChanges,
  totalBars,
} from './leadsheet.ts'
import { humanize, jitter, pickWeighted, stream } from './rng.ts'

export type Part = 'piano' | 'bass' | 'vibes' | 'trumpet' | 'ride' | 'hat'
export const PARTS: readonly Part[] = [
  'bass',
  'piano',
  'vibes',
  'trumpet',
  'ride',
  'hat',
]

export interface NoteEvent {
  bar: number
  /** beat within the bar, already swung (fractional) */
  beat: number
  /** written (unswung) beat; beat === swingBeat(pos, swing) */
  pos: number
  part: Part
  /** MIDI note; ride 51 / hat 44 (GM drum numbers, the buffers are unpitched) */
  midi: number
  /** 1–127; for ride/hat it is the gain factor × 100 */
  vel: number
  /** beats */
  dur: number
  /** humanize offset in ms (timing jitter, roll spacing), added at playback — never folded into `beat` */
  dtMs: number
}

export interface Arrangement {
  id: string
  title: string
  tempo: number
  swing: number
  key: string
  /** musical bars (64 for Semver Swing) */
  bars: number
  tailBars: number
  /** bars + tailBars: the Transport loop length */
  loopBars: number
  parts: readonly Part[]
  /** sorted by (bar, beat) */
  events: NoteEvent[]
  /** events grouped by bar, length = bars */
  eventsByBar: NoteEvent[][]
  /** chord in force at a bar/beat; the final chord in the last bar and the tail */
  chordAt(bar: number, beat: number): Chord
}

export interface ArrangeOptions {
  /** overrides sheet.seed */
  seed?: number
  /** parts to emit; default = piano, bass, trumpet + vibes / ride + hat per sheet.parts */
  parts?: readonly Part[]
}

/** Musical ranges (audio.md §4.4, §8.1). */
export const RANGES = {
  bass: [28, 55],
  bassComfort: [31, 50],
  pianoLowest: [52, 67],
  trumpet: [55, 84],
  vibes: [60, 84],
  pads: [60, 79],
} as const

/** Comping rhythm patterns: [pos, len] in beats (§4.4). */
export const PATTERNS = {
  P1: [
    [0, 0.75],
    [1.5, 1.5],
  ],
  P2: [
    [1.5, 1],
    [3, 0.5],
  ],
  P3: [
    [-0.5, 1],
    [2.5, 1],
  ],
  P4: [[2, 1.5]],
  P5: [
    [0, 1],
    [2, 1],
  ],
  /** two-chord variant: the second chord pushed onto the and of 2 */
  P5push: [
    [0, 0.75],
    [1.5, 1.5],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>
const PHRASE_PATTERNS = ['P1', 'P2', 'P3', 'P4'] as const
const PHRASE_WEIGHTS = [4, 3, 2, 1]
const P5_PUSH_SHARE = 0.25
/** vibes pad dyad velocity (§4.4 starts at 50; 60 keeps the pads ~12 dB under the melody on a phone speaker) */
const PAD_VEL = 60
/** pull of the comping toward the middle of its range (per semitone of the lowest note) */
const PIANO_GRAVITY = 0.15

const EPS = 1e-9

/** Off-beat positions are delayed by sin(frac·π)·swing/3 beats (Tone's 8n swing formula); on-beats are unshifted. */
export function swingBeat(pos: number, swing: number): number {
  const frac = pos - Math.floor(pos + EPS)
  if (frac < EPS) return pos
  return pos + (Math.sin(frac * Math.PI) * swing) / 3
}

/**
 * The first point of the band's swung grid at or after `beat` (absolute beats on the Transport): written
 * positions every `step` beats (1 = quarter, 0.5 = 8th, 0.25 = 16th) mapped through swingBeat, so a stinger
 * quantized to the next 8th lands where the band's off-beat 8ths land (0.65, not 0.5, at swing 0.45).
 */
export function nextSwungGridBeat(
  beat: number,
  step: number,
  swing: number,
): number {
  let p = Math.floor(beat / step) * step - step
  for (let i = 0; i < 8; i++, p += step) {
    const t = swingBeat(p, swing)
    if (t >= beat - EPS) return t
  }
  return swingBeat(p, swing)
}

function clampVel(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)))
}

function round(n: number, places: number): number {
  const k = 10 ** places
  return Math.round(n * k) / k
}

interface Written {
  start: number
  end: number
  midi: number | null
}

interface BarInfo {
  chorus: number
  label: string
  chords: Chord[]
  melody: Bar
  written: Written[]
  final: boolean
}

function writtenNotes(bar: Bar): Written[] {
  const out: Written[] = []
  let t = 0
  for (const [note, beats] of bar) {
    out.push({
      start: t,
      end: t + beats,
      midi: note === 'r' ? null : noteToMidi(note),
    })
    t += beats
  }
  return out
}

function defaultFinalMelody(prevMidi: number, tonic: number): Bar {
  const m = placeNear(tonic, prevMidi, RANGES.vibes[0], RANGES.trumpet[1])
  return [
    [midiToNote(m), 2],
    ['r', 2],
  ]
}

function buildBars(sheet: LeadSheet): BarInfo[] {
  const labels = sectionLabels(sheet.form)
  const perChorus = chorusBars(sheet)
  const bars = totalBars(sheet)
  const out: BarInfo[] = []
  let lastPitched = noteToMidi('C5')
  for (let b = 0; b < bars; b++) {
    const chorus = Math.floor(b / perChorus)
    let inChorus = b % perChorus
    let s = 0
    let section = sheet.sections[sheet.form[0] as string]
    for (; s < sheet.form.length; s++) {
      section = sheet.sections[sheet.form[s] as string]
      const n = section?.changes.length ?? 0
      if (inChorus < n) break
      inChorus -= n
    }
    if (!section) throw new Error(`no section for bar ${b}`)
    const final = b === bars - 1
    const finalChord = parseChord(sheet.finalChord)
    const melody = final
      ? (sheet.finalMelody ?? defaultFinalMelody(lastPitched, finalChord.root))
      : (section.melody[inChorus] as Bar)
    const chords = final
      ? [finalChord]
      : splitChanges(section.changes[inChorus] as string).map(parseChord)
    const written = writtenNotes(melody)
    for (const w of written) if (w.midi !== null) lastPitched = w.midi
    out.push({
      chorus,
      label: labels[s] as string,
      chords,
      melody,
      written,
      final,
    })
  }
  return out
}

function defaultParts(sheet: LeadSheet): Part[] {
  const parts: Part[] = ['bass', 'piano', 'trumpet']
  if (sheet.parts.vibes) parts.push('vibes')
  if (sheet.parts.brushes) parts.push('ride', 'hat')
  return parts
}

// ---------------------------------------------------------------- bass

/** Interval cost for a walking line: steps are free, a repeated note or a big leap is not. */
function leapCost(a: number, b: number): number {
  const d = Math.abs(a - b)
  if (d === 0) return 4
  if (d <= 2) return 0
  if (d <= 4) return 0.4
  if (d === 5) return 0.9
  if (d === 6) return 2.5
  if (d === 7) return 1.4
  if (d <= 9) return 3
  if (d <= 12) return 5
  return 100
}

function rangeCost(n: number): number {
  const [lo, hi] = RANGES.bassComfort
  return (n < lo ? lo - n : n > hi ? n - hi : 0) * 0.6
}

function octavesOf(pc: number, lo: number, hi: number): number[] {
  const out: number[] = []
  for (let m = pitchClass(pc); m <= hi; m += 12) if (m >= lo) out.push(m)
  return out
}

interface Approach {
  note: number
  cost: number
}

function approaches(
  target: number,
  chord: Chord,
  twoChord: boolean,
  scale: readonly number[],
): Approach[] {
  const [lo, hi] = RANGES.bass
  const cs = chordScale(chord)
  const diatonic = (n: number) =>
    scale.includes(pitchClass(n)) || cs.includes(pitchClass(n))
  const out: Approach[] = [
    { note: target - 1, cost: 0 },
    { note: target + 1, cost: 0.15 },
  ]
  if (diatonic(target + 2)) out.push({ note: target + 2, cost: 0.45 })
  if (diatonic(target - 2)) out.push({ note: target - 2, cost: 0.6 })
  out.push({ note: target - 5, cost: 0.7 }, { note: target + 7, cost: 0.9 })
  if (twoChord) {
    // §4.4: in a two-chord bar beat 4 is the second chord's 3rd — kept when it also approaches the next root
    const third = placeNear(chord.root + (chord.intervals[1] as number), target)
    if (Math.abs(third - target) <= 2 && third !== target) {
      const hit = out.find((a) => a.note === third)
      if (hit) hit.cost -= 0.6
      else out.push({ note: third, cost: -0.4 })
    }
  }
  return out.filter((a) => a.note >= lo && a.note <= hi)
}

function arrangeBass(
  info: BarInfo[],
  sheet: LeadSheet,
  seed: number,
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): void {
  const rng = stream(seed, 'bass')
  const scale = keyScale(sheet.key)
  const [lo, hi] = RANGES.bass
  const vel = (accent: boolean) => (accent ? 95 : 85) + jitter(rng, 5)
  const dt = () => humanize(rng, 4)
  // §4.4: first note F2 (41) — the first root nearest E2..F2
  let root = placeNear((info[0] as BarInfo).chords[0]?.root ?? 5, 41, lo, hi)
  for (let b = 0; b < info.length; b++) {
    const bi = info[b] as BarInfo
    const c1 = bi.chords[0] as Chord
    if (bi.final) {
      emit({
        bar: b,
        pos: 0,
        part: 'bass',
        midi: root,
        vel: vel(true),
        dur: 2,
        dtMs: dt(),
      })
      break
    }
    const two = bi.chords.length === 2
    const c2 = (bi.chords[1] ?? c1) as Chord
    const next = (info[b + 1] as BarInfo).chords[0] as Chord
    const r1 = root

    // beat 3: the second chord's root (two-chord bar) or a chord tone, 5th first (one-chord bar)
    const b3s: Approach[] = []
    if (two) {
      for (const n of octavesOf(c2.root, lo, hi)) b3s.push({ note: n, cost: 0 })
    } else {
      const prefs: [number, number][] = [
        [c1.intervals[2] as number, 0], // 5th
        [c1.intervals[1] as number, 0.3], // 3rd
        [c1.intervals[3] as number, 0.65], // 7th / 6th
        [0, 0.8], // root, other octave
      ]
      for (const [iv, cost] of prefs) {
        for (const n of octavesOf(c1.root + iv, lo, hi)) {
          if (n !== r1) b3s.push({ note: n, cost })
        }
      }
    }
    // pitch-class lookups for beat 2, and the beat-4 approaches per target octave (independent of beat 3)
    const tone1 = new Set(c1.intervals.map((i) => pitchClass(c1.root + i)))
    const scale1 = new Set(chordScale(c1))
    const third1 = pitchClass(c1.root + (c1.intervals[1] as number))
    const targets = octavesOf(next.root, lo, hi).map((target) => ({
      target,
      base: rangeCost(target) * 1.5 + Math.abs(target - 40) * 0.08,
      approaches: approaches(target, two ? c2 : c1, two, scale),
    }))
    let best: { line: number[]; target: number; cost: number } | null = null
    for (const b3 of b3s) {
      // beat 2: chord tone (the 3rd when within 4 semitones, §4.4), chord-scale tone or chromatic passing tone
      let b2Best = -1
      let b2Cost = Infinity
      for (let n = Math.max(lo, r1 - 5); n <= Math.min(hi, r1 + 5); n++) {
        if (n === r1) continue
        const pc = pitchClass(n)
        let q: number
        if (tone1.has(pc)) q = pc === third1 && Math.abs(n - r1) <= 4 ? -0.3 : 0
        else if (scale1.has(pc))
          // a weak-beat scale tone is a passing tone: it must move on by step
          q = Math.abs(b3.note - n) <= 2 ? 0.35 : 2.5
        else {
          const between = (n - r1) * (b3.note - n) > 0
          q =
            between && Math.abs(b3.note - r1) <= 3
              ? 0.3
              : Math.abs(b3.note - n) <= 2
                ? 1.6
                : 4
        }
        const dir =
          Math.sign(n - r1) !== Math.sign(b3.note - n) && b3.note !== n
            ? 0.25
            : 0
        const c =
          q +
          leapCost(r1, n) +
          leapCost(n, b3.note) +
          rangeCost(n) +
          dir +
          rng() * 0.8
        if (c < b2Cost) {
          b2Cost = c
          b2Best = n
        }
      }
      const head = b3.cost + b2Cost + rangeCost(b3.note)
      for (const t of targets) {
        for (const a of t.approaches) {
          const dir =
            Math.sign(b3.note - b2Best) !== Math.sign(a.note - b3.note)
              ? 0.2
              : 0
          const cost =
            head +
            t.base +
            a.cost +
            leapCost(b3.note, a.note) +
            rangeCost(a.note) +
            dir +
            rng() * 0.9
          if (!best || cost < best.cost) {
            best = {
              line: [r1, b2Best, b3.note, a.note],
              target: t.target,
              cost,
            }
          }
        }
      }
    }
    if (!best) throw new Error(`no bass line for bar ${b}`)
    const [n1, n2, n3, n4] = best.line as [number, number, number, number]
    emit({
      bar: b,
      pos: 0,
      part: 'bass',
      midi: n1,
      vel: vel(true),
      dur: 0.95,
      dtMs: dt(),
    })
    emit({
      bar: b,
      pos: 1,
      part: 'bass',
      midi: n2,
      vel: vel(false),
      dur: 0.95,
      dtMs: dt(),
    })
    emit({
      bar: b,
      pos: 2,
      part: 'bass',
      midi: n3,
      vel: vel(true),
      dur: 0.95,
      dtMs: dt(),
    })
    // §4.4: every bar with bar % 4 === 3 turns beat 4 into two 8ths (approach, then a chromatic neighbour)
    const t = best.target
    const d = n4 - t
    const neighbour =
      Math.abs(d) === 2
        ? t + Math.sign(d)
        : Math.abs(d) === 1
          ? t - d
          : t + Math.sign(d)
    if (b % 4 === 3 && neighbour >= lo && neighbour <= hi && neighbour !== n4) {
      const s = sheet.swing
      const first = swingBeat(3.5, s) - 3
      emit({
        bar: b,
        pos: 3,
        part: 'bass',
        midi: n4,
        vel: vel(false),
        dur: first * 0.95,
        dtMs: dt(),
      })
      emit({
        bar: b,
        pos: 3.5,
        part: 'bass',
        midi: neighbour,
        vel: vel(false) - 5,
        dur: (1 - first) * 0.95,
        dtMs: dt(),
      })
    } else {
      emit({
        bar: b,
        pos: 3,
        part: 'bass',
        midi: n4,
        vel: vel(false),
        dur: 0.95,
        dtMs: dt(),
      })
    }
    root = t
  }
}

// ---------------------------------------------------------------- piano

interface Hit {
  at: number // absolute written beat
  len: number
  chord: Chord
  final: boolean
}

/** Melody notes (written, absolute beats) that sound during [from, to). */
function melodyDuring(
  melodyAbs: readonly Written[][],
  from: number,
  to: number,
): number[] {
  const out: number[] = []
  const first = Math.max(0, Math.floor(from / 4) - 1)
  const last = Math.min(melodyAbs.length - 1, Math.floor(to / 4))
  for (let b = first; b <= last; b++) {
    for (const w of melodyAbs[b] as Written[]) {
      if (w.midi !== null && w.start < to - EPS && w.end > from + EPS)
        out.push(w.midi)
    }
  }
  return out
}

function collision(
  notes: readonly number[],
  melody: readonly number[],
): number {
  let c = 0
  for (const v of notes) {
    for (const m of melody) {
      const d = Math.abs(v - m)
      if (d === 1 || d === 13) c += 2.5 // minor 2nd / minor 9th against the tune
      if (d === 0) c += 2 // doubling the tune in unison thickens and masks it
      if (v > m) c += 0.6 // comping above the melody masks it
    }
  }
  return c
}

/** Rootless comping: the root never in the bottom voice, no pitch class twice, no 2nd at the bottom below F3. */
function voicingShapeCost(notes: readonly number[], chord: Chord): number {
  const low = notes[0] as number
  let c = 0
  if (pitchClass(low) === chord.root) c += 40
  if (new Set(notes.map(pitchClass)).size < notes.length) c += 2
  if ((notes[1] as number) - low <= 2 && low < 53) c += 2
  return c
}

/** A sounding piano chord in swung absolute beats (what the vibes pads must not double). */
interface PianoSpan {
  start: number
  end: number
  notes: readonly number[]
}

function arrangePiano(
  info: BarInfo[],
  sheet: LeadSheet,
  seed: number,
  melodyAbs: readonly Written[][],
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): PianoSpan[] {
  const rngPat = stream(seed, 'piano-pattern')
  const rng = stream(seed, 'piano-human')
  const hits: Hit[] = []
  let phrase: (typeof PHRASE_PATTERNS)[number] = 'P1'
  for (let b = 0; b < info.length; b++) {
    const bi = info[b] as BarInfo
    if (b % 2 === 0)
      phrase = pickWeighted(rngPat, PHRASE_PATTERNS, PHRASE_WEIGHTS)
    if (bi.final) {
      hits.push({
        at: b * 4,
        len: 2,
        chord: bi.chords[0] as Chord,
        final: true,
      })
      continue
    }
    if (bi.chords.length === 2) {
      const shape = rngPat() < P5_PUSH_SHARE ? PATTERNS.P5push : PATTERNS.P5
      shape.forEach(([pos, len], i) =>
        hits.push({
          at: b * 4 + pos,
          len,
          chord: bi.chords[i] as Chord,
          final: false,
        }),
      )
      continue
    }
    for (const [pos, len] of PATTERNS[phrase]) {
      // P3's anticipation lands on beat 3.5 of the previous bar; bar 0 has none, so it hits on beat 1
      const at = b === 0 && pos < 0 ? 0 : b * 4 + pos
      hits.push({
        at,
        len: b === 0 && pos < 0 ? len + pos : len,
        chord: bi.chords[0] as Chord,
        final: false,
      })
    }
  }
  hits.sort((a, b) => a.at - b.at)
  const sounding = hits.map((h) => melodyDuring(melodyAbs, h.at, h.at + h.len))
  const mid = (RANGES.pianoLowest[0] + RANGES.pianoLowest[1]) / 2
  // candidates are scored after the clash fix, so the sequence is chosen on the notes that will sound
  const voicings = voiceSequence(
    hits.map((h) => h.chord),
    RANGES.pianoLowest[0],
    RANGES.pianoLowest[1],
    (i, n) =>
      collision(n, sounding[i] as number[]) +
      Math.abs((n[0] as number) - mid) * PIANO_GRAVITY +
      voicingShapeCost(n, (hits[i] as Hit).chord),
    (i, n) =>
      avoidClashes(
        n,
        (hits[i] as Hit).chord,
        sounding[i] as number[],
        RANGES.pianoLowest[0],
      ),
  )
  const spans: PianoSpan[] = []
  hits.forEach((h, i) => {
    const notes = voicings[i] as number[]
    const bar = Math.floor(h.at / 4 + EPS)
    const pos = h.at - bar * 4
    const s = sheet.swing
    const nextHit = hits[i + 1]
    let dur = (swingBeat(h.at + h.len, s) - swingBeat(h.at, s)) * 0.92
    if (nextHit) {
      // a chord never rings into the next attack
      const gap = swingBeat(nextHit.at, s) - swingBeat(h.at, s) - 0.05
      if (dur > gap) dur = gap
    }
    const start = swingBeat(h.at, s)
    spans.push({ start, end: start + Math.max(0.1, dur), notes })
    const base = h.final ? 80 : 60 + rng() * 15
    const dtHit = humanize(rng, 8)
    notes.forEach((midi, k) => {
      const top = k === notes.length - 1
      emit({
        bar,
        pos,
        part: 'piano',
        midi,
        vel: base + (top ? 3 : jitter(rng, 2)),
        dur: Math.max(0.1, dur),
        dtMs: dtHit + jitter(rng, 1.5),
      })
    })
  })
  return spans
}

// ---------------------------------------------------------------- melody, pads, roll, brushes

function arrangeMelody(
  info: BarInfo[],
  sheet: LeadSheet,
  seed: number,
  parts: ReadonlySet<Part>,
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): void {
  const rngT = stream(seed, 'trumpet')
  const rngV = stream(seed, 'vibes-lead')
  const s = sheet.swing
  for (let b = 0; b < info.length; b++) {
    const bi = info[b] as BarInfo
    const plan = sheet.choruses[bi.chorus]
    if (!plan) continue
    const vibesLead = plan.lead === 'vibes' && parts.has('vibes')
    const trumpetOn =
      parts.has('trumpet') &&
      (!vibesLead || !(plan.trumpetRestsIn ?? []).includes(bi.label))
    for (const w of bi.written) {
      if (w.midi === null) continue
      const len = w.end - w.start
      const span = swingBeat(w.end, s) - swingBeat(w.start, s)
      const dur = span * (len <= 0.5 + EPS ? 0.6 : 0.85)
      const offBeat = w.start - Math.floor(w.start) > EPS ? 2 : 0
      if (vibesLead) {
        emit({
          bar: b,
          pos: w.start,
          part: 'vibes',
          midi: w.midi,
          vel: 70 + Math.max(-6, Math.min(6, offBeat + jitter(rngV, 5))),
          dur,
          dtMs: humanize(rngV, 10),
        })
      }
      if (trumpetOn) {
        const base = vibesLead ? 80 : 85
        emit({
          bar: b,
          pos: w.start,
          part: 'trumpet',
          midi: w.midi,
          vel: base + Math.max(-6, Math.min(6, offBeat + jitter(rngT, 5))),
          dur,
          dtMs: humanize(rngT, 10),
        })
      }
    }
  }
}

function arrangePads(
  info: BarInfo[],
  sheet: LeadSheet,
  seed: number,
  chordAt: (bar: number, beat: number) => Chord,
  piano: readonly PianoSpan[],
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): void {
  const rng = stream(seed, 'vibes-pads')
  const [lo, hi] = RANGES.pads
  let prev: number[] | null = null
  for (let b = 0; b < info.length; b++) {
    const bi = info[b] as BarInfo
    if (bi.final || !sheet.choruses[bi.chorus]?.vibesPads) continue
    // beats 3–4 hold one note >= 2 beats, or contain a rest >= 1 beat
    const held = bi.written.some(
      (w) => w.midi !== null && w.start <= 2 + EPS && w.end >= 4 - EPS,
    )
    const rest = bi.written
      .filter((w) => w.midi === null)
      .reduce(
        (n, w) => n + Math.max(0, Math.min(w.end, 4) - Math.max(w.start, 2)),
        0,
      )
    if (!held && rest < 1 - EPS) continue
    const chord = chordAt(b, 2)
    const [g3, g7] = guideTones(chord)
    const sounding = bi.written
      .filter((w) => w.midi !== null && w.start < 3.5 && w.end > 2)
      .map((w) => w.midi as number)
    const lowestTune = Math.min(...sounding, 127)
    // the pad (beat 3, 1.5 beats) never doubles a piano note in unison
    const padFrom = b * 4 + 2
    const comping = piano
      .filter((p) => p.start < padFrom + 1.5 - EPS && p.end > padFrom + EPS)
      .flatMap((p) => p.notes)
    let bestPad: number[] | null = null
    let bestCost = Infinity
    for (let n = lo; n <= hi; n++) {
      if (pitchClass(n) !== g3 && pitchClass(n) !== g7) continue
      const other = pitchClass(n) === g3 ? g7 : g3
      const m = placeNear(other, n + 6, n + 1, n + 11)
      if (m > hi) continue
      const pad = [n, m]
      const clash = pad.some(
        (v) =>
          sounding.some((t) => [0, 1, 13, 25].includes(Math.abs(v - t))) ||
          comping.includes(v),
      )
      if (clash) continue
      const cost =
        (m < lowestTune ? 0 : 1.5) +
        (prev
          ? (Math.abs(n - (prev[0] as number)) +
              Math.abs(m - (prev[1] as number))) *
            0.1
          : 0) +
        (n - lo) * 0.02
      if (cost < bestCost) {
        bestCost = cost
        bestPad = pad
      }
    }
    if (!bestPad) continue
    prev = bestPad
    for (const midi of bestPad) {
      emit({
        bar: b,
        pos: 2,
        part: 'vibes',
        midi,
        vel: PAD_VEL + jitter(rng, 3),
        dur: 1.5,
        dtMs: humanize(rng, 6),
      })
    }
  }
}

function arrangeFinalRoll(
  info: BarInfo[],
  seed: number,
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): void {
  const rng = stream(seed, 'vibes-roll')
  const last = info.length - 1
  const chord = (info[last] as BarInfo).chords[0] as Chord
  const root = placeNear(chord.root, 65, 60, 71)
  chord.intervals.slice(0, 4).forEach((iv, k) => {
    emit({
      bar: last,
      pos: 0,
      part: 'vibes',
      midi: root + iv,
      vel: 62 + jitter(rng, 3),
      dur: 2,
      dtMs: k * 30,
    })
  })
}

function arrangeBrushes(
  info: BarInfo[],
  parts: ReadonlySet<Part>,
  emit: (e: Omit<NoteEvent, 'beat'>) => void,
): void {
  const last = info.length - 1
  for (let b = 0; b < info.length; b++) {
    if (parts.has('ride')) {
      // the final bar gets one ride "button" with the final chord, then silence
      const positions = b === last ? [0] : [0, 1, 1.5, 2, 3, 3.5]
      for (const pos of positions) {
        const onBeat = pos === Math.floor(pos)
        emit({
          bar: b,
          pos,
          part: 'ride',
          midi: 51,
          vel: onBeat ? 100 : 70,
          dur: 0.25,
          dtMs: 0,
        })
      }
    }
    if (parts.has('hat') && b !== last) {
      for (const pos of [1, 3]) {
        emit({
          bar: b,
          pos,
          part: 'hat',
          midi: 44,
          vel: 100,
          dur: 0.25,
          dtMs: 0,
        })
      }
    }
  }
}

// ---------------------------------------------------------------- arrange

const PART_ORDER: Readonly<Record<Part, number>> = {
  bass: 0,
  piano: 1,
  vibes: 2,
  trumpet: 3,
  ride: 4,
  hat: 5,
}

export function arrange(
  sheet: LeadSheet,
  opts: ArrangeOptions = {},
): Arrangement {
  const seed = opts.seed ?? sheet.seed
  const partList = opts.parts ?? defaultParts(sheet)
  const parts = new Set<Part>(partList)
  const info = buildBars(sheet)
  const bars = info.length
  const finalChord = parseChord(sheet.finalChord)
  const chordAt = (bar: number, beat: number): Chord => {
    if (bar >= bars - 1 || bar < 0)
      return bar < 0 ? ((info[0] as BarInfo).chords[0] as Chord) : finalChord
    const bi = info[bar] as BarInfo
    return (
      bi.chords.length === 2 && beat >= 2 - EPS ? bi.chords[1] : bi.chords[0]
    ) as Chord
  }
  const melodyAbs: Written[][] = info.map((bi, b) =>
    bi.written.map((w) => ({
      start: w.start + b * 4,
      end: w.end + b * 4,
      midi: w.midi,
    })),
  )
  const events: NoteEvent[] = []
  const emit = (e: Omit<NoteEvent, 'beat'>) => {
    let bar = e.bar
    let pos = e.pos
    while (pos < -EPS) {
      pos += 4
      bar--
    }
    while (pos >= 4 - EPS) {
      pos -= 4
      bar++
    }
    if (bar < 0 || bar >= bars || !parts.has(e.part)) return
    events.push({
      bar,
      beat: swingBeat(pos, sheet.swing),
      pos,
      part: e.part,
      midi: e.midi,
      vel: clampVel(e.vel),
      dur: round(e.dur, 4),
      dtMs: round(e.dtMs, 1),
    })
  }
  // each generator draws from its own PRNG stream and emit() filters by part, so leaving a part out never
  // changes another part's notes (except the melody, which moves to the trumpet when the vibes are out)
  arrangeBass(info, sheet, seed, emit)
  const piano = arrangePiano(info, sheet, seed, melodyAbs, emit)
  arrangeMelody(info, sheet, seed, parts, emit)
  if (parts.has('vibes')) {
    arrangePads(info, sheet, seed, chordAt, piano, emit)
    arrangeFinalRoll(info, seed, emit)
  }
  arrangeBrushes(info, parts, emit)
  events.sort(
    (a, b) =>
      a.bar - b.bar ||
      a.beat - b.beat ||
      PART_ORDER[a.part] - PART_ORDER[b.part] ||
      a.dtMs - b.dtMs ||
      a.midi - b.midi,
  )
  const eventsByBar: NoteEvent[][] = Array.from({ length: bars }, () => [])
  for (const e of events) eventsByBar[e.bar]?.push(e)
  return {
    id: sheet.id,
    title: sheet.title,
    tempo: sheet.tempo,
    swing: sheet.swing,
    key: sheet.key,
    bars,
    tailBars: sheet.tailBars,
    loopBars: bars + sheet.tailBars,
    parts: partList,
    events,
    eventsByBar,
    chordAt,
  }
}
