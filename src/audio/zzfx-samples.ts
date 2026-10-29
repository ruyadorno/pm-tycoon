/*

  ZzFX - Zuper Zmall Zound Zynth v1.4.0 by Frank Force
  https://github.com/KilledByAPixel/ZzFX

  Vendored for pm-tycoon (audio.md §7, plan.md Q72): only ZZFX.buildSamples(), converted to TypeScript, with
  the sample rate and the random source as parameters. The zzfx module itself is not imported because it creates
  its own AudioContext at import time (`audioContext: new AudioContext`), which the shared-context rule forbids.
  The synthesis loop is unchanged from zzfx@1.4.0 (npm tarball, ZzFX.js).

  ZzFX MIT License

  Copyright (c) 2019 - Frank Force

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.

*/

/**
 * zzfx parameter order (1.4.0): volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
 * deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay,
 * tremolo, filter. Shapes: 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square. Missing entries take the zzfx
 * defaults; `undefined`/empty entries in a sparse array do too.
 */
export type ZzfxParams = readonly (number | undefined)[]

/** The zzfx default for each parameter position. */
export const ZZFX_DEFAULTS: readonly number[] = [
  1, 0.05, 220, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
]

const sign = (v: number): number => (v < 0 ? -1 : 1)

/**
 * Renders one zzfx sound to mono samples. `rng` replaces Math.random (used only by the randomness parameter);
 * the default returns 0.5, which makes the frequency offset exactly zero.
 */
export function buildSamples(
  params: ZzfxParams,
  sampleRate = 44100,
  rng: () => number = () => 0.5,
): Float32Array {
  const p = (i: number): number => params[i] ?? (ZZFX_DEFAULTS[i] as number)
  const volume = p(0)
  const randomness = p(1)
  let frequency = p(2)
  let attack = p(3)
  let sustain = p(4)
  let release = p(5)
  const shape = p(6)
  const shapeCurve = p(7)
  let slide = p(8)
  let deltaSlide = p(9)
  let pitchJump = p(10)
  let pitchJumpTime = p(11)
  let repeatTime = p(12)
  const noise = p(13)
  let modulation = p(14)
  const bitCrush = p(15)
  let delay = p(16)
  const sustainVolume = p(17)
  let decay = p(18)
  const tremolo = p(19)
  const filter = p(20)

  // init parameters
  const PI2 = Math.PI * 2
  const abs = Math.abs
  const startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate)
  let startFrequency = (frequency *=
    ((1 + randomness * 2 * rng() - randomness) * PI2) / sampleRate)
  let modOffset = 0 // modulation offset
  let repeat = 0 // repeat offset
  let crush = 0 // bit crush offset
  let jump = 1 // pitch jump timer
  let t = 0 // sample time
  let i = 0 // sample index
  let s = 0 // sample value
  let f: number // wave frequency

  // biquad LP/HP filter
  const quality = 2
  const w = (PI2 * abs(filter) * 2) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / 2 / quality
  const a0 = 1 + alpha
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const b0 = (1 + sign(filter) * cos) / 2 / a0
  const b1 = -(sign(filter) + cos) / a0
  const b2 = b0
  let x2 = 0
  let x1 = 0
  let y2 = 0
  let y1 = 0

  // scale by sample rate
  const minAttack = 9 // prevent pop if attack is 0
  attack = attack * sampleRate || minAttack
  decay *= sampleRate
  sustain *= sampleRate
  release *= sampleRate
  delay *= sampleRate
  deltaSlide *= (500 * PI2) / sampleRate ** 3
  modulation *= PI2 / sampleRate
  pitchJump *= PI2 / sampleRate
  pitchJumpTime *= sampleRate
  repeatTime = (repeatTime * sampleRate) | 0

  // allocate the full sample buffer up front
  const length = (attack + decay + sustain + release + delay) | 0
  const b = new Float32Array(length > 0 ? length : 0)

  // generate waveform
  for (; i < length; b[i++] = s * volume) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      // bit crush
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (t / PI2) % 1 < shapeCurve / 2
                  ? 1
                  : -1 // 5 square duty
                : Math.sin(t ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2) // 2 saw
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t) // 0 sin

      s =
        (repeatTime
          ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) // tremolo
          : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) * // shape curve
        (i < attack
          ? i / attack // attack
          : i < attack + decay // decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume) // decay falloff
            : i < attack + decay + sustain // sustain
              ? sustainVolume // sustain volume
              : i < length - delay // release
                ? ((length - i - delay) / release) * // release falloff
                  sustainVolume // release volume
                : 0) // post release

      s = delay
        ? s / 2 +
          (delay > i
            ? 0 // delay
            : ((i < length - delay ? 1 : (length - i) / delay) * // release delay
                (b[(i - delay) | 0] as number)) /
              2 /
              volume) // sample delay
        : s

      if (filter)
        // apply filter
        s = y1 =
          b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1)
    }

    f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++) // frequency + modulation
    t += f + f * noise * (((i * i * PI2) % 2) - 1) // noise

    if (jump && ++jump > pitchJumpTime) {
      // pitch jump
      frequency += pitchJump // apply pitch jump
      startFrequency += pitchJump // also apply to start
      jump = 0 // stop pitch jump time
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      // repeat
      frequency = startFrequency // reset frequency
      slide = startSlide // reset slide
      jump ||= 1 // reset pitch jump time
    }
  }

  return b
}
