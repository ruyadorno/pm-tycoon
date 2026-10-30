// Quest chip (spec-build2 §3.1, design-m7 §6.4): the HUD row-B cell between
// the level bar and the shield while a quest is offered or active —
// `ic_quest` (`ic_magic` for the golden parcel) + a 60-px gold progress bar
// with its count (`4/10`, `58/60`, `41/60`; the golden parcel's bar drains
// with its clock, no text) + the time label (`1d 12h`; the magic countdown
// `m:ss`, red under 30 s; the Golden Release `0✕ 94%`). An open offer pulses at 1 Hz with `New job` in place of the bar
// (the offer's expiry as the label); a tap opens the QuestCard (HudScene).
// The texts come from questText.ts (the card and the chip share them); the
// model is pure and Node-tested (tests/ui/hud-m7.test.ts), Phaser is a
// type-only import. World-atlas frames only (the HUD binds `world`).
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import type { GameData } from '../data/types.ts'
import type { QuestsView } from '../sim/view-api.ts'
import { addTapZone, setZoneRect } from './hudKit.ts'
import {
  QUEST_CHIP_BAR_W,
  QUEST_CHIP_ICON,
  QUEST_CHIP_W,
  ROW_H,
  type Rect,
} from './layout.ts'
import { addBar, BAR_H, barFrame, setBarFill } from './Panel.ts'
import { chipLabel, chipProgressText } from './questText.ts'
import { addText, ellipsize, textTop } from './text.ts'
import { THEME } from './theme.ts'

export type QuestChipTone = 'light' | 'warn' | 'danger'

export interface QuestChipModel {
  visible: boolean
  icon: 'ic_quest' | 'ic_magic'
  /** An open offer waits for a tap: the chip blinks at 1 Hz. */
  pulse: boolean
  /** Progress 0..1, or null (an offer: no bar). */
  bar: number | null
  /** On the bar (`4/10`), or the offer's call to action (`New job`). */
  barText: string
  /** Right of the bar: time left / expiry / `0✕ 94%`. */
  label: string
  tone: QuestChipTone
  /** The Golden Release: the label reads gold while its tone is light. */
  gold: boolean
}

/** The bar's stand-in while a quest is only offered. */
export const QUEST_OFFER_TEXT = 'New job'
/** The offer pulse: on/off every half second (1 Hz). */
export const QUEST_PULSE_MS = 500
/** Alpha of the pulse's dim half. */
export const QUEST_PULSE_ALPHA = 0.5

export const QUEST_CHIP_HIDDEN: QuestChipModel = {
  visible: false,
  icon: 'ic_quest',
  pulse: false,
  bar: null,
  barText: '',
  label: '',
  tone: 'light',
  gold: false,
}

/**
 * The chip for the quest slots: the active quest when there is one, else
 * the offer, else hidden. An offer waiting behind the active quest (the
 * Golden Release at L5) shows once it ends, but the chip pulses meanwhile:
 * a tap opens the active card, which names the waiting offer. `data` lets
 * the Golden Release label warn under its on-time floor
 * (questText.chipLabel).
 */
export function questChipModel(
  qs: QuestsView,
  data?: GameData,
): QuestChipModel {
  const q = qs.active ?? qs.offer
  if (!q) return QUEST_CHIP_HIDDEN
  const offer = q.status === 'offered'
  const l = chipLabel(q, data)
  return {
    visible: true,
    icon: q.kind === 'magicParcel' ? 'ic_magic' : 'ic_quest',
    pulse: offer || qs.offer !== null,
    bar: offer ? null : Math.min(1, Math.max(0, q.progress01)),
    // The golden parcel's bar drains with its clock and the label is the
    // clock: no second `1:58` on the bar.
    barText: offer
      ? QUEST_OFFER_TEXT
      : q.kind === 'magicParcel'
        ? ''
        : chipProgressText(q),
    label: l.text,
    tone: l.tone,
    gold: q.ultimate,
  }
}

/** The label tint for a tone (gold for the Golden Release while light). */
export function questChipTint(
  m: Pick<QuestChipModel, 'tone' | 'gold'>,
): number {
  if (m.tone === 'danger') return THEME.danger
  if (m.tone === 'warn') return THEME.warn
  return m.gold ? THEME.gold : THEME.textLight
}

/** Pulse alpha at `now` ms (1 while not pulsing). */
export function questPulseAlpha(pulse: boolean, now: number): number {
  if (!pulse) return 1
  return Math.floor(now / QUEST_PULSE_MS) % 2 === 0 ? 1 : QUEST_PULSE_ALPHA
}

/** Chip-local x of the bar (icon + 2 px). */
export const QUEST_CHIP_BAR_X = QUEST_CHIP_ICON + 2
/** Least air between the bar's end and a right-aligned label. */
export const QUEST_CHIP_LABEL_GAP = 2
/** The bar never gives up more than this to a long label. */
export const QUEST_CHIP_BAR_MIN_W = 44

/**
 * Fit the right-aligned time label into the chip (design-m7 §6.4: a 34-px
 * slot, but `1d 12h` measures 35 and the Golden Release's `0✕ 100%` 41 in
 * m5x7). A label that leaves QUEST_CHIP_LABEL_GAP px before the 60-px bar
 * keeps it; a wider one takes the difference from the bar, down to
 * QUEST_CHIP_BAR_MIN_W, and only past that is ellipsized. `measure` is the
 * label's advance width (`s => t.setText(s).width`).
 */
export function questChipFit(
  label: string,
  chipW: number,
  measure: (s: string) => number,
): { label: string; barW: number } {
  const room = (barW: number): number =>
    chipW - QUEST_CHIP_BAR_X - barW - QUEST_CHIP_LABEL_GAP
  const w = Math.ceil(measure(label))
  const over = w - room(QUEST_CHIP_BAR_W)
  if (over <= 0) return { label, barW: QUEST_CHIP_BAR_W }
  const barW = Math.max(QUEST_CHIP_BAR_MIN_W, QUEST_CHIP_BAR_W - over)
  return {
    label: w <= room(barW) ? label : ellipsize(label, room(barW), measure),
    barW,
  }
}

export class QuestChip {
  readonly root: Phaser.GameObjects.Container
  private readonly scene: Phaser.Scene
  private icon: Phaser.GameObjects.Image
  private track: Phaser.GameObjects.NineSlice
  private fill: Phaser.GameObjects.NineSlice
  private barText: Phaser.GameObjects.BitmapText
  private label: Phaser.GameObjects.BitmapText
  private zone: Phaser.GameObjects.Zone
  private model: QuestChipModel = QUEST_CHIP_HIDDEN
  private tapFn: (() => void) | null = null
  private w = QUEST_CHIP_W
  private barW = QUEST_CHIP_BAR_W
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    const by = Math.floor((ROW_H - BAR_H) / 2)
    this.icon = scene.add
      .image(0, Math.floor((ROW_H - QUEST_CHIP_ICON) / 2), UI_ATLAS, 'ic_quest')
      .setOrigin(0, 0)
    this.track = addBar(scene, QUEST_CHIP_BAR_X, by, QUEST_CHIP_BAR_W)
    this.fill = addBar(
      scene,
      QUEST_CHIP_BAR_X,
      by,
      QUEST_CHIP_BAR_W,
      barFrame('gold'),
    )
    this.barText = addText(scene, 0, textTop(0, ROW_H), '', {
      tint: THEME.textLight,
      shadow: true,
    })
    this.label = addText(scene, 0, textTop(0, ROW_H), '', {
      tint: THEME.textLight,
    })
    this.root = scene.add
      .container(0, 0, [
        this.icon,
        this.track,
        this.fill,
        this.barText,
        this.label,
      ])
      .setVisible(false)
    // The tap zone stays a scene child at its absolute hit box (the
    // container only carries the visuals).
    this.zone = addTapZone(
      scene,
      { x: 0, y: 0, w: 1, h: 1 },
      () => this.tapFn?.(),
      'questChip',
    )
    this.setZoneEnabled(false)
    scene.events.on('update', this.onUpdate, this)
  }

  /** The model shown (QUEST_CHIP_HIDDEN when hidden). */
  get current(): QuestChipModel {
    return this.model
  }

  get visible(): boolean {
    return this.model.visible
  }

  setDepth(d: number): this {
    this.root.setDepth(d)
    this.zone.setDepth(d)
    return this
  }

  set(m: QuestChipModel): void {
    this.model = m
    this.root.setVisible(m.visible)
    this.setZoneEnabled(m.visible)
    if (!m.visible) return
    this.icon.setFrame(m.icon)
    const fit = questChipFit(
      m.label,
      this.w,
      (s) => this.label.setText(s).width,
    )
    if (fit.barW !== this.barW) {
      this.barW = fit.barW
      this.track.setSize(fit.barW, BAR_H)
    }
    const offer = m.bar === null
    this.track.setVisible(!offer)
    if (offer) this.fill.setVisible(false)
    else setBarFill(this.fill, this.barW, m.bar ?? 0)
    this.barText.setText(m.barText)
    this.barText.setTint(offer ? THEME.gold : THEME.textLight)
    const bw = Math.round(this.barText.width)
    this.barText.setX(
      offer
        ? QUEST_CHIP_BAR_X
        : QUEST_CHIP_BAR_X + Math.round((this.barW - bw) / 2),
    )
    this.label.setText(fit.label).setTint(questChipTint(m))
    // Right-aligned on the chip's edge (the advance's trailing column is air).
    this.label.setX(Math.round(this.w - this.label.width))
    this.root.setAlpha(questPulseAlpha(m.pulse, this.scene.time.now))
  }

  /** The visual rect (row B) and the tap hit box, both absolute. */
  setRect(r: Rect, hit: Rect): void {
    this.w = r.w
    this.root.setPosition(Math.round(r.x), Math.round(r.y))
    setZoneRect(this.zone, hit)
    if (this.model.visible) this.set(this.model)
  }

  onTap(fn: () => void): void {
    this.tapFn = fn
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.events.off('update', this.onUpdate, this)
    this.zone.destroy()
    this.root.destroy()
  }

  private setZoneEnabled(on: boolean): void {
    this.zone.setVisible(on)
    if (this.zone.input) this.zone.input.enabled = on
  }

  private onUpdate(time: number): void {
    if (!this.model.visible || !this.model.pulse) return
    this.root.setAlpha(questPulseAlpha(true, time))
  }
}
