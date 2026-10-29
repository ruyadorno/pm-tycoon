// Entry point (plan.md §6.5, phaser4-notes.md §1, §4, §6): WebGL gate, one
// shared AudioContext created before the game (Phaser, Tone and smplr all use
// it), the portrait pixel-art config — Scale.NONE with an integer zoom derived
// from #game (the only scale mode that honours zoom), pixelArt + roundPixels —
// and the resize/orientation handler (scale.resize + setZoom). Nothing is
// exposed globally here; window.__pm comes from src/debug/pm.ts.
import Phaser from 'phaser'
import { REG } from './boot/simBinding.ts'
import { params } from './debug/params.ts'
import { BootScene, showCard } from './scenes/BootScene.ts'
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

function createAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
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
  const audioContext = p.audio ? createAudioContext() : null
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
  const setSafe = (zoom: number): void => {
    const s = readSafeInsets(zoom)
    game.registry.set(REG.safeTop, s.top)
    game.registry.set(REG.safeBottom, s.bottom)
  }
  setSafe(size.zoom)
  // The AudioDirector (M3) owns blur/focus; Phaser must not suspend the
  // shared context on its own (notes §6).
  game.events.once(Phaser.Core.Events.READY, () => {
    const sound = game.sound as { pauseOnBlur?: boolean } | undefined
    if (sound && 'pauseOnBlur' in sound) sound.pauseOnBlur = false
  })

  let pending = 0
  const relayout = (): void => {
    pending = 0
    const next = measure(el)
    const cur = game.scale
    if (
      next.width !== cur.width ||
      next.height !== cur.height ||
      next.zoom !== cur.zoom
    ) {
      cur.resize(next.width, next.height)
      cur.setZoom(next.zoom)
    }
    setSafe(next.zoom)
  }
  const schedule = (): void => {
    if (!pending) pending = requestAnimationFrame(relayout)
  }
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
}

start()
