// Warehouse SlotCard (warehouse-view.md §2.2, §2.5; plan.md §8; spec §6.2,
// §6.3, §6.7, §7.3-§7.4): the card of an occupied slot, a WarehouseSheet
// (BuySheet.ts) opened with `open(nodeId)`.
//
// Header: the fixture's art + name, and the node's display label from the
// room layout (`labelFor(nodeId)`, never an index computed here).
// Machine (232 px): `metal · catch 80% / 15% other`, `false-flag 50% ·
// 60/min`, `Lane vs metal: 97%` (the lane's §6.3 D(strain), tinted by the
// readout thresholds), `Moves are free`, then [Move] [Sell for $75 (50%)]
// (machines.json removalRefund, Q11) → a Dialog confirm → removeFixture.
// Desk: `85% any strain · false-flag 15% · 30/min`, `Inspectors 2/3`, one
// 44-px row per inspector (worker sprite, name, red `! unpaid` after a short
// payday, [Fire] — instant, no refund), one row per walked-out inspector the
// desk can seat again ([Re-hire NAME ($20)], one day's salary × rehireFeeDays;
// disabled until the payroll system ships, SIM_FEATURES.payroll / M3), the
// salary line `Salaries: 2 × $20 = $40/day · Payday in 0:23` (re-read every
// 500 ms), [Hire inspector ($20)] (disabled with its reason as a caption at
// maxPerDesk or below the hire fee), `Remove desk — N inspectors walk out,
// no refund`, then [Move] [Remove desk] → Dialog confirm naming who walks out.
// Rows are 44 px (not the 24 px of the view doc) so every Fire / Re-hire
// button keeps a 44-px hit box without overlapping its neighbour.
//
// Move closes the card and hands the node id to the scene's tap-target mode
// (`onMoveRequest(cb)`: the scene highlights the other slots and calls
// lane.moveFixture on the next slot tap). Hire / Fire / Re-hire / Remove call
// the ViewSim facade directly; a refusal shakes the button and plays `deny`.
// The card re-renders on worker / payroll / money / fixture / level events
// and closes when its slot no longer holds a fixture.
import type Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import type { FrameName } from '../../render/frames.ts'
import { SIM_FEATURES } from '../../sim/features.ts'
import type { Checker, Employee, LaneNode, Strain } from '../../sim/types.ts'
import { TICKS_PER_S } from '../../sim/types.ts'
import { checkerP, type ViewSim } from '../../sim/view-api.ts'
import type { Button } from '../Button.ts'
import { Dialog } from '../Dialog.ts'
import { detectionTone, TONE_TEXT } from '../ShieldPopover.ts'
import { formatClock, formatMoney, textTop } from '../text.ts'
import { THEME } from '../theme.ts'
import {
  DESK_NAME,
  employeesOf,
  findNode,
  machineFrame,
  MUTED,
  PAD,
  pctOf,
  perMinText,
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
export const REHIRE_W = 150
export const HIRE_W = 184
export const HIRE_H = 36

// ---- pure helpers ----------------------------------------------------------------

/** Desk card height for `rows` person rows (inspectors + re-hirable walkouts). */
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

/** `85% any strain · false-flag 15% · 30/min` (stations = seated inspectors). */
export function deskStatsLine(
  c: Pick<Checker, 'pMatch' | 'decoyFlag' | 'processTicks'>,
  stations: number,
): string {
  return `${pctOf(c.pMatch)} any strain · false-flag ${pctOf(c.decoyFlag)} · ${perMinText(processSOf(c), stations)}`
}

/** `Inspectors 2/3` (+ the pass-through note while the desk is empty). */
export function inspectorsLine(n: number, max: number): string {
  const s = `Inspectors ${n}/${max}`
  return n === 0 ? `${s} — parcels pass unchecked` : s
}

/** `Salaries: 2 × $20 = $40/day · Payday in 0:23` (§7.3). */
export function salaryLine(
  n: number,
  salary: number,
  ticksToPayday: number,
): string {
  const payday = formatClock(ticksToPayday / TICKS_PER_S)
  return `Salaries: ${n} × ${formatMoney(salary)} = ${formatMoney(n * salary)}/day · Payday in ${payday}`
}

/** `Hire inspector ($20)` (employees.json hireFee, §6.7). */
export function hireLabel(fee: number): string {
  return `Hire inspector (${formatMoney(fee)})`
}

/** Why Hire is disabled, or null: the desk is full or the balance is short. */
export function hireBlockReason(
  n: number,
  max: number,
  balance: number,
  fee: number,
): string | null {
  if (n >= max) return 'Desk full'
  if (balance < fee) return 'Not enough money'
  return null
}

/** One day's salary × rehireFeeDays (§7.4). */
export function rehireFee(data: GameData): number {
  const e = data.employees
  return e.inspector.salaryPerDay * e.rehireFeeDays
}

/** `Re-hire Lin ($20)` */
export function rehireLabel(name: string, fee: number): string {
  return `Re-hire ${name} (${formatMoney(fee)})`
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

/** `Remove desk — 2 inspectors walk out, no refund` (§2.2, §6.2). */
export function removeDeskLine(n: number): string {
  if (n === 0) return 'Remove desk — no refund'
  const who = n === 1 ? '1 inspector walks' : `${n} inspectors walk`
  return `Remove desk — ${who} out, no refund`
}

/** The confirm text: `Audrey and Lin walk out, no refund.` (§2.5). */
export function removeDeskPrompt(names: readonly string[]): string {
  if (names.length === 0) return 'The empty desk is removed.'
  const verb = names.length === 1 ? 'walks' : 'walk'
  return `${joinNames(names)} ${verb} out, no refund.`
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
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (!n || !f) return
    const data = this.vs.data
    const name = fixtureName(data, f.checker)
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

  /** Seated inspectors, then the walkouts the desk has a free seat for. */
  private personRows(
    f: Extract<NonNullable<LaneNode['fixture']>, { kind: 'desk' }>,
  ): { e: Employee; seated: boolean }[] {
    const emps = this.employees()
    const seated = f.inspectorIds
      .map((id) => emps.find((e) => e.id === id))
      .filter((e): e is Employee => !!e)
      .map((e) => ({ e, seated: true }))
    const free = Math.max(
      0,
      this.vs.data.employees.inspector.maxPerDesk - seated.length,
    )
    const out = f.walkedOutIds
      .map((id) => emps.find((e) => e.id === id))
      .filter((e): e is Employee => !!e && !e.active)
      .slice(0, free)
      .map((e) => ({ e, seated: false }))
    return seated.concat(out)
  }

  private employees(): readonly Employee[] {
    return employeesOf(this.vs, this.scene)
  }

  private buildDesk(n: LaneNode): void {
    const f = n.fixture
    if (f?.kind !== 'desk') return
    const data = this.vs.data
    const def = data.employees.inspector
    const W = this.L.W
    const seatedN = f.inspectorIds.length
    let y = LINE_Y
    this.text(PAD + 4, textTop(y, 20), deskStatsLine(f.checker, seatedN))
    y += LINE_PITCH
    this.text(PAD + 4, textTop(y, 20), inspectorsLine(seatedN, def.maxPerDesk))
    y += LINE_PITCH
    const fee = rehireFee(data)
    for (const { e, seated } of this.personRows(f)) {
      const sprite = this.image(PAD + 4, y + 6, 'worker_s_idle_0')
      const ty = textTop(y, PERSON_ROW_H)
      if (seated) {
        const nameT = this.text(PAD + 36, ty, e.name)
        if (e.unpaidPaydays > 0)
          this.text(
            nameT.x + Math.round(nameT.width) + 6,
            ty,
            '! unpaid',
            RED_TEXT,
          )
        const fire: Button = this.button(
          W - PAD - FIRE_W,
          y + Math.floor((PERSON_ROW_H - SMALL_BTN_H) / 2),
          FIRE_W,
          SMALL_BTN_H,
          {
            id: `slot:fire:${e.id}`,
            label: 'Fire',
            onClick: () => this.fire(e.id, fire),
          },
        )
      } else {
        sprite.setAlpha(0.4)
        this.text(PAD + 36, ty, `${e.name} walked out`, MUTED)
        const rehire: Button = this.button(
          W - PAD - REHIRE_W,
          y + Math.floor((PERSON_ROW_H - SMALL_BTN_H) / 2),
          REHIRE_W,
          SMALL_BTN_H,
          {
            id: `slot:rehire:${e.id}`,
            label: rehireLabel(e.name, fee),
            onClick: () => this.rehire(e.id, rehire),
            onDisabledTap: () => this.deny(rehire, warehouseFailText('locked')),
          },
        )
        rehire.setEnabled(SIM_FEATURES.payroll)
      }
      y += PERSON_ROW_H
    }
    y += 4
    this.salaryText = this.text(PAD + 4, textTop(y, 20), '')
    this.updateSalary()
    y += 26
    const hire: Button = this.button(PAD, y, HIRE_W, HIRE_H, {
      id: 'slot:hire',
      label: hireLabel(def.hireFee),
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
    this.text(PAD + 4, textTop(y, 20), removeDeskLine(seatedN), MUTED)

    const by = deskCardHeight(this.personRows(f).length) - PAD - BTN_H
    const bw = Math.floor((W - 2 * PAD - BTN_GAP) / 2)
    this.moveButton(PAD, by, bw)
    const names = f.inspectorIds
      .map((id) => this.employees().find((e) => e.id === id)?.name)
      .filter((s): s is string => !!s)
    const remove: Button = this.button(W - PAD - bw, by, bw, BTN_H, {
      id: 'slot:remove',
      label: 'Remove desk',
      face: 'red',
      onClick: () =>
        this.confirm('Remove desk', removeDeskPrompt(names), 'Remove', remove),
    })
  }

  private hireReason(): string | null {
    const n = this.node ? findNode(this.vs, this.node) : null
    const f = n?.fixture
    if (f?.kind !== 'desk') return null
    const def = this.vs.data.employees.inspector
    return hireBlockReason(
      f.inspectorIds.length,
      def.maxPerDesk,
      this.vs.money,
      def.hireFee,
    )
  }

  /** Hire button state + caption from the balance (live on money:changed). */
  private update(): void {
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
      f.inspectorIds.length,
      this.vs.data.employees.inspector.salaryPerDay,
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

  private hire(btn: Button): void {
    const res = this.vs.lane.hireInspector()
    if (!res.ok) this.denyResult(btn, res)
    this.markDirty()
  }

  private fire(employeeId: number, btn: Button): void {
    const res = this.vs.lane.fireInspector(employeeId)
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
