// One vehicle on the city map (city-view.md §2, §6.2; phaser4-notes.md §2, §5).
// Frame `<type>_<heading>_<wheel>` from the sim snapshot (no runtime flipX),
// origin (0.5, 0.75) at tileToScreen of the interpolated tile position so the
// wheels sit on the road line, depth = fractional tx + ty. Extras: a 1-px bob
// while standing at a building stop, the home-zone dot on the roof (district
// colour; `any` = none), and one status glyph above the roof — inactive
// (ic_cross, 50 % alpha) > unpaid (ic_alert) > rush retarget (ic_bell, 2 s) >
// queued honk (ic_honk, 500 ms every 4 s, phase id mod 4).
import Phaser from 'phaser'
import type { VehicleSnapshot } from '../sim/view-api.ts'
import { WORLD_ATLAS } from './atlases.ts'
import { DEPTH } from './BuildingView.ts'
import { vehicleFrame } from './frames.ts'
import { tileToScreen } from './iso.ts'

export const VEHICLE_ORIGIN_Y = 0.75
const BOB_PERIOD_MS = 300
const BOB_UP_MS = 150
const BELL_MS = 2000
const HONK_EVERY_MS = 4000
const HONK_SHOW_MS = 500
const GLYPH_GAP = 2
/** Roof dot frame (8×8 rounded square, FILL-tinted with the district colour). */
const DOT_FRAME = 'ui_bar_track'

type Glyph = 'ic_cross' | 'ic_alert' | 'ic_bell' | 'ic_honk' | null

export class VehicleView {
  readonly id: number
  readonly img: Phaser.GameObjects.Image
  private readonly scene: Phaser.Scene
  private readonly layer: Phaser.GameObjects.Layer
  private readonly ox: number
  private dot: Phaser.GameObjects.Image | null = null
  private dotZone: string | null = null
  private glyph: Phaser.GameObjects.Image | null = null
  private glyphName: Glyph = null
  private bellUntil = -Infinity
  private frameName = ''
  private readonly pt = { x: 0, y: 0 }
  /** Interpolated tile position of the last update. */
  tx = 0
  ty = 0

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    ox: number,
    v: VehicleSnapshot,
  ) {
    this.scene = scene
    this.layer = layer
    this.ox = ox
    this.id = v.id
    this.frameName = vehicleFrame(v.type, v.heading, v.wheel)
    this.img = scene.add
      .image(0, 0, WORLD_ATLAS, this.frameName)
      .setOrigin(0.5, VEHICLE_ORIGIN_Y)
    layer.add(this.img)
  }

  /** Show the bell over this vehicle for 2 s (rush retarget, §6.1). */
  ringBell(nowMs: number): void {
    this.bellUntil = nowMs + BELL_MS
  }

  /** Screen anchor (road-line point) of the last update. */
  get x(): number {
    return this.img.x
  }

  get y(): number {
    return this.img.y
  }

  /**
   * Place from the snapshot: lerp prev → cur by the stepper alpha (notes §5).
   * `zoneColour` is the home district's colour, null for `any`.
   */
  update(
    v: VehicleSnapshot,
    alpha: number,
    nowMs: number,
    zoneColour: number | null,
  ): void {
    const a = Math.min(1, Math.max(0, alpha))
    this.tx = v.prev.tx + (v.cur.tx - v.prev.tx) * a
    this.ty = v.prev.ty + (v.cur.ty - v.prev.ty) * a
    tileToScreen(this.tx, this.ty, this.ox, this.pt)
    const bob = v.stopAt !== null && nowMs % BOB_PERIOD_MS < BOB_UP_MS ? -1 : 0
    const x = Math.round(this.pt.x)
    const y = Math.round(this.pt.y) + bob
    const depth = this.tx + this.ty
    const name = vehicleFrame(v.type, v.heading, v.wheel)
    if (name !== this.frameName) {
      this.frameName = name
      this.img.setFrame(name, false, false)
    }
    this.img.setPosition(x, y).setDepth(depth)
    const inactive = v.state === 'inactive'
    this.img.setAlpha(inactive ? 0.5 : 1)

    // Roof: the canvas top + a quarter of its height.
    const roofY = y - Math.round(this.img.height * VEHICLE_ORIGIN_Y)
    this.updateDot(v.zone, zoneColour, x, roofY + 6, depth)

    let g: Glyph = null
    if (inactive) g = 'ic_cross'
    else if (v.unpaid) g = 'ic_alert'
    else if (nowMs < this.bellUntil) g = 'ic_bell'
    else if (
      v.state === 'queued' &&
      (nowMs + (v.id % 4) * 1000) % HONK_EVERY_MS < HONK_SHOW_MS
    )
      g = 'ic_honk'
    this.updateGlyph(g, x, roofY - GLYPH_GAP, depth)
  }

  private updateDot(
    zone: string,
    colour: number | null,
    x: number,
    y: number,
    depth: number,
  ): void {
    if (zone === 'any' || colour === null) {
      if (this.dot) this.dot.setVisible(false)
      this.dotZone = null
      return
    }
    if (!this.dot) {
      this.dot = this.scene.add
        .image(x, y, WORLD_ATLAS, DOT_FRAME)
        .setTintMode(Phaser.TintModes.FILL)
      this.layer.add(this.dot)
    }
    if (zone !== this.dotZone) {
      this.dotZone = zone
      this.dot.setTint(colour)
    }
    this.dot
      .setVisible(true)
      .setPosition(x, y)
      .setDepth(depth + DEPTH.mood)
  }

  private updateGlyph(g: Glyph, x: number, y: number, depth: number): void {
    if (!g) {
      if (this.glyph) this.glyph.setVisible(false)
      this.glyphName = null
      return
    }
    if (!this.glyph) {
      this.glyph = this.scene.add.image(x, y, WORLD_ATLAS, g).setOrigin(0.5, 1)
      this.layer.add(this.glyph)
    }
    if (g !== this.glyphName) {
      this.glyphName = g
      this.glyph.setFrame(g, false, false)
    }
    this.glyph
      .setVisible(true)
      .setPosition(x, y)
      .setDepth(depth + DEPTH.bell)
  }

  /** Grown screen bounds for double-tap / F picking (city-view §10). */
  contains(wx: number, wy: number, grow = 8): boolean {
    const b = this.img.getBounds()
    return (
      wx >= b.x - grow &&
      wx <= b.right + grow &&
      wy >= b.y - grow &&
      wy <= b.bottom + grow
    )
  }

  destroy(): void {
    this.img.destroy()
    this.dot?.destroy()
    this.glyph?.destroy()
    this.dot = null
    this.glyph = null
  }
}
