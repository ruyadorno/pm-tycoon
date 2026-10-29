// Lint the staged choices (art agent only; read-only): every chosen
// candidate frame in art/candidates/choices.json is checked against the
// lint.ts per-frame rules as they will apply after install — A01 palette
// subset (A07 reserved ramps included), A02 alpha, A03 canvas, A04
// footprint diamond, A05 height budget / vehicle margin, A06 frame set,
// A10 outline continuity, A11 near-black; A12 colour counts as warnings —
// plus the fogged `_locked` derivative (greys only) for locked entries.
//
//   node tools/art/check-chosen.ts            exit 1 on any error

import { existsSync } from 'node:fs'

import { asGenerated } from './candidates.ts'
import { candidatePath, loadChoices } from './gen.ts'
import { bbox, opaque, pid, readImg, stairStepOk } from './iso.ts'
import { CITY_CLASSES, HEIGHT_BUDGET, ROOT, loadManifest } from './manifest.ts'
import { entrySubset } from './normalize.ts'
import { needsOutline } from './outline.ts'
import { PALETTE } from './palette.ts'
import { fogImg } from './variants.ts'

const m = loadManifest()
const choices = loadChoices()
const errors: string[] = []
const warnings: string[] = []
let frames = 0
for (const [id, c] of Object.entries(choices)) {
  const e0 = m.entries.find((x) => x.id === id)
  if (!e0) {
    errors.push(`${id}: not in the manifest`)
    continue
  }
  if (!('candidate' in c)) continue
  const e = asGenerated(e0)
  const subset = new Set(entrySubset(e).map((s) => s.id))
  const [W, H] = e.canvas
  for (const f of e.frames) {
    const p = candidatePath(id, c.candidate, f)
    const at = `${id}#${c.candidate} ${f || "''"}`
    if (!existsSync(p)) {
      errors.push(`A06 ${at}: missing ${p.replace(ROOT, '')}`)
      continue
    }
    frames++
    const { img, offPalette, semiAlpha } = readImg(p)
    if (semiAlpha) errors.push(`A02 ${at}: ${semiAlpha} semi-transparent px`)
    if (offPalette) errors.push(`A01 ${at}: ${offPalette} off-palette px`)
    if (img.w !== W || img.h !== H)
      errors.push(`A03 ${at}: ${img.w}x${img.h} != ${W}x${H}`)
    const used = new Set<string>()
    for (const i of img.px) if (i >= 0) used.add(pid(i))
    for (const u of used)
      if (!subset.has(u))
        errors.push(`A01/A07 ${at}: ${u} not in subsetFor(${e.class})`)
    for (const u of used) {
      const col = PALETTE.byId.get(u)
      if (col && Math.max(...col.rgb) / 255 < 0.25 && u !== 'outline')
        errors.push(`A11 ${at}: ${u}`)
    }
    if (CITY_CLASSES.includes(e.class)) {
      const fp = e.footprint?.[0] ?? Math.round(W / 64)
      const pr = stairStepOk(img, 64 * fp)
      if (pr.length) errors.push(`A04 ${at}: ${pr[0]}`)
    }
    const b = bbox(img)
    if (!b) errors.push(`A05 ${at}: empty`)
    else {
      const budget = HEIGHT_BUDGET[e.class]
      const fp = e.footprint?.[0] ?? Math.round(W / 64)
      if (budget !== undefined && b.y0 < H - 32 * fp - budget)
        errors.push(`A05 ${at}: above the height budget`)
      if (
        e.class.startsWith('vehicle-') &&
        (b.x0 < 1 || b.y0 < 1 || b.x1 > W - 2 || b.y1 > H - 2)
      ) {
        errors.push(`A05 ${at}: touches the 1-px margin`)
      }
    }
    if (needsOutline(e)) {
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
          if (edge && pid(i) !== 'outline') n++
        }
      }
      if (n) errors.push(`A10 ${at}: ${n} silhouette px not outline`)
    }
    if (used.size > 16) warnings.push(`A12 ${at}: ${used.size} colours`)
    if (e.variants.includes('locked')) {
      const fog = fogImg(img)
      for (const i of fog.px) {
        if (i >= 0 && !pid(i).startsWith('grey') && pid(i) !== 'outline') {
          errors.push(`A01 ${at} _locked: ${pid(i)} is not a fog grey`)
          break
        }
      }
    }
  }
}
for (const w of warnings) console.log(`warn ${w}`)
for (const er of errors) console.error(`ERROR ${er}`)
const chosen = Object.values(choices).filter((c) => 'candidate' in c).length
const kept = Object.values(choices).length - chosen
console.log(
  `check-chosen: ${chosen} chosen (${frames} frames), ${kept} KEEP-PROCEDURAL; ` +
    `${errors.length} errors, ${warnings.length} warnings`,
)
process.exitCode = errors.length ? 1 : 0
