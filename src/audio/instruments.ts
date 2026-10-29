// Sampled instruments (audio.md §8): smplr Samplers built from the vendored FluidR3_GM presets in
// public/audio/sf/. One SampleLoader is shared by the music set and the stinger set, so every mp3 is fetched and
// decoded once. Every Sampler uses an immediate scheduler: notes go straight to AudioBufferSourceNode.start(when)
// (smplr's default Scheduler polls currentTime with setInterval, which mis-times OfflineAudioContext renders and
// is throttled in background tabs; the Transport already provides the look-ahead).
import {
  type Sampler as SamplerInstance,
  type Scheduler,
  type SmplrPreset,
  type SampleLoader as SampleLoaderInstance,
  Sampler,
} from 'smplr'
import type { AudioConfig, InstrumentId } from './data.ts'
import type { NoteLog } from './log.ts'

export type Instrument = SamplerInstance
export type Loader = SampleLoaderInstance

/** Dispatches every note at once; Web Audio does the timing. */
export function immediateScheduler(): Scheduler {
  return {
    schedule(event, callback) {
      callback(event)
      return () => {}
    },
    stop() {},
  }
}

function rangeNotes([lo, hi]: readonly [number, number]): number[] {
  const out: number[] = []
  for (let m = lo; m <= hi; m++) out.push(m)
  return out
}

/** `${BASE_URL}audio/sf/` — works at `/` in dev and under a sub-path on Pages (vite base './'). */
export function defaultSoundfontBase(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}audio/sf/`
}

/** Fetches public/audio/sf/<sf>.preset.json and points samples.baseUrl at the vendored note folder. */
export async function fetchPreset(
  sf: string,
  sfBase = defaultSoundfontBase(),
): Promise<SmplrPreset> {
  const res = await fetch(`${sfBase}${sf}.preset.json`)
  if (!res.ok) throw new Error(`preset ${sf}: HTTP ${res.status}`)
  const preset = (await res.json()) as SmplrPreset
  preset.samples = { ...preset.samples, baseUrl: `${sfBase}${sf}/` }
  return preset
}

export interface CreateInstrumentOptions {
  loader: Loader
  destination: AudioNode
  volume: number
  range: readonly [number, number]
  release: number
}

/** A Sampler on any context (live or offline) from a preset; resolves through `instrument.ready`. */
export function createInstrument(
  ctx: BaseAudioContext,
  preset: SmplrPreset,
  o: CreateInstrumentOptions,
): Instrument {
  return Sampler(ctx, {
    preset: {
      ...preset,
      defaults: { ...preset.defaults, ampRelease: o.release },
    },
    loader: o.loader,
    scheduler: immediateScheduler(),
    destination: o.destination,
    volume: o.volume,
    notesToLoad: { notes: rangeNotes(o.range), fallback: 'nearest' },
  })
}

export interface InstrumentBankOptions {
  ctx: BaseAudioContext
  loader: Loader
  config: AudioConfig
  destinations: { music: AudioNode; stingers: AudioNode }
  log: NoteLog
  sfBase?: string
}

/**
 * The eight Samplers of the game (piano/bass/vibes/trumpet on the music bus, piano2/bass2/vibes2/trumpet2 on the
 * sfx bus). `load(ids)` builds them in groups; `isLoaded(id)` is what the band checks before each note.
 */
export class InstrumentBank {
  #o: InstrumentBankOptions
  #presets = new Map<string, Promise<SmplrPreset>>()
  #inst = new Map<InstrumentId, Instrument>()
  #loaded = new Map<InstrumentId, boolean>()
  #ready = new Map<InstrumentId, Promise<boolean>>()
  readonly errors: string[] = []

  constructor(o: InstrumentBankOptions) {
    this.#o = o
  }

  /** The shared SampleLoader (decoded buffers cached by URL; the offline render reuses it). */
  get loader(): Loader {
    return this.#o.loader
  }

  preset(sf: string): Promise<SmplrPreset> {
    let p = this.#presets.get(sf)
    if (!p) {
      p = fetchPreset(sf, this.#o.sfBase)
      this.#presets.set(sf, p)
    }
    return p
  }

  /** Builds (once) and loads the given instruments; resolves true when every one decoded at least one sample. */
  load(ids: readonly InstrumentId[]): Promise<boolean> {
    return Promise.all(ids.map((id) => this.#loadOne(id))).then((ok) =>
      ok.every(Boolean),
    )
  }

  #loadOne(id: InstrumentId): Promise<boolean> {
    const existing = this.#ready.get(id)
    if (existing) return existing
    const { ctx, loader, config, destinations, log } = this.#o
    const c = config.instruments[id]
    const p = this.preset(c.sf)
      .then(async (preset) => {
        // the shared loader caches by URL: this decodes the notes once, the Sampler below reuses them
        const buffers = await loader.load(preset)
        if (buffers.size === 0)
          throw new Error(`no samples decoded for ${c.sf}`)
        const inst = createInstrument(ctx, preset, {
          loader,
          destination:
            c.set === 'music' ? destinations.music : destinations.stingers,
          volume: c.volume,
          range: c.range,
          release: c.release,
        })
        await inst.ready
        this.#inst.set(id, inst)
        this.#loaded.set(id, true)
        log.info(`loaded ${id} (${buffers.size} samples)`, ctx.currentTime)
        return true
      })
      .catch((err: unknown) => {
        const msg = `instrument ${id}: ${(err as Error)?.message ?? err}`
        this.errors.push(msg)
        log.info(msg, ctx.currentTime)
        this.#loaded.set(id, false)
        return false
      })
    this.#ready.set(id, p)
    return p
  }

  get(id: InstrumentId): Instrument | undefined {
    return this.#loaded.get(id) ? this.#inst.get(id) : undefined
  }

  isLoaded(id: InstrumentId): boolean {
    return this.#loaded.get(id) === true
  }

  whenReady(id: InstrumentId): Promise<boolean> {
    return this.#ready.get(id) ?? Promise.resolve(false)
  }

  loadedMap(): Record<InstrumentId, boolean> {
    const out = {} as Record<InstrumentId, boolean>
    for (const id of Object.keys(this.#o.config.instruments) as InstrumentId[])
      out[id] = this.isLoaded(id)
    return out
  }

  /** Stops every voice (scheduled or sounding) of the given instruments. */
  stop(ids: readonly InstrumentId[]): void {
    for (const id of ids) this.#inst.get(id)?.stop()
  }
}

/**
 * audio.md §1 entry point: builds the four music instruments on `destination` (piano + bass first, then vibes +
 * trumpet). Used by tools/tests that need only the band; the director uses InstrumentBank directly.
 */
export function loadInstruments(
  ctx: BaseAudioContext,
  loader: Loader,
  destination: AudioNode,
  config: AudioConfig,
  log: NoteLog,
): InstrumentBank {
  const bank = new InstrumentBank({
    ctx,
    loader,
    config,
    destinations: { music: destination, stingers: destination },
    log,
  })
  void bank.load(['piano', 'bass']).then(() => bank.load(['vibes', 'trumpet']))
  return bank
}
