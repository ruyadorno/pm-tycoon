// The overseas hubs in the city (spec-build2.md §4.1, §4.3; spec-core.md
// §5.6; design-m8-m9 §6.2): the clearance ring over the hub's office and the
// vessel's departure, as a pure model (timelines, offsets, ring frames, stamp
// texts — Vitest pins them under Node, tests/render/cityHub.test.ts) and a
// thin view (CityHubView) that CityScene drives.
//
// - Clearance ring [M8]: `ring_N` (16×16, ring_0 full … ring_8 empty) over
//   the map.hubs `office` (Docks: dk_customs drawn as dk_port_office) in the
//   marker band, drained by (tick − handOffTick) / (clearTick − handOffTick)
//   of the soonest clearance, with `×N` beside it when N ≥ 2 parcels clear;
//   hidden when nothing clears. Tick-derived (tick + the stepper alpha), so a
//   load or a wake shows it at once.
// - Departure: `hub:departure` (one per hub per tick with clearances) →
//   CityHubView.depart. The vessel prop (map.hubs `vessel`: the dk_ship prop)
//   travels its `exit` tile delta in tile space (iso deltas, integer rounding
//   every frame, depth unchanged) over DEPART_OUT_MS, hides DEPART_AWAY_MS,
//   sails back over DEPART_BACK_MS (render only, B2 §4.1 "sails west off the
//   map edge over 4 s and returns after 10 s"). A departure while the vessel
//   is not home is ignored (design §9 R3: a batch = the clearances during one
//   18-s trip). Reduced motion: no travel, hidden 10 s. The plane of M9
//   (`liftPx` > 0) climbs over the last 60 % of its taxi out and fades back
//   in at its stand instead of sailing back (vesselOffset / vesselAlpha).
// - Stamps (CityScene draws them with Popups): grey `LOCKED $18` at the pier
//   on `parcel:handedOff`, gold `CLEARED +$18` at the office on
//   `parcel:cleared`, red `SHIP HAS SAILED` (Airport: `PLANE HAS LEFT`, §9
//   R11) for a malware clearance. Same-place stamps inside the Popups merge
//   window sum their dollars (stampSum).
//
// No Phaser value import and no DOM (types only): the scene clock (ms) and
// the sim tick come in as arguments, so the timelines are frozen-clock
// friendly and the module loads under Node.
import type Phaser from 'phaser'
import type { DistrictId, MapHubDef } from '../data/index.ts'
import type { HubClearing, VehicleSnapshot, ViewSim } from '../sim/view-api.ts'
import { FONT_KEY, WORLD_ATLAS } from './atlases.ts'
import { frameOrNull } from './frames.ts'
import { HH, HW } from './iso.ts'
import { FONT_SIZE, THEME } from '../ui/theme.ts'

// ---------------------------------------------------------------- departure (B2 §4.1)

/** The vessel sails out over 4 s, stays away 10 s, sails back over 4 s (render timings). */
export const DEPART_OUT_MS = 4000
export const DEPART_AWAY_MS = 10_000
export const DEPART_BACK_MS = 4000
export const DEPART_MS = DEPART_OUT_MS + DEPART_AWAY_MS + DEPART_BACK_MS
/** M9 plane: the climb (liftPx) runs over the last 60 % of the taxi out. */
export const LIFT_FROM = 0.4

export type VesselPhase = 'home' | 'out' | 'away' | 'back'

export interface VesselState {
  phase: VesselPhase
  /** 0..1 progress through the phase (0 at home). */
  t: number
}

/**
 * Where a trip started at `startMs` is at `nowMs` (scene clock): `out` 4 s →
 * `away` 10 s → `back` 4 s → `home`; `home` with no trip. Under reduced
 * motion the travel legs take no time (hidden 10 s, then home).
 */
export function vesselPhase(
  startMs: number | null,
  nowMs: number,
  reduced = false,
): VesselState {
  if (startMs === null || !Number.isFinite(nowMs - startMs))
    return { phase: 'home', t: 0 }
  const e = Math.max(0, nowMs - startMs)
  const out = reduced ? 0 : DEPART_OUT_MS
  const back = reduced ? 0 : DEPART_BACK_MS
  if (e < out) return { phase: 'out', t: e / out }
  if (e < out + DEPART_AWAY_MS)
    return { phase: 'away', t: (e - out) / DEPART_AWAY_MS }
  if (e < out + DEPART_AWAY_MS + back)
    return { phase: 'back', t: (e - out - DEPART_AWAY_MS) / back }
  return { phase: 'home', t: 0 }
}

/** A new trip may start only from home (design §9 R3). */
export function canDepart(
  startMs: number | null,
  nowMs: number,
  reduced = false,
): boolean {
  return vesselPhase(startMs, nowMs, reduced).phase === 'home'
}

const clamp01 = (t: number): number =>
  Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0

/** Tile-space offset of the vessel from its prop tile (+ the plane's climb in screen px). */
export interface VesselOffset {
  dTx: number
  dTy: number
  liftPx: number
}

/**
 * The vessel's offset for a phase: `out` eases in along `exit` (t², exact
 * endpoints: 0 at t 0, `exit` at t 1), `away` = `exit`, `back` eases out to
 * 0 ((1 − t)²). The plane (liftPx > 0, M9) climbs over the last 60 % of
 * `out` and does not taxi back (its `back` is a fade-in at the stand,
 * vesselAlpha).
 */
export function vesselOffset(
  hub: Pick<MapHubDef, 'vessel'>,
  phase: VesselPhase,
  t: number,
): VesselOffset {
  const [ex, ey] = hub.vessel.exit
  const lift = hub.vessel.liftPx
  const u = clamp01(t)
  let k = 0
  let l = 0
  if (phase === 'out') {
    k = u * u
    const c = clamp01((u - LIFT_FROM) / (1 - LIFT_FROM))
    l = lift * c * c
  } else if (phase === 'away') {
    k = 1
    l = lift
  } else if (phase === 'back' && lift <= 0) {
    k = (1 - u) * (1 - u)
  }
  // `+ 0` keeps −0 out (a negative exit times 0).
  return { dTx: ex * k + 0, dTy: ey * k + 0, liftPx: l + 0 }
}

/** The offset in integer screen px (iso deltas, rounded every frame; no sub-pixel art). */
export function vesselScreenOffset(
  off: VesselOffset,
  out: { dx: number; dy: number } = { dx: 0, dy: 0 },
): { dx: number; dy: number } {
  out.dx = Math.round((off.dTx - off.dTy) * HW) + 0
  out.dy = Math.round((off.dTx + off.dTy) * HH - off.liftPx) + 0
  return out
}

/** Vessel alpha: hidden while away; the plane (M9) fades in at its stand on `back`. */
export function vesselAlpha(
  hub: Pick<MapHubDef, 'vessel'>,
  phase: VesselPhase,
  t: number,
): number {
  if (phase === 'away') return 0
  if (phase === 'back' && hub.vessel.liftPx > 0) return clamp01(t)
  return 1
}

// ---------------------------------------------------------------- clearance ring (§5.6)

/** ring_0 (full) … ring_8 (empty): the manifest's decay coin ring. */
export const RING_LAST = 8

/**
 * Ring frame index of the soonest clearance at `tickNow` (fractional ticks
 * allowed): 0 at the hand-off, stepping through 9 equal parts of the
 * clearance to 8 at the clearance tick; null with nothing clearing.
 */
export function ringFrame(
  c: Pick<HubClearing, 'handOffTick' | 'clearTick'> | null,
  tickNow: number,
): number | null {
  if (!c) return null
  const span = c.clearTick - c.handOffTick
  if (!(span > 0)) return RING_LAST
  const k = (tickNow - c.handOffTick) / span
  if (!Number.isFinite(k)) return 0
  return Math.max(0, Math.min(RING_LAST, Math.floor(k * (RING_LAST + 1))))
}

/** The count beside the ring: `×N` from 2 parcels, else empty. */
export function clearingCountText(n: number): string {
  return n >= 2 ? `×${n}` : ''
}

// ---------------------------------------------------------------- stamps

/** Grey stamp at the pier on a hand-off: the value is locked. */
export function lockedStampText(value: number): string {
  return `LOCKED $${value}`
}

/** Gold stamp at the office on a paid clearance. */
export function clearedStampText(paid: number): string {
  return `CLEARED +$${paid}`
}

/** Red stamp at the office on a malware clearance (B2 §4.1; §9 R11 for the Airport). */
export function lostStampText(hub: DistrictId): string {
  return hub === 'airport' ? 'PLANE HAS LEFT' : 'SHIP HAS SAILED'
}

/**
 * The vehicle handing parcel `parcelId` off at pier `buildingId` (the hop's
 * start; `parcel:handedOff` names no vehicle): the snapshot that still
 * carries it (the facade's per-revision cache predates the emitting tick at
 * 1×), else the one standing at that stop, else — a cache rebuilt mid-tick
 * at 2×+, the cargo already spliced and the stop not yet timed — a
 * delivering vehicle on the pier's anchor tile (where the hand-off stop
 * is). Null when none matches (no hop, the stamp still shows).
 */
export function handOffVehicleId(
  snaps: readonly Pick<
    VehicleSnapshot,
    'id' | 'cargo' | 'stopAt' | 'state' | 'cur'
  >[],
  parcelId: number,
  buildingId: string,
  anchor: readonly [number, number],
): number | null {
  const s =
    snaps.find((v) => v.cargo.some((c) => c.id === parcelId)) ??
    snaps.find((v) => v.stopAt === buildingId) ??
    snaps.find(
      (v) =>
        v.state === 'delivering' &&
        Math.round(v.cur.tx) === anchor[0] &&
        Math.round(v.cur.ty) === anchor[1],
    )
  return s ? s.id : null
}

/** Running sum of a stamp key's dollars inside the Popups merge window. */
export interface StampSum {
  atMs: number
  sum: number
}

/**
 * The dollars a same-place stamp shows: `value` added to the previous sum
 * while it is younger than `mergeMs` (Popups merges the slot and replaces
 * its label), else `value` alone.
 */
export function stampSum(
  prev: StampSum | undefined,
  nowMs: number,
  value: number,
  mergeMs: number,
): StampSum {
  if (prev && nowMs - prev.atMs < mergeMs)
    return { atMs: nowMs, sum: prev.sum + value }
  return { atMs: nowMs, sum: value }
}

// ---------------------------------------------------------------- view

/** The vessel prop as CityScene holds it (its Image is rebuilt on a lock swap). */
export interface VesselRef {
  readonly img: Phaser.GameObjects.Image | null
  /** Home foot point (the prop's placement, world px). */
  readonly x: number
  readonly y: number
}

/** The office building the ring sits on (CityScene's BuildingView fits). */
export interface OfficeRef {
  readonly anchor: { readonly x: number; readonly y: number }
  /** World y of the sprite's visible top. */
  readonly topY: number
  readonly locked: boolean
}

export interface CityHubViewRefs {
  vessel: VesselRef | null
  office: OfficeRef | null
  /** Depth of the ring (DEPTH.marker + the office's depth + DEPTH.bell). */
  depth: number
}

/** Ring bottom this far above the office's visible top (the rush bell's lift). */
export const RING_LIFT = 6
/** `×N` starts this far right of the ring's centre. */
const COUNT_DX = 10
/** m5x7 metrics (src/assets/m5x7.xml): cap top 4, cap height 7 (BuildingView.capTop). */
const CAP_TOP = 4
const CAP_H = 7
const RING_H = 16

/**
 * One overseas hub in the city: the clearance ring over its office and its
 * vessel's trips. CityScene creates one per map.hubs row and calls
 * depart() on `hub:departure`, update() every frame, syncAll() on create /
 * wake / sim swap (the vessel snaps home), destroy() on shutdown.
 */
export class CityHubView {
  readonly id: DistrictId
  readonly office: string
  private readonly scene: Phaser.Scene
  private readonly layer: Phaser.GameObjects.Layer
  private readonly vs: ViewSim
  private readonly hub: MapHubDef
  private readonly refs: CityHubViewRefs
  private startMs: number | null = null
  private reduced = false
  private state: VesselState = { phase: 'home', t: 0 }
  private ring: Phaser.GameObjects.Image | null = null
  private count: Phaser.GameObjects.BitmapText | null = null
  private readonly off = { dx: 0, dy: 0 }

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    vs: ViewSim,
    hub: MapHubDef,
    refs: CityHubViewRefs,
  ) {
    this.scene = scene
    this.layer = layer
    this.vs = vs
    this.hub = hub
    this.refs = refs
    this.id = hub.district
    this.office = hub.office
  }

  /** The vessel's phase as of the last update (debug / e2e probes). */
  get phase(): VesselPhase {
    return this.state.phase
  }

  /** The ring frame shown (0..8), null while hidden (debug / e2e probes). */
  get ringShown(): number | null {
    if (!this.ring?.visible) return null
    const m = /^ring_(\d)$/.exec(this.ring.frame.name)
    return m ? Number(m[1]) : null
  }

  /**
   * `hub:departure`: start a trip at `nowMs` unless one is under way (the
   * batch rule). True when a trip started.
   */
  depart(nowMs: number, reduced = false): boolean {
    if (!canDepart(this.startMs, nowMs, this.reduced)) return false
    this.startMs = nowMs
    this.reduced = reduced
    this.placeVessel(nowMs)
    return true
  }

  /** Every frame: the vessel along its trip, the ring from the sim tick. */
  update(nowMs: number, tickNow: number): void {
    this.placeVessel(nowMs)
    this.updateRing(tickNow)
  }

  /** Create / wake / sim swap: no trip in flight (the vessel home); the ring re-reads the sim. */
  syncAll(): void {
    this.startMs = null
    this.state = { phase: 'home', t: 0 }
    this.restoreVessel()
    this.updateRing(this.vs.tick)
  }

  destroy(): void {
    this.restoreVessel()
    this.ring?.destroy()
    this.count?.destroy()
    this.ring = null
    this.count = null
  }

  private placeVessel(nowMs: number): void {
    const st = vesselPhase(this.startMs, nowMs, this.reduced)
    this.state = st
    if (st.phase === 'home') {
      if (this.startMs !== null) {
        this.startMs = null
        this.restoreVessel()
      }
      return
    }
    const v = this.refs.vessel
    const img = v?.img
    if (!v || !img?.scene) return
    const alpha = vesselAlpha(this.hub, st.phase, st.t)
    if (alpha <= 0) {
      img.setVisible(false)
      return
    }
    const o = vesselScreenOffset(
      vesselOffset(this.hub, st.phase, st.t),
      this.off,
    )
    img
      .setVisible(true)
      .setAlpha(alpha)
      .setPosition(v.x + o.dx, v.y + o.dy)
  }

  private restoreVessel(): void {
    const v = this.refs.vessel
    const img = v?.img
    if (!v || !img?.scene) return
    img.setVisible(true).setAlpha(1).setPosition(v.x, v.y)
  }

  private updateRing(tickNow: number): void {
    const model = this.vs.hub(this.id)
    const office = this.refs.office
    const list = model && model.live && office && !office.locked
    const first = list ? (model.clearing[0] ?? null) : null
    const f = ringFrame(first, tickNow)
    const name = f === null ? null : frameOrNull(`ring_${f}`)
    if (!name || !office || !model) {
      this.ring?.setVisible(false)
      this.count?.setVisible(false)
      return
    }
    const x = Math.round(office.anchor.x)
    const y = Math.round(office.topY - RING_LIFT)
    if (!this.ring) {
      this.ring = this.scene.add
        .image(x, y, WORLD_ATLAS, name)
        .setOrigin(0.5, 1)
        .setDepth(this.refs.depth)
      this.layer.add(this.ring)
    } else if (this.ring.frame.name !== name)
      this.ring.setFrame(name, false, false)
    this.ring.setPosition(x, y).setVisible(true)
    const text = clearingCountText(model.clearing.length)
    if (!text) {
      this.count?.setVisible(false)
      return
    }
    if (!this.count) {
      if (!this.scene.cache.bitmapFont.has(FONT_KEY)) return
      this.count = this.scene.add
        .bitmapText(0, 0, FONT_KEY, text, FONT_SIZE)
        .setTint(THEME.textLight)
        .setDropShadow(1, 1, THEME.shadow, 1)
        .setDepth(this.refs.depth + 0.001)
      this.layer.add(this.count)
    }
    if (this.count.text !== text) this.count.setText(text)
    const mid = y - RING_H / 2
    this.count
      .setPosition(x + COUNT_DX, Math.round(mid - CAP_TOP - CAP_H / 2))
      .setVisible(true)
  }
}
