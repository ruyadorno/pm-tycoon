// Contact sheets for the PixelLab vision pass (style-guide.md §3.5, §5 G2).
// Reads candidates from art/candidates/<id>/<n>/<frame>.png (gen.ts) and
// the procedural finals (read-only) and writes only:
//   art/contact/anchors@4x.png            per anchor id: the procedural
//     placeholder, then every candidate, each composited at 1x on its
//     ground (buildings on a grass|pavement patch, vehicles on road tiles,
//     machines on the floor + belt column, the worker on floor tiles), with
//     the fogged `_locked` derivative next to entries that ship locked;
//     the whole sheet scaled x4, labels drawn at 4x.
//   art/contact/anchors-incontext@4x.png  every candidate among procedural
//     neighbours: buildings on a small street between two procedural
//     buildings of the same district (a van on the road), the van at a
//     crossing in all four headings, the machine in the lane over the belt
//     next to the procedural shaker, the worker at the desk next to the
//     procedural worker.
//   art/contact/candidates-<k>@4x.png     the same blocks for a bulk batch.
// Never writes art/final, the manifest or public/.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Canvas,
  type SKRSContext2D,
  GlobalFonts,
  createCanvas,
} from '@napi-rs/canvas'
import { frameStem } from './candidates.ts'
import {
  type Img,
  decodePng,
  imgToRgba,
  readImg,
  writeIfChanged,
} from './iso.ts'
import {
  type Manifest,
  type ManifestEntry,
  ROOT,
  finalPath,
} from './manifest.ts'
import { PALETTE } from './palette.ts'
import { fogImg } from './variants.ts'

const SCALE = 4
const FONT = join(ROOT, 'art/fonts/m5x7.ttf')
const CONTACT = join(ROOT, 'art/contact')
const CANDIDATES = join(ROOT, 'art/candidates')

// ---------------------------------------------------------------------------
// helpers

function candNumbers(id: string): number[] {
  const dir = join(CANDIDATES, id)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d+$/.test(f))
    .map(Number)
    .toSorted((a, b) => a - b)
}

function imgCanvas(img: Img): Canvas {
  const cv = createCanvas(img.w, img.h)
  const ctx = cv.getContext('2d')
  const data = ctx.createImageData(img.w, img.h)
  data.data.set(imgToRgba(img))
  ctx.putImageData(data, 0, 0)
  return cv
}

function pngCanvas(path: string): Canvas | null {
  if (!existsSync(path)) return null
  const { rgba, w, h } = decodePng(readFileSync(path))
  const cv = createCanvas(w, h)
  const ctx = cv.getContext('2d')
  const data = ctx.createImageData(w, h)
  data.data.set(rgba)
  ctx.putImageData(data, 0, 0)
  return cv
}

function entry(m: Manifest, id: string): ManifestEntry | undefined {
  return m.entries.find((e) => e.id === id)
}

/** a final frame of the manifest (procedural / current) */
function fin(m: Manifest, id: string, suffix = ''): Canvas | null {
  const e = entry(m, id)
  return e ? pngCanvas(finalPath(e, id + suffix)) : null
}

/** frames of one source: the placeholder (n = -1) or candidate n */
type Source = { n: number; get(suffix: string): Canvas | null; tag: string }

/** the staged decision of an id (choices.json): candidate n, -1 = keep */
function decision(id: string): number | null {
  const p = join(CANDIDATES, 'choices.json')
  if (!existsSync(p)) return null
  const c = (
    JSON.parse(readFileSync(p, 'utf8')) as Record<
      string,
      { candidate?: number; keep?: string }
    >
  )[id]
  if (!c) return null
  return c.candidate ?? (c.keep ? -1 : null)
}

function sources(m: Manifest, e: ManifestEntry): Source[] {
  const d = decision(e.id)
  const out: Source[] = [
    {
      n: -1,
      get: (s) => fin(m, e.id, s),
      tag: `procedural placeholder${d === -1 ? ' = KEEP-PROCEDURAL' : ''}`,
    },
  ]
  for (const n of candNumbers(e.id)) {
    let reject: string | null = null
    const meta = join(CANDIDATES, e.id, String(n), 'meta.json')
    if (existsSync(meta)) {
      reject =
        (JSON.parse(readFileSync(meta, 'utf8')) as { reject?: string })
          .reject ?? null
    }
    out.push({
      n,
      get: (s) =>
        pngCanvas(join(CANDIDATES, e.id, String(n), `${frameStem(s)}.png`)),
      tag: `#${n}${d === n ? ' = CHOSEN' : ''}${reject ? ` [${reject.split(' ')[0]}]` : ''}`,
    })
  }
  return out
}

/** iso screen position of a tile's top vertex (origin at ox, oy) */
const scr = (ox: number, oy: number, tx: number, ty: number) => ({
  x: ox + (tx - ty) * 32,
  y: oy + (tx + ty) * 16,
})

// ---------------------------------------------------------------------------
// blocks (1x canvases)

interface Block {
  cv: Canvas
  label: string
}

function buildingBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  if (e.frames.length > 1 || e.frames[0] !== '') {
    // multi-frame city sprite (wh_ext _t1/_t2): one block per frame
    return e.frames.flatMap((f) =>
      buildingBlock(
        m,
        { ...e, frames: [''], variants: [] },
        {
          ...src,
          get: (s) => src.get(s === '' ? f : s),
          tag: `${src.tag} ${f.replace(/^_/, '')}`,
        },
      ),
    )
  }
  const sprite = src.get('')
  const fp = e.footprint?.[0] ?? 2
  const n = fp + 2
  const top = e.canvas[1] - 32 * fp
  const W = n * 64
  const H = n * 32 + top
  const mk = (img: Canvas | null, label: string): Block => {
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    const ox = W / 2 - 32
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const t = fin(
          m,
          e.class === 'warehouse-ext'
            ? 'lot_concrete'
            : tx < n / 2
              ? 'grass'
              : 'pavement',
        )
        if (!t) continue
        const p = scr(ox, top, tx, ty)
        ctx.drawImage(t, p.x, p.y)
      }
    }
    if (img) {
      // anchor = bottom vertex of the footprint's max tile (1+fp-1)
      const p = scr(ox, top, fp, fp)
      ctx.drawImage(img, p.x + 32 - img.width / 2, p.y + 32 - img.height)
    }
    return { cv, label }
  }
  const out = [mk(sprite, src.tag)]
  if (e.variants.includes('locked') && sprite) {
    const path =
      src.n < 0
        ? finalPath(e, `${e.id}_locked`)
        : join(CANDIDATES, e.id, String(src.n), 'base.png')
    const locked =
      src.n < 0
        ? pngCanvas(path)
        : existsSync(path)
          ? imgCanvas(fogImg(readImg(path).img))
          : null
    out.push(mk(locked, `${src.n < 0 ? 'PH' : `#${src.n}`} _locked`))
  }
  return out
}

function vehicleBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const cell = 64
  const H = 48
  const cv = createCanvas(cell * 8, H)
  const ctx = cv.getContext('2d')
  let i = 0
  for (const h of ['ne', 'se', 'sw', 'nw']) {
    for (const f of [0, 1]) {
      const road = fin(m, 'road', h === 'ne' || h === 'sw' ? '_05' : '_10')
      const x = i * cell
      if (road) ctx.drawImage(road, x, H - 32 - 4)
      const v = src.get(`_${h}_${f}`)
      if (v) {
        // origin (0.5, 0.75) at the tile centre
        ctx.drawImage(
          v,
          x + 32 - v.width / 2,
          H - 20 - Math.round(v.height * 0.75),
        )
      }
      i++
    }
  }
  return [{ cv, label: `${src.tag}  ne0 ne1 se0 se1 sw0 sw1 nw0 nw1` }]
}

function machineBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const out: Block[] = []
  for (const f of e.frames) {
    const cv = createCanvas(96, 64)
    const ctx = cv.getContext('2d')
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        const t = x === 1 ? fin(m, 'belt_v', '_0') : fin(m, 'floor_t1', '_0')
        if (t) ctx.drawImage(t, x * 32, y * 32)
      }
    }
    const im = src.get(f)
    if (im) ctx.drawImage(im, 32 - 8, 64 - im.height)
    out.push({ cv, label: `${src.tag} ${f.replace(/^_/, '')}` })
  }
  return out
}

const WORKER_SHOW = [
  '_s_idle_0',
  '_n_idle_0',
  '_e_idle_0',
  '_w_idle_0',
  '_s_idle_1',
  '_s_walk_0',
  '_s_walk_1',
  '_e_walk_0',
  '_e_walk_1',
  '_s_scan_0',
  '_s_scan_1',
  '_e_scan_1',
  '_s_jump',
  '_e_jump',
]

function workerBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const cv = createCanvas(32 * WORKER_SHOW.length, 32)
  const ctx = cv.getContext('2d')
  WORKER_SHOW.forEach((f, i) => {
    const t = fin(m, 'floor_t1', '_0')
    if (t) ctx.drawImage(t, i * 32, 0)
    const im = src.get(f)
    if (im) ctx.drawImage(im, i * 32 + 4, 0)
  })
  return [
    {
      cv,
      label: `${src.tag}  idle s n e w | s idle1 | walk s0 s1 e0 e1 | scan s0 s1 e1 | jump s e`,
    },
  ]
}

/** prop / dock-prop on a 3x3 grass (or water) patch, with its _locked */
function propBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const n = 3
  const top = e.canvas[1]
  const W = n * 64
  const H = n * 32 + top - 32
  const mk = (img: Canvas | null, label: string): Block => {
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    const ox = W / 2 - 32
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const t =
          e.class === 'dock-prop' ? fin(m, 'water', '_f0') : fin(m, 'grass')
        if (!t) continue
        const p = scr(ox, top - 32, tx, ty)
        ctx.drawImage(t, p.x, p.y)
      }
    }
    if (img) {
      // anchor = bottom vertex of the centre tile (2x2 rule for the ship)
      const k = e.class === 'dock-prop' ? 2 : 1
      const p = scr(ox, top - 32, k, k)
      ctx.drawImage(img, p.x + 32 - img.width / 2, p.y + 32 - img.height)
    }
    return { cv, label }
  }
  const sprite = src.get('')
  const out = [mk(sprite, src.tag)]
  if (e.variants.includes('locked') && sprite) {
    const locked =
      src.n < 0
        ? fin(m, e.id, '_locked')
        : imgCanvas(
            fogImg(
              readImg(join(CANDIDATES, e.id, String(src.n), 'base.png')).img,
            ),
          )
    out.push(mk(locked, `${src.n < 0 ? 'PH' : `#${src.n}`} _locked`))
  }
  return out
}

/** interior fixture (shelf, desk) on floor tiles with a 1-cell margin */
function fixtureBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const [w, h] = e.canvas
  const cw = Math.ceil(w / 32) + 2
  const ch = Math.ceil(h / 32) + 2
  const cv = createCanvas(cw * 32, ch * 32)
  const ctx = cv.getContext('2d')
  const tier2 = e.id.endsWith('_t2')
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const t = tier2
        ? fin(m, 'floor_t2')
        : fin(m, 'floor_t1', `_${(x + y) % 3}`)
      if (t) ctx.drawImage(t, x * 32, y * 32)
    }
  }
  const im = src.get(e.frames[0] ?? '')
  if (im) ctx.drawImage(im, 32, 32)
  if (e.class === 'fixture-shelf') {
    // the in-engine contents: parcel minis on the boards (rows y 6/18/30)
    const minis = [
      'parcel_mini_s',
      'parcel_mini_m',
      'parcel_mini_l',
      'parcel_mini_xl',
    ]
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        const mi = fin(m, minis[(r + c) % 4] as string)
        if (mi) ctx.drawImage(mi, 32 + 6 + c * 34 - 3, 32 + 6 + r * 12 - 3)
      }
    }
  }
  return [{ cv, label: src.tag }]
}

function blocksFor(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  if (e.class.startsWith('building') || e.class === 'warehouse-ext') {
    return buildingBlock(m, e, src)
  }
  if (e.class === 'prop' || e.class === 'dock-prop') return propBlock(m, e, src)
  if (e.class === 'fixture-shelf' || e.class === 'fixture-desk') {
    return fixtureBlock(m, e, src)
  }
  if (e.class.startsWith('vehicle-')) return vehicleBlock(m, e, src)
  if (e.class === 'worker') return workerBlock(m, e, src)
  return machineBlock(m, e, src)
}

// ---------------------------------------------------------------------------
// in-context scenes (1x)

const NEIGHBOURS: Record<string, [string, string]> = {
  downtown: ['dt_semver_bank', 'dt_lockfile_legal'],
  highres: ['hr_callback_court', 'hr_promise_place'],
  industrial: ['in_webpack_warehouse', 'in_polyfill_plastics'],
  civic: ['lr_villa', 'dt_semver_bank'],
}

function streetScene(
  m: Manifest,
  e: ManifestEntry,
  subject: Canvas | null,
  locked: boolean,
): Canvas {
  const nx = 6
  const ny = 4
  const top = 100
  const W = (nx + ny) * 32
  const H = (nx + ny) * 16 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = ny * 32 - 32
  const L = locked ? '_locked' : ''
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const t =
        ty === 2
          ? fin(m, 'road', '_10')
          : fin(m, e.district === 'civic' ? 'grass' : 'pavement', L)
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const [a, b] = NEIGHBOURS[e.district ?? ''] ?? NEIGHBOURS.downtown!
  const lots: [Canvas | null, number][] = [
    [fin(m, a, entry(m, a)?.variants.includes('locked') ? L : ''), 0],
    [subject, 2],
    [fin(m, b, entry(m, b)?.variants.includes('locked') ? L : ''), 4],
  ]
  for (const [im, tx] of lots) {
    if (!im) continue
    const p = scr(ox, top, tx + 1, 1)
    ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height)
  }
  // the procedural van on the road, for scale
  const van = fin(m, 'van', '_se_0')
  if (van) {
    const p = scr(ox, top, 1, 2)
    ctx.drawImage(van, p.x + 32 - 16, p.y + 16 - 24)
  }
  return cv
}

function vanScene(m: Manifest, src: Source, e?: ManifestEntry): Canvas {
  const n = 6
  const top = 100
  const W = n * 64
  const H = n * 32 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = W / 2 - 32
  const road = (tx: number, ty: number) =>
    tx === 3 && ty === 3 ? '_15' : tx === 3 ? '_05' : ty === 3 ? '_10' : null
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const r = road(tx, ty)
      const t = r ? fin(m, 'road', r) : fin(m, 'pavement')
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const objs: { d: number; draw: () => void }[] = []
  const bld = (id: string, tx: number, ty: number) => {
    const im = fin(m, id)
    if (!im) return
    const p = scr(ox, top, tx + 1, ty + 1)
    objs.push({
      d: tx + ty + 2,
      draw: () =>
        ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
    })
  }
  bld('dt_semver_bank', 0, 0)
  bld('hr_async_arms', 4, 0)
  bld('dt_lockfile_legal', 0, 4)
  bld('hr_promise_place', 4, 4)
  const veh = (im: Canvas | null, tx: number, ty: number) => {
    if (!im) return
    const p = scr(ox, top, tx, ty)
    objs.push({
      d: tx + ty + 0.5,
      draw: () =>
        ctx.drawImage(
          im,
          p.x + 32 - im.width / 2,
          p.y + 16 - Math.round(im.height * 0.75),
        ),
    })
  }
  veh(src.get('_ne_0'), 3, 1)
  veh(src.get('_sw_0'), 3, 5)
  veh(src.get('_se_0'), 1, 3)
  veh(src.get('_nw_0'), 5, 3)
  if (e && e.id !== 'van') {
    veh(chosen(m, 'van', '_se_0') ?? fin(m, 'van', '_se_0'), 0, 3)
    veh(chosen(m, 'van', '_ne_0') ?? fin(m, 'van', '_ne_0'), 3, 0)
  } else {
    veh(fin(m, 'truck', '_se_0'), 0, 3)
    veh(fin(m, 'bike', '_ne_0'), 3, 0)
  }
  objs.sort((a, b) => a.d - b.d)
  for (const o of objs) o.draw()
  return cv
}

function laneScene(m: Manifest, e: ManifestEntry, src: Source): Canvas {
  const cv = createCanvas(160, 192)
  const ctx = cv.getContext('2d')
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 5; x++) {
      const t =
        x === 2 ? fin(m, 'belt_v', '_0') : fin(m, 'floor_t1', `_${(x + y) % 3}`)
      if (t) ctx.drawImage(t, x * 32, y * 32)
    }
  }
  const parcel = fin(m, 'parcel_m')
  if (parcel) ctx.drawImage(parcel, 64, 96)
  const im = src.get(e.frames[1] ?? e.frames[0] ?? '')
  if (im) ctx.drawImage(im, 64 - 8, 80 - im.height)
  const shaker = fin(m, 'shaky_shaker', '_f0')
  if (shaker) ctx.drawImage(shaker, 64 - 8, 176 - shaker.height)
  return cv
}

function deskScene(m: Manifest, src: Source): Canvas {
  const cv = createCanvas(128, 96)
  const ctx = cv.getContext('2d')
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      const t = fin(m, 'floor_t1', `_${(x + y) % 3}`)
      if (t) ctx.drawImage(t, x * 32, y * 32)
    }
  }
  const desk = fin(m, 'desk')
  const ph = fin(m, 'worker', '_s_idle_0')
  const w = src.get('_s_scan_0') ?? src.get('_s_idle_0')
  if (ph) ctx.drawImage(ph, 12, 16)
  if (w) ctx.drawImage(w, 44, 16)
  if (desk) ctx.drawImage(desk, 40, 52)
  const we = src.get('_e_walk_0')
  if (we) ctx.drawImage(we, 92, 50)
  return cv
}

/** the chosen (staged) candidate frame of an id, from choices.json */
function chosen(m: Manifest, id: string, suffix = ''): Canvas | null {
  const p = join(CANDIDATES, 'choices.json')
  if (!existsSync(p)) return null
  const c = (
    JSON.parse(readFileSync(p, 'utf8')) as Record<
      string,
      { candidate?: number }
    >
  )[id]
  if (c?.candidate === undefined) return null
  return pngCanvas(
    join(CANDIDATES, id, String(c.candidate), `${frameStem(suffix)}.png`),
  )
}

/** generated (chosen) neighbours of a district first, then procedural */
function neighbours(
  m: Manifest,
  e: ManifestEntry,
  k = 2,
): { cv: Canvas; fp: number }[] {
  const out: { cv: Canvas; fp: number }[] = []
  const same = m.entries.filter(
    (x) =>
      x.id !== e.id &&
      x.district === e.district &&
      x.class.startsWith('building') &&
      (x.footprint?.[0] ?? 1) <= 2,
  )
  // chosen 2x2 / 1x1 neighbours of the district (the anchor first)
  const ranked = same.toSorted(
    (a, b) => (b.anchorRole ? 1 : 0) - (a.anchorRole ? 1 : 0),
  )
  for (const x of ranked) {
    const cv = chosen(m, x.id)
    if (cv) out.push({ cv, fp: x.footprint?.[0] ?? 1 })
    if (out.length >= k) return out
  }
  for (const id of NEIGHBOURS[e.district ?? ''] ?? NEIGHBOURS.downtown!) {
    const x = entry(m, id)
    const cv = chosen(m, id) ?? fin(m, id)
    if (x && cv) out.push({ cv, fp: x.footprint?.[0] ?? 2 })
    if (out.length >= k) return out
  }
  return out
}

/**
 * a row of lots along a road: neighbour, subject, neighbour (painter's
 * order), the chosen van on the road for scale; `locked` fogs it all.
 */
function rowScene(
  m: Manifest,
  e: ManifestEntry,
  subject: Canvas | null,
  locked: boolean,
): Canvas {
  const fpS = e.footprint?.[0] ?? 1
  const ns = neighbours(m, e)
  const lots = [ns[0], { cv: subject, fp: fpS }, ns[1]].filter(
    (x): x is { cv: Canvas | null; fp: number } => !!x,
  )
  const maxFp = Math.max(...lots.map((l) => l.fp))
  const nx = lots.reduce((a, l) => a + l.fp, 0) + lots.length + 1
  const ny = maxFp + 2
  const top = Math.max(
    ...lots.map((l) => (l.cv ? l.cv.height - 32 * l.fp : 0)),
    40,
  )
  const W = (nx + ny) * 32
  const H = (nx + ny) * 16 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = ny * 32 - 32
  const L = locked ? '_locked' : ''
  const ground = ['civic', 'lowres', 'rural'].includes(e.district ?? '')
    ? 'grass'
    : 'pavement'
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const t = ty === maxFp ? fin(m, 'road', '_10') : fin(m, ground, L)
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  let x = 1
  const draws: { d: number; f: () => void }[] = []
  for (const l of lots) {
    const tx = x + l.fp - 1
    const ty = maxFp - 1
    const im = l.cv && locked && l.cv !== subject ? l.cv : l.cv
    if (im) {
      const p = scr(ox, top, tx, ty)
      draws.push({
        d: tx + ty,
        f: () =>
          ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
      })
    }
    x += l.fp + 1
  }
  const van = chosen(m, 'van', '_se_0') ?? fin(m, 'van', '_se_0')
  if (van && !locked) {
    const p = scr(ox, top, 2, maxFp)
    draws.push({
      d: 2 + maxFp + 0.5,
      f: () => ctx.drawImage(van, p.x + 32 - 16, p.y + 16 - 24),
    })
  }
  draws.sort((a, b) => a.d - b.d)
  for (const d of draws) d.f()
  return cv
}

/** bulk in-context blocks: buildings in a row among chosen neighbours */
function bulkContextFor(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  if (e.class.startsWith('building')) {
    const sub = src.get('')
    const shipsLocked = e.variants.includes('locked') && e.priority === 'P2'
    if (shipsLocked && sub) {
      // locked scenery ships only fogged in playtest 1: show that look
      const lk =
        src.n < 0
          ? fin(m, e.id, '_locked')
          : imgCanvas(
              fogImg(
                readImg(join(CANDIDATES, e.id, String(src.n), 'base.png')).img,
              ),
            )
      return [{ cv: rowScene(m, e, lk, true), label: `${src.tag} _locked` }]
    }
    return [{ cv: rowScene(m, e, sub, false), label: src.tag }]
  }
  if (e.class.startsWith('vehicle-'))
    return [{ cv: vanScene(m, src, e), label: src.tag }]
  return []
}

function contextFor(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  if (e.class.startsWith('building')) {
    const sub = src.get('')
    const out = [{ cv: streetScene(m, e, sub, false), label: src.tag }]
    if (e.variants.includes('locked') && e.district === 'civic') {
      const lk =
        src.n < 0
          ? fin(m, e.id, '_locked')
          : sub
            ? imgCanvas(
                fogImg(
                  readImg(join(CANDIDATES, e.id, String(src.n), 'base.png'))
                    .img,
                ),
              )
            : null
      out.push({ cv: streetScene(m, e, lk, true), label: `${src.tag} _locked` })
    }
    return out
  }
  if (e.class.startsWith('vehicle-'))
    return [{ cv: vanScene(m, src), label: src.tag }]
  if (e.class === 'worker') return [{ cv: deskScene(m, src), label: src.tag }]
  return [{ cv: laneScene(m, e, src), label: src.tag }]
}

// ---------------------------------------------------------------------------
// sheet assembly

let fontOk: boolean | null = null
function label(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  px = 32,
) {
  if (fontOk === null) {
    try {
      fontOk =
        existsSync(FONT) && GlobalFonts.registerFromPath(FONT, 'm5x7') !== null
    } catch {
      fontOk = false
    }
  }
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.font = fontOk ? `${px}px m5x7` : `${Math.round(px * 0.6)}px sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText(text, x, y)
}

interface Section {
  title: string
  blocks: Block[]
}

/** sections of shelf-packed blocks, 1x content scaled S x, labels at S x */
function render(
  sections: Section[],
  bg: string,
  maxW: number,
  S = SCALE,
): Buffer {
  const gap = 8
  const lab = 9
  const title = 14
  type Row = { items: Block[]; h: number }
  const laid: { s: Section; rows: Row[] }[] = sections.map((s) => {
    const rows: Row[] = []
    let row: Block[] = []
    let x = gap
    let h = 0
    for (const b of s.blocks) {
      if (x + b.cv.width + gap > maxW && row.length) {
        rows.push({ items: row, h })
        row = []
        x = gap
        h = 0
      }
      row.push(b)
      x += b.cv.width + gap
      h = Math.max(h, b.cv.height)
    }
    if (row.length) rows.push({ items: row, h })
    return { s, rows }
  })
  const W = Math.max(
    ...laid.flatMap((l) =>
      l.rows.map((r) => r.items.reduce((a, b) => a + b.cv.width + gap, gap)),
    ),
  )
  const H = laid.reduce(
    (a, l) => a + title + l.rows.reduce((b, r) => b + r.h + lab + gap, 0),
    gap,
  )
  const cv = createCanvas(W * S, H * S)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cv.width, cv.height)
  let y = gap
  for (const { s, rows } of laid) {
    label(ctx, s.title, gap * S, y * S, 12 * S)
    y += title
    for (const r of rows) {
      let x = gap
      for (const b of r.items) {
        ctx.drawImage(
          b.cv,
          x * S,
          (y + r.h - b.cv.height) * S,
          b.cv.width * S,
          b.cv.height * S,
        )
        label(ctx, b.label, x * S, (y + r.h + 1) * S, 8 * S)
        x += b.cv.width + gap
      }
      y += r.h + lab + gap
    }
  }
  return cv.toBuffer('image/png')
}

export function anchorSheets(m: Manifest, ids: string[]): string[] {
  const entries = ids
    .map((id) => entry(m, id))
    .filter((e): e is ManifestEntry => !!e)
  const main: Section[] = []
  const ctxs: Section[] = []
  for (const e of entries) {
    const srcs = sources(m, e)
    main.push({
      title: `${e.id} (${e.class}${e.subject ? `: ${e.subject}` : ''})`,
      blocks: srcs.flatMap((s) => blocksFor(m, e, s)),
    })
    ctxs.push({
      title: `${e.id} in context`,
      blocks: srcs.flatMap((s) => contextFor(m, e, s)),
    })
  }
  const a = join(CONTACT, 'anchors@4x.png')
  const b = join(CONTACT, 'anchors-incontext@4x.png')
  writeIfChanged(a, render(main, PALETTE.hex('grass3'), 1100))
  writeIfChanged(b, render(ctxs, PALETTE.hex('grey5'), 1700))
  return [a.replace(ROOT, ''), b.replace(ROOT, '')]
}

export function candidateSheet(
  m: Manifest,
  ids: string[],
  k: number | string,
  opts: { scale?: number; out?: string; maxW?: number } = {},
): string {
  const sections: Section[] = []
  for (const id of ids) {
    const e = entry(m, id)
    if (!e) continue
    const srcs = sources(m, e)
    sections.push({
      title: `${e.id} (${e.class}${e.subject ? `: ${e.subject}` : ''})`,
      blocks: srcs.flatMap((s) => blocksFor(m, e, s)),
    })
    // in context: the placeholder + the chosen candidate once decided
    // (every candidate while undecided) — keeps the sheet readable
    const d = decision(e.id)
    const ctxSrcs =
      d === null ? srcs : srcs.filter((s) => s.n === -1 || s.n === d)
    const ctxBlocks = ctxSrcs.flatMap((s) => bulkContextFor(m, e, s))
    if (ctxBlocks.length) {
      sections.push({ title: `${e.id} in context`, blocks: ctxBlocks })
    }
  }
  const out = opts.out ?? join(CONTACT, `candidates-${k}@4x.png`)
  writeIfChanged(
    out,
    render(
      sections,
      PALETTE.hex('grass3'),
      opts.maxW ?? 1100,
      opts.scale ?? SCALE,
    ),
  )
  return out.replace(ROOT, '')
}

/** one id's sheets for close review (written where the caller says) */
export function idSheets(m: Manifest, id: string, dir: string): string[] {
  const e = entry(m, id)
  if (!e) return []
  const srcs = sources(m, e)
  const a = join(dir, `${id}@4x.png`)
  const b = join(dir, `${id}-incontext@4x.png`)
  writeIfChanged(
    a,
    render(
      [{ title: id, blocks: srcs.flatMap((s) => blocksFor(m, e, s)) }],
      PALETTE.hex('grass3'),
      700,
    ),
  )
  const ctxB = e.anchorRole
    ? srcs.flatMap((s) => contextFor(m, e, s))
    : srcs.flatMap((s) => bulkContextFor(m, e, s))
  writeIfChanged(
    b,
    render(
      [{ title: `${id} in context`, blocks: ctxB }],
      PALETTE.hex('grey5'),
      700,
    ),
  )
  return [a, b]
}
