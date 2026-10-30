// The `delegating` policy kind (spec-build2 §7.2 L2 row; design-m6 §5.2,
// D8): the competent policy (src/sim/policy.ts, one class for both kinds)
// with the Hold Bay handed to a Sorter, so the run measures what trusting
// the sorter's judgement costs. Its gate rows are informational
// (`vlr sim:delegating` → docs/gate/delegating.*).
//
//   - delegatingHireSorter (called right after REHIRE): from the Hold Bay
//     station's unlock level (employees.json holdStation.unlockLevel), with
//     the station empty, hires the best sorter applicant (the competent
//     pick: highest judgement, ties lowest salary, then lowest id — passed in
//     by policy.ts) once balance ≥ its hire fee + purchaseBuffer;
//   - delegatingHoldBay (in place of Toss-everything): while an ACTIVE
//     sorter holds the station it never Tosses by hand and Clears every held
//     parcel the sorter tagged `looks clean` (Parcel.sorted), stopping at a
//     full shelf (retried next step); the sorter Tosses the rest itself.
//     Returns false with no active sorter seated — at L1 (no station yet)
//     and after a sorter walkout — and the caller Tosses by hand as the
//     competent policy does, so the Hold Bay never stalls the run (D8).
//
// Pure sim code (tools/check-sim-purity.mjs): reads sim.state, acts only
// through sim.dispatch. No import of policy.ts (the class lives there; this
// module stays a leaf so the import graph has no cycle).

import type { Sim } from '../sim.ts'
import { employeeById, hireFeeOf } from '../systems/people.ts'
import type { Applicant } from '../types.ts'
import { laneNode } from '../types.ts'

/** True while an active sorter (not the Sorter Arm, not walked out) holds the station. */
export function sorterOnDuty(sim: Sim): boolean {
  const f = sim.state.lane.holdStation.fixture
  if (typeof f !== 'number') return false
  const e = employeeById(sim.state, f)
  return e !== null && e.role === 'sorter' && e.active
}

/**
 * Hire `best` (the policy's pick from the sorter pool) into the empty Hold
 * Bay station once the station is unlocked and balance ≥ fee + buffer.
 */
export function delegatingHireSorter(
  sim: Sim,
  best: Applicant | null,
  purchaseBuffer: number,
): void {
  const s = sim.state
  if (s.level.level < sim.data.employees.holdStation.unlockLevel) return
  if (s.lane.holdStation.fixture !== null || best === null) return
  if (s.economy.balance < hireFeeOf(sim.data, best) + purchaseBuffer) return
  sim.dispatch({
    kind: 'hire',
    role: 'sorter',
    applicantId: best.id,
    target: { station: 'hold' },
  })
}

/**
 * The Hold Bay under the delegating policy: with an active sorter seated,
 * Clear every held parcel it tagged `looks clean` (never Toss) and return
 * true; return false (the caller Tosses by hand) with none on duty.
 */
export function delegatingHoldBay(sim: Sim): boolean {
  if (!sorterOnDuty(sim)) return false
  const s = sim.state
  const hold = laneNode(s.lane, s.lane.holdBayNodeId)
  for (const parcelId of (hold?.queue ?? []).slice()) {
    const p = s.parcels[String(parcelId)]
    if (!p || p.state !== 'held' || p.sorted === undefined) continue
    const res = sim.dispatch({ kind: 'clear', parcelId })
    if (!res.ok && res.reason === 'shelf-full') break
  }
  return true
}
