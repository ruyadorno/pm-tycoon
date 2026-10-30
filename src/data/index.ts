// Data entry point (plan.md §6.6): validate the raw tables into GameData,
// merge ?config= / --config patches, hash the tables for saves. Headless and
// Node-runnable: the JSON files themselves are read by load.browser.ts (static
// imports under Vite) or tools/sim/load.node.ts (fs).

import { CONFIG_START_KEY } from './configStart.ts'
import { dataHash } from './hash.ts'
import { DATA_FILES, validateGameData } from './schema.ts'
import type { GameData, RawGameData } from './types.ts'

export type * from './types.ts'
export {
  CONFIG_START_KEY,
  checkConfigStart,
  configStartOf,
  DESK_SLOT,
  SORTER_STATION,
} from './configStart.ts'
export type { ConfigStart, ConfigStartSlot } from './configStart.ts'
export { canonicalJson, dataHash, fnv1a32 } from './hash.ts'
export {
  DATA_FILES,
  blockAt,
  blockRect,
  doorTile,
  footprintRect,
  groundAt,
  groundFrames,
  inRect,
  isAvenueTile,
  isRoadTile,
  isTrimmedTile,
  mapBlockAt,
  onSegment,
  reachableRoads,
  roadThemesAt,
  roadTiles,
  validateGameData,
} from './schema.ts'
export type { Problems } from './schema.ts'

/** Thrown by buildGameData / applyConfig; `problems` lists every defect with its path. */
export class DataError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    const n = problems.length
    super(
      `Invalid game data (${n} problem${n === 1 ? '' : 's'}):\n${problems.slice(0, 20).join('\n')}`,
    )
    this.name = 'DataError'
    this.problems = problems
  }
}

/** Validate `raw` (the parsed files keyed by stem) and return a private copy as GameData. */
export function buildGameData(raw: unknown): GameData {
  const problems = validateGameData(raw)
  if (problems.length > 0) throw new DataError(problems)
  const tables = structuredClone(raw) as Omit<GameData, 'hash'>
  return { ...tables, hash: dataHash(raw) }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Pure deep merge for config patches: objects merge recursively, arrays merge
 * by index (patch[i] merges into base[i]; extra entries append), scalars and
 * null replace. Neither argument is mutated.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return structuredClone(base)
  if (Array.isArray(base) && Array.isArray(patch)) {
    const out: unknown[] = base.map((v: unknown) => structuredClone(v))
    patch.forEach((p: unknown, i) => {
      out[i] = deepMerge(base[i], p)
    })
    return out as T
  }
  if (isRecord(base) && isRecord(patch)) {
    const out: Record<string, unknown> = structuredClone(base)
    for (const [k, p] of Object.entries(patch)) out[k] = deepMerge(base[k], p)
    return out as T
  }
  return structuredClone(patch) as T
}

/**
 * Merge a config partial keyed by data file (`{"economy": {...}}`) over `raw`.
 * The reserved key `start` (configStart.ts: the config's scripted New game,
 * M10) is not a data file: it is left out of the merge (and so of the data
 * hash); checkConfigStart validates it against the merged tables.
 */
export function applyConfig(
  raw: RawGameData,
  patch: unknown,
  label = 'config',
): RawGameData {
  if (!isRecord(patch))
    throw new DataError([
      `${label}: expected an object keyed by data file name`,
    ])
  const problems = Object.keys(patch)
    .filter(
      (k) =>
        k !== CONFIG_START_KEY &&
        !(DATA_FILES as readonly string[]).includes(k),
    )
    .map(
      (k) =>
        `${label}.${k}: unknown data file (expected ${DATA_FILES.join('|')} or ${CONFIG_START_KEY})`,
    )
  if (problems.length > 0) throw new DataError(problems)
  const tables = Object.fromEntries(
    Object.entries(patch).filter(([k]) => k !== CONFIG_START_KEY),
  )
  return deepMerge(raw, tables)
}
