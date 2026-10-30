// FixedLaneLayout (warehouse-view.md §1.1-§1.3, §7.5, §8): the rect table as
// data. Pins the §7.5 Vitest hooks — rects never overlap except the
// documented pairs, every lane node id at L1 and L2 has a rect, pathBetween
// is defined for every `next` / `divert` edge — plus the §1.1 screen fit.
// M8 (design-m8-m9 §6.1, §7 M8 item 7): docks 2–3 (doors, tails, lamps,
// door points, roller pads, hits; the desk strip / w1 / aisle moved off the
// pads), every lane node with both docks bought, the tier-3 shelf grid and
// props, no overlaps at 360 × 604 and 393 × 659.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AISLE_X,
  BAY_COUNT,
  DESK_HIT_X,
  DOCK_COUNT,
  DOCK_PAD,
  dockGeom,
  dockIndexOf,
  PAD_EXIT,
  PAD_SPOTS,
  PROP_T3_SIZE,
  PROPS_T3,
  propGroup,
  propsFor,
  SHELF_GRID_T1,
  SHELF_GRID_T3,
  SHELF_MAX_CELLS,
  shelfGrid,
  W1_X,
  bayRect,
  BIN_COUNTER,
  DOCK_PANEL,
  DOOR_POINT,
  FixedLaneLayout,
  HOLD_STATION,
  HOLD_STATION_HIT,
  LOCKED_DOORS,
  MIN_VIEW_H,
  MIN_VIEW_W,
  PLATE_H,
  PLATE_PAD,
  POSTER,
  POSTER_HIT,
  PROP_T1_SIZE,
  PROP_T2_SIZE,
  PROPS_T1,
  PROPS_T2,
  RACK,
  RACK_LAMP,
  RACK_S_BADGE,
  ROOM_H,
  ROOM_W,
  roomPlacement,
  SHELF_BADGE,
  SHELF_COLS,
  SHELF_ROWS,
  SIGN,
  SIGNAGE,
  SORTER_ARM_AT,
  SORTER_ARM_SIZE,
  SORTER_FACING,
  SORTER_STAND,
  STATION_ROW_Y,
  STRIP_LIGHTS,
  TILE,
  type Point,
  type Rect,
} from '../../src/render/warehouse/RoomLayout.ts'
import { HUD_BOTTOM_H, HUD_TOP_H } from '../../src/ui/layout.ts'
import { CAP_H, CAP_TOP } from '../../src/ui/text.ts'
import { addDock } from '../../src/sim/systems/docks.ts'
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

/**
 * Lane nodes of a fresh game (L1), with slot 4 unlocked (L2, §6.2), and with
 * docks 2 and 3 bought on top (3: the M8 room, dock 3 first to pin R8).
 */
function laneAt(level: 1 | 2 | 3): readonly LaneNode[] {
  const sim = makeSim(1)
  if (level >= 2) {
    const n = laneNode(sim.state.lane, 'slot4')
    if (n) delete n.locked
  }
  if (level === 3) {
    addDock(sim, 3)
    addDock(sim, 2)
  }
  return sim.state.lane.nodes
}

/** Pairs the rect table documents as sharing space (§1.3). */
const DOCUMENTED = new Set([
  // The dock conveyor runs inside the dock area (dock1 = 0,32,160,64).
  'conv1|dock1',
  // M8: the dock 2–3 roller pads sit inside their dock (door + pad) rects.
  'conv2|dock2',
  'conv3|dock3',
  // Slots 5–6 are one dashed extension outline (§1.3 `ext`).
  'slot5|slot6',
])

describe('warehouse-view §7.5: RoomLayout rects', () => {
  for (const level of [1, 2, 3] as const) {
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

  it('rects never overlap except the documented pairs (docks 2–3 bought)', () => {
    const ids = laneAt(3).map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['dock2', 'conv2', 'dock3']))
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
    ids.push('hold', 'bin', 'shelf', 'dock2', 'dock3')
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
        dataFixture().employees.desks.maxPerDesk,
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
  for (const level of [1, 2, 3] as const) {
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

/** m5x7 advance widths from the BMFont descriptor (the plates' text width). */
const ADVANCE = new Map<number, number>()
for (const m of readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
).matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  ADVANCE.set(Number(m[1]), Number(m[2]))
const textW = (s: string): number =>
  [...s].reduce((w, c) => w + (ADVANCE.get(c.codePointAt(0) ?? 0) ?? 0), 0)

describe('warehouse-view §5.2: tier-2 props and signage plates', () => {
  const plates: (Rect & { text: string })[] = SIGNAGE.map((p) => ({
    text: p.text,
    x: p.x,
    y: p.y,
    w: textW(p.text) + PLATE_PAD,
    h: PLATE_H,
  }))
  const floor: Rect = {
    x: TILE,
    y: TILE,
    w: ROOM_W - 2 * TILE,
    h: ROOM_H - TILE,
  }

  it('INTAKE / HOLD / SHELF / QUARANTINE plates sit on the floor, apart', () => {
    expect(plates.map((p) => p.text)).toEqual([
      'INTAKE',
      'HOLD',
      'SHELF',
      'QUARANTINE',
    ])
    for (const p of plates) {
      expect(p.w, p.text).toBeGreaterThan(PLATE_PAD)
      expect(p.x, p.text).toBeGreaterThanOrEqual(floor.x)
      expect(p.x + p.w, p.text).toBeLessThanOrEqual(floor.x + floor.w)
      expect(p.y + p.h, p.text).toBeLessThanOrEqual(ROOM_H)
    }
    for (let i = 0; i < plates.length; i++)
      for (let j = i + 1; j < plates.length; j++)
        expect(
          overlaps(plates[i] as Rect, plates[j] as Rect),
          `${plates[i]?.text} vs ${plates[j]?.text}`,
        ).toBe(false)
  })

  it('the plates clear the slots-5–6 strip, the shelf badge, the rack and the bin counter', () => {
    const avoid: [string, Rect][] = [
      ['ext', layout.extRect()],
      ['shelf badge', SHELF_BADGE],
      ['rack', RACK],
      [
        'bin counter',
        { x: BIN_COUNTER.x - 12, y: BIN_COUNTER.y - 8, w: 24, h: 16 },
      ],
    ]
    for (const p of plates)
      for (const [name, r] of avoid)
        expect(overlaps(p, r), `${p.text} vs ${name}`).toBe(false)
  })

  it('the strip lights flank the north-wall sign; the shelving unit and the printed poster share the props column apart', () => {
    for (const s of STRIP_LIGHTS) {
      const r = { x: s.x, y: s.y, w: 64, h: 8 }
      expect(overlaps(r, SIGN), `strip at ${s.x}`).toBe(false)
      expect(r.x + r.w).toBeLessThanOrEqual(ROOM_W)
    }
    for (const p of PROPS_T2) {
      const unit = { x: p.x, y: p.y, w: 48, h: 64 }
      expect(overlaps(unit, POSTER)).toBe(false)
      expect(overlaps(unit, RACK)).toBe(false)
      expect(unit.x + unit.w).toBeLessThanOrEqual(ROOM_W - TILE)
    }
  })
})

// ---- M6: the Hold Bay station (spec-build2 §2.6, §4.4; design-m6 §6.4) --------

/** A worker sprite's box for feet (x, y): 24 × 32, origin (0.5, 1), 4 px below the feet. */
const spriteBox = (p: Point): Rect => ({
  x: p.x - 12,
  y: p.y - 28,
  w: 24,
  h: 32,
})

const ROOM_FLOOR: Rect = {
  x: TILE,
  y: TILE,
  w: ROOM_W - 2 * TILE,
  h: ROOM_H - TILE,
}

const within = (a: Rect, b: Rect): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

const signagePlates = (): [string, Rect][] =>
  SIGNAGE.map((p) => [
    `plate ${p.text}`,
    { x: p.x, y: p.y, w: textW(p.text) + PLATE_PAD, h: PLATE_H },
  ])

const propRects = (): { tier: 1 | 2 | 3; name: string; r: Rect }[] => [
  ...PROPS_T1.map((p, i) => ({
    tier: 1 as const,
    name: `props_t1[${i}]`,
    r: { x: p.x, y: p.y, ...PROP_T1_SIZE },
  })),
  ...PROPS_T2.map((p, i) => ({
    tier: 2 as const,
    name: `props_t2[${i}]`,
    r: { x: p.x, y: p.y, ...PROP_T2_SIZE },
  })),
  ...PROPS_T3.map((p, i) => ({
    tier: 3 as const,
    name: `props_t3[${i}]`,
    r: { x: p.x, y: p.y, ...PROP_T3_SIZE },
  })),
]

/** Every tap rect of the room (the scene's pick order covers the same set). */
function tapRects(): [string, Rect][] {
  const out: [string, Rect][] = [
    ['poster hit', POSTER_HIT],
    ['station hit', HOLD_STATION_HIT],
    ['sign', SIGN],
    ['dock panel', DOCK_PANEL],
  ]
  for (let i = 0; i < BAY_COUNT; i++) out.push([`bay ${i}`, bayRect(i)])
  // Docks 2–3 (M8): one 56 × 56 tap rect (door + pad) whether owned or not.
  for (let k = 2; k <= DOCK_COUNT; k++)
    out.push([`dock ${k} hit`, (dockGeom(k) as { hit: Rect }).hit])
  for (const id of ['dock1', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5']) {
    out.push([`${id} hit`, layout.hitFor(id) as Rect])
  }
  out.push(['bin hit', layout.hitFor('bin') as Rect])
  out.push(['shelf hit', layout.hitFor('shelf') as Rect])
  for (let k = 1; k <= 4; k++)
    out.push([`desk hit slot${k}`, layout.deskHit(`slot${k}`) as Rect])
  return out
}

/** Points every `step` px along from → pts (the endpoints included). */
function samples(from: Point, pts: readonly Point[], step = 2): Point[] {
  const out: Point[] = [{ ...from }]
  let prev = from
  for (const p of pts) {
    const len = Math.hypot(p.x - prev.x, p.y - prev.y)
    for (let d = step; d < len; d += step)
      out.push({
        x: prev.x + ((p.x - prev.x) * d) / len,
        y: prev.y + ((p.y - prev.y) * d) / len,
      })
    out.push({ ...p })
    prev = p
  }
  return out
}

describe('spec-build2 §4.4 (M6): the Hold Bay station, the poster and the props', () => {
  it('the station sits east of the rack above the bin, the poster at (272, 120)', () => {
    expect({ ...HOLD_STATION }).toEqual({ x: 264, y: 300, w: 48, h: 48 })
    expect({ x: POSTER.x, y: POSTER.y }).toEqual({ x: 272, y: 120 })
    expect(HOLD_STATION.x).toBeGreaterThanOrEqual(RACK.x + RACK.w)
    const bin = layout.rectFor('bin') as Rect
    expect(HOLD_STATION.y + HOLD_STATION.h).toBeLessThanOrEqual(bin.y)
    expect(within(HOLD_STATION, ROOM_FLOOR)).toBe(true)
    expect(within(POSTER, ROOM_FLOOR)).toBe(true)
  })

  it('the station and poster tap rects are ≥ 44 px and cover their art', () => {
    for (const [name, hit, art] of [
      ['station', HOLD_STATION_HIT, HOLD_STATION],
      ['poster', POSTER_HIT, POSTER],
    ] as const) {
      expect(Math.min(hit.w, hit.h), name).toBeGreaterThanOrEqual(44)
      expect(within(art, hit), name).toBe(true)
      expect(within(hit, ROOM_FLOOR), name).toBe(true)
    }
  })

  for (const [W, H] of [
    [360, 604],
    [393, 659],
  ] as const) {
    it(`at ${W}×${H}: the poster hit, the station, the bays and every other tap rect never overlap and sit between the HUD bands`, () => {
      const p = fit(W, H)
      expect(p.fits).toBe(true)
      const screen = (r: Rect): Rect => ({
        x: p.roomX + r.x,
        y: p.roomY + r.y,
        w: r.w,
        h: r.h,
      })
      const taps = tapRects().map(([n, r]) => [n, screen(r)] as const)
      const band: Rect = {
        x: 0,
        y: HUD_TOP_H,
        w: W,
        h: H - HUD_TOP_H - HUD_BOTTOM_H,
      }
      for (const [n, r] of taps) expect(within(r, band), n).toBe(true)
      for (let i = 0; i < taps.length; i++)
        for (let j = i + 1; j < taps.length; j++) {
          const [a, ra] = taps[i] as readonly [string, Rect]
          const [b, rb] = taps[j] as readonly [string, Rect]
          expect(overlaps(ra, rb), `${a} vs ${b}`).toBe(false)
        }
    })
  }

  it('the station, the poster and each tier’s props share the east column apart, clear of the fixtures and plates', () => {
    const fixed: [string, Rect][] = [
      ['rack', RACK],
      ['bin', layout.rectFor('bin') as Rect],
      ['shelf', layout.rectFor('shelf') as Rect],
      ['shelf badge', SHELF_BADGE],
      ['dock panel', DOCK_PANEL],
      ...signagePlates(),
    ]
    const props = propRects()
    const east: [string, Rect][] = [
      ['station', HOLD_STATION],
      ['poster', POSTER],
      ['poster hit', POSTER_HIT],
      ['station hit', HOLD_STATION_HIT],
      ...props.map((p) => [p.name, p.r] as [string, Rect]),
    ]
    for (const [n, r] of east) {
      expect(within(r, ROOM_FLOOR), n).toBe(true)
      for (const [f, fr] of fixed)
        expect(overlaps(r, fr), `${n} vs ${f}`).toBe(false)
    }
    // A prop never sits under the poster, its hit, the station or its hit
    // (a tap there must never land on scenery).
    for (const p of props)
      for (const [n, r] of east.slice(0, 4))
        expect(overlaps(p.r, r), `${p.name} vs ${n}`).toBe(false)
    expect(overlaps(POSTER_HIT, HOLD_STATION_HIT)).toBe(false)
    // Props of one tier never overlap each other (tiers never show together).
    for (let i = 0; i < props.length; i++)
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i] as (typeof props)[number]
        const b = props[j] as (typeof props)[number]
        if (a.tier !== b.tier) continue
        expect(overlaps(a.r, b.r), `${a.name} vs ${b.name}`).toBe(false)
      }
  })

  it('stationAt hits the station cell only; nodeAt never returns it', () => {
    const cx = HOLD_STATION.x + HOLD_STATION.w / 2
    const cy = HOLD_STATION.y + HOLD_STATION.h / 2
    expect(layout.stationAt(cx, cy)).toBe(true)
    expect(layout.nodeAt(cx, cy)).toBeNull()
    expect(layout.stationAt(264, 300)).toBe(true)
    expect(layout.stationAt(311, 347)).toBe(true)
    expect(layout.stationAt(312, 300)).toBe(false)
    expect(layout.stationAt(264, 348)).toBe(false)
    expect(layout.stationAt(263, 320)).toBe(false)
    for (let i = 0; i < BAY_COUNT; i++) {
      const r = bayRect(i)
      expect(layout.stationAt(r.x + r.w / 2, r.y + r.h / 2), `bay ${i}`).toBe(
        false,
      )
    }
    for (const r of [POSTER, layout.rectFor('bin') as Rect])
      expect(layout.stationAt(r.x + r.w / 2, r.y + r.h / 2)).toBe(false)
  })

  it('the sorter stands in the station’s east half facing the rack, its sprite on the floor and off the rack, bin, poster and props', () => {
    expect(inside(SORTER_STAND, HOLD_STATION)).toBe(true)
    expect(SORTER_STAND.x).toBeGreaterThanOrEqual(
      HOLD_STATION.x + HOLD_STATION.w / 2,
    )
    expect(SORTER_FACING).toBe('w')
    const box = spriteBox(SORTER_STAND)
    expect(within(box, ROOM_FLOOR)).toBe(true)
    const avoid: [string, Rect][] = [
      ['rack', RACK],
      ['bin', layout.rectFor('bin') as Rect],
      ['poster hit', POSTER_HIT],
      ...propRects().map((p) => [p.name, p.r] as [string, Rect]),
      ...signagePlates(),
    ]
    for (const [n, r] of avoid) expect(overlaps(box, r), n).toBe(false)
  })

  it('the sorter walks in from the dock door on axis-aligned legs, south of the rack, never under a badge-layer plate', () => {
    const path = layout.stationWalkPath()
    expect(path[0]).toEqual(DOOR_POINT)
    expect(path[path.length - 1]).toEqual(SORTER_STAND)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as Point
      const b = path[i] as Point
      expect(a.x === b.x || a.y === b.y, `leg ${i}`).toBe(true)
    }
    expect(path.some((p) => p.x === AISLE_X)).toBe(true)
    expect(path.some((p) => p.y === STATION_ROW_Y)).toBe(true)
    // Front-layer rects drawn ABOVE the workers (badges): the walker never
    // passes under one, so it never vanishes behind a plate or the panel.
    const above: [string, Rect][] = [
      ['dock panel', DOCK_PANEL],
      ['shelf badge', SHELF_BADGE],
      ['ext strip', layout.extRect()],
      ...signagePlates(),
    ]
    const room: Rect = { x: 0, y: 0, w: ROOM_W, h: ROOM_H }
    const feetOff: [string, Rect][] = [
      ['rack', RACK],
      ['bin', layout.rectFor('bin') as Rect],
      ['shelf', layout.rectFor('shelf') as Rect],
    ]
    // The stretch every slot-1 inspector already walks (door → aisle → its
    // row, under the tier-2 INTAKE plate) is the playtest-1 path, not M6's.
    const shared = layout.walkPath(
      'slot1',
      layout.standPoints('slot1')[0] as Point,
    )
    const sharedRowY = (shared[2] as Point).y
    const own = samples(path[0] as Point, path.slice(1)).filter(
      (pt) => !(pt.x <= AISLE_X && pt.y <= sharedRowY),
    )
    expect(own.length).toBeGreaterThan(100)
    for (const pt of own) {
      const box = spriteBox({ x: Math.round(pt.x), y: Math.round(pt.y) })
      expect(within(box, room), `${pt.x},${pt.y}`).toBe(true)
      for (const [n, r] of above)
        expect(overlaps(box, r), `${n} at ${pt.x},${pt.y}`).toBe(false)
      for (const [n, r] of feetOff)
        expect(inside(pt, r), `feet on ${n} at ${pt.x},${pt.y}`).toBe(false)
    }
  })

  it('the Sorter Arm’s 64 × 64 canvas sits bottom-centred on the station, between the rack and the east wall, clear of the props and the bin', () => {
    const arm: Rect = { ...SORTER_ARM_AT, ...SORTER_ARM_SIZE }
    expect(arm.x + arm.w / 2).toBe(HOLD_STATION.x + HOLD_STATION.w / 2)
    expect(arm.y + arm.h).toBe(HOLD_STATION.y + HOLD_STATION.h)
    expect(within(arm, ROOM_FLOOR)).toBe(true)
    const avoid: [string, Rect][] = [
      ['rack', RACK],
      ['bin', layout.rectFor('bin') as Rect],
      ['poster hit', POSTER_HIT],
      ...propRects().map((p) => [p.name, p.r] as [string, Rect]),
      ...signagePlates(),
    ]
    for (const [n, r] of avoid) expect(overlaps(arm, r), n).toBe(false)
  })

  it('the way out reverses the walk-in back to the dock door', () => {
    const out = layout.stationExitPath(SORTER_STAND)
    const back = layout.stationWalkPath().slice(0, -1).toReversed()
    expect(out).toEqual(back)
    expect(out[out.length - 1]).toEqual(DOOR_POINT)
  })

  it('the rack lamp `S` badge sits on the rack under the lamp, clear of every bay pad', () => {
    const cap: Rect = {
      x: RACK_S_BADGE.x,
      y: RACK_S_BADGE.y + CAP_TOP,
      w: textW('S'),
      h: CAP_H,
    }
    expect(cap.w).toBeGreaterThan(0)
    expect(within(cap, RACK)).toBe(true)
    const lamp: Rect = { x: RACK_LAMP.x, y: RACK_LAMP.y, w: 8, h: 8 }
    expect(overlaps(cap, lamp)).toBe(false)
    expect(cap.y).toBeGreaterThanOrEqual(lamp.y + lamp.h)
    for (let i = 0; i < BAY_COUNT; i++)
      expect(overlaps(cap, bayRect(i)), `bay ${i}`).toBe(false)
  })
})

// ---- M8: docks 2–3 and tier 3 (design-m8-m9 §6.1, R7, R8, R13) --------------

/** The 10 × 10 mini parcel (its 16 × 16 canvas, transparent margin aside) centred on `p`. */
const miniBox = (p: Point): Rect => ({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 })

describe('design-m8-m9 §6.1 (M8): docks 2–3 geometry', () => {
  it('dock k is dock 1 moved down 64(k − 1): door, tail, lamp, door point (the design table)', () => {
    expect(dockGeom(1)).toEqual({
      index: 1,
      door: { x: 0, y: 36, w: 32, h: 56 },
      tail: { x: 0, y: 44, w: 40, h: 40 },
      lamp: { x: 12, y: 24 },
      doorPoint: { ...DOOR_POINT },
      pad: null,
      hit: layout.hitFor('dock1'),
    })
    expect(dockGeom(2)).toEqual({
      index: 2,
      door: { x: 0, y: 100, w: 32, h: 56 },
      tail: { x: 0, y: 108, w: 40, h: 40 },
      lamp: { x: 12, y: 92 },
      doorPoint: { x: 20, y: 128 },
      pad: { x: 32, y: 100, w: 24, h: 56 },
      hit: { x: 0, y: 100, w: 56, h: 56 },
    })
    expect(dockGeom(3)).toEqual({
      index: 3,
      door: { x: 0, y: 164, w: 32, h: 56 },
      tail: { x: 0, y: 172, w: 40, h: 40 },
      lamp: { x: 12, y: 156 },
      doorPoint: { x: 20, y: 192 },
      pad: { x: 32, y: 164, w: 24, h: 56 },
      hit: { x: 0, y: 164, w: 56, h: 56 },
    })
    expect(dockGeom(0)).toBeNull()
    expect(dockGeom(DOCK_COUNT + 1)).toBeNull()
    // The playtest-1 locked doors are docks 2–3's doors (economy.docks order).
    expect(LOCKED_DOORS).toEqual([dockGeom(2)?.door, dockGeom(3)?.door])
    const docks = dataFixture().economy.docks.map((r) => r.index)
    expect(docks).toEqual([2, 3])
  })

  it('the layout finds a dock by its node or its conveyor id; pads are the dock 2–3 conveyors only', () => {
    expect(dockIndexOf('dock3')).toBe(3)
    expect(dockIndexOf('conv2')).toBe(2)
    expect(dockIndexOf('slot2')).toBeNaN()
    expect(layout.dockGeom('conv3')).toEqual(dockGeom(3))
    expect(layout.dockGeom('dock1')).toEqual(dockGeom(1))
    expect(layout.isPad('conv1')).toBe(false)
    expect(layout.isPad('conv2')).toBe(true)
    expect(layout.isPad('conv3')).toBe(true)
    expect(layout.isPad('dock2')).toBe(false)
    expect(layout.labelFor('dock2')).toBe('Dock 2')
    expect(layout.labelFor('dock3')).toBe('Dock 3')
  })

  it('each pad conveyor: six spots head first (north pair leaves next), every 10 × 10 mini inside the pad and apart, entry on it', () => {
    const cap = dataFixture().machines.conveyorCapPerDock
    expect(PAD_SPOTS).toHaveLength(cap)
    for (const k of [2, 3]) {
      const pad = dockGeom(k)?.pad as Rect
      expect(layout.rectFor(`conv${k}`)).toEqual(pad)
      expect(pad).toMatchObject({ x: DOCK_PAD.x, w: DOCK_PAD.w })
      const a = layout.anchorsFor(`conv${k}`)
      expect(a.buffer).toHaveLength(cap)
      // The design's spots: (39|50, y + 11|27|43).
      expect(a.buffer).toEqual([
        { x: 39, y: pad.y + 11 },
        { x: 50, y: pad.y + 11 },
        { x: 39, y: pad.y + 27 },
        { x: 50, y: pad.y + 27 },
        { x: 39, y: pad.y + 43 },
        { x: 50, y: pad.y + 43 },
      ])
      for (const p of a.buffer) {
        expect(within(miniBox(p), pad), `conv${k} ${p.x},${p.y}`).toBe(true)
        for (const q of a.buffer)
          if (q !== p) expect(overlaps(miniBox(p), miniBox(q))).toBe(false)
      }
      for (let i = 1; i < a.buffer.length; i++)
        expect((a.buffer[i] as Point).y).toBeGreaterThanOrEqual(
          (a.buffer[i - 1] as Point).y,
        )
      expect(inside(a.entry, pad)).toBe(true)
      expect(layout.hitFor(`conv${k}`)).toBeNull()
      expect(within(pad, layout.rectFor(`dock${k}`) as Rect)).toBe(true)
    }
  })

  it('a pad parcel hops north onto conv1’s line, then the corner and slot 1; a dock unloads straight onto its pad', () => {
    const head = layout.anchorsFor('slot1').buffer[0] as Point
    for (const k of [2, 3]) {
      const path = layout.pathBetween(`conv${k}`, 'slot1', head)
      expect(path).toEqual([PAD_EXIT, { x: 144, y: 64 }, head])
      const conv1 = layout.rectFor('conv1') as Rect
      expect(inside(PAD_EXIT, conv1)).toBe(true)
      // The hop leaves the pad north, east of dock 1's tail (x 0–39).
      expect(PAD_EXIT.x).toBeGreaterThanOrEqual(
        (dockGeom(1)?.tail.x ?? 0) + (dockGeom(1)?.tail.w ?? 0),
      )
      const spot = layout.anchorsFor(`conv${k}`).buffer[0] as Point
      expect(layout.pathBetween(`dock${k}`, `conv${k}`, spot)).toEqual([spot])
    }
    expect(layout.pathBetween('conv1', 'slot1', head)).toEqual([
      { x: 144, y: 64 },
      head,
    ])
  })

  it('doors, tails and lamps stay on the west wall and never overlap each other; each lamp sits just above its door', () => {
    const parts: [string, Rect][] = []
    for (let k = 1; k <= DOCK_COUNT; k++) {
      const g = dockGeom(k)
      if (!g) continue
      const lamp = { ...g.lamp, w: 8, h: 8 }
      expect(lamp.y + lamp.h, `lamp ${k}`).toBeLessThanOrEqual(g.door.y)
      expect(g.door.y - (lamp.y + lamp.h), `lamp ${k}`).toBeLessThanOrEqual(4)
      expect(inside(g.doorPoint, g.door) || inside(g.doorPoint, g.tail)).toBe(
        true,
      )
      expect(within(g.tail, { x: 0, y: 0, w: ROOM_W, h: ROOM_H })).toBe(true)
      parts.push([`door ${k}`, g.door], [`lamp ${k}`, lamp])
    }
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const [a, ra] = parts[i] as [string, Rect]
        const [b, rb] = parts[j] as [string, Rect]
        expect(overlaps(ra, rb), `${a} vs ${b}`).toBe(false)
      }
    // Tails of different docks never touch (three vehicles at once).
    const tails = [1, 2, 3].map((k) => dockGeom(k)?.tail as Rect)
    expect(overlaps(tails[0] as Rect, tails[1] as Rect)).toBe(false)
    expect(overlaps(tails[1] as Rect, tails[2] as Rect)).toBe(false)
  })

  it('R7: the desk strip, w1 and the aisle moved east off the pads on every desk slot', () => {
    expect(DESK_HIT_X).toBe(56)
    expect(W1_X).toBe(68)
    expect(AISLE_X).toBe(68)
    const pads = [2, 3].map((k) => dockGeom(k)?.pad as Rect)
    const dockHits = [2, 3].map((k) => dockGeom(k)?.hit as Rect)
    for (let k = 1; k <= 4; k++) {
      const id = `slot${k}`
      const strip = layout.deskHit(id) as Rect
      const slot = layout.rectFor(id) as Rect
      expect(strip).toEqual({ x: 56, y: slot.y, w: 40, h: 64 })
      // The strip meets the slot's own hit (x 96) — one continuous desk tap.
      expect(strip.x + strip.w).toBe((layout.hitFor(id) as Rect).x)
      for (const h of dockHits)
        expect(overlaps(strip, h), `${id} strip vs dock`).toBe(false)
      const w1 = layout.standPoints(id)[0] as Point
      expect(w1).toEqual({ x: 68, y: slot.y + 36 })
      for (const p of pads)
        expect(overlaps(spriteBox(w1), p), `${id} w1 vs pad`).toBe(false)
      const desk = layout.deskAt(id) as Point
      expect(overlaps(spriteBox(w1), { ...desk, w: 48, h: 32 })).toBe(false)
    }
  })

  it('every walk to a desk stand point (and the sorter’s) keeps the walker off the dock 2–3 pads and doors', () => {
    const avoid: [string, Rect][] = [2, 3].flatMap((k) => {
      const g = dockGeom(k)
      return g?.pad
        ? ([
            [`pad ${k}`, g.pad],
            [`door ${k}`, g.door],
          ] as [string, Rect][])
        : []
    })
    const walks: Point[][] = [layout.stationWalkPath()]
    for (let k = 1; k <= 4; k++)
      for (const st of layout.standPoints(`slot${k}`))
        walks.push(layout.walkPath(`slot${k}`, st))
    for (const path of walks) {
      expect(path[0]).toEqual(DOOR_POINT)
      // Only the stretch past dock 1's row (y ≥ 96) can reach the pads.
      for (const pt of samples(path[0] as Point, path.slice(1))) {
        if (pt.y < 96) continue
        const box = spriteBox({ x: Math.round(pt.x), y: Math.round(pt.y) })
        for (const [n, r] of avoid)
          expect(overlaps(box, r), `${n} at ${pt.x},${pt.y}`).toBe(false)
      }
    }
  })

  it('nodeAt resolves docks 2–3 (door + pad) and their hits are ≥ 44 px, inside the room', () => {
    for (const k of [2, 3]) {
      const h = layout.hitFor(`dock${k}`) as Rect
      expect(h).toEqual(dockGeom(k)?.hit)
      expect(Math.min(h.w, h.h)).toBeGreaterThanOrEqual(44)
      expect(layout.nodeAt(h.x + h.w / 2, h.y + h.h / 2)).toBe(`dock${k}`)
      expect(layout.nodeAt(4, h.y + 4)).toBe(`dock${k}`)
    }
    // Between the docks' hits (x 56) the desk strip belongs to the scene.
    expect(layout.nodeAt(60, 130)).toBeNull()
  })
})

describe('design-m8-m9 §6.1 / R13 (M8): tier-3 shelf grid and props', () => {
  it('tiers 1–2 keep 18 × 3 @ 12 from (38, 390); tiers ≥ 3 draw 20 × 5 @ 11 from (35, 388)', () => {
    expect(shelfGrid(1)).toEqual(SHELF_GRID_T1)
    expect(shelfGrid(2)).toEqual(SHELF_GRID_T1)
    expect(SHELF_GRID_T1).toEqual({
      cols: 18,
      rows: 3,
      pitch: 12,
      origin: { x: 38, y: 390 },
    })
    for (const t of [3, 4, 5]) expect(shelfGrid(t)).toEqual(SHELF_GRID_T3)
    expect(SHELF_GRID_T3).toEqual({
      cols: 20,
      rows: 5,
      pitch: 11,
      origin: { x: 35, y: 388 },
    })
    expect(SHELF_MAX_CELLS).toBe(100)
    expect(new FixedLaneLayout(2).shelfCapacity()).toBe(54)
    expect(new FixedLaneLayout(3).shelfCapacity()).toBe(100)
    expect(new FixedLaneLayout().tier).toBe(1)
  })

  it('the tier-3 grid holds every shelf cap of L3–L5 inside the shelf rect; minis never overlap and clear the badge', () => {
    const lay = new FixedLaneLayout(3)
    const shelf = lay.rectFor('shelf') as Rect
    const caps = dataFixture()
      .levels.filter((l) => l.warehouseTier >= 3)
      .map((l) => l.shelfCap)
    expect(caps.length).toBeGreaterThan(0)
    expect(lay.shelfCapacity()).toBeGreaterThanOrEqual(Math.max(...caps))
    const cells: Rect[] = []
    for (let i = 0; i < lay.shelfCapacity(); i++) {
      const c = lay.shelfCell(i)
      const mini = { x: c.x, y: c.y, w: 10, h: 10 }
      expect(within(mini, shelf), `cell ${i}`).toBe(true)
      expect(overlaps(mini, SHELF_BADGE), `cell ${i} vs badge`).toBe(false)
      cells.push(mini)
    }
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++)
        expect(overlaps(cells[i] as Rect, cells[j] as Rect)).toBe(false)
    // The shelf node's anchors follow the tier (the flight targets).
    const a = lay.anchorsFor('shelf').buffer
    expect(a).toHaveLength(100)
    expect(a[0]).toEqual({ x: 40, y: 393 })
    expect(a[99]).toEqual({ x: 35 + 19 * 11 + 5, y: 388 + 4 * 11 + 5 })
    // Every other rect is the same at tier 1 and tier 3 (rows unchanged).
    for (const n of laneAt(3))
      expect(lay.rectFor(n.id), n.id).toEqual(layout.rectFor(n.id))
  })

  it('props per tier: one set per group, tiers 4–5 on the tier-3 spot; the tier-3 props clear the poster, the station and the plates', () => {
    expect(propGroup(1)).toBe(1)
    expect(propGroup(2)).toBe(2)
    expect(propGroup(3)).toBe(3)
    expect(propGroup(5)).toBe(3)
    expect(propsFor(1)).toEqual(PROPS_T1)
    expect(propsFor(2)).toEqual(PROPS_T2)
    expect(propsFor(3)).toEqual(PROPS_T3)
    expect(propsFor(5)).toEqual(PROPS_T3)
    expect(new FixedLaneLayout(3).props()).toEqual(PROPS_T3)
    for (const p of PROPS_T3) {
      const r = { ...p, ...PROP_T3_SIZE }
      for (const [n, o] of [
        ['poster hit', POSTER_HIT],
        ['station hit', HOLD_STATION_HIT],
        ['rack', RACK],
        ...signagePlates(),
      ] as [string, Rect][])
        expect(overlaps(r, o), n).toBe(false)
      expect(within(r, ROOM_FLOOR)).toBe(true)
    }
  })
})
