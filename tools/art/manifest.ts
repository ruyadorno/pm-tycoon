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
] as const

export type AssetClass = (typeof ASSET_CLASSES)[number]
export type Variant = 'locked' | 't2' | 'mood'
export type Priority = 'P0' | 'P1' | 'P2'
export type Source = 'procedural' | 'pixellab'

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
  'vehicle-bike': [24, 24],
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
  return e.approved || (e.source === 'pixellab' && !e.placeholder)
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
    if (e.source !== 'procedural' && e.source !== 'pixellab') {
      errors.push(`${at}: bad source`)
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
