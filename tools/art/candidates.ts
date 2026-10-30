// Candidate post-processing for generated (PixelLab) sprites — the
// normalize -> quantize -> outline chain of style-guide.md §3.7 applied to
// downloads, onto the class canvas with the class anchor, without touching
// art/final. Used by gen.ts (and the G2 contact sheets in contact.ts).
//
// Layout (art/candidates/, gitignored):
//   <id>/<n>/raw/<name>.png      every downloaded image, by response name
//                                ('0', 'south-east', 'anim_walk_south_2', …)
//   <id>/<n>/<frame>.png         processed frames: the entry suffix without
//                                its leading '_' ('ne_0', 'f1', 's_walk_0'),
//                                'base' for the single '' suffix
//   <id>/<n>/meta.json           prompt, params, job ids, durable ids
//                                (object_id / character_id), cost, prefilter
//
// Per class:
// - buildings: the sprite (with whatever plot the model drew) is placed so
//   the lowest row's vertex sits on the anchor (W/2-1..W/2, H-1), lifted by
//   (footprint width - sprite width)/4 when narrower so its base is centred
//   in the plot; the exact footprint diamond is painted underneath in the
//   district ground colour and everything outside the diamond in its lower
//   half is cleared (A04); then outline + the §1.2 shadow strip.
// - vehicles: rotations north-east / south-east / south-west / north-west
//   -> _ne / _se / _sw / _nw (tile motion: +x se, +y sw, -x nw, -y ne; the
//   rotation names are screen directions, verified on the van probe); each
//   bbox is aligned to the procedural placeholder's bbox bottom-centre of
//   the same heading (same road-line point); frame _1 = frame _0 with the
//   wheel hubs moved 1 px (hubShift) — the tool has no wheel animation.
// - machines: bbox bottom-centred on the canvas (setOrigin(0.5, 1) on the
//   pad); metal_detector clears its belt opening (x 12..35, rows 16..47,
//   warehouse-view §1.3); _f1 = the header's blue/green light pixels
//   switched to the yellow ramp (scanning).
// - worker: per direction one offset (feet outline on row 29, centred on
//   x 12) shared by the rotation and its animation frames, so frames do
//   not jitter; idle_0 = the idle animation's frame 0 (template frames are
//   drawn ~20 % smaller than the rotation image, so the rotation is only a
//   fallback), idle_1 / walk / scan / jump picked from the template
//   animations; ground shadow rows 30-31 as the placeholder.

import sharp from 'sharp'
import { diamondSpans } from './draw-api.ts'
import {
  type Img,
  bbox,
  blit,
  cloneImg,
  get,
  inside,
  newImg,
  opaque,
  exteriorBaseOk,
  put,
  rgbaToImg,
  stairStepOk,
} from './iso.ts'
import { HEIGHT_BUDGET, type ManifestEntry } from './manifest.ts'
import { entrySubset, nearestIndexFn } from './normalize.ts'
import { outlineFinal } from './outline.ts'
import { quantizeImg } from './quantize.ts'

/** the entry as the pipeline sees an installed generated sprite */
export function asGenerated(e: ManifestEntry): ManifestEntry {
  return { ...e, placeholder: false }
}

/** frame file stem of a suffix ('' -> 'base') */
export function frameStem(suffix: string): string {
  return suffix === '' ? 'base' : suffix.replace(/^_/, '')
}

/**
 * Opaque downloads (a prompt asked for a solid key background so Pro Flash
 * fills a canvas larger than its native 128 px): the background is the
 * colour of the border pixels; it is flood-filled away from the border
 * (tolerance 72 in RGB distance), so a key colour inside the sprite stays.
 * Returns the number of pixels cleared (0 when the image has alpha).
 */
export function keyBackground(
  rgba: Buffer,
  w: number,
  h: number,
  tol = 72,
  out?: { key: number | null },
): number {
  for (let k = 3; k < rgba.length; k += 4)
    if ((rgba[k] as number) < 128) return 0
  const rgb = (k: number) =>
    ((rgba[k] as number) << 16) |
    ((rgba[k + 1] as number) << 8) |
    (rgba[k + 2] as number)
  const cleared = new Uint8Array(w * h)
  const hsv = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const d = mx - mn
    let hue = 0
    if (d > 0) {
      if (mx === r) hue = ((g - b) / d + 6) % 6
      else if (mx === g) hue = (b - r) / d + 2
      else hue = (r - g) / d + 4
    }
    return { h: hue * 60, s: mx ? d / mx : 0, v: mx / 255 }
  }
  const saturated = (c: number) => {
    const q = hsv(c >> 16, (c >> 8) & 255, c & 255)
    return q.s > 0.4 && q.v > 0.45
  }
  const flood = (seeds: number[], key: number, apply = true): number => {
    const kr = key >> 16
    const kg = (key >> 8) & 255
    const kb = key & 255
    // a saturated key also takes its own darker / lighter hue (the model's
    // cast shadows on the key background)
    const kq = hsv(kr, kg, kb)
    const byHue = saturated(key)
    const seen = new Uint8Array(w * h)
    const stack = seeds.slice()
    let n = 0
    while (stack.length) {
      const i = stack.pop() as number
      if (seen[i]) continue
      seen[i] = 1
      const k = i * 4
      const r = rgba[k] as number
      const g = rgba[k + 1] as number
      const b = rgba[k + 2] as number
      const dr = r - kr
      const dg = g - kg
      const db = b - kb
      let hit = dr * dr + dg * dg + db * db < tol * tol
      if (!hit && byHue) {
        // the key's own cast shadows: same hue, darker (never a lighter or
        // neighbouring hue: pink awnings, orange brick)
        const q = hsv(r, g, b)
        const dh = Math.min(Math.abs(q.h - kq.h), 360 - Math.abs(q.h - kq.h))
        hit = dh < 25 && q.s > 0.3 && q.v > 0.2 && q.v <= kq.v + 0.02
      }
      if (!hit) continue
      if (!cleared[i]) {
        n++
        if (apply) {
          cleared[i] = 1
          rgba[k + 3] = 0
        }
      }
      const x = i % w
      const y = (i - x) / w
      if (x > 0) stack.push(i - 1)
      if (x < w - 1) stack.push(i + 1)
      if (y > 0) stack.push(i - w)
      if (y < h - 1) stack.push(i + w)
    }
    return n
  }
  // the dominant colour of a pixel set: bucketed (4 bits per channel, the
  // originals carry +-3 noise), the key = the mean of the top bucket
  const mode = (idx: number[]): [number, number] => {
    const count = new Map<number, number[]>()
    for (const i of idx) {
      const c = rgb(i * 4)
      const bk = ((c >> 20) << 8) | (((c >> 12) & 15) << 4) | ((c >> 4) & 15)
      const slot = count.get(bk)
      if (slot) slot.push(i)
      else count.set(bk, [i])
    }
    const top = [...count.values()].toSorted((a, b) => b.length - a.length)[0]
    if (!top) return [0, 0]
    let r = 0
    let g = 0
    let b = 0
    for (const i of top) {
      r += rgba[i * 4] as number
      g += rgba[i * 4 + 1] as number
      b += rgba[i * 4 + 2] as number
    }
    const n = top.length
    return [
      (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n),
      n,
    ]
  }
  // the means of the k most populated buckets
  const topModes = (idx: number[], k: number): number[] => {
    const count = new Map<number, number[]>()
    for (const i of idx) {
      const c = rgb(i * 4)
      const bk = ((c >> 20) << 8) | (((c >> 12) & 15) << 4) | ((c >> 4) & 15)
      const slot = count.get(bk)
      if (slot) slot.push(i)
      else count.set(bk, [i])
    }
    return [...count.values()]
      .toSorted((a, b) => b.length - a.length)
      .slice(0, k)
      .map((list) => {
        let r = 0
        let g = 0
        let b = 0
        for (const i of list) {
          r += rgba[i * 4] as number
          g += rgba[i * 4 + 1] as number
          b += rgba[i * 4 + 2] as number
        }
        const n = list.length
        return (
          (Math.round(r / n) << 16) |
          (Math.round(g / n) << 8) |
          Math.round(b / n)
        )
      })
  }
  // the key: the dominant saturated colour (Pro Flash paints the key
  // background as a large saturated box, sometimes inside a white pad with
  // a blended seam); else (a plain light background) the border colour
  const all: number[] = []
  for (let i = 0; i < w * h; i++) {
    const c = rgb(i * 4)
    if (saturated(c)) all.push(i)
  }
  // noise splits a big flat region across neighbouring buckets: score the
  // top buckets by how many pixels lie within `tol` of their mean
  const within = (key: number) => {
    const kr = key >> 16
    const kg = (key >> 8) & 255
    const kb = key & 255
    let n = 0
    for (let k = 0; k < rgba.length; k += 4) {
      const dr = (rgba[k] as number) - kr
      const dg = (rgba[k + 1] as number) - kg
      const db = (rgba[k + 2] as number) - kb
      if (dr * dr + dg * dg + db * db < tol * tol) n++
    }
    return n
  }
  let key = 0
  let nKey = 0
  for (const cand of topModes(all, 4)) {
    const n = within(cand)
    if (n > nKey) {
      nKey = n
      key = cand
    }
  }
  let total = 0
  if (out) out.key = nKey > 0.15 * w * h ? key : null
  if (nKey > 0.15 * w * h) {
    const kr = key >> 16
    const kg = (key >> 8) & 255
    const kb = key & 255
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    for (let i = 0; i < w * h; i++) {
      const k = i * 4
      const dr = (rgba[k] as number) - kr
      const dg = (rgba[k + 1] as number) - kg
      const db = (rgba[k + 2] as number) - kb
      if (dr * dr + dg * dg + db * db >= tol * tol) continue
      const x = i % w
      const y = (i - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    // the pad and the seam: everything outside the key box
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue
        const i = y * w + x
        if (!cleared[i]) {
          cleared[i] = 1
          rgba[i * 4 + 3] = 0
          total++
        }
      }
    }
    const seeds: number[] = []
    for (let x = x0; x <= x1; x++) seeds.push(y0 * w + x, y1 * w + x)
    for (let y = y0; y <= y1; y++) seeds.push(y * w + x0, y * w + x1)
    total += flood(seeds, key)
    return total
  }
  const border: number[] = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1)
  total += flood(border, mode(border)[0])
  return total
}

/**
 * True for a key colour the prompts ask for (prompts.ts BG_KEY / the cyan
 * key of pink subjects): a saturated, bright magenta-to-dusty-pink (hue
 * 285°-345°: the model paints "magenta" anywhere from #ff00ff to #cd3e7b) or
 * cyan (165°-205°). Any other detected background (a grey, white or green
 * ground the model chose itself) is only border-flooded, so its colour
 * inside the sprite stays (keyBackground's rule).
 */
export function isRequestedKey(key: number): boolean {
  const r = key >> 16
  const g = (key >> 8) & 255
  const b = key & 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  if (mx < 150 || d / mx < 0.5) return false
  let hue: number
  if (mx === r) hue = (((g - b) / d + 6) % 6) * 60
  else if (mx === g) hue = ((b - r) / d + 2) * 60
  else hue = ((r - g) / d + 4) * 60
  return (hue >= 285 && hue <= 345) || (hue >= 165 && hue <= 205)
}

/**
 * Clear (alpha 0) every opaque pixel within `tol` (RGB distance) of the key
 * colour, connected to the border or not: the enclosed background pockets
 * of a keyed download. Only for a requested key colour (isRequestedKey);
 * otherwise nothing. Returns the number of pixels cleared.
 */
export function clearKeyPockets(
  rgba: Buffer,
  key: number | null,
  tol: number,
): number {
  if (key === null || !isRequestedKey(key)) return 0
  const kr = key >> 16
  const kg = (key >> 8) & 255
  const kb = key & 255
  let n = 0
  for (let k = 0; k < rgba.length; k += 4) {
    if ((rgba[k + 3] as number) < 128) continue
    const dr = (rgba[k] as number) - kr
    const dg = (rgba[k + 1] as number) - kg
    const db = (rgba[k + 2] as number) - kb
    if (dr * dr + dg * dg + db * db < tol * tol) {
      rgba[k + 3] = 0
      n++
    }
  }
  return n
}

/**
 * PNG (any flavour) -> Img snapped into the entry's palette subset. An
 * opaque (key background) download is keyed on its pre-palette original
 * `orig` when given: the original's background is near-uniform (the
 * palette-mapped one lands on pink0, a building colour), so a tight
 * tolerance keeps pink / orange walls; its mask is applied to `png`.
 */
export async function toImg(
  e: ManifestEntry,
  png: Buffer,
  orig?: Buffer,
): Promise<Img> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let keyed = false
  if (orig) {
    const o = await sharp(orig)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (o.info.width === info.width && o.info.height === info.height) {
      const found: { key: number | null } = { key: null }
      if (keyBackground(o.data, info.width, info.height, 30, found) > 0) {
        // key pockets (build 2): background enclosed by the sprite (between
        // a gantry's legs) is not reached by the border flood and used to
        // quantize to pink0; clear every pixel of the key colour
        clearKeyPockets(o.data, found.key, 40)
        for (let k = 3; k < data.length; k += 4) {
          if ((o.data[k] as number) < 128) data[k] = 0
        }
        keyed = true
      }
    }
  }
  if (!keyed) keyBackground(data, info.width, info.height)
  return rgbaToImg(
    data,
    info.width,
    info.height,
    nearestIndexFn(entrySubset(e)),
  ).img
}

function finishImg(e: ManifestEntry, img: Img): Img {
  const g = asGenerated(e)
  return outlineFinal(g, quantizeImg(g, img))
}

/** copy `src` shifted by (dx, dy) into a w x h image; returns lost px */
function shifted(
  src: Img,
  w: number,
  h: number,
  dx: number,
  dy: number,
): { img: Img; lost: number } {
  const out = newImg(w, h)
  let lost = 0
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = src.px[y * src.w + x] as number
      if (i < 0) continue
      const tx = x + dx
      const ty = y + dy
      if (!inside(out, tx, ty)) {
        lost++
        continue
      }
      out.px[ty * w + tx] = i
      out.depth[ty * w + tx] = 0
    }
  }
  return { img: out, lost }
}

// ---------------------------------------------------------------------------
// Buildings

/** plot fill under a generated building (style-guide §4.2 ground patch) */
export function groundFor(e: ManifestEntry): string {
  if (e.id === 'dk_pier') return 'water1'
  switch (e.district) {
    case 'industrial':
    case 'docks':
    case 'airport':
    case 'warehouse':
      return 'grey3'
    case 'civic':
    case 'lowres':
    case 'rural':
      return 'grass2'
    default:
      return 'grey4'
  }
}

export interface Processed {
  frames: Map<string, Img>
  /** pre-filter reason (lint:A0x …) or null */
  reject: string | null
  notes: string[]
}

export function processBuilding(
  e: ManifestEntry,
  src: Img,
  suffix: string = e.frames[0] ?? '',
): Processed {
  const [W, H] = e.canvas
  const fp = e.footprint?.[0] ?? Math.round(W / 64)
  const fw = 64 * fp
  const notes: string[] = []
  const b = bbox(src)
  if (!b) return { frames: new Map(), reject: 'lint:A05 empty', notes }
  const bw = b.x1 - b.x0 + 1
  // the vertex: mean x of the lowest row when it is a vertex (<= 8 px)
  const low: number[] = []
  for (let x = b.x0; x <= b.x1; x++) if (opaque(src, x, b.y1)) low.push(x)
  const vx =
    low.length <= 8
      ? low.reduce((a, x) => a + x, 0) / low.length
      : (b.x0 + b.x1) / 2
  // a full-width sprite whose drawn lot is lopsided (its bottom vertex far
  // from the bbox centre, e.g. the 256-px exterior) is centred by its bbox
  const cx = (b.x0 + b.x1) / 2
  const ax = bw >= fw - 8 && Math.abs(vx - cx) > 4 ? cx : vx
  if (ax !== vx)
    notes.push(
      `lopsided lot: bbox-centred (vertex ${vx - cx > 0 ? '+' : ''}${Math.round(vx - cx)})`,
    )
  const lift = bw < fw - 2 ? Math.round((fw - bw) / 4) : 0
  const dx = Math.round(W / 2 - 0.5 - ax)
  const dy = H - 1 - lift - b.y1
  const out = newImg(W, H)
  // the footprint diamond in the ground colour (bottom vertex on the anchor)
  const spans = diamondSpans(fw)
  const row0 = H - spans.length
  const left = W / 2 - fw / 2
  const g = groundFor(e)
  spans.forEach(([s0, s1], r) => {
    for (let x = s0; x <= s1; x++) put(out, left + x, row0 + r, g, -1)
  })
  const placed = shifted(src, W, H, dx, dy)
  if (placed.lost > 0) notes.push(`${placed.lost} px outside the canvas`)
  blit(out, placed.img)
  // clear everything outside the diamond in its lower half (A04)
  let clipped = 0
  spans.forEach(([s0, s1], r) => {
    if (r < spans.length / 2) return
    const y = row0 + r
    for (let x = 0; x < W; x++) {
      if (x >= left + s0 && x <= left + s1) continue
      if (opaque(out, x, y)) {
        put(out, x, y, null)
        clipped++
      }
    }
  })
  if (clipped > 0) notes.push(`${clipped} px clipped to the plot diamond`)

  notes.push(`sprite ${bw}x${b.y1 - b.y0 + 1}, lift ${lift}, dx ${dx}`)
  if (wantsKeyClass(e)) {
    const dropped = dropFragments(out, 0.04)
    if (dropped > 0) notes.push(`${dropped} px detached fragments dropped`)
  }
  const img = finishImg(e, out)
  return { frames: new Map([[suffix, img]]), reject: prefilter(e, img), notes }
}

/**
 * warehouse-ext (build 2, B2 §6.1): no ground patch. The walls' bottom
 * vertex goes on the anchor (W/2-1..W/2, H-1), lifted by (256 - sprite
 * width)/4 rows when narrower so the base is centred in the 4x4 diamond
 * (the slab tiles show in the rim); everything outside the diamond's
 * columns or below its lower edges is cleared (A04 strict); no ground
 * diamond is painted underneath and no shadow strip is drawn.
 */
export function processExterior(
  e: ManifestEntry,
  src: Img,
  suffix: string = e.frames[0] ?? '',
): Processed {
  const [W, H] = e.canvas
  const fw = 64 * (e.footprint?.[0] ?? 4)
  const notes: string[] = []
  const b = bbox(src)
  if (!b) return { frames: new Map(), reject: 'lint:A05 empty', notes }
  const bw = b.x1 - b.x0 + 1
  const low: number[] = []
  for (let x = b.x0; x <= b.x1; x++) if (opaque(src, x, b.y1)) low.push(x)
  const vx =
    low.length <= 8
      ? low.reduce((a, x) => a + x, 0) / low.length
      : (b.x0 + b.x1) / 2
  const cx = (b.x0 + b.x1) / 2
  // a vertex far from the bbox centre: the model's base is lopsided (or a
  // stray drawn lot); centre by the bbox
  const ax = Math.abs(vx - cx) > 6 ? cx : vx
  if (ax !== vx) {
    notes.push(`lopsided base: bbox-centred (vertex ${Math.round(vx - cx)})`)
  }
  const lift = bw < fw ? Math.ceil((fw - bw) / 4) : 0
  const dx = Math.round(W / 2 - 0.5 - ax)
  const dy = H - 1 - lift - b.y1
  const placed = shifted(src, W, H, dx, dy)
  if (placed.lost > 0) notes.push(`${placed.lost} px outside the canvas`)
  const out = placed.img
  const spans = diamondSpans(fw)
  const row0 = H - spans.length
  const left = W / 2 - fw / 2
  let clipped = 0
  for (let y = 0; y < H; y++) {
    const r = y - row0
    const span = r >= spans.length / 2 ? spans[r] : undefined
    for (let x = 0; x < W; x++) {
      if (!opaque(out, x, y)) continue
      const outCols = x < left || x > left + fw - 1
      const below =
        span !== undefined && (x < left + span[0] || x > left + span[1])
      if (outCols || below) {
        put(out, x, y, null)
        clipped++
      }
    }
  }
  if (clipped > 0) notes.push(`${clipped} px clipped to the footprint prism`)
  notes.push(`sprite ${bw}x${b.y1 - b.y0 + 1}, inset ${lift} rows, dx ${dx}`)
  const dropped = dropFragments(out, 0.04)
  if (dropped > 0) notes.push(`${dropped} px detached fragments dropped`)
  const img = finishImg(e, out)
  return { frames: new Map([[suffix, img]]), reject: prefilter(e, img), notes }
}

/** keyed (solid-background) classes: key seams / puffs can be left over */
function wantsKeyClass(e: ManifestEntry): boolean {
  return e.canvas[0] > 160
}

/**
 * Drop opaque 4-connected components smaller than `frac` of the largest
 * one (a key-box seam line, a detached smoke puff); returns pixels cleared.
 */
export function dropFragments(img: Img, frac: number): number {
  const W = img.w
  const comp = new Int32Array(W * img.h).fill(-1)
  const sizes: number[] = []
  for (let i = 0; i < comp.length; i++) {
    if ((img.px[i] as number) < 0 || comp[i] !== -1) continue
    const id = sizes.length
    let n = 0
    const stack = [i]
    comp[i] = id
    while (stack.length) {
      const k = stack.pop() as number
      n++
      const x = k % W
      for (const j of [
        x > 0 ? k - 1 : -1,
        x < W - 1 ? k + 1 : -1,
        k - W,
        k + W,
      ]) {
        if (
          j < 0 ||
          j >= comp.length ||
          comp[j] !== -1 ||
          (img.px[j] as number) < 0
        )
          continue
        comp[j] = id
        stack.push(j)
      }
    }
    sizes.push(n)
  }
  const big = Math.max(0, ...sizes)
  let cleared = 0
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i] as number
    if (c >= 0 && (sizes[c] as number) < frac * big) {
      img.px[i] = -1
      img.depth[i] = Number.NEGATIVE_INFINITY
      cleared++
    }
  }
  return cleared
}

/**
 * Chimney mouths of a building sprite, for smokeAnchors: the k highest
 * peaks of the skyline (topmost opaque pixel per column), at least `gap`
 * px apart; each anchor = the centre of the peak's top run, one row above.
 */
export function skylinePeaks(
  img: Img,
  k: number,
  gap = 10,
): [number, number][] {
  const top: number[] = []
  for (let x = 0; x < img.w; x++) {
    let t = img.h
    for (let y = 0; y < img.h; y++) {
      if (opaque(img, x, y)) {
        t = y
        break
      }
    }
    top.push(t)
  }
  const order = [...top.keys()].toSorted(
    (a, b) => (top[a] as number) - (top[b] as number),
  )
  const peaks: [number, number][] = []
  for (const x of order) {
    if (peaks.length >= k) break
    const t = top[x] as number
    if (t >= img.h) break
    // the run of columns at (about) this height
    let x0 = x
    let x1 = x
    while (x0 > 0 && (top[x0 - 1] as number) <= t + 1) x0--
    while (x1 < img.w - 1 && (top[x1 + 1] as number) <= t + 1) x1++
    const cx = Math.round((x0 + x1) / 2)
    // a column on the flank of a peak already taken is not a new peak
    if (peaks.some(([px]) => Math.abs(px - cx) < gap || Math.abs(px - x) < gap))
      continue
    peaks.push([cx, t])
  }
  return peaks.toSorted((a, b) => a[0] - b[0])
}

// ---------------------------------------------------------------------------
// Props (no ground patch) and the dock prop

/**
 * prop (64x128): the object stands on the tile centre (W/2, H-16) — the
 * lowest row's centre goes to x W/2-1..W/2, its bottom to row H-14 (a trunk
 * or crane foot reaches just in front of the centre, as the placeholders).
 * dock-prop (128x96, 2x2 footprint rule): the hull is centred on the
 * footprint centre (W/2, H-32), its bbox bottom at row H-16.
 */
export function processProp(e: ManifestEntry, src: Img): Processed {
  const [W, H] = e.canvas
  const notes: string[] = []
  const b = bbox(src)
  if (!b) return { frames: new Map(), reject: 'lint:A05 empty', notes }
  let dx: number
  let dy: number
  if (e.class === 'dock-prop') {
    dx = Math.round(W / 2 - (b.x0 + b.x1 + 1) / 2)
    dy = H - 16 - b.y1
  } else {
    const low: number[] = []
    for (let x = b.x0; x <= b.x1; x++) if (opaque(src, x, b.y1)) low.push(x)
    const ax = low.reduce((a, x) => a + x, 0) / low.length
    dx = Math.round(W / 2 - 0.5 - ax)
    dy = H - 14 - b.y1
  }
  const placed = shifted(src, W, H, dx, dy)
  if (placed.lost > 0) notes.push(`${placed.lost} px outside the canvas`)
  notes.push(`sprite ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}, dx ${dx}, dy ${dy}`)
  const img = finishImg(e, placed.img)
  return {
    frames: new Map([[e.frames[0] ?? '', img]]),
    reject:
      placed.lost > 40 ? 'lint:A05 clipped by the canvas' : prefilter(e, img),
    notes,
  }
}

// ---------------------------------------------------------------------------
// Shelf (fixture-shelf 224x64): fills its 7x2-cell canvas

/**
 * Stretch a periodic fixture to the canvas without scaling: repeat its
 * centre column until it spans W (and the row at 60 % height until it
 * spans H), then place it at (0, 0). Shelves are boards and uprights, so
 * repeating a board column or row reads the same.
 */
export function stretchTo(
  src: Img,
  W: number,
  H: number,
  notes: string[],
): Img {
  const b = bbox(src)
  if (!b) return src
  // crop
  let img = newImg(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1)
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      img.px[(y - b.y0) * img.w + (x - b.x0)] = src.px[y * src.w + x] as number
    }
  }
  const remap = (
    w: number,
    h: number,
    fx: (x: number) => number,
    fy: (y: number) => number,
  ) => {
    const out = newImg(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++)
        out.px[y * w + x] = img.px[fy(y) * img.w + fx(x)] as number
    }
    return out
  }
  // the repeat column: inside the middle 60 %, the one most like its right
  // neighbour and with the fewest dark (upright / outline) pixels — a board
  const DARKS = new Set(['outline', 'grey0', 'grey1'])
  const colCost = (x: number) => {
    let diff = 0
    let dark = 0
    for (let y = 0; y < img.h; y++) {
      const c = img.px[y * img.w + x] as number
      if (c !== (img.px[y * img.w + Math.min(img.w - 1, x + 1)] as number))
        diff++
      const id = get(img, x, y)
      if (id && DARKS.has(id)) dark++
    }
    return diff + 3 * Math.max(0, dark - 4)
  }
  let c = Math.floor(img.w / 2)
  let best = Number.POSITIVE_INFINITY
  for (let x = Math.floor(img.w * 0.2); x <= Math.floor(img.w * 0.8); x++) {
    const k = colCost(x)
    if (k < best) {
      best = k
      c = x
    }
  }
  if (img.w < W) {
    const add = W - img.w
    notes.push(`stretch: +${add} columns at x ${c}`)
    img = remap(
      W,
      img.h,
      (x) => (x <= c ? x : x <= c + add ? c : x - add),
      (y) => y,
    )
  } else if (img.w > W) {
    const cut = img.w - W
    notes.push(`shrink: -${cut} columns at x ${c}`)
    img = remap(
      W,
      img.h,
      (x) => (x < c ? x : x + cut),
      (y) => y,
    )
  }
  // rows are never repeated (boards would change pitch): bottom-align
  const out = newImg(W, H)
  const dy = H - img.h
  if (dy < 0) notes.push(`${-dy} rows cut at the top`)
  for (let y = 0; y < img.h; y++) {
    const ty = y + dy
    if (ty < 0 || ty >= H) continue
    for (let x = 0; x < W; x++) out.px[ty * W + x] = img.px[y * W + x] as number
  }
  for (let k = 0; k < out.px.length; k++)
    if ((out.px[k] as number) >= 0) out.depth[k] = 0
  return out
}

export function processShelf(e: ManifestEntry, src: Img): Processed {
  const [W, H] = e.canvas
  const notes: string[] = []
  const b = bbox(src)
  if (!b) return { frames: new Map(), reject: 'lint:A05 empty', notes }
  notes.push(`sprite ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}`)
  const img = finishImg(e, stretchTo(src, W, H, notes))
  return {
    frames: new Map([[e.frames[0] ?? '', img]]),
    reject: prefilter(e, img),
    notes,
  }
}

// ---------------------------------------------------------------------------
// Vehicles

export const HEADING_ROTATION: Record<string, string> = {
  ne: 'north-east',
  se: 'south-east',
  sw: 'south-west',
  nw: 'north-west',
}

const DARK = new Set(['outline', 'grey0'])
const HUB = new Set(['grey1', 'grey2', 'grey3', 'grey4', 'grey5'])

/**
 * Wheel frame 1: hub pixels (light grey inside a dark tyre, in the lowest
 * 5 rows) swap with the tyre pixel 1 px further along the heading's
 * screen x direction. Returns the image and the number of hubs moved.
 */
export function hubShift(
  img: Img,
  heading: string,
): { img: Img; moved: number } {
  const b = bbox(img)
  if (!b) return { img, moved: 0 }
  const out = cloneImg(img)
  const dir = heading === 'ne' || heading === 'se' ? 1 : -1
  let moved = 0
  for (let y = Math.max(b.y0, b.y1 - 4); y <= b.y1; y++) {
    const xs =
      dir > 0 ? [...Array(img.w).keys()].toReversed() : [...Array(img.w).keys()]
    for (const x of xs) {
      const c = get(img, x, y)
      if (!c || !HUB.has(c)) continue
      const n = [
        get(img, x - 1, y),
        get(img, x + 1, y),
        get(img, x, y - 1),
        get(img, x, y + 1),
      ]
      const dark = n.filter((v) => v && DARK.has(v)).length
      if (dark < 2) continue
      const t = get(out, x + dir, y)
      if (!t || !DARK.has(t)) continue
      // never move a hub onto the silhouette edge (A10 outline continuity)
      const tx = x + dir
      if (
        !opaque(out, tx - 1, y) ||
        !opaque(out, tx + 1, y) ||
        !opaque(out, tx, y - 1) ||
        !opaque(out, tx, y + 1)
      ) {
        continue
      }
      put(out, x + dir, y, c)
      put(out, x, y, t)
      moved++
    }
  }
  return { img: out, moved }
}

export function processVehicle(
  e: ManifestEntry,
  rotations: Map<string, Img>,
  placeholder: Map<string, Img>,
): Processed {
  const [W, H] = e.canvas
  const frames = new Map<string, Img>()
  const notes: string[] = []
  let reject: string | null = null
  // response names vary by tool ('south-east', 'south_east', 'SE', …)
  const norm = new Map<string, Img>()
  const ABBR: Record<string, string> = {
    ne: 'north-east',
    se: 'south-east',
    sw: 'south-west',
    nw: 'north-west',
  }
  for (const [k, v] of rotations) {
    const n = k.toLowerCase().replace(/[_\s]+/g, '-')
    norm.set(ABBR[n] ?? n, v)
  }
  for (const h of ['ne', 'se', 'sw', 'nw']) {
    const rot = norm.get(HEADING_ROTATION[h] as string)
    if (!rot) {
      reject ??= `lint:A06 no ${HEADING_ROTATION[h]} rotation`
      continue
    }
    const b = bbox(rot)
    if (!b) {
      reject ??= `lint:A05 empty ${h}`
      continue
    }
    const ph = placeholder.get(`_${h}_0`)
    const pb = ph ? bbox(ph) : null
    const cx = pb ? (pb.x0 + pb.x1 + 1) / 2 : W / 2
    const by = pb ? pb.y1 : H - 4
    let dx = Math.round(cx - (b.x0 + b.x1 + 1) / 2)
    let dy = by - b.y1
    // keep the 1-px margin (A05) when the sprite allows it
    dx = Math.max(1 - b.x0, Math.min(W - 2 - b.x1, dx))
    dy = Math.max(1 - b.y0, Math.min(H - 2 - b.y1, dy))
    const placed = shifted(rot, W, H, dx, dy)
    if (placed.lost > 0) notes.push(`${h}: ${placed.lost} px lost`)
    const f0 = finishImg(e, placed.img)
    const { img: f1, moved } = hubShift(f0, h)
    notes.push(`${h}: ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}, hubs ${moved}`)
    frames.set(`_${h}_0`, f0)
    frames.set(`_${h}_1`, f1)
  }
  for (const [s, img] of frames) {
    reject ??= prefilter({ ...e, frames: [s] }, img)
  }
  return { frames, reject, notes }
}

// ---------------------------------------------------------------------------
// Machines / fixtures

/** belt openings (warehouse-view §1.3): [x0, x1, y0] transparent below y0 */
export const OPENINGS: Record<string, [number, number, number]> = {
  metal_detector: [12, 35, 16],
  shaky_shaker: [12, 35, 16],
  // build 2 (plan-build2 §6 Machines): the L3/L4 slot checkers straddle the
  // belt like the detector (warehouse-view §1.3 / §2.3)
  battery_checker: [12, 35, 16],
  xray: [12, 35, 16],
}

/** machines whose extra frames shake the sprite ±1 px (placeholder rule) */
export const SHAKE_IDS = new Set(['shaky_shaker'])

/**
 * fixtures whose extra frames swing the upper part (build 2: the Sorter Arm,
 * B2 §2.6): _f0 rest = the generated image, _f1 leans its upper ~60 %
 * toward -x (reach for the rack), _f2 toward +x (toss to the bin) — a row
 * shear growing to SWING_PX at the top, 0 at the pivot row, so the
 * pedestal stays put; no extra generation (scripted like the worker's scan
 * pose).
 */
export const SWING_IDS = new Set(['sorter_arm'])
export const SWING_PX = 3

/**
 * Shear the rows above `pivot` by up to `d` px at the sprite's top row
 * (linear, 0 at the pivot): a cheap swing that keeps the base fixed.
 * Pixels pushed off the canvas are dropped.
 */
export function lean(img: Img, pivot: number, d: number): Img {
  const b = bbox(img)
  const out = newImg(img.w, img.h)
  if (!b) return out
  const span = Math.max(1, pivot - b.y0)
  for (let y = 0; y < img.h; y++) {
    const s = y >= pivot ? 0 : Math.round((d * (pivot - y)) / span)
    for (let x = 0; x < img.w; x++) {
      const i = img.px[y * img.w + x] as number
      if (i < 0) continue
      const tx = x + s
      if (tx < 0 || tx >= img.w) continue
      out.px[y * img.w + tx] = i
      out.depth[y * img.w + tx] = 0
    }
  }
  return out
}

/** light-strip colours: idle (f0) = blue, scanning (f1) = yellow */
const STRIP_RAMPS = new Set(['blue', 'yellow', 'grass', 'leaf', 'orange'])
const STEP_OF: Record<string, number> = {}
for (const [ramp, ids] of Object.entries({
  blue: ['blue0', 'blue1', 'blue2'],
  yellow: ['yellow0', 'yellow1', 'yellow2', 'yellow3'],
  grass: ['grass0', 'grass1', 'grass2', 'grass3'],
  leaf: ['leaf0', 'leaf1', 'leaf2'],
  orange: ['orange0', 'orange1', 'orange2', 'orange3'],
})) {
  ids.forEach((id, i) => {
    // normalised brightness 0..1 of the step within its ramp
    STEP_OF[id] = ids.length === 1 ? 1 : i / (ids.length - 1)
  })
  void ramp
}
const IDLE = ['blue0', 'blue1', 'blue2']
const SCAN = ['yellow1', 'yellow2', 'yellow3']

function recolourStrip(img: Img, top: number, to: string[]): number {
  let n = 0
  for (let y = 0; y < top; y++) {
    for (let x = 0; x < img.w; x++) {
      const c = get(img, x, y)
      if (!c || c === 'outline') continue
      const ramp = c.replace(/\d+$/, '')
      if (!STRIP_RAMPS.has(ramp)) continue
      const t = to[Math.round((STEP_OF[c] ?? 0.5) * (to.length - 1))] as string
      if (t !== c) put(img, x, y, t)
      n++
    }
  }
  return n
}

/**
 * Fit a gate/arch sprite (bottom-aligned on the canvas) to a belt opening
 * [x0, x1, y0] without scaling: split at the opening's centre column, move
 * the posts so their inner edges sit at x0-1 / x1+1 and repeat the centre
 * column across the gap (the crossbar grows); when the crossbar reaches
 * below y0, repeat one post row so the crossbar rises above y0. Returns
 * null when the sprite has no recognisable opening or cannot fit.
 */
export function fitOpening(
  src: Img,
  open: [number, number, number],
  notes: string[],
): Img | null {
  const [x0, x1, y0] = open
  const b = bbox(src)
  if (!b) return null
  const probe = b.y1 - 2
  const mid = Math.round((b.x0 + b.x1) / 2)
  // inner edges of the posts on a row near the bottom
  let xl = -1
  let xr = -1
  for (let x = mid; x >= b.x0; x--)
    if (opaque(src, x, probe)) {
      xl = x
      break
    }
  for (let x = mid; x <= b.x1; x++)
    if (opaque(src, x, probe)) {
      xr = x
      break
    }
  if (xl < 0 || xr < 0 || xr - xl < 3) {
    notes.push('fit: no opening found')
    return null
  }
  const c = Math.floor((xl + xr) / 2)
  // crossbar bottom: lowest opaque row of the centre column
  let hb = -1
  for (let y = b.y1; y >= b.y0; y--)
    if (opaque(src, c, y)) {
      hb = y
      break
    }
  if (hb < 0) {
    notes.push('fit: no crossbar over the opening')
    return null
  }
  const dl = x0 - 1 - xl
  const dr = x1 + 1 - xr
  if (dl > 0 || dr < 0) {
    notes.push(`fit: opening wider than the contract (${xl}..${xr})`)
  }
  const W = src.w
  const H = src.h
  const wide = newImg(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = src.px[y * W + x] as number
      if (i < 0) continue
      const tx = x <= c ? x + dl : x + dr
      if (tx >= 0 && tx < W) wide.px[y * W + tx] = i
    }
    // the gap left by the split: repeat the centre column
    const ic = src.px[y * W + c] as number
    if (ic >= 0) {
      for (let tx = c + dl + 1; tx < c + 1 + dr; tx++) {
        if (tx >= 0 && tx < W && (wide.px[y * W + tx] as number) < 0) {
          wide.px[y * W + tx] = ic
        }
      }
    }
  }
  // raise the crossbar above y0 by repeating a post row
  const k = hb - (y0 - 1)
  let out = wide
  if (k > 0) {
    const rowR = Math.min(
      b.y1 - 1,
      hb + Math.max(1, Math.floor((b.y1 - hb) / 2)),
    )
    if (b.y0 - k < 0) {
      notes.push(`fit: crossbar at row ${hb} cannot rise ${k} px`)
      return null
    }
    out = newImg(W, H)
    for (let y = 0; y < H; y++) {
      const sy = y < rowR - k ? y + k : y <= rowR ? rowR : y
      for (let x = 0; x < W; x++) {
        out.px[y * W + x] = wide.px[sy * W + x] as number
      }
    }
  }
  for (let k2 = 0; k2 < out.px.length; k2++) {
    if ((out.px[k2] as number) >= 0) out.depth[k2] = 0
  }
  notes.push(
    `fit: posts ${xl}/${xr} -> ${x0 - 1}/${x1 + 1}, crossbar ${hb}` +
      (k > 0 ? ` raised ${k}` : ''),
  )
  return out
}

export function processMachine(e: ManifestEntry, src: Img): Processed {
  const [W, H] = e.canvas
  const notes: string[] = []
  const b = bbox(src)
  if (!b) return { frames: new Map(), reject: 'lint:A05 empty', notes }
  const dx = Math.floor((W - (b.x1 - b.x0 + 1)) / 2) - b.x0
  const dy = H - 1 - b.y1
  const placed = shifted(src, W, H, dx, dy)
  if (placed.lost > 0) notes.push(`${placed.lost} px outside the canvas`)
  let base = placed.img
  let reject: string | null = null
  const open = OPENINGS[e.id]
  if (open) {
    const fit = fitOpening(base, open, notes)
    if (fit) base = fit
    else reject = 'contract: belt opening (warehouse-view §1.3)'
    // anything still inside the opening (glow, a drawn conveyor) goes
    let cleared = 0
    const [x0, x1, y0] = open
    for (let y = y0; y < H; y++) {
      for (let x = x0; x <= x1; x++) {
        if (opaque(base, x, y)) {
          put(base, x, y, null)
          cleared++
        }
      }
    }
    if (cleared) notes.push(`opening: ${cleared} px cleared`)
  }
  const top = open ? open[2] : Math.floor(H / 3)
  const f0 = finishImg(e, base)
  const frames = new Map<string, Img>()
  if (SWING_IDS.has(e.id)) {
    // _f0 rest, _f1 lean -x, _f2 lean +x (re-outlined: the shear exposes
    // inner pixels on the silhouette's steps)
    const bb = bbox(f0)
    const pivot = bb ? bb.y0 + Math.round(0.6 * (bb.y1 - bb.y0)) : H
    const room = bb ? Math.min(SWING_PX, bb.x0, W - 1 - bb.x1) : 0
    e.frames.forEach((s, i) => {
      const d = [0, -room, room][i] ?? 0
      frames.set(s, d === 0 ? f0 : finishImg(e, lean(f0, pivot, d)))
    })
    notes.push(`swing: pivot row ${pivot}, f1 -${room} px, f2 +${room} px`)
  } else if (SHAKE_IDS.has(e.id)) {
    // _f0 idle, _f1 shake left, _f2 shake right (whole sprite, 1 px)
    const shake = [0, -1, 1]
    e.frames.forEach((s, i) => {
      const d = shake[i] ?? 0
      frames.set(s, d === 0 ? f0 : shifted(f0, W, H, d, 0).img)
    })
    notes.push('shake: f1 -1 px, f2 +1 px')
  } else if (e.frames.length > 1) {
    const idle = cloneImg(f0)
    const lit = recolourStrip(idle, top, IDLE)
    const scan = cloneImg(f0)
    recolourStrip(scan, top, SCAN)
    notes.push(`strip: ${lit} px (f0 blue, f1 yellow)`)
    frames.set(e.frames[0] as string, idle)
    for (const s of e.frames.slice(1)) frames.set(s, scan)
  } else frames.set(e.frames[0] as string, f0)
  return { frames, reject: reject ?? prefilter(e, f0), notes }
}

// ---------------------------------------------------------------------------
// Worker

export const WORKER_DIR: Record<string, string> = {
  s: 'south',
  n: 'north',
  e: 'east',
  w: 'west',
}

/** which template frames become which worker frames */
export const WORKER_PICK: Record<string, [string, number][]> = {
  idle: [['idle_1', 2]],
  walk: [
    ['walk_0', 1],
    ['walk_1', 3],
  ],
  scan: [
    ['scan_0', 1],
    ['scan_1', 3],
  ],
}

/**
 * Worker ids whose scan frames are scripted edits of the idle frames
 * (build 2, report §6.24): PixelLab's picking-up template bent the
 * inspector behind the desk, so scan_k = idle_k with the forearm raised to
 * chest height holding a handheld scanner (east / west: held out front
 * towards the belt; south: held in both hands at the chest; north: the
 * back view, unchanged). Frame 1 bobs the scanner up 1 px and turns its
 * lamp from yellow to red (the beep). Same height as idle: never below
 * the desk.
 */
export const SCAN_FROM_IDLE = new Set(['worker'])

/** the scripted scan pose of one idle frame (see SCAN_FROM_IDLE) */
export function scanPose(idle: Img, dir: string, k: number): Img {
  const out = cloneImg(idle)
  if (dir === 'n') return out
  const lamp = k === 1 ? 'red1' : 'yellow3'
  const bob = k === 1 ? -1 : 0
  const added: [number, number][] = []
  const paint = (x: number, y: number, c: string) => {
    if (!inside(out, x, y)) return
    put(out, x, y, c)
    added.push([x, y])
  }
  if (dir === 's') {
    // both hands at the chest holding the scanner, a ring of outline round
    // the device so it reads against the vest
    const y0 = 15 + bob
    for (let x = 9; x <= 14; x++) {
      put(out, x, y0 - 1, 'outline')
      put(out, x, y0 + 2, 'outline')
    }
    paint(9, y0, 'skin0')
    paint(9, y0 + 1, 'skin0')
    paint(14, y0, 'skin0')
    paint(14, y0 + 1, 'skin0')
    for (let x = 10; x <= 13; x++) {
      paint(x, y0, 'grey2')
      paint(x, y0 + 1, 'grey1')
    }
    paint(11, y0, lamp)
    paint(12, y0, lamp)
  } else {
    // east / west: the front edge of the torso (rows 14-16), the forearm
    // out from it, the hand, the scanner gun (grip + head) and its lamp
    const sgn = dir === 'e' ? 1 : -1
    let front = sgn > 0 ? -1 : out.w
    for (let y = 14; y <= 16; y++) {
      for (let x = 0; x < out.w; x++) {
        if (!opaque(idle, x, y)) continue
        front = sgn > 0 ? Math.max(front, x) : Math.min(front, x)
      }
    }
    const at = (d: number) => front + sgn * d
    const y = 15 + bob
    for (let d = -1; d <= 2; d++) {
      paint(at(d), y, 'grey4')
      paint(at(d), y + 1, 'grey3')
    }
    paint(at(3), y, 'skin0')
    paint(at(3), y + 1, 'skin0')
    paint(at(4), y, 'grey1')
    paint(at(4), y + 1, 'grey1')
    for (let d = 4; d <= 7; d++) {
      paint(at(d), y - 2, 'grey2')
      paint(at(d), y - 1, 'grey1')
    }
    paint(at(7), y - 1, lamp)
  }
  // outward outline round the new pixels (transparent 4-neighbours)
  for (const [x, y] of added) {
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (inside(out, nx, ny) && !opaque(out, nx, ny)) {
        put(out, nx, ny, 'outline')
      }
    }
  }
  return out
}

export function processWorker(
  e: ManifestEntry,
  rotations: Map<string, Img>,
  anims: Map<string, Map<string, Img[]>>,
): Processed {
  const [W, H] = e.canvas
  const notes: string[] = []
  const frames = new Map<string, Img>()
  let reject: string | null = null
  // the ground shadow goes under the figure (walk strides may reach it)
  const shadow = (img: Img) => {
    const dot = (x: number, y: number) => {
      if (!opaque(img, x, y)) put(img, x, y, 'outline')
    }
    for (let x = 8; x <= 15; x++) dot(x, 30)
    for (let x = 9; x <= 14; x++) dot(x, 31)
    return img
  }
  for (const [d, rotName] of Object.entries(WORKER_DIR)) {
    // template animations render the figure ~20 % smaller than the
    // character's rotation image, so the idle animation's first frame is
    // the base pose (all frames then share one scale); the rotation is the
    // fallback when no idle animation exists
    const idle0 = anims.get('idle')?.get(rotName)?.[0]
    const rot = idle0 ?? rotations.get(rotName)
    const rb = rot ? bbox(rot) : null
    if (!rot || !rb) {
      reject ??= `lint:A06 no ${rotName} rotation`
      continue
    }
    if (!idle0) notes.push(`${d}: idle_0 from the rotation (no idle animation)`)
    const dx = Math.floor((W - (rb.x1 - rb.x0 + 1)) / 2) - rb.x0
    const dy = 29 - rb.y1
    const lostBy: string[] = []
    const place = (src: Img, name = '') => {
      // shared offset, nudged into the canvas when the frame fits (a jump
      // apex or a cap brim would otherwise be cut)
      const fb = bbox(src)
      let fx = dx
      let fy = dy
      if (fb) {
        if (fb.x1 - fb.x0 + 1 <= W)
          fx = Math.max(-fb.x0, Math.min(W - 1 - fb.x1, fx))
        if (fb.y1 - fb.y0 + 1 <= H)
          fy = Math.max(-fb.y0, Math.min(H - 1 - fb.y1, fy))
      }
      const p = shifted(src, W, H, fx, fy)
      if (p.lost) lostBy.push(`${name} ${p.lost}`)
      return shadow(finishImg(e, p.img))
    }
    frames.set(`_${d}_idle_0`, place(rot, 'idle_0'))
    for (const [key, picks] of Object.entries(WORKER_PICK)) {
      const list = anims.get(key)?.get(rotName) ?? []
      for (const [name, k] of picks) {
        const src = list[k] ?? list[list.length - 1] ?? rot
        if (!list[k]) notes.push(`${d}_${name}: no ${key} frame ${k}`)
        frames.set(`_${d}_${name}`, place(src, name))
      }
    }
    // jump: the frame whose feet are highest (apex)
    const jumps = anims.get('jump')?.get(rotName) ?? []
    let apex: Img = rot
    let best = rb.y1
    for (const f of jumps) {
      const fb = bbox(f)
      if (fb && fb.y1 < best) {
        best = fb.y1
        apex = f
      }
    }
    if (apex === rot) notes.push(`${d}_jump: no airborne frame`)
    frames.set(`_${d}_jump`, place(apex, 'jump'))
    if (lostBy.length) notes.push(`${d} clipped: ${lostBy.join(', ')}`)
  }
  if (SCAN_FROM_IDLE.has(e.id)) {
    for (const d of Object.keys(WORKER_DIR)) {
      for (const k of [0, 1]) {
        const idle = frames.get(`_${d}_idle_${k}`)
        if (idle) frames.set(`_${d}_scan_${k}`, scanPose(idle, d, k))
      }
    }
    notes.push('scan: scripted from idle (SCAN_FROM_IDLE)')
  }
  for (const s of e.frames) {
    if (!frames.has(s)) reject ??= `lint:A06 missing ${s}`
  }
  return { frames, reject, notes }
}

// ---------------------------------------------------------------------------
// Pre-filter (style-guide §3.5: A02-A05 on the normalized candidate)

export function prefilter(e: ManifestEntry, img: Img | null): string | null {
  if (!img) return 'lint:A03'
  const [W, H] = e.canvas
  if (img.w !== W || img.h !== H) return 'lint:A03'
  const b = bbox(img)
  if (!b) return 'lint:A05 empty'
  if (e.class === 'warehouse-ext') {
    const fp = e.footprint?.[0] ?? Math.round(W / 64)
    const p = exteriorBaseOk(img, 64 * fp)
    if (p.length) return `lint:A04 ${p[0]}`
  }
  if (e.class.startsWith('building')) {
    const fp = e.footprint?.[0] ?? Math.round(W / 64)
    const p = stairStepOk(img, 64 * fp)
    if (p.length) return `lint:A04 ${p[0]}`
    const budget = HEIGHT_BUDGET[e.class]
    if (budget !== undefined && b.y0 < H - 32 * fp - budget) {
      return 'lint:A05 above the height budget'
    }
  }
  if (e.class.startsWith('vehicle-')) {
    if (b.x0 < 1 || b.y0 < 1 || b.x1 > W - 2 || b.y1 > H - 2) {
      return 'lint:A05 touches the 1-px margin'
    }
  }
  return null
}
