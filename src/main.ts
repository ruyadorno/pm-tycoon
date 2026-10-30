// Entry point (plan.md §6.5, phaser4-notes.md §1, §4, §6): WebGL gate, the
// ONE shared AudioContext created before the game (audio.md §2: Phaser gets it
// through `audio.context`, the AudioDirector hands it to Tone and smplr; null
// for ?audio=0, which also gives Phaser its no-audio manager), the portrait
// pixel-art config — Scale.NONE with an integer zoom derived from #game (the
// only scale mode that honours zoom), pixelArt + roundPixels — and the
// resize/orientation handler (scale.resize + setZoom). The audio chunk's import
// starts here too (registry 'audioModule'); Boot creates the director from it
// and registry 'audioContext' (and sets pauseOnBlur = false). So does the
// policy chunk's (registry 'policyModule', for the Title's attract city and
// ?policy=1; null on a failed fetch, never fatal). Nothing is exposed
// globally here; window.__pm comes from src/debug/pm.ts.
import Phaser from 'phaser'
import { createSharedContext } from './audio/context.ts'
import { REG } from './boot/simBinding.ts'
import { params } from './debug/params.ts'
import {
  BootScene,
  importAudio,
  importPolicy,
  REG_AUDIO_MODULE,
  REG_POLICY_MODULE,
  showCard,
} from './scenes/BootScene.ts'
import { CityScene } from './scenes/CityScene.ts'
import { GalleryScene } from './scenes/GalleryScene.ts'
import { GarageSheet } from './scenes/GarageSheet.ts'
import { HudScene } from './scenes/HudScene.ts'
import { PreloadScene } from './scenes/PreloadScene.ts'
import { TitleScene } from './scenes/TitleScene.ts'
import { WarehouseScene } from './scenes/WarehouseScene.ts'
import { THEME } from './ui/theme.ts'

export const BUILD_STAMP = __BUILD_STAMP__

/** Logical width per zoom step: zoom = max(1, floor(cssW / 360)). */
export const ZOOM_STEP_CSS = 360

export interface CanvasSize {
  zoom: number
  width: number
  height: number
}

/** notes §1: integer zoom, logical size = CSS size / zoom (floored). */
export function measureCanvas(cssW: number, cssH: number): CanvasSize {
  const w = Math.max(1, Math.round(cssW))
  const h = Math.max(1, Math.round(cssH))
  const zoom = Math.max(1, Math.floor(w / ZOOM_STEP_CSS))
  return { zoom, width: Math.floor(w / zoom), height: Math.floor(h / zoom) }
}

function measure(el: HTMLElement): CanvasSize {
  return measureCanvas(el.clientWidth, el.clientHeight)
}

/** Safe-area insets in logical px from the hidden #safe probe (city-view.md §1.1). */
function readSafeInsets(zoom: number): { top: number; bottom: number } {
  const probe = document.getElementById('safe')
  if (!probe) return { top: 0, bottom: 0 }
  const cs = getComputedStyle(probe)
  const top = Number.parseFloat(cs.paddingTop) || 0
  const bottom = Number.parseFloat(cs.paddingBottom) || 0
  return { top: Math.ceil(top / zoom), bottom: Math.ceil(bottom / zoom) }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

function start(): void {
  if (!hasWebGL()) {
    showCard('WebGL is required', [
      'Package Management Tycoon needs WebGL. Try a current Safari, Chrome or Firefox, or enable hardware acceleration.',
    ])
    return
  }
  const p = params()
  const el = document.getElementById('game')
  if (!el) throw new Error('#game is missing from index.html')
  // The only `new AudioContext` of the game (src/audio/context.ts).
  const audioContext = p.audio ? createSharedContext() : null
  // The audio chunk (Tone's Transport, smplr, the director) loads while
  // Phaser boots; Boot awaits it (a disabled director under ?audio=0).
  const audioModule = importAudio()
  // The policy chunk too (the Title's attract city, ?policy=1): a failed
  // fetch resolves null, never a fatal boot.
  const policyModule = p.policy || p.attract ? importPolicy() : null
  const size = measure(el)

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,
    parent: el,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: THEME.backgroundCss,
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.NONE,
      width: size.width,
      height: size.height,
      zoom: size.zoom,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
    },
    input: {
      activePointers: 3,
      touch: { capture: true },
      mouse: { preventDefaultWheel: true },
      windowEvents: true,
    },
    audio: audioContext ? { context: audioContext } : { noAudio: true },
    fps: { target: 60, smoothStep: true },
    render: { autoMobileTextures: true },
    seed: [String(p.seed)],
    scene: [
      BootScene,
      PreloadScene,
      TitleScene,
      CityScene,
      WarehouseScene,
      HudScene,
      GarageSheet,
      GalleryScene,
    ],
  }

  const game = new Phaser.Game(config)
  game.registry.set(REG.audioContext, audioContext)
  game.registry.set(REG_AUDIO_MODULE, audioModule)
  if (policyModule) game.registry.set(REG_POLICY_MODULE, policyModule)
  const setSafe = (zoom: number): void => {
    const s = readSafeInsets(zoom)
    game.registry.set(REG.safeTop, s.top)
    game.registry.set(REG.safeBottom, s.bottom)
  }
  setSafe(size.zoom)

  let pending = 0
  const relayout = (): void => {
    pending = 0
    const next = measure(el)
    const cur = game.scale
    // The insets first: scale.resize emits RESIZE synchronously and the
    // City (camera bounds) reads registry safeTop/safeBottom in its handler.
    setSafe(next.zoom)
    if (
      next.width !== cur.width ||
      next.height !== cur.height ||
      next.zoom !== cur.zoom
    ) {
      cur.resize(next.width, next.height)
      cur.setZoom(next.zoom)
    }
  }
  const schedule = (): void => {
    if (!pending) pending = requestAnimationFrame(relayout)
  }
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
  screen.orientation?.addEventListener?.('change', schedule)
  blockPageGestures()
}

/**
 * phaser4-notes §4: Safari ignores `user-scalable=no`, and Phaser only
 * preventDefaults touches that start on the canvas. iOS still pinch-zooms
 * the page from its WebKit gesture events (a pinch that starts on the
 * landscape margins, the HTML cards, or the summary's copy box), and a page
 * zoomed in stays zoomed with the canvas half off-screen. touch-action: none
 * covers the rest (index.html).
 */
function blockPageGestures(): void {
  for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(name, preventDefault, { passive: false })
}

function preventDefault(e: Event): void {
  e.preventDefault()
}

start()
