// Run summary card (plan.md §12.7 task 2, §12.9; v2: plan-build2 §8.7 task
// 2, §9): the playtest profile on one screen, for the author's review.
// Title `Run summary — seed 7 — 35:12 played`; rows lifetime earned /
// deliveries (on-time %) / first delivery · first malware caught (by whom) /
// levels 2 · 3 · 4 · 5 at / Victory (+ endless time) / malware spawned ·
// caught · missed / lives lost (label + what explains each: the counter
// machine, the sorter's `looks clean` call, `cleared by you`, and for an
// overseas loss `the ship has sailed` / `the plane has left`) / fleet bought
// / hires · fired · ads / quests offered · done · failed / sorter calls ·
// wrong / overseas cleared · malware at clearance / machines · docks · desks
// / taps per min · fps p50 · p5; footer the §9 fun bar 2 checklist (ticks,
// crosses, `?` = you judge, `–` = not yet) from the same object; buttons
// `Download playtest.json` (Blob + <a download>), `Copy summary` (plain
// text: navigator.clipboard, else a selected textarea + execCommand('copy'),
// else a selectable text box over the game), and `Keep playing` (`Back`
// over the game-over screen) / `New game`.
//
// HudScene owns it like the other cards: it holds the sim while open
// ('summary', plan.md §5), opens it from the Paused card's `End run — show
// summary`, from the game-over card's `Run summary`, and offers it once at
// 30:00 (SUMMARY_OFFER_S). Like GameOverCard it draws through its own
// full-screen camera over an off-screen origin and swallows every tap; it
// fits 360×604 (the rows close up to LINE_H when a long lives list would
// push the buttons off). The text and the checklist are pure
// (tests/ui/summary-card.test.ts).
import type Phaser from 'phaser'
import { removeCamera } from './cameraBits.ts'
import type { GameData } from '../data/types.ts'
import {
  clock,
  funBar,
  FUN_TARGETS,
  PLAYTEST_FILE,
  type FunCheck,
  type FunState,
  type Playtest,
} from '../metrics/playtest.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { Button } from './Button.ts'
import { sailedText } from './hubText.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import {
  addText,
  ellipsize,
  formatInt,
  formatMoney,
  lineCount,
  LINE_H,
} from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const SUMMARY_DEPTH = 100002
const PAD = 12
const COL_MAX_W = 340
const ROW_H = 16
const FUN_ROW_H = 18
const BTN_H = 44
const BTN_GAP = 8
/** Lives-lost entries listed before `… and N more`. */
export const LIVES_SHOWN = 3
/** How long a button shows `Copied!` / `Downloaded`. */
export const FEEDBACK_MS = 1500

export const DOWNLOAD_LABEL = `Download ${PLAYTEST_FILE}`
export const COPY_LABEL = 'Copy summary'
export const KEEP_LABEL = 'Keep playing'
export const BACK_LABEL = 'Back'
export const NEW_GAME_LABEL = 'New game'

export type SummaryMode = 'run' | 'over'

// ---- model (pure) ---------------------------------------------------------------

export interface SummaryRow {
  label: string
  value: string
  /** A lives-lost entry under the `Lives lost` row. */
  sub?: boolean
}

/** `Run summary — seed 7 — 35:12 played` (wall time, elapsedS). */
export function summaryTitle(pt: Playtest): string {
  return `Run summary — seed ${pt.seed} — ${clock(pt.elapsedS)} played`
}

/** A checker id's display name: machines.json name, `Inspector` for the desk. */
export function checkerName(data: GameData, id: string | null): string {
  if (id === null) return 'a checker'
  if (id === 'inspector') return 'Inspector'
  return data.machines.checkers.find((c) => c.id === id)?.name ?? id
}

/** `90%` of the clean deliveries on time (onTime / (onTime + late)). */
export function onTimePct(d: Playtest['deliveries']): number {
  const n = d.onTime + d.late
  return n > 0 ? Math.round((100 * d.onTime) / n) : 0
}

/** `2 bikes, 1 van` in vehicles.json order; `none`. */
export function fleetLine(
  bought: readonly { type: string }[],
  data: GameData,
): string {
  const parts: string[] = []
  for (const t of data.vehicles.types) {
    const n = bought.filter((b) => b.type === t.id).length
    if (n > 0) parts.push(`${n} ${t.name.toLowerCase()}${n === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(', ') : 'none'
}

/**
 * A lives-lost entry's value — what explains it: the counter machine, the
 * sorter's `looks clean` call (`Mo: looks clean`), `cleared by you`; `no
 * counter` when none of them; an overseas loss adds `the ship has sailed` /
 * `the plane has left` (the lost-life card's words, hubText.sailedText).
 */
export function lifeLostValue(
  l: Playtest['livesLost'][number],
  data: GameData,
): string {
  const parts: string[] = []
  if (l.counter !== null) parts.push(checkerName(data, l.counter))
  if (l.sorter !== null) parts.push(`${l.sorter}: looks clean`)
  if (l.clearedByPlayer) parts.push('cleared by you')
  if (parts.length === 0) parts.push('no counter')
  if (l.hub !== null) parts.push(sailedText(data, l.hub))
  return parts.join(' · ')
}

/** `11:42 · 17:58 · —` — the times levels 2..5 were reached (`—` = not yet). */
export function levelsLine(pt: Playtest): string {
  return [pt.level2AtS, pt.level3AtS, pt.level4AtS, pt.level5AtS]
    .map(clock)
    .join(' · ')
}

/** The card's rows (plan-build2 §8.7 order); lives-lost entries follow their row. */
export function summaryRows(pt: Playtest, data: GameData): SummaryRow[] {
  const d = pt.deliveries
  const fm = pt.firstMalware
  const m = pt.malware
  const q = pt.quests
  const n = formatInt
  const rows: SummaryRow[] = [
    { label: 'Lifetime earned', value: formatMoney(pt.lifetimeEarned) },
    {
      label: 'Deliveries',
      value:
        d.total > 0 ? `${n(d.total)} (${onTimePct(d)}% on time)` : 'none yet',
    },
    {
      label: 'First delivery · catch',
      value: `${pt.firstDeliveryS !== null ? clock(pt.firstDeliveryS) : 'not yet'} · ${
        fm.caughtS !== null
          ? `${clock(fm.caughtS)} ${checkerName(data, fm.by)}`
          : 'not yet'
      }`,
    },
    { label: 'Level 2 · 3 · 4 · 5', value: levelsLine(pt) },
    {
      label: 'Victory',
      value:
        pt.victoryAtS !== null
          ? `${clock(pt.victoryAtS)} · endless ${clock(pt.endlessS ?? 0)}`
          : 'not yet',
    },
    {
      label: 'Malware spawned · caught · missed',
      value: `${n(m.spawned)} · ${n(m.caught)} · ${n(m.missed)}`,
    },
    {
      label: 'Lives lost',
      value: pt.livesLost.length > 0 ? n(pt.livesLost.length) : 'none',
    },
  ]
  for (const l of pt.livesLost.slice(0, LIVES_SHOWN))
    rows.push({ label: l.label, value: lifeLostValue(l, data), sub: true })
  if (pt.livesLost.length > LIVES_SHOWN)
    rows.push({
      label: `… and ${pt.livesLost.length - LIVES_SHOWN} more`,
      value: '',
      sub: true,
    })
  rows.push(
    { label: 'Fleet bought', value: fleetLine(pt.vehiclesBought, data) },
    {
      label: 'Hires · fired · ads',
      value: `${n(pt.hires.length)} · ${n(pt.fired)} · ${n(pt.adsPosted)}`,
    },
    {
      label: 'Quests offered · done · failed',
      value: `${n(q.offered)} · ${n(q.completed)} · ${n(q.failed)}`,
    },
    {
      label: 'Sorter calls · wrong',
      value: `${n(pt.sorter.decisions)} · ${n(pt.sorter.wrong)}`,
    },
    {
      label: 'Overseas cleared · malware',
      value: `${n(pt.overseas.cleared)} · ${n(pt.overseas.malwareAtClearance)}`,
    },
    {
      label: 'Machines · docks · desks',
      value: `${n(pt.machinesBought.length)} · ${n(pt.docksBought.length)} · ${n(pt.desks)}`,
    },
    {
      label: 'Taps/min · FPS p50 · p5',
      value: `${pt.tapsPerMin.toFixed(1)} · ${
        pt.fps.samples > 0 ? `${pt.fps.p50} · ${pt.fps.p5}` : '—'
      }`,
    },
  )
  return rows
}

/** The fun bar 2 checklist (plan-build2 §9 windows, FUN_TARGETS). */
export function summaryChecks(
  pt: Playtest,
  openedAtS: number | null = null,
): FunCheck[] {
  return funBar(pt, FUN_TARGETS, openedAtS)
}

/** Plain-text marks for the copied summary. */
export function funMark(state: FunState): string {
  switch (state) {
    case 'pass':
      return '[x]'
    case 'fail':
      return '[ ]'
    case 'judge':
      return '[?]'
    default:
      return '[-]'
  }
}

/** The card as plain text (`Copy summary`; what the author pastes into the review). */
export function summaryText(
  pt: Playtest,
  data: GameData,
  checks: readonly FunCheck[],
): string {
  const lines = [summaryTitle(pt)]
  for (const r of summaryRows(pt, data))
    lines.push(
      r.sub
        ? `  - ${r.label}${r.value ? `: ${r.value}` : ''}`
        : `${r.label}: ${r.value}`,
    )
  lines.push('Fun bar 2:')
  for (const c of checks)
    lines.push(`${funMark(c.state)} ${c.n}. ${c.label} (${c.detail})`)
  const dv = pt.device
  lines.push(
    `Build ${pt.buildStamp} · started ${pt.startedAt} · ${dv.cssW}×${dv.cssH} @${dv.dpr}x zoom ${dv.zoom}`,
  )
  lines.push(dv.ua)
  return lines.join('\n')
}

/**
 * The card column's height: title, the rows at `rowH`, the `Fun bar 2`
 * head, the checklist and the two button rows (with their gaps).
 */
export function summaryBlockH(
  titleH: number,
  rows: number,
  checks: number,
  rowH = ROW_H,
): number {
  return (
    titleH +
    10 +
    rows * rowH +
    10 +
    ROW_H +
    checks * FUN_ROW_H +
    14 +
    2 * BTN_H +
    BTN_GAP
  )
}

/**
 * The row pitch: ROW_H, closed up (to LINE_H at the least) when the column
 * would not fit `avail` with a PAD above and below — a long lives list on
 * the 360×604 profile.
 */
export function summaryRowPitch(
  avail: number,
  titleH: number,
  rows: number,
  checks: number,
): number {
  if (rows <= 0) return ROW_H
  const fixed = summaryBlockH(titleH, 0, checks) + 2 * PAD
  return Math.max(LINE_H, Math.min(ROW_H, Math.floor((avail - fixed) / rows)))
}

// ---- browser helpers (called from a tap) ------------------------------------------

/** Save `obj` as a pretty JSON file (Blob + <a download>). False if it threw. */
export function downloadJson(name: string, obj: unknown): boolean {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return true
  } catch (err) {
    console.warn('summary: download failed', err)
    return false
  }
}

/** execCommand('copy') over a selected off-screen textarea (inside the tap). */
function execCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // 16 px: iOS zooms into a smaller focused field.
    ta.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export const COPY_BOX_ID = 'pm-copy'

/**
 * Last resort: the text in a selectable box over the game (plain HTML, like
 * Boot's cards) with a Close button, so the author can copy it by hand.
 */
export function showCopyBox(text: string): void {
  try {
    document.getElementById(COPY_BOX_ID)?.remove()
    const box = document.createElement('div')
    box.id = COPY_BOX_ID
    box.style.cssText =
      'position:fixed;inset:12px;z-index:1000;display:flex;flex-direction:column;gap:8px;' +
      'padding:12px;background:#fcf9f1;border:2px solid #241e32;font:14px monospace'
    const ta = document.createElement('textarea')
    ta.value = text
    ta.readOnly = true
    ta.style.cssText = 'flex:1;font:14px monospace;color:#241e32'
    const close = document.createElement('button')
    close.textContent = 'Close'
    close.style.cssText = 'min-height:44px;font:16px sans-serif'
    close.addEventListener('click', () => box.remove())
    box.append(ta, close)
    document.body.appendChild(box)
    ta.focus()
    ta.select()
  } catch (err) {
    console.warn('summary: copy box failed', err)
  }
}

/**
 * Copy `text`: the async Clipboard API in a secure context, else (or when it
 * rejects) execCommand; resolves 'manual' after showing the copy box.
 */
export async function copyText(text: string): Promise<'copied' | 'manual'> {
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null
    if (clip?.writeText && globalThis.isSecureContext !== false) {
      await clip.writeText(text)
      return 'copied'
    }
  } catch {
    // rejected (no permission, not focused): fall through
  }
  if (execCopy(text)) return 'copied'
  showCopyBox(text)
  return 'manual'
}

// ---- view -----------------------------------------------------------------------

export interface SummaryCardOptions {
  data: GameData
  /** `Keep playing` (run) / `Back` (over the game-over screen); Esc too. */
  onClose(mode: SummaryMode): void
  /** `New game` (the HUD confirms it during a live run). */
  onNewGame(mode: SummaryMode): void
  /** The profile to download / copy (default: the one the card shows). */
  current?: () => Playtest | null
}

export class SummaryCard {
  readonly scene: Phaser.Scene
  private L: Layout
  private opts: SummaryCardOptions
  private pt: Playtest | null = null
  private mode: SummaryMode = 'run'
  private openedAtS: number | null = null
  private root: Phaser.GameObjects.Container | null = null
  private cam: Phaser.Cameras.Scene2D.Camera | null = null
  private buttons: Button[] = []
  private feedback: Phaser.Time.TimerEvent[] = []

  constructor(scene: Phaser.Scene, L: Layout, opts: SummaryCardOptions) {
    this.scene = scene
    this.L = L
    this.opts = opts
  }

  isOpen(): boolean {
    return this.pt !== null
  }

  get current(): Playtest | null {
    return this.pt
  }

  get currentMode(): SummaryMode {
    return this.mode
  }

  /** The checklist the card shows (null while closed). */
  checks(): FunCheck[] | null {
    return this.pt ? summaryChecks(this.pt, this.openedAtS) : null
  }

  /** Show `pt`; `openedAtS` = elapsedS at the run's first opening (fun bar 4). */
  open(pt: Playtest, mode: SummaryMode, openedAtS: number | null = null): void {
    this.teardown()
    if (!this.pt) {
      pushModal(this)
      this.scene.input.keyboard?.on('keydown', this.onKey, this)
    }
    this.pt = pt
    this.mode = mode
    this.openedAtS = openedAtS
    this.build()
  }

  close(): void {
    if (!this.pt) return
    this.pt = null
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.teardown()
  }

  relayout(L: Layout): void {
    this.L = L
    if (!this.pt) return
    this.teardown()
    this.build()
  }

  destroy(): void {
    this.close()
  }

  /** The plain text `Copy summary` puts on the clipboard. */
  text(): string | null {
    const pt = this.pt
    if (!pt) return null
    return summaryText(pt, this.opts.data, this.checks() ?? [])
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && claimKey(ev, this)) this.opts.onClose(this.mode)
    else if (ev.key === 'Enter') claimKey(ev, this)
  }

  private teardown(): void {
    for (const t of this.feedback) t.remove(false)
    this.feedback = []
    for (const b of this.buttons) b.destroy()
    this.buttons = []
    this.root?.destroy()
    this.root = null
    removeCamera(this.scene, this.cam)
    this.cam = null
  }

  /** A button reads `label` for FEEDBACK_MS, then its own label again. */
  private flash(b: Button, label: string, back: string): void {
    b.setLabel(label)
    this.feedback.push(
      this.scene.time.delayedCall(FEEDBACK_MS, () => {
        if (b.active) b.setLabel(back)
      }),
    )
  }

  private download(b: Button): void {
    const obj = this.opts.current?.() ?? this.pt
    if (!obj) return
    const ok = downloadJson(PLAYTEST_FILE, obj)
    this.flash(b, ok ? 'Downloaded' : 'Download failed', DOWNLOAD_LABEL)
  }

  private copy(b: Button): void {
    const text = this.text()
    if (text === null) return
    void copyText(text).then((how) => {
      if (this.pt && b.active)
        this.flash(
          b,
          how === 'copied' ? 'Copied!' : 'Select + copy',
          COPY_LABEL,
        )
    })
  }

  private build(): void {
    const pt = this.pt
    if (!pt) return
    const scene = this.scene
    const data = this.opts.data
    const L = this.L
    const { W, H } = L
    const o = offscreenOrigin()
    const bg = addPanel(scene, 0, 0, W, H, 'ui_panel_dark').setInteractive()
    const parts: Phaser.GameObjects.GameObject[] = [bg]
    const colW = Math.min(W - 2 * PAD, COL_MAX_W)
    const x0 = Math.round((W - colW) / 2)
    const rows = summaryRows(pt, data)
    const checks = summaryChecks(pt, this.openedAtS)

    const title = addText(scene, 0, 0, summaryTitle(pt), {
      tint: THEME.gold,
      maxWidth: colW,
      align: 'center',
    })
    const titleH = lineCount(title) * LINE_H
    const avail = H - L.safeTop - L.safeBottom
    const rowH = summaryRowPitch(avail, titleH, rows.length, checks.length)
    const blockH = summaryBlockH(titleH, rows.length, checks.length, rowH)
    let y = L.safeTop + Math.max(PAD, Math.round((avail - blockH) / 2))

    title.setPosition(Math.round((W - title.width) / 2), y - 3)
    parts.push(title)
    y += titleH + 10

    // Rows: label left (grey), value right (light); lives-lost entries
    // indented; a value never pushes its label under 24 px.
    for (const r of rows) {
      const lx = r.sub ? x0 + 12 : x0
      const v = addText(scene, 0, y - 3, r.value, { tint: THEME.textLight })
      const maxV = x0 + colW - lx - 32
      if (v.width > maxV)
        v.setText(ellipsize(r.value, maxV, (s) => v.setText(s).width))
      v.setX(Math.round(x0 + colW - v.width))
      const room = Math.max(24, Math.round(v.x - lx - 8))
      const l = addText(scene, lx, y - 3, r.label, {
        tint: r.sub ? PALETTE.grey2 : PALETTE.grey3,
      })
      l.setText(ellipsize(r.label, room, (s) => l.setText(s).width))
      parts.push(l, v)
      y += rowH
    }
    y += 10

    const head = addText(scene, x0, y - 3, 'Fun bar 2', { tint: THEME.gold })
    parts.push(head)
    y += ROW_H
    for (const c of checks) {
      const top = y + Math.floor((FUN_ROW_H - 16) / 2)
      if (c.state === 'pass' || c.state === 'fail') {
        parts.push(
          scene.add
            .image(
              x0,
              top,
              UI_ATLAS,
              c.state === 'pass' ? 'ic_check' : 'ic_cross',
            )
            .setOrigin(0, 0),
        )
      } else {
        const mark = addText(
          scene,
          0,
          top - 2,
          c.state === 'judge' ? '?' : '–',
          {
            tint: c.state === 'judge' ? THEME.warn : THEME.textMuted,
          },
        )
        mark.setX(Math.round(x0 + (16 - mark.width) / 2))
        parts.push(mark)
      }
      const det = addText(scene, 0, top - 2, c.detail, {
        tint: c.state === 'judge' ? THEME.warn : PALETTE.grey3,
      })
      det.setX(Math.round(x0 + colW - det.width))
      const lab = addText(scene, x0 + 22, top - 2, c.label, {
        tint: THEME.textLight,
      })
      const room = Math.max(24, Math.round(det.x - (x0 + 22) - 8))
      lab.setText(ellipsize(c.label, room, (s) => lab.setText(s).width))
      parts.push(det, lab)
      y += FUN_ROW_H
    }
    y += 14

    const bw = Math.floor((colW - BTN_GAP) / 2)
    const bx2 = x0 + colW - bw
    const dl = new Button(scene, {
      x: x0,
      y,
      w: bw,
      h: BTN_H,
      label: DOWNLOAD_LABEL,
      minHit: L.minHit,
      id: 'summary:download',
      onClick: () => this.download(dl),
    })
    const cp = new Button(scene, {
      x: bx2,
      y,
      w: bw,
      h: BTN_H,
      label: COPY_LABEL,
      minHit: L.minHit,
      id: 'summary:copy',
      onClick: () => this.copy(cp),
    })
    y += BTN_H + BTN_GAP
    const mode = this.mode
    const keep = new Button(scene, {
      x: x0,
      y,
      w: bw,
      h: BTN_H,
      label: mode === 'over' ? BACK_LABEL : KEEP_LABEL,
      face: 'primary',
      minHit: L.minHit,
      id: mode === 'over' ? 'summary:back' : 'summary:keep',
      onClick: () => this.opts.onClose(mode),
    })
    const fresh = new Button(scene, {
      x: bx2,
      y,
      w: bw,
      h: BTN_H,
      label: NEW_GAME_LABEL,
      minHit: L.minHit,
      id: 'summary:newGame',
      onClick: () => this.opts.onNewGame(mode),
    })
    this.buttons = [dl, cp, keep, fresh]

    const root = scene.add.container(o.x, o.y, [...parts, ...this.buttons])
    root.setDepth(SUMMARY_DEPTH)
    for (const c of scene.cameras.cameras) c.ignore(root)
    const cam = scene.cameras.add(0, 0, W, H)
    cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list) if (obj !== root) cam.ignore(obj)
    this.root = root
    this.cam = cam
  }
}
