// The playtest recorder (plan.md §12.7 task 1, §12.9; v2: plan-build2 §8.7
// task 1, §9): one `playtest.json` profile per run, the object the summary
// card shows and downloads, `__pm.playtest()` returns and `pm.playtest.v2`
// stores.
//
// Phaser- and DOM-free (tools/check-sim-purity.mjs keeps it so): the HUD
// injects the wall clock, `game.loop.actualFps`, the count of canvas
// pointerdowns, the pause state and the device facts. Three sources:
//
//   - the sim state, read when the profile is built, for everything the sim
//     already keeps (so a profile started late — a Continue, ?fastForward=,
//     a fixture — still reports them): simS, firstDeliveryS, level2AtS …
//     level5AtS (stats.levelTick), victoryAtS (stats.victoryTick) and
//     endlessS (sim seconds since it), truckBoughtS, deliveries total /
//     onTime / late, moneyPerMin (the steps of stats.minutes[].earned, one
//     row per in-game minute = 60 sim s), lifetimeEarned, balanceEnd,
//     malware spawned / caught / missed, tossedClean (the bin's clean
//     count), holdBayEvents, stalls.totalS (stats.minutes[].stallS +
//     today's), satisfactionEnd (live local districts), quests (offered /
//     accepted / declined / completed / failed, per template, from
//     state.quests: the history, the open offer and the active quest),
//     overseas.handedOff / cleared (stats.cleared + the parcels still
//     clearing), desks (desk fixtures in the lane) and, from the command log
//     (it rides along in every save), vehiclesBought, machinesBought,
//     docksBought, inspectorsHired (`hire` commands with role 'inspector' —
//     build 2 M6; not re-hires), fired (`fire`), adsPosted (`postAd`) and
//     rushTaps (rush commands applied);
//   - sim events while attached: firstMalware (the first malware spawned;
//     the first malware flagged — `by` = the flagging checker's machine id,
//     or 'inspector' for the desk — and when that parcel was tossed),
//     deliveries.byType (the vehicle of the parcel's last `loaded` hop),
//     malware.cleared (malware the player Cleared from the Hold Bay),
//     livesLost (one per parcel id; + v2: the sorter whose `looks clean`
//     call it carried, the overseas hub whose clearance cost it), hires (worker:hired, not
//     re-hires: role, pips, salary, ★, when, and whether the pick was the
//     cheapest applicant left in that pool — fun bar 2 item 1), sorter
//     {decisions, wrong, clearedMalware} (sorter:decided; clearedMalware =
//     malware the sorter judged clean and left in the bay — the Toss-only
//     sorter's equivalent of a Clear), overseas.malwareAtClearance
//     (parcel:cleared with malware), quests.firstCompletedS (also read from
//     the history), stalls.count (stalled-from-flowing transitions), payroll
//     {paid, short, walkouts} (payroll:paid / payroll:short / walkout events);
//   - the view layer: elapsedS / pausedS (wall seconds while the page is
//     visible; a hidden tab does not count, a frame gap is capped at 1 s),
//     one fps sample per elapsed second (a histogram, so p50 / p5 / min are
//     exact nearest-rank percentiles over integer samples: p5 = the slowest
//     5 %), taps (canvas pointerdowns), viewSwitches and warehouseS (sim
//     seconds while the Warehouse is the awake view).
//
// Rules (§12.9): every `*S` is sim seconds (ticks ÷ 10) except elapsedS and
// pausedS (wall clock); null = not reached. `pm.playtest.v2` (src/boot/
// autosave.ts playtestKey, `:cfg:<name>` in a config session) holds the
// profile plus a `restore` record (the accumulators the profile alone cannot
// rebuild: the fps histogram, the first-malware parcel id, the hires, …);
// attach() resumes from it only for the same run (version 2, same seed, simS
// within one autosave period of the sim's) — a New game starts a fresh
// profile, and a v1 profile (build 1, M5–M9) is never resumed.
import type { GameData } from '../data/types.ts'
import {
  onSimEvent,
  type SimEmitter,
  type SimEventName,
  type SimEventPayloads,
} from '../sim/events.ts'
import type { CommandLogEntry } from '../sim/commands.ts'
import { salaryOf } from '../sim/systems/people.ts'
import type { LostLifeReport, SimState, VehicleType } from '../sim/types.ts'

export const PLAYTEST_VERSION = 2
/** Game registry key of the live PlaytestRecorder (HudScene sets it; __pm reads it). */
export const REG_PLAYTEST = 'playtest'
/** The download's file name (the summary card, __pm.downloadPlaytest()). */
export const PLAYTEST_FILE = 'playtest.json'
/** One fps sample per this much visible wall time. */
export const FPS_SAMPLE_MS = 1000
/** A longer gap between two frames (a hitch, a resumed tab) counts as this. */
export const MAX_FRAME_GAP_MS = 1000
/** A stored profile resumes only when its simS is this close to the sim's. */
export const RESTORE_WINDOW_S = 15
/** plan-build2 §8.7 task 2: the summary card is offered once at 30:00 of sim time. */
export const SUMMARY_OFFER_S = 1800

/**
 * plan-build2 §9, the fun bar 2 windows: instrumentation for the author's
 * playtest, not game balance (the sim never reads them; the gate's windows
 * stay in economy.pacingTargets).
 */
export interface FunTargets {
  /** (2) the first quest completed by this sim second. */
  questByS: number
  /** (3) level 3 reached inside this window, sim minutes (inclusive). */
  level3Min: readonly [number, number]
  /** (4) wall seconds played before the summary card first opened. */
  keepPlayingS: number
  /** (6, stretch) level 5 or Victory by this sim second. */
  stretchS: number
}

export const FUN_TARGETS: Readonly<FunTargets> = {
  questByS: 900,
  level3Min: [15, 22],
  keepPlayingS: 1500,
  stretchS: 2400,
}
/** §9 fun bar 2 (4): the author keeps playing past 25 min (elapsedS). */
export const FUN_KEEP_PLAYING_S = FUN_TARGETS.keepPlayingS

/**
 * The summary offer is due: SUMMARY_OFFER_S (30:00) of sim time, and more
 * than fun bar item 4's keepPlayingS (25:00) of wall time on screen — at 2×
 * the game clock reaches 30:00 after ~15–20 real minutes, and a tester who
 * opens the card when it is offered must not fail item 4 for it (final
 * review, mobile #7).
 */
export function summaryOfferDue(
  simTick: number,
  elapsedS: number,
  targets: Readonly<FunTargets> = FUN_TARGETS,
): boolean {
  return (
    simTick >= SUMMARY_OFFER_S * TICKS_PER_S && elapsedS > targets.keepPlayingS
  )
}

const TICKS_PER_S = 10
const VEHICLE_TYPES: readonly VehicleType[] = ['bike', 'van', 'truck']

// ---- the profile (plan.md §12.9 + plan-build2 §8.7 task 1) ---------------------------

export interface PlaytestDevice {
  ua: string
  /** CSS viewport px. */
  cssW: number
  cssH: number
  dpr: number
  /** Phaser scale zoom (1 or 2). */
  zoom: number
  /** WebGL MAX_TEXTURE_SIZE (0 when unknown). */
  maxTexture: number
}

export interface PlaytestFirstMalware {
  /** The first malware parcel spawned. */
  spawnedS: number | null
  /** The first malware flagged by a checker. */
  caughtS: number | null
  /** That checker: a machines.json id, or 'inspector' (the desk). */
  by: string | null
  /** That parcel tossed into the Quarantine Bin. */
  tossedS: number | null
}

export interface PlaytestLifeLost {
  /**
   * The lost parcel's id (unique per run; the recorder's replay dedupe key —
   * two parcels with the same label can be lost on one tick). null in a
   * profile restored from before the field.
   */
  parcelId: number | null
  atS: number
  label: string
  strain: string | null
  /** The lane's catch rate D(strain) when the parcel passed, 0..1. */
  laneRate: number
  /** The strain's counter machine id (parcels.json), or null. */
  counter: string | null
  clearedByPlayer: boolean
  /** v2: the sorter whose `looks clean` call the parcel carried, or null. */
  sorter: string | null
  /** v2: the overseas hub whose clearance cost it (null = a local delivery). */
  hub: string | null
}

/** v2: one hire from a picker (worker:hired, not a re-hire). */
export interface PlaytestHire {
  role: string
  /** The role's stats, 1..5 each (employees.json roles[role].stats). */
  pips: Record<string, number>
  /** $/day, fixed at hire (a driver's for its vehicle's class). */
  salary: number
  star: boolean
  atS: number
  /**
   * No applicant left in that pool would have cost less (for a driver: for
   * the same vehicle class); a lone applicant is the cheapest. Fun bar 2
   * item 1 wants at least one hire where this is false.
   */
  cheapest: boolean
}

/** v2: quest counts (one set overall, one per template). */
export interface PlaytestQuestCounts {
  /** Every quest offered (incl. the Golden Release). */
  offered: number
  /** Accepted (completed + failed + abandoned + the active one). */
  accepted: number
  /** Declined by the player or left to expire. */
  declined: number
  completed: number
  /**
   * Failed (timeout, malware) or abandoned. An Accept refused because nothing
   * can carry the golden parcel withdraws the offer (history `withdrawn`,
   * reason `unavailable`): it counts toward `offered` only.
   */
  failed: number
}

export interface PlaytestQuests extends PlaytestQuestCounts {
  /** The first quest completed, or null. */
  firstCompletedS: number | null
  /** quests.json / levels.json ultimateQuest id → its counts. */
  byTemplate: Record<string, PlaytestQuestCounts>
}

export interface Playtest {
  version: 2
  buildStamp: string
  seed: number
  /** ISO 8601 UTC, seconds (`2026-10-30T18:02:11Z`). */
  startedAt: string
  device: PlaytestDevice
  elapsedS: number
  simS: number
  pausedS: number
  firstDeliveryS: number | null
  firstMalware: PlaytestFirstMalware
  level2AtS: number | null
  level3AtS: number | null
  level4AtS: number | null
  level5AtS: number | null
  /** The Golden Release shipped (game:victory). */
  victoryAtS: number | null
  /** Sim seconds played in endless mode since the Victory; null before it. */
  endlessS: number | null
  truckBoughtS: number | null
  deliveries: {
    total: number
    onTime: number
    late: number
    byType: Record<VehicleType, number>
  }
  /** Gross income ($) per completed in-game minute (60 sim s). */
  moneyPerMin: number[]
  lifetimeEarned: number
  balanceEnd: number
  malware: {
    spawned: number
    caught: number
    missed: number
    /** Clean parcels tossed (wrong Toss). */
    tossedClean: number
    /** Malware the player Cleared from the Hold Bay. */
    cleared: number
  }
  livesLost: PlaytestLifeLost[]
  vehiclesBought: { type: string; atS: number }[]
  inspectorsHired: number
  machinesBought: { id: string; atS: number }[]
  /** v2: loading docks bought (economy.docks index 2, 3). */
  docksBought: { index: number; atS: number }[]
  /** v2: desks in the lane at the end (the start desk included). */
  desks: number
  hires: PlaytestHire[]
  /** Employees fired by the player (`fire` commands). */
  fired: number
  /** `Post an ad` taps (`postAd` commands). */
  adsPosted: number
  sorter: {
    /** Calls the seated sorter made (Toss or leave). */
    decisions: number
    /** Calls that were wrong (a clean parcel tossed, malware left). */
    wrong: number
    /** Malware the sorter judged clean and left in the bay. */
    clearedMalware: number
  }
  quests: PlaytestQuests
  overseas: {
    /** Parcels handed off at a pier / terminal. */
    handedOff: number
    /** Clearances done (malware included). */
    cleared: number
    /** Malware that reached its clearance (a life each). */
    malwareAtClearance: number
  }
  taps: number
  tapsPerMin: number
  rushTaps: number
  viewSwitches: number
  warehouseS: number
  fps: { p50: number; p5: number; min: number; samples: number }
  holdBayEvents: number
  holdBayEventsPer10Min: number
  stalls: { count: number; totalS: number }
  payroll: { paid: number; short: number; walkouts: number }
  satisfactionEnd: Record<string, number>
}

/** What the recorder accumulates beyond the sim state (stored as `restore`). */
export interface PlaytestRestore {
  elapsedMs: number
  pausedMs: number
  sampleMs: number
  /** Integer fps → sample count. */
  fpsHist: Record<string, number>
  taps: number
  viewSwitches: number
  warehouseTicks: number
  firstMalwareSpawnedTick: number | null
  firstCaughtId: number | null
  firstCaughtTick: number | null
  firstCaughtBy: string | null
  firstTossedTick: number | null
  byType: Record<VehicleType, number>
  malwareCleared: number
  livesLost: PlaytestLifeLost[]
  stalled: boolean
  stallCount: number
  payroll: { paid: number; short: number; walkouts: number }
  /** v2 (events): the hires, the sorter's calls, malware at clearance. */
  hires: PlaytestHire[]
  sorter: { decisions: number; wrong: number; clearedMalware: number }
  malwareAtClearance: number
  /** v2: the first quest:completed tick (the history keeps only the last 50). */
  firstQuestCompletedTick: number | null
  /** elapsedS when the summary card was first opened (fun bar 4), or null. */
  summaryOpenedS: number | null
  /** The 30:00 offer ran (once per run). */
  offered: boolean
}

/**
 * `pm.playtest.v2` (`pm.playtest.v2:cfg:<name>` in a `?config=` session, so
 * a config run never replaces the cold run's profile — src/boot/autosave.ts
 * playtestKey, report-playtest1 §6.13): the profile and the accumulators
 * that resume it.
 */
export interface StoredPlaytest extends Playtest {
  restore: PlaytestRestore
}

// ---- the sim side it reads ----------------------------------------------------------

/** What the recorder needs of a Sim (the class satisfies it). */
export interface PlaytestSim {
  readonly state: SimState
  readonly events: SimEmitter
  readonly commandLog: readonly CommandLogEntry[]
  /** The tables (applicant salaries for hires[].cheapest, building districts). */
  readonly data: GameData
}

export interface RecorderDeps {
  /** __BUILD_STAMP__ (`a1b2c3d 2026-10-30`). */
  buildStamp: string
  /** Measured when a profile starts (and on each resume). */
  device: () => PlaytestDevice
  /** Wall clock, ms (Date.now in the game layer). */
  now: () => number
  /** game.loop.actualFps. */
  fps: () => number
  /** Canvas pointerdowns since the page loaded (cumulative). */
  pointerDowns: () => number
  /** The sim is held (a modal card, auto-pause) or at speed 0. */
  isPaused: () => boolean
}

// ---- pure helpers ------------------------------------------------------------------------

/** Ticks → sim seconds, one decimal (ticks ÷ 10). */
export function ticksToS(ticks: number): number {
  return Math.round(ticks) / TICKS_PER_S
}

function ticksToSOrNull(ticks: number | null | undefined): number | null {
  return typeof ticks === 'number' && Number.isFinite(ticks)
    ? ticksToS(ticks)
    : null
}

/** One decimal. */
export function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0
}

/** `2026-10-30T18:02:11Z` (ISO 8601, whole seconds, UTC). */
export function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Nearest-rank percentiles over an integer histogram: p50 the median, p5
 * the value the slowest 5 % of samples are at or below, min the lowest.
 * All 0 when there are no samples.
 */
export function fpsStats(hist: Readonly<Record<string, number>>): {
  p50: number
  p5: number
  min: number
  samples: number
} {
  const bins = Object.entries(hist)
    .map(([k, n]) => [Number(k), Math.max(0, Math.floor(n))] as const)
    .filter(([k, n]) => Number.isFinite(k) && n > 0)
    .toSorted((a, b) => a[0] - b[0])
  const samples = bins.reduce((s, [, n]) => s + n, 0)
  if (samples === 0) return { p50: 0, p5: 0, min: 0, samples: 0 }
  const at = (q: number): number => {
    const rank = Math.max(1, Math.ceil(q * samples))
    let seen = 0
    for (const [k, n] of bins) {
      seen += n
      if (seen >= rank) return k
    }
    return bins[bins.length - 1]?.[0] ?? 0
  }
  return { p50: at(0.5), p5: at(0.05), min: bins[0]?.[0] ?? 0, samples }
}

/** Gross income per completed in-game minute: steps of the cumulative `earned` column. */
export function moneyPerMinute(rows: readonly { earned: number }[]): number[] {
  const out: number[] = []
  let prev = 0
  for (const r of rows) {
    out.push(Math.max(0, Math.round(r.earned - prev)))
    prev = r.earned
  }
  return out
}

/** The checker id → its machines.json id ('inspector' for the desk), or null. */
export function checkerDefId(
  state: SimState,
  checkerId: string,
): string | null {
  for (const n of state.lane.nodes) {
    const c = n.fixture?.checker
    if (c && c.id === checkerId) return c.defId
  }
  return null
}

/** The vehicle type of a parcel's last `loaded` hop (the delivering vehicle). */
function deliveringType(state: SimState, parcelId: number): VehicleType | null {
  const p = state.parcels[String(parcelId)]
  if (!p) return null
  for (let i = p.trace.length - 1; i >= 0; i--) {
    const e = p.trace[i]
    if (e?.what !== 'loaded' || e.ref === null) continue
    const id = Number(e.ref)
    return state.vehicles.find((v) => v.id === id)?.type ?? null
  }
  return null
}

const zeroCounts = (): PlaytestQuestCounts => ({
  offered: 0,
  accepted: 0,
  declined: 0,
  completed: 0,
  failed: 0,
})

/**
 * The quest counts from state.quests (the history — at most the last 50
 * ended quests, QUEST_HISTORY_MAX —, the open offer, the active quest):
 * offered = all of them; accepted = completed + failed + abandoned + the
 * active one; declined = declined + expired; failed = failed + abandoned (a
 * withdrawn offer is offered only). firstCompletedS = the earliest
 * completion in the history, or `firstTick` when that is earlier (the
 * recorder's own first quest:completed, in case the history dropped it).
 */
export function questCounts(
  state: SimState,
  firstTick: number | null = null,
): PlaytestQuests {
  const total = zeroCounts()
  const byTemplate: Record<string, PlaytestQuestCounts> = {}
  const bump = (templateId: string, key: keyof PlaytestQuestCounts): void => {
    total[key] += 1
    const t = (byTemplate[templateId] ??= zeroCounts())
    t[key] += 1
  }
  const qs = state.quests
  let first = firstTick
  for (const h of qs.history) {
    bump(h.templateId, 'offered')
    switch (h.outcome) {
      case 'completed':
        bump(h.templateId, 'accepted')
        bump(h.templateId, 'completed')
        if (first === null || h.tick < first) first = h.tick
        break
      case 'failed':
      case 'abandoned':
        bump(h.templateId, 'accepted')
        bump(h.templateId, 'failed')
        break
      case 'declined':
      case 'expired':
        bump(h.templateId, 'declined')
        break
      default:
        break
    }
  }
  if (qs.offer) bump(qs.offer.templateId, 'offered')
  if (qs.active) {
    bump(qs.active.templateId, 'offered')
    bump(qs.active.templateId, 'accepted')
  }
  return { ...total, firstCompletedS: ticksToSOrNull(first), byTemplate }
}

/** Desk fixtures in the lane (the start desk included). */
function deskCount(state: SimState): number {
  return state.lane.nodes.filter((n) => n.fixture?.kind === 'desk').length
}

/** Parcels handed off so far: cleared + still clearing (state 'handed_off'). */
function handedOffCount(state: SimState): number {
  let n = state.stats.cleared
  for (const p of Object.values(state.parcels))
    if (p.state === 'handed_off') n += 1
  return n
}

/** The hub of a clearance loss: the `customsCleared` hop, else the destination's district. */
function lossHub(data: GameData | null, r: LostLifeReport): string | null {
  if (!r.viaClearance) return null
  for (let i = r.path.length - 1; i >= 0; i--) {
    const e = r.path[i]
    if (e?.what === 'customsCleared' && e.ref !== null) return e.ref
  }
  return (
    data?.buildings.find((b) => b.id === r.destBuildingId)?.district ?? null
  )
}

function freshRestore(): PlaytestRestore {
  return {
    elapsedMs: 0,
    pausedMs: 0,
    sampleMs: 0,
    fpsHist: {},
    taps: 0,
    viewSwitches: 0,
    warehouseTicks: 0,
    firstMalwareSpawnedTick: null,
    firstCaughtId: null,
    firstCaughtTick: null,
    firstCaughtBy: null,
    firstTossedTick: null,
    byType: { bike: 0, van: 0, truck: 0 },
    malwareCleared: 0,
    livesLost: [],
    stalled: false,
    stallCount: 0,
    payroll: { paid: 0, short: 0, walkouts: 0 },
    hires: [],
    sorter: { decisions: 0, wrong: 0, clearedMalware: 0 },
    malwareAtClearance: 0,
    firstQuestCompletedTick: null,
    summaryOpenedS: null,
    offered: false,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null
const count = (v: unknown): number => Math.max(0, Math.floor(num(v)))

function parseLifeLost(v: unknown): PlaytestLifeLost | null {
  if (!isObj(v) || typeof v.label !== 'string') return null
  return {
    parcelId: numOrNull(v.parcelId),
    atS: num(v.atS),
    label: v.label,
    strain: strOrNull(v.strain),
    laneRate: num(v.laneRate),
    counter: strOrNull(v.counter),
    clearedByPlayer: v.clearedByPlayer === true,
    sorter: strOrNull(v.sorter),
    hub: strOrNull(v.hub),
  }
}

function parseHire(v: unknown): PlaytestHire | null {
  if (!isObj(v) || typeof v.role !== 'string') return null
  const pips: Record<string, number> = {}
  if (isObj(v.pips))
    for (const [k, n] of Object.entries(v.pips))
      if (typeof n === 'number' && Number.isFinite(n)) pips[k] = n
  return {
    role: v.role,
    pips,
    salary: num(v.salary),
    star: v.star === true,
    atS: num(v.atS),
    cheapest: v.cheapest !== false,
  }
}

/** A `restore` record read back from storage (defaults for anything missing). */
export function parseRestore(v: unknown): PlaytestRestore {
  const r = freshRestore()
  if (!isObj(v)) return r
  r.elapsedMs = Math.max(0, num(v.elapsedMs))
  r.pausedMs = Math.max(0, num(v.pausedMs))
  r.sampleMs = Math.max(0, Math.min(FPS_SAMPLE_MS, num(v.sampleMs)))
  if (isObj(v.fpsHist))
    for (const [k, n] of Object.entries(v.fpsHist))
      if (Number.isFinite(Number(k)) && num(n) > 0)
        r.fpsHist[k] = Math.floor(num(n))
  r.taps = count(v.taps)
  r.viewSwitches = count(v.viewSwitches)
  r.warehouseTicks = Math.max(0, num(v.warehouseTicks))
  r.firstMalwareSpawnedTick = numOrNull(v.firstMalwareSpawnedTick)
  r.firstCaughtId = numOrNull(v.firstCaughtId)
  r.firstCaughtTick = numOrNull(v.firstCaughtTick)
  r.firstCaughtBy = strOrNull(v.firstCaughtBy)
  r.firstTossedTick = numOrNull(v.firstTossedTick)
  if (isObj(v.byType))
    for (const t of VEHICLE_TYPES) r.byType[t] = Math.max(0, num(v.byType[t]))
  r.malwareCleared = Math.max(0, num(v.malwareCleared))
  if (Array.isArray(v.livesLost))
    r.livesLost = v.livesLost
      .map(parseLifeLost)
      .filter((x): x is PlaytestLifeLost => x !== null)
  r.stalled = v.stalled === true
  r.stallCount = Math.max(0, num(v.stallCount))
  if (isObj(v.payroll)) {
    r.payroll.paid = Math.max(0, num(v.payroll.paid))
    r.payroll.short = Math.max(0, num(v.payroll.short))
    r.payroll.walkouts = Math.max(0, num(v.payroll.walkouts))
  }
  if (Array.isArray(v.hires))
    r.hires = v.hires
      .map(parseHire)
      .filter((x): x is PlaytestHire => x !== null)
  if (isObj(v.sorter)) {
    r.sorter.decisions = count(v.sorter.decisions)
    r.sorter.wrong = count(v.sorter.wrong)
    r.sorter.clearedMalware = count(v.sorter.clearedMalware)
  }
  r.malwareAtClearance = count(v.malwareAtClearance)
  r.firstQuestCompletedTick = numOrNull(v.firstQuestCompletedTick)
  r.summaryOpenedS = numOrNull(v.summaryOpenedS)
  r.offered = v.offered === true
  return r
}

/**
 * The stored profile belongs to this run: version 2 (a v1 profile is never
 * resumed), same seed, its simS within RESTORE_WINDOW_S of the sim's, and a
 * `restore` record.
 */
export function sameRun(stored: unknown, state: SimState): boolean {
  if (!isObj(stored) || stored.version !== PLAYTEST_VERSION) return false
  if (stored.seed !== state.seed || typeof stored.startedAt !== 'string')
    return false
  const simS = numOrNull(stored.simS)
  if (simS === null) return false
  return (
    Math.abs(simS - ticksToS(state.tick)) <= RESTORE_WINDOW_S &&
    isObj(stored.restore)
  )
}

// ---- fun bar 2 (plan-build2 §9) -------------------------------------------------------------

export type FunState = 'pass' | 'fail' | 'judge' | 'pending'

export interface FunCheck {
  /** 1..6 as numbered in plan-build2 §9. */
  n: number
  label: string
  state: FunState
  /** What the check read (`17:58`, `not yet`, `you judge`). */
  detail: string
}

/** `m:ss` (minutes not wrapped into hours); `—` for null. */
export function clock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** A lost life the data explains: a counter, a sorter's call, or the player's Clear. */
export function lifeExplained(l: PlaytestLifeLost): boolean {
  return l.counter !== null || l.sorter !== null || l.clearedByPlayer
}

/**
 * Fun bar 2 (plan-build2 §9) from the profile. `judge` = the data part
 * holds but the item also asks how it felt (only the author can say), read
 * `you judge`; `pending` = the window is still open.
 *
 *  1. Hiring was a choice — ≥ 1 hire whose pick was not the cheapest
 *     applicant (hires[].cheapest false) → judge (could you say why?); hires
 *     but always the cheapest → fail; none yet → pending.
 *  2. A quest completed by 15:00 (quests.firstCompletedS ≤ questByS).
 *  3. Level 3 between 15:00 and 22:00 (level3AtS).
 *  4. Kept playing past 25:00 — elapsedS at the first opening of the card
 *     (`openedAtS`, default the profile's elapsedS) > keepPlayingS.
 *  5. Every lost life explained — each has a counter, a sorter name or
 *     clearedByPlayer (an overseas one also says the ship has sailed / the
 *     plane has left on its card) → judge (did the card make sense?); none
 *     lost → pass; any without → fail.
 *  6. (stretch) Level 5 or Victory by 40:00 (level5AtS, victoryAtS).
 */
export function funBar(
  pt: Playtest,
  targets: Readonly<FunTargets> = FUN_TARGETS,
  openedAtS: number | null = null,
): FunCheck[] {
  const out: FunCheck[] = []
  const inWindow = (
    at: number | null,
    lo: number,
    hi: number,
    none: string,
  ): Pick<FunCheck, 'state' | 'detail'> => {
    if (at !== null)
      return {
        state: at >= lo && at <= hi ? 'pass' : 'fail',
        detail: clock(at),
      }
    return pt.simS <= hi
      ? { state: 'pending', detail: 'not yet' }
      : { state: 'fail', detail: none }
  }

  const hires = pt.hires
  const choices = hires.filter((h) => !h.cheapest).length
  out.push({
    n: 1,
    label: 'Hiring was a choice',
    ...(hires.length === 0
      ? { state: 'pending', detail: 'no hires yet' }
      : choices === 0
        ? { state: 'fail', detail: 'always the cheapest' }
        : {
            state: 'judge',
            detail: `${choices} not cheapest · you judge`,
          }),
  })

  const qBy = targets.questByS
  out.push({
    n: 2,
    label: `A quest done by ${clock(qBy)}`,
    ...inWindow(pt.quests.firstCompletedS, 0, qBy, `none by ${clock(qBy)}`),
  })

  const lo = (targets.level3Min[0] ?? 15) * 60
  const hi = (targets.level3Min[1] ?? 22) * 60
  out.push({
    n: 3,
    label: `Level 3 between ${clock(lo)} and ${clock(hi)}`,
    ...inWindow(pt.level3AtS, lo, hi, `none by ${clock(hi)}`),
  })

  const keep = targets.keepPlayingS
  const opened = openedAtS ?? pt.elapsedS
  out.push({
    n: 4,
    label: `Kept playing past ${clock(keep)}`,
    state: opened > keep ? 'pass' : 'fail',
    detail: `summary at ${clock(opened)}`,
  })

  const lost = pt.livesLost
  const unexplained = lost.filter((l) => !lifeExplained(l)).length
  out.push({
    n: 5,
    label: 'Every lost life explained',
    state: lost.length === 0 ? 'pass' : unexplained > 0 ? 'fail' : 'judge',
    detail:
      lost.length === 0
        ? 'none lost'
        : unexplained > 0
          ? `${unexplained} unexplained`
          : 'you judge',
  })

  const by = targets.stretchS
  const v = pt.victoryAtS
  const l5 = pt.level5AtS
  const reached =
    v !== null && v <= by
      ? `Victory ${clock(v)}`
      : l5 !== null && l5 <= by
        ? `Lv 5 ${clock(l5)}`
        : null
  out.push({
    n: 6,
    label: `Stretch: Lv 5 or Victory by ${clock(by)}`,
    ...(reached !== null
      ? { state: 'pass', detail: reached }
      : pt.simS <= by
        ? { state: 'pending', detail: 'not yet' }
        : {
            state: 'fail',
            detail: l5 !== null ? `Lv 5 ${clock(l5)}` : `none by ${clock(by)}`,
          }),
  })
  return out
}

// ---- the recorder ----------------------------------------------------------------------

type Handler<K extends SimEventName> = (p: SimEventPayloads[K]) => void

export class PlaytestRecorder {
  private readonly deps: RecorderDeps
  private sim: PlaytestSim | null = null
  private off: (() => void)[] = []
  private r: PlaytestRestore = freshRestore()
  private seed = 0
  private startedAt = ''
  private device: PlaytestDevice
  private lastWall: number | null = null
  private lastTick = 0
  /** pointerDowns() when this session's counting began. */
  private tapBase = 0
  private view = 'city'

  constructor(deps: RecorderDeps) {
    this.deps = deps
    this.device = {
      ua: '',
      cssW: 0,
      cssH: 0,
      dpr: 1,
      zoom: 1,
      maxTexture: 0,
    }
  }

  /** The sim the profile follows (null before attach). */
  get attached(): PlaytestSim | null {
    return this.sim
  }

  /** elapsedS at the first summary opening this run (fun bar 4). */
  get summaryOpenedS(): number | null {
    return this.r.summaryOpenedS
  }

  /** The 30:00 offer already ran this run. */
  get offered(): boolean {
    return this.r.offered
  }

  /** Wall seconds on screen so far (the profile's elapsedS, unrounded). */
  get elapsedS(): number {
    return this.r.elapsedMs / 1000
  }

  /**
   * Follow `sim`. With `stored` (pm.playtest.v2) of the same run the
   * profile resumes from it; otherwise a fresh profile starts now. Returns
   * true when it resumed.
   */
  attach(sim: PlaytestSim, stored: unknown = null): boolean {
    this.detach()
    this.sim = sim
    const st = sim.state
    const resume = stored !== null && sameRun(stored, st)
    this.seed = st.seed
    if (resume) {
      const s = stored as Record<string, unknown>
      this.r = parseRestore(s.restore)
      this.startedAt = String(s.startedAt)
    } else {
      this.r = freshRestore()
      this.startedAt = isoSeconds(this.deps.now())
      // A profile started on a running sim (?fastForward=, a fixture): the
      // first catch and the stall in progress come from the state.
      this.r.firstCaughtTick = st.stats.firstCatchTick
      this.r.stalled = st.lane.stalled
    }
    this.device = this.safeDevice()
    this.tapBase = this.safePointerDowns()
    this.lastWall = null
    this.lastTick = st.tick
    this.subscribe(sim.events)
    return resume
  }

  /** Stop following the sim (events off). The profile keeps its numbers. */
  detach(): void {
    for (const f of this.off) f()
    this.off = []
  }

  /** Once per frame: wall / paused clocks, the fps sampler, warehouse time. */
  update(): void {
    const t = this.deps.now()
    const last = this.lastWall
    this.lastWall = t
    if (last !== null) {
      const dt = Math.min(Math.max(0, t - last), MAX_FRAME_GAP_MS)
      if (dt > 0) {
        this.r.elapsedMs += dt
        if (this.safePaused()) this.r.pausedMs += dt
        this.r.sampleMs += dt
        while (this.r.sampleMs >= FPS_SAMPLE_MS) {
          this.r.sampleMs -= FPS_SAMPLE_MS
          this.sampleFps()
        }
      }
    }
    this.countViewTicks()
  }

  /** The page went hidden: the next update() restarts the wall clock. */
  hidden(): void {
    this.lastWall = null
  }

  /** The awake world view ('city' | 'warehouse'); a change is a view switch. */
  setView(view: string): void {
    this.countViewTicks()
    if (view === this.view) return
    this.view = view
    this.r.viewSwitches += 1
  }

  /** The summary card opened (the first opening is kept for fun bar 4). */
  noteSummaryOpened(): void {
    if (this.r.summaryOpenedS === null)
      this.r.summaryOpenedS = round1(this.r.elapsedMs / 1000)
  }

  /** The 30:00 offer ran. */
  markOffered(): void {
    this.r.offered = true
  }

  /** The live profile (plan.md §12.9 + plan-build2 §8.7 task 1). */
  snapshot(): Playtest {
    this.countViewTicks()
    const sim = this.sim
    const s = sim?.state ?? null
    const st = s?.stats ?? null
    const simS = s ? ticksToS(s.tick) : 0
    const elapsedS = round1(this.r.elapsedMs / 1000)
    const taps = this.taps()
    const log = sim?.commandLog ?? []
    const vehiclesBought: { type: string; atS: number }[] = []
    const machinesBought: { id: string; atS: number }[] = []
    const docksBought: { index: number; atS: number }[] = []
    let inspectorsHired = 0
    let rushTaps = 0
    let fired = 0
    let adsPosted = 0
    for (const e of log) {
      const c = e.cmd
      if (c.kind === 'buyVehicle')
        vehiclesBought.push({ type: c.type, atS: ticksToS(e.tick) })
      else if (c.kind === 'buyMachine')
        machinesBought.push({ id: c.defId, atS: ticksToS(e.tick) })
      else if (c.kind === 'buyDock')
        docksBought.push({ index: c.index, atS: ticksToS(e.tick) })
      else if (c.kind === 'hire' && c.role === 'inspector') inspectorsHired += 1
      else if (c.kind === 'rush') rushTaps += 1
      else if (c.kind === 'fire') fired += 1
      else if (c.kind === 'postAd') adsPosted += 1
    }
    const minutes = st?.minutes ?? []
    const stallS =
      minutes.reduce(
        (a, m) => a + (Number.isFinite(m.stallS) ? m.stallS : 0),
        0,
      ) + (s?.lane.stallSecondsToday ?? 0)
    const satisfactionEnd: Record<string, number> = {}
    if (s)
      for (const d of Object.values(s.districts))
        if (d.live && d.nextSpawnTick !== null)
          satisfactionEnd[d.id] = Math.round(d.satisfaction)
    const holdBayEvents = st?.holdBayEvents ?? 0
    const firstCaught = this.r.firstCaughtTick ?? st?.firstCatchTick ?? null
    const victoryAtS = ticksToSOrNull(st?.victoryTick)
    const quests: PlaytestQuests = s
      ? questCounts(s, this.r.firstQuestCompletedTick)
      : { ...zeroCounts(), firstCompletedS: null, byTemplate: {} }
    return {
      version: PLAYTEST_VERSION,
      buildStamp: this.deps.buildStamp,
      seed: this.seed,
      startedAt: this.startedAt,
      device: { ...this.device },
      elapsedS,
      simS,
      pausedS: round1(this.r.pausedMs / 1000),
      firstDeliveryS: ticksToSOrNull(st?.firstDeliveryTick),
      firstMalware: {
        spawnedS: ticksToSOrNull(this.r.firstMalwareSpawnedTick),
        caughtS: ticksToSOrNull(firstCaught),
        by: this.r.firstCaughtBy,
        tossedS: ticksToSOrNull(this.r.firstTossedTick),
      },
      level2AtS: ticksToSOrNull(st?.levelTick['2']),
      level3AtS: ticksToSOrNull(st?.levelTick['3']),
      level4AtS: ticksToSOrNull(st?.levelTick['4']),
      level5AtS: ticksToSOrNull(st?.levelTick['5']),
      victoryAtS,
      endlessS: victoryAtS !== null ? round1(simS - victoryAtS) : null,
      truckBoughtS: ticksToSOrNull(st?.truckTick),
      deliveries: {
        total: st?.deliveries ?? 0,
        onTime: st?.onTime ?? 0,
        late: st?.late ?? 0,
        byType: { ...this.r.byType },
      },
      moneyPerMin: moneyPerMinute(minutes),
      lifetimeEarned: s?.economy.lifetimeEarned ?? 0,
      balanceEnd: s?.economy.balance ?? 0,
      malware: {
        spawned: st?.malwareSpawned ?? 0,
        caught: st?.malwareCaught ?? 0,
        missed: st?.malwareMissed ?? 0,
        tossedClean: s?.lane.quarantine.clean ?? 0,
        cleared: this.r.malwareCleared,
      },
      livesLost: this.r.livesLost.map((l) => ({ ...l })),
      vehiclesBought,
      inspectorsHired,
      machinesBought,
      docksBought,
      desks: s ? deskCount(s) : 0,
      hires: this.r.hires.map((h) => ({ ...h, pips: { ...h.pips } })),
      fired,
      adsPosted,
      sorter: { ...this.r.sorter },
      quests,
      overseas: {
        handedOff: s ? handedOffCount(s) : 0,
        cleared: st?.cleared ?? 0,
        malwareAtClearance: this.r.malwareAtClearance,
      },
      taps,
      tapsPerMin: elapsedS > 0 ? round1((taps * 60) / elapsedS) : 0,
      rushTaps,
      viewSwitches: this.r.viewSwitches,
      warehouseS: ticksToS(this.r.warehouseTicks),
      fps: fpsStats(this.r.fpsHist),
      holdBayEvents,
      holdBayEventsPer10Min:
        simS > 0 ? round1((holdBayEvents * 600) / simS) : 0,
      stalls: { count: this.r.stallCount, totalS: round1(stallS) },
      payroll: { ...this.r.payroll },
      satisfactionEnd,
    }
  }

  /** What pm.playtest.v2 stores: the profile plus its accumulators. */
  persisted(): StoredPlaytest {
    const pt = this.snapshot()
    const r = this.r
    return {
      ...pt,
      restore: {
        ...r,
        taps: pt.taps,
        fpsHist: { ...r.fpsHist },
        byType: { ...r.byType },
        livesLost: r.livesLost.map((l) => ({ ...l })),
        payroll: { ...r.payroll },
        hires: r.hires.map((h) => ({ ...h, pips: { ...h.pips } })),
        sorter: { ...r.sorter },
      },
    }
  }

  // ---- internals ----

  private taps(): number {
    return this.r.taps + Math.max(0, this.safePointerDowns() - this.tapBase)
  }

  private countViewTicks(): void {
    const tick = this.sim?.state.tick
    if (tick === undefined) return
    const d = tick - this.lastTick
    if (d > 0 && this.view === 'warehouse') this.r.warehouseTicks += d
    this.lastTick = tick
  }

  private sampleFps(): void {
    let f: number
    try {
      f = this.deps.fps()
    } catch {
      return
    }
    if (!Number.isFinite(f)) return
    const k = String(Math.max(0, Math.min(240, Math.round(f))))
    this.r.fpsHist[k] = (this.r.fpsHist[k] ?? 0) + 1
  }

  private safePaused(): boolean {
    try {
      return this.deps.isPaused()
    } catch {
      return false
    }
  }

  private safePointerDowns(): number {
    try {
      const n = this.deps.pointerDowns()
      return Number.isFinite(n) ? n : 0
    } catch {
      return 0
    }
  }

  private safeDevice(): PlaytestDevice {
    try {
      return this.deps.device()
    } catch {
      return this.device
    }
  }

  private tick(): number {
    return this.sim?.state.tick ?? 0
  }

  private isMalware(id: number): boolean {
    return this.sim?.state.parcels[String(id)]?.malware === true
  }

  /**
   * A hire from a picker (worker:hired, not a re-hire). At the event the
   * hired applicant has left its pool and the pool is not topped up yet
   * (people.ts hireApplicant's event order), so the pool holds exactly the
   * applicants the player passed over; a driver's salaries are for the
   * vehicle it drives (the class its own salary was fixed for).
   */
  private noteHire(p: SimEventPayloads['worker:hired']): void {
    const sim = this.sim
    if (!sim || p.rehire) return
    const s = sim.state
    const e = s.employees.find((x) => x.id === p.employeeId)
    if (!e) return
    const type =
      p.role === 'driver'
        ? (s.vehicles.find((v) => v.id === e.vehicleId)?.type ?? 'bike')
        : undefined
    const cost = (pips: typeof e.pips): number =>
      salaryOf(sim.data, p.role, pips, type)
    const own = cost(e.pips)
    const others = s.applicants[p.role] ?? []
    const pips: Record<string, number> = {}
    for (const [k, n] of Object.entries(e.pips))
      if (typeof n === 'number') pips[k] = n
    this.r.hires.push({
      role: p.role,
      pips,
      salary: e.salaryPerDay,
      star: e.star,
      atS: ticksToS(s.tick),
      cheapest: others.every((a) => cost(a.pips) >= own),
    })
  }

  private subscribe(events: SimEmitter): void {
    const on = <K extends SimEventName>(name: K, fn: Handler<K>): void => {
      this.off.push(onSimEvent(events, name, fn))
    }
    on('parcel:spawned', (p) => {
      if (this.r.firstMalwareSpawnedTick === null && this.isMalware(p.id))
        this.r.firstMalwareSpawnedTick = this.tick()
    })
    on('parcel:flagged', (p) => {
      // Once per run; a profile started after the first catch (seeded
      // from stats.firstCatchTick) cannot tell which parcel it was.
      if (this.r.firstCaughtTick !== null || !this.isMalware(p.id)) return
      this.r.firstCaughtId = p.id
      this.r.firstCaughtTick = this.tick()
      const s = this.sim?.state
      this.r.firstCaughtBy = s ? checkerDefId(s, p.checkerId) : null
    })
    on('parcel:tossed', (p) => {
      if (p.id === this.r.firstCaughtId && this.r.firstTossedTick === null)
        this.r.firstTossedTick = this.tick()
    })
    on('parcel:cleared_by_player', (p) => {
      if (this.isMalware(p.id)) this.r.malwareCleared += 1
    })
    on('parcel:delivered', (p) => {
      const s = this.sim?.state
      const type = s ? deliveringType(s, p.id) : null
      if (type) this.r.byType[type] += 1
    })
    on('parcel:cleared', (p) => {
      if (p.malware) this.r.malwareAtClearance += 1
    })
    on('life:lost', (p) => {
      const atS = ticksToS(p.report?.tick ?? this.tick())
      // A replayed loss (a reload just before it) is recorded once: the same
      // parcel id (ids are unique per run — two parcels sharing a label can
      // both be lost on one tick). A record restored from before parcelId
      // falls back to the time + label match.
      if (
        this.r.livesLost.some((l) =>
          l.parcelId !== null
            ? l.parcelId === p.parcelId
            : l.atS === atS && l.label === p.label,
        )
      )
        return
      this.r.livesLost.push({
        parcelId: p.parcelId,
        atS,
        label: p.label,
        strain: p.strain,
        laneRate: Math.round(p.laneRate * 1000) / 1000,
        counter: p.counterMachineId,
        clearedByPlayer: p.clearedByPlayerAt !== null,
        sorter: p.sorterCall?.name ?? null,
        hub: p.report ? lossHub(this.sim?.data ?? null, p.report) : null,
      })
    })
    on('worker:hired', (p) => this.noteHire(p))
    on('sorter:decided', (p) => {
      this.r.sorter.decisions += 1
      if (!p.correct) this.r.sorter.wrong += 1
      if (p.call === 'leave' && this.isMalware(p.parcelId))
        this.r.sorter.clearedMalware += 1
    })
    on('quest:completed', () => {
      if (this.r.firstQuestCompletedTick === null)
        this.r.firstQuestCompletedTick = this.tick()
    })
    on('lane:stalled', () => {
      if (!this.r.stalled) this.r.stallCount += 1
      this.r.stalled = true
    })
    on('lane:resumed', () => {
      this.r.stalled = false
    })
    on('payroll:paid', () => {
      this.r.payroll.paid += 1
    })
    on('payroll:short', () => {
      this.r.payroll.short += 1
    })
    on('worker:walkedOut', () => {
      this.r.payroll.walkouts += 1
    })
  }
}
