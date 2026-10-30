// Lost-life card (city-view.md §9.3, §3.3 step 5; spec §10; plan.md §9
// "Cards"): the modal that explains every lost life. HudScene opens it
// LOST_LIFE_DELAY_MS after `life:lost` with `stepper.paused = true` and
// resumes on close. Content, top to bottom:
//
//   MALWARE DELIVERED (red)
//   parcel_<size>_mal 32x32 · label · ic_strain_<strain>
//   the route, one line per hop with mm:ss sim timestamps (payload.path):
//     Spawned at Lodash Smelting Works 11:02 · Picked up by Truck 1 11:20 ·
//     Unloaded 11:51 · Slot 1 Metal detector: missed (15% vs rattle) ·
//     Slot 2: empty · Shelved · Delivered to Node Heights Towers A 12:40
//   an overseas parcel (M8, spec-core §5.6, design-m8-m9 §6.3) ends with
//     `Handed off at Prefetch Pier 2 14:02` and `Cleared 14:47 — the ship
//     has sailed` (Airport: `— the plane has left`); the title stays
//     MALWARE DELIVERED (design R12)
//   Your lane's catch rate vs rattle was 15%
//   the counter: `A Shaky shaker would make it 83%`, or (counterOwned)
//     `This one got through on the 17%` (the rate line already gives 83%) +
//     `Another Shaky shaker would make it 97%`, or `Cleared by you at 11:58`
//   lives row (LivesRow) · [Open warehouse] [Continue]
//
// M6 (spec-build2 §2.3, design-m6 §6.3 / D14): a desk line names the
// inspector (`Slot 1 desk — Lin: missed (80% vs metal)`, the sim's trace
// text) and a sorter's tag shows as its own line (`Pat: looks clean (85%)`);
// the counter is the better of the machine line and `A 5-eye inspector at
// this desk would make it 99%` (detection.ts counterChoice: machine first on
// ties), both quoting the lane's compounded rate. When the inspector line
// wins, `Open warehouse` highlights no machine.
//
// The route list grows the card up to min(H − 80, 440) px (it fits its
// content below that); when a long path would not fit it tightens the line
// pitch 18 → 16 → 14 px, then merges runs of empty slots (`Slots 2–4:
// empty`), then elides the middle, keeping the delivery line — or, for an
// overseas parcel, the hand-off and clearance lines — at the end. A 6-slot
// overseas path (12 lines) fits 360×604 at the 18-px pitch (routeBudget).
//
// The card draws through its own full-screen camera over an off-screen
// origin (the Dialog pattern), so it covers every HUD camera; its dim
// backdrop swallows taps. Esc / Enter = Continue. The model functions are
// pure (tests/ui/lost-life-card.test.ts); Phaser is a type-only import.
import type Phaser from 'phaser'
import type { GameData, StrainId } from '../data/types.ts'
import type { FrameName } from '../render/frames.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { counterChoice } from '../sim/detection.ts'
import type { LifeLostPayload } from '../sim/events.ts'
import type { LaneNode, Size, TraceEntry } from '../sim/types.ts'
import { TICKS_PER_S } from '../sim/types.ts'
import { Button } from './Button.ts'
import type { Layout } from './layout.ts'
import { LivesRow, livesRowWidth } from './LivesRow.ts'
import { startInspectorP } from './Onboarding.ts'
import { addPanel } from './Panel.ts'
import { claimKey, offscreenOrigin, popModal, pushModal } from './Sheet.ts'
import { addText, lineCount, LINE_H, textTop } from './text.ts'
import { THEME } from './theme.ts'
import { sailedText } from './hubText.ts'

/** city-view §3.3 step 5: the card opens this long after `life:lost`. */
export const LOST_LIFE_DELAY_MS = 600
export const LOST_LIFE_TITLE = 'MALWARE DELIVERED'
export const CARD_MAX_H = 440
const PAD = 12
const BTN_H = 44
const BTN_GAP = 8
const ROUTE_PITCHES = [18, 16, 14] as const
const BACKDROP_ALPHA = 0.55
/** Card-local y of the first route line: title row 18 + parcel row 36. */
const ROUTE_TOP = PAD - 4 + 18 + 36
/** One rate / counter text line (unwrapped) in the tail. */
const TAIL_LINE = 18

// ---- model (pure) ---------------------------------------------------------------

/** Sim time `mm:ss` (minutes zero-padded, not wrapped into hours). */
export function simClock(tick: number): string {
  const s = Math.max(
    0,
    Math.floor((Number.isFinite(tick) ? tick : 0) / TICKS_PER_S),
  )
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** A 0..1 rate (or an already-percent value > 1) as a percent: whole below 99, one decimal from 99. */
export function ratePct(r: number): number {
  const v = Number.isFinite(r) ? r : 0
  const pct = v > 1 ? v : 100 * v
  if (pct >= 100) return 100
  // A checker chain never catches everything: from 99 % on the card keeps
  // one decimal (floored, at most 99.9) so a 99.8 % lane never reads "would
  // make it 100%", nor a stronger lane the same "99%" as a weaker one
  // ("got through on the 0%") — UX M3 review.
  if (pct >= 99) return Math.min(99.9, Math.floor(pct * 10) / 10)
  return Math.round(pct)
}

/** The share that got through: 100 − ratePct, without float noise (0.6, 17). */
export function missPct(r: number): number {
  return Math.round((100 - ratePct(r)) * 10) / 10
}

/** `A Shaky shaker`, `An X-ray`. */
export function withArticle(name: string, another = false): string {
  if (another) return `Another ${name}`
  // By sound: "An X-ray" (ex-ray), "A Shaky shaker".
  return /^([aeiou]|x-)/i.test(name) ? `An ${name}` : `A ${name}`
}

interface CheckerRow {
  name: string
  strain: string
  pMatch: number
  pOther: number
}

/**
 * The machines.json row of a checker def id; `inspector` (a desk) reads the
 * pre-hired start inspector's p from employees.json roles (M6: any strain,
 * p at the start eye pip) — a desk trace line carries its own text and p.
 */
export function checkerRow(data: GameData, defId: string): CheckerRow | null {
  if (defId === 'inspector') {
    const p = startInspectorP(data)
    const strain = data.employees.roles.inspector.strain
    return { name: DESK_NAME, strain, pMatch: p, pOther: p }
  }
  return data.machines.checkers.find((c) => c.id === defId) ?? null
}

function checkerP(row: CheckerRow, strain: string): number {
  return row.strain === 'any' || row.strain === strain ? row.pMatch : row.pOther
}

/** What the route needs beyond the payload. */
export interface RouteDeps {
  data: GameData
  /** Vehicle name by id (sold vehicles may return null → `a vehicle`). */
  vehicleName(id: number): string | null
  /** The lane now: resolves a slot's checker when the trace names none. */
  nodes: readonly LaneNode[]
}

export type SlotStatus = 'empty' | 'missed' | 'flagged'

export type RouteItem =
  | {
      kind: 'text'
      text: string
      /** The trace `what` of the hop (M8: fitRoute keeps the overseas tail). */
      what?: string
    }
  | {
      kind: 'slot'
      nodeId: string
      /** 1-based slot number from the node id, or null. */
      slot: number | null
      status: SlotStatus
      /** Checker display name (missed / flagged), else null. */
      checker: string | null
      /** Its catch chance vs the parcel's strain, 0..100, else null. */
      pct: number | null
      tick: number
      /** The sim's stored card line (TraceEntry.text), preferred when set. */
      text?: string
    }

/** What the card calls the inspectors' desk (as the sim's trace text does). */
export const DESK_NAME = 'Inspection desk'

/** Trace `what`s that report a checker's roll that did not flag. */
const MISSED_WHATS = new Set(['missed', 'passed', 'pass', 'checked', 'rolled'])
const EMPTY_WHATS = new Set(['empty', 'skipped', 'passthrough', 'unstaffed'])
const FLAG_WHATS = new Set(['flagged', 'caught'])
const CLEAR_WHATS = new Set(['cleared_by_player', 'clearedByPlayer', 'cleared'])
/** Hops whose line carries the mm:ss time (the spec §10 example; M8 the hand-off). */
const TIMED_WHATS = new Set([
  'spawned',
  'pickedUp',
  'unloaded',
  'delivered',
  'handedOff',
])
/**
 * M8 (spec-core §5.6): the overseas clearance — `Cleared 14:47 — the ship
 * has sailed`. Not the player's Hold Bay Clear (`cleared`, CLEAR_WHATS).
 */
const CUSTOMS_WHAT = 'customsCleared'
/** The hops fitRoute keeps at the end of an elided route (M8: overseas). */
const TAIL_WHATS = new Set(['handedOff', CUSTOMS_WHAT])
/** Hops the card leaves out: the spec example lists none of them. */
const SKIP_WHATS = new Set(['loaded', 'returned', 'held', 'tossed'])
/**
 * M6: the sorter's `looks clean` tag (spec-build2 §2.6) — its stored line
 * (`Pat: looks clean (85%)`) is shown untimed, never skipped.
 */
const SORTED_WHATS = new Set(['sorted'])

/** `slot3` → 3. */
export function slotNumber(nodeId: string): number | null {
  const m = /^slot(\d+)$/.exec(nodeId)
  return m ? Number(m[1]) : null
}

/**
 * A checker def id from a trace ref: a def id itself (`metal_detector`,
 * `inspector`), a checker instance id (`chk2`, looked up in the lane) or a
 * compound `slot1:metal_detector`; else the fixture now in `nodeId`.
 */
export function resolveCheckerDef(
  ref: string | null,
  nodeId: string,
  deps: RouteDeps,
): string | null {
  const parts = ref ? [ref, ...ref.split(/[:/|]/)] : []
  for (const c of parts) if (checkerRow(deps.data, c)) return c
  for (const c of parts) {
    const n = deps.nodes.find((x) => x.fixture?.checker.id === c)
    if (n?.fixture) return n.fixture.checker.defId
  }
  for (const c of parts) {
    const n = deps.nodes.find((x) => x.id === c)
    if (n?.fixture && n.stations.length > 0) return n.fixture.checker.defId
  }
  const here = deps.nodes.find((x) => x.id === nodeId)
  return here?.fixture && here.stations.length > 0
    ? here.fixture.checker.defId
    : null
}

/**
 * The route items of a lost parcel's trace (spec §10 wording). The sim
 * stores each hop's card line in `TraceEntry.text` (one slot entry per slot
 * left, ref = node id: empty / missed / passed / flagged / skipped): that
 * text is used as is, with the mm:ss time appended to the spawned, picked
 * up, unloaded, cleared, delivered and (M8) handed-off hops (and a flag);
 * the overseas clearance (`customsCleared`, ref = the hub) reads `Cleared
 * 14:47 — the ship has sailed` (`— the plane has left`). Entries without a
 * text are worded here: a `slot` entry opens a slot visit whose outcome is
 * the next roll entry naming it; a visit with no outcome entry is read from
 * the lane (a checker there now → missed, else empty). `loaded`, `returned`,
 * `held` and `tossed` add no line (the spec example lists none of them);
 * unknown hops show their stored text, if any.
 */
export function routeItems(
  path: readonly TraceEntry[],
  strain: StrainId | null,
  deps: RouteDeps,
): RouteItem[] {
  const data = deps.data
  const bname = (id: string | null): string =>
    data.buildings.find((b) => b.id === id)?.name ?? id ?? 'a building'
  const items: RouteItem[] = []
  let open: Extract<RouteItem, { kind: 'slot' }> | null = null
  let openSet = false
  const setChecker = (
    item: Extract<RouteItem, { kind: 'slot' }>,
    ref: string | null,
  ): void => {
    const def = resolveCheckerDef(ref, item.nodeId, deps)
    const row = def ? checkerRow(data, def) : null
    // The sim's own wording for the desk (detection.ts checkerName).
    item.checker = def === 'inspector' ? DESK_NAME : (row?.name ?? null)
    item.pct = row && strain ? Math.round(100 * checkerP(row, strain)) : null
  }
  const openFromRef = (
    ref: string | null,
    tick: number,
  ): Extract<RouteItem, { kind: 'slot' }> | null => {
    const parts = ref ? ref.split(/[:/|]/) : []
    const nodeId =
      parts.find((x) => slotNumber(x) !== null) ??
      deps.nodes.find((n) => parts.includes(n.fixture?.checker.id ?? ''))?.id
    if (!nodeId) return null
    return {
      kind: 'slot',
      nodeId,
      slot: slotNumber(nodeId),
      status: 'empty',
      checker: null,
      pct: null,
      tick,
    }
  }
  const closeOpen = (): void => {
    if (open && !openSet) {
      // No outcome entry: read the slot from the lane as it is now.
      setChecker(open, null)
      open.status = open.checker ? 'missed' : 'empty'
    }
    open = null
    openSet = false
  }
  // toSorted is stable: same-tick hops keep their trace order.
  const sorted = path.toSorted((a, b) => a.tick - b.tick)
  for (const e of sorted) {
    const t = simClock(e.tick)
    const w = e.what
    if (w === 'slot' || w === 'enteredSlot') {
      closeOpen()
      const nodeId = e.ref ?? ''
      open = {
        kind: 'slot',
        nodeId,
        slot: slotNumber(nodeId),
        status: 'empty',
        checker: null,
        pct: null,
        tick: e.tick,
      }
      items.push(open)
      continue
    }
    if (MISSED_WHATS.has(w) || EMPTY_WHATS.has(w) || FLAG_WHATS.has(w)) {
      // An outcome with no `slot` entry before it names its slot itself
      // (`slot2`, `slot2:metal_detector`) or its checker (`chk3`).
      // An open visit takes the outcome unless it already has one or the
      // outcome names another slot.
      const named = openFromRef(e.ref, e.tick)
      const fits =
        open !== null &&
        !openSet &&
        (named === null || named.nodeId === open.nodeId)
      const cur = fits ? open : named
      if (!cur) continue
      if (cur !== open) {
        closeOpen()
        items.push(cur)
        open = cur
      }
      cur.tick = e.tick
      if (e.text) cur.text = e.text
      if (EMPTY_WHATS.has(w)) {
        cur.status = 'empty'
        cur.checker = null
        cur.pct = null
      } else {
        setChecker(cur, e.ref)
        cur.status = FLAG_WHATS.has(w) ? 'flagged' : 'missed'
      }
      openSet = true
      if (FLAG_WHATS.has(w)) open = null
      continue
    }
    if (w === 'held') {
      const cur = open as Extract<RouteItem, { kind: 'slot' }> | null
      if (cur && !openSet) {
        setChecker(cur, null)
        cur.status = 'flagged'
        cur.tick = e.tick
        openSet = true
      }
      open = null
      continue
    }
    closeOpen()
    if (SKIP_WHATS.has(w)) continue
    if (SORTED_WHATS.has(w)) {
      if (e.text) items.push({ kind: 'text', text: e.text })
      continue
    }
    if (w === CUSTOMS_WHAT) {
      // ref = the hub district id (hubs.ts clearanceStep).
      const head = e.text ?? 'Cleared'
      items.push({
        kind: 'text',
        text: `${head} ${t} — ${sailedText(data, e.ref)}`,
        what: w,
      })
      continue
    }
    if (e.text) {
      const timed = TIMED_WHATS.has(w) || CLEAR_WHATS.has(w)
      items.push({
        kind: 'text',
        text: timed ? `${e.text} ${t}` : e.text,
        what: w,
      })
      continue
    }
    if (w === 'spawned')
      items.push({ kind: 'text', text: `Spawned at ${bname(e.ref)} ${t}` })
    else if (w === 'pickedUp') {
      const id = Number(e.ref)
      const name = Number.isFinite(id) ? deps.vehicleName(id) : null
      items.push({
        kind: 'text',
        text: `Picked up by ${name ?? 'a vehicle'} ${t}`,
      })
    } else if (w === 'unloaded')
      items.push({ kind: 'text', text: `Unloaded ${t}` })
    else if (CLEAR_WHATS.has(w))
      items.push({ kind: 'text', text: `Cleared by you ${t}` })
    else if (w === 'shelved') items.push({ kind: 'text', text: 'Shelved' })
    else if (w === 'delivered')
      items.push({ kind: 'text', text: `Delivered to ${bname(e.ref)} ${t}` })
    else if (w === 'handedOff')
      items.push({
        kind: 'text',
        text: `Handed off at ${bname(e.ref)} ${t}`,
        what: w,
      })
  }
  closeOpen()
  return items
}

/** One slot line: `Slot 1 Metal detector: missed (15% vs rattle)`. */
export function slotLine(
  item: Extract<RouteItem, { kind: 'slot' }>,
  strain: StrainId | null,
): string {
  if (item.text)
    return item.status === 'flagged'
      ? `${item.text} ${simClock(item.tick)}`
      : item.text
  const where = item.slot !== null ? `Slot ${item.slot}` : item.nodeId
  if (item.status === 'empty' || !item.checker) return `${where}: empty`
  if (item.status === 'flagged')
    return `${where} ${item.checker}: flagged ${simClock(item.tick)}`
  const vs = item.pct !== null && strain ? ` (${item.pct}% vs ${strain})` : ''
  return `${where} ${item.checker}: missed${vs}`
}

/**
 * The route as text lines. `mergeEmpty` folds a run of ≥ 2 empty slots into
 * one line (`Slots 2–4: empty`) when the card is short of room.
 */
export function routeText(
  items: readonly RouteItem[],
  strain: StrainId | null,
  mergeEmpty = false,
): string[] {
  const out: string[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (it.kind === 'text') {
      out.push(it.text)
      continue
    }
    if (mergeEmpty && it.status === 'empty') {
      let j = i
      while (j + 1 < items.length) {
        const nx = items[j + 1]!
        if (nx.kind !== 'slot' || nx.status !== 'empty') break
        j++
      }
      const last = items[j] as Extract<RouteItem, { kind: 'slot' }>
      if (j > i && it.slot !== null && last.slot !== null) {
        out.push(`Slots ${it.slot}–${last.slot}: empty`)
        i = j
        continue
      }
    }
    out.push(slotLine(it, strain))
  }
  return out
}

/** `Your lane's catch rate vs rattle was 15%`. */
export function rateLine(strain: StrainId | null, laneRate: number): string {
  return `Your lane's catch rate vs ${strain ?? 'malware'} was ${ratePct(laneRate)}%`
}

/** The counter fields the card reads (inspectorRate: M6, absent = none). */
export type CounterFields = Pick<
  LifeLostPayload,
  | 'counterMachineId'
  | 'counterOwned'
  | 'counterRate'
  | 'laneRate'
  | 'clearedByPlayerAt'
> &
  Partial<Pick<LifeLostPayload, 'inspectorRate'>>

/** Which counter suggestion the card shows (null: none, or cleared by you). */
export function counterPick(p: CounterFields): 'machine' | 'inspector' | null {
  if (p.clearedByPlayerAt !== null && p.clearedByPlayerAt !== undefined)
    return null
  return counterChoice({
    inspectorRate: p.inspectorRate ?? null,
    counterRate: p.counterMachineId ? p.counterRate : null,
  })
}

/**
 * The counter (city-view §9.3): `Cleared by you at 11:58` when the player
 * cleared it; else `A Shaky shaker would make it 83%`; or, when the lane
 * already holds that machine, the dice line + `Another Shaky shaker would
 * make it 97%`. M6 (spec-build2 §2.3): when a better inspector at the desk
 * that missed beats the machine (detection.ts counterChoice, machine first
 * on ties) the suggestion reads `A 5-eye inspector at this desk would make
 * it 99%` (5 = the top eye pip of employees.json). No line when neither
 * applies.
 */
export function counterLines(p: CounterFields, data: GameData): string[] {
  if (p.clearedByPlayerAt !== null && p.clearedByPlayerAt !== undefined)
    return [`Cleared by you at ${simClock(p.clearedByPlayerAt)}`]
  const pick = counterPick(p)
  if (pick === null) return []
  // The rate line above already reads "Your lane's catch rate vs metal was
  // 97%"; the spec's "Your lane was at 97% — …" restated it word for word
  // on the next line (UX M2 review), so only the dice half is kept.
  const dice = p.counterOwned
    ? [`This one got through on the ${missPct(p.laneRate)}%`]
    : []
  const inspectorRate = p.inspectorRate ?? null
  if (pick === 'inspector' && inspectorRate !== null) {
    const top = data.employees.roles.inspector.p.length
    const to = ratePct(inspectorRate)
    return [...dice, `A ${top}-eye inspector at this desk would make it ${to}%`]
  }
  if (!p.counterMachineId || p.counterRate === null) return []
  const name = checkerRow(data, p.counterMachineId)?.name ?? p.counterMachineId
  const to = ratePct(p.counterRate)
  if (!p.counterOwned) return [`${withArticle(name)} would make it ${to}%`]
  return [...dice, `${withArticle(name, true)} would make it ${to}%`]
}

const PARCEL_MAL: Record<Size, FrameName> = {
  S: 'parcel_s_mal',
  M: 'parcel_m_mal',
  L: 'parcel_l_mal',
  XL: 'parcel_xl_mal',
}

const STRAIN_ICON: Record<StrainId, FrameName> = {
  metal: 'ic_strain_metal',
  rattle: 'ic_strain_rattle',
  battery: 'ic_strain_battery',
  dense: 'ic_strain_dense',
}

export interface LostLifeModel {
  label: string
  strain: StrainId | null
  parcelFrame: FrameName
  strainFrame: FrameName | null
  route: RouteItem[]
  rate: string
  counter: string[]
  /** Lives left (the card's LivesRow). */
  lives: number
  /**
   * Open warehouse highlights this machine (counterMachineId); null when
   * the 5-eye inspector line is the suggestion (M6).
   */
  highlight: string | null
}

/** Everything the card shows, from the `life:lost` payload. */
export function lostLifeModel(
  p: LifeLostPayload,
  deps: RouteDeps & { lives: number },
): LostLifeModel {
  const size = p.report?.size ?? 'M'
  return {
    label: p.label,
    strain: p.strain,
    parcelFrame: PARCEL_MAL[size] ?? 'parcel_m_mal',
    strainFrame: p.strain ? (STRAIN_ICON[p.strain] ?? null) : null,
    route: routeItems(p.path ?? [], p.strain, deps),
    rate: rateLine(p.strain, p.laneRate),
    counter: counterLines(p, deps.data),
    lives: deps.lives,
    highlight:
      counterPick(p) === 'inspector' ? null : (p.counterMachineId ?? null),
  }
}

/**
 * The px the route may take on a card `H` px tall whose rate + counter texts
 * take `tailTextsH` px (TAIL_LINE per unwrapped line): what is left of
 * min(H − 80, CARD_MAX_H) under the title and parcel rows and above the
 * texts, the lives row and the buttons (build() lays it out the same way).
 */
export function routeBudget(H: number, tailTextsH: number): number {
  const maxH = Math.min(H - 80, CARD_MAX_H)
  const tailH = 6 + tailTextsH + 6 + 16 + 10 + BTN_H + PAD
  return Math.max(42, maxH - ROUTE_TOP - tailH)
}

/** The rate + counter texts' height when none wraps (the card's TAIL_LINE pitch). */
export function tailTextsHeight(model: Pick<LostLifeModel, 'counter'>): number {
  return TAIL_LINE * (1 + model.counter.length)
}

/**
 * How many route lines end the route and survive an elision: the overseas
 * hand-off and clearance (M8) when the route ends with them, else the last
 * hop (the delivery).
 */
function tailCount(items: readonly RouteItem[]): number {
  let n = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind !== 'text' || !it.what || !TAIL_WHATS.has(it.what)) break
    n++
  }
  return Math.max(1, n)
}

/**
 * Route lines that fit `budget` px: pitch 18 → 16 → 14, then merged empty
 * slots, then the middle elided (`…`) keeping the first hops and the tail
 * (the delivery line; M8: the hand-off + clearance lines of an overseas
 * parcel).
 */
export function fitRoute(
  items: readonly RouteItem[],
  strain: StrainId | null,
  budget: number,
): { lines: string[]; pitch: number } {
  for (const merge of [false, true]) {
    const lines = routeText(items, strain, merge)
    for (const pitch of ROUTE_PITCHES)
      if (lines.length * pitch <= budget) return { lines, pitch }
  }
  const pitch = ROUTE_PITCHES[ROUTE_PITCHES.length - 1]!
  const lines = routeText(items, strain, true)
  const tail = Math.min(tailCount(items), Math.max(1, lines.length - 1))
  const n = Math.max(2 + tail, Math.floor(budget / pitch))
  if (lines.length <= n) return { lines, pitch }
  const head = lines.slice(0, n - 1 - tail)
  return { lines: [...head, '…', ...lines.slice(lines.length - tail)], pitch }
}

// ---- view -----------------------------------------------------------------------

export interface LostLifeCardOptions {
  /** `Open warehouse`: the card has closed; goto the warehouse, resume. */
  onOpenWarehouse(highlight: string | null): void
  /** `Continue` (or Esc / Enter): the card has closed; resume. */
  onContinue(): void
}

export class LostLifeCard {
  readonly scene: Phaser.Scene
  private L: Layout
  private opts: LostLifeCardOptions
  private model: LostLifeModel | null = null
  private root: Phaser.GameObjects.Container | null = null
  private cam: Phaser.Cameras.Scene2D.Camera | null = null
  private lives: LivesRow | null = null
  private buttons: Button[] = []
  private panelRect = { x: 0, y: 0, w: 0, h: 0 }

  constructor(scene: Phaser.Scene, L: Layout, opts: LostLifeCardOptions) {
    this.scene = scene
    this.L = L
    this.opts = opts
  }

  isOpen(): boolean {
    return this.model !== null
  }

  /** The open card's model (e2e / debug). */
  get current(): LostLifeModel | null {
    return this.model
  }

  /** The panel's screen rect while open (e2e). */
  get rect(): { x: number; y: number; w: number; h: number } | null {
    return this.model ? { ...this.panelRect } : null
  }

  open(model: LostLifeModel): void {
    this.teardown()
    this.model = model
    this.build()
    pushModal(this)
    this.scene.input.keyboard?.on('keydown', this.onKey, this)
  }

  /** Close without a callback. */
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

  private choose(which: 'warehouse' | 'continue'): void {
    const m = this.model
    if (!m) return
    this.close()
    if (which === 'warehouse') this.opts.onOpenWarehouse(m.highlight)
    else this.opts.onContinue()
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' && ev.key !== 'Enter') return
    if (claimKey(ev, this)) this.choose('continue')
  }

  private teardown(): void {
    for (const b of this.buttons) b.destroy()
    this.buttons = []
    this.lives?.destroy()
    this.lives = null
    this.root?.destroy()
    this.root = null
    if (this.cam) this.scene.cameras.remove(this.cam, true)
    this.cam = null
  }

  private build(): void {
    const m = this.model
    if (!m) return
    const scene = this.scene
    const { W, H } = this.L
    const o = offscreenOrigin()
    const w = Math.max(200, W - 24)
    const inner = w - 2 * PAD

    const backdrop = scene.add
      .rectangle(0, 0, W, H, THEME.shadow, BACKDROP_ALPHA)
      .setOrigin(0, 0)
      .setInteractive()
    const panel = addPanel(scene, 0, 0, w, 64, 'ui_panel').setInteractive()
    const parts: Phaser.GameObjects.GameObject[] = []
    const place: { obj: { x: number; y: number }; x: number; y: number }[] = []
    const put = <T extends { x: number; y: number }>(
      obj: T,
      x: number,
      y: number,
    ): T => {
      place.push({ obj, x, y })
      return obj
    }

    // Title (the route starts at ROUTE_TOP: routeBudget's arithmetic).
    let y = PAD - 4
    const title = addText(scene, 0, 0, LOST_LIFE_TITLE, { tint: THEME.danger })
    put(title, Math.round((w - title.width) / 2), y)
    parts.push(title)
    y += 18

    // Parcel + label + strain icon.
    const pimg = scene.add.image(0, 0, UI_ATLAS, m.parcelFrame).setOrigin(0, 0)
    put(pimg, PAD, y)
    const label = addText(scene, 0, 0, m.label, { tint: THEME.textDark })
    put(label, PAD + 36, textTop(y, 32))
    parts.push(pimg, label)
    if (m.strainFrame) {
      const ic = scene.add.image(0, 0, UI_ATLAS, m.strainFrame).setOrigin(0, 0)
      put(ic, Math.round(PAD + 36 + label.width + 4), y + 8)
      parts.push(ic)
    }
    y += 36

    // Tail texts measured first (wrapped at the inner width).
    const rate = addText(scene, 0, 0, m.rate, { maxWidth: inner })
    const counter = m.counter.map((c, i) =>
      addText(scene, 0, 0, c, {
        maxWidth: inner,
        tint: i === m.counter.length - 1 ? THEME.primary : THEME.textDark,
      }),
    )
    parts.push(rate, ...counter)
    const textsH = [rate, ...counter].reduce(
      (s, t) => s + (lineCount(t) - 1) * LINE_H + TAIL_LINE,
      0,
    )
    const fit = fitRoute(m.route, m.strain, routeBudget(H, textsH))
    for (const line of fit.lines) {
      const t = addText(scene, 0, 0, line, { maxWidth: inner })
      put(t, PAD, y + Math.floor((fit.pitch - 14) / 2))
      parts.push(t)
      y += fit.pitch
    }
    y += 6
    for (const t of [rate, ...counter]) {
      put(t, PAD, y)
      y += (lineCount(t) - 1) * LINE_H + TAIL_LINE
    }
    y += 6

    // Lives left.
    const lives = new LivesRow(scene, 0, 0)
    lives.set(m.lives)
    put(lives.root, Math.round((w - livesRowWidth()) / 2), y)
    this.lives = lives
    y += 16 + 10

    // Buttons.
    const bw = Math.floor((inner - BTN_GAP) / 2)
    const open = new Button(scene, {
      x: 0,
      y: 0,
      w: bw,
      h: BTN_H,
      label: 'Open warehouse',
      face: 'primary',
      minHit: this.L.minHit,
      id: 'lostLife:warehouse',
      onClick: () => this.choose('warehouse'),
    })
    const cont = new Button(scene, {
      x: 0,
      y: 0,
      w: bw,
      h: BTN_H,
      label: 'Continue',
      minHit: this.L.minHit,
      id: 'lostLife:continue',
      onClick: () => this.choose('continue'),
    })
    put(open, PAD, y)
    put(cont, PAD + bw + BTN_GAP, y)
    this.buttons = [open, cont]
    y += BTN_H + PAD

    // Fit to the content (fitRoute kept it within min(H − 80, CARD_MAX_H)).
    const h = Math.max(y, 120)
    const px = Math.round((W - w) / 2)
    const py = Math.max(0, Math.round((H - h) / 2))
    panel.setPosition(px, py).setSize(w, h)
    if (panel.input?.hitArea)
      (panel.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, w, h)
    for (const p of place) {
      const obj = p.obj as unknown as Phaser.GameObjects.Components.Transform
      obj.setPosition(px + p.x, py + p.y)
    }
    this.panelRect = { x: px, y: py, w, h }

    const root = scene.add.container(o.x, o.y, [
      backdrop,
      panel,
      ...parts,
      lives.root,
      open,
      cont,
    ])
    root.setDepth(100000)
    for (const c of scene.cameras.cameras) c.ignore(root)
    const cam = scene.cameras.add(0, 0, W, H)
    cam.setScroll(o.x, o.y)
    for (const obj of scene.children.list) if (obj !== root) cam.ignore(obj)
    this.root = root
    this.cam = cam
  }
}
