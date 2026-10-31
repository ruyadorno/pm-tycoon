// Browser loader (plan.md §6.6): the tables are bundled by Vite through static
// JSON imports (no import attributes); `?config=<name>` fetches
// configs/<name>.json (public/configs, relative to the page so it works at /
// and under /pm-tycoon/ on Pages), deep-merges it and validates. M10: a
// config's reserved `start` key (configStart.ts — the scripted New game of
// ?config=tycoon) is validated against the merged tables and handed to Boot
// by loadConfigured.

import buildings from './buildings.json'
import districts from './districts.json'
import economy from './economy.json'
import employees from './employees.json'
import events from './events.json'
import levels from './levels.json'
import machines from './machines.json'
import map from './map.json'
import parcels from './parcels.json'
import puns from './puns.json'
import quests from './quests.json'
import vehicles from './vehicles.json'
import {
  applyConfig,
  buildGameData,
  checkConfigStart,
  configStartOf,
  DataError,
} from './index.ts'
import type { ConfigStart } from './configStart.ts'
import type { GameData, RawGameData } from './types.ts'

const CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** A fresh copy of the shipped tables, keyed by file stem. */
export function rawGameData(): RawGameData {
  return structuredClone({
    districts,
    buildings,
    vehicles,
    machines,
    employees,
    parcels,
    economy,
    levels,
    quests,
    events,
    puns,
    map,
  })
}

export interface LoadOptions {
  /** Prefix of the config URL; default 'configs/' (relative to the page). */
  baseUrl?: string
  /** Injected for tests; default the global fetch. */
  fetch?: typeof fetch
}

/** The tables (with a config merged in) and that config's scripted start. */
export interface ConfiguredData {
  data: GameData
  /** The config's validated `start` recipe, or null (none, or no config). */
  start: ConfigStart | null
}

/**
 * Validated GameData, optionally with public/configs/<configName>.json merged
 * over the tables. Rejects with DataError (Boot shows `problems` full-screen).
 */
export async function loadGameData(
  configName?: string | null,
  options: LoadOptions = {},
): Promise<GameData> {
  return (await loadConfigured(configName, options)).data
}

/**
 * loadGameData plus the config's `start` recipe (configStart.ts), validated
 * against the merged tables; a defect in it rejects with DataError too.
 */
export async function loadConfigured(
  configName?: string | null,
  options: LoadOptions = {},
): Promise<ConfiguredData> {
  let raw = rawGameData()
  let startRaw: unknown
  const label = `configs/${configName}.json`
  if (configName) {
    if (!CONFIG_NAME.test(configName))
      throw new DataError([`config "${configName}": invalid name`])
    const url = `${options.baseUrl ?? 'configs/'}${configName}.json`
    const doFetch = options.fetch ?? fetch
    let patch: unknown
    try {
      const res = await doFetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      patch = await res.json()
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      throw new DataError([
        `config "${configName}": cannot load ${url} (${why})`,
      ])
    }
    raw = applyConfig(raw, patch, label)
    startRaw = configStartOf(patch)
  }
  const data = buildGameData(raw)
  const { start, problems } = checkConfigStart(startRaw, data, label)
  if (problems.length > 0) throw new DataError(problems)
  return { data, start }
}
