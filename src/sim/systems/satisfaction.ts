// District satisfaction (spec §9.1-§9.4). Every delta and cap comes from
// economy.json `satisfaction`:
//   on-time delivery +onTime (destination), by the favoured vehicle
//   +favouredBonus, pickup by the favoured vehicle +favouredPickup (origin) —
//   the positive rows, capped together at +positiveCapPerDay per district per
//   in-game day; late −late; a waiting parcel crossing waitingPenaltyAfterS
//   unpicked −waitingOver180s, capped at waitingPenaltyCapPerDay per district
//   per day;
//   malware delivered −malwareDelivered; drift driftStep per day toward
//   driftPerDayToward. Clamped to [min, max]. m(s) of §9.3 scales the spawn
//   interval; the HUD mood is the mean of live districts (types.ts).

import type { Sim } from '../sim.ts'
import { districtDef } from '../map.ts'
import type { DistrictId } from '../types.ts'
import { ticksFromS } from '../types.ts'

export type SatisfactionKind = 'positive' | 'waiting' | 'other'

/**
 * Spec §9.3 m(s): linear from intervalMultAt0 at `min` to intervalMultAt50 at
 * the midpoint, then to intervalMultAt100 at `max` (1.5 → 1.0 → 0.6).
 */
export function spawnMultiplier(sim: Sim, s: number): number {
  const c = sim.data.economy.satisfaction
  const mid = (c.min + c.max) / 2
  if (s <= mid) {
    const t = (Math.max(c.min, s) - c.min) / (mid - c.min)
    return c.intervalMultAt0 + (c.intervalMultAt50 - c.intervalMultAt0) * t
  }
  const t = (Math.min(c.max, s) - mid) / (c.max - mid)
  return c.intervalMultAt50 + (c.intervalMultAt100 - c.intervalMultAt50) * t
}

/**
 * Apply one §9.1 delta to a live district (hubs have no satisfaction):
 * positives share the daily positive cap, waiting penalties the daily
 * waiting cap; the result is clamped and `satisfaction:changed` fires with
 * the delta actually applied (nothing fires when caps eat it all).
 */
export function changeSatisfaction(
  sim: Sim,
  districtId: DistrictId,
  delta: number,
  kind: SatisfactionKind,
): number {
  const st = sim.state.districts[districtId]
  if (!st || !st.live || delta === 0) return 0
  if (districtDef(sim.data, districtId).kind !== 'district') return 0
  const c = sim.data.economy.satisfaction
  let d = delta
  if (kind === 'positive' && d > 0) {
    d = Math.min(d, Math.max(0, c.positiveCapPerDay - st.dayPositive))
    st.dayPositive += d
  } else if (kind === 'waiting' && d < 0) {
    d = Math.max(
      d,
      Math.min(0, c.waitingPenaltyCapPerDay - st.dayWaitingPenalty),
    )
    st.dayWaitingPenalty += d
  }
  const next = Math.min(c.max, Math.max(c.min, st.satisfaction + d))
  const applied = next - st.satisfaction
  if (applied === 0) return 0
  st.satisfaction = next
  sim.emit('satisfaction:changed', {
    district: districtId,
    value: next,
    delta: applied,
  })
  return applied
}

/**
 * Tick step 9 (plan.md §6.4): every parcel still waiting at its origin
 * (reserved or not — it is unpicked) crossing waitingPenaltyAfterS
 * (economy.json, run decision Q-RUN2) this tick costs
 * the origin district the capped penalty. Each parcel crosses exactly once.
 */
export function waitingStep(sim: Sim): void {
  const s = sim.state
  const c = sim.data.economy.satisfaction
  const threshold = ticksFromS(c.waitingPenaltyAfterS)
  const delta = c.waitingOver180s
  for (const b of sim.data.buildings) {
    const waiting = s.buildings[b.id]?.waiting
    if (!waiting || waiting.length === 0) continue
    for (const id of waiting) {
      const p = s.parcels[String(id)]
      if (p && s.tick - p.spawnedTick === threshold) {
        changeSatisfaction(sim, b.district, delta, 'waiting')
      }
    }
  }
}

/** Day boundary (§9.1 drift): every live district moves driftStep toward the target. */
export function driftStep(sim: Sim): void {
  const c = sim.data.economy.satisfaction
  for (const d of sim.data.districts) {
    const st = sim.state.districts[d.id]
    if (d.kind !== 'district' || !st?.live) continue
    const gap = c.driftPerDayToward - st.satisfaction
    if (gap === 0) continue
    const step = Math.sign(gap) * Math.min(Math.abs(gap), c.driftStep)
    changeSatisfaction(sim, d.id, step, 'other')
  }
}
