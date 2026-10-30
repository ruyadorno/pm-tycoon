// spec-build2.md §6.1 (the author's city #1, plan-build2 §8.2 task 4): the
// warehouse foundation is drawn by the ground bake, not by the exterior
// sprite, so it sits on the iso grid by construction. cityFx.slabStamps
// covers the lot's 4×4 footprint with lot_slab_a/b/c (deterministic per
// tile), the dock tiles with lot_ramp, and puts bollards beside the slab's
// visible corners where no vehicle drives and no wall hides them; the bake
// stamps them, falling back to the base ground while the atlas lacks them.
import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: {
    Renderer: { Events: { RESTORE_WEBGL: 'restorewebgl' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}))

const { buildGameData, groundAt, isRoadTile, mapBlockAt } =
  await import('../../src/data/index.ts')
const { loadRawData } = await import('../../tools/sim/load.node.ts')
const {
  BOLLARD_FRAMES,
  RAMP_FRAME,
  SLAB_FRAMES,
  bollardTileOk,
  lotVariant,
  slabStamps,
  slabTiles,
} = await import('../../src/render/cityFx.ts')
const { footprintAnchor, originX, tileToScreen, tileTopLeft, HH } =
  await import('../../src/render/iso.ts')
const { bakeGround, GROUND_Y } = await import('../../src/render/ground.ts')

const data = buildGameData(loadRawData())
const map = data.map
const lot = map.lot
const wh = lot.warehouse
const key = (x: number, y: number): string => `${x},${y}`
const footprint = new Set(slabTiles(map).map(([x, y]) => key(x, y)))
const docks = new Set(lot.docks.map(([x, y]) => key(x, y)))
const stamps = slabStamps(map)
const slab = stamps.filter((s) => s.kind === 'slab')
const ramp = stamps.filter((s) => s.kind === 'ramp')
const bollards = stamps.filter((s) => s.kind === 'bollard')
/** Matcher for tile lists: `at(b)(p)` when p is b's tile. */
const at =
  (b: { tx: number; ty: number }) =>
  (p: readonly number[]): boolean =>
    p[0] === b.tx && p[1] === b.ty

describe('B2 §6.1 slab: the 4×4 footprint, exactly, on the grid', () => {
  it('the footprint is map.json lot.warehouse (21,21) + 4×4', () => {
    expect(wh.tile).toEqual([21, 21])
    expect(wh.footprint).toEqual([4, 4])
    expect(footprint.size).toBe(16)
  })

  it('one slab stamp per footprint tile: the set covers the footprint exactly', () => {
    expect(slab).toHaveLength(16)
    const got = new Set(slab.map((s) => key(s.tx, s.ty)))
    expect(got).toEqual(footprint)
    for (const s of slab) {
      expect(s.tx).toBeGreaterThanOrEqual(wh.tile[0])
      expect(s.tx).toBeLessThan(wh.tile[0] + wh.footprint[0])
      expect(s.ty).toBeGreaterThanOrEqual(wh.tile[1])
      expect(s.ty).toBeLessThan(wh.tile[1] + wh.footprint[1])
      expect(Number.isInteger(s.tx) && Number.isInteger(s.ty)).toBe(true)
    }
  })

  it('variants a/b/c are deterministic per tile (no Math.random) and mixed', () => {
    for (const s of slab) {
      expect(SLAB_FRAMES).toContain(s.frame)
      expect(s.frame).toBe(SLAB_FRAMES[lotVariant(s.tx, s.ty, 3)])
    }
    expect(slabStamps(map)).toEqual(stamps)
    expect(new Set(slab.map((s) => s.frame)).size).toBeGreaterThanOrEqual(2)
  })

  it('the slab diamond is the exterior base: its corners are the footprint anchor diamond', () => {
    const ox = originX(map.size[1])
    const anchor = footprintAnchor(wh.tile, wh.footprint, ox)
    const x0 = wh.tile[0]
    const y0 = wh.tile[1]
    const x1 = x0 + wh.footprint[0] - 1
    const y1 = y0 + wh.footprint[1] - 1
    const c = (x: number, y: number) => tileToScreen(x, y, ox)
    // Bottom vertex of the front tile = the sprite origin (0.5, 1).
    expect({ x: c(x1, y1).x, y: c(x1, y1).y + HH }).toEqual(anchor)
    // Top, left and right vertices: the 256×128 diamond at the canvas bottom.
    expect(c(x0, y0).y - HH).toBe(anchor.y - 128)
    expect(c(x0, y1).x - 32).toBe(anchor.x - 128)
    expect(c(x1, y0).x + 32).toBe(anchor.x + 128)
    // Every stamp lands on whole pixels of its own 64×32 cell.
    for (const s of slab) {
      const tl = tileTopLeft(s.tx, s.ty, ox)
      expect(Number.isInteger(tl.x) && Number.isInteger(tl.y)).toBe(true)
    }
  })
})

describe('B2 §6.1 ramp: lot_ramp on the dock tiles', () => {
  it('one ramp stamp per dock tile, nothing else', () => {
    expect(ramp).toHaveLength(lot.docks.length)
    expect(new Set(ramp.map((s) => key(s.tx, s.ty)))).toEqual(docks)
    for (const s of ramp) expect(s.frame).toBe(RAMP_FRAME)
  })

  it('every slab / ramp tile lies inside the footprint or the dock set', () => {
    for (const s of [...slab, ...ramp]) {
      const k = key(s.tx, s.ty)
      expect(footprint.has(k) || docks.has(k), k).toBe(true)
    }
  })
})

describe('B2 §6.1 bollards: beside the slab, never in a vehicle path', () => {
  it('there are bollards, a/b by tile hash, on distinct tiles', () => {
    expect(bollards.length).toBeGreaterThanOrEqual(2)
    const tiles = new Set(bollards.map((b) => key(b.tx, b.ty)))
    expect(tiles.size).toBe(bollards.length)
    for (const b of bollards) {
      expect(BOLLARD_FRAMES).toContain(b.frame)
      expect(b.frame).toBe(BOLLARD_FRAMES[lotVariant(b.tx, b.ty, 2)])
    }
  })

  it('no bollard on a road, entrance, dock, queue, parking or sign tile', () => {
    for (const b of bollards) {
      const k = key(b.tx, b.ty)
      expect(isRoadTile(map, b.tx, b.ty), k).toBe(false)
      expect(mapBlockAt(map, b.tx, b.ty)?.kind, k).toBe('lot')
      expect(at(b)(lot.entrance), k).toBe(false)
      expect(at(b)(lot.sign), k).toBe(false)
      expect(lot.docks.some(at(b)), k).toBe(false)
      expect(lot.queue.some(at(b)), k).toBe(false)
      expect(lot.parking.some(at(b)), k).toBe(false)
      expect(footprint.has(k), k).toBe(false)
    }
  })

  it('each stands at a slab corner (diagonal or edge neighbour of a corner tile)', () => {
    const x0 = wh.tile[0]
    const y0 = wh.tile[1]
    const x1 = x0 + wh.footprint[0] - 1
    const y1 = y0 + wh.footprint[1] - 1
    const corners = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]
    for (const b of bollards) {
      const nearCorner = corners.some(
        ([cx, cy]) =>
          Math.abs(b.tx - (cx ?? 0)) <= 1 && Math.abs(b.ty - (cy ?? 0)) <= 1,
      )
      expect(nearCorner, key(b.tx, b.ty)).toBe(true)
    }
  })

  it('in front of the exterior: the post foot is ≥ 16 px below the wall base', () => {
    const ox = originX(map.size[1])
    const anchor = footprintAnchor(wh.tile, wh.footprint, ox)
    for (const b of bollards) {
      const foot = tileToScreen(b.tx, b.ty, ox)
      const dx = foot.x - anchor.x
      if (Math.abs(dx) > 128) continue // beside the 256-px canvas
      // The SW / SE base edges of the 256×128 diamond, as y(x).
      const baseY = anchor.y - Math.abs(dx) / 2
      expect(foot.y - baseY, key(b.tx, b.ty)).toBeGreaterThanOrEqual(16)
    }
  })

  it('bollardTileOk: free front tiles pass; paths, the slab and the hidden back fail', () => {
    expect(bollardTileOk(map, 25, 25)).toBe(true)
    expect(bollardTileOk(map, 22, 22)).toBe(false) // slab
    expect(bollardTileOk(map, 20, 25)).toBe(false) // queue
    expect(bollardTileOk(map, 26, 23)).toBe(false) // parking
    expect(bollardTileOk(map, 20, 23)).toBe(false) // dock
    expect(bollardTileOk(map, 19, 23)).toBe(false) // entrance (avenue)
    expect(bollardTileOk(map, 20, 21)).toBe(false) // behind the NW wall
    expect(bollardTileOk(map, 26, 20)).toBe(false) // the sign
    expect(bollardTileOk(map, -1, 0)).toBe(false)
  })

  it('a dock run along x puts the ramp-side candidates at its ends', () => {
    // Move the docks onto the free row in front of the slab (y = 25): the
    // ramp's sides are then (20, 25) — queue — and (25, 25), the S corner.
    const alt = structuredClone(map)
    alt.lot.docks = [
      [21, 25],
      [22, 25],
      [23, 25],
    ]
    const st = slabStamps(alt)
    expect(
      st.filter((s) => s.kind === 'ramp').map((s) => [s.tx, s.ty]),
    ).toEqual(alt.lot.docks)
    const bs = st.filter((s) => s.kind === 'bollard')
    for (const b of bs) {
      expect(alt.lot.docks.some(([x, y]) => x === b.tx && y === b.ty)).toBe(
        false,
      )
      expect(bollardTileOk(alt, b.tx, b.ty)).toBe(true)
    }
    expect(bs.some((b) => b.tx === 24 && b.ty === 25)).toBe(true)
  })
})

// ---------------------------------------------------------------- the bake

interface StampCall {
  frame: string
  x: number
  y: number
  originX: number
  originY: number
}

function fakeScene(lacking: ReadonlySet<string>) {
  const calls: StampCall[] = []
  const chain: Record<string, unknown> = new Proxy(
    {},
    { get: () => () => chain },
  )
  const dt = {
    key: 'ground',
    clear() {},
    render() {},
    stamp(
      _atlas: string,
      frame: string,
      x: number,
      y: number,
      cfg: { originX: number; originY: number },
    ) {
      calls.push({ frame, x, y, originX: cfg.originX, originY: cfg.originY })
    },
  }
  const scene = {
    textures: {
      exists: () => false,
      addDynamicTexture: () => dt,
      // `stem_f0` / `stem_locked` count as the stem (the resolver's tries).
      get: () => ({
        has: (n: string) => !lacking.has(n.replace(/(_f0)?(_locked)?$/, '')),
      }),
    },
    add: { image: () => chain },
    game: { renderer: { on() {}, off() {} } },
    events: { once() {}, off() {} },
  }
  return { scene, calls }
}

const NEW_FRAMES = new Set<string>([
  ...SLAB_FRAMES,
  RAMP_FRAME,
  ...BOLLARD_FRAMES,
])

describe('B2 §6.1 the ground bake stamps the lot', () => {
  const ox = originX(map.size[1])
  const cell = (tx: number, ty: number) => {
    const tl = tileTopLeft(tx, ty, ox)
    return { x: tl.x, y: tl.y - GROUND_Y }
  }

  it('slab and ramp frames replace the base tile; bollards are stamped last', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scene, calls } = fakeScene(new Set())
    const bake = bakeGround(scene as never, map)
    warn.mockRestore()
    expect([...bake.missing]).toEqual([])
    for (const s of [...slab, ...ramp]) {
      const tl = cell(s.tx, s.ty)
      const here = calls.filter(
        (c) => c.x === tl.x && c.y === tl.y && c.originX === 0,
      )
      // The lot tile itself; kerb overlays may follow on the lot's rim.
      expect(here[0]?.frame, key(s.tx, s.ty)).toBe(s.frame)
      expect(here.some((c) => c.frame === 'lot_concrete')).toBe(false)
    }
    const posts = calls.filter((c) =>
      (BOLLARD_FRAMES as readonly string[]).includes(c.frame),
    )
    expect(posts).toHaveLength(bollards.length)
    expect(calls.slice(-posts.length)).toEqual(posts)
    for (const [i, b] of bollards.entries()) {
      const foot = tileToScreen(b.tx, b.ty, ox)
      expect(posts[i]).toEqual({
        frame: b.frame,
        x: foot.x,
        y: foot.y + HH - GROUND_Y,
        originX: 0.5,
        originY: 1,
      })
    }
    expect(bake.stamps).toBe(calls.length)
  })

  it('the ramp is a dropped kerb: no kerb on its road edge, the rim keeps one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scene, calls } = fakeScene(new Set())
    bakeGround(scene as never, map)
    warn.mockRestore()
    const kerbsAt = (tx: number, ty: number) => {
      const tl = cell(tx, ty)
      return calls
        .filter(
          (c) => c.x === tl.x && c.y === tl.y && c.frame.startsWith('kerb_'),
        )
        .map((c) => c.frame)
    }
    for (const [x, y] of lot.docks) {
      expect(isRoadTile(map, x - 1, y)).toBe(true)
      expect(kerbsAt(x, y), key(x, y)).not.toContain('kerb_w')
    }
    // A queue tile on the same west rim still has its kerb.
    const q = lot.queue.find(([x]) => x === lot.docks[0]?.[0])
    expect(q).toBeDefined()
    if (q) expect(kerbsAt(q[0], q[1])).toContain('kerb_w')
  })

  it('without the new frames the lot still renders: base ground, no posts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scene, calls } = fakeScene(NEW_FRAMES)
    const bake = bakeGround(scene as never, map)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    for (const s of [...slab, ...ramp]) {
      const tl = cell(s.tx, s.ty)
      const first = calls.find(
        (c) => c.x === tl.x && c.y === tl.y && c.originX === 0,
      )
      expect(first?.frame, key(s.tx, s.ty)).toBe(groundAt(map, s.tx, s.ty))
      expect(first?.frame).toBe('lot_concrete')
    }
    expect(calls.some((c) => NEW_FRAMES.has(c.frame))).toBe(false)
    for (const f of [...SLAB_FRAMES, RAMP_FRAME])
      if (stamps.some((s) => s.frame === f)) expect(bake.missing).toContain(f)
  })
})
