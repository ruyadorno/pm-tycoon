// A config's scripted start (plan-build2 §8.7 task 3; docs/decisions.md M10
// "Configs"): besides the data tables it patches, a public/configs/<name>.json
// may carry one reserved top-level key, `start`, that is not a data file —
// a recipe for the player's game at New game, e.g. tycoon.json's
//
//   "start": {"level": 5, "slots": ["desk", "metal_detector", …],
//             "inspectorsPerDesk": 2, "holdStation": "sorter_arm",
//             "docks": [2, 3], "fleet": {"bike": 3, "van": 2, "truck": 3}}
//
// applyConfig (index.ts) leaves `start` out of the merge and out of the data
// hash; checkConfigStart validates it against the merged tables (the problems
// are a DataError, shown full-screen by Boot like any table defect) into a
// ConfigStart. src/boot/configStart.ts plays it on a fresh game through the
// ViewSim — debugForceLevel, then ordinary purchase and hire commands — so the
// command log replays it and a save resumes it like any game. Nothing here
// knows prices: the money is the config's own `economy.startMoney` patch.
//
// Fields (all optional; an absent field asks for nothing):
//   level             1..the last levels.json row; forced first (debugForceLevel)
//   slots             lane slot i ← entry i: "desk" (the next employees.json
//                     desks.rows desk), a machines.json checker id, or null
//                     (left as it is); at most the level's slot count; the
//                     start inspector's slot holds desk 1 (null or "desk")
//   inspectorsPerDesk 0..desks.maxPerDesk; every desk is staffed up to it
//   holdStation       null | "sorter" (the best applicant) | an upgrades id
//                     targeting the Hold Bay ("sorter_arm")
//   docks             economy.docks indices
//   fleet             {vehicle type id: count}, played in vehicles.json order;
//                     each vehicle comes with the best driver applicant
// Every id must be unlocked at `level`.
//
// Headless (tools/check-sim-purity.mjs covers src/data/**).

import type { GameData, VehicleTypeId } from './types.ts'

/** The reserved top-level config key (not a data file). */
export const CONFIG_START_KEY = 'start'

/** A lane slot entry: the next desk, a checker id, or null (leave it). */
export type ConfigStartSlot = string | null

/** A validated `start` recipe (see the header). */
export interface ConfigStart {
  /** Level forced at New game (1 = none). */
  level: number
  /** Slot entries in lane slot order. */
  slots: ConfigStartSlot[]
  /** Staff every desk up to this many inspectors. */
  inspectorsPerDesk: number
  /** 'sorter' (hire one), an upgrade id (buy it), or null. */
  holdStation: string | null
  /** economy.docks indices to buy, in order. */
  docks: number[]
  /** Vehicles to own, in vehicles.json order; each with a driver. */
  fleet: { type: VehicleTypeId; count: number }[]
}

/** The slot entry that asks for a desk. */
export const DESK_SLOT = 'desk'
/** The holdStation value that hires a sorter. */
export const SORTER_STATION = 'sorter'

const FIELDS = [
  'level',
  'slots',
  'inspectorsPerDesk',
  'holdStation',
  'docks',
  'fleet',
] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const isInt = (v: unknown): v is number => Number.isSafeInteger(v)

/** The `start` key of a config patch, or undefined when it has none. */
export function configStartOf(patch: unknown): unknown {
  return isRecord(patch) ? patch[CONFIG_START_KEY] : undefined
}

/**
 * Validate a config's `start` (undefined / null → null) against the merged
 * tables. Returns the problems found (paths under `label`) and the recipe
 * (null whenever a problem was found).
 */
export function checkConfigStart(
  raw: unknown,
  data: GameData,
  label = 'config',
): { start: ConfigStart | null; problems: string[] } {
  if (raw === undefined || raw === null) return { start: null, problems: [] }
  const at = `${label}.${CONFIG_START_KEY}`
  const problems: string[] = []
  const bad = (path: string, msg: string): void => {
    problems.push(`${at}${path}: ${msg}`)
  }
  if (!isRecord(raw)) {
    bad('', 'expected an object')
    return { start: null, problems }
  }
  for (const k of Object.keys(raw)) {
    if (!(FIELDS as readonly string[]).includes(k))
      bad(`.${k}`, `unknown field (expected ${FIELDS.join('|')})`)
  }

  // level
  const rows = data.levels
  const lastLevel = rows[rows.length - 1]?.level ?? 1
  let level = rows[0]?.level ?? 1
  if (raw.level !== undefined) {
    if (!isInt(raw.level) || raw.level < 1 || raw.level > lastLevel)
      bad('.level', `expected an integer 1..${lastLevel}`)
    else level = raw.level
  }
  const row = rows.find((r) => r.level === level)
  const unlocked = (unlockLevel: number): boolean => unlockLevel <= level

  // slots
  const slots: ConfigStartSlot[] = []
  if (raw.slots !== undefined) {
    if (!Array.isArray(raw.slots)) bad('.slots', 'expected an array')
    else {
      const maxSlots = row?.slots ?? 0
      if (raw.slots.length > maxSlots)
        bad(
          '.slots',
          `${raw.slots.length} entries, level ${level} has ${maxSlots} slots`,
        )
      const desks = data.employees.desks.rows.filter((d) =>
        unlocked(d.unlockLevel),
      ).length
      const startSlot = data.employees.start.inspector.slot - 1
      let deskCount = 0
      raw.slots.forEach((e: unknown, i) => {
        const p = `.slots[${i}]`
        // The start desk (desks.rows[0]) already stands in its slot.
        if (i === startSlot && e !== null && e !== DESK_SLOT)
          bad(p, `slot ${i + 1} holds the start desk (null or "${DESK_SLOT}")`)
        if (e === null) {
          if (i === startSlot) deskCount += 1
          slots.push(null)
          return
        }
        if (typeof e !== 'string') {
          bad(p, `expected "${DESK_SLOT}", a checker id or null`)
          return
        }
        if (e === DESK_SLOT) {
          deskCount += 1
          slots.push(e)
          return
        }
        const def = data.machines.checkers.find((c) => c.id === e)
        if (!def) bad(p, `unknown checker "${e}"`)
        else if (!unlocked(def.unlockLevel))
          bad(
            p,
            `${e} unlocks at level ${def.unlockLevel}, start level ${level}`,
          )
        slots.push(e)
      })
      // An omitted start slot still holds desk 1.
      if (startSlot >= raw.slots.length) deskCount += 1
      if (deskCount > desks)
        bad('.slots', `${deskCount} desks, level ${level} allows ${desks}`)
    }
  }

  // inspectorsPerDesk
  let inspectorsPerDesk = 0
  if (raw.inspectorsPerDesk !== undefined) {
    const max = data.employees.desks.maxPerDesk
    const n = raw.inspectorsPerDesk
    if (!isInt(n) || n < 0 || n > max)
      bad('.inspectorsPerDesk', `expected an integer 0..${max}`)
    else inspectorsPerDesk = n
  }

  // holdStation
  let holdStation: string | null = null
  if (raw.holdStation !== undefined && raw.holdStation !== null) {
    const h = raw.holdStation
    const up =
      typeof h === 'string'
        ? data.machines.upgrades.find(
            (u) => u.id === h && u.target === 'holdBay',
          )
        : undefined
    if (h === SORTER_STATION) {
      const lvl = data.employees.holdStation.unlockLevel
      if (!unlocked(lvl))
        bad(
          '.holdStation',
          `the station unlocks at level ${lvl}, start level ${level}`,
        )
      holdStation = h
    } else if (up) {
      if (!unlocked(up.unlockLevel))
        bad(
          '.holdStation',
          `${up.id} unlocks at level ${up.unlockLevel}, start level ${level}`,
        )
      holdStation = up.id
    } else {
      bad(
        '.holdStation',
        `expected null, "${SORTER_STATION}" or a Hold Bay upgrade id`,
      )
    }
  }

  // docks
  const docks: number[] = []
  if (raw.docks !== undefined) {
    if (!Array.isArray(raw.docks)) bad('.docks', 'expected an array')
    else {
      raw.docks.forEach((d: unknown, i) => {
        const p = `.docks[${i}]`
        const def = data.economy.docks.find((r) => r.index === d)
        if (!isInt(d) || !def) bad(p, 'expected an economy.docks index')
        else if (docks.includes(d)) bad(p, `dock ${d} listed twice`)
        else {
          if (!unlocked(def.unlockLevel))
            bad(
              p,
              `dock ${d} unlocks at level ${def.unlockLevel}, start level ${level}`,
            )
          docks.push(d)
        }
      })
    }
  }

  // fleet (vehicles.json order)
  const fleet: ConfigStart['fleet'] = []
  if (raw.fleet !== undefined) {
    const f = raw.fleet
    if (!isRecord(f)) bad('.fleet', 'expected an object {vehicle type: count}')
    else {
      for (const k of Object.keys(f)) {
        if (!data.vehicles.types.some((t) => t.id === k))
          bad(`.fleet.${k}`, 'unknown vehicle type')
      }
      for (const t of data.vehicles.types) {
        const n = f[t.id]
        if (n === undefined) continue
        if (!isInt(n) || n < 0) {
          bad(`.fleet.${t.id}`, 'expected a non-negative integer')
          continue
        }
        if (n > 0 && !unlocked(t.unlockLevel))
          bad(
            `.fleet.${t.id}`,
            `unlocks at level ${t.unlockLevel}, start level ${level}`,
          )
        if (n > 0) fleet.push({ type: t.id, count: n })
      }
    }
  }

  if (problems.length > 0) return { start: null, problems }
  return {
    start: { level, slots, inspectorsPerDesk, holdStation, docks, fleet },
    problems,
  }
}
