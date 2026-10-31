// Event effects (spec-build3 §3.5; M11 contract §3 stream C): every world
// effect kind an event option can carry (money, lives, satisfaction,
// modifiers, pips, vehicles, staff, the wanted list, parcels, the shelf cap,
// `end`), their generated summary lines, the modifier words, and the
// absence step. The deck-internal kinds (`next`, `flag`, `job`,
// `jobDecline`) are deck.ts's. Every draw an effect makes is on the content
// stream (Sim.eventPicksRng, D-2/D-44).
//
// M11 wave 0: inert stubs with their final signatures; stream C implements
// them.

import type { EventEffect } from '../../data/types.ts'
import type { ModCtx } from '../modifiers.ts'
import type { Sim } from '../sim.ts'
import type { CardPick, CardRefs, DistrictId, Modifier } from '../types.ts'

/** Who and what an applied effect acts for (the decided card). */
export interface EffectCtx {
  eventId: string
  title: string
  /** The chosen option's label (filled). */
  optionLabel: string
  optionIndex: number
  target: DistrictId | null
  pick: CardPick | null
  chainHeadId: string
  depth: number
}

/** One generated effect line and its tone (gain = good direction, cost = bad). */
export interface EffectLine {
  text: string
  tone: 'cost' | 'gain' | 'neutral'
}

/** Every world kind (all but next / flag / job / jobDecline, which deck.ts applies). */
export function applyEffect(_sim: Sim, _ctx: EffectCtx, e: EventEffect): void {
  // Wave-0 stub: world kinds are inert until stream C lands; the deck kinds
  // never reach this applier.
  if (
    e.kind === 'next' ||
    e.kind === 'flag' ||
    e.kind === 'job' ||
    e.kind === 'jobDecline'
  )
    throw new Error(`effects: ${e.kind} is applied by deck.ts`)
}

/** One line per world effect (deck kinds return no line); state-aware ("(already 5)", "— your last vehicle"). */
export function effectSummary(
  _view: ModCtx,
  _effects: readonly EventEffect[],
  _card: CardRefs & { eventId: string; title: string },
): EffectLine[] {
  return []
}

/** A live modifier as the EffectsCard / ticker words ("bikes ×0.85 speed"). */
export function modifierLine(_view: ModCtx, m: Modifier): string {
  return m.key
}

/** Tick: absences that end now (employees, vehicles). */
export function absenceStep(_sim: Sim): void {}
