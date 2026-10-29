// GarageSheet `Garage` (city-view.md §7, §6.2, §11.2; plan.md §9; spec §4.1,
// §7.3-§7.4): the overlay scene launched above City/Warehouse + HUD and
// slept when closed (so the list scroll survives). One Sheet of height
// max(320, round(H × 0.6)):
//   header (56)  `Garage · Fleet 3` / `Payday in 0:23`, then
//                `Payroll $44/day` (red after a short payday) ·
//                `Lane 15/min · Detection 97%` (the % in the §6.3 colours)
//   fleet list   clipped by the Sheet's list camera, 56-px rows: type icon,
//                `Bike 1` over `Dee · $8/day` (`! unpaid` in red, red `Dee
//                left` after a walkout), the §4.6 state text + units
//                `3/4`, the zone chip `Any ▾` (→ ZonePicker), `Sell $100`
//                (→ Dialog; disabled on the last vehicle with the tip `Keep
//                at least one vehicle`) or `Re-hire $8` once the driver has
//                walked out (→ rehireDriver, toast `Dee is back — Bike 2 on
//                the road`);
//                row tap → pm:panTo {vehicleId}, double-tap → pm:follow +
//                close; empty state `Buy your first vehicle below`
//   buy cards    one per vehicles.json type: sprite, name, price (red when
//                unaffordable), `4 units · S M`, `$8/day`, speed pips;
//                locked types greyed `Unlocks at Lv 2`; tap → buyVehicle →
//                toast `Bike 2 bought — Dee hired` + ui:sfx buy
//   footer       `Sold vehicles refund 50%. Drivers are paid every day (60 s).`
// Every number comes from the data tables or the ViewSim. Sim events only
// mark the view dirty (bindSim: attached while awake); the header and row
// states are also re-read at 4 Hz while open (payday countdown, cargo).
// `toggleGarage(from)` is the one entry point (HUD button, G key, the
// district panel's `Garage ▸`).
import Phaser from 'phaser'
import { bindSim, getSim, getViewSim, REG } from '../boot/simBinding.ts'
import type { GameData, VehicleTypeDef } from '../data/types.ts'
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX } from '../input/GestureClassifier.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { frameOrNull, type FrameName } from '../render/frames.ts'
import { SIM_FEATURES } from '../sim/features.ts'
import type { Size, VehicleType } from '../sim/types.ts'
import type { VehicleSnapshot, ViewSim } from '../sim/view-api.ts'
import { Button, TAP_PX } from '../ui/Button.ts'
import { Dialog } from '../ui/Dialog.ts'
import { minHitFor } from '../ui/layout.ts'
import { addBar, addPanel, BAR_H } from '../ui/Panel.ts'
import { claimKey, Sheet } from '../ui/Sheet.ts'
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

/** Sheet height (city-view §7). */
export function garageSheetHeight(H: number): number {
  return Math.max(320, Math.round(H * 0.6))
}

/** Fleet list viewport height: sheet − header − buy block − safe area. */
export function garageListHeight(H: number, safeBottom = 0): number {
  return Math.max(
    ROW_PITCH,
    garageSheetHeight(H) - HEADER_H - BOTTOM_H - Math.max(0, safeBottom),
  )
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

/** Re-hire fee: one day's salary × employees.rehireFeeDays (spec §7.4). */
export function rehireCost(data: GameData, type: VehicleType): number {
  const def = typeDef(data, type)
  return def ? def.driverSalaryPerDay * data.employees.rehireFeeDays : 0
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
 * Driver line: `Dee · $8/day`, red `Dee · ! unpaid` after a short payday, red
 * `Dee left` after a walkout (the row's alert state, like the `!` badge;
 * `No driver` when the name is unknown). The status column already reads
 * `No driver` for a parked inactive vehicle, so naming who left says who
 * the `Re-hire` button brings back instead of repeating it (UX M3 review;
 * `Dee walked out` is 79 px, wider than the 74-px name column).
 */
export function driverLine(
  v: Pick<VehicleSnapshot, 'driverName' | 'unpaid' | 'type'>,
  data: GameData,
  walkedOut: string | null = null,
): { text: string; red: boolean } {
  if (v.driverName === null)
    return { text: walkedOut ? `${walkedOut} left` : 'No driver', red: true }
  if (v.unpaid) return { text: `${v.driverName} · ! unpaid`, red: true }
  const pay = typeDef(data, v.type)?.driverSalaryPerDay ?? 0
  return { text: `${v.driverName} · ${formatMoney(pay)}/day`, red: false }
}

export interface RowAction {
  kind: 'sell' | 'rehire'
  label: string
  enabled: boolean
  /** Tooltip shown on a tap while disabled. */
  tip: string | null
}

/**
 * The row's button: `Re-hire $8` on a vehicle without a driver — inactive on
 * the lot, or walked out and still finishing its trip (spec §7.4: re-hire is
 * immediate) — enabled once the payroll system ships; else `Sell $100`,
 * disabled on the last vehicle while vehicles.json lastVehicleUnsellable.
 */
export function rowAction(
  v: Pick<VehicleSnapshot, 'state' | 'type'> &
    Partial<Pick<VehicleSnapshot, 'driverName'>>,
  data: GameData,
  fleetSize: number,
  rehireEnabled: boolean,
): RowAction {
  if (v.state === 'inactive' || v.driverName === null) {
    return {
      kind: 'rehire',
      label: `Re-hire ${formatMoney(rehireCost(data, v.type))}`,
      enabled: rehireEnabled,
      tip: rehireEnabled ? null : 'Not available yet',
    }
  }
  const last = data.vehicles.lastVehicleUnsellable && fleetSize <= 1
  return {
    kind: 'sell',
    label: `Sell ${formatMoney(sellRefund(data, v.type))}`,
    enabled: !last,
    tip: last ? 'Keep at least one vehicle' : null,
  }
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

/** `Bike 2 bought — Dee hired` */
export function boughtToast(name: string, driverName: string | null): string {
  return driverName ? `${name} bought — ${driverName} hired` : `${name} bought`
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

/** `Sell Bike 2 for $100? Its parcels return to the shelf.` */
export function sellPrompt(name: string, refund: number): string {
  return `Sell ${name} for ${formatMoney(refund)}? Its parcels return to the shelf.`
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

/** Row geometry (list-local x) for a canvas W px wide. */
export function rowColumns(W: number): {
  sellX: number
  zoneX: number
  statusX: number
  statusW: number
  nameX: number
  nameW: number
} {
  const sellX = W - MARGIN - ROW_PAD_R - SELL_W
  const zoneX = sellX - 4 - ZONE_W
  const statusX = STATUS_X
  return {
    sellX,
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
    g.toggleSheet()
    return
  }
  g.pending = true
  if (sp.isSleeping(GARAGE_KEY)) sp.wake(GARAGE_KEY)
  else sp.launch(GARAGE_KEY)
  sp.bringToTop(GARAGE_KEY)
}

// ---- the scene ---------------------------------------------------------------

const ROW_PAD_R = 6
const ICON_X = 20
const NAME_X = 42
const STATUS_X = 120
/**
 * Row button widths: the longest labels (`Re-hire $25`, 61 px in m5x7;
 * `Downtown ▾`, 60 px) need Button.CONTENT_PAD (5) of air on each side —
 * at 64 px `Re-hire $25` touched both edges of its face (UX M3 review).
 */
export const SELL_W = 72
export const ZONE_W = 70
const ZONE_H = 28
const LINE1 = 9
const LINE2 = 29
const LINE_BAND = 16
const REFRESH_MS = 250
const TIP_MS = 2000
const MUTED = PALETTE.grey1
const RED = PALETTE.red0
const PIP_W = 8
const PIP_GAP = 2

interface RowView {
  id: number
  c: Phaser.GameObjects.Container
  icon: Phaser.GameObjects.Image
  name: Phaser.GameObjects.BitmapText
  driver: Phaser.GameObjects.BitmapText
  status1: Phaser.GameObjects.BitmapText
  status2: Phaser.GameObjects.BitmapText
  zone: Button
  action: Button
  actionKind: 'sell' | 'rehire'
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
  private measurer: Phaser.GameObjects.BitmapText | null = null
  private title: Phaser.GameObjects.BitmapText | null = null
  private payday: Phaser.GameObjects.BitmapText | null = null
  private payroll: Phaser.GameObjects.BitmapText | null = null
  private lane: Phaser.GameObjects.BitmapText | null = null
  private lanePct: Phaser.GameObjects.BitmapText | null = null
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
    this.measurer = null
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
    const height = garageSheetHeight(this.H)
    const listH = garageListHeight(this.H, this.sb)
    const sheet = new Sheet(this, {
      height,
      W: this.W,
      H: this.H,
      id: GARAGE_SHEET_ID,
      list: { top: HEADER_H, height: listH },
      onClose: () => this.picker?.close(),
      onClosed: () => this.scene.sleep(),
    })
    this.sheet = sheet
    this.buildHeader()
    this.buildCards(height)
    const foot = addText(this, MARGIN, 0, footerText(this.vs.data), {
      tint: MUTED,
      maxWidth: this.W - 2 * MARGIN,
    })
    foot.setY(textTop(height - this.sb - BOTTOM_H + 4 + CARD_H + 2, LINE_BAND))
    sheet.add(foot)
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

  private buildCards(height: number): void {
    const s = this.sheet
    if (!s) return
    const data = this.vs.data
    const models = buyCards(data, this.vs.money, this.vs.level)
    const n = models.length
    const cw = cardWidth(this.W, n)
    const total = n * cw + (n - 1) * CARD_GAP
    const x0 = Math.round((this.W - total) / 2)
    const y = height - this.sb - BOTTOM_H + 4
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
      sprite.setPosition(
        6 + Math.round((48 - sprite.width) / 2),
        4 + Math.max(0, 32 - Math.round(sprite.height)),
      )
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
    const listH = garageListHeight(this.H, this.sb)
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
    const icon = this.add
      .image(ICON_X, Math.floor((ROW_PITCH - 16) / 2), UI_ATLAS, `ic_${v.type}`)
      .setOrigin(0, 0)
    const name = addText(this, col.nameX, textTop(LINE1, LINE_BAND), '')
    const driver = addText(this, col.nameX, textTop(LINE2, LINE_BAND), '', {
      tint: MUTED,
    })
    const status1 = addText(this, col.statusX, textTop(LINE1, LINE_BAND), '')
    const status2 = addText(this, col.statusX, textTop(LINE2, LINE_BAND), '', {
      tint: MUTED,
    })
    const row: RowView = {
      id: v.id,
      c: this.add.container(0, y),
      icon,
      name,
      driver,
      status1,
      status2,
      zone: null as unknown as Button,
      action: null as unknown as Button,
      actionKind: 'sell',
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
      x: col.sellX,
      y: Math.floor((ROW_PITCH - 44) / 2),
      w: SELL_W,
      h: 44,
      label: '',
      minHit,
      id: `garage:sell:${v.id}`,
      onClick: () => this.onAction(row),
      onDisabledTap: () => {
        if (row.tip) this.showTip(row, row.tip)
      },
    })
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
      row.zone,
      row.action,
    ])
    this.sheet?.addToList(row.c)
    return row
  }

  private updateRow(row: RowView, v: VehicleSnapshot): void {
    const data = this.vs.data
    const col = rowColumns(this.W)
    const m = this.measure()
    setTextIf(row.name, ellipsize(v.name, col.nameW, m))
    const d = driverLine(v, data, this.walkedOutName(v))
    setTextIf(row.driver, ellipsize(d.text, col.nameW, m))
    row.driver.setTint(d.red ? RED : MUTED)
    const [l1, l2] = statusLines(v, col.statusW, m)
    setTextIf(row.status1, l1)
    setTextIf(row.status2, l2)
    const zoneText = zoneChipText(data, this.vs.map, v.zone)
    if (row.zone.getData('label') !== zoneText) row.zone.setLabel(zoneText)
    const a = rowAction(v, data, this.vs.vehicles.length, SIM_FEATURES.payroll)
    row.actionKind = a.kind
    row.tip = a.tip
    if (row.action.getData('label') !== a.label) row.action.setLabel(a.label)
    row.action.setEnabled(a.enabled)
    row.icon.setAlpha(v.state === 'inactive' ? 0.5 : 1)
  }

  /** The walked-out driver's name (the facade only reports active ones). */
  private walkedOutName(v: VehicleSnapshot): string | null {
    if (v.driverName !== null) return null
    const st = getSim(this)?.state
    const e = st?.employees.findLast(
      (x) => x.kind === 'driver' && x.vehicleId === v.id && !x.active,
    )
    return e?.name ?? null
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

  private onAction(row: RowView): void {
    const v = this.vs.vehicles.find((x) => x.id === row.id)
    if (!v) return
    const data = this.vs.data
    if (row.actionKind === 'rehire') {
      const res = this.vs.rehireDriver(v.id)
      if (!res.ok) this.deny(failText(res.reason))
      else {
        const now = this.vs.vehicles.find((x) => x.id === v.id)
        this.toast(rehiredToast(v.name, now?.driverName ?? null))
      }
      this.dirty = true
      return
    }
    const refund = sellRefund(data, v.type)
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
        if (!res.ok) this.deny(failText(res.reason))
        this.dirty = true
      },
    })
  }

  private buy(type: VehicleType): void {
    const res = this.vs.buyVehicle(type)
    if (!res.ok) {
      this.deny(failText(res.reason))
      return
    }
    const list = this.vs.vehicles
    const v =
      (res.vehicleId !== undefined
        ? list.find((x) => x.id === res.vehicleId)
        : undefined) ??
      list.reduce<VehicleSnapshot | undefined>(
        (a, b) => (!a || b.id > a.id ? b : a),
        undefined,
      )
    if (v) this.toast(boughtToast(v.name, v.driverName))
    this.game.events.emit(EV_UI_SFX, { name: 'buy' })
    this.sync()
    const i = v ? this.rows.findIndex((r) => r.id === v.id) : -1
    if (i >= 0) this.sheet?.scrollIntoView(i * ROW_PITCH, ROW_PITCH)
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
      Math.max(MARGIN, col.sellX - 4 - w),
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
    for (const r of this.rows) r.tipTimer?.remove(false)
    this.rows = []
    this.cards = []
    this.sheet = null
    this.pending = false
  }
}

function setTextIf(t: Phaser.GameObjects.BitmapText | null, s: string): void {
  if (t && t.text !== s) t.setText(s)
}
