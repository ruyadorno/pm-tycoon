// Boot-time validator for the static tables (plan.md §6.6) plus the map.json
// geometry helpers it needs (re-exported by index.ts for src/sim and the
// renderers). No zod/ajv: small combinators collect `problems` with
// JSON-pointer-like paths, e.g. "buildings[12].anchor: not a road tile".
// Shape checks run first; the cross-id and geometry checks only run on data
// whose shape is valid.

import type {
  BuildingDef,
  DataFileName,
  GameData,
  MapBlockDef,
  MapData,
  MapSegment,
  Rect,
  ThemedRoadDef,
  XY,
} from './types.ts'

export type Problems = string[]
export type Check = (v: unknown, path: string, out: Problems) => boolean

export const DATA_FILES: readonly DataFileName[] = [
  'districts',
  'buildings',
  'vehicles',
  'machines',
  'employees',
  'parcels',
  'economy',
  'levels',
  'puns',
  'map',
]

const SIZES = ['S', 'M', 'L', 'XL'] as const
const STRAINS = ['metal', 'rattle', 'battery', 'dense'] as const
const VEHICLES = ['bike', 'van', 'truck'] as const
/** style-guide.md §1.8 ramps allowed as region colours (red = danger only; mal/gold reserved). */
const REGION_COLOUR =
  /^(grey|grass|leaf|water|blue|orange|yellow|purple|pink|brown)\d$/

// ---------------------------------------------------------------- combinators

function show(v: unknown): string {
  const s = JSON.stringify(v)
  if (s === undefined) return String(v)
  return s.length > 40 ? `${s.slice(0, 37)}...` : s
}

function fail(out: Problems, path: string, msg: string): false {
  out.push(`${path}: ${msg}`)
  return false
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function num(min = -Infinity, max = Infinity): Check {
  return (v, p, out) => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      return fail(out, p, `expected a number, got ${show(v)}`)
    if (v < min || v > max)
      return fail(out, p, `${v} is outside ${min}..${max}`)
    return true
  }
}

export function int(min = -Infinity, max = Infinity): Check {
  const n = num(min, max)
  return (v, p, out) =>
    n(v, p, out) &&
    (Number.isInteger(v) || fail(out, p, `expected an integer, got ${show(v)}`))
}

export const str: Check = (v, p, out) =>
  (typeof v === 'string' && v.length > 0) ||
  fail(out, p, `expected a non-empty string, got ${show(v)}`)

export const bool: Check = (v, p, out) =>
  typeof v === 'boolean' || fail(out, p, `expected a boolean, got ${show(v)}`)

function pattern(re: RegExp, what: string): Check {
  return (v, p, out) =>
    (typeof v === 'string' && re.test(v)) ||
    fail(out, p, `expected ${what}, got ${show(v)}`)
}

/** snake_case id (district, building, machine and frame ids). */
const snakeId = pattern(/^[a-z][a-z0-9_]*$/, 'a snake_case id')

export function oneOf(values: readonly unknown[]): Check {
  return (v, p, out) =>
    values.includes(v) ||
    fail(
      out,
      p,
      `expected one of ${values.map(show).join('|')}, got ${show(v)}`,
    )
}

export function nullable(check: Check): Check {
  return (v, p, out) => v === null || check(v, p, out)
}

export function arr(item: Check, min = 0, max = Infinity): Check {
  return (v, p, out) => {
    if (!Array.isArray(v))
      return fail(out, p, `expected an array, got ${show(v)}`)
    if (v.length < min || v.length > max)
      return fail(out, p, `expected ${min}..${max} items, got ${v.length}`)
    let ok = true
    v.forEach((x, i) => {
      if (!item(x, `${p}[${i}]`, out)) ok = false
    })
    return ok
  }
}

export function tuple(...items: Check[]): Check {
  return (v, p, out) => {
    if (!Array.isArray(v) || v.length !== items.length)
      return fail(out, p, `expected ${items.length} items, got ${show(v)}`)
    return items.every((c, i) => c(v[i], `${p}[${i}]`, out))
  }
}

/** A [min, max] pair with min <= max. */
export function range(min = -Infinity, max = Infinity): Check {
  const pair = tuple(num(min, max), num(min, max))
  return (v, p, out) =>
    pair(v, p, out) &&
    ((v as number[])[0]! <= (v as number[])[1]! ||
      fail(out, p, `range ${show(v)} is not ascending`))
}

/** A record; with `keys`, exactly those keys. */
export function rec(keys: readonly string[] | null, value: Check): Check {
  return (v, p, out) => {
    if (!isRecord(v)) return fail(out, p, `expected an object, got ${show(v)}`)
    let ok = true
    for (const k of keys ?? []) {
      if (!(k in v)) ok = fail(out, `${p}.${k}`, 'missing')
    }
    for (const [k, x] of Object.entries(v)) {
      if (keys && !keys.includes(k)) ok = fail(out, `${p}.${k}`, 'unknown key')
      else if (!value(x, `${p}.${k}`, out)) ok = false
    }
    return ok
  }
}

/** An object with required and optional fields; unknown keys are problems. */
export function obj(
  required: Record<string, Check>,
  optional: Record<string, Check> = {},
): Check {
  return (v, p, out) => {
    if (!isRecord(v)) return fail(out, p, `expected an object, got ${show(v)}`)
    let ok = true
    for (const [k, c] of Object.entries(required)) {
      if (!(k in v)) ok = fail(out, `${p}.${k}`, 'missing')
      else if (!c(v[k], `${p}.${k}`, out)) ok = false
    }
    for (const [k, x] of Object.entries(v)) {
      if (k in required) continue
      const c = optional[k]
      if (!c) ok = fail(out, `${p}.${k}`, 'unknown key')
      else if (!c(x, `${p}.${k}`, out)) ok = false
    }
    return ok
  }
}

// ---------------------------------------------------------------- table shapes

const prob = num(0, 1)
const pos = num(Number.MIN_VALUE)
const nonNeg = num(0)
const money = int(0)
const lvl = int(1, 99)
const xy = tuple(int(0), int(0))
const frame = snakeId

const districtBase = {
  id: snakeId,
  name: str,
  flavour: str,
  unlockLevel: lvl,
  kind: oneOf(['district', 'overseas']),
  blocks: arr(xy, 1),
  favoured: arr(oneOf(VEHICLES)),
  allowed: arr(oneOf(VEHICLES), 1),
  hardRule: bool,
}
const liveDistrict = obj({
  ...districtBase,
  sizeMix: rec(SIZES, prob),
  spawnIntervalS: pos,
})
const overseasDistrict = obj({
  ...districtBase,
  zoneDistricts: arr(snakeId),
  clearanceS: nonNeg,
  valueMult: nonNeg,
  malwareMult: nonNeg,
  hubWeight: nonNeg,
  sizes: arr(oneOf(SIZES), 1),
})
const district: Check = (v, p, out) =>
  isRecord(v) && v.kind === 'overseas'
    ? overseasDistrict(v, p, out)
    : liveDistrict(v, p, out)

const building = obj({
  id: snakeId,
  district: snakeId,
  name: str,
  footprint: tuple(int(1, 3), int(1, 3)),
  tile: xy,
  anchor: xy,
  send: int(0),
  recv: int(0),
})

const vehicles = obj({
  unitsBySize: rec(SIZES, int(1)),
  stopS: nonNeg,
  dockUnloadPerS: pos,
  dockLoadPerS: pos,
  dockIdleWaitS: nonNeg,
  dockIdleWaitOnlyIfQueueEmpty: bool,
  collectRadiusTiles: nonNeg,
  rushExpireS: nonNeg,
  dispatchTickS: num(0.1),
  lastVehicleUnsellable: bool,
  types: arr(
    obj({
      id: oneOf(VEHICLES),
      name: str,
      unlockLevel: lvl,
      price: money,
      capacityUnits: int(1),
      sizes: arr(oneOf(SIZES), 1),
      speedTilesPerS: pos,
      driverSalaryPerDay: money,
      disallowedRegions: arr(snakeId),
    }),
    1,
  ),
})

const machines = obj({
  slotBufferCap: int(1),
  conveyorCapPerDock: int(1),
  checkers: arr(
    obj({
      id: snakeId,
      name: str,
      unlockLevel: lvl,
      price: money,
      strain: oneOf([...STRAINS, 'any']),
      pMatch: prob,
      pOther: prob,
      decoyFlag: prob,
      processS: pos,
    }),
  ),
  upgrades: arr(
    obj({
      id: snakeId,
      name: str,
      unlockLevel: lvl,
      price: money,
      target: oneOf(['holdBay']),
      autoTossDelayS: nonNeg,
    }),
  ),
  removalRefund: prob,
})

const employees = obj({
  inspector: obj({
    name: str,
    salaryPerDay: money,
    hireFee: money,
    processS: pos,
    strain: oneOf(['any']),
    pMatch: prob,
    pOther: prob,
    decoyFlag: prob,
    maxPerDesk: int(1),
    startCount: int(0),
    startSlot: int(1),
  }),
  maxDesks: int(1),
  deskPrice: money,
  payrollIntervalS: pos,
  payOrder: arr(oneOf(['inspectors', 'drivers']), 1),
  walkoutAfterUnpaidPaydays: int(1),
  rehireFeeDays: nonNeg,
})

const parcels = obj({
  sizes: rec(SIZES, obj({ units: int(1), value: money })),
  decay: obj({ graceS: nonNeg, floorAtS: nonNeg, floor: prob }),
  onTimeMaxS: nonNeg,
  spawn: obj({
    firstSpawnDelayS: nonNeg,
    maxWaitingPerBuilding: int(1),
    sameDistrictShare: prob,
    overseasShare: prob,
  }),
  malware: obj({
    graceS: nonNeg,
    graceCount: int(0),
    baseShare: prob,
    perLevel: prob,
    cap: prob,
    postVictoryPerDay: prob,
    overseasMult: nonNeg,
    newStrainDelayS: nonNeg,
    strains: arr(
      obj(
        { id: oneOf(STRAINS), level: lvl, counter: snakeId },
        { flavour: str },
      ),
      1,
    ),
    firstScripted: obj({
      atS: nonNeg,
      strain: oneOf(STRAINS),
      size: oneOf(SIZES),
      servableOrigin: bool,
      forcedCatch: bool,
      deferUntilCheckerS: nonNeg,
    }),
  }),
  decoyShare: prob,
  magic: obj({
    countdownS: nonNeg,
    reward: money,
    lives: int(0),
    maxAlive: int(0),
    skipsCheckers: bool,
  }),
})

const satisfactionKeys = [
  'start',
  'min',
  'max',
  'driftPerDayToward',
  'driftStep',
  'onTime',
  'favouredBonus',
  'favouredPickup',
  'positiveCapPerDay',
  'late',
  'waitingOver180s',
  'waitingPenaltyAfterS',
  'waitingPenaltyCapPerDay',
  'malwareDelivered',
  'wrongToss',
  'intervalMultAt0',
  'intervalMultAt50',
  'intervalMultAt100',
  'loudBelow',
  'happyAbove',
]

const economy = obj({
  startMoney: money,
  sellRefund: prob,
  tossBounty: money,
  wrongTossFee: money,
  docks: arr(obj({ index: int(2, 3), unlockLevel: lvl, price: money })),
  satisfaction: rec(satisfactionKeys, num()),
  lives: obj({ start: int(1), cap: int(1) }),
  continueWithOneLife: bool,
  playtestMaxLevel: int(1, 5),
  pacingTargets: obj({
    firstDeliveryS: nonNeg,
    firstMalwareCaughtMaxS: nonNeg,
    level2Min: range(0),
    truckAfterLevel2MaxMin: nonNeg,
    maxLivesLost: int(0),
    maxShelfStallS: nonNeg,
    holdBayEventsPer10MinMin: nonNeg,
    level3Min: range(0),
    level4Min: range(0),
    level5Min: range(0),
  }),
})

const levels = arr(
  obj(
    {
      level: lvl,
      title: str,
      threshold: money,
      unlockRegions: arr(snakeId),
      vehicles: arr(oneOf(VEHICLES)),
      machines: arr(snakeId),
      slots: int(1, 6),
      holdBayCap: int(1, 5),
      shelfCap: int(1),
      warehouseTier: int(1, 5),
      strain: nullable(oneOf(STRAINS)),
      ticker: str,
    },
    {
      ultimateQuest: obj({
        id: snakeId,
        days: int(1),
        deliveries: int(1),
        maxMalwareDelivered: int(0),
        minOnTimeRate: prob,
      }),
    },
  ),
  1,
)

const puns = obj({
  cleanLabels: arr(str, 1),
  malwareLabels: rec(STRAINS, arr(str)),
  decoyLabels: rec(STRAINS, arr(str)),
  streets: arr(str, 1),
  tracks: arr(str, 1),
  inspectorNames: arr(str, 1),
  driverNames: arr(str, 1),
  companyName: str,
  tossHint: str,
  wantedTitle: str,
  tickerFiller: arr(str, 1),
})

const segment = {
  axis: oneOf(['x', 'y']),
  at: int(0),
  from: int(0),
  to: int(0),
}

const mapShape = obj({
  size: tuple(int(8, 256), int(8, 256)),
  avenues: arr(int(0), 2),
  trimmed: arr(obj(segment)),
  themedRoads: arr(
    obj({
      id: oneOf(['quay', 'beach_road', 'promenade', 'seafront']),
      frame,
      ...segment,
    }),
  ),
  blocks: arr(
    obj({
      block: xy,
      kind: oneOf(['region', 'lot', 'scenery']),
      region: snakeId,
      ground: frame,
      accent: nullable(frame),
    }),
    1,
  ),
  ground: obj({
    road: frame,
    default: frame,
    accentEvery: int(1),
    lot: obj({ parking: frame, queue: frame }),
    scenery: arr(
      obj({ name: str, rect: tuple(int(0), int(0), int(0), int(0)), frame }),
    ),
  }),
  lot: obj({
    entrance: xy,
    docks: arr(xy, 1, 3),
    queue: arr(xy, 1),
    parking: arr(xy),
    sign: xy,
    warehouse: obj({ tile: xy, footprint: tuple(int(1), int(1)) }),
  }),
  regions: arr(
    obj({
      id: snakeId,
      colour: pattern(REGION_COLOUR, 'a palette colour id such as "orange2"'),
      chipLabel: str,
      labelTile: xy,
    }),
    1,
  ),
  props: arr(obj({ frame, tile: xy, region: snakeId })),
  buildings: rec(null, obj({ doorOffset: xy })),
  lockedStyle: oneOf(['frames', 'fill']),
})

const SHAPES: Record<DataFileName, Check> = {
  districts: arr(district, 1),
  buildings: arr(building, 1),
  vehicles,
  machines,
  employees,
  parcels,
  economy,
  levels,
  puns,
  map: mapShape,
}

// ---------------------------------------------------------------- map geometry

const key = (x: number, y: number): string => `${x},${y}`

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]
}

export function onSegment(s: MapSegment, x: number, y: number): boolean {
  return s.axis === 'x'
    ? x === s.at && y >= s.from && y <= s.to
    : y === s.at && x >= s.from && x <= s.to
}

/** Tile rect of block (b, r): between avenues b and b+1, r and r+1. */
export function blockRect(map: MapData, b: number, r: number): Rect | null {
  const a = map.avenues
  const x0 = a[b]
  const x1 = a[b + 1]
  const y0 = a[r]
  const y1 = a[r + 1]
  if (
    x0 === undefined ||
    x1 === undefined ||
    y0 === undefined ||
    y1 === undefined
  )
    return null
  return [x0 + 1, y0 + 1, x1 - 1, y1 - 1]
}

/** Block coordinates [b, r] of the block containing tile (x, y), or null. */
export function blockAt(map: MapData, x: number, y: number): XY | null {
  const a = map.avenues
  for (let b = 0; b + 1 < a.length; b++) {
    if (x <= a[b]! || x >= a[b + 1]!) continue
    for (let r = 0; r + 1 < a.length; r++) {
      if (y > a[r]! && y < a[r + 1]!) return [b, r]
    }
  }
  return null
}

/** map.json blocks[] row for tile (x, y), or null on avenues and edges. */
export function mapBlockAt(
  map: MapData,
  x: number,
  y: number,
): MapBlockDef | null {
  const br = blockAt(map, x, y)
  if (!br) return null
  return (
    map.blocks.find((m) => m.block[0] === br[0] && m.block[1] === br[1]) ?? null
  )
}

/** On an avenue line (trimmed or not). */
export function isAvenueTile(map: MapData, x: number, y: number): boolean {
  const a = map.avenues
  const lo = a[0]!
  const hi = a[a.length - 1]!
  return (
    (a.includes(x) && y >= lo && y <= hi) ||
    (a.includes(y) && x >= lo && x <= hi)
  )
}

export function isTrimmedTile(map: MapData, x: number, y: number): boolean {
  return isAvenueTile(map, x, y) && map.trimmed.some((s) => onSegment(s, x, y))
}

/** A node of the road graph: an avenue tile that is not trimmed (spec §3.1). */
export function isRoadTile(map: MapData, x: number, y: number): boolean {
  return isAvenueTile(map, x, y) && !map.trimmed.some((s) => onSegment(s, x, y))
}

/** Every road-graph tile, row-major (y, then x). */
export function roadTiles(map: MapData): XY[] {
  const out: XY[] = []
  for (let y = 0; y < map.size[1]; y++)
    for (let x = 0; x < map.size[0]; x++)
      if (isRoadTile(map, x, y)) out.push([x, y])
  return out
}

/** Themed one-sided avenues covering a road tile (two at a corner, e.g. (3,43)). */
export function roadThemesAt(
  map: MapData,
  x: number,
  y: number,
): ThemedRoadDef[] {
  if (!isRoadTile(map, x, y)) return []
  return map.themedRoads.filter((t) => onSegment(t, x, y))
}

/** Road tiles reachable from `start` over 4-connected road tiles. */
export function reachableRoads(map: MapData, start: XY): Set<string> {
  const seen = new Set<string>()
  if (!isRoadTile(map, start[0], start[1])) return seen
  const queue: XY[] = [start]
  seen.add(key(start[0], start[1]))
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      const k = key(nx, ny)
      if (!seen.has(k) && isRoadTile(map, nx, ny)) {
        seen.add(k)
        queue.push([nx, ny])
      }
    }
  }
  return seen
}

export function footprintRect(
  b: Pick<BuildingDef, 'tile' | 'footprint'>,
): Rect {
  const [x, y] = b.tile
  return [x, y, x + b.footprint[0] - 1, y + b.footprint[1] - 1]
}

/** Absolute door tile: tile + map.buildings[id].doorOffset. */
export function doorTile(map: MapData, b: BuildingDef): XY {
  const off = map.buildings[b.id]?.doorOffset ?? [0, 0]
  return [b.tile[0] + off[0], b.tile[1] + off[1]]
}

/** Base ground frame stem of tile (x, y) (road tiles get ground.road). */
export function groundAt(map: MapData, x: number, y: number): string {
  const g = map.ground
  if (isRoadTile(map, x, y)) return g.road
  const block = mapBlockAt(map, x, y)
  if (block) {
    if (block.kind === 'lot') {
      const at = ([tx, ty]: XY): boolean => tx === x && ty === y
      if (map.lot.parking.some(at)) return g.lot.parking
      if (map.lot.queue.some(at)) return g.lot.queue
    }
    if (block.accent && (x + 2 * y) % g.accentEvery === 0) return block.accent
    return block.ground
  }
  return g.scenery.find((r) => inRect(r.rect, x, y))?.frame ?? g.default
}

/** groundAt for every tile, row-major: index = y * size[0] + x. */
export function groundFrames(map: MapData): string[] {
  const out: string[] = []
  for (let y = 0; y < map.size[1]; y++)
    for (let x = 0; x < map.size[0]; x++) out.push(groundAt(map, x, y))
  return out
}

// ---------------------------------------------------------------- cross checks

type Tables = Omit<GameData, 'hash'>

function uniqueIds(
  rows: readonly { id: string }[],
  path: string,
  out: Problems,
): Set<string> {
  const first = new Map<string, number>()
  rows.forEach((r, i) => {
    const j = first.get(r.id)
    if (j === undefined) first.set(r.id, i)
    else
      out.push(
        `${path}[${i}].id: duplicate id "${r.id}" (first at ${path}[${j}])`,
      )
  })
  return new Set(first.keys())
}

function crossCheck(d: Tables, out: Problems): void {
  const bad = (path: string, msg: string): void => {
    out.push(`${path}: ${msg}`)
  }
  const districtIds = uniqueIds(d.districts, 'districts', out)
  const buildingIds = uniqueIds(d.buildings, 'buildings', out)
  const vehicleIds = uniqueIds(d.vehicles.types, 'vehicles.types', out)
  const checkerIds = uniqueIds(d.machines.checkers, 'machines.checkers', out)
  const upgradeIds = uniqueIds(d.machines.upgrades, 'machines.upgrades', out)
  const strainIds = uniqueIds(
    d.parcels.malware.strains,
    'parcels.malware.strains',
    out,
  )
  const nLevels = d.levels.length
  const levelAt = (n: number) => d.levels[n - 1]
  const levelRef = (
    path: string,
    n: number,
    list: 'unlockRegions' | 'vehicles' | 'machines',
    id: string,
  ): void => {
    const row = levelAt(n)
    if (!row) bad(path, `level ${n} does not exist (${nLevels} levels)`)
    else if (!(row[list] as readonly string[]).includes(id))
      bad(path, `levels[${n - 1}].${list} does not list "${id}"`)
  }
  for (const u of upgradeIds)
    if (checkerIds.has(u))
      bad('machines.upgrades', `id "${u}" is also a checker id`)

  // levels
  const unlockedBy = new Map<string, number>()
  d.levels.forEach((l, i) => {
    const p = `levels[${i}]`
    if (l.level !== i + 1)
      bad(`${p}.level`, `expected ${i + 1}, got ${l.level}`)
    if (i === 0 && l.threshold !== 0)
      bad(`${p}.threshold`, 'the first threshold must be 0')
    const prev = d.levels[i - 1]
    if (prev && l.threshold <= prev.threshold)
      bad(
        `${p}.threshold`,
        `${l.threshold} is not above levels[${i - 1}].threshold ${prev.threshold}`,
      )
    l.unlockRegions.forEach((r, j) => {
      if (!districtIds.has(r))
        bad(`${p}.unlockRegions[${j}]`, `unknown district "${r}"`)
      else if (unlockedBy.has(r))
        bad(
          `${p}.unlockRegions[${j}]`,
          `"${r}" is already unlocked by levels[${unlockedBy.get(r)}]`,
        )
      else unlockedBy.set(r, i)
    })
    l.vehicles.forEach((v, j) => {
      if (!vehicleIds.has(v))
        bad(`${p}.vehicles[${j}]`, `unknown vehicle type "${v}"`)
    })
    l.machines.forEach((m, j) => {
      if (!checkerIds.has(m) && !upgradeIds.has(m))
        bad(`${p}.machines[${j}]`, `unknown machine "${m}"`)
    })
    if (l.strain !== null && !strainIds.has(l.strain))
      bad(`${p}.strain`, `unknown strain "${l.strain}"`)
  })

  // districts
  const buildingCount = new Map<string, number>()
  for (const b of d.buildings)
    buildingCount.set(b.district, (buildingCount.get(b.district) ?? 0) + 1)
  d.districts.forEach((dist, i) => {
    const p = `districts[${i}]`
    levelRef(`${p}.unlockLevel`, dist.unlockLevel, 'unlockRegions', dist.id)
    dist.favoured.forEach((v, j) => {
      if (!dist.allowed.includes(v))
        bad(`${p}.favoured[${j}]`, `"${v}" is not in allowed`)
    })
    for (const t of d.vehicles.types) {
      if (dist.allowed.includes(t.id) === t.disallowedRegions.includes(dist.id))
        bad(
          `${p}.allowed`,
          `"${t.id}" disagrees with vehicles.types disallowedRegions`,
        )
    }
    const n = buildingCount.get(dist.id) ?? 0
    const [lo, hi] =
      dist.kind === 'district' ? ([10, 12] as const) : ([2, 3] as const)
    if (n < lo || n > hi)
      bad(p, `${n} buildings, expected ${lo}..${hi} for kind "${dist.kind}"`)
    if (dist.kind === 'district') {
      const sum = Object.values(dist.sizeMix).reduce((s, x) => s + x, 0)
      if (Math.abs(sum - 1) > 1e-6)
        bad(`${p}.sizeMix`, `sums to ${sum}, expected 1 ± 1e-6`)
    } else {
      dist.zoneDistricts.forEach((z, j) => {
        const zd = d.districts.find((x) => x.id === z)
        if (!zd) bad(`${p}.zoneDistricts[${j}]`, `unknown district "${z}"`)
        else if (zd.kind !== 'district')
          bad(`${p}.zoneDistricts[${j}]`, `"${z}" is not a live district`)
      })
    }
  })

  // vehicles
  d.vehicles.types.forEach((t, i) => {
    const p = `vehicles.types[${i}]`
    levelRef(`${p}.unlockLevel`, t.unlockLevel, 'vehicles', t.id)
    t.disallowedRegions.forEach((r, j) => {
      if (!districtIds.has(r))
        bad(`${p}.disallowedRegions[${j}]`, `unknown district "${r}"`)
    })
    for (const s of t.sizes) {
      if (d.vehicles.unitsBySize[s] > t.capacityUnits)
        bad(
          `${p}.capacityUnits`,
          `${t.capacityUnits} cannot hold one ${s} parcel`,
        )
    }
  })
  for (const s of SIZES) {
    if (d.vehicles.unitsBySize[s] !== d.parcels.sizes[s].units)
      bad(`vehicles.unitsBySize.${s}`, `differs from parcels.sizes.${s}.units`)
  }

  // machines
  d.machines.checkers.forEach((c, i) => {
    levelRef(
      `machines.checkers[${i}].unlockLevel`,
      c.unlockLevel,
      'machines',
      c.id,
    )
    if (c.strain !== 'any' && !strainIds.has(c.strain))
      bad(`machines.checkers[${i}].strain`, `unknown strain "${c.strain}"`)
  })
  d.machines.upgrades.forEach((u, i) => {
    levelRef(
      `machines.upgrades[${i}].unlockLevel`,
      u.unlockLevel,
      'machines',
      u.id,
    )
  })

  // parcels
  const mal = d.parcels.malware
  mal.strains.forEach((s, i) => {
    const p = `parcels.malware.strains[${i}]`
    if (!checkerIds.has(s.counter))
      bad(`${p}.counter`, `unknown checker "${s.counter}"`)
    const row = levelAt(s.level)
    if (!row) bad(`${p}.level`, `level ${s.level} does not exist`)
    else if (row.strain !== s.id)
      bad(`${p}.level`, `levels[${s.level - 1}].strain is not "${s.id}"`)
  })
  if (!strainIds.has(mal.firstScripted.strain))
    bad(
      'parcels.malware.firstScripted.strain',
      `unknown strain "${mal.firstScripted.strain}"`,
    )
  if (mal.baseShare > mal.cap)
    bad('parcels.malware.baseShare', `above cap ${mal.cap}`)
  if (d.parcels.decay.graceS >= d.parcels.onTimeMaxS)
    bad(
      'parcels.decay.graceS',
      `must be below onTimeMaxS ${d.parcels.onTimeMaxS}`,
    )

  // employees, economy
  const insp = d.employees.inspector
  const l1 = d.levels[0]
  if (l1 && insp.startSlot > l1.slots)
    bad(
      'employees.inspector.startSlot',
      `${insp.startSlot} exceeds levels[0].slots ${l1.slots}`,
    )
  if (insp.startCount > insp.maxPerDesk)
    bad(
      'employees.inspector.startCount',
      `exceeds maxPerDesk ${insp.maxPerDesk}`,
    )
  const eco = d.economy
  if (eco.playtestMaxLevel > nLevels)
    bad(
      'economy.playtestMaxLevel',
      `${eco.playtestMaxLevel} exceeds the ${nLevels} levels`,
    )
  eco.docks.forEach((k, i) => {
    if (k.unlockLevel > nLevels)
      bad(
        `economy.docks[${i}].unlockLevel`,
        `level ${k.unlockLevel} does not exist`,
      )
    if (k.index > d.map.lot.docks.length)
      bad(
        `economy.docks[${i}].index`,
        `map.lot.docks has only ${d.map.lot.docks.length} bays`,
      )
  })
  const sat = eco.satisfaction
  if (!(sat.min <= sat.start && sat.start <= sat.max && sat.min < sat.max))
    bad('economy.satisfaction', 'expected min <= start <= max')
  if (!(sat.waitingPenaltyAfterS > 0))
    bad(
      'economy.satisfaction.waitingPenaltyAfterS',
      `expected a positive number of seconds, got ${sat.waitingPenaltyAfterS}`,
    )
  if (eco.lives.start > eco.lives.cap)
    bad('economy.lives.start', `exceeds cap ${eco.lives.cap}`)

  // puns
  for (const { id: s } of mal.strains) {
    if (!d.puns.malwareLabels[s]?.length)
      bad(`puns.malwareLabels.${s}`, `empty list for strain "${s}"`)
    if (!d.puns.decoyLabels[s]?.length)
      bad(`puns.decoyLabels.${s}`, `empty list for strain "${s}"`)
  }

  checkMap(d, districtIds, buildingIds, out)
}

function checkMap(
  d: Tables,
  districtIds: Set<string>,
  buildingIds: Set<string>,
  out: Problems,
): void {
  const m = d.map
  const bad = (path: string, msg: string): void => {
    out.push(`${path}: ${msg}`)
  }
  const [W, H] = m.size
  const inMap = (path: string, [x, y]: XY): boolean => {
    if (x < W && y < H) return true
    bad(path, `[${x},${y}] is outside the ${W}x${H} map`)
    return false
  }
  const av = m.avenues
  const before = out.length
  av.forEach((a, i) => {
    if (i > 0 && a <= av[i - 1]!) bad(`map.avenues[${i}]`, 'not ascending')
    if (a >= W || a >= H) bad(`map.avenues[${i}]`, 'outside the map')
  })
  if (out.length > before) return
  const lo = av[0]!
  const hi = av[av.length - 1]!
  const seg = (path: string, s: MapSegment): void => {
    if (!av.includes(s.at)) bad(`${path}.at`, `${s.at} is not an avenue line`)
    if (s.from > s.to || s.from < lo || s.to > hi)
      bad(path, `span ${s.from}..${s.to} is outside ${lo}..${hi}`)
  }
  m.trimmed.forEach((s, i) => seg(`map.trimmed[${i}]`, s))
  m.themedRoads.forEach((t, i) => {
    seg(`map.themedRoads[${i}]`, t)
    for (let v = t.from; v <= t.to; v++) {
      const [x, y] = t.axis === 'x' ? [t.at, v] : [v, t.at]
      if (isTrimmedTile(m, x, y))
        bad(`map.themedRoads[${i}]`, `[${x},${y}] is trimmed`)
    }
  })

  // blocks <-> districts
  const n = av.length - 1
  const blockIndex = new Map<string, number>()
  let lotBlock: Rect | null = null
  for (const [i, b] of m.blocks.entries()) {
    const p = `map.blocks[${i}]`
    const [bx, by] = b.block
    if (bx >= n || by >= n) {
      bad(`${p}.block`, `[${bx},${by}] is outside the ${n}x${n} blocks`)
      continue
    }
    if (blockIndex.has(key(bx, by)))
      bad(`${p}.block`, `duplicate block [${bx},${by}]`)
    blockIndex.set(key(bx, by), i)
    if (b.kind === 'region') {
      const dist = d.districts.find((x) => x.id === b.region)
      if (!dist) bad(`${p}.region`, `unknown district "${b.region}"`)
      else if (!dist.blocks.some(([x, y]) => x === bx && y === by))
        bad(
          `${p}.region`,
          `districts "${b.region}".blocks does not list [${bx},${by}]`,
        )
    } else if (b.kind === 'lot') {
      if (b.region !== 'warehouse')
        bad(`${p}.region`, 'the lot block region must be "warehouse"')
      if (lotBlock) bad(`${p}.kind`, 'more than one lot block')
      lotBlock = blockRect(m, bx, by)
    } else if (districtIds.has(b.region) || b.region === 'warehouse') {
      bad(`${p}.region`, `scenery block cannot be "${b.region}"`)
    }
  }
  if (blockIndex.size !== n * n)
    bad('map.blocks', `${blockIndex.size} blocks, expected ${n * n}`)
  if (!lotBlock) {
    bad('map.blocks', 'no lot block')
    return
  }
  const lot = lotBlock
  d.districts.forEach((dist, i) => {
    dist.blocks.forEach(([bx, by], j) => {
      const mb = m.blocks[blockIndex.get(key(bx, by)) ?? -1]
      if (!mb || mb.kind !== 'region' || mb.region !== dist.id)
        bad(
          `districts[${i}].blocks[${j}]`,
          `map.blocks has no region block [${bx},${by}] for "${dist.id}"`,
        )
    })
  })

  // roads: connected and containing the lot entrance
  const roads = roadTiles(m)
  const entrance = m.lot.entrance
  if (!isRoadTile(m, entrance[0], entrance[1]))
    bad('map.lot.entrance', 'not a road tile')
  const reach = reachableRoads(m, entrance)
  if (reach.size !== roads.length)
    bad(
      'map',
      `road graph is not connected: ${reach.size} of ${roads.length} road tiles reachable from the lot entrance`,
    )

  // buildings: footprint inside one district block, no overlaps, anchor on an adjacent road
  const occupied = new Map<string, number>()
  d.buildings.forEach((b, i) => {
    const p = `buildings[${i}]`
    const fr = footprintRect(b)
    if (!inMap(`${p}.tile`, [fr[2], fr[3]]) || !inMap(`${p}.anchor`, b.anchor))
      return
    const dist = d.districts.find((x) => x.id === b.district)
    if (!dist) {
      bad(`${p}.district`, `unknown district "${b.district}"`)
      return
    }
    let home: Rect | null = null
    for (const [bx, by] of dist.blocks) {
      const r = blockRect(m, bx, by)
      if (r && inRect(r, fr[0], fr[1]) && inRect(r, fr[2], fr[3])) home = r
    }
    if (!home)
      bad(
        `${p}.tile`,
        `footprint [${fr[0]}..${fr[2]}]x[${fr[1]}..${fr[3]}] is not inside one block of district "${b.district}"`,
      )
    const overlapped = new Set<number>()
    for (let y = fr[1]; y <= fr[3]; y++) {
      for (let x = fr[0]; x <= fr[2]; x++) {
        const j = occupied.get(key(x, y))
        if (j === undefined) occupied.set(key(x, y), i)
        else if (!overlapped.has(j)) {
          overlapped.add(j)
          bad(
            `${p}.tile`,
            `footprint overlaps buildings[${j}] ("${d.buildings[j]!.id}") at [${x},${y}]`,
          )
        }
      }
    }
    const [ax, ay] = b.anchor
    if (!isRoadTile(m, ax, ay)) {
      bad(
        `${p}.anchor`,
        `not a road tile [${ax},${ay}]${isTrimmedTile(m, ax, ay) ? ' (trimmed)' : ''}`,
      )
    } else {
      if (home) {
        const adjacent =
          ((ax === home[0] - 1 || ax === home[2] + 1) &&
            ay >= home[1] &&
            ay <= home[3]) ||
          ((ay === home[1] - 1 || ay === home[3] + 1) &&
            ax >= home[0] &&
            ax <= home[2])
        if (!adjacent)
          bad(
            `${p}.anchor`,
            `[${ax},${ay}] is not on an avenue adjacent to its block`,
          )
      }
      if (!reach.has(key(ax, ay)))
        bad(`${p}.anchor`, 'not connected to the lot entrance')
    }
    const door = m.buildings[b.id]
    if (!door) bad(`map.buildings`, `missing "${b.id}"`)
    else {
      const [dx, dy] = door.doorOffset
      if (dx >= b.footprint[0] || dy >= b.footprint[1])
        bad(
          `map.buildings.${b.id}.doorOffset`,
          `[${dx},${dy}] is outside the ${b.footprint[0]}x${b.footprint[1]} footprint`,
        )
    }
  })
  for (const k of Object.keys(m.buildings))
    if (!buildingIds.has(k)) bad(`map.buildings.${k}`, 'unknown building')

  // lot tiles: inside the lot block, one role per tile
  const lotRoles = new Map<string, string>()
  const lotTile = (path: string, [x, y]: XY): void => {
    if (!inRect(lot, x, y)) {
      bad(path, `[${x},${y}] is outside the lot block`)
      return
    }
    const other = lotRoles.get(key(x, y))
    if (other) bad(path, `[${x},${y}] is also ${other}`)
    else lotRoles.set(key(x, y), path)
  }
  const wh = m.lot.warehouse
  for (let y = wh.tile[1]; y < wh.tile[1] + wh.footprint[1]; y++)
    for (let x = wh.tile[0]; x < wh.tile[0] + wh.footprint[0]; x++)
      lotTile('map.lot.warehouse', [x, y])
  m.lot.docks.forEach((t, i) => lotTile(`map.lot.docks[${i}]`, t))
  m.lot.queue.forEach((t, i) => lotTile(`map.lot.queue[${i}]`, t))
  m.lot.parking.forEach((t, i) => lotTile(`map.lot.parking[${i}]`, t))
  lotTile('map.lot.sign', m.lot.sign)

  // regions
  const regionIds = new Set<string>()
  const labels = new Set<string>()
  m.regions.forEach((r, i) => {
    const p = `map.regions[${i}]`
    if (regionIds.has(r.id)) bad(`${p}.id`, `duplicate region "${r.id}"`)
    regionIds.add(r.id)
    const [x, y] = r.labelTile
    labels.add(key(x, y))
    const blocks =
      r.id === 'warehouse'
        ? [lot]
        : (d.districts.find((dd) => dd.id === r.id)?.blocks ?? []).map(
            ([bx, by]) => blockRect(m, bx, by),
          )
    if (!districtIds.has(r.id) && r.id !== 'warehouse')
      bad(`${p}.id`, `unknown region "${r.id}"`)
    else if (!blocks.some((b) => b && inRect(b, x, y)))
      bad(`${p}.labelTile`, `[${x},${y}] is outside the region's blocks`)
  })
  for (const id of [...districtIds, 'warehouse'])
    if (!regionIds.has(id)) bad('map.regions', `missing region "${id}"`)

  // props: free, non-road, non-lot tiles; region matches the block
  const sceneryRegions = new Set(
    m.blocks.filter((b) => b.kind === 'scenery').map((b) => b.region),
  )
  const propTiles = new Set<string>()
  m.props.forEach((pr, i) => {
    const p = `map.props[${i}]`
    const [x, y] = pr.tile
    if (!inMap(`${p}.tile`, pr.tile)) return
    if (isAvenueTile(m, x, y)) bad(`${p}.tile`, `[${x},${y}] is an avenue tile`)
    const j = occupied.get(key(x, y))
    if (j !== undefined)
      bad(
        `${p}.tile`,
        `[${x},${y}] is inside buildings[${j}] ("${d.buildings[j]!.id}")`,
      )
    if (inRect(lot, x, y))
      bad(`${p}.tile`, `[${x},${y}] is on the warehouse lot`)
    if (labels.has(key(x, y)))
      bad(`${p}.tile`, `[${x},${y}] is a region labelTile`)
    if (propTiles.has(key(x, y)))
      bad(`${p}.tile`, `duplicate prop tile [${x},${y}]`)
    propTiles.add(key(x, y))
    if (
      !districtIds.has(pr.region) &&
      pr.region !== 'warehouse' &&
      !sceneryRegions.has(pr.region)
    )
      bad(`${p}.region`, `unknown region "${pr.region}"`)
    const mb = mapBlockAt(m, x, y)
    if (mb && mb.region !== pr.region)
      bad(
        `${p}.region`,
        `"${pr.region}" but the tile is in block region "${mb.region}"`,
      )
  })
  m.ground.scenery.forEach((s, i) => {
    const [x0, y0, x1, y1] = s.rect
    if (x0 > x1 || y0 > y1 || x1 >= W || y1 >= H)
      bad(`map.ground.scenery[${i}].rect`, 'empty or outside the map')
  })
}

// ---------------------------------------------------------------- entry point

/** Every problem in `raw` (an object keyed by data file stem); [] when valid. */
export function validateGameData(raw: unknown): Problems {
  const out: Problems = []
  if (!isRecord(raw)) {
    fail(out, 'data', 'expected an object keyed by data file name')
    return out
  }
  for (const k of Object.keys(raw)) {
    if (!(DATA_FILES as readonly string[]).includes(k))
      out.push(`${k}: unknown data file`)
  }
  for (const name of DATA_FILES) {
    if (!(name in raw)) out.push(`${name}: missing data file`)
    else SHAPES[name](raw[name], name, out)
  }
  if (out.length) return out
  crossCheck(raw as unknown as Tables, out)
  return out
}
