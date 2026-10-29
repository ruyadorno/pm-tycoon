// One vehicle on the city map (city-view.md §2, §6.2; phaser4-notes.md §2, §5).
// Frame `<type>_<heading>_<wheel>` from the sim snapshot (no runtime flipX),
// display origin = the manifest's VEHICLE_FOOT (the road-line point of each
// class canvas: bike/van/truck) at tileToScreen of the interpolated tile
// position, depth = fractional tx + ty. Extras: a 1-px bob while standing at
// a building stop, the home-zone dot on the roof (district colour; `any` =
// none), and one status glyph above the roof — inactive (ic_cross, 50 %
// alpha) > unpaid driver (ic_alert "!") > rush retarget (ic_bell, 2 s) >
// queued honk (ic_honk, 500 ms every 4 s, phase id mod 4, only while on
// screen).
//
// Dock pose (art-install hand-off): the map's dock tile (20, 22) is on the
// warehouse sprite's hidden NW side, so near it (cityFx.dockBlend) the
// vehicle is drawn toward the pose in front of bay 1's open door, over the
// wall, nose in (`_ne_`) while docked. Quality (src/render/quality.ts) cut 5
// pins the wheel frame to 0. The scene's `sortDepth` (vehicleDepth.ts) lifts
// a vehicle over the multi-tile footprints it is in front of (M4).
import Phaser from 'phaser'
import type { VehicleSnapshot } from '../sim/view-api.ts'
import { WORLD_ATLAS } from './atlases.ts'
import { DEPTH } from './BuildingView.ts'
import { dockBlend, honkShown } from './cityFx.ts'
import { VEHICLE_FOOT, vehicleFrame } from './frames.ts'
import { tileToScreen } from './iso.ts'
import type { SpriteRect } from './vehicleDepth.ts'

/** Fallback origin y (Q24) for a type the manifest has no foot point for. */
export const VEHICLE_ORIGIN_Y = 0.75
const BOB_PERIOD_MS = 300
const BOB_UP_MS = 150
const BELL_MS = 2000
const GLYPH_GAP = 2
/** Roof dot frame (8×8 rounded square, FILL-tinted with the district colour). */
const DOT_FRAME = 'ui_bar_track'

type Glyph = 'ic_cross' | 'ic_alert' | 'ic_bell' | 'ic_honk' | null

/** Where a docked vehicle is drawn (CityScene, from the warehouse anchor). */
export interface DockPose {
  /** The map dock tile the sim parks a docked vehicle on. */
  tile: readonly [number, number]
  /** First lot column (the avenue is lotX0 − 1). */
  lotX0: number
  /** World offset from that tile's centre to the drawn foot point. */
  dx: number
  dy: number
  /** Depth while drawn at / toward the pose (over the warehouse wall). */
  depth: number
}

export interface VehicleDrawOpts {
  /** Inside cam.worldView (the honk bubble is drawn only then). */
  onScreen: boolean
  /** Quality cut 5: wheel frame pinned to 0. */
  staticWheels: boolean
  /**
   * Depth from the fractional tile, its tx + ty and the drawn sprite rect
   * (CityScene: vehicleDepth.sortDepth over the multi-tile footprints).
   * The dock pose still wins near the dock.
   */
  sortDepth?: (tx: number, ty: number, base: number, rect: SpriteRect) => number
}

const DOCKED = new Set(['docked_unloading', 'docked_loading'])

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
  private type: VehicleSnapshot['type']
  private readonly pose: DockPose | null
  private readonly pt = { x: 0, y: 0 }
  private readonly rect: SpriteRect = { left: 0, top: 0, right: 0, bottom: 0 }
  /** Interpolated tile position of the last update. */
  tx = 0
  ty = 0

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    ox: number,
    v: VehicleSnapshot,
    pose: DockPose | null = null,
  ) {
    this.scene = scene
    this.layer = layer
    this.ox = ox
    this.id = v.id
    this.type = v.type
    this.pose = pose
    this.frameName = vehicleFrame(v.type, v.heading, v.wheel)
    this.img = scene.add.image(0, 0, WORLD_ATLAS, this.frameName)
    this.applyOrigin()
    layer.add(this.img)
  }

  /** Foot point of the type's canvas on the road line (VEHICLE_FOOT). */
  private applyOrigin(): void {
    const foot = VEHICLE_FOOT[this.type]
    if (foot) this.img.setDisplayOrigin(foot[0], foot[1])
    else this.img.setOrigin(0.5, VEHICLE_ORIGIN_Y)
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
    opts: VehicleDrawOpts = { onScreen: true, staticWheels: false },
  ): void {
    const a = Math.min(1, Math.max(0, alpha))
    this.tx = v.prev.tx + (v.cur.tx - v.prev.tx) * a
    this.ty = v.prev.ty + (v.cur.ty - v.prev.ty) * a
    tileToScreen(this.tx, this.ty, this.ox, this.pt)
    let depth = this.tx + this.ty
    const docked = DOCKED.has(v.state)
    const pose = this.pose
    const w = pose ? dockBlend(this.tx, this.ty, pose.tile, pose.lotX0) : 0
    if (pose && w > 0) {
      this.pt.x += pose.dx * w
      this.pt.y += pose.dy * w
    }
    const bob = v.stopAt !== null && nowMs % BOB_PERIOD_MS < BOB_UP_MS ? -1 : 0
    const x = Math.round(this.pt.x)
    const y = Math.round(this.pt.y) + bob
    if (v.type !== this.type) {
      this.type = v.type
      this.applyOrigin()
    }
    const heading = docked && pose ? 'ne' : v.heading
    const name = vehicleFrame(v.type, heading, opts.staticWheels ? 0 : v.wheel)
    if (name !== this.frameName) {
      this.frameName = name
      this.img.setFrame(name, false, false)
    }
    if (opts.sortDepth) {
      const r = this.rect
      r.left = x - this.img.displayOriginX
      r.top = y - this.img.displayOriginY
      r.right = r.left + this.img.width
      r.bottom = r.top + this.img.height
      depth = opts.sortDepth(this.tx, this.ty, depth, r)
    }
    if (pose && w > 0) depth = Math.max(depth, pose.depth)
    this.img.setPosition(x, y).setDepth(depth)
    const inactive = v.state === 'inactive'
    this.img.setAlpha(inactive ? 0.5 : 1)

    // Roof: the canvas top (the foot point is the road line).
    const roofY = y - Math.round(this.img.displayOriginY)
    this.updateDot(v.zone, zoneColour, x, roofY + 6, depth)

    let g: Glyph = null
    if (inactive) g = 'ic_cross'
    else if (v.unpaid) g = 'ic_alert'
    else if (nowMs < this.bellUntil) g = 'ic_bell'
    else if (v.state === 'queued' && opts.onScreen && honkShown(nowMs, v.id))
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
