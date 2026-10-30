// `vlr art:logo` (and the `logo` step of `vlr art:build`, before `atlas`):
// the author's logo art/logo.png (512×256 RGBA, smooth shaded brand art) →
// src/assets/logo.png at 352×176 for the Title (B2 §5, plan-build2 §8.2
// task 1; Q-B2-1: as-is). A Lanczos-3 downscale with the alpha kept
// (sharp premultiplies before resampling, so the edges stay clean), written
// with fixed PNG settings and no metadata — the same input always yields
// the same bytes, so the build stays idempotent and a test can compare the
// committed file with a fresh render. The logo is outside the palette
// contract (manifest class `logo`, exempt from lint A01/A07, never packed):
// PreloadScene loads it as its own texture 'logo' (src/render/assetUrls.ts).
//
//   node tools/art/logo.ts            # writes src/assets/logo.png
//   node tools/art/build.ts logo      # the same, as a build step

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { StepOpts } from './draw-api.ts'

/** The output size in logical px (drawn 1:1 on the Title, B2 §5). */
export const LOGO_W = 352
export const LOGO_H = 176
/** Source and output, relative to the repo root. */
export const LOGO_SRC = 'art/logo.png'
export const LOGO_OUT = 'src/assets/logo.png'
/** Byte budget for the shipped PNG (tests/title/logo.test.ts). */
export const LOGO_MAX_BYTES = 120 * 1024

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The 352×176 RGBA PNG for a source logo PNG (deterministic). */
export async function renderLogo(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .ensureAlpha()
    .resize(LOGO_W, LOGO_H, {
      kernel: 'lanczos3',
      fit: 'fill',
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false,
      palette: false,
      effort: 10,
    })
    .toBuffer()
}

/** Build step: render art/logo.png into src/assets/logo.png (exit code). */
export async function run(opts?: Pick<StepOpts, 'root'>): Promise<number> {
  const root = opts?.root ?? ROOT
  const srcPath = join(root, LOGO_SRC)
  const outPath = join(root, LOGO_OUT)
  if (!existsSync(srcPath)) {
    console.error(`logo: ${LOGO_SRC} is missing`)
    return 1
  }
  const meta = await sharp(srcPath).metadata()
  if (meta.width !== 512 || meta.height !== 256)
    console.warn(
      `logo: ${LOGO_SRC} is ${meta.width}×${meta.height}, expected 512×256 (scaled to ${LOGO_W}×${LOGO_H} anyway)`,
    )
  const png = await renderLogo(readFileSync(srcPath))
  const same = existsSync(outPath) && readFileSync(outPath).equals(png)
  if (!same) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, png)
  }
  const kb = (png.length / 1024).toFixed(1)
  console.log(
    `logo: ${LOGO_OUT} ${LOGO_W}×${LOGO_H}, ${kb} KB${same ? ' (unchanged)' : ''}`,
  )
  if (png.length > LOGO_MAX_BYTES) {
    console.error(
      `logo: ${kb} KB is over the ${LOGO_MAX_BYTES / 1024} KB budget`,
    )
    return 1
  }
  return 0
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  run().then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : err)
      process.exitCode = 1
    },
  )
}
