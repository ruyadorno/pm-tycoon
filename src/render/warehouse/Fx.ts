// Warehouse effects (warehouse-view.md §1.14, §3.3, §3.4, §4): the catch
// moment's sweep line and 6-frame flip, rising stamps (DEFUSED / OOPS), the
// CLOSE CALL! banner, the 2-px camera shake, tap flashes and pulsing
// outlines, plus the polyline mover every parcel / worker tween uses.
//
// Everything runs on the scene clock (scene.time / scene.tweens), so the
// frozen test clock of __pm (freeze + step) drives it exactly. Positions are
// rounded on every update (integer rest, notes §3). Effects live in the FX
// layer (§1.13 depth 100) of the room container, in room px.
import Phaser from 'phaser'
import { FONT_KEY, UI_ATLAS } from '../atlases.ts'
import { addPanel } from '../../ui/Panel.ts'
import { FONT_SIZE, PALETTE, THEME } from '../../ui/theme.ts'
import { BANNER, ROOM_W, type Point, type Rect } from './RoomLayout.ts'

/** §1.5 parcel speed and the per-move clamp. */
export const PARCEL_PX_PER_S = 160
export const MOVE_MIN_MS = 120
export const MOVE_MAX_MS = 400
/** §3.3 timeline. */
export const SWEEP_MS = 150
export const FLIP_AT_MS = 150
/** 6 flip frames at 60 fps = 100 ms. */
export const FLIP_MS = 100
export const JUMP_AT_MS = 250
export const SLIDE_AT_MS = 260
/** §3.3 divert slide: out to the chute, down it (≤ 250 ms), into the bay. */
export const DIVERT_OUT_MS = 150
export const DIVERT_DOWN_MAX_MS = 250
export const DIVERT_IN_MS = 150
export const SHAKE_MS = 120
export const SHAKE_PX = 2
export const SHAKE_GAP_MS = 500
/** §3.4 outcomes. */
export const STAMP_RISE = 24
export const DEFUSED_MS = 700
export const OOPS_MS = 1200
export const BANNER_MS = 1200
export const BANNER_SLIDE_MS = 200
/** §1.14 tap flash. */
export const FLASH_MS = 80
export const FLASH_ALPHA = 0.6
/** Stamps keep this far inside the room's edges. */
const STAMP_MARGIN = 36
/** Inner padding of a plated stamp. */
const PLATE_PAD = 4

export function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Polyline length in px. */
export function pathLength(from: Point, pts: readonly Point[]): number {
  let len = 0
  let prev = from
  for (const p of pts) {
    len += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return len
}

/** Point at arc length `d` along from → pts (clamped to the end). */
export function pointAlong(
  from: Point,
  pts: readonly Point[],
  d: number,
  out: Point,
): Point {
  let prev = from
  let left = Math.max(0, d)
  for (const p of pts) {
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y)
    if (left <= seg && seg > 0) {
      const t = left / seg
      out.x = prev.x + (p.x - prev.x) * t
      out.y = prev.y + (p.y - prev.y) * t
      return out
    }
    left -= seg
    prev = p
  }
  out.x = prev.x
  out.y = prev.y
  return out
}

/** Duration of a move at `pxPerS`, clamped (§1.5: 160 px/s, 120–400 ms). */
export function moveMs(
  len: number,
  pxPerS = PARCEL_PX_PER_S,
  min = MOVE_MIN_MS,
  max = MOVE_MAX_MS,
): number {
  if (len <= 0) return 0
  return Math.round(Math.min(max, Math.max(min, (len / pxPerS) * 1000)))
}

export interface Movable {
  x: number
  y: number
  setPosition(x: number, y: number): unknown
}

export interface MoveOpts {
  pxPerS?: number
  minMs?: number
  maxMs?: number
  /** Fixed duration (overrides speed / clamp). */
  ms?: number
  ease?: string
  onStep?: (x: number, y: number) => void
  onDone?: () => void
}

/**
 * Tween `obj` along the polyline `pts` (from its current position), integer
 * positions on every step. Returns the tween (null when already there).
 */
export function moveAlong(
  scene: Phaser.Scene,
  obj: Movable,
  pts: readonly Point[],
  opts: MoveOpts = {},
): Phaser.Tweens.Tween | null {
  const from = { x: obj.x, y: obj.y }
  const len = pathLength(from, pts)
  const ms =
    opts.ms ?? moveMs(len, opts.pxPerS, opts.minMs ?? MOVE_MIN_MS, opts.maxMs)
  const end = pts[pts.length - 1]
  if (!end || len < 0.5 || ms <= 0) {
    if (end) obj.setPosition(Math.round(end.x), Math.round(end.y))
    opts.onStep?.(obj.x, obj.y)
    opts.onDone?.()
    return null
  }
  const at = { x: 0, y: 0 }
  const prog = { d: 0 }
  return scene.tweens.add({
    targets: prog,
    d: len,
    duration: ms,
    ease: opts.ease ?? 'Linear',
    onUpdate: () => {
      pointAlong(from, pts, prog.d, at)
      obj.setPosition(Math.round(at.x), Math.round(at.y))
      opts.onStep?.(obj.x, obj.y)
    },
    onComplete: () => {
      obj.setPosition(Math.round(end.x), Math.round(end.y))
      opts.onStep?.(obj.x, obj.y)
      opts.onDone?.()
    },
  })
}

/** One leg of a segmented move: go to `to` in exactly `ms`. */
export interface Leg {
  to: Point
  ms: number
}

/**
 * Tween `obj` through `legs` one after another (each its own fixed
 * duration, Linear, integer positions), then onDone.
 */
export function moveLegs(
  scene: Phaser.Scene,
  obj: Movable,
  legs: readonly Leg[],
  opts: Pick<MoveOpts, 'onStep' | 'onDone'> & {
    onTween?: (t: Phaser.Tweens.Tween | null) => void
  } = {},
): void {
  let i = 0
  const next = (): void => {
    const leg = legs[i]
    i += 1
    if (!leg) {
      opts.onTween?.(null)
      opts.onDone?.()
      return
    }
    const t = moveAlong(scene, obj, [leg.to], {
      ms: leg.ms,
      onStep: opts.onStep,
      onDone: next,
    })
    opts.onTween?.(t)
  }
  next()
}

/**
 * The warehouse FX layer: sweep lines, flips, stamps, banner, shake, tap
 * flashes and pulsing outlines (all in room px inside `layer`).
 */
export class Fx {
  readonly scene: Phaser.Scene
  private layer: Phaser.GameObjects.Container
  private lastShake = -Infinity
  private banner: Phaser.GameObjects.Container | null = null
  private live = new Set<Phaser.GameObjects.GameObject>()

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
    this.scene = scene
    this.layer = layer
  }

  /** §3.3 t = 0: a 64 × 2 bright line sweeps the slot cell top → bottom. */
  sweep(r: Rect): void {
    const line = this.scene.add
      .rectangle(r.x, r.y, r.w, 2, PALETTE.yellow3, 1)
      .setOrigin(0, 0)
    this.track(line)
    this.layer.add(line)
    this.scene.tweens.add({
      targets: line,
      y: r.y + r.h - 2,
      duration: SWEEP_MS,
      ease: 'Linear',
      onUpdate: () => line.setY(Math.round(line.y)),
      onComplete: () => this.drop(line),
    })
  }

  /**
   * Step `img` through `frames` over `ms` in total (one tween on the scene
   * clock, so 6 frames take exactly 100 ms at any frame rate), ending on
   * `last`; onDone runs after the final frame (or at once if `alive` fails).
   */
  flip(
    img: Phaser.GameObjects.Image,
    frames: readonly string[],
    last: string,
    onDone?: () => void,
    alive: () => boolean = () => img.active,
    ms = FLIP_MS,
  ): void {
    const n = frames.length
    const first = frames[0]
    if (n === 0 || first === undefined || !alive()) {
      if (alive()) img.setFrame(last)
      onDone?.()
      return
    }
    img.setFrame(first)
    const prog = { k: 0 }
    this.scene.tweens.add({
      targets: prog,
      k: 1,
      duration: ms,
      ease: 'Linear',
      onUpdate: () => {
        if (!alive()) return
        const f = frames[Math.min(n - 1, Math.floor(prog.k * n))]
        if (f !== undefined && img.frame.name !== f) img.setFrame(f)
      },
      onComplete: () => {
        if (alive()) img.setFrame(last)
        onDone?.()
      },
    })
  }

  /** 2-px camera shake, at most once per 500 ms; skipped for reduced motion. */
  shake(): void {
    const now = this.scene.time.now
    if (now - this.lastShake < SHAKE_GAP_MS || reducedMotion()) return
    this.lastShake = now
    const cam = this.scene.cameras.main
    cam.shake(SHAKE_MS, SHAKE_PX / Math.max(1, cam.width))
  }

  /**
   * A 16-px stamp (1-px shadow, centre-aligned lines; `\n` breaks) centred
   * at (x, y) and kept inside the room, rising `rise` px over `ms` and
   * fading in its last third. `plate` backs it with a dark panel (the
   * two-line OOPS stamp, which must read over any floor or rack art).
   */
  stamp(
    text: string,
    x: number,
    y: number,
    tint: number,
    ms = DEFUSED_MS,
    rise = STAMP_RISE,
    plate = false,
  ): Phaser.GameObjects.Container {
    const t = this.scene.add
      .bitmapText(0, 0, FONT_KEY, text, FONT_SIZE)
      .setCenterAlign()
      .setTint(tint)
      .setDropShadow(1, 1, THEME.shadow, 1)
    const pad = plate ? PLATE_PAD : 0
    const w = Math.ceil(t.width) + 2 * pad
    const h = Math.ceil(t.height) + 2 * pad
    const parts: Phaser.GameObjects.GameObject[] = []
    if (plate) parts.push(addPanel(this.scene, 0, 0, w, h, 'ui_panel_dark'))
    t.setPosition(pad, pad)
    parts.push(t)
    const left = Math.min(
      ROOM_W - STAMP_MARGIN - w,
      Math.max(STAMP_MARGIN, x - w / 2),
    )
    const c = this.scene.add.container(
      Math.round(left),
      Math.round(y - h / 2),
      parts,
    )
    this.track(c)
    this.layer.add(c)
    const y0 = c.y
    const prog = { k: 0 }
    this.scene.tweens.add({
      targets: prog,
      k: 1,
      duration: ms,
      ease: 'Linear',
      onUpdate: () => {
        c.setY(Math.round(y0 - rise * Phaser.Math.Easing.Quadratic.Out(prog.k)))
        c.setAlpha(prog.k < 2 / 3 ? 1 : 1 - (prog.k - 2 / 3) * 3)
      },
      onComplete: () => this.drop(c),
    })
    return c
  }

  /** CLOSE CALL! banner: ui_banner 320 × 32 at (16, 40), slides in, 1.2 s. */
  closeCall(text = 'CLOSE CALL!'): void {
    this.banner?.destroy()
    const img = this.scene.add
      .image(0, 0, UI_ATLAS, 'ui_banner')
      .setOrigin(0, 0)
    const t = this.scene.add
      .bitmapText(0, 0, FONT_KEY, text, FONT_SIZE)
      .setTint(THEME.textLight)
      .setDropShadow(1, 1, PALETTE.red0, 1)
    // ui_banner's body is y 0..25 (artUi hand-off): centre the caps there.
    t.setPosition(Math.round((BANNER.w - t.width) / 2), 13 - 4 - 4)
    // Slides in from the right while fading in, starting flush with the
    // room's east edge: from x = BANNER.x + BANNER.w it overhung the room by
    // ~300 px onto the screen margin for the first frames (UX M2 review).
    const fromX = Math.max(BANNER.x, ROOM_W - BANNER.w)
    const c = this.scene.add.container(fromX, BANNER.y, [img, t]).setAlpha(0)
    this.banner = c
    this.track(c)
    this.layer.add(c)
    this.scene.tweens.add({
      targets: c,
      x: BANNER.x,
      alpha: 1,
      duration: BANNER_SLIDE_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => c.setX(Math.round(c.x)),
    })
    this.scene.time.delayedCall(BANNER_MS, () => {
      if (this.banner !== c) return
      this.scene.tweens.add({
        targets: c,
        alpha: 0,
        duration: BANNER_SLIDE_MS,
        onComplete: () => {
          if (this.banner === c) this.banner = null
          this.drop(c)
        },
      })
    })
  }

  /** §1.14: a white outline of `r` at alpha 0.6 → 0 over 80 ms. */
  flash(r: Rect): void {
    const g = this.scene.add.graphics()
    g.lineStyle(2, PALETTE.grey5, 1)
    g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    g.setAlpha(FLASH_ALPHA)
    this.track(g)
    this.layer.add(g)
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: FLASH_MS,
      onComplete: () => this.drop(g),
    })
  }

  /** A 2-px outline of `r` in `colour` (callers pulse / destroy it). */
  outline(r: Rect, colour: number, width = 2): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics()
    g.lineStyle(width, colour, 1)
    g.strokeRect(r.x + width / 2, r.y + width / 2, r.w - width, r.h - width)
    this.layer.add(g)
    return g
  }

  /** Destroy every live effect (game over, sleep, shutdown). */
  clear(): void {
    for (const o of this.live) o.destroy()
    this.live.clear()
    this.banner = null
  }

  private track(o: Phaser.GameObjects.GameObject): void {
    this.live.add(o)
  }

  private drop(o: Phaser.GameObjects.GameObject): void {
    this.live.delete(o)
    o.destroy()
  }
}
