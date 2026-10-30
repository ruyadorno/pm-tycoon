// Gallery (plan.md §12.3 task 14; dev-only: ?view=gallery&page=N with the dev
// server or ?debug=1). The look is judged here before any mechanic exists:
//   1  palette ramps + the reserved colours (art/palette.json via theme.ts)
//   2  every frame of both atlases (`world`, then the interior-only frames
//      of `interior`) at 1x and 2x over grass, labelled
//   3  the full 48x48 map: baked ground (roads, trimmed avenues, themed edges,
//      kerbs, `_locked` ground), every buildings.json row with its placeholder
//      sprite (spriteMap.generated.json; `_locked` in locked regions), the
//      warehouse exterior, props, sign_locked + "Unlocks at Lv N",
//      depth = tx + ty; pan / pinch / wheel / double-tap via CameraRig
//   4  a HUD mock from layout.ts rects and the UI nine-slices over the map
// Three cameras: `main` draws the fixed background, `worldCam` the scrolling
// content (CameraRig), `uiCam` the tab bar / labels at zoom 1.
import Phaser from 'phaser'
import { getData, REG } from '../boot/simBinding.ts'
import type { GameData } from '../data/index.ts'
import { mountOverlay } from '../debug/overlay.ts'
import { debugEnabled, GALLERY_PAGES, params } from '../debug/params.ts'
import { GestureClassifier } from '../input/GestureClassifier.ts'
import { ATLAS_KEYS, FONT_KEY, WORLD_ATLAS } from '../render/atlases.ts'
import { CameraRig } from '../render/CameraRig.ts'
import { buildingSprite, SIGN_LOCKED_FACE } from '../render/frames.ts'
import { bakeGround, GROUND_Y } from '../render/ground.ts'
import {
  footprintAnchor,
  footprintDepth,
  HH,
  originX,
  tileToScreen,
  worldSize,
} from '../render/iso.ts'
import { computeLayout, contains, growTo, type Rect } from '../ui/layout.ts'
import { FONT_SIZE, PALETTE, THEME, type PaletteId } from '../ui/theme.ts'

const PAGE_NAMES = ['Palette', 'Frames', 'Map', 'HUD']
const TAB_H = 24
const PAD = 8
/** Headroom above / below the map for tall sprites (city-view.md §1.2). */
const MAP_TOP_PAD = 64
const MAP_BOTTOM_PAD = 128
/** Flat-fill tint for a locked sprite whose `_locked` frame is missing (city-view.md §1.4). */
const LOCKED_FILL = 0xdfe6ea
/** m5x7 metrics (src/assets/m5x7.xml): line pitch, cap top and height. */
const SIGN_LINE_H = 14
const SIGN_CAP_TOP = 4
const SIGN_CAP_H = 7

type Layer = Phaser.GameObjects.Layer

/** Frame review order: ground, vehicles, buildings, props, overlays, small things. */
const GROUPS: readonly RegExp[] = [
  /^(grass|pasture|field_rows|dirt|sand|shore_|water|pavement|plaza|lot_|road_|edge_|tarmac|runway|tree_line|kerb_)/,
  /^(bike|van|truck)_/,
  /^(dt|hr|in)_/,
  /^(lr|ru|dk|ap|cv)_/,
  /^(wh_ext|sign_|tree_|bush|lamp_post|bench|fence)/,
  /^mood_/,
  /^(parcel_|ring_|rush_ring_|fx_)/,
  /^(ic_|arrow|wh_dock_light)/,
  /^(ui_|badge_)/,
]

function groupOf(name: string): number {
  if (name === 'm5x7') return GROUPS.length + 1
  const i = GROUPS.findIndex((re) => re.test(name))
  return i < 0 ? GROUPS.length : i
}

function luminance(rgb: number): number {
  const r = (rgb >> 16) & 255
  const g = (rgb >> 8) & 255
  const b = rgb & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export interface MapBuildStats {
  buildings: number
  props: number
  signs: number
  missing: string[]
}

export class GalleryScene extends Phaser.Scene {
  private page = 1
  private bgLayer!: Layer
  private worldLayer!: Layer
  private uiLayer!: Layer
  private worldCam!: Phaser.Cameras.Scene2D.Camera
  private uiCam!: Phaser.Cameras.Scene2D.Camera
  private rig!: CameraRig
  private gestures!: GestureClassifier
  private tabs: Rect[] = []
  private hasFont = false
  /** Page 3/4 build stats (read by e2e through __pm.game.scene). */
  mapStats: MapBuildStats | null = null
  /** Number of frames shown on page 2. */
  frameCount = 0

  constructor() {
    super('Gallery')
  }

  init(data: { page?: number }): void {
    const p = data?.page ?? params().page
    this.page = Math.min(GALLERY_PAGES, Math.max(1, Math.trunc(p)))
    this.tabs = []
    this.mapStats = null
    this.frameCount = 0
  }

  create(): void {
    const { width: W, height: H } = this.scale
    this.hasFont = this.cache.bitmapFont.has(FONT_KEY)
    this.bgLayer = this.add.layer().setDepth(0)
    this.worldLayer = this.add.layer().setDepth(1)
    this.uiLayer = this.add.layer().setDepth(2)
    const bgCam = this.cameras.main
    this.worldCam = this.cameras.add(0, 0, W, H, false, 'world')
    this.uiCam = this.cameras.add(0, 0, W, H, false, 'ui')
    bgCam.ignore([this.worldLayer, this.uiLayer])
    this.worldCam.ignore([this.bgLayer, this.uiLayer])
    this.uiCam.ignore([this.bgLayer, this.worldLayer])

    const data = getData(this)
    const safeTop = (this.registry.get(REG.safeTop) as number | undefined) ?? 0
    let bounds: Rect
    let centre: { x: number; y: number } | null = null
    switch (this.page) {
      case 1:
        bounds = this.buildPalette(W, safeTop + TAB_H + PAD)
        break
      case 2:
        this.bakeGrassBackground(W, H)
        bounds = this.buildFrames(W, safeTop + TAB_H + PAD)
        break
      default: {
        const r = this.buildMap(data, 1)
        bounds = r.bounds
        centre = r.centre
        if (this.page === 4) this.buildHudMock(data)
      }
    }
    this.rig = new CameraRig(
      this.worldCam,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
    )
    if (centre) this.rig.centerOn(centre.x, centre.y)
    else this.worldCam.setScroll(bounds.x, bounds.y)

    this.buildTabs(
      W,
      this.page === 4
        ? computeLayout(W, H, safeTop, 0, this.scale.zoom).world.y + 28
        : safeTop,
    )
    if (debugEnabled()) {
      const t = mountOverlay(this, 2, (this.tabs[0]?.y ?? 0) + TAB_H + 2)
      this.uiLayer.add(t)
    }
    this.installInput()

    const onResize = (): void => {
      this.scene.restart({ page: this.page })
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      if (this.textures.exists('gallery-grass'))
        this.textures.remove('gallery-grass')
    })
  }

  update(_time: number, delta: number): void {
    this.rig.update(delta)
    this.gestures.update()
  }

  /** Switch page (tabs, keys 1-4, __pm tests). */
  showPage(page: number): void {
    this.scene.restart({ page })
  }

  // ------------------------------------------------------------------ helpers

  private text(
    layer: Layer,
    x: number,
    y: number,
    s: string,
    tint: number = THEME.textLight,
    shadow = true,
  ): Phaser.GameObjects.BitmapText | null {
    if (!this.hasFont) return null
    const t = this.add
      .bitmapText(Math.round(x), Math.round(y), FONT_KEY, s, FONT_SIZE)
      .setTint(tint)
    if (shadow) t.setDropShadow(1, 1, THEME.shadow, 1)
    layer.add(t)
    return t
  }

  /** The atlas holding `frame` (`world` first), or null. */
  private keyOf(frame: string): string | null {
    for (const k of ATLAS_KEYS) {
      if (this.textures.exists(k) && this.textures.get(k).has(frame)) return k
    }
    return null
  }

  private has(frame: string): boolean {
    return this.keyOf(frame) !== null
  }

  private nine(
    layer: Layer,
    frame: string,
    r: Rect,
    alpha = 1,
  ): Phaser.GameObjects.NineSlice | null {
    if (!this.has(frame)) return null
    const n = this.add
      .nineslice(
        r.x,
        r.y,
        this.keyOf(frame) ?? WORLD_ATLAS,
        frame,
        r.w,
        r.h,
        4,
        4,
        4,
        4,
      )
      .setOrigin(0, 0)
      .setAlpha(alpha)
    layer.add(n)
    return n
  }

  private icon(layer: Layer, frame: string, x: number, y: number): void {
    if (!this.has(frame)) return
    layer.add(
      this.add
        .image(
          Math.round(x),
          Math.round(y),
          this.keyOf(frame) ?? WORLD_ATLAS,
          frame,
        )
        .setOrigin(0, 0),
    )
  }

  // ------------------------------------------------------------------ input

  private buildTabs(W: number, y: number): void {
    const tabW = Math.floor((W - 2 * PAD) / GALLERY_PAGES)
    const strip = this.add
      .rectangle(0, y, W, TAB_H, THEME.panelDark, 0.85)
      .setOrigin(0, 0)
    this.uiLayer.add(strip)
    for (let i = 0; i < GALLERY_PAGES; i++) {
      const r: Rect = { x: PAD + i * tabW, y: y + 2, w: tabW - 4, h: TAB_H - 4 }
      this.tabs.push(r)
      const active = i + 1 === this.page
      this.nine(this.uiLayer, active ? 'ui_chip_active' : 'ui_chip', r)
      const t = this.text(
        this.uiLayer,
        0,
        0,
        `${i + 1} ${PAGE_NAMES[i]}`,
        THEME.textDark,
        false,
      )
      if (t)
        t.setPosition(
          Math.round(r.x + r.w / 2 - t.width / 2),
          Math.round(r.y + r.h / 2 - t.height / 2),
        )
    }
  }

  private installInput(): void {
    const minHit = Math.ceil(44 / this.scale.zoom)
    this.gestures = new GestureClassifier(this, {
      tap: (x, y) => {
        const i = this.tabs.findIndex((r) =>
          contains(growTo(r, Math.min(minHit, TAB_H + 8)), x, y),
        )
        if (i >= 0 && i + 1 !== this.page) this.showPage(i + 1)
      },
      doubleTap: (x, y) => {
        this.rig.toggleZoomAt(x, y)
      },
      panBy: (dx, dy) => this.rig.panBy(dx, dy),
      panEnd: (vx, vy) => this.rig.fling(vx, vy),
      pinch: (dir, cx, cy) => this.rig.zoomAt(dir === 'in' ? 2 : 1, cx, cy),
      wheel: (dir, x, y) => this.rig.zoomAt(dir > 0 ? 2 : 1, x, y),
    })
    const kb = this.input.keyboard
    if (!kb) return
    const onKey = (e: KeyboardEvent): void => {
      const n = Number(e.key)
      if (n >= 1 && n <= GALLERY_PAGES && n !== this.page) this.showPage(n)
      const step = 32
      if (e.key === 'ArrowLeft') this.rig.panBy(step, 0)
      if (e.key === 'ArrowRight') this.rig.panBy(-step, 0)
      if (e.key === 'ArrowUp') this.rig.panBy(0, step)
      if (e.key === 'ArrowDown') this.rig.panBy(0, -step)
    }
    kb.on('keydown', onKey)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      kb.off('keydown', onKey),
    )
  }

  // ------------------------------------------------------------------ page 1

  private buildPalette(W: number, top: number): Rect {
    const ramps = new Map<string, PaletteId[]>()
    for (const id of Object.keys(PALETTE) as PaletteId[]) {
      const ramp = id.replace(/\d+$/, '')
      const list = ramps.get(ramp) ?? []
      list.push(id)
      ramps.set(ramp, list)
    }
    const g = this.add.graphics()
    this.worldLayer.add(g)
    const sw = 44
    const sh = 22
    let y = top
    let maxX = W
    this.text(
      this.worldLayer,
      PAD,
      y,
      'Palette - 48 colours (art/palette.json)',
    )
    y += 20
    for (const [ramp, ids] of ramps) {
      const reserved = ramp === 'mal' || ramp === 'gold'
      this.text(
        this.worldLayer,
        PAD,
        y,
        reserved ? `${ramp}  (reserved)` : ramp,
        reserved ? PALETTE.gold2 : THEME.textLight,
      )
      y += 16
      ids.forEach((id, i) => {
        const x = PAD + i * (sw + 4)
        const c = PALETTE[id]
        g.fillStyle(PALETTE.outline, 1).fillRect(x - 1, y - 1, sw + 2, sh + 2)
        if (reserved)
          g.fillStyle(PALETTE.red1, 1).fillRect(x - 2, y - 2, sw + 4, 2)
        g.fillStyle(c, 1).fillRect(x, y, sw, sh)
        this.text(
          this.worldLayer,
          x + 2,
          y + 3,
          id,
          luminance(c) > 0.55 ? PALETTE.outline : PALETTE.grey5,
          false,
        )
        maxX = Math.max(maxX, x + sw + PAD)
      })
      y += sh + 8
    }
    return { x: 0, y: 0, w: maxX, h: Math.max(this.scale.height, y + PAD) }
  }

  // ------------------------------------------------------------------ page 2

  /** A screen-sized iso grass field behind the frames (fixed: bg camera). */
  private bakeGrassBackground(W: number, H: number): void {
    if (!this.has('grass')) return
    const key = 'gallery-grass'
    if (this.textures.exists(key)) this.textures.remove(key)
    const dt = this.textures.addDynamicTexture(key, W, H)
    if (!dt) return
    for (let r = 0; r * 16 - 16 < H + 16; r++)
      for (let c = 0; c * 64 - 64 < W + 64; c++)
        dt.stamp(
          WORLD_ATLAS,
          'grass',
          c * 64 + (r % 2) * 32 - 32,
          r * 16 - 16,
          {
            originX: 0,
            originY: 0,
          },
        )
    dt.render()
    this.bgLayer.add(this.add.image(0, 0, key).setOrigin(0, 0))
  }

  private buildFrames(W: number, top: number): Rect {
    // Every frame once: `world` first, then what only `interior` holds (the
    // shared icons/parcels/fx/machines/workers are drawn from `world`).
    // Single-character names are the m5x7 glyph frames ParseFromAtlas adds.
    const owner = new Map<string, string>()
    for (const k of ATLAS_KEYS) {
      if (!this.textures.exists(k)) continue
      for (const n of this.textures.get(k).getFrameNames()) {
        if (n !== '__BASE' && n.length > 1 && !owner.has(n)) owner.set(n, k)
      }
    }
    const names = [...owner.keys()].toSorted(
      (a, b) =>
        Number(owner.get(a) !== WORLD_ATLAS) -
          Number(owner.get(b) !== WORLD_ATLAS) ||
        groupOf(a) - groupOf(b) ||
        (a < b ? -1 : a > b ? 1 : 0),
    )
    this.frameCount = names.length
    const counts = ATLAS_KEYS.map(
      (k) => `${[...owner.values()].filter((v) => v === k).length} ${k}`,
    )
    this.text(
      this.worldLayer,
      PAD,
      top,
      `${names.length} frames (${counts.join(' + ')}) - 1x over 2x`,
    )
    // Cells: the 1x frame, the 2x frame under it, the label at the bottom;
    // flowed left to right (a frame wider than the screen gets its own row).
    const gap = 2
    let x = gap
    let y = top + 20
    let rowH = 0
    let maxX = W
    for (const name of names) {
      const key = owner.get(name) ?? WORLD_ATLAS
      const f = this.textures.getFrame(key, name)
      const fw = f.realWidth
      const fh = f.realHeight
      const label = this.text(this.worldLayer, 0, 0, name)
      const labelW = label ? label.width : 0
      const cellW = Math.max(fw * 2, labelW) + gap
      const cellH = fh * 3 + 4 + 14 + 6
      if (x + cellW > W && x > gap) {
        x = gap
        y += rowH
        rowH = 0
      }
      const one = this.add.image(x, y, key, name).setOrigin(0, 0)
      // 2x for review only: the game itself never scales art.
      const two = this.add
        .image(x, y + fh + 2, key, name)
        .setOrigin(0, 0)
        .setScale(2)
      this.worldLayer.add([one, two])
      label?.setPosition(x, y + fh * 3 + 4)
      x += cellW
      rowH = Math.max(rowH, cellH)
      maxX = Math.max(maxX, x)
    }
    return {
      x: 0,
      y: 0,
      w: maxX,
      h: Math.max(this.scale.height, y + rowH + PAD),
    }
  }

  // ------------------------------------------------------------------ page 3

  /** The 48x48 map at company level `level`; returns camera bounds + the warehouse centre. */
  private buildMap(
    data: GameData,
    level: number,
  ): { bounds: Rect; centre: { x: number; y: number } } {
    const map = data.map
    const [mapW, mapH] = map.size
    const ox = originX(mapH)
    const unlockLevel = new Map<string, number>()
    for (const d of data.districts) unlockLevel.set(d.id, d.unlockLevel)
    const isLocked = (region: string): boolean =>
      (unlockLevel.get(region) ?? 0) > level
    const missing = new Set<string>()
    const stats: MapBuildStats = {
      buildings: 0,
      props: 0,
      signs: 0,
      missing: [],
    }

    const ground = bakeGround(this, map, { isLocked })
    this.worldLayer.add(ground.image)
    for (const m of ground.missing) missing.add(m)

    const at = { x: 0, y: 0 }
    const place = (
      frame: string,
      locked: boolean,
      x: number,
      y: number,
      depth: number,
    ): Phaser.GameObjects.Image | null => {
      const lockedFrame = `${frame}_locked`
      let name = frame
      let fill = false
      if (locked) {
        if (this.has(lockedFrame)) name = lockedFrame
        else {
          missing.add(lockedFrame)
          fill = true
        }
      }
      if (!this.has(name)) {
        missing.add(name)
        return null
      }
      const img = this.add.image(
        Math.round(x),
        Math.round(y),
        this.keyOf(name) ?? WORLD_ATLAS,
        name,
      )
      img.setOrigin(0.5, 1).setDepth(depth)
      if (fill) img.setTint(LOCKED_FILL).setTintMode(Phaser.TintModes.FILL)
      this.worldLayer.add(img)
      return img
    }

    for (const b of data.buildings) {
      footprintAnchor(b.tile, b.footprint, ox, at)
      const img = place(
        buildingSprite(b.id),
        isLocked(b.district),
        at.x,
        at.y,
        footprintDepth(b.tile, b.footprint),
      )
      if (img) stats.buildings++
    }

    const wh = map.lot.warehouse
    footprintAnchor(wh.tile, wh.footprint, ox, at)
    place('wh_ext_t1', false, at.x, at.y, footprintDepth(wh.tile, wh.footprint))

    for (const pr of map.props) {
      tileToScreen(pr.tile[0], pr.tile[1], ox, at)
      const img = place(
        pr.frame,
        isLocked(pr.region),
        at.x,
        at.y + HH,
        pr.tile[0] + pr.tile[1] + 0.01,
      )
      if (img) stats.props++
    }

    tileToScreen(map.lot.sign[0], map.lot.sign[1], ox, at)
    place(
      'sign_days',
      false,
      at.x,
      at.y + HH,
      map.lot.sign[0] + map.lot.sign[1] + 0.01,
    )

    // Locked regions: sign_locked at the label tile with "Unlocks at Lv N"
    // (+ "Trucks only") centred on the board face (SIGN_LOCKED_FACE).
    for (const r of map.regions) {
      const d = data.districts.find((x) => x.id === r.id)
      if (!d || !isLocked(d.id)) continue
      tileToScreen(r.labelTile[0], r.labelTile[1], ox, at)
      const sign = place('sign_locked', false, at.x, at.y + HH, 9500)
      const lines = [`Unlocks at Lv ${d.unlockLevel}`]
      if (d.allowed.length === 1 && d.allowed[0] === 'truck')
        lines.push('Trucks only')
      const face = SIGN_LOCKED_FACE
      // canvas top-left of the board (origin (0.5, 1) at the tile vertex)
      const left = sign ? sign.x - sign.width / 2 : at.x - face.w / 2
      const top = sign ? sign.y - sign.height : at.y
      // centre the cap height of the line block on the face
      const capsH = SIGN_CAP_H + SIGN_LINE_H * (lines.length - 1)
      const y0 = top + face.y + Math.floor((face.h - capsH) / 2) - SIGN_CAP_TOP
      lines.forEach((s, i) => {
        const t = this.text(this.worldLayer, 0, 0, s, THEME.textDark, false)
        if (!t) return
        t.setPosition(
          Math.round(left + face.x + (face.w - t.width) / 2),
          Math.round(y0 + i * SIGN_LINE_H),
        )
        t.setDepth(9501)
      })
      stats.signs++
    }

    stats.missing = [...missing].toSorted()
    if (stats.missing.length)
      console.warn(`gallery: atlas lacks ${stats.missing.join(', ')}`)
    this.mapStats = stats

    const world = worldSize(mapW, mapH)
    const centre = tileToScreen(
      wh.tile[0] + wh.footprint[0] / 2 - 0.5,
      wh.tile[1] + wh.footprint[1] / 2 - 0.5,
      ox,
    )
    return {
      bounds: {
        x: 0,
        y: GROUND_Y - MAP_TOP_PAD + HH,
        w: world.w,
        h: world.h + MAP_TOP_PAD + MAP_BOTTOM_PAD,
      },
      centre,
    }
  }

  // ------------------------------------------------------------------ page 4

  private buildHudMock(data: GameData): void {
    const { width: W, height: H } = this.scale
    const st = (this.registry.get(REG.safeTop) as number | undefined) ?? 0
    const sb = (this.registry.get(REG.safeBottom) as number | undefined) ?? 0
    const L = computeLayout(W, H, st, sb, this.scale.zoom)
    const ui = this.uiLayer
    const dark = THEME.textDark

    // Top bar + ticker.
    this.nine(ui, 'ui_panel_dark', L.topBar, 0.85)
    this.icon(ui, 'ic_money', 6, L.money.rect.y + 4)
    this.text(ui, 24, L.money.rect.y + 4, '$1,234')
    for (let i = 0; i < 5; i++)
      this.icon(
        ui,
        i < 3 ? 'ic_life_on' : 'ic_life_off',
        L.lives.rect.x + i * 18,
        L.lives.rect.y + 4,
      )
    const mood = this.text(ui, 0, L.mood.rect.y + 4, '64')
    if (mood) mood.setX(L.mood.rect.x + L.mood.rect.w - 18 - mood.width)
    this.icon(
      ui,
      'ic_mood_neutral',
      L.mood.rect.x + L.mood.rect.w - 16,
      L.mood.rect.y + 4,
    )
    const lv = data.levels[0]
    this.text(ui, 6, L.level.rect.y + 4, `Lv1 ${lv?.title ?? ''}`.slice(0, 11))
    this.nine(ui, 'ui_bar_track', L.levelBar)
    this.nine(ui, 'ui_bar_fill_blue', {
      ...L.levelBar,
      w: Math.round(L.levelBar.w * 0.62),
    })
    const lvTxt = this.text(ui, 0, L.levelBar.y - 1, '$1,240 / $2,000')
    if (lvTxt)
      lvTxt.setX(Math.round(L.levelBar.x + L.levelBar.w / 2 - lvTxt.width / 2))
    this.icon(ui, 'ic_shield', L.shield.rect.x, L.shield.rect.y + 4)
    this.text(
      ui,
      L.shield.rect.x + 18,
      L.shield.rect.y + 4,
      '97%',
      PALETTE.grass3,
    )
    this.nine(ui, 'ui_panel_dark', L.ticker, 0.85)
    this.text(ui, 4, L.ticker.y, 'Day 3')
    this.text(
      ui,
      L.tickerDay.w + 4,
      L.ticker.y,
      'Hoist Hill reopens - trucks on sale',
      PALETTE.yellow3,
    )

    // Toast.
    const toast = this.text(ui, 0, 0, 'Payday - payroll -$28', dark, false)
    if (toast) {
      const w = toast.width + 12
      const r = { x: Math.round(W / 2 - w / 2), y: L.toast.y, w, h: L.toast.h }
      const bg = this.nine(ui, 'ui_panel', r)
      if (bg) ui.bringToTop(toast)
      toast.setPosition(r.x + 6, r.y + 4)
    }

    // Chips row: HQ + live regions + the next region to unlock.
    const unlock = new Map(data.districts.map((d) => [d.id, d.unlockLevel]))
    let cx = L.chip.x0
    const chipY = L.chips.y + Math.round((L.chips.h - L.chip.h) / 2)
    for (const r of data.map.regions) {
      const lvl = r.id === 'warehouse' ? 1 : (unlock.get(r.id) ?? 99)
      if (lvl > 2) continue
      const locked = lvl > 1
      const label = locked ? `${r.chipLabel} Lv${lvl}` : r.chipLabel
      const t = this.text(ui, 0, 0, label, dark, false)
      const tw = (t?.width ?? 40) + (locked ? 16 : 0)
      const w = tw + 2 * L.chip.padX
      const rect = { x: cx, y: chipY, w, h: L.chip.h }
      this.nine(ui, r.id === 'downtown' ? 'ui_chip_active' : 'ui_chip', rect)
      if (locked) this.icon(ui, 'ic_lock', cx + L.chip.padX - 2, chipY + 4)
      if (t) {
        ui.bringToTop(t)
        t.setPosition(cx + L.chip.padX + (locked ? 16 : 0), chipY + 4)
      }
      cx += w + L.chip.gap
    }

    // Bottom bar.
    this.nine(ui, 'ui_panel_dark', L.bottomBar, 0.92)
    const seg = [L.speedPause, L.speed1, L.speed2]
    seg.forEach((t, i) => {
      this.nine(ui, i === 1 ? 'ui_btn_down' : 'ui_btn', t.rect)
      if (i === 0) this.icon(ui, 'ic_pause', t.rect.x + 14, t.rect.y + 14)
      else {
        const s = this.text(ui, 0, 0, `${i}x`, dark, false)
        s?.setPosition(
          Math.round(t.rect.x + t.rect.w / 2 - s.width / 2),
          t.rect.y + 14,
        )
      }
    })
    this.nine(ui, 'ui_btn', L.mute.rect)
    this.icon(ui, 'ic_sax', L.mute.rect.x + 14, L.mute.rect.y + 14)
    for (const [t, ic, label] of [
      [L.warehouse, 'ic_warehouse', 'Warehouse'],
      [L.garage, 'ic_garage', 'Garage'],
    ] as const) {
      this.nine(ui, 'ui_btn', t.rect)
      this.icon(ui, ic, Math.round(t.rect.x + t.rect.w / 2 - 8), t.rect.y + 6)
      const s = this.text(ui, 0, 0, label, dark, false)
      s?.setPosition(
        Math.round(t.rect.x + t.rect.w / 2 - s.width / 2),
        t.rect.y + 24,
      )
    }

    // Hit boxes (layout.ts L.targets) as 1-px outlines.
    const g = this.add.graphics()
    g.lineStyle(1, PALETTE.red2, 0.9)
    for (const t of Object.values(L.targets))
      g.strokeRect(t.hit.x + 0.5, t.hit.y + 0.5, t.hit.w - 1, t.hit.h - 1)
    g.lineStyle(1, PALETTE.yellow2, 0.9)
    g.strokeRect(0.5, L.chip.hitY + 0.5, W - 1, L.chip.hitH - 1)
    ui.add(g)
  }
}
