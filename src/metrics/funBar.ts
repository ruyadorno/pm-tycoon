// Fun bar 3 (plan-build3 §9; M15 metrics contract §1.5–§1.6, D-M15-2/3/4/8):
// the seven checks the summary card shows under its rows, read from one
// playtest.json v3 profile, plus the pure helpers the card's three new rows
// share with them (rampWindow / longestQuiet for `Longest quiet` and item 2,
// storiesOf for `Stories` and item 4, thinkMedian for events.thinkMedianS).
//
// Phaser- and DOM-free (tools/check-sim-purity.mjs lists it) and value-free
// toward playtest.ts: that module re-exports everything here and imports
// FUN_TARGETS / thinkMedian back, so this file imports only its types — no
// runtime cycle.
//
//  1. Decisions felt like mine — ≥ 3 decision cards (kind 'decision', never a
//     job's Accept or a news OK: D-M15-3) answered off the default → judge
//     (can you name one you regret or are proud of?); none answered yet →
//     pending; otherwise fail.
//  2. Never idle on the ramp — the longest gap between beats (sim seconds) in
//     the ramp window (D-M15-2: minute 3 to the L2 tick, capped at minute 11
//     while L2 is not reached) is ≤ 90 s, and the median think time is under
//     15 s. The window still open → pending; a gap over 90 s → fail; the think
//     half is soft (D-M15-8): it turns a pass into judge, never into fail.
//  3. L2 by 10:30, L3 by 16:30 — each level on time, late (or not reached past
//     its bound) or still open: any late → fail, both on time → pass.
//  4. A story (3+ cards) — a chain whose closing card has depth ≥ 3 (D-M15-4)
//     → judge (did it read as one story?); a chain under way → pending; pairs
//     only or none → fail.
//  5. Kept playing past 25:00 — elapsedS at the first opening of the card (as
//     fun bar 2 item 4).
//  6. Every lost life explained — a counter, a sorter, a Clear, or a card and
//     the option chosen; a data pass (D-M15-8), not a judge.
//  7. (stretch) The Golden Release by 36:00 (victoryAtS).
//
// Instrumentation, not balance (D-M15-9): FUN_TARGETS stays in code and the
// sim never reads it; the gate's windows stay in economy.pacingTargets.
import type {
  Playtest,
  PlaytestBeat,
  PlaytestChain,
  PlaytestChoice,
  PlaytestLifeLost,
} from './playtest.ts'

/** plan-build3 §9: the fun bar 3 windows (sim seconds unless noted). */
export interface FunTargets {
  /** (1) decision cards answered off the default. */
  nonDefault: number
  /** (2) the ramp window opens at minute 3 … */
  rampFromS: number
  /** (2) … and closes at the L2 tick, or here while L2 is not reached (D-M15-2). */
  rampToS: number
  /** (2) the longest quiet allowed between two beats. */
  rampGapS: number
  /** (2, soft) median think time under this many wall seconds. */
  thinkMedianS: number
  /** (3) level 2 by this sim second. */
  level2ByS: number
  /** (3) level 3 by this sim second. */
  level3ByS: number
  /** (4) cards in a finished chain (the closing card's depth). */
  storyCards: number
  /** (5) wall seconds played before the summary card first opened; summaryOfferDue. */
  keepPlayingS: number
  /** (7, stretch) the Golden Release by this sim second. */
  stretchS: number
}

export const FUN_TARGETS = {
  nonDefault: 3,
  rampFromS: 180,
  rampToS: 660,
  rampGapS: 90,
  thinkMedianS: 15,
  level2ByS: 630,
  level3ByS: 990,
  storyCards: 3,
  keepPlayingS: 1500,
  stretchS: 2160,
} as const satisfies FunTargets

export type FunState = 'pass' | 'fail' | 'judge' | 'pending'

export interface FunCheck {
  /** 1..7 as numbered in plan-build3 §9. */
  n: number
  label: string
  state: FunState
  /** What the check read (`L2 10:12 · L3 16:01`, `not yet`, `… · you judge`). */
  detail: string
}

/** `m:ss` (minutes not wrapped into hours); `—` for null. */
export function clock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** One decimal (sim seconds are tenths; a difference of two can drift). */
function tenths(n: number): number {
  return Math.round(n * 10) / 10
}

// ---- the helpers (contract §1.5) ------------------------------------------------------

/**
 * Median think time over the decision and job choices (a news card's OK is
 * not thinking, D-M15-6), one decimal; null with none.
 */
export function thinkMedian(choices: readonly PlaytestChoice[]): number | null {
  const t = choices
    .filter((c) => c.kind !== 'news' && Number.isFinite(c.thinkS))
    .map((c) => c.thinkS)
    .toSorted((a, b) => a - b)
  if (t.length === 0) return null
  const mid = t.length >> 1
  const m =
    t.length % 2 === 1 ? (t[mid] ?? 0) : ((t[mid - 1] ?? 0) + (t[mid] ?? 0)) / 2
  return tenths(m)
}

/**
 * The ramp window (D-M15-2), sim seconds: from minute 3 to the L2 tick once
 * L2 is reached, else to min(simS, minute 11). `open` while L2 is not reached
 * and simS is short of minute 11 — the quiet can still grow.
 */
export function rampWindow(
  pt: Playtest,
  t: Readonly<FunTargets> = FUN_TARGETS,
): { fromS: number; toS: number; open: boolean } {
  const l2 = pt.level2AtS
  return {
    fromS: t.rampFromS,
    toS: l2 ?? Math.min(pt.simS, t.rampToS),
    open: l2 === null && pt.simS < t.rampToS,
  }
}

/**
 * The longest gap between consecutive beats inside [fromS, toS], the edges
 * included (fromS → the first beat, the last beat → toS; no beat at all → the
 * whole window), one decimal; null when the window is empty (toS ≤ fromS).
 */
export function longestQuiet(
  beats: readonly PlaytestBeat[],
  fromS: number,
  toS: number,
): number | null {
  if (!(toS > fromS)) return null
  const at = beats
    .map((b) => b.atS)
    .filter((s) => Number.isFinite(s) && s >= fromS && s <= toS)
    .toSorted((a, b) => a - b)
  let prev = fromS
  let gap = 0
  for (const s of [...at, toS]) {
    gap = Math.max(gap, s - prev)
    prev = s
  }
  return tenths(gap)
}

/** The chains the player finished (the choices that closed one), oldest first. */
export function storiesOf(choices: readonly PlaytestChoice[]): PlaytestChain[] {
  const out: PlaytestChain[] = []
  for (const c of choices) if (c.chain?.end) out.push({ ...c.chain })
  return out
}

/**
 * A lost life the data explains: a counter, a sorter's `looks clean` call,
 * the player's Clear, or a card with the option the player chose.
 */
export function lifeExplained(l: PlaytestLifeLost): boolean {
  return (
    l.counter !== null ||
    l.sorter !== null ||
    l.clearedByPlayer ||
    (l.cause === 'event' && l.option !== null)
  )
}

// ---- fun bar 3 (plan-build3 §9) --------------------------------------------------------

type Verdict = Pick<FunCheck, 'state' | 'detail'>

/**
 * Fun bar 3 from the profile. `judge` = the data part holds but the item also
 * asks how it felt (only the author can say), read `you judge`; `pending` =
 * the window is still open. `openedAtS` = elapsedS at the run's first opening
 * of the summary card (default the profile's elapsedS).
 */
export function funBar(
  pt: Playtest,
  targets: Readonly<FunTargets> = FUN_TARGETS,
  openedAtS: number | null = null,
): FunCheck[] {
  const ev = pt.events
  const choices = ev.choices

  // (1) D-M15-3: decision cards only.
  const decisions = choices.filter((c) => c.kind === 'decision')
  const k = decisions.filter((c) => !c.default).length
  const one: Verdict =
    k >= targets.nonDefault
      ? { state: 'judge', detail: `${k} not default · you judge` }
      : decisions.length === 0
        ? { state: 'pending', detail: 'no cards yet' }
        : { state: 'fail', detail: `${k} not default` }

  // (2) D-M15-2 window, D-M15-8 soft think half.
  const w = rampWindow(pt, targets)
  let two: Verdict
  if (w.open) two = { state: 'pending', detail: 'not yet' }
  else {
    const g = longestQuiet(pt.beats, w.fromS, w.toS)
    const m = ev.thinkMedianS
    const detail = `gap ${clock(g)} · think ${m === null ? '—' : `${Math.round(m)} s`}`
    two =
      g !== null && g > targets.rampGapS
        ? { state: 'fail', detail }
        : m === null || m < targets.thinkMedianS
          ? { state: 'pass', detail }
          : { state: 'judge', detail }
  }

  // (3) Each level: on time, late (or past its bound unreached), open.
  const level = (at: number | null, by: number): 'ok' | 'bad' | 'open' =>
    at !== null ? (at <= by ? 'ok' : 'bad') : pt.simS > by ? 'bad' : 'open'
  const l2 = level(pt.level2AtS, targets.level2ByS)
  const l3 = level(pt.level3AtS, targets.level3ByS)
  const three: Verdict = {
    state:
      l2 === 'bad' || l3 === 'bad'
        ? 'fail'
        : l2 === 'ok' && l3 === 'ok'
          ? 'pass'
          : 'pending',
    detail: `L2 ${clock(pt.level2AtS)} · L3 ${clock(pt.level3AtS)}`,
  }

  // (4) D-M15-4: the closing card's depth.
  const stories = storiesOf(choices)
  const s = stories.filter((c) => c.depth >= targets.storyCards).length
  // From state, not started − finished: a dropped link ends a chain unfinished (review sim-1).
  const going = ev.chainsRunning
  const four: Verdict =
    s >= 1
      ? {
          state: 'judge',
          detail: `${s} of ${targets.storyCards}+ · you judge`,
        }
      : going > 0
        ? { state: 'pending', detail: `${going} under way` }
        : stories.length > 0
          ? { state: 'fail', detail: 'pairs only' }
          : { state: 'fail', detail: 'none finished' }

  // (5) As fun bar 2 item 4.
  const keep = targets.keepPlayingS
  const opened = openedAtS ?? pt.elapsedS

  // (6) D-M15-8: a data pass.
  const lost = pt.livesLost
  const u = lost.filter((l) => !lifeExplained(l)).length
  const six: Verdict =
    lost.length === 0
      ? { state: 'pass', detail: 'none lost' }
      : u > 0
        ? { state: 'fail', detail: `${u} unexplained` }
        : { state: 'pass', detail: `all ${lost.length} explained` }

  // (7) The stretch.
  const by = targets.stretchS
  const v = pt.victoryAtS
  const seven: Verdict =
    v !== null && v <= by
      ? { state: 'pass', detail: `Victory ${clock(v)}` }
      : v === null && pt.simS <= by
        ? { state: 'pending', detail: 'not yet' }
        : {
            state: 'fail',
            detail: v !== null ? `Victory ${clock(v)}` : `none by ${clock(by)}`,
          }

  return [
    { n: 1, label: 'Decisions felt like mine', ...one },
    { n: 2, label: 'Never idle on the ramp', ...two },
    {
      n: 3,
      label: `L2 by ${clock(targets.level2ByS)}, L3 by ${clock(targets.level3ByS)}`,
      ...three,
    },
    { n: 4, label: `A story (${targets.storyCards}+ cards)`, ...four },
    {
      n: 5,
      label: `Kept playing past ${clock(keep)}`,
      state: opened > keep ? 'pass' : 'fail',
      detail: `summary at ${clock(opened)}`,
    },
    { n: 6, label: 'Every lost life explained', ...six },
    { n: 7, label: `Stretch: Golden Release by ${clock(by)}`, ...seven },
  ]
}
