// NoteLog (audio.md §9.2): a 512-entry ring buffer of every scheduled note and SFX, readable from
// `__pm.audio.log`; with `?audiolog=1` each entry is also printed as `♪ 12:2.65 bass 41 v95 d0.95` / `♪ sfx tap`.

export interface NoteLogNote {
  /** context time the note is scheduled at (seconds) */
  t: number
  bar: number
  beat: number
  part: string
  midi: number
  vel: number
  /** beats for band notes, seconds for stingers */
  dur: number
  /** stingers: all notes of a chord / roll in this entry (midi = the lowest) */
  chord?: number[]
  /** stingers: which hook played it */
  stinger?: string
}

export interface NoteLogSfx {
  t: number
  sfx: string
  /** set when the sound could not play (context not running, throttled, unknown, disabled) */
  dropped?: string
}

export interface NoteLogInfo {
  t: number
  info: string
}

export type NoteLogEntry = NoteLogNote | NoteLogSfx | NoteLogInfo

function fmt(n: number, places: number): string {
  return Number(n.toFixed(places)).toString()
}

export class NoteLog {
  readonly capacity: number
  print: boolean
  #buf: NoteLogEntry[] = []
  #head = 0
  #total = 0

  constructor(capacity = 512, print = false) {
    this.capacity = capacity
    this.print = print
  }

  #push(e: NoteLogEntry, line: string): void {
    if (this.#buf.length < this.capacity) this.#buf.push(e)
    else {
      this.#buf[this.#head] = e
      this.#head = (this.#head + 1) % this.capacity
    }
    this.#total++
    if (this.print) console.log(line)
  }

  note(e: NoteLogNote): void {
    this.#push(
      e,
      e.stinger
        ? `♪ ${e.stinger} ${e.part} ${(e.chord ?? [e.midi]).join('/')} v${e.vel} d${fmt(e.dur, 2)}s`
        : `♪ ${e.bar}:${fmt(e.beat, 2)} ${e.part} ${e.midi} v${e.vel} d${fmt(e.dur, 2)}`,
    )
  }

  sfx(name: string, t: number, dropped?: string): void {
    this.#push(
      dropped ? { t, sfx: name, dropped } : { t, sfx: name },
      dropped ? `♪ sfx ${name} (dropped: ${dropped})` : `♪ sfx ${name}`,
    )
  }

  info(text: string, t = 0): void {
    this.#push({ t, info: text }, `♪ ${text}`)
  }

  /** Oldest first. */
  entries(): NoteLogEntry[] {
    return [...this.#buf.slice(this.#head), ...this.#buf.slice(0, this.#head)]
  }

  notes(part?: string): NoteLogNote[] {
    return this.entries().filter(
      (e): e is NoteLogNote =>
        'part' in e && (part === undefined || e.part === part),
    )
  }

  sfxEntries(): NoteLogSfx[] {
    return this.entries().filter((e): e is NoteLogSfx => 'sfx' in e)
  }

  /** Entries written since the log was created (the buffer keeps the last `capacity`). */
  get total(): number {
    return this.#total
  }

  get size(): number {
    return this.#buf.length
  }

  clear(): void {
    this.#buf = []
    this.#head = 0
  }
}
