// Offline render to WAV (audio.md §9.5): the same arrangement the band plays, rendered through smplr's
// renderOffline onto an OfflineAudioContext with the shared SampleLoader (buffers already decoded, no re-fetch).
// Debug builds only (`__pm.audio.renderWav`). Returns the WAV as base64 plus peak and per-bar RMS so a test can
// prove "non-silent, non-clipping, correctly timed" without speakers.
import { renderOffline, type SmplrPreset } from 'smplr'
import { type Part, arrange } from './arranger.ts'
import { renderBrushes } from './brushes.ts'
import {
  type AudioConfig,
  type InstrumentId,
  samplerGain,
  type SfxTable,
} from './data.ts'
import {
  createInstrument,
  type Instrument,
  type Loader,
} from './instruments.ts'
import type { LeadSheet } from './leadsheet.ts'

export interface RenderWavOptions {
  sheet: LeadSheet
  /** number of bars to render (68 = the full pass incl. the silent tail) */
  bars: number
  /** first bar (default 0) */
  fromBar?: number
  parts?: readonly Part[]
  loader: Loader
  preset: (id: InstrumentId) => Promise<SmplrPreset>
  config: AudioConfig
  sfx: SfxTable
  sampleRate?: number
}

export interface RenderWavResult {
  base64: string
  peak: number
  /** per bar, dBFS (−120 for digital silence) */
  rmsDb: number[]
  durationS: number
  events: number
}

const LEAD_IN_S = 0.05

function base64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk)
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

export async function renderWav(o: RenderWavOptions): Promise<RenderWavResult> {
  const sampleRate = o.sampleRate ?? 44100
  const spb = 60 / o.sheet.tempo
  const barS = 4 * spb
  const arr = arrange(o.sheet, o.parts ? { parts: o.parts } : {})
  const from = o.fromBar ?? 0
  const events = arr.events.filter(
    (e) => e.bar >= from && e.bar < from + o.bars,
  )
  const durationS = LEAD_IN_S + o.bars * barS + 0.5
  let count = 0
  const result = await renderOffline(
    async (octx) => {
      // the music bus as the live graph has it (no limiter: the render must show real peaks)
      const master = octx.createGain()
      master.gain.value = o.config.buses.master * o.config.buses.music
      master.connect(octx.destination)
      const samplers = octx.createGain()
      samplers.gain.value = samplerGain(o.config)
      samplers.connect(master)
      const parts: InstrumentId[] = ['piano', 'bass', 'vibes', 'trumpet']
      const inst = new Map<InstrumentId, Instrument>()
      for (const id of parts) {
        const c = o.config.instruments[id]
        const i = createInstrument(octx, await o.preset(id), {
          loader: o.loader,
          destination: samplers,
          volume: c.volume,
          range: c.range,
          release: c.release,
        })
        await i.ready
        inst.set(id, i)
      }
      const brushes = renderBrushes(octx, o.sfx, sampleRate)
      for (const e of events) {
        const time = Math.max(
          0,
          LEAD_IN_S + (e.bar - from) * barS + e.beat * spb + e.dtMs / 1000,
        )
        if (e.part === 'ride' || e.part === 'hat') {
          const src = octx.createBufferSource()
          src.buffer = brushes[e.part]
          const g = octx.createGain()
          g.gain.value = o.config.brushes[e.part] * (e.vel / 100)
          src.connect(g)
          g.connect(master)
          src.start(time)
        } else {
          inst.get(e.part as InstrumentId)?.start({
            note: e.midi,
            velocity: e.vel,
            time,
            duration: e.dur * spb,
          })
        }
        count++
      }
    },
    { duration: durationS, sampleRate, channels: 2 },
  )
  const buf = result.audioBuffer
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) =>
    buf.getChannelData(c),
  )
  let peak = 0
  for (const ch of chans) for (const v of ch) peak = Math.max(peak, Math.abs(v))
  const rmsDb: number[] = []
  for (let b = 0; b < o.bars; b++) {
    const lo = Math.floor((LEAD_IN_S + b * barS) * sampleRate)
    const to = Math.min(
      buf.length,
      Math.floor((LEAD_IN_S + (b + 1) * barS) * sampleRate),
    )
    let sum = 0
    let n = 0
    for (const ch of chans) {
      for (let i = lo; i < to; i++) {
        const v = ch[i] as number
        sum += v * v
        n++
      }
    }
    const rms = n ? Math.sqrt(sum / n) : 0
    rmsDb.push(rms > 1e-6 ? 20 * Math.log10(rms) : -120)
  }
  const wav = new Uint8Array(await result.toWav16().arrayBuffer())
  return { base64: base64(wav), peak, rmsDb, durationS, events: count }
}
