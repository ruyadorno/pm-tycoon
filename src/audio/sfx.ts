// One-shot SFX (audio.md §7): every sfx.json entry rendered once to an AudioBuffer (works while the context is
// suspended) and played on the sfx bus. Gated on the unlock gesture and ctx.state === 'running' and never
// queued: a sound that cannot play now is dropped and logged. Throttles per audio.json throttleMs.
// Rendering is lazy: the director renders the buffers one per macrotask after boot (renderOne), and a sound
// played before its turn renders on demand. Each name keeps the seed of its table position, so the buffers are
// bit-identical whatever the order.
import { playBuffer, renderZzfx } from './brushes.ts'
import type { AudioConfig, SfxTable } from './data.ts'
import { BRUSH_NAMES } from './data.ts'
import type { NoteLog } from './log.ts'

/** Sounds that share one throttle window (the three honks: 1 per 3 s overall). */
const THROTTLE_GROUP: Readonly<Record<string, string>> = {
  bell: 'honk',
  horn: 'honk',
  airHorn: 'honk',
}

export interface SfxPlayOptions {
  /** playbackRate (paydayShort = 0.7) */
  rate?: number
  /** gain multiplier on top of the zzfx volume */
  gain?: number
  /** seconds from now (sample-accurate chaining on the audio clock, e.g. the hiss 150 ms after a ping) */
  delayS?: number
  /** skip the throttle (debug only) */
  force?: boolean
  /**
   * timer tolerance for loops that run at the throttle period (setInterval drifts): the throttle window shrinks
   * by this much, so a loop tick never loses its turn and two plays are never closer than window - slack
   */
  slackMs?: number
}

export interface SfxDeps {
  ctx: AudioContext | null
  bus: AudioNode | null
  table: SfxTable
  config: AudioConfig
  log: NoteLog
  /** false while the director is disabled */
  enabled: () => boolean
  /** true once the unlock gesture happened: nothing sounds before it, whatever the autoplay policy allows */
  armed: () => boolean
  /** true when a drop is unexpected (unlocked, visible): only those are counted */
  countDrops: () => boolean
  onDropped: () => void
  /** real-time clock for throttles (performance.now) */
  now?: () => number
}

export class Sfx {
  #d: SfxDeps
  #buffers = new Map<string, AudioBuffer>()
  /** one-shot name -> zzfx seed (7, 8, … in table order, ride/hat excluded) */
  #seeds = new Map<string, number>()
  /** names whose render threw (tried once) */
  #failed = new Set<string>()
  #last = new Map<string, number>()
  #live = new Set<AudioBufferSourceNode>()
  #renderMs = 0
  readonly errors: string[] = []

  constructor(deps: SfxDeps) {
    this.#d = deps
    let seed = 7
    for (const name of Object.keys(deps.table)) {
      if ((BRUSH_NAMES as readonly string[]).includes(name)) continue
      this.#seeds.set(name, seed++)
    }
  }

  /** Renders every one-shot entry not rendered yet (not ride/hat). Returns the time this call took in ms. */
  render(): number {
    if (!this.#d.ctx || !this.#d.enabled()) return 0
    const t0 = performance.now()
    for (const name of this.pending()) this.renderOne(name)
    return performance.now() - t0
  }

  /** One-shot names neither rendered nor failed yet. */
  pending(): string[] {
    return [...this.#seeds.keys()].filter(
      (n) => !this.#buffers.has(n) && !this.#failed.has(n),
    )
  }

  /** Renders `name` if it is a one-shot not rendered yet; returns its buffer (undefined: unknown or broken). */
  renderOne(name: string): AudioBuffer | undefined {
    const done = this.#buffers.get(name)
    if (done) return done
    const { ctx, table, config } = this.#d
    const seed = this.#seeds.get(name)
    if (!ctx || !this.#d.enabled() || seed === undefined) return undefined
    if (this.#failed.has(name)) return undefined
    const t0 = performance.now()
    try {
      // a broken entry (not an array) throws here and is recorded below
      const buf = renderZzfx(
        ctx,
        table[name] as number[],
        config.sfx.sampleRate,
        seed,
      )
      this.#buffers.set(name, buf)
      return buf
    } catch (err) {
      // one bad parameter array costs that sound only
      this.#failed.add(name)
      this.errors.push(`sfx ${name}: ${(err as Error)?.message ?? err}`)
      return undefined
    } finally {
      this.#renderMs += performance.now() - t0
    }
  }

  /** Total render time so far (ms). */
  get renderMs(): number {
    return this.#renderMs
  }

  names(): string[] {
    return [...this.#buffers.keys()]
  }

  has(name: string): boolean {
    return this.#buffers.has(name)
  }

  buffer(name: string): AudioBuffer | undefined {
    return this.#buffers.get(name)
  }

  /** Plays `name` now (or `delayS` later on the audio clock). Returns false when dropped. */
  play(name: string, opts: SfxPlayOptions = {}): boolean {
    const { ctx, bus, log, config } = this.#d
    const t = ctx?.currentTime ?? 0
    const drop = (why: string, counted: boolean): false => {
      log.sfx(name, t, why)
      if (counted) this.#d.onDropped()
      return false
    }
    if (!this.#d.enabled() || !ctx || !bus) return drop('disabled', false)
    const buf = this.renderOne(name)
    if (!buf) return drop('unknown', true)
    if (!this.#d.armed()) return drop('locked', false)
    if (ctx.state !== 'running')
      return drop(`context ${ctx.state}`, this.#d.countDrops())
    const key = THROTTLE_GROUP[name] ?? name
    const window = Math.max(
      0,
      (config.throttleMs[key] ?? 0) - (opts.slackMs ?? 0),
    )
    const now = (this.#d.now ?? (() => performance.now()))()
    if (!opts.force && window > 0) {
      const last = this.#last.get(key)
      if (last !== undefined && now - last < window)
        return drop('throttled', false)
    }
    this.#last.set(key, now)
    const when = t + Math.max(0, opts.delayS ?? 0)
    const src = playBuffer(
      ctx,
      buf,
      when,
      config.sfx.zzfxVolume * (opts.gain ?? 1),
      bus,
      opts.rate ?? 1,
    )
    this.#live.add(src)
    src.addEventListener('ended', () => this.#live.delete(src))
    log.sfx(name, when)
    return true
  }

  /** Stops every sounding SFX (tab hide). */
  stopAll(): void {
    for (const src of this.#live) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    }
    this.#live.clear()
  }
}
