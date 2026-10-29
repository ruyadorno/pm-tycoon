// city-view.md §9.3 / spec §10 / plan.md §9 "Cards": the lost-life card's
// pure model — the route lines from life:lost `path` with mm:ss sim
// timestamps (§10 wording), the lane rate line, the counter line incl. the
// counterOwned two-line branch and the "Cleared by you" variant, and the
// fit rules for long paths. Phaser is stubbed (the module imports the kit).
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class Stub {
    readonly stub = true
  }
  return {
    default: {
      Scene: Stub,
      GameObjects: { Container: Stub, NineSlice: Stub, Image: Stub },
      Geom: { Rectangle: Stub },
    },
  }
})

const card = await import('../../src/ui/LostLifeCard.ts')
const { dataFixture } = await import('../sim/helpers.ts')

import type { LifeLostPayload } from '../../src/sim/events.ts'
import type { Checker, LaneNode, TraceEntry } from '../../src/sim/types.ts'

const data = dataFixture()
const s = (sec: number): number => sec * 10

function checker(defId: string, id = 'chk1'): Checker {
  const row =
    defId === 'inspector'
      ? data.employees.inspector
      : data.machines.checkers.find((c) => c.id === defId)!
  return {
    id,
    kind: defId === 'inspector' ? 'desk' : 'machine',
    defId,
    strain: row.strain as Checker['strain'],
    pMatch: row.pMatch,
    pOther: row.pOther,
    decoyFlag: row.decoyFlag,
    processTicks: 10,
    stations: 1,
    price: 0,
    boughtTick: 0,
  }
}

function slot(id: string, defId: string | null, chk = 'chk1'): LaneNode {
  return {
    id,
    kind: 'slot',
    next: [],
    cap: 2,
    queue: [],
    fixture: defId
      ? defId === 'inspector'
        ? {
            kind: 'desk',
            checker: checker(defId, chk),
            inspectorIds: [1],
            walkedOutIds: [],
          }
        : { kind: 'machine', checker: checker(defId, chk) }
      : null,
    stations: defId ? [{ parcelId: null, doneTick: null }] : [],
    dockId: null,
  }
}

const deps = (
  nodes: LaneNode[] = [],
): Parameters<typeof card.routeItems>[2] => ({
  data,
  vehicleName: (id) => (id === 1 ? 'Truck 1' : null),
  nodes,
})

/** The spec §10 example: Metal detector in slot 1, slot 2 empty, vs rattle. */
const examplePath: TraceEntry[] = [
  { tick: s(11 * 60 + 2), what: 'spawned', ref: 'in_lodash_smelting' },
  { tick: s(11 * 60 + 20), what: 'pickedUp', ref: '1' },
  { tick: s(11 * 60 + 51), what: 'unloaded', ref: 'dock1' },
  { tick: s(11 * 60 + 53), what: 'slot', ref: 'slot1' },
  { tick: s(11 * 60 + 54), what: 'missed', ref: 'chk2' },
  { tick: s(11 * 60 + 55), what: 'slot', ref: 'slot2' },
  { tick: s(11 * 60 + 56), what: 'shelved', ref: 'shelf' },
  { tick: s(12 * 60 + 20), what: 'loaded', ref: '1' },
  { tick: s(12 * 60 + 40), what: 'delivered', ref: 'hr_towers_a' },
]

function payload(over: Partial<LifeLostPayload> = {}): LifeLostPayload {
  return {
    parcelId: 7,
    label: 'colors@2.0.0-rc',
    strain: 'rattle',
    destBuildingId: 'hr_towers_a',
    path: examplePath,
    laneRate: 0.15,
    counterMachineId: 'shaky_shaker',
    counterOwned: false,
    counterRate: 0.83,
    clearedByPlayerAt: null,
    report: {
      tick: s(12 * 60 + 40),
      parcelId: 7,
      label: 'colors@2.0.0-rc',
      strain: 'rattle',
      size: 'S',
      originBuildingId: 'in_lodash_smelting',
      destBuildingId: 'hr_towers_a',
      path: examplePath,
      laneRate: 0.15,
      counterMachineId: 'shaky_shaker',
      counterOwned: false,
      counterRate: 0.83,
      clearedByPlayerAt: null,
      livesLeft: 2,
      viaClearance: false,
    },
    ...over,
  }
}

const bname = (id: string): string =>
  data.buildings.find((b) => b.id === id)?.name ?? id

describe('§9.3: route timestamps are mm:ss of sim time', () => {
  it('formats ticks as zero-padded minutes and seconds', () => {
    expect(card.simClock(0)).toBe('00:00')
    expect(card.simClock(s(125))).toBe('02:05')
    expect(card.simClock(s(11 * 60 + 2))).toBe('11:02')
    expect(card.simClock(s(125 * 60))).toBe('125:00')
  })
})

describe('spec §10: route lines from the life:lost path', () => {
  it('reads like the spec example, one line per hop', () => {
    const nodes = [slot('slot1', 'metal_detector', 'chk2'), slot('slot2', null)]
    const items = card.routeItems(examplePath, 'rattle', deps(nodes))
    expect(bname('in_lodash_smelting')).toBe('Lodash Smelting Works')
    expect(card.routeText(items, 'rattle')).toEqual([
      'Spawned at Lodash Smelting Works 11:02',
      'Picked up by Truck 1 11:20',
      'Unloaded 11:51',
      'Slot 1 Metal detector: missed (15% vs rattle)',
      'Slot 2: empty',
      'Shelved',
      'Delivered to Node Heights Towers A 12:40',
    ])
  })

  it('names the checker from the trace ref even after it left the lane', () => {
    const path: TraceEntry[] = [
      { tick: 0, what: 'slot', ref: 'slot1' },
      { tick: 5, what: 'missed', ref: 'slot1:inspector' },
    ]
    const items = card.routeItems(path, 'metal', deps([slot('slot1', null)]))
    expect(card.routeText(items, 'metal')).toEqual([
      'Slot 1 Inspection desk: missed (85% vs metal)',
    ])
  })

  it('a slot visit with no outcome entry is read from the lane now', () => {
    const path: TraceEntry[] = [
      { tick: 0, what: 'slot', ref: 'slot1' },
      { tick: 10, what: 'slot', ref: 'slot2' },
      { tick: 20, what: 'shelved', ref: 'shelf' },
    ]
    const nodes = [slot('slot1', 'inspector'), slot('slot2', null)]
    const items = card.routeItems(path, 'metal', deps(nodes))
    expect(card.routeText(items, 'metal')).toEqual([
      'Slot 1 Inspection desk: missed (85% vs metal)',
      'Slot 2: empty',
      'Shelved',
    ])
  })

  it('an outcome naming its own slot needs no slot entry before it', () => {
    const path: TraceEntry[] = [
      { tick: 0, what: 'missed', ref: 'slot3:metal_detector' },
    ]
    const items = card.routeItems(path, 'metal', deps())
    expect(card.routeText(items, 'metal')).toEqual([
      'Slot 3 Metal detector: missed (80% vs metal)',
    ])
  })

  it('a cleared parcel shows the flag and "Cleared by you"', () => {
    const path: TraceEntry[] = [
      { tick: s(60), what: 'slot', ref: 'slot1' },
      { tick: s(64), what: 'flagged', ref: 'chk1' },
      { tick: s(64), what: 'held', ref: 'hold' },
      { tick: s(71), what: 'cleared_by_player', ref: 'hold' },
      { tick: s(71), what: 'shelved', ref: 'shelf' },
    ]
    const items = card.routeItems(
      path,
      'metal',
      deps([slot('slot1', 'inspector')]),
    )
    expect(card.routeText(items, 'metal')).toEqual([
      'Slot 1 Inspection desk: flagged 01:04',
      'Cleared by you 01:11',
      'Shelved',
    ])
  })

  it('unknown vehicles and loaded / returned hops add no surprises', () => {
    const path: TraceEntry[] = [
      { tick: 0, what: 'pickedUp', ref: '9' },
      { tick: 5, what: 'returned', ref: 'shelf' },
      { tick: 6, what: 'loaded', ref: '9' },
    ]
    expect(card.routeText(card.routeItems(path, null, deps()), null)).toEqual([
      'Picked up by a vehicle 00:00',
    ])
  })
})

describe('§9.3: the lane rate and the counter lines', () => {
  it("rate: `Your lane's catch rate vs rattle was 15%`", () => {
    expect(card.rateLine('rattle', 0.15)).toBe(
      "Your lane's catch rate vs rattle was 15%",
    )
  })

  it('counter not in the lane: `A Shaky shaker would make it 83%`', () => {
    expect(card.counterLines(payload(), data)).toEqual([
      'A Shaky shaker would make it 83%',
    ])
    expect(
      card.counterLines(
        payload({ counterMachineId: 'xray', counterRate: 0.75 }),
        data,
      ),
    ).toEqual(['An X-ray would make it 75%'])
  })

  it('counterOwned: the dice line, then `Another Shaky shaker would make it 97%`', () => {
    const p = payload({ counterOwned: true, laneRate: 0.83, counterRate: 0.97 })
    expect(card.counterLines(p, data)).toEqual([
      'This one got through on the 17%',
      'Another Shaky shaker would make it 97%',
    ])
  })

  it('cleared by the player: `Cleared by you at 11:58` replaces the counter', () => {
    const p = payload({ clearedByPlayerAt: s(11 * 60 + 58) })
    expect(card.counterLines(p, data)).toEqual(['Cleared by you at 11:58'])
  })

  it('no counter machine: no counter line', () => {
    expect(
      card.counterLines(
        payload({ counterMachineId: null, counterRate: null }),
        data,
      ),
    ).toEqual([])
  })
})

describe('§9.3: the card model', () => {
  it('carries the dark parcel of its size, the strain icon, lives and the highlight', () => {
    const nodes = [slot('slot1', 'metal_detector', 'chk2'), slot('slot2', null)]
    const m = card.lostLifeModel(payload(), { ...deps(nodes), lives: 2 })
    expect(m.label).toBe('colors@2.0.0-rc')
    expect(m.parcelFrame).toBe('parcel_s_mal')
    expect(m.strainFrame).toBe('ic_strain_rattle')
    expect(m.rate).toBe("Your lane's catch rate vs rattle was 15%")
    expect(m.counter).toEqual(['A Shaky shaker would make it 83%'])
    expect(m.lives).toBe(2)
    expect(m.highlight).toBe('shaky_shaker')
    expect(m.route).toHaveLength(7)
  })
})

describe('§9.3: long routes fit the card (pitch, merged empty slots, elision)', () => {
  const longPath: TraceEntry[] = [
    { tick: 0, what: 'spawned', ref: 'hr_towers_a' },
    { tick: 1, what: 'pickedUp', ref: '1' },
    { tick: 2, what: 'unloaded', ref: 'dock1' },
    { tick: 3, what: 'slot', ref: 'slot1' },
    { tick: 4, what: 'missed', ref: 'inspector' },
    { tick: 5, what: 'slot', ref: 'slot2' },
    { tick: 6, what: 'slot', ref: 'slot3' },
    { tick: 7, what: 'slot', ref: 'slot4' },
    { tick: 8, what: 'shelved', ref: 'shelf' },
    { tick: 9, what: 'delivered', ref: 'hr_towers_a' },
  ]
  const items = card.routeItems(longPath, 'metal', deps())

  it('lists every hop at 18 px when there is room', () => {
    const fit = card.fitRoute(items, 'metal', 9 * 18)
    expect(fit.pitch).toBe(18)
    expect(fit.lines).toHaveLength(9)
  })

  it('tightens the pitch first, then merges runs of empty slots', () => {
    expect(card.fitRoute(items, 'metal', 9 * 16).pitch).toBe(16)
    expect(card.fitRoute(items, 'metal', 9 * 14).pitch).toBe(14)
    const merged = card.fitRoute(items, 'metal', 7 * 14)
    expect(merged.lines).toContain('Slots 2–4: empty')
    expect(merged.lines).toHaveLength(7)
  })

  it('elides the middle but keeps the delivery line as a last resort', () => {
    const fit = card.fitRoute(items, 'metal', 4 * 14)
    expect(fit.lines).toHaveLength(4)
    expect(fit.lines[2]).toBe('…')
    expect(fit.lines[3]).toMatch(/^Delivered to /)
  })
})

describe('spec §10: the sim-stored card lines (TraceEntry.text) win', () => {
  it('uses the stored text, timing spawned / picked up / unloaded / cleared / delivered', () => {
    const path: TraceEntry[] = [
      {
        tick: s(62),
        what: 'spawned',
        ref: 'in_lodash_smelting',
        text: 'Spawned at Lodash Smelting Works',
      },
      {
        tick: s(80),
        what: 'pickedUp',
        ref: '3',
        text: 'Picked up by Bike 2',
      },
      { tick: s(111), what: 'unloaded', ref: 'dock1', text: 'Unloaded' },
      {
        tick: s(115),
        what: 'flagged',
        ref: 'slot1',
        text: 'Slot 1 Inspection desk: flagged (metal)',
      },
      { tick: s(115), what: 'held', ref: 'hold', text: 'Held in the Hold Bay' },
      { tick: s(118), what: 'cleared', ref: 'hold', text: 'Cleared by you' },
      { tick: s(118), what: 'shelved', ref: 'shelf', text: 'Shelved' },
      { tick: s(130), what: 'loaded', ref: '3', text: 'Loaded onto Bike 2' },
      {
        tick: s(160),
        what: 'delivered',
        ref: 'hr_async_arms',
        text: 'Delivered to Async Arms',
      },
    ]
    const items = card.routeItems(path, 'metal', deps())
    expect(card.routeText(items, 'metal')).toEqual([
      'Spawned at Lodash Smelting Works 01:02',
      'Picked up by Bike 2 01:20',
      'Unloaded 01:51',
      'Slot 1 Inspection desk: flagged (metal) 01:55',
      'Cleared by you 01:58',
      'Shelved',
      'Delivered to Async Arms 02:40',
    ])
  })

  it('a missed slot keeps its stored line even after the fixture left', () => {
    const path: TraceEntry[] = [
      {
        tick: 1,
        what: 'missed',
        ref: 'slot1',
        text: 'Slot 1 Metal detector: missed (15% vs rattle)',
      },
      { tick: 2, what: 'empty', ref: 'slot2', text: 'Slot 2: empty' },
      { tick: 3, what: 'empty', ref: 'slot3', text: 'Slot 3: empty' },
    ]
    const items = card.routeItems(path, 'rattle', deps())
    expect(card.routeText(items, 'rattle')).toEqual([
      'Slot 1 Metal detector: missed (15% vs rattle)',
      'Slot 2: empty',
      'Slot 3: empty',
    ])
    expect(card.routeText(items, 'rattle', true)).toEqual([
      'Slot 1 Metal detector: missed (15% vs rattle)',
      'Slots 2–3: empty',
    ])
  })
})
