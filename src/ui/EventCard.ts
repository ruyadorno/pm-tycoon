// Build 3 M12 (B3 §3.3–§3.4, D-M12-1): the decision / news / job card — a
// bottom card on the HUD camera like the QuestCard (depth 6000, on the modal
// stack, Esc/Enter through claimKey). The layout comes from effectText.ts
// (layoutEventCard): the masthead (`ic_event` + the category word, `Day N`
// and a `PAUSED` pill), the double rule, the 48×48 category picture on a
// darker inset (grey3, so a cream picture reads on ui_panel — art-todo), the
// parent / title / body / objective flow beside it then full width, a thin
// rule, then one full-width 44-px option button per visible option (primary
// first, red for danger, greyed with `Can't afford · $N` when unaffordable)
// with its effects rows under it, tinted per span (costs red, gains green,
// the rest muted).
//
// Modes: decision and three (2 or 3 options; Esc and a tap outside do
// nothing, B3 §3.4), job (Accept / Decline + the objective) and news (one
// OK: any tap — the scrim, the panel, Esc, Enter — answers it). A tap on
// the scrim, the panel or an option button is ignored for the first
// EVENT_CARD_IN_MS while the card slides in, or after another card took the
// slot (critique 19, review card-2): a double tap never decides the next
// card unread; tap() (tests, e2e) and the keys are not guarded. Enter takes the first option,
// never a danger or greyed one (D-M12-2): it then denies with `Tap an
// option`.
//
// Callbacks: an option (its button, Enter, a news card's tap anywhere) calls
// onOption(eventId, index) with the option's data index and the card STAYS
// open — the HUD closes it on success (close()) or calls deny(text, index)
// on a refused command. A greyed option denies by itself (`Can't afford`)
// and calls nothing. The card never touches the stepper: the HUD holds
// ('event') while it shows. open() and relayout() rebuild the children (the
// options and rows vary per card, D-M12-19); the scrim is a Zone (no draw
// call, D-M12-20). Phaser is a type-only import; world-atlas frames only
// (the HUD binds UI_ATLAS).
import type Phaser from 'phaser'
import type { GameData } from '../data/types.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull } from '../render/frames.ts'
import type { OpenCardView } from '../sim/view-api.ts'
import { Button, TAP_PX } from './Button.ts'
import {
  EFFECT_TONE_TINT,
  EVENT_BTN_H,
  EVENT_CARD_DEPTH,
  EVENT_CARD_IN_MS,
  EVENT_CARD_PAD,
  EVENT_CARD_W,
  EVENT_ENTER_DENY,
  EVENT_INSET,
  EVENT_LABEL_PAD,
  EVENT_MAST_H,
  EVENT_MUTED,
  EVENT_PAUSED_TEXT,
  EVENT_PIC,
  EVENT_PIC_X,
  EVENT_PIC_Y,
  EVENT_PILL_H,
  EVENT_PILL_PAD,
  EVENT_PILL_Y,
  EVENT_RULE_Y,
  type EffectRow,
  type EventCardLayout,
  eventCardRect,
  layoutEventCard,
} from './effectText.ts'
import type { Layout, Rect } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, popModal, pushModal } from './Sheet.ts'
import { addText, ellipsize, LINE_H, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'
import { EV_UI_SFX } from './ZonePicker.ts'

const ICON_PX = 16
/** The masthead word's x: the icon + 4 px. */
const MAST_X = EVENT_CARD_PAD + ICON_PX + 4
/** Air between `Day N` and the PAUSED pill, and between the word and `Day N`. */
const DAY_GAP = 6
const MAST_GAP = 4
const SHAKE_PX = 2
const SHAKE_MS = 160
/** Phaser.TintModes.MULTIPLY (Toast's per-character tint; a type-only Phaser import). */
const TINT_MULTIPLY = 0
const EV_TOOLTIP = 'pm:tooltip'
/** The `ui:tap` id of a news card's tap-anywhere (the tap SFX). */
export const EVENT_DISMISS_ID = 'event:dismiss'
export const EVENT_SCRIM_ID = 'event:scrim'

/** A row's per-character tints: neutral base, then every non-neutral span (Toast's pattern). */
function tintRow(t: Phaser.GameObjects.BitmapText, row: EffectRow): void {
  if (row.text.length === 0) return
  t.setCharacterTint(0, -1)
  for (const s of row.spans) {
    if (s.tone === 'neutral') continue
    t.setCharacterTint(s.from, s.len, TINT_MULTIPLY, EFFECT_TONE_TINT[s.tone])
  }
}

export interface EventCardOptions {
  /**
   * Option `index` chosen (its button, Enter, a news card's tap anywhere).
   * The card STAYS open: the HUD closes it on success (close()) or calls
   * deny(text, index).
   */
  onOption(eventId: string, index: number): void
  depth?: number
}

export class EventCard {
  readonly scene: Phaser.Scene
  /** The card's children (rebuilt per open / relayout) at the card rect's top-left. */
  readonly root: Phaser.GameObjects.Container
  /** Full-screen tap catcher under the card (a Zone: no draw call). */
  readonly scrim: Phaser.GameObjects.Zone
  private L: Layout
  private readonly data: GameData
  private readonly opts: EventCardOptions
  private readonly scratch: Phaser.GameObjects.BitmapText
  private view: OpenCardView | null = null
  private objective: string | null = null
  private layout: EventCardLayout | null = null
  private cardRect: Rect = { x: 0, y: 0, w: EVENT_CARD_W, h: 0 }
  private slide: Phaser.Tweens.Tween | null = null
  private shakeTween: Phaser.Tweens.Tween | null = null
  private openedAt = 0
  private scrimArmed = false
  private panelArmed = false
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    data: GameData,
    opts: EventCardOptions,
  ) {
    this.scene = scene
    this.L = L
    this.data = data
    this.opts = opts
    const depth = opts.depth ?? EVENT_CARD_DEPTH

    this.scrim = scene.add
      .zone(0, 0, L.W, L.H)
      .setOrigin(0, 0)
      .setDepth(depth - 1)
    this.scrim.setInteractive()
    this.scrim.setData('id', EVENT_SCRIM_ID)
    this.scrim.setVisible(false)
    this.scrim.on('pointerdown', () => {
      this.scrimArmed = true
    })
    this.scrim.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.scrimArmed
      this.scrimArmed = false
      if (armed && p.getDistance() <= TAP_PX && this.isOpen) this.outside()
    })
    this.root = scene.add.container(0, 0).setDepth(depth).setVisible(false)
    // The measuring BitmapText: outside the root, so a rebuild keeps it.
    this.scratch = addText(scene, 0, 0, '').setVisible(false)
    scene.events.once('shutdown', this.destroy, this)
  }

  get isOpen(): boolean {
    return this.view !== null
  }

  /** The shown card's id (null while closed). */
  get eventId(): string | null {
    return this.view?.eventId ?? null
  }

  /**
   * The shown card's openedTick (null while closed): with eventId it tells
   * back-to-back job cards apart (`job:<templateId>` repeats; M12 critique 18).
   */
  get openedTick(): number | null {
    return this.view?.openedTick ?? null
  }

  /** The laid-out card (e2e / tests). */
  get model(): EventCardLayout | null {
    return this.layout
  }

  /** The card's screen rect while open. */
  get rect(): Rect | null {
    return this.isOpen ? { ...this.cardRect } : null
  }

  /**
   * Show `v` (a job card passes its objective, D-M12-6). Opening while
   * closed slides the card up and puts it on the modal stack; opening while
   * open rebuilds it in place (no new slide).
   */
  open(v: OpenCardView, extra: { objective?: string | null } = {}): void {
    if (this.destroyed) return
    const was = this.isOpen
    const same =
      was &&
      this.view?.eventId === v.eventId &&
      this.view?.openedTick === v.openedTick
    this.view = v
    this.objective = extra.objective ?? null
    this.teardown()
    this.build()
    if (!was) {
      this.show()
      return
    }
    if (!same) {
      // Another card in the same slot: a fresh read-in guard, no slide.
      this.openedAt = this.now()
      this.slide?.stop()
      this.slide = null
    }
    this.stopShake()
    if (!this.slide) this.root.setPosition(this.cardRect.x, this.cardRect.y)
  }

  /** = pressing that option (tests, e2e): a greyed option denies, else onOption. */
  tap(index: number): void {
    const v = this.view
    const o = this.layout?.options.find((x) => x.index === index)
    if (!v || !o) return
    if (!o.enabled) {
      this.deny(o.reason ?? this.data.puns.eventWords.cantAfford, index)
      return
    }
    this.opts.onOption(v.eventId, index)
  }

  /**
   * A refusal: `ui:sfx deny`, a 2-px shake and a tooltip over the option
   * (`index`, its button top; the card top without one), centred on the
   * buttons' column.
   */
  deny(text: string, index: number | null = null): void {
    if (this.destroyed) return
    this.scene.game.events.emit(EV_UI_SFX, { name: 'deny' })
    if (!this.isOpen) return
    this.shake()
    const o =
      index === null
        ? undefined
        : this.layout?.options.find((x) => x.index === index)
    const r = this.cardRect
    const inner = r.w - 2 * EVENT_CARD_PAD
    this.scene.game.events.emit(EV_TOOLTIP, {
      text,
      x: r.x + EVENT_CARD_PAD + Math.round(inner / 2),
      y: r.y + (o?.y ?? 0),
    })
  }

  /** Close without a callback. */
  close(): void {
    if (!this.isOpen) return
    this.view = null
    this.objective = null
    this.layout = null
    this.slide?.stop()
    this.slide = null
    this.stopShake()
    this.teardown()
    this.scrimArmed = false
    this.panelArmed = false
    this.root.setVisible(false)
    this.scrim.setVisible(false)
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
  }

  /** A new canvas: the scrim covers it; an open card rebuilds at its new rect (no slide). */
  relayout(L: Layout): void {
    if (this.destroyed) return
    this.L = L
    this.scrim.setSize(L.W, L.H)
    const area = this.scrim.input?.hitArea as Phaser.Geom.Rectangle | undefined
    area?.setTo(0, 0, L.W, L.H)
    if (!this.isOpen) return
    this.slide?.stop()
    this.slide = null
    this.stopShake()
    this.teardown()
    this.build()
    this.root.setPosition(this.cardRect.x, this.cardRect.y)
  }

  destroy(): void {
    if (this.destroyed) return
    this.close()
    this.destroyed = true
    this.scene.events.off('shutdown', this.destroy, this)
    this.root.destroy()
    this.scrim.destroy()
    this.scratch.destroy()
  }

  // ---- internals ---------------------------------------------------------------

  private now(): number {
    return this.scene.time?.now ?? 0
  }

  /** A dismiss / option tap counts once the card has finished sliding in (critique 19, review card-2). */
  private dismissReady(): boolean {
    if (!this.scene.time) return true
    return this.now() - this.openedAt >= EVENT_CARD_IN_MS
  }

  private measure(s: string): number {
    return Math.round(this.scratch.setText(s).width)
  }

  /** The card's children for the current view at the current layout (D-M12-19). */
  private build(): void {
    const v = this.view
    if (!v) return
    const scene = this.scene
    const L = this.L
    const PAD = EVENT_CARD_PAD
    const w = Math.min(EVENT_CARD_W, Math.round(L.W) - 12)
    const inner = w - 2 * PAD
    const measure = (s: string): number => this.measure(s)
    const m = layoutEventCard({ ...v, objective: this.objective }, measure, w)
    this.layout = m
    this.cardRect = eventCardRect(L, m.h)

    // 1. The panel swallows taps; on a news card a tap on it answers.
    const panel = addPanel(scene, 0, 0, w, m.h, 'ui_panel').setInteractive()
    panel.on('pointerdown', () => {
      this.panelArmed = true
    })
    panel.on('pointerout', () => {
      this.panelArmed = false
    })
    panel.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.panelArmed
      this.panelArmed = false
      if (armed && p.getDistance() <= TAP_PX && this.isOpen) this.dismiss()
    })

    // 2. The shapes together (one batch break): the double rule, the
    //    picture inset (outline + the darker grey3 slot), the thin rule.
    const I = EVENT_INSET
    const shapes = [
      scene.add.rectangle(PAD, EVENT_RULE_Y, inner, 1, THEME.outline),
      scene.add.rectangle(PAD, EVENT_RULE_Y + 2, inner, 1, THEME.outline),
      scene.add.rectangle(I.x, I.y, I.w, I.h, THEME.outline),
      scene.add.rectangle(I.x + 1, I.y + 1, I.w - 2, I.h - 2, PALETTE.grey3),
      scene.add.rectangle(PAD, m.ruleY, inner, 1, PALETTE.grey3),
    ].map((r) => r.setOrigin(0, 0))

    // 3. The textures (world atlas + the m5x7 glyphs packed into it).
    const kids: Phaser.GameObjects.GameObject[] = []
    const picFrame = frameOrNull(m.picture) ?? frameOrNull('ic_event')
    if (picFrame) {
      const img = scene.add.image(0, 0, UI_ATLAS, picFrame).setOrigin(0, 0)
      img.setPosition(
        EVENT_PIC_X + Math.floor((EVENT_PIC - img.width) / 2),
        EVENT_PIC_Y + Math.floor((EVENT_PIC - img.height) / 2),
      )
      kids.push(img)
    }
    const ic = frameOrNull('ic_event')
    if (ic)
      kids.push(
        scene.add
          .image(PAD, Math.floor((EVENT_MAST_H - ICON_PX) / 2), UI_ATLAS, ic)
          .setOrigin(0, 0),
      )
    const pillW = measure(EVENT_PAUSED_TEXT) + 2 * EVENT_PILL_PAD
    const pillX = w - PAD - pillW
    kids.push(
      addPanel(scene, pillX, EVENT_PILL_Y, pillW, EVENT_PILL_H, 'ui_tag'),
      addText(
        scene,
        pillX + EVENT_PILL_PAD,
        textTop(EVENT_PILL_Y, EVENT_PILL_H),
        EVENT_PAUSED_TEXT,
      ),
    )
    const dayX = pillX - DAY_GAP - measure(m.day)
    kids.push(
      addText(scene, dayX, textTop(0, EVENT_MAST_H), m.day, {
        tint: EVENT_MUTED,
      }),
      addText(
        scene,
        MAST_X,
        textTop(0, EVENT_MAST_H),
        ellipsize(m.masthead, dayX - MAST_GAP - MAST_X, measure),
      ),
    )
    for (const f of m.flow)
      kids.push(
        addText(scene, f.x, textTop(f.y, LINE_H), f.text, { tint: f.tint }),
      )
    for (const o of m.options) {
      const index = o.index
      const reason = o.reason ?? this.data.puns.eventWords.cantAfford
      const b = new Button(scene, {
        x: PAD,
        y: o.y,
        w: inner,
        h: EVENT_BTN_H,
        label: ellipsize(o.label, inner - 2 * EVENT_LABEL_PAD, measure),
        face: o.face,
        hit: o.hit,
        minHit: L.minHit,
        id: `event:opt${index}`,
        // Not while the card slides in (review card-2): a quick double tap
        // never decides a card that opened under the finger unread.
        onClick: () => {
          if (this.dismissReady()) this.tap(index)
        },
        onDisabledTap: () => {
          if (this.dismissReady()) this.deny(reason, index)
        },
      })
      b.setEnabled(o.enabled)
      kids.push(b)
      o.rows.forEach((row, k) => {
        const t = addText(
          scene,
          PAD,
          textTop(o.rowsY + LINE_H * k, LINE_H),
          row.text,
          { tint: EFFECT_TONE_TINT.neutral },
        )
        tintRow(t, row)
        kids.push(t)
      })
    }
    this.root.add([panel, ...shapes, ...kids])
  }

  /** Destroy the card's children (the root, scrim and scratch stay). */
  private teardown(): void {
    this.root.removeAll(true)
  }

  private show(): void {
    pushModal(this)
    this.scene.input?.keyboard?.on('keydown', this.onKey, this)
    this.scrim.setVisible(true)
    this.openedAt = this.now()
    const to = this.cardRect.y
    const proxy = { y: this.L.H }
    this.root.setPosition(this.cardRect.x, proxy.y).setVisible(true)
    this.slide?.stop()
    this.slide = null
    const tweens = this.scene.tweens
    if (!tweens) {
      this.root.setY(to)
      return
    }
    this.slide = tweens.add({
      targets: proxy,
      y: to,
      duration: EVENT_CARD_IN_MS,
      ease: 'Back.easeOut',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => {
        this.slide = null
        this.root.setY(this.cardRect.y)
      },
    })
  }

  /** A news card's tap anywhere (the scrim, the panel): answers the OK once the card is in. */
  private dismiss(): void {
    const m = this.layout
    const first = m?.options[0]
    if (!m || m.mode !== 'news' || !first || !this.dismissReady()) return
    this.scene.game.events.emit('ui:tap', { id: EVENT_DISMISS_ID })
    this.tap(first.index)
  }

  /** A tap outside the card: a news card's dismiss; nothing on a decision or job (B3 §3.4). */
  private outside(): void {
    this.dismiss()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' && ev.key !== 'Enter') return
    if (!claimKey(ev, this) || ev.repeat) return
    const m = this.layout
    if (!m) return
    if (ev.key === 'Escape') {
      // News: Esc answers the OK; a decision / job swallows it (B3 §3.4).
      const first = m.options[0]
      if (m.mode === 'news' && first) this.tap(first.index)
      return
    }
    if (m.enter !== null) this.tap(m.enter)
    else this.deny(EVENT_ENTER_DENY, null)
  }

  private shake(): void {
    const tweens = this.scene.tweens
    if (!tweens) return
    this.stopShake()
    const x0 = this.cardRect.x
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
    this.root.setX(this.cardRect.x)
  }
}
