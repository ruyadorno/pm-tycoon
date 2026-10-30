// The attract-mode camera tour (B2 §5; src/render/AttractCamera.ts): the lot
// first, then the live regions' label tiles in map order; a 1-s hold at each
// stop, a 12-s sine ease in-out leg to the next, looping back to the lot.
import { describe, expect, it } from 'vitest'
import {
  ATTRACT_HOLD_MS,
  ATTRACT_LEG_MS,
  ATTRACT_RECYCLE_S,
  ATTRACT_ZOOM,
  AttractCamera,
  attractPose,
  attractRecycleDue,
  attractStops,
  easeInOut,
  type Pt,
} from '../../src/render/AttractCamera.ts'
import { originX, tileToScreen } from '../../src/render/iso.ts'
import { TICKS_PER_S } from '../../src/sim/types.ts'
import { makeSim } from '../sim/helpers.ts'

const A: Pt = { x: 0, y: 0 }
const B: Pt = { x: 1200, y: -600 }
const C: Pt = { x: -300, y: 900 }
const PERIOD = ATTRACT_HOLD_MS + ATTRACT_LEG_MS

describe('easeInOut', () => {
  it('runs 0 → 1 through 0.5, flat at both ends, symmetric, clamped', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBeCloseTo(1, 12)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12)
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(2)).toBeCloseTo(1, 12)
    for (const k of [0.1, 0.25, 0.4])
      expect(easeInOut(k) + easeInOut(1 - k)).toBeCloseTo(1, 12)
    // in-out: slow at the ends, fastest in the middle
    expect(easeInOut(0.05)).toBeLessThan(0.05)
    expect(easeInOut(0.95)).toBeGreaterThan(0.95)
    const mid = easeInOut(0.51) - easeInOut(0.49)
    expect(mid).toBeGreaterThan(easeInOut(0.02) - easeInOut(0))
  })
})

describe('attractPose', () => {
  it('pins the B2 §5 numbers: 12-s legs, 1-s holds, zoom 1', () => {
    expect(ATTRACT_LEG_MS).toBe(12_000)
    expect(ATTRACT_HOLD_MS).toBe(1_000)
    expect(ATTRACT_ZOOM).toBe(1)
  })

  it('holds at the first stop for 1 s, then eases along the 12-s leg', () => {
    const stops = [A, B, C]
    expect(attractPose(0, stops)).toEqual({ x: 0, y: 0, leg: 0, holding: true })
    expect(attractPose(ATTRACT_HOLD_MS - 1, stops).holding).toBe(true)
    const start = attractPose(ATTRACT_HOLD_MS, stops)
    expect(start.holding).toBe(false)
    expect(start.x).toBeCloseTo(A.x, 9)
    const mid = attractPose(ATTRACT_HOLD_MS + ATTRACT_LEG_MS / 2, stops)
    expect(mid.x).toBeCloseTo((A.x + B.x) / 2, 6)
    expect(mid.y).toBeCloseTo((A.y + B.y) / 2, 6)
    const quarter = attractPose(ATTRACT_HOLD_MS + ATTRACT_LEG_MS / 4, stops)
    // eased: a quarter of the time covers less than a quarter of the way
    expect(quarter.x).toBeLessThan(B.x / 4)
    expect(quarter.x).toBeGreaterThan(0)
  })

  it('arrives at the next stop at the end of each leg and holds there', () => {
    const stops = [A, B, C]
    const atB = attractPose(PERIOD, stops)
    expect(atB).toEqual({ x: B.x, y: B.y, leg: 1, holding: true })
    expect(attractPose(PERIOD - 1, stops).x).toBeCloseTo(B.x, 0)
    expect(attractPose(2 * PERIOD + 10, stops)).toEqual({
      x: C.x,
      y: C.y,
      leg: 2,
      holding: true,
    })
  })

  it('closes the loop: the last leg returns to the lot, then it repeats', () => {
    const stops = [A, B, C]
    const back = attractPose(3 * PERIOD - 1, stops)
    expect(back.leg).toBe(2)
    expect(back.x).toBeCloseTo(A.x, 0)
    expect(back.y).toBeCloseTo(A.y, 0)
    for (const t of [0, 4321, PERIOD + 7000, 2 * PERIOD + 500])
      expect(attractPose(t + 3 * PERIOD, stops)).toEqual(attractPose(t, stops))
  })

  it('one stop stays put; no stops gives the origin', () => {
    expect(attractPose(99_999, [B])).toEqual({
      x: B.x,
      y: B.y,
      leg: 0,
      holding: true,
    })
    expect(attractPose(5, [])).toEqual({ x: 0, y: 0, leg: 0, holding: true })
  })
})

describe('attractStops', () => {
  it('starts at the lot, then the label tiles of the live regions in map order', () => {
    const sim = makeSim(7)
    const map = sim.data.map
    const ox = originX(map.size[1])
    const lot = { x: 1536.4, y: 700.6 }
    const live = (id: string): boolean => sim.state.districts[id]?.live === true
    const stops = attractStops(lot, map.regions, live, ox)
    const want = map.regions.filter((r) => live(r.id))
    // L1: High-res + Downtown; the lot's own region is no district.
    expect(want.map((r) => r.id)).toEqual(['highres', 'downtown'])
    expect(stops[0]).toEqual({ x: 1536, y: 701 })
    expect(stops.slice(1)).toEqual(
      want.map((r) => {
        const s = tileToScreen(r.labelTile[0], r.labelTile[1], ox)
        return { x: Math.round(s.x), y: Math.round(s.y) }
      }),
    )
    // Industrial joins the tour once it is live.
    const l2 = attractStops(
      lot,
      map.regions,
      (id) => live(id) || id === 'industrial',
      ox,
    )
    expect(l2).toHaveLength(4)
  })
})

/** The parts of a Phaser camera AttractCamera drives, recorded. */
function fakeCam(zoom = 2) {
  const calls: [number, number][] = []
  const cam = {
    zoom,
    setZoom(z: number) {
      cam.zoom = z
      return cam
    },
    centerOn(x: number, y: number) {
      calls.push([x, y])
      return cam
    },
  }
  return { cam, calls }
}

describe('AttractCamera', () => {
  it('begin() snaps to zoom 1 on the lot; update() centres on whole pixels', () => {
    const { cam, calls } = fakeCam(2)
    const ac = new AttractCamera(cam)
    ac.setStops([A, B])
    expect(ac.running).toBe(false)
    expect(ac.update(0)).toBeNull()
    ac.begin(1000)
    expect(ac.running).toBe(true)
    expect(cam.zoom).toBe(1)
    expect(calls.at(-1)).toEqual([0, 0])
    const pose = ac.update(1000 + ATTRACT_HOLD_MS + 3333)!
    expect(pose.holding).toBe(false)
    const [x, y] = calls.at(-1)!
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
    expect(x).toBe(Math.round(pose.x))
    ac.stop()
    expect(ac.update(5000)).toBeNull()
  })

  it('setStops never moves the camera: a new stop count waits for the next hold (the review jump: 4 → 5 stops)', () => {
    // The square tour of the review (1017 px at 60 s, 1414 px at 130 s
    // when the pose was taken modulo the new loop).
    const s4: Pt[] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]
    const s5: Pt[] = [...s4, { x: -1000, y: 500 }]
    for (const at of [20_000, 60_000, 130_000]) {
      const { cam, calls } = fakeCam(1)
      const ac = new AttractCamera(cam)
      ac.setStops(s4)
      ac.begin(0)
      const DT = 16
      let t = 0
      for (; t < at; t += DT) ac.update(t)
      ac.setStops(s5)
      let maxStep = 0
      let prev = calls.at(-1)!
      let seenFifth = false
      // Two full new loops: every stop reached, never a jump.
      for (const end = t + 2 * 5 * PERIOD; t < end; t += DT) {
        const pose = ac.update(t)!
        const cur = calls.at(-1)!
        maxStep = Math.max(
          maxStep,
          Math.hypot(cur[0] - prev[0], cur[1] - prev[1]),
        )
        prev = cur
        if (pose.holding && pose.x === -1000 && pose.y === 500) seenFifth = true
      }
      // An eased 12-s leg of ≤ 1414 px moves < 3 px per 16-ms frame.
      expect(maxStep, `max step after setStops at ${at} ms`).toBeLessThan(4)
      expect(ac.stopCount).toBe(5)
      expect(seenFifth, 'the new stop joins the tour').toBe(true)
    }
  })

  it('a stop dropped from the list gets one bridge leg to the new lot', () => {
    const { cam, calls } = fakeCam(1)
    const ac = new AttractCamera(cam)
    ac.setStops([A, B, C])
    ac.begin(0)
    ac.update(PERIOD + 100) // holding at B
    ac.setStops([A, C])
    const DT = 16
    let prev = calls.at(-1)!
    expect(prev).toEqual([B.x, B.y])
    let maxStep = 0
    let t = PERIOD + 100 + DT
    for (; t < PERIOD + 100 + PERIOD; t += DT) {
      ac.update(t)
      const cur = calls.at(-1)!
      maxStep = Math.max(
        maxStep,
        Math.hypot(cur[0] - prev[0], cur[1] - prev[1]),
      )
      prev = cur
    }
    expect(maxStep).toBeLessThan(4)
    // The bridge ends on the new first stop, whose hold starts the new tour.
    const pose = ac.update(t + DT)!
    expect([pose.x, pose.y]).toEqual([A.x, A.y])
    expect(pose.holding).toBe(true)
  })

  it('an unchanged stop list is a no-op; before begin() it applies at once', () => {
    const { cam } = fakeCam(1)
    const ac = new AttractCamera(cam)
    ac.setStops([A, B])
    expect(ac.stopCount).toBe(2)
    ac.begin(0)
    const p0 = ac.update(5000)!
    ac.setStops([A, B])
    expect(ac.update(5000)).toEqual(p0)
  })

  it('setStops keeps the clock (a new stop does not jump back to the lot)', () => {
    const { cam } = fakeCam(1)
    const ac = new AttractCamera(cam)
    ac.setStops([A, B])
    ac.begin(0)
    const before = ac.update(PERIOD + 10)!
    ac.setStops([A, B, C])
    const after = ac.update(PERIOD + 10)!
    expect(after.leg).toBe(before.leg)
    expect(ac.stopCount).toBe(3)
  })
})

describe('attractRecycleDue (the long-idle Title, B2 §5)', () => {
  const base = { tick: 14_400, lives: 3 }
  const st = (dt: number, lives = 3, gameOver = false) => ({
    tick: base.tick + dt,
    economy: { lives, gameOver },
  })
  it('recycles after ATTRACT_RECYCLE_S of attract sim time (30 min)', () => {
    expect(ATTRACT_RECYCLE_S).toBe(30 * 60)
    const limit = ATTRACT_RECYCLE_S * TICKS_PER_S
    expect(attractRecycleDue(st(0), base)).toBe(false)
    expect(attractRecycleDue(st(limit - 1), base)).toBe(false)
    expect(attractRecycleDue(st(limit), base)).toBe(true)
  })
  it('recycles on the first lost life or a game over', () => {
    expect(attractRecycleDue(st(10, 2), base)).toBe(true)
    expect(attractRecycleDue(st(10, 3, true), base)).toBe(true)
  })
})
