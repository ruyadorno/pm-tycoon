// art/manifest.json — every sprite of playtest 1 (style-guide.md §2).
//
// File shape: { version: 1, entries: ManifestEntry[], batches: Batch[] }.
// Frame name (atlas key) = id + frame suffix [+ variant suffix]:
//   frames ['_ne_0', …] are drawn by a drawer (`vlr art:draw`) or come from
//   PixelLab; variants ['locked'] are derived by the variants pass and named
//   id + frame + '_locked' (e.g. in_glob_silos_locked, grass_b_locked).
// Finals live at art/final/<class>/<frame name>.png (finalPath()).
// canvas: the class canvas of §1.6; classes in FLEX_CANVAS_CLASSES take the
// row's own canvas (interior-prop, ui strips, fx 16/32, prop boards, font).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ASSET_CLASSES = [
  'tile',
  'building1x1',
  'building2x2',
  'building3x3',
  'warehouse-ext',
  'prop',
  'dock-prop',
  'vehicle-bike',
  'vehicle-van',
  'vehicle-truck',
  'interior-tile',
  'fixture',
  'fixture-rack',
  'fixture-shelf',
  'fixture-door',
  'fixture-desk',
  'dock-tail',
  'sign',
  'interior-prop',
  'machine',
  'worker',
  'parcel',
  'fx',
  'icon16',
  'ui',
  'font',
  'logo',
] as const

export type AssetClass = (typeof ASSET_CLASSES)[number]
export type Variant = 'locked' | 't2' | 'mood'
export type Priority = 'P0' | 'P1' | 'P2'
/** 'author': brand art supplied by the author (the logo), never redrawn */
export type Source = 'procedural' | 'pixellab' | 'author'

export const VARIANT_SUFFIX: Readonly<Record<Variant, string>> = {
  locked: '_locked',
  t2: '_t2',
  mood: '_mood',
}

/** §1.6 class canvases ([w, h] px). null = canvas given per manifest row. */
export const CLASS_CANVAS: Readonly<
  Record<AssetClass, readonly [number, number] | null>
> = {
  tile: [64, 32],
  building1x1: [64, 96],
  building2x2: [128, 160],
  building3x3: [192, 224],
  'warehouse-ext': [256, 256],
  prop: [64, 128],
  'dock-prop': [128, 96],
  // build 2 (Q-B2-14): 24 -> 32 so the courier and helmet keep the margin
  'vehicle-bike': [32, 32],
  'vehicle-van': [32, 32],
  'vehicle-truck': [48, 32],
  'interior-tile': [32, 32],
  fixture: [64, 64],
  'fixture-rack': [64, 256],
  'fixture-shelf': [224, 64],
  'fixture-door': [32, 56],
  'fixture-desk': [48, 32],
  'dock-tail': [40, 40],
  sign: [200, 24],
  'interior-prop': null,
  machine: [48, 48],
  worker: [24, 32],
  parcel: [32, 32],
  fx: null,
  icon16: [16, 16],
  ui: null,
  font: null,
  // the author's logo (B2 §5): brand art outside the palette contract,
  // written to src/assets/logo.png by tools/art/logo.ts, never in an atlas
  logo: [352, 176],
}

/** Classes whose rows may override the class canvas (prop boards 64x40 / 96x52). */
export const FLEX_CANVAS_CLASSES: readonly AssetClass[] = [
  'prop',
  'interior-prop',
  'fx',
  'ui',
  'font',
]

/** City classes: footprint diamond + anchor rules (A04/A05). */
export const CITY_CLASSES: readonly AssetClass[] = [
  'tile',
  'building1x1',
  'building2x2',
  'building3x3',
  'warehouse-ext',
]

/** Height budget above the footprint diamond (§1.5). */
export const HEIGHT_BUDGET: Readonly<Partial<Record<AssetClass, number>>> = {
  building1x1: 64,
  building2x2: 96,
  building3x3: 128,
}

export interface GenLog {
  tool: string
  endpoint: string
  params: Record<string, unknown>
  jobId: string
  seed?: number
  candidate: number
  cost: number
  downloadUrl: string
  sha256: string
  at: string
}

export interface RejectLog {
  candidate: number
  reason: string
  by: 'claude' | 'author'
  at: string
}

export interface ManifestEntry {
  /** frame name stem, snake_case, unique */
  id: string
  class: AssetClass
  source: Source
  canvas: [number, number]
  /** city classes: tiles covered, [w, h] */
  footprint?: [number, number]
  /** suffixes, e.g. ['_ne_0', …] or ['_f0', …] or [''] */
  frames: string[]
  variants: Variant[]
  /** spec §3.3 district id, 'warehouse', 'map', 'ui' */
  district?: string
  /** locked scenery: buildings.json ids drawn with this sprite */
  coversBuildings?: string[]
  priority: Priority
  /** prompt {subject} */
  subject?: string
  /** part of the anchor sheet (G2) */
  anchorRole?: 'anchor'
  /** industrial chimneys: pixel offsets from the canvas top-left */
  smokeAnchors?: [number, number][]
  /** vehicles: the body ramp, for mirror + reshade (§3.7) */
  bodyRamp?: string
  /** true = procedural stand-in for a pixellab source */
  placeholder: boolean
  approved: boolean
  approvedBy?: 'agent' | 'author'
  chosenCandidate?: number
  gen: GenLog[]
  rejects: RejectLog[]
  /** sha256 over the frame PNGs in frame order (frameSetSha256) */
  finalSha256?: string
  /** free-form note (reconciled names, defaults) */
  note?: string
  /**
   * build 2 (plan-build2 §8.2 task 8): the atlas this entry is packed into
   * ('both' = the two). Optional: the packer (atlas.ts placementOf) falls
   * back to a class default; class 'logo' is never packed (isAtlasPacked).
   */
  atlas?: AtlasName
  /**
   * vehicles: the foot point on the road centre line, canvas px [x, y]
   * (VEHICLE_FOOT in frames.generated.ts = the display origin); vehicleFoot()
   * falls back to the class default
   */
  foot?: [number, number]
  /**
   * warehouse-ext: the amber lamp over each loading-bay door of the visible
   * SW face (bays 1-3), canvas px [x, y] with origin (0.5, 1) at the lot's
   * footprint anchor (cityFx BAY_LIGHTS)
   */
  bayLights?: [number, number][]
  /**
   * warehouse-ext: foot point of a vehicle docked at bay 1, canvas px
   * (cityFx DOCK_POSE_CANVAS)
   */
  dockPose?: [number, number]
  /**
   * warehouse-ext (build 2 M8, docks 2-3): foot point of a vehicle docked at
   * each bay, one per bayLights point, [0] = dockPose. Optional: when absent
   * warehouseAnchorTable derives bay k's pose as dockPose + (bayLights[k] −
   * bayLights[0]) — the same offset from its lamp as bay 1's.
   */
  dockPoses?: [number, number][]
  /**
   * warehouse-ext: per-frame overrides of bayLights / dockPose (/ dockPoses),
   * keyed by frame suffix ('_t2'): an edited tier keeps the footprint but
   * its lamps can move a few px
   */
  frameAnchors?: Record<
    string,
    {
      bayLights: [number, number][]
      dockPose: [number, number]
      dockPoses?: [number, number][]
    }
  >
  /** follow-up edit recipe (wh_ext _t2): which edit k is the second frame */
  editPick?: number
}

/**
 * the two build-2 atlases (B2 §6.8); 'both' = packed into the two (art the
 * HUD/city and the room both draw — atlas.ts placementOf)
 */
export type AtlasName = 'world' | 'interior' | 'both'
export const ATLAS_NAMES: readonly AtlasName[] = ['world', 'interior', 'both']

/**
 * A rejected entry taken out of the game (B2 §6.4: dk_pier, dk_customs):
 * kept for provenance (its gen[] and rejects[], incl. the author's reason)
 * but never drawn, linted, packed or mapped to a building; its finals are
 * deleted when it is retired (decide.ts --retire).
 */
export interface RetiredEntry {
  id: string
  class: AssetClass
  source: Source
  retiredAt: string
  reason: string
  /** what replaced it (ids of the new entries) */
  replacedBy?: string[]
  gen: GenLog[]
  rejects: RejectLog[]
  note?: string
}

export interface Batch {
  at: string
  ids: string[]
  tool: string
  generations: number
  usd: number
  balanceBefore: number
  balanceAfter: number
}

export interface Manifest {
  version: 1
  entries: ManifestEntry[]
  batches: Batch[]
  /** rejected entries removed from the game (provenance only) */
  retired?: RetiredEntry[]
}

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const MANIFEST_PATH = join(ROOT, 'art/manifest.json')
export const FINAL_DIR = join(ROOT, 'art/final')
export const BUILDINGS_PATH = join(ROOT, 'src/data/buildings.json')

// ---------------------------------------------------------------------------
// Frame names and paths

/** Base frame names (drawn / generated): id + suffix. */
export function baseFrameNames(e: ManifestEntry): string[] {
  return e.frames.map((f) => e.id + f)
}

/** Derived frame names (variants pass): id + suffix + variant suffix. */
export function variantFrameNames(e: ManifestEntry): string[] {
  const out: string[] = []
  for (const v of e.variants) {
    for (const f of e.frames) out.push(e.id + f + VARIANT_SUFFIX[v])
  }
  return out
}

/** Every atlas frame of an entry (base + variants). */
export function frameNames(e: ManifestEntry): string[] {
  return [...baseFrameNames(e), ...variantFrameNames(e)]
}

/** art/final/<class>/<frame name>.png */
export function finalPath(e: ManifestEntry, frameName: string): string {
  return join(FINAL_DIR, e.class, `${frameName}.png`)
}

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** sha256 over the base frame PNGs in frame order; null if any is missing. */
export function frameSetSha256(e: ManifestEntry): string | null {
  const h = createHash('sha256')
  for (const name of baseFrameNames(e)) {
    const p = finalPath(e, name)
    if (!existsSync(p)) return null
    h.update(name)
    h.update(readFileSync(p))
  }
  return h.digest('hex')
}

/** true when a final exists that `draw` must not overwrite */
export function hasKeptFinal(e: ManifestEntry): boolean {
  return (
    e.approved ||
    e.source === 'author' ||
    (e.source === 'pixellab' && !e.placeholder)
  )
}

/** classes that never go into an atlas (the logo is its own texture) */
export const UNPACKED_CLASSES: readonly AssetClass[] = ['logo']

/** false for entries the atlas packer must skip (class 'logo') */
export function isAtlasPacked(e: ManifestEntry): boolean {
  return !UNPACKED_CLASSES.includes(e.class)
}

/** where a class's art lives when it is not under art/final (the logo) */
export const EXTERNAL_FINAL: Readonly<Partial<Record<AssetClass, string>>> = {
  logo: 'src/assets/logo.png',
}

/**
 * Vehicle foot point per class (the road-line point, canvas px), used when a
 * row carries no `foot`: bike 32x32 since build 2 (Q-B2-14) — its wheels sit
 * lower than the van's because the courier stands tall on a narrow frame.
 */
export const VEHICLE_FOOT_BY_CLASS: Readonly<
  Partial<Record<AssetClass, readonly [number, number]>>
> = {
  'vehicle-bike': [16, 26],
  'vehicle-van': [16, 23],
  'vehicle-truck': [24, 22],
}

/** the foot point of a vehicle entry (row `foot`, else the class default) */
export function vehicleFoot(e: ManifestEntry): [number, number] {
  if (e.foot) return [e.foot[0], e.foot[1]]
  const f = VEHICLE_FOOT_BY_CLASS[e.class]
  if (f) return [f[0], f[1]]
  return [e.canvas[0] / 2, Math.round(e.canvas[1] * 0.75)]
}

/** a warehouse exterior frame's city anchors, canvas px from the top-left */
export interface WarehouseAnchorSet {
  bayLights: [number, number][]
  dockPose: [number, number]
  /** one docked-vehicle pose per bay light ([0] = dockPose; build 2 M8) */
  dockPoses: [number, number][]
}

/**
 * Bay k's docked pose (build 2 M8, docks 2-3): the row's own dockPoses,
 * else dockPose shifted by bay k's lamp offset from bay 1's lamp (bays run
 * along the SW face, so the vehicle keeps bay 1's place relative to its
 * door).
 */
export function dockPosesOf(a: {
  bayLights: [number, number][]
  dockPose: [number, number]
  dockPoses?: [number, number][]
}): [number, number][] {
  if (a.dockPoses?.length) return a.dockPoses.map(([x, y]) => [x, y])
  const [l0x, l0y] = a.bayLights[0] ?? [0, 0]
  const [px, py] = a.dockPose
  return a.bayLights.map(([x, y]) => [px + x - l0x, py + y - l0y])
}

/**
 * WH_ANCHORS for frames.generated.ts (cityFx warehouseAnchors reads it), one
 * entry per exterior frame of every warehouse-ext row: { wh_ext_t1: the
 * row's bayLights / dockPose, wh_ext_t2: its frameAnchors._t2 override, else
 * the row's, wh_ext_t3: the wh_ext_t3 row's (build 2 M7: tiers 3-5 are rows
 * of their own, one frame each), … }; a row without anchors adds nothing.
 */
export function warehouseAnchorTable(
  m: Manifest,
): Record<string, WarehouseAnchorSet> {
  const out: Record<string, WarehouseAnchorSet> = {}
  for (const e of m.entries) {
    if (e.class !== 'warehouse-ext' || !e.bayLights || !e.dockPose) continue
    const row = {
      bayLights: e.bayLights,
      dockPose: e.dockPose,
      ...(e.dockPoses ? { dockPoses: e.dockPoses } : {}),
    }
    for (const f of e.frames) {
      const a = e.frameAnchors?.[f] ?? row
      out[e.id + f] = {
        bayLights: a.bayLights,
        dockPose: a.dockPose,
        dockPoses: dockPosesOf(a),
      }
    }
  }
  return out
}

/** the tier-1 exterior row (wh_ext: frames _t1, _t2) */
export const WH_EXT_ID = 'wh_ext'

/**
 * The tier-1 warehouse exterior's city anchors (cityFx BAY_LIGHTS /
 * DOCK_POSE_CANVAS), read from the wh_ext row; null when the row lacks them.
 */
export function warehouseAnchors(m: Manifest): {
  bayLights: [number, number][]
  dockPose: [number, number]
} | null {
  const e =
    m.entries.find((x) => x.id === WH_EXT_ID) ??
    m.entries.find((x) => x.class === 'warehouse-ext')
  if (!e?.bayLights || !e.dockPose) return null
  return { bayLights: e.bayLights, dockPose: e.dockPose }
}

// ---------------------------------------------------------------------------
// Load / validate / save

export function loadManifest(path: string = MANIFEST_PATH): Manifest {
  const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  m.batches ??= []
  return m
}

function isPair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => Number.isInteger(n) && n >= 0)
  )
}

/** buildings.json ids, or null when the data file does not exist yet */
export function loadBuildingIds(
  path: string = BUILDINGS_PATH,
): string[] | null {
  if (!existsSync(path)) return null
  const rows = JSON.parse(readFileSync(path, 'utf8')) as { id: string }[]
  return rows.map((r) => r.id)
}

/**
 * buildingId -> sprite id. A building-class entry without coversBuildings
 * whose id is a buildings.json id covers itself; locked scenery covers its
 * coversBuildings list.
 */
export function buildingCoverage(
  m: Manifest,
  buildingIds: readonly string[],
): { map: Map<string, string>; errors: string[] } {
  const ids = new Set(buildingIds)
  const map = new Map<string, string>()
  const errors: string[] = []
  const claim = (b: string, sprite: string) => {
    const prev = map.get(b)
    if (prev !== undefined) {
      errors.push(`A13: building ${b} covered by ${prev} and ${sprite}`)
    }
    map.set(b, sprite)
  }
  for (const e of m.entries) {
    if (e.coversBuildings) {
      for (const b of e.coversBuildings) {
        if (!ids.has(b)) {
          errors.push(`A13: ${e.id}.coversBuildings: unknown building ${b}`)
        }
        claim(b, e.id)
      }
    } else if (e.class.startsWith('building') && ids.has(e.id)) {
      claim(e.id, e.id)
    }
  }
  for (const b of buildingIds) {
    if (!map.has(b)) errors.push(`A13: building ${b} has no sprite`)
  }
  return { map, errors }
}

/** Schema check (A13 part 1); returns error strings, empty = valid. */
export function validateManifest(
  m: Manifest,
  buildingIds: readonly string[] | null = loadBuildingIds(),
): string[] {
  const errors: string[] = []
  if (m.version !== 1) errors.push('manifest: version must be 1')
  if (!Array.isArray(m.entries)) return [...errors, 'manifest: no entries[]']
  if (!Array.isArray(m.batches)) errors.push('manifest: no batches[]')
  const seenIds = new Set<string>()
  const seenFrames = new Map<string, string>()
  for (const e of m.entries) {
    const at = `manifest ${e.id ?? '?'}`
    if (typeof e.id !== 'string' || !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(e.id)) {
      errors.push(`${at}: id must be snake_case`)
    }
    if (seenIds.has(e.id)) errors.push(`${at}: duplicate id`)
    seenIds.add(e.id)
    if (!ASSET_CLASSES.includes(e.class)) {
      errors.push(`${at}: unknown class ${String(e.class)}`)
      continue
    }
    if (
      e.source !== 'procedural' &&
      e.source !== 'pixellab' &&
      e.source !== 'author'
    ) {
      errors.push(`${at}: bad source`)
    }
    if ((e.source === 'author') !== (e.class === 'logo')) {
      errors.push(`${at}: source 'author' is the logo class only`)
    }
    if (e.atlas !== undefined) {
      if (!ATLAS_NAMES.includes(e.atlas)) {
        errors.push(`${at}: atlas must be ${ATLAS_NAMES.join(' | ')}`)
      }
      if (!isAtlasPacked(e)) errors.push(`${at}: class ${e.class} is unpacked`)
    }
    if (e.foot !== undefined) {
      if (!e.class.startsWith('vehicle-')) {
        errors.push(`${at}: foot is for vehicle classes`)
      } else if (
        !isPair(e.foot) ||
        e.foot[0] >= e.canvas[0] ||
        e.foot[1] >= e.canvas[1]
      ) {
        errors.push(`${at}: foot must be [x, y] inside the canvas`)
      }
    }
    for (const [k, v] of [
      ['bayLights', e.bayLights],
      ['dockPose', e.dockPose === undefined ? undefined : [e.dockPose]],
      ['dockPoses', e.dockPoses],
    ] as const) {
      if (v === undefined) continue
      if (e.class !== 'warehouse-ext') {
        errors.push(`${at}: ${k} is for the warehouse-ext class`)
      }
      const ok =
        Array.isArray(v) &&
        v.every(
          (p) =>
            isPair(p) &&
            isPair(e.canvas) &&
            p[0] < e.canvas[0] &&
            p[1] < e.canvas[1],
        )
      if (!ok) errors.push(`${at}: ${k} must be [x, y] points in the canvas`)
    }
    // dockPoses (build 2 M8): one per bay light, the first = dockPose
    for (const [where, a] of [
      ['', e],
      ...Object.entries(e.frameAnchors ?? {}).map(
        ([sfx, fa]) => [` frameAnchors ${sfx}`, fa] as const,
      ),
    ] as const) {
      const poses = a.dockPoses
      if (poses === undefined) continue
      const lights = a.bayLights ?? []
      const first = poses[0]
      if (
        !Array.isArray(poses) ||
        poses.length !== lights.length ||
        !first ||
        !a.dockPose ||
        first[0] !== a.dockPose[0] ||
        first[1] !== a.dockPose[1]
      ) {
        errors.push(
          `${at}${where}: dockPoses must have one pose per bay light, the first = dockPose`,
        )
      }
    }
    for (const [suffix, a] of Object.entries(e.frameAnchors ?? {})) {
      if (e.class !== 'warehouse-ext' || !e.frames.includes(suffix)) {
        errors.push(`${at}: frameAnchors ${suffix} is not a warehouse frame`)
      }
      const pts = [...(a.bayLights ?? []), a.dockPose, ...(a.dockPoses ?? [])]
      if (
        !Array.isArray(a.bayLights) ||
        !pts.every(
          (p) =>
            isPair(p) &&
            isPair(e.canvas) &&
            p[0] < e.canvas[0] &&
            p[1] < e.canvas[1],
        )
      ) {
        errors.push(`${at}: frameAnchors ${suffix} must be canvas points`)
      }
    }
    if (
      e.editPick !== undefined &&
      (!Number.isInteger(e.editPick) || e.editPick < 0)
    ) {
      errors.push(`${at}: editPick must be an integer >= 0`)
    }
    if (!isPair(e.canvas)) errors.push(`${at}: canvas must be [w, h]`)
    const fixed = CLASS_CANVAS[e.class]
    if (
      fixed &&
      isPair(e.canvas) &&
      !FLEX_CANVAS_CLASSES.includes(e.class) &&
      (e.canvas[0] !== fixed[0] || e.canvas[1] !== fixed[1])
    ) {
      errors.push(`${at}: canvas ${e.canvas} != class canvas ${fixed}`)
    }
    if (e.footprint !== undefined && !isPair(e.footprint)) {
      errors.push(`${at}: footprint must be [w, h]`)
    }
    if (e.class.startsWith('building') && !e.footprint) {
      errors.push(`${at}: building classes need a footprint`)
    }
    if (!Array.isArray(e.frames) || e.frames.length === 0) {
      errors.push(`${at}: frames must be a non-empty array`)
    } else {
      for (const f of e.frames) {
        if (f !== '' && !/^(_[a-z0-9]+)+$/.test(f)) {
          errors.push(`${at}: bad frame suffix '${f}'`)
        }
      }
      if (new Set(e.frames).size !== e.frames.length) {
        errors.push(`${at}: duplicate frame suffix`)
      }
    }
    if (!Array.isArray(e.variants)) errors.push(`${at}: variants must be []`)
    else {
      for (const v of e.variants) {
        if (!(v in VARIANT_SUFFIX)) errors.push(`${at}: bad variant ${v}`)
      }
    }
    if (!['P0', 'P1', 'P2'].includes(e.priority)) {
      errors.push(`${at}: bad priority`)
    }
    if (typeof e.placeholder !== 'boolean') {
      errors.push(`${at}: placeholder must be boolean`)
    }
    if (e.source === 'procedural' && e.placeholder) {
      errors.push(`${at}: procedural entries are never placeholders`)
    }
    if (typeof e.approved !== 'boolean') {
      errors.push(`${at}: approved must be boolean`)
    }
    if (!Array.isArray(e.gen)) errors.push(`${at}: gen must be []`)
    if (!Array.isArray(e.rejects)) errors.push(`${at}: rejects must be []`)
    if (e.smokeAnchors && !e.smokeAnchors.every(isPair)) {
      errors.push(`${at}: smokeAnchors must be [x, y][]`)
    }
    if (Array.isArray(e.frames) && Array.isArray(e.variants)) {
      for (const name of frameNames(e)) {
        const other = seenFrames.get(name)
        if (other !== undefined) {
          errors.push(`${at}: frame ${name} also produced by ${other}`)
        }
        seenFrames.set(name, e.id)
      }
    }
  }
  if (m.retired !== undefined) {
    if (!Array.isArray(m.retired)) errors.push('manifest: retired must be []')
    else {
      const seen = new Set<string>()
      for (const r of m.retired) {
        const at = `manifest retired ${r.id ?? '?'}`
        if (seenIds.has(r.id)) errors.push(`${at}: id is also an entry`)
        if (seen.has(r.id)) errors.push(`${at}: duplicate retired id`)
        seen.add(r.id)
        if (!Array.isArray(r.gen) || !Array.isArray(r.rejects)) {
          errors.push(`${at}: gen / rejects must be []`)
        }
        if (typeof r.reason !== 'string' || r.reason.length === 0) {
          errors.push(`${at}: a retired entry needs its reason`)
        }
      }
    }
  }
  if (buildingIds) errors.push(...buildingCoverage(m, buildingIds).errors)
  return errors
}

/** Stable JSON: 2-space indent, arrays of primitives kept on one line. */
export function stringifyManifest(m: Manifest): string {
  const fmt = (v: unknown, indent: string): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      if (v.every((x) => x === null || typeof x !== 'object' || isPair(x))) {
        return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`
      }
      const inner = indent + '  '
      return `[\n${v.map((x) => inner + fmt(x, inner)).join(',\n')}\n${indent}]`
    }
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v).filter(
        (k) => (v as Record<string, unknown>)[k] !== undefined,
      )
      if (keys.length === 0) return '{}'
      const inner = indent + '  '
      const body = keys
        .map(
          (k) =>
            `${inner}${JSON.stringify(k)}: ${fmt((v as Record<string, unknown>)[k], inner)}`,
        )
        .join(',\n')
      return `{\n${body}\n${indent}}`
    }
    return JSON.stringify(v)
  }
  return fmt(m, '') + '\n'
}

export function saveManifest(
  m: Manifest,
  path: string = MANIFEST_PATH,
): boolean {
  const text = stringifyManifest(m)
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false
  writeFileSync(path, text)
  return true
}

export function getEntry(m: Manifest, id: string): ManifestEntry {
  const e = m.entries.find((x) => x.id === id)
  if (!e) throw new Error(`manifest: unknown id ${id}`)
  return e
}

// ---------------------------------------------------------------------------
// Review actions (style-guide.md §5): vlr art:approve -- id[:candidate] …

/**
 * Approve `id` or `id:candidate`. With a candidate the chosen generated
 * sprite becomes the final (placeholder false).
 */
export function approve(
  m: Manifest,
  spec: string,
  by: 'agent' | 'author' = 'author',
): ManifestEntry {
  const [id, cand] = spec.split(':') as [string, string | undefined]
  const e = getEntry(m, id)
  if (cand !== undefined) {
    const n = Number(cand)
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad candidate: ${spec}`)
    e.chosenCandidate = n
    e.placeholder = false
  }
  e.approved = true
  e.approvedBy = by
  return e
}

/** Reject `id` (its chosen candidate) or `id:candidate` with a reason. */
export function reject(
  m: Manifest,
  spec: string,
  reason: string,
  by: 'claude' | 'author' = 'author',
  at: string = new Date().toISOString(),
): ManifestEntry {
  const [id, cand] = spec.split(':') as [string, string | undefined]
  const e = getEntry(m, id)
  const candidate =
    cand !== undefined ? Number(cand) : (e.chosenCandidate ?? -1)
  e.rejects.push({ candidate, reason, by, at })
  if (cand === undefined || Number(cand) === e.chosenCandidate) {
    e.approved = false
    delete e.approvedBy
    delete e.chosenCandidate
  }
  return e
}

export function setPlaceholder(
  m: Manifest,
  id: string,
  placeholder: boolean,
): ManifestEntry {
  const e = getEntry(m, id)
  if (e.source === 'procedural' && placeholder) {
    throw new Error(`${id}: procedural entries are never placeholders`)
  }
  e.placeholder = placeholder
  return e
}

/**
 * Move a rejected entry out of the game into m.retired (provenance kept).
 * The caller deletes its finals (retiredFinals) and makes sure no building
 * maps to it any more (A13 then flags uncovered buildings).
 */
export function retire(
  m: Manifest,
  id: string,
  reason: string,
  replacedBy: string[] = [],
  at: string = new Date().toISOString(),
): RetiredEntry {
  const e = getEntry(m, id)
  m.entries = m.entries.filter((x) => x !== e)
  const r: RetiredEntry = {
    id: e.id,
    class: e.class,
    source: e.source,
    retiredAt: at,
    reason,
    ...(replacedBy.length ? { replacedBy } : {}),
    gen: e.gen,
    rejects: e.rejects,
    ...(e.note ? { note: e.note } : {}),
  }
  ;(m.retired ??= []).push(r)
  return r
}

/** the final paths a retired entry used to own (base + variant frames) */
export function retiredFinals(e: ManifestEntry): string[] {
  return frameNames(e).map((n) => finalPath(e, n))
}

/** Counts reported by tools: entries, base frames, frames incl. variants. */
export function manifestCounts(m: Manifest): {
  entries: number
  baseFrames: number
  frames: number
  pixellab: number
  placeholders: number
} {
  let baseFrames = 0
  let frames = 0
  for (const e of m.entries) {
    baseFrames += e.frames.length
    frames += frameNames(e).length
  }
  return {
    entries: m.entries.length,
    baseFrames,
    frames,
    pixellab: m.entries.filter((e) => e.source === 'pixellab').length,
    placeholders: m.entries.filter((e) => e.placeholder).length,
  }
}
