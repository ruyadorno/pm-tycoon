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
//   art/contact/fixes@4x.png              G4 (build 2): `node
//     tools/art/contact.ts fixes [--hop <crop.png>]` (fixesSheet below).
//   art/contact/people@4x.png             M6 (build 2): `node
//     tools/art/contact.ts people` — faces, ★, pips, worker vs
//     worker_sorter, the Hold Bay station, the three new machines.
//   art/contact/lowres@4x.png             M6 / G5 (build 2): `node
//     tools/art/contact.ts lowres` — the ten Low-density uniques on their
//     map positions (colour and the _locked look they ship with until M9).
//   art/contact/rural@4x.png              M7 / G5 (build 2): `node
//     tools/art/contact.ts rural` — the ten Rural uniques the same way, plus
//     the fence and hay_bale props.
//   art/contact/tiers@4x.png              M7 / G6 (build 2): `node
//     tools/art/contact.ts tiers` — wh_ext_t1 … _t5 on the lot slab, and
//     tiers 3-5 at 2x with their manifest bay lights / dock poses marked.
//   art/contact/airport@4x.png, civic@4x.png  M8 / G5 (build 2): `node
//     tools/art/contact.ts airport|civic` — the L5 uniques on their map
//     positions (colour and the _locked look until M9) + close-ups.
//   art/contact/warehouse-tier3@4x.png    M8 / G6 (build 2): `node
//     tools/art/contact.ts tier3` — room mocks t1 / t2 / t3 with the M8
//     dock geometry, the tier-3 pieces, the overseas icons.
//   art/contact/g6-tiers-machines-people@4x.png  M9 / G6 (build 2): `node
//     tools/art/contact.ts g6` — room mocks t3 / t4 / t5 in the M9
//     geometry (roomMockM9), the tier-4 / tier-5 pieces, the machines, the
//     Sorter Arm, faces / pips / star, worker vs worker_sorter.
//   M9 (G5): lowres / rural / airport / civic show the region live in
//     colour in context (contextScene: the window baked as the city does
//     at level 4 / 5, every district's buildings and props in it).
//   art/contact/events@4x.png             M12 / G7 (build 3): `node
//     tools/art/contact.ts events` — the 13 category pictures as shipped,
//     EventCard mocks, the victory art on a VictoryCard mock with the
//     confetti, ic_event, the procedural fallbacks (eventsSheet).
//   art/contact/docks@4x.png is the gallery's docks category (gallery.ts):
//     since M8 it opens with the port on the map in colour (live at L3);
//     since M9 with dk_ship faint along its departure (portScene).
// Never writes art/final, the manifest or public/.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  dockPosesOf,
  finalPath,
} from './manifest.ts'
import { groundAt, isRoadTile, mapBlockAt } from '../../src/data/schema.ts'
import type { MapData } from '../../src/data/types.ts'
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
        // the row's foot point (VEHICLE_FOOT) at the tile centre
        const foot = e.foot ?? [v.width / 2, Math.round(v.height * 0.75)]
        ctx.drawImage(v, x + 32 - foot[0], H - 20 - foot[1])
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

/** a picture (event-pic, the victory art) on a cream card panel at 1x */
function pictureBlock(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  const [W, H] = e.canvas
  const im = src.get(e.frames[0] ?? '')
  const raw = src.n >= 0 ? rawCanvas(e.id, src.n) : null
  const cv = panel(W + 8 + (raw ? W + 4 : 0), H + 8)
  const ctx = cv.getContext('2d')
  if (im) ctx.drawImage(im, 4, 4)
  // the download before keying / palette / outline, for the vision pass
  if (raw) ctx.drawImage(raw, W + 8, 4, W, H)
  return [{ cv, label: `${src.tag}${raw ? '  (| raw)' : ''}` }]
}

/** candidate n's raw download (the first non-original image), or null */
function rawCanvas(id: string, n: number): Canvas | null {
  const dir = join(CANDIDATES, id, String(n), 'raw')
  if (!existsSync(dir)) return null
  const f = readdirSync(dir)
    .toSorted()
    .find((x) => x.endsWith('.png') && !x.startsWith('orig_'))
  return f ? pngCanvas(join(dir, f)) : null
}

function blocksFor(m: Manifest, e: ManifestEntry, src: Source): Block[] {
  if (
    e.class === 'event-pic' ||
    (e.class === 'ui' && e.source === 'pixellab')
  ) {
    return pictureBlock(m, e, src)
  }
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
  civic: ['lr_major_house', 'dt_semver_bank'],
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

// ---------------------------------------------------------------------------
// G4 (plan-build2 §6, §8.2): art/contact/fixes@4x.png — the author's four
// fixes on one sheet: the warehouse exterior t1 / t2 standing on the slab
// tiles (the 4x4 footprint stamped with lot_slab_a/b/c, the dock column
// with lot_ramp, bollards on the slab corners; with and without a grid
// overlay of the footprint), the eight bike frames on road tiles and the
// bike beside the van and truck, the three modern port sprites in context
// on the quay by the sea (colour and the _locked look they ship with until
// M8), and the hop frame (a crop from shots passed with --hop <png>, else a
// placeholder cell). The lot and port scenes are drawn at 2x (camera zoom
// 2), the vehicles at 4x.

/** the slab variant of footprint tile (tx, ty): a stable a/b/c pattern */
export function slabVariant(tx: number, ty: number): 'a' | 'b' | 'c' {
  const k = (tx * 7 + ty * 3) % 5
  return k === 0 ? 'b' : k === 3 ? 'c' : 'a'
}

function scaled(cv: Canvas, s: number): Canvas {
  const out = createCanvas(cv.width * s, cv.height * s)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(cv, 0, 0, cv.width * s, cv.height * s)
  return out
}

/** the lot scene's 4x4 footprint (tiles 2..5) and dock column (tx 1) */
const inFp = (tx: number, ty: number) =>
  tx >= 2 && tx <= 5 && ty >= 2 && ty <= 5
const dock = (tx: number, ty: number) => tx === 1 && ty >= 3 && ty <= 5

/** a src/data JSON table (contact sheets read the map as the game does) */
const dataJson = (f: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, 'src/data', f), 'utf8')) as unknown

/**
 * The warehouse lot at 1x: 8x8 tiles of lot_concrete, the 4x4 footprint
 * (tiles 2..5) on lot_slab, the dock column (tx 1, ty 3..5) on lot_ramp,
 * bollards at the slab's front corners, `ext` at the footprint anchor;
 * `grid` draws the footprint's tile edges and corners over everything.
 */
export function lotScene(
  m: Manifest,
  ext: Canvas | null,
  grid: boolean,
): Canvas {
  const n = 8
  const top = 200
  const W = n * 64
  const H = n * 32 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = W / 2 - 32
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const t = inFp(tx, ty)
        ? fin(m, 'lot_slab', `_${slabVariant(tx, ty)}`)
        : dock(tx, ty)
          ? fin(m, 'lot_ramp')
          : fin(m, 'lot_concrete')
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const draws: { d: number; f: () => void }[] = []
  // bollards on the slab's front corners and by the dock column
  const bol: [number, number, string][] = [
    [5, 6, '_a'],
    [6, 5, '_b'],
    [1, 6, '_a'],
  ]
  for (const [tx, ty, f] of bol) {
    const b = fin(m, 'bollard', f)
    if (!b) continue
    const p = scr(ox, top, tx, ty)
    // prop rule: origin (0.5, 1) at the tile's top vertex + 32 rows puts
    // the post on the tile's top corner area; bottom vertex = p.y + 32
    draws.push({
      d: tx + ty,
      f: () => ctx.drawImage(b, p.x + 32 - b.width / 2, p.y + 16 - 16),
    })
  }
  if (ext) {
    const p = scr(ox, top, 5, 5)
    draws.push({
      d: 10,
      f: () =>
        ctx.drawImage(ext, p.x + 32 - ext.width / 2, p.y + 32 - ext.height),
    })
  }
  draws.sort((a, b) => a.d - b.d)
  for (const d of draws) d.f()
  if (grid) {
    // the footprint's tile edges (1-px dots) and its four corners
    ctx.fillStyle = PALETTE.hex('red1')
    for (let k = 2; k <= 6; k++) {
      for (let t = 0; t <= 128; t += 2) {
        // lines of constant tx = k and ty = k across the footprint
        const a = scr(ox, top, k, 2)
        ctx.fillRect(a.x + 32 - t, a.y + t / 2, 1, 1)
        const b = scr(ox, top, 2, k)
        ctx.fillRect(b.x + 32 + t, b.y + t / 2, 1, 1)
      }
    }
    ctx.fillStyle = PALETTE.hex('yellow3')
    for (const [tx, ty, dx, dy] of [
      [2, 2, 32, 0],
      [6, 2, 32, 0],
      [2, 6, 32, 0],
      [6, 6, 32, 0],
    ] as const) {
      const p = scr(ox, top, tx, ty)
      ctx.fillRect(p.x + dx - 1, p.y + dy - 1, 3, 3)
    }
  }
  return cv
}

/**
 * The docks as the map lays them out (src/data/map.json + buildings.json):
 * tiles x 0..12, y 26..38 — the west sea, the quay pavement, the three
 * port sprites on their buildings.json footprints (sprite = SPRITE_MAP via
 * coversBuildings), the crane, ship and container props at their map
 * tiles; `locked` draws the fogged frames the region shows until M8.
 */
export function portScene(
  m: Manifest,
  locked: boolean,
  departure: readonly number[] = [],
): Canvas {
  const X0 = 0
  const Y0 = 26
  const nx = 13
  const ny = 13
  const top = 200
  const W = (nx + ny) * 32
  const H = (nx + ny) * 16 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = ny * 32 - 32
  const L = locked ? '_locked' : ''
  const map = dataJson('map.json') as {
    ground: {
      scenery: { rect: [number, number, number, number]; frame: string }[]
    }
    props: { frame: string; tile: [number, number]; region: string }[]
  }
  const buildings = dataJson('buildings.json') as {
    id: string
    district: string
    footprint: [number, number]
    tile: [number, number]
  }[]
  const sea = map.ground.scenery.filter((r) => r.frame === 'water')
  const isSea = (x: number, y: number) =>
    sea.some(
      (r) =>
        x >= r.rect[0] && x <= r.rect[2] && y >= r.rect[1] && y <= r.rect[3],
    )
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const t = isSea(X0 + tx, Y0 + ty)
        ? fin(m, 'water', '_f0')
        : fin(m, 'pavement', L)
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const sprite = new Map<string, string>()
  for (const e of m.entries) {
    for (const b of e.coversBuildings ?? []) sprite.set(b, e.id)
  }
  const frameOf = (id: string) =>
    fin(m, id, entry(m, id)?.variants.includes('locked') ? L : '')
  const draws: { d: number; f: () => void }[] = []
  const put = (id: string, ax: number, ay: number) => {
    const im = frameOf(id)
    if (!im) return
    const p = scr(ox, top, ax - X0, ay - Y0)
    draws.push({
      d: ax + ay,
      f: () => ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
    })
  }
  for (const b of buildings.filter((x) => x.district === 'docks')) {
    const id = sprite.get(b.id) ?? b.id
    // anchor = the bottom vertex of the footprint's max tile
    put(id, b.tile[0] + b.footprint[0] - 1, b.tile[1] + b.footprint[1] - 1)
  }
  // props stand where CityScene puts them: origin (0.5, 1) at the tile's
  // bottom vertex
  for (const pr of map.props.filter((x) => x.region === 'docks')) {
    put(pr.frame, pr.tile[0], pr.tile[1])
  }
  draws.sort((a, b) => a.d - b.d)
  for (const d of draws) d.f()
  // build 2 M9: ghosts of the vessel along its map.hubs exit at fractions
  // `departure` of the sail-out (cityHub.ts vesselOffset: tile-space
  // translation, no turn), so the sheet shows whether it sails bow first
  const hub = (
    dataJson('map.json') as {
      hubs?: {
        district: string
        vessel: {
          frame: string
          tile: [number, number]
          exit: [number, number]
        }
      }[]
    }
  ).hubs?.find((h) => h.district === 'docks')
  const ship = hub ? frameOf(hub.vessel.frame) : null
  if (hub && ship) {
    ctx.globalAlpha = 0.55
    for (const t of departure) {
      const tx = hub.vessel.tile[0] + hub.vessel.exit[0] * t - X0
      const ty = hub.vessel.tile[1] + hub.vessel.exit[1] * t - Y0
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(
        ship,
        Math.round(p.x + 32 - ship.width / 2),
        Math.round(p.y + 32 - ship.height),
      )
    }
    ctx.globalAlpha = 1
  }
  return cv
}

/** bike, van and truck on a road, for scale (1x) */
function fleetScene(m: Manifest): Canvas {
  const cv = createCanvas(3 * 64 + 32, 64)
  const ctx = cv.getContext('2d')
  for (let i = 0; i < 4; i++) {
    const road = fin(m, 'road', '_10')
    if (road) ctx.drawImage(road, i * 64 - 16, 24)
  }
  const veh: [string, number][] = [
    ['bike', 0],
    ['van', 1],
    ['truck', 2],
  ]
  for (const [id, i] of veh) {
    const e = entry(m, id)
    const im = fin(m, id, '_se_0')
    if (!e || !im) continue
    const foot = e.foot ?? [im.width / 2, Math.round(im.height * 0.75)]
    // the road centre line point of each tile: (x + 32, 40)
    ctx.drawImage(im, i * 64 + 48 - foot[0], 40 - foot[1])
  }
  return cv
}

/** a framed cell for the hop crop (or the placeholder text) */
function hopCell(path: string | null): Canvas {
  const crop = path ? pngCanvas(path) : null
  const w = crop ? crop.width : 160
  const h = crop ? crop.height : 96
  const cv = createCanvas(w + 4, h + 4)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.fillRect(0, 0, w + 4, h + 4)
  ctx.fillStyle = PALETTE.hex('grey4')
  ctx.fillRect(2, 2, w, h)
  if (crop) ctx.drawImage(crop, 2, 2)
  return cv
}

export function fixesSheet(m: Manifest, hop: string | null = null): string {
  const S = 2
  const ext = (f: string) => fin(m, 'wh_ext', f)
  const bike = entry(m, 'bike')
  const sections: Section[] = [
    {
      title:
        'F2 warehouse on the slab (2x = camera zoom 2): wh_ext_t1, wh_ext_t2, ' +
        't1 with the footprint grid (red dots = tile edges, yellow = corners)',
      blocks: [
        { cv: lotScene(m, ext('_t1'), false), label: 'wh_ext_t1 on lot_slab' },
        { cv: lotScene(m, ext('_t2'), false), label: 'wh_ext_t2 on lot_slab' },
        { cv: lotScene(m, ext('_t1'), true), label: 't1 + footprint grid' },
      ],
    },
    {
      title: 'F3 bike: courier with a white helmet, 32x32 (4x)',
      blocks: [
        ...(bike
          ? vehicleBlock(m, bike, {
              n: -1,
              get: (s) => fin(m, 'bike', s),
              tag: 'bike_{ne,se,sw,nw}_{0,1}',
            }).map((b) => ({ cv: scaled(b.cv, 2), label: b.label }))
          : []),
        { cv: scaled(fleetScene(m), 2), label: 'bike, van, truck (se_0)' },
      ],
    },
    {
      title:
        'F5 modern port (2x): dk_terminal_a, dk_terminal_b, dk_port_office ' +
        'with dk_crane, dk_ship, dk_containers — colour and _locked (M5-M7)',
      blocks: [
        { cv: portScene(m, false), label: 'docks in colour (live from M8)' },
        { cv: portScene(m, true), label: 'docks _locked (as shipped)' },
      ],
    },
    {
      title: 'F4 hop: the pickup icon sinks into the vehicle body',
      blocks: [
        {
          cv: hopCell(hop),
          label: hop ? 'hop frame (shots crop)' : 'hop frame: crop from shots',
        },
      ],
    },
  ]
  const out = join(CONTACT, 'fixes@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 1500, S))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// M6 (build 2): art/contact/people@4x.png and art/contact/lowres@4x.png

/** the shipped frames of an id (finals), as a contact Source */
function finals(m: Manifest, id: string, tag = id): Source {
  return { n: -1, get: (s) => fin(m, id, s), tag }
}

/** a cream card panel (grey5, 1-px outline) w x h at 1x */
function panel(w: number, h: number): Canvas {
  const cv = createCanvas(w, h)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = PALETTE.hex('grey5')
  ctx.fillRect(1, 1, w - 2, h - 2)
  return cv
}

/** face_00 … face_11 as a 3 x 4 grid: rows = skins, columns = hair / hat */
function faceGridScene(m: Manifest): Canvas {
  const cv = panel(4 * 20 + 4, 3 * 20 + 4)
  const ctx = cv.getContext('2d')
  for (let n = 0; n < 12; n++) {
    const f = fin(m, `face_${String(n).padStart(2, '0')}`)
    if (f) ctx.drawImage(f, 4 + (n % 4) * 20, 4 + Math.floor(n / 4) * 20)
  }
  return cv
}

/** pips at the 7-px pitch: `lit` of `max` */
function pipRow(
  ctx: SKRSContext2D,
  m: Manifest,
  x: number,
  y: number,
  lit: number,
  max: number,
): void {
  const on = fin(m, 'ic_pip_on')
  const off = fin(m, 'ic_pip_off')
  for (let i = 0; i < max; i++) {
    const p = i < lit ? on : off
    if (p) ctx.drawImage(p, x + i * 7, y)
  }
}

/**
 * A hire-card mock (layout of design-m6 §6.1, not the game's text): the
 * face, the ★ top-right of a star applicant's face, eye / pace / charisma
 * pips.
 */
function cardMock(
  m: Manifest,
  face: number,
  star: boolean,
  pips: [number, number, number],
): Canvas {
  const cv = panel(64, 30)
  const ctx = cv.getContext('2d')
  const f = fin(m, `face_${String(face).padStart(2, '0')}`)
  if (f) ctx.drawImage(f, 4, 6)
  const st = fin(m, 'ic_star')
  if (star && st) ctx.drawImage(st, 12, 0)
  pipRow(ctx, m, 26, 3, pips[0], 5)
  pipRow(ctx, m, 26, 11, pips[1], 5)
  pipRow(ctx, m, 26, 19, pips[2], 2)
  return cv
}

/** floor tiles w x h cells (32 px) */
function floorScene(m: Manifest, cw: number, ch: number): Canvas {
  const cv = createCanvas(cw * 32, ch * 32)
  const ctx = cv.getContext('2d')
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const t = fin(m, 'floor_t1', `_${(x + y) % 3}`)
      if (t) ctx.drawImage(t, x * 32, y * 32)
    }
  }
  return cv
}

/**
 * The Hold Bay station in the room: the podium (back layer), the sorter
 * standing on the east half of the mat facing west (front layer), the bin
 * beside it; `who` = the worker id standing there.
 */
function stationScene(m: Manifest, who: string): Canvas {
  const cv = floorScene(m, 5, 3)
  const ctx = cv.getContext('2d')
  const st = fin(m, 'hold_station')
  if (st) ctx.drawImage(st, 8, 24)
  const w = fin(m, who, '_w_idle_0')
  if (w) ctx.drawImage(w, 8 + 24, 24 + 48 - 32 - 2)
  const bin = fin(m, 'bin', '_closed')
  if (bin) ctx.drawImage(bin, 88, 16)
  return cv
}

/** a 64x64 fixture's frames, each on 3x3 floor cells */
function fixtureFrames(m: Manifest, e: ManifestEntry): Block[] {
  return e.frames.map((f) => {
    const cv = floorScene(m, 3, 3)
    const im = fin(m, e.id, f)
    if (im) cv.getContext('2d').drawImage(im, 16, 16)
    return { cv, label: `${e.id} ${f.replace(/^_/, '')}` }
  })
}

export function peopleSheet(m: Manifest): string {
  const S = 4
  const blocks = (id: string): Block[] => {
    const e = entry(m, id)
    return e ? blocksFor(m, e, finals(m, id, id)) : []
  }
  const arm = entry(m, 'sorter_arm')
  const sections: Section[] = [
    {
      title:
        'face_00-11: rows peach / tan / deep skin; columns short hair, ' +
        'long auburn hair, blue cap, hard hat',
      blocks: [
        { cv: faceGridScene(m), label: 'face_NN, NN = skin * 4 + hair' },
        {
          cv: cardMock(m, 0, false, [3, 3, 0]),
          label: 'Audrey (face_00) 3 / 3 / 0',
        },
        {
          cv: cardMock(m, 6, true, [4, 2, 2]),
          label: 'star applicant: ic_star on the face',
        },
      ],
    },
    {
      title: 'ic_star (icon16), ic_pip_on / ic_pip_off (ui 8x8, 7-px pitch)',
      blocks: (['ic_star', 'ic_pip_on', 'ic_pip_off'] as const).flatMap(
        (id) => {
          const im = fin(m, id)
          if (!im) return []
          const cv = panel(44, im.height + 4)
          cv.getContext('2d').drawImage(im, 22 - im.width / 2, 2)
          return [{ cv, label: id }]
        },
      ),
    },
    { title: 'worker (inspector, yellow vest)', blocks: blocks('worker') },
    {
      title: 'worker_sorter (the sorter: orange-vest palette swap)',
      blocks: blocks('worker_sorter'),
    },
    {
      title:
        'hold_station (interior back layer, 48x48) with the sorter on duty, ' +
        'the bin beside it',
      blocks: [
        { cv: stationScene(m, 'worker_sorter'), label: 'sorter on duty' },
        { cv: stationScene(m, ''), label: 'empty station' },
      ],
    },
    {
      title: 'machines: battery_checker, xray (idle f0 / scan f1 on the belt)',
      blocks: [...blocks('battery_checker'), ...blocks('xray')],
    },
    {
      title: 'sorter_arm (fixture 64x64): f0 rest, f1 reach (-x), f2 toss (+x)',
      blocks: arm ? fixtureFrames(m, arm) : [],
    },
  ]
  const out = join(CONTACT, 'people@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 700, S))
  return out.replace(ROOT, '')
}

/** road tiles of map.json: avenue lines minus trimmed segments */
function roadAt(x: number, y: number): boolean {
  const map = dataJson('map.json') as {
    avenues: number[]
    trimmed: { axis: 'x' | 'y'; at: number; from: number; to: number }[]
  }
  const a = map.avenues
  const lo = a[0] as number
  const hi = a[a.length - 1] as number
  const onAv =
    (a.includes(x) && y >= lo && y <= hi) ||
    (a.includes(y) && x >= lo && x <= hi)
  if (!onAv) return false
  return !map.trimmed.some((t) =>
    t.axis === 'x'
      ? x === t.at && y >= t.from && y <= t.to
      : y === t.at && x >= t.from && x <= t.to,
  )
}

/**
 * A district as the map lays it out: tiles [x0, x0 + nx) x [y0, y0 + ny),
 * roads on the avenues (autotiled), grass elsewhere, the district's
 * buildings on their buildings.json footprints (sprite = their own id or
 * the coversBuildings row) and its map props; `locked` = the fogged frames.
 */
export function regionScene(
  m: Manifest,
  district: string,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  locked: boolean,
  opts: {
    /** draw map.json ground.scenery rects (the runway; not the sea) */
    scenery?: boolean
    /** props not in map.json yet (M9 data), drawn like map props */
    extraProps?: readonly { frame: string; tile: [number, number] }[]
  } = {},
): Canvas {
  const top = 160
  const W = (nx + ny) * 32
  const H = (nx + ny) * 16 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = ny * 32 - 32
  const L = locked ? '_locked' : ''
  const lk = (id: string) =>
    entry(m, id)?.variants.includes('locked') ? L : ''
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x = x0 + tx
      const y = y0 + ty
      let t: Canvas | null
      const sc = opts.scenery ? sceneryAt(x, y) : null
      if (sc) t = fin(m, sc, lk(sc)) ?? fin(m, sc)
      else if (roadAt(x, y)) {
        const k =
          (roadAt(x, y - 1) ? 1 : 0) |
          (roadAt(x + 1, y) ? 2 : 0) |
          (roadAt(x, y + 1) ? 4 : 0) |
          (roadAt(x - 1, y) ? 8 : 0)
        const f = `_${String(k).padStart(2, '0')}`
        t = fin(m, 'road', f + lk('road')) ?? fin(m, 'road', f)
      } else t = fin(m, 'grass', lk('grass'))
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const buildings = dataJson('buildings.json') as {
    id: string
    district: string
    footprint: [number, number]
    tile: [number, number]
  }[]
  const map = dataJson('map.json') as {
    props: { frame: string; tile: [number, number]; region: string }[]
  }
  const sprite = new Map<string, string>()
  for (const e of m.entries) {
    for (const b of e.coversBuildings ?? []) sprite.set(b, e.id)
  }
  const draws: { d: number; f: () => void }[] = []
  const put = (id: string, ax: number, ay: number) => {
    const im = fin(m, id, lk(id))
    if (!im) return
    const p = scr(ox, top, ax - x0, ay - y0)
    draws.push({
      d: ax + ay,
      f: () => ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
    })
  }
  for (const b of buildings.filter((x) => x.district === district)) {
    put(
      sprite.get(b.id) ?? b.id,
      b.tile[0] + b.footprint[0] - 1,
      b.tile[1] + b.footprint[1] - 1,
    )
  }
  for (const pr of map.props.filter((x) => x.region === district)) {
    put(pr.frame, pr.tile[0], pr.tile[1])
  }
  // extra props not on the map yet (M9: map.json carries the Airport's own)
  const placed = new Set(map.props.map((p) => `${p.frame}@${p.tile.join(',')}`))
  for (const pr of opts.extraProps ?? []) {
    if (placed.has(`${pr.frame}@${pr.tile.join(',')}`)) continue
    put(pr.frame, pr.tile[0], pr.tile[1])
  }
  draws.sort((a, b) => a.d - b.d)
  for (const d of draws) d.f()
  return cv
}

/** the ground.scenery frame of map tile (x, y) other than the sea, or null */
function sceneryAt(x: number, y: number): string | null {
  const map = dataJson('map.json') as {
    ground: {
      scenery: { rect: [number, number, number, number]; frame: string }[]
    }
  }
  const r = map.ground.scenery.find(
    (s) =>
      s.frame !== 'water' &&
      x >= s.rect[0] &&
      x <= s.rect[2] &&
      y >= s.rect[1] &&
      y <= s.rect[3],
  )
  return r?.frame ?? null
}

/** a ground.scenery row drawn by a sheet before the map's own rows */
export interface SceneryRow {
  rect: [number, number, number, number]
  frame: string
}

/**
 * Build 2 M9 (G5 "in context"): tiles [x0, x0 + nx) x [y0, y0 + ny) as the
 * city bakes them at `level` (src/data/schema.ts groundAt: block grounds
 * and accents, scenery, roads), every building and map prop in the window
 * whatever its district, each district drawn in colour when its
 * unlockLevel <= `level` and `_locked` otherwise; `extraScenery` rows win
 * over the map's and `extraProps` are drawn like map props (suggested rows
 * not in map.json yet, named in the sheet title).
 */
export function contextScene(
  m: Manifest,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  level: number,
  opts: {
    extraScenery?: readonly SceneryRow[]
    extraProps?: readonly {
      frame: string
      tile: [number, number]
      region: string
    }[]
  } = {},
): Canvas {
  const extraScenery = opts.extraScenery ?? []
  const top = 160
  const W = (nx + ny) * 32
  const H = (nx + ny) * 16 + top
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('water1')
  ctx.fillRect(0, 0, W, H)
  const ox = ny * 32 - 32
  const map = dataJson('map.json') as MapData
  const districts = dataJson('districts.json') as {
    id: string
    unlockLevel: number
  }[]
  const lockedD = new Set(
    districts.filter((d) => d.unlockLevel > level).map((d) => d.id),
  )
  const groundFin = (stem: string, locked: boolean): Canvas | null => {
    const e = entry(m, stem)
    if (!e) return null
    const f = e.frames[0] ?? ''
    const L = locked && e.variants.includes('locked') ? '_locked' : ''
    return fin(m, stem, f + L) ?? fin(m, stem, f)
  }
  const roadIs = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.size[0] && y < map.size[1]
      ? isRoadTile(map, x, y)
      : false
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x = x0 + tx
      const y = y0 + ty
      const block = mapBlockAt(map, x, y)
      const locked =
        block !== null && block.kind === 'region' && lockedD.has(block.region)
      let t: Canvas | null
      const extra = extraScenery.find(
        (r) =>
          x >= r.rect[0] && x <= r.rect[2] && y >= r.rect[1] && y <= r.rect[3],
      )
      if (extra && !block) t = groundFin(extra.frame, locked)
      else if (roadIs(x, y)) {
        const k =
          (roadIs(x, y - 1) ? 1 : 0) |
          (roadIs(x + 1, y) ? 2 : 0) |
          (roadIs(x, y + 1) ? 4 : 0) |
          (roadIs(x - 1, y) ? 8 : 0)
        const f = `_${String(k).padStart(2, '0')}`
        t = fin(m, 'road', f)
      } else t = groundFin(groundAt(map, x, y), locked)
      if (!t) continue
      const p = scr(ox, top, tx, ty)
      ctx.drawImage(t, p.x, p.y)
    }
  }
  const buildings = dataJson('buildings.json') as {
    id: string
    district: string
    footprint: [number, number]
    tile: [number, number]
  }[]
  const sprite = new Map<string, string>()
  for (const e of m.entries) {
    for (const b of e.coversBuildings ?? []) sprite.set(b, e.id)
  }
  const inWin = (x: number, y: number) =>
    x >= x0 && x < x0 + nx && y >= y0 && y < y0 + ny
  const draws: { d: number; f: () => void }[] = []
  const put = (id: string, ax: number, ay: number, locked: boolean) => {
    const e = entry(m, id)
    const im =
      fin(m, id, locked && e?.variants.includes('locked') ? '_locked' : '') ??
      fin(m, id)
    if (!im) return
    const p = scr(ox, top, ax - x0, ay - y0)
    draws.push({
      d: ax + ay,
      f: () => ctx.drawImage(im, p.x + 32 - im.width / 2, p.y + 32 - im.height),
    })
  }
  for (const b of buildings) {
    const ax = b.tile[0] + b.footprint[0] - 1
    const ay = b.tile[1] + b.footprint[1] - 1
    if (!inWin(b.tile[0], b.tile[1]) && !inWin(ax, ay)) continue
    put(sprite.get(b.id) ?? b.id, ax, ay, lockedD.has(b.district))
  }
  const onMap = new Set(map.props.map((p) => `${p.frame}@${p.tile.join(',')}`))
  const extraP = (opts.extraProps ?? []).filter(
    (p) => !onMap.has(`${p.frame}@${p.tile.join(',')}`),
  )
  for (const pr of [...map.props, ...extraP]) {
    if (!inWin(pr.tile[0], pr.tile[1])) continue
    put(pr.frame, pr.tile[0], pr.tile[1], lockedD.has(pr.region))
  }
  draws.sort((a, b) => a.d - b.d)
  for (const d of draws) d.f()
  return cv
}

/** the ten Low-density uniques (buildings.json district lowres) */
export function lowresIds(): string[] {
  const rows = dataJson('buildings.json') as { id: string; district: string }[]
  return rows.filter((r) => r.district === 'lowres').map((r) => r.id)
}

export function lowresSheet(m: Manifest): string {
  const S = 2
  const ids = lowresIds()
  const closeups: Block[] = ids.flatMap((id) => {
    const e = entry(m, id)
    if (!e) return []
    return buildingBlock(m, e, finals(m, id, id)).map((b) => ({
      cv: b.cv,
      label: b.label.replace(/^PH /, `${id} `),
    }))
  })
  const sections: Section[] = [
    {
      title:
        'G5 — Low-density (Semver St) live from L4 (M9), in context: tiles ' +
        'x 17-37, y 0-13 as the city bakes them at level 4 (2x = camera ' +
        'zoom 2; Rural live beside it, Downtown below, the Airport still ' +
        'fogged until L5)',
      blocks: [
        {
          cv: contextScene(m, 17, 0, 21, 14, 4),
          label: 'level 4, in colour',
        },
      ],
    },
    {
      title: 'before L4: the _locked look (fog)',
      blocks: [
        {
          cv: regionScene(m, 'lowres', 18, 2, 19, 11, true),
          label: '_locked',
        },
      ],
    },
    {
      title: 'the ten uniques (2x): colour | _locked',
      blocks: closeups,
    },
  ]
  const out = join(CONTACT, 'lowres@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 2000, S))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// M7 (build 2): art/contact/rural@4x.png and art/contact/tiers@4x.png

/** the ten Rural uniques (buildings.json district rural) */
export function ruralIds(): string[] {
  const rows = dataJson('buildings.json') as { id: string; district: string }[]
  return rows.filter((r) => r.district === 'rural').map((r) => r.id)
}

export function ruralSheet(m: Manifest): string {
  const S = 2
  const closeups: Block[] = [...ruralIds(), 'fence', 'hay_bale'].flatMap(
    (id) => {
      const e = entry(m, id)
      if (!e) return []
      const blocks = e.class.startsWith('building')
        ? buildingBlock(m, e, finals(m, id, id))
        : propBlock(m, e, finals(m, id, id))
      return blocks.map((b) => ({
        cv: b.cv,
        label: b.label.replace(/^PH /, `${id} `),
      }))
    },
  )
  const sections: Section[] = [
    {
      title:
        'G5 — Rural (Pasture Peer Fields) live from L4 (M9), in context: ' +
        'tiles x 0-20, y 0-21 as the city bakes them at level 4 (2x = ' +
        'camera zoom 2; Low-density live beside it, Hoist Hill below)',
      blocks: [
        {
          cv: contextScene(m, 0, 0, 21, 22, 4),
          label: 'level 4, in colour',
        },
      ],
    },
    {
      title: 'before L4: the _locked look (fog)',
      blocks: [
        {
          cv: regionScene(m, 'rural', 2, 2, 19, 19, true),
          label: '_locked',
        },
      ],
    },
    {
      title:
        'the ten uniques + the fence / hay_bale props (2x): colour | _locked',
      blocks: closeups,
    },
  ]
  const out = join(CONTACT, 'rural@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 2000, S))
  return out.replace(ROOT, '')
}

/** the exterior frame of tier n (wh_ext _t1/_t2, then the wh_ext_tN rows) */
function tierFrame(m: Manifest, n: number): Canvas | null {
  return n <= 2 ? fin(m, 'wh_ext', `_t${n}`) : fin(m, `wh_ext_t${n}`)
}

/** a copy of `ext` with its bay lights (yellow) and dock pose (red) marked */
function anchorMarks(m: Manifest, n: number, ext: Canvas): Canvas {
  const id = n <= 2 ? 'wh_ext' : `wh_ext_t${n}`
  const e = entry(m, id)
  const set = (n <= 2 ? e?.frameAnchors?.[`_t${n}`] : undefined) ?? e
  const out = createCanvas(ext.width, ext.height)
  const ctx = out.getContext('2d')
  ctx.drawImage(ext, 0, 0)
  const mark = (x: number, y: number, c: string) => {
    ctx.fillStyle = PALETTE.hex('outline')
    ctx.fillRect(x - 2, y - 2, 5, 5)
    ctx.fillStyle = PALETTE.hex(c)
    ctx.fillRect(x - 1, y - 1, 3, 3)
  }
  for (const [x, y] of set?.bayLights ?? []) mark(x, y, 'yellow3')
  // build 2 M8: every bay's docked pose (dockPoses, [0] = dockPose)
  if (set?.bayLights && set.dockPose) {
    for (const [x, y] of dockPosesOf({
      bayLights: set.bayLights,
      dockPose: set.dockPose,
      ...(set.dockPoses ? { dockPoses: set.dockPoses } : {}),
    })) {
      mark(x, y, 'red1')
    }
  }
  return out
}

export function tiersSheet(m: Manifest): string {
  const tiers = [1, 2, 3, 4, 5]
  const sections: Section[] = [
    {
      title:
        'warehouse exteriors t1-t5 on the lot slab (1x): t1/t2 live, t3 L3 ' +
        '(M8), t4 L4 / t5 L5 (M9)',
      blocks: tiers.map((n) => ({
        cv: lotScene(m, tierFrame(m, n), false),
        label: `wh_ext_t${n}`,
      })),
    },
    {
      title:
        'tiers 3-5 at 2x with the footprint grid; the manifest anchors ' +
        'marked on the frame (yellow = bayLights, red = the docked pose ' +
        'of each bay, dockPoses)',
      blocks: [3, 4, 5].flatMap((n) => {
        const ext = tierFrame(m, n)
        if (!ext) return []
        return [
          { cv: scaled(lotScene(m, ext, true), 2), label: `t${n} + grid` },
          {
            cv: scaled(anchorMarks(m, n, ext), 2),
            label: `t${n} anchors`,
          },
        ]
      }),
    },
  ]
  const out = join(CONTACT, 'tiers@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 2700, 2))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// M8 (build 2): art/contact/airport@4x.png and art/contact/civic@4x.png —
// the L5 regions (G5), generated in M8 and fogged until M9

/** buildings.json ids of a district, in data order */
export function districtIds(district: string): string[] {
  const rows = dataJson('buildings.json') as { id: string; district: string }[]
  return rows.filter((r) => r.district === district).map((r) => r.id)
}

/** colour | _locked close-ups of buildings and props (2x sheets) */
function closeupsOf(m: Manifest, ids: readonly string[]): Block[] {
  return ids.flatMap((id) => {
    const e = entry(m, id)
    if (!e) return []
    const blocks = e.class.startsWith('building')
      ? buildingBlock(m, e, finals(m, id, id))
      : propBlock(m, e, finals(m, id, id))
    return blocks.map((b) => ({
      cv: b.cv,
      label: b.label.replace(/^PH /, `${id} `),
    }))
  })
}

/**
 * The Airport's M9 props (design-m8-m9 §1.2; map.json carries them since
 * M9 — kept as a cross-check, deduped against the map's own props): the
 * parked plane on the runway and the control tower.
 */
export const AIRPORT_M9_PROPS: readonly {
  frame: string
  tile: [number, number]
}[] = [
  { frame: 'ap_plane', tile: [45, 10] },
  { frame: 'ap_tower', tile: [44, 16] },
]

/**
 * The M9 runway dressing (plan-build2 §6 Airport "runway themed tiles"):
 * the map.json ground.scenery rows (since M9, listed before the runway rows
 * — the first matching row wins) — piano-key thresholds on the runway's end
 * rows and the taxi line on the apron tile beside the parked plane.
 */
export const AIRPORT_M9_SCENERY: readonly SceneryRow[] = [
  { rect: [45, 3, 47, 3], frame: 'runway_threshold' },
  { rect: [45, 19, 47, 19], frame: 'runway_threshold' },
  { rect: [44, 10, 44, 10], frame: 'taxiway' },
]

export function airportSheet(m: Manifest): string {
  const S = 2
  const sections: Section[] = [
    {
      title:
        'G5 — Airport live from L5 (M9), in context: tiles x 32-47, y 0-21 ' +
        'at level 5 (2x = camera zoom 2), ap_plane (45, 10) and ap_tower ' +
        '(44, 16) from map.json, the runway dressing rows of map.json ' +
        '(runway_threshold on y 3 / 19, taxiway at (44, 10); the runway ' +
        'fogs with the Airport)',
      blocks: [
        {
          cv: contextScene(m, 32, 0, 16, 22, 5, {
            extraScenery: AIRPORT_M9_SCENERY,
            extraProps: AIRPORT_M9_PROPS.map((p) => ({
              ...p,
              region: 'airport',
            })),
          }),
          label: 'level 5, in colour',
        },
      ],
    },
    {
      title: 'before L5: the _locked look (fog)',
      blocks: [
        {
          cv: regionScene(m, 'airport', 33, 2, 15, 19, true, {
            scenery: true,
            extraProps: AIRPORT_M9_PROPS,
          }),
          label: '_locked',
        },
      ],
    },
    {
      title:
        'ap_terminal, ap_cargo_hangar, ap_tower, ap_plane (2x): colour | ' +
        '_locked; the runway tiles (runway, runway_stripe, runway_threshold, ' +
        'tarmac, taxiway)',
      blocks: [
        ...closeupsOf(m, [...districtIds('airport'), 'ap_tower', 'ap_plane']),
        ...['runway', 'runway_stripe', 'runway_threshold', 'tarmac', 'taxiway']
          .map((id) => ({ cv: fin(m, id), id }))
          .filter((b): b is { cv: Canvas; id: string } => b.cv !== null)
          .map((b) => ({ cv: b.cv, label: b.id })),
      ],
    },
  ]
  const out = join(CONTACT, 'airport@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 2000, S))
  return out.replace(ROOT, '')
}

/** the fountain prop's tile in the civic park block [2, 4] (pavilion, trees, benches) — the map.json row since M9 */
export const CIVIC_FOUNTAIN_TILE: [number, number] = [22, 41]

export function civicSheet(m: Manifest): string {
  const S = 2
  const fountain = [
    { frame: 'fountain', tile: CIVIC_FOUNTAIN_TILE, region: 'civic' },
  ]
  const sections: Section[] = [
    {
      title:
        'G5 — Park & civic (Commons) live from L5 (M9), in context: tiles ' +
        'x 8-29, y 24-45 at level 5 (2x = camera zoom 2), the fountain at ' +
        `(${CIVIC_FOUNTAIN_TILE.join(', ')}) from map.json`,
      blocks: [
        {
          cv: contextScene(m, 8, 24, 22, 22, 5, { extraProps: fountain }),
          label: 'level 5, in colour',
        },
      ],
    },
    {
      title: 'before L5: the _locked look (fog)',
      blocks: [
        {
          cv: regionScene(m, 'civic', 10, 26, 19, 18, true, {
            extraProps: fountain,
          }),
          label: '_locked',
        },
      ],
    },
    {
      title: 'the ten uniques + the fountain prop (2x): colour | _locked',
      blocks: closeupsOf(m, [...districtIds('civic'), 'fountain']),
    },
  ]
  const out = join(CONTACT, 'civic@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grass3'), 2000, S))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// M8 (build 2): art/contact/warehouse-tier3@4x.png — the tier-3 room pieces

/** `name` of tier t, else the nearest lower tier that exists (frameOrNull rule) */
function tierPiece(m: Manifest, stem: string, t: number): Canvas | null {
  for (let k = t; k >= 1; k--) {
    const im =
      stem === 'floor' ? fin(m, `floor_t${k}`) : fin(m, `${stem}_t${k}`)
    if (im) return im
    if (stem === 'floor' && k === 1) return fin(m, 'floor_t1', '_0')
  }
  return null
}

/** the six mini-parcel spots of a dock pad, centred (design-m8-m9 §6.1) */
const PAD_SPOTS: readonly [number, number][] = [
  [7, 11],
  [18, 11],
  [7, 27],
  [18, 27],
  [7, 43],
  [18, 43],
]

const MINI = ['s', 'm', 'l', 'xl'] as const

/**
 * A 352 x 448 room of tier `t` with docks 2-3 in the M8 geometry (doors at
 * y 36 / 100 / 164, the roller pad east of doors 2-3, design-m8-m9 §6.1),
 * the tier-3 shelf grid (20 x 5 @ 11 from (35, 388), `shelfN` minis) and
 * the east-column props; positions are the tier-1 table of RoomLayout.ts
 * (props_t3 where props_t2 stands). An art mock, not the renderer.
 */
function roomMock(m: Manifest, t: number, shelfN: number): Canvas {
  const cv = createCanvas(352, 448)
  const ctx = cv.getContext('2d')
  const draw = (im: Canvas | null, x: number, y: number) => {
    if (im) ctx.drawImage(im, x, y)
  }
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 11; c++) {
      let im: Canvas | null
      if (c === 0 || c === 10) im = tierPiece(m, 'wall', t)
      else if (r === 0) im = tierPiece(m, 'wallface', t)
      else if (t === 1) im = fin(m, 'floor_t1', `_${(c + r) % 3}`)
      else if (c === 4)
        im = fin(m, `floor_t${t}_lane`) ?? tierPiece(m, 'floor', t)
      else im = tierPiece(m, 'floor', t)
      draw(im, c * 32, r * 32)
    }
  }
  // the belt: conv1 along y 48, the corner, the column c4 down to the shelf
  for (let x = 32; x < 128; x += 32) draw(fin(m, 'belt_h', '_0'), x, 48)
  draw(fin(m, 'belt_corner', '_0'), 128, 48)
  for (let y = 80; y <= 352; y += 32) draw(fin(m, 'belt_v', '_0'), 128, y)
  for (let y = 96; y < 352; y += 32) draw(fin(m, 'chute_v'), 172, y)
  draw(fin(m, 'holdbay_rack'), 192, 96)
  for (let i = 0; i < 5; i++) draw(fin(m, 'bay_pad'), 194, 98 + 48 * i)
  draw(fin(m, 'hold_station'), 264, 300)
  draw(fin(m, 'bin', '_closed'), 256, 384)
  // north wall dressing
  draw(tierPiece(m, 'sign', t), 76, 4)
  if (t === 1) draw(fin(m, 'bulb', '_0'), 296, 6)
  else {
    draw(fin(m, 'strip_light'), 8, 2)
    draw(fin(m, 'strip_light'), 280, 2)
  }
  draw(tierPiece(m, 'wanted_poster', t), 272, 120)
  if (t === 1) {
    draw(fin(m, 'props_t1'), 264, 164)
    draw(fin(m, 'props_t1'), 264, 236)
  } else draw(tierPiece(m, 'props', t), 264, 196)
  // docks: 1 open with a van tail, 2 bought (closed, pad with parcels),
  // 3 locked; a lamp over each door
  draw(fin(m, 'dock_door', '_open'), 0, 36)
  draw(fin(m, 'dock_tail_van', '_open'), 0, 44)
  draw(fin(m, 'dock_door', '_closed'), 0, 100)
  draw(fin(m, 'dock_pad'), 32, 100)
  PAD_SPOTS.slice(0, 4).forEach(([x, y], i) => {
    draw(fin(m, `parcel_mini_${MINI[i % 4]}`), 32 + x - 8, 100 + y - 8)
  })
  draw(fin(m, 'dock_door', '_locked'), 0, 164)
  // RoomLayout dockGeom(k).lamp: (12, 24) / (12, 92) / (12, 156)
  draw(fin(m, 'lamp', '_green'), 12, 24)
  draw(fin(m, 'lamp', '_amber'), 12, 92)
  draw(fin(m, 'lamp', '_lock'), 12, 156)
  // slots: the desk (slot 1), detector, battery checker, shaker
  draw(fin(m, 'desk'), 80, 112)
  draw(fin(m, 'metal_detector', '_f0'), 120, 168)
  draw(fin(m, 'battery_checker', '_f0'), 120, 232)
  draw(fin(m, 'shaky_shaker', '_f0'), 120, 296)
  // inspector w1: feet x 68 on the M8 aisle (RoomLayout W1_X) → canvas x 56
  draw(fin(m, 'worker', '_e_idle_0'), 56, 114)
  // the shelf and its minis
  const shelf = t >= 3 ? tierPiece(m, 'shelf', t) : tierPiece(m, 'shelf', t)
  draw(shelf, 32, 384)
  const cols = t >= 3 ? 20 : 18
  const rows = t >= 3 ? 5 : 3
  const pitch = t >= 3 ? 11 : 12
  const [sx, sy] = t >= 3 ? [35, 388] : [38, 390]
  for (let i = 0; i < Math.min(shelfN, cols * rows); i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    draw(
      fin(m, `parcel_mini_${MINI[(i * 7) % 4]}`),
      sx + c * pitch - 3,
      sy + r * pitch - 3,
    )
  }
  return cv
}

/** one piece on a floor_t3 patch (interior props / fixtures, 1x) */
function onFloor(m: Manifest, im: Canvas | null, pad = 8): Canvas {
  const w = (im?.width ?? 32) + 2 * pad
  const h = (im?.height ?? 32) + 2 * pad
  const cv = createCanvas(w, h)
  const ctx = cv.getContext('2d')
  for (let y = 0; y < h; y += 32) {
    for (let x = 0; x < w; x += 32) {
      const f = fin(m, 'floor_t3')
      if (f) ctx.drawImage(f, x, y)
    }
  }
  if (im) ctx.drawImage(im, pad, pad)
  return cv
}

export function warehouseTier3Sheet(m: Manifest): string {
  const pieces: [string, string][] = [
    ['floor_t3', ''],
    ['floor_t3_lane', ''],
    ['wall_t3', ''],
    ['wallface_t3', ''],
    ['sign_t3', ''],
    ['shelf_t3', ''],
    ['dock_pad', ''],
    ['props_t3', ''],
    ['wanted_poster_t3', ''],
    ['lamp', '_green'],
    ['lamp', '_red'],
    ['lamp', '_amber'],
    ['lamp', '_off'],
    ['lamp', '_lock'],
  ]
  const padFull = (() => {
    const cv = onFloor(m, fin(m, 'dock_pad'))
    const ctx = cv.getContext('2d')
    PAD_SPOTS.forEach(([x, y], i) => {
      const mini = fin(m, `parcel_mini_${MINI[i % 4]}`)
      if (mini) ctx.drawImage(mini, 8 + x - 8, 8 + y - 8)
    })
    return cv
  })()
  const shelfFull = (n: number) => {
    const cv = onFloor(m, fin(m, 'shelf_t3'))
    const ctx = cv.getContext('2d')
    for (let i = 0; i < n; i++) {
      const mini = fin(m, `parcel_mini_${MINI[(i * 7) % 4]}`)
      if (mini)
        ctx.drawImage(
          mini,
          8 + 3 + (i % 20) * 11 - 3,
          8 + 4 + Math.floor(i / 20) * 11 - 3,
        )
    }
    return cv
  }
  const icons = ['ic_handoff', 'ic_cleared', 'ic_ship', 'ic_plane', 'ic_lock']
  const iconRow = panel(icons.length * 20 + 4, 24)
  icons.forEach((id, i) => {
    const im = fin(m, id)
    if (im) iconRow.getContext('2d').drawImage(im, 4 + i * 20, 4)
  })
  const sections: Section[] = [
    {
      title:
        'tier 3 "Regional" room (1x mock, tier-1 rect table + the M8 dock ' +
        'geometry): dock 1 open, dock 2 bought (roller pad), dock 3 locked; ' +
        'shelf 57/60 on the 20x5 @11 grid',
      blocks: [
        { cv: roomMock(m, 1, 40), label: 'tier 1 (as today)' },
        { cv: roomMock(m, 2, 50), label: 'tier 2 (as today)' },
        { cv: roomMock(m, 3, 57), label: 'tier 3 (M8)' },
      ],
    },
    {
      title: 'the M8 pieces at 1x on the tier-3 floor',
      blocks: [
        ...pieces.map(([id, f]) => ({
          cv: onFloor(m, fin(m, id, f)),
          label: `${id}${f}`,
        })),
        { cv: padFull, label: 'dock_pad + 6 minis' },
        { cv: shelfFull(60), label: 'shelf_t3 60/60' },
        { cv: shelfFull(100), label: 'shelf_t3 100 (cap at L5)' },
      ],
    },
    {
      title:
        'overseas icons (icon16, both atlases): ic_handoff, ic_cleared, ' +
        'ic_ship, ic_plane (+ ic_lock for scale)',
      blocks: [{ cv: iconRow, label: 'icons' }],
    },
  ]
  const out = join(CONTACT, 'warehouse-tier3@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grey4'), 1200, 4))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// M9 (build 2): art/contact/g6-tiers-machines-people@4x.png — the G6 sheet
// (plan-build2 §6 approval gates): the grown rooms of tiers 3-5, the M9
// pieces, the three machines, the Sorter Arm, faces / pips / ★ and
// worker_sorter

/** rows of the room per tier (design-m8-m9 §9 R2: 14 / 14 / 14 / 16 / 18) */
const ROWS_BY_TIER = [14, 14, 14, 16, 18] as const
/** belt slots per tier (design-m8-m9 §6.1 BELT_SLOTS_BY_TIER) */
const BELT_SLOTS = [4, 4, 4, 5, 6] as const

/**
 * A room of tier `t` in the M9 geometry (design-m8-m9 §6.1 "Room growth"):
 * rows 14 / 16 / 18, slots 5-6 unrolled in the belt column at y 352 / 416,
 * everything at y >= 352 of the tier-1 table moved down by Δ = 64 x
 * (beltSlots - 4); docks 2-3 owned from tier 4 (dock 3 is an L4 buy), the
 * Sorter Arm in the Hold Bay station from tier 4, neon_strip at tier 5; the
 * ext strip (`Slots 5-6` / `Slot 6`) where a lane slot lies past the belt
 * column. Machines: desk, detector, battery checker, shaker, X-ray (slot
 * 5); slot 6 shows its empty outline. An art mock, not the renderer.
 */
export function roomMockM9(m: Manifest, t: number, shelfN: number): Canvas {
  const rows = ROWS_BY_TIER[t - 1] ?? 14
  const slots = BELT_SLOTS[t - 1] ?? 4
  const dy = 64 * (slots - 4)
  const cv = createCanvas(352, rows * 32)
  const ctx = cv.getContext('2d')
  const draw = (im: Canvas | null, x: number, y: number) => {
    if (im) ctx.drawImage(im, x, y)
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 11; c++) {
      let im: Canvas | null
      if (c === 0 || c === 10) im = tierPiece(m, 'wall', t)
      else if (r === 0) im = tierPiece(m, 'wallface', t)
      else if (t === 1) im = fin(m, 'floor_t1', `_${(c + r) % 3}`)
      else if (c === 4)
        im = fin(m, `floor_t${t}_lane`) ?? tierPiece(m, 'floor', t)
      else im = tierPiece(m, 'floor', t)
      draw(im, c * 32, r * 32)
    }
  }
  // baseboard at height - 2 (LaneRenderer)
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.fillRect(0, rows * 32 - 2, 352, 2)
  // the belt down to the shelf, the chute, the rack, the station
  for (let x = 32; x < 128; x += 32) draw(fin(m, 'belt_h', '_0'), x, 48)
  draw(fin(m, 'belt_corner', '_0'), 128, 48)
  for (let y = 80; y <= 352 + dy; y += 32) draw(fin(m, 'belt_v', '_0'), 128, y)
  for (let y = 96; y < 352 + dy; y += 32) draw(fin(m, 'chute_v'), 172, y)
  draw(fin(m, 'holdbay_rack'), 192, 96)
  for (let i = 0; i < 5; i++) draw(fin(m, 'bay_pad'), 194, 98 + 48 * i)
  draw(fin(m, 'hold_station'), 264, 300)
  draw(fin(m, 'bin', '_closed'), 256, 384 + dy)
  // north wall dressing: bulb t1, strip lights t2-t4, neon t5
  draw(tierPiece(m, 'sign', t), 76, 4)
  if (t === 1) draw(fin(m, 'bulb', '_0'), 296, 6)
  else {
    const light = t >= 5 ? fin(m, 'neon_strip', '_f0') : fin(m, 'strip_light')
    draw(light, 8, 2)
    draw(light, 280, 2)
  }
  draw(tierPiece(m, 'wanted_poster', t), 272, 120)
  if (t === 1) {
    draw(fin(m, 'props_t1'), 264, 164)
    draw(fin(m, 'props_t1'), 264, 236)
  } else draw(tierPiece(m, 'props', t), 264, 196)
  // docks: 1 open (van), 2 bought (pad + minis), 3 locked until tier 4,
  // then open with a truck
  const three = t >= 4
  draw(fin(m, 'dock_door', '_open'), 0, 36)
  draw(fin(m, 'dock_tail_van', '_open'), 0, 44)
  draw(fin(m, 'dock_door', '_closed'), 0, 100)
  draw(fin(m, 'dock_pad'), 32, 100)
  draw(fin(m, 'dock_door', three ? '_open' : '_locked'), 0, 164)
  if (three) {
    draw(fin(m, 'dock_tail_truck', '_open'), 0, 172)
    draw(fin(m, 'dock_pad'), 32, 164)
  }
  const pads = three ? [100, 164] : [100]
  pads.forEach((py, k) => {
    PAD_SPOTS.slice(0, 4 - k).forEach(([x, y], i) => {
      draw(fin(m, `parcel_mini_${MINI[(i + k) % 4]}`), 32 + x - 8, py + y - 8)
    })
  })
  draw(fin(m, 'lamp', '_green'), 12, 24)
  draw(fin(m, 'lamp', '_amber'), 12, 92)
  draw(fin(m, 'lamp', three ? '_green' : '_lock'), 12, 156)
  // slots 1..beltSlots
  draw(fin(m, 'desk'), 80, 112)
  const machines = ['metal_detector', 'battery_checker', 'shaky_shaker', 'xray']
  for (let k = 2; k <= slots; k++) {
    const id = machines[k - 2]
    if (k === 6 || !id)
      draw(fin(m, 'slot_empty_outline'), 96, 96 + 64 * (k - 1))
    else draw(fin(m, id, '_f0'), 120, 40 + 64 * k)
  }
  // the ext strip for a lane slot past the belt column
  if (slots < 6) {
    draw(fin(m, 'ext_outline'), 72, 356 + dy)
    draw(fin(m, 'ic_lock'), 78, 360 + dy)
  }
  draw(fin(m, 'worker', '_e_idle_0'), 56, 114)
  // the Sorter Arm (L4) in the station, else the sorter on duty
  if (t >= 4) draw(fin(m, 'sorter_arm', '_f0'), 256, 284)
  else draw(fin(m, 'worker_sorter', '_w_idle_0'), 284, 308)
  // the shelf and its minis (20 x 5 @ 11 from (35, 388 + Δ) at t >= 3)
  draw(tierPiece(m, 'shelf', t), 32, 384 + dy)
  const cols = t >= 3 ? 20 : 18
  const rowsN = t >= 3 ? 5 : 3
  const pitch = t >= 3 ? 11 : 12
  const [sx, sy] = t >= 3 ? [35, 388 + dy] : [38, 390]
  for (let i = 0; i < Math.min(shelfN, cols * rowsN); i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    draw(
      fin(m, `parcel_mini_${MINI[(i * 7) % 4]}`),
      sx + c * pitch - 3,
      sy + r * pitch - 3,
    )
  }
  return cv
}

/** one piece on a patch of its own tier's floor (1x) */
function onTierFloor(
  m: Manifest,
  t: number,
  im: Canvas | null,
  pad = 8,
): Canvas {
  const w = (im?.width ?? 32) + 2 * pad
  const h = (im?.height ?? 32) + 2 * pad
  const cv = createCanvas(w, h)
  const ctx = cv.getContext('2d')
  const f = tierPiece(m, 'floor', t)
  for (let y = 0; y < h; y += 32) {
    for (let x = 0; x < w; x += 32) if (f) ctx.drawImage(f, x, y)
  }
  if (im) ctx.drawImage(im, pad, pad)
  return cv
}

/** shelf_t<t> with n minis on the 20 x 5 @ 11 grid, on its floor */
function shelfWith(m: Manifest, t: number, n: number): Canvas {
  const cv = onTierFloor(m, t, fin(m, `shelf_t${t}`))
  const ctx = cv.getContext('2d')
  for (let i = 0; i < n; i++) {
    const mini = fin(m, `parcel_mini_${MINI[(i * 7) % 4]}`)
    if (mini)
      ctx.drawImage(
        mini,
        8 + 3 + (i % 20) * 11 - 3,
        8 + 4 + Math.floor(i / 20) * 11 - 3,
      )
  }
  return cv
}

export function g6Sheet(m: Manifest): string {
  const S = 4
  const blocks = (id: string): Block[] => {
    const e = entry(m, id)
    return e ? blocksFor(m, e, finals(m, id, id)) : []
  }
  const arm = entry(m, 'sorter_arm')
  const piece = (t: number, id: string, f = ''): Block => ({
    cv: onTierFloor(m, t, fin(m, id, f)),
    label: `${id}${f}`,
  })
  const sections: Section[] = [
    {
      title:
        'G6 — interiors t3 / t4 / t5 (1x mocks of the M9 room growth, ' +
        'design-m8-m9 §6.1 + R2: 14 / 16 / 18 rows, slots 5-6 in the belt ' +
        'column, shelf / bin moved down 64 / 128): t3 shelf 57/60, t4 ' +
        '(X-ray in slot 5, dock 3, the Sorter Arm) 76/80, t5 (slot 6 open, ' +
        'neon) 98/100',
      blocks: [
        { cv: roomMockM9(m, 3, 57), label: 'tier 3 "Regional" (14 rows)' },
        { cv: roomMockM9(m, 4, 76), label: 'tier 4 "National" (16 rows)' },
        { cv: roomMockM9(m, 5, 98), label: 'tier 5 "Tycoon" (18 rows)' },
      ],
    },
    {
      title: 'the tier-4 pieces at 1x on floor_t4',
      blocks: [
        piece(4, 'floor_t4'),
        piece(4, 'floor_t4_lane'),
        piece(4, 'wall_t4'),
        piece(4, 'wallface_t4'),
        piece(4, 'sign_t4'),
        piece(4, 'props_t4'),
        piece(4, 'wanted_poster_t4'),
        piece(4, 'strip_light'),
        { cv: shelfWith(m, 4, 80), label: 'shelf_t4 80/80' },
      ],
    },
    {
      title:
        'the tier-5 pieces at 1x on floor_t5 (neon_strip replaces the strip lights)',
      blocks: [
        piece(5, 'floor_t5'),
        piece(5, 'floor_t5_lane'),
        piece(5, 'wall_t5'),
        piece(5, 'wallface_t5'),
        piece(5, 'sign_t5'),
        piece(5, 'props_t5'),
        piece(5, 'wanted_poster_t5'),
        piece(5, 'neon_strip', '_f0'),
        piece(5, 'neon_strip', '_f1'),
        { cv: shelfWith(m, 5, 100), label: 'shelf_t5 100/100' },
      ],
    },
    {
      title:
        'machines on the belt (idle f0 / scan f1): metal_detector + ' +
        'shaky_shaker for scale, battery_checker (L3), xray (L4, M9 re-roll #7)',
      blocks: [
        ...blocks('metal_detector').slice(0, 1),
        ...blocks('shaky_shaker').slice(0, 1),
        ...blocks('battery_checker'),
        ...blocks('xray'),
      ],
    },
    {
      title:
        'sorter_arm (fixture 64x64, L4): f0 rest, f1 reach (-x), f2 toss (+x)',
      blocks: arm ? fixtureFrames(m, arm) : [],
    },
    {
      title:
        'people: face_00-11 (skins x hair / hats), a hire-card mock with ' +
        'pips and the star (ic_star), the Hold Bay station with the sorter ' +
        'on duty',
      blocks: [
        { cv: faceGridScene(m), label: 'face_NN' },
        { cv: cardMock(m, 0, false, [3, 3, 0]), label: 'applicant 3 / 3 / 0' },
        { cv: cardMock(m, 6, true, [4, 2, 2]), label: 'star applicant' },
        { cv: stationScene(m, 'worker_sorter'), label: 'sorter on duty' },
      ],
    },
    {
      title: 'worker (inspector, yellow vest) vs worker_sorter (orange vest)',
      blocks: [
        ...blocks('worker').slice(0, 4),
        ...blocks('worker_sorter').slice(0, 4),
      ],
    },
  ]
  const out = join(CONTACT, 'g6-tiers-machines-people@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grey4'), 1200, S))
  return out.replace(ROOT, '')
}

// ---------------------------------------------------------------------------
// Build 3 (B3 §5, plan-build3 §6, G7): art/contact/events@4x.png — the 13
// category pictures as shipped, in situ on EventCard mocks, the victory art
// on a VictoryCard mock with the confetti burst over its top edge, the
// confetti frames, ic_event beside the rush ic_bell and in an EventChip
// mock, and the procedural fallbacks (eventPics.ts) for comparison.

/** a category picture's short name (ev_pic_staff -> staff) */
function shortPic(id: string): string {
  return id.replace('ev_pic_', '')
}

/** where a shipped frame comes from, for the labels */
function provenance(e: ManifestEntry | undefined): string {
  if (!e) return 'missing'
  if (e.source === 'procedural') return 'procedural'
  if (e.placeholder) return 'procedural fallback'
  return `pixellab #${e.chosenCandidate ?? '?'}${e.approved ? '' : ' (agent pick)'}`
}

/** greeked text: a run of `w` px on row y (m5x7 x-height bars) */
function greek(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  colour: string,
  h = 3,
): void {
  ctx.fillStyle = PALETTE.hex(colour)
  let cx = x
  let k = 0
  while (cx < x + w) {
    const word = 6 + ((k * 7 + w) % 13)
    const run = Math.min(word, x + w - cx)
    ctx.fillRect(cx, y, run, h)
    cx += run + 3
    k++
  }
}

/** a button: 1-px outline, face colour, a darker lip under it */
function button(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  face: string,
  lip: string,
): void {
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = PALETTE.hex(lip)
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
  ctx.fillStyle = PALETTE.hex(face)
  ctx.fillRect(x + 1, y + 1, w - 2, h - 4)
  greek(ctx, x + 6, y + Math.floor(h / 2) - 2, w - 12, 'grey5')
}

/**
 * An EventCard mock at 1x (layout of B3 §3.4, greeked text, not the game's
 * renderer): a dark masthead with ic_event and the PAUSED pill, the 48x48
 * category picture beside the title and body, an effects line in the
 * gain / danger colours, two option buttons — 344 px = the card at 360.
 */
function eventCardMock(m: Manifest, pic: Canvas | null): Canvas {
  const W = 344
  const cv = panel(W, 140)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('grey0')
  ctx.fillRect(1, 1, W - 2, 18)
  const bell = fin(m, 'ic_event')
  if (bell) ctx.drawImage(bell, 4, 2)
  greek(ctx, 24, 8, 70, 'grey5')
  ctx.fillStyle = PALETTE.hex('grey4')
  ctx.fillRect(W - 54, 4, 48, 11)
  greek(ctx, W - 50, 8, 40, 'grey1')
  if (pic) ctx.drawImage(pic, 8, 26)
  greek(ctx, 64, 28, 150, 'outline', 4)
  for (let r = 0; r < 4; r++) greek(ctx, 64, 40 + r * 9, 260 - r * 30, 'grey1')
  greek(ctx, 8, 84, 120, 'grass1')
  greek(ctx, 136, 84, 90, 'red1')
  button(ctx, 8, 100, 160, 32, 'blue1', 'blue0')
  button(ctx, 176, 100, 160, 32, 'grey4', 'grey2')
  return cv
}

/** the EventChip mock: a 24-px dark pill, ic_event, greeked label */
function eventChipMock(m: Manifest): Canvas {
  const cv = createCanvas(96, 24)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = PALETTE.hex('outline')
  ctx.fillRect(2, 0, 92, 24)
  ctx.fillRect(0, 2, 96, 20)
  ctx.fillStyle = PALETTE.hex('grey0')
  ctx.fillRect(3, 1, 90, 22)
  ctx.fillRect(1, 3, 94, 18)
  const bell = fin(m, 'ic_event')
  if (bell) ctx.drawImage(bell, 5, 4)
  greek(ctx, 25, 10, 60, 'grey5')
  return cv
}

/**
 * The VictoryCard mock: the TYCOON masthead (a gold band), the victory art
 * 1:1 between it and the greeked stats, confetti frames over the top edge.
 */
function victoryMock(m: Manifest, frame: number): Canvas {
  const W = 240
  const top = 16
  const cv = createCanvas(W, top + 196)
  const ctx = cv.getContext('2d')
  ctx.drawImage(panel(W, 196), 0, top)
  ctx.fillStyle = PALETTE.hex('gold1')
  ctx.fillRect(1, top + 1, W - 2, 22)
  ctx.fillStyle = PALETTE.hex('gold0')
  ctx.fillRect(1, top + 21, W - 2, 2)
  greek(ctx, 80, top + 9, 80, 'outline', 5)
  const art = fin(m, 'victory_art')
  if (art) ctx.drawImage(art, Math.floor((W - art.width) / 2), top + 28)
  for (let r = 0; r < 5; r++)
    greek(ctx, 16, top + 140 + r * 9, 200 - r * 18, 'grey1')
  const conf = fin(m, 'fx_confetti', `_f${frame}`)
  if (conf) {
    for (const x of [8, 64, 120, 176]) ctx.drawImage(conf, x, 0)
  }
  return cv
}

export async function eventsSheet(m: Manifest): Promise<string> {
  const { EVENT_PIC_IDS, eventPic, victoryPlate } =
    await import('./eventPics.ts')
  const hex = { hex: (n: string) => PALETTE.hex(n) } as unknown as Parameters<
    ReturnType<typeof eventPic>['paint']
  >[1]
  const gridCanvas = (g: ReturnType<typeof eventPic>): Canvas => {
    const cv = createCanvas(g.w, g.h)
    g.paint(cv.getContext('2d'), hex)
    return cv
  }
  const shipped: Block[] = EVENT_PIC_IDS.map((id) => {
    const cv = panel(56, 56)
    const pic = fin(m, id)
    if (pic) cv.getContext('2d').drawImage(pic, 4, 4)
    const e = entry(m, id)
    const tag = !e || e.placeholder ? 'proc' : `PL #${e.chosenCandidate ?? '?'}`
    return { cv, label: `${shortPic(id)} ${tag}` }
  })
  const inSitu: Block[] = [
    'ev_pic_underworld',
    'ev_pic_staff',
    'ev_pic_money',
    'ev_pic_job',
  ].map((id) => ({
    cv: eventCardMock(m, fin(m, id)),
    label: `EventCard mock — ${shortPic(id)}`,
  }))
  const fallbacks: Block[] = EVENT_PIC_IDS.map((id) => {
    const cv = panel(56, 56)
    cv.getContext('2d').drawImage(gridCanvas(eventPic(id)), 4, 4)
    return { cv, label: shortPic(id) }
  })
  const confetti: Block[] = Array.from({ length: 8 }, (_, f) => {
    const cv = panel(40, 40)
    const c = fin(m, 'fx_confetti', `_f${f}`)
    if (c) cv.getContext('2d').drawImage(c, 4, 4)
    return { cv, label: `f${f}` }
  })
  const icons: Block[] = [
    { id: 'ic_event', tag: 'ic_event' },
    { id: 'ic_bell', tag: 'ic_bell (rush)' },
  ].map(({ id, tag }) => {
    // wide enough for the tag, so neighbouring labels never overlap
    const cv = panel(64, 24)
    const c = fin(m, id)
    if (c) cv.getContext('2d').drawImage(c, 24, 4)
    return { cv, label: tag }
  })
  const fallbackVictory = panel(216, 112)
  fallbackVictory.getContext('2d').drawImage(gridCanvas(victoryPlate()), 4, 4)
  const va = entry(m, 'victory_art')
  const sections: Section[] = [
    {
      title:
        'G7 — the 13 category pictures (event-pic 48x48, world atlas) as ' +
        'they ship',
      blocks: shipped,
    },
    {
      title:
        'in situ: EventCard mocks at 1x (344 px = the card at 360; greeked ' +
        'text, masthead with ic_event, effects line gain / danger)',
      blocks: inSitu,
    },
    {
      title: `victory_art (ui 208x104, ${provenance(va)}) on a VictoryCard mock, the confetti burst over its top edge (f2, f4)`,
      blocks: [
        { cv: victoryMock(m, 2), label: 'VictoryCard, confetti f2' },
        { cv: victoryMock(m, 4), label: 'VictoryCard, confetti f4' },
      ],
    },
    {
      title:
        'fx_confetti f0-f7 (fx 32x32, world); ic_event beside the rush ' +
        'ic_bell; the EventChip mock',
      blocks: [
        ...confetti,
        ...icons,
        { cv: eventChipMock(m), label: 'EventChip mock' },
      ],
    },
    {
      title:
        'procedural fallbacks (tools/art/eventPics.ts): what ships with no ' +
        'token or after three failed rounds (R24)',
      blocks: [
        ...fallbacks,
        { cv: fallbackVictory, label: 'victory_art fallback' },
      ],
    },
  ]
  const out = join(CONTACT, 'events@4x.png')
  writeIfChanged(out, render(sections, PALETTE.hex('grey4'), 1420))
  return out.replace(ROOT, '')
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const { loadManifest } = await import('./manifest.ts')
  if (cmd === 'fixes') {
    const i = rest.indexOf('--hop')
    const hop = i >= 0 ? (rest[i + 1] ?? null) : null
    console.log(`contact: ${fixesSheet(loadManifest(), hop)}`)
  } else if (cmd === 'people') {
    console.log(`contact: ${peopleSheet(loadManifest())}`)
  } else if (cmd === 'lowres') {
    console.log(`contact: ${lowresSheet(loadManifest())}`)
  } else if (cmd === 'rural') {
    console.log(`contact: ${ruralSheet(loadManifest())}`)
  } else if (cmd === 'tiers') {
    console.log(`contact: ${tiersSheet(loadManifest())}`)
  } else if (cmd === 'airport') {
    console.log(`contact: ${airportSheet(loadManifest())}`)
  } else if (cmd === 'civic') {
    console.log(`contact: ${civicSheet(loadManifest())}`)
  } else if (cmd === 'tier3') {
    console.log(`contact: ${warehouseTier3Sheet(loadManifest())}`)
  } else if (cmd === 'g6') {
    console.log(`contact: ${g6Sheet(loadManifest())}`)
  } else if (cmd === 'events') {
    console.log(`contact: ${await eventsSheet(loadManifest())}`)
  } else {
    console.error(
      'usage: node tools/art/contact.ts fixes [--hop <crop.png>] | people | ' +
        'lowres | rural | tiers | tier3 | g6 | airport | civic | events',
    )
    process.exitCode = 1
  }
}
