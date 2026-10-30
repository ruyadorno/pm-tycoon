// One city building (city-view.md §1.3, §1.4, §6.1; spec-core.md §3.5, §9.2):
// the static sprite (`_locked` frame while its region is fogged, flat-fill
// tint fallback), the mood overlay (live only, from the district value), the
// rush bell + draining ring, the waiting badge (ic_parcel + count at the
// doorstep, the count tinted by the oldest waiting parcel's decay phase) and
// the lost-life scorch (`mood_scorch_<class>`, city-view §3.3: one in-game
// day on the destination of a delivered malware parcel; the scene times it)
// and, M7 (spec-build2 §3.3, design-m7 §6.8), the magic parcel's gold
// `ic_magic` at the bell anchor (14 px higher while a rush bell is up) with
// its draining `magic_ring_<step>` to the right, on A and B while the
// golden parcel is on its way.
// Everything is a plain Image / BitmapText in the CityScene world Layer; the
// scene drives it (no sim access here, no per-frame work while idle). On a
// region unlock (§1.4) setLocked(false, true) hands the old `_locked` Image
// back with the new colour one at alpha 0 so the scene crossfades them.
import Phaser from 'phaser'
import type { BuildingDef } from '../data/index.ts'
import { FONT_KEY, WORLD_ATLAS } from './atlases.ts'
import { magicRingStep, ringStep, type MoodKind } from './cityFx.ts'
import type { DecayPhase } from './decayPhase.ts'
import { buildingSprite, frameOrNull, lockedFrame } from './frames.ts'
import { footprintAnchor, footprintDepth, tileToScreen } from './iso.ts'
import { FONT_SIZE, THEME } from '../ui/theme.ts'

/** Depth bands of the city world layer (city-view.md §1.3). */
export const DEPTH = {
  /** Class biases over the owning building / vehicle (notes §2). */
  mood: 0.01,
  scorch: 0.015,
  bell: 0.02,
  /** M7: the magic marker (ic_magic + its ring) over the rush bell. */
  magic: 0.025,
  smoke: 0.03,
  /**
   * Waiting badges and rush bells sit in an overlay band above every world
   * sprite (offset + the building's own depth keeps them ordered among
   * themselves) so a tower in front never hides the rush decision.
   */
  marker: 8000,
  highlight: 9000,
  label: 9500,
  sign: 9500,
  popup: 10000,
  tooltip: 20000,
} as const

/** Flat-fill tint for a fogged sprite whose `_locked` frame is missing (§1.4). */
export const LOCKED_FILL = 0xdfe6ea

/** Count tint per decay phase (style-guide §1.4 state colours). */
export const PHASE_TINT: Record<DecayPhase, number> = {
  plain: THEME.ok,
  amber: THEME.warn,
  red: THEME.danger,
}

export type { MoodKind } from './cityFx.ts'

const BADGE_ICON = 'ic_parcel_m'
/** m5x7 metrics (src/assets/m5x7.xml): cap top 4, cap height 7. */
export const CAP_TOP = 4
export const CAP_H = 7

/** Text y that centres an m5x7 cap line on `centreY` (integer, crisp). */
export function capTop(centreY: number): number {
  return Math.round(centreY - CAP_TOP - CAP_H / 2)
}
const BADGE_LIFT = 14
const BELL_LIFT = 6
const BELL_H = 16
/** Bell / magic icon x off the anchor, and their ring's (city-view §6.1). */
const BELL_DX = -5
const RING_DX = 9
/** The magic marker rides this far above a rush bell (design-m7 §6.8). */
export const MAGIC_OVER_BELL = 14

interface Pt {
  x: number
  y: number
}

/**
 * Visible (opaque, after atlas trimming) rect of an Image in world space:
 * Frame.x/y are the trim offsets inside the source canvas (0 untrimmed).
 */
export function visibleRect(
  img: Phaser.GameObjects.Image,
): Phaser.Geom.Rectangle {
  const f = img.frame
  return new Phaser.Geom.Rectangle(
    img.x - img.displayOriginX + f.x,
    img.y - img.displayOriginY + f.y,
    f.cutWidth,
    f.cutHeight,
  )
}

export class BuildingView {
  readonly def: BuildingDef
  readonly id: string
  /** Bottom vertex of the footprint's front tile (sprite origin (0.5, 1)). */
  readonly anchor: Pt
  /** Footprint depth (max tx + ty). */
  readonly depth: number
  /** Doorstep: between the door tile and its avenue anchor (badges, popups, hops). */
  readonly door: Pt
  private readonly scene: Phaser.Scene
  private readonly layer: Phaser.GameObjects.Layer
  private readonly hasFont: boolean
  private stem: string
  image: Phaser.GameObjects.Image | null = null
  locked: boolean
  private mood: Phaser.GameObjects.Image | null = null
  private moodKind: MoodKind = null
  private scorch: Phaser.GameObjects.Image | null = null
  private bell: Phaser.GameObjects.Image | null = null
  private ring: Phaser.GameObjects.Image | null = null
  private magicIcon: Phaser.GameObjects.Image | null = null
  private magicRing: Phaser.GameObjects.Image | null = null
  private badgeBg: Phaser.GameObjects.NineSlice | null = null
  private badgeIcon: Phaser.GameObjects.Image | null = null
  private badgeText: Phaser.GameObjects.BitmapText | null = null
  private waitingN = 0
  private waitingPhase: DecayPhase = 'plain'

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    ox: number,
    def: BuildingDef,
    doorOffset: readonly [number, number] | undefined,
    locked: boolean,
  ) {
    this.scene = scene
    this.layer = layer
    this.def = def
    this.id = def.id
    this.locked = locked
    this.hasFont = scene.cache.bitmapFont.has(FONT_KEY)
    this.stem = buildingSprite(def.id)
    this.anchor = footprintAnchor(def.tile, def.footprint, ox)
    this.depth = footprintDepth(def.tile, def.footprint)
    const off = doorOffset ?? [0, 0]
    const dx = def.tile[0] + off[0]
    const dy = def.tile[1] + off[1]
    const mid = tileToScreen(
      (dx + def.anchor[0]) / 2,
      (dy + def.anchor[1]) / 2,
      ox,
    )
    this.door = { x: Math.round(mid.x), y: Math.round(mid.y) }
    this.buildImage()
  }

  /** Footprint class suffix of the mood/scorch overlays (1x1, 2x2, 3x3). */
  get footprintClass(): string {
    return `${this.def.footprint[0]}x${this.def.footprint[1]}`
  }

  /** World y of the sprite's visible top (bells). */
  get topY(): number {
    return this.image ? visibleRect(this.image).y : this.anchor.y - 32
  }

  /**
   * Top of the rush-bell zone over the roof (the tooltip anchors above it);
   * M7: above the magic marker when it rides over a bell.
   */
  get markerTop(): number {
    const stacked = this.magicIcon !== null && this.bell !== null
    return this.topY - BELL_LIFT - BELL_H - (stacked ? MAGIC_OVER_BELL : 0)
  }

  private buildImage(): Phaser.GameObjects.Image | null {
    const name = lockedFrame(this.stem, this.locked)
    const fill = this.locked && name !== null && !name.endsWith('_locked')
    if (!name) return null
    const img = this.scene.add
      .image(this.anchor.x, this.anchor.y, WORLD_ATLAS, name)
      .setOrigin(0.5, 1)
      .setDepth(this.depth)
    if (fill) img.setTint(LOCKED_FILL).setTintMode(Phaser.TintModes.FILL)
    this.layer.add(img)
    this.image = img
    return img
  }

  /**
   * Swap between the fogged and colour sprite. With `crossfade` the new
   * Image starts at alpha 0 and the old one is NOT destroyed: both come back
   * in `{from, to}` and the caller fades `to` in, `from` out over 1 s and
   * then destroys `from` (§1.4, the only alpha tweens on world objects).
   */
  setLocked(
    locked: boolean,
    crossfade = false,
  ): {
    from: Phaser.GameObjects.Image | null
    to: Phaser.GameObjects.Image | null
  } {
    if (locked === this.locked) return { from: null, to: null }
    this.locked = locked
    const old = this.image
    this.image = null
    const img = this.buildImage()
    if (locked) {
      this.setScorch(false)
      this.setMood(null)
      this.setWaiting(0, 'plain')
      this.setRush(null)
      this.setMagic(null)
    }
    if (!crossfade || !old || !img) {
      old?.destroy()
      return { from: null, to: img }
    }
    img.setAlpha(0)
    return { from: old, to: img }
  }

  /** Mood overlay from the district value (spec §9.2); never on fogged buildings. */
  setMood(kind: MoodKind): void {
    const k = this.locked ? null : kind
    if (k === this.moodKind) return
    this.moodKind = k
    this.mood?.destroy()
    this.mood = null
    if (!k) return
    const name = frameOrNull(`mood_${k}_${this.footprintClass}`)
    if (!name) return
    this.mood = this.scene.add
      .image(this.anchor.x, this.anchor.y, WORLD_ATLAS, name)
      .setOrigin(0.5, 1)
      .setDepth(this.depth + DEPTH.mood)
    this.layer.add(this.mood)
  }

  /** Lost-life scorch overlay (city-view §3.3) over the sprite, at depth + 0.015. */
  setScorch(on: boolean): void {
    const want = on && !this.locked
    if (want === (this.scorch !== null)) return
    this.scorch?.destroy()
    this.scorch = null
    if (!want) return
    const name = frameOrNull(`mood_scorch_${this.footprintClass}`)
    if (!name) return
    this.scorch = this.scene.add
      .image(this.anchor.x, this.anchor.y, WORLD_ATLAS, name)
      .setOrigin(0.5, 1)
      .setDepth(this.depth + DEPTH.scorch)
    this.layer.add(this.scorch)
  }

  get scorched(): boolean {
    return this.scorch !== null
  }

  /** Waiting badge: hidden at 0; count tinted by the oldest parcel's phase. */
  setWaiting(n: number, phase: DecayPhase): void {
    if (this.locked) n = 0
    if (n === this.waitingN && phase === this.waitingPhase) return
    this.waitingN = n
    this.waitingPhase = phase
    if (n <= 0) {
      this.badgeBg?.setVisible(false)
      this.badgeIcon?.setVisible(false)
      this.badgeText?.setVisible(false)
      return
    }
    const d = DEPTH.marker + this.depth
    const y = this.door.y - BADGE_LIFT
    if (!this.badgeIcon) {
      this.badgeBg = this.scene.add
        .nineslice(0, y, WORLD_ATLAS, 'ui_panel_dark', 32, 20, 4, 4, 4, 4)
        .setOrigin(0, 0.5)
        .setAlpha(0.9)
        .setDepth(d)
      this.badgeIcon = this.scene.add
        .image(0, y, WORLD_ATLAS, BADGE_ICON)
        .setOrigin(0, 0.5)
        .setDepth(d + 0.001)
      this.layer.add([this.badgeBg, this.badgeIcon])
      if (this.hasFont) {
        this.badgeText = this.scene.add
          .bitmapText(0, y, FONT_KEY, '', FONT_SIZE)
          .setDropShadow(1, 1, THEME.shadow, 1)
          .setDepth(d + 0.002)
        this.layer.add(this.badgeText)
      }
    }
    const text = this.badgeText
    text?.setText(String(n)).setTint(PHASE_TINT[phase])
    const textW = text ? text.width : 0
    const w = 2 + 16 + (text ? 1 + textW : 0) + 4
    const left = Math.round(this.door.x - w / 2)
    this.badgeBg?.setSize(w, 20).setPosition(left, y).setVisible(true)
    this.badgeIcon?.setPosition(left + 2, y).setVisible(true)
    text?.setPosition(left + 19, capTop(y)).setVisible(true)
  }

  get waiting(): number {
    return this.waitingN
  }

  /**
   * Rush bell over the roof with the draining ring stepped at 0/25/50/75 %
   * of rushExpireS (city-view §6.1). `remaining` = 1 → 0, or null to clear.
   */
  setRush(remaining: number | null): void {
    if (remaining === null || this.locked) {
      const had = this.bell !== null
      this.bell?.destroy()
      this.ring?.destroy()
      this.bell = null
      this.ring = null
      if (had) this.placeMagic()
      return
    }
    const step = ringStep(remaining)
    const d = DEPTH.marker + this.depth + DEPTH.bell
    const x = this.anchor.x
    const y = this.bellY
    if (!this.bell) {
      this.ring = this.scene.add
        .image(x + RING_DX, y, WORLD_ATLAS, `rush_ring_${step}`)
        .setOrigin(0.5, 1)
        .setDepth(d)
      this.bell = this.scene.add
        .image(x + BELL_DX, y, WORLD_ATLAS, 'ic_bell')
        .setOrigin(0.5, 1)
        .setDepth(d + 0.001)
      this.layer.add([this.ring, this.bell])
      this.placeMagic()
    }
    this.ring?.setFrame(`rush_ring_${step}`, false, false)
  }

  /** Bottom y of the bell / magic icons over the roof. */
  private get bellY(): number {
    return Math.round(this.topY - BELL_LIFT)
  }

  /**
   * M7 magic marker (design-m7 §6.8): the gold `ic_magic` at the bell
   * anchor (MAGIC_OVER_BELL px higher while a rush bell is up) with the
   * countdown's `magic_ring_<step>` to its right; `remaining` = 1 → 0, or
   * null to clear. Hidden while fogged; frames the atlas lacks are skipped.
   */
  setMagic(remaining: number | null): void {
    const icon = frameOrNull('ic_magic')
    if (remaining === null || this.locked || !icon) {
      this.magicIcon?.destroy()
      this.magicRing?.destroy()
      this.magicIcon = null
      this.magicRing = null
      return
    }
    const ring = frameOrNull(`magic_ring_${magicRingStep(remaining)}`)
    const d = DEPTH.marker + this.depth + DEPTH.magic
    if (!this.magicIcon) {
      this.magicIcon = this.scene.add
        .image(0, 0, WORLD_ATLAS, icon)
        .setOrigin(0.5, 1)
        .setDepth(d + 0.001)
      this.layer.add(this.magicIcon)
    }
    if (ring && !this.magicRing) {
      this.magicRing = this.scene.add
        .image(0, 0, WORLD_ATLAS, ring)
        .setOrigin(0.5, 1)
        .setDepth(d)
      this.layer.add(this.magicRing)
    } else if (ring && this.magicRing?.frame.name !== ring)
      this.magicRing?.setFrame(ring, false, false)
    this.placeMagic()
  }

  /** True while the magic marker is shown (debug / e2e probes). */
  get magic(): boolean {
    return this.magicIcon !== null
  }

  /** Re-seat the magic marker over / at the bell anchor. */
  private placeMagic(): void {
    if (!this.magicIcon) return
    const x = this.anchor.x
    const y = this.bellY - (this.bell ? MAGIC_OVER_BELL : 0)
    this.magicIcon.setPosition(x + BELL_DX, y)
    this.magicRing?.setPosition(x + RING_DX, y)
  }

  /** True when world point (wx, wy) lands on an opaque pixel of the sprite. */
  hit(wx: number, wy: number): boolean {
    const img = this.image
    if (!img || !img.visible) return false
    const r = visibleRect(img)
    if (!r.contains(wx, wy)) return false
    const fx = Math.floor(wx - (img.x - img.displayOriginX))
    const fy = Math.floor(wy - (img.y - img.displayOriginY))
    const a = this.scene.textures.getPixelAlpha(
      fx,
      fy,
      WORLD_ATLAS,
      img.frame.name,
    )
    return (a ?? 0) > 0
  }

  destroy(): void {
    for (const o of [
      this.image,
      this.mood,
      this.scorch,
      this.bell,
      this.ring,
      this.magicIcon,
      this.magicRing,
      this.badgeBg,
      this.badgeIcon,
      this.badgeText,
    ])
      o?.destroy()
    this.image = null
    this.mood = null
    this.scorch = null
    this.bell = null
    this.ring = null
    this.magicIcon = null
    this.magicRing = null
    this.badgeBg = null
    this.badgeIcon = null
    this.badgeText = null
  }
}
