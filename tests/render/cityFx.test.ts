// The city's M3 flourishes (plan.md §12.6 tasks 5 + 9; city-view.md §1.4,
// §2, §9.6; spec-core.md §3.5, §9.2, Q33), pinned on the pure timelines the
// scene drives its sprites from (src/render/cityFx.ts). M7 (spec-build2
// §3.3, design-m7 §6.8): the magic parcel's markers over A and B, its
// countdown ring (magicRingStep: the rush ring's steps) and the gold hop.
// M8 (design-m8-m9 §6.2, docks 2–3): the bay lights and docked poses by
// dock NUMBER, and the dock run that maps the hidden dock column onto the
// SW face's bays (continuous, never moving the queue head). M9 (B2
// §4.2–§4.3, design-m8-m9 §6.2): the L4 / L5 regions open in pairs (one
// crossfade), with unique sprites and `_locked` twins for every building and
// prop; tiers 4–5 swap in with three lamps and three docked poses (dock 3
// before dock 2 at L4); the ground fog follows scenery rows that name a
// region (cityFx.groundRegionAt: the runway with the Airport).
import { describe, expect, it, vi } from 'vitest'
import {
  BAY_LIGHTS,
  bayLightShown,
  CONSTRUCTION_MS,
  CONSTRUCTION_SWAP_MS,
  DOCK_BAY_DEPTH,
  DOCK_BLEND_TILES,
  DOCK_POSE_CANVAS,
  DOCK_POSE_DEPTH,
  DOCK_POSES_CANVAS,
  dockBlend,
  dockPoseAt,
  dockPoseCanvas,
  dockPosesCanvas,
  dockRunBlend,
  dockRunRadius,
  dustFrame,
  fadeK,
  groundRegionAt,
  grumbleDue,
  GRUMBLE_EVERY_MS,
  honkShown,
  hopIcon,
  LEGACY_WH_ANCHORS,
  levelStampText,
  magicMarkers,
  magicRingStep,
  manifestWarehouseAnchors,
  maxDockNumber,
  moodFor,
  RING_STEPS,
  ringStep,
  SIGN_POP_MS,
  signCracked,
  signDaysText,
  signPopFrame,
  SMOKE_FRAMES,
  SMOKE_PERIOD_MS,
  SMOKE_PHASE_MS,
  SMOKE_PUFFS,
  smokePuff,
  STAMP_MS,
  STAMP_RISE_MS,
  STAMP_RISE_PX,
  stampPose,
  UNLOCK_FADE_MS,
  warehouseAnchors,
  WH_ANCHOR_FRAME,
  WH_CANVAS,
} from '../../src/render/cityFx.ts'
import { WH_ANCHORS } from '../../src/render/frames.generated.ts'
import {
  blockRect,
  buildGameData,
  groundAt,
  isRoadTile,
  mapBlockAt,
} from '../../src/data/index.ts'
import {
  footprintAnchor,
  originX,
  screenToTileF,
  tileToScreen,
  tileTopLeft,
} from '../../src/render/iso.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'
import { FRAMES } from '../../src/render/frames.generated.ts'
import { buildingSprite, inAtlas } from '../../src/render/frames.ts'
import { ticksFromS } from '../../src/sim/types.ts'
import { createViewSim } from '../../src/sim/view-api.ts'
import {
  acceptOffer,
  noOffers,
  offerQuest,
  openingA,
  quietSim,
  runTicks,
  runUntil,
  startQuest,
} from '../sim/helpers.ts'

// ground.ts imports Phaser for its bake (the M9 fog test bakes a fake scene).
vi.mock('phaser', () => ({
  default: {
    Renderer: { Events: { RESTORE_WEBGL: 'restorewebgl' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}))

const data = buildGameData(loadRawData())
const sat = data.economy.satisfaction
const lot = data.map.lot

describe('region unlock (§1.4): 1 s crossfade, then sign_pop 3 frames / 300 ms', () => {
  it('the fade runs 0 → 1 over exactly 1 s', () => {
    expect(UNLOCK_FADE_MS).toBe(1000)
    expect(fadeK(0, UNLOCK_FADE_MS)).toBe(0)
    expect(fadeK(500, UNLOCK_FADE_MS)).toBe(0.5)
    expect(fadeK(UNLOCK_FADE_MS, UNLOCK_FADE_MS)).toBe(1)
    expect(fadeK(Infinity, UNLOCK_FADE_MS)).toBe(1)
  })

  it('the sign pops through frames 0, 1, 2 and is gone at 300 ms', () => {
    expect(SIGN_POP_MS).toBe(300)
    expect(signPopFrame(0)).toBe(0)
    expect(signPopFrame(99)).toBe(0)
    expect(signPopFrame(100)).toBe(1)
    expect(signPopFrame(250)).toBe(2)
    expect(signPopFrame(300)).toBeNull()
  })
})

describe('level-up moment (§9.6): fx_dust 4 × 250 ms, swap on the reveal, the stamp', () => {
  it('scaffold, dust, dust, reveal at 250-ms steps, then nothing', () => {
    expect(CONSTRUCTION_MS).toBe(1000)
    expect([0, 249, 250, 500, 999].map(dustFrame)).toEqual([0, 0, 1, 2, 3])
    expect(dustFrame(1000)).toBeNull()
  })

  it('the exterior swaps to the new tier as the reveal frame starts', () => {
    expect(CONSTRUCTION_SWAP_MS).toBe(750)
    expect(dustFrame(CONSTRUCTION_SWAP_MS)).toBe(3)
  })

  it('stamp reads LEVEL 2 — LOCAL for the levels.json L2 row', () => {
    const l2 = data.levels.find((l) => l.level === 2)
    expect(l2).toBeDefined()
    expect(levelStampText(2, l2?.title ?? '')).toBe('LEVEL 2 — LOCAL')
  })

  it('the stamp rises 24 px over 1.2 s from the roof, then fades out', () => {
    expect(stampPose(0)).toEqual({ dy: 0, alpha: 1 })
    const mid = stampPose(STAMP_RISE_MS / 2)
    expect(mid?.dy).toBeLessThan(0)
    expect(mid?.dy).toBeGreaterThan(-STAMP_RISE_PX)
    expect(stampPose(STAMP_RISE_MS)).toEqual({ dy: -STAMP_RISE_PX, alpha: 1 })
    const late = stampPose(STAMP_MS - 1)
    expect(late?.dy).toBe(-STAMP_RISE_PX)
    expect(late?.alpha).toBeLessThan(0.05)
    expect(stampPose(STAMP_MS)).toBeNull()
  })
})

describe('mood overlays (spec §9.2): flower boxes ≥ 80, shutters < 30', () => {
  it('uses economy.satisfaction thresholds', () => {
    expect(sat.happyAbove).toBe(80)
    expect(sat.loudBelow).toBe(30)
    expect(moodFor(29, sat)).toBe('unhappy')
    expect(moodFor(30, sat)).toBeNull()
    expect(moodFor(sat.start, sat)).toBeNull() // a fresh unlock shows none
    expect(moodFor(79, sat)).toBeNull()
    expect(moodFor(80, sat)).toBe('happy')
    expect(moodFor(100, sat)).toBe('happy')
  })

  it('an angry label grumbles at once, then every 20 s', () => {
    expect(GRUMBLE_EVERY_MS).toBe(20_000)
    expect(grumbleDue(null, 5)).toBe(true)
    expect(grumbleDue(5, 5 + 19_999)).toBe(false)
    expect(grumbleDue(5, 5 + 20_000)).toBe(true)
  })
})

describe('days since last incident (Q33): cracked for one day after a loss', () => {
  it('whole before any loss, cracked at 0 after one, whole again at 1', () => {
    expect(signCracked(0, false)).toBe(false)
    expect(signCracked(0, true)).toBe(true)
    expect(signCracked(1, true)).toBe(false)
    expect(signDaysText(0)).toBe('0 days')
    expect(signDaysText(1)).toBe('1 day')
    expect(signDaysText(12)).toBe('12 days')
  })
})

describe('honking queue (§2): ic_honk 500 ms every 4 s, phase id mod 4', () => {
  it('shows 500 ms of every 4 s', () => {
    let shown = 0
    for (let t = 0; t < 4000; t += 10) if (honkShown(t, 0)) shown += 10
    expect(shown).toBe(500)
  })

  it('vehicles 1 s apart in id mod 4 honk in turn', () => {
    expect(honkShown(0, 0)).toBe(true)
    expect(honkShown(0, 1)).toBe(false)
    expect(honkShown(3000, 1)).toBe(true)
    expect(honkShown(0, 4)).toBe(true)
  })
})

describe('warehouse exterior hand-off: bay lights and the docked pose', () => {
  it('the anchors are the manifest-measured ones (frames.generated WH_ANCHORS)', () => {
    const fromManifest = manifestWarehouseAnchors()
    expect(fromManifest).not.toBeNull()
    expect(BAY_LIGHTS).toEqual(fromManifest?.bayLights)
    expect(DOCK_POSE_CANVAS).toEqual(fromManifest?.dockPose)
    expect(warehouseAnchors(WH_ANCHOR_FRAME)).toEqual(fromManifest)
    expect(WH_ANCHORS.wh_ext_t1).toEqual(fromManifest)
    // t2 is an edit of t1 on the same footprint: its own set (frameAnchors).
    expect(WH_ANCHORS.wh_ext_t2?.bayLights).toHaveLength(3)
    expect(warehouseAnchors('wh_ext_t2')).toEqual(WH_ANCHORS.wh_ext_t2)
  })

  it('lights sit on the bay lamps of the visible SW face of the 256-px canvas', () => {
    expect(BAY_LIGHTS).toHaveLength(3)
    for (const [x, y] of BAY_LIGHTS) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(WH_CANVAS / 2) // the visible SW face
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(WH_CANVAS)
    }
  })

  it('the docked pose is on the canvas and on the lot, not the avenue', () => {
    const [px, py] = DOCK_POSE_CANVAS
    expect(px).toBeGreaterThanOrEqual(0)
    expect(px).toBeLessThan(WH_CANVAS)
    expect(py).toBeLessThanOrEqual(WH_CANVAS)
    const map = data.map
    const ox = originX(map.size[1])
    const anchor = footprintAnchor(
      lot.warehouse.tile,
      lot.warehouse.footprint,
      ox,
    )
    const t = screenToTileF(
      anchor.x - WH_CANVAS / 2 + px,
      anchor.y - WH_CANVAS + py,
      ox,
    )
    const lotBlock = map.blocks.find((b) => b.kind === 'lot')
    const rect = lotBlock
      ? blockRect(map, lotBlock.block[0], lotBlock.block[1])
      : null
    expect(rect).not.toBeNull()
    const [x0, y0, x1, y1] = rect ?? [0, 0, 0, 0]
    expect(t.tx).toBeGreaterThan(x0 - 0.5)
    expect(t.tx).toBeLessThan(x1 + 0.5)
    expect(t.ty).toBeGreaterThan(y0 - 0.5)
    expect(t.ty).toBeLessThan(y1 + 0.5)
  })

  it('reads the per-frame table: the frame, else tier 1', () => {
    const row = { bayLights: [[10, 20]], dockPose: [30, 40] } as const
    const t2 = { bayLights: [[11, 21]], dockPose: [31, 41] } as const
    const table = { wh_ext_t1: row, wh_ext_t2: t2 }
    expect(manifestWarehouseAnchors('wh_ext_t1', table)).toEqual(row)
    expect(manifestWarehouseAnchors('wh_ext_t2', table)).toEqual(t2)
    // A tier without its own set falls back to tier 1.
    expect(manifestWarehouseAnchors('wh_ext_t3', table)).toEqual(row)
  })

  it('falls back to the playtest-1 set when the table has neither', () => {
    for (const bad of [
      {},
      { wh_ext_t3: { bayLights: [], dockPose: [1, 2] } },
    ] as const) {
      expect(manifestWarehouseAnchors('wh_ext_t1', bad)).toBeNull()
      expect(warehouseAnchors('wh_ext_t1', bad)).toEqual(LEGACY_WH_ANCHORS)
    }
    expect(LEGACY_WH_ANCHORS).toEqual({
      bayLights: [
        [47, 139],
        [71, 151],
        [96, 163],
      ],
      dockPose: [40, 178],
    })
  })

  const dock = lot.docks[0] as [number, number]
  const lotX0 = lot.entrance[0] + 1

  it('a vehicle on the dock tile is drawn fully at the pose', () => {
    expect(dockBlend(dock[0], dock[1], dock, lotX0)).toBe(1)
  })

  it('the queue head and the avenue are untouched; the approach blends', () => {
    const head = lot.queue[0] as [number, number]
    expect(Math.hypot(head[0] - dock[0], head[1] - dock[1])).toBe(
      DOCK_BLEND_TILES,
    )
    expect(dockBlend(head[0], head[1], dock, lotX0)).toBe(0)
    // The entrance is on the avenue column: no offset for through-traffic.
    expect(dockBlend(lot.entrance[0], lot.entrance[1], dock, lotX0)).toBe(0)
    const mid = dockBlend(dock[0], dock[1] + 1.5, dock, lotX0)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('the parking row behind the sprite is never moved', () => {
    for (const [x, y] of lot.parking)
      expect(dockBlend(x, y, dock, lotX0)).toBe(0)
  })

  it('blends continuously along the drive from the queue head onto the dock', () => {
    let prev = 0
    for (let ty = dock[1] + DOCK_BLEND_TILES; ty >= dock[1]; ty -= 0.05) {
      const w = dockBlend(dock[0], ty, dock, lotX0)
      expect(Math.abs(w - prev)).toBeLessThan(0.03)
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = w
    }
  })
})

/** Lamps 0..2 lit for `owned` docks on a frame with `lamps` lamps. */
function lit(owned: string[], lamps: number): number[] {
  return [0, 1, 2].filter((k) => bayLightShown(k, owned, lamps))
}

describe('M8 docks 2–3: lights and docked poses by dock number (design-m8-m9 §6.2)', () => {
  const map = data.map
  const ox = originX(map.size[1])
  const wa = footprintAnchor(lot.warehouse.tile, lot.warehouse.footprint, ox)
  const lotX0 = lot.entrance[0] + 1
  const head = lot.queue[0] as [number, number]
  const runOf = (n: number) =>
    lot.docks.slice(0, n) as unknown as readonly (readonly [number, number])[]
  /** CityScene.placeDockPose: each bay's world offset from its dock tile. */
  const posesFor = (frame: string) =>
    lot.docks.map((tile, i) => {
      const [px, py] = dockPoseCanvas(warehouseAnchors(frame), i + 1)
      const t = tileToScreen(tile[0], tile[1], ox)
      return {
        dx: wa.x - WH_CANVAS / 2 + px - t.x,
        dy: wa.y - WH_CANVAS + py - t.y,
      }
    })
  /** The drawn foot point of a vehicle at (tx, ty) over the run of n docks. */
  const drawn = (
    tx: number,
    ty: number,
    n: number,
    poses: { dx: number; dy: number }[],
  ) => {
    const run = runOf(n)
    const h = dockRunBlend(tx, ty, run, lotX0, dockRunRadius(run, head))
    const o = dockPoseAt(poses, h.at)
    const s = tileToScreen(tx, ty, ox)
    return { x: s.x + o.dx * h.w, y: s.y + o.dy * h.w, w: h.w, at: h.at }
  }

  it('the lot has three dock tiles in a run; the tier-1 poses are the manifest’s, [0] = bay 1', () => {
    expect(lot.docks).toHaveLength(3)
    expect(DOCK_POSES_CANVAS).toHaveLength(3)
    expect(DOCK_POSES_CANVAS[0]).toEqual(DOCK_POSE_CANVAS)
    expect(DOCK_POSES_CANVAS).toEqual(WH_ANCHORS.wh_ext_t1?.dockPoses)
  })

  it('dockPoseCanvas: the frame’s own, else the lamp offset, else extrapolated (t3: two bays)', () => {
    const own = {
      bayLights: [
        [10, 20],
        [30, 30],
      ],
      dockPose: [5, 50],
      dockPoses: [
        [5, 50],
        [26, 61],
      ],
    } as const
    expect(dockPoseCanvas(own, 1)).toEqual([5, 50])
    expect(dockPoseCanvas(own, 2)).toEqual([26, 61])
    // A debug dock 3 on a two-bay frame: one more bay-to-bay step.
    expect(dockPoseCanvas(own, 3)).toEqual([47, 72])
    const lamps = {
      bayLights: [
        [10, 20],
        [30, 30],
        [50, 40],
      ],
      dockPose: [5, 50],
    } as const
    expect(dockPosesCanvas(lamps)).toEqual([
      [5, 50],
      [25, 60],
      [45, 70],
    ])
    const one = { bayLights: [[10, 20]], dockPose: [5, 50] } as const
    expect(dockPosesCanvas(one)).toEqual([
      [5, 50],
      [5, 50],
      [5, 50],
    ])
    expect(dockPosesCanvas(LEGACY_WH_ANCHORS)).toEqual([
      [40, 178],
      [64, 190],
      [89, 202],
    ])
    // t3 (brick, 2 bays): its dock 3 pose continues along the face.
    const t3 = warehouseAnchors('wh_ext_t3')
    expect(t3.bayLights).toHaveLength(2)
    const [p1, p2, p3] = dockPosesCanvas(t3) as [
      [number, number],
      [number, number],
      [number, number],
    ]
    expect(p3).toEqual([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]])
  })

  for (const frame of [
    'wh_ext_t1',
    'wh_ext_t2',
    'wh_ext_t3',
    'wh_ext_t4',
    'wh_ext_t5',
  ]) {
    it(`${frame}: a vehicle docked at bay k stands at bay k's pose, on the lot, bays in order along the SW face`, () => {
      const poses = posesFor(frame)
      const a = warehouseAnchors(frame)
      const lotBlock = map.blocks.find((b) => b.kind === 'lot')
      const rect = lotBlock
        ? blockRect(map, lotBlock.block[0], lotBlock.block[1])
        : null
      expect(rect).not.toBeNull()
      const [x0, y0, x1, y1] = rect ?? [0, 0, 0, 0]
      let prev: { x: number; y: number } | null = null
      lot.docks.forEach(([tx, ty], i) => {
        const d = drawn(tx, ty, 3, poses)
        expect(d.w).toBe(1)
        expect(d.at).toBe(i)
        const [px, py] = dockPoseCanvas(a, i + 1)
        expect(d.x).toBe(wa.x - WH_CANVAS / 2 + px)
        expect(d.y).toBe(wa.y - WH_CANVAS + py)
        const t = screenToTileF(d.x, d.y, ox)
        expect(t.tx).toBeGreaterThan(x0 - 0.5)
        expect(t.tx).toBeLessThan(x1 + 0.5)
        expect(t.ty).toBeGreaterThan(y0 - 0.5)
        expect(t.ty).toBeLessThan(y1 + 0.5)
        // Bay k + 1 is further along the face: right of and below bay k.
        if (prev) {
          expect(d.x).toBeGreaterThan(prev.x)
          expect(d.y).toBeGreaterThan(prev.y)
        }
        prev = { x: d.x, y: d.y }
      })
    })
  }

  it('the run radius never reaches the queue head (3 / 2 / 1 tiles for 1 / 2 / 3 docks)', () => {
    expect(dockRunRadius(runOf(1), head)).toBe(DOCK_BLEND_TILES)
    expect(dockRunRadius(runOf(2), head)).toBe(2)
    expect(dockRunRadius(runOf(3), head)).toBe(1)
    for (const n of [1, 2, 3]) {
      const run = runOf(n)
      const r = dockRunRadius(run, head)
      for (const q of lot.queue)
        expect(dockRunBlend(q[0], q[1], run, lotX0, r).w).toBe(0)
      for (const q of lot.parking)
        expect(dockRunBlend(q[0], q[1], run, lotX0, r).w).toBe(0)
      expect(
        dockRunBlend(lot.entrance[0], lot.entrance[1], run, lotX0, r).w,
      ).toBe(0)
    }
  })

  it('with one dock the run is exactly the pre-M8 dockBlend (L1–L2 runs draw as before)', () => {
    const dock = lot.docks[0] as [number, number]
    /** The M7 rule verbatim (cityFx.dockBlend before the run). */
    const m7 = (tx: number, ty: number): number => {
      const near = 1 - Math.hypot(tx - dock[0], ty - dock[1]) / DOCK_BLEND_TILES
      if (near <= 0) return 0
      const inLot = Math.max(0, Math.min(1, (tx - (lotX0 - 1)) * 2))
      const inColumn = Math.max(0, Math.min(1, (ty - dock[1] + 0.5) * 2))
      return Math.min(1, near) * inLot * inColumn
    }
    const r = dockRunRadius(runOf(1), head)
    for (let tx = 17; tx <= 24; tx += 0.25)
      for (let ty = 19; ty <= 28; ty += 0.25) {
        const h = dockRunBlend(tx, ty, runOf(1), lotX0, r)
        expect(h.w).toBeCloseTo(m7(tx, ty), 12)
        expect(dockBlend(tx, ty, dock, lotX0)).toBeCloseTo(m7(tx, ty), 12)
        expect(h.at).toBe(0)
      }
  })

  it('driving in from the entrance or the queue head onto any bay never jumps', () => {
    const poses = posesFor('wh_ext_t4')
    const routes: [number, number][][] = [
      // entrance → along the column north (dock 1), onto dock 2, south (dock 3)
      [
        [19, 23],
        [20, 23],
        [20, 22],
      ],
      [
        [19, 23],
        [20, 23],
      ],
      [
        [19, 23],
        [20, 23],
        [20, 24],
      ],
      // queue head → north along the run
      [
        [20, 25],
        [20, 24],
        [20, 23],
        [20, 22],
      ],
    ]
    for (const n of [1, 2, 3])
      for (const route of routes) {
        let prev = drawn(route[0]![0], route[0]![1], n, poses)
        for (let i = 0; i + 1 < route.length; i++) {
          const [ax, ay] = route[i]!
          const [bx, by] = route[i + 1]!
          for (let u = 0.02; u <= 1.0001; u += 0.02) {
            const d = drawn(ax + (bx - ax) * u, ay + (by - ay) * u, n, poses)
            // 0.02 tile of road is ≈ 0.7 px; the pose blend adds at most a few px.
            expect(
              Math.hypot(d.x - prev.x, d.y - prev.y),
              `n=${n} ${route.join(' → ')}`,
            ).toBeLessThan(6)
            prev = d
          }
        }
      }
  })

  it('dockPoseAt interpolates between bays and clamps outside the run', () => {
    const poses = [
      { dx: -60, dy: 20 },
      { dx: 0, dy: 20 },
      { dx: 60, dy: 18 },
    ]
    expect(dockPoseAt(poses, 0)).toEqual({ dx: -60, dy: 20 })
    expect(dockPoseAt(poses, 0.5)).toEqual({ dx: -30, dy: 20 })
    expect(dockPoseAt(poses, 2)).toEqual({ dx: 60, dy: 18 })
    expect(dockPoseAt(poses, 7)).toEqual({ dx: 60, dy: 18 })
    expect(dockPoseAt(poses, -1)).toEqual({ dx: -60, dy: 20 })
    expect(dockPoseAt([], 1)).toEqual({ dx: 0, dy: 0 })
  })

  it('bays further along draw over earlier ones, inside the footprint’s depth slot', () => {
    // A vehicle's dot / glyph ride +0.01 / +0.02 over it (DEPTH.mood / bell).
    expect(DOCK_BAY_DEPTH).toBeGreaterThan(0.02)
    expect(DOCK_POSE_DEPTH + 2 * DOCK_BAY_DEPTH + 0.02).toBeLessThan(0.5)
  })

  it('lamps by dock number: dock 3 before dock 2 lights lamps 1 and 3; t3 hides the third', () => {
    expect(lit(['dock1'], 3)).toEqual([0])
    expect(lit(['dock1', 'dock2'], 3)).toEqual([0, 1])
    expect(lit(['dock1', 'dock3'], 3)).toEqual([0, 2])
    expect(lit(['dock1', 'dock2', 'dock3'], 3)).toEqual([0, 1, 2])
    expect(lit(['dock1', 'dock2', 'dock3'], 2)).toEqual([0, 1])
    expect(maxDockNumber(['dock1'])).toBe(1)
    expect(maxDockNumber(['dock1', 'dock3'])).toBe(3)
    expect(maxDockNumber([])).toBe(1)
  })

  it('through the facade: buying dock 2 at L3 adds dock2 to vs.docks (the lamp and the run follow)', () => {
    const sim = quietSim(1)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
    sim.state.economy.balance = 1_000_000
    const vs = createViewSim(() => sim)
    expect(vs.lane.buyDock(2).ok).toBe(true)
    const owned = vs.docks.map((d) => d.id)
    expect(owned).toEqual(['dock1', 'dock2'])
    expect(maxDockNumber(owned)).toBe(2)
    expect([0, 1, 2].filter((k) => bayLightShown(k, owned, 2))).toEqual([0, 1])
  })
})

describe('Industrial smoke (§1.3): fx_smoke_f0..3 at 4 fps, 3 puffs, phase offset', () => {
  it('a puff steps one frame per 250 ms and rises', () => {
    expect(SMOKE_PERIOD_MS).toBe(1000)
    const frames = [0, 250, 500, 750].map((t) => smokePuff(t, 0, 0).frame)
    expect(frames).toEqual([0, 1, 2, 3])
    expect(smokePuff(900, 0, 0).dy).toBeLessThan(smokePuff(100, 0, 0).dy)
  })

  it('the 3 puffs of an emitter are a third of a cycle apart', () => {
    expect(SMOKE_PUFFS).toBe(3)
    const seen = new Set([0, 1, 2].map((k) => smokePuff(0, 0, k).frame))
    expect(seen.size).toBe(SMOKE_PUFFS)
    for (let k = 0; k < SMOKE_PUFFS; k++) {
      const p = smokePuff(123, 0, k)
      expect(p.frame).toBeGreaterThanOrEqual(0)
      expect(p.frame).toBeLessThan(SMOKE_FRAMES)
    }
  })

  it('neighbouring emitters are out of phase', () => {
    const a = smokePuff(0, 0, 0)
    const b = smokePuff(0, SMOKE_PHASE_MS, 0)
    expect(a.dy).not.toBe(b.dy)
  })

  it('the six emitters come from the five Industrial smoke anchors', async () => {
    const { SMOKE_ANCHORS } =
      await import('../../src/render/frames.generated.ts')
    const n = Object.values(SMOKE_ANCHORS).reduce((s, a) => s + a.length, 0)
    expect(n).toBe(6)
    for (const id of Object.keys(SMOKE_ANCHORS)) {
      const b = data.buildings.find((x) => x.id === id)
      expect(b?.district).toBe('industrial')
    }
  })
})

describe('M7 magic parcel in the city (B2 §3.3, design-m7 §6.8)', () => {
  it("magicRingStep: the rush ring's 4 steps at 75 / 50 / 25 % remaining", () => {
    expect(RING_STEPS).toBe(4)
    expect(
      [1, 0.76, 0.75, 0.51, 0.5, 0.26, 0.25, 0.01, 0].map(magicRingStep),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3])
    for (const r of [1, 0.8, 0.6, 0.4, 0.2, 0])
      expect(magicRingStep(r)).toBe(ringStep(r))
  })

  it('out-of-range and NaN remainders clamp (full ring above 1, empty below 0 and for NaN)', () => {
    expect(magicRingStep(2)).toBe(0)
    expect(magicRingStep(-1)).toBe(3)
    expect(magicRingStep(Number.NaN)).toBe(3)
  })

  it('every step has a magic_ring frame and a rush_ring twin (same geometry, gold ramp)', () => {
    const frames: Record<string, string> = FRAMES
    for (let k = 0; k < RING_STEPS; k++) {
      expect(frames[`magic_ring_${k}`]).toBe(`magic_ring_${k}`)
      expect(frames[`rush_ring_${k}`]).toBe(`rush_ring_${k}`)
    }
    expect(frames.ic_magic).toBe('ic_magic')
  })

  it('the hop icon is ic_magic for the golden parcel, ic_parcel_<size> otherwise', () => {
    expect(hopIcon({ size: 'S', magic: true })).toBe('ic_magic')
    expect(hopIcon({ size: 'S', magic: false })).toBe('ic_parcel_s')
    expect(hopIcon({ size: 'XL', magic: false })).toBe('ic_parcel_xl')
  })

  const route = { origin: 'a', dest: 'b' }
  const magicQ = (over: Record<string, unknown> = {}) =>
    ({
      progress: {
        kind: 'magicParcel',
        parcelId: 7,
        origin: 'a',
        dest: 'b',
        deliveredTick: null,
        onTime: false,
      },
      route,
      ticksLeft: 900,
      limitTicks: 1200,
      ...over,
    }) as unknown as Parameters<typeof magicMarkers>[0]

  it('markers on A and B with the countdown fraction while the golden parcel is on its way', () => {
    expect(magicMarkers(magicQ())).toEqual({
      origin: 'a',
      dest: 'b',
      remaining01: 0.75,
    })
  })

  it('no markers: no quest, no route (an offer), another kind, delivered, or the countdown over', () => {
    expect(magicMarkers(null)).toBeNull()
    expect(magicMarkers(magicQ({ route: null }))).toBeNull()
    expect(
      magicMarkers(magicQ({ progress: { kind: 'deliveriesFrom', count: 3 } })),
    ).toBeNull()
    expect(
      magicMarkers(
        magicQ({
          progress: {
            kind: 'magicParcel',
            parcelId: 7,
            origin: 'a',
            dest: 'b',
            deliveredTick: 50,
            onTime: true,
          },
        }),
      ),
    ).toBeNull()
    expect(magicMarkers(magicQ({ ticksLeft: 0 }))).toBeNull()
    expect(magicMarkers(magicQ({ ticksLeft: null }))).toBeNull()
  })

  it('B2 §3.3 "while it is alive": past the countdown (or with no quest) the live golden parcel keeps both markers, the ring empty', () => {
    const live = { origin: 'a', dest: 'b' }
    expect(magicMarkers(null, live)).toEqual({
      origin: 'a',
      dest: 'b',
      remaining01: 0,
    })
    expect(magicMarkers(magicQ({ ticksLeft: 0 }), live)?.remaining01).toBe(0)
    // While the countdown runs the quest's ring wins.
    expect(magicMarkers(magicQ(), live)?.remaining01).toBe(0.75)
  })

  it('through the facade: an accepted Special delivery marks its A and B, the ring drains, the markers outlive a late fail and clear on delivery', () => {
    const sim = noOffers(quietSim(5))
    openingA(sim)
    const vs = createViewSim(() => sim)
    offerQuest(sim, 'magic_parcel')
    // An offer has no route yet: nothing in the city.
    expect(magicMarkers(vs.quests().offer)).toBeNull()
    expect(magicMarkers(vs.quests().active)).toBeNull()
    acceptOffer(sim)
    const pr = sim.state.quests.active?.progress
    if (pr?.kind !== 'magicParcel' || pr.origin === null)
      throw new Error('not magic')
    // Keep the bike out of A's district: the parcel waits out its countdown.
    const bike = sim.state.vehicles[0]
    if (!bike) throw new Error('no bike')
    const a = data.buildings.find((b) => b.id === pr.origin)?.district
    sim.dispatch({
      kind: 'setZone',
      id: bike.id,
      zone: a === 'highres' ? 'downtown' : 'highres',
    })
    const m0 = magicMarkers(vs.quests().active)
    expect(m0).toEqual({ origin: pr.origin, dest: pr.dest, remaining01: 1 })
    expect(magicRingStep(m0?.remaining01 ?? 0)).toBe(0)
    const countdown = ticksFromS(data.parcels.magic.countdownS)
    runTicks(sim, Math.round(countdown * 0.6))
    const m = magicMarkers(vs.quests().active)
    expect(m?.origin).toBe(pr.origin)
    expect(m?.dest).toBe(pr.dest)
    expect(m?.remaining01).toBeCloseTo(0.4, 2)
    expect(magicRingStep(m?.remaining01 ?? 0)).toBe(2)
    // Past the deadline the quest failed and left the slot, but the golden
    // parcel is still alive: A and B keep their markers, the ring empty.
    runTicks(sim, Math.round(countdown * 0.4) + 1)
    const qs = vs.quests()
    expect(qs.active).toBeNull()
    expect(qs.magic).toEqual({
      parcelId: pr.parcelId,
      origin: pr.origin,
      dest: pr.dest,
    })
    expect(magicMarkers(qs.active, qs.magic)).toEqual({
      origin: pr.origin,
      dest: pr.dest,
      remaining01: 0,
    })
    // Delivered (late): gone from the city.
    sim.dispatch({ kind: 'setZone', id: bike.id, zone: 'any' })
    runUntil(sim, () => vs.quests().magic === null, 6000)
    expect(vs.quests().magic).toBeNull()
    expect(magicMarkers(vs.quests().active, vs.quests().magic)).toBeNull()
  })

  it('the parcel itself carries the golden hop icon', () => {
    const sim = noOffers(quietSim(3))
    openingA(sim)
    const q = startQuest(sim, 'magic_parcel')
    if (q.progress.kind !== 'magicParcel' || q.progress.parcelId === null)
      throw new Error('not magic')
    const p = sim.state.parcels[String(q.progress.parcelId)]
    expect(p && hopIcon(p)).toBe('ic_magic')
  })
})

// ---------------------------------------------------------------- M9 L4 / L5 (B2 §4.2–§4.3)

/** The regions each level opens (levels.json unlockRegions). */
const M9_REGIONS: Record<number, string[]> = {
  4: ['lowres', 'rural'],
  5: ['airport', 'civic'],
}
const M9_IDS = Object.values(M9_REGIONS).flat()

describe('M9 the L4 / L5 regions unlock through the crossfade (design-m8-m9 §6.2)', () => {
  it('levels.json: L4 opens Low-density + Rural, L5 the Airport + Park & civic', () => {
    for (const [lv, ids] of Object.entries(M9_REGIONS)) {
      const row = data.levels.find((l) => l.level === Number(lv))
      expect(row?.unlockRegions.toSorted()).toEqual(ids.toSorted())
    }
  })

  it('both regions of a level are live before its first region:unlocked: one crossfade and one ground re-bake carry the pair', () => {
    const sim = quietSim(1)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 }).ok).toBe(true)
    const vs = createViewSim(() => sim)
    for (const id of M9_IDS) expect(vs.regionState(id)).toBe('locked')
    const seen: { district: string; live: string[] }[] = []
    let order: string[] = []
    sim.events.on('level:up', () => order.push('level:up'))
    sim.events.on('region:unlocked', (p) => {
      order.push('region:unlocked')
      seen.push({
        district: p.district,
        live: M9_IDS.filter((id) => vs.regionState(id) === 'live'),
      })
    })
    for (const lv of [4, 5]) {
      seen.length = 0
      order = []
      expect(sim.dispatch({ kind: 'debugForceLevel', level: lv }).ok).toBe(true)
      const ids = M9_REGIONS[lv] ?? []
      expect(seen.map((s) => s.district).toSorted()).toEqual(ids.toSorted())
      // CityScene.applyLockState on the first event sees every change.
      for (const id of ids) expect(seen[0]?.live).toContain(id)
      // The exterior swap (level:up) starts before the fog lifts.
      expect(order[0]).toBe('level:up')
    }
  })

  it('every building of the four regions draws its own unique sprite, in colour and `_locked`, in the world atlas', () => {
    const all = data.buildings.map((b) => buildingSprite(b.id))
    const rows = data.buildings.filter((b) => M9_IDS.includes(b.district))
    // 10 Low-density + 10 Rural + 2 Airport + 10 Park & civic (PB2 §6).
    expect(rows).toHaveLength(32)
    for (const b of rows) {
      const stem = buildingSprite(b.id)
      expect(
        all.filter((s) => s === stem),
        `${b.id} shares ${stem}`,
      ).toEqual([stem])
      expect(inAtlas(stem, 'world'), stem).toBe(true)
      expect(inAtlas(`${stem}_locked`, 'world'), `${stem}_locked`).toBe(true)
    }
  })

  it('their props (fence, hay_bale, the plane, the tower, trees, benches) and the fountain have colour + `_locked` frames', () => {
    const props = data.map.props.filter((p) => M9_IDS.includes(p.region))
    const stems = new Set([...props.map((p) => p.frame), 'fountain'])
    for (const want of ['fence', 'hay_bale', 'ap_plane', 'ap_tower'])
      expect(stems.has(want), want).toBe(true)
    for (const stem of stems) {
      expect(inAtlas(stem, 'world'), stem).toBe(true)
      expect(inAtlas(`${stem}_locked`, 'world'), `${stem}_locked`).toBe(true)
    }
    // Every region opens with some scenery of its own.
    for (const id of M9_IDS)
      expect(
        props.some((p) => p.region === id),
        `${id} has props`,
      ).toBe(true)
  })
})

describe('M9 tiers 4–5: the exterior swap on level-up (B2 §6.6; design-m8-m9 §6.2)', () => {
  it('L4 / L5 swap to wh_ext_t4 / _t5 (world atlas) under LEVEL 4 — NATIONAL / LEVEL 5 — TYCOON', () => {
    const want: Record<number, [string, string]> = {
      4: ['wh_ext_t4', 'LEVEL 4 — NATIONAL'],
      5: ['wh_ext_t5', 'LEVEL 5 — TYCOON'],
    }
    for (const [lv, [frame, stamp]] of Object.entries(want)) {
      const row = data.levels.find((l) => l.level === Number(lv))
      expect(row && `wh_ext_t${row.warehouseTier}`).toBe(frame)
      expect(inAtlas(frame, 'world'), frame).toBe(true)
      expect(levelStampText(Number(lv), row?.title ?? '')).toBe(stamp)
    }
  })

  it('both carry three measured lamps and three docked poses: all three docks light and park at their own bay', () => {
    for (const frame of ['wh_ext_t4', 'wh_ext_t5'] as const) {
      const a = WH_ANCHORS[frame]
      expect(a?.bayLights, frame).toHaveLength(3)
      expect(a?.dockPoses, frame).toHaveLength(3)
      expect(a?.dockPoses?.[0]).toEqual(a?.dockPose)
      expect(warehouseAnchors(frame)).toEqual(a)
      for (const [x, y] of a?.bayLights ?? []) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(WH_CANVAS / 2)
        expect(y).toBeLessThan(WH_CANVAS)
      }
      for (let n = 1; n <= 3; n++)
        expect(dockPoseCanvas(warehouseAnchors(frame), n)).toEqual(
          a?.dockPoses?.[n - 1],
        )
      expect(
        lit(['dock1', 'dock2', 'dock3'], a?.bayLights.length ?? 0),
      ).toEqual([0, 1, 2])
    }
  })

  it('through the facade at L4: dock 3 bought before dock 2 lights lamps 1 and 3 on t4, dock 2 then lamp 2', () => {
    const sim = quietSim(1)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    sim.state.economy.balance = 1_000_000
    const vs = createViewSim(() => sim)
    const tier = data.levels.find((l) => l.level === vs.level)?.warehouseTier
    expect(tier).toBe(4)
    const lamps = warehouseAnchors(`wh_ext_t${tier}`).bayLights.length
    expect(vs.lane.buyDock(3).ok).toBe(true)
    let owned = vs.docks.map((d) => d.id)
    expect(owned).toEqual(['dock1', 'dock3'])
    expect(maxDockNumber(owned)).toBe(3)
    expect([0, 1, 2].filter((k) => bayLightShown(k, owned, lamps))).toEqual([
      0, 2,
    ])
    expect(vs.lane.buyDock(2).ok).toBe(true)
    owned = vs.docks.map((d) => d.id)
    expect([0, 1, 2].filter((k) => bayLightShown(k, owned, lamps))).toEqual([
      0, 1, 2,
    ])
  })
})

describe('M9 ground fog by region (cityFx.groundRegionAt; style-guide §2.2: the runway is the Airport’s locked scenery)', () => {
  const map = data.map
  /** The shipped map with scenery rows tagged as the M9 data row does it. */
  const tagged = (rows: unknown[]) =>
    ({
      ...map,
      ground: { ...map.ground, scenery: [...rows, ...map.ground.scenery] },
    }) as unknown as typeof map

  it('a region block → its district; the lot, roads and scenery blocks → never fogged', () => {
    // Rural block (0, 0): tiles 4–10 × 4–10.
    expect(groundRegionAt(map, 5, 5)).toBe('rural')
    expect(groundRegionAt(map, 37, 8)).toBe('airport')
    expect(groundRegionAt(map, 22, 41)).toBe('civic')
    const [lx, ly] = lot.warehouse.tile
    expect(groundRegionAt(map, lx, ly)).toBeNull()
    expect(groundRegionAt(map, 11, 5)).toBeNull() // an avenue
    expect(groundRegionAt(map, 38, 38)).toBeNull() // the lake block
    for (let y = 0; y < map.size[1]; y++)
      for (let x = 0; x < map.size[0]; x++) {
        const b = mapBlockAt(map, x, y)
        if (b?.kind === 'region' && !isRoadTile(map, x, y))
          expect(groundRegionAt(map, x, y)).toBe(b.region)
      }
  })

  it('a scenery row naming a region fogs with it (first matching row wins); rows naming none never fog', () => {
    const m = tagged([
      {
        name: 't',
        rect: [45, 3, 47, 3],
        frame: 'runway_threshold',
        region: 'airport',
      },
      { name: 'u', rect: [44, 3, 47, 19], frame: 'runway' },
    ])
    expect(groundRegionAt(m, 46, 3)).toBe('airport')
    expect(groundRegionAt(m, 46, 10)).toBeNull() // the untagged row wins below
    // Off-block scenery the rows do not cover (the west sea): never fogged.
    expect(groundRegionAt(m, 0, 40)).toBeNull()
    // Blocks and roads ignore scenery rows.
    expect(groundRegionAt(m, 5, 5)).toBe('rural')
  })

  it('the bake stamps a tagged runway `_locked` while the Airport is locked, in colour once it opens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { bakeGround, GROUND_Y } = await import('../../src/render/ground.ts')
    const m = tagged([
      {
        name: 'apron',
        rect: [44, 3, 44, 19],
        frame: 'tarmac',
        region: 'airport',
      },
      {
        name: 'west',
        rect: [45, 3, 45, 19],
        frame: 'runway',
        region: 'airport',
      },
    ])
    const ox = originX(m.size[1])
    const frameAt = (
      calls: { frame: string; x: number; y: number }[],
      x: number,
      y: number,
    ) => {
      const tl = tileTopLeft(x, y, ox)
      return calls.find((c) => c.x === tl.x && c.y === tl.y - GROUND_Y)?.frame
    }
    for (const locked of [true, false]) {
      const { scene, calls } = fakeGroundScene()
      bakeGround(scene as never, m, {
        isLocked: (id) => locked && id === 'airport',
      })
      const s = locked ? '_locked' : ''
      expect(frameAt(calls, 44, 10)).toBe(`tarmac${s}`)
      expect(frameAt(calls, 45, 10)).toBe(`runway${s}`)
      // The shipped centre-line row (behind these) is tagged too since M9.
      expect(frameAt(calls, 46, 10)).toBe(`runway_stripe${s}`)
      // A block tile of the locked Airport fogs as before.
      expect(frameAt(calls, 37, 8)).toBe(`${groundAt(m, 37, 8)}${s}`)
    }
    vi.restoreAllMocks()
  })

  const shippedTagged = data.map.ground.scenery.some(
    (r) => (r as { region?: unknown }).region !== undefined,
  )
  it.skipIf(!shippedTagged)(
    'shipped map: every runway / taxiway / apron tile fogs with the Airport',
    () => {
      for (let y = 0; y < map.size[1]; y++)
        for (let x = 0; x < map.size[0]; x++) {
          const f = groundAt(map, x, y)
          if (/^(runway|taxiway|tarmac)/.test(f) && !mapBlockAt(map, x, y))
            expect(groundRegionAt(map, x, y), `${x},${y} ${f}`).toBe('airport')
        }
    },
  )
})

/** A scene just rich enough for bakeGround (ground-slab.test.ts's fake). */
function fakeGroundScene() {
  const calls: { frame: string; x: number; y: number }[] = []
  const chain: Record<string, unknown> = new Proxy(
    {},
    { get: () => () => chain },
  )
  const dt = {
    key: 'ground',
    clear() {},
    render() {},
    stamp(_atlas: string, frame: string, x: number, y: number) {
      calls.push({ frame, x, y })
    },
  }
  const scene = {
    textures: {
      exists: () => false,
      addDynamicTexture: () => dt,
      get: () => ({ has: () => true }),
    },
    add: { image: () => chain },
    game: { renderer: { on() {}, off() {} } },
    events: { once() {}, off() {} },
  }
  return { scene, calls }
}
