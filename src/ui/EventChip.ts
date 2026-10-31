// Build 3 M12 (B3 §3.4): the HUD row-B event chip — `ic_event` + the live
// modifier count, shown while a modifier is live or a card waits (it pulses
// then: a tap raises the card, else opens the EffectsCard). It sits on the
// dark top bar like the QuestChip (no panel): 24 px wide, the icon at x 1
// with the count glyph at x 17, or centred (x 4) without a count. Its tap
// zone is a scene child at the row's hit box with the id 'eventChip' (e2e
// tapTarget). The pulse is the QuestChip's 1-Hz blink (questPulseAlpha) on
// the scene clock, and it never runs once the game is over (M12 critique 8:
// a card the sim can no longer decide must not blink behind the GameOverCard).
// The model is pure (tests/ui/event-chip.test.ts); Phaser is a type-only
// import; world-atlas frames only (the HUD binds `world`).
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import type { EventsView } from '../sim/view-api.ts'
import { addTapZone, setZoneRect } from './hudKit.ts'
import { EVENT_CHIP_W, ROW_H, type Rect } from './layout.ts'
import { questPulseAlpha } from './QuestChip.ts'
import { addText, textTop } from './text.ts'
import { THEME } from './theme.ts'

export interface EventChipModel {
  visible: boolean
  /** Live modifiers (the count glyph). */
  count: number
  /** A card waits behind a modal: the chip blinks (questPulseAlpha). */
  pulse: boolean
}

export const EVENT_CHIP_HIDDEN: EventChipModel = {
  visible: false,
  count: 0,
  pulse: false,
}

/** The chip's icon frame (world atlas). */
export const EVENT_CHIP_FRAME = 'ic_event'
/** The icon's size (icon16). */
export const EVENT_CHIP_ICON = 16
/** Chip-local x of the icon beside a count. */
export const EVENT_CHIP_ICON_X = 1
/** Chip-local x of the count glyph. */
export const EVENT_CHIP_COUNT_X = 17
/** The tap zone's id (e2e `tapTarget(page, pm, 'HUD', 'eventChip')`). */
export const EVENT_CHIP_ID = 'eventChip'

/**
 * Visible while a modifier is live or a card is pending; pulses while
 * pending. At game over (`gameOver`) a pending card counts for nothing: the
 * chip only stays for the live modifiers and never pulses (critique 8).
 */
export function eventChipModel(
  ev: Pick<EventsView, 'modifiers'>,
  pending: boolean,
  gameOver = false,
): EventChipModel {
  const count = ev.modifiers.length
  const waits = pending && !gameOver
  return { visible: count > 0 || waits, count, pulse: waits }
}

/** `''` at 0, `1`…`9`, `+` from 10 (one m5x7 glyph). */
export function eventChipCountText(n: number): string {
  const c = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
  if (c === 0) return ''
  return c >= 10 ? '+' : String(c)
}

/** Chip-local x of the icon: beside the count, or centred in `w` without one. */
export function eventChipIconX(countText: string, w = EVENT_CHIP_W): number {
  return countText === ''
    ? Math.round((w - EVENT_CHIP_ICON) / 2)
    : EVENT_CHIP_ICON_X
}

export class EventChip {
  readonly root: Phaser.GameObjects.Container
  private readonly scene: Phaser.Scene
  private icon: Phaser.GameObjects.Image
  private countText: Phaser.GameObjects.BitmapText
  private zone: Phaser.GameObjects.Zone
  private model: EventChipModel = EVENT_CHIP_HIDDEN
  private tapFn: (() => void) | null = null
  private w = EVENT_CHIP_W
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.icon = scene.add
      .image(
        eventChipIconX(''),
        Math.floor((ROW_H - EVENT_CHIP_ICON) / 2),
        UI_ATLAS,
        EVENT_CHIP_FRAME,
      )
      .setOrigin(0, 0)
    this.countText = addText(scene, EVENT_CHIP_COUNT_X, textTop(0, ROW_H), '', {
      tint: THEME.textLight,
    })
    this.root = scene.add
      .container(0, 0, [this.icon, this.countText])
      .setVisible(false)
    // The tap zone stays a scene child at its absolute hit box (the
    // container only carries the visuals), like the QuestChip's.
    this.zone = addTapZone(
      scene,
      { x: 0, y: 0, w: 1, h: 1 },
      () => this.tapFn?.(),
      EVENT_CHIP_ID,
    )
    this.setZoneEnabled(false)
    scene.events.on('update', this.onUpdate, this)
  }

  /** The model shown (EVENT_CHIP_HIDDEN when hidden). */
  get current(): EventChipModel {
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

  set(m: EventChipModel): void {
    if (this.destroyed) return
    this.model = m
    this.root.setVisible(m.visible)
    this.setZoneEnabled(m.visible)
    if (!m.visible) {
      this.root.setAlpha(1)
      return
    }
    const t = eventChipCountText(m.count)
    this.countText.setText(t).setVisible(t !== '')
    this.icon.setX(eventChipIconX(t, this.w))
    this.root.setAlpha(questPulseAlpha(m.pulse, this.scene.time.now))
  }

  /** The visual rect (row B) and the tap zone's hit box (absolute px). */
  setRect(r: Rect, hit: Rect): void {
    if (this.destroyed) return
    this.w = Math.round(r.w)
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
    this.tapFn = null
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
