// HUD layout (city-view.md §4, plan.md §7): every HUD rect is a field of
// L = computeLayout(W, H, safeTop, safeBottom, zoom), in logical px.
// Pure — no Phaser, no DOM (tools/check-sim-purity.mjs). The safe-area insets
// are measured by src/main.ts from the hidden #safe probe and stored in the
// game registry ('safeTop' / 'safeBottom', logical px); scenes pass them in.
//
// Tap targets: 44 CSS px. Under Scale.NONE at zoom z one logical px is z CSS
// px, so the minimum hit size is ceil(44 / z) logical px and every target's
// hit box is max(visual, minHit) on each axis (L.hit), grown around the visual
// rect. Targets on the top row touch the screen's top edge, so their hit box
// grows upward past it (an edge target is unbounded in that direction); every
// other target grows into neighbouring non-interactive space only, so no two
// hit boxes overlap.

export const HUD_TOP_H = 64 // top bar 48 + ticker 16
export const HUD_BOTTOM_H = 64
export const CHIPS_H = 32
export const TOP_BAR_H = 48
export const ROW_H = 24
export const TICKER_H = 16
export const TOAST_H = 24
export const FOLLOW_H = 32
export const MARGIN = 6
export const BTN_H = 44
export const BTN_TOP_PAD = 10
export const SPEED_SEG_W = 44
export const MUTE_W = 44
export const WIDE_BTN_W = 76
export const SHIELD_W = 56
export const LIVES_SLOTS = 5
export const LIVES_SLOT = 16
export const LIVES_GAP = 2
export const MOOD_W = 44
export const TICKER_DAY_W = 52
export const CHIP_H = 24
export const CHIP_PAD_X = 6
export const CHIP_GAP = 4
export const TOUCH_CSS_PX = 44

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A tap target: the visual rect and its hit box (absolute logical px). */
export interface Target {
  rect: Rect
  hit: Rect
}

export type TargetName =
  | 'money'
  | 'lives'
  | 'mood'
  | 'level'
  | 'shield'
  | 'speedPause'
  | 'speed1'
  | 'speed2'
  | 'mute'
  | 'warehouse'
  | 'garage'
  | 'followClose'

export interface Layout {
  W: number
  H: number
  zoom: number
  safeTop: number
  safeBottom: number
  /** ceil(44 / zoom): the minimum hit size on each axis, logical px. */
  minHit: number
  /** max(visual, minHit): the hit size for a visual extent. */
  hit: (visual: number) => number
  topBar: Rect
  rowA: Rect
  rowB: Rect
  money: Target
  lives: Target
  mood: Target
  level: Target
  levelBar: Rect
  shield: Target
  ticker: Rect
  tickerDay: Rect
  toast: Rect
  followStrip: Rect
  followClose: Target
  chips: Rect
  /** Chip metrics: chips are laid out left to right by the HUD from these. */
  chip: {
    x0: number
    h: number
    padX: number
    gap: number
    hitY: number
    hitH: number
    maxRowW: number
  }
  bottomBar: Rect
  speed: Rect
  speedPause: Target
  speed1: Target
  speed2: Target
  mute: Target
  warehouse: Target
  garage: Target
  /** The city area visible between the top HUD and the chips row. */
  world: Rect
  /** Every fixed tap target, keyed by name (chips are dynamic: see `chip`). */
  targets: Record<TargetName, Target>
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
})

/** Half-open overlap test: rects that only touch do not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

export function minHitFor(zoom: number): number {
  return Math.ceil(TOUCH_CSS_PX / Math.max(1, zoom))
}

/** Grow `r` symmetrically to at least `min` on each axis (integer px). */
export function growTo(r: Rect, min: number): Rect {
  const w = Math.max(r.w, min)
  const h = Math.max(r.h, min)
  const x = r.x - Math.floor((w - r.w) / 2)
  const y = r.y - Math.floor((h - r.h) / 2)
  return { x, y, w, h }
}

function target(visual: Rect, hit: Rect): Target {
  return { rect: visual, hit }
}

/**
 * The HUD layout for a W x H logical canvas (city-view.md §4). Visual sizes
 * are constant in logical px; only hit boxes depend on zoom. Widths below
 * 360 (not a test target, but laid out) shrink the two wide bottom buttons.
 */
export function computeLayout(
  W: number,
  H: number,
  safeTop: number,
  safeBottom: number,
  zoom: number,
): Layout {
  const st = Math.max(0, Math.round(safeTop))
  const sb = Math.max(0, Math.round(safeBottom))
  const minHit = minHitFor(zoom)
  const hit = (visual: number): number => Math.max(visual, minHit)

  // ---- top bar: row A (money · lives · mood), row B (level · bar · shield)
  const topBar = rect(0, st, W, TOP_BAR_H)
  const rowA = rect(0, st, W, ROW_H)
  const rowB = rect(0, st + ROW_H, W, ROW_H)
  const livesW = LIVES_SLOTS * LIVES_SLOT + (LIVES_SLOTS - 1) * LIVES_GAP
  const livesX = Math.round(W / 2 - livesW / 2)
  const moodX = W - MARGIN - MOOD_W
  const shieldX = W - MARGIN - SHIELD_W
  // Row A hit boxes end at row B's top and grow upward (top-edge targets).
  const aHitH = hit(ROW_H)
  const aHitY = st + ROW_H - aHitH
  // Row B hit boxes start at row B's top and grow down over the ticker strip
  // and the toast lane (neither is interactive).
  const bHitH = hit(ROW_H)
  const bHitY = st + ROW_H
  const money = target(
    rect(MARGIN, st, livesX - 2 * MARGIN, ROW_H),
    rect(0, aHitY, livesX, aHitH),
  )
  const livesHitW = hit(livesW)
  const lives = target(
    rect(livesX, st, livesW, ROW_H),
    rect(
      livesX - Math.floor((livesHitW - livesW) / 2),
      aHitY,
      livesHitW,
      aHitH,
    ),
  )
  const moodHitW = hit(W - moodX)
  const mood = target(
    rect(moodX, st, MOOD_W, ROW_H),
    rect(W - moodHitW, aHitY, moodHitW, aHitH),
  )
  const levelBar = rect(76, st + 29, W - 76 - MARGIN - SHIELD_W, 14)
  const level = target(
    rect(MARGIN, st + ROW_H, shieldX - 2 * MARGIN, ROW_H),
    rect(0, bHitY, shieldX, bHitH),
  )
  const shieldHitW = hit(W - shieldX)
  const shield = target(
    rect(shieldX, st + ROW_H, SHIELD_W, ROW_H),
    rect(W - shieldHitW, bHitY, shieldHitW, bHitH),
  )
  const ticker = rect(0, st + TOP_BAR_H, W, TICKER_H)
  const tickerDay = rect(0, st + TOP_BAR_H, TICKER_DAY_W, TICKER_H)
  const toast = rect(12, st + HUD_TOP_H + 4, W - 24, TOAST_H)

  // ---- bottom: follow strip (transient) · chips row · bottom bar
  const bottomBar = rect(0, H - sb - HUD_BOTTOM_H, W, HUD_BOTTOM_H + sb)
  const chips = rect(0, bottomBar.y - CHIPS_H, W, CHIPS_H)
  const followStrip = rect(0, chips.y - FOLLOW_H, W, FOLLOW_H)
  const btnY = bottomBar.y + BTN_TOP_PAD
  // Chip hit boxes: the 24-px chip centred in the 32-px row, hit grown to
  // minHit, biased down into the bottom bar's non-interactive top padding so it
  // stays clear of both the follow strip's close button and the bar buttons.
  const chipHitH = hit(CHIPS_H)
  const chipHitBelow = Math.min(BTN_TOP_PAD, chipHitH - CHIPS_H)
  const chipHitY = chips.y - (chipHitH - CHIPS_H - chipHitBelow)
  const chip = {
    x0: MARGIN,
    h: CHIP_H,
    padX: CHIP_PAD_X,
    gap: CHIP_GAP,
    hitY: chipHitY,
    hitH: chipHitH,
    maxRowW: W - 2 * MARGIN,
  }
  // The strip's close button: 28x28 centred in the 32-px strip.
  const closeVis = rect(W - MARGIN - 28, followStrip.y + 2, 28, 28)
  const closeHitW = hit(closeVis.w)
  const closeHitH = hit(closeVis.h)
  // Ends where the chips' hit boxes begin; grows upward over the city.
  const closeHitBottom = Math.min(closeVis.y + closeVis.h, chipHitY)
  const followClose = target(
    closeVis,
    rect(
      Math.min(
        closeVis.x - Math.floor((closeHitW - closeVis.w) / 2),
        W - closeHitW,
      ),
      closeHitBottom - closeHitH,
      closeHitW,
      closeHitH,
    ),
  )

  const speed = rect(MARGIN, btnY, 3 * SPEED_SEG_W, BTN_H)
  const seg = (i: number): Target => {
    const r = rect(speed.x + i * SPEED_SEG_W, btnY, SPEED_SEG_W, BTN_H)
    return target(r, growTo(r, minHit))
  }
  const speedPause = seg(0)
  const speed1 = seg(1)
  const speed2 = seg(2)
  const muteR = rect(speed.x + speed.w + MARGIN, btnY, MUTE_W, BTN_H)
  const mute = target(muteR, growTo(muteR, minHit))
  const rightSpace = W - (muteR.x + muteR.w) - 3 * MARGIN
  const wideW = Math.max(
    Math.max(BTN_H, minHit),
    Math.min(WIDE_BTN_W, Math.floor(rightSpace / 2)),
  )
  const garageR = rect(W - MARGIN - wideW, btnY, wideW, BTN_H)
  const warehouseR = rect(garageR.x - MARGIN - wideW, btnY, wideW, BTN_H)
  const garage = target(garageR, growTo(garageR, minHit))
  const warehouse = target(warehouseR, growTo(warehouseR, minHit))

  const worldY = st + HUD_TOP_H
  const world = rect(0, worldY, W, Math.max(0, chips.y - worldY))

  const targets: Record<TargetName, Target> = {
    money,
    lives,
    mood,
    level,
    shield,
    speedPause,
    speed1,
    speed2,
    mute,
    warehouse,
    garage,
    followClose,
  }

  return {
    W,
    H,
    zoom,
    safeTop: st,
    safeBottom: sb,
    minHit,
    hit,
    topBar,
    rowA,
    rowB,
    money,
    lives,
    mood,
    level,
    levelBar,
    shield,
    ticker,
    tickerDay,
    toast,
    followStrip,
    followClose,
    chips,
    chip,
    bottomBar,
    speed,
    speedPause,
    speed1,
    speed2,
    mute,
    warehouse,
    garage,
    world,
    targets,
  }
}

/** A column of `n` centred buttons (Title card, city-view.md §9.5): 200x44, 12-px gaps. */
export function buttonColumn(
  W: number,
  centreY: number,
  n: number,
  zoom: number,
  btnW = 200,
  gap = 12,
): Target[] {
  const minHit = minHitFor(zoom)
  const totalH = n * BTN_H + (n - 1) * gap
  const x = Math.round(W / 2 - btnW / 2)
  const y0 = Math.round(centreY - totalH / 2)
  const out: Target[] = []
  for (let i = 0; i < n; i++) {
    const r = rect(x, y0 + i * (BTN_H + gap), btnW, BTN_H)
    out.push(target(r, growTo(r, minHit)))
  }
  return out
}
