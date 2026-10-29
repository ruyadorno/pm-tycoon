// audio.md §9.3: chord symbols, note names, voicings (pure, no DOM/Tone/smplr).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  QUALITIES,
  avoidClashes,
  clashesWith,
  guideTones,
  keyScale,
  midiToNote,
  noteToMidi,
  parseChord,
  pitchClass,
  voiceChord,
  voiceMovement,
  voiceSequence,
} from '../../src/audio/chords.ts'
import { splitChanges, validateLeadSheet } from '../../src/audio/leadsheet.ts'

const sheet = validateLeadSheet(
  JSON.parse(
    readFileSync(
      new URL('../../src/data/music/semver-swing.json', import.meta.url),
      'utf8',
    ),
  ),
)
const sheetChords = [
  ...new Set([
    ...Object.values(sheet.sections).flatMap((s) =>
      s.changes.flatMap(splitChanges),
    ),
    sheet.finalChord,
  ]),
].map(parseChord)

describe('parseChord', () => {
  it('parses Bbm7 to root 10 and tones [10, 13, 17, 20]', () => {
    const c = parseChord('Bbm7')
    expect(c.root).toBe(10)
    expect(c.quality).toBe('m7')
    expect(c.tones).toEqual([10, 13, 17, 20])
  })

  it('knows every §4.2 quality and their intervals', () => {
    expect(parseChord('C69').tones).toEqual([0, 4, 7, 9, 14])
    expect(parseChord('F#m7b5').tones).toEqual([6, 9, 12, 16])
    expect(parseChord('Ebdim7').tones).toEqual([3, 6, 9, 12])
    expect(parseChord('AmMaj7').tones).toEqual([9, 12, 16, 20])
    for (const q of Object.keys(QUALITIES))
      expect(parseChord(`G${q}`).quality).toBe(q)
  })

  it('throws on an unknown quality or root', () => {
    for (const bad of ['Cmaj9', 'C7b9', 'Csus4', 'Hm7', 'm7', 'Fmaj7 ']) {
      expect(() => parseChord(bad)).toThrow(/unknown chord/)
    }
  })
})

describe('note names', () => {
  it('maps Db4 to 61 and friends', () => {
    expect(noteToMidi('Db4')).toBe(61)
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('F#5')).toBe(78)
    expect(noteToMidi('E1')).toBe(28)
    expect(noteToMidi('Cb4')).toBe(59)
  })

  it('round-trips flat names over the piano range', () => {
    for (let m = 21; m <= 108; m++) expect(noteToMidi(midiToNote(m))).toBe(m)
    expect(midiToNote(61)).toBe('Db4')
    expect(midiToNote(61, true)).toBe('C#4')
  })

  it('rejects malformed names', () => {
    for (const bad of ['X4', 'C', '4C', 'Dbb4', 'r'])
      expect(() => noteToMidi(bad)).toThrow()
  })
})

describe('scales and guide tones', () => {
  it('F major scale and the C7 shell', () => {
    expect(keyScale('F')).toEqual([5, 7, 9, 10, 0, 2, 4])
    expect(keyScale('Dm')).toEqual([2, 4, 5, 7, 9, 10, 0])
    expect(guideTones(parseChord('C7'))).toEqual([4, 10])
    expect(guideTones(parseChord('F69'))).toEqual([9, 2])
  })
})

describe('voicings', () => {
  it('keeps the lowest note in E3..G4 (52-67) for every chord of the sheet', () => {
    for (const c of sheetChords) {
      const v = voiceChord(c, null)
      expect(v).toHaveLength(4)
      expect(v[0]).toBeGreaterThanOrEqual(52)
      expect(v[0]).toBeLessThanOrEqual(67)
    }
    const seq = voiceSequence(sheetChords)
    for (const v of seq) {
      expect(v[0]).toBeGreaterThanOrEqual(52)
      expect(v[0]).toBeLessThanOrEqual(67)
    }
  })

  it('voices rootless: chord tones plus 9ths and 13ths only, never the root of a 7th chord', () => {
    for (const c of sheetChords) {
      const allowed = new Set(
        [...c.intervals, 2, 9].map((i) => pitchClass(c.root + i)),
      )
      for (const n of voiceChord(c, null))
        expect(allowed.has(pitchClass(n))).toBe(true)
      if (c.quality === '7' || c.quality === 'm7' || c.quality === 'maj7') {
        expect(voiceChord(c, null).some((n) => pitchClass(n) === c.root)).toBe(
          false,
        )
      }
    }
  })

  it('starts Fmaj7 on the A-form A3 C4 E4 G4 and voice-leads Gm7 -> C7 by a semitone', () => {
    expect(voiceChord(parseChord('Fmaj7'), null)).toEqual([57, 60, 64, 67])
    const gm7 = voiceChord(parseChord('Gm7'), [57, 60, 64, 67])
    const c7 = voiceChord(parseChord('C7'), gm7)
    expect(voiceMovement(gm7, c7)).toBeLessThanOrEqual(2)
  })

  it('voiceSequence never moves more than the greedy choice in total', () => {
    let prev: number[] | null = null
    let greedy = 0
    for (const c of sheetChords) {
      const v = voiceChord(c, prev)
      if (prev) greedy += voiceMovement(prev, v)
      prev = v
    }
    const seq = voiceSequence(sheetChords)
    let dp = 0
    for (let i = 1; i < seq.length; i++)
      dp += voiceMovement(seq[i - 1] as number[], seq[i] as number[])
    expect(dp).toBeLessThanOrEqual(greedy)
  })

  it('avoidClashes turns maj7 into 6 under a melody root (Bbmaj7 under Bb4)', () => {
    const bb = parseChord('Bbmaj7')
    const fixed = avoidClashes([57, 60, 62, 65], bb, [70])
    expect(fixed.some((n) => clashesWith(n, [70]))).toBe(false)
    expect(fixed).toContain(55) // A3 -> G3
    expect(fixed).toEqual([55, 60, 62, 65])
  })

  it('avoidClashes never doubles the tune in unison, never goes under the floor, never doubles a pitch class', () => {
    const c7 = parseChord('C7')
    // C7 B-form Bb3 D4 E4 A4 under a melody E4: the doubled 3rd drops an octave (E3 = 52, the floor)
    expect(avoidClashes([58, 62, 64, 69], c7, [64])).toEqual([52, 58, 62, 69])
    // with the floor above E3 it cannot drop: it moves to another chord tone instead, still no unison
    const high = avoidClashes([58, 62, 64, 69], c7, [64], 53)
    expect(high).not.toContain(64)
    expect(Math.min(...high)).toBeGreaterThanOrEqual(53)
    // Gm7 Bb3 D4 F4 A4 under Bb4: the 9 rubs, Bb4 would be a unison and a doubled b3 -> the root (G4)
    const gm7 = parseChord('Gm7')
    const fixed = avoidClashes([58, 62, 65, 69], gm7, [70])
    expect(fixed).toEqual([58, 62, 65, 67])
    expect(new Set(fixed.map(pitchClass)).size).toBe(4)
    // nothing to fix: the same notes, sorted
    expect(avoidClashes([64, 57, 67, 60], parseChord('Fmaj7'), [72])).toEqual([
      57, 60, 64, 67,
    ])
  })
})
