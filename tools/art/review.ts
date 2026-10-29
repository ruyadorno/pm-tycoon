// Ad-hoc review sheets for the PixelLab bulk pass (art agent only).
// Renders PNGs side by side at an integer scale onto a flat background so
// a vision pass can read them at a sensible size. Writes only where told
// (art/candidates/_review/ by convention). No network, no manifest writes.
//
//   node tools/art/review.ts <out.png> <scale> <bg-palette-id> <label=path> …
//   (a lone '|' starts a new row)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas'
import { PALETTE } from './palette.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FONT = join(ROOT, 'art/fonts/m5x7.ttf')

export interface Item {
  label: string
  path: string
}

export async function reviewSheet(
  out: string,
  rows: Item[][],
  scale = 2,
  bg = 'grass3',
): Promise<string> {
  let fontOk = false
  try {
    fontOk =
      existsSync(FONT) && GlobalFonts.registerFromPath(FONT, 'm5x7') !== null
  } catch {
    fontOk = false
  }
  const gap = 6
  const lab = 10
  const loaded = await Promise.all(
    rows.map((r) =>
      Promise.all(
        r.map(async (it) => ({
          it,
          im: existsSync(it.path)
            ? await loadImage(readFileSync(it.path))
            : null,
        })),
      ),
    ),
  )
  const rowH = loaded.map((r) =>
    Math.max(1, ...r.map((x) => x.im?.height ?? 8)),
  )
  const rowW = loaded.map((r) =>
    r.reduce((a, x) => a + (x.im?.width ?? 8) + gap, gap),
  )
  const W = Math.max(...rowW)
  const H = rowH.reduce((a, h) => a + h + lab + gap, gap)
  const cv = createCanvas(W * scale, H * scale)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = PALETTE.hex(bg)
  ctx.fillRect(0, 0, cv.width, cv.height)
  let y = gap
  loaded.forEach((r, ri) => {
    let x = gap
    const h = rowH[ri] as number
    for (const { it, im } of r) {
      const w = im?.width ?? 8
      if (im) {
        ctx.drawImage(
          im,
          x * scale,
          (y + h - im.height) * scale,
          im.width * scale,
          im.height * scale,
        )
      }
      ctx.fillStyle = PALETTE.hex('outline')
      ctx.font = fontOk ? `${8 * scale}px m5x7` : `${6 * scale}px sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(it.label, x * scale, (y + h + 1) * scale)
      x += w + gap
    }
    y += h + lab + gap
  })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, cv.toBuffer('image/png'))
  return out
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const [out, scale, bg, ...rest] = process.argv.slice(2)
  if (!out || !scale || !bg) {
    console.error(
      'usage: node tools/art/review.ts <out.png> <scale> <bg> <label=path>|"|" …',
    )
    process.exit(1)
  }
  const rows: Item[][] = [[]]
  for (const a of rest) {
    if (a === '|') {
      rows.push([])
      continue
    }
    const i = a.indexOf('=')
    const label = i > 0 ? a.slice(0, i) : a
    const path = i > 0 ? a.slice(i + 1) : a
    ;(rows[rows.length - 1] as Item[]).push({ label, path: join(ROOT, path) })
  }
  reviewSheet(
    join(ROOT, out),
    rows.filter((r) => r.length),
    Number(scale),
    bg,
  ).then((p) => console.log(`review: ${p}`))
}
