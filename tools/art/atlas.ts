// `vlr art:atlas` (style-guide.md §3.7 atlas, §7; plan.md §5 "Atlas and
// frames"; spec-build2 §6.8; plan-build2 §8.2 task 8): TWO atlases,
// src/assets/{world,interior}.{png,json} (free-tex-packer-core, exporter
// Phaser3 = JSON with textures[].frames[], loaded by this.load.atlas; padding
// 1, extrude 1, power of two, max 2048 each, no rotation). They live under
// src/ (not public/) so PreloadScene imports them with Vite `?url` and every
// build ships content-hashed names (report-playtest1 §6.21).
//
// Which atlas a frame goes to (entry.atlas ?? ID_PLACEMENT ?? the class
// default below). The rule follows who binds what, because the phone draws
// one texture per batch (autoMobileTextures) and every texture switch in
// display order is a draw call:
//   world     the city (ground tiles, buildings, props, vehicles, exteriors)
//             and the UI nine-slices. The city, the HUD, GarageSheet and
//             src/ui/** bind `world` only (never `interior`), and so do the
//             room's FRONT layers (parcels, machines, workers, badges, fx,
//             the readout), which carry the room's panels and text.
//   interior  the room's BACK layers (floor, walls, belts, fixtures, tail):
//             floors, walls, belts, room props, fixtures, racks, shelves,
//             doors, dock tails, room signs — static art under everything.
//   both      small art drawn from both sides: icons, parcels, fx, machines,
//             workers and the desk (BuySheet, SlotCard and the newspaper draw
//             machines/workers/the desk in the HUD; the room's front layers
//             draw them from `world`, its back layers — the shelf minis —
//             from `interior`) and the m5x7 glyph sheet (PreloadScene
//             registers it twice: FONT_KEY on world, ROOM_FONT_KEY on
//             interior for the north-wall sign text). frames.generated.ts
//             lists them in SHARED_FRAMES with the home atlas 'world'.
// So the room is two batches (back = interior, front = world) where playtest 1
// had one: the warehouse budget of 7 draw calls (plan-build2 §6).
// Class `logo` (art/logo.png, tools/art/logo.ts) is never packed.
//
// Trimming: only the big mostly-transparent city sprites (building*,
// warehouse-ext, prop, dock-prop) are trimmed — here, before packing, so
// the result is exact and deterministic; their frames carry trimmed: true,
// sourceSize = the class canvas and spriteSourceSize = the kept rect, so
// setOrigin(0.5, 1) still means the canvas bottom-centre. Tiles (stamped
// into the ground bake), nine-slices, icons and the font are never trimmed.
//
// Also emits src/render/frames.generated.ts (FRAMES, FrameName, FRAME_ATLAS,
// SHARED_FRAMES and typed helpers: a missing frame is a type error) and
// src/render/spriteMap.generated.json (buildings.json id -> sprite id,
// locked scenery through coversBuildings). If an atlas does not fit one
// 2048^2 page the step fails (A08) and names what overflowed.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StepOpts } from './draw-api.ts'
import { bbox, encodeImg, newImg, readImg, writeIfChanged } from './iso.ts'
import {
  type AssetClass,
  type Manifest,
  type ManifestEntry,
  ROOT,
  buildingCoverage,
  finalPath,
  frameNames,
  isAtlasPacked,
  loadBuildingIds,
  loadManifest,
  vehicleFoot,
  warehouseAnchorTable,
} from './manifest.ts'

export type AtlasKey = 'world' | 'interior'
export type AtlasPlacement = AtlasKey | 'both'
export const ATLAS_KEYS: readonly AtlasKey[] = ['world', 'interior']

/** Hashed-asset sources (imported with `?url` by src/render/assetUrls.ts). */
export const ASSETS_DIR = join(ROOT, 'src/assets')
/** Playtest-1 location of the single atlas; must not come back (A08). */
export const LEGACY_ASSETS_DIR = join(ROOT, 'public/assets')
export const FRAMES_TS = join(ROOT, 'src/render/frames.generated.ts')
export const SPRITE_MAP_JSON = join(ROOT, 'src/render/spriteMap.generated.json')
export const MAX_SIDE = 2048
/** plan-build2 §8.2 acceptance: `world` fill after M5 (a warning when over). */
export const WORLD_FILL_MAX = 0.75

export function atlasPngPath(key: AtlasKey): string {
  return join(ASSETS_DIR, `${key}.png`)
}

export function atlasJsonPath(key: AtlasKey): string {
  return join(ASSETS_DIR, `${key}.json`)
}

/** Room-only classes, drawn in the room's back layers. */
const INTERIOR_CLASSES: ReadonlySet<string> = new Set([
  'interior-tile',
  'interior-prop',
  'fixture',
  'fixture-rack',
  'fixture-shelf',
  'fixture-door',
  'dock-tail',
  'sign',
])

/** Drawn by the room and by world-bound surfaces: packed into both. */
const SHARED_CLASSES: ReadonlySet<string> = new Set([
  'fixture-desk',
  'machine',
  'worker',
  'icon16',
  'parcel',
  'fx',
  'font',
])

/**
 * Room-class ids the room draws in a FRONT layer (badges): world, so the
 * front layers never switch back to `interior` (LaneRenderer, DockView).
 */
const ID_PLACEMENT: Readonly<Record<string, AtlasPlacement>> = {
  ext_outline: 'world',
  slot_empty_outline: 'world',
  slot_locked_outline: 'world',
  station_outline: 'world',
  lamp: 'world',
}

/**
 * Where an entry is packed: its manifest `atlas` field when set ('world',
 * 'interior' or 'both'), else the class default; null = never packed.
 */
export function placementOf(e: ManifestEntry): AtlasPlacement | null {
  if (!isAtlasPacked(e)) return null
  const cls = String(e.class)
  const own = (e as { atlas?: unknown }).atlas
  if (own === 'world' || own === 'interior' || own === 'both') return own
  const byId = ID_PLACEMENT[e.id]
  if (byId) return byId
  if (INTERIOR_CLASSES.has(cls)) return 'interior'
  if (SHARED_CLASSES.has(cls)) return 'both'
  return 'world'
}

/** The atlases an entry's frames are packed into (empty = never packed). */
export function atlasesOf(e: ManifestEntry): AtlasKey[] {
  const p = placementOf(e)
  if (p === null) return []
  return p === 'both' ? ['world', 'interior'] : [p]
}

const TRIM_CLASSES: readonly AssetClass[] = [
  'building1x1',
  'building2x2',
  'building3x3',
  'warehouse-ext',
  'prop',
  'dock-prop',
]

interface Item {
  name: string
  entry: ManifestEntry
  buf: Buffer
  trim: {
    x: number
    y: number
    w: number
    h: number
    sw: number
    sh: number
  } | null
}

function collect(m: Manifest): { items: Item[]; missing: string[] } {
  const items: Item[] = []
  const missing: string[] = []
  for (const e of m.entries) {
    if (atlasesOf(e).length === 0) continue
    for (const name of frameNames(e)) {
      const p = finalPath(e, name)
      if (!existsSync(p)) {
        missing.push(name)
        continue
      }
      if (!TRIM_CLASSES.includes(e.class)) {
        items.push({ name, entry: e, buf: readFileSync(p), trim: null })
        continue
      }
      const { img } = readImg(p)
      const b = bbox(img) ?? { x0: 0, y0: 0, x1: 0, y1: 0 }
      const w = b.x1 - b.x0 + 1
      const h = b.y1 - b.y0 + 1
      const crop = newImg(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          crop.px[y * w + x] = img.px[(b.y0 + y) * img.w + b.x0 + x] as number
        }
      }
      items.push({
        name,
        entry: e,
        buf: encodeImg(crop),
        trim: { x: b.x0, y: b.y0, w, h, sw: img.w, sh: img.h },
      })
    }
  }
  return {
    items: items.toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    missing,
  }
}

interface PhaserFrame {
  filename: string
  rotated: boolean
  trimmed: boolean
  sourceSize: { w: number; h: number }
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  frame: { x: number; y: number; w: number; h: number }
}

interface PhaserAtlas {
  textures: {
    image: string
    format: string
    size: { w: number; h: number }
    scale: number
    frames: PhaserFrame[]
  }[]
  meta: Record<string, unknown>
}

function pow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

// ---------------------------------------------------------------------------
// Generated TypeScript

const HEADINGS = ['ne', 'se', 'sw', 'nw']

/** Board faces (exterior.ts SIGN_FACE / SIGN_LOCKED_FACE), canvas px. */
interface Face {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** The frame -> home-atlas table of frames.generated.ts. */
export interface AtlasIndex {
  /** home atlas: 'world' for frames packed into both */
  home: Record<string, AtlasKey>
  /** frames packed into both atlases */
  shared: string[]
}

export function atlasIndex(items: readonly Item[]): AtlasIndex {
  const home: Record<string, AtlasKey> = {}
  const shared: string[] = []
  for (const it of items) {
    const keys = atlasesOf(it.entry)
    home[it.name] = keys.includes('world') ? 'world' : 'interior'
    if (keys.length > 1) shared.push(it.name)
  }
  return { home, shared: shared.toSorted() }
}

/** a canvas point as a TS tuple literal */
function pt([x, y]: readonly [number, number]): string {
  return `[${x}, ${y}]`
}

export function framesTs(
  m: Manifest,
  names: string[],
  spriteMap: Record<string, string>,
  index: AtlasIndex = { home: {}, shared: [] },
  faces: { sign: Face; locked: Face } = {
    sign: { x: 0, y: 0, w: 0, h: 0 },
    locked: { x: 0, y: 0, w: 0, h: 0 },
  },
): string {
  const sorted = names.toSorted()
  const lines: string[] = []
  lines.push(
    '// GENERATED by tools/art/atlas.ts (`vlr art:atlas`) — do not edit.',
    '// Every frame of the `world` and `interior` atlases',
    '// (src/assets/{world,interior}.{png,json}, spec-build2 §6.8). Scenes reach',
    '// frames only through this module, so a missing frame is a type error',
    '// (style-guide.md §7). FRAME_ATLAS names the atlas a frame lives in;',
    '// SHARED_FRAMES are packed into both (home `world`).',
    '',
    "export const WORLD_ATLAS_KEY = 'world'",
    "export const INTERIOR_ATLAS_KEY = 'interior'",
    "export type AtlasKey = 'world' | 'interior'",
    '',
    'export const FRAMES = {',
  )
  for (const n of sorted) lines.push(`  ${n}: '${n}',`)
  lines.push(
    '} as const',
    '',
    'export type FrameName = keyof typeof FRAMES',
    '',
  )
  lines.push(
    '/** home atlas per frame: `interior` = only the room atlas has it */',
    'export const FRAME_ATLAS: Readonly<Record<FrameName, AtlasKey>> = {',
  )
  for (const n of sorted) lines.push(`  ${n}: '${index.home[n] ?? 'world'}',`)
  lines.push(
    '}',
    '',
    '/** frames packed into both atlases (the room draws them from `interior`) */',
    'export const SHARED_FRAMES: ReadonlySet<string> = new Set<string>([',
  )
  for (const n of index.shared) lines.push(`  '${n}',`)
  lines.push(
    '])',
    '',
    'export function isFrame(name: string): name is FrameName {',
    '  return Object.prototype.hasOwnProperty.call(FRAMES, name)',
    '}',
    '',
    '/** the frame, or throws when the atlases lack it */',
    'export function frame(name: string): FrameName {',
    '  if (!isFrame(name)) throw new Error(`atlas: no frame ${name}`)',
    '  return name',
    '}',
    '',
    '/** true when `atlas` holds the frame */',
    'export function inAtlas(name: string, atlas: AtlasKey): boolean {',
    '  if (!isFrame(name)) return false',
    '  return FRAME_ATLAS[name] === atlas || SHARED_FRAMES.has(name)',
    '}',
    '',
  )
  // roads
  lines.push(
    '/** road autotile bits: N = tile -y (screen up-right), E = +x, S = +y, W = -x */',
    'export const ROAD_N = 1',
    'export const ROAD_E = 2',
    'export const ROAD_S = 4',
    'export const ROAD_W = 8',
    '',
    '/** road_00 .. road_15 for a 4-bit N|E|S|W neighbour mask */',
    'export function roadFrame(mask: number): FrameName {',
    "  return frame(`road_${String(mask & 15).padStart(2, '0')}`)",
    '}',
    '',
  )
  // vehicles
  const vehicles = m.entries
    .filter((e) => e.class.startsWith('vehicle-'))
    .map((e) => e.id)
  lines.push(
    `export type VehicleType = ${vehicles.map((v) => `'${v}'`).join(' | ') || 'never'}`,
    `export type Heading = ${HEADINGS.map((h) => `'${h}'`).join(' | ')}`,
    '',
    '/** van_se_0 …: heading from tile motion (+x se, +y sw, -x nw, -y ne) */',
    'export function vehicleFrame(',
    '  type: VehicleType,',
    '  heading: Heading,',
    '  phase: number,',
    '): FrameName {',
    '  return frame(`${type}_${heading}_${phase & 1}`)',
    '}',
    '',
    '/** canvas pixel of the vehicle footprint centre (the road line point) */',
    'export const VEHICLE_FOOT: Record<VehicleType, readonly [number, number]> = {',
  )
  for (const e of m.entries.filter((x) => x.class.startsWith('vehicle-'))) {
    const f = vehicleFoot(e)
    lines.push(`  ${e.id}: [${f[0]}, ${f[1]}],`)
  }
  lines.push('}', '')
  // buildings
  lines.push(
    '/** buildings.json id -> sprite id (locked scenery via coversBuildings) */',
    'export const SPRITE_MAP: Readonly<Record<string, string>> = {',
  )
  for (const k of Object.keys(spriteMap).toSorted()) {
    lines.push(`  ${k}: '${spriteMap[k]}',`)
  }
  lines.push(
    '}',
    '',
    "/** a building's frame; `locked` picks the fogged _locked frame when it exists */",
    'export function buildingFrame(buildingId: string, locked = false): FrameName {',
    '  const sprite = SPRITE_MAP[buildingId]',
    '  if (sprite === undefined) throw new Error(`atlas: no sprite for ${buildingId}`)',
    '  if (locked && isFrame(`${sprite}_locked`)) return frame(`${sprite}_locked`)',
    '  return frame(sprite)',
    '}',
    '',
    '/** chimney smoke emitters: canvas pixel offsets from the top-left */',
    'export const SMOKE_ANCHORS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {',
  )
  for (const e of m.entries.filter((x) => x.smokeAnchors?.length)) {
    const a = (e.smokeAnchors ?? []).map(([x, y]) => `[${x}, ${y}]`).join(', ')
    lines.push(`  ${e.id}: [${a}],`)
  }
  lines.push(
    '}',
    '',
    "/** a warehouse exterior frame's city anchors, canvas px from the top-left (cityFx.ts) */",
    'export interface WarehouseAnchorSet {',
    '  /** the amber lamp over each loading-bay door of the visible SW face (bays 1-3) */',
    '  readonly bayLights: readonly (readonly [number, number])[]',
    '  /** foot point of a vehicle docked at bay 1 */',
    '  readonly dockPose: readonly [number, number]',
    '}',
    '',
    '/** per exterior frame (manifest warehouse-ext bayLights / dockPose, frameAnchors overrides) */',
    'export const WH_ANCHORS: Readonly<Partial<Record<FrameName, WarehouseAnchorSet>>> = {',
  )
  for (const [f, a] of Object.entries(warehouseAnchorTable(m))) {
    if (!names.includes(f)) continue
    lines.push(
      `  ${f}: { bayLights: [${a.bayLights.map(pt).join(', ')}], dockPose: ${pt(a.dockPose)} },`,
    )
  }
  lines.push(
    '}',
    '',
    '/** board faces (BitmapText goes here), canvas px: sign_days 64x40, sign_locked 96x52 */',
    `export const SIGN_FACE = ${faceLiteral(faces.sign)} as const`,
    `export const SIGN_LOCKED_FACE = ${faceLiteral(faces.locked)} as const`,
    '',
  )
  return lines.join('\n')
}

function faceLiteral(f: Face): string {
  return `{ x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h} }`
}

export function spriteMapFor(m: Manifest): Record<string, string> {
  const ids = loadBuildingIds()
  if (!ids) return {}
  const { map } = buildingCoverage(m, ids)
  const out: Record<string, string> = {}
  for (const id of [...map.keys()].toSorted()) out[id] = map.get(id) as string
  return out
}

// ---------------------------------------------------------------------------
// Packing

interface Packed {
  key: AtlasKey
  png: Buffer
  atlas: PhaserAtlas
  w: number
  h: number
  /** packed frame px (no padding / extrude) */
  area: number
}

async function packAtlas(
  key: AtlasKey,
  items: readonly Item[],
): Promise<Packed | { error: string }> {
  const { packAsync } = await import('free-tex-packer-core')
  const files = items.map((it) => ({
    path: `${it.name}.png`,
    contents: it.buf,
  }))
  const out = await packAsync(files, {
    textureName: key,
    width: MAX_SIDE,
    height: MAX_SIDE,
    fixedSize: false,
    powerOfTwo: true,
    padding: 1,
    extrude: 1,
    allowRotation: false,
    allowTrim: false,
    detectIdentical: true,
    removeFileExtension: true,
    prependFolderName: false,
    exporter: 'Phaser3' as never,
    packer: 'MaxRectsBin' as never,
    packerMethod: 'BestShortSideFit' as never,
  })
  const jsons = out.filter((f) => f.name.endsWith('.json'))
  const pngs = out.filter((f) => f.name.endsWith('.png'))
  if (jsons.length !== 1 || pngs.length !== 1) {
    // overflow: report what landed on the extra pages, write nothing
    const extra: string[] = []
    for (const j of jsons.slice(1)) {
      const a = JSON.parse(j.buffer.toString('utf8')) as PhaserAtlas
      for (const t of a.textures) extra.push(...t.frames.map((f) => f.filename))
    }
    return {
      error:
        `A08 ${key}: everything does not fit one ${MAX_SIDE}x${MAX_SIDE} page ` +
        `(${jsons.length} pages); overflow: ${extra.slice(0, 20).join(', ')}` +
        (extra.length > 20 ? ` … (+${extra.length - 20})` : ''),
    }
  }
  const atlas = JSON.parse(
    (jsons[0] as { buffer: Buffer }).buffer.toString('utf8'),
  ) as PhaserAtlas
  const tex = atlas.textures[0]
  if (!tex) throw new Error(`atlas: exporter produced no texture for ${key}`)
  tex.image = `${key}.png`
  const byName = new Map(items.map((it) => [it.name, it]))
  let area = 0
  for (const f of tex.frames) {
    const it = byName.get(f.filename)
    if (!it) throw new Error(`atlas: unknown packed frame ${f.filename}`)
    area += f.frame.w * f.frame.h
    if (it.trim) {
      f.trimmed = true
      f.sourceSize = { w: it.trim.sw, h: it.trim.sh }
      f.spriteSourceSize = {
        x: it.trim.x,
        y: it.trim.y,
        w: it.trim.w,
        h: it.trim.h,
      }
    }
  }
  tex.frames = tex.frames.toSorted((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  )
  atlas.meta = {
    app: 'pm-tycoon tools/art/atlas.ts (free-tex-packer-core 0.3.9)',
    format: 'Phaser3 JSON (textures[].frames[])',
    atlas: key,
    frames: tex.frames.length,
  }
  // A08 checks on the result
  const { w, h } = tex.size
  if (w > MAX_SIDE || h > MAX_SIDE || !pow2(w) || !pow2(h)) {
    return {
      error: `A08 ${key}: ${w}x${h} is not a power of two <= ${MAX_SIDE}`,
    }
  }
  if (tex.frames.length !== items.length) {
    return {
      error: `A08 ${key}: ${tex.frames.length} frames, expected ${items.length}`,
    }
  }
  return {
    key,
    png: (pngs[0] as { buffer: Buffer }).buffer,
    atlas,
    w,
    h,
    area,
  }
}

// ---------------------------------------------------------------------------
// A08 over the written atlases (tools/art/lint.ts calls this)

interface AtlasFileFrame {
  filename: string
}

/**
 * A08 on src/assets/{world,interior}.json against the manifest: each atlas is
 * one power-of-two page <= 2048², holds exactly the frames atlasesOf() puts
 * there (finals that exist), no duplicates; the playtest-1 public/assets/
 * atlas is gone. Returns problems; `missing` lists absent atlas files.
 */
export function atlasProblems(m: Manifest): {
  problems: string[]
  missing: string[]
} {
  const problems: string[] = []
  const missing: string[] = []
  const want = new Map<AtlasKey, Set<string>>()
  for (const k of ATLAS_KEYS) want.set(k, new Set())
  for (const e of m.entries) {
    const keys = atlasesOf(e)
    for (const n of frameNames(e)) {
      if (!existsSync(finalPath(e, n))) continue
      for (const k of keys) want.get(k)?.add(n)
    }
  }
  for (const k of ATLAS_KEYS) {
    const p = atlasJsonPath(k)
    if (!existsSync(p) || !existsSync(atlasPngPath(k))) {
      missing.push(`src/assets/${k}.{png,json}`)
      continue
    }
    const j = JSON.parse(readFileSync(p, 'utf8')) as {
      textures?: { size: { w: number; h: number }; frames: AtlasFileFrame[] }[]
    }
    const t = j.textures ?? []
    if (t.length !== 1)
      problems.push(`A08 ${k}.json: ${t.length} textures, want 1`)
    const size = t[0]?.size ?? { w: 0, h: 0 }
    if (
      size.w > MAX_SIDE ||
      size.h > MAX_SIDE ||
      !pow2(size.w) ||
      !pow2(size.h)
    ) {
      problems.push(
        `A08 ${k}.json: ${size.w}x${size.h} (<= ${MAX_SIDE}, power of two)`,
      )
    }
    const names = new Set<string>()
    for (const f of t.flatMap((x) => x.frames)) {
      if (names.has(f.filename))
        problems.push(`A08 ${k}.json: duplicate ${f.filename}`)
      names.add(f.filename)
    }
    const expected = want.get(k) ?? new Set<string>()
    for (const n of expected) {
      if (!names.has(n)) problems.push(`A08 ${n}: not in ${k}.json`)
    }
    for (const n of names) {
      if (!expected.has(n))
        problems.push(`A08 ${k}.json: ${n} does not belong here`)
    }
  }
  if (existsSync(join(LEGACY_ASSETS_DIR, 'world.png'))) {
    problems.push(
      'A08 public/assets/world.png is back (atlases live in src/assets, hashed by Vite)',
    )
  }
  return { problems, missing }
}

// ---------------------------------------------------------------------------

export async function run(opts: StepOpts): Promise<number> {
  // `vlr art:atlas -- --allow-missing`: pack what exists while another job
  // is still drawing finals (parallel work); art:build never passes it
  const allowMissing = opts.args.includes('--allow-missing')
  const m = loadManifest()
  const { items, missing } = collect(m)
  const fontMissing = missing.filter((n) => n === 'm5x7')
  const otherMissing = missing.filter((n) => n !== 'm5x7')
  if (otherMissing.length > 0) {
    const list =
      `${otherMissing.length} finals missing (run art:draw/variants): ` +
      otherMissing.slice(0, 8).join(', ')
    if (!allowMissing) {
      console.error(`atlas: ${list}`)
      return 1
    }
    console.warn(`atlas: --allow-missing, packed without ${list}`)
  }
  if (fontMissing.length) {
    console.warn(
      'atlas: m5x7 glyph sheet missing (vlr font:build) — packed without it',
    )
  }
  for (const e of m.entries) {
    const own = (e as { atlas?: unknown }).atlas
    if (own === 'interior' && SHARED_CLASSES.has(String(e.class))) {
      console.warn(
        `atlas: ${e.id} (${e.class}) is interior-only by its manifest row, ` +
          'but the HUD/city bind world only — use atlas "both" if they draw it',
      )
    }
  }
  const packed: Packed[] = []
  const errors: string[] = []
  for (const key of ATLAS_KEYS) {
    const mine = items.filter((it) => atlasesOf(it.entry).includes(key))
    const r = await packAtlas(key, mine)
    if ('error' in r) errors.push(r.error)
    else packed.push(r)
  }
  for (const e of errors) console.error(`atlas: ${e}`)
  if (errors.length) return 1

  const changed: string[] = []
  for (const p of packed) {
    if (writeIfChanged(atlasPngPath(p.key), p.png)) changed.push(`${p.key}.png`)
    const json = Buffer.from(JSON.stringify(p.atlas, null, 1) + '\n')
    if (writeIfChanged(atlasJsonPath(p.key), json)) {
      changed.push(`${p.key}.json`)
    }
  }
  const spriteMap = spriteMapFor(m)
  const names = [...new Set(items.map((it) => it.name))]
  // exterior.ts registers its drawers on import: load it here only, so
  // lint (which imports atlasProblems) never does
  const { SIGN_FACE, SIGN_LOCKED_FACE } = await import('./exterior.ts')
  const ts = framesTs(m, names, spriteMap, atlasIndex(items), {
    sign: SIGN_FACE,
    locked: SIGN_LOCKED_FACE,
  })
  if (writeIfChanged(FRAMES_TS, Buffer.from(ts))) {
    changed.push('frames.generated.ts')
  }
  if (
    writeIfChanged(
      SPRITE_MAP_JSON,
      Buffer.from(JSON.stringify(spriteMap, null, 2) + '\n'),
    )
  ) {
    changed.push('spriteMap.generated.json')
  }
  const shared = items.filter((it) => atlasesOf(it.entry).length > 1).length
  for (const p of packed) {
    const fill = p.area / (p.w * p.h)
    const frames = p.atlas.textures[0]?.frames.length ?? 0
    const font =
      p.key === 'world'
        ? fontMissing.length
          ? ', no m5x7 sheet'
          : ', m5x7 included'
        : ''
    console.log(
      `atlas: ${p.key} ${frames} frames in ${p.w}x${p.h} ` +
        `(${(100 * fill).toFixed(1)} % filled)${font}`,
    )
    if (p.key === 'world' && fill > WORLD_FILL_MAX) {
      console.warn(
        `atlas: world is ${(100 * fill).toFixed(1)} % full, over the ` +
          `${100 * WORLD_FILL_MAX} % target (plan-build2 §8.2)`,
      )
    }
  }
  console.log(
    `atlas: ${shared} frames packed into both; ` +
      `changed: ${changed.join(', ') || 'nothing'}`,
  )
  return 0
}
