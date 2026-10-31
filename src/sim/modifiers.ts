// Modifiers (spec-build3 §3.6; M11 contract §2.8, D-3, D-24, D-35): the pure
// fold of state.modifiers. A row is live while its untilTick is null
// (permanent) or above state.tick; a key folds the live rows whose scope is
// null or the asked scope — mult keys multiply, add keys sum — and the
// result is clamped to events.json modifiers.bounds[key] (the FOLD clamp;
// result clamps such as the desk p floor live at the read sites). No cache:
// decisions are commands between ticks, so an O(rows) fold with an empty
// fast path is the whole cost (D-3). Mutations (apply / end / expire) are
// in systems/modifierOps.ts so this file imports types only (D-35).
//
// M11 wave 0: the stubs fold to the identity (no rows ever exist yet);
// stream A implements the fold.

import type { GameData, ModifierKey } from '../data/types.ts'
import type { Checker, Modifier, SimState, Tick } from './types.ts'

/** Anything with the state and the tables (Sim, people.ts SimLike, a ViewSim's sim). */
export type ModCtx = { readonly state: SimState; readonly data: GameData }

/** Keys whose rows multiply (`mult`; 1 = no change). */
export const MULT_KEYS = [
  'speed',
  'stop',
  'processS',
  'payrollMult',
  'income',
  'spawn',
  'tossBounty',
  'wrongTossFee',
  'vehiclePrice',
  'machinePrice',
  'clearanceS',
] as const satisfies readonly ModifierKey[]
/** Keys whose rows add (`add`; 0 = no change). */
export const ADD_KEYS = [
  'inspectorP',
  'machineP',
  'malwareShare',
  'decoyShare',
  'onTimeMaxS',
  'shelfCap',
  'payrollAdd',
] as const satisfies readonly ModifierKey[]
export type MultKey = (typeof MULT_KEYS)[number]
export type AddKey = (typeof ADD_KEYS)[number]

/** Π mult of the live rows of `key` whose scope is null or `scope`, clamped to bounds; 1 with no rows. */
export function modMult(
  _ctx: ModCtx,
  _key: MultKey,
  _scope: string | null = null,
): number {
  return 1
}

/** Σ add of those rows, clamped to bounds; 0 with no rows. */
export function modAdd(
  _ctx: ModCtx,
  _key: AddKey,
  _scope: string | null = null,
): number {
  return 0
}

/** round(listPrice × modMult(vehiclePrice | machinePrice)). */
export function priceOf(
  _ctx: ModCtx,
  _kind: 'vehicle' | 'machine',
  listPrice: number,
): number {
  return listPrice
}

/** A machine checker with pMatch/pOther + modAdd('machineP') clamped to modifiers.machinePClamp; desks unchanged. */
export function effChecker(_ctx: ModCtx, c: Checker): Checker {
  return c
}

/** Live = untilTick null or > state.tick. */
export function isLive(m: Modifier, tick: Tick): boolean {
  return m.untilTick === null || m.untilTick > tick
}
