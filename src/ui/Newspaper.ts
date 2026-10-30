// The newspaper card (city-view.md §8.2, plan.md §9 "Newspaper" — the
// Transport Tycoon nod): a `ui_panel` 300×180 (at most W − 12 wide) that
// slides up over 300 ms (Back.easeOut) to sit 8 px above the bottom bar,
// with the `sheetOpen` SFX. Masthead `THE NODE HEIGHTS GAZETTE` (from
// puns.json companyName) with `Day N` / `Lv N` in its corners, a double rule,
// a 48×48 picture at the left (level → the level's `wh_ext_tN`, incident →
// `parcel_m_mal`, region → the region's hero building, walkout →
// `worker_s_idle_0`, M6 hired → the role's worker idle frame, M7 quest →
// the item's picture or `ic_quest`, M7 star → `ic_star`), the headline
// wrapped at 236 px (at most 4 lines, the
// last one ellipsized) and an `OK` button bottom-right. It never pauses the
// sim; it dismisses on OK, on a tap anywhere on it, or after 6 s on screen.
// One paper at a time; later ones wait in a queue of 3 (the oldest waiting
// one drops). While the HUD suppresses it (a modal card, a sheet, the
// Paused card) it hides and its 6-s clock stops, then comes back.
//
// Pictures larger than the 48×48 box (the 256-px warehouse, 128-192-px
// buildings) are never scaled on the GPU (AGENTS.md: no setScale on world
// art): a 46-px "photo" is made once per frame on a canvas — box-filtered
// from the atlas pixels, snapped to the palette (style-guide §1.1) and given
// a 1-px outline — and registered as a small texture `news:<frame>`.
// Smaller frames are drawn from the atlas as they are, and an atlas frame
// `news_<frame>` (48×48, from an art pass) replaces the photo with no code
// change. Under the picture and the headline, left of OK, two columns of
// "greeked" body text (grey em-dash words seeded by the headline) give the
// page its newspaper look. The pure
// helpers (masthead, picture choice, fit, wrap, greek, downsample, quantize,
// queue) are unit-tested under Node (tests/ui/newspaper.test.ts).
import type Phaser from 'phaser'
import type { BuildingDef, GameData } from '../data/types.ts'
import type { Role } from '../sim/types.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { buildingSprite, frameOrNull } from '../render/frames.ts'
import { Button, TAP_PX } from './Button.ts'
import type { Layout } from './layout.ts'
import { addPanel } from './Panel.ts'
import { addText, ellipsize, textTop } from './text.ts'
import { PALETTE, THEME } from './theme.ts'

export const PAPER_W = 300
export const PAPER_H = 180
/** Air between the paper and the bottom bar. */
export const PAPER_GAP = 8
export const PAPER_IN_MS = 300
export const PAPER_OUT_MS = 180
/** Auto-dismiss after this long on screen (Q39). */
export const PAPER_SHOW_MS = 6000
export const PAPER_QUEUE_MAX = 3
export const MASTHEAD_H = 24
export const PICTURE_PX = 48
export const HEADLINE_W = 236
export const HEADLINE_MAX_LINES = 4
export const PAPER_SFX = 'sheetOpen'
export const PAPER_DEPTH = 34

const PAD = 6
const BODY_Y = MASTHEAD_H + 8
/** Greeked body columns: em-dash "words", an 8-px pitch, a 10-px gutter. */
const GREEK_DASH = '—'
const GREEK_PITCH = 8
const GREEK_GUTTER = 10
const OK_W = 64
const OK_H = 44
/** Opaque cut-off for the box-filtered picture (pixel art has no soft edges). */
const ALPHA_CUT = 128

/**
 * M6 `hired`: a ★ applicant joined (spec-build2 §2.5, stars only). M7
 * (design-m7 §6.7): `quest` a quest completed, `star` a quest reward put a
 * ★ applicant in the pool (headlines: questText.newsHeadline).
 */
export type NewsKind =
  | 'level'
  | 'incident'
  | 'region'
  | 'walkout'
  | 'hired'
  | 'quest'
  | 'star'

export interface NewsItem {
  kind: NewsKind
  headline: string
  /** `Day N` (completed days + 1). */
  day: number
  level: number
  /** Atlas frame of the picture (newsPicture). */
  picture: string | null
}

// ---- pure helpers ------------------------------------------------------------

/** `Node Heights Courier` → `THE NODE HEIGHTS GAZETTE` (the trade word goes). */
export function mastheadTitle(companyName: string): string {
  const words = companyName.trim().split(/\s+/).filter(Boolean)
  const town = words.length > 1 ? words.slice(0, -1) : words
  return `THE ${town.join(' ')} GAZETTE`.toUpperCase()
}

/**
 * A district's hero building: the largest footprint (ties → the first in
 * buildings.json), i.e. the landmark the region is drawn around.
 */
export function heroBuilding(
  data: Pick<GameData, 'buildings'>,
  district: string,
): BuildingDef | null {
  let best: BuildingDef | null = null
  let bestArea = -1
  for (const b of data.buildings) {
    if (b.district !== district) continue
    const area = b.footprint[0] * b.footprint[1]
    if (area > bestArea) {
      best = b
      bestArea = area
    }
  }
  return best
}

/** `an inspector`, `a sorter`, `a driver`. */
const ROLE_NOUN: Readonly<Record<Role, string>> = {
  inspector: 'an inspector',
  sorter: 'a sorter',
  driver: 'a driver',
}

/**
 * M6 (spec-build2 §2.5 "a one-line hired item for star applicants only"):
 * `Star hire: Wren joins as a sorter`. m5x7 has a ★ glyph since M7 (the
 * quest papers and cards use it); this headline keeps the word on purpose.
 */
export function starHireHeadline(name: string, role: Role): string {
  return `Star hire: ${name} joins as ${ROLE_NOUN[role] ?? 'staff'}`
}

/**
 * The picture frame for a paper (city-view §8.2): the warehouse tier the
 * level brings (levels.json warehouseTier → `wh_ext_tN`), the malware parcel,
 * the region's hero building, the worker's idle frame (M6 `hired`: the
 * sorter's own variant for a sorter), M7 `quest`: `ref.picture` when the
 * atlas has it, else `ic_quest`; M7 `star`: `ic_star` (16-px frames are
 * drawn unscaled in the box). Null when the atlas has no such frame (the box
 * then stays empty).
 */
export function newsPicture(
  kind: NewsKind,
  data: Pick<GameData, 'levels' | 'buildings'>,
  ref: {
    level?: number
    district?: string
    role?: Role
    picture?: string
  } = {},
): string | null {
  switch (kind) {
    case 'level': {
      // The nearest lower tier the atlas has (design-m8-m9 §6.1: missing
      // tier art never leaves the box empty).
      const row = data.levels.find((l) => l.level === ref.level)
      const tier = row?.warehouseTier ?? ref.level ?? 1
      for (let t = Math.floor(tier); t >= 1; t--) {
        const f = frameOrNull(`wh_ext_t${t}`)
        if (f) return f
      }
      return null
    }
    case 'incident':
      return frameOrNull('parcel_m_mal')
    case 'region': {
      const b = ref.district ? heroBuilding(data, ref.district) : null
      return b ? frameOrNull(buildingSprite(b.id)) : null
    }
    case 'walkout':
      return frameOrNull('worker_s_idle_0')
    case 'hired':
      return (
        (ref.role === 'sorter'
          ? frameOrNull('worker_sorter_s_idle_0')
          : null) ?? frameOrNull('worker_s_idle_0')
      )
    case 'quest':
      return (
        (ref.picture ? frameOrNull(ref.picture) : null) ??
        frameOrNull('ic_quest')
      )
    case 'star':
      return frameOrNull('ic_star')
  }
}

/** Fit (w, h) inside a `box`-px square keeping the aspect (never upscales). */
export function fitBox(
  w: number,
  h: number,
  box: number,
): { w: number; h: number } {
  if (w <= box && h <= box) return { w, h }
  const s = Math.min(box / w, box / h)
  return {
    w: Math.max(1, Math.round(w * s)),
    h: Math.max(1, Math.round(h * s)),
  }
}

/**
 * Word-wrap `text` at `maxW` px into at most `maxLines` lines; words longer
 * than a line stay whole, and text past the last line ends that line with
 * `…`. `measure` is the BitmapText width of a string.
 */
export function wrapHeadline(
  text: string,
  maxW: number,
  maxLines: number,
  measure: (s: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let i = 0
  for (; i < words.length; i++) {
    const w = words[i] as string
    const next = line ? `${line} ${w}` : w
    if (!line || measure(next) <= maxW) {
      line = next
      continue
    }
    lines.push(line)
    line = w
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines) {
    if (line) lines.push(line)
    return lines
  }
  // Out of lines with words left: the last line runs on and is cut with `…`.
  const rest = [line, ...words.slice(i + 1)].join(' ')
  lines[maxLines - 1] = ellipsize(
    `${lines[maxLines - 1] as string} ${rest}`,
    maxW,
    measure,
  )
  return lines
}

/**
 * Greeked body text: `rows` lines of em-dash "words" (1–4 dashes) filling
 * `maxW` px with a ragged right edge, a short last line every 4–5 rows (a
 * paragraph end). Deterministic for a `seed` string (the headline).
 */
export function greekLines(
  seed: string,
  rows: number,
  maxW: number,
  measure: (s: string) => number,
): string[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  // LCG; the high bits (the low ones of a power-of-two LCG cycle fast).
  const rnd = (n: number): number => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    return (h >>> 16) % n
  }
  const out: string[] = []
  let paraLeft = 4 + rnd(2)
  for (let r = 0; r < rows; r++) {
    paraLeft--
    const limit =
      paraLeft === 0 ? Math.round(maxW * (0.4 + rnd(30) / 100)) : maxW
    let line = ''
    for (;;) {
      const word = GREEK_DASH.repeat(1 + rnd(4))
      const next = line ? `${line} ${word}` : word
      if (measure(next) > limit) break
      line = next
    }
    out.push(line)
    if (paraLeft === 0) paraLeft = 4 + rnd(2)
  }
  return out
}

/**
 * Box-filter RGBA pixels from sw×sh down to dw×dh (alpha-weighted colour,
 * mean alpha), then cut alpha at 50 % so edges stay hard like pixel art.
 */
export function downsampleBox(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const k = (sy * sw + sx) * 4
          const al = src[k + 3] ?? 0
          r += (src[k] ?? 0) * al
          g += (src[k + 1] ?? 0) * al
          b += (src[k + 2] ?? 0) * al
          a += al
          n++
        }
      }
      const o = (y * dw + x) * 4
      if (n === 0 || a / n < ALPHA_CUT) continue
      out[o] = Math.round(r / a)
      out[o + 1] = Math.round(g / a)
      out[o + 2] = Math.round(b / a)
      out[o + 3] = 255
    }
  }
  return out
}

/** Snap every opaque pixel to the nearest palette colour (RGB distance), in place. */
export function quantizeToPalette(
  px: Uint8ClampedArray,
  palette: readonly number[],
): void {
  for (let k = 0; k < px.length; k += 4) {
    if ((px[k + 3] ?? 0) === 0) continue
    const r = px[k] ?? 0
    const g = px[k + 1] ?? 0
    const b = px[k + 2] ?? 0
    let best = palette[0] ?? 0
    let bestD = Infinity
    for (const c of palette) {
      const dr = ((c >> 16) & 255) - r
      const dg = ((c >> 8) & 255) - g
      const db = (c & 255) - b
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    px[k] = (best >> 16) & 255
    px[k + 1] = (best >> 8) & 255
    px[k + 2] = best & 255
  }
}

/**
 * Copy w×h RGBA pixels into a (w+2)×(h+2) buffer and draw a 1-px `colour`
 * outline on every transparent pixel 4-adjacent to an opaque one (the
 * style-guide sprite outline, lost by the box filter).
 */
export function outlinePixels(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  colour: number,
): Uint8ClampedArray {
  const W = w + 2
  const H = h + 2
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = ((y + 1) * W + x + 1) * 4
      for (let c = 0; c < 4; c++) out[d + c] = px[s + c] ?? 0
    }
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && (out[(y * W + x) * 4 + 3] ?? 0) > 0
  const edge: number[] = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (opaque(x, y)) continue
      if (
        opaque(x - 1, y) ||
        opaque(x + 1, y) ||
        opaque(x, y - 1) ||
        opaque(x, y + 1)
      )
        edge.push(y * W + x)
    }
  for (const i of edge) {
    out[i * 4] = (colour >> 16) & 255
    out[i * 4 + 1] = (colour >> 8) & 255
    out[i * 4 + 2] = colour & 255
    out[i * 4 + 3] = 255
  }
  return out
}

/** One paper on screen, at most `max` waiting (oldest waiting drops; same headline never twice). */
export class NewspaperQueue {
  current: NewsItem | null = null
  readonly waiting: NewsItem[] = []
  readonly max: number

  constructor(max = PAPER_QUEUE_MAX) {
    this.max = max
  }

  push(item: NewsItem): 'show' | 'queued' | 'duplicate' {
    if (!item.headline) return 'duplicate'
    if (this.current?.headline === item.headline) return 'duplicate'
    if (this.waiting.some((w) => w.headline === item.headline))
      return 'duplicate'
    if (!this.current) {
      this.current = item
      return 'show'
    }
    this.waiting.push(item)
    while (this.waiting.length > this.max) this.waiting.shift()
    return 'queued'
  }

  next(): NewsItem | null {
    this.current = this.waiting.shift() ?? null
    return this.current
  }

  clear(): void {
    this.current = null
    this.waiting.length = 0
  }
}

/** Paper width for a canvas W px wide (300, never closer than 6 px to an edge). */
export function paperWidth(W: number): number {
  return Math.min(PAPER_W, Math.max(200, W - 2 * PAD))
}

/** Resting top of the paper: 8 px above the bottom bar (city-view §8.2). */
export function paperY(L: Pick<Layout, 'bottomBar'>): number {
  return L.bottomBar.y - PAPER_GAP - PAPER_H
}

// ---- the card ----------------------------------------------------------------

const PALETTE_VALUES: readonly number[] = Object.values(PALETTE)

export interface NewspaperOptions {
  companyName: string
  depth?: number
  /** A paper came on screen (HUD: SFX, overlap bookkeeping). */
  onShown?: (item: NewsItem) => void
}

export class Newspaper {
  readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  readonly queue = new NewspaperQueue()
  private L: Layout
  private w: number
  private panel: Phaser.GameObjects.NineSlice
  private title: Phaser.GameObjects.BitmapText
  private dayText: Phaser.GameObjects.BitmapText
  private lvText: Phaser.GameObjects.BitmapText
  private rules: Phaser.GameObjects.Rectangle[]
  private photoBg: Phaser.GameObjects.Rectangle
  private photo: Phaser.GameObjects.Image | null = null
  private headline: Phaser.GameObjects.BitmapText
  private greek: Phaser.GameObjects.BitmapText[]
  private ok: Button
  private opts: NewspaperOptions
  private shownMs = 0
  private tween: Phaser.Tweens.Tween | null = null
  private leaving = false
  private suppressed = false
  private down = false
  private destroyed = false

  constructor(scene: Phaser.Scene, L: Layout, opts: NewspaperOptions) {
    this.scene = scene
    this.L = L
    this.opts = opts
    this.w = paperWidth(L.W)
    this.panel = addPanel(scene, 0, 0, this.w, PAPER_H, 'ui_panel')
    this.panel.setInteractive()
    this.panel.on('pointerdown', () => {
      this.down = true
    })
    this.panel.on('pointerout', () => {
      this.down = false
    })
    this.panel.on('pointerup', (p: Phaser.Input.Pointer) => {
      const was = this.down
      this.down = false
      if (!was || p.getDistance() > TAP_PX) return
      scene.game.events.emit('ui:tap', { id: 'newspaper' })
      this.dismiss()
    })
    this.title = addText(scene, 0, 0, mastheadTitle(opts.companyName))
    this.dayText = addText(scene, PAD, 0, '', { tint: PALETTE.grey1 })
    this.lvText = addText(scene, 0, 0, '', { tint: PALETTE.grey1 })
    this.rules = [0, 2].map((dy) =>
      scene.add
        .rectangle(PAD, MASTHEAD_H + dy, this.w - 2 * PAD, 1, THEME.outline)
        .setOrigin(0, 0),
    )
    this.photoBg = scene.add
      .rectangle(PAD, BODY_Y, PICTURE_PX, PICTURE_PX, PALETTE.grey4)
      .setOrigin(0, 0)
    this.headline = addText(scene, PAD + PICTURE_PX + 4, BODY_Y, '')
    this.greek = [0, 1].map(() =>
      addText(scene, 0, 0, '', { tint: PALETTE.grey3 }).setLineSpacing(
        GREEK_PITCH - 14,
      ),
    )
    this.ok = new Button(scene, {
      x: this.w - PAD - OK_W,
      y: PAPER_H - PAD - OK_H,
      w: OK_W,
      h: OK_H,
      label: 'OK',
      face: 'primary',
      id: 'newspaper:ok',
      onClick: () => this.dismiss(),
    })
    this.root = scene.add
      .container(0, 0, [
        this.panel,
        this.title,
        this.dayText,
        this.lvText,
        ...this.rules,
        this.photoBg,
        ...this.greek,
        this.headline,
        this.ok,
      ])
      .setDepth(opts.depth ?? PAPER_DEPTH)
      .setVisible(false)
    this.layoutStatic()
    scene.events.once('shutdown', this.destroy, this)
  }

  /** Queue a paper; it shows now when none is up. */
  push(item: NewsItem): void {
    if (this.destroyed) return
    if (this.queue.push(item) === 'show') this.present()
  }

  /** The paper on screen (or waiting to come back while suppressed). */
  current(): NewsItem | null {
    return this.queue.current
  }

  /** Visible right now (not suppressed, not sliding out). */
  isVisible(): boolean {
    return this.root.visible && !this.leaving
  }

  /** The panel's screen rect while visible, else null. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    if (!this.root.visible) return null
    return { x: this.root.x, y: paperY(this.L), w: this.w, h: PAPER_H }
  }

  /**
   * Per frame: hide while suppressed (the 6-s clock stops); otherwise count
   * the time on screen and slide out at PAPER_SHOW_MS.
   */
  update(delta: number, suppressed: boolean): void {
    if (this.destroyed) return
    if (suppressed !== this.suppressed) {
      this.suppressed = suppressed
      if (suppressed) {
        this.tween?.stop()
        this.tween = null
        if (this.leaving) this.finishLeave()
        this.root.setVisible(false)
      } else if (this.queue.current) this.present()
    }
    if (this.suppressed || !this.queue.current || this.leaving) return
    this.shownMs += Math.max(0, Math.min(delta, 100))
    if (this.shownMs >= PAPER_SHOW_MS) this.dismiss()
  }

  /** OK / tap / timeout: slide out, then the next queued paper. */
  dismiss(): void {
    if (!this.queue.current || this.leaving) return
    this.leaving = true
    this.tween?.stop()
    if (!this.root.visible) {
      this.finishLeave()
      return
    }
    const proxy = { y: this.root.y }
    this.tween = this.scene.tweens.add({
      targets: proxy,
      y: this.L.H,
      duration: PAPER_OUT_MS,
      ease: 'Cubic.easeIn',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => this.finishLeave(),
    })
  }

  /** Drop the paper on screen and the queue (New game). */
  clear(): void {
    this.queue.clear()
    this.tween?.stop()
    this.tween = null
    this.leaving = false
    this.root.setVisible(false)
  }

  relayout(L: Layout): void {
    this.L = L
    const w = paperWidth(L.W)
    if (w !== this.w) {
      this.w = w
      this.panel.setSize(w, PAPER_H)
      for (const r of this.rules) r.setSize(w - 2 * PAD, 1)
      this.ok.setRect({
        x: w - PAD - OK_W,
        y: PAPER_H - PAD - OK_H,
        w: OK_W,
        h: OK_H,
      })
      this.layoutStatic()
      if (this.queue.current) this.fill(this.queue.current)
    }
    if (this.root.visible && !this.leaving) {
      this.tween?.stop()
      this.tween = null
      this.root.setPosition(this.restX(), paperY(L))
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scene.events.off('shutdown', this.destroy, this)
    this.tween?.stop()
    this.root.destroy()
  }

  // ---- internals -------------------------------------------------------------

  private restX(): number {
    return Math.round((this.L.W - this.w) / 2)
  }

  private layoutStatic(): void {
    this.title.setPosition(
      Math.round((this.w - this.title.width) / 2),
      textTop(0, MASTHEAD_H),
    )
  }

  private finishLeave(): void {
    this.tween = null
    this.leaving = false
    this.root.setVisible(false)
    if (this.queue.next()) this.present()
  }

  private present(): void {
    const item = this.queue.current
    if (!item || this.suppressed) return
    this.fill(item)
    this.shownMs = 0
    this.tween?.stop()
    const x = this.restX()
    const to = paperY(this.L)
    const proxy = { y: this.L.H }
    this.root.setPosition(x, proxy.y).setVisible(true)
    this.tween = this.scene.tweens.add({
      targets: proxy,
      y: to,
      duration: PAPER_IN_MS,
      ease: 'Back.easeOut',
      onUpdate: () => this.root.setY(Math.round(proxy.y)),
      onComplete: () => {
        this.tween = null
        this.root.setY(to)
      },
    })
    this.opts.onShown?.(item)
  }

  private fill(item: NewsItem): void {
    const s = this.scene
    this.dayText.setText(`Day ${item.day}`).setY(textTop(0, MASTHEAD_H))
    this.lvText.setText(`Lv ${item.level}`)
    this.lvText.setPosition(
      Math.round(this.w - PAD - this.lvText.width),
      textTop(0, MASTHEAD_H),
    )
    const hx = PAD + PICTURE_PX + 4
    const maxW = Math.min(HEADLINE_W, this.w - hx - PAD)
    const lines = wrapHeadline(item.headline, maxW, HEADLINE_MAX_LINES, (t) =>
      this.measure(t),
    )
    this.headline.setText(lines.join('\n'))
    this.headline.setPosition(hx, BODY_Y - 2)
    this.fillGreek(item.headline, BODY_Y - 2 + lines.length * 14)
    this.photo?.destroy()
    this.photo = null
    const pic = item.picture ? this.pictureTexture(item.picture) : null
    if (pic) {
      const img = s.add.image(0, 0, pic.key, pic.frame).setOrigin(0, 0)
      img.setPosition(
        PAD + Math.floor((PICTURE_PX - img.width) / 2),
        BODY_Y + Math.floor((PICTURE_PX - img.height) / 2),
      )
      this.root.addAt(img, this.root.getIndex(this.photoBg) + 1)
      this.photo = img
    }
  }

  /**
   * Two greeked columns from below the picture / headline to the panel's
   * bottom pad, left of the OK button.
   */
  private fillGreek(seed: string, headlineBottom: number): void {
    const top = Math.max(BODY_Y + PICTURE_PX + 8, headlineBottom + 6)
    const bottom = PAPER_H - PAD - 2
    const rows = Math.max(0, Math.floor((bottom - top) / GREEK_PITCH))
    const right = this.w - PAD - OK_W - GREEK_GUTTER
    const colW = Math.floor((right - PAD - GREEK_GUTTER) / 2)
    this.greek.forEach((t, i) => {
      const lines = greekLines(`${seed}#${i}`, rows, colW, (x) =>
        this.measure(x),
      )
      // The dash sits on row 7 of the 14-px cell: lift the block by that.
      t.setText(lines.join('\n')).setPosition(
        PAD + i * (colW + GREEK_GUTTER),
        top - 7,
      )
    })
  }

  private measure(t: string): number {
    const was = this.headline.text
    const w = Math.round(this.headline.setText(t).width)
    this.headline.setText(was)
    return w
  }

  /**
   * The picture as (texture, frame): the atlas frame when it fits the box,
   * else a palette-snapped canvas "photo" `news:<frame>` made once.
   */
  private pictureTexture(
    frame: string,
  ): { key: string; frame?: string } | null {
    const tm = this.scene.textures
    const atlas = tm.get(UI_ATLAS)
    // An art pass may ship a dedicated 48×48 `news_<frame>`: it wins.
    if (atlas.has(`news_${frame}`))
      return { key: UI_ATLAS, frame: `news_${frame}` }
    if (!atlas.has(frame)) return null
    const f = atlas.get(frame)
    if (f.cutWidth <= PICTURE_PX && f.cutHeight <= PICTURE_PX)
      return { key: UI_ATLAS, frame }
    const key = `news:${frame}`
    if (tm.exists(key)) return { key }
    try {
      const src = f.source.image as CanvasImageSource
      const sw = f.cutWidth
      const sh = f.cutHeight
      const full = document.createElement('canvas')
      full.width = sw
      full.height = sh
      const fctx = full.getContext('2d', { willReadFrequently: true })
      if (!fctx) return null
      fctx.imageSmoothingEnabled = false
      fctx.drawImage(src, f.cutX, f.cutY, sw, sh, 0, 0, sw, sh)
      const fit = fitBox(sw, sh, PICTURE_PX - 2)
      const small = downsampleBox(
        fctx.getImageData(0, 0, sw, sh).data,
        sw,
        sh,
        fit.w,
        fit.h,
      )
      quantizeToPalette(small, PALETTE_VALUES)
      const px = outlinePixels(small, fit.w, fit.h, PALETTE.outline)
      const out = document.createElement('canvas')
      out.width = fit.w + 2
      out.height = fit.h + 2
      const octx = out.getContext('2d')
      if (!octx) return null
      const img = octx.createImageData(out.width, out.height)
      img.data.set(px)
      octx.putImageData(img, 0, 0)
      tm.addCanvas(key, out)
      return tm.exists(key) ? { key } : null
    } catch {
      return null
    }
  }
}
