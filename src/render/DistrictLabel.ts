// District label (city-view.md §1.3, §1.4; spec-core.md §3.5, §9.2): a
// `ui_tag` NineSlice plate with the flavour name in 16-px m5x7 at the
// region's labelTile (map.json), depth 9500. A locked region adds the lock
// glyph after the name and its `sign_locked` board ("Unlocks at Lv N", +
// "Trucks only" for the trucks-only district) stands under the plate. A live
// district below `satisfaction.loudBelow` shows ic_angry on the plate's right
// end and grumbles: tickGrumble() says when (now, then every 20 s while the
// angry plate is on screen); the scene emits `ui:sfx {name: 'grumble'}` and
// the AudioDirector's own 20-s grumble throttle keeps it to one per 20 s
// overall (the district-panel loop of audio.md §7 row 16 shares it).
//
// Region unlock (§1.4): beginUnlock(popAtMs) keeps the locked look while the
// scene crossfades the district (1 s); at popAtMs the plate is rebuilt
// without the lock and the board plays sign_pop_0..2 (300 ms), then is
// removed. update(nowMs) steps it; setLocked() snaps (and cancels a pop).
import Phaser from 'phaser'
import { FONT_KEY, WORLD_ATLAS } from './atlases.ts'
import { capTop, DEPTH } from './BuildingView.ts'
import { grumbleDue, signPopFrame } from './cityFx.ts'
import { SIGN_LOCKED_FACE } from './frames.ts'
import { HH, tileToScreen } from './iso.ts'
import { FONT_SIZE, THEME } from '../ui/theme.ts'

const PAD_X = 5
const TAG_H = 18
const ICON = 16
const ICON_GAP = 2
/** m5x7 line pitch (public/assets/m5x7.xml lineHeight). */
const LINE_H = 14

export interface DistrictLabelInfo {
  id: string
  name: string
  labelTile: readonly [number, number]
  unlockLevel: number
  trucksOnly: boolean
}

export class DistrictLabel {
  readonly id: string
  readonly info: DistrictLabelInfo
  /** Screen point of the label tile's centre. */
  readonly at: { x: number; y: number }
  private readonly scene: Phaser.Scene
  private readonly layer: Phaser.GameObjects.Layer
  private readonly hasFont: boolean
  /** The name plate (+ lock glyph, angry icon). */
  private tagObjs: Phaser.GameObjects.GameObject[] = []
  /** The lock board and its text lines (locked only). */
  private sign: Phaser.GameObjects.Image | null = null
  private signText: Phaser.GameObjects.BitmapText[] = []
  private angry: Phaser.GameObjects.Image | null = null
  /** Plate bounds (world) for the on-screen test. */
  private tagRect = { x: 0, y: 0, w: 0, h: 0 }
  private lockedState: boolean | null = null
  /** The plate on screen still carries the lock glyph. */
  private tagHasLock = false
  private angryState = false
  private lastGrumble: number | null = null
  /** Pending unlock: plate swap + sign pop at `popAt` (scene ms). */
  private pop: { popAt: number; started: boolean } | null = null

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    ox: number,
    info: DistrictLabelInfo,
    locked: boolean,
  ) {
    this.scene = scene
    this.layer = layer
    this.info = info
    this.id = info.id
    this.hasFont = scene.cache.bitmapFont.has(FONT_KEY)
    const p = tileToScreen(info.labelTile[0], info.labelTile[1], ox)
    this.at = { x: Math.round(p.x), y: Math.round(p.y) }
    this.setLocked(locked)
  }

  get locked(): boolean {
    return this.lockedState === true
  }

  /** True while an unlock's sign pop is pending or playing. */
  get popping(): boolean {
    return this.pop !== null
  }

  /** Rebuild for the lock state now (create, wake, sim swap): no animation. */
  setLocked(locked: boolean): void {
    if (this.pop) this.endPop()
    if (locked === this.lockedState) return
    this.lockedState = locked
    this.destroySign()
    if (locked) this.buildSign()
    this.buildTag(locked)
  }

  /**
   * region:unlocked: stay as drawn until `popAtMs` (the end of the scene's
   * 1-s crossfade), then plate without the lock + the board's sign_pop.
   */
  beginUnlock(popAtMs: number): void {
    if (this.lockedState !== true) return
    this.lockedState = false
    this.pop = { popAt: popAtMs, started: false }
  }

  /** Step the unlock pop (scene update). */
  update(nowMs: number): void {
    const pop = this.pop
    if (!pop || nowMs < pop.popAt) return
    if (!pop.started) {
      pop.started = true
      this.buildTag(false)
      for (const t of this.signText) t.destroy()
      this.signText = []
    }
    const f = signPopFrame(nowMs - pop.popAt)
    if (f === null) {
      this.endPop()
      return
    }
    this.sign?.setFrame(`sign_pop_${f}`, false, false)
  }

  private endPop(): void {
    this.pop = null
    if (this.lockedState === false) {
      this.destroySign()
      if (this.tagHasLock) this.buildTag(false)
    }
  }

  private buildSign(): void {
    const { x, y } = this.at
    // The board's feet stand on the tile's bottom vertex (style-guide §7).
    const sign = this.scene.add
      .image(x, y + HH, WORLD_ATLAS, 'sign_locked')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.sign)
    this.sign = sign
    this.layer.add(sign)
    const lines = [`Unlocks at Lv ${this.info.unlockLevel}`]
    if (this.info.trucksOnly) lines.push('Trucks only')
    const face = SIGN_LOCKED_FACE
    const left = sign.x - sign.width / 2
    const top = sign.y - sign.height
    const capsH = 7 + LINE_H * (lines.length - 1)
    const y0 = top + face.y + Math.floor((face.h - capsH) / 2) - 4
    if (this.hasFont)
      lines.forEach((s, i) => {
        const t = this.scene.add
          .bitmapText(0, 0, FONT_KEY, s, FONT_SIZE)
          .setTint(THEME.textDark)
          .setDepth(DEPTH.sign + 0.002)
        t.setPosition(
          Math.round(left + face.x + (face.w - t.width) / 2),
          Math.round(y0 + i * LINE_H),
        )
        this.signText.push(t)
        this.layer.add(t)
      })
  }

  private destroySign(): void {
    this.sign?.destroy()
    this.sign = null
    for (const t of this.signText) t.destroy()
    this.signText = []
  }

  private buildTag(locked: boolean): void {
    for (const o of this.tagObjs) o.destroy()
    this.tagObjs = []
    this.angry = null
    this.tagHasLock = locked
    const { x, y } = this.at
    let cy = y - 8
    if (locked && this.sign) {
      const top = this.sign.y - this.sign.height
      cy = Math.round(top - TAG_H / 2 - 2)
    }
    const d = DEPTH.label
    const text = this.hasFont
      ? this.scene.add
          .bitmapText(0, 0, FONT_KEY, this.info.name, FONT_SIZE)
          .setTint(THEME.textDark)
          .setDepth(d + 0.002)
      : null
    const textW = text ? text.width : 48
    const w = PAD_X * 2 + textW + (locked ? ICON_GAP + ICON : 0)
    const left = Math.round(x - w / 2)
    const top = Math.round(cy - TAG_H / 2)
    const tag = this.scene.add
      .nineslice(left, top, WORLD_ATLAS, 'ui_tag', w, TAG_H, 4, 4, 4, 4)
      .setOrigin(0, 0)
      .setDepth(d)
    this.tagObjs.push(tag)
    if (text) {
      text.setPosition(left + PAD_X, capTop(top + TAG_H / 2))
      this.tagObjs.push(text)
    }
    if (locked) {
      const lock = this.scene.add
        .image(left + PAD_X + textW + ICON_GAP, top + 1, WORLD_ATLAS, 'ic_lock')
        .setOrigin(0, 0)
        .setDepth(d + 0.001)
      this.tagObjs.push(lock)
    }
    // Angry icon slot on the plate's right end (hidden until loud, §9.2).
    this.angry = this.scene.add
      .image(left + w + 1, top + TAG_H / 2, WORLD_ATLAS, 'ic_angry')
      .setOrigin(0, 0.5)
      .setDepth(d + 0.003)
      .setVisible(this.angryState && !locked)
    this.tagObjs.push(this.angry)
    this.tagRect = { x: left, y: top, w: w + 1 + ICON, h: TAG_H }
    this.layer.add(this.tagObjs)
  }

  /** Angry icon below `satisfaction.loudBelow` (never on a locked region). */
  setAngry(on: boolean): void {
    const v = on && !this.locked
    if (v === this.angryState) return
    this.angryState = v
    if (!v) this.lastGrumble = null
    // While an unlock is pending the plate still shows the lock: it picks the
    // state up when it is rebuilt at the pop.
    if (!this.tagHasLock) this.angry?.setVisible(v)
  }

  get isAngry(): boolean {
    return this.angryState
  }

  /** The angry plate intersects the world rect (the camera's worldView). */
  angryOnScreen(view: {
    x: number
    y: number
    width: number
    height: number
  }): boolean {
    if (!this.angryState) return false
    const r = this.tagRect
    return (
      r.x < view.x + view.width &&
      r.x + r.w > view.x &&
      r.y < view.y + view.height &&
      r.y + r.h > view.y
    )
  }

  /**
   * World point on the name plate or the lock board — both draw over every
   * building (depth 9500), so a tap there means this district, not whatever
   * building or road lies under it (M4: the pick resolves what the player
   * sees).
   */
  hit(wx: number, wy: number): boolean {
    const r = this.tagRect
    if (r.w > 0 && wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h)
      return true
    const s = this.sign
    if (!s || !s.visible || s.alpha <= 0) return false
    const left = s.x - s.displayOriginX
    const top = s.y - s.displayOriginY
    return (
      wx >= left &&
      wx < left + s.displayWidth &&
      wy >= top &&
      wy < top + s.displayHeight
    )
  }

  /**
   * Grumble timer (spec §9.2): true when this angry, on-screen label is due
   * its grumble — the first time it is seen angry, then every `everyMs`.
   */
  tickGrumble(nowMs: number, onScreen: boolean, everyMs?: number): boolean {
    if (!this.angryState || !onScreen) return false
    if (!grumbleDue(this.lastGrumble, nowMs, everyMs)) return false
    this.lastGrumble = nowMs
    return true
  }

  destroy(): void {
    for (const o of this.tagObjs) o.destroy()
    this.tagObjs = []
    this.destroySign()
    this.angry = null
    this.pop = null
  }
}
