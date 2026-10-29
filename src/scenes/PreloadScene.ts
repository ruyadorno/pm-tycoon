// Preload (plan.md §5, style-guide.md §7, phaser4-notes.md §7-§8): the ONE
// atlas `world` and the m5x7 BMFont descriptor, registered with
// BitmapText.ParseFromAtlas so text batches with the sprites; a progress bar;
// then Title, or straight to the ?view= world scene (skipTitle / view).
// map.json is not loaded here: it reaches the game through GameData.map
// (static import in src/data/load.browser.ts). Once the atlas is in, the
// AudioDirector starts fetching its samples (audio.md §3.2, §8.2: piano + bass,
// then vibes + trumpet, then the stinger set; never awaited — the Title shows
// "tuning up…" until 'audio:ready' lists piano + bass). Under ?audio=0 the
// director is disabled and fetches nothing.
import Phaser from 'phaser'
import type { AudioDirector } from '../audio/director.ts'
import { startWorld } from '../boot/nav.ts'
import { params, worldSceneKey } from '../debug/params.ts'
import {
  FONT_FRAME,
  FONT_KEY,
  FONT_XML_KEY,
  FONT_XML_URL,
  WORLD_ATLAS,
  WORLD_ATLAS_JSON,
  WORLD_ATLAS_PNG,
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
    this.load.atlas(WORLD_ATLAS, WORLD_ATLAS_PNG, WORLD_ATLAS_JSON)
    this.load.xml(FONT_XML_KEY, FONT_XML_URL)
  }

  create(): void {
    if (!this.textures.exists(WORLD_ATLAS)) {
      showCard('Assets failed to load', this.failed, { danger: true })
      return
    }
    for (const f of this.failed) console.error(`preload: failed ${f}`)
    // Nearest filtering is implied by pixelArt; pin it so a later
    // smoothPixelArt experiment cannot silently change the atlas.
    this.textures.get(WORLD_ATLAS).setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.registerFont()
    this.preloadAudio()
    const p = params()
    if (p.view || p.skipTitle) startWorld(this, worldSceneKey(p))
    else this.scene.start('Title')
  }

  /** Kick off the sample fetch + decode (after the atlas, so the first paint never waits on audio). */
  private preloadAudio(): void {
    const dir = this.registry.get(REG_AUDIO) as AudioDirector | undefined
    try {
      void dir?.preload()
    } catch (err) {
      // the director never throws; a missing or broken one must not block the Title
      console.warn('preload: audio preload failed', err)
    }
  }

  private registerFont(): void {
    const tex = this.textures.get(WORLD_ATLAS)
    if (!tex.has(FONT_FRAME)) {
      console.error(
        `preload: atlas "${WORLD_ATLAS}" has no "${FONT_FRAME}" frame`,
      )
      return
    }
    if (!this.cache.xml.exists(FONT_XML_KEY)) {
      console.error(`preload: missing ${FONT_XML_URL}`)
      return
    }
    const ok = Phaser.GameObjects.BitmapText.ParseFromAtlas(
      this,
      FONT_KEY,
      WORLD_ATLAS,
      FONT_FRAME,
      FONT_XML_KEY,
    )
    if (!ok) console.error(`preload: ParseFromAtlas failed for ${FONT_KEY}`)
  }
}
