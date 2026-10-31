// Audio tables (audio.md §1): src/data/audio.json, src/data/sfx.json and src/data/music/*.json, typed and
// validated. Imported statically so Vite bundles them; Boot may pass its own copies (e.g. from the
// src/data/index.ts loaders or a `?config=` override) through createAudioDirector({ data }).
import audioJson from '../data/audio.json'
import semverSwingJson from '../data/music/semver-swing.json'
import sfxJson from '../data/sfx.json'
import { type LeadSheet, validateLeadSheet } from './leadsheet.ts'

export type InstrumentId =
  | 'piano'
  | 'bass'
  | 'vibes'
  | 'trumpet'
  | 'piano2'
  | 'bass2'
  | 'vibes2'
  | 'trumpet2'

export const INSTRUMENT_IDS: readonly InstrumentId[] = [
  'piano',
  'bass',
  'vibes',
  'trumpet',
  'piano2',
  'bass2',
  'vibes2',
  'trumpet2',
]

export interface InstrumentConfig {
  /** gleitz FluidR3_GM id = public/audio/sf/<sf>/ */
  sf: string
  /** smplr volume 0–127 */
  volume: number
  /** notes to load (midi, inclusive) */
  range: [number, number]
  /** release after note-off, seconds */
  release: number
  set: 'music' | 'stingers'
}

export interface AudioConfig {
  /** 'off' = SFX only (plan.md R3) */
  music: 'live' | 'off'
  defaultSheet: string
  buses: { master: number; music: number; sfx: number }
  /**
   * Make-up gain (dB) on every smplr instrument output, music and stinger sets alike. smplr maps volume and
   * velocity through squared curves (volume 85 at velocity 70 ≈ −17 dB), so without it the band renders around
   * −44 dBFS and the stingers vanish under it; brushes and zzfx SFX are not trimmed.
   */
  samplerTrimDb: number
  /** master safety limiter (DynamicsCompressor) — only engages when SFX + stingers + music stack near 0 dBFS */
  limiter: {
    thresholdDb: number
    kneeDb: number
    ratio: number
    attackS: number
    releaseS: number
  }
  muteRampS: number
  lookAheadS: number
  toastSeconds: number
  resumeCheckMs: number
  instruments: Record<InstrumentId, InstrumentConfig>
  loadOrder: InstrumentId[][]
  /** brush gains; `override` null = follow the sheet's parts.brushes, true/false forces it */
  brushes: { ride: number; hat: number; override: boolean | null }
  sfx: {
    sampleRate: number
    zzfxVolume: number
    scannerHissDelayMs: number
    hissLoopGain: number
    paydayShortRate: number
  }
  throttleMs: Record<string, number>
  /** timer tolerance for the hiss / stall-alarm / grumble loops against their own throttle window */
  throttleSlackMs: number
  loopsMs: { hiss: number; stallAlarm: number; grumble: number }
  lifeLost: { rampS: number; pauseBeats: number }
  stingers: {
    cashRollMs: number
    cashDurS: number
    cashVel: number
    cashVelPerSize: number
    lateVel: number
    defusedVel: number
    oopsVel: number
    levelUpVel: number
    glissMs: number
    gameOverDelayS: number
    gameOverTempo: number
    gameOverVel: number
    gameOverHoldS: number
    /** build 2 M7 victory tag (B2 §3.4, design-m7 §6.9) */
    victoryVel: number
    victoryHoldS: number
  }
}

/** zzfx parameter arrays by name (audio.md §7). */
export type SfxTable = Record<string, number[]>

/**
 * The 18 one-shot SFX of audio.md §7 + build 2's questDone (design-m7 §6.9), plus the two brush voices, which
 * only the band plays.
 */
export const SFX_NAMES = [
  'tap',
  'sheetOpen',
  'sheetClose',
  'buy',
  'pickup',
  'scannerPing',
  'hiss',
  'thump',
  'tapeStop',
  'wah',
  'bell',
  'horn',
  'airHorn',
  'payday',
  'stallAlarm',
  'grumble',
  'regionUnlocked',
  'deny',
  'questDone',
  // Build 3 (B3 §3.4, §7): a card opens — a soft two-note bell, throttled
  // 2 s (audio.json throttleMs); the director wiring is M12.
  'eventPing',
] as const
export const BRUSH_NAMES = ['ride', 'hat'] as const

export interface AudioData {
  config: AudioConfig
  sfx: SfxTable
  sheets: Record<string, LeadSheet>
}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`audio data: ${msg}`)
}

export function validateAudioConfig(input: unknown): AudioConfig {
  const c = input as AudioConfig
  check(c && typeof c === 'object', 'audio.json is not an object')
  check(c.music === 'live' || c.music === 'off', 'music must be live | off')
  check(
    typeof c.samplerTrimDb === 'number' && Math.abs(c.samplerTrimDb) <= 40,
    'samplerTrimDb must be a number in -40..40',
  )
  check(
    typeof c.limiter?.thresholdDb === 'number',
    'limiter.thresholdDb missing',
  )
  for (const k of ['master', 'music', 'sfx'] as const)
    check(
      typeof c.buses?.[k] === 'number' && c.buses[k] >= 0,
      `buses.${k} must be a number >= 0`,
    )
  for (const id of INSTRUMENT_IDS) {
    const i = c.instruments?.[id]
    check(i, `instruments.${id} missing`)
    check(typeof i.sf === 'string' && i.sf, `instruments.${id}.sf missing`)
    check(i.volume >= 0 && i.volume <= 127, `instruments.${id}.volume 0..127`)
    check(
      Array.isArray(i.range) && i.range[0] <= i.range[1],
      `instruments.${id}.range`,
    )
  }
  check(
    typeof c.throttleSlackMs === 'number' && c.throttleSlackMs >= 0,
    'throttleSlackMs must be a number >= 0',
  )
  for (const k of ['hiss', 'stallAlarm', 'grumble'] as const)
    check(
      typeof c.loopsMs?.[k] === 'number' && c.loopsMs[k] > 0,
      `loopsMs.${k} must be a number > 0`,
    )
  check(
    Array.isArray(c.loadOrder) &&
      c.loadOrder.flat().every((id) => INSTRUMENT_IDS.includes(id)),
    'loadOrder lists unknown instruments',
  )
  return c
}

export function validateSfxTable(input: unknown): SfxTable {
  const t = input as SfxTable
  check(t && typeof t === 'object', 'sfx.json is not an object')
  for (const name of [...SFX_NAMES, ...BRUSH_NAMES]) {
    const p = t[name]
    check(
      Array.isArray(p) &&
        p.length <= 21 &&
        p.every((v) => typeof v === 'number' && Number.isFinite(v)),
      `sfx.${name} must be an array of <= 21 numbers`,
    )
  }
  return t
}

/** Linear make-up gain applied to the smplr instrument outputs. */
export function samplerGain(c: AudioConfig): number {
  return 10 ** ((c.samplerTrimDb ?? 0) / 20)
}

/**
 * What a director runs on when the shipped tables fail validation: it is disabled, so only the raw config is
 * kept (for state()) and nothing is played. Never throws.
 */
export function fallbackAudioData(): AudioData {
  return { config: audioJson as unknown as AudioConfig, sfx: {}, sheets: {} }
}

let cached: AudioData | null = null

/** The tables shipped in src/data (validated once). */
export function defaultAudioData(): AudioData {
  if (!cached) {
    const sheet = validateLeadSheet(semverSwingJson)
    cached = {
      config: validateAudioConfig(audioJson),
      sfx: validateSfxTable(sfxJson),
      sheets: { [sheet.id]: sheet },
    }
  }
  return cached
}
