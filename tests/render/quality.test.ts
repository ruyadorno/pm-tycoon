// plan.md §12.8 R4 / §12.6 task 10: the render-quality cut order — (1) mood
// overlays off, (2) popup pool halved, (3) smoke emitters off, (4) waiting
// badges only for rushed buildings, (5) static wheel frames — read at boot
// from navigator.hardwareConcurrency and cut one step per 20-s fps window
// whose p50 < 50 or p5 < 30; never raised again.
import { describe, expect, it } from 'vitest'
import {
  EV_QUALITY,
  FPS_WINDOW_MS,
  FpsWindow,
  fpsTooLow,
  installQuality,
  levelFromCores,
  MAX_QUALITY_LEVEL,
  percentile,
  qualityFlags,
  REG_QUALITY,
  type QualityGame,
} from '../../src/render/quality.ts'

/** src/ui/Popups.ts POOL_SIZE (a Phaser module: not importable under Node). */
const POOL_SIZE = 6

describe('R4 cut order: level n applies the first n cuts', () => {
  it('level 0 keeps everything on', () => {
    expect(qualityFlags(0, POOL_SIZE)).toEqual({
      level: 0,
      moodOverlays: true,
      popupPool: POOL_SIZE,
      smoke: true,
      badgesRushedOnly: false,
      staticWheels: false,
    })
  })

  it('cuts mood overlays first, then halves the popup pool, then smoke, badges, wheels', () => {
    const at = (l: number) => qualityFlags(l, POOL_SIZE)
    expect(at(1).moodOverlays).toBe(false)
    expect(at(1).popupPool).toBe(POOL_SIZE)
    expect(at(2).popupPool).toBe(POOL_SIZE / 2)
    expect(at(2).smoke).toBe(true)
    expect(at(3).smoke).toBe(false)
    expect(at(3).badgesRushedOnly).toBe(false)
    expect(at(4).badgesRushedOnly).toBe(true)
    expect(at(4).staticWheels).toBe(false)
    expect(at(5)).toEqual({
      level: 5,
      moodOverlays: false,
      popupPool: POOL_SIZE / 2,
      smoke: false,
      badgesRushedOnly: true,
      staticWheels: true,
    })
  })

  it('clamps out-of-range levels', () => {
    expect(qualityFlags(-3).level).toBe(0)
    expect(qualityFlags(99).level).toBe(MAX_QUALITY_LEVEL)
    expect(qualityFlags(Number.NaN).level).toBe(0)
  })
})

describe('boot level from navigator.hardwareConcurrency', () => {
  it('keeps full quality on unknown or ≥ 3 cores', () => {
    expect(levelFromCores(undefined)).toBe(0)
    expect(levelFromCores(0)).toBe(0)
    expect(levelFromCores(4)).toBe(0)
    expect(levelFromCores(6)).toBe(0)
  })

  it('drops mood overlays on 2 cores and smoke on 1', () => {
    expect(qualityFlags(levelFromCores(2)).moodOverlays).toBe(false)
    expect(qualityFlags(levelFromCores(2)).smoke).toBe(true)
    expect(qualityFlags(levelFromCores(1)).smoke).toBe(false)
  })
})

describe('fps verdict: p50 < 50 or p5 < 30 (R4 trigger)', () => {
  it('nearest-rank percentiles', () => {
    const s = Array.from({ length: 20 }, (_, i) => i + 1) // 1..20
    expect(percentile(s, 50)).toBe(10)
    expect(percentile(s, 5)).toBe(1)
    expect(percentile(s, 100)).toBe(20)
    expect(percentile([], 50)).toBeNaN()
  })

  it('a steady 60 fps passes, a 45 fps median fails, rare dips under 30 fail', () => {
    expect(fpsTooLow(Array(20).fill(60))).toBe(false)
    expect(fpsTooLow(Array(20).fill(45))).toBe(true)
    // 1 frame in 20 at 20 fps: p5 = 20 < 30.
    expect(fpsTooLow([...Array(19).fill(60), 20])).toBe(true)
    // 1 in 40 does not reach the 5th percentile.
    expect(fpsTooLow([...Array(39).fill(60), 20])).toBe(false)
  })
})

describe('the sampler judges each 20-s window once', () => {
  it('no verdict before 20 s; a slow window cuts once and starts afresh', () => {
    const w = new FpsWindow()
    let cuts = 0
    for (let t = 0; t < FPS_WINDOW_MS; t += 16) if (w.push(t, 40)) cuts++
    expect(cuts).toBe(0)
    expect(w.push(FPS_WINDOW_MS, 40)).toBe(true)
    expect(w.count).toBe(0)
    // The next window is fast: no cut.
    for (let t = FPS_WINDOW_MS + 16; t < 2 * FPS_WINDOW_MS + 16; t += 16)
      if (w.push(t, 60)) cuts++
    expect(cuts).toBe(0)
  })

  it('a window with too few samples (frozen or hidden) gives no verdict', () => {
    const w = new FpsWindow()
    w.push(0, 10)
    w.push(1000, 10)
    expect(w.push(FPS_WINDOW_MS + 1, 10)).toBe(false)
  })
})

function fakeGame(fps: number, running = true) {
  const reg = new Map<string, unknown>()
  const handlers = new Map<string, ((...a: never[]) => void)[]>()
  const emitted: unknown[] = []
  const game: QualityGame & { step(): void } = {
    registry: {
      get: (k) => reg.get(k),
      set: (k, v) => reg.set(k, v),
    },
    events: {
      on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]),
      off: (n, fn) =>
        handlers.set(
          n,
          (handlers.get(n) ?? []).filter((f) => f !== fn),
        ),
      emit: (n, ...a) => {
        if (n === EV_QUALITY) emitted.push(a[0])
        return true
      },
    },
    loop: { actualFps: fps, running, now: 0 },
    step() {
      for (const fn of handlers.get('step') ?? []) (fn as () => void)()
    },
  }
  return { game, emitted }
}

describe('installQuality (the controller the city consumes)', () => {
  it('is installed once per game and cuts one level per slow window, never raising it', () => {
    const { game, emitted } = fakeGame(30)
    const nav = (globalThis as { navigator?: { webdriver?: boolean } })
      .navigator
    const wasDriver = nav?.webdriver
    try {
      if (nav)
        Object.defineProperty(nav, 'webdriver', {
          value: false,
          configurable: true,
        })
      const ctl = installQuality(game)
      expect(installQuality(game)).toBe(ctl)
      expect(game.registry.get(REG_QUALITY)).toBe(ctl)
      const start = ctl.level
      for (let t = 0; t <= 2 * FPS_WINDOW_MS + 100; t += 100) {
        game.loop.now = t
        game.step()
      }
      expect(ctl.level).toBe(Math.min(MAX_QUALITY_LEVEL, start + 2))
      expect(emitted.length).toBe(ctl.level - start)
      game.loop.actualFps = 60
      for (let t = 2 * FPS_WINDOW_MS + 200; t <= 4 * FPS_WINDOW_MS; t += 100) {
        game.loop.now = t
        game.step()
      }
      expect(ctl.level).toBe(Math.min(MAX_QUALITY_LEVEL, start + 2))
      ctl.set(0, 'test')
      expect(ctl.flags.moodOverlays).toBe(true)
      ctl.dispose()
      expect(game.registry.get(REG_QUALITY)).toBeUndefined()
    } finally {
      if (nav)
        Object.defineProperty(nav, 'webdriver', {
          value: wasDriver,
          configurable: true,
        })
    }
  })
})

describe('the sampler skips the attract Title (B2 §5)', () => {
  it('judges nothing while skip() holds and starts a fresh window after it', () => {
    const { game, emitted } = fakeGame(10)
    const nav = (globalThis as { navigator?: { webdriver?: boolean } })
      .navigator
    const wasDriver = nav?.webdriver
    try {
      if (nav)
        Object.defineProperty(nav, 'webdriver', {
          value: false,
          configurable: true,
        })
      let attract = true
      const ctl = installQuality(game, { skip: () => attract })
      const start = ctl.level
      // 3 windows of 10 fps on the Title: no cut.
      let t = 0
      for (; t <= 3 * FPS_WINDOW_MS; t += 100) {
        game.loop.now = t
        game.step()
      }
      expect(ctl.level).toBe(start)
      expect(emitted).toEqual([])
      // In play at 60 fps: the first window holds only play frames.
      attract = false
      game.loop.actualFps = 60
      for (const end = t + 2 * FPS_WINDOW_MS; t <= end; t += 100) {
        game.loop.now = t
        game.step()
      }
      expect(ctl.level).toBe(start)
      ctl.dispose()
    } finally {
      if (nav)
        Object.defineProperty(nav, 'webdriver', {
          value: wasDriver,
          configurable: true,
        })
    }
  })

  it('FpsWindow.reset drops the open window', () => {
    const w = new FpsWindow()
    for (let t = 0; t < FPS_WINDOW_MS - 100; t += 100) w.push(t, 10)
    expect(w.count).toBeGreaterThan(0)
    w.reset()
    expect(w.count).toBe(0)
    // The window restarts at the next push: no verdict 100 ms later.
    expect(w.push(FPS_WINDOW_MS + 100, 10)).toBe(false)
  })
})
