// M8 overseas hubs in the city (spec-build2 §4.1; spec-core §5.6;
// design-m8-m9 §6.2, §7 M8 8): the vessel's departure timeline (out 4 s →
// away 10 s → back 4 s, a departure while away ignored, reduced motion),
// its tile-space offsets (integer endpoints = map.hubs `exit`, integer
// screen px every frame, the M9 plane's climb), the 45-s clearance ring
// (ring_0 at the hand-off → ring_8 at the clearance, `×N` from 2), the
// hand-off / clearance stamps, and CityHubView driven by a real sim through
// a fake scene (no Phaser: cityHub.ts imports Phaser as a type only). Also
// the hop's source: the vehicle handing off stands on the pier's anchor
// tile, found at 1× (the snapshot cached before the tick) and at 2×+ (the
// cache rebuilt mid-tick).
import { describe, expect, it } from 'vitest'
import type { MapHubDef } from '../../src/data/index.ts'
import {
  canDepart,
  clearedStampText,
  clearingCountText,
  DEPART_AWAY_MS,
  DEPART_BACK_MS,
  DEPART_MS,
  DEPART_OUT_MS,
  handOffVehicleId,
  CityHubView,
  LIFT_FROM,
  lockedStampText,
  lostStampText,
  RING_LAST,
  RING_LIFT,
  ringFrame,
  stampSum,
  vesselAlpha,
  vesselOffset,
  vesselPhase,
  vesselScreenOffset,
} from '../../src/render/cityHub.ts'
import {
  buildingSprite,
  FRAME_ATLAS,
  inAtlas,
  isFrame,
} from '../../src/render/frames.ts'
import type { Sim } from '../../src/sim/sim.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import { createViewSim, type ViewSim } from '../../src/sim/view-api.ts'
import {
  buy,
  dataFixture,
  fund,
  makeSim,
  quietSim,
  runTicks,
} from '../sim/helpers.ts'

const data = dataFixture()
const docksHub = data.map.hubs.find((h) => h.district === 'docks') as MapHubDef
const docksDef = data.districts.find((d) => d.id === 'docks')
const CLEAR_TICKS =
  (docksDef?.kind === 'overseas' ? docksDef.clearanceS : 45) * TICKS_PER_S
/** A made-up M9-style plane row: taxis east and climbs 64 px. */
const plane: MapHubDef = {
  district: 'airport',
  office: 'ap_terminal',
  vessel: { frame: 'ap_plane', tile: [45, 10], exit: [4, 0], liftPx: 64 },
}

describe('departure timeline (B2 §4.1: sails out over 4 s, back after 10 s)', () => {
  it('home with no trip; out 4 s → away 10 s → back 4 s → home', () => {
    expect(DEPART_OUT_MS).toBe(4000)
    expect(DEPART_AWAY_MS).toBe(10_000)
    expect(DEPART_BACK_MS).toBe(4000)
    expect(DEPART_MS).toBe(18_000)
    expect(vesselPhase(null, 5000)).toEqual({ phase: 'home', t: 0 })
    const s = 1000
    expect(vesselPhase(s, s)).toEqual({ phase: 'out', t: 0 })
    expect(vesselPhase(s, s + 2000)).toEqual({ phase: 'out', t: 0.5 })
    expect(vesselPhase(s, s + 4000)).toEqual({ phase: 'away', t: 0 })
    expect(vesselPhase(s, s + 9000)).toEqual({ phase: 'away', t: 0.5 })
    expect(vesselPhase(s, s + 14_000)).toEqual({ phase: 'back', t: 0 })
    expect(vesselPhase(s, s + 16_000)).toEqual({ phase: 'back', t: 0.5 })
    expect(vesselPhase(s, s + 18_000)).toEqual({ phase: 'home', t: 0 })
    expect(vesselPhase(s, s + 60_000)).toEqual({ phase: 'home', t: 0 })
  })

  it('a new trip only from home (design §9 R3: a batch = one 18-s trip)', () => {
    expect(canDepart(null, 0)).toBe(true)
    for (const dt of [0, 3999, 4000, 13_999, 14_000, 17_999])
      expect(canDepart(0, dt), `${dt} ms in`).toBe(false)
    expect(canDepart(0, 18_000)).toBe(true)
  })

  it('reduced motion: no travel, hidden 10 s, then home', () => {
    expect(vesselPhase(0, 0, true).phase).toBe('away')
    expect(vesselPhase(0, 9999, true).phase).toBe('away')
    expect(vesselPhase(0, 10_000, true).phase).toBe('home')
    expect(canDepart(0, 5000, true)).toBe(false)
    expect(canDepart(0, 10_000, true)).toBe(true)
  })
})

describe('vessel offsets (map.hubs `exit`, tile space, integer screen px)', () => {
  it('the Docks row: the dk_ship prop, sailing off the map edge', () => {
    expect(docksHub).toBeDefined()
    expect(docksHub.office).toBe('dk_customs')
    expect(docksHub.vessel.frame).toBe('dk_ship')
    expect(docksHub.vessel.liftPx).toBe(0)
    const prop = data.map.props.find(
      (p) =>
        p.frame === docksHub.vessel.frame &&
        p.tile[0] === docksHub.vessel.tile[0] &&
        p.tile[1] === docksHub.vessel.tile[1],
    )
    expect(prop?.region).toBe('docks')
    const [x, y] = docksHub.vessel.tile
    const [ex, ey] = docksHub.vessel.exit
    const [w, h] = data.map.size
    const off = x + ex < 0 || y + ey < 0 || x + ex >= w || y + ey >= h
    expect(off, 'tile + exit lies past the map edge').toBe(true)
  })

  it('integer endpoints: 0 at home and at the start, `exit` out there, 0 again back', () => {
    const exit = {
      dTx: docksHub.vessel.exit[0],
      dTy: docksHub.vessel.exit[1],
      liftPx: 0,
    }
    const zero = { dTx: 0, dTy: 0, liftPx: 0 }
    expect(vesselOffset(docksHub, 'home', 0)).toEqual(zero)
    expect(vesselOffset(docksHub, 'out', 0)).toEqual(zero)
    expect(vesselOffset(docksHub, 'out', 1)).toEqual(exit)
    expect(vesselOffset(docksHub, 'away', 0.3)).toEqual(exit)
    expect(vesselOffset(docksHub, 'back', 0)).toEqual(exit)
    expect(vesselOffset(docksHub, 'back', 1)).toEqual(zero)
  })

  it('moves monotonically out and back, in whole screen px every frame', () => {
    let prevOut = 0
    let prevBack = Infinity
    for (let ms = 0; ms <= DEPART_OUT_MS; ms += 1000 / 60) {
      const t = ms / DEPART_OUT_MS
      const out = vesselScreenOffset(vesselOffset(docksHub, 'out', t))
      const back = vesselScreenOffset(vesselOffset(docksHub, 'back', t))
      for (const v of [out.dx, out.dy, back.dx, back.dy])
        expect(Number.isInteger(v)).toBe(true)
      const dOut = Math.hypot(out.dx, out.dy)
      const dBack = Math.hypot(back.dx, back.dy)
      expect(dOut).toBeGreaterThanOrEqual(prevOut)
      expect(dBack).toBeLessThanOrEqual(prevBack)
      prevOut = dOut
      prevBack = dBack
    }
    // −x in tile space is up-left on screen (iso: 32 × 16 px per tile).
    const far = vesselScreenOffset(vesselOffset(docksHub, 'away', 0))
    expect(far).toEqual({
      dx: (docksHub.vessel.exit[0] - docksHub.vessel.exit[1]) * 32,
      dy: (docksHub.vessel.exit[0] + docksHub.vessel.exit[1]) * 16,
    })
  })

  it('hidden while away; the ship is fully shown out and back', () => {
    expect(vesselAlpha(docksHub, 'away', 0.5)).toBe(0)
    for (const p of ['home', 'out', 'back'] as const)
      expect(vesselAlpha(docksHub, p, 0.5)).toBe(1)
  })

  it('M9 plane (liftPx > 0): climbs over the last 60 % of the taxi, fades back in at its stand', () => {
    expect(vesselOffset(plane, 'out', LIFT_FROM).liftPx).toBe(0)
    expect(vesselOffset(plane, 'out', 1).liftPx).toBe(64)
    expect(vesselOffset(plane, 'away', 0).liftPx).toBe(64)
    expect(vesselScreenOffset(vesselOffset(plane, 'out', 1)).dy).toBe(
      4 * 16 - 64,
    )
    expect(vesselOffset(plane, 'back', 0.5)).toEqual({
      dTx: 0,
      dTy: 0,
      liftPx: 0,
    })
    expect(vesselAlpha(plane, 'back', 0.25)).toBe(0.25)
  })
})

describe('clearance ring (§5.6: 45 s on the port office)', () => {
  const c = { handOffTick: 1000, clearTick: 1000 + CLEAR_TICKS }

  it('ring_0 at the hand-off → ring_8 at the clearance, null with nothing clearing', () => {
    expect(RING_LAST).toBe(8)
    expect(ringFrame(null, 1234)).toBeNull()
    expect(ringFrame(c, c.handOffTick)).toBe(0)
    expect(ringFrame(c, c.clearTick)).toBe(8)
    expect(ringFrame(c, c.handOffTick + CLEAR_TICKS / 2)).toBe(4)
    expect(ringFrame(c, c.handOffTick - 50)).toBe(0)
    expect(ringFrame(c, c.clearTick + 50)).toBe(8)
    expect(ringFrame({ handOffTick: 5, clearTick: 5 }, 5)).toBe(8)
  })

  it('nine equal steps (5 s each over 45 s), never going back', () => {
    const seen = new Map<number, number>()
    let prev = 0
    for (let t = c.handOffTick; t < c.clearTick; t += 0.25) {
      const f = ringFrame(c, t) as number
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
      seen.set(f, (seen.get(f) ?? 0) + 0.25)
    }
    expect([...seen.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    for (const ticks of seen.values()) expect(ticks).toBe(CLEAR_TICKS / 9)
  })

  it('every ring frame is in the world atlas (the city binds world only)', () => {
    for (let k = 0; k <= RING_LAST; k++) {
      const name = `ring_${k}`
      expect(isFrame(name), name).toBe(true)
      expect(FRAME_ATLAS[name as keyof typeof FRAME_ATLAS]).toBe('world')
    }
  })

  it('`×N` beside the ring from 2 parcels', () => {
    expect(clearingCountText(0)).toBe('')
    expect(clearingCountText(1)).toBe('')
    expect(clearingCountText(2)).toBe('×2')
    expect(clearingCountText(7)).toBe('×7')
  })
})

describe('hand-off and clearance stamps (B2 §4.1; §9 R11)', () => {
  it('LOCKED $18 at the pier, CLEARED +$18 at the office, the loss lines', () => {
    expect(lockedStampText(18)).toBe('LOCKED $18')
    expect(clearedStampText(18)).toBe('CLEARED +$18')
    expect(lostStampText('docks')).toBe('SHIP HAS SAILED')
    expect(lostStampText('airport')).toBe('PLANE HAS LEFT')
  })

  it('same-place stamps inside the merge window sum their dollars', () => {
    const a = stampSum(undefined, 1000, 18, 400)
    expect(a).toEqual({ atMs: 1000, sum: 18 })
    const b = stampSum(a, 1300, 29, 400)
    expect(b).toEqual({ atMs: 1300, sum: 47 })
    // The window restarts with each merge (Popups resets the slot's age).
    expect(stampSum(b, 1650, 5, 400).sum).toBe(52)
    expect(stampSum(b, 1700, 5, 400)).toEqual({ atMs: 1700, sum: 5 })
  })
})

// ---------------------------------------------------------------- CityHubView over a fake scene

interface FakeObj {
  kind: 'image' | 'text'
  x: number
  y: number
  visible: boolean
  alpha: number
  depth: number
  frame: { name: string }
  text: string
  scene: object | null
  [k: string]: unknown
}

function fakeObj(
  kind: FakeObj['kind'],
  x: number,
  y: number,
  frameOrText: string,
): FakeObj {
  const o: FakeObj = {
    kind,
    x,
    y,
    visible: true,
    alpha: 1,
    depth: 0,
    frame: { name: kind === 'image' ? frameOrText : '' },
    text: kind === 'text' ? frameOrText : '',
    scene: {},
  }
  const self = (): FakeObj => o
  Object.assign(o, {
    setOrigin: self,
    setTint: self,
    setDropShadow: self,
    setDepth: (d: number) => ((o.depth = d), o),
    setFrame: (f: string) => ((o.frame = { name: f }), o),
    setText: (t: string) => ((o.text = t), o),
    setPosition: (px: number, py: number) => ((o.x = px), (o.y = py), o),
    setVisible: (v: boolean) => ((o.visible = v), o),
    setAlpha: (a: number) => ((o.alpha = a), o),
    destroy: () => {
      o.scene = null
    },
  })
  return o
}

function fakeScene(): { scene: never; layer: never; made: FakeObj[] } {
  const made: FakeObj[] = []
  const scene = {
    add: {
      image: (x: number, y: number, _atlas: string, frame: string) => {
        const o = fakeObj('image', x, y, frame)
        made.push(o)
        return o
      },
      bitmapText: (x: number, y: number, _font: string, text: string) => {
        const o = fakeObj('text', x, y, text)
        made.push(o)
        return o
      },
    },
    cache: { bitmapFont: { has: () => true } },
  }
  return {
    scene: scene as never,
    layer: { add: () => undefined } as never,
    made,
  }
}

/** A quiet sim forced to L3 (Docks live), funded. */
function l3(seed = 1): { sim: Sim; vs: ViewSim } {
  const sim = quietSim(seed)
  const res = sim.dispatch({ kind: 'debugForceLevel', level: 3 })
  if (!res.ok) throw new Error(`forceLevel 3: ${res.reason}`)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  fund(sim)
  return { sim, vs: createViewSim(() => sim, { debug: true }) }
}

const OFFICE = { anchor: { x: 400, y: 600 }, topY: 540, locked: false }
const HOME = { x: 640, y: 480 }

function hubView(
  vs: ViewSim,
  office: {
    anchor: { x: number; y: number }
    topY: number
    locked: boolean
  } | null = OFFICE,
) {
  const f = fakeScene()
  const ship = fakeObj('image', HOME.x, HOME.y, 'dk_ship')
  const vessel = { img: ship as never, x: HOME.x, y: HOME.y }
  const hv = new CityHubView(f.scene, f.layer, vs, docksHub, {
    vessel,
    office,
    depth: 8000,
  })
  const ring = (): FakeObj | undefined => f.made.find((o) => o.kind === 'image')
  const count = (): FakeObj | undefined => f.made.find((o) => o.kind === 'text')
  return { hv, ship, ring, count }
}

describe('CityHubView: the clearance ring from the sim (fake scene)', () => {
  it('hidden while nothing clears (and below L3 the Docks are fogged)', () => {
    const sim = quietSim(1)
    const vs = createViewSim(() => sim)
    expect(vs.hub('docks')?.live).toBe(false)
    const { hv, ring } = hubView(vs)
    hv.syncAll()
    hv.update(0, vs.tick)
    expect(ring()?.visible ?? false).toBe(false)
    expect(hv.ringShown).toBeNull()
  })

  it('a handed-off parcel drains the ring on the office: ring_0 → ring_8, gone at the clearance', () => {
    const { sim, vs } = l3()
    expect(vs.debug!.forceOverseasMalware('docks').ok).toBe(true)
    const c = vs.hub('docks')?.clearing[0]
    expect(c).toBeDefined()
    if (!c) return
    expect(c.clearTick - c.handOffTick).toBe(CLEAR_TICKS)
    const { hv, ring, count } = hubView(vs)
    hv.syncAll()
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBe(0)
    expect(ring()?.frame.name).toBe('ring_0')
    // Over the office's visible top (the rush bell's anchor), in the marker band.
    expect(ring()?.x).toBe(OFFICE.anchor.x)
    expect(ring()?.y).toBe(OFFICE.topY - RING_LIFT)
    expect(ring()?.depth).toBe(8000)
    expect(count()?.visible ?? false).toBe(false)
    runTicks(sim, CLEAR_TICKS / 2)
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBe(4)
    runTicks(sim, c.clearTick - 1 - sim.state.tick)
    hv.update(0, vs.tick + 0.5)
    expect(hv.ringShown).toBe(8)
    runTicks(sim, 1)
    expect(vs.hub('docks')?.clearing).toHaveLength(0)
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBeNull()
    expect(ring()?.visible).toBe(false)
  })

  it('`×2` beside the ring with two parcels clearing; the soonest drives the ring', () => {
    const { sim, vs } = l3()
    vs.debug!.forceOverseasMalware('docks')
    runTicks(sim, CLEAR_TICKS / 3)
    vs.debug!.forceOverseasMalware('docks')
    const { hv, count } = hubView(vs)
    hv.syncAll()
    hv.update(0, vs.tick)
    expect(vs.hub('docks')?.clearing).toHaveLength(2)
    expect(count()?.visible).toBe(true)
    expect(count()?.text).toBe('×2')
    expect(hv.ringShown).toBe(3)
  })

  it('no ring on a fogged office', () => {
    const { vs } = l3()
    vs.debug!.forceOverseasMalware('docks')
    const { hv } = hubView(vs, { ...OFFICE, locked: true })
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBeNull()
  })
})

describe('CityHubView: the ship sails out and back (fake scene, scene clock)', () => {
  it('sails `exit` over 4 s, hides 10 s, sails back 4 s; a departure while away is ignored', () => {
    const { vs } = l3()
    const { hv, ship } = hubView(vs)
    hv.syncAll()
    expect(hv.depart(1000)).toBe(true)
    hv.update(3000, vs.tick)
    expect(hv.phase).toBe('out')
    const mid = vesselScreenOffset(vesselOffset(docksHub, 'out', 0.5))
    expect({ x: ship.x, y: ship.y }).toEqual({
      x: HOME.x + mid.dx,
      y: HOME.y + mid.dy,
    })
    expect(Number.isInteger(ship.x) && Number.isInteger(ship.y)).toBe(true)
    hv.update(6000, vs.tick)
    expect(hv.phase).toBe('away')
    expect(ship.visible).toBe(false)
    // The batch rule: clearances while the ship is away do not restart it.
    expect(hv.depart(6000)).toBe(false)
    hv.update(17_000, vs.tick)
    expect(hv.phase).toBe('back')
    expect(ship.visible).toBe(true)
    hv.update(19_000, vs.tick)
    expect(hv.phase).toBe('home')
    expect({ x: ship.x, y: ship.y, visible: ship.visible }).toEqual({
      ...HOME,
      visible: true,
    })
    expect(hv.depart(19_000)).toBe(true)
  })

  it('syncAll (wake / sim swap) lands the ship home at once', () => {
    const { vs } = l3()
    const { hv, ship } = hubView(vs)
    hv.depart(0)
    hv.update(5000, vs.tick)
    expect(ship.visible).toBe(false)
    hv.syncAll()
    expect(hv.phase).toBe('home')
    expect({ x: ship.x, y: ship.y, visible: ship.visible }).toEqual({
      ...HOME,
      visible: true,
    })
  })

  it('reduced motion: no sailing, hidden 10 s', () => {
    const { vs } = l3()
    const { hv, ship } = hubView(vs)
    hv.depart(0, true)
    hv.update(1, vs.tick)
    expect(ship.visible).toBe(false)
    expect({ x: ship.x, y: ship.y }).toEqual(HOME)
    hv.update(10_000, vs.tick)
    expect(hv.phase).toBe('home')
    expect(ship.visible).toBe(true)
  })

  it('a real clearance emits one hub:departure that sails the ship', () => {
    const { sim, vs } = l3()
    const { hv } = hubView(vs)
    hv.syncAll()
    const departures: string[] = []
    sim.events.on('hub:departure', (p) => {
      departures.push(p.hub)
      hv.depart(sim.state.tick * 100)
    })
    vs.debug!.forceOverseasMalware('docks')
    runTicks(sim, CLEAR_TICKS)
    expect(departures).toEqual(['docks'])
    hv.update(sim.state.tick * 100 + 1000, vs.tick)
    expect(hv.phase).toBe('out')
  })
})

/** What the first hand-off of a forced-L3 game looked like (the hop's source). */
interface HandOffHit {
  found: number | null
  real: number | null
  stopTile: [number, number] | null
  anchor: [number, number]
}

/** Run a forced-L3 game to its first hand-off; `everyTick` reads the snapshot each tick (1×). */
function firstHandOff(everyTick: boolean): HandOffHit | null {
  const sim = makeSim(1)
  sim.dispatch({ kind: 'debugForceLevel', level: 3 })
  fund(sim)
  buy(sim, 'van')
  buy(sim, 'truck')
  const vs = createViewSim(() => sim)
  const box: { hit: HandOffHit | null } = { hit: null }
  sim.events.on('parcel:handedOff', (p) => {
    if (box.hit) return
    const b = data.buildings.find((x) => x.id === p.buildingId)
    if (!b) return
    const real = sim.state.vehicles.find((v) =>
      v.stops.some(
        (s) => s.kind === 'handoff' && s.buildingId === p.buildingId,
      ),
    )
    box.hit = {
      found: handOffVehicleId(vs.vehicles, p.id, p.buildingId, b.anchor),
      real: real?.id ?? null,
      stopTile: real ? [real.pos.tx, real.pos.ty] : null,
      anchor: [b.anchor[0], b.anchor[1]],
    }
  })
  for (let t = 0; t < 6 * 60 * TICKS_PER_S && !box.hit; t++) {
    if (everyTick) void vs.vehicles
    sim.tick()
  }
  return box.hit
}

describe('the hand-off hop starts at the vehicle on the pier anchor (B2 §4.1)', () => {
  it('at 1× (snapshot from before the tick) and at 2×+ (rebuilt mid-tick) alike', () => {
    for (const everyTick of [true, false]) {
      const h = firstHandOff(everyTick)
      expect(h, 'a hand-off within 6 min of L3').not.toBeNull()
      if (!h) continue
      expect(h.real).not.toBeNull()
      expect(h.found).toBe(h.real)
      // The hand-off stop is the pier's anchor tile (dispatch: the 1.5 s stop).
      expect(h.stopTile).toEqual(h.anchor)
    }
  })

  it('null when nothing matches (the stamp still shows, no hop)', () => {
    expect(handOffVehicleId([], 1, 'dk_pier_1', [3, 29])).toBeNull()
  })
})

describe('the Docks unlock (B2 §4.1, §6.4 modern port): colour + _locked frames for the crossfade', () => {
  it('piers draw as dk_terminal_a / _b, the customs house as dk_port_office', () => {
    expect(buildingSprite('dk_pier_1')).toBe('dk_terminal_a')
    expect(buildingSprite('dk_pier_2')).toBe('dk_terminal_b')
    expect(buildingSprite('dk_customs')).toBe('dk_port_office')
  })

  it('every Docks building and prop has its colour and `_locked` frame in the world atlas', () => {
    const stems = [
      ...data.buildings
        .filter((b) => b.district === 'docks')
        .map((b) => buildingSprite(b.id)),
      ...data.map.props.filter((p) => p.region === 'docks').map((p) => p.frame),
    ]
    expect(stems.length).toBeGreaterThanOrEqual(6)
    for (const stem of new Set(stems)) {
      expect(inAtlas(stem, 'world'), stem).toBe(true)
      expect(inAtlas(`${stem}_locked`, 'world'), `${stem}_locked`).toBe(true)
    }
  })
})
