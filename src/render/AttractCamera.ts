// The attract-mode camera tour (B2 §5): behind the Title the City camera
// drifts between the lot and the label tiles (map.json regions[].labelTile)
// of the LIVE regions — a 1-s hold at each stop, then a 12-s leg to the next
// with a sine ease in-out, at zoom 1, looping. The timeline is a pure
// function of the elapsed scene time (attractPose), so the frozen test clock
// drives it like any other animation and a Vitest pins the maths.
//
// A stop-list change (a region unlocking in the demo city, a new tier's
// warehouse centre, the recycled snapshot) never moves the camera: it waits
// for the next hold, where the camera stands still on a stop, and the tour
// restarts from that stop's hold in the new list (or, if the stop is gone,
// glides from it to the new lot).
//
// Also the demo's recycle rule (attractRecycleDue): the Title re-installs the
// snapshot after ATTRACT_RECYCLE_S of attract sim time or on its first lost
// life, so a long-idle Title never shows the post-cap decay.
//
// Phaser-free (like iso.ts): AttractCamera only needs the camera's
// centerOn / setZoom, so Node can load this module.
import { TICKS_PER_S } from '../sim/types.ts'
import { tileToScreen } from './iso.ts'

/** One leg's travel time (B2 §5). */
export const ATTRACT_LEG_MS = 12_000
/** The hold at each stop before the next leg starts (B2 §5). */
export const ATTRACT_HOLD_MS = 1_000
/** The tour's camera zoom (B2 §5). */
export const ATTRACT_ZOOM = 1
/**
 * Attract sim time before the Title re-installs the snapshot (presentation,
 * not balance: the shipped snapshot first loses a life ~61 min in, past the
 * level cap's malware climb).
 */
export const ATTRACT_RECYCLE_S = 30 * 60

/** What a freshly installed attract sim starts from (the snapshot's). */
export interface AttractBase {
  tick: number
  lives: number
}

/** The bits of SimState the recycle rule reads. */
export interface AttractSimState {
  tick: number
  economy: { lives: number; gameOver: boolean }
}

/**
 * True when the demo city should be re-installed from its snapshot:
 * ATTRACT_RECYCLE_S of sim time since the snapshot, a life lost, or game over.
 */
export function attractRecycleDue(
  st: AttractSimState,
  base: AttractBase,
  recycleS = ATTRACT_RECYCLE_S,
): boolean {
  return (
    st.economy.gameOver ||
    st.economy.lives < base.lives ||
    st.tick - base.tick >= recycleS * TICKS_PER_S
  )
}

export interface Pt {
  x: number
  y: number
}

export interface AttractPose {
  x: number
  y: number
  /** Index of the stop the current hold / leg starts from. */
  leg: number
  holding: boolean
}

/** A region row as map.json carries it (id + its label tile). */
export interface RegionStop {
  id: string
  labelTile: readonly [number, number]
}

/** Sine ease in-out on [0, 1] (0 → 0, 0.5 → 0.5, 1 → 1, flat at both ends). */
export function easeInOut(k: number): number {
  const c = Math.min(1, Math.max(0, k))
  return 0.5 - 0.5 * Math.cos(Math.PI * c)
}

/**
 * The camera centre `t` ms into the tour of `stops` (world px): hold at
 * stops[0] for holdMs, travel legMs to stops[1], hold, …, then from the last
 * stop back to stops[0], forever. One stop: it stays there; none: (0, 0).
 */
export function attractPose(
  t: number,
  stops: readonly Pt[],
  legMs = ATTRACT_LEG_MS,
  holdMs = ATTRACT_HOLD_MS,
): AttractPose {
  const n = stops.length
  const first = stops[0]
  if (!first) return { x: 0, y: 0, leg: 0, holding: true }
  if (n === 1) return { x: first.x, y: first.y, leg: 0, holding: true }
  const period = holdMs + legMs
  const loop = period * n
  const tt = (((Number.isFinite(t) ? t : 0) % loop) + loop) % loop
  const leg = Math.min(n - 1, Math.floor(tt / period))
  const into = tt - leg * period
  const a = stops[leg]!
  if (into < holdMs || legMs <= 0) return { x: a.x, y: a.y, leg, holding: true }
  const b = stops[(leg + 1) % n]!
  const k = easeInOut((into - holdMs) / legMs)
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    leg,
    holding: false,
  }
}

/**
 * The tour's stops in world px: the lot first, then the label tile of every
 * live region in map order (`isLive` is false for the lot's own region and
 * for locked districts). `ox` = iso originX of the map.
 */
export function attractStops(
  lot: Pt,
  regions: readonly RegionStop[],
  isLive: (id: string) => boolean,
  ox: number,
): Pt[] {
  const out: Pt[] = [{ x: Math.round(lot.x), y: Math.round(lot.y) }]
  for (const r of regions) {
    if (!isLive(r.id)) continue
    const s = tileToScreen(r.labelTile[0], r.labelTile[1], ox)
    out.push({ x: Math.round(s.x), y: Math.round(s.y) })
  }
  return out
}

/** The parts of a Phaser camera the tour drives. */
export interface AttractCam {
  zoom: number
  setZoom(z: number): unknown
  centerOn(x: number, y: number): unknown
}

const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y

const sameStops = (a: readonly Pt[], b: readonly Pt[]): boolean =>
  a.length === b.length && a.every((p, i) => samePt(p, b[i]!))

/**
 * Drives one camera along attractPose. begin(now) starts the tour at the
 * first stop; update(now) centres the camera on the pose (whole pixels, so
 * the pixel art never swims). setStops never jumps: while the tour runs the
 * new list waits for the next hold (the camera at rest on a stop), then the
 * tour re-bases to start that stop's hold in the new list; a stop that is no
 * longer listed gets one bridge leg from it to the new first stop.
 */
export class AttractCamera {
  private readonly cam: AttractCam
  private stops: Pt[] = []
  private start: number | null = null
  /** A stop list waiting for the next hold (setStops while running). */
  private pending: Pt[] | null = null
  /** The bridge leg from a dropped stop: [from, new first stop] since t0. */
  private bridge: { stops: Pt[]; t0: number } | null = null

  constructor(cam: AttractCam) {
    this.cam = cam
  }

  get running(): boolean {
    return this.start !== null
  }

  /** Stops of the tour now driving the camera (a pending list not yet). */
  get stopCount(): number {
    return this.stops.length
  }

  setStops(stops: readonly Pt[]): void {
    const next = stops.map((p) => ({ x: p.x, y: p.y }))
    if (this.start === null) {
      this.stops = next
      this.pending = null
      this.bridge = null
      return
    }
    this.pending = sameStops(next, this.stops) ? null : next
  }

  begin(now: number): void {
    this.start = now
    this.bridge = null
    if (this.pending) this.stops = this.pending
    this.pending = null
    if (this.cam.zoom !== ATTRACT_ZOOM) this.cam.setZoom(ATTRACT_ZOOM)
    this.update(now)
  }

  /** The pose at `now` (and the camera centred on it); null when stopped. */
  update(now: number): AttractPose | null {
    if (this.start === null) return null
    let pose = this.pose(now)
    if (this.pending && pose.holding) {
      this.rebase(now, pose)
      pose = this.pose(now)
    }
    if (this.stops.length > 0 || this.bridge)
      this.cam.centerOn(Math.round(pose.x), Math.round(pose.y))
    return pose
  }

  stop(): void {
    this.start = null
    this.pending = null
    this.bridge = null
  }

  private pose(now: number): AttractPose {
    const b = this.bridge
    if (b) {
      const period = ATTRACT_HOLD_MS + ATTRACT_LEG_MS
      if (now - b.t0 < period) {
        const p = attractPose(now - b.t0, b.stops)
        return { ...p, leg: 0 }
      }
      this.bridge = null
    }
    return attractPose(now - (this.start ?? now), this.stops)
  }

  /** Apply the pending list while the camera rests at `at` (a hold). */
  private rebase(now: number, at: AttractPose): void {
    const next = this.pending
    if (!next) return
    this.pending = null
    const here = { x: at.x, y: at.y }
    this.stops = next
    const period = ATTRACT_HOLD_MS + ATTRACT_LEG_MS
    const j = next.findIndex((p) => samePt(p, here))
    const first = next[0]
    if (j >= 0 || !first) {
      // The same stop in the new list: its hold starts over (no movement).
      this.start = now - Math.max(0, j) * period
      this.bridge = null
      return
    }
    // The stop is gone: one leg from it to the new lot, then the new tour.
    this.bridge = { stops: [here, first], t0: now }
    this.start = now + period
  }
}
