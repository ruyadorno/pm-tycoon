// Title card (city-view.md §9.5) — M0 placeholder: a skyline from the atlas,
// the company sign, Continue / New game / Reset / Credits laid out with
// layout.ts, the build stamp bottom-right (registry 'buildStamp', pinned by
// __pm.stamp) and the seed bottom-left in debug builds. The first tap anywhere
// is the audio unlock (resume the shared AudioContext). Continue (save
// restore) and the Reset/overwrite dialogs are wired in M1; here Continue only
// appears when a save exists and Reset asks for a second tap.
import Phaser from 'phaser'
import { startWorld } from '../boot/nav.ts'
import { getData, REG } from '../boot/simBinding.ts'
import { debugEnabled, params } from '../debug/params.ts'
import { FONT_KEY, WORLD_ATLAS } from '../render/atlases.ts'
import { buttonColumn, type Target } from '../ui/layout.ts'
import { FONT_SIZE, FONT_SIZE_BIG, THEME } from '../ui/theme.ts'

export const SAVE_KEYS = ['pm.save.v1', 'pm.settings.v1', 'pm.playtest.v1']

// Hero frames for the skyline: 1x1 and 2x2 only, so the tallest (160 px)
// stays clear of the title on a 360x600 screen.
const SKYLINE = [
  'dt_semver_bank',
  'hr_pizza',
  'hr_callback_court',
  'dt_cache_cafe',
  'dt_scope_offices',
  'hr_is_odd_store',
  'hr_async_arms',
]

function hasSave(): boolean {
  try {
    return localStorage.getItem('pm.save.v1') !== null
  } catch {
    return false
  }
}

export class TitleScene extends Phaser.Scene {
  private unlocked = false

  constructor() {
    super('Title')
  }

  init(): void {
    this.unlocked = false
  }

  create(): void {
    const { width: W, height: H } = this.scale
    const tex = this.textures.get(WORLD_ATLAS)
    const font = this.cache.bitmapFont.has(FONT_KEY)
    const text = (
      x: number,
      y: number,
      s: string,
      size = FONT_SIZE,
      tint: number = THEME.textDark,
    ): Phaser.GameObjects.BitmapText | null => {
      if (!font) return null
      return this.add
        .bitmapText(Math.round(x), Math.round(y), FONT_KEY, s, size)
        .setTint(tint)
    }

    // Buttons (layout first: the skyline stands on the column's top edge).
    const save = hasSave()
    const labels = [
      ...(save ? ['Continue'] : []),
      'New game',
      'Reset',
      'Credits',
    ]
    const col = buttonColumn(
      W,
      Math.round(H * 0.72),
      labels.length,
      this.scale.zoom,
    )

    // Skyline: hero building frames standing on one baseline.
    const base = (col[0]?.rect.y ?? Math.round(H * 0.6)) - 12
    let x = -24
    for (const f of SKYLINE) {
      if (!tex.has(f)) continue
      const img = this.add.image(x, base, WORLD_ATLAS, f).setOrigin(0, 1)
      x += Math.round(img.width * 0.6)
      if (x > W) break
    }

    // Sign + title in the sky above it.
    const signY = Math.round(H * 0.1)
    if (tex.has('sign_title')) {
      const sign = this.add.image(
        Math.round(W / 2),
        signY,
        WORLD_ATLAS,
        'sign_title',
      )
      // Company name (puns.json) on the board, right of its parcel emblem.
      const name = text(
        0,
        0,
        getData(this)?.puns.companyName ?? '',
        FONT_SIZE,
        THEME.textLight,
      )
      if (name) {
        name.setMaxWidth(sign.width - 44).setCenterAlign()
        name.setPosition(
          Math.round(sign.x + 14 - name.width / 2),
          Math.round(signY - 4 - name.height / 2),
        )
      }
    }
    const title = text(
      0,
      signY + 32,
      'Package Management',
      FONT_SIZE_BIG,
      THEME.textLight,
    )
    const title2 = text(0, signY + 60, 'Tycoon', FONT_SIZE_BIG, THEME.gold)
    for (const t of [title, title2]) {
      if (!t) continue
      t.setDropShadow(1, 1, THEME.shadow, 1)
      t.setX(Math.round(W / 2 - t.width / 2))
    }

    labels.forEach((label, i) => {
      const t = col[i]!
      this.button(t, label, i === 0 ? 'ui_btn_primary' : 'ui_btn', () =>
        this.onButton(label),
      )
    })

    // Footer: build stamp bottom-right, seed bottom-left (debug).
    const stamp = text(0, H - 14, '', FONT_SIZE, THEME.textMuted)
    const setStamp = (): void => {
      if (!stamp) return
      stamp.setText(String(this.registry.get(REG.buildStamp) ?? ''))
      stamp.setX(Math.round(W - 4 - stamp.width))
    }
    setStamp()
    this.registry.events.on('changedata-' + REG.buildStamp, setStamp)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.registry.events.off('changedata-' + REG.buildStamp, setStamp)
    })
    if (debugEnabled())
      text(4, H - 14, `seed ${params().seed}`, FONT_SIZE, THEME.textMuted)

    // The first tap anywhere unlocks audio (city-view.md §9.5).
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.unlockAudio())
  }

  private button(
    t: Target,
    label: string,
    frame: string,
    onTap: () => void,
  ): void {
    const { rect, hit } = t
    const tex = this.textures.get(WORLD_ATLAS)
    const up = tex.has(frame) ? frame : 'ui_btn'
    const down = tex.has(`${up}_down`) ? `${up}_down` : 'ui_btn_down'
    const bg = this.add
      .nineslice(rect.x, rect.y, WORLD_ATLAS, up, rect.w, rect.h, 4, 4, 4, 4)
      .setOrigin(0, 0)
    bg.setInteractive(
      new Phaser.Geom.Rectangle(hit.x - rect.x, hit.y - rect.y, hit.w, hit.h),
      Phaser.Geom.Rectangle.Contains,
    )
    let txt: Phaser.GameObjects.BitmapText | null = null
    if (this.cache.bitmapFont.has(FONT_KEY)) {
      txt = this.add
        .bitmapText(0, 0, FONT_KEY, label, FONT_SIZE)
        .setTint(up === 'ui_btn_primary' ? THEME.textLight : THEME.textDark)
      txt.setPosition(
        Math.round(rect.x + rect.w / 2 - txt.width / 2),
        Math.round(rect.y + rect.h / 2 - txt.height / 2),
      )
    }
    bg.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (tex.has(down)) bg.setFrame(down)
      txt?.setY(txt.y + 1)
    })
    const release = (): void => {
      if (bg.frame.name !== up) {
        bg.setFrame(up)
        txt?.setY(txt.y - 1)
      }
    }
    bg.on(Phaser.Input.Events.POINTER_OUT, release)
    bg.on(Phaser.Input.Events.POINTER_UP, () => {
      release()
      this.unlockAudio()
      onTap()
    })
    bg.setData('label', label)
    txt?.setData('label', label)
  }

  private resetArmed = 0

  private onButton(label: string): void {
    switch (label) {
      case 'Continue':
      case 'New game':
        startWorld(this, 'City')
        return
      case 'Reset': {
        const now = this.time.now
        if (now - this.resetArmed < 3000) {
          for (const k of SAVE_KEYS) {
            try {
              localStorage.removeItem(k)
            } catch {
              // storage blocked: nothing to clear
            }
          }
          this.scene.restart()
        } else this.resetArmed = now
        return
      }
      case 'Credits':
        this.showCredits()
        return
    }
  }

  private credits: Phaser.GameObjects.Container | null = null

  private showCredits(): void {
    if (this.credits) {
      this.credits.destroy()
      this.credits = null
      return
    }
    if (!this.cache.bitmapFont.has(FONT_KEY)) return
    const { width: W, height: H } = this.scale
    const w = Math.min(300, W - 24)
    const lines = [
      'Package Management Tycoon',
      '',
      'Font: m5x7 by Daniel Linssen (CC0)',
      'Engine: Phaser 4',
      '',
      'Tap to close',
    ]
    const h = lines.length * 16 + 16
    const x = Math.round((W - w) / 2)
    const y = Math.round((H - h) / 2)
    const panel = this.add
      .nineslice(0, 0, WORLD_ATLAS, 'ui_panel', w, h, 4, 4, 4, 4)
      .setOrigin(0, 0)
    const txt = this.add
      .bitmapText(8, 8, FONT_KEY, lines.join('\n'), FONT_SIZE)
      .setTint(THEME.textDark)
    this.credits = this.add.container(x, y, [panel, txt]).setDepth(100)
    panel.setInteractive()
    panel.on(Phaser.Input.Events.POINTER_UP, () => this.showCredits())
  }

  private unlockAudio(): void {
    if (this.unlocked) return
    this.unlocked = true
    if (!params().audio) return
    const ctx = this.registry.get(REG.audioContext) as AudioContext | null
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {})
  }
}
