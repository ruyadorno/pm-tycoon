// `vlr art:normalize` (style-guide.md §3.7): force RGBA, alpha threshold
// 128 -> 0/255, trim, pad to the class canvas and place the sprite: city
// classes put the footprint diamond's bottom vertex on the anchor pixel
// (W/2-1..W/2, H-1); vehicles, icons and interior sprites centre their
// bounding box. A final already on its class canvas passes through: the
// procedural drawers place their own art, and installed PixelLab finals are
// copies of processed candidates that candidates.ts already fitted to the
// class contract (vehicle wheels on the per-heading road line, the worker's
// feet on row 29 and its jump lift, the machines' 24-px belt opening and the
// shaker's ±1-px frames, props standing on their tile) — re-centring their
// bbox here would undo exactly that. Only a mis-sized final is re-placed.
// Also hosts the helpers shared by the other passes (entry selection,
// nearest-colour index, per-frame read/process/write with finalSha256
// upkeep).

import { existsSync } from 'node:fs'
import type { StepOpts } from './draw-api.ts'
import {
  type Img,
  bbox,
  blit,
  encodeImg,
  newImg,
  readImg,
  rgbaToImg,
  writeIfChanged,
} from './iso.ts'
import {
  type Manifest,
  type ManifestEntry,
  CITY_CLASSES,
  baseFrameNames,
  finalPath,
  frameSetSha256,
  loadManifest,
  saveManifest,
} from './manifest.ts'
import { PALETTE, type PaletteColor, nearest, subsetFor } from './palette.ts'

// ---------------------------------------------------------------------------
// Shared helpers

export function selectedEntries(
  m: Manifest,
  opts: Pick<StepOpts, 'ids'>,
): ManifestEntry[] {
  return m.entries.filter((e) => opts.ids === null || opts.ids.includes(e.id))
}

const PAL_INDEX = new Map(PALETTE.colors.map((c, i) => [c.id, i]))

/** (r, g, b) -> palette index of the nearest colour of `subset` */
export function nearestIndexFn(
  subset: readonly PaletteColor[],
): (r: number, g: number, b: number) => number {
  const cache = new Map<number, number>()
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b
    let i = cache.get(key)
    if (i === undefined) {
      i = PAL_INDEX.get(nearest([r, g, b], subset).id) as number
      cache.set(key, i)
    }
    return i
  }
}

export function entrySubset(e: ManifestEntry): PaletteColor[] {
  return subsetFor(e.class, { district: e.district })
}

/** generated (non-placeholder PixelLab) art: geometry gets normalized */
export function isGenerated(e: ManifestEntry): boolean {
  return e.source === 'pixellab' && !e.placeholder
}

export interface PassStats {
  frames: number
  written: number
  entries: Set<string>
}

/**
 * Run `fn` over every base frame final of the selected entries; writes
 * frames whose processed image differs and refreshes finalSha256. Returns
 * stats; the manifest is saved when a hash changed.
 */
export function processFinals(
  opts: Pick<StepOpts, 'ids'>,
  skip: (e: ManifestEntry) => boolean,
  fn: (e: ManifestEntry, img: Img, frame: string) => Img | null,
): PassStats {
  const m = loadManifest()
  const stats: PassStats = { frames: 0, written: 0, entries: new Set() }
  for (const e of selectedEntries(m, opts)) {
    if (skip(e)) continue
    let touched = false
    for (const name of baseFrameNames(e)) {
      const p = finalPath(e, name)
      if (!existsSync(p)) continue
      const near = nearestIndexFn(entrySubset(e))
      const { img } = readImg(p, near)
      stats.frames++
      const out = fn(e, img, name)
      if (!out) continue
      if (writeIfChanged(p, encodeImg(out))) {
        stats.written++
        touched = true
      }
    }
    if (touched) {
      e.finalSha256 = frameSetSha256(e) ?? undefined
      stats.entries.add(e.id)
    }
  }
  if (stats.entries.size > 0) saveManifest(m)
  return stats
}

// ---------------------------------------------------------------------------
// Normalize

/**
 * Place an image on the class canvas. City classes: bottom-centre of the
 * opaque bbox on the anchor (W/2, H-1); others: bbox centred. Returns null
 * when the sprite does not fit (never scaled — integer only, §3.7).
 */
export function placeOnCanvas(e: ManifestEntry, img: Img): Img | null {
  const [W, H] = e.canvas
  const b = bbox(img)
  const out = newImg(W, H)
  if (!b) return out
  const bw = b.x1 - b.x0 + 1
  const bh = b.y1 - b.y0 + 1
  if (bw > W || bh > H) return null
  const crop = newImg(bw, bh)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const s = (b.y0 + y) * img.w + b.x0 + x
      crop.px[y * bw + x] = img.px[s] as number
      crop.depth[y * bw + x] = 0
    }
  }
  let dx: number
  let dy: number
  if (CITY_CLASSES.includes(e.class)) {
    dx = Math.round(W / 2 - bw / 2)
    dy = H - bh
  } else {
    dx = Math.floor((W - bw) / 2)
    dy = Math.floor((H - bh) / 2)
  }
  blit(out, crop, dx, dy)
  return out
}

/** full normalize of a raw RGBA image (generated candidates) */
export function normalizeRgba(
  e: ManifestEntry,
  rgba: Uint8Array | Uint8ClampedArray | Buffer,
  w: number,
  h: number,
): Img | null {
  const { img } = rgbaToImg(rgba, w, h, nearestIndexFn(entrySubset(e)))
  return placeOnCanvas(e, img)
}

/**
 * Normalize a final already read as an Img (alpha thresholded by readImg):
 * mis-sized frames are re-placed; frames already on the class canvas
 * (procedural or installed candidates) pass through unchanged.
 */
export function normalizeFinal(e: ManifestEntry, img: Img): Img {
  if (e.class === 'font') return img
  const [W, H] = e.canvas
  if (img.w === W && img.h === H) return img
  return placeOnCanvas(e, img) ?? img
}

export function run(opts: StepOpts): number {
  let unfit = 0
  const stats = processFinals(
    opts,
    (e) => e.class === 'font',
    (e, img, frame) => {
      const [W, H] = e.canvas
      if (img.w === W && img.h === H) {
        return img // placed by its drawer / candidates.ts; alpha thresholded on read
      }
      const out = placeOnCanvas(e, img)
      if (!out) {
        unfit++
        console.error(
          `normalize: ${e.id}: ${frame} (${img.w}x${img.h}) does not fit ` +
            `the ${W}x${H} canvas`,
        )
        return null
      }
      return out
    },
  )
  console.log(
    `normalize: ${stats.frames} frames checked, ${stats.written} rewritten` +
      (unfit ? `, ${unfit} do not fit their canvas` : ''),
  )
  return unfit > 0 ? 1 : 0
}
