// Building tooltip (city-view.md §5.2, §6.1): a `ui_panel` NineSlice in the
// CityScene world layer at depth 20000, anchored 8 px above the building
// sprite's top and clamped inside the uncovered camera view, max width 200,
// shown for 4 s or until another tap. Lines:
//   1 the building name
//   2 `Waiting: 2 · oldest 2:10 (late)` + ic_parcel_<size> per parcel (max 3),
//     the age suffixed by the decay phase (same decayPhase as the badge), or
//     `Nothing waiting`
//   3 the rush state: ic_bell + `Rushed · 0:42`, or the failed rush reason
//     (`Trucks only` / `Needs a van` / `No vehicle free — flagged` /
//     `Already rushed · 0:42`); omitted when neither applies
//   4 `Registry Row · favours van` + the `District ▸` link (CityScene routes a
//     tap on it to pm:select {kind: 'district'}).
// The owning scene builds the model (it reads the sim) and refreshes it at
// 2 Hz while the tooltip is visible; this class only lays it out.
import Phaser from 'phaser'
import { FONT_KEY, WORLD_ATLAS } from '../render/atlases.ts'
import { capTop, DEPTH } from '../render/BuildingView.ts'
import {
  formatMmSs,
  phaseSuffix,
  type DecayPhase,
} from '../render/decayPhase.ts'
import { minHitFor } from './layout.ts'
import { FONT_SIZE, PALETTE, THEME } from './theme.ts'

export const TOOLTIP_MS = 4000
export const TOOLTIP_MAX_W = 200
const PAD = 6
const ROW = 16
const ICON = 16
const GAP_ABOVE = 8
const MAX_ICONS = 3
const LINK_TEXT = 'District ▸'

/** Age colour on the light panel (darker shades of the badge tints). */
const PHASE_TEXT: Record<DecayPhase, number> = {
  plain: THEME.textDark,
  amber: PALETTE.yellow0,
  red: PALETTE.red0,
}

const measure = (t: Phaser.GameObjects.BitmapText | undefined): number =>
  t ? t.width : 0

export type RushLine =
  | { kind: 'rushed'; remainingS: number }
  | { kind: 'already'; remainingS: number }
  | { kind: 'failed'; text: string }

export interface TooltipModel {
  buildingId: string
  districtId: string
  name: string
  waiting: number
  oldestS: number | null
  phase: DecayPhase
  /** Lower-case sizes of the waiting parcels, oldest first. */
  sizes: readonly string[]
  rush: RushLine | null
  /** `Registry Row · favours van` (or the trucks-only note). */
  footer: string
}

/** World-space rect the tooltip must stay inside. */
export interface ClampRect {
  x: number
  y: number
  w: number
  h: number
}

export class BuildingTooltip {
  private readonly scene: Phaser.Scene
  private readonly hasFont: boolean
  private readonly panel: Phaser.GameObjects.NineSlice
  private readonly lines: Phaser.GameObjects.BitmapText[] = []
  private readonly link: Phaser.GameObjects.BitmapText | null
  private readonly icons: Phaser.GameObjects.Image[] = []
  private readonly bell: Phaser.GameObjects.Image
  private model: TooltipModel | null = null
  private anchorX = 0
  private anchorTop = 0
  private clamp: ClampRect | null = null
  private ageMs = 0
  private linkRect = new Phaser.Geom.Rectangle()
  /** True while shown from a mouse hover (closed when the hover leaves). */
  hover = false

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene
    this.hasFont = scene.cache.bitmapFont.has(FONT_KEY)
    const d = DEPTH.tooltip
    this.panel = scene.add
      .nineslice(0, 0, WORLD_ATLAS, 'ui_panel', 64, 32, 4, 4, 4, 4)
      .setOrigin(0, 0)
      .setDepth(d)
    layer.add(this.panel)
    for (let i = 0; i < 4 && this.hasFont; i++) {
      const t = scene.add
        .bitmapText(0, 0, FONT_KEY, '', FONT_SIZE)
        .setTint(THEME.textDark)
        .setDepth(d + 0.002)
      this.lines.push(t)
      layer.add(t)
    }
    this.link = this.hasFont
      ? scene.add
          .bitmapText(0, 0, FONT_KEY, LINK_TEXT, FONT_SIZE)
          .setTint(PALETTE.blue0)
          .setDepth(d + 0.002)
      : null
    if (this.link) layer.add(this.link)
    for (let i = 0; i < MAX_ICONS; i++) {
      const ic = scene.add
        .image(0, 0, WORLD_ATLAS, 'ic_parcel_s')
        .setOrigin(0, 0)
        .setDepth(d + 0.001)
      this.icons.push(ic)
      layer.add(ic)
    }
    this.bell = scene.add
      .image(0, 0, WORLD_ATLAS, 'ic_bell')
      .setOrigin(0, 0)
      .setDepth(d + 0.001)
    layer.add(this.bell)
    this.hide()
  }

  get visible(): boolean {
    return this.model !== null
  }

  get buildingId(): string | null {
    return this.model?.buildingId ?? null
  }

  get districtId(): string | null {
    return this.model?.districtId ?? null
  }

  /** Show for `model` above world point (x, topY); restarts the 4 s timer. */
  show(model: TooltipModel, x: number, topY: number, clamp: ClampRect): void {
    this.anchorX = x
    this.anchorTop = topY
    this.clamp = clamp
    this.ageMs = 0
    this.hover = false
    this.model = model
    this.layout()
  }

  /** Refresh the content in place (2 Hz from the scene); keeps the timer. */
  refresh(model: TooltipModel): void {
    if (!this.model || model.buildingId !== this.model.buildingId) return
    this.model = model
    this.layout()
  }

  /** Re-clamp after the camera moved. */
  setClamp(clamp: ClampRect): void {
    if (!this.model) return
    this.clamp = clamp
    this.layout()
  }

  hide(): void {
    this.model = null
    this.hover = false
    this.panel.setVisible(false)
    for (const t of this.lines) t.setVisible(false)
    this.link?.setVisible(false)
    for (const ic of this.icons) ic.setVisible(false)
    this.bell.setVisible(false)
  }

  /** Advance the 4 s timer; hides when it runs out. */
  update(delta: number): void {
    if (!this.model) return
    this.ageMs += delta
    if (this.ageMs >= TOOLTIP_MS) this.hide()
  }

  /** What a tap at world (x, y) hits: the District link, the body, or nothing. */
  hit(x: number, y: number): 'link' | 'body' | null {
    if (!this.model) return null
    const grow = 6
    const r = this.linkRect
    // The link is a tap target: at least 44 CSS px tall on screen (city-view
    // §1.1), i.e. minHit logical px divided by the city camera's zoom.
    const z = this.scene.cameras.main.zoom || 1
    const minH = minHitFor(this.scene.scale.zoom) / z
    const growY = Math.max(grow, Math.ceil((minH - r.height) / 2))
    if (
      x >= r.x - grow &&
      x <= r.right + grow &&
      y >= r.y - growY &&
      y <= r.bottom + growY
    )
      return 'link'
    return this.panel.getBounds().contains(x, y) ? 'body' : null
  }

  private layout(): void {
    const m = this.model
    if (!m) return
    // Row texts.
    const waitText =
      m.waiting > 0 ? `Waiting: ${m.waiting} · oldest ` : 'Nothing waiting'
    const ageText =
      m.waiting > 0 && m.oldestS !== null
        ? `${formatMmSs(m.oldestS)}${phaseSuffix(m.phase)}`
        : ''
    let rushText = ''
    let rushColour: number = THEME.textDark
    if (m.rush?.kind === 'rushed')
      rushText = `Rushed · ${formatMmSs(m.rush.remainingS)}`
    else if (m.rush?.kind === 'already')
      rushText = `Already rushed · ${formatMmSs(m.rush.remainingS)}`
    else if (m.rush?.kind === 'failed') {
      rushText = m.rush.text
      rushColour = PALETTE.red0
    }
    const bellOn = m.rush !== null && m.rush.kind !== 'failed'
    const [tName, tWait, tRush, tFoot] = this.lines
    const iconsN = Math.min(MAX_ICONS, m.sizes.length)

    let w = 0
    tName?.setText(m.name)
    tWait?.setText(waitText + ageText)
    if (tWait) {
      // -1 clears the per-character tint (the object tint applies again).
      tWait.setCharacterTint(0, -1, Phaser.TintModes.MULTIPLY, -1)
      if (ageText)
        tWait.setCharacterTint(
          waitText.length,
          ageText.length,
          Phaser.TintModes.MULTIPLY,
          PHASE_TEXT[m.phase],
        )
    }
    tRush?.setText(rushText).setTint(rushColour)
    tFoot?.setText(m.footer)
    const iconsW = iconsN * ICON
    const waitW = measure(tWait) + (iconsN ? 2 + iconsW : 0)
    const iconsWrap = PAD * 2 + waitW > TOOLTIP_MAX_W
    const linkW = this.link ? this.link.width : 0
    // The District link shares the footer row when it fits, else gets its own.
    const linkWrap = PAD * 2 + measure(tFoot) + 6 + linkW > TOOLTIP_MAX_W
    w = Math.max(
      measure(tName),
      iconsWrap ? Math.max(measure(tWait), iconsW) : waitW,
      rushText ? measure(tRush) + (bellOn ? ICON + 2 : 0) : 0,
      linkWrap ? Math.max(measure(tFoot), linkW) : measure(tFoot) + 6 + linkW,
    )
    w = Math.min(TOOLTIP_MAX_W, w + PAD * 2)
    const rows =
      3 +
      (rushText ? 1 : 0) +
      (iconsWrap && iconsN ? 1 : 0) +
      (linkWrap ? 1 : 0)
    const h = rows * ROW + PAD * 2 - 2

    // Position: centred over the anchor, 8 px above the sprite top, clamped.
    let x = Math.round(this.anchorX - w / 2)
    let y = Math.round(this.anchorTop - GAP_ABOVE - h)
    const c = this.clamp
    if (c) {
      x = Math.max(c.x + 2, Math.min(c.x + c.w - w - 2, x))
      y = Math.max(c.y + 2, Math.min(c.y + c.h - h - 2, y))
    }
    this.panel.setSize(w, h).setPosition(x, y).setVisible(true)

    let row = 0
    const rowY = (r: number): number => y + PAD + r * ROW
    const textAt = (
      t: Phaser.GameObjects.BitmapText | undefined,
      tx: number,
      r: number,
    ): void => {
      t?.setPosition(Math.round(tx), capTop(rowY(r) + ROW / 2 - 1)).setVisible(
        true,
      )
    }
    textAt(tName, x + PAD, row++)
    textAt(tWait, x + PAD, row)
    let iconX = x + PAD + measure(tWait) + 2
    if (iconsWrap) {
      row++
      iconX = x + PAD
    }
    this.icons.forEach((ic, i) => {
      if (i >= iconsN) {
        ic.setVisible(false)
        return
      }
      ic.setFrame(`ic_parcel_${m.sizes[i] ?? 's'}`, false, false)
        .setPosition(iconX + i * ICON, rowY(row) - 1)
        .setVisible(true)
    })
    row++
    if (rushText) {
      let tx = x + PAD
      if (bellOn) {
        this.bell.setPosition(tx, rowY(row) - 1).setVisible(true)
        tx += ICON + 2
      } else this.bell.setVisible(false)
      textAt(tRush, tx, row++)
    } else {
      this.bell.setVisible(false)
      tRush?.setVisible(false)
    }
    textAt(tFoot, x + PAD, row)
    if (linkWrap) row++
    if (this.link) {
      const lx = x + w - PAD - linkW
      textAt(this.link, lx, row)
      this.linkRect.setTo(lx, rowY(row), linkW, ROW)
    }
  }

  destroy(): void {
    this.panel.destroy()
    for (const t of this.lines) t.destroy()
    this.link?.destroy()
    for (const ic of this.icons) ic.destroy()
    this.bell.destroy()
  }
}
