// City popups (city-view.md §3.1, §3.2, §2): ONE pool of 6 slots in the
// world layer at depth 10000 (they zoom with the map), shared by
//   - pickup popups: ic_parcel_<size> + "×N", rise 12 px over 600 ms, fade
//     over the last 200 ms;
//   - delivery stamps: "DELIVERED +$12", gold on time / grey late, rise
//     16 px over 900 ms, hold 300 ms, fade;
//   - catch stamps from the warehouse (DEFUSED +$50 gold, OOPS −$25 grey);
//   - parcel hops (building door ↔ vehicle, 300 ms Sine.easeOut, 8-px arc),
//     skipped when the pool is full. A pickup hop SINKS into the vehicle
//     (spec-build2.md §6.3, the author's city #3: no parcel ever rests on a
//     roof): it ends on the vehicle's body centre and its icon shrinks to
//     nothing over the last 40 % of the flight; the delivery hop starts on
//     the body centre at full size. The shrink is a centred crop window
//     stepping 16 → 14 → … → 0 px (hopIconSide), not setScale: world art is
//     never resampled (AGENTS.md, style-guide.md §7), so every pixel that
//     shows stays 1:1.
// Merge rule: a popup of the same kind for the same key younger than 400 ms
// absorbs the new one (counts add, $ sums, timer restarts). With the pool
// full, a new popup merges into the nearest alive popup of the same kind, or
// recycles the oldest — never dropped silently. Offscreen popups are not
// spawned. Animation runs in update(delta) on the scene clock (frozen-clock
// friendly); nothing here touches the sim. setCapacity(n) (render quality
// cut 2, plan.md R4: the pool halved) limits new popups to the first n
// slots; popups alive beyond them finish their animation.
import Phaser from 'phaser'
import { FONT_KEY, WORLD_ATLAS } from '../render/atlases.ts'
import { capTop, DEPTH } from '../render/BuildingView.ts'
import { FONT_SIZE, PALETTE, THEME } from './theme.ts'

export const POOL_SIZE = 6
export const MERGE_MS = 400
const ICON = 16
const PILL_H = 18
const PILL_PAD = 4
const PILL_ALPHA = 0.85

type Kind = 'pickup' | 'delivered' | 'stamp' | 'hop'

interface Spec {
  /** Rise in px over `riseMs`. */
  rise: number
  riseMs: number
  holdMs: number
  fadeMs: number
}

const SPECS: Record<Exclude<Kind, 'hop'>, Spec> = {
  // 600 ms total, the last 200 ms fading while it still rises.
  pickup: { rise: 12, riseMs: 600, holdMs: 0, fadeMs: 200 },
  delivered: { rise: 16, riseMs: 900, holdMs: 300, fadeMs: 300 },
  stamp: { rise: 16, riseMs: 900, holdMs: 300, fadeMs: 300 },
}
export const HOP_MS = 300
const HOP_ARC = 8
/** k (0..1 of the flight) where a sinking hop starts to shrink: the last 40 %. */
export const HOP_SINK_FROM = 0.6

export interface HopOpts {
  /**
   * Pickup into a vehicle (B2 §6.3): the icon shrinks to 0 over the last
   * 40 % of the flight, ending at (x1, y1) = the vehicle's body centre.
   */
  sink?: boolean
}

/** Icon size factor `k` (0..1) into a hop: 1, then 1 → 0 over the last 40 % with `sink`. */
export function hopScale(k: number, sink: boolean): number {
  if (!sink || k <= HOP_SINK_FROM) return 1
  return Math.max(0, Math.min(1, (1 - k) / (1 - HOP_SINK_FROM)))
}

/**
 * Visible side (px) of a `side`-px icon at size factor `scale`: even, so the
 * centred crop window starts on a whole pixel; 0 once scale < 2 / side.
 */
export function hopIconSide(scale: number, side = ICON): number {
  const half = Math.floor((side / 2) * Math.max(0, Math.min(1, scale)) + 1e-9)
  return 2 * half
}

interface Slot {
  kind: Kind | null
  key: string
  container: Phaser.GameObjects.Container
  /** Dark pill behind text popups (legible over pavement and grass). */
  bg: Phaser.GameObjects.NineSlice
  icon: Phaser.GameObjects.Image
  text: Phaser.GameObjects.BitmapText | null
  x: number
  y: number
  /** Hop end point. */
  x1: number
  y1: number
  /** Hop sinks into its end point (B2 §6.3). */
  sink: boolean
  /** Visible icon side while a sinking hop shrinks (ICON = uncropped). */
  side: number
  age: number
  count: number
  amount: number
  onTime: boolean
  frame: string
  label: string
  colour: number
}

/** Visible world rect for the offscreen test. */
export interface ViewRect {
  contains(x: number, y: number): boolean
}

export class Popups {
  private readonly scene: Phaser.Scene
  private readonly slots: Slot[] = []
  private readonly hasFont: boolean
  private capacity = POOL_SIZE

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene
    this.hasFont = scene.cache.bitmapFont.has(FONT_KEY)
    for (let i = 0; i < POOL_SIZE; i++) {
      const icon = scene.add
        .image(0, 0, WORLD_ATLAS, 'ic_parcel_s')
        .setOrigin(0, 0.5)
      const text = this.hasFont
        ? scene.add
            .bitmapText(0, 0, FONT_KEY, '', FONT_SIZE)
            .setDropShadow(1, 1, THEME.shadow, 1)
        : null
      const bg = scene.add
        .nineslice(0, 0, WORLD_ATLAS, 'ui_panel_dark', 16, PILL_H, 4, 4, 4, 4)
        .setOrigin(0, 0.5)
        .setAlpha(PILL_ALPHA)
      const container = scene.add.container(
        0,
        0,
        text ? [bg, icon, text] : [bg, icon],
      )
      container.setVisible(false).setDepth(DEPTH.popup + i * 0.001)
      layer.add(container)
      this.slots.push({
        kind: null,
        key: '',
        container,
        bg,
        icon,
        text,
        x: 0,
        y: 0,
        x1: 0,
        y1: 0,
        sink: false,
        side: ICON,
        age: 0,
        count: 0,
        amount: 0,
        onTime: false,
        frame: '',
        label: '',
        colour: THEME.textLight,
      })
    }
  }

  /** Number of live slots (tests / overlay). */
  get alive(): number {
    return this.slots.filter((s) => s.kind !== null).length
  }

  /** Slots new popups may use (1..POOL_SIZE; quality cut 2 halves it). */
  setCapacity(n: number): void {
    this.capacity = Math.max(1, Math.min(POOL_SIZE, Math.floor(n)))
  }

  get size(): number {
    return this.capacity
  }

  /** A free slot within the capacity, or undefined. */
  private freeSlot(): Slot | undefined {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i]
      if (s && s.kind === null) return s
    }
    return undefined
  }

  /** Pickup popup: ic_parcel_<size> ×N over a building door. */
  pickup(
    view: ViewRect,
    key: string,
    x: number,
    y: number,
    frame: string,
  ): void {
    this.spawn(view, 'pickup', key, x, y, (s, merged) => {
      s.count = merged ? s.count + 1 : 1
      if (!merged) s.frame = frame
    })
  }

  /** Delivery stamp: DELIVERED +$N, gold on time, grey late. */
  delivered(
    view: ViewRect,
    key: string,
    x: number,
    y: number,
    paid: number,
    onTime: boolean,
  ): void {
    this.spawn(view, 'delivered', key, x, y, (s, merged) => {
      s.amount = merged ? s.amount + paid : paid
      s.onTime = merged ? s.onTime || onTime : onTime
      s.count = merged ? s.count + 1 : 1
    })
  }

  /** A one-off stamp (DEFUSED +$50, OOPS −$25) in `colour`. */
  stamp(
    view: ViewRect,
    key: string,
    x: number,
    y: number,
    label: string,
    colour: number,
  ): void {
    this.spawn(view, 'stamp', key, x, y, (s) => {
      s.label = label
      s.colour = colour
    })
  }

  /**
   * Parcel icon hop from (x0,y0) to (x1,y1); skipped when no slot is free.
   * `opts.sink`: the pickup into a vehicle — (x1, y1) is the vehicle's body
   * centre (VehicleView.bodyCentre) and the icon shrinks to nothing over the
   * last 40 % of the flight (B2 §6.3). A delivery hop starts on the body
   * centre (x0, y0) at full size, without sink.
   */
  hop(
    view: ViewRect,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    frame: string,
    opts: HopOpts = {},
  ): void {
    if (!view.contains(x0, y0) && !view.contains(x1, y1)) return
    const s = this.freeSlot()
    if (!s) return
    s.kind = 'hop'
    s.key = ''
    s.x = x0
    s.y = y0
    s.x1 = x1
    s.y1 = y1
    s.sink = opts.sink === true
    s.age = 0
    s.frame = frame
    this.uncrop(s)
    s.container.setVisible(true).setAlpha(1)
    s.icon
      .setVisible(true)
      .setFrame(frame, false, false)
      .setOrigin(0.5, 0.5)
      .setPosition(0, 0)
    s.text?.setVisible(false)
    s.bg.setVisible(false)
    this.place(s)
  }

  private spawn(
    view: ViewRect,
    kind: Exclude<Kind, 'hop'>,
    key: string,
    x: number,
    y: number,
    apply: (s: Slot, merged: boolean) => void,
  ): void {
    if (!view.contains(x, y)) return
    const same = this.slots.find(
      (s) => s.kind === kind && s.key === key && s.age < MERGE_MS,
    )
    if (same) {
      apply(same, true)
      same.age = 0
      this.render(same)
      return
    }
    let s = this.freeSlot()
    if (!s) {
      // Pool full: merge into the nearest live popup of this kind…
      let best: Slot | null = null
      let bestD = Infinity
      for (const q of this.slots) {
        if (q.kind !== kind) continue
        const d = (q.x - x) ** 2 + (q.y - y) ** 2
        if (d < bestD) {
          bestD = d
          best = q
        }
      }
      if (best) {
        apply(best, true)
        best.age = 0
        this.render(best)
        return
      }
      // …else recycle the oldest slot (a hop first: hops are cosmetic).
      s = this.slots
        .slice(0, this.capacity)
        .reduce((a, b) =>
          (a.kind === 'hop') !== (b.kind === 'hop')
            ? a.kind === 'hop'
              ? a
              : b
            : a.age >= b.age
              ? a
              : b,
        )
    }
    s.kind = kind
    s.key = key
    s.x = Math.round(x)
    s.y = Math.round(y)
    s.sink = false
    s.age = 0
    this.uncrop(s)
    apply(s, false)
    s.container.setVisible(true).setAlpha(1)
    this.render(s)
    this.place(s)
  }

  private render(s: Slot): void {
    const t = s.text
    if (s.kind === 'pickup') {
      s.icon.setVisible(true).setFrame(s.frame, false, false).setOrigin(0, 0.5)
      t?.setVisible(true).setText(`×${s.count}`).setTint(THEME.textLight)
      const w = ICON + 1 + (t ? t.width : 0)
      s.icon.setPosition(-Math.round(w / 2), 0)
      t?.setPosition(-Math.round(w / 2) + ICON + 1, capTop(0))
      this.pill(s, w)
      return
    }
    s.icon.setVisible(false)
    if (!t) {
      s.bg.setVisible(false)
      return
    }
    const label =
      s.kind === 'delivered'
        ? `DELIVERED +$${s.amount.toLocaleString('en-US')}`
        : s.label
    const colour =
      s.kind === 'delivered' ? (s.onTime ? THEME.gold : THEME.grey) : s.colour
    t.setVisible(true).setText(label).setTint(colour)
    t.setPosition(-Math.round(t.width / 2), capTop(0))
    this.pill(s, t.width)
  }

  /** Size the dark pill to `contentW` centred on the popup point. */
  private pill(s: Slot, contentW: number): void {
    const w = Math.round(contentW) + PILL_PAD * 2
    s.bg
      .setVisible(true)
      .setSize(w, PILL_H)
      .setPosition(-Math.round(w / 2), 0)
  }

  /**
   * The sinking hop's shrink: a centred `side`×`side` crop of the icon frame
   * (whole pixels, never resampled); hidden at 0.
   */
  private cropIcon(s: Slot, side: number): void {
    if (side === s.side) return
    s.side = side
    if (side >= ICON) {
      s.icon.setCrop().setVisible(true)
      return
    }
    const off = (ICON - side) / 2
    s.icon.setCrop(off, off, side, side).setVisible(side > 0)
  }

  /** Back to the whole icon (a slot reused by a hop or a pickup popup). */
  private uncrop(s: Slot): void {
    if (s.side === ICON) return
    s.side = ICON
    s.icon.setCrop()
  }

  private place(s: Slot): void {
    if (s.kind === 'hop') {
      const k = Math.min(1, s.age / HOP_MS)
      const e = Phaser.Math.Easing.Sine.Out(k)
      const x = s.x + (s.x1 - s.x) * e
      const y = s.y + (s.y1 - s.y) * e - Math.sin(Math.PI * k) * HOP_ARC
      s.container.setPosition(Math.round(x), Math.round(y))
      if (s.sink) this.cropIcon(s, hopIconSide(hopScale(k, true)))
      return
    }
    if (!s.kind) return
    const spec = SPECS[s.kind]
    const k = Math.min(1, s.age / spec.riseMs)
    s.container.setPosition(s.x, Math.round(s.y - spec.rise * k))
    const total = spec.riseMs + spec.holdMs
    const fadeStart = total - spec.fadeMs
    const a =
      spec.holdMs === 0
        ? s.age <= fadeStart
          ? 1
          : 1 - (s.age - fadeStart) / spec.fadeMs
        : s.age <= total
          ? 1
          : 1 - (s.age - total) / spec.fadeMs
    s.container.setAlpha(Math.max(0, Math.min(1, a)))
  }

  private lifetime(s: Slot): number {
    if (s.kind === 'hop') return HOP_MS
    if (!s.kind) return 0
    const spec = SPECS[s.kind]
    return spec.holdMs === 0
      ? spec.riseMs
      : spec.riseMs + spec.holdMs + spec.fadeMs
  }

  /** Advance every live slot (scene.update delta, ms). */
  update(delta: number): void {
    for (const s of this.slots) {
      if (!s.kind) continue
      s.age += delta
      if (s.age >= this.lifetime(s)) {
        // A sinking hop lands at size 0 on the body centre, then frees.
        if (s.kind === 'hop' && s.sink) this.place(s)
        this.release(s)
        continue
      }
      this.place(s)
    }
  }

  private release(s: Slot): void {
    s.kind = null
    s.key = ''
    s.sink = false
    s.container.setVisible(false)
  }

  /** Drop everything (sleep / sync). */
  clear(): void {
    for (const s of this.slots) this.release(s)
  }

  destroy(): void {
    for (const s of this.slots) s.container.destroy()
    this.slots.length = 0
  }
}

/** Gold / grey used by the catch stamps (city-view §3.2). */
export const STAMP_GOLD = THEME.gold
export const STAMP_GREY = THEME.grey
export const STAMP_RED = PALETTE.red1
