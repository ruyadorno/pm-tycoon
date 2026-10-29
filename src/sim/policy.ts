// The scripted "competent" player of spec §7 (plan.md §6.9.2), used by
// `vlr sim` / the gate and by ?policy=1 in the browser. The CLI and the
// stepper call step() once before every tick from tick 0; it reads sim.state
// and acts only through sim.dispatch (so the command log replays it). Every
// decision is derived from the state, never from private memory, so a policy
// attached to a loaded game picks up where the state is.
//
//   opening A (§7.1): a bike + a Metal detector at t = 0;
//   another bike whenever balance ≥ price + purchaseBuffer, until maxBikes;
//   at L2 the truck at price + purchaseBuffer, then the Shaky shaker
//     (SIM_FEATURES.levels — no-op until M3, the level never moves before);
//   a 2nd (then 3rd) inspector when the lane stalled > stallHireS in the
//     current day, one hire per day (SIM_FEATURES.payroll — M3);
//   Toss every flag on the tick it is held (SIM_FEATURES.lane, M2): the
//     step before the next tick tosses every parcel in the Hold Bay, so a
//     Hold Bay stall never builds under the policy;
//   home zones stay `any`.
// Prices come from src/data; the buffer and the counts are the policy's own
// parameters (spec §7 wording), not balance numbers.

import type { CheckerDef, VehicleTypeDef } from '../data/types.ts'
import { SIM_FEATURES } from './features.ts'
import type { Policy, PolicyKind, Sim } from './sim.ts'
import { laneNode, liveSlotIds, TICKS_PER_DAY } from './types.ts'

export const POLICY_PARAMS = {
  /** "another bike whenever balance ≥ price + $50 buffer" (spec §7). */
  purchaseBuffer: 50,
  /** "… until 3 bikes". */
  maxBikes: 3,
  /** "a 2nd (then 3rd) inspector when the lane stalls > 10 s in a day". */
  stallHireS: 10,
  /** Opening A's machine and the L2 one (machines.json ids). */
  openingMachine: 'metal_detector',
  level2Machine: 'shaky_shaker',
} as const

function typeDef(sim: Sim, id: string): VehicleTypeDef | null {
  return sim.data.vehicles.types.find((t) => t.id === id) ?? null
}

function machineDef(sim: Sim, id: string): CheckerDef | null {
  return sim.data.machines.checkers.find((c) => c.id === id) ?? null
}

function ownsMachine(sim: Sim, defId: string): boolean {
  return sim.state.lane.nodes.some(
    (n) => n.fixture?.kind === 'machine' && n.fixture.checker.defId === defId,
  )
}

function firstEmptySlot(sim: Sim): string | null {
  const lane = sim.state.lane
  return liveSlotIds(lane).find((id) => !laneNode(lane, id)?.fixture) ?? null
}

class CompetentPolicy implements Policy {
  readonly name = 'competent'
  readonly #sim: Sim

  constructor(sim: Sim) {
    this.#sim = sim
  }

  step(): void {
    const sim = this.#sim
    if (sim.state.economy.gameOver) return
    this.#opening()
    this.#bikes()
    if (SIM_FEATURES.levels) this.#level2()
    if (SIM_FEATURES.payroll) this.#inspectors()
    if (SIM_FEATURES.lane) this.#tossEverything()
  }

  #balance(): number {
    return this.#sim.state.economy.balance
  }

  #buyVehicle(type: string): boolean {
    const def = typeDef(this.#sim, type)
    if (!def) return false
    return this.#sim.dispatch({ kind: 'buyVehicle', type: def.id }).ok
  }

  #buyMachine(defId: string): boolean {
    const slot = firstEmptySlot(this.#sim)
    if (!slot) return false
    return this.#sim.dispatch({ kind: 'buyMachine', defId, nodeId: slot }).ok
  }

  /** Opening A: the first bike, then the Metal detector (spec §7.1). */
  #opening(): void {
    const sim = this.#sim
    const bike = typeDef(sim, 'bike')
    if (
      bike &&
      sim.state.vehicles.length === 0 &&
      this.#balance() >= bike.price
    ) {
      this.#buyVehicle('bike')
    }
    const md = machineDef(sim, POLICY_PARAMS.openingMachine)
    if (
      md &&
      md.unlockLevel <= sim.state.level.level &&
      !ownsMachine(sim, md.id) &&
      this.#balance() >= md.price
    ) {
      this.#buyMachine(md.id)
    }
  }

  /** Another bike at price + buffer until maxBikes (spec §7). */
  #bikes(): void {
    const sim = this.#sim
    const bike = typeDef(sim, 'bike')
    if (!bike) return
    const bikes = sim.state.vehicles.filter((v) => v.type === 'bike').length
    if (bikes === 0 || bikes >= POLICY_PARAMS.maxBikes) return
    if (this.#balance() >= bike.price + POLICY_PARAMS.purchaseBuffer) {
      this.#buyVehicle('bike')
    }
  }

  /** At L2: the truck at price + buffer, then the Shaky shaker (spec §7, M3). */
  #level2(): void {
    const sim = this.#sim
    const truck = typeDef(sim, 'truck')
    if (!truck || sim.state.level.level < truck.unlockLevel) return
    const hasTruck = sim.state.vehicles.some((v) => v.type === 'truck')
    if (!hasTruck) {
      if (this.#balance() >= truck.price + POLICY_PARAMS.purchaseBuffer) {
        this.#buyVehicle('truck')
      }
      return
    }
    const shaker = machineDef(sim, POLICY_PARAMS.level2Machine)
    if (
      shaker &&
      shaker.unlockLevel <= sim.state.level.level &&
      !ownsMachine(sim, shaker.id) &&
      this.#balance() >= shaker.price + POLICY_PARAMS.purchaseBuffer
    ) {
      this.#buyMachine(shaker.id)
    }
  }

  /** A 2nd / 3rd inspector after > stallHireS of stall in the day (spec §7, M3). */
  #inspectors(): void {
    const sim = this.#sim
    const s = sim.state
    if (s.lane.stallSecondsToday <= POLICY_PARAMS.stallHireS) return
    const dayStart = s.day * TICKS_PER_DAY
    const hiredToday = s.employees.some(
      (e) =>
        e.kind === 'inspector' && e.hiredTick >= dayStart && e.hiredTick > 0,
    )
    if (hiredToday) return
    const desk = s.lane.nodes.find((n) => n.fixture?.kind === 'desk')
    if (!desk || desk.fixture?.kind !== 'desk') return
    const max = sim.data.employees.inspector.maxPerDesk
    if (desk.fixture.inspectorIds.length >= max) return
    if (this.#balance() < sim.data.employees.inspector.hireFee) return
    sim.dispatch({ kind: 'hireInspector' })
  }

  /** Toss every held parcel (spec §7, M2). */
  #tossEverything(): void {
    const sim = this.#sim
    const hold = laneNode(sim.state.lane, sim.state.lane.holdBayNodeId)
    for (const parcelId of (hold?.queue ?? []).slice()) {
      sim.dispatch({ kind: 'toss', parcelId })
    }
  }
}

/** The PolicyFactory the CLI and BootScene load (sim.ts `PolicyFactory`). */
export function createPolicy(sim: Sim, kind: PolicyKind): Policy {
  if (kind !== 'competent') throw new Error(`unknown policy ${String(kind)}`)
  return new CompetentPolicy(sim)
}
