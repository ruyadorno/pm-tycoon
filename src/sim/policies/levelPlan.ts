// The competent policy's L3+ purchase plan (spec-build2 §7.2 L3-L5 rows;
// design-m8-m9 §5.1), called once per step from the single CompetentPolicy
// class (src/sim/policy.ts — both kinds) after the L2 rule and before
// COUNTERS. Each step walks levels 3..current (capped by the build:
// SIM_FEATURES.levels3plus runs L3 at M8, levels45 adds L4-L5 at M9) and
// the level's steps in order, each level's strain counter first (NEW STRAIN
// FIRST below):
//
//   done        → the next step;
//   impossible  → the next step, re-checked every step: a machine with no
//                 free live slot and no duplicate to replace, the Sorter Arm
//                 with a sorter seated (the `delegating` kind) or below the
//                 station's level, anything above the level;
//   waiting     → stop (balance < price + purchaseBuffer, or no driver
//                 applicant): later steps wait, like the L2 truck → shaker
//                 chain;
//   ready       → act once (one purchase per policy step) and stop.
//
// NEW STRAIN FIRST (policy extension, M9 — docs/decisions.md; B2 §7.2's
// order holds within a level): a level that announces a strain
// (levels.json `strain`) puts its counter — the plan's machine step for a
// checker that level unlocks (levels.json `machines`: the Battery checker
// at L3, the X-ray at L4) — ahead of every step still pending, newest level
// first. When L4 arrives with an L3 step unbought (the van, the 2nd truck),
// the X-ray is bought before it, as a competent player covers a new strain
// before growing the fleet: `dense` spawns newStrainDelayS after the
// announcement against a lane that catches ~91 % of it without the X-ray
// (balance lane, seeds 1-10 × 48 min: lives lost 15 → 7). At L3 the
// Battery checker is already first, so the L3 order is unchanged. The cost
// is on Victory: the van and 2nd truck come ~4 min later, so fewer Golden
// Release wins by 45 min (docs/decisions.md M9 — kept: lives is gated,
// victory informational).
//
// A vehicle's driver fee comes out of the buffer (M6 §5.1: the trigger is
// price + purchaseBuffer, never price + fee + buffer); the picked driver is
// bestApplicant's (highest effective speed for the type).
//
// REPLACE (policy extension, design R9 — docs/decisions.md): with no free
// live slot a plan machine (or desk 2) takes the slot of the LAST machine in
// flow order whose defId occurs at least twice in the live slots — in
// practice COUNTERS' 2nd Metal detector in slot 3 at L3 — removed for
// removalRefund × its price and bought into in the same step, only when
// balance + refund ≥ price + purchaseBuffer. A desk is never replaced.
//
// Desk 2 (B2 §7.2 L3 row): placeNextDesk is the dock-blocked inspector
// rule's fallback (policy.ts #inspectors) when every placed desk is full —
// the next employees.json desks.rows row the level allows, into a free live
// slot or the REPLACE slot, at price + purchaseBuffer; the same step then
// seats the best `eye` applicant there under the one-hire-per-day rule. It
// waits while a plan machine step is pending (waiting / ready): like
// COUNTERS, a desk never takes the slot a plan machine needs (M8 review:
// desk 2 in the REPLACE slot left the Battery checker — B2 §7.2's first L3
// purchase — impossible for the rest of the run).
//
// The Sorter Arm (B2 §7.2 L4 row "Sorter Arm (into the empty station)";
// design-m8-m9 §7 M9 item 3; policy extension, docs/decisions.md): once
// the Arm holds the Hold Bay station the competent policy leaves the bay to
// it — the Arm Tosses every held parcel autoTossDelayS after it arrives
// (sorter.ts armStep, `source: 'arm'`), the same Toss-everything outcome 3 s
// later — and hand-Tosses only while every bay is taken, so a full bay never
// stalls the lane (armHoldsBay). Before the Arm (L1-L3, or with a sorter in
// the station) the policy Tosses every flag on the tick it is held, as in
// playtest 1.
//
// L5 (B2 §7.2 "accept the Golden Release; 3rd truck; counters"): the accept
// is questPolicyStep's accept-every-offer rule (policy.ts, M7 — the
// ultimate as soon as no quest is active); the plan holds the 3rd truck;
// COUNTERS fills slot 6 once it is bought.
//
// Pure sim code (tools/check-sim-purity.mjs): reads sim.state, acts only
// through sim.dispatch. No import of policy.ts (no import cycle).

import { SIM_FEATURES } from '../features.ts'
import type { Sim } from '../sim.ts'
import { SORTER_ARM_ID } from '../systems/sorter.ts'
import type { VehicleType } from '../types.ts'
import { laneNode, liveSlotIds } from '../types.ts'
import { bestApplicant } from './applicants.ts'

export type PlanStep =
  | { kind: 'machine'; defId: string }
  | { kind: 'dock'; index: number }
  /** Own at least `count` vehicles of `type` (the purchase picks the best driver). */
  | { kind: 'vehicle'; type: VehicleType; count: number }
  /** The Sorter Arm into the empty Hold Bay station (machines.json upgrades). */
  | { kind: 'sorterArm' }

/** B2 §7.2: the purchases of each level, in order (counters follow in policy.ts). */
export const LEVEL_PLAN: Readonly<Record<number, readonly PlanStep[]>> = {
  3: [
    { kind: 'machine', defId: 'battery_checker' },
    { kind: 'dock', index: 2 },
    { kind: 'vehicle', type: 'van', count: 1 },
    { kind: 'vehicle', type: 'truck', count: 2 },
  ],
  4: [
    { kind: 'machine', defId: 'xray' },
    { kind: 'dock', index: 3 },
    { kind: 'sorterArm' },
    { kind: 'vehicle', type: 'van', count: 2 },
  ],
  5: [{ kind: 'vehicle', type: 'truck', count: 3 }],
}

/** The first level LEVEL_PLAN covers (L1-L2 are policy.ts's own rules). */
export const PLAN_FIRST_LEVEL = 3

/** What a plan step needs now. */
export type StepStatus = 'done' | 'impossible' | 'waiting' | 'ready'

/** The last plan level this build runs: 5 with levels45 (M9), 3 with levels3plus (M8), else 2 (no plan). */
export function planMaxLevel(
  features: { levels3plus: boolean; levels45: boolean } = SIM_FEATURES,
): number {
  if (!features.levels3plus) return PLAN_FIRST_LEVEL - 1
  return features.levels45 ? 5 : PLAN_FIRST_LEVEL
}

/**
 * The step of `level`'s plan that counters the strain the level announces
 * (NEW STRAIN FIRST, see the header): a machine step for a checker listed in
 * the level's levels.json `machines`, when the row has a `strain`; else null.
 */
export function strainCounterStep(sim: Sim, level: number): PlanStep | null {
  const row = sim.data.levels.find((r) => r.level === level)
  if (!row || row.strain === null) return null
  const checkers = new Set(sim.data.machines.checkers.map((c) => c.id))
  return (
    (LEVEL_PLAN[level] ?? []).find(
      (st) =>
        st.kind === 'machine' &&
        checkers.has(st.defId) &&
        row.machines.includes(st.defId),
    ) ?? null
  )
}

/**
 * The plan steps of levels 3..min(current level, planMaxLevel()): each
 * level's strain counter first, newest level first (NEW STRAIN FIRST), then
 * every other step in level order (B2 §7.2's order within a level).
 */
export function planSteps(sim: Sim): PlanStep[] {
  const top = Math.min(sim.state.level.level, planMaxLevel())
  const counters: PlanStep[] = []
  const rest: PlanStep[] = []
  for (let l = PLAN_FIRST_LEVEL; l <= top; l++) {
    const counter = strainCounterStep(sim, l)
    if (counter) counters.unshift(counter)
    rest.push(...(LEVEL_PLAN[l] ?? []).filter((st) => st !== counter))
  }
  return [...counters, ...rest]
}

/** A slot a purchase can go into: an empty live slot, or the REPLACE slot and its refund. */
export interface SlotPick {
  nodeId: string
  replace: boolean
  refund: number
}

/**
 * REPLACE (see the header): the last live slot in flow order holding a
 * machine whose defId occurs ≥ 2 times in the live slots, with the refund
 * its removal pays (removeFixture's rounding); null with no duplicate.
 */
export function replaceSlot(sim: Sim): SlotPick | null {
  const lane = sim.state.lane
  const machines = liveSlotIds(lane).flatMap((id) => {
    const f = laneNode(lane, id)?.fixture
    return f?.kind === 'machine'
      ? [{ nodeId: id, defId: f.checker.defId, price: f.checker.price }]
      : []
  })
  for (let i = machines.length - 1; i >= 0; i--) {
    const m = machines[i]
    if (!m) continue
    if (machines.filter((x) => x.defId === m.defId).length < 2) continue
    return {
      nodeId: m.nodeId,
      replace: true,
      refund: Math.round(m.price * sim.data.machines.removalRefund),
    }
  }
  return null
}

/** The first empty live slot, else the REPLACE slot; null when neither exists. */
export function slotForPurchase(sim: Sim): SlotPick | null {
  const lane = sim.state.lane
  const empty = liveSlotIds(lane).find((id) => !laneNode(lane, id)?.fixture)
  if (empty !== undefined) return { nodeId: empty, replace: false, refund: 0 }
  return replaceSlot(sim)
}

function ownsMachine(sim: Sim, defId: string): boolean {
  return sim.state.lane.nodes.some(
    (n) => n.fixture?.kind === 'machine' && n.fixture.checker.defId === defId,
  )
}

/** A step's status at `buffer` (purchaseBuffer); `waiting`/`ready` only for steps not done. */
export function stepStatus(
  sim: Sim,
  step: PlanStep,
  buffer: number,
): StepStatus {
  const s = sim.state
  const level = s.level.level
  const balance = s.economy.balance
  switch (step.kind) {
    case 'machine': {
      const def = sim.data.machines.checkers.find((c) => c.id === step.defId)
      if (!def || def.unlockLevel > level) return 'impossible'
      if (ownsMachine(sim, def.id)) return 'done'
      const pick = slotForPurchase(sim)
      if (!pick) return 'impossible'
      // buyMachine spends a quest voucher before money.
      const price = s.quests.vouchers.includes(def.id) ? 0 : def.price
      return balance + pick.refund >= price + buffer ? 'ready' : 'waiting'
    }
    case 'dock': {
      const row = sim.data.economy.docks.find((r) => r.index === step.index)
      if (!row || row.unlockLevel > level) return 'impossible'
      if (s.lane.docks.some((d) => d.id === `dock${row.index}`)) return 'done'
      return balance >= row.price + buffer ? 'ready' : 'waiting'
    }
    case 'vehicle': {
      const def = sim.data.vehicles.types.find((t) => t.id === step.type)
      if (!def || def.unlockLevel > level) return 'impossible'
      const owned = s.vehicles.filter((v) => v.type === def.id).length
      if (owned >= step.count) return 'done'
      if (!bestApplicant(sim, 'driver', def.id)) return 'waiting'
      return balance >= def.price + buffer ? 'ready' : 'waiting'
    }
    case 'sorterArm': {
      const up = sim.data.machines.upgrades.find((u) => u.id === SORTER_ARM_ID)
      if (!up || up.unlockLevel > level) return 'impossible'
      if (level < sim.data.employees.holdStation.unlockLevel) {
        return 'impossible'
      }
      const f = s.lane.holdStation.fixture
      if (f === SORTER_ARM_ID) return 'done'
      if (f !== null) return 'impossible' // a sorter holds the station
      return balance >= up.price + buffer ? 'ready' : 'waiting'
    }
  }
}

/** Into `pick`: a REPLACE removes the duplicate first. False when a command failed. */
function intoSlot(
  sim: Sim,
  pick: SlotPick,
  buy: (nodeId: string) => boolean,
): boolean {
  if (pick.replace) {
    const res = sim.dispatch({ kind: 'removeFixture', nodeId: pick.nodeId })
    if (!res.ok) return false
  }
  return buy(pick.nodeId)
}

/** Buy what a `ready` step needs (one purchase). False when the command failed. */
function actStep(sim: Sim, step: PlanStep): boolean {
  switch (step.kind) {
    case 'machine': {
      const pick = slotForPurchase(sim)
      if (!pick) return false
      return intoSlot(
        sim,
        pick,
        (nodeId) =>
          sim.dispatch({ kind: 'buyMachine', defId: step.defId, nodeId }).ok,
      )
    }
    case 'dock':
      return sim.dispatch({ kind: 'buyDock', index: step.index }).ok
    case 'vehicle': {
      const a = bestApplicant(sim, 'driver', step.type)
      if (!a) return false
      return sim.dispatch({
        kind: 'buyVehicle',
        type: step.type,
        applicantId: a.id,
      }).ok
    }
    case 'sorterArm':
      return sim.dispatch({
        kind: 'buyMachine',
        defId: SORTER_ARM_ID,
        nodeId: sim.state.lane.holdBayNodeId,
      }).ok
  }
}

/**
 * One policy step of the plan: skips done / impossible steps, stops at the
 * first unaffordable one (`waiting`), else buys it (`acted`); `done` when
 * every possible step of levels ≤ current is done.
 */
export function levelPlanStep(
  sim: Sim,
  buffer: number,
): 'done' | 'waiting' | 'acted' {
  for (const step of planSteps(sim)) {
    const st = stepStatus(sim, step, buffer)
    if (st === 'done' || st === 'impossible') continue
    if (st === 'waiting') return 'waiting'
    return actStep(sim, step) ? 'acted' : 'waiting'
  }
  return 'done'
}

/** Every possible plan step of levels ≤ current is done (COUNTERS may use a free slot). */
export function levelPlanDone(sim: Sim): boolean {
  return planSteps(sim).every((step) => {
    const st = stepStatus(sim, step, 0)
    return st === 'done' || st === 'impossible'
  })
}

/**
 * The Sorter Arm holds the Hold Bay station and a bay is still free: the
 * policy leaves the held parcels to the Arm this step (see the header).
 * False without the Arm (a sorter, or nobody, in the station) and while
 * every bay is taken — then the caller Tosses by hand.
 */
export function armHoldsBay(sim: Sim): boolean {
  const lane = sim.state.lane
  if (lane.holdStation.fixture !== SORTER_ARM_ID) return false
  const hold = laneNode(lane, lane.holdBayNodeId)
  return hold !== null && (hold.cap === null || hold.queue.length < hold.cap)
}

/** A plan machine step of levels ≤ current not yet done and still possible: it needs a slot. */
function planMachinePending(sim: Sim): boolean {
  return planSteps(sim).some((step) => {
    if (step.kind !== 'machine') return false
    const st = stepStatus(sim, step, 0)
    return st === 'waiting' || st === 'ready'
  })
}

/**
 * Desk 2 (B2 §7.2 L3 row; see the header): the next employees.json desk row
 * not yet placed whose level is reached, into a free live slot or the
 * REPLACE slot, when balance (+ the refund) ≥ its price + `buffer` and no
 * plan machine step is pending. Called by the dock-blocked inspector rule
 * only when every placed desk is full. True when the desk was placed.
 */
export function placeNextDesk(sim: Sim, buffer: number): boolean {
  const s = sim.state
  const placed = new Set(
    s.lane.nodes.flatMap((n) =>
      n.fixture?.kind === 'desk' ? [n.fixture.index] : [],
    ),
  )
  const row = sim.data.employees.desks.rows.find(
    (r) => !placed.has(r.index) && r.unlockLevel <= s.level.level,
  )
  if (!row || planMachinePending(sim)) return false
  const pick = slotForPurchase(sim)
  if (!pick || s.economy.balance + pick.refund < row.price + buffer) {
    return false
  }
  return intoSlot(
    sim,
    pick,
    (nodeId) =>
      sim.dispatch({ kind: 'placeDesk', nodeId, index: row.index }).ok,
  )
}
