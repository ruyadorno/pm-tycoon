// QuestCard (spec-build2 §3.1, §3.4; design-m7 §6.3; plan-build2 §8.4 task
// 4): the job-board card, Newspaper-style. A `ui_panel` 300×212 (at most
// W − 12 wide) centred 8 px above the bottom bar (360×604 → y 320, 393×659 →
// y 375; the 430-px column centres it), `ui_card_gold` for the Golden
// Release and the complete state. Rows (card-local tops):
//   0–24   masthead: `ic_quest` + `JOB BOARD` / `THE GOLDEN RELEASE` /
//          `QUEST COMPLETE`, `Day N` right
//   26     double rule
//   32     title (gold)
//   48     flavour (≤ 2 lines, muted; puns.json quests, `{district}` filled);
//          an active quest with an offer waiting on it (the Golden Release
//          at L5) shows `The Golden Release is waiting — finish or abandon
//          this job to take it.` here instead, in gold
//   80     objective (≤ 2 lines, questText.objectiveText)
//   112    reward (`Reward: …`, the sim's rewardSummary; one line — the
//          district drops off when it would overflow)
//   126    time (`Time: 5 days · the offer stays open` / `Time left: 1d 12h`)
//   140    an offer that waits on the active quest: `Finish "Rush hour" first`
//   144    gold progress bar, 8 px (active; full when complete)
//   160    buttons, 44 px: the Golden Release offer `Accept` (primary 120,
//          x 6) · `Later` (72, x 134) — no Decline (spec-core §8); active
//          `Abandon` (red 96, x 6; a confirm Dialog) · `Close` (120, right);
//          complete `OK`.
// It never pauses the sim (B2 §3.1 "the sim keeps running") but sits on the
// modal stack while open, so the Newspaper waits and Esc / Enter come here:
// Esc and a tap outside (a transparent full-screen scrim) are Later on an
// offer, Close otherwise; Enter is Accept / Close / OK.
// Build 3 M12 (B3 §3.4, §6 "one path for jobs"): a regular job offer is an
// EventCard (`JOB BOARD`, Accept / Decline, a decideEvent), so the only offer
// this card shows is the Golden Release's standing one; it keeps the active
// and complete states of every quest. M13 (plan-build3 §8.4 task 2, Q-B3-15):
// the build-2 job-offer leftovers are gone — no `Decline` button, and no
// offer countdown (no offer expires since build 3: the time row of an offer
// is always `· the offer stays open`).
//
// Callbacks: every user dismissal calls exactly one of them — Later (button,
// Esc, outside) → onLater; a confirmed Abandon → onAbandon(id); Close / OK
// (button, Esc, outside, Enter) → onClose — and
// the card closes itself first. Accept → onAccept(id) and the card STAYS
// open: the caller closes it on success (`close()`) or calls `deny(text)`
// on a refusal (the Golden Release while a quest is active → quest-active).
// refresh() re-reads time, progress, the blocked and waiting lines from the polled
// view; an offer accepted elsewhere turns the card to its active state; a
// quest that left the slot closes it, except the complete state, which
// stays until OK (completeOn(questId, reward) turns the card to it on
// quest:completed when it shows that quest). Programmatic close() calls
// nothing.
//
// Pure model and geometry are unit-tested under Node
// (tests/ui/quest-card.test.ts); Phaser is a type-only import.
import type Phaser from 'phaser'
import type { GameData } from '../data/types.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull } from '../render/frames.ts'
import type { BuildingId, QuestReward } from '../sim/types.ts'
import { TICKS_PER_DAY } from '../sim/types.ts'
import type { QuestView } from '../sim/view-api.ts'
import { Button, TAP_PX } from './Button.ts'
import { Dialog } from './Dialog.ts'
import type { Layout, Rect } from './layout.ts'
import { wrapHeadline } from './Newspaper.ts'
import { addBar, addPanel, barFrame, setBarFill } from './Panel.ts'
import {
  buildingNamer,
  formatCountdown,
  formatQuestDays,
  formatQuestTime,
  objectiveText,
  questTicksLeftAt,
  rewardText,
  waitingText,
} from './questText.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, LINE_H, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'
import { EV_UI_SFX } from './ZonePicker.ts'

// ---- geometry --------------------------------------------------------------------

export const QUEST_CARD_W = 300
export const QUEST_CARD_H = 212
/** Air between the card and the bottom bar (the Newspaper's). */
export const QUEST_CARD_GAP = 8
export const QUEST_CARD_PAD = 12
/** Text width inside the card (300 − 2 × 12). */
export const QUEST_CARD_INNER_W = QUEST_CARD_W - 2 * QUEST_CARD_PAD
/** Flavour and objective wrap to at most this many lines. */
export const QUEST_CARD_LINES = 2
/** Above the sheets (5000), under the popovers (7000) and tooltips (9500). */
export const QUEST_CARD_DEPTH = 6000
/** Card-local row tops (design-m7 §6.3). */
export const QUEST_CARD_ROWS = {
  masthead: 0,
  rule: 26,
  title: 32,
  flavour: 48,
  objective: 80,
  reward: 112,
  time: 126,
  blocked: 140,
  bar: 144,
  buttons: 160,
} as const
export const QUEST_CARD_BTN_H = 44
export const QUEST_CARD_IN_MS = 300

const MASTHEAD_H = 24
const ICON_PX = 16
/** Button row: 6 px in, 8-px gaps, 14 px of air on the right at 300. */
const BTN_X0 = 6
const BTN_GAP = 8
const BTN_RIGHT = 14
const BTN_MIN_W = 72
const SHAKE_PX = 2
const SHAKE_MS = 160
const MUTED = PALETTE.grey1
/** Gold that reads on the light card (HireSheet's ★ name colour). */
const GOLD_TEXT = PALETTE.gold0
const EV_TOOLTIP = 'pm:tooltip'

export type QuestCardMode = 'offer' | 'active' | 'complete'
export type QuestCardButton = 'accept' | 'later' | 'abandon' | 'close' | 'ok'

export const QUEST_BUTTON_LABEL: Readonly<Record<QuestCardButton, string>> = {
  accept: 'Accept',
  later: 'Later',
  abandon: 'Abandon',
  close: 'Close',
  ok: 'OK',
}

const BUTTON_W: Readonly<Record<QuestCardButton, number>> = {
  accept: 120,
  later: 72,
  abandon: 96,
  close: 120,
  ok: 120,
}

const BUTTON_FACE: Readonly<
  Record<QuestCardButton, 'primary' | 'secondary' | 'red'>
> = {
  accept: 'primary',
  later: 'secondary',
  abandon: 'red',
  close: 'secondary',
  ok: 'primary',
}

const ALL_BUTTONS: readonly QuestCardButton[] = [
  'accept',
  'later',
  'abandon',
  'close',
  'ok',
]

/**
 * The card rect (screen px): 300 wide (at most W − 12), centred, its bottom
 * 8 px above the bottom bar, never above the ticker's bottom.
 */
export function questCardRect(
  L: Pick<Layout, 'W' | 'bottomBar' | 'ticker'>,
): Rect {
  const w = Math.min(QUEST_CARD_W, Math.round(L.W) - 12)
  const y = Math.max(
    L.ticker.y + L.ticker.h,
    L.bottomBar.y - QUEST_CARD_GAP - QUEST_CARD_H,
  )
  return { x: Math.round((L.W - w) / 2), y: Math.round(y), w, h: QUEST_CARD_H }
}

/**
 * The button row (card-local x and width; y = QUEST_CARD_ROWS.buttons, h 44)
 * for a card `w` px wide: left to right from x 6 with 8-px gaps (Accept 6,
 * Later 134 at 300); a lone button is centred; Close sits at
 * the right edge (14 px in). A narrow card shrinks the first button.
 */
export function questCardButtonRects(
  w: number,
  buttons: readonly QuestCardButton[],
): { name: QuestCardButton; x: number; w: number }[] {
  if (buttons.length === 1) {
    const name = buttons[0] as QuestCardButton
    const bw = Math.min(BUTTON_W[name], w - 2 * BTN_X0)
    return [{ name, x: Math.round((w - bw) / 2), w: bw }]
  }
  const widths = buttons.map((b) => BUTTON_W[b])
  const need =
    widths.reduce((a, b) => a + b, 0) + BTN_GAP * (buttons.length - 1)
  const room = w - BTN_X0 - BTN_RIGHT
  if (need > room && widths.length > 0)
    widths[0] = Math.max(BTN_MIN_W, (widths[0] as number) - (need - room))
  let x = BTN_X0
  const out = buttons.map((name, i) => {
    const bw = widths[i] as number
    const r = { name, x, w: bw }
    x += bw + BTN_GAP
    return r
  })
  const close = out.find((r) => r.name === 'close')
  if (close) close.x = w - BTN_RIGHT - close.w
  return out
}

// ---- model (pure) ------------------------------------------------------------------

export interface QuestCardModel {
  title: string
  masthead: string
  /** `ui_card_gold` (the Golden Release, and every complete card). */
  gold: boolean
  flavour: string
  objective: string
  reward: string
  time: string
  /** 0..1 for the gold bar, null = no bar. */
  bar: number | null
  /** Left to right. */
  buttons: QuestCardButton[]
  /** `Finish "Rush hour" first` while the offer waits on the active quest. */
  blocked: string | null
  /** The flavour row is the waiting line (an offer waits on this active quest): gold. */
  waiting: boolean
}

/** The masthead word for a mode. */
export function questMasthead(
  data: GameData,
  q: Pick<QuestView, 'ultimate'>,
  mode: QuestCardMode,
): string {
  if (mode === 'complete') return 'QUEST COMPLETE'
  return q.ultimate ? data.puns.ultimateQuestName.toUpperCase() : 'JOB BOARD'
}

/**
 * The time row: an offer shows what the quest gives and that it stands
 * (`Time: 5 days · the offer stays open`; the magic parcel `Time: 2:00 · …`
 * — no offer expires since build 3, B3 §3.2, and the Golden Release's is the
 * only one this card shows); an active quest shows its time left, a
 * completed one the day it was done.
 */
export function questTimeText(
  q: QuestView,
  mode: QuestCardMode,
  tick: number,
): string {
  const magic = q.kind === 'magicParcel'
  if (mode === 'complete') {
    return `Completed on Day ${Math.floor(Math.max(0, tick) / TICKS_PER_DAY) + 1}`
  }
  if (mode === 'active') {
    const t = questTicksLeftAt(q, tick) ?? 0
    return `Time left: ${magic ? formatCountdown(t) : formatQuestTime(t)}`
  }
  const allow = magic
    ? formatCountdown(q.limitTicks)
    : formatQuestDays(q.limitTicks)
  return `Time: ${allow} · the offer stays open`
}

/** The gold bar: the magic clock drains, every other kind fills (progress01). */
export function questBarValue(q: QuestView, tick: number): number {
  if (q.kind === 'magicParcel' && q.status === 'active') {
    const left = questTicksLeftAt(q, tick) ?? 0
    return Math.min(1, Math.max(0, left / Math.max(1, q.limitTicks)))
  }
  return Math.min(1, Math.max(0, q.progress01))
}

/**
 * The buttons of a mode, left to right. An offer is Accept / Later: since M12
 * only the Golden Release reaches the offer mode (a job offer is an
 * EventCard), and it never has a Decline (spec-core §8).
 */
export function questCardButtons(mode: QuestCardMode): QuestCardButton[] {
  if (mode === 'complete') return ['ok']
  if (mode === 'active') return ['abandon', 'close']
  return ['accept', 'later']
}

/**
 * Everything the card shows for `q` in `mode` at `tick`. `blockedBy` is the
 * name of the active quest an offer waits on (questText.questBlockedBy);
 * `waitingOn` the name of the offer waiting on this active quest
 * (questText.questWaitingOn).
 */
export function questCardModel(
  data: GameData,
  q: QuestView,
  mode: QuestCardMode,
  tick: number,
  buildingName: (id: BuildingId) => string,
  blockedBy: string | null,
  waitingOn: string | null = null,
): QuestCardModel {
  const waiting = mode === 'active' && waitingOn !== null
  return {
    title: q.name,
    masthead: questMasthead(data, q, mode),
    gold: q.ultimate || mode === 'complete',
    flavour: waiting ? waitingText(waitingOn) : q.flavour,
    waiting,
    objective: objectiveText(data, q, buildingName),
    reward: rewardText(data, q),
    time: questTimeText(q, mode, tick),
    bar:
      mode === 'active'
        ? questBarValue(q, tick)
        : mode === 'complete'
          ? 1
          : null,
    buttons: questCardButtons(mode),
    blocked:
      mode === 'offer' && blockedBy !== null
        ? `Finish "${blockedBy}" first`
        : null,
  }
}

/**
 * The Abandon confirm (design-m7 §6.3): no penalty, and when another job
 * can come (build 3: events.json schedule.jobCooldownDays after a quest
 * ends — then a draw brings it, B3 §3.2) or the Golden Release comes back.
 */
export function abandonDialogText(
  data: GameData,
  q: Pick<QuestView, 'name' | 'ultimate'>,
): { title: string; text: string } {
  const days = q.ultimate
    ? data.quests.offer.declineCooldownDays
    : data.events.schedule.jobCooldownDays
  const when = formatQuestDays(Math.round(days * TICKS_PER_DAY))
  return {
    title: `Abandon ${q.name}?`,
    text: q.ultimate
      ? `No penalty — it comes back in ${when}.`
      : `No penalty — you can take another job in ${when}.`,
  }
}

// ---- view ----------------------------------------------------------------------------

export interface QuestCardOptions {
  onAccept(id: string): void
  /** Later on the Golden Release's offer (the button, Esc or a tap outside). */
  onLater(): void
  onAbandon(id: string): void
  onClose(): void
  /**
   * The name of the active quest an offer waits on — pass
   * `(q) => questBlockedBy(vs.quests(), q)`; default: never blocked.
   */
  blockedBy?: (q: QuestView) => string | null
  /**
   * The name of the offer waiting on an active quest — pass
   * `(q) => questWaitingOn(vs.quests(), q)`; default: none.
   */
  waitingOn?: (q: QuestView) => string | null
  /** The magic route's building names; default buildings.json `name`. */
  buildingName?: (id: BuildingId) => string
  depth?: number
}

export class QuestCard {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly scrim: Phaser.GameObjects.Rectangle
  private L: Layout
  private data: GameData
  private opts: QuestCardOptions
  private rect: Rect
  private panel: Phaser.GameObjects.NineSlice
  private goldPanel: Phaser.GameObjects.NineSlice
  private icon: Phaser.GameObjects.Image | null
  private mastText: Phaser.GameObjects.BitmapText
  private dayText: Phaser.GameObjects.BitmapText
  private rules: Phaser.GameObjects.Rectangle[]
  private titleText: Phaser.GameObjects.BitmapText
  private flavourText: Phaser.GameObjects.BitmapText
  private objectiveLine: Phaser.GameObjects.BitmapText
  private rewardLine: Phaser.GameObjects.BitmapText
  private timeText: Phaser.GameObjects.BitmapText
  private blockedText: Phaser.GameObjects.BitmapText
  private barTrack: Phaser.GameObjects.NineSlice
  private barFill: Phaser.GameObjects.NineSlice
  private scratch: Phaser.GameObjects.BitmapText
  private buttons: Record<QuestCardButton, Button>
  private q: QuestView | null = null
  private cardMode: QuestCardMode | null = null
  private day = 1
  private tick = 0
  private dialog: Dialog | null = null
  private slide: Phaser.Tweens.Tween | null = null
  private shakeTween: Phaser.Tweens.Tween | null = null
  private scrimArmed = false
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    data: GameData,
    opts: QuestCardOptions,
  ) {
    this.scene = scene
    this.L = L
    this.data = data
    this.opts = opts
    this.rect = questCardRect(L)
    const depth = opts.depth ?? QUEST_CARD_DEPTH
    const { w, h } = this.rect
    const R = QUEST_CARD_ROWS
    const PAD = QUEST_CARD_PAD

    this.scrim = scene.add
      .rectangle(0, 0, L.W, L.H, THEME.shadow, 0)
      .setOrigin(0, 0)
      .setDepth(depth - 1)
      .setVisible(false)
      .setInteractive()
    this.scrim.on('pointerdown', () => {
      this.scrimArmed = true
    })
    this.scrim.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.scrimArmed
      this.scrimArmed = false
      if (armed && p.getDistance() <= TAP_PX && this.isOpen) this.outside()
    })

    this.panel = addPanel(scene, 0, 0, w, h, 'ui_panel').setInteractive()
    this.goldPanel = addPanel(scene, 0, 0, w, h, 'ui_card_gold')
      .setInteractive()
      .setVisible(false)
    const ic = frameOrNull('ic_quest')
    this.icon = ic
      ? scene.add
          .image(PAD, Math.floor((MASTHEAD_H - ICON_PX) / 2), UI_ATLAS, ic)
          .setOrigin(0, 0)
      : null
    this.mastText = addText(
      scene,
      PAD + ICON_PX + 4,
      textTop(0, MASTHEAD_H),
      '',
    )
    this.dayText = addText(scene, 0, textTop(0, MASTHEAD_H), '', {
      tint: MUTED,
    })
    this.rules = [0, 2].map((dy) =>
      scene.add
        .rectangle(PAD, R.rule + dy, w - 2 * PAD, 1, THEME.outline)
        .setOrigin(0, 0),
    )
    this.titleText = addText(scene, PAD, textTop(R.title, LINE_H), '', {
      tint: GOLD_TEXT,
    })
    this.flavourText = addText(scene, PAD, textTop(R.flavour, LINE_H), '', {
      tint: MUTED,
    })
    this.objectiveLine = addText(scene, PAD, textTop(R.objective, LINE_H), '')
    this.rewardLine = addText(scene, PAD, textTop(R.reward, LINE_H), '')
    this.timeText = addText(scene, PAD, textTop(R.time, LINE_H), '', {
      tint: MUTED,
    })
    this.blockedText = addText(scene, PAD, textTop(R.blocked, LINE_H), '', {
      tint: PALETTE.red0,
    })
    this.barTrack = addBar(scene, PAD, R.bar, w - 2 * PAD, 'ui_bar_track')
    this.barFill = addBar(scene, PAD, R.bar, w - 2 * PAD, barFrame('gold'))
    this.scratch = addText(scene, 0, 0, '').setVisible(false)

    const make = (name: QuestCardButton): Button =>
      new Button(scene, {
        x: 0,
        y: R.buttons,
        w: BUTTON_W[name],
        h: QUEST_CARD_BTN_H,
        label: QUEST_BUTTON_LABEL[name],
        face: BUTTON_FACE[name],
        minHit: L.minHit,
        id: `quest:${name}`,
        onClick: () => this.tap(name),
      }).setVisible(false)
    this.buttons = {
      accept: make('accept'),
      later: make('later'),
      abandon: make('abandon'),
      close: make('close'),
      ok: make('ok'),
    }

    this.root = scene.add
      .container(this.rect.x, this.rect.y, [
        this.panel,
        this.goldPanel,
        ...(this.icon ? [this.icon] : []),
        this.mastText,
        this.dayText,
        ...this.rules,
        this.titleText,
        this.flavourText,
        this.objectiveLine,
        this.rewardLine,
        this.timeText,
        this.blockedText,
        this.barTrack,
        this.barFill,
        this.scratch,
        ...ALL_BUTTONS.map((b) => this.buttons[b]),
      ])
      .setDepth(depth)
      .setVisible(false)
    scene.events.once('shutdown', this.destroy, this)
  }

  get isOpen(): boolean {
    return this.q !== null
  }

  get questId(): string | null {
    return this.q?.id ?? null
  }

  get mode(): QuestCardMode | null {
    return this.cardMode
  }

  /** The model on screen (tests, e2e probes); null while closed. */
  get model(): QuestCardModel | null {
    return this.q && this.cardMode
      ? this.buildModel(this.q, this.cardMode)
      : null
  }

  /** Show `q` in `mode`; `day` is the HUD's `Day N` (completed days + 1). */
  open(q: QuestView, mode: QuestCardMode, tick: number, day: number): void {
    if (this.destroyed) return
    const was = this.isOpen
    if (this.q?.id !== q.id) {
      this.dialog?.destroy()
      this.dialog = null
    }
    this.q = q
    this.cardMode = mode
    this.tick = tick
    this.day = day
    this.render()
    if (!was) this.show()
  }

  /**
   * The polled view (2 Hz, quest events): re-read time, progress and the
   * blocked line. Null or another quest closes the card; an offer that went
   * active turns it to the active state; the complete state ignores it.
   */
  refresh(q: QuestView | null, tick: number): void {
    if (!this.isOpen || this.cardMode === 'complete') return
    if (!q || q.id !== this.q?.id) {
      this.close()
      return
    }
    if (this.cardMode === 'offer' && q.status === 'active')
      this.cardMode = 'active'
    this.q = q
    this.tick = tick
    this.render()
  }

  /** quest:completed for the quest on the card (or opened fresh): gold, `OK`. */
  showComplete(q: QuestView, reward: QuestReward): void {
    if (this.destroyed) return
    const was = this.isOpen
    this.dialog?.destroy()
    this.dialog = null
    this.q = { ...q, reward }
    this.cardMode = 'complete'
    this.render()
    if (!was) this.show()
  }

  /**
   * quest:completed: when the card shows `questId` (its last view — the
   * quest has left the slot), turn it to the complete state; true if it did.
   */
  completeOn(questId: string, reward: QuestReward): boolean {
    const q = this.q
    if (!q || q.id !== questId) return false
    this.showComplete(q, reward)
    return true
  }

  /** A refusal: shake 2 px, `ui:sfx deny`, and a tooltip over Accept. */
  deny(text: string): void {
    if (this.destroyed) return
    const scene = this.scene
    scene.game.events.emit(EV_UI_SFX, { name: 'deny' })
    if (!this.isOpen) return
    this.shake()
    const q = this.q
    const mode = this.cardMode
    const b =
      q && mode
        ? questCardButtonRects(this.rect.w, questCardButtons(mode)).find(
            (r) => r.name === 'accept',
          )
        : undefined
    const x =
      this.rect.x +
      (b ? b.x + Math.round(b.w / 2) : Math.round(this.rect.w / 2))
    const y = this.rect.y + (b ? QUEST_CARD_ROWS.buttons : 0)
    scene.game.events.emit(EV_TOOLTIP, { text, x, y })
  }

  /** Hide without a callback (a quest that left the slot, a sim swap). */
  close(): void {
    if (!this.isOpen) return
    this.q = null
    this.cardMode = null
    this.dialog?.destroy()
    this.dialog = null
    this.slide?.stop()
    this.slide = null
    this.stopShake()
    this.scrimArmed = false
    this.root.setVisible(false)
    this.scrim.setVisible(false)
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
  }

  relayout(L: Layout): void {
    if (this.destroyed) return
    this.L = L
    const r = questCardRect(L)
    this.scrim.setSize(L.W, L.H)
    if (this.scrim.input?.hitArea)
      (this.scrim.input.hitArea as Phaser.Geom.Rectangle).setSize(L.W, L.H)
    if (r.w !== this.rect.w) {
      this.rect = r
      this.resize()
    }
    this.rect = r
    if (this.isOpen) this.render()
    this.slide?.stop()
    this.slide = null
    this.stopShake()
    this.root.setPosition(r.x, r.y)
    // An open Abandon confirm re-fits to the new canvas (and stays on top).
    this.dialog?.relayout(L)
  }

  destroy(): void {
    if (this.destroyed) return
    this.close()
    this.destroyed = true
    this.scene.events.off('shutdown', this.destroy, this)
    this.root.destroy()
    this.scrim.destroy()
  }

  // ---- internals ---------------------------------------------------------------

  private buildModel(q: QuestView, mode: QuestCardMode): QuestCardModel {
    const named = this.opts.buildingName ?? buildingNamer(this.data)
    const blocked = this.opts.blockedBy?.(q) ?? null
    const waiting = this.opts.waitingOn?.(q) ?? null
    return questCardModel(
      this.data,
      q,
      mode,
      this.tick,
      named,
      blocked,
      waiting,
    )
  }

  private show(): void {
    pushModal(this)
    this.scene.input?.keyboard?.on('keydown', this.onKey, this)
    this.scrim.setVisible(true)
    const to = this.rect.y
    const proxy = { y: this.L.H }
    this.root.setPosition(this.rect.x, proxy.y).setVisible(true)
    this.slide?.stop()
    const tweens = this.scene.tweens
    if (!tweens) {
      this.root.setY(to)
      return
    }
    this.slide = tweens.add({
      targets: proxy,
      y: to,
      duration: QUEST_CARD_IN_MS,
      ease: 'Back.easeOut',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => {
        this.slide = null
        this.root.setY(this.rect.y)
      },
    })
  }

  /** Resize the width-bound parts after a canvas narrower than 312 px. */
  private resize(): void {
    const { w, h } = this.rect
    const PAD = QUEST_CARD_PAD
    this.panel.setSize(w, h)
    this.goldPanel.setSize(w, h)
    for (const p of [this.panel, this.goldPanel]) {
      if (p.input?.hitArea)
        (p.input.hitArea as Phaser.Geom.Rectangle).setSize(w, h)
    }
    for (const r of this.rules) r.setSize(w - 2 * PAD, 1)
    this.barTrack.setSize(w - 2 * PAD, this.barTrack.height)
  }

  private render(): void {
    const q = this.q
    const mode = this.cardMode
    if (!q || !mode) return
    const m = this.buildModel(q, mode)
    const { w } = this.rect
    const PAD = QUEST_CARD_PAD
    const inner = w - 2 * PAD
    const measure = (s: string): number =>
      Math.round(this.scratch.setText(s).width)
    const wrap = (s: string): string =>
      wrapHeadline(s, inner, QUEST_CARD_LINES, measure).join('\n')

    this.panel.setVisible(!m.gold)
    this.goldPanel.setVisible(m.gold)
    this.mastText.setText(m.masthead)
    this.dayText.setText(`Day ${this.day}`)
    this.dayText.setX(Math.round(w - PAD - this.dayText.width))
    this.titleText.setText(m.title)
    this.flavourText
      .setText(wrap(m.flavour))
      .setTint(m.waiting ? GOLD_TEXT : MUTED)
    this.objectiveLine.setText(wrap(m.objective))
    // The reward row is one line: without the district when it overflows.
    const reward =
      measure(m.reward) <= inner ? m.reward : rewardText(this.data, q, false)
    this.rewardLine.setText(wrapHeadline(reward, inner, 1, measure)[0] ?? '')
    this.timeText.setText(m.time)
    this.blockedText.setText(m.blocked ?? '').setVisible(m.blocked !== null)
    this.barTrack.setVisible(m.bar !== null)
    if (m.bar === null) this.barFill.setVisible(false)
    else setBarFill(this.barFill, inner, m.bar)

    const rects = questCardButtonRects(w, m.buttons)
    for (const b of ALL_BUTTONS) {
      const r = rects.find((x) => x.name === b)
      const btn = this.buttons[b]
      btn.setVisible(r !== undefined)
      if (r)
        btn.setRect(
          { x: r.x, y: QUEST_CARD_ROWS.buttons, w: r.w, h: QUEST_CARD_BTN_H },
          undefined,
          this.L.minHit,
        )
    }
  }

  /**
   * A button's action (the buttons, Esc / Enter, a tap outside; tests and
   * e2e probes call it too). A button the current state does not show does
   * nothing.
   */
  tap(name: QuestCardButton): void {
    const q = this.q
    const mode = this.cardMode
    if (!q || !mode || !questCardButtons(mode).includes(name)) return
    const id = q.id
    switch (name) {
      case 'accept':
        this.opts.onAccept(id)
        return
      case 'later':
        this.close()
        this.opts.onLater()
        return
      case 'abandon':
        this.confirmAbandon(q)
        return
      case 'close':
      case 'ok':
        this.close()
        this.opts.onClose()
        return
    }
  }

  private confirmAbandon(q: QuestView): void {
    if (this.dialog?.isOpen()) return
    const t = abandonDialogText(this.data, q)
    const id = q.id
    this.dialog = new Dialog(this.scene, {
      title: t.title,
      text: t.text,
      action: 'Abandon',
      cancel: 'Keep going',
      destructive: true,
      W: this.L.W,
      H: this.L.H,
      minHit: this.L.minHit,
      id: 'quest:abandonConfirm',
      onConfirm: () => {
        this.dialog = null
        if (this.q?.id !== id) return
        this.close()
        this.opts.onAbandon(id)
      },
      onCancel: () => {
        this.dialog = null
      },
    })
  }

  /** Esc / a tap outside: Later on an offer, OK when complete, Close otherwise. */
  private outside(): void {
    if (this.cardMode === 'offer') this.tap('later')
    else this.tap(this.cardMode === 'complete' ? 'ok' : 'close')
  }

  /** Enter: Accept on an offer, Close / OK otherwise. */
  private primary(): void {
    if (this.cardMode === 'offer') this.tap('accept')
    else this.tap(this.cardMode === 'complete' ? 'ok' : 'close')
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' && ev.key !== 'Enter') return
    if (!claimKey(ev, this) || ev.repeat) return
    if (ev.key === 'Escape') this.outside()
    else this.primary()
  }

  private shake(): void {
    const tweens = this.scene.tweens
    if (!tweens) return
    this.stopShake()
    const x0 = this.rect.x
    this.shakeTween = tweens.addCounter({
      from: 0,
      to: 1,
      duration: SHAKE_MS,
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0
        this.root.setX(x0 + Math.round(SHAKE_PX * Math.sin(v * Math.PI * 4)))
      },
      onComplete: () => {
        this.shakeTween = null
        this.root.setX(x0)
      },
    })
  }

  private stopShake(): void {
    if (!this.shakeTween) return
    this.shakeTween.stop()
    this.shakeTween = null
    this.root.setX(this.rect.x)
  }
}
