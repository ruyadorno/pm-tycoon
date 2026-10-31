// Boot-time validator for the static tables (plan.md §6.6) plus the map.json
// geometry helpers it needs (re-exported by index.ts for src/sim and the
// renderers). No zod/ajv: small combinators collect `problems` with
// JSON-pointer-like paths, e.g. "buildings[12].anchor: not a road tile".
// Shape checks run first; the cross-id and geometry checks only run on data
// whose shape is valid.

import type {
  BuildingDef,
  DataFileName,
  EventCategory,
  EventCond,
  EventDef,
  EventEffect,
  EventOptionDef,
  GameData,
  MapBlockDef,
  MapData,
  MapSegment,
  ModifierKey,
  Rect,
  StarApplicantDef,
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
  'quests',
  'events',
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
  // hubs.ts: a 0 s clearance or a ×0 value would make the hub pointless.
  clearanceS: pos,
  valueMult: pos,
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

const ROLES = ['inspector', 'sorter', 'driver'] as const
const salary = obj({ base: nonNeg, perPip: nonNeg, perCharisma: nonNeg })
const statList = arr(
  oneOf(['eye', 'pace', 'charisma', 'judgement', 'speed', 'energy']),
  1,
)

const employees = obj({
  roles: obj({
    inspector: obj({
      stats: statList,
      p: arr(prob, 5, 5),
      decoyFlag: arr(prob, 5, 5),
      processS: arr(pos, 5, 5),
      charismaBonus: arr(prob, 3, 3),
      pCap: prob,
      strain: oneOf(['any']),
      salary,
      hireFeeDays: nonNeg,
    }),
    sorter: obj({
      stats: statList,
      correct: arr(prob, 5, 5),
      decisionS: arr(pos, 5, 5),
      playerGraceS: nonNeg,
      usesWantedList: bool,
      // Q-B2-3 (author, 2026-10-30): the sorter is Toss-only — never Clears.
      canClear: oneOf([false]),
      tagsClean: bool,
      salary,
      hireFeeDays: nonNeg,
    }),
    driver: obj({
      stats: statList,
      speedMult: arr(pos, 5, 5),
      stopMult: arr(pos, 5, 5),
      charismaDelivery: arr(int(0), 3, 3),
      charismaPickup: arr(int(0), 3, 3),
      affinityPips: int(0, 4),
      salary,
      hireFeeDays: nonNeg,
    }),
  }),
  applicants: obj({
    // ≤ 3: the HireSheet lays out three cards.
    poolSize: int(1, 3),
    refreshEveryDays: int(1),
    adPrice: money,
    starExpiryDays: int(1),
    pipWeights: rec(null, arr(nonNeg, 5, 5)),
    charismaWeights: arr(nonNeg, 3, 3),
    affinityWeights: rec(['none', ...VEHICLES], nonNeg),
  }),
  start: obj({
    inspector: obj({
      name: str,
      pips: rec(['eye', 'pace', 'charisma'], int(0, 5)),
      slot: int(1),
    }),
  }),
  desks: obj({
    maxPerDesk: int(1),
    rows: arr(obj({ index: int(1), unlockLevel: lvl, price: money }), 1),
  }),
  holdStation: obj({ unlockLevel: lvl }),
  payrollIntervalS: pos,
  payOrder: arr(oneOf(['inspectors', 'sorters', 'drivers']), 3, 3),
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
    firstOverseasClearedAfterLevel3MaxMin: nonNeg,
    questsOfferedBy30MinMin: int(0),
    questsCompletedBy30MinMin: int(0),
    payrollShareOfGrossMax: prob,
    goldenReleaseOfferedMaxMin: nonNeg,
    victoryMaxMin: nonNeg,
    eventsOfferedBy30MinMin: int(0),
    eventsOpenMaxTicks: int(0),
    eventsL1PlateauMin: int(0),
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

// quests.json (spec-build2 §3.2, §9; design-m7 §1.5) ------------------------------

const QUEST_GOAL_KINDS = [
  'deliveriesFrom',
  'satisfactionAtLeast',
  'magicParcel',
  'tossStreak',
  'onTimeRateDay',
  'deliveriesOfSize',
  'holdDecisions',
  'overseasCleared',
  'detectionAllStrains',
] as const
const QUEST_TARGETS = ['district:mostWaiting', 'district:satisfactionBelow']

/** A number, or one per level (1..5 entries; crossCheck caps them at the level count). */
function levelScaled(item: Check): Check {
  const list = arr(item, 1, 5)
  return (v, p, out) => (Array.isArray(v) ? list(v, p, out) : item(v, p, out))
}

const goalKind = str
const QUEST_GOALS: Record<(typeof QUEST_GOAL_KINDS)[number], Check> = {
  deliveriesFrom: obj({ kind: goalKind, count: levelScaled(int(1)) }),
  satisfactionAtLeast: obj({ kind: goalKind, value: num(0, 100) }),
  magicParcel: obj({ kind: goalKind, maxRoadTiles: int(1) }),
  tossStreak: obj({ kind: goalKind, count: levelScaled(int(1)) }),
  onTimeRateDay: obj({ kind: goalKind, rate: prob, minDeliveries: int(1) }),
  deliveriesOfSize: obj({
    kind: goalKind,
    size: oneOf(SIZES),
    count: levelScaled(int(1)),
  }),
  holdDecisions: obj({
    kind: goalKind,
    count: levelScaled(int(1)),
    noStall: bool,
  }),
  overseasCleared: obj({
    kind: goalKind,
    hub: snakeId,
    count: levelScaled(int(1)),
  }),
  detectionAllStrains: obj({
    kind: goalKind,
    rate: prob,
    holdDays: num(Number.MIN_VALUE),
  }),
}

/** Discriminated on `kind`: an unknown kind is "…goal.kind: expected one of …". */
const questGoal: Check = (v, p, out) => {
  if (!isRecord(v)) return fail(out, p, `expected an object, got ${show(v)}`)
  if (!oneOf(QUEST_GOAL_KINDS)(v.kind, `${p}.kind`, out)) return false
  return QUEST_GOALS[v.kind as (typeof QUEST_GOAL_KINDS)[number]](v, p, out)
}

const questReward = obj(
  {},
  {
    cash: levelScaled(money),
    satisfaction: int(1, 100),
    lives: int(1),
    starApplicant: obj(
      {
        role: oneOf(['inspector', 'sorter', 'driver']),
        name: str,
        pips: rec(null, int(0, 5)),
      },
      { affinity: oneOf(['none', ...VEHICLES]) },
    ),
    voucher: snakeId,
  },
)

const quests = obj({
  offer: obj({
    declineCooldownDays: nonNeg,
    // The engine runs one quest slot: more is a schema error, not a clamp.
    maxActive: int(1, 1),
  }),
  templates: arr(
    obj(
      {
        id: snakeId,
        name: str,
        unlockLevel: lvl,
        goal: questGoal,
        weight: nonNeg,
      },
      {
        target: oneOf(QUEST_TARGETS),
        targetArg: num(0, 100),
        condition: str,
        requires: oneOf(['firstToss']),
        limitDays: pos,
        reward: questReward,
      },
    ),
    1,
  ),
})

const puns = obj({
  cleanLabels: arr(str, 1),
  malwareLabels: rec(STRAINS, arr(str)),
  decoyLabels: rec(STRAINS, arr(str)),
  streets: arr(str, 1),
  tracks: arr(str, 1),
  peopleNames: arr(str, 1),
  companyName: str,
  tossHint: str,
  wantedTitle: str,
  tickerFiller: arr(str, 1),
  quests: rec(null, str),
  tickerQuest: obj({
    offered: str,
    completed: str,
    failed: str,
    star: str,
    victory: str,
    endless: str,
  }),
  ultimateQuestName: str,
  tickerEvent: obj({
    offered: str,
    modifierEnded: str,
    chainDone: str,
    subscriptionsUnpaid: str,
  }),
  eventWords: obj({
    // A data key (puns.json eventWords.then), never a thenable.
    // oxlint-disable-next-line unicorn/no-thenable
    then: str,
    thenNow: str,
    cantAfford: str,
    outcome: str,
    youChose: str,
  }),
})

// events.json (spec-build3 §3, §7) ----------------------------------------------

/** The deck's card categories (the job card's 'job' is extra: categories only). */
export const EVENT_CATEGORIES = [
  'staff',
  'fleet',
  'customers',
  'security',
  'money',
  'cityhall',
  'weather',
  'press',
  'underworld',
  'tech',
  'port',
  'luck',
] as const satisfies readonly EventCategory[]
/** Every modifier key (B3 §3.6), in data order; modifiers.ts splits them into MULT_KEYS / ADD_KEYS. */
export const MODIFIER_KEYS = [
  'speed',
  'stop',
  'inspectorP',
  'machineP',
  'processS',
  'payrollMult',
  'payrollAdd',
  'income',
  'malwareShare',
  'decoyShare',
  'spawn',
  'tossBounty',
  'wrongTossFee',
  'vehiclePrice',
  'machinePrice',
  'onTimeMaxS',
  'clearanceS',
  'shelfCap',
] as const satisfies readonly ModifierKey[]
/**
 * The multiplicative keys (a `mod` effect takes `mult`); every other key is
 * additive (`add`). Must equal src/sim/modifiers.ts MULT_KEYS (pinned by
 * tests/data/events.test.ts — src/data never imports the sim).
 */
export const MULT_MODIFIER_KEYS = [
  'speed',
  'stop',
  'processS',
  'payrollMult',
  'income',
  'spawn',
  'tossBounty',
  'wrongTossFee',
  'vehiclePrice',
  'machinePrice',
  'clearanceS',
] as const satisfies readonly ModifierKey[]
type UnlistedCategory = Exclude<
  EventCategory,
  (typeof EVENT_CATEGORIES)[number]
>
type UnlistedModifier = Exclude<ModifierKey, (typeof MODIFIER_KEYS)[number]>
/** Compile-time proof that the two lists cover their unions. */
export const EVENT_LISTS_COMPLETE: [
  UnlistedCategory | UnlistedModifier,
] extends [never]
  ? true
  : UnlistedCategory | UnlistedModifier = true
const PICK_ROLES = ['inspector', 'sorter', 'driver', 'vehicle'] as const
const STATS = ['eye', 'pace', 'charisma', 'judgement', 'speed', 'energy']

const evId = pattern(/^ev_[a-z0-9_]+$/, 'an ev_<snake_case> id')
const flagName = snakeId
const satCond = obj({ scope: str, value: num(0, 100) })
const condShape: Check = obj(
  {},
  {
    fleetAtLeast: int(0),
    fleetAtMost: int(0),
    vehiclesAtLeast: obj({ type: oneOf(VEHICLES), n: int(0) }),
    livesAtLeast: int(0),
    livesBelowCap: oneOf([true]),
    inspectorsAtLeast: int(0),
    driversAtLeast: int(0),
    hasSorter: oneOf([true]),
    hasArm: oneOf([true]),
    hasDesk2: oneOf([true]),
    hubLive: snakeId,
    satBelow: satCond,
    satAtLeast: satCond,
    balanceAtLeast: int(0),
    balanceBelow: int(0),
    balanceBelowVehiclePrice: oneOf(VEHICLES),
    laneRateAtLeast: prob,
    flag: flagName,
    notFlag: flagName,
    livesLostAtLeast: int(0),
    wrongTossTodayAtLeast: int(0),
    questFailedRecently: oneOf([true]),
    // Lazy: `cond` is declared below (a direct reference would hit the TDZ).
    anyOf: arr((v, p, out) => cond(v, p, out), 1),
  },
)
/** EventCond (B3 §4.1): every key optional; `anyOf` recurses. */
const cond: Check = (v, p, out) => condShape(v, p, out)

const branch = obj({ id: evId }, { if: cond })
const starDef = obj(
  { role: oneOf(ROLES), name: str, pips: rec(null, int(0, 5)) },
  { affinity: oneOf(['none', ...VEHICLES]) },
)

/** Sub-discriminated on which key is present (the first of `variants` found). */
function byKey(variants: [key: string, check: Check][]): Check {
  return (v, p, out) => {
    const r = v as Record<string, unknown>
    const hit = variants.find(([k]) => k in r)
    if (!hit)
      return fail(
        out,
        p,
        `expected one of the keys ${variants.map(([k]) => k).join('|')}`,
      )
    return hit[1](v, p, out)
  }
}

const ek = str
const EVENT_EFFECTS: Record<string, Check> = {
  money: obj({ kind: ek, delta: int() }),
  moneyPerVehicle: obj({ kind: ek, delta: int() }, { type: oneOf(VEHICLES) }),
  moneyPct: obj({ kind: ek, pct: num(-1, 1) }),
  lives: obj({ kind: ek, delta: int() }),
  satisfaction: obj({ kind: ek, scope: str, delta: int() }),
  mod: obj(
    { kind: ek, key: oneOf(MODIFIER_KEYS) },
    { mult: nonNeg, add: num(), scope: str, days: pos },
  ),
  pips: obj({
    kind: ek,
    role: oneOf(ROLES),
    stat: oneOf(STATS),
    delta: int(),
    scope: oneOf(['all', 'one']),
  }),
  vehicle: byKey([
    [
      'lose',
      obj({
        kind: ek,
        lose: oneOf([...VEHICLES, 'any']),
        fallback: int(-1e6, 0),
      }),
    ],
    ['gain', obj({ kind: ek, gain: oneOf(VEHICLES) }, { withDriver: starDef })],
  ]),
  staff: byKey([
    [
      'quit',
      obj({
        kind: ek,
        quit: oneOf(ROLES),
        pick: oneOf(['one', 'best', 'worst']),
      }),
    ],
    ['star', obj({ kind: ek, star: starDef })],
    [
      'absent',
      obj({
        kind: ek,
        absent: oneOf([...ROLES, 'vehicles']),
        pick: oneOf(['one', 'all']),
        days: pos,
      }),
    ],
  ]),
  wanted: obj({ kind: ek, reveal: int(1) }),
  parcels: byKey([
    [
      'spawn',
      obj({
        kind: ek,
        spawn: obj({ size: oneOf(SIZES), count: int(1), at: str }),
      }),
    ],
    [
      'lose',
      obj({
        kind: ek,
        lose: obj({ where: oneOf(['shelf']), count: int(1) }),
      }),
    ],
  ]),
  cap: obj({ kind: ek, cap: oneOf(['shelf']), add: int(1) }),
  end: obj({ kind: ek, eventId: evId }),
  flag: byKey([
    ['set', obj({ kind: ek, set: flagName })],
    ['clear', obj({ kind: ek, clear: flagName })],
  ]),
  next: byKey([
    [
      'branches',
      obj({ kind: ek, days: nonNeg, hint: str, branches: arr(branch, 1) }),
    ],
    ['eventId', obj({ kind: ek, eventId: evId, days: nonNeg })],
  ]),
}
const EFFECT_KINDS = Object.keys(EVENT_EFFECTS)

/** Discriminated on `kind` (the questGoal pattern); `job` / `jobDecline` are synthesized only. */
const effect: Check = (v, p, out) => {
  if (!isRecord(v)) return fail(out, p, `expected an object, got ${show(v)}`)
  if (v.kind === 'job' || v.kind === 'jobDecline')
    return fail(
      out,
      `${p}.kind`,
      '"job" effects are synthesized, never in events.json',
    )
  if (!oneOf(EFFECT_KINDS)(v.kind, `${p}.kind`, out)) return false
  return EVENT_EFFECTS[v.kind as string]!(v, p, out)
}

const eventOption = obj(
  { label: str, effects: arr(effect) },
  {
    cost: int(1),
    costPerVehicle: obj({ each: int(1) }, { type: oneOf(VEHICLES) }),
    default: oneOf([true]),
    danger: oneOf([true]),
    if: cond,
  },
)

const eventCard = obj(
  { id: evId, category: oneOf(EVENT_CATEGORIES), title: str },
  {
    body: str,
    minLevel: lvl,
    weight: nonNeg,
    cond,
    target: str,
    pick: oneOf(PICK_ROLES),
    once: oneOf([true]),
    cooldownDays: nonNeg,
    drawable: bool,
    router: oneOf([true]),
    rescue: oneOf([true]),
    options: arr(eventOption, 1, 3),
    next: obj({ days: nonNeg, branches: arr(branch, 1) }),
  },
)

/** Level key ("1", "2", …) → an ascending [lo, hi] of whole seconds (Rng.int needs integers). */
const intervalBand: Check = (v, p, out) =>
  tuple(int(0), int(0))(v, p, out) &&
  ((v as number[])[0]! <= (v as number[])[1]! ||
    fail(out, p, `range ${show(v)} is not ascending`))
const intervalS: Check = (v, p, out) => {
  let ok = rec(null, intervalBand)(v, p, out)
  if (!isRecord(v)) return false
  for (const k of Object.keys(v))
    if (!/^[1-9]\d*$/.test(k))
      ok = fail(out, `${p}.${k}`, 'expected a level number key ("1", "2", …)')
  if (!('1' in v)) ok = fail(out, `${p}.1`, 'missing (the level-1 band)')
  return ok
}

const eventsShape = obj({
  schedule: obj({
    firstEventS: nonNeg,
    intervalS,
    // B3 §3.2 / D-39: links never restart the draw timer; one card at a time.
    linkRestartsTimer: oneOf([false]),
    maxOpen: oneOf([1]),
    maxQueued: int(0),
    afterLevelUpS: nonNeg,
    rescueDelayS: nonNeg,
    jobShare: prob,
    jobCooldownDays: nonNeg,
    recentDays: nonNeg,
    linkMaxDays: nonNeg,
    chainMaxLinks: int(1),
    historyMax: int(1),
    weightDefault: obj({ decision: nonNeg, news: nonNeg }),
  }),
  categories: rec(
    [...EVENT_CATEGORIES, 'job'],
    obj({ word: str, picture: snakeId }),
  ),
  modifiers: obj({
    bounds: rec(MODIFIER_KEYS, range()),
    goodDirection: rec(MODIFIER_KEYS, oneOf(['up', 'down'])),
    permanentDaysForScore: nonNeg,
    deskPFloor: prob,
    machinePClamp: range(0, 1),
    shelfCapMax: int(1),
  }),
  policy: obj({
    weights: obj({
      money: nonNeg,
      life: nonNeg,
      satisfactionPerPoint: nonNeg,
      vehicleGainShare: nonNeg,
      staffQuit: nonNeg,
      absentPerDay: nonNeg,
      wantedPerLabel: nonNeg,
      capPerUnit: nonNeg,
      chain: num(),
      parcelSpawnShare: nonNeg,
      parcelLostEach: nonNeg,
      pips: rec(null, nonNeg),
      mod: rec(MODIFIER_KEYS, nonNeg),
    }),
    evBand: range(),
    evMax: num(0),
    nonDefaultShareMin: prob,
  }),
  deck: arr(eventCard, 1),
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
      obj(
        { name: str, rect: tuple(int(0), int(0), int(0), int(0)), frame },
        { region: snakeId },
      ),
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
  hubs: arr(
    obj({
      district: snakeId,
      office: snakeId,
      vessel: obj({
        frame,
        tile: xy,
        exit: tuple(int(), int()),
        liftPx: int(0, 256),
      }),
    }),
  ),
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
  quests,
  events: eventsShape,
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
  // spawn.ts reads parcels.malware.overseasMult; the per-hub malwareMult is
  // otherwise unread, so the two must agree (design-m8-m9 §1.4, R6).
  d.districts.forEach((x, i) => {
    if (x.kind === 'overseas' && x.malwareMult !== mal.overseasMult)
      bad(
        `districts[${i}].malwareMult`,
        `${x.malwareMult} ≠ parcels.malware.overseasMult ${mal.overseasMult}`,
      )
  })
  if (d.parcels.decay.graceS >= d.parcels.onTimeMaxS)
    bad(
      'parcels.decay.graceS',
      `must be below onTimeMaxS ${d.parcels.onTimeMaxS}`,
    )

  // employees, economy
  checkEmployees(d, nLevels, out)
  const eco = d.economy
  if (eco.playtestMaxLevel > nLevels)
    bad(
      'economy.playtestMaxLevel',
      `${eco.playtestMaxLevel} exceeds the ${nLevels} levels`,
    )
  const dockIndices = new Set<number>()
  eco.docks.forEach((k, i) => {
    // docks.ts / ViewSim dockSlots key a dock by its index: one row each.
    if (dockIndices.has(k.index))
      bad(`economy.docks[${i}].index`, `duplicate dock index ${k.index}`)
    dockIndices.add(k.index)
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

  checkQuests(d, nLevels, checkerIds, out)
  checkEvents(d, out)
  checkMap(d, districtIds, buildingIds, out)
}

/** Placeholders the card copy may use (deck.ts fillCardText fills them). */
const EVENT_PLACEHOLDERS = [
  'district',
  'inspector',
  'driver',
  'sorter',
  'vehicle',
] as const
/** The puns lines the deck fills, with the placeholders each must carry. */
const EVENT_PUN_PLACEHOLDERS: readonly [
  group: 'tickerEvent' | 'eventWords',
  key: string,
  need: readonly string[],
][] = [
  ['tickerEvent', 'offered', ['{category}', '{title}']],
  ['tickerEvent', 'modifierEnded', ['{label}']],
  ['tickerEvent', 'chainDone', ['{title}']],
  ['eventWords', 'then', ['{title}', '{days}']],
  ['eventWords', 'thenNow', ['{title}']],
  ['eventWords', 'outcome', ['{hint}']],
  ['eventWords', 'youChose', ['{option}']],
]

/** B3 §3.5: an effect that can take a life, a vehicle or a worker. */
export function isHarshEffect(e: EventEffect): boolean {
  if (e.kind === 'lives') return e.delta < 0
  if (e.kind === 'vehicle') return 'lose' in e
  if (e.kind === 'staff')
    return 'quit' in e || ('absent' in e && e.pick === 'all')
  return false
}

/** The card ids an effect list books (plain nexts and every branch). */
function nextTargetsOf(effects: readonly EventEffect[]): string[] {
  const out: string[] = []
  for (const e of effects) {
    if (e.kind !== 'next') continue
    if ('branches' in e) out.push(...e.branches.map((b) => b.id))
    else out.push(e.eventId)
  }
  return out
}

/** A card's chain edges: its options' nexts and a router's branches. */
function edgesOf(c: EventDef): string[] {
  return [
    ...(c.options ?? []).flatMap((o) => nextTargetsOf(o.effects)),
    ...(c.next?.branches.map((b) => b.id) ?? []),
  ]
}

/** The `{name}` placeholders of a copy line. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] as string)
}

/** Every key of a condition, `anyOf` entries included (depth first). */
function condParts(c: EventCond | undefined): EventCond[] {
  if (!c) return []
  return [c, ...(c.anyOf ?? []).flatMap((x) => condParts(x))]
}

/**
 * events.json relations (spec-build3 §3, §7; M11 contract §3 stream E +
 * critique 21-23): ids, the next graph (targets, cycles, depth, links
 * undrawable), defaults, routers and branch lists, the harsh-consequence
 * rule (with the way out on the card, affordable by its cond, or on every
 * path from a drawable head), paid options, danger, targets and picks
 * (on the card or on every head that reaches a link), district / hub
 * scopes, `mod` mult / add / scope, pips stats, ★ defs, flags, categories,
 * placeholders and the puns lines the deck fills.
 */
function checkEvents(d: Tables, out: Problems): void {
  const bad = (path: string, msg: string): void => {
    out.push(`${path}: ${msg}`)
  }
  const ev = d.events
  const sch = ev.schedule
  const deck = ev.deck
  const nLevels = d.levels.length
  uniqueIds(deck, 'events.deck', out)
  const byId = new Map<string, EventDef>()
  const indexOf = new Map<string, number>()
  deck.forEach((c, i) => {
    if (!byId.has(c.id)) {
      byId.set(c.id, c)
      indexOf.set(c.id, i)
    }
  })
  const spawning = new Set(
    d.districts.filter((x) => x.kind === 'district').map((x) => x.id),
  )
  const overseas = new Set(
    d.districts.filter((x) => x.kind === 'overseas').map((x) => x.id),
  )
  const districtWord = (id: string): string =>
    overseas.has(id)
      ? `"${id}" is an overseas hub, not a spawning district`
      : `unknown district "${id}"`
  const isSatScope = (s: string): boolean =>
    ['all', 'target', 'busiest', 'lowest'].includes(s) || spawning.has(s)
  const multKeys: readonly string[] = MULT_MODIFIER_KEYS

  // ---- the next graph: edges, reachability, cycles, depth ----------------------
  const edges = new Map<string, string[]>()
  for (const c of byId.values())
    edges.set(
      c.id,
      edgesOf(c).filter((t) => byId.has(t)),
    )
  const reachMemo = new Map<string, Set<string>>()
  /** Every card reachable from `id` through nexts and branches (not `id` itself unless on a cycle). */
  const reach = (id: string): Set<string> => {
    const hit = reachMemo.get(id)
    if (hit) return hit
    const seen = new Set<string>()
    const stack = [...(edges.get(id) ?? [])]
    while (stack.length > 0) {
      const n = stack.pop() as string
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(edges.get(n) ?? []))
    }
    reachMemo.set(id, seen)
    return seen
  }
  const booked = new Set<string>()
  for (const ts of edges.values()) for (const t of ts) booked.add(t)
  // Cycles (each reported once, at its first card in data order).
  let cyclic = false
  const onCycle = new Set<string>()
  for (const c of deck) {
    if (onCycle.has(c.id) || !reach(c.id).has(c.id)) continue
    cyclic = true
    const loop = [...reach(c.id)].filter((x) => reach(x).has(c.id))
    for (const x of loop) onCycle.add(x)
    bad(
      `events.deck[${indexOf.get(c.id)}].id`,
      `the next graph has a cycle through "${c.id}" (${loop.map((x) => `"${x}"`).join(', ')})`,
    )
  }
  if (!cyclic) {
    const depth = new Map<string, number>()
    const longest = (id: string): number => {
      const k = depth.get(id)
      if (k !== undefined) return k
      const v = 1 + Math.max(0, ...(edges.get(id) ?? []).map((t) => longest(t)))
      depth.set(id, v)
      return v
    }
    for (const c of deck) {
      if (booked.has(c.id)) continue
      const n = longest(c.id)
      if (n > sch.chainMaxLinks)
        bad(
          `events.deck[${indexOf.get(c.id)}]`,
          `a chain from "${c.id}" runs ${n} cards, more than schedule.chainMaxLinks ${sch.chainMaxLinks}`,
        )
    }
  }
  /** The drawable cards whose chains reach `id` (its heads; none for a head). */
  const headsOf = (id: string): EventDef[] =>
    deck.filter(
      (h) => h.drawable !== false && h.id !== id && reach(h.id).has(id),
    )
  /** `target` on the card (a head, the rescue, an orphan) or on every head that reaches it. */
  const hasTarget = (c: EventDef): boolean => {
    const heads = headsOf(c.id)
    return heads.length === 0
      ? c.target !== undefined
      : heads.every((h) => h.target !== undefined)
  }
  const hasPick = (c: EventDef, role: string): boolean => {
    const heads = headsOf(c.id)
    return heads.length === 0
      ? c.pick === role
      : heads.every((h) => h.pick === role)
  }
  /**
   * A way out of a harsh option on card `h` (critique 21, review policy-2):
   * always shown (no `if`), free of harsh effects, and free or covered by
   * the card's cond balanceAtLeast (a link's cond is re-checked when due).
   */
  const safeExit = (h: EventDef, x: EventOptionDef): boolean =>
    x.if === undefined &&
    !x.effects.some((e) => isHarshEffect(e)) &&
    x.costPerVehicle === undefined &&
    (x.cost === undefined || (h.cond?.balanceAtLeast ?? 0) >= x.cost)
  const flagsSet = new Set<string>()
  for (const c of deck)
    for (const o of c.options ?? [])
      for (const e of o.effects)
        if (e.kind === 'flag' && 'set' in e) flagsSet.add(e.set)

  // ---- conditions ----------------------------------------------------------------
  const checkCond = (
    c: EventDef,
    cnd: EventCond | undefined,
    path: string,
    card: boolean,
  ): void => {
    for (const part of condParts(cnd)) {
      if (part.hubLive !== undefined && !overseas.has(part.hubLive))
        bad(`${path}.hubLive`, `"${part.hubLive}" is not an overseas district`)
      for (const k of ['satBelow', 'satAtLeast'] as const) {
        const sat = part[k]
        if (!sat) continue
        if (!isSatScope(sat.scope))
          bad(
            `${path}.${k}.scope`,
            `expected all | target | busiest | lowest | a spawning district id, got "${sat.scope}"`,
          )
        else if (sat.scope === 'target') {
          if (card && c.target === 'random')
            bad(
              `${path}.${k}`,
              'a target: "random" card cannot be eligible on its target (D-28): the target is drawn after the card',
            )
          if (!hasTarget(c))
            bad(
              `${path}.${k}`,
              'scope "target" needs `target` on the card or on its chain head',
            )
        }
      }
      for (const k of ['flag', 'notFlag'] as const) {
        const f = part[k]
        if (f !== undefined && !flagsSet.has(f))
          bad(`${path}.${k}`, `no option sets the flag "${f}"`)
      }
    }
  }

  // ---- effects ---------------------------------------------------------------------
  /** A branch list: every entry but the last has an `if`; the last (the else) has none. */
  const branchListOf = (
    c: EventDef,
    branches: readonly { if?: EventCond; id: string }[],
    bp: string,
  ): void => {
    branches.forEach((b, j) => {
      const last = j === branches.length - 1
      if (last && b.if !== undefined)
        bad(`${bp}[${j}].if`, 'the last branch is the else: it has no `if`')
      if (!last && b.if === undefined)
        bad(
          `${bp}[${j}]`,
          'only the last branch may omit `if` (exactly one else, at the end)',
        )
      if (!byId.has(b.id)) bad(`${bp}[${j}].id`, `unknown event "${b.id}"`)
      checkCond(c, b.if, `${bp}[${j}].if`, false)
    })
  }

  /** One effect's cross-references (scopes, stats, picks, targets, ★ defs). */
  const checkEffect = (c: EventDef, e: EventEffect, ep: string): void => {
    switch (e.kind) {
      case 'satisfaction':
        if (!isSatScope(e.scope))
          bad(
            `${ep}.scope`,
            `expected all | target | busiest | lowest | a spawning district id, got "${e.scope}"`,
          )
        else if (e.scope === 'target' && !hasTarget(c))
          bad(
            `${ep}.scope`,
            'scope "target" needs `target` on the card or on its chain head',
          )
        return
      case 'mod': {
        const isMult = multKeys.includes(e.key)
        if ((e.mult === undefined) === (e.add === undefined))
          bad(ep, 'a mod has exactly one of mult and add')
        else if (isMult && e.mult === undefined)
          bad(`${ep}.add`, `"${e.key}" is multiplicative: use mult`)
        else if (!isMult && e.add === undefined)
          bad(`${ep}.mult`, `"${e.key}" is additive: use add`)
        if (!(e.key in ev.modifiers.bounds))
          bad(`${ep}.key`, `"${e.key}" has no modifiers.bounds row`)
        const s = e.scope
        if (s === undefined) return
        if (e.key === 'speed') {
          if (!d.vehicles.types.some((t) => t.id === s))
            bad(`${ep}.scope`, `speed scopes a vehicle type, got "${s}"`)
        } else if (e.key === 'spawn') {
          if (s === 'target') {
            if (!hasTarget(c))
              bad(
                `${ep}.scope`,
                'scope "target" needs `target` on the card or on its chain head',
              )
          } else if (!spawning.has(s)) bad(`${ep}.scope`, districtWord(s))
        } else if (e.key === 'processS') {
          if (s !== 'desk' && s !== 'machine')
            bad(`${ep}.scope`, `processS scopes desk | machine, got "${s}"`)
        } else if (e.key === 'clearanceS') {
          if (!overseas.has(s))
            bad(`${ep}.scope`, `clearanceS scopes an overseas hub, got "${s}"`)
        } else
          bad(
            `${ep}.scope`,
            `"${e.key}" takes no scope (only speed, spawn, processS, clearanceS)`,
          )
        return
      }
      case 'pips': {
        const stats: readonly string[] = d.employees.roles[e.role].stats
        if (!stats.includes(e.stat))
          bad(
            `${ep}.stat`,
            `"${e.stat}" is not a ${e.role} stat (${stats.join(', ')})`,
          )
        if (e.scope === 'one' && !hasPick(c, e.role))
          bad(
            `${ep}.scope`,
            `"one" needs \`pick: "${e.role}"\` on the card or on its chain head`,
          )
        return
      }
      case 'vehicle':
        if ('gain' in e && e.withDriver) {
          if (e.withDriver.role !== 'driver')
            bad(`${ep}.withDriver.role`, 'the volunteer is a driver')
          checkStar(d, `${ep}.withDriver`, e.withDriver, out)
        }
        return
      case 'staff':
        if ('star' in e) checkStar(d, `${ep}.star`, e.star, out)
        else if ('quit' in e) {
          if (e.pick === 'one' && !hasPick(c, e.quit))
            bad(
              `${ep}.pick`,
              `"one" needs \`pick: "${e.quit}"\` on the card or on its chain head`,
            )
        } else {
          if (e.absent === 'driver')
            bad(
              `${ep}.absent`,
              'a driver is away with the vehicle: use absent "vehicles"',
            )
          const role = e.absent === 'vehicles' ? 'vehicle' : e.absent
          if (e.pick === 'one' && !hasPick(c, role))
            bad(
              `${ep}.pick`,
              `"one" needs \`pick: "${role}"\` on the card or on its chain head`,
            )
        }
        return
      case 'parcels':
        if ('spawn' in e) {
          const at = e.spawn.at
          if (at === 'target') {
            if (!hasTarget(c))
              bad(
                `${ep}.spawn.at`,
                '"target" needs `target` on the card or on its chain head',
              )
          } else if (at !== 'busiest' && !spawning.has(at))
            bad(
              `${ep}.spawn.at`,
              d.districts.some((x) => x.id === at)
                ? districtWord(at)
                : `expected target | busiest | a spawning district id, got "${at}"`,
            )
        }
        return
      case 'end': {
        const t = byId.get(e.eventId)
        if (!t) bad(`${ep}.eventId`, `unknown event "${e.eventId}"`)
        else if (
          !(t.options ?? []).some((o) =>
            o.effects.some((x) => x.kind === 'mod' || x.kind === 'cap'),
          )
        )
          bad(
            `${ep}.eventId`,
            `"${e.eventId}" applies no modifier (mod or cap) to end`,
          )
        return
      }
      case 'next':
        if (e.days > sch.linkMaxDays)
          bad(
            `${ep}.days`,
            `${e.days} is more than schedule.linkMaxDays ${sch.linkMaxDays}`,
          )
        if ('branches' in e) branchListOf(c, e.branches, `${ep}.branches`)
        else if (!byId.has(e.eventId))
          bad(`${ep}.eventId`, `unknown event "${e.eventId}"`)
        return
      default:
        return
    }
  }

  // ---- the cards -------------------------------------------------------------------
  for (const [k, cat] of Object.entries(ev.categories)) {
    if (cat.picture !== `ev_pic_${k}`)
      bad(
        `events.categories.${k}.picture`,
        `expected "ev_pic_${k}", got "${cat.picture}"`,
      )
  }

  deck.forEach((c, i) => {
    const p = `events.deck[${i}]`
    const opts = c.options ?? []
    if ((c.minLevel ?? 1) > nLevels)
      bad(`${p}.minLevel`, `level ${c.minLevel} does not exist`)
    if (booked.has(c.id) && c.drawable !== false)
      bad(
        `${p}.drawable`,
        'a chain link (booked by a next or a router) must be `drawable: false`',
      )
    if (c.router) {
      if (c.drawable !== false)
        bad(`${p}.drawable`, 'a router must be `drawable: false`')
      if (!c.next) bad(`${p}.next`, 'a router needs `next`')
      else if (c.next.days !== 0)
        bad(
          `${p}.next.days`,
          `a router resolves at once (0), got ${c.next.days}`,
        )
      if (c.body !== undefined) bad(`${p}.body`, 'a router has no body')
      if (c.options !== undefined)
        bad(`${p}.options`, 'a router has no options')
    } else {
      if (c.next !== undefined)
        bad(`${p}.next`, 'only a router has `next` (an option books its own)')
      if (c.body === undefined) bad(`${p}.body`, 'missing')
      if (opts.length === 0) bad(`${p}.options`, 'missing (1–3 options)')
    }
    if (c.rescue) {
      if (c.drawable !== false)
        bad(`${p}.drawable`, 'a rescue card must be `drawable: false`')
      if (opts.length !== 1)
        bad(`${p}.options`, `a rescue card has one option, got ${opts.length}`)
    }
    if (c.router && c.rescue) bad(p, 'a router cannot be a rescue card')
    if (c.target !== undefined) {
      const t = c.target
      if (!['busiest', 'lowest', 'random'].includes(t) && !spawning.has(t))
        bad(
          `${p}.target`,
          spawning.has(t) ||
            overseas.has(t) ||
            d.districts.some((x) => x.id === t)
            ? districtWord(t)
            : `expected busiest | lowest | random | a spawning district id, got "${t}"`,
        )
    }
    if (c.next) branchListOf(c, c.next.branches, `${p}.next.branches`)
    checkCond(c, c.cond, `${p}.cond`, true)

    // Copy: known placeholders; `{district}` needs a target, a person a pick.
    const texts: [string, string][] = [[`${p}.title`, c.title]]
    if (c.body !== undefined) texts.push([`${p}.body`, c.body])
    opts.forEach((o, j) => {
      texts.push([`${p}.options[${j}].label`, o.label])
      o.effects.forEach((e, k) => {
        if (e.kind === 'next' && 'hint' in e)
          texts.push([`${p}.options[${j}].effects[${k}].hint`, e.hint])
      })
    })
    for (const [tp, text] of texts) {
      for (const ph of placeholders(text)) {
        if (!(EVENT_PLACEHOLDERS as readonly string[]).includes(ph))
          bad(
            tp,
            `unknown placeholder {${ph}} (expected ${EVENT_PLACEHOLDERS.map((x) => `{${x}}`).join(' ')})`,
          )
        else if (ph === 'district') {
          if (!hasTarget(c))
            bad(
              tp,
              '{district} needs `target` on the card or on its chain head',
            )
        } else if (!hasPick(c, ph))
          bad(
            tp,
            `{${ph}} needs \`pick: "${ph}"\` on the card or on its chain head`,
          )
      }
    }

    // Options.
    let defaults = 0
    opts.forEach((o, j) => {
      const op = `${p}.options[${j}]`
      if (o.default) defaults += 1
      checkCond(c, o.if, `${op}.if`, false)
      const harsh = o.effects.some((e) => isHarshEffect(e))
      if (o.effects.some((e) => e.kind === 'lives' && e.delta < 0) && !o.danger)
        bad(`${op}.danger`, 'an option that can take a life is `danger: true`')
      // A price is `cost` or `costPerVehicle` (review deck-1), never both.
      const priced = o.cost !== undefined ? 'cost' : 'costPerVehicle'
      if (o.cost !== undefined && o.costPerVehicle !== undefined)
        bad(
          `${op}.costPerVehicle`,
          'an option takes `cost` or `costPerVehicle`, not both',
        )
      if (o.cost !== undefined || o.costPerVehicle !== undefined) {
        const free = opts.some(
          (x, k) =>
            k !== j &&
            x.cost === undefined &&
            x.costPerVehicle === undefined &&
            x.if === undefined,
        )
        if (!free)
          bad(
            `${op}.${priced}`,
            'a paid option needs an unpaid sibling with no `if` (a card never greys out every option)',
          )
      }
      if (o.default) {
        if (o.if !== undefined)
          bad(`${op}.if`, 'the default option is always shown (no `if`)')
        if (o.cost !== undefined && (c.cond?.balanceAtLeast ?? 0) < o.cost)
          bad(
            `${op}.cost`,
            `a paid default needs the card's cond balanceAtLeast ≥ ${o.cost} (the default must be affordable)`,
          )
        if (o.costPerVehicle !== undefined)
          bad(
            `${op}.costPerVehicle`,
            'the default never takes a per-vehicle price (a fleet-sized price no cond can cover)',
          )
      }
      if (harsh) {
        if (opts.length === 1)
          bad(
            op,
            'a harsh effect (a life, a vehicle, a worker) never sits on a one-option card',
          )
        else {
          // The way out on the card: another always-shown option free of
          // harsh effects that the card's cond keeps affordable (critique 21).
          const wayOut = opts.some((x, k) => k !== j && safeExit(c, x))
          if (!wayOut && c.drawable !== false)
            bad(
              op,
              "a harsh effect needs a way out on a drawn card: another option with no `if`, free of harsh effects, and free or covered by the card's cond balanceAtLeast",
            )
          else if (!wayOut && !cyclic) {
            // A link: every path from a drawable head runs through a card
            // with a way out (an always-shown option, free of harsh effects,
            // free or covered by that card's cond balanceAtLeast — as on a
            // drawn card) that never reaches this link (critique 22; review
            // policy-2: a harsh or unaffordable option is no escape).
            const reaches = (x: EventOptionDef): boolean =>
              nextTargetsOf(x.effects).some(
                (t) => t === c.id || reach(t).has(c.id),
              )
            const escape = (id: string): boolean => {
              if (id === c.id) return false
              const h = byId.get(id)
              if (h === undefined) return false
              return (h.options ?? []).some(
                (x) => safeExit(h, x) && !reaches(x),
              )
            }
            const trapped = deck.filter((h) => {
              if (h.drawable === false || escape(h.id)) return false
              const seen = new Set<string>()
              const stack = [h.id]
              while (stack.length > 0) {
                const n = stack.pop() as string
                if (n === c.id) return true
                if (seen.has(n)) continue
                seen.add(n)
                for (const t of edges.get(n) ?? [])
                  if (!escape(t)) stack.push(t)
              }
              return false
            })
            if (trapped.length > 0)
              bad(
                op,
                `a harsh effect with no way out on this link, and none on the way from ${trapped.map((h) => `"${h.id}"`).join(', ')} (every path from a head needs an always-shown option that avoids it)`,
              )
          }
        }
      }
      o.effects.forEach((e, k) => checkEffect(c, e, `${op}.effects[${k}]`))
    })
    if (!c.router && defaults !== 1)
      bad(`${p}.options`, `exactly one option is the default, got ${defaults}`)
    if (!c.router && opts.length > 0 && opts.every((o) => o.if !== undefined))
      bad(`${p}.options`, 'at least one option has no `if` (always shown)')
  })

  // ---- tables ----------------------------------------------------------------------
  for (const [k, [lo, hi]] of Object.entries(ev.modifiers.bounds)) {
    const id = multKeys.includes(k) ? 1 : 0
    if (id < lo || id > hi)
      bad(
        `events.modifiers.bounds.${k}`,
        `[${lo}, ${hi}] excludes ${id} (no modifier must fold to the identity)`,
      )
  }
  for (const k of Object.keys(ev.policy.weights.pips))
    if (!STATS.includes(k))
      bad(`events.policy.weights.pips.${k}`, `unknown stat "${k}"`)
  for (const [group, k, need] of EVENT_PUN_PLACEHOLDERS) {
    const line = (d.puns[group] as Record<string, string>)[k] ?? ''
    for (const ph of need)
      if (!line.includes(ph)) bad(`puns.${group}.${k}`, `must contain ${ph}`)
  }
}

/**
 * quests.json relations (spec-build2 §3.2, §9; design-m7 §1.5): ids, levels,
 * the magic parcel's one copy of its numbers, targets, conditions, rewards,
 * the flavour and ticker lines.
 */
function checkQuests(
  d: Tables,
  nLevels: number,
  checkerIds: Set<string>,
  out: Problems,
): void {
  const bad = (path: string, msg: string): void => {
    out.push(`${path}: ${msg}`)
  }
  const ultimateIds = d.levels.flatMap((l) =>
    l.ultimateQuest ? [l.ultimateQuest.id] : [],
  )
  const ids = uniqueIds(d.quests.templates, 'quests.templates', out)
  const overseas = (id: string): boolean =>
    d.districts.some((x) => x.id === id && x.kind === 'overseas')
  const scaledLen = (path: string, v: number | number[] | undefined): void => {
    if (Array.isArray(v) && v.length > nLevels)
      bad(path, `${v.length} entries, more than the ${nLevels} levels`)
  }
  d.quests.templates.forEach((t, i) => {
    const p = `quests.templates[${i}]`
    if (ultimateIds.includes(t.id))
      bad(`${p}.id`, `"${t.id}" is a levels.json ultimateQuest id`)
    if (t.unlockLevel > nLevels)
      bad(`${p}.unlockLevel`, `level ${t.unlockLevel} does not exist`)
    const g = t.goal
    if (g.kind === 'magicParcel') {
      if (t.limitDays !== undefined || t.reward !== undefined)
        bad(
          p,
          "the magic parcel's clock and payout live in parcels.json magic (no limitDays / reward here)",
        )
    } else {
      if (t.limitDays === undefined) bad(`${p}.limitDays`, 'missing')
      if (t.reward === undefined) bad(`${p}.reward`, 'missing')
      else if (Object.keys(t.reward).length === 0)
        bad(`${p}.reward`, 'needs at least one field')
    }
    // Targets: deliveriesFrom needs a district rule; satisfactionAtLeast
    // needs satisfactionBelow with targetArg below the goal; nothing else
    // takes one.
    if (g.kind === 'deliveriesFrom') {
      if (t.target === undefined)
        bad(`${p}.target`, 'deliveriesFrom needs a district:* target')
    } else if (g.kind === 'satisfactionAtLeast') {
      if (t.target !== 'district:satisfactionBelow')
        bad(
          `${p}.target`,
          'satisfactionAtLeast needs "district:satisfactionBelow"',
        )
      else if (t.targetArg === undefined)
        bad(`${p}.targetArg`, 'missing (district:satisfactionBelow)')
      else if (!(g.value > t.targetArg))
        bad(
          `${p}.goal.value`,
          `${g.value} is not above targetArg ${t.targetArg}`,
        )
    } else if (t.target !== undefined) {
      bad(`${p}.target`, `goal "${g.kind}" takes no target`)
    }
    if (t.targetArg !== undefined && t.target !== 'district:satisfactionBelow')
      bad(`${p}.targetArg`, 'only with "district:satisfactionBelow"')
    if (t.condition !== undefined && t.condition !== 'livesBelowCap') {
      const m = /^hubLive:(.+)$/.exec(t.condition)
      if (!m)
        bad(
          `${p}.condition`,
          `expected "livesBelowCap" or "hubLive:<overseas id>", got "${t.condition}"`,
        )
      else if (!overseas(m[1]!))
        bad(`${p}.condition`, `"${m[1]}" is not an overseas district`)
    }
    if (g.kind === 'overseasCleared' && !overseas(g.hub))
      bad(`${p}.goal.hub`, `"${g.hub}" is not an overseas district`)
    if ('count' in g) scaledLen(`${p}.goal.count`, g.count)
    const r = t.reward
    if (r) {
      scaledLen(`${p}.reward.cash`, r.cash)
      if (r.voucher !== undefined && !checkerIds.has(r.voucher))
        bad(`${p}.reward.voucher`, `unknown checker "${r.voucher}"`)
      const star = r.starApplicant
      if (star) checkStar(d, `${p}.reward.starApplicant`, star, out)
    }
  })
  for (const id of [...ids, ...ultimateIds])
    if (d.puns.quests[id] === undefined)
      bad('puns.quests', `missing the line for "${id}"`)
  for (const [k, line] of Object.entries(d.puns.tickerQuest)) {
    // M9: the endless line has no placeholder (design-m8-m9 §4.7).
    if (k === 'endless') continue
    const need = k === 'victory' ? '{company}' : '{name}'
    if (!line.includes(need))
      bad(`puns.tickerQuest.${k}`, `must contain ${need}`)
  }
}

/**
 * A ★ applicant def (a quest reward, an event's `staff star` or the
 * `vehicle gain` volunteer driver): exactly its role's stats, pips 1–5
 * (charisma 0–2), an affinity only on a driver.
 */
function checkStar(
  d: Tables,
  path: string,
  star: StarApplicantDef,
  out: Problems,
): void {
  const stats: readonly string[] = d.employees.roles[star.role].stats
  const keys = Object.keys(star.pips)
  if (keys.length !== stats.length || stats.some((s) => !keys.includes(s)))
    out.push(
      `${path}.pips: expected the ${star.role} stats ${JSON.stringify(stats)}, got ${JSON.stringify(keys)}`,
    )
  for (const [k, v] of Object.entries(star.pips)) {
    const [lo, hi] = k === 'charisma' ? [0, 2] : [1, 5]
    if (v < lo || v > hi)
      out.push(`${path}.pips.${k}: ${v} is outside ${lo}..${hi}`)
  }
  if (star.affinity !== undefined && star.role !== 'driver')
    out.push(`${path}.affinity: only drivers have an affinity`)
}

/** employees.json relations (spec-build2 §2, §9) and puns.peopleNames. */
function checkEmployees(d: Tables, nLevels: number, out: Problems): void {
  const bad = (path: string, msg: string): void => {
    out.push(`${path}: ${msg}`)
  }
  const emp = d.employees
  const roles = emp.roles
  const expected: Record<(typeof ROLES)[number], string[]> = {
    inspector: ['eye', 'pace', 'charisma'],
    sorter: ['judgement', 'pace'],
    driver: ['speed', 'energy', 'charisma'],
  }
  for (const r of ROLES) {
    const got = roles[r].stats
    const want = expected[r]
    if (got.length !== want.length || got.some((x, i) => x !== want[i]))
      bad(
        `employees.roles.${r}.stats`,
        `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      )
  }
  const insp = roles.inspector
  const pMax = Math.max(...insp.p)
  if (insp.pCap < pMax)
    bad(
      'employees.roles.inspector.pCap',
      `${insp.pCap} is below max(p) ${pMax}`,
    )

  const ap = emp.applicants
  const keys = Object.keys(ap.pipWeights)
  if (!keys.includes('1'))
    bad('employees.applicants.pipWeights', 'missing the band "1"')
  for (const k of keys) {
    const n = Number(k)
    if (!Number.isInteger(n) || n < 1 || n > nLevels)
      bad(`employees.applicants.pipWeights.${k}`, `not a level 1..${nLevels}`)
    const row = ap.pipWeights[k] ?? []
    if (!(row.reduce((sum, w) => sum + w, 0) > 0))
      bad(`employees.applicants.pipWeights.${k}`, 'weights sum to 0')
  }
  if (!(ap.charismaWeights.reduce((sum, w) => sum + w, 0) > 0))
    bad('employees.applicants.charismaWeights', 'weights sum to 0')
  if (!(Object.values(ap.affinityWeights).reduce((sum, w) => sum + w, 0) > 0))
    bad('employees.applicants.affinityWeights', 'weights sum to 0')

  const start = emp.start.inspector
  for (const [k, v] of Object.entries(start.pips)) {
    const [lo, hi] = k === 'charisma' ? [0, 2] : [1, 5]
    if (v < lo || v > hi)
      bad(`employees.start.inspector.pips.${k}`, `${v} is outside ${lo}..${hi}`)
  }
  const l1 = d.levels[0]
  if (l1 && start.slot > l1.slots)
    bad(
      'employees.start.inspector.slot',
      `${start.slot} exceeds levels[0].slots ${l1.slots}`,
    )

  const rows = emp.desks.rows
  rows.forEach((r, i) => {
    if (r.index !== i + 1)
      bad(
        `employees.desks.rows[${i}].index`,
        `expected ${i + 1} (ascending from 1, unique), got ${r.index}`,
      )
    if (r.unlockLevel > nLevels)
      bad(
        `employees.desks.rows[${i}].unlockLevel`,
        `level ${r.unlockLevel} does not exist`,
      )
  })
  if (rows[0] && rows[0].unlockLevel !== 1)
    bad('employees.desks.rows[0].unlockLevel', 'the first desk must open at L1')
  if (emp.holdStation.unlockLevel > nLevels)
    bad(
      'employees.holdStation.unlockLevel',
      `level ${emp.holdStation.unlockLevel} does not exist`,
    )
  for (const g of ['inspectors', 'sorters', 'drivers'] as const) {
    const n = emp.payOrder.filter((x) => x === g).length
    if (n !== 1) bad('employees.payOrder', `lists "${g}" ${n} times`)
  }
  const names = d.puns.peopleNames
  const need = 3 * ap.poolSize + 1
  if (names.length < need)
    bad('puns.peopleNames', `${names.length} names, need ≥ ${need}`)
  names.forEach((n, i) => {
    if (names.indexOf(n) !== i)
      bad(`puns.peopleNames[${i}]`, `duplicate name "${n}"`)
  })
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
  // hubs (M8, design-m8-m9 §1.4): one row per overseas district, its office
  // a building of that district, its vessel one of the district's props;
  // every overseas district live at a level ≤ playtestMaxLevel has a row
  // (M9's cap 5: the Docks and the Airport; a cap-2 config needs none).
  const hubIds = new Set<string>()
  m.hubs.forEach((h, i) => {
    const p = `map.hubs[${i}]`
    const dist = d.districts.find((x) => x.id === h.district)
    if (!dist || dist.kind !== 'overseas') {
      bad(`${p}.district`, `"${h.district}" is not an overseas district`)
      return
    }
    if (hubIds.has(h.district))
      bad(`${p}.district`, `duplicate hub "${h.district}"`)
    hubIds.add(h.district)
    const office = d.buildings.find((b) => b.id === h.office)
    if (!office || office.district !== h.district)
      bad(`${p}.office`, `"${h.office}" is not a building of "${h.district}"`)
    const v = h.vessel
    const prop = m.props.some(
      (pr) =>
        pr.frame === v.frame &&
        pr.tile[0] === v.tile[0] &&
        pr.tile[1] === v.tile[1] &&
        pr.region === h.district,
    )
    if (!prop)
      bad(
        `${p}.vessel`,
        `no map.props row {frame "${v.frame}", tile [${v.tile[0]},${v.tile[1]}], region "${h.district}"}`,
      )
    if (v.exit[0] === 0 && v.exit[1] === 0)
      bad(`${p}.vessel.exit`, 'is [0,0] (the vessel never leaves)')
  })
  for (const dist of d.districts) {
    if (dist.kind !== 'overseas' || hubIds.has(dist.id)) continue
    if (dist.unlockLevel <= d.economy.playtestMaxLevel)
      bad(
        'map.hubs',
        `no row for "${dist.id}" (overseas, live at level ${dist.unlockLevel} ≤ playtestMaxLevel ${d.economy.playtestMaxLevel})`,
      )
  }
  m.ground.scenery.forEach((s, i) => {
    const [x0, y0, x1, y1] = s.rect
    if (x0 > x1 || y0 > y1 || x1 >= W || y1 >= H)
      bad(`map.ground.scenery[${i}].rect`, 'empty or outside the map')
    // M9 (style-guide §2.2): a row may fog with a district's lock state.
    if (s.region !== undefined && !districtIds.has(s.region))
      bad(`map.ground.scenery[${i}].region`, `unknown district "${s.region}"`)
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
