// Parcel value decay (spec §5.3, §7.3; plan.md §6.4: "value decay is never
// stored — valueAt(parcel, tick) computes §5.3 on demand"). Every threshold
// comes from parcels.json: f = 1 up to decay.graceS, linear to decay.floor at
// decay.floorAtS, flat after; on-time ⇔ age ≤ onTimeMaxS (paid ≥ 75 % of base).
// An overseas parcel's value is locked at hand-off (lockedValue, §5.6).

import type { GameData } from '../data/types.ts'
import type { Parcel, Tick } from './types.ts'
import { TICKS_PER_S } from './types.ts'

/** f(t) of spec §5.3 for a parcel `age` sim seconds old. */
export function decayFactor(data: GameData, age: number): number {
  const { graceS, floorAtS, floor } = data.parcels.decay
  if (age <= graceS) return 1
  if (age >= floorAtS) return floor
  return 1 - ((1 - floor) * (age - graceS)) / (floorAtS - graceS)
}

/** Sim seconds since the parcel spawned. */
export function ageS(p: Pick<Parcel, 'spawnedTick'>, tick: Tick): number {
  return (tick - p.spawnedTick) / TICKS_PER_S
}

/** Unrounded value now: base × mult × f(t), or the value locked at hand-off. */
export function valueAt(
  data: GameData,
  p: Pick<Parcel, 'spawnedTick' | 'baseValue' | 'mult' | 'lockedValue'>,
  tick: Tick,
): number {
  if (p.lockedValue !== null) return p.lockedValue
  return p.baseValue * p.mult * decayFactor(data, ageS(p, tick))
}

/** What a delivery pays now (spec §7.3: round(base × f(t)), whole dollars). */
export function paidValue(
  data: GameData,
  p: Pick<Parcel, 'spawnedTick' | 'baseValue' | 'mult' | 'lockedValue'>,
  tick: Tick,
): number {
  return Math.round(valueAt(data, p, tick))
}

/** On time ⇔ age ≤ onTimeMaxS (spec §5.3, §9.1). */
export function isOnTime(data: GameData, age: number): boolean {
  return age <= data.parcels.onTimeMaxS
}

/** The value an overseas hand-off locks (spec §5.6: f sampled at hand-off). */
export function lockValue(
  data: GameData,
  p: Pick<Parcel, 'spawnedTick' | 'baseValue' | 'mult'>,
  tick: Tick,
): number {
  return Math.round(p.baseValue * p.mult * decayFactor(data, ageS(p, tick)))
}
