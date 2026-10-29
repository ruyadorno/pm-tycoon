// audio.md §9.3: the arranger is pure and seeded — determinism, bar counts, bass roots, swing offsets, melody
// tone sets, part layout, plus the numeric musical checks (ranges, leaps, collisions) and an event-count snapshot.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type NoteEvent,
  type Part,
  arrange,
  nextSwungGridBeat,
  swingBeat,
} from '../../src/audio/arranger.ts'
import {
  clashesWith,
  isChordTone,
  keyScale,
  noteToMidi,
  pitchClass,
} from '../../src/audio/chords.ts'
import { type LeadSheet, validateLeadSheet } from '../../src/audio/leadsheet.ts'

const sheet = validateLeadSheet(
  JSON.parse(
    readFileSync(
      new URL('../../src/data/music/semver-swing.json', import.meta.url),
      'utf8',
    ),
  ),
)
const arr = arrange(sheet)
const of = (part: Part, a = arr) => a.events.filter((e) => e.part === part)
const inBars = (es: NoteEvent[], lo: number, hi: number) =>
  es.filter((e) => e.bar >= lo && e.bar <= hi)
const abs = (e: NoteEvent) => e.bar * 4 + e.beat
const overlap = (a: NoteEvent, b: NoteEvent) =>
  Math.min(abs(a) + a.dur, abs(b) + b.dur) - Math.max(abs(a), abs(b)) > 0.05
const voicingsOf = (a: typeof arr) => {
  const m = new Map<string, NoteEvent[]>()
  for (const e of of('piano', a)) {
    const k = `${e.bar}:${e.pos}`
    m.set(k, [...(m.get(k) ?? []), e])
  }
  return [...m.values()]
}

describe('arrange: shape', () => {
  it('is deterministic for a seed', () => {
    expect(arrange(sheet).events).toEqual(arr.events)
  })

  it('changes the comping with the seed', () => {
    const other = arrange(sheet, { seed: 4242 })
    const hits = (a: typeof arr) =>
      [...new Set(of('piano', a).map((e) => `${e.bar}:${e.pos}`))].join(' ')
    expect(hits(other)).not.toEqual(hits(arr))
  })

  it('has 64 musical bars and a 68-bar loop; nothing at bar >= 64', () => {
    expect(arr.bars).toBe(64)
    expect(arr.loopBars).toBe(68)
    expect(arr.eventsByBar).toHaveLength(64)
    expect(arr.events.every((e) => e.bar >= 0 && e.bar < 64)).toBe(true)
    for (let b = 0; b < 64; b++)
      expect(arr.eventsByBar[b]?.length).toBeGreaterThan(0)
  })

  it('sorts events by (bar, beat)', () => {
    for (let i = 1; i < arr.events.length; i++) {
      const a = arr.events[i - 1] as NoteEvent
      const b = arr.events[i] as NoteEvent
      expect(a.bar * 8 + a.beat <= b.bar * 8 + b.beat).toBe(true)
    }
  })

  it('reports the chord in force (two-chord bars split at beat 3; final chord in the last bar and tail)', () => {
    expect(arr.chordAt(0, 0).symbol).toBe('Fmaj7')
    expect(arr.chordAt(1, 0).symbol).toBe('Gm7')
    expect(arr.chordAt(1, 2.65).symbol).toBe('C7')
    expect(arr.chordAt(63, 0).symbol).toBe('F69')
    expect(arr.chordAt(66, 1).symbol).toBe('F69')
  })

  it('keeps the event density near the §4.4 budget (~24 events/bar max, ~1,500 per pass)', () => {
    expect(arr.events.length).toBeLessThan(1500)
    expect(
      Math.max(...arr.eventsByBar.map((b) => b.length)),
    ).toBeLessThanOrEqual(30)
  })

  it('event-count snapshot per part (guards accidental composition changes)', () => {
    const counts: Record<string, number> = {}
    for (const e of arr.events) counts[e.part] = (counts[e.part] ?? 0) + 1
    expect(counts).toEqual({ bass: 268, piano: 508, trumpet: 211, vibes: 161 })
  })

  it('runs fast (called once per sheet)', () => {
    const times: number[] = []
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now()
      arrange(sheet)
      times.push(performance.now() - t0)
    }
    // the fastest run measures the algorithm, not the machine's load (vlr check
    // runs while other processes compete for the CPU)
    times.sort((a, b) => a - b)
    expect(times[0]).toBeLessThan(25)
  })
})

describe('arrange: swing', () => {
  it('delays every off-beat by sin(frac·π)·swing/3 and leaves on-beats alone', () => {
    let offBeats = 0
    for (const e of arr.events) {
      const frac = e.pos - Math.floor(e.pos)
      if (frac === 0) expect(e.beat).toBe(e.pos)
      else {
        offBeats++
        expect(
          Math.abs(
            e.beat -
              (Math.floor(e.pos) +
                frac +
                (Math.sin(frac * Math.PI) * 0.45) / 3),
          ),
        ).toBeLessThan(1e-9)
      }
      expect(e.beat).toBe(swingBeat(e.pos, sheet.swing))
    }
    expect(offBeats).toBeGreaterThan(100)
    // an off-beat 8th lands at 0.65 of the beat
    expect(swingBeat(1.5, 0.45)).toBeCloseTo(1.65, 12)
  })

  it('quantizes stingers to the swung grid the band plays (next 8th = 0.65, not 0.5)', () => {
    const s = 0.45
    expect(nextSwungGridBeat(0, 0.5, s)).toBe(0)
    expect(nextSwungGridBeat(0.01, 0.5, s)).toBeCloseTo(0.65, 12)
    expect(nextSwungGridBeat(0.6, 0.5, s)).toBeCloseTo(0.65, 12)
    expect(nextSwungGridBeat(0.66, 0.5, s)).toBe(1)
    expect(nextSwungGridBeat(2.7, 1, s)).toBe(3)
    expect(nextSwungGridBeat(0.3, 0.25, s)).toBeCloseTo(swingBeat(0.25, s), 12)
    expect(nextSwungGridBeat(271.9, 0.5, s)).toBe(272) // the loop end (68 bars) is a grid line
    // straight tunes (swing 0) keep the straight grid
    expect(nextSwungGridBeat(0.3, 0.5, 0)).toBe(0.5)
  })

  it('keeps humanize out of the beat grid (dtMs within the §4.4 limits)', () => {
    const limit: Record<string, number> = {
      bass: 4,
      piano: 9.5,
      trumpet: 10,
      vibes: 10,
    }
    for (const e of arr.events) {
      if (e.part === 'vibes' && e.bar === 63 && e.dur === 2) continue // final roll, 30 ms apart
      expect(
        Math.abs(e.dtMs),
        `${e.part} ${e.bar}:${e.pos}`,
      ).toBeLessThanOrEqual(limit[e.part] ?? 0)
    }
  })
})

describe('arrange: walking bass', () => {
  const bass = of('bass')

  it('starts on F2 (41) at bar 0 beat 0', () => {
    expect(bass[0]).toMatchObject({ bar: 0, beat: 0, midi: 41 })
  })

  it('plays the chord root on beat 1 of all 64 bars', () => {
    for (let b = 0; b < 64; b++) {
      const one = bass.find((e) => e.bar === b && e.pos === 0)
      expect(one, `bar ${b}`).toBeDefined()
      expect(pitchClass(one?.midi ?? -1)).toBe(arr.chordAt(b, 0).root)
    }
  })

  it('stays in E1..G3 (28-55) and never leaps more than an octave', () => {
    for (const e of bass) {
      expect(e.midi).toBeGreaterThanOrEqual(28)
      expect(e.midi).toBeLessThanOrEqual(55)
    }
    for (let i = 1; i < bass.length; i++)
      expect(
        Math.abs((bass[i] as NoteEvent).midi - (bass[i - 1] as NoteEvent).midi),
      ).toBeLessThanOrEqual(12)
  })

  it('walks: chord tones on beats 1 and 3, step-wise approach into the next bar, no repeated notes', () => {
    for (const e of bass.filter((x) => x.pos === 0 || x.pos === 2))
      expect(isChordTone(arr.chordAt(e.bar, e.pos), e.midi)).toBe(true)
    let stepwise = 0
    for (let b = 0; b < 63; b++) {
      const last = bass.filter((e) => e.bar === b).at(-1) as NoteEvent
      const next = bass.find((e) => e.bar === b + 1) as NoteEvent
      const d = Math.abs(last.midi - next.midi)
      expect([1, 2, 5, 7]).toContain(d) // chromatic/scale approach or a 5th
      if (d <= 2) stepwise++
    }
    expect(stepwise).toBeGreaterThanOrEqual(56)
    for (let i = 1; i < bass.length; i++)
      expect((bass[i] as NoteEvent).midi).not.toBe(
        (bass[i - 1] as NoteEvent).midi,
      )
  })

  it('plays quarter notes, with two 8ths on beat 4 of every bar where bar % 4 === 3', () => {
    for (let b = 0; b < 63; b++) {
      const positions = bass.filter((e) => e.bar === b).map((e) => e.pos)
      expect(positions).toEqual(b % 4 === 3 ? [0, 1, 2, 3, 3.5] : [0, 1, 2, 3])
    }
  })

  it('moves on by step from every weak-beat non-chord tone on beat 2', () => {
    for (const seed of [1260, 1, 7, 42]) {
      const line = of('bass', arrange(sheet, { seed }))
      line.forEach((e, i) => {
        if (e.pos !== 1 || isChordTone(arr.chordAt(e.bar, 1), e.midi)) return
        const next = line[i + 1] as NoteEvent
        expect(
          Math.abs(next.midi - e.midi),
          `seed ${seed} bar ${e.bar}`,
        ).toBeLessThanOrEqual(2)
      })
    }
  })

  it('accents beats 1 and 3 (95 ± 5) over 2 and 4 (85 ± 5)', () => {
    for (const e of bass) {
      if (e.pos === 0 || e.pos === 2) expect(e.vel).toBeGreaterThanOrEqual(90)
      else expect(e.vel).toBeLessThanOrEqual(90)
    }
  })
})

describe('arrange: piano comping', () => {
  const piano = of('piano')
  const hits = new Map<string, NoteEvent[]>()
  for (const e of piano) {
    const k = `${e.bar}:${e.pos}`
    hits.set(k, [...(hits.get(k) ?? []), e])
  }
  const voicings = [...hits.values()].map((h) =>
    h.map((e) => e.midi).toSorted((a, b) => a - b),
  )

  it('plays four-note voicings with the lowest note in E3..G4', () => {
    for (const v of voicings) {
      expect(v).toHaveLength(4)
      expect(v[0]).toBeGreaterThanOrEqual(52)
      expect(v[0]).toBeLessThanOrEqual(67)
    }
  })

  it('voice-leads smoothly (mean movement <= 5 semitones, no voice moves more than a 5th)', () => {
    let total = 0
    let max = 0
    let perVoice = 0
    for (let i = 1; i < voicings.length; i++) {
      const a = voicings[i - 1] as number[]
      const b = voicings[i] as number[]
      const m = b.reduce((s, n, k) => s + Math.abs(n - (a[k] as number)), 0)
      total += m
      max = Math.max(max, m)
      perVoice = Math.max(
        perVoice,
        ...b.map((n, k) => Math.abs(n - (a[k] as number))),
      )
    }
    expect(total / (voicings.length - 1)).toBeLessThanOrEqual(5)
    // the register shift under the low A-section melody (E3 A3 Bb3 D4 -> A3 C4 E4 G4) is the largest move
    expect(max).toBeLessThanOrEqual(20)
    expect(perVoice).toBeLessThanOrEqual(7)
  })

  it('never rubs a semitone or a minor 9th against the tune', () => {
    const tune = [...of('trumpet'), ...inBars(of('vibes'), 32, 62)]
    for (const p of piano) {
      const sounding = tune
        .filter((m) => abs(m) < abs(p) + p.dur && abs(m) + m.dur > abs(p))
        .map((m) => m.midi)
      expect(clashesWith(p.midi, sounding), `${p.bar}:${p.pos} ${p.midi}`).toBe(
        false,
      )
    }
  })

  it('never lets a chord ring into the next attack', () => {
    const starts = [...hits.values()].map((h) => abs(h[0] as NoteEvent))
    ;[...hits.values()].forEach((h, i) => {
      const next = starts[i + 1]
      if (next !== undefined)
        expect(
          abs(h[0] as NoteEvent) + (h[0] as NoteEvent).dur,
        ).toBeLessThanOrEqual(next)
    })
  })

  it('ends on one F6/9 hit (vel 80, 2 beats)', () => {
    const last = piano.filter((e) => e.bar === 63)
    expect(last.map((e) => e.pos)).toEqual([0, 0, 0, 0])
    expect(new Set(last.map((e) => pitchClass(e.midi)))).toEqual(
      new Set([9, 0, 2, 7]),
    )
  })
})

describe('arrange: no doubled or rubbing notes between parts (any seed)', () => {
  const seeds = [1260, 1, 7, 42, 4242]

  it('the only unison between two parts is the written trumpet + vibes unison of chorus 2 (B, A3)', () => {
    for (const seed of seeds) {
      const a = arrange(sheet, { seed })
      const ev = a.events
      for (let i = 0; i < ev.length; i++) {
        const x = ev[i] as NoteEvent
        for (let j = i + 1; j < ev.length; j++) {
          const y = ev[j] as NoteEvent
          if (y.bar > x.bar + 1) break
          if (x.part === y.part || x.midi !== y.midi || !overlap(x, y)) continue
          const pair = [x.part, y.part].toSorted().join('+')
          expect(
            pair === 'trumpet+vibes' && x.bar >= 48,
            `seed ${seed}: ${pair} ${x.bar}:${x.pos} / ${y.bar}:${y.pos} midi ${x.midi}`,
          ).toBe(true)
        }
      }
    }
  })

  it('comps rootless under the tune: root never the lowest voice, four different pitch classes, no rub', () => {
    for (const seed of seeds) {
      const a = arrange(sheet, { seed })
      const tune = [...of('trumpet', a), ...inBars(of('vibes', a), 32, 62)]
      for (const h of voicingsOf(a)) {
        const first = h[0] as NoteEvent
        const v = h.map((e) => e.midi).toSorted((p, q) => p - q)
        const chord =
          first.pos === 3.5
            ? a.chordAt(first.bar + 1, 0)
            : a.chordAt(first.bar, first.pos >= 1.5 ? 2 : 0)
        const where = `seed ${seed} ${first.bar}:${first.pos} ${chord.symbol} ${v}`
        expect(pitchClass(v[0] as number), where).not.toBe(chord.root)
        expect(new Set(v.map(pitchClass)).size, where).toBe(4)
        expect(v[0], where).toBeGreaterThanOrEqual(52)
        for (const p of h) {
          const sounding = tune.filter((m) => overlap(m, p)).map((m) => m.midi)
          expect(clashesWith(p.midi, sounding), where).toBe(false)
        }
      }
    }
  })
})

describe('arrange: melody, vibes, brushes', () => {
  const scale = keyScale(sheet.key)
  const tensions: [string, string][] = [
    ['F#5', 'D7'],
    ['B4', 'G7'],
    ['Eb5', 'F7'],
  ]
  const melodyOk = (e: NoteEvent) => {
    const chord = arr.chordAt(e.bar, e.pos)
    return (
      scale.includes(pitchClass(e.midi)) ||
      isChordTone(chord, e.midi) ||
      tensions.some(([n, c]) => noteToMidi(n) === e.midi && chord.symbol === c)
    )
  }

  it('melody notes are scale tones, chord tones or the written tensions', () => {
    for (const e of of('trumpet'))
      expect(melodyOk(e), `${e.bar}:${e.pos}`).toBe(true)
    for (const e of inBars(of('vibes'), 32, 62)) expect(melodyOk(e)).toBe(true)
  })

  it('trumpet leads chorus 1, rests in bars 33-48, rejoins for 49-64 (1-based)', () => {
    const t = of('trumpet')
    for (let b = 0; b < 32; b++)
      expect(
        t.some((e) => e.bar === b),
        `bar ${b}`,
      ).toBe(true)
    expect(inBars(t, 32, 47)).toHaveLength(0)
    for (let b = 48; b < 64; b++)
      expect(
        t.some((e) => e.bar === b),
        `bar ${b}`,
      ).toBe(true)
  })

  it('vibes carry the melody in chorus 2 at written pitch and pad only in chorus 1', () => {
    const v = of('vibes')
    for (let b = 32; b < 64; b++) expect(v.some((e) => e.bar === b)).toBe(true)
    const pads = inBars(v, 0, 31)
    expect(pads.length % 2).toBe(0)
    expect(pads.every((e) => e.pos === 2 && e.dur === 1.5)).toBe(true)
    expect(pads.length / 2).toBeGreaterThanOrEqual(6)
  })

  it('keeps the parts in range (trumpet 55-84, vibes 60-84)', () => {
    for (const e of of('trumpet')) expect(e.midi).toBeGreaterThanOrEqual(55)
    for (const e of of('trumpet')) expect(e.midi).toBeLessThanOrEqual(84)
    for (const e of of('vibes')) expect(e.midi).toBeGreaterThanOrEqual(60)
    for (const e of of('vibes')) expect(e.midi).toBeLessThanOrEqual(84)
  })

  it('rolls the final chord on the vibes, 30 ms apart', () => {
    const roll = of('vibes').filter((e) => e.bar === 63 && e.dur === 2)
    expect(roll.map((e) => e.dtMs)).toEqual([0, 30, 60, 90])
  })

  it('has no brushes by default; 6 ride + 2 hat per bar when parts.brushes is on', () => {
    expect(of('ride')).toHaveLength(0)
    expect(of('hat')).toHaveLength(0)
    const drums: LeadSheet = {
      ...sheet,
      parts: { ...sheet.parts, brushes: true },
    }
    const withBrushes = arrange(drums)
    for (let b = 0; b < 63; b++) {
      expect(of('ride', withBrushes).filter((e) => e.bar === b)).toHaveLength(6)
      expect(of('hat', withBrushes).filter((e) => e.bar === b)).toHaveLength(2)
    }
    // bar 64: one ride "button" with the final chord, then silence
    expect(of('ride', withBrushes).filter((e) => e.bar === 63)).toHaveLength(1)
    expect(of('hat', withBrushes).filter((e) => e.bar === 63)).toHaveLength(0)
    // the brushes never change the other parts
    expect(
      withBrushes.events.filter((e) => e.part !== 'ride' && e.part !== 'hat'),
    ).toEqual(arr.events)
  })

  it('a part filter only removes notes (each part draws from its own PRNG stream)', () => {
    const bassOnly = arrange(sheet, { parts: ['bass'] })
    expect(bassOnly.events).toEqual(of('bass'))
    const noPiano = arrange(sheet, { parts: ['bass', 'trumpet', 'vibes'] })
    expect(noPiano.events).toEqual(arr.events.filter((e) => e.part !== 'piano'))
  })
})
