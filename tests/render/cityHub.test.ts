// M8 overseas hubs in the city (spec-build2 §4.1; spec-core §5.6;
// design-m8-m9 §6.2, §7 M8 8; M9 §7 M9 11: the Airport's plane — the
// shipped map.hubs row, its taxi path across the runway, the climb and the
// fade, the 20-s ring on ap_terminal through a forced-L5 sim, the
// clearance stamps rising out of the ring): the vessel's departure timeline (out 4 s →
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
import {
  footprintRect,
  groundAt,
  inRect,
  isRoadTile,
  mapBlockAt,
  type MapHubDef,
} from '../../src/data/index.ts'
import {
  canDepart,
  clearedStampText,
  clearingCountText,
  clearStampPoint,
  DEPART_AWAY_MS,
  DEPART_BACK_MS,
  DEPART_MS,
  DEPART_OUT_MS,
  handOffVehicleId,
  CityHubView,
  LIFT_FADE_FROM,
  LIFT_FROM,
  lockedStampText,
  lostStampText,
  RING_H,
  RING_LAST,
  RING_LIFT,
  ringFrame,
  stampSum,
  STAMP_OVER_RING,
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
const map = data.map
const docksHub = data.map.hubs.find((h) => h.district === 'docks') as MapHubDef
const docksDef = data.districts.find((d) => d.id === 'docks')
const CLEAR_TICKS =
  (docksDef?.kind === 'overseas' ? docksDef.clearanceS : 45) * TICKS_PER_S
/** M9: the shipped Airport row (design-m8-m9 §1.2): taxis east, climbs 64 px. */
const plane = data.map.hubs.find((h) => h.district === 'airport') as MapHubDef
const airportDef = data.districts.find((d) => d.id === 'airport')
const AIRPORT_TICKS =
  (airportDef?.kind === 'overseas' ? airportDef.clearanceS : 20) * TICKS_PER_S

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
    // M9: the re-rolled dk_ship points its bow up-left (−x, prompts.ts
    // DOCK_PROP_HEADING), so it sails out along −x bow first.
    expect(ex).toBeLessThan(0)
    expect(ey).toBe(0)
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
    expect(plane).toEqual({
      district: 'airport',
      office: 'ap_terminal',
      vessel: { frame: 'ap_plane', tile: [45, 10], exit: [4, 0], liftPx: 64 },
    })
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
  hub: MapHubDef = docksHub,
) {
  const f = fakeScene()
  const ship = fakeObj('image', HOME.x, HOME.y, hub.vessel.frame)
  const vessel = { img: ship as never, x: HOME.x, y: HOME.y }
  const hv = new CityHubView(f.scene, f.layer, vs, hub, {
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

// ---------------------------------------------------------------- M9 the Airport (B2 §4.3)

/** A quiet sim forced to L5 (Docks + Airport live), funded, no spawns. */
function l5(seed = 1): { sim: Sim; vs: ViewSim } {
  const sim = quietSim(seed)
  const res = sim.dispatch({ kind: 'debugForceLevel', level: 5 })
  if (!res.ok) throw new Error(`forceLevel 5: ${res.reason}`)
  for (const d of Object.values(sim.state.districts)) d.nextSpawnTick = null
  fund(sim)
  return { sim, vs: createViewSim(() => sim, { debug: true }) }
}

describe('M9 the Airport hub: the shipped map.hubs row (B2 §4.3; design-m8-m9 §1.2)', () => {
  it('ap_terminal carries the ring; the vessel is the ap_plane prop on the runway, leaving east off the map edge with a climb', () => {
    expect(airportDef?.kind).toBe('overseas')
    expect(AIRPORT_TICKS).toBe(200)
    const office = data.buildings.find((b) => b.id === plane.office)
    expect(office?.district).toBe('airport')
    const prop = map.props.find(
      (p) =>
        p.frame === plane.vessel.frame &&
        p.tile[0] === plane.vessel.tile[0] &&
        p.tile[1] === plane.vessel.tile[1],
    )
    expect(prop?.region).toBe('airport')
    // East = +x in tile space (the diamond's lower-right edge), nose first
    // (art: ap_plane's nose points to the lower right, prompts.ts).
    const [ex, ey] = plane.vessel.exit
    expect(ex).toBeGreaterThan(0)
    expect(ey).toBe(0)
    expect(plane.vessel.tile[0] + ex).toBeGreaterThanOrEqual(map.size[0])
    expect(plane.vessel.liftPx).toBeGreaterThan(0)
    // The stand is on the runway strip east of the Airport blocks.
    const [sx, sy] = plane.vessel.tile
    expect(mapBlockAt(map, sx, sy)).toBeNull()
    expect(groundAt(map, sx, sy)).toMatch(/^(runway|tarmac|taxiway)/)
  })

  it('the taxi crosses only runway tiles: no road, block, building footprint or other prop on its way', () => {
    const [x0, y] = plane.vessel.tile
    const last = Math.min(map.size[0] - 1, x0 + plane.vessel.exit[0])
    expect(last).toBeGreaterThan(x0)
    for (let x = x0; x <= last; x++) {
      expect(isRoadTile(map, x, y), `road at ${x},${y}`).toBe(false)
      expect(mapBlockAt(map, x, y), `block at ${x},${y}`).toBeNull()
      expect(groundAt(map, x, y)).toMatch(/^(runway|tarmac|taxiway)/)
      const b = data.buildings.find((d) => inRect(footprintRect(d), x, y))
      expect(b?.id, `building at ${x},${y}`).toBeUndefined()
      if (x === x0) continue
      const p = map.props.find((q) => q.tile[0] === x && q.tile[1] === y)
      expect(p?.frame, `prop at ${x},${y}`).toBeUndefined()
    }
  })

  it('taxis level for the first 40 %, then climbs `liftPx` in whole px every frame, leaving level with its stand', () => {
    const lift = plane.vessel.liftPx
    const [ex, ey] = plane.vessel.exit
    let prevDx = -Infinity
    let prevLift = -Infinity
    for (let ms = 0; ms <= DEPART_OUT_MS; ms += 1000 / 60) {
      const t = ms / DEPART_OUT_MS
      const off = vesselOffset(plane, 'out', t)
      if (t <= LIFT_FROM) expect(off.liftPx).toBe(0)
      expect(off.liftPx).toBeGreaterThanOrEqual(prevLift)
      const s = vesselScreenOffset(off)
      expect(Number.isInteger(s.dx) && Number.isInteger(s.dy)).toBe(true)
      // +x is right and down on screen: the plane only ever moves right.
      expect(s.dx).toBeGreaterThanOrEqual(prevDx)
      prevDx = s.dx
      prevLift = off.liftPx
    }
    expect(vesselScreenOffset(vesselOffset(plane, 'out', 1))).toEqual({
      dx: (ex - ey) * 32,
      dy: (ex + ey) * 16 - lift,
    })
    expect(vesselOffset(plane, 'away', 0.5).liftPx).toBe(lift)
    // No reverse taxi: `back` happens at the stand.
    for (const t of [0, 0.5, 1])
      expect(vesselOffset(plane, 'back', t)).toEqual({
        dTx: 0,
        dTy: 0,
        liftPx: 0,
      })
  })

  it('alpha: opaque taxiing and climbing, fading out over the last 20 %, hidden away, fading in at the stand; the ship never fades', () => {
    expect(LIFT_FADE_FROM).toBe(0.8)
    expect(LIFT_FADE_FROM).toBeGreaterThan(LIFT_FROM)
    for (const t of [0, 0.4, 0.6, LIFT_FADE_FROM])
      expect(vesselAlpha(plane, 'out', t), `out ${t}`).toBe(1)
    expect(vesselAlpha(plane, 'out', 0.9)).toBeCloseTo(0.5, 9)
    expect(vesselAlpha(plane, 'out', 1)).toBe(0)
    let prev = 1
    for (let t = LIFT_FADE_FROM; t <= 1; t += 0.01) {
      const a = vesselAlpha(plane, 'out', t)
      expect(a).toBeLessThanOrEqual(prev + 1e-12)
      prev = a
    }
    expect(vesselAlpha(plane, 'away', 0.5)).toBe(0)
    expect(vesselAlpha(plane, 'back', 0)).toBe(0)
    expect(vesselAlpha(plane, 'back', 0.5)).toBe(0.5)
    expect(vesselAlpha(plane, 'back', 1)).toBe(1)
    expect(vesselAlpha(plane, 'home', 0)).toBe(1)
    for (const t of [0, 0.5, 0.9, 1]) {
      expect(vesselAlpha(docksHub, 'out', t)).toBe(1)
      expect(vesselAlpha(docksHub, 'back', t)).toBe(1)
    }
  })
})

describe('M9 CityHubView: the Airport over a forced-L5 sim (fake scene, scene clock)', () => {
  it('no ring and no clearance while the Airport is fogged (forced L4)', () => {
    const sim = quietSim(1)
    expect(sim.dispatch({ kind: 'debugForceLevel', level: 4 }).ok).toBe(true)
    const vs = createViewSim(() => sim, { debug: true })
    expect(vs.hub('airport')?.live).toBe(false)
    expect(vs.debug!.forceOverseasMalware('airport').ok).toBe(false)
    const { hv } = hubView(vs, OFFICE, plane)
    hv.syncAll()
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBeNull()
  })

  it('the ring drains on ap_terminal over the 20-s clearance, nine equal steps', () => {
    const { sim, vs } = l5()
    expect(vs.hub('airport')?.live).toBe(true)
    expect(vs.hub('airport')?.office).toBe('ap_terminal')
    expect(vs.debug!.forceOverseasMalware('airport').ok).toBe(true)
    const c = vs.hub('airport')?.clearing[0]
    expect(c?.buildingId).toMatch(/^ap_/)
    if (!c) return
    expect(c.clearTick - c.handOffTick).toBe(AIRPORT_TICKS)
    const { hv, ring } = hubView(vs, OFFICE, plane)
    hv.syncAll()
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBe(0)
    expect(ring()?.x).toBe(OFFICE.anchor.x)
    runTicks(sim, AIRPORT_TICKS / 2)
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBe(4)
    runTicks(sim, c.clearTick - 1 - sim.state.tick)
    hv.update(0, vs.tick + 0.5)
    expect(hv.ringShown).toBe(8)
    runTicks(sim, 1)
    hv.update(0, vs.tick)
    expect(hv.ringShown).toBeNull()
  })

  it('hub:departure {airport} sends the plane east and up, fading out; it fades back in at its stand; the Docks ship stays put', () => {
    const { sim, vs } = l5()
    const air = hubView(vs, OFFICE, plane)
    const dock = hubView(vs, OFFICE, docksHub)
    air.hv.syncAll()
    dock.hv.syncAll()
    const cleared: { hub: string; malware: boolean }[] = []
    let start: number | null = null
    sim.events.on('parcel:cleared', (p) => {
      cleared.push({ hub: p.hub, malware: p.malware })
    })
    sim.events.on('hub:departure', (p) => {
      start = sim.state.tick * 100
      if (p.hub === 'airport') air.hv.depart(start)
      else dock.hv.depart(start)
    })
    vs.debug!.forceOverseasMalware('airport')
    runTicks(sim, AIRPORT_TICKS)
    expect(cleared).toEqual([{ hub: 'airport', malware: true }])
    expect(start).not.toBeNull()
    const t0 = start as unknown as number
    const p = air.ship
    // Mid-taxi: right of and below the stand on screen, opaque.
    air.hv.update(t0 + DEPART_OUT_MS * 0.3, vs.tick)
    expect(air.hv.phase).toBe('out')
    expect(p.x).toBeGreaterThan(HOME.x)
    expect(p.y).toBeGreaterThan(HOME.y)
    expect(p.alpha).toBe(1)
    // Climbing and fading: higher than the level taxi would put it.
    air.hv.update(t0 + DEPART_OUT_MS * 0.9, vs.tick)
    const level = vesselScreenOffset({
      ...vesselOffset(plane, 'out', 0.9),
      liftPx: 0,
    })
    expect(p.y).toBeLessThan(HOME.y + level.dy)
    expect(p.alpha).toBeGreaterThan(0)
    expect(p.alpha).toBeLessThan(1)
    expect(p.visible).toBe(true)
    // Away 10 s: hidden; a second departure is ignored.
    air.hv.update(t0 + DEPART_OUT_MS + 5000, vs.tick)
    expect(air.hv.phase).toBe('away')
    expect(p.visible).toBe(false)
    expect(air.hv.depart(t0 + DEPART_OUT_MS + 5000)).toBe(false)
    // Back: at the stand, fading in.
    air.hv.update(t0 + DEPART_OUT_MS + DEPART_AWAY_MS + 1000, vs.tick)
    expect(air.hv.phase).toBe('back')
    expect({ x: p.x, y: p.y, visible: p.visible }).toEqual({
      ...HOME,
      visible: true,
    })
    expect(p.alpha).toBeCloseTo(1000 / DEPART_BACK_MS, 9)
    air.hv.update(t0 + DEPART_MS, vs.tick)
    expect(air.hv.phase).toBe('home')
    expect({ x: p.x, y: p.y, alpha: p.alpha }).toEqual({ ...HOME, alpha: 1 })
    // The other hub's vessel never moved.
    dock.hv.update(t0 + DEPART_OUT_MS * 0.5, vs.tick)
    expect(dock.hv.phase).toBe('home')
    expect({ x: dock.ship.x, y: dock.ship.y }).toEqual(HOME)
  })

  it('syncAll mid-climb (wake / sim swap) lands the plane at its stand, opaque', () => {
    const { vs } = l5()
    const { hv, ship } = hubView(vs, OFFICE, plane)
    hv.depart(0)
    hv.update(DEPART_OUT_MS * 0.95, vs.tick)
    expect(ship.alpha).toBeLessThan(1)
    hv.syncAll()
    expect(hv.phase).toBe('home')
    expect({ x: ship.x, y: ship.y, alpha: ship.alpha }).toEqual({
      ...HOME,
      alpha: 1,
    })
  })
})

describe('M9 clearance stamps rise out of the ring (clearStampPoint)', () => {
  it('centred on the office, the stamp pill clear above the ring', () => {
    const at = clearStampPoint(OFFICE)
    expect(at.x).toBe(OFFICE.anchor.x)
    const ringTop = OFFICE.topY - RING_LIFT - RING_H
    expect(at.y).toBe(ringTop - STAMP_OVER_RING)
    // The 18-px pill is centred on the point: its bottom stays over the ring.
    expect(at.y + 9).toBeLessThan(ringTop)
    const odd = clearStampPoint({ anchor: { x: 10.5 }, topY: 100.4 })
    expect(Number.isInteger(odd.x) && Number.isInteger(odd.y)).toBe(true)
  })

  it('ap_terminal is both the Airport office and a hand-off building (its LOCKED stamps stay on its door)', () => {
    const t = data.buildings.find((b) => b.id === plane.office)
    expect(t?.recv).toBeGreaterThan(0)
    const port = data.buildings.find((b) => b.id === docksHub.office)
    expect(port?.recv).toBe(0)
  })
})

describe('M9 the Airport unlock (B2 §4.3, §6.5): colour + _locked frames for the crossfade', () => {
  it('ap_terminal / ap_cargo_hangar draw their own sprites; every Airport building and prop has colour + `_locked` in the world atlas', () => {
    const ids = data.buildings
      .filter((b) => b.district === 'airport')
      .map((b) => b.id)
    expect(ids.toSorted()).toEqual(['ap_cargo_hangar', 'ap_terminal'])
    for (const id of ids) expect(buildingSprite(id)).toBe(id)
    const props = map.props
      .filter((p) => p.region === 'airport')
      .map((p) => p.frame)
    expect(props.toSorted()).toEqual(['ap_plane', 'ap_tower'])
    for (const stem of [...ids, ...props]) {
      expect(inAtlas(stem, 'world'), stem).toBe(true)
      expect(inAtlas(`${stem}_locked`, 'world'), `${stem}_locked`).toBe(true)
    }
  })
})
