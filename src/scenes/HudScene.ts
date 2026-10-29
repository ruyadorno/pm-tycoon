// HudScene `HUD` (city-view.md §4, §8.1, §9.1, §9.7, §10, §11.2; plan.md §9):
// the persistent HUD over City / Warehouse. It never sleeps and never zooms;
// everything is laid out from L = computeLayout(W, H, safeTop, safeBottom,
// zoom) and re-laid out on scale resize and safe-area changes.
//
//   top bar      money (300 ms count tween, red flash on a negative delta,
//                floats), 5 life slots, mood face; level label + bar
//                (`$1,240 / $2,000`, `· Lv 3 coming soon` at the cap), shield
//                (2 Hz poll of laneStats, ShieldPopover on tap)
//   ticker       Ticker (Day cell + scrolling news, PAUSED blink)
//   toast lane   kit Toast (also pm:toast) + pm:tooltip bubbles
//   follow strip FollowStrip while City follows a vehicle (pm:follow)
//   chips        HQ + live regions + the next locked one → pm:panTo; NEW badge
//   bottom bar   ❚❚|1×|2× (stepper.speed, never game.pause), sax mute,
//                Warehouse/City (pm:goto) with hold badge / pulse / red,
//                Garage (toggleGarage) with the ! / + badges, build stamp
//   cards        Paused card (auto-pause on HIDDEN / pagehide), rotate card,
//                Onboarding steps 1-3, DistrictPanel (pm:select district),
//                LostLifeCard and GameOverCard (M2)
//
// M2 (city-view §3.3, §4.1, §4.3, §9.2-§9.4): life:lost fuses the rightmost
// lit bomb slot, flashes the screen red (200 ms), shakes the top bar 2 px,
// tickers the incident, appends the label to onboarding.wanted and opens
// the lost-life card LOST_LIFE_DELAY_MS later; game:over opens the game-over
// screen instead (a life:lost while it is open is dropped). Modal cards hold
// the sim through `holds` (stepper.paused = any hold: lostLife, gameOver,
// hidden, rotate) so one card closing never resumes under another. The
// Warehouse button's badge / pulse / red are derived from sim state on every
// relevant event and at 2 Hz; the scripted first flag gets the red toast,
// the bouncing arrow over the button and the 10-s follow-up (§9.2); the
// first Toss of a run shows puns.json tossHint once.
//
// Sim events come through bindSim (attached while awake — always — and moved
// on a Sim swap, with syncAll on WAKE / swap). The autosave timer runs from
// update(); HIDDEN and pagehide save immediately. Keyboard: Space, 1, 2, 4
// (debug), W, G, Esc through the shared claimKey stack (src/ui/Sheet.ts).
import Phaser from 'phaser'
import {
  Autosave,
  discardSave,
  getOnboarding,
  readSettings,
  REG_ONBOARDING,
  REG_PENDING_TOAST,
  writeSettings,
} from '../boot/autosave.ts'
import { EV_GOTO, EV_VIEW, type WorldView } from '../boot/nav.ts'
import {
  bindSim,
  getData,
  getSim,
  getStepper,
  getViewSim,
  REG,
} from '../boot/simBinding.ts'
import type { Stepper } from '../boot/stepper.ts'
import type { GameData } from '../data/types.ts'
import { mountOverlay } from '../debug/overlay.ts'
import { debugEnabled, params } from '../debug/params.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { buildingSprite } from '../render/frames.ts'
import { footprintAnchor, originX } from '../render/iso.ts'
import { roomPlacement } from '../render/warehouse/RoomLayout.ts'
import type { LifeLostPayload, SimEventPayloads } from '../sim/events.ts'
import type { OnboardingSave } from '../sim/save.ts'
import type { VehicleType } from '../sim/types.ts'
import type { ViewSim } from '../sim/view-api.ts'
import { Button } from '../ui/Button.ts'
import { DistrictPanel } from '../ui/DistrictPanel.ts'
import { FollowStrip } from '../ui/FollowStrip.ts'
import {
  addTapZone,
  chipEntries,
  detectionColour,
  floatsGold,
  garageAlert,
  isEarned,
  levelLabel,
  levelProgress,
  LIVES_TAP_TEXT,
  lockedRegionText,
  moneyTapText,
  moodFace,
  newlyAffordableTypes,
  nextUnlockLine,
  setZoneRect,
  speedSegment,
  TAP_PX,
  trendGlyph,
  type ChipEntry,
} from '../ui/hudKit.ts'
import { GameOverCard, gameOverModel } from '../ui/GameOverCard.ts'
import {
  computeLayout,
  overlaps,
  type Layout,
  type Rect,
} from '../ui/layout.ts'
import { LivesRow } from '../ui/LivesRow.ts'
import {
  LOST_LIFE_DELAY_MS,
  LostLifeCard,
  lostLifeModel,
} from '../ui/LostLifeCard.ts'
import {
  addWanted,
  FIRST_FLAG_CITY_TEXT,
  FIRST_FLAG_ROOM_TEXT,
  FLAG_FOLLOW_TEXT,
  firstFlagText,
  isFlagFunnelText,
  normaliseOnboarding,
  Onboarding,
  STEP2_DELAY_MS,
  step2Model,
  step2Text,
} from '../ui/Onboarding.ts'
import { addBar, addPanel, BAR_H, setBarFill } from '../ui/Panel.ts'
import { PausedCard } from '../ui/PausedCard.ts'
import { RotateCard, wantsRotateCard } from '../ui/RotateCard.ts'
import {
  claimKey,
  keyClaimed,
  modalCount,
  popModal,
  pushModal,
} from '../ui/Sheet.ts'
import { ShieldPopover } from '../ui/ShieldPopover.ts'
import {
  addText,
  CAP_TOP,
  formatMoney,
  formatMoneyDelta,
  formatPct,
  textTop,
} from '../ui/text.ts'
import { PALETTE, THEME } from '../ui/theme.ts'
import {
  dailyLine,
  defusedLine,
  incidentLine,
  stallLine,
  Ticker,
} from '../ui/Ticker.ts'
import { Toast, toastDuration } from '../ui/Toast.ts'
import { GARAGE_SHEET_ID, toggleGarage } from './GarageSheet.ts'

// Game events (plan.md §5; the M1 cross-scene contract).
export const EV_SELECT = 'pm:select'
export const EV_FOLLOW = 'pm:follow'
export const EV_PAN_TO = 'pm:panTo'
export const EV_TOOLTIP = 'pm:tooltip'
export const EV_AUDIO_MUTED = 'audio:muted'

type SelectPayload = {
  kind: 'district' | 'locked' | 'building' | 'vehicle'
  id: string | number
}
type FollowPayload = { vehicleId: number | null }
type TooltipPayload = { text: string; x: number; y: number }

/** The parts of the M3 AudioDirector (registry 'audio') the HUD calls. */
interface AudioDirectorLike {
  setMuted?(muted: boolean, persist?: boolean): void
  isMuted?(): boolean
  resumeAfterPause?(): unknown
}

export const MONEY_TWEEN_MS = 300
export const MONEY_FLASH_MS = 300
export const POLL_MS = 500
export const FLOAT_MS = 900
export const FLOAT_RISE = 12
export const FLOAT_POOL = 4
export const TOOLTIP_MS = 2000
export const CHIP_FLASH_MS = 300
/** A chip stays active until the camera centre is this far from its region. */
export const CHIP_ACTIVE_RADIUS = 360
// city-view §4.1 says 0.85; at that alpha the world's district labels and
// sign boards (dark text on cream) read through the bar and collide with the
// money / lives / mood readouts (UX review), so the top bar is as opaque as
// the bottom bar.
const TOP_ALPHA = 0.94
const BOTTOM_ALPHA = 0.92
const MOOD_ROW_H = 30
const MOOD_POP_W = 200

// M2 (city-view §3.3, §9.2).
/** Full-screen red flash on life:lost: alpha 0.25 → 0 over 200 ms. */
export const FLASH_MS = 200
export const FLASH_ALPHA = 0.25
/** The top bar shakes 2 px for 200 ms on life:lost. */
export const TOP_SHAKE_MS = 200
export const TOP_SHAKE_PX = 2
/** The scripted-flag toast and the tossHint toast stay up 6 s. */
export const HINT_TOAST_MS = 6000
/** Follow-up toast if the warehouse was not opened 10 s after the first flag. */
export const FLAG_FOLLOW_MS = 10_000
/** The bouncing arrow over the Warehouse button: 1-px bob every 300 ms. */
const FLAG_ARROW_BOB_MS = 300

type Hold = 'lostLife' | 'gameOver' | 'hidden' | 'rotate'

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Depth bands inside the HUD scene. */
const D = {
  bar: 10,
  barContent: 11,
  flagArrow: 33,
  follow: 25,
  bottom: 30,
  bottomContent: 31,
  // Above the bottom bar: a chip's 44-px hit band reaches 10 px into the
  // bar's top padding (layout.ts chip.hitY/hitH), where the bar's
  // tap-swallowing background would otherwise win the top-only hit test.
  chips: 32,
  floats: 40,
  popScrim: 6999,
  pop: 7000,
  tooltip: 9500,
  flash: 19000,
} as const

interface Chip {
  entry: ChipEntry
  bg: Phaser.GameObjects.NineSlice
  parts: Phaser.GameObjects.GameObject[]
  zone: Phaser.GameObjects.Zone
  badge: Phaser.GameObjects.Image | null
  x: number
  w: number
}

interface MoneyFloat {
  text: Phaser.GameObjects.BitmapText
  tween: Phaser.Tweens.Tween | null
  startedAt: number
}

export class HudScene extends Phaser.Scene {
  private vs!: ViewSim
  private gd!: GameData
  private stepper!: Stepper
  private L!: Layout
  private view: WorldView = 'city'

  // top bar
  private topBg!: Phaser.GameObjects.NineSlice
  private moneyIcon!: Phaser.GameObjects.Image
  private moneyText!: Phaser.GameObjects.BitmapText
  private lives!: LivesRow
  private moodText!: Phaser.GameObjects.BitmapText
  private moodIcon!: Phaser.GameObjects.Image
  private levelText!: Phaser.GameObjects.BitmapText
  private levelTrack!: Phaser.GameObjects.NineSlice
  private levelFill!: Phaser.GameObjects.NineSlice
  private levelBarText!: Phaser.GameObjects.BitmapText
  private shieldIcon!: Phaser.GameObjects.Image
  private shieldText!: Phaser.GameObjects.BitmapText
  private zones: Record<
    'money' | 'lives' | 'mood' | 'level' | 'shield',
    Phaser.GameObjects.Zone
  > | null = null
  private shownMoney = 0
  private moneyTween: Phaser.Tweens.Tween | null = null
  private moneyFlash: Phaser.Time.TimerEvent | null = null
  private floats: MoneyFloat[] = []
  private levelFrac = -1

  private ticker!: Ticker
  private toast!: Toast
  private follow!: FollowStrip
  private onboarding!: Onboarding
  private paused!: PausedCard
  private rotate!: RotateCard
  private autosave!: Autosave
  private district: DistrictPanel | null = null
  private shield: ShieldPopover | null = null
  private lostCard!: LostLifeCard
  private overCard!: GameOverCard

  // chips
  private chipsRoot!: Phaser.GameObjects.Container
  private chips: Chip[] = []
  private chipKey = ''
  private chipsDirty = false
  private moodDirty = false
  private moodFrame = -1
  private chipScroll = 0
  private chipRowW = 0
  private chipDrag: { id: number; x0: number; s0: number } | null = null
  private activeChip: string | null = null
  private newChips = new Set<string>()

  // bottom bar
  private bottomBg!: Phaser.GameObjects.NineSlice
  private speedBtns: Button[] = []
  private muteBtn!: Button
  private whBtn!: Button
  private garageBtn!: Button
  private stamp!: Phaser.GameObjects.BitmapText
  private segment = -1
  private muted = false
  private lastRunSpeed: 1 | 2 | 4 = 1
  private plusPending = false
  private seenTypes = new Set<VehicleType>()

  // popovers
  private moodPop: Phaser.GameObjects.Container | null = null
  private moodScrim: Phaser.GameObjects.Zone | null = null
  private tip: Phaser.GameObjects.Container | null = null
  private tipTimer: Phaser.Time.TimerEvent | null = null

  // state
  private pollAt = 0
  private autoPaused = false
  private rotatePaused = false
  private dayDelivered = 0
  private dayEarned = 0
  private dayPayroll = 0
  private simDaily = false
  /** Step 3 is due but waits for an on-screen building with waiting parcels. */
  private step3Armed = false

  // M2
  /** Why the sim is held (stepper.paused = holds.size > 0). */
  private holds = new Set<Hold>()
  private lostQueue: LifeLostPayload[] = []
  private lostTimer: Phaser.Time.TimerEvent | null = null
  private overTimer: Phaser.Time.TimerEvent | null = null
  private flash!: Phaser.GameObjects.Rectangle
  private flashUntil = 0
  private topShake: { until: number; base: number[] } | null = null
  /** Last applied Warehouse button state (city|held|red). */
  private whKey = ''
  private flagArrow!: Phaser.GameObjects.Image
  /** The scripted-flag hint is up (arrow over the Warehouse button). */
  private flagHint = false
  private flagFollow: Phaser.Time.TimerEvent | null = null
  private step2Timer: Phaser.Time.TimerEvent | null = null
  /**
   * A save requested from a sim event handler, run from update() after the
   * tick ('final' = the game-over save, after which autosave stops): a
   * snapshot taken inside tick() would catch half-updated state.
   */
  private saveSoon: 'save' | 'final' | null = null
  /** Labels of flagged / held parcels (a tossed parcel may be gone from state). */
  private heldLabels = new Map<number, string>()

  constructor() {
    super('HUD')
  }

  init(): void {
    this.zones = null
    this.floats = []
    this.chips = []
    this.chipKey = ''
    this.chipsDirty = false
    this.moodDirty = false
    this.chipScroll = 0
    this.chipDrag = null
    this.activeChip = null
    this.newChips = new Set()
    this.speedBtns = []
    this.segment = -1
    this.plusPending = false
    this.seenTypes = new Set()
    this.moodPop = null
    this.moodScrim = null
    this.tip = null
    this.tipTimer = null
    this.moneyTween = null
    this.moneyFlash = null
    this.levelFrac = -1
    this.pollAt = 0
    this.autoPaused = false
    this.rotatePaused = false
    this.dayDelivered = 0
    this.dayEarned = 0
    this.dayPayroll = 0
    this.simDaily = false
    this.step3Armed = false
    this.district = null
    this.shield = null
    this.holds = new Set()
    this.lostQueue = []
    this.lostTimer = null
    this.overTimer = null
    this.flashUntil = 0
    this.topShake = null
    this.whKey = ''
    this.flagHint = false
    this.flagFollow = null
    this.step2Timer = null
    this.saveSoon = null
    this.heldLabels = new Map()
  }

  create(): void {
    this.vs = getViewSim(this)
    this.gd = getData(this)
    this.stepper = getStepper(this)
    this.L = this.computeL()
    this.view = this.awakeView() ?? 'city'

    // Settings: persisted running speed and mute (pm.settings.v1).
    const settings = readSettings()
    this.lastRunSpeed = settings.speed
    // The game resumes at the persisted running speed (pause is not saved).
    this.stepper.speed = settings.speed
    const dir = this.director()
    this.muted = dir?.isMuted?.() ?? (settings.muted || params().mute)

    // Onboarding state lives in the registry (autosave.ts writes it).
    const ob = normaliseOnboarding(this.registry.get(REG_ONBOARDING))
    this.registry.set(REG_ONBOARDING, ob)

    this.buildTopBar()
    this.ticker = new Ticker(this, this.L, {
      fillers: this.gd.puns.tickerFiller,
    })
    this.ticker.setDepth(D.bar)
    this.toast = new Toast(this, { lane: this.toastLane(), listen: true })
    this.buildChips()
    this.buildBottomBar()
    this.follow = new FollowStrip(this, this.L, {
      onClose: () => {
        this.follow.hide()
        this.game.events.emit(EV_FOLLOW, { vehicleId: null })
      },
    })
    this.follow.root.setDepth(D.follow)
    this.onboarding = new Onboarding(this, this.L, ob)
    this.paused = new PausedCard(this, this.L, {
      onGesture: () => {
        try {
          void this.director()?.resumeAfterPause?.()
        } catch {
          // audio never blocks the resume
        }
      },
      onResume: () => this.resumeFromCard(),
    })
    this.rotate = new RotateCard(this, this.L.W, this.L.H)
    this.district = new DistrictPanel(this, this.L, this.vs)
    this.shield = new ShieldPopover(this, this.L, this.vs)
    this.flash = this.add
      .rectangle(0, 0, this.L.W, this.L.H, THEME.danger, 1)
      .setOrigin(0, 0)
      .setDepth(D.flash)
      .setVisible(false)
    this.flagArrow = this.add
      .image(0, 0, UI_ATLAS, 'arrow')
      .setOrigin(0, 0)
      .setDepth(D.flagArrow)
      .setVisible(false)
    this.lostCard = new LostLifeCard(this, this.L, {
      onOpenWarehouse: (highlight) => this.onLostCardClosed(highlight, true),
      onContinue: () => this.onLostCardClosed(null, false),
    })
    this.overCard = new GameOverCard(this, this.L, {
      onNewGame: () => this.newGame(),
      onContinue: this.gd.economy.continueWithOneLife
        ? () => this.continueWithOneLife()
        : null,
    })

    this.autosave = new Autosave({
      getSim: () => getSim(this) ?? null,
      getOnboarding: () =>
        (this.registry.get(REG_ONBOARDING) as OnboardingSave | undefined) ??
        null,
      build: String(this.registry.get(REG.buildStamp) ?? __BUILD_STAMP__),
      now: () => Date.now(),
      onError: (msg) => this.toast.show(msg, true),
    })

    if (debugEnabled())
      mountOverlay(this, 2, this.L.toast.y + this.L.toast.h + 2)

    this.bindEvents()
    this.syncAll()
    this.updateRotate()

    // A fresh game starts with the opening ticker line (levels.json L1).
    if (this.vs.tick < 10 && this.vs.level === 1)
      this.ticker.push(this.gd.levels[0]?.ticker ?? '', 'level')
    const pending = this.registry.get(REG_PENDING_TOAST) as string | undefined
    if (pending) {
      this.registry.remove(REG_PENDING_TOAST)
      this.toast.show(pending)
    }
    this.startTour()
  }

  update(time: number, delta: number): void {
    const vs = this.vs
    const st = this.stepper
    if (this.chipsDirty) this.rebuildChips()
    // Re-read an open mood popover, never in the frame it was built (see
    // refreshChips on same-frame create + destroy of interactive objects).
    if (this.moodDirty && this.game.loop.frame !== this.moodFrame) {
      this.moodDirty = false
      if (this.moodPop) this.openMood()
    }
    // Speed segment + PAUSED from the stepper (also follows __pm.speed).
    const seg = speedSegment(st.paused, st.speed)
    if (seg !== this.segment) {
      this.segment = seg
      this.speedBtns.forEach((b, i) => b.setSelected(i === seg))
    }
    const fast = st.speed === 4 ? '4×' : '2×'
    if (this.speedBtns[2]?.getData('label') !== fast)
      this.speedBtns[2]?.setLabel(fast)
    this.ticker.setPaused(st.paused || st.speed === 0)
    this.ticker.setDay(vs.day + 1)
    this.ticker.setProgress(vs.dayProgress)
    this.ticker.update(time, delta)

    if (time >= this.pollAt) {
      this.pollAt = time + POLL_MS
      this.refreshShield()
      this.refreshWarehouseBtn()
      this.refreshChipActive()
      this.pollStep3()
      if (this.flagHint && this.vs.holdBay.count === 0) this.endFlagHint(false)
      // pm:view is the contract; this catches a world scene that woke
      // without emitting it (e.g. the M0 Warehouse stub).
      const awake = this.awakeView()
      if (awake && awake !== this.view) this.setView(awake)
    }
    if (this.follow.visible) {
      const id = this.follow.vehicleId
      const v = vs.vehicles.find((x) => x.id === id) ?? null
      if (v) this.follow.update(v)
      else this.follow.hide()
    }
    // Cards never cover a sheet / popover / dialog (district panel, Garage,
    // mood or shield popover, Sell dialog): they wait until it closes. Nor
    // do they sit on the city's building tooltip (M1 polish).
    // The onboarding cards are city steps (garage, buildings): in the
    // warehouse they sat on the lane readout and the sign (UX M2 review).
    this.onboarding.setSuppressed(
      modalCount() > 0 || this.view !== 'city' || this.overlapsCityTooltip(),
    )
    this.onboarding.update(time)
    this.updateFlash(time)
    this.updateTopShake(time)
    this.updateFlagArrow(time)
    if (this.saveSoon) {
      const final = this.saveSoon === 'final'
      this.saveSoon = null
      this.autosave.save('manual')
      if (final) this.autosave.enabled = false
    } else if (!st.paused) this.autosave.tick(delta)
  }

  // ---------------------------------------------------------------- M2 effects

  /** Hold the sim for `why` (modal cards, auto-pause, rotate). */
  private hold(why: Hold): void {
    this.holds.add(why)
    this.stepper.paused = true
  }

  /** Drop a hold; the sim resumes (at its speed) once nothing holds it. */
  private release(why: Hold): void {
    if (!this.holds.delete(why)) return
    if (this.holds.size === 0) this.stepper.paused = false
  }

  /** The onboarding card would cover the city's building tooltip. */
  private overlapsCityTooltip(): boolean {
    const b = this.onboarding.bounds()
    if (!b || this.view !== 'city') return false
    const city = this.scene.get('City') as
      | { tooltipScreenRect?: () => Rect | null }
      | undefined
    const tip = this.cityAwake() ? (city?.tooltipScreenRect?.() ?? null) : null
    return tip !== null && overlaps(tip, b)
  }

  private cityAwake(): boolean {
    const sm = this.scene
    return sm.isActive('City') && !sm.isSleeping('City')
  }

  private updateFlash(now: number): void {
    if (!this.flash.visible) return
    const left = this.flashUntil - now
    if (left <= 0) {
      this.flash.setVisible(false)
      return
    }
    this.flash.setAlpha((FLASH_ALPHA * left) / FLASH_MS)
  }

  /** The top-bar parts the life:lost shake moves. */
  private topParts(): { x: number; setX(x: number): unknown }[] {
    return [
      this.topBg,
      this.moneyIcon,
      this.moneyText,
      this.lives.root,
      this.moodText,
      this.moodIcon,
      this.levelText,
      this.levelTrack,
      this.levelFill,
      this.levelBarText,
      this.shieldIcon,
      this.shieldText,
    ]
  }

  private updateTopShake(now: number): void {
    const sh = this.topShake
    if (!sh) return
    if (now >= sh.until) {
      this.topShake = null
      this.layoutTopBar()
      return
    }
    const dx = Math.floor(now / 50) % 2 === 0 ? TOP_SHAKE_PX : -TOP_SHAKE_PX
    this.topParts().forEach((o, i) => o.setX((sh.base[i] ?? o.x) + dx))
  }

  /** §9.2: the arrow bobs over the Warehouse button while the hint is up. */
  private updateFlagArrow(now: number): void {
    const show =
      this.flagHint &&
      this.view === 'city' &&
      modalCount() === 0 &&
      !this.lostCard.isOpen() &&
      !this.overCard.isOpen()
    this.flagArrow.setVisible(show)
    if (!show) return
    const r = this.L.warehouse.rect
    const bob = Math.floor(now / FLAG_ARROW_BOB_MS) % 2
    // The 8x8 glyph's tip is at row 12 of the 16x16 frame: touch the button.
    this.flagArrow.setPosition(Math.round(r.x + r.w / 2 - 8), r.y - 13 - bob)
  }

  /** A toast that stays up `ms` (the kit's are 2.5 / 4 s): re-show = restart. */
  private longToast(text: string, red: boolean, ms: number): void {
    this.toast.show(text, red)
    const extra = ms - toastDuration(red)
    if (extra <= 0) return
    this.time.delayedCall(extra, () => {
      if (this.toast.currentText() === text) this.toast.show(text, red)
    })
  }

  private buildingName(id: string): string {
    return this.gd.buildings.find((b) => b.id === id)?.name ?? id
  }

  /** life:lost (city-view §3.3, HUD side). */
  private onLifeLost(p: LifeLostPayload): void {
    // A loss while the game-over screen is up is dropped (§9.4).
    if (this.overCard.isOpen()) return
    const left = p.report?.livesLeft ?? this.vs.lives
    this.lives.loseLife(left)
    this.flashUntil = this.time.now + FLASH_MS
    this.flash.setSize(this.L.W, this.L.H).setAlpha(FLASH_ALPHA)
    this.flash.setVisible(true)
    if (!reducedMotion())
      this.topShake = {
        until: this.time.now + TOP_SHAKE_MS,
        base: this.topParts().map((o) => o.x),
      }
    this.ticker.push(
      incidentLine(this.buildingName(p.destBuildingId), left),
      'incident',
    )
    addWanted(getOnboarding(this.registry), p.label)
    // Persist the loss and the revealed label right after this tick (a
    // reload must not replay the delivery or forget the label).
    if (this.saveSoon !== 'final') this.saveSoon = 'save'
    if (left <= 0 || this.vs.gameOver) return // game:over takes over
    this.lostQueue.push(p)
    this.scheduleLostCard()
  }

  private scheduleLostCard(): void {
    if (this.lostTimer || this.lostCard.isOpen()) return
    this.lostTimer = this.time.delayedCall(LOST_LIFE_DELAY_MS, () => {
      this.lostTimer = null
      this.openNextLostCard()
    })
  }

  /** Close the panels a modal card must not sit under; sleep the Garage. */
  private prepareModal(): void {
    if (this.garageOpen()) this.scene.sleep('Garage')
    this.closeMood()
    this.shield?.close()
    if (this.district?.isOpen()) this.district.close()
    this.hideTooltip()
  }

  private openNextLostCard(): void {
    if (this.overCard.isOpen() || this.vs.gameOver) {
      this.lostQueue = []
      return
    }
    const p = this.lostQueue.shift()
    if (!p) return
    this.prepareModal()
    const sim = getSim(this)
    this.lostCard.open(
      lostLifeModel(p, {
        data: this.gd,
        vehicleName: (id) =>
          sim.state.vehicles.find((v) => v.id === id)?.name ?? null,
        nodes: this.vs.lane.nodes(),
        lives: p.report?.livesLeft ?? this.vs.lives,
      }),
    )
    this.hold('lostLife')
  }

  /** The lost-life card closed (Open warehouse or Continue). */
  private onLostCardClosed(highlight: string | null, warehouse: boolean): void {
    if (this.lostQueue.length > 0) {
      this.openNextLostCard()
      return
    }
    this.release('lostLife')
    this.queueIncidentPaper()
    if (warehouse)
      this.game.events.emit(EV_GOTO, {
        view: 'warehouse',
        ...(highlight ? { highlight } : {}),
      })
  }

  /** TODO(M3): the incident newspaper (city-view §8.2) after the card closes. */
  private queueIncidentPaper(): void {}

  /** game:over (city-view §9.4): hold now, the screen after the effects. */
  private onGameOver(): void {
    this.hold('gameOver')
    this.lostQueue = []
    this.lostTimer?.remove(false)
    this.lostTimer = null
    if (this.lostCard.isOpen()) {
      this.lostCard.close()
      this.release('lostLife')
    }
    // Saved with gameOver set (after this tick), then autosave stops: a
    // reload comes back to this screen.
    this.saveSoon = 'final'
    if (this.overTimer || this.overCard.isOpen()) return
    this.overTimer = this.time.delayedCall(LOST_LIFE_DELAY_MS, () => {
      this.overTimer = null
      this.openGameOver()
    })
  }

  private openGameOver(): void {
    if (this.overCard.isOpen()) return
    this.prepareModal()
    this.flagHint = false
    const s = getSim(this).state
    this.overCard.open(
      gameOverModel(
        {
          day: s.day,
          lifetimeEarned: s.economy.lifetimeEarned,
          deliveries: s.stats.deliveries,
          malwareMissed: s.stats.malwareMissed,
          defused: s.lane.quarantine.malware,
          level: s.level.level,
          rows: s.stats.minutes,
        },
        this.gd,
      ),
    )
    this.hold('gameOver')
    if (this.saveSoon !== 'final') this.autosave.enabled = false
  }

  /** New game: clear the autosave and restart through the Title (§9.4). */
  private newGame(): void {
    this.saveSoon = null
    this.autosave.enabled = false
    discardSave()
    this.scene.start('Title', { fresh: true })
  }

  /** economy.continueWithOneLife (playtest flag): grantLife, resume. */
  private continueWithOneLife(): void {
    const res = this.vs.grantLife()
    if (!res.ok) {
      this.toast.show('Cannot continue', true)
      return
    }
    this.overCard.close()
    this.lives.set(this.vs.lives)
    this.autosave.enabled = true
    this.release('gameOver')
  }

  /**
   * parcel:flagged: the §9.2 funnel. The scripted first malware gets its red
   * `A parcel flagged — Toss it. Lives: 3` toast; the first flag of the run
   * gets the funnel (toast, arrow, follow-up) even when it is not the
   * scripted parcel (UX M2 review: on most seeds a decoy is flagged first,
   * and a cold player saw only a pulsing button), with neutral wording.
   */
  private onFlagged(p: SimEventPayloads['parcel:flagged']): void {
    this.rememberLabel(p.id)
    this.refreshWarehouseBtn()
    const ob = getOnboarding(this.registry)
    const first = !ob.sawFirstFlag
    if (!p.scripted && !first) return
    const room = this.view === 'warehouse'
    if (p.scripted)
      this.longToast(firstFlagText(this.vs.lives), true, HINT_TOAST_MS)
    else
      this.longToast(
        room ? FIRST_FLAG_ROOM_TEXT : FIRST_FLAG_CITY_TEXT,
        false,
        HINT_TOAST_MS,
      )
    if (room) {
      ob.sawFirstFlag = true
      return
    }
    if (!first) return
    this.flagHint = true
    this.flagFollow?.remove(false)
    this.flagFollow = this.time.delayedCall(FLAG_FOLLOW_MS, () => {
      this.flagFollow = null
      if (this.flagHint && this.view === 'city' && this.vs.holdBay.count > 0)
        this.toast.show(FLAG_FOLLOW_TEXT, true)
    })
  }

  /** The player followed the hint (or it lapsed): stop the funnel. */
  private endFlagHint(seen: boolean): void {
    if (seen && this.flagHint) getOnboarding(this.registry).sawFirstFlag = true
    this.flagHint = false
    this.flagFollow?.remove(false)
    this.flagFollow = null
  }

  /** parcel:tossed: DEFUSED ticker + wanted label; the one-time tossHint. */
  private onTossed(p: SimEventPayloads['parcel:tossed']): void {
    this.refreshWarehouseBtn()
    const ob = getOnboarding(this.registry)
    const label = this.vs.parcel(p.id)?.label ?? this.heldLabels.get(p.id)
    this.heldLabels.delete(p.id)
    if (p.wasMalware) {
      if (label) {
        this.ticker.push(defusedLine(label), 'incident')
        addWanted(ob, label)
      }
    }
    if (this.flagHint) this.endFlagHint(true)
    if (!ob.sawTossHint) {
      ob.sawTossHint = true
      // The flag funnel's toasts are moot once a parcel is tossed.
      if (isFlagFunnelText(this.toast.currentText(), this.vs.lives))
        this.toast.clear()
      this.longToast(this.gd.puns.tossHint, false, HINT_TOAST_MS)
    }
  }

  private rememberLabel(id: number): void {
    const label = this.vs.parcel(id)?.label
    if (label) this.heldLabels.set(id, label)
  }

  // ---------------------------------------------------------------- step 2

  /** The lane already holds step 2's machine (the hint would be moot). */
  private step2Moot(): boolean {
    const m = step2Model(this.gd)
    if (!m) return true
    return this.vs.lane
      .nodes()
      .some((n) => n.fixture?.checker.defId === m.machineId)
  }

  private scheduleStep2(delay = STEP2_DELAY_MS): void {
    if (this.step2Timer || !this.onboarding.eligible(2)) return
    this.step2Timer = this.time.delayedCall(delay, () => {
      this.step2Timer = null
      this.showStep2()
    })
  }

  /** city-view §9.1 step 2: arrow at the Warehouse button. */
  private showStep2(): void {
    if (!this.onboarding.eligible(2)) return
    if (this.step2Moot() || this.view === 'warehouse') {
      this.onboarding.complete(2)
      return
    }
    // Another card is up (or a sheet): try again shortly.
    if (this.onboarding.activeStep !== null || modalCount() > 0) {
      this.scheduleStep2(1000)
      return
    }
    this.onboarding.show(
      2,
      () => {
        const r = this.L.warehouse.rect
        return { x: Math.round(r.x + r.w / 2), y: r.y }
      },
      step2Text(this.gd),
    )
  }

  // ---------------------------------------------------------------- layout

  private computeL(): Layout {
    const st = (this.registry.get(REG.safeTop) as number | undefined) ?? 0
    const sb = (this.registry.get(REG.safeBottom) as number | undefined) ?? 0
    return computeLayout(
      this.scale.width,
      this.scale.height,
      st,
      sb,
      this.scale.zoom,
    )
  }

  private relayout(): void {
    const L = this.computeL()
    this.L = L
    this.layoutTopBar()
    this.ticker.relayout(L)
    this.toast.relayout({ W: L.W, toast: this.toastLane() })
    this.refreshChips(true)
    this.layoutBottomBar()
    this.follow.relayout(L)
    this.onboarding.relayout(L)
    this.paused.relayout(L)
    this.rotate.relayout(L.W, L.H)
    this.district?.relayout(L)
    this.shield?.relayout(L)
    this.lostCard.relayout(L)
    this.overCard.relayout(L)
    this.flash.setSize(L.W, L.H)
    this.closeMood()
    this.hideTooltip()
    this.updateRotate()
  }

  // ---------------------------------------------------------------- top bar

  private buildTopBar(): void {
    this.topBg = addPanel(this, 0, 0, 16, 16, 'ui_panel_dark')
      .setAlpha(TOP_ALPHA)
      .setDepth(D.bar)
    const c = D.barContent
    this.moneyIcon = this.add
      .image(0, 0, UI_ATLAS, 'ic_money')
      .setOrigin(0, 0)
      .setDepth(c)
    this.moneyText = addText(this, 0, 0, '', { tint: THEME.textLight })
    this.moneyText.setDepth(c)
    this.lives = new LivesRow(this, 0, 0)
    this.lives.root.setDepth(c)
    this.moodText = addText(this, 0, 0, '', { tint: THEME.textLight })
    this.moodText.setDepth(c)
    this.moodIcon = this.add
      .image(0, 0, UI_ATLAS, 'ic_mood_neutral')
      .setOrigin(0, 0)
      .setDepth(c)
    this.levelText = addText(this, 0, 0, '', { tint: THEME.textLight })
    this.levelText.setDepth(c)
    this.levelTrack = addBar(this, 0, 0, 16, 'ui_bar_track').setDepth(c)
    this.levelFill = addBar(this, 0, 0, 16, 'ui_bar_fill_blue').setDepth(c)
    this.levelBarText = addText(this, 0, 0, '', {
      tint: THEME.textLight,
      shadow: true,
    })
    this.levelBarText.setDepth(c)
    this.shieldIcon = this.add
      .image(0, 0, UI_ATLAS, 'ic_shield')
      .setOrigin(0, 0)
      .setDepth(c)
    this.shieldText = addText(this, 0, 0, '', { tint: THEME.textLight })
    this.shieldText.setDepth(c)
    const L = this.L
    this.zones = {
      money: addTapZone(this, L.money.hit, () => this.onMoneyTap(), 'money'),
      lives: addTapZone(
        this,
        L.lives.hit,
        () => this.toast.show(LIVES_TAP_TEXT),
        'lives',
      ),
      mood: addTapZone(this, L.mood.hit, () => this.toggleMood(), 'mood'),
      level: addTapZone(
        this,
        L.level.hit,
        () => this.toast.show(nextUnlockLine(this.gd, this.vs.level)),
        'level',
      ),
      shield: addTapZone(
        this,
        L.shield.hit,
        () => {
          this.closeMood()
          this.shield?.toggle()
        },
        'shield',
      ),
    }
    for (const z of Object.values(this.zones)) z.setDepth(c)
    this.layoutTopBar()
  }

  private layoutTopBar(): void {
    const L = this.L
    const st = L.safeTop
    // The bar also fills the safe-area strip above it (notch / status bar).
    this.topBg.setPosition(0, 0).setSize(L.W, st + L.topBar.h)
    this.moneyIcon.setPosition(L.money.rect.x, st + 4)
    this.moneyText.setPosition(L.money.rect.x + 18, textTop(st, L.rowA.h))
    this.lives.setPosition(L.lives.rect.x, st + 4)
    this.layoutMood()
    this.levelText.setPosition(L.level.rect.x, textTop(L.rowB.y, L.rowB.h))
    const bar = L.levelBar
    const by = bar.y + Math.floor((bar.h - BAR_H) / 2)
    this.levelTrack.setPosition(bar.x, by).setSize(bar.w, BAR_H)
    this.levelFill.setPosition(bar.x, by)
    this.levelFrac = -1
    this.refreshLevel()
    this.layoutShield()
    if (this.zones) {
      setZoneRect(this.zones.money, L.money.hit)
      setZoneRect(this.zones.lives, L.lives.hit)
      setZoneRect(this.zones.mood, L.mood.hit)
      setZoneRect(this.zones.level, L.level.hit)
      setZoneRect(this.zones.shield, L.shield.hit)
    }
  }

  private layoutMood(): void {
    const L = this.L
    const right = L.W - 6
    this.moodIcon.setPosition(right - 16, L.safeTop + 4)
    this.moodText.setPosition(
      Math.round(right - 16 - 3 - this.moodText.width),
      textTop(L.safeTop, L.rowA.h),
    )
  }

  private layoutShield(): void {
    const r = this.L.shield.rect
    const w = 16 + 3 + Math.round(this.shieldText.width)
    const x = Math.round(r.x + (r.w - w) / 2)
    this.shieldIcon.setPosition(x, r.y + 4)
    this.shieldText.setPosition(x + 19, textTop(r.y, r.h))
  }

  private setMoney(balance: number, animate: boolean): void {
    this.moneyTween?.stop()
    this.moneyTween = null
    if (!animate || balance === this.shownMoney) {
      this.shownMoney = balance
      this.moneyText.setText(formatMoney(balance))
      return
    }
    const from = this.shownMoney
    this.moneyTween = this.tweens.addCounter({
      from,
      to: balance,
      duration: MONEY_TWEEN_MS,
      onUpdate: (tw) => {
        this.shownMoney = Math.round(tw.getValue() ?? balance)
        this.moneyText.setText(formatMoney(this.shownMoney))
      },
      onComplete: () => {
        this.moneyTween = null
        this.shownMoney = balance
        this.moneyText.setText(formatMoney(balance))
      },
    })
  }

  private flashMoneyRed(): void {
    this.moneyText.setTint(THEME.danger)
    this.moneyFlash?.remove(false)
    this.moneyFlash = this.time.delayedCall(MONEY_FLASH_MS, () => {
      this.moneyFlash = null
      this.moneyText.setTint(THEME.textLight)
    })
  }

  /** `+$12` / `−$28` rising next to the money cell (city-view §3.1). */
  private floatMoney(delta: number, gold: boolean): void {
    if (delta === 0) return
    let f = this.floats.find((x) => x.tween === null)
    if (!f) {
      if (this.floats.length < FLOAT_POOL) {
        const text = addText(this, 0, 0, '', { shadow: true })
        text.setDepth(D.floats)
        f = { text, tween: null, startedAt: 0 }
        this.floats.push(f)
      } else {
        f = this.floats.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b))
        f.tween?.stop()
        f.tween = null
      }
    }
    const float = f
    const L = this.L
    const x = Math.round(this.moneyText.x + this.moneyText.width + 6)
    const y0 = textTop(L.safeTop, L.rowA.h)
    // Rise at most to 1 px under the screen top: with no safe-area inset the
    // full FLOAT_RISE would carry the glyphs off the canvas.
    const rise = Math.max(0, Math.min(FLOAT_RISE, y0 + CAP_TOP - 1))
    float.text
      .setText(formatMoneyDelta(delta))
      .setTint(gold ? THEME.gold : THEME.danger)
      .setPosition(Math.min(x, L.lives.rect.x - 4 - float.text.width), y0)
      .setAlpha(1)
      .setVisible(true)
    float.startedAt = this.time.now
    const proxy = { t: 0 }
    float.tween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration: FLOAT_MS,
      onUpdate: () => {
        float.text.setY(Math.round(y0 - rise * proxy.t))
        float.text.setAlpha(proxy.t < 0.66 ? 1 : (1 - proxy.t) / 0.34)
      },
      onComplete: () => {
        float.tween = null
        float.text.setVisible(false)
      },
    })
  }

  private onMoneyTap(): void {
    this.toast.show(
      moneyTapText(this.vs.lifetimeEarned, this.vs.payroll().perDay),
    )
  }

  private refreshMood(): void {
    const v = Math.round(this.vs.meanSatisfaction())
    this.moodText.setText(String(v))
    this.moodIcon.setFrame(moodFace(v))
    this.layoutMood()
    if (this.moodPop) this.moodDirty = true
  }

  private refreshLevel(): void {
    const vs = this.vs
    const p = levelProgress(
      this.gd,
      vs.level,
      vs.lifetimeEarned,
      vs.nextThreshold,
    )
    this.levelText.setText(levelLabel(this.gd, vs.level))
    const bar = this.L.levelBar
    if (p.frac !== this.levelFrac) {
      this.levelFrac = p.frac
      setBarFill(this.levelFill, bar.w, p.frac)
    }
    this.levelBarText.setText(p.text)
    this.levelBarText.setPosition(
      Math.round(bar.x + (bar.w - this.levelBarText.width) / 2),
      textTop(bar.y, bar.h),
    )
  }

  private refreshShield(): void {
    const pct = this.vs.laneStats().detectionPct
    const text = formatPct(pct)
    const tint = detectionColour(pct)
    if (this.shieldText.text !== text) {
      this.shieldText.setText(text)
      this.layoutShield()
    }
    this.shieldText.setTint(tint)
    this.shieldIcon.setTint(tint)
  }

  // ---------------------------------------------------------------- mood popover

  private toggleMood(): void {
    if (this.moodPop) this.closeMood()
    else {
      this.shield?.close()
      this.openMood()
    }
  }

  /** Per-district satisfaction + trend (same data as the panel header). */
  private openMood(): void {
    this.closeMood()
    const L = this.L
    const rows = this.gd.districts.filter(
      (d) => d.kind === 'district' && this.vs.regionState(d.id) === 'live',
    )
    // Each row is a tap target (opens the district panel): ≥ 44 CSS px tall.
    const rowH = Math.max(MOOD_ROW_H, L.minHit)
    const h = 8 + rows.length * rowH
    const w = Math.min(MOOD_POP_W, L.W - 12)
    const x = L.W - 6 - w
    const y = L.rowB.y
    const scrim = this.add.zone(0, 0, L.W, L.H).setOrigin(0, 0)
    scrim.setInteractive().setDepth(D.popScrim)
    scrim.on('pointerup', () => this.closeMood())
    const panel = addPanel(this, 0, 0, w, h, 'ui_panel').setInteractive()
    const pop = this.add.container(x, y, [panel]).setDepth(D.pop)
    rows.forEach((d, i) => {
      const s = this.vs.districtStats(d.id)
      const ry = 4 + i * rowH
      const value = s ? Math.round(s.satisfaction) : 0
      const name = addText(this, 8, textTop(ry, rowH), d.flavour)
      const face = this.add
        .image(
          w - 8 - 16,
          ry + Math.floor((rowH - 16) / 2),
          UI_ATLAS,
          moodFace(value),
        )
        .setOrigin(0, 0)
      const num = addText(
        this,
        0,
        textTop(ry, rowH),
        `${value} ${s ? trendGlyph(s.trend) : ''}`,
      )
      num.setX(Math.round(w - 8 - 16 - 4 - num.width))
      const hit = addTapZone(
        this,
        { x: 0, y: ry, w, h: rowH },
        () => {
          this.closeMood()
          this.game.events.emit(EV_SELECT, { kind: 'district', id: d.id })
        },
        `mood:${d.id}`,
      )
      pop.add([name, num, face, hit])
    })
    this.moodPop = pop
    this.moodScrim = scrim
    this.moodFrame = this.game.loop.frame
    pushModal(pop)
  }

  private closeMood(): void {
    if (!this.moodPop) return
    popModal(this.moodPop)
    this.moodPop.destroy()
    this.moodScrim?.destroy()
    this.moodPop = null
    this.moodScrim = null
  }

  // ---------------------------------------------------------------- tooltip

  /** pm:tooltip {text, x, y}: a ui_tooltip bubble above the point, 2 s. */
  private showTooltip(p: TooltipPayload): void {
    this.hideTooltip()
    if (!p?.text) return
    const L = this.L
    const text = addText(this, 6, 0, p.text, { maxWidth: 200 })
    const n = Math.max(1, Math.round(text.height / 14))
    const w = Math.round(text.width) + 12
    const h = 10 + n * 14
    text.setY(textTop(0, h, n))
    const panel = addPanel(this, 0, 0, w, h, 'ui_tooltip')
    const x = Math.round(Math.min(L.W - 6 - w, Math.max(6, p.x - w / 2)))
    const y = Math.round(Math.max(L.safeTop + 2, p.y - 8 - h))
    this.tip = this.add.container(x, y, [panel, text]).setDepth(D.tooltip)
    this.tipTimer = this.time.delayedCall(TOOLTIP_MS, () => this.hideTooltip())
  }

  private hideTooltip(): void {
    this.tipTimer?.remove(false)
    this.tipTimer = null
    this.tip?.destroy()
    this.tip = null
  }

  // ---------------------------------------------------------------- chips

  private buildChips(): void {
    this.chipsRoot = this.add.container(0, 0).setDepth(D.chips)
    this.refreshChips()
  }

  /**
   * Mark the chip row for a rebuild (level, unlocks, badges, layout). The
   * rebuild runs once per frame from update(): an interactive Zone created
   * and destroyed within one frame would stay in Phaser's InputPlugin list
   * as a dead entry (it is still pending insertion when its removal runs).
   */
  private refreshChips(force = false): void {
    if (force) this.chipKey = ''
    this.chipsDirty = true
  }

  private rebuildChips(): void {
    this.chipsDirty = false
    const entries = chipEntries(this.gd, this.vs.level, (id) =>
      this.vs.regionState(id),
    )
    const key =
      entries.map((e) => `${e.id}:${e.lockLevel ?? ''}`).join('|') +
      `#${[...this.newChips].join(',')}#${this.activeChip ?? ''}#${this.L.W}x${this.L.H}`
    if (key === this.chipKey) return
    this.chipKey = key
    for (const c of this.chips) {
      c.bg.destroy()
      c.zone.destroy()
      c.badge?.destroy()
      for (const p of c.parts) p.destroy()
    }
    this.chips = []
    const L = this.L
    const ch = L.chip
    const y = L.chips.y + Math.floor((L.chips.h - ch.h) / 2)
    let x = ch.x0
    for (const e of entries) {
      const parts: Phaser.GameObjects.GameObject[] = []
      let cx = ch.padX
      const icon = e.id === 'warehouse' ? 'ic_warehouse' : null
      if (icon) {
        parts.push(this.add.image(cx, 4, UI_ATLAS, icon).setOrigin(0, 0))
        cx += 16 + 3
      }
      const label = addText(this, cx, textTop(0, ch.h), e.label)
      parts.push(label)
      cx += Math.round(label.width)
      if (e.lockLevel !== null) {
        cx += 4
        parts.push(this.add.image(cx, 4, UI_ATLAS, 'ic_lock').setOrigin(0, 0))
        cx += 16 + 1
        // grey1, not textMuted (grey2): grey2 on the chip face (and on the
        // yellow active chip) is too faint to read on a phone.
        const lv = addText(this, cx, textTop(0, ch.h), `Lv${e.lockLevel}`, {
          tint: PALETTE.grey1,
        })
        parts.push(lv)
        cx += Math.round(lv.width)
      }
      const w = cx + ch.padX
      const active = this.activeChip === e.id
      const bg = addPanel(
        this,
        0,
        0,
        w,
        ch.h,
        active ? 'ui_chip_active' : 'ui_chip',
      )
      const hitW = Math.max(w, L.minHit)
      const zone = addTapZone(
        this,
        {
          x: x - Math.floor((hitW - w) / 2),
          y: ch.hitY,
          w: hitW,
          h: ch.hitH,
        },
        () => this.onChipTap(e.id),
        `chip:${e.id}`,
      )
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.chipDrag = { id: p.id, x0: p.x, s0: this.chipScroll }
      })
      let badge: Phaser.GameObjects.Image | null = null
      if (this.newChips.has(e.id)) {
        badge = this.add
          .image(x + w - 14, y - 5, UI_ATLAS, 'badge_new')
          .setOrigin(0, 0)
      }
      // Chip-local parts: shift them to the chip's x/y.
      bg.setPosition(x, y)
      for (const p of parts) {
        const t = p as unknown as Phaser.GameObjects.Components.Transform
        t.setPosition(t.x + x, t.y + y)
      }
      this.chipsRoot.add([bg, ...parts])
      if (badge) this.chipsRoot.add(badge)
      this.chipsRoot.add(zone)
      this.chips.push({ entry: e, bg, parts, zone, badge, x, w })
      x += w + ch.gap
    }
    this.chipRowW = x - ch.gap - ch.x0
    this.clampChipScroll()
    this.chipsRoot.setVisible(this.view === 'city')
  }

  private clampChipScroll(): void {
    const max = this.L.chip.maxRowW
    const min = Math.min(0, max - this.chipRowW)
    this.chipScroll = Math.min(0, Math.max(min, this.chipScroll))
    this.chipsRoot.setX(Math.round(this.chipScroll))
  }

  private onChipTap(id: string): void {
    this.closeMood()
    this.newChips.delete(id)
    this.activeChip = id
    this.refreshChips(true)
    this.game.events.emit(EV_PAN_TO, { regionId: id })
  }

  /** `chip_active` until the city camera leaves the chip's region. */
  private refreshChipActive(): void {
    if (!this.activeChip || this.view !== 'city') return
    const city = this.cityCamera()
    const region = this.gd.map.regions.find((r) => r.id === this.activeChip)
    if (!city || !region) return
    const ox = originX(this.gd.map.size[1])
    const [tx, ty] = region.labelTile
    const wx = ox + (tx - ty) * 32
    const wy = (tx + ty) * 16
    const c = city.worldView
    // Ignore while a pan is still on its way (the camera is moving there).
    if (city.panEffect.isRunning) return
    const d = Math.hypot(c.centerX - wx, c.centerY - wy)
    if (d > CHIP_ACTIVE_RADIUS) {
      this.activeChip = null
      this.refreshChips()
    }
  }

  /** Flash a chip once (a tap on its locked region, pm:select 'locked'). */
  private flashChip(id: string): void {
    const chip = this.chips.find((c) => c.entry.id === id)
    if (!chip) return
    chip.bg.setFrame('ui_chip_active')
    this.time.delayedCall(CHIP_FLASH_MS, () => {
      if (chip.bg.active)
        chip.bg.setFrame(this.activeChip === id ? 'ui_chip_active' : 'ui_chip')
    })
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const drag = this.chipDrag
    if (!drag || p.id !== drag.id || !p.isDown) return
    if (this.chipRowW <= this.L.chip.maxRowW) return
    const dx = p.x - drag.x0
    if (Math.abs(dx) <= TAP_PX) return
    this.chipScroll = drag.s0 + dx
    this.clampChipScroll()
  }

  // ---------------------------------------------------------------- bottom bar

  private buildBottomBar(): void {
    const L = this.L
    this.bottomBg = addPanel(this, 0, 0, 16, 16, 'ui_panel_dark')
      .setAlpha(BOTTOM_ALPHA)
      .setDepth(D.bottom)
    // Swallow taps on the bar's empty parts (they must not reach the city).
    this.bottomBg.setInteractive()
    const targets = [L.speedPause, L.speed1, L.speed2]
    const labels = ['', '1×', '2×']
    targets.forEach((t, i) => {
      const b = new Button(this, {
        x: t.rect.x,
        y: t.rect.y,
        w: t.rect.w,
        h: t.rect.h,
        hit: t.hit,
        icon: i === 0 ? 'ic_pause' : null,
        label: labels[i] || undefined,
        id: `speed:${i}`,
        onClick: () => this.setSegment(i),
      })
      b.setDepth(D.bottomContent)
      this.speedBtns.push(b)
    })
    this.muteBtn = new Button(this, {
      x: L.mute.rect.x,
      y: L.mute.rect.y,
      w: L.mute.rect.w,
      h: L.mute.rect.h,
      hit: L.mute.hit,
      icon: this.muted ? 'ic_sax_shades' : 'ic_sax',
      id: 'mute',
      onClick: () => this.toggleMute(),
    }).setDepth(D.bottomContent)
    this.whBtn = new Button(this, {
      x: L.warehouse.rect.x,
      y: L.warehouse.rect.y,
      w: L.warehouse.rect.w,
      h: L.warehouse.rect.h,
      hit: L.warehouse.hit,
      icon: 'ic_warehouse',
      label: 'Warehouse',
      id: 'warehouse',
      onClick: () => this.gotoOther(),
    }).setDepth(D.bottomContent)
    this.garageBtn = new Button(this, {
      x: L.garage.rect.x,
      y: L.garage.rect.y,
      w: L.garage.rect.w,
      h: L.garage.rect.h,
      hit: L.garage.hit,
      icon: 'ic_garage',
      label: 'Garage',
      id: 'garage',
      onClick: () => this.openGarage(),
    }).setDepth(D.bottomContent)
    this.stamp = addText(this, 0, 0, '', { tint: THEME.textMuted })
    this.stamp.setDepth(D.bottomContent)
    this.layoutBottomBar()
  }

  private layoutBottomBar(): void {
    const L = this.L
    const r = L.bottomBar
    this.bottomBg.setPosition(r.x, r.y).setSize(r.w, r.h)
    if (this.bottomBg.input?.hitArea)
      (this.bottomBg.input.hitArea as Phaser.Geom.Rectangle).setTo(
        0,
        0,
        r.w,
        r.h,
      )
    const t = [L.speedPause, L.speed1, L.speed2]
    this.speedBtns.forEach((b, i) => b.setRect(t[i]!.rect, t[i]!.hit))
    this.muteBtn.setRect(L.mute.rect, L.mute.hit)
    this.whBtn.setRect(L.warehouse.rect, L.warehouse.hit)
    this.garageBtn.setRect(L.garage.rect, L.garage.hit)
    this.layoutStamp()
  }

  private layoutStamp(): void {
    const L = this.L
    this.stamp.setText(String(this.registry.get(REG.buildStamp) ?? ''))
    const top = L.speed1.rect.y + L.speed1.rect.h
    this.stamp.setPosition(
      Math.round(L.W - 4 - this.stamp.width),
      textTop(top, L.bottomBar.y + L.bottomBar.h - L.safeBottom - top),
    )
  }

  /** ❚❚ | 1× | 2×: stepper.speed (0 holds the sim), never game.pause(). */
  private setSegment(i: number): void {
    const st = this.stepper
    if (this.paused.isOpen()) this.resumeFromCard()
    if (i === 0) {
      st.speed = 0
    } else {
      const speed = i === 1 ? 1 : 2
      st.speed = speed
      this.lastRunSpeed = speed
      writeSettings({ speed })
    }
  }

  /** Space: pause ⇄ the last running speed. */
  private togglePause(): void {
    const st = this.stepper
    if (this.paused.isOpen()) {
      this.resumeFromCard()
      return
    }
    if (st.speed === 0) st.speed = this.lastRunSpeed
    else st.speed = 0
  }

  private toggleMute(): void {
    const next = !this.muted
    const dir = this.director()
    if (dir?.setMuted) dir.setMuted(next)
    writeSettings({ muted: next })
    this.setMutedIcon(next)
  }

  private setMutedIcon(muted: boolean): void {
    this.muted = muted
    this.muteBtn.setIcon(muted ? 'ic_sax_shades' : 'ic_sax')
  }

  private gotoOther(): void {
    this.game.events.emit(EV_GOTO, {
      view: this.view === 'city' ? 'warehouse' : 'city',
    })
  }

  private openGarage(): void {
    this.closeMood()
    this.shield?.close()
    this.plusPending = false
    this.refreshGarageBadge()
    toggleGarage(this)
  }

  /** Warehouse button: hold badge, pulse while held > 0, red while stalled. */
  private refreshWarehouseBtn(): void {
    const city = this.view === 'city'
    const held = city ? this.vs.holdBay.count : 0
    const red = city && this.vs.lane.stalled !== null
    const key = `${city}|${held}|${red}`
    if (key === this.whKey) return
    this.whKey = key
    this.whBtn.setIcon(city ? 'ic_warehouse' : 'ic_city')
    this.whBtn.setLabel(city ? 'Warehouse' : 'City')
    this.whBtn.setBadge(held > 0 ? String(held) : null)
    // Pulse while anything is held; red (stalled) wins over the glow.
    this.whBtn.setPulse(held > 0)
    this.whBtn.setRed(red)
  }

  /** Garage: `!` (unpaid / inactive) wins over the one-shot `+`. */
  private refreshGarageBadge(): void {
    const vs = this.vs
    const fresh = newlyAffordableTypes(
      this.gd,
      vs.level,
      vs.money,
      this.seenTypes,
    )
    if (fresh.length > 0) {
      for (const t of fresh) this.seenTypes.add(t)
      this.plusPending = true
    }
    if (garageAlert(vs.vehicles)) this.garageBtn.setBadge('!', 'red')
    else if (this.plusPending) this.garageBtn.setBadge('+', 'green')
    else this.garageBtn.setBadge(null)
  }

  // ---------------------------------------------------------------- views + panels

  private setView(name: WorldView): void {
    this.view = name
    this.toast.relayout({ W: this.L.W, toast: this.toastLane() })
    this.chipsRoot.setVisible(name === 'city')
    if (name !== 'city') {
      this.follow.hide()
      this.closeMood()
    }
    if (name === 'warehouse') {
      // §9.1 step 2 clears on entering the warehouse; §9.2 the flag funnel.
      this.step2Timer?.remove(false)
      this.step2Timer = null
      if (this.onboarding.eligible(2)) this.onboarding.complete(2)
      if (this.flagHint) {
        // The player followed the funnel: point at the bays next.
        this.endFlagHint(true)
        if (this.vs.holdBay.count > 0) {
          if (isFlagFunnelText(this.toast.currentText(), this.vs.lives))
            this.toast.clear()
          this.longToast(FIRST_FLAG_ROOM_TEXT, false, HINT_TOAST_MS)
        }
      }
    }
    this.refreshWarehouseBtn()
  }

  /**
   * The toast lane for the current view: L.toast in the city; in the
   * warehouse it moves onto the room's north wall (over the decorative
   * incident sign), because L.toast covers the lane readout strip — exactly
   * at 360 × 604, and with any two-line toast at 393 × 659 (UX M2 review).
   */
  private toastLane(): Layout['toast'] {
    const L = this.L
    if (this.view !== 'warehouse') return L.toast
    const room = roomPlacement(L.W, L.ticker.y + L.ticker.h, L.bottomBar.y)
    return { ...L.toast, y: room.roomY + 4 }
  }

  /** Re-read the open district panel (city-view §5.1 refresh events). */
  private refreshDistrict(): void {
    if (this.district?.isOpen()) this.district.refresh()
  }

  private openDistrict(id: string): void {
    this.closeMood()
    this.shield?.close()
    this.district?.open(id)
  }

  /** The world scene that is running and awake, if exactly one is. */
  private awakeView(): WorldView | null {
    const sm = this.scene
    const city = sm.isActive('City') && !sm.isSleeping('City')
    const wh = sm.isActive('Warehouse') && !sm.isSleeping('Warehouse')
    if (city === wh) return null
    return city ? 'city' : 'warehouse'
  }

  private cityCamera(): Phaser.Cameras.Scene2D.Camera | null {
    const sm = this.scene
    if (!sm.isActive('City') || sm.isSleeping('City')) return null
    return sm.get('City')?.cameras?.main ?? null
  }

  /** A building's sprite top projected from the City camera to HUD px. */
  private projectBuilding(id: string): { x: number; y: number } | null {
    const cam = this.cityCamera()
    const def = this.gd.buildings.find((b) => b.id === id)
    if (!cam || !def) return null
    const a = footprintAnchor(
      def.tile,
      def.footprint,
      originX(this.gd.map.size[1]),
    )
    const frame = this.textures.getFrame(UI_ATLAS, buildingSprite(id))
    const top = a.y - (frame ? frame.height : 64) + 12
    const v = cam.worldView
    const x = (a.x - v.x) * cam.zoom + cam.x
    const y = (top - v.y) * cam.zoom + cam.y
    const L = this.L
    if (x < 0 || x > L.W || y < L.world.y || y > L.chips.y) return null
    return { x: Math.round(x), y: Math.round(y) }
  }

  // ---------------------------------------------------------------- onboarding

  private startTour(): void {
    // A vehicle bought while nothing listened (?fastForward, a policy run)
    // has already done step 1's job.
    if (this.vs.vehicles.length > 0 && this.onboarding.eligible(1)) {
      this.onboarding.complete(1)
      this.scheduleStep2()
      return
    }
    this.scheduleStep2()
    if (this.onboarding.eligible(1)) {
      this.onboarding.show(1, () => {
        const g = this.L.garage.rect
        return { x: Math.round(g.x + g.w / 2), y: g.y }
      })
    }
  }

  /**
   * Step 3 trigger: the first pickup while another building has waiting
   * parcels. When none of them is on screen the step waits (`step3Armed`)
   * until one is — the 2 Hz poll in update() shows it then — so the card
   * never asks for a tap on a badge the player cannot see.
   */
  private onPickedUp(p: SimEventPayloads['parcel:pickedUp']): void {
    if (!this.onboarding.eligible(3) || this.onboarding.activeStep !== null)
      return
    const from = this.vs.vehicles.find((v) => v.id === p.vehicleId)?.stopAt
    let best: string | null = null
    let bestN = 0
    let bestOn = false
    for (const b of this.gd.buildings) {
      if (b.id === from || this.vs.regionState(b.district) !== 'live') continue
      const n = this.vs.waitingAt(b.id).length
      if (n === 0) continue
      const on = this.projectBuilding(b.id) !== null
      if ((on && !bestOn) || (on === bestOn && n > bestN)) {
        best = b.id
        bestN = n
        bestOn = on
      }
    }
    if (!best) return
    if (bestOn && modalCount() === 0 && this.projectStep3(best))
      this.showStep3(best)
    else this.step3Armed = true
  }

  /** A building's arrow tip for step 3: on screen with room for the card above. */
  private projectStep3(id: string): { x: number; y: number } | null {
    const at = this.projectBuilding(id)
    return at && this.onboarding.fitsAbove(at.y, 3) ? at : null
  }

  /** An armed step 3 shows once a building with waiting parcels is on screen. */
  private pollStep3(): void {
    if (!this.step3Armed) return
    if (!this.onboarding.eligible(3)) {
      this.step3Armed = false
      return
    }
    if (this.onboarding.activeStep !== null || modalCount() > 0) return
    const t = this.onScreenWaitingBuilding()
    if (!t) return
    this.step3Armed = false
    this.showStep3(t.id)
  }

  private showStep3(first: string): void {
    let target = first
    // The arrow follows the chosen building while it is on screen and still
    // has parcels waiting; otherwise (the camera moved, the parcels were
    // collected) it re-targets any on-screen building with waiting parcels,
    // so the card is not left pointing at nothing while badges are visible.
    this.onboarding.show(3, () => {
      if (this.vs.waitingAt(target).length > 0) {
        const at = this.projectStep3(target)
        if (at) return at
      }
      const next = this.onScreenWaitingBuilding()
      if (!next) return null
      target = next.id
      return next.at
    })
  }

  /** The on-screen live building with the most waiting parcels (room for the step-3 card above it), if any. */
  private onScreenWaitingBuilding(): {
    id: string
    at: { x: number; y: number }
  } | null {
    let best: { id: string; at: { x: number; y: number } } | null = null
    let bestN = 0
    for (const b of this.gd.buildings) {
      const n = this.vs.waitingAt(b.id).length
      if (n <= bestN || this.vs.regionState(b.district) !== 'live') continue
      const at = this.projectStep3(b.id)
      if (!at) continue
      best = { id: b.id, at }
      bestN = n
    }
    return best
  }

  // ---------------------------------------------------------------- pause / visibility

  private director(): AudioDirectorLike | undefined {
    return this.registry.get('audio') as AudioDirectorLike | undefined
  }

  /** HIDDEN / pagehide: auto-pause (modal) and save now. */
  private onHidden(): void {
    if (!this.holds.has('hidden')) {
      this.hold('hidden')
      this.autoPaused = true
    }
    this.autosave.save('hidden')
  }

  private onVisible(): void {
    if (!this.autoPaused || this.paused.isOpen()) return
    // A lost-life / game-over card already holds the sim and asks for a
    // tap: no Paused card on top of it.
    if (this.lostCard.isOpen() || this.overCard.isOpen()) {
      this.autoPaused = false
      this.release('hidden')
      return
    }
    // A modal card never renders under the sheet (plan.md §6.7).
    if (this.garageOpen()) this.scene.sleep('Garage')
    this.paused.show()
  }

  private resumeFromCard(): void {
    this.paused.hide()
    if (this.autoPaused) {
      this.autoPaused = false
      this.release('hidden')
    }
  }

  /** Landscape on a phone: the rotate card pauses until portrait. */
  private updateRotate(): void {
    const want = wantsRotateCard(
      this.L.W,
      this.L.H,
      this.game.device.os.desktop,
    )
    if (want === this.rotate.isOpen()) return
    this.rotate.setOpen(want)
    if (want) {
      this.hold('rotate')
      this.rotatePaused = true
    } else if (this.rotatePaused) {
      this.rotatePaused = false
      this.release('rotate')
    }
  }

  // ---------------------------------------------------------------- events

  private bindEvents(): void {
    bindSim(
      this,
      {
        'money:changed': (p) => {
          const neg = p.delta < 0
          this.setMoney(p.balance, true)
          if (neg) this.flashMoneyRed()
          this.floatMoney(p.delta, floatsGold(p.reason))
          if (isEarned(p.reason)) this.dayEarned += p.delta
          this.refreshLevel()
          this.refreshGarageBadge()
        },
        'satisfaction:changed': () => {
          this.refreshMood()
          this.refreshDistrict()
        },
        'parcel:spawned': () => this.refreshDistrict(),
        'level:up': (p) => {
          this.refreshLevel()
          this.refreshShield()
          this.refreshChips()
          this.refreshGarageBadge()
          const row = this.gd.levels.find((l) => l.level === p.level)
          if (row) this.ticker.push(row.ticker, 'level')
        },
        'region:unlocked': (p) => {
          this.newChips.add(p.district)
          this.refreshChips()
          this.refreshMood()
          this.refreshDistrict()
          const d = this.gd.districts.find((x) => x.id === p.district)
          if (d) this.ticker.push(`${d.flavour} is now open`, 'region')
        },
        'lane:stalled': (p) => {
          this.refreshWarehouseBtn()
          this.ticker.push(stallLine(p.reason), 'stall')
        },
        'lane:resumed': () => this.refreshWarehouseBtn(),
        'parcel:flagged': (p) => this.onFlagged(p),
        'parcel:held': (p) => {
          this.rememberLabel(p.id)
          this.refreshWarehouseBtn()
        },
        'parcel:tossed': (p) => this.onTossed(p),
        'parcel:cleared_by_player': (p) => {
          this.heldLabels.delete(p.id)
          this.refreshWarehouseBtn()
        },
        'lane:fixturePlaced': () => this.refreshShield(),
        'lane:fixtureMoved': () => this.refreshShield(),
        'lane:fixtureRemoved': () => this.refreshShield(),
        'worker:fired': () => this.refreshShield(),
        'parcel:delivered': () => {
          this.dayDelivered++
        },
        'parcel:pickedUp': (p) => {
          this.onPickedUp(p)
          this.refreshDistrict()
        },
        'building:rushed': () => {
          if (this.onboarding.activeStep === 3) this.onboarding.complete(3)
        },
        'payroll:paid': (p) => {
          this.dayPayroll += p.amount
          this.toast.show(`Payday — payroll ${formatMoney(-p.amount)}`)
        },
        'payroll:short': (p) => {
          const names = this.employeeNames(p.employeeIds)
          const text = `Payroll short: ${names} unpaid`
          this.toast.show(text, true)
          this.ticker.push(text, 'payroll')
          this.refreshGarageBadge()
        },
        'worker:walkedOut': (p) => {
          const name = this.employeeNames([p.employeeId])
          let text = `${name} walked out — desk short-handed`
          if (p.kind === 'driver') {
            const v = getSim(this).state.vehicles.find(
              (x) => x.driverId === p.employeeId,
            )
            text = `${name} walked out — ${v?.name ?? 'a vehicle'} has no driver`
          }
          this.toast.show(text, true)
          this.ticker.push(text, 'worker')
          this.refreshGarageBadge()
          this.refreshShield()
        },
        'worker:hired': () => {
          this.refreshGarageBadge()
          this.refreshShield()
        },
        'vehicle:bought': () => {
          this.onboarding.complete(1)
          this.scheduleStep2()
          this.refreshGarageBadge()
          this.refreshDistrict()
        },
        'vehicle:sold': (p) => {
          if (this.follow.vehicleId === p.id) this.follow.hide()
          this.refreshGarageBadge()
          this.refreshDistrict()
        },
        'vehicle:inactive': () => this.refreshGarageBadge(),
        'life:lost': (p) => this.onLifeLost(p),
        'game:over': () => this.onGameOver(),
        'day:ended': (p) => {
          if (!this.simDaily)
            this.ticker.push(
              dailyLine(
                p.day,
                this.dayDelivered,
                this.dayEarned,
                this.dayPayroll,
              ),
              'daily',
            )
          this.dayDelivered = 0
          this.dayEarned = 0
          this.dayPayroll = 0
        },
        'ticker:news': (p) => {
          if (p.kind === 'daily') this.simDaily = true
          this.ticker.push(p.text, p.kind)
        },
      },
      () => this.syncAll(),
    )

    const ge = this.game.events
    const onView = (p: { name?: string }): void => {
      if (p?.name === 'city' || p?.name === 'warehouse') this.setView(p.name)
    }
    const onSelect = (p: SelectPayload): void => {
      if (!p) return
      if (p.kind === 'district') this.openDistrict(String(p.id))
      else if (p.kind === 'locked') {
        this.toast.show(lockedRegionText(this.gd, String(p.id)))
        this.flashChip(String(p.id))
      }
    }
    const onFollow = (p: FollowPayload): void => {
      if (p && typeof p.vehicleId === 'number' && this.view === 'city')
        this.follow.show(p.vehicleId)
      else this.follow.hide()
    }
    const onTooltip = (p: TooltipPayload): void => this.showTooltip(p)
    // Any path that opens the Garage (button, G, the panel's `Garage ▸`)
    // clears the one-shot `+` badge.
    const onSheetOpen = (p: { id?: string }): void => {
      if (p?.id !== GARAGE_SHEET_ID || !this.plusPending) return
      this.plusPending = false
      this.refreshGarageBadge()
    }
    const onMuted = (p: { muted?: boolean }): void =>
      this.setMutedIcon(!!p?.muted)
    const onHidden = (): void => this.onHidden()
    const onVisible = (): void => this.onVisible()
    const onPageHide = (): void => this.onHidden()
    const onResize = (): void => this.relayout()
    const onSafe = (): void => this.relayout()
    const onStamp = (): void => this.layoutStamp()

    ge.on(EV_VIEW, onView)
    ge.on(EV_SELECT, onSelect)
    ge.on(EV_FOLLOW, onFollow)
    ge.on(EV_TOOLTIP, onTooltip)
    ge.on('ui:sheetOpen', onSheetOpen)
    ge.on(EV_AUDIO_MUTED, onMuted)
    ge.on(Phaser.Core.Events.HIDDEN, onHidden)
    ge.on(Phaser.Core.Events.VISIBLE, onVisible)
    window.addEventListener('pagehide', onPageHide)
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    const reg = this.registry.events
    reg.on(`changedata-${REG.safeTop}`, onSafe)
    reg.on(`changedata-${REG.safeBottom}`, onSafe)
    reg.on(`changedata-${REG.buildStamp}`, onStamp)

    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this)
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.chipDrag = null
    })
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.tip) this.hideTooltip()
    })
    this.input.keyboard?.on('keydown', this.onKey, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ge.off(EV_VIEW, onView)
      ge.off(EV_SELECT, onSelect)
      ge.off(EV_FOLLOW, onFollow)
      ge.off(EV_TOOLTIP, onTooltip)
      ge.off('ui:sheetOpen', onSheetOpen)
      ge.off(EV_AUDIO_MUTED, onMuted)
      ge.off(Phaser.Core.Events.HIDDEN, onHidden)
      ge.off(Phaser.Core.Events.VISIBLE, onVisible)
      window.removeEventListener('pagehide', onPageHide)
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      reg.off(`changedata-${REG.safeTop}`, onSafe)
      reg.off(`changedata-${REG.safeBottom}`, onSafe)
      reg.off(`changedata-${REG.buildStamp}`, onStamp)
      this.input.keyboard?.off('keydown', this.onKey, this)
      this.closeMood()
      this.hideTooltip()
      this.moneyTween?.stop()
      for (const f of this.floats) f.tween?.stop()
      this.onboarding.destroy()
      // The cards sit on the shared modal stack: pop them with the scene.
      this.lostCard.destroy()
      this.overCard.destroy()
      this.lostTimer = null
      this.overTimer = null
    })
  }

  private employeeNames(ids: readonly number[]): string {
    const emps = getSim(this).state.employees
    const names = ids.map(
      (id) => emps.find((e) => e.id === id)?.name ?? `#${id}`,
    )
    return names.join(', ')
  }

  /** Rebuild every readout from sim state (create, WAKE, Sim swap). */
  private syncAll(): void {
    const vs = this.vs
    this.moneyTween?.stop()
    this.moneyTween = null
    this.setMoney(vs.money, false)
    this.lives.set(vs.lives)
    this.refreshMood()
    this.levelFrac = -1
    this.refreshLevel()
    this.refreshShield()
    this.ticker.setDay(vs.day + 1)
    this.refreshChips(true)
    if (this.seenTypes.size === 0)
      for (const t of this.gd.vehicles.types)
        if (t.unlockLevel <= vs.level) this.seenTypes.add(t.id)
    this.refreshWarehouseBtn()
    this.refreshGarageBadge()
    if (
      this.follow.visible &&
      !vs.vehicles.some((v) => v.id === this.follow.vehicleId)
    )
      this.follow.hide()
    // A swapped-in sim that already owns a vehicle (__pm.load of a fixture or
    // save) has done step 1's job, as startTour() rules for a policy run.
    if (vs.vehicles.length > 0 && this.onboarding?.eligible(1))
      this.onboarding.complete(1)
    if (vs.vehicles.length > 0) this.scheduleStep2()
    this.heldLabels.clear()
    for (const it of vs.holdBay.items) this.rememberLabel(it.parcelId)
    // Cards follow the sim: a game-over state (a reload, __pm.load of a
    // fixture) shows its screen; a live one closes a stale screen.
    if (vs.gameOver) {
      if (!this.overCard.isOpen() && !this.overTimer) this.openGameOver()
    } else if (this.overCard.isOpen()) {
      this.overCard.close()
      this.autosave.enabled = true
      this.release('gameOver')
    }
  }

  // ---------------------------------------------------------------- keyboard

  private onKey(ev: KeyboardEvent): void {
    if (ev.repeat) return
    const key = ev.key
    if (key === 'Escape') {
      if (this.moodPop && claimKey(ev, this.moodPop)) {
        this.closeMood()
        return
      }
      if (keyClaimed(ev)) return
      if (this.tip) this.hideTooltip()
      this.shield?.close()
      return
    }
    if (keyClaimed(ev)) return
    const lower = key.toLowerCase()
    if (lower === 'g') {
      // G also closes an open Garage (its sheet is then the top modal).
      if (modalCount() === 0 || this.garageOpen()) {
        if (claimKey(ev, null) || this.garageOpen()) this.openGarage()
      }
      return
    }
    if (!claimKey(ev, null)) return
    switch (lower) {
      case ' ':
        ev.preventDefault?.()
        this.togglePause()
        return
      case '1':
        this.setSegment(1)
        return
      case '2':
        this.setSegment(2)
        return
      case '4':
        if (debugEnabled()) {
          if (this.paused.isOpen()) this.resumeFromCard()
          this.stepper.speed = 4
          this.lastRunSpeed = 4
        }
        return
      case 'w':
        this.gotoOther()
        return
    }
  }

  private garageOpen(): boolean {
    const sm = this.scene
    return sm.isActive('Garage') && !sm.isSleeping('Garage')
  }
}
