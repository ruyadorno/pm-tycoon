// Static map facts the sim reads (spec §3, plan.md §6.4): building and
// district lookups, the warehouse lot (block (2,2): entrance (19, 23), dock /
// queue / parking tiles from map.json), live state of a region, and the
// per-type vehicle rules (spec §3.3 "allowed", §4.1 sizes, units, the
// Industrial hard rule, home zones incl. the hubs' zoneDistricts). Pure: one
// index per GameData, cached in a WeakMap and never serialised. Lookups only —
// iteration always walks the data arrays in file order (plan.md §6.4).

import type {
  BuildingDef,
  DistrictDef,
  GameData,
  MapData,
  SizeId,
  VehicleTypeDef,
} from '../data/types.ts'
import type {
  BuildingId,
  DistrictId,
  SimState,
  TileXY,
  VehicleType,
  Zone,
} from './types.ts'

/** The warehouse lot (map.json `lot`, spec §3.1). */
export interface LotTiles {
  entrance: TileXY
  /** Dock bay tiles, dock1..dock3. */
  docks: TileXY[]
  /** Queue positions, index 0 nearest the docks. */
  queue: TileXY[]
  parking: TileXY[]
  /** Drivable lot tiles: the lot block minus the warehouse footprint and the sign tile. */
  drive: TileXY[]
}

export interface MapIndex {
  readonly data: GameData
  /** building id → index in data.buildings (= the "lower building id" order). */
  readonly buildingIdx: Record<BuildingId, number>
  readonly districtById: Record<DistrictId, DistrictDef>
  /** district id → its buildings in buildings.json order. */
  readonly buildingsByDistrict: Record<DistrictId, BuildingDef[]>
  readonly typeById: Record<string, VehicleTypeDef>
  readonly lot: LotTiles
}

const cache = new WeakMap<GameData, MapIndex>()

const xy = (p: readonly [number, number]): TileXY => ({ x: p[0], y: p[1] })

/** The drivable lot tiles (spec §3.1: lot = block (2,2) minus the 4×4 warehouse). */
function lotDriveTiles(map: MapData): TileXY[] {
  const lotBlock = map.blocks.find((b) => b.kind === 'lot')
  if (!lotBlock) throw new Error('map.json: no lot block')
  const [b, r] = lotBlock.block
  const a = map.avenues
  const x0 = (a[b] as number) + 1
  const x1 = (a[b + 1] as number) - 1
  const y0 = (a[r] as number) + 1
  const y1 = (a[r + 1] as number) - 1
  const [wx, wy] = map.lot.warehouse.tile
  const [ww, wh] = map.lot.warehouse.footprint
  const [sx, sy] = map.lot.sign
  const out: TileXY[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const inWarehouse = x >= wx && x < wx + ww && y >= wy && y < wy + wh
      if (inWarehouse || (x === sx && y === sy)) continue
      out.push({ x, y })
    }
  }
  return out
}

export function mapIndex(data: GameData): MapIndex {
  const hit = cache.get(data)
  if (hit) return hit
  const buildingIdx: Record<BuildingId, number> = {}
  data.buildings.forEach((b, i) => {
    buildingIdx[b.id] = i
  })
  const districtById: Record<DistrictId, DistrictDef> = {}
  const buildingsByDistrict: Record<DistrictId, BuildingDef[]> = {}
  for (const d of data.districts) {
    districtById[d.id] = d
    buildingsByDistrict[d.id] = []
  }
  for (const b of data.buildings) buildingsByDistrict[b.district]?.push(b)
  const typeById: Record<string, VehicleTypeDef> = {}
  for (const t of data.vehicles.types) typeById[t.id] = t
  const lot = data.map.lot
  const idx: MapIndex = {
    data,
    buildingIdx,
    districtById,
    buildingsByDistrict,
    typeById,
    lot: {
      entrance: xy(lot.entrance),
      docks: lot.docks.map(xy),
      queue: lot.queue.map(xy),
      parking: lot.parking.map(xy),
      drive: lotDriveTiles(data.map),
    },
  }
  cache.set(data, idx)
  return idx
}

export function buildingDef(data: GameData, id: BuildingId): BuildingDef {
  const i = mapIndex(data).buildingIdx[id]
  const b = i === undefined ? undefined : data.buildings[i]
  if (!b) throw new Error(`unknown building ${id}`)
  return b
}

/** Position in buildings.json (ties → "lower building id", spec §4.5 step 4). */
export function buildingOrder(data: GameData, id: BuildingId): number {
  return mapIndex(data).buildingIdx[id] ?? Number.MAX_SAFE_INTEGER
}

export function districtDef(data: GameData, id: DistrictId): DistrictDef {
  const d = mapIndex(data).districtById[id]
  if (!d) throw new Error(`unknown district ${id}`)
  return d
}

export function districtOf(data: GameData, buildingId: BuildingId): DistrictId {
  return buildingDef(data, buildingId).district
}

/** The road tile vehicles stop at for this building (spec §3.4 anchor). */
export function anchorOf(data: GameData, buildingId: BuildingId): TileXY {
  return xy(buildingDef(data, buildingId).anchor)
}

export function isLive(state: SimState, districtId: DistrictId): boolean {
  return state.districts[districtId]?.live === true
}

export function vehicleTypeDef(
  data: GameData,
  type: VehicleType,
): VehicleTypeDef {
  const t = mapIndex(data).typeById[type]
  if (!t) throw new Error(`unknown vehicle type ${type}`)
  return t
}

/**
 * Spec §3.3 "Allowed": the district lists the type and the type does not
 * list the district in disallowedRegions (Industrial = trucks only, the only
 * hard rule).
 */
export function typeAllowedIn(
  data: GameData,
  type: VehicleType,
  districtId: DistrictId,
): boolean {
  const d = mapIndex(data).districtById[districtId]
  if (!d || !d.allowed.includes(type)) return false
  return !vehicleTypeDef(data, type).disallowedRegions.includes(districtId)
}

export function sizeAllowed(def: VehicleTypeDef, size: SizeId): boolean {
  return def.sizes.includes(size)
}

/** Capacity units of a parcel size (vehicles.json unitsBySize, spec §4.1). */
export function unitsOf(data: GameData, size: SizeId): number {
  return data.vehicles.unitsBySize[size]
}

/**
 * Spec §4.1 home zone: `any`, the district itself, or — for an overseas hub
 * — one of its zoneDistricts.
 */
export function zonePermits(
  data: GameData,
  zone: Zone,
  districtId: DistrictId,
): boolean {
  if (zone === 'any' || zone === districtId) return true
  const d = mapIndex(data).districtById[districtId]
  return d?.kind === 'overseas' && d.zoneDistricts.includes(zone)
}

export const sameTile = (a: TileXY, b: TileXY): boolean =>
  a.x === b.x && a.y === b.y
