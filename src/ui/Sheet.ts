// Bottom-sheet base (city-view.md §7 / §5.1, phaser4-notes.md §3-§4): usable
// from any scene (the Garage overlay scene, the DistrictPanel in HudScene).
//
// - Chrome: a `root` Container at x 0, y = H − height when open (H when
//   closed), holding a full-width panel NineSlice and the 40x8 drag handle.
//   Callers add header/footer objects to `root` in sheet-local coordinates.
// - Scrim: a full-screen Rectangle under the sheet that swallows taps; a tap
//   on it closes the sheet (closeOnOutside). Transparent unless scrimAlpha.
// - Slide in 250 ms Cubic.easeOut, out 200 ms Cubic.easeIn; positions are
//   rounded every frame.
// - Drag down on the header zone (sheet top .. headerH) moves the sheet with
//   the finger; release past 60 px closes, otherwise it snaps back.
// - Esc closes the top-most modal (shared stack with Dialog: claimKey).
// - Optional clipped list: `content` is a Container placed far off-screen
//   (unique per sheet) and shown through a dedicated camera `listCam` whose
//   viewport is the list rect (the viewport is the clip, notes §3). Every
//   other camera ignores `content`; listCam ignores the scene's other
//   objects. Vertical drag inside the viewport scrolls it (8-px threshold),
//   with inertia (px/ms, 0.92^(dt/16) decay) and integer scroll at rest.
// - Emits `ui:sheetOpen` / `ui:sheetClose` {id} on game.events.
import type Phaser from 'phaser'
import { UI_ATLAS } from '../render/atlases.ts'
import { addPanel, type PanelFrame } from './Panel.ts'
import { THEME } from './theme.ts'

export const SHEET_IN_MS = 250
export const SHEET_OUT_MS = 200
export const SNAP_BACK_MS = 120
export const DRAG_CLOSE_PX = 60
export const LIST_DRAG_PX = 8
export const HANDLE_W = 40
export const HANDLE_H = 8
export const HANDLE_Y = 4
export const DEFAULT_DEPTH = 5000

// ---- modal stack (shared by Sheet and Dialog) ------------------------------
// Esc/Enter go to the top-most open modal only. Keyboard listeners in several
// scenes all see the same KeyboardEvent; the first owner that is on top
// claims it and later listeners see it as handled.

const modalStack: object[] = []
let lastClaimed: KeyboardEvent | null = null

export function pushModal(owner: object): void {
  const i = modalStack.indexOf(owner)
  if (i >= 0) modalStack.splice(i, 1)
  modalStack.push(owner)
}

export function popModal(owner: object): void {
  const i = modalStack.indexOf(owner)
  if (i >= 0) modalStack.splice(i, 1)
}

export function topModal(): object | null {
  return modalStack[modalStack.length - 1] ?? null
}

/** Number of open modals (sheets + dialogs); 0 = the city owns the keys. */
export function modalCount(): number {
  return modalStack.length
}

/**
 * True (and the event is consumed) when `owner` is the top-most modal and no
 * other listener handled `ev` yet. Pass owner null to claim an event only
 * when no modal is open (e.g. HUD shortcuts).
 */
export function claimKey(ev: KeyboardEvent, owner: object | null): boolean {
  if (ev === lastClaimed) return false
  if (topModal() !== owner) return false
  lastClaimed = ev
  return true
}

/** True when some listener already claimed `ev`. */
export function keyClaimed(ev: KeyboardEvent): boolean {
  return ev === lastClaimed
}

// ---- off-screen origins for clipped content --------------------------------

let originSeq = 0

/** A unique far-off world origin for content shown through its own camera. */
export function offscreenOrigin(): { x: number; y: number } {
  originSeq = (originSeq + 1) % 64
  return { x: -16384 - originSeq * 2048, y: -16384 }
}

// ---- Sheet -----------------------------------------------------------------

export interface SheetOptions {
  /** Sheet height in px (y = H − height when open). */
  height: number
  /** Canvas size; default scene.scale.width/height. */
  W?: number
  H?: number
  /** Depth of the chrome; the scrim sits at depth − 1. Default 5000. */
  depth?: number
  /** Background frame; default 'ui_panel'. */
  frame?: PanelFrame
  /**
   * Height of the drag-to-close zone from the sheet top. Default: the list
   * top when there is a list, else the whole sheet.
   */
  headerH?: number
  /** Clipped scrolling list viewport, in sheet-local px. */
  list?: { top: number; height: number; x?: number; w?: number }
  /** Scrim fill alpha (black); default 0 (invisible, still swallows taps). */
  scrimAlpha?: number
  closeOnOutside?: boolean
  closeOnEsc?: boolean
  /** Payload id for ui:sheetOpen / ui:sheetClose. */
  id?: string
  /** Called when open() starts. */
  onOpen?: () => void
  /** Called when close() starts (before the slide-out). */
  onClose?: () => void
  /** Called when the slide-out finished (the sheet is hidden). */
  onClosed?: () => void
}

interface ListDrag {
  pointerId: number
  startY: number
  startScroll: number
  lastY: number
  lastT: number
  v: number
  active: boolean
}

export class Sheet {
  readonly scene: Phaser.Scene
  readonly id: string
  /** Chrome container (sheet-local coordinates; x 0, y = sheet top). */
  readonly root: Phaser.GameObjects.Container
  readonly bg: Phaser.GameObjects.NineSlice
  readonly handle: Phaser.GameObjects.Image
  readonly scrim: Phaser.GameObjects.Rectangle
  /** List content (list-local coordinates, y 0 = top of the list). */
  readonly content: Phaser.GameObjects.Container | null = null
  readonly listCam: Phaser.Cameras.Scene2D.Camera | null = null

  private opts: SheetOptions
  private W: number
  private H: number
  private h: number
  private opened = false
  private tween: Phaser.Tweens.Tween | null = null
  private drag: { pointerId: number; startY: number; dy: number } | null = null
  private scrimArmed = false
  private origin = { x: 0, y: 0 }
  private scroll = 0
  private contentH = 0
  private listDrag: ListDrag | null = null
  private vy = 0
  private destroyed = false

  constructor(scene: Phaser.Scene, opts: SheetOptions) {
    this.scene = scene
    this.opts = opts
    this.id = opts.id ?? ''
    this.W = Math.round(opts.W ?? scene.scale.width)
    this.H = Math.round(opts.H ?? scene.scale.height)
    this.h = Math.round(opts.height)
    const depth = opts.depth ?? DEFAULT_DEPTH

    this.scrim = scene.add
      .rectangle(0, 0, this.W, this.H, THEME.shadow, opts.scrimAlpha ?? 0)
      .setOrigin(0, 0)
      .setDepth(depth - 1)
      .setVisible(false)
      .setInteractive()
    this.scrim.on('pointerdown', () => {
      this.scrimArmed = true
    })
    this.scrim.on('pointerup', (p: Phaser.Input.Pointer) => {
      const armed = this.scrimArmed
      this.scrimArmed = false
      if (
        armed &&
        p.getDistance() <= LIST_DRAG_PX &&
        this.opened &&
        (opts.closeOnOutside ?? true)
      )
        this.close()
    })

    this.bg = addPanel(scene, 0, 0, this.W, this.h, opts.frame ?? 'ui_panel')
    this.bg.setInteractive()
    this.bg.on('pointerdown', this.onBgDown, this)
    this.handle = scene.add
      .image(
        Math.round((this.W - HANDLE_W) / 2),
        HANDLE_Y,
        UI_ATLAS,
        'ui_sheet_handle',
      )
      .setOrigin(0, 0)
    this.root = scene.add
      .container(0, this.H, [this.bg, this.handle])
      .setDepth(depth)
      .setVisible(false)

    if (opts.list) {
      this.origin = offscreenOrigin()
      const content = scene.add.container(this.origin.x, this.origin.y)
      for (const cam of scene.cameras.cameras) cam.ignore(content)
      const lr = this.listRect()
      const cam = scene.cameras.add(lr.x, this.H + lr.top, lr.w, lr.h)
      cam.setScroll(this.origin.x - lr.x, this.origin.y)
      cam.setVisible(false)
      this.content = content
      this.listCam = cam
    }

    const input = scene.input
    input.on('pointermove', this.onMove, this)
    input.on('pointerup', this.onUp, this)
    input.on('pointerupoutside', this.onUp, this)
    input.on('gameout', this.onGameOut, this)
    input.on('pointerdown', this.onSceneDown, this)
    input.keyboard?.on('keydown', this.onKey, this)
    scene.events.on('update', this.onUpdate, this)
    scene.events.on('sleep', this.onSleep, this)
    scene.events.on('wake', this.onWake, this)
    scene.events.once('shutdown', this.destroy, this)
  }

  // ---- public API --------------------------------------------------------

  isOpen(): boolean {
    return this.opened
  }

  /** Screen y of the sheet's top edge when fully open. */
  get top(): number {
    return this.H - this.h
  }

  get height(): number {
    return this.h
  }

  get width(): number {
    return this.W
  }

  /** Add chrome objects (sheet-local coordinates). */
  add(...objs: Phaser.GameObjects.GameObject[]): this {
    this.root.add(objs)
    return this
  }

  /** Add list objects (list-local coordinates; y 0 = list top). */
  addToList(...objs: Phaser.GameObjects.GameObject[]): this {
    if (!this.content) throw new Error('Sheet: no list viewport')
    this.content.add(objs)
    return this
  }

  /** Total height of the list content (sets the scroll range). */
  setContentHeight(h: number): this {
    this.contentH = Math.max(0, Math.round(h))
    this.setScroll(this.scroll)
    return this
  }

  get scrollY(): number {
    return this.scroll
  }

  get maxScroll(): number {
    const lr = this.listRect()
    return Math.max(0, this.contentH - lr.h)
  }

  /** Scroll the list to `y` (clamped, integer); stops any fling. */
  setScroll(y: number): this {
    this.vy = 0
    this.applyScroll(y)
    return this
  }

  /** Scroll the least amount so [y, y + h) of the content is visible. */
  scrollIntoView(y: number, h: number): this {
    const vh = this.listRect().h
    if (y < this.scroll) return this.setScroll(y)
    if (y + h > this.scroll + vh) return this.setScroll(y + h - vh)
    return this
  }

  /** The list viewport in screen px when open (for hit tests / tooltips). */
  listViewport(): { x: number; y: number; w: number; h: number } | null {
    if (!this.opts.list) return null
    const lr = this.listRect()
    return { x: lr.x, y: this.top + lr.top, w: lr.w, h: lr.h }
  }

  open(): void {
    if (this.opened || this.destroyed) return
    this.opened = true
    pushModal(this)
    this.scrim.setVisible(true)
    this.root.setVisible(true)
    if (this.listCam && this.content) {
      // Keep everything else out of the list camera (incl. scrollFactor-0
      // objects, which a far-off scroll alone would not hide).
      for (const obj of this.scene.children.list)
        if (obj !== this.content) this.listCam.ignore(obj)
      for (const cam of this.scene.cameras.cameras)
        if (cam !== this.listCam) cam.ignore(this.content)
      this.listCam.setVisible(true)
    }
    this.opts.onOpen?.()
    this.scene.game.events.emit('ui:sheetOpen', { id: this.id })
    this.slideTo(this.top, SHEET_IN_MS, 'Cubic.easeOut')
  }

  /** Close (animated); `instant` skips the slide. */
  close(instant = false): void {
    if (!this.opened || this.destroyed) return
    this.opened = false
    this.drag = null
    this.listDrag = null
    this.vy = 0
    popModal(this)
    this.scrim.setVisible(false)
    this.opts.onClose?.()
    this.scene.game.events.emit('ui:sheetClose', { id: this.id })
    const done = (): void => {
      this.root.setVisible(false)
      this.listCam?.setVisible(false)
      this.opts.onClosed?.()
    }
    if (instant) {
      this.tween?.stop()
      this.tween = null
      this.setY(this.H)
      done()
    } else this.slideTo(this.H, SHEET_OUT_MS, 'Cubic.easeIn', done)
  }

  toggle(): void {
    if (this.opened) this.close()
    else this.open()
  }

  /**
   * Re-fit to a new canvas size (pass L from computeLayout, or {W, H}) and
   * optionally a new height. Callers re-lay their own children.
   */
  relayout(L: { W: number; H: number }, height?: number): void {
    this.W = Math.round(L.W)
    this.H = Math.round(L.H)
    if (height !== undefined) this.h = Math.round(height)
    this.scrim.setSize(this.W, this.H)
    if (this.scrim.input?.hitArea)
      (this.scrim.input.hitArea as Phaser.Geom.Rectangle).setSize(
        this.W,
        this.H,
      )
    this.bg.setSize(this.W, this.h)
    if (this.bg.input?.hitArea)
      (this.bg.input.hitArea as Phaser.Geom.Rectangle).setSize(this.W, this.h)
    this.handle.setX(Math.round((this.W - HANDLE_W) / 2))
    if (this.listCam) {
      const lr = this.listRect()
      this.listCam.setSize(lr.w, lr.h)
      this.listCam.setScroll(this.origin.x - lr.x, this.origin.y + this.scroll)
    }
    this.tween?.stop()
    this.tween = null
    this.setY(this.opened ? this.top : this.H)
    this.applyScroll(this.scroll)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    popModal(this)
    this.tween?.stop()
    const input = this.scene.input
    input?.off('pointermove', this.onMove, this)
    input?.off('pointerup', this.onUp, this)
    input?.off('pointerupoutside', this.onUp, this)
    input?.off('gameout', this.onGameOut, this)
    input?.off('pointerdown', this.onSceneDown, this)
    input?.keyboard?.off('keydown', this.onKey, this)
    this.scene.events.off('update', this.onUpdate, this)
    this.scene.events.off('sleep', this.onSleep, this)
    this.scene.events.off('wake', this.onWake, this)
    this.scene.events.off('shutdown', this.destroy, this)
    if (this.listCam) this.scene.cameras.remove(this.listCam, true)
    this.content?.destroy()
    this.root.destroy()
    this.scrim.destroy()
  }

  // ---- internals ---------------------------------------------------------

  private listRect(): { x: number; top: number; w: number; h: number } {
    const l = this.opts.list ?? { top: 0, height: 0 }
    return {
      x: Math.round(l.x ?? 0),
      top: Math.round(l.top),
      w: Math.round(l.w ?? this.W),
      h: Math.max(1, Math.round(l.height)),
    }
  }

  private headerH(): number {
    if (this.opts.headerH !== undefined) return this.opts.headerH
    return this.opts.list ? this.listRect().top : this.h
  }

  private setY(y: number): void {
    const ry = Math.round(y)
    this.root.setY(ry)
    if (this.listCam)
      this.listCam.setPosition(this.listRect().x, ry + this.listRect().top)
  }

  private slideTo(
    y: number,
    ms: number,
    ease: string,
    onDone?: () => void,
  ): void {
    this.tween?.stop()
    const proxy = { y: this.root.y }
    this.tween = this.scene.tweens.add({
      targets: proxy,
      y,
      duration: ms,
      ease,
      onUpdate: () => this.setY(proxy.y),
      onComplete: () => {
        this.tween = null
        this.setY(y)
        onDone?.()
      },
    })
  }

  private applyScroll(y: number): void {
    this.scroll = Math.min(this.maxScroll, Math.max(0, y))
    if (this.listCam)
      this.listCam.setScroll(
        this.origin.x - this.listRect().x,
        this.origin.y + Math.round(this.scroll),
      )
  }

  private inList(x: number, y: number): boolean {
    const v = this.listViewport()
    if (!v || !this.opened) return false
    return x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h
  }

  private onBgDown(p: Phaser.Input.Pointer): void {
    if (!this.opened) return
    const localY = p.y - this.root.y
    if (localY < 0 || localY >= this.headerH()) return
    this.tween?.stop()
    this.tween = null
    this.drag = { pointerId: p.id, startY: p.y, dy: 0 }
  }

  private onSceneDown(p: Phaser.Input.Pointer): void {
    // A Dialog above the sheet owns the pointer.
    if (topModal() !== this || !this.inList(p.x, p.y)) return
    this.vy = 0
    this.listDrag = {
      pointerId: p.id,
      startY: p.y,
      startScroll: this.scroll,
      lastY: p.y,
      lastT: this.scene.time.now,
      v: 0,
      active: false,
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (this.drag && p.id === this.drag.pointerId && p.isDown) {
      this.drag.dy = Math.max(0, p.y - this.drag.startY)
      this.setY(this.top + this.drag.dy)
      return
    }
    const d = this.listDrag
    if (d && p.id === d.pointerId && p.isDown) {
      if (!d.active && Math.abs(p.y - d.startY) > LIST_DRAG_PX) d.active = true
      if (!d.active) return
      const now = this.scene.time.now
      const dt = Math.max(1, now - d.lastT)
      const v = (p.y - d.lastY) / dt
      d.v = d.v * 0.5 + v * 0.5
      d.lastY = p.y
      d.lastT = now
      this.applyScroll(d.startScroll - (p.y - d.startY))
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (this.drag && p.id === this.drag.pointerId) {
      const dy = this.drag.dy
      this.drag = null
      if (dy > DRAG_CLOSE_PX) this.close()
      else if (this.opened)
        this.slideTo(this.top, SNAP_BACK_MS, 'Cubic.easeOut')
    }
    const d = this.listDrag
    if (d && p.id === d.pointerId) {
      this.listDrag = null
      // A finger that paused before lifting carries no fling.
      if (d.active && this.scene.time.now - d.lastT < 80) this.vy = d.v
    }
  }

  private onGameOut(): void {
    if (this.drag) {
      this.drag = null
      if (this.opened) this.slideTo(this.top, SNAP_BACK_MS, 'Cubic.easeOut')
    }
    this.listDrag = null
  }

  private onUpdate(_t: number, delta: number): void {
    if (!this.vy || this.listDrag) return
    const before = this.scroll
    this.applyScroll(this.scroll - this.vy * delta)
    this.vy *= Math.pow(0.92, delta / 16)
    if (Math.abs(this.vy) < 0.05 || this.scroll === before) {
      this.vy = 0
      this.applyScroll(Math.round(this.scroll))
    }
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.opened || ev.key !== 'Escape') return
    if (!(this.opts.closeOnEsc ?? true)) return
    if (claimKey(ev, this)) this.close()
  }

  private onSleep(): void {
    popModal(this)
    this.drag = null
    this.listDrag = null
    this.vy = 0
  }

  private onWake(): void {
    if (this.opened) pushModal(this)
  }
}
