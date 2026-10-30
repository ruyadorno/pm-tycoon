// The config's scripted New game (plan-build2 §8.7 task 3; docs/decisions.md
// M10 "Configs"): `?debug=1&config=<name>` with a `start` recipe
// (src/data/configStart.ts — tycoon.json: L5, a full lane, docks 2–3, a fleet
// with drivers) is played on every fresh player's game — Boot's own new sim
// and each New game (BootScene, before ?level= and ?quest=) — through the
// ViewSim: debug.forceLevel (the logged debugForceLevel command), then the
// ordinary commands a player would tap (placeDesk, buyMachine, hire, buyDock,
// buyVehicle with a driver). Every step is a logged command, so __pm.replay()
// and the save reproduce the game; nothing writes the state directly. The
// money is the config's `economy.startMoney` patch (data, not code).
//
// Fresh = tick 0 with an empty command log (never a Continue, a __pm.load,
// the attract sim — the caller skips it — or a game a ?level= already
// touched). Applicants are picked as the competent policy picks them
// (bestApplicant: inspector → eye, driver → effective speed for the type,
// sorter → judgement), so a seed always builds the same lane and crew. A
// refused step (money short, a slot taken) is reported and warned about,
// never thrown; later steps still run.
//
// Phaser-free (Vitest runs it on a Node sim: tests/boot/config-start.test.ts).

import {
  DESK_SLOT,
  SORTER_STATION,
  type ConfigStart,
} from '../data/configStart.ts'
import { bestApplicant } from '../sim/policies/applicants.ts'
import type { Sim } from '../sim/sim.ts'
import { laneNode, type LaneNode } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'

/** One refused step: what was asked and the sim's reason. */
export interface ConfigStartFailure {
  step: string
  reason: string
}

/** What applyConfigStart did: commands that succeeded, steps refused. */
export interface ConfigStartReport {
  applied: number
  failures: ConfigStartFailure[]
}

/** The desks.rows index the next "desk" slot entry places (lowest unplaced, unlocked). */
function nextDeskIndex(sim: Sim): number | null {
  const s = sim.state
  const placed = new Set(
    s.lane.nodes.flatMap((n) =>
      n.fixture?.kind === 'desk' ? [n.fixture.index] : [],
    ),
  )
  const row = sim.data.employees.desks.rows
    .filter((r) => r.unlockLevel <= s.level.level && !placed.has(r.index))
    .toSorted((a, b) => a.index - b.index)[0]
  return row?.index ?? null
}

/** Seats taken at a desk (walked-out inspectors keep theirs). */
function deskSeats(node: LaneNode): number {
  const f = node.fixture
  return f?.kind === 'desk' ? f.inspectorIds.length + f.walkedOutIds.length : 0
}

/**
 * Play `start` on a fresh game (see the header). null when there is no
 * recipe, the build has no debug facet, or the sim is not fresh.
 */
export function applyConfigStart(
  vs: ViewSim,
  sim: Sim,
  start: ConfigStart | null,
): ConfigStartReport | null {
  if (start === null || !vs.debug) return null
  if (sim.state.tick !== 0 || sim.commandLog.length > 0) return null
  const report: ConfigStartReport = { applied: 0, failures: [] }
  const run = (
    step: string,
    res: { ok: true } | { ok: false; reason: string },
  ): boolean => {
    if (res.ok) report.applied += 1
    else report.failures.push({ step, reason: res.reason })
    return res.ok
  }
  const s = sim.state
  const lane = () => s.lane

  // 1. the level (debugForceLevel: slots, caps, regions, the tier)
  if (start.level > s.level.level)
    run(`level ${start.level}`, vs.debug.forceLevel(start.level))

  // 2. the slots, in lane order
  start.slots.forEach((entry, i) => {
    const id = lane().slotNodeIds[i]
    const node = id === undefined ? null : laneNode(lane(), id)
    if (entry === null) return
    if (!node) {
      report.failures.push({ step: `slot ${i + 1}`, reason: 'invalid' })
      return
    }
    if (entry === DESK_SLOT) {
      if (node.fixture?.kind === 'desk') return
      const index = nextDeskIndex(sim)
      if (index === null) {
        report.failures.push({
          step: `slot ${i + 1} desk`,
          reason: 'desk-locked',
        })
        return
      }
      run(`slot ${i + 1} desk ${index}`, vs.lane.placeDesk(node.id, index))
      return
    }
    const f = node.fixture
    if (f?.kind === 'machine' && f.checker.defId === entry) return
    run(`slot ${i + 1} ${entry}`, vs.lane.buyMachine(entry, node.id))
  })

  // 3. the desks' crews, in slot order (the best eye in today's pool)
  if (start.inspectorsPerDesk > 0) {
    for (const id of lane().slotNodeIds) {
      const node = laneNode(lane(), id)
      if (node?.fixture?.kind !== 'desk') continue
      while (deskSeats(node) < start.inspectorsPerDesk) {
        const a = bestApplicant(sim, 'inspector')
        const step = `inspector at ${node.id}`
        if (!a) {
          report.failures.push({ step, reason: 'no-applicant' })
          break
        }
        if (!run(step, vs.hire('inspector', a.id, { nodeId: node.id }))) break
      }
    }
  }

  // 4. the Hold Bay station
  const hs = start.holdStation
  if (hs !== null && lane().holdStation.fixture === null) {
    if (hs === SORTER_STATION) {
      const a = bestApplicant(sim, 'sorter')
      if (!a) report.failures.push({ step: 'sorter', reason: 'no-applicant' })
      else run('sorter', vs.hire('sorter', a.id, { station: 'hold' }))
    } else {
      run(hs, vs.lane.buyMachine(hs, lane().holdBayNodeId))
    }
  }

  // 5. the loading docks
  for (const index of start.docks) {
    if (lane().docks.some((d) => d.id === `dock${index}`)) continue
    run(`dock ${index}`, vs.lane.buyDock(index))
  }

  // 6. the fleet, each vehicle with the best driver for its type
  for (const { type, count } of start.fleet) {
    let have = s.vehicles.filter((v) => v.type === type).length
    while (have < count) {
      const a = bestApplicant(sim, 'driver', type)
      if (!run(`${type} ${have + 1}`, vs.buyVehicle(type, a?.id ?? null))) break
      have += 1
    }
  }

  for (const f of report.failures)
    console.warn(`config start: ${f.step} refused (${f.reason})`)
  return report
}
