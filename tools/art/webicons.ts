// `vlr art:webicons` (and the `webicons` step of `vlr art:build`, after
// `logo`): the browser favicon and the iOS / Android home-screen icons
// (author request 2026-10-31; docs/decisions.md "After M15 — browser and
// home-screen icons"). Every icon is a square close-up cut from one committed
// render of the real City, art/webicon-src.png: 512×512, 1 art px = 1 px,
// centred on the City's warehouseCentre() — the L5 HQ (`wh_ext_t5`) with the
// city around it, the `tycoon` session config at tick 0, overlays hidden
// (`vlr webicons:capture` re-shoots it: e2e/webicons.spec.ts, then this step).
// The render is brand art outside the palette contract, like the logo (B2
// §5): it is never linted or packed, and the downscales blend colours.
//
// Each cut shows `crop` art px of the render around the HQ, its centre moved
// `dy` px up the tower towards the neon parcel sign, scaled to `size`:
// nearest-neighbour up to the next whole multiple of the crop, then Lanczos-3
// down to the size (so an upscale keeps square pixels and only the last
// fraction blends). The home-screen icons show the HQ with the blocks around
// it; the favicons zoom in as they shrink, down to the sign on the tower at
// 16 px, where a whole block would be mush. The maskable icons are framed
// wider so a launcher's circle, which shows about the central two thirds,
// still frames the HQ with the city around it (W3C safe zone: radius 40 %).
// Outputs, all opaque (iOS shows a transparent icon on black); the
// home-screen PNGs carry a 256-colour palette (ICON_PNG_OPTS):
//   public/favicon.ico                  16, 32, 48 (RGBA PNG-in-ICO entries)
//   public/icons/apple-touch-icon.png   180
//   public/icons/icon-{192,512}.png     manifest purpose "any"
//   public/icons/icon-maskable-{192,512}.png   purpose "maskable"
//   public/manifest.webmanifest         name, colours, the icons (no service
//                                       worker: icons only, not a PWA)
// They live in public/ and ship unhashed (index.html links them): Vite does
// not rewrite the icon URLs inside a manifest, and a stale icon is harmless.
// Fixed PNG settings and no metadata: the same source always yields the same
// bytes (tests/art/webicons.test.ts compares the committed files with a
// fresh render).
//
//   node tools/art/webicons.ts          # writes the files above
//   node tools/art/build.ts webicons    # the same, as a build step

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { StepOpts } from './draw-api.ts'

/** The committed source render, relative to the repo root. */
export const WEBICON_SRC = 'art/webicon-src.png'
/** Its side in px; the HQ's centre is the centre of the picture. */
export const WEBICON_SRC_SIDE = 512
/** Byte budget for every output together (tests/art/webicons.test.ts). */
export const WEBICON_MAX_BYTES = 480 * 1024

/** One square cut of the source render. */
export interface WebIconCut {
  /** Output side in px. */
  size: number
  /** Side of the square of the render it shows, in art px (even). */
  crop: number
  /** Crop centre shift from the HQ's centre in art px (negative = up). */
  dy: number
}

/** A PNG icon file, relative to the repo root. */
export interface WebIconFile extends WebIconCut {
  file: string
  /** Manifest purpose; null = not in the manifest (apple-touch-icon). */
  purpose: 'any' | 'maskable' | null
}

/** The favicon.ico entries, smallest first. */
export const FAVICON_CUTS: readonly WebIconCut[] = [
  { size: 16, crop: 96, dy: -60 },
  { size: 32, crop: 128, dy: -44 },
  { size: 48, crop: 192, dy: -24 },
]
export const FAVICON_OUT = 'public/favicon.ico'

export const WEBICON_FILES: readonly WebIconFile[] = [
  {
    file: 'public/icons/apple-touch-icon.png',
    size: 180,
    crop: 320,
    dy: 0,
    purpose: null,
  },
  {
    file: 'public/icons/icon-192.png',
    size: 192,
    crop: 320,
    dy: 0,
    purpose: 'any',
  },
  {
    file: 'public/icons/icon-512.png',
    size: 512,
    crop: 320,
    dy: 0,
    purpose: 'any',
  },
  {
    file: 'public/icons/icon-maskable-192.png',
    size: 192,
    crop: 448,
    dy: 0,
    purpose: 'maskable',
  },
  {
    file: 'public/icons/icon-maskable-512.png',
    size: 512,
    crop: 448,
    dy: 0,
    purpose: 'maskable',
  },
]

export const MANIFEST_OUT = 'public/manifest.webmanifest'
/** index.html theme-color and body background (the Title sky). */
export const WEBICON_THEME = '#2f9bd6'
/** The home-screen label (index.html apple-mobile-web-app-title). */
export const WEBICON_SHORT_NAME = 'PM Tycoon'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const PNG_OPTS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const
/**
 * The home-screen PNGs: 256-colour palette (libimagequant at quality 100).
 * A Lanczos blend of the render has tens of thousands of colours, 3-4× the
 * bytes for no visible gain (PSNR ≈ 37-40 dB against the full-colour cut).
 */
const ICON_PNG_OPTS = {
  ...PNG_OPTS,
  palette: true,
  quality: 100,
  colours: 256,
  effort: 10,
  dither: 1,
} as const

/** Throws unless `c` lies inside the source with whole-pixel edges. */
export function cutRect(c: WebIconCut): {
  left: number
  top: number
  width: number
  height: number
} {
  const half = WEBICON_SRC_SIDE / 2
  const left = half - c.crop / 2
  const top = half + c.dy - c.crop / 2
  if (
    !Number.isInteger(c.crop / 2) ||
    !Number.isInteger(c.dy) ||
    left < 0 ||
    top < 0 ||
    top + c.crop > WEBICON_SRC_SIDE
  ) {
    throw new Error(`webicons: cut ${JSON.stringify(c)} is off the source`)
  }
  return { left, top, width: c.crop, height: c.crop }
}

/** One cut of the source as an opaque RGB PNG (deterministic). */
export async function renderCut(src: Buffer, c: WebIconCut): Promise<Buffer> {
  const crop = sharp(src).removeAlpha().extract(cutRect(c))
  if (c.size === c.crop) return crop.png(PNG_OPTS).toBuffer()
  let img = crop
  if (c.size > c.crop) {
    const k = Math.ceil(c.size / c.crop)
    const up = await crop
      .resize(c.crop * k, c.crop * k, { kernel: 'nearest' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (c.crop * k === c.size) {
      return sharp(up.data, { raw: up.info }).png(PNG_OPTS).toBuffer()
    }
    img = sharp(up.data, { raw: up.info })
  }
  return img
    .resize(c.size, c.size, { kernel: 'lanczos3' })
    .png(PNG_OPTS)
    .toBuffer()
}

/** A .ico of PNG entries (ICONDIR + one ICONDIRENTRY per image, Vista+). */
export function encodeIco(
  images: readonly { size: number; png: Buffer }[],
): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  for (const [i, { size, png }] of images.entries()) {
    const e = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, e)
    head.writeUInt8(size >= 256 ? 0 : size, e + 1)
    head.writeUInt8(0, e + 2)
    head.writeUInt8(0, e + 3)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(png.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += png.length
  }
  return Buffer.concat([head, ...images.map((im) => im.png)])
}

/** The web app manifest (paths relative to it: works under /pm-tycoon/). */
export function webManifest(): Record<string, unknown> {
  return {
    name: 'Package Management Tycoon',
    short_name: WEBICON_SHORT_NAME,
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: WEBICON_THEME,
    theme_color: WEBICON_THEME,
    icons: WEBICON_FILES.filter((f) => f.purpose !== null).map((f) => ({
      src: f.file.slice('public/'.length),
      sizes: `${f.size}x${f.size}`,
      type: 'image/png',
      purpose: f.purpose,
    })),
  }
}

/** Every output, repo-relative path → bytes, for a source PNG. */
export async function renderWebIcons(
  src: Buffer,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const ico = []
  for (const c of FAVICON_CUTS) {
    // 32-bit RGBA entries (fully opaque), what the Windows icon loader expects
    const png = await sharp(await renderCut(src, c))
      .ensureAlpha(1)
      .png(PNG_OPTS)
      .toBuffer()
    ico.push({ size: c.size, png })
  }
  out.set(FAVICON_OUT, encodeIco(ico))
  for (const f of WEBICON_FILES) {
    const png = await renderCut(src, f)
    out.set(f.file, await sharp(png).png(ICON_PNG_OPTS).toBuffer())
  }
  out.set(
    MANIFEST_OUT,
    Buffer.from(`${JSON.stringify(webManifest(), null, 2)}\n`),
  )
  return out
}

/** Build step: cut art/webicon-src.png into the web icons (exit code). */
export async function run(opts?: Pick<StepOpts, 'root'>): Promise<number> {
  const root = opts?.root ?? ROOT
  const srcPath = join(root, WEBICON_SRC)
  if (!existsSync(srcPath)) {
    console.error(
      `webicons: ${WEBICON_SRC} is missing (vlr webicons:capture renders it)`,
    )
    return 1
  }
  const meta = await sharp(srcPath).metadata()
  if (meta.width !== WEBICON_SRC_SIDE || meta.height !== WEBICON_SRC_SIDE) {
    console.error(
      `webicons: ${WEBICON_SRC} is ${meta.width}×${meta.height}, expected ${WEBICON_SRC_SIDE}² centred on the HQ`,
    )
    return 1
  }
  const files = await renderWebIcons(readFileSync(srcPath))
  let total = 0
  let changed = 0
  for (const [rel, bytes] of files) {
    total += bytes.length
    const path = join(root, rel)
    if (existsSync(path) && readFileSync(path).equals(bytes)) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    changed++
  }
  const kb = (total / 1024).toFixed(1)
  console.log(
    `webicons: ${files.size} files, ${kb} KB, ${changed === 0 ? 'unchanged' : `${changed} written`}`,
  )
  if (total > WEBICON_MAX_BYTES) {
    console.error(
      `webicons: ${kb} KB is over the ${WEBICON_MAX_BYTES / 1024} KB budget`,
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
