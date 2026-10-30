// Pure rules and timelines of the city's M3 flourishes (plan.md §7, §12.6
// tasks 5 + 9; city-view.md §1.3-§1.4, §2, §9.6; spec-core.md §3.5, §9.2,
// Q33) and of the build-2 lot (spec-build2.md §6.1: the warehouse slab, ramp
// and bollards stamped by the ground bake; the exterior anchors read from the
// manifest-derived frames.generated.ts) and of the M7 magic parcel
// (spec-build2 §3.3, design-m7 §6.8: the gold `ic_magic` markers over A and
// B, their countdown ring, the gold hop icon) and of the M8 docks 2–3
// (design-m8-m9 §6.2: bay lights and docked poses by dock NUMBER, the dock
// run mapping the hidden dock column onto the SW face's bays; the overseas
// hubs' ring and vessel live in cityHub.ts). No Phaser, no DOM: CityScene /
// BuildingView / VehicleView / DistrictLabel / ground.ts drive their sprites
// from these and Vitest pins them under Node (tests/render/cityFx.test.ts,
// tests/render/ground-slab.test.ts). Every time is ms on the scene clock
// (frozen-clock friendly: __pm.freeze steps it).
import { isRoadTile, mapBlockAt, type MapData, type XY } from '../data/index.ts'
import type { BuildingId, Parcel } from '../sim/types.ts'
import type { QuestView } from '../sim/view-api.ts'
import { WH_ANCHORS, type WarehouseAnchorSet } from './frames.generated.ts'

// ---------------------------------------------------------------- region unlock (§1.4)

/** Colour frames fade in while the `_locked` ones fade out; ground crossfade too. */
export const UNLOCK_FADE_MS = 1000
/** After the fade the lock sign plays sign_pop_0..2 then is removed. */
export const SIGN_POP_FRAMES = 3
export const SIGN_POP_MS = 300

/** 0 → 1 progress of a fade `elapsed` ms into `ms`. */
export function fadeK(elapsed: number, ms: number): number {
  if (!(ms > 0)) return 1
  return Math.max(0, Math.min(1, elapsed / ms))
}

/** sign_pop frame `msSincePop` into the pop (0..2), null once it is over. */
export function signPopFrame(msSincePop: number): number | null {
  if (msSincePop < 0) return 0
  if (msSincePop >= SIGN_POP_MS) return null
  return Math.min(
    SIGN_POP_FRAMES - 1,
    Math.floor((msSincePop / SIGN_POP_MS) * SIGN_POP_FRAMES),
  )
}

// ---------------------------------------------------------------- level-up moment (§9.6)

/**
 * fx_dust: 4 frames × 250 ms = scaffold, dust, dust, reveal. Each frame is
 * ONE 256×224 cloud over the whole exterior (report §6.23), placed like
 * wh_ext: origin (0.5, 1) on the lot's footprint anchor.
 */
export const DUST_FRAMES = 4
export const DUST_FRAME_MS = 250
export const CONSTRUCTION_MS = DUST_FRAMES * DUST_FRAME_MS
/** The exterior swaps to the new tier as the reveal frame starts. */
export const CONSTRUCTION_SWAP_MS = (DUST_FRAMES - 1) * DUST_FRAME_MS

/** fx_dust frame index `elapsed` ms into the construction, null when done. */
export function dustFrame(elapsed: number): number | null {
  if (elapsed < 0) return 0
  if (elapsed >= CONSTRUCTION_MS) return null
  return Math.floor(elapsed / DUST_FRAME_MS)
}

/** The "LEVEL 2 — LOCAL" stamp: 32 px gold, rises 24 px over 1.2 s, then holds and fades. */
export const STAMP_RISE_PX = 24
export const STAMP_RISE_MS = 1200
export const STAMP_HOLD_MS = 800
export const STAMP_FADE_MS = 400
export const STAMP_MS = STAMP_RISE_MS + STAMP_HOLD_MS + STAMP_FADE_MS

export function levelStampText(level: number, title: string): string {
  return `LEVEL ${level} — ${title.toUpperCase()}`
}

/** Stamp offset above the roof (dy ≤ 0) and alpha, or null once gone. */
export function stampPose(
  elapsed: number,
): { dy: number; alpha: number } | null {
  if (elapsed >= STAMP_MS) return null
  const t = Math.max(0, elapsed)
  const rise = Math.min(1, t / STAMP_RISE_MS)
  // Ease out: fast off the roof, settling at the top.
  const eased = 1 - (1 - rise) * (1 - rise)
  const fadeStart = STAMP_RISE_MS + STAMP_HOLD_MS
  const alpha = t <= fadeStart ? 1 : 1 - (t - fadeStart) / STAMP_FADE_MS
  return {
    dy: 0 - Math.round(STAMP_RISE_PX * eased),
    alpha: Math.max(0, Math.min(1, alpha)),
  }
}

/** Small deterministic integer hash (no Math.random: same slab every run). */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

// ---------------------------------------------------------------- moods (spec §9.2)

export type MoodKind = 'happy' | 'unhappy' | null

/** One overlay per building from the district value: flower boxes ≥ happyAbove, shutters < loudBelow. */
export function moodFor(
  value: number,
  s: { loudBelow: number; happyAbove: number },
): MoodKind {
  if (value < s.loudBelow) return 'unhappy'
  if (value >= s.happyAbove) return 'happy'
  return null
}

/** The angry label grumbles now, then every 20 s while it is on screen (spec §9.2). */
export const GRUMBLE_EVERY_MS = 20_000

export function grumbleDue(
  lastMs: number | null,
  nowMs: number,
  everyMs = GRUMBLE_EVERY_MS,
): boolean {
  return lastMs === null || nowMs - lastMs >= everyMs
}

// ---------------------------------------------------------------- days-since-incident sign (Q33)

/**
 * The board is cracked from a lost life until the counter reaches 1 again
 * (one in-game day); before any loss it is whole even at 0.
 */
export function signCracked(
  daysSinceIncident: number,
  lostLife: boolean,
): boolean {
  return lostLife && daysSinceIncident === 0
}

export function signDaysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------- vehicles (§2)

/** ic_honk over a queued vehicle: 500 ms every 4 s, per-vehicle phase id mod 4 (seconds). */
export const HONK_EVERY_MS = 4000
export const HONK_SHOW_MS = 500

export function honkShown(nowMs: number, vehicleId: number): boolean {
  const phase = (((vehicleId % 4) + 4) % 4) * 1000
  return (nowMs + phase) % HONK_EVERY_MS < HONK_SHOW_MS
}

// ---------------------------------------------------------------- rush / magic rings (city-view §6.1; B2 §3.3)

/** Frames of the draining badge rings (rush_ring_0..3, magic_ring_0..3). */
export const RING_STEPS = 4

/**
 * Ring frame of a draining countdown: 0 while ≥ 75 % remains, then 1, 2 and
 * 3 at 75 / 50 / 25 % (city-view §6.1, the rush ring). `remaining01` = 1 → 0;
 * out-of-range (and NaN) values clamp.
 */
export function ringStep(remaining01: number): 0 | 1 | 2 | 3 {
  const r = Number.isFinite(remaining01)
    ? Math.max(0, Math.min(1, remaining01))
    : 0
  return Math.min(
    RING_STEPS - 1,
    Math.max(0, Math.floor((1 - r) * RING_STEPS)),
  ) as 0 | 1 | 2 | 3
}

/** The magic parcel's countdown ring (design-m7 §6.8): the rush ring's steps. */
export function magicRingStep(remaining01: number): 0 | 1 | 2 | 3 {
  return ringStep(remaining01)
}

/** Where the city hangs the magic markers: A and B with the ring's 1 → 0 fill. */
export interface MagicMarkers {
  origin: BuildingId
  dest: BuildingId
  remaining01: number
}

/**
 * B2 §3.3 / design-m7 §6.8: the gold `ic_magic` over A and B while the
 * golden parcel is alive. While the active magic quest's countdown runs (a
 * `magicParcel` quest with a route, undelivered, ticks left) the ring drains
 * with it; once the countdown is over — the quest late, failed or abandoned
 * — the parcel `live` (QuestsView.magic) still on its way keeps both markers
 * with an empty ring (remaining 0). Null when no golden parcel is alive.
 */
export function magicMarkers(
  q: Pick<QuestView, 'progress' | 'route' | 'ticksLeft' | 'limitTicks'> | null,
  live: { origin: BuildingId; dest: BuildingId } | null = null,
): MagicMarkers | null {
  const pr = q?.progress
  if (
    q &&
    q.route !== null &&
    pr?.kind === 'magicParcel' &&
    pr.deliveredTick === null &&
    (q.ticksLeft ?? 0) > 0
  ) {
    const total = Math.max(1, q.limitTicks)
    return {
      origin: q.route.origin,
      dest: q.route.dest,
      remaining01: Math.max(0, Math.min(1, (q.ticksLeft ?? 0) / total)),
    }
  }
  if (!live) return null
  return { origin: live.origin, dest: live.dest, remaining01: 0 }
}

/** The pickup / delivery hop icon (design-m7 §6.8): gold for the magic parcel. */
export function hopIcon(p: Pick<Parcel, 'size' | 'magic'>): string {
  return p.magic ? 'ic_magic' : `ic_parcel_${p.size.toLowerCase()}`
}

// ---------------------------------------------------------------- warehouse exterior (art install hand-off)

/** wh_ext_t* canvas (256×256, origin (0.5, 1) at the lot's footprint anchor). */
export const WH_CANVAS = 256

/** A canvas pixel, from the frame's top-left. */
export type CanvasPt = readonly [number, number]

/**
 * Where the city hangs things on a warehouse exterior frame (canvas px from
 * the top-left; the sprite's origin is (0.5, 1) on the footprint anchor):
 * `bayLights` = the pointer tip on the amber lamp above each bay door of the
 * visible SW face (bays 1-3); `dockPose` = foot point of a vehicle docked at
 * bay 1, in front of the open door, nose in (`<type>_ne_<phase>`). The map's
 * dock tile (20, 22) lies on the hidden NW side of the sprite, so the view
 * draws the docked vehicle here.
 */
export type WarehouseAnchors = WarehouseAnchorSet

/** The tier-1 exterior frame: the default (and fallback) anchor set. */
export const WH_ANCHOR_FRAME = 'wh_ext_t1'

/**
 * Playtest-1 measurements of the apron-era wh_ext_t1 (the art-install
 * hand-off). Used only when frames.generated.ts carries no WH_ANCHORS row
 * for the frame or tier 1 (the manifest's wh_ext `bayLights` / `dockPose`,
 * measured on the regenerated exterior of B2 §6.1).
 */
export const LEGACY_WH_ANCHORS: WarehouseAnchors = {
  bayLights: [
    [47, 139],
    [71, 151],
    [96, 163],
  ],
  dockPose: [40, 178],
}

/** WH_ANCHORS' shape: exterior frame name → its anchor set. */
export type WarehouseAnchorTable = Readonly<
  Partial<Record<string, WarehouseAnchors>>
>

/**
 * Anchors of exterior `frame` (`wh_ext_t1`, `wh_ext_t2`, …) from `table`
 * (frames.generated.ts WH_ANCHORS, written by `vlr art:atlas` from
 * art/manifest.json): the frame's own set, else tier 1's (every tier is an
 * edit on the same footprint); null when the table has neither.
 */
export function manifestWarehouseAnchors(
  frame: string = WH_ANCHOR_FRAME,
  table: WarehouseAnchorTable = WH_ANCHORS,
): WarehouseAnchors | null {
  return table[frame] ?? table[WH_ANCHOR_FRAME] ?? null
}

/** Anchors of exterior `frame`: the manifest's, else the legacy playtest-1 set. */
export function warehouseAnchors(
  frame: string = WH_ANCHOR_FRAME,
  table: WarehouseAnchorTable = WH_ANCHORS,
): WarehouseAnchors {
  return manifestWarehouseAnchors(frame, table) ?? LEGACY_WH_ANCHORS
}

/** Tier-1 bay lights (CityScene creates one light each, then places them per exterior frame). */
export const BAY_LIGHTS: readonly CanvasPt[] = warehouseAnchors().bayLights
/** Tier-1 docked-vehicle foot point (CityScene reads the current frame's on every tier swap). */
export const DOCK_POSE_CANVAS: CanvasPt = warehouseAnchors().dockPose
/** The dock pose draws over the warehouse wall: footprint depth + this. */
export const DOCK_POSE_DEPTH = 0.2
/**
 * M8: each bay further along the SW face draws this much higher (bay 2's
 * vehicle stands in front of bay 1's); above a vehicle's own dot / glyph
 * biases (DEPTH.mood 0.01, DEPTH.bell 0.02).
 */
export const DOCK_BAY_DEPTH = 0.05
/** Blend radius (tiles) around the dock tile: the approach from the queue head. */
export const DOCK_BLEND_TILES = 3

/**
 * M8 (design-m8-m9 §6.2): the docked foot point of bay `n` (1-based) on an
 * exterior frame's anchors — the manifest's `dockPoses[n − 1]`; else bay 1's
 * pose moved by that bay's lamp offset (`bayLights[n − 1] − bayLights[0]`,
 * the manifest's own rule); else, for a frame with fewer bays than docks
 * (t3 draws two: a debug dock 3), the last known bay stepped on by the last
 * bay-to-bay step (bay 1's pose when only one is known).
 */
export function dockPoseCanvas(a: WarehouseAnchors, n: number): CanvasPt {
  const k = Math.max(1, Math.floor(n)) - 1
  /** Bay i's pose from the manifest or its lamp; bay 1 always has one. */
  const known = (i: number): CanvasPt | null => {
    const p = a.dockPoses?.[i]
    if (p) return p
    const lamp = a.bayLights[i]
    const l0 = a.bayLights[0]
    if (lamp && l0)
      return [a.dockPose[0] + lamp[0] - l0[0], a.dockPose[1] + lamp[1] - l0[1]]
    return i === 0 ? a.dockPose : null
  }
  const direct = known(k)
  if (direct) return direct
  let last = 0
  while (last + 1 < k && known(last + 1)) last++
  const pl = known(last) ?? a.dockPose
  const pp = last > 0 ? known(last - 1) : null
  const sx = pp ? pl[0] - pp[0] : 0
  const sy = pp ? pl[1] - pp[1] : 0
  return [pl[0] + sx * (k - last), pl[1] + sy * (k - last)]
}

/** Docked foot points of bays 1..count on a frame (dockPoseCanvas each). */
export function dockPosesCanvas(a: WarehouseAnchors, count = 3): CanvasPt[] {
  return Array.from({ length: count }, (_, i) => dockPoseCanvas(a, i + 1))
}

/** Tier-1 docked foot points of bays 1–3 (the manifest's; [0] = DOCK_POSE_CANVAS). */
export const DOCK_POSES_CANVAS: readonly CanvasPt[] =
  dockPosesCanvas(warehouseAnchors())

/**
 * 0..1 weight of the dock pose for a vehicle at tile (tx, ty): 1 on the dock
 * tile, falling linearly to 0 at DOCK_BLEND_TILES; only inside the lot (full
 * from tx = lotX0 − 0.5, zero on the avenue tile lotX0 − 1) and south of the
 * parking row (full from ty = dockY, zero at dockY − 0.5), so through-traffic
 * on the avenue and the parking row behind the sprite are never moved.
 * Continuous, so a vehicle driving in or out never jumps. (One dock: the
 * dock run of dockRunBlend with the default radius.)
 */
export function dockBlend(
  tx: number,
  ty: number,
  dock: readonly [number, number],
  lotX0: number,
): number {
  return dockRunBlend(tx, ty, [dock], lotX0).w
}

/** dockRunBlend's result: the pose weight and the fractional bay index (0 = bay 1). */
export interface DockRunHit {
  w: number
  at: number
}

/**
 * M8 (docks 2–3, design-m8-m9 §6.2): the dock tiles of bays 1..n (n = the
 * highest dock number owned; map.json lot.docks, a straight run on the
 * sprite's hidden NW side) map onto the bays of the visible SW face. A
 * vehicle at (tx, ty) is drawn toward the pose interpolated at `at` — the
 * fractional bay index of its nearest point on the run — with the weight of
 * dockBlend measured from that point (1 on the run, 0 at `radius` tiles,
 * the same lot / parking-row masks, the column rule from bay 1's tile).
 * A function of the position only (no per-vehicle state): a vehicle driving
 * along the run slides from bay to bay, and taking or leaving a bay never
 * jumps. With one dock this is exactly dockBlend.
 */
export function dockRunBlend(
  tx: number,
  ty: number,
  run: readonly (readonly [number, number])[],
  lotX0: number,
  radius = DOCK_BLEND_TILES,
  out: DockRunHit = { w: 0, at: 0 },
): DockRunHit {
  out.w = 0
  out.at = 0
  const first = run[0]
  if (!first || !(radius > 0)) return out
  let best = Math.hypot(tx - first[0], ty - first[1])
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i] as readonly [number, number]
    const b = run[i + 1] as readonly [number, number]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const len2 = ex * ex + ey * ey
    const u =
      len2 > 0
        ? Math.max(0, Math.min(1, ((tx - a[0]) * ex + (ty - a[1]) * ey) / len2))
        : 0
    const d = Math.hypot(tx - a[0] - ex * u, ty - a[1] - ey * u)
    if (d < best - 1e-9) {
      best = d
      out.at = i + u
    }
  }
  const near = 1 - best / radius
  if (near <= 0) {
    out.at = 0
    return out
  }
  const inLot = Math.max(0, Math.min(1, (tx - (lotX0 - 1)) * 2))
  const inColumn = Math.max(0, Math.min(1, (ty - first[1] + 0.5) * 2))
  out.w = Math.min(1, near) * inLot * inColumn
  return out
}

/**
 * The run's blend radius: DOCK_BLEND_TILES, capped at the queue head's
 * distance from the run's last bay so the vehicle waiting there is never
 * moved (one dock: exactly 3; docks 1–2: 2; docks 1–3: 1).
 */
export function dockRunRadius(
  run: readonly (readonly [number, number])[],
  queueHead: readonly [number, number] | undefined,
): number {
  const last = run.at(-1)
  if (!last || !queueHead) return DOCK_BLEND_TILES
  const d = Math.hypot(queueHead[0] - last[0], queueHead[1] - last[1])
  return Math.min(DOCK_BLEND_TILES, d > 0 ? d : DOCK_BLEND_TILES)
}

/** World offset of bay `at` (fractional, 0 = bay 1): linear between the bays' offsets, clamped. */
export function dockPoseAt(
  poses: readonly { readonly dx: number; readonly dy: number }[],
  at: number,
  out: { dx: number; dy: number } = { dx: 0, dy: 0 },
): { dx: number; dy: number } {
  out.dx = 0
  out.dy = 0
  const n = poses.length
  if (n === 0) return out
  const a = Math.max(0, Math.min(n - 1, Number.isFinite(at) ? at : 0))
  const i = Math.min(n - 1, Math.floor(a))
  const j = Math.min(n - 1, i + 1)
  const u = a - i
  const p = poses[i] as { dx: number; dy: number }
  const q = poses[j] as { dx: number; dy: number }
  out.dx = p.dx + (q.dx - p.dx) * u
  out.dy = p.dy + (q.dy - p.dy) * u
  return out
}

/**
 * Which bay lights are lit (design-m8-m9 §6.2, by dock NUMBER): light k
 * (0-based) shows when dock k + 1 is owned and the exterior frame has that
 * lamp (t3 draws two bays: its third light stays hidden). Dock 3 bought
 * before dock 2 lights lamps 1 and 3.
 */
export function bayLightShown(
  k: number,
  ownedDockIds: readonly string[],
  lampCount: number,
): boolean {
  if (k < 0 || k >= lampCount) return false
  return ownedDockIds.includes(`dock${k + 1}`)
}

/** The highest dock number owned (1 with dock 1 only; dock ids `dock<N>`). */
export function maxDockNumber(ownedDockIds: readonly string[]): number {
  let n = 1
  for (const id of ownedDockIds) {
    const m = /^dock([1-9]\d*)$/.exec(id)
    if (m) n = Math.max(n, Number(m[1]))
  }
  return n
}

// ---------------------------------------------------------------- lot slab (B2 §6.1)

/**
 * The warehouse foundation is ground, not sprite (spec-build2.md §6.1, the
 * author's city #1): the exteriors carry no apron, and the ground bake
 * stamps a concrete slab tile on every tile of the lot's warehouse
 * footprint, the ramp tile on the dock tiles, and a few bollards beside the
 * slab's visible corners — on the grid by construction, in every tier.
 */
export const SLAB_FRAMES = ['lot_slab_a', 'lot_slab_b', 'lot_slab_c'] as const
export const RAMP_FRAME = 'lot_ramp'
export const BOLLARD_FRAMES = ['bollard_a', 'bollard_b'] as const

export type LotStampKind = 'slab' | 'ramp' | 'bollard'

/**
 * One ground-bake stamp. `slab` / `ramp` replace the tile's base ground
 * frame (full 64×32 diamonds); a `bollard` is a prop stamped after every
 * tile, its frame's bottom-centre on the tile's bottom vertex (the map
 * props' anchor), so the post stands on the tile centre.
 */
export interface LotStamp {
  kind: LotStampKind
  frame: string
  tx: number
  ty: number
}

/**
 * Variant pick per tile: a fixed integer hash (no Math.random, same lot every
 * run); its low byte is skipped, which mixes small n better on this lot.
 */
export function lotVariant(tx: number, ty: number, n: number): number {
  return n > 0 ? (hash2(tx, ty) >>> 8) % n : 0
}

/** Tiles of the lot's warehouse footprint, row-major. */
export function slabTiles(map: Pick<MapData, 'lot'>): XY[] {
  const { tile, footprint } = map.lot.warehouse
  const out: XY[] = []
  for (let y = tile[1]; y < tile[1] + footprint[1]; y++)
    for (let x = tile[0]; x < tile[0] + footprint[0]; x++) out.push([x, y])
  return out
}

/**
 * Candidate bollard tiles, before filtering: just off the slab's three
 * visible corners (S, W, E — the N corner is behind the building) and at
 * both ends of the dock run (the ramp's sides).
 */
function bollardCandidates(map: Pick<MapData, 'lot'>): XY[] {
  const { tile, footprint } = map.lot.warehouse
  const x0 = tile[0]
  const y0 = tile[1]
  const x1 = x0 + footprint[0] - 1
  const y1 = y0 + footprint[1] - 1
  const out: XY[] = [
    [x1 + 1, y1 + 1],
    [x0, y1 + 1],
    [x1 + 1, y0],
  ]
  const docks = map.lot.docks
  if (docks.length > 0) {
    const xs = docks.map((d) => d[0])
    const ys = docks.map((d) => d[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    if (minX === maxX) out.push([minX, minY - 1], [minX, maxY + 1])
    else if (minY === maxY) out.push([minX - 1, minY], [maxX + 1, minY])
  }
  return out
}

/**
 * Where a bollard may stand: a lot tile off the slab that no vehicle uses
 * (not a road, entrance, dock, queue or parking tile, nor the sign's tile)
 * and in front of the building (tx ≥ x0 and ty ≥ y0 — behind the NW / NE
 * walls the exterior sprite would hide a ground stamp).
 */
export function bollardTileOk(map: MapData, x: number, y: number): boolean {
  const lot = map.lot
  const { tile, footprint } = lot.warehouse
  const at = (p: readonly number[]): boolean => p[0] === x && p[1] === y
  if (x < 0 || y < 0 || x >= map.size[0] || y >= map.size[1]) return false
  if (isRoadTile(map, x, y)) return false
  if (mapBlockAt(map, x, y)?.kind !== 'lot') return false
  if (at(lot.entrance) || at(lot.sign)) return false
  if (lot.docks.some(at) || lot.queue.some(at) || lot.parking.some(at))
    return false
  const inSlab =
    x >= tile[0] &&
    x < tile[0] + footprint[0] &&
    y >= tile[1] &&
    y < tile[1] + footprint[1]
  if (inSlab) return false
  return x >= tile[0] && y >= tile[1]
}

/**
 * Every lot stamp of the ground bake, in stamp order: the slab tiles
 * (variant a/b/c by tile hash) over the whole footprint, the ramp on each
 * dock tile, then the bollards (a/b by tile hash) on the candidate tiles
 * that pass bollardTileOk, de-duplicated.
 */
export function slabStamps(map: MapData): LotStamp[] {
  const out: LotStamp[] = []
  for (const [tx, ty] of slabTiles(map)) {
    const frame = SLAB_FRAMES[lotVariant(tx, ty, SLAB_FRAMES.length)]
    if (frame) out.push({ kind: 'slab', frame, tx, ty })
  }
  for (const [tx, ty] of map.lot.docks)
    out.push({ kind: 'ramp', frame: RAMP_FRAME, tx, ty })
  const seen = new Set<string>()
  for (const [tx, ty] of bollardCandidates(map)) {
    const k = `${tx},${ty}`
    if (seen.has(k) || !bollardTileOk(map, tx, ty)) continue
    seen.add(k)
    const frame = BOLLARD_FRAMES[lotVariant(tx, ty, BOLLARD_FRAMES.length)]
    if (frame) out.push({ kind: 'bollard', frame, tx, ty })
  }
  return out
}

// ---------------------------------------------------------------- smoke (§1.3)

/** fx_smoke_f0..3 at 4 fps: a puff lives 4 frames = 1 s, rising and drifting. */
export const SMOKE_FPS = 4
export const SMOKE_FRAMES = 4
export const SMOKE_PERIOD_MS = (SMOKE_FRAMES * 1000) / SMOKE_FPS
export const SMOKE_PUFFS = 3
export const SMOKE_RISE_PX = 21
export const SMOKE_DRIFT_PX = 3
/** Per-emitter phase step (ms): not a multiple of a frame, so chimneys never puff in sync. */
export const SMOKE_PHASE_MS = 170

/** Puff `k` of an emitter with phase `phaseMs`: frame (stepped at 4 fps) and offset from the anchor. */
export function smokePuff(
  nowMs: number,
  phaseMs: number,
  k: number,
): { frame: number; dx: number; dy: number } {
  const age =
    (((nowMs + phaseMs + (k * SMOKE_PERIOD_MS) / SMOKE_PUFFS) %
      SMOKE_PERIOD_MS) +
      SMOKE_PERIOD_MS) %
    SMOKE_PERIOD_MS
  const t = age / SMOKE_PERIOD_MS
  return {
    frame: Math.min(SMOKE_FRAMES - 1, Math.floor(t * SMOKE_FRAMES)),
    dx: Math.round(SMOKE_DRIFT_PX * t),
    dy: 0 - Math.round(SMOKE_RISE_PX * t),
  }
}
