// VictoryCard (spec-build2 §3.4; design-m7 §6.6; plan-build2 §8.4 task 4):
// the Golden Release shipped. On `game:victory` HudScene holds the sim
// ('victory') and opens this card: a `ui_card_gold` panel (at most 320 wide)
// centred over a 60 % black backdrop that swallows every tap, `TYCOON` at
// 32 px in gold, the puns tickerQuest.victory line (`The Golden Release
// ships — Node Heights Courier is a Tycoon!`), the run stats — days, lifetime
// earned, parcels delivered, malware caught / missed, lives, level reached —
// and the buttons `Continue` (endless: quests keep coming, the malware share
// climbs from the next day boundary), `New game` and, when offered, `Run
// summary` side by side under it. About 330 px tall: it fits 360×604.
// Enter and Esc are Continue (the one choice that loses nothing); `New game`
// is a tap only (HudScene confirms it during a live run).
//
// Built like GameOverCard: its own full-screen camera over an off-screen
// origin, so nothing in the HUD covers it, and on the modal stack while
// open. The stats are pure (tests/ui/victory-card.test.ts); Phaser is a
// type-only import.
import type Phaser from 'phaser'
import { removeCamera } from './cameraBits.ts'
import type { GameData } from '../data/types.ts'
import { TICKS_PER_DAY } from '../sim/types.ts'
import { Button } from './Button.ts'
import { levelLabel } from './hudKit.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import { addText, formatInt, formatMoney, lineCount, LINE_H } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const VICTORY_TITLE = 'TYCOON'
export const VICTORY_CARD_MAX_W = 320
export const VICTORY_BACKDROP_ALPHA = 0.6
const PAD = 16
const ROW_H = 20
const BTN_H = 44
const BTN_GAP = 8
const TITLE_H = 28
/** Gold that reads on the light card. */
const GOLD_TEXT = PALETTE.gold0

// ---- model (pure) ---------------------------------------------------------------

export interface VictoryInput {
  /** Completed in-game days (state.day). */
  day: number
  lifetimeEarned: number
  /** Every parcel:delivered, malware included (stats.deliveries). */
  deliveries: number
  /** Malware that reached a customer (stats.malwareMissed). */
  malwareMissed: number
  /** Malware tossed into the Quarantine Bin (lane.quarantine.malware). */
  defused: number
  lives: number
  level: number
  /** stats.victoryTick (the tick the Golden Release completed). */
  victoryTick: number
}

export interface VictoryModel {
  title: typeof VICTORY_TITLE
  /** puns tickerQuest.victory with `{company}` filled. */
  headline: string
  stats: [label: string, value: string][]
}

/** `Day N` of the victory (completed days + 1 at victoryTick). */
export function victoryDay(victoryTick: number): number {
  return Math.floor(Math.max(0, victoryTick) / TICKS_PER_DAY) + 1
}

export function victoryModel(
  input: VictoryInput,
  data: GameData,
): VictoryModel {
  const clean = Math.max(0, input.deliveries - input.malwareMissed)
  return {
    title: VICTORY_TITLE,
    headline: data.puns.tickerQuest.victory.replaceAll(
      '{company}',
      data.puns.companyName,
    ),
    stats: [
      ['Days', formatInt(input.day)],
      ['Lifetime earned', formatMoney(input.lifetimeEarned)],
      ['Parcels delivered', formatInt(clean)],
      [
        'Malware caught / missed',
        `${formatInt(input.defused)} / ${formatInt(input.malwareMissed)}`,
      ],
      ['Lives', `${formatInt(input.lives)} of ${data.economy.lives.cap}`],
      ['Level reached', levelLabel(data, input.level)],
    ],
  }
}

/** Card height for `headLines` headline lines and `rows` stats rows. */
export function victoryCardHeight(headLines: number, rows: number): number {
  return (
    PAD +
    TITLE_H +
    10 +
    Math.max(1, headLines) * LINE_H +
    14 +
    rows * ROW_H +
    14 +
    2 * BTN_H +
    BTN_GAP +
    PAD
  )
}

// ---- view -----------------------------------------------------------------------

export interface VictoryCardOptions {
  /** `Continue`: endless play (HudScene releases the 'victory' hold). */
  onContinue(): void
  /** `New game` (HudScene: the game-over new-game path, confirmed mid-run). */
  onNewGame(): void
  /** `Run summary` (the playtest summary card); shown only when set. */
  onSummary?: () => void
}

export class VictoryCard {
  readonly scene: Phaser.Scene
  private L: Layout
  private data: GameData
  private opts: VictoryCardOptions
  private m: VictoryModel | null = null
  private root: Phaser.GameObjects.Container | null = null
  private cam: Phaser.Cameras.Scene2D.Camera | null = null
  private buttons: Button[] = []

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    data: GameData,
    opts: VictoryCardOptions,
  ) {
    this.scene = scene
    this.L = L
    this.data = data
    this.opts = opts
  }

  get isOpen(): boolean {
    return this.m !== null
  }

  get current(): VictoryModel | null {
    return this.m
  }

  open(m: VictoryModel): void {
    this.teardown()
    if (!this.m) {
      pushModal(this)
      this.scene.input.keyboard?.on('keydown', this.onKey, this)
    }
    this.m = m
    this.build()
  }

  close(): void {
    if (!this.m) return
    this.m = null
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.teardown()
  }

  relayout(L: Layout): void {
    this.L = L
    if (!this.m) return
    this.teardown()
    this.build()
  }

  destroy(): void {
    this.close()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' && ev.key !== 'Escape') return
    if (!claimKey(ev, this) || ev.repeat) return
    this.opts.onContinue()
  }

  private teardown(): void {
    for (const b of this.buttons) b.destroy()
    this.buttons = []
    this.root?.destroy()
    this.root = null
    removeCamera(this.scene, this.cam)
    this.cam = null
  }

  private build(): void {
    const m = this.m
    if (!m) return
    const scene = this.scene
    const L = this.L
    const { W, H } = L
    const o = offscreenOrigin()
    const backdrop = scene.add
      .rectangle(0, 0, W, H, THEME.shadow, VICTORY_BACKDROP_ALPHA)
      .setOrigin(0, 0)
      .setInteractive()
    const cw = Math.min(VICTORY_CARD_MAX_W, W - 2 * 8)
    const inner = cw - 2 * PAD

    const title = addText(scene, 0, 0, m.title, { size: 32, tint: GOLD_TEXT })
    const head = addText(scene, 0, 0, m.headline, {
      tint: THEME.textDark,
      maxWidth: inner,
      align: 'center',
    })
    const headLines = lineCount(head)
    const ch = victoryCardHeight(headLines, m.stats.length)
    const avail = H - L.safeTop - L.safeBottom
    const cx = Math.round((W - cw) / 2)
    const cy = L.safeTop + Math.max(0, Math.round((avail - ch) / 2))
    const panel = addPanel(scene, cx, cy, cw, ch, 'ui_card_gold')
    panel.setInteractive()
    const parts: Phaser.GameObjects.GameObject[] = [backdrop, panel]

    let y = cy + PAD
    title.setPosition(Math.round((W - title.width) / 2), y - 4)
    y += TITLE_H + 10
    head.setPosition(Math.round((W - head.width) / 2), y - 3)
    y += headLines * LINE_H + 14
    parts.push(title, head)
    const x0 = cx + PAD
    for (const [label, value] of m.stats) {
      const l = addText(scene, x0, y, label, { tint: PALETTE.grey1 })
      const v = addText(scene, 0, y, value, { tint: THEME.textDark })
      v.setX(Math.round(x0 + inner - v.width))
      parts.push(l, v)
      y += ROW_H
    }
    y += 14

    const cont = new Button(scene, {
      x: x0,
      y,
      w: inner,
      h: BTN_H,
      label: 'Continue',
      face: 'primary',
      minHit: L.minHit,
      id: 'victory:continue',
      onClick: () => this.opts.onContinue(),
    })
    y += BTN_H + BTN_GAP
    const summary = this.opts.onSummary ?? null
    const half = Math.floor((inner - BTN_GAP) / 2)
    const fresh = new Button(scene, {
      x: x0,
      y,
      w: summary ? half : inner,
      h: BTN_H,
      label: 'New game',
      minHit: L.minHit,
      id: 'victory:newGame',
      onClick: () => this.opts.onNewGame(),
    })
    this.buttons = [cont, fresh]
    if (summary) {
      this.buttons.push(
        new Button(scene, {
          x: x0 + inner - half,
          y,
          w: half,
          h: BTN_H,
          label: 'Run summary',
          minHit: L.minHit,
          id: 'victory:summary',
          onClick: () => summary(),
        }),
      )
    }

    const root = scene.add.container(o.x, o.y, [...parts, ...this.buttons])
    root.setDepth(100001)
    for (const c of scene.cameras.cameras) c.ignore(root)
    const cam = scene.cameras.add(0, 0, W, H)
    cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list) if (obj !== root) cam.ignore(obj)
    this.root = root
    this.cam = cam
  }
}
