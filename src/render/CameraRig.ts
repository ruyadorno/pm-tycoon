// Camera rig for the world scenes (phaser4-notes.md §3, city-view.md §1.1,
// §10): drag pan, fling with inertia, integer zoom {1, 2} around a point,
// panTo, follow. One per world scene; driven by GestureClassifier.
//
// Units: pointer.velocity is game px per input update (~one frame), not
// px/ms (notes §3), so fling() divides by 16.67 once; update() then decays
// the px/ms velocity with 0.92^(delta/16) and rests on integer scroll.
import Phaser from 'phaser'

export type CamZoom = 1 | 2

export interface Followable {
  x: number
  y: number
}

const FLING_FRAME_MS = 16.67
const FLING_DECAY = 0.92
const FLING_STOP = 0.05 // px/ms
const PAN_MS = 350

export class CameraRig {
  readonly cam: Phaser.Cameras.Scene2D.Camera
  private vx = 0
  private vy = 0
  private followTarget: Followable | null = null
  private panning = false

  constructor(
    cam: Phaser.Cameras.Scene2D.Camera,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    this.cam = cam
    cam.setBounds(x, y, w, h)
    cam.setRoundPixels(true)
  }

  setBounds(x: number, y: number, w: number, h: number): void {
    this.cam.setBounds(x, y, w, h)
  }

  get zoom(): CamZoom {
    return this.cam.zoom >= 2 ? 2 : 1
  }

  get following(): Followable | null {
    return this.followTarget
  }

  get moving(): boolean {
    return this.vx !== 0 || this.vy !== 0 || this.panning
  }

  /** Drag by a screen-space delta (from the gesture classifier). */
  panBy(dxScreen: number, dyScreen: number): void {
    this.unfollow()
    this.vx = 0
    this.vy = 0
    this.cam.scrollX -= dxScreen / this.cam.zoom
    this.cam.scrollY -= dyScreen / this.cam.zoom
  }

  /** Start inertia from pointer.velocity (px per input update). */
  fling(vxPerUpdate: number, vyPerUpdate: number): void {
    this.vx = vxPerUpdate / FLING_FRAME_MS
    this.vy = vyPerUpdate / FLING_FRAME_MS
    if (this.vx === 0 && this.vy === 0) this.settle()
  }

  /** Kill any inertia. */
  stop(): void {
    this.vx = 0
    this.vy = 0
  }

  /**
   * Integer zoom keeping the world point under screen point (px, py) fixed.
   * Computed from the camera's own transform (screen = camX + o + z(world -
   * scroll - o), o = half the viewport) rather than getWorldPoint, whose
   * matrix only refreshes in preRender.
   */
  zoomAt(z: CamZoom, px: number, py: number): void {
    const cam = this.cam
    const z1 = cam.zoom
    if (z1 === z) return
    const ox = cam.width * cam.originX
    const oy = cam.height * cam.originY
    const k = 1 / z1 - 1 / z
    cam.scrollX += (px - cam.x - ox) * k
    cam.scrollY += (py - cam.y - oy) * k
    cam.setZoom(z)
    this.settle()
  }

  /** Double-tap / wheel toggle between the two zoom levels. */
  toggleZoomAt(px: number, py: number): CamZoom {
    const z: CamZoom = this.zoom === 1 ? 2 : 1
    this.zoomAt(z, px, py)
    return z
  }

  /** Centre the view on a world point now (no tween). */
  centerOn(wx: number, wy: number): void {
    this.stop()
    this.cam.centerOn(Math.round(wx), Math.round(wy))
  }

  /** Smooth pan to centre a world point (chips, follow start). */
  panTo(wx: number, wy: number, ms = PAN_MS, onDone?: () => void): void {
    this.stop()
    this.panning = true
    this.cam.pan(
      Math.round(wx),
      Math.round(wy),
      ms,
      'Sine.easeInOut',
      true,
      (_cam: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress < 1) return
        this.panning = false
        this.settle()
        onDone?.()
      },
    )
  }

  /** Pan to the target, then follow it (startFollow snaps; notes §3). */
  follow(target: Followable, ms = PAN_MS): void {
    this.unfollow()
    this.followTarget = target
    this.panTo(target.x, target.y, ms, () => {
      if (this.followTarget === target)
        this.cam.startFollow(
          target as Phaser.GameObjects.GameObject & Followable,
          true,
          0.12,
          0.12,
        )
    })
  }

  unfollow(): void {
    if (!this.followTarget) return
    this.followTarget = null
    this.cam.stopFollow()
  }

  /** Call from scene.update(time, delta). */
  update(delta: number): void {
    if (this.vx === 0 && this.vy === 0) return
    const z = this.cam.zoom
    this.cam.scrollX -= (this.vx * delta) / z
    this.cam.scrollY -= (this.vy * delta) / z
    const k = Math.pow(FLING_DECAY, delta / 16)
    this.vx *= k
    this.vy *= k
    if (Math.abs(this.vx) < FLING_STOP && Math.abs(this.vy) < FLING_STOP) {
      this.vx = 0
      this.vy = 0
      this.settle()
    }
  }

  /** Rest on integer scroll so sprites land on whole pixels. */
  settle(): void {
    this.cam.scrollX = Math.round(this.cam.scrollX)
    this.cam.scrollY = Math.round(this.cam.scrollY)
  }
}
