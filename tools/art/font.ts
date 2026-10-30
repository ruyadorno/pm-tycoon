// `vlr font:build` (style-guide.md §3.1, phaser4-notes.md §7, plan.md M0
// task 12, risk R7): the m5x7 TTF (CC0, Daniel Linssen) -> the `m5x7` glyph
// sheet art/final/font/m5x7.png + its BMFont XML src/assets/m5x7.xml (a
// Vite `?url` import in src/render/assetUrls.ts, hashed in builds).
//
// - The TTF must match FONT_SHA256; it is registered with GlobalFonts and
//   ASCII 32..126 plus '·' and '×' (both in the TTF) are rendered at 16 px,
//   alpha thresholded at 128 (1-bit). DRAWN adds the UI symbols the view
//   specs print but the TTF lacks (– — − … → ▲ ▼ ▬ ▸ ▾ ✕), pixel-drawn in
//   m5x7's metrics, so BitmapText never silently drops a character.
//   Glyphs are white (#ffffff) so BitmapText tints land on exact palette
//   colours; the sheet is packed into the `world` atlas by `art:atlas` as the
//   frame "m5x7" and registered in PreloadScene with
//   BitmapText.ParseFromAtlas(scene, 'm5x7', 'world', 'm5x7', 'm5x7-xml').
// - Metrics: info size 16, common lineHeight 14 / base 11 (the TTF's
//   ascent 682 + descent 128 + gap 92 of 1024 units at 16 px), so a cap
//   (7 px tall, yoffset 4) sits centred in a 14-px line. Every char's
//   x/y/width/height is its tight 1-bit bbox in the sheet (untrimmed sheet
//   coordinates; ParseXMLBitmapFont subtracts the atlas trim itself),
//   xoffset/yoffset are relative to the pen / line top, xadvance is the
//   integer measureText width. No kerning pairs (the TTF has no kern/GPOS).
// - Advances are verified against measureText and against a rendered pair
//   ("<ch>I": the I's ink must start at adv(ch) + xoffset(I)); any mismatch,
//   fractional advance or semi-transparent pixel is reported and exits 1.
// - Missing TTF or hash mismatch (or `--procedural`): the sheet is drawn from
//   FALLBACK below — the same 1-px 5x7 bitmaps and metrics captured as data
//   (m5x7 is CC0), so the key, frame and XML are identical — and the run logs
//   "font: procedural fallback".

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import {
  finalPath,
  frameSetSha256,
  getEntry,
  loadManifest,
  saveManifest,
} from './manifest.ts'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const TTF_PATH = join(ROOT, 'art/fonts/m5x7.ttf')
export const XML_PATH = join(ROOT, 'src/assets/m5x7.xml')
export const FONT_SHA256 =
  '47c3f0b01f0fd417b3a44c2888a71d3072f750e76f3e6e946a6a9b188d988cbf'

export const SIZE = 16
export const LINE_HEIGHT = 14
export const BASE = 11
export const FIRST = 32
export const LAST = 126
/** codepoints rendered from the TTF (or FALLBACK): ASCII + '·' '×' */
export const TTF_CHARS: readonly number[] = [
  ...Array.from({ length: LAST - FIRST + 1 }, (_v, i) => FIRST + i),
  0xb7,
  0xd7,
]

/** UI symbols the TTF lacks: [codepoint, xadvance, xoffset, yoffset, rows] */
export const DRAWN: readonly (readonly [
  number,
  number,
  number,
  number,
  readonly string[],
])[] = [
  [0x2013, 7, 0, 7, ['######']], // – en dash ("5–6")
  [0x2014, 9, 0, 7, ['########']], // — em dash
  [0x2212, 6, 0, 7, ['#####']], // − minus ("−$28")
  [0x2026, 6, 0, 10, ['#.#.#']], // …
  [0x2192, 6, 0, 5, ['..#..', '...#.', '#####', '...#.', '..#..']], // →
  [0x25b2, 6, 0, 7, ['..#..', '.###.', '#####']], // ▲ trend up
  [0x25bc, 6, 0, 7, ['#####', '.###.', '..#..']], // ▼ trend down
  [0x25ac, 6, 0, 7, ['#####', '#####']], // ▬ flat
  [0x25b8, 3, 0, 6, ['#.', '##', '#.']], // ▸ ("District ▸")
  [0x25be, 4, 0, 8, ['###', '.#.']], // ▾ ("Any ▾")
  [0x2715, 6, 0, 5, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']], // ✕ close
]

/** sheet layout: 16 cells per row, 10x16 cells, glyph bbox at cell + (1, 1) */
export const COLS = 16
export const CELL_W = 10
export const CELL_H = 16

export interface Glyph {
  id: number
  /** tight 1-bit bitmap rows, '#' = ink ('' rows when the glyph is empty) */
  rows: string[]
  w: number
  h: number
  xoffset: number
  yoffset: number
  xadvance: number
}

// ---------------------------------------------------------------------------
// TTF path

const FAMILY = 'm5x7-build'
const PEN_X = 8
const BASELINE = 24
const PROBE = 48

function inkOf(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  w: number,
  h: number,
) {
  const data = ctx.getImageData(0, 0, w, h).data
  let soft = 0
  const on = (x: number, y: number) => {
    const a = data[(y * w + x) * 4 + 3] ?? 0
    if (a > 0 && a < 255) soft++
    return a >= 128
  }
  const ink: boolean[][] = []
  for (let y = 0; y < h; y++) {
    const row: boolean[] = []
    for (let x = 0; x < w; x++) row.push(on(x, y))
    ink.push(row)
  }
  return { ink, soft }
}

function bbox(ink: boolean[][]): [number, number, number, number] | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  ink.forEach((row, y) =>
    row.forEach((v, x) => {
      if (!v) return
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }),
  )
  return x1 < 0 ? null : [x0, y0, x1, y1]
}

/** render one string at the pen and return its 1-bit ink */
function render(text: string) {
  const c = createCanvas(PROBE * 2, PROBE)
  const ctx = c.getContext('2d')
  ctx.font = `${SIZE}px ${FAMILY}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, PEN_X, BASELINE)
  return { ...inkOf(ctx, PROBE * 2, PROBE), ctx }
}

/** Measure every glyph from the TTF; problems are returned, never thrown. */
export function measureTtf(path: string = TTF_PATH): {
  glyphs: Glyph[]
  problems: string[]
} {
  if (!GlobalFonts.registerFromPath(path, FAMILY)) {
    return { glyphs: [], problems: [`could not register ${path}`] }
  }
  const glyphs: Glyph[] = []
  const problems: string[] = []
  const lineTop = BASELINE - BASE
  for (const id of TTF_CHARS) {
    const ch = String.fromCharCode(id)
    const { ink, soft, ctx } = render(ch)
    if (soft > 0)
      problems.push(
        `'${ch}': ${soft} semi-transparent pixels before the threshold`,
      )
    const adv = ctx.measureText(ch).width
    if (!Number.isInteger(adv))
      problems.push(`'${ch}': fractional advance ${adv}`)
    const b = bbox(ink)
    if (!b) {
      glyphs.push({
        id,
        rows: [],
        w: 0,
        h: 0,
        xoffset: 0,
        yoffset: 0,
        xadvance: Math.round(adv),
      })
      continue
    }
    const [x0, y0, x1, y1] = b
    const rows: string[] = []
    for (let y = y0; y <= y1; y++) {
      rows.push(
        (ink[y] ?? [])
          .slice(x0, x1 + 1)
          .map((v) => (v ? '#' : '.'))
          .join(''),
      )
    }
    glyphs.push({
      id,
      rows,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      xoffset: x0 - PEN_X,
      yoffset: y0 - lineTop,
      xadvance: Math.round(adv),
    })
  }
  problems.push(...verifyAdvances(glyphs))
  return { glyphs, problems }
}

/** rendered-pair check: in "<ch>I" the I starts at adv(ch) + xoffset(I) */
function verifyAdvances(glyphs: Glyph[]): string[] {
  const out: string[] = []
  const I = glyphs.find((g) => g.id === 73) as Glyph
  for (const g of glyphs) {
    const ch = String.fromCharCode(g.id)
    const alone = render(ch).ink
    const { ink, ctx } = render(`${ch}I`)
    const pair = ctx.measureText(`${ch}I`).width
    if (pair !== g.xadvance + I.xadvance) {
      out.push(
        `'${ch}I': measureText ${pair} != ${g.xadvance} + ${I.xadvance} (kerning?)`,
      )
    }
    // the I's ink = the pair's ink minus the lone glyph's ink
    const extra = ink.map((row, y) => row.map((v, x) => v && !alone[y]?.[x]))
    const b = bbox(extra)
    const expect = PEN_X + g.xadvance + I.xoffset
    if (!b || b[0] !== expect) {
      out.push(
        `'${ch}': rendered I at x ${b ? b[0] : '?'}, expected ${expect} from xadvance ${g.xadvance}`,
      )
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Fallback: the same 5x7 bitmaps and metrics as data (m5x7 is CC0).
// One entry per TTF_CHARS codepoint, in order: "xadvance,xoffset,yoffset,
// width:row,row,…" with rows as base-36 bit masks (bit width-1 = leftmost
// pixel); no rows = an empty glyph (space).

export const FALLBACK: readonly string[] = [
  '5,0,0,0:',
  '2,0,4,1:1,1,1,1,1,0,1',
  '4,0,4,3:5,5',
  '6,0,5,5:a,v,a,a,v,a',
  '6,0,4,5:4,f,k,e,5,u,4',
  '6,0,4,5:p,p,2,4,8,j,j',
  '7,0,4,6:8,k,k,o,y,y,t',
  '2,0,4,1:1,1',
  '3,0,4,2:1,2,2,2,2,2,2,1',
  '3,0,4,2:2,1,1,1,1,1,1,2',
  '4,0,4,3:5,2,5',
  '6,0,5,5:4,4,v,4,4',
  '3,0,10,2:1,2',
  '6,0,7,5:v',
  '2,0,10,1:1',
  '4,0,4,3:1,1,2,2,2,4,4',
  '6,0,4,5:e,h,h,h,h,h,e',
  '6,0,4,5:4,c,4,4,4,4,v',
  '6,0,4,5:e,h,1,2,4,8,v',
  '6,0,4,5:e,h,1,6,1,h,e',
  '6,0,4,5:2,6,a,i,v,2,2',
  '6,0,4,5:v,g,u,1,1,1,u',
  '6,0,4,5:e,g,u,h,h,h,e',
  '6,0,4,5:v,1,1,2,2,4,4',
  '6,0,4,5:e,h,h,e,h,h,e',
  '6,0,4,5:e,h,h,h,f,1,e',
  '2,0,7,1:1,0,0,1',
  '3,0,7,2:1,0,0,1,2',
  '4,0,5,3:1,2,4,2,1',
  '5,0,6,4:f,0,f',
  '4,0,5,3:4,2,1,2,4',
  '6,0,4,5:e,h,1,2,4,0,4',
  '6,0,4,5:e,h,n,l,n,g,f',
  '6,0,4,5:e,h,h,h,v,h,h',
  '6,0,4,5:u,h,u,h,h,h,u',
  '6,0,4,5:7,8,g,g,g,g,f',
  '6,0,4,5:s,i,h,h,h,h,u',
  '6,0,4,5:f,g,u,g,g,g,f',
  '6,0,4,5:f,g,u,g,g,g,g',
  '6,0,4,5:e,h,g,n,h,h,e',
  '6,0,4,5:h,h,v,h,h,h,h',
  '6,0,4,5:v,4,4,4,4,4,v',
  '6,0,4,5:v,1,1,1,1,2,s',
  '6,0,4,5:h,h,i,s,i,h,h',
  '6,0,4,5:g,g,g,g,g,g,f',
  '8,0,4,7:1i,21,21,21,21,21,1t',
  '6,0,4,5:s,i,h,h,h,h,h',
  '6,0,4,5:e,h,h,h,h,h,e',
  '6,0,4,5:u,h,h,h,u,g,g',
  '6,0,4,5:e,h,h,h,l,i,d',
  '6,0,4,5:u,h,h,h,u,h,h',
  '6,0,4,5:f,g,g,e,1,1,u',
  '6,0,4,5:v,4,4,4,4,4,4',
  '6,0,4,5:h,h,h,h,h,h,e',
  '6,0,4,5:h,h,h,h,h,a,4',
  '8,0,4,7:1t,1t,21,21,21,21,1i',
  '6,0,4,5:h,h,a,4,a,h,h',
  '6,0,4,5:h,h,h,a,4,4,4',
  '6,0,4,5:v,1,2,4,8,g,v',
  '3,0,4,2:3,2,2,2,2,2,2,3',
  '4,0,4,3:4,4,2,2,2,1,1',
  '3,0,4,2:3,1,1,1,1,1,1,3',
  '6,0,4,5:4,a,h',
  '6,0,10,5:v',
  '3,0,4,2:2,1',
  '6,0,6,5:e,1,f,h,f',
  '6,0,4,5:g,g,u,h,h,h,u',
  '5,0,6,4:7,8,8,8,7',
  '6,0,4,5:1,1,f,h,h,h,f',
  '6,0,6,5:e,h,v,g,e',
  '5,0,4,4:3,4,f,4,4,4,4',
  '6,0,6,5:e,h,h,h,f,1,e',
  '6,0,4,5:g,g,u,h,h,h,h',
  '3,0,4,2:1,0,3,1,1,1,1',
  '4,0,4,3:1,0,3,1,1,1,1,1,6',
  '5,0,4,4:8,8,9,a,c,a,9',
  '3,0,4,2:2,2,2,2,2,2,1',
  '8,0,6,7:2m,2x,21,21,21',
  '6,0,6,5:m,p,h,h,h',
  '6,0,6,5:e,h,h,h,e',
  '6,0,6,5:u,h,h,h,u,g,g',
  '6,0,6,5:f,h,h,h,f,1,1',
  '5,0,6,4:b,c,8,8,8',
  '6,0,6,5:f,g,e,1,u',
  '5,0,4,4:4,4,f,4,4,4,3',
  '6,0,6,5:h,h,h,j,d',
  '6,0,6,5:h,h,h,a,4',
  '8,0,6,7:1t,21,21,21,1i',
  '6,0,6,5:h,a,4,a,h',
  '6,0,6,5:h,h,h,h,f,1,e',
  '6,0,6,5:v,2,4,8,v',
  '4,0,4,3:3,2,2,6,2,2,2,3',
  '2,0,4,1:1,1,1,1,1,1,1',
  '4,0,4,3:6,2,2,3,2,2,2,6',
  '6,0,6,5:8,l,2',
  '2,0,7,1:1',
  '6,0,5,5:h,a,4,a,h',
]

function decodeFallback(): Glyph[] {
  return FALLBACK.map((spec, i) => {
    const [head = '', body = ''] = spec.split(':')
    const [adv = 0, xo = 0, yo = 0, w = 0] = head.split(',').map(Number)
    const rows = body
      ? body.split(',').map((v) => {
          const n = Number.parseInt(v, 36)
          let s = ''
          for (let b = w - 1; b >= 0; b--) s += (n >> b) & 1 ? '#' : '.'
          return s
        })
      : []
    return {
      id: TTF_CHARS[i] as number,
      rows,
      w: rows.length ? w : 0,
      h: rows.length,
      xoffset: rows.length ? xo : 0,
      yoffset: rows.length ? yo : 0,
      xadvance: adv,
    }
  })
}

/** encode glyphs into FALLBACK strings (dev helper; see the header) */
export function encodeGlyphs(glyphs: readonly Glyph[]): string[] {
  return glyphs.map((g) => {
    const rows = g.rows.map((r) =>
      Number.parseInt(r.replaceAll('#', '1').replaceAll('.', '0'), 2).toString(
        36,
      ),
    )
    return `${g.xadvance},${g.xoffset},${g.yoffset},${g.w}:${rows.join(',')}`
  })
}

/** the hand-drawn symbol glyphs */
export function drawnGlyphs(): Glyph[] {
  return DRAWN.map(([id, xadvance, xoffset, yoffset, rows]) => ({
    id,
    rows: rows.slice(),
    w: Math.max(...rows.map((r) => r.length)),
    h: rows.length,
    xoffset,
    yoffset,
    xadvance,
  }))
}

// ---------------------------------------------------------------------------
// Sheet + XML (glyph i sits in cell i, in TTF_CHARS then DRAWN order)

export const GLYPH_COUNT = TTF_CHARS.length + DRAWN.length

export function sheetSize(): [number, number] {
  return [COLS * CELL_W, Math.ceil(GLYPH_COUNT / COLS) * CELL_H]
}

function cellOf(i: number): [number, number] {
  return [(i % COLS) * CELL_W + 1, Math.floor(i / COLS) * CELL_H + 1]
}

export function buildSheet(glyphs: readonly Glyph[]): Buffer {
  const [W, H] = sheetSize()
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  glyphs.forEach((g, i) => {
    if (g.w > CELL_W - 1 || g.h > CELL_H - 1 || g.yoffset + g.h > LINE_HEIGHT) {
      throw new Error(
        `font: glyph ${g.id} is ${g.w}x${g.h}, larger than its cell`,
      )
    }
    const [cx, cy] = cellOf(i)
    g.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] === '#') ctx.fillRect(cx + x, cy + y, 1, 1)
    })
  })
  return c.toBuffer('image/png')
}

export function buildXml(glyphs: readonly Glyph[]): string {
  const [W, H] = sheetSize()
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<font>',
    `  <info face="m5x7" size="${SIZE}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="1" padding="0,0,0,0" spacing="0,0" outline="0"/>`,
    `  <common lineHeight="${LINE_HEIGHT}" base="${BASE}" scaleW="${W}" scaleH="${H}" pages="1" packed="0"/>`,
    '  <pages>',
    '    <page id="0" file="m5x7.png"/>',
    '  </pages>',
    `  <chars count="${glyphs.length}">`,
  ]
  glyphs.forEach((g, i) => {
    const [cx, cy] = cellOf(i)
    lines.push(
      `    <char id="${g.id}" x="${cx}" y="${cy}" width="${g.w}" height="${g.h}" xoffset="${g.xoffset}" yoffset="${g.yoffset}" xadvance="${g.xadvance}" page="0" chnl="15"/>`,
    )
  })
  lines.push('  </chars>', '</font>', '')
  return lines.join('\n')
}

function writeIfChanged(path: string, data: Buffer | string): boolean {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  writeFileSync(path, buf)
  return true
}

export function fileSha256(path: string): string | null {
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function run(args: readonly string[] = process.argv.slice(2)): number {
  const forced = args.includes('--procedural')
  const sha = fileSha256(TTF_PATH)
  let glyphs: Glyph[]
  let source: string
  if (!forced && sha === FONT_SHA256) {
    const { glyphs: g, problems } = measureTtf()
    if (problems.length > 0) {
      for (const p of problems) console.error(`font: ${p}`)
      console.error(`font: ${problems.length} problems in the TTF export (R7)`)
      return 1
    }
    glyphs = [...g, ...drawnGlyphs()]
    source = 'art/fonts/m5x7.ttf'
  } else {
    const why = forced
      ? '--procedural'
      : sha === null
        ? 'TTF missing'
        : `sha256 ${sha.slice(0, 12)}… != expected`
    console.log(`font: procedural fallback (${why})`)
    glyphs = [...decodeFallback(), ...drawnGlyphs()]
    if (FALLBACK.length !== TTF_CHARS.length) {
      console.error(
        `font: fallback table has ${FALLBACK.length} glyphs, expected ${TTF_CHARS.length}`,
      )
      return 1
    }
    source = 'fallback table'
  }
  const m = loadManifest()
  const e = getEntry(m, 'm5x7')
  const png = buildSheet(glyphs)
  const wrotePng = writeIfChanged(finalPath(e, 'm5x7'), png)
  const wroteXml = writeIfChanged(XML_PATH, buildXml(glyphs))
  e.finalSha256 = frameSetSha256(e) ?? undefined
  const changed = saveManifest(m)
  const [W, H] = sheetSize()
  const advs = glyphs.map((g) => g.xadvance)
  console.log(
    `font: ${glyphs.length} glyphs from ${source}, sheet ${W}x${H} ` +
      `(frame "m5x7"), lineHeight ${LINE_HEIGHT} base ${BASE}, advances ` +
      `${Math.min(...advs)}..${Math.max(...advs)} px; ` +
      `${wrotePng ? 'png written' : 'png unchanged'}, ${wroteXml ? 'xml written' : 'xml unchanged'}` +
      `${changed ? ', manifest updated' : ''}`,
  )
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = run()
}
