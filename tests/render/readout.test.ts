// warehouse-view.md §1.9 / §4: the lane readout strip reads exactly
// `Lane: 15/min · Detection 97%`; while stalled the rate segment becomes
// `Lane: STALLED (Hold Bay full)` in red — only that segment, so
// "Detection" never reads as the failing part (UX M2 review). Phaser is
// stubbed; readoutParts is pure. M6 adds the pure station look (stationLook;
// the outline is the `station_outline` atlas frame), the crews of both desks + the sorter (crewSeats) and the
// worker sprite stems (workerStem / workerFrame).
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

const { readoutParts } =
  await import('../../src/render/warehouse/LaneRenderer.ts')

const joined = (p: { lead: string; mid: string; pct: string }): string =>
  p.lead + p.mid + p.pct

describe('§1.9 lane readout strip', () => {
  it('reads `Lane: 15/min · Detection 97%`', () => {
    const p = readoutParts(15, 97, null)
    expect(joined(p)).toBe('Lane: 15/min · Detection 97%')
    expect(p.stalled).toBe(false)
  })

  it('stalled: only the rate segment carries the stall (red), the detection label stays separate', () => {
    const p = readoutParts(15, 97, { reason: 'holdBayFull' })
    expect(joined(p)).toBe('Lane: STALLED (Hold Bay full) · Detection 97%')
    expect(p.stalled).toBe(true)
    expect(p.lead).toBe('Lane: STALLED (Hold Bay full) ')
    expect(p.mid).toBe('· Detection ')
  })

  it('§4 captions: shelfFull → Shelf full, bufferFull → Lane jammed', () => {
    expect(readoutParts(15, 97, { reason: 'shelfFull' }).lead).toBe(
      'Lane: STALLED (Shelf full) ',
    )
    expect(readoutParts(15, 97, { reason: 'bufferFull' }).lead).toBe(
      'Lane: STALLED (Lane jammed) ',
    )
  })
})

// ---- M6 (spec-build2 §2.4, §2.6; design-m6 §6.4): the station look, the
// rack lamp `S`, the crews of both desks and the sorter's sprite stem. ------

const { stationLook } =
  await import('../../src/render/warehouse/LaneRenderer.ts')
const { crewSeats, workerFrame, workerStem } =
  await import('../../src/render/warehouse/WorkerSprites.ts')
const { FixedLaneLayout, SORTER_STAND } =
  await import('../../src/render/warehouse/RoomLayout.ts')

type Station = Parameters<typeof stationLook>[0]
type Node = Parameters<typeof crewSeats>[0][number]

const person = (id: number, role: 'inspector' | 'sorter', active = true) => ({
  id,
  role,
  name: `P${id}`,
  look: id % 12,
  active,
  unpaid: false,
  nodeId: role === 'sorter' ? 'hold' : 'slot1',
})

const station = (
  over: Partial<NonNullable<Station>>,
): NonNullable<Station> => ({
  unlockLevel: 2,
  unlocked: true,
  kind: null,
  sorter: null,
  working: false,
  ...over,
})

const ART = { podium: true, arm: false }

describe('M6 Hold Bay station look (B2 §2.6)', () => {
  it('locked at L1: dashed outline, lock and `Lv2`, no podium, no S', () => {
    const l = stationLook(station({ unlocked: false }), ART)
    expect(l).toEqual({
      outline: 'locked',
      lockText: 'Lv2',
      podium: false,
      plus: false,
      arm: false,
      sBadge: false,
    })
  })

  it('live and empty: the podium and a "+"; a dashed outline until the podium art exists', () => {
    expect(stationLook(station({}), ART)).toMatchObject({
      outline: null,
      podium: true,
      plus: true,
      sBadge: false,
    })
    expect(
      stationLook(station({}), { podium: false, arm: false }),
    ).toMatchObject({ outline: 'empty', podium: false, plus: true })
  })

  it('the rack lamp `S` shows only while an ACTIVE sorter is seated', () => {
    const on = stationLook(
      station({ kind: 'sorter', sorter: person(9, 'sorter') }),
      ART,
    )
    expect(on).toMatchObject({ sBadge: true, plus: false, podium: true })
    const out = stationLook(
      station({ kind: 'sorter', sorter: person(9, 'sorter', false) }),
      ART,
    )
    expect(out).toMatchObject({ sBadge: false, plus: false })
  })

  it('the Sorter Arm: its frame replaces the podium once drawn (M9), never an S', () => {
    const arm = station({ kind: 'sorter_arm' })
    expect(stationLook(arm, { podium: true, arm: true })).toMatchObject({
      arm: true,
      podium: false,
      outline: null,
      plus: false,
      sBadge: false,
    })
    expect(stationLook(arm, ART)).toMatchObject({ arm: false, podium: true })
  })

  it('a facade without the station draws nothing', () => {
    expect(Object.values(stationLook(null, ART)).every((v) => !v)).toBe(true)
  })
})

const desk = (id: string, ids: number[], stations: object[] = []): Node =>
  ({
    id,
    kind: 'slot',
    next: [],
    cap: 2,
    queue: [],
    dockId: null,
    fixture: {
      kind: 'desk',
      index: 1,
      checker: {},
      inspectorIds: ids,
      walkedOutIds: [],
    },
    stations,
  }) as unknown as Node

const none = (): boolean => false
const sorterArt = (f: string): boolean => f.startsWith('worker_sorter_e')
const looks = (f: string): boolean => f === 'worker_l3_e_idle_0'
const oneScan = (f: string): boolean => f === 'worker_sorter_w_scan_1'

describe('M6 worker sprites: both desks and the sorter (B2 §2.3-§2.6)', () => {
  const layout = new FixedLaneLayout()
  it('binds every desk’s crew to its own node’s stand points, in seat order', () => {
    const nodes = [desk('slot1', [1, 4, 5]), desk('slot3', [7])]
    const seats = crewSeats(nodes, layout, null)
    expect([...seats.keys()]).toEqual([1, 4, 5, 7])
    const s1 = layout.standPoints('slot1')
    const s3 = layout.standPoints('slot3')
    expect(seats.get(4)).toEqual({
      nodeId: 'slot1',
      seat: 1,
      stand: s1[1],
      face: 'e',
      station: false,
    })
    expect(seats.get(7)).toMatchObject({ nodeId: 'slot3', stand: s3[0] })
  })

  it('the active sorter stands at SORTER_STAND facing the rack; a walked-out one leaves', () => {
    const on = crewSeats(
      [desk('slot1', [1])],
      layout,
      station({ kind: 'sorter', sorter: person(9, 'sorter') }),
    )
    expect(on.get(9)).toEqual({
      nodeId: 'hold',
      seat: 0,
      stand: SORTER_STAND,
      face: 'w',
      station: true,
    })
    const out = crewSeats(
      [desk('slot1', [1])],
      layout,
      station({ kind: 'sorter', sorter: person(9, 'sorter', false) }),
    )
    expect(out.has(9)).toBe(false)
    expect(out.has(1)).toBe(true)
  })

  it('sorters wear `worker_sorter` once drawn (else `worker`); look variants are art-only', () => {
    expect(workerStem('sorter', 3, none)).toBe('worker')
    expect(workerStem('inspector', 3, none)).toBe('worker')
    expect(workerStem('sorter', 3, sorterArt)).toBe('worker_sorter')
    expect(workerStem('inspector', 3, sorterArt)).toBe('worker')
    expect(workerStem('inspector', 3, looks)).toBe('worker_l3')
    expect(workerStem('inspector', 4, looks)).toBe('worker')
  })

  it('frames fall back to `worker` one by one while a variant is incomplete', () => {
    expect(workerFrame('worker_sorter', 'w', 'scan', 1, oneScan)).toBe(
      'worker_sorter_w_scan_1',
    )
    expect(workerFrame('worker_sorter', 'w', 'scan', 0, oneScan)).toBe(
      'worker_w_scan_0',
    )
    expect(workerFrame('worker', 'e', 'jump', 0, oneScan)).toBe('worker_e_jump')
    expect(workerFrame('worker', 'n', 'walk', 1, oneScan)).toBe(
      'worker_n_walk_1',
    )
  })
})
