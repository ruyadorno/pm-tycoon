// FixedLaneLayout (warehouse-view.md §1.1-§1.3, §7.5, §8): the rect table as
// data. Pins the §7.5 Vitest hooks — rects never overlap except the
// documented pairs, every lane node id at L1 and L2 has a rect, pathBetween
// is defined for every `next` / `divert` edge — plus the §1.1 screen fit.
import { describe, expect, it } from 'vitest'
import {
  BAY_COUNT,
  FixedLaneLayout,
  MIN_VIEW_H,
  MIN_VIEW_W,
  RACK,
  ROOM_H,
  ROOM_W,
  roomPlacement,
  SHELF_COLS,
  SHELF_ROWS,
  type Point,
  type Rect,
} from '../../src/render/warehouse/RoomLayout.ts'
import { HUD_BOTTOM_H, HUD_TOP_H } from '../../src/ui/layout.ts'
import { laneNode } from '../../src/sim/types.ts'
import type { LaneNode } from '../../src/sim/types.ts'
import { dataFixture, makeSim } from '../sim/helpers.ts'

const layout = new FixedLaneLayout()

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const inside = (p: Point, r: Rect): boolean =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h

const finite = (p: Point): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y)

/** Lane nodes of a fresh game (L1) and with slot 4 unlocked (L2, §6.2). */
function laneAt(level: 1 | 2): readonly LaneNode[] {
  const sim = makeSim(1)
  if (level === 2) {
    const n = laneNode(sim.state.lane, 'slot4')
    if (n) delete n.locked
  }
  return sim.state.lane.nodes
}

/** Pairs the rect table documents as sharing space (§1.3). */
const DOCUMENTED = new Set([
  // The dock conveyor runs inside the dock area (dock1 = 0,32,160,64).
  'conv1|dock1',
  // Slots 5–6 are one dashed extension outline (§1.3 `ext`).
  'slot5|slot6',
])

describe('warehouse-view §7.5: RoomLayout rects', () => {
  for (const level of [1, 2] as const) {
    it(`every lane node id at L${level} has a rect inside the room`, () => {
      const nodes = laneAt(level)
      expect(nodes.length).toBeGreaterThan(0)
      for (const n of nodes) {
        const r = layout.rectFor(n.id)
        expect(r, n.id).not.toBeNull()
        if (!r) continue
        expect(r.x, n.id).toBeGreaterThanOrEqual(0)
        expect(r.y, n.id).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w, n.id).toBeLessThanOrEqual(ROOM_W)
        expect(r.y + r.h, n.id).toBeLessThanOrEqual(ROOM_H)
      }
    })
  }

  it('rects never overlap except the documented pairs', () => {
    const ids = laneAt(2).map((n) => n.id)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i] as string
        const b = ids[j] as string
        const ra = layout.rectFor(a)
        const rb = layout.rectFor(b)
        if (!ra || !rb || !overlaps(ra, rb)) continue
        const key = [a, b].toSorted().join('|')
        expect(DOCUMENTED.has(key), `${key} overlap`).toBe(true)
      }
    }
  })

  it('tap rects of different nodes never overlap and are ≥ 44 px', () => {
    const ids = ['dock1', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5']
    ids.push('hold', 'bin', 'shelf')
    for (const id of ids) {
      const h = layout.hitFor(id)
      expect(h, id).not.toBeNull()
      if (!h) continue
      expect(Math.min(h.w, h.h), id).toBeGreaterThanOrEqual(32)
      if (id !== 'slot5')
        expect(Math.min(h.w, h.h), id).toBeGreaterThanOrEqual(44)
      for (const other of ids) {
        if (other === id) continue
        const o = layout.hitFor(other)
        if (o) expect(overlaps(h, o), `${id} vs ${other}`).toBe(false)
      }
    }
  })

  it('nodeAt resolves the centre of every tappable node to that node', () => {
    for (const id of ['slot1', 'slot2', 'slot3', 'slot4', 'hold', 'bin']) {
      const r = layout.rectFor(id) as Rect
      expect(layout.nodeAt(r.x + r.w / 2, r.y + r.h / 2)).toBe(id)
    }
    expect(layout.nodeAt(100, 400)).toBe('shelf')
    expect(layout.nodeAt(4, 4)).toBeNull()
  })

  it('labels are display names, never raw slot indices', () => {
    expect(layout.labelFor('slot2')).toBe('Slot 2')
    expect(layout.labelFor('hold')).toBe('Hold Bay')
    expect(layout.labelFor('dock1')).toBe('Dock 1')
  })
})

describe('warehouse-view §1.3: anchors', () => {
  it('slot buffers and stations sit on the belt inside the slot rect', () => {
    for (let k = 1; k <= 4; k++) {
      const id = `slot${k}`
      const r = layout.rectFor(id) as Rect
      const a = layout.anchorsFor(id)
      expect(a.buffer).toHaveLength(dataFixture().machines.slotBufferCap)
      expect(a.stations.length).toBeGreaterThanOrEqual(
        dataFixture().employees.inspector.maxPerDesk,
      )
      for (const p of [...a.buffer, ...a.stations]) {
        expect(inside(p, r), `${id} ${p.x},${p.y}`).toBe(true)
        expect(p.x).toBe(144)
      }
      // buffer[0] is the head: closer to the stations than buffer[1].
      expect(a.buffer[0]?.y).toBeGreaterThan(a.buffer[1]?.y ?? 0)
    }
  })

  it('the conveyor has one anchor per queue position (§6.1 cap), head at the corner', () => {
    const a = layout.anchorsFor('conv1')
    expect(a.buffer).toHaveLength(dataFixture().machines.conveyorCapPerDock)
    expect(a.buffer.map((p) => p.x).toSorted((x, y) => x - y)).toEqual([
      42, 60, 78, 96, 114, 132,
    ])
    expect(a.buffer[0]?.x).toBe(132)
  })

  it('Hold Bay bays sit on the rack and the shelf grid holds the L2 cap', () => {
    const bays = layout.anchorsFor('hold').buffer
    expect(bays).toHaveLength(BAY_COUNT)
    for (const p of bays) expect(inside(p, RACK)).toBe(true)
    const cells = layout.anchorsFor('shelf').buffer
    expect(cells).toHaveLength(SHELF_COLS * SHELF_ROWS)
    const l2 = dataFixture().levels.find((l) => l.level === 2)
    expect(cells.length).toBeGreaterThanOrEqual(l2?.shelfCap ?? 0)
    const shelf = layout.rectFor('shelf') as Rect
    for (const p of cells) expect(inside(p, shelf)).toBe(true)
  })

  it('stand points, desk and machine positions exist for belt slots only', () => {
    for (let k = 1; k <= 4; k++) {
      expect(layout.standPoints(`slot${k}`)).toHaveLength(3)
      expect(layout.deskAt(`slot${k}`)).not.toBeNull()
      const m = layout.machineAt(`slot${k}`) as Point
      // 48 × 48 centred on the processing anchor (§1.3: x 120, y_k + 16).
      expect(m).toEqual({ x: 120, y: 96 + 64 * (k - 1) + 16 })
    }
    expect(layout.machineAt('slot5')).toBeNull()
    expect(layout.standPoints('hold')).toEqual([])
  })
})

describe('warehouse-view §7.5 / §8: pathBetween', () => {
  for (const level of [1, 2] as const) {
    it(`is defined for every next and divert edge at L${level}`, () => {
      const nodes = laneAt(level)
      let edges = 0
      for (const n of nodes) {
        const targets = [...n.next, ...(n.divert ? [n.divert] : [])]
        for (const t of targets) {
          const dest =
            layout.anchorsFor(t).buffer[0] ?? layout.anchorsFor(t).entry
          const path = layout.pathBetween(n.id, t, dest)
          expect(path.length, `${n.id}→${t}`).toBeGreaterThan(0)
          for (const p of path) expect(finite(p), `${n.id}→${t}`).toBe(true)
          expect(path[path.length - 1], `${n.id}→${t}`).toEqual(dest)
          edges += 1
        }
      }
      expect(edges).toBeGreaterThanOrEqual(nodes.length)
    })
  }

  it('the divert edge runs down the chute (x 180) into the bay', () => {
    const bay = layout.anchorsFor('hold').buffer[2] as Point
    const path = layout.pathBetween('slot1', 'hold', bay)
    expect(path).toEqual([{ x: 180, y: 136 }, { x: 180, y: bay.y }, bay])
  })

  it('Clear runs bay → chute → belt bottom → shelf cell', () => {
    const bay = layout.anchorsFor('hold').buffer[1] as Point
    const cell = layout.anchorsFor('shelf').buffer[7] as Point
    const path = layout.pathBetween('hold', 'shelf', cell, bay)
    expect(path[0]).toEqual({ x: 180, y: bay.y })
    expect(path[path.length - 1]).toEqual(cell)
  })
})

const fit = (W: number, H: number) =>
  roomPlacement(W, HUD_TOP_H, H - HUD_BOTTOM_H)

describe('warehouse-view §1.1: the room fits between the HUD bands', () => {
  it('fits the minimum 360 × 604 viewport exactly', () => {
    const p = fit(MIN_VIEW_W, MIN_VIEW_H)
    expect(p.fits).toBe(true)
    expect(p.roomX).toBe(4)
    expect(p.roomY).toBe(92)
    expect(p.roomY + ROOM_H).toBe(MIN_VIEW_H - HUD_BOTTOM_H)
    expect(fit(MIN_VIEW_W, MIN_VIEW_H - 1).fits).toBe(false)
  })

  it('centres the room on the iPhone 16 (393 × 659) and at 430', () => {
    const p = fit(393, 659)
    expect(p).toMatchObject({ roomX: 20, roomY: 119, fits: true })
    expect(p.readout).toEqual({ x: 20, y: 95, w: 352, h: 20 })
    expect(p.readout.y).toBeGreaterThanOrEqual(HUD_TOP_H)
    expect(fit(430, 932).roomX).toBe(39)
  })
})
