// Game-over screen (city-view.md §9.4; spec §10; plan.md §9 "Cards"): on
// `game:over` HudScene sets `stepper.paused = true` and opens this card after
// the lost-life effects. Full-screen `ui_panel_dark`: `GAME OVER` (32 px),
// the headline (`Three malware parcels reached customers`), a stats block
// (days survived, lifetime earned, parcels delivered, malware caught /
// missed, level reached, best day's $), `New game` and — only when
// `economy.continueWithOneLife` (false for the author's playtest, Q40) —
// `Continue with one life` (`viewSim.grantLife()`, resume).
//
// Like the lost-life card it draws through its own full-screen camera over
// an off-screen origin so nothing in the HUD covers it, and it swallows every
// tap. The stats are pure (tests/ui/game-over-card.test.ts); Phaser is a
// type-only import.
import type Phaser from 'phaser'
import type { GameData } from '../data/types.ts'
import { Button } from './Button.ts'
import { levelLabel } from './hudKit.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import { addText, formatInt, formatMoney, lineCount, LINE_H } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const GAME_OVER_TITLE = 'GAME OVER'
const PAD = 16
const BTN_H = 44
const ROW_H = 20
const BTN_W = 200

// ---- model (pure) ---------------------------------------------------------------

const WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
]

/** `Three malware parcels reached customers` (`One … reached a customer`). */
export function gameOverHeadline(missed: number): string {
  const n = Math.max(0, Math.floor(missed))
  const word = WORDS[n] ?? formatInt(n)
  return n === 1
    ? `${word} malware parcel reached a customer`
    : `${word} malware parcels reached customers`
}

/**
 * The best in-game day's earnings: the largest step of the cumulative
 * `earned` column of the per-day rows (stats.minutes), the running day
 * included (lifetime − the last row).
 */
export function bestDay(
  rows: readonly { earned: number }[],
  lifetimeEarned: number,
): number {
  let best = 0
  let prev = 0
  for (const r of rows) {
    best = Math.max(best, r.earned - prev)
    prev = r.earned
  }
  return Math.max(best, lifetimeEarned - prev)
}

export interface GameOverInput {
  /** Completed in-game days (state.day). */
  day: number
  lifetimeEarned: number
  /** Every parcel:delivered, malware included (stats.deliveries). */
  deliveries: number
  /** Malware that reached a customer (stats.malwareMissed). */
  malwareMissed: number
  /** Malware tossed into the Quarantine Bin (lane.quarantine.malware). */
  defused: number
  level: number
  /** stats.minutes (one row per in-game day). */
  rows: readonly { earned: number }[]
}

export interface GameOverModel {
  headline: string
  stats: [label: string, value: string][]
}

export function gameOverModel(
  input: GameOverInput,
  data: GameData,
): GameOverModel {
  const clean = Math.max(0, input.deliveries - input.malwareMissed)
  return {
    headline: gameOverHeadline(input.malwareMissed),
    stats: [
      ['Days survived', formatInt(input.day)],
      ['Lifetime earned', formatMoney(input.lifetimeEarned)],
      ['Parcels delivered', formatInt(clean)],
      [
        'Malware caught / missed',
        `${formatInt(input.defused)} / ${formatInt(input.malwareMissed)}`,
      ],
      ['Level reached', levelLabel(data, input.level)],
      ['Best day', formatMoney(bestDay(input.rows, input.lifetimeEarned))],
    ],
  }
}

// ---- view -----------------------------------------------------------------------

export interface GameOverCardOptions {
  /** `New game`: clear the save, back to the Title (HudScene). */
  onNewGame(): void
  /** `Continue with one life`; shown only when set. */
  onContinue?: (() => void) | null
}

export class GameOverCard {
  readonly scene: Phaser.Scene
  private L: Layout
  private opts: GameOverCardOptions
  private model: GameOverModel | null = null
  private root: Phaser.GameObjects.Container | null = null
  private cam: Phaser.Cameras.Scene2D.Camera | null = null
  private buttons: Button[] = []

  constructor(scene: Phaser.Scene, L: Layout, opts: GameOverCardOptions) {
    this.scene = scene
    this.L = L
    this.opts = opts
  }

  isOpen(): boolean {
    return this.model !== null
  }

  get current(): GameOverModel | null {
    return this.model
  }

  open(model: GameOverModel): void {
    this.teardown()
    if (!this.model) {
      pushModal(this)
      this.scene.input.keyboard?.on('keydown', this.onKey, this)
    }
    this.model = model
    this.build()
  }

  close(): void {
    if (!this.model) return
    this.model = null
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.teardown()
  }

  relayout(L: Layout): void {
    this.L = L
    if (!this.model) return
    this.teardown()
    this.build()
  }

  destroy(): void {
    this.close()
  }

  private onKey(ev: KeyboardEvent): void {
    // Enter = New game; Esc is swallowed (the screen has no "back").
    if (ev.key === 'Enter') {
      if (claimKey(ev, this)) this.opts.onNewGame()
    } else if (ev.key === 'Escape') claimKey(ev, this)
  }

  private teardown(): void {
    for (const b of this.buttons) b.destroy()
    this.buttons = []
    this.root?.destroy()
    this.root = null
    if (this.cam) this.scene.cameras.remove(this.cam, true)
    this.cam = null
  }

  private build(): void {
    const m = this.model
    if (!m) return
    const scene = this.scene
    const L = this.L
    const { W, H } = L
    const o = offscreenOrigin()
    const bg = addPanel(scene, 0, 0, W, H, 'ui_panel_dark').setInteractive()
    const parts: Phaser.GameObjects.GameObject[] = [bg]
    const colW = Math.min(W - 2 * PAD, 320)
    const x0 = Math.round((W - colW) / 2)

    // Measure the block, then centre it vertically between the safe insets.
    const title = addText(scene, 0, 0, GAME_OVER_TITLE, {
      size: 32,
      tint: THEME.danger,
    })
    const head = addText(scene, 0, 0, m.headline, {
      tint: THEME.textLight,
      maxWidth: colW,
      align: 'center',
    })
    const headH = lineCount(head) * LINE_H
    const cont = this.opts.onContinue ?? null
    const btnCount = cont ? 2 : 1
    const blockH =
      28 +
      12 +
      headH +
      16 +
      m.stats.length * ROW_H +
      20 +
      btnCount * BTN_H +
      (btnCount - 1) * 8
    const top = L.safeTop
    const avail = H - L.safeTop - L.safeBottom
    let y = top + Math.max(PAD, Math.round((avail - blockH) / 2))

    title.setPosition(Math.round((W - title.width) / 2), y - 4)
    y += 28 + 12
    head.setPosition(Math.round((W - head.width) / 2), y - 3)
    y += headH + 16
    parts.push(title, head)
    for (const [label, value] of m.stats) {
      const l = addText(scene, x0, y, label, { tint: PALETTE.grey3 })
      const v = addText(scene, 0, y, value, { tint: THEME.textLight })
      v.setX(Math.round(x0 + colW - v.width))
      parts.push(l, v)
      y += ROW_H
    }
    y += 20
    const bw = Math.min(BTN_W, colW)
    const bx = Math.round((W - bw) / 2)
    const fresh = new Button(scene, {
      x: bx,
      y,
      w: bw,
      h: BTN_H,
      label: 'New game',
      face: 'primary',
      minHit: L.minHit,
      id: 'gameOver:newGame',
      onClick: () => this.opts.onNewGame(),
    })
    this.buttons = [fresh]
    if (cont) {
      y += BTN_H + 8
      this.buttons.push(
        new Button(scene, {
          x: bx,
          y,
          w: bw,
          h: BTN_H,
          label: 'Continue with one life',
          minHit: L.minHit,
          id: 'gameOver:continue',
          onClick: () => cont(),
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
