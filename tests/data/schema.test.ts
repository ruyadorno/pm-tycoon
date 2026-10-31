// plan.md §6.6 / §6.9.1: the shipped tables pass the boot validator, every
// crafted defect is reported with its path, shipped configs validate merged
// over the tables, and the ?config= / --config deep merge is by index.
// M10 (plan-build2 §8.7 task 3): spicy.json's build-2 quest cadence, the
// tycoon.json data override + `start` recipe (src/data/configStart.ts:
// validated against the merged tables, kept out of the merge and the hash).

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyConfig,
  buildGameData,
  checkConfigStart,
  configStartOf,
  dataHash,
  DataError,
  deepMerge,
  doorTile,
  footprintRect,
  groundAt,
  groundFrames,
  isRoadTile,
  isTrimmedTile,
  reachableRoads,
  roadThemesAt,
  roadTiles,
  validateGameData,
} from '../../src/data/index.ts'
import {
  loadConfigured,
  loadGameData as loadBrowserData,
  rawGameData,
} from '../../src/data/load.browser.ts'
import type { RawGameData } from '../../src/data/types.ts'
import {
  configPathFromArgv,
  loadGameData,
  loadRawData,
} from '../../tools/sim/load.node.ts'

/** A mutable deep copy of the shipped tables. */
const fresh = (): Record<string, any> => structuredClone(loadRawData())

const problemsOf = (raw: unknown): string[] => validateGameData(raw)

describe('shipped data (spec §12)', () => {
  const data = buildGameData(loadRawData())

  it('§12 tables + map.json validate with no problems', () => {
    expect(problemsOf(loadRawData())).toEqual([])
  })

  it('§3.4 buildings.json has 69 rows; live districts 10-12, hubs 2-3', () => {
    expect(data.buildings).toHaveLength(69)
    for (const d of data.districts) {
      const n = data.buildings.filter((b) => b.district === d.id).length
      if (d.kind === 'district') expect(n).toBeGreaterThanOrEqual(10)
      if (d.kind === 'district') expect(n).toBeLessThanOrEqual(12)
      if (d.kind === 'overseas') expect([2, 3]).toContain(n)
    }
  })

  it('§3.1 road graph: 411 tiles, trimmed tiles absent, connected from (19,23)', () => {
    const m = data.map
    const roads = roadTiles(m)
    expect(roads).toHaveLength(411)
    expect(isRoadTile(m, 19, 23)).toBe(true)
    for (const [x, y] of [
      [35, 36],
      [36, 35],
      [43, 28],
      [28, 43],
      [43, 43],
    ]) {
      expect(isTrimmedTile(m, x!, y!)).toBe(true)
      expect(isRoadTile(m, x!, y!)).toBe(false)
    }
    expect(isRoadTile(m, 43, 27)).toBe(true)
    expect(isRoadTile(m, 35, 35)).toBe(true)
    expect(reachableRoads(m, [19, 23]).size).toBe(roads.length)
  })

  it('§3.1 themed one-sided avenues stay routable', () => {
    const m = data.map
    expect(roadThemesAt(m, 3, 30).map((t) => t.id)).toEqual(['quay'])
    expect(roadThemesAt(m, 35, 30).map((t) => t.id)).toEqual(['beach_road'])
    expect(roadThemesAt(m, 30, 35).map((t) => t.id)).toEqual(['promenade'])
    expect(roadThemesAt(m, 10, 43).map((t) => t.id)).toEqual(['seafront'])
    expect(roadThemesAt(m, 3, 43).map((t) => t.id)).toEqual([
      'quay',
      'seafront',
    ])
    expect(roadThemesAt(m, 19, 23)).toEqual([])
  })

  it('§3.4 every anchor is a road tile; the door is the footprint tile nearest it', () => {
    for (const b of data.buildings) {
      expect(isRoadTile(data.map, b.anchor[0], b.anchor[1])).toBe(true)
      const [x0, y0, x1, y1] = footprintRect(b)
      const nearest = [
        Math.min(Math.max(b.anchor[0], x0), x1),
        Math.min(Math.max(b.anchor[1], y0), y1),
      ]
      expect(doorTile(data.map, b)).toEqual(nearest)
    }
  })

  it('§3.1 ground: lot, lake, sea, avenues', () => {
    const m = data.map
    expect(groundAt(m, 19, 23)).toBe(m.ground.road)
    expect(groundAt(m, 20, 20)).toBe('lot_parking')
    expect(groundAt(m, 23, 26)).toBe('lot_queue')
    expect(groundAt(m, 25, 23)).toBe('lot_concrete')
    expect(groundAt(m, 39, 39)).toBe('water')
    expect(groundAt(m, 1, 30)).toBe('water')
    expect(groundAt(m, 20, 46)).toBe('water')
    expect(groundAt(m, 38, 30)).toBe('sand')
    expect(groundFrames(m)).toHaveLength(48 * 48)
  })
})

describe('crafted defects are reported with their path (plan.md §6.6)', () => {
  it('duplicate building id', () => {
    const raw = fresh()
    raw.buildings[5].id = raw.buildings[2].id
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(
        /^buildings\[5\]\.id: duplicate id "dt_peer_plaza"/,
      ),
    )
  })

  it('off-road anchor', () => {
    const raw = fresh()
    raw.buildings[12].anchor = [18, 29]
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(/^buildings\[12\]\.anchor: not a road tile/),
    )
  })

  it('anchor on a trimmed avenue tile', () => {
    const raw = fresh()
    const i = raw.buildings.findIndex(
      (b: { id: string }) => b.id === 'cv_courthouse',
    )
    raw.buildings[i].anchor = [35, 36]
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(
        new RegExp(`^buildings\\[${i}\\]\\.anchor: not a road tile .*trimmed`),
      ),
    )
  })

  it('anchor on an avenue not adjacent to the block', () => {
    const raw = fresh()
    raw.buildings[0].anchor = [11, 13]
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(
        /^buildings\[0\]\.anchor: .*not on an avenue adjacent/,
      ),
    )
  })

  it('overlapping footprint', () => {
    const raw = fresh()
    raw.buildings[1].tile = [22, 12]
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(
        /^buildings\[1\]\.tile: footprint overlaps buildings\[0\]/,
      ),
    )
  })

  it('footprint outside its district blocks', () => {
    const raw = fresh()
    raw.buildings[0].tile = [12, 20]
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(
        /^buildings\[0\]\.tile: footprint .* not inside one block of district "downtown"/,
      ),
    )
  })

  it('bad sizeMix sum', () => {
    const raw = fresh()
    raw.districts[0].sizeMix.S = 0.9
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(/^districts\[0\]\.sizeMix: sums to 1\.1/),
    )
  })

  it('unknown counter', () => {
    const raw = fresh()
    raw.parcels.malware.strains[0].counter = 'magnet_wand'
    expect(problemsOf(raw)).toContainEqual(
      'parcels.malware.strains[0].counter: unknown checker "magnet_wand"',
    )
  })

  it('unknown referenced ids, startSlot, thresholds', () => {
    const raw = fresh()
    raw.levels[1].unlockRegions = ['moon']
    raw.levels[2].threshold = 1000
    raw.vehicles.types[0].disallowedRegions.push('mars')
    raw.employees.start.inspector.slot = 4
    const p = problemsOf(raw)
    expect(p).toContainEqual(
      'levels[1].unlockRegions[0]: unknown district "moon"',
    )
    expect(p).toContainEqual(
      expect.stringMatching(/^levels\[2\]\.threshold: 1000 is not above/),
    )
    expect(p).toContainEqual(
      'vehicles.types[0].disallowedRegions[1]: unknown district "mars"',
    )
    expect(p).toContainEqual(
      'employees.start.inspector.slot: 4 exceeds levels[0].slots 3',
    )
  })

  it('employees.json (spec-build2 §9): the Toss-only sorter, the pay order, the pip tables, the desk rows (M6)', () => {
    const raw = fresh()
    raw.employees.roles.sorter.canClear = true
    raw.employees.payOrder = ['inspectors', 'drivers']
    raw.employees.roles.inspector.p = [0.75, 0.8, 0.85, 0.9]
    raw.employees.desks.rows[0].index = 2
    const p = problemsOf(raw)
    expect(p).toContainEqual(
      'employees.roles.sorter.canClear: expected one of false, got true',
    )
    expect(p).toContainEqual('employees.payOrder: expected 3..3 items, got 2')
    expect(p).toContainEqual(
      'employees.roles.inspector.p: expected 5..5 items, got 4',
    )
    const rows = fresh()
    rows.employees.desks.rows[0].index = 2
    expect(problemsOf(rows)).toContainEqual(
      'employees.desks.rows[0].index: expected 1 (ascending from 1, unique), got 2',
    )
    const order = fresh()
    order.employees.payOrder = ['inspectors', 'drivers', 'drivers']
    expect(problemsOf(order)).toContainEqual(
      'employees.payOrder: lists "sorters" 0 times',
    )
    const cap = fresh()
    cap.employees.roles.inspector.pCap = 0.9
    cap.employees.roles.inspector.stats = ['eye', 'charisma']
    expect(problemsOf(cap)).toEqual(
      expect.arrayContaining([
        'employees.roles.inspector.pCap: 0.9 is below max(p) 0.94',
        'employees.roles.inspector.stats: expected ["eye","pace","charisma"], got ["eye","charisma"]',
      ]),
    )
    const names = fresh()
    names.puns.peopleNames = ['Audrey', 'Lin', 'Audrey']
    expect(problemsOf(names)).toEqual(
      expect.arrayContaining([
        'puns.peopleNames: 3 names, need ≥ 10',
        'puns.peopleNames[2]: duplicate name "Audrey"',
      ]),
    )
    const old = fresh()
    old.puns.inspectorNames = ['Audrey']
    expect(problemsOf(old)).toContainEqual('puns.inspectorNames: unknown key')
  })

  it('quests.json shapes (spec-build2 §9; design-m7 §1.5): one slot, goal kinds, level arrays, unknown keys', () => {
    const raw = fresh()
    raw.quests.offer.maxActive = 2
    raw.quests.templates[0].goal = { kind: 'deliveriesTo', count: 3 }
    raw.quests.templates[5].goal.count = [1, 2, 3, 4, 5, 6]
    raw.quests.templates[6].foo = 1
    raw.quests.templates[3].reward.starApplicant.pips.eye = 6
    const p = problemsOf(raw)
    expect(p).toContainEqual('quests.offer.maxActive: 2 is outside 1..1')
    expect(p).toContainEqual(
      expect.stringMatching(
        /^quests\.templates\[0\]\.goal\.kind: expected one of "deliveriesFrom"\|/,
      ),
    )
    expect(p).toContainEqual(
      'quests.templates[5].goal.count: expected 1..5 items, got 6',
    )
    expect(p).toContainEqual('quests.templates[6].foo: unknown key')
    expect(p).toContainEqual(
      'quests.templates[3].reward.starApplicant.pips.eye: 6 is outside 0..5',
    )
    const puns = fresh()
    delete puns.puns.tickerQuest
    expect(problemsOf(puns)).toContainEqual('puns.tickerQuest: missing')
  })

  it('quests.json relations: ids, levels, the magic parcel’s one copy, limits and rewards present', () => {
    const dup = fresh()
    dup.quests.templates[1].id = 'rush_district'
    dup.quests.templates[4].id = 'golden_release'
    dup.quests.templates[5].unlockLevel = 6
    let p = problemsOf(dup)
    expect(p).toContainEqual(
      'quests.templates[1].id: duplicate id "rush_district" (first at quests.templates[0])',
    )
    expect(p).toContainEqual(
      'quests.templates[4].id: "golden_release" is a levels.json ultimateQuest id',
    )
    expect(p).toContainEqual(
      'quests.templates[5].unlockLevel: level 6 does not exist',
    )
    const magic = fresh()
    magic.quests.templates[2].limitDays = 2
    expect(problemsOf(magic)).toContainEqual(
      "quests.templates[2]: the magic parcel's clock and payout live in parcels.json magic (no limitDays / reward here)",
    )
    const limits = fresh()
    delete limits.quests.templates[5].limitDays
    delete limits.quests.templates[6].reward
    limits.quests.templates[7].reward = {}
    p = problemsOf(limits)
    expect(p).toContainEqual('quests.templates[5].limitDays: missing')
    expect(p).toContainEqual('quests.templates[6].reward: missing')
    expect(p).toContainEqual(
      'quests.templates[7].reward: needs at least one field',
    )
    const levels = fresh()
    levels.levels.pop()
    expect(problemsOf(levels)).toContainEqual(
      'quests.templates[0].goal.count: 5 entries, more than the 4 levels',
    )
  })

  it('quests.json targets: deliveriesFrom needs one, satisfactionAtLeast needs satisfactionBelow below its goal, nothing else takes one', () => {
    const raw = fresh()
    delete raw.quests.templates[0].target
    raw.quests.templates[0].targetArg = 40
    raw.quests.templates[5].target = 'district:mostWaiting'
    let p = problemsOf(raw)
    expect(p).toContainEqual(
      'quests.templates[0].target: deliveriesFrom needs a district:* target',
    )
    expect(p).toContainEqual(
      'quests.templates[0].targetArg: only with "district:satisfactionBelow"',
    )
    expect(p).toContainEqual(
      'quests.templates[5].target: goal "deliveriesOfSize" takes no target',
    )
    const sat = fresh()
    sat.quests.templates[1].target = 'district:mostWaiting'
    expect(problemsOf(sat)).toContainEqual(
      'quests.templates[1].target: satisfactionAtLeast needs "district:satisfactionBelow"',
    )
    const arg = fresh()
    delete arg.quests.templates[1].targetArg
    expect(problemsOf(arg)).toContainEqual(
      'quests.templates[1].targetArg: missing (district:satisfactionBelow)',
    )
    const unreachable = fresh()
    unreachable.quests.templates[1].goal.value = 50
    p = problemsOf(unreachable)
    expect(p).toContainEqual(
      'quests.templates[1].goal.value: 50 is not above targetArg 50',
    )
  })

  it('quests.json conditions and hubs: livesBelowCap or hubLive:<overseas id>; overseasCleared at an overseas hub', () => {
    const raw = fresh()
    raw.quests.templates[7].condition = 'hubLive:downtown'
    raw.quests.templates[9].condition = 'whenever'
    raw.quests.templates[7].goal.hub = 'industrial'
    const p = problemsOf(raw)
    expect(p).toContainEqual(
      'quests.templates[7].condition: "downtown" is not an overseas district',
    )
    expect(p).toContainEqual(
      'quests.templates[9].condition: expected "livesBelowCap" or "hubLive:<overseas id>", got "whenever"',
    )
    expect(p).toContainEqual(
      'quests.templates[7].goal.hub: "industrial" is not an overseas district',
    )
  })

  it('quests.json rewards: a voucher is a checker id; a ★ has exactly its role’s stats, 1-5 (charisma 0-2), an affinity only as a driver', () => {
    const raw = fresh()
    raw.quests.templates[5].reward.voucher = 'magnet_wand'
    raw.quests.templates[3].reward.starApplicant.pips = { eye: 5, pace: 3 }
    raw.quests.templates[3].reward.starApplicant.affinity = 'van'
    raw.quests.templates[4].reward.starApplicant.pips.charisma = 3
    raw.quests.templates[4].reward.starApplicant.pips.speed = 0
    const p = problemsOf(raw)
    expect(p).toContainEqual(
      'quests.templates[5].reward.voucher: unknown checker "magnet_wand"',
    )
    expect(p).toContainEqual(
      'quests.templates[3].reward.starApplicant.pips: expected the inspector stats ["eye","pace","charisma"], got ["eye","pace"]',
    )
    expect(p).toContainEqual(
      'quests.templates[3].reward.starApplicant.affinity: only drivers have an affinity',
    )
    expect(p).toContainEqual(
      'quests.templates[4].reward.starApplicant.pips.charisma: 3 is outside 0..2',
    )
    expect(p).toContainEqual(
      'quests.templates[4].reward.starApplicant.pips.speed: 0 is outside 1..5',
    )
  })

  it('puns.json quest lines: one per template and the ultimate; ticker lines carry {name} ({company} for Victory)', () => {
    const raw = fresh()
    delete raw.puns.quests.big_haul
    delete raw.puns.quests.golden_release
    raw.puns.tickerQuest.offered = 'A new job'
    raw.puns.tickerQuest.victory = 'We won, {name}'
    const p = problemsOf(raw)
    expect(p).toContainEqual('puns.quests: missing the line for "big_haul"')
    expect(p).toContainEqual(
      'puns.quests: missing the line for "golden_release"',
    )
    expect(p).toContainEqual('puns.tickerQuest.offered: must contain {name}')
    expect(p).toContainEqual('puns.tickerQuest.victory: must contain {company}')
    // M9: the endless line has no placeholder (design-m8-m9 §4.7) but is required.
    expect(p.some((x) => x.startsWith('puns.tickerQuest.endless'))).toBe(false)
    delete raw.puns.tickerQuest.endless
    expect(problemsOf(raw)).toContainEqual('puns.tickerQuest.endless: missing')
  })

  it('empty pun list for a strain', () => {
    const raw = fresh()
    raw.puns.malwareLabels.battery = []
    expect(problemsOf(raw)).toContainEqual(
      'puns.malwareLabels.battery: empty list for strain "battery"',
    )
  })

  it('unknown keys and wrong types', () => {
    const raw = fresh()
    raw.parcels.malware.basShare = 0.5
    raw.economy.startMoney = '450'
    raw.economy.playtestMaxLevel = 9
    const p = problemsOf(raw)
    expect(p).toContainEqual('economy.playtestMaxLevel: 9 is outside 1..5')
    expect(p).toContainEqual('parcels.malware.basShare: unknown key')
    expect(p).toContainEqual('economy.startMoney: expected a number, got "450"')
  })

  it('a disconnected road graph', () => {
    const raw = fresh()
    raw.map.trimmed.push({ axis: 'x', at: 19, from: 20, to: 22 })
    raw.map.trimmed.push({ axis: 'x', at: 19, from: 24, to: 26 })
    expect(problemsOf(raw)).toContainEqual(
      expect.stringMatching(/^map: road graph is not connected/),
    )
  })

  it('a prop on a road or a building', () => {
    const raw = fresh()
    raw.map.props[0].tile = [19, 23]
    raw.map.props[1].tile = [20, 12]
    const p = problemsOf(raw)
    expect(p).toContainEqual('map.props[0].tile: [19,23] is an avenue tile')
    expect(p).toContainEqual(
      expect.stringMatching(
        /^map\.props\[1\]\.tile: \[20,12\] is inside buildings\[0\]/,
      ),
    )
  })

  it('map.hubs (M8 + M9, design-m8-m9 §1.2, §1.4): an overseas district, once; its office a building of that district; its vessel one of its props; an exit that moves', () => {
    const shipped = fresh()
    expect(shipped.map.hubs).toEqual([
      {
        district: 'docks',
        office: 'dk_customs',
        vessel: { frame: 'dk_ship', tile: [1, 29], exit: [-5, 0], liftPx: 0 },
      },
      {
        district: 'airport',
        office: 'ap_terminal',
        vessel: { frame: 'ap_plane', tile: [45, 10], exit: [4, 0], liftPx: 64 },
      },
    ])
    // M9: the plane's stand and the tower are airport props (the vessel's
    // prop row is what the schema matches).
    expect(shipped.map.props).toContainEqual({
      frame: 'ap_plane',
      tile: [45, 10],
      region: 'airport',
    })
    expect(shipped.map.props).toContainEqual({
      frame: 'ap_tower',
      tile: [44, 16],
      region: 'airport',
    })
    expect(problemsOf(shipped)).toEqual([])
    const raw = fresh()
    const docks = raw.map.hubs[0]
    raw.map.hubs.push(structuredClone(docks), {
      ...structuredClone(docks),
      district: 'highres',
    })
    // [0] docks, [1] airport, [2] docks again, [3] highres
    raw.map.hubs[0].office = 'ap_terminal'
    raw.map.hubs[2].vessel.tile = [2, 29]
    raw.map.hubs[2].vessel.exit = [0, 0]
    raw.map.hubs[1].vessel.liftPx = 999
    const p = problemsOf(raw)
    expect(p).toContainEqual('map.hubs[1].vessel.liftPx: 999 is outside 0..256')
    raw.map.hubs[1].vessel.liftPx = 64
    raw.map.hubs[1].vessel.frame = 'dk_ship'
    const q = problemsOf(raw)
    expect(q).toContainEqual(
      'map.hubs[0].office: "ap_terminal" is not a building of "docks"',
    )
    expect(q).toContainEqual('map.hubs[2].district: duplicate hub "docks"')
    expect(q).toContainEqual(
      'map.hubs[2].vessel: no map.props row {frame "dk_ship", tile [2,29], region "docks"}',
    )
    expect(q).toContainEqual(
      'map.hubs[2].vessel.exit: is [0,0] (the vessel never leaves)',
    )
    expect(q).toContainEqual(
      'map.hubs[3].district: "highres" is not an overseas district',
    )
    // The Airport row's vessel must be one of the airport's props.
    expect(q).toContainEqual(
      'map.hubs[1].vessel: no map.props row {frame "dk_ship", tile [45,10], region "airport"}',
    )
    const missing = fresh()
    delete missing.map.hubs
    expect(problemsOf(missing)).toContainEqual('map.hubs: missing')
  })

  it('every overseas district live at ≤ playtestMaxLevel has a map.hubs row (M9: the shipped cap 5 needs the Docks and the Airport); dock indices are unique; an overseas clearanceS / valueMult is positive', () => {
    const none = fresh()
    none.map.hubs = []
    expect(none.economy.playtestMaxLevel).toBe(5)
    expect(problemsOf(none)).toEqual([
      'map.hubs: no row for "docks" (overseas, live at level 3 ≤ playtestMaxLevel 5)',
      'map.hubs: no row for "airport" (overseas, live at level 5 ≤ playtestMaxLevel 5)',
    ])
    // Below the Docks' level no row is needed.
    none.economy.playtestMaxLevel = 2
    expect(problemsOf(none)).toEqual([])
    // The Docks alone are enough below the Airport's level (L5).
    const docksOnly = fresh()
    docksOnly.map.hubs = docksOnly.map.hubs.filter(
      (h: { district: string }) => h.district === 'docks',
    )
    docksOnly.economy.playtestMaxLevel = 4
    expect(problemsOf(docksOnly)).toEqual([])
    docksOnly.economy.playtestMaxLevel = 5
    expect(problemsOf(docksOnly)).toEqual([
      'map.hubs: no row for "airport" (overseas, live at level 5 ≤ playtestMaxLevel 5)',
    ])
    const dup = fresh()
    dup.economy.docks.push({ ...dup.economy.docks[0] })
    expect(problemsOf(dup)).toContainEqual(
      `economy.docks[${dup.economy.docks.length - 1}].index: duplicate dock index 2`,
    )
    const zero = fresh()
    const i = zero.districts.findIndex((d: { id: string }) => d.id === 'docks')
    zero.districts[i].clearanceS = 0
    zero.districts[i].valueMult = 0
    const z = problemsOf(zero)
    expect(z).toContainEqual(
      expect.stringMatching(
        new RegExp(`^districts\\[${i}\\]\\.clearanceS: 0 `),
      ),
    )
    expect(z).toContainEqual(
      expect.stringMatching(new RegExp(`^districts\\[${i}\\]\\.valueMult: 0 `)),
    )
  })

  it('an overseas district’s malwareMult must equal parcels.malware.overseasMult (spawn.ts reads the latter; R6)', () => {
    const raw = fresh()
    const i = raw.districts.findIndex((d: { id: string }) => d.id === 'airport')
    raw.districts[i].malwareMult = 3
    expect(problemsOf(raw)).toContainEqual(
      `districts[${i}].malwareMult: 3 ≠ parcels.malware.overseasMult 2`,
    )
  })

  it('buildGameData throws DataError with the problems', () => {
    const raw = fresh()
    raw.districts[0].sizeMix.S = 0.9
    expect(() => buildGameData(raw)).toThrow(DataError)
    try {
      buildGameData(raw)
    } catch (err) {
      expect((err as DataError).problems.length).toBeGreaterThan(0)
    }
  })
})

describe('configs (plan.md §6.6)', () => {
  const dir = new URL('../../public/configs/', import.meta.url)
  const names = readdirSync(dir).filter((f) => f.endsWith('.json'))

  const patchOf = (name: string): Record<string, any> =>
    JSON.parse(readFileSync(new URL(name, dir), 'utf8'))

  it('ships spicy.json and tycoon.json', () => {
    expect(names).toContain('spicy.json')
    expect(names).toContain('tycoon.json')
  })

  it.each(names)(
    '%s merged over the tables validates, its start recipe too',
    (name) => {
      const patch: unknown = patchOf(name)
      const raw = applyConfig(loadRawData(), patch, name)
      expect(problemsOf(raw)).toEqual([])
      const check = checkConfigStart(
        configStartOf(patch),
        buildGameData(raw),
        name,
      )
      expect(check.problems).toEqual([])
    },
  )

  it('spicy.json: the build-3 events cadence (B3 §7) — the first card and every level band sooner than the base tables, nothing else in events moves', () => {
    const d = loadGameData('public/configs/spicy.json')
    const base = buildGameData(loadRawData())
    const s = d.events.schedule
    const b = base.events.schedule
    expect(s.firstEventS).toBeGreaterThan(0)
    expect(s.firstEventS).toBeLessThan(b.firstEventS)
    expect(Object.keys(s.intervalS)).toEqual(Object.keys(b.intervalS))
    for (const [k, [lo, hi]] of Object.entries(b.intervalS)) {
      const [slo, shi] = s.intervalS[k]!
      expect(slo, `L${k} lo`).toBeGreaterThan(0)
      expect(slo, `L${k} lo`).toBeLessThan(lo)
      expect(shi, `L${k} hi`).toBeLessThan(hi)
    }
    const still = (e: typeof d.events) => ({
      ...e,
      schedule: { ...e.schedule, firstEventS: 0, intervalS: {} },
    })
    expect(still(d.events)).toEqual(still(base.events))
  })

  it('spicy.json: the quest tables untouched (job cards ride the events cadence, B3 §3.2) and no start recipe', () => {
    const d = loadGameData('public/configs/spicy.json')
    const base = buildGameData(loadRawData())
    expect(patchOf('spicy.json')).not.toHaveProperty('quests')
    expect(d.quests).toEqual(base.quests)
    expect(checkConfigStart(configStartOf(patchOf('spicy.json')), d)).toEqual({
      start: null,
      problems: [],
    })
  })

  it('tycoon.json: only economy.startMoney moves in the tables; its start is the L5 lane, docks 2-3 and a fleet', () => {
    const patch = patchOf('tycoon.json')
    const d = loadGameData('public/configs/tycoon.json')
    const base = buildGameData(loadRawData())
    expect(d.economy.startMoney).toBe(patch.economy.startMoney)
    expect(d.economy.startMoney).toBeGreaterThan(base.economy.startMoney)
    expect({
      ...d,
      hash: '',
      economy: { ...d.economy, startMoney: 0 },
    }).toEqual({
      ...base,
      hash: '',
      economy: { ...base.economy, startMoney: 0 },
    })
    const { start, problems } = checkConfigStart(
      configStartOf(patch),
      d,
      'tycoon.json',
    )
    expect(problems).toEqual([])
    const last = d.levels[d.levels.length - 1]!
    expect(start).toEqual({
      level: last.level,
      slots: [
        'desk',
        'metal_detector',
        'shaky_shaker',
        'battery_checker',
        'xray',
        'desk',
      ],
      inspectorsPerDesk: 2,
      holdStation: 'sorter_arm',
      docks: [2, 3],
      fleet: [
        { type: 'bike', count: 3 },
        { type: 'van', count: 2 },
        { type: 'truck', count: 3 },
      ],
    })
    // Every slot of the top level, the Golden Release's level.
    expect(start!.slots).toHaveLength(last.slots)
    expect(last.ultimateQuest).toBeDefined()
  })

  it('the start key is not a data file: out of the merge and the hash', () => {
    const raw = loadRawData()
    const merged = applyConfig(raw, { start: { level: 2 } }, 's.json')
    expect(merged).toEqual(raw)
    expect(dataHash(merged)).toBe(dataHash(raw))
    expect('start' in merged).toBe(false)
    expect(configStartOf({ start: { level: 2 } })).toEqual({ level: 2 })
    expect(configStartOf({ economy: {} })).toBeUndefined()
    expect(configStartOf(null)).toBeUndefined()
  })

  it('checkConfigStart reports every defect with its path', () => {
    const d = buildGameData(loadRawData())
    const problems = (start: unknown): string[] =>
      checkConfigStart(start, d, 'x.json').problems
    expect(checkConfigStart(undefined, d)).toEqual({
      start: null,
      problems: [],
    })
    expect(checkConfigStart(null, d)).toEqual({ start: null, problems: [] })
    expect(problems([])).toEqual(['x.json.start: expected an object'])
    expect(problems({ lvl: 5 })).toEqual([
      'x.json.start.lvl: unknown field (expected level|slots|inspectorsPerDesk|holdStation|docks|fleet)',
    ])
    expect(problems({ level: 6 })).toEqual([
      'x.json.start.level: expected an integer 1..5',
    ])
    expect(problems({ level: 0 })).toHaveLength(1)
    expect(problems({ level: 2.5 })).toHaveLength(1)
    // L1 has 3 slots; the start desk's slot; unknown / locked checkers; desks.
    expect(problems({ slots: [null, null, null, null] })).toEqual([
      'x.json.start.slots: 4 entries, level 1 has 3 slots',
    ])
    expect(problems({ level: 2, slots: ['metal_detector'] })).toEqual([
      'x.json.start.slots[0]: slot 1 holds the start desk (null or "desk")',
    ])
    expect(problems({ slots: [null, 'scanner', 'xray'] })).toEqual([
      'x.json.start.slots[1]: unknown checker "scanner"',
      'x.json.start.slots[2]: xray unlocks at level 4, start level 1',
    ])
    expect(problems({ slots: [null, 7] })).toEqual([
      'x.json.start.slots[1]: expected "desk", a checker id or null',
    ])
    expect(problems({ slots: ['desk', 'desk'] })).toEqual([
      'x.json.start.slots: 2 desks, level 1 allows 1',
    ])
    expect(problems({ level: 3, slots: [null, 'desk', 'desk'] })).toEqual([
      'x.json.start.slots: 3 desks, level 3 allows 2',
    ])
    expect(problems({ level: 3, slots: [null, 'desk'] })).toEqual([])
    expect(problems({ inspectorsPerDesk: 4 })).toEqual([
      'x.json.start.inspectorsPerDesk: expected an integer 0..3',
    ])
    expect(problems({ holdStation: 'sorter' })).toEqual([
      'x.json.start.holdStation: the station unlocks at level 2, start level 1',
    ])
    expect(problems({ level: 3, holdStation: 'sorter_arm' })).toEqual([
      'x.json.start.holdStation: sorter_arm unlocks at level 4, start level 3',
    ])
    expect(problems({ holdStation: 'xray' })).toEqual([
      'x.json.start.holdStation: expected null, "sorter" or a Hold Bay upgrade id',
    ])
    expect(problems({ level: 4, docks: [2, 2, 1, 3] })).toEqual([
      'x.json.start.docks[1]: dock 2 listed twice',
      'x.json.start.docks[2]: expected an economy.docks index',
    ])
    expect(problems({ level: 3, docks: [3] })).toEqual([
      'x.json.start.docks[0]: dock 3 unlocks at level 4, start level 3',
    ])
    expect(problems({ docks: 2 })).toEqual([
      'x.json.start.docks: expected an array',
    ])
    expect(
      problems({ fleet: { bike: 1, truck: 1, boat: 1, van: -1 } }),
    ).toEqual([
      'x.json.start.fleet.boat: unknown vehicle type',
      'x.json.start.fleet.van: expected a non-negative integer',
      'x.json.start.fleet.truck: unlocks at level 2, start level 1',
    ])
    expect(problems({ fleet: [] })).toEqual([
      'x.json.start.fleet: expected an object {vehicle type: count}',
    ])
    // A clean recipe: defaults, fleet in vehicles.json order, zero counts dropped.
    expect(
      checkConfigStart({ fleet: { truck: 0, van: 1, bike: 2 } }, d).start,
    ).toEqual({
      level: 1,
      slots: [],
      inspectorsPerDesk: 0,
      holdStation: null,
      docks: [],
      fleet: [
        { type: 'bike', count: 2 },
        { type: 'van', count: 1 },
      ],
    })
  })

  it('spicy.json raises malware and decoys above the base tables, caps the Hold Bay at 2 on L1-L2 only', () => {
    const d = loadGameData('public/configs/spicy.json')
    const base = buildGameData(loadRawData())
    expect(d.parcels.malware.baseShare).toBe(0.09)
    expect(d.parcels.decoyShare).toBe(0.3)
    expect(d.parcels.malware.baseShare).toBeGreaterThan(
      base.parcels.malware.baseShare,
    )
    expect(d.parcels.decoyShare).toBeGreaterThan(base.parcels.decoyShare)
    expect(d.levels.map((l) => l.holdBayCap)).toEqual([2, 2, 5, 5, 5])
    expect(d.parcels.malware.cap).toBe(0.2)
    expect(d.hash).not.toBe(buildGameData(loadRawData()).hash)
  })

  it('applyConfig rejects an unknown table', () => {
    expect(() => applyConfig(loadRawData(), { econmy: {} }, 'x.json')).toThrow(
      /x\.json\.econmy: unknown data file/,
    )
  })

  it('--config parsing', () => {
    expect(configPathFromArgv(['--minutes', '30', '--config', 'a.json'])).toBe(
      'a.json',
    )
    expect(configPathFromArgv(['--config=b.json'])).toBe('b.json')
    expect(configPathFromArgv(['--seed', '1'])).toBeNull()
    expect(() => configPathFromArgv(['--config'])).toThrow(DataError)
  })
})

describe('deepMerge (plan.md §6.6)', () => {
  it('merges arrays by index, objects recursively; scalars and null replace', () => {
    const base = {
      levels: [
        { level: 1, holdBayCap: 3, strain: 'metal' },
        { level: 2, holdBayCap: 3, strain: 'rattle' },
        { level: 3, holdBayCap: 5, strain: 'battery' },
      ],
      economy: { startMoney: 450, lives: { start: 3, cap: 5 } },
      tags: ['a', 'b'],
    }
    const before = structuredClone(base)
    const out = deepMerge(base, {
      levels: [{ holdBayCap: 2 }, { holdBayCap: 2, strain: null }],
      economy: { lives: { start: 1 } },
      tags: ['z', 'b', 'c'],
    })
    expect(out.levels).toEqual([
      { level: 1, holdBayCap: 2, strain: 'metal' },
      { level: 2, holdBayCap: 2, strain: null },
      { level: 3, holdBayCap: 5, strain: 'battery' },
    ])
    expect(out.economy).toEqual({
      startMoney: 450,
      lives: { start: 1, cap: 5 },
    })
    expect(out.tags).toEqual(['z', 'b', 'c'])
    expect(base).toEqual(before)
  })

  it('leaves untouched tables equal to the shipped ones', () => {
    const raw: RawGameData = loadRawData()
    const merged = applyConfig(raw, { economy: { startMoney: 600 } })
    expect(merged.buildings).toEqual(raw.buildings)
    expect((merged.economy as { startMoney: number }).startMoney).toBe(600)
  })
})

describe('dataHash (plan.md §6.4 saves)', () => {
  it('is stable across key order and changes with any value', () => {
    const raw = loadRawData()
    const h = dataHash(raw)
    expect(h).toMatch(/^[0-9a-f]{8}$/)
    const reordered = Object.fromEntries(Object.entries(raw).toReversed())
    expect(dataHash(reordered)).toBe(h)
    const changed = fresh()
    changed.economy.startMoney = 451
    expect(dataHash(changed)).not.toBe(h)
    expect(buildGameData(raw).hash).toBe(h)
  })
})

describe('browser loader (static JSON imports, ?config=)', () => {
  const publicDir = new URL('../../public/', import.meta.url)
  const fakeFetch = (async (url: string) => {
    try {
      return new Response(readFileSync(new URL(url, publicDir)))
    } catch {
      return new Response('not found', { status: 404 })
    }
  }) as typeof fetch

  it('bundles exactly the tables on disk', () => {
    expect(rawGameData()).toEqual(loadRawData())
  })

  it('fetches configs/<name>.json relative to the page and merges it', async () => {
    const d = await loadBrowserData('spicy', { fetch: fakeFetch })
    expect(d.levels.map((l) => l.holdBayCap)).toEqual([2, 2, 5, 5, 5])
    expect(d.hash).toBe(loadGameData('public/configs/spicy.json').hash)
    const plain = await loadBrowserData(null, { fetch: fakeFetch })
    expect(plain.hash).toBe(buildGameData(loadRawData()).hash)
  })

  it('loadConfigured hands Boot the validated start recipe (tycoon), none for spicy or no config', async () => {
    const t = await loadConfigured('tycoon', { fetch: fakeFetch })
    expect(t.data.hash).toBe(loadGameData('public/configs/tycoon.json').hash)
    expect(t.start?.level).toBe(5)
    expect(t.start?.docks).toEqual([2, 3])
    expect((await loadConfigured('spicy', { fetch: fakeFetch })).start).toBe(
      null,
    )
    expect((await loadConfigured(null, { fetch: fakeFetch })).start).toBe(null)
  })

  it('a defective start recipe rejects with DataError, its path in problems', async () => {
    const bad = (async () =>
      new Response(
        JSON.stringify({ start: { level: 2, fleet: { boat: 1 } } }),
      )) as unknown as typeof fetch
    const err: unknown = await loadConfigured('bad', { fetch: bad }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DataError)
    expect((err as DataError).problems).toEqual([
      'configs/bad.json.start.fleet.boat: unknown vehicle type',
    ])
  })

  it('rejects a missing config and an unsafe name with DataError', async () => {
    await expect(loadBrowserData('nope', { fetch: fakeFetch })).rejects.toThrow(
      /configs\/nope\.json \(HTTP 404\)/,
    )
    await expect(
      loadBrowserData('../secrets', { fetch: fakeFetch }),
    ).rejects.toBeInstanceOf(DataError)
  })
})
