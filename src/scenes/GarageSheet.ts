// GarageSheet `Garage` (city-view.md §7, §6.2, §11.2; plan.md §9; spec §4.1,
// §7.3-§7.4): the overlay scene launched above City/Warehouse + HUD and
// slept when closed (so the list scroll survives). One Sheet that fits its
// rows (report-playtest1 §6.14: the fixed max(320, round(H × 0.6)) left a
// ~380-px empty list at 430×932): header + one 56-px pitch per vehicle (at
// least one, for the empty state) + the buy block, capped at that old height
// (the list scrolls past it); a buy or a sale re-fits it in place:
//   header (56)  `Garage · Fleet 3` / `Payday in 0:23`, then
//                `Payroll $44/day` (red after a short payday) ·
//                `Lane 15/min · Detection 97%` (the % in the §6.3 colours)
//   fleet list   clipped by the Sheet's list camera, 56-px rows of three
//                14-px lines (M6, spec-build2 §2.5, design-m6 §6.3): type
//                icon; `Bike 1` | the §4.6 state text; the driver's name
//                (gold + ic_star for a ★; red `Dee left` after a walkout,
//                red `No driver` while a driverless vehicle still finishes
//                its trip) | units `3/4`; then the compact pips (speed,
//                energy, charisma — ic_pip_on/off, 7-px pitch), the
//                affinity's ic_<type> and `$8/day` (red `! unpaid` after a
//                short payday, `→ Rae after this trip` while a Replace
//                waits); the zone chip `Any ▾` (→ ZonePicker); the action
//                slot: the `···` button (44×44, at the row's right edge) on
//                every row, opening a popover that lists the row's primary
//                action first — `Hire driver` (no driver → HireSheet) /
//                Sell; `Re-hire $8` (walked out → rehireDriver, toast `Dee is
//                back — Bike 2 on the road`; not offered while a Replace
//                waits, the swap lets that driver go) / Fire / Sell; else
//                `Replace driver` (→ HireSheet; the swap waits for the trip)
//                / `Fire driver` (→ Dialog) / `Sell $100` (→ Dialog;
//                disabled on the last vehicle with the tip `Keep at least
//                one vehicle`) — so Sell stays reachable on a driverless
//                row (D16, M6 integration);
//                row tap → pm:panTo {vehicleId}, double-tap → pm:follow +
//                close; empty state `Buy your first vehicle below`
//   buy cards    one per vehicles.json type: sprite, name, price (red when
//                unaffordable), `4 units · S M`, `$8/day`, speed pips;
//                locked types greyed `Unlocks at Lv 2`; tap → the HireSheet
//                `Who drives the Bike?` (three driver applicants priced for
//                that class + `Hire later`) → buyVehicle(type, id | null)
//                → toast `Bike 2 bought — Dee hired` / `Bike 2 bought — no
//                driver yet` + ui:sfx buy
//   footer       `Sold vehicles refund 50%. Drivers are paid every day (60 s).`
// Every number comes from the data tables or the ViewSim. Sim events only
// mark the view dirty (bindSim: attached while awake); the header and row
// states are also re-read at 4 Hz while open (payday countdown, cargo).
// `toggleGarage(from)` is the one entry point (HUD button, G key, the
// district panel's `Garage ▸`).
import Phaser from 'phaser'
import { EV_GARAGE_OPENING } from '../boot/nav.ts'
import { bindSim, getViewSim, REG } from '../boot/simBinding.ts'
import type { GameData, VehicleTypeDef } from '../data/types.ts'
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX } from '../input/GestureClassifier.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull, type FrameName } from '../render/frames.ts'
import type { CommandResult } from '../sim/commands.ts'
import { SIM_FEATURES } from '../sim/features.ts'
import type { Size, VehicleType } from '../sim/types.ts'
import type { PersonView, VehicleSnapshot, ViewSim } from '../sim/view-api.ts'
import { Button, TAP_PX } from '../ui/Button.ts'
import { Dialog } from '../ui/Dialog.ts'
import {
  buyNote,
  buyTitle,
  HireSheet,
  PIP_PITCH,
  PIP_SIZE,
  pipFrame,
  pipRows,
  pipsWidth,
  STAR_TINT,
  type HireSheetTarget,
  type PipRowModel,
} from '../ui/HireSheet.ts'
import { minHitFor, type Rect } from '../ui/layout.ts'
import { addBar, addPanel, BAR_H } from '../ui/Panel.ts'
import { claimKey, popModal, pushModal, Sheet } from '../ui/Sheet.ts'
import { detectionTone, laneRateText, TONE_TEXT } from '../ui/ShieldPopover.ts'
import {
  addText,
  ellipsize,
  formatClock,
  formatMoney,
  formatPct,
  textTop,
} from '../ui/text.ts'
import { EV_TOAST } from '../ui/Toast.ts'
import { PALETTE, THEME } from '../ui/theme.ts'
import {
  EV_UI_SFX,
  EV_UI_TAP,
  failText,
  placePopover,
  PopoverLayer,
  zoneChipText,
  ZonePicker,
} from '../ui/ZonePicker.ts'

export const GARAGE_KEY = 'Garage'
export const GARAGE_SHEET_ID = 'garage'
export const EV_PAN_TO = 'pm:panTo'
export const EV_FOLLOW = 'pm:follow'

export const HEADER_H = 56
export const ROW_PITCH = 56
/** Buy cards + footer block at the bottom of the sheet (above safeBottom). */
export const BOTTOM_H = 120
export const CARD_H = 88
export const CARD_GAP = 8
export const CARD_MAX_W = 120
const MARGIN = 12
/** The buy card's sprite box (card-local); the name column starts at 58. */
const SPRITE_BOX = { x: 6, y: 4, w: 48, h: 32 }
/** The fleet row's icon column centre (a 16-px icon spans 20..36). */
const ICON_CX = 28

/** The most the sheet takes (city-view §7's height, now the cap). */
export function garageSheetHeight(H: number): number {
  return Math.max(320, Math.round(H * 0.6))
}

/** Air under the last fleet row (the list's content height is n × 56 + 4). */
export const LIST_PAD = 4

/**
 * Fleet list viewport height: the rows (`rows` vehicles, at least one pitch
 * for the empty state), at most cap − header − buy block − safe area;
 * without `rows`, that maximum.
 */
export function garageListHeight(
  H: number,
  safeBottom = 0,
  rows?: number,
): number {
  const max = Math.max(
    ROW_PITCH,
    garageSheetHeight(H) - HEADER_H - BOTTOM_H - Math.max(0, safeBottom),
  )
  if (rows === undefined) return max
  return Math.min(max, Math.max(1, rows) * ROW_PITCH + LIST_PAD)
}

/** The sheet height that fits `rows` fleet rows (header, list, buy block). */
export function garageFitHeight(
  H: number,
  safeBottom: number,
  rows: number,
): number {
  return (
    HEADER_H +
    garageListHeight(H, safeBottom, rows) +
    BOTTOM_H +
    Math.max(0, safeBottom)
  )
}

/**
 * Where a type's frame sits in its buy card's 48×32 sprite box (card-local):
 * centred across, bottom-aligned, from the frame's real size (the bike canvas
 * grew from 24² to 32², plan-build2 §8.2 task 5) — never left of the box.
 */
export function cardSpritePos(w: number, h: number): { x: number; y: number } {
  return {
    x: SPRITE_BOX.x + Math.max(0, Math.round((SPRITE_BOX.w - w) / 2)),
    y: SPRITE_BOX.y + Math.max(0, SPRITE_BOX.h - Math.round(h)),
  }
}

/** The row's type icon, centred on its column from the frame's real size. */
export function rowIconPos(w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(MARGIN + 2, Math.round(ICON_CX - w / 2)),
    y: Math.floor((ROW_PITCH - Math.round(h)) / 2),
  }
}

// ---- pure model --------------------------------------------------------------

function typeDef(data: GameData, type: VehicleType): VehicleTypeDef | null {
  return data.vehicles.types.find((t) => t.id === type) ?? null
}

/** Sell refund: vehicles.json price × economy.sellRefund (spec §4.1). */
export function sellRefund(data: GameData, type: VehicleType): number {
  const def = typeDef(data, type)
  return def ? Math.round(def.price * data.economy.sellRefund) : 0
}

/**
 * Re-hire fee: one day's salary × employees.rehireFeeDays (spec §7.4) — the
 * walked-out driver's own salary (M6: pips set it), else the class base.
 */
export function rehireCost(
  data: GameData,
  type: VehicleType,
  salaryPerDay: number | null = null,
): number {
  const day = salaryPerDay ?? typeDef(data, type)?.driverSalaryPerDay ?? 0
  return day * data.employees.rehireFeeDays
}

/** §4.6 state text (the follow strip's words, without the stops count). */
export function stateText(
  v: Pick<VehicleSnapshot, 'state' | 'queuePos'>,
): string {
  switch (v.state) {
    case 'idle_lot':
      return 'Idle'
    case 'queued':
      return v.queuePos === null ? 'Queued' : `Queued #${v.queuePos + 1}`
    case 'docked_unloading':
      return 'Unloading'
    case 'docked_loading':
      return 'Loading'
    case 'delivering':
      return 'Delivering'
    case 'collecting':
      return 'Collecting'
    case 'returning':
      return 'Returning'
    case 'inactive':
      return 'No driver'
  }
}

/** `3 stops` / `1 stop` */
export function stopsText(n: number): string {
  return `${n} stop${n === 1 ? '' : 's'}`
}

/** Cargo units used / capacity: `3/4`. */
export function unitsText(
  v: Pick<VehicleSnapshot, 'unitsUsed' | 'capacityUnits'>,
): string {
  return `${v.unitsUsed}/${v.capacityUnits}`
}

/**
 * The two status lines for a column `maxW` px wide: `Delivering · 3 stops`
 * over `3/4` when it fits, else `Delivering` over `3/4 · 3 stops`
 * (ellipsized as a last resort).
 */
export function statusLines(
  v: Pick<
    VehicleSnapshot,
    'state' | 'queuePos' | 'stopsLeft' | 'unitsUsed' | 'capacityUnits'
  >,
  maxW: number,
  measure: (s: string) => number,
): [string, string] {
  const state = stateText(v)
  const units = unitsText(v)
  if (v.state === 'delivering' && v.stopsLeft > 0) {
    const stops = stopsText(v.stopsLeft)
    const full = `${state} · ${stops}`
    if (measure(full) <= maxW) return [full, units]
    return [
      ellipsize(state, maxW, measure),
      ellipsize(`${units} · ${stops}`, maxW, measure),
    ]
  }
  if (v.state === 'inactive') return [ellipsize(state, maxW, measure), '']
  return [ellipsize(state, maxW, measure), units]
}

/**
 * Driver name line (the row's second line, name column): the active
 * driver's name; red `Dee left` after a walkout (the row's alert state, like
 * the `!` badge — naming who left says who the `Re-hire` button brings
 * back; UX M3 review); red `No driver` with none (M6: a Hire later, a
 * fired driver). The pay, `! unpaid` and a waiting Replace moved to the
 * third line (driverRow).
 */
export function driverLine(
  v: Pick<VehicleSnapshot, 'driverName'>,
  _data: GameData,
  walkedOut: string | null = null,
): { text: string; red: boolean } {
  if (v.driverName === null)
    return { text: walkedOut ? `${walkedOut} left` : 'No driver', red: true }
  return { text: v.driverName, red: false }
}

/** The row's driver block (lines 2-3) for the M6 Garage row. */
export interface DriverRowModel {
  /** Line 2, name column: driverLine (empty for a parked driverless vehicle). */
  name: string
  nameRed: boolean
  /** ★ applicant hired: gold name + ic_star after it. */
  star: boolean
  /** Line 3: speed / energy / charisma pips; null without a driver. */
  pips: PipRowModel[] | null
  /** The pips of a walked-out driver read dimmed. */
  dim: boolean
  /** Driver affinity shown as ic_<type> after the pips; null for none. */
  affinity: VehicleType | null
  /** Line 3 tail, longest first: the first that fits is shown (fitTail). */
  tail: string[]
  tailRed: boolean
}

type DriverRowVehicle = Pick<
  VehicleSnapshot,
  | 'type'
  | 'state'
  | 'driverName'
  | 'driverId'
  | 'driverPips'
  | 'driverStar'
  | 'driverAffinity'
  | 'nextDriverName'
  | 'unpaid'
>

/**
 * Lines 2-3 of a fleet row (spec-build2 §2.5, design-m6 §6.3: `Dee ★ ●●●●○
 * ●●●○○ ●○` + ic_<affinity> + `· $8/day`, `→ Rae after this trip` while a
 * Replace waits). `driver` = the vehicle's driver (active or walked out),
 * for its name and salary; the class base pays when it is unknown.
 */
export function driverRow(
  v: DriverRowVehicle,
  driver: Pick<PersonView, 'name' | 'salaryPerDay'> | null,
  data: GameData,
): DriverRowModel {
  const none = v.driverId === null || (!driver && v.driverName === null)
  if (none) {
    // The status column already reads `No driver` for a parked vehicle.
    const parked = v.state === 'inactive'
    return {
      name: parked ? '' : 'No driver',
      nameRed: true,
      star: false,
      pips: null,
      dim: false,
      affinity: null,
      tail: [],
      tailRed: false,
    }
  }
  const walkedOut = v.driverName === null
  const line = driverLine(v, data, driver?.name ?? null)
  const pay =
    driver?.salaryPerDay ?? typeDef(data, v.type)?.driverSalaryPerDay ?? 0
  let tail = [`${formatMoney(pay)}/day`, formatMoney(pay)]
  let tailRed = false
  if (v.unpaid && !walkedOut) {
    tail = ['! unpaid', '!']
    tailRed = true
  } else if (v.nextDriverName !== null) {
    const n = v.nextDriverName
    tail = [`→ ${n} after this trip`, `→ ${n} next trip`, `→ ${n}`]
  }
  return {
    name: line.text,
    nameRed: line.red,
    star: v.driverStar,
    pips: v.driverPips ? pipRows('driver', v.driverPips) : null,
    dim: walkedOut,
    affinity:
      v.driverAffinity && v.driverAffinity !== 'none' ? v.driverAffinity : null,
    tail,
    tailRed,
  }
}

/** The first candidate that fits `maxW`, else the last one ellipsized ('' if none). */
export function fitTail(
  tail: readonly string[],
  maxW: number,
  measure: (s: string) => number,
): string {
  for (const s of tail) if (measure(s) <= maxW) return s
  const last = tail[tail.length - 1]
  return last === undefined || maxW <= 0 ? '' : ellipsize(last, maxW, measure)
}

/** Line 3 geometry (row-local x): pips per stat, the affinity icon, the tail. */
export function driverLineLayout(
  rows: readonly Pick<PipRowModel, 'on'>[],
  affinity: boolean,
  endX: number,
): { pipX: number[]; iconX: number | null; tailX: number; tailW: number } {
  const pipX: number[] = []
  let x = NAME_X
  for (const r of rows) {
    pipX.push(x)
    x += pipsWidth(r.on.length) + PIP_GROUP_GAP
  }
  let iconX: number | null = null
  if (affinity) {
    iconX = x
    x += 16 + PIP_GROUP_GAP
  }
  return { pipX, iconX, tailX: x, tailW: Math.max(0, endX - x) }
}

export interface RowAction {
  /**
   * The row's primary action — hire: `Hire driver`; rehire: `Re-hire $8`;
   * more: none (Replace / Fire / Sell). The slot always shows the `···`
   * popover; a hire / rehire row lists its primary action first there.
   */
  kind: 'hire' | 'rehire' | 'more'
  label: string
  enabled: boolean
  /** Tooltip shown on a tap while disabled. */
  tip: string | null
}

/** The `···` button's (screen-reader / e2e) label; the face draws three dots. */
export const MORE_LABEL = '···'

/**
 * The row's primary action (design-m6 §6.3): `Hire driver` on a vehicle with
 * no driver at all (Hire later, a fired driver); `Re-hire $8` once the driver
 * has walked out — parked inactive or still finishing its trip (spec §7.4:
 * re-hire is immediate; the fee is that driver's own day of pay) — enabled
 * once the payroll system ships; else `more` (Replace / Fire / Sell). A
 * walked-out driver whose Replace already waits (`nextDriverName`) gets no
 * Re-hire: the swap lets them go anyway, so the fee would be wasted (the
 * sim refuses it too, payroll.ts rehire). The slot is the `···` popover on
 * every row (menuItems puts a hire / rehire first), so Sell — and Fire for
 * a walked-out driver — stay reachable on a driverless row (M6
 * integration). A snapshot without `driverId` (pre-M6 callers) reads as
 * walked out.
 */
export function rowAction(
  v: Pick<VehicleSnapshot, 'state' | 'type'> &
    Partial<
      Pick<VehicleSnapshot, 'driverName' | 'driverId' | 'nextDriverName'>
    >,
  data: GameData,
  _fleetSize: number,
  rehireEnabled: boolean,
  driverSalary: number | null = null,
): RowAction {
  const replacing = v.nextDriverName != null
  if (!replacing && (v.driverName === null || v.state === 'inactive')) {
    if (v.driverId === null)
      return { kind: 'hire', label: 'Hire driver', enabled: true, tip: null }
    return {
      kind: 'rehire',
      label: `Re-hire ${formatMoney(rehireCost(data, v.type, driverSalary))}`,
      enabled: rehireEnabled,
      tip: rehireEnabled ? null : 'Not available yet',
    }
  }
  return { kind: 'more', label: MORE_LABEL, enabled: true, tip: null }
}

/**
 * `Sell $100`, disabled on the last vehicle while vehicles.json
 * lastVehicleUnsellable (tip `Keep at least one vehicle`).
 */
export function sellAction(
  v: Pick<VehicleSnapshot, 'type'>,
  data: GameData,
  fleetSize: number,
): { label: string; enabled: boolean; tip: string | null } {
  const last = data.vehicles.lastVehicleUnsellable && fleetSize <= 1
  return {
    label: `Sell ${formatMoney(sellRefund(data, v.type))}`,
    enabled: !last,
    tip: last ? 'Keep at least one vehicle' : null,
  }
}

export interface MenuItem {
  kind: 'hire' | 'rehire' | 'replace' | 'fire' | 'sell'
  label: string
  enabled: boolean
  tip: string | null
}

/**
 * The `···` popover (design-m6 §6.3, D16) for the row's primary action
 * (rowAction): a driven row → Replace driver / Fire driver / Sell; a
 * walked-out driver → Re-hire $N / Fire driver / Sell; no driver at all
 * (Hire later, a fire) → Hire driver / Sell.
 */
export function menuItems(
  v: Pick<VehicleSnapshot, 'type'>,
  data: GameData,
  fleetSize: number,
  primary: RowAction | null = null,
): MenuItem[] {
  const sell: MenuItem = { kind: 'sell', ...sellAction(v, data, fleetSize) }
  const fire: MenuItem = {
    kind: 'fire',
    label: 'Fire driver',
    enabled: true,
    tip: null,
  }
  if (primary?.kind === 'hire') return [{ ...primary, kind: 'hire' }, sell]
  if (primary?.kind === 'rehire')
    return [{ ...primary, kind: 'rehire' }, fire, sell]
  return [
    { kind: 'replace', label: 'Replace driver', enabled: true, tip: null },
    fire,
    sell,
  ]
}

/** `Garage · Fleet 3` */
export function fleetTitle(n: number): string {
  return `Garage · Fleet ${n}`
}

/** `Payday in 0:23` from ViewSim.ticksToPayday (10 ticks/s). */
export function paydayText(ticksToPayday: number, ticksPerS = 10): string {
  return `Payday in ${formatClock(ticksToPayday / ticksPerS)}`
}

/** `Payroll $44/day` */
export function payrollText(perDay: number): string {
  return `Payroll ${formatMoney(perDay)}/day`
}

const SIZE_ORDER: readonly Size[] = ['S', 'M', 'L', 'XL']

/**
 * `4 units · S M`; `compact` writes a contiguous run of 3+ sizes as a
 * range (`32 units · S–XL`) for narrow cards.
 */
export function capacityText(
  def: Pick<VehicleTypeDef, 'capacityUnits' | 'sizes'>,
  compact = false,
): string {
  const sizes = SIZE_ORDER.filter((s) => def.sizes.includes(s))
  let list = sizes.join(' ')
  if (compact && sizes.length > 2) {
    const first = SIZE_ORDER.indexOf(sizes[0] as Size)
    const last = SIZE_ORDER.indexOf(sizes[sizes.length - 1] as Size)
    if (last - first + 1 === sizes.length)
      list = `${sizes[0]}–${sizes[sizes.length - 1]}`
  }
  return `${def.capacityUnits} units · ${list}`
}

/** Speed pips 1..n: the type's rank by speedTilesPerS (display only). */
export function speedPips(
  types: readonly Pick<VehicleTypeDef, 'id' | 'speedTilesPerS'>[],
  id: string,
): number {
  const me = types.find((t) => t.id === id)
  if (!me) return 0
  const speeds = [...new Set(types.map((t) => t.speedTilesPerS))].toSorted(
    (a, b) => a - b,
  )
  return speeds.indexOf(me.speedTilesPerS) + 1
}

export interface BuyCardModel {
  type: VehicleType
  name: string
  price: number
  priceText: string
  capacity: string
  capacityCompact: string
  salaryText: string
  pips: number
  maxPips: number
  locked: boolean
  unlockLevel: number
  lockText: string
  affordable: boolean
  enabled: boolean
}

/** One buy card per vehicles.json type (city-view §7.3). */
export function buyCards(
  data: GameData,
  money: number,
  level: number,
): BuyCardModel[] {
  const types = data.vehicles.types
  const maxPips = new Set(types.map((t) => t.speedTilesPerS)).size
  return types.map((t) => {
    const locked = t.unlockLevel > level
    const affordable = money >= t.price
    return {
      type: t.id,
      name: t.name,
      price: t.price,
      priceText: formatMoney(t.price),
      capacity: capacityText(t),
      capacityCompact: capacityText(t, true),
      salaryText: `${formatMoney(t.driverSalaryPerDay)}/day`,
      pips: speedPips(types, t.id),
      maxPips,
      locked,
      unlockLevel: t.unlockLevel,
      lockText: `Unlocks at Lv ${t.unlockLevel}`,
      affordable,
      enabled: !locked && affordable,
    }
  })
}

/** `Bike 2 bought — Dee hired` / `Bike 2 bought — no driver yet` (Hire later). */
export function boughtToast(name: string, driverName: string | null): string {
  return driverName
    ? `${name} bought — ${driverName} hired`
    : `${name} bought — no driver yet`
}

/** After a Replace / Hire driver: `Rae takes over Bike 2 after this trip` or `Rae now drives Bike 2`. */
export function driveToast(
  driverName: string,
  vehicleName: string,
  pending: boolean,
): string {
  return pending
    ? `${driverName} takes over ${vehicleName} after this trip`
    : `${driverName} now drives ${vehicleName}`
}

/** HireSheet title for a Replace: `Replace Dee · Bike 2`. */
export function replaceTitle(driverName: string, vehicleName: string): string {
  return `Replace ${driverName} · ${vehicleName}`
}

/** HireSheet title for a driverless vehicle: `Driver for Bike 2`. */
export function driverForTitle(vehicleName: string): string {
  return `Driver for ${vehicleName}`
}

/**
 * The Fire dialog's line (design-m6 §4.5): a waiting Replace takes over at
 * once; a moving vehicle finishes its trip, then parks `No driver`.
 */
export function firePrompt(
  driverName: string,
  v: Pick<VehicleSnapshot, 'name' | 'state' | 'nextDriverName'>,
): string {
  if (v.nextDriverName)
    return `Fire ${driverName}? ${v.nextDriverName} takes over ${v.name} now.`
  if (v.state === 'idle_lot' || v.state === 'inactive')
    return `Fire ${driverName}? ${v.name} parks with no driver.`
  return `Fire ${driverName}? ${v.name} finishes its trip, then parks.`
}

/** After a Fire, from the vehicle as it is now. */
export function firedToast(
  driverName: string,
  v: Pick<VehicleSnapshot, 'name' | 'state' | 'driverName'> | null,
): string {
  if (!v) return `${driverName} fired`
  if (v.driverName)
    return `${driverName} fired — ${v.driverName} now drives ${v.name}`
  if (v.state === 'inactive')
    return `${driverName} fired — ${v.name} has no driver`
  return `${driverName} fired — ${v.name} parks after this trip`
}

/** `Dee is back — Bike 2 on the road` after a re-hire (spec §7.4). */
export function rehiredToast(name: string, driverName: string | null): string {
  return driverName
    ? `${driverName} is back — ${name} on the road`
    : `${name} re-hired`
}

/** The disabled buy card's toast. */
export function buyDeniedToast(card: BuyCardModel): string {
  if (card.locked) return `${card.name} — unlocks at Lv ${card.unlockLevel}`
  return `Not enough money — ${card.name} costs ${card.priceText}`
}

/** `Sell Bike 2 for $100? Its parcels go back to the warehouse.` (outbound cargo to the shelf, uninspected cargo through the lane — docs/decisions.md) */
export function sellPrompt(name: string, refund: number): string {
  return `Sell ${name} for ${formatMoney(refund)}? Its parcels go back to the warehouse.`
}

/** `Sold vehicles refund 50%. Drivers are paid every day (60 s).` */
export function footerText(data: GameData): string {
  const pct = Math.round(data.economy.sellRefund * 100)
  return `Sold vehicles refund ${pct}%. Drivers are paid every day (${data.employees.payrollIntervalS} s).`
}

/** Buy card width: three cards with 8-px gaps inside W − 24, at most 120. */
export function cardWidth(W: number, n = 3): number {
  return Math.min(
    CARD_MAX_W,
    Math.floor((W - 2 * MARGIN - (n - 1) * CARD_GAP) / Math.max(1, n)),
  )
}

/**
 * Row geometry (list-local x) for a canvas W px wide: the 44-px `···` action
 * slot at the right edge, the zone chip 4 px left of it.
 */
export function rowColumns(W: number): {
  actionX: number
  zoneX: number
  statusX: number
  statusW: number
  nameX: number
  nameW: number
} {
  const actionX = W - MARGIN - ROW_PAD_R - MORE_W
  const zoneX = actionX - 4 - ZONE_W
  const statusX = STATUS_X
  return {
    actionX,
    zoneX,
    statusX,
    statusW: zoneX - 4 - statusX,
    nameX: NAME_X,
    nameW: statusX - 4 - NAME_X,
  }
}

// ---- toggle entry point ------------------------------------------------------

/**
 * Open the Garage (launch the first time, wake it when asleep, bring it to
 * the top) or close it when open. Safe to call twice in one frame.
 */
export function toggleGarage(from: Phaser.Scene): void {
  const sp = from.scene
  const g = sp.get(GARAGE_KEY) as GarageSheet | null
  if (!g) return
  if (g.pending) return
  if (sp.isActive(GARAGE_KEY)) {
    if (!g.garageSheet?.isOpen()) from.game.events.emit(EV_GARAGE_OPENING)
    g.toggleSheet()
    return
  }
  from.game.events.emit(EV_GARAGE_OPENING)
  g.pending = true
  if (sp.isSleeping(GARAGE_KEY)) sp.wake(GARAGE_KEY)
  else sp.launch(GARAGE_KEY)
  sp.bringToTop(GARAGE_KEY)
}

// ---- the scene ---------------------------------------------------------------

const ROW_PAD_R = 6
const NAME_X = 42
const STATUS_X = 120
/**
 * The zone chip's width: the longest label (`Downtown ▾`, 60 px in m5x7)
 * needs Button.CONTENT_PAD (5) of air on each side (UX M3 review).
 */
export const ZONE_W = 70
/** The `···` button (design-m6 §6.3: 44×44), right-aligned in the action slot. */
export const MORE_W = 44
const ZONE_H = 28
/** Header text bands (16 px). */
const LINE_BAND = 16
/** Row text bands (row-local tops, 14 px each, inside the 52-px row panel). */
export const ROW_LINE_Y = [5, 20, 35] as const
const ROW_BAND = 14
/** Gap between pip groups, the affinity icon and the tail on line 3. */
const PIP_GROUP_GAP = 4
const REFRESH_MS = 250
const TIP_MS = 2000
const MUTED = PALETTE.grey1
const RED = PALETTE.red0
const PIP_W = 8
const PIP_GAP = 2
/** The popover's rows (44-px buttons, 2-px gaps, 4-px padding). */
export const MENU_W = 148
const MENU_PAD = 4
const MENU_ROW_H = 44
const MENU_GAP = 2

/** The `···` popover height for `n` items. */
export function menuHeight(n: number): number {
  return 2 * MENU_PAD + n * MENU_ROW_H + Math.max(0, n - 1) * MENU_GAP
}

interface RowView {
  id: number
  c: Phaser.GameObjects.Container
  icon: Phaser.GameObjects.Image
  name: Phaser.GameObjects.BitmapText
  driver: Phaser.GameObjects.BitmapText
  star: Phaser.GameObjects.Image | null
  status1: Phaser.GameObjects.BitmapText
  status2: Phaser.GameObjects.BitmapText
  /** Line 3: speed / energy / charisma pip images (5 + 5 + 2). */
  pips: Phaser.GameObjects.GameObject[][]
  affinity: Phaser.GameObjects.Image
  tail: Phaser.GameObjects.BitmapText
  zone: Button
  action: Button
  /** The three dots drawn on the `···` face. */
  dots: Phaser.GameObjects.Rectangle[]
  actionKind: RowAction['kind']
  tip: string | null
  tipBox: Phaser.GameObjects.Container | null
  tipTimer: Phaser.Time.TimerEvent | null
  down: boolean
  lastTap: { t: number; x: number; y: number } | null
}

interface CardView {
  type: VehicleType
  btn: Button
  sprite: Phaser.GameObjects.Image
  name: Phaser.GameObjects.BitmapText
  price: Phaser.GameObjects.BitmapText
  capacity: Phaser.GameObjects.BitmapText
  salary: Phaser.GameObjects.BitmapText
  pips: Phaser.GameObjects.NineSlice[]
  lock: Phaser.GameObjects.BitmapText
  model: BuyCardModel
}

export class GarageSheet extends Phaser.Scene {
  /** True while toggleGarage's launch/wake is queued (scene ops run next frame). */
  pending = false
  private vs!: ViewSim
  private sheet: Sheet | null = null
  private W = 0
  private H = 0
  private sb = 0
  private rows: RowView[] = []
  private rowsBuilt = false
  private cards: CardView[] = []
  private empty: Phaser.GameObjects.Container | null = null
  private picker: ZonePicker | null = null
  private dialog: Dialog | null = null
  private hire: HireSheet | null = null
  private menu: RowMenu | null = null
  private measurer: Phaser.GameObjects.BitmapText | null = null
  private title: Phaser.GameObjects.BitmapText | null = null
  private payday: Phaser.GameObjects.BitmapText | null = null
  private payroll: Phaser.GameObjects.BitmapText | null = null
  private lane: Phaser.GameObjects.BitmapText | null = null
  private lanePct: Phaser.GameObjects.BitmapText | null = null
  private foot: Phaser.GameObjects.BitmapText | null = null
  /** The fleet list viewport height the sheet is fitted to. */
  private listH = 0
  private dirty = true
  private layoutDirty = false
  private since = 0

  constructor() {
    super(GARAGE_KEY)
  }

  init(): void {
    this.sheet = null
    this.rows = []
    this.rowsBuilt = false
    this.cards = []
    this.empty = null
    this.picker = null
    this.dialog = null
    this.hire = null
    this.menu = null
    this.measurer = null
    this.foot = null
    this.listH = 0
    this.dirty = true
    this.layoutDirty = false
    this.since = 0
  }

  create(): void {
    this.pending = false
    this.vs = getViewSim(this)
    this.measurer = addText(this, 0, 0, '').setVisible(false)
    this.buildUi()

    const mark = (): void => {
      this.dirty = true
    }
    bindSim(
      this,
      {
        'vehicle:bought': mark,
        'vehicle:sold': mark,
        'vehicle:inactive': mark,
        'vehicle:parked': mark,
        'vehicle:departed': mark,
        'vehicle:queued': mark,
        'vehicle:docked': mark,
        'vehicle:unloaded': mark,
        'vehicle:collecting': mark,
        'vehicle:returning': mark,
        'parcel:pickedUp': mark,
        'parcel:loaded': mark,
        'parcel:delivered': mark,
        'money:changed': mark,
        'level:up': mark,
        'payroll:paid': mark,
        'payroll:short': mark,
        'worker:walkedOut': mark,
        'worker:hired': mark,
        'worker:fired': mark,
        'day:ended': mark,
        'region:unlocked': mark,
      },
      () => this.sync(),
    )

    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.input.keyboard?.on('keydown', this.onKey, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)

    this.sync()
    this.sheet?.open()
  }

  /** Open/close the sheet while the scene is awake (toggleGarage). */
  toggleSheet(): void {
    if (!this.sheet) return
    if (this.sheet.isOpen()) this.sheet.close()
    else {
      this.sync()
      this.sheet.open()
    }
  }

  /** The open sheet (tests / e2e). */
  get garageSheet(): Sheet | null {
    return this.sheet
  }

  /** The open driver HireSheet (buy flow, Replace, Hire driver), else null (e2e). */
  get hireSheet(): HireSheet | null {
    return this.hire?.isOpen() ? this.hire : null
  }

  /** The open `···` popover, else null (e2e). */
  get rowMenu(): RowMenu | null {
    return this.menu?.isOpen() ? this.menu : null
  }

  override update(_t: number, delta: number): void {
    if (this.layoutDirty) {
      this.layoutDirty = false
      this.rebuildUi()
    }
    if (!this.sheet?.isOpen()) return
    this.since += delta
    if (!this.dirty && this.since < REFRESH_MS) return
    this.since = 0
    this.sync()
  }

  // ---- build -----------------------------------------------------------------

  private readSize(): void {
    this.W = Math.round(this.scale.width)
    this.H = Math.round(this.scale.height)
    this.sb = Math.max(
      0,
      Math.round(
        (this.registry.get(REG.safeBottom) as number | undefined) ?? 0,
      ),
    )
  }

  private buildUi(): Sheet {
    this.readSize()
    const rows = this.vs.vehicles.length
    const listH = garageListHeight(this.H, this.sb, rows)
    const sheet = new Sheet(this, {
      height: garageFitHeight(this.H, this.sb, rows),
      W: this.W,
      H: this.H,
      id: GARAGE_SHEET_ID,
      list: { top: HEADER_H, height: listH },
      onClose: () => {
        this.picker?.close()
        this.menu?.close()
        this.hire?.close()
      },
      onClosed: () => this.scene.sleep(),
    })
    this.sheet = sheet
    this.listH = listH
    this.buildHeader()
    this.buildCards()
    this.foot = addText(this, MARGIN, 0, footerText(this.vs.data), {
      tint: MUTED,
      maxWidth: this.W - 2 * MARGIN,
    })
    sheet.add(this.foot)
    this.placeBottom()
    this.rows = []
    this.rowsBuilt = false
    this.empty = null
    this.dirty = true
    return sheet
  }

  private rebuildUi(): void {
    const wasOpen = this.sheet?.isOpen() ?? false
    this.dialog?.destroy()
    this.dialog = null
    this.picker?.destroy()
    this.picker = null
    // The new Sheet's list camera would draw over them: close (a re-tap
    // brings them back at the new size).
    this.hire?.close()
    this.hire = null
    this.menu?.close()
    this.menu = null
    for (const r of this.rows) r.tipTimer?.remove(false)
    this.sheet?.destroy()
    this.cards = []
    const sheet = this.buildUi()
    this.sync()
    if (wasOpen) sheet.open()
  }

  private buildHeader(): void {
    const s = this.sheet
    if (!s) return
    this.title = addText(this, MARGIN, textTop(14, LINE_BAND), fleetTitle(0))
    this.payday = addText(this, 0, textTop(14, LINE_BAND), '')
    this.payroll = addText(this, MARGIN, textTop(32, LINE_BAND), '')
    this.lane = addText(this, 0, textTop(32, LINE_BAND), '')
    this.lanePct = addText(this, 0, textTop(32, LINE_BAND), '')
    s.add(this.title, this.payday, this.payroll, this.lane, this.lanePct)
  }

  /** The buy cards and the footer under the list (sheet-local). */
  private placeBottom(): void {
    const y = HEADER_H + this.listH + 4
    for (const c of this.cards) c.btn.setY(y)
    this.foot?.setY(textTop(y + CARD_H + 2, LINE_BAND))
  }

  /** Re-fit the sheet to `rows` fleet rows (a buy, a sale) in place. */
  private fitRows(rows: number): void {
    const listH = garageListHeight(this.H, this.sb, rows)
    if (listH === this.listH) return
    this.listH = listH
    this.sheet?.resize(garageFitHeight(this.H, this.sb, rows), listH)
    this.placeBottom()
  }

  private buildCards(): void {
    const s = this.sheet
    if (!s) return
    const data = this.vs.data
    const models = buyCards(data, this.vs.money, this.vs.level)
    const n = models.length
    const cw = cardWidth(this.W, n)
    const total = n * cw + (n - 1) * CARD_GAP
    const x0 = Math.round((this.W - total) / 2)
    const y = 0 // placeBottom() puts the row under the list
    models.forEach((m, i) => {
      const btn = new Button(this, {
        x: x0 + i * (cw + CARD_GAP),
        y,
        w: cw,
        h: CARD_H,
        id: `garage:buy:${m.type}`,
        onClick: () => this.buy(m.type),
        onDisabledTap: () => this.buyDenied(m.type),
      })
      const frame: FrameName =
        frameOrNull(`${m.type}_sw_0`) ?? (`ic_${m.type}` as FrameName)
      const sprite = this.add.image(0, 0, UI_ATLAS, frame).setOrigin(0, 0)
      const at = cardSpritePos(sprite.width, sprite.height)
      sprite.setPosition(at.x, at.y)
      const name = addText(this, 58, textTop(4, 14), m.name)
      const price = addText(this, 58, textTop(18, 14), m.priceText)
      const capacity = addText(this, 6, textTop(38, 14), m.capacity)
      if (capacity.width > cw - 12) capacity.setText(m.capacityCompact)
      const salary = addText(this, 6, textTop(52, 14), m.salaryText)
      const pips: Phaser.GameObjects.NineSlice[] = []
      const pipsW = m.maxPips * PIP_W + (m.maxPips - 1) * PIP_GAP
      for (let k = 0; k < m.maxPips; k++) {
        pips.push(
          addBar(
            this,
            cw - 6 - pipsW + k * (PIP_W + PIP_GAP),
            52 + Math.floor((14 - BAR_H) / 2),
            PIP_W,
            k < m.pips ? 'ui_bar_fill_blue' : 'ui_bar_track',
          ),
        )
      }
      const lock = addText(this, 6, textTop(68, 14), m.lockText)
      btn.add([sprite, name, price, capacity, salary, ...pips, lock])
      s.add(btn)
      this.cards.push({
        type: m.type,
        btn,
        sprite,
        name,
        price,
        capacity,
        salary,
        pips,
        lock,
        model: m,
      })
    })
  }

  // ---- sync ------------------------------------------------------------------

  private sync(): void {
    this.dirty = false
    const s = this.sheet
    if (!s) return
    const list = this.vs.vehicles
    // rowsBuilt: an empty fleet still needs its first build (empty state).
    const same =
      this.rowsBuilt &&
      list.length === this.rows.length &&
      list.every((v, i) => this.rows[i]?.id === v.id)
    if (!same) this.rebuildRows(list)
    else list.forEach((v, i) => this.updateRow(this.rows[i] as RowView, v))
    this.updateHeader(list.length)
    this.updateCards()
  }

  private updateHeader(fleet: number): void {
    const vs = this.vs
    setTextIf(this.title, fleetTitle(fleet))
    if (this.payday) {
      setTextIf(this.payday, paydayText(vs.ticksToPayday))
      this.payday.setX(this.W - MARGIN - Math.round(this.payday.width))
    }
    const pay = vs.payroll()
    if (this.payroll) {
      setTextIf(this.payroll, payrollText(pay.perDay))
      this.payroll.setTint(pay.short ? RED : THEME.textDark)
    }
    const lane = vs.laneStats()
    if (this.lane && this.payroll) {
      setTextIf(this.lane, `· ${laneRateText(lane)} · Detection`)
      this.lane.setX(this.payroll.x + Math.round(this.payroll.width) + 5)
    }
    if (this.lanePct && this.lane) {
      setTextIf(this.lanePct, formatPct(lane.detectionPct))
      this.lanePct.setTint(TONE_TEXT[detectionTone(lane.detectionPct)])
      this.lanePct.setX(this.lane.x + Math.round(this.lane.width) + 5)
    }
  }

  private updateCards(): void {
    const models = buyCards(this.vs.data, this.vs.money, this.vs.level)
    for (const c of this.cards) {
      const m = models.find((x) => x.type === c.type)
      if (!m) continue
      c.model = m
      c.btn.setEnabled(m.enabled)
      const grey = m.locked
      const ink = grey ? PALETTE.grey2 : THEME.textDark
      c.name.setTint(ink)
      c.capacity.setTint(grey ? PALETTE.grey2 : MUTED)
      c.salary.setTint(grey ? PALETTE.grey2 : MUTED)
      c.price.setTint(grey ? PALETTE.grey2 : m.affordable ? ink : RED)
      c.sprite.setAlpha(grey ? 0.5 : 1)
      c.lock.setVisible(m.locked).setTint(THEME.textDark)
      for (const p of c.pips) p.setAlpha(grey ? 0.5 : 1)
    }
  }

  private rebuildRows(list: readonly VehicleSnapshot[]): void {
    const s = this.sheet
    if (!s) return
    if (this.picker && !list.some((v) => v.id === this.picker?.vehicleId)) {
      this.picker.close()
      this.picker = null
    }
    for (const r of this.rows) {
      r.tipTimer?.remove(false)
      r.c.destroy()
    }
    this.rows = []
    this.rowsBuilt = true
    this.empty?.destroy()
    this.empty = null
    list.forEach((v, i) => {
      const row = this.createRow(v, i * ROW_PITCH)
      this.rows.push(row)
      this.updateRow(row, v)
    })
    this.fitRows(list.length)
    const listH = this.listH
    if (list.length === 0) {
      const t = addText(this, 0, 0, 'Buy your first vehicle below')
      t.setPosition(
        Math.round((this.W - t.width) / 2),
        textTop(Math.round(listH / 2) - 16, LINE_BAND),
      )
      const arrow = this.add
        .image(
          Math.round(this.W / 2) - 8,
          Math.round(listH / 2) + 4,
          UI_ATLAS,
          'arrow',
        )
        .setOrigin(0, 0)
      this.empty = this.add.container(0, 0, [t, arrow])
      s.addToList(this.empty)
    }
    s.setContentHeight(Math.max(list.length * ROW_PITCH + 4, 0))
  }

  private createRow(v: VehicleSnapshot, y: number): RowView {
    const W = this.W
    const col = rowColumns(W)
    const panel = addPanel(
      this,
      MARGIN,
      2,
      W - 2 * MARGIN,
      ROW_PITCH - 4,
      'ui_panel',
    ).setInteractive()
    const icon = this.add.image(0, 0, UI_ATLAS, `ic_${v.type}`).setOrigin(0, 0)
    const iconAt = rowIconPos(icon.width, icon.height)
    icon.setPosition(iconAt.x, iconAt.y)
    const [ya, yb, yc] = ROW_LINE_Y
    const name = addText(this, col.nameX, textTop(ya, ROW_BAND), '')
    const driver = addText(this, col.nameX, textTop(yb, ROW_BAND), '')
    const status1 = addText(this, col.statusX, textTop(ya, ROW_BAND), '')
    const status2 = addText(this, col.statusX, textTop(yb, ROW_BAND), '', {
      tint: MUTED,
    })
    const starFrame = frameOrNull('ic_star')
    const star = starFrame
      ? this.add
          .image(col.nameX, yb - 1, UI_ATLAS, starFrame)
          .setOrigin(0, 0)
          .setVisible(false)
      : null
    // Line 3: speed / energy / charisma pips (positions set in updateRow).
    const pipY = yc + Math.floor((ROW_BAND - PIP_SIZE) / 2)
    const pips = pipRows('driver', {}).map((r) =>
      r.on.map((_, k) => this.pipObject(k * PIP_PITCH, pipY)),
    )
    const affinity = this.add
      .image(0, yc - 1, UI_ATLAS, `ic_${v.type}`)
      .setOrigin(0, 0)
      .setVisible(false)
    const tail = addText(this, 0, textTop(yc, ROW_BAND), '', { tint: MUTED })
    const row: RowView = {
      id: v.id,
      c: this.add.container(0, y),
      icon,
      name,
      driver,
      star,
      status1,
      status2,
      pips,
      affinity,
      tail,
      zone: null as unknown as Button,
      action: null as unknown as Button,
      dots: [],
      actionKind: 'more',
      tip: null,
      tipBox: null,
      tipTimer: null,
      down: false,
      lastTap: null,
    }
    const minHit = minHitFor(this.scale.zoom)
    row.zone = new Button(this, {
      x: col.zoneX,
      y: Math.floor((ROW_PITCH - ZONE_H) / 2),
      w: ZONE_W,
      h: ZONE_H,
      label: zoneChipText(this.vs.data, this.vs.map, v.zone),
      minHit,
      id: `garage:zone:${v.id}`,
      onClick: () => this.openPicker(row),
    })
    row.action = new Button(this, {
      x: col.actionX,
      y: Math.floor((ROW_PITCH - 44) / 2),
      w: MORE_W,
      h: 44,
      label: '',
      minHit,
      id: `garage:action:${v.id}`,
      onClick: () => this.onAction(row),
      onDisabledTap: () => {
        if (row.tip) this.showTip(row, row.tip)
      },
    })
    // The `···` face: three 3×3 dots (m5x7 has no ⋯; its · is one pixel).
    for (let k = 0; k < 3; k++) {
      const d = this.add
        .rectangle(0, 0, 3, 3, THEME.textDark)
        .setOrigin(0, 0)
        .setVisible(false)
      row.dots.push(d)
      row.action.add(d)
    }
    panel.on('pointerdown', () => {
      row.down = true
    })
    panel.on('pointerout', () => {
      row.down = false
    })
    panel.on('pointerup', (p: Phaser.Input.Pointer) => this.onRowUp(row, p))
    row.c.add([
      panel,
      icon,
      name,
      driver,
      status1,
      status2,
      ...(star ? [star] : []),
      ...pips.flat(),
      affinity,
      tail,
      row.zone,
      row.action,
    ])
    this.sheet?.addToList(row.c)
    return row
  }

  /** One pip: an ic_pip image, or a 6×6 square without the frames. */
  private pipObject(x: number, y: number): Phaser.GameObjects.GameObject {
    const f = pipFrame(false)
    if (f) return this.add.image(x, y, UI_ATLAS, f).setOrigin(0, 0)
    return this.add.rectangle(x + 1, y + 1, 6, 6, PALETTE.grey3).setOrigin(0, 0)
  }

  private updateRow(row: RowView, v: VehicleSnapshot): void {
    const data = this.vs.data
    const col = rowColumns(this.W)
    const m = this.measure()
    setTextIf(row.name, ellipsize(v.name, col.nameW, m))
    const person = this.driverOf(v)
    const d = driverRow(v, person, data)
    // Line 2: the name (+ ic_star after it for a ★).
    const starW = d.star && row.star ? 18 : 0
    setTextIf(row.driver, ellipsize(d.name, col.nameW - starW, m))
    row.driver.setTint(d.nameRed ? RED : d.star ? STAR_TINT : THEME.textDark)
    if (row.star) {
      row.star.setVisible(d.star && d.name !== '')
      row.star.setX(col.nameX + Math.round(row.driver.width) + 2)
    }
    const [l1, l2] = statusLines(v, col.statusW, m)
    setTextIf(row.status1, l1)
    setTextIf(row.status2, l2)
    // Line 3: pips, affinity icon, tail (across the name + status columns).
    const endX = col.zoneX - 4
    const lay = driverLineLayout(d.pips ?? [], d.affinity !== null, endX)
    row.pips.forEach((group, g) => {
      const model = d.pips?.[g]
      const x0 = lay.pipX[g] ?? 0
      group.forEach((obj, k) => {
        const lit = model?.on[k] ?? false
        const f = pipFrame(lit)
        if (f) {
          const o = obj as Phaser.GameObjects.Image
          o.setVisible(model !== undefined)
          if (!model) return
          o.setX(x0 + k * PIP_PITCH).setAlpha(d.dim ? 0.5 : 1)
          if (o.frame.name !== f) o.setFrame(f)
        } else {
          const o = obj as Phaser.GameObjects.Rectangle
          o.setVisible(model !== undefined)
          if (!model) return
          o.setX(x0 + k * PIP_PITCH + 1).setAlpha(d.dim ? 0.5 : 1)
          o.setFillStyle(lit ? PALETTE.yellow2 : PALETTE.grey3)
        }
      })
    })
    const affFrame = d.affinity ? frameOrNull(`ic_${d.affinity}`) : null
    row.affinity.setVisible(affFrame !== null && lay.iconX !== null)
    if (affFrame && lay.iconX !== null) {
      if (row.affinity.frame.name !== affFrame) row.affinity.setFrame(affFrame)
      row.affinity.setX(lay.iconX).setAlpha(d.dim ? 0.5 : 1)
    }
    const tailX = d.pips ? lay.tailX : col.nameX
    row.tail.setX(tailX)
    setTextIf(row.tail, fitTail(d.tail, endX - tailX, m))
    row.tail.setTint(d.tailRed ? RED : MUTED)
    // Zone chip and the action slot.
    const zoneText = zoneChipText(data, this.vs.map, v.zone)
    if (row.zone.getData('label') !== zoneText) row.zone.setLabel(zoneText)
    const a = rowAction(
      v,
      data,
      this.vs.vehicles.length,
      SIM_FEATURES.payroll,
      person?.salaryPerDay ?? null,
    )
    this.setAction(row, a, col.actionX)
    row.icon.setAlpha(v.state === 'inactive' ? 0.5 : 1)
  }

  /**
   * The action slot's face: the 44×44 `···` on every row (D16); its popover
   * lists the row's primary action first (menuItems), so a disabled Re-hire
   * shows its tip from there.
   */
  private setAction(row: RowView, a: RowAction, slotX: number): void {
    const btn = row.action
    const x = slotX
    if (btn.btnWidth !== MORE_W || btn.x !== x)
      btn.setRect({
        x,
        y: Math.floor((ROW_PITCH - 44) / 2),
        w: MORE_W,
        h: 44,
      })
    row.actionKind = a.kind
    row.tip = null
    if (btn.getData('label') !== '') btn.setLabel('')
    btn.setData('action', a.label)
    btn.setEnabled(true)
    const x0 = Math.round((MORE_W - 15) / 2)
    row.dots.forEach((d, k) =>
      d.setVisible(true).setPosition(x0 + k * 6, Math.floor((44 - 3) / 2)),
    )
  }

  /** The vehicle's driver (active or walked out), from ViewSim.people(). */
  private driverOf(v: VehicleSnapshot): PersonView | null {
    if (v.driverId === null) return null
    return this.vs.people().find((x) => x.id === v.driverId) ?? null
  }

  private measure(): (s: string) => number {
    const t = this.measurer
    return (s: string) => (t ? Math.round(t.setText(s).width) : s.length * 6)
  }

  // ---- interactions ----------------------------------------------------------

  private onRowUp(row: RowView, p: Phaser.Input.Pointer): void {
    const was = row.down
    row.down = false
    if (!was || p.getDistance() > TAP_PX) return
    const now = this.time.now
    const prev = row.lastTap
    this.game.events.emit(EV_UI_TAP, { id: `garage:row:${row.id}` })
    if (
      prev &&
      now - prev.t <= DOUBLE_TAP_MS &&
      Math.hypot(p.x - prev.x, p.y - prev.y) <= DOUBLE_TAP_PX
    ) {
      row.lastTap = null
      this.game.events.emit(EV_FOLLOW, { vehicleId: row.id })
      this.sheet?.close()
      return
    }
    row.lastTap = { t: now, x: p.x, y: p.y }
    this.game.events.emit(EV_PAN_TO, {
      vehicleId: row.id,
      cover: (this.sheet?.height ?? 0) / Math.max(1, this.H),
    })
  }

  private openPicker(row: RowView): void {
    const s = this.sheet
    if (!s) return
    this.picker?.close()
    const vp = s.listViewport()
    if (!vp) return
    const anchor = {
      x: vp.x + row.zone.x,
      y: vp.y + row.c.y + row.zone.y - s.scrollY,
      w: row.zone.btnWidth,
      h: row.zone.btnHeight,
    }
    const picker = new ZonePicker(this, this.vs, {
      vehicleId: row.id,
      anchor,
      W: this.W,
      H: this.H,
      onPicked: () => {
        this.dirty = true
      },
      onClose: () => {
        if (this.picker === picker) this.picker = null
      },
    })
    this.picker = picker
  }

  /** The `···` button: the popover (with the row's primary action first). */
  private onAction(row: RowView): void {
    const v = this.vs.vehicles.find((x) => x.id === row.id)
    if (!v) return
    this.openMenu(row, v)
  }

  /** Popover `Re-hire $N` (a walked-out driver; spec §7.4, immediate). */
  private rehire(v: VehicleSnapshot): void {
    const res = this.vs.rehireDriver(v.id)
    if (!res.ok) this.deny(failText(res.reason, this.vs.data))
    else {
      const now = this.vs.vehicles.find((x) => x.id === v.id)
      this.toast(rehiredToast(v.name, now?.driverName ?? null))
    }
    this.dirty = true
  }

  /** The `···` popover under / over the row's action button. */
  private openMenu(row: RowView, v: VehicleSnapshot): void {
    const s = this.sheet
    if (!s) return
    this.menu?.close()
    this.picker?.close()
    const vp = s.listViewport()
    if (!vp) return
    const anchor = {
      x: vp.x + row.action.x,
      y: vp.y + row.c.y + row.action.y - s.scrollY,
      w: row.action.btnWidth,
      h: row.action.btnHeight,
    }
    const primary = rowAction(
      v,
      this.vs.data,
      this.vs.vehicles.length,
      SIM_FEATURES.payroll,
      this.driverOf(v)?.salaryPerDay ?? null,
    )
    const menu = new RowMenu(this, {
      vehicleId: v.id,
      items: menuItems(v, this.vs.data, this.vs.vehicles.length, primary),
      anchor,
      W: this.W,
      H: this.H,
      minHit: minHitFor(this.scale.zoom),
      onPick: (item) => {
        const now = this.vs.vehicles.find((x) => x.id === v.id)
        if (!now) return
        if (item.kind === 'hire') this.hireDriver(now)
        else if (item.kind === 'rehire') this.rehire(now)
        else if (item.kind === 'replace') this.replaceDriver(now)
        else if (item.kind === 'fire') this.fireDriver(now)
        else this.sell(now)
      },
      onDisabled: (item) => {
        if (item.tip) this.showTip(row, item.tip)
      },
      onClose: () => {
        if (this.menu === menu) this.menu = null
      },
    })
    this.menu = menu
  }

  /** Open the driver HireSheet over the Garage (one at a time). */
  private openHire(o: {
    target: HireSheetTarget
    title: string
    note?: string
    allowLater?: boolean
    onDone: (res: CommandResult) => void
  }): void {
    this.hire?.close()
    this.menu?.close()
    this.picker?.close()
    const hs: HireSheet = new HireSheet(this, {
      vs: this.vs,
      role: 'driver',
      target: o.target,
      title: o.title,
      note: o.note,
      allowLater: o.allowLater,
      W: this.W,
      H: this.H,
      minHit: minHitFor(this.scale.zoom),
      safeBottom: this.sb,
      id: 'garage:hire',
      onDone: (res) => {
        if (this.hire === hs) this.hire = null
        o.onDone(res)
      },
      onCancel: () => {
        if (this.hire === hs) this.hire = null
      },
    })
    this.hire = hs
  }

  /** Buy card tap → `Who drives the Bike?` (design-m6 §6.3). */
  private buy(type: VehicleType): void {
    const def = typeDef(this.vs.data, type)
    if (!def) return
    this.openHire({
      target: { buyType: type },
      title: buyTitle(def.name),
      note: buyNote(def),
      allowLater: true,
      onDone: (res) => this.bought(res),
    })
  }

  /** After the buy flow: toast, SFX, the new row scrolled into view. */
  private bought(res: CommandResult): void {
    if (!res.ok) return
    const list = this.vs.vehicles
    const v =
      (res.vehicleId !== undefined
        ? list.find((x) => x.id === res.vehicleId)
        : undefined) ??
      list.reduce<VehicleSnapshot | undefined>(
        (a, b) => (!a || b.id > a.id ? b : a),
        undefined,
      )
    const hired =
      res.employeeId !== undefined ? this.personOf(res.employeeId) : null
    if (v) this.toast(boughtToast(v.name, hired?.name ?? v.driverName))
    this.game.events.emit(EV_UI_SFX, { name: 'buy' })
    this.sync()
    const i = v ? this.rows.findIndex((r) => r.id === v.id) : -1
    if (i >= 0) this.sheet?.scrollIntoView(i * ROW_PITCH, ROW_PITCH)
  }

  /** `Hire driver` on a driverless vehicle (Hire later, after a Fire). */
  private hireDriver(v: VehicleSnapshot): void {
    this.openHire({
      target: { vehicleId: v.id },
      title: driverForTitle(v.name),
      onDone: (res) => this.drove(v.id, res),
    })
  }

  /** `Replace driver`: the new driver takes over on the lot, or after this trip. */
  private replaceDriver(v: VehicleSnapshot): void {
    const d = this.driverOf(v)
    this.openHire({
      target: { vehicleId: v.id },
      title: d ? replaceTitle(d.name, v.name) : driverForTitle(v.name),
      onDone: (res) => this.drove(v.id, res),
    })
  }

  private drove(vehicleId: number, res: CommandResult): void {
    this.dirty = true
    if (!res.ok || res.employeeId === undefined) return
    const p = this.personOf(res.employeeId)
    const v = this.vs.vehicles.find((x) => x.id === vehicleId)
    if (p && v) this.toast(driveToast(p.name, v.name, p.pending))
  }

  /** `Fire driver` → Dialog → ViewSim.fire (no refund; design-m6 §4.5). */
  private fireDriver(v: VehicleSnapshot): void {
    const d = this.driverOf(v)
    if (!d) return
    this.dialog?.destroy()
    this.dialog = new Dialog(this, {
      title: 'Fire driver',
      text: firePrompt(d.name, v),
      action: 'Fire',
      destructive: true,
      W: this.W,
      H: this.H,
      minHit: minHitFor(this.scale.zoom),
      id: 'garage:fireDialog',
      onConfirm: () => {
        const res = this.vs.fire(d.id)
        if (!res.ok) this.deny(failText(res.reason, this.vs.data))
        else
          this.toast(
            firedToast(
              d.name,
              this.vs.vehicles.find((x) => x.id === v.id) ?? null,
            ),
          )
        this.dirty = true
      },
    })
  }

  private sell(v: VehicleSnapshot): void {
    const refund = sellRefund(this.vs.data, v.type)
    this.dialog?.destroy()
    this.dialog = new Dialog(this, {
      title: 'Sell vehicle',
      text: sellPrompt(v.name, refund),
      action: 'Sell',
      destructive: true,
      W: this.W,
      H: this.H,
      minHit: minHitFor(this.scale.zoom),
      id: 'garage:sellDialog',
      onConfirm: () => {
        const res = this.vs.sellVehicle(v.id)
        if (!res.ok) this.deny(failText(res.reason, this.vs.data))
        this.dirty = true
      },
    })
  }

  private personOf(id: number): PersonView | null {
    return this.vs.people().find((x) => x.id === id) ?? null
  }

  private buyDenied(type: VehicleType): void {
    const c = this.cards.find((x) => x.type === type)
    if (c) this.deny(buyDeniedToast(c.model))
  }

  private showTip(row: RowView, text: string): void {
    row.tipTimer?.remove(false)
    row.tipBox?.destroy()
    const t = addText(this, 6, 0, text)
    const w = Math.round(t.width) + 12
    const h = 20
    t.setY(textTop(0, h))
    const col = rowColumns(this.W)
    const bg = addPanel(this, 0, 0, w, h, 'ui_tooltip')
    row.tipBox = this.add.container(
      Math.max(MARGIN, col.actionX - 4 - w),
      Math.floor((ROW_PITCH - h) / 2),
      [bg, t],
    )
    row.c.add(row.tipBox)
    row.tipTimer = this.time.delayedCall(TIP_MS, () => {
      row.tipBox?.destroy()
      row.tipBox = null
      row.tipTimer = null
    })
  }

  private toast(text: string, red = false): void {
    this.game.events.emit(EV_TOAST, { text, red })
  }

  private deny(text: string): void {
    this.toast(text)
    this.game.events.emit(EV_UI_SFX, { name: 'deny' })
  }

  // ---- lifecycle -------------------------------------------------------------

  private onWake(): void {
    this.pending = false
    if (this.layoutDirty) {
      this.layoutDirty = false
      this.rebuildUi()
    }
    this.sync()
    this.sheet?.open()
  }

  private onResize(): void {
    // main.ts refreshes registry safeTop/safeBottom right after the resize;
    // rebuild on the next update (or on wake while asleep).
    this.layoutDirty = true
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'g' && ev.key !== 'G') return
    const s = this.sheet
    if (s?.isOpen() && claimKey(ev, s)) s.close()
  }

  private onShutdown(): void {
    this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.input.keyboard?.off('keydown', this.onKey, this)
    this.picker?.destroy()
    this.picker = null
    this.menu?.destroy()
    this.menu = null
    this.hire?.close()
    this.hire = null
    for (const r of this.rows) r.tipTimer?.remove(false)
    this.rows = []
    this.cards = []
    this.foot = null
    this.sheet = null
    this.pending = false
  }
}

function setTextIf(t: Phaser.GameObjects.BitmapText | null, s: string): void {
  if (t && t.text !== s) t.setText(s)
}

// ---- the row's `···` popover ---------------------------------------------------

export interface RowMenuOptions {
  vehicleId: number
  items: readonly MenuItem[]
  /** Screen rect of the `···` button. */
  anchor: Rect
  W: number
  H: number
  minHit: number
  /** An enabled item was tapped (the menu has closed). */
  onPick: (item: MenuItem) => void
  /** A disabled item was tapped (the menu has closed): show its tip. */
  onDisabled?: (item: MenuItem) => void
  /** Called once when the menu closes (pick, outside tap, Esc, sleep). */
  onClose?: () => void
}

/**
 * Replace driver / Fire driver / Sell $100, or a driverless row's Hire
 * driver / Re-hire $N first (menuItems; design-m6 §6.3, D16): 44-px
 * rows on a ui_panel in a PopoverLayer (drawn over the Sheet's list camera,
 * a tap outside closes it), placed above the button when it fits, else
 * below. Esc closes it (top modal); the scene going to sleep closes it.
 */
export class RowMenu {
  readonly scene: Phaser.Scene
  readonly vehicleId: number
  private opts: RowMenuOptions
  private layer: PopoverLayer
  private open = true

  constructor(scene: Phaser.Scene, opts: RowMenuOptions) {
    this.scene = scene
    this.opts = opts
    this.vehicleId = opts.vehicleId
    this.layer = new PopoverLayer(scene, {
      W: opts.W,
      H: opts.H,
      onOutside: () => this.close(),
    })
    const h = menuHeight(opts.items.length)
    const at = placePopover(opts.anchor, MENU_W, h, opts.W, opts.H)
    const panel = addPanel(scene, at.x, at.y, MENU_W, h, 'ui_panel')
    panel.setInteractive() // a tap between rows stays in the popover
    this.layer.add(panel)
    opts.items.forEach((item, i) => {
      const btn = new Button(scene, {
        x: at.x + MENU_PAD,
        y: at.y + MENU_PAD + i * (MENU_ROW_H + MENU_GAP),
        w: MENU_W - 2 * MENU_PAD,
        h: MENU_ROW_H,
        label: item.label,
        face:
          item.kind === 'fire'
            ? 'red'
            : item.kind === 'hire' || item.kind === 'rehire'
              ? 'primary'
              : 'secondary',
        minHit: opts.minHit,
        id: `garage:menu:${item.kind}`,
        onClick: () => {
          this.close()
          opts.onPick(item)
        },
        onDisabledTap: () => {
          this.close()
          opts.onDisabled?.(item)
        },
      })
      btn.setEnabled(item.enabled)
      this.layer.add(btn)
    })
    pushModal(this)
    scene.input.keyboard?.on('keydown', this.onKey, this)
    scene.events.once('shutdown', this.destroy, this)
    scene.events.once('sleep', this.close, this)
  }

  isOpen(): boolean {
    return this.open
  }

  close(): void {
    if (!this.open) return
    this.destroy()
    this.opts.onClose?.()
  }

  /** Tear down without callbacks (scene shutdown). */
  destroy(): void {
    if (!this.open) return
    this.open = false
    popModal(this)
    this.scene.input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('shutdown', this.destroy, this)
    this.scene.events.off('sleep', this.close, this)
    this.layer.destroy()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && claimKey(ev, this)) this.close()
  }
}
