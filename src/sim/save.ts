// Save payload (plan.md §5 localStorage key, §6.4 "Save and load";
// spec-build2 §8: `pm.save.v2` since build 2). The sim never reads the clock
// or storage: src/boot/autosave.ts supplies savedAt / build / onboarding,
// picks the key (SAVE_KEY, or SAVE_KEY + ':cfg:<name>' under ?config=) and
// does the localStorage I/O. No migrations (R9): a payload loads only when
// version === SAVE_VERSION (types.ts STATE_VERSION, 5 since M8; the key stays
// `pm.save.v2` — it names the build-2 save) and its dataHash
// matches the running data tables (isCompatible); otherwise the Title
// discards it — a build-1 save (`pm.save.v1`, version 1) included.

import type { GameData } from '../data/types.ts'
import type { CommandLogEntry } from './commands.ts'
import { Sim, snapshotProblems } from './sim.ts'
import type { LoadOptions } from './sim.ts'
import { STATE_VERSION, type SimState } from './types.ts'

/** The build-2 save key (spec-build2 §8). */
export const SAVE_KEY = 'pm.save.v2'
/** The build-1 key: never loaded, removed with the stale-save toast. */
export const LEGACY_SAVE_KEY = 'pm.save.v1'
/** = the sim's STATE_VERSION: payload, snapshot and state share one number. */
export const SAVE_VERSION = STATE_VERSION

/** UI state the HUD's Onboarding keeps (the sim never reads it). */
export interface OnboardingSave {
  step: number
  skipped: boolean
  sawFirstFlag: boolean
  sawTossHint: boolean
}

export interface SavePayload {
  version: typeof SAVE_VERSION
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

/** Title "Continue" rule: version SAVE_VERSION and the same data tables. */
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
