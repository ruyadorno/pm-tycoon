// Warehouse StationCard (spec-build2 §2.6; plan-build2 §8.3 task 5;
// design-m6 §6.2): the card of the Hold Bay station (RoomLayout
// HOLD_STATION, east of the rack), a WarehouseSheet (BuySheet.ts) with id
// `wh:station`, opened with `open()` by a tap on HOLD_STATION_HIT. The
// station takes one of: a sorter (a person, from Lv 2) or the Sorter Arm
// (machines.json upgrades, from Lv 4) — never both. Height ≤ 220.
//
//   locked     the scene shows the tooltip `Hold Bay station · Unlocks at
//              Lv 2` instead (stationLockedLine); open() is ignored
//   empty      `A sorter tosses wanted labels and obvious malware. Only you
//              Clear.` + [Hire a sorter] (the HireSheet, through the scene's
//              openHire; the card reopens when it closes) + [Buy Sorter Arm
//              $600] (lane.buyMachine('sorter_arm', hold); a `Lv 4` caption
//              and disabled below its level, `Not enough money` below its
//              price — the disabled tap explains why)
//   on duty    face · `Pat` (★) · pips (judgement, pace) · `! unpaid`, then
//              `judgement 85% · one call / 6 s · $28/day` (sorterStatsLine) —
//              these two rows are B2 §2.6's station tooltip `Pat · judgement
//              85 % · one call / 6 s · $28/day`: a station tap opens this
//              card, so no separate tooltip is drawn (docs/decisions.md),
//              [Replace] (the HireSheet: the sim fires Pat when the new one
//              is hired) [Fire] (instant, no refund)
//   walked out face (dimmed) · `Pat walked out`, the stats line muted,
//              [Re-hire $28] (salary × rehireFeeDays, §7.4) [Fire]
//   arm        `Sorter Arm · tosses every held parcel after 3 s`, `Clear a
//              parcel first to keep it`, [Remove +$300] → Dialog confirm →
//              lane.removeFixture(hold) (removalRefund × price); text only —
//              the `sorter_arm_f*` sprite lives in the room (M9 art)
//
// Every number comes from the ViewSim (holdStation, people(), data tables).
// It re-renders on worker / payroll / level / applicant events, and on
// money:changed only when the station's state changed (the Arm purchase
// emits no fixture event; a plain balance change just re-enables buttons).
// A refusal shakes the button and plays `deny`.
import type Phaser from 'phaser'
import type { GameData, UpgradeDef } from '../../data/types.ts'
import { frameOrNull } from '../../render/frames.ts'
import { SORTER_ARM_ID } from '../../sim/systems/sorter.ts'
import type {
  HoldStationView,
  PersonView,
  StatNumbers,
  ViewSim,
} from '../../sim/view-api.ts'
import type { Button } from '../Button.ts'
import { Dialog } from '../Dialog.ts'
import { formatMoney, textTop } from '../text.ts'
import { THEME } from '../theme.ts'
import {
  DIM_ALPHA,
  holdNodeId,
  MUTED,
  PAD,
  pctOf,
  PIP_SIZE,
  pipGroups,
  RED_TEXT,
  unlockText,
  WarehouseSheet,
  warehouseFailText,
  type WarehouseSheetLayout,
  type WarehouseSheetOptions,
} from './BuySheet.ts'
import {
  AWAY_ALPHA,
  FACE_SIZE,
  FACE_X,
  NAME_X,
  PERSON_ROW_H,
  PIPS_X,
  refundOf,
  rehireBlockReason,
  rehireFee,
  rehireLabel,
  sellPrompt,
} from './SlotCard.ts'

export const STATION_CARD_ID = 'wh:station'
/** design-m6 §6.2: the card never grows past this. */
export const STATION_CARD_MAX_H = 220
export const STATION_TITLE = 'Hold Bay station'
/** B2 §2.6 in one breath (the empty station's pitch). */
export const STATION_INTRO =
  'A sorter tosses wanted labels and obvious malware. Only you Clear.'
export const HIRE_SORTER = 'Hire a sorter'
/** The Arm state's second line (a player Clear wins over its 3 s). */
export const ARM_HINT = 'Clear a parcel first to keep it'

/** Geometry (sheet-local px). */
export const BODY_Y = 70
export const ROW_Y = 56
export const STATS_Y = 104
export const BTN_H = 44
export const BTN_GAP = 8
/** Header art: the sorter's idle frame (24 × 32), world atlas. */
export const HEADER_FRAME = 'worker_sorter_s_idle_0'
/** Name column of the person row (≤ 60 px incl. the ★). */
export const NAME_W = 60
/** `! unpaid` after the two pip groups (96 + 74 + 8). */
export const UNPAID_X = 178

export type StationState = 'locked' | 'empty' | 'onDuty' | 'walkedOut' | 'arm'

// ---- pure helpers ----------------------------------------------------------------

/** Which face the card shows for a HoldStationView. */
export function stationState(
  hs: Pick<HoldStationView, 'unlocked' | 'kind' | 'sorter'>,
): StationState {
  if (hs.kind === 'sorter_arm') return 'arm'
  if (hs.kind === 'sorter' && hs.sorter)
    return hs.sorter.active ? 'onDuty' : 'walkedOut'
  return hs.unlocked ? 'empty' : 'locked'
}

/** `Hold Bay station · Unlocks at Lv 2` (+ ` · coming soon` past the playtest cap). */
export function stationLockedLine(data: GameData, unlockLevel: number): string {
  return `${STATION_TITLE} · ${unlockText(data, unlockLevel)}`
}

/** `6 s`, `4.5 s` (one decimal only when needed). */
export function secondsText(s: number): string {
  const r = Math.round(s * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)} s`
}

/** `judgement 85% · one call / 6 s · $28/day` (B2 §2.6). */
export function sorterStatsLine(n: StatNumbers, salaryPerDay: number): string {
  return `judgement ${pctOf(n.correct ?? 0)} · one call / ${secondsText(n.decisionS ?? 0)} · ${formatMoney(salaryPerDay)}/day`
}

/** machines.json upgrades row of the Sorter Arm, or null. */
export function armDef(data: GameData): UpgradeDef | null {
  return data.machines.upgrades.find((u) => u.id === SORTER_ARM_ID) ?? null
}

/** `Sorter Arm · tosses every held parcel after 3 s` */
export function armLine(
  def: Pick<UpgradeDef, 'name' | 'autoTossDelayS'>,
): string {
  return `${def.name} · tosses every held parcel after ${secondsText(def.autoTossDelayS)}`
}

/** `Buy Sorter Arm $600` */
export function armBuyLabel(def: Pick<UpgradeDef, 'name' | 'price'>): string {
  return `Buy ${def.name} ${formatMoney(def.price)}`
}

/** `Remove +$300` (removalRefund × price, like a machine sale). */
export function armRemoveLabel(
  def: Pick<UpgradeDef, 'price'>,
  frac: number,
): string {
  return `Remove +${formatMoney(refundOf(def.price, frac))}`
}

/** The Arm button's caption: `Lv 4` below its level, `Not enough money` below its price. */
export function armCaption(
  def: Pick<UpgradeDef, 'unlockLevel' | 'price'>,
  level: number,
  balance: number,
): string | null {
  if (level < def.unlockLevel) return `Lv ${def.unlockLevel}`
  if (balance < def.price) return 'Not enough money'
  return null
}

/** Why Buy Sorter Arm is refused, or null (the disabled tap's tooltip). */
export function armBlockReason(
  data: GameData,
  def: Pick<UpgradeDef, 'unlockLevel' | 'price'>,
  level: number,
  balance: number,
): string | null {
  if (level < def.unlockLevel) return unlockText(data, def.unlockLevel)
  if (balance < def.price) return 'Not enough money'
  return null
}

/** What the card shows for a state (tests; the card draws the same strings). */
export interface StationModel {
  state: StationState
  title: string
  /** The muted line under the title. */
  status: string
  /** Body lines, top to bottom. */
  lines: string[]
  /** Button labels, left to right. */
  buttons: string[]
}

export function stationModel(
  data: GameData,
  hs: Pick<HoldStationView, 'unlocked' | 'unlockLevel' | 'kind' | 'sorter'>,
): StationModel {
  const state = stationState(hs)
  const arm = armDef(data)
  const p = hs.sorter
  const title = STATION_TITLE
  switch (state) {
    case 'locked':
      return {
        state,
        title,
        status: unlockText(data, hs.unlockLevel),
        lines: [stationLockedLine(data, hs.unlockLevel), STATION_INTRO],
        buttons: [],
      }
    case 'empty':
      return {
        state,
        title,
        status: 'Nobody on duty',
        lines: [STATION_INTRO],
        buttons: arm ? [HIRE_SORTER, armBuyLabel(arm)] : [HIRE_SORTER],
      }
    case 'arm':
      return {
        state,
        title,
        status: arm?.name ?? 'Sorter Arm',
        lines: arm ? [armLine(arm), ARM_HINT] : [ARM_HINT],
        buttons: arm
          ? [armRemoveLabel(arm, data.machines.removalRefund)]
          : ['Remove'],
      }
    case 'onDuty':
      return {
        state,
        title,
        status: 'Sorter on duty',
        lines: p
          ? [
              p.unpaid ? `${p.name} ! unpaid` : p.name,
              sorterStatsLine(p.numbers, p.salaryPerDay),
            ]
          : [],
        buttons: ['Replace', 'Fire'],
      }
    case 'walkedOut':
      return {
        state,
        title,
        status: 'Sorter walked out',
        lines: p
          ? [`${p.name} walked out`, sorterStatsLine(p.numbers, p.salaryPerDay)]
          : [],
        buttons: p
          ? [rehireLabel(rehireFee(data, p.salaryPerDay)), 'Fire']
          : ['Fire'],
      }
  }
}

/** Card height per state (all ≤ STATION_CARD_MAX_H). */
export function stationCardHeight(state: StationState): number {
  switch (state) {
    case 'locked':
      return BODY_Y + 44 + PAD
    case 'empty':
      // intro (2 lines) · buttons · caption
      return BODY_Y + 30 + BTN_H + 26 + PAD
    case 'arm':
      return BODY_Y + 2 * 22 + 6 + BTN_H + PAD
    case 'onDuty':
    case 'walkedOut':
      return STATS_Y + 22 + 6 + BTN_H + PAD
  }
}

// ---- the card --------------------------------------------------------------------

export class StationCard extends WarehouseSheet {
  private requested = false
  private dialog: Dialog | null = null
  private key = ''
  private armBtn: Button | null = null
  private armCap: Phaser.GameObjects.BitmapText | null = null
  private rehire: { btn: Button; fee: number } | null = null

  constructor(
    scene: Phaser.Scene,
    L: WarehouseSheetLayout,
    viewSim: ViewSim,
    opts: WarehouseSheetOptions = {},
  ) {
    super(scene, L, viewSim, {
      ...opts,
      id: STATION_CARD_ID,
      height: stationCardHeight('empty'),
    })
    const dirty = (): void => this.markDirty()
    this.bind({
      'worker:hired': dirty,
      'worker:fired': dirty,
      'worker:walkedOut': dirty,
      'payroll:paid': dirty,
      'payroll:short': dirty,
      'applicants:refreshed': dirty,
      'level:up': dirty,
      'lane:fixtureRemoved': dirty,
      'money:changed': () => this.onMoney(),
    })
  }

  /** Open on the Hold Bay station (ignored while it is locked). */
  open(): void {
    if (stationState(this.vs.holdStation) === 'locked') return
    this.requested = true
    this.show()
  }

  /** The state shown (null while closed; e2e / tests). */
  get state(): StationState | null {
    return this.isOpen() ? stationState(this.vs.holdStation) : null
  }

  override destroy(): void {
    this.dialog?.destroy()
    this.dialog = null
    super.destroy()
  }

  // ---- WarehouseSheet hooks ------------------------------------------------

  protected valid(): boolean {
    return this.requested && stationState(this.vs.holdStation) !== 'locked'
  }

  protected contentHeight(): number {
    return stationCardHeight(stationState(this.vs.holdStation))
  }

  protected closed(): void {
    this.requested = false
    this.dialog?.destroy()
    this.dialog = null
  }

  protected refresh(): void {
    if (this.stateKey() !== this.key) this.markDirty()
    else this.update()
  }

  protected build(): void {
    this.armBtn = null
    this.armCap = null
    this.rehire = null
    this.key = this.stateKey()
    const hs = this.vs.holdStation
    const state = stationState(hs)
    const m = stationModel(this.vs.data, hs)
    const art = frameOrNull(HEADER_FRAME) ?? frameOrNull('worker_s_idle_0')
    const head = art ? this.image(PAD + 4, 10, art) : null
    if (state !== 'onDuty') head?.setAlpha(DIM_ALPHA)
    this.text(40, textTop(16, 20), m.title)
    this.text(40, textTop(36, 20), m.status, MUTED)
    if (state === 'empty') this.buildEmpty()
    else if (state === 'arm') this.buildArm()
    else if (hs.sorter) this.buildSorter(hs.sorter, state === 'onDuty')
    this.update()
  }

  // ---- states -------------------------------------------------------------------

  private buildEmpty(): void {
    const W = this.L.W
    this.text(
      PAD + 4,
      BODY_Y - 6,
      STATION_INTRO,
      THEME.textDark,
      W - 2 * PAD - 8,
    )
    const by = BODY_Y + 30
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    const hire: Button = this.button(PAD, by, bw, BTN_H, {
      id: 'station:hire',
      label: HIRE_SORTER,
      face: 'primary',
      onClick: () => this.hire(HIRE_SORTER, hire),
    })
    const def = armDef(this.vs.data)
    if (!def) return
    const ax = W - PAD - bw
    const arm: Button = this.button(ax, by, bw, BTN_H, {
      id: 'station:buyArm',
      label: armBuyLabel(def),
      onClick: () => this.buyArm(arm),
      onDisabledTap: () =>
        this.deny(
          arm,
          armBlockReason(this.vs.data, def, this.vs.level, this.vs.money) ??
            warehouseFailText('invalid'),
        ),
    })
    this.armBtn = arm
    this.armCap = this.text(ax + 4, textTop(by + BTN_H + 2, 20), '', RED_TEXT)
  }

  private buildArm(): void {
    const W = this.L.W
    const data = this.vs.data
    const def = armDef(data)
    let y = BODY_Y
    if (def) this.text(PAD + 4, textTop(y, 20), armLine(def))
    y += 22
    this.text(PAD + 4, textTop(y, 20), ARM_HINT, MUTED)
    y += 22 + 6
    if (!def) return
    const frac = data.machines.removalRefund
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    const remove: Button = this.button(W - PAD - bw, y, bw, BTN_H, {
      id: 'station:removeArm',
      label: armRemoveLabel(def, frac),
      face: 'red',
      onClick: () => this.confirmRemove(def, frac, remove),
    })
  }

  private buildSorter(p: PersonView, onDuty: boolean): void {
    const W = this.L.W
    const ty = textTop(ROW_Y, PERSON_ROW_H)
    const face = this.face(
      FACE_X,
      ROW_Y + Math.floor((PERSON_ROW_H - FACE_SIZE) / 2),
      p.look,
    )
    if (onDuty) {
      this.personName(NAME_X, ty, p.name, p.star, NAME_W)
      this.pips(
        PIPS_X,
        ROW_Y + Math.floor((PERSON_ROW_H - PIP_SIZE) / 2),
        pipGroups(this.vs.data, 'sorter', p.pips),
      )
      if (p.unpaid) this.text(UNPAID_X, ty, '! unpaid', RED_TEXT)
    } else {
      face?.setAlpha(AWAY_ALPHA)
      this.text(NAME_X, ty, `${p.name} walked out`, MUTED)
    }
    this.text(
      PAD + 4,
      textTop(STATS_Y, 20),
      sorterStatsLine(p.numbers, p.salaryPerDay),
      onDuty ? THEME.textDark : MUTED,
    )
    const by = STATS_Y + 22 + 6
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    if (onDuty) {
      const replace: Button = this.button(PAD, by, bw, BTN_H, {
        id: 'station:replace',
        label: 'Replace',
        face: 'primary',
        onClick: () => this.hire(`Replace ${p.name}`, replace),
      })
    } else {
      const fee = rehireFee(this.vs.data, p.salaryPerDay)
      const rehire: Button = this.button(PAD, by, bw, BTN_H, {
        id: `station:rehire:${p.id}`,
        label: rehireLabel(fee),
        face: 'primary',
        onClick: () => this.rehireSorter(p.id, rehire),
        onDisabledTap: () =>
          this.deny(
            rehire,
            rehireBlockReason(this.vs.money, fee) ??
              warehouseFailText('invalid'),
          ),
      })
      this.rehire = { btn: rehire, fee }
    }
    const fire: Button = this.button(W - PAD - bw, by, bw, BTN_H, {
      id: `station:fire:${p.id}`,
      label: 'Fire',
      face: 'red',
      onClick: () => {
        const res = this.vs.fire(p.id)
        if (!res.ok) this.denyResult(fire, res)
        this.markDirty()
      },
    })
  }

  // ---- live state -----------------------------------------------------------------

  /** What forces a rebuild: the state, the seated person, its pay and the Arm's level gate. */
  private stateKey(): string {
    const hs = this.vs.holdStation
    const p = hs.sorter
    const def = armDef(this.vs.data)
    const armOpen = def ? this.vs.level >= def.unlockLevel : false
    return `${stationState(hs)}|${p?.id ?? '-'}|${p?.active ?? '-'}|${p?.unpaid ?? '-'}|${armOpen}`
  }

  private onMoney(): void {
    if (!this.isOpen()) return
    if (this.stateKey() !== this.key) this.markDirty()
    else this.update()
  }

  /** Buttons that depend on the balance / level (no rebuild). */
  private update(): void {
    const r = this.rehire
    if (r) r.btn.setEnabled(rehireBlockReason(this.vs.money, r.fee) === null)
    const b = this.armBtn
    const cap = this.armCap
    const def = armDef(this.vs.data)
    if (!b || !def) return
    const why = armCaption(def, this.vs.level, this.vs.money)
    b.setEnabled(why === null)
    const s = why ?? ''
    if (cap && cap.text !== s) cap.setText(s)
    // the level tag is information (muted); the balance is a problem (red)
    cap?.setTint(this.vs.level < def.unlockLevel ? MUTED : RED_TEXT)
  }

  // ---- actions ------------------------------------------------------------------

  /** The HireSheet for the station (the scene's); the card reopens after it. */
  private hire(title: string, btn: Button): void {
    const back = (): void => this.open()
    this.requestHire(
      {
        role: 'sorter',
        target: { station: 'hold' },
        title,
        onDone: back,
        onCancel: back,
      },
      btn,
    )
  }

  private rehireSorter(employeeId: number, btn: Button): void {
    const res = this.vs.lane.rehire(employeeId)
    if (!res.ok) this.denyResult(btn, res)
    this.markDirty()
  }

  private buyArm(btn: Button): void {
    const res = this.vs.lane.buyMachine(SORTER_ARM_ID, holdNodeId(this.vs))
    if (!res.ok) this.denyResult(btn, res)
    this.markDirty()
  }

  private confirmRemove(
    def: Pick<UpgradeDef, 'name' | 'price'>,
    frac: number,
    btn: Button,
  ): void {
    this.dialog?.destroy()
    this.dialog = new Dialog(this.scene, {
      title: `Remove ${def.name}`,
      text: sellPrompt(def.price, frac),
      action: 'Remove',
      destructive: true,
      W: this.L.W,
      H: this.L.H,
      minHit: this.L.minHit,
      id: 'station:removeDialog',
      onConfirm: () => {
        this.dialog = null
        const res = this.vs.lane.removeFixture(holdNodeId(this.vs))
        if (!res.ok) this.denyResult(btn, res)
        this.markDirty()
      },
      onCancel: () => {
        this.dialog = null
      },
    })
  }
}
