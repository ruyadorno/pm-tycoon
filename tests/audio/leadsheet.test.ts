// audio.md §9.3: the lead-sheet format and "Semver Swing" itself.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { noteToMidi } from '../../src/audio/chords.ts'
import {
  barBeats,
  chorusBars,
  sectionLabels,
  totalBars,
  validateLeadSheet,
} from '../../src/audio/leadsheet.ts'

const sheetUrl = new URL(
  '../../src/data/music/semver-swing.json',
  import.meta.url,
)
const raw = () => JSON.parse(readFileSync(sheetUrl, 'utf8'))
const sheet = validateLeadSheet(raw())
const punsUrl = new URL('../../src/data/puns.json', import.meta.url)

describe('semver-swing.json', () => {
  it('validates', () => {
    expect(sheet.id).toBe('semver-swing')
    expect(sheet.tempo).toBe(126)
    expect(sheet.swing).toBe(0.45)
    expect(sheet.key).toBe('F')
    expect(sheet.form).toEqual(['A', 'A', 'B', 'A'])
  })

  it('has 4-beat bars everywhere, including the final bar', () => {
    for (const [name, s] of Object.entries(sheet.sections)) {
      expect(s.melody, name).toHaveLength(8)
      expect(s.changes, name).toHaveLength(8)
      for (const bar of s.melody) expect(barBeats(bar)).toBeCloseTo(4, 9)
    }
    if (sheet.finalMelody) expect(barBeats(sheet.finalMelody)).toBeCloseTo(4, 9)
  })

  it('is 64 bars: form x 8 x choruses, plus 4 silent tail bars', () => {
    expect(sheet.form.length * 8 * sheet.choruses.length).toBe(64)
    expect(chorusBars(sheet)).toBe(32)
    expect(totalBars(sheet)).toBe(64)
    expect(sheet.tailBars).toBe(4)
  })

  it('keeps the tune singable: inside the muted-trumpet and vibes ranges, leaps <= a 6th', () => {
    const notes = Object.values(sheet.sections)
      .flatMap((s) => s.melody.flat())
      .filter(([n]) => n !== 'r')
      .map(([n]) => noteToMidi(n))
    expect(Math.min(...notes)).toBeGreaterThanOrEqual(60) // vibes floor (trumpet floor is 55)
    expect(Math.max(...notes)).toBeLessThanOrEqual(84)
    for (const s of Object.values(sheet.sections)) {
      for (const bar of s.melody) {
        const pitched = bar
          .filter(([n]) => n !== 'r')
          .map(([n]) => noteToMidi(n))
        for (let i = 1; i < pitched.length; i++) {
          expect(
            Math.abs((pitched[i] as number) - (pitched[i - 1] as number)),
          ).toBeLessThanOrEqual(9)
        }
      }
    }
  })

  it('ships drumless with vibes (audio.md §5 default)', () => {
    expect(sheet.parts).toEqual({ brushes: false, vibes: true })
    expect(sheet.choruses.map((c) => c.lead)).toEqual(['trumpet', 'vibes'])
    expect(sheet.choruses[1]?.trumpetRestsIn).toEqual(['A1', 'A2'])
  })

  it.skipIf(!existsSync(punsUrl))(
    'takes its title from puns.json tracks',
    () => {
      const puns = JSON.parse(readFileSync(punsUrl, 'utf8')) as {
        tracks: string[]
      }
      expect(puns.tracks).toContain(sheet.title)
      expect(puns.tracks[0]).toBe(sheet.title)
    },
  )
})

describe('validateLeadSheet', () => {
  it('numbers repeated sections', () => {
    expect(sectionLabels(['A', 'A', 'B', 'A'])).toEqual(['A1', 'A2', 'B', 'A3'])
  })

  it('throws on a bar that is not 4 beats', () => {
    const s = raw()
    s.sections.A.melody[2] = [
      ['A4', 1],
      ['C5', 0.5],
      ['F5', 2],
    ]
    expect(() => validateLeadSheet(s)).toThrow(
      /A melody bar 3: bar is 3.5 beats/,
    )
  })

  it('throws on an unknown chord quality', () => {
    const s = raw()
    s.sections.B.changes[0] = 'F7b9'
    expect(() => validateLeadSheet(s)).toThrow(/unknown chord symbol "F7b9"/)
    const t = raw()
    t.finalChord = 'Fmaj9'
    expect(() => validateLeadSheet(t)).toThrow(/finalChord/)
  })

  it('throws on a bad note, an unknown section label and missing fields', () => {
    const a = raw()
    a.sections.A.melody[0][0] = ['H4', 1]
    expect(() => validateLeadSheet(a)).toThrow(/invalid note name "H4"/)
    const b = raw()
    b.choruses[1].trumpetRestsIn = ['C1']
    expect(() => validateLeadSheet(b)).toThrow(/unknown section label "C1"/)
    const c = raw()
    delete c.parts
    expect(() => validateLeadSheet(c)).toThrow(/parts/)
    const d = raw()
    d.form = ['A', 'Q']
    expect(() => validateLeadSheet(d)).toThrow(/section not defined/)
  })
})
