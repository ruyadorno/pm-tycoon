// Musical hooks (audio.md §6) on the sfx-bus instrument set (piano2 / bass2 / vibes2 / trumpet2), quantized to
// the Transport grid while the band plays and immediate otherwise. Every pitch is a degree of the current key, so
// a second tune in another key transposes them. They never run while the director is disabled, and while their
// instruments are still loading they degrade to a log line.
import type { Band } from './band.ts'
import { swingBeat } from './arranger.ts'
import {
  type Chord,
  parseChord,
  parseKey,
  placeNear,
  voiceSequence,
} from './chords.ts'
import type { AudioConfig, InstrumentId } from './data.ts'
import type { InstrumentBank } from './instruments.ts'
import type { NoteLog } from './log.ts'

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export interface StingerDeps {
  ctx: AudioContext | null
  bank: () => InstrumentBank | null
  band: () => Band | null
  config: AudioConfig
  log: NoteLog
  /** enabled and the context running */
  active: () => boolean
  /** key of the current sheet ('F') */
  key: () => string
}

interface Note {
  inst: InstrumentId
  midi: number
  /** seconds from the stinger's start */
  at: number
  /** seconds */
  dur: number
  vel: number
  /** notes sharing a group id are one chord in the log */
  g?: number
}

/** Size index for the cash chord velocity: S 0 … XL 3. */
export function sizeIndex(size: string | undefined): number {
  const i = ['S', 'M', 'L', 'XL'].indexOf(String(size ?? 'S').toUpperCase())
  return i < 0 ? 0 : i
}

export class Stingers {
  #d: StingerDeps

  constructor(deps: StingerDeps) {
    this.#d = deps
  }

  #keyRoot(): number {
    try {
      return parseKey(this.#d.key()).root
    } catch {
      return 5 // F
    }
  }

  #chordOnKey(degree: number, quality: string): Chord {
    const pc = (this.#keyRoot() + degree) % 12
    return parseChord(`${NAMES[pc]}${quality}`)
  }

  #spb(tempo?: number): number {
    return 60 / (tempo ?? this.#d.band()?.sheet?.tempo ?? 126)
  }

  /** Plays `notes` starting at `start` (context seconds); false + a log line when it cannot. */
  #play(name: string, start: number, notes: readonly Note[]): boolean {
    const { ctx, log } = this.#d
    if (!ctx || !this.#d.active()) {
      log.info(`stinger ${name} skipped (inactive)`, ctx?.currentTime ?? 0)
      return false
    }
    const bank = this.#d.bank()
    const missing = [...new Set(notes.map((n) => n.inst))].filter(
      (id) => !bank?.isLoaded(id),
    )
    if (!bank || missing.length) {
      log.info(
        `stinger ${name} skipped (loading ${missing.join(', ')})`,
        ctx.currentTime,
      )
      return false
    }
    log.info(`stinger ${name}`, start)
    // one log entry per chord/note onset group (a rolled chord is one entry), notes played individually
    const groups = new Map<string, Note[]>()
    notes.forEach((n, i) => {
      const k = `${n.inst}:${n.g ?? `n${i}`}`
      groups.set(k, [...(groups.get(k) ?? []), n])
    })
    for (const n of notes) {
      bank.get(n.inst)?.start({
        note: n.midi,
        velocity: Math.max(1, Math.min(127, Math.round(n.vel))),
        time: Math.max(ctx.currentTime, start + n.at),
        duration: n.dur,
      })
    }
    for (const group of groups.values()) {
      const first = group[0] as Note
      const midis = group.map((n) => n.midi).toSorted((a, b) => a - b)
      log.note({
        t: Math.max(ctx.currentTime, start + first.at),
        bar: -1,
        beat: 0,
        part: first.inst,
        midi: midis[0] as number,
        vel: Math.round(Math.max(...group.map((n) => n.vel))),
        dur: Math.round(first.dur * 1000) / 1000,
        ...(midis.length > 1 ? { chord: midis } : {}),
        stinger: name,
      })
    }
    return true
  }

  #grid(sub: '4n' | '8n' | '16n'): number {
    return this.#d.band()?.nextGrid(sub) ?? this.#d.ctx?.currentTime ?? 0
  }

  /**
   * Cash-register vibraphone (on-time delivery): the current chord rolled root-3rd-5th-7th, root in C4–B4,
   * 25 ms apart, velocity by parcel size; late = root + 5th only. Quantized to the next 16th.
   */
  cashChord(size: number, onTime: boolean): boolean {
    const s = this.#d.config.stingers
    const chord = this.#d.band()?.currentChord() ?? this.#chordOnKey(0, 'maj7')
    const root = placeNear(chord.root, 65, 60, 71)
    const tones = onTime
      ? chord.intervals.slice(0, 4)
      : [0, chord.intervals[2] as number]
    const vel = onTime ? s.cashVel + s.cashVelPerSize * size : s.lateVel
    const notes = tones.map((iv, k): Note => ({
      inst: 'vibes2',
      midi: root + iv,
      at: (k * s.cashRollMs) / 1000,
      dur: s.cashDurS,
      vel,
      g: 0,
    }))
    return this.#play(
      onTime ? 'cashChord' : 'cashChordLate',
      this.#grid('16n'),
      notes,
    )
  }

  /** DEFUSED: ii7 → V7 → Imaj9 quarter notes (piano2 voicings + vibes2 on top), then a vibes2 sparkle. */
  defused(): boolean {
    const s = this.#d.config.stingers
    const spb = this.#spb()
    const chords = [
      this.#chordOnKey(2, 'm7'),
      this.#chordOnKey(7, '7'),
      this.#chordOnKey(0, 'maj7'), // the A-form rootless voicing of Imaj7 is the maj9 sound (3 5 7 9)
    ]
    const voicings = voiceSequence(chords, 55, 64)
    const notes: Note[] = []
    voicings.forEach((v, k) => {
      for (const midi of v) {
        notes.push({
          inst: 'piano2',
          midi,
          at: k * spb,
          dur: k === 2 ? spb * 1.8 : spb * 0.9,
          vel: s.defusedVel,
          g: k,
        })
      }
      notes.push({
        inst: 'vibes2',
        midi: (v[v.length - 1] as number) + 12,
        at: k * spb,
        dur: spb * 0.9,
        vel: s.defusedVel - 10,
      })
    })
    // sparkle: the tonic's 3rd in the C5–B5 octave (A5 in F)
    notes.push({
      inst: 'vibes2',
      midi: placeNear(this.#keyRoot() + 4, 78, 72, 83),
      at: 3 * spb,
      dur: spb * 1.5,
      vel: s.defusedVel,
    })
    return this.#play('defused', this.#grid('8n'), notes)
  }

  /** OOPS (wrong Toss): piano2 "wah-wah" root+8 → root+7 (Db4 → C4 in F); the zzfx `wah` plays alongside. */
  oops(): boolean {
    const s = this.#d.config.stingers
    const spb = this.#spb()
    const root = placeNear(this.#keyRoot(), 53, 48, 59)
    const notes: Note[] = [
      {
        inst: 'piano2',
        midi: root + 8,
        at: 0,
        dur: spb * 0.9,
        vel: s.oopsVel,
        g: 0,
      },
      {
        inst: 'piano2',
        midi: root + 8 - 12,
        at: 0,
        dur: spb * 0.9,
        vel: s.oopsVel - 10,
        g: 0,
      },
      {
        inst: 'piano2',
        midi: root + 7,
        at: spb,
        dur: spb * 1.6,
        vel: s.oopsVel,
        g: 1,
      },
      {
        inst: 'piano2',
        midi: root + 7 - 12,
        at: spb,
        dur: spb * 1.6,
        vel: s.oopsVel - 10,
        g: 1,
      },
    ]
    return this.#play('oops', this.#grid('8n'), notes)
  }

  /**
   * Level up: trumpet2 swung 8ths 5-6-b7-8 (C5 D5 Eb5 F5 in F), the 8 held 1.5 beats; piano2 I6/9 stab + bass2
   * root and a vibes2 gliss land with the 8 (on the and of 2), so the stab never sits under the b7.
   */
  levelUp(): boolean {
    const s = this.#d.config.stingers
    const spb = this.#spb()
    const swing = this.#d.band()?.sheet?.swing ?? 0.45
    const tonic = placeNear(this.#keyRoot(), 65, 60, 71) // F4
    const at = (pos: number) => swingBeat(pos, swing) * spb
    const notes: Note[] = [7, 9, 10, 12].map((iv, k) => ({
      inst: 'trumpet2',
      midi: tonic + iv,
      at: at(k * 0.5),
      dur: k === 3 ? spb * 1.5 : spb * 0.45,
      vel: s.levelUpVel + (k === 3 ? 6 : 0),
    }))
    const land = at(1.5)
    const stabRoot = placeNear(this.#keyRoot(), 50, 48, 59) // F3
    for (const iv of [4, 7, 9, 14]) {
      notes.push({
        inst: 'piano2',
        midi: stabRoot + iv,
        at: land,
        dur: spb * 0.9,
        vel: s.levelUpVel - 5,
        g: 0,
      })
    }
    notes.push({
      inst: 'bass2',
      midi: placeNear(this.#keyRoot(), 41, 36, 47),
      at: land,
      dur: spb * 1.5,
      vel: s.levelUpVel,
    })
    ;[0, 4, 7, 9].forEach((iv, k) =>
      notes.push({
        inst: 'vibes2',
        midi: tonic + iv,
        at: land + (k * s.glissMs) / 1000,
        dur: spb * 1.5,
        vel: s.levelUpVel - 15,
        g: 0,
      }),
    )
    return this.#play('levelUp', this.#grid('4n'), notes)
  }

  /**
   * Game over: a rubato minor tag at 72 BPM in seconds (not on the Transport), `gameOverDelayS` after the band
   * stops — Im7 on beat 1, ivm7 on beat 3, Im(maj7) held with bass2 an octave below.
   */
  minorTag(): boolean {
    const s = this.#d.config.stingers
    const ctx = this.#d.ctx
    const beat = 60 / s.gameOverTempo
    const k3 = placeNear(this.#keyRoot(), 53, 48, 59) // F3
    const roll = 0.018 // a pianist's slight spread, low to high
    const chord = (
      base: number,
      ivs: number[],
      at: number,
      dur: number,
    ): Note[] =>
      ivs.map((iv, i) => ({
        inst: 'piano2',
        midi: base + iv,
        at: at + i * roll,
        dur,
        vel: s.gameOverVel - i * 2,
        g: Math.round(at * 1000),
      }))
    const notes: Note[] = [
      ...chord(k3, [0, 3, 7, 10], 0, beat * 2), // Fm7: F3 Ab3 C4 Eb4
      ...chord(k3 - 7, [0, 3, 7, 10], beat * 2, beat * 2), // Bbm7: Bb2 Db3 F3 Ab3
      ...chord(k3 - 12, [0, 7, 15, 23], beat * 4, s.gameOverHoldS), // Fm(maj7): F2 C3 Ab3 E4
      {
        inst: 'bass2',
        // two octaves under the tag (F1 in F), kept inside the vendored bass (E1 28 and up) in low keys
        midi: placeNear(this.#keyRoot(), k3 - 24, 28, 39),
        at: beat * 4,
        dur: s.gameOverHoldS,
        vel: s.gameOverVel,
      }, // F1
    ]
    return this.#play(
      'minorTag',
      (ctx?.currentTime ?? 0) + s.gameOverDelayS,
      notes,
    )
  }

  /** The victory stinger's audio.json numbers (B2 §3.4, design-m7 §6.9). */
  #victoryCfg(): VictoryStingerConfig {
    return this.#d.config.stingers
  }

  /** Length of the victory tag in seconds: two bars at the sheet tempo + the I6/9 hold. */
  victoryTagSeconds(): number {
    return VICTORY_BEATS * this.#spb() + this.#victoryCfg().victoryHoldS
  }

  /**
   * Victory (build 2, B2 §3.4, design-m7 §6.9): the big-band I–vi–ii–V tag — Imaj7 vi7 ii7 V7 two beats each,
   * piano2 voice-led voicings over bass2 roots (F2 D2 G2 C2 in F) — landing on the I6/9 (piano2 [4,7,9,14] on
   * the F3 octave + the bass2 root) held `victoryHoldS`, with a trumpet2 fanfare 5–1–3–5 as quarter notes over
   * the ii–V bar whose 8 lands with the I6/9 and holds (C4 F4 A4 C5 → F5 in F). Every degree is relative to the
   * key root. Starts `lookAheadS` from now at the sheet tempo in seconds, not on the Transport grid: the
   * director drops the band out for it (director.ts #victory) and brings it back after `victoryTagSeconds()`.
   * True when scheduled.
   */
  victoryTag(): boolean {
    const v = this.#victoryCfg()
    const spb = this.#spb()
    const root = this.#keyRoot()
    const chords = [
      this.#chordOnKey(0, 'maj7'),
      this.#chordOnKey(9, 'm7'),
      this.#chordOnKey(2, 'm7'),
      this.#chordOnKey(7, '7'),
    ]
    const notes: Note[] = []
    voiceSequence(chords, 55, 64).forEach((voicing, k) => {
      for (const midi of voicing) {
        notes.push({
          inst: 'piano2',
          midi,
          at: k * 2 * spb,
          dur: spb * 1.8,
          vel: v.victoryVel - 10,
          g: k,
        })
      }
      notes.push({
        inst: 'bass2',
        midi: placeNear((chords[k] as Chord).root, 41, 36, 47),
        at: k * 2 * spb,
        dur: spb * 1.8,
        vel: v.victoryVel - 5,
      })
    })
    const land = VICTORY_BEATS * spb
    const stabRoot = placeNear(root, 50, 48, 59) // F3
    for (const iv of [4, 7, 9, 14]) {
      notes.push({
        inst: 'piano2',
        midi: stabRoot + iv,
        at: land,
        dur: v.victoryHoldS,
        vel: v.victoryVel - 5,
        g: VICTORY_BEATS,
      })
    }
    notes.push({
      inst: 'bass2',
      midi: placeNear(root, 41, 36, 47), // F2
      at: land,
      dur: v.victoryHoldS,
      vel: v.victoryVel,
    })
    // the fanfare: 5 1 3 5 on beats 1-4 of the ii–V bar, the 8 on the landing (the tonic in C4–B4 = F4)
    const tonic = placeNear(root, 65, 60, 71)
    ;[-5, 0, 4, 7].forEach((iv, k) =>
      notes.push({
        inst: 'trumpet2',
        midi: tonic + iv,
        at: (VICTORY_BEATS - 4 + k) * spb,
        dur: spb * 0.85,
        vel: v.victoryVel,
      }),
    )
    notes.push({
      inst: 'trumpet2',
      midi: tonic + 12,
      at: land,
      dur: v.victoryHoldS,
      vel: v.victoryVel + 6,
    })
    const now = this.#d.ctx?.currentTime ?? 0
    return this.#play('victoryTag', now + this.#d.config.lookAheadS, notes)
  }
}

/** Beats before the victory tag lands: I vi ii V, two beats each. */
const VICTORY_BEATS = 8

/** audio.json `stingers` keys of the victory tag (build 2 M7). */
type VictoryStingerConfig = Pick<
  AudioConfig['stingers'],
  'victoryVel' | 'victoryHoldS'
>
