// Title card (city-view.md §9.5, plan.md §9 "TitleScene"; build 2: B2 §5).
// An overlay over the City running in ATTRACT mode: the Title installs the
// attract sim (registry cache JSON 'attract' = src/assets/attract.json, a
// Sim.snapshot() of seed 7 under the competent policy 24 min in, loaded with
// ignoreDataHash) with setSim(…, {attract: true, policy}), ticked at 1× by
// the stepper with the competent policy attached, then launches City with
// {attract: true} under itself (the City tours the lot and the live regions,
// no gestures, no HUD) and stays on top. The attract sim is never saved (the
// HUD, which owns the autosave, does not run) and never heard (the audio
// director skips it). ?attract=0 — or a missing / refused snapshot, or no
// policy (its chunk failed to load: the demo lane would stall) — keeps the
// old flow: no city, the plain skyline backdrop, the sim held. A long-idle
// Title recycles the demo (update(): AttractCamera attractRecycleDue — 30 min
// of attract sim time or a lost life → CityScene.recycleAttract re-installs
// the snapshot under the attract fade).
//
// The author's logo (texture 'logo', src/assets/logo.png 352×176 from
// tools/art/logo.ts) is drawn at 1:1 logical px, centred, its top at
// safeTop + 48 (B2 §5, Q-B2-1); the old text title is only a fallback when
// the texture is missing. Then the kit buttons laid out with layout.ts:
//   Continue  only for a compatible autosave (save.ts version + same
//             dataHash), with the save header `Day 7 · $1,240 · Lv 2`
//             (+ ` · Tycoon ✓` once the run's Golden Release shipped —
//             endless mode, B2 §3.4 / plan-build2 §8.6 task 3);
//   New game  (with a save: Dialog `Overwrite your save?`);
//   Reset     (Dialog `Clear save, settings and tutorial progress?`: clears
//             the save, settings and playtest keys);
//   Credits   a one-screen text card, MODAL (report §6.11): a full-screen
//             catcher under it blocks the buttons (Reset can no longer open
//             over it); a tap anywhere or Esc closes it.
// A save that is not compatible is discarded with the toast "Save from an
// older build was reset". Continue / New game put the run's onboarding object
// in the registry for the HUD, (re)start the music (startMusic is
// idempotent; it matters after game over → New game, where game:over
// stopped it) and, over the attract city, call CityScene.endAttract(): under
// its 300-ms fade (150 out, 150 in) setSim(real) → City.syncAll() + the
// ground re-baked for the real lock state, the HUD launches above the City
// and the Title stops. Without the attract city: setSim + startWorld as in
// build 1. The first tap anywhere is the audio unlock: the AudioDirector's
// unlock() (registry 'audio', audio.md §3.3), called synchronously inside
// the pointerdown with nothing awaited before it, retried once in the same
// tap's pointerup if the context is still not running (on touch screens only
// pointerup / touchend are activation-triggering). Under the buttons a muted
// "tuning up…" line stays until the first 'audio:ready' (piano + bass
// decoded, or failed). Footer: the build stamp bottom-right (registry
// 'buildStamp', pinned by __pm.stamp), the seed bottom-left in debug builds.
// A phone in landscape gets the rotate card instead of the buttons.
import Phaser from 'phaser'
import type { AudioDirector } from '../audio/director.ts'
import {
  clearAllKeys,
  discardSave,
  loadGame,
  newGame,
  readSave,
  REG_ONBOARDING,
  saveHeader,
  STALE_SAVE_TEXT,
  type LoadedGame,
  type SaveCheck,
} from '../boot/autosave.ts'
import {
  ATTRACT_FADE_MS,
  FADE_RGB,
  startWorld,
  type CityStartData,
} from '../boot/nav.ts'
import {
  getAttractSim,
  getData,
  getStepper,
  REG,
  setSim,
} from '../boot/simBinding.ts'
import { debugEnabled, params } from '../debug/params.ts'
import { ATTRACT_KEY, LOGO_KEY, WORLD_ATLAS } from '../render/atlases.ts'
import { attractRecycleDue, type AttractBase } from '../render/AttractCamera.ts'
import { visibleRect } from '../render/BuildingView.ts'
import { Sim, type PolicyFactory } from '../sim/sim.ts'
import { Button, CONTENT_PAD } from '../ui/Button.ts'
import { Dialog } from '../ui/Dialog.ts'
import { buttonColumn, computeLayout, type Target } from '../ui/layout.ts'
import { addPanel } from '../ui/Panel.ts'
import { RotateCard, wantsRotateCard } from '../ui/RotateCard.ts'
import { addText, hasFont, LINE_H, textTop } from '../ui/text.ts'
import { Toast } from '../ui/Toast.ts'
import { FONT_SIZE_BIG, THEME } from '../ui/theme.ts'
import { REG_AUDIO } from './BootScene.ts'
import type { CityScene } from './CityScene.ts'

/** Scene start data: {fresh} (game over → New game) / {stale} (bad Continue). */
export interface TitleData {
  fresh?: boolean
  stale?: boolean
}

export const OVERWRITE_TITLE = 'Overwrite your save?'
export const RESET_TITLE = 'Reset everything?'
export const RESET_TEXT = 'Clear save, settings and tutorial progress?'
export const TUNING_TEXT = 'tuning up…'
/** The logo's top edge below the safe-area top (B2 §5). */
export const LOGO_TOP = 48
/** The logo texture's size (tools/art/logo.ts LOGO_W × LOGO_H). */
export const LOGO_H = 176
/** Data 'id' of the logo image (e2e). */
export const LOGO_ID = 'title:logo'

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

// Hero frames for the plain backdrop (?attract=0): 1x1 and 2x2 only; a frame
// that would reach up into the logo on a short screen is left out.
const SKYLINE = [
  'dt_semver_bank',
  'hr_pizza',
  'hr_callback_court',
  'dt_cache_cafe',
  'dt_scope_offices',
  'hr_is_odd_store',
  'hr_async_arms',
]

/** The Credits card and its full-screen catcher over everything else. */
const CREDITS_DEPTH = 100

export class TitleScene extends Phaser.Scene {
  private unlocked = false
  private save: SaveCheck = { kind: 'none' }
  private stale = false
  private credits: Phaser.GameObjects.Container | null = null
  private creditsCatcher: Phaser.GameObjects.Zone | null = null
  private dialog: Dialog | null = null
  private starting = false
  /** The Title runs over the attract city (B2 §5). */
  private attractOn = false
  /** A recycle could not re-install the snapshot: stop trying. */
  private recycleFailed = false

  constructor() {
    super('Title')
  }

  init(data: TitleData = {}): void {
    this.unlocked = false
    this.credits = null
    this.creditsCatcher = null
    this.dialog = null
    this.starting = false
    this.attractOn = false
    this.stale = data.stale === true
    if (data.fresh) discardSave()
  }

  create(): void {
    const { width: W, height: H } = this.scale
    // Back from a game (game over → Title, M2): nothing of it keeps running.
    const sm = this.scene
    for (const k of ['Garage', 'HUD', 'Warehouse']) {
      if (sm.isActive(k) || sm.isSleeping(k) || sm.isPaused(k)) sm.stop(k)
    }
    this.attractOn = this.startAttract()
    if (!this.attractOn) {
      if (sm.isActive('City') || sm.isSleeping('City') || sm.isPaused('City'))
        sm.stop('City')
      // The sim holds while the Title is up (Continue / New game resume it).
      getStepper(this).paused = true
    }

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

    // The plain backdrop (no attract city): hero frames on one baseline.
    const logoTop = L.safeTop + LOGO_TOP
    if (!this.attractOn)
      this.skyline(
        W,
        col[0]?.rect.y ?? Math.round(H * 0.6),
        logoTop + LOGO_H + 8,
      )
    this.logo(W, logoTop)

    const rotate = wantsRotateCard(W, H, this.game.device.os.desktop)
    if (!rotate) {
      labels.forEach((label, i) => this.button(col[i]!, label, i === 0))
      this.tuningLine(col[col.length - 1]!)
    }

    // Footer: build stamp bottom-right, seed bottom-left (debug). Over the
    // moving city the footer lines are light with a drop shadow.
    const footTint = this.attractOn ? THEME.textLight : THEME.textMuted
    if (font) {
      // Above the home indicator (safe-area bottom), like the HUD's stamp.
      const footY = H - L.safeBottom - 14
      const stamp = addText(this, 0, footY, '', {
        tint: footTint,
        shadow: this.attractOn,
      })
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
          tint: footTint,
          shadow: this.attractOn,
        })
    }

    const toast = font ? new Toast(this, { lane: L.toast }) : null
    if (this.stale) toast?.show(STALE_SAVE_TEXT)

    if (rotate) new RotateCard(this, W, H).setOpen(true)
    // restart({}) — a bare restart() keeps the last start data (Phaser's
    // Systems.start only overwrites settings.data when data is passed), so a
    // {stale: true} Title would toast again on every rotation.
    const onResize = (): void => {
      if (!this.starting) this.scene.restart({} satisfies TitleData)
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    const kb = this.input.keyboard
    const onEsc = (): void => {
      if (this.credits) this.closeCredits()
    }
    kb?.on('keydown-ESC', onEsc)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      kb?.off('keydown-ESC', onEsc)
      this.dialog?.destroy()
      this.dialog = null
      this.credits = null
      this.creditsCatcher = null
    })

    // The first tap anywhere unlocks audio (city-view.md §9.5).
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.unlockAudio())
  }

  // ---------------------------------------------------------------- attract (B2 §5)

  /**
   * Install the attract sim and run the City in attract mode under the
   * Title. A running attract city is kept (the Title restarts on resize and
   * Reset). False → the old flow: ?attract=0, or no usable snapshot.
   */
  private startAttract(): boolean {
    if (!params().attract) return false
    const sm = this.scene
    if (this.attractCity() && getAttractSim(this)) {
      sm.bringToTop()
      return true
    }
    // Without the competent policy the demo lane stalls within a minute
    // (a failed policy chunk): the plain backdrop instead.
    const factory = this.registry.get(REG.createPolicy) as
      | PolicyFactory
      | null
      | undefined
    if (!factory) {
      console.warn('title: no policy for the attract city — plain backdrop')
      return false
    }
    if (!this.installAttractSim(factory)) return false
    const stepper = getStepper(this)
    stepper.paused = false
    stepper.speed = 1
    // start() restarts a running City (game over → Title) in attract mode.
    sm.launch('City', { attract: true } satisfies CityStartData)
    sm.bringToTop()
    return true
  }

  /**
   * Install a fresh attract Sim from the snapshot with the competent policy
   * (setSim attract: true). False when the snapshot is unusable.
   */
  private installAttractSim(factory: PolicyFactory): boolean {
    const sim = this.loadAttractSim()
    if (!sim) return false
    setSim(this.game, sim, {
      attract: true,
      policy: factory(sim, 'competent'),
    })
    return true
  }

  /**
   * A long-idle Title (B2 §5): once the demo's policy ships the Golden
   * Release (M9: the cap is the last level, so only a Victory escalates) the
   * malware share keeps climbing (parcels.json postVictoryPerDay), and the
   * demo city starts losing lives and, hours later, would freeze on game
   * over. Every ATTRACT_RECYCLE_S of attract sim time, or on its first lost
   * life / game over, the City re-installs the snapshot under its fade.
   */
  update(): void {
    if (!this.attractOn || this.starting) return
    const sim = getAttractSim(this)
    const base = this.attractBase()
    if (!sim || !base || !attractRecycleDue(sim.state, base)) return
    const factory = this.registry.get(REG.createPolicy) as
      | PolicyFactory
      | null
      | undefined
    if (!factory || this.recycleFailed) return
    this.attractCity()?.recycleAttract(() => {
      if (this.installAttractSim(factory)) return
      // Never a fade loop: the old demo keeps running.
      this.recycleFailed = true
      console.warn('title: the attract snapshot would not reload')
    })
  }

  /** The snapshot's tick and lives (what a fresh attract sim starts from). */
  private attractBase(): AttractBase | null {
    const snap = this.cache.json.get(ATTRACT_KEY) as
      | { state?: { tick?: unknown; economy?: { lives?: unknown } } }
      | null
      | undefined
    const tick = snap?.state?.tick
    const lives = snap?.state?.economy?.lives
    if (typeof tick !== 'number' || typeof lives !== 'number') return null
    return { tick, lives }
  }

  /** The attract snapshot from the Preload cache, as a Sim; null if unusable. */
  private loadAttractSim(): Sim | null {
    const snap = this.cache.json.get(ATTRACT_KEY) as unknown
    if (snap === undefined || snap === null) {
      console.warn('title: no attract snapshot — plain backdrop')
      return null
    }
    try {
      return Sim.load(getData(this), snap, { ignoreDataHash: true })
    } catch (err) {
      console.warn('title: the attract snapshot would not load', err)
      return null
    }
  }

  /** The City scene while it runs in attract mode, else null. */
  private attractCity(): CityScene | null {
    const sm = this.scene
    if (!sm.isActive('City')) return null
    const city = sm.get('City') as CityScene
    return city.attract ? city : null
  }

  // ---------------------------------------------------------------- layout

  /** The author's logo at 1:1, centred, top at `top`; the text title as fallback. */
  private logo(W: number, top: number): void {
    if (this.textures.exists(LOGO_KEY)) {
      const img = this.add.image(0, top, LOGO_KEY).setOrigin(0, 0)
      img.setX(Math.round((W - img.width) / 2))
      img.setData('id', LOGO_ID)
      return
    }
    if (!hasFont(this)) return
    const title = addText(this, 0, top, 'Package Management', {
      size: FONT_SIZE_BIG,
      tint: THEME.textLight,
      shadow: true,
    })
    const title2 = addText(this, 0, top + 28, 'Tycoon', {
      size: FONT_SIZE_BIG,
      tint: THEME.gold,
      shadow: true,
    })
    for (const t of [title, title2]) t.setX(Math.round(W / 2 - t.width / 2))
  }

  /**
   * Hero building frames standing on one baseline above the buttons; one
   * whose opaque top would rise above `minTop` (into the logo) is skipped.
   */
  private skyline(W: number, buttonsTop: number, minTop: number): void {
    const tex = this.textures.get(WORLD_ATLAS)
    const base = buttonsTop - 12
    let x = -24
    for (const f of SKYLINE) {
      if (!tex.has(f)) continue
      const img = this.add.image(x, base, WORLD_ATLAS, f).setOrigin(0, 1)
      if (visibleRect(img).y < minTop) {
        img.destroy()
        continue
      }
      x += Math.round(img.width * 0.6)
      if (x > W) break
    }
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
      // Two lines: `Continue` over the save header (M9: ` · Tycoon ✓` for
      // an endless-mode save, its `Lv 5` dropped when the line is too wide).
      const tint = primary ? THEME.textLight : THEME.textDark
      const top = textTop(0, t.rect.h, 2)
      const a = addText(this, 0, top, 'Continue', { tint })
      const b = addText(this, 0, top + LINE_H, '', { tint })
      b.setText(
        saveHeader(this.save.payload, {
          maxW: t.rect.w - 2 * CONTENT_PAD,
          measure: (x) => b.setText(x).width,
        }),
      )
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
      tint: this.attractOn ? THEME.textLight : THEME.textMuted,
      shadow: this.attractOn,
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
    // The Credits card is modal (report §6.11): nothing opens over it.
    if (this.starting || this.dialog?.isOpen() || this.credits) return
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
            this.scene.restart({} satisfies TitleData)
          },
          onCancel: () => {
            this.dialog = null
          },
        })
        return
      case 'Credits':
        this.openCredits()
        return
    }
  }

  /** ?seed= keeps tests deterministic; otherwise a fresh time-based seed. */
  private newSeed(): number {
    const p = params()
    return p.seedFromUrl ? p.seed : Date.now() & 0x7fffffff
  }

  /**
   * Install the game's Sim + tour state and bring up City with the HUD.
   * Over the attract city the City swaps under its own fade (endAttract);
   * the Title fades with it and stops once the HUD is launched.
   */
  private begin(game: LoadedGame): void {
    if (this.starting) return
    this.starting = true
    this.closeCredits()
    this.registry.set(REG_ONBOARDING, game.onboarding)
    try {
      // Idempotent; deferred until the unlock. Restarts from bar 0 after a
      // game over (game:over stopped the band).
      this.director()?.startMusic()
    } catch {
      // audio never blocks a game start
    }
    const city = this.attractOn ? this.attractCity() : null
    if (city?.endAttract(() => this.enterGame(game))) {
      this.cameras.main.fadeOut(
        ATTRACT_FADE_MS,
        FADE_RGB[0],
        FADE_RGB[1],
        FADE_RGB[2],
      )
      return
    }
    setSim(this.game, game.sim)
    getStepper(this).paused = false
    startWorld(this, 'City')
  }

  /** endAttract's swap, under the City's fade: the player's sim, the HUD, no Title. */
  private enterGame(game: LoadedGame): void {
    setSim(this.game, game.sim)
    getStepper(this).paused = false
    const sm = this.scene
    sm.launch('HUD')
    sm.bringToTop('HUD')
    sm.stop()
  }

  /** The Credits card (modal, report §6.11): a catcher under it takes every tap. */
  private openCredits(): void {
    if (this.credits || !hasFont(this)) return
    const { width: W, height: H } = this.scale
    const w = Math.min(300, W - 24)
    const h = CREDITS_LINES.length * LINE_H + 16
    const x = Math.round((W - w) / 2)
    const y = Math.round((H - h) / 2)
    // Close on pointerup (a tap = down + up on a Button, so the button under
    // the catcher never sees half a tap once the card is gone).
    const catcher = this.add
      .zone(0, 0, W, H)
      .setOrigin(0, 0)
      .setDepth(CREDITS_DEPTH)
      .setInteractive()
    catcher.on(Phaser.Input.Events.POINTER_UP, () => this.closeCredits())
    catcher.setData('id', 'title:credits-catcher')
    const panel = addPanel(this, 0, 0, w, h, 'ui_panel')
    const txt = addText(this, 8, 5, CREDITS_LINES.join('\n'), {
      tint: THEME.textDark,
    })
    this.credits = this.add
      .container(x, y, [panel, txt])
      .setDepth(CREDITS_DEPTH + 1)
    this.credits.setData('id', 'title:credits')
    panel.setInteractive()
    panel.on(Phaser.Input.Events.POINTER_UP, () => this.closeCredits())
    this.creditsCatcher = catcher
  }

  private closeCredits(): void {
    this.credits?.destroy()
    this.credits = null
    this.creditsCatcher?.destroy()
    this.creditsCatcher = null
  }

  /** Whether the Credits card is open (e2e). */
  creditsOpen(): boolean {
    return this.credits !== null
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
