// The event deck (spec-build3 §3, §6; M11 contract §1, §2.8, §3 stream B):
// the deck tick step (step 10b, between levels and quests), the random draw
// (job cards folded into it, D-1 blanks), chains and routers, the rescue,
// the open card and its options, decide / debug commands.
//
// Streams (D-2): `state.events.rng` (Sim.eventRng) is the CADENCE stream —
// the job roll and the gap, always drawn in that order; `state.events.picks`
// (Sim.eventPicksRng) is the CONTENT stream — decision picks, random
// targets, `one` picks and every draw an effect makes. Job templates stay on
// the quest stream. Never state.rng.
//
// M11 wave 0: real constants, startEventsState and eventDef; every other
// export is an inert stub with its final signature (no card ever opens).
// Stream B implements them.

import type {
  EventCond,
  EventDef,
  EventEffect,
  GameData,
} from '../../data/types.ts'
import type { CommandResult } from '../commands.ts'
import { seedWord } from '../rng.ts'
import type { Sim } from '../sim.ts'
import type { CardRefs, EventsState, OpenCard } from '../types.ts'
import { ticksFromS } from '../types.ts'
import type { EffectLine } from './effects.ts'
import { debugOfferQuest } from './quests.ts'

export type { CardRefs } from '../types.ts'

/** XORed into the seed word for the cadence stream (≠ the people / quest salts). */
export const EVENT_RNG_SALT = 0xc2b2ae35
/** XORed into the seed word for the content (picks) stream. */
export const EVENT_PICKS_RNG_SALT = 0x27d4eb2f
/** nextDrawTick at or above this = the deck makes no automatic card (tests, D-8). */
export const DECK_OFF_TICK = 1e12
/** A job card's option indexes (synthesized: Accept, then Decline = the default). */
export const JOB_ACCEPT = 0
export const JOB_DECLINE = 1

/** One option of the open card as the UI and the policy see it. */
export interface CardOption {
  index: number
  /** Placeholders filled. */
  label: string
  effects: readonly EventEffect[]
  /** 0 when the option has no cost. */
  cost: number
  default: boolean
  danger: boolean
  /** Its `if` holds now (hidden options are never offered). */
  visible: boolean
  /** balance ≥ cost. */
  affordable: boolean
  /** A conditional next's filled hint, else null. */
  hint: string | null
}

/** The start state of the deck: both rng words, the first draw at firstEventS. */
export function startEventsState(data: GameData, seed: number): EventsState {
  return {
    rng: (seedWord(seed) ^ EVENT_RNG_SALT) >>> 0,
    picks: { rng: (seedWord(seed) ^ EVENT_PICKS_RNG_SALT) >>> 0 },
    open: null,
    queue: [],
    scheduled: [],
    nextDrawTick: ticksFromS(data.events.schedule.firstEventS),
    rescueTick: null,
    lastCategory: null,
    seen: {},
    cooldownUntil: {},
    flags: {},
    history: [],
    wrongTossDay: 0,
    wrongTossBase: 0,
    stats: {
      offered: 0,
      decided: 0,
      withdrawn: 0,
      blanks: 0,
      byCategory: {},
      livesLost: 0,
      livesGained: 0,
      vehiclesLost: 0,
      workersLost: 0,
      chainsStarted: 0,
      chainsFinished: 0,
      modifiersPeak: 0,
    },
  }
}

/** The events.json card with this id (routers included), or null. */
export function eventDef(data: GameData, id: string): EventDef | null {
  return data.events.deck.find((d) => d.id === id) ?? null
}

/** Tick step 10b (B3 §3.2 / plan §4): expiry, absences, the wrong-toss day, then queue / links / rescue / draw. */
export function deckStep(_sim: Sim): void {}

/** The open card's options (job cards: Accept / Decline). */
export function cardOptions(_sim: Sim, _card: OpenCard): CardOption[] {
  return []
}

/** The generated lines of one option: the cost, the world effects, the `then:` lines. */
export function optionLines(
  _sim: Sim,
  _card: OpenCard,
  _opt: CardOption,
): EffectLine[] {
  return []
}

/** `{district}` and the pick placeholders filled from the card's refs. */
export function fillCardText(
  _data: GameData,
  text: string,
  _card: CardRefs,
): string {
  return text
}

/** Every key of `cond` holds (a missing cond is true). */
export function condHolds(
  _sim: Sim,
  _cond: EventCond | undefined,
  _card: CardRefs,
): boolean {
  return true
}

/** The `decideEvent` command: answer the open card with option `option`. */
export function decideEvent(
  _sim: Sim,
  _eventId: string,
  _option: number,
): CommandResult {
  return { ok: false, reason: 'no-event' }
}

/** The `debugOfferEvent` command: open (or queue) a deck card now, ignoring its rules. */
export function debugOfferEvent(_sim: Sim, _eventId: string): CommandResult {
  return { ok: false, reason: 'invalid' }
}

/** ?quest= and debug.offerQuest: stub = today's path. */
export function debugOfferJob(sim: Sim, templateId: string): CommandResult {
  return debugOfferQuest(sim, templateId)
}

/** acceptQuest / declineQuest on a quest a job card holds → that card's decision; null = not a card's quest. */
export function resolveJobCommand(
  _sim: Sim,
  _questId: string,
  _choice: 'accept' | 'decline',
): CommandResult | null {
  return null
}
