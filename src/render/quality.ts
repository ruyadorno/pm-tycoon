// Render quality flags (plan.md §12.6 task 10, §12.8 R4): the perf cut order
// for a phone that cannot hold the frame rate. Level n applies the first n
// cuts, in this order (R4, cheapest-to-lose first):
//   1 mood overlays off          (BuildingView.setMood → null)
//   2 popup pool halved          (Popups.setCapacity(POOL_SIZE / 2))
//   3 smoke emitters off         (CityScene.buildSmoke builds none)
//   4 waiting badges only for rushed buildings
//   5 static wheel frames        (VehicleView keeps wheel 0)
// Read at boot from navigator.hardwareConcurrency (levelFromCores), then the
// fps sampler (game.loop.actualFps once per second) judges each 20-s window
// with the R4 trigger `p50 < 50 or p5 < 30` and cuts one more level per bad
// window; it never raises the level again (no oscillation). The sampler
// skips frames while the loop is not running (the __pm.freeze test clock),
// while the page is hidden, and entirely under automation
// (navigator.webdriver: SwiftShader frame rates are not a phone's).
//
// The controller lives in game.registry 'quality' (installQuality is
// idempotent) and emits `quality:changed {level}` on game.events; the city
// consumes it. Debug: `__pm.game.registry.get('quality').set(n)`.
//
// The pure part (flags, percentile, the window verdict) has no Phaser and no
// DOM value import so Vitest loads it under Node (tests/render/quality.test.ts).

export const MAX_QUALITY_LEVEL = 5
/** Registry key of the QualityController. */
export const REG_QUALITY = 'quality'
/** game.events: the level changed ({level}). */
export const EV_QUALITY = 'quality:changed'

/** R4 trigger thresholds (plan.md §12.8: fps.p50 < 50 or p5 < 30). */
export const FPS_P50_MIN = 50
export const FPS_P5_MIN = 30
/** The sampler judges a window this long (R4 "after 20 s"). */
export const FPS_WINDOW_MS = 20_000
export const FPS_SAMPLE_MS = 1000
/** Fewer samples than this in a window (hidden tab, frozen clock) → no verdict. */
export const FPS_MIN_SAMPLES = 10

export interface QualityFlags {
  /** 0 = everything on … 5 = every cut applied. */
  level: number
  moodOverlays: boolean
  /** Popup pool slots in use (6, or 3 once halved). */
  popupPool: number
  smoke: boolean
  /** Waiting badges only on rushed buildings. */
  badgesRushedOnly: boolean
  /** Wheel frame pinned to 0. */
  staticWheels: boolean
}

export const clampLevel = (n: number): number =>
  Math.max(
    0,
    Math.min(MAX_QUALITY_LEVEL, Math.floor(Number.isFinite(n) ? n : 0)),
  )

/** The flags of cut level `level` (R4 order); `poolSize` = Popups POOL_SIZE. */
export function qualityFlags(level: number, poolSize = 6): QualityFlags {
  const l = clampLevel(level)
  return {
    level: l,
    moodOverlays: l < 1,
    popupPool: l >= 2 ? Math.max(1, Math.floor(poolSize / 2)) : poolSize,
    smoke: l < 3,
    badgesRushedOnly: l >= 4,
    staticWheels: l >= 5,
  }
}

/**
 * Boot level from navigator.hardwareConcurrency: unknown or ≥ 3 cores → 0;
 * 2 cores → 1 (mood overlays off); 1 core → 3 (overlays, half pool, smoke).
 */
export function levelFromCores(cores: number | undefined | null): number {
  if (cores === undefined || cores === null || !(cores > 0)) return 0
  if (cores <= 1) return 3
  if (cores <= 2) return 1
  return 0
}

/** Nearest-rank percentile (p in 0..100) of the samples; NaN when empty. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN
  const sorted = samples.toSorted((a, b) => a - b)
  const rank = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)] ?? Number.NaN
}

/** R4: the window is too slow when p50 < 50 or p5 < 30. */
export function fpsTooLow(samples: readonly number[]): boolean {
  if (samples.length === 0) return false
  return (
    percentile(samples, 50) < FPS_P50_MIN || percentile(samples, 5) < FPS_P5_MIN
  )
}

/**
 * One fps sample per FPS_SAMPLE_MS; a verdict per FPS_WINDOW_MS window.
 * push() returns true when the window that just closed was too slow (the
 * caller cuts one level); every window starts afresh.
 */
export class FpsWindow {
  private samples: number[] = []
  private windowStart: number | null = null
  private lastSample = -Infinity
  private readonly windowMs: number
  private readonly everyMs: number

  constructor(windowMs = FPS_WINDOW_MS, everyMs = FPS_SAMPLE_MS) {
    this.windowMs = windowMs
    this.everyMs = everyMs
  }

  push(nowMs: number, fps: number): boolean {
    if (this.windowStart === null) this.windowStart = nowMs
    if (nowMs - this.lastSample >= this.everyMs && Number.isFinite(fps)) {
      this.lastSample = nowMs
      this.samples.push(fps)
    }
    if (nowMs - this.windowStart < this.windowMs) return false
    const bad =
      this.samples.length >= FPS_MIN_SAMPLES && fpsTooLow(this.samples)
    this.samples = []
    this.windowStart = nowMs
    return bad
  }

  /** Samples in the open window (tests / overlay). */
  get count(): number {
    return this.samples.length
  }
}

// ---------------------------------------------------------------- controller

/** The bits of Phaser.Game the controller touches (structural, no import). */
export interface QualityGame {
  registry: {
    get(key: string): unknown
    set(key: string, value: unknown): unknown
  }
  events: {
    on(name: string, fn: (...a: never[]) => void, ctx?: unknown): unknown
    off(name: string, fn: (...a: never[]) => void, ctx?: unknown): unknown
    emit(name: string, ...args: unknown[]): unknown
  }
  loop: { actualFps: number; running: boolean; now: number }
}

export interface QualityController {
  readonly level: number
  readonly flags: QualityFlags
  /** Why the level is what it is (boot cores / fps window / debug). */
  readonly reason: string
  /** Force a level (debug, tests); emits quality:changed when it changes. */
  set(level: number, reason?: string): void
  dispose(): void
}

interface NavLike {
  hardwareConcurrency?: number
  webdriver?: boolean
}

function nav(): NavLike | null {
  const g = globalThis as { navigator?: NavLike }
  return g.navigator ?? null
}

function pageHidden(): boolean {
  const g = globalThis as { document?: { hidden?: boolean } }
  return g.document?.hidden === true
}

/**
 * Install (once per game) the quality controller: boot level from the core
 * count, then the fps sampler on every game step. Returns the existing one
 * when already installed.
 */
export function installQuality(game: QualityGame): QualityController {
  const existing = game.registry.get(REG_QUALITY) as
    | QualityController
    | undefined
  if (existing) return existing

  const n = nav()
  let level = levelFromCores(n?.hardwareConcurrency)
  let reason = `boot: ${n?.hardwareConcurrency ?? '?'} cores`
  let flags = qualityFlags(level)
  const sampler = n?.webdriver === true ? null : new FpsWindow()

  const set = (next: number, why = 'debug'): void => {
    const l = clampLevel(next)
    reason = why
    if (l === level) return
    level = l
    flags = qualityFlags(level)
    game.events.emit(EV_QUALITY, { level })
  }

  const onStep = (): void => {
    if (!sampler || level >= MAX_QUALITY_LEVEL) return
    const loop = game.loop
    if (!loop.running || pageHidden()) return
    if (sampler.push(loop.now, loop.actualFps))
      set(level + 1, `fps window at ${Math.round(loop.now / 1000)} s`)
  }
  game.events.on('step', onStep)

  const ctl: QualityController = {
    get level() {
      return level
    },
    get flags() {
      return flags
    },
    get reason() {
      return reason
    },
    set,
    dispose() {
      game.events.off('step', onStep)
      if (game.registry.get(REG_QUALITY) === ctl)
        game.registry.set(REG_QUALITY, undefined)
    },
  }
  game.registry.set(REG_QUALITY, ctl)
  return ctl
}
