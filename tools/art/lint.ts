// `vlr art:lint` (style-guide.md §6). Every message names the rule, the id,
// the frame and a pixel/row; errors exit 1, warnings exit 0.
//
//   A01 every opaque pixel is a palette colour of subsetFor(class)
//   A02 alpha is 0 or 255 only
//   A03 canvas = class canvas (rows for flex classes); icons 16x16 with a
//       1-px transparent margin
//   A04 city classes: the lowest rows form the footprint diamond, bottom
//       vertex on the anchor (overlay tiles and mood_* overlays exempt)
//   A05 inside the canvas, under the §1.5 height budget; vehicles keep a
//       1-px margin
//   A06 frame set complete (vehicles 4 headings x 2, worker 28, variants)
//   A07 reserved-colour membership (mal / gold / red / water per class)
//   A08 atlas <= 2048^2, power of two, no duplicate names, frames <-> world
//   A09 every entry has its finals, every final maps to an entry,
//       finalSha256 matches
//   A10 outline continuity: opaque pixels touching transparency are
//       `outline` (fogged outline on _locked frames) for outlined classes
//   A11 no near-black fills (V < 0.25 only for outline / mal0 in parcels)
//   A12 warnings: placeholders, > 16 colours, buildings with < 3 colours,
//       contact sheets older than their finals
//   A13 manifest schema + buildings.json coverage (manifest.ts)
//   A14 procedural determinism: re-drawing + post-processing every
//       procedural id reproduces its final bytes
// Font frames (pure #ffffff glyphs, tinted at runtime) are checked for
// A02, white-only ink and a non-blank sheet; their canvas varies.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { StepOpts } from './draw-api.ts'
import {
  type Img,
  bbox,
  decodePng,
  encodeImg,
  opaque,
  pid,
  readImg,
  rgbaToImg,
  stairStepOk,
} from './iso.ts'
import {
  type Manifest,
  type ManifestEntry,
  CITY_CLASSES,
  FINAL_DIR,
  HEIGHT_BUDGET,
  MANIFEST_PATH,
  ROOT,
  VARIANT_SUFFIX,
  baseFrameNames,
  finalPath,
  frameNames,
  frameSetSha256,
  hasKeptFinal,
  loadManifest,
  manifestCounts,
  validateManifest,
  variantFrameNames,
} from './manifest.ts'
import {
  entrySubset,
  nearestIndexFn,
  normalizeFinal,
  selectedEntries,
} from './normalize.ts'
import { needsOutline, outlineFinal } from './outline.ts'
import { PALETTE, RAMP_RULES, rampAllowed } from './palette.ts'
import { quantizeImg } from './quantize.ts'
import { FOG_IDS } from './variants.ts'

const PNG_SIG = '89504e470d0a1a0a'

/** [width, height] from a PNG's IHDR, or null if not a PNG */
export function pngSize(buf: Buffer): [number, number] | null {
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== PNG_SIG) {
    return null
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

/** tile ids whose frames are partial overlays (no full diamond, A04) */
export const OVERLAY_TILE = /^(kerb_[nesw]|edge_[a-z]+_[nesw])$/

const VEHICLE_FRAMES = ['ne', 'se', 'sw', 'nw'].flatMap((h) => [
  `_${h}_0`,
  `_${h}_1`,
])
const WORKER_FRAMES = ['s', 'n', 'e', 'w'].flatMap((d) => [
  ...['idle', 'walk', 'scan'].flatMap((a) => [`_${d}_${a}_0`, `_${d}_${a}_1`]),
  `_${d}_jump`,
])

interface Report {
  errors: string[]
  warnings: string[]
}

function hsvV(rgb: readonly number[]): number {
  return Math.max(...rgb) / 255
}

function pow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

// ---------------------------------------------------------------------------
// Per-frame pixel rules

/**
 * The m5x7 glyph sheet is pure #ffffff by design (tinted at runtime), so it
 * is exempt from palette membership: A02 still holds, every opaque pixel
 * must be white, and the sheet must carry ink (a blank sheet makes every
 * BitmapText invisible while the font still "loads").
 */
function checkFontSheet(
  r: Report,
  e: ManifestEntry,
  name: string,
  buf: Buffer,
): void {
  const { rgba } = decodePng(buf)
  let semi = 0
  let ink = 0
  let off = 0
  for (let k = 0; k < rgba.length; k += 4) {
    const a = rgba[k + 3] as number
    if (a === 0) continue
    if (a !== 255) semi++
    ink++
    if (rgba[k] !== 255 || rgba[k + 1] !== 255 || rgba[k + 2] !== 255) off++
  }
  const at = `${e.id}: ${name}`
  if (semi > 0) r.errors.push(`A02 ${at}: ${semi} semi-transparent pixels`)
  if (off > 0) r.errors.push(`A01 ${at}: ${off} glyph pixels are not #ffffff`)
  if (ink === 0) {
    r.errors.push(`A09 ${at}: glyph sheet is blank (run vlr font:build)`)
  }
}

function checkPixels(
  r: Report,
  e: ManifestEntry,
  name: string,
  locked: boolean,
): Img | null {
  const p = finalPath(e, name)
  const buf = readFileSync(p)
  const size = pngSize(buf)
  if (!size) {
    r.errors.push(`A03 ${e.id}: ${name}.png is not a PNG`)
    return null
  }
  if (e.class === 'font') {
    checkFontSheet(r, e, name, buf)
    return null
  }
  const { img, offPalette, semiAlpha } = readImg(p)
  const at = `${e.id}: ${name}`
  // A02
  if (semiAlpha > 0) {
    r.errors.push(`A02 ${at}: ${semiAlpha} semi-transparent pixels`)
  }
  // A01 / A07 / A11
  if (offPalette > 0) {
    r.errors.push(`A01 ${at}: ${offPalette} pixels are not palette colours`)
  }
  const subset = new Set(entrySubset(e).map((c) => c.id))
  const bad = new Map<string, [number, number, number]>()
  for (let k = 0; k < img.px.length; k++) {
    const i = img.px[k] as number
    if (i < 0) continue
    const id = pid(i)
    const ok = locked
      ? id.startsWith('grey') || id === 'outline'
      : subset.has(id)
    if (!ok) {
      const prev = bad.get(id)
      if (prev) prev[2]++
      else bad.set(id, [k % img.w, Math.floor(k / img.w), 1])
    }
  }
  for (const [id, [x, y, n]] of bad) {
    const c = PALETTE.byId.get(id)
    const reserved = c && RAMP_RULES[c.ramp] !== undefined
    const code =
      reserved && !rampAllowed(c.ramp, e.class, { district: e.district })
        ? 'A07'
        : 'A01'
    r.errors.push(
      `${code} ${at} (${x},${y}): ${id} not allowed in ${e.class}` +
        `${locked ? ' _locked (fog greys only)' : ''} (${n} px)`,
    )
  }
  for (const c of PALETTE.colors) {
    if (hsvV(c.rgb) >= 0.25 || c.id === 'outline') continue
    if (c.id === 'mal0' && e.class === 'parcel') continue
    const i = PALETTE.colors.indexOf(c)
    const k = img.px.indexOf(i)
    if (k >= 0) {
      r.errors.push(
        `A11 ${at} (${k % img.w},${Math.floor(k / img.w)}): near-black ${c.id}`,
      )
    }
  }
  // A03
  const [W, H] = e.canvas
  if (img.w !== W || img.h !== H) {
    r.errors.push(`A03 ${at}: ${img.w}x${img.h}, canvas ${W}x${H}`)
    return img
  }
  if (e.class === 'icon16') {
    for (let x = 0; x < W; x++) {
      for (const y of [0, H - 1]) {
        if (opaque(img, x, y) || opaque(img, y, x)) {
          r.errors.push(`A03 ${at} (${x},${y}): icon margin not transparent`)
          x = W
          break
        }
      }
    }
  }
  // A04
  const overlay = OVERLAY_TILE.test(e.id) || e.id.startsWith('mood_')
  if (CITY_CLASSES.includes(e.class) && !overlay) {
    const fp = e.footprint?.[0] ?? Math.round(W / 64)
    for (const problem of stairStepOk(img, 64 * fp).slice(0, 1)) {
      r.errors.push(`A04 ${at}: ${problem}`)
    }
  }
  // A05
  const b = bbox(img)
  if (b) {
    const budget = HEIGHT_BUDGET[e.class]
    if (budget !== undefined) {
      const fp = e.footprint?.[0] ?? Math.round(W / 64)
      const limit = H - 32 * fp - budget
      if (b.y0 < limit) {
        r.errors.push(`A05 ${at}: row ${b.y0} above the height budget`)
      }
    }
    if (e.class.startsWith('vehicle-')) {
      if (b.x0 < 1 || b.y0 < 1 || b.x1 > W - 2 || b.y1 > H - 2) {
        r.errors.push(
          `A05 ${at}: bbox (${b.x0},${b.y0})-(${b.x1},${b.y1}) touches ` +
            'the 1-px margin',
        )
      }
    }
  }
  // A10
  if (needsOutline(e)) {
    const want = locked ? FOG_IDS.get('outline') : 'outline'
    let first: [number, number] | null = null
    let n = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = img.px[y * W + x] as number
        if (i < 0) continue
        const edge =
          !opaque(img, x - 1, y) ||
          !opaque(img, x + 1, y) ||
          !opaque(img, x, y - 1) ||
          !opaque(img, x, y + 1)
        if (edge && pid(i) !== want) {
          n++
          first ??= [x, y]
        }
      }
    }
    if (first) {
      r.errors.push(
        `A10 ${at} (${first[0]},${first[1]}): ${n} silhouette pixels are ` +
          `not ${want}`,
      )
    }
  }
  // A12 colour drift
  const unique = new Set<number>()
  for (const i of img.px) if (i >= 0) unique.add(i)
  if (unique.size > 16 && !locked) {
    r.warnings.push(`A12 ${at}: ${unique.size} colours (> 16)`)
  }
  if (e.class.startsWith('building') && unique.size < 3 && !locked) {
    r.warnings.push(`A12 ${at}: only ${unique.size} colours`)
  }
  return img
}

// ---------------------------------------------------------------------------
// Frame-set, manifest <-> finals, atlas

function checkFrameSet(r: Report, e: ManifestEntry): void {
  const want = e.class.startsWith('vehicle-')
    ? VEHICLE_FRAMES
    : e.class === 'worker'
      ? WORKER_FRAMES
      : null
  if (want) {
    const got = e.frames.toSorted().join(',')
    if (got !== want.toSorted().join(',')) {
      r.errors.push(`A06 ${e.id}: frames [${e.frames}] != [${want}]`)
    }
  }
}

function checkOrphans(r: Report, m: Manifest): void {
  const known = new Set<string>()
  for (const e of m.entries) {
    for (const n of frameNames(e)) known.add(`${e.class}/${n}.png`)
  }
  if (!existsSync(FINAL_DIR)) return
  for (const cls of readdirSync(FINAL_DIR)) {
    const dir = join(FINAL_DIR, cls)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.png')) continue
      if (!known.has(`${cls}/${f}`)) {
        r.errors.push(`A09 art/final/${cls}/${f}: no manifest entry/frame`)
      }
    }
  }
}

const ATLAS_JSON = join(ROOT, 'public/assets/world.json')

interface AtlasFrame {
  filename: string
  frame: { x: number; y: number; w: number; h: number }
}

export function atlasFrames(json: unknown): {
  w: number
  h: number
  frames: AtlasFrame[]
  textures: number
} {
  const j = json as {
    textures?: { size: { w: number; h: number }; frames: AtlasFrame[] }[]
  }
  const t = j.textures ?? []
  const first = t[0]
  return {
    w: first?.size.w ?? 0,
    h: first?.size.h ?? 0,
    frames: t.flatMap((x) => x.frames),
    textures: t.length,
  }
}

function newestFinal(): number {
  let t = 0
  if (!existsSync(FINAL_DIR)) return t
  for (const cls of readdirSync(FINAL_DIR)) {
    const dir = join(FINAL_DIR, cls)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      t = Math.max(t, statSync(join(dir, f)).mtimeMs)
    }
  }
  return t
}

/** A08 over public/assets/world.json (expected = every existing final) */
export function checkAtlas(m: Manifest, r: Report, strict: boolean): void {
  if (!existsSync(ATLAS_JSON)) {
    r.warnings.push('A08 public/assets/world.json missing (run art:atlas)')
    return
  }
  const stale = statSync(ATLAS_JSON).mtimeMs < newestFinal()
  const push = (msg: string) =>
    strict || !stale ? r.errors.push(msg) : r.warnings.push(`${msg} (stale)`)
  const a = atlasFrames(JSON.parse(readFileSync(ATLAS_JSON, 'utf8')))
  if (a.textures !== 1) push(`A08 world.json: ${a.textures} textures, want 1`)
  if (a.w > 2048 || a.h > 2048 || !pow2(a.w) || !pow2(a.h)) {
    push(`A08 world.json: ${a.w}x${a.h} (<= 2048, power of two)`)
  }
  const names = new Set<string>()
  for (const f of a.frames) {
    if (names.has(f.filename)) push(`A08 world.json: duplicate ${f.filename}`)
    names.add(f.filename)
  }
  for (const e of m.entries) {
    for (const n of frameNames(e)) {
      const present = existsSync(finalPath(e, n))
      if (present && !names.has(n)) push(`A08 ${e.id}: ${n} not in world.json`)
      names.delete(n)
    }
  }
  for (const n of names) push(`A08 world.json: ${n} has no manifest frame`)
  if (stale && r.warnings.length > 0) {
    r.warnings.push('A08 the atlas is older than the finals (art:atlas)')
  }
}

// ---------------------------------------------------------------------------
// A14 procedural determinism

async function checkDeterminism(
  r: Report,
  entries: ManifestEntry[],
): Promise<number> {
  const { loadDrawers, drawerFor, findDrawer } = await import('./drawers.ts')
  const { drawCtxFor, checkFrames } = await import('./build.ts')
  const { fallbackDrawer } = await import('./fallback.ts')
  await loadDrawers()
  let checked = 0
  for (const e of entries) {
    if (e.class === 'font' || hasKeptFinal(e)) continue
    let frames
    let problems: string[] = []
    try {
      frames = drawerFor(e)(drawCtxFor(e))
      problems = checkFrames(e, frames)
    } catch (err) {
      problems = [(err as Error).message]
    }
    if (problems.length > 0 || !frames) {
      if (findDrawer(e)) {
        r.warnings.push(`A14 ${e.id}: drawer failed (${problems[0]})`)
      }
      frames = fallbackDrawer(drawCtxFor(e))
    }
    const near = nearestIndexFn(entrySubset(e))
    for (const f of frames) {
      const name = e.id + f.suffix
      const p = finalPath(e, name)
      if (!existsSync(p)) continue
      const { width, height } = f.canvas
      const data = f.canvas.getContext('2d').getImageData(0, 0, width, height)
      let img = rgbaToImg(data.data, width, height, near).img
      img = outlineFinal(e, quantizeImg(e, normalizeFinal(e, img)))
      checked++
      if (!encodeImg(img).equals(readFileSync(p))) {
        r.errors.push(
          `A14 ${e.id}: ${name}: re-drawing does not reproduce the final ` +
            '(unseeded randomness or a hand edit)',
        )
      }
    }
  }
  return checked
}

// ---------------------------------------------------------------------------

export async function run(opts: StepOpts): Promise<number> {
  if (!existsSync(MANIFEST_PATH)) {
    console.log('lint: no art/manifest.json yet — nothing to lint')
    return 0
  }
  const m = loadManifest()
  const r: Report = { errors: [], warnings: [] }
  // A13
  r.errors.push(...validateManifest(m))
  const entries = selectedEntries(m, opts)
  let frames = 0
  for (const e of entries) {
    checkFrameSet(r, e)
    for (const name of baseFrameNames(e)) {
      if (!existsSync(finalPath(e, name))) {
        const msg = `A09 ${e.id}: missing final ${name}.png`
        if (e.class === 'font') r.warnings.push(`${msg} (run vlr font:build)`)
        else r.errors.push(msg)
        continue
      }
      checkPixels(r, e, name, false)
      frames++
    }
    for (const name of variantFrameNames(e)) {
      if (!existsSync(finalPath(e, name))) {
        r.errors.push(`A06 ${e.id}: missing variant ${name}.png (art:variants)`)
        continue
      }
      checkPixels(r, e, name, name.endsWith(VARIANT_SUFFIX.locked))
      frames++
    }
    // A09 hash
    if (e.finalSha256 !== undefined) {
      const h = frameSetSha256(e)
      if (h !== null && h !== e.finalSha256) {
        r.errors.push(`A09 ${e.id}: finalSha256 does not match the finals`)
      }
    }
  }
  if (opts.ids === null) {
    checkOrphans(r, m)
    checkAtlas(m, r, false)
  }
  // A14
  const checked = opts.args.includes('--no-a14')
    ? 0
    : await checkDeterminism(r, entries)
  // A12 placeholders + stale contact sheets
  const c = manifestCounts(m)
  if (c.placeholders > 0) {
    r.warnings.push(`A12 ${c.placeholders} placeholder sprites in use`)
  }
  try {
    const { contactStaleness } = await import('./gallery.ts')
    for (const w of contactStaleness(m)) r.warnings.push(`A12 ${w}`)
  } catch {
    // gallery module optional
  }
  for (const w of r.warnings) console.warn(`warn ${w}`)
  for (const e of r.errors) console.error(`error ${e}`)
  console.log(
    `lint: ${c.entries} entries, ${frames} frames checked, ${checked} ` +
      `re-drawn (A14), ${c.placeholders} placeholders; ` +
      `${r.errors.length} errors, ${r.warnings.length} warnings`,
  )
  return r.errors.length > 0 ? 1 : 0
}
