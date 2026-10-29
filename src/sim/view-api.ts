// The ViewSim facade (plan.md §5): the only object scenes touch. Read-only
// fields and queries derive from sim.state; every command builds a Command
// and goes through Sim.dispatch, returning its result. Nothing here mutates
// state directly (the `debug` helpers are commands too, so replays stay
// exact). The pure §6.3 readouts live in detection.ts and are re-exported
// here with their M0 signatures.

import type { BuildingDef, GameData, MapData } from '../data/types.ts'
import type { CommandResult } from './commands.ts'
import {
  announcedStrains,
  laneCatchRate,
  laneRatePerMin,
  machineChecker,
} from './detection.ts'
import type { SimEmitter, StallReason } from './events.ts'
import type { Sim } from './sim.ts'
import type {
  Building,
  BuildingId,
  DistrictId,
  LaneNode,
  LoadingDock,
  Parcel,
  Size,
  Strain,
  Tick,
  TilePos,
  VehicleState,
  VehicleType,
  Zone,
} from './types.ts'
import {
  laneNode,
  meanSatisfaction,
  TICKS_PER_DAY,
  TICKS_PER_S,
  ticksFromS,
} from './types.ts'
import { paidValue } from './value.ts'

export {
  activeCheckers,
  activeStrains,
  checkerP,
  laneCatchRate,
  laneRatePerMin,
} from './detection.ts'

/** What the city view reads per frame (city-view.md §2). */
export interface VehicleSnapshot {
  id: number
  type: VehicleType
  name: string
  driverName: string | null
  state: VehicleState
  /** Tile position at the start / end of the last tick; lerp by the stepper alpha. */
  prev: TilePos
  cur: TilePos
  /** Lower-case for frame names (bike_ne_0). */
  heading: 'ne' | 'se' | 'sw' | 'nw'
  wheel: 0 | 1
  /** Building of the stop the vehicle is standing at, else null. */
  stopAt: BuildingId | null
  cargo: { id: number; size: Size; destId: BuildingId }[]
  /** 0-based place in the dock queue while queued, else null. */
  queuePos: number | null
  dockId: string | null
  zone: Zone
  /** Driver marked unpaid at the last payday (§7.4). */
  unpaid: boolean
  rushBuildingId: BuildingId | null
  /** ADDITION (M1): delivery stops left incl. the current one (follow strip "Delivering · N stops"); 0 otherwise. */
  stopsLeft: number
  /** ADDITION (M1): capacity units aboard / of the type (§4.1). */
  unitsUsed: number
  capacityUnits: number
}

/** buildingAt() result: the static row + the dynamic part. */
export interface BuildingInfo {
  id: BuildingId
  def: BuildingDef
  state: Building
  /** The building's district is live (tappable, spawns, receives). */
  live: boolean
}

export type Trend = 'up' | 'down' | 'flat'

/** districtStats() (city-view.md §5.1). */
export interface DistrictStats {
  id: DistrictId
  kind: 'district' | 'overseas'
  locked: boolean
  unlockLevel: number
  satisfaction: number
  /** Δ since the last day boundary: ▲ ≥ +3, ▼ ≤ −3 (spec §9.2). */
  trend: Trend
  trendDelta: number
  /** $ paid for parcels delivered to this district. */
  earned: number
  waiting: Record<Size, number>
  waitingCount: number
  waitingBuildings: number
  /** Age of the oldest waiting parcel in sim seconds, or null. */
  oldestWaitingS: number | null
  vehiclesHomed: number
}

/** One strain's lane catch rate (spec §6.3). */
export interface StrainDetection {
  strain: Strain
  /** D(s) = 1 − Π(1 − p_i(s)) over live slots with ≥ 1 station, 0..1. */
  d: number
  /** parcels.json strains[].counter (a machines.json id). */
  counter: string
}

export interface LaneStats {
  ratePerMin: number
  /** round(100 × mean over announced strains of D(s)). */
  detectionPct: number
  byStrain: { strain: Strain; pct: number; counter: string }[]
  stalled: { reason: StallReason; nodeId: string } | null
  /**
   * ADDITION (M2): the counter machine for the weakest announced strain
   * (spec §6.3 "tap → per-strain list with the counter machine suggested for
   * the weakest strain"): its strain and current %, the machine
   * (parcels.json strains[].counter), whether the lane already holds one,
   * and the % with one more of it. Null with no announced strain.
   */
  suggest: {
    strain: Strain
    pct: number
    counter: string
    owned: boolean
    withCounterPct: number
  } | null
}

export interface PayrollView {
  /** Sum of active employees' daily salaries. */
  perDay: number
  /** The last payday left someone unpaid. */
  short: boolean
  inspectors: number
  drivers: number
}

/** One Hold Bay item (bay = 0-based rack position, lowest first). */
export interface HoldBayItem {
  parcelId: number
  bay: number
  /** ADDITION (M2): the trait it was flagged on (parcel.flaggedStrain). */
  strain: Strain | null
  /**
   * ADDITION (M2): the flagging checker's name ("Metal detector",
   * "Inspection desk") and the slot it flagged in, from the parcel's
   * 'flagged' trace entry — still right after the fixture moved or left.
   */
  checkerName: string | null
  nodeId: string | null
}

export interface HoldBayView {
  /** bay = 0-based rack position (index in the Hold Bay queue, lowest first). */
  readonly items: readonly HoldBayItem[]
  readonly cap: number
  readonly count: number
  toss(parcelId: number): CommandResult
  clear(parcelId: number): CommandResult
}

export interface LaneView {
  /** Every node incl. locked ones, in state order (flow order = next edges). */
  nodes(): readonly LaneNode[]
  /** Parcels per minute (spec §6.3). */
  rate(): number
  detection(): StrainDetection[]
  readonly stalled: { reason: StallReason; nodeId: string } | null
  buyMachine(defId: string, nodeId: string): CommandResult
  placeDesk(nodeId: string): CommandResult
  moveFixture(from: string, to: string): CommandResult
  removeFixture(nodeId: string): CommandResult
  hireInspector(): CommandResult
  fireInspector(employeeId: number): CommandResult
  rehire(employeeId: number): CommandResult
}

/**
 * Debug-build helpers for shots / tests (each dispatches a debug command):
 * forceFlagNext — the next checker roll flags its parcel on `strain`;
 * fillHoldBay — every free bay gets a freshly flagged parcel (malware and
 * decoys in turn), so the next flag stalls the lane; forceMalwareDelivery —
 * a malware parcel is delivered now (life:lost with a full card payload).
 */
export interface ViewSimDebug {
  forceFlagNext(strain: Strain): CommandResult
  fillHoldBay(): CommandResult
  forceMalwareDelivery(): CommandResult
}

export interface ViewSim {
  /** Static tables (prices, names, thresholds) for labels. */
  readonly data: GameData
  readonly map: MapData
  readonly vehicles: readonly VehicleSnapshot[]
  readonly money: number
  readonly lifetimeEarned: number
  readonly level: number
  /** levels.json threshold the level bar counts toward (keeps the L3 row at the playtest cap). */
  readonly nextThreshold: number | null
  readonly lives: number
  readonly gameOver: boolean
  readonly tick: Tick
  /** Completed in-game days (HUD "Day N" = day + 1). */
  readonly day: number
  /** 0..1 within the current day. */
  readonly dayProgress: number
  readonly ticksToPayday: number
  readonly holdBay: HoldBayView
  readonly lane: LaneView
  readonly shelf: { readonly ids: readonly number[]; readonly cap: number }
  readonly quarantine: { count: number; malware: number; clean: number }
  readonly docks: readonly LoadingDock[]
  readonly daysSinceIncident: number
  readonly events: SimEmitter
  regionState(id: string): 'locked' | 'live'
  buildingAt(tx: number, ty: number): BuildingInfo | null
  waitingAt(buildingId: BuildingId): readonly Parcel[]
  /** Active rush flag; `vehicleId` = the vehicle sent (null while none is eligible, §4.1). */
  rushState(
    buildingId: BuildingId,
  ): { untilTick: Tick; vehicleId: number | null } | null
  /** ADDITION (M1): one parcel by id (hidden flags included — never show them), or null. */
  parcel(id: number): Parcel | null
  /** ADDITION (M1): what the parcel would pay now, round(base × f(t)) (spec §5.3), or null. */
  parcelValue(id: number): number | null
  /** ADDITION (M1): vehicle ids in the lot's dock queue, index 0 docks next. */
  readonly dockQueue: readonly number[]
  districtStats(id: DistrictId): DistrictStats | null
  meanSatisfaction(): number
  laneStats(): LaneStats
  payroll(): PayrollView
  rush(buildingId: BuildingId): CommandResult
  buyVehicle(type: VehicleType): CommandResult
  sellVehicle(id: number): CommandResult
  setHomeZone(id: number, zone: Zone): CommandResult
  /** Re-hire the walked-out driver of vehicle `id` ('no-vehicle' if none). */
  rehireDriver(id: number): CommandResult
  /** economy.continueWithOneLife (playtest flag) after game over. */
  grantLife(): CommandResult
  /** Present only with `{debug: true}`. */
  readonly debug: ViewSimDebug | null
}

export interface ViewSimOptions {
  debug?: boolean
}

// The facade ----------------------------------------------------------------------

const TREND_STEP = 3 // spec §9.2 trend arrow (▲ ≥ +3, ▼ ≤ −3), a display rule
const HEADINGS = { NE: 'ne', SE: 'se', SW: 'sw', NW: 'nw' } as const

/** The per-frame vehicle snapshots (city-view.md §2). */
function snapshotVehicles(sim: Sim): VehicleSnapshot[] {
  const s = sim.state
  return s.vehicles.map((v) => {
    const driver = s.employees.find((e) => e.id === v.driverId) ?? null
    const stopped =
      v.waitUntilTick !== null &&
      (v.state === 'delivering' || v.state === 'collecting')
    const qi = s.lane.dockQueue.indexOf(v.id)
    return {
      id: v.id,
      type: v.type,
      name: v.name,
      driverName: driver && driver.active ? driver.name : null,
      state: v.state,
      prev: { ...v.prev },
      cur: { ...v.pos },
      heading: HEADINGS[v.heading],
      wheel: v.wheel,
      stopAt: stopped ? (v.stops[v.stopIndex]?.buildingId ?? null) : null,
      cargo: v.cargo.flatMap((id) => {
        const p = s.parcels[String(id)]
        return p ? [{ id, size: p.size, destId: p.dest }] : []
      }),
      queuePos: v.state === 'queued' && qi >= 0 ? qi : null,
      dockId: v.dockId,
      zone: v.zone,
      unpaid: (driver?.unpaidPaydays ?? 0) > 0,
      rushBuildingId: v.rushBuildingId,
      stopsLeft:
        v.state === 'delivering'
          ? Math.max(0, v.stops.length - v.stopIndex)
          : 0,
      unitsUsed: v.unitsUsed,
      capacityUnits:
        sim.data.vehicles.types.find((t) => t.id === v.type)?.capacityUnits ??
        0,
    }
  })
}

/**
 * Build the facade over a sim, or over a getter (so scenes keep one facade
 * across Sim.load / New game; event subscriptions are re-bound by
 * simBinding.ts either way).
 */
export function createViewSim(
  source: Sim | (() => Sim),
  opts: ViewSimOptions = {},
): ViewSim {
  const get = typeof source === 'function' ? source : () => source
  const st = () => get().state
  const run = (cmd: Parameters<Sim['dispatch']>[0]) => get().dispatch(cmd)

  let vCache: { sim: Sim; rev: number; list: VehicleSnapshot[] } | null = null
  let tileIndex: { data: GameData; idx: Int32Array; w: number } | null = null

  const node = (id: string): LaneNode | null => laneNode(st().lane, id)
  const stalled = () => {
    const l = st().lane
    return l.stalled && l.stallReason !== null && l.stallNodeId !== null
      ? { reason: l.stallReason, nodeId: l.stallNodeId }
      : null
  }
  const detection = (): StrainDetection[] => {
    const sim = get()
    return announcedStrains(sim.state, sim.data).map((strain) => ({
      strain,
      d: laneCatchRate(sim.state.lane, strain),
      counter:
        sim.data.parcels.malware.strains.find((s) => s.id === strain)
          ?.counter ?? '',
    }))
  }

  const holdBay: HoldBayView = {
    get items() {
      const s = st()
      const q = node(s.lane.holdBayNodeId)?.queue ?? []
      return q.map((parcelId, bay): HoldBayItem => {
        const p = s.parcels[String(parcelId)]
        const flagged = p?.trace.findLast((t) => t.what === 'flagged')
        // "Slot 1 Metal detector: flagged (metal)" → "Metal detector"
        const m = /^Slot \d+ (.+): flagged/.exec(flagged?.text ?? '')
        return {
          parcelId,
          bay,
          strain: p?.flaggedStrain ?? null,
          checkerName: m?.[1] ?? null,
          nodeId: flagged?.ref ?? null,
        }
      })
    },
    get cap() {
      return node(st().lane.holdBayNodeId)?.cap ?? st().level.holdBayCap
    },
    get count() {
      return node(st().lane.holdBayNodeId)?.queue.length ?? 0
    },
    toss: (parcelId) => run({ kind: 'toss', parcelId }),
    clear: (parcelId) => run({ kind: 'clear', parcelId }),
  }

  const lane: LaneView = {
    nodes: () => st().lane.nodes,
    rate: () => laneRatePerMin(st().lane, get().data),
    detection,
    get stalled() {
      return stalled()
    },
    buyMachine: (defId, nodeId) => run({ kind: 'buyMachine', defId, nodeId }),
    placeDesk: (nodeId) => run({ kind: 'placeDesk', nodeId }),
    moveFixture: (from, to) => run({ kind: 'moveFixture', from, to }),
    removeFixture: (nodeId) => run({ kind: 'removeFixture', nodeId }),
    hireInspector: () => run({ kind: 'hireInspector' }),
    fireInspector: (employeeId) => run({ kind: 'fireInspector', employeeId }),
    rehire: (employeeId) => run({ kind: 'rehire', employeeId }),
  }

  const debug: ViewSimDebug | null = opts.debug
    ? {
        forceFlagNext: (strain) => run({ kind: 'debugForceFlag', strain }),
        fillHoldBay: () => run({ kind: 'debugFillHoldBay' }),
        forceMalwareDelivery: () => run({ kind: 'debugMalwareDelivery' }),
      }
    : null

  const buildingIndex = (data: GameData) => {
    if (tileIndex && tileIndex.data === data) return tileIndex
    const [w, h] = data.map.size
    const idx = new Int32Array(w * h).fill(-1)
    data.buildings.forEach((b, i) => {
      const [x0, y0] = b.tile
      const [fw, fh] = b.footprint
      for (let y = y0; y < y0 + fh; y++) {
        for (let x = x0; x < x0 + fw; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h) idx[y * w + x] = i
        }
      }
    })
    tileIndex = { data, idx, w }
    return tileIndex
  }

  return {
    get data() {
      return get().data
    },
    get map() {
      return get().data.map
    },
    get vehicles() {
      const sim = get()
      if (!vCache || vCache.sim !== sim || vCache.rev !== sim.revision) {
        vCache = { sim, rev: sim.revision, list: snapshotVehicles(sim) }
      }
      return vCache.list
    },
    get money() {
      return st().economy.balance
    },
    get lifetimeEarned() {
      return st().economy.lifetimeEarned
    },
    get level() {
      return st().level.level
    },
    get nextThreshold() {
      return st().level.nextThreshold
    },
    get lives() {
      return st().economy.lives
    },
    get gameOver() {
      return st().economy.gameOver
    },
    get tick() {
      return st().tick
    },
    get day() {
      return st().day
    },
    get dayProgress() {
      return (st().tick % TICKS_PER_DAY) / TICKS_PER_DAY
    },
    get ticksToPayday() {
      const every = ticksFromS(get().data.employees.payrollIntervalS)
      return every - (st().tick % every)
    },
    holdBay,
    lane,
    get shelf() {
      const n = node(st().lane.shelfNodeId)
      return { ids: n?.queue ?? [], cap: n?.cap ?? st().level.shelfCap }
    },
    get quarantine() {
      return st().lane.quarantine
    },
    get docks() {
      return st().lane.docks
    },
    get daysSinceIncident() {
      return st().economy.daysSinceIncident
    },
    get events() {
      return get().events
    },

    regionState(id) {
      if (id === 'warehouse') return 'live'
      return st().districts[id]?.live ? 'live' : 'locked'
    },
    buildingAt(tx, ty) {
      const sim = get()
      const { idx, w } = buildingIndex(sim.data)
      const x = Math.floor(tx)
      const y = Math.floor(ty)
      if (x < 0 || y < 0 || x >= w || y * w + x >= idx.length) return null
      const def = sim.data.buildings[idx[y * w + x] ?? -1]
      const state = def ? sim.state.buildings[def.id] : undefined
      if (!def || !state) return null
      const live = sim.state.districts[def.district]?.live ?? false
      return { id: def.id, def, state, live }
    },
    waitingAt(buildingId) {
      const s = st()
      return (s.buildings[buildingId]?.waiting ?? []).flatMap((id) => {
        const p = s.parcels[String(id)]
        return p ? [p] : []
      })
    },
    rushState(buildingId) {
      const s = st()
      const until = s.buildings[buildingId]?.rushUntilTick ?? null
      if (until === null || until <= s.tick) return null
      const v = s.vehicles.find((x) => x.rushBuildingId === buildingId)
      return { untilTick: until, vehicleId: v ? v.id : null }
    },
    parcel(id) {
      return st().parcels[String(id)] ?? null
    },
    parcelValue(id) {
      const sim = get()
      const p = sim.state.parcels[String(id)]
      return p ? paidValue(sim.data, p, sim.state.tick) : null
    },
    get dockQueue() {
      return st().lane.dockQueue
    },
    districtStats(id) {
      const sim = get()
      const s = sim.state
      const def = sim.data.districts.find((d) => d.id === id)
      const d = s.districts[id]
      if (!def || !d) return null
      const waiting: Record<Size, number> = { S: 0, M: 0, L: 0, XL: 0 }
      let count = 0
      let buildings = 0
      let oldest: Tick | null = null
      for (const b of sim.data.buildings) {
        if (b.district !== id) continue
        const ids = s.buildings[b.id]?.waiting ?? []
        if (ids.length > 0) buildings += 1
        for (const pid of ids) {
          const p = s.parcels[String(pid)]
          if (!p) continue
          waiting[p.size] += 1
          count += 1
          if (oldest === null || p.spawnedTick < oldest) oldest = p.spawnedTick
        }
      }
      const delta = d.satisfaction - d.satisfactionAtDayStart
      return {
        id,
        kind: def.kind,
        locked: !d.live,
        unlockLevel: def.unlockLevel,
        satisfaction: d.satisfaction,
        trend:
          delta >= TREND_STEP ? 'up' : delta <= -TREND_STEP ? 'down' : 'flat',
        trendDelta: delta,
        earned: d.earned,
        waiting,
        waitingCount: count,
        waitingBuildings: buildings,
        oldestWaitingS:
          oldest === null ? null : (s.tick - oldest) / TICKS_PER_S,
        vehiclesHomed: s.vehicles.filter((v) => v.zone === id).length,
      }
    },
    meanSatisfaction() {
      return meanSatisfaction(st(), get().data)
    },
    laneStats() {
      const sim = get()
      const byStrain = detection()
      const mean =
        byStrain.length === 0
          ? 0
          : byStrain.reduce((sum, x) => sum + x.d, 0) / byStrain.length
      // The weakest strain (first on ties, parcels.json order) and its counter.
      const weakest = byStrain.reduce<StrainDetection | null>(
        (w, x) => (w === null || x.d < w.d ? x : w),
        null,
      )
      const def = weakest
        ? sim.data.machines.checkers.find((c) => c.id === weakest.counter)
        : undefined
      const suggest =
        weakest && def
          ? {
              strain: weakest.strain,
              pct: Math.round(100 * weakest.d),
              counter: weakest.counter,
              owned: sim.state.lane.nodes.some(
                (n) => !n.locked && n.fixture?.checker.defId === def.id,
              ),
              withCounterPct: Math.round(
                100 *
                  laneCatchRate(sim.state.lane, weakest.strain, [
                    machineChecker(def, `counter:${def.id}`, sim.state.tick),
                  ]),
              ),
            }
          : null
      return {
        ratePerMin: Math.round(lane.rate()),
        detectionPct: Math.round(100 * mean),
        byStrain: byStrain.map((x) => ({
          strain: x.strain,
          pct: Math.round(100 * x.d),
          counter: x.counter,
        })),
        stalled: stalled(),
        suggest,
      }
    },
    payroll() {
      const s = st()
      const active = s.employees.filter((e) => e.active)
      return {
        perDay: active.reduce((sum, e) => sum + e.salaryPerDay, 0),
        short: (s.economy.lastPayroll?.shortEmployeeIds.length ?? 0) > 0,
        inspectors: active.filter((e) => e.kind === 'inspector').length,
        drivers: active.filter((e) => e.kind === 'driver').length,
      }
    },

    rush: (buildingId) => run({ kind: 'rush', buildingId }),
    buyVehicle: (type) => run({ kind: 'buyVehicle', type }),
    sellVehicle: (id) => run({ kind: 'sellVehicle', id }),
    setHomeZone: (id, zone) => run({ kind: 'setZone', id, zone }),
    rehireDriver(id) {
      const s = st()
      const e = s.employees.findLast(
        (x) => x.kind === 'driver' && x.vehicleId === id && !x.active,
      )
      if (!e) return { ok: false, reason: 'no-vehicle' }
      return run({ kind: 'rehire', employeeId: e.id })
    },
    grantLife: () => run({ kind: 'continueWithOneLife' }),
    debug,
  }
}
