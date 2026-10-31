// The event policy (spec-build3 §3.8; M11 contract §3 stream D, D-37, D-38):
// the competent policy's card answers — every visible, affordable option is
// scored in dollars and the best one taken (ties → the default, then the
// lowest index); the tally feeds the gate's EV and non-default rows.
//
// M11 wave 0: inert stubs with their final signatures; stream D implements
// them.

import type { EventDef, EventOptionDef, GameData } from '../../data/types.ts'
import type { Sim } from '../sim.ts'
import type { CardOption } from '../systems/deck.ts'
import type { OpenCard } from '../types.ts'

/** Metrics-only running totals over decision cards (never read by the sim). */
export interface PolicyTally {
  decisions: number
  evSum: number
  nonDefault: number
}

export function newTally(): PolicyTally {
  return { decisions: 0, evSum: 0, nonDefault: 0 }
}

/** An option's score in dollars now (−Infinity = it takes the last life). */
export function scoreOption(
  _sim: Sim,
  _card: OpenCard,
  _opt: CardOption,
): number {
  return 0
}

/** State-free part of an option's score (schema evMax test, deckEvMean). */
export function staticScore(
  _data: GameData,
  _def: EventDef,
  _opt: EventOptionDef,
): number {
  return 0
}

/** Answer the open card, if any (the competent policy's first step). */
export function eventPolicyStep(_sim: Sim, _tally: PolicyTally): void {}
