// Warehouse HoldBayCard (warehouse-view.md §3.1, §3.5; plan.md §8; spec
// §5.3, §5.4, §6.6): the card of a held parcel, a WarehouseSheet
// (BuySheet.ts) opened with `open(parcelId)`, height 248, drawn on the
// `ui_card_held` nine-slice (its border is the reserved malware colour
// mal1 — every held parcel gets the same dark card).
//
//   header  the dark held-parcel sprite, trait icon + the label
//           (`cookie-tin@3.2.1`), size icon + `S · $20 base`, `Bay 1`
//   line 3  `From Cache Cafe (Registry Row) → Node Heights Towers A
//           (Node Heights)` (building names + district flavour names; wraps)
//   line 4  `Flagged by: Metal detector (metal)`
//   line 5  decay ring + `Value now $38 · falling` (re-read every 500 ms,
//           spec §5.3: the value keeps decaying while held; `drops in 0:42`
//           inside the grace window, `floor` at the floor)
//   line 6  `Inspector Audrey` (desk flags only)
//   TOSS (left, red, 160×48) / CLEAR (right, green `ui_btn_green` face,
//           160×48) → holdBay.toss / clear; CLEAR is disabled with the
//           caption `Shelf full` while the shelf is at cap (Q35); TOSS is
//           always enabled. The header's `Bay N` is the sim's stable bay
//           (M3: a parcel keeps its bay until it leaves the rack).
// The card never says whether the parcel is malware (§5.4): the trait shown
// is the flagging machine's own strain (a specialised machine only
// false-flags decoys of its own strain, so the parcel's strain would give a
// pOther catch away); generalists (desk, X-ray) show no trait — their decoy
// flags carry traits of strains not yet announced, which would mark them
// clean. Odds are never shown.
// It closes on `parcel:tossed` / `parcel:cleared_by_player` for its parcel,
// when the parcel leaves the Hold Bay any other way, and on `game:over`.
import type Phaser from 'phaser'
import type { GameData } from '../../data/types.ts'
import { frameOrNull } from '../../render/frames.ts'
import type {
  Checker,
  Employee,
  LaneNode,
  Parcel,
  Strain,
  Tick,
} from '../../sim/types.ts'
import { ageS, paidValue, valueAt } from '../../sim/value.ts'
import type { ViewSim } from '../../sim/view-api.ts'
import type { Button, ButtonVisual } from '../Button.ts'
import { addPanel } from '../Panel.ts'
import { formatClock, formatMoney, textTop } from '../text.ts'
import { PALETTE, THEME } from '../theme.ts'
import {
  employeesOf,
  MUTED,
  PAD,
  RED_TEXT,
  WarehouseSheet,
  type WarehouseSheetLayout,
  type WarehouseSheetOptions,
} from './BuySheet.ts'
import { fixtureName, joinNames } from './SlotCard.ts'

export const HOLD_CARD_ID = 'wh:hold'
/** warehouse-view.md §3.1 */
export const HOLD_CARD_H = 248
export const ACTION_W = 160
export const ACTION_H = 48
export const ACTION_GAP = 8
/** Line tops (sheet-local). */
export const ROUTE_Y = 60
export const FLAG_Y = 92
export const VALUE_Y = 114
export const CREW_Y = 136
export const ACTIONS_Y = 172
export const CAPTION_Y = 224
/** Value line tint per phase (the city's decay colours: amber falling, red floor). */
export const VALUE_TINT: Record<ValuePhase, number> = {
  grace: THEME.textDark,
  locked: THEME.textDark,
  falling: PALETTE.yellow0,
  floor: PALETTE.red0,
}
/** Frames of the decay coin ring (ring_0 full … ring_8 empty, manifest `ring`). */
export const RING_FRAMES = 9
/** CLEAR's confirm face (art/STYLE.md §7 green button, manifest ui_btn_green). */
export const GREEN_UP = 'ui_btn_green'
export const GREEN_DOWN = 'ui_btn_green_down'

// ---- pure helpers ----------------------------------------------------------------

/** `Cache Cafe (Registry Row)`: building name + its district's flavour name. */
export function placeName(data: GameData, buildingId: string): string {
  const b = data.buildings.find((x) => x.id === buildingId)
  if (!b) return buildingId
  const d = data.districts.find((x) => x.id === b.district)
  return d ? `${b.name} (${d.flavour})` : b.name
}

/** `From Cache Cafe (Registry Row) → Node Heights Towers A (Node Heights)` */
export function routeLine(
  data: GameData,
  origin: string,
  dest: string,
): string {
  return `From ${placeName(data, origin)} → ${placeName(data, dest)}`
}

/** `S · $20 base` (the parcel's base value incl. any multiplier). */
export function sizeLine(
  p: Pick<Parcel, 'size' | 'baseValue' | 'mult'>,
): string {
  return `${p.size} · ${formatMoney(Math.round(p.baseValue * p.mult))} base`
}

/** `Flagged by: Metal detector (metal)`; no trait → no parentheses. */
export function flaggedByLine(name: string, trait: string | null): string {
  return trait ? `Flagged by: ${name} (${trait})` : `Flagged by: ${name}`
}

/** `Inspector Audrey` / `Inspectors Audrey and Lin` (desk flags, §3.1 line 6). */
export function crewLine(names: readonly string[]): string | null {
  if (names.length === 0) return null
  return `${names.length === 1 ? 'Inspector' : 'Inspectors'} ${joinNames(names)}`
}

export type ValuePhase = 'grace' | 'falling' | 'floor' | 'locked'

/**
 * `Value now $38 · falling` (spec §5.3: f = 1 up to decay.graceS, linear to
 * decay.floor at floorAtS, flat after): `· drops in 0:42` in the grace
 * window, `· floor` at the floor; an overseas value locked at hand-off is
 * `· locked` (build 2).
 */
export function valueNow(
  data: GameData,
  p: Pick<Parcel, 'spawnedTick' | 'baseValue' | 'mult' | 'lockedValue'>,
  tick: Tick,
): { value: number; phase: ValuePhase; text: string } {
  const value = paidValue(data, p, tick)
  const head = `Value now ${formatMoney(value)}`
  if (p.lockedValue !== null)
    return { value, phase: 'locked', text: `${head} · locked` }
  const age = ageS(p, tick)
  const { graceS, floorAtS } = data.parcels.decay
  if (age <= graceS)
    return {
      value,
      phase: 'grace',
      text: `${head} · drops in ${formatClock(graceS - age)}`,
    }
  if (age < floorAtS)
    return { value, phase: 'falling', text: `${head} · falling` }
  return { value, phase: 'floor', text: `${head} · floor` }
}

/** Decay ring frame index: 0 at full value … 8 at the floor (stays there). */
export function ringIndex(
  data: GameData,
  p: Pick<Parcel, 'spawnedTick' | 'baseValue' | 'mult' | 'lockedValue'>,
  tick: Tick,
): number {
  const full = p.baseValue * p.mult
  if (full <= 0) return RING_FRAMES - 1
  const f = valueAt(data, p, tick) / full
  const floor = data.parcels.decay.floor
  const lost = floor < 1 ? (1 - f) / (1 - floor) : 0
  const i = Math.round(lost * (RING_FRAMES - 1))
  return Math.min(RING_FRAMES - 1, Math.max(0, i))
}

/**
 * The green face over a button in `visual` state: up / pressed frames, or
 * null (disabled and the red stall look keep the kit's own frame).
 */
export function greenFace(visual: ButtonVisual): string | null {
  if (visual === 'down') return GREEN_DOWN
  if (visual === 'normal' || visual === 'glow') return GREEN_UP
  return null
}

/**
 * Give a kit Button the green confirm face: a `ui_btn_green` nine-slice
 * just above its own face (under the label), following the button's state
 * on every pointer event and on `sync()` (call it after setEnabled). The
 * kit's face stays the hit target; the overlay is not interactive.
 */
export function useGreenFace(btn: Button): { sync: () => void } {
  const face = addPanel(btn.scene, 0, 0, btn.btnWidth, btn.btnHeight, GREEN_UP)
  btn.addAt(face, 1)
  const sync = (): void => {
    if (!face.scene) return
    const f = frameOrNull(greenFace(btn.visual) ?? '')
    face.setVisible(f !== null)
    if (f && face.frame.name !== f) face.setFrame(f)
  }
  for (const ev of ['pointerdown', 'pointerup', 'pointerout'])
    btn.bg.on(ev, sync)
  sync()
  return { sync }
}

/** Why CLEAR is disabled (Q35: the shelf is at cap), or null. */
export function clearBlockReason(
  shelfCount: number,
  cap: number,
): string | null {
  return shelfCount >= cap ? 'Shelf full' : null
}

/** The checker that flagged the parcel (by Checker.id) and its slot, or null. */
export function flaggerOf(
  nodes: readonly LaneNode[],
  checkerId: string | null,
): { node: LaneNode; checker: Checker } | null {
  if (!checkerId) return null
  for (const n of nodes)
    if (n.fixture?.checker.id === checkerId)
      return { node: n, checker: n.fixture.checker }
  return null
}

/**
 * The trait shown on the card and the parcel (spec glossary "Flag / reveal":
 * the flagging checker's trait icon; never a malware tell, see the header):
 * a specialised checker's own strain; none for a generalist (desk, X-ray,
 * strain 'any') or a checker no longer in the lane. A generalist's decoy
 * flag carries the decoy's trait, drawn over every strain (spawn.ts), while
 * L1 malware is only ever an announced strain, so showing it would mark
 * every non-announced icon as a clean parcel (UX M2 review).
 */
export function shownTrait(
  checker: Pick<Checker, 'strain'> | null,
): Strain | null {
  return checker && checker.strain !== 'any' ? checker.strain : null
}

// ---- the card --------------------------------------------------------------------

export class HoldBayCard extends WarehouseSheet {
  private pid: number | null = null
  private valueText: Phaser.GameObjects.BitmapText | null = null
  private ring: Phaser.GameObjects.Image | null = null
  private clearBtn: Button | null = null
  private clearFace: { sync: () => void } | null = null
  private caption: Phaser.GameObjects.BitmapText | null = null
  private bayText: Phaser.GameObjects.BitmapText | null = null

  constructor(
    scene: Phaser.Scene,
    L: WarehouseSheetLayout,
    viewSim: ViewSim,
    opts: WarehouseSheetOptions = {},
  ) {
    super(scene, L, viewSim, {
      ...opts,
      id: HOLD_CARD_ID,
      height: HOLD_CARD_H,
      frame: 'ui_card_held',
    })
    const gone = (p: { id: number }): void => {
      if (p.id === this.pid) this.close()
    }
    const shelf = (): void => this.updateActions()
    this.bind({
      'parcel:tossed': gone,
      'parcel:cleared_by_player': gone,
      'parcel:shelved': shelf,
      'parcel:loaded': shelf,
      'parcel:returned': shelf,
      'parcel:held': () => this.updateBay(),
      'level:up': shelf,
    })
  }

  /** The parcel shown (null while closed). */
  get parcelId(): number | null {
    return this.isOpen() ? this.pid : null
  }

  /** Open on a held parcel (ignored when it is not in the Hold Bay). */
  open(parcelId: number): void {
    if (!this.held(parcelId)) return
    this.pid = parcelId
    this.show()
  }

  // ---- WarehouseSheet hooks ------------------------------------------------

  protected contentHeight(): number {
    return HOLD_CARD_H
  }

  protected valid(): boolean {
    return this.pid !== null && this.held(this.pid)
  }

  protected refresh(): void {
    this.updateValue()
    this.updateActions()
    this.updateBay()
  }

  protected build(): void {
    this.valueText = null
    this.ring = null
    this.clearBtn = null
    this.clearFace = null
    this.caption = null
    this.bayText = null
    const id = this.pid
    const p = id === null ? null : this.vs.parcel(id)
    if (!p) return
    const data = this.vs.data
    const W = this.L.W
    const size = p.size.toLowerCase()
    const flag = flaggerOf(this.vs.lane.nodes(), p.flaggedBy)
    const trait = shownTrait(flag?.checker ?? null)

    // header: dark parcel, trait + label, size + base, bay number
    const parcel =
      frameOrNull(`parcel_${size}_mal`) ?? frameOrNull('parcel_s_mal')
    if (parcel) this.image(PAD, 16, parcel)
    let x = 48
    const traitIcon = trait ? frameOrNull(`ic_strain_${trait}`) : null
    if (traitIcon) {
      this.image(x, 16, traitIcon)
      x += 20
    }
    this.text(x, textTop(16, 16), p.label)
    const sizeIcon = frameOrNull(`ic_parcel_${size}`)
    if (sizeIcon) this.image(48, 36, sizeIcon)
    this.text(sizeIcon ? 68 : 48, textTop(36, 16), sizeLine(p), MUTED)
    this.bayText = this.text(0, textTop(16, 16), '', MUTED)
    this.updateBay()

    // route, flagger, value, crew
    this.text(
      PAD + 4,
      ROUTE_Y,
      routeLine(data, p.origin, p.dest),
      THEME.textDark,
      W - 2 * PAD - 8,
    )
    const name = flag ? fixtureName(data, flag.checker) : 'a removed checker'
    this.text(PAD + 4, textTop(FLAG_Y, 20), flaggedByLine(name, trait))
    this.ring = this.image(PAD + 4, VALUE_Y + 2, 'ring_0')
    this.valueText = this.text(PAD + 24, textTop(VALUE_Y, 20), '')
    this.updateValue()
    if (flag?.checker.kind === 'desk' && flag.node.fixture?.kind === 'desk') {
      const ids = flag.node.fixture.inspectorIds
      const emps = employeesOf(this.vs, this.scene)
      const names = ids
        .map((eid) => emps.find((e: Employee) => e.id === eid)?.name)
        .filter((s): s is string => !!s)
      const crew = crewLine(names)
      if (crew) this.text(PAD + 4, textTop(CREW_Y, 20), crew, MUTED)
    }

    // TOSS / CLEAR
    const x0 = Math.round((W - (2 * ACTION_W + ACTION_GAP)) / 2)
    const toss: Button = this.button(x0, ACTIONS_Y, ACTION_W, ACTION_H, {
      id: 'hold:toss',
      label: 'TOSS',
      face: 'red',
      onClick: () => {
        if (this.pid === null) return
        const res = this.vs.holdBay.toss(this.pid)
        if (res.ok) this.close()
        else this.denyResult(toss, res)
      },
    })
    const cx = x0 + ACTION_W + ACTION_GAP
    const clear: Button = this.button(cx, ACTIONS_Y, ACTION_W, ACTION_H, {
      id: 'hold:clear',
      label: 'CLEAR',
      face: 'primary',
      onClick: () => {
        if (this.pid === null) return
        const res = this.vs.holdBay.clear(this.pid)
        if (res.ok) this.close()
        else this.denyResult(clear, res)
      },
      onDisabledTap: () => this.deny(clear, this.clearReason() ?? 'Shelf full'),
    })
    this.clearBtn = clear
    this.clearFace = useGreenFace(clear)
    this.caption = this.text(0, CAPTION_Y, '', RED_TEXT)
    this.updateActions()
  }

  // ---- internals ---------------------------------------------------------------

  private held(parcelId: number): boolean {
    return this.vs.holdBay.items.some((it) => it.parcelId === parcelId)
  }

  private clearReason(): string | null {
    const s = this.vs.shelf
    return clearBlockReason(s.ids.length, s.cap)
  }

  private updateValue(): void {
    const id = this.pid
    const p = id === null ? null : this.vs.parcel(id)
    if (!p || !this.valueText) return
    const v = valueNow(this.vs.data, p, this.vs.tick)
    if (this.valueText.text !== v.text) this.valueText.setText(v.text)
    this.valueText.setTint(VALUE_TINT[v.phase])
    const ring = frameOrNull(`ring_${ringIndex(this.vs.data, p, this.vs.tick)}`)
    if (ring && this.ring && this.ring.frame.name !== ring)
      this.ring.setFrame(ring)
  }

  private updateActions(): void {
    const b = this.clearBtn
    const cap = this.caption
    if (!b || !cap) return
    const why = this.clearReason()
    b.setEnabled(why === null)
    this.clearFace?.sync()
    const s = why ?? ''
    if (cap.text !== s) cap.setText(s)
    cap.setX(Math.round(b.x + (ACTION_W - cap.width) / 2))
  }

  private updateBay(): void {
    const t = this.bayText
    if (!t || this.pid === null) return
    const it = this.vs.holdBay.items.find((i) => i.parcelId === this.pid)
    const s = it ? `Bay ${it.bay + 1}` : ''
    if (t.text !== s) t.setText(s)
    t.setX(this.L.W - PAD - 4 - Math.round(t.width))
  }
}
