// Follow strip (city-view.md §2 "Cargo strip when followed", §4 L.followStrip):
// 32 px above the chips row while the City camera follows a vehicle:
//   [type icon] Bike 1 · Dee · Delivering · 2 stops   [S]×3 [M]×1  [✕]
// The state text uses the §4.6 states (`Idle`, `Collecting`, `Returning`,
// `Queued #2`, `Unloading`, `Loading`, `Delivering · N stops`, `No driver`);
// cargo is grouped by size. ✕ emits pm:follow {vehicleId: null} through the
// onClose callback (HudScene). The pure text helpers (followText,
// vehicleStateText, cargoCounts) live in hudKit.ts so Vitest can load them
// without the kit Button; Phaser is a type-only import here.
import type Phaser from 'phaser'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import type { Size } from '../sim/types.ts'
import type { VehicleSnapshot } from '../sim/view-api.ts'
import { Button } from './Button.ts'
import { cargoCounts, followText } from './hudKit.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { addText, ellipsize, textTop } from './text.ts'
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
const ICON = 16
const GAP = 4

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
      .container(0, 0, [this.bg, this.icon, this.text, this.cargo, this.close])
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
    const line = followText(v)
    const key = `${v.type}|${line}|${counts.map((c) => c.size + c.n).join(',')}`
    if (key === this.key) return
    this.key = key
    this.icon.setFrame(TYPE_ICON[v.type] ?? 'ic_bike')
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
        .image(x, y + 8, UI_ATLAS, PARCEL_ICON[c.size])
        .setOrigin(0, 0)
      x -= GAP
      this.cargo.add([img, t])
    }
    const textX = 6 + ICON + GAP
    const maxW = x - GAP - textX
    this.text.setText(ellipsize(line, maxW, (s) => this.text.setText(s).width))
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
    this.icon.setPosition(6, r.y + 8)
    this.text.setPosition(6 + ICON + GAP, textTop(r.y, r.h))
    this.close.setRect(L.followClose.rect, L.followClose.hit)
    this.key = ''
  }

  destroy(): void {
    this.root.destroy()
  }
}
