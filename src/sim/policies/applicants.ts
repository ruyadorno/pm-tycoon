// The competent policy's applicant pick (spec-build2 §7.2 L1 row; design-m6
// §5.1, D20), shared by src/sim/policy.ts (which re-exports it) and the L3+
// plan (policies/levelPlan.ts). A leaf module: it imports no policy code, so
// the policy import graph has no cycle.

import type { Sim } from '../sim.ts'
import { salaryOf } from '../systems/people.ts'
import type { Applicant, Role, VehicleType } from '../types.ts'

/**
 * The best applicant waiting in a pool (spec-build2 §7.2, design §5.1):
 * inspector → highest eye, driver → highest effective speed pip for `type`
 * (affinity counted, design D20), sorter → highest judgement; ties → lowest
 * salary (a driver's for `type`) → lowest applicant id. Null with an empty pool.
 */
export function bestApplicant(
  sim: Sim,
  role: Role,
  type: VehicleType = 'bike',
): Applicant | null {
  const data = sim.data
  const affinityPips = data.employees.roles.driver.affinityPips
  const score = (a: Applicant): number => {
    if (role === 'inspector') return a.pips.eye ?? 0
    if (role === 'sorter') return a.pips.judgement ?? 0
    const bonus = a.affinity === type ? affinityPips : 0
    return Math.min(5, (a.pips.speed ?? 0) + bonus)
  }
  const salary = (a: Applicant): number =>
    salaryOf(data, role, a.pips, role === 'driver' ? type : undefined)
  let best: Applicant | null = null
  for (const a of sim.state.applicants[role]) {
    if (
      best === null ||
      score(a) > score(best) ||
      (score(a) === score(best) &&
        (salary(a) < salary(best) ||
          (salary(a) === salary(best) && a.id < best.id)))
    ) {
      best = a
    }
  }
  return best
}
