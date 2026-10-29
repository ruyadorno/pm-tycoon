// Lead-sheet format + validation (audio.md §4.2). Pure: no DOM, no Tone, no smplr.
import { noteToMidi, parseChord, parseKey } from './chords.ts'

/** One written note: 'A4' or 'r' (rest) and its length in beats (0.5 = an 8th). A bar sums to 4 beats. */
export type BarNote = [note: string, beats: number]
export type Bar = BarNote[]

export interface Section {
  /** one entry per bar; 'Gm7 C7' = two chords, beats 1–2 / 3–4 */
  changes: string[]
  melody: Bar[]
}

export interface ChorusPlan {
  lead: 'trumpet' | 'vibes'
  /** section labels ('A1', 'A2', 'B', 'A3') in which the trumpet rests while the vibes lead */
  trumpetRestsIn?: string[]
  vibesPads: boolean
}

export interface LeadSheet {
  id: string
  /** must exist in puns.json tracks */
  title: string
  /** BPM (quarter note) */
  tempo: number
  /** 0..1; off-beat 8ths are delayed by swing × beat/3 (0.5 = triplet feel), applied by the arranger */
  swing: number
  /** 'F' = F major, 'Dm' = D minor; stingers transpose to it */
  key: string
  form: string[]
  sections: Record<string, Section>
  /** one entry per pass through the form */
  choruses: ChorusPlan[]
  /** replaces the last bar's changes on the last chorus; hit on beat 1, then silence */
  finalChord: string
  /** optional melody for that last bar (default: the tonic nearest the previous melody note, 2 beats) */
  finalMelody?: Bar
  /** silent bars appended after the form (4) */
  tailBars: number
  /** PRNG seed for pattern choice + humanize (fixed per tune, not the game seed) */
  seed: number
  parts: { brushes: boolean; vibes: boolean }
}

const EPS = 1e-9

function fail(sheetId: string, where: string, msg: string): never {
  throw new Error(`lead sheet "${sheetId}": ${where}: ${msg}`)
}

/** Splits a changes entry ('Gm7 C7') into its chord symbols (1 or 2). */
export function splitChanges(entry: string): string[] {
  return entry.trim().split(/\s+/)
}

export function barBeats(bar: Bar): number {
  return bar.reduce((s, [, beats]) => s + beats, 0)
}

function checkBar(id: string, where: string, bar: unknown): void {
  if (!Array.isArray(bar) || bar.length === 0)
    fail(id, where, 'a bar is a non-empty array of [note, beats]')
  for (const n of bar) {
    if (
      !Array.isArray(n) ||
      n.length !== 2 ||
      typeof n[0] !== 'string' ||
      typeof n[1] !== 'number'
    )
      fail(id, where, `bad note entry ${JSON.stringify(n)}`)
    if (!(n[1] > 0)) fail(id, where, `note length must be > 0 (${n[1]})`)
    if (n[0] !== 'r') {
      try {
        noteToMidi(n[0])
      } catch (err) {
        fail(id, where, (err as Error).message)
      }
    }
  }
  const sum = barBeats(bar as Bar)
  if (Math.abs(sum - 4) > EPS)
    fail(id, where, `bar is ${sum} beats, expected 4`)
}

/** Section labels in form order: a letter used more than once is numbered ('A1', 'A2', 'B', 'A3'). */
export function sectionLabels(form: readonly string[]): string[] {
  const total = new Map<string, number>()
  for (const s of form) total.set(s, (total.get(s) ?? 0) + 1)
  const seen = new Map<string, number>()
  return form.map((s) => {
    const k = (seen.get(s) ?? 0) + 1
    seen.set(s, k)
    return (total.get(s) ?? 0) > 1 ? `${s}${k}` : s
  })
}

/** Bars per pass through the form. */
export function chorusBars(sheet: LeadSheet): number {
  return sheet.form.reduce(
    (n, s) => n + (sheet.sections[s]?.changes.length ?? 0),
    0,
  )
}

/** Musical bars (all choruses, tail excluded). */
export function totalBars(sheet: LeadSheet): number {
  return chorusBars(sheet) * sheet.choruses.length
}

/**
 * Validates an untyped object (JSON) as a LeadSheet and returns it typed; throws a precise error otherwise —
 * in particular on any melody bar that is not 4 beats and on any chord quality outside §4.2.
 */
export function validateLeadSheet(input: unknown): LeadSheet {
  if (typeof input !== 'object' || input === null)
    throw new Error('lead sheet: not an object')
  const s = input as Partial<LeadSheet>
  const id = typeof s.id === 'string' && s.id ? s.id : '?'
  if (id === '?') fail(id, 'id', 'missing')
  if (typeof s.title !== 'string' || !s.title) fail(id, 'title', 'missing')
  if (typeof s.tempo !== 'number' || !(s.tempo >= 40 && s.tempo <= 300))
    fail(id, 'tempo', `must be 40..300 BPM (${s.tempo})`)
  if (typeof s.swing !== 'number' || !(s.swing >= 0 && s.swing <= 1))
    fail(id, 'swing', `must be 0..1 (${s.swing})`)
  if (typeof s.key !== 'string') fail(id, 'key', 'missing')
  try {
    parseKey(s.key)
  } catch (err) {
    fail(id, 'key', (err as Error).message)
  }
  if (!Array.isArray(s.form) || s.form.length === 0)
    fail(id, 'form', 'must be a non-empty array')
  if (typeof s.sections !== 'object' || s.sections === null)
    fail(id, 'sections', 'missing')
  let barsPerSection = -1
  for (const name of s.form) {
    const sec = s.sections[name]
    if (!sec) fail(id, `form ${name}`, 'section not defined')
    if (!Array.isArray(sec.changes) || !Array.isArray(sec.melody))
      fail(id, `section ${name}`, 'changes and melody must be arrays')
    if (sec.changes.length !== sec.melody.length)
      fail(id, `section ${name}`, 'changes and melody differ in length')
    if (barsPerSection < 0) barsPerSection = sec.changes.length
    if (sec.changes.length !== barsPerSection || barsPerSection === 0)
      fail(id, `section ${name}`, 'all sections must have the same bar count')
    sec.changes.forEach((entry, i) => {
      const chords = splitChanges(String(entry))
      if (chords.length < 1 || chords.length > 2)
        fail(id, `${name} bar ${i + 1}`, 'one or two chords per bar')
      for (const c of chords) {
        try {
          parseChord(c)
        } catch (err) {
          fail(id, `${name} bar ${i + 1}`, (err as Error).message)
        }
      }
    })
    sec.melody.forEach((bar, i) =>
      checkBar(id, `${name} melody bar ${i + 1}`, bar),
    )
  }
  if (!Array.isArray(s.choruses) || s.choruses.length === 0)
    fail(id, 'choruses', 'must be a non-empty array')
  const labels = sectionLabels(s.form)
  s.choruses.forEach((c, i) => {
    if (c.lead !== 'trumpet' && c.lead !== 'vibes')
      fail(id, `chorus ${i + 1}`, `lead must be trumpet or vibes`)
    if (typeof c.vibesPads !== 'boolean')
      fail(id, `chorus ${i + 1}`, 'vibesPads must be a boolean')
    for (const l of c.trumpetRestsIn ?? []) {
      if (!labels.includes(l))
        fail(id, `chorus ${i + 1}`, `unknown section label "${l}"`)
    }
  })
  if (typeof s.finalChord !== 'string') fail(id, 'finalChord', 'missing')
  try {
    parseChord(s.finalChord)
  } catch (err) {
    fail(id, 'finalChord', (err as Error).message)
  }
  if (s.finalMelody !== undefined) checkBar(id, 'finalMelody', s.finalMelody)
  if (!Number.isInteger(s.tailBars) || (s.tailBars as number) < 0)
    fail(id, 'tailBars', 'must be an integer >= 0')
  if (!Number.isInteger(s.seed)) fail(id, 'seed', 'must be an integer')
  if (
    typeof s.parts !== 'object' ||
    s.parts === null ||
    typeof s.parts.brushes !== 'boolean' ||
    typeof s.parts.vibes !== 'boolean'
  )
    fail(id, 'parts', '{ brushes: boolean, vibes: boolean } required')
  return s as LeadSheet
}
