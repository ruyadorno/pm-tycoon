// Offline render to WAV (audio.md §9.5, plan.md §11; `vlr audio:render`): the
// arrangement the band plays, rendered by `__pm.audio.renderWav` through
// smplr's renderOffline on an OfflineAudioContext with the game's own decoded
// samples. The agent cannot listen, so the WAV files are the author's ear
// (shots/audio/, gitignored) and the numbers are the proof:
//   - Playwright's Chromium decodes the vendored mp3 (else: SKIPPED with the
//     reason, exit 0 — the author's phone is then the audio check);
//   - 8 bars → shots/audio/semver-swing-8bars.wav: peak < 0.98 (no
//     clipping), every bar's RMS in −30…−10 dBFS (not silent, not hot), the
//     duration of 8 bars at 126 BPM;
//   - the full 68-bar pass → shots/audio/semver-swing-full.wav: bars 0–63 in
//     the same window, peak < 0.98, the 4 tail bars (64–67) below −60 dBFS;
//   - the brushes path (ride + hat, off in v1 — Q48) renders audibly.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, READY_TIMEOUT_MS, SHOTS_DIR, test } from './fixtures.ts'

const URL = '/?seed=7&debug=1&mute=1'
const OUT_DIR = join(SHOTS_DIR, 'audio')
/** One vendored sample of each instrument (public/audio/sf/). */
const PROBE = 'audio/sf/acoustic_bass/Bb1.mp3'
const MAX_PEAK = 0.98
const BAR_RMS_MIN = -30
const BAR_RMS_MAX = -10
const TAIL_RMS_MAX = -60
const BPM = 126
const TUNE_BARS = 64
const PASS_BARS = 68

const dbfs = (v: number): string => `${v.toFixed(1)}`

test.describe('audio render (audio.md §9.5)', () => {
  test('8-bar and full-pass WAV renders: not silent, not clipping, silent tail', async ({
    page,
    consoleErrors,
  }) => {
    test.setTimeout(300_000)
    await page.goto(URL)
    await page.waitForFunction(() => !!window.__pm?.audio, null, {
      timeout: READY_TIMEOUT_MS,
    })

    const decode = await page.evaluate(async (path) => {
      try {
        const res = await fetch(path)
        const buf = await res.arrayBuffer()
        const octx = new OfflineAudioContext(1, 44100, 44100)
        const audio = await octx.decodeAudioData(buf)
        return { ok: true, why: `${audio.duration.toFixed(2)} s` }
      } catch (err) {
        return { ok: false, why: String(err) }
      }
    }, PROBE)
    if (!decode.ok) {
      console.log(
        `SKIPPED (mp3 decode unsupported in Playwright's Chromium): ${decode.why}`,
      )
      test.skip(true, `mp3 decode unsupported: ${decode.why}`)
      return
    }
    console.log(`audio-render: ${PROBE} decodes (${decode.why})`)
    mkdirSync(OUT_DIR, { recursive: true })

    await test.step('8 bars: peak < 0.98, every bar −30…−10 dBFS', async () => {
      const r = await page.evaluate(async () => {
        const t0 = performance.now()
        const w = await window.__pm!.audio!.renderWav(8)
        return { ...w, ms: performance.now() - t0 }
      })
      const path = join(OUT_DIR, 'semver-swing-8bars.wav')
      writeFileSync(path, Buffer.from(r.base64, 'base64'))
      console.log(
        `audio-render: ${path} peak ${r.peak.toFixed(3)} (${dbfs(20 * Math.log10(r.peak))} dBFS), ` +
          `${r.events} events, ${r.durationS.toFixed(2)} s, rendered in ${r.ms.toFixed(0)} ms; ` +
          `bar RMS ${r.rmsDb.map(dbfs).join(' ')}`,
      )
      expect(r.events).toBeGreaterThan(0)
      expect(r.rmsDb).toHaveLength(8)
      expect(r.peak).toBeLessThan(MAX_PEAK)
      for (const [i, v] of r.rmsDb.entries()) {
        expect(v, `bar ${i} RMS`).toBeGreaterThanOrEqual(BAR_RMS_MIN)
        expect(v, `bar ${i} RMS`).toBeLessThanOrEqual(BAR_RMS_MAX)
      }
      // 8 bars of 4 beats at 126 BPM (plus at most a short lead-in / release)
      const bars8 = (8 * 4 * 60) / BPM
      expect(r.durationS).toBeGreaterThanOrEqual(bars8)
      expect(r.durationS).toBeLessThan(bars8 + 3)
    })

    await test.step('68 bars: the tune in range, the 4 tail bars below −60 dBFS', async () => {
      const r = await page.evaluate(async (bars) => {
        const w = await window.__pm!.audio!.renderWav(bars)
        return w
      }, PASS_BARS)
      const path = join(OUT_DIR, 'semver-swing-full.wav')
      writeFileSync(path, Buffer.from(r.base64, 'base64'))
      const tune = r.rmsDb.slice(0, TUNE_BARS)
      const tail = r.rmsDb.slice(TUNE_BARS)
      console.log(
        `audio-render: ${path} peak ${r.peak.toFixed(3)}, ${r.durationS.toFixed(1)} s; ` +
          `tune RMS ${dbfs(Math.min(...tune))}…${dbfs(Math.max(...tune))} dBFS; ` +
          `tail ${tail.map(dbfs).join(' ')}`,
      )
      expect(r.rmsDb).toHaveLength(PASS_BARS)
      expect(r.peak).toBeLessThan(MAX_PEAK)
      for (const [i, v] of tune.entries()) {
        expect(v, `bar ${i} RMS`).toBeGreaterThanOrEqual(BAR_RMS_MIN)
        expect(v, `bar ${i} RMS`).toBeLessThanOrEqual(BAR_RMS_MAX)
      }
      for (const [i, v] of tail.entries())
        expect(v, `tail bar ${TUNE_BARS + i} RMS`).toBeLessThan(TAIL_RMS_MAX)
    })

    await test.step('brushes (ride + hat only, Q48 flag path) render audibly', async () => {
      const r = await page.evaluate(async () => {
        const w = await window.__pm!.audio!.renderWav(4, ['ride', 'hat'])
        return { peak: w.peak, rmsDb: w.rmsDb }
      })
      console.log(`audio-render: brushes RMS ${r.rmsDb.map(dbfs).join(' ')}`)
      for (const v of r.rmsDb) expect(v).toBeGreaterThan(-60)
      expect(r.peak).toBeLessThan(MAX_PEAK)
    })

    const st = await page.evaluate(() => window.__pm!.audio!.state())
    expect(st.errors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
