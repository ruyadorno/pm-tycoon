// Warehouse M8 room smoke (design-m8-m9 §6.1; plan-build2 §8.5 tasks 3, 6):
// LaneRenderer + DockView over a minimal fake Phaser scene, driven by a real
// sim from L1 through the L3 tier swap to docks 2–3 bought and a busy fleet.
// Pins what the pure tests cannot: every frame the room sets exists in the
// atlases (no `__MISSING`), nothing throws across syncAll / update /
// onLevelUp / onBought, parcels on the dock 2–3 roller pads are drawn as
// minis and lane parcels as full frames, the tier swap moves the layout to
// the 20 × 5 shelf grid, and the per-dock tooltips read the docks.
// M9 (design-m8-m9 §6.1, R2, R21): the rooms of tiers 4 and 5 — built the
// way the scene's hard re-layout builds them (new layers + a renderer on
// `new FixedLaneLayout(tier)` + syncAll + unrollOpened) — draw only packed
// frames, as many floor rows as `rowsForTier`, slots 5–6 in the belt
// column, the ext strip `6` (tier 4) or none (tier 5), the neon strips at
// tier 5 with their flicker frame, and the Sorter Arm bought at L4 standing
// in the station and swinging on onArmToss.
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

const { LaneRenderer, createRoomLayers } =
  await import('../../src/render/warehouse/LaneRenderer.ts')
const { DockView } = await import('../../src/render/warehouse/DockView.ts')
const { Fx } = await import('../../src/render/warehouse/Fx.ts')
const { FixedLaneLayout, rowsForTier, ROOM_COLS } =
  await import('../../src/render/warehouse/RoomLayout.ts')
const { SORTER_ARM_ID } = await import('../../src/sim/systems/sorter.ts')
const { createViewSim } = await import('../../src/sim/view-api.ts')
const { buy, fund, makeSim, runSeconds } = await import('../sim/helpers.ts')
const { isFrame } = await import('../../src/render/frames.generated.ts')

type Fake = Record<string, unknown> & {
  x: number
  y: number
  frame: { name: string }
  list: Fake[]
}

/** Frames the room asked for that the atlases lack. */
const missing: string[] = []
const check = (f: unknown): void => {
  if (typeof f !== 'string' || !isFrame(f)) missing.push(String(f))
}

/** A game object stub: chainable setters, a frame name, container children. */
function fakeObject(frame = ''): Fake {
  const o = {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    visible: true,
    active: true,
    alpha: 1,
    text: '',
    font: 'm5x7',
    tintTopLeft: 0,
    originX: 0,
    originY: 0,
    list: [] as Fake[],
    parentContainer: null as Fake | null,
    frame: { name: frame },
    texture: { key: 'world' },
  } as unknown as Fake
  const set =
    (fn: (...a: never[]) => void) =>
    (...a: never[]): Fake => {
      fn(...a)
      return o
    }
  const noop = set(() => {})
  Object.assign(o, {
    setOrigin: noop,
    setCrop: noop,
    setTint: noop,
    setDepth: noop,
    setFont: noop,
    setDropShadow: noop,
    setMaxWidth: noop,
    setSize: noop,
    lineStyle: noop,
    strokeRect: noop,
    fillStyle: noop,
    fillRect: noop,
    clear: noop,
    bringToTop: noop,
    setVisible: set((v: boolean) => (o.visible = v)),
    setActive: set((v: boolean) => (o.active = v)),
    setAlpha: set((a: number) => (o.alpha = a)),
    setFrame: set((f: string) => {
      check(f)
      o.frame = { name: f }
    }),
    setPosition: set((x: number, y?: number) => {
      o.x = x
      if (y !== undefined) o.y = y
    }),
    setX: set((x: number) => (o.x = x)),
    setY: set((y: number) => (o.y = y)),
    setText: set((t: string) => {
      o.text = String(t)
      o.width = 5 * String(t).length
    }),
    destroy: () => (o.active = false),
    add: set((c: Fake | Fake[]) => {
      for (const k of [c].flat()) {
        k.parentContainer = o
        o.list.push(k)
      }
    }),
    addAt: set((c: Fake, i: number) => {
      c.parentContainer = o
      o.list.splice(i, 0, c)
    }),
    getIndex: (c: Fake) => o.list.indexOf(c),
  })
  return o
}

interface TweenCfg {
  targets: unknown
  onUpdate?: () => void
  onComplete?: () => void
  [k: string]: unknown
}

/** A scene stub whose tweens complete on flush() and whose clock advances on tick(). */
function fakeScene() {
  let now = 0
  const pending: TweenCfg[] = []
  const scene = {
    add: {
      image: (_x: number, _y: number, _key: string, f: string) => {
        check(f)
        return fakeObject(f)
      },
      container: (x: number, y: number, children: Fake[] = []) => {
        const c = fakeObject()
        c.x = x
        c.y = y
        for (const k of children) (c.add as (k: Fake) => void)(k)
        return c
      },
      rectangle: () => fakeObject(),
      bitmapText: () => fakeObject(),
      nineslice: () => fakeObject(),
      graphics: () => fakeObject(),
    },
    tweens: {
      add: (cfg: TweenCfg) => {
        pending.push(cfg)
        return { stop: () => {}, remove: () => {} }
      },
      killTweensOf: () => {},
      isTweening: () => false,
    },
    time: {
      get now() {
        return now
      },
      delayedCall: () => ({ remove: () => {} }),
    },
    cache: { bitmapFont: { has: () => true } },
    /** Finish every queued tween (end values, onUpdate, onComplete). */
    flush(): void {
      for (let guard = 0; pending.length > 0 && guard < 10_000; guard++) {
        const c = pending.shift() as TweenCfg
        for (const t of [c.targets].flat() as Record<string, unknown>[])
          for (const [k, v] of Object.entries(c))
            if (typeof v === 'number' && k in t) t[k] = v
        c.onUpdate?.()
        c.onComplete?.()
      }
    },
    tick(ms: number): void {
      now += ms
    },
  }
  return scene
}

describe('design-m8-m9 §6.1: the room with docks 2–3 and tier 3 (fake scene, real sim)', () => {
  it('draws only packed frames, swaps to the tier-3 layout, puts pad parcels on the pads as minis and reads every dock', () => {
    const sim = makeSim(3)
    const vs = createViewSim(sim)
    fund(sim, 50_000)
    const scene = fakeScene()
    const S = scene as never
    const L = createRoomLayers(S, 4, 92)
    const lane = new LaneRenderer(
      S,
      L,
      new FixedLaneLayout(1),
      vs,
      new Fx(S, L.fx),
    )
    const dock = new DockView(S, L, vs)
    const frame = (ms: number): void => {
      lane.update(0, ms)
      dock.update(0, ms)
      scene.tick(ms)
    }
    lane.syncAll()
    dock.syncAll()
    expect(lane.layout.tier).toBe(1)
    expect(lane.layout.shelfCapacity()).toBe(54)
    for (let s = 0; s < 60; s++) {
      runSeconds(sim, 1)
      frame(100)
      scene.flush()
    }

    // L3 inside the room: tier 3 (the 20 × 5 shelf grid), then dock 2.
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 })).toEqual({
      ok: true,
    })
    lane.onLevelUp()
    scene.flush()
    expect(lane.layout.tier).toBe(3)
    expect(lane.layout.shelfCapacity()).toBe(100)
    expect(vs.lane.buyDock(2)).toEqual({ ok: true })
    dock.onBought(2)
    scene.flush()
    // Dock 3 (L4, debug) and a fleet big enough to keep three docks busy.
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 })).toEqual({
      ok: true,
    })
    expect(vs.lane.buyDock(3)).toEqual({ ok: true })
    dock.onBought(3)
    for (const type of ['van', 'van', 'truck', 'bike', 'bike'] as const)
      buy(sim, type)

    let padPeak = 0
    for (let s = 0; s < 400; s++) {
      runSeconds(sim, 1)
      frame(100)
      if (s % 3 === 0) scene.flush()
      for (const id of ['conv2', 'conv3']) {
        const q = sim.state.lane.nodes.find((n) => n.id === id)?.queue
        padPeak = Math.max(padPeak, q?.length ?? 0)
      }
      if (s % 97 === 0) {
        lane.syncAll()
        dock.syncAll()
      }
    }
    expect(padPeak).toBeGreaterThan(0)
    scene.flush()
    frame(16)
    scene.flush()

    // Resting sprites: minis on the pads, full frames on conv1 and the slots.
    const sprites = (
      lane as unknown as {
        sprites: Map<
          number,
          { running: boolean; mini: boolean; img: { frame: { name: string } } }
        >
      }
    ).sprites
    let onPad = 0
    let inLane = 0
    for (const n of sim.state.lane.nodes) {
      const ids = [
        ...n.queue,
        ...n.stations.flatMap((st) =>
          st.parcelId === null ? [] : [st.parcelId],
        ),
      ]
      for (const id of ids) {
        const rec = sprites.get(id)
        if (!rec || rec.running) continue
        if (n.id === 'conv2' || n.id === 'conv3') {
          onPad += 1
          expect(rec.mini, `${id} on ${n.id}`).toBe(true)
          expect(rec.img.frame.name).toMatch(/^parcel_mini_/)
        } else if (n.kind === 'slot' || n.id === 'conv1') {
          inLane += 1
          expect(rec.img.frame.name, `${id} on ${n.id}`).not.toMatch(
            /^parcel_mini_/,
          )
        }
      }
    }
    expect(onPad + inLane).toBeGreaterThan(0)

    expect(dock.tooltipText('dock2')).toMatch(/^Dock 2 — .+ · queue \d+$/)
    expect(dock.tooltipText('dock3')).toMatch(/^Dock 3 — /)
    expect(dock.panelTooltipText()).toMatch(/^3 docks · .+ · queue \d+$/)
    expect(dock.lockedDoorAt(10, 120)).toBeNull()
    expect(dock.bayAt(10, 180)).toMatchObject({ index: 3, owned: true })
    expect(missing).toEqual([])
  })
})

interface RoomInternals {
  floorImgs: unknown[]
  wallImgs: unknown[]
  slots: Map<string, { belts: unknown[]; unrollPending: boolean }>
  ext: Fake | null
  extText: Fake | null
  strips: Fake[]
  readoutPanel: Fake
  sprites: Map<number, { running: boolean; img: Fake }>
}

describe('design-m8-m9 §6.1 / R21 (M9): the tier-4 and tier-5 rooms (fake scene, real sim)', () => {
  it('rebuilds on the taller layouts with slots 5–6, the ext strip, neon at tier 5 and the Sorter Arm in the station', () => {
    missing.length = 0
    const sim = makeSim(5)
    const vs = createViewSim(sim)
    fund(sim, 80_000)
    const scene = fakeScene()
    const S = scene as never
    /** What WarehouseScene.buildRoom + syncParts do for the sim's tier. */
    const build = (tier: number) => {
      const L = createRoomLayers(S, 4, 92)
      const lane = new LaneRenderer(
        S,
        L,
        new FixedLaneLayout(tier),
        vs,
        new Fx(S, L.fx),
      )
      const dock = new DockView(S, L, vs)
      lane.syncAll()
      dock.syncAll()
      return { L, lane, dock }
    }
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 3 })).toEqual({
      ok: true,
    })
    let room = build(3)
    expect(room.lane.needsRebuild()).toBe(false)
    for (const type of ['van', 'truck', 'bike'] as const) buy(sim, type)
    const frame = (ms: number): void => {
      room.lane.update(0, ms)
      room.dock.update(0, ms)
      scene.tick(ms)
    }
    for (let s = 0; s < 40; s++) {
      runSeconds(sim, 1)
      frame(100)
      scene.flush()
    }

    // L4: 16 rows → a new renderer; slot 5 unrolls after the fade.
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 })).toEqual({
      ok: true,
    })
    expect(room.lane.needsRebuild()).toBe(true)
    const prev = room.lane.lockedSlotIds()
    expect(prev.has('slot5')).toBe(true)
    room.lane.destroy()
    room = build(4)
    room.lane.unrollOpened(prev, 400)
    const t4 = room.lane as unknown as RoomInternals
    expect(room.lane.layout.tier).toBe(4)
    expect(room.lane.needsRebuild()).toBe(false)
    expect(t4.floorImgs).toHaveLength((rowsForTier(4) - 1) * (ROOM_COLS - 2))
    expect(t4.wallImgs).toHaveLength(2 * (rowsForTier(4) - 1))
    expect([...t4.slots.keys()]).toEqual([
      'slot1',
      'slot2',
      'slot3',
      'slot4',
      'slot5',
    ])
    expect(t4.slots.get('slot5')?.belts).toHaveLength(2)
    expect(t4.slots.get('slot5')?.unrollPending).toBe(true)
    expect(room.lane.layout.extRect()?.y).toBe(420)
    expect(room.lane.layout.extCaption()).toBe('6')
    expect(t4.extText).not.toBeNull()
    expect(t4.ext?.visible).toBe(true)
    expect(t4.strips.map((x) => x.frame.name)).toEqual([
      'strip_light',
      'strip_light',
    ])
    // The readout strip is its own container (fixed while the room scrolls).
    expect(t4.readoutPanel.parentContainer).toBe(room.L.readout)

    // The Sorter Arm at L4: bought into the Hold Bay node, drawn in the station.
    expect(vs.lane.buyMachine(SORTER_ARM_ID, 'hold')).toEqual({ ok: true })
    frame(16)
    const arm = room.lane.stationArm()
    expect(arm?.frame.name).toBe('sorter_arm_f0')
    room.lane.onArmToss()
    expect(room.lane.stationArm()?.frame.name).toBe('sorter_arm_f1')
    for (let s = 0; s < 60; s++) {
      runSeconds(sim, 1)
      frame(100)
      if (s % 4 === 0) scene.flush()
    }

    // L5: 18 rows, slot 6 in the column, no ext strip, neon strips.
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 5 })).toEqual({
      ok: true,
    })
    expect(room.lane.needsRebuild()).toBe(true)
    const prev5 = room.lane.lockedSlotIds()
    room.lane.destroy()
    room = build(5)
    room.lane.unrollOpened(prev5, 400)
    const t5 = room.lane as unknown as RoomInternals
    expect(room.lane.layout.height).toBe(576)
    expect(t5.floorImgs).toHaveLength((rowsForTier(5) - 1) * (ROOM_COLS - 2))
    expect(t5.slots.has('slot6')).toBe(true)
    expect(t5.slots.get('slot6')?.unrollPending).toBe(true)
    expect(t5.ext).toBeNull()
    expect(t5.strips.map((x) => x.frame.name)).toEqual([
      'neon_strip_f0',
      'neon_strip_f0',
    ])
    // One strip dims for a moment every 5 s.
    frame(5000)
    expect(t5.strips.map((x) => x.frame.name)).toContain('neon_strip_f1')
    frame(400)
    expect(t5.strips.map((x) => x.frame.name)).toEqual([
      'neon_strip_f0',
      'neon_strip_f0',
    ])
    expect(room.lane.stationArm()?.frame.name).toBe('sorter_arm_f0')
    for (let s = 0; s < 90; s++) {
      runSeconds(sim, 1)
      frame(100)
      if (s % 3 === 0) scene.flush()
    }
    scene.flush()
    frame(16)
    // Resting lane sprites sit on their node's anchors in the 18-row room.
    const lay = room.lane.layout
    for (const n of sim.state.lane.nodes) {
      if (n.kind !== 'slot') continue
      for (const st of n.stations) {
        if (st.parcelId === null) continue
        const rec = t5.sprites.get(st.parcelId)
        if (!rec || rec.running) continue
        const r = lay.rectFor(n.id)
        expect(r, n.id).not.toBeNull()
        if (!r) continue
        expect(rec.img.y, `${st.parcelId} at ${n.id}`).toBeGreaterThanOrEqual(
          r.y,
        )
        expect(rec.img.y).toBeLessThan(r.y + r.h)
      }
    }
    expect(missing).toEqual([])
  })
})
