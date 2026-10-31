// city-view.md §9.3 / spec §10 / plan.md §9 "Cards": the lost-life card's
// pure model — the route lines from life:lost `path` with mm:ss sim
// timestamps (§10 wording), the lane rate line, the counter line incl. the
// counterOwned two-line branch and the "Cleared by you" variant, and the
// fit rules for long paths. M6 (spec-build2 §2.3, design-m6 §6.3 / D14): the
// desk line names the inspector, the sorter's tag is shown, and the better
// of the machine and the 5-eye inspector lines is the counter (machine first
// on ties) — also end to end from a real Sim's life:lost. M8 (design-m8-m9
// §6.3, §7 M8 9): an overseas route ends `Handed off at Prefetch Pier 2
// 14:02` · `Cleared 14:47 — the ship has sailed` (Airport: `— the plane has
// left`), a 12-line 6-slot overseas path fits 360×604, elision keeps both
// overseas lines, and a real clearance's life:lost reads the same; M9: a
// real Airport clearance at L5 through six live slots ends `— the plane has
// left` and fits 360×604. Build 3 M12 (B3 §3.4, D-M12-16): the event
// variant — its model from a real `life:lost {cause: 'event'}`, and on a stub
// scene exactly one `lostLife:ok` button (no warehouse), Enter / Esc / OK =
// Continue, the card ≤ 300 wide and fitted to its content. Phaser is stubbed
// with chainable no-op game objects (the card builds real kit Buttons).
import { describe, expect, it, vi } from 'vitest'

type Bag = Record<string | symbol, unknown>

/** A game object whose unknown methods are chainable no-ops. */
function chain<T extends object>(target: T): T {
  const base = target as Bag
  for (const [k, v] of Object.entries({
    x: 0,
    y: 0,
    width: 40,
    height: 14,
    visible: true,
    alpha: 1,
  }))
    if (!(k in base)) base[k] = v
  const proxy: T = new Proxy(target, {
    get(t, k, receiver) {
      if (k in t) return Reflect.get(t, k, receiver)
      if (k === 'getTextBounds') return () => ({ lines: { lengths: [1] } })
      if (typeof k === 'symbol') return undefined
      return () => proxy
    },
  })
  return proxy
}

vi.mock('phaser', () => {
  class GameObject {
    readonly stub = true
    constructor() {
      return chain(this)
    }
    destroy(): void {}
  }
  class Rectangle {
    readonly stub = true
  }
  return {
    default: {
      Scene: GameObject,
      GameObjects: {
        Container: GameObject,
        NineSlice: GameObject,
        Image: GameObject,
      },
      Geom: { Rectangle },
    },
  }
})

const card = await import('../../src/ui/LostLifeCard.ts')
const helpers = await import('../sim/helpers.ts')
const { dataFixture } = helpers
const { deliverParcel, loseLifeEvent } =
  await import('../../src/sim/systems/economy.ts')
const { computeLayout } = await import('../../src/ui/layout.ts')
const { modalCount, topModal } = await import('../../src/ui/Sheet.ts')
const { takeFrom } = await import('../../src/sim/systems/lane.ts')
const { laneNode } = await import('../../src/sim/types.ts')

import type {
  LifeLostEventPayload,
  LifeLostPayload,
} from '../../src/sim/events.ts'
import type { Sim } from '../../src/sim/sim.ts'
import type {
  Checker,
  LaneNode,
  Parcel,
  Strain,
  TraceEntry,
} from '../../src/sim/types.ts'

const data = dataFixture()
const s = (sec: number): number => sec * 10

function checker(defId: string, id = 'chk1'): Checker {
  const row =
    defId === 'inspector'
      ? card.checkerRow(data, 'inspector')!
      : data.machines.checkers.find((c) => c.id === defId)!
  return {
    id,
    kind: defId === 'inspector' ? 'desk' : 'machine',
    defId,
    strain: row.strain as Checker['strain'],
    pMatch: row.pMatch,
    pOther: row.pOther,
    decoyFlag: 0.15,
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
            index: 1,
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
    missedBy: null,
    inspectorRate: null,
    sorterCall: null,
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
      missedBy: null,
      inspectorRate: null,
      sorterCall: null,
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

  it('a rate below 1 never rounds up to 100%: from 99% the card keeps one decimal (UX M3: "Another Metal detector would make it 100%")', () => {
    const p = payload({
      counterOwned: true,
      laneRate: 0.994,
      counterRate: 0.9988,
    })
    expect(card.counterLines(p, data)).toEqual([
      'This one got through on the 0.6%',
      'Another Shaky shaker would make it 99.8%',
    ])
    expect(card.rateLine('metal', 0.994)).toBe(
      "Your lane's catch rate vs metal was 99.4%",
    )
    expect(card.ratePct(0.99999)).toBe(99.9)
    expect(card.ratePct(0.985)).toBe(99)
    expect(card.ratePct(0.83)).toBe(83)
    expect(card.ratePct(1)).toBe(100)
    expect(card.missPct(0.83)).toBe(17)
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

describe('M6 (spec-build2 §2.3, design D14): the card names the person', () => {
  it('checkerRow("inspector") is the start inspector from roles (Audrey 3/3/0 = 85%, any strain)', () => {
    expect(card.checkerRow(data, 'inspector')).toEqual({
      name: card.DESK_NAME,
      strain: 'any',
      pMatch: 0.85,
      pOther: 0.85,
    })
  })

  it('a desk line is the sim\'s "Slot 1 desk — Lin: missed (80% vs metal)"; the sorter\'s tag is shown, untimed', () => {
    const path: TraceEntry[] = [
      {
        tick: s(60),
        what: 'flagged',
        ref: 'slot1',
        text: 'Slot 1 desk — Lin: flagged (metal)',
        by: 2,
        who: 'Lin',
      },
      { tick: s(60), what: 'held', ref: 'hold', text: 'Held in the Hold Bay' },
      {
        tick: s(66),
        what: 'sorted',
        ref: 'hold',
        text: 'Pat: looks clean (85%)',
      },
      { tick: s(70), what: 'cleared', ref: 'hold', text: 'Cleared by you' },
      {
        tick: s(90),
        what: 'missed',
        ref: 'slot1',
        text: 'Slot 1 desk — Lin: missed (80% vs metal)',
        by: 2,
        who: 'Lin',
        p: 0.8,
      },
    ]
    const items = card.routeItems(path, 'metal', deps())
    expect(card.routeText(items, 'metal')).toEqual([
      'Slot 1 desk — Lin: flagged (metal) 01:00',
      'Pat: looks clean (85%)',
      'Cleared by you 01:10',
      'Slot 1 desk — Lin: missed (80% vs metal)',
    ])
  })

  it('the 5-eye line replaces the machine line only when strictly better (machine first on ties)', () => {
    // Lin 0.80 alone vs metal; a Metal detector → 96%; a 5-eye 94%.
    const base = payload({
      strain: 'metal',
      laneRate: 0.8,
      counterMachineId: 'metal_detector',
      counterRate: 0.96,
      inspectorRate: 0.94,
    })
    expect(card.counterLines(base, data)).toEqual([
      'A Metal detector would make it 96%',
    ])
    expect(card.counterPick(base)).toBe('machine')
    // Same shown % → the machine.
    const tie = { ...base, counterRate: 0.9404, inspectorRate: 0.9396 }
    expect(card.counterLines(tie, data)).toEqual([
      'A Metal detector would make it 94%',
    ])
    // The inspector strictly better (an X-ray vs dense, 92.5% vs 94%).
    const better = payload({
      strain: 'dense',
      laneRate: 0.75,
      counterMachineId: 'xray',
      counterRate: 0.925,
      inspectorRate: 0.94,
    })
    expect(card.counterLines(better, data)).toEqual([
      'A 5-eye inspector at this desk would make it 94%',
    ])
    // The lane already holds the counter: the dice line stays.
    expect(card.counterLines({ ...better, counterOwned: true }, data)).toEqual([
      'This one got through on the 25%',
      'A 5-eye inspector at this desk would make it 94%',
    ])
    // From 99% on, one decimal (never "100%").
    expect(
      card.counterLines(
        { ...better, counterRate: 0.99, inspectorRate: 0.9988 },
        data,
      ),
    ).toEqual(['A 5-eye inspector at this desk would make it 99.8%'])
    // No counter machine at all: the inspector line alone.
    expect(
      card.counterLines(
        { ...better, counterMachineId: null, counterRate: null },
        data,
      ),
    ).toEqual(['A 5-eye inspector at this desk would make it 94%'])
    // Cleared by the player: neither (D14).
    expect(
      card.counterLines({ ...better, clearedByPlayerAt: s(70) }, data),
    ).toEqual(['Cleared by you at 01:10'])
  })

  it('"Open warehouse" highlights the machine, or nothing when the inspector line wins', () => {
    const m = card.lostLifeModel(
      payload({
        strain: 'dense',
        counterMachineId: 'xray',
        counterRate: 0.925,
        inspectorRate: 0.94,
      }),
      { ...deps(), lives: 2 },
    )
    expect(m.highlight).toBeNull()
    expect(m.counter).toEqual([
      'A 5-eye inspector at this desk would make it 94%',
    ])
    const mm = card.lostLifeModel(payload({ inspectorRate: 0.5 }), {
      ...deps(),
      lives: 2,
    })
    expect(mm.highlight).toBe('shaky_shaker')
  })
})

/** Malware of `strain` fed through the lane until it ends on the shelf. */
function missed(sim: Sim, n: number, strain: Strain): Parcel[] {
  const shelf = laneNode(sim.state.lane, 'shelf')!
  shelf.cap = null
  const feed = helpers.feeder(sim, n, { malware: true, strain })
  for (let t = 0; t < n * 50; t++) {
    feed()
    const hold = laneNode(sim.state.lane, 'hold')!
    for (const id of hold.queue.slice())
      sim.dispatch({ kind: 'toss', parcelId: id })
    sim.tick()
  }
  return shelf.queue.map((id) => sim.state.parcels[String(id)]!)
}

function lose(sim: Sim, p: Parcel): LifeLostPayload {
  const lost = helpers.collectLost(sim)
  takeFrom(laneNode(sim.state.lane, 'shelf')!, p.id)
  deliverParcel(sim, null, p)
  return lost[0]!
}

const model = (sim: Sim, p: LifeLostPayload) =>
  card.lostLifeModel(p, {
    data: sim.data,
    vehicleName: () => null,
    nodes: sim.state.lane.nodes,
    lives: sim.state.economy.lives,
  })

describe('M6 end to end: a real Sim life:lost through the card model', () => {
  it('Audrey missed it at the desk: her line, and the Metal detector (97%) beats a 5-eye (94%)', () => {
    const sim = helpers.quietSim(11)
    const p = missed(sim, 40, 'metal')[0]!
    const m = model(sim, lose(sim, p))
    expect(card.routeText(m.route, m.strain)).toContain(
      'Slot 1 desk — Audrey: missed (85% vs metal)',
    )
    expect(m.counter).toEqual(['A Metal detector would make it 97%'])
    expect(m.highlight).toBe('metal_detector')
  })

  it('a 1-eye inspector vs dense: the 5-eye line beats the X-ray and nothing is highlighted', () => {
    const sim = helpers.quietSim(12)
    sim.state.economy.balance = 1000
    sim.dispatch({ kind: 'fire', employeeId: sim.state.employees[0]!.id })
    expect(
      helpers.hireInspector(sim, { eye: 1, pace: 3, charisma: 0 }).ok,
    ).toBe(true)
    const p = missed(sim, 40, 'dense')[0]!
    const l = lose(sim, p)
    expect(l.missedBy?.p).toBe(0.75)
    const m = model(sim, l)
    expect(card.counterPick(l)).toBe('inspector')
    expect(m.counter).toEqual([
      `A 5-eye inspector at this desk would make it ${card.ratePct(l.inspectorRate!)}%`,
    ])
    expect(m.highlight).toBeNull()
  })
})

// ---- M8: overseas routes (spec-core §5.6, design-m8-m9 §6.3, §7 M8 9) --------

/** m5x7 advance widths (src/assets/m5x7.xml), as the card's BitmapText measures. */
async function m5x7Width(): Promise<(s: string) => number> {
  const { readFileSync } = await import('node:fs')
  const xml = readFileSync(
    new URL('../../src/assets/m5x7.xml', import.meta.url),
    'utf8',
  )
  const adv = new Map<number, number>()
  for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
    adv.set(Number(m[1]), Number(m[2]))
  return (t) =>
    [...t].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
}

/** Ticks of the sim clock mm:ss. */
const at = (m: number, sec: number): number => s(m * 60 + sec)

/** The sim's stored lines of a 6-slot lane ending overseas at Prefetch Pier 2. */
function overseasPath(hub: 'docks' | 'airport' = 'docks'): TraceEntry[] {
  const pier = hub === 'docks' ? 'dk_pier_2' : 'ap_terminal'
  const slots: TraceEntry[] = [
    {
      tick: at(13, 20),
      what: 'missed',
      ref: 'slot1',
      text: 'Slot 1 desk — Audrey: missed (85% vs battery)',
    },
    {
      tick: at(13, 22),
      what: 'missed',
      ref: 'slot2',
      text: 'Slot 2 Metal detector: missed (20% vs battery)',
    },
    {
      tick: at(13, 24),
      what: 'missed',
      ref: 'slot3',
      text: 'Slot 3 Shaky shaker: missed (20% vs battery)',
    },
    { tick: at(13, 25), what: 'empty', ref: 'slot4', text: 'Slot 4: empty' },
    {
      tick: at(13, 27),
      what: 'missed',
      ref: 'slot5',
      text: 'Slot 5 X-ray: missed (60% vs battery)',
    },
    { tick: at(13, 28), what: 'empty', ref: 'slot6', text: 'Slot 6: empty' },
  ]
  return [
    {
      tick: at(12, 40),
      what: 'spawned',
      ref: 'in_lodash_smelting',
      text: 'Spawned at Lodash Smelting Works',
    },
    {
      tick: at(12, 58),
      what: 'pickedUp',
      ref: '1',
      text: 'Picked up by Truck 1',
    },
    { tick: at(13, 15), what: 'unloaded', ref: 'dock2', text: 'Unloaded' },
    ...slots,
    { tick: at(13, 30), what: 'shelved', ref: 'shelf', text: 'Shelved' },
    { tick: at(13, 40), what: 'loaded', ref: '1', text: 'Loaded onto Truck 1' },
    {
      tick: at(14, 2),
      what: 'handedOff',
      ref: pier,
      text: `Handed off at ${bname(pier)}`,
    },
    {
      tick: at(14, 47),
      what: 'customsCleared',
      ref: hub,
      text: 'Cleared',
    },
  ]
}

describe('M8 (design-m8-m9 §6.3): the overseas route lines', () => {
  it('ends "Handed off at Prefetch Pier 2 14:02" · "Cleared 14:47 — the ship has sailed"', () => {
    const lines = card.routeText(
      card.routeItems(overseasPath(), 'battery', deps()),
      'battery',
    )
    expect(lines.slice(-2)).toEqual([
      'Handed off at Prefetch Pier 2 14:02',
      'Cleared 14:47 — the ship has sailed',
    ])
    expect(lines[0]).toBe('Spawned at Lodash Smelting Works 12:40')
    // The player's Hold Bay Clear keeps its own wording.
    expect(lines.some((l) => l.startsWith('Cleared by you'))).toBe(false)
  })

  it('reads the same without the stored texts (built from the trace refs)', () => {
    const bare = overseasPath().map(({ text: _t, ...e }) => e)
    const lines = card.routeText(
      card.routeItems(bare, 'battery', deps()),
      'battery',
    )
    expect(lines.slice(-2)).toEqual([
      'Handed off at Prefetch Pier 2 14:02',
      'Cleared 14:47 — the ship has sailed',
    ])
  })

  it('the Airport: "— the plane has left" (design R11)', () => {
    const lines = card.routeText(
      card.routeItems(overseasPath('airport'), 'battery', deps()),
      'battery',
    )
    expect(lines.slice(-2)).toEqual([
      'Handed off at Prefetch International Terminal 14:02',
      'Cleared 14:47 — the plane has left',
    ])
  })

  it('the title stays MALWARE DELIVERED (design R12)', () => {
    expect(card.LOST_LIFE_TITLE).toBe('MALWARE DELIVERED')
  })
})

describe('M8: a 6-slot overseas path fits the card', () => {
  const items = card.routeItems(overseasPath(), 'battery', deps())
  // The worst tail: the rate line + the dice line + the suggestion.
  const tailH = card.tailTextsHeight({
    counter: [
      'This one got through on the 17%',
      'Another X-ray would make it 97%',
    ],
  })

  it('12 lines (spawn, pickup, unload, 6 slots, shelved, handed off, cleared) at 18 px on 360×604 and 393×659', () => {
    expect(card.routeText(items, 'battery')).toHaveLength(12)
    for (const H of [604, 659]) {
      const fit = card.fitRoute(items, 'battery', card.routeBudget(H, tailH))
      expect(fit.lines, `H ${H}`).toHaveLength(12)
      expect(fit.lines, `H ${H}`).not.toContain('…')
      expect(fit.pitch, `H ${H}`).toBe(18)
    }
  })

  it('every line fits the 360-px card unwrapped (inner width 312 in m5x7)', async () => {
    const width = await m5x7Width()
    const inner = 360 - 24 - 2 * 12
    for (const hub of ['docks', 'airport'] as const) {
      const lines = card.routeText(
        card.routeItems(overseasPath(hub), 'battery', deps()),
        'battery',
      )
      for (const l of lines) expect(width(l), l).toBeLessThanOrEqual(inner)
    }
  })

  it("routeBudget is the card's own arithmetic: 230 px at 604 with three tail lines", () => {
    // min(604 − 80, 440) − (title 18 + parcel 36 + 8) − (6 + 54 + 6 + 16 + 10 + 44 + 12)
    expect(card.routeBudget(604, tailH)).toBe(440 - 62 - 148)
    expect(card.routeBudget(200, tailH)).toBe(42)
  })

  it('as a last resort the middle is elided, the hand-off and clearance kept at the end', () => {
    const fit = card.fitRoute(items, 'battery', 6 * 14)
    expect(fit.lines).toHaveLength(6)
    expect(fit.lines.slice(-3)).toEqual([
      '…',
      'Handed off at Prefetch Pier 2 14:02',
      'Cleared 14:47 — the ship has sailed',
    ])
    expect(fit.lines[0]).toBe('Spawned at Lodash Smelting Works 12:40')
    // A local route still keeps only its delivery line.
    const local = card.routeItems(examplePath, 'rattle', deps())
    const short = card.fitRoute(local, 'rattle', 4 * 14)
    expect(short.lines.slice(-2)).toEqual([
      '…',
      'Delivered to Node Heights Towers A 12:40',
    ])
  })
})

describe('M8 end to end: a real clearance life:lost through the card model', () => {
  it('debug overseas malware at the Docks: the card ends with the hand-off and "the ship has sailed"', () => {
    const sim = helpers.quietSim(5)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
    for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
    helpers.fund(sim)
    const lost = helpers.collectLost(sim)
    expect(
      sim.dispatch({ kind: 'debugOverseasMalware', hub: 'docks' }).ok,
    ).toBe(true)
    const handOffTick = sim.state.tick
    const docks = data.districts.find((d) => d.id === 'docks')!
    if (docks.kind !== 'overseas') throw new Error('docks is not a hub')
    helpers.runTicks(sim, docks.clearanceS * 10)
    expect(lost).toHaveLength(1)
    const l = lost[0]!
    expect(l.report.viaClearance).toBe(true)
    const m = model(sim, l)
    const lines = card.routeText(m.route, m.strain)
    const pier = data.buildings.find(
      (b) => b.district === 'docks' && b.recv > 0,
    )!
    expect(lines.slice(-2)).toEqual([
      `Handed off at ${pier.name} ${card.simClock(handOffTick)}`,
      `Cleared ${card.simClock(handOffTick + docks.clearanceS * 10)} — the ship has sailed`,
    ])
    expect(m.lives).toBe(2)
  })
})

describe('M9 end to end (design R11): an Airport clearance at the real L5, six live slots', () => {
  it('debug overseas malware at the Airport: six slot lines, the terminal hand-off and "the plane has left" 20 s later, fitting 360×604', async () => {
    const L5 = data.levels.find((l) => l.level === 5)!
    const sim = helpers.quietSim(6)
    sim.state.economy.lifetimeEarned = L5.threshold
    helpers.runTicks(sim, 1)
    expect(sim.state.level.level).toBe(5)
    for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
    helpers.fund(sim)
    // Six live slots: the lane path of a 6-slot room (B2 §4.3, tier 5).
    expect(
      sim.state.lane.nodes.filter((n) => /^slot\d$/.test(n.id)).length,
    ).toBe(6)
    const lost = helpers.collectLost(sim)
    expect(
      sim.dispatch({ kind: 'debugOverseasMalware', hub: 'airport' }).ok,
    ).toBe(true)
    const handOffTick = sim.state.tick
    const airport = data.districts.find((d) => d.id === 'airport')!
    if (airport.kind !== 'overseas') throw new Error('airport is not a hub')
    helpers.runTicks(sim, airport.clearanceS * 10 - 1)
    expect(lost).toHaveLength(0)
    helpers.runTicks(sim, 1)
    expect(lost).toHaveLength(1)
    const l = lost[0]!
    expect(l.report.viaClearance).toBe(true)
    const m = model(sim, l)
    const lines = card.routeText(m.route, m.strain)
    const handedAt = l.path.find((e) => e.what === 'handedOff')?.ref
    const terminal = data.buildings.find((b) => b.id === handedAt)!
    expect(terminal.district).toBe('airport')
    expect(terminal.recv).toBeGreaterThan(0)
    expect(lines.slice(-2)).toEqual([
      `Handed off at ${terminal.name} ${card.simClock(handOffTick)}`,
      `Cleared ${card.simClock(handOffTick + airport.clearanceS * 10)} — the plane has left`,
    ])
    for (let k = 1; k <= 6; k++)
      expect(
        lines.some((x) => x.startsWith(`Slot ${k}`)),
        `slot ${k}`,
      ).toBe(true)
    // It fits the card at the minimum profile and every line fits unwrapped.
    const tail = card.tailTextsHeight({ counter: m.counter })
    const fit = card.fitRoute(m.route, m.strain, card.routeBudget(604, tail))
    expect(fit.lines.slice(-1)).toEqual([lines.at(-1)])
    const width = await m5x7Width()
    for (const x of lines) expect(width(x), x).toBeLessThanOrEqual(360 - 48)
    expect(card.LOST_LIFE_TITLE).toBe('MALWARE DELIVERED')
  })
})

// ---- Build 3 M12: the event variant ------------------------------------------------

function emitter() {
  const ls = new Map<
    string,
    { fn: (...a: unknown[]) => void; ctx: unknown }[]
  >()
  return {
    on: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(n, [...(ls.get(n) ?? []), { fn, ctx }])
    },
    off: (n: string, fn: (...a: unknown[]) => void, ctx?: unknown) => {
      ls.set(
        n,
        (ls.get(n) ?? []).filter((l) => !(l.fn === fn && l.ctx === ctx)),
      )
    },
    emit: (n: string, ...args: unknown[]) => {
      for (const l of (ls.get(n) ?? []).slice()) l.fn.call(l.ctx, ...args)
    },
  }
}

const obj = (): object => chain({})

function fakeScene() {
  const added: unknown[] = []
  const removed: unknown[] = []
  const texts: string[] = []
  const scene = {
    scale: { width: 360, height: 604, zoom: 1 },
    add: {
      rectangle: obj,
      nineslice: obj,
      bitmapText: (_x: number, _y: number, _f: string, text: string) => {
        texts.push(text)
        return chain({})
      },
      image: obj,
      container: obj,
      existing: (o: unknown) => o,
    },
    cameras: {
      cameras: [] as unknown[],
      add: () => {
        const c = chain({})
        added.push(c)
        return c
      },
      remove: (c: unknown) => removed.push(c),
    },
    children: { list: [] as unknown[] },
    input: { keyboard: emitter() },
    events: emitter(),
    game: { events: emitter() },
    time: { addEvent: () => ({ remove() {} }) },
  }
  return { scene, added, removed, texts }
}

/** The life:lost payload of a real `Take the strike` (economy.ts loseLifeEvent). */
function recallStrike(): LifeLostEventPayload {
  const sim = helpers.makeSim(1)
  let got: LifeLostEventPayload | null = null
  sim.events.on('life:lost', (p) => {
    if (p.cause === 'event') got = p
  })
  loseLifeEvent(sim, 'ev_sec_recall', 'The recall', 'Take the strike')
  if (!got) throw new Error('no event life:lost')
  return got
}

describe('B3 §3.4 (M12): the lost-life card event variant', () => {
  it('eventLostLifeModel: the title, `You chose: {option}`, `Lives: N` and the lives left', () => {
    const p = recallStrike()
    const lives = data.economy.lives.start - 1
    expect(p.report.livesLeft).toBe(lives)
    expect(card.eventLostLifeModel(p, data)).toEqual({
      kind: 'event',
      title: 'The recall',
      choice: 'You chose: Take the strike',
      livesText: `Lives: ${lives}`,
      lives,
    })
  })

  it('the width is min(300, max(200, W − 24)); the height follows the wrapped lines, never under 120', () => {
    expect(card.lostLifeEventWidth(360)).toBe(300)
    expect(card.lostLifeEventWidth(300)).toBe(276)
    expect(card.lostLifeEventWidth(180)).toBe(200)
    expect(card.lostLifeEventHeight(1, 1)).toBe(
      8 + 18 + 14 + 8 + 18 + 16 + 10 + 44 + 12,
    )
    expect(card.lostLifeEventHeight(2, 2)).toBe(
      card.lostLifeEventHeight(1, 1) + 28,
    )
    expect(card.lostLifeEventHeight(1, 1)).toBeLessThanOrEqual(604 - 80)
  })

  it('builds one full-width OK (`lostLife:ok`, no warehouse); OK, Enter and Esc continue; it sits on the modal stack with its own camera', () => {
    const { scene, added, removed, texts } = fakeScene()
    const onContinue = vi.fn()
    const onOpenWarehouse = vi.fn()
    const L = computeLayout(360, 604, 0, 0, 1)
    const c = new card.LostLifeCard(scene as never, L, {
      onContinue,
      onOpenWarehouse,
    })
    const before = modalCount()
    const m = card.eventLostLifeModel(recallStrike(), data)
    c.open(m)
    expect(c.isOpen()).toBe(true)
    expect(c.current).toEqual(m)
    expect(topModal()).toBe(c)
    expect(modalCount()).toBe(before + 1)
    expect(added).toHaveLength(1)
    const buttons = (c as unknown as { buttons: { id: string }[] }).buttons
    expect(buttons.map((b) => b.id)).toEqual(['lostLife:ok'])
    expect(texts).toContain('The recall')
    expect(texts).toContain('You chose: Take the strike')
    expect(texts).toContain(m.livesText)
    expect(texts).toContain(card.LOST_LIFE_OK)
    expect(texts).not.toContain(card.LOST_LIFE_TITLE)
    expect(texts).not.toContain('Open warehouse')
    // ≤ 300 wide, centred, fitted to its one-line texts.
    const r = c.rect!
    expect(r.w).toBe(300)
    expect(r.x).toBe(30)
    expect(r.h).toBe(card.lostLifeEventHeight(1, 1))
    expect(r.y).toBe(Math.round((604 - r.h) / 2))
    // Enter = Continue (closes first, then the callback).
    scene.input.keyboard.emit('keydown', { key: 'Enter' } as KeyboardEvent)
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onOpenWarehouse).not.toHaveBeenCalled()
    expect(c.isOpen()).toBe(false)
    expect(modalCount()).toBe(before)
    expect(removed).toContain(added[0])
    // Esc too; and a relayout keeps the variant.
    c.open(m)
    c.relayout(computeLayout(393, 659, 0, 0, 1))
    expect(
      (c as unknown as { buttons: { id: string }[] }).buttons.map((b) => b.id),
    ).toEqual(['lostLife:ok'])
    scene.input.keyboard.emit('keydown', { key: 'Escape' } as KeyboardEvent)
    expect(onContinue).toHaveBeenCalledTimes(2)
    expect(c.isOpen()).toBe(false)
    c.destroy()
  })
})
