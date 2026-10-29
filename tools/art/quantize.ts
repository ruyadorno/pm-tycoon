// `vlr art:quantize` (style-guide.md §3.7, §1.8): every opaque pixel ->
// nearest colour (RGB) of subsetFor(class, {district}), dithering off. The
// reserved ramps (mal, gold) and red/water are only reachable by the
// classes that may use them (palette.ts RAMP_RULES), so a generated purple
// roof can never land in the malware ramp. Prints the unique-colour count
// before/after for every frame that changed, so flattening is visible.
// Off-palette RGB is snapped while reading (readImg + nearestIndexFn).

import { existsSync } from 'node:fs'
import type { StepOpts } from './draw-api.ts'
import { type Img, cloneImg, readImg } from './iso.ts'
import { type ManifestEntry, baseFrameNames, finalPath } from './manifest.ts'
import { entrySubset, nearestIndexFn, processFinals } from './normalize.ts'
import { PALETTE } from './palette.ts'

function uniqueColours(img: Img): number {
  const s = new Set<number>()
  for (const i of img.px) if (i >= 0) s.add(i)
  return s.size
}

/** remap palette colours outside the entry's subset to the nearest one */
export function quantizeImg(e: ManifestEntry, img: Img): Img {
  const subset = entrySubset(e)
  const allowed = new Set(
    subset.map((c) => PALETTE.colors.findIndex((p) => p.id === c.id)),
  )
  const near = nearestIndexFn(subset)
  let out: Img | null = null
  for (let k = 0; k < img.px.length; k++) {
    const i = img.px[k] as number
    if (i < 0 || allowed.has(i)) continue
    out ??= cloneImg(img)
    const [r, g, b] = (PALETTE.colors[i] as { rgb: readonly number[] }).rgb
    out.px[k] = near(r as number, g as number, b as number)
  }
  return out ?? img
}

export function run(opts: StepOpts): number {
  const report: string[] = []
  const stats = processFinals(
    opts,
    // the m5x7 sheet is pure #ffffff by design (tinted at runtime)
    (e) => e.class === 'font',
    (e, img, frame) => {
      // colour count of the file as stored (before snapping)
      const raw = readImg(finalPath(e, frame))
      const out = quantizeImg(e, img)
      if (raw.offPalette > 0 || out !== img) {
        report.push(
          `quantize: ${e.id}: ${frame}: ${raw.offPalette} off-palette px, ` +
            `${uniqueColours(raw.img) + (raw.offPalette ? 1 : 0)}+ -> ` +
            `${uniqueColours(out)} colours`,
        )
      }
      return out
    },
  )
  for (const r of report) console.log(r)
  console.log(
    `quantize: ${stats.frames} frames checked, ${stats.written} rewritten`,
  )
  return 0
}

/** off-palette / off-subset pixel count of one final (lint helper) */
export function quantizeDelta(e: ManifestEntry): number {
  let n = 0
  for (const name of baseFrameNames(e)) {
    const p = finalPath(e, name)
    if (!existsSync(p)) continue
    const { img, offPalette } = readImg(p)
    n += offPalette
    const q = quantizeImg(e, img)
    if (q !== img) {
      for (let k = 0; k < img.px.length; k++) if (q.px[k] !== img.px[k]) n++
    }
  }
  return n
}
