// The browser favicon and the home-screen icons (author request 2026-10-31;
// docs/decisions.md "After M15 — browser and home-screen icons"):
// tools/art/webicons.ts cuts art/webicon-src.png (512×512, the L5 HQ in the
// City) into public/favicon.ico (16/32/48), public/icons/*.png (apple-touch
// 180, manifest "any" and "maskable" 192/512) and public/manifest.webmanifest,
// all opaque, deterministically, under the byte budget; the committed files
// are that render (else: `vlr art:webicons`) and index.html links them.
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  FAVICON_CUTS,
  FAVICON_OUT,
  MANIFEST_OUT,
  WEBICON_FILES,
  WEBICON_MAX_BYTES,
  WEBICON_SHORT_NAME,
  WEBICON_SRC,
  WEBICON_SRC_SIDE,
  WEBICON_THEME,
  type WebIconFile,
  cutRect,
  renderWebIcons,
  webManifest,
} from '../../tools/art/webicons.ts'

const root = new URL('../../', import.meta.url)
const read = (rel: string): Buffer => readFileSync(new URL(rel, root))
const exists = (rel: string): boolean => existsSync(new URL(rel, root))

/** Every file `vlr art:webicons` writes, repo-relative. */
const OUTPUTS = [FAVICON_OUT, ...WEBICON_FILES.map((f) => f.file), MANIFEST_OUT]
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The PNG sizes of one manifest purpose (null = the apple-touch icon). */
const sizesOf = (purpose: WebIconFile['purpose']): number[] =>
  WEBICON_FILES.filter((f) => f.purpose === purpose)
    .map((f) => f.size)
    .toSorted((a, b) => a - b)

/** The smallest alpha sample of an image (255 when it has no alpha band). */
async function alphaMin(img: Buffer): Promise<number> {
  const { channels } = await sharp(img).stats()
  return channels.length === 2 || channels.length === 4
    ? channels.at(-1)!.min
    : 255
}

describe('art/webicon-src.png (the source render)', () => {
  it(`is ${WEBICON_SRC_SIDE}×${WEBICON_SRC_SIDE} and opaque`, async () => {
    const src = read(WEBICON_SRC)
    const meta = await sharp(src).metadata()
    expect([meta.width, meta.height]).toEqual([
      WEBICON_SRC_SIDE,
      WEBICON_SRC_SIDE,
    ])
    expect([3, 4]).toContain(meta.channels)
    expect(await alphaMin(src), 'no transparent pixel').toBe(255)
  })
})

describe('the cuts (FAVICON_CUTS, WEBICON_FILES)', () => {
  it('each lies inside the source with an even crop', () => {
    for (const c of [...FAVICON_CUTS, ...WEBICON_FILES]) {
      const label = JSON.stringify(c)
      const r = cutRect(c)
      expect(c.crop % 2, label).toBe(0)
      expect(r.left, label).toBeGreaterThanOrEqual(0)
      expect(r.top, label).toBeGreaterThanOrEqual(0)
      expect(r.left + r.width, label).toBeLessThanOrEqual(WEBICON_SRC_SIDE)
      expect(r.top + r.height, label).toBeLessThanOrEqual(WEBICON_SRC_SIDE)
    }
  })

  it('cutRect rejects a cut off the source or off the pixel grid', () => {
    const side = WEBICON_SRC_SIDE
    expect(() => cutRect({ size: 16, crop: side + 2, dy: 0 })).toThrow()
    expect(() => cutRect({ size: 16, crop: 97, dy: 0 })).toThrow()
    expect(() => cutRect({ size: 16, crop: 96, dy: -side / 2 })).toThrow()
    expect(() => cutRect({ size: 16, crop: 96, dy: side / 2 })).toThrow()
  })

  it('the favicons are 16/32/48, each a whole-number downscale of its crop', () => {
    expect(FAVICON_CUTS.map((c) => c.size)).toEqual([16, 32, 48])
    // crop = k × size: every favicon pixel covers a whole k×k block of art
    // px, so the render's pixel grid stays aligned with the icon's (no
    // fractional resampling at the sizes where every pixel counts).
    for (const c of FAVICON_CUTS) {
      expect(c.crop % c.size, JSON.stringify(c)).toBe(0)
      expect(c.crop, JSON.stringify(c)).toBeGreaterThan(c.size)
    }
  })

  it('the PNGs: apple-touch 180, "any" 192 + 512, "maskable" 192 + 512', () => {
    expect(WEBICON_FILES).toHaveLength(5)
    expect(sizesOf(null)).toEqual([180])
    expect(sizesOf('any')).toEqual([192, 512])
    expect(sizesOf('maskable')).toEqual([192, 512])
    expect(WEBICON_FILES.find((f) => f.purpose === null)?.file).toBe(
      'public/icons/apple-touch-icon.png',
    )
    const files = WEBICON_FILES.map((f) => f.file)
    expect(new Set(files).size).toBe(files.length)
    for (const f of files) expect(f).toMatch(/^public\/icons\/[a-z0-9-]+\.png$/)
    // A launcher's circle shows about the central two thirds of a maskable
    // icon, so those are framed wider than the "any" icons of the same size.
    for (const m of WEBICON_FILES.filter((f) => f.purpose === 'maskable')) {
      const any = WEBICON_FILES.find(
        (f) => f.purpose === 'any' && f.size === m.size,
      )
      expect(m.crop, m.file).toBeGreaterThan(any!.crop)
    }
  })
})

describe('public/icons/*.png (committed)', () => {
  for (const f of WEBICON_FILES) {
    it(`${f.file} is a ${f.size}×${f.size} opaque palette PNG`, async () => {
      const meta = await sharp(read(f.file)).metadata()
      expect(meta.format).toBe('png')
      expect([meta.width, meta.height]).toEqual([f.size, f.size])
      expect(meta.channels).toBe(3)
      expect(meta.hasAlpha).toBe(false)
      expect(meta.isPalette, '256-colour palette').toBe(true)
    })
  }

  it(`every output together is under the ${WEBICON_MAX_BYTES / 1024} KB budget`, () => {
    let total = 0
    for (const rel of OUTPUTS) {
      const bytes = read(rel).length
      console.log(`${rel}: ${(bytes / 1024).toFixed(1)} KB`)
      total += bytes
    }
    console.log(`web icons total: ${(total / 1024).toFixed(1)} KB`)
    expect(total).toBeLessThanOrEqual(WEBICON_MAX_BYTES)
  })
})

describe('public/favicon.ico (committed)', () => {
  it('is an ICONDIR of opaque 32-bit PNG entries, one per favicon cut', async () => {
    const ico = read(FAVICON_OUT)
    expect(ico.readUInt16LE(0), 'ICONDIR reserved').toBe(0)
    expect(ico.readUInt16LE(2), 'ICONDIR type (1 = icon)').toBe(1)
    const count = ico.readUInt16LE(4)
    expect(count, 'ICONDIR count').toBe(FAVICON_CUTS.length)
    // The image data follows the directory, entry after entry, to the end.
    let next = 6 + 16 * count
    for (const [i, c] of FAVICON_CUTS.entries()) {
      const e = 6 + 16 * i
      const at = `entry ${i} (${c.size} px)`
      expect(ico.readUInt8(e), `${at} width`).toBe(c.size)
      expect(ico.readUInt8(e + 1), `${at} height`).toBe(c.size)
      expect(ico.readUInt8(e + 2), `${at} colour count`).toBe(0)
      expect(ico.readUInt8(e + 3), `${at} reserved`).toBe(0)
      expect(ico.readUInt16LE(e + 4), `${at} planes`).toBe(1)
      expect(ico.readUInt16LE(e + 6), `${at} bit count`).toBe(32)
      const length = ico.readUInt32LE(e + 8)
      const offset = ico.readUInt32LE(e + 12)
      expect(offset, `${at} offset`).toBe(next)
      expect(length, `${at} length`).toBeGreaterThan(PNG_SIG.length)
      expect(offset + length, `${at} end`).toBeLessThanOrEqual(ico.length)
      next = offset + length
      const png = ico.subarray(offset, offset + length)
      expect(png.subarray(0, 8).equals(PNG_SIG), `${at} PNG signature`).toBe(
        true,
      )
      const meta = await sharp(png).metadata()
      expect(meta.format, at).toBe('png')
      expect([meta.width, meta.height], at).toEqual([c.size, c.size])
      expect(meta.channels, `${at} RGBA`).toBe(4)
      expect(await alphaMin(png), `${at} fully opaque`).toBe(255)
    }
    expect(next, 'no trailing bytes').toBe(ico.length)
  })
})

describe('a fresh render of art/webicon-src.png (else: vlr art:webicons)', () => {
  it('is deterministic and equals every committed output byte for byte', async () => {
    const src = read(WEBICON_SRC)
    const a = await renderWebIcons(src)
    const b = await renderWebIcons(src)
    expect([...a.keys()], 'two renders give the same files').toEqual([
      ...b.keys(),
    ])
    expect([...a.keys()].toSorted()).toEqual(OUTPUTS.toSorted())
    for (const [rel, bytes] of a) {
      expect(bytes.equals(b.get(rel)!), `${rel}: two renders differ`).toBe(true)
      expect(
        exists(rel) && bytes.equals(read(rel)),
        `${rel} is stale: run \`vlr art:webicons\``,
      ).toBe(true)
    }
  }, 60_000)
})

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: string
}

describe('public/manifest.webmanifest (committed)', () => {
  const manifest = JSON.parse(read(MANIFEST_OUT).toString('utf8')) as Record<
    string,
    unknown
  > & { icons: ManifestIcon[] }

  it('is webManifest(): the name, the Title sky, standalone at ./', () => {
    expect(manifest).toEqual(webManifest())
    expect(manifest.name).toBe('Package Management Tycoon')
    expect(manifest.short_name).toBe(WEBICON_SHORT_NAME)
    // Relative to the manifest: the build also works under /pm-tycoon/.
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe(WEBICON_THEME)
    expect(manifest.background_color).toBe(WEBICON_THEME)
  })

  it('lists icons that exist under public/ at their stated sizes', async () => {
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(icon.src, 'relative to the manifest').not.toMatch(/^\/|:/)
      const rel = `public/${icon.src}`
      expect(exists(rel), `${rel} exists`).toBe(true)
      expect(icon.type).toBe('image/png')
      const meta = await sharp(read(rel)).metadata()
      expect(`${meta.width}x${meta.height}`, rel).toBe(icon.sizes)
    }
    for (const purpose of ['any', 'maskable']) {
      expect(
        manifest.icons.some(
          (i) => i.purpose === purpose && i.sizes === '512x512',
        ),
        `a 512 "${purpose}" icon`,
      ).toBe(true)
    }
  })
})

describe('index.html links the icons', () => {
  const html = read('index.html')
    .toString('utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
  /** The attributes of every `<name …>` tag, in document order. */
  const tags = (name: 'link' | 'meta'): Record<string, string>[] =>
    [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) =>
      Object.fromEntries(
        [...m[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]),
      ),
    )
  const links = tags('link')
  const metas = tags('meta')
  const link = (rel: string): Record<string, string>[] =>
    links.filter((l) => l.rel === rel)
  const meta = (name: string): string | undefined =>
    metas.find((m) => m.name === name)?.content

  it('the favicon, the apple-touch icon and the manifest, from public/', () => {
    const icon = link('icon')
    expect(icon).toHaveLength(1)
    expect(icon[0]!.href).toBe('/favicon.ico')
    expect(icon[0]!.sizes).toBe(
      FAVICON_CUTS.map((c) => `${c.size}x${c.size}`).join(' '),
    )
    expect(link('apple-touch-icon').map((l) => l.href)).toEqual([
      '/icons/apple-touch-icon.png',
    ])
    expect(link('manifest').map((l) => l.href)).toEqual([
      '/manifest.webmanifest',
    ])
    // Root paths to the tool's outputs in public/ (Vite rewrites them to
    // page-relative ones, so they work under a subpath).
    const appleTouch = WEBICON_FILES.find((f) => f.purpose === null)!
    const linked = ['icon', 'apple-touch-icon', 'manifest'].flatMap((rel) =>
      link(rel).map((l) => l.href ?? ''),
    )
    expect(linked).toEqual(
      [FAVICON_OUT, appleTouch.file, MANIFEST_OUT].map((rel) =>
        rel.slice('public'.length),
      ),
    )
    for (const href of linked) {
      expect(exists(`public${href}`), `public${href} exists`).toBe(true)
    }
  })

  it('no data: favicon is left', () => {
    const icons = links.filter((l) => /\bicon\b/.test(l.rel ?? ''))
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      expect(icon.href, `<link rel="${icon.rel}">`).not.toMatch(/^data:/)
    }
    expect(html).not.toMatch(/href="data:/)
  })

  it('the theme colour and the home-screen label match the manifest', () => {
    expect(meta('theme-color')).toBe(WEBICON_THEME)
    expect(meta('apple-mobile-web-app-title')).toBe(WEBICON_SHORT_NAME)
    expect(html).toContain(`background: ${WEBICON_THEME};`)
  })
})
