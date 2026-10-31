// `vlr art:outline` (style-guide.md §3.7, §1.2, §1.3): every opaque pixel
// adjacent to transparency becomes `outline`, then the 2-px shadow strip is
// re-applied along the south-east base edge of city building sprites.
// Applies to the outlined object classes (city buildings, warehouse
// exterior, props, dock props, vehicles) and to every generated sprite of
// an object class. Seamless tiles, UI nine-slices, icons, fx and the font
// keep their own edges, and procedural interior art is left to its drawer
// (its dashed outlines and grey silhouettes are deliberate).

import type { StepOpts } from './draw-api.ts'
import { type Img, cloneImg, outlineImg, sameImg, shadowStrip } from './iso.ts'
import type { AssetClass, ManifestEntry } from './manifest.ts'
import { isGenerated, processFinals } from './normalize.ts'

const OUTLINED: readonly AssetClass[] = [
  'building1x1',
  'building2x2',
  'building3x3',
  'warehouse-ext',
  'prop',
  'dock-prop',
  'vehicle-bike',
  'vehicle-van',
  'vehicle-truck',
  // build 3 (B3 §5): the category pictures keep the 1-px outline rule
  // (procedural fallbacks and generated candidates alike)
  'event-pic',
]

const NEVER: readonly AssetClass[] = [
  'tile',
  'interior-tile',
  'ui',
  'font',
  'fx',
  'icon16',
]

/** classes/entries the outline pass (and lint A10) applies to */
export function needsOutline(e: ManifestEntry): boolean {
  if (OUTLINED.includes(e.class)) return true
  return isGenerated(e) && !NEVER.includes(e.class)
}

/**
 * the §1.2 shadow strip: city building classes (not the mood overlays). The
 * warehouse exterior paints no ground patch since build 2 (B2 §6.1: the
 * slab is ground-bake tiles), so it has no base diamond to shade.
 */
export function needsShadow(e: ManifestEntry): boolean {
  return e.class.startsWith('building') && !e.id.startsWith('mood_')
}

export function outlineFinal(e: ManifestEntry, img: Img): Img {
  if (!needsOutline(e)) return img
  const out = cloneImg(img)
  outlineImg(out)
  if (needsShadow(e)) {
    const fp = e.footprint?.[0] ?? Math.round(e.canvas[0] / 64)
    shadowStrip(out, e.canvas[0] / 2, e.canvas[1] - 1, 64 * fp)
  }
  return sameImg(out, img) ? img : out
}

export function run(opts: StepOpts): number {
  const stats = processFinals(
    opts,
    (e) => !needsOutline(e),
    (e, img) => outlineFinal(e, img),
  )
  console.log(
    `outline: ${stats.frames} frames checked, ${stats.written} rewritten` +
      (stats.entries.size ? ` (${[...stats.entries].join(', ')})` : ''),
  )
  return 0
}
