// Save payload (plan.md §5 localStorage `pm.save.v1`, §6.4 "Save and load").
// The sim never reads the clock or storage: src/boot/autosave.ts supplies
// savedAt / build / onboarding and does the localStorage I/O. No migrations
// (R9): a payload loads only when version === 1 and its dataHash matches the
// running data tables (isCompatible); otherwise the Title discards it.

import type { GameData } from '../data/types.ts'
import type { CommandLogEntry } from './commands.ts'
import { Sim, snapshotProblems } from './sim.ts'
import type { LoadOptions } from './sim.ts'
import type { SimState } from './types.ts'

export const SAVE_KEY = 'pm.save.v1'
export const SAVE_VERSION = 1

/** UI state the HUD's Onboarding keeps (the sim never reads it). */
export interface OnboardingSave {
  step: number
  skipped: boolean
  sawFirstFlag: boolean
  sawTossHint: boolean
  wanted: string[]
}

export interface SavePayload {
  version: 1
  /** Wall-clock ms supplied by the caller (Date.now() in autosave.ts). */
  savedAt: number
  /** __BUILD_STAMP__ */
  build: string
  dataHash: string
  seed: number
  state: SimState
  /** ADDITION to the plan.md §5 key: the replay log (sim.commandLog). */
  commandLog: CommandLogEntry[]
  onboarding: OnboardingSave | null
}

export interface SaveMeta {
  savedAt: number
  build: string
  onboarding?: OnboardingSave | null
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveError'
  }
}

/** The payload object for a sim (a deep copy; safe to keep). */
export function toSavePayload(sim: Sim, meta: SaveMeta): SavePayload {
  const snap = sim.snapshot()
  return {
    version: SAVE_VERSION,
    savedAt: meta.savedAt,
    build: meta.build,
    dataHash: snap.dataHash,
    seed: snap.seed,
    state: snap.state,
    commandLog: snap.commandLog,
    onboarding: meta.onboarding ? structuredClone(meta.onboarding) : null,
  }
}

/** JSON text for localStorage (~50-150 KB). */
export function serialise(sim: Sim, meta: SaveMeta): string {
  return JSON.stringify(toSavePayload(sim, meta))
}

/** Parse saved text; throws SaveError on bad JSON or a payload of the wrong shape. */
export function deserialise(text: string): SavePayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new SaveError(
      `save: not JSON (${err instanceof Error ? err.message : err})`,
    )
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SaveError('save: not an object')
  }
  const p = raw as Record<string, unknown>
  const bad = [
    p.version !== SAVE_VERSION && 'version',
    typeof p.savedAt !== 'number' && 'savedAt',
    typeof p.build !== 'string' && 'build',
    typeof p.dataHash !== 'string' && 'dataHash',
    !Number.isSafeInteger(p.seed) && 'seed',
    (typeof p.state !== 'object' || p.state === null) && 'state',
    !Array.isArray(p.commandLog) && 'commandLog',
    p.onboarding !== null && typeof p.onboarding !== 'object' && 'onboarding',
  ].filter((x): x is string => typeof x === 'string')
  if (bad.length > 0)
    throw new SaveError(`save: bad field(s) ${bad.join(', ')}`)
  return p as unknown as SavePayload
}

/** Title "Continue" rule: version 1 and the same data tables. */
export function isCompatible(payload: unknown, data: GameData): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Partial<SavePayload>
  return p.version === SAVE_VERSION && p.dataHash === data.hash
}

/** Why a payload would not load (empty = loadable). */
export function saveProblems(
  data: GameData,
  payload: SavePayload,
  opts: LoadOptions = {},
): string[] {
  return snapshotProblems(data, payload, opts)
}

/** Resume the saved game (Sim.load: validates, throws SimLoadError). */
export function restore(
  data: GameData,
  payload: SavePayload,
  opts: LoadOptions = {},
): Sim {
  return Sim.load(data, payload, opts)
}
