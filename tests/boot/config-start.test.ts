// plan-build2 §8.7 task 3: ?config=tycoon's scripted New game
// (src/boot/configStart.ts) on Node sims — L5, the six slots filled in lane
// order, both desks staffed, the Sorter Arm, docks 2-3, a 3/2/3 fleet with
// drivers, money left; only logged commands at tick 0 (debugForceLevel, then
// what a player taps), so the replay matches; the Golden Release is offered on
// the first tick. Not fresh, no debug facet or no recipe → nothing happens; a
// refused step is reported (and warned), never thrown.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyConfigStart } from '../../src/boot/configStart.ts'
import {
  applyConfig,
  buildGameData,
  checkConfigStart,
  configStartOf,
  type ConfigStart,
  type GameData,
} from '../../src/data/index.ts'
import { replay, Sim, stateHash } from '../../src/sim/sim.ts'
import { laneNode } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'

const TYCOON = new URL('../../public/configs/tycoon.json', import.meta.url)

function configured(patch: unknown): {
  data: GameData
  start: ConfigStart
} {
  const data = buildGameData(applyConfig(loadRawData(), patch, 'cfg'))
  const { start, problems } = checkConfigStart(
    configStartOf(patch),
    data,
    'cfg',
  )
  expect(problems).toEqual([])
  return { data, start: start! }
}

const tycoon = (): { data: GameData; start: ConfigStart } =>
  configured(JSON.parse(readFileSync(TYCOON, 'utf8')))

/** A fresh sim with its debug ViewSim, the recipe played on it. */
function played(seed: number, cfg = tycoon()) {
  const sim = new Sim(cfg.data, seed)
  const vs = createViewSim(sim, { debug: true })
  const report = applyConfigStart(vs, sim, cfg.start)
  return { sim, vs, report, ...cfg }
}

/** Lane slot contents as `desk<index>` / the checker id / null. */
function slotContents(sim: Sim): (string | null)[] {
  const lane = sim.state.lane
  return lane.slotNodeIds.map((id) => {
    const f = laneNode(lane, id)?.fixture
    if (!f) return null
    return f.kind === 'desk' ? `desk${f.index}` : f.checker.defId
  })
}

/** Commands a player can dispatch (no debug* kind). */
const PLAYER_KINDS = new Set([
  'placeDesk',
  'buyMachine',
  'hire',
  'buyDock',
  'buyVehicle',
])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('?config=tycoon: the scripted New game (src/boot/configStart.ts)', () => {
  it.each([1, 2, 7])(
    'seed %i: L5, six slots, both desks staffed, the Arm, docks 2-3, a 3/2/3 fleet with drivers, money left',
    (seed) => {
      const { sim, report, data } = played(seed)
      expect(report?.failures).toEqual([])
      const s = sim.state
      expect(s.level.level).toBe(5)
      expect(s.level.slots).toBe(6)
      expect(slotContents(sim)).toEqual([
        'desk1',
        'metal_detector',
        'shaky_shaker',
        'battery_checker',
        'xray',
        'desk2',
      ])
      for (const id of s.lane.slotNodeIds) {
        const f = laneNode(s.lane, id)?.fixture
        if (f?.kind === 'desk') expect(f.inspectorIds).toHaveLength(2)
      }
      expect(s.lane.holdStation.fixture).toBe('sorter_arm')
      expect(s.lane.docks.map((d) => d.id)).toEqual(['dock1', 'dock2', 'dock3'])
      const count = (t: string) => s.vehicles.filter((v) => v.type === t).length
      expect([count('bike'), count('van'), count('truck')]).toEqual([3, 2, 3])
      for (const v of s.vehicles) {
        expect(v.driverId, `${v.name} has a driver`).not.toBeNull()
        expect(v.state).not.toBe('inactive')
      }
      // Audrey + 3 inspectors + 8 drivers; no sorter (the Arm holds the bay).
      const roles = s.employees.map((e) => e.role)
      expect(roles.filter((r) => r === 'inspector')).toHaveLength(4)
      expect(roles.filter((r) => r === 'driver')).toHaveLength(8)
      expect(roles.filter((r) => r === 'sorter')).toHaveLength(0)
      // The money is the config's startMoney minus what the steps cost.
      expect(s.economy.balance).toBeGreaterThan(2_000)
      expect(s.economy.balance).toBeLessThan(data.economy.startMoney)
      expect(s.economy.lives).toBe(data.economy.lives.start)
      expect(s.economy.gameOver).toBe(false)
    },
  )

  it('logs debugForceLevel then only player commands, all at tick 0; the replay matches', () => {
    const { sim, report, data } = played(7)
    const log = sim.commandLog
    expect(report?.applied).toBe(log.length)
    expect(log[0]).toEqual({
      tick: 0,
      cmd: { kind: 'debugForceLevel', level: 5 },
    })
    for (const e of log.slice(1)) {
      expect(e.tick).toBe(0)
      expect(PLAYER_KINDS.has(e.cmd.kind), e.cmd.kind).toBe(true)
    }
    // 1 level + 5 slots + 3 inspectors + the Arm + 2 docks + 8 vehicles.
    expect(log).toHaveLength(20)
    for (let i = 0; i < 300; i++) sim.tick()
    const again = replay(data, 7, log, sim.state.tick)
    expect(stateHash(again.state)).toBe(stateHash(sim.state))
  })

  it('the Golden Release is offered on the first tick (the only offer: no regular one while it is pending)', () => {
    const { sim } = played(3)
    expect(sim.state.quests.offer).toBeNull()
    sim.tick()
    const offer = sim.state.quests.offer
    expect(offer?.templateId).toBe('golden_release')
    expect(sim.state.quests.active).toBeNull()
  })

  it('runs only on a fresh game, with a debug facet and a recipe', () => {
    const cfg = tycoon()
    const ticked = new Sim(cfg.data, 1)
    ticked.tick()
    const vsT = createViewSim(ticked, { debug: true })
    expect(applyConfigStart(vsT, ticked, cfg.start)).toBeNull()
    expect(ticked.commandLog).toEqual([])

    const touched = new Sim(cfg.data, 1)
    const vsL = createViewSim(touched, { debug: true })
    expect(vsL.debug!.forceLevel(2).ok).toBe(true)
    expect(applyConfigStart(vsL, touched, cfg.start)).toBeNull()
    expect(touched.state.level.level).toBe(2)

    const plain = new Sim(cfg.data, 1)
    expect(applyConfigStart(createViewSim(plain), plain, cfg.start)).toBeNull()
    expect(plain.commandLog).toEqual([])
    expect(
      applyConfigStart(createViewSim(plain, { debug: true }), plain, null),
    ).toBeNull()
    expect(plain.commandLog).toEqual([])
  })

  it('a second play on the same game does nothing (no longer fresh)', () => {
    const { sim, vs, start } = played(1)
    const n = sim.commandLog.length
    expect(applyConfigStart(vs, sim, start)).toBeNull()
    expect(sim.commandLog).toHaveLength(n)
  })

  it('refused steps are reported and warned about, never thrown; later steps still run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const patch = JSON.parse(readFileSync(TYCOON, 'utf8'))
    patch.economy.startMoney = 2_000
    const { sim, report } = played(1, configured(patch))
    expect(sim.state.level.level).toBe(5)
    expect(report!.failures.length).toBeGreaterThan(0)
    expect(
      report!.failures.every((f) => f.reason === 'insufficient-funds'),
    ).toBe(true)
    expect(warn).toHaveBeenCalledTimes(report!.failures.length)
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /^config start: .+ refused \(insufficient-funds\)$/,
    )
    expect(report!.applied).toBe(sim.commandLog.length)
    expect(sim.state.economy.balance).toBeGreaterThanOrEqual(0)
  })

  it('holdStation "sorter" hires the best sorter; null slots and a leftover recipe field are left alone', () => {
    const { sim, report } = played(
      2,
      configured({
        economy: { startMoney: 5_000 },
        start: {
          level: 3,
          slots: [null, null, 'battery_checker'],
          holdStation: 'sorter',
          fleet: { bike: 1 },
        },
      }),
    )
    expect(report?.failures).toEqual([])
    expect(slotContents(sim).slice(0, 4)).toEqual([
      'desk1',
      null,
      'battery_checker',
      null,
    ])
    const hs = sim.state.lane.holdStation.fixture
    expect(typeof hs).toBe('number')
    expect(sim.state.employees.find((e) => e.id === hs)?.role).toBe('sorter')
    expect(sim.state.vehicles.map((v) => v.type)).toEqual(['bike'])
    // No inspectorsPerDesk: Audrey alone at desk 1.
    expect(
      sim.state.employees.filter((e) => e.role === 'inspector'),
    ).toHaveLength(1)
  })
})
