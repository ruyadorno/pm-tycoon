// Detection-shield popover (city-view.md §5.3, spec §6.3 "HUD readout"):
// anchored under the HUD shield (L.shield), right-aligned with it. Header
// `Lane 15/min · Detection 97%`, then one row per active strain
// (`ic_strain_<s>` + `metal 97%`, coloured green ≥ 90 / amber 70–89 /
// red < 70); the weakest strain's row appends `→ Shaky shaker $300` (its
// parcels.json `counter` machine and machines.json price), and a tap on that
// row emits `pm:goto {view: 'warehouse', highlight: machineId}`. Any tap
// outside closes it (the tap is swallowed); Esc closes it too.
//
// Constructed by HudScene: `new ShieldPopover(scene, L, viewSim)`;
// toggle() / open() / close() / isOpen() / refresh() / relayout(L). It
// refreshes itself at 2 Hz while open (lane stats need no event).
import type Phaser from 'phaser'
import type { GameData } from '../data/types.ts'
import type { LaneStats, ViewSim } from '../sim/view-api.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, formatMoney, formatPct, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'
import { addTapZone, PopoverLayer } from './ZonePicker.ts'

export const EV_GOTO = 'pm:goto'

/** Spec §6.3 readout colours: green ≥ 90, amber 70–89, red < 70 (display rule). */
export const DETECTION_OK = 90
export const DETECTION_WARN = 70

export type Tone = 'ok' | 'warn' | 'danger'

/** Tone of a detection percentage (§6.3). */
export function detectionTone(pct: number): Tone {
  if (pct >= DETECTION_OK) return 'ok'
  if (pct >= DETECTION_WARN) return 'warn'
  return 'danger'
}

/** Text tints on light panels (the darker shade of each state colour). */
export const TONE_TEXT: Record<Tone, number> = {
  ok: PALETTE.grass0,
  warn: PALETTE.yellow0,
  danger: PALETTE.red0,
}

/** Tints on dark panels / for the light-drawn ic_shield (style-guide §1.4). */
export const TONE_LIGHT: Record<Tone, number> = {
  ok: THEME.ok,
  warn: THEME.warn,
  danger: THEME.danger,
}

/** `Lane 15/min · Detection 97%` (§6.3 readout). */
export function laneReadout(
  s: Pick<LaneStats, 'ratePerMin' | 'detectionPct'>,
): string {
  return `${laneRateText(s)} · ${detectionText(s)}`
}

/** `Lane 15/min` */
export function laneRateText(s: Pick<LaneStats, 'ratePerMin'>): string {
  return `Lane ${Math.round(s.ratePerMin)}/min`
}

/** `Detection 97%` */
export function detectionText(s: Pick<LaneStats, 'detectionPct'>): string {
  return `Detection ${formatPct(s.detectionPct)}`
}

/** `→ Shaky shaker $300` for a machines.json checker id, or null if unknown. */
export function counterText(data: GameData, machineId: string): string | null {
  const m = data.machines.checkers.find((c) => c.id === machineId)
  return m ? `→ ${m.name} ${formatMoney(m.price)}` : null
}

export interface StrainRow {
  strain: string
  /** `metal 97%` */
  text: string
  pct: number
  tone: Tone
  /** The weakest strain's counter machine (exactly one row has it). */
  counter: { machineId: string; text: string } | null
}

/**
 * One row per active strain; the weakest (first on ties) carries the counter
 * — unless the lane already holds that machine (`stats.suggest.owned`):
 * "metal 97% → Metal detector $150" right after buying one read as an
 * advert for the machine on screen (UX M2 review).
 */
export function strainRows(
  stats: Pick<LaneStats, 'byStrain'> & Partial<Pick<LaneStats, 'suggest'>>,
  data: GameData,
): StrainRow[] {
  let weakest = -1
  stats.byStrain.forEach((s, i) => {
    if (weakest < 0 || s.pct < (stats.byStrain[weakest]?.pct ?? 101))
      weakest = i
  })
  const owned = stats.suggest?.owned === true ? stats.suggest.counter : null
  return stats.byStrain.map((s, i) => {
    const text =
      i === weakest && s.counter !== owned ? counterText(data, s.counter) : null
    return {
      strain: s.strain,
      text: `${s.strain} ${formatPct(s.pct)}`,
      pct: s.pct,
      tone: detectionTone(s.pct),
      counter: text ? { machineId: s.counter, text } : null,
    }
  })
}

// ---- geometry ----------------------------------------------------------------

export const SHIELD_POP_W = 220
export const SHIELD_POP_HEADER_H = 24
export const SHIELD_POP_ROW_H = 20
const PAD = 6
const ICON = 16
const GAP = 4
const REFRESH_MS = 500

/** Popover height for `n` strain rows (city-view §5.3: 24 + 20 × n). */
export function shieldPopoverHeight(n: number): number {
  return SHIELD_POP_HEADER_H + SHIELD_POP_ROW_H * n + 2
}

export class ShieldPopover {
  readonly scene: Phaser.Scene
  private vs: ViewSim
  private L: Layout
  private layer: PopoverLayer | null = null
  private sig = ''
  private header: Phaser.GameObjects.BitmapText | null = null
  private headerPct: Phaser.GameObjects.BitmapText | null = null
  private rowTexts: Phaser.GameObjects.BitmapText[] = []
  private counterTexts: (Phaser.GameObjects.BitmapText | null)[] = []
  private sinceRefresh = 0

  constructor(scene: Phaser.Scene, L: Layout, viewSim: ViewSim) {
    this.scene = scene
    this.L = L
    this.vs = viewSim
    scene.events.on('update', this.onUpdate, this)
    scene.events.once('shutdown', this.destroy, this)
  }

  isOpen(): boolean {
    return this.layer !== null
  }

  toggle(): void {
    if (this.isOpen()) this.close()
    else this.open()
  }

  open(): void {
    if (this.layer) return
    this.build(this.vs.laneStats())
    pushModal(this)
    this.scene.input.keyboard?.on('keydown', this.onKey, this)
  }

  close(): void {
    if (!this.layer) return
    this.layer.destroy()
    this.layer = null
    this.sig = ''
    this.header = null
    this.headerPct = null
    this.rowTexts = []
    this.counterTexts = []
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
  }

  /** Re-read laneStats (rebuilds when the strain set changed). */
  refresh(): void {
    if (!this.layer) return
    const stats = this.vs.laneStats()
    const rows = strainRows(stats, this.vs.data)
    if (this.signature(rows) !== this.sig) {
      this.layer.destroy()
      this.layer = null
      this.build(stats)
      return
    }
    this.header?.setText(`${laneRateText(stats)} · Detection`)
    this.headerPct
      ?.setText(formatPct(stats.detectionPct))
      .setTint(TONE_TEXT[detectionTone(stats.detectionPct)])
    rows.forEach((r, i) => {
      this.rowTexts[i]?.setText(r.text).setTint(TONE_TEXT[r.tone])
      const c = this.counterTexts[i]
      if (c && r.counter) c.setText(r.counter.text)
    })
  }

  relayout(L: Layout): void {
    this.L = L
    if (!this.layer) return
    this.layer.destroy()
    this.layer = null
    this.build(this.vs.laneStats())
  }

  destroy(): void {
    this.close()
    this.scene.events.off('update', this.onUpdate, this)
    this.scene.events.off('shutdown', this.destroy, this)
  }

  // ---- internals -----------------------------------------------------------

  private signature(rows: readonly StrainRow[]): string {
    return rows.map((r) => `${r.strain}:${r.counter?.machineId ?? ''}`).join()
  }

  private build(stats: LaneStats): void {
    const scene = this.scene
    const L = this.L
    const rows = strainRows(stats, this.vs.data)
    this.sig = this.signature(rows)
    const layer = new PopoverLayer(scene, {
      W: L.W,
      H: L.H,
      onOutside: () => this.close(),
    })
    this.layer = layer

    // Width: at least 220, wide enough for the longest row, inside the screen.
    const measure = addText(scene, 0, 0, '')
    const widthOf = (s: string): number => Math.round(measure.setText(s).width)
    let w = SHIELD_POP_W
    w = Math.max(w, 2 * PAD + widthOf(`${laneReadout(stats)}`))
    for (const r of rows) {
      const rowW =
        PAD +
        ICON +
        GAP +
        widthOf(r.text) +
        (r.counter ? GAP + widthOf(r.counter.text) : 0) +
        PAD
      w = Math.max(w, rowW)
    }
    measure.destroy()
    w = Math.min(w, L.W - 8)
    const h = shieldPopoverHeight(rows.length)
    const s = L.shield.rect
    const x = Math.round(Math.max(4, Math.min(L.W - 4 - w, s.x + s.w - w)))
    const y = Math.round(s.y + s.h + 2)

    const panel = addPanel(scene, x, y, w, h, 'ui_panel').setInteractive()
    layer.add(panel)

    this.header = addText(
      scene,
      x + PAD,
      textTop(y + 2, SHIELD_POP_HEADER_H - 2),
      `${laneRateText(stats)} · Detection`,
    )
    this.headerPct = addText(
      scene,
      x + PAD + Math.round(this.header.width) + 5,
      this.header.y,
      formatPct(stats.detectionPct),
      { tint: TONE_TEXT[detectionTone(stats.detectionPct)] },
    )
    layer.add(this.header, this.headerPct)

    this.rowTexts = []
    this.counterTexts = []
    rows.forEach((r, i) => {
      const ry = y + SHIELD_POP_HEADER_H + i * SHIELD_POP_ROW_H
      const icon = scene.add
        .image(
          x + PAD,
          ry + Math.floor((SHIELD_POP_ROW_H - ICON) / 2),
          UI_ATLAS,
          `ic_strain_${r.strain}`,
        )
        .setOrigin(0, 0)
      const t = addText(scene, x + PAD + ICON + GAP, 0, r.text, {
        tint: TONE_TEXT[r.tone],
      })
      t.setY(textTop(ry, SHIELD_POP_ROW_H))
      layer.add(icon, t)
      this.rowTexts.push(t)
      if (!r.counter) {
        this.counterTexts.push(null)
        return
      }
      const machineId = r.counter.machineId
      const c = addText(
        scene,
        t.x + Math.round(t.width) + GAP,
        t.y,
        r.counter.text,
        { tint: THEME.primary },
      )
      this.counterTexts.push(c)
      // The whole row is the tap target, grown to ≥ 44 px inside the panel.
      const hitH = Math.min(h, Math.max(SHIELD_POP_ROW_H, this.L.minHit))
      const hitY = Math.min(
        Math.max(y, ry + Math.floor((SHIELD_POP_ROW_H - hitH) / 2)),
        y + h - hitH,
      )
      const zone = addTapZone(
        scene,
        { x, y: hitY, w, h: hitH },
        `shield:${machineId}`,
        () => {
          this.close()
          scene.game.events.emit(EV_GOTO, {
            view: 'warehouse',
            highlight: machineId,
          })
        },
        (down) => c.setTint(down ? PALETTE.blue0 : THEME.primary),
      )
      layer.add(c, zone)
    })
  }

  private onUpdate(_t: number, delta: number): void {
    if (!this.layer) return
    this.sinceRefresh += delta
    if (this.sinceRefresh < REFRESH_MS) return
    this.sinceRefresh = 0
    this.refresh()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && claimKey(ev, this)) this.close()
  }
}
