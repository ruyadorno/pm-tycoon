// District label (city-view.md §1.3, §1.4; spec-core.md §9.2): a `ui_tag`
// NineSlice plate with the flavour name in 16-px m5x7 at the region's
// labelTile (map.json), depth 9500. A locked region adds the lock glyph after
// the name and its `sign_locked` board ("Unlocks at Lv N", + "Trucks only"
// for the trucks-only district) stands under the plate. A live district below
// `satisfaction.loudBelow` shows ic_angry on the plate's right end. The
// grumble SFX belongs to the open district panel (audio.md §7 row 16), so
// this class keeps no timer.
import Phaser from 'phaser'
import { FONT_KEY, WORLD_ATLAS } from './atlases.ts'
import { capTop, DEPTH } from './BuildingView.ts'
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
  private objects: Phaser.GameObjects.GameObject[] = []
  private angry: Phaser.GameObjects.Image | null = null
  private lockedState: boolean | null = null
  private angryState = false

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

  /** Rebuild for the lock state (TODO(M3): sign_pop + fade on region:unlocked). */
  setLocked(locked: boolean): void {
    if (locked === this.lockedState) return
    this.lockedState = locked
    for (const o of this.objects) o.destroy()
    this.objects = []
    this.angry = null
    this.angryState = false
    const { x, y } = this.at
    let tagCentreY = y - 8
    if (locked) {
      // The board's feet stand on the tile's bottom vertex (style-guide §7).
      const sign = this.scene.add
        .image(x, y + HH, WORLD_ATLAS, 'sign_locked')
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.sign)
      this.objects.push(sign)
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
          this.objects.push(t)
        })
      tagCentreY = Math.round(top - TAG_H / 2 - 2)
    }
    this.buildTag(x, tagCentreY, locked)
    this.layer.add(this.objects)
  }

  private buildTag(cx: number, cy: number, locked: boolean): void {
    const d = DEPTH.label
    const text = this.hasFont
      ? this.scene.add
          .bitmapText(0, 0, FONT_KEY, this.info.name, FONT_SIZE)
          .setTint(THEME.textDark)
          .setDepth(d + 0.002)
      : null
    const textW = text ? text.width : 48
    const w = PAD_X * 2 + textW + (locked ? ICON_GAP + ICON : 0)
    const left = Math.round(cx - w / 2)
    const top = Math.round(cy - TAG_H / 2)
    const tag = this.scene.add
      .nineslice(left, top, WORLD_ATLAS, 'ui_tag', w, TAG_H, 4, 4, 4, 4)
      .setOrigin(0, 0)
      .setDepth(d)
    this.objects.push(tag)
    if (text) {
      text.setPosition(left + PAD_X, capTop(top + TAG_H / 2))
      this.objects.push(text)
    }
    if (locked) {
      const lock = this.scene.add
        .image(left + PAD_X + textW + ICON_GAP, top + 1, WORLD_ATLAS, 'ic_lock')
        .setOrigin(0, 0)
        .setDepth(d + 0.001)
      this.objects.push(lock)
    }
    // Angry icon slot on the plate's right end (hidden until loud, §9.2).
    this.angry = this.scene.add
      .image(left + w + 1, top + TAG_H / 2, WORLD_ATLAS, 'ic_angry')
      .setOrigin(0, 0.5)
      .setDepth(d + 0.003)
      .setVisible(false)
    this.objects.push(this.angry)
  }

  /** Angry icon below `satisfaction.loudBelow` (never on a locked region). */
  setAngry(on: boolean): void {
    const v = on && !this.locked
    if (v === this.angryState) return
    this.angryState = v
    this.angry?.setVisible(v)
  }

  destroy(): void {
    for (const o of this.objects) o.destroy()
    this.objects = []
    this.angry = null
  }
}
