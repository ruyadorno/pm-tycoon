// `vlr art:variants` (style-guide.md §3.7):
// - `_locked`: the fog sub-palette remap (palette.ts FOG_MAP: 45 % toward
//   grey5, desaturated, nearest grey) of every base frame of entries that
//   list the 'locked' variant -> <frame>_locked.png (spec §3.5).
// - `_t2`: palette swap table T2_SWAP (grey -> painted blue accents) for
//   entries listing 't2' (none in playtest 1: tier-2 art is drawn).
// - mood overlays are drawn (buildings.ts), not derived.
// - mirror + reshade: a vehicle missing its SW / NW frames (a failed
//   generation) gets them mirrored from SE / NE, with the body ramp's two
//   lowest used steps swapped so the lit face stays on the left. Generated
//   8-direction objects and procedural vehicles have all four headings and
//   are never mirrored.

import { existsSync } from 'node:fs'
import type { StepOpts } from './draw-api.ts'
import {
  type Img,
  encodeImg,
  mirrorX,
  pid,
  readImg,
  remap,
  writeIfChanged,
} from './iso.ts'
import {
  type ManifestEntry,
  VARIANT_SUFFIX,
  finalPath,
  frameSetSha256,
  loadManifest,
  saveManifest,
} from './manifest.ts'
import { selectedEntries } from './normalize.ts'
import { FOG_MAP, PALETTE } from './palette.ts'

/** palette id -> fogged palette id */
export const FOG_IDS: ReadonlyMap<string, string> = new Map(
  PALETTE.colors.map((c) => [
    c.id,
    PALETTE.byHex.get(FOG_MAP.get(c.hex) as string)?.id as string,
  ]),
)

/** tier-2 paint swap: warm greys -> blue accents (style-guide §3.7) */
export const T2_SWAP: ReadonlyMap<string, string> = new Map([
  ['grey1', 'blue0'],
  ['grey2', 'blue1'],
  ['grey3', 'blue2'],
])

export function fogImg(img: Img): Img {
  return remap(img, FOG_IDS)
}

export function t2Img(img: Img): Img {
  return remap(img, T2_SWAP)
}

/** mirror + reshade (swap the two lowest used steps of the body ramp) */
export function mirrorReshade(img: Img, bodyRamp: string): Img {
  const out = mirrorX(img)
  const ramp = PALETTE.ramp(bodyRamp).map((c) => c.id)
  const used = new Set<string>()
  for (const i of out.px) if (i >= 0) used.add(pid(i))
  const steps = ramp.filter((id) => used.has(id))
  if (steps.length < 2) return out
  const [a, b] = steps as [string, string]
  return remap(
    out,
    new Map([
      [a, b],
      [b, a],
    ]),
  )
}

const MIRRORS: [string, string][] = [
  ['_se', '_sw'],
  ['_ne', '_nw'],
]

function vehicleMirrors(e: ManifestEntry): number {
  if (!e.class.startsWith('vehicle-')) return 0
  let n = 0
  for (const [from, to] of MIRRORS) {
    for (const f of e.frames.filter((s) => s.startsWith(to + '_'))) {
      const dst = finalPath(e, e.id + f)
      if (existsSync(dst)) continue
      const src = finalPath(e, e.id + from + f.slice(to.length))
      if (!existsSync(src)) continue
      const img = mirrorReshade(readImg(src).img, e.bodyRamp ?? 'blue')
      if (writeIfChanged(dst, encodeImg(img))) n++
      console.log(`variants: ${e.id}: ${e.id + f} mirrored from SE/NE`)
    }
  }
  return n
}

export function run(opts: StepOpts): number {
  const m = loadManifest()
  let written = 0
  let derived = 0
  let missing = 0
  let hashes = false
  for (const e of selectedEntries(m, opts)) {
    const mirrored = vehicleMirrors(e)
    if (mirrored > 0) {
      e.finalSha256 = frameSetSha256(e) ?? undefined
      hashes = true
      written += mirrored
    }
    for (const v of e.variants) {
      if (v === 'mood') continue // drawn overlays (separate ids)
      for (const f of e.frames) {
        const src = finalPath(e, e.id + f)
        if (!existsSync(src)) {
          missing++
          continue
        }
        const base = readImg(src).img
        const out = v === 'locked' ? fogImg(base) : t2Img(base)
        const dst = finalPath(e, e.id + f + VARIANT_SUFFIX[v])
        derived++
        if (writeIfChanged(dst, encodeImg(out))) written++
      }
    }
  }
  if (hashes) saveManifest(m)
  console.log(
    `variants: ${derived} variant frames derived, ${written} PNGs changed` +
      (missing ? `, ${missing} base frames missing` : ''),
  )
  return 0
}
