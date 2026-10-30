// Preload (plan.md §5, style-guide.md §7, phaser4-notes.md §7-§8,
// spec-build2 §5 + §6.8): the two atlases `world` and `interior`, the m5x7
// BMFont descriptor (registered with BitmapText.ParseFromAtlas on `world` as
// FONT_KEY so text batches with the city and HUD sprites, and on `interior`
// as ROOM_FONT_KEY for the room's back layers), the logo as its own texture
// and the attract-mode snapshot in the JSON cache — every URL a
// content-hashed Vite `?url` import (src/render/assetUrls.ts, report-playtest1
// §6.21); a progress bar; then Title, or straight to the ?view= world scene
// (skipTitle / view). A missing atlas is fatal (the "Assets failed" card); a
// missing logo or attract snapshot is logged and the Title copes.
// map.json is not loaded here: it reaches the game through GameData.map
// (static import in src/data/load.browser.ts). Once the atlases are in, the
// AudioDirector starts fetching its samples (audio.md §3.2, §8.2: piano + bass,
// then vibes + trumpet, then the stinger set; never awaited — the Title shows
// "tuning up…" until 'audio:ready' lists piano + bass). Under ?audio=0 the
// director is disabled and fetches nothing.
import Phaser from 'phaser'
import type { AudioDirector } from '../audio/director.ts'
import { startWorld } from '../boot/nav.ts'
import { params, worldSceneKey } from '../debug/params.ts'
import {
  ATTRACT_URL,
  FONT_XML_URL,
  INTERIOR_JSON_URL,
  INTERIOR_PNG_URL,
  LOGO_URL,
  WORLD_JSON_URL,
  WORLD_PNG_URL,
} from '../render/assetUrls.ts'
import {
  ATLAS_KEYS,
  ATTRACT_KEY,
  FONT_FRAME,
  FONT_KEY,
  FONT_XML_KEY,
  INTERIOR_ATLAS,
  LOGO_KEY,
  ROOM_FONT_KEY,
  WORLD_ATLAS,
} from '../render/atlases.ts'
import { THEME } from '../ui/theme.ts'
import { REG_AUDIO, showCard } from './BootScene.ts'

export class PreloadScene extends Phaser.Scene {
  private failed: string[] = []

  constructor() {
    super('Preload')
  }

  init(): void {
    this.failed = []
  }

  preload(): void {
    const { width: W, height: H } = this.scale
    const barW = Math.min(240, W - 48)
    const x = Math.round((W - barW) / 2)
    const y = Math.round(H / 2)
    const g = this.add.graphics()
    const draw = (v: number): void => {
      g.clear()
      g.fillStyle(THEME.outline, 1).fillRect(x - 2, y - 2, barW + 4, 12)
      g.fillStyle(THEME.panelDark, 1).fillRect(x, y, barW, 8)
      g.fillStyle(THEME.gold, 1).fillRect(x, y, Math.round(barW * v), 8)
    }
    draw(0)
    this.load.on(Phaser.Loader.Events.PROGRESS, draw)
    this.load.on(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      (file: Phaser.Loader.File) => {
        this.failed.push(`${file.key}: ${file.url}`)
      },
    )
    this.load.atlas(WORLD_ATLAS, WORLD_PNG_URL, WORLD_JSON_URL)
    this.load.atlas(INTERIOR_ATLAS, INTERIOR_PNG_URL, INTERIOR_JSON_URL)
    this.load.xml(FONT_XML_KEY, FONT_XML_URL)
    this.load.image(LOGO_KEY, LOGO_URL)
    this.load.json(ATTRACT_KEY, ATTRACT_URL)
  }

  create(): void {
    if (ATLAS_KEYS.some((k) => !this.textures.exists(k))) {
      showCard('Assets failed to load', this.failed, { danger: true })
      return
    }
    for (const f of this.failed) console.error(`preload: failed ${f}`)
    // Nearest filtering is implied by pixelArt; pin it so a later
    // smoothPixelArt experiment cannot silently change the atlases.
    for (const k of [...ATLAS_KEYS, LOGO_KEY]) {
      if (this.textures.exists(k)) {
        this.textures.get(k).setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
    }
    this.registerFont()
    this.preloadAudio()
    const p = params()
    if (p.view || p.skipTitle) startWorld(this, worldSceneKey(p))
    else this.scene.start('Title')
  }

  /** Kick off the sample fetch + decode (after the atlases, so the first paint never waits on audio). */
  private preloadAudio(): void {
    const dir = this.registry.get(REG_AUDIO) as AudioDirector | undefined
    try {
      void dir?.preload()
    } catch (err) {
      // the director never throws; a missing or broken one must not block the Title
      console.warn('preload: audio preload failed', err)
    }
  }

  /**
   * m5x7 from `world` as FONT_KEY (the city, the HUD, the room's front
   * layers) and, when `interior` carries the glyph sheet too, as
   * ROOM_FONT_KEY (text in the room's back layers, tools/art/atlas.ts).
   */
  private registerFont(): void {
    if (!this.cache.xml.exists(FONT_XML_KEY)) {
      console.error(`preload: missing ${FONT_XML_URL}`)
      return
    }
    const fonts = [
      { key: FONT_KEY, atlas: WORLD_ATLAS, required: true },
      { key: ROOM_FONT_KEY, atlas: INTERIOR_ATLAS, required: false },
    ]
    for (const f of fonts) {
      if (!this.textures.get(f.atlas).has(FONT_FRAME)) {
        if (f.required) {
          console.error(
            `preload: atlas "${f.atlas}" has no "${FONT_FRAME}" frame`,
          )
        }
        continue
      }
      const ok = Phaser.GameObjects.BitmapText.ParseFromAtlas(
        this,
        f.key,
        f.atlas,
        FONT_FRAME,
        FONT_XML_KEY,
      )
      if (!ok) console.error(`preload: ParseFromAtlas failed for ${f.key}`)
    }
  }
}
