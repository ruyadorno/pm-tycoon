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
// The read sites (B3 §3.6) each call modMult / modAdd once: vehicles.ts
// speedPerTick (speed, by vehicle type), dispatch.ts stopTicks (stop),
// people.ts syncDesk / effectiveP and detection.ts fiveEyeP (inspectorP),
// effChecker below (machineP), lane.ts seat and detection.ts
// laneRatePerMin (processS, by fixture kind), payroll.ts paydayStep /
// payrollDuePerDay (payrollMult, payrollAdd), economy.ts deliverParcel and
// hubs.ts handOff (income), spawn.ts (malwareShare via types.ts
// malwareShare's `extra`, decoyShare, spawn by district), holdbay.ts
// tossParcel (tossBounty, wrongTossFee), priceOf below (vehiclePrice,
// machinePrice), economy.ts / hubs.ts isOnTime (onTimeMaxS), hubs.ts
// handOff (clearanceS, by hub) and levels.ts syncShelfCap (shelfCap).

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

/**
 * The fold of `key`: the live rows (isLive) whose scope is null or `scope`,
 * multiplied (`mult`) or summed (`add`), clamped to events.json
 * modifiers.bounds[key] (D-24: the bound clamps the fold, not the result).
 * No matching row → the identity, unclamped (so build 2's numbers are the
 * exact mult 1 / add 0 case whatever the bounds say). A `mult` of 0 folds
 * to 0 (payrollMult, tossBounty, wrongTossFee ×0) — never NaN.
 */
function fold(
  ctx: ModCtx,
  key: ModifierKey,
  scope: string | null,
  kind: 'mult' | 'add',
): number {
  const rows = ctx.state.modifiers
  const identity = kind === 'mult' ? 1 : 0
  if (rows.length === 0) return identity // fast path (D-3)
  const tick = ctx.state.tick
  let v = identity
  let hit = false
  for (const r of rows) {
    if (r.key !== key || !isLive(r, tick)) continue
    if (r.scope !== null && r.scope !== scope) continue
    hit = true
    if (kind === 'mult') v *= r.mult
    else v += r.add
  }
  if (!hit) return identity
  const [lo, hi] = ctx.data.events.modifiers.bounds[key]
  return Math.min(hi, Math.max(lo, v))
}

/** Π mult of the live rows of `key` whose scope is null or `scope`, clamped to bounds; 1 with no rows. */
export function modMult(
  ctx: ModCtx,
  key: MultKey,
  scope: string | null = null,
): number {
  return fold(ctx, key, scope, 'mult')
}

/** Σ add of those rows, clamped to bounds; 0 with no rows. */
export function modAdd(
  ctx: ModCtx,
  key: AddKey,
  scope: string | null = null,
): number {
  return fold(ctx, key, scope, 'add')
}

/**
 * What a purchase costs now: round(listPrice × modMult(vehiclePrice |
 * machinePrice)) — commands.ts buyVehicle / buyMachine debit and store it
 * (Vehicle.purchasePrice, Checker.price), so the refunds follow the price
 * paid; the BuySheet, the Garage and the policy read the same number. The
 * Sorter Arm is not a machine here (D-21).
 */
export function priceOf(
  ctx: ModCtx,
  kind: 'vehicle' | 'machine',
  listPrice: number,
): number {
  const m = modMult(ctx, kind === 'vehicle' ? 'vehiclePrice' : 'machinePrice')
  return m === 1 ? listPrice : Math.round(listPrice * m)
}

/**
 * The checker a machine rolls with now (B3 §3.6, D-5): pMatch / pOther +
 * modAdd('machineP'), each clamped to modifiers.machinePClamp and rounded to
 * 4 dp (the desk p's precision, people.ts effectiveP) — a copy, the stored
 * Checker is never touched. Desks are unchanged (they take inspectorP
 * through syncDesk), and so is a machine while the fold is 0. Every reader
 * of a machine's p goes through this — the roll (lane.ts), the catch rate
 * (detection.ts laneCatchRate with a ctx: the readouts, the
 * laneRateAtLeast condition, the policy) and the lost-life "what if" — so
 * the dice and every number shown agree.
 */
export function effChecker(ctx: ModCtx, c: Checker): Checker {
  if (c.kind !== 'machine') return c
  const a = modAdd(ctx, 'machineP')
  if (a === 0) return c
  const [lo, hi] = ctx.data.events.modifiers.machinePClamp
  const clamp = (p: number): number =>
    Math.round(Math.min(hi, Math.max(lo, p + a)) * 1e4) / 1e4
  return { ...c, pMatch: clamp(c.pMatch), pOther: clamp(c.pOther) }
}

/** Live = untilTick null or > state.tick. */
export function isLive(m: Modifier, tick: Tick): boolean {
  return m.untilTick === null || m.untilTick > tick
}
