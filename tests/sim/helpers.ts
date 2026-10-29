// Shared sim test helpers (plan.md §6.9.1): makeSim, runSeconds, collect,
// openingA, dataFixture. Node environment, no Phaser.

import { applyConfig, buildGameData } from '../../src/data/index.ts'
import type { GameData } from '../../src/data/types.ts'
import { onSimEvent } from '../../src/sim/events.ts'
import type { SimEventName, SimEventPayloads } from '../../src/sim/events.ts'
import { Sim } from '../../src/sim/sim.ts'
import { liveSlotIds, laneNode, TICKS_PER_S } from '../../src/sim/types.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'

let shipped: GameData | null = null

/**
 * The shipped tables, validated (cached; sims never mutate GameData), or a
 * fresh copy with a config-style patch deep-merged first
 * (`{economy: {startMoney: 600}}`, arrays by index).
 */
export function dataFixture(overrides?: unknown): GameData {
  if (overrides === undefined) {
    shipped ??= buildGameData(loadRawData())
    return shipped
  }
  return buildGameData(applyConfig(loadRawData(), overrides, 'test overrides'))
}

/** A new game on the shipped (or patched) data. */
export function makeSim(seed = 1, overrides?: unknown): Sim {
  return new Sim(dataFixture(overrides), seed)
}

export function runTicks(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick()
}

/** Advance `s` sim seconds (10 ticks each). */
export function runSeconds(sim: Sim, s: number): void {
  runTicks(sim, Math.round(s * TICKS_PER_S))
}

/** Every payload of `name` emitted from now on (deep copies, in order). */
export function collect<K extends SimEventName>(
  sim: Sim,
  name: K,
): SimEventPayloads[K][] {
  const out: SimEventPayloads[K][] = []
  onSimEvent(sim.events, name, (p) => {
    out.push(structuredClone(p))
  })
  return out
}

/** Spec §7.1 opening A: a bike + a Metal detector in the first empty live slot. */
export function openingA(sim: Sim): void {
  const bike = sim.dispatch({ kind: 'buyVehicle', type: 'bike' })
  if (!bike.ok) throw new Error(`openingA: bike refused (${bike.reason})`)
  const lane = sim.state.lane
  const slot = liveSlotIds(lane).find((id) => !laneNode(lane, id)?.fixture)
  if (!slot) throw new Error('openingA: no empty slot')
  const md = sim.dispatch({
    kind: 'buyMachine',
    defId: 'metal_detector',
    nodeId: slot,
  })
  if (!md.ok) throw new Error(`openingA: detector refused (${md.reason})`)
}
