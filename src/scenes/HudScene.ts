// HudScene `HUD` (city-view.md §4, §8.1, §9.1, §9.7, §10, §11.2; plan.md §9):
// the persistent HUD over City / Warehouse. It never sleeps and never zooms;
// everything is laid out from L = computeLayout(W, H, safeTop, safeBottom,
// zoom) and re-laid out on scale resize and safe-area changes.
//
//   top bar      money (300 ms count tween, red flash on a negative delta,
//                floats), 5 life slots, mood face; level label + bar
//                (`$1,240 / $2,000`, `· Lv N coming soon` at a cap below
//                the last level, `$18,400 · Tycoon ✓` at the top), shield
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
// tickers the incident and opens the lost-life card LOST_LIFE_DELAY_MS
// later (the revealed label joins the sim's wanted list, M6); game:over
// opens the game-over screen instead (a life:lost while it is open is
// dropped). Modal cards hold
// the sim through `holds` (stepper.paused = any hold: lostLife, gameOver,
// hidden, rotate) so one card closing never resumes under another. The
// Warehouse button's badge / pulse / red are derived from sim state on every
// relevant event and at 2 Hz; the scripted first flag gets the red toast,
// the bouncing arrow over the button and the 10-s follow-up (§9.2); the
// first Toss of a run shows puns.json tossHint once.
//
// M3 (city-view §4.1, §4.3-§4.4, §8, §9.6-§9.7; plan.md §12.6 task 7): the
// level bar refills on level:up (a short full-then-grow sweep) and reads
// `$3,410 / $3,700 · Lv 3 coming soon` at a cap of 2 (`Lv 4 coming soon` at
// M8's cap of 3); the Newspaper (level / region papers once the level-up
// moment's stamp has played — STAMP_MS after level:up, §9.6 step 3 — the
// walkout paper, the
// incident paper once the lost-life card closes) waits while a modal card,
// sheet or the Paused card is up; ticker lines the HUD writes (level,
// region, strain, payroll, worker, mood, daily, incident, defused, stall)
// are flushed once per frame after the tick that caused them and dropped
// for any kind the sim announces itself through ticker:news (no doubled
// lines whichever side ships a kind); payday / payroll-short / walkout
// toasts; the Garage `!` also covers a short payday; the sax mute button
// drives the AudioDirector (registry 'audio') and shows `Tap for sound`
// while the audio waits for its first gesture (?skipTitle=1).
//
// M6 people (plan-build2 §8.3 task 10, design-m6 §6.3): `Lin hired —
// $24/day` / `Lin let go` toast a new / fired inspector or sorter (drivers
// toast from the Garage flow), a ★ hire runs a `hired` paper, the walkout
// line names the sorter's station, a sorter's / the Sorter Arm's Toss
// tickers `Pat tossed evil-lodash — DEFUSED` (the flag funnel and tossHint
// follow player tosses only), a fired driver re-reads the Garage `!`, and
// the wanted list is the sim's (`state.wanted`): the HUD no longer writes
// one. The money tap's `Payroll $N/day` is payroll().perDay over every
// active employee, sorters included. Event handlers read people and
// vehicles from the sim state (a fired employee is already gone from it:
// staffNames remembers the names): the ViewSim's people() / vehicles caches
// follow sim.revision, which a command or tick bumps only after its events —
// so the Garage badge is also re-read on the next frame (garageDirty).
//
// M7 quests (spec-build2 §3, plan-build2 §8.4 task 4, design-m7 §6.5): the
// QuestChip sits in row B between a shortened level bar (the `Lv N coming
// soon` suffix drops) and the shield while a quest is offered or active; a
// tap opens the QuestCard (offer: Accept / Later / Decline; active:
// Abandon / Close) on the modal stack without holding the sim. A new offer
// opens the card by itself when nothing else is up in the city
// (questCardAutoOpens; otherwise the chip pulses and it retries).
// quest:completed plays the gold `QUEST COMPLETE +$300` stamp rising from the
// toast lane at the money cell, turns an open card to its complete state and
// queues a quest / ★ paper; life:gained blinks the newly lit bomb slot (4–5
// light above 3) and toasts `+1 life — 4 of 5`; the district panel shows the
// quest row of its district; game:victory holds the sim ('victory') and opens
// the VictoryCard (Continue / New game / Run summary, whose Back returns to
// it). Quest ticker lines are the sim's (ticker:news 'quest' | 'questFailed',
// tinted by the Ticker). The questDone SFX is the audio director's. Event
// handlers mark the chip dirty and it re-reads quests() next frame (the
// ViewSim cache follows sim.revision, bumped after the tick's events).
//
// M8 overseas hubs (design-m8-m9 §6.3): the district panel's hub rows
// (`Clearance 45 s · 3 clearing · next 0:32`) re-read on the frame after a
// parcel:handedOff / parcel:cleared (districtDirty, like every district
// panel refresh event), a clearance's lost life reads `Handed off at
// Prefetch Pier 2 14:02` · `Cleared 14:47 — the ship has sailed` on the
// LostLifeCard, the daily line adds the day's paid clearances, dock:bought
// toasts `Loading dock 2 open — two vehicles unload at once`, and at the cap
// 3 the level bar reads `· Lv 4 coming soon` (data-driven,
// hudKit.cappedBelowNext).
//
// M9 L4 + L5 (design-m8-m9 §6.3; B2 §3.4, §4.2-§4.3): the cap is the last
// levels.json row, so nothing reads "coming soon" any more; at the top level
// (nextThreshold null) the level-up sweep leaves the bar full and the bar
// reads `$18,400 · Tycoon`, `$18,400 · Tycoon ✓` from game:victory on
// (vs.victory: re-read at once and on every sync, so a loaded endless save
// shows it), the compact bar beside the quest chip drops the suffix, and the
// level tap toasts `Tycoon — top level` / `Tycoon ✓ — endless mode`. The
// Golden Release is offered on the level:up {5} tick (M7's QuestCard, gold
// frame, opening once the level paper is gone), the VictoryCard's Continue
// releases the 'victory' hold into endless play, and the endless line
// (`Endless mode — the malware keeps evolving`) is the sim's ticker:news
// 'level' at the first day boundary after the Victory — the HUD adds
// nothing. An Airport clearance's lost life ends `— the plane has left`
// (hubText.sailedText from its map.hubs vessel, design R11).
//
// M4 (plan.md §12.7 tasks 1-2, §12.9): the PlaytestRecorder
// (src/metrics/playtest.ts) follows the sim from create (resumed from
// pm.playtest.v1 when this is the same run as the save, a fresh profile
// otherwise and on every Sim swap), counts canvas pointerdowns, samples
// game.loop.actualFps and the view, and is stored with every autosave (and
// every 10 s while the sim is held); registry REG_PLAYTEST hands it to
// __pm. The SummaryCard ('summary' hold) opens from the Paused card's
// `End run — show summary` — the Paused card is also the pause menu: ❚❚
// tapped while already paused opens it (the first pause toasts the hint) —
// from the game-over card's `Run summary` (its `Back` returns there), and is
// offered once at 20:00 of sim time by a ticker line + toast (Q55). `Keep
// playing` resumes at the last running speed; `New game` asks first during
// a live run.
//
// Sim events come through bindSim (attached while awake — always — and moved
// on a Sim swap, with syncAll on WAKE / swap). The autosave timer runs from
// update(); HIDDEN and pagehide save immediately. Keyboard: Space, 1, 2, 4
// (debug), W, G, Esc through the shared claimKey stack (src/ui/Sheet.ts);
// the Paused card is on that stack (report §6.5): under it W and G wait,
// Esc is the card's (resume), Space and the speed keys resume through it.
import Phaser from 'phaser'
import {
  Autosave,
  discardSave,
  getOnboarding,
  readPlaytest,
  readSettings,
  REG_ONBOARDING,
  REG_PENDING_TOAST,
  savedRun,
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
  SIM_REPLACED,
} from '../boot/simBinding.ts'
import type { Stepper } from '../boot/stepper.ts'
import type { GameData } from '../data/types.ts'
import { mountOverlay } from '../debug/overlay.ts'
import { debugEnabled, params } from '../debug/params.ts'
import {
  PlaytestRecorder,
  REG_PLAYTEST,
  SUMMARY_OFFER_S,
  type PlaytestDevice,
} from '../metrics/playtest.ts'
import { UI_ATLAS } from '../render/atlases.ts'
import { STAMP_MS, STAMP_RISE_MS, stampPose } from '../render/cityFx.ts'
import { buildingSprite } from '../render/frames.ts'
import { footprintAnchor, originX } from '../render/iso.ts'
import { visualTier } from '../render/warehouse/LaneRenderer.ts'
import {
  roomHeightForTier,
  roomPlacement,
} from '../render/warehouse/RoomLayout.ts'
import type {
  LifeLostPayload,
  SimEventPayloads,
  TickerKind,
} from '../sim/events.ts'
import type { OnboardingSave } from '../sim/save.ts'
import type { Sim } from '../sim/sim.ts'
import type { QuestReward, Role, VehicleType } from '../sim/types.ts'
import type { QuestView, ViewSim } from '../sim/view-api.ts'
import { Button } from '../ui/Button.ts'
import { Dialog } from '../ui/Dialog.ts'
import { DistrictPanel } from '../ui/DistrictPanel.ts'
import { FollowStrip } from '../ui/FollowStrip.ts'
import { dockBoughtToast } from '../ui/hubText.ts'
import {
  addTapZone,
  chipEntries,
  delegateDefusedLine,
  detectionColour,
  firedToast,
  firedToastsFor,
  floatsGold,
  garageAlert,
  hiredToast,
  hiredToastsFor,
  isEarned,
  levelLabel,
  levelProgress,
  lifeGainedToast,
  LIVES_TAP_TEXT,
  lockedRegionText,
  moneyTapText,
  moodFace,
  moodLine,
  newlyAffordableTypes,
  nextUnlockLine,
  nowPlayingText,
  paydayToast,
  payrollShortLine,
  questCardAutoOpens,
  regionOpenLine,
  setZoneRect,
  speedSegment,
  strainLine,
  strainsLive,
  TAP_FOR_SOUND_TEXT,
  TAP_PX,
  trendGlyph,
  walkoutGroupLine,
  walkoutLine,
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
  Newspaper,
  newsPicture,
  PAPER_DEPTH,
  PAPER_SFX,
  starHireHeadline,
  type NewsItem,
  type NewsKind,
} from '../ui/Newspaper.ts'
import {
  LOST_LIFE_DELAY_MS,
  LostLifeCard,
  lostLifeModel,
} from '../ui/LostLifeCard.ts'
import {
  FIRST_FLAG_CITY_TEXT,
  FIRST_FLAG_ROOM_TEXT,
  FLAG_FOLLOW_TEXT,
  firstFlagText,
  isFlagFunnelText,
  normaliseOnboarding,
  Onboarding,
  STEP2_DELAY_MS,
  step1Done,
  step1Text,
  step2Model,
  step2Text,
} from '../ui/Onboarding.ts'
import { addBar, addPanel, BAR_H, setBarFill } from '../ui/Panel.ts'
import { QuestCard, type QuestCardMode } from '../ui/QuestCard.ts'
import { QuestChip, questChipModel } from '../ui/QuestChip.ts'
import {
  newsHeadline,
  questBlockedBy,
  questWaitingOn,
  stampText,
} from '../ui/questText.ts'
import { TICKS_PER_S } from '../sim/types.ts'
import { PausedCard } from '../ui/PausedCard.ts'
import { RotateCard, wantsRotateCard } from '../ui/RotateCard.ts'
import {
  claimKey,
  keyClaimed,
  modalCount,
  popModal,
  pushModal,
  topModal,
} from '../ui/Sheet.ts'
import { ShieldPopover } from '../ui/ShieldPopover.ts'
import { SummaryCard, type SummaryMode } from '../ui/SummaryCard.ts'
import {
  addText,
  CAP_TOP,
  ellipsize,
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
import { VictoryCard, victoryModel } from '../ui/VictoryCard.ts'
import { failText } from '../ui/ZonePicker.ts'
import { GARAGE_SHEET_ID, toggleGarage } from './GarageSheet.ts'

// Game events (plan.md §5; the M1 cross-scene contract).
export const EV_SELECT = 'pm:select'
export const EV_FOLLOW = 'pm:follow'
export const EV_PAN_TO = 'pm:panTo'
export const EV_TOOLTIP = 'pm:tooltip'
export const EV_AUDIO_MUTED = 'audio:muted'
export const EV_AUDIO_NOW_PLAYING = 'audio:nowPlaying'

type SelectPayload = {
  kind: 'district' | 'locked' | 'building' | 'vehicle'
  id: string | number
}
type FollowPayload = { vehicleId: number | null }
type TooltipPayload = { text: string; x: number; y: number }

/** The parts of the M3 AudioDirector (registry 'audio') the HUD calls. */
interface AudioDirectorLike {
  setMuted?(muted: boolean, persist?: boolean): void
  toggleMuted?(): boolean
  isMuted?(): boolean
  resumeAfterPause?(): unknown
  unlock?(): unknown
  state?(): { unlocked?: boolean; disabled?: boolean; muted?: boolean }
}

/** A ticker line waiting for the end-of-tick flush (see flushLines). */
interface PendingLine {
  text: string
  kind: TickerKind
  /** 'sim' = ticker:news (always shown); 'hud' = dropped if the sim owns the kind. */
  src: 'sim' | 'hud'
}

/** A paper waiting for the end-of-tick flush (the level one may take the sim's text). */
interface PendingPaper {
  kind: NewsKind
  headline: string
  level: number
  district?: string
  /** M6 `hired`: the role, for its picture. */
  role?: Role
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
/** Level-up refill (§9.6 step 4): the bar shows full, then grows from 0. */
export const LEVEL_FULL_MS = 250
export const LEVEL_REFILL_MS = 600

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

// M4 (plan.md §12.7 task 2, §12.9, Q55).
/** The 20:00 offer (ticker line + toast), once per run. */
export const SUMMARY_OFFER_LINE =
  '20:00 on the clock — tap pause twice to see your run summary'
export const SUMMARY_OFFER_TOAST =
  'Twenty minutes in! Tap pause twice for your run summary'
/** The first ❚❚ of a session: where the pause menu lives. */
export const PAUSE_MENU_HINT_TEXT = 'Paused — tap pause again for the menu'
export const NEW_GAME_CONFIRM_TITLE = 'Start a new game?'
export const NEW_GAME_CONFIRM_TEXT = 'This run and its save will be lost.'

type Hold =
  | 'lostLife'
  | 'gameOver'
  | 'hidden'
  | 'rotate'
  | 'summary'
  /** M7: the VictoryCard (B2 §3.4 "modal, pauses"). */
  | 'victory'

// M7 (design-m7 §6.5).
/** game:victory → the VictoryCard after the completion stamp has risen. */
export const VICTORY_DELAY_MS = STAMP_RISE_MS
/** The stamp's pill: text inset and height. */
const QUEST_STAMP_PAD = 4
const QUEST_STAMP_H = 18

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
  paper: PAPER_DEPTH,
  audioHint: 36,
  floats: 40,
  /** M7: the QUEST COMPLETE stamp, above the top bar and the floats. */
  questStamp: 41,
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
  /** Re-read the Garage badge next frame (after the event's revision bump). */
  private garageDirty = false
  /** Re-read the open district panel next frame (same reason: vs.hubs()). */
  private districtDirty = false
  /** Employee id → name (worker:fired arrives after the sim dropped them). */
  private staffNames = new Map<number, string>()
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
  /** M8: paid overseas clearances today (the daily line). */
  private dayCleared = 0
  private dayEarned = 0
  private dayPayroll = 0
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

  // M3
  private paper!: Newspaper
  /** Ticker lines of this tick, flushed from update() (see flushLines). */
  private pendingLines: PendingLine[] = []
  private pendingPapers: PendingPaper[] = []
  /**
   * Papers held while the level-up moment plays (city-view §9.6: the dust,
   * tier swap and LEVEL stamp first, then step 3's ticker + newspaper);
   * `paperHoldMs` counts down on the HUD clock (frozen-clock safe).
   */
  private heldPapers: NewsItem[] = []
  private paperHoldMs = 0
  /** Ticker kinds the sim emits itself (ticker:news): the HUD stops writing them. */
  private simKinds = new Set<string>()
  /** day:ended seen this tick: the daily line is built at the flush. */
  private dailyDay: number | null = null
  /** Incident papers waiting for the lost-life card to close (§8.2). */
  private incidentPapers: NewsItem[] = []
  /** Strains whose `New strain spotted` line ran (or predates this session). */
  private strainsTold = new Set<string>()
  /** Last in-game day a mood line ran, per district (once per day, §8.1). */
  private moodDay = new Map<string, number>()
  /** Level-bar refill sweep (ms since level:up), or null. */
  private levelAnim: number | null = null
  private levelTarget = 0
  private audioHint: Phaser.GameObjects.Container | null = null
  /** The last `Now playing` title toasted (once per title). */
  private lastTitle: string | null = null
  /** The current gesture began on `Tap for sound`: its tap never mutes. */
  private hintGesture = false
  /** This tick's walkouts: one toast + one paper for the lot (flushLines). */
  private pendingWalkouts: { name: string; text: string }[] = []

  // M4
  private recorder!: PlaytestRecorder
  private summary!: SummaryCard
  /** Canvas pointerdowns this session (the recorder's `taps`). */
  private tapCount = 0
  /** The Paused card is up as the pause menu (❚❚ while paused), not auto-pause. */
  private pauseMenu = false
  /** The first-pause hint toast ran this session. */
  private pauseHinted = false
  private newGameDialog: Dialog | null = null

  // M7
  private questChip!: QuestChip
  private questCard!: QuestCard
  private victoryCard!: VictoryCard
  /** Re-read quests() next frame (after the event's revision bump). */
  private questDirty = false
  /** The chip shows: the level bar is the short one (L.levelBarChip). */
  private chipShown = false
  /** An offer waiting to open its card by itself (questCardAutoOpens). */
  private questAutoOpen: { id: string; force: boolean } | null = null
  /**
   * The quest slots as last read (by id): quest:completed fires after the
   * quest left its slot, and a ViewSim read inside the tick may be stale.
   */
  private questSeen = new Map<string, QuestView>()
  /** The rising QUEST COMPLETE stamp (ms on the HUD clock). */
  private questStamp: {
    root: Phaser.GameObjects.Container
    ms: number
  } | null = null
  private victoryTimer: Phaser.Time.TimerEvent | null = null
  /** The summary card was opened from the VictoryCard (its Back returns there). */
  private summaryFromVictory = false
  /** The next syncQuests is create()'s (a standing offer opens its card). */
  private questBootSync = true

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
    this.dayCleared = 0
    this.dayEarned = 0
    this.dayPayroll = 0
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
    this.pendingLines = []
    this.pendingPapers = []
    this.heldPapers = []
    this.paperHoldMs = 0
    this.simKinds = new Set()
    this.dailyDay = null
    this.incidentPapers = []
    this.strainsTold = new Set()
    this.moodDay = new Map()
    this.levelAnim = null
    this.levelTarget = 0
    this.audioHint = null
    this.pendingWalkouts = []
    this.hintGesture = false
    this.lastTitle = null
    this.tapCount = 0
    this.pauseMenu = false
    this.pauseHinted = false
    this.newGameDialog = null
    this.garageDirty = false
    this.districtDirty = false
    this.staffNames = new Map()
    this.questDirty = false
    this.chipShown = false
    this.questAutoOpen = null
    this.questSeen = new Map()
    this.questStamp = null
    this.victoryTimer = null
    this.summaryFromVictory = false
    this.questBootSync = true
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
      onSummary: () => this.openSummary('run'),
    })
    this.rotate = new RotateCard(this, this.L.W, this.L.H)
    this.district = new DistrictPanel(this, this.L, this.vs, {
      onQuest: (id) => this.openQuestCardFor(id),
    })
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
      onSummary: () => this.openSummary('over'),
    })
    this.summary = new SummaryCard(this, this.L, {
      data: this.gd,
      onClose: (mode) => this.closeSummary(mode),
      onNewGame: (mode) => this.summaryNewGame(mode),
      current: () => this.recorder.snapshot(),
    })
    this.paper = new Newspaper(this, this.L, {
      companyName: this.gd.puns.companyName,
      depth: D.paper,
      onShown: () => this.game.events.emit('ui:sfx', { name: PAPER_SFX }),
    })
    this.questCard = new QuestCard(this, this.L, this.gd, {
      onAccept: (id) => this.onQuestAccept(id),
      onLater: () => this.closeQuestCard(),
      onDecline: (id) => this.onQuestDecline(id),
      onAbandon: (id) => this.onQuestAbandon(id),
      onClose: () => this.closeQuestCard(),
      // The Golden Release offered while a regular quest runs (design-m7 §4):
      // its card says so, and the active card (the chip's) names it.
      blockedBy: (q) => questBlockedBy(this.vs.quests(), q),
      waitingOn: (q) => questWaitingOn(this.vs.quests(), q),
    })
    this.victoryCard = new VictoryCard(this, this.L, this.gd, {
      onContinue: () => this.continueAfterVictory(),
      onNewGame: () => this.confirmNewGame(),
      onSummary: () => this.openVictorySummary(),
    })

    this.autosave = new Autosave({
      getSim: () => getSim(this) ?? null,
      getOnboarding: () =>
        (this.registry.get(REG_ONBOARDING) as OnboardingSave | undefined) ??
        null,
      build: String(this.registry.get(REG.buildStamp) ?? __BUILD_STAMP__),
      now: () => Date.now(),
      onError: (msg) => this.toast.show(msg, true),
      getPlaytest: () => this.recorder?.persisted() ?? null,
    })
    this.startRecorder()

    if (debugEnabled())
      mountOverlay(this, 2, this.L.toast.y + this.L.toast.h + 2)

    this.bindEvents()
    this.syncAll()
    this.updateRotate()

    // A fresh game starts with the opening ticker line (levels.json L1).
    if (this.vs.tick < 10 && this.vs.level === 1)
      this.queueLine(this.gd.levels[0]?.ticker ?? '', 'level')
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
    this.recorder.update()
    // Lines and papers queued by the last tick's events (all of them have
    // fired by now, whatever their order inside the tick).
    this.flushLines()
    this.releaseHeldPapers(delta)
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

    if (this.garageDirty) {
      this.garageDirty = false
      this.applyGarageBadge()
    }
    if (this.questDirty) this.refreshQuest()
    if (this.districtDirty) {
      this.districtDirty = false
      if (this.district?.isOpen()) this.district.refresh()
    }
    if (this.questAutoOpen) this.tryAutoOpenQuest()
    if (time >= this.pollAt) {
      this.pollAt = time + POLL_MS
      this.refreshQuest(false)
      this.refreshShield()
      this.refreshWarehouseBtn()
      this.refreshChipActive()
      this.pollStep3()
      this.pollStrains()
      this.refreshAudioHint()
      this.pollSummaryOffer()
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
    this.paper.update(delta, this.paperSuppressed())
    this.onboarding.setSuppressed(
      modalCount() > 0 ||
        this.view !== 'city' ||
        this.overlapsCityTooltip() ||
        this.paper.isVisible() ||
        this.audioHint !== null,
    )
    this.onboarding.update(time)
    this.updateLevelAnim(delta)
    this.updateQuestStamp(delta)
    this.updateFlash(time)
    this.updateTopShake(time)
    this.updateFlagArrow(time)
    if (this.saveSoon) {
      const final = this.saveSoon === 'final'
      this.saveSoon = null
      this.autosave.save('manual')
      if (final) this.autosave.enabled = false
    } else if (!st.paused) this.autosave.tick(delta)
    else this.autosave.tickPlaytest(delta)
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
      this.questChip.root,
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
      !this.overCard.isOpen() &&
      !this.summary.isOpen() &&
      !this.victoryCard.isOpen
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
    const headline = incidentLine(this.buildingName(p.destBuildingId), left)
    this.queueLine(headline, 'incident')
    // Persist the loss right after this tick (a reload must not replay the
    // delivery); the revealed label is in the sim's wanted list (M6).
    if (this.saveSoon !== 'final') this.saveSoon = 'save'
    if (left <= 0 || this.vs.gameOver) return // game:over takes over
    // The day's paper for the incident comes once the card closes (§8.2).
    this.incidentPapers.push({
      kind: 'incident',
      headline,
      day: this.vs.day + 1,
      level: this.vs.level,
      picture: newsPicture('incident', this.gd),
    })
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

  /**
   * Close the panels a modal card must not sit under; sleep the Garage. The
   * QuestCard goes too (an offer stays in its slot), unless it is the card
   * being opened (`keepQuest`).
   */
  private prepareModal(keepQuest = false): void {
    if (this.garageOpen()) this.scene.sleep('Garage')
    this.closeMood()
    this.shield?.close()
    if (this.district?.isOpen()) this.district.close()
    this.hideTooltip()
    if (!keepQuest) this.closeQuestCard()
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

  /** game:over (city-view §9.4): hold now, the screen after the effects. */
  private onGameOver(): void {
    this.hold('gameOver')
    this.lostQueue = []
    this.incidentPapers = []
    this.pendingPapers = []
    this.heldPapers = []
    this.paperHoldMs = 0
    this.pendingWalkouts = []
    this.paper.clear()
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
    this.paper.clear()
    this.saveSoon = null
    // The ended run's profile stays in pm.playtest.v1 until the next run's
    // first autosave replaces it.
    this.autosave.savePlaytest()
    this.autosave.enabled = false
    discardSave()
    this.scene.start('Title', { fresh: true })
  }

  // ---------------------------------------------------------------- M4: playtest + summary

  /** The device facts of the profile (plan.md §12.9 `device`). */
  private deviceInfo(): PlaytestDevice {
    let maxTexture = 0
    try {
      const r = this.game.renderer as { getMaxTextureSize?: () => number }
      maxTexture = r.getMaxTextureSize?.() ?? 0
    } catch {
      maxTexture = 0
    }
    return {
      ua: navigator.userAgent,
      cssW: window.innerWidth,
      cssH: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      zoom: this.scale.zoom,
      maxTexture,
    }
  }

  /**
   * The recorder for this HUD: it resumes pm.playtest.v1 only when the
   * running sim is the run the autosave holds (Continue, a reload) and the
   * stored profile matches it; a New game starts a fresh profile.
   */
  private startRecorder(): void {
    this.recorder = new PlaytestRecorder({
      buildStamp: String(this.registry.get(REG.buildStamp) ?? __BUILD_STAMP__),
      device: () => this.deviceInfo(),
      now: () => Date.now(),
      fps: () => this.game.loop.actualFps,
      pointerDowns: () => this.tapCount,
      isPaused: () => this.stepper.paused || this.stepper.speed === 0,
    })
    const sim = getSim(this)
    this.recorder.attach(sim, this.resumesSave(sim) ? readPlaytest() : null)
    this.recorder.setView(this.view)
    this.registry.set(REG_PLAYTEST, this.recorder)
  }

  /** The sim is the autosave's run (same seed, within 5 s of its tick). */
  private resumesSave(sim: Sim): boolean {
    const run = savedRun()
    return (
      run !== null &&
      run.seed === sim.state.seed &&
      Math.abs(run.tick - sim.state.tick) <= 5 * TICKS_PER_S
    )
  }

  /** Q55: once per run at 20:00 of sim time, a ticker line + toast offer. */
  private pollSummaryOffer(): void {
    const r = this.recorder
    if (r.offered || this.vs.gameOver || this.summary.isOpen()) return
    if (this.vs.tick < SUMMARY_OFFER_S * TICKS_PER_S) return
    r.markOffered()
    this.ticker.push(SUMMARY_OFFER_LINE, 'offer')
    this.longToast(SUMMARY_OFFER_TOAST, false, HINT_TOAST_MS)
  }

  /** ❚❚ while paused: the Paused card as the pause menu. */
  private openPauseMenu(): void {
    if (this.paused.isOpen() || this.holds.size > 0 || this.summary.isOpen())
      return
    this.prepareModal()
    this.pauseMenu = true
    this.paused.show()
    // The first-pause hint has done its job once the menu is up.
    if (
      this.toast.currentText() === PAUSE_MENU_HINT_TEXT &&
      this.toast.pending() === 0
    )
      this.toast.clear()
  }

  /** `End run — show summary` (run) / the game-over card's `Run summary` (over). */
  private openSummary(mode: SummaryMode): void {
    if (this.summary.isOpen()) return
    this.prepareModal()
    // Held by the card before any other hold lets go (no frame of play).
    this.hold('summary')
    if (this.paused.isOpen()) {
      this.paused.hide()
      this.pauseMenu = false
      if (this.autoPaused) {
        this.autoPaused = false
        this.release('hidden')
      }
    }
    if (mode === 'over') this.overCard.close()
    this.recorder.noteSummaryOpened()
    this.summary.open(
      this.recorder.snapshot(),
      mode,
      this.recorder.summaryOpenedS,
    )
    // Store the profile with its first opening (fun bar 4) right away.
    this.autosave.savePlaytest()
  }

  /**
   * `Keep playing` (the last running speed) / `Back` (the game-over card, or
   * the VictoryCard it was opened from).
   */
  private closeSummary(mode: SummaryMode): void {
    if (!this.summary.isOpen()) return
    this.newGameDialog?.destroy()
    this.newGameDialog = null
    this.summary.close()
    this.release('summary')
    if (this.summaryFromVictory) {
      this.summaryFromVictory = false
      if (!this.vs.gameOver) {
        this.openVictory()
        return
      }
      this.release('victory')
    }
    if (mode === 'over' || this.vs.gameOver) {
      if (!this.overCard.isOpen()) this.openGameOver()
      return
    }
    if (this.stepper.speed === 0) this.stepper.speed = this.lastRunSpeed
  }

  /** `New game` on the summary: straight after a game over, else confirmed. */
  private summaryNewGame(mode: SummaryMode): void {
    if ((mode === 'over' && !this.summaryFromVictory) || this.vs.gameOver) {
      this.newGame()
      return
    }
    this.confirmNewGame()
  }

  /**
   * `New game` during a live run (the summary's, the VictoryCard's): a
   * confirm Dialog first, then the game-over card's new-game path.
   */
  private confirmNewGame(): void {
    if (this.newGameDialog) return
    this.newGameDialog = new Dialog(this, {
      title: NEW_GAME_CONFIRM_TITLE,
      text: NEW_GAME_CONFIRM_TEXT,
      action: 'New game',
      destructive: true,
      minHit: this.L.minHit,
      id: 'summary:confirmNewGame',
      onConfirm: () => {
        this.newGameDialog = null
        this.newGame()
      },
      onCancel: () => {
        this.newGameDialog = null
      },
    })
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

  /**
   * parcel:tossed: the DEFUSED ticker (the sim appends the label to its
   * wanted list); a player Toss also ends the flag funnel and shows the
   * one-time tossHint. A sorter's / the Sorter Arm's Toss (M6 `source`)
   * tickers `Pat tossed evil-lodash — DEFUSED` and leaves the tour alone.
   */
  private onTossed(p: SimEventPayloads['parcel:tossed']): void {
    this.refreshWarehouseBtn()
    const label = this.vs.parcel(p.id)?.label ?? this.heldLabels.get(p.id)
    this.heldLabels.delete(p.id)
    if (p.source === 'sorter' || p.source === 'arm') {
      if (p.wasMalware && label) {
        const who =
          p.source === 'sorter' && p.employeeId !== null
            ? (this.employeeNames([p.employeeId])[0] ?? null)
            : null
        this.queueLine(delegateDefusedLine(who, label), 'defused')
      }
      return
    }
    const ob = getOnboarding(this.registry)
    if (p.wasMalware && label) this.queueLine(defusedLine(label), 'defused')
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

  // ---------------------------------------------------------------- M7: quests

  /**
   * Re-read the quest slots (next frame after a quest event, and at 2 Hz):
   * the chip (and the level bar it shortens), an open card, the district
   * panel's quest row (`district`: the panel re-reads itself at 2 Hz).
   * Remembers the quests in the slots by id for quest:completed.
   */
  private refreshQuest(district = true): void {
    this.questDirty = false
    const qs = this.vs.quests()
    // Only the slots: a quest that left them was handled by its event.
    this.questSeen.clear()
    if (qs.offer) this.questSeen.set(qs.offer.id, qs.offer)
    if (qs.active) this.questSeen.set(qs.active.id, qs.active)
    const m = questChipModel(qs, this.gd)
    this.questChip.set(m)
    if (m.visible !== this.chipShown) {
      this.chipShown = m.visible
      if (!this.topShake) this.layoutTopBar()
    }
    const card = this.questCard
    if (card.isOpen && card.mode !== 'complete') {
      const id = card.questId
      const q =
        qs.active?.id === id ? qs.active : qs.offer?.id === id ? qs.offer : null
      card.refresh(q, this.vs.tick)
    }
    if (district) this.refreshDistrict()
  }

  /**
   * A new offer opens its card once nothing else is up (questCardAutoOpens);
   * it stops trying when the offer is gone, accepted or already on screen.
   */
  private tryAutoOpenQuest(): void {
    const want = this.questAutoOpen
    if (!want) return
    const qs = this.vs.quests()
    const q = qs.offer
    if (!q || q.id !== want.id || this.vs.gameOver) {
      this.questAutoOpen = null
      return
    }
    if (this.questCard.isOpen) {
      if (this.questCard.questId === q.id) this.questAutoOpen = null
      return
    }
    const ok = questCardAutoOpens({
      modals: modalCount(),
      onboardingStep: this.onboarding.activeStep,
      view: this.view,
      held: this.holds.size > 0 || this.paused.isOpen(),
      paperVisible: this.paperBusy(),
      blocked: q.ultimate && qs.active !== null,
      force: want.force,
      policy: this.stepper.policy !== null,
    })
    if (!ok) return
    this.questAutoOpen = null
    this.openQuestCard(q)
  }

  /**
   * A paper is up, queued or held for the level-up moment: a new offer's
   * card waits for it (both sit above the bottom bar).
   */
  private paperBusy(): boolean {
    const q = this.paper.queue
    return (
      this.paper.isVisible() ||
      q.current !== null ||
      q.waiting.length > 0 ||
      this.paperHoldMs > 0 ||
      this.heldPapers.length > 0 ||
      this.pendingPapers.length > 0
    )
  }

  /** The chip: the active quest's card (Abandon), else the offer's. */
  private onQuestChipTap(): void {
    const qs = this.vs.quests()
    const q = qs.active ?? qs.offer
    if (!q) return
    if (this.questCard.isOpen && this.questCard.questId === q.id) {
      this.closeQuestCard()
      return
    }
    this.openQuestCard(q)
  }

  /** The district panel's quest row: that quest's card. */
  private openQuestCardFor(id: string): void {
    const qs = this.vs.quests()
    const q =
      qs.active?.id === id ? qs.active : qs.offer?.id === id ? qs.offer : null
    if (q) this.openQuestCard(q)
  }

  private openQuestCard(q: QuestView): void {
    if (this.vs.gameOver || this.holds.size > 0) return
    this.prepareModal(true)
    if (this.questAutoOpen?.id === q.id) this.questAutoOpen = null
    const mode: QuestCardMode = q.status === 'active' ? 'active' : 'offer'
    this.questCard.open(q, mode, this.vs.tick, this.vs.day + 1)
  }

  private closeQuestCard(): void {
    if (this.questCard.isOpen) this.questCard.close()
  }

  /** Accept: the chip takes over; a refusal shakes the card (or closes it when the offer is gone). */
  private onQuestAccept(id: string): void {
    const r = this.vs.quest.accept(id)
    this.questDirty = true
    if (r.ok) {
      this.closeQuestCard()
      return
    }
    const text = failText(r.reason, this.gd)
    if (r.reason === 'quest-expired' || r.reason === 'invalid') {
      this.closeQuestCard()
      this.toast.show(text, true)
      return
    }
    this.questCard.deny(text)
  }

  private onQuestDecline(id: string): void {
    this.vs.quest.decline(id)
    this.questDirty = true
    this.closeQuestCard()
  }

  /** Abandon (the card confirmed it): no penalty (Q-B2-7), the card closes. */
  private onQuestAbandon(_id: string): void {
    this.vs.quest.abandon()
    this.questDirty = true
    this.closeQuestCard()
  }

  /**
   * quest:completed (spec-build2 §3.1): an open card on that quest turns to
   * its complete state, the gold stamp rises at the money cell and a quest
   * (or ★ applicant) paper follows. The quest has left its slot already: its
   * last view comes from questSeen (no paper when it was never seen).
   */
  private onQuestCompleted(p: SimEventPayloads['quest:completed']): void {
    this.questDirty = true
    const q = this.questSeen.get(p.questId) ?? null
    this.questSeen.delete(p.questId)
    if (q && this.questCard.isOpen && this.questCard.questId === p.questId)
      this.questCard.showComplete(q, p.reward)
    this.showQuestStamp(p.reward)
    if (!q) return
    const h = newsHeadline(this.gd, q, p.reward)
    this.queuePaper({ kind: h.kind, headline: h.text, level: this.vs.level })
  }

  /**
   * The `QUEST COMPLETE +$300` stamp: dark text on the gold ui_tag pill,
   * left-aligned at the money cell, rising from the toast lane's top with
   * the level stamp's pose (cityFx.stampPose: 24 px / 1.2 s, hold, fade).
   */
  private showQuestStamp(r: QuestReward): void {
    this.questStamp?.root.destroy()
    this.questStamp = null
    const text = stampText(this.gd, r)
    if (!text) return
    const t = addText(this, QUEST_STAMP_PAD, 0, text)
    t.setY(textTop(0, QUEST_STAMP_H))
    const bg = addPanel(
      this,
      0,
      0,
      Math.round(t.width) + 2 * QUEST_STAMP_PAD,
      QUEST_STAMP_H,
      'ui_tag',
    )
    const root = this.add
      .container(this.L.money.rect.x, this.L.toast.y, [bg, t])
      .setDepth(D.questStamp)
    this.questStamp = { root, ms: 0 }
    this.updateQuestStamp(0)
  }

  private updateQuestStamp(delta: number): void {
    const st = this.questStamp
    if (!st) return
    st.ms += Math.max(0, Math.min(delta, 100))
    const pose = stampPose(st.ms)
    if (!pose) {
      st.root.destroy()
      this.questStamp = null
      return
    }
    const dy = reducedMotion() ? 0 : pose.dy
    st.root
      .setPosition(this.L.money.rect.x, this.L.toast.y + dy)
      .setAlpha(pose.alpha)
  }

  /** life:gained (magic parcel / quest reward): slots 4–5 light, a toast. */
  private onLifeGained(p: SimEventPayloads['life:gained']): void {
    this.lives.gainLife(p.lives)
    this.toast.show(
      lifeGainedToast(p.lives, p.delta, this.gd.economy.lives.cap),
    )
    if (this.saveSoon !== 'final') this.saveSoon = 'save'
  }

  /** game:victory (spec-build2 §3.4): hold now, the VictoryCard once the stamp has risen. */
  private onVictory(): void {
    this.hold('victory')
    this.questDirty = true
    // M9: the level bar turns `$18,400 · Tycoon ✓` (economy.victory is set).
    this.refreshLevel()
    // Persist the victory right after this tick.
    if (this.saveSoon !== 'final') this.saveSoon = 'save'
    if (this.victoryTimer || this.victoryCard.isOpen) return
    this.victoryTimer = this.time.delayedCall(
      reducedMotion() ? 0 : VICTORY_DELAY_MS,
      () => {
        this.victoryTimer = null
        this.openVictory()
      },
    )
  }

  private openVictory(): void {
    if (this.victoryCard.isOpen) return
    if (this.vs.gameOver) {
      this.release('victory')
      return
    }
    this.prepareModal()
    const s = getSim(this).state
    this.victoryCard.open(
      victoryModel(
        {
          day: s.day,
          lifetimeEarned: s.economy.lifetimeEarned,
          deliveries: s.stats.deliveries,
          malwareMissed: s.stats.malwareMissed,
          defused: s.lane.quarantine.malware,
          lives: s.economy.lives,
          level: s.level.level,
          victoryTick: s.stats.victoryTick ?? s.tick,
        },
        this.gd,
      ),
    )
    this.hold('victory')
  }

  /** `Continue` (endless): the card closes and the sim runs on. */
  private continueAfterVictory(): void {
    this.victoryCard.close()
    this.release('victory')
  }

  /** `Run summary` from the VictoryCard: its `Back` returns to the card. */
  private openVictorySummary(): void {
    this.victoryCard.close()
    this.summaryFromVictory = true
    this.openSummary('over')
  }

  /**
   * create / WAKE / Sim swap: the chip from quests(), the card closed, a
   * stale victory screen or stamp gone (the victory shows on its event
   * only). At create a standing offer opens its card (a reload, Boot's
   * `?quest=` offer, made before the HUD listened); after a swap (__pm.load,
   * a fixture) the chip just pulses, so a swap leaves the modal stack empty.
   */
  private syncQuests(): void {
    const boot = this.questBootSync
    this.questBootSync = false
    this.questSeen.clear()
    this.closeQuestCard()
    this.questStamp?.root.destroy()
    this.questStamp = null
    this.victoryTimer?.remove(false)
    this.victoryTimer = null
    if (this.victoryCard.isOpen) this.victoryCard.close()
    this.summaryFromVictory = false
    this.release('victory')
    const qs = this.vs.quests()
    this.questAutoOpen =
      boot && qs.offer && !qs.active ? { id: qs.offer.id, force: true } : null
    this.refreshQuest()
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

  // ---------------------------------------------------------------- M3: ticker + papers

  /** A HUD-written ticker line, shown at the end-of-tick flush. */
  private queueLine(text: string, kind: TickerKind): void {
    if (text) this.pendingLines.push({ text, kind, src: 'hud' })
  }

  /** A newspaper for this tick's event (city-view §8.2), shown at the flush. */
  private queuePaper(p: PendingPaper): void {
    this.pendingPapers.push(p)
  }

  /**
   * Once per frame, after the tick(s) that queued them: the daily summary
   * (built now so the same-tick payday is in it), then the ticker lines —
   * a HUD line is dropped when the sim writes that kind itself
   * (ticker:news; the payroll / worker kinds count as one) — then the papers
   * (the level paper's headline is the sim's level line when there is one).
   */
  private flushLines(): void {
    if (this.dailyDay !== null) {
      const day = this.dailyDay
      this.dailyDay = null
      this.queueLine(
        dailyLine(
          day,
          this.dayDelivered,
          this.dayEarned,
          this.dayPayroll,
          this.dayCleared,
        ),
        'daily',
      )
      this.dayDelivered = 0
      this.dayCleared = 0
      this.dayEarned = 0
      this.dayPayroll = 0
    }
    this.flushWalkouts()
    const lines = this.pendingLines
    const papers = this.pendingPapers
    if (lines.length === 0 && papers.length === 0) return
    this.pendingLines = []
    this.pendingPapers = []
    for (const l of lines) {
      if (l.src === 'hud' && this.simOwns(l.kind)) continue
      this.ticker.push(l.text, l.kind)
    }
    for (const p of papers) {
      const sim =
        p.kind === 'level'
          ? lines.find((l) => l.src === 'sim' && l.kind === 'level')
          : undefined
      const item: NewsItem = {
        kind: p.kind,
        headline: sim?.text ?? p.headline,
        day: this.vs.day + 1,
        level: p.level,
        picture: newsPicture(p.kind, this.gd, {
          level: p.level,
          ...(p.district ? { district: p.district } : {}),
          ...(p.role ? { role: p.role } : {}),
        }),
      }
      if (this.paperHoldMs > 0) this.heldPapers.push(item)
      else this.paper.push(item)
    }
  }

  /** Count the level-up hold down; then the held papers show, in order. */
  private releaseHeldPapers(delta: number): void {
    if (this.paperHoldMs <= 0) return
    this.paperHoldMs = Math.max(0, this.paperHoldMs - delta)
    if (this.paperHoldMs > 0) return
    const items = this.heldPapers
    this.heldPapers = []
    for (const it of items) this.paper.push(it)
  }

  /**
   * The walkouts of one payday: one red toast, one ticker line and one
   * `walkout` paper (a single name keeps its own line, several are grouped:
   * five 40-px/s lines kept "X walked out" scrolling for over a minute after
   * the re-hires — UX M3 review).
   */
  private flushWalkouts(): void {
    const w = this.pendingWalkouts
    if (w.length === 0) return
    this.pendingWalkouts = []
    const text =
      w.length === 1
        ? (w[0]?.text ?? '')
        : walkoutGroupLine(
            w.map((x) => x.name),
            this.gd.employees.walkoutAfterUnpaidPaydays,
          )
    this.queueLine(text, 'worker')
    this.toast.show(text, true)
    this.queuePaper({ kind: 'walkout', headline: text, level: this.vs.level })
  }

  /** The sim writes this ticker kind itself (payroll and worker are one family). */
  private simOwns(kind: TickerKind): boolean {
    if (this.simKinds.has(kind)) return true
    if (kind === 'payroll' || kind === 'worker')
      return this.simKinds.has('payroll') || this.simKinds.has('worker')
    return false
  }

  /**
   * The newspaper waits (hidden, clock stopped) under anything modal: the
   * lost-life / game-over cards (and their 600-ms lead-in), the Paused and
   * rotate cards, a sheet, popover or dialog.
   */
  private paperSuppressed(): boolean {
    return (
      this.holds.size > 0 ||
      this.paused.isOpen() ||
      this.rotate.isOpen() ||
      modalCount() > 0 ||
      this.lostTimer !== null ||
      this.overTimer !== null ||
      this.victoryTimer !== null ||
      this.lostCard.isOpen() ||
      this.overCard.isOpen() ||
      this.victoryCard.isOpen
    )
  }

  /** The incident papers of the lost lives, once the card has closed (§8.2). */
  private queueIncidentPaper(): void {
    const items = this.incidentPapers
    this.incidentPapers = []
    for (const it of items) this.paper.push(it)
  }

  /**
   * `strain` kind: `New strain spotted: rattle` the tick a strain announced
   * after the start enters the spawn pool (announced + newStrainDelayS) —
   * unless the sim writes the line itself (ticker:news 'strain').
   */
  private pollStrains(): void {
    for (const strain of this.liveStrains()) {
      if (this.strainsTold.has(strain)) continue
      this.strainsTold.add(strain)
      this.queueLine(strainLine(strain), 'strain')
    }
  }

  private liveStrains(): string[] {
    const s = getSim(this)?.state
    if (!s) return []
    const later: Partial<Record<string, number>> = {}
    for (const [k, t] of Object.entries(s.level.announced))
      if (t !== undefined && t > 0) later[k] = t
    return strainsLive(
      later,
      s.tick,
      Math.round(this.gd.parcels.malware.newStrainDelayS * TICKS_PER_S),
    )
  }

  /** satisfaction:changed → `mood` line on a 30 / 80 crossing, once per district per day. */
  private onSatisfaction(p: SimEventPayloads['satisfaction:changed']): void {
    this.refreshMood()
    this.refreshDistrict()
    const line = moodLine(this.gd, p.district, p.value, p.delta)
    if (!line) return
    const day = this.vs.day
    if (this.moodDay.get(p.district) === day) return
    this.moodDay.set(p.district, day)
    this.queueLine(line, 'mood')
  }

  /** level:up (city-view §9.6, HUD side). */
  private onLevelUp(p: SimEventPayloads['level:up']): void {
    // Step 4: the bar shows full, then refills from 0 toward the next
    // threshold — at the top level (M9: no next threshold) it just stays full.
    this.levelAnim =
      reducedMotion() || this.vs.nextThreshold === null ? null : 0
    this.refreshLevel()
    this.refreshShield()
    this.refreshChips()
    this.refreshGarageBadge()
    this.syncToastLane()
    const row = this.gd.levels.find((l) => l.level === p.level)
    if (!row) return
    this.queueLine(row.ticker, 'level')
    // Step 3 after steps 1-2: the papers wait for the city's stamp to end.
    this.paperHoldMs = reducedMotion() ? 0 : STAMP_MS
    this.queuePaper({ kind: 'level', headline: row.ticker, level: p.level })
  }

  /**
   * dock:bought (M8, design-m8-m9 §6.3): `Loading dock 2 open — two vehicles
   * unload at once` (the count from the lane after the buy: dock 3 before
   * dock 2 still reads two).
   */
  private onDockBought(p: SimEventPayloads['dock:bought']): void {
    const owned = getSim(this).state.lane.docks.length
    this.toast.show(dockBoughtToast(p.index, owned))
  }

  /** region:unlocked: the chip with its NEW badge, the region line and paper. */
  private onRegionUnlocked(p: SimEventPayloads['region:unlocked']): void {
    this.newChips.add(p.district)
    this.refreshChips()
    this.refreshMood()
    this.refreshDistrict()
    const line = regionOpenLine(this.gd, p.district)
    this.queueLine(line, 'region')
    this.queuePaper({
      kind: 'region',
      headline: line,
      level: this.vs.level,
      district: p.district,
    })
  }

  /**
   * worker:hired (M6): `Lin hired — $24/day` for a new inspector or sorter
   * (a driver's hire toasts from the Garage buy / Replace flow; a re-hire
   * from its card) and a `hired` paper for a ★ applicant (spec-build2 §2.5).
   */
  private onHired(p: SimEventPayloads['worker:hired']): void {
    this.refreshGarageBadge()
    this.refreshShield()
    // Onboarding step 1 is "buy a bike AND pick its driver": the first driver
    // hire (the buy flow's pick, or Hire driver after a `Hire later`).
    if (p.role === 'driver') this.completeStep1()
    if (p.rehire) return
    // From the state: the ViewSim's people() cache is a revision behind here.
    const e = getSim(this).state.employees.find((x) => x.id === p.employeeId)
    if (!e) return
    this.staffNames.set(e.id, e.name)
    if (hiredToastsFor(p)) this.toast.show(hiredToast(e.name, e.salaryPerDay))
    if (p.star)
      this.queuePaper({
        kind: 'hired',
        headline: starHireHeadline(e.name, p.role),
        level: this.vs.level,
        role: p.role,
      })
  }

  /**
   * worker:fired (M6): `Lin let go` for an inspector or sorter the player
   * fired; a fired driver leaves `No driver` (the Garage `!`). The employee
   * is gone from the state by now: the name comes from staffNames.
   */
  private onFired(p: SimEventPayloads['worker:fired']): void {
    this.refreshShield()
    this.refreshGarageBadge()
    const name = this.staffNames.get(p.employeeId)
    this.staffNames.delete(p.employeeId)
    if (name && firedToastsFor(p)) this.toast.show(firedToast(name))
  }

  private onPayrollPaid(p: SimEventPayloads['payroll:paid']): void {
    this.dayPayroll += p.amount
    if (p.amount > 0) {
      const t = paydayToast(p.amount)
      this.toast.show(t.text, false, t.redFrom)
    }
    this.refreshGarageBadge()
  }

  private onPayrollShort(p: SimEventPayloads['payroll:short']): void {
    const text = payrollShortLine(this.employeeNames(p.employeeIds))
    this.toast.show(text, true)
    this.queueLine(text, 'payroll')
    this.refreshGarageBadge()
  }

  private onWalkedOut(p: SimEventPayloads['worker:walkedOut']): void {
    const [name = `#${p.employeeId}`] = this.employeeNames([p.employeeId])
    const v =
      p.role === 'driver' && p.vehicleId !== null
        ? getSim(this).state.vehicles.find((x) => x.id === p.vehicleId)
        : undefined
    const text = walkoutLine(name, p.role, v?.name ?? null)
    // the ticker line is queued by flushWalkouts (one per payday)
    this.pendingWalkouts.push({ name, text })
    this.refreshGarageBadge()
    this.refreshShield()
  }

  /** The level bar's refill sweep after level:up (see LEVEL_FULL_MS). */
  private updateLevelAnim(delta: number): void {
    if (this.levelAnim === null) return
    this.levelAnim += Math.max(0, Math.min(delta, 100))
    const t = this.levelAnim
    let f: number
    if (t < LEVEL_FULL_MS) f = 1
    else if (t < LEVEL_FULL_MS + LEVEL_REFILL_MS)
      f = this.levelTarget * ((t - LEVEL_FULL_MS) / LEVEL_REFILL_MS)
    else {
      this.levelAnim = null
      f = this.levelTarget
    }
    this.levelFrac = f
    setBarFill(this.levelFill, this.levelBarRect().w, f)
  }

  // ---------------------------------------------------------------- M3: audio

  /** The director's state, or null (absent, or it threw). */
  private audioState(): {
    unlocked?: boolean
    disabled?: boolean
    muted?: boolean
  } | null {
    try {
      return this.director()?.state?.() ?? null
    } catch {
      return null
    }
  }

  /** Audio is on but waits for its first gesture (?skipTitle=1, no Title tap). */
  private audioLocked(): boolean {
    const st = this.audioState()
    return !!st && st.disabled !== true && st.unlocked === false
  }

  /** In the tap's own handler: the director's unlock (resume inside the gesture). */
  private unlockAudio(): void {
    try {
      void this.director()?.unlock?.()
    } catch {
      // audio never blocks the game
    }
  }

  /** `Tap for sound` over the sax while the audio waits for its first tap. */
  private refreshAudioHint(): void {
    const want =
      !this.muted &&
      this.audioLocked() &&
      this.holds.size === 0 &&
      !this.paused.isOpen()
    if (want === (this.audioHint !== null)) return
    if (!want) {
      this.audioHint?.destroy()
      this.audioHint = null
      return
    }
    const L = this.L
    const t = addText(this, 4, 0, TAP_FOR_SOUND_TEXT)
    const w = Math.round(t.width) + 8
    const h = 18
    t.setY(textTop(0, h))
    const bg = addPanel(this, 0, 0, w, h, 'ui_tag')
    const r = L.mute.rect
    const x = Math.round(
      Math.min(L.W - 4 - w, Math.max(4, r.x + r.w / 2 - w / 2)),
    )
    const y = L.bottomBar.y - h - 2
    // A ≥ 44-px hit band around the tag that stops where the bar's buttons
    // start (smoke: HUD hit rects ≥ 44 / zoom, none overlapping the bar's).
    const hitW = Math.max(w, L.minHit)
    const hitBottom = L.mute.rect.y - y
    const hit = addTapZone(
      this,
      {
        x: Math.floor((w - hitW) / 2),
        y: hitBottom - L.minHit,
        w: hitW,
        h: L.minHit,
      },
      () => this.unlockAudio(),
      'audio:tapForSound',
    )
    this.audioHint = this.add
      .container(x, y, [bg, t, hit])
      .setDepth(D.audioHint)
  }

  /** The director appeared (or changed) in the registry: follow its mute state. */
  private syncMuteFromDirector(): void {
    const m = this.director()?.isMuted?.()
    if (typeof m === 'boolean' && m !== this.muted) this.setMutedIcon(m)
    this.refreshAudioHint()
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
    this.paper.relayout(L)
    this.summary.relayout(L)
    this.questCard.relayout(L)
    this.victoryCard.relayout(L)
    // The VictoryCard / SummaryCard rebuilt their cameras above an open
    // New-game confirm: re-fit it and put it back on top (it is still the
    // top modal, so Enter would confirm it unseen).
    this.newGameDialog?.relayout(L)
    this.audioHint?.destroy()
    this.audioHint = null
    this.refreshAudioHint()
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
        () =>
          this.toast.show(
            nextUnlockLine(this.gd, this.vs.level, this.vs.victory),
          ),
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
    this.questChip = new QuestChip(this).setDepth(c)
    this.questChip.onTap(() => this.onQuestChipTap())
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
    const bar = this.levelBarRect()
    const by = bar.y + Math.floor((bar.h - BAR_H) / 2)
    this.levelTrack.setPosition(bar.x, by).setSize(bar.w, BAR_H)
    this.levelFill.setPosition(bar.x, by)
    this.levelFrac = -1
    this.refreshLevel()
    this.layoutShield()
    this.questChip.setRect(L.questChip.rect, L.questChip.hit)
    if (this.zones) {
      setZoneRect(this.zones.money, L.money.hit)
      setZoneRect(this.zones.lives, L.lives.hit)
      setZoneRect(this.zones.mood, L.mood.hit)
      setZoneRect(
        this.zones.level,
        this.chipShown ? L.levelChip.hit : L.level.hit,
      )
      setZoneRect(this.zones.shield, L.shield.hit)
    }
  }

  /** The level bar: the short one while the quest chip shows (design-m7 §6.4). */
  private levelBarRect(): Rect {
    return this.chipShown ? this.L.levelBarChip : this.L.levelBar
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

  /**
   * `+$12` / `−$28` rising next to the money cell (city-view §3.1), placed
   * after the balance it counts to (the cell is still mid-tween: placed after
   * the shorter old text, `+$29` sat on `$1,445`).
   */
  private floatMoney(delta: number, gold: boolean, balance: number): void {
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
    const shown = this.moneyText.text
    const finalW = this.moneyText.setText(formatMoney(balance)).width
    this.moneyText.setText(shown)
    const x = Math.round(
      this.moneyText.x + Math.max(finalW, this.moneyText.width) + 6,
    )
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
    const compact = this.chipShown
    const p = levelProgress(
      this.gd,
      vs.level,
      vs.lifetimeEarned,
      vs.nextThreshold,
      { compact, victory: vs.victory },
    )
    this.levelText.setText(levelLabel(this.gd, vs.level))
    const bar = this.levelBarRect()
    this.levelTarget = p.frac
    // The level-up sweep owns the fill until it ends (updateLevelAnim).
    if (this.levelAnim === null && p.frac !== this.levelFrac) {
      this.levelFrac = p.frac
      setBarFill(this.levelFill, bar.w, p.frac)
    }
    const t = this.levelBarText
    t.setText(
      compact ? ellipsize(p.text, bar.w, (x) => t.setText(x).width) : p.text,
    )
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

  /**
   * ❚❚ | 1× | 2×: stepper.speed (0 holds the sim), never game.pause().
   * ❚❚ while already paused opens the pause menu (the Paused card with
   * `End run — show summary`); the session's first pause says so.
   */
  private setSegment(i: number): void {
    const st = this.stepper
    if (this.paused.isOpen()) this.resumeFromCard()
    if (i === 0) {
      if (st.speed === 0 && !st.paused) {
        this.openPauseMenu()
        return
      }
      st.speed = 0
      if (!this.pauseHinted) {
        this.pauseHinted = true
        this.toast.show(PAUSE_MENU_HINT_TEXT)
      }
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

  /**
   * The sax: toggles the AudioDirector's master mute (it persists
   * pm.settings.v1 and emits audio:muted). While `Tap for sound` is up the
   * tap is the unlock gesture instead (it must not mute the sound it starts).
   */
  private toggleMute(): void {
    const dir = this.director()
    if (
      this.hintGesture ||
      this.audioHint ||
      (!this.muted && this.audioLocked())
    ) {
      this.unlockAudio()
      this.audioHint?.destroy()
      this.audioHint = null
      return
    }
    let next = !this.muted
    try {
      if (dir?.toggleMuted) next = dir.toggleMuted()
      else if (dir?.setMuted) dir.setMuted(next)
      else writeSettings({ muted: next })
    } catch {
      writeSettings({ muted: next })
    }
    this.setMutedIcon(next)
    this.refreshAudioHint()
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

  /**
   * Garage badge now, and again next frame: an event fires before its
   * command / tick bumps sim.revision, so the ViewSim's vehicles cache can
   * still hold the old fleet (a fired driver, a `Hire later` purchase).
   */
  private refreshGarageBadge(): void {
    this.garageDirty = true
    this.applyGarageBadge()
  }

  /** Garage: `!` (unpaid / inactive / no driver) wins over the one-shot `+`. */
  private applyGarageBadge(): void {
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
    if (garageAlert(vs.vehicles, vs.payroll().short))
      this.garageBtn.setBadge('!', 'red')
    else if (this.plusPending) this.garageBtn.setBadge('+', 'green')
    else this.garageBtn.setBadge(null)
  }

  // ---------------------------------------------------------------- views + panels

  private setView(name: WorldView): void {
    this.view = name
    this.recorder?.setView(name)
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
   * The toast lane follows the room when its height changes inside the
   * warehouse — a level-up 3 → 4 / 4 → 5 or a sim swap at another tier
   * (M9 review: the lane stayed at the old room's wall, over the dock
   * panel); a no-op while it already sits there (a toast mid-slide keeps
   * its tween).
   */
  private syncToastLane(): void {
    if (!this.toast) return
    const lane = this.toastLane()
    if (lane.y === this.toast.laneY) return
    this.toast.relayout({ W: this.L.W, toast: lane })
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
    // M9: the tier's room height (16 / 18 rows at tiers 4-5), as the
    // WarehouseScene places it — a room taller than the bands starts 28 px
    // under the ticker instead of being centred.
    const roomH = roomHeightForTier(visualTier(this.gd, this.vs.level))
    const room = roomPlacement(
      L.W,
      L.ticker.y + L.ticker.h,
      L.bottomBar.y,
      roomH,
    )
    return { ...L.toast, y: room.roomY + 4 }
  }

  /**
   * Re-read the open district panel (city-view §5.1 refresh events) on the
   * next frame: the callers are sim event handlers, and the ViewSim caches
   * (hubs(), vehicles) follow sim.revision, bumped only after the tick's
   * events — a read inside the tick is stale for every later event of it
   * (M8 review: one hand-off short per same-tick pair).
   */
  private refreshDistrict(): void {
    if (this.district?.isOpen()) this.districtDirty = true
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
    // A driven vehicle bought while nothing listened (?fastForward, a policy
    // run) has already done step 1's job.
    const fleet = getSim(this).state.vehicles
    if (step1Done(fleet) && this.onboarding.eligible(1)) {
      this.completeStep1()
      return
    }
    this.scheduleStep2()
    if (this.onboarding.eligible(1)) {
      this.onboarding.show(
        1,
        () => {
          const g = this.L.garage.rect
          return { x: Math.round(g.x + g.w / 2), y: g.y }
        },
        step1Text(fleet),
      )
    }
  }

  /** Step 1 done (a vehicle has its driver): hide it, step 2 follows. */
  private completeStep1(): void {
    if (!this.onboarding.eligible(1)) return
    this.onboarding.complete(1)
    this.scheduleStep2()
  }

  /**
   * Step 1's text follows the fleet (read from the state: the ViewSim's
   * cache is a revision behind inside an event): `Bike 1 has no driver
   * yet: hire one in the Garage` after a `Hire later`.
   */
  private refreshStep1(): void {
    if (this.onboarding.activeStep !== 1) return
    this.onboarding.retext(1, step1Text(getSim(this).state.vehicles))
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
    // Hidden time is not play time (elapsedS); the save writes the profile.
    this.recorder.hidden()
    this.autosave.save('hidden')
  }

  private onVisible(): void {
    if (!this.autoPaused || this.paused.isOpen()) return
    // A lost-life / game-over / summary card already holds the sim and
    // asks for a tap: no Paused card on top of it.
    if (
      this.lostCard.isOpen() ||
      this.overCard.isOpen() ||
      this.summary.isOpen() ||
      this.victoryCard.isOpen
    ) {
      this.autoPaused = false
      this.release('hidden')
      return
    }
    // A modal card never renders under the sheet (plan.md §6.7), nor over
    // the shield / mood popovers, the district panel or a tooltip (one Esc
    // must not close one of those and resume through the card).
    this.prepareModal()
    this.paused.show()
  }

  private resumeFromCard(): void {
    this.paused.hide()
    if (this.autoPaused) {
      this.autoPaused = false
      this.release('hidden')
    }
    // The pause menu closes back into play at the last running speed.
    if (this.pauseMenu) {
      this.pauseMenu = false
      if (this.stepper.speed === 0) this.stepper.speed = this.lastRunSpeed
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
          this.floatMoney(p.delta, floatsGold(p.reason), p.balance)
          if (isEarned(p.reason)) this.dayEarned += p.delta
          this.refreshLevel()
          this.refreshGarageBadge()
        },
        'satisfaction:changed': (p) => this.onSatisfaction(p),
        'parcel:spawned': () => this.refreshDistrict(),
        'level:up': (p) => this.onLevelUp(p),
        'region:unlocked': (p) => this.onRegionUnlocked(p),
        'lane:stalled': (p) => {
          this.refreshWarehouseBtn()
          this.queueLine(stallLine(p.reason), 'stall')
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
        'worker:fired': (p) => this.onFired(p),
        'parcel:delivered': () => {
          this.dayDelivered++
        },
        // M8 overseas hubs: the hub panel's clearing row (and the daily
        // line's paid clearances); the city draws the ring / ship / popups.
        'parcel:handedOff': () => this.refreshDistrict(),
        'parcel:cleared': (p) => {
          if (!p.malware) this.dayCleared++
          this.refreshDistrict()
        },
        'dock:bought': (p) => this.onDockBought(p),
        'parcel:pickedUp': (p) => {
          this.onPickedUp(p)
          this.refreshDistrict()
        },
        'building:rushed': () => {
          if (this.onboarding.activeStep === 3) this.onboarding.complete(3)
        },
        'payroll:paid': (p) => this.onPayrollPaid(p),
        'payroll:short': (p) => this.onPayrollShort(p),
        'worker:walkedOut': (p) => this.onWalkedOut(p),
        'worker:hired': (p) => this.onHired(p),
        'vehicle:bought': () => {
          // Step 1 clears on the driver's worker:hired (onHired), which the
          // buy flow emits right after this; a `Hire later` purchase
          // re-words it (vehicle:inactive → refreshStep1).
          this.refreshGarageBadge()
          this.refreshDistrict()
        },
        'vehicle:sold': (p) => {
          if (this.follow.vehicleId === p.id) this.follow.hide()
          this.refreshGarageBadge()
          this.refreshDistrict()
        },
        'vehicle:inactive': () => {
          this.refreshGarageBadge()
          this.refreshStep1()
        },
        'life:lost': (p) => this.onLifeLost(p),
        'game:over': () => this.onGameOver(),
        // The daily line is built at the flush, after this tick's payday.
        'day:ended': (p) => {
          this.dailyDay = p.day
          this.refreshGarageBadge()
        },
        'ticker:news': (p) => {
          this.simKinds.add(p.kind)
          this.pendingLines.push({ text: p.text, kind: p.kind, src: 'sim' })
        },
        // M7 quests: the chip / card / district row re-read quests() next
        // frame (questDirty); the lines are the sim's ticker:news.
        'quest:offered': (p) => {
          this.questDirty = true
          this.questAutoOpen = { id: p.questId, force: false }
        },
        'quest:accepted': () => {
          this.questDirty = true
        },
        'quest:declined': (p) => {
          this.questDirty = true
          if (this.questAutoOpen?.id === p.questId) this.questAutoOpen = null
        },
        'quest:progress': () => {
          this.questDirty = true
        },
        'quest:failed': (p) => {
          this.questDirty = true
          this.questSeen.delete(p.questId)
        },
        'quest:completed': (p) => this.onQuestCompleted(p),
        'life:gained': (p) => this.onLifeGained(p),
        'game:victory': () => this.onVictory(),
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
    const onMuted = (p: { muted?: boolean }): void => {
      this.setMutedIcon(!!p?.muted)
      this.refreshAudioHint()
    }
    // audio.md §3 item 8: `Now playing: Semver Swing` for toastSeconds —
    // once per title (the director re-announces every pass of the loop; with
    // one tune in playtest 1 that was a toast every ~2 min).
    const onNowPlaying = (p: { title?: string; seconds?: number }): void => {
      if (!p?.title || this.muted || p.title === this.lastTitle) return
      this.lastTitle = p.title
      this.longToast(
        nowPlayingText(p.title),
        false,
        Math.max(0, p.seconds ?? 3) * 1000,
      )
    }
    const onAudioReg = (_parent: unknown, key?: string): void => {
      if (key === 'audio') this.syncMuteFromDirector()
    }
    const onHidden = (): void => this.onHidden()
    const onVisible = (): void => this.onVisible()
    const onPageHide = (): void => this.onHidden()
    const onResize = (): void => this.relayout()
    const onSafe = (): void => this.relayout()
    const onStamp = (): void => this.layoutStamp()
    // A swapped-in Sim (__pm.load, a fixture) is another run: a fresh profile.
    const onSimReplaced = (e: { sim?: Sim }): void => {
      if (e?.sim) this.recorder.attach(e.sim, null)
      if (this.summary.isOpen()) {
        const over = this.summary.currentMode === 'over'
        this.summary.close()
        this.release('summary')
        if (this.vs.gameOver) {
          if (!this.overCard.isOpen() && !this.overTimer) this.openGameOver()
        } else if (over) {
          // syncAll released nothing: the game-over card was closed under us.
          this.autosave.enabled = true
          this.release('gameOver')
        }
      }
    }
    // taps (plan.md §12.9): every pointerdown on the canvas.
    const canvas = this.game.canvas as HTMLCanvasElement | null
    const onCanvasDown = (): void => {
      this.tapCount += 1
    }
    canvas?.addEventListener('pointerdown', onCanvasDown, {
      capture: true,
      passive: true,
    })

    ge.on(EV_VIEW, onView)
    ge.on(SIM_REPLACED, onSimReplaced)
    ge.on(EV_SELECT, onSelect)
    ge.on(EV_FOLLOW, onFollow)
    ge.on(EV_TOOLTIP, onTooltip)
    ge.on('ui:sheetOpen', onSheetOpen)
    ge.on(EV_AUDIO_MUTED, onMuted)
    ge.on(EV_AUDIO_NOW_PLAYING, onNowPlaying)
    ge.on(Phaser.Core.Events.HIDDEN, onHidden)
    ge.on(Phaser.Core.Events.VISIBLE, onVisible)
    window.addEventListener('pagehide', onPageHide)
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    const reg = this.registry.events
    reg.on(`changedata-${REG.safeTop}`, onSafe)
    reg.on(`changedata-${REG.safeBottom}`, onSafe)
    reg.on(`changedata-${REG.buildStamp}`, onStamp)
    reg.on(Phaser.Data.Events.SET_DATA, onAudioReg)
    reg.on(Phaser.Data.Events.CHANGE_DATA, onAudioReg)

    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this)
    // Scene-level pointerup runs after the game objects' own (the sax's).
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.chipDrag = null
      this.hintGesture = false
    })
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.tip) this.hideTooltip()
      // Any first tap starts the sound under `Tap for sound` (inside the
      // gesture; Boot's unlockOnFirstGesture does the same on document).
      if (this.audioHint) {
        this.hintGesture = true
        this.unlockAudio()
        this.audioHint.destroy()
        this.audioHint = null
      }
    })
    this.input.keyboard?.on('keydown', this.onKey, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ge.off(EV_VIEW, onView)
      ge.off(SIM_REPLACED, onSimReplaced)
      canvas?.removeEventListener('pointerdown', onCanvasDown, {
        capture: true,
      })
      this.recorder.detach()
      if (this.registry.get(REG_PLAYTEST) === this.recorder)
        this.registry.remove(REG_PLAYTEST)
      this.newGameDialog?.destroy()
      this.newGameDialog = null
      this.summary.destroy()
      ge.off(EV_SELECT, onSelect)
      ge.off(EV_FOLLOW, onFollow)
      ge.off(EV_TOOLTIP, onTooltip)
      ge.off('ui:sheetOpen', onSheetOpen)
      ge.off(EV_AUDIO_MUTED, onMuted)
      ge.off(EV_AUDIO_NOW_PLAYING, onNowPlaying)
      ge.off(Phaser.Core.Events.HIDDEN, onHidden)
      ge.off(Phaser.Core.Events.VISIBLE, onVisible)
      window.removeEventListener('pagehide', onPageHide)
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      reg.off(`changedata-${REG.safeTop}`, onSafe)
      reg.off(`changedata-${REG.safeBottom}`, onSafe)
      reg.off(`changedata-${REG.buildStamp}`, onStamp)
      reg.off(Phaser.Data.Events.SET_DATA, onAudioReg)
      reg.off(Phaser.Data.Events.CHANGE_DATA, onAudioReg)
      this.input.keyboard?.off('keydown', this.onKey, this)
      this.closeMood()
      this.hideTooltip()
      this.moneyTween?.stop()
      for (const f of this.floats) f.tween?.stop()
      this.onboarding.destroy()
      // The cards sit on the shared modal stack: pop them with the scene.
      this.lostCard.destroy()
      this.overCard.destroy()
      this.questCard.destroy()
      this.victoryCard.destroy()
      this.questChip.destroy()
      this.lostTimer = null
      this.overTimer = null
      this.victoryTimer = null
    })
  }

  private employeeNames(ids: readonly number[]): string[] {
    const emps = getSim(this).state.employees
    return ids.map((id) => emps.find((e) => e.id === id)?.name ?? `#${id}`)
  }

  /** Rebuild every readout from sim state (create, WAKE, Sim swap). */
  private syncAll(): void {
    const vs = this.vs
    this.staffNames = new Map(
      (getSim(this)?.state.employees ?? []).map((e) => [e.id, e.name]),
    )
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
    // The Garage `+` announces a type unlocked after Lv 1 once it becomes
    // affordable: the types the fleet already owns need no announcement
    // (a reload at Lv 2 with no truck yet still gets its `+`).
    this.seenTypes = new Set(vs.vehicles.map((v) => v.type))
    // Strains already in the spawn pool were announced before this session.
    this.strainsTold = new Set(this.liveStrains())
    this.moodDay.clear()
    this.levelAnim = null
    this.syncToastLane()
    this.refreshWarehouseBtn()
    this.refreshGarageBadge()
    if (
      this.follow.visible &&
      !vs.vehicles.some((v) => v.id === this.follow.vehicleId)
    )
      this.follow.hide()
    // A swapped-in sim that already owns a driven vehicle (__pm.load of a
    // fixture or save) has done step 1's job, as startTour() rules for a
    // policy run; a driverless fleet re-words step 1.
    if (step1Done(vs.vehicles) && this.onboarding?.eligible(1))
      this.onboarding.complete(1)
    if (step1Done(vs.vehicles)) this.scheduleStep2()
    if (this.onboarding) this.refreshStep1()
    this.heldLabels.clear()
    for (const it of vs.holdBay.items) this.rememberLabel(it.parcelId)
    this.syncQuests()
    // Cards follow the sim: a game-over state (a reload, __pm.load of a
    // fixture) shows its screen; a live one closes a stale screen.
    if (vs.gameOver) {
      if (!this.overCard.isOpen() && !this.overTimer && !this.summary?.isOpen())
        this.openGameOver()
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
      // Only while the shield is the top modal (a card above it owns Esc).
      if (this.shield?.isOpen() && claimKey(ev, this.shield))
        this.shield.close()
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
    // The Paused card on top (report §6.5): the view switch waits; Space and
    // the speed keys resume through it, as their taps would.
    const onCard = topModal() === this.paused
    if (onCard && lower === 'w') return
    if (!claimKey(ev, onCard ? this.paused : null)) return
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

  /**
   * Depth of the shared modal stack (src/ui/Sheet.ts) — e2e/lifecycle.spec.ts
   * checks that no sheet, card or popover is left on it after view storms,
   * fixture swaps and a New game (a leaked entry silently mutes Esc/G/W and
   * keeps the onboarding cards hidden).
   */
  modalDepth(): number {
    return modalCount()
  }
}
