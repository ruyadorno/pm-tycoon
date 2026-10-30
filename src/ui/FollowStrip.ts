// Follow strip (city-view.md §2 "Cargo strip when followed", §4 L.followStrip):
// 32 px above the chips row while the City camera follows a vehicle:
//   [type icon] Bike 1 · Dee ●●●●○ · Delivering · 2 stops   [S]×3 [M]×1  [✕]
// M6 (spec-build2 §2.5, design-m6 §6.3): the driver's speed pips sit after
// the name (`ic_pip_on` / `ic_pip_off`, 7-px pitch; hidden when the atlas
// has no pip frames or nobody drives); when the line is too long the state
// text is ellipsized first, then the pips go (hudKit followFit).
// The state text uses the §4.6 states (`Idle`, `Collecting`, `Returning`,
// `Queued #2`, `Unloading`, `Loading`, `Delivering · N stops`, `No driver`);
// cargo is grouped by size. ✕ emits pm:follow {vehicleId: null} through the
// onClose callback (HudScene). The pure text helpers (followModel, followFit,
// vehicleStateText, cargoCounts) live in hudKit.ts so Vitest can load them
// without the kit Button; Phaser is a type-only import here.
//
// The type glyph is placed from its frame's real size (followIconPos), so a
// redrawn icon or a bigger vehicle canvas (the bike went 24² → 32², plan-
// build2 §8.2 task 5) lays out without a code change.
import type Phaser from 'phaser'
import { frameOrNull, type FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import type { Size } from '../sim/types.ts'
import type { VehicleSnapshot } from '../sim/view-api.ts'
import { Button } from './Button.ts'
import {
  cargoCounts,
  FOLLOW_PIP_GAP_L,
  FOLLOW_PIP_PITCH,
  FOLLOW_PIPS,
  FOLLOW_PIPS_W,
  followFit,
  followModel,
} from './hudKit.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { addText, textTop } from './text.ts'
import { THEME } from './theme.ts'

const PARCEL_ICON: Record<Size, FrameName> = {
  S: 'ic_parcel_s',
  M: 'ic_parcel_m',
  L: 'ic_parcel_l',
  XL: 'ic_parcel_xl',
}
const TYPE_ICON: Record<string, FrameName> = {
  bike: 'ic_bike',
  van: 'ic_van',
  truck: 'ic_truck',
}
const STRIP_ALPHA = 0.92
/** The parcel icons' size (icon16). */
const ICON = 16
const GAP = 4
const PAD_X = 6

/**
 * The type glyph's top-left in a strip `stripH` tall at `stripY`, and the x
 * where the text starts, from the glyph frame's real size.
 */
export function followIconPos(
  w: number,
  h: number,
  stripY: number,
  stripH: number,
): { x: number; y: number; textX: number } {
  const iw = Math.round(w)
  return {
    x: PAD_X,
    y: stripY + Math.max(0, Math.floor((stripH - Math.round(h)) / 2)),
    textX: PAD_X + iw + GAP,
  }
}

export interface FollowStripOptions {
  onClose: () => void
}

export class FollowStrip {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private L: Layout
  private bg: Phaser.GameObjects.NineSlice
  private icon: Phaser.GameObjects.Image
  private text: Phaser.GameObjects.BitmapText
  private tail: Phaser.GameObjects.BitmapText
  private pips: Phaser.GameObjects.Image[] = []
  private cargo: Phaser.GameObjects.Container
  private close: Button
  private id: number | null = null
  private key = ''

  constructor(scene: Phaser.Scene, L: Layout, opts: FollowStripOptions) {
    this.scene = scene
    this.L = L
    this.bg = addPanel(scene, 0, 0, L.W, L.followStrip.h, 'ui_panel_dark')
    this.bg.setAlpha(STRIP_ALPHA)
    // The strip swallows taps (it is a HUD band while shown).
    this.bg.setInteractive()
    this.icon = scene.add.image(0, 0, UI_ATLAS, 'ic_bike').setOrigin(0, 0)
    this.text = addText(scene, 0, 0, '', { tint: THEME.textLight })
    this.tail = addText(scene, 0, 0, '', { tint: THEME.textLight })
    const pipOff = frameOrNull('ic_pip_off')
    if (pipOff && frameOrNull('ic_pip_on')) {
      for (let i = 0; i < FOLLOW_PIPS; i++)
        this.pips.push(
          scene.add
            .image(0, 0, UI_ATLAS, pipOff)
            .setOrigin(0, 0)
            .setVisible(false),
        )
    }
    this.cargo = scene.add.container(0, 0)
    this.close = new Button(scene, {
      x: L.followClose.rect.x,
      y: L.followClose.rect.y,
      w: L.followClose.rect.w,
      h: L.followClose.rect.h,
      hit: L.followClose.hit,
      label: '✕',
      id: 'follow:close',
      onClick: () => opts.onClose(),
    })
    this.root = scene.add
      .container(0, 0, [
        this.bg,
        this.icon,
        this.text,
        this.tail,
        ...this.pips,
        this.cargo,
        this.close,
      ])
      .setVisible(false)
    this.relayout(L)
  }

  get vehicleId(): number | null {
    return this.id
  }

  get visible(): boolean {
    return this.root.visible
  }

  show(vehicleId: number): void {
    this.id = vehicleId
    this.key = ''
    this.root.setVisible(true)
  }

  hide(): void {
    this.id = null
    this.key = ''
    this.root.setVisible(false)
  }

  /** Refresh from the followed vehicle's snapshot (cheap when unchanged). */
  update(v: VehicleSnapshot | null): void {
    if (!this.root.visible || !v) return
    const counts = cargoCounts(v.cargo)
    const m = followModel(v)
    const line = `${m.head}|${m.pips ?? '-'}|${m.tail}`
    const key = `${v.type}|${line}|${counts.map((c) => c.size + c.n).join(',')}`
    if (key === this.key) return
    this.key = key
    this.icon.setFrame(TYPE_ICON[v.type] ?? 'ic_bike')
    const at = this.placeIcon()
    this.cargo.removeAll(true)
    // Cargo groups right-aligned before the close button.
    const right = this.L.followClose.rect.x - GAP
    let x = right
    const y = this.L.followStrip.y
    for (let i = counts.length - 1; i >= 0; i--) {
      const c = counts[i]!
      const t = addText(this.scene, 0, 0, `×${c.n}`, { tint: THEME.textLight })
      x -= Math.round(t.width)
      t.setPosition(x, textTop(y, this.L.followStrip.h))
      x -= ICON + 1
      const img = this.scene.add
        .image(
          x,
          y + Math.floor((this.L.followStrip.h - ICON) / 2),
          UI_ATLAS,
          PARCEL_ICON[c.size],
        )
        .setOrigin(0, 0)
      x -= GAP
      this.cargo.add([img, t])
    }
    const maxW = x - GAP - at.textX
    this.layoutLine(m, maxW, at.textX)
  }

  /** Head text, speed pips and the state tail inside `maxW` from `textX`. */
  private layoutLine(
    m: ReturnType<typeof followModel>,
    maxW: number,
    textX: number,
  ): void {
    const measure = (s: string): number => this.tail.setText(s).width
    const fit = followFit(
      this.pips.length > 0 ? m : { ...m, pips: null },
      maxW,
      measure,
    )
    this.text.setText(fit.head)
    this.tail.setText(fit.tail)
    const r = this.L.followStrip
    let x = textX + Math.round(this.text.width)
    const on = fit.pips && m.pips !== null ? m.pips : -1
    const pipOn = frameOrNull('ic_pip_on')
    const pipOff = frameOrNull('ic_pip_off')
    this.pips.forEach((img, i) => {
      if (on < 0 || !pipOn || !pipOff) {
        img.setVisible(false)
        return
      }
      img
        .setFrame(i < on ? pipOn : pipOff)
        .setPosition(
          x + FOLLOW_PIP_GAP_L + i * FOLLOW_PIP_PITCH,
          r.y + Math.floor((r.h - Math.round(img.height)) / 2),
        )
        .setVisible(true)
    })
    if (on >= 0) x += FOLLOW_PIPS_W
    else if (fit.tail) x += 4
    this.tail.setPosition(x, textTop(r.y, r.h)).setVisible(fit.tail !== '')
  }

  /** Glyph and text x from the current frame's size. */
  private placeIcon(): { x: number; y: number; textX: number } {
    const r = this.L.followStrip
    const at = followIconPos(this.icon.width, this.icon.height, r.y, r.h)
    this.icon.setPosition(at.x, at.y)
    this.text.setX(at.textX)
    return at
  }

  relayout(L: Layout): void {
    this.L = L
    const r = L.followStrip
    this.bg.setPosition(0, r.y).setSize(L.W, r.h)
    // A 44-px (L.minHit) hit band that ends 2 px above the strip's bottom,
    // where the chips' hit boxes begin (layout.ts), growing over the city.
    const hitH = Math.max(r.h, L.minHit)
    if (this.bg.input?.hitArea)
      (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(
        0,
        r.h - 2 - hitH,
        L.W,
        hitH,
      )
    this.text.setY(textTop(r.y, r.h))
    this.tail.setY(textTop(r.y, r.h))
    this.placeIcon()
    this.close.setRect(L.followClose.rect, L.followClose.hit)
    this.key = ''
  }

  destroy(): void {
    this.root.destroy()
  }
}
