// The band (audio.md §4.5): an Arrangement scheduled one bar at a time on Tone's Transport (the clock only) onto
// the smplr instruments and the brush buffers. The Transport loops over sheet.bars + tailBars (68); bars past
// the music schedule nothing. Parts whose instrument is not loaded yet are skipped at schedule time, so vibes
// and trumpet simply join at the next bar after they decode.
import {
  type Arrangement,
  type NoteEvent,
  type Part,
  arrange,
  nextSwungGridBeat,
} from './arranger.ts'
import { playBuffer, type BrushBuffers } from './brushes.ts'
import { type Chord, parseChord, tonicChord } from './chords.ts'
import type { AudioConfig, InstrumentId } from './data.ts'
import type { InstrumentBank } from './instruments.ts'
import type { LeadSheet } from './leadsheet.ts'
import type { NoteLog } from './log.ts'
import { getTransport, toneNow } from './tone.ts'

const PART_INSTRUMENT: Readonly<Partial<Record<Part, InstrumentId>>> = {
  piano: 'piano',
  bass: 'bass',
  vibes: 'vibes',
  trumpet: 'trumpet',
}
/** Stinger notes go straight to Web Audio: this much lead is enough (no Tone look-ahead needed). */
const GRID_LEAD_S = 0.02
const GRID_STEP = { '4n': 1, '8n': 0.5, '16n': 0.25 } as const

const MUSIC_INSTRUMENTS: readonly InstrumentId[] = [
  'piano',
  'bass',
  'vibes',
  'trumpet',
]

export type TransportState = 'started' | 'stopped' | 'paused'

export interface BandDeps {
  ctx: AudioContext
  bank: InstrumentBank
  bus: AudioNode
  config: AudioConfig
  log: NoteLog
  /** called at bar 0 of every pass, at the bar's start (the "Now playing" toast) */
  onPassStart?: (title: string) => void
  /** a note that should have played but could not (e.g. the context stopped running mid-schedule) */
  onDropped?: () => void
}

export class Band {
  #d: BandDeps
  #sheet: LeadSheet | null = null
  #arr: Arrangement | null = null
  #brushes: BrushBuffers | null = null
  #repeatId: number | null = null
  #live = new Set<AudioBufferSourceNode>()
  #timers = new Set<ReturnType<typeof setTimeout>>()
  scheduled = 0
  skipped = 0

  constructor(deps: BandDeps) {
    this.#d = deps
  }

  get sheet(): LeadSheet | null {
    return this.#sheet
  }

  get arrangement(): Arrangement | null {
    return this.#arr
  }

  get secPerBeat(): number {
    return 60 / (this.#sheet?.tempo ?? 120)
  }

  /** Arranges `sheet` and configures the Transport for it (tempo, 4/4, loop over bars + tail). */
  load(
    sheet: LeadSheet,
    brushes: BrushBuffers | null,
    parts?: readonly Part[],
  ): void {
    const T = getTransport()
    this.#sheet = sheet
    this.#brushes = brushes
    this.#arr = arrange(sheet, parts ? { parts } : {})
    T.bpm.value = sheet.tempo
    T.swing = 0 // the arranger applies the swing (one formula for live and offline)
    T.timeSignature = 4
    T.loop = true
    T.loopStart = 0
    T.loopEnd = `${this.#arr.loopBars}:0:0`
    if (this.#repeatId !== null) T.clear(this.#repeatId)
    this.#repeatId = T.scheduleRepeat((time) => this.#onBar(time), '1m', 0)
  }

  #ticksPerBar(): number {
    return getTransport().PPQ * 4
  }

  /** Bar index (0 … loopBars-1) at a context time; bar boundaries are exact multiples of the bar length. */
  barAt(time: number): number {
    const loopBars = this.#arr?.loopBars ?? 1
    const bar = Math.round(
      getTransport().getTicksAtTime(time) / this.#ticksPerBar(),
    )
    return ((bar % loopBars) + loopBars) % loopBars
  }

  #onBar(time: number): void {
    const bar = this.barAt(time)
    if (bar === 0 && this.#sheet) {
      const title = this.#sheet.title
      this.#later(Math.max(0, time - this.#d.ctx.currentTime), () =>
        this.#d.onPassStart?.(title),
      )
    }
    this.scheduleBar(bar, time)
  }

  #later(seconds: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.#timers.delete(id)
      fn()
    }, seconds * 1000)
    this.#timers.add(id)
  }

  /** Schedules the events of `bar` whose beat is >= fromBeat; `barStart` is the context time of beat 0. */
  scheduleBar(bar: number, barStart: number, fromBeat = 0): void {
    const arr = this.#arr
    if (!arr || bar >= arr.bars) return
    for (const e of arr.eventsByBar[bar] ?? []) {
      if (e.beat < fromBeat - 1e-6) continue
      this.#play(e, barStart + e.beat * this.secPerBeat + e.dtMs / 1000)
    }
  }

  #play(e: NoteEvent, when: number): void {
    const { ctx, bank, bus, config, log } = this.#d
    const at = Math.max(when, ctx.currentTime)
    if (ctx.state !== 'running') {
      // never pre-schedule onto a suspended context (notes §6): the notes would burst out on resume
      this.#d.onDropped?.()
      return
    }
    if (e.part === 'ride' || e.part === 'hat') {
      const buf = this.#brushes?.[e.part]
      if (!buf) {
        this.skipped++
        return
      }
      const gain = config.brushes[e.part] * (e.vel / 100)
      const src = playBuffer(ctx, buf, at, gain, bus)
      this.#live.add(src)
      src.addEventListener('ended', () => this.#live.delete(src))
    } else {
      const id = PART_INSTRUMENT[e.part]
      const inst = id ? bank.get(id) : undefined
      if (!inst) {
        this.skipped++
        return
      }
      inst.start({
        note: e.midi,
        velocity: e.vel,
        time: at,
        duration: e.dur * this.secPerBeat,
      })
    }
    this.scheduled++
    log.note({
      t: at,
      bar: e.bar,
      beat: Math.round(e.beat * 100) / 100,
      part: e.part,
      midi: e.midi,
      vel: e.vel,
      dur: e.dur,
    })
  }

  get state(): TransportState {
    return getTransport().state as TransportState
  }

  /** From bar 0. No-op when already playing. */
  start(): void {
    const T = getTransport()
    if (!this.#arr || T.state === 'started') return
    if (T.state === 'paused') T.stop()
    T.position = 0
    T.start(toneNow())
  }

  /** Transport.stop + every music voice off (game over, New game). */
  stop(): void {
    getTransport().stop()
    this.#silence()
  }

  /** Transport.pause + every music voice off (tab hide, the tape-stop). */
  pause(): void {
    const T = getTransport()
    if (T.state !== 'started') return
    T.pause()
    this.#silence()
  }

  /** Transport.start from the paused position, re-scheduling the rest of the current bar. */
  resume(): void {
    const T = getTransport()
    if (T.state !== 'paused' || !this.#arr) return
    const tpb = this.#ticksPerBar()
    const ticks = T.ticks
    const bar = Math.floor(ticks / tpb) % this.#arr.loopBars
    const beat = (ticks % tpb) / T.PPQ
    const t0 = toneNow()
    T.start(t0)
    // at an exact bar boundary the repeat event fires by itself on start
    if (beat > 1e-6) this.scheduleBar(bar, t0 - beat * this.secPerBeat, beat)
  }

  #silence(): void {
    this.#d.bank.stop(MUSIC_INSTRUMENTS)
    for (const src of this.#live) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    }
    this.#live.clear()
    for (const id of this.#timers) clearTimeout(id)
    this.#timers.clear()
  }

  /** {bar, beat} of the Transport now (beat fractional, 0-based). */
  position(): { bar: number; beat: number } {
    const T = getTransport()
    const tpb = this.#ticksPerBar()
    const ticks = T.ticks
    const loopBars = this.#arr?.loopBars ?? 1
    return {
      bar: Math.floor(ticks / tpb) % loopBars,
      beat: (ticks % tpb) / T.PPQ,
    }
  }

  /** The chord under the music now; the key's I chord when the Transport is stopped or nothing is loaded. */
  currentChord(): Chord {
    const sheet = this.#sheet
    if (!sheet || !this.#arr) return parseChord('Fmaj7')
    if (getTransport().state === 'stopped') return tonicChord(sheet.key)
    const { bar, beat } = this.position()
    return this.#arr.chordAt(bar, beat)
  }

  /**
   * Context time of the next line of the band's grid ('4n' | '8n' | '16n') while playing, else now. The grid is
   * the swung one the arranger plays (Tone's own swing is 0, so Transport.nextSubdivision would return straight
   * 8ths, 71 ms ahead of the band's off-beats at 126 BPM, swing 0.45).
   */
  nextGrid(subdivision: '4n' | '8n' | '16n'): number {
    const T = getTransport()
    const now = this.#d.ctx.currentTime
    if (T.state !== 'started' || !this.#sheet) return now
    const from = now + GRID_LEAD_S
    const beat = T.getTicksAtTime(from) / T.PPQ
    const target = nextSwungGridBeat(
      beat,
      GRID_STEP[subdivision],
      this.#sheet.swing,
    )
    return from + (target - beat) * this.secPerBeat
  }
}
