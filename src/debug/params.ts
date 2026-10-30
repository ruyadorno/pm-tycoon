// URL params (plan.md §5 "URL params", §6.8). parseParams is pure; params()
// reads location.search once and resolves the seed (default: a time-based
// seed chosen in the game layer — the sim itself never reads the clock).
// M6 (design-m6 §8 G): ?policy=delegating picks the delegating policy kind
// (any other truthy ?policy= stays competent), and ?level=N (debug only)
// forces level N on every fresh player's game — Boot's own new sim and each
// New game — through debug.forceLevel (src/scenes/BootScene.ts).
// M7 (design-m7 §6.10, plan-build2 §8.4 task 6): ?quest=<id> (debug only)
// offers that quests.json template (or the ultimate id, `golden_release`) on
// every fresh player's game through debug.offerQuest, after ?level=.
import type { PolicyKind } from '../sim/sim.ts'

export type ViewName = 'city' | 'warehouse' | 'gallery'

export interface Params {
  /** Sim seed (also Phaser's cosmetic config.seed). */
  seed: number
  /** True when ?seed= was given (shots, replays). */
  seedFromUrl: boolean
  /** Skip the Title card (audio stays locked until the first tap). */
  skipTitle: boolean
  /** World scene to open; null = the normal Title -> City flow. */
  view: ViewName | null
  /** Gallery page, 1..4. */
  page: number
  /** Sim seconds to run before the first render (cap 1800). */
  fastForward: number
  /** Drive the sim with the scripted policy (src/sim/policy.ts). */
  policy: boolean
  /** Which policy ?policy= asks for: 'delegating' for ?policy=delegating, else 'competent'. */
  policyKind: PolicyKind
  /**
   * ?level=N (debug builds): level N forced on a fresh game (sim command
   * debugForceLevel, so replays stay exact), truncated to an integer; null
   * when absent, not a number, or below 2. The sim refuses a level past
   * the last levels.json row (Boot warns).
   */
  level: number | null
  /**
   * ?quest=<templateId> (debug builds, design-m7 §6.10): offer that quest on
   * a fresh game (sim command debugOfferQuest — the scheduler, unlock level,
   * condition and requirement are skipped; replays stay exact); null when
   * absent or blank. An unknown id is refused by the sim (Boot warns).
   */
  quest: string | null
  /** Install window.__pm, the overlay and 4x speed in a production build. */
  debug: boolean
  mute: boolean
  /** false for ?audio=0: never create/resume audio (smoke default). */
  audio: boolean
  audiolog: boolean
  /** public/configs/<name>.json data override. */
  config: string | null
  /** Ignore the autosave and start a fresh game. */
  newGame: boolean
  /**
   * The Title over the attract city (B2 §5); false for ?attract=0: no
   * attract sim, the Title on a plain backdrop (tests that need the old flow).
   */
  attract: boolean
}

export const FAST_FORWARD_CAP_S = 1800
export const GALLERY_PAGES = 4

const VIEWS: readonly ViewName[] = ['city', 'warehouse', 'gallery']

/** The lowest ?level= worth forcing (every game starts at level 1). */
export const MIN_FORCED_LEVEL = 2

function flag(q: URLSearchParams, name: string): boolean {
  const v = q.get(name)
  return v !== null && v !== '0' && v !== 'false'
}

function int(q: URLSearchParams, name: string): number | null {
  const v = q.get(name)
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** Parse a query string. `fallbackSeed` is used when ?seed= is absent or bad. */
export function parseParams(search: string, fallbackSeed: number): Params {
  const q = new URLSearchParams(search)
  const seedArg = int(q, 'seed')
  const seedFromUrl = seedArg !== null
  const seed = ((seedFromUrl ? seedArg : fallbackSeed) >>> 0) & 0x7fffffff
  const viewArg = q.get('view')
  const view = VIEWS.includes(viewArg as ViewName)
    ? (viewArg as ViewName)
    : null
  const page = Math.min(GALLERY_PAGES, Math.max(1, int(q, 'page') ?? 1))
  const ff = Math.min(
    FAST_FORWARD_CAP_S,
    Math.max(0, int(q, 'fastForward') ?? 0),
  )
  const audioArg = q.get('audio')
  const attractArg = q.get('attract')
  const config = q.get('config')
  const levelArg = int(q, 'level')
  const policyArg = q.get('policy')?.trim().toLowerCase() ?? null
  const questArg = q.get('quest')?.trim() ?? ''
  return {
    seed,
    seedFromUrl,
    skipTitle: flag(q, 'skipTitle'),
    view,
    page,
    fastForward: ff,
    policy: flag(q, 'policy'),
    policyKind: policyArg === 'delegating' ? 'delegating' : 'competent',
    level: levelArg !== null && levelArg >= MIN_FORCED_LEVEL ? levelArg : null,
    quest: questArg === '' ? null : questArg,
    debug: flag(q, 'debug'),
    mute: flag(q, 'mute'),
    audio: !(audioArg === '0' || audioArg === 'false'),
    audiolog: flag(q, 'audiolog'),
    config: config && config.trim() ? config.trim() : null,
    newGame: flag(q, 'newGame'),
    attract: !(attractArg === '0' || attractArg === 'false'),
  }
}

let cached: Params | null = null

/** The page's params, parsed once (browser only). */
export function params(): Params {
  if (!cached) {
    const search = typeof location === 'undefined' ? '' : location.search
    cached = parseParams(search, Date.now() & 0x7fffffff)
  }
  return cached
}

/** Debug surface on: dev server, or ?debug=1 in a production build. */
export function debugEnabled(): boolean {
  return import.meta.env.DEV || params().debug
}

/** The world scene key the URL selects (City by default). */
export function worldSceneKey(
  p: Params = params(),
): 'City' | 'Warehouse' | 'Gallery' {
  if (p.view === 'warehouse') return 'Warehouse'
  if (p.view === 'gallery' && (import.meta.env.DEV || p.debug)) return 'Gallery'
  return 'City'
}
