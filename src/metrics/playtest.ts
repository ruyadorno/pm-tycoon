// The playtest recorder (plan.md §12.7 task 1, §12.9): one `playtest.json`
// profile per run, the object the summary card shows and downloads,
// `__pm.playtest()` returns and `pm.playtest.v1` stores.
//
// Phaser- and DOM-free (tools/check-sim-purity.mjs keeps it so): the HUD
// injects the wall clock, `game.loop.actualFps`, the count of canvas
// pointerdowns, the pause state and the device facts. Three sources:
//
//   - the sim state, read when the profile is built, for everything the sim
//     already keeps (so a profile started late — a Continue, ?fastForward=,
//     a fixture — still reports them): simS, firstDeliveryS, level2AtS,
//     truckBoughtS, deliveries total / onTime / late, moneyPerMin (the steps
//     of stats.minutes[].earned, one row per in-game minute = 60 sim s),
//     lifetimeEarned, balanceEnd, malware spawned / caught / missed,
//     tossedClean (the bin's clean count), holdBayEvents, stalls.totalS
//     (stats.minutes[].stallS + today's), satisfactionEnd (live local
//     districts) and, from the command log (it rides along in every save),
//     vehiclesBought, machinesBought, inspectorsHired (hireInspector, not
//     re-hires) and rushTaps (rush commands applied);
//   - sim events while attached: firstMalware (the first malware spawned;
//     the first malware flagged — `by` = the flagging checker's machine id,
//     or 'inspector' for the desk — and when that parcel was tossed),
//     deliveries.byType (the vehicle of the parcel's last `loaded` hop),
//     malware.cleared (malware the player Cleared from the Hold Bay),
//     livesLost, stalls.count (stalled-from-flowing transitions), payroll
//     {paid, short, walkouts} (payroll:paid / payroll:short / walkout events);
//   - the view layer: elapsedS / pausedS (wall seconds while the page is
//     visible; a hidden tab does not count, a frame gap is capped at 1 s),
//     one fps sample per elapsed second (a histogram, so p50 / p5 / min are
//     exact nearest-rank percentiles over integer samples: p5 = the slowest
//     5 %), taps (canvas pointerdowns), viewSwitches and warehouseS (sim
//     seconds while the Warehouse is the awake view).
//
// Rules (§12.9): every `*S` is sim seconds (ticks ÷ 10) except elapsedS and
// pausedS (wall clock); null = not reached. `pm.playtest.v1` holds the
// profile plus a `restore` record (the accumulators the profile alone cannot
// rebuild: the fps histogram, the first-malware parcel id, …); attach()
// resumes from it only for the same run (same seed, simS within one autosave
// period of the sim's) — a New game starts a fresh profile.
import {
  onSimEvent,
  type SimEmitter,
  type SimEventName,
  type SimEventPayloads,
} from '../sim/events.ts'
import type { CommandLogEntry } from '../sim/commands.ts'
import type { SimState, VehicleType } from '../sim/types.ts'

export const PLAYTEST_VERSION = 1
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
/** §12.9 fun bar (4): the author keeps playing past 15 min (elapsedS). */
export const FUN_KEEP_PLAYING_S = 900
/** Q55: the summary card is offered once at 20:00 of sim time. */
export const SUMMARY_OFFER_S = 1200

const TICKS_PER_S = 10
const VEHICLE_TYPES: readonly VehicleType[] = ['bike', 'van', 'truck']

// ---- the profile (plan.md §12.9, exactly) ----------------------------------------

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
  atS: number
  label: string
  strain: string | null
  /** The lane's catch rate D(strain) when the parcel passed, 0..1. */
  laneRate: number
  /** The strain's counter machine id (parcels.json), or null. */
  counter: string | null
  clearedByPlayer: boolean
}

export interface Playtest {
  version: 1
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
  /** elapsedS when the summary card was first opened (fun bar 4), or null. */
  summaryOpenedS: number | null
  /** The 20:00 offer ran (once per run, Q55). */
  offered: boolean
}

/** `pm.playtest.v1`: the profile and the accumulators that resume it. */
export interface StoredPlaytest extends Playtest {
  restore: PlaytestRestore
}

// ---- the sim side it reads ----------------------------------------------------------

/** What the recorder needs of a Sim (the class satisfies it). */
export interface PlaytestSim {
  readonly state: SimState
  readonly events: SimEmitter
  readonly commandLog: readonly CommandLogEntry[]
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

function parseLifeLost(v: unknown): PlaytestLifeLost | null {
  if (!isObj(v) || typeof v.label !== 'string') return null
  return {
    atS: num(v.atS),
    label: v.label,
    strain: strOrNull(v.strain),
    laneRate: num(v.laneRate),
    counter: strOrNull(v.counter),
    clearedByPlayer: v.clearedByPlayer === true,
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
  r.taps = Math.max(0, Math.floor(num(v.taps)))
  r.viewSwitches = Math.max(0, Math.floor(num(v.viewSwitches)))
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
  r.summaryOpenedS = numOrNull(v.summaryOpenedS)
  r.offered = v.offered === true
  return r
}

/**
 * The stored profile belongs to this run: version 1, same seed, its simS
 * within RESTORE_WINDOW_S of the sim's, and a `restore` record.
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

// ---- fun bar (§12.9) -----------------------------------------------------------------------

export type FunState = 'pass' | 'fail' | 'judge' | 'pending'

export interface FunCheck {
  /** 1..5 as numbered in plan.md §12.9. */
  n: number
  label: string
  state: FunState
  /** What the check read (`0:47`, `not yet`, `you judge`). */
  detail: string
}

/** The windows the fun bar reads (economy.pacingTargets). */
export interface FunTargets {
  firstDeliveryS: number
  firstMalwareCaughtMaxS: number
  level2Min: readonly [number, number] | readonly number[]
}

/** `m:ss` (minutes not wrapped into hours); `—` for null. */
export function clock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/**
 * The §12.9 fun bar from the profile: (1) first delivery < 60 s; (2) the
 * first malware caught by a checker by 5 min; (3) L2 in 8–15 min; (4) kept
 * playing past 15 min before opening the summary (`openedAtS` = elapsedS at
 * the first opening, default the profile's elapsedS); (5) every lost life
 * explainable (a counter, or Cleared by the player) — the data can only say
 * "explainable"; whether the card made sense is the author's call, so a
 * clean record reads `judge`. `pending` = the window is still open.
 */
export function funBar(
  pt: Playtest,
  targets: FunTargets,
  openedAtS: number | null = null,
): FunCheck[] {
  const out: FunCheck[] = []
  const fd = targets.firstDeliveryS
  const d = pt.firstDeliveryS
  out.push({
    n: 1,
    label: `First delivery under ${clock(fd)}`,
    state:
      d !== null
        ? d < fd
          ? 'pass'
          : 'fail'
        : pt.simS < fd
          ? 'pending'
          : 'fail',
    detail: d !== null ? clock(d) : 'not yet',
  })
  const cm = targets.firstMalwareCaughtMaxS
  const c = pt.firstMalware.caughtS
  out.push({
    n: 2,
    label: `Malware caught by ${clock(cm)}`,
    state:
      c !== null
        ? c <= cm
          ? 'pass'
          : 'fail'
        : pt.simS < cm
          ? 'pending'
          : 'fail',
    detail: c !== null ? clock(c) : 'not yet',
  })
  const lo = (targets.level2Min[0] ?? 8) * 60
  const hi = (targets.level2Min[1] ?? 15) * 60
  const l2 = pt.level2AtS
  out.push({
    n: 3,
    label: `Level 2 between ${clock(lo)} and ${clock(hi)}`,
    state:
      l2 !== null
        ? l2 >= lo && l2 <= hi
          ? 'pass'
          : 'fail'
        : pt.simS <= hi
          ? 'pending'
          : 'fail',
    detail: l2 !== null ? clock(l2) : 'not yet',
  })
  const opened = openedAtS ?? pt.elapsedS
  out.push({
    n: 4,
    label: `Kept playing past ${clock(FUN_KEEP_PLAYING_S)}`,
    state: opened > FUN_KEEP_PLAYING_S ? 'pass' : 'fail',
    detail: `summary at ${clock(opened)}`,
  })
  const lost = pt.livesLost
  const unexplained = lost.filter(
    (l) => l.counter === null && !l.clearedByPlayer,
  )
  out.push({
    n: 5,
    label: 'Every lost life explained',
    state:
      lost.length === 0 ? 'pass' : unexplained.length > 0 ? 'fail' : 'judge',
    detail:
      lost.length === 0
        ? 'none lost'
        : unexplained.length > 0
          ? `${unexplained.length} without a counter`
          : 'you judge',
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

  /** The 20:00 offer already ran this run. */
  get offered(): boolean {
    return this.r.offered
  }

  /**
   * Follow `sim`. With `stored` (pm.playtest.v1) of the same run the
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

  /** The 20:00 offer ran. */
  markOffered(): void {
    this.r.offered = true
  }

  /** The live profile (plan.md §12.9). */
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
    let inspectorsHired = 0
    let rushTaps = 0
    for (const e of log) {
      const c = e.cmd
      if (c.kind === 'buyVehicle')
        vehiclesBought.push({ type: c.type, atS: ticksToS(e.tick) })
      else if (c.kind === 'buyMachine')
        machinesBought.push({ id: c.defId, atS: ticksToS(e.tick) })
      else if (c.kind === 'hireInspector') inspectorsHired += 1
      else if (c.kind === 'rush') rushTaps += 1
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

  /** What pm.playtest.v1 stores: the profile plus its accumulators. */
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
    on('life:lost', (p) => {
      const atS = ticksToS(p.report?.tick ?? this.tick())
      // A replayed loss (a reload just before it) is recorded once.
      if (this.r.livesLost.some((l) => l.atS === atS && l.label === p.label))
        return
      this.r.livesLost.push({
        atS,
        label: p.label,
        strain: p.strain,
        laneRate: Math.round(p.laneRate * 1000) / 1000,
        counter: p.counterMachineId,
        clearedByPlayer: p.clearedByPlayerAt !== null,
      })
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
