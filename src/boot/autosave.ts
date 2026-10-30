// Autosave and the localStorage keys (plan.md §5 "localStorage keys", §6.4
// "Save and load"; spec §2; city-view.md §9.1, §9.5; spec-build2 §8).
//
//   pm.save.v2      {version: SAVE_VERSION (3 since M6), savedAt, build,
//                    dataHash, seed, state, commandLog, onboarding} via
//                    src/sim/save.ts
//   pm.settings.v1  {muted, speed} (merged: the AudioDirector writes `muted`
//                    through its own store and keeps `speed`; we keep `muted`)
//   pm.playtest.v1  the playtest profile + its `restore` accumulators
//                   (src/metrics/playtest.ts, M4)
//
// Per config (report-playtest1 §6.13): a session whose data carries a
// `?config=<name>` override (Boot honours it with the debug surface on) saves
// under `pm.save.v2:cfg:<name>` and keeps its profile under
// `pm.playtest.v1:cfg:<name>`, so a spicy session never evicts the cold run's
// save or profile; settings are per device and stay unsuffixed. A build-1
// save (`pm.save.v1`, version 1) is never loaded: readSave reports it stale
// and discardSave removes it, the same path (and STALE_SAVE_TEXT toast) as a
// save from older data tables (plan.md R9: no migrations). Reset clears the
// legacy key, both keys of every config, and the settings.
//
// The HUD drives `Autosave`: tick(delta) from its update every 10 s of real
// time, save('hidden') on Phaser HIDDEN and save('pagehide') on window
// pagehide; a failed write (quota, blocked storage) reports once through
// onError (a one-line toast) and is retried next cycle. Every save also
// writes the profile (deps.getPlaytest), so the profile and the run it
// describes stay in step; while the sim is held tickPlaytest(delta) keeps
// the 10-s cadence (a full save while saves are on, else the profile alone —
// e.g. after the game-over save), and a disabled autosave still writes the
// profile on hide. readPlaytest() hands the stored profile to the recorder,
// which resumes it only for the same run. The Title reads the
// save header (`Day 7 · $1,240 · Lv 2`) and offers Continue only for a
// current-version (SAVE_VERSION) payload whose dataHash matches the running
// tables; anything else is discarded with the toast "Save from an older
// build was reset" (R9: no migrations). The sim never sees the onboarding
// object: HudScene keeps it in the game registry under REG_ONBOARDING and
// this module serialises it.
//
// onboarding (city-view §9.1-§9.2): `step`/`skipped` (the tour), `sawFirstFlag`
// (the scripted-flag hint was followed into the warehouse) and `sawTossHint`
// (the one-time puns.json tossHint toast). The wanted list (malware labels
// revealed by DEFUSED tosses and lost lives) is sim state since M6
// (spec-build2 §2.8: `state.wanted`, saved with the state); a `wanted` key in
// an older payload is dropped by normaliseOnboarding. HudScene mutates the
// registry object in place; getOnboarding() is the one accessor and every
// save writes it, plus an immediate save after a lost life / game over so a
// reload never replays the delivery.
//
// Phaser is a type-only import and storage is injectable, so everything here
// runs under Vitest (tests/ui/autosave.test.ts).
import type { GameData } from '../data/types.ts'
import { debugEnabled, params } from '../debug/params.ts'
import {
  deserialise,
  isCompatible,
  LEGACY_SAVE_KEY,
  restore,
  SAVE_KEY,
  saveProblems,
  serialise,
  type OnboardingSave,
  type SavePayload,
} from '../sim/save.ts'
import { Sim } from '../sim/sim.ts'
import { formatMoney } from '../ui/text.ts'
import { freshOnboarding, normaliseOnboarding } from '../ui/Onboarding.ts'

export { LEGACY_SAVE_KEY, SAVE_KEY }
export const SETTINGS_KEY = 'pm.settings.v1'
/** The profile stays v1 until M10 (plan-build2 §8.7); only the suffix is new. */
export const PLAYTEST_KEY = 'pm.playtest.v1'
/** Between a base key and the config name: `pm.save.v2:cfg:spicy`. */
export const CONFIG_KEY_INFIX = ':cfg:'
/**
 * The fixed keys Reset clears (plan.md §5); clearAllKeys also removes every
 * `<SAVE_KEY|PLAYTEST_KEY>:cfg:<name>` key it finds.
 */
export const STORAGE_KEYS: readonly string[] = [
  LEGACY_SAVE_KEY,
  SAVE_KEY,
  SETTINGS_KEY,
  PLAYTEST_KEY,
]
/** Base keys that take the per-config suffix (settings do not). */
const PER_CONFIG_KEYS: readonly string[] = [SAVE_KEY, PLAYTEST_KEY]

// ---- the config the keys follow --------------------------------------------------

/** undefined = follow the URL (saveConfig); else pinned by setSaveConfig. */
let pinnedConfig: string | null | undefined

/**
 * The data config this page's keys follow: the one Boot loads (BootScene:
 * `?config=<name>` with the debug surface on), else null for the shipped
 * tables. setSaveConfig pins another value (tests, or Boot passing its own).
 */
export function saveConfig(): string | null {
  if (pinnedConfig !== undefined) return pinnedConfig
  const p = params()
  return p.config && debugEnabled() ? p.config : null
}

/** Pin the config the keys follow (null = none); undefined = the URL again. */
export function setSaveConfig(name: string | null | undefined): void {
  pinnedConfig = name === undefined ? undefined : name || null
}

/** `base`, or `base:cfg:<config>` for a config session (report §6.13). */
export function configKey(
  base: string,
  config: string | null = saveConfig(),
): string {
  return config ? `${base}${CONFIG_KEY_INFIX}${config}` : base
}

/** Where this session's save lives: pm.save.v2[:cfg:<name>]. */
export function saveKey(config: string | null = saveConfig()): string {
  return configKey(SAVE_KEY, config)
}

/** Where this session's playtest profile lives: pm.playtest.v1[:cfg:<name>]. */
export function playtestKey(config: string | null = saveConfig()): string {
  return configKey(PLAYTEST_KEY, config)
}

/** Autosave period in real ms (spec §2). */
export const AUTOSAVE_MS = 10_000

/** Game registry: the live OnboardingSave object (HudScene / Onboarding). */
export const REG_ONBOARDING = 'onboarding'
/** Game registry: a toast for the HUD to show once at create (Boot). */
export const REG_PENDING_TOAST = 'pendingToast'

/** What getOnboarding needs from a Phaser DataManager (game.registry). */
export interface RegistryLike {
  get(key: string): unknown
  set(key: string, value: unknown): unknown
}

/**
 * The live OnboardingSave in the game registry (REG_ONBOARDING). A missing
 * or malformed value is replaced by a normalised object, so callers always
 * get the one shared instance to read or mutate in place.
 */
export function getOnboarding(registry: RegistryLike): OnboardingSave {
  const cur = registry.get(REG_ONBOARDING)
  const ok =
    typeof cur === 'object' &&
    cur !== null &&
    typeof (cur as OnboardingSave).step === 'number' &&
    typeof (cur as OnboardingSave).skipped === 'boolean' &&
    typeof (cur as OnboardingSave).sawFirstFlag === 'boolean' &&
    typeof (cur as OnboardingSave).sawTossHint === 'boolean'
  if (ok) return cur as OnboardingSave
  const fresh = normaliseOnboarding(cur)
  registry.set(REG_ONBOARDING, fresh)
  return fresh
}

export const STALE_SAVE_TEXT = 'Save from an older build was reset'
export const SAVE_FAILED_TEXT = 'Autosave failed — retrying'

// ---- storage -------------------------------------------------------------------

/** The subset of Storage used here (localStorage, or a test fake). */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** Storage enumeration (Reset finds the `:cfg:` keys); optional for fakes. */
  readonly length?: number
  key?(index: number): string | null
}

/** window.localStorage, or null where storage is unavailable or blocked. */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function getText(store: KeyValueStore | null, key: string): string | null {
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function remove(store: KeyValueStore | null, key: string): void {
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    // blocked storage: nothing to remove
  }
}

/** Every key in the store (empty when it cannot be enumerated). */
function storedKeys(store: KeyValueStore | null): string[] {
  const out: string[] = []
  if (!store) return out
  try {
    const n = store.length ?? 0
    for (let i = 0; i < n; i++) {
      const k = store.key?.(i)
      if (typeof k === 'string') out.push(k)
    }
  } catch {
    // blocked storage: nothing to enumerate
  }
  return out
}

/**
 * Drop this session's save (stale save, New game) and any build-1 save
 * (pm.save.v1, never loadable). Other configs' saves are kept.
 */
export function discardSave(store = browserStorage()): void {
  remove(store, saveKey())
  remove(store, LEGACY_SAVE_KEY)
}

/**
 * The run this session's save holds — its seed and tick — without
 * validating the whole payload (the HUD asks whether the running sim is that
 * run before resuming the playtest profile); null when absent or unreadable.
 */
export function savedRun(
  store = browserStorage(),
): { seed: number; tick: number } | null {
  const o = parseObject(getText(store, saveKey()))
  const state = o.state as { tick?: unknown } | undefined
  const tick = state?.tick
  return typeof o.seed === 'number' && typeof tick === 'number'
    ? { seed: o.seed, tick }
    : null
}

/** This session's profile parsed (an object), or null (absent, unreadable). */
export function readPlaytest(store = browserStorage()): unknown {
  const o = parseObject(getText(store, playtestKey()))
  return Object.keys(o).length > 0 ? o : null
}

/**
 * Reset: clear every key of ours — pm.save.v1, pm.save.v2, pm.settings.v1,
 * pm.playtest.v1 and the `:cfg:<name>` save and profile of every config
 * (found by enumerating the store; this session's are removed even when the
 * store cannot be enumerated).
 */
export function clearAllKeys(store = browserStorage()): void {
  const prefixes = PER_CONFIG_KEYS.map((k) => `${k}${CONFIG_KEY_INFIX}`)
  const keys = new Set<string>([...STORAGE_KEYS, saveKey(), playtestKey()])
  for (const k of storedKeys(store)) {
    if (prefixes.some((p) => k.startsWith(p))) keys.add(k)
  }
  for (const k of keys) remove(store, k)
}

// ---- settings --------------------------------------------------------------------

export type SavedSpeed = 1 | 2

export interface Settings {
  muted: boolean
  /** The last chosen running speed (pause is never persisted). */
  speed: SavedSpeed
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { muted: false, speed: 1 }

function parseObject(text: string | null): Record<string, unknown> {
  if (!text) return {}
  try {
    const v: unknown = JSON.parse(text)
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function parseSettings(text: string | null): Settings {
  const o = parseObject(text)
  return {
    muted: o.muted === true,
    speed: o.speed === 2 ? 2 : 1,
  }
}

export function readSettings(store = browserStorage()): Settings {
  return parseSettings(getText(store, SETTINGS_KEY))
}

/** Merge `patch` into pm.settings.v1, keeping any other fields. */
export function writeSettings(
  patch: Partial<Settings>,
  store = browserStorage(),
): boolean {
  if (!store) return false
  try {
    const o = parseObject(store.getItem(SETTINGS_KEY))
    store.setItem(SETTINGS_KEY, JSON.stringify({ ...o, ...patch }))
    return true
  } catch {
    return false
  }
}

// ---- the save ---------------------------------------------------------------------

/** Title Continue subtitle: `Day 7 · $1,240 · Lv 2` (Day = completed days + 1). */
export function saveHeader(payload: Pick<SavePayload, 'state'>): string {
  const s = payload.state
  return `Day ${s.day + 1} · ${formatMoney(s.economy.balance)} · Lv ${s.level.level}`
}

export type SaveCheck =
  | { kind: 'none' }
  | { kind: 'ok'; payload: SavePayload; header: string }
  | { kind: 'stale'; problems: string[] }

/**
 * Classify stored save text: none, ok (SAVE_VERSION, same dataHash, loadable),
 * or stale (anything else, to be discarded with STALE_SAVE_TEXT).
 */
export function checkSave(text: string | null, data: GameData): SaveCheck {
  if (text === null || text === '') return { kind: 'none' }
  let payload: SavePayload
  try {
    payload = deserialise(text)
  } catch (err) {
    return {
      kind: 'stale',
      problems: [err instanceof Error ? err.message : String(err)],
    }
  }
  if (!isCompatible(payload, data))
    return { kind: 'stale', problems: ['version or dataHash mismatch'] }
  const problems = saveProblems(data, payload)
  if (problems.length > 0) return { kind: 'stale', problems }
  return { kind: 'ok', payload, header: saveHeader(payload) }
}

/**
 * This session's save, classified (checkSave). With no save of its own a
 * build-1 save (pm.save.v1) reads as stale, so the caller discards it
 * (discardSave) and shows STALE_SAVE_TEXT — it is never loaded (R9).
 */
export function readSave(data: GameData, store = browserStorage()): SaveCheck {
  const check = checkSave(getText(store, saveKey()), data)
  if (check.kind === 'none' && getText(store, LEGACY_SAVE_KEY) !== null)
    return { kind: 'stale', problems: [`${LEGACY_SAVE_KEY}: a build-1 save`] }
  return check
}

export interface LoadedGame {
  sim: Sim
  onboarding: OnboardingSave
}

/** Resume a checked payload (Sim.load; throws SimLoadError on a bad state). */
export function loadGame(data: GameData, payload: SavePayload): LoadedGame {
  return {
    sim: restore(data, payload),
    onboarding: normaliseOnboarding(payload.onboarding),
  }
}

/** A fresh game: the §7.1 start state and an untouched tour. */
export function newGame(data: GameData, seed: number): LoadedGame {
  return { sim: new Sim(data, seed), onboarding: freshOnboarding() }
}

export interface StartupChoice {
  /** The restored game, or null to keep Boot's fresh sim. */
  game: LoadedGame | null
  /** STALE_SAVE_TEXT when a save was found and discarded. */
  toast: string | null
}

/**
 * Boot without the Title (?skipTitle=1 / ?view=city|warehouse): resume the
 * autosave unless `?newGame=1` or an explicit `?seed=` asks for a fresh game.
 * A stale save is discarded (the HUD toasts STALE_SAVE_TEXT).
 */
export function startupGame(
  data: GameData,
  opts: { skipTitle: boolean; newGame: boolean; seedFromUrl: boolean },
  store = browserStorage(),
): StartupChoice {
  if (!opts.skipTitle || opts.newGame || opts.seedFromUrl)
    return { game: null, toast: null }
  const check = readSave(data, store)
  if (check.kind === 'none') return { game: null, toast: null }
  if (check.kind === 'ok') {
    try {
      return { game: loadGame(data, check.payload), toast: null }
    } catch {
      // fall through: unloadable = stale
    }
  }
  discardSave(store)
  return { game: null, toast: STALE_SAVE_TEXT }
}

// ---- the autosaver ------------------------------------------------------------------

export type SaveReason = 'timer' | 'hidden' | 'pagehide' | 'manual'

export interface AutosaveDeps {
  /** The live Sim (registry 'sim'); null skips the save. */
  getSim: () => Sim | null
  /** The live onboarding object (registry REG_ONBOARDING). */
  getOnboarding: () => OnboardingSave | null
  /** __BUILD_STAMP__ (or the registry buildStamp). */
  build: string
  /** Wall clock for savedAt (Date.now in the game layer). */
  now: () => number
  store?: KeyValueStore | null
  /** Called once per failure streak (the HUD shows a one-line toast). */
  onError?: (message: string, reason: SaveReason) => void
  /** The playtest profile to store under playtestKey() (M4); absent = none. */
  getPlaytest?: () => unknown
}

export class Autosave {
  /** Saves are skipped while false (e.g. the game-over screen in M2). */
  enabled = true
  /** Real ms accumulated toward the next timed save. */
  elapsed = 0
  lastSavedAt: number | null = null
  failures = 0
  /** Real ms held (paused) toward the next profile write. */
  playtestElapsed = 0
  private playtestFailed = false
  /** pm.save.v1 is removed after the first successful build-2 save. */
  private legacyCleared = false
  private deps: AutosaveDeps

  constructor(deps: AutosaveDeps) {
    this.deps = deps
  }

  private get store(): KeyValueStore | null {
    return this.deps.store === undefined ? browserStorage() : this.deps.store
  }

  /**
   * Write this session's save now (saveKey(), and the profile with it).
   * Returns true on success. While disabled only the profile is written.
   */
  save(reason: SaveReason = 'manual'): boolean {
    if (!this.enabled) {
      this.savePlaytest()
      return false
    }
    const sim = this.deps.getSim()
    if (!sim) return false
    try {
      const store = this.store
      if (!store) throw new Error('localStorage unavailable')
      const savedAt = this.deps.now()
      const text = serialise(sim, {
        savedAt,
        build: this.deps.build,
        onboarding: this.deps.getOnboarding(),
      })
      store.setItem(saveKey(), text)
      if (!this.legacyCleared) {
        this.legacyCleared = true
        remove(store, LEGACY_SAVE_KEY)
      }
      this.lastSavedAt = savedAt
      this.failures = 0
      this.elapsed = 0
      this.savePlaytest()
      return true
    } catch (err) {
      this.failures++
      this.elapsed = 0
      if (this.failures === 1) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`autosave (${reason}) failed: ${msg}`)
        this.deps.onError?.(SAVE_FAILED_TEXT, reason)
      }
      return false
    }
  }

  /** Advance the 10-s timer by `deltaMs` of real time; saves when it elapses. */
  tick(deltaMs: number): boolean {
    if (!this.enabled) return false
    this.elapsed += Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0)
    if (this.elapsed < AUTOSAVE_MS) return false
    return this.save('timer')
  }

  /**
   * Write the profile now (playtestKey(); no-op without deps.getPlaytest). A
   * failed write is logged once and retried on the next call.
   */
  savePlaytest(): boolean {
    this.playtestElapsed = 0
    const get = this.deps.getPlaytest
    if (!get) return false
    try {
      const obj = get()
      if (obj === null || obj === undefined) return false
      const store = this.store
      if (!store) throw new Error('localStorage unavailable')
      store.setItem(playtestKey(), JSON.stringify(obj))
      this.playtestFailed = false
      return true
    } catch (err) {
      if (!this.playtestFailed) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`playtest profile write failed: ${msg}`)
      }
      this.playtestFailed = true
      return false
    }
  }

  /**
   * The 10-s cadence while the sim is held (tick() does not run then): a
   * full save while saves are on — the sim may have moved since the last
   * one, and the two keys stay in step — else the profile alone.
   */
  tickPlaytest(deltaMs: number): boolean {
    this.playtestElapsed += Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0)
    if (this.playtestElapsed < AUTOSAVE_MS) return false
    this.playtestElapsed = 0
    return this.enabled ? this.save('timer') : this.savePlaytest()
  }
}
