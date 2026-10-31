// HireSheet (spec-build2 §2.7, §2.5; design-m6 §6.1; plan-build2 §8.3 task 7):
// the applicant picker shared by the Warehouse desk card, the StationCard and
// the Garage (buy flow, Replace, Hire driver). A bottom-anchored panel above
// `safeBottom`, full width, 276 px tall:
//   title band (32)   `Hire an inspector` / `Who drives the Bike?` (+ a
//                     right-aligned muted note, e.g. `Bike $200 + fee`;
//                     without one, the countdown to the next pool refresh,
//                     `New faces in 0:23`, so the day's re-roll under an
//                     open sheet is expected — M6 review)
//   three cards (180) side by side, w = min(140, floor((W − 28) / 3)), 6-px
//                     gaps, centred (110 px at 360, 121 at 393, 134 at 430):
//                     face_NN 16×16 (ic_star top-right for ★), name (gold
//                     for ★), role line (`Inspector`, gold `leaves in 2d`
//                     for ★), one pip row per stat (`eye`/`pace`/`charisma`,
//                     `judgement`/`pace`, `speed`/`energy`/`charisma`;
//                     ic_pip_on/off at a 7-px pitch), the numbers line
//                     (`catch 85% · 4.0s`, `85% · 1 per 6s`, `×1.08 · stop
//                     ×0.9`), the inspector's `false-flag 15%` / the
//                     driver's `likes` + ic_<type>, `$20/day · fee $20`
//                     (`$28/day · free` for ★) and a 44-px `Hire`
//   gap (8) + row (44) `Post an ad $30` (full width), or left half with
//                     `Hire later` right in the Garage buy flow
//   bottom pad (12)
// Like Dialog it lives in a Container at a far-off world origin, shown
// through its own full-screen camera added last (so it covers a Sheet's list
// camera), over a 40 % black backdrop that swallows taps; a tap on the
// backdrop or Esc cancels (onCancel). It is constructible in any scene; the
// scene going to sleep closes it silently (the caller's sheet closes too).
// The sim keeps running: the cards re-render when the pool changes (a day
// boundary, an ad, a hire elsewhere, a ★ arriving or leaving — polled per
// frame from the revision-cached ViewSim.applicants, so a sim swap is
// covered too), the Hire / ad buttons follow the balance, and a target that
// disappears (a sold vehicle, a removed desk) or game over cancels the sheet.
// Hire → ViewSim.hire, or ViewSim.buyVehicle(type, id) in the buy flow
// (`Hire later` → buyVehicle(type, null)); success closes and calls onDone;
// a refusal (a stale card → `no-applicant`, no money) shakes the card 2 px,
// plays `ui:sfx deny` and shows the failText bubble above the button — drawn
// inside the sheet's own layer, because the HUD (which renders pm:tooltip)
// sits under the Garage scene.
// Phaser is a type-only import here; the pure model below is unit-tested
// under Node (tests/ui/hire-sheet.test.ts).
import type Phaser from 'phaser'
import { removeCamera } from './cameraBits.ts'
import type { StatId, VehicleTypeDef } from '../data/types.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull, type FrameName } from '../render/frames.ts'
import type { CommandResult } from '../sim/commands.ts'
import type { HireTarget, Pips, Role, VehicleType } from '../sim/types.ts'
import { TICKS_PER_DAY, TICKS_PER_S } from '../sim/types.ts'
import type { ApplicantView, ViewSim } from '../sim/view-api.ts'
import { Button, TAP_PX } from './Button.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import {
  addText,
  ellipsize,
  formatClock,
  formatMoney,
  textTop,
} from './text.ts'
import { PALETTE, THEME } from './theme.ts'
import { EV_UI_SFX, failText } from './ZonePicker.ts'

// ---- geometry ----------------------------------------------------------------

export const HIRE_TITLE_H = 32
export const HIRE_CARD_H = 180
export const HIRE_CARD_MAX_W = 140
export const HIRE_CARD_GAP = 6
/** Side air the three cards keep in total (8 px each side). */
const CARDS_SIDE = 16
export const HIRE_ROW_GAP = 8
export const HIRE_ROW_H = 44
export const HIRE_BOTTOM_PAD = 12
/** 32 + 180 + 8 + 44 + 12 = 276 (design-m6 §6.1). */
export const HIRE_SHEET_H =
  HIRE_TITLE_H + HIRE_CARD_H + HIRE_ROW_GAP + HIRE_ROW_H + HIRE_BOTTOM_PAD
export const HIRE_BACKDROP_ALPHA = 0.4
/** Inner padding of a card. */
export const CARD_PAD = 6
/** Pip pitch (an 8×8 ic_pip frame holds a 6×6 dot: 1 px of air between dots). */
export const PIP_PITCH = 7
export const PIP_SIZE = 8
/** Card-local tops (14-px text bands; the face row is 16). */
const FACE_Y = 6
const ROLE_Y = 24
const PIPS_Y = 40
const LINE = 14
const MONEY_Y = 114
const BTN_Y = 130
const SHAKE_PX = 2
const SHAKE_MS = 160
const TIP_MS = 2000
/** Name colour of a ★ applicant (gold0 reads on the light card). */
export const STAR_TINT = PALETTE.gold0
const MUTED = PALETTE.grey1

/** The three card rects (x, w) for a canvas W px wide (design-m6 §6.1). */
export function hireCardRects(W: number): { x: number; w: number }[] {
  const w = Math.min(
    HIRE_CARD_MAX_W,
    Math.floor((W - CARDS_SIDE - 2 * HIRE_CARD_GAP) / 3),
  )
  const total = 3 * w + 2 * HIRE_CARD_GAP
  const x0 = Math.round((W - total) / 2)
  return [0, 1, 2].map((i) => ({ x: x0 + i * (w + HIRE_CARD_GAP), w }))
}

/** The panel rect: full width, bottom on H − safeBottom (never above y 0). */
export function hireSheetRect(
  W: number,
  H: number,
  safeBottom: number,
): { x: number; y: number; w: number; h: number } {
  const y = Math.max(0, Math.round(H - Math.max(0, safeBottom) - HIRE_SHEET_H))
  return { x: 0, y, w: Math.round(W), h: HIRE_SHEET_H }
}

/**
 * The bottom row's buttons (sheet-local): `Post an ad` across the cards'
 * span, or its left half with `Hire later` on the right (6-px gap).
 */
export function hireRowRects(
  W: number,
  later: boolean,
): { ad: { x: number; w: number }; later: { x: number; w: number } | null } {
  const cards = hireCardRects(W)
  const x0 = cards[0]?.x ?? 0
  const last = cards[cards.length - 1]
  const span = last ? last.x + last.w - x0 : W
  if (!later) return { ad: { x: x0, w: span }, later: null }
  const half = Math.floor((span - HIRE_CARD_GAP) / 2)
  return {
    ad: { x: x0, w: half },
    later: { x: x0 + span - half, w: half },
  }
}

// ---- pure model ----------------------------------------------------------------

/**
 * The stats a role's card shows, top to bottom (employees.json roles[role]
 * .stats; the schema pins exactly these lists).
 */
export const ROLE_STATS: Readonly<Record<Role, readonly StatId[]>> = {
  inspector: ['eye', 'pace', 'charisma'],
  sorter: ['judgement', 'pace'],
  driver: ['speed', 'energy', 'charisma'],
}

export const ROLE_NAME: Readonly<Record<Role, string>> = {
  inspector: 'Inspector',
  sorter: 'Sorter',
  driver: 'Driver',
}

/** Pip count of a stat: charisma 0-2, the others 1-5. */
export function pipMax(stat: StatId): 2 | 5 {
  return stat === 'charisma' ? 2 : 5
}

/** `n` lit pips out of `max` (●●●○○), n clamped to 0..max. */
export function pipModel(n: number, max: 2 | 5): boolean[] {
  const on = Math.max(0, Math.min(max, Math.round(Number(n) || 0)))
  return Array.from({ length: max }, (_, i) => i < on)
}

/** Width of a pip row of `max` pips (the last dot is a full 8-px frame). */
export function pipsWidth(max: number): number {
  return max <= 0 ? 0 : (max - 1) * PIP_PITCH + PIP_SIZE
}

/** The face frame of a look index: `face_03`. */
export function faceFrame(look: number): string {
  return `face_${String(Math.max(0, Math.floor(look))).padStart(2, '0')}`
}

/** `85%` for 0..1. */
function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

/** A multiplier without float noise: 1.08, 1, 0.9. */
export function multText(x: number): string {
  return String(Math.round(x * 100) / 100)
}

/** Seconds: one decimal for the inspector's process time (`4.0s`). */
function secs1(s: number): string {
  return `${(Math.round(s * 10) / 10).toFixed(1)}s`
}

/** Seconds without a trailing `.0` (`6s`, `4.5s`). */
function secs(s: number): string {
  return `${Math.round(s * 10) / 10}s`
}

/**
 * Ticks until the pools next refresh at `tick`: the first day boundary whose
 * day is a multiple of applicants.refreshEveryDays (people.ts peopleDayStep).
 */
export function ticksToPoolRefresh(tick: number, everyDays: number): number {
  const every = Math.max(1, Math.floor(everyDays))
  let day = Math.floor(tick / TICKS_PER_DAY) + 1
  while (day % every !== 0) day += 1
  return day * TICKS_PER_DAY - tick
}

/** The title band's countdown: `New faces in 0:23`. */
export function poolRefreshNote(ticks: number): string {
  return `New faces in ${formatClock(ticks / TICKS_PER_S)}`
}

/** `leaves in 2d`, `leaves in 1d`, `leaves today`. */
export function leavesText(days: number): string {
  return days <= 0 ? 'leaves today' : `leaves in ${days}d`
}

/** `$20/day · fee $20`, `$28/day · free` for a ★ (fee 0). */
export function moneyLine(salaryPerDay: number, fee: number): string {
  const s = `${formatMoney(salaryPerDay)}/day`
  return fee > 0 ? `${s} · fee ${formatMoney(fee)}` : `${s} · free`
}

/** The role's numbers line (≤ 17 chars): `catch 85% · 4.0s` … */
export function numbersLine(role: Role, n: ApplicantView['numbers']): string {
  if (role === 'inspector')
    return `catch ${pct(n.p ?? 0)} · ${secs1(n.processS ?? 0)}`
  if (role === 'sorter')
    return `${pct(n.correct ?? 0)} · 1 per ${secs(n.decisionS ?? 0)}`
  return `×${multText(n.speedMult ?? 1)} · stop ×${multText(n.stopMult ?? 1)}`
}

export interface PipRowModel {
  stat: StatId
  label: string
  on: boolean[]
}

export interface HireCardModel {
  id: number
  role: Role
  name: string
  star: boolean
  /** `face_NN` (the caller falls back when the atlas lacks it). */
  face: string
  /** `Inspector`, or gold `leaves in 2d` for a ★. */
  roleLine: string
  pips: PipRowModel[]
  numbers: string
  /** Inspector: `false-flag 15%`; else null. */
  extra: string | null
  /** Driver affinity (a vehicle type) shown as `likes` + ic_<type>; else null. */
  affinity: VehicleType | null
  money: string
  /** The hire fee (0 for ★); the buy flow adds the vehicle price. */
  fee: number
  salaryPerDay: number
}

/** One applicant card (design-m6 §6.1). */
export function cardModel(a: ApplicantView, role: Role): HireCardModel {
  const pips = pipRows(role, a.pips)
  return {
    id: a.id,
    role,
    name: a.name,
    star: a.star,
    face: faceFrame(a.look),
    roleLine:
      a.star && a.leavesInDays !== null
        ? leavesText(a.leavesInDays)
        : ROLE_NAME[role],
    pips,
    numbers: numbersLine(role, a.numbers),
    extra:
      role === 'inspector' && a.numbers.decoyFlag !== undefined
        ? `false-flag ${pct(a.numbers.decoyFlag)}`
        : null,
    affinity: role === 'driver' && a.affinity !== 'none' ? a.affinity : null,
    money: moneyLine(a.salaryPerDay, a.star ? 0 : a.hireFee),
    fee: a.star ? 0 : a.hireFee,
    salaryPerDay: a.salaryPerDay,
  }
}

/** `Post an ad $30` (employees.json applicants.adPrice). */
export function adLabel(adPrice: number): string {
  return `Post an ad ${formatMoney(adPrice)}`
}

/** The Garage buy flow's title: `Who drives the Bike?` */
export function buyTitle(typeName: string): string {
  return `Who drives the ${typeName}?`
}

/** The Garage buy flow's note: `Bike $200 + fee`. */
export function buyNote(def: Pick<VehicleTypeDef, 'name' | 'price'>): string {
  return `${def.name} ${formatMoney(def.price)} + fee`
}

// ---- the sheet -------------------------------------------------------------------

export type HireSheetTarget = HireTarget | { buyType: VehicleType }

export interface HireSheetOptions {
  vs: ViewSim
  role: Role
  /** What a Hire seats; `buyType` = the Garage buy flow (dispatches buyVehicle). */
  target: HireSheetTarget
  /** 'Hire an inspector' | 'Hire a sorter' | 'Who drives the Bike?' | 'Replace Dee · Bike 2' | 'Driver for Bike 2' */
  title: string
  /** A muted right-aligned note in the title band (`Bike $200 + fee`). */
  note?: string
  /** Buy flow: the `Hire later` button (→ buyVehicle(type, null)). */
  allowLater?: boolean
  W: number
  H: number
  minHit: number
  /** Space under the panel: the safe area (+ the HUD bottom band in the Warehouse). */
  safeBottom: number
  /** Button id prefix; default 'hire'. */
  id?: string
  /** After a successful Hire / Hire later (the caller toasts / reopens its card). */
  onDone?(res: CommandResult): void
  /** Backdrop tap, Esc, or the target went away. Not called by close() / sleep. */
  onCancel?(): void
}

interface CardView {
  model: HireCardModel
  c: Phaser.GameObjects.Container
  btn: Button
  x: number
}

export class HireSheet {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly cam: Phaser.Cameras.Scene2D.Camera
  readonly id: string

  private opts: HireSheetOptions
  private W: number
  private H: number
  private sb: number
  private open = true
  private backdrop: Phaser.GameObjects.Rectangle
  private panel: Phaser.GameObjects.Container
  private bg: Phaser.GameObjects.NineSlice
  private title: Phaser.GameObjects.BitmapText
  private note: Phaser.GameObjects.BitmapText | null = null
  /** The note is the pool-refresh countdown (no caller note). */
  private countdown = false
  private cardsLayer: Phaser.GameObjects.Container
  private cards: CardView[] = []
  private adBtn: Button
  private laterBtn: Button | null = null
  private armed = false
  /** Pool identity (ids, ★ days, salaries): a change rebuilds the cards. */
  private poolSig = ''
  private tip: Phaser.GameObjects.Container | null = null
  private tipTimer: Phaser.Time.TimerEvent | null = null
  /** The running refusal shake (one at a time). */
  private shakeTween: Phaser.Tweens.Tween | null = null

  constructor(scene: Phaser.Scene, opts: HireSheetOptions) {
    this.scene = scene
    this.opts = opts
    this.id = opts.id ?? 'hire'
    this.W = Math.round(opts.W)
    this.H = Math.round(opts.H)
    this.sb = Math.max(0, Math.round(opts.safeBottom))
    const o = offscreenOrigin()

    this.backdrop = scene.add
      .rectangle(0, 0, this.W, this.H, THEME.shadow, HIRE_BACKDROP_ALPHA)
      .setOrigin(0, 0)
      .setInteractive()
    this.backdrop.on('pointerdown', () => {
      this.armed = true
    })
    this.backdrop.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.armed
      this.armed = false
      if (armed && p.getDistance() <= TAP_PX) this.cancel()
    })

    this.bg = addPanel(scene, 0, 0, this.W, HIRE_SHEET_H, 'ui_panel')
    this.bg.setInteractive() // taps on the panel stay in the sheet
    this.title = addText(scene, 12, textTop(0, HIRE_TITLE_H), opts.title)
    this.countdown = !opts.note
    this.note = addText(
      scene,
      0,
      textTop(0, HIRE_TITLE_H),
      opts.note ?? this.countdownText(),
      { tint: MUTED },
    )
    this.cardsLayer = scene.add.container(0, 0)
    this.adBtn = new Button(scene, {
      x: 0,
      y: 0,
      w: 100,
      h: HIRE_ROW_H,
      label: adLabel(opts.vs.data.employees.applicants.adPrice),
      minHit: opts.minHit,
      id: `${this.id}:ad`,
      onClick: () => this.postAd(),
      onDisabledTap: () =>
        this.deny(this.adBtn, null, failText('insufficient-funds')),
    })
    const parts: Phaser.GameObjects.GameObject[] = [
      this.bg,
      this.title,
      this.cardsLayer,
      this.adBtn,
    ]
    if (this.note) parts.push(this.note)
    if (opts.allowLater && 'buyType' in opts.target) {
      this.laterBtn = new Button(scene, {
        x: 0,
        y: 0,
        w: 100,
        h: HIRE_ROW_H,
        label: 'Hire later',
        minHit: opts.minHit,
        id: `${this.id}:later`,
        onClick: () => this.hireLater(),
        onDisabledTap: () =>
          this.deny(this.laterBtn, null, failText('insufficient-funds')),
      })
      parts.push(this.laterBtn)
    }
    this.panel = scene.add.container(0, 0, parts)
    this.root = scene.add.container(o.x, o.y, [this.backdrop, this.panel])
    this.root.setDepth(100000)

    for (const c of scene.cameras.cameras) c.ignore(this.root)
    this.cam = scene.cameras.add(0, 0, this.W, this.H)
    this.cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list)
      if (obj !== this.root) this.cam.ignore(obj)

    this.layout()
    this.refresh(true)
    pushModal(this)
    scene.input.keyboard?.on('keydown', this.onKey, this)
    scene.events.on('update', this.onUpdate, this)
    scene.events.once('shutdown', this.close, this)
    scene.events.once('sleep', this.close, this)
  }

  isOpen(): boolean {
    return this.open
  }

  /** The vehicle type a driver card is priced for (buy type / the vehicle's). */
  get vehicleType(): VehicleType {
    const t = this.opts.target
    if ('buyType' in t) return t.buyType
    if ('vehicleId' in t)
      return (
        this.opts.vs.vehicles.find((v) => v.id === t.vehicleId)?.type ?? 'bike'
      )
    return 'bike'
  }

  /** Today's applicants as the cards show them (tests / e2e). */
  applicants(): readonly ApplicantView[] {
    return this.opts.role === 'driver'
      ? this.opts.vs.applicants('driver', this.vehicleType)
      : this.opts.vs.applicants(this.opts.role)
  }

  /** The card models in screen order (tests / e2e). */
  get cardModels(): readonly HireCardModel[] {
    return this.cards.map((c) => c.model)
  }

  /** Close without callbacks (the caller tears down, the scene sleeps or stops). */
  close(): void {
    if (!this.open) return
    this.open = false
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('update', this.onUpdate, this)
    this.scene.events.off('shutdown', this.close, this)
    this.scene.events.off('sleep', this.close, this)
    this.tipTimer?.remove(false)
    this.tipTimer = null
    this.stopShake()
    this.cards = []
    this.root.destroy()
    removeCamera(this.scene, this.cam)
  }

  /** Close and run onCancel (backdrop tap, Esc, target gone). */
  cancel(): void {
    if (!this.open) return
    this.close()
    this.opts.onCancel?.()
  }

  /** Re-fit to a new canvas (and optionally a new space under the panel). */
  relayout(L: { W: number; H: number; safeBottom?: number }): void {
    if (!this.open) return
    this.W = Math.round(L.W)
    this.H = Math.round(L.H)
    if (L.safeBottom !== undefined)
      this.sb = Math.max(0, Math.round(L.safeBottom))
    this.cam.setSize(this.W, this.H)
    this.layout()
    this.refresh(true)
  }

  /** Hire the applicant on card `index` (the card's button; tests / e2e). */
  hire(index: number): CommandResult | null {
    const card = this.cards[index]
    if (!this.open || !card) return null
    const vs = this.opts.vs
    const t = this.opts.target
    const res =
      'buyType' in t
        ? vs.buyVehicle(t.buyType, card.model.id)
        : vs.hire(this.opts.role, card.model.id, t)
    if (!res.ok) {
      this.deny(card.btn, card, failText(res.reason, this.opts.vs.data))
      this.poolSig = '' // a stale card: re-read the pool next frame
      return res
    }
    this.finish(res)
    return res
  }

  /** Buy flow: the vehicle without a driver (parks `No driver`). */
  hireLater(): CommandResult | null {
    const t = this.opts.target
    if (!this.open || !('buyType' in t)) return null
    const res = this.opts.vs.buyVehicle(t.buyType, null)
    if (!res.ok) {
      this.deny(this.laterBtn, null, failText(res.reason, this.opts.vs.data))
      return res
    }
    this.finish(res)
    return res
  }

  /** Re-roll this role's pool for applicants.adPrice. */
  postAd(): CommandResult | null {
    if (!this.open) return null
    const res = this.opts.vs.postAd(this.opts.role)
    if (!res.ok)
      this.deny(this.adBtn, null, failText(res.reason, this.opts.vs.data))
    else this.poolSig = ''
    return res
  }

  // ---- internals ---------------------------------------------------------

  private finish(res: CommandResult): void {
    this.close()
    this.opts.onDone?.(res)
  }

  /** The money a card's Hire needs now: its fee (+ the price in the buy flow). */
  private costOf(m: HireCardModel): number {
    return m.fee + this.buyPrice()
  }

  /**
   * The vehicle's price in the buy flow (0 otherwise): B3 §3.6 — what
   * buyVehicle will charge now (ViewSim.priceOf, a vehiclePrice modifier
   * included), so the cards, `Hire later` and the cost check agree with it.
   */
  buyPrice(): number {
    const t = this.opts.target
    if (!('buyType' in t)) return 0
    const vs = this.opts.vs
    const def = vs.data.vehicles.types.find((x) => x.id === t.buyType)
    return def ? vs.priceOf('vehicle', def.price) : 0
  }

  /** False once the target is gone (sold vehicle, removed desk) or at game over. */
  private valid(): boolean {
    const vs = this.opts.vs
    if (vs.gameOver) return false
    const t = this.opts.target
    if ('vehicleId' in t) return vs.vehicles.some((v) => v.id === t.vehicleId)
    if ('nodeId' in t)
      return vs.lane
        .nodes()
        .some((n) => n.id === t.nodeId && n.fixture?.kind === 'desk')
    return true
  }

  private onUpdate(): void {
    if (!this.open) return
    if (!this.valid()) {
      this.cancel()
      return
    }
    this.refresh(false)
    if (this.countdown && this.note) {
      const text = this.countdownText()
      if (this.note.text !== text) {
        this.note.setText(text)
        this.placeTitle()
      }
    }
  }

  /** `New faces in 0:23` at the sim's tick now. */
  private countdownText(): string {
    const vs = this.opts.vs
    return poolRefreshNote(
      ticksToPoolRefresh(
        vs.tick,
        vs.data.employees.applicants.refreshEveryDays,
      ),
    )
  }

  private layout(): void {
    const r = hireSheetRect(this.W, this.H, this.sb)
    this.backdrop.setSize(this.W, this.H)
    const area = this.backdrop.input?.hitArea as
      | Phaser.Geom.Rectangle
      | undefined
    area?.setSize(this.W, this.H)
    this.panel.setPosition(r.x, r.y)
    this.bg.setSize(r.w, r.h)
    const bgArea = this.bg.input?.hitArea as Phaser.Geom.Rectangle | undefined
    bgArea?.setSize(r.w, r.h)
    this.placeTitle()
    const row = hireRowRects(this.W, this.laterBtn !== null)
    const y = HIRE_TITLE_H + HIRE_CARD_H + HIRE_ROW_GAP
    this.adBtn.setRect({ x: row.ad.x, y, w: row.ad.w, h: HIRE_ROW_H })
    if (this.laterBtn && row.later)
      this.laterBtn.setRect({
        x: row.later.x,
        y,
        w: row.later.w,
        h: HIRE_ROW_H,
      })
  }

  /** The title (ellipsized) and the right-aligned note in the title band. */
  private placeTitle(): void {
    const x0 = hireCardRects(this.W)[0]?.x ?? 12
    this.title.setX(x0)
    let titleRoom = this.W - 2 * x0
    if (this.note) {
      this.note.setX(this.W - x0 - Math.round(this.note.width))
      titleRoom -= Math.round(this.note.width) + 8
    }
    const t = this.title
    t.setText(ellipsize(this.opts.title, titleRoom, (s) => t.setText(s).width))
  }

  /** Rebuild the cards when the pool changed (or `force`), then the enables. */
  private refresh(force: boolean): void {
    const list = this.applicants()
    const sig = list
      .map((a) => `${a.id}:${a.leavesInDays ?? ''}:${a.salaryPerDay}`)
      .join(',')
    if (force || sig !== this.poolSig) {
      this.poolSig = sig
      this.buildCards(list)
    }
    const money = this.opts.vs.money
    for (const c of this.cards) c.btn.setEnabled(money >= this.costOf(c.model))
    const ad = this.opts.vs.data.employees.applicants.adPrice
    this.adBtn.setEnabled(money >= ad)
    this.laterBtn?.setEnabled(money >= this.buyPrice())
  }

  private buildCards(list: readonly ApplicantView[]): void {
    const scene = this.scene
    this.stopShake()
    this.cardsLayer.removeAll(true)
    this.cards = []
    const rects = hireCardRects(this.W)
    rects.forEach((r, i) => {
      const a = list[i]
      const c = scene.add.container(r.x, HIRE_TITLE_H)
      c.add(addPanel(scene, 0, 0, r.w, HIRE_CARD_H, 'ui_panel'))
      if (!a) {
        const t = addText(scene, 0, 0, 'No one yet', { tint: MUTED })
        t.setPosition(
          Math.round((r.w - t.width) / 2),
          textTop(0, HIRE_CARD_H - HIRE_ROW_H),
        )
        c.add(t)
        this.cardsLayer.add(c)
        return
      }
      const m = cardModel(a, this.opts.role)
      this.fillCard(c, m, r.w)
      const btn = new Button(scene, {
        x: CARD_PAD,
        y: BTN_Y,
        w: r.w - 2 * CARD_PAD,
        h: HIRE_ROW_H,
        label: 'Hire',
        face: 'primary',
        minHit: this.opts.minHit,
        id: `${this.id}:card:${i}`,
        onClick: () => this.hire(i),
        onDisabledTap: () => {
          const card = this.cards[i]
          if (card) this.deny(card.btn, card, failText('insufficient-funds'))
        },
      })
      c.add(btn)
      this.cardsLayer.add(c)
      this.cards.push({ model: m, c, btn, x: r.x })
    })
  }

  /** The card's static content (card-local, `w` px wide). */
  private fillCard(
    c: Phaser.GameObjects.Container,
    m: HireCardModel,
    w: number,
  ): void {
    const scene = this.scene
    const inner = w - 2 * CARD_PAD
    const face: FrameName =
      frameOrNull(m.face) ?? frameOrNull('ic_person') ?? 'ic_lock'
    c.add(scene.add.image(CARD_PAD, FACE_Y, UI_ATLAS, face).setOrigin(0, 0))
    let nameRoom = inner - 20
    if (m.star) {
      const star = frameOrNull('ic_star')
      if (star)
        c.add(
          scene.add
            .image(w - CARD_PAD - 16, FACE_Y, UI_ATLAS, star)
            .setOrigin(0, 0),
        )
      nameRoom -= 18
    }
    const name = addText(scene, CARD_PAD + 20, textTop(FACE_Y, 16), '', {
      tint: m.star ? STAR_TINT : THEME.textDark,
    })
    name.setText(ellipsize(m.name, nameRoom, (s) => name.setText(s).width))
    c.add(name)
    c.add(
      addText(scene, CARD_PAD, textTop(ROLE_Y, LINE), m.roleLine, {
        tint: m.star ? STAR_TINT : MUTED,
      }),
    )
    m.pips.forEach((row, k) => {
      const top = PIPS_Y + k * LINE
      c.add(
        addText(scene, CARD_PAD, textTop(top, LINE), row.label, {
          tint: MUTED,
        }),
      )
      const x = w - CARD_PAD - pipsWidth(5)
      c.add(addPips(scene, x, top + Math.floor((LINE - PIP_SIZE) / 2), row.on))
    })
    let y = PIPS_Y + m.pips.length * LINE
    c.add(fitLine(scene, CARD_PAD, textTop(y, LINE), m.numbers, inner))
    y += LINE
    if (m.extra)
      c.add(fitLine(scene, CARD_PAD, textTop(y, LINE), m.extra, inner, MUTED))
    if (m.affinity) {
      const likes = addText(scene, CARD_PAD, textTop(y, 16), 'likes', {
        tint: MUTED,
      })
      c.add(likes)
      const icon = frameOrNull(`ic_${m.affinity}`)
      if (icon)
        c.add(
          scene.add
            .image(CARD_PAD + Math.round(likes.width) + 4, y, UI_ATLAS, icon)
            .setOrigin(0, 0),
        )
    }
    c.add(fitLine(scene, CARD_PAD, textTop(MONEY_Y, LINE), m.money, inner))
  }

  /**
   * A refusal: shake the card 2 px, `ui:sfx deny`, and a ui_tooltip bubble
   * with `text` for 2 s — over the card's Hire button, or above a
   * bottom-row button.
   */
  private deny(btn: Button | null, card: CardView | null, text: string): void {
    const scene = this.scene
    scene.game.events.emit(EV_UI_SFX, { name: 'deny' })
    if (card) this.shake(card.c, card.x)
    if (!this.open) return
    this.tipTimer?.remove(false)
    this.tip?.destroy()
    const t = addText(scene, 6, 0, text, { maxWidth: 200 })
    const w = Math.round(t.width) + 12
    const h = 20
    t.setY(textTop(0, h))
    const bg = addPanel(scene, 0, 0, w, h, 'ui_tooltip')
    let cx = Math.round(this.W / 2)
    let top = HIRE_TITLE_H
    if (btn) {
      const px = card ? card.x : 0
      cx = Math.round(px + btn.x + btn.btnWidth / 2)
      top = (card ? HIRE_TITLE_H : 0) + btn.y
    }
    const x = Math.round(Math.min(this.W - 4 - w, Math.max(4, cx - w / 2)))
    // On a card's own Hire button (its pay line above stays readable), else
    // above the bottom-row button.
    const y = card
      ? top + Math.floor((HIRE_ROW_H - h) / 2)
      : Math.max(2, top - 6 - h)
    this.tip = scene.add.container(x, y, [bg, t])
    this.panel.add(this.tip)
    this.tipTimer = scene.time.delayedCall(TIP_MS, () => {
      this.tip?.destroy()
      this.tip = null
      this.tipTimer = null
    })
  }

  private shake(obj: Phaser.GameObjects.Container, x0: number): void {
    const tweens = this.scene.tweens
    if (!tweens) return
    this.stopShake()
    obj.setX(x0)
    this.shakeTween = tweens.addCounter({
      from: 0,
      to: 1,
      duration: SHAKE_MS,
      onUpdate: (tw) => {
        const v = tw.getValue() ?? 0
        obj.setX(x0 + Math.round(SHAKE_PX * Math.sin(v * Math.PI * 4)))
      },
      onComplete: () => obj.setX(x0),
      onStop: () => obj.setX(x0),
    })
  }

  private stopShake(): void {
    const tw = this.shakeTween
    this.shakeTween = null
    tw?.stop()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && claimKey(ev, this)) this.cancel()
  }
}

// ---- shared pieces (the Garage rows reuse them) ---------------------------------

/** The ic_pip frame for a lit / unlit pip, or null when the atlas lacks it. */
export function pipFrame(on: boolean): FrameName | null {
  return frameOrNull(on ? 'ic_pip_on' : 'ic_pip_off')
}

/**
 * A row of pips at (x, y) (top-left of the first 8×8 frame), 7-px pitch, in a
 * Container. Without the ic_pip frames: 6×6 squares (yellow2 / grey3).
 */
export function addPips(
  scene: Phaser.Scene,
  x: number,
  y: number,
  on: readonly boolean[],
): Phaser.GameObjects.Container {
  const parts: Phaser.GameObjects.GameObject[] = on.map((lit, i) => {
    const f = pipFrame(lit)
    if (f) return scene.add.image(i * PIP_PITCH, 0, UI_ATLAS, f).setOrigin(0, 0)
    return scene.add
      .rectangle(
        i * PIP_PITCH + 1,
        1,
        6,
        6,
        lit ? PALETTE.yellow2 : PALETTE.grey3,
      )
      .setOrigin(0, 0)
  })
  return scene.add.container(Math.round(x), Math.round(y), parts)
}

/** A one-line text ellipsized to `maxW`. */
function fitLine(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  maxW: number,
  tint: number = THEME.textDark,
): Phaser.GameObjects.BitmapText {
  const t = addText(scene, x, y, '', { tint })
  t.setText(ellipsize(text, maxW, (s) => t.setText(s).width))
  return t
}

/** Pips of a person in its role's stat order (the Garage row's compact pips). */
export function pipRows(role: Role, pips: Pips): PipRowModel[] {
  return ROLE_STATS[role].map((stat) => ({
    stat,
    label: stat,
    on: pipModel(pips[stat] ?? 0, pipMax(stat)),
  }))
}
