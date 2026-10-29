// Pure rules and timelines of the city's M3 flourishes (plan.md §7, §12.6
// tasks 5 + 9; city-view.md §1.3-§1.4, §2, §9.6; spec-core.md §3.5, §9.2,
// Q33). No Phaser, no DOM: CityScene / BuildingView / VehicleView /
// DistrictLabel drive their sprites from these and Vitest pins them under
// Node (tests/render/cityFx.test.ts). Every time is ms on the scene clock
// (frozen-clock friendly: __pm.freeze steps it).

// ---------------------------------------------------------------- region unlock (§1.4)

/** Colour frames fade in while the `_locked` ones fade out; ground crossfade too. */
export const UNLOCK_FADE_MS = 1000
/** After the fade the lock sign plays sign_pop_0..2 then is removed. */
export const SIGN_POP_FRAMES = 3
export const SIGN_POP_MS = 300

/** 0 → 1 progress of a fade `elapsed` ms into `ms`. */
export function fadeK(elapsed: number, ms: number): number {
  if (!(ms > 0)) return 1
  return Math.max(0, Math.min(1, elapsed / ms))
}

/** sign_pop frame `msSincePop` into the pop (0..2), null once it is over. */
export function signPopFrame(msSincePop: number): number | null {
  if (msSincePop < 0) return 0
  if (msSincePop >= SIGN_POP_MS) return null
  return Math.min(
    SIGN_POP_FRAMES - 1,
    Math.floor((msSincePop / SIGN_POP_MS) * SIGN_POP_FRAMES),
  )
}

// ---------------------------------------------------------------- level-up moment (§9.6)

/** fx_dust: 4 frames × 250 ms = scaffold, dust, dust, reveal. */
export const DUST_FRAMES = 4
export const DUST_FRAME_MS = 250
export const CONSTRUCTION_MS = DUST_FRAMES * DUST_FRAME_MS
/** The exterior swaps to the new tier as the reveal frame starts. */
export const CONSTRUCTION_SWAP_MS = (DUST_FRAMES - 1) * DUST_FRAME_MS
/**
 * Dust puffs cover the warehouse on a staggered grid (32×32 frames) with a
 * deterministic jitter, so the scaffold frame reads as a building site and
 * not a fence pattern.
 */
export const DUST_STEP_X = 40
export const DUST_STEP_Y = 30
export const DUST_JITTER = 7

/** fx_dust frame index `elapsed` ms into the construction, null when done. */
export function dustFrame(elapsed: number): number | null {
  if (elapsed < 0) return 0
  if (elapsed >= CONSTRUCTION_MS) return null
  return Math.floor(elapsed / DUST_FRAME_MS)
}

/** The "LEVEL 2 — LOCAL" stamp: 32 px gold, rises 24 px over 1.2 s, then holds and fades. */
export const STAMP_RISE_PX = 24
export const STAMP_RISE_MS = 1200
export const STAMP_HOLD_MS = 800
export const STAMP_FADE_MS = 400
export const STAMP_MS = STAMP_RISE_MS + STAMP_HOLD_MS + STAMP_FADE_MS

export function levelStampText(level: number, title: string): string {
  return `LEVEL ${level} — ${title.toUpperCase()}`
}

/** Stamp offset above the roof (dy ≤ 0) and alpha, or null once gone. */
export function stampPose(
  elapsed: number,
): { dy: number; alpha: number } | null {
  if (elapsed >= STAMP_MS) return null
  const t = Math.max(0, elapsed)
  const rise = Math.min(1, t / STAMP_RISE_MS)
  // Ease out: fast off the roof, settling at the top.
  const eased = 1 - (1 - rise) * (1 - rise)
  const fadeStart = STAMP_RISE_MS + STAMP_HOLD_MS
  const alpha = t <= fadeStart ? 1 : 1 - (t - fadeStart) / STAMP_FADE_MS
  return {
    dy: 0 - Math.round(STAMP_RISE_PX * eased),
    alpha: Math.max(0, Math.min(1, alpha)),
  }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Small deterministic integer hash (no Math.random: same cloud every run). */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

/**
 * Centres of the dust puffs covering `rect` (the exterior's visible rect):
 * a staggered grid jittered by up to ±DUST_JITTER px, keeping the points
 * where the sprite is opaque.
 */
export function dustPoints(
  rect: Rect,
  isOpaque: (x: number, y: number) => boolean,
  stepX = DUST_STEP_X,
  stepY = DUST_STEP_Y,
  jitter = DUST_JITTER,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  const span = 2 * jitter + 1
  let row = 0
  for (let y = rect.y + stepY / 2; y < rect.y + rect.h; y += stepY, row++) {
    let col = 0
    const x0 = rect.x + (row % 2 === 0 ? stepX / 2 : stepX)
    for (let x = x0; x < rect.x + rect.w; x += stepX, col++) {
      const h = hash2(row, col)
      const px = Math.round(
        Math.min(
          rect.x + rect.w - 1,
          Math.max(rect.x, x + (h % span) - jitter),
        ),
      )
      const py = Math.round(
        Math.min(
          rect.y + rect.h - 1,
          Math.max(rect.y, y + ((h >>> 8) % span) - jitter),
        ),
      )
      if (isOpaque(px, py)) out.push({ x: px, y: py })
    }
  }
  return out
}

// ---------------------------------------------------------------- moods (spec §9.2)

export type MoodKind = 'happy' | 'unhappy' | null

/** One overlay per building from the district value: flower boxes ≥ happyAbove, shutters < loudBelow. */
export function moodFor(
  value: number,
  s: { loudBelow: number; happyAbove: number },
): MoodKind {
  if (value < s.loudBelow) return 'unhappy'
  if (value >= s.happyAbove) return 'happy'
  return null
}

/** The angry label grumbles now, then every 20 s while it is on screen (spec §9.2). */
export const GRUMBLE_EVERY_MS = 20_000

export function grumbleDue(
  lastMs: number | null,
  nowMs: number,
  everyMs = GRUMBLE_EVERY_MS,
): boolean {
  return lastMs === null || nowMs - lastMs >= everyMs
}

// ---------------------------------------------------------------- days-since-incident sign (Q33)

/**
 * The board is cracked from a lost life until the counter reaches 1 again
 * (one in-game day); before any loss it is whole even at 0.
 */
export function signCracked(
  daysSinceIncident: number,
  lostLife: boolean,
): boolean {
  return lostLife && daysSinceIncident === 0
}

export function signDaysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------- vehicles (§2)

/** ic_honk over a queued vehicle: 500 ms every 4 s, per-vehicle phase id mod 4 (seconds). */
export const HONK_EVERY_MS = 4000
export const HONK_SHOW_MS = 500

export function honkShown(nowMs: number, vehicleId: number): boolean {
  const phase = (((vehicleId % 4) + 4) % 4) * 1000
  return (nowMs + phase) % HONK_EVERY_MS < HONK_SHOW_MS
}

// ---------------------------------------------------------------- warehouse exterior (art install hand-off)

/** wh_ext_t* canvas (256×256, origin (0.5, 1) at the lot's footprint anchor). */
export const WH_CANVAS = 256
/**
 * Dock-bay lights, wh_ext canvas px, origin (0.5, 1): the pointer tip sits on
 * the amber lamp above each bay door of the visible SW face (bays 1-3).
 */
export const BAY_LIGHTS: readonly (readonly [number, number])[] = [
  [47, 139],
  [71, 151],
  [96, 163],
]
/**
 * Foot point of a vehicle docked at bay 1 (canvas px): in front of the open
 * door, nose in (`<type>_ne_<phase>`). The map's dock tile (20, 22) lies on
 * the hidden NW side of the sprite, so the view draws the docked vehicle here.
 */
export const DOCK_POSE_CANVAS: readonly [number, number] = [40, 178]
/** The dock pose draws over the warehouse wall: footprint depth + this. */
export const DOCK_POSE_DEPTH = 0.2
/** Blend radius (tiles) around the dock tile: the approach from the queue head. */
export const DOCK_BLEND_TILES = 3

/**
 * 0..1 weight of the dock pose for a vehicle at tile (tx, ty): 1 on the dock
 * tile, falling linearly to 0 at DOCK_BLEND_TILES; only inside the lot (full
 * from tx = lotX0 − 0.5, zero on the avenue tile lotX0 − 1) and south of the
 * parking row (full from ty = dockY, zero at dockY − 0.5), so through-traffic
 * on the avenue and the parking row behind the sprite are never moved.
 * Continuous, so a vehicle driving in or out never jumps.
 */
export function dockBlend(
  tx: number,
  ty: number,
  dock: readonly [number, number],
  lotX0: number,
): number {
  const d = Math.hypot(tx - dock[0], ty - dock[1])
  const near = 1 - d / DOCK_BLEND_TILES
  if (near <= 0) return 0
  const inLot = Math.max(0, Math.min(1, (tx - (lotX0 - 1)) * 2))
  const inColumn = Math.max(0, Math.min(1, (ty - dock[1] + 0.5) * 2))
  return Math.min(1, near) * inLot * inColumn
}

// ---------------------------------------------------------------- smoke (§1.3)

/** fx_smoke_f0..3 at 4 fps: a puff lives 4 frames = 1 s, rising and drifting. */
export const SMOKE_FPS = 4
export const SMOKE_FRAMES = 4
export const SMOKE_PERIOD_MS = (SMOKE_FRAMES * 1000) / SMOKE_FPS
export const SMOKE_PUFFS = 3
export const SMOKE_RISE_PX = 21
export const SMOKE_DRIFT_PX = 3
/** Per-emitter phase step (ms): not a multiple of a frame, so chimneys never puff in sync. */
export const SMOKE_PHASE_MS = 170

/** Puff `k` of an emitter with phase `phaseMs`: frame (stepped at 4 fps) and offset from the anchor. */
export function smokePuff(
  nowMs: number,
  phaseMs: number,
  k: number,
): { frame: number; dx: number; dy: number } {
  const age =
    (((nowMs + phaseMs + (k * SMOKE_PERIOD_MS) / SMOKE_PUFFS) %
      SMOKE_PERIOD_MS) +
      SMOKE_PERIOD_MS) %
    SMOKE_PERIOD_MS
  const t = age / SMOKE_PERIOD_MS
  return {
    frame: Math.min(SMOKE_FRAMES - 1, Math.floor(t * SMOKE_FRAMES)),
    dx: Math.round(SMOKE_DRIFT_PX * t),
    dy: 0 - Math.round(SMOKE_RISE_PX * t),
  }
}
