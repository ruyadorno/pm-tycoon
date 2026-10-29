// Buffer playback shared by the SFX and the optional brushes (audio.md §5, §7): zzfx renders -> AudioBuffers,
// played through a fresh source + per-shot gain onto a bus. The ride/hat buffers exist only when the sheet's
// parts.brushes (or audio.json brushes.override) is on.
import type { SfxTable } from './data.ts'
import { stream } from './rng.ts'
import { buildSamples } from './zzfx-samples.ts'

export interface BrushBuffers {
  ride: AudioBuffer
  hat: AudioBuffer
}

/** Mono AudioBuffer from rendered samples (works on a suspended or an offline context). */
export function toAudioBuffer(
  ctx: BaseAudioContext,
  samples: Float32Array,
  sampleRate: number,
): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate)
  buf.getChannelData(0).set(samples)
  return buf
}

/** Renders one zzfx entry deterministically (`randomize` false zeroes the randomness parameter, §7). */
export function renderZzfx(
  ctx: BaseAudioContext,
  params: readonly number[],
  sampleRate: number,
  seed: number,
  randomize = false,
): AudioBuffer {
  const p = randomize ? params : params.map((v, i) => (i === 1 ? 0 : v))
  return toAudioBuffer(
    ctx,
    buildSamples(p, sampleRate, stream(seed, 'zzfx')),
    sampleRate,
  )
}

export function renderBrushes(
  ctx: BaseAudioContext,
  table: SfxTable,
  sampleRate: number,
  seed = 1,
): BrushBuffers {
  const ride = table.ride
  const hat = table.hat
  if (!ride || !hat) throw new Error('sfx.json lacks ride/hat')
  return {
    ride: renderZzfx(ctx, ride, sampleRate, seed, true),
    hat: renderZzfx(ctx, hat, sampleRate, seed + 1, true),
  }
}

/**
 * Plays a buffer at `when` (context seconds) with its own GainNode into `bus`; returns the source so callers
 * can stop it (band pause) — it disconnects itself when done.
 */
export function playBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  when: number,
  gain: number,
  bus: AudioNode,
  rate = 1,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(bus)
  src.addEventListener(
    'ended',
    () => {
      src.disconnect()
      g.disconnect()
    },
    { once: true },
  )
  src.start(Math.max(when, ctx.currentTime))
  return src
}
