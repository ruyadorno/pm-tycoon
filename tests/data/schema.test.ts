// plan.md §6.6 / §6.9.1: the shipped tables pass the boot validator, every
// crafted defect is reported with its path, shipped configs validate merged
// over the tables, and the ?config= / --config deep merge is by index.

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyConfig,
  buildGameData,
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
    raw.employees.inspector.startSlot = 4
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
      'employees.inspector.startSlot: 4 exceeds levels[0].slots 3',
    )
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

  it('ships spicy.json', () => {
    expect(names).toContain('spicy.json')
  })

  it.each(names)('%s merged over the tables validates', (name) => {
    const patch: unknown = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
    expect(problemsOf(applyConfig(loadRawData(), patch, name))).toEqual([])
  })

  it('spicy.json triples malware, doubles decoys, caps the Hold Bay at 2 on L1-L2 only', () => {
    const d = loadGameData('public/configs/spicy.json')
    expect(d.parcels.malware.baseShare).toBe(0.09)
    expect(d.parcels.decoyShare).toBe(0.2)
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

  it('rejects a missing config and an unsafe name with DataError', async () => {
    await expect(loadBrowserData('nope', { fetch: fakeFetch })).rejects.toThrow(
      /configs\/nope\.json \(HTTP 404\)/,
    )
    await expect(
      loadBrowserData('../secrets', { fetch: fakeFetch }),
    ).rejects.toBeInstanceOf(DataError)
  })
})
