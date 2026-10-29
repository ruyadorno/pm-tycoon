// Parcel drawers (style-guide.md §2.8, warehouse-view.md §1.5, plan.md Q28):
// parcel_{s,m,l,xl} on the 32x32 `parcel` canvas, drawn 16/20/24/28 px
// (outline included) and centred, top-down 3/4 like every interior sprite.
//   ''           clean: brown cardboard, tape, a shipping label (M and up)
//   _mal         revealed malware: the reserved `mal` ramp + a red bomb inset
//   _magic       gold box with a pink ribbon (data rows only, P2)
//   _flip_f0..f5 the reveal strip: 100 / 66 / 33 % wide clean, then
//                33 / 66 / 100 % wide dark (f5 = _mal) — a pre-drawn
//                horizontal squash so nothing scales at runtime.
// The parcel minis (shelf) and HUD parcel icons live in icons.ts.

import type { DrawCtx } from './draw-api.ts'
import { registerDrawer } from './drawers.ts'
import { type BoxScheme, CARDBOARD, Grid, gridFrames, tpl } from './icons.ts'

const CANVAS = 32

/** outline-inclusive side per size (plan.md Q28) */
export const PARCEL_PX: Readonly<Record<string, number>> = {
  s: 16,
  m: 20,
  l: 24,
  xl: 28,
}

const MAL: BoxScheme = {
  top: 'mal1',
  topHi: 'mal2',
  front: 'mal0',
  frontLo: 'mal0',
  tape: 'mal2',
  tapeFront: 'mal1',
}

const MAGIC: BoxScheme = {
  top: 'gold1',
  topHi: 'gold2',
  front: 'gold0',
  frontLo: 'gold0',
  tape: 'pink1',
  tapeFront: 'pink0',
}

/** rows of the top face for an inner height (shared by every look) */
function topRows(ih: number): number {
  return Math.max(2, Math.round(ih * 0.58))
}

/** inner (outline-free) content of a box of side n, as an (n-2)^2 grid */
function inner(n: number, s: BoxScheme): Grid {
  const iw = n - 2
  const tr = topRows(iw)
  const g = new Grid(iw, iw)
  g.rect(0, 0, iw, tr, s.top)
  g.hline(0, iw - 1, 0, s.topHi)
  g.vline(0, 0, tr - 1, s.topHi)
  g.rect(0, tr, iw, iw - tr, s.front)
  const tw = iw >= 10 ? 2 : 1
  const tx = Math.floor((iw - tw) / 2)
  if (s.tape) g.rect(tx, 0, tw, tr, s.tape)
  if (s.tapeFront) g.rect(tx, tr, tw, iw - tr, s.tapeFront)
  return g
}

/** shipping label on the clean top face (M and up) */
function label(g: Grid, iw: number): void {
  if (iw < 18) return
  const tr = topRows(iw)
  const lw = iw >= 26 ? 7 : iw >= 22 ? 6 : 5
  const lh = iw >= 22 ? 4 : 3
  const lx = 2
  const ly = Math.max(1, Math.floor((tr - lh) / 2))
  g.rect(lx, ly, lw, lh, 'grey5')
  g.hline(lx + 1, lx + lw - 2, ly + 1, 'grey2')
  if (lh >= 4) g.hline(lx + 1, lx + lw - 3, ly + 2, 'grey3')
  g.hline(lx, lx + lw - 1, ly + lh, 'brown1')
}

/** round bomb template of body diameter dia, with cap, fuse and spark */
function bombGrid(dia: number): Grid {
  const rows: string[] = []
  const pad = 2
  const w = dia + 4
  for (let y = 0; y < dia + pad; y++) rows.push('.'.repeat(w))
  const set = (x: number, y: number, c: string) => {
    const r = rows[y]
    if (r === undefined || x < 0 || x >= w) return
    rows[y] = r.slice(0, x) + c + r.slice(x + 1)
  }
  const R = dia / 2
  for (let y = 0; y < dia; y++) {
    for (let x = 0; x < dia; x++) {
      const dx = x + 0.5 - R
      const dy = y + 0.5 - R
      if (dx * dx + dy * dy <= R * R + R * 0.35) set(x + 1, y + pad, 'r')
    }
  }
  // highlight glint, metal cap, fuse and spark at the top-right
  if (dia >= 6) set(Math.round(R) - 1, pad + Math.round(R) - 2, 'P')
  const cx = Math.round(dia * 0.7) + 1
  set(cx, pad, 'm')
  set(cx + 1, pad, 'm')
  if (dia >= 8) set(cx, pad - 1, 'm')
  set(cx + 1, pad - 1, 'D')
  set(cx + 2, pad - 2, 'Y')
  if (dia >= 8) set(cx + 3, pad - 2, 'P')
  const g = tpl(rows, w + 2, dia + pad + 2, 1, 1)
  g.outline()
  return g
}

const BOMB_DIA: Readonly<Record<string, number>> = { s: 6, m: 7, l: 9, xl: 11 }

type Look = 'clean' | 'mal' | 'magic'

/** inner content (no outline) of one look at size n */
function content(size: string, look: Look): Grid {
  const n = PARCEL_PX[size] as number
  const iw = n - 2
  if (look === 'clean') {
    const g = inner(n, CARDBOARD)
    label(g, iw)
    return g
  }
  if (look === 'magic') {
    const g = inner(n, MAGIC)
    const tr = topRows(iw)
    // ribbon across the top face + a bow at the crossing, sparkles
    const ry = Math.floor(tr / 2)
    g.hline(0, iw - 1, ry, 'pink1')
    if (iw >= 18) g.hline(0, iw - 1, ry + 1, 'pink0')
    const bx = Math.floor(iw / 2)
    g.rect(bx - 3, ry - 1, 2, 2, 'pink1')
    g.rect(bx + 1, ry - 1, 2, 2, 'pink1')
    g.set(bx - 1, ry, 'pink0')
    g.set(bx, ry, 'pink0')
    const sp = (x: number, y: number) => {
      g.set(x, y, 'grey5')
      g.set(x - 1, y, 'yellow3')
      g.set(x + 1, y, 'yellow3')
      g.set(x, y - 1, 'yellow3')
      g.set(x, y + 1, 'yellow3')
    }
    sp(iw - 4, 2)
    if (iw >= 18) sp(3, tr + 2)
    return g
  }
  const g = inner(n, MAL)
  // stitched-up look: a second tape strip across the top face
  const tr = topRows(iw)
  g.hline(0, iw - 1, Math.floor(tr / 2), 'mal2')
  // the red bomb, centred, sitting a little low so the fuse fits
  const b = bombGrid(BOMB_DIA[size] as number)
  const bb = b.bbox()
  if (bb) {
    const bw = bb[2] - bb[0] + 1
    const bh = bb[3] - bb[1] + 1
    const ox = Math.floor((iw - bw) / 2) - bb[0]
    const oy = Math.max(0, Math.ceil((iw - bh) / 2)) - bb[1]
    // the bomb may overhang the inner box by its outline; clip to inner
    g.blit(b, ox, oy)
  }
  return g
}

/** horizontal nearest-neighbour squash of a square inner grid to width w */
function squash(src: Grid, w: number): Grid {
  const g = new Grid(w, src.h)
  for (let x = 0; x < w; x++) {
    const sx = Math.min(src.w - 1, Math.floor(((x + 0.5) * src.w) / w))
    for (let y = 0; y < src.h; y++) g.set(x, y, src.get(sx, y))
  }
  return g
}

/** the outlined parcel on the 32x32 canvas from inner content */
function framed(c: Grid): Grid {
  const g = new Grid(CANVAS, CANVAS)
  const ox = Math.floor((CANVAS - (c.w + 2)) / 2)
  const oy = Math.floor((CANVAS - (c.h + 2)) / 2)
  g.rect(ox, oy, c.w + 2, c.h + 2, 'outline')
  g.blit(c, ox + 1, oy + 1)
  // 1-px drop shadow to the bottom-right (interior light from the top-left)
  g.hline(ox + 1, ox + c.w + 2, oy + c.h + 2, 'outline')
  g.vline(ox + c.w + 2, oy + 1, oy + c.h + 2, 'outline')
  return g
}

/** even inner width nearest to iw * k (keeps the squashed box centred) */
function evenWidth(iw: number, k: number): number {
  const t = iw * k
  const lo = Math.floor(t / 2) * 2
  return Math.max(2, t - lo <= lo + 2 - t ? lo : lo + 2)
}

const FLIP: readonly [Look, number][] = [
  ['clean', 1],
  ['clean', 0.66],
  ['clean', 0.33],
  ['mal', 0.33],
  ['mal', 0.66],
  ['mal', 1],
]

function parcelFrame(size: string, suffix: string): Grid {
  if (suffix === '') return framed(content(size, 'clean'))
  if (suffix === '_mal') return framed(content(size, 'mal'))
  if (suffix === '_magic') return framed(content(size, 'magic'))
  const m = /^_flip_f([0-5])$/.exec(suffix)
  if (!m) throw new Error(`parcel: unknown frame ${suffix}`)
  const [look, k] = FLIP[Number(m[1])] as [Look, number]
  const c = content(size, look)
  return framed(k === 1 ? c : squash(c, evenWidth(c.w, k)))
}

registerDrawer({ class: 'parcel' }, (d: DrawCtx) => {
  const m = /^parcel_(s|m|l|xl)$/.exec(d.entry.id)
  if (!m) throw new Error(`parcel: unexpected id ${d.entry.id}`)
  const size = m[1] as string
  return gridFrames(
    d,
    d.entry.frames.map((s) => parcelFrame(size, s)),
  )
})
