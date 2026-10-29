// Title card (city-view.md §9.5, plan.md §9 "TitleScene"): a skyline of hero
// building frames over the sky, the company sign, the 32-px title, then the
// kit buttons laid out with layout.ts:
//   Continue  only for a compatible autosave (version 1 + same dataHash), with
//             the save header `Day 7 · $1,240 · Lv 2` under the label;
//   New game  (with a save: Dialog `Overwrite your save?`);
//   Reset     (Dialog `Clear save, settings and tutorial progress?`: clears
//             pm.save.v1, pm.settings.v1 and pm.playtest.v1);
//   Credits   a one-screen text card (audio.md §10, first two bullets).
// A save that is not compatible is discarded with the toast "Save from an
// older build was reset". The sim is held (stepper.paused) while the Title is
// up; Continue / New game install the game's Sim with setSim, put its
// onboarding object in the registry for the HUD, and start City + HUD
// (nav.ts startWorld) and (re)start the music (startMusic is idempotent; it
// matters after game over → New game, where game:over stopped it). The first
// tap anywhere is the audio unlock: the AudioDirector's unlock() (registry
// 'audio', audio.md §3.3), called synchronously inside the pointerdown with
// nothing awaited before it, retried once in the same tap's pointerup if the
// context is still not running (on touch screens only pointerup / touchend
// are activation-triggering). Under the buttons a muted "tuning up…" line
// stays until the first 'audio:ready' (piano + bass decoded, or failed).
// Footer: the build stamp bottom-right (registry 'buildStamp', pinned by
// __pm.stamp), the seed bottom-left in debug builds. A phone in landscape gets
// the rotate card instead of the buttons.
import Phaser from 'phaser'
import type { AudioDirector } from '../audio/director.ts'
import {
  clearAllKeys,
  discardSave,
  loadGame,
  newGame,
  readSave,
  REG_ONBOARDING,
  STALE_SAVE_TEXT,
  type LoadedGame,
  type SaveCheck,
} from '../boot/autosave.ts'
import { startWorld } from '../boot/nav.ts'
import { getData, getStepper, REG, setSim } from '../boot/simBinding.ts'
import { debugEnabled, params } from '../debug/params.ts'
import { WORLD_ATLAS } from '../render/atlases.ts'
import { REG_AUDIO } from './BootScene.ts'
import { visibleRect } from '../render/BuildingView.ts'
import { Button } from '../ui/Button.ts'
import { Dialog } from '../ui/Dialog.ts'
import { buttonColumn, computeLayout, type Target } from '../ui/layout.ts'
import { addPanel } from '../ui/Panel.ts'
import { RotateCard, wantsRotateCard } from '../ui/RotateCard.ts'
import { addText, hasFont, LINE_H, textTop } from '../ui/text.ts'
import { Toast } from '../ui/Toast.ts'
import { FONT_SIZE_BIG, THEME } from '../ui/theme.ts'

/** Scene start data: {fresh} (game over → New game) / {stale} (bad Continue). */
export interface TitleData {
  fresh?: boolean
  stale?: boolean
}

export const OVERWRITE_TITLE = 'Overwrite your save?'
export const RESET_TITLE = 'Reset everything?'
export const RESET_TEXT = 'Clear save, settings and tutorial progress?'
export const TUNING_TEXT = 'tuning up…'

/**
 * audio.md §10 / CREDITS.md (Q52): the card shows the two Music bullets — the
 * CC BY 3.0 attribution of the samples in full (author, pre-renderer, licence)
 * — then the audio code, the font and the engine. One screen, ≤ 36 chars a
 * line (fits the 300-px card at W = 360).
 */
export const CREDITS_LINES: readonly string[] = [
  'Package Management Tycoon',
  '',
  'Music: "Semver Swing" — original',
  'composition, MIT',
  'Samples: FluidR3_GM SoundFont by',
  'Frank Wen, pre-rendered by Benjamin',
  'Gleitzman (midi-js-soundfonts),',
  'CC BY 3.0',
  'Audio: Tone.js, smplr, ZzFX (MIT)',
  'Font: m5x7 by Daniel Linssen (CC0)',
  'Engine: Phaser 4',
  '',
  'Tap to close',
]

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

/** sign_title is 48 tall (centred on signY); the title's 2nd line ends ~88 below. */
const SIGN_HALF_H = 24
const TITLE_BLOCK_H = 112

export class TitleScene extends Phaser.Scene {
  private unlocked = false
  private save: SaveCheck = { kind: 'none' }
  private stale = false
  private credits: Phaser.GameObjects.Container | null = null
  private dialog: Dialog | null = null
  private starting = false

  constructor() {
    super('Title')
  }

  init(data: TitleData = {}): void {
    this.unlocked = false
    this.credits = null
    this.dialog = null
    this.starting = false
    this.stale = data.stale === true
    if (data.fresh) discardSave()
  }

  create(): void {
    const { width: W, height: H } = this.scale
    // Back from a game (game over → Title, M2): nothing of it keeps running.
    for (const k of ['Garage', 'HUD', 'Warehouse', 'City']) {
      const sm = this.scene
      if (sm.isActive(k) || sm.isSleeping(k) || sm.isPaused(k)) sm.stop(k)
    }
    // The sim holds while the Title is up (Continue / New game resume it).
    getStepper(this).paused = true

    const data = getData(this)
    this.save = readSave(data)
    if (this.save.kind === 'stale') {
      discardSave()
      this.save = { kind: 'none' }
      this.stale = true
    }
    const L = computeLayout(
      W,
      H,
      (this.registry.get(REG.safeTop) as number | undefined) ?? 0,
      (this.registry.get(REG.safeBottom) as number | undefined) ?? 0,
      this.scale.zoom,
    )
    const font = hasFont(this)

    const hasSave = this.save.kind === 'ok'
    const labels = [
      ...(hasSave ? ['Continue'] : []),
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
    const tex = this.textures.get(WORLD_ATLAS)
    const base = (col[0]?.rect.y ?? Math.round(H * 0.6)) - 12
    let x = -24
    let skyTop = base
    for (const f of SKYLINE) {
      if (!tex.has(f)) continue
      const img = this.add.image(x, base, WORLD_ATLAS, f).setOrigin(0, 1)
      skyTop = Math.min(skyTop, Math.round(visibleRect(img).y))
      x += Math.round(img.width * 0.6)
      if (x > W) break
    }

    // Sign + title in the sky above it, centred in the space over the
    // skyline (a fixed 10 % left a wide empty band under the title).
    const signY = Math.max(
      Math.round(H * 0.1),
      Math.round((skyTop - TITLE_BLOCK_H) / 2) + SIGN_HALF_H,
    )
    if (tex.has('sign_title')) {
      const sign = this.add.image(
        Math.round(W / 2),
        signY,
        WORLD_ATLAS,
        'sign_title',
      )
      if (font) {
        // Company name (puns.json) on the board, right of its parcel emblem.
        const name = addText(this, 0, 0, data?.puns.companyName ?? '', {
          tint: THEME.textLight,
          maxWidth: sign.width - 44,
          align: 'center',
        })
        name.setPosition(
          Math.round(sign.x + 14 - name.width / 2),
          Math.round(signY - 4 - name.height / 2),
        )
      }
    }
    if (font) {
      const title = addText(this, 0, signY + 32, 'Package Management', {
        size: FONT_SIZE_BIG,
        tint: THEME.textLight,
        shadow: true,
      })
      const title2 = addText(this, 0, signY + 60, 'Tycoon', {
        size: FONT_SIZE_BIG,
        tint: THEME.gold,
        shadow: true,
      })
      for (const t of [title, title2]) t.setX(Math.round(W / 2 - t.width / 2))
    }

    const rotate = wantsRotateCard(W, H, this.game.device.os.desktop)
    if (!rotate) {
      labels.forEach((label, i) => this.button(col[i]!, label, i === 0))
      this.tuningLine(col[col.length - 1]!)
    }

    // Footer: build stamp bottom-right, seed bottom-left (debug).
    if (font) {
      // Above the home indicator (safe-area bottom), like the HUD's stamp.
      const footY = H - L.safeBottom - 14
      const stamp = addText(this, 0, footY, '', { tint: THEME.textMuted })
      const setStamp = (): void => {
        stamp.setText(String(this.registry.get(REG.buildStamp) ?? ''))
        stamp.setX(Math.round(W - 4 - stamp.width))
      }
      setStamp()
      this.registry.events.on('changedata-' + REG.buildStamp, setStamp)
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.registry.events.off('changedata-' + REG.buildStamp, setStamp)
      })
      if (debugEnabled())
        addText(this, 4, footY, `seed ${params().seed}`, {
          tint: THEME.textMuted,
        })
    }

    const toast = font ? new Toast(this, { lane: L.toast }) : null
    if (this.stale) toast?.show(STALE_SAVE_TEXT)

    if (rotate) new RotateCard(this, W, H).setOpen(true)
    const onResize = (): void => {
      if (!this.starting) this.scene.restart()
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      this.dialog?.destroy()
      this.dialog = null
    })

    // The first tap anywhere unlocks audio (city-view.md §9.5).
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.unlockAudio())
  }

  private button(t: Target, label: string, primary: boolean): Button {
    const isContinue = label === 'Continue' && this.save.kind === 'ok'
    const btn = new Button(this, {
      x: t.rect.x,
      y: t.rect.y,
      w: t.rect.w,
      h: t.rect.h,
      hit: t.hit,
      face: primary ? 'primary' : 'secondary',
      label: isContinue ? undefined : label,
      id: `title:${label.toLowerCase().replace(/\s+/g, '-')}`,
      onClick: () => this.onButton(label),
    })
    btn.setData('label', label)
    if (isContinue && this.save.kind === 'ok' && hasFont(this)) {
      // Two lines: `Continue` over the save header.
      const tint = primary ? THEME.textLight : THEME.textDark
      const top = textTop(0, t.rect.h, 2)
      const a = addText(this, 0, top, 'Continue', { tint })
      const b = addText(this, 0, top + LINE_H, this.save.header, { tint })
      for (const s of [a, b]) s.setX(Math.round((t.rect.w - s.width) / 2))
      btn.add([a, b])
    }
    return btn
  }

  private director(): AudioDirector | undefined {
    return this.registry.get(REG_AUDIO) as AudioDirector | undefined
  }

  /**
   * "tuning up…" under the buttons until piano + bass are decoded (audio.md
   * §3.2). The first 'audio:ready' marks the end of that group whether it
   * loaded or failed (then there is nothing left to wait for). Nothing under
   * ?audio=0 (disabled director).
   */
  private tuningLine(last: Target): void {
    const dir = this.director()
    if (!dir || !hasFont(this)) return
    let st: ReturnType<AudioDirector['state']>
    try {
      st = dir.state()
    } catch {
      return
    }
    if (st.disabled || (st.loaded.piano && st.loaded.bass)) return
    const t = addText(this, 0, last.rect.y + last.rect.h + 6, TUNING_TEXT, {
      tint: THEME.textMuted,
    })
    t.setX(Math.round((this.scale.width - t.width) / 2))
    t.setData('id', 'title:tuning')
    const onReady = (): void => {
      t.setVisible(false)
    }
    this.game.events.on('audio:ready', onReady)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.game.events.off('audio:ready', onReady),
    )
  }

  private onButton(label: string): void {
    if (this.starting || this.dialog?.isOpen()) return
    const data = getData(this)
    switch (label) {
      case 'Continue': {
        if (this.save.kind !== 'ok') return
        let game: LoadedGame
        try {
          game = loadGame(data, this.save.payload)
        } catch (err) {
          console.warn('continue: save would not load', err)
          discardSave()
          this.scene.restart({ stale: true } satisfies TitleData)
          return
        }
        this.begin(game)
        return
      }
      case 'New game': {
        const start = (): void => this.begin(newGame(data, this.newSeed()))
        if (this.save.kind !== 'ok') {
          start()
          return
        }
        this.dialog = new Dialog(this, {
          title: OVERWRITE_TITLE,
          text: `${this.save.header} will be lost.`,
          action: 'New game',
          destructive: true,
          id: 'title:overwrite',
          onConfirm: () => {
            this.dialog = null
            discardSave()
            start()
          },
          onCancel: () => {
            this.dialog = null
          },
        })
        return
      }
      case 'Reset':
        this.dialog = new Dialog(this, {
          title: RESET_TITLE,
          text: RESET_TEXT,
          action: 'Reset',
          destructive: true,
          id: 'title:reset',
          onConfirm: () => {
            this.dialog = null
            clearAllKeys()
            try {
              this.director()?.setMuted(false, false)
            } catch {
              // audio never blocks a reset
            }
            this.scene.restart()
          },
          onCancel: () => {
            this.dialog = null
          },
        })
        return
      case 'Credits':
        this.toggleCredits()
        return
    }
  }

  /** ?seed= keeps tests deterministic; otherwise a fresh time-based seed. */
  private newSeed(): number {
    const p = params()
    return p.seedFromUrl ? p.seed : Date.now() & 0x7fffffff
  }

  /** Install the game's Sim + tour state and start City with the HUD. */
  private begin(game: LoadedGame): void {
    if (this.starting) return
    this.starting = true
    setSim(this.game, game.sim)
    this.registry.set(REG_ONBOARDING, game.onboarding)
    getStepper(this).paused = false
    try {
      // Idempotent; deferred until the unlock. Restarts from bar 0 after a
      // game over (game:over stopped the band).
      this.director()?.startMusic()
    } catch {
      // audio never blocks a game start
    }
    startWorld(this, 'City')
  }

  private toggleCredits(): void {
    if (this.credits) {
      this.credits.destroy()
      this.credits = null
      return
    }
    if (!hasFont(this)) return
    const { width: W, height: H } = this.scale
    const w = Math.min(300, W - 24)
    const h = CREDITS_LINES.length * LINE_H + 16
    const x = Math.round((W - w) / 2)
    const y = Math.round((H - h) / 2)
    const panel = addPanel(this, 0, 0, w, h, 'ui_panel')
    const txt = addText(this, 8, 5, CREDITS_LINES.join('\n'), {
      tint: THEME.textDark,
    })
    this.credits = this.add.container(x, y, [panel, txt]).setDepth(100)
    panel.setInteractive()
    panel.on(Phaser.Input.Events.POINTER_UP, () => this.toggleCredits())
  }

  /**
   * The audio unlock (audio.md §3.3): director.unlock() synchronously inside
   * the first pointerdown — it resumes the shared context and Tone in the
   * gesture and starts the music once piano + bass are decoded; nothing
   * sounds before it. If the context still is not running when that tap's
   * pointerup arrives (iOS: touchstart is not activation-triggering,
   * touchend is), unlock() runs once more inside the pointerup.
   */
  private unlockAudio(): void {
    if (this.unlocked) return
    this.unlocked = true
    const dir = this.director()
    if (!dir) return
    try {
      void dir.unlock()
    } catch {
      // the director never throws; audio never blocks the Title
    }
    this.input.once(Phaser.Input.Events.POINTER_UP, () => {
      try {
        const st = dir.state()
        if (!st.disabled && st.ctxState !== 'running') void dir.unlock()
      } catch {
        // same
      }
    })
  }
}
