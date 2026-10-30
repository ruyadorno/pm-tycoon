// `vlr art:gallery` (style-guide.md §5): the review artefacts.
// - art/contact/<category>@4x.png (committed): every frame of a category at
//   4x on a neutral or grass backdrop, labelled; locked categories show the
//   full-colour frame next to its _locked frame; `vehicles` puts every
//   heading/frame on a road tile; `city-sample` composes a small block of
//   the city (roads, ground, buildings, props, vehicles) at 1x scale x4.
// - public/gallery/index.json (gitignored): entries, frames, categories,
//   provenance, rejects and candidate copies (public/gallery/candidates/)
//   read by the committed dev page public/gallery.html (1x and 3x views).
// Claude pre-reviews each sheet with the image Read tool before the author.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type Canvas,
  type SKRSContext2D,
  GlobalFonts,
  createCanvas,
} from '@napi-rs/canvas'
import type { StepOpts } from './draw-api.ts'
import { ATLAS_KEYS } from './atlas.ts'
import { decodePng, writeIfChanged } from './iso.ts'
import {
  type Manifest,
  type ManifestEntry,
  ROOT,
  baseFrameNames,
  finalPath,
  frameNames,
  loadManifest,
} from './manifest.ts'
import { PALETTE } from './palette.ts'

export const CONTACT_DIR = join(ROOT, 'art/contact')
export const GALLERY_DIR = join(ROOT, 'public/gallery')
const CANDIDATES_DIR = join(ROOT, 'art/candidates')
const FONT = join(ROOT, 'art/fonts/m5x7.ttf')
const S = 4

export const CATEGORIES = [
  'buildings-downtown',
  'buildings-highres',
  'buildings-industrial',
  'scenery-locked',
  'docks',
  'vehicles',
  'warehouse-exterior',
  'warehouse-interior',
  'procedural',
] as const
export type Category = (typeof CATEGORIES)[number]

const INTERIOR = new Set([
  'interior-tile',
  'fixture',
  'fixture-rack',
  'fixture-shelf',
  'fixture-door',
  'fixture-desk',
  'dock-tail',
  'sign',
  'interior-prop',
  'machine',
  'worker',
])

export function categoryOf(e: ManifestEntry): Category {
  if (e.class.startsWith('vehicle-')) return 'vehicles'
  if (INTERIOR.has(e.class)) return 'warehouse-interior'
  if (e.class === 'warehouse-ext' || /^sign_(days|locked|pop)$/.test(e.id)) {
    return 'warehouse-exterior'
  }
  if (e.id.startsWith('mood_')) return 'procedural'
  if (e.district === 'docks') return 'docks'
  const building = e.class.startsWith('building')
  if (building && e.district === 'downtown') return 'buildings-downtown'
  if (building && e.district === 'highres') return 'buildings-highres'
  if (building && e.district === 'industrial') return 'buildings-industrial'
  if (building || e.class === 'prop') return 'scenery-locked'
  return 'procedural'
}

// ---------------------------------------------------------------------------
// Drawing helpers

let fontOk: boolean | null = null
function label(ctx: SKRSContext2D, text: string, x: number, y: number): void {
  if (fontOk === null) {
    try {
      fontOk =
        existsSync(FONT) && GlobalFonts.registerFromPath(FONT, 'm5x7') !== null
    } catch {
      fontOk = false
    }
  }
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.font = fontOk ? '32px m5x7' : '20px sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(text, x, y)
}

/** a PNG as a canvas (synchronous decode; napi Image decodes lazily) */
function loadPng(path: string): Canvas {
  const { rgba, w, h } = decodePng(readFileSync(path))
  const cv = createCanvas(w, h)
  const ctx = cv.getContext('2d')
  const data = ctx.createImageData(w, h)
  data.data.set(rgba)
  ctx.putImageData(data, 0, 0)
  return cv
}

interface Cell {
  name: string
  path: string
  tag?: string
  under?: string // optional backdrop frame path (vehicles on a road)
}

function backdrop(cat: Category): string {
  if (cat === 'warehouse-interior' || cat === 'procedural') {
    return PALETTE.hex('grey4')
  }
  return PALETTE.hex('grass3')
}

/** shelf-pack cells into rows up to `maxW` px (1x), draw at S x */
function sheet(cells: Cell[], bg: string, maxW = 720): Canvas {
  const gap = 6
  const labelH = 10
  const imgs = cells.map((c) => ({ c, im: loadPng(c.path) }))
  const rows: { items: typeof imgs; h: number }[] = []
  let row: typeof imgs = []
  let x = gap
  let rh = 0
  for (const it of imgs) {
    const w = Math.max(it.im.width, 48)
    if (x + w + gap > maxW && row.length) {
      rows.push({ items: row, h: rh })
      row = []
      x = gap
      rh = 0
    }
    row.push(it)
    x += w + gap
    rh = Math.max(rh, it.im.height)
  }
  if (row.length) rows.push({ items: row, h: rh })
  const W = maxW
  const H = rows.reduce((a, r) => a + r.h + labelH + gap, gap)
  const cv = createCanvas(W * S, H * S)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cv.width, cv.height)
  let y = gap
  for (const r of rows) {
    let cx = gap
    for (const { c, im } of r.items) {
      const w = Math.max(im.width, 48)
      const dy = y + r.h - im.height
      const dx = cx + Math.floor((w - im.width) / 2)
      if (c.under) {
        const u = loadPng(c.under)
        ctx.drawImage(
          u,
          (dx + im.width / 2 - u.width / 2) * S,
          (dy + im.height * 0.75 - u.height / 2) * S,
          u.width * S,
          u.height * S,
        )
      }
      ctx.drawImage(im, dx * S, dy * S, im.width * S, im.height * S)
      label(
        ctx,
        c.tag ? `${c.name} ${c.tag}` : c.name,
        cx * S,
        (y + r.h + 1) * S,
      )
      cx += w + gap
    }
    y += r.h + labelH + gap
  }
  return cv
}

function cellsFor(m: Manifest, cat: Category): Cell[] {
  const out: Cell[] = []
  const road = m.entries.find((e) => e.id === 'road')
  for (const e of m.entries) {
    if (categoryOf(e) !== cat) continue
    const tag = e.placeholder ? '[PH]' : e.approved ? '[OK]' : undefined
    for (const name of frameNames(e)) {
      const path = finalPath(e, name)
      if (!existsSync(path)) continue
      const cell: Cell = { name, path, tag }
      if (cat === 'vehicles' && road) {
        const h = /_(ne|se|sw|nw)_/.exec(name)?.[1]
        const mask = h === 'ne' || h === 'sw' ? '_05' : '_10'
        const rp = finalPath(road, 'road' + mask)
        if (existsSync(rp)) cell.under = rp
      }
      out.push(cell)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// City sample: a 10 x 10 tile block composed from the finals

function sampleRoad(tx: number, ty: number): boolean {
  return tx === 4 || ty === 5
}

function sampleMask(tx: number, ty: number): number {
  return (
    (sampleRoad(tx, ty - 1) ? 1 : 0) |
    (sampleRoad(tx + 1, ty) ? 2 : 0) |
    (sampleRoad(tx, ty + 1) ? 4 : 0) |
    (sampleRoad(tx - 1, ty) ? 8 : 0)
  )
}

function citySample(m: Manifest): Canvas | null {
  const get = (frame: string): Canvas | null => {
    for (const e of m.entries) {
      if (frameNames(e).includes(frame)) {
        const p = finalPath(e, frame)
        return existsSync(p) ? loadPng(p) : null
      }
    }
    return null
  }
  const n = 10
  const ox = n * 32
  const top = 160
  const W = n * 64
  const H = n * 32 + top + 8
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const scr = (tx: number, ty: number) => ({
    x: ox + (tx - ty) * 32,
    y: top + (tx + ty) * 16,
  })
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      let f = tx < 4 && ty > 5 ? 'grass' : 'pavement'
      if (tx > 7 && ty > 6) f = 'water_f0'
      if (sampleRoad(tx, ty)) {
        const mk = sampleMask(tx, ty)
        const inside = (x: number, y: number) =>
          x >= 0 && y >= 0 && x < n && y < n
        // edges of the sample count as connected
        let full = mk
        if (tx === 4 && !inside(tx, ty - 1)) full |= 1
        if (tx === 4 && !inside(tx, ty + 1)) full |= 4
        if (ty === 5 && !inside(tx + 1, ty)) full |= 2
        if (ty === 5 && !inside(tx - 1, ty)) full |= 8
        f = `road_${String(full).padStart(2, '0')}`
      }
      const im = get(f)
      if (!im) continue
      const p = scr(tx, ty)
      ctx.drawImage(im, p.x - 32, p.y - 16)
    }
  }
  // buildings (anchor = bottom vertex of the max tile), props, vehicles
  const objs: {
    d: number
    frame: string
    x: number
    y: number
    vehicle?: boolean
  }[] = []
  const place = (frame: string, tx: number, ty: number, fp: number) => {
    const ax = tx + fp - 1
    const ay = ty + fp - 1
    const p = scr(ax, ay)
    objs.push({ d: ax + ay, frame, x: p.x, y: p.y + 16 })
  }
  place('dt_registry_tower', 0, 0, 3)
  place('dt_semver_bank', 5, 0, 2)
  place('dt_cache_cafe', 7, 0, 1)
  place('dt_bundle_boutique', 8, 1, 1)
  place('hr_async_arms', 5, 2, 2)
  place('hr_pizza', 7, 3, 1)
  place('dt_scope_offices', 0, 3, 2)
  place('hr_towers_b', 5, 6, 3)
  place('in_glob_silos_locked', 0, 6, 2)
  place('hr_is_odd_store', 2, 8, 1)
  place('tree_round', 3, 4, 1)
  place('lamp_post', 3, 0, 1)
  place('bush', 9, 2, 1)
  // vehicles join the same depth sort (fractional tile = tile centre)
  for (const [frame, tx, ty] of [
    ['van_sw_0', 4, 2],
    ['bike_se_1', 7, 5],
    ['truck_ne_0', 4, 7],
  ] as const) {
    const p = scr(tx, ty)
    objs.push({ d: tx + ty + 0.5, frame, x: p.x, y: p.y, vehicle: true })
  }
  objs.sort((a, b) => a.d - b.d)
  for (const o of objs) {
    const im = get(o.frame)
    if (!im) continue
    if (o.vehicle) {
      ctx.drawImage(im, o.x - im.width / 2, o.y - Math.round(im.height * 0.75))
    } else ctx.drawImage(im, o.x - im.width / 2, o.y - im.height)
  }
  const big = createCanvas(W * S, H * S)
  const bctx = big.getContext('2d')
  bctx.imageSmoothingEnabled = false
  bctx.drawImage(cv, 0, 0, W * S, H * S)
  return big
}

// ---------------------------------------------------------------------------
// Staleness (lint A12) and candidates

function newest(paths: string[]): number {
  let t = 0
  for (const p of paths) if (existsSync(p)) t = Math.max(t, statSync(p).mtimeMs)
  return t
}

export function contactStaleness(m: Manifest): string[] {
  const out: string[] = []
  for (const cat of CATEGORIES) {
    const sheetPath = join(CONTACT_DIR, `${cat}@4x.png`)
    const finals = m.entries
      .filter((e) => categoryOf(e) === cat)
      .flatMap((e) => frameNames(e).map((n) => finalPath(e, n)))
    if (finals.length === 0) continue
    if (!existsSync(sheetPath)) {
      out.push(`contact sheet ${cat}@4x.png missing (art:gallery)`)
    } else if (statSync(sheetPath).mtimeMs + 1 < newest(finals)) {
      out.push(`contact sheet ${cat}@4x.png older than its finals`)
    }
  }
  return out
}

export interface CandidateFile {
  /** candidate number (the `chosenCandidate` / `vlr art:approve -- id:n` value) */
  n: number
  path: string
}

/**
 * One preview PNG per candidate of an id, sorted by candidate number. Layout
 * art/candidates/<id>/<n>/{raw/, <frame>.png, meta.json} (gen.ts; the frame
 * file is 'base.png' for the '' suffix, else the suffix without its '_'):
 * the preview is base.png, else the entry's first frame (`firstSuffix`),
 * else the first processed PNG of the directory. The legacy flat layout
 * <id>/<n>.png is still read.
 */
export function candidatesOf(id: string, firstSuffix = ''): CandidateFile[] {
  const dir = join(CANDIDATES_DIR, id)
  if (!existsSync(dir)) return []
  const out: CandidateFile[] = []
  for (const f of readdirSync(dir)) {
    const legacy = /^(\d+)\.png$/.exec(f)
    if (legacy) {
      out.push({ n: Number(legacy[1]), path: join(dir, f) })
      continue
    }
    if (!/^\d+$/.test(f)) continue
    const cdir = join(dir, f)
    if (!statSync(cdir).isDirectory()) continue
    const stem = firstSuffix === '' ? 'base' : firstSuffix.replace(/^_/, '')
    const pick = ['base.png', `${stem}.png`].find((x) =>
      existsSync(join(cdir, x)),
    )
    const first =
      pick ??
      readdirSync(cdir)
        .filter((x) => x.endsWith('.png'))
        .toSorted()[0]
    if (first) out.push({ n: Number(f), path: join(cdir, first) })
  }
  return out.toSorted((a, b) => a.n - b.n)
}

/** a sheet of candidates side by side (gen's vision pass, anchors@4x) */
export function candidateSheet(ids: string[], out: string): boolean {
  const cells: Cell[] = []
  for (const id of ids) {
    for (const c of candidatesOf(id)) {
      cells.push({ name: `${id}:${c.n}`, path: c.path })
    }
  }
  if (cells.length === 0) return false
  return writeIfChanged(
    out,
    sheet(cells, PALETTE.hex('grass3'), 900).toBuffer('image/png'),
  )
}

// ---------------------------------------------------------------------------

export function run(opts: StepOpts): number {
  void opts
  const m = loadManifest()
  mkdirSync(CONTACT_DIR, { recursive: true })
  const written: string[] = []
  for (const cat of CATEGORIES) {
    const cells = cellsFor(m, cat)
    if (cells.length === 0) continue
    const max = cat === 'warehouse-interior' || cat === 'procedural' ? 640 : 720
    const cv = sheet(cells, backdrop(cat), max)
    const p = join(CONTACT_DIR, `${cat}@4x.png`)
    if (writeIfChanged(p, cv.toBuffer('image/png'))) written.push(cat)
  }
  const sample = citySample(m)
  if (sample) {
    const p = join(CONTACT_DIR, 'city-sample@4x.png')
    if (writeIfChanged(p, sample.toBuffer('image/png')))
      written.push('city-sample')
  }
  // gallery data for public/gallery.html
  const entries = m.entries.map((e) => {
    const cands = candidatesOf(e.id, e.frames[0])
    const copied = cands.map((c) => {
      const rel = `candidates/${e.id}/${c.n}.png`
      const dst = join(GALLERY_DIR, rel)
      mkdirSync(join(GALLERY_DIR, 'candidates', e.id), { recursive: true })
      copyFileSync(c.path, dst)
      return rel
    })
    return {
      id: e.id,
      class: e.class,
      category: categoryOf(e),
      district: e.district ?? null,
      source: e.source,
      placeholder: e.placeholder,
      approved: e.approved,
      approvedBy: e.approvedBy ?? null,
      priority: e.priority,
      anchor: e.anchorRole === 'anchor',
      frames: frameNames(e).filter((n) => existsSync(finalPath(e, n))),
      base: baseFrameNames(e),
      candidates: copied,
      chosenCandidate: e.chosenCandidate ?? null,
      rejects: e.rejects,
      note: e.note ?? null,
    }
  })
  const index = {
    generated: 'tools/art/gallery.ts',
    // served raw by `vlr dev` from src/assets (builds hash them, B2 §6.8)
    atlases: ATLAS_KEYS.map((key) => ({
      key,
      png: `/src/assets/${key}.png`,
      json: `/src/assets/${key}.json`,
    })),
    categories: CATEGORIES,
    sheets: [...CATEGORIES, 'city-sample'].map(
      (c) => `art/contact/${c}@4x.png`,
    ),
    palette: PALETTE.colors.map((c) => ({
      id: c.id,
      hex: c.hex,
      ramp: c.ramp,
    })),
    entries,
  }
  writeIfChanged(
    join(GALLERY_DIR, 'index.json'),
    Buffer.from(JSON.stringify(index, null, 1) + '\n'),
  )
  console.log(
    `gallery: ${CATEGORIES.length} contact sheets + city-sample ` +
      `(${written.length ? 'changed: ' + written.join(', ') : 'unchanged'}); ` +
      'public/gallery/index.json',
  )
  return 0
}
