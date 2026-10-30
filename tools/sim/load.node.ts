// Node loader (plan.md §6.6): reads src/data/*.json with fs (paths relative to
// this file, so any cwd works), merges an optional --config <path> partial
// (resolved against the cwd) and validates. Runs under plain Node 26 type
// stripping; `node tools/sim/load.node.ts [--config path]` prints a summary.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyConfig,
  buildGameData,
  checkConfigStart,
  configStartOf,
  DATA_FILES,
  DataError,
  roadTiles,
  type ConfigStart,
} from '../../src/data/index.ts'
import type { GameData, RawGameData } from '../../src/data/types.ts'

const DATA_DIR = new URL('../../src/data/', import.meta.url)

/** The shipped tables, parsed, keyed by file stem (unvalidated). */
export function loadRawData(): RawGameData {
  const raw: Partial<RawGameData> = {}
  for (const name of DATA_FILES) {
    raw[name] = JSON.parse(
      readFileSync(new URL(`${name}.json`, DATA_DIR), 'utf8'),
    )
  }
  return raw as RawGameData
}

/** Parse a config partial; a missing or malformed file is a DataError. */
export function readConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'))
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    throw new DataError([`--config ${path}: cannot read (${why})`])
  }
}

/** Validated GameData with the optional config partial merged in. */
export function loadGameData(configPath?: string | null): GameData {
  return loadConfigured(configPath).data
}

/**
 * loadGameData plus the config's `start` recipe (src/data/configStart.ts —
 * the scripted New game, e.g. tycoon.json's L5 lane), validated against the
 * merged tables like the browser's loadConfigured; a defect in it is a
 * DataError. `start` is null without a config or a `start` key.
 */
export function loadConfigured(configPath?: string | null): {
  data: GameData
  start: ConfigStart | null
} {
  let raw = loadRawData()
  let startRaw: unknown
  if (configPath) {
    const patch = readConfig(configPath)
    raw = applyConfig(raw, patch, configPath)
    startRaw = configStartOf(patch)
  }
  const data = buildGameData(raw)
  const { start, problems } = checkConfigStart(
    startRaw,
    data,
    configPath ?? 'config',
  )
  if (problems.length > 0) throw new DataError(problems)
  return { data, start }
}

/** `--config <path>` or `--config=<path>` from argv, else null. */
export function configPathFromArgv(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--config=')) return a.slice('--config='.length)
    if (a === '--config') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--'))
        throw new DataError(['--config: missing path'])
      return next
    }
  }
  return null
}

if (import.meta.main) {
  try {
    const cfg = configPathFromArgv(process.argv.slice(2))
    const { data: d, start } = loadConfigured(cfg)
    const live = d.districts.filter((x) => x.kind === 'district').length
    console.log(
      [
        `data ok${cfg ? ` (config ${cfg})` : ''} · hash ${d.hash}${start ? ` · start recipe: Lv ${start.level}` : ''}`,
        `${d.districts.length} districts (${live} live), ${d.buildings.length} buildings, ${d.levels.length} levels, playtestMaxLevel ${d.economy.playtestMaxLevel}`,
        `${d.vehicles.types.length} vehicle types, ${d.machines.checkers.length} checkers + ${d.machines.upgrades.length} upgrades, ${d.parcels.malware.strains.length} strains`,
        `map ${d.map.size.join('x')}: ${roadTiles(d.map).length} road tiles, ${d.map.regions.length} regions, ${d.map.props.length} props, lot entrance [${d.map.lot.entrance.join(',')}]`,
      ].join('\n'),
    )
  } catch (err) {
    if (!(err instanceof DataError)) throw err
    console.error(`data: ${err.problems.length} problem(s)`)
    for (const p of err.problems) console.error(`  ${p}`)
    process.exitCode = 1
  }
}
