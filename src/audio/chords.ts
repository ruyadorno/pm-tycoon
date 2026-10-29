// Chord symbols, note names and voicings (audio.md §4.2, §4.4). Pure: no DOM, no Tone, no smplr — Vitest loads
// it under Node and the arranger builds on it.

export type Quality =
  | 'maj7'
  | '6'
  | '69'
  | '7'
  | 'm7'
  | 'm6'
  | 'm7b5'
  | 'dim7'
  | 'mMaj7'

/** Chord intervals above the root, exactly the audio.md §4.2 table. */
export const QUALITIES: Readonly<Record<Quality, readonly number[]>> = {
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  m6: [0, 3, 7, 9],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
}

/**
 * Rootless four-note voicings relative to the root (audio.md §4.4): A-form and, where the table has one, B-form.
 * m6 is not in the table; it borrows the 6-chord shape on a minor third.
 */
export const VOICING_FORMS: Readonly<
  Record<Quality, readonly (readonly number[])[]>
> = {
  maj7: [
    [4, 7, 11, 14],
    [11, 14, 16, 19],
  ],
  '7': [
    [4, 9, 10, 14],
    [10, 14, 16, 21],
  ],
  m7: [
    [3, 7, 10, 14],
    [10, 14, 15, 19],
  ],
  m7b5: [[3, 6, 10, 12]],
  dim7: [[0, 3, 6, 9]],
  '6': [[4, 7, 9, 14]],
  '69': [[4, 7, 9, 14]],
  m6: [[3, 7, 9, 14]],
  mMaj7: [[3, 7, 11, 14]],
}

export interface Chord {
  symbol: string
  /** pitch class 0–11 */
  root: number
  quality: Quality
  intervals: readonly number[]
  /** root pitch class + intervals, unwrapped (Bbm7 -> [10, 13, 17, 20]) */
  tones: number[]
}

const LETTERS: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}
const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
]
const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]

export function pitchClass(n: number): number {
  return ((n % 12) + 12) % 12
}

function parseRoot(s: string): { pc: number; rest: string } | null {
  const m = /^([A-G])(b|#)?(.*)$/.exec(s)
  if (!m) return null
  const base = LETTERS[m[1] as string] as number
  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0
  return { pc: pitchClass(base + acc), rest: m[3] ?? '' }
}

/** 'Bbm7' -> { root: 10, quality: 'm7', tones: [10, 13, 17, 20] }; throws on anything outside §4.2. */
export function parseChord(symbol: string): Chord {
  const r = parseRoot(symbol)
  if (!r || !(r.rest in QUALITIES))
    throw new Error(`unknown chord symbol "${symbol}"`)
  const quality = r.rest as Quality
  const intervals = QUALITIES[quality]
  return {
    symbol,
    root: r.pc,
    quality,
    intervals,
    tones: intervals.map((i) => r.pc + i),
  }
}

/** 'Db4' -> 61, 'F#5' -> 78, 'C-1' -> 0 (MIDI octave numbering, middle C = C4 = 60); throws when invalid. */
export function noteToMidi(name: string): number {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name)
  if (!m) throw new Error(`invalid note name "${name}"`)
  const base = LETTERS[m[1] as string] as number
  const acc = m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0
  const midi = base + acc + 12 * (Number(m[3]) + 1)
  if (midi < 0 || midi > 127) throw new Error(`note out of range "${name}"`)
  return midi
}

export function midiToNote(midi: number, sharps = false): string {
  const names = sharps ? SHARP_NAMES : FLAT_NAMES
  return `${names[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`
}

/** Key root pitch class and mode: 'F' = F major, 'Dm' = D minor. */
export function parseKey(key: string): { root: number; minor: boolean } {
  const r = parseRoot(key)
  if (!r || (r.rest !== '' && r.rest !== 'm'))
    throw new Error(`invalid key "${key}"`)
  return { root: r.pc, minor: r.rest === 'm' }
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/** Pitch classes of the key's scale (natural minor for minor keys). */
export function keyScale(key: string): number[] {
  const { root, minor } = parseKey(key)
  return (minor ? MINOR : MAJOR).map((i) => pitchClass(root + i))
}

/** The key's tonic chord: Imaj7 in major, Im7 in minor. */
export function tonicChord(key: string): Chord {
  const { root, minor } = parseKey(key)
  return parseChord(`${FLAT_NAMES[root]}${minor ? 'm7' : 'maj7'}`)
}

/** Third and seventh (sixth on 6/69/m6/dim7 chords) as pitch classes — the vibes pad dyad (§4.4). */
export function guideTones(chord: Chord): [number, number] {
  const third = chord.intervals[1] as number
  const seventh = chord.intervals[3] as number
  return [pitchClass(chord.root + third), pitchClass(chord.root + seventh)]
}

/** The octave of pitch class `pc` nearest to `target`, kept inside [lo, hi] when possible (ties go low). */
export function placeNear(
  pc: number,
  target: number,
  lo = 0,
  hi = 127,
): number {
  let best = -1
  let bestCost = Infinity
  for (let m = pitchClass(pc); m <= 127; m += 12) {
    const outside = m < lo ? lo - m : m > hi ? m - hi : 0
    const cost = outside * 100 + Math.abs(m - target)
    if (cost < bestCost) {
      best = m
      bestCost = cost
    }
  }
  return best
}

/** Sum of pairwise distances between two sorted voicings (nearest-note sum when the sizes differ). */
export function voiceMovement(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === b.length) {
    let s = 0
    for (let i = 0; i < a.length; i++)
      s += Math.abs((a[i] as number) - (b[i] as number))
    return s
  }
  let s = 0
  for (const n of b) s += Math.min(...a.map((m) => Math.abs(m - n)))
  return s
}

export interface VoicingCandidate {
  notes: number[]
  form: number
}

/** Every placement of every form of `chord` whose lowest note lies in [lo, hi] (E3 52 … G4 67 by default). */
export function voicingCandidates(
  chord: Chord,
  lo = 52,
  hi = 67,
): VoicingCandidate[] {
  const out: VoicingCandidate[] = []
  VOICING_FORMS[chord.quality].forEach((form, f) => {
    const first = chord.root + (form[0] as number)
    for (let oct = -2; oct <= 10; oct++) {
      const low = first + 12 * oct
      if (low < lo || low > hi) continue
      out.push({ notes: form.map((i) => chord.root + i + 12 * oct), form: f })
    }
  })
  return out
}

/**
 * Rootless voicing with the smaller total movement from `prev` (§4.4); with no previous voicing, the placement
 * whose lowest note is nearest the middle of the range. `extraCost` lets the arranger add melody-collision terms.
 */
export function voiceChord(
  chord: Chord,
  prev: readonly number[] | null,
  lo = 52,
  hi = 67,
  extraCost?: (notes: readonly number[]) => number,
): number[] {
  const cands = voicingCandidates(chord, lo, hi)
  if (cands.length === 0)
    throw new Error(`no voicing for ${chord.symbol} in ${lo}..${hi}`)
  const mid = (lo + hi) / 2
  let best = cands[0] as VoicingCandidate
  let bestCost = Infinity
  for (const c of cands) {
    const low = c.notes[0] as number
    const base = prev ? voiceMovement(prev, c.notes) : Math.abs(low - mid) * 0.5
    // tie-break toward the middle of the comping range so the voicings do not drift to an edge
    const cost = base + Math.abs(low - mid) * 0.01 + (extraCost?.(c.notes) ?? 0)
    if (cost < bestCost) {
      best = c
      bestCost = cost
    }
  }
  return [...best.notes]
}

/**
 * Voice-leads a whole chord sequence: the candidates of each chord are chained by dynamic programming so the
 * total movement (plus `nodeCost`, e.g. melody collisions) is minimal over the sequence. Greedy choice (§4.4,
 * `voiceChord`) can walk into the edge of the range and then has to jump; looking ahead avoids that.
 * `transform` (e.g. avoidClashes against the tune) is applied to every candidate first, so the costs and the
 * movement are measured on the notes that will actually sound.
 */
export function voiceSequence(
  chords: readonly Chord[],
  lo = 52,
  hi = 67,
  nodeCost?: (index: number, notes: readonly number[]) => number,
  transform?: (index: number, notes: readonly number[]) => number[],
): number[][] {
  if (chords.length === 0) return []
  const mid = (lo + hi) / 2
  const cands = chords.map((c, i) => {
    const list = voicingCandidates(c, lo, hi)
    if (list.length === 0)
      throw new Error(`no voicing for ${c.symbol} in ${lo}..${hi}`)
    return transform
      ? list.map((v) => ({ ...v, notes: transform(i, v.notes) }))
      : list
  })
  const nodes = cands.map((list, i) =>
    list.map((c) => nodeCost?.(i, c.notes) ?? 0),
  )
  let cost = (cands[0] as VoicingCandidate[]).map(
    (c, k) =>
      Math.abs((c.notes[0] as number) - mid) * 0.5 +
      ((nodes[0] as number[])[k] as number),
  )
  const back: number[][] = [cost.map(() => -1)]
  for (let i = 1; i < cands.length; i++) {
    const prev = cands[i - 1] as VoicingCandidate[]
    const cur = cands[i] as VoicingCandidate[]
    const next: number[] = []
    const from: number[] = []
    cur.forEach((c, k) => {
      let best = Infinity
      let arg = 0
      prev.forEach((p, j) => {
        const v = (cost[j] as number) + voiceMovement(p.notes, c.notes)
        if (v < best - 1e-9) {
          best = v
          arg = j
        }
      })
      next.push(best + ((nodes[i] as number[])[k] as number))
      from.push(arg)
    })
    cost = next
    back.push(from)
  }
  let k = cost.indexOf(Math.min(...cost))
  const out: number[][] = []
  for (let i = cands.length - 1; i >= 0; i--) {
    out.push([
      ...((cands[i] as VoicingCandidate[])[k] as VoicingCandidate).notes,
    ])
    k = (back[i] as number[])[k] as number
  }
  return out.toReversed()
}

/** Tones a rootless voicing may use for a chord: chord tones plus the tensions a comping pianist reaches for. */
const ALLOWED_TENSIONS: Readonly<Record<Quality, readonly number[]>> = {
  maj7: [2, 9],
  '6': [2, 11],
  '69': [11],
  '7': [2, 9],
  m7: [2, 5],
  m6: [2, 5],
  m7b5: [5],
  dim7: [2],
  mMaj7: [2, 9],
}

const CLASH = [1, 13]

/** True when `v` rubs a semitone or a minor ninth against any melody note. */
export function clashesWith(v: number, melody: readonly number[]): boolean {
  return melody.some((m) => CLASH.includes(Math.abs(v - m)))
}

/**
 * Pianist's fix for a voice that rubs against the tune (semitone / minor 9th) or doubles it in unison: move it
 * to the nearest allowed tone that does neither — maj7 -> 6 under a melody root, 9 -> root under a b3, 13 -> 5
 * under a b7, a doubled 3rd or 7th down an octave — keeping the 3rd and 7th, staying under the tune, never
 * doubling another voice's pitch class and never going below `floor` (the comping range's lowest note) unless
 * nothing else works. Returns the sorted voicing.
 */
export function avoidClashes(
  notes: readonly number[],
  chord: Chord,
  melody: readonly number[],
  floor = 52,
): number[] {
  const bad = (n: number) => clashesWith(n, melody) || melody.includes(n)
  if (!notes.some(bad)) return notes.toSorted((a, b) => a - b) // the common case
  const out = [...notes]
  const allowed = new Set(
    [...chord.intervals, ...ALLOWED_TENSIONS[chord.quality]].map((i) =>
      pitchClass(chord.root + i),
    ),
  )
  const [g3, g7] = guideTones(chord)
  const lowestTune = melody.length ? Math.min(...melody) : Infinity
  // rubs first (they are wrong notes), unisons after (they only thicken the tune)
  const order = out
    .map((v, i) => ({ i, rank: clashesWith(v, melody) ? 0 : 1 }))
    .toSorted((a, b) => a.rank - b.rank)
  for (const { i } of order) {
    const v = out[i] as number
    if (!bad(v)) continue
    const guide = pitchClass(v) === g3 || pitchClass(v) === g7
    let best = v
    let bestCost = Infinity
    for (let c = v - 12; c <= v + 7; c++) {
      if (c === v || c < floor || !allowed.has(pitchClass(c)) || bad(c))
        continue
      if (out.some((o, j) => j !== i && o === c)) continue
      const samePc = pitchClass(c) === pitchClass(v)
      const doubled = out.some(
        (o, j) => j !== i && pitchClass(o) === pitchClass(c),
      )
      const cost =
        (samePc ? 1 : Math.abs(c - v) + 1.5) +
        (guide && !samePc ? 3 : 0) +
        (pitchClass(c) === chord.root ? 1.2 : 0) + // rootless: the 6th before the root
        (doubled ? 2.5 : 0) +
        (c > lowestTune ? 2 : 0)
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    }
    out[i] = best
  }
  return out.toSorted((a, b) => a - b)
}

/** Chord scale per quality (relative to the root) for passing tones: dominant = mixolydian, m7 = dorian, … */
const CHORD_SCALES: Readonly<Record<Quality, readonly number[]>> = {
  maj7: [0, 2, 4, 7, 9, 11],
  '6': [0, 2, 4, 7, 9, 11],
  '69': [0, 2, 4, 7, 9, 11],
  '7': [0, 2, 4, 5, 7, 9, 10],
  m7: [0, 2, 3, 5, 7, 9, 10],
  m6: [0, 2, 3, 5, 7, 9, 10],
  m7b5: [0, 1, 3, 5, 6, 8, 10],
  dim7: [0, 2, 3, 5, 6, 8, 9, 11],
  mMaj7: [0, 2, 3, 5, 7, 9, 11],
}

export function chordScale(chord: Chord): number[] {
  return CHORD_SCALES[chord.quality].map((i) => pitchClass(chord.root + i))
}

/** Pitch-class membership helpers. */
export function isChordTone(chord: Chord, midi: number): boolean {
  return chord.tones.some((t) => pitchClass(t) === pitchClass(midi))
}

export function inScale(scale: readonly number[], midi: number): boolean {
  return scale.includes(pitchClass(midi))
}
