// Warehouse SlotCard (warehouse-view.md §2.2, §2.5; plan.md §8; spec §6.2,
// §6.3, §6.7, §7.3-§7.4; spec-build2 §2.1-§2.4; design-m6 §6.2): the card
// of an occupied slot, a WarehouseSheet (BuySheet.ts) opened with
// `open(nodeId)`.
//
// Header: the fixture's art + name (a desk: `Inspection desk` /
// `Inspection desk 2` by its desks.rows index), and the node's display label
// from the room layout (`labelFor(nodeId)`, never an index computed here).
// Machine (232 px): `metal · catch 80% / 15% other`, `false-flag 50% ·
// 60/min`, `Lane vs metal: 97%` (the lane's §6.3 D(strain), tinted by the
// readout thresholds), `Moves are free`, then [Move] [Sell for $75 (50%)]
// (machines.json removalRefund, Q11) → a Dialog confirm → removeFixture.
// Desk (M6 people): `catch 88% avg · false-flag 14% · 45/min` (the desk
// readout = the mean of its seated inspectors' effective p, B2 §2.3; the
// rate is Σ over its stations of 60 / process s), `Inspectors 2/3`, one
// 44-px row per seated inspector — face (`face_NN`), name (★ gold +
// `ic_star`), compact pips `●●●○○ ●●●○○ ●○` (eye, pace, charisma), its own
// effective p at this desk (`89%`, charisma of the colleagues included), a
// red `! unpaid` after a short payday, [Fire] (instant, no refund) — then
// one row per walked-out inspector holding a seat (`Lin walked out`,
// [Re-hire $24] = the worker's daily salary × rehireFeeDays, §7.4, dimmed
// below the fee, live on money:changed; [Fire] frees the seat), the salary
// line `Salaries $44/day · Payday in 0:23` (the seated inspectors' real
// salaries; re-read every 500 ms, red while the last payday was short),
// [Hire inspector] (no price: it opens the HireSheet for this desk through
// the scene — WarehouseSheetOptions.openHire — and the card reopens on the
// same node when it closes; disabled with its reason as a caption when the
// desk is full or its free seats are held for walked-out inspectors),
// `Remove desk — N inspectors walk out, no refund` (`… let go …` counting
// the walked-out ones holding a seat, who are let go too), then [Move]
// [Remove desk] → Dialog confirm naming who walks out and who is let go.
// Rows are 44 px (not the 24 px of the view doc) so every Fire / Re-hire
// button keeps a 44-px hit box without overlapping its neighbour.
//
// Move closes the card and hands the node id to the scene's tap-target mode
// (`onMoveRequest(cb)`: the scene highlights the other slots and calls
// lane.moveFixture on the next slot tap). Fire / Re-hire / Remove call the
// ViewSim facade directly; a refusal shakes the button and plays `deny`.
// The card re-renders on worker / payroll / money / fixture / level events
// and closes when its slot no longer holds a fixture.
import type Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type { FrameName } from '../../render/frames.ts'
import { SIM_FEATURES } from '../../sim/features.ts'
import type {
  Checker,
  Fixture,
  LaneNode,
  Station,
  Strain,
} from '../../sim/types.ts'
import { TICKS_PER_S } from '../../sim/types.ts'
import { checkerP, type PersonView, type ViewSim } from '../../sim/view-api.ts'
import type { Button } from '../Button.ts'
import { Dialog } from '../Dialog.ts'
import { detectionTone, TONE_TEXT } from '../ShieldPopover.ts'
import { formatClock, formatMoney, textTop } from '../text.ts'
import { THEME } from '../theme.ts'
import {
  DESK_NAME,
  deskCatchText,
  deskTitle,
  findNode,
  machineFrame,
  MUTED,
  PAD,
  pctOf,
  perMinText,
  PIP_SIZE,
  pipGroups,
  RED_TEXT,
  WarehouseSheet,
  warehouseFailText,
  type WarehouseSheetLayout,
  type WarehouseSheetOptions,
} from './BuySheet.ts'

export const SLOT_CARD_ID = 'wh:slot'
/** Machine card height (warehouse-view.md §2.2). */
export const MACHINE_CARD_H = 232
/** One inspector / walked-out row (44-px hit rows). */
export const PERSON_ROW_H = 44
/** Desk card height without person rows. */
export const DESK_CARD_BASE_H = 266
/** First stats line top and the line pitch. */
export const LINE_Y = 70
export const LINE_PITCH = 22
/** Bottom button row (Move / Remove). */
export const BTN_H = 44
export const BTN_GAP = 8
/** Fire / Re-hire buttons inside a person row. */
export const SMALL_BTN_H = 32
export const FIRE_W = 64
export const REHIRE_W = 100
/** Gap between Re-hire and Fire in a walked-out row. */
export const ROW_BTN_GAP = 6
export const HIRE_W = 150
export const HIRE_H = 36
/**
 * Person row columns (sheet-local x, design-m6 §6.2): face 16 × 16, name
 * (≤ 60 px incl. the ★), compact pips (92 px: 35 + 4 + 35 + 4 + 14), the
 * effective p, `! unpaid`; [Fire] sits on the right edge.
 */
export const FACE_X = 12
export const FACE_SIZE = 16
export const NAME_X = 32
export const NAME_W = 60
export const PIPS_X = 96
export const PEFF_X = 194
export const UNPAID_X = 218
/** A walked-out person's face alpha. */
export const AWAY_ALPHA = 0.4

/** The `Hire inspector` button label (no price: the HireSheet shows each fee). */
export const HIRE_INSPECTOR = 'Hire inspector'
/** The HireSheet title from a desk card. */
export const HIRE_INSPECTOR_TITLE = 'Hire an inspector'

// ---- pure helpers ----------------------------------------------------------------

/** Desk card height for `rows` person rows (seated + walked-out inspectors). */
export function deskCardHeight(rows: number): number {
  return DESK_CARD_BASE_H + PERSON_ROW_H * Math.max(0, rows)
}

/** D(s) = 1 − Π(1 − p_i(s)) over the live slots with ≥ 1 station (spec §6.3). */
export function laneRateFor(
  nodes: readonly LaneNode[],
  strain: Strain,
): number {
  let miss = 1
  for (const n of nodes) {
    if (n.kind !== 'slot' || n.locked || !n.fixture) continue
    if (n.stations.length === 0) continue
    miss *= 1 - checkerP(n.fixture.checker, strain)
  }
  return 1 - miss
}

/** `Lane vs metal: 97%` (§6.3 series compounding, warehouse-view.md §2.2). */
export function laneVsLine(strain: string, d: number): string {
  return `Lane vs ${strain}: ${pctOf(d)}`
}

/** `metal · catch 80% / 15% other`; generalists `any strain · catch 70%`. */
export function strainCatchLine(
  c: Pick<Checker, 'strain' | 'pMatch' | 'pOther'>,
): string {
  if (c.strain === 'any') return `any strain · catch ${pctOf(c.pMatch)}`
  return `${c.strain} · catch ${pctOf(c.pMatch)} / ${pctOf(c.pOther)} other`
}

/** Seconds per check of a placed checker. */
export function processSOf(c: Pick<Checker, 'processTicks'>): number {
  return c.processTicks / TICKS_PER_S
}

/** `false-flag 50% · 60/min` (one station per machine). */
export function machineSpeedLine(
  c: Pick<Checker, 'decoyFlag' | 'processTicks'>,
  stations = 1,
): string {
  return `false-flag ${pctOf(c.decoyFlag)} · ${perMinText(processSOf(c), stations)}`
}

/**
 * Parcels per minute of a desk: Σ over its stations of 60 / process s (each
 * inspector's own pace, spec-build2 §2.3; `fallbackTicks` for a station
 * without its own number). 3 × 4.0 s = 45/min; 3.0 s + 5.0 s = 32/min.
 */
export function deskRatePerMin(
  stations: readonly Pick<Station, 'processTicks'>[],
  fallbackTicks: number,
): number {
  let rate = 0
  for (const st of stations) {
    const t = st.processTicks ?? fallbackTicks
    if (t > 0) rate += (60 * TICKS_PER_S) / t
  }
  return rate
}

/**
 * `catch 88% avg · false-flag 14% · 45/min` (design-m6 §6.2: the desk
 * readout means + the Σ rate); one inspector reads `catch 85% · …`; an
 * empty desk `catch 0% · 0/min` (it passes parcels through).
 */
export function deskStatsLine(
  meanP: number,
  meanDecoyFlag: number,
  ratePerMin: number,
  seated: number,
): string {
  const head = deskCatchText(meanP, seated)
  if (head === null) return 'catch 0% · 0/min'
  return `${head} · false-flag ${pctOf(meanDecoyFlag)} · ${Math.round(ratePerMin)}/min`
}

/** `Inspectors 2/3` (+ the pass-through note while the desk is empty). */
export function inspectorsLine(n: number, max: number): string {
  const s = `Inspectors ${n}/${max}`
  return n === 0 ? `${s} — parcels pass unchecked` : s
}

/** `Salaries $44/day · Payday in 0:23` (§7.3; the seated inspectors' own salaries). */
export function salaryLine(totalPerDay: number, ticksToPayday: number): string {
  const payday = formatClock(ticksToPayday / TICKS_PER_S)
  return `Salaries ${formatMoney(totalPerDay)}/day · Payday in ${payday}`
}

/** Caption while every free seat is held for a walked-out inspector. */
export const SEAT_HELD_TEXT = 'Seat held for re-hire'

/**
 * Why Hire is disabled, or null: the desk is full, or its free seats are
 * held for `held` walked-out inspectors (the sim counts them against
 * desks.maxPerDesk until re-hired or fired). Money is the HireSheet's
 * business (each applicant shows its own fee).
 */
export function hireBlockReason(
  n: number,
  max: number,
  held = 0,
): string | null {
  if (n >= max) return 'Desk full'
  if (n + held >= max) return SEAT_HELD_TEXT
  return null
}

/** The re-hire fee (§7.4): the worker's own salaryPerDay × employees.rehireFeeDays. */
export function rehireFee(data: GameData, salary: number): number {
  return salary * data.employees.rehireFeeDays
}

/** Why a Re-hire is disabled, or null (the sim refuses below the fee). */
export function rehireBlockReason(balance: number, fee: number): string | null {
  return balance < fee ? 'Not enough money' : null
}

/** `Re-hire $24` */
export function rehireLabel(fee: number): string {
  return `Re-hire ${formatMoney(fee)}`
}

/** The effective p a seated inspector shows on its row: `89%`. */
export function pEffText(p: Pick<PersonView, 'numbers'>): string {
  return pctOf(p.numbers.pEff ?? p.numbers.p ?? 0)
}

/** Machine refund on removal: round(price × removalRefund) (Q11). */
export function refundOf(price: number, frac: number): number {
  return Math.round(price * frac)
}

/** `Sell for $75 (50%)` */
export function sellLabel(price: number, frac: number): string {
  return `Sell for ${formatMoney(refundOf(price, frac))} (${pctOf(frac)})`
}

/** `Audrey`, `Audrey and Lin`, `Audrey, Lin and Sem`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * `Remove desk — 2 inspectors walk out, no refund` (§2.2, §6.2). Walked-out
 * inspectors holding a seat (`away`) are let go too (people.ts fireEmployee
 * 'deskRemoved'), so with any of them the line counts everyone:
 * `Remove desk — 2 inspectors let go, no refund`.
 */
export function removeDeskLine(n: number, away = 0): string {
  const all = n + away
  if (all === 0) return 'Remove desk — no refund'
  if (away > 0)
    return `Remove desk — ${all === 1 ? '1 inspector' : `${all} inspectors`} let go, no refund`
  const who = n === 1 ? '1 inspector walks' : `${n} inspectors walk`
  return `Remove desk — ${who} out, no refund`
}

/**
 * The confirm text: `Audrey and Lin walk out, no refund.` (§2.5); the
 * walked-out ones holding a seat are named too: `Lin (walked out) is let go,
 * no refund.` / `Audrey walks out and Lin (walked out) is let go, no refund.`
 */
export function removeDeskPrompt(
  names: readonly string[],
  away: readonly string[] = [],
): string {
  if (names.length === 0 && away.length === 0)
    return 'The empty desk is removed.'
  const parts: string[] = []
  if (names.length > 0)
    parts.push(
      `${joinNames(names)} ${names.length === 1 ? 'walks' : 'walk'} out`,
    )
  if (away.length > 0)
    parts.push(
      `${joinNames(away)} (walked out) ${away.length === 1 ? 'is' : 'are'} let go`,
    )
  return `${parts.join(' and ')}, no refund.`
}

/** The confirm text for a machine: `Refund $75 (50% of $150).` */
export function sellPrompt(price: number, frac: number): string {
  return `Refund ${formatMoney(refundOf(price, frac))} (${pctOf(frac)} of ${formatMoney(price)}).`
}

/** Display name of a placed fixture (machines.json name, or the desk). */
export function fixtureName(
  data: GameData,
  c: Pick<Checker, 'kind' | 'defId'>,
): string {
  if (c.kind === 'desk') return DESK_NAME
  return data.machines.checkers.find((d) => d.id === c.defId)?.name ?? c.defId
}

type DeskFixture = Extract<Fixture, { kind: 'desk' }>

/** One desk card row: a seated inspector, or a walked-out one holding a seat. */
export interface DeskPersonRow {
  person: PersonView
  seated: boolean
}

/**
 * The desk's person rows: its seated inspectors in seat order, then the
 * walked-out ones holding a seat (fixture ids resolved through
 * ViewSim.people(); an id with no person is skipped).
 */
export function deskPersonRows(
  f: Pick<DeskFixture, 'inspectorIds' | 'walkedOutIds'>,
  people: readonly PersonView[],
): DeskPersonRow[] {
  const byId = new Map(people.map((p) => [p.id, p]))
  const rows: DeskPersonRow[] = []
  for (const id of f.inspectorIds) {
    const p = byId.get(id)
    if (p) rows.push({ person: p, seated: true })
  }
  for (const id of f.walkedOutIds) {
    const p = byId.get(id)
    if (p) rows.push({ person: p, seated: false })
  }
  return rows
}

/** Σ salaryPerDay of the seated (active) inspectors of a desk. */
export function deskSalaryTotal(rows: readonly DeskPersonRow[]): number {
  let sum = 0
  for (const r of rows)
    if (r.seated && r.person.active) sum += r.person.salaryPerDay
  return sum
}

// ---- the card --------------------------------------------------------------------

type MoveRequest = (nodeId: string) => void

export class SlotCard extends WarehouseSheet {
  private node: string | null = null
  private moveCb: MoveRequest | null = null
  private dialog: Dialog | null = null
  private laneText: Phaser.GameObjects.BitmapText | null = null
  private laneStrain: Strain | null = null
  private salaryText: Phaser.GameObjects.BitmapText | null = null
  private hireBtn: Button | null = null
  private hireCaption: Phaser.GameObjects.BitmapText | null = null
  private rehireBtns: { btn: Button; fee: number }[] = []

  constructor(
    scene: Phaser.Scene,
    L: WarehouseSheetLayout,
    viewSim: ViewSim,
    opts: WarehouseSheetOptions = {},
  ) {
    super(scene, L, viewSim, {
      ...opts,
      id: SLOT_CARD_ID,
      height: MACHINE_CARD_H,
    })
    const dirty = (): void => this.markDirty()
    this.bind({
      'worker:hired': dirty,
      'worker:fired': dirty,
      'worker:walkedOut': dirty,
      'payroll:paid': dirty,
      'payroll:short': dirty,
      'money:changed': () => this.update(),
      'lane:fixturePlaced': dirty,
      'lane:fixtureMoved': dirty,
      'lane:fixtureRemoved': dirty,
      'level:up': dirty,
    })
  }

  /** The slot shown (null while closed). */
  get nodeId(): string | null {
    return this.isOpen() ? this.node : null
  }

  /** Open on a slot that holds a fixture (ignored otherwise). */
  open(nodeId: string): void {
    const n = findNode(this.vs, nodeId)
    if (!n || n.kind !== 'slot' || !n.fixture) return
    this.node = nodeId
    this.show()
  }

  /**
   * The scene's tap-target mode for Move: called with the source node id
   * after the card closes (the scene then calls lane.moveFixture).
   */
  onMoveRequest(cb: MoveRequest | null): void {
    this.moveCb = cb
  }

  override destroy(): void {
    this.dialog?.destroy()
    this.dialog = null
    super.destroy()
  }

  // ---- WarehouseSheet hooks ------------------------------------------------

  protected valid(): boolean {
    const n = this.node ? findNode(this.vs, this.node) : null
    return !!n && n.kind === 'slot' && !!n.fixture
  }

  protected contentHeight(): number {
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (f?.kind !== 'desk') return MACHINE_CARD_H
    return deskCardHeight(this.personRows(f).length)
  }

  protected closed(): void {
    this.dialog?.destroy()
    this.dialog = null
  }

  protected refresh(): void {
    this.updateLane()
    this.updateSalary()
    this.update()
  }

  protected build(): void {
    this.laneText = null
    this.salaryText = null
    this.hireBtn = null
    this.hireCaption = null
    this.rehireBtns = []
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (!n || !f) return
    const data = this.vs.data
    const name =
      f.kind === 'desk' ? deskTitle(f.index) : fixtureName(data, f.checker)
    const frame: FrameName =
      f.kind === 'desk' ? 'desk' : machineFrame(f.checker.defId)
    this.image(PAD, f.kind === 'desk' ? 22 : 14, frame)
    this.text(64, textTop(16, 20), name)
    this.text(64, textTop(36, 20), this.label(n.id), MUTED)
    if (f.kind === 'desk') this.buildDesk(n)
    else this.buildMachine(n)
  }

  // ---- machine ---------------------------------------------------------------

  private buildMachine(n: LaneNode): void {
    const f = n.fixture
    if (!f) return
    const c = f.checker
    const W = this.L.W
    let y = LINE_Y
    const strainIcon =
      c.strain === 'any' ? null : (`ic_strain_${c.strain}` as FrameName)
    let tx = PAD + 4
    if (strainIcon) {
      this.image(tx, y + 2, strainIcon)
      tx += 20
    }
    this.text(tx, textTop(y, 20), strainCatchLine(c))
    y += LINE_PITCH
    this.text(PAD + 4, textTop(y, 20), machineSpeedLine(c, n.stations.length))
    y += LINE_PITCH
    this.laneStrain = c.strain === 'any' ? this.weakestStrain() : c.strain
    this.laneText = this.text(PAD + 4, textTop(y, 20), '')
    this.updateLane()
    y += LINE_PITCH + 4
    this.text(PAD + 4, textTop(y, 20), 'Moves are free', MUTED)

    const by = MACHINE_CARD_H - PAD - BTN_H
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    this.moveButton(PAD, by, bw)
    const frac = this.vs.data.machines.removalRefund
    const sell: Button = this.button(W - PAD - bw, by, bw, BTN_H, {
      id: 'slot:sell',
      label: sellLabel(c.price, frac),
      face: 'red',
      onClick: () =>
        this.confirm(
          `Sell ${fixtureName(this.vs.data, c)}`,
          sellPrompt(c.price, frac),
          'Sell',
          sell,
        ),
    })
  }

  private weakestStrain(): Strain | null {
    const det = this.vs.lane.detection()
    let best: { strain: Strain; d: number } | null = null
    for (const x of det) if (!best || x.d < best.d) best = x
    return best?.strain ?? null
  }

  private updateLane(): void {
    const t = this.laneText
    const s = this.laneStrain
    if (!t || !s) return
    const det = this.vs.lane.detection().find((x) => x.strain === s)
    const d = det ? det.d : laneRateFor(this.vs.lane.nodes(), s)
    const line = laneVsLine(s, d)
    if (t.text !== line) t.setText(line)
    t.setTint(TONE_TEXT[detectionTone(Math.round(d * 100))])
  }

  // ---- desk -------------------------------------------------------------------

  /** Seated inspectors, then the walked-out ones holding a seat. */
  private personRows(f: DeskFixture): DeskPersonRow[] {
    return deskPersonRows(f, this.vs.people())
  }

  private buildDesk(n: LaneNode): void {
    const f = n.fixture
    if (f?.kind !== 'desk') return
    const data = this.vs.data
    const max = data.employees.desks.maxPerDesk
    const W = this.L.W
    const seatedN = f.inspectorIds.length
    const rows = this.personRows(f)
    let y = LINE_Y
    const rate = deskRatePerMin(n.stations, f.checker.processTicks)
    this.text(
      PAD + 4,
      textTop(y, 20),
      deskStatsLine(f.checker.pMatch, f.checker.decoyFlag, rate, seatedN),
    )
    y += LINE_PITCH
    this.text(PAD + 4, textTop(y, 20), inspectorsLine(seatedN, max))
    y += LINE_PITCH
    for (const row of rows) {
      if (row.seated) this.seatedRow(row.person, y)
      else this.walkedOutRow(row.person, y)
      y += PERSON_ROW_H
    }
    y += 4
    this.salaryText = this.text(PAD + 4, textTop(y, 20), '')
    this.updateSalary()
    y += 26
    const hire: Button = this.button(PAD, y, HIRE_W, HIRE_H, {
      id: 'slot:hire',
      label: HIRE_INSPECTOR,
      face: 'primary',
      onClick: () => this.hire(hire),
      onDisabledTap: () => {
        const why = this.hireReason()
        this.deny(hire, why ?? warehouseFailText('invalid'))
      },
    })
    this.hireBtn = hire
    this.hireCaption = this.text(
      PAD + HIRE_W + 8,
      textTop(y, HIRE_H),
      '',
      RED_TEXT,
    )
    this.update()
    y += HIRE_H + 12
    const names = rows.filter((r) => r.seated).map((r) => r.person.name)
    const away = rows.filter((r) => !r.seated).map((r) => r.person.name)
    this.text(
      PAD + 4,
      textTop(y, 20),
      removeDeskLine(seatedN, away.length),
      MUTED,
    )

    const by = deskCardHeight(rows.length) - PAD - BTN_H
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    this.moveButton(PAD, by, bw)
    const remove: Button = this.button(W - PAD - bw, by, bw, BTN_H, {
      id: 'slot:remove',
      label: 'Remove desk',
      face: 'red',
      onClick: () =>
        this.confirm(
          'Remove desk',
          removeDeskPrompt(names, away),
          'Remove',
          remove,
        ),
    })
  }

  /** face · name (★) · pips · pEff · `! unpaid` · [Fire] */
  private seatedRow(p: PersonView, y: number): void {
    const W = this.L.W
    const ty = textTop(y, PERSON_ROW_H)
    this.face(FACE_X, y + Math.floor((PERSON_ROW_H - FACE_SIZE) / 2), p.look)
    this.personName(NAME_X, ty, p.name, p.star, NAME_W)
    this.pips(
      PIPS_X,
      y + Math.floor((PERSON_ROW_H - PIP_SIZE) / 2),
      pipGroups(this.vs.data, 'inspector', p.pips),
    )
    this.text(PEFF_X, ty, pEffText(p))
    if (p.unpaid) this.text(UNPAID_X, ty, '! unpaid', RED_TEXT)
    this.fireButton(p, W - PAD - FIRE_W, y)
  }

  /** face (dimmed) · `Lin walked out` · [Re-hire $24] [Fire] */
  private walkedOutRow(p: PersonView, y: number): void {
    const W = this.L.W
    const ty = textTop(y, PERSON_ROW_H)
    this.face(
      FACE_X,
      y + Math.floor((PERSON_ROW_H - FACE_SIZE) / 2),
      p.look,
    )?.setAlpha(AWAY_ALPHA)
    this.text(NAME_X, ty, `${p.name} walked out`, MUTED)
    const fireX = W - PAD - FIRE_W
    this.fireButton(p, fireX, y)
    const fee = rehireFee(this.vs.data, p.salaryPerDay)
    const rehire: Button = this.button(
      fireX - ROW_BTN_GAP - REHIRE_W,
      y + Math.floor((PERSON_ROW_H - SMALL_BTN_H) / 2),
      REHIRE_W,
      SMALL_BTN_H,
      {
        id: `slot:rehire:${p.id}`,
        label: rehireLabel(fee),
        face: 'primary',
        onClick: () => this.rehire(p.id, rehire),
        onDisabledTap: () =>
          this.deny(
            rehire,
            SIM_FEATURES.payroll
              ? (rehireBlockReason(this.vs.money, fee) ??
                  warehouseFailText('invalid'))
              : warehouseFailText('locked'),
          ),
      },
    )
    this.rehireBtns.push({ btn: rehire, fee })
  }

  private fireButton(p: PersonView, x: number, y: number): void {
    const fire: Button = this.button(
      x,
      y + Math.floor((PERSON_ROW_H - SMALL_BTN_H) / 2),
      FIRE_W,
      SMALL_BTN_H,
      {
        id: `slot:fire:${p.id}`,
        label: 'Fire',
        onClick: () => this.fire(p.id, fire),
      },
    )
  }

  private hireReason(): string | null {
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (f?.kind !== 'desk') return null
    return hireBlockReason(
      f.inspectorIds.length,
      this.vs.data.employees.desks.maxPerDesk,
      f.walkedOutIds.length,
    )
  }

  /** Hire / Re-hire state + caption (Re-hire live on money:changed). */
  private update(): void {
    for (const r of this.rehireBtns)
      r.btn.setEnabled(
        SIM_FEATURES.payroll &&
          rehireBlockReason(this.vs.money, r.fee) === null,
      )
    const b = this.hireBtn
    const cap = this.hireCaption
    if (!b || !cap) return
    const why = this.hireReason()
    b.setEnabled(why === null)
    const s = why ?? ''
    if (cap.text !== s) cap.setText(s)
  }

  private updateSalary(): void {
    const t = this.salaryText
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (!t || f?.kind !== 'desk') return
    const line = salaryLine(
      deskSalaryTotal(this.personRows(f)),
      this.vs.ticksToPayday,
    )
    if (t.text !== line) t.setText(line)
    t.setTint(this.vs.payroll().short ? RED_TEXT : THEME.textDark)
  }

  // ---- actions ------------------------------------------------------------------

  private moveButton(x: number, y: number, w: number): void {
    const move: Button = this.button(x, y, w, BTN_H, {
      id: 'slot:move',
      label: 'Move',
      onClick: () => {
        const node = this.node
        const cb = this.moveCb
        if (!node) return
        if (!cb) {
          this.deny(move, 'Long-press the fixture to drag it')
          return
        }
        this.close()
        cb(node)
      },
    })
  }

  /** The HireSheet for this desk (the scene's); the card reopens after it. */
  private hire(btn: Button): void {
    const node = this.node
    if (!node) return
    const why = this.hireReason()
    if (why !== null) {
      this.deny(btn, why)
      return
    }
    const back = (): void => this.open(node)
    this.requestHire(
      {
        role: 'inspector',
        target: { nodeId: node },
        title: HIRE_INSPECTOR_TITLE,
        onDone: back,
        onCancel: back,
      },
      btn,
    )
  }

  private fire(employeeId: number, btn: Button): void {
    const res = this.vs.fire(employeeId)
    if (!res.ok) this.denyResult(btn, res)
    this.markDirty()
  }

  private rehire(employeeId: number, btn: Button): void {
    const res = this.vs.lane.rehire(employeeId)
    if (!res.ok) this.denyResult(btn, res)
    this.markDirty()
  }

  private confirm(
    title: string,
    text: string,
    action: string,
    btn: Button,
  ): void {
    const node = this.node
    if (!node) return
    this.dialog?.destroy()
    this.dialog = new Dialog(this.scene, {
      title,
      text,
      action,
      destructive: true,
      W: this.L.W,
      H: this.L.H,
      minHit: this.L.minHit,
      id: 'slot:removeDialog',
      onConfirm: () => {
        this.dialog = null
        const res = this.vs.lane.removeFixture(node)
        if (res.ok) this.close()
        else this.denyResult(btn, res)
      },
      onCancel: () => {
        this.dialog = null
      },
    })
  }
}
