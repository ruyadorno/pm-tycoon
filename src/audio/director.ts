// AudioDirector (audio.md §3): one per game, created in Boot and kept in the registry under 'audio'; scenes never
// own audio. It owns the bus graph (master -> music / sfx), the unlock, mute, visibility, the sim/UI event
// subscriptions (§6, §7) and the debug surface (§9). See the integration notes at the bottom of this file.
import { SampleLoader } from 'smplr'
import type { Part } from './arranger.ts'
import { Band } from './band.ts'
import { type BrushBuffers, renderBrushes } from './brushes.ts'
import { tonicChord } from './chords.ts'
import { type ContextState, contextState } from './context.ts'
import {
  type AudioConfig,
  type AudioData,
  defaultAudioData,
  fallbackAudioData,
  INSTRUMENT_IDS,
  type InstrumentId,
  samplerGain,
} from './data.ts'
import { InstrumentBank } from './instruments.ts'
import type { LeadSheet } from './leadsheet.ts'
import { NoteLog } from './log.ts'
import type { RenderWavResult } from './offline.ts'
import { Sfx } from './sfx.ts'
import { Stingers, sizeIndex } from './stingers.ts'
import { bindToneClock, getTransport, isToneBound, toneStart } from './tone.ts'

// ------------------------------------------------------------------ inputs

/** URL switches (audio.md §9.1). */
export interface AudioParams {
  /** `?audio=0`: no fetch, no Transport; every method only logs */
  disabled: boolean
  /** `?mute=1`: start muted without writing localStorage */
  muted: boolean
  /** `?audiolog=1`: print every note/SFX to the console */
  log: boolean
}

export function readAudioParams(search?: string): AudioParams {
  const q = new URLSearchParams(search ?? globalThis.location?.search ?? '')
  return {
    disabled: q.get('audio') === '0',
    muted: q.get('mute') === '1',
    log: q.get('audiolog') === '1',
  }
}

/** Where the mute flag persists (`pm.settings.v1` {muted, speed}; other keys are preserved). */
export interface SettingsStore {
  readMuted(): boolean | null
  writeMuted(muted: boolean): void
}

export function localSettingsStore(key = 'pm.settings.v1'): SettingsStore {
  const read = (): Record<string, unknown> => {
    try {
      const raw = globalThis.localStorage?.getItem(key)
      const v: unknown = raw ? JSON.parse(raw) : {}
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {
    readMuted() {
      const m = read().muted
      return typeof m === 'boolean' ? m : null
    },
    writeMuted(muted) {
      try {
        globalThis.localStorage?.setItem(
          key,
          JSON.stringify({ ...read(), muted }),
        )
      } catch {
        // private mode / quota: the mute still applies for this session
      }
    },
  }
}

/** Minimal emitter shape: Phaser's game.events and the sim's eventemitter3 both fit. */
export interface Emitter {
  // oxlint-disable-next-line no-explicit-any -- structural fit for eventemitter3's generic signatures
  on(event: any, fn: any, context?: any): unknown
  // oxlint-disable-next-line no-explicit-any
  off(event: any, fn?: any, context?: any): unknown
  // oxlint-disable-next-line no-explicit-any
  emit(event: any, ...args: any[]): unknown
}

/** Optional lookups the sim events do not carry (all fall back to something sensible). */
export interface SimLookups {
  /** vehicle type for `vehicle:queued` honks; default guesses from the id ('bike…', 'truck…', else van) */
  vehicleType?: (vehicleId: string) => string | undefined
  /** parcel size for the cash chord velocity; default = the size seen on `parcel:spawned`, else 'S' */
  parcelSize?: (parcelId: string) => string | undefined
  /** Hold Bay occupancy for the hiss loop; default counts held/tossed/cleared_by_player events */
  holdBayCount?: () => number
  /** true while the sim is paused (0× or a modal card): the hiss/stall/grumble loops wait */
  isPaused?: () => boolean
}

export interface AudioDirectorOptions {
  /** the shared context from createSharedContext(); null = no Web Audio (director disabled) */
  ctx: AudioContext | null
  params?: Partial<AudioParams>
  /** default: localStorage 'pm.settings.v1'; null = never persist */
  settings?: SettingsStore | null
  /** game.events: UI events in (ui:tap, ui:sheetOpen/Close, ui:sfx, hidden, visible), audio:* events out */
  events?: Emitter | null
  /** game.registry: the director registers itself as 'audio' */
  registry?: { set(key: string, value: unknown): unknown } | null
  /** tables (default: src/data/audio.json, sfx.json, music/*.json) */
  data?: AudioData
  /** base URL of public/audio/sf/ (default `${import.meta.env.BASE_URL}audio/sf/`) */
  sfBase?: string
}

export interface AudioState {
  ctxState: ContextState | 'none'
  unlocked: boolean
  muted: boolean
  disabled: boolean
  music: 'live' | 'off'
  hidden: boolean
  transport: {
    state: 'started' | 'stopped' | 'paused'
    position: string
    bpm: number
    bar: number
    beat: number
  }
  loaded: Record<InstrumentId, boolean>
  nowPlaying: string | null
  /** notes + brush hits handed to Web Audio */
  scheduled: number
  /** sounds that should have played but could not (counted only after the unlock) */
  dropped: number
  /** band notes skipped because their instrument was still loading */
  skipped: number
  sfxRenderMs: number
  errors: string[]
}

export interface AudioDebugApi {
  state(): AudioState
  log: NoteLog
  unlock(): Promise<void>
  sfx(name: string): boolean
  hook(event: string, payload?: Record<string, unknown>): void
  chord(): string
  /** offline render of `bars` bars from `fromBar` (default 0), optionally only some parts (§9.5) */
  renderWav(
    bars?: number,
    parts?: Part[],
    fromBar?: number,
  ): Promise<RenderWavResult>
  mute(muted?: boolean): boolean
  director: AudioDirector
}

const MUSIC_PARTS: Part[] = ['bass', 'piano', 'trumpet']
const STINGER_IDS: readonly InstrumentId[] = [
  'piano2',
  'bass2',
  'vibes2',
  'trumpet2',
]
/**
 * Events that may resume an AudioContext: pointerdown is what the plan names, but on touch screens only
 * pointerup / touchend are activation-triggering (HTML spec), so a retry listens to all of them.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const
type LoopName = 'hiss' | 'stallAlarm' | 'grumble'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ------------------------------------------------------------------ director

export class AudioDirector {
  readonly ctx: AudioContext | null
  readonly disabled: boolean
  readonly config: AudioConfig
  readonly data: AudioData
  readonly log: NoteLog
  readonly sfx: Sfx
  readonly stingers: Stingers
  /** null while disabled */
  readonly band: Band | null = null
  readonly bank: InstrumentBank | null = null

  #settings: SettingsStore | null
  #events: Emitter | null
  #master: GainNode | null = null
  #music: GainNode | null = null
  #brushes: BrushBuffers | null = null
  #muted: boolean
  /** the unlock gesture happened (set synchronously in unlock()): nothing sounds before it */
  #armed = false
  /** the context resumed after the unlock gesture */
  #unlocked = false
  #hidden = false
  #resuming = false
  #resumeBand = false
  #dropped = 0
  #errors: string[] = []
  #nowPlaying: string | null = null
  #wantSheet: string | null = null
  #musicReady: Promise<boolean> | null = null
  #preloading: Promise<void> | null = null
  #tapeTimer: ReturnType<typeof setTimeout> | null = null
  #sfxTimer: ReturnType<typeof setTimeout> | null = null
  #unwatch: (() => void) | null = null
  #detach: (() => void)[] = []
  #sim: Emitter | null = null
  #lookups: SimLookups = {}
  #holdCount = 0
  #sizes = new Map<string, string>()
  #loops = new Map<LoopName, ReturnType<typeof setInterval>>()

  constructor(o: AudioDirectorOptions) {
    let data: AudioData
    let dataError: string | null = null
    try {
      data = o.data ?? defaultAudioData()
    } catch (err) {
      // a broken table must not take the game down: run disabled and say why in state().errors
      dataError = `audio data invalid: ${message(err)}`
      data = fallbackAudioData()
    }
    this.data = data
    this.config = data.config
    const params: AudioParams = {
      disabled: false,
      muted: false,
      log: false,
      ...o.params,
    }
    this.ctx = o.ctx
    this.log = new NoteLog(512, params.log)
    if (dataError) this.#fail('data', dataError)
    this.#settings =
      o.settings === undefined ? localSettingsStore() : o.settings
    const stored = this.#guard('settings', () => this.#settings?.readMuted())
    this.#muted = params.muted || (stored ?? false)
    this.#events = o.events ?? null
    const ctx = this.ctx
    const sfxDeps = {
      table: this.data.sfx,
      config: this.config,
      log: this.log,
      enabled: () => !this.disabled,
      armed: () => this.#armed,
      countDrops: () => this.#countDrops(),
      onDropped: () => this.#dropped++,
    }

    let disabled = params.disabled || !ctx || dataError !== null
    let sfx = new Sfx({ ctx, bus: null, ...sfxDeps })
    if (!disabled && ctx) {
      try {
        const built = this.#build(ctx, o, sfxDeps)
        sfx = built.sfx
        this.bank = built.bank
        this.band = built.band
      } catch (err) {
        this.#fail('audio setup failed (running without sound)', err)
        disabled = true
      }
    }
    this.disabled = disabled
    this.sfx = sfx
    if (!disabled) this.#renderSfxInSlices()
    this.stingers = new Stingers({
      ctx,
      bank: () => this.bank,
      band: () => this.band,
      config: this.config,
      log: this.log,
      active: () => !this.disabled && this.#armed && ctx?.state === 'running',
      key: () => this.band?.sheet?.key ?? this.#defaultSheet()?.key ?? 'F',
    })
    const events = this.#events
    if (events) this.#guard('attachGame', () => this.attachGame(events))
    this.#guard('registry', () => o.registry?.set('audio', this))
    this.log.info(
      this.disabled
        ? 'audio director disabled (?audio=0, no Web Audio or a setup error)'
        : `audio director ready (muted ${this.#muted})`,
    )
  }

  /** The enabled graph (audio.md §2); throws on any Web Audio failure, which the constructor turns into disabled. */
  #build(
    ctx: AudioContext,
    o: AudioDirectorOptions,
    sfxDeps: Omit<ConstructorParameters<typeof Sfx>[0], 'ctx' | 'bus'>,
  ): { sfx: Sfx; bank: InstrumentBank; band: Band } {
    // ctx.destination <- limiter <- master (mute) <- music bus / sfx bus (§2); smplr outputs enter each bus
    // through a make-up trim, brushes and zzfx buffers enter the buses directly
    const b = this.config.buses
    const lim = this.config.limiter
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = lim.thresholdDb
    limiter.knee.value = lim.kneeDb
    limiter.ratio.value = lim.ratio
    limiter.attack.value = lim.attackS
    limiter.release.value = lim.releaseS
    limiter.connect(ctx.destination)
    const master = ctx.createGain()
    master.gain.value = this.#muted ? 0 : b.master
    master.connect(limiter)
    const music = ctx.createGain()
    music.gain.value = b.music
    music.connect(master)
    const sfxBus = ctx.createGain()
    sfxBus.gain.value = b.sfx
    sfxBus.connect(master)
    const musicSamplers = ctx.createGain()
    musicSamplers.gain.value = samplerGain(this.config)
    musicSamplers.connect(music)
    const stingerSamplers = ctx.createGain()
    stingerSamplers.gain.value = samplerGain(this.config)
    stingerSamplers.connect(sfxBus)
    // the zzfx buffers render after construction, one per macrotask (#renderSfxInSlices)
    const sfx = new Sfx({ ctx, bus: sfxBus, ...sfxDeps })
    const bank = new InstrumentBank({
      ctx,
      loader: SampleLoader(ctx),
      config: this.config,
      destinations: { music: musicSamplers, stingers: stingerSamplers },
      log: this.log,
      ...(o.sfBase ? { sfBase: o.sfBase } : {}),
    })
    // Tone gets the shared context before any Tone object exists (audio.md §2)
    bindToneClock(ctx, this.config.lookAheadS)
    const band = new Band({
      ctx,
      bank,
      bus: music,
      config: this.config,
      log: this.log,
      onPassStart: (title) => this.#passStart(title),
      onDropped: () => {
        if (this.#countDrops()) this.#dropped++
      },
    })
    const sheet = this.#defaultSheet()
    if (sheet && this.#brushesOn(sheet)) {
      try {
        this.#brushes = renderBrushes(
          ctx,
          this.data.sfx,
          this.config.sfx.sampleRate,
        )
      } catch (err) {
        this.#fail('brushes', err)
      }
    }
    this.#master = master
    this.#music = music
    const win = globalThis.window as Window | undefined
    if (win?.addEventListener) {
      const onPageHide = () => this.onHidden()
      win.addEventListener('pagehide', onPageHide)
      this.#detach.push(() => win.removeEventListener('pagehide', onPageHide))
    }
    // iOS: a call or Siri can interrupt a visible page; when the context drops out of 'running' on its own, the
    // next tap resumes it (and the band, if it was paused) — never a burst of queued notes
    const onState = () =>
      this.#guard('statechange', () => {
        if (this.#hidden || !this.#unlocked) return
        if (ctx.state === 'running') {
          if (this.#unwatch) this.#afterResume()
        } else {
          this.log.info(
            `context ${ctx.state}: resume on next tap`,
            ctx.currentTime,
          )
          this.#watchGestures()
        }
      })
    ctx.addEventListener?.('statechange', onState)
    this.#detach.push(() => ctx.removeEventListener?.('statechange', onState))
    return { sfx, bank, band }
  }

  /**
   * audio.md §3.1 budgets < 5 ms for the 18 zzfx renders; they take ~50 ms in headless SwiftShader, which would
   * all land in Boot. Instead each buffer renders in its own macrotask (~3 ms) right after construction, and a
   * sound played before its turn renders on demand (Sfx.play). Render errors show in state().errors.
   */
  #renderSfxInSlices(): void {
    const sfx = this.sfx
    const queue = sfx.pending()
    const step = () => {
      this.#sfxTimer = null
      const name = queue.shift()
      if (name === undefined) {
        this.log.info(
          `sfx rendered ${sfx.names().length} buffers in ${sfx.renderMs.toFixed(1)} ms`,
        )
        return
      }
      this.#guard('sfx render', () => sfx.renderOne(name))
      this.#sfxTimer = setTimeout(step, 0)
    }
    this.#sfxTimer = setTimeout(step, 0)
  }

  // ---------------------------------------------------------------- lifecycle

  /** Starts fetching piano + bass, then vibes + trumpet, then the stinger set (never awaited by the game). */
  preload(): Promise<void> {
    if (this.disabled || !this.bank) {
      this.log.info('preload (disabled)')
      return Promise.resolve()
    }
    if (this.#preloading) return this.#preloading
    const bank = this.bank
    const [first = [], ...rest] = this.config.loadOrder
    this.#musicReady = bank.load(first).then((ok) => {
      this.#emit('audio:ready', { parts: this.#loadedParts() })
      return ok
    })
    let chain: Promise<unknown> = this.#musicReady
    for (const group of rest) {
      chain = chain
        .then(() => bank.load(group))
        .then(() => this.#emit('audio:ready', { parts: this.#loadedParts() }))
    }
    this.#preloading = chain.then(
      () => undefined,
      (err: unknown) => this.#fail('preload', err),
    )
    return this.#preloading
  }

  /**
   * Title tap handler: call it synchronously inside the pointerdown (no await before it). Resumes the context
   * and Tone in the gesture, then starts the music once piano + bass are decoded. Nothing sounds before the
   * first call, whatever the browser's autoplay policy allows. Never throws.
   */
  unlock(): Promise<void> {
    const ctx = this.ctx
    if (this.disabled || !ctx) {
      this.log.info('unlock (disabled)')
      return Promise.resolve()
    }
    this.#armed = true
    this.#hidden = false
    let resumed: Promise<unknown>
    try {
      // both inside the gesture (audio.md §3): the shared context, then Tone (same context; a no-op once running)
      resumed = Promise.all([
        ctx.state === 'running' ? undefined : ctx.resume(),
        toneStart(),
      ])
    } catch (err) {
      resumed = Promise.reject(err)
    }
    this.#primeSilentBuffer(ctx)
    this.#checkRunningLater()
    void this.preload()
    return resumed
      .then(() => {
        this.#markUnlocked()
        this.log.info(`unlocked (context ${ctx.state})`, ctx.currentTime)
        if (this.config.music === 'live')
          this.startMusic(this.#wantSheet ?? this.config.defaultSheet)
      })
      .catch((err: unknown) => {
        this.log.info(`unlock failed: ${message(err)}`)
        this.#watchGestures()
      })
  }

  /**
   * For flows without a Title tap (`?skipTitle=1`): unlock on the first tap anywhere (listens until the context
   * runs). Returns a detach function.
   */
  unlockOnFirstGesture(): () => void {
    const doc = globalThis.document
    const ctx = this.ctx
    if (this.disabled || !ctx || !doc) return () => {}
    const handler = () => {
      void this.unlock()
      if (ctx.state === 'running') off()
    }
    const off = () => {
      for (const e of GESTURES) doc.removeEventListener(e, handler, true)
    }
    for (const e of GESTURES) doc.addEventListener(e, handler, true)
    this.#detach.push(off)
    return off
  }

  /** Idempotent: starts `sheetId` from bar 0 (after the unlock and once piano + bass are ready). Never throws. */
  startMusic(sheetId = this.config.defaultSheet): void {
    if (this.disabled || !this.band || !this.bank) {
      this.log.info(`startMusic ${sheetId} (disabled)`)
      return
    }
    if (this.config.music === 'off') {
      this.log.info('startMusic skipped (audio.json music: off)')
      return
    }
    const sheet = this.data.sheets[sheetId]
    if (!sheet) {
      this.log.info(`startMusic: unknown sheet ${sheetId}`)
      return
    }
    this.#wantSheet = sheetId
    if (!this.#unlocked) return // unlock() starts it
    const band = this.band
    const bank = this.bank
    this.#guard('startMusic', () => {
      if (!bank.isLoaded('piano') || !bank.isLoaded('bass')) {
        void this.preload()
        void this.#musicReady?.then((ok) => {
          if (ok && this.#wantSheet === sheetId && band.state !== 'started')
            this.startMusic(sheetId)
          else if (!ok)
            this.log.info('music not started: piano/bass failed to load')
        })
        return
      }
      if (band.sheet !== sheet)
        band.load(sheet, this.#brushes, this.#partsFor(sheet))
      if (band.state === 'started') return
      band.start()
      this.log.info(`music start ${sheetId}`, this.ctx?.currentTime ?? 0)
    })
  }

  /** Transport.stop + every music voice off (game over, New game). */
  stopMusic(): void {
    this.#wantSheet = null
    this.#nowPlaying = null
    this.#guard('stopMusic', () => {
      this.#cancelTapeStop()
      this.band?.stop()
    })
    this.log.info('music stop', this.ctx?.currentTime ?? 0)
  }

  isMuted(): boolean {
    return this.#muted
  }

  /** Master gain ramp (50 ms); the Transport keeps running. Persists to pm.settings.v1; emits 'audio:muted'. */
  setMuted(muted: boolean, persist = true): void {
    this.#muted = muted
    const g = this.#master?.gain
    const ctx = this.ctx
    if (g && ctx) {
      this.#guard('setMuted', () => {
        const t = ctx.currentTime
        g.cancelScheduledValues(t)
        g.setValueAtTime(g.value, t)
        g.linearRampToValueAtTime(
          muted ? 0 : this.config.buses.master,
          t + this.config.muteRampS,
        )
      })
    }
    if (persist)
      this.#guard('settings', () => this.#settings?.writeMuted(muted))
    this.#emit('audio:muted', { muted })
    this.log.info(muted ? 'muted' : 'unmuted', ctx?.currentTime ?? 0)
  }

  toggleMuted(): boolean {
    this.setMuted(!this.#muted)
    return this.#muted
  }

  /** Phaser HIDDEN / window pagehide: pause the band, cut every voice and suspend the context. */
  onHidden(): void {
    const ctx = this.ctx
    if (this.disabled || !ctx || this.#hidden) return
    this.#hidden = true
    this.#guard('onHidden', () => {
      const tapePending = this.#cancelTapeStop()
      this.#resumeBand =
        this.#resumeBand || tapePending || this.band?.state === 'started'
      this.band?.pause()
      // stingers too: a minor tag or level-up sting must not finish after the Paused-card tap
      this.bank?.stop(STINGER_IDS)
      this.sfx.stopAll()
      ctx.suspend().catch(() => {})
    })
    this.#watchGestures()
    this.log.info('hidden: band paused, context suspended', ctx.currentTime)
  }

  /**
   * The Paused-card tap (call it inside the pointerdown): resume the context, then the band where it stopped.
   * If iOS leaves the context 'interrupted', the next tap anywhere retries. Never throws.
   */
  resumeAfterPause(): Promise<void> {
    const ctx = this.ctx
    if (this.disabled || !ctx) return Promise.resolve()
    this.#hidden = false
    this.#resuming = true
    let p: Promise<void>
    try {
      p = ctx.state === 'running' ? Promise.resolve() : ctx.resume()
    } catch (err) {
      p = Promise.reject(err)
    }
    return p
      .then(() => this.#afterResume())
      .catch((err: unknown) => {
        this.log.info(`resume failed: ${message(err)}`)
        this.#watchGestures()
      })
      .finally(() => {
        this.#resuming = false
        this.#checkRunningLater()
      })
  }

  // ---------------------------------------------------------------- events

  /** UI + visibility events on game.events. Called by the constructor when `events` is given. */
  attachGame(events: Emitter): () => void {
    const on = (name: string, fn: (p?: unknown) => void) => {
      const safe = (p?: unknown) => this.#guard(`game ${name}`, () => fn(p))
      events.on(name, safe)
      const off = () => events.off(name, safe)
      this.#detach.push(off)
      return off
    }
    const offs = [
      on('hidden', () => this.onHidden()), // Phaser.Core.Events.HIDDEN
      on('visible', () => this.#watchGestures()), // Phaser.Core.Events.VISIBLE: nothing plays until a tap
      on('ui:tap', () => this.sfx.play('tap')),
      on('ui:sheetOpen', () => this.sfx.play('sheetOpen')),
      on('ui:sheetClose', () => this.sfx.play('sheetClose')),
      on('ui:sfx', (p) =>
        this.playNamed(String((p as { name?: string })?.name)),
      ),
    ]
    return () => offs.forEach((off) => off())
  }

  /** Any sfx.json key, plus 'paydayShort'. Used by `ui:sfx {name}` and the debug API. Never throws. */
  playNamed(name: string): boolean {
    return (
      this.#guard(`sfx ${name}`, () =>
        name === 'paydayShort'
          ? this.sfx.play('payday', { rate: this.config.sfx.paydayShortRate })
          : this.sfx.play(name),
      ) ?? false
    )
  }

  /**
   * Subscribes to the sim's events (audio.md §6, §7). Handlers only play sounds; they never dispatch, and an
   * audio failure never propagates into the sim's emit (and so never into Sim.tick). Returns a detach function
   * (also run by destroy()).
   */
  attachSim(simEvents: Emitter, lookups: SimLookups = {}): () => void {
    this.#sim = simEvents
    this.#lookups = lookups
    const names = [
      'parcel:spawned',
      'parcel:pickedUp',
      'parcel:delivered',
      'parcel:flagged',
      'parcel:held',
      'parcel:tossed',
      'parcel:cleared_by_player',
      'parcel:cleared',
      'life:lost',
      'game:over',
      'money:changed',
      'vehicle:queued',
      'payroll:paid',
      'payroll:short',
      'level:up',
      'region:unlocked',
      'lane:stalled',
      'lane:resumed',
      // build 2 M7 (design-m7 §6.9)
      'quest:offered',
      'quest:completed',
      'game:victory',
    ]
    const fns = names.map((name) => {
      const fn = (payload?: unknown) => this.#onSim(name, payload ?? {})
      simEvents.on(name, fn)
      return [name, fn] as const
    })
    const detach = () => {
      for (const [name, fn] of fns) simEvents.off(name, fn)
      if (this.#sim === simEvents) this.#sim = null
      this.#stopLoops()
    }
    this.#detach.push(detach)
    return detach
  }

  /** Debug: fire a sim event (through the sim's emitter when attached, so the HUD reacts too). */
  hook(event: string, payload: Record<string, unknown> = {}): void {
    this.log.info(`hook ${event}`, this.ctx?.currentTime ?? 0)
    if (this.#sim) {
      const sim = this.#sim
      this.#guard(`hook ${event}`, () => sim.emit(event, payload))
    } else this.#onSim(event, payload)
  }

  /** District panel open with satisfaction < 30 (spec §9.2): grumble now and every 20 s while active. */
  setGrumble(active: boolean): void {
    this.#guard('setGrumble', () => this.#setLoop('grumble', active))
  }

  #onSim(name: string, payload: unknown): void {
    this.#guard(`sim ${name}`, () => this.#simEvent(name, payload))
  }

  #simEvent(name: string, payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : String(p.id ?? '')
    switch (name) {
      case 'parcel:spawned':
        if (typeof p.size === 'string') {
          if (this.#sizes.size > 2000) this.#sizes.clear()
          this.#sizes.set(id, p.size)
        }
        break
      case 'parcel:pickedUp':
        this.sfx.play('pickup')
        break
      case 'parcel:delivered': {
        const size = this.#lookups.parcelSize?.(id) ?? this.#sizes.get(id)
        this.#sizes.delete(id)
        if (Number(p.paid) > 0)
          this.stingers.cashChord(sizeIndex(size), p.onTime !== false)
        break
      }
      case 'parcel:flagged':
        this.sfx.play('scannerPing')
        this.sfx.play('hiss', {
          delayS: this.config.sfx.scannerHissDelayMs / 1000,
        })
        break
      case 'parcel:held':
        this.#holdCount++
        this.#updateHissLoop()
        break
      case 'parcel:tossed':
        this.#holdCount = Math.max(0, this.#holdCount - 1)
        this.#sizes.delete(id)
        if (p.wasMalware) this.stingers.defused()
        else {
          this.stingers.oops()
          this.sfx.play('wah')
        }
        this.#updateHissLoop()
        break
      case 'parcel:cleared_by_player':
        this.#holdCount = Math.max(0, this.#holdCount - 1)
        this.#updateHissLoop()
        break
      case 'parcel:cleared':
        this.#sizes.delete(id)
        break
      case 'life:lost':
        this.#tapeStop()
        break
      case 'game:over':
        this.stopMusic()
        this.stingers.minorTag()
        break
      case 'money:changed':
        if (
          Number(p.delta) < 0 &&
          (p.reason === 'purchase' || p.reason === 'hire')
        )
          this.sfx.play('buy')
        break
      case 'vehicle:queued':
        if (Number(p.position) >= 1) this.sfx.play(this.#honkFor(id))
        break
      case 'payroll:paid':
        this.sfx.play('payday')
        break
      case 'payroll:short':
        this.sfx.play('payday', { rate: this.config.sfx.paydayShortRate })
        break
      case 'level:up':
        this.stingers.levelUp()
        break
      case 'region:unlocked':
        this.sfx.play('regionUnlocked')
        break
      case 'lane:stalled':
        this.#setLoop('stallAlarm', true)
        break
      case 'lane:resumed':
        this.#setLoop('stallAlarm', false)
        break
      case 'quest:offered':
        this.sfx.play('bell')
        break
      case 'quest:completed':
        this.sfx.play('questDone')
        break
      case 'game:victory':
        this.#victory()
        break
      default:
        this.log.info(`hook ${name}: no audio`)
    }
  }

  #honkFor(vehicleId: string): string {
    const type = (
      this.#lookups.vehicleType?.(vehicleId) ?? vehicleId
    ).toLowerCase()
    if (type.includes('bike')) return 'bell'
    if (type.includes('truck')) return 'airHorn'
    return 'horn'
  }

  // ---------------------------------------------------------------- loops (hiss, stall alarm, grumble)

  #loopsBlocked(): boolean {
    return this.#hidden || this.#lookups.isPaused?.() === true
  }

  /**
   * hiss (every 4 s while the Hold Bay holds a parcel), stallAlarm (now, then every 8 s until lane:resumed),
   * grumble (now, then every 20 s while the panel is open). Every play goes through the sound's own throttle
   * (audio.md §7 "1 per N s"), loop ticks with a small timer slack, so toggling a loop never doubles a sound.
   */
  #setLoop(name: LoopName, on: boolean): void {
    const existing = this.#loops.get(name)
    if (!on) {
      if (existing !== undefined) clearInterval(existing)
      this.#loops.delete(name)
      return
    }
    if (this.disabled || existing !== undefined) return
    const gain = name === 'hiss' ? this.config.sfx.hissLoopGain : 1
    const tick = (slackMs: number) =>
      this.#guard(`loop ${name}`, () => {
        if (name === 'hiss' && this.#holdBay() < 1)
          return this.#setLoop('hiss', false)
        if (!this.#loopsBlocked()) this.sfx.play(name, { gain, slackMs })
      })
    // the hiss loop's first sound is the one chained from the scanner ping
    if (name !== 'hiss') tick(0)
    this.#loops.set(
      name,
      setInterval(
        () => tick(this.config.throttleSlackMs),
        this.config.loopsMs[name],
      ),
    )
  }

  #holdBay(): number {
    return this.#lookups.holdBayCount?.() ?? this.#holdCount
  }

  #updateHissLoop(): void {
    this.#setLoop('hiss', this.#holdBay() >= 1)
  }

  #stopLoops(): void {
    for (const id of this.#loops.values()) clearInterval(id)
    this.#loops.clear()
  }

  // ---------------------------------------------------------------- state hooks

  /** life:lost (§6): music gain -> 0 in 30 ms, band paused one beat, tapeStop + thump, then back in time. */
  #tapeStop(): void {
    this.sfx.play('tapeStop')
    this.sfx.play('thump')
    const ctx = this.ctx
    const band = this.band
    const g = this.#music?.gain
    if (!ctx || !band || !g || band.state !== 'started') return
    const tc = this.config.lifeLost.rampS / 3
    g.cancelScheduledValues(ctx.currentTime)
    g.setTargetAtTime(0, ctx.currentTime, tc)
    band.pause()
    this.#cancelTapeStop()
    this.#tapeTimer = setTimeout(
      () =>
        this.#guard('tape-stop resume', () => {
          this.#tapeTimer = null
          this.#restoreMusicGain()
          if (!this.#hidden) band.resume()
        }),
      band.secPerBeat * 1000 * this.config.lifeLost.pauseBeats,
    )
  }

  /**
   * game:victory (build 2, B2 §3.4, design-m7 §6.9): the victory tag, a big-band ending in the key. While the
   * band plays it drops out like the tape-stop (music gain → 0, band.pause(), no tape sfx) and comes back in
   * where it paused when the tag's hold ends; a tag that cannot play (inactive, still loading) leaves the band
   * alone.
   */
  #victory(): void {
    const ctx = this.ctx
    const band = this.band
    const g = this.#music?.gain
    if (!this.stingers.victoryTag()) return
    if (!ctx || !band || !g || band.state !== 'started') return
    this.#cancelTapeStop()
    g.cancelScheduledValues(ctx.currentTime)
    g.setTargetAtTime(0, ctx.currentTime, this.config.lifeLost.rampS / 3)
    band.pause()
    this.#tapeTimer = setTimeout(
      () =>
        this.#guard('victory resume', () => {
          this.#tapeTimer = null
          this.#restoreMusicGain()
          if (!this.#hidden) band.resume()
        }),
      (this.config.lookAheadS + this.stingers.victoryTagSeconds()) * 1000,
    )
  }

  #restoreMusicGain(): void {
    const g = this.#music?.gain
    if (!g || !this.ctx) return
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(
      this.config.buses.music,
      t,
      this.config.lifeLost.rampS / 3,
    )
  }

  /** Cancels a pending tape-stop resume; true if one was pending. */
  #cancelTapeStop(): boolean {
    if (this.#tapeTimer === null) return false
    clearTimeout(this.#tapeTimer)
    this.#tapeTimer = null
    this.#restoreMusicGain()
    return true
  }

  #passStart(title: string): void {
    this.#nowPlaying = title
    this.#emit('audio:nowPlaying', {
      title,
      seconds: this.config.toastSeconds,
    })
  }

  // ---------------------------------------------------------------- unlock / resume helpers

  /** iOS: starting a 1-sample silent buffer inside the gesture completes the unlock on older WebKit. */
  #primeSilentBuffer(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      src.connect(ctx.destination)
      src.start(0)
    } catch {
      // harmless
    }
  }

  /** The context runs again (and the page is visible): stop watching taps, resume the band where it paused. */
  #afterResume(): void {
    if (this.#hidden || this.ctx?.state !== 'running') return
    this.#unwatch?.()
    this.#unwatch = null
    if (this.#armed) this.#markUnlocked()
    if (this.#resumeBand) {
      this.#resumeBand = false
      this.band?.resume()
      this.log.info('band resumed', this.ctx.currentTime)
    }
    if (this.#unlocked && this.#wantSheet && this.band?.state === 'stopped')
      this.startMusic(this.#wantSheet)
  }

  /**
   * The context runs after the unlock gesture. The first time, emits 'audio:unlocked' on game.events so the HUD
   * can drop its "tap for sound" hint (?skipTitle=1 flows, or an iOS Title tap whose resume needed a retry).
   */
  #markUnlocked(): void {
    if (this.#unlocked) return
    this.#unlocked = true
    this.#emit('audio:unlocked', {})
  }

  /** 250 ms after a resume: if the context is still not running (iOS 'interrupted'), retry on the next tap. */
  #checkRunningLater(): void {
    setTimeout(() => {
      if (this.ctx && this.ctx.state !== 'running' && !this.#hidden)
        this.#watchGestures()
    }, this.config.resumeCheckMs)
  }

  /**
   * Until the context runs again, every tap (pointerdown, pointerup, touchend, keydown — capture phase, so it
   * runs before Phaser's handlers) resumes it: the Paused-card tap after a tab hide (even if the HUD forgets to
   * call resumeAfterPause), the retry after iOS leaves the context 'interrupted'. Nothing plays on VISIBLE itself.
   */
  #watchGestures(): void {
    const doc = globalThis.document
    if (this.#unwatch || !doc || this.disabled || !this.ctx) return
    const ctx = this.ctx
    const onGesture = () => {
      try {
        if (this.#hidden) {
          void this.resumeAfterPause()
          return
        }
        if (ctx.state === 'running') this.#afterResume()
        else
          ctx
            .resume()
            .then(() => this.#guard('retry', () => this.#afterResume()))
            .catch(() => {})
      } catch {
        // never throw from a tap
      }
    }
    for (const e of GESTURES) doc.addEventListener(e, onGesture, true)
    this.#unwatch = () => {
      for (const e of GESTURES) doc.removeEventListener(e, onGesture, true)
    }
    this.log.info(`context ${ctx.state}: resume armed on the next tap`)
  }

  // ---------------------------------------------------------------- queries

  /** Drops count only when sound was expected: unlocked, visible, not mid-resume. */
  #countDrops(): boolean {
    return this.#unlocked && !this.#hidden && !this.#resuming
  }

  #defaultSheet(): LeadSheet | undefined {
    return this.data.sheets[this.config.defaultSheet]
  }

  #brushesOn(sheet: LeadSheet): boolean {
    return this.config.brushes.override ?? sheet.parts.brushes
  }

  #partsFor(sheet: LeadSheet): Part[] {
    const parts = [...MUSIC_PARTS]
    if (sheet.parts.vibes) parts.push('vibes')
    if (this.#brushesOn(sheet) && this.#brushes) parts.push('ride', 'hat')
    return parts
  }

  #loadedParts(): string[] {
    return INSTRUMENT_IDS.filter((id) => this.bank?.isLoaded(id))
  }

  #emit(name: string, payload: Record<string, unknown>): void {
    try {
      this.#events?.emit(name, payload)
    } catch (err) {
      this.log.info(`emit ${name} failed: ${message(err)}`)
    }
  }

  /** Runs `fn`; an exception is logged into state().errors instead of reaching the caller. */
  #guard<T>(label: string, fn: () => T, fallback?: T): T | undefined {
    try {
      return fn()
    } catch (err) {
      this.#fail(label, err)
      return fallback
    }
  }

  #fail(label: string, err: unknown): void {
    const msg = `${label}: ${message(err)}`
    if (this.#errors.length < 50) this.#errors.push(msg)
    this.log.info(msg, this.ctx?.currentTime ?? 0)
  }

  state(): AudioState {
    const live = !this.disabled && isToneBound() && this.band
    const T = live ? getTransport() : null
    const pos = live ? live.position() : { bar: 0, beat: 0 }
    const loaded = {} as Record<InstrumentId, boolean>
    for (const id of INSTRUMENT_IDS)
      loaded[id] = this.bank?.isLoaded(id) ?? false
    return {
      ctxState: contextState(this.ctx),
      unlocked: this.#unlocked,
      muted: this.#muted,
      disabled: this.disabled,
      music: this.config.music,
      hidden: this.#hidden,
      transport: T
        ? {
            state: T.state,
            position: String(T.position),
            bpm: Math.round(T.bpm.value),
            bar: pos.bar,
            beat: Math.round(pos.beat * 1000) / 1000,
          }
        : { state: 'stopped', position: '0:0:0', bpm: 0, bar: 0, beat: 0 },
      loaded,
      nowPlaying: this.#nowPlaying,
      scheduled: this.band?.scheduled ?? 0,
      dropped: this.#dropped,
      skipped: this.band?.skipped ?? 0,
      sfxRenderMs: Math.round(this.sfx.renderMs * 10) / 10,
      errors: [
        ...this.#errors,
        ...this.sfx.errors.map((e) => `sfx render: ${e}`),
        ...(this.bank?.errors ?? []),
      ],
    }
  }

  /** The chord under the music now (the key's I chord when stopped or disabled). */
  currentChord(): string {
    if (this.band) return this.band.currentChord().symbol
    return tonicChord(this.#defaultSheet()?.key ?? 'F').symbol
  }

  /** Offline render of the first `bars` bars (§9.5); waits for the instruments. Debug builds only. */
  async renderWav(
    bars = 8,
    parts?: Part[],
    fromBar = 0,
  ): Promise<RenderWavResult> {
    const bank = this.bank
    if (this.disabled || !bank) throw new Error('audio disabled')
    await this.preload()
    const sheet = this.band?.sheet ?? this.#defaultSheet()
    if (!sheet) throw new Error('no lead sheet')
    // debug-only path: loaded on demand so the offline renderer stays out of the main chunk
    const { renderWav } = await import('./offline.ts')
    return renderWav({
      sheet,
      bars,
      fromBar,
      ...(parts ? { parts } : {}),
      loader: bank.loader,
      preset: (id) => bank.preset(this.config.instruments[id].sf),
      config: this.config,
      sfx: this.data.sfx,
    })
  }

  /** The `window.__pm.audio` object (audio.md §9.2); src/debug attaches it in debug builds. */
  debugApi(): AudioDebugApi {
    return {
      state: () => this.state(),
      log: this.log,
      unlock: () => this.unlock(),
      sfx: (name) => this.playNamed(name),
      hook: (event, payload = {}) => this.hook(event, payload),
      chord: () => this.currentChord(),
      renderWav: (bars = 8, parts, fromBar = 0) =>
        this.renderWav(bars, parts, fromBar),
      mute: (muted) => {
        this.setMuted(muted ?? !this.#muted)
        return this.#muted
      },
      director: this,
    }
  }

  /** Removes every listener and timer and stops the band and the stingers (tests, hot reload). */
  destroy(): void {
    for (const off of this.#detach.splice(0)) off()
    this.#unwatch?.()
    this.#unwatch = null
    if (this.#sfxTimer !== null) clearTimeout(this.#sfxTimer)
    this.#sfxTimer = null
    this.#stopLoops()
    this.#guard('destroy', () => {
      this.#cancelTapeStop()
      this.band?.stop()
      this.bank?.stop(STINGER_IDS)
    })
  }
}

/**
 * Factory used by Boot: `createAudioDirector({ ctx, params: readAudioParams(), events: game.events,
 * registry: game.registry })`. Never throws: a Web Audio or data failure yields a disabled director whose
 * state().errors says why.
 */
export function createAudioDirector(o: AudioDirectorOptions): AudioDirector {
  try {
    return new AudioDirector(o)
  } catch (err) {
    // last resort (the constructor guards its own steps): no context, no data, no listeners, nothing read from `o`
    const d = new AudioDirector({
      ctx: null,
      settings: null,
      data: fallbackAudioData(),
      params: { disabled: true },
    })
    d.log.info(`audio director fell back to disabled: ${message(err)}`)
    return d
  }
}

/*
 * Integration notes (for src/main.ts, Boot, Preload, Title, HUD, src/debug — audio.md §2–§3, §9):
 *
 *   main.ts      one AudioContext before `new Phaser.Game({ audio: { context } })` (createSharedContext() or the
 *                existing helper; null for ?audio=0). Never `import ... from 'tone'` anywhere: only src/audio/tone.ts
 *                touches Tone, through deep imports, and the director calls setContext itself.
 *   Boot         game.sound.pauseOnBlur = false (the director owns visibility), then
 *                  const audio = createAudioDirector({ ctx, params: readAudioParams(), events: game.events,
 *                    registry: game.registry })
 *                  audio.attachSim(sim.events, { holdBayCount, isPaused, vehicleType, parcelSize })
 *                with ?skipTitle=1 (no Title tap) also audio.unlockOnFirstGesture(); 'audio:unlocked' {} on
 *                game.events tells the HUD when the "tap for sound" hint can go
 *                (done: installAudio in src/scenes/BootScene.ts, which re-attaches on SIM_REPLACED)
 *   Preload      void audio.preload()        Title shows "tuning up…" until 'audio:ready' lists piano + bass
 *   Title        pointerdown → audio.unlock() synchronously (no await before it), then the scene switch
 *   HUD          mute button → audio.toggleMuted(); listen 'audio:muted' {muted}; toast on 'audio:nowPlaying'
 *                {title, seconds}; Paused-card tap → audio.resumeAfterPause(); district panel open with
 *                satisfaction < 30 → audio.setGrumble(true/false)
 *   scenes       emit only 'ui:tap', 'ui:sheetOpen', 'ui:sheetClose', 'ui:sfx' {name} on game.events
 *   New game     after 'game:over' → audio.startMusic()
 *   debug        window.__pm.audio = audio.debugApi()
 */
