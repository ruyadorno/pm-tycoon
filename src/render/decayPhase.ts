// Waiting-parcel decay phase (city-view.md §1.3, §5.1, §5.2; spec-core.md
// §5.3, §9.1). Pure — no Phaser, no DOM (tools/check-sim-purity.mjs), so
// Vitest loads it under Node. The thresholds always come from parcels.json
// (`decay.graceS`, `onTimeMaxS`); this file holds no balance number.
//
// Spec §5.3: value(t) = base × f(t), f = 1 while t ≤ graceS, then falling;
// on-time ⇔ t ≤ onTimeMaxS (f ≥ 0.75). The three badge phases follow it:
//   plain  t ≤ graceS                 nothing lost yet
//   amber  graceS < t ≤ onTimeMaxS    value falling, still on time
//   red    t > onTimeMaxS             it would already be late

/** The parcels.json fields the phase needs (ParcelsData is a superset). */
export interface DecayThresholds {
  decay: { graceS: number; floorAtS: number; floor: number }
  onTimeMaxS: number
}

export type DecayPhase = 'plain' | 'amber' | 'red'

/** Phase of a parcel `ageS` sim seconds after spawn. */
export function decayPhase(ageS: number, p: DecayThresholds): DecayPhase {
  if (ageS <= p.decay.graceS) return 'plain'
  if (ageS <= p.onTimeMaxS) return 'amber'
  return 'red'
}

/** f(t) of spec §5.3: 1 in the grace window, linear to the floor, then flat. */
export function valueFactor(ageS: number, p: DecayThresholds): number {
  const { graceS, floorAtS, floor } = p.decay
  if (ageS <= graceS) return 1
  if (ageS >= floorAtS) return floor
  return 1 - ((1 - floor) * (ageS - graceS)) / (floorAtS - graceS)
}

/** Tooltip / district-panel suffix for the oldest parcel's age (city-view §5.2). */
export function phaseSuffix(phase: DecayPhase): string {
  if (phase === 'amber') return ' (falling)'
  if (phase === 'red') return ' (late)'
  return ''
}

/** "m:ss" for a duration in seconds (floored, never negative). */
export function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
