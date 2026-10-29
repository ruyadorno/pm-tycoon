// audio.md §6: the musical hooks — exact pitches in F, transposition to another key, the vendored instrument
// ranges, and the gating (inactive / still loading = a log line, no note).
import { describe, expect, it } from 'vitest'
import type { Band } from '../../src/audio/band.ts'
import { type Chord, parseChord } from '../../src/audio/chords.ts'
import { defaultAudioData, type InstrumentId } from '../../src/audio/data.ts'
import type { InstrumentBank } from '../../src/audio/instruments.ts'
import { NoteLog } from '../../src/audio/log.ts'
import { Stingers } from '../../src/audio/stingers.ts'
import { asContext, FakeAudioContext } from './fake-audio.ts'

const { config, sheets } = defaultAudioData()
/** vendored key ranges (public/audio/sf/*.preset.json) */
const VENDORED: Record<string, [number, number]> = {
  piano2: [35, 85],
  bass2: [27, 56],
  vibes2: [59, 85],
  trumpet2: [54, 85],
}

interface Played {
  inst: InstrumentId
  note: number
  time: number
  velocity: number
}

function setup(
  o: { key?: string; chord?: Chord; active?: boolean; loaded?: boolean } = {},
) {
  const ctx = new FakeAudioContext()
  ctx.state = 'running'
  ctx.currentTime = 10
  const played: Played[] = []
  const bank = {
    isLoaded: () => o.loaded ?? true,
    get: (inst: InstrumentId) => ({
      start: (e: { note: number; time: number; velocity: number }) =>
        played.push({ inst, note: e.note, time: e.time, velocity: e.velocity }),
    }),
  } as unknown as InstrumentBank
  const band = {
    sheet: sheets['semver-swing'],
    currentChord: () => o.chord ?? parseChord('Fmaj7'),
    nextGrid: () => 10.25,
  } as unknown as Band
  const log = new NoteLog()
  const st = new Stingers({
    ctx: asContext(ctx),
    bank: () => bank,
    band: () => band,
    config,
    log,
    active: () => o.active ?? true,
    key: () => o.key ?? 'F',
  })
  const by = (inst: string) =>
    played.filter((p) => p.inst === inst).map((p) => p.note)
  return { st, played, log, by }
}

describe('Stingers', () => {
  it('minor tag in F: Fm7 F3 Ab3 C4 Eb4, Bbm7 Bb2 Db3 F3 Ab3, Fm(maj7) F2 C3 Ab3 E4 + bass2 F1', () => {
    const { st, by, log } = setup()
    expect(st.minorTag()).toBe(true)
    expect(by('piano2')).toEqual([
      53, 56, 60, 63, 46, 49, 53, 56, 41, 48, 56, 64,
    ])
    expect(by('bass2')).toEqual([29])
    // three chord entries in the log (the e2e count)
    expect(log.notes('piano2').map((n) => n.chord)).toEqual([
      [53, 56, 60, 63],
      [46, 49, 53, 56],
      [41, 48, 56, 64],
    ])
  })

  it('level-up in F: trumpet2 C5 D5 Eb5 F5, piano2 I6/9 stab, bass2 root, vibes2 gliss', () => {
    const { st, by } = setup()
    expect(st.levelUp()).toBe(true)
    expect(by('trumpet2')).toEqual([72, 74, 75, 77])
    expect(by('piano2')).toEqual([57, 60, 62, 67]) // A3 C4 D4 G4
    expect(by('bass2')).toEqual([41])
    expect(by('vibes2')).toEqual([65, 69, 72, 74])
  })

  it('oops in F: Db4 -> C4 (with the lower octave); defused: ii7 V7 Imaj9 + the A5 sparkle', () => {
    const a = setup()
    a.st.oops()
    expect(a.by('piano2')).toEqual([61, 49, 60, 48])
    const b = setup()
    b.st.defused()
    expect(b.by('piano2')).toEqual([
      58, 62, 65, 69, 58, 62, 64, 69, 57, 60, 64, 67,
    ])
    expect(b.by('vibes2').at(-1)).toBe(81)
  })

  it('cash chord: root-3rd-5th-7th with the root in C4-B4, velocity by size; late = root + 5th', () => {
    const a = setup({ chord: parseChord('Gm7') })
    a.st.cashChord(2, true)
    expect(a.by('vibes2')).toEqual([67, 70, 74, 77])
    expect(a.played.every((p) => p.velocity === 110)).toBe(true)
    const b = setup({ chord: parseChord('Gm7') })
    b.st.cashChord(0, false)
    expect(b.by('vibes2')).toEqual([67, 74])
    // quantized: the roll starts on the band's next grid line
    expect(Math.min(...a.played.map((p) => p.time))).toBe(10.25)
  })

  it('transposes every hook with the key (D: three semitones down) and stays inside the vendored ranges', () => {
    const f = setup()
    const d = setup({ key: 'D' })
    for (const t of [f, d]) {
      t.st.minorTag()
      t.st.levelUp()
      t.st.oops()
    }
    const fNotes = f.played.map((p) => p.note)
    const dNotes = d.played.map((p) => p.note)
    expect(dNotes).toHaveLength(fNotes.length)
    // fixed shapes: pitch classes move by -3 (octave placement may differ to stay in range)
    dNotes.forEach((n, i) =>
      expect((((n - (fNotes[i] as number)) % 12) + 12) % 12).toBe(9),
    )
    // defused is voice-led (its form may change with the key): ii7 V7 Imaj7(9) of D, chord tones + 9/13
    const e = setup({ key: 'D' })
    e.st.defused()
    const piano = e.played.filter((p) => p.inst === 'piano2')
    const times = [...new Set(piano.map((p) => p.time))]
    expect(times).toHaveLength(3)
    ;['Em7', 'A7', 'Dmaj7'].forEach((sym, k) => {
      const c = parseChord(sym)
      const ok = new Set([...c.intervals, 2, 9].map((i) => (c.root + i) % 12))
      for (const p of piano.filter((q) => q.time === times[k]))
        expect(ok.has(p.note % 12), `${sym} ${p.note}`).toBe(true)
    })
    // every key, every chord of the tune: all stinger notes inside the vendored key ranges
    for (const key of [
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
    ]) {
      for (const sym of ['Fmaj7', 'Gm7', 'C7', 'Bbm7', 'Eb7', 'F69', 'D7']) {
        const t = setup({ key, chord: parseChord(sym) })
        t.st.minorTag()
        t.st.levelUp()
        t.st.oops()
        t.st.defused()
        t.st.cashChord(3, true)
        for (const p of t.played) {
          const [lo, hi] = VENDORED[p.inst] as [number, number]
          expect(p.note, `${key} ${sym} ${p.inst}`).toBeGreaterThanOrEqual(lo)
          expect(p.note, `${key} ${sym} ${p.inst}`).toBeLessThanOrEqual(hi)
        }
      }
    }
  })

  it('degrades to a log line while inactive (before the unlock, suspended) or still loading', () => {
    const a = setup({ active: false })
    expect(a.st.levelUp()).toBe(false)
    expect(a.played).toHaveLength(0)
    const b = setup({ loaded: false })
    expect(b.st.minorTag()).toBe(false)
    expect(b.played).toHaveLength(0)
    expect(
      b.log.entries().some((e) => 'info' in e && /loading/.test(e.info)),
    ).toBe(true)
  })
})
